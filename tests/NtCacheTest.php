<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Actions\NtCache — vor allem die Single-Flight-Sperre (#35).
 *
 * Das Entscheidende an der Sperre ist ihr FAIL-OPEN: ohne APCu (oder ohne
 * eingeloggten User) darf lock() NICHT blockieren, sondern muss true liefern —
 * sonst baute kein Request mehr die Karte. Genau diese Zusicherung haelt der
 * Test fest. Ist APCu im Testlauf verfuegbar, wird zusaetzlich die echte
 * atomare add/delete-Mechanik geprueft.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP. NtCache greift auf
 * \CWebUser::$data zu; die Zabbix-Klasse gibt es hier nicht, also ein Stub
 * VOR dem Autoload.
 *
 * Aufruf:  php tests/NtCacheTest.php
 */

if (!class_exists('CWebUser')) {
    class CWebUser { public static $data = []; }
}

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

use Modules\NetworkTopology\Actions\NtCache;

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

$parts = [[7, 12, 15]];   // wie eine groupids-Auswahl

echo "\n  NtCache — eingeloggter User\n\n";
CWebUser::$data = ['userid' => 42, 'roleid' => 3, 'type' => 3];

if (!function_exists('apcu_add')) {
    // CLI-Realitaet: kein APCu -> alles fail-open.
    echo "  (kein APCu -> Fail-open-Vertrag)\n";
    check('lock() ohne APCu -> true (jeder baut selbst)', NtCache::lock('data_rebuild', $parts, 30), true);
    check('zweites lock() ohne APCu -> auch true',         NtCache::lock('data_rebuild', $parts, 30), true);
    check('get() ohne APCu -> null',                       NtCache::get('data_payload', $parts), null);
    NtCache::set('data_payload', $parts, ['nodes' => [1]], 60);
    check('get() nach set() ohne APCu -> weiter null',     NtCache::get('data_payload', $parts), null);
    NtCache::unlock('data_rebuild', $parts);   // darf nicht werfen
    check('unlock() ohne APCu -> kein Fehler',             true, true);
} else {
    // APCu vorhanden: echte atomare Mechanik.
    echo "  (APCu vorhanden -> echte Single-Flight-Mechanik)\n";
    apcu_clear_cache();
    check('lock() erstes Mal -> true',                     NtCache::lock('data_rebuild', $parts, 30), true);
    check('lock() gehalten -> false (nur einer baut)',     NtCache::lock('data_rebuild', $parts, 30), false);
    NtCache::unlock('data_rebuild', $parts);
    check('nach unlock() wieder sperrbar',                 NtCache::lock('data_rebuild', $parts, 30), true);
    NtCache::set('data_payload', $parts, ['nodes' => [1]], 60);
    check('set()+get() Roundtrip',                         NtCache::get('data_payload', $parts), ['nodes' => [1]]);
    check('get() anderer Namespace -> null',               NtCache::get('data_snapshot', $parts), null);
}

echo "\n  NtCache — kein eingeloggter User (uid 0)\n\n";
CWebUser::$data = [];
check('ohne User: lock() -> true (fail-open)',            NtCache::lock('data_rebuild', $parts, 30), true);
check('ohne User: get() -> null',                         NtCache::get('data_payload', $parts), null);
NtCache::unlock('data_rebuild', $parts);
check('ohne User: unlock() -> kein Fehler',               true, true);

echo "\n", $failures === 0
    ? "=== ALLE TESTS PASS ===\n"
    : "=== {$failures} TEST(S) FEHLGESCHLAGEN ===\n";

exit($failures === 0 ? 0 : 1);
