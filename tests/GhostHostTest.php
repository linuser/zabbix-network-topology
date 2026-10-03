<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

/**
 * Unit-Test fuer Topology\GhostHost.
 *
 * Aus einem unueberwachten Nachbarn einen Zabbix-Host zu machen heisst, zwei
 * Zeichenketten von einem FREMDEN GERAET in einen Hostnamen und einen
 * Tag-Wert zu uebernehmen. Beide kommen ueber LLDP/CDP und sind damit das
 * Untrusteste, was dieses Modul verarbeitet.
 *
 * Laeuft ohne DB/Session/HTTP/Zabbix — nur PHP.
 *
 * Aufruf:  php tests/GhostHostTest.php
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

use Modules\NetworkTopology\Topology\GhostHost;

$fehler = 0;

function check(string $was, $gegeben, $erwartet): void {
    global $fehler;
    $ok = $gegeben === $erwartet;
    if (!$ok) {
        $fehler++;
    }
    printf("  [%s] %-56s %s\n", $ok ? 'PASS' : 'FAIL', $was,
        $ok ? '' : 'got=' . var_export($gegeben, true) . ' want=' . var_export($erwartet, true));
}

echo "\n  nameOk: was als technischer Hostname taugt\n\n";

check('gewoehnlicher Name',        GhostHost::nameOk('sw-edge-03'), true);
check('FQDN',                      GhostHost::nameOk('ap-corp-01.example.com'), true);
check('mit Leerzeichen',           GhostHost::nameOk('Switch Keller 2'), true);
check('MAC in Leerzeichenform',    GhostHost::nameOk('02 00 00 00 23 36'), true);
check('leer faellt durch',         GhostHost::nameOk(''), false);
check('nur Leerzeichen faellt durch', GhostHost::nameOk('   '), false);
check('zu lang faellt durch',      GhostHost::nameOk(str_repeat('a', 129)), false);
check('genau 128 geht',            GhostHost::nameOk(str_repeat('a', 128)), true);

// ABLEHNEN STATT UMSCHREIBEN: ein bereinigter Name erzeugte einen Host, der
// anders heisst als das Geraet auf der Karte — der Melder nennt den Nachbarn
// weiter beim alten Namen, und beide fanden nie zueinander.
check('Doppelpunkt wird abgelehnt', GhostHost::nameOk('sw:01'), false);
check('Schraegstrich abgelehnt',    GhostHost::nameOk('sw/01'), false);
check('Anfuehrungszeichen abgelehnt', GhostHost::nameOk('sw"01'), false);
check('Steuerzeichen abgelehnt',    GhostHost::nameOk("sw\x0001"), false);
check('Zeilenumbruch abgelehnt',    GhostHost::nameOk("sw\n01"), false);

echo "\n  uplinkValue: der Tag, der den Host auf der Karte platziert\n\n";

check('Melder und Port',
    GhostHost::uplinkValue('lab-sw-01', 'Gi1/0/8'), 'lab-sw-01:Gi1/0/8');
check('Leerzeichen werden getrimmt',
    GhostHost::uplinkValue('  lab-sw-01 ', ' Gi1/0/8 '), 'lab-sw-01:Gi1/0/8');
check('ohne Port kein Tag',   GhostHost::uplinkValue('lab-sw-01', ''), '');
check('ohne Melder kein Tag', GhostHost::uplinkValue('', 'Gi1/0/8'), '');

// DIE FALLE: HostTagParser trennt am LETZTEN Doppelpunkt. Ein Port in
// MAC-Form wuerde dort falsch getrennt, und der Host haenge danach an einem
// Geraet, das es nicht gibt. Ein fehlender Uplink ist ein fehlender Hinweis;
// ein falscher ist eine Behauptung ueber die Verkabelung.
check('Port mit Doppelpunkt: lieber kein Tag',
    GhostHost::uplinkValue('lab-sw-01', '3C:EC:EF:79:2C:88'), '');
// Ein Doppelpunkt im MELDERNAMEN ist dagegen unschaedlich — die Trennung am
// letzten Doppelpunkt findet trotzdem den richtigen Port.
check('Doppelpunkt im Melder bleibt erlaubt',
    GhostHost::uplinkValue('fe80::1', 'Gi1/0/8'), 'fe80::1:Gi1/0/8');
check('Steuerzeichen: kein Tag',
    GhostHost::uplinkValue("lab\x00sw", 'Gi1/0/8'), '');
check('zu lang: kein Tag',
    GhostHost::uplinkValue(str_repeat('h', 250), 'Gi1/0/8'), '');

echo "\n  description: warum es diesen Host gibt\n\n";

check('voller Satz',
    GhostHost::description('lldp', 'lab-sw-01', 'Gi1/0/8'),
    'Discovered via LLDP by lab-sw-01 on port Gi1/0/8 (Network Topology)');
check('ohne Port',
    GhostHost::description('cdp', 'lab-sw-01', ''),
    'Discovered via CDP by lab-sw-01 (Network Topology)');
check('ohne Melder',
    GhostHost::description('lldp', '', ''),
    'Discovered via LLDP (Network Topology)');
check('leeres via wird LLDP',
    GhostHost::description('', 'lab-sw-01', ''),
    'Discovered via LLDP by lab-sw-01 (Network Topology)');
check('Steuerzeichen werden ersetzt',
    strpos(GhostHost::description('lldp', "lab\x07sw", ''), "\x07"), false);
check('Laenge gekappt',
    mb_strlen(GhostHost::description('lldp', str_repeat('h', 400), 'p')) <= 250, true);

echo "\n  payload: was die API bekommt\n\n";

$p = GhostHost::payload([
    'name' => 'sw-edge-03', 'groupid' => '22',
    'reporter_host' => 'lab-sw-01', 'port' => 'Gi1/0/8', 'via' => 'lldp',
]);
check('wird gebaut',            $p['ok'], true);
check('technischer Name',       $p['payload']['host'], 'sw-edge-03');
check('Gruppe gesetzt',         $p['payload']['groups'], [['groupid' => '22']]);
check('Uplink-Tag gesetzt',     $p['payload']['tags'],
    [['tag' => 'nt:uplink', 'value' => 'lab-sw-01:Gi1/0/8']]);
// OHNE INTERFACE: ueber ein unueberwachtes Geraet ist keine Adresse bekannt,
// und eine zu erfinden waere schlimmer als keine.
check('kein Interface erfunden', isset($p['payload']['interfaces']), false);

$ohnePort = GhostHost::payload([
    'name' => 'drucker-og', 'groupid' => '22', 'reporter_host' => 'lab-sw-01', 'port' => '',
]);
check('ohne Port: Host ja, Tag nein', isset($ohnePort['payload']['tags']), false);
check('ohne Port: trotzdem gebaut',   $ohnePort['ok'], true);

check('schlechter Name wird abgelehnt',
    GhostHost::payload(['name' => 'sw:01', 'groupid' => '22'])['error'], 'name');
check('fehlende Gruppe wird abgelehnt',
    GhostHost::payload(['name' => 'sw-01', 'groupid' => ''])['error'], 'group');
check('nicht-numerische Gruppe abgelehnt',
    GhostHost::payload(['name' => 'sw-01', 'groupid' => '22; DROP'])['error'], 'group');

echo "\n";
if ($fehler > 0) {
    fwrite(STDERR, "\u{2716} {$fehler} Befund(e).\n");
    exit(1);
}
echo "\u{2713} Aus einem Geist wird ein Host, oder eine klare Absage.\n";
