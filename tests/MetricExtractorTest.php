<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\MetricExtractor.
 *
 * Das Review (§6) nennt als Kernproblem der 1353-Zeilen-Data.php, dass sie
 * Unit-Tests unmoeglich macht. Dieser Test ist der Gegenbeweis: die
 * Metrik-Heuristik ist jetzt eine reine Klasse und laeuft hier OHNE Datenbank,
 * ohne Session, ohne HTTP, ohne Zabbix-Installation — nur mit PHP.
 *
 * Getestet wird die Klassifikation quer durch die Template-Welten (Agent, SNMP)
 * und vor allem die Regel, die am leichtesten kaputtgeht: ein absichtlich
 * abgeschalteter Port (admin-down) darf NICHT als Link-Ausfall zaehlen.
 *
 * Aufruf:  php tests/MetricExtractorTest.php     (Exit 0 = gruen)
 */

// Mini-Autoloader, der Zabbix' CAutoloader-Mapping nachbildet: die
// Namespace-Segmente unterhalb des Modul-Namespace werden zu kleingeschriebenen
// Verzeichnissen (Topology\MetricExtractor -> topology/MetricExtractor.php).
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

use Modules\NetworkTopology\Topology\MetricExtractor;
use Modules\NetworkTopology\Topology\LldpEdgeBuilder;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-56s got=%-14s want=%s\n",
        $ok ? 'PASS' : 'FAIL',
        $what,
        var_export($got, true),
        var_export($want, true)
    );
}

// ── Synthetische Items, wie sie aus Zabbix kaemen (mit injiziertem lastvalue) ──
$items = [
    // h1 — klassischer Zabbix-Agent-Host
    ['hostid' => 'h1', 'key_' => 'system.cpu.util',       'name' => 'CPU utilization',               'lastvalue' => '42.3'],
    ['hostid' => 'h1', 'key_' => 'vm.memory.utilization', 'name' => 'Memory utilization',            'lastvalue' => '75.5'],
    ['hostid' => 'h1', 'key_' => 'icmppingsec',           'name' => 'ICMP response time',            'lastvalue' => '0.0053'],
    ['hostid' => 'h1', 'key_' => 'net.if.in[eth0]',       'name' => 'Interface eth0: Bits received', 'lastvalue' => '1000000'],

    // h2 — SNMP-Switch
    ['hostid' => 'h2', 'key_' => 'ifHCInOctets[1]',       'name' => 'Interface 1: Octets in',        'lastvalue' => '1000'],
    ['hostid' => 'h2', 'key_' => 'ifHighSpeed[1]',        'name' => 'Interface 1: Speed',            'lastvalue' => '1000'],

    // Port 1: echter Ausfall (oper=down, admin=up)          -> zaehlt als down
    ['hostid' => 'h2', 'key_' => 'ifOperStatus[1]',       'name' => 'Interface 1: Oper status',      'lastvalue' => '2'],
    ['hostid' => 'h2', 'key_' => 'ifAdminStatus[1]',      'name' => 'Interface 1: Admin status',     'lastvalue' => '1'],

    // Port 2: ABSICHTLICH abgeschaltet (oper=down, admin=down) -> KEIN Ausfall
    ['hostid' => 'h2', 'key_' => 'ifOperStatus[2]',       'name' => 'Interface 2: Oper status',      'lastvalue' => '2'],
    ['hostid' => 'h2', 'key_' => 'ifAdminStatus[2]',      'name' => 'Interface 2: Admin status',     'lastvalue' => '2'],

    // Port 3: ungenutzt (notPresent=6)                      -> weder up noch down
    ['hostid' => 'h2', 'key_' => 'ifOperStatus[3]',       'name' => 'Interface 3: Oper status',      'lastvalue' => '6'],

    ['hostid' => 'h2', 'key_' => 'lldpRemSysName',        'name' => 'LLDP neighbour',                'lastvalue' => 'sw-core'],

    // STP-Portzustand (NT Spanning-Tree by SNMP): Port 1 blocking(2), Port 2 forwarding(5).
    ['hostid' => 'h2', 'key_' => 'nt.if.stp[1]',          'name' => 'STP port state',                'lastvalue' => '2'],
    ['hostid' => 'h2', 'key_' => 'nt.if.stp[2]',          'name' => 'STP port state',                'lastvalue' => '5'],
    // Noch nicht gepollt: leerer lastvalue -> NICHT als Zustand 0 speichern.
    ['hostid' => 'h2', 'key_' => 'nt.if.stp[9]',          'name' => 'STP port state',                'lastvalue' => ''],
    // STP-Topology-Change-Rate (Loop-Fruehwarnung, Stufe 3a). Leerer Wert raus.
    ['hostid' => 'h2', 'key_' => 'nt.stp.topchanges',     'name' => 'STP topchanges/s',              'lastvalue' => '0.42'],
    ['hostid' => 'h1', 'key_' => 'nt.stp.topchanges',     'name' => 'STP topchanges/s',              'lastvalue' => ''],
    // Broadcast-Rate je Port (Stufe 3b): je Host das Maximum.
    ['hostid' => 'h2', 'key_' => 'nt.if.bcast[1]',        'name' => 'bcast/s',                       'lastvalue' => '12'],
    ['hostid' => 'h2', 'key_' => 'nt.if.bcast[7]',        'name' => 'bcast/s',                       'lastvalue' => '3400.5'],
    ['hostid' => 'h2', 'key_' => 'nt.if.bcast[9]',        'name' => 'bcast/s',                       'lastvalue' => ''],
    // MAC-Flap-Count (Trapper, Stufe 3c).
    ['hostid' => 'h2', 'key_' => 'nt.mac.flap',           'name' => 'mac flap',                      'lastvalue' => '5'],

    // EIGEN-Identitaet (lldpLocChassisId / dot1dBaseBridgeAddress), Rohform mit
    // Leerzeichen wie von Zabbix geliefert. Leerer Wert wird NICHT eingetragen.
    ['hostid' => 'h2', 'key_' => 'nt.self.chassis',       'name' => 'self chassis',                  'lastvalue' => '02 00 5E 0A 11 01'],
    ['hostid' => 'h2', 'key_' => 'nt.self.basemac',       'name' => 'self base mac',                 'lastvalue' => '02 00 5E 0A 11 01'],
    ['hostid' => 'h2', 'key_' => 'nt.self.chassis',       'name' => 'self chassis (leer)',           'lastvalue' => ''],
];

$m = MetricExtractor::extract($items);

echo "\nCPU / Memory / Ping (Agent-Host)\n";
check('cpu: system.cpu.util',                  $m['cpu']['h1']           ?? null, 42.3);
check('memory: vm.memory.utilization -> %',    $m['memory']['h1']        ?? null, 76);
check('ping: icmppingsec (s) -> ms',           $m['ping']['h1']          ?? null, 5.3);

