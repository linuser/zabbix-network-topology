// render-tech.js — Technische Cytoscape-Ansicht (Standard-Tab "Technisch").
//
// Größter Brocken im Modul-Set. Verantwortlich für:
//   - Element-Aufbau (Nodes mit SVG-Icons, Edges mit Traffic-Labels)
//   - Layout-Wahl (Preset bei gespeicherten Positionen, Concentric bei sparse,
//     sonst Cose)
//   - Cytoscape-Initialisierung mit Style-Definitionen
//   - Event-Handler (Click → Detail+Highlight, Hover → Tooltip, Rechtsklick →
//     Kontextmenü, Drag → Position speichern, Doppelklick → Group collapse)
//   - Toolbar-Aufbau (delegiert an Callback ins Hauptmodul)
//   - Pin/Note-Wiederherstellung aus localStorage
//   - Auto-Refresh-Loop alle 30s
//
// State (Modul-privat):
//   _posSaveTimer — debounce-Timer für drag-save

import { esc } from './utils.js';
import { t } from './i18n.js';
import { primaryGroup, SEV_COL } from './severity.js';
import { makeNodeImage, clearImgCache } from './icons.js';
import {
    NT_GROUP_VIEW_KEY, NT_LLDP_KEY, NT_PERF_KEY,
    loadPositions, savePositions, loadPinned, loadNotes, loadLinks, saveLinks,
    loadLayout, loadTapholdMs
} from './storage.js';
import { aggregateByGroup } from './aggregation.js';
import { applyHighlight, resetHighlight, getActiveHighlightId } from './highlight.js';
import { isPathActive, clearPathState } from './path-highlight.js';
import { clearSimulation, isSimActive, recomputeSimulation } from './whatif.js';
import { clearRootCause, isRootCauseActive, runRootCause } from './root-cause.js';
import { applyPortLabels } from './port-labels.js';
import { notifyTopoChanges } from './topo-notify.js';
import { showTip, hideTip, moveTip, showEdgeTip } from './tooltip.js';
import { showCtx, hideCtx } from './context-menu.js';
import { showDetail } from './detail-panel.js';
import { setupLegend, setupBottomLegend } from './legend.js';
import { setupMinimap, showMinimap } from './minimap.js';
import {
    applyManualLinks, edgeLabel,
    isLinkModeActive, getLinkFirst, setLinkFirst, exitLinkMode
} from './manual-links.js';
import { ensureBaseToolbar } from './tabs.js';
import { applyTrafficHeatmap, startEdgeAnimation } from './traffic.js';
import { buildLayoutConfig } from './layouts.js';
import { buildCytoscapeStyle } from './render-tech-style.js';
import { injectInternetCloud, buildNodeElements, buildEdgeElements } from './build-elements.js';
import { setupGroupHulls, destroyGroupHulls } from './group-hulls.js';
import { runGroupClusterLayout } from './group-cluster-layout.js';
import { NT_GROUP_CLUSTER_KEY } from './storage.js';

// ── Cross-Module-Glue: setupToolbar lebt im Hauptmodul ─────────────────────
// (es ist 228 Zeilen und ist eng mit render() und vielen Buttons verknüpft;
// es als Modul herauszuziehen wäre nochmal eine eigene Session)
let _setupToolbar = function() {};
export function setSetupToolbarCallback(fn) { _setupToolbar = fn; }

// ── Modul-State ────────────────────────────────────────────────────────────
let _posSaveTimer = null;

// ── updateBadge: wird nur in render() benutzt, daher hier ──────────────────
function updateBadge(nodes) {
    const badge = document.getElementById('nt-badge');
    if (!badge) return;
    let ok = 0, warn = 0, down = 0;
    nodes.forEach(function(n) {
        const s = n.severity || 0;
        if (s === 0) ok++;
        else if (s >= 5) down++;
        else warn++;
    });
    badge.innerHTML = '<b>' + nodes.length + '</b> ' + esc(t('tech.badge.hosts')) + ' &nbsp;|&nbsp; '
        + '<span style="color:#22c55e"><b>' + ok   + '</b> ' + esc(t('tech.badge.ok'))   + '</span> &nbsp;|&nbsp; '
        + '<span style="color:#f59e0b"><b>' + warn + '</b> ' + esc(t('tech.badge.warn')) + '</span> &nbsp;|&nbsp; '
        + '<span style="color:#ef4444"><b>' + down + '</b> ' + esc(t('tech.badge.down')) + '</span>';
}

