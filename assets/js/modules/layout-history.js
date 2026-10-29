// layout-history.js — Undo/Redo der Knotenanordnung (Positionen).
//
// MODELL: SCHNAPPSCHUESSE, KEINE DELTAS. Jeder Schritt ist die komplette
// Positionskarte {id:{x,y}}. Vor einer Mutation (ein beendeter Drag, ein
// Layout-Wechsel) kommt der VORHERIGE Zustand auf den Undo-Stapel, und der
// Redo-Stapel wird geleert. Undo/Redo tauschen zwischen den Stapeln und legen
// den Schnappschuss auf Cytoscape. Snapshot statt Delta, weil es bei einigen
// hundert Knoten immer noch klein ist UND robust gegen Knoten, die zwischen
// zwei Schritten dazukommen oder verschwinden (ein Hintergrund-Refresh bringt
// einen Geist) — fehlt ein Knoten im Schnappschuss, bleibt er einfach, wo er ist.
//
// RESET nur bei echtem ANSICHTSWECHSEL, erkannt an der Knotenmenge: ein
// In-Place-Refresh (Normalansicht) laesst dieselben IDs stehen -> Historie
// bleibt; eine andere Gruppe/ein anderer Host bringt andere IDs -> Historie
// weg, damit Undo nie Positionen einer fremden Ansicht wiederherstellt.

const MAX = 60;           // Schritte; dahinter faellt der aelteste weg
let undoStack = [];
let redoStack = [];
let pendingPre = null;    // Vor-Drag-Zustand zwischen 'grab' und 'dragfree'
let lastIds = null;       // Knoten-Signatur der zuletzt gesehenen Ansicht
let persistFn = null;     // speichert die angewandte Anordnung (focus-geschuetzt)
let onChangeFn = null;    // meldet (canUndo, canRedo) an die Buttons
let persistTimer = null;  // Debounce fuer das Speichern (s. schedulePersist)
const PERSIST_MS = 400;   // wie der Drag-Auto-Save in render-tech

function snapshot(cy) {
    const s = {};
    cy.nodes().forEach(function(n) {
        const p = n.position();
        s[String(n.id())] = { x: p.x, y: p.y };
    });
    return s;
}

function sameSnap(a, b) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (let i = 0; i < ka.length; i++) {
        const k = ka[i], pb = b[k];
        // Auf ganze Pixel runden: ein Sub-Pixel-Zittern ist kein Zug.
        if (!pb || Math.round(a[k].x) !== Math.round(pb.x)
                || Math.round(a[k].y) !== Math.round(pb.y)) {
            return false;
        }
    }
    return true;
}

// Speichern ENTPRELLT: ein gehaltenes Strg+Z (Tastatur-Autorepeat) ruft
// undoLayout viele Male schnell hintereinander; jeder Aufruf wuerde sonst einen
// vollen savePositions-POST ausloesen und bei grossen Graphen den
// Config-/CProfile-Endpunkt haemmern (und Antworten koennten verdreht
// ankommen). Wie der Drag-Auto-Save in render-tech: nach dem letzten Zug in
// PERSIST_MS einmal speichern. savePositions liest die DANN aktuellen
// Positionen, also landet der Endzustand.
function schedulePersist(cy) {
    if (!persistFn) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(function() {
        persistTimer = null;
        try { persistFn(cy); } catch (e) { /* Speichern darf das Undo nicht kippen */ }
    }, PERSIST_MS);
}

function apply(cy, snap) {
    cy.batch(function() {
        cy.nodes().forEach(function(n) {
            const p = snap[String(n.id())];
            if (p) n.position({ x: p.x, y: p.y });
        });
    });
    schedulePersist(cy);
}

function notify() {
    if (onChangeFn) {
        try { onChangeFn(undoStack.length > 0, redoStack.length > 0); } catch (e) {}
    }
}

function reset() {
    undoStack = [];
    redoStack = [];
    pendingPre = null;
    notify();
}

function pushUndo(snap) {
    undoStack.push(snap);
    if (undoStack.length > MAX) undoStack.shift();
    redoStack = [];
    notify();
}

/** Callbacks setzen (nur die uebergebenen Schluessel); kein Reset. */
export function configureLayoutHistory(opts) {
    if (opts && 'persist' in opts) persistFn = opts.persist;
    if (opts && 'onChange' in opts) onChangeFn = opts.onChange;
    notify();
}

/**
 * Historie leeren, wenn sich die ANSICHT geaendert hat — gemessen an der Menge
 * der Knoten-IDs. Gleiche Menge (In-Place-Refresh, Group-View-Refresh, ein
 * Layout-Wechsel mit denselben Knoten) laesst die Historie stehen.
 */
export function syncLayoutHistoryNodes(cy) {
    const ids = cy.nodes().map(function(n) { return String(n.id()); }).sort().join(',');
    if (lastIds !== null && ids !== lastIds) reset();
    lastIds = ids;
}

/** 'grab': den Vor-Drag-Zustand merken (einmal pro Drag-Geste). */
export function markBeforeDrag(cy) {
    if (!pendingPre) pendingPre = snapshot(cy);
}

/** 'dragfree': den Vor-Drag-Zustand als Schritt sichern, falls etwas bewegt wurde. */
export function commitDrag(cy) {
    if (!pendingPre) return;
    if (!sameSnap(pendingPre, snapshot(cy))) pushUndo(pendingPre);
    pendingPre = null;
}

/** Aktuellen Zustand als Schritt sichern — vor einem Layout-Wechsel aufgerufen. */
export function recordBefore(cy) {
    if (cy) pushUndo(snapshot(cy));
}

export function undoLayout(cy) {
    if (!cy || !undoStack.length) return;
    redoStack.push(snapshot(cy));
    apply(cy, undoStack.pop());
    notify();
}

export function redoLayout(cy) {
    if (!cy || !redoStack.length) return;
    undoStack.push(snapshot(cy));
    apply(cy, redoStack.pop());
    notify();
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }
