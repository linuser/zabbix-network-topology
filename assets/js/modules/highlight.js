// highlight.js — Path-Highlight via BFS.
//
// Wenn ein Node fokussiert wird (z.B. via Suche oder Klick im Detail-Panel),
// dimmt highlightPath alle nicht-verbundenen Knoten auf 10% Opacity, sodass
// der relevante Teilgraph hervorsticht.
//
// State: _activeId merkt sich den aktuell fokussierten Knoten, damit
// resetHighlight() weiß, ob es überhaupt etwas zurückzusetzen gibt.

let _activeId = null;

function _bfs(cy, startId) {
    const visited = {};
    const queue = [startId];
    visited[startId] = true;
    while (queue.length) {
        const cur = queue.shift();
        cy.getElementById(cur).connectedEdges().forEach(function(edge) {
            [edge.source().id(), edge.target().id()].forEach(function(nid) {
                if (!visited[nid] && !cy.getElementById(nid).data('isGroup')) {
                    visited[nid] = true;
                    queue.push(nid);
                }
            });
        });
    }
    return visited;
}

export function applyHighlight(cy, nodeId) {
    const visited = _bfs(cy, nodeId);
    cy.nodes('[!isGroup]').forEach(function(n) {
        n.style('opacity', visited[n.id()] ? 1 : 0.1);
    });
    cy.edges().forEach(function(e) {
        const show = visited[e.source().id()] && visited[e.target().id()];
        e.style('opacity', show ? 0.85 : 0.06);
    });
    _activeId = nodeId;
}

export function resetHighlight(cy) {
    if (!_activeId) return;
    cy.nodes('[!isGroup]').forEach(function(n) { n.style('opacity', 1); });
    cy.edges().forEach(function(e) { e.style('opacity', 0.85); });
    _activeId = null;
}

export function isHighlightActive() { return _activeId !== null; }
export function getActiveHighlightId() { return _activeId; }
