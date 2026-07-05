// tabs.js — Basis-Toolbar (Tabs + Dark-Mode-Button + Snapshot) und Dark-Mode-Logic.
//
// Snapshot-Button merkt den aktuellen Daten-Stand in localStorage (siehe
// diff-mode.js). Views koennen dann zeigen was sich veraendert hat —
// nuetzlich z.B. nach einem Schichtwechsel.
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
import { saveSnapshot, loadSnapshot, clearSnapshot, formatSnapshotAge } from './diff-mode.js';
import { t } from './i18n.js';

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

    // Tab-Wrap (einmal anlegen). Diag-Tab nur fuer Admins (NT_CONFIG.can_edit) —
    // das Backend prueft nochmal, aber wir zeigen den Tab im UI gleich nicht an.
    const isAdmin = !!(window.NT_CONFIG && window.NT_CONFIG.can_edit);
    const TABS = [
        { id: 'nt-tab-tech',       lbl: t('tabs.tech'),   tab: 'tech' },
        { id: 'nt-tab-mgmt',       lbl: t('tabs.mgmt'),   tab: 'mgmt' },
        { id: 'nt-tab-tree',       lbl: t('tabs.table'),  tab: 'tree' },
        { id: 'nt-tab-geo',        lbl: t('tabs.geo'),    tab: 'geo'  },
        { id: 'nt-tab-health',     lbl: t('tabs.health'), tab: 'health' },
        { id: 'nt-tab-stats',      lbl: t('tabs.stats'),  tab: 'stats' },
        { id: 'nt-tab-lldpq',      lbl: t('tabs.lldpq'),  tab: 'lldpq', dataOptional: true },
    ];
    // Compliance zeigt Security-Posture pro Host ("Agent ohne TLS", SNMP-
    // Versionen) — nur fuer Admins. Backend prueft >= ZABBIX_ADMIN nochmal.
    if (isAdmin) TABS.push({ id: 'nt-tab-compliance', lbl: t('tabs.compliance'), tab: 'compliance', dataOptional: true });
    // Diag-Tab nur fuer Super-Admins (Backend prueft USER_TYPE_SUPER_ADMIN ===)
    const isSuperAdmin = !!(window.NT_CONFIG && window.NT_CONFIG.is_super_admin);
    if (isSuperAdmin) TABS.push({ id: 'nt-tab-diag', lbl: t('tabs.diag'), tab: 'diag', dataOptional: true });

    if (!document.getElementById('nt-tab-wrap')) {
        const tw = document.createElement('div');
        tw.id = 'nt-tab-wrap';
        tw.style.cssText = 'display:flex;gap:2px;margin-right:8px;padding-right:8px;'
                         + 'border-right:1px solid #e2e8f0;flex-shrink:0';
        TABS.forEach(function(item) {
            const b = document.createElement('button');
            b.id = item.id; b.textContent = item.lbl;
            b.className = 'btn-alt btn-small';
            b.style.margin = '0';
            b.addEventListener('click', function() {
                const d = window._ntLastData || {};
                // Diag-Tab braucht keine Hosts-Daten (rein Stats)
                if (!item.dataOptional && (!d.nodes || !d.nodes.length)) return;
                if (window.switchTab) window.switchTab(item.tab, wrap, d.nodes || [], d.edges || [], d.url || '');
            });
            tw.appendChild(b);
        });
        bar.insertBefore(tw, bar.firstChild);
    }
    // Falls Diag-Tab nachtraeglich noetig ist (z.B. NT_CONFIG kommt spaeter): ergaenzen
    if (isSuperAdmin && !document.getElementById('nt-tab-diag')) {
        const tw = document.getElementById('nt-tab-wrap');
        const b = document.createElement('button');
        b.id = 'nt-tab-diag'; b.textContent = t('tabs.diag');
        b.className = 'btn-alt btn-small';
        b.style.margin = '0';
        b.addEventListener('click', function() {
            const d = window._ntLastData || {};
            if (window.switchTab) window.switchTab('diag', wrap, d.nodes || [], d.edges || [], d.url || '');
        });
        if (tw) tw.appendChild(b);
    }

    // Aktiven Tab-State immer aktualisieren (auch wenn Tabs schon existieren)
    TABS.forEach(function(item) {
        const b = document.getElementById(item.id);
        if (b) {
            b.style.background = activeTab === item.tab ? '#3b82f6' : '';
            b.style.color      = activeTab === item.tab ? '#fff'    : '';
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

    // Snapshot/Diff-Buttons (einmal anlegen). Snapshot speichert den
    // aktuellen Stand in localStorage; sobald gesetzt zeigt die Tabelle (und
    // perspektivisch andere Views) was sich veraendert hat. Clear-Button
    // erscheint nur wenn ein Snapshot existiert.
    if (!document.getElementById('nt-btn-snap')) {
        const bSnap = document.createElement('button');
        bSnap.id = 'nt-btn-snap';
        bSnap.className = 'btn-alt btn-small';
        bSnap.style.marginLeft = '4px';
        bSnap.addEventListener('click', function() {
            const d = window._ntLastData || {};
            if (!d.nodes || !d.nodes.length) return;
            saveSnapshot(d.nodes);
            ensureBaseToolbar(wrap);     // Button-Label aktualisieren
            if (window.switchTab) window.switchTab(_getActiveTab(), wrap, d.nodes, d.edges || [], d.url || '');
        });
        bar.appendChild(bSnap);

        const bClear = document.createElement('button');
        bClear.id = 'nt-btn-snap-clear';
        bClear.className = 'btn-alt btn-small';
        bClear.style.marginLeft = '2px';
        bClear.textContent = '✕';
        bClear.title = t('toolbar.snapshot.del');
        bClear.addEventListener('click', function() {
            clearSnapshot();
            ensureBaseToolbar(wrap);
            const d = window._ntLastData || {};
            if (window.switchTab && d.nodes) window.switchTab(_getActiveTab(), wrap, d.nodes, d.edges || [], d.url || '');
        });
        bar.appendChild(bClear);
    }
    // Label / Visibility der Snap-Buttons gemaess aktuellem Snapshot-State
    const snap = loadSnapshot();
    const bSnapEl  = document.getElementById('nt-btn-snap');
    const bClearEl = document.getElementById('nt-btn-snap-clear');
    if (bSnapEl) {
        bSnapEl.textContent = snap ? t('toolbar.snapshot.diff', { age: formatSnapshotAge(snap) }) : t('toolbar.snapshot');
        bSnapEl.title = snap ? t('toolbar.snapshot.new') : t('toolbar.snapshot.set');
    }
    if (bClearEl) bClearEl.style.display = snap ? '' : 'none';

    // Buttons in 3 Menu-Gruppen (Anzeige/Layout/Tools) sortieren — idempotent,
    // bewegt nur was noch nicht im richtigen Menu ist. Reduziert die Toolbar
    // von ~25 sichtbaren Buttons auf primary + 3 Dropdowns.
    regroupToolbar();
}

// Alter Name behalten — wird noch im Hauptmodul aufgerufen, delegiert
export function ensureTabs(wrap) { ensureBaseToolbar(wrap); }

// Graph-spezifische Toolbar-Elemente die NUR im Tech-Tab Sinn ergeben.
// Mgmt/Tabelle/Geo brauchen weder Cytoscape-Zoom noch Layout-Switcher noch
// Cluster-Toggle, weil sie kein Cytoscape-Canvas haben.
//
// Universelle Elemente (Tabs, Dark, Fullscreen, Auto-Refresh, Historie,
// Export) bleiben sichtbar — die fetchen Daten bzw. greifen tab-uebergreifend.
//
// WICHTIG: wir steuern die Sichtbarkeit ueber eine Body-Klasse + CSS-Rule,
// NICHT ueber inline el.style.display. Inline-Override wuerde den
// urspruenglichen display-Wert (display:flex am sev-filter-wrap, inline-block
// am layout-wrap etc.) zerstoeren, wenn wir ihn auf '' zurueck setzen — das
// macht z.B. Pills vertikal weil der wrap dann zum Default block faellt.
// Mit CSS-Klasse bleiben die Originalstyles unangetastet.
const _GRAPH_ONLY_SELECTORS = [
    '#nt-btn-labels',     // Hide Labels
    '.nt-zoom-btns',      // +/-/100% Wrapper
    '#nt-btn-reset',      // Fit
    '#nt-layout-wrap',    // Layout-Dropdown
    '#nt-btn-groupview',  // Gruppieren
    '#nt-cluster-wrap',   // Cluster-Mode-Toggle
    '#nt-btn-lldp',       // LLDP an/aus
    '#nt-btn-weathermap', // Weathermap-Modus (Auslastungs-%)
    '#nt-btn-portlabels', // Port-Labels an Edge-Enden
    '#nt-btn-rootcause',  // Root-Cause-Analyse
    '#nt-btn-link',       // Link-Mode
    '#nt-btn-unlink',     // Links entfernen
    '#nt-preset-wrap',    // Presets + Save/Erase/Trash
    '#nt-sev-filter',     // Severity-Pills (Tabelle hat eigene)
    '#nt-search-input',   // Host-Suche (Tabelle hat eigene)
    '#nt-taphold-wrap',   // Touch-Long-Press-Picker
];

// Stellt sicher dass die CSS-Rule fuer das Hide-Verhalten existiert.
// Einmal pro Page-Load via Style-Element angehaengt — keine externe CSS noetig.
function _ensureGraphHideStyle() {
    if (document.getElementById('nt-graph-hide-style')) return;
    const st = document.createElement('style');
    st.id = 'nt-graph-hide-style';
    st.textContent = 'body.nt-graph-hidden ' + _GRAPH_ONLY_SELECTORS.join(',body.nt-graph-hidden ')
        + ' { display: none !important; }';
    document.head.appendChild(st);
}

// Blendet Graph-Toolbar-Elemente aus (false) oder ein (true).
// Wird von switchTab im Hauptmodul aufgerufen — je nach aktivem Tab.
export function setGraphToolbarVisible(visible) {
    _ensureGraphHideStyle();
    document.body.classList.toggle('nt-graph-hidden', !visible);
}

// ── Toolbar-Menus ──────────────────────────────────────────────────────────
// Reduziert die ueberladene Toolbar (~25 Buttons) auf 3 Dropdown-Gruppen
// (Anzeige / Layout / Tools) plus die wirklich oft genutzten Primary-Buttons.
//
// Strategie: alle Buttons werden weiter von ihren Modulen (toolbar.js,
// presets-ui.js, history-mode.js) gebaut wie bisher. Nach dem Bauen ruft
// ensureBaseToolbar regroupToolbar(), die per ID die Buttons in die Menu-
// Pops verschiebt. Idempotent — schon bewegte Buttons werden nicht erneut
// angefasst.

function _closeAllMenuPops() {
    document.querySelectorAll('[data-nt-menu-pop]').forEach(function(p) {
        p.style.display = 'none';
    });
}

// Outside-Click schliesst offene Menus (einmal pro Page-Load installieren).
function _ensureMenuOutsideHandler() {
    if (window._ntMenuHandlerDone) return;
    window._ntMenuHandlerDone = true;
    document.addEventListener('click', function(e) {
        const t = e.target;
        if (t && t.closest && t.closest('[data-nt-menu-pop],[data-nt-menu-trigger]')) return;
        _closeAllMenuPops();
    });
}

// CSS fuer Menu-Items im Pop — flach, einheitliche Hoehe, Hover-Highlight.
// Wird einmalig per Style-Tag eingehaengt damit wir die Original-btn-alt-
// Styles ueberschreiben koennen (mit !important wegen Inline-Style-Konflikten).
function _ensureMenuStyle() {
    if (document.getElementById('nt-menu-style')) return;
    const st = document.createElement('style');
    st.id = 'nt-menu-style';
    st.textContent = ''
        + '[data-nt-menu-pop] > button,'
        + '[data-nt-menu-pop] > div {'
        + '  display: block !important;'
        + '  width: 100% !important;'
        + '  text-align: left !important;'
        + '  margin: 0 0 1px 0 !important;'
        + '  padding: 6px 10px !important;'
        + '  border: 1px solid transparent !important;'
        + '  border-radius: 4px !important;'
        + '  background: transparent !important;'
        + '  color: #334155 !important;'
        + '  font-size: 12px !important;'
        + '  font-weight: 500 !important;'
        + '  cursor: pointer !important;'
        + '  box-shadow: none !important;'
        + '  white-space: nowrap !important;'
        + '  position: static !important;'
        + '}'
        + '[data-nt-menu-pop] > button:hover,'
        + '[data-nt-menu-pop] > div:hover {'
        + '  background: #f1f5f9 !important;'
        + '}'
        // Inner-Buttons (Layout-Wrap / Cluster-Wrap / Preset-Wrap haben einen
        // primary Button als Trigger + ein eigenes Sub-Menu). Den Trigger so
        // stylen dass er als Menu-Item wirkt.
        + '[data-nt-menu-pop] > div > button:first-child {'
        + '  display: block !important;'
        + '  width: 100% !important;'
        + '  text-align: left !important;'
        + '  margin: 0 !important;'
        + '  padding: 0 !important;'
        + '  border: none !important;'
        + '  background: transparent !important;'
        + '  color: inherit !important;'
        + '  box-shadow: none !important;'
        + '  font-size: 12px !important;'
        + '  font-weight: 500 !important;'
        + '}'
        // Inneres Submenu (z.B. Layout-Optionen) positioniert relativ zur
        // Pop-Wand statt absolute — damit es nicht weit ausserhalb schwebt.
        + '[data-nt-menu-pop] > div > div {'
        + '  position: static !important;'
        + '  background: #f8fafc !important;'
        + '  border: 1px solid #e2e8f0 !important;'
        + '  border-radius: 4px !important;'
        + '  margin-top: 4px !important;'
        + '  padding: 2px !important;'
        + '  box-shadow: none !important;'
        + '}'
        // Sub-Menu Items (Layout-Optionen)
        + '[data-nt-menu-pop] > div > div > button {'
        + '  display: block !important;'
        + '  width: 100% !important;'
        + '  text-align: left !important;'
        + '  margin: 0 !important;'
        + '  padding: 4px 8px !important;'
        + '  border: none !important;'
        + '  background: transparent !important;'
        + '  font-size: 11px !important;'
        + '  border-radius: 3px !important;'
        + '  cursor: pointer !important;'
        + '}'
        + '[data-nt-menu-pop] > div > div > button:hover {'
        + '  background: #e2e8f0 !important;'
        + '}'
        // Dark-Mode
        + '#nt-root.nt-dark [data-nt-menu-pop] {'
        + '  background: #1e293b !important;'
        + '  border-color: #334155 !important;'
        + '}'
        + '#nt-root.nt-dark [data-nt-menu-pop] > button,'
        + '#nt-root.nt-dark [data-nt-menu-pop] > div {'
        + '  color: #e2e8f0 !important;'
        + '}'
        + '#nt-root.nt-dark [data-nt-menu-pop] > button:hover,'
        + '#nt-root.nt-dark [data-nt-menu-pop] > div:hover {'
        + '  background: #334155 !important;'
        + '}';
    document.head.appendChild(st);
}

function _mkMenuShell(id, label) {
    let wrap = document.getElementById(id + '-wrap');
    if (wrap) return wrap;
    wrap = document.createElement('div');
    wrap.id = id + '-wrap';
    wrap.style.cssText = 'position:relative;display:inline-block;margin-left:4px';
    const btn = document.createElement('button');
    btn.id = id;
    btn.className = 'btn-alt btn-small';
    btn.style.margin = '0';
    btn.textContent = label + ' ▾';
    btn.dataset.ntMenuTrigger = '1';
    wrap.appendChild(btn);
    const pop = document.createElement('div');
    pop.id = id + '-pop';
    pop.dataset.ntMenuPop = '1';
    pop.style.cssText = 'display:none;position:absolute;top:100%;right:0;'
        + 'background:#fff;border:1px solid #cbd5e1;border-radius:6px;'
        + 'box-shadow:0 6px 20px rgba(0,0,0,0.14);padding:6px;min-width:170px;'
        + 'z-index:9000;margin-top:4px';
    wrap.appendChild(pop);
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const wasOpen = pop.style.display !== 'none' && pop.style.display !== '';
        _closeAllMenuPops();
        if (!wasOpen) pop.style.display = 'block';
    });
    return wrap;
}

