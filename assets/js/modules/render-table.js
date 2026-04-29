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
import { NT_TABLE_MODE_KEY, NT_ITEMS_PATTERN_KEY } from './storage.js';
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

// Persistente State-Restoration aus localStorage
try {
    const m = localStorage.getItem(NT_TABLE_MODE_KEY);
    if (m === 'hosts' || m === 'items') _tableMode = m;
    const p = localStorage.getItem(NT_ITEMS_PATTERN_KEY);
    if (p) _itemsPattern = p;
} catch (e) {}

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

function buildFilterBar(nodes, groupNames) {
    const bar = document.createElement('div');
    bar.id = 'nt-table-filterbar';
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;'
        + 'background:#f8fafc;border-bottom:1px solid #e2e8f0;flex-wrap:wrap';

    // Mode-Toggle: "Hosts" / "Items" — schaltet zwischen Standard-Tabelle
    // und Items-Pivot-Tabelle. Items-Modus blendet die Standard-Filter aus
    // und zeigt stattdessen Preset+Pattern-Auswahl.
    const modeWrap = document.createElement('div');
    modeWrap.style.cssText = 'display:inline-flex;border:1px solid #cbd5e1;'
        + 'border-radius:4px;overflow:hidden;margin-right:8px';
    const mkModeBtn = function(id, lbl) {
        const b = document.createElement('button');
        b.dataset.mode = id;
        b.textContent = lbl;
        const active = _tableMode === id;
        b.style.cssText = 'padding:4px 12px;border:none;cursor:pointer;font-size:12px;'
            + 'font-weight:600;background:' + (active ? '#2563eb' : '#fff')
            + ';color:' + (active ? '#fff' : '#475569');
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
    sevWrap.style.cssText = 'display:flex;gap:4px;align-items:center';
    const sevLabel = document.createElement('span');
    sevLabel.textContent = 'Status:';
    sevLabel.style.cssText = 'font-size:12px;color:#475569;font-weight:600;margin-right:4px';
    sevWrap.appendChild(sevLabel);

    [0, 1, 2, 3, 4, 5].forEach(function(sev) {
        const pill = document.createElement('button');
        const active = _filterStatuses.has(sev);
        pill.dataset.sev = String(sev);
        pill.textContent = '\u25CF ' + SEV_LBL[sev];
        pill.style.cssText = 'padding:3px 9px;border:1px solid '
            + (active ? SEV_COL[sev] : '#cbd5e1')
            + ';background:' + (active ? SEV_COL[sev] + '22' : '#fff')
            + ';color:' + (active ? SEV_COL[sev] : '#94a3b8')
            + ';border-radius:11px;font-size:11px;font-weight:600;cursor:pointer;'
            + 'transition:all 0.15s';
        sevWrap.appendChild(pill);
    });
    bar.appendChild(sevWrap);

    // Hostgroup-Filter (nur wenn ≥2 Gruppen)
    if (groupNames.length >= 2) {
        const sep1 = document.createElement('div');
        sep1.style.cssText = 'width:1px;height:18px;background:#cbd5e1';
        bar.appendChild(sep1);

        const grpLabel = document.createElement('span');
        grpLabel.textContent = 'Gruppe:';
        grpLabel.style.cssText = 'font-size:12px;color:#475569;font-weight:600';
        bar.appendChild(grpLabel);

        const grpSel = document.createElement('select');
        grpSel.id = 'nt-table-group';
        grpSel.style.cssText = 'padding:3px 6px;border:1px solid #cbd5e1;border-radius:4px;'
            + 'font-size:12px;background:#fff';
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
        bar.appendChild(grpSel);
    }

    // Suche
    const sep2 = document.createElement('div');
    sep2.style.cssText = 'width:1px;height:18px;background:#cbd5e1';
    bar.appendChild(sep2);

    const search = document.createElement('input');
    search.id = 'nt-table-search';
    search.type = 'text';
    search.placeholder = 'Suche Host / IP / Type / Interface / Proxy...';
    search.value = _filterText;
    search.style.cssText = 'padding:4px 8px;border:1px solid #cbd5e1;border-radius:4px;'
        + 'font-size:12px;width:220px';
    bar.appendChild(search);

    // Counter rechts
    const counter = document.createElement('div');
    counter.id = 'nt-table-count';
    counter.style.cssText = 'margin-left:auto;font-size:12px;color:#64748b;font-weight:600';
    bar.appendChild(counter);

    return bar;
}

function rowHtml(n, baseUrl) {
    const sev = n.severity || 0;
    const sevCol = SEV_COL[sev];
    const sevLbl = SEV_LBL[sev];
    const ti = TYPE_ICON[n.type] || '\u2753';
    const tl = TYPE_LBL[n.type] || (n.type || 'Unbekannt');
    const grp = n._primaryGroup || '';
    const grpCol = grp ? grpColor(grp) : '#94a3b8';
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
            + 'style="display:inline-block;padding:2px 5px;margin:0 1px;background:#f1f5f9;'
            + 'border:1px solid #e2e8f0;border-radius:3px;text-decoration:none;'
            + 'color:#475569;font-size:11px;line-height:1">' + lbl + '</a>';
    };

    return '<tr data-host-id="' + esc(String(n.id)) + '" '
        + 'style="border-bottom:1px solid #f1f5f9;cursor:pointer;'
        + 'border-left:4px solid ' + sevCol + '">'
        // Status (Pille)
        + '<td style="padding:6px 10px"><span style="display:inline-block;'
            + 'padding:2px 8px;border-radius:10px;background:' + sevCol + '22;'
            + 'color:' + sevCol + ';font-size:11px;font-weight:700">'
            + '\u25CF ' + esc(sevLbl) + '</span></td>'
        // Host (Link zu Latest-Data)
        + '<td style="padding:6px 10px"><a href="' + esc(latestUrl) + '" '
            + 'target="_blank" rel="noopener noreferrer" '
            + 'data-no-detail="1" '
            + 'style="color:#2563eb;text-decoration:none;font-weight:600">'
            + esc(n.label || n.host || '') + '</a></td>'
        // Type
        + '<td style="padding:6px 10px;font-size:12px;color:#475569">'
            + ti + ' ' + esc(tl) + '</td>'
        // Group
        + '<td style="padding:6px 10px"><span style="display:inline-block;'
            + 'padding:1px 7px;border-radius:8px;background:' + grpCol + '22;'
            + 'color:' + grpCol + ';font-size:11px;font-weight:600">'
            + esc(grp || '\u2014') + '</span></td>'
        // IP + Interface-Typ ("192.168.33.10 (SNMP)") — Iftype kommt vom Backend.
        // Tooltip am Iftype-Span zeigt zusätzlich Proxy/Proxy-Group-Info
        // (oder "Server (kein Proxy)" wenn der Host direkt am Zabbix-Server hängt).
        + '<td style="padding:6px 10px;font-size:12px;color:#475569;font-family:monospace">'
            + esc(n.ip || '\u2014')
            + (n.iftype
                ? ' <span title="' + esc(proxyTooltip(n)) + '" '
                    + 'style="color:#94a3b8;font-size:11px;cursor:help;'
                    + 'border-bottom:1px dotted #cbd5e1">(' + esc(n.iftype) + ')</span>'
                : '')
            + '</td>'
        // CPU
        + '<td style="padding:6px 10px;font-size:12px;text-align:right">'
            + fmtPct(n.cpu) + '</td>'
        // Memory
        + '<td style="padding:6px 10px;font-size:12px;text-align:right">'
            + fmtPct(n.memory) + '</td>'
        // Ping
        + '<td style="padding:6px 10px;font-size:12px;text-align:right">'
            + fmtMs(n.ping) + '</td>'
        // Traffic In/Out (zwei Zeilen kompakt)
        + '<td style="padding:6px 10px;font-size:11px;text-align:right;color:#475569;'
            + 'font-family:monospace;line-height:1.3;white-space:nowrap">'
            + '\u2193 ' + trafIn + '<br>\u2191 ' + trafOut
            + '</td>'
        // Probleme
        + '<td style="padding:6px 10px;text-align:right">'
            + (n.problems > 0
                ? '<span style="display:inline-block;padding:1px 8px;border-radius:10px;'
                    + 'background:#dc262622;color:#dc2626;font-size:11px;font-weight:700">'
                    + n.problems + '</span>'
                : '<span style="color:#94a3b8;font-size:12px">0</span>')
            + '</td>'
        // Actions
        + '<td style="padding:6px 6px;text-align:right;white-space:nowrap">'
            + actBtn(latestUrl, '\u{1F4CA}', 'Latest Data')
            + actBtn(probUrl,   '\u26A0',    'Probleme')
            + actBtn(chartsUrl, '\u{1F4C8}', 'Graphs')
            + actBtn(editUrl,   '\u2699\uFE0F', 'Bearbeiten')
            + '</td>'
        + '</tr>';
}

