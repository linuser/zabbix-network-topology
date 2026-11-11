<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\PortNameParser.
 *
 * Der Portnamen-Rueckfall aus dem Item-NAMEN ({#IFNAME}) ist das, was den
 * #29-Proven-Index-Guard auch auf Hosts ohne ifName-Items greifen laesst
 * (Zabbix' Stock-Cisco-IOS-Template). Rateschritte sind hier gefaehrlich: ein
 * falscher Portname verschafft dem falschen Port Messwerte. Deshalb pruefen
 * wir das Parsen ebenso streng wie die Nachbar-Zuordnung.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP.
 *
 * Aufruf:  php tests/PortNameParserTest.php
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

use Modules\NetworkTopology\Topology\PortNameParser;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-58s got=%-14s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

// ── 1. Item-NAME -> Portname ──────────────────────────────────────────────
echo "\nItem-Name -> Portname\n";
check('Name + Alias in Klammern',
    PortNameParser::fromItemName('Interface Gi1/0/9(Uplink to core): Bits received'), 'Gi1/0/9');
check('Name + leere Klammern',
    PortNameParser::fromItemName('Interface Gi1/0/11(): Operational status'), 'Gi1/0/11');
check('Name ohne Klammern, Doppelpunkt',
    PortNameParser::fromItemName('Interface Gi1/1/2: Bits sent'), 'Gi1/1/2');
check('langer Interface-Name',
    PortNameParser::fromItemName('Interface GigabitEthernet1/0/21: Speed'), 'GigabitEthernet1/0/21');
check('Rand-Leerzeichen werden getrimmt',
    PortNameParser::fromItemName('Interface   Te1/0/1 : Status'), 'Te1/0/1');
check('kein "Interface"-Praefix -> null (nichts raten)',
    PortNameParser::fromItemName('CPU utilization'), null);
check('leerer Name -> null',
    PortNameParser::fromItemName(''), null);
check('nur "Interface" ohne Port -> null',
    PortNameParser::fromItemName('Interface : foo'), null);

// ── 2. Key -> ifIndex ─────────────────────────────────────────────────────
echo "\nKey -> ifIndex\n";
check('Cisco-Stock: MIB-Name vor Index',
    PortNameParser::ifIndexOf('net.if.status[ifOperStatus.10126]'), '10126');
check('Cisco-Stock: Octets',
    PortNameParser::ifIndexOf('net.if.in[ifHCInOctets.10111]'), '10111');
check('nackte Index-Form',
    PortNameParser::ifIndexOf('net.if.out[24]'), '24');
check('Agent-Namens-Interface -> null',
    PortNameParser::ifIndexOf('net.if.in[eth0]'), null);
check('Agent-Namens-Interface in Anfuehrungszeichen -> null',
    PortNameParser::ifIndexOf('net.if.in["ens18"]'), null);
check('fremder Praefix (nt.if.stp) -> null',
    PortNameParser::ifIndexOf('nt.if.stp[10126]'), null);
check('ifName-Item ist NICHT net.if -> null (anderer Pfad)',
    PortNameParser::ifIndexOf('ifName[10126]'), null);

// ── 3. build(): Roh-Zeilen -> [hid => [ifIndex => name]] ─────────────────
echo "\nbuild(): ganze Host-Tabelle\n";

// Ein Stock-Cisco-Host: je Interface mehrere net.if-Items, alle mit demselben
// {#IFNAME} im Namen; KEINE ifName-Items.
$rows = [
    ['hostid' => 'swA', 'key_' => 'net.if.in[ifHCInOctets.10111]',   'name' => 'Interface Gi1/0/11(): Bits received'],
    ['hostid' => 'swA', 'key_' => 'net.if.out[ifHCOutOctets.10111]', 'name' => 'Interface Gi1/0/11(): Bits sent'],
    ['hostid' => 'swA', 'key_' => 'net.if.status[ifOperStatus.10111]','name' => 'Interface Gi1/0/11(): Operational status'],
    ['hostid' => 'swA', 'key_' => 'net.if.status[ifOperStatus.10126]','name' => 'Interface Gi1/1/2(Uplink): Operational status'],
    // Agent-Namens-Interface: kein numerischer Index -> ignoriert
    ['hostid' => 'swA', 'key_' => 'net.if.in[eth0]',                 'name' => 'Interface eth0: Bits received'],
    // Nicht-Interface-Item: ignoriert
    ['hostid' => 'swA', 'key_' => 'system.cpu.util',                 'name' => 'CPU utilization'],
];
$map = PortNameParser::build($rows);
check('Port 10111 aufgeloest',               $map['swA']['10111'] ?? null, 'Gi1/0/11');
check('Port 10126 aufgeloest',               $map['swA']['10126'] ?? null, 'Gi1/1/2');
check('Agent-Interface eth0 nicht enthalten', isset($map['swA']['eth0']),   false);
check('nur die zwei SNMP-Ports',             count($map['swA']),           2);

// Reihenfolge-Unabhaengigkeit: erster Treffer je Index gewinnt, und alle
// Items eines Index tragen ohnehin denselben Namen -> umgedreht identisch.
$rev = PortNameParser::build(array_reverse($rows));
check('Reihenfolge egal (10111)', $rev['swA']['10111'] ?? null, 'Gi1/0/11');
check('Reihenfolge egal (10126)', $rev['swA']['10126'] ?? null, 'Gi1/1/2');

// Host ganz ohne brauchbare Interface-Namen -> gar kein Eintrag (nicht leeres
// Array), damit der Aufrufer "nichts gefunden" sauber erkennt.
$leer = PortNameParser::build([
    ['hostid' => 'swB', 'key_' => 'system.cpu.util', 'name' => 'CPU utilization'],
    ['hostid' => 'swB', 'key_' => 'net.if.in[eth0]', 'name' => 'Interface eth0: Bits received'],
]);
check('Host ohne SNMP-Ports fehlt ganz', isset($leer['swB']), false);

echo "\n";
if ($failures > 0) {
    printf("FAIL: %d Pruefung(en) fehlgeschlagen\n", $failures);
    exit(1);
}
echo "OK: alle Pruefungen bestanden\n";
