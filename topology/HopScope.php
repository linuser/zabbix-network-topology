<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * HopScope
 *
 * Depth-limited BFS over the discovered edge graph — the server-side core of
 * the "one host + N hops" view. Kept free of API calls and controller state
 * on purpose, same as the other topology/ classes: edge records in, hostid
 * list out, testable with synthetic graphs (see tests/HopScopeTest.php).
 *
 * The graph is treated as undirected: an LLDP edge is reported by ONE side,
 * a hosts edge (nt:parent) points parent→child — for the question "what
 * hangs within N hops of this device?" the direction is irrelevant either
 * way. Manual links are real topology drawn by a user and count as hops too.
 */
final class HopScope {

    /**
     * @param string $start start hostid
     * @param int    $hops  maximum hop distance (>= 1)
     * @param array  $edges edge records carrying 'from'/'to' (LLDP/CDP/hosts)
     * @param array  $links manual links carrying 's'/'t' (shared + personal)
     *
     * @return array hostids (strings) within $hops of $start, incl. $start
     *               itself. $start not appearing in any edge yields [$start].
     */
    public static function neighborhood(string $start, int $hops, array $edges, array $links = []): array {
        $adj = [];
        $add = static function ($a, $b) use (&$adj): void {
            $a = (string) $a;
            $b = (string) $b;
            if ($a === '' || $b === '' || $a === $b) {
                return;
            }
            $adj[$a][$b] = true;
            $adj[$b][$a] = true;
        };
        foreach ($edges as $e) {
            $add($e['from'] ?? '', $e['to'] ?? '');
        }
        foreach ($links as $l) {
            $add($l['s'] ?? '', $l['t'] ?? '');
        }

        // depth[id] = hop distance to $start; expand only below the limit.
        // Queue via index pointer — array_shift() is O(n) per call and this
        // can see thousands of nodes on large installs.
        $depth = [$start => 0];
        $queue = [$start];
        for ($qi = 0; $qi < count($queue); $qi++) {
            $cur = $queue[$qi];
            $d   = $depth[$cur];
            if ($d >= $hops) {
                continue;
            }
            foreach (array_keys($adj[$cur] ?? []) as $nb) {
                $nb = (string) $nb;
                if (isset($depth[$nb])) {
                    continue;
                }
                $depth[$nb] = $d + 1;
                $queue[] = $nb;
            }
        }

        // PHP silently casts numeric-string array keys to int — map back so
        // the documented string contract holds regardless of id shape.
        return array_map('strval', array_keys($depth));
    }
}
