#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
//
// check-layers — prueft die Zwei-Ebenen-Logik von Positionen und manuellen
// Links: was ein Super-Admin schreibt, was jeder andere schreibt, und was beim
// Lesen gewinnt.
//
// WARUM EIN EIGENES GATE
// ----------------------
// Diese Logik entscheidet, was verschiedene Benutzer auf DERSELBEN Karte sehen.
// Sie war bisher nur von Hand nachvollzogen, und der eine Fehler, der bereits
// auftrat, ist genau der Sorte, die man beim Lesen uebersieht: ein Super-Admin
// sah nach der Migration seine EIGENE geteilte Karte nicht, weil sein alter
// localStorage-Stand als persoenliche Ebene darueberlag (96bc12c). Aufgefallen
// ist das erst im Betrieb, an einer Karte, die sich nicht aendern liess.
//
// WAS DAS HIER NICHT IST
// ----------------------
// Kein Browser-Test und kein Test mit zwei echten Zabbix-Konten. Geprueft wird
// die Zusammenfuehrung im Client, mit gestellten NT_CONFIG-Daten, so wie der
// Server sie liefert. Der Weg Server → Datenbank → Rechtepruefung ist damit
// NICHT abgedeckt; dafuer braucht es zwei angemeldete Benutzer.
//
// Aufruf: node tools/check-layers.mjs

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MOD = new URL('../assets/js/modules/storage.js', import.meta.url).href;

/**
 * Jedes Szenario laeuft in einem EIGENEN Prozess. storage.js liest NT_CONFIG in
 * IIFEs beim Import; ESM cacht Module pro Prozess, ein zweiter Import mit
 * anderer Konfiguration bekaeme also den alten Stand. Ein Kindprozess ist der
 * ehrlichste Weg, "ein anderer Benutzer laedt die Seite" nachzustellen.
 */
function scenario(name, cfg, body) {
    const dir  = mkdtempSync(join(tmpdir(), 'nt-layers-'));
    const file = join(dir, 'run.mjs');
    writeFileSync(file, `
        const store = {};
        globalThis.localStorage = {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; }
        };
        globalThis.window = globalThis;
        globalThis.NT_CONFIG = ${JSON.stringify(cfg)};
        globalThis.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
        globalThis.document = { addEventListener() {} };
        const S = await import(${JSON.stringify(MOD)});
        const out = await (async () => { ${body} })();
        console.log(JSON.stringify(out));
    `);
    const r = spawnSync(process.execPath, [file], { encoding: 'utf8' });
    if (r.status !== 0) {
        return { __error: (r.stderr || '').trim().split('\n').slice(-3).join(' | ') };
    }
    try { return JSON.parse(r.stdout.trim().split('\n').pop()); }
    catch (e) { return { __error: 'Ausgabe nicht lesbar: ' + r.stdout.trim().slice(0, 120) }; }
}

