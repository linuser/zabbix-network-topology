// netbox.js — Kabelliste im Importformat von NetBox.
//
// WOZU
// ----
// Die Karte kennt die ECHTE Verkabelung, NetBox die dokumentierte. Diese
// Datei ist die billige Haelfte der Bruecke: eine CSV, die der Admin in
// NetBox unter *Import* einspielt. Kein Token, keine Verbindung zu NetBox,
// keine neue Action — sie entsteht im Browser wie die GraphML-Datei.
//
// DIE NEBENWIRKUNG IST MEHR WERT ALS DIE DATEI. NetBox prueft beim Import
// jede Zeile selbst: unbekanntes Geraet, unbekanntes Interface, Interface
// schon belegt. Der erste Import ist damit ein Abgleich gegen die
// Dokumentation, ohne dass dieses Modul irgendetwas vergleicht — und er
// beantwortet mit echten Daten die teuerste Frage der Gegenrichtung, bevor
// jemand sie baut: passen Geraete- und Portnamen zwischen beiden Welten
// ueberhaupt zusammen?
//
// DIE SPALTEN SIND NACHGESEHEN, NICHT ERINNERT
// --------------------------------------------
// Aus CableImportForm in netbox/dcim/forms/bulk_import.py:
//
//   side_a_device, side_a_type, side_a_name,
//   side_b_device, side_b_type, side_b_name,
//   status, type, label, description
//
// side_*_type nimmt den Content-Type als "app.model", fuer Interfaces also
// 'dcim.interface'. status kennt 'connected', 'planned' und
// 'decommissioning' (LinkStatusChoices).
//
// Das Formular kennt mehr Spalten (site, power_panel, tenant, profile,
// bundle, owner, color, length …). Hier stehen nur die, die es seit
// Jahren gibt und die wir fuellen koennen — ein Export mit Spalten, die
// die eingesetzte NetBox-Version noch nicht hat, scheitert im Ganzen.
//
// 'type' bleibt LEER. Welches Kabel physisch steckt — cat6a, smf-os2,
// dac-passive — steht in keiner SNMP-Tabelle. Aus 10 Gbit/s auf Glas zu
// schliessen waere geraten, und geraten gehoert nicht in eine
// Dokumentation, die danach als Wahrheit gilt.

import { t } from './i18n.js';

/** Content-Type einer Interface-Terminierung in NetBox. */
const TERM_TYP = 'dcim.interface';

/** Ab dieser Konfidenz gilt eine einseitig gemeldete Kante als sicher genug. */
export const NETBOX_MIN_KONFIDENZ = 80;

const SPALTEN = [
    'side_a_device', 'side_a_type', 'side_a_name',
    'side_b_device', 'side_b_type', 'side_b_name',
    'status', 'type', 'label', 'description',
];

/** Ein CSV-Feld nach RFC 4180: nur quoten, wenn noetig. */
function feld(wert) {
    const s = String(wert === undefined || wert === null ? '' : wert);
    return /[",\n\r]/.test(s) ? '"' + s.split('"').join('""') + '"' : s;
}

/**
 * Kabelliste bauen.
 *
 * Erwartet die ROHDATEN vom Backend, nicht die gezeichnete Karte. Der
 * Unterschied ist nicht akademisch: in der Gruppenansicht stehen dort
 * Gruppenknoten, und eine CSV mit Gruppennamen statt Geraeten waere Unsinn,
 * der wie ein Ergebnis aussieht. Genau dieser Fehler stand bis 5.3.1 in den
 * Berichten (window._ntNodes statt _ntRawNodes).
 *
 * @param {Array} nodes Rohknoten (brauchen id und host)
 * @param {Array} edges Rohkanten (from/to oder source/target, ports, confirmed)
 * @return {{csv: ?string, gesamt: number, geschrieben: number,
 *           ohnePorts: number, unsicher: number, ohneHost: number}}
 */
export function buildNetboxCsv(nodes, edges) {
    const hostVon = {};
    (nodes || []).forEach(function(n) {
        if (!n || n._isGhost || n._isInternet || n.isGroup) return;
        const name = n.host || '';
        if (name) hostVon[String(n.id)] = name;
    });

    const zeilen = [];
    let ohnePorts = 0, unsicher = 0, ohneHost = 0;
    const alle = edges || [];

    alle.forEach(function(e) {
        const aId = String(e.source || e.from || '');
        const bId = String(e.target || e.to || '');
        const aHost = hostVon[aId];
        const bHost = hostVon[bId];
        // Geister und Gruppen haben kein Geraet in NetBox, auf das sich ein
        // Kabel beziehen koennte. Und ein Kabel braucht zwei Enden.
        if (!aHost || !bHost || aHost === bHost) { ohneHost++; return; }

        const ports = e.ports || {};
        const aPort = ports[aId] || '';
        const bPort = ports[bId] || '';
        // Regel 1: ohne Port auf BEIDEN Seiten ist es kein Kabel. UniFi-
        // Uplinks, manuelle Verbindungen und nt:parent-Kanten sind Beziehungen,
        // keine Leitungen. Gezaehlt, nicht still verschluckt.
        if (!aPort || !bPort) { ohnePorts++; return; }

        // Regel 2: ein Kabel in NetBox ist eine Tatsachenbehauptung. Ein
        // falsches schadet mehr als ein fehlendes, denn es sieht aus wie eine
        // Messung. Also nur beidseitig bestaetigt — oder, wenn nur eine Seite
        // meldet, oberhalb der Konfidenzschwelle.
        const konf = (typeof e.confidence === 'number') ? e.confidence : null;
        const sicher = e.confirmed === true
            || (konf !== null && konf >= NETBOX_MIN_KONFIDENZ);
        if (!sicher) { unsicher++; return; }

        const quellen = (e.src || []).join('+').toUpperCase() || 'LLDP';
        const herkunft = quellen
            + (e.confirmed === true ? ', both ends' : ', one end')
            + (konf !== null ? ', confidence ' + konf : '')
            + ' (Network Topology)';

        zeilen.push([
            aHost, TERM_TYP, aPort,
            bHost, TERM_TYP, bPort,
            // Gemessen heisst gesteckt. 'planned' waere falsch: die Leitung
            // traegt Verkehr, sonst haette niemand einen Nachbarn gemeldet.
            'connected',
            '',            // type — siehe Kopf: nicht erfunden
            '',            // label — vergibt der Betreiber, nicht wir
            herkunft,
        ].map(feld).join(','));
    });

    return {
        csv: zeilen.length ? SPALTEN.join(',') + '\n' + zeilen.join('\n') + '\n' : null,
        gesamt: alle.length,
        geschrieben: zeilen.length,
        ohnePorts: ohnePorts,
        unsicher: unsicher,
        ohneHost: ohneHost,
    };
}

/** Was im Hinweis nach dem Export steht — gezaehlt, nicht verschwiegen. */
export function netboxBericht(r) {
    return t('export.netbox.done', {
        n: r.geschrieben,
        skipped: r.ohnePorts + r.unsicher + r.ohneHost,
        ports: r.ohnePorts,
        unsure: r.unsicher,
        ghost: r.ohneHost,
    });
}
