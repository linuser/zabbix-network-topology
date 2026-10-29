<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\FaceplateBuilder.
 *
 * Prueft, was auf der Frontansicht landet: welche Interfaces Buchsen sind,
 * welcher Zuschnitt bei "auto" gewaehlt wird, Kupfer/SFP-Aufteilung, und dass
 * Status, Speed, Alias, PoE und LLDP-Nachbar am richtigen Port ankommen —
 * in beiden Key-Schreibweisen der gaengigen SNMP-Templates.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP.
 *
 * Aufruf:  php tests/FaceplateBuilderTest.php
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

use Modules\NetworkTopology\Topology\FaceplateBuilder;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-58s got=%-22s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

/**
 * Ein Switch im Stil von "Network Generic Device by SNMP": n Ports mit
 * ifType 6, dazu VLAN- und Loopback-Interfaces, die NICHT auf die Front gehoeren.
 */
function genericSwitch(int $n, array $down = []): array {
    $items = [];
    $id = 1000;
    for ($i = 1; $i <= $n; $i++) {
        $nm = 'Interface ' . $i . ($i === 3 ? '(Drucker)' : '()') . ': ';
        $items[] = ['itemid' => (string) $id++, 'key_' => 'net.if.status[ifOperStatus.' . $i . ']',
                    'name' => $nm . 'Operational status', 'lastvalue' => in_array($i, $down, true) ? '2' : '1'];
        $items[] = ['itemid' => (string) $id++, 'key_' => 'net.if.type[ifType.' . $i . ']',
                    'name' => $nm . 'Interface type', 'lastvalue' => '6'];
        $items[] = ['itemid' => (string) $id++, 'key_' => 'net.if.speed[ifHighSpeed.' . $i . ']',
                    'name' => $nm . 'Speed', 'lastvalue' => '1000000000'];
        $items[] = ['itemid' => (string) $id++, 'key_' => 'net.if.in[ifHCInOctets.' . $i . ']',
                    'name' => $nm . 'Bits received', 'lastvalue' => '2000'];
    }
    foreach ([100 => 'DEFAULT_VLAN', 200 => 'lo0'] as $ix => $name) {
        $items[] = ['itemid' => (string) $id++, 'key_' => 'net.if.status[ifOperStatus.' . $ix . ']',
                    'name' => 'Interface ' . $name . '(): Operational status', 'lastvalue' => '1'];
        $items[] = ['itemid' => (string) $id++, 'key_' => 'net.if.type[ifType.' . $ix . ']',
                    'name' => 'Interface ' . $name . '(): Interface type', 'lastvalue' => $ix === 100 ? '53' : '24'];
    }
    return $items;
}

/**
 * TP-Link TL-SG2008P (JetStream 8-Port, 4-Port PoE+): 8 echte Ports, benannt
 * "gigabitEthernet 1/0/1..8", DAZU ein "Vlan-interface1", das der Switch
 * faelschlich als ethernetCsmacd(6) meldet (nicht als propVirtual/l3ipvlan).
 * Ohne Namens-Filter trotz ifType rutscht das VLAN-IF als Frontport durch: die
 * Namens-Endziffer kollidiert (VLAN "1" vs Port "1/0/1" -> "1"), die
 * Nummerierung faellt auf Position zurueck, max wird 9 -> Zuschnitt 8+2 mit
 * zwei erfundenen SFP-Schaechten. Gemessen an 192.0.2.5 am 2026-10-16.
 */
function tplinkSwitch(): array {
    $items = [];
    $id = 2000;
    // VLAN-Interface, ifIndex 1, ifType 6 (die Fehlmeldung, die dieser Test deckt).
    $items[] = ['itemid' => (string) $id++, 'key_' => 'net.if.status[ifOperStatus.1]',
                'name' => 'Interface Vlan-interface1(): Operational status', 'lastvalue' => '1'];
    $items[] = ['itemid' => (string) $id++, 'key_' => 'net.if.type[ifType.1]',
                'name' => 'Interface Vlan-interface1(): Interface type', 'lastvalue' => '6'];
    // 8 echte Ports, ifIndex 49153..49160, Namen gigabitEthernet 1/0/1..8.
    for ($p = 1; $p <= 8; $p++) {
        $ix = 49152 + $p;
        $nm = 'Interface gigabitEthernet 1/0/' . $p . '(): ';
        $items[] = ['itemid' => (string) $id++, 'key_' => 'net.if.status[ifOperStatus.' . $ix . ']',
                    'name' => $nm . 'Operational status', 'lastvalue' => '1'];
        $items[] = ['itemid' => (string) $id++, 'key_' => 'net.if.type[ifType.' . $ix . ']',
                    'name' => $nm . 'Interface type', 'lastvalue' => '6'];
        $items[] = ['itemid' => (string) $id++, 'key_' => 'net.if.speed[ifHighSpeed.' . $ix . ']',
                    'name' => $nm . 'Speed', 'lastvalue' => '1000000000'];
    }
    return $items;
}