echo "\nTraffic\n";
check('agent: net.if.in, bits/s direkt',       $m['traffic']['h1']['in'] ?? null, 1000000.0);
check('snmp: ifHCInOctets -> bits/s (x8)',     $m['traffic']['h2']['in'] ?? null, 8000.0);

echo "\nInterface-Health (die fehleranfaellige Regel)\n";
check('down: nur der echte Ausfall',           $m['iface']['h2']['down']  ?? null, 1);
check('count: admin-down + notPresent raus',   $m['iface']['h2']['count'] ?? null, 1);

echo "\nLink-Speed / LLDP\n";
check('ifHighSpeed 1000 (Mbps) -> 1e9 bps',    $m['speed']['h2']         ?? null, 1.0e9);
check('lldp_raw: Nachbar erkannt',             count($m['lldp_raw']),             1);
check('lldp_raw: Quelle klassifiziert',        $m['lldp_raw'][0]['src']  ?? null, 'lldp');

// ── §3 Per-Interface-Traffic/-Speed (aus denselben h2-SNMP-Items) ─────────
echo "\n§3 Per-Interface-Traffic/-Speed\n";
check('port_traffic: ifHCInOctets[1] -> bits/s (x8)', $m['port_traffic']['h2']['1']['in'] ?? null, 8000.0);
check('port_speed: ifHighSpeed[1] -> 1e9 bps',        $m['port_speed']['h2']['1']         ?? null, 1.0e9);
check('port_stp: nt.if.stp[1] -> blocking(2)',        $m['port_stp']['h2']['1']           ?? null, 2);
check('port_stp: nt.if.stp[2] -> forwarding(5)',      $m['port_stp']['h2']['2']           ?? null, 5);
check('port_stp: leerer Wert NICHT als state 0',      isset($m['port_stp']['h2']['9']),   false);
check('stp_churn: Rate geparst',                      $m['stp_churn']['h2']              ?? null, 0.42);
check('stp_churn: leerer Wert NICHT gesammelt',       isset($m['stp_churn']['h1']),       false);
check('bcast_max: Maximum ueber Ports',               $m['bcast_max']['h2']              ?? null, 3400.5);
check('mac_flap: Count geparst',                      $m['mac_flap']['h2']               ?? null, 5);

echo "\nEigen-MAC (CDP-only-Aufloesung)\n";
check('host_self_mac: chassis + basemac gesammelt',   count($m['host_self_mac']['h2'] ?? []), 2);
check('host_self_mac: Rohform behalten',              $m['host_self_mac']['h2'][0] ?? null, '02 00 5E 0A 11 01');
check('host_self_mac: leerer Wert NICHT gesammelt',   in_array('', $m['host_self_mac']['h2'] ?? [], true), false);

// ── §3 Remote-Port + CDP-Regression (eigene Items, damit die Zaehler oben
//     unberuehrt bleiben) ─────────────────────────────────────────────────
echo "\n§3 Remote-Port + CDP-Regression\n";
$items3 = [
    // Aruba-Form: net.if.in[ifHCInOctets.8] ist schon bits/s (KEIN x8)
    ['hostid' => 'a', 'key_' => 'net.if.in[ifHCInOctets.8]',   'name' => 'Interface 8: Bits received', 'lastvalue' => '1000000'],
    ['hostid' => 'a', 'key_' => 'net.if.out[ifHCOutOctets.8]', 'name' => 'Interface 8: Bits sent',     'lastvalue' => '2000000'],
    ['hostid' => 'a', 'key_' => 'lldpRemSysName[0.8.1]',       'name' => 'LLDP neighbor',              'lastvalue' => 'pve'],
    ['hostid' => 'a', 'key_' => 'lldpRemPortId[0.8.1]',        'name' => 'LLDP port-id',               'lastvalue' => '3C EC EF 79 2C 88'],
    ['hostid' => 'a', 'key_' => 'lldpRemPortDesc[0.8.1]',      'name' => 'LLDP port-desc',             'lastvalue' => 'nic0'],
    ['hostid' => 'a', 'key_' => 'lldpRemChassisId[0.8.1]',     'name' => 'LLDP chassis-id',            'lastvalue' => '3C EC EF 79 2C 88'],
    ['hostid' => 'a', 'key_' => 'lldpRemChassisIdSubtype[0.8.1]', 'name' => 'LLDP chassis-id subtype', 'lastvalue' => '4'],
    // Management-IP (lldpRemManAddr): das Template liefert sie als fertige IP.
    ['hostid' => 'a', 'key_' => 'lldpRemManAddr[0.8.1]',       'name' => 'LLDP mgmt-ip',               'lastvalue' => '192.0.2.9'],
    // CDP: DeviceId = Nachbar, DevicePort = PORT (darf NICHT als Nachbar zaehlen)
    ['hostid' => 'a', 'key_' => 'cdpCacheDeviceId[7.4]',       'name' => 'CDP neighbor',               'lastvalue' => 'switch-x'],
    ['hostid' => 'a', 'key_' => 'cdpCacheDevicePort[7.4]',     'name' => 'CDP port',                   'lastvalue' => 'GigabitEthernet0/1'],
];
$m3 = MetricExtractor::extract($items3);

check('net.if-Form: bits/s direkt (kein x8)',          $m3['port_traffic']['a']['8']['in']  ?? null, 1000000.0);
check('net.if-Form out: bits/s direkt',                $m3['port_traffic']['a']['8']['out'] ?? null, 2000000.0);
check('lldp_ports: PortDesc erfasst',                  $m3['lldp_ports']['a']['0.8.1']['desc'] ?? null, 'nic0');
check('lldp_ports: PortId erfasst',                    $m3['lldp_ports']['a']['0.8.1']['id']   ?? null, '3C EC EF 79 2C 88');
check('cdpCacheDevicePort -> lldp_ports (kein Nachbar)', $m3['lldp_ports']['a']['7.4']['desc'] ?? null, 'GigabitEthernet0/1');
// Chassis-ID und -Subtype landen getrennt in lldp_meta. Entscheidend: der
// Subtype-Key (Substring 'lldpRemChassisId') darf NICHT in der chassis-Branch
// landen — sonst ueberschriebe '4' die MAC.
check('lldp_meta: ChassisId erfasst',                  $m3['lldp_meta']['a']['0.8.1']['chassis']         ?? null, '3C EC EF 79 2C 88');
check('lldp_meta: Subtype getrennt (keine Kollision)', $m3['lldp_meta']['a']['0.8.1']['chassis_subtype'] ?? null, '4');
// Mgmt-IP landet unter demselben SNMPINDEX wie der Rest der Nachbarzeile und
// NICHT in der chassis-Branch (beide tragen den Substring 'lldpRem...').
check('lldp_meta: Mgmt-IP erfasst',                    $m3['lldp_meta']['a']['0.8.1']['mgmt_ip']          ?? null, '192.0.2.9');
check('lldp_meta: Mgmt-IP ueberschreibt Chassis nicht', $m3['lldp_meta']['a']['0.8.1']['chassis']         ?? null, '3C EC EF 79 2C 88');
// Regression: nur ECHTE Nachbarn in lldp_raw (SysName + cdpCacheDeviceId = 2).
check('lldp_raw: genau 2 Nachbarn (Port NICHT dabei)', count($m3['lldp_raw']), 2);
$raw_vals = array_map(static fn($r) => $r['lastvalue'], $m3['lldp_raw']);
check('lldp_raw: DevicePort-Wert nicht als Nachbar',   in_array('GigabitEthernet0/1', $raw_vals, true), false);

