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
import { parseQuery, matchQuery, nodeToQueryFields } from './query.js';
import { loadSnapshot, computeDiff, formatSnapshotAge } from './diff-mode.js';
import { loadFilterPresets, saveFilterPresets } from './storage.js';
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
// Mehrfach-Gruppenfilter: alle gesetzten Gruppen werden AND-verknuepft
// (Host muss in ALLEN selektierten Gruppen sein). Leer = keine Einschraenkung.
// Match laeuft ueber n.groups[], nicht n._primaryGroup — ein Host kann in
// mehreren Zabbix-Gruppen sein (z.B. "Kunde X" + "proxy").
let _filterGroups = new Set();
let _filterText = '';
// Vorgeparster Query-AST — wird beim Input-Change aus _filterText gebaut
// (in query.js). passesFilter() ruft matchQuery() statt pro Host neu zu
// parsen. null = kein Filter aktiv.
let _filterQuery = null;

// Built-in Filter-Presets (read-only). User-eigene liegen in localStorage
// via storage.js loadFilterPresets/saveFilterPresets.
// filter-Shape: { sev?: int[], groups?: string[], text?: string,
//                 offline?: bool, sort?: string, sortDir?: 'asc'|'desc' }
// undefined-Felder fallen auf Defaults zurueck wenn das Preset angewendet wird.
const BUILTIN_FILTER_PRESETS = [
    { name: 'Alle',          builtin: true, filter: {} },
    { name: 'Nur Firewalls', builtin: true, filter: { text: 'type:firewall' }},
    { name: 'Nur Server',    builtin: true, filter: { text: 'type:server'   }},
    { name: 'Nur Switches',  builtin: true, filter: { text: 'type:switch'   }},
    { name: 'Nur Storage',   builtin: true, filter: { text: 'type:storage'  }},
    { name: 'Nur Offline',   builtin: true, filter: { offline: true }},
    { name: 'Disaster',      builtin: true, filter: { sev: [5] }},
    { name: 'Crit + High',   builtin: true, filter: { sev: [4, 5] }},
];

// Wrap/nodes/edges-Refs damit die Preset-Anwendung den vollen renderTable
// triggern kann (Filter-Bar wird neu gebaut). Werden bei jedem renderTable
// gesetzt.
let _renderWrap = null;
let _renderNodes = null;
let _renderEdges = null;

// Setzt alle Filter-Felder gemaess Preset.filter und triggert vollen Re-Render.
// Fehlt ein Feld im Preset → Default-Wert (alle Sev an, keine Gruppen, kein Text,
// nicht offline-only, Sortierung severity desc).
function _applyFilterPreset(preset) {
    const f = (preset && preset.filter) || {};
    _filterStatuses    = new Set(Array.isArray(f.sev) ? f.sev : [0,1,2,3,4,5]);
    _filterGroups      = new Set(Array.isArray(f.groups) ? f.groups : []);
    _filterText        = typeof f.text === 'string' ? f.text : '';
    _reparseTokens();
    _filterOfflineOnly = !!f.offline;
    _sortCol           = typeof f.sort === 'string' ? f.sort : 'severity';
    _sortDir           = (f.sortDir === 'asc' || f.sortDir === 'desc') ? f.sortDir : 'desc';
    if (_renderWrap && _renderNodes) renderTable(_renderWrap, _renderNodes, _renderEdges || []);
}

// Sammelt den aktuellen Filter-State als Preset-filter-Objekt.
function _currentFilterState() {
    const f = {};
    const sev = Array.from(_filterStatuses).sort();
    if (sev.length !== 6) f.sev = sev;                         // nur wenn nicht alle 6
    if (_filterGroups.size > 0) f.groups = Array.from(_filterGroups).sort();
    if (_filterText) f.text = _filterText;
    if (_filterOfflineOnly) f.offline = true;
    if (_sortCol && _sortCol !== 'severity') f.sort = _sortCol;
    if (_sortDir && _sortDir !== 'desc') f.sortDir = _sortDir;
    return f;
}

// Baut den Inhalt des Preset-Dropdowns neu auf — getrennt nach Built-ins
// und User-eigenen, plus "Aktuelle speichern" am Ende.
function _rebuildPresetPop(pop, theme) {
    pop.innerHTML = '';
    function row(label, color, onClick) {
        const r = document.createElement('div');
        r.style.cssText = 'padding:5px 10px;cursor:pointer;font-size:12px;color:'
            + (color || theme.text) + ';border-radius:3px;display:flex;align-items:center;gap:8px';
        r.innerHTML = label;
        r.addEventListener('mouseenter', function() { r.style.background = theme.head; });
        r.addEventListener('mouseleave', function() { r.style.background = ''; });
        r.addEventListener('click', function(e) { e.stopPropagation(); pop.style.display = 'none'; onClick(); });
        return r;
    }
    function header(text) {
        const h = document.createElement('div');
        h.textContent = text;
        h.style.cssText = 'padding:6px 10px 2px;font-size:10px;color:' + theme.sub
            + ';text-transform:uppercase;letter-spacing:0.05em;font-weight:700';
        return h;
    }
    pop.appendChild(header('Standard'));
    BUILTIN_FILTER_PRESETS.forEach(function(p) {
        pop.appendChild(row(esc(p.name), theme.text, function() { _applyFilterPreset(p); }));
    });
    const user = loadFilterPresets();
    if (user.length > 0) {
        pop.appendChild(header('Eigene'));
        user.forEach(function(p) {
            const r = document.createElement('div');
            r.style.cssText = 'padding:5px 10px;cursor:pointer;font-size:12px;color:' + theme.text
                + ';border-radius:3px;display:flex;align-items:center;gap:8px';
            r.innerHTML = '<span style="flex:1">' + esc(p.name) + '</span>'
                + '<span data-del="1" title="Loeschen" style="color:' + theme.subSoft
                + ';padding:0 4px;cursor:pointer">×</span>';
            r.addEventListener('mouseenter', function() { r.style.background = theme.head; });
            r.addEventListener('mouseleave', function() { r.style.background = ''; });
            r.addEventListener('click', function(e) {
                e.stopPropagation();
                if (e.target.dataset && e.target.dataset.del) {
                    if (!confirm('Preset "' + p.name + '" loeschen?')) return;
                    const arr = loadFilterPresets().filter(function(x) { return x.name !== p.name; });
                    saveFilterPresets(arr);
                    _rebuildPresetPop(pop, theme);
                    return;
                }
                pop.style.display = 'none';
                _applyFilterPreset(p);
            });
            pop.appendChild(r);
        });
    }
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:' + theme.borderSoft + ';margin:4px 0';
    pop.appendChild(sep);
    pop.appendChild(row('+ Aktuelle als Preset speichern…', theme.accent, function() {
        const name = prompt('Name des Presets:');
        if (!name || !name.trim()) return;
        const arr = loadFilterPresets().filter(function(x) { return x.name !== name.trim(); });
        arr.push({ name: name.trim(), filter: _currentFilterState() });
        saveFilterPresets(arr);
    }));
}

