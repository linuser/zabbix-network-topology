<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\TopoDiff.
 *
 * Der Diff meldet dem Nutzer, was sich im Netz geaendert hat. Faellt er falsch
 * aus, ist das teurer als eine fehlende Meldung: "SW01 umgesteckt" schickt
 * jemanden in den Serverraum. Zwei Fehlerarten sind hier moeglich, und beide
 * haben ihren eigenen Fall unten:
 *
 *   - zu WENIG: der Port-Wechsel faellt durchs Raster (war bis 5.3 so, weil
 *     der Schluessel nur aus dem Host-Paar bestand)
 *   - zu VIEL: nach einem Update stehen Alt-Eintraege ohne Ports in der
 *     Baseline, und jede Kante des Netzes wird als Bewegung gemeldet
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP.
 *
 * Aufruf:  php tests/TopoDiffTest.php
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

use Modules\NetworkTopology\Topology\TopoDiff;

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

$label = static function ($hid) {
    $map = ['h1' => 'SW01', 'h2' => 'AP-07', 'h3' => 'SW04'];
    return $map[(string) $hid] ?? (string) $hid;
};

/** Kante bauen: from/to plus optional die Ports beider Seiten. */
$edge = static function (string $a, string $b, string $pa = '', string $pb = ''): array {
    $ports = [];
    if ($pa !== '') $ports[$a] = $pa;
    if ($pb !== '') $ports[$b] = $pb;
    return ['from' => $a, 'to' => $b, 'ports' => $ports];
};

echo "\nSnapshot\n";

$snap = TopoDiff::snapshot([$edge('h1', 'h2', 'Gi1/0/18', 'eth0')], $label);
$k    = 'h1|h2';
check('Schluessel ist das sortierte Paar',  array_keys($snap), [$k]);
check('Label der einen Seite',              $snap[$k]['a'],  'SW01');
check('Port seitenrichtig zugeordnet',      $snap[$k]['pa'], 'Gi1/0/18');
check('Port der Gegenseite',                $snap[$k]['pb'], 'eth0');

// Die Internet-Wolke ist virtuell und wird pro Render neu injiziert — sie waere
// sonst bei jedem Layoutwechsel "neu".
$snapI = TopoDiff::snapshot([
    $edge('h1', 'h2'),
    ['from' => 'internet_root', 'to' => 'h1', '_isInternetEdge' => true],
], $label);
check('Internet-Kante zaehlt nicht mit',    count($snapI), 1);

echo "\nNeu und verschwunden\n";

$alt = TopoDiff::snapshot([$edge('h1', 'h2', 'Gi1/0/18', 'eth0')], $label);
$neu = TopoDiff::snapshot([$edge('h1', 'h3', 'Te1/1', 'Te1/48')], $label);
$d   = TopoDiff::compare($alt, $neu);

check('neue Kante gemeldet',                count($d['added']),   1);
check('verschwundene Kante gemeldet',       count($d['removed']), 1);
check('nichts als Bewegung gemeldet',       count($d['moved']),   0);
check('Namen der neuen Kante',              $d['added'][0]['b'],  'SW04');

echo "\nOhne Baseline\n";

$d0 = TopoDiff::compare(null, $neu);
check('erster Lauf meldet nichts',          count($d0['added']) + count($d0['removed']) + count($d0['moved']), 0);

echo "\nPort-Move — der Fall, der bis 5.3 durchfiel\n";

$vorher  = TopoDiff::snapshot([$edge('h1', 'h2', 'Gi1/0/18', 'eth0')], $label);
$nachher = TopoDiff::snapshot([$edge('h1', 'h2', 'Gi1/0/22', 'eth0')], $label);
$dm      = TopoDiff::compare($vorher, $nachher);

check('Paar unveraendert -> nicht added',   count($dm['added']),   0);
check('Paar unveraendert -> nicht removed', count($dm['removed']), 0);
check('aber als Bewegung gemeldet',         count($dm['moved']),   1);
check('nennt den betroffenen Host',         $dm['moved'][0]['ports'][0]['host'], 'SW01');
check('nennt den alten Port',               $dm['moved'][0]['ports'][0]['from'], 'Gi1/0/18');
check('nennt den neuen Port',               $dm['moved'][0]['ports'][0]['to'],   'Gi1/0/22');
check('nur die geaenderte Seite',           count($dm['moved'][0]['ports']),     1);

// Gar keine Aenderung darf auch nichts melden — sonst waere jeder Poll eine
// Bewegung.
$dg = TopoDiff::compare($vorher, $vorher);
check('identischer Stand meldet nichts',    count($dg['moved']),   0);

echo "\nAltbestand in der Baseline — die teure Fehlerart\n";

// Nach einem Update liegen in APCu noch Eintraege der ALTEN Form: numerisch
// indiziert [labelA, labelB], ohne Ports. Wuerde das als "Port von '' auf
// 'Gi1/0/18' gewechselt" gelesen, meldete die erste Abfrage nach dem Update
// JEDE Kante des Netzes als Bewegung.
$altesFormat = ['h1|h2' => ['SW01', 'AP-07']];
$dA = TopoDiff::compare($altesFormat, $vorher);

check('Alt-Eintrag ohne Ports -> keine Bewegung', count($dA['moved']),   0);
check('Alt-Eintrag -> auch nicht added',          count($dA['added']),   0);
check('Alt-Eintrag -> auch nicht removed',        count($dA['removed']), 0);

// Und umgekehrt: verschwindet eine Kante, deren Baseline-Eintrag noch alt ist,
// muss die Meldung trotzdem lesbare Namen tragen.
$dA2 = TopoDiff::compare($altesFormat, []);
check('altes Format -> Namen in removed',   $dA2['removed'][0]['a'], 'SW01');

echo "\nPort erstmals oder nicht mehr gemeldet\n";

// Ein leerer Wert auf einer Seite heisst "unbekannt", nicht "umgesteckt".
// Ein Geraet, das nach einem Template-Update erstmals Ports meldet, hat nichts
// am Kabel geaendert.
$ohnePort = TopoDiff::snapshot([$edge('h1', 'h2', '', 'eth0')], $label);
check('Port kommt neu dazu -> keine Bewegung',  count(TopoDiff::compare($ohnePort, $vorher)['moved']), 0);
check('Port faellt weg -> keine Bewegung',      count(TopoDiff::compare($vorher, $ohnePort)['moved']), 0);

echo "\nBeide Seiten umgesteckt\n";

$beide = TopoDiff::snapshot([$edge('h1', 'h2', 'Gi1/0/22', 'eth3')], $label);
$dB    = TopoDiff::compare($vorher, $beide);
check('zwei geaenderte Ports an einer Kante',   count($dB['moved'][0]['ports']), 2);

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
