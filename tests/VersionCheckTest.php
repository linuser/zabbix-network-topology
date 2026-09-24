<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\VersionCheck.
 *
 * Die manuelle Update-Abfrage besteht aus zwei Teilen: einem HTTP-Aufruf zu
 * GitHub, der sich ohne Netz nicht testen laesst, und diesem Vergleich, der
 * sich testen laesst und der Teil ist, der schiefgeht.
 *
 * Der klassische Fehler: "5.10.0" gegen "5.9.0" mit strcmp. Als Zeichenkette
 * ist 5.10.0 KLEINER, weil '1' vor '9' kommt — ab der zehnten Minor-Version
 * meldet so eine Pruefung nie wieder ein Update, und zwar stumm. Genau
 * dieser Fall steht unten zuerst.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP.
 *
 * Aufruf:  php tests/VersionCheckTest.php
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

use Modules\NetworkTopology\Topology\VersionCheck;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-56s got=%-12s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

echo "\nVersionCheck — der Vergleich, der sonst still falsch liegt\n\n";

// Der Fall, wegen dem es diese Klasse gibt.
check('5.10.0 ist neuer als 5.9.0',   VersionCheck::istNeuer('5.9.0', '5.10.0'), true);
check('5.9.0 ist NICHT neuer als 5.10.0', VersionCheck::istNeuer('5.10.0', '5.9.0'), false);
check('zweistellig auch im Patch',    VersionCheck::istNeuer('5.4.9', '5.4.10'), true);

echo "\nGleichstand und Alltag\n\n";
check('gleiche Version: kein Update', VersionCheck::istNeuer('5.4.0', '5.4.0'), false);
check('Patch hoeher',                 VersionCheck::istNeuer('5.4.0', '5.4.1'), true);
check('Minor hoeher',                 VersionCheck::istNeuer('5.4.1', '5.5.0'), true);
check('Major hoeher',                 VersionCheck::istNeuer('5.4.1', '6.0.0'), true);
check('aeltere Version meldet nichts', VersionCheck::istNeuer('5.4.0', '5.3.2'), false);
check('fehlende Stelle zaehlt als 0', VersionCheck::vergleiche('5.4', '5.4.0'), 0);

echo "\nVorabversionen\n\n";
// Wer 5.4.0 faehrt, soll nicht auf einen Release Candidate gestossen werden:
// ein rc ist kein Update, das man einem Produktionssystem meldet.
check('rc wird nicht als Update gemeldet', VersionCheck::istNeuer('5.4.0', '5.5.0-rc1'), false);
check('rc ist aelter als die fertige',     VersionCheck::vergleiche('5.5.0-rc1', '5.5.0'), -1);
check('wer rc faehrt, bekommt die fertige', VersionCheck::istNeuer('5.5.0-rc1', '5.5.0'), true);

echo "\nWas hereinkommt, ist fremder Text\n\n";
// Der Tag-Name kommt von GitHub. Was wir nicht verstehen, ist kein Update —
// lieber "nicht ermittelbar" als eine geratene Zahl.
check('v-Praefix faellt weg',         VersionCheck::normalisiere('v5.4.0'), '5.4.0');
check('grosses V auch',               VersionCheck::normalisiere('V5.4.0'), '5.4.0');
check('Leerraum faellt weg',          VersionCheck::normalisiere('  5.4.0 '), '5.4.0');
check('Vorab bleibt erhalten',        VersionCheck::normalisiere('v5.5.0-rc1'), '5.5.0-rc1');
check('Buchstabensalat: leer',        VersionCheck::normalisiere('nightly'), '');
check('leer bleibt leer',             VersionCheck::normalisiere(''), '');
check('ueberlang: leer',              VersionCheck::normalisiere(str_repeat('9.', 40)), '');
check('unverstandenes ist kein Update', VersionCheck::istNeuer('5.4.0', ''), false);
check('ohne lokale Version kein Update', VersionCheck::istNeuer('', '9.9.9'), false);

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