// Vorberechneter Diff-State (siehe diff-mode.js). Wird beim rerenderTable
// aus dem aktuellen Snapshot + den aktuellen realNodes erzeugt. Pro Host-Row
// schlagen wir nach ob er als "neu/up/down" markiert werden muss.
let _diff = null;
let _filterOfflineOnly = false;  // Toggle "nur Offline-Hosts zeigen"
let _sortCol = 'severity';
let _sortDir = 'desc';

// Mode: 'hosts' = Standard-Tabelle, 'items' = Pivot-Tabelle
let _tableMode = 'hosts';
// Letztes verwendetes Pattern für die Items-Pivot (über Mode-Wechsel persistent)
let _itemsPattern = 'vfs.fs.size[*,pused]';
let _itemsData = null;
// Items-Modus-spezifische Filter/Sortierung (analog Hosts-Modus aber für Pivot)
let _itemsSearch = '';     // Hostname-Filter (Query-Syntax wie Hosts-Modus)
let _itemsQuery  = null;   // vorgeparster AST aus _itemsSearch
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

// URL-Bookmark: Filter/Sort/Mode in der URL persistieren, sodass die aktuelle
// Tabellen-Sicht teilbar ist (z.B. Slack-Link mit vorgefiltertem Kunden).
// Prefix "t_" damit andere Tabs (Tech/Geo) ihre URL-Params spaeter ohne
// Kollision dazupacken koennen. URL-Sync laeuft bei jedem renderTable()/
// rerenderTable() — passive Updates ueber history.replaceState() ohne neuen
// Browser-History-Eintrag.
//
// Format:
//   t_sev=0,1,3       — aktive Severities (omit wenn alle 0..5)
//   t_g=Kunde,proxy   — selektierte Gruppen (omit wenn leer)
//   t_q=router -mt    — Such-Tokens (omit wenn leer)
//   t_off=1           — "nur Offline" (omit wenn aus)
//   t_sort=cpu        — Sort-Spalte (omit wenn default "severity")
//   t_sdir=asc        — Sort-Richtung (omit wenn default "desc")
//   t_mode=items      — Tabellen-Modus (omit wenn default "hosts")
const URL_KEYS = {
    sev: 't_sev', group: 't_g', q: 't_q', off: 't_off',
    sort: 't_sort', sdir: 't_sdir', mode: 't_mode',
};

function _urlSync() {
    if (typeof window === 'undefined' || !window.history) return;
    const p = new URLSearchParams(window.location.search);
    // Severities: nur schreiben wenn nicht vollstaendig (=Default)
    if (_filterStatuses.size > 0 && _filterStatuses.size < 6) {
        p.set(URL_KEYS.sev, Array.from(_filterStatuses).sort().join(','));
    } else {
        p.delete(URL_KEYS.sev);
    }
    if (_filterGroups.size > 0) {
        p.set(URL_KEYS.group, Array.from(_filterGroups).sort().join(','));
    } else {
        p.delete(URL_KEYS.group);
    }
    if (_filterText) p.set(URL_KEYS.q, _filterText); else p.delete(URL_KEYS.q);
    if (_filterOfflineOnly) p.set(URL_KEYS.off, '1'); else p.delete(URL_KEYS.off);
    if (_sortCol && _sortCol !== 'severity') p.set(URL_KEYS.sort, _sortCol); else p.delete(URL_KEYS.sort);
    if (_sortDir && _sortDir !== 'desc') p.set(URL_KEYS.sdir, _sortDir); else p.delete(URL_KEYS.sdir);
    if (_tableMode === 'items') p.set(URL_KEYS.mode, 'items'); else p.delete(URL_KEYS.mode);
    const q = p.toString();
    const newUrl = window.location.pathname + (q ? '?' + q : '') + window.location.hash;
    if (newUrl !== window.location.pathname + window.location.search + window.location.hash) {
        window.history.replaceState(null, '', newUrl);
    }
}

function _urlRestore() {
    if (typeof window === 'undefined' || !window.location) return;
    const p = new URLSearchParams(window.location.search);
    const sev = p.get(URL_KEYS.sev);
    if (sev !== null) {
        _filterStatuses = new Set();
        sev.split(',').forEach(function(s) {
            const n = parseInt(s, 10);
            if (n >= 0 && n <= 5) _filterStatuses.add(n);
        });
        // Edge-Case: leerer/ungueltiger Param → Default wiederherstellen
        if (_filterStatuses.size === 0) _filterStatuses = new Set([0, 1, 2, 3, 4, 5]);
    }
    const grp = p.get(URL_KEYS.group);
    if (grp) grp.split(',').forEach(function(g) { if (g) _filterGroups.add(g); });
    const q = p.get(URL_KEYS.q);
    if (q) { _filterText = q; _reparseTokens(); }
    if (p.get(URL_KEYS.off) === '1') _filterOfflineOnly = true;
    const sc = p.get(URL_KEYS.sort);
    if (sc) _sortCol = sc;
    const sd = p.get(URL_KEYS.sdir);
    if (sd === 'asc' || sd === 'desc') _sortDir = sd;
    const md = p.get(URL_KEYS.mode);
    if (md === 'items') _tableMode = 'items';
}