echo "Zuschnitt\n";
check('auto 26 -> 24+2', FaceplateBuilder::pickLayout(26, 'auto'), ['24+2', 24, 2]);
check('auto 28 -> 24+4', FaceplateBuilder::pickLayout(28, 'auto'), ['24+4', 24, 4]);
check('auto 52 -> 48+4', FaceplateBuilder::pickLayout(52, 'auto'), ['48+4', 48, 4]);
check('auto 54 -> 48+6', FaceplateBuilder::pickLayout(54, 'auto'), ['48+6', 48, 6]);
check('auto 24 ohne Uplinks -> 24+0', FaceplateBuilder::pickLayout(24, 'auto'), ['24+0', 24, 0]);
check('auto 10 -> 8+2', FaceplateBuilder::pickLayout(10, 'auto'), ['8+2', 8, 2]);
check('auto 60 -> alles Kupfer', FaceplateBuilder::pickLayout(60, 'auto'), ['60+0', 60, 0]);
check('auto 20 -> reine Kupferfront, keine erfundenen Schaechte', FaceplateBuilder::pickLayout(20, 'auto'), ['20+0', 20, 0]);
check('auto 9 -> 8+2 (Port 9 liegt im SFP-Teil)', FaceplateBuilder::pickLayout(9, 'auto'), ['8+2', 8, 2]);
check('auto 25 -> 24+2 (eine SFP fehlt)', FaceplateBuilder::pickLayout(25, 'auto'), ['24+2', 24, 2]);
check('auto 11 -> 12+0 (ungerade aufgerundet)', FaceplateBuilder::pickLayout(11, 'auto'), ['12+0', 12, 0]);
check('fester Zuschnitt gewinnt', FaceplateBuilder::pickLayout(26, '48+4'), ['48+4', 48, 4]);

echo "\nKey-Erkennung\n";
check('net.if.status[ifOperStatus.7]', FaceplateBuilder::ifKey('net.if.status[ifOperStatus.7]'), ['oper', '7']);
check('ifOperStatus[7]', FaceplateBuilder::ifKey('ifOperStatus[7]'), ['oper', '7']);
check('net.if.status[7] (Index nackt)', FaceplateBuilder::ifKey('net.if.status[7]'), ['oper', '7']);
check('net.if.in.errors[24]', FaceplateBuilder::ifKey('net.if.in.errors[24]'), ['errors', '24']);
check('ifHighSpeed nicht als ifSpeed', FaceplateBuilder::ifKey('net.if.speed[ifHighSpeed.3]'), ['hspeed', '3']);
check('fremder Key', FaceplateBuilder::ifKey('system.cpu.util'), null);
check('net.if.speed[49] ist schon bit/s', FaceplateBuilder::ifKey('net.if.speed[49]'), ['bps', '49']);
check('ifInOctets ist 32-Bit', FaceplateBuilder::ifKey('ifInOctets.4'), ['in32', '4']);

echo "\n24+2-Switch (HPE 1830)\n";
$r = FaceplateBuilder::build(genericSwitch(26, [2, 5]));
check('Layout auto', $r['layout'], '24+2');
check('26 Ports, VLAN + Loopback raus', count($r['ports']), 26);
check('Port 24 ist Kupfer', $r['ports'][23]['kind'], 'rj45');
check('Port 25 ist SFP', $r['ports'][24]['kind'], 'sfp');
check('Port 2 down', $r['ports'][1]['oper'], 2);
check('Port 1 up', $r['ports'][0]['oper'], 1);
check('Alias aus Item-Name', $r['ports'][2]['alias'], 'Drucker');
check('Name aus Item-Name', $r['ports'][2]['name'], '3');
check('Speed 1 Gbit', $r['ports'][0]['speed'], 1.0e9);
check('Traffic bit/s (net.if schon *8)', $r['ports'][0]['in'], 2000.0);
check('Status-Item gemerkt', $r['ports'][0]['itemid'], '1000');
check('keine Ueberzaehligen', $r['extra'], 0);

