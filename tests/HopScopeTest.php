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

echo "\n== Host cap ==\n\n";

// Star-of-stars: core -> a1..a3 (ring 1), each aN -> bN1..bN3 (ring 2).
$ring = [];
foreach ([1, 2, 3] as $a) {
    $ring[] = ['from' => 'core', 'to' => "a$a"];
    foreach ([1, 2, 3] as $b) {
        $ring[] = ['from' => "a$a", 'to' => "b$a$b"];
    }
}
$dist = HopScope::distances('core', 2, $ring);

check('distances: BFS order, start first',
    array_slice(array_map('strval', array_keys($dist)), 0, 4), ['core', 'a1', 'a2', 'a3']);

check('distances: ring 2 at distance 2',
    $dist['b23'] ?? null, 2);

$c = HopScope::cap($dist, 100);
check('under the cap: nothing dropped',
    [$c['truncated'], $c['total'], count($c['hostids']), $c['complete_hops']], [false, 13, 13, 2]);

$c = HopScope::cap($dist, 6);
check('cap cuts inside ring 2: 6 of 13 kept',
    [$c['truncated'], $c['total'], count($c['hostids'])], [true, 13, 6]);
check('cap keeps the nearest: all of ring 1 present',
    array_slice($c['hostids'], 0, 4), ['core', 'a1', 'a2', 'a3']);
check('cap inside ring 2: complete up to 1 hop',
    $c['complete_hops'], 1);

$c = HopScope::cap($dist, 4);
check('cap exactly at the ring boundary: still complete up to 1 hop',
    [$c['truncated'], $c['complete_hops']], [true, 1]);

$c = HopScope::cap($dist, 2);
check('cap inside ring 1: complete up to 0 hops',
    [$c['truncated'], $c['complete_hops'], $c['hostids']], [true, 0, ['core', 'a1']]);

$c = HopScope::cap(HopScope::distances('101', 1, [['from' => 101, 'to' => 102]]), 1);
check('numeric ids come out as strings after the cap',
    $c['hostids'], ['101']);

$c = HopScope::cap([], 10);
check('empty scope: empty result, not truncated',
    [$c['hostids'], $c['total'], $c['truncated']], [[], 0, false]);

echo "\n";
if ($failures > 0) {
    echo "HopScopeTest: {$failures} FAILURE(S)\n";
    exit(1);
}
echo "HopScopeTest: all checks passed.\n";
