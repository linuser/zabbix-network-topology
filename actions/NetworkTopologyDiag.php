<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Actions;

use Modules\NetworkTopology\Topology\DiagLog;

/**
 * NetworkTopologyDiag
 *
 * Admin-Diagnose: liefert die letzten ~50 Aufrufe der Topology-Actions
 * (Data/History/Items/DiscoverPatterns/Spark) aus dem APCu-Ring-Buffer
 * pro User. Pro Eintrag: action, elapsed_ms, bytes, cache_hit, counts.
 *
 * Request: GET (kein Body).
 * Response: { entries: [...], apcu: true|false, uid: <int> }
 *
 * Zugriff: nur Super-Admin (USER_TYPE_SUPER_ADMIN). Kein Daten-Leak: jeder
 * User sieht nur seine eigenen Aufrufe (Bucket per User-ID).
 */
class NetworkTopologyDiag extends NetworkTopologyController {

    private const MAX_ENTRIES = 50;

    /**
     * Wie viele Slots die lauten Aktionen bekommen. Der Rest — welche das
     * sind und warum — steht in Topology\DiagLog, wo es pruefbar ist.
     */
    private const MAX_LAUT = 10;
    private const KEY_PREFIX  = 'nt_diag_';
    private const TTL         = 3600;   // 1h Buffer-Lebensdauer

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        return $this->requireAjax();
    }

    protected function checkPermissions(): bool {
        // Nur Super-Admins duerfen den Diag-Buffer sehen. ZABBIX_ADMIN ist
        // ein normaler Admin pro-Hostgroup; SUPER_ADMIN ist instance-wide.
        // Der Buffer enthaelt Backend-Performance-Daten (Cache-Hit-Rate,
        // Latenzen, Counts) die wir nicht jedem Hostgroup-Admin geben wollen.
        return $this->getUserType() === USER_TYPE_SUPER_ADMIN;
    }

    protected function doAction(): void {
        if (!$this->throttle('diag')) {
            return;
        }

        $uid = (int) (\CWebUser::$data['userid'] ?? 0);
        $entries = [];
        $apcu = function_exists('apcu_fetch');

        if ($apcu && $uid > 0) {
            // Alle Slots einsammeln. Abgelaufene fehlen einfach — die TTL
            // raeumt sie weg, ohne dass hier etwas aufzuraeumen waere.
            $keys = [];
            for ($i = 0; $i < self::MAX_ENTRIES; $i++) {
                $keys[] = self::KEY_PREFIX . $uid . '_' . $i;
            }
            for ($i = 0; $i < self::MAX_LAUT; $i++) {
                $keys[] = self::KEY_PREFIX . $uid . '_l' . $i;
            }
            $found = apcu_fetch($keys);
            if (is_array($found)) {
                foreach ($found as $e) {
                    if (is_array($e)) {
                        $entries[] = $e;
                    }
                }
            }
            $entries = DiagLog::nachZeitSortiert($entries);
        }

        $this->jsonResponse([
            'entries' => array_values(array_slice($entries, -(self::MAX_ENTRIES + self::MAX_LAUT))),
            'apcu'    => $apcu,
            'uid'     => $uid,
        ]);
    }

    /**
     * Static-Helper, wird von den anderen Actions am Ende von doAction()
     * gerufen. Schreibt einen Eintrag in den per-User-Ring-Buffer.
     * Erfordert apcu — degradiert silent zu no-op wenn nicht verfuegbar.
     */
    public static function record(array $entry): void {
        if (!function_exists('apcu_inc') || !function_exists('apcu_store')) return;
        $uid = (int) (\CWebUser::$data['userid'] ?? 0);
        if ($uid === 0) return;

        // Echter Ringpuffer statt fetch -> append -> store.
        //
        // Die alte Fassung las das ganze Array, haengte an und schrieb es
        // zurueck. Zwei gleichzeitige Requests lasen dabei denselben Stand und
        // der zweite ueberschrieb den Eintrag des ersten — bei einem Modul,
        // dessen Karte alle 30 s parallel mehrere Actions ruft, ist das kein
        // theoretischer Fall. Fuer Diagnosedaten war der Verlust verschmerzbar,
        // aber ein Puffer, der ausgerechnet unter Last Eintraege verliert, ist
        // dort am unzuverlaessigsten, wo man ihn braucht.
        //
        // Jetzt: apcu_inc vergibt atomar eine laufende Nummer, jeder Eintrag
        // bekommt seinen eigenen Slot. Zwei Requests schreiben nie in
        // denselben Schluessel, es gibt nichts zu ueberschreiben.
        // Signatur: apcu_inc(key, step, &$success, ttl). Ein fehlender
        // Schluessel wird dabei angelegt und auf $step gesetzt.
        $laut    = DiagLog::istLaut((string) ($entry['action'] ?? ''));
        $success = false;
        $seq = apcu_inc(self::KEY_PREFIX . ($laut ? 'lseq_' : 'seq_') . $uid,
                        1, $success, self::TTL);
        if ($seq === false || !$success) return;

        $entry['ts']  = time();
        $entry['seq'] = $seq;

        // Lauteste Aktionen in ihren eigenen Ring. Sie zaehlen in der
        // Zusammenfassung weiter mit, verdraengen aber nichts mehr.
        apcu_store(
            self::KEY_PREFIX . $uid . ($laut ? '_l' : '_')
                . ($seq % ($laut ? self::MAX_LAUT : self::MAX_ENTRIES)),
            $entry,
            self::TTL
        );
    }
}
