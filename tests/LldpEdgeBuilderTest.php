<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\LldpEdgeBuilder.
 *
 * Das Nachbar-Matching ist die heikelste Zuordnung im Modul: ein Switch meldet
 * einen Namen, und wir raten, welcher Zabbix-Host gemeint ist. Greift das daneben,
 * FEHLEN einfach Kanten — die Karte sieht nur "leerer" aus, niemand bekommt einen
 * Fehler. Solche stillen Aussetzer faengt man nur mit Tests.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP.
 *
 * Aufruf:  php tests/LldpEdgeBuilderTest.php
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

/** Gibt es eine Kante zwischen zwei Hosts (Richtung egal)? */
function hasEdge(array $edges, string $a, string $b): bool {
    return findEdge($edges, $a, $b) !== null;
}

/** Liefert die Kante zwischen zwei Hosts (Richtung egal) oder null. */
function findEdge(array $edges, string $a, string $b): ?array {
    foreach ($edges as $e) {
        $from = (string) ($e['from'] ?? '');
        $to   = (string) ($e['to']   ?? '');
        if (($from === $a && $to === $b) || ($from === $b && $to === $a)) {
            return $e;
        }
    }
    return null;
}

$hosts = [
    'h1' => ['host' => 'sw-core', 'name' => 'Core Switch'],
    'h2' => ['host' => 'sw-acc1', 'name' => 'Access 1'],
    'h3' => ['host' => 'fw-01',   'name' => 'Firewall'],
];

$lldp_raw = [
    // h2 meldet "sw-core" — exakter technischer Name        -> Kante h2–h1
    ['hostid' => 'h2', 'key_' => 'lldpRemSysName', 'lastvalue' => 'sw-core',            'src' => 'lldp'],
    // h3 meldet "SW-CORE.fritz.box" — GROSS + FQDN          -> trotzdem Kante h3–h1
    ['hostid' => 'h3', 'key_' => 'lldpRemSysName', 'lastvalue' => 'SW-CORE.fritz.box',  'src' => 'lldp'],
    // h1 meldet ein Geraet, das Zabbix gar nicht kennt      -> KEINE Kante, unmatched
    ['hostid' => 'h1', 'key_' => 'lldpRemSysName', 'lastvalue' => 'printer-xyz',        'src' => 'lldp'],
];

$r     = LldpEdgeBuilder::build($hosts, $lldp_raw);
$edges = $r['edges'];

echo "\nNachbar-Zuordnung\n";
check('exakter technischer Name -> Kante',            hasEdge($edges, 'h2', 'h1'), true);
check('GROSSSCHREIBUNG + FQDN -> trotzdem Kante',     hasEdge($edges, 'h3', 'h1'), true);
check('genau 2 Kanten (kein Doppel, keine Selbst)',   count($edges),               2);

echo "\nUnbekannter Nachbar\n";
// Dass er KEINE Falschkante erzeugt, beweist bereits count($edges) === 2 oben:
// waere "printer-xyz" faelschlich auf einen Host gematcht worden, gaebe es 3.
check('landet in unmatched',                          count($r['unmatched']),      1);
check('und zwar namentlich',
      strpos(strtolower(json_encode($r['unmatched'])), 'printer-xyz') !== false, true);

echo "\nQualitaets-Statistik\n";
check('quality wird gefuellt',                        count($r['quality']) > 0,    true);

// ── §3 Port-zu-Port ──────────────────────────────────────────────────────
// Nachgebildet aus einem realen Aruba-SNMP-Walk: der Switch meldet an
// lokalem Port 8 den Nachbarn "pve" mit Remote-Port "nic0" (PortDesc; PortId
// waere eine MAC), an Port 20 den TP-Link mit Remote-Port aus PortId (kein
// PortDesc). ifIndex == lokaler Port → Per-Link-Traffic haengt am Reporter.
echo "\n§3 Port-zu-Port\n";
$hosts3 = [
    'aruba' => ['host' => 'SW-CORE-01', 'name' => 'SW-CORE-01'],
    'pve'   => ['host' => 'pve',        'name' => 'hv-01.example.lan'],
    'tp'    => ['host' => 'SW-EDGE-01', 'name' => 'SW-EDGE-01'],
];
$lldp_raw3 = [
    ['hostid' => 'aruba', 'key_' => 'lldpRemSysName[0.8.1]',  'lastvalue' => 'hv-01.example.lan', 'src' => 'lldp'],
    ['hostid' => 'aruba', 'key_' => 'lldpRemSysName[0.20.2]', 'lastvalue' => 'SW-EDGE-01',       'src' => 'lldp'],
];
$lldp_ports3 = [
    'aruba' => [
        '0.8.1'  => ['id' => '3C EC EF 79 2C 88', 'desc' => 'nic0'],   // PortDesc gewinnt vor MAC
        '0.20.2' => ['id' => 'gigabitEthernet 1/0/8'],                 // nur PortId → Fallback
    ],
];
$port_traffic3 = [
    'aruba' => ['8' => ['in' => 1000000.0, 'out' => 2000000.0],
                '20' => ['in' => 500000.0, 'out' => 750000.0]],
];
$port_speed3 = ['aruba' => ['8' => 1.0e9, '20' => 1.0e9]];

// port_stp nach ifIndex gekeyt wie port_traffic: Port 8 blocking(2), Port 20 forwarding(5).
// port_names fuer pve, damit der ferne Port 'nic0' auf ifIndex 5 aufloest und das
// ferne Ende seinen STP-Zustand traegt (sonst bliebe ein nur fern gemeldetes
// Blocking unsichtbar).
$r3    = LldpEdgeBuilder::build($hosts3, $lldp_raw3, $lldp_ports3, $port_traffic3, $port_speed3,
                               port_names: ['pve' => ['5' => 'nic0']],
                               port_stp: ['aruba' => ['8' => 2, '20' => 5], 'pve' => ['5' => 2]]);
$e_pve = findEdge($r3['edges'], 'aruba', 'pve') ?? [];
$e_tp  = findEdge($r3['edges'], 'aruba', 'tp')  ?? [];

check('lokaler Port aus SNMPINDEX (Reporter-Ende)',   $e_pve['ports']['aruba'] ?? null, '8');
check('Remote-Port am Nachbar-Ende (PortDesc)',        $e_pve['ports']['pve']   ?? null, 'nic0');
check('PortDesc gewinnt vor PortId (MAC)',
      ($e_pve['ports']['pve'] ?? '') !== '3C EC EF 79 2C 88', true);
check('PortId-Fallback wenn kein PortDesc',            $e_tp['ports']['tp']     ?? null, 'gigabitEthernet 1/0/8');
check('Per-Link-Traffic in (bps)',   $e_pve['port_metrics']['aruba']['in']    ?? null, 1000000.0);
check('Per-Link-Traffic out (bps)',  $e_pve['port_metrics']['aruba']['out']   ?? null, 2000000.0);
check('Per-Link-Speed als Divisor',  $e_pve['port_metrics']['aruba']['speed'] ?? null, 1.0e9);
check('STP blocking(2) am lokalen Port -> port_metrics.stp', $e_pve['port_metrics']['aruba']['stp'] ?? null, 2);
check('STP forwarding(5) am anderen Port',                   $e_tp['port_metrics']['aruba']['stp']  ?? null, 5);
check('STP am FERNEN Ende -> port_metrics[pve].stp',         $e_pve['port_metrics']['pve']['stp']   ?? null, 2);

// Ohne §3-Maps (alte Aufrufer): keine Port-/Metrik-Felder, aber auch kein Crash.
$r3b = LldpEdgeBuilder::build($hosts3, $lldp_raw3);
$e2  = findEdge($r3b['edges'], 'aruba', 'pve') ?? [];
check('Abwaertskompat: lokaler Port bleibt',           $e2['ports']['aruba'] ?? null, '8');
check('Abwaertskompat: kein Remote-Port ohne Map',     isset($e2['ports']['pve']),    false);
check('Abwaertskompat: leere port_metrics',            $e2['port_metrics'] ?? null,   []);

// ── §3-Polish (v4.35.1): CDP-Index, Desc-Fallbacks, No-Match, Merge ────────
echo "\n§3 CDP-Index (2-teilig: erster Teil = ifIndex)\n";
$hCdp  = ['csw' => ['host' => 'csw', 'name' => 'csw'], 'srv' => ['host' => 'srv', 'name' => 'srv']];
$rawCdp = [['hostid' => 'csw', 'key_' => 'cdpCacheDeviceId[7.4]', 'lastvalue' => 'srv', 'src' => 'cdp']];
$rCdp  = LldpEdgeBuilder::build($hCdp, $rawCdp,
    ['csw' => ['7.4' => ['desc' => 'GigabitEthernet0/1']]],   // Remote-Port (CDP)
    ['csw' => ['7' => ['in' => 200000000.0, 'out' => 100000000.0]]],  // Traffic auf ifIndex 7
    ['csw' => ['7' => 1.0e9]]);
$eCdp  = findEdge($rCdp['edges'], 'csw', 'srv') ?? [];
check('CDP lokaler Port = erster Index-Teil (ifIndex)', $eCdp['ports']['csw'] ?? null, '7');
check('CDP Remote-Port (cdpCacheDevicePort)',           $eCdp['ports']['srv'] ?? null, 'GigabitEthernet0/1');
check('CDP Per-Link-Traffic korreliert auf ifIndex 7',  $eCdp['port_metrics']['csw']['in'] ?? null, 200000000.0);

echo "\n§3 Remote-Port-Fallback (leerer/whitespace PortDesc → PortId)\n";
$hFb   = ['a' => ['host'=>'a','name'=>'a'], 'b' => ['host'=>'b','name'=>'b'], 'c' => ['host'=>'c','name'=>'c']];
$rawFb = [['hostid'=>'a','key_'=>'lldpRemSysName[0.8.1]','lastvalue'=>'b','src'=>'lldp'],
          ['hostid'=>'a','key_'=>'lldpRemSysName[0.9.1]','lastvalue'=>'c','src'=>'lldp']];
$rFb   = LldpEdgeBuilder::build($hFb, $rawFb, ['a' => [
            '0.8.1' => ['id' => 'Gi0/8', 'desc' => ''],       // leerer Desc → PortId
            '0.9.1' => ['id' => 'Gi0/9', 'desc' => '   ']]]); // whitespace Desc → PortId
check('leerer PortDesc → PortId-Fallback',      (findEdge($rFb['edges'],'a','b') ?? [])['ports']['b'] ?? null, 'Gi0/8');
check('whitespace PortDesc → PortId-Fallback',  (findEdge($rFb['edges'],'a','c') ?? [])['ports']['c'] ?? null, 'Gi0/9');

echo "\n§3 Kein ifIndex-Match → Kante mit Label, aber ohne Metrik\n";
$rNm = LldpEdgeBuilder::build($hFb,
    [['hostid'=>'a','key_'=>'lldpRemSysName[0.77.1]','lastvalue'=>'b','src'=>'lldp']],
    ['a' => ['0.77.1' => ['desc' => 'Gi0/77']]],
    ['a' => ['8' => ['in'=>1.0,'out'=>2.0]]]);   // Traffic NUR fuer Port 8, nicht 77
$eNm = findEdge($rNm['edges'], 'a', 'b') ?? [];
check('lokaler Port bleibt trotz No-Match',     $eNm['ports']['a'] ?? null, '77');
check('Remote-Port bleibt trotz No-Match',      $eNm['ports']['b'] ?? null, 'Gi0/77');
check('port_metrics leer bei No-Match',         $eNm['port_metrics'] ?? null, []);

echo "\n§3 Merge: beidseitig gemeldete Kante bekommt BEIDE Metriken\n";
$hM   = ['A' => ['host'=>'A','name'=>'A'], 'B' => ['host'=>'B','name'=>'B']];
$rawM = [['hostid'=>'A','key_'=>'lldpRemSysName[0.8.1]','lastvalue'=>'B','src'=>'lldp'],
         ['hostid'=>'B','key_'=>'lldpRemSysName[0.3.1]','lastvalue'=>'A','src'=>'lldp']];
$rM   = LldpEdgeBuilder::build($hM, $rawM,
    ['A' => ['0.8.1' => ['desc' => 'to-B']], 'B' => ['0.3.1' => ['desc' => 'to-A']]],
    ['A' => ['8' => ['in'=>10.0,'out'=>20.0]], 'B' => ['3' => ['in'=>30.0,'out'=>40.0]]]);