echo "\nSTP-Portzustand (nt.if.stp) auf die Buchse\n";
$items = genericSwitch(26, []);
$items[] = ['itemid' => '9001', 'key_' => 'nt.if.stp[1]', 'name' => 'STP port state', 'lastvalue' => '5'];
$items[] = ['itemid' => '9002', 'key_' => 'nt.if.stp[2]', 'name' => 'STP port state', 'lastvalue' => '2'];
$r = FaceplateBuilder::build($items);
check('Port 1 forwarding -> stp 5', $r['ports'][0]['stp'], 5);
check('Port 2 blocking -> stp 2', $r['ports'][1]['stp'], 2);
check('Port 3 ohne STP-Item -> stp -1', $r['ports'][2]['stp'], -1);

echo "\nSelbst-Loop: Partner-Port aus nt.stp.walk an die Front\n";
$items = genericSwitch(26, []);
$items[] = ['itemid' => '9101', 'key_' => 'nt.if.stp[23]', 'name' => 'STP port state', 'lastvalue' => '2'];
// nt.stp.walk: Loop 21<->23, Bridge-Port == ifIndex, Base-MAC 02:00:00:38:0f:c0.
$walk = implode("\n", [
    '.1.3.6.1.2.1.17.1.1.0 = Hex-STRING: 02 00 00 38 0F C0',
    '.1.3.6.1.2.1.17.2.15.1.3.23 = INTEGER: 2',
    '.1.3.6.1.2.1.17.1.4.1.2.23 = INTEGER: 23',
    '.1.3.6.1.2.1.17.2.15.1.8.23 = Hex-STRING: 80 00 02 00 00 38 0F C0',
    '.1.3.6.1.2.1.17.2.15.1.9.23 = Hex-STRING: 80 15',
    '.1.3.6.1.2.1.17.1.4.1.2.21 = INTEGER: 21',
]);
$items[] = ['itemid' => '9102', 'key_' => 'nt.stp.walk', 'name' => 'STP walk', 'lastvalue' => $walk];
$r = FaceplateBuilder::build($items);
check('geblockter Port 23 kennt Partner-Front 21', $r['ports'][22]['loop_partner'], 21);
check('weiterleitender Port 21 ist Partner von 23', $r['ports'][20]['loop_partner_of'], 23);
check('Port 23 ist nicht sein eigener loop_partner_of', $r['ports'][22]['loop_partner_of'], null);
check('unbeteiligter Port 1 ohne Partner', $r['ports'][0]['loop_partner'], null);
check('ohne nt.stp.walk kein Partner', FaceplateBuilder::build(genericSwitch(26, []))['ports'][0]['loop_partner'], null);

echo "\nDown-Port in discarding(2) ist KEIN geblockter Loop (RouterOS)\n";
// Port 3 ist down; der Switch meldet trotzdem dot1dStpPortState 2. Das Badge
// darf NICHT erscheinen -- sonst traegt jede tote Buchse ein STP-Block.
$items = genericSwitch(26, [3]);
$items[] = ['itemid' => '9201', 'key_' => 'nt.if.stp[3]', 'name' => 'STP port state', 'lastvalue' => '2'];
$r = FaceplateBuilder::build($items);
check('Port 3 down + state 2 -> stp -1 (kein Badge)', $r['ports'][2]['stp'], -1);
check('Port 3 ist auch wirklich down', $r['ports'][2]['oper'], 2);
// Gegenprobe: derselbe Zustand an einem UP-Port bleibt 2 (echter Block).
$items = genericSwitch(26, []);
$items[] = ['itemid' => '9202', 'key_' => 'nt.if.stp[3]', 'name' => 'STP port state', 'lastvalue' => '2'];
check('Port 3 up + state 2 -> stp 2 (echter Block)', FaceplateBuilder::build($items)['ports'][2]['stp'], 2);