// URL-Params einmalig beim Modul-Init lesen — laeuft VOR dem ersten
// renderTable(), damit der initiale Render schon den richtigen Filter hat.
_urlRestore();

// Theme — Zabbix-native Farb-Palette. Light-Mode matcht Zabbix' .list-table
// Defaults (helle BG, dunkler Text, Blau-Accent #0275b8). Dark-Mode bleibt
// vorerst eigenstaendig (Zabbix Dark hat nicht komplett standardisierte Tokens
// fuer Module). border-radius wird im Code generell auf 2-3px reduziert
// damit es flach/Zabbix-konform wirkt — siehe RADIUS-Konstante unten.
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
            link:         '#4f9bdb',
            accent:       '#0275b8',
            inputBg:      '#0d1117',
            actionBg:     '#21262d',
            actionBorder: '#30363d',
            actionText:   '#c9d1d9',
            detailBg:     '#0d1117',
            detailText:   '#e6edf3',
            counterText:  '#8b949e',
            problemBg:    'rgba(229,55,66,0.18)',
            problemText:  '#e57280',
        };
    }
    return {
        bg:           '#ffffff',
        surface:      '#ffffff',
        head:         '#f6fafd',     // Zabbix list-table thead
        hover:        '#eaf6fb',     // Zabbix row hover
        stripe:       '#fbfdfe',
        border:       '#dfe4e7',     // Zabbix table-border
        borderSoft:   '#ebeef0',
        text:         '#1f2c33',     // Zabbix body text
        textStrong:   '#000000',
        sub:          '#768d99',     // Zabbix muted text
        subSoft:      '#a4afb5',
        link:         '#0275b8',     // Zabbix anchor color
        accent:       '#0275b8',     // Zabbix primary blue
        inputBg:      '#ffffff',
        actionBg:     '#f4f6f7',
        actionBorder: '#dfe4e7',
        actionText:   '#1f2c33',
        detailBg:     '#fafbfc',
        detailText:   '#1f2c33',
        counterText:  '#768d99',
        problemBg:    'rgba(229,55,66,0.13)',
        problemText:  '#e53742',     // Zabbix critical red
    };
}

// Border-Radius-Konstanten — Zabbix nutzt flache Ecken, max 2-3px.
const NT_R = {
    sm: '2px',    // Inputs, Buttons
    md: '3px',    // Containers
    pill: '11px', // Status-/Severity-Pills (bleiben rund)
};

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
    // "Nur Offline" laeuft VOR den anderen Filtern: wenn aktiv und Host
    // online ist -> rausfiltern. Severity-Pills werden ignoriert in dem Modus
    // (sonst widerspricht sich's wenn der User bei Offline-Filter alle
    // Severities deaktiviert haette).
    if (_filterOfflineOnly) {
        if (!n.unavailable) return false;
    } else {
        if (!_filterStatuses.has(n.severity || 0)) return false;
    }
    // Mehrfach-Gruppenfilter: Host muss in ALLEN selektierten Gruppen sein
    // (Schnittmenge). Match ueber n.groups[] statt _primaryGroup — Hosts
    // koennen in mehreren Gruppen sein (z.B. Kunde + proxy).
    if (_filterGroups.size > 0) {
        const hostGroups = n.groups || [];
        let allFound = true;
        for (const g of _filterGroups) {
            if (hostGroups.indexOf(g) < 0) { allFound = false; break; }
        }
        if (!allFound) return false;
    }
    // Query-Suche (parser in query.js): AND/OR/NOT mit Field-Prefixen.
    //   "router"                  → match irgendwo
    //   "host:router"             → match nur in host/label
    //   "host:a OR host:b"        → OR
    //   "(host:a OR host:b) type:switch"
    //   "-group:wartung"          → negativ
    if (_filterQuery) {
        if (!matchQuery(_filterQuery, nodeToQueryFields(n))) return false;
    }
    return true;
}

