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
//   2. Der geteilte Widget-Code: window.NtWidgetData in vier Widget-Dateien,
//      window.NtFetchJson in allen fuenf. Beide muessen byte-identisch sein: liefe eine Kopie mit anderem
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

/**
 * Weitere Formel-Konstanten, die ebenfalls auf beiden Seiten gleich sein
 * muessen, aber NICHT in die Gewichte/Farbschwellen fallen: das Stale-Fenster
 * (STALE_S, 3-stellig) und der Severity-Cutoff fuer "critical" (>= 4,
 * EINSTELLIG — die Schwellen-Regex oben verlangt zwei Stellen und sah ihn nie).
 * Beide koennen driften, ohne dass ein Score sichtbar kaputtgeht, bis eine
 * Hostgroup auf Karte und Dashboard verschiedene Zahlen zeigt.
 */
function formulaConstants(src) {
    const stale = src.match(/STALE_S\s*=\s*(\d+)/);
    const sev   = src.match(/severity\s*\|\|\s*0\s*\)\s*>=\s*(\d+)/);
    return {
        stale:   stale ? Number(stale[1]) : null,
        sevcrit: sev   ? Number(sev[1])   : null
    };
}

console.log('Health-Score-Formel');

const health = {};
for (const [label, path] of Object.entries(HEALTH_FILES)) {
    const src = read(path);
    health[label] = { w: weights(src), t: thresholds(src), c: formulaConstants(src) };
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

    for (const [k, lbl] of [['stale', 'Stale-Fenster STALE_S'], ['sevcrit', 'Severity-Cutoff (>=)']]) {
        const va = health[a].c[k];
        const vb = health[b].c[k];
        if (va === null || vb === null) {
            fail(`${lbl} nicht gefunden (${a}=${va}, ${b}=${vb}) — Formel umgebaut? Dann dieses Skript nachziehen.`);
        }
        else if (va !== vb) {
            fail(`${lbl} weicht ab: ${a}=${va}, ${b}=${vb}`);
        }
        else {
            pass(`${lbl} identisch (${va})`);
        }
    }
}

// ── 2. Geteilter Widget-Code ────────────────────────────────────────────────
//
// Zwei Bloecke aus tools/widget-shared.js: NtFetchJson (alle fuenf Widgets,
// seit dem 504-Befund im Hop-Modus) und NtWidgetData (vier — widget_items
// holt ueber eine andere Action). Die Ausdruecke stehen wortgleich in
// sync-widget-shared.mjs.

const VIER = [
    'widget/assets/js/widget.class.js',
    'widget_health/assets/js/widget.class.js',
    'widget_table/assets/js/widget.class.js',
    'widget_kpi/assets/js/widget.class.js'
];
const BLOCKS = [
    { name: 'NtFetchJson',  re: /if \(!window\.NtFetchJson\) \{[\s\S]*?\n\}\n/,
      files: [...VIER, 'widget_items/assets/js/widget.class.js'] },
    { name: 'NtWidgetData', re: /if \(!window\.NtWidgetData\) \{[\s\S]*?\n\}\n/,
      files: VIER },
];

// Zusaetzlich gegen die QUELLE. Bis 5.4.0 pruefte dieser Gate nur, dass die
// vier Kopien untereinander gleich sind — vier gleich falsche Kopien waeren
// durchgegangen, und bearbeitet wurden sie einzeln. Seit es
// tools/widget-shared.js gibt, ist eine davon die Wahrheit.
const QUELLE = 'tools/widget-shared.js';
const quelle = read(QUELLE);