echo "\nTP-Link TL-SG2008P: VLAN-Interface als ethernetCsmacd(6) nicht als Front zaehlen\n";
$r = FaceplateBuilder::build(tplinkSwitch());
check('8 Ports -- VLAN raus trotz ifType 6', count($r['ports']), 8);
check('Layout 8+0 (keine erfundenen SFP)', $r['layout'], '8+0');
check('kein SFP-Schacht', $r['sfp'], 0);
check('Port 8 ist Kupfer, nicht SFP 9', $r['ports'][7]['kind'], 'rj45');
check('Port 1 ist der echte 1/0/1, nicht das VLAN-IF', $r['ports'][0]['name'], 'gigabitEthernet 1/0/1');

/**
 * Echter Stacking-Port "Stack9" (ifType 6). Anders als ein VLAN-IF darf der
 * NICHT als virtuell verworfen werden: stack/mgmt/oob stehen bewusst nicht im
 * strikten Muster, weil sie echte Buchsen sein koennen. Ein als ethernetCsmacd
 * gemeldeter Name, der NUR in der breiten Liste steht, bleibt also erhalten.
 */
function switchWithStackPort(): array {
    $items = [];
    $id = 3000;
    for ($p = 1; $p <= 8; $p++) {
        $nm = 'Interface gigabitEthernet 1/0/' . $p . '(): ';
        $items[] = ['itemid' => (string) $id++, 'key_' => 'net.if.status[ifOperStatus.' . $p . ']',
                    'name' => $nm . 'Operational status', 'lastvalue' => '1'];
        $items[] = ['itemid' => (string) $id++, 'key_' => 'net.if.type[ifType.' . $p . ']',
                    'name' => $nm . 'Interface type', 'lastvalue' => '6'];
    }
    $items[] = ['itemid' => (string) $id++, 'key_' => 'net.if.status[ifOperStatus.9]',
                'name' => 'Interface Stack9(): Operational status', 'lastvalue' => '1'];
    $items[] = ['itemid' => (string) $id++, 'key_' => 'net.if.type[ifType.9]',
                'name' => 'Interface Stack9(): Interface type', 'lastvalue' => '6'];
    return $items;
}

echo "\nStacking-/OOB-/mgmt-Port mit ifType 6 bleibt (nur eindeutig virtuelle Namen fliegen)\n";
$r = FaceplateBuilder::build(switchWithStackPort());
check('Stack-Port NICHT verworfen -> 9 Ports -> 8+2', $r['layout'], '8+2');
check('Port 9 ist der Stack-Port', $r['ports'][8]['name'], 'Stack9');

echo "\n52-Port-Switch, Zuschnitt zu klein gewaehlt\n";
$r = FaceplateBuilder::build(genericSwitch(52), '24+4');
check('auf 28 gekappt', count($r['ports']), 28);
check('24 ueberzaehlig gemeldet', $r['extra'], 24);
$r = FaceplateBuilder::build(genericSwitch(52));
check('auto -> 48+4', $r['layout'], '48+4');
check('Port 49 ist SFP', $r['ports'][48]['kind'], 'sfp');

echo "\nOhne ifType: Name entscheidet\n";
$items = [
    ['itemid' => '1', 'key_' => 'net.if.status[1]', 'name' => 'Interface Gi1/0/1(): Operational status', 'lastvalue' => '1'],
    ['itemid' => '2', 'key_' => 'net.if.status[2]', 'name' => 'Interface Vlan10(): Operational status', 'lastvalue' => '1'],
    ['itemid' => '3', 'key_' => 'net.if.status[3]', 'name' => 'Interface Port-channel1(): Operational status', 'lastvalue' => '1'],
];
$r = FaceplateBuilder::build($items);
check('nur Gi1/0/1 bleibt', count($r['ports']), 1);
check('Name Gi1/0/1', $r['ports'][0]['name'], 'Gi1/0/1');

