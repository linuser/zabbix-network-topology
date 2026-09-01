#!/usr/bin/env node
//
// check-i18n.mjs — findet deutsche Texte, die im UI landen.
//
// ANLASS
// ------
// Das Modul ist zweisprachig dokumentiert, aber im Code war Deutsch stehen
// geblieben: PHP-Fehlermeldungen, Tabellenkoepfe, Widget-Meldungen. Eine
// handgepflegte Liste davon lag monatelang herum und war beim Nachpruefen an
// vier Stellen falsch — zwei Eintraege waren Kommentare, drei Strings fehlten
// ganz, und saemtliche Zeilennummern hatten sich verschoben. Genau dafuer ist
// ein Gate da: eine Liste, die niemand pflegt, ist keine.
//
// WARUM EIN EIGENER STRING-EXTRAKTOR
// ----------------------------------
// Mit grep geht es nicht. Die beiden Fallen, in die ich beim Aufraeumen
// selbst getappt bin:
//
//   let x = false;  // Toggle "nur Offline-Hosts zeigen"
//
// Deutsch, aber ein Kommentar am ZEILENENDE — Kommentare duerfen deutsch
// sein, das ist im Projekt so gewollt. Ein '^\s*//'-Filter sieht ihn nicht.
//
//   url: 'https://tiles.stadiamaps.com/...'
//
// Enthaelt '//' mitten im String. Wer Kommentare stumpf ab '//' abschneidet,
// zerlegt den String und meldet Unsinn.
//
// Deshalb laeuft hier ein kleiner Zeichen-Scanner, der weiss, ob er gerade in
// einem String oder in einem Kommentar steht. Er liefert nur echte
// String-Literale mit korrekter Zeilennummer.
//
// WIE ERKANNT WIRD
// ----------------
// Umlaute/ss, plus eine Liste deutscher Woerter — CASE-INSENSITIV. Auch das
// ein selbst gemachter Fehler: die erste Fassung war case-sensitiv und uebersah
// 'Ohne Domain-Whitelist...', weil nur 'ohne' in der Liste stand.
//
// Das ist eine Heuristik, kein Beweis. Sie faengt neuen deutschen Text, weil
// der praktisch immer einen Umlaut oder ein Funktionswort enthaelt. Was sie
// nicht faengt, faengt der naechste Leser — dann gehoert das Wort in die Liste.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

// Verzeichnisse, die nie geprueft werden.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'tests', 'tools', '.github']);

// Dateien, in denen Deutsch HINGEHOERT — oder die uns nicht gehoeren.
const ERLAUBT = [
    'assets/js/modules/i18n/de.js',  // das deutsche Woerterbuch selbst
    'assets/js/cytoscape.min.js'     // Fremdbibliothek, minifiziert
];

// Minifizierte Dateien haben keine sinnvollen Zeilennummern und sind fremd.
const istMinifiziert = (rel) => rel.endsWith('.min.js');

const WOERTER = [
    // Funktionswoerter — der zuverlaessigste Marker
    'nicht', 'oder', 'und', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein',
    'eine', 'einen', 'einem', 'einer', 'kein', 'keine', 'keinen', 'wird',
    'werden', 'wurde', 'wurden', 'kann', 'konnte', 'koennen', 'muss', 'musste',
    'ist', 'sind', 'war', 'waren', 'hier', 'dass', 'auch', 'noch', 'schon',
    'beim', 'zum', 'zur', 'vom', 'von', 'aus', 'fuer', 'gegen', 'ohne', 'mehr',
    'bitte', 'nur', 'alle', 'allen', 'jede', 'jeder', 'mit', 'bei', 'nach',
    'vor', 'seit', 'sich', 'wenn', 'dann', 'als', 'wie', 'sowie', 'bereits',
    // Begriffe, die im UI vorkamen
    'fehler', 'wert', 'werte', 'wartung', 'verbindung', 'verbindungen',
    'positionen', 'anzahl', 'auswahl', 'summe', 'quote', 'latenz', 'diagnose',
    'knoten', 'kante', 'kanten', 'karte', 'ebene', 'stunde', 'letzter',
    'letzten', 'gemeldet', 'angelegt', 'gefunden', 'erreichbar', 'eingefroren',
    'gespeichert', 'geaendert', 'fehlgeschlagen', 'schliessen', 'zeigen',
    'laden', 'kostenlos', 'kostenloser', 'erscheinen', 'benoetigen',
    'mindestens', 'berechtigung', 'schreibberechtigung', 'aufrufe'
];

const UMLAUT = /[äöüÄÖÜß]/;

// Deutsche Substantiv-Endungen. Faengt die Klasse, die eine Wortliste immer
// nur einzeln nachtraegt: 'Zusammenfassung' stand im Diag-Tab und rutschte
// durch die erste Fassung dieses Gates, weil das Wort nicht in WOERTER stand
// und keinen Umlaut hat. Aufgefallen erst im laufenden Browser.
// Bewusst NICHT dabei: '-nis' ('tennis'), '-tum' ('momentum', 'quantum'),
// '-ion'/'-tat' — alle zu nah am Englischen. Nachgemessen, nicht geraten.
const ENDUNG = /\b[A-ZÄÖÜ][a-zäöüß]{3,}(ung|heit|keit|schaft)\b/;

