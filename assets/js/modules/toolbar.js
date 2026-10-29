// toolbar.js — Toolbar für den Tech-Tab.
//
// Baut alle Cytoscape-spezifischen Buttons: Zoom, Labels, Fullscreen, Fit,
// Layout, Group-View, Auto-Refresh, LLDP, Link/Unlink, Export, Mail
// und Such-Input. Wird beim render() aufgerufen, ist idempotent durch das
// _ntToolbarDone-Flag (gleiche Buttons werden nicht doppelt angelegt).
//
// Sub-Module für eigenständige Toolbar-Bereiche:
//   - presets-ui.js: Layout-Preset-Verwaltung
//   - sev-filter.js: Severity-Filter-Pills
//
// Cross-Module-Glue:
//   - render() wird für den Group-View-Toggle gebraucht; das wäre eine
//     Zirkulardependenz (render-tech.js → toolbar.js → render-tech.js).
//     Lösung: setRenderCallback() injiziert die render-Funktion vom Hauptmodul.

import { loadGroupOpen, saveGroupOpen } from './storage.js';
import { NT_LLDP_KEY, NT_WEATHERMAP_KEY, NT_LINKQUALITY_KEY, NT_GROUP_VIEW_KEY, NT_GROUP_CLUSTER_KEY, NT_PERF_KEY,
    isGroupViewEffective,
         loadGhostMode, saveGhostMode,
         loadBundleMode, saveBundleMode,
         clearPositions, savePositions, savePinned, clearLinks, defaultLinkScope,
         loadLayout, saveLayout,
         loadNodeSize, saveNodeSize, nextNodeSize, nodeSizeFactor,
         loadRings, saveRings, loadExpected, saveExpected,
         loadVlanFilter, saveVlanFilter,
         loadTapholdMs, saveTapholdMs } from './storage.js';
import { buildCytoscapeStyle } from './render-tech-style.js';
import { refreshKpi } from './kpi.js';
import { applyRings, clearRings } from './rings.js';
import { applyExpected, clearExpected } from './expected-links.js';
import { collectVlans, applyVlanFilter, clearVlanFilter } from './vlan-filter.js';
import { resetHighlight } from './highlight.js';
import { isPathActive, getPathStart, clearPathState } from './path-highlight.js';
import { isSimActive, clearSimulation } from './whatif.js';
import { isFocusActive, clearFocus } from './focus-mode.js';
import { setWeathermapMode, setLinkQualityMode, applyTrafficHeatmap } from './traffic.js';
import { refreshBottomLegend } from './legend.js';
import { refreshLabel } from './utils.js';
import { openColorScalesPanel } from './color-scales-ui.js';
import { portLabelsOn, setPortLabels, applyPortLabels } from './port-labels.js';
import { allLinksOn, setAllLinks, applyBundleView } from './parallel-links.js';
import { collapseLeaves, expandLeaves, isCollapsed, collapseLabel,
         setCollapsePref, onCollapseChanged } from './collapse-leaves.js';
import { isRootCauseActive, clearRootCause, toggleRootCause } from './root-cause.js';
import { t } from './i18n.js';
import { toast } from './toast.js';
import { parseQuery, matchQuery, nodeToQueryFields } from './query.js';
import { isLinkModeActive, enterLinkMode, exitLinkMode } from './manual-links.js';
import { setupExportMenu } from './export.js';
import { setupFdbFinder } from './fdb-finder.js';
import { addHistoryButton } from './history-mode.js';
import { LAYOUT_OPTIONS, buildLayoutConfig } from './layouts.js';
import { setupPresetsUI } from './presets-ui.js';
import { buildSevFilter } from './sev-filter.js';
import { runGroupClusterLayout } from './group-cluster-layout.js';
import { configureLayoutHistory, recordBefore, undoLayout, redoLayout,
         canUndo, canRedo } from './layout-history.js';

// Cross-Module-Glue: render() wird aus dem Hauptmodul/render-tech.js injiziert,
// damit der Group-View-Button einen Re-Render triggern kann.
let _renderFn = function() {};
export function setRenderCallback(fn) { _renderFn = fn; }


// Handle auf den document-Listener des Layout-Menues, damit der naechste
// Aufbau den vorigen abmelden kann (siehe unten).
let _layoutDocClose = null;
let _vlanDocClose = null;