// Re-parst _filterText in einen Query-AST (oder null bei leerer Eingabe).
// Wird vom Suchfeld-Input gerufen damit passesFilter() pro Host nur
// noch matchQuery() laufen muss.
function _reparseTokens() {
    _filterQuery = parseQuery(_filterText);
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
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;'
        + 'background:' + theme.head + ';border-bottom:1px solid ' + theme.border
        + ';flex-wrap:wrap';

    // Mode-Toggle: "Hosts" / "Items" — Zabbix-flach, sharp corners.
    const modeWrap = document.createElement('div');
    modeWrap.style.cssText = 'display:inline-flex;border:1px solid ' + theme.border
        + ';border-radius:' + NT_R.sm + ';overflow:hidden;background:' + theme.surface;
    const mkModeBtn = function(id, lbl) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.mode = id;
        b.textContent = lbl;
        const active = _tableMode === id;
        b.style.cssText = 'padding:3px 12px;border:none;cursor:pointer;font-size:12px;'
            + 'font-weight:600;font-family:inherit;'
            + 'transition:background 0.12s,color 0.12s;'
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
    sevWrap.style.cssText = 'display:flex;gap:4px;align-items:center';
    const sevLabel = document.createElement('span');
    sevLabel.textContent = 'Status:';
    sevLabel.style.cssText = 'font-size:12px;color:' + theme.sub
        + ';font-weight:600;margin-right:2px';
    sevWrap.appendChild(sevLabel);

    [0, 1, 2, 3, 4, 5].forEach(function(sev) {
        const pill = document.createElement('button');
        pill.type = 'button';
        const active = _filterStatuses.has(sev);
        pill.dataset.sev = String(sev);
        pill.textContent = '\u25CF ' + SEV_LBL[sev];
        // Bei aktivem "Nur Offline"-Filter sind die Severity-Pills disabled,
        // damit klar ist dass sie gerade keinen Effekt haben.
        const dimmed = _filterOfflineOnly;
        pill.style.cssText = 'padding:2px 8px;border:1px solid '
            + (active ? SEV_COL[sev] : theme.border)
            + ';background:' + (active ? SEV_COL[sev] + '22' : theme.surface)
            + ';color:' + (active ? SEV_COL[sev] : theme.subSoft)
            + ';border-radius:' + NT_R.pill + ';font-size:11px;font-weight:600;cursor:pointer;'
            + 'transition:all 0.12s;font-family:inherit'
            + (dimmed ? ';opacity:0.4;pointer-events:none' : '');
        sevWrap.appendChild(pill);
    });
    bar.appendChild(sevWrap);

    // "Nur Offline"-Toggle neben den Severity-Pills
    const offBtn = document.createElement('button');
    offBtn.type = 'button';
    offBtn.id = 'nt-table-offline-only';
    offBtn.textContent = '\u25CF Offline';
    offBtn.title = 'Nur unavailable Hosts anzeigen';
    const _setOffStyle = function() {
        const active = _filterOfflineOnly;
        offBtn.style.cssText = 'padding:2px 8px;border:1px solid '
            + (active ? '#e53742' : theme.border)
            + ';background:' + (active ? 'rgba(229,55,66,0.13)' : theme.surface)
            + ';color:' + (active ? '#e53742' : theme.subSoft)
            + ';border-radius:' + NT_R.pill + ';font-size:11px;font-weight:600;'
            + 'cursor:pointer;transition:all 0.12s;font-family:inherit;'
            + 'margin-left:6px';
    };
    _setOffStyle();
    bar.appendChild(offBtn);

    // Hostgroup-Filter — Multi-Select via Chip-Row + Add-Dropdown.
    // AND-Semantik: Host muss in ALLEN selektierten Gruppen sein. Dropdown
    // listet nur Gruppen die noch nicht selektiert sind. Chips haben (×)
    // zum Entfernen.
    if (groupNames.length >= 2) {
        const grpWrap = document.createElement('div');
        grpWrap.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap';

        const grpLabel = document.createElement('span');
        grpLabel.textContent = 'Gruppe:';
        grpLabel.style.cssText = 'font-size:12px;color:' + theme.sub + ';font-weight:600';
        grpWrap.appendChild(grpLabel);

        // Aktive Gruppen als Chips (jeweils mit × zum Entfernen)
        const activeGroups = Array.from(_filterGroups).sort();
        activeGroups.forEach(function(g) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.dataset.removeGroup = g;
            chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;'
                + 'padding:2px 4px 2px 8px;border:1px solid ' + theme.accent
                + ';border-radius:' + NT_R.pill + ';background:' + theme.accent + '22;'
                + 'color:' + theme.accent + ';font-size:11px;font-weight:600;'
                + 'cursor:pointer;font-family:inherit';
            chip.innerHTML = esc(g) + '<span style="font-size:13px;line-height:1;opacity:0.7">×</span>';
            grpWrap.appendChild(chip);
        });

        const grpSel = document.createElement('select');
        grpSel.id = 'nt-table-group';
        grpSel.style.cssText = 'padding:3px 6px;border:1px solid ' + theme.border
            + ';border-radius:' + NT_R.sm + ';font-size:12px;background:' + theme.surface
            + ';color:' + theme.text + ';font-family:inherit;cursor:pointer';
        const optAll = document.createElement('option');
        optAll.value = '';
        const remaining = groupNames.length - _filterGroups.size;
        optAll.textContent = _filterGroups.size > 0
            ? '+ Gruppe (' + remaining + ')'
            : 'Alle (' + groupNames.length + ')';
        grpSel.appendChild(optAll);
        groupNames.forEach(function(g) {
            if (_filterGroups.has(g)) return;   // schon als Chip aktiv
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = g;
            grpSel.appendChild(opt);
        });
        grpWrap.appendChild(grpSel);
        bar.appendChild(grpWrap);
    }

    // Filter-Preset-Dropdown — Built-ins + User-eigene. Klick auf Preset
    // wendet Severities/Gruppen/Text/Offline/Sort an. "Aktuelle speichern"
    // legt ein User-Preset mit dem aktuellen Filter-State an.
    const presetWrap = document.createElement('div');
    presetWrap.id = 'nt-table-preset-wrap';
    presetWrap.style.cssText = 'position:relative;display:inline-block';
    const presetBtn = document.createElement('button');
    presetBtn.type = 'button';
    presetBtn.style.cssText = 'padding:3px 8px;border:1px solid ' + theme.border
        + ';border-radius:' + NT_R.sm + ';font-size:12px;background:' + theme.surface
        + ';color:' + theme.text + ';font-family:inherit;cursor:pointer';
    presetBtn.textContent = 'Preset ▾';
    presetWrap.appendChild(presetBtn);
    const presetPop = document.createElement('div');
    presetPop.id = 'nt-table-preset-pop';
    presetPop.style.cssText = 'display:none;position:absolute;top:100%;left:0;z-index:9000;'
        + 'background:' + theme.surface + ';border:1px solid ' + theme.border
        + ';border-radius:' + NT_R.sm + ';box-shadow:0 6px 20px rgba(0,0,0,0.14);'
        + 'min-width:200px;max-height:340px;overflow:auto;padding:4px;margin-top:4px';
    presetWrap.appendChild(presetPop);
    bar.appendChild(presetWrap);

    presetBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const open = presetPop.style.display === 'block';
        presetPop.style.display = open ? 'none' : 'block';
        if (!open) _rebuildPresetPop(presetPop, theme);
    });
    document.addEventListener('click', function(e) {
        if (!presetWrap.contains(e.target)) presetPop.style.display = 'none';
    });

    // Suche — flach, kein Lupen-Glyph (Zabbix nutzt das nicht), schmaler Focus.
    const search = document.createElement('input');
    search.id = 'nt-table-search';
    search.type = 'text';
    search.placeholder = 'Suche — host:web, type:switch, group:dc1, ...';
    search.title = 'Query-Syntax:\n'
        + '  web                       match in Hostname/Label/IP\n'
        + '  -wartung                  NOT (Wort darf nicht vorkommen)\n'
        + '  host:web                  Hostname/Label\n'
        + '  ip:10.0                   IP-Adresse\n'
        + '  proxy:zbx-px              Proxy-Name (nur per Prefix!)\n'
        + '  group:dc1                 Hostgroup-Name\n'
        + '  type:switch               Geraete-Type\n'
        + '  iftype:snmp               Interface-Type\n'
        + '  "with spaces"             quoted (auch field:"foo bar")\n'
        + '  a OR b                    ODER (uppercase Keyword)\n'
        + '  (a OR b) c                Gruppierung mit Klammern\n'
        + 'Bare Tokens (ohne :) matchen Host/Label/IP — nicht Proxy/Gruppe/Type.\n'
        + 'Mehrere Tokens ohne OR = UND (Standard).';
    search.value = _filterText;
    search.style.cssText = 'padding:3px 8px;border:1px solid ' + theme.border
        + ';border-radius:' + NT_R.sm + ';font-size:12px;width:240px;background:' + theme.inputBg
        + ';color:' + theme.text + ';font-family:inherit;outline:none;'
        + 'transition:border-color 0.12s';
    search.addEventListener('focus', function() {
        this.style.borderColor = theme.accent;
    });
    search.addEventListener('blur', function() {
        this.style.borderColor = theme.border;
    });
    bar.appendChild(search);

    // Counter rechts
    const counter = document.createElement('div');
    counter.id = 'nt-table-count';
    counter.style.cssText = 'margin-left:auto;font-size:12px;color:' + theme.counterText
        + ';font-weight:600;letter-spacing:0.02em';
    bar.appendChild(counter);

    return bar;
}

