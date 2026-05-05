// group-cluster-layout.js — Verteilt Hosts mehrerer Gruppen entweder in
// vertikale Spalten oder horizontale Reihen.
//
// Modi:
//   'auto'    — adaptiv: 2-3 Gruppen → columns, 4+ Gruppen → rows
//   'columns' — immer Spalten nebeneinander
//   'rows'    — immer Reihen untereinander
//   'off'     — kein Cluster-Layout, normales Force-Layout
//
// Wird aufgerufen wenn der gewählte Mode != 'off' und ≥2 Gruppen existieren.
// Pro Gruppe wird per default ein cose-Layout in der Bounding-Box ausgeführt;
// optional kann per innerLayoutId-Parameter ein anderes Layout (grid /
// breadthfirst / concentric / circle) pro Cluster gewählt werden — wird vom
// Layout-Toggle in der Toolbar gesetzt damit "Raster", "Baum" usw. die
// Gruppen-Boundaries respektieren.
// Internet-Knoten und Aggregates werden ausgenommen — sie bekommen eine
// feste Position (mittig oben).

// Padding zwischen Cluster-Boxen — Hauptzweck: trennen die Group-Hulls aus
// group-hulls.js (PADDING=30 outward) so dass deren Bleed-Zonen (effektiv
// ~10px Überstand pro Hülle bei cose-Inset 20) nie in die Nachbar-Spalte
// reichen. 110 ist über-konservativ aber gibt einen klaren Sichtgap auch
// wenn cose Knoten an die Box-Grenzen drückt.
const COLUMN_PADDING  = 110;
const ROW_PADDING     = 110;
const TOP_RESERVE     = 80;
const BOTTOM_PADDING  = 30;
const LABEL_OFFSET    = 24;     // Platz oben für Group-Label
const MIN_COLUMN_W    = 200;    // Minimal-Breite einer Spalte
const MIN_ROW_H       = 140;    // Minimal-Höhe einer Reihe

// Verteilt die verfuegbare Breite/Hoehe proportional zur Knoten-Anzahl der
// Gruppe — damit kleine Gruppen nicht halb-leere Boxen bekommen, die durch
// cose noch zusaetzlich auseinandergespreizt werden.
//
// counts:    [n1, n2, ...] Knoten-Anzahl pro Gruppe
// available: nutzbare Pixel (Padding ist schon abgezogen)
// minSize:   Minimal-Wert pro Box; bleibt garantiert eingehalten.
//
// Wenn die Summe der Min-geclampten Boxen das Budget uebersteigt, werden NUR
// die Boxen die noch >minSize sind proportional zurueckgeshrinkt — die
// Min-geclampten bleiben am Floor. Konvergenz-Schutz via Iteration mit
// Abbruch wenn keine flexiblen Boxen mehr da sind oder keine weitere
// Reduktion mehr erreicht wird.
function proportionalSizes(counts, available, minSize) {
    const total = counts.reduce(function(a, b) { return a + Math.max(1, b); }, 0);
    let sizes = counts.map(function(c) {
        return Math.max(1, c) / total * available;
    });
    sizes = sizes.map(function(s) { return Math.max(minSize, s); });

    // Falls Min-Clamp das Budget gesprengt hat: schrumpfe iterativ nur die
    // Boxen, die noch ueber minSize liegen. Min-geclampte bleiben fix.
    let sum = sizes.reduce(function(a, b) { return a + b; }, 0);
    let guard = 0;
    while (sum > available && guard < 20) {
        guard++;
        const flexIdx = [];
        let flexSum = 0;
        sizes.forEach(function(s, i) {
            if (s > minSize + 0.0001) {
                flexIdx.push(i);
                flexSum += s;
            }
        });
        if (flexIdx.length === 0) break;   // alles am Floor — nicht weiter shrinkbar
        const overflow = sum - available;
        // Verteile den Overflow proportional auf die flexiblen Boxen, ohne
        // dabei einer den Floor zu unterschreiten.
        flexIdx.forEach(function(i) {
            const share = (sizes[i] / flexSum) * overflow;
            sizes[i] = Math.max(minSize, sizes[i] - share);
        });
        const newSum = sizes.reduce(function(a, b) { return a + b; }, 0);
        if (newSum >= sum - 0.5) break;   // keine Konvergenz mehr
        sum = newSum;
    }
    return sizes;
}