$eM = findEdge($rM['edges'], 'A', 'B') ?? [];
check('beidseitige Kante bleibt EINE',                   count($rM['edges']), 1);
check('Merge: Metrik des 1. Reporters (A) da',           $eM['port_metrics']['A']['in'] ?? null, 10.0);
check('Merge: Metrik des 2. Reporters (B) angehaengt',   $eM['port_metrics']['B']['in'] ?? null, 30.0);

// ── UniFi: UUID-Uplink loest ueber das normale Namens-Matching auf ────────
// Nachgebildet aus echten Daten: das UniFi-Template benennt Hosts technisch
// nach der Geraete-UUID, und uplink.id enthaelt genau diese UUID des Uplinks.
// Damit braucht es KEINE Sonderlogik — der bestehende Matcher trifft.
echo "\nUniFi uplink.id -> Kante\n";
$hU = [
    'sw'  => ['host' => 'bf995b97-bae1-4d4b-ab1a-79803bb97d4f', 'name' => 'LABNODE02'],
    'cli' => ['host' => 'c5d9ea0b-b4be-44c8-8c35-be04b96f7036', 'name' => 'client 2d:23'],
];
$rawU = [['hostid' => 'cli', 'key_' => 'uplink.id',
          'lastvalue' => 'bf995b97-bae1-4d4b-ab1a-79803bb97d4f', 'src' => 'unifi']];
$rU = LldpEdgeBuilder::build($hU, $rawU);
check('UUID matcht technischen Hostnamen -> Kante', hasEdge($rU['edges'], 'cli', 'sw'), true);
check('genau eine Kante',                           count($rU['edges']),               1);
check('Quelle als unifi markiert',   ($rU['edges'][0]['src'] ?? [])[0] ?? null,        'unifi');
// Zeigt der Uplink auf ein Geraet, das NICHT ueberwacht wird (nicht in $hosts),
// entsteht keine Kante — der Wert landet als unmatched (→ §9-Ghost, wenn an).
$rU2 = LldpEdgeBuilder::build($hU,
    [['hostid' => 'cli', 'key_' => 'uplink.id', 'lastvalue' => 'aaaaaaaa-0000-0000-0000-000000000000', 'src' => 'unifi']]);
check('unbekannter Uplink -> keine Kante',  count($rU2['edges']),      0);
check('unbekannter Uplink -> unmatched',    count($rU2['unmatched']),  1);

// UniFi-Kante traegt den geraeteweiten Uplink-Durchsatz des Kindes (uplink.rx/tx),
// da sie keinen lokalen Port hat. Melder = 'cli' (= from), also port_metrics['cli'].
// Werte erfunden, bit/s. Ehrlich geraeteweit, kein Per-Port-Wert.
$rU3 = LldpEdgeBuilder::build($hU, $rawU,
    uplink_rate: ['cli' => ['in' => 1569752.0, 'out' => 116656.0]]);
check('UniFi-Kante: Uplink-in am Melder',  $rU3['edges'][0]['port_metrics']['cli']['in']  ?? null, 1569752.0);
check('UniFi-Kante: Uplink-out am Melder', $rU3['edges'][0]['port_metrics']['cli']['out'] ?? null, 116656.0);
check('UniFi-Kante: kein speed/cap (keine Auslastungsfarbe)',
    isset($rU3['edges'][0]['port_metrics']['cli']['speed']), false);
// Ohne uplink_rate bleibt die Kante ohne Metrik (ehrlich leer statt 0).
check('ohne uplink_rate keine Metrik', isset($rU['edges'][0]['port_metrics']['cli']), false);

// ── Beidseitige Bestaetigung ────────────────────────────────────────────────
//
// Der Kern: eine Kante ist bestaetigt, wenn BEIDE Endpunkte einander melden.
// Der dritte Fall ist der wichtige — er sichert die Falle ab, die beim Bauen
// fast zugeschnappt waere.

// ── Errors/Discards am PORT, nicht als Host-Summe ──────────────────────────
//
// Die Werte wurden schon immer erhoben, aber nur pro Host aufsummiert. Damit
// trug jede Kante eines Switches dieselbe Fehlerrate — auch die, an denen
// nichts war. Der Unterschied ist der ganze Punkt der Portansicht.

// ── Portname statt nackter ifIndex ─────────────────────────────────────────
//
// Der ifIndex ist die Korrelationsgroesse fuer die Metrik, taugt aber nicht als
// Anzeige: das eigene Ende zeigte "9", waehrend das Nachbar-Ende "Gi1/0/8"
// zeigt. Seit Label und Index verschieden sein koennen, ist die eigentliche
// Gefahr, dass die Metrik STILL verschwindet — sie wird nach Index gesucht.

// ── Confidence ─────────────────────────────────────────────────────────────
//
// Auf der Karte sah bisher jede Kante gleich sicher aus. Der Score sagt, worauf
// sie beruht — und ist die Vorbedingung fuer eine Port-Normalisierung, die ohne
// ihn Falschkanten erzeugen wuerde, die wie Messungen aussehen.

// ── Port-Normalisierung ────────────────────────────────────────────────────
//
// Der Nachbar meldet "GigabitEthernet1/0/1", auf dem Geraet heisst das
// Interface "Gi1/0/1". Loest sich das auf, hat die Kante Messwerte an BEIDEN
// Enden — und die Aufloesung belegt, dass der gemeldete Port dort existiert.
//
// Der wichtigste Fall unten ist die Mehrdeutigkeit: faellt die normalisierte
// Form auf mehrere Interfaces, wird NICHTS zugeordnet.

echo "\nPort-Normalisierung\n";

$hP2 = ['sw' => ['host' => 'sw-p', 'name' => 'Switch P'],
        'nb' => ['host' => 'nb-p', 'name' => 'Nachbar P']];
$rawP  = [['hostid' => 'sw', 'key_' => 'lldpRemSysName[3]', 'lastvalue' => 'nb-p', 'src' => 'lldp']];

$bau = static function (array $namen, string $gemeldet) use ($hP2, $rawP) {
    return LldpEdgeBuilder::build(
        $hP2, $rawP,
        ['sw' => ['3' => ['desc' => $gemeldet]]],          // Nachbar meldet DIESEN Port
        ['nb' => ['7' => ['in' => 5.0e6, 'out' => 2.0e6]], // Traffic am Nachbar-Port 7
         'sw' => ['3' => ['in' => 1.0e6, 'out' => 1.0e6]]],
        [], [], [], [],
        ['nb' => $namen, 'sw' => ['3' => 'Gi1/0/3']]
    );
};

// Langform gemeldet, kurz benannt -> normalisierter Treffer.
$eP = findEdge($bau(['7' => 'Gi1/0/1'], 'GigabitEthernet1/0/1')['edges'], 'sw', 'nb') ?? [];
check('Langform -> normalisierter Treffer',  $eP['port_match'] ?? null, 'normalized');
check('Messwerte der GEGENSEITE dabei',      ($eP['port_metrics']['nb']['in'] ?? null), 5000000.0);

// Exakt gemeldet -> exakter Treffer, hoeher bewertet.
$eP2 = findEdge($bau(['7' => 'Gi1/0/1'], 'Gi1/0/1')['edges'], 'sw', 'nb') ?? [];
check('identisch gemeldet -> exakt',         $eP2['port_match'] ?? null, 'exact');
check('exakt zaehlt mehr als normalisiert',  ($eP2['confidence'] ?? 0) > ($eP['confidence'] ?? 0), true);

// MEHRDEUTIG: zwei Interfaces fallen auf dieselbe normalisierte Form.
$ePA = findEdge($bau(['7' => 'Gi1/0/1', '8' => 'GigabitEthernet1/0/1'], 'gi 1/0/1')['edges'], 'sw', 'nb') ?? [];
check('mehrdeutig -> kein Porttreffer',      $ePA['port_match'] ?? null, '');
check('mehrdeutig -> keine fremden Werte',   isset($ePA['port_metrics']['nb']), false);

// Kein Namensbestand beim Nachbarn -> gar nichts, aber auch kein Fehler.
$ePN = findEdge($bau([], 'Gi1/0/1')['edges'], 'sw', 'nb') ?? [];
check('ohne Namen -> kein Porttreffer',      $ePN['port_match'] ?? null, '');
check('ohne Namen -> Kante bleibt',          isset($ePN['from']), true);

// Ziffern duerfen NICHT zusammenfallen.
$ePZ = findEdge($bau(['7' => 'Gi1/0/11'], 'GigabitEthernet1/0/1')['edges'], 'sw', 'nb') ?? [];
check('1/0/1 trifft nicht 1/0/11',           $ePZ['port_match'] ?? null, '');

echo "\nConfidence\n";

$hC = ['a' => ['host' => 'sw-a',  'name' => 'Switch A'],
       'b' => ['host' => 'sw-b',  'name' => 'Switch B'],
       'c' => ['host' => 'sw-c.example.local', 'name' => 'Switch C']];

$conf = static function (array $raw, array $ports = []) use ($hC) {
    $r = LldpEdgeBuilder::build($hC, $raw, $ports);
    $e = $r['edges'][0] ?? [];
    return [$e['confidence'] ?? null, $e['match'] ?? null];
};

// Exakter Name, nur eine Seite meldet.
[$s1, $m1] = $conf([['hostid'=>'a','key_'=>'lldpRemSysName','lastvalue'=>'sw-b','src'=>'lldp']]);
check('exakter Name, einseitig',        [$m1, $s1], ['exact', 60]);

// Derselbe Fall, aber BEIDE melden einander -> +30.
[$s2, $m2] = $conf([
    ['hostid'=>'a','key_'=>'lldpRemSysName','lastvalue'=>'sw-b','src'=>'lldp'],
    ['hostid'=>'b','key_'=>'lldpRemSysName','lastvalue'=>'sw-a','src'=>'lldp'],
]);
check('exakter Name, beidseitig',       [$m2, $s2], ['exact', 90]);

// Zwei Protokolle sehen dieselbe Verbindung -> +10.
[$s3] = $conf([
    ['hostid'=>'a','key_'=>'lldpRemSysName','lastvalue'=>'sw-b','src'=>'lldp'],
    ['hostid'=>'b','key_'=>'lldpRemSysName','lastvalue'=>'sw-a','src'=>'lldp'],
    ['hostid'=>'a','key_'=>'cdpCacheDeviceId','lastvalue'=>'sw-b','src'=>'cdp'],
]);
check('beidseitig + zwei Protokolle',   $s3, 100);

// Nur der Kurzname traf: "sw-c" gegen den Host "sw-c.example.local".
[$s4, $m4] = $conf([['hostid'=>'a','key_'=>'lldpRemSysName','lastvalue'=>'sw-c','src'=>'lldp']]);
check('nur Kurzname -> match short',    $m4, 'short');
check('nur Kurzname -> niedriger Wert', $s4, 30);

// Der Kurzname-Fall ist der schwaechste und muss deutlich unter dem exakten
// liegen — sonst traegt der Score nichts bei.
check('Kurzname deutlich unter exakt',  $s4 < $s1 - 20, true);

echo "\nPortname und Metrik-Zuordnung\n";

$hN = ['sw' => ['host' => 'sw-n', 'name' => 'Switch N'],
       'ap' => ['host' => 'ap-n', 'name' => 'AP N']];
$rawN   = [['hostid' => 'sw', 'key_' => 'lldpRemSysName[9]', 'lastvalue' => 'ap-n', 'src' => 'lldp']];
$portsN = ['sw' => ['9' => ['desc' => 'eth2']]];
$trafN  = ['sw' => ['9' => ['in' => 3.0e6, 'out' => 1.0e6]]];

// Mit Namen: Label wird der Name, Metrik findet trotzdem ueber den Index.
$rN = LldpEdgeBuilder::build($hN, $rawN, $portsN, $trafN, [], [], [], [],
                             ['sw' => ['9' => 'Gi1/0/9']]);
$eN = findEdge($rN['edges'], 'sw', 'ap') ?? [];
check('Portname statt ifIndex als Label',   $eN['ports']['sw'] ?? null,             'Gi1/0/9');
check('Metrik trotz Namen gefunden',        ($eN['port_metrics']['sw']['in'] ?? null), 3000000.0);
check('Nachbar-Port unveraendert',          $eN['ports']['ap'] ?? null,             'eth2');

// Ohne Namen: Verhalten wie bisher — Index als Label, Metrik da.
$rN2 = LldpEdgeBuilder::build($hN, $rawN, $portsN, $trafN);
$eN2 = findEdge($rN2['edges'], 'sw', 'ap') ?? [];
check('ohne Namen bleibt der Index',        $eN2['ports']['sw'] ?? null,              '9');
check('ohne Namen Metrik unveraendert',     ($eN2['port_metrics']['sw']['in'] ?? null), 3000000.0);

