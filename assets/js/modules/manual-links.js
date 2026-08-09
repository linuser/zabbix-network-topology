// manual-links.js — Stern-Modus zum manuellen Verbinden von Hosts.
//
// Der Link-Modus ist ein Toolbar-Button, der einen alternativen Klick-Modus
// aktiviert: der erste Klick wählt eine Quelle, jeder weitere Klick eine
// Ziel-Edge. ESC oder Quelle-nochmal beendet den Modus.
//
// State (Modul-privat) — Setter und Getter exportiert, damit der Cytoscape-
// Click-Handler im Hauptmodul den State manipulieren kann ohne direkten
// Variablenzugriff:
//   _linkMode   — bool, ob wir gerade im Link-Modus sind
//   _linkFirst  — die Source-Node (Cytoscape-Node-Object)

import { fmt } from './utils.js';
import { loadLinks, setLinkErrorHandler } from './storage.js';
import { toast } from './toast.js';
import { t } from './i18n.js';

// storage.js schreibt optimistisch: die Kante erscheint sofort, der POST laeuft
// hinterher. Scheitert er, rollt storage.js den Speicher zurueck und meldet es
// hier — sonst haette der Nutzer eine Kante vor sich, die es serverseitig nicht
// gibt, und wuerde es erst beim naechsten Laden merken. Der Umweg ueber einen
// Handler haelt storage.js frei von Toast- und Uebersetzungswissen.
setLinkErrorHandler(function(err) {
    toast(t('links.save_failed', { err: (err && err.message) || '?' }), 'error', 6000);
    if (window._ntCy) {
        window._ntCy.edges('[id^="ml_"]').remove();
        applyManualLinks(window._ntCy);
    }
});

let _linkMode  = false;
let _linkFirst = null;

export function isLinkModeActive() { return _linkMode; }
export function getLinkFirst()     { return _linkFirst; }
export function setLinkFirst(n)    { _linkFirst = n; }

export function enterLinkMode() {
    _linkMode = true;
    _linkFirst = null;
}

export function exitLinkMode() {
    _linkMode = false;
    if (_linkFirst) {
        try { _linkFirst.style('underlay-opacity', 0); } catch (e) {}
        _linkFirst = null;
    }
    if (window._ntCy) {
        window._ntCy.nodes('[!isGroup]').forEach(function(n) { n.style('opacity', 1); });
    }
    const bLinkBtn = document.getElementById('nt-btn-link');
    if (bLinkBtn) {
        bLinkBtn.style.background = '';
        bLinkBtn.style.color = '';
        bLinkBtn.textContent = 'Link';
    }
    const wrap = document.getElementById('nt-canvas-wrap');
    if (wrap) wrap.style.cursor = '';
}

// Label für eine Edge zwischen zwei Hosts. Zeigt:
//  - "⚠ No Connection" wenn einer der beiden Disaster-Severity hat
//  - sonst Pfeil-IN/OUT-Traffic-Mittelwerte (formatiert) oder leer
export function edgeLabel(cyInst, srcId, tgtId) {
    const sn = cyInst.getElementById(String(srcId)).data();
    const tn = cyInst.getElementById(String(tgtId)).data();
    if ((sn.severity || 0) >= 5 || (tn.severity || 0) >= 5) return '\u26A0 No Connection';
    const tIn  = ((sn.traffic && sn.traffic.in)  || 0) + ((tn.traffic && tn.traffic.in)  || 0);
    const tOut = ((sn.traffic && sn.traffic.out) || 0) + ((tn.traffic && tn.traffic.out) || 0);
    return (tIn || tOut) ? '\u2193' + fmt(tIn / 2) + '\n\u2191' + fmt(tOut / 2) : '';
}

// Persistierte manuelle Links nach (Re-)Render wieder einfügen
export function applyManualLinks(cyInst) {
    const links = loadLinks();
    const existingIds = {};
    cyInst.edges().forEach(function(e) { existingIds[e.id()] = true; });
    links.forEach(function(l) {
        const id = 'ml_' + l.s + '_' + l.t;
        if (existingIds[id]) return;
        if (!cyInst.getElementById(String(l.s)).length) return;
        if (!cyInst.getElementById(String(l.t)).length) return;
        const ml2 = edgeLabel(cyInst, l.s, l.t);
        cyInst.add({
            data: { id: id, source: String(l.s), target: String(l.t), tLabel: ml2,
                    // Ebene mitgeben: geteilte Kanten werden anders gezeichnet
                    // als persoenliche, sonst ist nicht erkennbar, was fuer alle
                    // gilt und was nur die eigene Notiz ist.
                    mlScope: l.scope || 'personal',
                    trafficIn: 0, trafficOut: 0 }
        });
    });
}
