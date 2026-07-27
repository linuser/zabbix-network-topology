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

// ── §3-Polish (v4.35.1): CDP-Index, Desc-Fallbacks, No-Match, Merge ────────
echo "\n§3 CDP-Index (2-teilig: erster Teil = ifIndex)\n";
$hCdp  = ['csw' => ['host' => 'csw', 'name' => 'csw'], 'srv' => ['host' => 'srv', 'name' => 'srv']];
$rawCdp = [['hostid' => 'csw', 'key_' => 'cdpCacheDeviceId[7.4]', 'lastvalue' => 'srv', 'src' => 'cdp']];
$rCdp  = LldpEdgeBuilder::build($hCdp, $rawCdp,
    ['csw' => ['7.4' => ['desc' => 'GigabitEthernet0/1']]],   // Remote-Port (CDP)
    ['csw' => ['7' => ['in' => 200000000.0, 'out' => 100000000.0]]],  // Traffic auf ifIndex 7
    ['csw' => ['7' => 1.0e9]]);
$eCdp  = findEdge($rCdp['edges'], 'csw', 'srv') ?? [];
check('CDP lokaler Port = erster Index-Teil (ifIndex)', $eCdp['ports']['csw'] ?? null, '7');
check('CDP Remote-Port (cdpCacheDevicePort)',           $eCdp['ports']['srv'] ?? null, 'GigabitEthernet0/1');
check('CDP Per-Link-Traffic korreliert auf ifIndex 7',  $eCdp['port_metrics']['csw']['in'] ?? null, 200000000.0);

echo "\n§3 Remote-Port-Fallback (leerer/whitespace PortDesc → PortId)\n";
$hFb   = ['a' => ['host'=>'a','name'=>'a'], 'b' => ['host'=>'b','name'=>'b'], 'c' => ['host'=>'c','name'=>'c']];
$rawFb = [['hostid'=>'a','key_'=>'lldpRemSysName[0.8.1]','lastvalue'=>'b','src'=>'lldp'],
          ['hostid'=>'a','key_'=>'lldpRemSysName[0.9.1]','lastvalue'=>'c','src'=>'lldp']];
$rFb   = LldpEdgeBuilder::build($hFb, $rawFb, ['a' => [
            '0.8.1' => ['id' => 'Gi0/8', 'desc' => ''],       // leerer Desc → PortId
            '0.9.1' => ['id' => 'Gi0/9', 'desc' => '   ']]]); // whitespace Desc → PortId
check('leerer PortDesc → PortId-Fallback',      (findEdge($rFb['edges'],'a','b') ?? [])['ports']['b'] ?? null, 'Gi0/8');
check('whitespace PortDesc → PortId-Fallback',  (findEdge($rFb['edges'],'a','c') ?? [])['ports']['c'] ?? null, 'Gi0/9');

echo "\n§3 Kein ifIndex-Match → Kante mit Label, aber ohne Metrik\n";
$rNm = LldpEdgeBuilder::build($hFb,
    [['hostid'=>'a','key_'=>'lldpRemSysName[0.77.1]','lastvalue'=>'b','src'=>'lldp']],
    ['a' => ['0.77.1' => ['desc' => 'Gi0/77']]],
    ['a' => ['8' => ['in'=>1.0,'out'=>2.0]]]);   // Traffic NUR fuer Port 8, nicht 77
$eNm = findEdge($rNm['edges'], 'a', 'b') ?? [];
check('lokaler Port bleibt trotz No-Match',     $eNm['ports']['a'] ?? null, '77');
check('Remote-Port bleibt trotz No-Match',      $eNm['ports']['b'] ?? null, 'Gi0/77');
check('port_metrics leer bei No-Match',         $eNm['port_metrics'] ?? null, []);

echo "\n§3 Merge: beidseitig gemeldete Kante bekommt BEIDE Metriken\n";
$hM   = ['A' => ['host'=>'A','name'=>'A'], 'B' => ['host'=>'B','name'=>'B']];
$rawM = [['hostid'=>'A','key_'=>'lldpRemSysName[0.8.1]','lastvalue'=>'B','src'=>'lldp'],
         ['hostid'=>'B','key_'=>'lldpRemSysName[0.3.1]','lastvalue'=>'A','src'=>'lldp']];
$rM   = LldpEdgeBuilder::build($hM, $rawM,
    ['A' => ['0.8.1' => ['desc' => 'to-B']], 'B' => ['0.3.1' => ['desc' => 'to-A']]],
    ['A' => ['8' => ['in'=>10.0,'out'=>20.0]], 'B' => ['3' => ['in'=>30.0,'out'=>40.0]]]);
$eM = findEdge($rM['edges'], 'A', 'B') ?? [];
check('beidseitige Kante bleibt EINE',                   count($rM['edges']), 1);
check('Merge: Metrik des 1. Reporters (A) da',           $eM['port_metrics']['A']['in'] ?? null, 10.0);
check('Merge: Metrik des 2. Reporters (B) angehaengt',   $eM['port_metrics']['B']['in'] ?? null, 30.0);

// ── UniFi: UUID-Uplink loest ueber das normale Namens-Matching auf ────────
// Nachgebildet aus echten Daten: das UniFi-Template benennt Hosts technisch
// nach der Geraete-UUID, und uplink.id enthaelt genau diese UUID des Uplinks.
// Damit braucht es KEINE Sonderlogik — der bestehende Matcher trifft.
echo "\nUniFi uplink.id -> Kante\n";
$hU = [
    'sw'  => ['host' => 'edd7d002-b7b6-3675-8663-608ae2466f0b', 'name' => 'HSINSW02'],
    'cli' => ['host' => '74f8d353-6b79-3645-81c1-9376cdc8ea42', 'name' => 'npu 2d:23'],
];
$rawU = [['hostid' => 'cli', 'key_' => 'uplink.id',
          'lastvalue' => 'edd7d002-b7b6-3675-8663-608ae2466f0b', 'src' => 'unifi']];
$rU = LldpEdgeBuilder::build($hU, $rawU);
check('UUID matcht technischen Hostnamen -> Kante', hasEdge($rU['edges'], 'cli', 'sw'), true);
check('genau eine Kante',                           count($rU['edges']),               1);
check('Quelle als unifi markiert',   ($rU['edges'][0]['src'] ?? [])[0] ?? null,        'unifi');
// Zeigt der Uplink auf ein Geraet, das NICHT ueberwacht wird (nicht in $hosts),
// entsteht keine Kante — der Wert landet als unmatched (→ §9-Ghost, wenn an).
$rU2 = LldpEdgeBuilder::build($hU,
    [['hostid' => 'cli', 'key_' => 'uplink.id', 'lastvalue' => 'aaaaaaaa-0000-0000-0000-000000000000', 'src' => 'unifi']]);
check('unbekannter Uplink -> keine Kante',  count($rU2['edges']),      0);
check('unbekannter Uplink -> unmatched',    count($rU2['unmatched']),  1);

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
