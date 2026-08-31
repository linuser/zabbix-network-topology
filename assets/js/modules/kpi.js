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
import { injectGhostNodes } from './build-elements.js';
import { NT_GHOSTS_KEY } from './storage.js';

const COL = {
    neutral: { light: '#334155', dark: '#f1f5f9' },
    ok:      { light: '#16a34a', dark: '#22c55e' },
    warn:    { light: '#d97706', dark: '#f59e0b' },
    crit:    { light: '#dc2626', dark: '#ef4444' },
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
    // Ghosts raus, BEVOR irgendetwas gezaehlt wird. Bei aktivem Toggle uebergibt
    // render-tech.js das bereits angereicherte Array, und ein Ghost ist kein
    // Host: er hat severity 0 und liefe damit als "OK" durch, waehrend er in
    // Wahrheit ein Geraet ist, ueber das wir gar nichts wissen. Genau das stand
    // auf der Karte — 12 Hosts bei 11 echten, und ein grünes Kaestchen zu viel.
    const base = nodes.filter(function(n) { return !n._isGhost; });

    // Severity-Stufen sind ['Normal','Info','Warning','Average','High','Disaster'].
    //
    // Die alte, nie ausgefuehrte updateBadge()-Logik warf alles ausser 0 und
    // >=5 in einen Topf "Warn" — damit stand ein High-Problem unter "Warn",
    // waehrend die Toolbar direkt darueber getrennte Pillen fuer Warn, Avg und
    // High zeigt und der Knoten im Graphen rot leuchtet. Deshalb hier:
    //   ok    Normal
    //   warn  Info, Warning, Average   (1-3)
    //   crit  High, Disaster           (4-5)
    let ok = 0, warn = 0, crit = 0;

    base.forEach(function(n) {
        const s = n.severity || 0;
        if (s === 0)     ok++;
        else if (s >= 4) crit++;
        else             warn++;
    });

    let edges = 0, manual = 0;

    if (cy) {
        cy.edges().forEach(function(e) {
            if (e.data('_isGhostEdge')) return;
            edges++;
            if (String(e.id()).indexOf('ml_') === 0) manual++;
        });
    }

    // Ghosts NICHT aus dem Graphen zaehlen: sie werden nur injiziert, wenn der
    // Toolbar-Toggle an ist (Default aus). Sonst stuende hier "0 Ghosts", waehrend
    // es in Wahrheit welche gibt — eine Null, die etwas behauptet statt zu messen.
    //
    // Gezaehlt wird stattdessen aus derselben Quelle, aus der auch injiziert
    // wird. injectGhostNodes ist frei von Nebenwirkungen (nodes.concat), laesst
    // sich also gefahrlos zum Zaehlen aufrufen — und weil es dieselbe Funktion
    // ist, koennen Zaehlung und Darstellung nicht auseinanderlaufen.
    //
    // Deshalb laeuft es ueber base und nicht ueber nodes: injectGhostNodes
    // ueberspringt jede ID, die es schon kennt ("if (known[gid]) return"). Mit
    // dem angereicherten Array waere die Differenz null — also ausgerechnet
    // dann "0 Ghosts", wenn sie sichtbar auf der Karte liegen. Der Refresh-Pfad
    // uebergibt data.nodes und zaehlte richtig, wodurch sich die Zahl nach 30 s
    // von selbst korrigierte: schwer zu melden, schwer zu glauben.
    const lq = (window._ntLastData && window._ntLastData.lldp_quality) || [];
    const ghosts = lq.length
        ? Math.max(0, injectGhostNodes(base, [], lq).nodes.length - base.length)
        : 0;

    // Sind sie zwar gezaehlt, aber im Graphen ausgeblendet? Dann sagt die
    // Kachel das dazu — sonst sucht jemand drei Knoten, die er nicht sieht.
    let ghostsHidden = true;
    try { ghostsHidden = localStorage.getItem(NT_GHOSTS_KEY) !== '1'; } catch (e) {}

    return {
        hosts: nodes.length, ok: ok, warn: warn, crit: crit,
        edges: edges, manual: manual, ghosts: ghosts,
        lldp: Math.max(0, edges - manual),
        ghostsHidden: ghostsHidden
    };
}

