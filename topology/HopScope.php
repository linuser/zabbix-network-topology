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
     *               Ordered by hop distance (BFS order) — cap() relies on it.
     */
    public static function neighborhood(string $start, int $hops, array $edges, array $links = []): array {
        // PHP silently casts numeric-string array keys to int — map back so
        // the documented string contract holds regardless of id shape.
        return array_map('strval', array_keys(self::distances($start, $hops, $edges, $links)));
    }

    /**
     * Like neighborhood(), but keeps the hop distance: hostid => hops from
     * $start, in BFS order (nearest first). Numeric ids come back as int
     * KEYS — that is PHP, not a choice; read them through strval().
     *
     * @return array<int|string, int>
     */
    public static function distances(string $start, int $hops, array $edges, array $links = []): array {
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

        return $depth;
    }

    /**
     * Cut a distance map down to the $max nearest hosts.
     *
     * Why a cap at all: host + 6 hops on a large campus or WAN is, in
     * practice, the whole network — and in host+hops mode no group cap
     * applies. The full enrichment pipeline then ran over thousands of hosts
     * until nginx gave up (504), and the browser only reported that an HTML
     * page "is not valid JSON". A customer install hit exactly that on 5.3.0.
     *
     * Because $dist is in BFS order, keeping the head of the list keeps the
     * nearest hosts: every ring below the first dropped host is complete.
     *
     * @param array<int|string, int> $dist hostid => hop distance, BFS order
     * @param int                $max  upper bound (>= 1)
     *
     * @return array{hostids: string[], total: int, truncated: bool, complete_hops: int}
     *               complete_hops = the largest distance up to which EVERY
     *               host is included (only meaningful when truncated).
     */
    public static function cap(array $dist, int $max): array {
        $ids   = array_map('strval', array_keys($dist));
        $total = count($ids);
        if ($total <= $max) {
            return ['hostids' => $ids, 'total' => $total, 'truncated' => false,
                    'complete_hops' => $total ? (int) max($dist) : 0];
        }
        $first_dropped = (int) array_values($dist)[$max];
        return ['hostids' => array_slice($ids, 0, $max), 'total' => $total, 'truncated' => true,
                'complete_hops' => max(0, $first_dropped - 1)];
    }
}
