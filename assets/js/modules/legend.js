// legend.js — Seitenleiste mit Gruppen, Severity-Verteilung, Ring-Farben.
//
// Wird beim ersten render() einmal gesetzt; Inhalt ist statisch nach dem
// initialen Build (kein Live-Update — bei Severity-Änderungen müsste man
// setupLegend nochmal mit den neuen Counts aufrufen, das passiert aber
// nirgendwo, weil der Legend-Block einen Snapshot des Zustands bei Load zeigt).

import { esc, fmt } from './utils.js';
import { t } from './i18n.js';
import { SEV_COL, SEV_LBL, grpColor } from './severity.js';
import { NT_LEGEND_COLLAPSED_KEY } from './storage.js';
import { TRAFFIC_TIERS, UTIL_TIERS, IDLE_TIER, isWeathermapMode, hasCustomScales } from './traffic.js';

export function setupLegend(groupNames, nodes) {
    const leg = document.getElementById('nt-legend');
    if (!leg) return;

    let html = '<div style="font-weight:600;color:#475569;margin-bottom:5px;font-size:10px">'
        + esc(t('legend.groups')) + '</div>';
    groupNames.forEach(function(name) {
        const col = grpColor(name);
        const cnt = nodes.filter(function(n) { return n._primaryGroup === name; }).length;
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">'
              + '<div style="width:9px;height:9px;border-radius:50%;background:' + col + '"></div>'
              + '<span style="color:#475569;flex:1;font-size:11px">' + esc(name) + '</span>'
              + '<span style="color:#94a3b8;font-size:11px">' + cnt + '</span>'
              + '</div>';
    });

    html += '<div style="font-weight:600;color:#475569;margin:6px 0 4px;font-size:10px;'
          + 'border-top:1px solid #f1f5f9;padding-top:5px">' + esc(t('legend.severity')) + '</div>';
    SEV_LBL.forEach(function(lbl, i) {
        const cnt = nodes.filter(function(n) { return (n.severity || 0) === i; }).length;
        if (!cnt) return;
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">'
              + '<div style="width:9px;height:9px;border-radius:50%;background:' + SEV_COL[i] + '"></div>'
              + '<span style="color:#475569;flex:1;font-size:11px">' + lbl + '</span>'
              + '<span style="color:#94a3b8;font-size:11px">' + cnt + '</span>'
              + '</div>';
    });

    html += '<div style="font-weight:600;color:#475569;margin:6px 0 4px;font-size:10px;'
          + 'border-top:1px solid #f1f5f9;padding-top:5px">' + esc(t('legend.ring')) + '</div>';
    [[t('legend.ring.cpu'), '#3b82f6'], [t('legend.ring.memory'), '#8b5cf6'],
     [t('legend.ring.traffic'), '#22c55e'], [t('legend.ring.ping'), '#f59e0b']].forEach(function(r) {
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">'
              + '<div style="width:9px;height:9px;border-radius:50%;background:' + r[1] + '"></div>'
              + '<span style="color:#475569;font-size:11px">' + esc(r[0]) + '</span>'
              + '</div>';
    });

    leg.innerHTML = html;
}

// setupBottomLegend — einklappbare Farbcode-Leiste unten im Technical-Canvas.
// Erklaert, was die Farben bedeuten (Node-Severity mit "Optimal" markiert,
// Offline/Wartung, Edge-Typen inkl. Weathermap-Skala, Metrik-Ringe). Anders
// als die Seiten-Legende ist das eine statische Erklaerung ohne Counts.
// Zustand (ein/ausgeklappt) in localStorage; im Wallboard ausgeblendet.
// Remember the last arguments so the weathermap toggle can rebuild the bar
// (it shows the scale of the currently active mode).
let _blWrap = null, _blDark = false;
export function refreshBottomLegend() {
    if (_blWrap && _blWrap.isConnected) setupBottomLegend(_blWrap, _blDark);
}

