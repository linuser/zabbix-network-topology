<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\NodePositions::sanitize().
 *
 * sanitize() ist die einzige Stelle, an der die Kartenanordnung aus dem Browser
 * ins Backend gelangt. Von dort wandert sie in module.config bzw. CProfile und
 * spaeter wieder als Cytoscape-Positionen und Element-IDs in den DOM.
 *
 * Drei Regeln, die man leicht uebersieht:
 *
 *   - Der VIEW-KEY ist Teil der Struktur, nicht nur ein Name. Er besteht aus
 *     sortierten Group-IDs, optional mit "_grp" fuer die Group-View. Alles
 *     andere gehoert nicht hinein — waere er frei waehlbar, koennte ein Client
 *     module.config mit beliebigen Schluesseln vollschreiben.
 *   - Koordinaten werden auf GANZZAHLEN gerundet. Nachkommastellen sind bei
 *     Pixelpositionen bedeutungslos und blaehen das JSON auf, das bei grossen
 *     Karten in viele CProfile-Zeilen zerlegt wird.
 *   - Es gibt zwei Obergrenzen (Views und Knoten je View). Ohne sie waere die
 *     Action ein Fuellangriff auf die profiles- bzw. module-Tabelle.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — sanitize() ist statisch und ruehrt weder
 * API noch APP noch CProfile an.
 *
 * Aufruf:  php tests/NodePositionsTest.php
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

use Modules\NetworkTopology\Topology\NodePositions;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-50s got=%-16s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

/** Wie viele Views ueberleben? */
function views(array $in): int {
    return count(NodePositions::sanitize($in));
}

/** Wie viele Knoten ueberleben im ersten View? */
function nodes(array $in): int {
    $out = NodePositions::sanitize($in);
    return $out ? count(reset($out)) : 0;
}

function at($x, $y): array {
    return ['x' => $x, 'y' => $y];
}

// ── View-Keys ───────────────────────────────────────────────────────────────
check('Einzelne Gruppe',        views(['22' => ['1' => at(0, 5)]]), 1);
check('Mehrere Gruppen',        views(['22_25' => ['1' => at(0, 5)]]), 1);
check('Group-View-Suffix',      views(['22_25_grp' => ['1' => at(0, 5)]]), 1);
check('Leere Auswahl',          views(['' => ['1' => at(0, 5)]]), 1);
check('Buchstaben im Key',      views(['abc' => ['1' => at(0, 5)]]), 0);
check('Pfad im Key',            views(['../etc' => ['1' => at(0, 5)]]), 0);
check('Falsches Suffix',        views(['22_foo' => ['1' => at(0, 5)]]), 0);

// ── Knoten ──────────────────────────────────────────────────────────────────
check('Hostid',                 nodes(['22' => ['10084' => at(3, 4)]]), 1);
check('Ghost-Slug',             nodes(['22' => ['ghost_sw01' => at(3, 4)]]), 1);
check('Gruppen-Pseudoknoten',   nodes(['22' => ['grp_Fox' => at(3, 4)]]), 1);
check('HTML im Knotennamen',    nodes(['22' => ['<script>' => at(3, 4)]]), 0);
check('Leerzeichen',            nodes(['22' => ['a b' => at(3, 4)]]), 0);

// ── Koordinaten ─────────────────────────────────────────────────────────────
check('Fehlendes y',            nodes(['22' => ['1' => ['x' => 3]]]), 0);
check('Text statt Zahl',        nodes(['22' => ['1' => at('links', 4)]]), 0);
check('Kein Array',             nodes(['22' => ['1' => 'weg']]), 0);
check('Ausserhalb der Grenze',  nodes(['22' => ['1' => at(2000000, 0)]]), 0);
check('Negativ ist erlaubt',    nodes(['22' => ['1' => at(-500, -900)]]), 1);

$r = NodePositions::sanitize(['22' => ['1' => at(3.7, -2.2)]]);
check('Auf Ganzzahl gerundet: x', $r['22']['1']['x'], 4);
check('Auf Ganzzahl gerundet: y', $r['22']['1']['y'], -2);

// ── Leeres wird verworfen, nicht gespeichert ────────────────────────────────
check('View ohne gueltige Knoten', views(['22' => ['a b' => at(1, 1)]]), 0);
check('Leerer View',               views(['22' => []]), 0);

// ── Obergrenzen ─────────────────────────────────────────────────────────────
$many = [];
for ($i = 0; $i < 6000; $i++) {
    $many['n' . $i] = at($i, $i);
}
check('Knoten-Cap bei 5000',    nodes(['22' => $many]), 5000);

$manyViews = [];
for ($i = 0; $i < 60; $i++) {
    $manyViews[(string) $i] = ['1' => at(1, 1)];
}
check('View-Cap bei 50',        views($manyViews), 50);

echo $failures === 0
    ? "\n  NodePositionsTest: alle Pruefungen bestanden\n"
    : "\n  NodePositionsTest: {$failures} Fehler\n";

exit($failures === 0 ? 0 : 1);
