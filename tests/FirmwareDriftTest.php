<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\FirmwareDrift.
 *
 * Die heikle Zusage ist "nie falsch warnen": zu kleine Gruppen, ein Gleichstand
 * ohne eindeutige Mehrheit oder unvollstaendige Inventory-Felder duerfen KEINEN
 * Befund erzeugen — ein falscher Firmware-Alarm sieht aus wie eine Messung.
 * Genau diese Faelle prueft der Test, dazu die Mehrheits-Erkennung selbst.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP.
 *
 * Aufruf:  php tests/FirmwareDriftTest.php
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

use Modules\NetworkTopology\Topology\FirmwareDrift;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %s\n", $ok ? 'PASS' : 'FAIL', $what);
    if (!$ok) {
        printf("        got  %s\n        want %s\n",
            json_encode($got), json_encode($want));
    }
}

function host(string $model, string $fw): array {
    return ['model' => $model, 'fw' => $fw];
}

echo "\nFirmwareDrift\n";

// 1. Mehrheit vorhanden: die Minderheit wird geflaggt, mit Detail.
check('Mehrheit A/A/B -> B weicht ab',
    FirmwareDrift::detect([
        'h1' => host('M', 'A'), 'h2' => host('M', 'A'), 'h3' => host('M', 'B'),
    ]),
    ['h3' => ['fw' => 'B', 'expected' => 'A', 'model' => 'M', 'n' => 2]]);

// 2. Zu kleine Gruppe (2) -> kein Befund, egal wie uneinig.
check('Gruppe von 2 -> kein Fund (Beobachtung)',
    FirmwareDrift::detect(['h1' => host('M', 'A'), 'h2' => host('M', 'B')]),
    []);

// 3. Alle gleich -> keine Abweichung.
check('Alle gleich -> kein Fund',
    FirmwareDrift::detect([
        'h1' => host('M', 'A'), 'h2' => host('M', 'A'), 'h3' => host('M', 'A'),
    ]),
    []);

// 4. Gleichstand (2:2) -> keine eindeutige Mehrheit -> uebersprungen.
check('Gleichstand A/A/B/B -> kein Fund',
    FirmwareDrift::detect([
        'h1' => host('M', 'A'), 'h2' => host('M', 'A'),
        'h3' => host('M', 'B'), 'h4' => host('M', 'B'),
    ]),
    []);

// 5. Mehrere Abweichler gegen dieselbe Mehrheit.
check('A/A/A/B/C -> B und C weichen ab',
    FirmwareDrift::detect([
        'h1' => host('M', 'A'), 'h2' => host('M', 'A'), 'h3' => host('M', 'A'),
        'h4' => host('M', 'B'), 'h5' => host('M', 'C'),
    ]),
    [
        'h4' => ['fw' => 'B', 'expected' => 'A', 'model' => 'M', 'n' => 3],
        'h5' => ['fw' => 'C', 'expected' => 'A', 'model' => 'M', 'n' => 3],
    ]);

// 6. Unvollstaendige Eintraege (kein Modell / keine Firmware) fallen raus,
//    brechen die Gruppe aber nicht.
check('Leeres Modell/Firmware wird ignoriert',
    FirmwareDrift::detect([
        'h1' => host('',  'A'), 'h2' => host('M', ''),
        'h3' => host('M', 'A'), 'h4' => host('M', 'A'), 'h5' => host('M', 'B'),
    ]),
    ['h5' => ['fw' => 'B', 'expected' => 'A', 'model' => 'M', 'n' => 2]]);

// 7. Modelle sind unabhaengig voneinander.
check('Zwei Modelle getrennt ausgewertet',
    FirmwareDrift::detect([
        'a1' => host('M1', 'A'), 'a2' => host('M1', 'A'), 'a3' => host('M1', 'B'),
        'b1' => host('M2', 'X'), 'b2' => host('M2', 'X'), 'b3' => host('M2', 'X'),
    ]),
    ['a3' => ['fw' => 'B', 'expected' => 'A', 'model' => 'M1', 'n' => 2]]);

// 8. minGroup als Parameter: eine Dreier-Gruppe faellt bei Schwelle 4 weg.
check('minGroup=4 -> Dreier-Gruppe liefert nichts',
    FirmwareDrift::detect([
        'h1' => host('M', 'A'), 'h2' => host('M', 'A'), 'h3' => host('M', 'B'),
    ], 4),
    []);

// 9. Modell/Firmware werden getrimmt (' M ' == 'M', ' A' == 'A').
check('Trim auf Modell und Firmware',
    FirmwareDrift::detect([
        'h1' => host(' M ', ' A'), 'h2' => host('M', 'A'), 'h3' => host('M', 'B'),
    ]),
    ['h3' => ['fw' => 'B', 'expected' => 'A', 'model' => 'M', 'n' => 2]]);

echo "\n";
if ($failures > 0) {
    printf("FirmwareDrift: %d Fehler.\n", $failures);
    exit(1);
}
echo "FirmwareDrift: alle Faelle gruen.\n";