export function setupBottomLegend(wrap, dark) {
    if (!wrap) return;
    _blWrap = wrap; _blDark = !!dark;
    const old = document.getElementById('nt-bottom-legend');
    if (old) old.remove();
    if (document.body.classList.contains('nt-wallboard')) return;

    // Standardmaessig eingeklappt (dezent): nur ein kleines "Color guide"-
    // Chip in der Ecke. Ausgeklappt bleibt es nur, wenn der User es explizit
    // aufgeklappt hat ('0' im Storage) — die Wahl wird gemerkt.
    let collapsed = true;
    try { collapsed = localStorage.getItem(NT_LEGEND_COLLAPSED_KEY) !== '0'; } catch (e) {}

    const bg  = dark ? 'rgba(22,27,34,0.80)'  : 'rgba(255,255,255,0.82)';
    const bdr = dark ? '#2a2f36' : '#e5e9ee';
    const txt = dark ? '#c9d1d9' : '#475569';

    const bar = document.createElement('div');
    bar.id = 'nt-bottom-legend';
    bar.style.cssText = 'position:absolute;left:10px;bottom:8px;z-index:8;'
        + 'max-width:calc(100% - 190px);background:' + bg + ';border:1px solid ' + bdr
        + ';border-radius:7px;box-shadow:0 1px 3px rgba(0,0,0,0.05);backdrop-filter:blur(2px);'
        + 'font-family:sans-serif;font-size:10.5px;color:' + txt + ';overflow:hidden;opacity:0.9';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:7px;padding:4px 9px;cursor:pointer;'
        + 'user-select:none;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;font-size:9px;opacity:0.6';
    head.innerHTML = '<span>' + esc(t('legend.guide.title')) + '</span>'
        + '<span id="nt-bl-caret" style="opacity:0.7">' + (collapsed ? '▴' : '▾') + '</span>';
    bar.appendChild(head);

    function dot(c) {
        return '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'
            + c + ';vertical-align:middle;margin-right:4px"></span>';
    }
    function line(c, dashed) {
        return '<span style="display:inline-block;width:16px;height:0;border-top:3px '
            + (dashed ? 'dashed' : 'solid') + ' ' + c + ';vertical-align:middle;margin-right:5px"></span>';
    }
    function chip(inner) {
        return '<span style="display:inline-flex;align-items:center;white-space:nowrap;margin-right:12px">'
            + inner + '</span>';
    }
    function grpTitle(label) {
        return '<span style="font-weight:700;opacity:0.6;margin-right:8px">' + esc(label) + '</span>';
    }
    function rowDiv(inner) {
        return '<div style="display:flex;flex-wrap:wrap;align-items:center;margin-bottom:3px">' + inner + '</div>';
    }

    // Knoten (Severity-Ring) — Optimal hervorgehoben, dann Info..Disaster,
    // Offline (grauer Ring + X) und Wartung/veraltet (gedimmt).
    let r1 = grpTitle(t('legend.guide.nodes'));
    r1 += chip(dot(SEV_COL[0]) + '<b>' + esc(t('legend.guide.optimal')) + '</b>');
    for (let i = 1; i <= 5; i++) r1 += chip(dot(SEV_COL[i]) + esc(SEV_LBL[i]));
    r1 += chip('<span style="color:#dc2626;font-weight:800;margin-right:4px">✕</span>' + esc(t('legend.guide.offline')));
    // Wartung: der oranger gestrichelte Ring UND das Schluessel-Badge, so wie es
    // auf der Karte aussieht. Hier stand ein gedimmtes ◐ — ein Zeichen, das
    // dort nirgends vorkommt. Gemeint war wohl "der Knoten ist gedimmt";
    // gelesen wurde es als Symbol, und wer danach suchte, fand es nie.
    r1 += chip('<span style="display:inline-block;width:11px;height:11px;border-radius:50%;'
        + 'border:2px dashed #f59e0b;margin-right:4px;vertical-align:middle"></span>'
        + esc(t('legend.guide.maint')));

    // Verbindungen — LLDP/CDP (gruen gestrichelt), Internet (blau), Down
    // (rot gestrichelt).
    let r2 = grpTitle(t('legend.guide.edges'));
    r2 += chip(line('#22c55e', true)  + esc(t('legend.guide.link_lldp')));
    r2 += chip(line('#3b82f6', false) + esc(t('legend.guide.link_inet')));
    r2 += chip(line('#dc2626', true)  + esc(t('legend.guide.iface_down')));
    // Neu und alternd gehoeren in die Legende, sonst zeigt die Karte zwei
    // Zustaende, die dort nicht erklaert sind — genau der Fehler aus Issue #9,
    // nur andersherum.
    r2 += chip('<span style="display:inline-block;width:16px;height:7px;border-radius:3px;'
        + 'margin-right:5px;vertical-align:middle;background:rgba(22,163,74,0.30)"></span>'
        + esc(t('legend.guide.link_fresh')));
    r2 += chip(line('#c2a878', true, 2) + esc(t('legend.guide.link_stale')));

    // Edge color by traffic — the scale of the ACTIVE mode, with the same
    // tiers and colors as traffic.js. This used to show only the weathermap
    // gradient, even with the mode off: a 1.9 Mb/s edge is orange on the
    // absolute scale, and the gradient made that read like ~50% utilization.
    const wm = isWeathermapMode();
    let r2b = grpTitle(t(wm ? 'legend.guide.weathermap' : 'legend.guide.traffic'));
    // Mark an admin-overridden scale — otherwise anyone who knows the
    // defaults from the docs wonders about the different colors.
    if (hasCustomScales()) r2b += '<span style="opacity:0.55;margin-right:8px">(' + esc(t('scales.custom')) + ')</span>';
    // Absolute: 0 b/s is its own tier ("idle", dashed grey). For utilization
    // the first tier (< 1%) is part of the scale itself.
    if (!wm) r2b += chip(line(IDLE_TIER.col, true) + esc(t('legend.guide.idle')));
    const tiers = wm ? UTIL_TIERS : TRAFFIC_TIERS;
    tiers.forEach(function(x, i) {
        const isLast = !isFinite(x.max);
        const bound  = isLast ? tiers[i - 1].max : x.max;
        // "10.0 Kb/s" → "10 Kb/s": in a legend the tier matters, not the decimal
        const num    = wm ? bound + '%' : fmt(bound).replace('.0 ', ' ');
        r2b += chip(line(x.col, false) + (isLast ? '\u2265 ' : '< ') + esc(num));
    });

    // Metrik-Ringe (die farbigen Segmente im Node-Icon)
    let r3 = grpTitle(t('legend.guide.rings'));
    r3 += chip(dot('#3b82f6') + esc(t('legend.ring.cpu')));
    r3 += chip(dot('#8b5cf6') + esc(t('legend.ring.memory')));
    r3 += chip(dot('#22c55e') + esc(t('legend.ring.traffic')));
    r3 += chip(dot('#f59e0b') + esc(t('legend.ring.ping')));

    const body = document.createElement('div');
    body.style.cssText = 'padding:2px 10px 8px;max-width:840px;display:' + (collapsed ? 'none' : 'block');
    body.innerHTML = rowDiv(r1) + rowDiv(r2) + rowDiv(r2b) + rowDiv(r3);
    bar.appendChild(body);

    head.addEventListener('click', function() {
        collapsed = !collapsed;
        body.style.display = collapsed ? 'none' : 'block';
        const caret = document.getElementById('nt-bl-caret');
        if (caret) caret.textContent = collapsed ? '▴' : '▾';
        try { localStorage.setItem(NT_LEGEND_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (e) {}
    });

    // Dezent im Ruhezustand, bei Interaktion volle Deckkraft (gut lesbar).
    bar.addEventListener('mouseenter', function() { bar.style.opacity = '1'; });
    bar.addEventListener('mouseleave', function() { bar.style.opacity = '0.9'; });

    wrap.appendChild(bar);
}
