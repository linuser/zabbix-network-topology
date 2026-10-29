<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * SlaResolverTest — reine Logik des SLA-Joins.
 *
 * Deckt die zwei REINEN Methoden ab, die ohne Zabbix-API laufen:
 *   resolve()         (eventid→hosts) ⋈ (eventid→services) → SLA-relevante Hosts
 *   matchSlaTargets() Service-Tags ⊇ SLA-service_tags → slo je Service
 *
 * Der API-Teil (load) ist hier nicht abgedeckt — er ist der duenne Kontakt und
 * braucht eine Instanz mit echten Services; das steht so im Klassenkopf.
 *
 * Aufruf:  php tests/SlaResolverTest.php
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

use Modules\NetworkTopology\Topology\SlaResolver;

$failures = 0;

function check(string $what, $got, $want): void {
    global $failures;
    $ok = $got === $want;
    if (!$ok) {
        $failures++;
    }
    printf("  [%s] %-52s got=%s want=%s\n",
        $ok ? 'PASS' : 'FAIL', $what,
        var_export($got, true), var_export($want, true));
}

echo "SlaResolver\n";

// ── resolve(): der Join ───────────────────────────────────────────────────
echo "\nresolve — Join eventid→hosts ⋈ eventid→services\n";
{
    $event_hosts = [
        '1001' => ['50'],          // Event 1001 → Host 50
        '1002' => ['51', '52'],    // Event 1002 → Hosts 51 + 52
        '1003' => ['53'],          // Event 1003 → Host 53 (kein Service darauf)
    ];
    $service_events = [
        '1001' => [['name' => 'Gold portal', 'slo' => 99.9]],
        '1002' => [['name' => 'Checkout',    'slo' => 99.5]],
        '1099' => [['name' => 'Ghost svc',   'slo' => 95.0]],  // kein Host zu diesem Event
    ];
    $r = SlaResolver::resolve($event_hosts, $service_events);

    check('count = 3 betroffene Hosts', $r['count'], 3);
    check('Host 50 SLA-relevant', isset($r['host_sla']['50']), true);
    check('Host 52 SLA-relevant (zweiter am Event)', isset($r['host_sla']['52']), true);
    check('Host 53 NICHT relevant (Event ohne Service)', isset($r['host_sla']['53']), false);
    check('Service-Name an Host 50', $r['host_sla']['50'][0]['service'], 'Gold portal');
    check('slo an Host 50', $r['host_sla']['50'][0]['slo'], 99.9);
    // services-Liste dedupliziert + sortiert, OHNE den Geist-Service (kein Host)
    check('services sortiert', $r['services'], ['Checkout', 'Gold portal']);
}

// Ein Host an zwei Services: beide erscheinen, nach Name sortiert.
echo "\nresolve — ein Host an zwei Services\n";
{
    $event_hosts   = ['2001' => ['60'], '2002' => ['60']];
    $service_events = [
        '2001' => [['name' => 'Zeta', 'slo' => 99.0]],
        '2002' => [['name' => 'Alpha', 'slo' => 99.99]],
    ];
    $r = SlaResolver::resolve($event_hosts, $service_events);
    check('count = 1 Host', $r['count'], 1);
    check('zwei Services am Host', count($r['host_sla']['60']), 2);
    check('alphabetisch sortiert (Alpha zuerst)', $r['host_sla']['60'][0]['service'], 'Alpha');
}

// Leere Eingaben → leeres, wohldefiniertes Ergebnis.
echo "\nresolve — leer\n";
{
    $r = SlaResolver::resolve([], []);
    check('count 0', $r['count'], 0);
    check('host_sla leer', $r['host_sla'], []);
    check('services leer', $r['services'], []);
}

// ── matchSlaTargets(): Tag-Match Service ⊇ SLA ─────────────────────────────
echo "\nmatchSlaTargets — Service traegt ALLE SLA-Tags\n";
{
    $services = [
        ['serviceid' => '10', 'name' => 'Portal', 'tags' => [
            ['tag' => 'Tier', 'value' => 'gold'],
            ['tag' => 'Region', 'value' => 'eu'],
        ]],
        ['serviceid' => '11', 'name' => 'Batch', 'tags' => [
            ['tag' => 'Tier', 'value' => 'gold'],
            // Region fehlt → die gold+eu-SLA darf NICHT greifen
        ]],
    ];
    $slas = [
        ['slaid' => '1', 'slo' => '99.9', 'service_tags' => [
            ['tag' => 'Tier', 'value' => 'gold'],
            ['tag' => 'Region', 'value' => 'eu'],
        ]],
    ];
    $m = SlaResolver::matchSlaTargets($services, $slas);
    check('Portal trifft (alle Tags da)', $m['10'] ?? null, 99.9);
    check('Batch trifft NICHT (Region fehlt)', isset($m['11']), false);
}