// Leerer Name darf den Index nicht verdraengen.
$rN3 = LldpEdgeBuilder::build($hN, $rawN, $portsN, $trafN, [], [], [], [],
                              ['sw' => ['9' => '']]);
$eN3 = findEdge($rN3['edges'], 'sw', 'ap') ?? [];
check('leerer Name -> Index bleibt',        $eN3['ports']['sw'] ?? null,              '9');

echo "\nPort-Errors und -Discards\n";

$hE = ['sw' => ['host' => 'sw-e', 'name' => 'Switch E'],
       'ap' => ['host' => 'ap-e', 'name' => 'AP E']];

$rE = LldpEdgeBuilder::build(
    $hE,
    [['hostid' => 'sw', 'key_' => 'lldpRemSysName[9]', 'lastvalue' => 'ap-e', 'src' => 'lldp']],
    ['sw' => ['9' => ['desc' => 'Gi1/0/9']]],
    ['sw' => ['9' => ['in' => 1.0e6, 'out' => 2.0e6]]],
    ['sw' => ['9' => 1.0e9]],
    [],
    ['sw' => ['9' => 2.5, '10' => 99.0]],     // Port 10 ist eine ANDERE Kante
    ['sw' => ['9' => 0.5]]
);
$eE = findEdge($rE['edges'], 'sw', 'ap') ?? [];
$mE = $eE['port_metrics']['sw'] ?? [];

check('Errors am richtigen Port',        $mE['errors'] ?? null,   2.5);
check('Discards am richtigen Port',      $mE['discards'] ?? null, 0.5);
check('Fremder Port faerbt nicht ab',    ($mE['errors'] ?? null) === 99.0, false);
check('Traffic weiterhin dabei',         $mE['in'] ?? null,       1000000.0);

// Errors ohne Traffic-Item: frueher fiel alles weg, weil der Traffic den
// Einstieg in den Metrik-Block bildete.
$rE2 = LldpEdgeBuilder::build(
    $hE,
    [['hostid' => 'sw', 'key_' => 'lldpRemSysName[9]', 'lastvalue' => 'ap-e', 'src' => 'lldp']],
    ['sw' => ['9' => ['desc' => 'Gi1/0/9']]],
    [], [], [],
    ['sw' => ['9' => 4.0]],
    []
);
$mE2 = (findEdge($rE2['edges'], 'sw', 'ap') ?? [])['port_metrics']['sw'] ?? [];
check('Errors auch ohne Traffic-Item',   $mE2['errors'] ?? null,  4.0);
check('kein erfundener Traffic',         isset($mE2['in']),       false);

echo "\nBeidseitige Bestaetigung\n";

$hB = [
    'a' => ['host' => 'sw-a', 'name' => 'Switch A'],
    'b' => ['host' => 'sw-b', 'name' => 'Switch B'],
    'c' => ['host' => 'sw-c', 'name' => 'Switch C'],
];

// a und b melden EINANDER -> bestaetigt. a meldet c, c schweigt -> einseitig.
$rB = LldpEdgeBuilder::build($hB, [
    ['hostid' => 'a', 'key_' => 'lldpRemSysName', 'lastvalue' => 'sw-b', 'src' => 'lldp'],
    ['hostid' => 'b', 'key_' => 'lldpRemSysName', 'lastvalue' => 'sw-a', 'src' => 'lldp'],
    ['hostid' => 'a', 'key_' => 'lldpRemSysName', 'lastvalue' => 'sw-c', 'src' => 'lldp'],
]);

$eAB = findEdge($rB['edges'], 'a', 'b') ?? [];
$eAC = findEdge($rB['edges'], 'a', 'c') ?? [];

check('beide melden einander -> confirmed',      $eAB['confirmed'] ?? null,  true);
check('beide melden einander -> 2 reporters',    count($eAB['reporters'] ?? []), 2);
check('nur eine Seite meldet -> nicht confirmed', $eAC['confirmed'] ?? null,  false);
check('nur eine Seite meldet -> 1 reporter',     count($eAC['reporters'] ?? []), 1);
check('einseitige Kante nennt den Melder',       $eAC['reporters'][0] ?? null, 'a');

// DIE FALLE, um die es geht:
//
// Ein EINZELNER Melder traegt ZWEI Ports ein — seinen eigenen lokalen und den
// vom Nachbarn gelernten. Wer Bestaetigung an count(ports) === 2 festmacht,
// meldet diese Kante faelschlich als beidseitig bestaetigt. Genau das prueft
// der folgende Fall: zwei Ports, aber nur ein Melder.
$hP = [
    'x' => ['host' => 'sw-x', 'name' => 'Switch X'],
    'y' => ['host' => 'sw-y', 'name' => 'Switch Y'],
];
$rP = LldpEdgeBuilder::build(
    $hP,
    [['hostid' => 'x', 'key_' => 'lldpRemSysName[7]', 'lastvalue' => 'sw-y', 'src' => 'lldp']],
    ['x' => ['7' => ['desc' => 'GigabitEthernet1/0/2']]]
);
$eXY = findEdge($rP['edges'], 'x', 'y') ?? [];

check('ein Melder, aber ZWEI Ports eingetragen', count($eXY['ports'] ?? []),     2);
check('trotzdem NICHT confirmed',                $eXY['confirmed'] ?? null,      false);
check('trotzdem nur EIN reporter',               count($eXY['reporters'] ?? []), 1);

// ── Obergrenze fuer Kanten ────────────────────────────────────────────────
//
// Sie schuetzt nicht vor Unuebersichtlichkeit, sondern vor einem PHP-Fatal:
// der Kantenbau braucht rund 5,2 KB Spitzenspeicher je Kante, und Zabbix'
// Frontend laeuft mit 128 MB. Ohne Obergrenze endet eine sehr grosse Topologie
// in "Allowed memory size exhausted" — also einer weissen Seite ohne Meldung.
//
// Geprueft wird beides: dass gekappt wird, UND dass die Kappung gemeldet wird.
// Eine stillschweigend unvollstaendige Karte waere schlimmer als gar keine,
// weil sie aussieht wie eine vollstaendige.
echo "\n  LldpEdgeBuilder — Obergrenze\n\n";

$vieleHosts = [];
$vieleRaw   = [];
for ($i = 0; $i < 130; $i++) {
    $vieleHosts['h' . $i] = ['host' => 'sw-' . $i, 'name' => 'Switch ' . $i];
}
for ($i = 0; $i < 130; $i++) {
    for ($j = 1; $j <= 100; $j++) {
        $vieleRaw[] = ['hostid' => 'h' . $i,
                       'key_' => 'lldpRemSysName[0.' . $j . '.1]',
                       'lastvalue' => 'sw-' . (($i + $j) % 130),
                       'src' => 'lldp'];
    }
}
$rCap = LldpEdgeBuilder::build($vieleHosts, $vieleRaw);
check('kappt bei der Obergrenze',      count($rCap['edges']) <= 8000, true);
check('meldet die verworfenen Kanten', LldpEdgeBuilder::lastTruncated() > 0, true);

// Und der Normalfall darf davon nichts merken.
LldpEdgeBuilder::build($hosts, $lldp_raw);
check('kleine Karte bleibt ungekappt', LldpEdgeBuilder::lastTruncated(), 0);

// ── Confidence: Laufzeit-Plausibilitaet ──────────────────────────────────
//
// Der Score bewertete bisher nur, WIE der Name zugeordnet wurde — und war
// blind gegen einen exakten Treffer, der physikalisch nicht sein kann. Der
// Abschlag greift bewusst erst spaet (100 ms), weil Switches ICMP nachrangig
// behandeln und ein belasteter Switch sonst faelschlich abgewertet wuerde.
echo "\n  LldpEdgeBuilder — Laufzeit im Confidence-Score\n\n";

$hRtt = [
    'r1' => ['host' => 'sw-a', 'name' => 'sw-a', 'proxyid' => '0'],
    'r2' => ['host' => 'sw-b', 'name' => 'sw-b', 'proxyid' => '0'],
];
$rawRtt = [['hostid' => 'r1', 'key_' => 'lldpRemSysName[0.1.1]',
            'lastvalue' => 'sw-b', 'src' => 'lldp']];

$confVon = function(array $ping) use ($hRtt, $rawRtt) {
    $r = LldpEdgeBuilder::build($hRtt, $rawRtt, [], [], [], [], [], [], [], $ping);
    $e = findEdge($r['edges'], 'r1', 'r2');
    return $e === null ? -1 : (int) $e['confidence'];
};

// WERTE IN MILLISEKUNDEN — so legt MetricExtractor sie ab.
//
// Die erste Fassung dieses Tests fuetterte Sekunden (0.001 fuer 1 ms) und
// bestand, waehrend der Code intern noch einmal mit 1000 multiplizierte. Er
// pruefte damit meine Annahme ueber die Einheit statt die Wirklichkeit — und
// in der Wirklichkeit bekam jede Kante in einem gesunden LAN den vollen
// Abschlag. Ein Test mit der falschen Einheit ist schlimmer als keiner: er
// gibt Sicherheit, die es nicht gibt.
$ohne   = $confVon([]);
$nah    = $confVon(['r1' => 0.5, 'r2' => 1.2]);     // 0,7 ms — dasselbe LAN
$traege = $confVon(['r1' => 1.0, 'r2' => 50.0]);    // 49 ms — traege Switch-CPU
$fern   = $confVon(['r1' => 1.0, 'r2' => 150.0]);   // 149 ms — andere Strecke
$sehr   = $confVon(['r1' => 1.0, 'r2' => 400.0]);   // 399 ms

check('gesundes LAN wird NICHT abgewertet',     $nah,    $ohne);
check('traeger Switch wird NICHT abgewertet',   $traege, $ohne);
check('grosser Abstand kostet Punkte',          $fern < $ohne, true);
check('sehr grosser Abstand kostet mehr',       $sehr < $fern,  true);

// Verschiedene Proxies => nicht vergleichbar, also kein Abschlag.
$hProxy = $hRtt;
$hProxy['r2']['proxyid'] = '7';
$rProxy = LldpEdgeBuilder::build($hProxy, $rawRtt, [], [], [], [], [], [], [],
                                 ['r1' => 1.0, 'r2' => 400.0]);
$eProxy = findEdge($rProxy['edges'], 'r1', 'r2');
check('verschiedene Proxies: kein Abschlag',    (int) $eProxy['confidence'], $ohne);

// Proxy-GRUPPE: proxyid ist 0 wie bei einem Host am Server. Der Vergleich der
// proxyid allein hielt beide fuer denselben Messpunkt — mit gleicher proxyid
// muss hier trotzdem der Abschlag entfallen.
$hGroup = $hRtt;
$hGroup['r2']['proxy_groupid'] = '3';
$rGroup = LldpEdgeBuilder::build($hGroup, $rawRtt, [], [], [], [], [], [], [],
                                 ['r1' => 1.0, 'r2' => 400.0]);
$eGroup = findEdge($rGroup['edges'], 'r1', 'r2');
check('Proxy-Gruppe: kein Abschlag trotz gleicher proxyid', (int) $eGroup['confidence'], $ohne);

// ── Self-Loop mit NUMERISCHEN Host-IDs ───────────────────────────────────
//
// Alle Tests oben benutzen 'h1'/'aruba' als Host-ID. Echte Zabbix-Hostids sind
// numerisch, und PHP normalisiert numerische Array-Schluessel zu int — der
// Guard verglich deshalb int gegen string und war immer falsch. Genau die
// Konstellation, die der Test nie hatte.
echo "\n  LldpEdgeBuilder — Self-Loop bei numerischen Host-IDs\n\n";

$hNum = ['10084' => ['host' => 'sw-core', 'name' => 'sw-core']];
$rNum = LldpEdgeBuilder::build($hNum, [
    ['hostid' => '10084', 'key_' => 'lldpRemSysName[0.1.1]',
     'lastvalue' => 'sw-core', 'src' => 'lldp'],
]);
check('kein Self-Loop als Kante',      count($rNum['edges']), 0);
check('self-Zaehler greift',           (int) ($rNum['quality']['10084']['self'] ?? 0), 1);

// ── Nachbar per MAC statt Name ─────────────────────────────────────────────
//
// Gemeldet aus dem Feld: ein Access-Switch nennt seinen Core nicht beim Namen,
// sondern bei der Basis-MAC. Zabbix liefert die als Bytefolge "02 5E …", und
// der Abgleich schnitt am ersten Leerzeichen ab: ein Geist aus zwei
// Hex-Ziffern. Schlimmer: JEDES Geraet, dessen MAC mit demselben Byte beginnt, fiel in denselben Geist.
// Alle Namen und Adressen hier sind erfunden (02:… = lokal verwaltet).
echo "\n  LldpEdgeBuilder — Nachbar per MAC\n\n";

