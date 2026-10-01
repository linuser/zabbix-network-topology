<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\DiagLog.
 *
 * Der Anlass ist ein Fehler, der sich eine Stunde lang nicht zeigt und danach
 * nicht wie ein Fehler aussieht: Der Diagnose-Tab stand still. Die oberste
 * Zeile blieb dieselbe, waehrend die Zusammenfassung daneben drei neue
 * Aufrufe zaehlte — kein Hinweis, keine Meldung, nur eine Liste, die nicht
 * mehr mitkam.
 *
 * Die Ursache war die Sortierung nach der laufenden Nummer. apcu_inc nimmt
 * seine TTL nur beim Anlegen des Schluessels, der Zaehler laeuft also nach
 * einer Stunde ab und faengt wieder bei 1 an. Alles Neue traegt danach
 * kleinere Nummern als alles Alte und rutscht ans Ende.
 *
 * Genau dieser Fall steht unten zuerst. Er ist in der Oberflaeche praktisch
 * unsichtbar und in drei Zeilen nachstellbar.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP.
 *
 * Aufruf:  php tests/DiagLogTest.php
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

use Modules\NetworkTopology\Topology\DiagLog;

$fehler = 0;

function pruefe(string $was, $gegeben, $erwartet): void {
    global $fehler;
    $ok = json_encode($gegeben) === json_encode($erwartet);
    if (!$ok) {
        $fehler++;
    }
    printf("  [%s] %-52s %s\n", $ok ? 'PASS' : 'FAIL', $was,
        $ok ? '' : 'got=' . json_encode($gegeben) . ' want=' . json_encode($erwartet));
}

/** Nur die Aktionsnamen, in der Reihenfolge, die herauskam. */
function reihe(array $entries): array {
    return array_map(static fn(array $e): string => (string) $e['action'],
        DiagLog::nachZeitSortiert($entries));
}

echo "\n  DiagLog: die Reihenfolge haengt an der Zeit, nicht an der Nummer\n\n";

// ── Der Fall, der es ausgeloest hat ───────────────────────────────────────
// Drei alte Eintraege mit hohen Nummern, drei neue mit niedrigen: so sieht
// der Puffer aus, nachdem der Zaehler abgelaufen und neu angefangen hat.
$nachZaehlerreset = [
    ['action' => 'alt1', 'ts' => 1000, 'seq' => 148],
    ['action' => 'alt2', 'ts' => 1001, 'seq' => 149],
    ['action' => 'alt3', 'ts' => 1002, 'seq' => 150],
    ['action' => 'neu1', 'ts' => 5000, 'seq' => 1],
    ['action' => 'neu2', 'ts' => 5001, 'seq' => 2],
    ['action' => 'neu3', 'ts' => 5002, 'seq' => 3],
];
pruefe('nach Zaehlerreset stehen die neuen hinten',
    reihe($nachZaehlerreset), ['alt1', 'alt2', 'alt3', 'neu1', 'neu2', 'neu3']);

// Gegenprobe: nach der Nummer sortiert kaeme genau das Falsche heraus. Steht
// hier, damit der Test nicht nur bestaetigt, sondern auch zeigt, was er
// verhindert.
$nachNummer = $nachZaehlerreset;
usort($nachNummer, static fn(array $a, array $b): int => $a['seq'] <=> $b['seq']);
pruefe('(Gegenprobe) nach Nummer waere es verdreht',
    array_map(static fn(array $e): string => $e['action'], $nachNummer),
    ['neu1', 'neu2', 'neu3', 'alt1', 'alt2', 'alt3']);

// ── Zwei Zaehler, eine Zeitachse ──────────────────────────────────────────
// Seit die lauten Aufrufe ihren eigenen Zaehler haben, sind die Nummern
// zwischen den beiden Raeumen bedeutungslos. Die Zeit bleibt gemeinsam.
pruefe('zwei Zaehlerraeume mischen sich korrekt',
    reihe([
        ['action' => 'spark', 'ts' => 2000, 'seq' => 7],
        ['action' => 'data',  'ts' => 1999, 'seq' => 900],
        ['action' => 'spark', 'ts' => 2002, 'seq' => 8],
        ['action' => 'data',  'ts' => 2001, 'seq' => 901],
    ]),
    ['data', 'spark', 'data', 'spark']);

// ── Innerhalb einer Sekunde entscheidet die Nummer ────────────────────────
// Der Zeitstempel ist sekundengenau, und bei 1,2 MB je Aufruf passiert
// einiges in einer Sekunde. Ohne das zweite Kriterium waere die Reihenfolge
// dort beliebig.
pruefe('gleiche Sekunde: die Nummer entscheidet',
    reihe([
        ['action' => 'c', 'ts' => 42, 'seq' => 3],
        ['action' => 'a', 'ts' => 42, 'seq' => 1],
        ['action' => 'b', 'ts' => 42, 'seq' => 2],
    ]),
    ['a', 'b', 'c']);

// ── Fehlende Felder ───────────────────────────────────────────────────────
// Ein Eintrag aus einer aelteren Fassung des Moduls hat vielleicht kein 'ts'.
// Er darf die Sortierung nicht sprengen, sondern landet am Anfang.
pruefe('ohne Zeitstempel: ganz nach vorn, kein Fehler',
    reihe([
        ['action' => 'mitZeit', 'ts' => 10, 'seq' => 1],
        ['action' => 'ohne'],
    ]),
    ['ohne', 'mitZeit']);

pruefe('leere Liste bleibt leer', DiagLog::nachZeitSortiert([]), []);

echo "\n  DiagLog: welche Aufrufe ihren eigenen Ring bekommen\n\n";

pruefe('spark ist laut',            DiagLog::istLaut('spark'), true);
// data ist der teuerste Aufruf ueberhaupt — gerade der darf nie verdraengt
// werden, denn fuer ihn oeffnet man den Tab.
pruefe('data ist es nicht',         DiagLog::istLaut('data'), false);
pruefe('unbekanntes ist es nicht',  DiagLog::istLaut('gibtsnicht'), false);
pruefe('leerer Name ist es nicht',  DiagLog::istLaut(''), false);

echo "\n";
if ($fehler > 0) {
    fwrite(STDERR, "✖ {$fehler} Befund(e).\n");
    exit(1);
}
echo "✓ DiagLog sortiert nach der Zeit und trennt die lauten Aufrufe.\n";
