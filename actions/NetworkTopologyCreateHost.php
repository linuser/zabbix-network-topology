<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Actions;

use Modules\NetworkTopology\Topology\GhostHost;
use CCsrfTokenHelper;
use API;

/**
 * NetworkTopologyCreateHost
 *
 * Macht aus unueberwachten Nachbarn Zabbix-Hosts — einen oder mehrere auf
 * einmal, mit dem Tag nt:uplink, damit der neue Host sofort an der richtigen
 * Stelle auf der Karte sitzt.
 *
 * WARUM NICHT UEBER DAS FORMULAR
 * ------------------------------
 * Bis hierher oeffnete das Kontextmenue Zabbix' Host-Formular mit
 * ?host=…&description=…&groupids[]=…. Auf 7.0.31 nachgemessen: NUR groupids
 * kommt an, Name und Beschreibung werden verworfen. Das Formular ging auf und
 * war leer — abgetippt werden musste trotzdem. Und ein Tag liesse sich ueber
 * eine URL ohnehin nie setzen.
 *
 * WRITE-Action. Schutz, in derselben Tiefe wie NetworkTopologyMaintenance:
 *   - Echter CSRF-Token (action- + session-gebunden, Feld nt_csrf).
 *   - POST, requireAjax(), same-origin-Session.
 *   - checkPermissions() >= USER_TYPE_ZABBIX_ADMIN.
 *   - Drosselung: diese Action ERZEUGT Objekte, ein Runaway-Skript soll
 *     keine tausend Hosts anlegen koennen.
 *   - API::Host.create ehrt die Rechte: anlegen geht nur in Gruppen mit
 *     Schreibrecht. Hostgroup.get vorab ist der fruehe, deutliche Check.
 *   - Der MELDER wird gegen die API geschnitten, nicht geglaubt: der Client
 *     schickt eine hostid, der Name fuer das Tag kommt aus Zabbix.
 *
 * Request:  ghosts (JSON: [{name, reporter_hostid, port, via}]), groupid
 * Response: { ok: true, created: [{hostid, host}], failed: [{name, error}] }
 *
 * TEILERFOLG IST HIER ERLAUBT, anders als bei der Wartung. Zwanzig Geister
 * anzulegen und an einem Namen zu scheitern, der Zabbix nicht passt, soll
 * nicht die anderen neunzehn verhindern — aber jeder Fehlschlag steht
 * namentlich in der Antwort und wird im Frontend angezeigt.
 */
class NetworkTopologyCreateHost extends NetworkTopologyController {

    /** Mehr als das ist kein Bedienvorgang mehr. */
    private const MAX_GHOSTS = 50;

