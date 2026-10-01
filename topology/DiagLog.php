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
    public static function nachZeitSortiert(array $entries): array {
        usort($entries, static function (array $a, array $b): int {
            return [(int) ($a['ts'] ?? 0), (int) ($a['seq'] ?? 0)]
               <=> [(int) ($b['ts'] ?? 0), (int) ($b['seq'] ?? 0)];
        });
        return $entries;
    }
}
