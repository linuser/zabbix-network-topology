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

// ── Alterung ───────────────────────────────────────────────────────────────
//
// LLDP-Tabellen haben Aussetzer. Ohne Frist sprang die Karte bei jedem davon:
// Kante weg, Toast, naechster Poll, Kante wieder da, Toast. Nach dem dritten
// Fehlalarm ignoriert man die Meldung — dann ist sie wertlos.

echo "\nLabel-Wechsel ist kein Umstecken\n";

// Wechselwirkung zweier Aenderungen aus 5.3: die Portbezeichnung kommt jetzt
// aus ifName statt aus dem ifIndex. Faellt dieses Item aus, steht wieder "9"
// statt "Gi1/0/9" — ohne dass jemand ein Kabel angefasst hat. Ueber Labels
// verglichen gaebe das einen falschen Alarm, und der schickt jemanden in den
// Serverraum.
$mitIdx = static function (string $lbl) {
    return ['h1|h2' => ['a'=>'SW01','b'=>'AP-07','pa'=>$lbl,'pb'=>'eth0','ia'=>'9','ib'=>'2']];
};
$dL = TopoDiff::compare($mitIdx('Gi1/0/9'), $mitIdx('9'));
check('Label wechselt, Index gleich -> kein Alarm', count($dL['moved']), 0);

// Aendert sich der INDEX, ist es echt.
$echt = ['h1|h2' => ['a'=>'SW01','b'=>'AP-07','pa'=>'Gi1/0/22','pb'=>'eth0','ia'=>'22','ib'=>'2']];
$dE = TopoDiff::compare($mitIdx('Gi1/0/9'), $echt);
check('Index wechselt -> Bewegung',                count($dE['moved']), 1);

// Ohne Index auf beiden Seiten bleibt der Label-Vergleich als Rueckfall.
$ohneIdx = static function (string $lbl) {
    return ['h1|h2' => ['a'=>'SW01','b'=>'AP-07','pa'=>$lbl,'pb'=>'eth0']];
};
$dR = TopoDiff::compare($ohneIdx('Gi1/0/18'), $ohneIdx('Gi1/0/22'));
check('ohne Index -> Label entscheidet',           count($dR['moved']), 1);

echo "\nRueckkehr einer Kante\n";

// Eine Kante, die weg war und zurueckkommt, ist eine Nachricht. Sonst
// widersprechen sich Karte (badged sie als neu) und Toast (schwiege).
$eR  = TopoDiff::snapshot([$edge('h1', 'h2', 'Gi1/0/18', 'eth0')], $label);
$r1  = TopoDiff::ageOut(TopoDiff::ageOut(null, $eR, 100, 900)['store'], [], 200, 900);
check('vorher: Eintrag ist alternd',   $r1['store']['h1|h2']['stale'] ?? null, true);
$dRk = TopoDiff::compare($r1['store'], $eR);
check('Rueckkehr wird als neu gemeldet', count($dRk['added']), 1);

echo "\nAlterung\n";

$e1  = TopoDiff::snapshot([$edge('h1', 'h2', 'Gi1/0/18', 'eth0')], $label);
$T   = 900;

// Erster Lauf: alles frisch, nichts alternd.
$a1 = TopoDiff::ageOut(null, $e1, 1000, $T);
check('erster Lauf -> nichts alternd',       count($a1['stale']), 0);
check('erster Lauf -> im Speicher',          count($a1['store']), 1);
check('Zeitstempel gesetzt',                 $a1['store']['h1|h2']['seen'], 1000);

// Kante faellt aus, kurz danach: alternd, bleibt auf der Karte.
$a2 = TopoDiff::ageOut($a1['store'], [], 1100, $T);
check('kurz weg -> alternd',                 count($a2['stale']), 1);
check('alternd -> bleibt im Speicher',       count($a2['store']), 1);
check('alternd -> markiert',                 $a2['store']['h1|h2']['stale'] ?? null, true);
check('alternd -> Zeitstempel NICHT erneuert', $a2['store']['h1|h2']['seen'], 1000);

