// render-mgmt.js — Management-Ansicht: Hosts als Kacheln, gruppiert nach
// Device-Type (Firewall/Router/Switch/.../Server/Storage/...).
//
// Im Gegensatz zum technischen Tab gibt es hier keine Edges und kein
// Cytoscape — pure DOM-Tiles. Sortiert pro Ebene nach Severity (worst zuerst).
// Wird auch beim Dark-Mode-Wechsel komplett neu gerendert (siehe tabs.js).

import { isDark, clearWrap } from './utils.js';
import { showCtx } from './context-menu.js';
import { showDetail } from './detail-panel.js';
import { hideMinimap } from './minimap.js';
import { loadNotes } from './storage.js';
import { t } from './i18n.js';
import { TYPE_ICON } from './icons.js';

// Kategorien fuer NICHT-ITler: Firewall/Router/Switch/Wireless sind fuer einen
// Laien alles "Netzwerk" — darum EIN Bucket statt vier. Fuenf verstaendliche
// Gruppen, niedrige Zahl = oben.
const MGMT_LEVEL = {
    firewall: 0, router: 0, switch: 0, wireless: 0,
    hypervisor: 1, linux: 1, windows: 1, macos: 1,
    webserver: 1, container: 1, mailserver: 1, server: 1,
    storage: 2, homeauto: 3, monitoring: 3,
    ups: 4, camera: 4, printer: 4, client: 4
};

// Alle Namen ueber t() — bei deutscher Zabbix-Sprache deutsch (frueher waren
// fuenf davon fest Englisch, also fuer deutsche Laien eine gemischte Liste). Zur
// RENDER-Zeit aufgeloest (nicht beim Modul-Load), damit die aktuelle Sprache gilt.
function mgmtLevelName(lvl) {
    const names = {
        0: t('mgmt.level.network'), 1: t('mgmt.level.server'),
        2: t('mgmt.level.storage'), 3: t('mgmt.level.homeauto'),
        4: t('mgmt.level.devices')
    };
    return names[lvl] || t('mgmt.level.generic', { n: lvl });
}

// Repraesentatives Typ-Icon je Kategorie (TYPE_ICON-Schluessel, icons.js).
const MGMT_LEVEL_ICON = {
    0: 'switch', 1: 'server', 2: 'storage', 3: 'wireless', 4: 'printer'
};

// Fuer Laien drei verstaendliche Zustaende statt der Zabbix-Fuenf: OK/Info ->
// "Laeuft", Warn/Avg -> "Warnung", High/Disaster -> "Kritisch". Ein Hinweis
// (Info) ist fuer einen Nicht-ITler kein Problem, darum gruen bei "Laeuft".
function mgmtBucket(sev) {
    const s = sev || 0;
    if (s >= 4) return 2;   // High, Disaster
    if (s >= 2) return 1;   // Warning, Average
    return 0;               // OK, Information
}

const MGMT_BUCKET_COLOR = ['#22c55e', '#f97316', '#ef4444'];
const MGMT_BUCKET_KEY   = ['mgmt.status.ok', 'mgmt.status.warn', 'mgmt.status.crit'];

function mgmtSevStyle(sev) {
    const b = mgmtBucket(sev);
    return { color: MGMT_BUCKET_COLOR[b], label: t(MGMT_BUCKET_KEY[b]) };
}

// Kleines Typ-Icon (dieselben Pfade wie auf der Karte, icons.js) als SVG-DOM —
// bewusst KEIN innerHTML (no-unsanitized), per createElementNS gebaut.
function mgmtTypeIcon(type, color) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-16 -16 32 32');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', color);
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.flexShrink = '0';
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', TYPE_ICON[type] || TYPE_ICON.server);
    svg.appendChild(path);
    return svg;
}

