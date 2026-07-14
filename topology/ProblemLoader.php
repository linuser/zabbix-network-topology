<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Topology;

use API;

/**
 * ProblemLoader
 *
 * Sechster Schnitt der Data.php-Aufteilung (Review §6).
 *
 * Holt Trigger + Probleme und verdichtet sie zu dem, was ein Knoten braucht:
 * worst-case-Severity, Problemzahl, Acknowledged-Zaehler und die (gekappte,
 * sortierte) Problemliste fuers Accordion.
 *
 * Aufbau bewusst so geschnitten, dass der API-Kontakt EINE duenne Methode ist
 * (load) und die eigentliche Logik in zwei REINEN Methoden liegt
 * (aggregateTriggers, aggregateProblems). Damit ist der interessante Teil
 * direkt testbar, ohne die Zabbix-API zu mocken — und getestet ist er auch:
 * siehe tests/ProblemLoaderTest.php.
 *
 * (Ich hatte zwischenzeitlich behauptet, an dieser Stelle sei nichts zu holen,
 * weil "alles nur API-Aufrufe" seien. Das stimmte nicht: von 87 Zeilen lagen
 * 50 hinter dem letzten API-Call.)
 */
final class ProblemLoader {

    /** Mehr Probleme pro Host machen das Accordion unbrauchbar und blaehen den Payload. */
    private const MAX_PER_HOST = 20;

    /**
     * Der einzige API-Kontakt. Holt Trigger + Probleme und gibt die
     * aggregierten Maps zurueck.
     *
     * @return array{severity: array, problems: array, ack_total: array,
     *               ack_acked: array, problem_list: array}
     */
    public static function load(array $hostids): array {
        // Trigger-API liefert die Severity (= worst-case pro Host).
        $triggers = API::Trigger()->get([
            'output'       => ['triggerid', 'priority'],
            'hostids'      => $hostids,
            'monitored'    => true,
            'only_true'    => true,
            'filter'       => ['value' => TRIGGER_VALUE_TRUE],
            'selectHosts'  => ['hostid'],
            'preservekeys' => false
        ]);

        $sev = self::aggregateTriggers($triggers);

        $problems = [];
        if ($sev['problems']) {
            // recent=true: nur aktuell offene Probleme (oder kuerzlich geschlossene).
            // Frueher 'false', was historische Problems zurueckgeliefert hat — bei
            // vielen Hosts tausende Events, von denen wir nur 20/Host nutzen.
            // sortfield+limit als zweite Sicherung gegen runaway-Listen.
            $problems = API::Problem()->get([
                'output'       => ['eventid', 'objectid', 'name', 'severity', 'clock', 'acknowledged'],
                'hostids'      => array_keys($sev['problems']),
                'recent'       => true,
                'sortfield'    => ['eventid'],
                'sortorder'    => 'DESC',
                'limit'        => max(500, count($sev['problems']) * 25),
                'preservekeys' => false
            ]);
        }

        $acks = self::aggregateProblems($problems, $triggers);

        return [
            'severity'     => $sev['severity'],
            'problems'     => $sev['problems'],
            'ack_total'    => $acks['ack_total'],
            'ack_acked'    => $acks['ack_acked'],
            'problem_list' => $acks['problem_list'],
        ];
    }

    /**
     * REIN: Trigger → worst-case-Severity + Anzahl aktiver Trigger pro Host.
     * Ein Trigger kann auf mehrere Hosts zeigen und zaehlt dann bei jedem.
     *
     * @return array{severity: array, problems: array}
     */
    public static function aggregateTriggers(array $triggers): array {
        $host_severity = [];
        $host_problems = [];   // Anzahl aktiver Trigger pro Host
        foreach ($triggers as $t) {
            $sev = (int) $t['priority'];
            foreach ($t['hosts'] as $th) {
                $hid = $th['hostid'];
                if (!isset($host_severity[$hid]) || $sev > $host_severity[$hid]) {
                    $host_severity[$hid] = $sev;
                }
                $host_problems[$hid] = ($host_problems[$hid] ?? 0) + 1;
            }
        }

        return ['severity' => $host_severity, 'problems' => $host_problems];
    }

    /**
     * REIN: Probleme + Trigger → Ack-Zaehler und die gekappte, sortierte
     * Problemliste pro Host.
     *
     * Die Problem-API liefert keine hostid — die Zuordnung laeuft ueber
     * triggerid → hosts aus dem Trigger-Ergebnis. Deshalb braucht diese
     * Methode beide Listen.
     *
     * @return array{ack_total: array, ack_acked: array, problem_list: array}
     */
    public static function aggregateProblems(array $problems, array $triggers): array {
        $host_ack_total    = [];   // hid => Anzahl Probleme
        $host_ack_acked    = [];   // hid => Anzahl davon acknowledged
        $host_problem_list = [];   // hid => [{name, severity, clock, acknowledged}, ...]

        // Probleme haben keinen direkten hostid — der Weg geht über
        // event.get oder über die schon geholten Trigger. Wir mappen
        // triggerid → hosts aus dem Trigger-Result.
        $trigger_hosts = [];
        foreach ($triggers as $t) {
            $trigger_hosts[$t['triggerid'] ?? ''] = array_column($t['hosts'], 'hostid');
        }
        foreach ($problems as $p) {
            $tid = $p['objectid'] ?? '';
            $hids = $trigger_hosts[$tid] ?? [];
            // Type-loose-Vergleich: Zabbix-API liefert acknowledged je
            // nach Version mal als String '1', mal als Integer 1.
            $is_acked = (int) ($p['acknowledged'] ?? 0) === 1;
            $entry = [
                'name'         => (string) ($p['name'] ?? ''),
                'severity'     => (int)    ($p['severity'] ?? 0),
                'clock'        => (int)    ($p['clock'] ?? 0),
                'acknowledged' => $is_acked,
            ];
            foreach ($hids as $hid) {
                $host_ack_total[$hid] = ($host_ack_total[$hid] ?? 0) + 1;
                if ($is_acked) {
                    $host_ack_acked[$hid] = ($host_ack_acked[$hid] ?? 0) + 1;
                }
                // Cap pro Host: 20 Probleme reichen für die UI; mehr würden
                // den Accordion unbrauchbar machen und den Payload aufblähen.
                if (!isset($host_problem_list[$hid])) $host_problem_list[$hid] = [];
                if (count($host_problem_list[$hid]) < self::MAX_PER_HOST) {
                    $host_problem_list[$hid][] = $entry;
                }
            }
        }
        // Pro Host: nach Severity desc, dann nach Clock desc (neueste oben).
        foreach ($host_problem_list as $hid => &$list) {
            usort($list, function($a, $b) {
                if ($a['severity'] !== $b['severity']) return $b['severity'] - $a['severity'];
                return $b['clock'] - $a['clock'];
            });
        }
        unset($list);

        return [
            'ack_total'    => $host_ack_total,
            'ack_acked'    => $host_ack_acked,
            'problem_list' => $host_problem_list,
        ];
    }
}
