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

use Modules\NetworkTopology\Topology\NodeBuilder;

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
    // h6: UniFi-Client-Template -> Typ 'client' + is_client, obwohl der Name
    //     sonst im 'server'-Fallback laendete.
    'h6' => [
        'host' => 'uuid-client', 'name' => 'iPhone xy',
        'interfaces' => [['main' => '1', 'type' => '1', 'ip' => '192.0.2.1']],
        'parentTemplates' => [['name' => 'UniFi Network API - Client']],
        'inventory' => [], 'maintenance_status' => '0',
        'proxyid' => '0', 'proxy_groupid' => '0', 'active_available' => '1',
    ],
    // h7: Client-Template ABER explizites nt:icon -> bewusste Setzung gewinnt
    // VOLL: Typ = Override, und is_client bleibt false (nicht ausgeblendet).
    'h7' => [
        'host' => 'uuid-client2', 'name' => 'NAS am WLAN',
        'interfaces' => [['main' => '1', 'type' => '1', 'ip' => '192.0.2.1']],
        'parentTemplates' => [['name' => 'UniFi Network API - Client']],
        'inventory' => [], 'maintenance_status' => '0',
        'proxyid' => '0', 'proxy_groupid' => '0', 'active_available' => '1',
    ],
];

$metrics = [
    'cpu'     => ['h1' => 42.3],
    'memory'  => ['h1' => 76],
    'traffic' => ['h1' => ['in' => 1000.0, 'out' => 2000.0]],
    'iface'   => [],
    'speed'   => ['h1' => 1.0e9],
    'ping'    => ['h1' => 5.3],
    // WLAN (UniFi-AP): Radios inkl. Funkauslastung + Client-Zahl, seit 5.5.83 am
    // AP-Host selbst. Hier an h1 gehaengt — die Felder haengen typunabhaengig.
    'radios'       => ['h1' => ['2.4' => ['channel' => 6, 'cu' => 28]]],
    'wlan_clients' => ['h1' => 5],
    'ssids'        => ['h1' => [['ssid' => 'Office WiFi', 'clients' => 3, 'guest' => false]]],
    'wlan_satisfaction' => ['h1' => 88],
    'vlan'         => ['h1' => [
        'vlans'     => [['id' => 10, 'name' => 'office', 'ports' => ['Gi1']],
                        ['id' => 20, 'name' => '',       'ports' => ['Gi2']]],
        'byIfIndex' => [101 => [10], 102 => [20]],
        'access'    => [101 => 10],
    ]],
];

