// rings.js — Ring-/Loop-Erkennung aus dem vorhandenen LLDP/CDP-Nachbargraphen.
//
// Zwei getrennte Fragen (siehe ROADMAP "Loop-/Ring-Erkennung"):
//
//   1. "Gibt es Ringe in der Verkabelung?" — ein Zyklus im Nachbargraphen.
//      Billig, aus Daten, die das Modul ohnehin hat. Ein Ring ist MEIST
//      GEWOLLTE Redundanz (Ring-Topologie, Dual-Uplink), KEIN Fehler. Deshalb
//      heisst ein Zyklus hier "redundanter Pfad", nicht "Loop".
//
//   2. "Loopt gerade etwas?" — der gefaehrliche Fall ist ein Zyklus, in dem STP
//      KEINEN Zweig blockt (STP aus, fehlkonfiguriert, unmanaged Switch
//      brueckt). Das unterscheidet erst der STP-Portstatus, den die Kante seit
//      5.5.36 traegt (_isStpBlocked / stpSrc / stpTgt). Konservativ: ohne
//      STP-Daten wird NICHT gewarnt — getarnte Redundanz als Alarm waere
//      schlimmer als gar keine Anzeige.
//
// Rein und ohne Cytoscape-Abhaengigkeit, damit es in check-frontend.mjs
// vollstaendig testbar ist. Die Anwendung auf die Karte (Klassen/Styling)
// liegt im Render-Layer.
//
// KLASSIFIZIERUNG IST CLUSTER-WEIT, NICHT PRO ZYKLUS. Ein "Ring-Cluster" ist
// eine Zusammenhangskomponente der Nicht-Bruecken-Kanten; zwei Ringe, die sich
// einen Knoten teilen (Achter), liegen im selben Cluster. "Irgendeine Kante im
// Cluster blockt" gilt dann als sicher — das kann eine Loop-Gefahr in einem der
// Teilringe UNTERwarnen, aber es warnt NIE faelschlich. Diese Richtung ist
// bewusst gewaehlt (ROADMAP: getarnte Redundanz als Alarm waere schlimmer als
// gar keine Anzeige). Pro-Zyklus-Genauigkeit (Bi-Zusammenhangskomponenten)
// waere die Verfeinerung, wenn echte Achter-Topologien auftauchen.

// Nur ECHTE Kabel: physische LLDP/CDP-Kanten. hosts-/ghost-/stale-/buendel-/
// internet-/manuelle Kanten tragen isLLDP !== true und sind KEINE Verkabelung.
function isCable(e) {
    return e && e.isLLDP === true
        && e.source != null && e.target != null
        && String(e.source) !== String(e.target);
}

// Hat diese Kante ueberhaupt einen gemeldeten STP-Zustand (an irgendeinem Ende)?
// stpSrc/stpTgt === null heisst: kein dot1dStpPortState gesammelt. Ohne das
// laesst sich "forwarding" nicht von "unbekannt" trennen — und nur mit dieser
// Unterscheidung darf ueberhaupt vor einem Loop gewarnt werden.
function hasStp(e) {
    return (e.stpSrc !== null && e.stpSrc !== undefined)
        || (e.stpTgt !== null && e.stpTgt !== undefined);
}

function pairKey(a, b) {
    a = String(a); b = String(b);
    return a < b ? a + '\u0000' + b : b + '\u0000' + a;
}

/**
 * Ring-Analyse ueber eine Kantenliste (Cytoscape-`data`-Objekte oder schlicht
 * {id, source, target, isLLDP, stpSrc, stpTgt, _isStpBlocked}).
 *
 * Parallele Kanten zwischen DEMSELBEN Knotenpaar (LAG, Doppelkabel) werden zu
 * EINEM logischen Paar zusammengefasst — sonst zaehlte ein LAG als Ring. Der
 * LAG-Fall ist ein eigener ROADMAP-Punkt (parallel-links.js), kein Ring.
 *
 * @returns {{
 *   totalRings: number,          // unabhaengige Zyklen (Kreisrang E-N+C)
 *   loopRisk: number,            // Ring-Cluster OHNE blockenden Zweig trotz STP-Daten
 *   edgeStatus: Object,          // edgeId -> 'safe'|'churn'|'open'|'unknown' (nur Ring-Kanten)
 *   components: Array            // [{status, nodes:[], edgeIds:[]}]
 * }}
 */
