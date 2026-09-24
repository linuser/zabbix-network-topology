<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit test for Topology\HopScope.
 *
 * The hop scope decides which hosts the expensive enrichment pipeline runs
 * on in host+hops mode. Off-by-one errors here either silently drop the
 * outermost ring (map looks emptier, nobody gets an error) or pull in a hop
 * too many (defeats the point of scoping). Both are only caught by tests.
 *
 * Runs without DB/session/HTTP/Zabbix — pure PHP.
 *
 * Usage:  php tests/HopScopeTest.php
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

use Modules\NetworkTopology\Topology\HopScope;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-62s got=%-30s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

/** Sorted id list, so set comparisons are order-independent. */
function scope(string $start, int $hops, array $edges, array $links = []): array {
    $ids = HopScope::neighborhood($start, $hops, $edges, $links);
    sort($ids);
    return $ids;
}

// Topology: chain core-sw1-sw2-sw3, star core-fw, island x-y,
// directed hosts edge sw1→vm1, plus a self-loop as noise.
$edges = [
    ['from' => 'core', 'to' => 'sw1'],
    ['from' => 'sw1',  'to' => 'sw2'],
    ['from' => 'sw2',  'to' => 'sw3'],
    ['from' => 'core', 'to' => 'fw'],
    ['from' => 'sw1',  'to' => 'vm1', '_type' => 'hosts'],
    ['from' => 'x',    'to' => 'y'],
    ['from' => 'sw3',  'to' => 'sw3'],
];

echo "== Hop limit ==\n\n";

check('1 hop from core: direct neighbours only',
    scope('core', 1, $edges), ['core', 'fw', 'sw1']);

check('2 hops from core: hosts edge counts as a hop',
    scope('core', 2, $edges), ['core', 'fw', 'sw1', 'sw2', 'vm1']);

check('3 hops from core: island x/y stays out',
    scope('core', 3, $edges), ['core', 'fw', 'sw1', 'sw2', 'sw3', 'vm1']);

check('large hop count: connected component, never the island',
    scope('core', 99, $edges), ['core', 'fw', 'sw1', 'sw2', 'sw3', 'vm1']);

echo "\n== Edge cases ==\n\n";

check('isolated start host: just itself',
    scope('lonely', 2, $edges), ['lonely']);

check('start in the island: only the island',
    scope('x', 5, $edges), ['x', 'y']);

check('self-loop does not extend the scope',
    scope('sw3', 1, $edges), ['sw2', 'sw3']);

check('empty edge list: just the start host',
    scope('core', 3, []), ['core']);

check('numeric ids from mixed int/string records match',
    scope('101', 1, [['from' => 101, 'to' => 102]]), ['101', '102']);

echo "\n== Manual links ==\n\n";

check('manual link bridges to the island at 1 hop',
    scope('core', 1, $edges, [['s' => 'core', 't' => 'x']]),
    ['core', 'fw', 'sw1', 'x']);

check('manual link then LLDP edge: y reachable at 2 hops',
    scope('core', 2, $edges, [['s' => 'core', 't' => 'x']]),
    ['core', 'fw', 'sw1', 'sw2', 'vm1', 'x', 'y']);

check('malformed manual link entries are ignored',
    scope('core', 1, $edges, [['s' => 'core'], ['t' => 'x'], []]),
    ['core', 'fw', 'sw1']);

echo "\n== Budget (Issue #22) ==\n\n";

// Sechs Hops erreichen auf einem Campus praktisch alles, und die
// Anreicherung danach lief darueber — bis nginx eine HTML-Fehlerseite
// schickte. Das Budget kappt RINGWEISE: lieber drei vollstaendige Hops als
// sechs halbe.
$kette = [];
for ($i = 0; $i < 20; $i++) {
    $kette[] = ['from' => 'h' . $i, 'to' => 'h' . ($i + 1)];
}

$voll = HopScope::scope('h0', 10, $kette);
check('ohne Budget: alle zehn Hops',        count($voll['hostids']), 11);
check('ohne Budget: nichts gekappt',        $voll['cut'], false);
check('ohne Budget: Hops gezaehlt',         $voll['hops_done'], 10);

$eng = HopScope::scope('h0', 10, $kette, [], 5);
check('Budget 5: bei vollem Ring Schluss',  count($eng['hostids']), 5);
check('Budget 5: gekappt gemeldet',         $eng['cut'], true);
check('Budget 5: vier Hops vollstaendig',   $eng['hops_done'], 4);

// Ein Stern: der erste Ring allein sprengt das Budget. Dann bleibt der
// Startknoten — und die Meldung, dass gekappt wurde. Eine halbe Kugelschale
// waere ein Zufallsschnitt.
$stern = [];
for ($i = 1; $i <= 50; $i++) {
    $stern[] = ['from' => 'core', 'to' => 'e' . $i];
}
$eng2 = HopScope::scope('core', 3, $stern, [], 10);
check('Stern zu gross: nur der Start',      $eng2['hostids'], ['core']);
check('Stern zu gross: gekappt gemeldet',   $eng2['cut'], true);
check('Stern zu gross: null Hops',          $eng2['hops_done'], 0);

// Genau aufgehend: 1 + 9 Nachbarn = 10, das Budget ist erreicht, aber nicht
// ueberschritten. Kein Schnitt, keine Meldung.
$stern9 = [];
for ($i = 1; $i <= 9; $i++) {
    $stern9[] = ['from' => 'core', 'to' => 'n' . $i];
}
$genau = HopScope::scope('core', 1, $stern9, [], 10);
check('Budget genau ausgeschoepft: kein Schnitt', $genau['cut'], false);
check('Budget genau ausgeschoepft: alle da',      count($genau['hostids']), 10);

check('neighborhood() liefert weiter nur Ids',
    HopScope::neighborhood('h0', 2, $kette), ['h0', 'h1', 'h2']);

echo "\n";
if ($failures > 0) {
    echo "HopScopeTest: {$failures} FAILURE(S)\n";
    exit(1);
}
echo "HopScopeTest: all checks passed.\n";
