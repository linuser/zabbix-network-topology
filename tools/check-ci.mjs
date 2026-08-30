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
// GESAMTE Pipeline als ungueltig ab. Ergebnis: 32 Commits lang lief keine
// einzige Pipeline, und nichts wurde rot. Ein kaputtes Gate meldet sich nicht;
// es schweigt.
//
// Die erste Fassung dieses Skripts hatte selbst sieben Loecher — sie ist an
// Trivialitaeten vorbeigelaufen, die genau dieselbe Ausfallklasse erzeugen:
// ein Leerzeichen hinter dem Jobnamen, Flow-Style-Listen, ein auskommentierter
// Job, ein Job ganz OHNE stage:-Zeile (GitLab macht daraus "test" — die
// Ausfallklasse von oben, nur implizit). Deshalb parst diese Fassung
// zeilenweise nach Einrueckung, statt pro Regel ein eigenes Muster zu raten.
//
// Bewusst ohne YAML-Bibliothek: der Build haengt an esbuild und sonst nichts.
// Geprueft werden nur Strukturen, die auf oberster Ebene und in fester
// Einrueckung stehen — die sind ohne Parser eindeutig.
//
// Fuenf Regeln, jede aus einem realen Fehler:
//   1. Jede von einem Job benutzte Stage ist deklariert — auch die IMPLIZITE
//      ("test"), wenn ein Job keine stage:-Zeile hat.
//   2. Jede referenzierte Datei existiert.
//   3. Jedes per "npm run" aufgerufene Skript steht in package.json.
//   4. Jedes tools/check-* wird von der CI aufgerufen — direkt oder ueber ein
//      npm-Skript.
//   5. Auskommentierter Code zaehlt nirgends als Referenz.
//
// Aufruf: node tools/check-ci.mjs  (aus jedem Verzeichnis)

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// Pfade an das Repository binden, nicht an das Arbeitsverzeichnis. Die erste
// Fassung war cwd-relativ und meldete aus tools/ heraus "keine .gitlab-ci.yml"
// — ein Gate, das je nach Startverzeichnis etwas anderes behauptet, ist wertlos.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CI_FILE = join(ROOT, '.gitlab-ci.yml');

let failures = 0;
const fail = (msg) => { console.log(`  [FAIL] ${msg}`); failures++; };

if (!existsSync(CI_FILE)) {
    fail('.gitlab-ci.yml fehlt — wurde die Datei verschoben?');
    process.exit(1);
}

const raw = readFileSync(CI_FILE, 'utf8');

/**
 * Kommentare entfernen, Zeilenstruktur erhalten.
 *
 * Regel 5. Ein auskommentierter Job zaehlte in der ersten Fassung als
 * "verdrahtet", weil stumpf im Rohtext gesucht wurde — das Gate meldete gruen,
 * waehrend der Job gar nicht mehr lief. Ein '#' zaehlt nur als Kommentar, wenn
 * es am Zeilenanfang oder nach Leerraum steht; sonst waere '#{VAR}' oder eine
 * URL mit Anker betroffen.
 */
const stripped = raw.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '$1'));

// ── Struktur: Schluessel auf oberster Ebene und ihre Bloecke ───────────────
// Ein Job ist ein Schluessel ohne Einrueckung. Sein Block sind alle folgenden
// Zeilen, die eingerueckt oder leer sind. Trailing whitespace wird hier
// mitgenommen — die erste Fassung verlangte an einer Stelle "name:\n" exakt
// und uebersprang damit still jeden Job mit einem Leerzeichen dahinter.
const top = [];
for (let i = 0; i < stripped.length; i++) {
    const m = stripped[i].match(/^([A-Za-z_.][\w.\- ]*):[ \t]*(.*?)[ \t]*$/);
    if (!m) continue;
    const body = [];
    for (let j = i + 1; j < stripped.length; j++) {
        if (/^\s*$/.test(stripped[j])) { body.push(stripped[j]); continue; }
        if (/^[ \t]/.test(stripped[j])) { body.push(stripped[j]); continue; }
        break;
    }
    top.push({ name: m[1].trim(), inline: m[2], body: body.join('\n') });
}

