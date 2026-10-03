#!/usr/bin/env node
// erzeuge-oui.mjs — aus der IEEE-Registrierung eine kleine Herstellertabelle.
//
// WOZU
// ----
// Ein unueberwachter Nachbar meldet ueber LLDP seine Chassis-ID, und das ist
// fast immer eine MAC. Deren erste drei Bytes sind die Hersteller-Kennung
// (OUI). Damit wird aus "unbekanntes Geraet an sw-og-2, Port 8" ein
// "Ubiquiti-Geraet an sw-og-2, Port 8" — und das ist oft schon die Antwort
// auf "was steckt da eigentlich".
//
// WARUM EIN GENERATOR UND KEINE HANDGESCHRIEBENE LISTE
// ----------------------------------------------------
// Eine Tabelle aus dem Gedaechtnis zu tippen hiesse, Hersteller-Zuweisungen
// zu RATEN. Ein falscher Hersteller ist schlimmer als keiner: er sieht aus
// wie eine Auskunft. Die Eintraege kommen deshalb aus der IEEE-Registrierung,
// und diese Datei haelt fest, WANN und WOHER.
//
// WARUM NICHT DIE GANZE LISTE
// ---------------------------
// Die Registrierung hat ueber 35 000 Eintraege und knapp 4 MB. Das Bundle ist
// 417 KB gross — die vollstaendige Tabelle waere ein Vielfaches des Moduls,
// fuer eine Nebenauskunft. Aufgenommen wird deshalb eine BENANNTE Auswahl:
// Hersteller von Netz- und Infrastrukturtechnik, plus die haeufigsten
// Endgeraete-Hersteller. Was nicht drin ist, liefert keine Auskunft — und
// das ist in der Oberflaeche sichtbar, statt still falsch zu raten.
//
// Aufruf:
//   curl -s -o /tmp/oui.csv https://standards-oui.ieee.org/oui/oui.csv
//   node tools/erzeuge-oui.mjs /tmp/oui.csv
//
// Schreibt assets/js/modules/oui-table.js.

import { readFileSync, writeFileSync } from 'node:fs';

// Die Auswahl. Jeder Eintrag ist ein Praefix, das gegen den Organisations-
// namen geprueft wird (klein geschrieben, Anfang des Namens).
//
// DIE NAMEN SIND IN DER REGISTRIERUNG NACHGESEHEN, NICHT GERATEN — und das
// ist noetiger, als es klingt. Beim ersten Anlauf standen hier 'mikrotik',
// 'supermicro', 'hikvision' und 'dahua', und keiner davon traf etwas: die
// Firmen sind als "Routerboard.com", "Super Micro Computer", "Hangzhou
// Hikvision Digital Technology" und "Zhejiang Dahua Technology" eingetragen.
// 'unifi' war schlimmer — es traf "Unifiedgateways India Private Limited",
// also eine Firma, die mit Ubiquitis UniFi nichts zu tun hat.
//
// Deshalb meldet der Generator am Ende jeden Eintrag, der NICHTS getroffen
// hat. Ein toter Eintrag sieht sonst aus wie eine Abdeckung, die es nicht
// gibt.
//
// NETZTECHNIK ZUERST: fuer dieses Modul ist der interessante Geist ein
// Switch, Router oder Access Point, den niemand ueberwacht. Endgeraete
// stehen dahinter, weil ihre Hersteller die Liste sonst dominieren.
const HERSTELLER = [
    // Netz- und Sicherheitstechnik
    'cisco', 'juniper', 'arista', 'extreme', 'brocade',
    'hewlett packard', 'hp inc', 'ubiquiti', 'routerboard',
    'tp-link', 'd-link', 'netgear', 'zyxel', 'edgecore', 'ruckus',
    'fortinet', 'palo alto', 'sophos', 'watchguard', 'checkpoint',
    'check point', 'sonicwall', 'lancom', 'teltonika', 'draytek',
    'huawei', 'new h3c', 'alcatel', 'avaya', 'nokia', 'ericsson',
    'allied telesis', 'planet technology', 'tenda', 'engenius',
    'cambium', 'devolo', 'avm',
    // Server, Speicher, Virtualisierung
    'dell', 'super micro', 'lenovo', 'ibm', 'fujitsu', 'inspur',
    'synology', 'qnap', 'netapp', 'vmware', 'nutanix',
    // Stromversorgung und Gebaeudetechnik
    'apc', 'american power', 'eaton', 'schneider', 'socomec',
    'siemens', 'phoenix contact', 'moxa', 'advantech', 'wago', 'beckhoff',
    // Kameras, Drucker, Telefonie
    'axis communications', 'hangzhou hikvision', 'zhejiang dahua',
    'mobotix', 'bosch security',
    'brother', 'kyocera', 'canon', 'seiko epson', 'lexmark', 'xerox', 'ricoh',
    'konica', 'zebra technologies', 'snom', 'yealink', 'grandstream',
    'polycom', 'gigaset',
    // Verbreitete Endgeraete
    'apple', 'intel', 'realtek', 'broadcom', 'microsoft', 'samsung',
    'raspberry pi', 'espressif', 'sonos', 'google', 'amazon technologies',
];

const quelle = process.argv[2];
if (!quelle) {
    console.error('Aufruf: node tools/erzeuge-oui.mjs <oui.csv>');
    process.exit(2);
}

const zeilen = readFileSync(quelle, 'utf8').split('\n');

