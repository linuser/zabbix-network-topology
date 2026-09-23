#!/usr/bin/env node
// sync-widget-shared.mjs — schreibt den geteilten Datenzugriff aus
// tools/widget-shared.js in die vier Widget-Dateien.
//
// WARUM ERZEUGEN STATT NACHLADEN
// ------------------------------
// Zabbix' jsLoader kennt keine ES-Module, Widgets koennen den Code des
// Hauptmoduls also nicht importieren. window.NtWidgetData lag deshalb
// byteweise identisch in vier Dateien; ci:parity hat das bewacht, aber eine
// Aenderung blieb eine Aenderung an vier Stellen — und wer eine vergisst,
// merkt es erst im Gate.
//
// Hier wird stattdessen erzeugt. Der Ablauf ist derselbe wie beim Bundle:
// die Quelle liegt woanders, das Ergebnis liegt im Commit, und ein Gate
// prueft, dass beides zusammenpasst.
//
// Aufruf: node tools/sync-widget-shared.mjs [--pruefen]
//   --pruefen  schreibt nicht, sondern meldet mit Exit 1, wenn etwas
//              auseinanderlaeuft (fuer die CI).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUELLE = join(ROOT, 'tools/widget-shared.js');
const ZIELE = [
    'widget/assets/js/widget.class.js',
    'widget_health/assets/js/widget.class.js',
    'widget_table/assets/js/widget.class.js',
    'widget_kpi/assets/js/widget.class.js',
];
// Derselbe Ausdruck wie in check-parity.mjs — zwei Ausdruecke waeren zwei
// Stellen, an denen sich die Blockgrenze verschieben kann.
const BLOCK = /if \(!window\.NtWidgetData\) \{[\s\S]*?\n\}\n/;
const MARKE = '// ERZEUGT aus tools/widget-shared.js — dort bearbeiten, nicht hier.\n';

const pruefen = process.argv.includes('--pruefen');

const quelle = readFileSync(QUELLE, 'utf8');
const m = quelle.match(BLOCK);
if (!m) {
    console.error('✗ tools/widget-shared.js enthaelt keinen NtWidgetData-Block.');
    process.exit(1);
}
const block = m[0];

let abweichend = 0;
let geschrieben = 0;
for (const rel of ZIELE) {
    const pfad = join(ROOT, rel);
    const alt = readFileSync(pfad, 'utf8');
    const treffer = alt.match(BLOCK);
    if (!treffer) {
        console.error(`✗ ${rel}: Block nicht gefunden`);
        process.exit(1);
    }
    // Marke direkt ueber dem Block, aber AUSSERHALB davon: sie darf den
    // Vergleich nicht veraendern.
    const mitMarke = alt.includes(MARKE)
        ? alt
        : alt.replace(BLOCK, MARKE + block);
    const neu = mitMarke.replace(BLOCK, block);
    if (neu === alt) continue;
    abweichend++;
    if (pruefen) {
        console.error(`✗ ${rel}: weicht von tools/widget-shared.js ab`);
        continue;
    }
    writeFileSync(pfad, neu);
    geschrieben++;
    console.log(`  → ${rel}`);
}

if (pruefen && abweichend > 0) {
    console.error('  npm run build schreibt sie zurecht.');
    process.exit(1);
}
console.log(pruefen
    ? '✓ geteilter Datenzugriff: vier Kopien wie die Quelle.'
    : `✓ geteilter Datenzugriff verteilt (${geschrieben} Datei(en) geaendert).`);
