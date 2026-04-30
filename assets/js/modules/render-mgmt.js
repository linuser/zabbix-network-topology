// render-mgmt.js — Management-Ansicht: Hosts als Kacheln, gruppiert nach
// Device-Type (Firewall/Router/Switch/.../Server/Storage/...).
//
// Im Gegensatz zum technischen Tab gibt es hier keine Edges und kein
// Cytoscape — pure DOM-Tiles. Sortiert pro Ebene nach Severity (worst zuerst).
// Wird auch beim Dark-Mode-Wechsel komplett neu gerendert (siehe tabs.js).

import { showCtx } from './context-menu.js';
import { showDetail } from './detail-panel.js';
import { hideMinimap } from './minimap.js';
import { loadNotes } from './storage.js';

// Ebenen-Reihenfolge: niedrige Zahl = oben (Firewall am Perimeter)
const MGMT_LEVEL = {
    firewall: 0, router: 1, switch: 2, wireless: 3,
    hypervisor: 4, linux: 4, windows: 4, macos: 4,
    webserver: 4, container: 4, mailserver: 4, server: 4,
    storage: 5, homeauto: 6, monitoring: 6,
    ups: 7, camera: 7, printer: 7
};

const MGMT_LEVEL_NAMES = {
    0: 'Firewall / Gateway', 1: 'Router', 2: 'Switch', 3: 'Wireless',
    4: 'Server / Virtualisierung', 5: 'Storage / NAS',
    6: 'Home Automatisierung / Monitoring', 7: 'Geraete'
};

function mgmtSevStyle(sev) {
    const colors = ['#22c55e', '#06b6d4', '#f59e0b', '#f97316', '#ef4444', '#991b1b'];
    const labels = ['OK', 'Info', 'Warn', 'Avg', 'High', 'Krit'];
    const c = colors[Math.min(sev || 0, colors.length - 1)];
    const l = labels[Math.min(sev || 0, labels.length - 1)];
    return { color: c, label: l };
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
    Array.from(wrap.children).forEach(function(ch) {
        if (ch.id !== 'nt-loading') wrap.removeChild(ch);
    });

    const dark = !!(document.getElementById('nt-root')
                 && document.getElementById('nt-root').classList.contains('nt-dark'));
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
    const sevCounts = [0, 0, 0, 0, 0, 0];
    let maintCount = 0, ackCount = 0;
    nodes.forEach(function(n) {
        const s = n.severity || 0;
        if (s >= 0 && s <= 5) sevCounts[s]++;
        if (n.maintenance)  maintCount++;
        if (n.acknowledged) ackCount++;
    });
    const totalHosts = nodes.length;
    const problemHosts = totalHosts - sevCounts[0];

    // Stats-Header: kompakte Kachel-Reihe oben mit Total / Probleme / Severity-Pillen
    // / Wartung / Acked. Dunkel-Mode-konform.
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

    addStat('Hosts', totalHosts, text);
    addStat('Mit Problem', problemHosts, problemHosts > 0 ? '#dc2626' : text);
    if (maintCount > 0) addStat('Wartung', maintCount, '#92400e');
    if (ackCount > 0)   addStat('Bestätigt', ackCount, '#16a34a');

    // Letzte Stat-Kachel: Trenn-Border weg
    if (_statBlocks.length > 0) {
        _statBlocks[_statBlocks.length - 1].style.borderRight = 'none';
    }

    // Severity-Pillen — nur die mit Treffern anzeigen, kritischste links.
    // Normal (0) blenden wir aus, im "Mit Problem"-Counter ist das Komplement.
    const sevColors = ['#22c55e', '#06b6d4', '#f59e0b', '#f97316', '#ef4444', '#991b1b'];
    const sevLabels = ['OK', 'Info', 'Warn', 'Avg', 'High', 'Krit'];
    const pills = document.createElement('div');
    pills.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 8px;'
        + 'margin-left:auto;flex-wrap:wrap';
    for (let s = 5; s >= 1; s--) {
        if (!sevCounts[s]) continue;
        const pill = document.createElement('span');
        pill.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:3px 9px;'
            + 'border-radius:11px;background:' + sevColors[s] + '22;color:' + sevColors[s]
            + ';font-size:11px;font-weight:700';
        pill.innerHTML = '<span style="display:inline-block;width:8px;height:8px;'
            + 'border-radius:50%;background:' + sevColors[s] + '"></span>'
            + sevLabels[s] + ' ' + sevCounts[s];
        pills.appendChild(pill);
    }
    if (pills.children.length > 0) statsBar.appendChild(pills);

    container.appendChild(statsBar);

    // Notizen einmal laden, nicht pro Tile
    const _mgmtNotes = loadNotes();

    sortedLevels.forEach(function(lvl) {
        const lvlNodes = levels[lvl];

        // Ebenen-Header
        const header = document.createElement('div');
        header.style.cssText = 'font-size:11px;font-weight:700;color:' + sub
            + ';text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;'
            + 'padding-bottom:4px;border-bottom:1px solid ' + bdr
            + ';margin-top:' + (lvl === sortedLevels[0] ? '0' : '24px');
        header.textContent = MGMT_LEVEL_NAMES[lvl] || ('Ebene ' + lvl);
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

            const tile = document.createElement('div');
            // Acked-Hosts bekommen einen zusätzlichen grünen Outline-Ring
            // (box-shadow), Wartungs-Hosts halb-transparent gedimmt.
            const ackShadow = n.acknowledged ? '0 0 0 2px #22c55e, ' : '';
            tile.style.cssText = [
                'width:190px;min-height:80px;background:' + card,
                'border:1.5px solid ' + sev.color,
                'border-radius:10px;padding:12px 14px',
                'cursor:pointer;position:relative',
                'box-shadow:' + ackShadow + '0 1px 4px rgba(0,0,0,0.07)',
                'transition:box-shadow 0.15s,transform 0.15s',
                'box-sizing:border-box',
                n.maintenance ? 'opacity:0.75' : ''
            ].filter(Boolean).join(';');

            // Severity-Header
            const topRow = document.createElement('div');
            topRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px';
            const dot = document.createElement('div');
            dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:' + sev.color + ';flex-shrink:0';
            const sevLbl = document.createElement('span');
            sevLbl.style.cssText = 'font-size:10px;font-weight:700;color:' + sev.color;
            sevLbl.textContent = sev.label;
            topRow.appendChild(dot);
            topRow.appendChild(sevLbl);

            // Status-Badges (Wartung, Acked) rechts neben Severity-Label
            if (n.maintenance) {
                const mb = document.createElement('span');
                mb.title = 'In Wartung';
                mb.style.cssText = 'background:#fef3c7;color:#92400e;border-radius:8px;'
                    + 'font-size:9px;font-weight:600;padding:1px 5px';
                mb.textContent = '\u{1F527}';
                topRow.appendChild(mb);
            }
            if (n.acknowledged) {
                const ab = document.createElement('span');
                ab.title = 'Probleme best\u00E4tigt';
                ab.style.cssText = 'background:#dcfce7;color:#166534;border-radius:8px;'
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
                if (n.cpu    != null) metrics.innerHTML += '<span>CPU ' + n.cpu    + '%</span>';
                if (n.memory != null) metrics.innerHTML += '<span>RAM ' + n.memory + '%</span>';
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