// Resolved den effektiven Modus aus 'auto' nach Group-Anzahl.
function resolveMode(mode, numGroups) {
    if (mode === 'columns' || mode === 'rows' || mode === 'off') return mode;
    // auto:
    if (numGroups <= 3) return 'columns';
    return 'rows';
}

// Layout-Config pro Cluster. animate=false ist viel schneller.
// innerLayoutId: 'cose' (default) | 'grid' | 'breadthfirst' | 'concentric' | 'circle'
// 'auto' / 'hierarchy' / unbekannt fallen auf cose zurueck (cose ist immer die
// sicherste Per-Cluster-Strategie).
function buildClusterLayoutConfig(boundingBox, nodeCount, innerLayoutId) {
    const id = innerLayoutId || 'cose';
    if (id === 'grid') {
        return {
            name: 'grid',
            animate: false,
            fit: false,
            padding: 20,
            boundingBox: boundingBox,
            avoidOverlap: true,
            condense: true,
        };
    }
    if (id === 'breadthfirst') {
        return {
            name: 'breadthfirst',
            animate: false,
            fit: false,
            padding: 20,
            boundingBox: boundingBox,
            directed: false,
            spacingFactor: 1.0,
        };
    }
    if (id === 'concentric') {
        return {
            name: 'concentric',
            animate: false,
            fit: false,
            padding: 20,
            boundingBox: boundingBox,
            minNodeSpacing: 30,
            avoidOverlap: true,
        };
    }
    if (id === 'circle') {
        return {
            name: 'circle',
            animate: false,
            fit: false,
            padding: 20,
            boundingBox: boundingBox,
            avoidOverlap: true,
        };
    }
    // cose (default + Fallback fuer 'auto' / 'hierarchy' / Unbekannte)
    return {
        name: 'cose',
        animate: false,
        randomize: true,
        padding: 20,
        nodeRepulsion: 6000,
        idealEdgeLength: 80,
        gravity: 0.8,
        fit: false,
        boundingBox: boundingBox,
        componentSpacing: 30,
        numIter: nodeCount < 6 ? 500 : 1000,
    };
}

