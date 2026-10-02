#!/usr/bin/env node
// check-ghost.mjs — ein Geist ist kein Host, und zwar an jeder Stelle.
//
// WARUM ES DIESES GATE GIBT
// -------------------------
// Ein Geisterknoten — ein LLDP/CDP-Nachbar ohne eigenen Zabbix-Host — traegt
// severity 0. Nicht weil alles in Ordnung ist, sondern weil ueber ihn NICHTS
// BEKANNT ist. `SEV_LBL[0]` darauf angewendet schreibt "Normal" an ein Geraet,
// ueber das niemand etwas weiss.
//
// Das wurde einmal aus dem Feld gemeldet (gruene Pille "Normal" am
// Geisterknoten) — und entstand beim Bau der Tabellenansicht in 5.5.0 an
// FUENF weiteren Stellen neu: Statuspille, Zeilenzaehler, CSV-Export,
// Filterpille, Namenslink. Drei fielen erst in der Durchsicht auf, eine erst
// durch eine Rueckfrage.
//
// Fuenf Fundstellen fuer einen Begriff an einem Tag sind ein Messwert, kein
// Pech. Der Grund ist strukturell: die Entscheidung wurde an jeder Stelle neu
// getroffen. Seit 5.5.0 steht sie einmal in severity.js (istGeist,
// statusLabel, statusColor), und dieses Gate haelt sie dort.
//
// WAS ES PRUEFT
// -------------
// 1. SEV_LBL / SEV_COL duerfen nicht mit einer Severity AUS EINEM KNOTEN
//    indiziert werden. Genau diese Form kam dreimal vor
//    (`SEV_LBL[n.severity || 0]`). Statt dessen statusLabel()/statusColor().
// 2. Kein Modul haelt eine EIGENE Kopie von SEV_LBL oder SEV_COL. Zwei gab es
//    (export.js, render-stats.js), beide ohne Begruendung — anders als die
//    Widget-Duplikate, die dokumentiert sind und von ci:parity bewacht werden.
//
// WAS ES NICHT SIEHT, und das steht hier, damit niemand sich darauf verlaesst:
// die zweistufige Form `const s = n.severity || 0; … SEV_LBL[s]`. Sie zu
// erkennen hiesse, Datenfluss zu verfolgen; eine Grep-Regel, die es versucht,
// faengt dafuer legitime Stellen mit (eine Problem-Severity ist nie ein Geist,
// eine Filterpille iteriert ueber 0..5). Ein Gate ohne Fehlalarm, das die
// wiederkehrende Form faengt, ist mehr wert als eines mit Ausnahmeliste —
// Eintraege in einer solchen Liste sind hier ausdruecklich kein Weg.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR   = 'assets/js/modules';
const HEIM  = 'severity.js';          // wo die Aussage stehen darf
const NAMEN = ['SEV_LBL', 'SEV_COL'];

// SEV_LBL[ … severity … ]  — die Indizierung mit der Severity eines Knotens.
const INDIZIERT = new RegExp(
    '\\b(' + NAMEN.join('|') + ')\\s*\\[[^\\]]*\\bseverity\\b[^\\]]*\\]');

// const SEV_LBL = [ …  — eine eigene Kopie.
const EIGENE_KOPIE = new RegExp(
    '^\\s*(?:const|let|var)\\s+(' + NAMEN.join('|') + ')\\s*=');

const befunde = [];
let geprueft = 0;

for (const datei of readdirSync(DIR).filter((f) => f.endsWith('.js')).sort()) {
    if (datei === HEIM) {
        continue;
    }
    geprueft++;
    const zeilen = readFileSync(join(DIR, datei), 'utf8').split('\n');
    zeilen.forEach((zeile, i) => {
        // Kommentare zaehlen nicht: dieser Kopf hier nennt die Muster selbst,
        // und ein Hinweis darauf in einem anderen Modul ist kein Verstoss.
        const nackt = zeile.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
        if (INDIZIERT.test(nackt)) {
            befunde.push({
                datei, nr: i + 1, zeile: zeile.trim(),
                was: 'Severity eines Knotens direkt indiziert',
                statt: 'statusLabel(n) / statusColor(n) aus severity.js',
            });
        }
        if (EIGENE_KOPIE.test(nackt)) {
            befunde.push({
                datei, nr: i + 1, zeile: zeile.trim(),
                was: 'eigene Kopie von ' + nackt.match(EIGENE_KOPIE)[1],
                statt: "import { … } from './severity.js'",
            });
        }
    });
}

console.log('\ncheck-ghost: ein Geist ist kein Host\n');

if (befunde.length) {
    for (const b of befunde) {
        console.error(`  ${b.datei}:${b.nr}  ${b.was}`);
        console.error(`      ${b.zeile}`);
        console.error(`      -> ${b.statt}\n`);
    }
    console.error(`✖ ${befunde.length} Stelle(n). severity.js sagt, warum.`);
    process.exit(1);
}

console.log(`✓ Status kommt aus severity.js (${geprueft} Module geprueft).`);