// ── stages-Liste ───────────────────────────────────────────────────────────
// Beide Schreibweisen. Flow-Style ("stages: [lint, build]") ergab in der
// ersten Fassung eine leere Liste, worauf das Skript beruhigend "keine
// stages-Liste" meldete und Regel 1 ueberging — ein kosmetischer Reformat
// haette das Gate entschaerft. Blank- und Kommentarzeilen innerhalb der Liste
// brachen sie ausserdem vorzeitig ab und erzeugten Falschtreffer.
const stages_entry = top.find((e) => e.name === 'stages');
let stages = [];
let stages_declared = false;
if (stages_entry) {
    stages_declared = true;
    const flow = stages_entry.inline.match(/^\[(.*)\]$/);
    stages = flow
        ? flow[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
        : [...stages_entry.body.matchAll(/^[ \t]+-[ \t]*(\S+)/gm)]
              .map((m) => m[1].replace(/^['"]|['"]$/g, ''));
}

// ── Jobs ───────────────────────────────────────────────────────────────────
const RESERVED = new Set([
    'stages', 'default', 'workflow', 'include', 'variables', 'image',
    'services', 'before_script', 'after_script', 'cache'
    // 'pages' steht bewusst NICHT hier: das ist ein echter GitLab-Job.
]);
const jobs = top.filter((e) => !RESERVED.has(e.name) && !e.name.startsWith('.'));

if (!jobs.length) fail('keine Jobs gefunden — Format geaendert?');

// Regel 1
if (stages_declared) {
    for (const job of jobs) {
        const m = job.body.match(/^[ \t]+stage:[ \t]*(\S+)/m);
        // OHNE stage:-Zeile vergibt GitLab die Default-Stage "test". Die erste
        // Fassung nannte das im Kommentar und tat dann nichts — womit sie die
        // implizite Form derselben Ausfallklasse nicht sah.
        const stage = m ? m[1].replace(/^['"]|['"]$/g, '') : 'test';
        const implicit = m ? '' : ' (implizit, weil keine stage:-Zeile da ist)';
        if (!stages.includes(stage)) {
            fail(
                `Job "${job.name}" benutzt stage "${stage}"${implicit}, die nicht `
                + `deklariert ist. Deklariert sind: ${stages.join(', ')}. `
                + 'GitLab weist damit die GESAMTE Pipeline ab, nicht nur diesen Job.'
            );
        }
    }
}

// ── Referenzen einsammeln ──────────────────────────────────────────────────
let pkg_scripts = {};
try {
    pkg_scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts || {};
}
catch (e) {
    fail(`package.json nicht lesbar: ${e.message}`);
}

const code = stripped.join('\n');

// Regel 3 — und zugleich die Aufloesung fuer Regel 4: was "npm run ci:x"
// tatsaechlich startet, steht in package.json. Ohne diesen Schritt bestrafte
// die erste Fassung genau die Zusammenfassung, die der Rest der CI-Datei
// nahelegt: ein Job, der "npm run ci:parity" ruft, galt als "ruft
// check-parity.mjs nie auf".
const npm_calls = [...new Set([...code.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]))];
let resolved = code;
for (const s of npm_calls.sort()) {
    if (!(s in pkg_scripts)) fail(`.gitlab-ci.yml ruft "npm run ${s}" auf — steht nicht in package.json`);
    else resolved += '\n' + pkg_scripts[s];
}

// Regel 2 — \b vor dem Interpreter. Ohne die Wortgrenze matchte das schliessende
// "sh" eines Dateinamens als Interpreter: aus "shellcheck nt-install.sh
// nt-uninstall.sh" wurde "sh nt-uninstall.sh", womit nt-install.sh, deploy.sh
// und tools/*.sh nie geprueft wurden — obwohl ein fehlendes Skript in genau
// diesem Job schon einmal ein realer Vorfall war (3517069).
const files = new Set();
for (const m of resolved.matchAll(/(?:^|\s)(?:node|bash|sh|shellcheck)\s+((?:[.\w-]+\/)*[\w.-]+\.(?:mjs|js|sh))/g)) {
    files.add(m[1]);
}
// shellcheck bekommt mehrere Argumente hintereinander; die zaehlen auch.
for (const line of resolved.split('\n')) {
    if (!/\bshellcheck\s/.test(line)) continue;
    for (const m of line.matchAll(/(?:[.\w-]+\/)*[\w.-]+\.sh\b/g)) files.add(m[0]);
}
for (const f of [...files].sort()) {
    if (f.includes('*')) continue;                       // Glob, nicht pruefbar
    if (!existsSync(join(ROOT, f))) fail(`.gitlab-ci.yml ruft ${f} auf — die Datei existiert nicht`);
}

// Regel 4 — jedes Gate laeuft auch wirklich
let tools = [];
try {
    tools = readdirSync(join(ROOT, 'tools')).filter((f) => /^check-.*\.(mjs|sh)$/.test(f));
}
catch (e) { /* kein tools/ */ }

for (const t of tools.sort()) {
    // check-ci selbst ist ausgenommen: sobald die Datei ungueltig ist, laeuft
    // kein Job mehr — das Gate gehoert vor den Push, nicht in die Pipeline.
    // Damit es trotzdem nicht vergessen wird, prueft die Zeile darunter, dass
    // CONTRIBUTING es in der Pre-Push-Kette nennt.
    if (t === 'check-ci.mjs') continue;
    if (!resolved.includes(`tools/${t}`)) {
        fail(`tools/${t} existiert, wird aber von .gitlab-ci.yml nie aufgerufen — ein Gate, das nie laeuft`);
    }
}

// Das Gate gegen stille Ausfaelle darf nicht selbst still sein: es muss in der
// dokumentierten Pre-Push-Kette stehen, sonst ruft es niemand auf.
try {
    const contrib = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8');
    if (!/ci:pipeline/.test(contrib)) {
        fail('CONTRIBUTING.md nennt "npm run ci:pipeline" nicht — dieses Gate laeuft in keiner Pipeline, '
             + 'es muss also in der dokumentierten Pre-Push-Kette stehen, sonst ruft es niemand auf');
    }
}
catch (e) { /* keine CONTRIBUTING.md */ }

console.log('');
if (failures) {
    console.log(`check-ci: ${failures} Problem(e) — die Pipeline liefe so nicht (oder nicht vollstaendig).`);
    process.exit(1);
}
console.log(
    `check-ci: ${jobs.length} Job(s) ueber ${stages.length} Stage(s), `
    + `${files.size} Datei-Referenz(en), ${Math.max(0, tools.length - 1)} Gate(s) verdrahtet — alles konsistent.`
);
