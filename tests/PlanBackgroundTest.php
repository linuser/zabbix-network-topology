<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\PlanBackground::sanitize().
 *
 * Prueft NUR die Formpruefung der Hintergrund-REFERENZ (imageid oder url) je
 * Ansicht — keine Byte-/MIME-Logik, die macht Zabbix beim image.create. Ob eine
 * imageid wirklich auf ein Background-Bild zeigt, prueft die Action (image.get),
 * nicht sanitize(); hier geht es um Form, Muster und Obergrenzen.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — sanitize() beruehrt weder APP noch
 * CProfile, nur reines PHP.
 *
 * Aufruf:  php tests/PlanBackgroundTest.php
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

use Modules\NetworkTopology\Topology\PlanBackground;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-56s got=%-26s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

echo "PlanBackground::sanitize — Referenzen je Ansicht\n";

// imageid: numerisch -> int, Gruppen-View mit _plan-Suffix.
$r = PlanBackground::sanitize(['22_25_plan' => ['imageid' => '42']]);
check('imageid numerisch -> int', $r, ['22_25_plan' => ['imageid' => 42]]);

// imageid <= 0 faellt raus, Ansicht damit leer -> gar kein Eintrag.
check('imageid 0 verworfen', PlanBackground::sanitize(['1_plan' => ['imageid' => 0]]), []);

// Host+Hop-View-Schluessel mit _plan.
check('host-hop _plan erlaubt',
    PlanBackground::sanitize(['host10084_h2_plan' => ['imageid' => 7]]),
    ['host10084_h2_plan' => ['imageid' => 7]]);

// Nur https erlaubt; http wird seit 5.6.0 verworfen (Security-Review F11:
// ein Plan-Hintergrund ueber http liefe im Klartext an jeden Betrachter).
check('https-URL erlaubt',
    PlanBackground::sanitize(['3_plan' => ['url' => 'https://ex.com/a.png']]),
    ['3_plan' => ['url' => 'https://ex.com/a.png']]);
check('http-URL verworfen (nur https)',
    PlanBackground::sanitize(['3_plan' => ['url' => 'http://ex.com/a.png']]), []);

// Nicht-http(s)-Schema verworfen (kein javascript:, kein ftp:).
check('javascript:-URL verworfen',
    PlanBackground::sanitize(['3_plan' => ['url' => 'javascript:alert(1)']]), []);
check('ftp-URL verworfen',
    PlanBackground::sanitize(['3_plan' => ['url' => 'ftp://ex.com/a.png']]), []);

// Zu lange URL verworfen (> 2048).
$long = 'https://ex.com/' . str_repeat('a', 2100);
check('zu lange URL verworfen', PlanBackground::sanitize(['3_plan' => ['url' => $long]]), []);

// Gehaertete URL-Pruefung: Steuerzeichen, Whitespace und in Markup/CSS
// gefaehrliche Zeichen verworfen. Legitime URLs kodieren das prozentual —
// erst ein kuenftiger Render-Pfad, der die URL in HTML/CSS interpoliert, waere
// sonst injizierbar.
check('URL mit Leerzeichen verworfen',
    PlanBackground::sanitize(['3_plan' => ['url' => 'https://ex.com/a b.png']]), []);
check('URL mit Steuerzeichen verworfen',
    PlanBackground::sanitize(['3_plan' => ['url' => "https://ex.com/a\nb.png"]]), []);
check('URL mit spitzer Klammer verworfen',
    PlanBackground::sanitize(['3_plan' => ['url' => 'https://ex.com/a<b.png']]), []);
check('URL mit Anfuehrungszeichen verworfen',
    PlanBackground::sanitize(['3_plan' => ['url' => 'https://ex.com/a").png']]), []);

// imageid gewinnt, wenn beides da ist (erster Zweig).
check('imageid schlaegt url',
    PlanBackground::sanitize(['3_plan' => ['imageid' => 5, 'url' => 'https://ex.com/a.png']]),
    ['3_plan' => ['imageid' => 5]]);

// Ansicht OHNE _plan-Suffix verworfen (gehoert nicht in diesen Store).
check('view ohne _plan verworfen',
    PlanBackground::sanitize(['22_25' => ['imageid' => 1]]), []);

// Leere Referenz -> Ansicht faellt weg.
check('leere Referenz verworfen', PlanBackground::sanitize(['1_plan' => []]), []);

// MAX_VIEWS (50): die 51. Ansicht faellt weg.
$many = [];
for ($i = 1; $i <= 60; $i++) {
    $many[$i . '_plan'] = ['imageid' => $i];
}
check('MAX_VIEWS kappt auf 50', count(PlanBackground::sanitize($many)), 50);

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
