<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Invented LLDP local identities and interface metrics.
declare(strict_types=1);
spl_autoload_register(static function(string $class): void {
    $prefix = 'Modules\\NetworkTopology\\';
    if (strpos($class, $prefix) !== 0) return;
    $parts = explode('\\', substr($class, strlen($prefix)));
    $file = array_pop($parts);
    require dirname(__DIR__) . '/' . strtolower(implode('/', $parts)) . '/' . $file . '.php';
});
use Modules\NetworkTopology\Topology\MetricExtractor;
use Modules\NetworkTopology\Topology\LldpEdgeBuilder;

function verify($got, $want, string $message): void {
    if ($got !== $want) throw new RuntimeException($message . ': ' . var_export($got, true));
    echo "PASS $message\n";
}
function item(string $key, string $value): array {
    return ['hostid'=>'a', 'key_'=>$key, 'lastvalue'=>$value, 'value_type'=>1];
}
function edge(array $extra, string $index='13', string $source='lldp'): array {
    $metrics = MetricExtractor::extract(array_merge([
        item('nt.if.name[ifName.3001]', 'Ethernet3/1'),
        item('nt.if.description[ifDescr.3001]', 'Ethernet3/1'),
        item('nt.if.name[ifName.13]', 'Vlan13'),
        item('net.if.status[ifOperStatus.3001]', '2'),
        item('net.if.status[ifOperStatus.13]', '1'),
        item('net.if.in[ifHCInOctets.3001]', '900000'),
        item('net.if.speed[ifHighSpeed.3001]', '10000000000'),
    ], $extra));
    $r = LldpEdgeBuilder::build(
        ['a'=>['host'=>'lab-a','name'=>'lab-a'], 'b'=>['host'=>'lab-b','name'=>'lab-b']],
        [['hostid'=>'a','key_'=>$source==='cdp'?'cdpCacheDeviceId['.$index.'.1]':'lldpRemSysName[0.'.$index.'.1]',
          'lastvalue'=>'lab-b','src'=>$source]],
        [], $metrics['port_traffic'], $metrics['port_speed'], [], [], [],
        port_names: $metrics['port_names'], port_status: $metrics['port_status'],
        lldp_local: $metrics['lldp_local'], interface_names: $metrics['interface_names']
    );
    verify(count($r['edges']), 1, 'one cable retained');
    return $r['edges'][0];
}
$local = [item('nt.lldp.local.id[lldpLocPortId.13]', 'Ethernet3/1'),
    item('nt.lldp.local.subtype[lldpLocPortIdSubtype.13]', '5'),
    item('nt.lldp.local.description[lldpLocPortDesc.13]', 'Ethernet3/1')];
$e = edge($local);
verify($e['port_idx']['a'], '3001', 'LLDP 13 resolves to ifIndex 3001 despite colliding VLAN');
verify($e['ports']['a'], 'Ethernet3/1', 'physical interface label');
verify($e['port_metrics']['a']['down'] ?? null, true, 'down state comes from physical interface');
verify($e['port_metrics']['a']['in'] ?? null, 900000.0, 'traffic comes from physical interface');
$e = edge(array_merge($local, [item('nt.if.name[ifName.3002]', 'Ethernet3/1')]));
verify($e['port_idx']['a'] ?? '', '', 'duplicate identity stays unresolved');
verify($e['port_metrics']['a']['down'] ?? null, null, 'ambiguous mapping cannot borrow VLAN metrics');
$e = edge([item('lldpLocPortDesc[13]', 'missing-port')]);
verify($e['port_idx']['a'] ?? '', '', 'unknown explicit identity stays unresolved');
$e = edge([]);
verify($e['port_idx']['a'], '13', 'legacy direct-index behaviour retained without metadata');
$m = MetricExtractor::extract([item('lldpLocPortId[9]', 'Eth1/2'), item('lldpLocPortIdSubtype[9]', '5')]);
verify($m['lldp_local']['a'][9]['Id'], 'Eth1/2', 'standard local-port key parsed');
$e = edge([item('lldpLocPortIdSubtype[13]', '3'), item('lldpLocPortId[13]', '00:11:22:33:44:55'),
    item('lldpLocPortDesc[13]', 'Eth3/1')]);
verify($e['port_idx']['a'], '3001', 'MAC ID ignored and normalized description resolves');
$e = edge(array_merge($local, [item('lldpLocPortDesc[13]', 'Vlan13')]));
verify($e['port_idx']['a'] ?? '', '', 'conflicting local ID and description stay unresolved');
$e = edge($local, '13', 'cdp');
verify($e['port_idx']['a'], '13', 'CDP ifIndex is never translated as an LLDP local number');
$e = edge([item('lldpLocPortDesc[9]', 'Eth1/2'), item('nt.if.name[ifName.110]', 'Eth1/2')], '9');
verify($e['port_idx']['a'], '110', 'Mellanox local 9 maps to ifIndex 110');
$e = edge([item('lldpLocPortDesc[49]', 'te1/0/1'),
    item('nt.if.name[ifName.49]', 'TenGigabitEthernet1/0/1')], '49');
verify($e['port_idx']['a'], '49', 'Cisco short and long names normalize consistently');
$e = edge([item('lldpLocPortDesc[1]', '0/1'), item('nt.if.name[ifName.1]', '0/1')], '1');
verify($e['port_idx']['a'], '1', 'Netgear direct local identity retains ifIndex 1');
$e = edge([item('lldpLocPortDesc[7]', 'Eth7/1'),
    item('nt.if.name[ifName.7001]', 'et-7/1'),
    item('nt.if.description[ifDescr.7001]', 'Ethernet7/1')], '7');
verify($e['port_idx']['a'], '7001', 'ifDescr remains usable when preferred ifName differs');

// LLDP port 13 and CDP ifIndex 13 describe different cables here. The resolved
// LLDP index must participate in the upstream proven-index guard.
$hosts = [
    'a' => ['host' => 'lab-a', 'name' => 'lab-a'],
    'b' => ['host' => 'lab-b', 'name' => 'lab-b'],
];
$reports = [
    ['hostid' => 'a', 'key_' => 'lldpRemSysName[0.13.1]', 'lastvalue' => 'lab-b', 'src' => 'lldp'],
    ['hostid' => 'a', 'key_' => 'cdpCacheDeviceId[13.1]', 'lastvalue' => 'lab-b', 'src' => 'cdp'],
];
$names = ['a' => [13 => 'Vlan13', 3001 => 'Ethernet3/1']];
$identities = ['a' => [13 => ['Desc' => 'Ethernet3/1']]];
$ifNames = ['a' => [13 => ['Vlan13'], 3001 => ['Ethernet3/1']]];
$result = LldpEdgeBuilder::build($hosts, $reports, port_names: $names,
    lldp_local: $identities, interface_names: $ifNames);
verify(count($result['edges']), 2, 'proven LLDP and CDP indices preserve two cables');
$reports[1]['key_'] = 'cdpCacheDeviceId[3001.1]';
$result = LldpEdgeBuilder::build($hosts, $reports, port_names: $names,
    lldp_local: $identities, interface_names: $ifNames);
verify(count($result['edges']), 1, 'LLDP and CDP reports of the same interface merge');
