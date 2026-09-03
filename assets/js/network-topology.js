// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
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

import { esc, seiteIstDunkel } from './modules/utils.js';
import { installThemeVars } from './modules/theme.js';
import { t } from './modules/i18n.js';
import { toastTruncatedOnce, toast } from './modules/toast.js';
import { hideTip } from './modules/tooltip.js';
import { destroyGroupHulls } from './modules/group-hulls.js';
import { NT_TAB_KEY, loadLastGroups, saveLastGroups, loadPositions,
         setPositionErrorHandler, setPositionTruncatedHandler,
         setLinkTruncatedHandler, setConflictHandler } from './modules/storage.js';

// Positionen werden optimistisch gespeichert: die Karte reagiert sofort, der
// POST laeuft hinterher. Scheitert er, muss der Nutzer das erfahren — sonst
// haelt er eine Anordnung fuer gesichert, die beim naechsten Laden weg ist.
// Der Umweg ueber einen Handler haelt storage.js frei von Toast- und
// Uebersetzungswissen (dasselbe Muster wie bei den manuellen Links).
setPositionErrorHandler(function(err) {
    toast(t('positions.save_failed', { err: (err && err.message) || '?' }), 'error', 6000);
});

// Jemand anderes hat dieselbe Ebene zwischenzeitlich geaendert. Der Server hat
// NICHT geschrieben und schickt seinen aktuellen Stand mit; storage.js hat ihn
// beim Eintreffen uebernommen. Was fehlte, war der sichtbare Teil: die Karte
// zeigte weiter die abgelehnte Anordnung, waehrend die Meldung "nicht
// gespeichert" sagte. Der Nutzer musste ihr gegen den eigenen Bildschirm
// glauben — und die einzige Anweisung war "neu laden".
//
// Die Kanten macht manual-links.js schon selbst neu (ueber den Fehlerkanal);
// fuer die Positionen gab es keinen solchen Weg zurueck.
setConflictHandler(function(kind) {
    if (kind !== 'links') restoreSavedPositions();
    toast(t(kind === 'links' ? 'conflict.links' : 'conflict.positions'), 'warn', 12000);
});

// Holt die Karte auf den Stand, den storage.js gerade vom Server uebernommen
// hat. Bewusst nur ein Zurechtruecken, kein Re-Render: ein Render wuerde ueber
// layoutstop gleich wieder speichern und damit die naechste Runde ausloesen.
//
// Nur bewegen, was der Server auch kennt — ein frisch dazugekommener Host hat
// dort keine Position und bliebe sonst auf 0,0 liegen. Gepinnte Knoten sind
// gesperrt (n.lock()); ohne das kurze Entsperren ignoriert Cytoscape das
// Setzen und ausgerechnet die festgehaltenen Knoten blieben falsch stehen.
function restoreSavedPositions() {
    const cy = window._ntCy;
    if (!cy || typeof cy.nodes !== 'function') return;

    let pos;
    try { pos = loadPositions(); } catch (e) { return; }
    if (!pos || !Object.keys(pos).length) return;

    cy.batch(function() {
        cy.nodes('[!isGroup]').forEach(function(n) {
            const p = pos[String(n.id())];
            if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return;
            const war = n.locked();
            if (war) n.unlock();
            n.position({ x: p.x, y: p.y });
            if (war) n.lock();
        });
    });
}

// Die Karte hat mehr Knoten, als serverseitig pro Ansicht gespeichert werden.
// Ein Teil ist gesichert, der Rest nicht — das muss sichtbar sein, sonst
// fehlen beim naechsten Laden Positionen ohne erkennbaren Grund und es sieht
// nach Datenverlust aus statt nach einer Grenze.
setLinkTruncatedHandler(function(n) {
    toast(t('links.truncated', { n: n }), 'warn', 8000);
});
setPositionTruncatedHandler(function(n) {
    toast(t('positions.truncated', { n: n }), 'warn', 8000);
});
import { setResolveAggregateCallback } from './modules/context-menu.js';
import { setFocusRenderCallback } from './modules/focus-mode.js';
import { allowedTabs, setActiveTabGetter, setMgmtRerenderCallback, ensureBaseToolbar,
         setGraphToolbarVisible } from './modules/tabs.js';
