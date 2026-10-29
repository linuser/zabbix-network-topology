<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * ExpectedLinks — haelt die ERWARTETE Verkabelung (nt:expect-Tag) gegen die
 * GEMESSENE (LLDP/CDP-Adjazenz) und meldet die Abweichungen. Fuer umgesteckte
 * Kabel, versehentlich getrennte Verbindungen und Arbeiten von Fremdfirmen die
 * nuetzlichste Auskunft, die die Karte geben kann.
 *
 * Rein, kein Zabbix/DB/HTTP — damit testbar. Der Controller loest die Namen zu
 * Hostids auf und baut die gemessene Adjazenz aus den LLDP/CDP-Kanten; hier
 * passiert nur der Vergleich.
 *
 * ABGLEICH AUF HOST-EBENE, bewusst. nt:expect=core01 heisst "dieser Host sollte
 * an core01 haengen". Gemessen wird, OB A und B ueberhaupt per LLDP/CDP
 * benachbart sind — nicht an welchem Port. Der Port aus dem Tag (nt:expect=
 * core01/Gi1/0/1) wird mitgefuehrt und angezeigt, aber nicht zum Abgleich
 * benutzt: der haeufige Fehler ist "an den FALSCHEN Switch gesteckt", und den
 * faengt schon der Host-Vergleich. Port-genauer Abgleich waere eine Verfeinerung.
 *
 * Drei moegliche Lagen, zwei davon ein Befund:
 *   erwartet UND gemessen        ✓  ok (kein Eintrag, kein Laerm)
 *   erwartet, A hat ANDERE        ⚠  misconnected ("erwartet B, tatsaechlich X")
 *   erwartet, A hat GAR KEINE     ⚠  not_seen (ab-/ausgefallen oder meldet nichts)
 *
 * Der dritte ROADMAP-Zustand ("gemessen, nicht dokumentiert") fehlt bewusst: er
 * flutet, solange nicht die KOMPLETTE Soll-Topologie getaggt ist. Spaeter als
 * Opt-in.
 */
final class ExpectedLinks {

    /**
     * @param array<string,list<array{host:string,port:string}>> $host_expect
     *        hid => erwartete Nachbarn (Rohname + optionaler Port aus dem Tag).
     * @param array<string,string> $name_to_id  kleingeschriebener Name => hid
     *        (technischer Name und Anzeigename, wie in parentEdges()).
     * @param array<string,array<string,bool>> $measured_adj
     *        hid => Menge der per LLDP/CDP benachbarten hids (UNGERICHTET: beide
     *        Richtungen gesetzt).
     * @param array<string,string> $labels  hid => Anzeigename (fuer das "tatsaechlich X").
     * @return array{deviations:list<array{from:string,to:string,expected:string,port:string,status:string,actual:list<string>}>,expected:int,matched:int}
     *         Nur abweichende Erwartungen in 'deviations'. from=Host mit dem Tag,
     *         to=aufgeloeste Nachbar-hid ('' wenn der Name nicht in der Ansicht liegt).
     */
    public static function compare(array $host_expect, array $name_to_id,
                                   array $measured_adj, array $labels): array {
        $deviations = [];
        $expected   = 0;
        $matched    = 0;

        foreach ($host_expect as $hid => $wants) {
            $hid = (string) $hid;
            foreach ($wants as $w) {
                $ref = strtolower(trim((string) ($w['host'] ?? '')));
                if ($ref === '') {
                    continue;
                }
                $nid  = $name_to_id[$ref] ?? null;
                // Selbstreferenz ist kein sinnvolles Soll — still verwerfen,
                // nicht als Abweichung zaehlen.
                if ($nid !== null && (string) $nid === $hid) {
                    continue;
                }
                $expected++;

                // Treffer: der erwartete Nachbar ist aufgeloest UND gemessen.
                if ($nid !== null && isset($measured_adj[$hid][(string) $nid])) {
                    $matched++;
                    continue;
                }

                // Abweichung: was hat A tatsaechlich gemessen?
                $actual = [];
                foreach (array_keys($measured_adj[$hid] ?? []) as $aid) {
                    $actual[] = (string) ($labels[$aid] ?? $aid);
                }
                sort($actual);
                $deviations[] = [
                    'from'     => $hid,
                    'to'       => $nid !== null ? (string) $nid : '',
                    'expected' => (string) $w['host'],      // Rohname fuers Label
                    'port'     => (string) ($w['port'] ?? ''),
                    'status'   => $actual ? 'misconnected' : 'not_seen',
                    'actual'   => $actual,
                ];
            }
        }

        return ['deviations' => $deviations, 'expected' => $expected, 'matched' => $matched];
    }

    /**
     * Baut aus einer Kantenliste die UNGERICHTETE LLDP/CDP-Adjazenz, die
     * compare() erwartet. Nur gemessene Nachbarschaften zaehlen — Hosting-
     * (nt:parent) und gezeichnete Uplink-Kanten (nt:uplink) sind keine
     * Messung und bleiben draussen.
     *
     * @param list<array<string,mixed>> $edges  LLDP/CDP-Kanten (from/to = hid).
     * @return array<string,array<string,bool>>
     */
    public static function adjacency(array $edges): array {
        $adj = [];
        foreach ($edges as $e) {
            $a = (string) ($e['from'] ?? $e['source'] ?? '');
            $b = (string) ($e['to']   ?? $e['target'] ?? '');
            if ($a === '' || $b === '' || $a === $b) {
                continue;
            }
            $adj[$a][$b] = true;
            $adj[$b][$a] = true;
        }
        return $adj;
    }
}
