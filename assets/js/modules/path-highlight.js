// path-highlight.js — Pfad-Hervorhebung zwischen zwei Hosts via BFS.
//
// Use-Case: "wieso erreich ich Host B von Host A nicht?". User waehlt im
// Kontextmenue "Pfad von hier" auf Host A, dann "Pfad zu hier" auf Host B.
// Alle Edges/Knoten ausserhalb des kuerzesten BFS-Pfades werden gedimmt,
// die Pfad-Edges fett-cyan hervorgehoben.
//
// Wir verwenden eine eigene BFS-Implementation statt cy.elements().bfs(),
// weil letztere den Pfad-Edge-Graph in der minifizierten Cytoscape-Version
// nicht zuverlaessig zurueckgibt (found:null obwohl Knoten verbunden sind).
// Die manuelle Variante spiegelt highlight.js' Connected-Component-BFS und
// rekonstruiert den Pfad ueber parent-Pointers.
//
// State:
//   _startId  — Host-ID des "von"-Endes (kann ohne aktiven Pfad gesetzt sein)
//   _active   — true wenn aktuell ein Pfad gerendert ist (Klassen gesetzt)

let _startId = null;
let _active  = false;

export function getPathStart() { return _startId; }
export function isPathActive() { return _active; }

export function setPathStart(id) { _startId = id ? String(id) : null; }

// Manuelle BFS: liefert {nodeIds, edgeIds} fuer den Pfad start→end, oder
// null wenn keine Verbindung existiert. Walk ueber connectedEdges() — das
// behandelt Edges automatisch undirected.
function _findPath(cy, startId, endId) {
    const parent = {};   // nodeId -> { from: prevNodeId, edge: edgeId } | null fuer start
    parent[startId] = null;
    const queue = [startId];
    let found = false;
    while (queue.length) {
        const cur = queue.shift();
        if (cur === endId) { found = true; break; }
        const node = cy.getElementById(cur);
        if (!node.length) continue;
        node.connectedEdges().forEach(function(edge) {
            const sId = edge.source().id();
            const tId = edge.target().id();
            const nbr = (sId === cur) ? tId : sId;
            if (!(nbr in parent)) {
                parent[nbr] = { from: cur, edge: edge.id() };
                queue.push(nbr);
            }
        });
    }
    if (!found) return null;
    const nodeIds = [];
    const edgeIds = [];
    let cur = endId;
    while (cur) {
        nodeIds.push(cur);
        const p = parent[cur];
        if (!p) break;
        edgeIds.push(p.edge);
        cur = p.from;
    }
    return { nodeIds: nodeIds, edgeIds: edgeIds };
}

export function applyPathHighlight(cy, fromId, toId) {
    if (!cy || !fromId || !toId || String(fromId) === String(toId)) return false;
    clearPathHighlight(cy);
    const sId = String(fromId), tId = String(toId);
    const fromN = cy.getElementById(sId);
    const toN   = cy.getElementById(tId);
    if (!fromN.length || !toN.length) return false;

    const path = _findPath(cy, sId, tId);
    if (!path) return false;

    // Cytoscape-Collection aus den ID-Listen bauen
    const nodeSel = path.nodeIds.map(function(id) { return '#' + CSS.escape(id); }).join(',');
    const edgeSel = path.edgeIds.map(function(id) { return '#' + CSS.escape(id); }).join(',');
    const pathNodes = cy.nodes(nodeSel);
    const pathEdges = path.edgeIds.length ? cy.edges(edgeSel) : cy.collection();
    const pathEles  = pathNodes.union(pathEdges);

    cy.elements().not(pathEles).addClass('nt-path-dim');
    pathNodes.addClass('nt-path-node');
    pathEdges.addClass('nt-path-edge');
    _active = true;
    return true;
}

function clearPathHighlight(cy) {
    if (!cy) return;
    cy.elements().removeClass('nt-path-dim nt-path-edge nt-path-node');
    _active = false;
}

// Komplettes Reset: Pfad ausblenden UND Start-Marker loeschen.
export function clearPathState(cy) {
    clearPathHighlight(cy);
    _startId = null;
}
