<?php
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CController;
use CControllerResponseData;
use API;

/**
 * NetworkTopologyHistory
 *
 * Liefert eine Severity-Timeline für alle Hosts der ausgewählten Hostgroups
 * über ein Zeitfenster. Wird für den History-Slider benutzt.
 *
 * Request (GET/POST):
 *   groupids[] = 1,2,...        (mind. 1 Hostgroup)
 *   from       = 1710000000     (Unix-Timestamp Start)
 *   to         = 1710086400     (Unix-Timestamp Ende)
 *
 * Response JSON:
 *   {
 *     "from": 1710000000,
 *     "to":   1710086400,
 *     "events": {
 *       "10656": [           // hostid → Liste von Severity-Wechseln
 *         { "ts": 1710001234, "sev": 4, "name": "ICMP unreachable" },
 *         { "ts": 1710002000, "sev": 0, "name": "ICMP unreachable" }
 *       ],
 *       ...
 *     }
 *   }
 *
 * Das Frontend baut daraus pro Host eine Timeline: zur Zeit T ist die
 * höchste Severity aller PROBLEM-Events (sev>0) die bei T noch nicht
 * RESOLVED (sev=0 dasselbe Trigger-Name) waren.
 *
 * Auflösung wird vom Frontend bestimmt (1h / 24h / 7d) — Backend liefert
 * einfach alle Events im Range.
 *
 * Performance: Bei großen Setups (>100 Hosts × 7d) kann event.get viele
 * Events liefern. Wir limitieren auf max 50000 Events; falls truncated,
 * gibt das Backend ein "truncated":true Flag zurück.
 */
class NetworkTopologyHistory extends CController {