echo "\nProbleme, PoE, LLDP\n";
$items = genericSwitch(26);
$items[] = ['itemid' => '9001', 'key_' => 'pethPsePortDetectionStatus[1.4]', 'name' => 'PoE 4', 'lastvalue' => '3'];
$items[] = ['itemid' => '9002', 'key_' => 'pethPsePortDetectionStatus[1.5]', 'name' => 'PoE 5', 'lastvalue' => '2'];
$items[] = ['itemid' => '9003', 'key_' => 'lldpRemSysName[0.25.1]', 'name' => 'x', 'lastvalue' => 'core-sw'];
$items[] = ['itemid' => '9004', 'key_' => 'lldpRemPortId[0.25.1]', 'name' => 'x', 'lastvalue' => 'aa:bb:cc:dd:ee:ff'];
$items[] = ['itemid' => '9005', 'key_' => 'lldpRemPortDesc[0.25.1]', 'name' => 'x', 'lastvalue' => 'Gi1/0/48'];
$items[] = ['itemid' => '9006', 'key_' => 'lldpRemPortId[0.7.1]', 'name' => 'x', 'lastvalue' => 'ohne Namen'];
// Status-Item von Port 2 ist itemid 1004 (vier Items je Port ab 1000).
$r = FaceplateBuilder::build($items, 'auto', ['1004' => 4]);
check('Problem an Port 2', $r['ports'][1]['problem'], 4);
check('kein Problem an Port 1', $r['ports'][0]['problem'], -1);
check('PoE an Port 4', $r['ports'][3]['poe'], true);
check('PoE gesucht, aber aus an Port 5', $r['ports'][4]['poe'], false);
check('PoE unbekannt an Port 6', $r['ports'][5]['poe'], null);
check('LLDP-Nachbar an Port 25', $r['ports'][24]['nb'], ['host' => 'core-sw', 'port' => 'Gi1/0/48']);
check('Nachbar ohne SysName verworfen', $r['ports'][6]['nb'], null);

echo "\nBefunde aus dem Review\n";

// 10G in der Cisco-/pfSense-Familie: net.if.speed[N] traegt schon bit/s.
$items = [
    ['itemid' => '1', 'key_' => 'net.if.status[49]', 'name' => 'Interface Te1/1/1(): Operational status', 'lastvalue' => '1'],
    ['itemid' => '2', 'key_' => 'net.if.speed[49]',  'name' => 'Interface Te1/1/1(): Speed', 'lastvalue' => '10000000000'],
];
$r = FaceplateBuilder::build($items);
check('net.if.speed 10G bleibt 1e10', $r['ports'][0]['speed'], 1.0e10);

// Port 5 ohne Wert, Port 7 ganz weg: keine Umnummerierung.
$items = array_values(array_filter(genericSwitch(26), static function (array $it): bool {
    return strpos($it['key_'], 'ifHighSpeed.7]') === false && strpos($it['key_'], 'ifOperStatus.7]') === false
        && strpos($it['key_'], 'ifType.7]') === false && strpos($it['key_'], 'ifHCInOctets.7]') === false;
}));
foreach ($items as &$it) {
    if (preg_match('/\.5\]$/', $it['key_'])) {
        $it['lastvalue'] = '';
    }
}
unset($it);
$r = FaceplateBuilder::build($items);
$nums = array_column($r['ports'], 'n');
check('Port 5 ohne Wert bleibt da', in_array(5, $nums, true), true);
check('Port 5 ohne Wert: oper 0', $r['ports'][4]['oper'], 0);
check('Port 7 fehlt als Luecke', in_array(7, $nums, true), false);
check('Port 8 behaelt Nummer 8', $r['ports'][6]['n'], 8);
check('Layout trotz Luecke 24+2', $r['layout'], '24+2');
check('Port 25 bleibt SFP', $r['ports'][23]['kind'], 'sfp');

// Stack: Namen 1/1..1/4 und 2/1..2/4 -> nicht eindeutig -> ifIndex.
$items = [];
foreach ([1 => '1/1', 2 => '1/2', 3 => '2/1', 4 => '2/2'] as $ix => $nm) {
    $items[] = ['itemid' => (string) $ix, 'key_' => 'net.if.status[ifOperStatus.' . $ix . ']',
                'name' => 'Interface ' . $nm . '(): Operational status', 'lastvalue' => '1'];
}
check('Stack-Namen -> Nummer aus ifIndex', array_column(FaceplateBuilder::build($items)['ports'], 'n'), [1, 2, 3, 4]);

// Cisco-ifIndex 10101..: relativ zum kleinsten.
$phys = ['10101' => ['name' => 'Gi1/0/1'], '10102' => ['name' => 'Gi1/0/2'],
         '10125' => ['name' => 'Te1/1/1'], '10126' => ['name' => 'Te1/1/2']];
check('Doppelte Namensnummern -> ifIndex relativ', FaceplateBuilder::portNumbers($phys),
    ['10101' => 1, '10102' => 2, '10125' => 25, '10126' => 26]);