$hMac = [
    'core' => ['host' => 'lab-core', 'name' => 'lab-core'],
    'acc1' => ['host' => 'lab-acc1', 'name' => 'lab-acc1'],
    'acc2' => ['host' => 'lab-acc2', 'name' => 'lab-acc2'],
    // Ein Host, der wie das erste Byte heisst: vorher ein falscher Treffer.
    'h02'  => ['host' => '02',       'name' => '02'],
];

$rMac = LldpEdgeBuilder::build($hMac, [
    ['hostid' => 'acc1', 'key_' => 'lldpRemSysName[0.3.1]', 'lastvalue' => '02 5E 10 00 00 01', 'src' => 'cdp'],
    ['hostid' => 'acc2', 'key_' => 'lldpRemSysName[0.4.1]', 'lastvalue' => '02 5E 20 00 00 02', 'src' => 'cdp'],
    ['hostid' => 'acc2', 'key_' => 'lldpRemSysName[0.5.1]', 'lastvalue' => '02:5e:10:00:00:01', 'src' => 'lldp'],
]);
$rawsMac = array_map(static fn($u) => $u['raw'], array_merge(
    $rMac['quality']['acc1']['unmatched'] ?? [], $rMac['quality']['acc2']['unmatched'] ?? []));
sort($rawsMac);
check('MAC wird nicht auf das erste Byte gekuerzt',
    $rawsMac, ['02:5E:10:00:00:01', '02:5E:10:00:00:01', '02:5E:20:00:00:02']);
check('gleiches erstes Byte -> zwei verschiedene Geraete',
    count(array_unique($rawsMac)), 2);
check('Host "02" wird nicht ueber das erste Byte getroffen', count($rMac['edges']), 0);

// ── Zuordnung ueber das Kabel ──────────────────────────────────────────────
echo "\n  LldpEdgeBuilder — MAC ueber den Port an beiden Kabelenden\n\n";

// Der Core meldet lab-acc1 mit Namen, dort auf Gi1/0/48.
// lab-acc1 meldet an seinem Port 48 nur eine MAC.
$rawPort = [
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.1.1]',  'lastvalue' => 'lab-acc1', 'src' => 'lldp'],
    ['hostid' => 'acc1', 'key_' => 'lldpRemSysName[0.48.1]', 'lastvalue' => '02 5E 10 00 00 01', 'src' => 'lldp'],
];
$portsPort = ['core' => ['0.1.1' => ['desc' => 'GigabitEthernet1/0/48']]];
$namesPort = ['acc1' => ['48' => 'Gi1/0/48'], 'core' => ['1' => 'Gi1/0/1']];

$rP = LldpEdgeBuilder::build($hMac, $rawPort, $portsPort, [], [], [], [], [], $namesPort);
$eP = findEdge($rP['edges'], 'core', 'acc1') ?? [];
check('Port-Treffer: genau eine Kante, kein Geist',  count($rP['edges']), 1);
check('Port-Treffer: nichts mehr unmatched',        count($rP['unmatched']), 0);
check('Port-Treffer: beidseitig bestaetigt',        $eP['confirmed'] ?? null, true);
check('Port-Treffer: bester Beleg bleibt der Name', $eP['match'] ?? null, 'exact');
// port_idx traegt nur der eigene Bericht ein — Beleg, dass die MAC-Zeile
// von lab-acc1 in DIESE Kante eingeflossen ist.
check('Port-Treffer: Access-Bericht in der Kante',  $eP['port_idx']['acc1'] ?? null, '48');

// Ohne Interface-Namen: der Core meldet die nackte Portnummer.
$rP2 = LldpEdgeBuilder::build($hMac, $rawPort,
    ['core' => ['0.1.1' => ['id' => '48']]]);
check('ohne ifName: Vergleich ueber den Portnamen',
    (findEdge($rP2['edges'], 'core', 'acc1') ?? [])['confirmed'] ?? null, true);

// Derselbe Port meldet ZUSAETZLICH ein benanntes Geraet: dann ist nicht zu
// sagen, welche Zeile der Core ist.
$rP3 = LldpEdgeBuilder::build($hMac, array_merge($rawPort, [
    ['hostid' => 'acc1', 'key_' => 'lldpRemSysName[0.48.2]', 'lastvalue' => 'desk-phone-7', 'src' => 'lldp'],
]), $portsPort, [], [], [], [], [], $namesPort);
check('geteilter Port: MAC bleibt offen', count($rP3['quality']['acc1']['unmatched'] ?? []), 2);

// Ein NAME, der auf keinen Host passt, ist ein anderes Geraet.
$rP4 = LldpEdgeBuilder::build($hMac, [
    $rawPort[0],
    ['hostid' => 'acc1', 'key_' => 'lldpRemSysName[0.48.1]', 'lastvalue' => 'unknown-box', 'src' => 'lldp'],
], $portsPort, [], [], [], [], [], $namesPort);
check('Name statt MAC: keine Port-Zuordnung', count($rP4['unmatched']), 1);

// Zwei Hosts melden denselben Port als Gegenstelle.
$rP5 = LldpEdgeBuilder::build($hMac, array_merge($rawPort, [
    ['hostid' => 'acc2', 'key_' => 'lldpRemSysName[0.9.1]', 'lastvalue' => 'lab-acc1', 'src' => 'lldp'],
]), ['core' => $portsPort['core'], 'acc2' => ['0.9.1' => ['desc' => 'Gi1/0/48']]],
    [], [], [], [], [], $namesPort);
check('zwei Gegenstellen: MAC bleibt offen', count($rP5['unmatched']), 1);

// Anderer Port: kein Treffer.
$rP6 = LldpEdgeBuilder::build($hMac, [
    $rawPort[0],
    ['hostid' => 'acc1', 'key_' => 'lldpRemSysName[0.47.1]', 'lastvalue' => '02 5E 10 00 00 01', 'src' => 'lldp'],
], $portsPort, [], [], [], [], [], ['acc1' => ['47' => 'Gi1/0/47', '48' => 'Gi1/0/48']]);
check('anderer Port: MAC bleibt offen', count($rP6['unmatched']), 1);

// ── Zuordnung ueber die Chassis-ID ─────────────────────────────────────────
echo "\n  LldpEdgeBuilder — MAC ueber die Chassis-ID\n\n";

// lab-acc1 nennt den Core mit Namen UND Chassis-ID, lab-acc2 nur die MAC.
$rawCh = [
    ['hostid' => 'acc1', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => 'lab-core', 'src' => 'lldp'],
    ['hostid' => 'acc2', 'key_' => 'lldpRemSysName[0.2.1]', 'lastvalue' => '02 5E AA 00 00 0C', 'src' => 'cdp'],
];
$metaCh = ['acc1' => ['0.1.1' => ['chassis' => '02:5e:aa:00:00:0c']]];
$rC = LldpEdgeBuilder::build($hMac, $rawCh, [], [], [], $metaCh);
$eC = findEdge($rC['edges'], 'core', 'acc2') ?? [];
check('Chassis-Treffer: Kante zum Core',  $eC !== [], true);
check('Chassis-Treffer: als chassis markiert', $eC['match'] ?? null, 'chassis');
check('Chassis-Treffer: nichts unmatched', count($rC['unmatched']), 0);

// Dieselbe MAC fuer zwei verschiedene Hosts: nicht verwenden.
$rC2 = LldpEdgeBuilder::build($hMac, array_merge($rawCh, [
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.7.1]', 'lastvalue' => 'lab-acc1', 'src' => 'lldp'],
]), [], [], [], $metaCh + ['core' => ['0.7.1' => ['chassis' => '02 5E AA 00 00 0C']]]);
check('widerspruechliche Chassis-ID: MAC bleibt offen', count($rC2['unmatched']), 1);

// Eine Null-MAC ist keine Identitaet.
$rC3 = LldpEdgeBuilder::build($hMac, [
    ['hostid' => 'acc1', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => 'lab-core', 'src' => 'lldp'],
    ['hostid' => 'acc2', 'key_' => 'lldpRemSysName[0.2.1]', 'lastvalue' => '00:00:00:00:00:00', 'src' => 'lldp'],
], [], [], [], ['acc1' => ['0.1.1' => ['chassis' => '00 00 00 00 00 00']]]);
check('Null-MAC: keine Zuordnung', count($rC3['unmatched']), 1);

// Widerspruch: Eigen-MAC eines Hosts == Chassis, das ein anderer Switch per
// sicherem Namenstreffer einem ANDEREN Host zuordnet. Dann ist "wem gehoert
// die MAC" nicht zu entscheiden -> MAC wird nicht verwendet (Geist), nicht
// geraten. Bewusste Verhaltensaenderung durch den Eigen-Seed (Review-Finding).
$Mx = '02 5E AA 00 00 0C';
$rawConf = [
    // acc2 nennt core beim NAMEN und bringt Chassis Mx mit -> Mx gehoert core.
    ['hostid' => 'acc2', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => 'lab-core', 'src' => 'lldp'],
    // acc2 nennt zusaetzlich jemanden NUR per Mx.
    ['hostid' => 'acc2', 'key_' => 'lldpRemSysName[0.2.1]', 'lastvalue' => $Mx, 'src' => 'cdp'],
];
$metaConf = ['acc2' => ['0.1.1' => ['chassis' => '02:5e:aa:00:00:0c']]];
// Ohne Eigen-Seed: Mx wird per Namens-Lernen core zugeordnet -> kein Geist.
$rNoConf = LldpEdgeBuilder::build($hMac, $rawConf, [], [], [], $metaConf);
check('ohne Widerspruch: Mx loest per chassis auf (kein Geist)',
    count($rNoConf['quality']['acc2']['unmatched'] ?? []), 0);
// Mit Eigen-Seed acc1==Mx: Widerspruch (acc1 vs core) -> Mx unbrauchbar -> Geist.
$rConf = LldpEdgeBuilder::build($hMac, $rawConf, [], [], [], $metaConf,
    host_self_mac: ['acc1' => [$Mx]]);
check('Widerspruch Eigen-MAC vs Namenstreffer: Mx-Zeile wird Geist',
    count($rConf['quality']['acc2']['unmatched'] ?? []), 1);

// ── lldpRemChassisIdSubtype: eine ID mit Subtype != 4 ist KEINE MAC (5.5.96) ──
// Gleicher Aufbau wie der Chassis-Treffer oben ($rawCh: acc1 nennt core beim
// Namen + bringt die Chassis-ID mit, acc2 nennt jemanden NUR per MAC). Meldet
// acc1 dazu den Subtype 5 (Netzadresse/IP), ist die ID 02:5e:aa:00:00:0c KEINE
// MAC -> sie darf acc2s MAC-Zeile nicht an core lehren -> acc2 bleibt unmatched.
$metaSub5 = ['acc1' => ['0.1.1' => ['chassis' => '02:5e:aa:00:00:0c', 'chassis_subtype' => '5']]];
$rSub5 = LldpEdgeBuilder::build($hMac, $rawCh, [], [], [], $metaSub5);
check('Subtype 5 (IP): Chassis NICHT als MAC -> acc2 unmatched',
    count($rSub5['unmatched']), 1);
check('Subtype 5: keine Chassis-Kante zum Core',
    findEdge($rSub5['edges'], 'core', 'acc2'), null);

// Subtype 4 (als MIB-Text "macAddress(4)") verhaelt sich wie ohne Erhebung:
// die Zahl 4 wird herausgezogen, die ID bleibt eine MAC -> Chassis-Treffer.
$metaSub4 = ['acc1' => ['0.1.1' => ['chassis' => '02:5e:aa:00:00:0c', 'chassis_subtype' => 'macAddress(4)']]];
$rSub4 = LldpEdgeBuilder::build($hMac, $rawCh, [], [], [], $metaSub4);
check('Subtype 4 (MAC): Chassis-Treffer wie gehabt',
    (findEdge($rSub4['edges'], 'core', 'acc2') ?? [])['match'] ?? null, 'chassis');

