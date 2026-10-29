<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\VlanParser.
 *
 * Die heikle Stelle ist das Dekodieren der 802.1Q-PortList-Bitmaske: eine
 * falsch gelesene Maske (falsche Bit-Reihenfolge, vergessene Bridge-Port->
 * ifIndex-Aufloesung) behauptet eine Verkabelung, die es nicht gibt. Die
 * Fixtures hier sind die am 2026-10-28 an einem HPE Instant On 1830 gemessenen
 * Faelle, als Bitmuster nachgebaut (keine echten Kundendaten): VLAN 1 = Ports
 * 1–26, ein getaggtes VLAN nur auf dem Uplink-Port 24.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP.
 *
 * Aufruf:  php tests/VlanParserTest.php
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

use Modules\NetworkTopology\Topology\VlanParser;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-54s got=%-28s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

// ── decodeMask: die Bit-Reihenfolge (Port 1 = MSB von Byte 0) ───────────────
check('leere Maske -> keine Ports',          VlanParser::decodeMask(''), []);
check('0x80 -> Port 1 (MSB)',                VlanParser::decodeMask('80'), [1]);
check('0x01 -> Port 8 (LSB)',                VlanParser::decodeMask('01'), [8]);
check('0xA0 -> Ports 1 und 3',               VlanParser::decodeMask('A0'), [1, 3]);
// Byte 2 (Ports 17-24), LSB gesetzt -> Port 24 — der getaggte Uplink im Feld.
check('000001 -> Port 24 (Uplink)',          VlanParser::decodeMask('000001'), [24]);
// Robust gegen Leerzeichen (snmpwalk-Ausgabe) und ungerade Hex-Laenge.
check('Leerzeichen werden ignoriert',        VlanParser::decodeMask('00 00 01'), [24]);
check('ungerade Hex-Laenge stuerzt nicht ab', VlanParser::decodeMask('F'), []);

// VLAN 1 = Ports 1–26: FF FF FF C0 (Rest 0), 16 Byte breit wie beim HPE.
$mask1  = 'FFFFFFC0' . str_repeat('00', 12);
check('VLAN-1-Maske -> Ports 1..26',         VlanParser::decodeMask($mask1), range(1, 26));

// ── membership: Maske -> ifIndex ueber dot1dBasePortIfIndex ─────────────────
$basePortIfIndex = [];
for ($p = 1; $p <= 26; $p++) {
    $basePortIfIndex[$p] = 100 + $p;              // Bridge-Port p -> ifIndex 100+p
}
$egress = [
    1  => $mask1,          // alle 26 Ports
    55 => '000001',        // nur Port 24
    99 => '00000004',      // Port 30 — NICHT in der Bridge-Tabelle (nur 1..26)
];
$mem = VlanParser::membership($egress, $basePortIfIndex);
check('VLAN 1 -> ifIndizes 101..126',        $mem[1], array_map(static fn($p) => 100 + $p, range(1, 26)));
check('VLAN 55 -> nur ifIndex 124',          $mem[55], [124]);
check('unaufloesbarer Bridge-Port faellt weg', $mem[99], []);

// ── accessVlans: PVID je Port, direkter Join ────────────────────────────────
$pvid = [1 => 1, 24 => 55, 30 => 66];            // Port 30 wieder ohne ifIndex
$acc  = VlanParser::accessVlans($pvid, $basePortIfIndex);
check('PVID: ifIndex 101 im Default-VLAN 1',  $acc[101] ?? null, 1);
check('PVID: ifIndex 124 Access-VLAN 55',     $acc[124] ?? null, 55);
check('PVID: unaufloesbarer Port faellt weg',  in_array(66, $acc, true), false);

// ── parseWalk + vlansForHost: echtes Walk-Format, erfundene VLANs ────────────
// Format wie der HPE-Walk (snmpwalk -On): leerer Name als `= ""`, Hex-STRING mit
// Trailing-Space, CurrentEgress-Index als {TimeMark}.{VLAN}. Namen/VLANs erfunden.
$walk = <<<'WALK'
.1.3.6.1.2.1.17.7.1.4.3.1.1.1 = ""
.1.3.6.1.2.1.17.7.1.4.3.1.1.10 = STRING: office
.1.3.6.1.2.1.17.7.1.4.3.1.1.20 = STRING: voice
.1.3.6.1.2.1.17.7.1.4.3.1.2.1 = Hex-STRING: C0 00 00 00
.1.3.6.1.2.1.17.7.1.4.3.1.2.10 = Hex-STRING: 30 00 00 00
.1.3.6.1.2.1.17.7.1.4.2.1.4.0.20 = Hex-STRING: 00 80 00 00
.1.3.6.1.2.1.17.7.1.4.5.1.1.1 = Gauge32: 1
.1.3.6.1.2.1.17.7.1.4.5.1.1.3 = Gauge32: 10
.1.3.6.1.2.1.17.1.4.1.2.1 = INTEGER: 101
.1.3.6.1.2.1.17.1.4.1.2.2 = INTEGER: 102
.1.3.6.1.2.1.17.1.4.1.2.3 = INTEGER: 103
.1.3.6.1.2.1.17.1.4.1.2.4 = INTEGER: 104
.1.3.6.1.2.1.17.1.4.1.2.9 = INTEGER: 109
.1.3.6.1.2.1.31.1.1.1.1.101 = STRING: Gi1
.1.3.6.1.2.1.31.1.1.1.1.103 = STRING: Gi3
WALK;

