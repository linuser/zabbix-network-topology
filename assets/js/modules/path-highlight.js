// path-highlight.js — Pfad-Hervorhebung zwischen zwei Hosts via BFS.
//
// Use-Case: "wieso erreich ich Host B von Host A nicht?". User waehlt im
// Kontextmenue "Pfad von hier" auf Host A, dann "Pfad zu hier" auf Host B.
// Alle Edges/Knoten ausserhalb des kuerzesten BFS-Pfades werden gedimmt,
// die Pfad-Edges fett-cyan hervorgehoben.
//
// State:
//   _startId  — Host-ID des "von"-Endes (kann ohne aktiven Pfad gesetzt sein)
//   _active   — true wenn aktuell ein Pfad gerendert ist (Klassen gesetzt)
//
// Kollidiert nicht mit highlight.js (Connected-Component-Dim) — beide
// koordinieren ueber render-tech.js: bei Pfad-Start wird resetHighlight()
// gerufen, beim Klick auf einen Knoten waehrend Pfad-aktiv unterdruecken
// wir applyHighlight().

let _startId = null;
let _active  = false;

export function getPathStart() { return _startId; }
export function isPathActive() { return _active; }

export function setPathStart(id) { _startId = id ? String(id) : null; }

// Sucht via cytoscape BFS einen unweighted Pfad start→target und markiert
// alle anderen Elemente als gedimmt. Liefert true bei Erfolg, false wenn
// kein Pfad existiert oder Knoten fehlen.
export function applyPathHighlight(cy, fromId, toId) {
    if (!cy || !fromId || !toId || String(fromId) === String(toId)) return false;
    clearPathHighlight(cy);
    const from = cy.getElementById(String(fromId));
    const to   = cy.getElementById(String(toId));
    if (!from.length || !to.length) return false;

    const targetId = String(toId);
    const bfs = cy.elements().bfs({
        roots: from,
        directed: false,
        visit: function(v) { return v.id() === targetId; }
    });
    if (!bfs.found || !bfs.found.length) return false;

    const pathEles = bfs.path;   // nodes + edges entlang des Pfades
    cy.elements().not(pathEles).addClass('nt-path-dim');
    pathEles.nodes().addClass('nt-path-node');
    pathEles.edges().addClass('nt-path-edge');
    _active = true;
    return true;
}

export function clearPathHighlight(cy) {
    if (!cy) return;
    cy.elements().removeClass('nt-path-dim nt-path-edge nt-path-node');
    _active = false;
}

// Komplettes Reset: Pfad ausblenden UND Start-Marker loeschen.
export function clearPathState(cy) {
    clearPathHighlight(cy);
    _startId = null;
}