// ── UniFi: uplink.id als Nachbar-Quelle (Controller-Sicht statt LLDP) ─────
// Das UniFi-Template holt per JSONPath $.uplinkDeviceId "an welchem Geraet
// haenge ich"; der Wert ist die Geraete-UUID = technischer Hostname des Uplinks.
echo "\nUniFi uplink.id\n";
$itemsU = [
    ['hostid' => 'c', 'key_' => 'uplink.id', 'name' => 'Uplink Device Id',
     'lastvalue' => 'bf995b97-bae1-4d4b-ab1a-79803bb97d4f'],
];
$mu = MetricExtractor::extract($itemsU);
check('uplink.id wird als Nachbar erkannt',  count($mu['lldp_raw']),                1);
check('uplink.id -> src=unifi',              $mu['lldp_raw'][0]['src'] ?? null,      'unifi');
check('uplink.id -> Wert bleibt die UUID',   $mu['lldp_raw'][0]['lastvalue'] ?? null,
      'bf995b97-bae1-4d4b-ab1a-79803bb97d4f');
// Abgrenzung: uplink.rx/tx sind Traffic, KEINE Nachbarn — duerfen nicht rein.
$mu2 = MetricExtractor::extract([
    ['hostid' => 'c', 'key_' => 'uplink.rx', 'name' => 'Uplink RX', 'lastvalue' => '12345'],
    ['hostid' => 'c', 'key_' => 'uplink.tx', 'name' => 'Uplink TX', 'lastvalue' => '678'],
]);
check('uplink.rx/tx sind KEINE Nachbarn',    count($mu2['lldp_raw']),               0);

// ── merge(): stueckweise auswerten muss dasselbe ergeben ──────────────────
//
// Der Controller holt die Items in Stuecken, weil die rohe Item-Liste bei
// grossen Gruppen den Speicher sprengt (rund 570 Byte je Item; 840.000 Items
// sind 457 MB bei 128 MB Limit). Die entscheidende Zusicherung ist deshalb:
// stueckweise auswerten und zusammenfuehren liefert GENAU dasselbe wie alles
// auf einmal. Sonst haengt die Karte still von der Stueckgroesse ab.
echo "\n  MetricExtractor — merge()\n\n";

$mA = [
    ['itemid' => '1', 'hostid' => 'h1', 'key_' => 'ifHCInOctets[1]',  'name' => 'in',  'value_type' => '3', 'lastvalue' => '1000'],
    ['itemid' => '2', 'hostid' => 'h1', 'key_' => 'ifHCOutOctets[1]', 'name' => 'out', 'value_type' => '3', 'lastvalue' => '2000'],
    ['itemid' => '3', 'hostid' => 'h1', 'key_' => 'lldpRemSysName[0.1.1]', 'name' => 'n', 'value_type' => '1', 'lastvalue' => 'sw-b'],
];
$mB = [
    ['itemid' => '4', 'hostid' => 'h2', 'key_' => 'ifHCInOctets[5]',  'name' => 'in',  'value_type' => '3', 'lastvalue' => '3000'],
    ['itemid' => '5', 'hostid' => 'h2', 'key_' => 'ifHighSpeed[5]',   'name' => 'sp',  'value_type' => '3', 'lastvalue' => '1000'],
    ['itemid' => '6', 'hostid' => 'h2', 'key_' => 'lldpRemSysName[0.5.1]', 'name' => 'n', 'value_type' => '1', 'lastvalue' => 'sw-a'],
];

$amStueck = MetricExtractor::merge(
    MetricExtractor::merge([], MetricExtractor::extract($mA)),
    MetricExtractor::extract($mB)
);
$amStueck2 = MetricExtractor::extract(array_merge($mA, $mB));

check('stueckweise == auf einmal',        $amStueck == $amStueck2, true);
check('beide Hosts im Port-Traffic',      count($amStueck['port_traffic'] ?? []), 2);
check('lldp_raw wurde angehaengt',        count($amStueck['lldp_raw'] ?? []), 2);
check('Hostids bleiben Hostids',          isset($amStueck['port_traffic']['h2']), true);

// Der erste Aufruf mit leerem Akkumulator darf nichts verlieren.
$leer = MetricExtractor::merge([], MetricExtractor::extract($mA));
check('leerer Akkumulator liefert das Stueck', $leer == MetricExtractor::extract($mA), true);

// host_self_mac: DESSELBEN Hosts chassis + basemac ueber zwei Stuecke verteilt
// (Item-Stueckelung) duerfen sich nicht gegenseitig verdraengen — '+' auf der
// Host-Map wuerde die zweite MAC verlieren, der host_self_mac-Zweig in merge()
// haengt die Listen stattdessen an.
$selfA = [['itemid' => '7', 'hostid' => 'hx', 'key_' => 'nt.self.chassis', 'name' => 'c', 'value_type' => '1', 'lastvalue' => '02 00 5E 0A 11 01']];
$selfB = [['itemid' => '8', 'hostid' => 'hx', 'key_' => 'nt.self.basemac', 'name' => 'b', 'value_type' => '1', 'lastvalue' => '02 00 5E 0A 11 02']];
$selfMerged = MetricExtractor::merge(MetricExtractor::extract($selfA), MetricExtractor::extract($selfB));
check('merge host_self_mac: beide MACs ueberleben die Stueckelung',
    count($selfMerged['host_self_mac']['hx'] ?? []), 2);

// ── hrStorageType als OID und hrProcessorLoad ueber mehrere Kerne ────────
//
// Beides kam aus dem Projekt-Review. Der OID-Fall scheiterte an einem
// (float)-Cast weiter oben, der aus "1.3.6.1.2.1.25.2.1.2" die Zahl 1.3
// machte — RAM wurde nie erkannt. Und hrProcessorLoad halbierte fortlaufend,
// statt zu mitteln.
echo "\n  MetricExtractor — SNMP-Speicher und Mehrkern-CPU\n\n";