// HC und 32-Bit nebeneinander: nicht doppelt.
$items = [
    ['itemid' => '1', 'key_' => 'net.if.status[ifOperStatus.3]', 'name' => 'Interface 3(): Operational status', 'lastvalue' => '1'],
    ['itemid' => '2', 'key_' => 'net.if.in[ifHCInOctets.3]', 'name' => 'Interface 3(): Bits received', 'lastvalue' => '100000000'],
    ['itemid' => '3', 'key_' => 'net.if.in[ifInOctets.3]',   'name' => 'Interface 3(): Bits received', 'lastvalue' => '100000000'],
    ['itemid' => '4', 'key_' => 'ifOutOctets.3',             'name' => 'x', 'lastvalue' => '1000'],
];
$r = FaceplateBuilder::build($items);
check('HC gewinnt, keine Doppelzaehlung', $r['ports'][0]['in'], 1.0e8);
check('nur 32-Bit: Octets * 8', $r['ports'][0]['out'], 8000.0);

// LLDP an einem LAG (ifIndex 5, virtuell) landet NICHT auf Frontport 5.
$items = genericSwitch(10);
$items[] = ['itemid' => '8001', 'key_' => 'net.if.status[ifOperStatus.205]', 'name' => 'Interface Trk1(): Operational status', 'lastvalue' => '1'];
$items[] = ['itemid' => '8002', 'key_' => 'net.if.type[ifType.205]', 'name' => 'Interface Trk1(): Interface type', 'lastvalue' => '161'];
$items[] = ['itemid' => '8003', 'key_' => 'lldpRemSysName[0.205.1]', 'name' => 'x', 'lastvalue' => 'lag-peer'];
$items[] = ['itemid' => '8004', 'key_' => 'lldpRemSysName[0.6.1]', 'name' => 'x', 'lastvalue' => 'ap-6'];
$r = FaceplateBuilder::build($items);
$hosts = [];
foreach ($r['ports'] as $p) {
    if ($p['nb']) $hosts[$p['n']] = $p['nb']['host'];
}
check('LAG-Nachbar nicht auf einem Frontport', $hosts, [6 => 'ap-6']);
// Portnummer als lldpLocPortNum (kein bekannter ifIndex): ueber die Nummer.
$items = [];
foreach ([1 => 'Gi1/0/1', 2 => 'Gi1/0/2'] as $ix => $nm) {
    $items[] = ['itemid' => (string) $ix, 'key_' => 'net.if.status[ifOperStatus.' . (100 + $ix) . ']',
                'name' => 'Interface ' . $nm . '(): Operational status', 'lastvalue' => '1'];
}
$items[] = ['itemid' => '9', 'key_' => 'lldpRemSysName[0.2.1]', 'name' => 'x', 'lastvalue' => 'by-number'];
$r = FaceplateBuilder::build($items);
check('lldpLocPortNum als Portnummer', $r['ports'][1]['nb']['host'] ?? null, 'by-number');

// PoE im Stack: Gruppe 2 ueberschreibt Gruppe 1 nicht.
$items = genericSwitch(8);
$items[] = ['itemid' => '9101', 'key_' => 'pethPsePortDetectionStatus[2.4]', 'name' => 'x', 'lastvalue' => '2'];
$items[] = ['itemid' => '9100', 'key_' => 'pethPsePortDetectionStatus[1.4]', 'name' => 'x', 'lastvalue' => '3'];
$r = FaceplateBuilder::build($items);
check('PoE Port 4 aus Gruppe 1', $r['ports'][3]['poe'], true);

