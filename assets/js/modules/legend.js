// legend.js — Seitenleiste mit Gruppen, Severity-Verteilung, Ring-Farben.
//
// Wird beim ersten render() einmal gesetzt; Inhalt ist statisch nach dem
// initialen Build (kein Live-Update — bei Severity-Änderungen müsste man
// setupLegend nochmal mit den neuen Counts aufrufen, das passiert aber
// nirgendwo, weil der Legend-Block einen Snapshot des Zustands bei Load zeigt).

import { esc } from './utils.js';
import { SEV_COL, SEV_LBL, grpColor } from './severity.js';

export function setupLegend(groupNames, nodes) {
    const leg = document.getElementById('nt-legend');
    if (!leg) return;

    let html = '<div style="font-weight:600;color:#475569;margin-bottom:5px;font-size:10px">GRUPPEN</div>';
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
          + 'border-top:1px solid #f1f5f9;padding-top:5px">SEVERITY</div>';
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
          + 'border-top:1px solid #f1f5f9;padding-top:5px">RING</div>';
    [['CPU', '#3b82f6'], ['Memory', '#8b5cf6'], ['Traffic', '#22c55e'], ['Ping', '#f59e0b']].forEach(function(r) {
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">'
              + '<div style="width:9px;height:9px;border-radius:50%;background:' + r[1] + '"></div>'
              + '<span style="color:#475569;font-size:11px">' + r[0] + '</span>'
              + '</div>';
    });

    leg.innerHTML = html;
}
