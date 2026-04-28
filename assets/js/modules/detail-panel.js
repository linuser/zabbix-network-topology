// detail-panel.js — Detail-Panel rechts unten, das nach Klick auf einen Host
// dessen vollständige Werte und verbundene Peers anzeigt.
//
// Wird vom Tap-Handler im Render-Modul mit der Cytoscape-Node-Data gefüttert.
// Schließbar über das X oben rechts; setzt dabei alle Node-Opacities zurück
// (war zuvor durch Pfad-Highlight gedimmt).

import { esc, fmt, fmtItemValue } from './utils.js';
import { SEV_COL, SEV_LBL } from './severity.js';

export function showDetail(panel, d, cy) {
    const sc = SEV_COL[d.severity || 0] || SEV_COL[0];

    const rows = [
        ['Host', esc(d.host || d.label)],
        ['IP', esc(d.ip || '\u2014')],
        ['Interface', esc(d.iftype || '\u2014')],
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

    panel.innerHTML =
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px">'
        + '<div style="font-weight:700;font-size:13px;color:#0f172a;flex:1;margin-right:8px">' + esc(d.label) + '</div>'
        + '<button id="nt-detail-close" style="background:none;border:none;cursor:pointer;color:#94a3b8;'
        + 'font-size:18px;line-height:1;padding:0;flex-shrink:0">&#x2715;</button>'
        + '</div>'
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
}
