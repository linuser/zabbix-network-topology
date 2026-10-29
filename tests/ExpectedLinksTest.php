<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\ExpectedLinks (Soll gegen Ist).
 *
 * Die heikle Aussage ist der Befund selbst: ein erwartetes Kabel, das nicht
 * gemessen wird, muss als "falsch gesteckt" (A haengt woanders) ODER "nicht
 * gesehen" (A meldet gar nichts) herauskommen — und ein tatsaechlich
 * vorhandenes Kabel darf KEINEN Alarm ausloesen. Beide Richtungen prueft der
 * Test, dazu Selbstreferenz, unaufloesbare Namen und die Adjazenz-Bildung.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP.
 *
 * Aufruf:  php tests/ExpectedLinksTest.php
 */

spl_autoload_register(static function (string $class): void {
    $prefix = 'Modules\\NetworkTopology\\';
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

use Modules\NetworkTopology\Topology\ExpectedLinks;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %s\n", $ok ? 'PASS' : 'FAIL', $what);
    if (!$ok) {
        printf("        got  %s\n        want %s\n", json_encode($got), json_encode($want));
    }
}

function want(string $host, string $port = ''): array {
    return ['host' => $host, 'port' => $port];
}

// Namen -> hid (klein), wie der Controller sie aus host/name baut.
$names = ['a' => 'a', 'b' => 'b', 'c' => 'c'];
$labels = ['a' => 'A', 'b' => 'B', 'c' => 'C'];

echo "\nExpectedLinks\n";

// 1. Erwartet UND gemessen -> Treffer, kein Befund.
check('A erwartet B, A-B gemessen -> ok',
    ExpectedLinks::compare(
        ['a' => [want('B')]], $names,
        ['a' => ['b' => true], 'b' => ['a' => true]], $labels),
    ['deviations' => [], 'expected' => 1, 'matched' => 1]);

// 2. Erwartet B, A haengt tatsaechlich an C -> misconnected.
check('A erwartet B, misst C -> misconnected (actual C)',
    ExpectedLinks::compare(
        ['a' => [want('B')]], $names,
        ['a' => ['c' => true], 'c' => ['a' => true]], $labels),
    ['deviations' => [[
        'from' => 'a', 'to' => 'b', 'expected' => 'B', 'port' => '',
        'status' => 'misconnected', 'actual' => ['C'],
    ]], 'expected' => 1, 'matched' => 0]);

// 3. Erwartet B, A meldet gar keinen Nachbarn -> not_seen.
check('A erwartet B, misst nichts -> not_seen',
    ExpectedLinks::compare(
        ['a' => [want('B')]], $names, [], $labels),
    ['deviations' => [[
        'from' => 'a', 'to' => 'b', 'expected' => 'B', 'port' => '',
        'status' => 'not_seen', 'actual' => [],
    ]], 'expected' => 1, 'matched' => 0]);

// 4. Erwarteter Name nicht in der Ansicht -> to leer, trotzdem Befund.
check('Unaufloesbarer Name -> Befund mit to=""',
    ExpectedLinks::compare(
        ['a' => [want('ghost')]], $names,
        ['a' => ['c' => true], 'c' => ['a' => true]], $labels),
    ['deviations' => [[
        'from' => 'a', 'to' => '', 'expected' => 'ghost', 'port' => '',
        'status' => 'misconnected', 'actual' => ['C'],
    ]], 'expected' => 1, 'matched' => 0]);

// 5. Selbstreferenz -> still verworfen, zaehlt nicht.
check('A erwartet A -> verworfen',
    ExpectedLinks::compare(['a' => [want('A')]], $names, [], $labels),
    ['deviations' => [], 'expected' => 0, 'matched' => 0]);

// 6. Mehrere Erwartungen; Port wird mitgefuehrt, aber nicht zum Abgleich benutzt.
check('Zwei Erwartungen: B trifft (mit Port), C weicht ab',
    ExpectedLinks::compare(
        ['a' => [want('b', 'Gi1/0/1'), want('C')]], $names,
        ['a' => ['b' => true], 'b' => ['a' => true]], $labels),
    ['deviations' => [[
        'from' => 'a', 'to' => 'c', 'expected' => 'C', 'port' => '',
        'status' => 'misconnected', 'actual' => ['B'],
    ]], 'expected' => 2, 'matched' => 1]);

// 7. adjacency(): ungerichtet, Self-/Leer-Kanten raus.
check('adjacency baut ungerichtet, filtert Self/Leer',
    ExpectedLinks::adjacency([
        ['from' => 'a', 'to' => 'b'],
        ['source' => 'b', 'target' => 'c'],
        ['from' => 'x', 'to' => 'x'],
        ['from' => '', 'to' => 'y'],
    ]),
    ['a' => ['b' => true], 'b' => ['a' => true, 'c' => true], 'c' => ['b' => true]]);

echo "\n";
if ($failures > 0) {
    printf("ExpectedLinks: %d Fehler.\n", $failures);
    exit(1);
}
echo "ExpectedLinks: alle Faelle gruen.\n";
