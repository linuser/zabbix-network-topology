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
import { loadGhostMode, loadRings } from './storage.js';
import { analyseRings } from './rings.js';
import { setSevLevels, activeSevLevels, setSlaOnly, activeSlaOnly } from './sev-filter.js';
import { businessplanGlyph } from './icons.js';

// Welche Severity-Stufen hinter einer klickbaren Kachel stehen — dieselben
// Toepfe wie in collect() (OK=0, Warn=1-3, Crit=4-5). "Hosts" = [] = Filter aus.
const KACHEL_SEV = { hosts: [], ok: [0], warn: [1, 2, 3], crit: [4, 5] };

// Mengengleichheit zweier Zahl-Arrays (Reihenfolge egal) — fuer Toggle und die
// Aktiv-Markierung: ist der aktive Filter genau diese Kachel?
function gleicheMenge(a, b) {
    if (a.length !== b.length) return false;
    const sa = a.slice().sort(function(x, y) { return x - y; });
    const sb = b.slice().sort(function(x, y) { return x - y; });
    return sa.every(function(v, i) { return v === sb[i]; });
}

const COL = {
    neutral: { light: '#334155', dark: '#f1f5f9' },
    ok:      { light: '#16a34a', dark: '#22c55e' },
    warn:    { light: '#d97706', dark: '#f59e0b' },
    crit:    { light: '#dc2626', dark: '#ef4444' },
    link:    { light: '#7c3aed', dark: '#a78bfa' },
    ghost:   { light: '#64748b', dark: '#94a3b8' },
    ring:    { light: '#0891b2', dark: '#22d3ee' },
    loop:    { light: '#dc2626', dark: '#f87171' },
    churn:   { light: '#d97706', dark: '#f59e0b' },
    // SLA: bewusst eine EIGENE Achse, keine Severity-Farbe (gruen/amber/rot) und
    // nicht das Violett der Kanten-Pille (col.link) — sonst staenden zwei
    // violette Chips nebeneinander. Magenta liest sich als eigene Dimension
    // ("kostet es etwas", nicht "wie schlimm").
    sla:     { light: '#be185d', dark: '#f472b6' },
    muted:   { light: '#94a3b8', dark: '#64748b' }
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

/**
 * Ein Chip: [Punkt] Zahl Label (Zusatz).
 *
 * `filter` (optional): { levels:Array<number>, cy } macht den Chip zu einem
 * Severity-Filter — Klick setzt den Toolbar-Sev-Filter auf diese Stufen
 * (nochmal auf denselben → aus). Der aktive Chip wird markiert. Dieselbe
 * Mechanik wie die feinen Pills, nur grob pro Topf.
 */
function chip(value, label, colour, sub, filter) {
    const el = document.createElement('div');
    el.className = 'nt-kpi__chip';

    if (filter && filter.cy) {
        const aktiv = gleicheMenge(activeSevLevels(), filter.levels);
        el.style.cursor = 'pointer';
        el.title = t('kpi.filter.tip');
        if (aktiv) {
            // Markiert: dezenter Ring in der Chip-Farbe. Inset, damit die Zeile
            // nicht springt (kein zusaetzlicher Platz wie bei aussenliegendem
            // box-shadow).
            el.style.boxShadow = 'inset 0 0 0 1.5px ' + (colour || col('neutral'));
            el.style.borderRadius = '9px';
        }
        el.addEventListener('click', function() {
            const same = gleicheMenge(activeSevLevels(), filter.levels);
            setSevLevels(filter.cy, same ? [] : filter.levels);
            refreshKpi();   // Zeile neu, damit die Aktiv-Markierung umspringt
        });
    }

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

/**
 * Die SLA-Pille: wie ein chip(), aber mit businessplan-Glyph statt Punkt und
 * auf einer EIGENEN Filter-Achse (nur SLA-relevante Hosts), nicht Severity.
 *
 *   count > 0  magenta, 2px-Rahmen (einziger hervorgehobene Chip), klickbar →
 *              toggelt setSlaOnly(); Sub nennt die Zahl im Verhaeltnis.
 *   count = 0  grau, "alles erfuellt", NICHT klickbar (ein Filter auf nichts).
 *
 * Die graue 0 bleibt bewusst stehen (statt die Pille zu verstecken): die
 * Aussage "SLA wird ueberwacht und ist gruen" ist selbst eine Information.
 */
function slaChip(count, problemHosts, cy) {
    const active = count > 0;
    const colour = active ? col('sla') : col('muted');

    const el = document.createElement('div');
    el.className = 'nt-kpi__chip';
    if (active) {
        // Einziger Chip mit 2px-Rahmen in seiner Farbe — faellt auf, ohne ein
        // weiteres Signal an den Knoten zu haengen.
        el.style.border = '2px solid ' + colour;
        el.style.cursor = 'pointer';
        el.title = t('kpi.sla.tip');
        if (cy && activeSlaOnly()) {
            el.style.boxShadow = 'inset 0 0 0 1.5px ' + colour;
            el.style.borderRadius = '9px';
        }
        el.addEventListener('click', function() {
            setSlaOnly(cy, !activeSlaOnly());
            refreshKpi();   // Aktiv-Markierung umspringen lassen
        });
    }

    el.appendChild(businessplanGlyph(colour, 15));

    const n = document.createElement('span');
    n.className = 'nt-kpi__n';
    n.style.color = colour;
    n.textContent = String(count);
    el.appendChild(n);

    const k = document.createElement('span');
    k.className = 'nt-kpi__k';
    k.textContent = t('kpi.sla');
    el.appendChild(k);

    const s = document.createElement('span');
    s.className = 'nt-kpi__sub';
    s.textContent = active ? t('kpi.sla.sub', { total: problemHosts }) : t('kpi.sla.allmet');
    el.appendChild(s);

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
export function collect(nodes, cy) {
    // Was kein ueberwachter Host ist, wird auch nicht als einer gezaehlt: ein
    // Ghost ist ein Geraet, ueber das wir nichts wissen, die Internet-Wolke im
    // Hierarchie-Layout ist gar kein Geraet. Beide tragen severity 0 und liefen
    // sonst als "OK" durch — genau das stand auf der Karte: 12 Hosts bei 11
    // echten, und ein gruenes Kaestchen zu viel.
    //
    // Die Aufrufer uebergeben inzwischen alle die rohe Hostliste, in der das
    // gar nicht vorkommt. Der Filter bleibt trotzdem: er ist die Stelle, an der
    // "Hosts" definiert ist, und ohne ihn haengt die Richtigkeit der Zeile
    // daran, dass jeder kuenftige Aufrufer dasselbe weiss.
    const base = nodes.filter(function(n) { return !n._isGhost && !n._isInternet; });

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
            // Synthetische Kanten zaehlen nicht als gemessene Links: der Ghost
            // war nie gezaehlt, und ebensowenig gehoeren die Internet-Wolke
            // (_isInternetEdge) und die Buendel-Kante (_isBundleEdge) in die
            // Zahl "Edges"/"LLDP links". Sie tragen isLLDP:false, aber der KPI
            // leitet lldp aus (edges - manual) ab und liest isLLDP nicht —
            // deshalb hier ausschliessen, nicht ueber isLLDP. (Der Review-Fix,
            // der isLLDP:false an die Buendel-Kante haengte, griff hier nie.)
            if (e.data('_isGhostEdge') || e.data('_isInternetEdge')
                    || e.data('_isBundleEdge')) return;
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
        ? Math.max(0, injectGhostNodes(base, [], lq, loadGhostMode()).nodes.length - base.length)
        : 0;

    // Sind sie zwar gezaehlt, aber im Graphen ausgeblendet? Dann sagt die
    // Kachel das dazu — sonst sucht jemand drei Knoten, die er nicht sieht.
    let ghostsHidden = true;
    ghostsHidden = loadGhostMode() === 'off';

    return {
        // base, nicht nodes: sonst zaehlt die Zeile Ghosts als Hosts mit und
        // "Hosts" ist groesser als OK + Warn + Crit — eine Zeile, die sichtbar
        // nicht aufgeht, sieht kaputt aus, egal wie die Zahlen gemeint waren.
        hosts: base.length, ok: ok, warn: warn, crit: crit,
        edges: edges, manual: manual, ghosts: ghosts,
        lldp: Math.max(0, edges - manual),
        ghostsHidden: ghostsHidden,
        // SLA-relevante Hosts aus derselben Quelle wie ok/warn/crit (base), damit
        // Zahl und Filterziel (Knoten mit sla_relevant) exakt uebereinstimmen.
        sla: base.filter(function(n) { return n.sla_relevant; }).length,
        // "von N Stoerungen" = Hosts mit mindestens einem Problem (warn + crit).
        problemHosts: warn + crit
    };
}

/**
 * Zeile aus dem letzten Fetch neu schreiben, ohne dass der Aufrufer die
 * Knotenliste kennen muss — fuer jede Stelle, die den Graphen veraendert.
 *
 * Ohne sie blieb der Zaehler nach einer gezogenen oder geloeschten Kante bis
 * zu 30 Sekunden auf dem alten Wert stehen: drei sichtbare Kanten, daneben
 * "0 Edges". Wer das sieht, haelt die Zahl fuer kaputt, nicht fuer veraltet.
 */
export function refreshKpi() {
    const d = window._ntLastData || {};
    updateKpi(d.nodes || [], window._ntCy || null);
}

/** Schreibt die Zeile neu. nodes ist die rohe Hostliste aus dem Backend. */
export function updateKpi(nodes, cy) {
    const row = ensureKpiRow();
    if (!row) return;
    // Der Management-Tab blendet diese technische Zeile aus (Edges/Ghosts/STP
    // sind dort fehl am Platz). Beim Zurueckwechseln auf Technical wieder zeigen.
    row.style.display = '';

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

    // Hosts/OK/Warn/Crit sind klickbare Severity-Filter (Hosts = alle). Edges
    // und Ghosts bleiben reine Anzeige: Edges ist keine Host-Severity, und
    // Ghosts waeren bei ausgeblendeten Geistern ein Filter auf nichts.
    const fcy = cy || window._ntCy || null;
    const flt = function(key) { return fcy ? { levels: KACHEL_SEV[key], cy: fcy } : null; };

    row.appendChild(chip(g.hosts, t('kpi.hosts'), null, '', flt('hosts')));
    row.appendChild(chip(g.ok,    t('kpi.ok'),    col('ok'),   '', flt('ok')));
    row.appendChild(chip(g.warn,  t('kpi.warn'),  col('warn'), '', flt('warn')));
    row.appendChild(chip(g.crit,  t('kpi.crit'),  col('crit'), '', flt('crit')));
    // SLA-Relevanz direkt bei den Problem-Chips (beantwortet "kostet es etwas",
    // nicht "wie schlimm"). Immer sichtbar — die graue 0 ist selbst Aussage.
    row.appendChild(slaChip(g.sla, g.problemHosts, fcy));
    row.appendChild(chip(g.edges, t('kpi.edges'), col('link'),
        g.manual ? t('kpi.edges.manual', { n: g.manual }) : ''));
    row.appendChild(chip(g.ghosts, t('kpi.ghosts'), col('ghost'), ghostSub));

    // Ringe nur zeigen, wenn der Toggle an ist (sonst stuende hier eine Zahl zu
    // einer Hervorhebung, die auf der Karte gar nicht liegt). Die Loop-Gefahr-
    // Pille erscheint nur, wenn STP-Daten einen ungeblockten Zyklus belegen.
    if (loadRings() && fcy) {
        const r = analyseRings(
            fcy.edges().map(function (e) { return e.data(); }),
            fcy.nodes().map(function (n) { return n.data(); }));
        if (r.totalRings > 0) {
            row.appendChild(chip(r.totalRings, t('kpi.rings'), col('ring'), ''));
            if (r.loopRisk > 0) {
                row.appendChild(chip(r.loopRisk, t('kpi.loop'), col('loop'), t('kpi.loop.sub')));
            }
        }
    }

    // STP-Instabilitaet: Hosts, deren Spanning-Tree staendig neu konvergiert
    // (dot1dStpTopChanges-Rate ueber der Schwelle) = Loop-Fruehwarnung. Unabhaengig
    // vom Rings-Toggle, weil es ein allgemeines Gesundheitssignal ist.
    if (fcy) {
        const churn = fcy.nodes().filter(function (n) { return n.data('_stpChurn') === true; }).length;
        if (churn > 0) {
            row.appendChild(chip(churn, t('kpi.stpchurn'), col('churn'), t('kpi.stpchurn.sub')));
        }
        // Broadcast-Storm: aktiver Loop JETZT. Eigene Pille, rot, unabhaengig vom Toggle.
        const storm = fcy.nodes().filter(function (n) { return n.data('_bcastStorm') === true; }).length;
        if (storm > 0) {
            row.appendChild(chip(storm, t('kpi.bcaststorm'), col('loop'), t('kpi.bcaststorm.sub')));
        }
        // MAC-Flapping: MACs wandern zwischen Ports (Loop). Eigene Pille, rot.
        const flap = fcy.nodes().filter(function (n) { return n.data('_macFlap') === true; }).length;
        if (flap > 0) {
            row.appendChild(chip(flap, t('kpi.macflap'), col('loop'), t('kpi.macflap.sub')));
        }
        // Soll/Ist: erwartete Verkabelung (nt:expect), die nicht gemessen wird.
        // Unabhaengig vom Overlay-Toggle — eine Abweichung (umgestecktes Kabel)
        // ist ein Befund, den man nicht uebersehen soll. Zahl aus der Payload,
        // nicht aus dem Graphen (die fehlenden Kanten sind nur Overlay).
        const si  = (window._ntLastData && window._ntLastData.expected_links) || null;
        const dev = (si && Array.isArray(si.deviations)) ? si.deviations.length : 0;
        if (dev > 0) {
            row.appendChild(chip(dev, t('kpi.expected'), col('loop'), t('kpi.expected.sub')));
        }
        // STP blocking: ein Host hat einen per Spanning-Tree geblockten Port.
        // Oft normale Redundanz (RSTP sperrt einen Ring-Zweig), aber auch der
        // EINZIGE sichtbare Hinweis auf einen per STP gefangenen (Selbst-)Loop,
        // der keine Kante bildet und sonst nirgends auftaucht. Neutrale cyan-
        // Farbe (STP tut seinen Job), ungated.
        const blocked = fcy.nodes().filter(function (n) { return n.data('_stpBlock') === true; }).length;
        if (blocked > 0) {
            row.appendChild(chip(blocked, t('kpi.stpblock'), col('ring'), t('kpi.stpblock.sub')));
        }
    }
}
