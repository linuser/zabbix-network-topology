// check-php-use.mjs — jede Zabbix-Klasse, die eine Datei benutzt, muss sie
// auch importieren.
//
// ANLASS
// ------
// Eine weisse Seite auf einer Produktionsinstanz. Der View-Controller rief
// CWebUser::$data auf, ohne dass die Klasse importiert war. Die Datei liegt in
// namespace Modules\NetworkTopology\Actions, PHP sucht die Klasse also unter
// Modules\NetworkTopology\Actions\CWebUser, findet nichts und beendet die
// Anfrage. Kein Log-Eintrag, keine Meldung — nur eine leere Seite.
//
// FUNKTIONEN fallen auf den globalen Namensraum zurueck, KLASSEN nicht. Das
// ist der ganze Unterschied, und er ist beim Schreiben unsichtbar.
//
// WARUM KEIN BESTEHENDES GATE DAS FAENGT
// --------------------------------------
// ci:lint-php ist `php -l`, ein reiner Syntaxpruefer. Die Syntax war
// einwandfrei; erst die Aufloesung zur Laufzeit schlaegt fehl. Alle Gates
// waren gruen, und die Seite war trotzdem tot.
//
// WAS GEPRUEFT WIRD
// -----------------
// Nur Dateien MIT namespace — im globalen Namensraum loest CXxx ohnehin
// global auf und es gibt nichts zu importieren.
//
// Gesucht werden Verweise auf Zabbix-Klassen (Konvention: C + Grossbuchstabe)
// und auf API. In Ordnung ist ein Verweis, wenn er
//   - importiert ist (use CXxx; oder use ... as CXxx;), ODER
//   - mit \ beginnt (\CXxx — ausdruecklich global), ODER
//   - im selben File definiert wird.
//
// Bewusst KEINE Vollstaendigkeit: das hier ersetzt kein PHPStan. Es schliesst
// genau die eine Luecke, die schon einmal eine Produktionsseite gekostet hat.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['actions', 'topology', 'views'];

let failures = 0;
let geprueft = 0;
const fail = (msg) => { console.log(`  [FAIL] ${msg}`); failures++; };

// Kommentare und Zeichenketten raus, sonst zaehlt ein Klassenname im
// Fliesstext eines Kommentars als Verweis — und davon hat dieses Projekt viele.
function entkerne(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')      // Blockkommentare
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')  // Zeilenkommentare
        .replace(/'(?:\\.|[^'\\])*'/g, "''")    // einfache Zeichenketten
        .replace(/"(?:\\.|[^"\\])*"/g, '""');   // doppelte
}

for (const dir of DIRS) {
    let dateien;
    try { dateien = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.php')); }
    catch { continue; }

    for (const datei of dateien) {
        const pfad = join(ROOT, dir, datei);
        const roh  = readFileSync(pfad, 'utf8');

        // Ohne namespace loest alles global auf — nichts zu tun.
        if (!/^namespace\s+/m.test(roh)) continue;
        geprueft++;

        const code = entkerne(roh);

        // Importe: use A\B\CXxx;  und  use A\B\X as CXxx;
        const importiert = new Set();
        for (const m of code.matchAll(/^use\s+([^;]+);/gm)) {
            const teil = m[1].trim();
            const as   = teil.match(/\s+as\s+([A-Za-z0-9_]+)$/i);
            importiert.add(as ? as[1] : teil.split('\\').pop().trim());
        }

        // Im File selbst definierte Klassen zaehlen ebenfalls.
        for (const m of code.matchAll(/^\s*(?:final\s+|abstract\s+)?class\s+([A-Za-z0-9_]+)/gm)) {
            importiert.add(m[1]);
        }

        // Verweise. Das fuehrende (^|[^\\\\$>a-zA-Z0-9_]) verhindert Treffer auf
        // \CXxx (ausdruecklich global), $CXxx und ->CXxx.
        const muster = /(^|[^\\$>\w])((?:C[A-Z]|API\b)[A-Za-z0-9_]*)\s*(::|\(|\s+\$)/g;
        const fehlend = new Set();
        for (const m of code.matchAll(muster)) {
            const name = m[2];
            if (!importiert.has(name)) fehlend.add(name);
        }

        for (const name of [...fehlend].sort()) {
            fail(`${dir}/${datei}: ${name} wird benutzt, aber nicht importiert `
               + `— "use ${name};" fehlt (oder \\${name} schreiben)`);
        }
    }
}

console.log(failures === 0
    ? `\ncheck-php-use: ${geprueft} Datei(en) mit namespace, alle Zabbix-Klassen importiert.`
    : `\ncheck-php-use: ${failures} fehlende(r) Import.`);
process.exit(failures === 0 ? 0 : 1);
