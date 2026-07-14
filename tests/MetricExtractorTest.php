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

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
