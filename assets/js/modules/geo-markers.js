// geo-markers.js — geteilte Leaflet-Bausteine für Geo- UND Plan-Modus.
//
// Herausgelöst aus render-geo.js (5.5.69), damit der Plan-Modus (Bild-Underlay
// mit CRS.Simple) exakt denselben Marker-, Popup- und Kantencode nutzt wie die
// Geomap — eine Quelle statt zweier Pfade, die auseinanderlaufen. Was hier liegt,
// kennt kein Koordinatensystem: Marker bekommen ihre LatLng vom Aufrufer (echte
// lat/lon im Geo-Modus, Bild-Pixel als CRS.Simple-LatLng im Plan-Modus).
//
// Leaflet ist als globales L verfügbar (lazy via ensureLeaflet geladen).

import { statusColor, statusLabel } from './severity.js';
import { fmt } from './utils.js';
import { t } from './i18n.js';

// Erzeugt einen kreisförmigen DivIcon-Marker mit Severity-Farbe.
// Größe wächst sanft mit Anzahl der Probleme (12px → 24px).
export function buildMarkerIcon(node, scale) {
    // scale < 1 verkleinert den Marker (Plan-Modus: auf einem Grundriss sind die
    // mit der Problemzahl wachsenden Geo-Marker zu gross). Geo ruft ohne -> 1.
    const sc = scale || 1;
    const isOff = !!node.unavailable;
    // Offline ueberschreibt die Severity-Farbe — der Marker wird grau und
    // bekommt ein rotes "X" damit man auf der Karte sofort tote Hosts sieht.
    // Sonst statusColor(): geisterbewusst (ein Geist wird gedaempft-grau, nicht
    // Severity-gruen — CLAUDE.md ci:ghost; im Plan-Modus landen auch Geister).
    const col = isOff ? '#9ca3af' : statusColor(node);
    const probs = node.problems || 0;
    const r = Math.min(12 + probs, 24) * sc;
    const opacity = isOff ? 0.6 : (node.maintenance ? 0.55 : 1);
    const ackRing = node.acknowledged
        ? '<circle cx="' + (r + 2) + '" cy="' + (r + 2) + '" r="' + (r - 1)
            + '" fill="none" stroke="#22c55e" stroke-width="2.5" opacity="0.9"/>'
        : '';
    // Bei Offline: rotes X im Marker statt Problem-Counter
    const offX = isOff
        ? '<g transform="translate(' + (r + 2) + ',' + (r + 2) + ')"'
            + ' stroke="#e53742" stroke-width="3" stroke-linecap="round">'
            + '<line x1="-' + (r * 0.5) + '" y1="-' + (r * 0.5) + '" x2="' + (r * 0.5) + '" y2="' + (r * 0.5) + '"/>'
            + '<line x1="' + (r * 0.5) + '" y1="-' + (r * 0.5) + '" x2="-' + (r * 0.5) + '" y2="' + (r * 0.5) + '"/>'
            + '</g>'
        : '';
    const html =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + ((r + 2) * 2) + '" height="' + ((r + 2) * 2) + '"'
        + ' style="opacity:' + opacity + '">'
        + '<circle cx="' + (r + 2) + '" cy="' + (r + 2) + '" r="' + r
        + '" fill="' + col + '" stroke="white" stroke-width="2"/>'
        + ackRing
        + offX
        + (probs > 0 && !isOff
            ? '<text x="' + (r + 2) + '" y="' + (r + 2) + '" text-anchor="middle" dominant-baseline="central"'
              + ' font-family="sans-serif" font-size="' + Math.max(8, Math.round((probs > 9 ? 9 : 11) * sc)) + '" font-weight="700"'
              + ' fill="white">' + (probs > 99 ? '99+' : probs) + '</text>'
            : '')
        + '</svg>';
    return L.divIcon({
        html: html,
        className: 'nt-geo-marker',
        iconSize: [(r + 2) * 2, (r + 2) * 2],
        iconAnchor: [r + 2, r + 2]
    });
}

