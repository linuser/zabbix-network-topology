#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
//
// check-template-logic — fuehrt die LOGIK aus, die im LLDP-Template steckt:
// das Discovery-JavaScript und die sechs Regexe der Item-Prototypen, gegen
// echte Walk-Ausgaben verschiedener Hersteller.
//
// ANLASS
// ------
// Issue #15: auf TP-Link JetStream (T2600G-28TS) erzeugte die LLDP-Discovery
// kein einziges Item. Das Geraet laesst lldpRemTimeMark weg und liefert einen
// zweiteiligen Index (25.1 statt 1234.25.1). Das JavaScript und alle sechs
// Regexe verlangten drei Teile und verwarfen jede Zeile — stumm, denn
// DISCARD_VALUE zeigt nirgends einen Fehler. check-templates.mjs prueft nur
// die UUIDs; in die Logik der Templates hatte nie ein Test gesehen.
//
// WAS HIER NICHT KOPIERT IST
// --------------------------
// Getestet wird der Code AUS DER TEMPLATE-DATEI, nicht eine Abschrift. Eine
// Abschrift waere eine zweite Stelle, die auseinanderlaeuft, und der Test
// pruefte dann die Abschrift. Deshalb schlaegt dieses Skript auch fehl, wenn
// es das JavaScript oder die sechs Regexe NICHT findet: ein Test, der nach
// einem Umbau des Templates stillschweigend nichts mehr prueft, ist
// schlimmer als keiner.
//
// ZWEI ANNAEHERUNGEN, BEWUSST
// ---------------------------
// 1. Zabbix' eingebauter Schritt SNMP_WALK_TO_JSON wird hier nachgebaut — er
//    ist nicht Gegenstand des Tests, nur der Lieferant der Eingabe.
// 2. Zabbix wertet die Regexe mit PCRE aus, dieses Skript mit JavaScript.
//    Fuer die Konstrukte in diesen Mustern (\d, (?:…), .*?, "?, $ im
//    Mehrzeilenmodus) verhalten sich beide gleich; einzige Uebersetzung ist
//    das Inline-Flag (?m), das JavaScript nicht kennt — es wird zum m-Flag.
//
// Aufruf: node tools/check-template-logic.mjs  (aus jedem Verzeichnis)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'templates', 'nt_lldp_snmp_template.yaml');

