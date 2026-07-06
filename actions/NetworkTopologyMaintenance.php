<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CController;
use CControllerResponseData;
use API;

/**
 * NetworkTopologyMaintenance
 *
 * Legt aus der Map heraus eine One-Time-Wartung fuer einen Host an
 * (Rechtsklick → „Wartung 1h/4h/…"). Damit wird die Topologie
 * handlungsfaehig: „darf ich den Host rebooten?" → Wartung an, Alarme
 * werden unterdrueckt.
 *
 * WRITE-Action. Schutz:
 *   - checkPermissions() >= USER_TYPE_ZABBIX_ADMIN (Wartung ist Admin-Sache).
 *   - requireAjax() (X-Requested-With) als CSRF-Last-Schutz wie im Rest des
 *     Moduls; zusaetzlich same-origin-Session-Cookie. disableCsrfValidation()
 *     schaltet nur den Zabbix-Form-Token ab (den das Frontend hier nicht hat).
 *   - API::Maintenance.create ehrt die User-Permissions: ein Admin kann nur
 *     Wartung fuer Hosts in Gruppen anlegen, auf die er Schreibrecht hat.
 *     Host.get vorab liefert den (permission-gefilterten) Namen und dient
 *     als frueher Rechte-Check.
 *
 * Request:  hostids[] (Pflicht, genau/mind. 1), duration (in Sekunden,
 *           Whitelist 3600|14400|28800|86400)
 * Response: { ok: true, maintenanceid, name } oder { error }
 *
 * Aktivierung: Zabbix' Timer-Prozess zieht die Wartung erst beim naechsten
 * Lauf (bis ~1 min) — das Frontend weist im Toast darauf hin.
 */
class NetworkTopologyMaintenance extends CController {

    // Whitelist der erlaubten Dauern (Sekunden) → Label fuer den Namen.
    private const DURATIONS = [
        3600  => '1h',
        14400 => '4h',
        28800 => '8h',
        86400 => '24h',
    ];
    private const MAX_HOSTS = 50;   // Bulk-Cap; die Map schickt i.d.R. 1

    protected function init(): void {
        $this->disableCsrfValidation();
    }

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
            'hostids'  => 'required|array_id',
            'duration' => 'required|in 3600,14400,28800,86400',
        ]);
        if (!$ret) {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['error' => 'Invalid input'])
            ]));
        }
        return $ret;
    }

    protected function checkPermissions(): bool {
        // Wartung anlegen ist eine Admin-Aktion (deckt sich mit can_edit im
        // Frontend, das den Menue-Eintrag nur Admins zeigt).
        return $this->getUserType() >= USER_TYPE_ZABBIX_ADMIN;
    }

    protected function doAction(): void {
        $hostids  = array_slice($this->getInput('hostids', []), 0, self::MAX_HOSTS);
        $duration = (int) $this->getInput('duration', 3600);
        if (!$hostids || !isset(self::DURATIONS[$duration])) {
            $this->fail('Invalid input');
            return;
        }

        // Permission-Check + Namen holen (Host.get ehrt die User-Rechte;
        // leeres Ergebnis → keine Sicht/kein Recht auf den Host).
        $hosts = API::Host()->get([
            'output'       => ['hostid', 'host', 'name'],
            'hostids'      => $hostids,
            'editable'     => true,   // nur Hosts mit Schreibrecht → Wartung erlaubt
            'preservekeys' => true,
        ]);
        if (!$hosts) {
            $this->fail('Keine Schreibberechtigung fuer den/die Host(s).');
            return;
        }

        $now   = time();
        $label = self::DURATIONS[$duration];
        // Sprechender, eindeutiger Name (Zabbix verlangt Unique). Erster
        // Host + Timestamp; bei Bulk zusaetzlich Anzahl.
        $first = reset($hosts);
        $suffix = count($hosts) > 1 ? sprintf(' +%d', count($hosts) - 1) : '';
        $name = sprintf('NT map: %s%s (%s) @%d',
            $first['host'], $suffix, $label, $now);
        if (mb_strlen($name) > 128) {
            $name = mb_substr($name, 0, 128);
        }

        try {
            $res = API::Maintenance()->create([
                'name'         => $name,
                'description'  => sprintf('Aus Network-Topology-Map angelegt (%s).',
                                          date('Y-m-d H:i:s', $now)),
                // 0 = MAINTENANCE_TYPE_NORMAL (mit Datensammlung) — Metriken
                // laufen weiter, nur Problem-Alarme werden unterdrueckt.
                'maintenance_type' => 0,
                'active_since' => $now,
                // +60s Puffer: active_till muss echt groesser als das
                // Timeperiod-Ende (start_date+period) sein, sonst lehnt
                // Zabbix das Fenster am Rand ab.
                'active_till'  => $now + $duration + 60,
                // Zabbix 6.0+: hosts/groups als Objekt-Arrays (nicht hostids).
                'hosts'        => array_map(static function($id) {
                    return ['hostid' => (string) $id];
                }, array_keys($hosts)),
                'timeperiods'  => [[
                    // 0 = TIMEPERIOD_TYPE_ONETIME
                    'timeperiod_type' => 0,
                    'start_date'      => $now,
                    'period'          => $duration,
                ]],
            ]);
        } catch (\Throwable $e) {
            // API-Fehlermeldung durchreichen (enthaelt keine internen Pfade).
            $this->fail($e->getMessage());
            return;
        }

        $maintenanceid = $res['maintenanceids'][0] ?? null;
        $this->setResponse(new CControllerResponseData([
            'main_block' => json_encode([
                'ok'            => true,
                'maintenanceid' => $maintenanceid,
                'name'          => $name,
                'hosts'         => count($hosts),
                'label'         => $label,
            ], JSON_UNESCAPED_UNICODE)
        ]));
    }

    private function fail(string $msg): void {
        $this->setResponse(new CControllerResponseData([
            'main_block' => json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE)
        ]));
    }
}
