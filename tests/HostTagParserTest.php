<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\HostTagParser.
 *
 * Der Tag-Parser verarbeitet, was ein Admin FREI EINTIPPT (nt:link=Label|URL).
 * Die Validierung darin ist damit sicherheitsrelevant: nur http/https, Laengen-
 * Caps, Icon-Whitelist. Faellt eine dieser Regeln bei einem Umbau still weg,
 * ist das ein echter Vektor (javascript:-URL im Kontextmenue) — und genau so
 * etwas sieht man einem Diff nicht an. Deshalb steht es hier als Test.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP.
 *
 * Aufruf:  php tests/HostTagParserTest.php
 */

spl_autoload_register(static function (string $class): void {
    $prefix = 'Modules\\NetworkTopologyV6\\';
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

use Modules\NetworkTopologyV6\Topology\HostTagParser;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-58s got=%-22s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

/** Baut einen Host mit den gegebenen Tags. */
function host(array $tags): array {
    return ['host' => 'h', 'name' => 'h', 'tags' => $tags];
}
function tag(string $t, string $v): array {
    return ['tag' => $t, 'value' => $v];
}

$hosts = [
    // h1 — gueltige Tags
    'h1' => host([
        tag('nt:icon',   'router'),
        tag('nt:show',   'system.cpu.util'),
        tag('nt:parent', 'pve-01'),
        tag('nt:link',   'NAS|https://nas.example.com'),
    ]),

    // h2 — Icon ausserhalb der Whitelist -> muss IGNORIERT werden
    'h2' => host([
        tag('nt:icon', 'raumschiff'),
    ]),

    // h3 — boesartige / unerlaubte URL-Schemata -> muessen ALLE verworfen werden
    'h3' => host([
        tag('nt:link', 'XSS|javascript:alert(1)'),
        tag('nt:link', 'Data|data:text/html;base64,PHNjcmlwdD4='),
        tag('nt:link', 'FTP|ftp://files.example.com'),
    ]),

    // h4 — Link-Cap: 7 gueltige Links, erlaubt sind 6
    'h4' => host([
        tag('nt:link', 'A|https://a.example.com'),
        tag('nt:link', 'B|https://b.example.com'),
        tag('nt:link', 'C|https://c.example.com'),
        tag('nt:link', 'D|https://d.example.com'),
        tag('nt:link', 'E|https://e.example.com'),
        tag('nt:link', 'F|https://f.example.com'),
        tag('nt:link', 'G|https://g.example.com'),
    ]),
];

$r = HostTagParser::parse($hosts);

echo "\nGueltige Tags\n";
check('nt:icon aus der Whitelist wird uebernommen', $r['icon_override']['h1'] ?? null, 'router');
check('nt:show landet in show_keys',                $r['show_keys']['h1'][0]  ?? null, 'system.cpu.util');
check('nt:parent wird uebernommen',                 $r['parent']['h1']        ?? null, 'pve-01');
check('nt:link (https) wird uebernommen',           $r['links']['h1'][0]['url'] ?? null, 'https://nas.example.com');
check('nt:link Label',                              $r['links']['h1'][0]['label'] ?? null, 'NAS');

echo "\nWhitelist\n";
check('nt:icon ausserhalb der Whitelist -> ignoriert', isset($r['icon_override']['h2']), false);

echo "\nURL-Validierung (sicherheitsrelevant)\n";
check('javascript:-URL wird verworfen',   count($r['links']['h3'] ?? []), 0);
check('data:-URL wird verworfen',         count($r['links']['h3'] ?? []), 0);
check('ftp://-URL wird verworfen',        count($r['links']['h3'] ?? []), 0);

echo "\nLink-Cap\n";
check('max 6 Links pro Host (7 angeboten)', count($r['links']['h4'] ?? []), 6);

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