let failures = 0;
function check(name, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures++;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}`
        + (ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
}
function abort(msg) {
    console.log(`  [FAIL] ${msg}`);
    process.exit(1);
}

const lines = readFileSync(TEMPLATE, 'utf8').split('\n');
const indentOf = (l) => l.length - l.trimStart().length;

// ── Das Discovery-JavaScript aus der Datei holen ─────────────────────────
function lldJavaScript() {
    const ruleAt = lines.findIndex((l) => /^\s*key: nt\.lldp\.rem\.discovery\s*$/.test(l));
    if (ruleAt < 0) return null;
    for (let i = ruleAt; i < lines.length; i++) {
        // Nicht in die Prototypen hineinlaufen: dort gibt es kein LLD-Skript.
        if (/^\s*item_prototypes:/.test(lines[i])) return null;
        if (!/^\s*- type: JAVASCRIPT\s*$/.test(lines[i])) continue;
        let j = i + 1;
        while (j < lines.length && !/^\s*- \|\s*$/.test(lines[j])) j++;
        if (j >= lines.length) return null;
        const base = indentOf(lines[j]);
        const body = [];
        for (let k = j + 1; k < lines.length; k++) {
            if (lines[k].trim() !== '' && indentOf(lines[k]) <= base) break;
            body.push(lines[k]);
        }
        const filled = body.filter((l) => l.trim() !== '');
        if (filled.length === 0) return null;
        const cut = Math.min(...filled.map(indentOf));
        return body.map((l) => l.slice(cut)).join('\n');
    }
    return null;
}

// ── Die Prototyp-Regexe aus der Datei holen, je Spalte ───────────────────
function prototypeRegexes() {
    const out = {};
    for (const l of lines) {
        const m = /^\s*- '(\(\?m\)\^\\\.\?1\\\.0\\\.8802\\\.1\\\.1\\\.2\\\.1\\\.4\\\.1\\\.1\\\.(\d+)\\\..*)'\s*$/.exec(l);
        if (m) out[m[2]] = m[1].replace(/''/g, "'");   // YAML: '' ist ein '
    }
    return out;
}

function compile(pcre, port, remidx) {
    let src = pcre;
    let flags = '';
    if (src.startsWith('(?m)')) { src = src.slice(4); flags = 'm'; }
    src = src.split('{#NT_PORT}').join(port).split('{#NT_REMIDX}').join(remidx);
    if (src.includes('{#')) abort(`unbekanntes LLD-Makro im Muster: ${pcre}`);
    return new RegExp(src, flags);
}

// Nachbau von SNMP_WALK_TO_JSON fuer die SysName-Spalte (.9) — so wie der
// erste Schritt der Discovery-Regel es konfiguriert.
function walkToJson(walk) {
    const rows = [];
    for (const l of walk.split('\n')) {
        const m = /^\.?1\.0\.8802\.1\.1\.2\.1\.4\.1\.1\.9\.([\d.]+) = [A-Za-z0-9-]+: "?(.*?)"?$/.exec(l);
        if (m) rows.push({ '{#SNMPINDEX}': m[1], '{#NT_SYSNAME}': m[2] });
    }
    return JSON.stringify(rows);
}

console.log('\ncheck-template-logic: LLDP-Template gegen echte Walks\n');

const js = lldJavaScript();
if (js === null) abort('Discovery-JavaScript von nt.lldp.rem.discovery nicht gefunden — Template umgebaut?');
const regexes = prototypeRegexes();
const cols = Object.keys(regexes).sort((a, b) => a - b);
if (cols.join(',') !== '5,7,8,9,10,12') {
    abort(`erwartet sechs Prototyp-Regexe fuer die Spalten 5,7,8,9,10,12, gefunden: ${cols.join(',') || 'keine'}`);
}

// Beide Helfer fangen Fehler ab und melden sie als FAIL, statt abzustuerzen.
// Bei der Gegenprobe gegen das alte Template brach das Skript sonst am ersten
// leeren Ergebnis ab — und die Pruefung der sechs Regexe, die zweite Haelfte
// von Issue #15, lief nie.
function discover(walk) {
    try {
        // eslint-disable-next-line no-new-func -- genau das ist der Zweck: den Code aus dem Template ausfuehren
        return JSON.parse(new Function('value', js)(walkToJson(walk)));
    } catch (e) {
        check(`Discovery-Skript laeuft ohne Fehler: ${e.message}`, false, true);
        return [];
    }
}
function extract(walk, col, port, remidx) {
    try {
        const m = compile(regexes[col], port, remidx).exec(walk);
        return m ? m[1] : null;
    } catch (e) {
        return `<Muster ungueltig: ${e.message}>`;
    }
}

// ── TP-Link JetStream: zweiteiliger Index, aus Issue #15 ─────────────────
const TPLINK = [
    '.1.0.8802.1.1.2.1.4.1.1.5.25.1 = Hex-STRING: 3C 52 A1 00 00 01',
    '.1.0.8802.1.1.2.1.4.1.1.7.25.1 = STRING: "Gi1/0/48"',
    '.1.0.8802.1.1.2.1.4.1.1.8.5.1 = STRING: "port-five"',
    '.1.0.8802.1.1.2.1.4.1.1.8.25.1 = STRING: "gigabitEthernet 1/0/25"',
    '.1.0.8802.1.1.2.1.4.1.1.9.5.1 = STRING: "U7-Pro-HALA-8-9"',
    '.1.0.8802.1.1.2.1.4.1.1.9.20.1 = STRING: "U7-Pro-HALA-2-4"',
    '.1.0.8802.1.1.2.1.4.1.1.9.25.1 = STRING: "Serwerownia_Lewa_Gora"',
    '.1.0.8802.1.1.2.1.4.1.1.10.25.1 = STRING: "JetStream 28-Port Gigabit L2+ Managed Switch"',
    '.1.0.8802.1.1.2.1.4.1.1.12.25.1 = Hex-STRING: 28 00'
].join('\n');

console.log('  TP-Link JetStream — Index ohne TimeMark');
let d = discover(TPLINK);
check('drei Nachbarn entdeckt', d.length, 3);
check('Index auf 0.Port.RemIndex normalisiert',
      d.map((r) => r['{#SNMPINDEX}']), ['0.5.1', '0.20.1', '0.25.1']);
const row25 = d.find((r) => r['{#SNMPINDEX}'] === '0.25.1') || {};
check('Port- und RemIndex-Makro', [row25['{#NT_PORT}'], row25['{#NT_REMIDX}']], ['25', '1']);
check('alle sechs Spalten fuer Port 25', cols.map((c) => extract(TPLINK, c, '25', '1')), [
    '3C 52 A1 00 00 01', 'Gi1/0/48', 'gigabitEthernet 1/0/25',
    'Serwerownia_Lewa_Gora', 'JetStream 28-Port Gigabit L2+ Managed Switch', '28 00'
]);
check('Port 5 greift nicht auf Port 25', extract(TPLINK, '8', '5', '1'), 'port-five');

// ── FortiGate: dreiteilig, TimeMark wechselt — darf sich nicht aendern ───
const FORTI = [
    '.1.0.8802.1.1.2.1.4.1.1.8.1234.5.1 = STRING: "Gi0/5"',
    '.1.0.8802.1.1.2.1.4.1.1.8.1240.25.1 = STRING: "Gi0/25"',
    '.1.0.8802.1.1.2.1.4.1.1.9.1234.5.1 = STRING: "sw-a"',
    '.1.0.8802.1.1.2.1.4.1.1.9.1240.25.1 = STRING: "sw-b"'
].join('\n');

console.log('\n  FortiGate — Index mit TimeMark, Verhalten unveraendert');
d = discover(FORTI);
check('zwei Nachbarn, TimeMark verworfen', d.map((r) => r['{#SNMPINDEX}']), ['0.5.1', '0.25.1']);
check('Port 5 PortDesc', extract(FORTI, '8', '5', '1'), 'Gi0/5');
check('Port 25 PortDesc', extract(FORTI, '8', '25', '1'), 'Gi0/25');

// ── Die Faelle, bei denen eine optionale Gruppe falsch greifen koennte ───
console.log('\n  TimeMark gleich einer Portnummer');
const EVIL = [
    '.1.0.8802.1.1.2.1.4.1.1.8.5.25.1 = STRING: "WRONG-this-is-port-25"',
    '.1.0.8802.1.1.2.1.4.1.1.8.7.5.1 = STRING: "right-port-5"'
].join('\n');
check('Suche nach Port 5 trifft nicht TimeMark 5', extract(EVIL, '8', '5', '1'), 'right-port-5');
check('TM 5 / Port 1 / Rem 7 ist nicht Port 5 / Rem 1',
      extract('.1.0.8802.1.1.2.1.4.1.1.8.5.1.7 = STRING: "x"', '8', '5', '1'), null);

console.log('\n  Seen-Guard');
d = discover('.1.0.8802.1.1.2.1.4.1.1.9.10.25.1 = STRING: "old"\n'
           + '.1.0.8802.1.1.2.1.4.1.1.9.99.25.1 = STRING: "new"');
check('dieselbe Zeile unter zwei TimeMarks: die hoechste gewinnt',
      d.map((r) => r['{#NT_SYSNAME}']), ['new']);

if (failures > 0) {
    console.log(`\ncheck-template-logic: ${failures} Fehler.`);
    process.exit(1);
}
console.log('\ncheck-template-logic: Discovery und alle sechs Prototypen verhalten sich wie erwartet.');