echo "\nPoE: Klasse je Port + Switch-Budget\n";
$items = genericSwitch(26, []);
// group.port = 1.<front>; Port 5: Klasse-Rohwert 5 (class4), liefert Strom (3).
$items[] = ['itemid' => '9201', 'key_' => 'pethPsePortDetectionStatus.1.5',      'name' => 'x', 'lastvalue' => '3'];
$items[] = ['itemid' => '9202', 'key_' => 'pethPsePortPowerClassifications.1.5', 'name' => 'x', 'lastvalue' => '5'];
// Port 6: Klasse-Rohwert 1 (class0), liefert NICHT (detection 1).
$items[] = ['itemid' => '9203', 'key_' => 'pethPsePortDetectionStatus.1.6',      'name' => 'x', 'lastvalue' => '1'];
$items[] = ['itemid' => '9204', 'key_' => 'pethPsePortPowerClassifications.1.6', 'name' => 'x', 'lastvalue' => '1'];
$items[] = ['itemid' => '9205', 'key_' => 'nt.poe.nominal', 'name' => 'x', 'lastvalue' => '195'];
$items[] = ['itemid' => '9206', 'key_' => 'nt.poe.used',    'name' => 'x', 'lastvalue' => '37'];
$r = FaceplateBuilder::build($items);
check('Port 5 Klasse-Rohwert 5 (= class4)', $r['ports'][4]['poe_class'], 5);
check('Port 5 liefert Strom',               $r['ports'][4]['poe'],       true);
check('Port 6 Klasse-Rohwert 1 (= class0)', $r['ports'][5]['poe_class'], 1);
check('Port 6 liefert nicht',               $r['ports'][5]['poe'],       false);
check('Port 1 ohne PoE-Item -> poe_class null', $r['ports'][0]['poe_class'], null);
check('Switch-Budget used/nominal', $r['poe_budget'], ['used' => 37, 'nominal' => 195]);

// Kleinste Gruppe gewinnt auch fuer die Klasse (Stack).
$items = genericSwitch(8);
$items[] = ['itemid' => '9301', 'key_' => 'pethPsePortPowerClassifications[1.3]', 'name' => 'x', 'lastvalue' => '4'];
$items[] = ['itemid' => '9302', 'key_' => 'pethPsePortPowerClassifications[2.3]', 'name' => 'x', 'lastvalue' => '2'];
check('Klasse Port 3 aus Gruppe 1', FaceplateBuilder::build($items)['ports'][2]['poe_class'], 4);

// Kreuz-Mitglied-Schutz: Detection NUR in Gruppe 2, Klasse NUR in Gruppe 1.
// poeGroup() waehlt die kleinste Gruppe (1). poe() findet dort keine Detection
// -> poe null (statt den Liefer-Zustand aus Gruppe 2 zu borgen), poe_class aus
// Gruppe 1. Ohne den gemeinsamen Gruppen-Entscheid stand hier Klasse(G1) +
// Liefer(G2) an einem Port vermischt.
$items = genericSwitch(8);
$items[] = ['itemid' => '9501', 'key_' => 'pethPsePortPowerClassifications[1.3]', 'name' => 'x', 'lastvalue' => '4'];
$items[] = ['itemid' => '9502', 'key_' => 'pethPsePortDetectionStatus[2.3]',      'name' => 'x', 'lastvalue' => '3'];
$r = FaceplateBuilder::build($items);
check('Kreuz-Schutz: Klasse aus Gruppe 1',                    $r['ports'][2]['poe_class'], 4);
check('Kreuz-Schutz: Strom NICHT aus Gruppe 2 geborgt (null)', $r['ports'][2]['poe'],       null);

// Nur eines der Budget-Items -> das fehlende zaehlt als 0, aber Budget da.
$items = genericSwitch(8);
$items[] = ['itemid' => '9401', 'key_' => 'nt.poe.used', 'name' => 'x', 'lastvalue' => '12'];
check('nur used -> nominal 0', FaceplateBuilder::build($items)['poe_budget'], ['used' => 12, 'nominal' => 0]);

// Kein Budget-Item -> poe_budget null (graceful, kein erfundenes 0/0).
check('ohne Budget-Item -> poe_budget null', FaceplateBuilder::build(genericSwitch(8))['poe_budget'], null);

/**
 * UniFi-Switch (Vorlage „UniFi Network API – Device"): die Portliste kommt NICHT
 * per SNMP, sondern als eigene port.<feld>[<idx>]-Items aus der Controller-API.
 * <idx> ist schon die Frontnummer; speed/maxSpeed sind bereits bit/s. Alle Werte
 * hier sind ERFUNDEN (kein echter Walk) — Form gemessen 2026-10-26, Werte gesetzt.
 * 8 RJ45 + 2 SFP = Zuschnitt 8+2. Per-Port-Traffic (rx/tx, klassische API) optional
 * je Port — hier nur an Port 1 gesetzt, die uebrigen bleiben ohne (in/out null).
 *
 * @param array $p  [idx => [state, connector, speed, maxSpeed, poeEnabled, poeState]]
 */
