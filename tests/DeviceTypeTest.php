<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer die Geraetetyp-Erkennung in Topology\HostMetadata.
 *
 * Anlass ist eine Nutzermeldung: Cisco-Switches landeten unter
 * "Server / virtualization" statt unter "Switch". Die Ursache war nicht ein
 * fehlender Eintrag, sondern der Ansatz — deviceType() raet aus Hostname und
 * Template-Namen, und die Muster waren gegen ausgedachte Template-Namen
 * geschrieben. Nachgezaehlt an einer echten Zabbix-Installation: von 14
 * offiziellen Netzwerk-Templates trafen ZWEI. Auch 'mikrotik routeros' ging
 * ins Leere, weil das Template "MikroTik by SNMP" heisst.
 *
 * Die Liste zu verlaengern waere die falsche Antwort. Allein fuer Cisco fuehrt
 * Zabbix neun Templates, davon sind zwei (UCS, UCS Manager) Server — ein
 * Muster 'cisco' wuerde die falsch einsortieren. Stattdessen liefert das
 * Protokoll die Antwort: typeFromCaps() liest die LLDP-Capabilities nach
 * IEEE 802.1AB, die das Geraet selbst ankuendigt.
 *
 * Getestet wird beides, und vor allem die REIHENFOLGE: die Capabilities duerfen
 * die Namensheuristik nicht ueberstimmen, sondern nur den 'server'-Fallback
 * ersetzen. Sonst wuerde aus einem "rtr-core-01", der als L3-Switch auch das
 * Bridge-Bit meldet, ein Switch.
 *
 * Aufruf:  php tests/DeviceTypeTest.php     (Exit 0 = gruen)
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

use Modules\NetworkTopology\Topology\HostMetadata;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-58s got=%-12s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

echo "\n== typeFromCaps: das Geraet sagt selbst, was es ist ==\n";

check('Bridge -> switch',            HostMetadata::typeFromCaps(['Bridge']),            'switch');
check('Router -> router',            HostMetadata::typeFromCaps(['Router']),            'router');
check('WLAN AP -> wireless',         HostMetadata::typeFromCaps(['WLAN AP']),           'wireless');

// Reale Kombinationen. Ein L3-Switch meldet Bridge UND Router; fuer eine
// Topologiekarte ist "Switch" die nuetzlichere Aussage.
check('L3-Switch (Bridge+Router) -> switch',
      HostMetadata::typeFromCaps(['Bridge', 'Router']), 'switch');
// Ein Access Point ist fast immer auch Bridge — WLAN muss zuerst greifen.
check('AP (Bridge+WLAN AP) -> wireless',
      HostMetadata::typeFromCaps(['Bridge', 'WLAN AP']), 'wireless');

// Wofuer es kein Icon gibt, darf nichts liefern — ein falsches waere
// schlechter als der Fallback.
check('Telephone -> nichts',         HostMetadata::typeFromCaps(['Telephone']),         '');
check('Station -> nichts',           HostMetadata::typeFromCaps(['Station']),           '');
check('leer -> nichts',              HostMetadata::typeFromCaps([]),                    '');

echo "\n== deviceType: echte Template-Namen aus einer Zabbix-Installation ==\n";

// Diese Namen stammen aus der hosts-Tabelle einer echten 7.4-Instanz, nicht
// aus dem Gedaechtnis. Sie dokumentieren den IST-Zustand: die Namensheuristik
// erkennt die meisten NICHT, und genau deshalb gibt es typeFromCaps().
$byName = [
    // erkannt — der Hostname traegt die Information
    ['sw-core-01',        [],                              'switch'],
    ['rtr-edge-01',       [],                              'router'],
    ['fw-dmz-01',         [],                              'firewall'],
    // erkannt — Template-Name enthaelt ein Modellwort
    ['device01',          ['Cisco Catalyst 3750V2-24TS by SNMP'], 'switch'],
    ['device02',          ['Cisco Nexus 9000 Series by SNMP'],    'switch'],
    ['device03',          ['HP Enterprise Switch by SNMP'],       'switch'],
    // NICHT erkannt — Fallback. Das ist der gemeldete Fehler.
    ['device04',          ['Cisco IOS by SNMP'],                  'server'],
    ['device05',          ['Juniper by SNMP'],                    'server'],
    ['device06',          ['MikroTik by SNMP'],                   'server'],
    ['device07',          ['Arista by SNMP'],                     'server'],
    ['device08',          ['Extreme EXOS by SNMP'],               'server'],
    // Und der Grund, warum ein Muster 'cisco' nicht die Loesung ist:
    ['blade01',           ['Cisco UCS by SNMP'],                  'server'],
];
foreach ($byName as [$host, $tpls, $want]) {
    $label = $host . ($tpls ? ' + "' . $tpls[0] . '"' : '');
    check($label, HostMetadata::deviceType($host, $tpls), $want);
}