for (const { name, re, files } of BLOCKS) {
    console.log(`\nGeteilter Widget-Code (window.${name})`);

    const hashes = new Map();
    for (const path of files) {
        const m = read(path).match(re);
        if (!m) {
            fail(`${path}: Block nicht gefunden`);
            continue;
        }
        const h = createHash('sha256').update(m[0]).digest('hex').slice(0, 12);
        if (!hashes.has(h)) hashes.set(h, []);
        hashes.get(h).push(path);
    }

    let quellHash = null;
    const qm = quelle.match(re);
    if (!qm) {
        fail(`${QUELLE}: Block nicht gefunden`);
    }
    else {
        quellHash = createHash('sha256').update(qm[0]).digest('hex').slice(0, 12);
    }

    if (hashes.size === 1 && [...hashes.values()][0].length === files.length) {
        const h = [...hashes.keys()][0];
        if (quellHash !== null && h !== quellHash) {
            fail(`Kopien sind untereinander gleich (${h}), weichen aber von ${QUELLE} ab (${quellHash}) — npm run build schreibt sie zurecht`);
        }
        else {
            pass(`in allen ${files.length} Dateien identisch und wie ${QUELLE} (${h})`);
        }
    }
    else if (hashes.size > 1) {
        fail('Blöcke laufen auseinander:');
        for (const [h, fs] of hashes) {
            console.log(`         ${h}  ${fs.join(', ')}`);
        }
    }
}

// ── 3. Compliance-Pruefschluessel JS ↔ PHP ──────────────────────────────────
//
// Ein zweites Duplikat derselben Klasse wie die Health-Formel: die Compliance-
// Ansicht steht auf BEIDEN Seiten. Das Frontend (render-compliance.js,
// COMPLIANCE_CHECKS) baut die Spalten aus einer Schlusselliste; das Backend
// (NetworkTopologyCompliance.php, $agg) zaehlt pro Schluessel. Die Namen muessen
// exakt uebereinstimmen — tun sie es nicht, zaehlt das Backend einen Schluessel,
// den die Spalte nie zeigt, oder die Spalte sucht einen, den das Backend nie
// liefert, und rendert fuer jeden Host stumm "kein Wert". Kein bestehendes Gate
// las beide Dateien; genau dafuer gibt es check-parity.

console.log('\nCompliance-Pruefschluessel (JS ↔ PHP)');

function complianceKeysJs(src) {
    const block = src.match(/COMPLIANCE_CHECKS\s*=\s*\[([\s\S]*?)\];/);
    if (!block) return null;
    const out = new Set();
    const re = /\bkey:\s*'([a-z0-9_]+)'/gi;
    let m;
    while ((m = re.exec(block[1])) !== null) out.add(m[1]);
    return out;
}

function complianceKeysPhp(src) {
    const block = src.match(/\$agg\s*=\s*\[([\s\S]*?)\];/);
    if (!block) return null;
    const out = new Set();
    const re = /'([a-z0-9_]+)'\s*=>/gi;
    let m;
    while ((m = re.exec(block[1])) !== null) out.add(m[1]);
    return out;
}

const compJs  = complianceKeysJs(read('assets/js/modules/render-compliance.js'));
const compPhp = complianceKeysPhp(read('actions/NetworkTopologyCompliance.php'));

if (!compJs || compJs.size === 0) {
    fail('COMPLIANCE_CHECKS nicht gefunden — Struktur umgebaut? Dann dieses Skript nachziehen.');
}
else if (!compPhp || compPhp.size === 0) {
    fail('$agg in NetworkTopologyCompliance.php nicht gefunden — Struktur umgebaut? Dann dieses Skript nachziehen.');
}
else {
    const nurJs  = [...compJs].filter((k) => !compPhp.has(k));
    const nurPhp = [...compPhp].filter((k) => !compJs.has(k));
    if (nurJs.length)  fail(`nur in JS (Spalte ohne Backend-Wert): ${nurJs.join(', ')}`);
    if (nurPhp.length) fail(`nur in PHP (Wert ohne Spalte): ${nurPhp.join(', ')}`);
    if (!nurJs.length && !nurPhp.length) {
        pass(`${compJs.size} Schluessel identisch (${[...compJs].sort().join(', ')})`);
    }
}

// ── Ergebnis ────────────────────────────────────────────────────────────────

console.log('');
if (failures) {
    console.log(`check-parity: ${failures} Abweichung(en) — die Duplikate sind auseinandergelaufen.`);
    process.exit(1);
}
console.log('check-parity: Duplikate sind synchron.');
