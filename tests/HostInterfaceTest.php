<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer die Interface-Auswahl in Topology\HostMetadata.
 *
 * primaryIp() entscheidet, WELCHE Adresse ein Host auf der Karte traegt.
 * Ein Host hat oft mehrere Interfaces — Agent und SNMP, manchmal IPMI
 * daneben —, und nur eine Adresse wird angezeigt. Dieselbe Adresse geht in
 * die IP-Zuordnung des Nachbar-Matchings ein, und genau dort liegt die
 * offene Zusage aus Issue #14 (IP-Kollisionen).
 *
 * Die Klasse war bis hierher nur zur Haelfte geprueft: DeviceTypeTest deckt
 * die Typerkennung ab (deviceType, typeFromCaps, typeFromHints, speakers),
 * die Interface-Auswahl war offen. Eine falsche Auswahl faellt nicht auf —
 * es steht einfach eine andere IP da, und die sieht aus wie eine richtige.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP.
 *
 * Aufruf:  php tests/HostInterfaceTest.php
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
        require_once $path;
    }
});

use Modules\NetworkTopology\Topology\HostMetadata;

$fehler = 0;

function pruefe(string $was, $gegeben, $erwartet): void {
    global $fehler;
    $ok = $gegeben === $erwartet;
    if (!$ok) {
        $fehler++;
    }
    printf("  [%s] %-54s %s\n", $ok ? 'PASS' : 'FAIL', $was,
        $ok ? '' : 'got=' . var_export($gegeben, true) . ' want=' . var_export($erwartet, true));
}

/** Interface, wie die Zabbix-API es liefert: Zahlen als Zeichenketten. */
function iface(string $ip, string $main, string $type): array {
    return ['ip' => $ip, 'main' => $main, 'type' => $type];
}

// Typen laut Zabbix: 1=Agent, 2=SNMP, 3=IPMI, 4=JMX
const AGENT = '1', SNMP = '2', IPMI = '3', JMX = '4';

echo "\n  primaryIp: welche Adresse der Host auf der Karte traegt\n\n";

// main schlaegt den Typ. Ein als Standard markiertes SNMP-Interface gewinnt
// gegen einen Agenten, der nur zufaellig den kleineren Typ hat.
pruefe('main=1 gewinnt gegen kleineren Typ',
    HostMetadata::primaryIp([
        iface('10.0.0.1', '0', AGENT),
        iface('10.0.0.2', '1', SNMP),
    ]), '10.0.0.2');

// Unter mehreren Standard-Interfaces entscheidet der Typ, Agent zuerst.
pruefe('unter mehreren main gewinnt der kleinere Typ',
    HostMetadata::primaryIp([
        iface('10.0.0.9', '1', IPMI),
        iface('10.0.0.3', '1', AGENT),
        iface('10.0.0.7', '1', SNMP),
    ]), '10.0.0.3');

// Kein Interface ist als Standard markiert: es wird trotzdem eine Adresse
// geliefert, und zwar die mit dem kleinsten Typ. Besser eine plausible als
// gar keine — ein Host ohne IP sieht auf der Karte aus wie ein Fehler.
pruefe('ohne jedes main dennoch der kleinste Typ',
    HostMetadata::primaryIp([
        iface('10.0.0.8', '0', JMX),
        iface('10.0.0.4', '0', SNMP),
    ]), '10.0.0.4');

pruefe('die Reihenfolge der Eingabe aendert nichts',
    HostMetadata::primaryIp([
        iface('10.0.0.7', '1', SNMP),
        iface('10.0.0.3', '1', AGENT),
    ]), '10.0.0.3');

// ── Faelle, in denen nichts dasteht ───────────────────────────────────────
pruefe('ohne Interfaces leer',        HostMetadata::primaryIp([]), '');
pruefe('Interface ohne ip-Feld leer',
    HostMetadata::primaryIp([['main' => '1', 'type' => AGENT]]), '');

// Ein Interface kann auf DNS statt IP stehen; dann ist ip leer. Das ist kein
// Fehler, sondern eine Konfiguration — die Karte faellt auf den Hostnamen
// zurueck, und dafuer muss hier wirklich '' herauskommen und nicht etwa die
// Adresse des naechstbesten Interfaces.
pruefe('leeres ip am Standard-Interface bleibt leer',
    HostMetadata::primaryIp([
        iface('', '1', AGENT),
        iface('10.0.0.5', '0', SNMP),
    ]), '');

// ── Die Falle: gemischte Typen im main-Feld ───────────────────────────────
//
// Der Vergleich im Sortierer ist STRIKT ($b['main'] !== $a['main']). Kommen
// die Werte gemischt herein — int 1 aus eigenem Code neben '0' aus der API —
// ist der Vergleich wahr, die Differenz danach aber null, und der Sortierer
// meldet "gleich". Die Auswahl faellt dann stumm auf die Eingabereihenfolge
// zurueck.
//
// Dass die API heute durchgehend Zeichenketten liefert, macht es nicht
// richtig: wer hier einmal einen Wert castet, verschiebt die angezeigte IP,
// ohne dass etwas rot wird.
pruefe('int und string im main-Feld gemischt: main gewinnt trotzdem',
    HostMetadata::primaryIp([
        ['ip' => '10.0.0.1', 'main' => 0,   'type' => AGENT],
        ['ip' => '10.0.0.2', 'main' => '1', 'type' => SNMP],
    ]), '10.0.0.2');

