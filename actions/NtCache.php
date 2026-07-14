<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

/**
 * NtCache
 *
 * Zentrale APCu-Schicht fuer die Read-Actions (Review #11). Vorher baute jede
 * Action ihren Key selbst ('nt_fc_'.$uid.'_'.md5(...)) mit eigener TTL —
 * divergierend und vor allem OHNE Schema-Version: nach einem Modul-Update
 * konnten strukturell veraltete Eintraege weiterbedient werden, bis ihre TTL
 * ablief.
 *
 * Der Key enthaelt jetzt immer:
 *   - SCHEMA        → ein Bump invalidiert schlagartig ALLE Eintraege
 *   - Namespace     → die Action
 *   - User-ID       → Permissions sind userabhaengig; NIE user-uebergreifend
 *                     cachen, sonst leakt ein Ergebnis ueber Rechtegrenzen
 *   - normalisierte Bestandteile (sortierte IDs, Zeitraum, …) — die Reihenfolge
 *     der IDs darf den Key nicht veraendern, sonst cacht man dieselbe Anfrage
 *     mehrfach
 *
 * Beispiel:  nt:v1:capacity:42:7,12,15:30
 *
 * Ohne APCu (oder ohne eingeloggten User) ist alles ein No-Op: get() liefert
 * null, set() verwirft. Die Actions rechnen dann jedes Mal frisch und
 * funktionieren normal weiter (fail-open).
 */
final class NtCache {

    /**
     * Cache-Schema-Version. BUMPEN, sobald sich die Struktur eines gecachten
     * Payloads aendert — sonst bedient ein frisch deploytes Modul noch alte
     * Eintraege aus dem laufenden APCu.
     */
    private const SCHEMA = 'v1';

    /** Laenge, ab der die Key-Bestandteile gehasht werden (APCu-Keys kurz halten). */
    private const MAX_TAIL = 120;

    /**
     * Baut den Key. Arrays werden sortiert + kommasepariert, damit
     * [7,12] und [12,7] denselben Key ergeben.
     */
    private static function key(string $namespace, int $userid, array $parts): string {
        $flat = [];
        foreach ($parts as $p) {
            if (is_array($p)) {
                $p = array_map('strval', $p);
                sort($p);
                $p = implode(',', $p);
            }
            $flat[] = (string) $p;
        }
        $tail = implode(':', $flat);
        if (strlen($tail) > self::MAX_TAIL) {
            $tail = 'h' . md5($tail);   // z.B. 500 itemids
        }

        return 'nt:' . self::SCHEMA . ':' . $namespace . ':' . $userid . ':' . $tail;
    }

    /** Aktuelle User-ID; 0 = kein eingeloggter User → nicht cachen. */
    private static function uid(): int {
        return (int) (\CWebUser::$data['userid'] ?? 0);
    }

    /**
     * Cache-Wert oder null (Miss / kein APCu / kein User).
     */
    public static function get(string $namespace, array $parts) {
        $uid = self::uid();
        if ($uid <= 0 || !function_exists('apcu_fetch')) {
            return null;
        }
        $ok  = false;
        $val = apcu_fetch(self::key($namespace, $uid, $parts), $ok);

        return $ok ? $val : null;
    }

    /**
     * Wert ablegen. No-Op ohne APCu/User.
     */
    public static function set(string $namespace, array $parts, $value, int $ttl): void {
        $uid = self::uid();
        if ($uid <= 0 || !function_exists('apcu_store')) {
            return;
        }
        apcu_store(self::key($namespace, $uid, $parts), $value, $ttl);
    }

    /**
     * Alle Eintraege eines Users verwerfen (z.B. nach einer Rechteaenderung,
     * damit kein Ergebnis aus der Zeit mit mehr Rechten weiterlebt).
     */
    public static function deleteByUser(int $userid): void {
        if (!function_exists('apcu_delete') || !class_exists('\APCUIterator')) {
            return;
        }
        $pattern = '/^' . preg_quote('nt:' . self::SCHEMA . ':', '/')
            . '[^:]+' . preg_quote(':' . $userid . ':', '/') . '/';
        apcu_delete(new \APCUIterator($pattern));
    }
}
