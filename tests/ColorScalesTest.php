<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit test for Topology\ColorScales::sanitize().
 *
 * sanitize() is the only place where the color scales set by a Super admin
 * enter the backend. The colors later end up as CSS values in Cytoscape
 * styles and as inline style="background:…" in the legend — a string that
 * slipped through would be a direct injection vector there. The thresholds
 * drive the tier assignment; unsorted or duplicated they would produce a
 * scale that looks different in the UI from what is stored.
 *
 * Runs without DB/session/HTTP/Zabbix — sanitize() is static.
 *
 * Run:  php tests/ColorScalesTest.php
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

use Modules\NetworkTopology\Topology\ColorScales;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-56s got=%-10s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

function scales(array $traffic, array $util): array {
    return ['traffic' => $traffic, 'util' => $util];
}

$okTraffic = ['bounds' => [10000, 100000, 1000000, 10000000],
              'colors' => ['#22c55e', '#06b6d4', '#3b82f6', '#f97316', '#ef4444']];
$okUtil    = ['bounds' => [1, 10, 25, 40, 55, 70, 85],
              'colors' => ['#94a3b8', '#3b82f6', '#22c55e', '#a3e635', '#facc15', '#f97316', '#ef4444', '#a21caf']];

echo "\n  ColorScales::sanitize()\n\n";

$r = ColorScales::sanitize(scales($okTraffic, $okUtil));
check('valid defaults pass',                      $r !== null, true);
check('bounds become float',                       $r['traffic']['bounds'][0], 10000.0);
check('colors kept, 5 traffic colors',             count($r['traffic']['colors']), 5);

$r = ColorScales::sanitize(scales(['bounds' => [1e6], 'colors' => ['#ABCDEF', '#000000']], $okUtil));
check('uppercase hex is normalised to lowercase',  $r['traffic']['colors'][0], '#abcdef');
check('minimum: 1 bound, 2 colors',                $r !== null, true);

check('missing util scale → null',
    ColorScales::sanitize(['traffic' => $okTraffic]), null);
check('one color too few → null',
    ColorScales::sanitize(scales(['bounds' => [1e6, 1e7], 'colors' => ['#000000', '#111111']], $okUtil)), null);
check('not ascending → null',
    ColorScales::sanitize(scales(['bounds' => [1e7, 1e6], 'colors' => ['#000000', '#111111', '#222222']], $okUtil)), null);
check('duplicate bound → null',
    ColorScales::sanitize(scales(['bounds' => [1e6, 1e6], 'colors' => ['#000000', '#111111', '#222222']], $okUtil)), null);
check('bound 0 → null',
    ColorScales::sanitize(scales(['bounds' => [0], 'colors' => ['#000000', '#111111']], $okUtil)), null);
check('negative bound → null',
    ColorScales::sanitize(scales(['bounds' => [-5], 'colors' => ['#000000', '#111111']], $okUtil)), null);
check('numeric string as bound → null',
    ColorScales::sanitize(scales(['bounds' => ['1000'], 'colors' => ['#000000', '#111111']], $okUtil)), null);
check('utilization above 1000% → null',
    ColorScales::sanitize(scales($okTraffic, ['bounds' => [1001], 'colors' => ['#000000', '#111111']])), null);
check('short hex (#fff) → null',
    ColorScales::sanitize(scales(['bounds' => [1e6], 'colors' => ['#fff', '#111111']], $okUtil)), null);
check('CSS injection in color → null',
    ColorScales::sanitize(scales(['bounds' => [1e6], 'colors' => ['#000000;background:url(x)', '#111111']], $okUtil)), null);
check('color name (red) → null',
    ColorScales::sanitize(scales(['bounds' => [1e6], 'colors' => ['red', '#111111']], $okUtil)), null);
check('non-string color → null',
    ColorScales::sanitize(scales(['bounds' => [1e6], 'colors' => [123456, '#111111']], $okUtil)), null);

$many = ['bounds' => range(1, ColorScales::MAX_COLORS), 'colors' => array_fill(0, ColorScales::MAX_COLORS + 1, '#000000')];
check('more than MAX_COLORS colors → null',
    ColorScales::sanitize(scales($okTraffic, $many)), null);

$r = ColorScales::sanitize(scales(['bounds' => [5 => 1e6], 'colors' => [3 => '#000000', 7 => '#111111']], $okUtil));
check('keys are re-indexed',                       $r !== null && array_keys($r['traffic']['colors']) === [0, 1], true);

echo $failures === 0
    ? "\n  ColorScalesTest: all checks passed\n"
    : "\n  ColorScalesTest: {$failures} failure(s)\n";

exit($failures === 0 ? 0 : 1);
