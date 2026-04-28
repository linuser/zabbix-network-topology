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

import { NT_LLDP_KEY, NT_GROUP_VIEW_KEY,
         clearPositions, savePositions, savePinned, loadLinks, saveLinks,
         loadLayout, saveLayout,
         loadTapholdMs, saveTapholdMs } from './storage.js';
import { resetHighlight } from './highlight.js';
import { isLinkModeActive, enterLinkMode, exitLinkMode } from './manual-links.js';
import { setupExportMenu, setupMailButton } from './export-mail.js';
import { LAYOUT_OPTIONS, buildLayoutConfig } from './layouts.js';
import { setupPresetsUI } from './presets-ui.js';
import { buildSevFilter } from './sev-filter.js';

// Cross-Module-Glue: render() wird aus dem Hauptmodul/render-tech.js injiziert,
// damit der Group-View-Button einen Re-Render triggern kann.
let _renderFn = function() {};
export function setRenderCallback(fn) { _renderFn = fn; }


export function setupToolbar(cy, wrap, nodes, groupNames, isDark, useLayout) {
    const bar = document.querySelector('.nt-topbar__actions');
    const isFirstRun = !window._ntToolbarDone;
    window._ntToolbarDone = true;

    // Tabs + Dark-Button werden von ensureBaseToolbar() gemanagt — hier nur
    // tech-spezifische Buttons.
    function mkbtn(id, lbl, fn) {
        const existing = id ? document.getElementById(id) : null;
        if (existing) return existing;
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
    const bIn  = document.getElementById('nt-btn-zoom-in');
    const bOut = document.getElementById('nt-btn-zoom-out');
    if (bIn) {
        bIn.onclick = null;
        bIn.addEventListener('click', function() {
            cy.zoom({ level: cy.zoom() * 1.3,
                      renderedPosition: { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 } });
        });
    }
    if (bOut) {
        bOut.onclick = null;
        bOut.addEventListener('click', function() {
            cy.zoom({ level: cy.zoom() * 0.77,
                      renderedPosition: { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 } });
        });
    }

    // Hide Labels
    const bLbl = document.getElementById('nt-btn-labels');
    if (bLbl) bLbl.onclick = function() {
        const hide = this.textContent.indexOf('Hide') >= 0;
        cy.nodes('[!isGroup]').style('label', hide ? '' : 'data(label)');
        this.textContent = hide ? 'Show Labels' : 'Hide Labels';
    };

    // Fullscreen
    const bFs = document.getElementById('nt-btn-fullscreen');
    if (bFs) bFs.addEventListener('click', function() {
        const root = document.getElementById('nt-root');
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
            bFs.textContent = 'Exit Fullscreen';
        } else {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            bFs.textContent = 'Fullscreen';
        }
    });

    // Fit
    const bReset = mkbtn('nt-btn-reset', 'Fit', null);
    bReset.addEventListener('click', function() {
        cy.fit(cy.nodes(), 40);
        // Positions sicherheitshalber nach kurzer Pause nochmal speichern
        setTimeout(function() { savePositions(cy); }, 200);
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
        btn.textContent = '\u21BB Layout: ' + _currentLabel;

        const menu = document.createElement('div');
        menu.style.cssText = 'display:none;position:absolute;top:100%;left:0;z-index:9999;'
            + 'background:#fff;border:1px solid #e2e8f0;border-radius:6px;'
            + 'box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:160px;overflow:hidden;'
            + 'margin-top:2px';

        LAYOUT_OPTIONS.forEach(function(opt) {
            const row = document.createElement('div');
            const isActive = opt.id === _currentLayout;
            row.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;'
                + 'color:' + (isActive ? '#1d4ed8' : '#334155') + ';'
                + 'background:' + (isActive ? '#dbeafe' : 'transparent') + ';'
                + 'white-space:nowrap;font-weight:' + (isActive ? '600' : '400');
            row.textContent = opt.label;
            row.addEventListener('mouseover', function() {
                if (!isActive) this.style.background = '#f8fafc';
            });
            row.addEventListener('mouseout', function() {
                if (!isActive) this.style.background = 'transparent';
            });
            row.addEventListener('click', function() {
                menu.style.display = 'none';
                saveLayout(opt.id);
                // Re-Layout mit forceFresh=true: der User hat aktiv gewählt,
                // also nicht den Preset wiederverwenden.
                clearPositions();
                const pinnedNodes = cy.nodes('[!isGroup]').filter(function(n) { return n.locked(); });
                pinnedNodes.unlock();
                cy.resize();
                const lo = cy.layout(buildLayoutConfig(opt.id, nodes, [], true));
                lo.one('layoutstop', function() {
                    setTimeout(function() {
                        pinnedNodes.lock();
                        savePositions(cy);
                        savePinned(cy);
                        cy.fit(cy.nodes(), 40);
                    }, 400);
                });
                lo.run();
                btn.textContent = '\u21BB Layout: ' + opt.label;
                // Aktive Markierung im Menü aktualisieren — nächstes Aufklappen
                // soll den neuen Stand zeigen.
                Array.from(menu.children).forEach(function(child, i) {
                    const o = LAYOUT_OPTIONS[i];
                    const a = o.id === opt.id;
                    child.style.color      = a ? '#1d4ed8'   : '#334155';
                    child.style.background = a ? '#dbeafe'   : 'transparent';
                    child.style.fontWeight = a ? '600'       : '400';
                });
            });
            menu.appendChild(row);
        });

        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', function() { menu.style.display = 'none'; });

        wrap.appendChild(btn);
        wrap.appendChild(menu);
        if (bar && isFirstRun) bar.appendChild(wrap);
    })();

    // Touch-Long-Press-Dauer (nur auf Touch-Geräten in der Toolbar sichtbar).
    // Erkennung über matchMedia + ontouchstart — beides true bei echten
    // Touch-Geräten. Auf Hybrid-Geräten (Surface) wird der Button auch gezeigt.
    const isTouchDevice = ('ontouchstart' in window)
        || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    if (isTouchDevice) {
        const tapWrap = document.createElement('div');
        tapWrap.id = 'nt-taphold-wrap';
        tapWrap.style.cssText = 'position:relative;display:inline-block;margin-left:4px';
        const tapBtn = document.createElement('button');
        tapBtn.className = 'btn-alt btn-small';
        tapBtn.style.margin = '0';
        const tapMenu = document.createElement('div');
        tapMenu.style.cssText = 'display:none;position:absolute;top:100%;left:0;z-index:9999;'
            + 'background:#fff;border:1px solid #e2e8f0;border-radius:6px;'
            + 'box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:130px;overflow:hidden;margin-top:2px';
        let _tapMs = loadTapholdMs();
        function tapLabel() { return '\u270B Long-Press: ' + _tapMs + 'ms'; }
        tapBtn.textContent = tapLabel();

        [300, 500, 800].forEach(function(ms) {
            const row = document.createElement('div');
            const isActive = ms === _tapMs;
            row.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;'
                + 'color:' + (isActive ? '#1d4ed8' : '#334155') + ';'
                + 'background:' + (isActive ? '#dbeafe' : 'transparent') + ';'
                + 'font-weight:' + (isActive ? '600' : '400');
            row.textContent = ms + ' ms' + (ms === 500 ? ' (Standard)' : '');
            row.addEventListener('mouseover', function() {
                if (ms !== _tapMs) this.style.background = '#f8fafc';
            });
            row.addEventListener('mouseout', function() {
                this.style.background = ms === _tapMs ? '#dbeafe' : 'transparent';
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
                    c.style.color      = a ? '#1d4ed8' : '#334155';
                    c.style.background = a ? '#dbeafe' : 'transparent';
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
    try { _groupViewOn = localStorage.getItem(NT_GROUP_VIEW_KEY) === '1'; } catch (e) {}
    const bGroup = mkbtn('nt-btn-groupview',
        _groupViewOn ? '\u{1F4CB} Aufl\u00F6sen' : '\u{1F5C2} Gruppieren', null);
    if (_groupViewOn) {
        bGroup.style.background = '#3b82f6';
        bGroup.style.color = '#fff';
    }
    bGroup.onclick = function() {
        const nowOn = localStorage.getItem(NT_GROUP_VIEW_KEY) !== '1';
        try { localStorage.setItem(NT_GROUP_VIEW_KEY, nowOn ? '1' : '0'); } catch (e) {}
        const d = window._ntLastData || {};
        if (d.nodes && d.nodes.length) {
            // Original-Nodes mit slice() durchreichen — render setzt _primaryGroup
            // deterministisch, daher ist das wieder-mutieren unproblematisch.
            _renderFn(wrap, d.nodes.slice(), (d.edges || []).slice(), d.url || '');
        }
    };

    // Auto-Refresh-Toggle
    mkbtn('nt-btn-auto', 'Auto: 30s', function() {
        window._ntRefreshOn = !window._ntRefreshOn;
        this.textContent = window._ntRefreshOn ? 'Auto: 30s' : 'Auto: Off';
        this.style.opacity = window._ntRefreshOn ? '1' : '0.5';
    });

    // LLDP-Kanten ein/aus
    let _lldpVisible = localStorage.getItem(NT_LLDP_KEY) !== '0';
    const bLldp = mkbtn('nt-btn-lldp', _lldpVisible ? ' LLDP: an' : ' LLDP: aus', null);
    bLldp.style.opacity = _lldpVisible ? '1' : '0.5';
    if (!_lldpVisible) cy.edges('[?isLLDP]').style('display', 'none');
    bLldp.addEventListener('click', function() {
        _lldpVisible = !_lldpVisible;
        localStorage.setItem(NT_LLDP_KEY, _lldpVisible ? '1' : '0');
        cy.edges('[?isLLDP]').style('display', _lldpVisible ? 'element' : 'none');
        bLldp.textContent = _lldpVisible ? ' LLDP: an' : ' LLDP: aus';
        bLldp.style.opacity = _lldpVisible ? '1' : '0.5';
    });

    // Export-Menü (PNG/PDF/HTML/Mail) — eigenständiges Modul
    setupExportMenu(bar, isFirstRun);

    // Layout-Presets: Save / SaveAs / Load / Delete für komplette
    // Visual-States (Positionen + Pins + Notes + Manual-Links).
    setupPresetsUI(bar, isFirstRun, cy);

    // Link-Modus (Star-Mode für manuelle Edges)
    const bLink = mkbtn('nt-btn-link', 'Link', null);
    bLink.title = 'Stern-Modus: Quelle w\u00E4hlen, dann beliebig viele Ziele klicken. ESC oder Quelle nochmal = fertig.';
    bLink.onclick = function() {
        if (isLinkModeActive()) { exitLinkMode(); return; }
        resetHighlight(cy);
        enterLinkMode();
        bLink.style.background = '#dbeafe';
        bLink.style.color = '#1d4ed8';
        bLink.textContent = 'Abbrechen (ESC)';
        document.getElementById('nt-canvas-wrap').style.cursor = 'crosshair';
    };
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && isLinkModeActive()) exitLinkMode();
    });

    // Alle manuellen Links löschen
    const bUnlink = mkbtn('nt-btn-unlink', '\u2715 Links', null);
    bUnlink.title = 'Alle manuellen Links l\u00F6schen';
    bUnlink.onclick = function() {
        if (!confirm('Alle manuellen Verbindungen l\u00F6schen?')) return;
        saveLinks([]);
        if (window._ntCy) window._ntCy.edges('[id^="ml_"]').remove();
    };

    // Mail-Button (eigenständig, nutzt kompakteren Mail-Renderer)
    setupMailButton(mkbtn);

    // Severity-Filter-Pills
    if (bar) buildSevFilter(bar, cy);

    // Suchfeld (einmalig)
    if (!document.getElementById('nt-search-input')) {
        const si = document.createElement('input');
        si.id = 'nt-search-input';
        si.type = 'text';
        si.placeholder = 'Host suchen...';
        si.style.cssText = 'width:140px;height:26px;font-size:12px;margin-left:8px;padding:0 8px;'
            + 'border:1px solid #e2e8f0;border-radius:4px;outline:none;background:#fff;color:#334155';
        si.addEventListener('input', function() {
            const q = this.value.toLowerCase();
            cy.nodes('[!isGroup]').forEach(function(n) {
                n.style('opacity', !q || (n.data('label') || '').toLowerCase().indexOf(q) >= 0 ? 1 : 0.15);
            });
        });
        if (bar) bar.appendChild(si);
    }

}
