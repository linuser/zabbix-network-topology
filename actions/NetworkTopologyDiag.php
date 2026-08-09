<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Actions;

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
        $uid = (int) (\CWebUser::$data['userid'] ?? 0);
        $entries = [];
        $apcu = function_exists('apcu_fetch');
        if ($apcu && $uid > 0) {
            $ok = false;
            $arr = apcu_fetch(self::KEY_PREFIX . $uid, $ok);
            if ($ok && is_array($arr)) {
                $entries = $arr;
            }
        }
        $this->jsonResponse([
            'entries' => array_values(array_slice($entries, -self::MAX_ENTRIES)),
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
        if (!function_exists('apcu_fetch')) return;
        $uid = (int) (\CWebUser::$data['userid'] ?? 0);
        if ($uid === 0) return;
        $key = self::KEY_PREFIX . $uid;
        $ok  = false;
        $arr = apcu_fetch($key, $ok);
        if (!$ok || !is_array($arr)) $arr = [];
        $entry['ts'] = time();
        $arr[] = $entry;
        if (count($arr) > self::MAX_ENTRIES) {
            $arr = array_slice($arr, -self::MAX_ENTRIES);
        }
        apcu_store($key, $arr, self::TTL);
    }
}