// Der Fall, der den Fehler wirklich ausloeste: BEIDE sind Standard, einer
// als int 1, einer als '1'. Strikt verglichen sind sie ungleich, ihre
// Differenz ist null — der Sortierer meldete "gleich" und der Typ entschied
// nie. Hier gewann die IPMI-Adresse gegen den Agenten, nur weil sie vorne
// stand.
pruefe('beide main, einer int, einer string: der Typ entscheidet',
    HostMetadata::primaryIp([
        ['ip' => '10.0.0.9', 'main' => 1,   'type' => IPMI],
        ['ip' => '10.0.0.3', 'main' => '1', 'type' => AGENT],
    ]), '10.0.0.3');

// Fehlende Felder duerfen den Sortierer nicht sprengen.
pruefe('fehlendes main/type wird als 0 behandelt',
    HostMetadata::primaryIp([
        ['ip' => '10.0.0.6'],
        ['ip' => '10.0.0.2', 'main' => '1', 'type' => SNMP],
    ]), '10.0.0.2');

echo "\n  ifaceType: was im Panel als Schnittstelle steht\n\n";

pruefe('Agent',  HostMetadata::ifaceType([iface('10.0.0.1', '1', AGENT)]), 'Agent');
pruefe('SNMP',   HostMetadata::ifaceType([iface('10.0.0.1', '1', SNMP)]),  'SNMP');
pruefe('IPMI',   HostMetadata::ifaceType([iface('10.0.0.1', '1', IPMI)]),  'IPMI');
pruefe('JMX',    HostMetadata::ifaceType([iface('10.0.0.1', '1', JMX)]),   'JMX');
pruefe('unbekannter Typ',
    HostMetadata::ifaceType([iface('10.0.0.1', '1', '9')]), 'Unknown');

// ASYMMETRIE, absichtlich festgehalten: ohne main=1 liefert primaryIp
// trotzdem eine Adresse, ifaceType aber 'Unknown'. Im Panel steht dann eine
// IP neben "Unknown". Das ist vertretbar — die Adresse ist geraten, der Typ
// waere es auch —, aber es ist eine Entscheidung und keine Selbstverstaend-
// lichkeit. Wer eines der beiden aendert, soll das andere mitbedenken.
pruefe('ohne main: Unknown, waehrend primaryIp liefert',
    [HostMetadata::ifaceType([iface('10.0.0.4', '0', SNMP)]),
     HostMetadata::primaryIp([iface('10.0.0.4', '0', SNMP)])],
    ['Unknown', '10.0.0.4']);

pruefe('ohne Interfaces Unknown', HostMetadata::ifaceType([]), 'Unknown');

echo "\n  ifaceParam: Oper und Admin desselben Ports zusammenbringen\n\n";

// Der Zweck: ifOperStatus und ifAdminStatus desselben Interfaces muessen auf
// denselben Schluessel fallen, obwohl ihre Keys verschieden heissen.
pruefe('ifOperStatus wird auf den nackten Index gekuerzt',
    HostMetadata::ifaceParam('net.if.status[ifOperStatus.3]'), '3');
pruefe('ifAdminStatus ebenso',
    HostMetadata::ifaceParam('net.if.status[ifAdminStatus.3]'), '3');
pruefe('und beide treffen sich',
    HostMetadata::ifaceParam('net.if.status[ifOperStatus.7]')
        === HostMetadata::ifaceParam('net.if.status[ifAdminStatus.7]'), true);

// Andere Klammerinhalte bleiben unangetastet — sonst verschmelzen Ports,
// die nichts miteinander zu tun haben.
pruefe('anderer Klammerinhalt bleibt stehen',
    HostMetadata::ifaceParam('net.if.in[ifHCInOctets.8]'), 'ifHCInOctets.8');
pruefe('Agent-Interface mit Namen bleibt stehen',
    HostMetadata::ifaceParam('net.if.in[eth0]'), 'eth0');
pruefe('Schluessel ohne Klammer bleibt er selbst',
    HostMetadata::ifaceParam('system.cpu.load'), 'system.cpu.load');

echo "\n  linkUptimeSec: wie lange der Link schon steht\n\n";

// sysUpTime 1.000.000 Ticks (= 10.000 s), Port wechselte bei 400.000 Ticks.
// Differenz 600.000 Ticks = 6.000 s.
pruefe('Differenz / 100 = Sekunden',
    HostMetadata::linkUptimeSec(1000000, 400000), 6000);
// ifLastChange = 0: seit Boot unveraendert -> volle sysUpTime.
pruefe('ifLastChange 0: Uptime = sysUpTime',
    HostMetadata::linkUptimeSec(1000000, 0), 10000);
// Counter-Wrap: last liegt vor dem Ueberlauf, sys danach.
pruefe('Wrap: 2^32 wird addiert',
    HostMetadata::linkUptimeSec(100, 4294967200), 1);
// Kein sysUpTime -> keine Aussage.
pruefe('ohne sysUpTime: null',       HostMetadata::linkUptimeSec(0, 400000), null);
pruefe('negatives sysUpTime: null',  HostMetadata::linkUptimeSec(-5, 0), null);
// Strings aus der API (TimeTicks kommen als Zeichenkette).
pruefe('Zeichenketten zaehlen als Zahl',
    HostMetadata::linkUptimeSec('1000000', '400000'), 6000);

echo "\n";
if ($fehler > 0) {
    fwrite(STDERR, "✖ {$fehler} Befund(e).\n");
    exit(1);
}
echo "✓ Interface-Auswahl haelt, was das Panel anzeigt.\n";
