<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\StpLoopResolver.
 *
 * Prueft, dass das ZWEITE Ende eines Selbst-Loops korrekt bestimmt wird: aus
 * dem geblockten Port (dot1dStpPortState 2) ueber designierte Bridge/Port den
 * weiterleitenden Partner-Port. Fixture sind die ECHTEN Werte eines HPE 1830
 * (JL813A), an dem der Fall live belegt wurde: Loop 21<->23, Port 23 geblockt.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP.  Aufruf: php tests/StpLoopResolverTest.php
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

use Modules\NetworkTopology\Topology\StpLoopResolver;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
        fwrite(STDERR, "  [FAIL] $what\n    got=" . var_export($got, true)
            . "\n    want=" . var_export($want, true) . "\n");
    } else {
        echo "  [PASS] $what\n";
    }
}

/**
 * Baut Zabbix-walk[]-Text, so wie das nt.stp.walk-Item ihn liefert:
 * "<oid> = <TYP>: <wert>" je Zeile. Integer als INTEGER, MAC/Port als Hex-STRING.
 */
function walkLine(string $col, int $bp, string $type, string $val): string {
    return '.1.3.6.1.2.1.' . $col . '.' . $bp . ' = ' . $type . ': ' . $val;
}

// ── Fixture: HPE 1830, Base-MAC 02:00:00:38:0f:c0 ───────────────────────────
// Bridge-Port == ifIndex (auf diesem Switch 1:1). Prioritaet-Prefix 80 00 / 80.
$base = '.1.3.6.1.2.1.17.1.1.0 = Hex-STRING: 02 00 00 38 0F C0';

$lines = [$base];
// Port 23: GEBLOCKT, designierte Bridge = eigene, designierter Port 0x8015 = 21.
$lines[] = walkLine('17.2.15.1.3', 23, 'INTEGER', '2');
$lines[] = walkLine('17.1.4.1.2',  23, 'INTEGER', '23');
$lines[] = walkLine('17.2.15.1.8', 23, 'Hex-STRING', '80 00 02 00 00 38 0F C0');
$lines[] = walkLine('17.2.15.1.9', 23, 'Hex-STRING', '80 15');
// Port 21: der weiterleitende Partner (state 5), designiert sich selbst.
$lines[] = walkLine('17.2.15.1.3', 21, 'INTEGER', '5');
$lines[] = walkLine('17.1.4.1.2',  21, 'INTEGER', '21');
$lines[] = walkLine('17.2.15.1.8', 21, 'Hex-STRING', '80 00 02 00 00 38 0F C0');
$lines[] = walkLine('17.2.15.1.9', 21, 'Hex-STRING', '80 15');
// Port 1: ganz normal forwarding, kein Loop.
$lines[] = walkLine('17.2.15.1.3', 1, 'INTEGER', '5');
$lines[] = walkLine('17.1.4.1.2',  1, 'INTEGER', '1');
$lines[] = walkLine('17.2.15.1.8', 1, 'Hex-STRING', '80 00 02 00 00 38 0F C0');
$lines[] = walkLine('17.2.15.1.9', 1, 'Hex-STRING', '80 01');
// Port 30: GEBLOCKT, aber designierte Bridge ist FREMD (ein zweiter Switch) —
// ein normaler Redundanz-Block, KEIN Selbst-Loop. Darf nicht erscheinen.
$lines[] = walkLine('17.2.15.1.3', 30, 'INTEGER', '2');
$lines[] = walkLine('17.1.4.1.2',  30, 'INTEGER', '30');
$lines[] = walkLine('17.2.15.1.8', 30, 'Hex-STRING', '80 00 0C 97 5F 5C 0F 80');
$lines[] = walkLine('17.2.15.1.9', 30, 'Hex-STRING', '80 05');

$walk = implode("\n", $lines);

echo "StpLoopResolver — zweites Loop-Ende aus der BRIDGE-MIB\n\n";

$res = StpLoopResolver::resolve($walk);
check('Selbst-Loop: Port 23 -> Partner 21', $res, [23 => 21]);

// Gegenproben, isoliert.
check('leerer Walk -> leer', StpLoopResolver::resolve(''), []);
check('nur Whitespace -> leer', StpLoopResolver::resolve("  \n \n"), []);

// Nur der Fremd-Block (Port 30) allein: kein Selbst-Loop.
$foreign = implode("\n", [
    $base,
    walkLine('17.2.15.1.3', 30, 'INTEGER', '2'),
    walkLine('17.1.4.1.2',  30, 'INTEGER', '30'),
    walkLine('17.2.15.1.8', 30, 'Hex-STRING', '80 00 0C 97 5F 5C 0F 80'),
    walkLine('17.2.15.1.9', 30, 'Hex-STRING', '80 05'),
]);
check('Fremd-Block allein -> leer (kein Selbst-Loop)', StpLoopResolver::resolve($foreign), []);

// Ohne eigene Base-MAC laesst sich Selbst-Loop nicht von Fremd-Block trennen:
// konservativ leer.
$noBase = implode("\n", [
    walkLine('17.2.15.1.3', 23, 'INTEGER', '2'),
    walkLine('17.1.4.1.2',  23, 'INTEGER', '23'),
    walkLine('17.2.15.1.8', 23, 'Hex-STRING', '80 00 02 00 00 38 0F C0'),
    walkLine('17.2.15.1.9', 23, 'Hex-STRING', '80 15'),
]);
check('ohne Base-MAC -> leer', StpLoopResolver::resolve($noBase), []);

// Bridge-Port != ifIndex: Partner-ifIndex muss ueber dot1dBasePortIfIndex
// aufgeloest werden, nicht die Bridge-Port-Nummer durchgereicht.
$remap = implode("\n", [
    '.1.3.6.1.2.1.17.1.1.0 = Hex-STRING: 02 00 00 38 0F C0',
    walkLine('17.2.15.1.3', 23, 'INTEGER', '2'),
    walkLine('17.1.4.1.2',  23, 'INTEGER', '1023'),   // Bridge-Port 23 -> ifIndex 1023
    walkLine('17.2.15.1.8', 23, 'Hex-STRING', '80 00 02 00 00 38 0F C0'),
    walkLine('17.2.15.1.9', 23, 'Hex-STRING', '80 15'),  // Partner Bridge-Port 21
    walkLine('17.2.15.1.3', 21, 'INTEGER', '5'),
    walkLine('17.1.4.1.2',  21, 'INTEGER', '1021'),   // Bridge-Port 21 -> ifIndex 1021
]);
check('Bridge-Port != ifIndex: ueber dot1dBasePortIfIndex aufgeloest', StpLoopResolver::resolve($remap), [1023 => 1021]);

echo "\n";
if ($failures > 0) {
    fwrite(STDERR, "FAIL: $failures\n");
    exit(1);
}
echo "alle gruen\n";
