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
        $out  = [];
        $keys = self::keys($edges);

        foreach ($edges as $i => $e) {
            if ($keys[$i] === null) {
                continue;
            }

            $pair = [(string) ($e['from'] ?? ''), (string) ($e['to'] ?? '')];
            sort($pair);
            $ports = is_array($e['ports'] ?? null) ? $e['ports'] : [];
            $idx   = is_array($e['port_idx'] ?? null) ? $e['port_idx'] : [];

            $out[$keys[$i]] = [
                'a'  => $host_label($pair[0]),
                'b'  => $host_label($pair[1]),
                // Ports seitenrichtig: pa gehoert zu pair[0], pb zu pair[1].
                // Das Paar ist sortiert, die ports-Map ist nach hostid
                // geschluesselt — ohne diese Zuordnung waere ein Vergleich
                // sinnlos, weil dieselbe Verkabelung mal so und mal so
                // herum stuende.
                'pa' => (string) ($ports[$pair[0]] ?? ''),
                'pb' => (string) ($ports[$pair[1]] ?? ''),
                // Zusaetzlich der ifIndex, wo bekannt. Verglichen wird
                // vorrangig DIESER: das Label kann von "9" auf "Gi1/0/9"
                // wechseln, weil ein ifName-Item auftaucht oder ausfaellt —
                // ohne dass jemand ein Kabel angefasst hat. Ueber Labels
                // verglichen gaebe das einen falschen "umgesteckt"-Alarm, und
                // der schickt jemanden in den Serverraum.
                'ia' => (string) ($idx[$pair[0]] ?? ''),
                'ib' => (string) ($idx[$pair[1]] ?? ''),
            ];
        }

        return $out;
    }

    /**
     * Baseline key per edge, index-parallel to $edges; null = not tracked.
     *
     * A single link between two hosts keeps the key it always had,
     * "idA|idB" — so existing baselines, and the port-move detection that
     * relies on the key staying put when a cable is replugged, work as
     * before. PARALLEL links (a LAG, several cables) each get their own key,
     * "idA|idB#<port>": otherwise they would overwrite one another here, and
     * a failed LAG member could never be reported or drawn as ageing.
     *
     * The suffix is the member's port, ifIndex first (stable across label
     * changes, same reasoning as in movedPorts()).
     *
     * @return array<int|string, ?string>
     */
    public static function keys(array $edges): array {
        $pairs = [];
        $count = [];
        foreach ($edges as $i => $e) {
            // Die Internet-Wolke ist virtuell und wird pro Render neu
            // injiziert — sie waere sonst bei jedem Layoutwechsel "neu".
            if (!empty($e['_isInternetEdge'])) {
                $pairs[$i] = null;
                continue;
            }
            $pair = [(string) ($e['from'] ?? ''), (string) ($e['to'] ?? '')];
            sort($pair);
            $pk = $pair[0] . '|' . $pair[1];
            $pairs[$i] = [$pk, $pair];
            // A hosting edge (nt:parent) is not a cable and does not make a
            // physical link "parallel".
            if (($e['_type'] ?? '') !== 'hosts') {
                $count[$pk] = ($count[$pk] ?? 0) + 1;
            }
        }

        $out   = [];
        $taken = [];
        foreach ($edges as $i => $e) {
            if ($pairs[$i] === null) {
                $out[$i] = null;
                continue;
            }
            [$pk, $pair] = $pairs[$i];
            if (($count[$pk] ?? 0) <= 1 || ($e['_type'] ?? '') === 'hosts') {
                $out[$i] = $pk;
                continue;
            }
            $ports = is_array($e['ports'] ?? null) ? $e['ports'] : [];
            $idx   = is_array($e['port_idx'] ?? null) ? $e['port_idx'] : [];
            $sfx = '';
            foreach ([['i', $idx, 0], ['j', $idx, 1], ['p', $ports, 0], ['q', $ports, 1]] as [$tag, $src, $side]) {
                $v = (string) ($src[$pair[$side]] ?? '');
                if ($v !== '') {
                    $sfx = $tag . $v;
                    break;
                }
            }
            $k = $pk . '#' . $sfx;
            for ($n = 2; isset($taken[$k]); $n++) {
                $k = $pk . '#' . $sfx . '~' . $n;
            }
            $taken[$k] = true;
            $out[$i] = $k;
        }
        return $out;
    }

    /** The host-pair part of a key: "idA|idB#i3" -> "idA|idB". */
    public static function pairKey(string $k): string {
        $p = strpos($k, '#');
        return $p === false ? $k : substr($k, 0, $p);
    }

    /**
     * Carry baseline entries over to the key their link has NOW.
     *
     * The key of a link changes when a second cable joins it ("a|b" becomes
     * "a|b#i1" and "a|b#i2") or when a LAG shrinks back to one. It is the
     * same cable, and without this step the diff would report it as removed
     * and added in one go — and the ageing would put its old key back on the
     * map as a stale line next to the very link it is.
     *
     * Only renamed when the current key is absent from the baseline and the
     * ports prove the identity (sameLink). Anything else stays as it was.
     */
    private static function reconcile(array $baseline, array $current): array {
        $by_pair = [];
        foreach ($current as $ck => $_) {
            $by_pair[self::pairKey((string) $ck)][] = (string) $ck;
        }
        $out   = [];
        $taken = [];
        foreach ($baseline as $k => $e) {
            $pk = self::pairKey((string) $k);
            if (isset($current[$k]) || !is_array($e) || !isset($by_pair[$pk])) {
                $out[$k] = $e;
                continue;
            }
            $neu = null;
            foreach ($by_pair[$pk] as $ck) {
                if (!isset($baseline[$ck]) && !isset($taken[$ck]) && self::sameLink($e, $current[$ck])) {
                    $neu = $ck;
                    break;
                }
            }
            if ($neu === null) {
                $out[$k] = $e;
            } else {
                $out[$neu]   = $e;
                $taken[$neu] = true;
            }
        }
        return $out;
    }

    /** Do two entries of the same pair describe the same cable? */
    private static function sameLink(array $a, array $b): bool {
        if (!array_key_exists('pa', $a)) {
            return false;   // Altbestand ohne Ports: nicht entscheidbar
        }
        foreach (['ia', 'ib', 'pa', 'pb'] as $f) {
            $x = (string) ($a[$f] ?? '');
            $y = (string) ($b[$f] ?? '');
            if ($x !== '' && $y !== '') {
                return $x === $y;
            }
        }
        return false;
    }

    /**
     * Alternde Kanten: was verschwunden ist, aber noch nicht lange genug.
     *
     * WARUM ES DAS BRAUCHT
     * --------------------
     * Bisher galt: eine Kante wird gemeldet oder sie ist weg. LLDP-Tabellen
     * haben aber Aussetzer — ein Geraet startet neu, eine Discovery faellt
     * einmal aus, ein Poll kommt zu frueh. Die Karte sprang dann jedes Mal:
     * Kante weg, Toast, naechster Poll, Kante wieder da, Toast. Das macht die
     * Aenderungsmeldung wertlos, weil man sie nach dem dritten Fehlalarm
     * ignoriert.
     *
     * UND ES BEANTWORTET DIE OFFENE FRAGE BEIM TOPOLOGY-DIFF
     * -----------------------------------------------------
     * "Eine verschwundene Kante existiert nicht mehr — wie lange zeichnet man
     * sie?" Genau so lange, wie sie altern darf. Beides ist dieselbe Frage,
     * und getrennt gebaut ergaebe es zwei halbe Antworten.
     *
     * ALTBESTAND
     * ----------
     * Eintraege ohne Zeitstempel stammen aus der Zeit vor dieser Funktion.
     * Sie werden NICHT wiederbelebt: sonst zoege die erste Abfrage nach einem
     * Update jede laengst verschwundene Kante als "stale" zurueck auf die
     * Karte. Dieselbe Ueberlegung wie bei den Ports ohne Zeitstempel.
     *
     * @param int $now  Zeitstempel, als Parameter fuer testbare Alterung
     * @param int $ttl  Sekunden, die eine Kante ueberlebt
     * @return array{store: array, stale: array}
     */
    public static function ageOut(?array $baseline, array $current, int $now, int $ttl): array {
        $store = [];
        $stale = [];
        if ($baseline !== null) {
            $baseline = self::reconcile($baseline, $current);
        }

        foreach ($current as $k => $e) {
            $e['seen'] = $now;
            // Wann diese Kante zum ERSTEN Mal gesehen wurde. Gegenstueck zur
            // Alterung: so wie eine verschwundene Kante eine Weile stehen
            // bleibt, ist eine neue eine Weile als neu erkennbar. Beim
            // Wiederauftauchen wird der Wert bewusst NICHT uebernommen — eine
            // Kante, die weg war und zurueckkommt, ist wieder neu.
            // OHNE Baseline gibt es keinen Vergleichspunkt, also ist NICHTS
            // neu — genauso wie compare() beim ersten Lauf nichts meldet.
            //
            // Ohne diese Unterscheidung bekaeme beim ersten Poll jede Kante
            // 'first = jetzt' und die ganze Karte leuchtete gruen. Ohne APCu
            // liefert NtCache::get() IMMER null, dort waere es also der
            // Dauerzustand — und bei jedem Wechsel der Gruppenauswahl
            // ebenfalls, weil der Cache-Schluessel die Gruppen enthaelt.
            $vorher = $baseline[$k] ?? null;
            if ($baseline === null) {
                unset($e['first']);
            } else {
                $e['first'] = (is_array($vorher) && empty($vorher['stale']) && !empty($vorher['first']))
                    ? (int) $vorher['first']
                    : $now;
            }
            $store[$k] = $e;
        }

        foreach (($baseline ?? []) as $k => $e) {
            if (isset($current[$k]) || !is_array($e)) {
                continue;
            }
            $seen = (int) ($e['seen'] ?? 0);
            if ($seen <= 0 || ($now - $seen) > $ttl) {
                continue;   // ohne Zeitstempel oder zu alt -> endgueltig weg
            }
            // seen NICHT auffrischen: sonst altert die Kante nie und bliebe
            // fuer immer auf der Karte stehen.
            //
            // Die Markierung ist noetig, weil die alternde Kante im Speicher
            // BLEIBT: ohne sie faende compare() sie bei jedem folgenden Poll
            // erneut "in der Baseline, aber nicht aktuell" und meldete sie
            // wieder und wieder als verschwunden.
            $e['stale'] = true;
            $store[$k] = $e;
            $stale[$k] = $e;
        }

        return ['store' => $store, 'stale' => $stale];
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
        $baseline = self::reconcile($baseline, $current);

        foreach ($current as $k => $now) {
            // Ein alternder Eintrag zaehlt hier als NICHT vorhanden: die Kante
            // war weg, ist zurueck, und das ist eine Nachricht. Sonst
            // widersprechen sich Karte und Meldung — die Karte zeigt sie als
            // neu (ageOut setzt 'first' zurueck), der Toast schwiege.
            $vorhanden = isset($baseline[$k])
                && !(is_array($baseline[$k]) && !empty($baseline[$k]['stale']));
            if (!$vorhanden) {
                // Der Schluessel traegt die Host-IDs ("idA|idB"). Ohne ihn
                // liefert der Diff nur Labels, und die Karte kann die
                // betroffene Kante nicht finden — genau das stand dem
                // Hervorheben auf der Karte im Weg.
                $res['added'][] = ['a' => $now['a'], 'b' => $now['b'], 'k' => $k];
                continue;
            }

            $was = $baseline[$k];
            $m   = self::movedPorts($was, $now);

            if ($m !== null) {
                $res['moved'][] = $m;
            }
        }

        foreach ($baseline as $k => $was) {
            // Bereits als alternd gemeldete Kanten nicht erneut melden — sie
            // stehen noch auf der Karte und wurden beim Verschwinden angesagt.
            if (is_array($was) && !empty($was['stale'])) {
                continue;
            }
            if (!isset($current[$k])) {
                $res['removed'][] = [
                    'a' => self::label($was, 'a', 0),
                    'b' => self::label($was, 'b', 1),
                    'k' => $k,
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
        // Der spaeter hinzugekommene Zeitstempel 'seen' zaehlt hier NICHT als
        // Feld — verglichen werden nur die Ports.
        if (!is_array($was) || !array_key_exists('pa', $was)) {
            return null;
        }

        $changed = [];
        foreach ([['pa', 'a', 'ia'], ['pb', 'b', 'ib']] as $seite) {
            // Vorrang hat der ifIndex; nur wo er auf BEIDEN Staenden fehlt,
            // bleibt der Label-Vergleich als Rueckfall. So loest ein Label-
            // Wechsel bei gleichem Index keinen Alarm mehr aus.
            $iv = (string) ($was[$seite[2]] ?? '');
            $in = (string) ($now[$seite[2]] ?? '');
            if ($iv !== '' && $in !== '') {
                if ($iv === $in) {
                    continue;   // selber Port, egal wie er gerade heisst
                }
                $changed[] = [
                    'host' => (string) ($now[$seite[1]] ?? ''),
                    'from' => (string) ($was[$seite[0]] ?? $iv),
                    'to'   => (string) ($now[$seite[0]] ?? $in),
                ];
                continue;
            }

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