// CSV von IEEE: Registry,Assignment,Organization Name,Organization Address
// Der Name kann in Anfuehrungszeichen stehen und Kommata enthalten.
function spalten(zeile) {
    const raus = [];
    let feld = '';
    let imQuote = false;
    for (let i = 0; i < zeile.length; i++) {
        const c = zeile[i];
        if (c === '"') {
            if (imQuote && zeile[i + 1] === '"') { feld += '"'; i++; }
            else imQuote = !imQuote;
        }
        else if (c === ',' && !imQuote) { raus.push(feld); feld = ''; }
        else feld += c;
    }
    raus.push(feld);
    return raus;
}

/**
 * Den Organisationsnamen auf etwas kuerzen, das in eine Zeile passt.
 *
 * Die Registrierung fuehrt vollstaendige Firmierungen ("Cisco Systems, Inc",
 * "Hewlett Packard Enterprise"). Auf der Karte steht daneben schon ein
 * Geraetename und ein Port; was zaehlt, ist der Hersteller, nicht die
 * Rechtsform.
 */
function kuerze(name) {
    let n = name.trim();
    // \b VOR der Gruppe ist tragend: ohne sie schnitt die Regel das "co" aus
    // "Cisco" heraus, und in der Tabelle stand "Cis Systems". Ein verstuemmelter
    // Herstellername ist dieselbe Sorte Fehler wie ein falscher — er sieht aus
    // wie eine Auskunft.
    n = n.replace(/[,.]?\s+\b(inc|incorporated|corp|corporation|co|company|ltd|limited|gmbh|ag|sa|bv|llc|plc|pte|kg|oy|ab)\b\.?/gi, '');
    n = n.replace(/\s+/g, ' ').replace(/[\s,]+$/, '').trim();
    return n.slice(0, 28);
}

const tabelle = {};
const treffer = {};
let gesamt = 0;
let genommen = 0;

for (const zeile of zeilen) {
    if (!zeile || zeile.startsWith('Registry,')) continue;
    const f = spalten(zeile);
    if (f.length < 3) continue;
    const zuweisung = (f[1] || '').trim().toUpperCase();
    const org = (f[2] || '').trim();
    if (!/^[0-9A-F]{6}$/.test(zuweisung) || !org) continue;
    gesamt++;
    const klein = org.toLowerCase();
    const passt = HERSTELLER.find((h) => klein.startsWith(h));
    if (!passt) continue;
    treffer[passt] = (treffer[passt] || 0) + 1;
    const kurz = kuerze(org);
    if (!kurz) continue;
    tabelle[zuweisung] = kurz;
    genommen++;
}

const sortiert = {};
Object.keys(tabelle).sort().forEach((k) => { sortiert[k] = tabelle[k]; });

const kopf = `// UNGENUTZT — die Tabelle wird als JSON geschrieben, siehe unten.
// oui-table.js — ERZEUGT, NICHT VON HAND GEPFLEGT.
//
// Quelle:  https://standards-oui.ieee.org/oui/oui.csv
// Stand:   ${new Date().toISOString().slice(0, 10)}
// Erzeugt: node tools/erzeuge-oui.mjs <oui.csv>
//
// Eine AUSWAHL, nicht die Registrierung: ${genommen} von ${gesamt} Zuweisungen,
// gefiltert auf Hersteller von Netz- und Infrastrukturtechnik plus die
// haeufigsten Endgeraete-Hersteller. Die vollstaendige Liste waere ein
// Vielfaches des Moduls, fuer eine Nebenauskunft.
//
// Was hier NICHT drinsteht, liefert keine Auskunft — und das ist in der
// Oberflaeche sichtbar, statt still falsch zu raten. Die Auswahlliste steht
// im Generator; wer einen Hersteller vermisst, ergaenzt sie dort und laesst
// ihn neu laufen.

export const OUI = `;

// ALS JSON, NICHT ALS MODUL — und damit NICHT im Bundle.
//
// Die Tabelle wird nur gebraucht, wenn jemand sich einen unueberwachten
// Nachbarn ansieht. Sie ins Bundle zu legen hiesse, sie jedem Seitenaufruf
// aufzubuerden, auch dem, der nie einen Geist anklickt. Stattdessen holt
// oui.js sie beim ersten Nachschlagen — einmal, danach aus dem Browser-Cache
// (der Webserver liefert die Modul-Assets mit vierzehn Tagen Cache-Header).
//
// Hersteller EINMAL, die Kennungen als zusammenhaengende Hex-Kette: bei ueber
// zehntausend Zuweisungen sparen die weggelassenen Anfuehrungszeichen und
// Kommata mehr als die Haelfte.
const nachHersteller = {};
Object.keys(sortiert).sort().forEach((oui) => {
    const v = sortiert[oui];
    nachHersteller[v] = (nachHersteller[v] || '') + oui;
});

const meta = {
    _quelle: 'https://standards-oui.ieee.org/oui/oui.csv',
    _stand: new Date().toISOString().slice(0, 10),
    _hinweis: 'Auswahl, nicht die Registrierung: '
        + genommen + ' von ' + gesamt + ' Zuweisungen. Erzeugt von '
        + 'tools/erzeuge-oui.mjs; die Auswahlliste steht dort.',
    v: nachHersteller,
};
writeFileSync('assets/js/modules/oui-table.json', JSON.stringify(meta));

console.log(`oui-table.json: ${genommen} von ${gesamt} Zuweisungen, `
    + `${Object.keys(nachHersteller).length} Hersteller`);

// TOTE EINTRAEGE MELDEN. Ein Praefix, das nichts trifft, sieht in der Liste
// aus wie eine Abdeckung — und genau so sind beim ersten Anlauf vier
// Hersteller durchgefallen, ohne dass es jemandem aufgefallen waere.
const tot = HERSTELLER.filter((h) => !treffer[h]);
if (tot.length) {
    console.log(`\nOhne Treffer (${tot.length}) — Firmierung pruefen:`);
    console.log('  ' + tot.join(', '));
}