// Kleines Badge das vor der Severity-Pille einer Diff-relevanten Zeile
// erscheint. + (cyan) fuer neue Hosts, ↑ (rot) fuer schlimmere Severity,
// ↓ (gruen) fuer bessere. Leerstring wenn kein Diff aktiv ist.
function _diffBadgeHtml(id) {
    if (!_diff) return '';
    const sid = String(id);
    const base = 'display:inline-block;width:14px;height:14px;line-height:14px;'
        + 'border-radius:50%;color:#fff;font-size:10px;font-weight:700;'
        + 'text-align:center;margin-right:5px;vertical-align:middle';
    if (_diff.new.has(sid)) {
        return '<span title="Neu seit Snapshot" style="' + base + ';background:#06b6d4">+</span>';
    }
    if (_diff.up.has(sid)) {
        const ch = _diff.sevByHost.get(sid);
        const tt = ch ? ('Severity: ' + ch.old + ' → ' + ch.now) : 'Schlimmer seit Snapshot';
        return '<span title="' + esc(tt) + '" style="' + base + ';background:#dc2626">↑</span>';
    }
    if (_diff.down.has(sid)) {
        const ch = _diff.sevByHost.get(sid);
        const tt = ch ? ('Severity: ' + ch.old + ' → ' + ch.now) : 'Besser seit Snapshot';
        return '<span title="' + esc(tt) + '" style="' + base + ';background:#16a34a">↓</span>';
    }
    return '';
}

