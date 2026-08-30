#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
//
// check-ci — prueft die .gitlab-ci.yml auf die Fehler, die die CI lautlos
// abschalten.
//
// ANLASS
// ------
// Eine explizite stages-Liste ERSETZT GitLabs Defaults (.pre/build/test/
// deploy/.post). Als der parity-Job mit "stage: test" dazukam, stand test
// nicht in der Liste. GitLab ueberspringt so einen Job nicht — es weist die
// GESAMTE Pipeline als ungueltig ab.
//
// Ergebnis: 32 Commits lang lief keine einzige Pipeline, und nichts wurde rot.
// Ein kaputtes Gate meldet sich nicht; es schweigt. Genau deshalb muss diese
// Pruefung LOKAL laufen und nicht nur in der CI — eine CI, die sich selbst
// pruefen soll, kann das nicht mehr, sobald sie ungueltig ist.
//
// Bewusst ohne YAML-Bibliothek: der Build haengt an esbuild und sonst nichts,
// und die geprueften Stellen (Jobs auf oberster Ebene, stage:-Zeilen, stages-
// Liste) sind ohne Parser eindeutig zu erkennen. Ein Gate, das eine echte
// Fehlerklasse zuverlaessig faengt, ist mehr wert als eines, das alles halb
// prueft.
//
// Vier Regeln, jede aus einem realen Fehler:
//   1. Jede von einem Job benutzte Stage muss deklariert sein.
//   2. Jede referenzierte Datei (tools/*.mjs, *.sh) muss existieren.
//   3. Jedes per "npm run" aufgerufene Skript muss in package.json stehen.
//   4. Jedes tools/check-* muss von der CI ueberhaupt aufgerufen werden —
//      sonst schreibt jemand ein Gate, das nie laeuft.
//
// Aufruf: node tools/check-ci.mjs

import { readFileSync, existsSync, readdirSync } from 'node:fs';

const CI_FILE = '.gitlab-ci.yml';
let failures = 0;

function fail(msg) {
    console.log(`  [FAIL] ${msg}`);
    failures++;
}

if (!existsSync(CI_FILE)) {
    fail(`${CI_FILE} fehlt — wurde die Datei verschoben?`);
    process.exit(1);
}

const text = readFileSync(CI_FILE, 'utf8');

// ── stages-Liste ───────────────────────────────────────────────────────────
const stages_block = text.match(/^stages:\n((?:[ \t]+-.*\n)+)/m);
const stages = stages_block
    ? [...stages_block[1].matchAll(/-\s*(\S+)/g)].map((m) => m[1])
    : [];

if (!stages.length) {
    // Ohne stages-Liste gelten GitLabs Defaults — dann ist Regel 1 hinfaellig,
    // aber das ist eine bewusste Entscheidung und kein Fehler.
    console.log('  [ ok ] keine stages-Liste — GitLab-Defaults gelten');
}

// ── Jobs auf oberster Ebene ────────────────────────────────────────────────
// Schluesselwoerter, die zwar oben stehen, aber keine Jobs sind.
const RESERVED = new Set([
    'stages', 'default', 'workflow', 'include', 'variables', 'image',
    'services', 'before_script', 'after_script', 'cache', 'pages'
]);

const jobs = [...text.matchAll(/^([a-z][a-z0-9_.-]*):[ \t]*$/gm)]
    .map((m) => m[1])
    .filter((j) => !RESERVED.has(j));

if (!jobs.length) fail('keine Jobs gefunden — Format geaendert?');

// Regel 1 — jede benutzte Stage ist deklariert
if (stages.length) {
    for (const job of jobs) {
        const block = text.match(
            new RegExp(`^${job.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}:\\n((?:(?:[ \\t].*)?\\n)*)`, 'm')
        );
        if (!block) continue;
        const st = block[1].match(/^[ \t]+stage:[ \t]*(\S+)/m);
        if (!st) continue;   // ohne stage: gilt GitLabs Default ("test")
        if (!stages.includes(st[1])) {
            fail(
                `Job "${job}" benutzt stage "${st[1]}", die nicht deklariert ist. `
                + `Deklariert sind: ${stages.join(', ')}. `
                + 'GitLab weist damit die GESAMTE Pipeline ab, nicht nur diesen Job.'
            );
        }
    }
}

// Regel 2 — referenzierte Dateien existieren
const files = new Set(
    [...text.matchAll(/(?:node|bash|sh)\s+((?:tools\/)?[\w.-]+\.(?:mjs|js|sh))/g)].map((m) => m[1])
);
for (const f of [...files].sort()) {
    if (!existsSync(f)) fail(`${CI_FILE} ruft ${f} auf — die Datei existiert nicht`);
}

// Regel 3 — aufgerufene npm-Skripte existieren
let pkg_scripts = {};
try {
    pkg_scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts || {};
}
catch (e) {
    fail(`package.json nicht lesbar: ${e.message}`);
}
for (const s of [...new Set([...text.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]))].sort()) {
    if (!(s in pkg_scripts)) fail(`${CI_FILE} ruft "npm run ${s}" auf — steht nicht in package.json`);
}

// Regel 4 — kein Gate, das nie laeuft
let tools = [];
try {
    tools = readdirSync('tools').filter((f) => /^check-.*\.(mjs|sh)$/.test(f));
}
catch (e) { /* kein tools/ — dann gibt es auch nichts zu pruefen */ }

for (const t of tools.sort()) {
    // check-ci selbst muss nicht in der CI stehen: der Job kann gar nicht mehr
    // laufen, sobald die Datei ungueltig ist. Das Gate gehoert vor den Push.
    if (t === 'check-ci.mjs') continue;
    if (!text.includes(`tools/${t}`)) {
        fail(`tools/${t} existiert, wird aber von ${CI_FILE} nie aufgerufen — ein Gate, das nie laeuft`);
    }
}

console.log('');
if (failures) {
    console.log(`check-ci: ${failures} Problem(e) — die Pipeline liefe so nicht (oder nicht vollstaendig).`);
    process.exit(1);
}
console.log(
    `check-ci: ${jobs.length} Job(s) ueber ${stages.length} Stage(s), `
    + `${files.size} Datei-Referenz(en), ${tools.length - 1} Gate(s) verdrahtet — alles konsistent.`
);