echo "\nmatchSlaTargets — mehrere SLAs, strengste gewinnt\n";
{
    $services = [['serviceid' => '20', 'name' => 'X', 'tags' => [['tag' => 'App', 'value' => 'x']]]];
    $slas = [
        ['slaid' => '1', 'slo' => '99.0',  'service_tags' => [['tag' => 'App', 'value' => 'x']]],
        ['slaid' => '2', 'slo' => '99.95', 'service_tags' => [['tag' => 'App', 'value' => 'x']]],
    ];
    $m = SlaResolver::matchSlaTargets($services, $slas);
    check('hoechstes slo gewinnt', $m['20'] ?? null, 99.95);
}

echo "\nmatchSlaTargets — SLA ohne Tags gilt fuer nichts\n";
{
    $services = [['serviceid' => '30', 'name' => 'Y', 'tags' => [['tag' => 'App', 'value' => 'y']]]];
    $slas = [['slaid' => '1', 'slo' => '99.0', 'service_tags' => []]];
    $m = SlaResolver::matchSlaTargets($services, $slas);
    check('kein Treffer bei tag-loser SLA', isset($m['30']), false);
}

// ── End-to-End der REINEN Kette an aufgezeichneten API-Shapes ──────────────
// Feldnamen gegen die Zabbix-7.0-API verifiziert: service.get liefert betroffene
// Events unter `problem_events` (je mit `eventid`), die Service-Tags unter
// `tags`; sla.get liefert `slo` und `service_tags`. Diese Fixture faehrt genau
// diese Form durch buildServiceEvents → matchSlaTargets → resolve und belegt,
// dass der API-Teil die Form richtig liest — der Teil, der ohne echte Instanz
// (null Services auf allen Instanzen) sonst unbewiesen bliebe.
echo "\nEnd-to-End — aufgezeichnete service.get/sla.get-Form\n";
{
    $services = [
        ['serviceid' => '7', 'name' => 'Checkout', 'tags' => [
            ['tag' => 'Tier', 'value' => 'gold'],
        ], 'problem_events' => [
            ['eventid' => '55001', 'name' => 'Agent unreachable', 'severity' => '4'],
        ]],
        ['serviceid' => '8', 'name' => 'Batch', 'tags' => [
            ['tag' => 'Tier', 'value' => 'silver'],
        ], 'problem_events' => []],   // kein Event → kein betroffener Host
    ];
    $slas = [
        ['slaid' => '1', 'slo' => '99.9', 'service_tags' => [
            ['tag' => 'Tier', 'operator' => '0', 'value' => 'gold'],
        ]],
    ];
    // ProblemLoader liefert eventid → [hostid]; Event 55001 haengt an Host 90.
    $event_hosts = ['55001' => ['90'], '55099' => ['91']];

    $slo_by_sid = SlaResolver::matchSlaTargets($services, $slas);
    check('Checkout trifft die gold-SLA', $slo_by_sid['7'] ?? null, 99.9);

    $svc_events = SlaResolver::buildServiceEvents($services, $slo_by_sid);
    check('Event 55001 → Checkout', $svc_events['55001'][0]['name'] ?? null, 'Checkout');
    check('Event 55001 → slo durchgereicht', $svc_events['55001'][0]['slo'] ?? null, 99.9);
    check('leeres problem_events erzeugt nichts', isset($svc_events['55002']), false);

    $r = SlaResolver::resolve($event_hosts, $svc_events);
    check('Host 90 SLA-relevant', isset($r['host_sla']['90']), true);
    check('Host 91 NICHT (Event ohne Service)', isset($r['host_sla']['91']), false);
    check('count 1', $r['count'], 1);
    check('Service-Name am Host', $r['host_sla']['90'][0]['service'], 'Checkout');
    check('slo-Label am Host', $r['host_sla']['90'][0]['slo'], 99.9);
}

echo "\n";
if ($failures > 0) {
    fwrite(STDERR, "FAIL: $failures\n");
    exit(1);
}
echo "alle gruen\n";