function buildTable(nodes, baseUrl) {
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

    let thead = '<thead style="position:sticky;top:0;background:#f8fafc;z-index:1">'
        + '<tr style="border-bottom:2px solid #e2e8f0">';
    cols.forEach(function(c) {
        const isActive = c.id === _sortCol;
        const arrow = (isActive && !c.noSort) ? (_sortDir === 'desc' ? ' \u25BC' : ' \u25B2') : '';
        const sortAttr = c.noSort ? '' : ' data-sort="' + c.id + '"';
        const cursor = c.noSort ? 'default' : 'pointer';
        thead += '<th' + sortAttr + ' '
            + 'style="padding:8px 10px;text-align:' + c.align + ';font-size:11px;'
            + 'font-weight:700;color:' + (isActive ? '#0f172a' : '#475569') + ';'
            + 'text-transform:uppercase;letter-spacing:0.5px;cursor:' + cursor + ';user-select:none">'
            + esc(c.lbl) + arrow + '</th>';
    });
    thead += '</tr></thead>';

    let tbody = '<tbody>';
    const sorted = nodes.slice().sort(compare);
    let visible = 0;
    sorted.forEach(function(n) {
        if (passesFilter(n)) {
            tbody += rowHtml(n, baseUrl);
            visible++;
        }
    });
    tbody += '</tbody>';

    if (visible === 0) {
        tbody = '<tbody><tr><td colspan="' + cols.length + '" '
            + 'style="padding:30px;text-align:center;color:#94a3b8;font-size:13px">'
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

    if (!nodes.length) {
        wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;'
                       + 'height:100%;color:#999">No hosts found.</div>';
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
        + 'background:#fff;overflow:hidden';
    wrap.appendChild(root);

    const filterBar = buildFilterBar(realNodes, groupNames);
    root.appendChild(filterBar);

    const tableArea = document.createElement('div');
    tableArea.id = 'nt-table-area';
    tableArea.style.cssText = 'flex:1;overflow:auto;background:#fff';
    root.appendChild(tableArea);

    // Detail-Panel-Container (gleicher Style wie in render-tech) — wird bei
    // Klick auf Zeile gefüllt.
    // Idempotent: bei Mode-Toggle (Hosts↔Items) oder Tab-Wechsel würden sonst
    // mehrere <div id="nt-detail-panel"> ans body angehängt. Vorhandenen
    // entfernen, dann frischen anlegen.
    const oldPanel = document.getElementById('nt-detail-panel');
    if (oldPanel) oldPanel.remove();
    const detailPanel = document.createElement('div');
    detailPanel.id = 'nt-detail-panel';
    detailPanel.style.cssText = 'position:fixed;top:170px;right:20px;width:300px;'
        + 'background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px;'
        + 'box-shadow:0 4px 12px rgba(0,0,0,0.08);z-index:200;display:none;'
        + 'max-height:calc(100vh - 200px);overflow-y:auto';
    document.body.appendChild(detailPanel);

    function rerenderTable() {
        const r = buildTable(realNodes, baseUrl);
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

        // Toolbar-Wrapper (Preset+Pattern + Suchfeld)
        const wrapInner = document.createElement('div');
        wrapInner.style.cssText = 'padding:8px 12px;background:#f8fafc;'
            + 'border-bottom:1px solid #e2e8f0';
        tableArea.appendChild(wrapInner);

        const toolbar = buildPivotToolbar(function(pattern) {
            _itemsPattern = pattern;
            try { localStorage.setItem(NT_ITEMS_PATTERN_KEY, pattern); } catch (e) {}
            loadAndRenderItems();
        });
        wrapInner.appendChild(toolbar);
        const patIn = toolbar.querySelector('#nt-items-pattern');
        if (patIn) patIn.value = _itemsPattern;

        // Suchfeld + Counter (zweite Zeile)
        const row2 = document.createElement('div');
        row2.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:6px';
        const searchLbl = document.createElement('span');
        searchLbl.textContent = 'Suche Host:';
        searchLbl.style.cssText = 'font-size:12px;color:#475569;font-weight:600';
        row2.appendChild(searchLbl);

        const searchIn = document.createElement('input');
        searchIn.type = 'text';
        searchIn.id = 'nt-items-hostsearch';
        searchIn.placeholder = 'Hostname filtern...';
        searchIn.value = _itemsSearch;
        searchIn.style.cssText = 'flex:1;max-width:280px;padding:4px 8px;border:1px solid #cbd5e1;'
            + 'border-radius:4px;font-size:12px;background:#fff';
        row2.appendChild(searchIn);

        const counter = document.createElement('span');
        counter.id = 'nt-items-count';
        counter.style.cssText = 'font-size:11px;color:#94a3b8;margin-left:auto';
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
            pivotArea.innerHTML = '<div style="text-align:center;padding:30px;color:#94a3b8">'
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
            renderPivotTable(area, _itemsData, realNodes, sortHostIds, _itemsSortCol, _itemsSortDir);

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
        // Row-Click: Detail-Panel zeigen
        tableArea.querySelectorAll('tr[data-host-id]').forEach(function(tr) {
            tr.addEventListener('mouseenter', function() { this.style.background = '#f8fafc'; });
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
    }

    // Filter-Wire-Up
    filterBar.querySelectorAll('button[data-sev]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const sev = parseInt(this.dataset.sev, 10);
            if (_filterStatuses.has(sev)) _filterStatuses.delete(sev);
            else _filterStatuses.add(sev);
            // Pill-Style updaten
            const active = _filterStatuses.has(sev);
            this.style.borderColor = active ? SEV_COL[sev] : '#cbd5e1';
            this.style.background = active ? SEV_COL[sev] + '22' : '#fff';
            this.style.color = active ? SEV_COL[sev] : '#94a3b8';
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