// Verschiebt ein bestehendes Element in einen Menu-Pop. Idempotent.
// Inline-Styles werden geloescht — das Item-Styling kommt aus _ensureMenuStyle().
function _moveIntoMenu(srcId, menuId) {
    const el = document.getElementById(srcId);
    const pop = document.getElementById(menuId + '-pop');
    if (!el || !pop) return;
    if (el.parentNode === pop) return;
    // Inline-Margins/Display zurueck — CSS uebernimmt
    el.style.removeProperty('margin');
    el.style.removeProperty('margin-left');
    el.style.removeProperty('margin-right');
    el.style.removeProperty('margin-top');
    el.style.removeProperty('margin-bottom');
    el.style.removeProperty('display');
    el.style.removeProperty('position');
    pop.appendChild(el);
}

function regroupToolbar() {
    _ensureMenuOutsideHandler();
    _ensureMenuStyle();
    const bar = document.querySelector('.nt-topbar__actions');
    if (!bar) return;

    // Menu-Shells anlegen (idempotent). Reihenfolge im DOM: Anzeige, Layout, Tools.
    const mView   = _mkMenuShell('nt-menu-view',   t('toolbar.menu.view'));
    const mLayout = _mkMenuShell('nt-menu-layout', t('toolbar.menu.layout'));
    const mTools  = _mkMenuShell('nt-menu-tools',  t('toolbar.menu.tools'));
    if (!mView.parentNode)   bar.appendChild(mView);
    if (!mLayout.parentNode) bar.appendChild(mLayout);
    if (!mTools.parentNode)  bar.appendChild(mTools);

    // Buttons in Menus einsortieren
    _moveIntoMenu('nt-btn-dark',       'nt-menu-view');
    _moveIntoMenu('nt-btn-fullscreen', 'nt-menu-view');
    _moveIntoMenu('nt-btn-labels',     'nt-menu-view');   // Tech-only, im Mgmt/Tabelle leer
    _moveIntoMenu('nt-btn-reset',      'nt-menu-view');
    _moveIntoMenu('nt-btn-weathermap', 'nt-menu-view');
    _moveIntoMenu('nt-btn-portlabels', 'nt-menu-view');

    _moveIntoMenu('nt-layout-wrap',    'nt-menu-layout');
    _moveIntoMenu('nt-btn-groupview',  'nt-menu-layout');
    _moveIntoMenu('nt-cluster-wrap',   'nt-menu-layout');

    _moveIntoMenu('nt-btn-snap',       'nt-menu-tools');
    _moveIntoMenu('nt-btn-snap-clear', 'nt-menu-tools');
    _moveIntoMenu('nt-btn-link',       'nt-menu-tools');
    _moveIntoMenu('nt-btn-unlink',     'nt-menu-tools');
    _moveIntoMenu('nt-btn-history',    'nt-menu-tools');
    _moveIntoMenu('nt-btn-rootcause',  'nt-menu-tools');
    _moveIntoMenu('nt-preset-wrap',    'nt-menu-tools');

    // Layout-Menu wird in Mgmt/Tabelle/Geo komplett ausgeblendet (alle
    // Inhalte sind Tech-spezifisch). Tools/Anzeige bleiben sichtbar weil
    // sie auch tab-uebergreifende Items haben (Dark, Snapshot).
    const layoutWrap = document.getElementById('nt-menu-layout-wrap');
    if (layoutWrap && _GRAPH_ONLY_SELECTORS.indexOf('#nt-menu-layout-wrap') < 0) {
        _GRAPH_ONLY_SELECTORS.push('#nt-menu-layout-wrap');
        // Style refreshen damit der neue Selector greift
        const oldStyle = document.getElementById('nt-graph-hide-style');
        if (oldStyle) oldStyle.remove();
        _ensureGraphHideStyle();
        // Body-Klasse re-toggle damit die neue Rule sofort wirkt
        if (document.body.classList.contains('nt-graph-hidden')) {
            document.body.classList.remove('nt-graph-hidden');
            document.body.classList.add('nt-graph-hidden');
        }
    }
}
