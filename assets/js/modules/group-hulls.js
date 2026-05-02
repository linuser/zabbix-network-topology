// group-hulls.js — zeichnet farbige Convex-Hulls um die Hosts jeder
// Hostgroup. Wird automatisch aktiv wenn ≥2 Gruppen ausgewählt sind.
//
// Implementierung:
//   - SVG-Overlay über dem Cytoscape-Canvas (pointer-events: none)
//   - Hüllen werden bei Layout/Drag/Pan/Zoom neu gezeichnet via redraw()
//   - Pro Gruppe: alle Knoten-Render-Positionen sammeln, Convex Hull
//     berechnen, Polygon mit Gruppen-Farbe als Fläche (Alpha 0.10) und
//     gestrichelter Border (Alpha 0.45)
//   - Padding um Hosts: 30px damit die Hülle nicht direkt am Icon klebt
//     aber auch nicht in die Nachbar-Spalte blutet (siehe PADDING-Konstante)
//
// Ein-/Ausschalten:
//   - setupGroupHulls(cy, wrap) installiert das Overlay + Listener
//   - destroyGroupHulls(wrap) entfernt es wieder (für Tab-Wechsel)
//   - Aufruf-Logik (≥2 Gruppen) liegt im render-tech-Modul

import { grpColor } from './severity.js';

const NS = 'http://www.w3.org/2000/svg';
// Pixel-Abstand zwischen aeusserstem Knoten und Huelle. War 60, aber das hat
// in Kombination mit dem Cluster-Box-Abstand (group-cluster-layout
// COLUMN_PADDING=110) regelmaessig zu Hull-Bleed gefuehrt — die Huellen sind
// 60px nach aussen gezogen, cose laesst nur 20px innen, also 40px Ueberstand
// pro Box; bei 110px Box-Abstand bleibt nur 30px Sichtgap. 30px Padding
// reduziert den Ueberstand auf 10px und gibt damit 90px klaren Gap.
const PADDING = 30;
const LABEL_OFFSET = 18;     // Label-Abstand über dem höchsten Punkt

let _svg = null;
let _redrawHandle = null;

// Andrew's monotone chain — Convex Hull O(n log n).
// Eingabe: Array von {x, y}. Ausgabe: Polygon-Punkte im Uhrzeigersinn.
function convexHull(points) {
    if (points.length < 3) return points.slice();
    const pts = points.slice().sort(function(a, b) {
        return a.x - b.x || a.y - b.y;
    });
    function cross(O, A, B) {
        return (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
    }
    const lower = [];
    for (let i = 0; i < pts.length; i++) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) {
            lower.pop();
        }
        lower.push(pts[i]);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) {
            upper.pop();
        }
        upper.push(pts[i]);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
}

// Punkt-Set um padding aufpumpen: jeden Punkt in 8 Richtungen replizieren.
// Convex-Hull über das aufgeblähte Set ist dann der gewünschte Abstand.
function inflate(points, pad) {
    const out = [];
    const dirs = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]
    ];
    points.forEach(function(p) {
        dirs.forEach(function(d) {
            out.push({ x: p.x + d[0] * pad, y: p.y + d[1] * pad });
        });
    });
    return out;
}

function ensureSvg(wrap) {
    if (_svg) return _svg;
    _svg = document.createElementNS(NS, 'svg');
    _svg.id = 'nt-group-hulls';
    _svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;'
        + 'pointer-events:none;z-index:5';
    wrap.appendChild(_svg);
    return _svg;
}

function clearSvg() {
    if (!_svg) return;
    while (_svg.firstChild) _svg.removeChild(_svg.firstChild);
}

