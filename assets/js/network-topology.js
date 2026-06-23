// network-topology.js — Entry-Point (ES Module).
//
// Reiner Orchestrator:
//   1. Lädt alle Module
//   2. Registriert Cross-Module-Callbacks (vermeidet zirkuläre Imports)
//   3. Definiert init() und switchTab() — der gesamte Render-Code lebt in
//      den Submodulen modules/render-{tech,mgmt,tree}.js
//   4. Stellt window._ntInit und window.switchTab für externe Aufrufer bereit
//
// Geschichte: Diese Datei war einmal 2025 Zeilen. In fünf Refactor-Sessions
// (v3.6 → v4.0) wurde sie auf eine reine Orchestrierungs-Schicht reduziert.

import { esc } from './modules/utils.js';
import { NT_TAB_KEY, loadLastGroups, saveLastGroups } from './modules/storage.js';
import { setResolveAggregateCallback } from './modules/context-menu.js';
import { setActiveTabGetter, setMgmtRerenderCallback, ensureBaseToolbar,
         setGraphToolbarVisible } from './modules/tabs.js';
import { renderTable, cleanupTable } from './modules/render-table.js';
import { renderManagement } from './modules/render-mgmt.js';
import { render, setSetupToolbarCallback } from './modules/render-tech.js';
import { renderGeo, cleanupGeo } from './modules/render-geo.js';
import { renderDiag } from './modules/render-diag.js';
import { setupToolbar, setRenderCallback as setToolbarRenderCallback } from './modules/toolbar.js';
import { setRenderCallback as setPresetsRenderCallback } from './modules/presets-ui.js';
import { setHistoryRenderCallback, getHistorySeverities, isHistoryActive, setLiveRefreshHooks } from './modules/history-mode.js';

// ── Tab-State ──────────────────────────────────────────────────────────────
// Lebt im Hauptmodul, wird via Getter an tabs.js gereicht. Persistenz im
// User-scoped localStorage.
let _activeTab = 'tech';
try { _activeTab = localStorage.getItem(NT_TAB_KEY) || 'tech'; } catch (e) {}

// ── Cross-Module-Glue (Callback-Registrierung) ─────────────────────────────
// Diese Callbacks vermeiden zirkuläre Imports: das jeweils tiefere Modul ruft
// nicht direkt das höhere, sondern bekommt die Referenz hier injiziert.

// "Aggregat auflösen" aus dem Kontextmenü → kompletter Re-Render
setResolveAggregateCallback(function() {
    const dd = window._ntLastData || {};
    const wrap = document.getElementById('nt-canvas-wrap');
    if (wrap && dd.nodes) render(wrap, dd.nodes.slice(), (dd.edges || []).slice(), dd.url || '');
});

// tabs.js braucht den aktiven Tab
setActiveTabGetter(function() { return _activeTab; });

// Dark-Mode-Wechsel im Mgmt-Tab → komplettes Re-Render der Kacheln
setMgmtRerenderCallback(function() {
    const d = window._ntLastData || {};
    const wrap = document.getElementById('nt-canvas-wrap');
    if (wrap) renderManagement(wrap, d.nodes || [], d.edges || []);
});

// render-tech.js → setupToolbar (zirkulär, daher Callback)
setSetupToolbarCallback(function(cy, wrap, nodes, groupNames, isDark, useLayout) {
    setupToolbar(cy, wrap, nodes, groupNames, isDark, useLayout);
});

// toolbar.js (Group-View-Toggle) → render() (ebenfalls zirkulär)
setToolbarRenderCallback(render);
// presets-ui.js (Preset-Wechsel) → render() (ebenfalls zirkulär)
setPresetsRenderCallback(render);

// ── Globaler State ─────────────────────────────────────────────────────────
// Auto-Refresh-On wird zwischen render-tech.js (Loop) und toolbar.js (Toggle)
// geteilt — daher window-Scope.
window._ntRefreshOn = (window._ntRefreshOn === undefined) ? true : window._ntRefreshOn;

