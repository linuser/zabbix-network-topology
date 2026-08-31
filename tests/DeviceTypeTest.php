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
use Modules\NetworkTopology\Topology\LldpEdgeBuilder;

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

echo "\n== decodeCaps: beide Formate, die echte Geraete liefern ==\n";

/**
 * lldpRemSysCapEnabled kommt in ZWEI Formen an, je nach Template — an zwei
 * realen Switches nachgesehen:
 *
 *   HP Instant On   "20 00", "28 00"              rohe Hex-Bytes
 *   TP-Link         "Bridge", "WLAN Access Point" von einer Value-Map aufgeloest
 *
 * Die Textform als Hex zu lesen ist kein Randfall, sondern ein stiller
 * Fehler mit Ansage: aus "Bridge" bleiben die Hex-Ziffern B, d, e, daraus
 * 0xBD, daraus fuenf Faehigkeiten, die nie gemeldet wurden — und ein Switch
 * bekommt ein WLAN-Symbol. Genau so war es, bis echte Daten vorlagen.
 */
// decodeCaps ist private — der Reflection-Umweg ist Absicht: die Methode ist
// kein oeffentlicher Vertrag, aber ihr Verhalten entscheidet ueber das Icon.
$dc = new ReflectionMethod(LldpEdgeBuilder::class, 'decodeCaps');
$dc->setAccessible(true);
$caps = static fn(string $in): array => $dc->invoke(null, $in);

check('Hex "20 00" -> Bridge',        $caps('20 00'),             ['Bridge']);
check('Hex "28 00" -> Bridge+Router', $caps('28 00'),             ['Bridge', 'Router']);
check('Hex "10 00" -> WLAN AP',       $caps('10 00'),             ['WLAN AP']);
check('Text "Bridge"',                $caps('Bridge'),            ['Bridge']);
check('Text "WLAN Access Point"',     $caps('WLAN Access Point'), ['WLAN AP']);
check('Text "Bridge, Router"',        $caps('Bridge, Router'),    ['Bridge', 'Router']);
check('Text kleingeschrieben',        $caps('bridge'),            ['Bridge']);
check('leer -> nichts',               $caps(''),                  []);

// Und was am Ende zaehlt: der Typ, den die Karte daraus macht.
check('TP-Link-Switch wird switch',   HostMetadata::typeFromCaps($caps('Bridge')),   'switch');
check('HP-Switch wird switch',        HostMetadata::typeFromCaps($caps('20 00')),    'switch');
check('AP wird wireless',             HostMetadata::typeFromCaps($caps('WLAN Access Point')), 'wireless');

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

// ── Produktlinie ist keine Geraeteklasse ────────────────────────────────────
// Anlass: eine UDM Pro (Firewall/Router) und ein NVR (Videorecorder) wurden
// beide als WAP angezeigt. Grund war 'unifi' in der wireless-Liste — ein
// Herstellername, der Gateways, Switches, Kameras, Recorder UND Access Points
// umfasst. Dazu stand wireless VOR camera, weshalb das breite 'unifi' sogar
// das spezifische 'nvr' schlug.
//
// Gematcht wird gegen Hostname PLUS Template-Namen; beide Geraete haengen am
// UniFi-Template und trugen den Herstellernamen damit implizit mit sich.
echo "\n  Produktlinie vs. Geraeteklasse\n\n";

check('UDM Pro (UniFi-Gateway) -> firewall',
      HostMetadata::deviceType('UDM Pro', ['UniFi Network API']), 'firewall');
check('NVR am UniFi-Template -> camera',
      HostMetadata::deviceType('nvr-01', ['UniFi Network API']), 'camera');
check('echter Access Point -> wireless',
      HostMetadata::deviceType('UAP-AC-Pro', ['UniFi Network API']), 'wireless');
check('UniFi-Switch -> switch',
      HostMetadata::deviceType('USW-24-PoE', ['UniFi Network API']), 'switch');

// Der Herstellername allein darf nichts mehr entscheiden: ein Host, dessen
// einziger Hinweis "UniFi" ist, faellt auf den Server-Default zurueck. Das ist
// ehrlicher als eine geratene Geraeteklasse — und wem das nicht passt, der
// setzt nt:icon.
check('nur Herstellername -> kein wireless',
      HostMetadata::deviceType('geraet-42', ['UniFi Network API']), 'server');

// Die Modellreihen, die tatsaechlich Access Points sind, muessen weiter
// durchkommen — sonst hat der Verzicht auf 'unifi'/'omada' nur die Fehlerrichtung
// getauscht: statt Gateways als WAP jetzt WAPs als Server.
echo "\n  Modellreihen statt Herstellername\n\n";

check('U6-Pro (aktuelle UniFi-AP-Reihe) -> wireless',
      HostMetadata::deviceType('U6-Pro', ['UniFi Network API']), 'wireless');
check('U7-Pro -> wireless',
      HostMetadata::deviceType('U7-Pro', []), 'wireless');
check('EAP245 (Omada-AP) -> wireless',
      HostMetadata::deviceType('EAP245', ['TP-Link Omada by SNMP']), 'wireless');
check('USW24 ohne Bindestrich -> switch',
      HostMetadata::deviceType('USW24', []), 'switch');
check('USG3P ohne Bindestrich -> firewall',
      HostMetadata::deviceType('usg3p', []), 'firewall');

// Und die Kehrseite: kurze Modell-Tokens duerfen nicht mitten im Wort greifen.
// 'udm' steckt in "cloudmail", 'uxg' in "luxgate", 'eap' in "radius-eap-01" —
// und firewall/wireless werden VOR mailserver geprueft. Ohne Wortgrenze waere
// ein Mailserver eine Firewall.
echo "\n  Kurze Tokens greifen nicht mitten im Wort\n\n";

check('cloudmail-01 bleibt mailserver',
      HostMetadata::deviceType('cloudmail-01', []), 'mailserver');
check('nas-cloudmirror bleibt storage',
      HostMetadata::deviceType('nas-cloudmirror', []), 'storage');
check('luxgate01 wird keine Firewall',
      HostMetadata::deviceType('luxgate01', []), 'server');
check('radius-eap-01 wird kein Access Point',
      HostMetadata::deviceType('radius-eap-01', []), 'server');

// Der Ausloeser des Ganzen, in der Variante, die fast wieder hineingefallen
// waere: das Template heisst "UniFi API", und 'unifi ap' ist dessen Praefix.
// Ohne die hintere Wortgrenze haenge der Recorder wieder als WAP im Netz.
check('NVR am Template "UniFi API" -> camera, nicht wireless',
      HostMetadata::deviceType('nvr-01', ['UniFi API']), 'camera');

echo "\n";
if ($failures > 0) {
    echo "  === {$failures} FEHLER ===\n\n";
    exit(1);
}
echo "  === ALLE TESTS PASS ===\n\n";
exit(0);