export function analyseRings(edgeList, nodeList) {
    const empty = { totalRings: 0, loopRisk: 0, edgeStatus: {}, components: [] };
    if (!Array.isArray(edgeList) || edgeList.length === 0) return empty;

    // Hosts, die IRGENDWO einen Port per STP blocken (Node-Flag _stpBlock aus
    // port_stp, deckt auch Ports OHNE LLDP-Nachbarn ab). Zentral fuer die
    // ehrliche Loop-Erkennung: ein geblockter Redundanz-Link traegt oft keinen
    // LLDP-Nachbarn und ist damit keine Kante auf der Karte — die STP-Blockade
    // des Hosts beweist aber, dass STP den Zyklus zaehmt. Ohne das meldete ein
    // Ring aus lauter forwarding-KANTEN faelschlich "Loop", obwohl der Switch
    // anderswo brav blockt (an echter Hardware gesehen, MikroTik CRS310).
    const blockHosts = new Set();
    // Hosts mit instabilem STP (Topology-Changes steigen schnell, _stpChurn):
    // ein Ring, dessen Host flappt, ist zwar vielleicht per STP geblockt (sicher),
    // aber das staendige Neukonvergieren ist die Loop-Fruehwarnung (Stufe 3a) ->
    // eigener Status "churn" (amber), rangiert ueber "sicher"/"unbekannt", aber
    // unter "open" (gar kein Block ist schlimmer als ein flappender Block).
    const churnHosts = new Set();
    // Hosts mit aktivem Broadcast-Storm (Stufe 3b): der lauteste Port flutet ->
    // ein Loop laeuft JETZT. Hoechste Stufe, rangiert ueber allem anderen.
    const stormHosts = new Set();
    // Hosts mit MAC-Flapping (Stufe 3c): MACs wechseln den Port = ein Loop
    // laeuft. Starkes Indiz, rangiert unter dem aktiven Storm, aber ueber "open".
    const flapHosts = new Set();
    (Array.isArray(nodeList) ? nodeList : []).forEach(function (n) {
        if (!n || n.id == null) return;
        if (n._stpBlock === true) blockHosts.add(String(n.id));
        if (n._stpChurn === true) churnHosts.add(String(n.id));
        if (n._bcastStorm === true) stormHosts.add(String(n.id));
        if (n._macFlap === true) flapHosts.add(String(n.id));
    });

    // 1. Kabel-Kanten zu logischen Paaren verdichten.
    const pairs = new Map();   // pairKey -> {a, b, edgeIds:[], blocked, hasStp}
    for (const e of edgeList) {
        if (!isCable(e)) continue;
        const k = pairKey(e.source, e.target);
        let p = pairs.get(k);
        if (!p) {
            p = { a: String(e.source), b: String(e.target), edgeIds: [], blocked: false, hasStp: false };
            pairs.set(k, p);
        }
        if (e.id !== undefined && e.id !== null) p.edgeIds.push(String(e.id));
        if (e._isStpBlocked === true) p.blocked = true;
        if (hasStp(e)) p.hasStp = true;
    }
    if (pairs.size === 0) return empty;

    // 2. Adjazenz des einfachen Graphen.
    const adj = new Map();     // node -> [{to, key}]
    const nodeSet = new Set();
    for (const [k, p] of pairs) {
        nodeSet.add(p.a); nodeSet.add(p.b);
        if (!adj.has(p.a)) adj.set(p.a, []);
        if (!adj.has(p.b)) adj.set(p.b, []);
        adj.get(p.a).push({ to: p.b, key: k });
        adj.get(p.b).push({ to: p.a, key: k });
    }

    // 3. Brueckensuche (Tarjan), ITERATIV — eine Bruecke ist eine Kante, deren
    //    Entfernen den Graphen trennt; sie liegt auf KEINEM Zyklus. Alles
    //    Uebrige ist Ring-Kante. Iterativ, damit eine lange Kette (1000+ Hosts)
    //    den Stack nicht sprengt.
    const disc = new Map();
    const low = new Map();
    const bridge = new Set();  // pairKey der Bruecken
    let timer = 0;
    let components = 0;

    for (const start of nodeSet) {
        if (disc.has(start)) continue;
        components++;
        // Stack-Frames: {node, parentKey, iter}
        const stack = [{ node: start, parentKey: null, i: 0 }];
        disc.set(start, timer); low.set(start, timer); timer++;
        while (stack.length) {
            const fr = stack[stack.length - 1];
            const nbrs = adj.get(fr.node);
            if (fr.i < nbrs.length) {
                const { to, key } = nbrs[fr.i++];
                if (key === fr.parentKey) continue;        // Kante zum Elter nicht zurueck
                if (!disc.has(to)) {
                    disc.set(to, timer); low.set(to, timer); timer++;
                    stack.push({ node: to, parentKey: key, i: 0 });
                } else {
                    // Rueckkante — low aktualisieren.
                    if (disc.get(to) < low.get(fr.node)) low.set(fr.node, disc.get(to));
                }
            } else {
                // Frame fertig — low zum Elter hochreichen, Bruecke pruefen.
                stack.pop();
                if (stack.length) {
                    const par = stack[stack.length - 1];
                    if (low.get(fr.node) < low.get(par.node)) low.set(par.node, low.get(fr.node));
                    if (low.get(fr.node) > disc.get(par.node)) bridge.add(fr.parentKey);
                }
            }
        }
    }

    // 4. Kreisrang (Anzahl unabhaengiger Zyklen) = Paare - Knoten + Komponenten.
    const totalRings = pairs.size - nodeSet.size + components;
    if (totalRings <= 0) return empty;

    // 5. Ring-Cluster = Zusammenhangskomponenten des Graphen OHNE Bruecken.
    //    Jede klassifizieren: blockt STP irgendwo (sichere Redundanz), liegen
    //    STP-Daten vor aber nichts blockt (Loop-Gefahr), oder gar keine Daten.
    const ringAdj = new Map();   // node -> [{to, key}] nur Nicht-Bruecken
    for (const [k, p] of pairs) {
        if (bridge.has(k)) continue;
        if (!ringAdj.has(p.a)) ringAdj.set(p.a, []);
        if (!ringAdj.has(p.b)) ringAdj.set(p.b, []);
        ringAdj.get(p.a).push({ to: p.b, key: k });
        ringAdj.get(p.b).push({ to: p.a, key: k });
    }

    const edgeStatus = {};
    const comps = [];
    let loopRisk = 0;
    const seen = new Set();
    for (const start of ringAdj.keys()) {
        if (seen.has(start)) continue;
        // BFS ueber die Cluster-Knoten, Paar-Keys einsammeln.
        const nodes = [];
        const keys = new Set();
        const q = [start];
        seen.add(start);
        while (q.length) {
            const n = q.shift();
            nodes.push(n);
            for (const { to, key } of ringAdj.get(n)) {
                keys.add(key);
                if (!seen.has(to)) { seen.add(to); q.push(to); }
            }
        }
        let anyBlocked = false, anyStp = false;
        const edgeIds = [];
        for (const k of keys) {
            const p = pairs.get(k);
            if (p.blocked) anyBlocked = true;
            if (p.hasStp) anyStp = true;
            for (const eid of p.edgeIds) edgeIds.push(eid);
        }
        // Blockt ein HOST des Clusters irgendwo (auch auf einem Port ohne
        // sichtbare Kante), ist der Ring von STP gezaehmt -> sicher, kein Loop.
        if (nodes.some(function (nid) { return blockHosts.has(nid); })) anyBlocked = true;
        const churns = nodes.some(function (nid) { return churnHosts.has(nid); });
        const storms = nodes.some(function (nid) { return stormHosts.has(nid); });
        const flaps  = nodes.some(function (nid) { return flapHosts.has(nid); });
        // storm (Flut JETZT) > flap (MACs wandern) > open (kein Block) >
        // churn (STP flappt) > safe (STP blockt) > unknown (keine Daten).
        const status = storms ? 'storm'
                     : (flaps ? 'flap'
                     : (anyStp && !anyBlocked ? 'open'
                     : (churns ? 'churn'
                     : (anyBlocked ? 'safe' : 'unknown'))));
        if (status === 'open') loopRisk++;
        for (const eid of edgeIds) edgeStatus[eid] = status;
        comps.push({ status, nodes, edgeIds });
    }

    return { totalRings, loopRisk, edgeStatus, components: comps };
}

