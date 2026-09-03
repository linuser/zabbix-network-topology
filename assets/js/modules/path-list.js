// path-list.js — der berechnete Pfad als LISTE, nicht nur als Hervorhebung.
//
// WARUM
// -----
// Der Pfad zwischen zwei Hosts wird seit jeher per BFS berechnet und auf der
// Karte eingefaerbt. Bei drei Hops liest man ihn dort noch ab; bei sieben, quer
// ueber eine grosse Karte, sucht man die cyanfarbene Kette zwischen hundert
// gedimmten Knoten zusammen. Und in ein Ticket kopieren kann man eine Farbe
// gar nicht.
//
// Die Zwischenschritte lagen die ganze Zeit vor: _findPath rekonstruiert sie
// ueber parent-Pointer und gab sie zurueck — sie wurden nur zum Einfaerben
// benutzt und danach verworfen (siehe getLastPath()).
//
// WAS "ZUSTAND JE LINK" HEISST
// ----------------------------
// Die offene Frage aus der ROADMAP. Die Antwort hier: dieselbe wie im
// Kanten-Panel, damit beide dasselbe sagen — Ports, Auslastung mit der Farbe
// aus derselben Stufentabelle, und ob die Zahl am Port gemessen oder aus den
// Knotensummen geschaetzt ist. Dazu ein Warnzeichen, wenn der Link Ports down,
// Fehler oder Verworfene meldet: in einer Liste, die man liest, um einen
// Engpass zu finden, ist das die eigentliche Auskunft.
//
// Gebaut mit createElement/textContent wie edge-detail.js — Portnamen kommen
// von fremden Geraeten, und ueber textContent stellt sich die Frage nicht.

import { fmt } from './utils.js';
import { t } from './i18n.js';
import { utilizationColor } from './traffic.js';
import { getLastPath } from './path-highlight.js';

function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css)  e.style.cssText = css;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
}

/** Auslastung einer Kante in Prozent, oder null wenn die Kapazitaet fehlt. */
function utilPct(d) {
    const cap = d.capBps || 0;
    if (cap <= 0) return null;
    const peak = Math.max(d.trafficIn || 0, d.trafficOut || 0);
    // Dieselbe Rechnung wie traffic.js und edge-detail.js: die Knotensumme
    // zaehlt beide Richtungen, die Per-Link-Metrik ist schon der Portwert.
    return Math.min(999, (peak / (d.perLink ? 1 : 2) / cap) * 100);
}

/**
 * Rendert den zuletzt berechneten Pfad ins Detail-Panel.
 * Gibt false zurueck, wenn es keinen gibt — dann bleibt das Panel unberuehrt.
 */
export function showPathList(panel, cy) {
    const path = getLastPath();
    if (!panel || !cy || !path || path.nodeIds.length < 2) return false;

    panel.style.display = 'block';
    panel.textContent = '';

    const head = el('div', 'display:flex;align-items:center;gap:7px;margin-bottom:6px');
    head.appendChild(el('div',
        'flex:1;min-width:0;font-size:13px;font-weight:600;color:#0f172a',
        t('path.title')));
    head.appendChild(el('span',
        'font-size:10px;color:#94a3b8;flex-shrink:0',
        t('path.hops', { n: path.edgeIds.length })));

    const close = el('button',
        'background:none;border:none;cursor:pointer;color:#94a3b8;font-size:18px;'
        + 'line-height:1;padding:0;flex-shrink:0', '✕');
    close.addEventListener('click', function(e) {
        e.stopPropagation();
        panel.style.display = 'none';
    });
    head.appendChild(close);
    panel.appendChild(head);

    const list = el('div', 'font-size:11px;line-height:1.5');

    path.nodeIds.forEach(function(nid, i) {
        const n = cy.getElementById(nid);
        const lbl = (n && n.length && n.data('label')) || nid;

        // Der Knoten selbst.
        const nodeRow = el('div', 'display:flex;align-items:center;gap:6px');
        nodeRow.appendChild(el('span',
            'width:7px;height:7px;border-radius:50%;background:#0891b2;flex-shrink:0'));
        nodeRow.appendChild(el('span', 'color:#0f172a;font-weight:600', lbl));
        list.appendChild(nodeRow);

        // Die Kante zum naechsten Knoten — die letzte Zeile hat keine.
        const eid = path.edgeIds[i];
        if (eid === undefined) return;
        const ed = cy.getElementById(eid);
        if (!ed || !ed.length) return;
        const d = ed.data();

        // Eingerueckt unter dem Knoten, mit einer Linie, die die Kette traegt.
        const linkRow = el('div',
            'display:flex;align-items:center;gap:6px;margin:1px 0 1px 3px;'
            + 'border-left:2px solid #cbd5e1;padding:2px 0 2px 8px;color:#475569');

        // Ports in LAUFRICHTUNG, nicht in der Speicherrichtung der Kante.
        // Cytoscape haelt source/target so, wie die Kante angelegt wurde —
        // laeuft der Pfad andersherum durch sie, standen local und remote
        // vertauscht da. Bei einem Pfad ueber mehrere Hops betraf das etwa die
        // Haelfte der Zeilen, und niemand haette es gemerkt.
        const vonHier = ed.source().id() === nid;
        const pS = (vonHier ? d.portSrc : d.portTgt) || '';
        const pT = (vonHier ? d.portTgt : d.portSrc) || '';
        if (pS || pT) {
            linkRow.appendChild(el('span', 'color:#64748b', (pS || '?') + ' → ' + (pT || '?')));
        }

        const pct = utilPct(d);
        if (pct !== null) {
            if (linkRow.childNodes.length) linkRow.appendChild(el('span', 'color:#cbd5e1', '·'));
            linkRow.appendChild(el('b', 'color:' + utilizationColor(pct), pct.toFixed(1) + '%'));
            if (!d.perLink) linkRow.appendChild(el('span', 'color:#94a3b8;font-size:10px', t('path.est')));
        } else if (d.trafficIn || d.trafficOut) {
            if (linkRow.childNodes.length) linkRow.appendChild(el('span', 'color:#cbd5e1', '·'));
            linkRow.appendChild(el('span', '', '↓' + fmt(d.trafficIn || 0) + ' ↑' + fmt(d.trafficOut || 0)));
        }

        // Das eigentliche Argument fuer die Liste: wo klemmt es auf dem Weg?
        const gestoert = (d.ifaceDown || 0) || (d.ifaceErr || 0) || (d.ifaceDrop || 0);
        if (gestoert) {
            const w = el('span', 'color:#c2410c;font-weight:700;flex-shrink:0', '⚠');
            w.title = t('path.link_trouble');
            linkRow.appendChild(w);
        }

        if (!linkRow.childNodes.length) {
            linkRow.appendChild(el('span', 'color:#94a3b8', t('path.no_data')));
        }
        list.appendChild(linkRow);
    });

    panel.appendChild(list);
    return true;
}
