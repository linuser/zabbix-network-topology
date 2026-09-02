// icons.js — Node-Icon-Rendering und Image-Cache.
//
// Erzeugt für jeden Host das vollständige SVG (Severity-Ring + Type-Icon +
// optional Pin/Note/Problem-Badge) als data:image-URL. Cytoscape lädt das
// dann via background-image style.
//
// _imgCache ist nicht exportiert, aber clearImgCache() setzt ihn zurück —
// nötig nach Zustandswechseln (Dark-Mode, Pin-Toggle, Note-Edit), damit das
// nächste makeNodeImage() den Cache nicht aus Versehen wiederverwendet.

import { SEV_COL, grpColor } from './severity.js';
import { isDark } from './utils.js';

export const TYPE_ICON = {
    server:   'M-11,-13 h22 v4 h-22z M-11,-6 h22 v4 h-22z M-11,1 h22 v4 h-22z M-11,8 h22 v4 h-22z M8,-11 a1.5,1.5 0 1,1 0,0.01 M8,-4 a1.5,1.5 0 1,1 0,0.01 M8,3 a1.5,1.5 0 1,1 0,0.01 M8,10 a1.5,1.5 0 1,1 0,0.01',
    firewall: 'M0,-13 L11,-8 L11,1 C11,8 6,12 0,14 C-6,12 -11,8 -11,1 L-11,-8z M-4,1 h8 M-2,-4 h4 M0,-7 v3',
    router:   'M0,-12 a12,12 0 1,1 0,0.01z M-12,0 h24 M-6,-6 L6,6 M6,-6 L-6,6 M0,-12 v24',
    switch:   'M-12,-5 h24 v10 h-24z M-9,0 v-8 M-5,0 v-8 M-1,0 v-8 M3,0 v-8 M7,0 v-8 M-9,-4 h2 v-4 h-2z',
    wireless: 'M0,9 a2,2 0 1,1 0,0.01 M-4,4 a6,6 0 0,1 8,0 M-8,0 a12,12 0 0,1 16,0 M-12,-4 a18,18 0 0,1 24,0',
    storage:  'M-11,-11 h22 v6 h-22z M-11,-2 h22 v6 h-22z M-11,7 h22 v6 h-22z M7,-8 a1.5,1.5 0 1,1 0,0.01 M7,1 a1.5,1.5 0 1,1 0,0.01',
    camera:   'M-11,-7 h15 l3,-4 h4 l3,4 h3 v14 h-28z M0,3 a5,5 0 1,1 0,0.01',
    printer:  'M-10,-1 h20 v9 h-20z M-7,-9 h14 v8 h-14z M-7,8 h14 v8 h-14z M-4,11 h8 M-4,14 h8',
    // Gestapelte Karten — visualisiert eine Gruppe von Hosts (Group-View)
    group:    'M-11,-9 h18 v14 h-18z M-7,-13 h18 v14 h-18z M-3,-5 h8 M-3,-1 h8 M-3,3 h8',
    // Wolke — virtueller Internet-Knoten (Hierarchie-Layout)
    internet: 'M-10,4 a6,6 0 0,1 0,-12 a6,6 0 0,1 5,3 a5,5 0 0,1 9,2 a5,5 0 0,1 0,7 z',
    // Ghost-Knoten (§9) haben BEWUSST kein Icon hier: makeNodeImage wuerde einen
    // Severity-Ring drumherum zeichnen (severity 0 = gruen = "OK"), was bei einem
    // NICHT ueberwachten Geraet die falsche Aussage waere. Sie werden stattdessen
    // per Style gezeichnet (gestrichelter grauer Kreis, render-tech-style.js).
};

// Ring-Geometrie
const C = 48, RO = 42, RI = 26;

function pieSlice(r, sDeg, eDeg) {
    if (eDeg <= sDeg + 0.5) return '';
    const S = (sDeg - 90) * Math.PI / 180, E = (eDeg - 90) * Math.PI / 180;
    const large = (eDeg - sDeg) > 180 ? 1 : 0;
    return 'M ' + C + ' ' + C
        + ' L ' + (C + r * Math.cos(S)).toFixed(2) + ' ' + (C + r * Math.sin(S)).toFixed(2)
        + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 '
        + (C + r * Math.cos(E)).toFixed(2) + ' ' + (C + r * Math.sin(E)).toFixed(2) + ' Z';
}

