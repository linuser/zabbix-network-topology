<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\Revision.
 *
 * Die Revision entscheidet, ob ein Schreibvorgang durchgelassen oder als
 * Konflikt abgelehnt wird. Zwei Fehlerrichtungen, beide unangenehm:
 *
 *   zu streng  → falsche Konflikte. Zwei Clients, die inhaltlich dasselbe
 *                gespeichert haben, bekaemen "wurde anderswo geaendert" und
 *                verloeren das Vertrauen in die Meldung.
 *   zu locker  → gar kein Schutz, der Fall von vorher.
 *
 * Deshalb pruefen die Faelle unten vor allem die Normalisierung: Reihenfolge
 * darf nicht zaehlen, Inhalt schon.
 *
 * Aufruf:  php tests/RevisionTest.php
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

use Modules\NetworkTopology\Topology\Revision;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-52s got=%-12s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

$a = [['s' => '1', 't' => '2'], ['s' => '3', 't' => '4']];
$b = [['s' => '3', 't' => '4'], ['s' => '1', 't' => '2']];   // andere Reihenfolge
$c = [['s' => '1', 't' => '2'], ['s' => '3', 't' => '9']];   // anderer Inhalt

echo "\n  Revision — Kanten\n\n";
check('gleiche Menge, gleiche Revision',      Revision::of($a) === Revision::of($a), true);
check('Reihenfolge egal',                     Revision::of($a) === Revision::of($b), true);
check('anderer Inhalt, andere Revision',      Revision::of($a) === Revision::of($c), false);
check('leer != nicht leer',                   Revision::of([])  === Revision::of($a), false);
check('Laenge 16',                            strlen(Revision::of($a)), 16);

$p1 = ['2' => ['10' => ['x' => 1, 'y' => 2], '11' => ['x' => 3, 'y' => 4]]];
$p2 = ['2' => ['11' => ['x' => 3, 'y' => 4], '10' => ['x' => 1, 'y' => 2]]];  // Map umsortiert
$p3 = ['2' => ['10' => ['x' => 1, 'y' => 9], '11' => ['x' => 3, 'y' => 4]]];  // y geaendert

echo "\n  Revision — Positionen\n\n";
check('Map-Reihenfolge egal',                 Revision::of($p1) === Revision::of($p2), true);
check('geaenderte Koordinate zaehlt',         Revision::of($p1) === Revision::of($p3), false);

echo "\n  Revision — matches()\n\n";
check('passende Revision wird akzeptiert',    Revision::matches(Revision::of($a), $a), true);
check('fremde Revision wird abgelehnt',       Revision::matches(Revision::of($c), $a), false);

// Alte Clients und der erste Speichervorgang nach einem Update kennen keine
// Revision. Die sollen nicht scheitern — der Schutz entfaellt dort, wo es
// ohnehin keine Erwartung gab.
check('leere Revision wird durchgelassen',    Revision::matches('', $a), true);
check('Muell wird abgelehnt',                 Revision::matches('deadbeef', $a), false);

// Ungueltiges UTF-8 darf die Revision nicht kollabieren lassen.
//
// Ohne JSON_INVALID_UTF8_SUBSTITUTE gibt json_encode() hier `false` zurueck,
// hash() sieht den leeren String — und ZWEI verschiedene Staende bekommen
// dieselbe Revision. matches() sagt dann "passt", und der zweite Benutzer
// ueberschreibt den ersten stillschweigend. Das ist genau der Fall, den diese
// Klasse verhindern soll, und er faellt sonst nirgends auf: es gibt keine
// Fehlermeldung, nur einen verlorenen Speichervorgang.
//
// Heute kann das ueber die Sanitizer nicht passieren, morgen vielleicht schon.
echo "\n  Revision — ungueltiges UTF-8\n\n";
$u1 = ['n' => ['a' => "x" . chr(0xFF)]];
$u2 = ['n' => ['a' => "y" . chr(0xFE)]];
check('Revision ist nicht leer',              Revision::of($u1) !== '', true);
check('16 Hex-Zeichen wie sonst auch',        strlen(Revision::of($u1)), 16);
check('Staende mit gueltigem Unterschied bleiben unterscheidbar',
                                              Revision::of($u1) === Revision::of($u2), false);
check('sich selbst erkennt sie weiterhin',    Revision::matches(Revision::of($u1), $u1), true);

// DIE GRENZE DES VERFAHRENS, ausdruecklich festgehalten.
//
// JSON_INVALID_UTF8_SUBSTITUTE bildet JEDES ungueltige Byte auf dasselbe
// U+FFFD ab. Zwei Staende, die sich NUR in ungueltigen Bytes unterscheiden,
// bekommen deshalb dieselbe Revision — die Konflikterkennung sieht sie als
// gleich an.
//
// Die erste Fassung dieses Tests behauptete mehr, als sie pruefte: ihre
// beiden Vorlagen unterschieden sich auch im gueltigen Teil ("x" gegen "y"),
// also waere sie selbst ohne das Flag durchgelaufen.
//
// Praktisch ist das heute folgenlos, weil die Sanitizer als Node-ID nur
// ASCII durchlassen — ungueltige Bytes erreichen Revision gar nicht. Es steht
// hier, damit die Annahme SICHTBAR ist: faellt sie irgendwann, faellt dieser
// Test auf und nicht ein Benutzer.
$g1 = ['n' => ['a' => "x" . chr(0xFF)]];
$g2 = ['n' => ['a' => "x" . chr(0xFE)]];
check('bekannte Grenze: nur ungueltige Bytes verschieden -> gleiche Revision',
                                              Revision::of($g1) === Revision::of($g2), true);

echo $failures === 0
    ? "\n  RevisionTest: alle Pruefungen bestanden\n"
    : "\n  RevisionTest: {$failures} Fehler\n";

exit($failures === 0 ? 0 : 1);