echo "\n== Zusammenspiel: Capabilities ersetzen nur den Fallback ==\n";

/**
 * Bildet die Stufenlogik aus NodeBuilder nach — bewusst hier dupliziert und
 * nicht importiert, weil NodeBuilder::build() Hosts, Metriken und Probleme
 * braucht. Aendert sich die Reihenfolge dort, muss sie hier mitgeaendert
 * werden; genau das soll dieser Test erzwingen.
 */
function resolveType(string $host, array $tpls, array $caps, bool $speaksLldp): string {
    $t = HostMetadata::deviceType($host, $tpls);
    if ($t === 'server') {
        $fromCaps = HostMetadata::typeFromCaps($caps);
        if ($fromCaps !== '') {
            return $fromCaps;
        }
        if ($speaksLldp) {
            return 'switch';
        }
    }
    return $t;
}

// Der gemeldete Fall: Cisco IOS, vom Nachbarn als Bridge gemeldet.
check('Cisco IOS + Bridge-Bit -> switch',
      resolveType('device04', ['Cisco IOS by SNMP'], ['Bridge'], true), 'switch');

// Ohne Capability, aber er fuehrt eine Nachbartabelle -> immer noch kein Server.
check('Cisco IOS, keine Caps, spricht LLDP -> switch',
      resolveType('device04', ['Cisco IOS by SNMP'], [], true), 'switch');

// Ohne beides bleibt es beim alten Verhalten.
check('Cisco IOS, keine Caps, kein LLDP -> server',
      resolveType('device04', ['Cisco IOS by SNMP'], [], false), 'server');

// DIE Regel, die am leichtesten kaputtgeht: der Name gewinnt. Ein Router, der
// als L3-Geraet auch Bridge meldet, bleibt Router.
check('rtr-edge-01 mit Bridge-Bit bleibt router',
      resolveType('rtr-edge-01', [], ['Bridge', 'Router'], true), 'router');
check('fw-dmz-01 mit Bridge-Bit bleibt firewall',
      resolveType('fw-dmz-01', [], ['Bridge'], true), 'firewall');

// Wie weit reicht die Stufe "spricht LLDP -> switch" wirklich?
//
// Beim Schreiben dieses Tests als Grenze erwartet: ein Linux-Server mit lldpd
// wuerde zum Switch. Stimmt nicht — 'Linux by Zabbix agent' trifft das
// linux-Muster und landet nie im Fallback. Die Stufe greift also NUR bei
// Hosts, bei denen weder Name noch Template irgendetwas hergeben. Das ist
// deutlich enger als befuerchtet, und die Erwartung gehoert korrigiert statt
// als Warnung stehengelassen.
check('Linux-Server mit lldpd bleibt linux',
      resolveType('host99', ['Linux by Zabbix agent'], [], true), 'linux');

// Uebrig bleibt der wirklich namenlose Fall: kein sprechender Name, kein
// erkanntes Template, aber eine Nachbartabelle. Dann ist Switch die bessere
// Wette als Server — und wem das nicht passt, der setzt nt:icon.
check('namenloser Host, nur LLDP -> switch',
      resolveType('host99', ['Some Vendor Template'], [], true), 'switch');
check('namenloser Host ohne LLDP -> server',
      resolveType('host99', ['Some Vendor Template'], [], false), 'server');

echo "\n";
if ($failures > 0) {
    echo "  === {$failures} FEHLER ===\n\n";
    exit(1);
}
echo "  === ALLE TESTS PASS ===\n\n";
exit(0);
