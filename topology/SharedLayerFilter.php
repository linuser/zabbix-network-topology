<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox

declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * Filtert die GETEILTE Ebene auf das, was der aufrufende Benutzer sehen darf.
 *
 * ANLASS
 * ------
 * Die Topologie selbst ist sauber: sie kommt aus der Zabbix-API und ist damit
 * nach den Rechten des Benutzers gefiltert. Die geteilte Karte lag daneben —
 * ManualLinks::loadShared() und NodePositions::loadShared() lesen aus
 * module.config und kannten keine Rechte. Jeder, der das Modul oeffnen darf,
 * bekam die vollstaendige Struktur ins HTML eingebettet.
 *
 * Sichtbar wurde davon nichts: das Frontend zeichnet eine Kante nur, wenn
 * beide Knoten existieren, und Knoten kommen aus den gefilterten Daten. Im
 * ausgelieferten JSON standen aber:
 *
 *   - Host-IDs aus Gruppen ohne Zugriff (Aufzaehlung, wie viele und welche)
 *   - Gruppen-IDs in den View-Schluesseln (die Schluessel SIND die Auswahl)
 *   - Ghost-Slugs, also per LLDP annoncierte Geraetenamen aus Netzteilen,
 *     die der Benutzer nicht ueberwachen darf
 *
 * Kein dramatisches Leck, aber das Sicherheitsmodell soll an einer Stelle
 * gelten, nicht an anderthalb.
 *
 * WARUM HIER UND NICHT IN loadShared()
 * ------------------------------------
 * loadShared() wird auch vom Schreibpfad gebraucht. Wuerde es gefiltert
 * liefern, schriebe ein Super-Admin beim naechsten Speichern die gefilterte
 * Fassung zurueck und loeschte damit Eintraege, die er nur nicht sehen durfte.
 * In der Praxis sieht ein Super-Admin alles, der Schaden waere also null —
 * aber ein Filter, dessen Ungefaehrlichkeit von der Rolle des Aufrufers
 * abhaengt, ist die falsche Konstruktion. Deshalb: filtern auf dem Weg in die
 * View, nirgends sonst.
 *
 * REGELN
 * ------
 * Ghost-Knoten ("ghost_<slug>") sind keine Zabbix-Objekte und haben keine
 * eigene Berechtigung. Sie werden ueber ihren Kontext beurteilt:
 *
 *   Kante     bleibt, wenn beide Enden sichtbare Hosts sind — oder ein Ende
 *             ein sichtbarer Host und das andere ein Ghost. Ghost-zu-Ghost
 *             faellt weg: ohne einen sichtbaren Anker ist nicht zu
 *             begruenden, warum der Benutzer diese Namen sehen sollte.
 *   View      bleibt, wenn JEDE Gruppen-ID im Schluessel sichtbar ist. Der
 *             Schluessel ist die Gruppenauswahl; eine fremde Gruppe darin
 *             verraet deren Existenz.
 *   Knoten    innerhalb einer erhaltenen View: sichtbarer Host oder Ghost.
 *             Ghosts sind hier unbedenklich, weil die View selbst nur aus
 *             Gruppen besteht, die der Benutzer oeffnen darf.
 */
class SharedLayerFilter {

    private static function isGhost(string $id): bool {
        return strncmp($id, 'ghost_', 6) === 0;
    }

    /**
     * @param array $links            [['s' => id, 't' => id], ...]
     * @param array $visible_hostids  hostid => beliebig (nur die Schluessel zaehlen)
     */
    public static function links(array $links, array $visible_hostids): array {
        $out = [];

        foreach ($links as $l) {
            if (!is_array($l) || !isset($l['s'], $l['t'])) {
                continue;
            }
            $s = (string) $l['s'];
            $t = (string) $l['t'];

            $s_host  = isset($visible_hostids[$s]);
            $t_host  = isset($visible_hostids[$t]);
            $s_ghost = self::isGhost($s);
            $t_ghost = self::isGhost($t);

            // Mindestens ein sichtbarer Host als Anker, und die Gegenseite ist
            // entweder ebenfalls sichtbar oder ein Ghost.
            $ok = ($s_host && $t_host)
               || ($s_host && $t_ghost)
               || ($t_host && $s_ghost);

            if ($ok) {
                $out[] = ['s' => $s, 't' => $t];
            }
        }

        return $out;
    }

    /**
     * @param array $positions         [viewKey => [nodeId => ['x'=>int,'y'=>int]]]
     * @param array $visible_hostids   hostid  => beliebig
     * @param array $visible_groupids  groupid => beliebig
     */
    public static function positions(array $positions, array $visible_hostids,
                                     array $visible_groupids): array {
        $out = [];

        foreach ($positions as $view => $nodes) {
            $view = (string) $view;
            if (!is_array($nodes)) {
                continue;
            }

            // View-Key: sortierte Group-IDs mit "_" verbunden, optional "_grp".
            $base = substr($view, -4) === '_grp' ? substr($view, 0, -4) : $view;
            $gids = array_filter(explode('_', $base), static function ($g) {
                return $g !== '';
            });

            // Eine leere Auswahl ist kein Verrat — sie nennt keine Gruppe.
            foreach ($gids as $g) {
                if (!isset($visible_groupids[$g])) {
                    continue 2;
                }
            }

            $clean = [];
            foreach ($nodes as $id => $p) {
                $id = (string) $id;
                if (isset($visible_hostids[$id]) || self::isGhost($id)) {
                    $clean[$id] = $p;
                }
            }

            // Leere Views nicht mitschicken — sie sagten nur aus, dass es die
            // Auswahl gibt.
            if ($clean) {
                $out[$view] = $clean;
            }
        }

        return $out;
    }
}