    private const MAX_EVENTS = 50000;
    private const MAX_RANGE_SECONDS = 7 * 86400 + 3600;   // 7 Tage + 1h Toleranz

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    // Read-only Endpunkt — nur XHR-Aufrufe akzeptieren (CSRF-Last-Schutz).
    private function requireAjax(): bool {
        if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'XMLHttpRequest') {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['error' => 'AJAX only'])
            ]));
            return false;
        }
        return true;
    }

    protected function checkInput(): bool {
        if (!$this->requireAjax()) return false;
        $ret = $this->validateInput([
            'groupids' => 'array_id',
            'from'     => 'int32',
            'to'       => 'int32',
        ]);
        if (!$ret) {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['error' => 'Invalid input'])
            ]));
        }
        return $ret;
    }

    protected function checkPermissions(): bool {
        return $this->getUserType() >= USER_TYPE_ZABBIX_USER;
    }

    protected function doAction(): void {
        $groupids = $this->getInput('groupids', []);
        $from     = (int) $this->getInput('from', 0);
        $to       = (int) $this->getInput('to', 0);

        // Range-Validierung
        if ($from <= 0 || $to <= 0 || $to <= $from) {
            $this->respond(['error' => 'Invalid time range']);
            return;
        }
        if (($to - $from) > self::MAX_RANGE_SECONDS) {
            $this->respond(['error' => 'Time range exceeds max (7 days)']);
            return;
        }
        if (empty($groupids)) {
            $this->respond(['error' => 'No groupids']);
            return;
        }

        // Permissions: nur Hostgroups die der User sehen darf
        $allowed_groups = API::HostGroup()->get([
            'output'   => ['groupid'],
            'groupids' => $groupids,
            'preservekeys' => true,
        ]);
        $allowed_ids = array_keys($allowed_groups);
        if (empty($allowed_ids)) {
            $this->respond(['error' => 'No accessible hostgroups']);
            return;
        }

        // Hosts der Gruppen sammeln
        $hosts = API::Host()->get([
            'output'   => ['hostid'],
            'groupids' => $allowed_ids,
            'preservekeys' => true,
        ]);
        $hostids = array_keys($hosts);
        if (empty($hostids)) {
            $this->respond([
                'from' => $from, 'to' => $to, 'events' => new \stdClass()
            ]);
            return;
        }

        // Events im Zeitfenster ziehen.
        // event.get mit source=0 (Trigger), object=0 (Trigger), value=any
        // gibt PROBLEM- und RECOVERY-Events. Wir brauchen beides um die
        // Timeline zu rekonstruieren.
        $events = API::Event()->get([
            'output'      => ['eventid', 'objectid', 'clock', 'value', 'severity', 'name'],
            'source'      => EVENT_SOURCE_TRIGGERS,
            'object'      => EVENT_OBJECT_TRIGGER,
            'hostids'     => $hostids,
            'time_from'   => $from,
            'time_till'   => $to,
            'sortfield'   => ['clock', 'eventid'],
            'sortorder'   => 'ASC',
            'limit'       => self::MAX_EVENTS + 1,    // +1 um Truncation zu erkennen
            'selectHosts' => ['hostid'],
        ]);
        $truncated = false;
        if (count($events) > self::MAX_EVENTS) {
            $truncated = true;
            $events = array_slice($events, 0, self::MAX_EVENTS);
        }

        // Pro Host eine Liste von Severity-Wechseln aufbauen.
        // Format: [{ ts, sev, name, eventid }, ...]
        // - PROBLEM-Event (value=1): Severity = severity-Wert
        // - RECOVERY-Event (value=0): Severity = 0 (Problem ist weg)
        // Beide erhalten den name des Triggers, damit das Frontend
        // beim Resolve den entsprechenden Problem-Event finden kann.
        $by_host = [];
        foreach ($events as $ev) {
            $hosts_list = $ev['hosts'] ?? [];
            if (empty($hosts_list)) continue;
            // Ein Trigger kann auf mehrere Hosts referenzieren — Event jedem zuordnen
            foreach ($hosts_list as $h) {
                $hid = $h['hostid'];
                if (!isset($by_host[$hid])) $by_host[$hid] = [];
                $by_host[$hid][] = [
                    'ts'   => (int) $ev['clock'],
                    'sev'  => ((int) $ev['value']) === 1 ? (int) $ev['severity'] : 0,
                    'name' => $ev['name'],
                    'val'  => (int) $ev['value'],   // 1=PROBLEM, 0=RECOVERY
                ];
            }
        }

        // Zusätzlich: Events die VOR `from` schon offen waren und in den
        // Zeitraum hineinragen. Sonst sehen Hosts die seit Tagen ein Problem
        // haben am Slider-Anfang fälschlich "ok" aus.
        // Wir holen alle aktiven Probleme zum Zeitpunkt `from` via problem.get
        // mit recent=true ist nicht das Richtige — wir brauchen "PROBLEM-Events
        // die vor `from` aufgemacht und nach `from` (oder gar nicht) geclosed
        // wurden".
        //
        // Einfachster Weg: problem.get mit time_till=from gibt alle Probleme
        // die zu diesem Zeitpunkt OFFEN waren. Diese hängen wir als
        // synthetische "ts=from"-Events an damit das Frontend das richtige
        // Startzustand hat.
        $open_at_start = API::Problem()->get([
            'output'      => ['eventid', 'objectid', 'clock', 'severity', 'name'],
            'source'      => EVENT_SOURCE_TRIGGERS,
            'object'      => EVENT_OBJECT_TRIGGER,
            'hostids'     => $hostids,
            'time_till'   => $from,
            'recent'      => false,    // alle, nicht nur recent
            'selectHosts' => ['hostid'],
        ]);
        foreach ($open_at_start as $pr) {
            $hosts_list = $pr['hosts'] ?? [];
            if (empty($hosts_list)) continue;
            foreach ($hosts_list as $h) {
                $hid = $h['hostid'];
                if (!isset($by_host[$hid])) $by_host[$hid] = [];
                // Synthetisches Event "PROBLEM bestand bereits zum Range-Start"
                array_unshift($by_host[$hid], [
                    'ts'   => $from,
                    'sev'  => (int) $pr['severity'],
                    'name' => $pr['name'],
                    'val'  => 1,
                    'pre'  => true,       // Marker: war schon vor dem Range
                ]);
            }
        }

        $this->respond([
            'from'      => $from,
            'to'        => $to,
            'events'    => $by_host ?: new \stdClass(),
            'truncated' => $truncated,
        ]);
    }

    private function respond(array $data): void {
        $this->setResponse(new CControllerResponseData([
            'main_block' => json_encode($data, JSON_UNESCAPED_SLASHES)
        ]));
    }
}