function trafficPct(d) {
    return !d.traffic ? 0 : Math.min((d.traffic.in + d.traffic.out) / 2e7 * 100, 100);
}
function pingPct(d) {
    return (!d.ping || d.ping <= 0) ? 0 : Math.min(d.ping / 200 * 100, 100);
}

const _imgCache = {};
const _IMG_CACHE_MAX = 500;

function _imgCachePrune() {
    const keys = Object.keys(_imgCache);
    if (keys.length > _IMG_CACHE_MAX) {
        keys.slice(0, 100).forEach(function(k) { delete _imgCache[k]; });
    }
}

// Cache komplett leeren — z.B. nach Dark-Mode-Wechsel oder Pin/Note-Änderung,
// wo die Cache-Keys den neuen Zustand noch nicht kennen.
export function clearImgCache() {
    Object.keys(_imgCache).forEach(function(k) { delete _imgCache[k]; });
}

export function makeNodeImage(d) {
    // Dark mode draws differently (light glyph, dark separators, empty
    // quadrants tinted stronger) — so it belongs in the cache key, otherwise
    // the cache still serves the other theme's image after switching.
    const dark = isDark();
    const key = [
        d.id, d.severity, d.cpu, d.memory, d.ping,
        d.traffic ? d.traffic.in : 0, d.traffic ? d.traffic.out : 0,
        d._primaryGroup, d.problems || 0,
        d.pinned ? 1 : 0, d.note ? 1 : 0,
        d.acknowledged ? 1 : 0, d.maintenance ? 1 : 0,
        d.unavailable ? 1 : 0, dark ? 'd' : 'l'
    ].join('|');
    if (_imgCache[key]) return _imgCache[key];

    // Colors that depend on the background. Light: dark icon stroke, white
    // quadrant separators (like the canvas). Dark: light icon stroke,
    // separators in canvas dark — white lines were the loudest thing on the
    // whole node there, while the icon (#475569 on #0f1923) was practically
    // invisible.
    const glyphStroke = dark ? '#e2e8f0' : '#475569';
    const sepStroke   = dark ? '#0d1117' : '#ffffff';
    const haloStroke  = dark ? '#0d1117' : '#ffffff';

    // Offline = Host laut Zabbix unavailable. Severity-basiertes "dead" trifft
    // nur bei worst-case Severity 5 (Disaster) zu — das ist nicht dasselbe wie
    // unreachable. Wir behandeln beide jetzt visuell aehnlich (gedimmt, Severity-
    // Ring grau), aber Offline hat Vorrang im Symbol (Steckersymbol statt
    // Skull-Server damit man "tot" von "Disaster-Trigger" unterscheiden kann).
    const offline = !!d.unavailable;
    const dead = !offline && (d.severity || 0) >= 5;
    const sevCol = offline ? '#9ca3af'
        : SEV_COL[Math.min(d.severity || 0, SEV_COL.length - 1)];
    const gc = grpColor(d._primaryGroup);
    const segs = [
        { col: '#3b82f6', val: Math.min(d.cpu    || 0, 100) },
        { col: '#8b5cf6', val: Math.min(d.memory || 0, 100) },
        { col: '#22c55e', val: trafficPct(d) },
        { col: '#f59e0b', val: pingPct(d) },
    ];

    let p = '';
    // Bei Offline werden Pie-Segmente massiv gedimmt — die Werte sind stale
    // (letzter Stand vor Disconnect), sollen optisch aber nicht aktiv wirken.
    // The "empty" quadrants are a faint tint (0.12) in light mode. On the dark
    // canvas that disappears — 0.22 keeps the four fields recognizable without
    // competing with the filled share (0.85).
    const segFillOp  = offline ? (dark ? '0.14' : '0.08') : (dark ? '0.22' : '0.12');
    const segValOp   = offline ? '0.30' : '0.85';
    segs.forEach(function(seg, i) {
        const base = i * 90;
        p += '<path d="' + pieSlice(RO, base, base + 90) + '" fill="' + seg.col + '" fill-opacity="' + segFillOp + '"/>';
        if (seg.val > 1) {
            p += '<path d="' + pieSlice(RO, base, base + seg.val * 0.9) + '" fill="' + seg.col + '" fill-opacity="' + segValOp + '"/>';
        }
        const a = (base - 90) * Math.PI / 180;
        p += '<line x1="' + (C + RI * Math.cos(a)).toFixed(1)
           + '" y1="' + (C + RI * Math.sin(a)).toFixed(1)
           + '" x2="' + (C + RO * Math.cos(a)).toFixed(1)
           + '" y2="' + (C + RO * Math.sin(a)).toFixed(1)
           + '" stroke="' + sepStroke + '" stroke-width="1.5"/>';
    });

    // Severity-Ring bei Offline grau + dashed um klar zu signalisieren dass
    // die Severity stale ist (eingefrorene Trigger vor Disconnect).
    const ringStroke = offline ? '#9ca3af' : (dead ? '#94a3b8' : sevCol);
    const ringDash   = offline ? ' stroke-dasharray="6,4"' : '';
    const ringOp     = (offline || dead) ? '0.6' : '1';
    p += '<circle cx="' + C + '" cy="' + C + '" r="' + RI
       + '" fill="' + gc + '" fill-opacity="' + (offline || dead ? '0.08' : (dark ? '0.28' : '0.15'))
       + '" stroke="' + ringStroke + '" stroke-width="3" opacity="' + ringOp + '"' + ringDash + '/>';

    // Acknowledged-Indikator: dicker grüner Doppel-Außenring um den Severity-Ring.
    // Zeigt: alle aktiven Probleme dieses Hosts wurden bestätigt.
    if (d.acknowledged) {
        p += '<circle cx="' + C + '" cy="' + C + '" r="' + (RI + 4)
           + '" fill="none" stroke="#22c55e" stroke-width="2.5" opacity="0.95"/>';
        p += '<circle cx="' + C + '" cy="' + C + '" r="' + (RI + 7)
           + '" fill="none" stroke="#22c55e" stroke-width="1" stroke-dasharray="3,2" opacity="0.7"/>';
    }

    // Maintenance-Layer: orange-gestrichelter Aussenring, weit genug ausserhalb
    // des Severity-Rings damit er nicht mit dem Acknowledged-Doppelring kollidiert.
    // Der Schraubenschluessel-Badge oben rechts bleibt zusaetzlich erhalten —
    // der Ring signalisiert "Host in Maintenance" sofort auch von weitem.
    if (d.maintenance) {
        p += '<circle cx="' + C + '" cy="' + C + '" r="' + (RI + 10)
           + '" fill="none" stroke="#f59e0b" stroke-width="2"'
           + ' stroke-dasharray="5,3" opacity="0.85"/>';
    }

    if (offline) {
        // Offline-Icon — Type-Icon stark gedimmt + grosses rotes "X" mit weissem
        // Halo druebergelegt damit man den Host-Typ noch erkennt aber sofort
        // sieht "der ist tot". Halo ist noetig weil das X sonst optisch in den
        // Icon-Strichen verschwimmt.
        const icon = TYPE_ICON[d.type] || TYPE_ICON.server;
        p += '<g transform="translate(' + C + ',' + C
           + ') scale(0.62)" fill="none" stroke="#9ca3af" stroke-width="1.6"'
           + ' stroke-linecap="round" stroke-linejoin="round" opacity="0.32">'
           + '<path d="' + icon + '"/></g>';
        // Weisser Halo unter dem roten X — sorgt fuer klare Kanten gegen das
        // darunterliegende Type-Icon.
        p += '<g transform="translate(' + C + ',' + C + ')"'
           + ' stroke="' + haloStroke + '" stroke-width="7" stroke-linecap="round" opacity="0.95">'
           + '<line x1="-15" y1="-15" x2="15" y2="15"/>'
           + '<line x1="15"  y1="-15" x2="-15" y2="15"/>'
           + '</g>';
        // Rotes X als klarer Offline-Indikator
        p += '<g transform="translate(' + C + ',' + C + ')"'
           + ' stroke="#dc2626" stroke-width="4.5" stroke-linecap="round">'
           + '<line x1="-15" y1="-15" x2="15" y2="15"/>'
           + '<line x1="15"  y1="-15" x2="-15" y2="15"/>'
           + '</g>';
    } else if (dead) {
        // "Dead Server"-Icon — gestrichelter Server mit X über CPUs
        p += '<g transform="translate(' + C + ',' + (C - 3) + ') scale(0.62)">'
            + '<path d="M0,-14 a13,10 0 0,1 13,10 L13,4 Q13,9 8,10 L-8,10 Q-13,9 -13,4 L-13,-4 a13,10 0 0,1 13,-10z" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1.5"/>'
            + '<rect x="-9" y="10" width="5" height="5" rx="1" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1.2"/>'
            + '<rect x="-2" y="10" width="5" height="5" rx="1" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1.2"/>'
            + '<rect x="5" y="10" width="5" height="5" rx="1" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1.2"/>'
            + '<path d="M-7,-3 L-4,0 M-4,-3 L-7,0 M4,-3 L7,0 M7,-3 L4,0" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" fill="none"/>'
            + '</g>';
    } else {
        const icon = TYPE_ICON[d.type] || TYPE_ICON.server;
        p += '<g transform="translate(' + C + ',' + C
           + ') scale(0.62)" fill="none" stroke="' + glyphStroke + '" stroke-width="1.6"'
           + ' stroke-linecap="round" stroke-linejoin="round"><path d="' + icon + '"/></g>';
    }

    // Pin-Icon top-left
    if (d.pinned) {
        p += '<circle cx="14" cy="14" r="11" fill="#3b82f6" opacity="0.92" stroke="white" stroke-width="1.2"/>';
        p += '<path d="M14,7 L14,14 M10,10 L18,10 M12,14 L16,14 M14,14 L14,19" stroke="white" stroke-width="1.8" stroke-linecap="round" fill="none"/>';
    }

    // Note-Icon bottom-left
    if (d.note) {
        p += '<rect x="2" y="' + (C * 2 - 24) + '" width="20" height="20" rx="3" fill="#fbbf24" stroke="#d97706" stroke-width="1"/>';
        p += '<line x1="6" y1="' + (C * 2 - 18) + '" x2="18" y2="' + (C * 2 - 18) + '" stroke="#92400e" stroke-width="1.5" stroke-linecap="round"/>';
        p += '<line x1="6" y1="' + (C * 2 - 13) + '" x2="18" y2="' + (C * 2 - 13) + '" stroke="#92400e" stroke-width="1.5" stroke-linecap="round"/>';
        p += '<line x1="6" y1="' + (C * 2 - 8)  + '" x2="14" y2="' + (C * 2 - 8)  + '" stroke="#92400e" stroke-width="1.5" stroke-linecap="round"/>';
    }

    // Problem-Counter Badge top-right
    const prob = d.problems || 0;
    if (prob > 0) {
        const bLabel = prob > 99 ? '99+' : String(prob);
        const bR = bLabel.length > 2 ? 13 : 10;
        const bX = C * 2 - bR - 2;
        const bY = bR + 2;
        p += '<circle cx="' + bX + '" cy="' + bY + '" r="' + bR + '" fill="#ef4444" stroke="white" stroke-width="1.5"/>';
        p += '<text x="' + bX + '" y="' + bY + '" text-anchor="middle" dominant-baseline="central"'
           + ' font-family="sans-serif" font-size="' + (bLabel.length > 2 ? 8 : 10) + '"'
           + ' font-weight="700" fill="white">' + bLabel + '</text>';
    }

    // Maintenance-Badge: oranger Schraubenschlüssel oben rechts. Wenn auch ein
    // Problem-Badge existiert, wird das Maintenance-Badge daneben (weiter links)
    // platziert; sonst an der gleichen Stelle wie das Problem-Badge.
    if (d.maintenance) {
        const mR = 10;
        const mX = prob > 0 ? (C * 2 - 22 - mR - 2) : (C * 2 - mR - 2);
        const mY = mR + 2;
        p += '<circle cx="' + mX + '" cy="' + mY + '" r="' + mR + '" fill="#f59e0b" stroke="white" stroke-width="1.5"/>';
        // Schraubenschlüssel-Glyph (vereinfacht): zwei abgewinkelte Linien
        p += '<g transform="translate(' + mX + ',' + mY + ') scale(0.55)" stroke="white" stroke-width="2"'
           + ' stroke-linecap="round" stroke-linejoin="round" fill="none">'
           + '<path d="M-5,-5 L5,5 M-5,5 L5,-5"/>'
           + '<circle cx="-5" cy="-5" r="2.5" fill="white" stroke="none"/>'
           + '</g>';
    }

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (C * 2) + '" height="' + (C * 2) + '">' + p + '</svg>';
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    // Echte LRU: bei Re-Insert mit gleichem Key vorher loeschen, sonst bleibt
    // der alte Eintrag wegen JS-Object-Insertion-Order weiter "ganz vorne"
    // und der Prune-Algorithmus schmeisst falsche Eintraege raus.
    if (_imgCache[key]) delete _imgCache[key];
    _imgCache[key] = url;
    _imgCachePrune();
    return url;
}
