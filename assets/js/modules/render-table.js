// render-table.js — Tabellen-Ansicht ähnlich Nagios Service-Status-Details:
//
// Jede Zeile = ein Host. Spalten:
//   Status, Host, Type, Hostgroup, IP, CPU, Memory, Ping, # Probleme
//
// Filter-Bar oben:
//   - Status-Pills (OK/Info/Warn/Avg/High) — togglebar, Default alle an
//   - Hostgroup-Dropdown — falls mehrere Gruppen
//   - Freie Textsuche (sucht in Host, IP, Type)
//
// Klick-Verhalten:
//   - Klick auf Zeile (außer Hostname-Link) → Detail-Panel rechts
//   - Klick auf Hostname → Zabbix Latest-Data in neuem Tab
//
// Sortierung: Klick auf Spalten-Header. Default: Status-DESC (kritischste oben).

import { esc, fmt } from './utils.js';
import { SEV_COL, SEV_LBL, grpColor } from './severity.js';
import { fetchItemsPivot, buildPivotToolbar, renderPivotTable } from './items-pivot.js';
import { NT_TABLE_MODE_KEY, NT_ITEMS_PATTERN_KEY, NT_ITEMS_HIDE_EMPTY_KEY,
         NT_ITEMS_HEATMAP_KEY } from './storage.js';
import { showDetail } from './detail-panel.js';

// Konsistent mit detail-panel.js (TYPE_INFO dort dupliziert hier nur was wir
// für Spalte "Type" brauchen — vollständige Kopie wäre Overkill).
const TYPE_ICON = {
    firewall: '\u{1F525}', router: '\u{1F4E1}', switch: '\u{1F500}',
    wireless: '\u{1F4F6}', server: '\u{1F5A5}', storage: '\u{1F4BE}',
    hypervisor: '\u{1F9F1}', camera: '\u{1F4F7}', printer: '\u{1F5A8}',
    ups: '\u{1F50B}', homeauto: '\u{1F3E0}', mailserver: '\u2709\uFE0F',
    webserver: '\u{1F310}', container: '\u{1F4E6}', monitoring: '\u{1F4CA}',
    linux: '\u{1F427}', windows: '\u{1FA9F}', macos: '\u{1F34F}',
    internet: '\u{1F30D}',
};
const TYPE_LBL = {
    firewall: 'Firewall', router: 'Router', switch: 'Switch',
    wireless: 'WAP', server: 'Server', storage: 'Storage',
    hypervisor: 'Hypervisor', camera: 'Kamera', printer: 'Drucker',
    ups: 'USV', homeauto: 'Smart Home', mailserver: 'Mail',
    webserver: 'Web', container: 'Container', monitoring: 'Monitoring',
    linux: 'Linux', windows: 'Windows', macos: 'macOS', internet: 'Internet',
};

// Filter-State (lebt in dieser Modul-Closure, persistiert nicht zwischen Tab-Wechseln)
let _filterStatuses = new Set([0, 1, 2, 3, 4, 5]);  // alle Severities default an
let _filterGroup = '';   // '' = alle
let _filterText = '';
let _sortCol = 'severity';
let _sortDir = 'desc';

// Mode: 'hosts' = Standard-Tabelle, 'items' = Pivot-Tabelle
let _tableMode = 'hosts';
// Letztes verwendetes Pattern für die Items-Pivot (über Mode-Wechsel persistent)
let _itemsPattern = 'vfs.fs.size[*,pused]';
let _itemsData = null;
// Items-Modus-spezifische Filter/Sortierung (analog Hosts-Modus aber für Pivot)
let _itemsSearch = '';     // Hostname-Filter
let _itemsSortCol = '';    // '' = Hostname-Sort (default)
let _itemsSortDir = 'desc';
let _itemsHideEmpty = false;   // Toggle: leere Hosts/Items ausblenden
let _itemsHeatmap = false;     // Toggle: Heatmap-Coloring an/aus

// Persistente State-Restoration aus localStorage
try {
    const m = localStorage.getItem(NT_TABLE_MODE_KEY);
    if (m === 'hosts' || m === 'items') _tableMode = m;
    const p = localStorage.getItem(NT_ITEMS_PATTERN_KEY);
    if (p) _itemsPattern = p;
    const he = localStorage.getItem(NT_ITEMS_HIDE_EMPTY_KEY);
    if (he === '1') _itemsHideEmpty = true;
    const hm = localStorage.getItem(NT_ITEMS_HEATMAP_KEY);
    if (hm === '1') _itemsHeatmap = true;
} catch (e) {}

// Theme — wird einmal pro renderTable() gebaut und durch alle build*-Funktionen
// gereicht. Hell- und Dunkelmode-Farben in einer Map damit der Rest des Moduls
// keine #f8fafc-Konstanten kennt.
function mkTheme(dark) {
    if (dark) {
        return {
            bg:           '#0d1117',
            surface:      '#161b22',
            head:         '#1c2128',
            hover:        '#1f242c',
            stripe:       '#13181f',
            border:       '#30363d',
            borderSoft:   '#21262d',
            text:         '#e6edf3',
            textStrong:   '#f0f6fc',
            sub:          '#8b949e',
            subSoft:      '#6e7681',
            link:         '#58a6ff',
            accent:       '#1f6feb',
            inputBg:      '#0d1117',
            actionBg:     '#21262d',
            actionBorder: '#30363d',
            actionText:   '#c9d1d9',
            detailBg:     '#0d1117',
            detailText:   '#e6edf3',
            counterText:  '#8b949e',
            problemBg:    'rgba(220,38,38,0.18)',
            problemText:  '#f87171',
        };
    }
    return {
        bg:           '#ffffff',
        surface:      '#ffffff',
        head:         '#f8fafc',
        hover:        '#f1f5f9',
        stripe:       '#fbfcfd',
        border:       '#e2e8f0',
        borderSoft:   '#f1f5f9',
        text:         '#1e293b',
        textStrong:   '#0f172a',
        sub:          '#64748b',
        subSoft:      '#94a3b8',
        link:         '#2563eb',
        accent:       '#2563eb',
        inputBg:      '#ffffff',
        actionBg:     '#f1f5f9',
        actionBorder: '#e2e8f0',
        actionText:   '#475569',
        detailBg:     '#fafbfc',
        detailText:   '#1e293b',
        counterText:  '#64748b',
        problemBg:    'rgba(220,38,38,0.13)',
        problemText:  '#dc2626',
    };
}

