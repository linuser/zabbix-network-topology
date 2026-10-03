<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * Zwei Entscheidungen des Diagnose-Ringpuffers, ohne Zabbix drumherum.
 *
 * Sie standen in NetworkTopologyDiag, wo sie niemand pruefen konnte: die
 * Action erbt von einer Zabbix-Basisklasse, und kein Test in diesem Projekt
 * laedt actions/. Beide Entscheidungen sind aber reine Logik, und beide waren
 * falsch — was man ihnen eine Stunde lang nicht ansah.
 */
class DiagLog {

    /**
     * Aktionen, die beim blossen ANSEHEN der Karte anfallen.
     *
     * 'spark' faellt bei jedem Ueberfahren eines Knotens an. Auf der
     * Lasttest-Karte reichten ein paar Sekunden Mausbewegung fuer 35 Stueck,
     * und der Ring fasst 50: die teuren data-Eintraege fielen von vier auf
     * zwei, waehrend man auf den Tab sah. Sie bekommen deshalb einen eigenen
     * Slot-Raum mit eigenem Zaehler und verdraengen nichts mehr.
     */
    private const LAUT = ['spark' => true];

    public static function istLaut(string $action): bool {
        return isset(self::LAUT[$action]);
    }

    /**
     * Eintraege in zeitliche Reihenfolge bringen — nach dem Zeitstempel,
     * nicht nach der laufenden Nummer.
     *
     * Die Nummer taugt dafuer nicht. apcu_inc nimmt seine TTL NUR beim
     * Anlegen des Schluessels: der Zaehler laeuft nach einer Stunde ab, so
     * fleissig er auch benutzt wird, und faengt wieder bei 1 an. Alles Neue
     * traegt danach kleinere Nummern als alles Alte und rutscht ans ENDE der
     * Liste. Die Anzeige sieht dann eingefroren aus, waehrend sie munter
     * weiterschreibt — genau so aufgefallen: die oberste Zeile blieb
     * dieselbe, obwohl die Zusammenfassung drei neue Aufrufe zaehlte.
     *
     * Seit die lauten Aufrufe ihren eigenen Zaehler haben, waeren die Nummern
     * ohnehin nicht mehr untereinander vergleichbar.
     *
     * Die Nummer bleibt als ZWEITES Kriterium: innerhalb derselben Sekunde
     * ist sie das Einzige, was die Reihenfolge noch kennt.
     *
     * @param array $entries
     * @return array aufsteigend, aeltester zuerst
     */
    /**
     * ── TAGESAGGREGATION ─────────────────────────────────────────────────
     *
     * Der Ring haelt eine Stunde. Damit laesst sich sagen, wie lange die
     * Karte GERADE braucht, aber nicht, ob sie seit dem letzten Update
     * langsamer geworden ist — und das ist die Frage, die ein Betreiber nach
     * einem Update wirklich hat.
     *
     * Gezaehlt werden NUR die Aufrufe, die wirklich gerechnet haben. Ein
     * Cache-Treffer dauert 20 ms statt 1600 und wuerde den Tagesschnitt
     * danach verschieben, wie viele Leute zugesehen haben — nicht, wie
     * schnell die Karte ist.
     *
     * ATOMARE ZAEHLER, KEIN LESEN-AENDERN-SCHREIBEN. Genau daran hat der
     * Ringpuffer hier schon einmal Eintraege verloren: zwei gleichzeitige
     * Requests lasen denselben Stand, der zweite ueberschrieb den ersten.
     * apcu_inc erhoeht atomar; zwei Requests koennen sich nicht gegenseitig
     * ueberschreiben.
     *
     * Die TTL nimmt apcu_inc NUR beim Anlegen — hier ist das genau richtig:
     * der Schluessel entsteht einmal am Tag und soll dann dreissig Tage
     * leben. (Beim Ring war dieselbe Eigenschaft ein Fehler, weil die TTL
     * kuerzer war als die Nutzung und der Zaehler mittendrin ablief.)
     */

    /** Wie viele Tage zurueck die Reihe reicht. */
    public const TAGE = 30;

    /** TTL der Tageszaehler: etwas mehr als die Reihe, damit der Rand haelt. */
    public const TAGE_TTL = 86400 * 33;

