<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\NodeBuilder.
 *
 * Der Zusammenbau-Schritt: hier laufen Hosts, Metriken, Tags und Probleme
 * zusammen zu dem, was das Frontend zeichnet. Getestet wird vor allem die
 * PRAEZEDENZ — ein nt:icon-Tag muss die automatische Geraetetyp-Erkennung
 * ueberstimmen. Dreht sich das um, bekommt jeder Admin, der bewusst ein Icon
 * gesetzt hat, wieder das geratene zu sehen, ohne dass irgendetwas fehlschlaegt.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP.
 *
 * Aufruf:  php tests/NodeBuilderTest.php
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

use Modules\NetworkTopologyV6\Topology\NodeBuilder;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-56s got=%-14s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

function mkHost(string $host, string $name, int $iftype, string $ip): array {
    return [
        'host'               => $host,
        'name'               => $name,
        'interfaces'         => [['main' => '1', 'type' => (string) $iftype, 'ip' => $ip]],
        'parentTemplates'    => [],
        'inventory'          => [],
        'maintenance_status' => '0',
        'proxyid'            => '0',
        'proxy_groupid'      => '0',
        'active_available'   => '1',
    ];
}

$hosts = [
    // h1: heisst "sw-core" -> die Heuristik wuerde 'switch' raten.
    //     Es liegt aber ein nt:icon=firewall-Tag vor -> das muss GEWINNEN.
    'h1' => mkHost('sw-core', 'Core Switch', 1, '10.0.0.1'),
    // h2: kein Tag -> die Heuristik greift ('nas-01' -> storage). Kein Anzeigename
    //     -> als Label muss der technische Name einspringen.
    'h2' => mkHost('nas-01', '', 2, '10.0.0.2'),
];

$metrics = [
    'cpu'     => ['h1' => 42.3],
    'memory'  => ['h1' => 76],
    'traffic' => ['h1' => ['in' => 1000.0, 'out' => 2000.0]],
    'iface'   => [],
    'speed'   => ['h1' => 1.0e9],
    'ping'    => ['h1' => 5.3],
];

$tags = [
    'icon_override' => ['h1' => 'firewall'],   // ueberstimmt das geratene 'switch'
    'show_keys'     => [],
    'links'         => [],
];

$problems = [
    'severity'     => ['h1' => 4],
    'problems'     => ['h1' => 2],
    'problem_list' => [],
    'ack_total'    => [],
    'ack_acked'    => [],
    'last_seen'    => [],
];

$context = [
    'group_names'        => ['h1' => ['Demo']],
    'proxy_names'        => [],
    'pgroup_names'       => [],
    'lldp_quality'       => [],
    'items_show'         => [],
    'show_item_per_host' => [],
    'primary_ip_cache'   => [],
];

$r     = NodeBuilder::build($hosts, $metrics, $tags, $problems, $context);
$byId  = [];
foreach ($r['nodes'] as $n) {
    $byId[$n['id']] = $n;
}

echo "\nGrundgeruest\n";
check('beide Hosts werden zu Knoten',        count($r['nodes']),            2);
check('Anzeigename gewinnt als Label',       $byId['h1']['label'] ?? null,  'Core Switch');
check('ohne Anzeigename: technischer Name',  $byId['h2']['label'] ?? null,  'nas-01');

echo "\nMetriken durchgereicht\n";
check('cpu',      $byId['h1']['cpu']    ?? null, 42.3);
check('memory',   $byId['h1']['memory'] ?? null, 76);
check('ping',     $byId['h1']['ping']   ?? null, 5.3);
check('severity', $byId['h1']['severity'] ?? null, 4);
check('problems', $byId['h1']['problems'] ?? null, 2);

echo "\nGeraetetyp — die Praezedenz\n";
check('nt:icon ueberstimmt die Heuristik',   $byId['h1']['type'] ?? null,          'firewall');
check('override wird als solches markiert',  $byId['h1']['icon_override'] ?? null, true);
check('ohne Tag greift die Heuristik',       $byId['h2']['type'] ?? null,          'storage');
check('und wird NICHT als override markiert', $byId['h2']['icon_override'] ?? null, false);

echo "\nInterface-Aufloesung\n";
check('IP des primaeren Interfaces', $byId['h1']['ip']     ?? null, '10.0.0.1');
check('Interface-Typ Agent',         $byId['h1']['iftype'] ?? null, 'Agent');
check('Interface-Typ SNMP',          $byId['h2']['iftype'] ?? null, 'SNMP');

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
