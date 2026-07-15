<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CCsrfTokenHelper;
use API;

/**
 * NetworkTopologyMaintenance
 *
 * Legt aus der Map heraus eine One-Time-Wartung fuer einen Host an
 * (Rechtsklick → „Wartung 1h/4h/…"). Damit wird die Topologie
 * handlungsfaehig: „darf ich den Host rebooten?" → Wartung an, Alarme
 * werden unterdrueckt.
 *
 * WRITE-Action. Schutz (Defense in Depth):
 *   - Echter CSRF-Token: action- + session-gebunden, im View via
 *     CCsrfTokenHelper::get('network.topology.v6.maintenance') erzeugt, ueber
 *     NT_CONFIG ans JS gereicht und hier per CCsrfTokenHelper::check geprueft.
 *     Ein Cross-Site-Request kann den Token nicht kennen → wird abgelehnt.
 *     (disableCsrfValidation() schaltet nur Zabbix' automatische Form-Token-
 *     Pruefung ab; wir pruefen denselben Token stattdessen explizit mit
 *     eigenem Transport-Feld nt_csrf.)
 *   - checkPermissions() >= USER_TYPE_ZABBIX_ADMIN (Wartung ist Admin-Sache).
 *   - requireAjax() (X-Requested-With) + same-origin-Session-Cookie.
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
class NetworkTopologyMaintenance extends NetworkTopologyController {

    // Whitelist der erlaubten Dauern (Sekunden) → Label fuer den Namen.
    private const DURATIONS = [
        3600  => '1h',
        14400 => '4h',
        28800 => '8h',
        86400 => '24h',
    ];
    private const MAX_HOSTS = 50;   // Bulk-Cap; die Map schickt i.d.R. 1

    protected function init(): void {
        // Zabbix' automatische Form-Token-Pruefung aus (das JS-Frontend nutzt
        // kein Zabbix-Formular); den CSRF-Token pruefen wir stattdessen selbst
        // in checkInput() via CCsrfTokenHelper::check (Feld nt_csrf).
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        // Schreibende Action nur per POST (GET/HEAD/… abweisen).
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
            $this->jsonResponse(['error' => 'Method not allowed']);
            return false;
        }
        if (!$this->requireAjax()) return false;
        $ret = $this->validateInput([
            'hostids'  => 'required|array_id',
            'duration' => 'required|in 3600,14400,28800,86400',
            'nt_csrf'  => 'string',
        ]);
        if (!$ret) {
            $this->jsonResponse(['error' => 'Invalid input']);
            return false;
        }
        // Echter CSRF-Schutz: der action- + session-gebundene Token (im View
        // via CCsrfTokenHelper::get erzeugt, ueber NT_CONFIG ans JS gereicht)
        // muss stimmen. X-Requested-With allein waere fuer eine schreibende
        // Action kein ausreichender Schutz.
        if (!CCsrfTokenHelper::check((string) $this->getInput('nt_csrf', ''),
                'network.topology.v6.maintenance')) {
            $this->jsonResponse(['error' => 'CSRF token invalid']);
            return false;
        }
        return true;
    }

    protected function checkPermissions(): bool {
        // Wartung anlegen ist eine Admin-Aktion (deckt sich mit can_edit im
        // Frontend, das den Menue-Eintrag nur Admins zeigt).
        return $this->getUserType() >= USER_TYPE_ZABBIX_ADMIN;
    }

    protected function doAction(): void {
        // Eindeutige, normalisierte Host-ID-Liste (validateInput hat bereits
        // auf array_id geprueft).
        $hostids  = array_values(array_unique(array_map('strval',
            (array) $this->getInput('hostids', []))));
        $duration = (int) $this->getInput('duration', 3600);
        if (!$hostids || !isset(self::DURATIONS[$duration])) {
            $this->fail('Invalid input');
            return;
        }
        // Kein stilles Abschneiden: zu viele Hosts -> ablehnen, statt nur die
        // ersten MAX_HOSTS in Wartung zu nehmen (der Aufrufer soll es merken).
        if (count($hostids) > self::MAX_HOSTS) {
            $this->fail(sprintf('Zu viele Hosts (max. %d).', self::MAX_HOSTS));
            return;
        }

        // Permission-Check + Namen holen (Host.get ehrt die User-Rechte;
        // editable => nur Hosts mit Schreibrecht).
        $hosts = API::Host()->get([
            'output'       => ['hostid', 'host', 'name'],
            'hostids'      => $hostids,
            'editable'     => true,
            'preservekeys' => true,
        ]);
        // Kein stilles Teil-Ergebnis: jeder angeforderte Host muss vorhanden
        // UND editierbar sein — sonst abbrechen, sonst legte die Aktion
        // ueberraschend Wartung nur fuer die erlaubte Teilmenge an.
        if (count($hosts) !== count($hostids)) {
            $this->fail($hosts
                ? 'Mindestens ein Host wurde nicht gefunden oder darf nicht bearbeitet werden.'
                : 'Keine Schreibberechtigung fuer den/die Host(s).');
            return;
        }

        $now   = time();
        $label = self::DURATIONS[$duration];
        // Sprechender, eindeutiger Name (Zabbix verlangt Unique). Der Unique-Teil
        // ist Timestamp + Zufalls-Hex: Sekunden-Aufloesung allein kollidiert bei
        // Doppelklick, und ein langer Hostname wuerde bei End-Truncation den
        // Timestamp abschneiden. Darum den HOST-Teil vorab kappen (80 Zeichen),
        // damit der Unique-Teil garantiert erhalten bleibt (Gesamtlaenge < 128).
        $first  = reset($hosts);
        $suffix = count($hosts) > 1 ? sprintf(' +%d', count($hosts) - 1) : '';
        $uniq   = $now . '-' . bin2hex(random_bytes(3));
        $name   = sprintf('NT map: %s%s (%s) @%s',
            mb_substr((string) $first['host'], 0, 80), $suffix, $label, $uniq);
        if (mb_strlen($name) > 128) {
            $name = mb_substr($name, 0, 128);   // Backstop, greift praktisch nie
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
            // Nur saubere Zabbix-API-Meldungen durchreichen; andere Throwables
            // (DB/Schema/…) koennten interne Details enthalten. Empfaenger ist
            // zwar Admin, die Meldung soll aber trotzdem sauber bleiben.
            $this->fail($e instanceof \APIException
                ? $e->getMessage()
                : 'Wartung konnte nicht angelegt werden (interner Fehler).');
            return;
        }

        $maintenanceid = $res['maintenanceids'][0] ?? null;
        $this->jsonResponse([
            'ok'            => true,
            'maintenanceid' => $maintenanceid,
            'name'          => $name,
            'hosts'         => count($hosts),
            'label'         => $label,
        ]);
    }

    private function fail(string $msg): void {
        $this->jsonResponse(['error' => $msg]);
    }
}
