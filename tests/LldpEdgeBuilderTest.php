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
    return findEdge($edges, $a, $b) !== null;
}

/** Liefert die Kante zwischen zwei Hosts (Richtung egal) oder null. */
function findEdge(array $edges, string $a, string $b): ?array {
    foreach ($edges as $e) {
        $from = (string) ($e['from'] ?? '');
        $to   = (string) ($e['to']   ?? '');
        if (($from === $a && $to === $b) || ($from === $b && $to === $a)) {
            return $e;
        }
    }
    return null;
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

// ── §3 Port-zu-Port ──────────────────────────────────────────────────────
// Nachgebildet aus dem echten Aruba-Walk (192.168.33.4): der Switch meldet an
// lokalem Port 8 den Nachbarn "pve" mit Remote-Port "nic0" (PortDesc; PortId
// waere eine MAC), an Port 20 den TP-Link mit Remote-Port aus PortId (kein
// PortDesc). ifIndex == lokaler Port → Per-Link-Traffic haengt am Reporter.
echo "\n§3 Port-zu-Port\n";
$hosts3 = [
    'aruba' => ['host' => 'HP24GARUBA', 'name' => 'HP24GARUBA'],
    'pve'   => ['host' => 'pve',        'name' => 'pve.fuchsbau.lan'],
    'tp'    => ['host' => 'TL-SG2008P', 'name' => 'TL-SG2008P'],
];
$lldp_raw3 = [
    ['hostid' => 'aruba', 'key_' => 'lldpRemSysName[0.8.1]',  'lastvalue' => 'pve.fuchsbau.lan', 'src' => 'lldp'],
    ['hostid' => 'aruba', 'key_' => 'lldpRemSysName[0.20.2]', 'lastvalue' => 'TL-SG2008P',       'src' => 'lldp'],
];
$lldp_ports3 = [
    'aruba' => [
        '0.8.1'  => ['id' => '3C EC EF 79 2C 88', 'desc' => 'nic0'],   // PortDesc gewinnt vor MAC
        '0.20.2' => ['id' => 'gigabitEthernet 1/0/8'],                 // nur PortId → Fallback
    ],
];
$port_traffic3 = [
    'aruba' => ['8' => ['in' => 1000000.0, 'out' => 2000000.0],
                '20' => ['in' => 500000.0, 'out' => 750000.0]],
];
$port_speed3 = ['aruba' => ['8' => 1.0e9, '20' => 1.0e9]];

$r3    = LldpEdgeBuilder::build($hosts3, $lldp_raw3, $lldp_ports3, $port_traffic3, $port_speed3);
$e_pve = findEdge($r3['edges'], 'aruba', 'pve') ?? [];
$e_tp  = findEdge($r3['edges'], 'aruba', 'tp')  ?? [];

check('lokaler Port aus SNMPINDEX (Reporter-Ende)',   $e_pve['ports']['aruba'] ?? null, '8');
check('Remote-Port am Nachbar-Ende (PortDesc)',        $e_pve['ports']['pve']   ?? null, 'nic0');
check('PortDesc gewinnt vor PortId (MAC)',
      ($e_pve['ports']['pve'] ?? '') !== '3C EC EF 79 2C 88', true);
check('PortId-Fallback wenn kein PortDesc',            $e_tp['ports']['tp']     ?? null, 'gigabitEthernet 1/0/8');
check('Per-Link-Traffic in (bps)',   $e_pve['port_metrics']['aruba']['in']    ?? null, 1000000.0);
check('Per-Link-Traffic out (bps)',  $e_pve['port_metrics']['aruba']['out']   ?? null, 2000000.0);
check('Per-Link-Speed als Divisor',  $e_pve['port_metrics']['aruba']['speed'] ?? null, 1.0e9);

// Ohne §3-Maps (alte Aufrufer): keine Port-/Metrik-Felder, aber auch kein Crash.
$r3b = LldpEdgeBuilder::build($hosts3, $lldp_raw3);
$e2  = findEdge($r3b['edges'], 'aruba', 'pve') ?? [];
check('Abwaertskompat: lokaler Port bleibt',           $e2['ports']['aruba'] ?? null, '8');
check('Abwaertskompat: kein Remote-Port ohne Map',     isset($e2['ports']['pve']),    false);
check('Abwaertskompat: leere port_metrics',            $e2['port_metrics'] ?? null,   []);

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
