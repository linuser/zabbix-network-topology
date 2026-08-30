<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\SharedLayerFilter.
 *
 * Die geteilte Karte liegt in module.config und kennt keine Zabbix-Rechte.
 * Dieser Filter ist die einzige Stelle, an der sie auf das eingeschraenkt
 * wird, was der aufrufende Benutzer sehen darf. Faellt eine Regel bei einem
 * Umbau weg, wandern fremde Host-IDs, Gruppen-IDs und per LLDP annoncierte
 * Geraetenamen wieder ins ausgelieferte HTML — sichtbar wird davon nichts,
 * und genau deshalb wuerde es niemandem auffallen.
 *
 * Laeuft ohne DB/Session/Zabbix: der Filter bekommt die sichtbaren IDs als
 * Array uebergeben und ruehrt selbst keine API an.
 *
 * Aufruf:  php tests/SharedLayerFilterTest.php
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

use Modules\NetworkTopology\Topology\SharedLayerFilter;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-54s got=%-22s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

// Sichtbar: Hosts 10084 und 10085, Gruppen 2 und 5.
// Nicht sichtbar: Host 99999, Gruppe 7.
$hosts  = ['10084' => 1, '10085' => 1];
$groups = ['2' => 1, '5' => 1];

function linkKeys(array $links): string {
    return implode(',', array_map(static function ($l) {
        return $l['s'] . '-' . $l['t'];
    }, $links));
}

echo "\n  SharedLayerFilter — Kanten\n\n";

check('beide sichtbar bleibt',
    linkKeys(SharedLayerFilter::links([['s' => '10084', 't' => '10085']], $hosts)),
    '10084-10085');

check('fremder Host faellt weg',
    linkKeys(SharedLayerFilter::links([['s' => '10084', 't' => '99999']], $hosts)),
    '');

check('beide fremd faellt weg',
    linkKeys(SharedLayerFilter::links([['s' => '99999', 't' => '88888']], $hosts)),
    '');

check('Ghost am sichtbaren Host bleibt',
    linkKeys(SharedLayerFilter::links([['s' => '10084', 't' => 'ghost_sw01']], $hosts)),
    '10084-ghost_sw01');

check('Ghost auch andersherum',
    linkKeys(SharedLayerFilter::links([['s' => 'ghost_sw01', 't' => '10084']], $hosts)),
    'ghost_sw01-10084');

// Ohne sichtbaren Anker ist nicht zu begruenden, warum der Benutzer diesen
// per LLDP annoncierten Namen sehen sollte.
check('Ghost zu Ghost faellt weg',
    linkKeys(SharedLayerFilter::links([['s' => 'ghost_a', 't' => 'ghost_b']], $hosts)),
    '');

check('Ghost am FREMDEN Host faellt weg',
    linkKeys(SharedLayerFilter::links([['s' => '99999', 't' => 'ghost_sw01']], $hosts)),
    '');

check('Muell ohne s/t faellt weg',
    count(SharedLayerFilter::links([['x' => 1], 'string', ['s' => '10084']], $hosts)),
    0);

echo "\n  SharedLayerFilter — Positionen\n\n";

$pos = [
    '2'      => ['10084' => ['x' => 1, 'y' => 1], '99999' => ['x' => 2, 'y' => 2]],
    '2_5'    => ['10085' => ['x' => 3, 'y' => 3]],
    '2_7'    => ['10084' => ['x' => 4, 'y' => 4]],
    '7'      => ['99999' => ['x' => 5, 'y' => 5]],
    '2_grp'  => ['10084' => ['x' => 6, 'y' => 6], 'ghost_sw01' => ['x' => 7, 'y' => 7]],
];
$got = SharedLayerFilter::positions($pos, $hosts, $groups);

check('View mit nur sichtbaren Gruppen bleibt', isset($got['2']), true);
check('fremder Knoten in der View faellt weg', isset($got['2']['99999']), false);
check('sichtbarer Knoten bleibt',              isset($got['2']['10084']), true);
check('View aus zwei sichtbaren Gruppen bleibt', isset($got['2_5']), true);

// Der Schluessel IST die Gruppenauswahl — eine fremde Gruppe darin verraet
// ihre Existenz, auch wenn kein einziger Knoten uebrig bliebe.
check('View mit EINER fremden Gruppe faellt ganz weg', isset($got['2_7']), false);
check('reine Fremd-View faellt weg',                   isset($got['7']), false);

check('Group-View (_grp) wird erkannt',   isset($got['2_grp']), true);
check('Ghost in erlaubter View bleibt',   isset($got['2_grp']['ghost_sw01']), true);

// Eine View, aus der alles herausfaellt, wird gar nicht erst mitgeschickt —
// sonst sagte der leere Schluessel weiterhin aus, dass es die Auswahl gibt.
$empty = SharedLayerFilter::positions(['5' => ['99999' => ['x' => 1, 'y' => 1]]], $hosts, $groups);
check('leergefilterte View faellt ganz weg', $empty, []);

echo $failures === 0
    ? "\n  SharedLayerFilterTest: alle Pruefungen bestanden\n"
    : "\n  SharedLayerFilterTest: {$failures} Fehler\n";

exit($failures === 0 ? 0 : 1);
