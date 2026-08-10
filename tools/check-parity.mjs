#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
//
// check-parity — bewacht zwei Duplikate, die es aus gutem Grund gibt.
//
// Die Widget-Module koennen den Code des Hauptmoduls nicht importieren: Zabbix'
// jsLoader kennt keine ES-Module. Was beide brauchen, steht deshalb zweimal da.
// Bisher stand die Bitte, das synchron zu halten, als Kommentar in den Dateien
// ("wenn sich die Formel im Haupt-Tab aendert, hier mitziehen") — eine Bitte
// ist keine Absicherung. Dieses Skript macht daraus eine.
//
// Geprueft wird NICHT auf Textgleichheit (die Dateien sind ESM vs. ES5), sondern
// auf das, was auseinanderlaufen kann und weh tut:
//
//   1. Die Health-Score-Formel. Gewichte und Schwellen muessen in
//      render-health.js und widget_health identisch sein — sonst zeigt dieselbe
//      Hostgroup auf der Karte und im Dashboard verschiedene Scores, und niemand
//      merkt, welcher stimmt.
//
//   2. Der geteilte Datenzugriff (window.NtWidgetData). Er liegt in vier
//      Widget-Dateien und muss byte-identisch sein: liefe eine Kopie mit anderem
//      TTL oder anderem Cache-Schluessel, haette das Dashboard je nach
//      Ladereihenfolge ein anderes Verhalten — der schlimmste Fehlertyp,
//      weil er nicht reproduzierbar ist.
//
// Findet die Extraktion nichts, ist das ein FEHLER, kein Durchlauf: sonst
// bestuende das Gate stillschweigend weiter, nachdem jemand die Struktur
// umgebaut hat.
//
// Aufruf: node tools/check-parity.mjs

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

let failures = 0;

function fail(msg) {
    console.log(`  [FAIL] ${msg}`);
    failures++;
}
function pass(msg) {
    console.log(`  [PASS] ${msg}`);
}

function read(path) {
    try {
        return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    }
    catch (e) {
        fail(`Datei nicht lesbar: ${path}`);
        return '';
    }
}

// ── 1. Health-Score-Formel ──────────────────────────────────────────────────

const HEALTH_FILES = {
    'render-health.js': 'assets/js/modules/render-health.js',
    'widget_health':    'widget_health/assets/js/widget.class.js'
};

/** Gewichte: aus "(s.offline / t) * 40" wird {offline: 40, ...}. */
function weights(src) {
    const out = {};
    const re = /\(\s*\w+\.(offline|stale|critical|unacked)\s*\/\s*\w+\s*\)\s*\*\s*(\d+)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        out[m[1]] = Number(m[2]);
    }
    return out;
}

/** Schwellen: die Zahlen aus der Farb-/Label-Staffelung "s >= 85". */
function thresholds(src) {
    const found = new Set();
    const re = /\b\w+\s*>=\s*(\d{2})\b/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        found.add(Number(m[1]));
    }
    return [...found].sort((a, b) => b - a);
}

console.log('Health-Score-Formel');

const health = {};
for (const [label, path] of Object.entries(HEALTH_FILES)) {
    const src = read(path);
    health[label] = { w: weights(src), t: thresholds(src) };
}

const EXPECTED_KEYS = ['offline', 'stale', 'critical', 'unacked'];
let extraction_ok = true;
for (const [label, data] of Object.entries(health)) {
    const missing = EXPECTED_KEYS.filter((k) => !(k in data.w));
    if (missing.length) {
        fail(`${label}: Gewichte nicht gefunden (${missing.join(', ')}) — Formel umgebaut? Dann dieses Skript nachziehen.`);
        extraction_ok = false;
    }
}

if (extraction_ok) {
    const [a, b] = Object.keys(health);
    for (const k of EXPECTED_KEYS) {
        if (health[a].w[k] !== health[b].w[k]) {
            fail(`Gewicht "${k}" weicht ab: ${a}=${health[a].w[k]}, ${b}=${health[b].w[k]}`);
        }
    }
    if (Object.values(health).every((d) => EXPECTED_KEYS.every((k) => health[a].w[k] === d.w[k]))) {
        pass(`Gewichte identisch (${EXPECTED_KEYS.map((k) => `${k}=${health[a].w[k]}`).join(', ')})`);
    }

    const ta = health[a].t.join(',');
    const tb = health[b].t.join(',');
    if (ta !== tb) {
        fail(`Schwellen weichen ab: ${a}=[${ta}], ${b}=[${tb}]`);
    }
    else {
        pass(`Schwellen identisch ([${ta}])`);
    }
}

// ── 2. Geteilter Datenzugriff ───────────────────────────────────────────────

console.log('\nGeteilter Datenzugriff (window.NtWidgetData)');

const SHARED_FILES = [
    'widget/assets/js/widget.class.js',
    'widget_health/assets/js/widget.class.js',
    'widget_table/assets/js/widget.class.js',
    'widget_kpi/assets/js/widget.class.js'
];

const hashes = new Map();
for (const path of SHARED_FILES) {
    const src = read(path);
    const m = src.match(/if \(!window\.NtWidgetData\) \{[\s\S]*?\n\}\n/);
    if (!m) {
        fail(`${path}: Block nicht gefunden`);
        continue;
    }
    const h = createHash('sha256').update(m[0]).digest('hex').slice(0, 12);
    if (!hashes.has(h)) hashes.set(h, []);
    hashes.get(h).push(path);
}

if (hashes.size === 1 && [...hashes.values()][0].length === SHARED_FILES.length) {
    pass(`in allen ${SHARED_FILES.length} Dateien identisch (${[...hashes.keys()][0]})`);
}
else if (hashes.size > 1) {
    fail('Blöcke laufen auseinander:');
    for (const [h, files] of hashes) {
        console.log(`         ${h}  ${files.join(', ')}`);
    }
}

// ── Ergebnis ────────────────────────────────────────────────────────────────

console.log('');
if (failures) {
    console.log(`check-parity: ${failures} Abweichung(en) — die Duplikate sind auseinandergelaufen.`);
    process.exit(1);
}
console.log('check-parity: Duplikate sind synchron.');