// Immer noch weg, aber jetzt zu lange.
$a3 = TopoDiff::ageOut($a2['store'], [], 1000 + $T + 1, $T);
check('zu alt -> endgueltig weg',            count($a3['stale']), 0);
check('zu alt -> auch aus dem Speicher',     count($a3['store']), 0);

// Kommt sie zurueck, ist sie wieder frisch und nicht mehr markiert.
$a4 = TopoDiff::ageOut($a2['store'], $e1, 1200, $T);
check('zurueck -> nicht mehr alternd',       count($a4['stale']), 0);
check('zurueck -> Zeitstempel erneuert',     $a4['store']['h1|h2']['seen'], 1200);
check('zurueck -> Markierung weg',           isset($a4['store']['h1|h2']['stale']), false);

// DIE WIEDERHOLUNGSFALLE: eine alternde Kante steht noch im Speicher. Ohne
// Markierung faende compare() sie bei JEDEM Poll erneut als verschwunden und
// meldete sie wieder und wieder.
$d1 = TopoDiff::compare($a1['store'], []);
check('Verschwinden wird EINMAL gemeldet',   count($d1['removed']), 1);
$d2 = TopoDiff::compare($a2['store'], []);
check('alternde Kante nicht erneut gemeldet', count($d2['removed']), 0);

// Altbestand ohne Zeitstempel darf nicht wiederbelebt werden — sonst zoege
// die erste Abfrage nach einem Update jede laengst tote Kante zurueck.
$altbestand = ['h1|h2' => ['a'=>'SW01','b'=>'AP-07','pa'=>'','pb'=>'']];
$a5 = TopoDiff::ageOut($altbestand, [], 5000, $T);
check('ohne Zeitstempel -> nicht alternd',   count($a5['stale']), 0);
check('ohne Zeitstempel -> nicht behalten',  count($a5['store']), 0);

echo "\nNeu aufgetauchte Kanten\n";

// Gegenstueck zur Alterung: eine neue Kante ist eine Weile als neu erkennbar.
// OHNE Baseline ist nichts neu — sonst leuchtete beim ersten Poll die ganze
// Karte gruen, und ohne APCu (NtCache liefert dann immer null) dauerhaft.
$n0 = TopoDiff::ageOut(null, $e1, 2000, $T);
check('ohne Baseline -> nichts ist neu',     isset($n0['store']['h1|h2']['first']), false);

// Mit Baseline: eine Kante, die vorher nicht da war, ist neu.
$leer = TopoDiff::ageOut(null, [], 1900, $T);
$n1   = TopoDiff::ageOut($leer['store'], $e1, 2000, $T);
check('erstes Auftauchen -> first gesetzt',  $n1['store']['h1|h2']['first'], 2000);

// Bleibt sie, bleibt auch der erste Zeitpunkt stehen — sonst waere jede Kante
// bei jedem Poll wieder neu.
$n2 = TopoDiff::ageOut($n1['store'], $e1, 2500, $T);
check('bleibt bestehen -> first unveraendert', $n2['store']['h1|h2']['first'], 2000);
check('bleibt bestehen -> seen erneuert',      $n2['store']['h1|h2']['seen'],  2500);

// War sie weg und kommt zurueck, ist sie WIEDER neu — sonst bliebe eine
// wiederhergestellte Verbindung unbemerkt.
$n3 = TopoDiff::ageOut($n1['store'], [],  2100, $T);   // wird alternd
$n4 = TopoDiff::ageOut($n3['store'], $e1, 2200, $T);   // kommt zurueck
check('zurueck nach Ausfall -> wieder neu',    $n4['store']['h1|h2']['first'], 2200);

// Der Diff nennt den Schluessel, sonst findet die Karte die Kante nicht.
$dk = TopoDiff::compare($e1, TopoDiff::snapshot([$edge('h1','h3')], $label));
check('added traegt den Schluessel',           $dk['added'][0]['k'] ?? null,   'h1|h3');
check('removed traegt den Schluessel',         $dk['removed'][0]['k'] ?? null, 'h1|h2');

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