$it = function ($id, $hid, $key, $val) {
    return ['itemid' => (string) $id, 'hostid' => $hid, 'key_' => $key,
            'name' => $key, 'value_type' => '3', 'lastvalue' => $val];
};

$mem = MetricExtractor::extract([
    $it(1, 'hs', 'hrStorageType[1]', '1.3.6.1.2.1.25.2.1.2'),
    $it(2, 'hs', 'hrStorageUsed[1]', '512'),
    $it(3, 'hs', 'hrStorageSize[1]', '1024'),
]);
check('RAM per OID erkannt (50%)', (int) round($mem['memory']['hs'] ?? -1), 50);

$mem2 = MetricExtractor::extract([
    $it(1, 'hs', 'hrStorageType[1]', '2'),
    $it(2, 'hs', 'hrStorageUsed[1]', '256'),
    $it(3, 'hs', 'hrStorageSize[1]', '1024'),
]);
check('RAM als Ganzzahl weiterhin erkannt', (int) round($mem2['memory']['hs'] ?? -1), 25);

// Acht Kerne, einer auf 80 % -> Mittelwert 10 %, nicht 0,6 %.
$cpuItems = [];
$werte = [80, 0, 0, 0, 0, 0, 0, 0];
foreach ($werte as $n => $w) {
    $cpuItems[] = $it(10 + $n, 'hc', 'hrProcessorLoad[' . ($n + 1) . ']', (string) $w);
}
$cpu = MetricExtractor::extract($cpuItems);
check('Achtkerner wird gemittelt, nicht halbiert', (float) ($cpu['cpu']['hc'] ?? -1), 10.0);

// Reihenfolge darf das Ergebnis nicht aendern.
$cpuRev = MetricExtractor::extract(array_reverse($cpuItems));
check('Reihenfolge der Items ist egal',
      (float) ($cpuRev['cpu']['hc'] ?? -1), (float) ($cpu['cpu']['hc'] ?? -2));

// ── CPU-Teilkategorien sind NICHT die Gesamtauslastung (Review #5) ──────────
//
// system.cpu.util[,user] ist der Default-Typ-Anteil (user auf Linux), nicht das
// Ganze. Frueher gewann je nach Item-Reihenfolge dieser Anteil (7 %) vor dem
// echten Gesamtwert (80 %). Verlaesslich total sind nur bare system.cpu.util
// und system.cpu.util[,idle] (-> 100 - idle). Werte erfunden.
echo "\n  MetricExtractor — CPU: Teilkategorie ist nicht das Ganze (#5)\n\n";
$cpuMix = [
    $it(1, 'cx', 'system.cpu.util[,user]',   '7'),
    $it(2, 'cx', 'system.cpu.util[,system]', '9'),
    $it(3, 'cx', 'system.cpu.util',          '80'),
];
check('Gesamtwert gewinnt, Teilkategorie zuerst',
      (float) (MetricExtractor::extract($cpuMix)['cpu']['cx'] ?? -1), 80.0);
check('…unabhaengig von der Item-Reihenfolge',
      (float) (MetricExtractor::extract(array_reverse($cpuMix))['cpu']['cx'] ?? -1), 80.0);
check('nur idle -> 100 - idle',
      (float) (MetricExtractor::extract([$it(1, 'ci', 'system.cpu.util[,idle]', '20')])['cpu']['ci'] ?? -1), 80.0);
check('nur Teilkategorie -> kein Gesamtwert (ehrliches "—")',
      isset(MetricExtractor::extract([$it(1, 'cu', 'system.cpu.util[,user]', '7')])['cpu']['cu']), false);

// ── Interface-Keys ohne MIB-Namen: net.if.in[24] (Issue #16) ───────────────
//
// Eine ganze Familie offizieller Zabbix-Templates (Cisco Catalyst 3750V2,
// Nexus 9000, pfSense, OPNsense) nennt ihre Interface-Items net.if.in[24]:
// kein "Octets", kein "ifOperStatus", der Index nackt in der Klammer. Die
// Portzuordnung sah diese Items nie. Namen und Werte erfunden.
echo "\n  MetricExtractor — net.if.*[ifIndex] ohne MIB-Namen\n\n";

$itemsN = [
    ['hostid' => 's1', 'key_' => 'net.if.in[24]',          'name' => 'Interface 24(): Bits received',  'lastvalue' => '4000000'],
    ['hostid' => 's1', 'key_' => 'net.if.out[24]',         'name' => 'Interface 24(): Bits sent',      'lastvalue' => '1000000'],
    ['hostid' => 's1', 'key_' => 'net.if.speed[24]',       'name' => 'Interface 24(): Speed',          'lastvalue' => '1000000000'],
    ['hostid' => 's1', 'key_' => 'net.if.status[24]',      'name' => 'Interface 24(): Operational status', 'lastvalue' => '1'],
    ['hostid' => 's1', 'key_' => 'net.if.status[23]',      'name' => 'Interface 23(): Operational status', 'lastvalue' => '2'],
    ['hostid' => 's1', 'key_' => 'net.if.type[24]',        'name' => 'Interface 24(): Interface type', 'lastvalue' => '6'],
    ['hostid' => 's1', 'key_' => 'net.if.in.errors[24]',   'name' => 'Interface 24(): Inbound packets with errors', 'lastvalue' => '0.5'],
    ['hostid' => 's1', 'key_' => 'net.if.out.discards[24]','name' => 'Interface 24(): Outbound packets discarded', 'lastvalue' => '0.25'],
    // Agent-Schluessel mit Interface-NAMEN bleiben, was sie waren.
    ['hostid' => 's2', 'key_' => 'net.if.in[eth0]',        'name' => 'Interface eth0: Bits received',  'lastvalue' => '700'],
];
$mN = MetricExtractor::extract($itemsN);
check('port_traffic in  net.if.in[24]',        $mN['port_traffic']['s1']['24']['in']  ?? null, 4000000.0);
check('port_traffic out net.if.out[24]',       $mN['port_traffic']['s1']['24']['out'] ?? null, 1000000.0);
check('port_speed net.if.speed[24] (bps)',     $mN['port_speed']['s1']['24']          ?? null, 1.0e9);
check('port_errors net.if.in.errors[24]',      $mN['port_errors']['s1']['24']         ?? null, 0.5);
check('port_discards net.if.out.discards[24]', $mN['port_discards']['s1']['24']       ?? null, 0.25);
check('Host-Traffic zaehlt weiter (in)',       $mN['traffic']['s1']['in']             ?? null, 4000000.0);
check('Host-Speed aus net.if.speed',           $mN['speed']['s1']                     ?? null, 1.0e9);
check('Oper-Status: Port 23 down',             $mN['iface']['s1']['down']             ?? null, 1);
check('net.if.type zaehlt nicht als Traffic',  $mN['traffic']['s1']['out']            ?? null, 1000000.0);
check('Agent net.if.in[eth0]: kein Port',      isset($mN['port_traffic']['s2']),               false);
check('Agent net.if.in[eth0]: Host-Traffic',   $mN['traffic']['s2']['in']             ?? null, 700.0);

