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
// Vier Regeln, jede aus einem Fehler entstanden, der real passiert ist:
//   1. Jeder Gruppeneintrag braucht ein uuid.
//   2. Derselbe Gruppenname braucht ueberall dasselbe uuid.
//   3. Dasselbe uuid darf nur an EINEM Gruppennamen haengen.
//   4. JEDES uuid in der Datei muss ein echtes UUIDv4 sein.
//
// Regel 4 ist die, die am laengsten unentdeckt blieb, und sie betrifft nicht
// nur Gruppen. In den zwei kaputten Templates waren fuenf uuids von Hand
// getippt — durchlaufende Muster wie 8a2b3c4d5e6f47081920a1b2c3d4e5f6, die wie
// ein uuid aussehen. Zabbix prueft aber Version und Variante:
//
//   Invalid parameter "/2/uuid": UUIDv4 is expected.
//
// 32 Hex-Zeichen reichen also nicht. Das 13. Zeichen muss '4' sein (Version),
// das 17. eines von 8/9/a/b (Variante). Erzeugen mit
//   python3 -c "import uuid; print(uuid.uuid4().hex)"
// und nicht selbst ausdenken.
//
// Regel 3 kam als letzte dazu und faengt den teuersten Fehler. Beim Reparieren
// von Regel 1 wurde die uuid aus dem einen funktionierenden Template kopiert —
// in der Annahme, das sei die eingebaute uuid der Gruppe "Templates". Sie
// gehoert aber zu "Templates/Network devices". Damit trugen zwei verschiedene
// Gruppennamen dieselbe uuid, und Zabbix wies genau die zwei reparierten
// Dateien wieder ab. Regel 2 allein sah das nicht: sie prueft nur Name -> uuid.
//
// Die echten Werte stehen in der Datenbank, Tabelle hstgrp:
//   Templates                  79f31eeab03146229b1e019097fad672
//   Templates/Network devices  7df96b18c230490a9a0a9e2307226338
// Sie sind bei jeder Zabbix-Installation gleich — das ist der Sinn der uuid.
// Wer eine neue Gruppe braucht, holt ihr uuid dort und wuerfelt es nicht.
//
// Aufruf: node tools/check-templates.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
let checked  = 0;

// Gruppenname -> { uuid, file } des ersten Vorkommens
const groupUuids = new Map();

// und die Gegenrichtung: uuid -> { name, file }
const uuidGroups = new Map();

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

                const owner = uuidGroups.get(uuid);
                if (!owner) {
                    uuidGroups.set(uuid, { name, file });
                }
                else if (owner.name !== name) {
                    problems.push(
                        `uuid doppelt vergeben: ${uuid} (Zeile ${j + 1}) steht hier `
                        + `an "${name}", in ${owner.file} an "${owner.name}"`
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

/**
 * Regel 4 — gilt fuer JEDES uuid der Datei, nicht nur fuer Gruppen. Dafuer
 * braucht es keinen Parser: uuid-Zeilen sind eindeutig, egal wie tief sie
 * liegen. Die Zeilennummer macht den Fund auffindbar, der Name daneben
 * benennt das Objekt.
 */
function checkUuidFormat(file, text) {
    const lines = text.split('\n');
    const problems = [];

    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/\buuid:\s*(\S+)/);
        if (!m) continue;

        const u = m[1];
        let why = null;

        if (!/^[0-9a-f]{32}$/.test(u)) {
            why = 'kein 32-stelliger Hex-String';
        }
        else if (u[12] !== '4') {
            why = `Version-Nibble ist '${u[12]}', erwartet '4'`;
        }
        else if (!'89ab'.includes(u[16])) {
            why = `Varianten-Nibble ist '${u[16]}', erwartet 8/9/a/b`;
        }

        if (why) {
            // Der Name steht meist in der Folgezeile desselben Blocks.
            const ctx = (lines.slice(i, i + 3).join(' ')
                .match(/(?:name|template|key):\s*'?([^'\n]{1,60})/) || [, ''])[1].trim();
            problems.push(
                `kein UUIDv4: ${u} (Zeile ${i + 1}${ctx ? ', ' + ctx : ''}) — ${why}`
            );
        }
    }

    if (problems.length) {
        console.log(`  [FAIL] ${file}`);
        for (const p of problems) console.log(`         ${p}`);
        failures += problems.length;
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
        const text = readFileSync(path, 'utf8');

        // Regel 4 laeuft ueber jede Datei, auch ueber die ohne Gruppenliste —
        // ein Dashboard-Export traegt ebenfalls uuids.
        const fmt_ok = checkUuidFormat(path, text);

        const r = checkGroups(path, text);
        if (r === null && fmt_ok) {
            console.log(`  [ ok ] ${path} (keine Gruppenliste)`);
        }
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