let failures = 0;
function check(what, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures++;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${what}`);
    if (!ok) {
        console.log(`         got  ${JSON.stringify(got)}`);
        console.log(`         want ${JSON.stringify(want)}`);
    }
}

// Beide Benutzer sehen dieselbe Gruppenauswahl — der View-Schluessel haengt
// daran, sonst greifen die Ebenen nicht ineinander.
const VIEW = '4';
const base = {
    selected_groupids: ['4'],
    positions: {
        shared:   { [VIEW]: { h1: { x: 10, y: 10 }, h2: { x: 20, y: 20 }, h3: { x: 30, y: 30 } } },
        personal: {}
    },
    manual_links: { shared: [], personal: [] }
};

console.log('\n== Positionen: geteilte Ebene, persoenliche Abweichung ==\n');

// Ein Benutzer OHNE eigene Abweichung sieht genau die geteilte Karte.
check('Nutzer ohne eigene Positionen sieht die geteilte Karte',
    scenario('a', { ...base, is_super_admin: false, user_id: 5 },
        'return S.loadPositions();'),
    { h1: { x: 10, y: 10 }, h2: { x: 20, y: 20 }, h3: { x: 30, y: 30 } });

// DIE Regel: persoenlich gewinnt PRO KNOTEN, nicht als Ganzes.
check('persoenlich gewinnt pro Knoten, Rest bleibt geteilt',
    scenario('b', {
        ...base, is_super_admin: false, user_id: 5,
        positions: { shared: base.positions.shared, personal: { [VIEW]: { h2: { x: 99, y: 99 } } } }
    }, 'return S.loadPositions();'),
    { h1: { x: 10, y: 10 }, h2: { x: 99, y: 99 }, h3: { x: 30, y: 30 } });

// Eine Abweichung in EINER Ansicht darf eine andere Ansicht nicht beruehren.
check('andere Ansicht bleibt unberuehrt',
    scenario('c', {
        ...base, is_super_admin: false, user_id: 5, selected_groupids: ['7'],
        positions: { shared: { '7': { x1: { x: 1, y: 1 } } }, personal: { [VIEW]: { h2: { x: 99, y: 99 } } } }
    }, 'return S.loadPositions();'),
    { x1: { x: 1, y: 1 } });

console.log('\n== Wer schreibt in welche Ebene ==\n');

check('Super-Admin schreibt geteilt',
    scenario('d', { ...base, is_super_admin: true, user_id: 1 },
        'return S.defaultPositionScope();'),
    'shared');

check('normaler Benutzer schreibt persoenlich',
    scenario('e', { ...base, is_super_admin: false, user_id: 5 },
        'return S.defaultPositionScope();'),
    'personal');

check('dasselbe fuer manuelle Links (Super-Admin)',
    scenario('f', { ...base, is_super_admin: true, user_id: 1 },
        'return S.defaultLinkScope();'),
    'shared');

check('dasselbe fuer manuelle Links (normaler Benutzer)',
    scenario('g', { ...base, is_super_admin: false, user_id: 5 },
        'return S.defaultLinkScope();'),
    'personal');

console.log('\n== Manuelle Links: beide Ebenen, geteilt gewinnt ==\n');

check('beide Ebenen werden zusammengefuehrt, mit Herkunft',
    scenario('h', {
        ...base, is_super_admin: false, user_id: 5,
        manual_links: { shared: [{ s: 'a', t: 'b' }], personal: [{ s: 'c', t: 'd' }] }
    }, 'return S.loadLinks();'),
    [{ s: 'a', t: 'b', scope: 'shared' }, { s: 'c', t: 'd', scope: 'personal' }]);

// Dieselbe Kante in beiden Ebenen darf nur EINMAL gezeichnet werden, und zwar
// als geteilte — sonst laege eine persoenliche Kante sichtbar darueber.
check('dieselbe Kante doppelt: geteilt gewinnt, kein Duplikat',
    scenario('i', {
        ...base, is_super_admin: false, user_id: 5,
        manual_links: { shared: [{ s: 'a', t: 'b' }], personal: [{ s: 'a', t: 'b' }] }
    }, 'return S.loadLinks();'),
    [{ s: 'a', t: 'b', scope: 'shared' }]);

// Eine Kante ist ungerichtet: a→b und b→a sind dieselbe.
check('umgekehrte Richtung zaehlt als dieselbe Kante',
    scenario('j', {
        ...base, is_super_admin: false, user_id: 5,
        manual_links: { shared: [{ s: 'a', t: 'b' }], personal: [{ s: 'b', t: 'a' }] }
    }, 'return S.loadLinks();'),
    [{ s: 'a', t: 'b', scope: 'shared' }]);

console.log('');
if (failures) {
    console.log(`check-layers: ${failures} Problem(e).`);
    process.exit(1);
}
console.log('check-layers: Zwei-Ebenen-Logik verhaelt sich wie beschrieben.');