// History-Override: Wenn der History-Mode aktiv ist, ersetzen wir vor jedem
// Tab-Render die Live-Severity/Probleme der Hosts mit den Werten zur
// gewählten Cursor-Zeit. Die ursprünglichen Werte werden in _liveSeverity
// gesichert damit beim Verlassen des History-Mode wieder die Live-Daten da sind.
function applyHistoryOverrides(nodes) {
    if (!nodes) return;
    if (isHistoryActive()) {
        const sevs = getHistorySeverities() || {};
        nodes.forEach(function(n) {
            if (n._liveSeverity === undefined) n._liveSeverity = n.severity || 0;
            if (n._liveProblems === undefined) n._liveProblems = n.problems || 0;
            const newSev = sevs[String(n.id)] || 0;
            n.severity = newSev;
            n.problems = newSev > 0 ? 1 : 0;   // wir wissen nicht die genaue Anzahl
            n._historyDimmed = newSev === 0;   // Flag für Render: ausgrauen
        });
    } else {
        // Verlassen — Live-Werte zurück
        nodes.forEach(function(n) {
            if (n._liveSeverity !== undefined) {
                n.severity = n._liveSeverity;
                delete n._liveSeverity;
            }
            if (n._liveProblems !== undefined) {
                n.problems = n._liveProblems;
                delete n._liveProblems;
            }
            delete n._historyDimmed;
        });
    }
}

// ── Tab-Switch ─────────────────────────────────────────────────────────────
function switchTab(tab, wrap, nodes, edges, dataUrl) {
    // Wenn wir den Geo-Tab verlassen, Leaflet-Map sauber abbauen
    // (sonst Memory-Leak durch hängende Event-Listener).
    if (_activeTab === 'geo' && tab !== 'geo') {
        cleanupGeo();
    }
    // Wenn wir den Tabellen-Tab verlassen, Detail-Panel-Container aus body entfernen
    if (_activeTab === 'tree' && tab !== 'tree') {
        cleanupTable();
    }
    _activeTab = tab;
    try { localStorage.setItem(NT_TAB_KEY, tab); } catch (e) {}
    // History-Severities anwenden falls History-Mode aktiv
    applyHistoryOverrides(nodes);
    if      (tab === 'mgmt') renderManagement(wrap, nodes, edges);
    else if (tab === 'tree') renderTable(wrap, nodes, edges);
    else if (tab === 'geo')  renderGeo(wrap, nodes, edges, dataUrl);
    else if (tab === 'diag') renderDiag(wrap);
    else                     render(wrap, nodes, edges, dataUrl);
    ensureBaseToolbar(wrap);
    // Graph-spezifische Toolbar-Buttons (Layout/Cluster/Zoom/Fit/Hide-Labels/
    // LLDP/Link/Presets/Sev-Filter/Suche) nur im Tech-Tab anzeigen — andere
    // Tabs haben kein Cytoscape und brauchen die Buttons nicht.
    setGraphToolbarVisible(tab === 'tech');
}
window.switchTab = switchTab;

// History-Mode → Re-Render-Hook: history-mode ruft das auf wenn sich die
// Cursor-Zeit ändert oder der Mode verlassen wird. Wir rendern den aktiven
// Tab mit den (ggf. neuen) History-Severities neu.
setHistoryRenderCallback(function() {
    const d = window._ntLastData;
    if (!d || !d.nodes) return;
    switchTab(_activeTab, document.getElementById('nt-canvas-wrap'),
              d.nodes, d.edges || [], d.url || '');
});

// Live-Refresh-Pause während History-Mode aktiv ist — sonst würde der
// 30s-Auto-Refresh die History-Severities mit Live-Daten überschreiben.
let _refreshSavedState = null;
setLiveRefreshHooks(
    function pause() {
        _refreshSavedState = window._ntRefreshOn;
        window._ntRefreshOn = false;
    },
    function resume() {
        if (_refreshSavedState !== null) {
            window._ntRefreshOn = _refreshSavedState;
            _refreshSavedState = null;
        }
    }
);

