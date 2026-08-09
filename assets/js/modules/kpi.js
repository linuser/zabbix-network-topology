// kpi.js — Kennzahlen-Zeile ueber der Karte.
//
// Vorgeschichte: in render-tech.js stand seit v4.18.3 ein updateBadge(), das
// Hosts/OK/Warn/Down in ein Element #nt-badge schreiben wollte. Dieses Element
// wurde nie angelegt — getElementById lieferte null, die Funktion stieg in
// Zeile 2 aus. Die Zahlen hat also nie jemand gesehen. Statt das zu flicken
// steht hier die Zeile, die es haette sein sollen.
//
// Zwei Darstellungen, dieselben Daten:
//
//   Chips (Standard)     kompakt, eine Zeile, ~40 px. Unter der Zeile liegt der
//                        Graph, und Hoehe die oben weggeht fehlt dem Canvas
//                        dauerhaft — deshalb ist das der Normalfall.
//   Kacheln (Wallboard)  gross, ablesbar aus drei Metern. Nur bei ?wallboard=1,
//                        wo der Bildschirm gross ist und jemand im Vorbeigehen
//                        hinschaut.
//
// Zwei der sechs Zahlen gibt es sonst nirgends im Modul:
//
//   Kanten   aufgeschluesselt nach Herkunft. Die Unterscheidung steckt in den
//            Element-IDs: "ml_" sind manuell gezogen, _isGhostEdge fuehrt zu
//            einem Ghost, der Rest kommt aus LLDP/CDP. Zeigt, wie weit die
//            automatische Erkennung ueberhaupt traegt.
//   Ghosts   per LLDP gemeldete Nachbarn ohne Host in Zabbix. Die einzige
//            Kennzahl hier, die zu etwas auffordert statt nur zu beschreiben:
//            Geraete, die im Netz stehen und nicht ueberwacht werden.
//
// Alles wird aus dem Cytoscape-Graphen gelesen — kein Backend, keine Action.
// Gebaut wird mit createElement/textContent statt innerHTML: die Labels kommen
// zwar aus t() und waeren harmlos, aber so bleibt die Zeile ohne Escaping-
// Disziplin korrekt und das XSS-Gate hat nichts zu pruefen.

import { t } from './i18n.js';

const COL = {
    neutral: { light: '#334155', dark: '#f1f5f9' },
    ok:      { light: '#16a34a', dark: '#22c55e' },
    warn:    { light: '#d97706', dark: '#f59e0b' },
    down:    { light: '#dc2626', dark: '#ef4444' },
    link:    { light: '#7c3aed', dark: '#a78bfa' },
    ghost:   { light: '#64748b', dark: '#94a3b8' }
};

function isWallboard() {
    return document.body.classList.contains('nt-wallboard');
}

function isDark() {
    const root = document.getElementById('nt-root');
    return !!(root && root.classList.contains('nt-dark'));
}

function col(name) {
    return COL[name][isDark() ? 'dark' : 'light'];
}

/**
 * Legt die Zeile einmalig an — direkt hinter der Topbar, ueber dem Canvas.
 * Idempotent wie ensureBaseToolbar(): jeder render-Pfad ruft das auf.
 */
export function ensureKpiRow() {
    let row = document.getElementById('nt-kpi');
    if (row) return row;

    const root = document.getElementById('nt-root');
    if (!root) return null;

    row = document.createElement('div');
    row.id = 'nt-kpi';
    row.className = 'nt-kpi';

    const topbar = root.querySelector('.nt-topbar');
    if (topbar && topbar.nextSibling) {
        root.insertBefore(row, topbar.nextSibling);
    }
    else if (topbar) {
        root.appendChild(row);
    }
    else {
        root.insertBefore(row, root.firstChild);
    }

    return row;
}

/** Ein Chip: [Punkt] Zahl Label (Zusatz). */
function chip(value, label, colour, sub) {
    const el = document.createElement('div');
    el.className = 'nt-kpi__chip';

    if (colour) {
        const dot = document.createElement('span');
        dot.className = 'nt-kpi__dot';
        dot.style.background = colour;
        el.appendChild(dot);
    }

    const n = document.createElement('span');
    n.className = 'nt-kpi__n';
    n.style.color = colour || col('neutral');
    n.textContent = String(value);
    el.appendChild(n);

    const k = document.createElement('span');
    k.className = 'nt-kpi__k';
    k.textContent = label;
    el.appendChild(k);

    if (sub) {
        const s = document.createElement('span');
        s.className = 'nt-kpi__sub';
        s.textContent = sub;
        el.appendChild(s);
    }

    return el;
}