import { renderTable, cleanupTable } from './modules/render-table.js';
import { renderManagement } from './modules/render-mgmt.js';
import { render, setSetupToolbarCallback } from './modules/render-tech.js';
import { renderGeo, cleanupGeo } from './modules/render-geo.js';
import { renderDiag } from './modules/render-diag.js';
import { renderHealth } from './modules/render-health.js';
import { renderStats } from './modules/render-stats.js';
import { renderCompliance } from './modules/render-compliance.js';
import { renderLldpQuality } from './modules/render-lldp-quality.js';
import { notifyTopoChanges } from './modules/topo-notify.js';
import { setupToolbar, setRenderCallback as setToolbarRenderCallback } from './modules/toolbar.js';
import { applyColorScales } from './modules/traffic.js';
import { setRenderCallback as setPresetsRenderCallback } from './modules/presets-ui.js';
import { setHistoryRenderCallback, getHistorySeverities, isHistoryActive, setLiveRefreshHooks } from './modules/history-mode.js';

// ── Tab-State ──────────────────────────────────────────────────────────────
// Lebt im Hauptmodul, wird via Getter an tabs.js gereicht. Persistenz im
// User-scoped localStorage.
// Welche Tabs gueltig sind, sagt tabs.js — dort stehen sie ohnehin, samt der
// Rechtepruefung (compliance >= Admin, diag === Super-Admin). Eine zweite Liste
// hier war genau die Luecke: sie fuehrte beide OHNE Pruefung, also oeffnete
// "?nt_tab=diag" einem Nutzer ohne Rechte eine Ansicht ohne Knopf zum
// Verlassen — und switchTab schrieb sie ihm zusaetzlich in den localStorage.
const NT_TAB_PARAM = 'nt_tab';

// Reihenfolge: URL vor localStorage.
//
// Der Tab lag bisher NUR im localStorage — also im Browser des Betrachters,
// nicht im Link. Wer eine URL zur Compliance-Ansicht verschickte, schickte
// faktisch "oeffne den Tab, den du zuletzt offen hattest". Damit war keine
// Ansicht teilbar, obwohl Hostgruppen, Tabellenfilter und (mit hostid/hops)
// die Host-Auswahl laengst in der URL stehen.
//
// localStorage bleibt als Rueckfall: wer die Seite ohne Parameter aufruft,
// landet weiterhin dort, wo er zuletzt war.
let _activeTab = 'tech';
// Auch der localStorage wird geprueft, nicht nur die URL: wer einmal auf einem
// Tab gelandet ist, den er nicht oeffnen darf, haette ihn sonst dauerhaft
// gespeichert. Getrennte try-Bloecke, damit ein Fehler im einen den anderen
// nicht ueberspringt.
try {
    const _erlaubt = allowedTabs();
    try {
        const _ls = localStorage.getItem(NT_TAB_KEY);
        if (_ls && _erlaubt.indexOf(_ls) >= 0) _activeTab = _ls;
    } catch (e) {}
    try {
        const _p = new URL(window.location.href).searchParams.get(NT_TAB_PARAM);
        if (_p && _erlaubt.indexOf(_p) >= 0) _activeTab = _p;
    } catch (e) {}
} catch (e) {}

// ── Cross-Module-Glue (Callback-Registrierung) ─────────────────────────────
// Diese Callbacks vermeiden zirkuläre Imports: das jeweils tiefere Modul ruft
// nicht direkt das höhere, sondern bekommt die Referenz hier injiziert.

// "Aggregat auflösen" aus dem Kontextmenü → kompletter Re-Render
setResolveAggregateCallback(function() {
    const dd = window._ntLastData || {};
    const wrap = document.getElementById('nt-canvas-wrap');
    if (wrap && dd.nodes) render(wrap, dd.nodes.slice(), (dd.edges || []).slice(), dd.url || '');
});

