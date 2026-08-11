#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
//
// check-templates — prueft, ob die mitgelieferten Zabbix-Templates die
// Gruppen-UUID tragen, ohne die Zabbix 7.0 den Import abweist.
//
// Anlass: zwei der drei Templates hatten in template_groups keinen uuid-Eintrag.
// Zabbix lehnte sie ab mit
//
//   Invalid tag "/zabbix_export/template_groups/template_group(1)":
//   the tag "uuid" is missing.
//
// waehrend INSTALL.md beide als Schritt 4 zum Import empfiehlt. Aufgefallen ist
// das erst, als jemand den dokumentierten Weg gegangen ist — in die Dateien hat
// nie eine Pruefung gesehen.
//
// BEWUSST ENG
// -----------
// Dieses Skript validiert NICHT das Schema. Ein erster Versuch tat das
// zeilenweise und produzierte 21 Falschtreffer: ohne echten Parser sind Makros,
// Widget-Felder und Beschreibungszeilen nicht von Listeneintraegen zu
// unterscheiden. Eine YAML-Bibliothek nur fuer ein Gate waere ein schlechter
// Tausch — der Build haengt an esbuild und sonst nichts.
//
// Geprueft wird deshalb genau die eine Stelle, die gebrochen ist: die
// Gruppenliste direkt unter zabbix_export. Sie steht immer am Dateianfang, auf
// fester Einrueckung, und ist ohne Parser eindeutig zu erkennen. Ein Gate, das
// eine echte Fehlerklasse zuverlaessig faengt, ist mehr wert als eines, das
// alles halb prueft.
//
// Zwei Regeln:
//   1. Jeder Gruppeneintrag braucht ein uuid.
//   2. Derselbe Gruppenname braucht ueberall dasselbe uuid. Beim ersten Anlauf
//      hatten die zwei reparierten Dateien frei erzeugte uuids bekommen und
//      damit drei verschiedene fuer dieselbe Gruppe "Templates". Zabbix ordnet
//      Gruppen ueber das uuid zu, nicht ueber den Namen — das haette beim
//      Import auf eine Gruppe gezeigt, die es nicht gibt.
//
// Aufruf: node tools/check-templates.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
let checked  = 0;

// Gruppenname -> { uuid, file } des ersten Vorkommens
const groupUuids = new Map();

/**
 * Sucht "  template_groups:" bzw. "  host_groups:" (zwei Leerzeichen, direkt
 * unter zabbix_export) und prueft jeden Eintrag der Liste auf ein uuid.
 *
 * Die Liste endet bei der naechsten Zeile mit hoechstens derselben
 * Einrueckung, die kein Listeneintrag ist.
 */
function checkGroups(file, text) {
    const lines = text.split('\n');
    const problems = [];
    let found = false;

    for (let i = 0; i < lines.length; i++) {
        if (!/^ {2}(template_groups|host_groups):\s*$/.test(lines[i])) continue;
        found = true;

        let n = 0;
        for (let j = i + 1; j < lines.length; j++) {
            const line = lines[j];
            if (!line.trim()) continue;

            // Ende der Liste: irgendetwas auf Ebene 2 oder flacher
            if (!/^ {4}/.test(line)) break;

            // Ein Eintrag beginnt mit "    - "
            if (!/^ {4}- /.test(line)) continue;

            // Block des Eintrags einsammeln: die Startzeile plus alle Zeilen
            // mit sechs Leerzeichen Einrueckung, bis der naechste Eintrag kommt.
            let block = line;
            for (let k = j + 1; k < lines.length; k++) {
                if (/^ {6}\S/.test(lines[k])) { block += '\n' + lines[k]; continue; }
                break;
            }

            const name = (block.match(/name:\s*'?([^'\n]+)'?/) || [, '?'])[1].trim();
            const uuid = (block.match(/\buuid:\s*([0-9a-f]{32})\b/) || [, null])[1];

            if (uuid === null) {
                problems.push(`uuid fehlt: ${name} (Zeile ${j + 1})`);
            }
            else {
                const prev = groupUuids.get(name);
                if (!prev) {
                    groupUuids.set(name, { uuid, file });
                }
                else if (prev.uuid !== uuid) {
                    problems.push(
                        `uuid weicht ab: ${name} (Zeile ${j + 1}) hat ${uuid}, `
                        + `${prev.file} hat ${prev.uuid}`
                    );
                }
            }
            n++;
        }

        if (n === 0) {
            problems.push('Gruppenliste ist leer');
        }
    }

    if (!found) {
        // Dashboards und andere Exporte haben keine Gruppenliste — kein Fehler.
        return null;
    }

    checked++;

    if (problems.length) {
        console.log(`  [FAIL] ${file}`);
        for (const p of problems) console.log(`         ${p}`);
        failures += problems.length;
    }
    else {
        console.log(`  [PASS] ${file}`);
    }
    return problems.length === 0;
}

let seen = 0;
for (const dir of ['templates', 'dashboards']) {
    let entries;
    try {
        entries = readdirSync(dir);
    }
    catch (e) {
        continue;
    }
    // Sortiert, damit bei abweichenden uuids immer dieselbe Datei als
    // Referenz genannt wird und die Meldung nicht mit der Dateisystem-
    // Reihenfolge wechselt.
    for (const f of entries.filter((x) => /\.ya?ml$/.test(x)).sort()) {
        const path = join(dir, f);
        const r = checkGroups(path, readFileSync(path, 'utf8'));
        if (r === null) console.log(`  [ ok ] ${path} (keine Gruppenliste)`);
        seen++;
    }
}

// Findet das Skript gar nichts, ist das ein Fehler und kein Durchlauf — sonst
// bestuende das Gate stillschweigend weiter, nachdem jemand die Dateien
// verschoben hat.
if (seen === 0) {
    console.log('  [FAIL] keine Template-Dateien gefunden — Pfade geaendert?');
    failures++;
}

console.log('');
if (failures) {
    console.log(`check-templates: ${failures} Problem(e) — das weist Zabbix beim Import ab.`);
    process.exit(1);
}
console.log(`check-templates: ${checked} Datei(en) mit Gruppenliste geprueft, alle importierbar.`);
