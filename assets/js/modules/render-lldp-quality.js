// render-lldp-quality.js — Tab "LLDP Quality": Discovery-Erfolgsquote pro Host.
//
// Was wir hier auswerten (Backend liefert es in window._ntLastData.lldp_quality):
//   matched     — Neighbor-Item-Wert wurde auf einen Zabbix-Host gemappt
//   unmatched   — Wert konnte gar nicht gemappt werden (Host fehlt in Zabbix
//                 oder Name passt nicht)
//   ambiguous   — Short-Name matched mehrere Hosts → wir koennen nicht
//                 sicher zuordnen und legen keine Edge an (sonst Falschmapping)
//   self        — Host meldet sich selbst als Nachbarn (uebliches Mgmt-VLAN-
//                 Phaenomen, ignoriert)
//
// Aggregat-Header zeigt Summen + Match-Quote, dann zwei Tabellen:
//   1. Pro-Host-Quality: Reporter mit unmatched/ambiguous-Counts
//   2. Top-Unmatched-Neighbors: distinct Strings nach Haeufigkeit
//
// Wichtig: Zabbix selbst kennt keine "unbekannter Nachbar"-Klassifikation.
// Diese Bewertung machen wir hier im Modul aus dem rohen Item-Value.

import { esc } from './utils.js';

const COL_GOOD = '#16a34a';
const COL_WARN = '#f59e0b';
const COL_BAD  = '#dc2626';

function _theme(dark) {
    return dark
        ? { bg:'#0d1117', surface:'#161b22', head:'#1c2128', text:'#e6edf3', sub:'#8b949e',
            subSoft:'#6e7681', border:'#30363d', borderSoft:'#21262d', accent:'#0275b8' }
        : { bg:'#ffffff', surface:'#f8fafc', head:'#f1f5f9', text:'#1f2c33', sub:'#64748b',
            subSoft:'#94a3b8', border:'#dfe4e7', borderSoft:'#eef2f5', accent:'#0275b8' };
}

function _srcBadge(src) {
    const colors = { lldp: '#0891b2', cdp: '#a855f7', other: '#64748b' };
    const c = colors[src] || colors.other;
    return '<span style="display:inline-block;background:' + c + ';color:#fff;padding:0 5px;'
        + 'border-radius:3px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em">'
        + esc(src) + '</span>';
}

function _aggregateBlock(perHost, theme) {
    let totalMatched = 0, totalUnmatched = 0, totalAmbiguous = 0, totalSelf = 0;
    perHost.forEach(function(h) {
        totalMatched   += h.matched;
        totalUnmatched += (h.unmatched || []).length;
        totalAmbiguous += (h.ambiguous || []).length;
        totalSelf      += h.self || 0;
    });
    const total = totalMatched + totalUnmatched + totalAmbiguous;
    const matchPct = total > 0 ? Math.round(100 * totalMatched / total) : 0;
    const pctCol = matchPct >= 90 ? COL_GOOD : matchPct >= 70 ? COL_WARN : COL_BAD;
    const reporters = perHost.length;

    return '<div style="background:' + theme.surface + ';border:1px solid ' + theme.border
        + ';border-radius:6px;padding:14px 18px;margin-bottom:18px;display:flex;'
        + 'gap:24px;align-items:center;flex-wrap:wrap">'
        + '<div><div style="font-size:10px;color:' + theme.sub + ';text-transform:uppercase;'
        +   'letter-spacing:0.05em">Match-Quote</div>'
        +   '<div style="font-size:28px;font-weight:700;color:' + pctCol + ';font-family:monospace;'
        +     'line-height:1">' + matchPct + '%</div></div>'
        + '<div><div style="font-size:10px;color:' + theme.sub + ';text-transform:uppercase">Reporter</div>'
        +   '<div style="font-size:20px;font-weight:700;color:' + theme.text + ';font-family:monospace">'
        +     reporters + '</div></div>'
        + '<div><div style="font-size:10px;color:' + theme.sub + ';text-transform:uppercase">Matched</div>'
        +   '<div style="font-size:20px;font-weight:700;color:' + COL_GOOD + ';font-family:monospace">'
        +     totalMatched + '</div></div>'
        + '<div><div style="font-size:10px;color:' + theme.sub + ';text-transform:uppercase">Unmatched</div>'
        +   '<div style="font-size:20px;font-weight:700;color:' + (totalUnmatched > 0 ? COL_BAD : theme.subSoft)
        +     ';font-family:monospace">' + totalUnmatched + '</div></div>'
        + '<div><div style="font-size:10px;color:' + theme.sub + ';text-transform:uppercase">Ambiguous</div>'
        +   '<div style="font-size:20px;font-weight:700;color:' + (totalAmbiguous > 0 ? COL_WARN : theme.subSoft)
        +     ';font-family:monospace">' + totalAmbiguous + '</div></div>'
        + '<div><div style="font-size:10px;color:' + theme.sub + ';text-transform:uppercase">Self-Loops</div>'
        +   '<div style="font-size:20px;font-weight:700;color:' + theme.subSoft + ';font-family:monospace">'
        +     totalSelf + '</div></div>'
        + '</div>';
}