export function setupToolbar(cy, wrap, nodes, groupNames, isDark, useLayout) {
    const bar = document.querySelector('.nt-topbar__actions');
    const isFirstRun = !window._ntToolbarDone;
    window._ntToolbarDone = true;

    // Die Tabs werden von ensureBaseToolbar() gemanagt — hier nur
    // tech-spezifische Buttons.
    function mkbtn(id, lbl, fn) {
        const existing = id ? document.getElementById(id) : null;
        if (existing) {
            // Wiederverwenden, aber alte Event-Listener abwerfen: cloneNode kopiert
            // KEINE Handler. Sonst haengt jeder Toolbar-Neuaufbau (der Perf-Toggle
            // macht einen vollen Re-Render) einen WEITEREN Click-Handler an denselben
            // Button -> der Toggle feuert mehrfach und bleibt haengen ("nur-an"-Bug).
            const clone = existing.cloneNode(true);
            existing.replaceWith(clone);
            if (fn) clone.addEventListener('click', fn);
            return clone;
        }
        const b = document.createElement('button');
        b.className = 'btn-alt btn-small';
        b.style.marginLeft = '4px';
        b.textContent = lbl;
        if (id) b.id = id;
        if (fn) b.addEventListener('click', fn);
        if (bar && isFirstRun) bar.appendChild(b);
        return b;
    }

    // Zoom-Buttons (existieren statisch im DOM)
    //
    // onclick = null ENTFERNT KEINEN addEventListener-Handler. Genau das stand
    // hier, und setupToolbar laeuft bei JEDEM Render — render-tech setzt
    // _ntToolbarDone vorher auf false zurueck. Nach drei Umschaltvorgaengen
    // (Gruppenansicht, Perf, Geister) hingen vier Handler am "+", drei davon
    // mit einer Closure auf Cytoscape-Instanzen, die laengst destroy()'t
    // waren. Jeder Render behielt so einen kompletten Graphen im Speicher.
    //
    // Der Weg, den mkbtn weiter oben schon geht: das Element ersetzen. Ein
    // Klon traegt keine Listener, und die statischen Knoepfe aus der View
    // lassen sich nicht wie die erzeugten einfach neu bauen.
    const zoomBtn = function (id, faktor) {
        const alt_ = document.getElementById(id);
        if (!alt_) return;
        const neu_ = alt_.cloneNode(true);
        alt_.parentNode.replaceChild(neu_, alt_);
        neu_.addEventListener('click', function() {
            cy.zoom({ level: cy.zoom() * faktor,
                      renderedPosition: { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 } });
        });
    };
    zoomBtn('nt-btn-zoom-in',  1.3);
    zoomBtn('nt-btn-zoom-out', 0.77);

    // Hide Labels
    const bLbl = document.getElementById('nt-btn-labels');
    if (bLbl) bLbl.onclick = function() {
        const hide = this.dataset.hidden !== '1';
        cy.nodes('[!isGroup]').style('label', hide ? '' : 'data(label)');
        this.dataset.hidden = hide ? '1' : '0';
        this.textContent = hide ? t('toolbar.labels.show') : t('toolbar.labels.hide');
    };

    // Fullscreen
    // Die Beschriftung wird NICHT mehr optimistisch umgestellt.
    //
    // Vorher setzte der Klick sofort "Exit Fullscreen" und rief requestFullscreen()
    // ohne die Promise anzufassen. Lehnt Chrome ab — beobachtet mit
    // "TypeError: not granted" —, dann passiert dreierlei auf einmal: das Vollbild
    // kommt nicht, die Konsole bekommt eine unbehandelte Rejection, und der Knopf
    // behauptet, man sei drin. Der naechste Klick ruft dann exitFullscreen() auf
    // nichts. Von aussen sieht das aus wie "Fullscreen ist kaputt", ohne jeden
    // Hinweis worauf.
    //
    // Jetzt: Promise abwarten, Beschriftung ausschliesslich ueber den
    // fullscreenchange-Listener unten fuehren (der laeuft auch, wenn der User mit
    // Esc rausgeht), und eine Ablehnung sichtbar melden statt sie zu verschlucken.
    const bFs = document.getElementById('nt-btn-fullscreen');
    if (bFs) bFs.addEventListener('click', function() {
        const root = document.getElementById('nt-root');
        const drin = !!(document.fullscreenElement || document.webkitFullscreenElement);
        try {
            if (!drin) {
                const fn = root.requestFullscreen || root.webkitRequestFullscreen;
                if (!fn) { toast(t('toolbar.fullscreen.unsupported'), 'warn', 6000); return; }
                const p = fn.call(root);
                if (p && typeof p.catch === 'function') {
                    p.catch(function(err) {
                        toast(t('toolbar.fullscreen.denied', {
                            err: (err && err.message) || '?'
                        }), 'warn', 8000);
                    });
                }
            } else {
                const fn = document.exitFullscreen || document.webkitExitFullscreen;
                if (fn) {
                    const p = fn.call(document);
                    if (p && typeof p.catch === 'function') { p.catch(function() {}); }
                }
            }
        } catch (err) {
            toast(t('toolbar.fullscreen.denied', { err: (err && err.message) || '?' }), 'warn', 8000);
        }
    });
    // Fullscreen-Toggle aendert die Canvas-Groesse, aber Cytoscape bekommt
    // das nicht selbst mit — ohne expliziten cy.resize() + cy.fit() rutschen
    // Nodes aus dem sichtbaren Bereich. Listener nur einmal pro Page anhaengen
    // (idempotent ueber Window-Flag, damit Re-Render-Pfade nicht stapeln).
    if (!window._ntFsListenerInstalled) {
        window._ntFsListenerInstalled = true;
        const _onFsChange = function() {
            // 100ms Verzoegerung: Browser braucht einen Tick um die neue
            // Canvas-Groesse zu applizieren bevor cy.resize() korrekte Werte sieht.
            setTimeout(function() {
                if (window._ntCy && !window._ntCy.destroyed()) {
                    window._ntCy.resize();
                    window._ntCy.fit(window._ntCy.nodes(), 40);
                }
            }, 100);
            // Fullscreen-Button-Label sync (wichtig wenn User mit Esc statt
            // Button rauswechselt — sonst behaelt der Button "Exit Fullscreen").
            if (bFs) {
                const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
                bFs.textContent = inFs ? t('toolbar.fullscreen.exit') : t('toolbar.fullscreen');
            }
        };
        document.addEventListener('fullscreenchange', _onFsChange);
        document.addEventListener('webkitfullscreenchange', _onFsChange);
    }

    // Fit
    const bReset = mkbtn('nt-btn-reset', t('toolbar.fit'), null);
    bReset.addEventListener('click', function() {
        // NUR die Ansicht, kein Speichern. Hier stand ein savePositions() mit
        // dem Kommentar "sicherheitshalber nochmal speichern" — es konnte
        // nichts speichern: fit() aendert Zoom und Pan, die Knotenpositionen
        // ruehrt es nicht an (an der Bibliothek nachgemessen). Was es tat, war
        // eine ueberfluessige Serverfahrt pro Klick ausloesen, und zwei Klicks
        // schnell hintereinander schickten dieselbe base-Revision: die zweite
        // Fahrt wurde als Konflikt abgelehnt, obwohl niemand anderes etwas
        // getan hatte. Die Wettlaufsituation ist in storage.js behoben
        // (_serial), dieser Aufruf war trotzdem nur Rauschen.
        //
        // Wer die Anordnung wirklich aendert, speichert ohnehin: Drag ueber
        // dragfree, die Layouts ueber ihr layoutstop.
        // PR #8 hat diesen Aufruf mit !isFocusActive() abgesichert, weil im
        // Fokus-Modus nur eine Teilmenge im Graphen liegt und ein Speichern
        // die Positionen aller uebrigen Hosts der Ansicht wegwerfen wuerde.
        // Der Grund stimmt — er greift nur woanders: an den Layout-Knoepfen,
        // an dragfree und an layoutstop, wo dieser Schutz auch steht. HIER
        // faellt der Aufruf ganz weg, weil es nichts zu schuetzen gibt.
        cy.fit(cy.nodes(), 40);
    });

    // Layout-Auswahl als Dropdown (Auto / Force / Konzentrisch / Raster / Baum).
    // Auswahl wird im user-scoped localStorage persistiert und beim nächsten
    // initialen Render von buildLayoutConfig() wieder verwendet.
    (function buildLayoutDropdown() {
        // Idempotenz: bestehendes Wrap entfernen statt verändern, damit Re-Renders
        // (Dark-Mode, Group-Toggle) sauber neu bauen.
        const existing = document.getElementById('nt-layout-wrap');
        if (existing) existing.remove();
        // Auch der alte Single-Button aus früheren Versionen muss weg.
        const oldBtn = document.getElementById('nt-btn-layout');
        if (oldBtn) oldBtn.remove();

        const wrap = document.createElement('div');
        wrap.id = 'nt-layout-wrap';
        wrap.style.cssText = 'position:relative;display:inline-block;margin-left:4px';

        const btn = document.createElement('button');
        btn.className = 'btn-alt btn-small';
        btn.style.margin = '0';
        const _currentLayout = loadLayout();
        const _currentLabel = (LAYOUT_OPTIONS.find(function(o) { return o.id === _currentLayout; }) || LAYOUT_OPTIONS[0]).label;
        btn.textContent = t('toolbar.layout', { name: _currentLabel });

        const menu = document.createElement('div');
        menu.style.cssText = 'display:none;position:absolute;top:100%;left:0;z-index:9999;'
            + 'background:var(--nt-surface);border:1px solid var(--nt-line);border-radius:6px;'
            + 'box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:160px;overflow:hidden;'
            + 'margin-top:2px';

        LAYOUT_OPTIONS.forEach(function(opt) {
            const row = document.createElement('div');
            const isActive = opt.id === _currentLayout;
            row.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;'
                + 'color:' + (isActive ? 'var(--nt-active-text)' : 'var(--nt-text-2)') + ';'
                + 'background:' + (isActive ? 'var(--nt-active-bg)' : 'transparent') + ';'
                + 'white-space:nowrap;font-weight:' + (isActive ? '600' : '400');
            row.textContent = opt.label;
            row.addEventListener('mouseover', function() {
                if (!isActive) this.style.background = 'var(--nt-surface-2)';
            });
            row.addEventListener('mouseout', function() {
                if (!isActive) this.style.background = 'transparent';
            });
            row.addEventListener('click', function() {
                menu.style.display = 'none';
                // Vor dem Layout-WECHSEL die aktuelle (Hand-)Anordnung als
                // Undo-Schritt sichern: ein Klick auf ein anderes Layout laesst
                // sich damit ruecknehmen, zurueck zu dem, was der User gezogen
                // hatte. NUR bei einem echten Wechsel — ein Klick auf das bereits
                // aktive Layout aendert nichts und soll keinen Leer-Schritt
                // erzeugen (Review-Fund).
                if (!isActive && window._ntCy) recordBefore(window._ntCy);
                saveLayout(opt.id);
                // Re-Layout mit forceFresh=true: der User hat aktiv gewählt,
                // also nicht den Preset wiederverwenden.
                //
                // WICHTIG: Pinned (locked) Nodes NICHT mehr unlocken vor dem
                // Layout. Vorher gab's einen unlock+layout+relock-Tanz —
                // dadurch landeten gepinnte Knoten nach Layout-Wechsel an
                // einer neuen Position obwohl sie eigentlich genau den Sinn
                // haben "stay where I put you". Jetzt: locked bleiben locked,
                // Cytoscape's Layouts respektieren das und ueberspringen sie.
                // In focus mode do NOT touch the stored positions:
                // clearPositions wipes the whole view layer, and the saves
                // below would write back only the focus subset. The layout
                // switch then acts only ephemerally on the excerpt.
                if (!isFocusActive()) clearPositions();
                cy.resize();

                // Wenn Cluster-Mode aktiv ist (>=2 Gruppen + nicht 'off') muss
                // der gewaehlte Layout PER CLUSTER laufen, sonst zerschiesst
                // ein globales Grid/Baum/Hierarchie die Gruppen-Boundaries.
                let _clusterMode = 'auto';
                try {
                    const s = localStorage.getItem(NT_GROUP_CLUSTER_KEY);
                    if (s === 'auto' || s === 'columns' || s === 'rows' || s === 'off') _clusterMode = s;
                } catch (e) {}
                const _useCluster = groupNames && groupNames.length >= 2 && _clusterMode !== 'off';

                if (_useCluster) {
                    runGroupClusterLayout(cy, groupNames, _clusterMode, function() {
                        setTimeout(function() {
                            if (!isFocusActive()) { savePositions(cy); savePinned(cy); }
                            // Bei der Fit nur ueber NICHT-pinned Nodes — sonst
                            // koennten Pins ausserhalb des fit-Bereichs liegen
                            // und nach Layout abgeschnitten sein.
                            cy.fit(cy.nodes(), 30);
                        }, 200);
                    }, opt.id);
                } else {
                    const lo = cy.layout(buildLayoutConfig(opt.id, nodes, [], true));
                    lo.one('layoutstop', function() {
                        setTimeout(function() {
                            if (!isFocusActive()) { savePositions(cy); savePinned(cy); }
                            cy.fit(cy.nodes(), 40);
                        }, 400);
                    });
                    lo.run();
                }
                btn.textContent = t('toolbar.layout', { name: opt.label });
                // Aktive Markierung im Menü aktualisieren — nächstes Aufklappen
                // soll den neuen Stand zeigen.
                Array.from(menu.children).forEach(function(child, i) {
                    const o = LAYOUT_OPTIONS[i];
                    const a = o.id === opt.id;
                    child.style.color      = a ? 'var(--nt-active-text)' : 'var(--nt-text-2)';
                    child.style.background = a ? 'var(--nt-active-bg)' : 'transparent';
                    child.style.fontWeight = a ? '600'       : '400';
                });
            });
            menu.appendChild(row);
        });

        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });
        // Den vorigen Handler ABMELDEN, bevor ein neuer kommt.
        //
        // Der Block hier baut #nt-layout-wrap bei jedem setupToolbar neu, und
        // jeder Aufbau haengte einen weiteren Listener an document, den
        // niemand je entfernte. Im Wallboard mit 30-Sekunden-Refresh sind das
        // 120 dauerhafte Listener pro Stunde, jeder mit einem abgehaengten
        // menu-Element daran. export.js und render-table.js machen es an
        // vergleichbarer Stelle richtig — mit einem Modul-Handle und einem
        // removeEventListener davor.
        if (_layoutDocClose) {
            document.removeEventListener('click', _layoutDocClose);
        }
        _layoutDocClose = function() { menu.style.display = 'none'; };
        document.addEventListener('click', _layoutDocClose);

        wrap.appendChild(btn);
        wrap.appendChild(menu);
        if (bar && isFirstRun) bar.appendChild(wrap);
    })();

    // VLAN-Waehler — NUR wenn der Graph VLAN-Daten traegt (NT VLAN by SNMP).
    // Dropdown wie das Layout-Menue: „alle" + je VLAN eine Zeile; die Auswahl
    // dimmt alles, was nicht auf dem VLAN liegt (vlan-filter.js). Auf Instanzen
    // ohne das Template bleibt die Toolbar unveraendert (collectVlans leer).
    (function buildVlanDropdown() {
        const existing = document.getElementById('nt-vlan-wrap');
        if (existing) existing.remove();

        const vlans = collectVlans(cy);
        if (!vlans.length) {
            // Kein nt.vlan.walk -> kein Waehler; einen evtl. alten Filter loesen.
            if (loadVlanFilter()) { saveVlanFilter(''); clearVlanFilter(cy); }
            return;
        }

        const OPTIONS = [{ id: '', label: t('toolbar.vlan.all') }].concat(
            vlans.map(function(v) {
                return { id: String(v.id), label: v.name ? (v.id + ' · ' + v.name) : String(v.id) };
            }));

        let _cur = loadVlanFilter();
        // Gewaehltes VLAN gibt es nicht mehr (Topologie geaendert) -> auf alle.
        if (_cur !== '' && !vlans.some(function(v) { return String(v.id) === _cur; })) {
            _cur = ''; saveVlanFilter('');
        }
        const _labelOf = function(id) {
            const o = OPTIONS.find(function(x) { return x.id === id; }) || OPTIONS[0];
            return o.label;
        };

        const vwrap = document.createElement('div');
        vwrap.id = 'nt-vlan-wrap';
        vwrap.style.cssText = 'position:relative;display:inline-block;margin-left:4px';

        const vbtn = document.createElement('button');
        vbtn.className = 'btn-alt btn-small';
        vbtn.style.margin = '0';
        vbtn.textContent = t('toolbar.vlan', { name: _labelOf(_cur) });
        vbtn.title = t('toolbar.vlan.tip');
        vbtn.style.opacity = (_cur === '') ? '0.5' : '1';

        const vmenu = document.createElement('div');
        vmenu.style.cssText = 'display:none;position:absolute;top:100%;left:0;z-index:9999;'
            + 'background:var(--nt-surface);border:1px solid var(--nt-line);border-radius:6px;'
            + 'box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:160px;max-height:320px;'
            + 'overflow:auto;margin-top:2px';

        OPTIONS.forEach(function(opt) {
            const row = document.createElement('div');
            const isActive = opt.id === _cur;
            row.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;'
                + 'color:' + (isActive ? 'var(--nt-active-text)' : 'var(--nt-text-2)') + ';'
                + 'background:' + (isActive ? 'var(--nt-active-bg)' : 'transparent') + ';'
                + 'white-space:nowrap;font-weight:' + (isActive ? '600' : '400');
            row.textContent = opt.label;
            row.addEventListener('mouseover', function() {
                if (opt.id !== loadVlanFilter()) this.style.background = 'var(--nt-surface-2)';
            });
            row.addEventListener('mouseout', function() {
                if (opt.id !== loadVlanFilter()) this.style.background = 'transparent';
            });
            row.addEventListener('click', function() {
                vmenu.style.display = 'none';
                saveVlanFilter(opt.id);
                if (opt.id === '') { clearVlanFilter(cy); } else { applyVlanFilter(cy, opt.id); }
                vbtn.textContent = t('toolbar.vlan', { name: opt.label });
                vbtn.style.opacity = (opt.id === '') ? '0.5' : '1';
                Array.from(vmenu.children).forEach(function(child, i) {
                    const a = OPTIONS[i].id === opt.id;
                    child.style.color      = a ? 'var(--nt-active-text)' : 'var(--nt-text-2)';
                    child.style.background = a ? 'var(--nt-active-bg)' : 'transparent';
                    child.style.fontWeight = a ? '600' : '400';
                });
            });
            vmenu.appendChild(row);
        });

        vbtn.addEventListener('click', function(e) {
            e.stopPropagation();
            vmenu.style.display = vmenu.style.display === 'none' ? 'block' : 'none';
        });
        if (_vlanDocClose) { document.removeEventListener('click', _vlanDocClose); }
        _vlanDocClose = function() { vmenu.style.display = 'none'; };
        document.addEventListener('click', _vlanDocClose);

        vwrap.appendChild(vbtn);
        vwrap.appendChild(vmenu);
        if (bar && isFirstRun) bar.appendChild(vwrap);
    })();

    // Touch-Long-Press-Dauer (nur auf Touch-Geräten in der Toolbar sichtbar).
    // Erkennung über matchMedia + ontouchstart — beides true bei echten
    // Touch-Geräten. Auf Hybrid-Geräten (Surface) wird der Button auch gezeigt.
    const isTouchDevice = ('ontouchstart' in window)
        || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    if (isTouchDevice && !document.getElementById('nt-taphold-wrap')) {
        const tapWrap = document.createElement('div');
        tapWrap.id = 'nt-taphold-wrap';
        tapWrap.style.cssText = 'position:relative;display:inline-block;margin-left:4px';
        const tapBtn = document.createElement('button');
        tapBtn.className = 'btn-alt btn-small';
        tapBtn.style.margin = '0';
        const tapMenu = document.createElement('div');
        tapMenu.style.cssText = 'display:none;position:absolute;top:100%;left:0;z-index:9999;'
            + 'background:var(--nt-surface);border:1px solid var(--nt-line);border-radius:6px;'
            + 'box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:130px;overflow:hidden;margin-top:2px';
        let _tapMs = loadTapholdMs();
        function tapLabel() { return t('toolbar.taphold', { ms: _tapMs }); }
        tapBtn.textContent = tapLabel();

        [300, 500, 800].forEach(function(ms) {
            const row = document.createElement('div');
            const isActive = ms === _tapMs;
            row.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;'
                + 'color:' + (isActive ? 'var(--nt-active-text)' : 'var(--nt-text-2)') + ';'
                + 'background:' + (isActive ? 'var(--nt-active-bg)' : 'transparent') + ';'
                + 'font-weight:' + (isActive ? '600' : '400');
            row.textContent = ms + ' ms' + (ms === 500 ? ' ' + t('toolbar.taphold.default') : '');
            row.addEventListener('mouseover', function() {
                if (ms !== _tapMs) this.style.background = 'var(--nt-surface-2)';
            });
            row.addEventListener('mouseout', function() {
                this.style.background = ms === _tapMs ? 'var(--nt-active-bg)' : 'transparent';
            });
            row.addEventListener('click', function() {
                _tapMs = ms;
                saveTapholdMs(ms);
                tapBtn.textContent = tapLabel();
                tapMenu.style.display = 'none';
                // Wert wird beim nächsten Render auf Cytoscape übernommen.
                // Ein expliziter Re-Render würde die Karten-Position resetten,
                // also bewusst kein automatischer Re-Render.
                // Visuelles Feedback der neuen Auswahl
                Array.from(tapMenu.children).forEach(function(c, i) {
                    const cms = [300, 500, 800][i];
                    const a = cms === _tapMs;
                    c.style.color      = a ? 'var(--nt-active-text)' : 'var(--nt-text-2)';
                    c.style.background = a ? 'var(--nt-active-bg)' : 'transparent';
                    c.style.fontWeight = a ? '600' : '400';
                });
            });
            tapMenu.appendChild(row);
        });
        tapBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            tapMenu.style.display = tapMenu.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', function() { tapMenu.style.display = 'none'; });

        tapWrap.appendChild(tapBtn);
        tapWrap.appendChild(tapMenu);
        if (bar && isFirstRun) bar.appendChild(tapWrap);
    }

    // Group-View Toggle (zwischen einzelnen Hosts und Aggregaten)
    let _groupViewOn = false;
    // Den TATSAECHLICHEN Zustand, nicht die gespeicherte Wahl: bei
    // automatischer Gruppierung ist nichts gespeichert, die Karte ist aber
    // gruppiert (siehe storage.js).
    _groupViewOn = isGroupViewEffective();
    const bGroup = mkbtn('nt-btn-groupview',
        _groupViewOn ? t('toolbar.group.expand') : t('toolbar.group.collapse'), null);
    if (_groupViewOn) {
        bGroup.style.background = '#3b82f6';
        bGroup.style.color = '#fff';
    }
    bGroup.onclick = function() {
        // Gegen den SICHTBAREN Zustand schalten. Vorher wurde gegen den
        // gespeicherten geschaltet — bei automatischer Gruppierung haette ein
        // Klick "an" gesetzt und damit sichtbar nichts getan.
        const nowOn = !isGroupViewEffective();
        try { localStorage.setItem(NT_GROUP_VIEW_KEY, nowOn ? '1' : '0'); } catch (e) {}
        const d = window._ntLastData || {};
        if (d.nodes && d.nodes.length) {
            // Original-Nodes mit slice() durchreichen — render setzt _primaryGroup
            // deterministisch, daher ist das wieder-mutieren unproblematisch.
            _renderFn(wrap, d.nodes.slice(), (d.edges || []).slice(), d.url || '');
        }
    };

    // ── Zurueck nach oben ────────────────────────────────────────────────
    //
    // Ohne diesen Knopf gaebe es keinen Weg aus der Tiefe. Ein Klick auf eine
    // Gruppe klappt sie EINE Ebene auf — und danach ist der Knoten, dessen
    // Pfad offen ist, gar nicht mehr gezeichnet. Wer "Berlin" geoeffnet hat,
    // sieht "Berlin/Campus" und klappt damit Campus auf, nicht Berlin zu.
    // Der Zuklapp-Zweig in toggleGroupOpen war von der Karte aus schlicht
    // unerreichbar.
    //
    // Er erscheint nur, wenn wirklich etwas offen ist: ein Knopf, der nie
    // etwas tut, ist Rauschen.
    const _offeneEbenen = Object.keys(loadGroupOpen());
    if (_groupViewOn && _offeneEbenen.length) {
        const bZu = mkbtn('nt-btn-groupfold',
            t('toolbar.group.fold', { n: _offeneEbenen.length }), null);
        bZu.title = t('toolbar.group.fold.tip');
        bZu.onclick = function() {
            saveGroupOpen({});
            const d = window._ntLastData || {};
            if (d.nodes && d.nodes.length) {
                _renderFn(wrap, d.nodes.slice(), (d.edges || []).slice(), d.url || '');
            }
        };
    }

    // §9 Ghost-Knoten: LLDP/CDP-Nachbarn ohne eigenen Zabbix-Host einblenden.
    // Braucht einen Re-Render (es kommen Knoten + Kanten dazu bzw. fallen weg) —
    // anders als z.B. Port-Labels, die nur vorhandene Kanten stylen.
    const bGhosts = mkbtn('nt-btn-ghosts', '', null);
    // Drei Stufen im Ring: aus, nur Infrastruktur, alle. Die mittlere ist die
    // nuetzliche — an einem 48-Port-Switch sind fast alle Geister
    // Arbeitsplatzrechner und verdecken den unueberwachten Switch daneben.
    const _GHOST_RING = ['off', 'infra', 'all'];
    // Wie viele Hostgruppen liegen gerade auf der Karte? Unter zwei tut der
    // Cluster-Modus NICHTS — er trennt Gruppen, und eine Gruppe laesst sich
    // nicht trennen. Der Schalter liess sich trotzdem umstellen und schwieg
    // dazu. Gemeldet aus dem Feld: "zwischen Reihen und Spalten sehe ich
    // keinen Unterschied". Es gab keinen.
    const loadClusterMode = function() {
        let v = null;
        try { v = localStorage.getItem(NT_GROUP_CLUSTER_KEY); } catch (e) {}
        return (v === 'auto' || v === 'columns' || v === 'rows' || v === 'off') ? v : 'auto';
    };

    const _gruppenAufDerKarte = function() {
        const d = window._ntLastData || {};
        const gesehen = {};
        (d.nodes || []).forEach(function(n) {
            const g = n._primaryGroup || (n.groups && n.groups[0]);
            if (g) gesehen[g] = true;
        });
        return Object.keys(gesehen).length;
    };

    const _setGhostLabel = function() {
        const modus = loadGhostMode();
        bGhosts.textContent = t('toolbar.ghosts', { state: t('toolbar.ghosts.' + modus) });
        bGhosts.style.opacity = modus === 'off' ? '0.5' : '1';
        bGhosts.title = t('toolbar.ghosts.tip');
    };
    _setGhostLabel();
    bGhosts.onclick = function() {
        const jetzt = loadGhostMode();
        saveGhostMode(_GHOST_RING[(_GHOST_RING.indexOf(jetzt) + 1) % _GHOST_RING.length]);
        _setGhostLabel();
        const d = window._ntLastData || {};
        if (d.nodes && d.nodes.length) {
            _renderFn(wrap, d.nodes.slice(), (d.edges || []).slice(), d.url || '');
        }
    };

    // Endgeraete buendeln: an/aus. Die Umkehrung des 'infra'-Filters — nicht
    // wegwerfen, sondern zusammenfassen. Nur sinnvoll, wenn Geister ueberhaupt
    // gezeigt werden; der Schalter steht trotzdem immer da, weil er sonst
    // genau dann fehlte, wenn man ihn sucht (viele Geister auf einmal).
    const bBundle = mkbtn('nt-btn-bundle', '', null);
    const _setBundleLabel = function() {
        const an = loadBundleMode();
        bBundle.textContent = t('toolbar.bundle', { state: t(an ? 'toolbar.on' : 'toolbar.off') });
        bBundle.style.opacity = an ? '1' : '0.5';
        bBundle.title = t('toolbar.bundle.tip');
    };
    _setBundleLabel();
    bBundle.onclick = function() {
        saveBundleMode(!loadBundleMode());
        _setBundleLabel();
        const d = window._ntLastData || {};
        if (d.nodes && d.nodes.length) {
            _renderFn(wrap, d.nodes.slice(), (d.edges || []).slice(), d.url || '');
        }
    };

    // Cluster-Mode-Dropdown: Auto / Spalten / Reihen / Aus
    // Bestimmt wie ≥2 Hostgroups visuell getrennt werden:
    // - auto: 2-3 Gruppen → Spalten, 4+ Gruppen → Reihen
    // - columns: immer Spalten
    // - rows: immer Reihen
    // - off: kein Cluster, normales Force-Layout
    if (bar && isFirstRun && !document.getElementById('nt-cluster-wrap')) {
        const clusterWrap = document.createElement('div');
        clusterWrap.id = 'nt-cluster-wrap';
        clusterWrap.style.cssText = 'position:relative;display:inline-block;margin-left:4px';

        // let, nicht const: der Schalter muss seinen eigenen Stand kennen.
        // Gemeldet aus dem Feld: "wenn ich Aus waehle, bleibt Auto stehen".
        // Gespeichert und neu gezeichnet wurde laengst richtig — nur Beschriftung
        // und Haekchen blieben auf dem Wert von der Toolbar-Erstellung stehen,
        // und ein Schalter, der die Wahl nicht anzeigt, hat sie nicht
        // angenommen.
        let cMode = (function() {
            try { return localStorage.getItem(NT_GROUP_CLUSTER_KEY) || 'auto'; }
            catch (e) { return 'auto'; }
        })();
        const labels = {
            auto:    t('toolbar.cluster.auto'),
            columns: t('toolbar.cluster.columns'),
            rows:    t('toolbar.cluster.rows'),
            off:     t('toolbar.cluster.off'),
        };

        const cBtn = document.createElement('button');
        cBtn.className = 'btn-alt btn-small';
        cBtn.id = 'nt-btn-cluster';
        // Unter zwei Hostgruppen trennt der Modus nichts. Das sieht man dem
        // Schalter jetzt an, statt ihn ins Leere laufen zu lassen.
        const _setClusterLabel = function() {
            const wenige = _gruppenAufDerKarte() < 2;
            cBtn.textContent = labels[loadClusterMode()] || labels.auto;
            cBtn.style.opacity = wenige ? '0.5' : '1';
            cBtn.title = wenige
                ? t('toolbar.cluster.needs_groups')
                : t('toolbar.cluster.tip');
        };
        _setClusterLabel();
        clusterWrap.appendChild(cBtn);

        const cMenu = document.createElement('div');
        cMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--nt-surface);'
            + 'border:1px solid var(--nt-line);border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.08);'
            + 'min-width:170px;z-index:300;display:none;margin-top:2px';
        ['auto', 'columns', 'rows', 'off'].forEach(function(opt) {
            const item = document.createElement('div');
            item.textContent = labels[opt];
            item.dataset.mode = opt;
            item.style.cssText = 'padding:7px 12px;cursor:pointer;font-size:12px;color:var(--nt-text-2)';
            if (opt === cMode) {
                item.style.background = 'var(--nt-active-bg)';
                item.style.fontWeight = '600';
            }
            item.addEventListener('mouseenter', function() {
                if (item.dataset.mode !== cMode) item.style.background = 'var(--nt-surface-2)';
            });
            item.addEventListener('mouseleave', function() {
                if (item.dataset.mode !== cMode) item.style.background = '';
            });
            item.addEventListener('click', function(e) {
                e.stopPropagation();
                const newMode = this.dataset.mode;
                try { localStorage.setItem(NT_GROUP_CLUSTER_KEY, newMode); } catch (e2) {}
                cMode = newMode;
                _setClusterLabel();
                Array.from(cMenu.children).forEach(function(kind) {
                    const aktiv = kind.dataset.mode === newMode;
                    kind.style.background = aktiv ? 'var(--nt-active-bg)' : '';
                    kind.style.fontWeight = aktiv ? '600' : '400';
                });
                cMenu.style.display = 'none';
                // Re-Render mit neuem Mode
                const d = window._ntLastData || {};
                if (d.nodes && d.nodes.length) {
                    _renderFn(wrap, d.nodes.slice(), (d.edges || []).slice(), d.url || '');
                }
            });
            cMenu.appendChild(item);
        });
        clusterWrap.appendChild(cMenu);

        cBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            cMenu.style.display = cMenu.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', function() { cMenu.style.display = 'none'; });

        bar.appendChild(clusterWrap);
    }

    // Auto-Refresh-Toggle. Die Zahl kommt aus derselben Funktion, die den
    // Timer stellt — eine Aufschrift, die einen anderen Takt behauptet als
    // den laufenden, waere schlimmer als gar keine.
    const _autoAn = function() { return t('toolbar.auto.on', { int: refreshLabel(nodes.length) }); };
    mkbtn('nt-btn-auto', _autoAn(), function() {
        window._ntRefreshOn = !window._ntRefreshOn;
        this.textContent = window._ntRefreshOn ? _autoAn() : t('toolbar.auto.off');
        this.style.opacity = window._ntRefreshOn ? '1' : '0.5';
    });

    // LLDP-Kanten ein/aus
    let _lldpVisible = localStorage.getItem(NT_LLDP_KEY) !== '0';
    const bLldp = mkbtn('nt-btn-lldp',
        t('toolbar.lldp', { state: _lldpVisible ? t('toolbar.on') : t('toolbar.off') }), null);
    bLldp.style.opacity = _lldpVisible ? '1' : '0.5';
    if (!_lldpVisible) cy.edges('[?isLLDP]').style('display', 'none');
    bLldp.addEventListener('click', function() {
        _lldpVisible = !_lldpVisible;
        localStorage.setItem(NT_LLDP_KEY, _lldpVisible ? '1' : '0');
        cy.edges('[?isLLDP]').style('display', _lldpVisible ? 'element' : 'none');
        bLldp.textContent = t('toolbar.lldp', { state: _lldpVisible ? t('toolbar.on') : t('toolbar.off') });
        bLldp.style.opacity = _lldpVisible ? '1' : '0.5';
    });

    // Weathermap- und Link-Quality-Modus faerben beide die Kanten — nach
    // Auslastungs-% bzw. nach Güte-Score (Errors/Drops/Auslastung/Down/Flap). Sie
    // schliessen sich GEGENSEITIG aus: eine Kante kann nur eine Aussage farblich
    // tragen. Darum ein gemeinsamer Zustand + ein gemeinsamer Label-Refresh.
    let _wmOn = false, _lqOn = false;
    try { _wmOn = localStorage.getItem(NT_WEATHERMAP_KEY)   === '1'; } catch (e) {}
    try { _lqOn = localStorage.getItem(NT_LINKQUALITY_KEY) === '1'; } catch (e) {}
    if (_wmOn && _lqOn) {   // Altzustand mit beiden an: Weathermap gewinnt.
        _lqOn = false;
        try { localStorage.setItem(NT_LINKQUALITY_KEY, '0'); } catch (e) {}
    }
    setWeathermapMode(_wmOn);
    setLinkQualityMode(_lqOn);

    const bWm = mkbtn('nt-btn-weathermap', '', null);
    const bLq = mkbtn('nt-btn-linkquality', '', null);

    function _refreshModeLabels() {
        bWm.textContent = t('toolbar.weathermap', { state: _wmOn ? t('toolbar.on') : t('toolbar.off') });
        bWm.style.opacity = _wmOn ? '1' : '0.5';
        bWm.title = t('toolbar.weathermap.tip');
        bLq.textContent = t('toolbar.linkquality', { state: _lqOn ? t('toolbar.on') : t('toolbar.off') });
        bLq.style.opacity = _lqOn ? '1' : '0.5';
        bLq.title = t('toolbar.linkquality.tip');
    }
    function _persistModes() {
        try { localStorage.setItem(NT_WEATHERMAP_KEY,   _wmOn ? '1' : '0'); } catch (e) {}
        try { localStorage.setItem(NT_LINKQUALITY_KEY, _lqOn ? '1' : '0'); } catch (e) {}
    }
    function _applyModes() {
        setWeathermapMode(_wmOn);
        setLinkQualityMode(_lqOn);
        _persistModes();
        _refreshModeLabels();
        applyTrafficHeatmap(window._ntCy);
        // The color guide shows the scale of the active mode — keep it in sync.
        refreshBottomLegend();
    }

    _refreshModeLabels();
    bWm.addEventListener('click', function() {
        _wmOn = !_wmOn;
        if (_wmOn) _lqOn = false;   // gegenseitig ausschliessend
        _applyModes();
    });
    bLq.addEventListener('click', function() {
        _lqOn = !_lqOn;
        if (_lqOn) _wmOn = false;
        _applyModes();
    });

    // Ring-/Loop-Erkennung: redundante Ringe (Zyklen) im Nachbargraphen als
    // underlay-Halo markieren, per STP sicher/gefaehrlich getrennt. Kein
    // Re-Render — nur Styling vorhandener Kanten + die KPI-Zeile (Ring-/Loop-
    // Pille erscheint/verschwindet).
    const bRings = mkbtn('nt-btn-rings', '', null);
    const _setRingsLabel = function() {
        const on = loadRings();
        bRings.textContent = t('toolbar.rings', { state: t('toolbar.rings.' + (on ? 'on' : 'off')) });
        bRings.style.opacity = on ? '1' : '0.5';
        bRings.title = t('toolbar.rings.tip');
    };
    _setRingsLabel();
    bRings.addEventListener('click', function() {
        const on = !loadRings();
        saveRings(on);
        _setRingsLabel();
        if (on) applyRings(window._ntCy); else clearRings(window._ntCy);
        refreshKpi();
    });

    // Soll/Ist-Toggle (nt:expect): erwartete gegen gemessene Verkabelung.
    const bExpected = mkbtn('nt-btn-expected', '', null);
    const _setExpectedLabel = function() {
        const on = loadExpected();
        bExpected.textContent = t('toolbar.expected', { state: t('toolbar.expected.' + (on ? 'on' : 'off')) });
        bExpected.style.opacity = on ? '1' : '0.5';
        bExpected.title = t('toolbar.expected.tip');
    };
    _setExpectedLabel();
    bExpected.addEventListener('click', function() {
        const on = !loadExpected();
        saveExpected(on);
        _setExpectedLabel();
        if (on) applyExpected(window._ntCy); else clearExpected(window._ntCy);
        refreshKpi();
    });

    // Color-scales editor: thresholds + colors of both scales, stored in
    // module.config (applies to everyone). Super admins only — the backend
    // checks anyway, but a button that can only say "no permission" is noise.
    if (window.NT_CONFIG && window.NT_CONFIG.is_super_admin) {
        const bScales = mkbtn('nt-btn-scales', t('toolbar.scales'), function() {
            openColorScalesPanel(wrap, isDark);
        });
        bScales.title = t('toolbar.scales.tip');
    }

    // Performance-Modus: einfache Severity-Punkte statt SVG-Pie-Knoten →
    // fluessiges Rendern bei vielen Hosts. Auto ab ~400 Knoten (render-tech);
    // hier manuell erzwingbar (auch zum Testen mit wenigen Hosts). Der Toggle
    // erfordert einen Re-Render, weil sich die Knoten-Darstellung aendert.
    const bPerf = mkbtn('nt-btn-perf', '', null);
    bPerf.textContent = t('toolbar.perf', { state: window._ntPerfMode ? t('toolbar.on') : t('toolbar.off') });
    bPerf.style.opacity = window._ntPerfMode ? '1' : '0.5';
    bPerf.title = t('toolbar.perf.tip');
    bPerf.addEventListener('click', function() {
        const nowOn = !window._ntPerfMode;
        try { localStorage.setItem(NT_PERF_KEY, nowOn ? '1' : '0'); } catch (e) {}
        const d = window._ntLastData || {};
        if (d.nodes && d.nodes.length) _renderFn(wrap, d.nodes.slice(), (d.edges || []).slice(), d.url || '');
    });

    // Punktgroesse: Hosts + Beschriftung kleiner/normal/groesser. Ringt durch
    // die drei Stufen. Kein Re-Render wie beim Perf-Toggle noetig — nur das
    // Stylesheet wird getauscht (cy.style ersetzt nur die Regeln; Klassen wie
    // .nt-perf und inline gesetzte Labels/Heatmap-Farben bleiben erhalten),
    // das haelt Positionen, Pins und Fokus unberuehrt.
    const bSize = mkbtn('nt-btn-nodesize', '', null);
    const _setSizeLabel = function() {
        const step = loadNodeSize();
        bSize.textContent = t('toolbar.nodesize', { size: t('toolbar.nodesize.' + step) });
        bSize.style.opacity = step === 'normal' ? '0.5' : '1';
        bSize.title = t('toolbar.nodesize.tip');
    };
    _setSizeLabel();
    bSize.addEventListener('click', function() {
        const step = nextNodeSize();
        saveNodeSize(step);
        _setSizeLabel();
        const c = window._ntCy;
        if (c && !c.destroyed()) {
            c.style(buildCytoscapeStyle(isDark, nodes.length, nodeSizeFactor(step)));
        }
    });

    // Port-Labels: LLDP-Port des Reporters an den Edge-Enden (Best-Effort)
    const bPorts = mkbtn('nt-btn-portlabels', '', null);
    const _setPortsLabel = function() {
        bPorts.textContent = t('toolbar.portlabels', { state: portLabelsOn() ? t('toolbar.on') : t('toolbar.off') });
        bPorts.style.opacity = portLabelsOn() ? '1' : '0.5';
        bPorts.title = t('toolbar.portlabels.tip');
    };
    _setPortsLabel();
    bPorts.addEventListener('click', function() {
        setPortLabels(!portLabelsOn());
        _setPortsLabel();
        applyPortLabels(window._ntCy);
    });

    // Parallel links (LAG, bonding): off = always one line with ×N.
    const bPar = mkbtn('nt-btn-parlinks', '', null);
    const _setParLabel = function() {
        bPar.textContent = t('toolbar.parlinks', { state: allLinksOn() ? t('toolbar.on') : t('toolbar.off') });
        bPar.style.opacity = allLinksOn() ? '1' : '0.5';
        bPar.title = t('toolbar.parlinks.tip');
    };
    _setParLabel();
    bPar.addEventListener('click', function() {
        setAllLinks(!allLinksOn());
        _setParLabel();
        if (applyBundleView(window._ntCy)) applyTrafficHeatmap(window._ntCy);
    });

    // Blaetter einklappen: Geraete mit genau einem Nachbarn verstecken und am
    // Nachbarn zaehlen. Neben den parallelen Links, weil beides dasselbe tut —
    // weniger zeichnen, ohne etwas zu verschweigen.
    const bLeaf = mkbtn('nt-btn-collapse', '', null);
    const _setLeafLabel = function() {
        bLeaf.textContent = collapseLabel(window._ntCy);
        bLeaf.style.opacity = isCollapsed() ? '1' : '0.5';
        bLeaf.title = t('toolbar.collapse.tip');
    };
    // Angemeldet statt einmal gesetzt: die Karte klappt beim ersten Zeichnen
    // von allein ein, und das geschieht NACH dieser Zeile.
    onCollapseChanged(_setLeafLabel);
    bLeaf.addEventListener('click', function() {
        const c = window._ntCy;
        if (!c) return;
        if (isCollapsed()) {
            expandLeaves(c);
            setCollapsePref(false);
        } else {
            collapseLeaves(c);
            setCollapsePref(true);
        }
        c.fit(c.elements(':visible'), 40);
    });

    // Root-Cause-Analyse: Offline-Hosts in Ursache vs. Folge trennen
    const bRc = mkbtn('nt-btn-rootcause', t('rc.button'), null);
    bRc.title = t('rc.button.tip');
    bRc.addEventListener('click', function() {
        toggleRootCause(window._ntCy);
    });

    // Export-Menü (PNG/PDF/HTML/Mail) — eigenständiges Modul
    setupExportMenu(bar, isFirstRun);

    // MAC-Finder (FDB-Suche) — Knopf + schwebendes Panel, eigenständiges Modul
    setupFdbFinder(bar, isFirstRun);

    // Layout-Presets: Save / SaveAs / Load / Delete für komplette
    // Visual-States (Positionen + Pins + Notes + Manual-Links).
    setupPresetsUI(bar, isFirstRun, cy);

    // Link-Modus (Star-Mode für manuelle Edges)
    const bLink = mkbtn('nt-btn-link', t('toolbar.link'), null);
    bLink.title = t('toolbar.link.tip');
    bLink.onclick = function() {
        if (isLinkModeActive()) { exitLinkMode(); return; }
        resetHighlight(cy);
        enterLinkMode();
        bLink.style.background = '#dbeafe';
        bLink.style.color = '#1d4ed8';
        bLink.textContent = t('toolbar.link.cancel');
        document.getElementById('nt-canvas-wrap').style.cursor = 'crosshair';
    };
    // Globaler ESC-Listener — nur einmal pro Page-Load anhaengen, sonst
    // akkumuliert er bei jedem Tab-Wechsel (setupToolbar laeuft mehrfach).
    if (!window._ntEscListenerInstalled) {
        window._ntEscListenerInstalled = true;
        document.addEventListener('keydown', function(e) {
            if (e.key !== 'Escape') return;
            if (isLinkModeActive()) { exitLinkMode(); return; }
            const cyRef = window._ntCy;
            // ESC-Kette: Pfad-Highlight → Ausfall-Simulation → Root-Cause →
            // Fokus — ein ESC beendet EINEN Modus, nicht alle auf einmal.
            if (cyRef && (isPathActive() || getPathStart())) { clearPathState(cyRef); return; }
            if (cyRef && isSimActive()) { clearSimulation(cyRef); return; }
            if (cyRef && isRootCauseActive()) { clearRootCause(cyRef); return; }
            if (cyRef && isFocusActive()) clearFocus();
        });
    }

    // Alle manuellen Links löschen
    const bUnlink = mkbtn('nt-btn-unlink', t('toolbar.unlink'), null);
    bUnlink.title = t('toolbar.unlink.tip');
    bUnlink.onclick = function() {
        // Loescht nur die eigene Ebene: ein Super-Admin raeumt die geteilten
        // Kanten ab, alle anderen ihre persoenlichen. Die Rueckfrage muss das
        // sagen — bei geteilten Kanten trifft es alle Benutzer.
        const gone = defaultLinkScope();
        if (!confirm(t('toolbar.unlink.confirm.' + gone))) return;
        clearLinks(gone);
        if (window._ntCy) {
            window._ntCy.edges('[id^="ml_"]').forEach(function(e) {
                if (e.data('mlScope') === gone) e.remove();
            });
        }
        // Gleiche Ueberlegung wie beim Zeichnen: der Graph ist sofort leer,
        // die Kennzahl daneben waere es erst nach dem naechsten Refresh.
        refreshKpi();
    };

    // ── Undo/Redo der Anordnung ─────────────────────────────────────────────
    function _cyLive() {
        const c = window._ntCy;
        return (c && !(c.destroyed && c.destroyed())) ? c : null;
    }
    const bUndo = mkbtn('nt-btn-undo', '↶', function() {
        const c = _cyLive(); if (c) undoLayout(c);
    });
    bUndo.title = t('toolbar.undo.tip');
    const bRedo = mkbtn('nt-btn-redo', '↷', function() {
        const c = _cyLive(); if (c) redoLayout(c);
    });
    bRedo.title = t('toolbar.redo.tip');
    // Button-Zustand zentral: layout-history meldet (canUndo, canRedo). Per ID
    // aktualisiert, weil mkbtn die Buttons bei jedem Setup ersetzt.
    function _updUndoRedo(cu, cr) {
        const u = document.getElementById('nt-btn-undo');
        const r = document.getElementById('nt-btn-redo');
        if (u) { u.disabled = !cu; u.style.opacity = cu ? '' : '0.4'; }
        if (r) { r.disabled = !cr; r.style.opacity = cr ? '' : '0.4'; }
    }
    configureLayoutHistory({ onChange: _updUndoRedo });
    _updUndoRedo(canUndo(), canRedo());
    // Tastatur: Strg/Cmd+Z = Undo, Strg/Cmd+Shift+Z oder Strg+Y = Redo. Einmal
    // pro Page-Load (wie der ESC-Listener), und nicht, waehrend in einem
    // Eingabefeld getippt wird.
    if (!window._ntUndoKeysInstalled) {
        window._ntUndoKeysInstalled = true;
        document.addEventListener('keydown', function(e) {
            if (!(e.ctrlKey || e.metaKey)) return;
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA'
                    || (e.target && e.target.isContentEditable)) return;
            const c = _cyLive();
            if (!c) return;
            // preventDefault NUR, wenn wir den Druck auch nutzen — sonst wuerde
            // das native Strg+Z der Seite dauerhaft geschluckt, auch bei leerem
            // Stapel (der Listener haengt einmalig fuer die Seitenlebensdauer).
            const k = (e.key || '').toLowerCase();
            if (k === 'z' && !e.shiftKey) {
                if (canUndo()) { e.preventDefault(); undoLayout(c); }
            }
            else if ((k === 'z' && e.shiftKey) || k === 'y') {
                if (canRedo()) { e.preventDefault(); redoLayout(c); }
            }
        });
    }

    // History-Button (Toggle für History-Slider)
    addHistoryButton(bar, isFirstRun);

    // Severity-Filter-Pills
    if (bar) buildSevFilter(bar, cy);

    // Suchfeld (einmalig)
    if (!document.getElementById('nt-search-input')) {
        const si = document.createElement('input');
        si.id = 'nt-search-input';
        si.type = 'text';
        si.placeholder = t('toolbar.search');
        si.title = t('toolbar.search.tip');
        // Styling lives in network-topology.css (#nt-search-input) — theme-aware.
        // Dieselbe Suchsprache wie in der Tabelle, statt eines indexOf auf den
        // Anzeigenamen. Damit kann die Karte, was die Tabelle laengst konnte:
        //
        //   192.168.20.43           blosses Wort -> Name UND IP, sonst nichts.
        //                           Typ, Gruppe und Proxy NUR mit Feldnamen —
        //                           query.js' _any traegt bewusst nur host+ip.
        //                           Der Platzhalter sagt deshalb "Name oder IP"
        //                           und nicht mehr: er versprach vorher Typ-
        //                           Suche, und wer 'switch' tippte, sah eine
        //                           leere Karte.
        //   type:switch             Feldsuche (host, label, ip, type, iftype,
        //                           proxy, group)
        //   -type:server            Negation
        //   (host:fw OR host:core)  Gruppierung und ODER
        //
        // parseQuery/matchQuery/nodeToQueryFields liegen fertig in query.js und
        // werden von render-table.js an drei Stellen benutzt — hier kam nichts
        // Neues dazu, es war nur nie angeschlossen.
        si.addEventListener('input', function() {
            const ast = parseQuery(this.value);
            cy.nodes('[!isGroup]').forEach(function(n) {
                // Die Feld-Strings je Knoten EINMAL bauen und am Element
                // merken: nodeToQueryFields() erzeugt sieben Lowercase-Strings,
                // und dieser Handler laeuft bei jedem Tastendruck ueber alle
                // Knoten. Ab der Performance-Schwelle (400) waere das spuerbar.
                // Ein Re-Render legt neue Elemente an, der Cache verfaellt also
                // von selbst.
                let f = n.scratch('_ntQF');
                if (!f) { f = nodeToQueryFields(n.data()); n.scratch('_ntQF', f); }
                n.style('opacity', matchQuery(ast, f) ? 1 : 0.15);
            });
        });
        if (bar) bar.appendChild(si);
    }

}