// ── ifSpeed am 32-Bit-Anschlag ist keine Geschwindigkeit ───────────────────
//
// 4294967295 = 2^32-1. RFC 2863: liegt die Geschwindigkeit darueber, traegt
// ifSpeed den Maximalwert und die Wahrheit steht in ifHighSpeed. Gemeldet aus
// dem Feld: "der Link hat 10 Gb/s, im Panel steht 4.3 Gb/s".
echo "\n  MetricExtractor — ifSpeed-Anschlag\n\n";

$mCap = MetricExtractor::extract([
    ['hostid' => 's1', 'key_' => 'ifSpeed[1]',     'name' => 'Speed 1', 'lastvalue' => '4294967295'],
    ['hostid' => 's1', 'key_' => 'ifSpeed[2]',     'name' => 'Speed 2', 'lastvalue' => '1000000000'],
    ['hostid' => 's2', 'key_' => 'ifSpeed[1]',     'name' => 'Speed 1', 'lastvalue' => '4294967295'],
    ['hostid' => 's2', 'key_' => 'ifHighSpeed[1]', 'name' => 'HighSpeed 1', 'lastvalue' => '10000'],
]);
check('Anschlag wird verworfen',      isset($mCap['port_speed']['s1']['1']), false);
check('echter Wert bleibt',           $mCap['port_speed']['s1']['2'] ?? null, 1.0e9);
check('ifHighSpeed gewinnt (10 Gb/s)', $mCap['port_speed']['s2']['1'] ?? null, 1.0e10);
check('Host-Speed ohne Anschlag',      $mCap['speed']['s1'] ?? null, 1.0e9);

// ── Portzustand je ifIndex ────────────────────────────────────────────────
echo "\n  MetricExtractor — Portzustand je Port\n\n";

$mSt = MetricExtractor::extract([
    ['hostid' => 's1', 'key_' => 'ifOperStatus[1]',  'name' => 'Oper 1',  'lastvalue' => '1'],
    ['hostid' => 's1', 'key_' => 'ifOperStatus[2]',  'name' => 'Oper 2',  'lastvalue' => '2'],
    ['hostid' => 's1', 'key_' => 'ifAdminStatus[2]', 'name' => 'Admin 2', 'lastvalue' => '1'],
    ['hostid' => 's1', 'key_' => 'ifOperStatus[3]',  'name' => 'Oper 3',  'lastvalue' => '2'],
    ['hostid' => 's1', 'key_' => 'ifAdminStatus[3]', 'name' => 'Admin 3', 'lastvalue' => '2'],
]);
check('Port 1 ist oben',                  $mSt['port_status']['s1']['1'] ?? null, false);
check('Port 2 ist unten',                 $mSt['port_status']['s1']['2'] ?? null, true);
check('admin-down taucht nicht auf',      isset($mSt['port_status']['s1']['3']), false);

// ── Host-Traffic: die Richtung steht im Key, nicht im Namen ───────────────
//
// Bis 5.5.0 suchte dieser Zweig nach "received" / "bits in" / "sent" /
// "bits out" im ANZEIGENAMEN. Das traf die mitgelieferten Vorlagen und sonst
// nichts: ein umbenanntes oder uebersetztes Item fiel still aus der
// Host-Summe — kein Fehler, keine Meldung, nur eine zu kleine Zahl.
echo "\nHost-Traffic: Richtung aus dem Key\n";

// Der Fall, der den Fehler ausloeste: Namen, die auf KEIN Muster passen.
$mR = MetricExtractor::extract([
    ['hostid' => 'r', 'key_' => 'net.if.in[eth0]',  'name' => 'Eingehender Verkehr', 'lastvalue' => '100'],
    ['hostid' => 'r', 'key_' => 'net.if.out[eth0]', 'name' => 'Trafic sortant',      'lastvalue' => '200'],
]);
check('umbenanntes Item zaehlt trotzdem (in)',   $mR['traffic']['r']['in']  ?? null, 100.0);
check('umbenanntes Item zaehlt trotzdem (out)',  $mR['traffic']['r']['out'] ?? null, 200.0);

// GANZ OHNE name-Feld. Das ist die Zusicherung, auf der das Weglassen von
// 'name' in der Item-Abfrage von NetworkTopologyData steht: wird hier je
// wieder ein Name gebraucht, faellt dieser Test und nicht die Karte.
$mO = MetricExtractor::extract([
    ['hostid' => 'o', 'key_' => 'net.if.in[eth0]',  'lastvalue' => '7'],
    ['hostid' => 'o', 'key_' => 'net.if.out[eth0]', 'lastvalue' => '9'],
]);
check('ohne name-Feld: in',                      $mO['traffic']['o']['in']  ?? null, 7.0);
check('ohne name-Feld: out',                     $mO['traffic']['o']['out'] ?? null, 9.0);

// Der Key gewinnt gegen einen widersprechenden Namen: er ist die Zusicherung
// des Agenten, der Name ist frei editierbar.
$mW = MetricExtractor::extract([
    ['hostid' => 'w', 'key_' => 'net.if.in[eth0]', 'name' => 'Bits sent', 'lastvalue' => '5'],
]);
check('Key schlaegt widersprechenden Namen',     $mW['traffic']['w']['in']  ?? null, 5.0);
check('... und landet nicht bei out',            $mW['traffic']['w']['out'] ?? null, 0.0);

// net.if.total ist KEINE Richtung. Es mitzuzaehlen wuerde den Verkehr
// doppeln, denn es ist die Summe der beiden anderen.
$mT = MetricExtractor::extract([
    ['hostid' => 't', 'key_' => 'net.if.in[eth0]',    'lastvalue' => '3'],
    ['hostid' => 't', 'key_' => 'net.if.total[eth0]', 'name' => 'Bits received', 'lastvalue' => '999'],
]);
check('net.if.total zaehlt nirgends',            $mT['traffic']['t']['in']  ?? null, 3.0);
check('... auch nicht als Ausgang',              $mT['traffic']['t']['out'] ?? null, 0.0);