// ── Auto-Refresh-Fehler dezent sichtbar machen ─────────────────────────────
// Der 30s-Refresh zeigte Fehler bisher gar nicht (kein .catch, data.error
// ignoriert) → bei anhaltendem Backend-/Netz-Problem sah man still veraltete
// Daten. Nach >=2 Fehlversuchen in Folge ein kleines amber Badge oben rechts;
// verschwindet beim naechsten erfolgreichen Refresh. Ein einzelner Hiccup
// meldet noch nichts (Rausch-Vermeidung).
let _refreshFails = 0;
function _clearRefreshWarn() {
    _refreshFails = 0;
    const b = document.getElementById('nt-refresh-warn');
    if (b) b.remove();
}
function _markRefresh(ok) {
    if (ok) { _clearRefreshWarn(); return; }
    _refreshFails++;
    if (_refreshFails < 2) return;
    const wrap = document.getElementById('nt-canvas-wrap');
    if (!wrap) return;
    let b = document.getElementById('nt-refresh-warn');
    if (!b) {
        b = document.createElement('div');
        b.id = 'nt-refresh-warn';
        b.style.cssText = 'position:absolute;top:10px;right:12px;z-index:9;'
            + 'background:#fef3c7;color:#92400e;border:1px solid #f59e0b;border-radius:6px;'
            + 'padding:4px 10px;font:600 11px sans-serif;box-shadow:0 2px 6px rgba(0,0,0,0.12)';
        wrap.appendChild(b);
    }
    b.textContent = t('tech.refresh_stale');
    b.title = t('tech.refresh_stale.tip', { n: _refreshFails });
}

// ── ntShowExportOverlay: wird vom Export-Menü in setupToolbar aufgerufen ──
// (im Hauptmodul). Daher nicht hier — bleibt im Hauptmodul.