function unifiSwitch(array $p): array {
    $items = [];
    $id = 4000;
    foreach ($p as $idx => $f) {
        $add = static function (string $field, string $val) use (&$items, &$id, $idx): void {
            $items[] = ['itemid' => (string) $id++, 'key_' => 'port.' . $field . '[' . $idx . ']',
                        'name' => 'Port ' . $idx . ' ' . $field, 'lastvalue' => $val];
        };
        $add('state', $f['state']);
        $add('connector', $f['connector']);
        $add('speed', (string) $f['speed']);
        $add('maxSpeed', (string) $f['maxSpeed']);
        $add('poe.enabled', $f['poeEnabled']);
        $add('poe.state', $f['poeState']);
        $add('poe.standard', $f['poeEnabled'] === 'true' ? '802.3at' : '');
        $add('poe.type', $f['poeEnabled'] === 'true' ? '2' : '0');
        if (isset($f['rx'])) $add('rx', (string) $f['rx']);
        if (isset($f['tx'])) $add('tx', (string) $f['tx']);
    }
    return $items;
}

echo "\nUniFi-Switch: Ports aus der Controller-API (port.*[N]), kein SNMP\n";
$uni = unifiSwitch([
    1  => ['state' => 'UP',   'connector' => 'RJ45', 'speed' => '1000000000',  'maxSpeed' => '1000000000',  'poeEnabled' => 'true', 'poeState' => 'UP', 'rx' => '125000', 'tx' => '12500'],
    2  => ['state' => 'DOWN', 'connector' => 'RJ45', 'speed' => '0',           'maxSpeed' => '1000000000',  'poeEnabled' => 'true', 'poeState' => 'DOWN'],
    3  => ['state' => 'UP',   'connector' => 'RJ45', 'speed' => '100000000',   'maxSpeed' => '1000000000',  'poeEnabled' => '',     'poeState' => ''],
    9  => ['state' => 'UP',   'connector' => 'SFP',  'speed' => '10000000000', 'maxSpeed' => '10000000000', 'poeEnabled' => '',     'poeState' => ''],
    10 => ['state' => 'DOWN', 'connector' => 'SFP',  'speed' => '0',           'maxSpeed' => '10000000000', 'poeEnabled' => '',     'poeState' => ''],
]);
$r = FaceplateBuilder::build($uni);
check('UniFi Layout 8+2', $r['layout'], '8+2');
check('UniFi 5 Ports erkannt', count($r['ports']), 5);
check('UniFi Portname "Port 1"', $r['ports'][0]['name'], 'Port 1');
check('UniFi Port 1 up', $r['ports'][0]['oper'], 1);
check('UniFi Port 1 Speed 1G', $r['ports'][0]['speed'], 1.0e9);
check('UniFi Port 1 liefert PoE', $r['ports'][0]['poe'], true);
check('UniFi Port 1 rx_bytes-r -> in (bytes/s x8)', $r['ports'][0]['in'], 1000000.0);
check('UniFi Port 1 tx_bytes-r -> out (bytes/s x8)', $r['ports'][0]['out'], 100000.0);
check('UniFi Port 2 down', $r['ports'][1]['oper'], 2);
check('UniFi Port 2 down: Speed faellt auf maxSpeed (1G)', $r['ports'][1]['speed'], 1.0e9);
check('UniFi Port 2 PoE-faehig, aber nicht liefernd', $r['ports'][1]['poe'], false);
check('UniFi Port 3 ohne PoE -> poe null', $r['ports'][2]['poe'], null);
check('UniFi Port 3 Speed 100M (ausgehandelt)', $r['ports'][2]['speed'], 1.0e8);
check('UniFi Port 9 ist SFP', $r['ports'][3]['kind'], 'sfp');
check('UniFi Port 9 10G', $r['ports'][3]['speed'], 1.0e10);
// Port 1 hat rx/tx-Items -> Traffic; Port 2 hat keine -> in/out bleiben null (ehrlich).
check('UniFi Port 2 ohne rx/tx: in null',  $r['ports'][1]['in'],  null);
check('UniFi Port 2 ohne rx/tx: out null', $r['ports'][1]['out'], null);
check('UniFi keine RFC-PoE-Klasse -> poe_class null', $r['ports'][0]['poe_class'], null);
check('UniFi ohne pethMainPse -> kein Budget', $r['poe_budget'], null);

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
