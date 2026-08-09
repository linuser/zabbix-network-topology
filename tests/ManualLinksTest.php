<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\ManualLinks::sanitize().
 *
 * sanitize() ist die einzige Stelle, an der die manuell gezogenen Kanten aus
 * dem Browser ins Backend gelangen — der Client schickt ein JSON-Array mit
 * Node-IDs. Von dort wandern sie in module.config bzw. CProfile und spaeter
 * wieder als Cytoscape-Element-IDs ("ml_<s>_<t>") in den DOM. Faellt eine der
 * Regeln bei einem Umbau still weg, ist das ein echter Vektor.
 *
 * Zwei Regeln sind dabei leicht zu uebersehen:
 *
 *   - Der PIPE ist verboten. Persoenliche Links liegen als "s|t" je einer
 *     CProfile-Zeile; eine ID mit "|" wuerde beim Zurueckreden an der falschen
 *     Stelle geteilt und einen anderen Link ergeben als den gespeicherten.
 *   - Das Paar wird SORTIERT. Eine Kante ist ungerichtet; ohne Normalisierung
 *     landen {a,b} und {b,a} nebeneinander und werden doppelt gezeichnet.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — sanitize() ist statisch und ruehrt
 * weder API noch APP noch CProfile an; die use-Zeilen der Klasse sind blosse
 * Aliase und loesen kein Autoloading aus.
 *
 * Aufruf:  php tests/ManualLinksTest.php
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

use Modules\NetworkTopology\Topology\ManualLinks;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-52s got=%-14s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

/** Wie viele Links ueberleben die Validierung? */
function surviving(array $in): int {
    return count(ManualLinks::sanitize($in));
}

function pair($s, $t): array {
    return ['s' => $s, 't' => $t];
}

// ── Was durchkommen muss ────────────────────────────────────────────────────
check('Host zu Host',            surviving([pair('10084', '10085')]), 1);
check('Host zu Ghost',           surviving([pair('10084', 'ghost_sw01_lan')]), 1);
check('Doppelpunkt erlaubt',     surviving([pair('a:b', '10085')]), 1);
check('Genau 128 Zeichen',       surviving([pair(str_repeat('a', 128), '10085')]), 1);

// ── Was abgewiesen werden muss ──────────────────────────────────────────────
check('Selbstbezug',             surviving([pair('10084', '10084')]), 0);
check('Leere ID',                surviving([pair('', '10085')]), 0);
check('Fehlendes Feld',          surviving([['s' => '10084']]), 0);
check('Kein Array-Element',      surviving(['kaputt']), 0);
check('HTML-Tag',                surviving([pair('<script>x</script>', '10085')]), 0);
check('Attribut-Ausbruch',       surviving([pair('10084"onerror="a', '10085')]), 0);
check('Pfad-Trenner',            surviving([pair('../../etc/passwd', '10085')]), 0);
check('Leerzeichen',             surviving([pair('a b', '10085')]), 0);
check('Pipe (Trennzeichen)',     surviving([pair('a|b', '10085')]), 0);
check('Zeilenumbruch',           surviving([pair("10084\n10085", '10086')]), 0);
check('Nullbyte',                surviving([pair("10084\0", '10085')]), 0);
check('129 Zeichen',             surviving([pair(str_repeat('a', 129), '10085')]), 0);

// ── Entdopplung ─────────────────────────────────────────────────────────────
check('Identisches Duplikat',    surviving([pair('1', '2'), pair('1', '2')]), 1);
check('Umgedrehtes Duplikat',    surviving([pair('1', '2'), pair('2', '1')]), 1);

// ── Normalisierung: das Paar wird sortiert abgelegt ─────────────────────────
$norm = ManualLinks::sanitize([pair('zzz', 'aaa')]);
check('Sortiert: s',             $norm[0]['s'], 'aaa');
check('Sortiert: t',             $norm[0]['t'], 'zzz');

// ── Mengenbegrenzung ────────────────────────────────────────────────────────
$many = [];
for ($i = 0; $i < 2500; $i++) {
    $many[] = pair('h' . $i, 'x' . $i);
}
check('Cap bei 2000',            surviving($many), 2000);

echo $failures === 0
    ? "\n  ManualLinksTest: alle Pruefungen bestanden\n"
    : "\n  ManualLinksTest: {$failures} Fehler\n";

exit($failures === 0 ? 0 : 1);
