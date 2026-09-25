#!/usr/bin/env node
// sync-widget-shared.mjs — schreibt den geteilten Widget-Code aus
// tools/widget-shared.js in die Widget-Dateien (NtFetchJson in alle fuenf,
// NtWidgetData in vier).
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
const VIER = [
    'widget/assets/js/widget.class.js',
    'widget_health/assets/js/widget.class.js',
    'widget_table/assets/js/widget.class.js',
    'widget_kpi/assets/js/widget.class.js',
];
// Zwei Bloecke, verschiedene Ziele: NtFetchJson braucht auch widget_items
// (eigene Action, derselbe 504), NtWidgetData ist auf network.topology.data
// zugeschnitten und gehoert dort nicht hin.
//
// Die Ausdruecke stehen wortgleich in check-parity.mjs — zwei Ausdruecke
// waeren zwei Stellen, an denen sich die Blockgrenze verschieben kann.
const BLOCKS = [
    { name: 'NtFetchJson',  re: /if \(!window\.NtFetchJson\) \{[\s\S]*?\n\}\n/,
      ziele: [...VIER, 'widget_items/assets/js/widget.class.js'] },
    { name: 'NtWidgetData', re: /if \(!window\.NtWidgetData\) \{[\s\S]*?\n\}\n/,
      ziele: VIER },
];
const MARKE = '// ERZEUGT aus tools/widget-shared.js — dort bearbeiten, nicht hier.\n';

const pruefen = process.argv.includes('--pruefen');

const quelle = readFileSync(QUELLE, 'utf8');

let abweichend = 0;
let geschrieben = 0;
for (const { name, re, ziele } of BLOCKS) {
    const m = quelle.match(re);
    if (!m) {
        console.error(`✗ tools/widget-shared.js enthaelt keinen ${name}-Block.`);
        process.exit(1);
    }
    const block = m[0];
    for (const rel of ziele) {
        const pfad = join(ROOT, rel);
        const alt = readFileSync(pfad, 'utf8');
        const treffer = alt.match(re);
        if (!treffer) {
            console.error(`✗ ${rel}: ${name}-Block nicht gefunden`);
            process.exit(1);
        }
        // Marke direkt ueber dem Block, aber AUSSERHALB davon: sie darf den
        // Vergleich nicht veraendern. Pro Block pruefen, nicht pro Datei —
        // mit zwei Bloecken haette die Marke des ersten sonst die des
        // zweiten verhindert.
        const vorher = alt.slice(0, treffer.index);
        const neu = vorher.endsWith(MARKE)
            ? alt.replace(re, () => block)
            : alt.replace(re, () => MARKE + block);
        if (neu === alt) continue;
        abweichend++;
        if (pruefen) {
            console.error(`✗ ${rel}: ${name} weicht von tools/widget-shared.js ab`);
            continue;
        }
        writeFileSync(pfad, neu);
        geschrieben++;
        console.log(`  → ${rel} (${name})`);
    }
}

if (pruefen && abweichend > 0) {
    console.error('  npm run build schreibt sie zurecht.');
    process.exit(1);
}
console.log(pruefen
    ? '✓ geteilter Widget-Code: alle Kopien wie die Quelle.'
    : `✓ geteilter Widget-Code verteilt (${geschrieben} Block/Bloecke geaendert).`);