// Praefix-Falle: ein Key, der nur mit 'net.if.in' ANFAENGT, ist kein Eingang.
$mP = MetricExtractor::extract([
    ['hostid' => 'p', 'key_' => 'net.if.info[eth0]', 'name' => 'Bits received', 'lastvalue' => '42'],
]);
check('net.if.info ist kein Eingang',            $mP['traffic']['p']['in']  ?? null, null);

// Die mitgelieferten Vorlagen muessen weiter genau so zaehlen wie bisher.
$mV = MetricExtractor::extract([
    ['hostid' => 'v', 'key_' => 'net.if.in[ifHCInOctets.8]',   'name' => 'Interface 8: Bits received', 'lastvalue' => '10'],
    ['hostid' => 'v', 'key_' => 'net.if.out[ifHCOutOctets.8]', 'name' => 'Interface 8: Bits sent',     'lastvalue' => '20'],
]);
check('Vorlagenform unveraendert (in)',          $mV['traffic']['v']['in']  ?? null, 10.0);
check('Vorlagenform unveraendert (out)',         $mV['traffic']['v']['out'] ?? null, 20.0);

// ── Nachbar ohne Namen, aber mit Chassis-MAC ──────────────────────────────
//
// GEFUNDEN AN ECHTER HARDWARE. Ein managed Switch meldet ueber LLDP
// einen vollstaendigen Datensatz — Chassis-MAC, Port, SysDesc, Capability —
// aber KEINEN SysName. Bis hierher identifizierte das Modul Nachbarn nur ueber
// den Namen, also fiel dieses reale Geraet komplett heraus: kein Nachbar, kein
// Geist, keine Kante. Jede snmpsim-Fixture hatte einen Namen; nur echte
// Hardware zeigte die Luecke.
//
// Jetzt gilt: leerer Name + brauchbare Chassis-MAC -> der Nachbar wird ueber
// die MAC identifiziert. LldpEdgeBuilder loest MAC-foermige Namen ohnehin auf,
// und die Herstellererkennung macht daraus im Panel "Hewlett Packard".
echo "\n  Nachbar ohne Namen, aber mit Chassis-MAC\n\n";

$hpe = MetricExtractor::extract([
    ['hostid' => 's', 'key_' => 'lldpRemSysName[0.73.1]',       'name' => '', 'lastvalue' => ''],
    ['hostid' => 's', 'key_' => 'lldpRemChassisId[0.73.1]',     'name' => '', 'lastvalue' => '3C 11 22 33 44 55'],
    ['hostid' => 's', 'key_' => 'lldpRemPortDesc[0.73.1]',      'name' => '', 'lastvalue' => '8'],
    ['hostid' => 's', 'key_' => 'lldpRemSysDesc[0.73.1]',       'name' => '', 'lastvalue' => 'Example managed switch, firmware X.Y'],
    ['hostid' => 's', 'key_' => 'lldpRemSysCapEnabled[0.73.1]', 'name' => '', 'lastvalue' => '20 00'],
]);
check('leerer Name + Chassis-MAC: ein Nachbar entsteht', count($hpe['lldp_raw']), 1);
$n = $hpe['lldp_raw'][0] ?? [];
check('... identifiziert ueber die MAC',   $n['lastvalue'] ?? null, '3C 11 22 33 44 55');
check('... als LLDP markiert',             $n['src'] ?? null, 'lldp');
check('... am selben SNMPINDEX wie das Meta',
    strpos((string) ($n['key_'] ?? ''), '[0.73.1]') !== false, true);

// Ende zu Ende: der Builder macht daraus einen Geist.
$rHpe = LldpEdgeBuilder::build(
    ['s' => ['hostid' => 's', 'host' => 'sg300', 'name' => 'sg300', 'interfaces' => []]],
    $hpe['lldp_raw'], $hpe['lldp_ports'], [], [], $hpe['lldp_meta']);
check('Builder: genau ein Geist',          count($rHpe['unmatched']), 1);
check('Builder: keine Falschkante',        count($rHpe['edges']), 0);

// Ein echter Name hat Vorrang: liegt er vor, wird NICHT zusaetzlich ueber die
// MAC ein zweiter Nachbar erzeugt — sonst entstuende eine falsche Aufspaltung.
$beides = MetricExtractor::extract([
    ['hostid' => 's', 'key_' => 'lldpRemSysName[0.5.1]',   'name' => '', 'lastvalue' => 'sw-real'],
    ['hostid' => 's', 'key_' => 'lldpRemChassisId[0.5.1]', 'name' => '', 'lastvalue' => '3C 11 22 33 44 55'],
]);
check('Name vorhanden: genau ein Nachbar', count($beides['lldp_raw']), 1);
check('... und zwar der Name, nicht die MAC', $beides['lldp_raw'][0]['lastvalue'], 'sw-real');

// Eine unbrauchbare Chassis-MAC (alles Null) erzeugt KEINEN Nachbarn: viele
// Geraete, die ihre eigene MAC nicht kennen, melden sie, eine Zuordnung waere
// geraten.
$null = MetricExtractor::extract([
    ['hostid' => 's', 'key_' => 'lldpRemSysName[0.9.1]',   'name' => '', 'lastvalue' => ''],
    ['hostid' => 's', 'key_' => 'lldpRemChassisId[0.9.1]', 'name' => '', 'lastvalue' => '00 00 00 00 00 00'],
]);
check('Null-MAC: kein Nachbar',            count($null['lldp_raw']), 0);

// Ein Chassis, das gar keine MAC ist (lokal vergebener String), erzeugt
// ebenfalls keinen MAC-Nachbarn — wir raten keine Identitaet.
$str = MetricExtractor::extract([
    ['hostid' => 's', 'key_' => 'lldpRemSysName[0.11.1]',   'name' => '', 'lastvalue' => ''],
    ['hostid' => 's', 'key_' => 'lldpRemChassisId[0.11.1]', 'name' => '', 'lastvalue' => 'some-local-id'],
]);
check('Nicht-MAC-Chassis: kein Nachbar',   count($str['lldp_raw']), 0);