$p = VlanParser::parseWalk($walk);
check('parseWalk: leerer Name als ""',         $p['name'][1] ?? 'X', '');
check('parseWalk: Name office',                $p['name'][10] ?? null, 'office');
check('parseWalk: static Egress-Maske',        $p['egressStatic'][1] ?? null, 'C0 00 00 00');
check('parseWalk: current-Index -> VLAN 20',   $p['egressCurrent'][20] ?? null, '00 80 00 00');
check('parseWalk: PVID Bridge-Port 3',         $p['pvid'][3] ?? null, '10');
check('parseWalk: baseport 3 -> ifIndex 103',  $p['baseport'][3] ?? null, '103');
check('parseWalk: ifName 101',                 $p['ifname'][101] ?? null, 'Gi1');

$h = VlanParser::vlansForHost($walk);
$byId = [];
foreach ($h['vlans'] as $v) {
    $byId[$v['id']] = $v;
}
check('vlansForHost: drei VLANs',              count($h['vlans']), 3);
check('VLAN 1 Ports (ifName, sonst ifIndex)',  $byId[1]['ports'] ?? null, ['Gi1', '102']);
check('VLAN 10 heisst office',                 $byId[10]['name'] ?? null, 'office');
check('VLAN 10 Ports Gi3 + 104',               $byId[10]['ports'] ?? null, ['Gi3', '104']);
check('VLAN 20 nur ueber current egress',      $byId[20]['ports'] ?? null, ['109']);
check('access: ifIndex 101 -> VLAN 1',         $h['access'][101] ?? null, 1);
check('access: ifIndex 103 -> VLAN 10',        $h['access'][103] ?? null, 10);
check('byIfIndex: ifIndex 101 -> [VLAN 1]',    $h['byIfIndex'][101] ?? null, [1]);
check('byIfIndex: ifIndex 103 -> [VLAN 10]',   $h['byIfIndex'][103] ?? null, [10]);
check('byIfIndex: ifIndex 109 -> [VLAN 20]',   $h['byIfIndex'][109] ?? null, [20]);

// ── annotateEdges: VLAN je Kante, „mindestens ein Ende" ─────────────────────
$vlanByHost = [
    'A' => [10 => [100, 200], 11 => [100]],   // if10 auf VLAN 100+200, if11 auf 100
    'B' => [20 => [200]],                       // if20 auf VLAN 200
];
$edges = [
    ['source' => 'A', 'target' => 'B', 'port_idx' => ['A' => 10, 'B' => 20]], // Union 100,200
    ['source' => 'A', 'target' => 'C', 'port_idx' => ['A' => 11, 'C' => 5]],  // nur A-Ende -> 100
    ['source' => 'D', 'target' => 'E', 'port_idx' => ['D' => 1,  'E' => 2]],  // keine VLAN-Daten
    ['source' => 'A', 'target' => 'B'],                                        // kein port_idx
];
$ann = VlanParser::annotateEdges($edges, $vlanByHost);
check('edge A-B: Union beider Enden',          $ann[0]['vlans'] ?? null, [100, 200]);
check('edge A-C: ein Ende reicht',             $ann[1]['vlans'] ?? null, [100]);
check('edge D-E: keine VLAN-Daten -> unset',   isset($ann[2]['vlans']), false);
check('edge ohne port_idx -> unset',           isset($ann[3]['vlans']), false);
check('leere vlanByHost: Kanten unveraendert', VlanParser::annotateEdges($edges, []), $edges);

echo "\n";
if ($failures > 0) {
    fwrite(STDERR, "✖ {$failures} Fehlschlag(e).\n");
    exit(1);
}
echo "✓ VlanParser: Bit-Reihenfolge, Bridge-Port->ifIndex, PVID — Masken-Dekodierung belegt.\n";
