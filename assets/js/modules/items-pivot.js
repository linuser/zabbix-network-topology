// items-pivot.js — Pivot-Tabelle: Hosts × Items (z.B. alle Disks der Hostgroup).
// Wird aus render-table.js aufgerufen wenn der Modus auf "Items" steht.
//
// UI-Flow:
//   - Toggle "Hosts/Items" im Tabellen-Tab schaltet zwischen Standard und Pivot
//   - Im Pivot: Preset-Dropdown + Custom-Pattern-Input
//   - Beim Apply: fetch network.topology.v6.items, render Pivot-Tabelle
//   - Hostnames als Zeilen (Link → Latest Data), Item-Discovery-Werte als Spalten
//
// Presets sind in PRESETS definiert — typische Item-Key-Muster für die
// häufigsten Wallboard-Sichten.

import { esc } from './utils.js';

const PRESETS = [
    { id: 'disks',      lbl: 'Disk-Auslastung (%)',
      pattern: 'vfs.fs.size[*,pused]', unit: '%' },
    { id: 'disks_used', lbl: 'Disk-Used (Bytes)',
      pattern: 'vfs.fs.size[*,used]', unit: 'B' },
    { id: 'mem',        lbl: 'Memory (Bytes)',
      pattern: 'vm.memory.size[*]',   unit: 'B' },
    { id: 'cpu',        lbl: 'CPU-Util (%)',
      pattern: 'system.cpu.util*',    unit: '%' },
    { id: 'netin',      lbl: 'Network In (bps)',
      pattern: 'net.if.in[*]',        unit: 'bps' },
    { id: 'netout',     lbl: 'Network Out (bps)',
      pattern: 'net.if.out[*]',       unit: 'bps' },
    { id: 'ping',       lbl: 'Ping-Loss + RTT',
      pattern: 'icmpping*',           unit: '' },
];

let _data = null;            // letzte Antwort vom Backend

function buildBaseUrl() {
    const p = window.location.pathname;
    const i = p.indexOf('/zabbix.php');
    return i > 0 ? p.substring(0, i + 1) : '/';
}

// Wert formatieren je nach Unit. Nichts Schlaues — units sind in Zabbix
// frei wählbar, wir machen nur die häufigsten Fälle.
function fmtVal(v, unit) {
    if (v === null || v === undefined || isNaN(v)) return '\u2014';
    if (unit === '%') return v.toFixed(1) + ' %';
    if (unit === 'B') {
        if (v < 1024) return v + ' B';
        if (v < 1048576) return (v / 1024).toFixed(1) + ' KB';
        if (v < 1073741824) return (v / 1048576).toFixed(1) + ' MB';
        if (v < 1099511627776) return (v / 1073741824).toFixed(2) + ' GB';
        return (v / 1099511627776).toFixed(2) + ' TB';
    }
    if (unit === 'bps') {
        if (v < 1000) return Math.round(v) + ' bps';
        if (v < 1e6) return (v / 1000).toFixed(1) + ' Kbps';
        if (v < 1e9) return (v / 1e6).toFixed(1) + ' Mbps';
        return (v / 1e9).toFixed(2) + ' Gbps';
    }
    if (unit === 'ms') return v.toFixed(2) + ' ms';
    // Default: Zahl mit max 2 Decimals
    if (v === Math.floor(v)) return String(v);
    return v.toFixed(2);
}

export async function fetchItemsPivot(pattern) {
    const cfg = window.NT_CONFIG;
    const groupids = (cfg && cfg.selected_groupids) || [];
    if (!groupids.length || !pattern) return null;

    const params = new URLSearchParams();
    params.append('action', 'network.topology.v6.items');
    params.append('pattern', pattern);
    groupids.forEach(function(g) { params.append('groupids[]', String(g)); });

    const url = buildBaseUrl() + 'zabbix.php?' + params.toString();
    try {
        const resp = await fetch(url, { credentials: 'same-origin' });
        const data = await resp.json();
        if (data.error) {
            console.warn('Items fetch error:', data.error);
            return { error: data.error };
        }
        _data = data;
        return data;
    } catch (e) {
        console.error('Items fetch failed:', e);
        return { error: e.message };
    }
}