/**
 * Schreibt die Zeile neu. Wird bei jedem render und bei jedem Auto-Refresh
 * gerufen.
 */
/**
 * Zeile aus dem aktuellen Stand neu schreiben, ohne dass der Aufrufer die
 * Knotenliste kennen muss.
 *
 * ANLASS
 * ------
 * updateKpi lief nur an zwei Stellen: beim Render und beim 30-Sekunden-
 * Refresh. Wer im Star-Mode eine Kante zog oder alle Links loeschte, sah die
 * Aenderung sofort im Graphen — der Zaehler daneben blieb bis zu 30 Sekunden
 * auf dem alten Wert stehen. Aufgefallen ist es auf einem Screenshot: drei
 * sichtbare Kanten, daneben "0 Edges". Wer das sieht, haelt die Zahl fuer
 * kaputt, nicht fuer veraltet — und hat damit nicht ganz unrecht.
 *
 * Die Knotenliste steht in window._ntLastData; sie wird nach jedem Fetch dort
 * abgelegt. Deshalb braucht diese Funktion keine Argumente und passt an jede
 * Stelle, die den Graphen veraendert.
 */
export function refreshKpi() {
    const d = window._ntLastData || {};
    updateKpi(d.nodes || [], window._ntCy || null);
}

export function updateKpi(nodes, cy) {
    const row = ensureKpiRow();
    if (!row) return;

    const g = collect(nodes || [], cy || window._ntCy || null);

    row.textContent = '';
    row.classList.toggle('nt-kpi--tiles', isWallboard());

    // Ghosts zaehlen wir immer, gezeigt werden sie nur bei aktivem Toggle. Ist
    // er aus, sagt der Zusatz das — eine blanke 3 waere sonst irrefuehrend,
    // weil im Graphen nichts davon zu sehen ist.
    const ghostSub = g.ghosts && g.ghostsHidden ? t('kpi.ghosts.hidden') : '';

    if (isWallboard()) {
        // Vier Kacheln: verdichtet, weil aus drei Metern niemand sechs Zahlen
        // auseinanderhaelt. Warn und Krit wandern in eine Stoerungs-Kachel, die
        // Aufschluesselung steht klein darunter.
        const problems = g.warn + g.crit;
        row.appendChild(tile(g.hosts, t('kpi.hosts'), col('neutral'), ''));
        row.appendChild(tile(problems, t('kpi.problems'),
            problems ? col(g.crit ? 'crit' : 'warn') : col('ok'),
            t('kpi.problems.split', { crit: g.crit, warn: g.warn })));
        row.appendChild(tile(g.edges, t('kpi.edges'), col('link'),
            t('kpi.edges.split', { lldp: g.lldp, manual: g.manual })));
        row.appendChild(tile(g.ghosts, t('kpi.unmonitored'), col('ghost'),
            ghostSub || t('kpi.unmonitored.sub')));
        return;
    }

    row.appendChild(chip(g.hosts, t('kpi.hosts'), null, ''));
    row.appendChild(chip(g.ok,    t('kpi.ok'),    col('ok'), ''));
    row.appendChild(chip(g.warn,  t('kpi.warn'),  col('warn'), ''));
    row.appendChild(chip(g.crit,  t('kpi.crit'),  col('crit'), ''));
    row.appendChild(chip(g.edges, t('kpi.edges'), col('link'),
        g.manual ? t('kpi.edges.manual', { n: g.manual }) : ''));
    row.appendChild(chip(g.ghosts, t('kpi.ghosts'), col('ghost'), ghostSub));
}
