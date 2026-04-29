// detail-panel.js — Detail-Panel rechts unten, das nach Klick auf einen Host
// dessen vollständige Werte und verbundene Peers anzeigt.
//
// Wird vom Tap-Handler im Render-Modul mit der Cytoscape-Node-Data gefüttert.
// Schließbar über das X oben rechts; setzt dabei alle Node-Opacities zurück
// (war zuvor durch Pfad-Highlight gedimmt).

import { esc, fmt, fmtItemValue } from './utils.js';
import { SEV_COL, SEV_LBL } from './severity.js';

// Mapping von Backend-Type-String zu deutschem Label + Emoji-Icon.
// Die Strings hier müssen mit deviceType() in NetworkTopologyData.php
// und mit $allowed_icons (Whitelist für nt:icon) konsistent sein.
const TYPE_INFO = {
    firewall:   { lbl: 'Firewall',     icon: '\u{1F525}', col: '#dc2626' },  // 🔥
    router:     { lbl: 'Router',       icon: '\u{1F4E1}', col: '#7c3aed' },  // 📡
    switch:     { lbl: 'Switch',       icon: '\u{1F500}', col: '#2563eb' },  // 🔀
    wireless:   { lbl: 'Wireless AP',  icon: '\u{1F4F6}', col: '#0891b2' },  // 📶
    server:     { lbl: 'Server',       icon: '\u{1F5A5}',  col: '#475569' },  // 🖥
    storage:    { lbl: 'Storage',      icon: '\u{1F4BE}', col: '#0e7490' },  // 💾
    hypervisor: { lbl: 'Hypervisor',   icon: '\u{1F9F1}', col: '#7c2d12' },  // 🧱
    camera:     { lbl: 'Kamera',       icon: '\u{1F4F7}', col: '#71717a' },  // 📷
    printer:    { lbl: 'Drucker',      icon: '\u{1F5A8}',  col: '#52525b' },  // 🖨
    ups:        { lbl: 'USV',          icon: '\u{1F50B}', col: '#16a34a' },  // 🔋
    homeauto:   { lbl: 'Smart Home',   icon: '\u{1F3E0}', col: '#ea580c' },  // 🏠
    mailserver: { lbl: 'Mail-Server',  icon: '\u{2709}\u{FE0F}',  col: '#7c3aed' },  // ✉️
    webserver:  { lbl: 'Web-Server',   icon: '\u{1F310}', col: '#0d9488' },  // 🌐
    container:  { lbl: 'Container',    icon: '\u{1F4E6}', col: '#0369a1' },  // 📦
    monitoring: { lbl: 'Monitoring',   icon: '\u{1F4CA}', col: '#9333ea' },  // 📊
    linux:      { lbl: 'Linux Server', icon: '\u{1F427}', col: '#0f172a' },  // 🐧
    windows:    { lbl: 'Windows',      icon: '\u{1FA9F}', col: '#1d4ed8' },  // 🪟
    macos:      { lbl: 'macOS',        icon: '\u{1F34F}', col: '#52525b' },  // 🍏
    internet:   { lbl: 'Internet',     icon: '\u{1F30D}', col: '#3b82f6' },  // 🌍
};

function typeInfo(type) {
    return TYPE_INFO[type] || { lbl: 'Unbekannt', icon: '\u2753', col: '#94a3b8' };  // ❓
}