// ── lldpRemManAddr: Treffer ueber die Management-IP (5.5.97) ────────────────
// Der Nachbar nennt einen Namen, der auf KEINEN Host passt, strahlt aber eine
// Management-IP aus (lldpRemManAddr), die zu genau einem ueberwachten Host
// gehoert -> Kante ueber die IP, kein Geist. Letzter Pfad: laeuft erst, wenn
// Name und Chassis nichts getroffen haben.
$hMgmt = [
    'rep' => ['host' => 'sw-rep', 'name' => 'sw-rep', 'interfaces' => [['ip' => '10.0.0.1']]],
    'tgt' => ['host' => 'fw-xyz', 'name' => 'fw-xyz', 'interfaces' => [['ip' => '10.9.9.9']]],
];
$rawMgmt  = [['hostid' => 'rep', 'key_' => 'lldpRemSysName[0.5.1]', 'lastvalue' => 'opnsense.localdomain.alias', 'src' => 'lldp']];
$metaMgmt = ['rep' => ['0.5.1' => ['mgmt_ip' => '10.9.9.9']]];
$rMg = LldpEdgeBuilder::build($hMgmt, $rawMgmt, [], [], [], $metaMgmt);
$eMg = findEdge($rMg['edges'], 'rep', 'tgt') ?? [];
check('Mgmt-IP-Treffer: Kante entsteht',       $eMg !== [], true);
check('Mgmt-IP-Treffer: als mgmt_ip markiert', $eMg['match'] ?? null, 'mgmt_ip');
check('Mgmt-IP-Treffer: nichts unmatched',     count($rMg['unmatched']), 0);

// Unbekannte IP -> kein Treffer, aber der Geist traegt die Mgmt-IP.
$rMgX = LldpEdgeBuilder::build($hMgmt, $rawMgmt, [], [], [], ['rep' => ['0.5.1' => ['mgmt_ip' => '10.9.9.250']]]);
check('Unbekannte Mgmt-IP: bleibt Geist',  count($rMgX['unmatched']), 1);
check('Geist traegt die Mgmt-IP',          $rMgX['quality']['rep']['unmatched'][0]['mgmt_ip'] ?? null, '10.9.9.250');

// Mehrdeutige IP (zwei Hosts teilen sie) -> kein Treffer (falsche Kante waere
// schlimmer als keine, dieselbe Regel wie beim Namen und bei der Chassis-MAC).
$hMgmt2 = $hMgmt + ['tgt2' => ['host' => 'fw-abc', 'name' => 'fw-abc', 'interfaces' => [['ip' => '10.9.9.9']]]];
$rMg2 = LldpEdgeBuilder::build($hMgmt2, $rawMgmt, [], [], [], $metaMgmt);
check('Mehrdeutige Mgmt-IP: keine Kante',        findEdge($rMg2['edges'], 'rep', 'tgt'), null);
check('Mehrdeutige Mgmt-IP: als mehrdeutig vermerkt', count($rMg2['quality']['rep']['ambiguous'] ?? []), 1);
check('Mehrdeutige Mgmt-IP: nicht als Geist',    count($rMg2['unmatched']), 0);

// Mgmt-IP == Eigen-IP des Melders -> keine Selbstkante.
$rSelf = LldpEdgeBuilder::build($hMgmt, $rawMgmt, [], [], [], ['rep' => ['0.5.1' => ['mgmt_ip' => '10.0.0.1']]]);
check('Mgmt-IP == Eigen-IP: keine Selbstkante', findEdge($rSelf['edges'], 'rep', 'rep'), null);

// ── CDP-only: Nachbar nur per MAC, aufgeloest ueber die EIGEN-Identitaet ────
//
// Nachgestellt an zwei echten Cisco SB (2026-10-18), Werte hier ERFUNDEN
// (02:.. = lokal verwaltet). swB kennt seinen Nachbarn NUR ueber CDP:
// cdpCacheDeviceId = dessen MAC, der LLDP-SysName ist leer. Kein anderer
// Switch meldet diese MAC je mit Namen. Ohne die Eigen-Identitaet wurde daraus
// ein Geist; mit ihr (lldpLocChassisId / dot1dBaseBridgeAddress je Host) trifft
// die MAC direkt. Technische Namen bewusst NICHT die MAC, sonst griffe das
// Namens-Matching und der MAC-Pfad bliebe ungeprueft.
$macA = '02 00 5E 0A 11 01';   // Eigen-MAC von swA
$macB = '02 00 5E 0A 11 02';   // Eigen-MAC von swB
$hCisco = [
    'swA' => ['host' => 'edge-sw-a', 'name' => 'edge-sw-a'],
    'swB' => ['host' => 'edge-sw-b', 'name' => 'edge-sw-b'],
];
// swB sieht swA nur als CDP-MAC (kein Name); swA sieht swB per Name.
$rawCisco = [
    ['hostid' => 'swA', 'key_' => 'lldpRemSysName[0.72.1]', 'lastvalue' => 'edge-sw-b', 'src' => 'lldp'],
    ['hostid' => 'swB', 'key_' => 'cdpCacheDeviceId[49.2]', 'lastvalue' => $macA,       'src' => 'cdp'],
];

// OHNE Eigen-Identitaet: die nackte CDP-MAC bleibt ein Geist.
$rCiscoA = LldpEdgeBuilder::build($hCisco, $rawCisco);
check('CDP-only ohne Eigen-MAC: MAC bleibt offen (Geist)',
    count($rCiscoA['quality']['swB']['unmatched'] ?? []), 1);

// MIT Eigen-Identitaet (Rohform mit Leerzeichen wie von Zabbix geliefert):
$selfMac = [
    'swA' => [$macA, $macA],   // chassis + basemac, identisch
    'swB' => [$macB],
];
$rCisco = LldpEdgeBuilder::build($hCisco, $rawCisco, host_self_mac: $selfMac);
$eCisco = findEdge($rCisco['edges'], 'swA', 'swB') ?? [];
check('CDP-only: genau eine Kante, kein Geist', count($rCisco['edges']), 1);
check('CDP-only: nichts mehr unmatched',        count($rCisco['unmatched']), 0);
check('CDP-only: beide Protokolle an der Kante', $eCisco['src'] ?? null, ['cdp', 'lldp']);

// Eigen-MAC zweier Hosts gleich (Stack/HA): nicht raten -> Geist bleibt.
$rCiscoDup = LldpEdgeBuilder::build($hCisco, $rawCisco, host_self_mac: [
    'swA' => [$macA],
    'swB' => [$macA],   // dieselbe MAC -> widerspruechlich
]);
check('CDP-only: geteilte Eigen-MAC bleibt offen',
    count($rCiscoDup['quality']['swB']['unmatched'] ?? []), 1);

// ── Opake Hex-CDP-ID, die keine 6-Byte-MAC ist (Liberamente-Fork, mmajer #7) ──
//
// Eine CDP Device-ID kann eine leerzeichengetrennte Hex-Folge sein, die NICHT
// sechs Byte lang ist (fuenf hier). macForm nimmt nur 6 Byte, also schnitt
// cleanNeighbor sie frueher auf "01" und traf einen Host namens "01" — eine
// erfundene Kante. Jetzt bleibt die volle ID erhalten, keine Namens-Fallbacks.
$hOpaque = [
    'sw'  => ['host' => 'switch-lab', 'name' => 'Switch Lab'],
    'x01' => ['host' => '01',         'name' => 'Short Token Host'],
];
$rawOpaque = [['hostid' => 'sw', 'key_' => 'cdpCacheDeviceId[7.1]', 'lastvalue' => '01 02 03 04 05', 'src' => 'cdp']];
$rOpaque = LldpEdgeBuilder::build($hOpaque, $rawOpaque);
check('5-Byte-Hex: keine Kante zum Host "01"', findEdge($rOpaque['edges'], 'sw', 'x01'), null);
check('5-Byte-Hex: gar keine Kante',           count($rOpaque['edges']), 0);
check('5-Byte-Hex: volle ID im Geist erhalten',
    (bool) preg_grep('/01 02 03 04 05/', $rOpaque['unmatched']), true);
// Zwei verschiedene 01-xx-IDs duerfen NICHT zu einem Phantom-Geist "01" kollabieren.
$rawTwo = [
    ['hostid' => 'sw', 'key_' => 'cdpCacheDeviceId[7.1]', 'lastvalue' => '01 02 03 04 05', 'src' => 'cdp'],
    ['hostid' => 'sw', 'key_' => 'cdpCacheDeviceId[7.2]', 'lastvalue' => '01 aa bb cc dd', 'src' => 'cdp'],
];
$rTwo = LldpEdgeBuilder::build(['sw' => ['host' => 'switch-lab', 'name' => 'Switch Lab']], $rawTwo);
check('zwei Hex-IDs bleiben zwei Beobachtungen', count($rTwo['unmatched']), 2);
// Eine echte 6-Byte-MAC bleibt unveraendert (nur 5 Byte sind opak): weiter macForm-Pfad.
$rawMac6 = [['hostid' => 'sw', 'key_' => 'cdpCacheDeviceId[7.1]', 'lastvalue' => '02 11 22 33 44 55', 'src' => 'cdp']];
$rMac6 = LldpEdgeBuilder::build(['sw' => ['host' => 'switch-lab', 'name' => 'Switch Lab']], $rawMac6);
check('6-Byte-MAC weiter als MAC behandelt (unbekannt -> Geist, keine Kante)', count($rMac6['edges']), 0);

// ── Issue #16: Port-Metrik mit net.if.in[ifIndex]-Items, Ende zu Ende ──────
//
// Zwei Switches melden einander ueber LLDP, lldpRemLocalPortNum == ifIndex,
// die Interface-Items heissen net.if.in[24]. Bis 5.3.1 schaetzte die Karte aus
// den Knotensummen. Namen und Werte erfunden.
echo "\n  LldpEdgeBuilder — Port-Metrik aus net.if.in[ifIndex] (#16)\n\n";

$m16 = Modules\NetworkTopology\Topology\MetricExtractor::extract([
    ['hostid' => 'swa', 'key_' => 'lldpRemSysName[0.24.1]', 'name' => 'LLDP', 'lastvalue' => 'lab-swb'],
    ['hostid' => 'swb', 'key_' => 'lldpRemSysName[0.46.1]', 'name' => 'LLDP', 'lastvalue' => 'lab-swa'],
    ['hostid' => 'swa', 'key_' => 'net.if.in[24]',  'name' => 'Interface 24(): Bits received', 'lastvalue' => '3000'],
    ['hostid' => 'swa', 'key_' => 'net.if.out[24]', 'name' => 'Interface 24(): Bits sent',     'lastvalue' => '5000'],
    ['hostid' => 'swb', 'key_' => 'net.if.in[46]',  'name' => 'Interface 46(): Bits received', 'lastvalue' => '5000'],
    ['hostid' => 'swb', 'key_' => 'net.if.out[46]', 'name' => 'Interface 46(): Bits sent',     'lastvalue' => '3000'],
]);
$r16 = LldpEdgeBuilder::build(
    ['swa' => ['host' => 'lab-swa', 'name' => 'lab-swa'], 'swb' => ['host' => 'lab-swb', 'name' => 'lab-swb']],
    $m16['lldp_raw'], $m16['lldp_ports'], $m16['port_traffic'], $m16['port_speed']);
$e16 = findEdge($r16['edges'], 'swa', 'swb') ?? [];
check('#16: Port-Metrik am Ende A (Port 24)', $e16['port_metrics']['swa']['in'] ?? null, 3000.0);
check('#16: Port-Metrik am Ende B (Port 46)', $e16['port_metrics']['swb']['in'] ?? null, 5000.0);

// ── Derselbe Port meldet LLDP-Namen und CDP-MAC ────────────────────────────
//
// Aruba-Switches beantworten die CDP-Nachbartabelle mit der MAC des Nachbarn,
// waehrend dieselbe Verbindung ueber LLDP einen Namen traegt. Beides haengt am
// selben lokalen Port. Bis 5.3.1 stand die Verbindung zum Nachbarn auf der
// Karte UND daneben ein Geist aus zwei Hex-Ziffern. Namen erfunden.
echo "\n  LldpEdgeBuilder — LLDP-Name und CDP-MAC am selben Port\n\n";

$hAru = [
    'core' => ['host' => 'lab-core', 'name' => 'lab-core'],
    'acc'  => ['host' => 'lab-acc',  'name' => 'lab-acc'],
    'acc2' => ['host' => 'lab-acc2', 'name' => 'lab-acc2'],
];
$rAru = LldpEdgeBuilder::build($hAru, [
    ['hostid' => 'acc', 'key_' => 'lldpRemSysName[0.47.1]',  'lastvalue' => 'lab-core', 'src' => 'lldp'],
    ['hostid' => 'acc', 'key_' => 'cdpCacheDeviceId[47.1]',  'lastvalue' => '02 5E 10 00 00 01', 'src' => 'cdp'],
]);
$eAru = findEdge($rAru['edges'], 'acc', 'core') ?? [];
check('selber Port: eine Kante, kein Geist',  count($rAru['edges']), 1);
check('selber Port: nichts unmatched',        count($rAru['unmatched']), 0);
check('selber Port: beide Protokolle',        $eAru['src'] ?? null, ['cdp', 'lldp']);