// Sammelt pro Gruppe die Render-Positionen aller zugehörigen Knoten und
// zeichnet das Polygon. Wird bei Pan/Zoom/Drag aufgerufen.
function redraw(cy) {
    if (!_svg) return;
    clearSvg();

    // Knoten nach Gruppe sammeln (Internet-Wolke + Aggregate ausschließen)
    // Knoten ohne valide Position werden übersprungen — kann beim ersten
    // Render auftreten wenn das Layout noch nicht fertig ist und Cytoscape
    // schon ein pan/zoom-Event feuert.
    const byGroup = {};
    let _added = 0;
    cy.nodes('[!isGroup]').forEach(function(n) {
        const d = n.data();
        if (d._isInternet || d._isAggregate) return;
        const g = d._primaryGroup;
        if (!g) return;
        const pos = n.renderedPosition();
        if (!pos || !isFinite(pos.x) || !isFinite(pos.y)) return;
        _added++;
        if (!byGroup[g]) byGroup[g] = [];
        byGroup[g].push({ x: pos.x, y: pos.y });
    });
    // Wenn keine Knoten valid sind, gar nicht zeichnen
    if (_added === 0) return;

    // Pro Gruppe: aufpumpen → Convex Hull → SVG-Polygon
    Object.keys(byGroup).forEach(function(g) {
        const pts = byGroup[g];
        if (pts.length === 0) return;
        const inflated = inflate(pts, PADDING);
        const hull = convexHull(inflated);
        if (hull.length < 3) return;

        // Defensive: falls ein Hull-Punkt NaN ist, Polygon weglassen statt
        // einen kaputten d-String zu generieren (würde Console-Error werfen).
        const allFinite = hull.every(function(p) { return isFinite(p.x) && isFinite(p.y); });
        if (!allFinite) return;

        const col = grpColor(g);
        const dStr = hull.map(function(p, i) {
            return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
        }).join(' ') + ' Z';

        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', dStr);
        path.setAttribute('fill', col);
        path.setAttribute('fill-opacity', '0.10');
        path.setAttribute('stroke', col);
        path.setAttribute('stroke-opacity', '0.45');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-dasharray', '6,4');
        path.setAttribute('stroke-linejoin', 'round');
        _svg.appendChild(path);

        // Gruppen-Label über dem höchsten Punkt der Hülle
        let topPoint = hull[0];
        for (let i = 1; i < hull.length; i++) {
            if (hull[i].y < topPoint.y) topPoint = hull[i];
        }
        const text = document.createElementNS(NS, 'text');
        text.setAttribute('x', topPoint.x);
        text.setAttribute('y', topPoint.y - LABEL_OFFSET);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', col);
        text.setAttribute('font-size', '12');
        text.setAttribute('font-weight', '700');
        text.setAttribute('font-family', 'sans-serif');
        text.setAttribute('opacity', '0.7');
        text.textContent = g;
        _svg.appendChild(text);
    });
}

export function setupGroupHulls(cy, wrap) {
    if (!cy || !wrap) return;
    ensureSvg(wrap);

    // Listener: bei jeder Position-Änderung neu zeichnen.
    // requestAnimationFrame entkoppelt Cytoscape-Event von Render —
    // sonst hätten wir bei Drag-Operationen Performance-Probleme.
    function scheduleRedraw() {
        if (_redrawHandle) return;
        _redrawHandle = requestAnimationFrame(function() {
            _redrawHandle = null;
            redraw(cy);
        });
    }

    cy.on('pan zoom drag dragfree position layoutstop', scheduleRedraw);
    // Resize-Observer auf den Wrap, damit das SVG immer die richtige
    // Pixel-Größe hat (sonst sieht's nach Window-Resize verzerrt aus)
    if (window.ResizeObserver) {
        const ro = new ResizeObserver(scheduleRedraw);
        ro.observe(wrap);
        // Speichern damit destroy() es disconnecten kann
        _svg._ro = ro;
    }

    // Initial-Render
    redraw(cy);
}

export function destroyGroupHulls(wrap) {
    if (!_svg) return;
    if (_svg._ro) {
        try { _svg._ro.disconnect(); } catch (e) {}
    }
    if (_svg.parentNode) _svg.parentNode.removeChild(_svg);
    _svg = null;
    if (_redrawHandle) {
        cancelAnimationFrame(_redrawHandle);
        _redrawHandle = null;
    }
}