export function showDetail(panel, d, cy) {
    const sc = SEV_COL[d.severity || 0] || SEV_COL[0];

    const ti = typeInfo(d.type);
    const customMark = d.icon_override
        ? ' <span title="Custom (von nt:icon Tag)" style="color:#f59e0b;font-weight:700">*</span>'
        : '';

    // Interface-Zeile mit Proxy-Info anreichern: nach dem Iftype steht in
    // grau "via <Proxy>" oder "via grp:<Group>" — hilft beim Debuggen wenn
    // Daten fehlen weil ein Proxy down ist.
    const proxyTxt = (function() {
        const pn = d.proxy_name || '', pg = d.proxy_group_name || '';
        if (pn && pg) return ' via ' + pn + ' [grp:' + pg + ']';
        if (pn)       return ' via ' + pn;
        if (pg)       return ' via grp:' + pg;
        return '';
    })();
    const ifaceCell = esc(d.iftype || '\u2014')
        + (proxyTxt ? '<span style="color:#94a3b8;font-size:11px">' + esc(proxyTxt) + '</span>' : '');

    const rows = [
        ['Host', esc(d.host || d.label)],
        ['Type', '<b style="color:' + ti.col + '">' + ti.icon + ' ' + esc(ti.lbl) + '</b>' + customMark],
        ['IP', esc(d.ip || '\u2014')],
        ['Interface', ifaceCell],
        ...(d.pinned ? [['Status', '<span style="color:#3b82f6;font-weight:600">&#128204; Fixiert</span>']] : []),
        ...(d.maintenance ? [['Wartung', '<span style="color:#f59e0b;font-weight:600">\u{1F527} In Wartung</span>']] : []),
        ...(d.acknowledged ? [['Acked',   '<span style="color:#22c55e;font-weight:600">\u2714 Probleme best\u00E4tigt</span>']] : []),
        ...(d.note   ? [['Notiz',  '<span style="color:#f59e0b">&#127991; ' + esc(d.note) + '</span>']] : []),
        ['Status', '<span style="color:' + sc + ';font-weight:700">&#9679; ' + esc(SEV_LBL[d.severity || 0] || 'Normal') + '</span>'],
        ['CPU',    d.cpu    != null ? '<b>' + d.cpu    + '%</b>' : '\u2014'],
        ['Memory', d.memory != null ? '<b>' + d.memory + '%</b>' : '\u2014'],
        ['Ping',   d.ping > 0       ? '<b>' + d.ping   + ' ms</b>' : '\u2014'],
        ['&#8595; In',  '<span style="color:#22c55e">' + fmt(d.traffic ? d.traffic.in  : 0) + '</span>'],
        ['&#8593; Out', '<span style="color:#38bdf8">' + fmt(d.traffic ? d.traffic.out : 0) + '</span>'],
    ];

    let peers = '';
    cy.getElementById(d.id).connectedEdges().forEach(function(edge) {
        const other = edge.source().id() === d.id ? edge.target() : edge.source();
        if (other.data('isGroup')) return;
        peers += (peers ? '<br>' : '') + '&#8596; ' + esc(other.data('label'));
    });

    // Ring-Legend (CPU/Memory/Traffic/Ping als kleine Donuts)
    const _tPct = (!d.traffic) ? 0 : Math.min((d.traffic.in + d.traffic.out) / 2e7 * 100, 100);
    const _pPct = (!d.ping || d.ping <= 0) ? 0 : Math.min(d.ping / 200 * 100, 100);
    const rings = [
        { col: '#3b82f6', lbl: 'CPU',     val: d.cpu    != null ? d.cpu    + '%' : '\u2014', pct: Math.min(d.cpu    || 0, 100) },
        { col: '#8b5cf6', lbl: 'Memory',  val: d.memory != null ? d.memory + '%' : '\u2014', pct: Math.min(d.memory || 0, 100) },
        { col: '#22c55e', lbl: 'Traffic', val: d.traffic ? fmt(d.traffic.in) + ' / ' + fmt(d.traffic.out) : '\u2014', pct: _tPct },
        { col: '#f59e0b', lbl: 'Ping',    val: d.ping > 0 ? d.ping + ' ms' : '\u2014', pct: _pPct },
    ];

    let ringHtml = '<div style="display:flex;gap:8px;margin:8px 0;padding:6px 0;'
                 + 'border-top:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9">';
    rings.forEach(function(r) {
        ringHtml += '<div style="flex:1;text-align:center">'
            + '<svg width="36" height="36" viewBox="0 0 36 36">'
            + '<circle cx="18" cy="18" r="14" fill="none" stroke="' + r.col + '22" stroke-width="4"/>'
            + (r.pct > 0
                ? '<circle cx="18" cy="18" r="14" fill="none" stroke="' + r.col + '" stroke-width="4"'
                  + ' stroke-dasharray="' + (r.pct / 100 * 87.96).toFixed(1) + ' 87.96"'
                  + ' stroke-dashoffset="21.99" stroke-linecap="round"/>'
                : '')
            + '</svg>'
            + '<div style="font-size:9px;color:' + r.col + ';font-weight:700;margin-top:1px">' + r.lbl + '</div>'
            + '<div style="font-size:10px;color:#334155;font-weight:600">' + r.val + '</div>'
            + '</div>';
    });
    ringHtml += '</div>';

    panel.style.display = 'block';
    // Extra-Items-Block (nt:show-Tags)
    const extraBlock = (d.extra_items && d.extra_items.length)
        ? '<div style="margin-top:8px;padding-top:6px;border-top:1px solid #f1f5f9">'
            + '<div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">Items</div>'
            + '<table style="width:100%;font-size:11px;border-collapse:collapse">'
            + d.extra_items.map(function(it) {
                const val = it.error
                    ? '<span style="color:#94a3b8;font-style:italic">' + esc(it.error) + '</span>'
                    : '<b>' + esc(fmtItemValue(it.value, it.units)) + '</b>';
                return '<tr>'
                    + '<td style="color:#64748b;padding:2px 0;padding-right:10px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(it.name || '') + '">'
                    + esc((it.name || '').substring(0, 32))
                    + '</td><td>' + val + '</td></tr>';
            }).join('')
            + '</table></div>'
        : '';

    // Zabbix-URLs für Action-Buttons. Base-Path detektion wie im
    // Kontextmenü — Zabbix kann unter /, /zabbix/ oder anderen Prefixes laufen.
    const zbxBase = (function() {
        const p = window.location.pathname;
        const i = p.indexOf('/zabbix.php');
        return i > 0 ? p.substring(0, i + 1) : '/';
    })();
    const zbxOrigin = window.location.origin + zbxBase;
    const hostId = encodeURIComponent(d.id);
    const actions = [
        { lbl: '\u{1F4CA}', title: 'Latest Data',
          url: zbxOrigin + 'zabbix.php?action=latest.view&filter_set=1&hostids%5B%5D=' + hostId },
        { lbl: '\u26A0',    title: 'Probleme',
          url: zbxOrigin + 'zabbix.php?action=problem.view&filter_set=1&hostids%5B%5D=' + hostId },
        { lbl: '\u{1F4C8}', title: 'Graphs',
          url: zbxOrigin + 'zabbix.php?action=charts.view&filter_set=1&filter_hostids%5B%5D=' + hostId },
        { lbl: '\u2699\uFE0F', title: 'Bearbeiten',
          url: zbxOrigin + 'zabbix.php?action=popup&popup=host.edit&hostid=' + hostId },
    ];
    const actionBar = '<div style="display:flex;gap:4px;margin-bottom:8px;'
        + 'padding-bottom:6px;border-bottom:1px solid #f1f5f9">'
        + actions.map(function(a, i) {
            return '<button data-act="' + i + '" title="' + esc(a.title) + '" '
                + 'style="flex:1;padding:5px;background:#f8fafc;border:1px solid #e2e8f0;'
                + 'border-radius:4px;cursor:pointer;font-size:13px;color:#475569;'
                + 'transition:background 0.15s">' + a.lbl + '</button>';
        }).join('')
        + '</div>';

    panel.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:6px">'
        + '<div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0">'
            + '<span style="font-size:18px;line-height:1;flex-shrink:0">' + ti.icon + '</span>'
            + '<span style="font-weight:700;font-size:13px;color:#0f172a;'
            + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(d.label) + '">'
            + esc(d.label) + '</span>'
            + '<span style="display:inline-block;padding:1px 7px;border-radius:10px;'
            + 'background:' + ti.col + '22;color:' + ti.col + ';'
            + 'font-size:9px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;'
            + 'flex-shrink:0">' + esc(ti.lbl) + customMark + '</span>'
        + '</div>'
        + '<button id="nt-detail-close" style="background:none;border:none;cursor:pointer;color:#94a3b8;'
        + 'font-size:18px;line-height:1;padding:0;flex-shrink:0">&#x2715;</button>'
        + '</div>'
        + actionBar
        + ringHtml
        + '<table style="width:100%;font-size:12px;border-collapse:collapse">'
        + rows.map(function(r) {
            return '<tr><td style="color:#64748b;padding:3px 0;padding-right:10px">' + r[0] + '</td><td>' + r[1] + '</td></tr>';
        }).join('')
        + '</table>'
        + extraBlock
        + (peers ? '<div style="margin-top:8px;font-size:11px;color:#475569;border-top:1px solid #f1f5f9;padding-top:6px">' + peers + '</div>' : '');

    const cb = document.getElementById('nt-detail-close');
    if (cb) cb.addEventListener('click', function(e) {
        e.stopPropagation();
        panel.style.display = 'none';
        if (window._ntCy) {
            window._ntCy.nodes('[!isGroup]').forEach(function(n) { n.style('opacity', 1); });
            window._ntCy.edges().forEach(function(ed) { ed.style('opacity', 0.85); });
        }
    });

    // Action-Buttons: data-act-Attribut hält den Index in actions[]
    panel.querySelectorAll('button[data-act]').forEach(function(btn) {
        btn.addEventListener('mouseenter', function() { this.style.background = '#e2e8f0'; });
        btn.addEventListener('mouseleave', function() { this.style.background = '#f8fafc'; });
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const idx = parseInt(this.dataset.act, 10);
            if (actions[idx]) window.open(actions[idx].url, '_blank', 'noopener,noreferrer');
        });
    });
}