// Zeigen die anderen Zeilen desselben Ports auf VERSCHIEDENE Hosts, wird nichts
// geraten (ein nicht verwalteter Switch dazwischen sieht genau so aus).
$rAru2 = LldpEdgeBuilder::build($hAru, [
    ['hostid' => 'acc', 'key_' => 'lldpRemSysName[0.47.1]', 'lastvalue' => 'lab-core',  'src' => 'lldp'],
    ['hostid' => 'acc', 'key_' => 'lldpRemSysName[0.47.2]', 'lastvalue' => 'lab-acc2',  'src' => 'lldp'],
    ['hostid' => 'acc', 'key_' => 'cdpCacheDeviceId[47.1]', 'lastvalue' => '02 5E 10 00 00 01', 'src' => 'cdp'],
]);
check('zwei Hosts am Port: MAC bleibt offen', count($rAru2['unmatched']), 1);

// ── Dieselbe private Adresse bei zwei Kunden (#14) ─────────────────────────
//
// Ein Dienstleister hat mehrere Mandanten auf einer Karte, und 192.168.1.10
// gibt es in jedem zweiten Netz. Bis 5.3.1 gewann der zuletzt eingelesene
// Host, und der Melder bekam eine Kante zu einem FREMDEN Kunden — mit 60
// Punkten Sicherheit und ohne Hinweis im Qualitaets-Tab. Namen erfunden.
echo "\n  LldpEdgeBuilder — doppelt vergebene IP\n\n";

$hIp = [
    'a1' => ['host' => 'lab-a-sw1', 'name' => 'lab-a-sw1',
             'interfaces' => [['ip' => '192.168.1.10']]],
    'b1' => ['host' => 'lab-b-sw1', 'name' => 'lab-b-sw1',
             'interfaces' => [['ip' => '192.168.1.10']]],
    'c1' => ['host' => 'lab-c-sw1', 'name' => 'lab-c-sw1',
             'interfaces' => [['ip' => '10.99.0.5']]],
    'melder' => ['host' => 'lab-melder', 'name' => 'lab-melder',
                 'interfaces' => [['ip' => '10.99.0.1']]],
];

$rIp = LldpEdgeBuilder::build($hIp, [
    ['hostid' => 'melder', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => '192.168.1.10', 'src' => 'lldp'],
]);
check('doppelte IP: keine Kante',            count($rIp['edges']), 0);
check('doppelte IP: als mehrdeutig gemeldet', count($rIp['quality']['melder']['ambiguous'] ?? []), 1);
$kand = ($rIp['quality']['melder']['ambiguous'][0]['candidates'] ?? []);
sort($kand);
check('doppelte IP: beide Kandidaten genannt', $kand, ['a1', 'b1']);
check('doppelte IP: nicht als unmatched gezaehlt', count($rIp['quality']['melder']['unmatched'] ?? []), 0);

// Eindeutige IP trifft weiterhin.
$rIp2 = LldpEdgeBuilder::build($hIp, [
    ['hostid' => 'melder', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => '10.99.0.5', 'src' => 'lldp'],
]);
check('eindeutige IP: Kante bleibt',   hasEdge($rIp2['edges'], 'melder', 'c1'), true);
check('eindeutige IP: Art bleibt ip',  ($rIp2['edges'][0]['match'] ?? null), 'ip');

// Zwei Schnittstellen DESSELBEN Hosts mit derselben Adresse sind kein Konflikt.
$hIp3 = ['x1' => ['host' => 'lab-x-sw1', 'name' => 'lab-x-sw1',
                  'interfaces' => [['ip' => '10.99.0.7'], ['ip' => '10.99.0.7']]],
         'melder' => $hIp['melder']];
$rIp3 = LldpEdgeBuilder::build($hIp3, [
    ['hostid' => 'melder', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => '10.99.0.7', 'src' => 'lldp'],
]);
check('gleiche IP am selben Host: Kante',  hasEdge($rIp3['edges'], 'melder', 'x1'), true);

// Der Kurzname darf die mehrdeutige IP nicht aufloesen: "192.168.1.10" faellt
// sonst auf "192" zurueck und trifft einen Host dieses Namens.
$hIp4 = $hIp + ['seltsam' => ['host' => '192', 'name' => '192']];
$rIp4 = LldpEdgeBuilder::build($hIp4, [
    ['hostid' => 'melder', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => '192.168.1.10', 'src' => 'lldp'],
]);
check('kein Kurznamen-Treffer auf "192"', count($rIp4['edges']), 0);

// ── nt:uplink — der Admin sagt, wo das Kabel steckt (#18) ──────────────────
//
// Eine USV meldet keinen Nachbarn. Der Port am Switch ist trotzdem bekannt,
// und mit ihm haengen Verkehr und Fehler an der Kante. Namen erfunden.
echo "\n  LldpEdgeBuilder — nt:uplink\n\n";

$hUp = [
    'sw'  => ['host' => 'lab-sw-01', 'name' => 'lab-sw-01'],
    'ups' => ['host' => 'lab-ups-01', 'name' => 'USV Serverraum'],
    'pdu' => ['host' => 'lab-pdu-01', 'name' => 'lab-pdu-01'],
];
$namenUp  = ['sw' => ['8' => 'Gi1/0/8', '9' => 'Gi1/0/9']];
$trafficUp = ['sw' => ['8' => ['in' => 120000.0, 'out' => 90000.0]]];
$fehlerUp  = ['sw' => ['8' => 0.25]];

$eUp = LldpEdgeBuilder::uplinkEdges($hUp, ['ups' => ['host' => 'lab-sw-01', 'port' => 'Gi1/0/8']],
    [], $trafficUp, [], $fehlerUp, [], $namenUp);
check('nt:uplink: Kante entsteht',        count($eUp), 1);
check('nt:uplink: Richtung Switch->Geraet', [$eUp[0]['from'], $eUp[0]['to']], ['sw', 'ups']);
check('nt:uplink: Port am Switch-Ende',   $eUp[0]['ports']['sw'] ?? null, 'Gi1/0/8');
check('nt:uplink: Verkehr an DIESEM Port', $eUp[0]['port_metrics']['sw']['in'] ?? null, 120000.0);
check('nt:uplink: Fehler an DIESEM Port',  $eUp[0]['port_metrics']['sw']['errors'] ?? null, 0.25);
check('nt:uplink: eigene Match-Art',      $eUp[0]['match'] ?? null, 'tag');
check('nt:uplink: NICHT beidseitig bestaetigt', $eUp[0]['confirmed'] ?? null, false);

// Der Port darf auch der nackte ifIndex sein.
$eUp2 = LldpEdgeBuilder::uplinkEdges($hUp, ['ups' => ['host' => 'lab-sw-01', 'port' => '8']],
    [], $trafficUp, [], [], [], $namenUp);
check('ifIndex statt Name: Portlabel aus ifName', $eUp2[0]['ports']['sw'] ?? null, 'Gi1/0/8');
check('ifIndex statt Name: Metrik da',            $eUp2[0]['port_metrics']['sw']['out'] ?? null, 90000.0);

// Anzeigename als Ziel, andere Schreibweise des Ports.
$eUp3 = LldpEdgeBuilder::uplinkEdges($hUp, ['pdu' => ['host' => 'LAB-SW-01', 'port' => 'GigabitEthernet1/0/9']],
    [], [], [], [], [], $namenUp);
check('Gross/Klein + lange Portform',  $eUp3[0]['port_idx']['sw'] ?? null, '9');

// Unbekannter Host, Selbstbezug, unbekannter Port.
check('unbekannter Host: keine Kante',
    count(LldpEdgeBuilder::uplinkEdges($hUp, ['ups' => ['host' => 'gibt-es-nicht', 'port' => '8']], [])), 0);
check('Selbstbezug: keine Kante',
    count(LldpEdgeBuilder::uplinkEdges($hUp, ['ups' => ['host' => 'lab-ups-01', 'port' => '8']], [])), 0);
$eUp4 = LldpEdgeBuilder::uplinkEdges($hUp, ['ups' => ['host' => 'lab-sw-01', 'port' => 'Gi9/9/9']],
    [], $trafficUp, [], [], [], $namenUp);
check('unbekannter Port: Kante ja, Metrik nein', count($eUp4), 1);
check('unbekannter Port: keine Portmetrik',      $eUp4[0]['port_metrics'] ?? null, []);

// Meldet das Geraet spaeter doch selbst: ERGAENZEN, nicht verdoppeln.
$rMix = LldpEdgeBuilder::build($hUp, [
    ['hostid' => 'sw', 'key_' => 'lldpRemSysName[0.8.1]', 'lastvalue' => 'lab-ups-01', 'src' => 'lldp'],
]);
$eMix = LldpEdgeBuilder::uplinkEdges($hUp, ['ups' => ['host' => 'lab-sw-01', 'port' => 'Gi1/0/8']],
    $rMix['edges'], $trafficUp, [], $fehlerUp, [], $namenUp);
check('schon gemeldet: eine Kante bleibt', count($eMix), 1);
// GENAU die Listenform pruefen, nicht "irgendwie enthalten": als Map
// geschrieben wuerde json_encode ein Objekt daraus machen, und Panel,
// Tooltip, Export und Bericht pruefen alle auf eine Liste.
check('schon gemeldet: src bleibt eine Liste', $eMix[0]['src'] ?? null, ['lldp', 'tag']);
check('schon gemeldet: Namenstreffer bleibt', $eMix[0]['match'] ?? null, 'exact');
// Zweimal dasselbe Tag darf die Quelle nicht verdoppeln.
$eMix2 = LldpEdgeBuilder::uplinkEdges($hUp, ['ups' => ['host' => 'lab-sw-01', 'port' => 'Gi1/0/8']],
    $eMix, $trafficUp, [], $fehlerUp, [], $namenUp);
check('zweimal angewandt: keine doppelte Quelle', $eMix2[0]['src'] ?? null, ['lldp', 'tag']);

// ── nt:lldp — der Host erklaert seinen Namen auf dem Draht (#14) ───────────
//
// Der Name in Zabbix und der ausgesendete Name muessen nicht zusammenpassen.
// Wo sie auseinanderlaufen, stand bisher ein Geist neben genau dem Host, den
// der Nachbar gemeint hat. Namen erfunden.
echo "\n  LldpEdgeBuilder — nt:lldp\n\n";

$hAl = [
    'sw'   => ['host' => 'lab-sw-01', 'name' => 'lab-sw-01'],
    'core' => ['host' => 'lab-core-01', 'name' => 'Core (Rack 3)',
               'nt_aliases' => ['CORE-OLD-NAME', 'core-old-name.lan']],
];
$rAl = LldpEdgeBuilder::build($hAl, [
    ['hostid' => 'sw', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => 'CORE-OLD-NAME', 'src' => 'lldp'],
]);
check('erklaerter Name -> Kante',   hasEdge($rAl['edges'], 'sw', 'core'), true);
check('eigene Match-Art',           $rAl['edges'][0]['match'] ?? null, 'alias');
check('Gross/Klein egal', count(LldpEdgeBuilder::build($hAl, [
    ['hostid' => 'sw', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => 'core-old-name', 'src' => 'lldp'],
])['edges']), 1);
check('mit Domain gemeldet', count(LldpEdgeBuilder::build($hAl, [
    ['hostid' => 'sw', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => 'CORE-OLD-NAME.example.test', 'src' => 'lldp'],
])['edges']), 1);

// Der echte Name gewinnt: ein Alias darf einen Host nicht verdraengen.
$hAl2 = $hAl + ['fremd' => ['host' => 'lab-sw-99', 'name' => 'lab-sw-99',
                            'nt_aliases' => ['lab-sw-01']]];
$rAl2 = LldpEdgeBuilder::build($hAl2, [
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => 'lab-sw-01', 'src' => 'lldp'],
]);
check('echter Name schlaegt Alias', hasEdge($rAl2['edges'], 'core', 'sw'), true);
check('und zwar als exact',         $rAl2['edges'][0]['match'] ?? null, 'exact');