// ── Init ───────────────────────────────────────────────────────────────────
function init() {
    const cfg = window.NT_CONFIG;
    if (!cfg) return;
    const wrap = document.getElementById('nt-canvas-wrap');
    const spin = document.getElementById('nt-loading');

    // Canvas-Höhe an verfügbaren Viewport-Platz anpassen
    function fixHeight() {
        const root = document.getElementById('nt-root');
        if (!root) return;
        const top = root.getBoundingClientRect().top;
        const h = window.innerHeight - top - 8;
        if (h > 300) root.style.height = h + 'px';
    }
    fixHeight();
    window.addEventListener('resize', function() {
        fixHeight();
        if (window._ntCy) {
            window._ntCy.resize();
            window._ntCy.fit(window._ntCy.nodes(), 40);
        }
    });

    // Basis-Toolbar (Tabs + Dark-Button) initial bauen — idempotent.
    ensureBaseToolbar(wrap);

    if (!cfg.selected_groupids || !cfg.selected_groupids.length) {
        // Keine Gruppen ausgewählt — versuche die letzte Auswahl wiederherzustellen.
        // Wenn vorhanden: URL ergänzen und reload, damit das PHP-Backend die
        // Hostgroups validiert und das Multiselect korrekt vorbefüllt.
        const lastGroups = loadLastGroups();
        if (lastGroups && lastGroups.length) {
            const u = new URL(window.location.href);
            // Bestehende groupids[]-Params (gibt's hier definitionsgemäß nicht,
            // aber sicher ist sicher) und ggf. action ungetastet lassen
            u.searchParams.delete('groupids[]');
            lastGroups.forEach(function(id) { u.searchParams.append('groupids[]', id); });
            window.location.replace(u.toString());
            return;
        }
        if (spin) spin.innerHTML = '<span style="color:#64748b">'
            + '&#8592; Bitte Host-Gruppen w\u00E4hlen und Apply klicken.</span>';
        return;
    }

    // saveLastGroups wird erst NACH erfolgreichem Fetch aufgerufen, sonst
    // persistieren wir Auswahlen für die der User keine Daten kriegt
    // (z.B. nach Permission-Entzug) — die würden beim nächsten Page-Load
    // via Auto-Restore wieder zur leeren Karte führen.

    if (spin) spin.innerHTML = '<span style="color:#64748b">Lade Topologie...</span>';

    // Daten holen und initial rendern
    const params = new URLSearchParams();
    cfg.selected_groupids.forEach(function(id) { params.append('groupids[]', id); });
    const url = cfg.data_url + '&' + params;
    fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            spin.style.display = 'none';
            window._ntLastData = { nodes: data.nodes || [], edges: data.edges || [], url: url };
            switchTab(_activeTab, wrap, data.nodes || [], data.edges || [], url);

            // Letzte Auswahl persistieren — nur wenn der Fetch tatsächlich
            // Hosts geliefert hat. Sonst speichern wir eine "tote" Auswahl
            // (z.B. weil Permissions entzogen wurden) und der User bleibt
            // beim nächsten Page-Load in einer leeren Karte hängen.
            if (data.nodes && data.nodes.length > 0) {
                saveLastGroups(cfg.selected_groupids);
            }

            // Wallboard-Mode: alle 30s Tab-Wechsel zwischen Tech und Geo,
            // damit auf dem Büro-Monitor abwechselnd beide Sichten zu sehen
            // sind. Geomap nur einbinden wenn überhaupt Hosts mit Geo-Koordinaten
            // existieren — sonst bleibt der Wechsel auf Tech.
            if (cfg.wallboard) {
                const hasGeoHosts = (data.nodes || []).some(function(n) {
                    return typeof n.lat === 'number' && typeof n.lon === 'number';
                });
                if (hasGeoHosts) {
                    setInterval(function() {
                        const next = _activeTab === 'tech' ? 'geo' : 'tech';
                        const ld = window._ntLastData || {};
                        switchTab(next, wrap, ld.nodes || [], ld.edges || [], ld.url || url);
                    }, 30000);
                }
            }
        })
        .catch(function(err) {
            spin.innerHTML = '<span style="color:#ef4444">Error: ' + esc(err.message) + '</span>';
        });
}
window._ntInit = init;

// ── Bootstrap ──────────────────────────────────────────────────────────────
// ES Modules werden mit defer-Semantik geladen — DOM ist also fertig.
// Single-Execution-Guard schützt vor Mehrfach-Init.
if (!window._ntInitStarted) {
    window._ntInitStarted = true;
    init();
}