// SKALARER Fall (bracket-los): lldpRemSysName und lldpRemChassisId ohne Index
// haben verschiedene ifaceParam-Pseudo-Indizes ('lldpRemSysName' gegen
// 'lldpRemChassisId'). Der indexbasierte Guard griff dort nicht — ein Host mit
// skalarem Namen bekam aus derselben Meldung einen echten Nachbarn UND einen
// MAC-Geist. Das ist dieselbe falsche Aufspaltung wie oben, nur skalar.
$skalar = MetricExtractor::extract([
    ['hostid' => 's', 'key_' => 'lldpRemSysName',   'name' => '', 'lastvalue' => 'realneighbor'],
    ['hostid' => 's', 'key_' => 'lldpRemChassisId', 'name' => '', 'lastvalue' => '02 5E 10 00 00 01'],
]);
check('skalarer Name + Chassis: ein Nachbar', count($skalar['lldp_raw']), 1);
check('... und zwar der Name, nicht die MAC', $skalar['lldp_raw'][0]['lastvalue'], 'realneighbor');
// Ein skalarer Chassis OHNE Namen fuehrt weiter zu einem Geist (der No-Name-
// Fix gilt auch skalar) — unterdrueckt wird nur das Doppel, nicht die Synthese.
$skalarNurMac = MetricExtractor::extract([
    ['hostid' => 's', 'key_' => 'lldpRemChassisId', 'name' => '', 'lastvalue' => '02 5E 10 00 00 01'],
]);
check('skalarer Chassis ohne Name: ein Geist', count($skalarNurMac['lldp_raw']), 1);

// ── Link-Uptime je Port ───────────────────────────────────────────────────
//
// sysUpTime (Host) minus ifLastChange (Interface) = wie lange der Link steht.
// Beide opportunistisch gelesen; die Rechnung samt Counter-Wrap in
// HostMetadata, hier nur die Erfassung und der Nachlauf.
echo "\n  Link-Uptime je Port\n\n";

$mUp = MetricExtractor::extract([
    ['hostid' => 'h', 'key_' => 'sysUpTime',          'name' => '', 'lastvalue' => '1000000'],
    ['hostid' => 'h', 'key_' => 'ifLastChange[3]',    'name' => '', 'lastvalue' => '400000'],
    ['hostid' => 'h', 'key_' => 'ifLastChange[4]',    'name' => '', 'lastvalue' => '0'],
]);
check('Port 3: (sys-last)/100 Sekunden', $mUp['port_uptime']['h']['3'] ?? null, 6000);
check('Port 4: ifLastChange 0 = volle Uptime', $mUp['port_uptime']['h']['4'] ?? null, 10000);

// Ohne sysUpTime keine Aussage — der Port taucht gar nicht auf.
$mNo = MetricExtractor::extract([
    ['hostid' => 'h', 'key_' => 'ifLastChange[3]', 'name' => '', 'lastvalue' => '400000'],
]);
check('ohne sysUpTime: kein port_uptime',
    isset($mNo['port_uptime']['h']), false);

// Zwei Stuecke (merge): sysUpTime und ifLastChange desselben Hosts liegen
// IMMER im selben Stueck (Chunking nach Host), aber verschiedene Hosts in
// verschiedenen — das Ergebnis muss beide tragen.
$m1 = MetricExtractor::extract([
    ['hostid' => 'a', 'key_' => 'sysUpTime', 'name' => '', 'lastvalue' => '500000'],
    ['hostid' => 'a', 'key_' => 'ifLastChange[1]', 'name' => '', 'lastvalue' => '100000'],
]);
$m2 = MetricExtractor::extract([
    ['hostid' => 'b', 'key_' => 'sysUpTime', 'name' => '', 'lastvalue' => '300000'],
    ['hostid' => 'b', 'key_' => 'ifLastChange[1]', 'name' => '', 'lastvalue' => '50000'],
]);
$mm = MetricExtractor::merge($m1, $m2);
check('merge haelt Host a',  $mm['port_uptime']['a']['1'] ?? null, 4000);
check('merge haelt Host b',  $mm['port_uptime']['b']['1'] ?? null, 2500);

// UniFi-Ports (Vorlage „UniFi Network API – Device"): port.state/port.speed
// speisen die Oper/Admin-Korrelation bzw. port_speed, damit Knoten-Health und
// Auslastungs-Divisor OHNE Sonderpfad greifen. Werte erfunden, Form gemessen
// 2026-10-26. Kein Per-Port-Traffic (API liefert keins).
$u = MetricExtractor::extract([
    ['hostid' => 'usw', 'key_' => 'port.state[1]', 'name' => '', 'lastvalue' => 'UP'],
    ['hostid' => 'usw', 'key_' => 'port.state[2]', 'name' => '', 'lastvalue' => 'DOWN'],
    ['hostid' => 'usw', 'key_' => 'port.state[3]', 'name' => '', 'lastvalue' => 'UP'],
    ['hostid' => 'usw', 'key_' => 'port.speed[1]', 'name' => '', 'lastvalue' => '1000000000'],
    ['hostid' => 'usw', 'key_' => 'port.speed[2]', 'name' => '', 'lastvalue' => '0'],
]);
check('UniFi: ein Port down gezaehlt',        $u['iface']['usw']['down'] ?? null, 1);
check('UniFi: drei Ports gezaehlt',           $u['iface']['usw']['count'] ?? null, 3);
check('UniFi: Port 2 im port_status (down)',  $u['port_status']['usw']['2'] ?? null, true);
check('UniFi: Port 1 im port_status (up)',    $u['port_status']['usw']['1'] ?? null, false);
check('UniFi: port.speed -> port_speed',      $u['port_speed']['usw']['1'] ?? null, 1.0e9);
check('UniFi: speed 0 nicht gemerkt',         isset($u['port_speed']['usw']['2']), false);
check('UniFi: kein Per-Port-Traffic',         isset($u['port_traffic']['usw']), false);

// UniFi geraeteweiter Uplink-Durchsatz: uplink.rx/tx -> uplink_rate[hid][in/out].
$ur = MetricExtractor::extract([
    ['hostid' => 'usw', 'key_' => 'uplink.rx', 'name' => '', 'lastvalue' => '1569752'],
    ['hostid' => 'usw', 'key_' => 'uplink.tx', 'name' => '', 'lastvalue' => '116656'],
    ['hostid' => 'leer', 'key_' => 'uplink.rx', 'name' => '', 'lastvalue' => ''],
]);
check('UniFi: uplink.rx -> uplink_rate in',   $ur['uplink_rate']['usw']['in'] ?? null, 1569752.0);
check('UniFi: uplink.tx -> uplink_rate out',  $ur['uplink_rate']['usw']['out'] ?? null, 116656.0);
check('UniFi: leerer uplink.rx nicht gemerkt', isset($ur['uplink_rate']['leer']), false);

