#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
//
// check-package — prueft, was im Modul-ZIP landen wuerde.
//
// Anlass: nt-uninstall.sh rutschte ins Paket. Die Ausschlussliste in deploy.sh
// nannte deploy.sh und nt-install.sh namentlich, kannte das neue Skript also
// nicht — und ein Shell-Skript unter dem Web-Root ist genau das, wogegen zwei
// Kommentare weiter oben in derselben Datei argumentieren. Aufgefallen ist es
// nur, weil jemand nachgesehen hat.
//
// Dasselbe Muster wie beim git-clone-Weg, den INSTALL.md inzwischen abraet:
// alles unter <ui>/modules/ ist ueber den Webserver abrufbar. Auf einer
// Testinstallation gemessen — tools/topo-change-sender.sh kam mit HTTP 200 und
// lesbarem Inhalt zurueck.
//
// EINE QUELLE DER WAHRHEIT
// -----------------------
// Die Ausschlussmuster werden aus deploy.sh GELESEN, nicht hier wiederholt.
// Eine zweite Liste waere eine zweite Stelle, die auseinanderlaufen kann —
// und dann prueft das Gate etwas anderes, als der Installer baut. Wer in
// deploy.sh einen Haken loest, faellt hier auf; wer eine Datei ergaenzt, die
// nicht ins Paket gehoert, ebenso.
//
// Aufruf: node tools/check-package.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

// ── 1. Muster aus deploy.sh lesen ────────────────────────────────────────
const deploy = readFileSync('deploy.sh', 'utf8');
const patterns = [...deploy.matchAll(/--exclude\s+'([^']+)'/g)].map((m) => m[1]);

if (patterns.length < 10) {
    console.log('  [FAIL] Ausschlussliste in deploy.sh nicht gefunden oder zu kurz —');
    console.log('         hat sich der Aufbau geaendert? Dann muss dieses Gate mit.');
    process.exit(1);
}

/**
 * rsync-Semantik, so weit wir sie brauchen: ein Muster ohne "/" trifft JEDEN
 * Pfadbestandteil, nicht nur den Anfang. "tools" schliesst also auch
 * "a/b/tools" aus. Platzhalter sind nur * und ?.
 */
function toRegExp(pat) {
    const esc = pat.replace(/[.+^${}()|[\]\\]/g, '\\$&')
                   .replace(/\*/g, '[^/]*')
                   .replace(/\?/g, '[^/]');
    return new RegExp('^' + esc + '$');
}
const matchers = patterns.map(toRegExp);

const excluded = (rel) => rel.split('/').some((seg) => matchers.some((re) => re.test(seg)));

// ── 2. Paketinhalt simulieren ────────────────────────────────────────────
const files = [];
(function walk(dir) {
    for (const name of readdirSync(dir)) {
        const abs = join(dir, name);
        const rel = relative(ROOT, abs);
        if (excluded(rel)) continue;
        if (statSync(abs).isDirectory()) walk(abs);
        else files.push(rel);
    }
})(ROOT);

// ── 3. Regeln ────────────────────────────────────────────────────────────
//
// Was NICHT ins Paket darf. Jede Regel steht fuer einen konkreten Schaden,
// nicht fuer Ordnungsliebe.
const forbidden = [
    [/\.sh$/,                 'Shell-Skript unter dem Web-Root'],
    [/^tools\//,              'tools/ — enthaelt das Sender-Skript fuer Zugangsdaten'],
    [/^templates\//,          'templates/ — gehoert nicht in den Docroot'],
    [/^tests\//,              'tests/'],
    [/^screenshots\//,        'screenshots/ — blaeht das Paket auf'],
    [/^dashboards\//,         'dashboards/'],
    [/^\.git\//,              '.git/ — das gesamte Repository'],
    [/^node_modules\//,       'node_modules/'],
    [/\.map$/,                'Source-Map — lag frueher schon oeffentlich abrufbar'],
    [/^widget[^/]*\//,        'Widget-Verzeichnis (eigenes Paket)'],
    [/^package(-lock)?\.json$/, 'package.json'],
    [/^eslint/,               'ESLint-Konfiguration'],
    [/^\.gitlab-ci\.yml$/,    'CI-Konfiguration'],
];

// Was DA SEIN MUSS. Dieselbe Liste wie REQUIRED_FILES in nt-install.sh —
// faellt eine davon weg, ist das Paket kaputt, und das faellt sonst erst beim
// Installieren auf.
const required = [
    'manifest.json',
    'Module.php',
    'assets/js/dist/nt-bundle.js',
    'assets/js/cytoscape.min.js',
    'assets/js/leaflet/leaflet.js',
];

let problems = 0;

console.log(`  ${patterns.length} Ausschlussmuster aus deploy.sh gelesen`);
console.log(`  ${files.length} Dateien im simulierten Paket\n`);

for (const [re, why] of forbidden) {
    const hits = files.filter((f) => re.test(f));
    if (hits.length) {
        console.log(`  [FAIL] ${why}`);
        hits.slice(0, 6).forEach((h) => console.log(`         ${h}`));
        if (hits.length > 6) console.log(`         … und ${hits.length - 6} weitere`);
        problems += hits.length;
    }
}

for (const r of required) {
    if (!files.includes(r)) {
        console.log(`  [FAIL] fehlt im Paket: ${r}`);
        problems++;
    }
}

// Groesse: ein Ausrutscher faellt hier auf, bevor jemand ein 50-MB-ZIP baut.
const bytes = files.reduce((n, f) => n + statSync(join(ROOT, f)).size, 0);
const mb = bytes / 1024 / 1024;
console.log(`  Groesse: ${mb.toFixed(1)} MB`);
if (mb > 8) {
    console.log('  [FAIL] ueber 8 MB — da ist etwas drin, das nicht hineingehoert.');
    problems++;
}

console.log('');
if (problems) {
    console.log(`check-package: ${problems} Problem(e) — so darf das Paket nicht raus.`);
    process.exit(1);
}
console.log('check-package: Paketinhalt in Ordnung.');