    /** Grenze fuer die JSON-Nutzlast. */
    private const MAX_PAYLOAD = 64 * 1024;

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
            $this->jsonResponse(['error' => 'Method not allowed']);
            return false;
        }
        if (!$this->requireAjax()) {
            return false;
        }
        $ret = $this->validateInput([
            'ghosts'  => 'required|string',
            'groupid' => 'required|id',
            'nt_csrf' => 'string',
        ]);
        if (!$ret) {
            $this->jsonResponse(['error' => 'Invalid input']);
            return false;
        }
        if (!CCsrfTokenHelper::check((string) $this->getInput('nt_csrf', ''),
                'network.topology.create_host')) {
            $this->jsonResponse(['error' => 'CSRF token invalid']);
            return false;
        }
        return true;
    }

    protected function checkPermissions(): bool {
        // Hosts anlegen ist Admin-Sache UND braucht das UI-Konfigurationsrecht
        // fuer Hosts — genau wie Zabbix' eigener Host-Controller
        // (CControllerHostCreate prueft UI_CONFIGURATION_HOSTS). Eine Rolle kann
        // die Host-Konfiguration sperren, waehrend der Benutzertyp Admin bleibt;
        // ohne diese zweite Pruefung legte das Modul dann Hosts an, die die
        // native Oberflaeche verweigert (Security-Review F01). Gleiches Muster
        // wie NetworkTopologyMaintenance mit UI_CONFIGURATION_MAINTENANCE.
        return $this->getUserType() >= USER_TYPE_ZABBIX_ADMIN
            && $this->checkAccess(\CRoleHelper::UI_CONFIGURATION_HOSTS);
    }

    protected function doAction(): void {
        if (!$this->throttle('create_host', 10, 20)) {
            return;
        }

        $raw = (string) $this->getInput('ghosts', '[]');
        if (strlen($raw) > self::MAX_PAYLOAD) {
            $this->jsonResponse(['error' => 'Payload too large']);
            return;
        }
        $liste = json_decode($raw, true);
        if (!is_array($liste) || !$liste) {
            $this->jsonResponse(['error' => 'Invalid ghosts payload']);
            return;
        }
        // Kein stilles Abschneiden — der Aufrufer soll es merken.
        if (count($liste) > self::MAX_GHOSTS) {
            $this->jsonResponse(['error' => sprintf('Too many at once (max. %d).',
                self::MAX_GHOSTS)]);
            return;
        }

        $groupid = (string) $this->getInput('groupid');

        // FRUEHER RECHTE-CHECK auf die Zielgruppe. Host.create wuerde es auch
        // ablehnen, aber mit einer Meldung, die nicht sagt, woran es lag.
        $gruppen = API::HostGroup()->get([
            'output'   => ['groupid'],
            'groupids' => [$groupid],
            'editable' => true,
        ]);
        if (!$gruppen) {
            $this->jsonResponse([
                'error' => _('No write permission for the selected host group.')
            ]);
            return;
        }

        // DEN MELDER NICHT GLAUBEN, SONDERN NACHSEHEN. Der Client schickt
        // eine hostid; der Name, der ins Tag nt:uplink geht, kommt aus
        // Zabbix. Sonst stuende im Tag, was der Browser behauptet.
        $melder_ids = [];
        foreach ($liste as $g) {
            $rid = (string) ($g['reporter_hostid'] ?? '');
            if ($rid !== '' && ctype_digit($rid)) {
                $melder_ids[$rid] = $rid;
            }
        }
        $melder = $melder_ids
            ? API::Host()->get([
                'output'       => ['hostid', 'host'],
                'hostids'      => array_values($melder_ids),
                'preservekeys' => true,
            ])
            : [];

        $erzeugt = [];
        $fehler  = [];

        foreach ($liste as $g) {
            if (!is_array($g)) {
                continue;
            }
            $name = (string) ($g['name'] ?? '');
            $rid  = (string) ($g['reporter_hostid'] ?? '');
            $mhost = isset($melder[$rid]) ? (string) $melder[$rid]['host'] : '';

            $gebaut = GhostHost::payload([
                'name'          => $name,
                'groupid'       => $groupid,
                'reporter_host' => $mhost,
                'port'          => (string) ($g['port'] ?? ''),
                'via'           => (string) ($g['via'] ?? ''),
                // Management-IP aus lldpRemManAddr (vom Client aus dem
                // Geisterknoten). GhostHost prueft sie und macht daraus ein
                // SNMP-Interface; ungueltig/leer -> interfacelos wie bisher.
                'ip'            => (string) ($g['ip'] ?? ''),
            ]);
            if (!$gebaut['ok']) {
                $fehler[] = [
                    'name'  => mb_substr($name, 0, 128),
                    'error' => $gebaut['error'] === 'name'
                        ? _('The name cannot be used as a Zabbix host name.')
                        : _('Invalid host group.'),
                ];
                continue;
            }

            try {
                $res = API::Host()->create($gebaut['payload']);
                // Der Frontend-API-Wrapper WIRFT bei einem Fehler nicht, er gibt
                // false zurueck und legt die Meldung auf den Stack. Der catch
                // unten greift dann nicht. Ohne diese Pruefung erschien ein
                // Fehlschlag (haeufig: Name schon vergeben) als erfolgreich
                // angelegter Host mit LEERER hostid.
                if ($res === false || empty($res['hostids'][0])) {
                    $fehler[] = [
                        'name'  => mb_substr($name, 0, 128),
                        'error' => mb_substr(implode('; ',
                            array_column(get_and_clear_messages(), 'message'))
                            ?: _('Host creation failed.'), 0, 250),
                    ];
                    continue;
                }
                $erzeugt[] = [
                    'hostid' => (string) $res['hostids'][0],
                    'host'   => $gebaut['payload']['host'],
                ];
            } catch (\Throwable $e) {
                // Nicht-API-Throwables (DB/Schema/TypeError) — Meldung von Zabbix
                // ist hier brauchbar und wird durchgereicht.
                $fehler[] = [
                    'name'  => mb_substr($name, 0, 128),
                    'error' => mb_substr($e->getMessage(), 0, 250),
                ];
            }
        }

        $this->jsonResponse([
            'ok'      => true,
            'created' => $erzeugt,
            'failed'  => $fehler,
        ]);
    }
}
