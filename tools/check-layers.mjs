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
function scenario(name, cfg, body, setup) {
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

        // Vor dem Import, nicht danach: storage.js liest NT_CONFIG in IIFEs beim
        // Laden, und ein Szenario, das den fetch-Stub austauscht, muss das tun,
        // bevor die erste Serverfahrt moeglich ist.
        ${setup || ''}

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

console.log('\n== Beide Schreibwege putzen gleich ==\n');

// Es gibt zwei Wege in die Positions-Ebene: savePositions() liest aus der
// Karte, setPositions() bekommt sie fertig (Presets). Sie fuehrten die
// Ebenen-Logik getrennt, und nur einer der beiden warf Internet-Knoten weg und
// rundete. Aufgefallen ist das nie, weil Presets ihre Positionen aus
// loadPositions() ziehen — also aus schon geputzten Serverdaten. Presets aus
// der Zeit VOR der Server-Umstellung kommen dagegen aus dem localStorage.

check('setPositions: Internet-Knoten raus, Koordinaten gerundet',
    scenario('n', { ...base, is_super_admin: false, user_id: 5 },
        `S.setPositions({ h1: { x: 1.4, y: 2.6 }, internet_0: { x: 5, y: 5 } }, false);
         return S.loadPositions();`),
    { h1: { x: 1, y: 3 }, h2: { x: 20, y: 20 }, h3: { x: 30, y: 30 } });

// Ein Preset, in dem alles auf 0,0 liegt, ist keine Anordnung — es waere der
// Zustand vor dem ersten Layout-Durchlauf. Frueher haette es die gespeicherte
// Karte ueberschrieben.
check('setPositions: alles auf 0,0 wird nicht geschrieben',
    scenario('o', { ...base, is_super_admin: false, user_id: 5 },
        `S.setPositions({ h1: { x: 0, y: 0 }, h2: { x: 0, y: 0 } }, false);
         return S.loadPositions();`),
    { h1: { x: 10, y: 10 }, h2: { x: 20, y: 20 }, h3: { x: 30, y: 30 } });

console.log('\n== Konflikt: was der Server mitschickt, gilt ==\n');

// WARUM DAS HIER STEHT
// --------------------
// Der Server lehnt ab, wenn die Basis-Revision nicht mehr passt, und schickt
// seinen aktuellen Stand mit. Der Client hat ihn eine Zeit lang weggeworfen und
// nur die Revision uebernommen — mit zwei Folgen, die beide erst im Betrieb
// auffallen: die Karte zeigte weiter die abgelehnte Anordnung, und der naechste
// Speichervorgang ging mit der NEUEN Revision durch und schrieb den veralteten
// lokalen Stand darueber. Die Erkennung verhinderte das Ueberschreiben also
// nicht, sie verschob es um einen Speichervorgang.

// Eine Cytoscape-Attrappe: savePositions() braucht nur nodes().forEach mit
// id() und position().
const CY = (pos) => `{
    nodes: () => ({ forEach: (f) => Object.keys(${JSON.stringify(pos)}).forEach(
        (id) => f({ id: () => id, position: () => (${JSON.stringify(pos)})[id] })) })
}`;

// Der Stub antwortet EINMAL mit einem Konflikt und merkt sich alle Bodies.
const KONFLIKT = (payload) => `
    globalThis.__posted = [];
    let erste = true;
    globalThis.fetch = (url, opt) => {
        globalThis.__posted.push(String((opt && opt.body) || ''));
        const d = erste
            ? Object.assign({ conflict: true, error: 'x', revision: 'r2' }, ${JSON.stringify(payload)})
            : { ok: true, revision: 'r3' };
        erste = false;
        return Promise.resolve({ json: () => Promise.resolve(d) });
    };
`;

check('Positions-Konflikt: der Serverstand ersetzt den abgelehnten',
    scenario('k', {
        ...base, is_super_admin: true, user_id: 1,
        revisions: { positions_shared: 'r1' }
    },
    `S.savePositions(${CY({ h1: { x: 77, y: 77 } })});
     await new Promise((r) => setTimeout(r, 30));
     return S.loadPositions();`,
    KONFLIKT({ positions: { [VIEW]: { h1: { x: 1, y: 1 }, h9: { x: 9, y: 9 } } } })),
    { h1: { x: 1, y: 1 }, h9: { x: 9, y: 9 } });

// Der teurere Teil: _persistPositions schickt ALLE Ansichten, nicht nur die
// aktive. Ohne Uebernahme traegt der Client die fremde Ansicht '7' gar nicht
// und loescht sie beim naechsten Speichern mit.
check('fremde Ansicht ueberlebt den naechsten Speichervorgang',
    scenario('l', {
        ...base, is_super_admin: true, user_id: 1,
        revisions: { positions_shared: 'r1' }
    },
    `S.savePositions(${CY({ h1: { x: 77, y: 77 } })});
     await new Promise((r) => setTimeout(r, 30));
     S.savePositions(${CY({ h1: { x: 55, y: 55 } })});
     await new Promise((r) => setTimeout(r, 30));
     const letzte = new URLSearchParams(globalThis.__posted.pop());
     return Object.keys(JSON.parse(letzte.get('positions'))).sort();`,
    KONFLIKT({ positions: {
        [VIEW]: { h1: { x: 1, y: 1 } },
        '7':    { x1: { x: 5, y: 5 } }
    } })),
    ['4', '7']);

check('Links-Konflikt: Serverstand statt lokalem Schnappschuss',
    scenario('m', {
        ...base, is_super_admin: false, user_id: 5,
        manual_links: { shared: [], personal: [{ s: 'a', t: 'b' }] },
        revisions: { links_personal: 'r1' }
    },
    `S.addLink('c', 'd');
     await new Promise((r) => setTimeout(r, 30));
     return S.loadLinks();`,
    KONFLIKT({ links: [{ s: 'x', t: 'y' }] })),
    [{ s: 'x', t: 'y', scope: 'personal' }]);

console.log('\n== Zwei Speichervorgaenge kurz hintereinander ==\n');

// Der Server prueft base gegen die Revision, die er gerade haelt. Liefen zwei
// Fahrten gleichzeitig, trug die zweite noch die alte Basis — der Server lehnte
// ab, obwohl niemand anderes etwas getan hatte. Zwei Klicks auf "Fit" reichten,
// und seit die Karte auf den Serverstand zurueckrueckt, sprang sie dabei auch.
// Ein Stub-Server, der sich wie der echte verhaelt: base pruefen, 40 ms Antwort.
const SERVER = `
    let serverRev = 'r0', n = 0;
    globalThis.__konflikte = [];
    globalThis.__fahrten = () => n;
    globalThis.fetch = (url, opt) => {
        const p = new URLSearchParams(String(opt.body));
        const base = p.get('base'), lauf = ++n;
        return new Promise((res) => setTimeout(() => {
            if (base !== serverRev) {
                globalThis.__konflikte.push('Fahrt ' + lauf + ': base=' + base + ' server=' + serverRev);
                return res({ json: () => Promise.resolve({
                    conflict: true, error: 'x', revision: serverRev,
                    positions: { '4': { h1: { x: 10, y: 10 } } } }) });
            }
            serverRev = 'r' + lauf;
            res({ json: () => Promise.resolve({ ok: true, revision: serverRev }) });
        }, 40));
    };
`;

check('zweiter Speichervorgang wartet, statt einen Konflikt zu ernten',
    scenario('p', {
        ...base, is_super_admin: true, user_id: 1,
        positions: { shared: { [VIEW]: { h1: { x: 10, y: 10 } } }, personal: {} },
        revisions: { positions_shared: 'r0' }
    },
    `S.savePositions(${CY({ h1: { x: 42, y: 42 } })});
     await new Promise((r) => setTimeout(r, 20));
     S.savePositions(${CY({ h1: { x: 43, y: 43 } })});
     await new Promise((r) => setTimeout(r, 300));
     return { fahrten: globalThis.__fahrten(), konflikte: globalThis.__konflikte };`,
    SERVER),
    { fahrten: 2, konflikte: [] });

console.log('');
if (failures) {
    console.log(`check-layers: ${failures} Problem(e).`);
    process.exit(1);
}
console.log('check-layers: Zwei-Ebenen-Logik verhaelt sich wie beschrieben.');
