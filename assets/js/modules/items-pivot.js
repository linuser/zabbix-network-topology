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

// ── Sparkline-Cache + Lazyfetch fuer die Pivot-Zellen ─────────────────────
// Cache lebt fuer die Session — TTL 60s. Vermeidet dass ein Auto-Refresh
// dieselben itemids erneut fetcht.
const _sparkPivotCache = new Map();   // itemid → { data: number[], ts: ms }
const _SPARK_TTL_MS = 60000;

// Sammelt itemids aus allen visible Cells und macht einen Batch-Request.
// Danach werden die SVG-Placeholders befuellt.
function _fetchAndRenderSparklines(container, baseUrl, theme) {
    if (!container) return;
    const slots = container.querySelectorAll('.nt-pivot-spark[data-itemid]');
    if (!slots.length) return;
    const wanted = [];
    const now = Date.now();
    const cachedByItem = {};
    slots.forEach(function(el) {
        const iid = el.dataset.itemid;
        if (!iid) return;
        const cached = _sparkPivotCache.get(iid);
        if (cached && (now - cached.ts) < _SPARK_TTL_MS) {
            cachedByItem[iid] = cached.data;
        } else {
            if (wanted.indexOf(iid) < 0) wanted.push(iid);
        }
    });
    // Cached direkt rendern
    Object.keys(cachedByItem).forEach(function(iid) {
        _renderSparklineIntoSlots(container, iid, cachedByItem[iid], theme);
    });
    if (!wanted.length) return;

    // Batch-Fetch (bis zu 500 itemids per Backend-Cap)
    const chunks = [];
    for (let i = 0; i < wanted.length; i += 500) chunks.push(wanted.slice(i, i + 500));
    chunks.forEach(function(chunk) {
        const params = new URLSearchParams();
        params.append('action', 'network.topology.v6.item_history');
        chunk.forEach(function(iid) { params.append('itemids[]', iid); });
        const url = baseUrl + 'zabbix.php?' + params.toString();
        fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
            .then(function(r) { return r.json(); })
            .then(function(byIid) {
                if (!byIid || byIid.error) return;
                Object.keys(byIid).forEach(function(iid) {
                    const arr = byIid[iid] || [];
                    _sparkPivotCache.set(iid, { data: arr, ts: Date.now() });
                    _renderSparklineIntoSlots(container, iid, arr, theme);
                });
            })
            .catch(function() { /* silent — Sparklines sind Nice-to-have */ });
    });
}

function _renderSparklineIntoSlots(container, itemid, values, theme) {
    // CSS-Selector-Escape fuer itemid (Zahlen sind safe, aber defensiv)
    const slots = container.querySelectorAll('.nt-pivot-spark[data-itemid="' + itemid + '"]');
    if (!slots.length) return;
    const svg = _buildSparklineSvg(values, theme);
    slots.forEach(function(el) { el.innerHTML = svg; });
}

