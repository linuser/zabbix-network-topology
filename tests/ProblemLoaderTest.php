<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\ProblemLoader — die beiden REINEN Aggregatoren.
 *
 * load() selbst ruft die Zabbix-API und ist hier bewusst nicht getestet; genau
 * deshalb ist der API-Kontakt auf EINE duenne Methode reduziert. Die Logik, die
 * wirklich schiefgehen kann, steckt in aggregateTriggers()/aggregateProblems()
 * — und die brauchen weder DB noch API.
 *
 * Geprueft werden die Regeln, die man leicht uebersieht:
 *   - ein Trigger kann auf MEHRERE Hosts zeigen und zaehlt dann bei jedem
 *   - Severity ist der worst case pro Host, nicht der letzte gesehene
 *   - 'acknowledged' kommt je nach Zabbix-Version als String '1' ODER int 1
 *   - die Problemliste ist gekappt (20/Host) UND sortiert (Severity, dann Zeit)
 *
 * Aufruf:  php tests/ProblemLoaderTest.php
 */

spl_autoload_register(static function (string $class): void {
    $prefix = 'Modules\\NetworkTopologyV6\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $parts = explode('\\', substr($class, strlen($prefix)));
    $file  = array_pop($parts);
    $dir   = implode('/', array_map('strtolower', $parts));
    $path  = dirname(__DIR__) . '/' . $dir . '/' . $file . '.php';
    if (is_file($path)) {
        require $path;
    }
});

use Modules\NetworkTopologyV6\Topology\ProblemLoader;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-56s got=%-14s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

// ── Trigger: t3 haengt an ZWEI Hosts ──────────────────────────────────────
$triggers = [
    ['triggerid' => 't1', 'priority' => '3', 'hosts' => [['hostid' => 'h1']]],
    ['triggerid' => 't2', 'priority' => '5', 'hosts' => [['hostid' => 'h1']]],
    ['triggerid' => 't3', 'priority' => '4', 'hosts' => [['hostid' => 'h1'], ['hostid' => 'h2']]],
];

$sev = ProblemLoader::aggregateTriggers($triggers);

echo "\naggregateTriggers\n";
check('Severity = worst case (3,5,4 -> 5)', $sev['severity']['h1'] ?? null, 5);
check('Trigger pro Host gezaehlt',          $sev['problems']['h1'] ?? null, 3);
check('Multi-Host-Trigger zaehlt auch beim 2. Host', $sev['severity']['h2'] ?? null, 4);
check('… und zwar genau einmal',            $sev['problems']['h2'] ?? null, 1);

// ── Probleme: acknowledged mal als String, mal als int ────────────────────
$problems = [
    ['objectid' => 't2', 'name' => 'Kritisch', 'severity' => '5', 'clock' => '2000', 'acknowledged' => '1'],
    ['objectid' => 't1', 'name' => 'Mittel',   'severity' => '3', 'clock' => '3000', 'acknowledged' => 0],
    ['objectid' => 't3', 'name' => 'Multi',    'severity' => '4', 'clock' => '1000', 'acknowledged' => '0'],
];

$a = ProblemLoader::aggregateProblems($problems, $triggers);

echo "\naggregateProblems — Zuordnung ueber triggerid\n";
check('h1 bekommt alle drei Probleme',   $a['ack_total']['h1'] ?? null, 3);
check('davon eines acknowledged',        $a['ack_acked']['h1'] ?? null, 1);
check('h2 bekommt nur das Multi-Problem', $a['ack_total']['h2'] ?? null, 1);
check('h2 hat kein acknowledged',        $a['ack_acked']['h2'] ?? null, null);

echo "\nSortierung: Severity absteigend, dann Zeit absteigend\n";
$list = $a['problem_list']['h1'] ?? [];
check('1. Eintrag: hoechste Severity',   $list[0]['name'] ?? null, 'Kritisch');
check('2. Eintrag',                      $list[1]['name'] ?? null, 'Multi');
check('3. Eintrag: trotz neuester Zeit zuletzt (Severity zaehlt zuerst)',
                                         $list[2]['name'] ?? null, 'Mittel');
check("String '1' wird als acknowledged erkannt", $list[0]['acknowledged'] ?? null, true);

// ── Cap: 25 Probleme auf einem Host -> nur 20 in der Liste ────────────────
$many = [];
for ($i = 0; $i < 25; $i++) {
    $many[] = ['objectid' => 't1', 'name' => "P$i", 'severity' => '2', 'clock' => (string) $i, 'acknowledged' => '0'];
}
$cap = ProblemLoader::aggregateProblems($many, $triggers);

echo "\nCap pro Host\n";
check('Liste bei 20 gekappt (25 angeboten)', count($cap['problem_list']['h1'] ?? []), 20);
check('… aber ALLE 25 werden gezaehlt',      $cap['ack_total']['h1'] ?? null,          25);

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