export function runGroupClusterLayout(cy, groupNames, mode, onComplete, innerLayoutId) {
    if (!cy || cy.destroyed()) return;
    if (!groupNames || groupNames.length < 2) {
        if (onComplete) onComplete();
        return;
    }
    const effective = resolveMode(mode || 'auto', groupNames.length);
    if (effective === 'off') {
        if (onComplete) onComplete();
        return;
    }

    const canvasW = cy.width();
    const canvasH = cy.height();
    const count = groupNames.length;

    // Pro Gruppe Knoten sammeln (Internet/Aggregate ausgenommen) — VOR der
    // Box-Berechnung, weil die Spalten-Breiten proportional zur Knoten-Anzahl
    // alloziert werden.
    const nodesByGroup = {};
    cy.nodes('[!isGroup]').forEach(function(n) {
        const d = n.data();
        if (d._isInternet || d._isAggregate) return;
        const g = d._primaryGroup;
        if (!g) return;
        if (!nodesByGroup[g]) nodesByGroup[g] = cy.collection();
        nodesByGroup[g] = nodesByGroup[g].union(n);
    });
    const counts = groupNames.map(function(g) {
        return (nodesByGroup[g] && nodesByGroup[g].length) || 0;
    });

    // Bounding-Boxes berechnen je nach Mode.
    // Fuer kreisfoermige Inner-Layouts (concentric / circle) brauchen alle
    // Gruppen quadratische Boxen damit der Kreis nicht zur Linie zusammenfaellt.
    // Bei diesen Layouts ueberschreibt equal-split die proportionale Verteilung.
    const isCircular = innerLayoutId === 'concentric' || innerLayoutId === 'circle';
    const equalSplit = function(avail, n) {
        return Array(n).fill(avail / n);
    };

    const boxes = {};
    if (effective === 'columns') {
        const totalGap = COLUMN_PADDING * (count + 1);
        const availW = canvasW - totalGap;
        const colH = canvasH - TOP_RESERVE - BOTTOM_PADDING;
        if (availW < MIN_COLUMN_W * count || colH < 100) {
            cy.fit(cy.nodes(), 40);
            if (onComplete) onComplete();
            return;
        }
        const colWidths = isCircular
            ? equalSplit(availW, count)
            : proportionalSizes(counts, availW, MIN_COLUMN_W);
        let xCursor = COLUMN_PADDING;
        groupNames.forEach(function(g, idx) {
            boxes[g] = {
                x1: xCursor,
                y1: TOP_RESERVE,
                w:  colWidths[idx],
                h:  colH,
            };
            xCursor += colWidths[idx] + COLUMN_PADDING;
        });
    } else {  // rows
        const totalGap = ROW_PADDING * (count - 1);
        const availH = canvasH - TOP_RESERVE - BOTTOM_PADDING - totalGap;
        const rowW = canvasW - 2 * ROW_PADDING;
        if (rowW < 100 || availH < MIN_ROW_H * count) {
            cy.fit(cy.nodes(), 40);
            if (onComplete) onComplete();
            return;
        }
        const rowHeights = isCircular
            ? equalSplit(availH, count)
            : proportionalSizes(counts, availH, MIN_ROW_H);
        let yCursor = TOP_RESERVE;
        groupNames.forEach(function(g, idx) {
            boxes[g] = {
                x1: ROW_PADDING,
                y1: yCursor,
                w:  rowW,
                h:  rowHeights[idx],
            };
            yCursor += rowHeights[idx] + ROW_PADDING;
        });
    }

    // Internet-Knoten zentriert oben
    const internetNodes = cy.nodes('[!isGroup]').filter(function(n) {
        return n.data('_isInternet');
    });
    if (internetNodes.length > 0) {
        internetNodes.position({
            x: canvasW / 2,
            y: TOP_RESERVE / 2,
        });
    }

    // Pro Gruppe Layout starten und auf alle layoutstop-Events warten.
    //
    // WICHTIG: pending wird in einem ERSTEN Pass berechnet, bevor irgendein
    // lay.run() läuft. Discrete Layouts (grid/circle/concentric/breadthfirst)
    // feuern layoutstop synchron innerhalb von lay.run() — wenn pending erst
    // in der Schleife inkrementiert würde, sähe checkDone() nach der ersten
    // Iteration completed=1 >= pending=1 und würde onComplete/cy.fit
    // mehrfach feuern (einmal pro Iteration), während andere Gruppen noch
    // in Pre-Layout-Positionen sind. Cose ist async und maskierte das früher.
    const groupsToLayout = groupNames.filter(function(g) {
        const nodes = nodesByGroup[g];
        return nodes && nodes.length > 0;
    });
    const pending = groupsToLayout.length;
    let completed = 0;
    function checkDone() {
        if (completed >= pending) {
            cy.fit(cy.nodes(), 30);
            if (onComplete) onComplete();
        }
    }

    if (pending === 0) {
        if (onComplete) onComplete();
        return;
    }

    groupsToLayout.forEach(function(g) {
        // Pinned (locked) Nodes vom Per-Cluster-Layout ausschliessen — cose
        // honoriert den locked-State zwar selbst, aber explizit zu filtern
        // ist robuster (manche Layouts wie 'preset'/'grid' tun's nicht
        // zuverlaessig). Wenn alle Nodes der Gruppe pinned sind, wird die
        // Gruppe komplett uebersprungen — sind ja schon manuell positioniert.
        const nodes = nodesByGroup[g].not(':locked');
        if (nodes.length === 0) {
            // Nichts zu layouten, aber checkDone trotzdem trigger damit
            // die pending/completed-Buchhaltung sauber bleibt.
            completed++;
            checkDone();
            return;
        }
        const bb = Object.assign({}, boxes[g]);
        // Top-Reserve in der BB für Group-Label
        bb.y1 += LABEL_OFFSET;
        bb.h  -= LABEL_OFFSET;
        const lay = nodes.layout(buildClusterLayoutConfig(bb, nodes.length, innerLayoutId));
        lay.one('layoutstop', function() {
            completed++;
            checkDone();
        });
        lay.run();
    });
}

// Public Helper für UI-Code: gibt den effektiven Mode zurück
export function effectiveClusterMode(mode, numGroups) {
    return resolveMode(mode || 'auto', numGroups);
}
