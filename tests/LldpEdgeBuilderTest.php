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

$r3    = LldpEdgeBuilder::build($hosts3, $lldp_raw3, $lldp_ports3, $port_traffic3, $port_speed3);
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
    'sw'  => ['host' => 'edd7d002-b7b6-3675-8663-608ae2466f0b', 'name' => 'HSINSW02'],
    'cli' => ['host' => '74f8d353-6b79-3645-81c1-9376cdc8ea42', 'name' => 'npu 2d:23'],
];
$rawU = [['hostid' => 'cli', 'key_' => 'uplink.id',
          'lastvalue' => 'edd7d002-b7b6-3675-8663-608ae2466f0b', 'src' => 'unifi']];
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

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