export function render(wrap, nodes, edges, dataUrl) {
    const pnl = document.getElementById('nt-detail');
    if (!nodes.length) {
        wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;'
                       + 'height:100%;color:#999">' + esc(t('tech.no_hosts')) + '</div>';
        return;
    }

    const cfg = window.NT_CONFIG;
    const sel = (cfg && cfg.selected_group_names) || [];
    nodes.forEach(function(n) { n.id = String(n.id); n._primaryGroup = primaryGroup(n, sel); });

    // groupNames in der USER-AUSWAHL-Reihenfolge bauen (nicht in Node-Iter-
    // Reihenfolge, sonst wechselt die Spalten-Position bei jedem Render je
    // nach dem welcher Host zuerst kommt). Erst die Auswahl, dann eventuell
    // weitere Gruppen die nicht in der Auswahl sind aber durch Hosts auftauchen.
    const _present = {};
    nodes.forEach(function(n) { if (n._primaryGroup) _present[n._primaryGroup] = true; });
    const groupNames = [];
    sel.forEach(function(g) {
        if (_present[g]) { groupNames.push(g); _present[g] = false; }
    });
    // Noch nicht aufgenommene Gruppen (theoretisch Edge-Case) anhängen
    Object.keys(_present).forEach(function(g) {
        if (_present[g]) groupNames.push(g);
    });

    // Group-View aktiv? → Hosts werden zu Aggregat-Nodes verschmolzen.
    let _groupViewActive = false;
    try { _groupViewActive = localStorage.getItem(NT_GROUP_VIEW_KEY) === '1'; } catch (e) {}
    if (_groupViewActive && groupNames.length > 0) {
        const agg = aggregateByGroup(nodes, edges);
        nodes = agg.nodes;
        edges = agg.edges;
    }

    // Hierarchie-Layout: Internet-Wolke + synthetische Edges injizieren
    const _currentLayout = loadLayout();
    const withInet = injectInternetCloud(nodes, edges, _currentLayout);
    nodes = withInet.nodes;
    edges = withInet.edges;

    // Cytoscape-Elements (Nodes + Edges) bauen
    // ── Performance-Modus: vereinfachte Knoten (Severity-Punkt statt SVG-Pie)
    // + kein Layout-Animate. Manuell per Toggle (localStorage), sonst
    // automatisch ab PERF_THRESHOLD Knoten. Kleine Graphen bleiben 1:1.
    const PERF_THRESHOLD = 400;
    let _perfPref = null;
    try {
        const _pv = localStorage.getItem(NT_PERF_KEY);
        if (_pv === '1') _perfPref = true; else if (_pv === '0') _perfPref = false;
    } catch (e) {}
    const perfMode = _perfPref !== null ? _perfPref : (nodes.length >= PERF_THRESHOLD);
    window._ntPerfMode = perfMode;

    const elements = buildNodeElements(nodes, perfMode).concat(buildEdgeElements(edges, nodes));

    // ── Cleanup vorheriger Tab-State ───────────────────────────────────────
    if (window._ntEdgeAnim)     { clearInterval(window._ntEdgeAnim);     window._ntEdgeAnim     = null; }
    if (window._ntCy)           { try { clearPathState(window._ntCy); } catch (e) {}
                                  try { clearSimulation(window._ntCy); } catch (e) {}
                                  try { clearRootCause(window._ntCy); } catch (e) {}
                                  try { window._ntCy.destroy(); } catch (e) {} window._ntCy = null; }
    window._ntToolbarDone = false;
    const oldSev    = document.getElementById('nt-sev-filter');   if (oldSev)    oldSev.remove();
    const oldSearch = document.getElementById('nt-search-input'); if (oldSearch) oldSearch.remove();
    Array.from(wrap.children).forEach(function(ch) {
        if (ch.id !== 'nt-loading') wrap.removeChild(ch);
    });

    const cyDiv = document.createElement('div');
    cyDiv.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0';
    wrap.style.position = 'relative';
    wrap.appendChild(cyDiv);

    const useLayout = 'cose';
    const dark = !!(document.getElementById('nt-root')
                 && document.getElementById('nt-root').classList.contains('nt-dark'));

    cyDiv.style.width  = wrap.clientWidth  + 'px';
    cyDiv.style.height = wrap.clientHeight + 'px';

    // Group-Cluster-Mode aus Storage: 'auto' | 'columns' | 'rows' | 'off'
    // Default 'auto' = adaptive (2-3 Gruppen Spalten, 4+ Gruppen Reihen).
    // User kann das per Toolbar-Toggle überschreiben.
    let _clusterMode = 'auto';
    try {
        const s = localStorage.getItem(NT_GROUP_CLUSTER_KEY);
        if (s === 'auto' || s === 'columns' || s === 'rows' || s === 'off') {
            _clusterMode = s;
        }
    } catch (e) {}

    // Cluster-Trigger: aktiv wenn ≥2 Gruppen, kein Group-View, Mode != 'off'.
    // ANDERS als bisher: gespeicherte Positionen (Preset) blockieren den
    // Cluster-Layout NICHT mehr — sonst sieht der User nie wieder Spalten
    // sobald er einmal "Speichern" geklickt hat. Im Clustered-Modus hat das
    // adaptive Layout Vorrang, der User kann mit 'off' zur Preset-Sicht
    // zurückwechseln.
    const _useCluster = (!_groupViewActive)
        && groupNames.length >= 2
        && _clusterMode !== 'off';

    // Layout-Config: bei Cluster ein leeres preset, der eigentliche Layout-
    // Lauf passiert nach Cytoscape-Init pro Cluster-BoundingBox.
    const _initialLayout = _useCluster
        ? { name: 'preset', positions: function() { return undefined; }, fit: false }
        : buildLayoutConfig(loadLayout(), nodes, edges, false);
    // Im Performance-Modus kein Layout-Animate (bei 1000+ Knoten = Freeze).
    if (perfMode && _initialLayout) _initialLayout.animate = false;

    const cy = cytoscape({
        container: cyDiv,
        elements: elements,
        style: buildCytoscapeStyle(dark),
        layout: _initialLayout,
        userZoomingEnabled: true, userPanningEnabled: true, boxSelectionEnabled: false,
        minZoom: 0.1, maxZoom: 4,
        // Performance bei grossen Graphen (~150-200+ Hosts): Kanten waehrend
        // Pan/Zoom ausblenden und den Viewport als Textur cachen -> deutlich
        // fluessigeres Pannen/Zoomen. motionBlur aus (Default) gegen Ghosting.
        hideEdgesOnViewport: true,
        textureOnViewport: true,
        motionBlur: false,
        // Mobile: Long-Press auf einen Knoten öffnet das Kontextmenü.
        // Default 1000ms ist zu langsam, User-konfigurierbar 300/500/800ms.
        tapholdDuration: loadTapholdMs(),
    });

    // Performance-Modus: einfache Severity-Punkte statt SVG-Pie-Knoten.
    if (perfMode) cy.nodes('[!isGroup]').addClass('nt-perf');

    // Bei Cluster nach dem Cytoscape-Init das eigentliche Layout fahren.
    // setTimeout damit das Canvas seine Größe bekommt.
    // Inner-Layout = die User-Wahl (grid/breadthfirst/concentric/...) damit
    // die Cluster nicht stur cose nutzen wenn der User explizit "Raster" o.ae.
    // gewaehlt hat. 'auto' und 'hierarchy' fallen in group-cluster-layout
    // automatisch auf cose zurueck.
    if (_useCluster) {
        const _innerLayout = loadLayout();
        setTimeout(function() {
            if (cy && !cy.destroyed()) {
                runGroupClusterLayout(cy, groupNames, _clusterMode, null, _innerLayout);
            }
        }, 50);
    }

    window._ntCy = cy;
    window._ntNodes = nodes;
    // (_ntGroupNames und _ntDataUrl waren tote Globals — niemand las sie.
    //  groupNames wird im Toolbar-Setup als Param weitergereicht; dataUrl
    //  wird von switchTab durchgereicht und im Auto-Refresh als Closure
    //  gehalten.)

    // Force resize after DOM settles (Cytoscape misst manchmal zu früh)
    setTimeout(function() { if (cy && !cy.destroyed()) { cy.resize(); cy.fit(cy.nodes(), 40); } }, 200);
    setTimeout(function() { if (cy && !cy.destroyed()) { cy.resize(); cy.fit(cy.nodes(), 40); } }, 600);
    cy.one('layoutready', function() {
        const usedPreset = (loadPositions && Object.keys(loadPositions()).length > 0);
        if (usedPreset) {
            setTimeout(function() {
                if (window._ntCy) { window._ntCy.resize(); window._ntCy.fit(window._ntCy.nodes(), 40); }
            }, 300);
        }
    });

    // ── Click-Handler: Link-Modus, Highlight, Detail ───────────────────────
    cy.on('tap', 'node[!isGroup]', function(e) {
        // Internet-Wolke ist virtuell — keine Highlights, keine Detail-Panel
        if (e.target.data('_isInternet')) return;
        if (isLinkModeActive()) {
            const node = e.target;
            const first = getLinkFirst();
            if (!first) {
                setLinkFirst(node);
                node.style('underlay-color', '#3b82f6');
                node.style('underlay-opacity', 0.35);
                node.style('underlay-padding', 8);
                const bLinkBtn = document.getElementById('nt-btn-link');
                if (bLinkBtn) bLinkBtn.textContent = t('tech.link.targets');
                cy.nodes('[!isGroup]').forEach(function(n) {
                    if (n.id() !== node.id()) n.style('opacity', 0.25);
                });
            } else {
                if (first.id() === node.id()) { exitLinkMode(); return; }
                const s = first.id(), t = node.id();
                const eid  = 'ml_' + s + '_' + t;
                const eid2 = 'ml_' + t + '_' + s;
                if (!cy.getElementById(eid).length && !cy.getElementById(eid2).length) {
                    const ml = edgeLabel(cy, s, t);
                    cy.add({ data: { id: eid, source: s, target: t, tLabel: ml, trafficIn: 0, trafficOut: 0 }});
                    const lnks = loadLinks(); lnks.push({ s: s, t: t }); saveLinks(lnks);
                    node.style('opacity', 1);
                    node.style('underlay-color', '#22c55e');
                    node.style('underlay-opacity', 0.3);
                    node.style('underlay-padding', 6);
                    setTimeout(function() { node.style('underlay-opacity', 0); }, 600);
                }
            }
            return;
        }
        // Connected-Component-Highlight: Toggle bei erneutem Klick. Wenn aber
        // gerade ein BFS-Pfad gerendert ist (path-highlight.js), nicht dimmen
        // — die Klassen wuerden vom Inline-Style ueberschrieben und das
        // Pfad-Highlight kaputt machen.
        const clickedId = e.target.id();
        if (!isPathActive()) {
            if (getActiveHighlightId() === clickedId) {
                resetHighlight(cy);
            } else {
                applyHighlight(cy, clickedId);
            }
        }
        showDetail(pnl, e.target.data(), cy);
    });

    cy.on('mouseover', 'node[!isGroup]', function(e) {
        if (e.target.data('_isInternet')) return;
        showTip(e, e.target.data());
    });
    cy.on('mousemove', 'node[!isGroup]', function(e) { moveTip(e); });
    cy.on('mouseout',  'node[!isGroup]', function()  { hideTip(); });
    // Edge-Tooltip: Traffic-Sparkline beider Endpunkte. Internet-Edges
    // (Wolken-Uplinks) haben einen virtuellen Internet-Knoten — kein
    // Tooltip dafuer, ist nicht aussagekraeftig.
    cy.on('mouseover', 'edge', function(e) {
        const ed = e.target.data();
        if (ed._isInternetEdge) return;
        const src = e.target.source();
        const tgt = e.target.target();
        if (!src || !tgt) return;
        showEdgeTip(e, ed, src.data('label') || src.id(), tgt.data('label') || tgt.id());
    });
    cy.on('mousemove', 'edge', function(e) { moveTip(e); });
    cy.on('mouseout',  'edge', function()  { hideTip(); });
    cy.on('tap', function(e) {
        hideTip();
        if (e.target === cy) {
            if (pnl) pnl.style.display = 'none';
            hideCtx();
            resetHighlight(cy);
            clearPathState(cy);
        }
    });

    cy.on('cxttap', 'node[!isGroup]', function(e) {
        const oe = e.originalEvent;
        if (oe) oe.preventDefault();
        hideTip();
        // Internet-Wolke ist virtuell — kein Kontextmenü, keine Zabbix-Links
        if (e.target.data('_isInternet')) return;
        const pos = oe ? { x: oe.clientX, y: oe.clientY } : e.renderedPosition;
        showCtx(pos.x, pos.y, e.target.data());
    });

    // Mobile: Long-Press = selbe Aktion wie Rechtsklick. Cytoscape's taphold-
    // Event feuert auf Touch-Geräten wenn der Finger länger als
    // tapholdDuration auf einem Knoten liegt. Auf Desktop feuert es auch bei
    // gedrückter linker Maustaste — kein Problem, weil dort schon cxttap
    // (Rechtsklick) existiert und beide dasselbe Menü öffnen.
    cy.on('taphold', 'node[!isGroup]', function(e) {
        hideTip();
        if (e.target.data('_isInternet')) return;
        // Position aus touch oder original-event holen
        const oe = e.originalEvent;
        let cx, cy2;
        if (oe && oe.touches && oe.touches[0]) {
            cx = oe.touches[0].clientX; cy2 = oe.touches[0].clientY;
        } else if (oe && (oe.clientX !== undefined)) {
            cx = oe.clientX; cy2 = oe.clientY;
        } else {
            const r = e.renderedPosition; cx = r.x; cy2 = r.y;
        }
        showCtx(cx, cy2, e.target.data());
    });

    // ── Toolbar + Legende + Badge + Animation + Heatmap ────────────────────
    _setupToolbar(cy, wrap, nodes, groupNames, dark, useLayout);
    ensureBaseToolbar(wrap);
    setupLegend(groupNames, nodes);
    // Farbcode-Erklaerung unten im Canvas (einklappbar, was bedeuten die Farben)
    setupBottomLegend(wrap, dark);
    updateBadge(nodes);

    // Group-Hulls: nur wenn Cluster-Layout aktiv ist (sonst überlappen sich
    // die Hüllen bei verstreuten Knoten und sehen kaputt aus). Im Group-View
    // sowieso aus — dort ist jede Gruppe schon ein eigener Aggregat-Knoten.
    destroyGroupHulls(wrap);
    if (_useCluster) {
        setupGroupHulls(cy, wrap);
    }

    // History-Mode-Dimming: Hosts ohne Problem zur Cursor-Zeit ausgrauen.
    // _historyDimmed wird in network-topology.js applyHistoryOverrides gesetzt.
    nodes.forEach(function(n) {
        if (n._historyDimmed) {
            const cyNode = cy.getElementById(String(n.id));
            if (cyNode && cyNode.length) {
                cyNode.style('opacity', 0.25);
            }
        }
    });

    startEdgeAnimation(cy, nodes);
    setTimeout(function() { applyTrafficHeatmap(cy); applyPortLabels(cy); }, 1800);

    setupMinimap(cy, wrap);
    applyManualLinks(cy);
    showMinimap();

    // ── Pin/Note aus localStorage wiederherstellen ─────────────────────────
    (function() {
        const pinned = loadPinned();
        const notes  = loadNotes();
        if (!perfMode) clearImgCache();
        cy.nodes('[!isGroup]').forEach(function(n) {
            const isPinned = pinned.indexOf(n.id()) >= 0;
            const note     = notes[n.id()] || '';
            n.data('pinned', isPinned);
            n.data('note',   note);
            if (!perfMode) n.data('bgImage', makeNodeImage(n.data()));
            if (isPinned) n.lock();
        });
    })();

    // ── Drag → Position speichern (debounced) ──────────────────────────────
    cy.on('dragfree', 'node[!isGroup]', function() {
        clearTimeout(_posSaveTimer);
        _posSaveTimer = setTimeout(function() { savePositions(cy); }, 400);
    });

    // ── Auto-Refresh-Pause waehrend User-Aktion ────────────────────────────
    // Wenn der User gerade einen Knoten draggt, soll der 30s-Refresh-Timer
    // den Drag nicht zerstoeren. Window-Flag _ntDragActive blockiert den
    // Refresh waehrend Drag aktiv ist; Reset 1s nach dragfree damit die
    // Position-Speicherung sicher durch ist.
    cy.on('grab', 'node[!isGroup]', function() {
        window._ntDragActive = true;
    });
    cy.on('dragfree', 'node[!isGroup]', function() {
        clearTimeout(window._ntDragReleaseTimer);
        window._ntDragReleaseTimer = setTimeout(function() {
            window._ntDragActive = false;
        }, 1000);
    });

    // Nach automatischem Layout Position einmalig speichern
    cy.one('layoutstop', function() {
        setTimeout(function() {
            if (window._ntCy) {
                savePositions(window._ntCy);
                window._ntCy.fit(window._ntCy.nodes(), 40);
                applyTrafficHeatmap(window._ntCy);
                applyPortLabels(window._ntCy);
            }
        }, 800);
    });

    // ── Auto-Refresh (alle 30s) ────────────────────────────────────────────
    if (window._ntRefreshTimer) clearInterval(window._ntRefreshTimer);
    _clearRefreshWarn();   // frischer Render → Refresh-Fehler-Status zuruecksetzen
    window._ntRefreshTimer = setInterval(function() {
        if (window._ntRefreshOn === false || !window._ntCy) return;
        // Pause waehrend Drag — sonst zerlegt der Refresh den User-Workflow
        // (Position springt zurueck weil neue Daten alte Positionen ueberschreiben).
        if (window._ntDragActive) return;
        fetch(dataUrl, {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                // Backend-Fehler (data.error) oder leere Antwort → Badge zeigen,
                // letzten guten Stand behalten statt still zu ueberschreiben.
                if (!data || !data.nodes) { _markRefresh(false); return; }
                _markRefresh(true);
                window._ntLastData = window._ntLastData || {};
                window._ntLastData.nodes = data.nodes;
                window._ntLastData.edges = data.edges || [];
                window._ntLastData.lldp_quality = data.lldp_quality || [];
                notifyTopoChanges(data.topo_changes);
                // In Group-View komplett re-rendern (Aggregate können sich
                // strukturell ändern, In-Place-Update wäre fragil)
                let inGroupView = false;
                try { inGroupView = localStorage.getItem(NT_GROUP_VIEW_KEY) === '1'; } catch (e) {}
                if (inGroupView) {
                    render(wrap, data.nodes.slice(), (data.edges || []).slice(), dataUrl);
                    return;
                }
                const map = {};
                (data.nodes || []).forEach(function(n) { map[String(n.id)] = n; });
                if (!perfMode) clearImgCache();
                cy.nodes('[!isGroup]').forEach(function(node) {
                    const u = map[node.id()]; if (!u) return;
                    node.data('severity', u.severity || 0);
                    node.data('cpu', u.cpu);
                    node.data('memory', u.memory);
                    node.data('ping', u.ping);
                    node.data('traffic', u.traffic);
                    if (u.problems !== undefined) node.data('problems', u.problems);
                    // Defensive: nur überschreiben wenn der Refresh die Felder
                    // tatsächlich liefert. Sonst würde z.B. ein Backend-Hiccup
                    // den acked-Ring still verschwinden lassen.
                    if ('acknowledged' in u) node.data('acknowledged', !!u.acknowledged);
                    if ('maintenance'  in u) node.data('maintenance',  !!u.maintenance);
                    if ('extra_items'  in u) node.data('extra_items',  u.extra_items || []);
                    // Offline-Status mitziehen — das rote X (bgImage) und die
                    // Root-Cause-Analyse brauchen frische unavailable-Flags,
                    // sonst stimmen beide erst nach dem naechsten Voll-Render.
                    if ('unavailable'  in u) node.data('unavailable',  !!u.unavailable);
                    if ('down_since'   in u) node.data('down_since',   u.down_since || 0);
                    if ('last_seen'    in u) node.data('last_seen',    u.last_seen  || 0);
                    // Perf-Modus: nur die Severity-Farbe aktualisieren (kein SVG
                    // neu bauen); sonst das volle Node-Image.
                    if (perfMode) {
                        node.data('sevColor', node.data('unavailable') ? '#9ca3af'
                            : SEV_COL[Math.min(node.data('severity') || 0, SEV_COL.length - 1)]);
                    } else {
                        node.data('bgImage', makeNodeImage(node.data()));
                    }
                });
                updateBadge(data.nodes || []);
                window._ntCy && window._ntCy.edges('[id^="ml_"]').forEach(function(e) {
                    e.data('tLabel', edgeLabel(window._ntCy, e.source().id(), e.target().id()));
                });
                applyTrafficHeatmap(window._ntCy);
                // Laufende Ausfall-Simulation neu rechnen — der In-Place-
                // Update aendert zwar keine Edges, aber der Banner-Count
                // und die Klassen sollen den frischen Stand reflektieren.
                if (isSimActive()) recomputeSimulation(window._ntCy);
                // Aktive Root-Cause-Analyse mit frischen Offline-Flags neu
                // rechnen (nicht-verbose: keine Toast-Flut alle 30s).
                if (isRootCauseActive()) runRootCause(window._ntCy, false);
            })
            .catch(function() { _markRefresh(false); });   // Netz-/Parse-Fehler → Badge
    }, 30000);
}