// Per-host focus (set/change/end) → full re-render; the filter itself runs
// inside render(). Tech tab only: the ESC handler is global, and ending the
// focus from another tab must not render the map into that tab's wrap — the
// state is gone regardless, the next tech render shows the full map.
setFocusRenderCallback(function() {
    if (_activeTab !== 'tech') return;
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
    // Einen evtl. noch offenen Node-/Edge-Tooltip wegraeumen: das cytoscape-
    // mouseout feuert NICHT, wenn der Graph unter dem Cursor verschwindet (Klick
    // direkt auf einen Tab-Button) → der Tooltip blieb sonst ueber dem neuen Tab
    // haengen (z.B. Host-Tooltip auf dem Health-Tab).
    hideTip();
    // Wenn wir den Geo-Tab verlassen, Leaflet-Map sauber abbauen
    // (sonst Memory-Leak durch hängende Event-Listener).
    if (_activeTab === 'geo' && tab !== 'geo') {
        cleanupGeo();
    }
    // Wenn wir den Tabellen-Tab verlassen, Detail-Panel-Container aus body entfernen
    if (_activeTab === 'tree' && tab !== 'tree') {
        cleanupTable();
    }
    // Beim Verlassen des Technical-Tabs die Group-Hull-SVG + deren ResizeObserver
    // abbauen — sonst feuert der Observer weiter gegen ein zerstoertes cy.
    if (_activeTab === 'tech' && tab !== 'tech') {
        destroyGroupHulls();
    }
    _activeTab = tab;
    try { localStorage.setItem(NT_TAB_KEY, tab); } catch (e) {}
    // Den Tab in die Adresszeile schreiben, damit ein kopierter Link die
    // Ansicht mitbringt. replaceState statt pushState: jeder Tabwechsel wuerde
    // sonst einen History-Eintrag anlegen, und der Zurueck-Knopf muesste sich
    // erst durch acht Tabs arbeiten, bevor er die Seite verlaesst.
    try {
        const _u = new URL(window.location.href);
        _u.searchParams.set(NT_TAB_PARAM, tab);
        window.history.replaceState(null, '', _u.toString());
    } catch (e) {}
    // History-Severities anwenden falls History-Mode aktiv
    applyHistoryOverrides(nodes);
    if      (tab === 'mgmt')   renderManagement(wrap, nodes, edges);
    else if (tab === 'tree')   renderTable(wrap, nodes, edges);
    else if (tab === 'geo')    renderGeo(wrap, nodes, edges, dataUrl);
    else if (tab === 'diag')   renderDiag(wrap);
    else if (tab === 'health') renderHealth(wrap, nodes);
    else if (tab === 'stats')      renderStats(wrap, nodes);
    else if (tab === 'compliance') renderCompliance(wrap);
    else if (tab === 'lldpq')      renderLldpQuality(wrap);
    else                           render(wrap, nodes, edges, dataUrl);
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
    // Activate the admin color scales BEFORE the first render — otherwise the
    // first heatmap paints with defaults and the colors jump on the next pass.
    applyColorScales(cfg.color_scales || null);
    // Dunkelmodus aus Zabbix uebernehmen — VOR dem ersten Render.
    //
    // Die Klasse 'nt-dark' auf #nt-root ist die Schaltstelle, die es im Modul
    // laengst gibt: sechzehn Module fragen sie ab und haben ihre dunklen
    // Farbwerte fertig daliegen. Sie wurde nur nie gesetzt, seit der eigene
    // Umschalter entfernt wurde (siehe tabs.js) — die ganze Abstraktion lief
    // damit dauerhaft gegen false.
    //
    // Hier haengt sie jetzt an Zabbix. Kein eigener Schalter, keine zweite
    // Einstellung, die auseinanderlaufen kann: wer sein Zabbix dunkel stellt,
    // bekommt die Karte dunkel. Das Modul hat dazu keine eigene Meinung mehr.
    //
    // Entschieden wird an der GEMESSENEN Hintergrundfarbe, nicht am Namen des
    // Themes (siehe seiteIstDunkel). Der Name vom Server ist nur der Rueckfall,
    // wenn sich nichts messen laesst — er kennt weder das neue dunkle Theme aus
    // Zabbix 8.0 noch selbst ausgeliefertes Theme-CSS.
    //
    // Vor dem ersten Render, nicht danach: sonst zeichnet der erste Durchgang
    // hell und springt beim naechsten um.
    installThemeVars();
    const ntRoot = document.getElementById('nt-root');
    if (ntRoot) ntRoot.classList.toggle('nt-dark', seiteIstDunkel(cfg.dark));

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

    // Basis-Toolbar (Tabs) initial bauen — idempotent.
    ensureBaseToolbar(wrap);

    // Host+hops mode: a selected host replaces the group selection as the
    // data scope. Guard the group auto-restore below — it would redirect and
    // silently drop the hostid from the URL.
    const hostMode = !!cfg.selected_hostid;

    if (!hostMode && (!cfg.selected_groupids || !cfg.selected_groupids.length)) {
        // Keine Gruppen ausgewählt — versuche die letzte Auswahl wiederherzustellen.
        // Wenn vorhanden: URL ergänzen und reload, damit das PHP-Backend die
        // Hostgroups validiert und das Multiselect korrekt vorbefüllt.
        const lastGroups = loadLastGroups();
        // Marker _ntr: verhindert eine Reload-Schleife. Hat der User zu einer
        // gespeicherten Gruppe die Permission verloren, strippt das Backend sie
        // wieder → selected_groupids leer → ohne Marker wieder Auto-Restore →
        // reload → endlos. Wir versuchen den Restore genau EINMAL pro Kette.
        const _restoreTried = new URL(window.location.href).searchParams.has('_ntr');
        if (lastGroups && lastGroups.length && !_restoreTried) {
            const u = new URL(window.location.href);
            // Bestehende groupids[]-Params (gibt's hier definitionsgemäß nicht,
            // aber sicher ist sicher) und ggf. action ungetastet lassen
            u.searchParams.delete('groupids[]');
            lastGroups.forEach(function(id) { u.searchParams.append('groupids[]', id); });
            u.searchParams.set('_ntr', '1');
            window.location.replace(u.toString());
            return;
        }
        if (spin) spin.innerHTML = '<span style="color:#64748b">'
            + esc(t('app.pick_groups')) + '</span>';
        return;
    }

    // saveLastGroups wird erst NACH erfolgreichem Fetch aufgerufen, sonst
    // persistieren wir Auswahlen für die der User keine Daten kriegt
    // (z.B. nach Permission-Entzug) — die würden beim nächsten Page-Load
    // via Auto-Restore wieder zur leeren Karte führen.

    if (spin) spin.innerHTML = '<span style="color:#64748b">' + esc(t('app.loading')) + '</span>';

    // Daten holen und initial rendern
    const params = new URLSearchParams();
    if (hostMode) {
        params.append('hostid', cfg.selected_hostid);
        params.append('hops', String(cfg.hops || 1));
    } else {
        cfg.selected_groupids.forEach(function(id) { params.append('groupids[]', id); });
    }
    const url = cfg.data_url + '&' + params;
    fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            spin.style.display = 'none';
            // Das Backend hat die Gruppenauswahl gekappt (MAX_GROUPS). Sichtbar
            // machen, statt ein unvollstaendiges Bild als vollstaendig zu zeigen
            // — warnt pro Zahlenpaar nur einmal, sonst nervt der 30s-Refresh.
            if (data.truncated) {
                toastTruncatedOnce('data:' + data.requested_count + '/' + data.processed_count,
                    t('warn.truncated', {
                        requested: data.requested_count,
                        processed: data.processed_count
                    }));
            }
            // lldp_quality mit durchreichen — der LLDP-Q-Tab liest es aus
            // _ntLastData (ohne dieses Feld waere der Tab immer leer).
            window._ntLastData = { nodes: data.nodes || [], edges: data.edges || [],
                                   lldp_quality: data.lldp_quality || [], url: url };
            notifyTopoChanges(data.topo_changes);
            switchTab(_activeTab, wrap, data.nodes || [], data.edges || [], url);

            // Letzte Auswahl persistieren — nur wenn der Fetch tatsächlich
            // Hosts geliefert hat. Sonst speichern wir eine "tote" Auswahl
            // (z.B. weil Permissions entzogen wurden) und der User bleibt
            // beim nächsten Page-Load in einer leeren Karte hängen.
            // Not in host mode: the group selection was not what got rendered,
            // and a host view is not something to auto-restore into.
            if (!hostMode && data.nodes && data.nodes.length > 0) {
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
            spin.innerHTML = '<span style="color:#ef4444">' + esc(t('app.error', { msg: err.message })) + '</span>';
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