/** Eine Kachel: Label oben, Punkt + grosse Zahl, Zusatz darunter. */
function tile(value, label, colour, sub) {
    const el = document.createElement('div');
    el.className = 'nt-kpi__tile';

    const k = document.createElement('div');
    k.className = 'nt-kpi__k';
    k.textContent = label;
    el.appendChild(k);

    const rowEl = document.createElement('div');
    rowEl.className = 'nt-kpi__row';

    const dot = document.createElement('span');
    dot.className = 'nt-kpi__dot';
    dot.style.background = colour || col('neutral');
    rowEl.appendChild(dot);

    const n = document.createElement('span');
    n.className = 'nt-kpi__big';
    n.style.color = colour || col('neutral');
    n.textContent = String(value);
    rowEl.appendChild(n);

    el.appendChild(rowEl);

    const s = document.createElement('div');
    s.className = 'nt-kpi__sub';
    s.textContent = sub || ' ';
    el.appendChild(s);

    return el;
}

/**
 * Zaehlt zusammen, was der Graph hergibt.
 *
 * nodes sind die Hosts aus dem Backend — Ghosts stecken NICHT darin, die
 * injiziert build-elements.js erst im Client. Deshalb kommen sie wie die
 * Kanten aus der Cytoscape-Instanz.
 */
function collect(nodes, cy) {
    let ok = 0, warn = 0, down = 0;

    nodes.forEach(function(n) {
        const s = n.severity || 0;
        if (s === 0)      ok++;
        else if (s >= 5)  down++;
        else              warn++;
    });

    let edges = 0, manual = 0, ghostEdges = 0, ghosts = 0;

    if (cy) {
        cy.edges().forEach(function(e) {
            if (e.data('_isGhostEdge')) { ghostEdges++; return; }
            edges++;
            if (String(e.id()).indexOf('ml_') === 0) manual++;
        });
        ghosts = cy.nodes().filter(function(n) {
            return n.data('type') === 'ghost';
        }).length;
    }

    return {
        hosts: nodes.length, ok: ok, warn: warn, down: down,
        edges: edges, manual: manual, ghostEdges: ghostEdges, ghosts: ghosts,
        lldp: Math.max(0, edges - manual)
    };
}

/**
 * Schreibt die Zeile neu. Wird bei jedem render und bei jedem Auto-Refresh
 * gerufen.
 */
export function updateKpi(nodes, cy) {
    const row = ensureKpiRow();
    if (!row) return;

    const g = collect(nodes || [], cy || window._ntCy || null);

    row.textContent = '';
    row.classList.toggle('nt-kpi--tiles', isWallboard());

    if (isWallboard()) {
        // Vier Kacheln: verdichtet, weil aus drei Metern niemand sechs Zahlen
        // auseinanderhaelt. Warn und Down wandern in eine Stoerungs-Kachel,
        // die Aufschluesselung steht klein darunter.
        const problems = g.warn + g.down;
        row.appendChild(tile(g.hosts, t('kpi.hosts'), col('neutral'), ''));
        row.appendChild(tile(problems, t('kpi.problems'),
            problems ? col(g.down ? 'down' : 'warn') : col('ok'),
            t('kpi.problems.split', { down: g.down, warn: g.warn })));
        row.appendChild(tile(g.edges, t('kpi.edges'), col('link'),
            t('kpi.edges.split', { lldp: g.lldp, manual: g.manual })));
        row.appendChild(tile(g.ghosts, t('kpi.unmonitored'), col('ghost'),
            t('kpi.unmonitored.sub')));
        return;
    }

    row.appendChild(chip(g.hosts, t('kpi.hosts'), null, ''));
    row.appendChild(chip(g.ok,    t('kpi.ok'),    col('ok'), ''));
    row.appendChild(chip(g.warn,  t('kpi.warn'),  col('warn'), ''));
    row.appendChild(chip(g.down,  t('kpi.down'),  col('down'), ''));
    row.appendChild(chip(g.edges, t('kpi.edges'), col('link'),
        g.manual ? t('kpi.edges.manual', { n: g.manual }) : ''));
    row.appendChild(chip(g.ghosts, t('kpi.ghosts'), col('ghost'), ''));
}
