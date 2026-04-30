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
// Pro Gruppe wird ein cose-Layout in der jeweiligen Bounding-Box ausgeführt.
// Internet-Knoten und Aggregates werden ausgenommen — sie bekommen eine
// feste Position (mittig oben).

// Padding zwischen Cluster-Boxen — muss groß genug sein damit die Group-Hulls
// (group-hulls.js, PADDING=60 outward) nicht in die Nachbar-Spalte bluten.
// Rechnung: Hull pads 60 nach außen vom letzten Knoten, cose lässt 20 inneres
// Padding → effektiv 40px Überstand pro Hülle. Zwei Hüllen brauchen also
// 2×40 + Sicherheits-Gap → mindestens ~100, wir nehmen 110 für sichtbaren
// Zwischenraum.
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
// minSize:   Minimal-Wert pro Box; nach Clamping wird ggf. proportional geshrinkt.
function proportionalSizes(counts, available, minSize) {
    const total = counts.reduce(function(a, b) { return a + Math.max(1, b); }, 0);
    let sizes = counts.map(function(c) {
        return Math.max(1, c) / total * available;
    });
    sizes = sizes.map(function(s) { return Math.max(minSize, s); });
    const sum = sizes.reduce(function(a, b) { return a + b; }, 0);
    if (sum > available) {
        // Min-Clamp hat den Boden hochgezogen — gleichmaessig schrumpfen
        const factor = available / sum;
        sizes = sizes.map(function(s) { return s * factor; });
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
function buildClusterLayoutConfig(boundingBox, nodeCount) {
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

export function runGroupClusterLayout(cy, groupNames, mode, onComplete) {
    console.log('[cluster] runGroupClusterLayout called', {mode, groupNames, hasCy: !!cy, destroyed: cy && cy.destroyed()});
    if (!cy || cy.destroyed()) { console.log('[cluster] EARLY EXIT: no cy or destroyed'); return; }
    if (!groupNames || groupNames.length < 2) {
        console.log('[cluster] EARLY EXIT: <2 groups');
        if (onComplete) onComplete();
        return;
    }
    const effective = resolveMode(mode || 'auto', groupNames.length);
    console.log('[cluster] effective mode:', effective);
    if (effective === 'off') {
        console.log('[cluster] EARLY EXIT: mode=off');
        if (onComplete) onComplete();
        return;
    }

    const canvasW = cy.width();
    const canvasH = cy.height();
    const count = groupNames.length;
    console.log('[cluster] canvas:', canvasW, 'x', canvasH, '— count:', count);

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
    console.log('[cluster] nodes per group:', groupNames.map(function(g, i) {
        return g + '=' + counts[i];
    }).join(', '));

    // Bounding-Boxes berechnen je nach Mode
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
        const colWidths = proportionalSizes(counts, availW, MIN_COLUMN_W);
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
        const rowHeights = proportionalSizes(counts, availH, MIN_ROW_H);
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

    // Pro Gruppe Layout starten und auf alle layoutstop-Events warten
    let pending = 0;
    let completed = 0;
    function checkDone() {
        if (completed >= pending) {
            console.log('[cluster] all', pending, 'group layouts done — fitting');
            cy.fit(cy.nodes(), 30);
            if (onComplete) onComplete();
        }
    }

    groupNames.forEach(function(g) {
        const nodes = nodesByGroup[g];
        if (!nodes || nodes.length === 0) {
            console.log('[cluster] skip group', g, '(no nodes)');
            return;
        }
        pending++;
        const bb = Object.assign({}, boxes[g]);
        // Top-Reserve in der BB für Group-Label
        bb.y1 += LABEL_OFFSET;
        bb.h  -= LABEL_OFFSET;
        console.log('[cluster] starting layout for group', g, 'in box', bb, '(', nodes.length, 'nodes)');
        const lay = nodes.layout(buildClusterLayoutConfig(bb, nodes.length));
        lay.one('layoutstop', function() {
            completed++;
            console.log('[cluster] layout done for', g, '(', completed, '/', pending, ')');
            checkDone();
        });
        lay.run();
    });

    if (pending === 0) {
        console.log('[cluster] EARLY EXIT: pending=0 (no nodes in any group)');
        if (onComplete) onComplete();
    }
}

// Public Helper für UI-Code: gibt den effektiven Mode zurück
export function effectiveClusterMode(mode, numGroups) {
    return resolveMode(mode || 'auto', numGroups);
}