// Zwei Hosts beanspruchen denselben Namen: nichts zeichnen, aber melden.
$hAl3 = [
    'a' => ['host' => 'lab-a', 'name' => 'lab-a', 'nt_aliases' => ['doppelt']],
    'b' => ['host' => 'lab-b', 'name' => 'lab-b', 'nt_aliases' => ['doppelt']],
    'm' => ['host' => 'lab-melder', 'name' => 'lab-melder'],
];
$rAl3 = LldpEdgeBuilder::build($hAl3, [
    ['hostid' => 'm', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => 'doppelt', 'src' => 'lldp'],
]);
check('zwei Anspruchsteller: keine Kante', count($rAl3['edges']), 0);
check('zwei Anspruchsteller: gemeldet',    count($rAl3['quality']['m']['ambiguous'] ?? []), 1);

// ── nt:lldp als MAC — jede Schreibweise muss treffen (Issue #24) ──────────
//
// CDP meldet den Nachbarn als Byte-MAC "AA BB CC DD EE FF", das Tag traegt
// sie als "AA:BB:CC:DD:EE:FF". Bis hierher lief der Alias-Vergleich auf dem
// Rohtext und verfehlte die normalisierte Form: gleiche Adresse, kein Treffer.
// MACs erfunden.
echo "\n  LldpEdgeBuilder — nt:lldp als MAC (#24)\n\n";

$hMac = [
    'sw' => ['host' => 'lab-sw-01', 'name' => 'lab-sw-01'],
    'nb' => ['host' => 'lab-nb-01', 'name' => 'lab-nb-01',
             'nt_aliases' => ['AA:BB:CC:DD:EE:FF']],
];
$macNb = static fn (string $v): array => LldpEdgeBuilder::build($hMac, [
    ['hostid' => 'sw', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => $v, 'src' => 'lldp'],
]);
check('Doppelpunkt-Tag trifft Leerzeichen-MAC', hasEdge($macNb('AA BB CC DD EE FF')['edges'], 'sw', 'nb'), true);
check('Match-Art ist alias',                    $macNb('AA BB CC DD EE FF')['edges'][0]['match'] ?? null, 'alias');
check('Doppelpunkt-Tag trifft Bindestrich-MAC', hasEdge($macNb('AA-BB-CC-DD-EE-FF')['edges'], 'sw', 'nb'), true);
check('Doppelpunkt-Tag trifft nackte MAC',      hasEdge($macNb('AABBCCDDEEFF')['edges'], 'sw', 'nb'), true);
check('Doppelpunkt-Tag trifft Cisco-MAC',       hasEdge($macNb('aabb.ccdd.eeff')['edges'], 'sw', 'nb'), true);
check('Doppelpunkt-Tag trifft Doppelpunkt-MAC', hasEdge($macNb('aa:bb:cc:dd:ee:ff')['edges'], 'sw', 'nb'), true);

// Umgekehrt: Tag im Rohformat, Nachbar mit Doppelpunkten.
$hMacR = ['sw' => ['host' => 'lab-sw-01', 'name' => 'lab-sw-01'],
          'nb' => ['host' => 'lab-nb-01', 'name' => 'lab-nb-01', 'nt_aliases' => ['AA BB CC DD EE FF']]];
check('Leerzeichen-Tag trifft Doppelpunkt-MAC', hasEdge(LldpEdgeBuilder::build($hMacR, [
    ['hostid' => 'sw', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => 'AA:BB:CC:DD:EE:FF', 'src' => 'lldp'],
])['edges'], 'sw', 'nb'), true);

// Zwei Hosts beanspruchen dieselbe MAC (verschiedene Schreibweisen): keine
// Kante, aber im Qualitaets-Tab gemeldet — raten waere schlimmer.
$hMacA = [
    'a' => ['host' => 'lab-a', 'name' => 'lab-a', 'nt_aliases' => ['AA:BB:CC:DD:EE:FF']],
    'b' => ['host' => 'lab-b', 'name' => 'lab-b', 'nt_aliases' => ['aa-bb-cc-dd-ee-ff']],
    'm' => ['host' => 'lab-melder', 'name' => 'lab-melder'],
];
$rMacA = LldpEdgeBuilder::build($hMacA, [
    ['hostid' => 'm', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => 'AA BB CC DD EE FF', 'src' => 'lldp'],
]);
check('zwei MAC-Anspruchsteller: keine Kante', count($rMacA['edges']), 0);
check('zwei MAC-Anspruchsteller: gemeldet',    count($rMacA['quality']['m']['ambiguous'] ?? []), 1);

// Broadcast-/Null-MAC taugt nicht als Identitaet — kein Alias-Treffer.
$hMacB = ['sw' => ['host' => 'lab-sw-01', 'name' => 'lab-sw-01'],
          'nb' => ['host' => 'lab-nb-01', 'name' => 'lab-nb-01', 'nt_aliases' => ['FF:FF:FF:FF:FF:FF']]];
check('Broadcast-MAC matcht nicht', hasEdge(LldpEdgeBuilder::build($hMacB, [
    ['hostid' => 'sw', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => 'ff ff ff ff ff ff', 'src' => 'lldp'],
])['edges'], 'sw', 'nb'), false);

// ── Uplink-Ports aus LLDP-Capabilities (fuer die MAC/FDB-Suche) ────────────
//
// Ein lokaler Port ist Uplink, wenn sein LLDP-Nachbar Bridge/Router meldet;
// AP/Telefon/Station sind Zugang. Portname kommt aus derselben ifName-Quelle
// wie die FDB-Treffer. Hex-Caps nach IEEE: 0x20=Bridge, 0x08=Router,
// 0x10=WLAN AP. Lokaler Port = Mitte des LLDP-Index (3-teilig) bzw. erster
// Teil beim CDP-Index (2-teilig). Daten erfunden.
echo "\n  LldpEdgeBuilder — Uplink-Ports aus LLDP-Caps\n\n";

$ifnCaps = ['sw1' => ['24' => 'Gi1/0/24', '5' => 'Te1/0/5', '7' => 'Gi1/0/7']];
$up = LldpEdgeBuilder::uplinkPortsByCaps([
    ['hostid' => 'sw1', 'key_' => 'lldpRemSysCapEnabled[0.24.1]', 'value' => '20 00'], // Bridge
    ['hostid' => 'sw1', 'key_' => 'lldpRemSysCapEnabled[0.7.1]',  'value' => '10 00'], // WLAN AP
    ['hostid' => 'sw1', 'key_' => 'lldpRemSysCapEnabled[5.1]',    'value' => '08 00'], // CDP, Router
], $ifnCaps);
check('Bridge-Nachbar -> Uplink (ifName)',  $up['ports']['sw1']['Gi1/0/24'] ?? null, true);
check('Router-Nachbar (CDP-Index) -> Uplink',$up['ports']['sw1']['Te1/0/5'] ?? null, true);
check('AP-Nachbar -> kein Uplink',          isset($up['ports']['sw1']['Gi1/0/7']), false);
check('Switch mit Caps -> known',           $up['known']['sw1'] ?? null, true);

// Textform (Value-Map im Template) + fehlender ifName -> Portnummer.
$up2 = LldpEdgeBuilder::uplinkPortsByCaps(
    [['hostid' => 'sw9', 'key_' => 'lldpRemSysCapEnabled[0.99.1]', 'value' => 'Bridge']], []);
check('Textform Bridge -> Uplink',          $up2['ports']['sw9']['99'] ?? null, true);

// Nur AP-Caps: known (LLDP laeuft), aber kein Uplink -> seine Ports sind
// damit sicher Zugang, nicht bloss „unbekannt".
$up3 = LldpEdgeBuilder::uplinkPortsByCaps(
    [['hostid' => 'swA', 'key_' => 'lldpRemSysCapEnabled[0.3.1]', 'value' => 'WLAN Access Point']], []);
check('nur AP: known',                      $up3['known']['swA'] ?? null, true);
check('nur AP: keine Uplink-Ports',         isset($up3['ports']['swA']), false);

// ── Portzustand und Portname an der Kante ─────────────────────────────────
//
// Zwei Meldungen aus einer Mail: die Kante war rot, obwohl der Port laeuft
// (die Farbe kam aus der Hostsumme), und der Portname stand nur auf einer
// Seite. Namen erfunden.
echo "\n  LldpEdgeBuilder — Portzustand und Portname\n\n";

$hPs = [
    'a' => ['host' => 'lab-sw-a', 'name' => 'lab-sw-a'],
    'b' => ['host' => 'lab-sw-b', 'name' => 'lab-sw-b'],
];
$namenPs = ['a' => ['29' => 'Gi1/0/29'], 'b' => ['9' => 'Gi1/0/9']];
$rPs = LldpEdgeBuilder::build($hPs, [
    ['hostid' => 'a', 'key_' => 'lldpRemSysName[0.29.1]', 'lastvalue' => 'lab-sw-b', 'src' => 'lldp'],
    ['hostid' => 'b', 'key_' => 'lldpRemSysName[0.9.1]',  'lastvalue' => 'lab-sw-a', 'src' => 'lldp'],
], ['a' => ['0.29.1' => ['desc' => 'Port 9']], 'b' => ['0.9.1' => ['desc' => 'Port 29']]],
    [], [], [], [], [], $namenPs, [],
    ['a' => ['29' => false], 'b' => ['9' => false]]);
$ePs = findEdge($rPs['edges'], 'a', 'b') ?? [];
check('eigener Portname auf BEIDEN Seiten', [$ePs['ports']['a'] ?? null, $ePs['ports']['b'] ?? null],
    ['Gi1/0/29', 'Gi1/0/9']);
check('Port a laeuft',  $ePs['port_metrics']['a']['down'] ?? null, false);
check('Port b laeuft',  $ePs['port_metrics']['b']['down'] ?? null, false);

// Ist der Port wirklich unten, steht es auch da.
$rPs2 = LldpEdgeBuilder::build($hPs, [
    ['hostid' => 'a', 'key_' => 'lldpRemSysName[0.29.1]', 'lastvalue' => 'lab-sw-b', 'src' => 'lldp'],
], [], [], [], [], [], [], $namenPs, [], ['a' => ['29' => true]]);
check('Port unten wird gemeldet', (findEdge($rPs2['edges'], 'a', 'b') ?? [])['port_metrics']['a']['down'] ?? null, true);

// Ohne Angabe bleibt das Feld weg — unbekannt ist nicht "laeuft".
$rPs3 = LldpEdgeBuilder::build($hPs, [
    ['hostid' => 'a', 'key_' => 'lldpRemSysName[0.29.1]', 'lastvalue' => 'lab-sw-b', 'src' => 'lldp'],
], [], [], [], [], [], [], $namenPs);
check('unbekannt bleibt unbekannt',
    isset((findEdge($rPs3['edges'], 'a', 'b') ?? [])['port_metrics']['a']['down']), false);
// ── Parallele Links (LAG, Bonding, mehrere Kabel) ──────────────────────────
// Bis 5.3 wurde ein Hostpaar zu EINER Kante zusammengefasst, first-wins: ein
// LAG zeigte einen Port und die Zaehler eines Members, und ein ausgefallener
// Member war unsichtbar. Jetzt ist jedes Kabel eine eigene Kante.
echo "\n  LldpEdgeBuilder — parallele Links\n\n";

$hLag = ['core' => ['host' => 'core', 'name' => 'core'], 'acc' => ['host' => 'acc', 'name' => 'acc']];
$namesLag = ['core' => ['1' => 'Gi1/0/1', '2' => 'Gi1/0/2'],
             'acc'  => ['49' => 'Te1/1/1', '50' => 'Te1/1/2']];