// Renders the items-pivot toolbar (preset-dropdown + custom-pattern + apply).
// Wird einmal angelegt und bleibt zwischen Render-Zyklen erhalten.
export function buildPivotToolbar(onApply) {
    const wrap = document.createElement('div');
    wrap.id = 'nt-items-toolbar';
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 0;'
        + 'border-bottom:1px solid #e2e8f0;flex-wrap:wrap';

    const lbl = document.createElement('span');
    lbl.textContent = 'Preset:';
    lbl.style.cssText = 'font-size:12px;color:#475569;font-weight:600';
    wrap.appendChild(lbl);

    const sel = document.createElement('select');
    sel.id = 'nt-items-preset';
    sel.style.cssText = 'padding:4px 8px;border:1px solid #cbd5e1;border-radius:4px;'
        + 'font-size:12px;background:#fff';
    PRESETS.forEach(function(p) {
        const o = document.createElement('option');
        o.value = p.pattern;
        o.dataset.unit = p.unit;
        o.textContent = p.lbl;
        sel.appendChild(o);
    });
    // "Custom"-Eintrag am Ende
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = '\u2014 Custom-Pattern \u2014';
    sel.appendChild(customOpt);
    wrap.appendChild(sel);

    const patWrap = document.createElement('span');
    patWrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;min-width:200px';
    const patLbl = document.createElement('span');
    patLbl.textContent = 'Pattern:';
    patLbl.style.cssText = 'font-size:12px;color:#475569;font-weight:600';
    patWrap.appendChild(patLbl);

    const pat = document.createElement('input');
    pat.type = 'text';
    pat.id = 'nt-items-pattern';
    pat.placeholder = 'z.B. vfs.fs.size[*,pused]';
    pat.value = PRESETS[0].pattern;
    pat.style.cssText = 'flex:1;padding:4px 8px;border:1px solid #cbd5e1;'
        + 'border-radius:4px;font-size:12px;font-family:monospace;background:#fff';
    patWrap.appendChild(pat);
    wrap.appendChild(patWrap);

    const apply = document.createElement('button');
    apply.textContent = 'Anwenden';
    apply.style.cssText = 'padding:4px 12px;border:1px solid #2563eb;border-radius:4px;'
        + 'background:#2563eb;color:#fff;cursor:pointer;font-size:12px;font-weight:600';
    wrap.appendChild(apply);

    sel.addEventListener('change', function() {
        if (this.value === '__custom__') {
            pat.value = '';
            pat.focus();
        } else {
            pat.value = this.value;
        }
    });
    apply.addEventListener('click', function() {
        if (onApply) onApply(pat.value);
    });
    pat.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && onApply) onApply(pat.value);
    });

    return wrap;
}