    /**
     * Schluessel eines Tageszaehlers.
     *
     * Feld ist 'n' (Aufrufe) oder 'ms' (Summe der Millisekunden). Der Schnitt
     * entsteht erst beim Lesen — zwei Zaehler lassen sich atomar erhoehen,
     * ein Mittelwert nicht.
     */
    public static function tagesSchluessel(string $prefix, int $uid, string $ymd,
            string $feld): string {
        return $prefix . 'd_' . $uid . '_' . $ymd . '_' . $feld;
    }

    /** Die letzten N Tage als YYYYMMDD, aeltester zuerst. */
    public static function tage(int $jetzt, int $anzahl = self::TAGE): array {
        $raus = [];
        for ($i = $anzahl - 1; $i >= 0; $i--) {
            $raus[] = gmdate('Ymd', $jetzt - $i * 86400);
        }
        return $raus;
    }

    /**
     * Aus den geholten Zaehlern eine Reihe machen.
     *
     * Tage OHNE Aufrufe fallen heraus, sie stehen nicht fuer "null
     * Millisekunden" sondern fuer "niemand hat hingesehen". Eine Null im
     * Verlauf waere eine Messung, die es nicht gab.
     *
     * @param array $gefunden Schluessel => Wert, wie apcu_fetch sie liefert
     * @return array Liste aus ['tag' => 'YYYY-MM-DD', 'n' => int, 'avg' => float]
     */
    public static function tagesReihe(array $gefunden, string $prefix, int $uid,
            array $tage): array {
        $raus = [];
        foreach ($tage as $ymd) {
            $n  = (int) ($gefunden[self::tagesSchluessel($prefix, $uid, $ymd, 'n')] ?? 0);
            if ($n <= 0) {
                continue;
            }
            $ms = (int) ($gefunden[self::tagesSchluessel($prefix, $uid, $ymd, 'ms')] ?? 0);
            $raus[] = [
                'tag' => substr($ymd, 0, 4) . '-' . substr($ymd, 4, 2) . '-' . substr($ymd, 6, 2),
                'n'   => $n,
                'avg' => round($ms / $n, 1),
            ];
        }
        return $raus;
    }

    /**
     * Wie sich der letzte Tag zum Mittel der vorigen verhaelt, in Prozent.
     *
     * Gibt null zurueck, wenn es nichts zu vergleichen gibt — ein einzelner
     * Tag ist kein Verlauf. UND BEI ZU WENIGEN AUFRUFEN AUCH NICHT: zwei
     * Ladungen an einem Tag ergeben einen Schnitt, der mehr ueber den
     * Zeitpunkt aussagt als ueber die Karte. Lieber nichts sagen als eine
     * Zahl, die nach Messung aussieht.
     */
    public const MIN_AUFRUFE = 5;

    public static function trend(array $reihe): ?array {
        $n = count($reihe);
        if ($n < 2) {
            return null;
        }
        $heute = $reihe[$n - 1];
        if ((int) $heute['n'] < self::MIN_AUFRUFE) {
            return null;
        }
        $summe = 0.0;
        $zahl  = 0;
        for ($i = 0; $i < $n - 1; $i++) {
            if ((int) $reihe[$i]['n'] < self::MIN_AUFRUFE) {
                continue;
            }
            $summe += (float) $reihe[$i]['avg'] * (int) $reihe[$i]['n'];
            $zahl  += (int) $reihe[$i]['n'];
        }
        if ($zahl === 0) {
            return null;
        }
        $vorher = $summe / $zahl;
        if ($vorher <= 0.0) {
            return null;
        }
        return [
            'vorher'  => round($vorher, 1),
            'jetzt'   => (float) $heute['avg'],
            'prozent' => (int) round((((float) $heute['avg'] - $vorher) / $vorher) * 100),
        ];
    }

    public static function nachZeitSortiert(array $entries): array {
        usort($entries, static function (array $a, array $b): int {
            return [(int) ($a['ts'] ?? 0), (int) ($a['seq'] ?? 0)]
               <=> [(int) ($b['ts'] ?? 0), (int) ($b['seq'] ?? 0)];
        });
        return $entries;
    }
}
