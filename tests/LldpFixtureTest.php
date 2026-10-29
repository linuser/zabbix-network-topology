<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * LLDP-Fixture-Bibliothek — Regressionstest fuer Topology\LldpEdgeBuilder.
 *
 * Das Nachbar-Matching ist die heikelste Zuordnung im Modul und voller
 * Hersteller-Eigenheiten (jeder Switch meldet Namen und Ports anders). Ein Fix
 * fuer einen Vendor darf einen anderen nicht brechen. Darum: echte/erfundene
 * SNMP-Ausgaben als Fixtures in `tests/fixtures/lldp/*.json`, gegen die der
 * Parser laeuft. Form einer Fixture = genau die Item-Zeilen, die
 * LldpEdgeBuilderTest von Hand aufbaut — nur als Datei, damit eine Meldung
 * dauerhaft ein Test wird (Meldung → Fixture → Regressionstest).
 *
 * Neue Fixture: eine JSON-Datei ins Verzeichnis legen (Format siehe unten),
 * fertig — dieser Test findet sie automatisch. Laeuft in `ci:test` mit
 * (globt `tests/*Test.php`). Kein DB/HTTP/Zabbix, nur PHP.
 *
 * Fixture-Format:
 *   {
 *     "name": "…", "vendor": "…", "source": "hand-built|lab, anonymised",
 *     "description": "…",
 *     "hosts":      { "<hid>": {"host":"…","name":"…"}, … },
 *     "lldp_raw":   [ {"hostid":"…","key_":"lldpRemSysName[…]","lastvalue":"…","src":"lldp"}, … ],
 *     "lldp_ports": { "<hid>": { "<remIndex>": {"id":"…","desc":"…"} } },   // optional
 *     "port_names":   { "<hid>": { "<ifIndex>": "Gi1/0/1" } },    // optional (Port-Normalisierung)
 *     "port_traffic": { "<hid>": { "<ifIndex>": {"in":…,"out":…} } },  // optional
 *     "port_speed":   { "<hid>": { "<ifIndex>": 1000000000 } },   // optional
 *     "port_stp":     { "<hid>": { "<ifIndex>": 2 } },            // optional (2=blocking)
 *     "expect": {
 *       "edges":              [ {"a":"<hid>","b":"<hid>"}, … ],   // muessen existieren
 *       "no_edges":           [ {"a":"…","b":"…"}, … ],           // optional: duerfen NICHT
 *       "edge_count":         2,                                   // optional
 *       "unmatched_contains": ["printer-xyz"],                     // optional
 *       "ports":              [ {"a":"…","b":"…","aPort":"8","bPort":"nic0","match":"normalized"} ]  // optional
 *     }
 *   }
 *
 * Aufruf:  php tests/LldpFixtureTest.php
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
    printf("  [%s] %-56s got=%-14s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

/** Kante zwischen zwei Hosts (Richtung egal) oder null. */
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

echo "LLDP-Fixture-Bibliothek\n";

$dir   = __DIR__ . '/fixtures/lldp';
$files = glob($dir . '/*.json') ?: [];
sort($files);

if (!$files) {
    fwrite(STDERR, "Keine Fixtures in $dir\n");
    exit(1);
}

$n_fixtures = 0;
foreach ($files as $file) {
    $raw = file_get_contents($file);
    $fx  = json_decode((string) $raw, true);
    if (!is_array($fx)) {
        $failures++;
        fwrite(STDERR, "  [FAIL] " . basename($file) . ": kein gueltiges JSON\n");
        continue;
    }
    $n_fixtures++;

    $label = ($fx['name'] ?? basename($file))
        . (isset($fx['vendor']) ? ' — ' . $fx['vendor'] : '');
    echo "\n" . $label . "\n";

    $r = LldpEdgeBuilder::build(
        $fx['hosts']        ?? [],
        $fx['lldp_raw']     ?? [],
        $fx['lldp_ports']   ?? [],
        $fx['port_traffic'] ?? [],
        $fx['port_speed']   ?? [],
        port_names: $fx['port_names'] ?? [],
        port_stp:   $fx['port_stp']   ?? []
    );
    $edges = $r['edges'] ?? [];
    $exp   = $fx['expect'] ?? [];

    foreach ($exp['edges'] ?? [] as $pair) {
        check('edge ' . $pair['a'] . '–' . $pair['b'] . ' exists',
            findEdge($edges, (string) $pair['a'], (string) $pair['b']) !== null, true);
    }
    foreach ($exp['no_edges'] ?? [] as $pair) {
        check('NO edge ' . $pair['a'] . '–' . $pair['b'],
            findEdge($edges, (string) $pair['a'], (string) $pair['b']) === null, true);
    }
    if (isset($exp['edge_count'])) {
        check('edge count', count($edges), (int) $exp['edge_count']);
    }
    foreach ($exp['unmatched_contains'] ?? [] as $needle) {
        $hay = strtolower(json_encode($r['unmatched'] ?? []));
        check('unmatched contains "' . $needle . '"',
            strpos($hay, strtolower((string) $needle)) !== false, true);
    }
    foreach ($exp['ports'] ?? [] as $pa) {
        $e = findEdge($edges, (string) $pa['a'], (string) $pa['b']) ?? [];
        if (array_key_exists('aPort', $pa)) {
            check('port ' . $pa['a'] . ' on ' . $pa['a'] . '–' . $pa['b'],
                $e['ports'][(string) $pa['a']] ?? null, $pa['aPort']);
        }
        if (array_key_exists('bPort', $pa)) {
            check('port ' . $pa['b'] . ' on ' . $pa['a'] . '–' . $pa['b'],
                $e['ports'][(string) $pa['b']] ?? null, $pa['bPort']);
        }
        if (array_key_exists('match', $pa)) {
            check('port_match on ' . $pa['a'] . '–' . $pa['b'],
                $e['port_match'] ?? null, $pa['match']);
        }
    }
}

echo "\n";
if ($failures > 0) {
    fwrite(STDERR, "FAIL: $failures ($n_fixtures Fixtures)\n");
    exit(1);
}
echo "alle gruen ($n_fixtures Fixtures)\n";
