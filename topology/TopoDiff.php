<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * TopoDiff — Topologie-Stand vergleichen: neu, verschwunden, umgesteckt.
 *
 * WARUM DAS HIER LIEGT UND NICHT MEHR IN DER ACTION
 * -------------------------------------------------
 * Der Diff war als Inline-Block in NetworkTopologyData eingebaut und damit
 * nicht testbar — die Action braucht Zabbix. Es ist aber reine Logik ohne jede
 * Abhaengigkeit, gehoert also hierher, wie die anderen Klassen in topology/.
 * Der Anlass war die Port-Move-Erkennung: eine Fallunterscheidung mehr in
 * ungetestetem Code waere die falsche Richtung gewesen.
 *
 * WAS PORT-MOVE HEISST UND WARUM ES VORHER FEHLTE
 * ----------------------------------------------
 * Die Baseline schluesselte auf das Host-PAAR und merkte sich nur die Labels:
 *
 *     $current["idA|idB"] = [labelA, labelB];
 *
 * Steckt jemand ein Geraet auf einen anderen Port DESSELBEN Switches um,
 * bleibt das Paar gleich. Also weder added noch removed, also keine Meldung —
 * ausgerechnet der Fall, der betrieblich am interessantesten ist:
 *
 *     AP-07  SW01 Gi1/0/18  ->  SW01 Gi1/0/22
 *
 * Der Wert traegt jetzt zusaetzlich die Ports, und es gibt eine dritte
 * Kategorie 'moved'.
 *
 * ALTBESTAND IN DER BASELINE
 * --------------------------
 * Die Baseline liegt sieben Tage im Cache. Nach einem Update stehen dort also
 * noch Eintraege in der ALTEN Form [labelA, labelB] — ohne Ports. Die duerfen
 * nicht als "umgesteckt" gemeldet werden, sonst meldet die erste Abfrage nach
 * dem Update jede Kante des Netzes als Bewegung. Fehlen die Ports auf einer
 * der beiden Seiten, gilt der Vergleich schlicht als nicht entscheidbar.
 */
class TopoDiff {

    /**
     * Baut den Vergleichsstand aus den Kanten.
     *
     * @param array    $edges       Kanten wie von LldpEdgeBuilder
     * @param callable $host_label  hostid -> Anzeigename
     * @return array   "idA|idB" => ['a'=>label, 'b'=>label, 'pa'=>port, 'pb'=>port]
     */
    public static function snapshot(array $edges, callable $host_label): array {
        $out = [];

        foreach ($edges as $e) {
            // Die Internet-Wolke ist virtuell und wird pro Render neu
            // injiziert — sie waere sonst bei jedem Layoutwechsel "neu".
            if (!empty($e['_isInternetEdge'])) {
                continue;
            }

            $pair = [(string) ($e['from'] ?? ''), (string) ($e['to'] ?? '')];
            sort($pair);
            $ports = is_array($e['ports'] ?? null) ? $e['ports'] : [];

            $out[$pair[0] . '|' . $pair[1]] = [
                'a'  => $host_label($pair[0]),
                'b'  => $host_label($pair[1]),
                // Ports seitenrichtig: pa gehoert zu pair[0], pb zu pair[1].
                // Das Paar ist sortiert, die ports-Map ist nach hostid
                // geschluesselt — ohne diese Zuordnung waere ein Vergleich
                // sinnlos, weil dieselbe Verkabelung mal so und mal so
                // herum stuende.
                'pa' => (string) ($ports[$pair[0]] ?? ''),
                'pb' => (string) ($ports[$pair[1]] ?? ''),
            ];
        }

        return $out;
    }

    /**
     * Vergleicht zwei Staende.
     *
     * @return array{added: array, removed: array, moved: array}
     */
    public static function compare(?array $baseline, array $current): array {
        $res = ['added' => [], 'removed' => [], 'moved' => []];

        if (!is_array($baseline)) {
            return $res;
        }

        foreach ($current as $k => $now) {
            if (!isset($baseline[$k])) {
                $res['added'][] = ['a' => $now['a'], 'b' => $now['b']];
                continue;
            }

            $was = $baseline[$k];
            $m   = self::movedPorts($was, $now);

            if ($m !== null) {
                $res['moved'][] = $m;
            }
        }

        foreach ($baseline as $k => $was) {
            if (!isset($current[$k])) {
                $res['removed'][] = [
                    'a' => self::label($was, 'a', 0),
                    'b' => self::label($was, 'b', 1),
                ];
            }
        }

        return $res;
    }

    /**
     * Hat sich an DIESER Kante ein Port geaendert?
     *
     * Gibt null zurueck, wenn nichts entschieden werden kann — das ist der
     * Normalfall bei Altbestand ohne Ports und bei Geraeten, die gar keine
     * Portnamen melden. Lieber nichts sagen als etwas Falsches.
     */
    private static function movedPorts($was, array $now): ?array {
        // Altbestand: numerisch indiziertes [labelA, labelB], keine Ports.
        if (!is_array($was) || !array_key_exists('pa', $was)) {
            return null;
        }

        $changed = [];
        foreach ([['pa', 'a'], ['pb', 'b']] as $seite) {
            $vorher  = (string) ($was[$seite[0]] ?? '');
            $nachher = (string) ($now[$seite[0]] ?? '');

            // Ein leerer Wert auf EINER Seite heisst nicht "umgesteckt",
            // sondern "unbekannt": das Geraet meldet den Port nicht mehr
            // (oder erstmals). Ein Wechsel von "" auf "Gi1/0/5" ist ein
            // Datenzuwachs, keine Bewegung am Kabel.
            if ($vorher === '' || $nachher === '' || $vorher === $nachher) {
                continue;
            }

            $changed[] = [
                'host' => (string) ($now[$seite[1]] ?? ''),
                'from' => $vorher,
                'to'   => $nachher,
            ];
        }

        if (!$changed) {
            return null;
        }

        return [
            'a'     => (string) ($now['a'] ?? ''),
            'b'     => (string) ($now['b'] ?? ''),
            'ports' => $changed,
        ];
    }

    /** Label aus altem (numerisch) oder neuem (assoziativ) Eintrag holen. */
    private static function label($entry, string $key, int $idx): string {
        if (!is_array($entry)) {
            return '';
        }
        return (string) ($entry[$key] ?? $entry[$idx] ?? '');
    }
}