export function renderManagement(wrap, nodes, edges) {
    // Aufräumen vorheriger Tab-State (Cytoscape, Animation, Auto-Refresh)
    if (window._ntCy)         { try { window._ntCy.destroy(); } catch (e) {} window._ntCy = null; }
    if (window._ntEdgeAnim)   { clearInterval(window._ntEdgeAnim);   window._ntEdgeAnim   = null; }
    if (window._ntRefreshTimer) { clearInterval(window._ntRefreshTimer); window._ntRefreshTimer = null; }
    if (window._ntMinimapTimer) { clearInterval(window._ntMinimapTimer); window._ntMinimapTimer = null; }

    // Toolbar wird beim Wechsel zurück auf Tech neu aufgebaut
    window._ntToolbarDone = false;
    hideMinimap();

    // Canvas-Children leeren (Loading-Spinner behalten)
    clearWrap(wrap);

    // Die technische KPI-Zeile (Edges/Ghosts/Expected/STP-blocked) gehoert nicht
    // in die Laiensicht und bliebe sonst mit veralteten Technik-Werten vom
    // Technical-Tab stehen. Ausblenden; render-tech/updateKpi macht sie beim
    // Zurueckwechseln wieder sichtbar.
    const _kpiRow = document.getElementById('nt-kpi');
    if (_kpiRow) _kpiRow.style.display = 'none';

    const dark = isDark();
    const bg   = dark ? '#0d1117' : '#f0f2f5';
    const card = dark ? '#161b22' : '#ffffff';
    const text = dark ? '#e6edf3' : '#1e293b';
    const sub  = dark ? '#8b949e' : '#64748b';
    const bdr  = dark ? '#30363d' : '#e2e8f0';

    const container = document.createElement('div');
    container.style.cssText = 'width:100%;height:100%;overflow-y:auto;overflow-x:hidden;'
                            + 'padding:24px 20px;box-sizing:border-box;background:' + bg;

    // Nodes nach Level gruppieren. Pro Level merken wir uns max. Severity
    // damit wir die Levels später worst-first sortieren können.
    const levels = {};
    const levelMaxSev = {};
    nodes.forEach(function(n) {
        const lvl = MGMT_LEVEL[n.type] !== undefined ? MGMT_LEVEL[n.type] : 4;
        if (!levels[lvl]) levels[lvl] = [];
        levels[lvl].push(n);
        const sev = n.severity || 0;
        if (sev > (levelMaxSev[lvl] || 0)) levelMaxSev[lvl] = sev;
    });
    // Worst-First: Level mit höchster Severity oben. Tiebreaker: ursprüngliche
    // MGMT_LEVEL-Nummer (Firewall vor Router etc.) damit gleich-kritische Levels
    // ihre Topologie-Reihenfolge behalten.
    const sortedLevels = Object.keys(levels).map(Number).sort(function(a, b) {
        const sb = levelMaxSev[b] || 0, sa = levelMaxSev[a] || 0;
        if (sb !== sa) return sb - sa;
        return a - b;
    });

    // Aggregat-Stats für den Header: pro Severity zählen, dazu Wartung + Acked.
    const bucketCounts = [0, 0, 0];   // 0 = Laeuft, 1 = Warnung, 2 = Kritisch
    let maintCount = 0, ackCount = 0, offCount = 0;
    nodes.forEach(function(n) {
        bucketCounts[mgmtBucket(n.severity)]++;
        if (n.maintenance)  maintCount++;
        if (n.acknowledged) ackCount++;
        if (n.unavailable)  offCount++;
    });
    const totalHosts = nodes.length;

    // Stats-Header fuer Laien: "N Geraete" + Klartext-Zaehler (Laeuft/Warnung/
    // Kritisch). KEINE Edges/Ghosts/Expected/STP — das ist die technische
    // KPI-Zeile (oben ausgeblendet), nicht die Laiensicht.
    const statsBar = document.createElement('div');
    statsBar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:10px;'
        + 'padding:10px 14px;margin-bottom:18px;background:' + card
        + ';border:1px solid ' + bdr + ';border-radius:10px;'
        + 'box-shadow:0 1px 3px rgba(0,0,0,0.04)';

    const _statBlocks = [];   // alle .stat-Elemente damit wir am Ende die
                              // letzte Trenn-Border entfernen können
    function addStat(label, value, color) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;'
            + 'padding:2px 12px;border-right:1px solid ' + bdr;
        const v = document.createElement('div');
        v.style.cssText = 'font-size:18px;font-weight:700;line-height:1.1;color:'
            + (color || text);
        v.textContent = String(value);
        const l = document.createElement('div');
        l.style.cssText = 'font-size:10px;font-weight:600;color:' + sub
            + ';text-transform:uppercase;letter-spacing:0.05em;margin-top:2px';
        l.textContent = label;
        wrap.appendChild(v);
        wrap.appendChild(l);
        statsBar.appendChild(wrap);
        _statBlocks.push(wrap);
    }

    addStat(t('mgmt.stat.devices'), totalHosts, text);
    if (offCount > 0)   addStat(t('mgmt.status.off'), offCount, '#e53742');
    if (maintCount > 0) addStat(t('mgmt.stat.maintenance'), maintCount, '#92400e');
    if (ackCount > 0)   addStat(t('mgmt.stat.acked'), ackCount, '#16a34a');

    // Letzte Stat-Kachel: Trenn-Border weg
    if (_statBlocks.length > 0) {
        _statBlocks[_statBlocks.length - 1].style.borderRight = 'none';
    }

    // Klartext-Pillen: Laeuft / Warnung / Kritisch. "Laeuft" immer zeigen (der
    // gute Normalfall), Warnung/Kritisch nur wenn vorhanden.
    const pills = document.createElement('div');
    pills.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 8px;'
        + 'margin-left:auto;flex-wrap:wrap';
    for (let b = 0; b <= 2; b++) {
        if (b > 0 && !bucketCounts[b]) continue;
        const c = MGMT_BUCKET_COLOR[b];
        const pill = document.createElement('span');
        pill.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:3px 9px;'
            + 'border-radius:11px;background:' + c + '22;color:' + c
            + ';font-size:11px;font-weight:700';
        pill.innerHTML = '<span style="display:inline-block;width:8px;height:8px;'
            + 'border-radius:50%;background:' + c + '"></span>'
            + bucketCounts[b] + ' ' + t(MGMT_BUCKET_KEY[b]);
        pills.appendChild(pill);
    }
    statsBar.appendChild(pills);

    container.appendChild(statsBar);

    // Notizen einmal laden, nicht pro Tile
    const _mgmtNotes = loadNotes();

    sortedLevels.forEach(function(lvl) {
        const lvlNodes = levels[lvl];

        // Ebenen-Header: Icon + Label + Count-Badge + Worst-Status-Dot der Ebene
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;'
            + 'padding-bottom:5px;border-bottom:1px solid ' + bdr
            + ';margin-top:' + (lvl === sortedLevels[0] ? '0' : '24px');
        // Kategorie-Icon (repraesentativer Typ) — macht die Gruppe auf einen Blick
        // erkennbar, auch fuer Nicht-ITler.
        header.appendChild(mgmtTypeIcon(MGMT_LEVEL_ICON[lvl] || 'server', sub));
        const hLbl = document.createElement('span');
        hLbl.style.cssText = 'font-size:11px;font-weight:700;color:' + sub
            + ';text-transform:uppercase;letter-spacing:0.08em';
        hLbl.textContent = mgmtLevelName(lvl);
        header.appendChild(hLbl);
        const hCount = document.createElement('span');
        hCount.style.cssText = 'font-size:10px;font-weight:700;color:' + sub
            + ';background:' + (dark ? '#21262d' : '#eef2f6') + ';border-radius:9px;padding:1px 8px';
        hCount.textContent = String(lvlNodes.length);
        header.appendChild(hCount);
        const wsev = levelMaxSev[lvl] || 0;
        if (wsev > 0) {
            const wst = mgmtSevStyle(wsev);
            const wdot = document.createElement('span');
            wdot.style.cssText = 'width:7px;height:7px;border-radius:50%;flex-shrink:0;background:'
                + wst.color;
            wdot.title = wst.label;
            header.appendChild(wdot);
        }
        container.appendChild(header);

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;margin-bottom:4px';

        lvlNodes.sort(function(a, b) {
            return (b.severity || 0) - (a.severity || 0)
                 || (a.label || '').localeCompare(b.label || '');
        });

        lvlNodes.forEach(function(n) {
            const sev = mgmtSevStyle(n.severity);
            const noteText = _mgmtNotes[String(n.id)] || '';
            const problems = n.problems || 0;

            // Offline-Detection: Backend liefert n.unavailable. Tile wird stark
            // gedimmt + Severity-Border grau, Severity-Label wird "OFFLINE",
            // alle Metriken werden grau dargestellt — analog zum Detail-Panel/
            // zur Tabelle.
            const isOff = !!n.unavailable;
            // Severity liest sich ueber einen kraeftigen linken Akzentstreifen
            // (ruhiger als ein Vollrand in der Signalfarbe), der Rest bleibt
            // neutral. Offline → grauer Streifen.
            const accentColor = isOff ? '#9ca3af' : sev.color;
            const tile = document.createElement('div');
            // Acked-Hosts bekommen einen zusätzlichen grünen Outline-Ring
            // (box-shadow), Wartungs-Hosts halb-transparent gedimmt.
            const ackShadow = n.acknowledged ? '0 0 0 2px #22c55e, ' : '';
            tile.style.cssText = [
                'width:190px;min-height:80px;background:' + card,
                'border:1px solid ' + bdr,
                'border-left:4px solid ' + accentColor,
                'border-radius:8px;padding:11px 14px',
                'cursor:pointer;position:relative',
                'box-shadow:' + ackShadow + '0 1px 4px rgba(0,0,0,0.07)',
                'transition:box-shadow 0.15s,transform 0.15s',
                'box-sizing:border-box',
                isOff           ? 'opacity:0.6' :
                n.maintenance   ? 'opacity:0.75' : ''
            ].filter(Boolean).join(';');

            // Severity-Header (oder Offline-Header bei unreachable)
            const topRow = document.createElement('div');
            topRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px';
            // Geraetetyp-Icon (dieselben Pfade wie auf der Karte) — ein Laie
            // erkennt "Server / Switch / Kamera" sofort, ohne ein Wort zu lesen.
            // In der Status-Farbe getoent, damit es zum Streifen/zur Pille passt.
            const pillColor = isOff ? '#9ca3af' : sev.color;
            topRow.appendChild(mgmtTypeIcon(n.type, pillColor));
            // Status als Pill (Punkt + Klartext-Label) — per DOM gebaut (kein
            // innerHTML), Label als textContent.
            const sevPill = document.createElement('span');
            sevPill.style.cssText = 'display:inline-flex;align-items:center;gap:5px;'
                + 'padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;'
                + 'background:' + pillColor + '1a;color:' + pillColor;
            const sevDot = document.createElement('span');
            sevDot.style.cssText = 'width:7px;height:7px;border-radius:50%;flex-shrink:0;background:'
                + pillColor;
            sevPill.appendChild(sevDot);
            const sevLbl = document.createElement('span');
            sevLbl.textContent = isOff ? t('mgmt.status.off') : sev.label;
            sevPill.appendChild(sevLbl);
            topRow.appendChild(sevPill);

            // Status-Badges (Wartung, Acked) rechts neben Severity-Label
            if (n.maintenance) {
                const mb = document.createElement('span');
                mb.title = t('mgmt.tile.maintenance');
                mb.style.cssText = 'background:var(--nt-warn-bg,#fef3c7);color:var(--nt-warn-text,#92400e);border-radius:8px;'
                    + 'font-size:9px;font-weight:600;padding:1px 5px';
                mb.textContent = '\u{1F527}';
                topRow.appendChild(mb);
            }
            if (n.acknowledged) {
                const ab = document.createElement('span');
                ab.title = t('mgmt.tile.acked');
                ab.style.cssText = 'background:var(--nt-ok-bg,#dcfce7);color:var(--nt-ok-text,#166534);border-radius:8px;'
                    + 'font-size:9px;font-weight:600;padding:1px 5px';
                ab.textContent = '\u2714';
                topRow.appendChild(ab);
            }

            if (problems > 0) {
                const badge = document.createElement('span');
                badge.style.cssText = 'margin-left:auto;background:#ef4444;color:#fff;'
                                    + 'border-radius:10px;font-size:9px;font-weight:700;'
                                    + 'padding:1px 5px;flex-shrink:0';
                badge.textContent = problems > 99 ? '99+' : String(problems);
                topRow.appendChild(badge);
            }
            tile.appendChild(topRow);

            // Name
            const name = document.createElement('div');
            name.style.cssText = 'font-size:13px;font-weight:600;color:' + text
                + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
            name.title = n.label;
            name.textContent = n.label;
            tile.appendChild(name);

            if (n.ip) {
                const ip = document.createElement('div');
                ip.style.cssText = 'font-size:10px;color:' + sub + ';margin-top:2px';
                ip.textContent = n.ip;
                tile.appendChild(ip);
            }

            if (n.cpu != null || n.memory != null) {
                const metrics = document.createElement('div');
                metrics.style.cssText = 'display:flex;gap:8px;margin-top:6px;font-size:10px;color:' + sub;
                // Auslastung farbcodiert: >=90 rot, >=75 amber, sonst neutral.
                function metricSpan(lbl, val) {
                    const v = +val;
                    const col = v >= 90 ? '#ef4444' : v >= 75 ? '#f59e0b' : sub;
                    const w = v >= 75 ? ';font-weight:600' : '';
                    return '<span style="color:' + col + w + '">' + lbl + ' ' + val + '%</span>';
                }
                if (n.cpu    != null) metrics.innerHTML += metricSpan('CPU', n.cpu);
                if (n.memory != null) metrics.innerHTML += metricSpan('RAM', n.memory);
                tile.appendChild(metrics);
            }

            if (noteText) {
                const noteEl = document.createElement('div');
                noteEl.style.cssText = 'font-size:10px;color:#f59e0b;margin-top:4px;'
                                     + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
                noteEl.title = noteText;
                noteEl.textContent = 'Note: ' + noteText;
                tile.appendChild(noteEl);
            }

            tile.addEventListener('mouseenter', function() {
                tile.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
                tile.style.transform = 'translateY(-2px)';
            });
            tile.addEventListener('mouseleave', function() {
                tile.style.boxShadow = '0 1px 4px rgba(0,0,0,0.07)';
                tile.style.transform = '';
            });

            // Rechtsklick → Kontextmenü mit Zabbix-Links
            tile.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                showCtx(e.clientX, e.clientY, n);
            });

            // Linksklick → Detail-Panel (Stub-Cytoscape weil kein cy in Mgmt)
            tile.addEventListener('click', function() {
                const pnl = document.getElementById('nt-detail');
                if (pnl) showDetail(pnl, n, {
                    getElementById: function() {
                        return {
                            data: function() { return {}; },
                            connectedEdges: function() { return { forEach: function() {} }; }
                        };
                    }
                });
            });

            row.appendChild(tile);
        });

        container.appendChild(row);
    });

    wrap.appendChild(container);
}
