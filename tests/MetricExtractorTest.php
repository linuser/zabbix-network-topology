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

use Modules\NetworkTopologyV6\Topology\MetricExtractor;

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
     'lastvalue' => 'edd7d002-b7b6-3675-8663-608ae2466f0b'],
];
$mu = MetricExtractor::extract($itemsU);
check('uplink.id wird als Nachbar erkannt',  count($mu['lldp_raw']),                1);
check('uplink.id -> src=unifi',              $mu['lldp_raw'][0]['src'] ?? null,      'unifi');
check('uplink.id -> Wert bleibt die UUID',   $mu['lldp_raw'][0]['lastvalue'] ?? null,
      'edd7d002-b7b6-3675-8663-608ae2466f0b');
// Abgrenzung: uplink.rx/tx sind Traffic, KEINE Nachbarn — duerfen nicht rein.
$mu2 = MetricExtractor::extract([
    ['hostid' => 'c', 'key_' => 'uplink.rx', 'name' => 'Uplink RX', 'lastvalue' => '12345'],
    ['hostid' => 'c', 'key_' => 'uplink.tx', 'name' => 'Uplink TX', 'lastvalue' => '678'],
]);
check('uplink.rx/tx sind KEINE Nachbarn',    count($mu2['lldp_raw']),               0);

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