const RING_CLASSES = 'nt-ring-safe nt-ring-open nt-ring-unknown nt-ring-churn nt-ring-storm nt-ring-flap';

/**
 * Ring-Status auf die Cytoscape-Karte anwenden: Ring-Kanten bekommen eine
 * Klasse (nt-ring-<status>) fuers Styling (ein underlay-Halo, der die
 * Linienfarbe der Weathermap NICHT ueberschreibt) und `_ringStatus` in den
 * Daten fuers Kanten-Panel. Gibt die Zusammenfassung fuer die KPI-Zeile zurueck.
 */
export function applyRings(cy) {
    if (!cy) return { totalRings: 0, loopRisk: 0 };
    const r = analyseRings(
        cy.edges().map(function (e) { return e.data(); }),
        cy.nodes().map(function (n) { return n.data(); }));
    cy.batch(function () {
        cy.edges().removeClass(RING_CLASSES).removeData('_ringStatus');
        Object.keys(r.edgeStatus).forEach(function (eid) {
            const e = cy.getElementById(eid);
            if (e && e.length) {
                e.addClass('nt-ring-' + r.edgeStatus[eid]);
                e.data('_ringStatus', r.edgeStatus[eid]);
            }
        });
    });
    return { totalRings: r.totalRings, loopRisk: r.loopRisk };
}

/** Ring-Hervorhebung wieder entfernen. */
export function clearRings(cy) {
    if (!cy) return;
    cy.batch(function () { cy.edges().removeClass(RING_CLASSES).removeData('_ringStatus'); });
}