function _perHostTable(perHost, theme) {
    if (!perHost.length) {
        return '<div style="color:' + theme.subSoft + ';padding:20px 0;font-style:italic">'
            + 'Keine Hosts melden LLDP/CDP-Nachbarn in der aktuellen Auswahl.</div>';
    }
    // Sortierung: meiste Issues (unmatched+ambiguous) zuerst, dann nach matched desc
    const sorted = perHost.slice().sort(function(a, b) {
        const ia = (a.unmatched || []).length + (a.ambiguous || []).length;
        const ib = (b.unmatched || []).length + (b.ambiguous || []).length;
        return ib - ia || b.matched - a.matched;
    });
    let html = '<h3 style="margin:18px 0 8px;font-size:13px;color:' + theme.sub
        + ';text-transform:uppercase;letter-spacing:0.04em">Pro Reporter</h3>'
        + '<table style="border-collapse:collapse;font-size:12px;width:100%">'
        + '<thead><tr style="border-bottom:1px solid ' + theme.border + '">'
        + ['Reporter', 'Matched', 'Unmatched', 'Ambiguous', 'Self', 'Details'].map(function(h) {
            return '<th style="padding:6px 10px;text-align:left;color:' + theme.sub + ';font-weight:600">' + h + '</th>';
        }).join('') + '</tr></thead><tbody>';
    sorted.forEach(function(h) {
        const u = (h.unmatched || []).length;
        const a = (h.ambiguous || []).length;
        const detailItems = [];
        (h.unmatched || []).slice(0, 5).forEach(function(x) {
            detailItems.push('<div style="display:flex;gap:6px;align-items:center">'
                + _srcBadge(x.src) + '<span style="color:' + COL_BAD + '">✗</span> '
                + '<code style="font-size:11px">' + esc(x.raw) + '</code></div>');
        });
        if (u > 5) detailItems.push('<div style="color:' + theme.subSoft + ';font-size:10px">'
            + '… und ' + (u - 5) + ' weitere unmatched</div>');
        (h.ambiguous || []).slice(0, 3).forEach(function(x) {
            detailItems.push('<div style="display:flex;gap:6px;align-items:center">'
                + _srcBadge(x.src) + '<span style="color:' + COL_WARN + '">?</span> '
                + '<code style="font-size:11px">' + esc(x.raw) + '</code> '
                + '<span style="color:' + theme.subSoft + ';font-size:10px">('
                + ((x.candidates || []).length) + ' Kandidaten)</span></div>');
        });
        html += '<tr style="border-bottom:1px solid ' + theme.borderSoft + '">'
            + '<td style="padding:5px 10px;font-weight:600">' + esc(h.label) + '</td>'
            + '<td style="padding:5px 10px;text-align:right;color:' + COL_GOOD + ';font-family:monospace">' + h.matched + '</td>'
            + '<td style="padding:5px 10px;text-align:right;color:' + (u > 0 ? COL_BAD : theme.subSoft) + ';font-family:monospace">' + u + '</td>'
            + '<td style="padding:5px 10px;text-align:right;color:' + (a > 0 ? COL_WARN : theme.subSoft) + ';font-family:monospace">' + a + '</td>'
            + '<td style="padding:5px 10px;text-align:right;color:' + theme.subSoft + ';font-family:monospace">' + (h.self || 0) + '</td>'
            + '<td style="padding:5px 10px">' + (detailItems.length ? detailItems.join('') : '<span style="color:' + theme.subSoft + '">—</span>') + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';
    return html;
}

function _topUnmatchedTable(perHost, theme) {
    // Top-Unmatched: distinct strings sortiert nach Anzahl der Reporter die ihn melden
    const counts = {};
    perHost.forEach(function(h) {
        (h.unmatched || []).forEach(function(x) {
            const k = x.raw + '\x00' + x.src;
            if (!counts[k]) counts[k] = { raw: x.raw, src: x.src, count: 0, reporters: {} };
            counts[k].count++;
            counts[k].reporters[h.id] = h.label;
        });
    });
    const list = Object.values(counts).sort(function(a, b) { return b.count - a.count; });
    if (!list.length) {
        return '';
    }
    let html = '<h3 style="margin:18px 0 8px;font-size:13px;color:' + theme.sub
        + ';text-transform:uppercase;letter-spacing:0.04em">Top Unmatched Neighbors</h3>'
        + '<table style="border-collapse:collapse;font-size:12px;width:100%">'
        + '<thead><tr style="border-bottom:1px solid ' + theme.border + '">'
        + ['Reported Name', 'Source', 'Hits', 'Gemeldet von'].map(function(h) {
            return '<th style="padding:6px 10px;text-align:left;color:' + theme.sub + ';font-weight:600">' + h + '</th>';
        }).join('') + '</tr></thead><tbody>';
    list.slice(0, 50).forEach(function(u) {
        const reporters = Object.values(u.reporters).slice(0, 3).map(esc).join(', ');
        const more = Object.keys(u.reporters).length - 3;
        html += '<tr style="border-bottom:1px solid ' + theme.borderSoft + '">'
            + '<td style="padding:5px 10px"><code>' + esc(u.raw) + '</code></td>'
            + '<td style="padding:5px 10px">' + _srcBadge(u.src) + '</td>'
            + '<td style="padding:5px 10px;text-align:right;font-family:monospace;font-weight:600">' + u.count + '</td>'
            + '<td style="padding:5px 10px;color:' + theme.sub + ';font-size:11px">' + reporters
            + (more > 0 ? ' <span style="color:' + theme.subSoft + '">(+' + more + ')</span>' : '')
            + '</td>'
            + '</tr>';
    });
    if (list.length > 50) {
        html += '<tr><td colspan="4" style="padding:6px 10px;color:' + theme.subSoft
            + ';font-style:italic">… und ' + (list.length - 50) + ' weitere distinct</td></tr>';
    }
    html += '</tbody></table>';
    return html;
}

export function renderLldpQuality(wrap) {
    if (window._ntCy)       { try { window._ntCy.destroy(); } catch (e) {} window._ntCy = null; }
    if (window._ntEdgeAnim) { clearInterval(window._ntEdgeAnim); window._ntEdgeAnim = null; }

    const dark = !!(document.getElementById('nt-root')
                 && document.getElementById('nt-root').classList.contains('nt-dark'));
    const theme = _theme(dark);

    Array.from(wrap.children).forEach(function(ch) {
        if (ch.id !== 'nt-loading') wrap.removeChild(ch);
    });

    const root = document.createElement('div');
    root.style.cssText = 'padding:20px;background:' + theme.bg + ';color:' + theme.text
        + ';height:100%;overflow:auto;font-family:sans-serif';

    const head = document.createElement('div');
    head.innerHTML = '<h2 style="margin:0 0 6px;font-size:16px">LLDP / CDP Quality</h2>'
        + '<div style="font-size:12px;color:' + theme.sub + ';margin-bottom:16px">'
        + 'Wie zuverlaessig kann Zabbix die LLDP-/CDP-Nachbarn auf bekannte Hosts mappen?'
        + ' Match-Quote &lt; 90% bedeutet meist: Nachbarn existieren in der echten Welt'
        + ' aber nicht in Zabbix, oder die Naming-Konventionen weichen ab.'
        + '</div>';
    root.appendChild(head);

    const data = window._ntLastData || {};
    const perHost = data.lldp_quality || [];

    root.appendChild(_makeDiv(_aggregateBlock(perHost, theme)));
    root.appendChild(_makeDiv(_perHostTable(perHost, theme)));
    root.appendChild(_makeDiv(_topUnmatchedTable(perHost, theme)));

    wrap.appendChild(root);
}

function _makeDiv(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d;
}
