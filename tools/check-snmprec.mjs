#!/usr/bin/env node
// check-snmprec.mjs — prueft die simulierten Geraete in tools/devnet/geraete.
//
// WARUM ES DIESEN GATE GIBT
// -------------------------
// snmpsim liest eine .snmprec-Datei als sortierten Index und meldet fuer alles,
// was es nicht versteht, schlicht "No Such Instance". Kein Fehler, kein Logeintrag
// an der Stelle, an der man ihn sucht — die Discovery in Zabbix findet einfach
// nichts, und man sucht den Fehler im Modul.
//
// Genau das ist passiert: eine Datei schrieb ihre Hex-Werte als "4x|0x00112233",
// mit 0x-Praefix. snmpsim konnte die Zeile nicht lesen, der gesamte CDP-Zweig
// fiel aus, und die Suche danach hat eine Stunde gekostet. Die anderen vier
// Dateien machten es richtig. Ein Blick auf die Zeile haette gereicht — wenn
// jemand hingeschaut haette.
//
// Geprueft wird deshalb:
//   1. Aufbau     OID|TAG|WERT, drei Felder, OID rein numerisch
//   2. Reihenfolge  numerisch aufsteigend (snmpsim sucht binaer)
//   3. Hex-Werte  Tag 4x/6x: nur Hex-Ziffern und Leerzeichen, KEIN 0x
//   4. Doppelte   dieselbe OID zweimal
//
// Aufruf: node tools/check-snmprec.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const VERZEICHNIS = 'tools/devnet/geraete';
const ZEILE = /^([0-9]+(?:\.[0-9]+)*)\|([0-9]+x?e?)\|(.*)$/;

function oidTeile(oid) {
    return oid.split('.').map(Number);
}

// Numerischer OID-Vergleich. Ein String-Vergleich waere falsch: "10" kaeme vor
// "9", und die Datei liefe an einer Stelle aus der Ordnung, die niemand sieht.
function vergleiche(a, b) {
    const x = oidTeile(a), y = oidTeile(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const va = x[i] === undefined ? -1 : x[i];
        const vb = y[i] === undefined ? -1 : y[i];
        if (va !== vb) return va - vb;
    }
    return 0;
}

let fehler = 0;
const melde = (datei, nr, text) => {
    console.error(`  ${datei}:${nr}  ${text}`);
    fehler++;
};

let dateien = [];
try {
    dateien = readdirSync(VERZEICHNIS).filter((d) => d.endsWith('.snmprec')).sort();
} catch {
    console.error(`${VERZEICHNIS} fehlt — nichts zu pruefen.`);
    process.exit(0);
}

for (const datei of dateien) {
    const zeilen = readFileSync(join(VERZEICHNIS, datei), 'utf8').split('\n');
    const gesehen = new Map();
    let vorige = null;

    zeilen.forEach((zeile, i) => {
        const nr = i + 1;
        if (zeile.trim() === '') {
            // Leerzeilen sind harmlos, aber nur am Dateiende sinnvoll.
            if (i < zeilen.length - 1) melde(datei, nr, 'Leerzeile mitten in der Datei');
            return;
        }
        const m = ZEILE.exec(zeile);
        if (!m) {
            melde(datei, nr, `kein gueltiges OID|TAG|WERT: ${zeile.slice(0, 60)}`);
            return;
        }
        const [, oid, tag, wert] = m;

        if (gesehen.has(oid)) {
            melde(datei, nr, `OID ${oid} steht schon in Zeile ${gesehen.get(oid)}`);
        } else {
            gesehen.set(oid, nr);
        }

        if (vorige !== null && vergleiche(vorige, oid) >= 0) {
            melde(datei, nr, `nicht aufsteigend: ${oid} nach ${vorige} — snmpsim findet dahinter nichts mehr`);
        }
        vorige = oid;

        if (tag.endsWith('x')) {
            if (/0x/i.test(wert)) {
                melde(datei, nr, `Hex-Wert mit 0x-Praefix (${wert.slice(0, 20)}) — snmpsim liest die Zeile nicht`);
            } else if (!/^[0-9a-fA-F ]*$/.test(wert)) {
                melde(datei, nr, `Tag ${tag} verlangt reine Hex-Ziffern, hier: ${wert.slice(0, 20)}`);
            } else if (wert.replace(/ /g, '').length % 2 !== 0) {
                melde(datei, nr, 'ungerade Zahl von Hex-Ziffern');
            }
        }
    });
}

if (fehler > 0) {
    console.error(`\n✖ ${fehler} Befund(e) in ${dateien.length} Geraetedatei(en).`);
    process.exit(1);
}
console.log(`✓ ${dateien.length} Geraetedatei(en) in Ordnung.`);
