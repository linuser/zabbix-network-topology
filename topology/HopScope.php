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
        return self::scope($start, $hops, $edges, $links)['hostids'];
    }

    /**
     * Wie neighborhood(), aber mit BUDGET und Rechenschaft darüber.
     *
     * WARUM ES DAS BRAUCHT
     * --------------------
     * Sechs Hops von einem Switch erreichen auf einem Campus praktisch jedes
     * Gerät. Die Gruppenauswahl kappt bei 100 Gruppen und sagt es; der
     * Hop-Modus kappte gar nicht, und die anschliessende Anreicherung (Items,
     * Lastvalues, Trigger, Probleme) lief über alles — bis nginx nach 60 s
     * eine HTML-Fehlerseite schickte. Gemeldet in #22.
     *
     * Gekappt wird RINGWEISE, nicht an einer beliebigen Stelle der Liste: wer
     * "Host plus sechs Hops" waehlt und 400 Geraete bekommt, soll die Hops 1
     * bis k VOLLSTAENDIG sehen und erfahren, dass bei k Schluss war. Eine
     * halbe Kugelschale ist keine Nachbarschaft, sondern ein Zufallsschnitt.
     *
     * @param int $budget Obergrenze fuer die Hostzahl; 0 = unbegrenzt.
     *
     * @return array{hostids: array, hops_done: int, cut: bool}
     */
    public static function scope(string $start, int $hops, array $edges,
            array $links = [], int $budget = 0): array {
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

        // Ringweise statt mit einer Warteschlange: nur so laesst sich vor dem
        // naechsten Hop fragen, ob er noch ins Budget passt. Die Kosten sind
        // dieselben, jeder Knoten wird einmal angesehen.
        $depth     = [$start => 0];
        $ring      = [$start];
        $hops_done = 0;

        for ($d = 0; $d < $hops && $ring; $d++) {
            $naechster = [];
            foreach ($ring as $cur) {
                foreach (array_keys($adj[$cur] ?? []) as $nb) {
                    $nb = (string) $nb;
                    if (isset($depth[$nb])) {
                        continue;
                    }
                    $depth[$nb] = $d + 1;
                    $naechster[] = $nb;
                }
            }
            if (!$naechster) {
                break;
            }
            // Passt der ganze Ring nicht mehr, gilt er als nicht gelaufen:
            // die bis hierher gefundenen Hops bleiben vollstaendig.
            if ($budget > 0 && count($depth) > $budget) {
                foreach ($naechster as $nb) {
                    unset($depth[$nb]);
                }
                return [
                    'hostids'   => array_map('strval', array_keys($depth)),
                    'hops_done' => $hops_done,
                    'cut'       => true,
                ];
            }
            $ring = $naechster;
            $hops_done = $d + 1;
        }

        // PHP silently casts numeric-string array keys to int — map back so
        // the documented string contract holds regardless of id shape.
        return [
            'hostids'   => array_map('strval', array_keys($depth)),
            'hops_done' => $hops_done,
            'cut'       => false,
        ];
    }
}