// Rendert die Pivot-Tabelle in das gegebene Container-Element.
// data: { columns: [{key, label, unit}], rows: { hostid: {colKey: val} }, hosts: { hostid: hostname } }
// hostsLookup: aus dem Standard-Tabellen-Mode (für späteren Detail-Panel-Bezug)
// sortHostIds: bereits sortierte Liste der HostIds (vom Caller berechnet)
// sortCol/sortDir: aktive Sortierung — für Pfeil-Anzeige im Header
export function renderPivotTable(container, data, hostsLookup, sortHostIds, sortCol, sortDir) {
    container.innerHTML = '';

    if (!data || data.error) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8">'
            + 'Fehler beim Laden: ' + esc((data && data.error) || 'unbekannt') + '</div>';
        return;
    }
    if (!data.columns || data.columns.length === 0) {
        // Empty-State mit Hilfetext
        const reasons = '<ul style="text-align:left;display:inline-block;margin-top:8px;'
            + 'color:#64748b;font-size:12px;line-height:1.6">'
            + '<li>Pattern matched keine Items in den ausgew\u00E4hlten Hostgroups</li>'
            + '<li>Items sind nicht numerisch (nur Float/Int werden angezeigt)</li>'
            + '<li>Items sind nicht aktiviert (disabled/unsupported)</li>'
            + '<li>Pattern zu spezifisch \u2014 versuche z.B. mit \u201E*\u201D zu erweitern</li>'
            + '</ul>';
        container.innerHTML = '<div style="padding:30px;text-align:center;color:#475569">'
            + '<div style="font-size:14px;margin-bottom:6px">Keine matching Items gefunden.</div>'
            + reasons + '</div>';
        return;
    }

    const cols = data.columns;
    const rows = data.rows || {};
    const hostMeta = data.hosts || {};

    // Wenn keine sortierte Liste übergeben wurde: alphabetisch nach Hostname (alt-Verhalten)
    let hostIds = sortHostIds;
    if (!hostIds) {
        hostIds = Object.keys(hostMeta);
        hostIds.sort(function(a, b) {
            return (hostMeta[a] || '').localeCompare(hostMeta[b] || '');
        });
    }

    const baseUrl = buildBaseUrl();

    // Sort-Pfeil-Helfer
    const arrow = function(col) {
        if (col !== sortCol) return '';
        return sortDir === 'desc' ? ' \u25BC' : ' \u25B2';
    };

    // Tabelle aufbauen
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';

    // Header — alle Spalten sortierbar via data-sort
    let thead = '<thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">'
        + '<th data-sort="__host__" style="padding:8px 10px;text-align:left;font-size:11px;'
        + 'font-weight:700;color:' + (sortCol === '__host__' || !sortCol ? '#0f172a' : '#475569')
        + ';text-transform:uppercase;letter-spacing:0.5px;'
        + 'position:sticky;left:0;background:#f8fafc;z-index:1">Host'
        + arrow('__host__') + (!sortCol ? ' \u25B2' : '') + '</th>';
    cols.forEach(function(c) {
        const isActive = c.key === sortCol;
        thead += '<th data-sort="' + esc(c.key) + '" '
            + 'style="padding:8px 10px;text-align:right;font-size:11px;'
            + 'font-weight:700;color:' + (isActive ? '#0f172a' : '#475569')
            + ';text-transform:uppercase;letter-spacing:0.5px;font-family:monospace" '
            + 'title="' + esc(c.key) + '">'
            + esc(c.label)
            + (c.unit ? ' <span style="opacity:0.6">(' + esc(c.unit) + ')</span>' : '')
            + arrow(c.key)
            + '</th>';
    });
    thead += '</tr></thead>';
    table.innerHTML = thead;

    const tbody = document.createElement('tbody');
    hostIds.forEach(function(hid) {
        const hostname = hostMeta[hid] || '';
        const row = rows[hid] || {};
        const latestUrl = window.location.origin + baseUrl
            + 'zabbix.php?action=latest.view&filter_set=1&hostids%5B%5D=' + encodeURIComponent(hid);

        let html = '<tr style="border-bottom:1px solid #f1f5f9">'
            + '<td style="padding:6px 10px;font-weight:600;'
            + 'position:sticky;left:0;background:#fff;z-index:1;border-right:1px solid #f1f5f9">'
            + '<a href="' + esc(latestUrl) + '" target="_blank" rel="noopener noreferrer" '
            + 'style="color:#2563eb;text-decoration:none">' + esc(hostname) + '</a></td>';

        cols.forEach(function(c) {
            const v = row[c.key];
            html += '<td style="padding:6px 10px;text-align:right;font-family:monospace;'
                + 'color:' + (v == null ? '#94a3b8' : '#0f172a') + '">'
                + esc(fmtVal(v, c.unit)) + '</td>';
        });
        html += '</tr>';
        tbody.insertAdjacentHTML('beforeend', html);
    });
    table.appendChild(tbody);

    // Truncated-Hinweis
    if (data.truncated) {
        const warn = document.createElement('div');
        warn.style.cssText = 'padding:8px 12px;background:#fef3c7;color:#92400e;'
            + 'font-size:12px;border-radius:4px;margin-bottom:8px';
        warn.textContent = '\u26A0 Sehr viele Items \u2014 Liste wurde abgeschnitten. '
            + 'Spezifischeres Pattern verwenden.';
        container.appendChild(warn);
    }

    // Scroll-Wrapper falls breit
    const scroll = document.createElement('div');
    scroll.style.cssText = 'overflow-x:auto;background:#fff;border-radius:6px;'
        + 'box-shadow:0 1px 3px rgba(0,0,0,0.05)';
    scroll.appendChild(table);
    container.appendChild(scroll);
}