// WLAN: Funkmodule je Band (radio.*, Integration-API) + Client-Zahl (wlan.clients)
// + Funkauslastung (wlan.cu[band], Prozent), beide aus der klassischen API, seit
// 5.5.83 am AP-Host selbst. Werte erfunden, Form gemessen. channelWidth Hz -> MHz,
// cu wird in die radios-Map des jeweiligen Bands gefaltet.
$w = MetricExtractor::extract([
    ['hostid' => 'ap',  'key_' => 'radio.channel[2.4]',      'name' => '', 'lastvalue' => '6'],
    ['hostid' => 'ap',  'key_' => 'radio.standard[2.4]',     'name' => '', 'lastvalue' => '802.11n'],
    ['hostid' => 'ap',  'key_' => 'radio.channelWidth[2.4]', 'name' => '', 'lastvalue' => '20000000'],
    ['hostid' => 'ap',  'key_' => 'radio.channel[5]',        'name' => '', 'lastvalue' => '36'],
    ['hostid' => 'ap',  'key_' => 'radio.standard[5]',       'name' => '', 'lastvalue' => '802.11ac'],
    ['hostid' => 'ap',  'key_' => 'radio.channelWidth[5]',   'name' => '', 'lastvalue' => '40000000'],
    ['hostid' => 'ap',  'key_' => 'wlan.clients',            'name' => '', 'lastvalue' => '5'],
    ['hostid' => 'ap',  'key_' => 'wlan.cu[2.4]',            'name' => '', 'lastvalue' => '28'],
    ['hostid' => 'ap',  'key_' => 'wlan.cu[5]',              'name' => '', 'lastvalue' => '22.4'],
    ['hostid' => 'ap',  'key_' => 'radios.txRestries[2.4]',  'name' => '', 'lastvalue' => '9.8'],
    ['hostid' => 'ap',  'key_' => 'radios.txRestries[5]',    'name' => '', 'lastvalue' => '4'],
    ['hostid' => 'ap',  'key_' => 'wlan.satisfaction',       'name' => '', 'lastvalue' => '92'],
    ['hostid' => 'idle','key_' => 'wlan.satisfaction',       'name' => '', 'lastvalue' => '-1'],
    ['hostid' => 'ap',  'key_' => 'wlan.ssids',             'name' => '', 'lastvalue' =>
        '[{"ssid":"Office WiFi","clients":3,"guest":false},{"ssid":"Guest WiFi","clients":1,"guest":true}]'],
    ['hostid' => 'bad', 'key_' => 'wlan.ssids',             'name' => '', 'lastvalue' => 'kein json'],
    ['hostid' => 'leer','key_' => 'wlan.clients',            'name' => '', 'lastvalue' => ''],
]);
check('WLAN: radio 2.4 Kanal',   $w['radios']['ap']['2.4']['channel'] ?? null, 6);
check('WLAN: radio 2.4 Standard', $w['radios']['ap']['2.4']['std'] ?? null, '802.11n');
check('WLAN: radio 2.4 Breite Hz->MHz', $w['radios']['ap']['2.4']['width'] ?? null, 20);
check('WLAN: radio 5 Kanal',     $w['radios']['ap']['5']['channel'] ?? null, 36);
check('WLAN: radio 5 Breite 40MHz', $w['radios']['ap']['5']['width'] ?? null, 40);
// Client-Zahl jetzt direkt aus extract() (wlan.clients am AP-Host).
check('WLAN: wlan.clients -> wlan_clients', $w['wlan_clients']['ap'] ?? null, 5);
check('WLAN: leere wlan.clients nicht gemerkt', isset($w['wlan_clients']['leer']), false);
// Funkauslastung in die radios-Map gefaltet, gerundet auf ganze Prozent.
check('WLAN: wlan.cu[2.4] -> radios cu', $w['radios']['ap']['2.4']['cu'] ?? null, 28);
check('WLAN: wlan.cu[5] gerundet',       $w['radios']['ap']['5']['cu'] ?? null, 22);
// Retries (radios.txRestries, Template-Tippfehler) -> radios.retr, 1 Nachkommastelle.
check('WLAN: txRestries[2.4] -> radios retr', $w['radios']['ap']['2.4']['retr'] ?? null, 9.8);
check('WLAN: txRestries[5] -> radios retr',   $w['radios']['ap']['5']['retr'] ?? null, 4.0);
// SSIDs: JSON dekodiert, Name/Clients/Guest uebernommen; kaputtes JSON verworfen.
check('WLAN: ssids Name',        $w['ssids']['ap'][0]['ssid'] ?? null,    'Office WiFi');
check('WLAN: ssids Clients',     $w['ssids']['ap'][0]['clients'] ?? null, 3);
check('WLAN: ssids Guest-Flag',  $w['ssids']['ap'][1]['guest'] ?? null,   true);
check('WLAN: kaputtes ssids-JSON verworfen', isset($w['ssids']['bad']),   false);
check('WLAN: wlan.satisfaction -> wlan_satisfaction', $w['wlan_satisfaction']['ap'] ?? null, 92);
check('WLAN: negatives satisfaction (-1 idle) verworfen', isset($w['wlan_satisfaction']['idle']), false);

// UniFi CPU/Memory: nackte Keys cpu.utilization/memory.utilization (Device-
// Template, direkter Prozentwert). Lagen bisher nicht im erkannten Satz, darum
// zeigten UniFi-Geraete „not collected" trotz vorhandenem Wert.
$um = MetricExtractor::extract([
    ['hostid' => 'u', 'key_' => 'cpu.utilization',    'name' => '', 'lastvalue' => '6'],
    ['hostid' => 'u', 'key_' => 'memory.utilization', 'name' => '', 'lastvalue' => '34.3'],
]);
check('UniFi: cpu.utilization -> cpu',    $um['cpu']['u'] ?? null,    6.0);
check('UniFi: memory.utilization -> mem', $um['memory']['u'] ?? null, 34);

// VLAN: nt.vlan.walk -> VlanParser -> metrics['vlan'][hid]. Ein Walk-Text mit
// VLAN 10 auf Bridge-Ports 1,2 (Maske C0) -> ifIndex 101,102.
$vm = MetricExtractor::extract([[
    'hostid' => 'sw', 'key_' => 'nt.vlan.walk', 'name' => '',
    'lastvalue' =>
        ".1.3.6.1.2.1.17.7.1.4.3.1.2.10 = Hex-STRING: C0 00 00 00\n"
      . ".1.3.6.1.2.1.17.1.4.1.2.1 = INTEGER: 101\n"
      . ".1.3.6.1.2.1.17.1.4.1.2.2 = INTEGER: 102\n",
]]);
check('VLAN: nt.vlan.walk -> vlan[hid] gesetzt', isset($vm['vlan']['sw']),            true);
check('VLAN: eine VLAN erkannt',                 count($vm['vlan']['sw']['vlans'] ?? []), 1);
check('VLAN: byIfIndex 101 -> [10]',             $vm['vlan']['sw']['byIfIndex'][101] ?? null, [10]);
check('VLAN: leerer Walk -> kein Eintrag',
    isset(MetricExtractor::extract([['hostid' => 'x', 'key_' => 'nt.vlan.walk', 'name' => '', 'lastvalue' => '']])['vlan']['x']),
    false);

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