function buildBaseUrl() {
    const p = window.location.pathname;
    const i = p.indexOf('/zabbix.php');
    return i > 0 ? p.substring(0, i + 1) : '/';
}

function fmtPct(v) {
    if (v === null || v === undefined || isNaN(v)) return '\u2014';
    return Math.round(v) + '%';
}

function fmtMs(v) {
    if (v === null || v === undefined || isNaN(v) || v < 0) return '\u2014';
    return v.toFixed(1) + ' ms';
}

// Proxy-Info als Tooltip-Text. Drei Fälle:
//   - Host hängt direkt am Server: "Server (kein Proxy)"
//   - Host hängt an Proxy-Group: "Proxy-Group: <name>"
//   - Host hängt an einzelnem Proxy: "Proxy: <name>"
//   - Host an Proxy + Group beides bekannt: "Proxy: <name> [grp:<group>]"
function proxyTooltip(n) {
    const pn = n.proxy_name || '';
    const pg = n.proxy_group_name || '';
    if (!pn && !pg) return 'Server (kein Proxy)';
    if (pn && pg)   return 'Proxy: ' + pn + ' [grp:' + pg + ']';
    if (pn)         return 'Proxy: ' + pn;
    return 'Proxy-Group: ' + pg;
}

// Bits/s in lesbare Einheit. Backend liefert die Werte in bps (bits/s),
// wir zeigen Kbps/Mbps/Gbps an.
function fmtBps(bps) {
    if (bps === null || bps === undefined || isNaN(bps) || bps < 0) return '\u2014';
    if (bps < 1000) return Math.round(bps) + ' bps';
    if (bps < 1e6)  return (bps / 1000).toFixed(1) + ' Kbps';
    if (bps < 1e9)  return (bps / 1e6).toFixed(1) + ' Mbps';
    return (bps / 1e9).toFixed(2) + ' Gbps';
}

// Alter eines Problems als kompakte Einheit ("5m", "3h", "2d").
// clock = Unix-Sekunden vom Backend.
function fmtAge(clock) {
    if (!clock || clock <= 0) return '';
    const sec = Math.max(0, Math.floor(Date.now() / 1000) - clock);
    if (sec < 60)    return sec + 's';
    if (sec < 3600)  return Math.floor(sec / 60) + 'm';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h';
    return Math.floor(sec / 86400) + 'd';
}

// Detail-Row mit den einzelnen Problemen eines Hosts.
// colspan deckt alle Spalten ab. Aufklapp-Toggle in der Probleme-Zelle der
// Haupt-Row schiebt diese Zeile direkt darunter ein/aus.
function buildProblemDetailRow(n, colspan, theme) {
    const list = n.problem_list || [];
    if (list.length === 0) {
        return '<tr class="nt-prob-detail" data-host-id="' + esc(String(n.id)) + '">'
            + '<td colspan="' + colspan + '" '
            + 'style="padding:14px 18px 14px 22px;background:' + theme.detailBg
            + ';border-bottom:1px solid ' + theme.borderSoft
            + ';color:' + theme.subSoft + ';font-size:12px">'
            + 'Keine Detail-Daten verf\u00fcgbar.</td></tr>';
    }
    let body = '';
    list.forEach(function(p) {
        const sev = p.severity || 0;
        const col = SEV_COL[sev] || theme.subSoft;
        const lbl = SEV_LBL[sev] || '';
        const age = fmtAge(p.clock);
        body += '<div style="display:flex;align-items:center;gap:10px;padding:5px 0;'
            + 'font-size:12.5px;line-height:1.4">'
            + '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;'
            +     'background:' + col + ';flex-shrink:0;box-shadow:0 0 0 2px ' + col + '22"></span>'
            + '<span style="color:' + col + ';font-weight:600;font-size:11px;'
            +     'text-transform:uppercase;letter-spacing:0.04em;min-width:64px">'
            +     esc(lbl) + '</span>'
            + '<span style="flex:1;color:' + theme.detailText
            +     ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
            +     esc(p.name || '') + '</span>'
            + (p.acknowledged
                ? '<span title="Best\u00e4tigt" style="color:#16a34a;font-size:11px;'
                    + 'font-weight:700;flex-shrink:0">\u2714</span>'
                : '')
            + (age
                ? '<span style="color:' + theme.subSoft + ';font-size:11px;font-family:'
                    + 'ui-monospace,SFMono-Regular,Menlo,monospace;flex-shrink:0;min-width:42px;'
                    + 'text-align:right">' + esc(age) + '</span>'
                : '')
            + '</div>';
    });
    return '<tr class="nt-prob-detail" data-host-id="' + esc(String(n.id)) + '">'
        + '<td colspan="' + colspan + '" '
        + 'style="padding:10px 18px 14px 38px;background:' + theme.detailBg
        + ';border-bottom:1px solid ' + theme.borderSoft + '">' + body + '</td></tr>';
}

function passesFilter(n) {
    if (!_filterStatuses.has(n.severity || 0)) return false;
    if (_filterGroup && n._primaryGroup !== _filterGroup) return false;
    if (_filterText) {
        const hay = (
            (n.host || '') + ' ' +
            (n.label || '') + ' ' +
            (n.ip || '') + ' ' +
            (n.type || '') + ' ' +
            (n.iftype || '') + ' ' +
            (n.proxy_name || '') + ' ' +
            (n.proxy_group_name || '')
        ).toLowerCase();
        if (hay.indexOf(_filterText.toLowerCase()) < 0) return false;
    }
    return true;
}

