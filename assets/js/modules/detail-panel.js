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

    // Offline-Detection: wenn Host laut Zabbix unavailable ist, kennzeichnen
    // wir alle Metriken als STALE (letzter Wert vor Disconnect). Sonst sieht
    // ein toter Host mit eingefrorenem CPU 96% wie ein heisser Host aus.
    const isOff = !!d.unavailable;
    // Stale-Detection: Host scheint zwar online (unavailable=false) aber
    // letzter Item-Update liegt > 5min zurueck. Kann passieren wenn der
    // Agent zwar antwortet aber Items disabled / not-supported sind, oder
    // wenn ein Polling-Pause aktiv ist. Schwellwert: 5min
    // (300s) — typisch fuer Live-Metriken die alle 30-60s aktualisiert werden.
    const STALE_S = 300;
    const nowSec = Math.floor(Date.now() / 1000);
    const ageSec = (d.last_seen && d.last_seen > 0) ? (nowSec - d.last_seen) : 0;
    const isStale = !isOff && d.last_seen > 0 && ageSec > STALE_S;
    const offColor = '#9ca3af';   // grey-500
    const staleStyle = (isOff || isStale)
        ? 'opacity:0.55;text-decoration:line-through;' + 'text-decoration-style:wavy;'
        : '';
    const staleNote = isOff || isStale ? ' <span style="color:' + offColor
        + ';font-size:10px">(stale)</span>' : '';
    const fmtMetric = function(rawHtml) {
        return (isOff || isStale)
            ? '<span style="' + staleStyle + '">' + rawHtml + '</span>' + staleNote
            : rawHtml;
    };

    // Card-Sections: Detail-Panel als sequenz von kleinen Sections statt
    // einer flachen Rows-Tabelle. Macht den Inhalt strukturierter und gibt
    // Raum fuer logische Hierarchie (Status oben, Identitaet, Metriken,
    // Custom Items, Peers).
    //
    // Section-Helper: kleines Uppercase-Header-Label + duenne Trennlinie,
    // standardisiertes Format quer durch alle Sections.
    const section = function(label) {
        return '<div style="margin-top:10px;padding-top:6px;'
            + 'border-top:1px solid #f1f5f9;'
            + 'font-size:10px;color:#94a3b8;font-weight:700;'
            + 'text-transform:uppercase;letter-spacing:0.06em;'
            + 'margin-bottom:6px">' + label + '</div>';
    };

    // Status-Pille (gross + prominent) \u2014 Offline > Stale > Severity Hierarchie
    const statusPill = isOff
        ? '<span style="display:inline-flex;align-items:center;gap:4px;'
            + 'padding:3px 10px;border-radius:11px;background:rgba(229,55,66,0.13);'
            + 'color:#e53742;font-size:12px;font-weight:700">'
            + '<span style="width:8px;height:8px;border-radius:50%;background:#e53742;'
            + 'display:inline-block"></span>OFFLINE</span>'
        : isStale
        ? '<span style="display:inline-flex;align-items:center;gap:4px;'
            + 'padding:3px 10px;border-radius:11px;background:rgba(245,158,11,0.13);'
            + 'color:#92400e;font-size:12px;font-weight:700">'
            + '<span style="width:8px;height:8px;border-radius:50%;background:#f59e0b;'
            + 'display:inline-block"></span>STALE</span>'
        : '<span style="display:inline-flex;align-items:center;gap:4px;'
            + 'padding:3px 10px;border-radius:11px;background:' + sc + '22;'
            + 'color:' + sc + ';font-size:12px;font-weight:700">'
            + '<span style="width:8px;height:8px;border-radius:50%;background:' + sc + ';'
            + 'display:inline-block"></span>' + esc(SEV_LBL[d.severity || 0] || 'Normal')
            + '</span>';

    // Status-Badges (Pinned, Wartung, Acked, Note) als kleine Chips daneben
    const badges = [];
    if (d.pinned)        badges.push('<span style="background:rgba(59,130,246,0.13);color:#3b82f6;font-size:10px;font-weight:600;padding:2px 7px;border-radius:9px">&#128204; Fixiert</span>');
    if (d.maintenance)   badges.push('<span style="background:rgba(245,158,11,0.13);color:#92400e;font-size:10px;font-weight:600;padding:2px 7px;border-radius:9px">\u{1F527} Wartung</span>');
    if (d.acknowledged)  badges.push('<span style="background:rgba(34,197,94,0.13);color:#16a34a;font-size:10px;font-weight:600;padding:2px 7px;border-radius:9px">\u2714 Acked</span>');
    if (d.note)          badges.push('<span style="background:rgba(245,158,11,0.13);color:#92400e;font-size:10px;font-weight:600;padding:2px 7px;border-radius:9px" title="' + esc(d.note) + '">&#127991; Notiz</span>');

    // Identitaets-Section (Host, Type, IP, Interface) \u2014 kompakte Key-Value-Liste
    const idRow = function(k, v) {
        return '<div style="display:flex;font-size:12px;line-height:1.4;'
            + 'padding:1px 0">'
            + '<span style="color:#64748b;min-width:72px;flex-shrink:0">' + k + '</span>'
            + '<span style="color:#1f2c33;font-weight:500;'
            + 'overflow:hidden;text-overflow:ellipsis">' + v + '</span>'
            + '</div>';
    };
    const identityHtml =
          idRow('Host', esc(d.host || d.label))
        + idRow('Type', '<b style="color:' + ti.col + '">' + ti.icon + ' ' + esc(ti.lbl) + '</b>' + customMark)
        + idRow('IP', esc(d.ip || '\u2014'))
        + idRow('Interface', ifaceCell);

    // Metrik-Numeric-Liste (zusaetzlich zu den Rings \u2014 gibt exakte Werte
    // mit Unit). Stale-Marker greifen hier durch fmtMetric().
    const metricsHtml =
          idRow('CPU',    fmtMetric(d.cpu    != null ? '<b>' + d.cpu    + '%</b>' : '\u2014'))
        + idRow('Memory', fmtMetric(d.memory != null ? '<b>' + d.memory + '%</b>' : '\u2014'))
        + idRow('Ping',   fmtMetric(d.ping > 0       ? '<b>' + d.ping   + ' ms</b>' : '\u2014'))
        + idRow('&#8595; In',  fmtMetric('<span style="color:#22c55e">'
            + fmt(d.traffic ? d.traffic.in  : 0) + '</span>'))
        + idRow('&#8593; Out', fmtMetric('<span style="color:#38bdf8">'
            + fmt(d.traffic ? d.traffic.out : 0) + '</span>'));

    // Offline-Banner: rote prominente Box ueber dem Action-Bar.
    // "vor 5m" / "vor 2h" / "vor 3d" relative-time-Format.
    const fmtAgo = function(unixTs) {
        if (!unixTs || unixTs <= 0) return '';
        const sec = Math.max(0, Math.floor(Date.now() / 1000) - unixTs);
        if (sec < 60)    return 'vor ' + sec + 's';
        if (sec < 3600)  return 'vor ' + Math.floor(sec / 60) + 'm';
        if (sec < 86400) return 'vor ' + Math.floor(sec / 3600) + 'h';
        return 'vor ' + Math.floor(sec / 86400) + 'd';
    };
    // Stale-Banner: orangener Hinweis wenn Host zwar online aber Items
    // veraltet sind — separate Box, kommt NACH dem Offline-Banner falls beide
    // zutreffen (selten, aber moeglich wenn Zabbix unavailable=false meldet
    // und gleichzeitig keine neuen Werte ankommen).
    const staleBanner = (isStale && !isOff)
        ? '<div style="background:rgba(245,158,11,0.13);border:1px solid #f59e0b;'
            + 'border-left:4px solid #f59e0b;border-radius:2px;padding:6px 10px;'
            + 'margin-bottom:8px;color:#92400e;font-size:12px">'
            + '<div style="font-weight:700">&#9888; STALE &middot; letzter Wert ' + fmtAgo(d.last_seen) + '</div>'
            + '<div style="font-size:11px;margin-top:2px;font-style:italic">'
            + 'Host gilt laut Zabbix als verfuegbar, aber es kommen keine '
            + 'aktuellen Item-Werte mehr an</div>'
            + '</div>'
        : '';
    const offlineBanner = isOff
        ? '<div style="background:rgba(229,55,66,0.12);border:1px solid #e53742;'
            + 'border-left:4px solid #e53742;border-radius:2px;padding:6px 10px;'
            + 'margin-bottom:8px;color:#e53742;font-size:12px">'
            + '<div style="font-weight:700">&#9888; OFFLINE'
            + (d.down_since ? ' &middot; ' + fmtAgo(d.down_since) : '')
            + '</div>'
            + (d.down_error
                ? '<div style="font-size:11px;color:#9c1a25;margin-top:2px;'
                    + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap" '
                    + 'title="' + esc(d.down_error) + '">' + esc(d.down_error) + '</div>'
                : '')
            + '<div style="font-size:11px;color:#9c1a25;margin-top:2px;font-style:italic">'
            + 'Metriken unten sind die letzten Werte vor Disconnect</div>'
            + '</div>'
        : '';

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

    let ringHtml = '<div style="display:flex;gap:8px;margin-bottom:6px;padding:2px 0">';
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
    // Extra-Items-Block (nt:show-Tags) — bei mehr als 4 Items collapsible
    // mit Summary "X Items anzeigen", verhindert dass das Panel ausufert.
    const _items = d.extra_items || [];
    const _itemsCollapsible = _items.length > 4;
    const _itemsHtml = _items.map(function(it) {
        const val = it.error
            ? '<span style="color:#94a3b8;font-style:italic">' + esc(it.error) + '</span>'
            : '<b>' + esc(fmtItemValue(it.value, it.units)) + '</b>';
        return '<div style="display:flex;font-size:11px;line-height:1.45;padding:1px 0">'
            + '<span style="color:#64748b;flex:1;min-width:0;'
            +     'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
            +     'padding-right:10px" title="' + esc(it.name || '') + '">'
            +     esc((it.name || '').substring(0, 40)) + '</span>'
            + '<span style="color:#1f2c33;font-weight:500;flex-shrink:0">'
            +     val + '</span>'
            + '</div>';
    }).join('');
    const extraBlock = _items.length > 0
        ? section('Items')
            + (_itemsCollapsible
                ? '<details><summary style="font-size:11px;color:#0275b8;cursor:pointer;'
                    + 'user-select:none;margin-bottom:4px">'
                    + _items.length + ' Items anzeigen</summary>'
                    + _itemsHtml
                    + '</details>'
                : _itemsHtml)
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
    // Edit-Action nur fuer Admins (NT_CONFIG.can_edit). Zabbix wuerde es
    // serverseitig blocken, aber die UI soll keinen Button anzeigen der
    // dann auf "Forbidden" landet.
    const actions = [
        { lbl: '\u{1F4CA}', title: 'Latest Data',
          url: zbxOrigin + 'zabbix.php?action=latest.view&filter_set=1&hostids%5B%5D=' + hostId },
        { lbl: '\u26A0',    title: 'Probleme',
          url: zbxOrigin + 'zabbix.php?action=problem.view&filter_set=1&hostids%5B%5D=' + hostId },
        { lbl: '\u{1F4C8}', title: 'Graphs',
          url: zbxOrigin + 'zabbix.php?action=charts.view&filter_set=1&filter_hostids%5B%5D=' + hostId },
    ];
    if (window.NT_CONFIG && window.NT_CONFIG.can_edit) {
        actions.push({ lbl: '\u2699\uFE0F', title: 'Bearbeiten',
          url: zbxOrigin + 'zabbix.php?action=popup&popup=host.edit&hostid=' + hostId });
    }
    const actionBar = '<div style="display:flex;gap:4px;margin-bottom:4px">'
        + actions.map(function(a, i) {
            return '<button data-act="' + i + '" title="' + esc(a.title) + '" '
                + 'style="flex:1;padding:5px;background:#f4f6f7;border:1px solid #dfe4e7;'
                + 'border-radius:2px;cursor:pointer;font-size:13px;color:#1f2c33;'
                + 'transition:background 0.12s">' + a.lbl + '</button>';
        }).join('')
        + '</div>';

    // Status-Section: Status-Pille + optionale Status-Badges nebeneinander.
    const statusSection = section('Status')
        + '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px">'
        + statusPill
        + (badges.length ? badges.join('') : '')
        + '</div>';

    panel.innerHTML =
        // Header: Icon + Hostname + Type-Pill + Close-Button
        '<div style="display:flex;align-items:center;justify-content:space-between;'
        + 'margin-bottom:8px;gap:6px">'
        + '<div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0">'
            + '<span style="font-size:18px;line-height:1;flex-shrink:0">' + ti.icon + '</span>'
            + '<span style="font-weight:700;font-size:14px;color:#0f172a;'
            + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(d.label) + '">'
            + esc(d.label) + '</span>'
            + '<span style="display:inline-block;padding:1px 6px;border-radius:9px;'
            + 'background:' + ti.col + '22;color:' + ti.col + ';'
            + 'font-size:9px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;'
            + 'flex-shrink:0">' + esc(ti.lbl) + customMark + '</span>'
        + '</div>'
        + '<button id="nt-detail-close" style="background:none;border:none;cursor:pointer;'
        + 'color:#94a3b8;font-size:18px;line-height:1;padding:0;flex-shrink:0">&#x2715;</button>'
        + '</div>'
        + offlineBanner
        + staleBanner
        + actionBar
        + statusSection
        + section('Identität') + identityHtml
        + section('Metriken') + ringHtml + metricsHtml
        + extraBlock
        + (peers
            ? section('Verbindungen')
                + '<div style="font-size:11px;color:#475569;line-height:1.6">' + peers + '</div>'
            : '');

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