$tags = [
    'icon_override' => ['h1' => 'firewall', 'h7' => 'storage'],  // ueberstimmt Heuristik/Client
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
check('alle Hosts werden zu Knoten',         count($r['nodes']),            4);
check('Anzeigename gewinnt als Label',       $byId['h1']['label'] ?? null,  'Core Switch');
check('ohne Anzeigename: technischer Name',  $byId['h2']['label'] ?? null,  'nas-01');

echo "\nMetriken durchgereicht\n";
check('cpu',      $byId['h1']['cpu']    ?? null, 42.3);
check('memory',   $byId['h1']['memory'] ?? null, 76);
check('ping',     $byId['h1']['ping']   ?? null, 5.3);
check('severity', $byId['h1']['severity'] ?? null, 4);
check('problems', $byId['h1']['problems'] ?? null, 2);
check('wlan_clients durchgereicht',    $byId['h1']['wlan_clients'] ?? null, 5);
check('radios inkl. cu durchgereicht', $byId['h1']['radios']['2.4']['cu'] ?? null, 28);
check('ssids durchgereicht',           $byId['h1']['ssids'][0]['ssid'] ?? null, 'Office WiFi');
check('wlan_satisfaction durchgereicht', $byId['h1']['wlan_satisfaction'] ?? null, 88);
check('VLANs auf {id,name} reduziert',   $byId['h1']['vlans'] ?? null,
    [['id' => 10, 'name' => 'office'], ['id' => 20, 'name' => '']]);
check('vlan_by_if durchgereicht',        $byId['h1']['vlan_by_if'][101] ?? null, [10]);
check('ohne VLAN-Daten: vlans null',
    array_key_exists('vlans', $byId['h2']) ? $byId['h2']['vlans'] : 'FEHLT', null);
check('UniFi-Client -> Typ client',    $byId['h6']['type'] ?? null,       'client');
check('UniFi-Client -> is_client',     $byId['h6']['is_client'] ?? null,  true);
check('Nicht-Client -> is_client false', $byId['h2']['is_client'] ?? null, false);
check('Client MIT nt:icon -> Override-Typ', $byId['h7']['type'] ?? null,     'storage');
check('Client MIT nt:icon -> is_client false', $byId['h7']['is_client'] ?? null, false);
check('ohne Quelle: wlan_clients null',
    array_key_exists('wlan_clients', $byId['h2']) ? $byId['h2']['wlan_clients'] : 'MISSING', null);

echo "\nGeraetetyp — die Praezedenz\n";
check('nt:icon ueberstimmt die Heuristik',   $byId['h1']['type'] ?? null,          'firewall');
check('override wird als solches markiert',  $byId['h1']['icon_override'] ?? null, true);
check('ohne Tag greift die Heuristik',       $byId['h2']['type'] ?? null,          'storage');
check('und wird NICHT als override markiert', $byId['h2']['icon_override'] ?? null, false);

echo "\nInterface-Aufloesung\n";
check('IP des primaeren Interfaces', $byId['h1']['ip']     ?? null, '10.0.0.1');
check('Interface-Typ Agent',         $byId['h1']['iftype'] ?? null, 'Agent');
check('Interface-Typ SNMP',          $byId['h2']['iftype'] ?? null, 'SNMP');

// ── Stufe 5 gegen den ECHTEN NodeBuilder ─────────────────────────────────
//
// DeviceTypeTest bildet die Stufen nach; hier laeuft der Code selbst. Anlass
// ist ein Review-Befund: sichtbarer Name und Host-Gruppen liefen zuerst
// innerhalb von deviceType() und damit VOR den Capabilities — ein Switch mit
// Bridge-Bit wurde in der Gruppe "Site A/Storage room" zu storage.
echo "\nGeraetetyp — sichtbarer Name und Gruppen als LETZTE Stufe\n";

$hStufe = [
    // Switch, UUID als Hostname, Bridge-Bit gemeldet, ungluecklich benannte Gruppe
    'h3' => mkHost('d08eeab1-3aa9-475b-8755-9a6cbcf05bd0', 'LABNODE01', 2, '10.0.1.3'),
    // fuehrt selbst eine Nachbartabelle, Gruppe "Backups"
    'h4' => mkHost('0a1b2c3d-0000-4000-8000-000000000004', 'LABNODE02', 2, '10.0.1.4'),
    // UniFi-Kamera: weder Caps noch Nachbartabelle, nur die Gruppe weiss es
    'h5' => mkHost('74d55e79-b52e-44a5-a324-1bf8bcc67464', 'Rooftop', 1, '10.0.1.5'),
];
foreach ($hStufe as &$hs) {
    $hs['parentTemplates'] = [['name' => 'Some SNMP Template']];
}
unset($hs);

$rS = NodeBuilder::build($hStufe,
    ['cpu' => [], 'memory' => [], 'traffic' => [], 'iface' => [], 'speed' => [], 'ping' => []],
    ['icon_override' => [], 'show_keys' => [], 'links' => []],
    ['severity' => [], 'problems' => [], 'problem_list' => [], 'ack_total' => [],
     'ack_acked' => [], 'last_seen' => []],
    [
        'group_names'        => [
            'h3' => ['Site A/Storage room'],
            'h4' => ['Backups'],
            'h5' => ['UniFi Network Clients/camera'],
        ],
        'proxy_names'        => [],
        'pgroup_names'       => [],
        'lldp_quality'       => [],
        'items_show'         => [],
        'show_item_per_host' => [],
        'primary_ip_cache'   => [],
        'lldp_host_caps'     => ['h3' => ['Bridge']],
        'lldp_speakers'      => ['h4' => true],
    ]);
$typ = [];
foreach ($rS['nodes'] as $n) {
    $typ[$n['id']] = $n['type'] ?? null;
}
check('Bridge-Bit schlaegt Gruppe "Storage room"', $typ['h3'] ?? null, 'switch');
check('Nachbartabelle schlaegt Gruppe "Backups"',  $typ['h4'] ?? null, 'switch');
check('ohne beides entscheidet die Gruppe',        $typ['h5'] ?? null, 'camera');

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