function rowHtml(n, baseUrl, theme) {
    const sev = n.severity || 0;
    const sevCol = SEV_COL[sev];
    const sevLbl = SEV_LBL[sev];
    const ti = TYPE_ICON[n.type] || '\u2753';
    const tl = TYPE_LBL[n.type] || (n.type || 'Unbekannt');
    const grp = n._primaryGroup || '';
    const grpCol = grp ? grpColor(grp) : theme.subSoft;
    // Zabbix-tighter Density (war 11x14, Zabbix list-table nutzt ca. 5x8).
    // Mono-Font fuer numerische Spalten + tabular-nums fuer perfekte Alignment.
    const cellPad   = 'padding:5px 8px';
    const cellPadR  = cellPad + ';text-align:right';
    const monoFam   = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
    const monoNum   = 'font-family:' + monoFam + ';font-variant-numeric:tabular-nums';
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
            + 'width:20px;height:20px;margin:0 1px;background:' + theme.actionBg
            + ';border:1px solid ' + theme.actionBorder + ';border-radius:' + NT_R.sm + ';'
            + 'text-decoration:none;color:' + theme.actionText + ';font-size:11px;'
            + 'line-height:1;transition:filter 0.12s">' + lbl + '</a>';
    };

    // Offline/Stale-Detection: Host laut Zabbix unavailable -> OFFLINE-Pille.
    // Sonst: pruefen ob Items > 5min nicht aktualisiert -> STALE-Pille
    // (orange) statt Severity. Beide Faelle dimmen die ganze Zeile.
    const isOff = !!n.unavailable;
    const STALE_S = 300;
    const _nowSec = Math.floor(Date.now() / 1000);
    const _ageSec = (n.last_seen && n.last_seen > 0) ? (_nowSec - n.last_seen) : 0;
    const isStale = !isOff && n.last_seen > 0 && _ageSec > STALE_S;
    const offColor = '#9ca3af';
    const rowOpacity = (isOff || isStale) ? 'opacity:0.55;' : '';
    const sevCellHtml = isOff
        ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;'
            + 'border-radius:' + NT_R.pill + ';background:rgba(229,55,66,0.13);'
            + 'color:#e53742;font-size:11px;font-weight:700">'
            + '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;'
            + 'background:#e53742"></span>OFFLINE</span>'
        : isStale
        ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;'
            + 'border-radius:' + NT_R.pill + ';background:rgba(245,158,11,0.13);'
            + 'color:#92400e;font-size:11px;font-weight:700"'
            + ' title="Letzter Wert vor ' + Math.floor(_ageSec / 60) + 'm">'
            + '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;'
            + 'background:#f59e0b"></span>STALE</span>'
        : '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;'
            + 'border-radius:' + NT_R.pill + ';background:' + sevCol + '22;'
            + 'color:' + sevCol + ';font-size:11px;font-weight:700">'
            + '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;'
            + 'background:' + sevCol + '"></span>' + esc(sevLbl) + '</span>';
    const metricColor = (isOff || isStale) ? offColor : theme.text;

    return '<tr data-host-id="' + esc(String(n.id)) + '" '
        + 'style="border-bottom:1px solid ' + theme.borderSoft + ';cursor:pointer;'
        + 'border-left:3px solid ' + (isOff ? '#9ca3af' : sevCol)
        + ';transition:background 0.12s;' + rowOpacity + '">'
        // Status (Pille mit Punkt + Label oder Offline-Anzeige) + Diff-Badge
        + '<td style="' + cellPad + '">' + _diffBadgeHtml(n.id) + sevCellHtml + '</td>'
        // Host (Link zu Latest-Data)
        + '<td style="' + cellPad + '"><a href="' + esc(latestUrl) + '" '
            + 'target="_blank" rel="noopener noreferrer" '
            + 'data-no-detail="1" '
            + 'style="color:' + theme.link + ';text-decoration:none;font-weight:600;'
            + 'font-size:12px">'
            + esc(n.label || n.host || '') + '</a></td>'
        // Type (Icon + Label)
        + '<td style="' + cellPad + ';font-size:12px;color:' + metricColor + '">'
            + '<span style="margin-right:5px">' + ti + '</span>' + esc(tl) + '</td>'
        // Group (gefaerbte Pille pro Hostgroup)
        + '<td style="' + cellPad + '"><span style="display:inline-block;'
            + 'padding:1px 7px;border-radius:' + NT_R.pill + ';background:' + grpCol + '22;'
            + 'color:' + grpCol + ';font-size:11px;font-weight:600">'
            + esc(grp || '\u2014') + '</span></td>'
        // IP + Interface-Typ ("192.168.33.10 (SNMP)") — Iftype kommt vom Backend.
        // Tooltip am Iftype-Span zeigt zusätzlich Proxy/Proxy-Group-Info
        // (oder "Server (kein Proxy)" wenn der Host direkt am Zabbix-Server hängt).
        + '<td style="' + cellPad + ';font-size:12px;color:' + metricColor
        + ';' + monoNum + '">'
            + esc(n.ip || '\u2014')
            + (n.iftype
                ? ' <span title="' + esc(proxyTooltip(n)) + '" '
                    + 'style="color:' + theme.subSoft + ';font-size:11px;cursor:help;'
                    + 'border-bottom:1px dotted ' + theme.border + '">(' + esc(n.iftype) + ')</span>'
                : '')
            + '</td>'
        // CPU / Memory / Ping - bei Offline werden die Werte gedimmt dargestellt
        + '<td style="' + cellPadR + ';font-size:12px;color:' + metricColor
            + ';' + monoNum + '">' + fmtPct(n.cpu) + '</td>'
        + '<td style="' + cellPadR + ';font-size:12px;color:' + metricColor
            + ';' + monoNum + '">' + fmtPct(n.memory) + '</td>'
        + '<td style="' + cellPadR + ';font-size:12px;color:' + metricColor
            + ';' + monoNum + '">' + fmtMs(n.ping) + '</td>'
        // Traffic In/Out
        + '<td style="' + cellPadR + ';font-size:11px;color:' + metricColor
            + ';' + monoNum + ';line-height:1.4;white-space:nowrap">'
            + '\u2193 ' + trafIn + '<br>\u2191 ' + trafOut
            + '</td>'
        // Probleme — clickable Toggle wenn Count>0
        + '<td style="' + cellPadR + '">'
            + (n.problems > 0
                ? '<button type="button" data-toggle-problems="' + esc(String(n.id)) + '" '
                    + 'data-no-detail="1" '
                    + 'title="Probleme aufklappen" '
                    + 'style="display:inline-flex;align-items:center;gap:3px;padding:1px 8px;'
                    + 'border:none;border-radius:' + NT_R.pill + ';background:' + theme.problemBg
                    + ';color:' + theme.problemText + ';font-size:11px;font-weight:700;'
                    + 'cursor:pointer;font-family:inherit;transition:filter 0.12s">'
                    + '<span class="nt-prob-arrow" style="font-size:9px;display:inline-block;'
                    +     'transition:transform 0.15s;line-height:1">▶</span>'
                    + n.problems + '</button>'
                : '<span style="color:' + theme.subSoft + ';font-size:12px">0</span>')
            + '</td>'
        // Actions \u2014 Edit nur fuer Admins (NT_CONFIG.can_edit). Zabbix
        // prueft serverseitig nochmal, aber die UI soll keinen Button
        // anzeigen der auf "Forbidden" landet.
        + '<td style="padding:5px;text-align:right;white-space:nowrap">'
            + actBtn(latestUrl, '\u{1F4CA}', 'Latest Data')
            + actBtn(probUrl,   '\u26A0',    'Probleme')
            + actBtn(chartsUrl, '\u{1F4C8}', 'Graphs')
            + (window.NT_CONFIG && window.NT_CONFIG.can_edit
                ? actBtn(editUrl, '\u2699\uFE0F', 'Bearbeiten')
                : '')
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
            + 'style="padding:6px 8px;text-align:' + c.align + ';font-size:11px;'
            + 'font-weight:700;color:' + (isActive ? theme.textStrong : theme.sub) + ';'
            + 'text-transform:uppercase;letter-spacing:0.04em;cursor:' + cursor
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
    // Refs fuer _applyFilterPreset() merken — der ruft renderTable() neu mit
    // gleichen Args nach Preset-Anwendung.
    _renderWrap = wrap; _renderNodes = nodes; _renderEdges = edges;
    _urlSync();

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
    // _primaryGroup setzen (analog render-tech) — wird fuer Filter und Spalte
    // genutzt. WICHTIG: pro Render neu berechnen statt nur wenn !_primaryGroup,
    // sonst bleibt der Wert stale wenn der User die Hostgroup-Auswahl
    // wechselt (gleiche Node-Objekte werden mit unveraenderten _primaryGroup
    // zurueckgegeben → Filter passt nicht zur neuen Auswahl).
    const cfg = window.NT_CONFIG;
    const sel = (cfg && cfg.selected_group_names) || [];
    realNodes.forEach(function(n) {
        const gs = n.groups || [];
        let primary = '';
        for (let i = 0; i < sel.length; i++) {
            if (gs.indexOf(sel[i]) >= 0) { primary = sel[i]; break; }
        }
        n._primaryGroup = primary || gs[0] || '';
    });

    // Alle Gruppen einsammeln in denen mind. 1 Host Mitglied ist (nicht nur
    // _primaryGroup). Damit listet der Filter-Dropdown alle Gruppen die
    // ueberhaupt vergeben sind — sonst findet man "proxy" nicht, wenn fuer
    // alle Hosts dort die Kunden-Gruppe primary ist.
    const groupNames = [];
    const _groupSeen = {};
    realNodes.forEach(function(n) {
        (n.groups || []).forEach(function(g) {
            if (g && !_groupSeen[g]) { _groupSeen[g] = true; groupNames.push(g); }
        });
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
        _urlSync();
        // Diff-State einmal pro Render berechnen (statt pro Row)
        const snap = loadSnapshot();
        _diff = snap ? computeDiff(realNodes, snap) : null;

        const r = buildTable(realNodes, baseUrl, theme);
        tableArea.innerHTML = r.html;
        const counter = document.getElementById('nt-table-count');
        if (counter) {
            let txt = r.visible === r.total
                ? r.total + ' Hosts'
                : r.visible + ' / ' + r.total + ' Hosts';
            if (_diff) {
                const parts = [];
                if (_diff.new.size)  parts.push('<span style="color:#06b6d4;font-weight:700">+' + _diff.new.size + '</span>');
                if (_diff.gone.size) parts.push('<span style="color:#94a3b8;font-weight:700">−' + _diff.gone.size + '</span>');
                if (_diff.up.size)   parts.push('<span style="color:#dc2626;font-weight:700">↑' + _diff.up.size + '</span>');
                if (_diff.down.size) parts.push('<span style="color:#16a34a;font-weight:700">↓' + _diff.down.size + '</span>');
                const diffTxt = parts.length
                    ? ' · seit ' + formatSnapshotAge(snap) + ': ' + parts.join(' ')
                    : ' · seit ' + formatSnapshotAge(snap) + ': keine Aenderung';
                counter.innerHTML = esc(txt) + '<span style="color:#94a3b8">' + diffTxt + '</span>';
            } else {
                counter.textContent = txt;
            }
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
        searchIn.placeholder = 'Hosts filtern — host:web, group:dc1, ...';
        searchIn.title = 'Gleiche Query-Syntax wie Hosts-Modus:\n'
            + '  web                    match in Host/Label/IP\n'
            + '  -wartung               NOT\n'
            + '  host:web / ip:10.0 / proxy:zbx-px / group:dc1 / type:switch\n'
            + '  a OR b / (a OR b) c    OR + Klammern\n'
            + '  "with spaces"          quoted';
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

        // CSV-Export der aktuellen Pivot-Sicht (Hosts + Item-Spalten + Aggregate).
        // Nutzt _itemsData + die aktuelle Filter/Sort-Kombination — genau das
        // was der User gerade sieht landet in der Datei.
        const csvBtn = document.createElement('button');
        csvBtn.type = 'button';
        csvBtn.id = 'nt-items-csv';
        csvBtn.textContent = '⬇ CSV';
        csvBtn.title = 'Aktuelle Pivot-Sicht als CSV downloaden';
        csvBtn.style.cssText = 'padding:5px 10px;border:1px solid ' + theme.border
            + ';border-radius:6px;background:' + theme.surface + ';color:' + theme.sub
            + ';font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;'
            + 'letter-spacing:0.02em;transition:all 0.15s';
        csvBtn.addEventListener('click', function() {
            _exportPivotCsv();
        });
        row2.appendChild(csvBtn);

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
                _itemsQuery  = parseQuery(_itemsSearch);
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

            // Hostids nach Query filtern. realNodes-Lookup pro hostid um die
            // gleichen Felder wie im Hosts-Modus zu unterstuetzen (group, proxy,
            // type, ip, ...). Fallback fuer Hosts die nicht in realNodes
            // auftauchen: nur Hostname matchen.
            const allIds = Object.keys(_itemsData.hosts || {});
            let visibleIds = allIds;
            if (_itemsQuery) {
                const byId = {};
                realNodes.forEach(function(n) { byId[String(n.id)] = n; });
                visibleIds = allIds.filter(function(hid) {
                    const n = byId[String(hid)];
                    if (n) return matchQuery(_itemsQuery, nodeToQueryFields(n));
                    const hn = (_itemsData.hosts[hid] || '').toLowerCase();
                    return matchQuery(_itemsQuery, { _any: hn, host: hn, label: hn });
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

        // CSV-Export: baut aus _itemsData eine CSV-Datei mit denselben
        // Zeilen/Spalten die der User gerade sieht (Hostname-Filter, Sort,
        // Hide-Empty werden respektiert). Includes Header + Footer (P50/P95/
        // P99 etc.) — audit-friendly.
        function _exportPivotCsv() {
            if (!_itemsData || !_itemsData.columns) return;
            const cols = _itemsData.columns;
            const allIds = Object.keys(_itemsData.hosts || {});
            let visibleIds = allIds;
            if (_itemsQuery) {
                const byId = {};
                realNodes.forEach(function(n) { byId[String(n.id)] = n; });
                visibleIds = allIds.filter(function(hid) {
                    const n = byId[String(hid)];
                    if (n) return matchQuery(_itemsQuery, nodeToQueryFields(n));
                    const hn = (_itemsData.hosts[hid] || '').toLowerCase();
                    return matchQuery(_itemsQuery, { _any: hn, host: hn, label: hn });
                });
            }
            const sortedIds = sortPivotHostIds(_itemsData, visibleIds);

            function esc(s) {
                s = String(s == null ? '' : s);
                // CSV-Formel-Injection neutralisieren: Zellen die mit = + - @
                // oder Tab/CR beginnen wuerde Excel/LibreOffice als Formel
                // ausfuehren ("=cmd|..." im Host-Visiblename). Fuehrendes '
                // macht sie zu Text. Reine Zahlen (auch negative wie -12.5
                // von Temperatur-Items) bleiben unangetastet.
                if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
                // RFC 4180 Escaping: doublequote quotes, wrap if contains comma/quote/newline
                if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
                return s;
            }
            function fmt(v, unit) {
                if (v == null || !isFinite(v)) return '';
                // Numerisch mit Punkt als Dezimaltrenner (CSV-Standard, macht
                // Excel keine Sorge auch wenn Locale-Import es evtl. anders will).
                let n = Number(v);
                if (Number.isInteger(n)) return String(n);
                if (Math.abs(n) >= 100) return n.toFixed(1);
                return n.toFixed(3);
            }

            // Header-Zeile
            const header = ['Host'].concat(cols.map(function(c) {
                return (c.label || c.key) + (c.unit ? ' (' + c.unit + ')' : '');
            })).concat(['Avg']);
            const lines = [header.map(esc).join(',')];

            // Body: pro Host eine Zeile
            const aggregateLocal = function(values, mode) {
                const nums = values.filter(function(x) {
                    return typeof x === 'number' && isFinite(x);
                });
                if (!nums.length) return null;
                if (mode === 'sum') return nums.reduce(function(a, b) { return a + b; }, 0);
                if (mode === 'max') return Math.max.apply(null, nums);
                if (mode === 'min') return Math.min.apply(null, nums);
                if (mode === 'p50' || mode === 'p95' || mode === 'p99') {
                    const sorted = nums.slice().sort(function(a, b) { return a - b; });
                    const pct = mode === 'p50' ? 0.5 : mode === 'p95' ? 0.95 : 0.99;
                    const idx = pct * (sorted.length - 1);
                    const lo = Math.floor(idx), hi = Math.ceil(idx);
                    if (lo === hi) return sorted[lo];
                    const w = idx - lo;
                    return sorted[lo] * (1 - w) + sorted[hi] * w;
                }
                return nums.reduce(function(a, b) { return a + b; }, 0) / nums.length;
            };

            sortedIds.forEach(function(hid) {
                const row = _itemsData.rows[hid] || {};
                const rowVals = [];
                const cells = cols.map(function(c) {
                    const v = row[c.key];
                    if (v != null) rowVals.push(v);
                    return fmt(v);
                });
                const avg = aggregateLocal(rowVals, 'avg');
                const csvRow = [_itemsData.hosts[hid] || hid].concat(cells).concat([fmt(avg)]);
                lines.push(csvRow.map(esc).join(','));
            });

            // Footer: Sum / Avg / P50 / P95 / P99 / Max
            ['Sum', 'Avg', 'P50', 'P95', 'P99', 'Max'].forEach(function(lbl) {
                const mode = lbl.toLowerCase();
                const cells = cols.map(function(c) {
                    const colVals = sortedIds.map(function(hid) {
                        return _itemsData.rows[hid] && _itemsData.rows[hid][c.key];
                    });
                    return fmt(aggregateLocal(colVals, mode));
                });
                const flat = [];
                sortedIds.forEach(function(hid) {
                    cols.forEach(function(c) {
                        const v = _itemsData.rows[hid] && _itemsData.rows[hid][c.key];
                        if (v != null) flat.push(v);
                    });
                });
                lines.push([lbl].concat(cells).concat([fmt(aggregateLocal(flat, mode))]).map(esc).join(','));
            });

            const csv = lines.join('\n') + '\n';
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url;
            a.download = 'nt-pivot-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
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
    // "Nur Offline"-Toggle: schaltet den Offline-Filter und triggert Re-Render
    // der ganzen Filter-Bar (damit die Severity-Pills disabled werden).
    const offBtnRef = document.getElementById('nt-table-offline-only');
    if (offBtnRef) {
        offBtnRef.addEventListener('click', function() {
            _filterOfflineOnly = !_filterOfflineOnly;
            // Komplettes Filter-Bar-Rebuild damit die Pill-Disabled-Optik
            // sich aktualisiert. Tabelle wird im rerenderTable() automatisch
            // neu gefilter.
            renderTable(wrap, nodes, edges);
        });
    }
    // Multi-Group: Add-Dropdown fuegt ausgewaehlte Gruppe zu _filterGroups,
    // dann komplettes Filter-Bar-Rebuild (Chip einblenden + Dropdown ohne
    // diese Gruppe). Chips reagieren ueber Delegation auf data-remove-group.
    const grpSel = document.getElementById('nt-table-group');
    if (grpSel) {
        grpSel.addEventListener('change', function() {
            if (!this.value) return;
            _filterGroups.add(this.value);
            renderTable(wrap, nodes, edges);
        });
    }
    filterBar.querySelectorAll('button[data-remove-group]').forEach(function(chip) {
        chip.addEventListener('click', function() {
            _filterGroups.delete(this.dataset.removeGroup);
            renderTable(wrap, nodes, edges);
        });
    });
    const search = document.getElementById('nt-table-search');
    if (search) {
        let _searchTimer = null;
        search.addEventListener('input', function() {
            const v = this.value;
            if (_searchTimer) clearTimeout(_searchTimer);
            _searchTimer = setTimeout(function() {
                _filterText = v;
                _reparseTokens();
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