// Die Gegenseite meldet in UMGEKEHRTER Reihenfolge und in Langform — die
// Zuordnung muss ueber die Ports laufen, nicht ueber die Reihenfolge.
$rawLag = [
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.1.1]',  'lastvalue' => 'acc',  'src' => 'lldp'],
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.2.1]',  'lastvalue' => 'acc',  'src' => 'lldp'],
    ['hostid' => 'acc',  'key_' => 'lldpRemSysName[0.50.1]', 'lastvalue' => 'core', 'src' => 'lldp'],
    ['hostid' => 'acc',  'key_' => 'lldpRemSysName[0.49.1]', 'lastvalue' => 'core', 'src' => 'lldp'],
];
$portsLag = [
    'core' => ['0.1.1' => ['desc' => 'Te1/1/1'], '0.2.1' => ['desc' => 'Te1/1/2']],
    'acc'  => ['0.49.1' => ['desc' => 'GigabitEthernet1/0/1'], '0.50.1' => ['desc' => 'GigabitEthernet1/0/2']],
];
$trafLag = ['core' => ['1' => ['in' => 100.0, 'out' => 10.0], '2' => ['in' => 200.0, 'out' => 20.0]]];
$rLag = LldpEdgeBuilder::build($hLag, $rawLag, $portsLag, $trafLag, [], [], [], [], $namesLag);
$byCorePort = [];
foreach ($rLag['edges'] as $e) {
    $byCorePort[$e['ports']['core'] ?? '?'] = $e;
}
check('LAG: zwei Kabel -> zwei Kanten',            count($rLag['edges']), 2);
check('LAG: Member 1 beidseitig bestaetigt',       $byCorePort['Gi1/0/1']['confirmed'] ?? null, true);
check('LAG: Member 2 beidseitig bestaetigt',       $byCorePort['Gi1/0/2']['confirmed'] ?? null, true);
check('LAG: Member 1 Gegenport richtig gepaart',   $byCorePort['Gi1/0/1']['port_idx']['acc'] ?? null, '49');
check('LAG: Member 2 Gegenport richtig gepaart',   $byCorePort['Gi1/0/2']['port_idx']['acc'] ?? null, '50');
check('LAG: eigene Zaehler je Member (1)',         $byCorePort['Gi1/0/1']['port_metrics']['core']['in'] ?? null, 100.0);
check('LAG: eigene Zaehler je Member (2)',         $byCorePort['Gi1/0/2']['port_metrics']['core']['in'] ?? null, 200.0);
check('LAG: verschiedene Kanten-IDs',
    ($byCorePort['Gi1/0/1']['id'] ?? 'x') !== ($byCorePort['Gi1/0/2']['id'] ?? 'x'), true);

// Die teure Fehlerart ist die FALSCHE Aufspaltung: ein Kabel, von beiden
// Enden mit unvergleichbaren Labels gemeldet, darf nicht doppelt erscheinen.
$rawInc = [
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => 'acc',  'src' => 'lldp'],
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.2.1]', 'lastvalue' => 'acc',  'src' => 'lldp'],
    ['hostid' => 'acc',  'key_' => 'lldpRemSysName[0.7.1]', 'lastvalue' => 'core', 'src' => 'lldp'],
    ['hostid' => 'acc',  'key_' => 'lldpRemSysName[0.8.1]', 'lastvalue' => 'core', 'src' => 'lldp'],
];
$rInc = LldpEdgeBuilder::build($hLag, $rawInc,
    ['acc' => ['0.7.1' => ['desc' => 'uplink one'], '0.8.1' => ['desc' => 'uplink two']]]);
check('unvergleichbare Labels: trotzdem zwei, nicht vier', count($rInc['edges']), 2);
check('unvergleichbare Labels: beide bestaetigt',
    count(array_filter($rInc['edges'], static fn($e) => $e['confirmed'] === true)), 2);

// Ein Kabel beidseitig: bleibt eine Kante, auch mit unvergleichbaren Labels.
$rOne = LldpEdgeBuilder::build($hLag, [
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => 'acc',  'src' => 'lldp'],
    ['hostid' => 'acc',  'key_' => 'lldpRemSysName[0.7.1]', 'lastvalue' => 'core', 'src' => 'lldp'],
]);
check('ein Kabel, zwei Melder: eine Kante',        count($rOne['edges']), 1);

// LLDP und CDP nummerieren denselben lokalen Port verschieden
// (lldpRemLocalPortNum 1, cdpCacheIfIndex 10101) — dasselbe Kabel.
$rMix = LldpEdgeBuilder::build($hLag, [
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.1.1]',   'lastvalue' => 'acc', 'src' => 'lldp'],
    ['hostid' => 'core', 'key_' => 'cdpCacheDeviceId[10101.1]', 'lastvalue' => 'acc', 'src' => 'cdp'],
]);
check('LLDP+CDP, andere Nummerierung: eine Kante', count($rMix['edges']), 1);
check('LLDP+CDP: beide Quellen an der Kante',      $rMix['edges'][0]['src'] ?? null, ['cdp', 'lldp']);

// Zwei Eintraege desselben Ports (z.B. neuer lldpRemIndex nach Flap):
// derselbe Port, also dasselbe Kabel.
$rSame = LldpEdgeBuilder::build($hLag, [
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => 'acc', 'src' => 'lldp'],
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.1.2]', 'lastvalue' => 'acc', 'src' => 'lldp'],
]);
check('gleicher Port, neuer RemIndex: eine Kante', count($rSame['edges']), 1);

// Ohne Port-Bezug (Comma-Liste, kein Bracket): altes Verhalten, eine Kante.
$rNoPort = LldpEdgeBuilder::build($hLag, [
    ['hostid' => 'core', 'key_' => 'lldpRemSysName', 'lastvalue' => 'acc', 'src' => 'lldp'],
    ['hostid' => 'core', 'key_' => 'lldpRemSysName', 'lastvalue' => 'acc', 'src' => 'cdp'],
]);
check('ohne Port: eine Kante wie bisher',          count($rNoPort['edges']), 1);

// Regel 4 / Gegenprobe zur FALSCHEN Aufspaltung: derselbe Melder meldet
// denselben Nachbarn ueber dasselbe Protokoll erst OHNE Port (skalares
// lldpRemSysName) und dann MIT Port. Das ist dasselbe Kabel, nicht zwei.
// Vorher haengte die Zahl an der Item-Reihenfolge: portlos-dann-geportet
// gab zwei, die umgekehrte Reihenfolge eine. Beide Richtungen pruefen.
$rMixedA = LldpEdgeBuilder::build($hLag, [
    ['hostid' => 'core', 'key_' => 'lldpRemSysName',         'lastvalue' => 'acc', 'src' => 'lldp'],
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.1.1]',  'lastvalue' => 'acc', 'src' => 'lldp'],
]);
check('portlos dann geportet: eine Kante',         count($rMixedA['edges']), 1);
$rMixedB = LldpEdgeBuilder::build($hLag, [
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.1.1]',  'lastvalue' => 'acc', 'src' => 'lldp'],
    ['hostid' => 'core', 'key_' => 'lldpRemSysName',         'lastvalue' => 'acc', 'src' => 'lldp'],
]);
check('geportet dann portlos: eine Kante',         count($rMixedB['edges']), 1);
// Der portlose Bericht nimmt aber nur die ERSTE geportete Meldung auf; ein
// echtes zweites Kabel (anderer Port) spaltet danach korrekt wieder ab —
// Regel 4 darf keine echten LAG-Member verschlucken.
$rMixedC = LldpEdgeBuilder::build($hLag, [
    ['hostid' => 'core', 'key_' => 'lldpRemSysName',         'lastvalue' => 'acc', 'src' => 'lldp'],
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.1.1]',  'lastvalue' => 'acc', 'src' => 'lldp'],
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.2.1]',  'lastvalue' => 'acc', 'src' => 'lldp'],
]);
check('portlos + zwei Ports: zwei Kanten',         count($rMixedC['edges']), 2);

// nt:uplink auf einem Member-Port landet an DIESEM Member.
$eUp = LldpEdgeBuilder::uplinkEdges($hLag, ['acc' => ['host' => 'core', 'port' => '2']],
    $rLag['edges']);
$tagged = array_values(array_filter($eUp, static fn($e) => in_array('tag', $e['src'], true)));
check('uplink: keine neue Kante',                  count($eUp), 2);
check('uplink: am Member mit dem Port',            $tagged[0]['ports']['core'] ?? null, 'Gi1/0/2');

// Dasselbe Tag in Langform: "GigabitEthernet1/0/2" ist derselbe Port wie
// "Gi1/0/2" auf der Kante. Byteweise verglichen landete das Tag am ersten
// Member — also am falschen Kabel.
$eUpL = LldpEdgeBuilder::uplinkEdges($hLag,
    ['acc' => ['host' => 'core', 'port' => 'GigabitEthernet1/0/2']], $rLag['edges']);
$taggedL = array_values(array_filter($eUpL, static fn($e) => in_array('tag', $e['src'], true)));
check('uplink: Langform trifft denselben Member',  $taggedL[0]['ports']['core'] ?? null, 'Gi1/0/2');

// Regel 3 in findMember() ordnet zu, OHNE die Ports vergleichen zu koennen:
// ein Bericht, den dieser Melder mit diesem Protokoll noch nicht abgegeben
// hat, gehoert "wohl" zu einem der bekannten Kabel. Meldet core zwei Member
// per LLDP und ein DRITTES Kabel nur per CDP, faellt der CDP-Bericht damit
// auf Member 1 — und das Ueberschreiben des eigenen Portnamens wuerde dort
// "Gi1/0/3" eintragen. Der ifIndex auf der Kante sagt, dass das nicht sein
// kann.
$rMix = LldpEdgeBuilder::build($hLag, [
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.1.1]', 'lastvalue' => 'acc', 'src' => 'lldp'],
    ['hostid' => 'core', 'key_' => 'lldpRemSysName[0.2.1]', 'lastvalue' => 'acc', 'src' => 'lldp'],
    ['hostid' => 'core', 'key_' => 'cdpCacheDeviceId[3.1]', 'lastvalue' => 'acc', 'src' => 'cdp'],
], [], [], [], [], [], [],
    ['core' => ['1' => 'Gi1/0/1', '2' => 'Gi1/0/2', '3' => 'Gi1/0/3']]);
$mixPorts = array_map(static fn($e) => $e['ports']['core'] ?? null, $rMix['edges']);
sort($mixPorts);
check('Member-Label: fremder Port stempelt nicht um', $mixPorts, ['Gi1/0/1', 'Gi1/0/2']);
check('Member-Label: eigener ifIndex bleibt stehen',
    $rMix['edges'][0]['port_idx']['core'] ?? null, '1');

// ── Der Port, an dem ein GEIST haengt ─────────────────────────────────────
//
// "An welchem Port haengt das Ding?" ist die Frage, mit der Leute dieses
// Modul suchen — und sie stellt sich am haeufigsten fuer Geraete, die KEIN
// Zabbix-Host sind. Fuer die gab es den Port bisher nirgends: ohne
// aufgeloesten Host entsteht keine Kante, auf der er landen koennte.
//
// Beide Werte stehen im unmatched-Eintrag:
//   port        — Port am MELDER ("dort muss man hin, um das Kabel zu ziehen")
//   remote_port — der Port, den der Nachbar selbst nennt; fehlt oft, weil ein
//                 unueberwachtes Geraet seinen Portnamen nicht melden muss.
echo "\n  Geist: an welchem Port er haengt\n\n";

$hGeist = [
    ['hostid' => 'sw1', 'host' => 'lab-sw-01', 'name' => 'lab-sw-01', 'interfaces' => []],
];
$rGeist = LldpEdgeBuilder::build(
    $hGeist,
    [
        // Nachbar an Port 8, den Zabbix nicht kennt -> Geist
        ['hostid' => 'sw1', 'key_' => 'lldpRemSysName[0.8.1]',
         'lastvalue' => 'sw-edge-03', 'src' => 'lldp'],
        // Nachbar ohne Portbezug -> Geist ohne Port
        ['hostid' => 'sw1', 'key_' => 'lldpRemSysName',
         'lastvalue' => 'drucker-og', 'src' => 'lldp'],
    ],
    ['sw1' => ['0.8.1' => ['desc' => 'uplink1']]],     // lldp_ports -> remote_port
    [], [], [], [], [],
    ['sw1' => ['8' => 'Gi1/0/8']]                      // port_names -> port
);

$uGeist = $rGeist['quality']['sw1']['unmatched'] ?? [];
$nachRaw = [];
foreach ($uGeist as $e) {
    $nachRaw[$e['raw']] = $e;
}

check('beide Nachbarn bleiben unmatched',    count($uGeist), 2);
check('Port am Melder steht im Eintrag',
    $nachRaw['sw-edge-03']['port'] ?? null, 'Gi1/0/8');
check('Port des Nachbarn steht daneben',
    $nachRaw['sw-edge-03']['remote_port'] ?? null, 'uplink1');
// Kein Portbezug heisst KEIN Schluessel — nicht ein leerer. Ein leerer Wert
// wuerde im Frontend als "Port bekannt, Name leer" gelesen, und daraus wird
// in der Spalte ein Melder mit haengendem Trennzeichen.
check('ohne Portbezug: kein port-Schluessel',
    array_key_exists('port', $nachRaw['drucker-og'] ?? []), false);
check('ohne Portbezug: kein remote_port',
    array_key_exists('remote_port', $nachRaw['drucker-og'] ?? []), false);
check('und keine Kante aus beiden',          count($rGeist['edges']), 0);

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