function _buildSparklineSvg(values, theme) {
    if (!values || values.length < 2) return '';
    const W = 56, H = 14, PAD = 1;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < values.length; i++) {
        if (!isFinite(values[i])) continue;
        if (values[i] < mn) mn = values[i];
        if (values[i] > mx) mx = values[i];
    }
    if (!isFinite(mn) || !isFinite(mx)) return '';
    const range = mx - mn || 1;
    const step = (W - PAD * 2) / Math.max(1, values.length - 1);
    const pts = values.map(function(v, i) {
        const x = PAD + i * step;
        const y = PAD + (H - PAD * 2) * (1 - (v - mn) / range);
        return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    // Farbe nach Trend: letzte 3 Punkte steigend → rot, fallend → gruen, sonst blau
    const col = (function() {
        const n = values.length;
        if (n < 3) return theme && theme.link ? theme.link : '#3b82f6';
        const a = values[n - 3], b = values[n - 1];
        if (b > a * 1.05) return '#dc2626';   // stark steigend
        if (b < a * 0.95) return '#16a34a';   // stark fallend
        return theme && theme.link ? theme.link : '#3b82f6';
    })();
    return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H
        + '" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">'
        + '<polyline points="' + pts + '" fill="none" stroke="' + col
        + '" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

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
        const resp = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
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

// Discovery-Cache: Map<groupids-key, Promise<patterns[]>>. Ein Refresh pro
// Group-Auswahl, geteilt zwischen mehreren Aufrufern (vermeidet Doppel-Fetch).
const _discoverCache = new Map();

// Holt die distinct Item-Pattern-Stems der ausgewaehlten Hostgroups vom
// Backend. Cached pro Group-Auswahl, sodass das Dropdown beim Reopen nicht
// jedesmal neu fetchen muss. Returns Promise<{patterns: [...]}|{error: ...}>.
export function fetchPatternSuggestions() {
    const cfg = window.NT_CONFIG;
    const groupids = (cfg && cfg.selected_groupids) || [];
    if (!groupids.length) return Promise.resolve({ patterns: [] });

    const cacheKey = groupids.slice().sort().join(',');
    if (_discoverCache.has(cacheKey)) return _discoverCache.get(cacheKey);

    const params = new URLSearchParams();
    params.append('action', 'network.topology.v6.discover_patterns');
    groupids.forEach(function(g) { params.append('groupids[]', String(g)); });
    const url = buildBaseUrl() + 'zabbix.php?' + params.toString();

    const promise = fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.error) {
                // Error-Response NICHT cachen — naechster Aufruf soll retry
                // koennen (transienter Backend-Fehler waere sonst permanent
                // bis zum Page-Reload).
                _discoverCache.delete(cacheKey);
                return { error: data.error, patterns: [] };
            }
            return {
                patterns: data.patterns || [],
                truncated: !!data.truncated,
                cached: !!data.cached    // Backend setzt true bei APCu-Hit
            };
        })
        .catch(function(e) {
            _discoverCache.delete(cacheKey);
            return { error: e.message, patterns: [] };
        });
    _discoverCache.set(cacheKey, promise);
    return promise;
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

    // Custom durchsuchbarer Combo statt nativem <select>: native selects
    // sind nicht filterbar \u2014 mit vielen Discovery-Patterns wird die Liste
    // unhandlich. Combo = Trigger-Button + Popup mit Filter-Input + scroll-
    // barer Liste mit Section-Headern.
    const combo = document.createElement('div');
    combo.id = 'nt-items-preset';
    combo.style.cssText = 'position:relative;display:inline-block';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.style.cssText = 'padding:3px 24px 3px 8px;border:1px solid ' + t.border
        + ';border-radius:2px;font-size:12px;background:' + t.surface
        + ';color:' + t.text + ';font-family:inherit;cursor:pointer;'
        + 'min-width:200px;text-align:left;position:relative';
    // Trigger-Label als TextNode damit wir es spaeter ueber firstChild.nodeValue
    // austauschen koennen ohne den Caret-Span zu ueberschreiben.
    trigger.appendChild(document.createTextNode(PRESETS[0].lbl));
    const caret = document.createElement('span');
    caret.textContent = '\u25be';   // small down-triangle
    caret.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);'
        + 'font-size:9px;opacity:0.6;pointer-events:none';
    trigger.appendChild(caret);
    combo.appendChild(trigger);

    const popup = document.createElement('div');
    popup.style.cssText = 'display:none;position:absolute;top:100%;left:0;z-index:1000;'
        + 'margin-top:2px;min-width:280px;max-width:480px;background:' + t.surface
        + ';border:1px solid ' + t.border + ';border-radius:2px;'
        + 'box-shadow:0 2px 8px rgba(0,0,0,0.10);overflow:hidden';
    const filterIn = document.createElement('input');
    filterIn.type = 'text';
    filterIn.placeholder = 'Suchen...';
    filterIn.style.cssText = 'width:100%;box-sizing:border-box;padding:5px 10px;'
        + 'border:none;border-bottom:1px solid ' + t.borderSoft + ';outline:none;'
        + 'font-size:12px;background:' + t.head + ';color:' + t.text
        + ';font-family:inherit';
    popup.appendChild(filterIn);
    const listBox = document.createElement('div');
    listBox.style.cssText = 'max-height:340px;overflow-y:auto;padding:2px 0';
    popup.appendChild(listBox);
    combo.appendChild(popup);
    wrap.appendChild(combo);

    // Discovery-State; rebuildItemsList triggert Popup-Inhalt neu.
    const _disc = { loading: true, patterns: [], error: null, truncated: false };
    let _items = [];

    // Pruefe ob ein Preset-Pattern (mit '*'-Wildcards) gegen einen Stem passt.
    // Discovery liefert exakte Stems wie "vfs.fs.size[*,pused]". Preset-Pattern
    // sind aehnlich, koennen aber "system.cpu.util*" sein (trailing wildcard).
    // Wir wandeln das Pattern in eine Regex (alle '*' -> '.*', alles andere
    // escaped) und testen.
    function patternMatchesAnyStem(pattern, stems) {
        if (!stems || stems.length === 0) return false;
        const re = new RegExp('^' + pattern.split('*').map(function(p) {
            return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }).join('.*') + '$');
        return stems.some(function(s) { return re.test(s); });
    }

    function rebuildItemsList() {
        _items = [];
        // Standard-Presets nach Discovery filtern: solange Discovery noch laedt
        // ALLE zeigen, sobald da eine non-empty Liste da ist nur die behalten
        // die auf deinen Hosts auch was matchen. Bei Error/Empty: alle zeigen.
        const stems = (_disc.patterns || []).map(function(p) { return p.stem; });
        const showAllPresets = _disc.loading || _disc.error || stems.length === 0;
        const visiblePresets = showAllPresets
            ? PRESETS
            : PRESETS.filter(function(p) {
                return patternMatchesAnyStem(p.pattern, stems);
              });
        _items.push({ type: 'header', label: 'Standard-Presets' });
        visiblePresets.forEach(function(p) {
            _items.push({ type: 'item', label: p.lbl, value: p.pattern });
        });
        _items.push({ type: 'item',
                      label: '\u2014 Custom-Pattern \u2014',
                      value: '__custom__' });
        _items.push({ type: 'header', label: '\u{1F50D} Auf deinen Hosts gefunden' });
        if (_disc.loading) {
            _items.push({ type: 'item', label: '\u23f3 Lade Patterns...',
                          value: null, disabled: true });
        } else if (_disc.error) {
            _items.push({ type: 'item', label: 'Fehler: ' + _disc.error,
                          value: null, disabled: true });
        } else if (_disc.patterns.length === 0) {
            _items.push({ type: 'item', label: 'Keine Patterns gefunden',
                          value: null, disabled: true });
        } else {
            _disc.patterns.forEach(function(p) {
                _items.push({ type: 'item', label: p.stem, value: p.stem,
                              sub: '(' + p.items + 'x, ' + p.hosts + 'h)' });
            });
            if (_disc.truncated) {
                _items.push({ type: 'item',
                              label: '\u26a0 Scan abgeschnitten \u2014 Counts ggf. niedriger',
                              value: null, disabled: true });
            }
        }
        renderList(filterIn.value);
    }

    function renderList(q) {
        listBox.innerHTML = '';
        const ql = (q || '').toLowerCase();
        let pendingHeader = null;
        _items.forEach(function(it) {
            if (it.type === 'header') {
                pendingHeader = it;
                return;
            }
            const hay = (it.label + ' ' + (it.sub || '')).toLowerCase();
            if (ql && hay.indexOf(ql) < 0) return;
            // Header erst rendern wenn ein Item dieser Section gematched hat
            if (pendingHeader) {
                const h = document.createElement('div');
                h.textContent = pendingHeader.label;
                h.style.cssText = 'padding:4px 10px;font-size:10px;font-weight:700;'
                    + 'color:' + t.sub + ';text-transform:uppercase;'
                    + 'letter-spacing:0.04em;background:' + t.head;
                listBox.appendChild(h);
                pendingHeader = null;
            }
            const row = document.createElement('div');
            row.style.cssText = 'padding:4px 10px;cursor:' + (it.disabled ? 'default' : 'pointer')
                + ';font-size:12px;color:' + (it.disabled ? t.subSoft : t.text)
                + ';display:flex;align-items:baseline;gap:8px'
                + (it.disabled ? ';font-style:italic' : '');
            const lab = document.createElement('span');
            lab.textContent = it.label;
            lab.style.flex = '1';
            row.appendChild(lab);
            if (it.sub) {
                const sub = document.createElement('span');
                sub.textContent = it.sub;
                sub.style.cssText = 'color:' + t.subSoft + ';font-size:11px;'
                    + 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
                row.appendChild(sub);
            }
            if (!it.disabled) {
                row.addEventListener('mouseenter', function() {
                    this.style.background = t.hover;
                });
                row.addEventListener('mouseleave', function() {
                    this.style.background = '';
                });
                row.addEventListener('click', function() {
                    if (it.value === '__custom__') {
                        trigger.firstChild.nodeValue = '\u2014 Custom-Pattern \u2014';
                        pat.value = '';
                        closePopup();
                        pat.focus();
                    } else {
                        trigger.firstChild.nodeValue = it.label;
                        pat.value = it.value;
                        closePopup();
                    }
                });
            }
            listBox.appendChild(row);
        });
        if (listBox.children.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'Keine Treffer';
            empty.style.cssText = 'padding:14px;text-align:center;color:' + t.subSoft
                + ';font-size:12px;font-style:italic';
            listBox.appendChild(empty);
        }
    }

    function openPopup() {
        popup.style.display = 'block';
        filterIn.value = '';
        renderList('');
        setTimeout(function() { filterIn.focus(); }, 0);
    }
    function closePopup() { popup.style.display = 'none'; }

    trigger.addEventListener('click', function(e) {
        e.stopPropagation();
        if (popup.style.display === 'block') closePopup();
        else openPopup();
    });
    filterIn.addEventListener('input', function() { renderList(this.value); });
    filterIn.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { closePopup(); trigger.focus(); }
    });
    document.addEventListener('click', function(e) {
        if (!combo.contains(e.target)) closePopup();
    });
    // Initial-Liste mit Loading-Placeholder rendern; Discovery-Fetch pflegt
    // dann _disc und triggert ein Re-Render.
    rebuildItemsList();
    fetchPatternSuggestions().then(function(res) {
        _disc.loading = false;
        if (res && res.error) _disc.error = res.error;
        _disc.patterns = (res && res.patterns) || [];
        _disc.truncated = !!(res && res.truncated);
        rebuildItemsList();
    });

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
    pat.style.cssText = 'flex:1;padding:3px 8px;border:1px solid ' + t.border
        + ';border-radius:2px;font-size:12px;font-family:'
        + 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:' + t.inputBg
        + ';color:' + t.text + ';outline:none;'
        + 'transition:border-color 0.12s';
    pat.addEventListener('focus', function() {
        this.style.borderColor = t.accent;
    });
    pat.addEventListener('blur', function() {
        this.style.borderColor = t.border;
    });
    patWrap.appendChild(pat);
    wrap.appendChild(patWrap);

    const apply = document.createElement('button');
    apply.textContent = 'Anwenden';
    apply.style.cssText = 'padding:3px 12px;border:1px solid ' + t.accent
        + ';border-radius:2px;background:' + t.accent
        + ';color:#ffffff;cursor:pointer;font-size:12px;font-weight:600;'
        + 'font-family:inherit;transition:filter 0.12s';
    wrap.appendChild(apply);

    // Sync vom Pattern-Input zurueck in den Combo-Trigger: wenn der User
    // das Pattern manuell tippt und es matcht einen bekannten Preset oder
    // Discovered-Stem, soll der Trigger das passende Label zeigen statt
    // weiterhin den vorigen Eintrag. Sonst zeigt der Trigger "Custom".
    pat.addEventListener('input', function() {
        const v = pat.value;
        const matchPreset = PRESETS.find(function(p) { return p.pattern === v; });
        if (matchPreset) {
            trigger.firstChild.nodeValue = matchPreset.lbl;
            return;
        }
        const matchDisc = (_disc.patterns || []).find(function(p) { return p.stem === v; });
        if (matchDisc) {
            trigger.firstChild.nodeValue = matchDisc.stem;
            return;
        }
        trigger.firstChild.nodeValue = '— Custom-Pattern —';
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
    const heatmap   = !!opt.heatmap;
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
    // Empty-String-Gruppen (Hosts ohne _primaryGroup) zaehlen nicht — sonst
    // triggert die Multi-Group-Detection auch wenn nur EINE echte Gruppe da
    // ist plus ein paar gruppenlose Hosts.
    const _groupSet = new Set();
    hostIds.forEach(function(hid) {
        const g = _primaryGroup[String(hid)];
        if (g) _groupSet.add(g);
    });
    const _hasMultiGroups = _groupSet.size >= 2;
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
        // Nach dem Filter: nichts mehr uebrig -> dedicated Empty-State,
        // sonst rendert eine kaputt aussehende Tabelle mit lauter "—" und
        // dangling Avg-Spalte/Footer.
        if (cols.length === 0 || hostIds.length === 0) {
            container.innerHTML = '<div style="padding:48px 30px;text-align:center;color:' + t.text + '">'
                + '<div style="font-size:32px;margin-bottom:10px;opacity:0.4">\u{1F4ED}</div>'
                + '<div style="font-size:14px;font-weight:600;margin-bottom:4px">'
                + 'Alles leer.</div>'
                + '<div style="color:' + t.sub + ';font-size:12px;margin-top:6px">'
                + '"Leere ausblenden" hat alle Hosts/Items entfernt — '
                + 'Toggle deaktivieren um die volle Pivot zu sehen.</div></div>';
            return;
        }
    }

    const baseUrl = buildBaseUrl();

    // Aggregat-Helper: Sum / Avg / Max ueber non-null numerische Werte.
    // Filter strikt auf 'number' damit numeric-Strings (z.B. "12.5") nicht
    // im Sum-Modus zu String-Konkatenation fuehren ("0" + "12.5" = "012.5").
    // isFinite filtert auch Infinity/-Infinity raus.
    const aggregate = function(values, mode) {
        const nums = values.filter(function(v) {
            return typeof v === 'number' && isFinite(v);
        });
        if (nums.length === 0) return null;
        if (mode === 'sum') return nums.reduce(function(a, b) { return a + b; }, 0);
        if (mode === 'max') return Math.max.apply(null, nums);
        if (mode === 'min') return Math.min.apply(null, nums);
        // Percentiles: linear-interpolated position im sortierten Array
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

    // Mixed-Units-Detection fuer die Aggregat-Spalte: nur wenn alle Spalten
    // dieselbe Unit haben, ist der Avg-Wert sinnvoll formatierbar. Bei
    // gemischten Units (z.B. Discovery-Pattern matched Bytes + %) waere
    // "57.34 %" auf einem Mix von Werten irrefuehrend — wir formatieren
    // dann ohne Unit (raw Zahl).
    const _unitSet = new Set(cols.map(function(c) { return c.unit || ''; }));
    const _aggUnit = (_unitSet.size === 1 ? (cols[0] && cols[0].unit) : '') || '';

    // Heatmap-Stats: pro Spalte min/max ueber non-null Werte. Wird einmal
    // pro Render berechnet und unten in cellBg() abgerufen.
    const _colStats = {};
    if (heatmap) {
        cols.forEach(function(c) {
            let mn = Infinity, mx = -Infinity, n = 0;
            hostIds.forEach(function(hid) {
                const v = rows[hid] && rows[hid][c.key];
                if (typeof v === 'number' && isFinite(v)) {
                    if (v < mn) mn = v;
                    if (v > mx) mx = v;
                    n++;
                }
            });
            // Nur wenn mindestens 2 verschiedene Werte da sind ergibt der
            // Gradient Sinn — sonst waere alles dieselbe Farbe.
            _colStats[c.key] = (n >= 2 && mn < mx) ? { min: mn, max: mx } : null;
        });
    }
    // Aggregate (Avg pro Zeile) fuer Heatmap separat: ueber alle Zeilen-Avgs.
    let _avgStats = null;
    if (heatmap) {
        const allAvgs = [];
        hostIds.forEach(function(hid) {
            const row = rows[hid] || {};
            const vals = [];
            cols.forEach(function(c) {
                const v = row[c.key];
                if (typeof v === 'number' && isFinite(v)) vals.push(v);
            });
            const a = aggregate(vals, 'avg');
            if (a != null) allAvgs.push(a);
        });
        if (allAvgs.length >= 2) {
            const mn = Math.min.apply(null, allAvgs);
            const mx = Math.max.apply(null, allAvgs);
            if (mn < mx) _avgStats = { min: mn, max: mx };
        }
    }

    // Hintergrund-Farbe pro Zelle. Heatmap-Modus: Gradient gruen->gelb->rot
    // basierend auf relativer Position in der Spalte. Default-Modus:
    // Threshold-Coloring fuer % Zellen (>80% orange, >95% rot) — hard rules,
    // funktionieren auch ohne Heatmap-Daten.
    function cellBg(v, unit, statsForCol) {
        if (typeof v !== 'number' || !isFinite(v)) return '';
        if (heatmap && statsForCol) {
            const norm = Math.max(0, Math.min(1, (v - statsForCol.min) / (statsForCol.max - statsForCol.min)));
            // Gruen (HSL hue 120) -> Gelb (60) -> Rot (0)
            const hue = Math.round(120 - norm * 120);
            return ';background:hsla(' + hue + ',65%,50%,0.18)';
        }
        // Threshold-Coloring: Hard rules fuer haeufige Units
        if (unit === '%') {
            if (v >= 95) return ';background:rgba(220,38,38,0.18)';   // rot
            if (v >= 80) return ';background:rgba(245,158,11,0.20)';  // orange
        }
        return '';
    }

    // Sort-Pfeil-Helfer
    const arrow = function(col) {
        if (col !== sortCol) return '';
        return sortDir === 'desc' ? ' \u25BC' : ' \u25B2';
    };

    // Tabelle aufbauen
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';

    // Header — alle Spalten sortierbar via data-sort
    let thead = '<thead><tr style="background:' + t.head + ';border-bottom:1px solid ' + t.border + '">'
        + '<th data-sort="__host__" style="padding:6px 8px;text-align:left;font-size:11px;'
        + 'font-weight:700;color:' + (sortCol === '__host__' || !sortCol ? t.textStrong : t.sub)
        + ';text-transform:uppercase;letter-spacing:0.04em;cursor:pointer;user-select:none;'
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
            + 'style="padding:6px 8px;text-align:right;font-size:11px;'
            + 'font-weight:700;color:' + (isActive ? t.textStrong : t.sub)
            + ';text-transform:uppercase;letter-spacing:0.04em;cursor:pointer;user-select:none;'
            + 'font-family:' + monoFam + ';white-space:nowrap" '
            + 'title="' + esc(c.key) + '">'
            + esc(cleanLabel(c.label))
            + (c.unit ? ' <span style="opacity:0.55">(' + esc(c.unit) + ')</span>' : '')
            + arrow(c.key)
            + '</th>';
    });
    // Aggregat-Spalte rechts (Avg pro Host-Zeile)
    thead += '<th style="padding:6px 8px;text-align:right;font-size:11px;'
        + 'font-weight:700;color:' + t.sub + ';text-transform:uppercase;'
        + 'letter-spacing:0.04em;font-family:' + monoFam + ';white-space:nowrap;'
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
                + ';color:' + t.sub + ';font-size:11px;font-weight:700;'
                + 'text-transform:uppercase;letter-spacing:0.04em;'
                + 'border-top:1px solid ' + t.border + ';border-bottom:1px solid ' + t.borderSoft
                + ';position:sticky;left:0">'
                + esc(grp || '— Ohne Gruppe —') + '</td></tr>');
            _lastGroup = grp;
        }

        const latestHostUrl = window.location.origin + baseUrl
            + 'zabbix.php?action=latest.view&filter_set=1&hostids%5B%5D=' + encodeURIComponent(hid);

        let html = '<tr style="border-bottom:1px solid ' + t.borderSoft
            + ';transition:background 0.12s">'
            + '<td style="padding:5px 8px;font-weight:600;font-size:13px;'
            + 'position:sticky;left:0;background:' + t.surface + ';z-index:1;'
            + 'border-right:1px solid ' + t.borderSoft + '">'
            + '<a href="' + esc(latestHostUrl) + '" target="_blank" rel="noopener noreferrer" '
            + 'style="color:' + t.link + ';text-decoration:none">' + esc(hostname) + '</a></td>';

        const rowVals = [];
        const meta = (data.item_meta && data.item_meta[hid]) || {};
        cols.forEach(function(c) {
            const v = row[c.key];
            if (v != null) rowVals.push(v);
            const im = meta[c.key];   // {id, name, desc, vt} vom Backend
            // Drill-Down-URL pro Zelle: wenn wir eine itemid haben, direkt
            // zum Item-Detail. Sonst fallback auf Latest-Data mit Host+Name.
            let cellLink;
            if (im && im.id) {
                cellLink = window.location.origin + baseUrl
                    + 'zabbix.php?action=latest.view&filter_set=1&itemids%5B%5D='
                    + encodeURIComponent(im.id);
            } else {
                cellLink = window.location.origin + baseUrl
                    + 'zabbix.php?action=latest.view&filter_set=1'
                    + '&hostids%5B%5D=' + encodeURIComponent(hid)
                    + '&name=' + encodeURIComponent(cleanLabel(c.label) || c.key);
            }
            const cellColor = (v == null ? t.subSoft : t.text);
            const bg = cellBg(v, c.unit, _colStats[c.key]);
            // Tooltip: Item-Name + Description (falls vorhanden) — deutlich
            // hilfreicher als "In Latest Data oeffnen".
            const ttParts = [];
            if (im && im.name) ttParts.push(im.name);
            if (im && im.desc) ttParts.push('— ' + im.desc);
            const tt = ttParts.length ? ttParts.join('\n') : 'In Latest Data oeffnen';
            // Sparkline-Placeholder-Span (leer). Wird nach dem Fetch via
            // updateSparkline() gefuellt. data-itemid liefert den Key fuer
            // das Batch-Ergebnis.
            const sparkSlot = (im && im.id)
                ? '<span class="nt-pivot-spark" data-itemid="' + esc(im.id)
                    + '" style="display:inline-block;width:56px;height:14px;vertical-align:middle;margin-right:4px;opacity:0.7"></span>'
                : '';
            html += '<td style="padding:0;text-align:right;font-family:' + monoFam + ';'
                + 'font-size:12px' + bg + '">'
                + (v != null
                    ? '<a href="' + esc(cellLink) + '" target="_blank" rel="noopener noreferrer" '
                        + 'style="display:flex;align-items:center;justify-content:flex-end;'
                        + 'padding:5px 8px;color:' + cellColor
                        + ';text-decoration:none" title="' + esc(tt) + '">'
                        + sparkSlot + '<span>' + esc(fmtVal(v, c.unit)) + '</span></a>'
                    : '<span style="display:block;padding:5px 8px;color:' + cellColor + '">'
                        + esc(fmtVal(v, c.unit)) + '</span>')
                + '</td>';
        });
        // Aggregat-Spalte (Avg) pro Zeile rechts
        const avgVal = aggregate(rowVals, 'avg');
        const avgBg = cellBg(avgVal, _aggUnit, _avgStats);
        html += '<td style="padding:5px 8px;text-align:right;font-family:' + monoFam + ';'
            + 'font-size:12px;color:' + (avgVal == null ? t.subSoft : t.textStrong)
            + ';font-weight:600;border-left:2px solid ' + t.border + avgBg + '">'
            + esc(fmtVal(avgVal, _aggUnit)) + '</td>';
        html += '</tr>';
        tbody.insertAdjacentHTML('beforeend', html);
    });
    table.appendChild(tbody);

    // Footer: Sum / Avg / P50 / P95 / P99 / Max pro Item-Spalte.
    // Perzentile sind bei skewed Verteilungen aussagekraeftiger als Avg/Max
    // allein — bei 100 Hosts ist P95=80% schmerzhafter als Avg=45% mit Max=99%.
    if (hostIds.length > 0) {
        const tfoot = document.createElement('tfoot');
        ['sum', 'avg', 'p50', 'p95', 'p99', 'max'].forEach(function(mode, idx) {
            const lblMap = { sum: 'Sum', avg: 'Avg', p50: 'P50', p95: 'P95', p99: 'P99', max: 'Max' };
            let row = '<tr style="background:' + t.head
                + ';border-top:' + (idx === 0 ? '2px solid ' + t.border : '1px solid ' + t.borderSoft) + '">'
                + '<td style="padding:5px 8px;font-size:11px;font-weight:700;'
                + 'color:' + t.sub + ';text-transform:uppercase;letter-spacing:0.04em;'
                + 'position:sticky;left:0;background:' + t.head + ';z-index:1;'
                + 'border-right:1px solid ' + t.borderSoft + '">' + lblMap[mode] + '</td>';
            // Alle Werte aller Hosts in allen Spalten flach gesammelt — wird
            // fuer die trailing Aggregat-Spalte des Footers verwendet, damit
            // die Sum-Row dort eine echte Gesamtsumme zeigt (nicht ein
            // mathematisch unsinniges Mean-of-Sums) und entsprechend Max-Row
            // ein echtes Max-of-all.
            const flatVals = [];
            cols.forEach(function(c) {
                const colVals = hostIds.map(function(hid) {
                    return rows[hid] && rows[hid][c.key];
                });
                colVals.forEach(function(v) {
                    if (v != null) flatVals.push(v);
                });
                const v = aggregate(colVals, mode);
                row += '<td style="padding:5px 8px;text-align:right;font-family:' + monoFam + ';'
                    + 'font-size:12px;color:' + (v == null ? t.subSoft : t.textStrong)
                    + ';font-weight:600">'
                    + esc(fmtVal(v, c.unit)) + '</td>';
            });
            // Trailing Aggregat-Cell: derselbe Modus wie die Zeile aber ueber
            // ALLE Werte (Cross-Cells). Sum-Row -> Gesamtsumme, Max-Row -> Max,
            // Avg-Row -> globaler Mittelwert (jede Zelle gleich gewichtet).
            // Bei Mixed-Units wird unitless angezeigt damit nichts irrefuehrt.
            const footerCross = aggregate(flatVals, mode);
            row += '<td style="padding:5px 8px;text-align:right;font-family:' + monoFam + ';'
                + 'font-size:12px;color:' + (footerCross == null ? t.subSoft : t.textStrong)
                + ';font-weight:600;border-left:2px solid ' + t.border + '">'
                + esc(fmtVal(footerCross, _aggUnit)) + '</td>';
            row += '</tr>';
            tfoot.insertAdjacentHTML('beforeend', row);
        });
        table.appendChild(tfoot);
    }

    // Sparkline-Lazyfetch: alle itemids der sichtbaren Zellen einsammeln,
    // in einem Batch history holen, dann die Placeholder-Spans befuellen.
    // Wichtig: erst NACHDEM die Tabelle im DOM ist — sonst greift querySelector
    // nicht. Wir triggern nach dem naechsten Frame (rAF).
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function() { _fetchAndRenderSparklines(container, baseUrl, t); });
    } else {
        setTimeout(function() { _fetchAndRenderSparklines(container, baseUrl, t); }, 0);
    }

    // Truncated-Hinweis
    if (data.truncated) {
        const warn = document.createElement('div');
        warn.style.cssText = 'padding:10px 14px;background:#fef3c7;color:#92400e;'
            + 'font-size:12px;border-radius:2px;margin-bottom:8px;font-weight:500';
        warn.textContent = '\u26A0 Sehr viele Items \u2014 Liste wurde abgeschnitten. '
            + 'Spezifischeres Pattern verwenden.';
        container.appendChild(warn);
    }

    // Scroll-Wrapper falls breit
    const scroll = document.createElement('div');
    scroll.style.cssText = 'overflow-x:auto;background:' + t.surface
        + ';border:1px solid ' + t.border + ';border-radius:2px;'
        + 'box-shadow:0 1px 3px rgba(0,0,0,0.04)';
    scroll.appendChild(table);
    container.appendChild(scroll);
}
