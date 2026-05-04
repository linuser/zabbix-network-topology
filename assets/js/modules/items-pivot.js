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
    // Filesystem
    { id: 'disks',      lbl: 'Filesystem Auslastung (%)',
      pattern: 'vfs.fs.size[*,pused]', unit: '%' },
    { id: 'disks_used', lbl: 'Filesystem Used (Bytes)',
      pattern: 'vfs.fs.size[*,used]', unit: 'B' },
    // Block-Device IO (Standard Linux-Template, Zabbix 7.x)
    { id: 'dev_util',   lbl: 'Disk Utilization (%)',
      pattern: 'vfs.dev.util[*]',         unit: '%' },
    { id: 'dev_rrate',  lbl: 'Disk Read Rate (r/s)',
      pattern: 'vfs.dev.read.rate[*]',    unit: '' },
    { id: 'dev_wrate',  lbl: 'Disk Write Rate (w/s)',
      pattern: 'vfs.dev.write.rate[*]',   unit: '' },
    { id: 'dev_queue',  lbl: 'Disk Queue Size',
      pattern: 'vfs.dev.queue_size[*]',   unit: '' },
    { id: 'dev_rawait', lbl: 'Disk Read Wait (ms)',
      pattern: 'vfs.dev.read.await[*]',   unit: 'ms' },
    { id: 'dev_wawait', lbl: 'Disk Write Wait (ms)',
      pattern: 'vfs.dev.write.await[*]',  unit: 'ms' },
    // System
    { id: 'mem',        lbl: 'Memory (Bytes)',
      pattern: 'vm.memory.size[*]',   unit: 'B' },
    { id: 'cpu',        lbl: 'CPU-Util (%)',
      pattern: 'system.cpu.util*',    unit: '%' },
    // Network
    { id: 'netin',      lbl: 'Network In (bps)',
      pattern: 'net.if.in[*]',        unit: 'bps' },
    { id: 'netout',     lbl: 'Network Out (bps)',
      pattern: 'net.if.out[*]',       unit: 'bps' },
    // Connectivity
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

// Fallback-Theme falls renderTable kein Theme reicht (z.B. neuer Aufrufer).
// Hat dieselben Keys wie mkTheme() in render-table.js \u2014 Light-Mode Werte.
const FALLBACK_THEME = {
    head: '#f8fafc', surface: '#ffffff', inputBg: '#ffffff',
    border: '#e2e8f0', borderSoft: '#f1f5f9',
    text: '#1e293b', textStrong: '#0f172a', sub: '#64748b', subSoft: '#94a3b8',
    accent: '#2563eb', link: '#2563eb',
};