// Popup-HTML für einen Host.
export function buildPopup(node) {
    // Geisterbewusst (CLAUDE.md ci:ghost): ein Geist bekommt "nicht ueberwacht"
    // und das gedaempfte Grau, nicht gruenes "Normal". Im Plan-Modus kann ein
    // Geist platziert werden, deshalb hier zwingend statusLabel/statusColor.
    const col = statusColor(node);
    const lbl = statusLabel(node, t('geo.not_monitored'));
    const tr = node.traffic || { in: 0, out: 0 };

    function mk(tag, css, text) {
        const e = document.createElement(tag);
        if (css) e.style.cssText = css;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    const root = mk('div', 'font-family:sans-serif;min-width:200px');
    root.appendChild(mk('div', 'font-weight:700;color:var(--nt-text,#0f172a);margin-bottom:4px',
        node.label || ''));
    if (node.ip) {
        root.appendChild(mk('div', 'font-size:10px;color:var(--nt-sub,#64748b);font-family:monospace',
            node.ip));
    }
    if (node.location) {
        root.appendChild(mk('div', 'font-size:10px;color:var(--nt-sub,#64748b);margin-top:2px',
            '\u{1F4CD} ' + node.location));
    }
    if (node.maintenance || node.acknowledged) {
        const row = mk('div', 'margin-top:4px');
        if (node.maintenance) {
            row.appendChild(mk('span',
                'background:var(--nt-warn-bg,#fef3c7);color:var(--nt-warn-text,#92400e);padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;margin-right:4px',
                t('geo.maintenance')));
        }
        if (node.acknowledged) {
            row.appendChild(mk('span',
                'background:var(--nt-ok-bg,#dcfce7);color:var(--nt-ok-text,#166534);padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;margin-right:4px',
                '✔ Acked'));
        }
        root.appendChild(row);
    }

    const stats = mk('div',
        'margin-top:6px;padding-top:6px;border-top:1px solid var(--nt-line-soft,#f1f5f9);font-size:11px;color:var(--nt-text-2,#334155)');
    const sevLine = mk('div');
    sevLine.appendChild(mk('span', 'color:' + col + ';font-weight:600', '● ' + lbl));
    if (node.problems > 0) {
        sevLine.appendChild(document.createTextNode('   '));
        sevLine.appendChild(mk('b', 'color:#ef4444', String(node.problems)));
        sevLine.appendChild(document.createTextNode(' ' + t('geo.problems')));
    }
    stats.appendChild(sevLine);
    function metric(label, val) {
        const r = mk('div'); r.textContent = label + ': ';
        r.appendChild(mk('b', '', String(val))); stats.appendChild(r);
    }
    if (node.cpu    != null) metric('CPU', node.cpu + '%');
    if (node.memory != null) metric('RAM', node.memory + '%');
    if (node.ping > 0)       metric('Ping', node.ping + ' ms');
    if (tr.in || tr.out) {
        const r = mk('div'); r.textContent = 'Traffic: ';
        r.appendChild(mk('span', 'color:#22c55e', '↓ ' + fmt(tr.in)));
        r.appendChild(document.createTextNode(' '));
        r.appendChild(mk('span', 'color:#06b6d4', '↑ ' + fmt(tr.out)));
        stats.appendChild(r);
    }
    root.appendChild(stats);
    return root;
}

// Kanten als Polylinien zwischen zwei Markern zeichnen. `nodePos` bildet eine
// Knoten-ID auf eine LatLng ([a,b]) ab — echte Koordinaten im Geo-Modus,
// Bild-Pixel (als CRS.Simple-LatLng [y,x]) im Plan-Modus. Kanten mit einem
// unplatzierten Ende werden übersprungen.
export function drawEdges(edgeLayer, edges, nodePos, style) {
    const st = style || { color: '#22c55e', weight: 2, opacity: 0.6, dashArray: '6,5' };
    (edges || []).forEach(function(e) {
        const src = String(e.source || e.from || '');
        const tgt = String(e.target || e.to || '');
        const a = nodePos[src], b = nodePos[tgt];
        if (!a || !b) return;
        L.polyline([a, b], st).addTo(edgeLayer);
    });
}

// Leaflet lazy laden: ~144 KB (JS+CSS) werden nur geholt, wenn ein kartenbasierter
// Tab (Geo oder Plan) wirklich geoeffnet wird — nicht mehr auf jeder Seite via
// Script-Tag. Idempotent + memoized; bei Fehler wird der Cache zurueckgesetzt
// (Retry).
let _leafletPromise = null;
export function ensureLeaflet() {
    if (window.L) return Promise.resolve();
    if (_leafletPromise) return _leafletPromise;
    const BASE = 'modules/network_topology/assets/js/leaflet/';
    _leafletPromise = new Promise(function(resolve, reject) {
        if (!document.getElementById('nt-leaflet-css')) {
            const link = document.createElement('link');
            link.id = 'nt-leaflet-css';
            link.rel = 'stylesheet';
            link.href = BASE + 'leaflet.css';
            document.head.appendChild(link);
        }
        const s = document.createElement('script');
        s.src = BASE + 'leaflet.js';
        s.onload = function() { resolve(); };
        s.onerror = function() { _leafletPromise = null; reject(new Error(t('geo.leaflet_failed'))); };
        document.head.appendChild(s);
    });
    return _leafletPromise;
}
