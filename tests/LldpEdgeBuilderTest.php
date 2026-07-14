<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\LldpEdgeBuilder.
 *
 * Das Nachbar-Matching ist die heikelste Zuordnung im Modul: ein Switch meldet
 * einen Namen, und wir raten, welcher Zabbix-Host gemeint ist. Greift das daneben,
 * FEHLEN einfach Kanten — die Karte sieht nur "leerer" aus, niemand bekommt einen
 * Fehler. Solche stillen Aussetzer faengt man nur mit Tests.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP.
 *
 * Aufruf:  php tests/LldpEdgeBuilderTest.php
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

use Modules\NetworkTopologyV6\Topology\LldpEdgeBuilder;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-58s got=%-12s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

/** Gibt es eine Kante zwischen zwei Hosts (Richtung egal)? */
function hasEdge(array $edges, string $a, string $b): bool {
    foreach ($edges as $e) {
        $from = (string) ($e['from'] ?? '');
        $to   = (string) ($e['to']   ?? '');
        if (($from === $a && $to === $b) || ($from === $b && $to === $a)) {
            return true;
        }
    }
    return false;
}

$hosts = [
    'h1' => ['host' => 'sw-core', 'name' => 'Core Switch'],
    'h2' => ['host' => 'sw-acc1', 'name' => 'Access 1'],
    'h3' => ['host' => 'fw-01',   'name' => 'Firewall'],
];

$lldp_raw = [
    // h2 meldet "sw-core" — exakter technischer Name        -> Kante h2–h1
    ['hostid' => 'h2', 'key_' => 'lldpRemSysName', 'lastvalue' => 'sw-core',            'src' => 'lldp'],
    // h3 meldet "SW-CORE.fritz.box" — GROSS + FQDN          -> trotzdem Kante h3–h1
    ['hostid' => 'h3', 'key_' => 'lldpRemSysName', 'lastvalue' => 'SW-CORE.fritz.box',  'src' => 'lldp'],
    // h1 meldet ein Geraet, das Zabbix gar nicht kennt      -> KEINE Kante, unmatched
    ['hostid' => 'h1', 'key_' => 'lldpRemSysName', 'lastvalue' => 'printer-xyz',        'src' => 'lldp'],
];

$r     = LldpEdgeBuilder::build($hosts, $lldp_raw);
$edges = $r['edges'];

echo "\nNachbar-Zuordnung\n";
check('exakter technischer Name -> Kante',            hasEdge($edges, 'h2', 'h1'), true);
check('GROSSSCHREIBUNG + FQDN -> trotzdem Kante',     hasEdge($edges, 'h3', 'h1'), true);
check('genau 2 Kanten (kein Doppel, keine Selbst)',   count($edges),               2);

echo "\nUnbekannter Nachbar\n";
// Dass er KEINE Falschkante erzeugt, beweist bereits count($edges) === 2 oben:
// waere "printer-xyz" faelschlich auf einen Host gematcht worden, gaebe es 3.
check('landet in unmatched',                          count($r['unmatched']),      1);
check('und zwar namentlich',
      strpos(strtolower(json_encode($r['unmatched'])), 'printer-xyz') !== false, true);

echo "\nQualitaets-Statistik\n";
check('quality wird gefuellt',                        count($r['quality']) > 0,    true);

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