// Renders the items-pivot toolbar (preset-dropdown + custom-pattern + apply).
// Wird einmal angelegt und bleibt zwischen Render-Zyklen erhalten.
export function buildPivotToolbar(onApply, theme) {
    const t = theme || FALLBACK_THEME;
    const wrap = document.createElement('div');
    wrap.id = 'nt-items-toolbar';
    wrap.style.cssText = 'display:flex;align-items:center;gap:10px;padding:0;flex-wrap:wrap';

    const lbl = document.createElement('span');
    lbl.textContent = 'Preset';
    lbl.style.cssText = 'font-size:11px;color:' + t.sub
        + ';font-weight:700;text-transform:uppercase;letter-spacing:0.06em';
    wrap.appendChild(lbl);

    const sel = document.createElement('select');
    sel.id = 'nt-items-preset';
    sel.style.cssText = 'padding:5px 8px;border:1px solid ' + t.border
        + ';border-radius:6px;font-size:12px;background:' + t.surface
        + ';color:' + t.text + ';font-family:inherit;cursor:pointer';
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
    patWrap.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:200px';
    const patLbl = document.createElement('span');
    patLbl.textContent = 'Pattern';
    patLbl.style.cssText = 'font-size:11px;color:' + t.sub
        + ';font-weight:700;text-transform:uppercase;letter-spacing:0.06em';
    patWrap.appendChild(patLbl);

    const pat = document.createElement('input');
    pat.type = 'text';
    pat.id = 'nt-items-pattern';
    pat.placeholder = 'z.B. vfs.fs.size[*,pused]';
    pat.value = PRESETS[0].pattern;
    pat.style.cssText = 'flex:1;padding:6px 10px;border:1px solid ' + t.border
        + ';border-radius:6px;font-size:12px;font-family:'
        + 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:' + t.inputBg
        + ';color:' + t.text + ';outline:none;'
        + 'transition:border-color 0.15s,box-shadow 0.15s';
    pat.addEventListener('focus', function() {
        this.style.borderColor = t.accent;
        this.style.boxShadow = '0 0 0 3px ' + t.accent + '22';
    });
    pat.addEventListener('blur', function() {
        this.style.borderColor = t.border;
        this.style.boxShadow = 'none';
    });
    patWrap.appendChild(pat);
    wrap.appendChild(patWrap);

    const apply = document.createElement('button');
    apply.textContent = 'Anwenden';
    apply.style.cssText = 'padding:6px 14px;border:1px solid ' + t.accent
        + ';border-radius:6px;background:' + t.accent
        + ';color:#ffffff;cursor:pointer;font-size:12px;font-weight:600;'
        + 'font-family:inherit;letter-spacing:0.02em;transition:filter 0.15s';
    wrap.appendChild(apply);

    sel.addEventListener('change', function() {
        if (this.value === '__custom__') {
            pat.value = '';
            pat.focus();
        } else {
            pat.value = this.value;
        }
    });
    // Wenn der User das Pattern manuell aendert und es matcht keinen Preset
    // mehr, springt das Dropdown auf "Custom" — sonst sieht man "Disk-Auslastung"
    // bei einem net.if.in[*]-Pattern, was inkonsistent wirkt.
    pat.addEventListener('input', function() {
        const v = pat.value;
        const match = PRESETS.find(function(p) { return p.pattern === v; });
        sel.value = match ? match.pattern : '__custom__';
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
export function renderPivotTable(container, data, hostsLookup, sortHostIds, sortCol, sortDir, theme, options) {
    const t = theme || FALLBACK_THEME;
    const monoFam = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
    const opt = options || {};
    const hideEmpty = !!opt.hideEmpty;
    container.innerHTML = '';

    if (!data || data.error) {
        container.innerHTML = '<div style="padding:30px;text-align:center;color:' + t.subSoft + '">'
            + 'Fehler beim Laden: ' + esc((data && data.error) || 'unbekannt') + '</div>';
        return;
    }
    if (!data.columns || data.columns.length === 0) {
        // Empty-State mit Hilfetext
        const reasons = '<ul style="text-align:left;display:inline-block;margin-top:10px;'
            + 'color:' + t.sub + ';font-size:12px;line-height:1.7">'
            + '<li>Pattern matched keine Items in den ausgew\u00E4hlten Hostgroups</li>'
            + '<li>Items sind nicht numerisch (nur Float/Int werden angezeigt)</li>'
            + '<li>Items sind nicht aktiviert (disabled/unsupported)</li>'
            + '<li>Pattern zu spezifisch \u2014 versuche z.B. mit \u201E*\u201D zu erweitern</li>'
            + '</ul>';
        container.innerHTML = '<div style="padding:48px 30px;text-align:center;color:' + t.text + '">'
            + '<div style="font-size:32px;margin-bottom:10px;opacity:0.4">\u{1F50D}</div>'
            + '<div style="font-size:14px;font-weight:600;margin-bottom:4px">'
            + 'Keine matching Items gefunden.</div>'
            + reasons + '</div>';
        return;
    }

    let cols = data.columns;
    const rows = data.rows || {};
    const hostMeta = data.hosts || {};

    // Wenn keine sortierte Liste uebergeben wurde: alphabetisch nach Hostname
    let hostIds = sortHostIds;
    if (!hostIds) {
        hostIds = Object.keys(hostMeta);
        hostIds.sort(function(a, b) {
            return (hostMeta[a] || '').localeCompare(hostMeta[b] || '');
        });
    }

    // primaryGroup-Map aus hostsLookup ableiten (fuer Hostgroup-Grouping)
    const _primaryGroup = {};
    if (Array.isArray(hostsLookup)) {
        hostsLookup.forEach(function(n) {
            _primaryGroup[String(n.id)] = n._primaryGroup || '';
        });
    }
    const _selOrder = (window.NT_CONFIG && window.NT_CONFIG.selected_group_names) || [];
    const _groupRank = function(hid) {
        const g = _primaryGroup[String(hid)] || '';
        const idx = _selOrder.indexOf(g);
        return idx >= 0 ? idx : 999;
    };
    // Hostgroup-Grouping: Zeilen nach primaryGroup-Rank vor-sortieren, damit
    // Hosts derselben Gruppe zusammenstehen. Innerhalb einer Gruppe behaelt
    // die vom Caller uebergebene Reihenfolge ihren Sinn (Hostname / Sortcol).
    const _hasMultiGroups = new Set(hostIds.map(function(hid) {
        return _primaryGroup[String(hid)] || '';
    })).size >= 2;
    if (_hasMultiGroups) {
        hostIds = hostIds.slice().sort(function(a, b) {
            const ra = _groupRank(a), rb = _groupRank(b);
            return ra - rb;
        });
    }

    // Hide-Empty-Filter: Spalten ohne irgendeinen Wert raus, dann Zeilen
    // ohne Werte (in den noch sichtbaren Spalten) raus.
    if (hideEmpty) {
        cols = cols.filter(function(c) {
            return hostIds.some(function(hid) {
                const v = rows[hid] && rows[hid][c.key];
                return v != null;
            });
        });
        hostIds = hostIds.filter(function(hid) {
            return cols.some(function(c) {
                const v = rows[hid] && rows[hid][c.key];
                return v != null;
            });
        });
    }

    const baseUrl = buildBaseUrl();

    // Aggregat-Helper: Sum / Avg / Max ueber non-null numerische Werte.
    const aggregate = function(values, mode) {
        const nums = values.filter(function(v) {
            return v != null && !isNaN(v);
        });
        if (nums.length === 0) return null;
        if (mode === 'sum') return nums.reduce(function(a, b) { return a + b; }, 0);
        if (mode === 'max') return Math.max.apply(null, nums);
        return nums.reduce(function(a, b) { return a + b; }, 0) / nums.length;
    };

    // Sort-Pfeil-Helfer
    const arrow = function(col) {
        if (col !== sortCol) return '';
        return sortDir === 'desc' ? ' \u25BC' : ' \u25B2';
    };

    // Tabelle aufbauen
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12.5px';

    // Header — alle Spalten sortierbar via data-sort
    let thead = '<thead><tr style="background:' + t.head + ';border-bottom:1px solid ' + t.border + '">'
        + '<th data-sort="__host__" style="padding:12px 14px;text-align:left;font-size:10.5px;'
        + 'font-weight:700;color:' + (sortCol === '__host__' || !sortCol ? t.textStrong : t.sub)
        + ';text-transform:uppercase;letter-spacing:0.07em;cursor:pointer;user-select:none;'
        + 'position:sticky;left:0;background:' + t.head + ';z-index:1">Host'
        + arrow('__host__') + (!sortCol ? ' \u25B2' : '') + '</th>';
    // Spalten-Label aufraeumen: Zabbix-Discovery-Keys stehen oft in Quotes
    // (z.B. net.if.in["BR-MAILCOW"]) — die fuehrenden/abschliessenden " sind
    // Delimiter und in der UI nur Laerm.
    const cleanLabel = function(s) {
        return String(s || '').replace(/^"+|"+$/g, '');
    };
    cols.forEach(function(c) {
        const isActive = c.key === sortCol;
        thead += '<th data-sort="' + esc(c.key) + '" '
            + 'style="padding:12px 14px;text-align:right;font-size:10.5px;'
            + 'font-weight:700;color:' + (isActive ? t.textStrong : t.sub)
            + ';text-transform:uppercase;letter-spacing:0.07em;cursor:pointer;user-select:none;'
            + 'font-family:' + monoFam + ';white-space:nowrap" '
            + 'title="' + esc(c.key) + '">'
            + esc(cleanLabel(c.label))
            + (c.unit ? ' <span style="opacity:0.55">(' + esc(c.unit) + ')</span>' : '')
            + arrow(c.key)
            + '</th>';
    });
    // Aggregat-Spalte rechts (Avg pro Host-Zeile)
    thead += '<th style="padding:12px 14px;text-align:right;font-size:10.5px;'
        + 'font-weight:700;color:' + t.sub + ';text-transform:uppercase;'
        + 'letter-spacing:0.07em;font-family:' + monoFam + ';white-space:nowrap;'
        + 'border-left:2px solid ' + t.border + '" title="Durchschnitt ueber alle Item-Spalten">'
        + 'Avg</th>';
    thead += '</tr></thead>';
    table.innerHTML = thead;

    const tbody = document.createElement('tbody');
    let _lastGroup = null;
    const _colspan = cols.length + 2;   // Host-Col + Item-Cols + Avg-Col

    hostIds.forEach(function(hid) {
        const hostname = hostMeta[hid] || '';
        const row = rows[hid] || {};
        const grp = _primaryGroup[String(hid)] || '';

        // Gruppen-Separator-Zeile wenn >=2 Gruppen UND Gruppe wechselt
        if (_hasMultiGroups && grp !== _lastGroup) {
            tbody.insertAdjacentHTML('beforeend',
                '<tr><td colspan="' + _colspan + '" '
                + 'style="padding:8px 14px;background:' + t.head
                + ';color:' + t.sub + ';font-size:10.5px;font-weight:700;'
                + 'text-transform:uppercase;letter-spacing:0.07em;'
                + 'border-top:1px solid ' + t.border + ';border-bottom:1px solid ' + t.borderSoft
                + ';position:sticky;left:0">'
                + esc(grp || '— Ohne Gruppe —') + '</td></tr>');
            _lastGroup = grp;
        }

        const latestHostUrl = window.location.origin + baseUrl
            + 'zabbix.php?action=latest.view&filter_set=1&hostids%5B%5D=' + encodeURIComponent(hid);

        let html = '<tr style="border-bottom:1px solid ' + t.borderSoft
            + ';transition:background 0.12s">'
            + '<td style="padding:11px 14px;font-weight:600;font-size:13px;'
            + 'position:sticky;left:0;background:' + t.surface + ';z-index:1;'
            + 'border-right:1px solid ' + t.borderSoft + '">'
            + '<a href="' + esc(latestHostUrl) + '" target="_blank" rel="noopener noreferrer" '
            + 'style="color:' + t.link + ';text-decoration:none">' + esc(hostname) + '</a></td>';

        const rowVals = [];
        cols.forEach(function(c) {
            const v = row[c.key];
            if (v != null) rowVals.push(v);
            // Drill-Down-URL pro Zelle: Latest Data fuer Host gefiltert nach
            // Spalten-Label (z.B. "sda"). Zabbix nimmt das als Substring im
            // Item-Namen — funktioniert in den meisten Discovery-Templates.
            const cellLink = window.location.origin + baseUrl
                + 'zabbix.php?action=latest.view&filter_set=1'
                + '&hostids%5B%5D=' + encodeURIComponent(hid)
                + '&select=' + encodeURIComponent(cleanLabel(c.label) || c.key);
            const cellColor = (v == null ? t.subSoft : t.text);
            html += '<td style="padding:0;text-align:right;font-family:' + monoFam + ';'
                + 'font-size:12.5px">'
                + (v != null
                    ? '<a href="' + esc(cellLink) + '" target="_blank" rel="noopener noreferrer" '
                        + 'style="display:block;padding:11px 14px;color:' + cellColor
                        + ';text-decoration:none" title="In Latest Data oeffnen">'
                        + esc(fmtVal(v, c.unit)) + '</a>'
                    : '<span style="display:block;padding:11px 14px;color:' + cellColor + '">'
                        + esc(fmtVal(v, c.unit)) + '</span>')
                + '</td>';
        });
        // Aggregat-Spalte (Avg) pro Zeile rechts
        const avgVal = aggregate(rowVals, 'avg');
        const aggUnit = (cols[0] && cols[0].unit) || '';
        html += '<td style="padding:11px 14px;text-align:right;font-family:' + monoFam + ';'
            + 'font-size:12.5px;color:' + (avgVal == null ? t.subSoft : t.textStrong)
            + ';font-weight:600;border-left:2px solid ' + t.border + '">'
            + esc(fmtVal(avgVal, aggUnit)) + '</td>';
        html += '</tr>';
        tbody.insertAdjacentHTML('beforeend', html);
    });
    table.appendChild(tbody);

    // Footer: Sum / Avg / Max pro Item-Spalte
    if (hostIds.length > 0) {
        const tfoot = document.createElement('tfoot');
        ['sum', 'avg', 'max'].forEach(function(mode, idx) {
            const lblMap = { sum: 'Sum', avg: 'Avg', max: 'Max' };
            let row = '<tr style="background:' + t.head
                + ';border-top:' + (idx === 0 ? '2px solid ' + t.border : '1px solid ' + t.borderSoft) + '">'
                + '<td style="padding:9px 14px;font-size:10.5px;font-weight:700;'
                + 'color:' + t.sub + ';text-transform:uppercase;letter-spacing:0.07em;'
                + 'position:sticky;left:0;background:' + t.head + ';z-index:1;'
                + 'border-right:1px solid ' + t.borderSoft + '">' + lblMap[mode] + '</td>';
            const footerSelfVals = [];
            cols.forEach(function(c) {
                const colVals = hostIds.map(function(hid) {
                    return rows[hid] && rows[hid][c.key];
                });
                const v = aggregate(colVals, mode);
                if (v != null) footerSelfVals.push(v);
                row += '<td style="padding:9px 14px;text-align:right;font-family:' + monoFam + ';'
                    + 'font-size:12px;color:' + (v == null ? t.subSoft : t.textStrong)
                    + ';font-weight:600">'
                    + esc(fmtVal(v, c.unit)) + '</td>';
            });
            // Avg-Spalte des Footers: aggregiert die Footer-Werte selbst
            const footerAvg = aggregate(footerSelfVals, 'avg');
            const aggUnit = (cols[0] && cols[0].unit) || '';
            row += '<td style="padding:9px 14px;text-align:right;font-family:' + monoFam + ';'
                + 'font-size:12px;color:' + (footerAvg == null ? t.subSoft : t.textStrong)
                + ';font-weight:600;border-left:2px solid ' + t.border + '">'
                + esc(fmtVal(footerAvg, aggUnit)) + '</td>';
            row += '</tr>';
            tfoot.insertAdjacentHTML('beforeend', row);
        });
        table.appendChild(tfoot);
    }

    // Truncated-Hinweis
    if (data.truncated) {
        const warn = document.createElement('div');
        warn.style.cssText = 'padding:10px 14px;background:#fef3c7;color:#92400e;'
            + 'font-size:12px;border-radius:6px;margin-bottom:10px;font-weight:500';
        warn.textContent = '\u26A0 Sehr viele Items \u2014 Liste wurde abgeschnitten. '
            + 'Spezifischeres Pattern verwenden.';
        container.appendChild(warn);
    }

    // Scroll-Wrapper falls breit
    const scroll = document.createElement('div');
    scroll.style.cssText = 'overflow-x:auto;background:' + t.surface
        + ';border:1px solid ' + t.border + ';border-radius:8px;'
        + 'box-shadow:0 1px 3px rgba(0,0,0,0.04)';
    scroll.appendChild(table);
    container.appendChild(scroll);
}
