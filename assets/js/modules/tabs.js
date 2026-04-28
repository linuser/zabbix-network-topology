// tabs.js — Basis-Toolbar (Tabs + Dark-Mode-Button) und Dark-Mode-Logic.
//
// ensureBaseToolbar() ist idempotent: wird von jedem render-Pfad aufgerufen,
// baut Tab-Wrap und Dark-Button nur wenn sie fehlen, und hält den aktiven
// Tab-Zustand synchron.
//
// applyDarkMode() schaltet das nt-root-Element zwischen normal/dunkel um und
// zieht passende Cytoscape-Styles nach (für den Tech-Tab) bzw. ruft den
// registrierten Re-Render-Callback (für den Management-Tab).
//
// Cross-Module-Glue:
//   - getActiveTab(): liefert den aktiven Tab; wird vom Hauptmodul gesetzt
//   - setMgmtRerenderCallback(): registriert die renderManagement()-Funktion,
//     damit Dark-Mode-Wechsel im Mgmt-Tab funktioniert ohne dass tabs.js direkt
//     von renderManagement() abhängt (zirkuläre Importe vermeiden).

import { grpColor } from './severity.js';

// State-Bridge: Hauptmodul setzt _getActiveTab beim init().
let _getActiveTab = function() { return 'tech'; };
let _onMgmtRerender = null;

export function setActiveTabGetter(fn) { _getActiveTab = fn; }
export function setMgmtRerenderCallback(fn) { _onMgmtRerender = fn; }

export function applyDarkMode(forceState) {
    const root = document.getElementById('nt-root');
    if (!root) return;
    const nowDark = (forceState !== undefined)
        ? !!forceState
        : !root.classList.contains('nt-dark');
    root.classList.toggle('nt-dark', nowDark);

    const btn = document.getElementById('nt-btn-dark');
    if (btn) btn.textContent = nowDark ? 'Light' : 'Dark';

    const activeTab = _getActiveTab();

    // Technisch aktiv → Cytoscape-Styles nachziehen
    if (activeTab === 'tech' && window._ntCy) {
        try {
            window._ntCy.nodes('[!isGroup]').style({
                'color': nowDark ? '#e2e8f0' : '#334155',
                'text-background-color': nowDark ? '#1e293b' : '#f8fafc'
            });
            window._ntCy.edges().style('line-color', nowDark ? '#334155' : '#cbd5e1');
            window._ntCy.nodes('[?isGroup]').forEach(function(n) {
                n.style('color', nowDark ? '#e2e8f0' : grpColor(n.data('label')));
            });
        } catch (e) {}
    }

    // Management aktiv → re-rendern, weil Kachel-Farben statisch gesetzt sind
    if (activeTab === 'mgmt' && _onMgmtRerender) {
        _onMgmtRerender();
    }
}

export function ensureBaseToolbar(wrap) {
    const bar = document.querySelector('.nt-topbar__actions');
    if (!bar) return;
    const activeTab = _getActiveTab();

    // Tab-Wrap (einmal anlegen)
    if (!document.getElementById('nt-tab-wrap')) {
        const tw = document.createElement('div');
        tw.id = 'nt-tab-wrap';
        tw.style.cssText = 'display:flex;gap:2px;margin-right:8px;padding-right:8px;'
                         + 'border-right:1px solid #e2e8f0;flex-shrink:0';
        [{ id: 'nt-tab-tech', lbl: 'Technisch',     tab: 'tech' },
         { id: 'nt-tab-mgmt', lbl: 'Management',    tab: 'mgmt' },
         { id: 'nt-tab-tree', lbl: 'Hierarchisch',  tab: 'tree' },
         { id: 'nt-tab-geo',  lbl: 'Geo',           tab: 'geo'  }].forEach(function(item) {
            const b = document.createElement('button');
            b.id = item.id; b.textContent = item.lbl;
            b.className = 'btn-alt btn-small';
            b.style.margin = '0';
            b.addEventListener('click', function() {
                const d = window._ntLastData || {};
                if (!d.nodes || !d.nodes.length) return;
                // window.switchTab wird vom Hauptmodul gesetzt — global, weil
                // andere Module (z.B. context-menu) ihn auch aufrufen können.
                if (window.switchTab) window.switchTab(item.tab, wrap, d.nodes, d.edges || [], d.url || '');
            });
            tw.appendChild(b);
        });
        bar.insertBefore(tw, bar.firstChild);
    }

    // Aktiven Tab-State immer aktualisieren (auch wenn Tabs schon existieren)
    ['tech', 'mgmt', 'tree', 'geo'].forEach(function(t) {
        const b = document.getElementById('nt-tab-' + t);
        if (b) {
            b.style.background = activeTab === t ? '#3b82f6' : '';
            b.style.color      = activeTab === t ? '#fff'    : '';
        }
    });

    // Dark-Button (einmal anlegen)
    if (!document.getElementById('nt-btn-dark')) {
        const bDark = document.createElement('button');
        bDark.id = 'nt-btn-dark';
        bDark.className = 'btn-alt btn-small';
        bDark.style.marginLeft = '4px';
        const isDark = !!(document.getElementById('nt-root')
                       && document.getElementById('nt-root').classList.contains('nt-dark'));
        bDark.textContent = isDark ? 'Light' : 'Dark';
        bDark.addEventListener('click', function() { applyDarkMode(); });
        bar.appendChild(bDark);
    }
}

// Alter Name behalten — wird noch im Hauptmodul aufgerufen, delegiert
export function ensureTabs(wrap) { ensureBaseToolbar(wrap); }