// Deutsch in ASCII-Umschrift. Der blinde Fleck der beiden Regeln oben: 'Laedt'
// hat keinen Umlaut und steht in keiner Wortliste — es stand dreimal als
// Ladehinweis im Code und fiel erst im Browser auf, nicht im Gate.
const UMSCHRIFT = /\b(laedt|laeuft|waehl|zaehl|hoeh|groess|schliess|muess|koenn|aender|geaendert|naechst|ueber|fuer|moeglich|pruef|vollstaendig|ungueltig|zurueck|loeschen|hinzufuegen)/i;
const WORT_RX = new RegExp('(^|[^a-zA-ZäöüÄÖÜß])(' + WOERTER.join('|') + ')($|[^a-zA-ZäöüÄÖÜß])', 'i');

function istDeutsch(text) {
    if (UMLAUT.test(text)) return true;
    if (ENDUNG.test(text)) return true;
    if (UMSCHRIFT.test(text)) return true;
    return WORT_RX.test(text);
}

/**
 * Liefert alle String-Literale einer Quelldatei als {zeile, text}.
 *
 * Der Scanner kennt vier Zustaende: Code, einzeiliger Kommentar,
 * Blockkommentar, String. Nur im Zustand "String" wird gesammelt. Damit sind
 * '//' in URLs und Deutsch in Zeilenend-Kommentaren beide korrekt behandelt.
 */
function stringLiterale(src, php) {
    const out = [];
    let i = 0, zeile = 1;
    const n = src.length;
    // Letztes bedeutsames Zeichen — entscheidet, ob ein '/' eine Regex
    // beginnt oder eine Division ist. Ohne das reisst  replace(/'/g, ...)
    // den String-Zustand auf: das Anfuehrungszeichen IN der Regex wird als
    // String-Beginn gelesen und verschluckt den halben Rest der Datei.
    let vorher = '';

    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];

        if (c === '\n') { zeile++; i++; continue; }
        if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }

        // Kommentare
        if (c === '/' && c2 === '/') {
            while (i < n && src[i] !== '\n') i++;
            continue;
        }
        if (php && c === '#') {
            while (i < n && src[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && c2 === '*') {
            i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
                if (src[i] === '\n') zeile++;
                i++;
            }
            i += 2;
            continue;
        }

        // Regex-Literal (nur JS). Ein '/' beginnt eine Regex, wenn davor ein
        // Operator, eine oeffnende Klammer o.ae. stand — nach einem Bezeichner
        // oder einer schliessenden Klammer waere es eine Division.
        if (!php && c === '/' && (vorher === '' || '(,=:[!&|?{};+-*%~^<>'.includes(vorher))) {
            i++;
            let klasse = false;
            while (i < n) {
                if (src[i] === '\\') { i += 2; continue; }
                if (src[i] === '[') klasse = true;
                else if (src[i] === ']') klasse = false;
                else if (src[i] === '/' && !klasse) { i++; break; }
                else if (src[i] === '\n') { zeile++; break; }   // unbalanciert: abbrechen
                i++;
            }
            while (i < n && /[gimsuyd]/.test(src[i])) i++;       // Flags
            vorher = '/';
            continue;
        }

        // String-Literale
        if (c === "'" || c === '"' || c === '`') {
            const quote = c;
            const start = zeile;
            let buf = '';
            i++;
            while (i < n) {
                if (src[i] === '\\') { buf += src[i + 1] ?? ''; i += 2; continue; }
                if (src[i] === quote) { i++; break; }
                if (src[i] === '\n') zeile++;
                buf += src[i];
                i++;
            }
            out.push({ zeile: start, text: buf });
            vorher = quote;
            continue;
        }

        vorher = c;
        i++;
    }
    return out;
}

function dateien(dir, acc = []) {
    for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name)) continue;
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) dateien(p, acc);
        else if (name.endsWith('.php') || name.endsWith('.js')) acc.push(p);
    }
    return acc;
}

let treffer = 0;
let geprueft = 0;

console.log('\ncheck-i18n: deutsche Texte im UI\n');

for (const abs of dateien(ROOT).sort()) {
    const rel = relative(ROOT, abs);
    if (ERLAUBT.includes(rel) || istMinifiziert(rel)) continue;
    geprueft++;
    const src = readFileSync(abs, 'utf8');
    const funde = stringLiterale(src, rel.endsWith('.php'))
        .filter((s) => s.text.trim().length >= 3 && istDeutsch(s.text));
    for (const f of funde) {
        console.log(`  ${rel}:${f.zeile}  ${f.text.trim().slice(0, 90)}`);
        treffer++;
    }
}

if (treffer > 0) {
    console.log(`\ncheck-i18n: ${treffer} deutsche(r) String(s) in ${geprueft} Dateien.`);
    console.log('Hauptmodul-JS: ueber t(), Schluessel in de.js UND en.js.');
    console.log('PHP: _(\'English\') — wie in NetworkTopologyLinks.php:119.');
    console.log('Widgets: schlicht Englisch, dort gibt es kein t().');
    process.exit(1);
}

console.log(`check-i18n: kein deutscher UI-Text (${geprueft} Dateien).`);