function compare(a, b) {
    const dir = _sortDir === 'desc' ? -1 : 1;
    let av, bv;
    switch (_sortCol) {
        case 'host':     av = (a.label || '').toLowerCase(); bv = (b.label || '').toLowerCase(); break;
        case 'type':     av = (a.type  || '').toLowerCase(); bv = (b.type  || '').toLowerCase(); break;
        case 'group':    av = (a._primaryGroup || '').toLowerCase(); bv = (b._primaryGroup || '').toLowerCase(); break;
        case 'ip':       av = a.ip || ''; bv = b.ip || ''; break;
        case 'cpu':      av = a.cpu || -1; bv = b.cpu || -1; break;
        case 'memory':   av = a.memory || -1; bv = b.memory || -1; break;
        case 'ping':     av = (a.ping == null ? 1e9 : a.ping); bv = (b.ping == null ? 1e9 : b.ping); break;
        // Traffic-Sortierung: Summe in+out (gibt einen sinnvollen "Lasttreiber"-Sort)
        case 'traffic':  av = ((a.traffic && a.traffic.in)  || 0) + ((a.traffic && a.traffic.out)  || 0);
                         bv = ((b.traffic && b.traffic.in)  || 0) + ((b.traffic && b.traffic.out)  || 0); break;
        case 'problems': av = a.problems || 0; bv = b.problems || 0; break;
        case 'severity':
        default:         av = a.severity || 0; bv = b.severity || 0; break;
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
    return 0;
}

function buildFilterBar(nodes, groupNames, theme) {
    const bar = document.createElement('div');
    bar.id = 'nt-table-filterbar';
    bar.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 18px;'
        + 'background:' + theme.head + ';border-bottom:1px solid ' + theme.border
        + ';flex-wrap:wrap';

    // Mode-Toggle: "Hosts" / "Items" — schaltet zwischen Standard-Tabelle
    // und Items-Pivot-Tabelle. Items-Modus blendet die Standard-Filter aus
    // und zeigt stattdessen Preset+Pattern-Auswahl.
    const modeWrap = document.createElement('div');
    modeWrap.style.cssText = 'display:inline-flex;border:1px solid ' + theme.border
        + ';border-radius:6px;overflow:hidden;background:' + theme.surface;
    const mkModeBtn = function(id, lbl) {
        const b = document.createElement('button');
        b.dataset.mode = id;
        b.textContent = lbl;
        const active = _tableMode === id;
        b.style.cssText = 'padding:6px 14px;border:none;cursor:pointer;font-size:12px;'
            + 'font-weight:600;letter-spacing:0.02em;font-family:inherit;'
            + 'transition:background 0.15s,color 0.15s;'
            + 'background:' + (active ? theme.accent : 'transparent')
            + ';color:' + (active ? '#ffffff' : theme.sub);
        modeWrap.appendChild(b);
        return b;
    };
    mkModeBtn('hosts', 'Hosts');
    mkModeBtn('items', 'Items');
    bar.appendChild(modeWrap);

    // Im Items-Modus: nur Mode-Toggle anzeigen, keine Status/Group/Suche-Filter.
    // Die Pivot-Toolbar (Preset + Pattern + Apply) wird separat ins
    // tableArea gerendert.
    if (_tableMode === 'items') {
        return bar;
    }

    // Status-Pills
    const sevWrap = document.createElement('div');
    sevWrap.style.cssText = 'display:flex;gap:5px;align-items:center';
    const sevLabel = document.createElement('span');
    sevLabel.textContent = 'Status';
    sevLabel.style.cssText = 'font-size:11px;color:' + theme.sub
        + ';font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-right:2px';
    sevWrap.appendChild(sevLabel);

    [0, 1, 2, 3, 4, 5].forEach(function(sev) {
        const pill = document.createElement('button');
        const active = _filterStatuses.has(sev);
        pill.dataset.sev = String(sev);
        pill.textContent = '\u25CF ' + SEV_LBL[sev];
        pill.style.cssText = 'padding:4px 11px;border:1px solid '
            + (active ? SEV_COL[sev] : theme.border)
            + ';background:' + (active ? SEV_COL[sev] + '22' : theme.surface)
            + ';color:' + (active ? SEV_COL[sev] : theme.subSoft)
            + ';border-radius:13px;font-size:11px;font-weight:600;cursor:pointer;'
            + 'transition:all 0.15s;font-family:inherit';
        sevWrap.appendChild(pill);
    });
    bar.appendChild(sevWrap);

    // Hostgroup-Filter (nur wenn >=2 Gruppen)
    if (groupNames.length >= 2) {
        const grpWrap = document.createElement('div');
        grpWrap.style.cssText = 'display:flex;gap:6px;align-items:center';

        const grpLabel = document.createElement('span');
        grpLabel.textContent = 'Gruppe';
        grpLabel.style.cssText = 'font-size:11px;color:' + theme.sub
            + ';font-weight:700;text-transform:uppercase;letter-spacing:0.06em';
        grpWrap.appendChild(grpLabel);

        const grpSel = document.createElement('select');
        grpSel.id = 'nt-table-group';
        grpSel.style.cssText = 'padding:5px 8px;border:1px solid ' + theme.border
            + ';border-radius:6px;font-size:12px;background:' + theme.surface
            + ';color:' + theme.text + ';font-family:inherit;cursor:pointer';
        const optAll = document.createElement('option');
        optAll.value = '';
        optAll.textContent = 'Alle (' + groupNames.length + ')';
        grpSel.appendChild(optAll);
        groupNames.forEach(function(g) {
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = g;
            if (g === _filterGroup) opt.selected = true;
            grpSel.appendChild(opt);
        });
        grpWrap.appendChild(grpSel);
        bar.appendChild(grpWrap);
    }

    // Suche — Lupen-Glyph als Prefix-Icon, Focus-Ring im Accent-Farbton
    const searchWrap = document.createElement('div');
    searchWrap.style.cssText = 'position:relative;display:flex;align-items:center';
    const searchIcon = document.createElement('span');
    searchIcon.textContent = '\u{1F50D}';
    searchIcon.style.cssText = 'position:absolute;left:9px;font-size:11px;opacity:0.55;'
        + 'pointer-events:none';
    const search = document.createElement('input');
    search.id = 'nt-table-search';
    search.type = 'text';
    search.placeholder = 'Suche Host / IP / Type / Interface / Proxy...';
    search.value = _filterText;
    search.style.cssText = 'padding:6px 10px 6px 28px;border:1px solid ' + theme.border
        + ';border-radius:6px;font-size:12px;width:240px;background:' + theme.inputBg
        + ';color:' + theme.text + ';font-family:inherit;outline:none;'
        + 'transition:border-color 0.15s,box-shadow 0.15s';
    search.addEventListener('focus', function() {
        this.style.borderColor = theme.accent;
        this.style.boxShadow = '0 0 0 3px ' + theme.accent + '22';
    });
    search.addEventListener('blur', function() {
        this.style.borderColor = theme.border;
        this.style.boxShadow = 'none';
    });
    searchWrap.appendChild(searchIcon);
    searchWrap.appendChild(search);
    bar.appendChild(searchWrap);

    // Counter rechts
    const counter = document.createElement('div');
    counter.id = 'nt-table-count';
    counter.style.cssText = 'margin-left:auto;font-size:12px;color:' + theme.counterText
        + ';font-weight:600;letter-spacing:0.02em';
    bar.appendChild(counter);

    return bar;
}

function rowHtml(n, baseUrl, theme) {
    const sev = n.severity || 0;
    const sevCol = SEV_COL[sev];
    const sevLbl = SEV_LBL[sev];
    const ti = TYPE_ICON[n.type] || '\u2753';
    const tl = TYPE_LBL[n.type] || (n.type || 'Unbekannt');
    const grp = n._primaryGroup || '';
    const grpCol = grp ? grpColor(grp) : theme.subSoft;
    // Mehr Atemluft pro Zeile + Mono-Font fuer numerische Spalten
    const cellPad   = 'padding:11px 14px';
    const cellPadR  = cellPad + ';text-align:right';
    const monoFam   = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
    const hostId = encodeURIComponent(n.id);
    const latestUrl = window.location.origin + baseUrl
        + 'zabbix.php?action=latest.view&filter_set=1&hostids%5B%5D=' + hostId;
    const probUrl   = window.location.origin + baseUrl
        + 'zabbix.php?action=problem.view&filter_set=1&hostids%5B%5D=' + hostId;
    const chartsUrl = window.location.origin + baseUrl
        + 'zabbix.php?action=charts.view&filter_set=1&filter_hostids%5B%5D=' + hostId;
    const editUrl   = window.location.origin + baseUrl
        + 'zabbix.php?action=popup&popup=host.edit&hostid=' + hostId;

    // Traffic: aus net.if-Items vom Backend, sind in n.traffic.{in,out} (bits/s).
    // fmtBps formatiert kompakt (Kbps/Mbps/Gbps).
    const tIn  = (n.traffic && n.traffic.in  != null) ? n.traffic.in  : null;
    const tOut = (n.traffic && n.traffic.out != null) ? n.traffic.out : null;
    const trafIn  = (tIn  != null && tIn  > 0) ? fmtBps(tIn)  : '\u2014';
    const trafOut = (tOut != null && tOut > 0) ? fmtBps(tOut) : '\u2014';

    // Action-Buttons im Stil des Detail-Panels — klein und farbneutral.
    // data-no-detail verhindert dass der Row-Click das Detail-Panel öffnet.
    const actBtn = function(url, lbl, title) {
        return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" '
            + 'data-no-detail="1" title="' + esc(title) + '" '
            + 'style="display:inline-flex;align-items:center;justify-content:center;'
            + 'width:24px;height:24px;margin:0 1px;background:' + theme.actionBg
            + ';border:1px solid ' + theme.actionBorder + ';border-radius:5px;'
            + 'text-decoration:none;color:' + theme.actionText + ';font-size:12px;'
            + 'line-height:1;transition:filter 0.15s">' + lbl + '</a>';
    };

    return '<tr data-host-id="' + esc(String(n.id)) + '" '
        + 'style="border-bottom:1px solid ' + theme.borderSoft + ';cursor:pointer;'
        + 'border-left:3px solid ' + sevCol + ';transition:background 0.12s">'
        // Status (Pille mit Punkt + Label)
        + '<td style="' + cellPad + '"><span style="display:inline-flex;align-items:center;'
            + 'gap:5px;padding:3px 9px;border-radius:11px;background:' + sevCol + '22;'
            + 'color:' + sevCol + ';font-size:11px;font-weight:700;letter-spacing:0.02em">'
            + '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;'
            + 'background:' + sevCol + '"></span>' + esc(sevLbl) + '</span></td>'
        // Host (Link zu Latest-Data)
        + '<td style="' + cellPad + '"><a href="' + esc(latestUrl) + '" '
            + 'target="_blank" rel="noopener noreferrer" '
            + 'data-no-detail="1" '
            + 'style="color:' + theme.link + ';text-decoration:none;font-weight:600;'
            + 'font-size:13px">'
            + esc(n.label || n.host || '') + '</a></td>'
        // Type (Icon + Label)
        + '<td style="' + cellPad + ';font-size:12.5px;color:' + theme.text + '">'
            + '<span style="margin-right:5px">' + ti + '</span>' + esc(tl) + '</td>'
        // Group (gefaerbte Pille pro Hostgroup)
        + '<td style="' + cellPad + '"><span style="display:inline-block;'
            + 'padding:2px 9px;border-radius:9px;background:' + grpCol + '22;'
            + 'color:' + grpCol + ';font-size:11px;font-weight:600">'
            + esc(grp || '\u2014') + '</span></td>'
        // IP + Interface-Typ ("192.168.33.10 (SNMP)") — Iftype kommt vom Backend.
        // Tooltip am Iftype-Span zeigt zusätzlich Proxy/Proxy-Group-Info
        // (oder "Server (kein Proxy)" wenn der Host direkt am Zabbix-Server hängt).
        + '<td style="' + cellPad + ';font-size:12.5px;color:' + theme.text
        + ';font-family:' + monoFam + '">'
            + esc(n.ip || '\u2014')
            + (n.iftype
                ? ' <span title="' + esc(proxyTooltip(n)) + '" '
                    + 'style="color:' + theme.subSoft + ';font-size:11px;cursor:help;'
                    + 'border-bottom:1px dotted ' + theme.border + '">(' + esc(n.iftype) + ')</span>'
                : '')
            + '</td>'
        // CPU / Memory / Ping - rechtsbuendig, Mono-Font
        + '<td style="' + cellPadR + ';font-size:12.5px;color:' + theme.text
            + ';font-family:' + monoFam + '">' + fmtPct(n.cpu) + '</td>'
        + '<td style="' + cellPadR + ';font-size:12.5px;color:' + theme.text
            + ';font-family:' + monoFam + '">' + fmtPct(n.memory) + '</td>'
        + '<td style="' + cellPadR + ';font-size:12.5px;color:' + theme.text
            + ';font-family:' + monoFam + '">' + fmtMs(n.ping) + '</td>'
        // Traffic In/Out (zwei Zeilen kompakt)
        + '<td style="' + cellPadR + ';font-size:11px;color:' + theme.text
            + ';font-family:' + monoFam + ';line-height:1.45;white-space:nowrap">'
            + '\u2193 ' + trafIn + '<br>\u2191 ' + trafOut
            + '</td>'
        // Probleme — clickable Toggle wenn Count>0
        + '<td style="' + cellPadR + '">'
            + (n.problems > 0
                ? '<button type="button" data-toggle-problems="' + esc(String(n.id)) + '" '
                    + 'data-no-detail="1" '
                    + 'title="Probleme aufklappen" '
                    + 'style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;'
                    + 'border:none;border-radius:11px;background:' + theme.problemBg
                    + ';color:' + theme.problemText + ';font-size:11px;font-weight:700;'
                    + 'cursor:pointer;font-family:inherit;transition:filter 0.15s">'
                    + '<span class="nt-prob-arrow" style="font-size:9px;display:inline-block;'
                    +     'transition:transform 0.15s;line-height:1">▶</span>'
                    + n.problems + '</button>'
                : '<span style="color:' + theme.subSoft + ';font-size:12px">0</span>')
            + '</td>'
        // Actions
        + '<td style="padding:11px 8px;text-align:right;white-space:nowrap">'
            + actBtn(latestUrl, '\u{1F4CA}', 'Latest Data')
            + actBtn(probUrl,   '\u26A0',    'Probleme')
            + actBtn(chartsUrl, '\u{1F4C8}', 'Graphs')
            + actBtn(editUrl,   '\u2699\uFE0F', 'Bearbeiten')
            + '</td>'
        + '</tr>';
}

function buildTable(nodes, baseUrl, theme) {
    const cols = [
        { id: 'severity', lbl: 'Status',    align: 'left'  },
        { id: 'host',     lbl: 'Host',      align: 'left'  },
        { id: 'type',     lbl: 'Type',      align: 'left'  },
        { id: 'group',    lbl: 'Gruppe',    align: 'left'  },
        { id: 'ip',       lbl: 'IP',        align: 'left'  },
        { id: 'cpu',      lbl: 'CPU',       align: 'right' },
        { id: 'memory',   lbl: 'Memory',    align: 'right' },
        { id: 'ping',     lbl: 'Ping',      align: 'right' },
        { id: 'traffic',  lbl: 'Traffic',   align: 'right' },
        { id: 'problems', lbl: 'Probleme',  align: 'right' },
        // Actions-Spalte: nicht sortierbar, deshalb data-sort weggelassen
        { id: '_actions', lbl: '',          align: 'right', noSort: true },
    ];

    let thead = '<thead style="position:sticky;top:0;background:' + theme.head
        + ';z-index:1;backdrop-filter:saturate(1.4)">'
        + '<tr style="border-bottom:1px solid ' + theme.border + '">';
    cols.forEach(function(c) {
        const isActive = c.id === _sortCol;
        const arrow = (isActive && !c.noSort) ? (_sortDir === 'desc' ? ' \u25BC' : ' \u25B2') : '';
        const sortAttr = c.noSort ? '' : ' data-sort="' + c.id + '"';
        const cursor = c.noSort ? 'default' : 'pointer';
        thead += '<th' + sortAttr + ' '
            + 'style="padding:12px 14px;text-align:' + c.align + ';font-size:10.5px;'
            + 'font-weight:700;color:' + (isActive ? theme.textStrong : theme.sub) + ';'
            + 'text-transform:uppercase;letter-spacing:0.07em;cursor:' + cursor
            + ';user-select:none;white-space:nowrap">'
            + esc(c.lbl) + arrow + '</th>';
    });
    thead += '</tr></thead>';

    let tbody = '<tbody>';
    const sorted = nodes.slice().sort(compare);
    let visible = 0;
    sorted.forEach(function(n) {
        if (passesFilter(n)) {
            tbody += rowHtml(n, baseUrl, theme);
            visible++;
        }
    });
    tbody += '</tbody>';

    if (visible === 0) {
        tbody = '<tbody><tr><td colspan="' + cols.length + '" '
            + 'style="padding:48px;text-align:center;color:' + theme.subSoft
            + ';font-size:13px;font-weight:500">'
            + '<div style="font-size:32px;margin-bottom:10px;opacity:0.4">\u{1F50D}</div>'
            + 'Keine Hosts entsprechen den Filtern.</td></tr></tbody>';
    }

    return {
        html: '<table style="width:100%;border-collapse:collapse;font-size:13px">'
            + thead + tbody + '</table>',
        visible: visible,
        total: nodes.length,
    };
}

export function renderTable(wrap, nodes, edges) {
    if (window._ntEdgeAnim) { clearInterval(window._ntEdgeAnim); window._ntEdgeAnim = null; }
    if (window._ntCy) { try { window._ntCy.destroy(); } catch (e) {} window._ntCy = null; }

    // Theme aus Dark-Mode-State des Root-Containers ableiten - alle weiteren
    // Build-Funktionen kriegen das Theme als Parameter rein.
    const dark = !!(document.getElementById('nt-root')
                 && document.getElementById('nt-root').classList.contains('nt-dark'));
    const theme = mkTheme(dark);

    if (!nodes.length) {
        wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;'
                       + 'height:100%;color:' + theme.subSoft + ';background:' + theme.bg
                       + '">Keine Hosts gefunden.</div>';
        return;
    }

    // Internet-Knoten ausblenden (kein echter Host)
    const realNodes = nodes.filter(function(n) {
        return !(n._isInternet || (n.id && String(n.id).indexOf('internet_') === 0));
    });
    // _primaryGroup setzen (analog render-tech) — wird für Filter und Spalte genutzt
    const cfg = window.NT_CONFIG;
    const sel = (cfg && cfg.selected_group_names) || [];
    realNodes.forEach(function(n) {
        if (!n._primaryGroup) {
            // Erstes selektiertes Group dass der Host hat, sonst erstes seiner groups
            const gs = n.groups || [];
            for (let i = 0; i < sel.length; i++) {
                if (gs.indexOf(sel[i]) >= 0) { n._primaryGroup = sel[i]; return; }
            }
            n._primaryGroup = gs[0] || '';
        }
    });

    const groupNames = [];
    realNodes.forEach(function(n) {
        if (n._primaryGroup && groupNames.indexOf(n._primaryGroup) < 0) {
            groupNames.push(n._primaryGroup);
        }
    });
    groupNames.sort();

    const baseUrl = buildBaseUrl();

    wrap.innerHTML = '';

    // Layout: Filter-Bar + Tabellen-Container (scrollbar) + Detail-Panel
    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;'
        + 'background:' + theme.bg + ';overflow:hidden';
    wrap.appendChild(root);

    const filterBar = buildFilterBar(realNodes, groupNames, theme);
    root.appendChild(filterBar);

    const tableArea = document.createElement('div');
    tableArea.id = 'nt-table-area';
    tableArea.style.cssText = 'flex:1;overflow:auto;background:' + theme.bg;
    root.appendChild(tableArea);

    // Detail-Panel-Container (gleicher Style wie in render-tech) - wird bei
    // Klick auf Zeile gefuellt.
    // Idempotent: bei Mode-Toggle (Hosts<>Items) oder Tab-Wechsel wuerden sonst
    // mehrere <div id="nt-detail-panel"> ans body angehaengt. Vorhandenen
    // entfernen, dann frischen anlegen.
    const oldPanel = document.getElementById('nt-detail-panel');
    if (oldPanel) oldPanel.remove();
    const detailPanel = document.createElement('div');
    detailPanel.id = 'nt-detail-panel';
    detailPanel.style.cssText = 'position:fixed;top:170px;right:20px;width:300px;'
        + 'background:' + theme.surface + ';border:1px solid ' + theme.border
        + ';border-radius:10px;padding:14px;color:' + theme.text + ';'
        + 'box-shadow:0 8px 24px rgba(0,0,0,0.12);z-index:200;display:none;'
        + 'max-height:calc(100vh - 200px);overflow-y:auto';
    document.body.appendChild(detailPanel);

    function rerenderTable() {
        const r = buildTable(realNodes, baseUrl, theme);
        tableArea.innerHTML = r.html;
        const counter = document.getElementById('nt-table-count');
        if (counter) {
            counter.textContent = r.visible === r.total
                ? r.total + ' Hosts'
                : r.visible + ' / ' + r.total + ' Hosts';
        }
        wireTable();
    }

    // Items-Modus: Pivot-Toolbar + Pivot-Tabelle in tableArea rendern.
    // Detail-Panel wird hier ausgeblendet (kein sinnvoller Klick-Handler im Pivot).
    async function renderItemsMode() {
        tableArea.innerHTML = '';
        detailPanel.style.display = 'none';

        // Toolbar-Wrapper (Preset+Pattern + Suchfeld) - selbe Optik wie Filter-Bar
        const wrapInner = document.createElement('div');
        wrapInner.style.cssText = 'padding:12px 18px;background:' + theme.head
            + ';border-bottom:1px solid ' + theme.border;
        tableArea.appendChild(wrapInner);

        const toolbar = buildPivotToolbar(function(pattern) {
            _itemsPattern = pattern;
            try { localStorage.setItem(NT_ITEMS_PATTERN_KEY, pattern); } catch (e) {}
            loadAndRenderItems();
        }, theme);
        wrapInner.appendChild(toolbar);
        const patIn = toolbar.querySelector('#nt-items-pattern');
        if (patIn) {
            patIn.value = _itemsPattern;
            // Preset-Select syncen falls das geladene Pattern einem Preset entspricht
            // (sonst blieb es auf dem ersten Preset stehen, auch bei Custom-Pattern).
            patIn.dispatchEvent(new Event('input'));
        }

        // Suchfeld + Counter (zweite Zeile)
        const row2 = document.createElement('div');
        row2.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:8px';
        const searchLbl = document.createElement('span');
        searchLbl.textContent = 'Suche Host';
        searchLbl.style.cssText = 'font-size:11px;color:' + theme.sub
            + ';font-weight:700;text-transform:uppercase;letter-spacing:0.06em';
        row2.appendChild(searchLbl);

        const searchIn = document.createElement('input');
        searchIn.type = 'text';
        searchIn.id = 'nt-items-hostsearch';
        searchIn.placeholder = 'Hostname filtern...';
        searchIn.value = _itemsSearch;
        // Native Autocomplete via <datalist> — Browser-Default-Dropdown
        // mit Vorschlaegen aus den verfuegbaren Hostnamen. Keine Custom-Lib
        // noetig. Liste wird gefuellt sobald _itemsData da ist (s. unten).
        searchIn.setAttribute('list', 'nt-items-hostlist');
        searchIn.setAttribute('autocomplete', 'off');   // off = browser-history aus,
                                                         // datalist bleibt aktiv
        searchIn.style.cssText = 'flex:1;max-width:280px;padding:6px 10px;border:1px solid '
            + theme.border + ';border-radius:6px;font-size:12px;background:' + theme.inputBg
            + ';color:' + theme.text + ';font-family:inherit;outline:none;'
            + 'transition:border-color 0.15s,box-shadow 0.15s';
        searchIn.addEventListener('focus', function() {
            this.style.borderColor = theme.accent;
            this.style.boxShadow = '0 0 0 3px ' + theme.accent + '22';
        });
        searchIn.addEventListener('blur', function() {
            this.style.borderColor = theme.border;
            this.style.boxShadow = 'none';
        });
        row2.appendChild(searchIn);

        // Datalist als Sibling — id matched das list-Attribut oben.
        // Wird in renderPivotInto() befuellt sobald _itemsData da ist.
        const hostList = document.createElement('datalist');
        hostList.id = 'nt-items-hostlist';
        row2.appendChild(hostList);

        // Toggle: leere Hosts/Items ausblenden
        const hideEmptyBtn = document.createElement('button');
        hideEmptyBtn.type = 'button';
        hideEmptyBtn.id = 'nt-items-hide-empty';
        const _setHideEmptyStyle = function() {
            const active = _itemsHideEmpty;
            hideEmptyBtn.style.cssText = 'padding:5px 10px;border:1px solid '
                + (active ? theme.accent : theme.border) + ';border-radius:6px;'
                + 'background:' + (active ? theme.accent + '22' : theme.surface)
                + ';color:' + (active ? theme.accent : theme.sub)
                + ';font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;'
                + 'letter-spacing:0.02em;transition:all 0.15s';
        };
        hideEmptyBtn.textContent = 'Leere ausblenden';
        hideEmptyBtn.title = 'Hosts und Items ohne Werte verbergen';
        _setHideEmptyStyle();
        hideEmptyBtn.addEventListener('click', function() {
            _itemsHideEmpty = !_itemsHideEmpty;
            try { localStorage.setItem(NT_ITEMS_HIDE_EMPTY_KEY, _itemsHideEmpty ? '1' : '0'); } catch (e) {}
            _setHideEmptyStyle();
            renderPivotInto(pivotArea, counter);
        });
        row2.appendChild(hideEmptyBtn);

        // Toggle: Heatmap-Coloring (Gradient gruen->rot pro Spalte)
        const heatmapBtn = document.createElement('button');
        heatmapBtn.type = 'button';
        heatmapBtn.id = 'nt-items-heatmap';
        const _setHeatmapStyle = function() {
            const active = _itemsHeatmap;
            heatmapBtn.style.cssText = 'padding:5px 10px;border:1px solid '
                + (active ? theme.accent : theme.border) + ';border-radius:6px;'
                + 'background:' + (active ? theme.accent + '22' : theme.surface)
                + ';color:' + (active ? theme.accent : theme.sub)
                + ';font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;'
                + 'letter-spacing:0.02em;transition:all 0.15s';
        };
        heatmapBtn.textContent = 'Heatmap';
        heatmapBtn.title = 'Zellen-Hintergrund nach relativer Position in der Spalte einfaerben';
        _setHeatmapStyle();
        heatmapBtn.addEventListener('click', function() {
            _itemsHeatmap = !_itemsHeatmap;
            try { localStorage.setItem(NT_ITEMS_HEATMAP_KEY, _itemsHeatmap ? '1' : '0'); } catch (e) {}
            _setHeatmapStyle();
            renderPivotInto(pivotArea, counter);
        });
        row2.appendChild(heatmapBtn);

        const counter = document.createElement('span');
        counter.id = 'nt-items-count';
        counter.style.cssText = 'font-size:11px;color:' + theme.subSoft
            + ';margin-left:auto;font-weight:600';
        row2.appendChild(counter);
        wrapInner.appendChild(row2);

        // Pivot-Bereich
        const pivotArea = document.createElement('div');
        pivotArea.id = 'nt-items-pivot-area';
        pivotArea.style.cssText = 'padding:12px';
        tableArea.appendChild(pivotArea);

        let _searchTimer = null;
        searchIn.addEventListener('input', function() {
            const v = this.value;
            if (_searchTimer) clearTimeout(_searchTimer);
            _searchTimer = setTimeout(function() {
                _itemsSearch = v;
                renderPivotInto(pivotArea, counter);
            }, 150);
        });

        // Race-condition-Schutz analog History-Mode: bei schnellem Pattern-
        // Wechsel (z.B. mehrere "Anwenden"-Klicks in Folge) würde sonst
        // ein älterer Fetch _itemsData mit veralteten Daten überschreiben.
        let _itemsFetchSeq = 0;

        async function loadAndRenderItems() {
            pivotArea.innerHTML = '<div style="text-align:center;padding:30px;color:' + theme.subSoft + '">'
                + '<span style="display:inline-block;animation:nt-spin 1.2s linear infinite">\u23F3</span> '
                + 'Lade Items...</div>';
            const seq = ++_itemsFetchSeq;
            const data = await fetchItemsPivot(_itemsPattern);
            if (seq !== _itemsFetchSeq) return;   // neuere Anfrage in flight
            _itemsData = data;
            renderPivotInto(pivotArea, counter);
        }

        // Sortierung + Suche werden client-seitig auf _itemsData angewandt.
        // Wir KLONEN das Datenobjekt NICHT (war bei großen Setups merklich
        // teuer — JSON.parse(JSON.stringify) auf 100+ Hosts × 30 Items kostet).
        // Stattdessen: gefilterte HostIds berechnen und an renderPivotTable
        // mit dem Original-Datenobjekt übergeben — die Render-Funktion
        // iteriert nur über die übergebenen IDs.
        function renderPivotInto(area, counter) {
            if (!_itemsData) return;

            // Datalist mit allen Hostnamen befuellen (idempotent: nur einmal
            // pro neuem Datensatz — wir markieren den Stand mit dataset.filled).
            const dlExpect = String(Object.keys(_itemsData.hosts || {}).length);
            if (hostList && hostList.dataset.filled !== dlExpect) {
                while (hostList.firstChild) hostList.removeChild(hostList.firstChild);
                Object.values(_itemsData.hosts || {}).forEach(function(hn) {
                    if (!hn) return;
                    const o = document.createElement('option');
                    o.value = hn;
                    hostList.appendChild(o);
                });
                hostList.dataset.filled = dlExpect;
            }

            // Hostids nach Suche filtern (kein Clone — nur ID-Liste)
            const allIds = Object.keys(_itemsData.hosts || {});
            let visibleIds = allIds;
            if (_itemsSearch) {
                const q = _itemsSearch.toLowerCase();
                visibleIds = allIds.filter(function(hid) {
                    const hn = (_itemsData.hosts[hid] || '').toLowerCase();
                    return hn.indexOf(q) >= 0;
                });
            }

            // Sortierung der gefilterten IDs
            const sortHostIds = sortPivotHostIds(_itemsData, visibleIds);
            renderPivotTable(area, _itemsData, realNodes, sortHostIds, _itemsSortCol, _itemsSortDir, theme,
                { hideEmpty: _itemsHideEmpty, heatmap: _itemsHeatmap });

            const total = allIds.length;
            const visible = visibleIds.length;
            counter.textContent = visible === total
                ? total + ' Hosts \u00D7 ' + (_itemsData.columns || []).length + ' Items'
                : visible + ' / ' + total + ' Hosts \u00D7 ' + (_itemsData.columns || []).length + ' Items';

            area.querySelectorAll('th[data-sort]').forEach(function(th) {
                th.style.cursor = 'pointer';
                th.style.userSelect = 'none';
                th.addEventListener('click', function() {
                    const col = this.dataset.sort;
                    if (col === _itemsSortCol) {
                        _itemsSortDir = _itemsSortDir === 'desc' ? 'asc' : 'desc';
                    } else {
                        _itemsSortCol = col;
                        _itemsSortDir = 'desc';
                    }
                    renderPivotInto(area, counter);
                });
            });
        }

        // Sortierung der Host-IDs nach Spalte oder Hostname.
        // ids ist die bereits Filter-gerechte Subset-Liste (nicht alle).
        function sortPivotHostIds(data, ids) {
            ids = ids.slice();   // Copy damit wir nicht den Caller mutieren
            const dir = _itemsSortDir === 'desc' ? -1 : 1;
            if (!_itemsSortCol || _itemsSortCol === '__host__') {
                ids.sort(function(a, b) {
                    const ha = (data.hosts[a] || '').toLowerCase();
                    const hb = (data.hosts[b] || '').toLowerCase();
                    return ha < hb ? -1 * dir : ha > hb ? 1 * dir : 0;
                });
            } else {
                ids.sort(function(a, b) {
                    const va = (data.rows[a] && data.rows[a][_itemsSortCol]);
                    const vb = (data.rows[b] && data.rows[b][_itemsSortCol]);
                    // null/undefined immer ans Ende egal welche Richtung
                    if (va == null && vb == null) return 0;
                    if (va == null) return 1;
                    if (vb == null) return -1;
                    return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
                });
            }
            return ids;
        }

        await loadAndRenderItems();
    }

    // Top-Level: je nach _tableMode entweder Hosts- oder Items-Render.
    function renderCurrentMode() {
        if (_tableMode === 'items') {
            renderItemsMode();
        } else {
            rerenderTable();
        }
    }

    function wireTable() {
        // Sort-Handler auf Header
        tableArea.querySelectorAll('th[data-sort]').forEach(function(th) {
            th.addEventListener('click', function() {
                const col = this.dataset.sort;
                if (col === _sortCol) {
                    _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
                } else {
                    _sortCol = col;
                    _sortDir = 'desc';
                }
                rerenderTable();
            });
        });
        // Row-Click: Detail-Panel zeigen (nur Haupt-Rows, nicht Detail-Rows)
        tableArea.querySelectorAll('tr[data-host-id]:not(.nt-prob-detail)').forEach(function(tr) {
            tr.addEventListener('mouseenter', function() { this.style.background = theme.hover; });
            tr.addEventListener('mouseleave', function() { this.style.background = ''; });
            tr.addEventListener('click', function(e) {
                // Wenn der Klick auf einem Hostname-Link war (data-no-detail),
                // nicht das Detail-Panel öffnen — Browser folgt dem Link.
                if (e.target && e.target.closest && e.target.closest('[data-no-detail]')) return;
                const id = this.dataset.hostId;
                const n = realNodes.find(function(x) { return String(x.id) === String(id); });
                if (!n) return;
                detailPanel.style.display = 'block';
                showDetail(detailPanel, n, null);
            });
        });
        // Probleme-Toggle: schiebt Detail-Row mit Einzel-Problemen unter den Host.
        // colspan = Anzahl Spalten in buildTable (siehe cols-Array).
        tableArea.querySelectorAll('button[data-toggle-problems]').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const id = this.dataset.toggleProblems;
                const tr = this.closest('tr');
                if (!tr) return;
                const next = tr.nextElementSibling;
                const arrow = this.querySelector('.nt-prob-arrow');
                if (next && next.classList.contains('nt-prob-detail')
                        && next.dataset.hostId === id) {
                    // Schon offen → schließen
                    next.remove();
                    if (arrow) arrow.style.transform = '';
                    return;
                }
                const n = realNodes.find(function(x) { return String(x.id) === String(id); });
                if (!n) return;
                const tbl = tr.closest('table');
                const colspan = tbl ? tbl.querySelectorAll('thead th').length : 11;
                tr.insertAdjacentHTML('afterend', buildProblemDetailRow(n, colspan, theme));
                if (arrow) arrow.style.transform = 'rotate(90deg)';
            });
        });
    }

    // Filter-Wire-Up
    filterBar.querySelectorAll('button[data-sev]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const sev = parseInt(this.dataset.sev, 10);
            if (_filterStatuses.has(sev)) _filterStatuses.delete(sev);
            else _filterStatuses.add(sev);
            // Pill-Style updaten
            const active = _filterStatuses.has(sev);
            this.style.borderColor = active ? SEV_COL[sev] : theme.border;
            this.style.background = active ? SEV_COL[sev] + '22' : theme.surface;
            this.style.color = active ? SEV_COL[sev] : theme.subSoft;
            rerenderTable();
        });
    });
    const grpSel = document.getElementById('nt-table-group');
    if (grpSel) {
        grpSel.addEventListener('change', function() {
            _filterGroup = this.value;
            rerenderTable();
        });
    }
    const search = document.getElementById('nt-table-search');
    if (search) {
        let _searchTimer = null;
        search.addEventListener('input', function() {
            const v = this.value;
            if (_searchTimer) clearTimeout(_searchTimer);
            _searchTimer = setTimeout(function() {
                _filterText = v;
                rerenderTable();
            }, 150);
        });
    }

    // Mode-Toggle: Hosts / Items
    filterBar.querySelectorAll('button[data-mode]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const newMode = this.dataset.mode;
            if (newMode === _tableMode) return;
            _tableMode = newMode;
            try { localStorage.setItem(NT_TABLE_MODE_KEY, newMode); } catch (e) {}
            // Komplettes Re-Render damit Filter-Bar/Closures stimmen
            renderTable(wrap, nodes, edges);
        });
    });

    renderCurrentMode();
}

// Cleanup für Tab-Wechsel
export function cleanupTable() {
    const dp = document.getElementById('nt-detail-panel');
    if (dp && dp.parentNode === document.body) dp.parentNode.removeChild(dp);
}
