// render-tech-style.js — Cytoscape-Style-Definitionen für den Tech-Tab.
//
// Dark-Mode-aware: einige Werte (text-background, edge-label-color) hängen
// vom isDark-Parameter ab. Zentral hier definiert damit der Render-Code
// in render-tech.js sich aufs Wesentliche konzentriert.
//
// Hinweis zu Selektoren:
//   - 'node[!isGroup]'        → normale Hosts (Aggregate werden anders gestylt)
//   - 'edge'                  → Standard-LLDP-Edges (grün-gestrichelt)
//   - 'edge.dead-edge'        → Edges zu toten Hosts (grau-gestrichelt)
//   - 'edge[?_isInternetEdge]'→ Internet-Wolken-Uplinks (blau-durchgezogen)
//   - 'node[!isGroup]:selected'→ ausgewählter Host (lila underlay)

export function buildCytoscapeStyle(dark) {
    return [
        { selector: 'node[!isGroup]', style: {
            'width': 96, 'height': 96, 'background-opacity': 0, 'border-width': 0,
            'background-image': 'data(bgImage)',
            'background-fit': 'contain', 'background-clip': 'none',
            'label': 'data(label)', 'text-valign': 'bottom', 'text-halign': 'center',
            'font-size': 11, 'font-family': 'sans-serif',
            'color': dark ? '#e2e8f0' : '#334155',
            'text-margin-y': 6, 'text-background-opacity': dark ? 0.75 : 0.85,
            'text-background-color': dark ? '#1e293b' : '#f8fafc',
            'text-background-padding': '2px', 'text-background-shape': 'roundrectangle',
            'min-zoomed-font-size': 8,
        }},
        { selector: 'edge', style: {
            'width': 2.5, 'line-color': '#22c55e', 'line-style': 'dashed',
            'line-dash-pattern': [6, 5], 'line-dash-offset': 0,
            'curve-style': 'unbundled-bezier',
            'control-point-distances': [60], 'control-point-weights': [0.5],
            'target-arrow-shape': 'none', 'opacity': 0.85,
            'label': 'data(tLabel)',
            'font-size': 9, 'font-family': 'monospace', 'text-wrap': 'wrap',
            'text-background-color': dark ? '#1e293b' : '#f8fafc',
            'text-background-opacity': 0.88, 'text-background-padding': '2px',
            'color': dark ? '#94a3b8' : '#16a34a',
            'line-cap': 'round', 'text-rotation': 'none', 'text-margin-y': -12,
            // Port-Labels an den Edge-Enden (port-labels.js setzt source-/
            // target-label inline; hier nur die Offsets weg vom Node)
            'source-text-offset': 26, 'target-text-offset': 26,
        }},
        { selector: 'edge.dead-edge', style: {
            'width': 1.5, 'line-color': '#94a3b8', 'line-style': 'dashed',
            'line-dash-pattern': [4, 8], 'opacity': 0.55, 'color': '#ef4444', 'font-weight': '600',
        }},
        { selector: 'edge[?_isInternetEdge]', style: {
            // Internet-Uplinks visuell als kräftige blaue Linie
            'width': 4, 'line-color': '#3b82f6', 'line-style': 'solid',
            'opacity': 0.85, 'curve-style': 'straight'
        }},
        { selector: 'node[!isGroup]:selected', style: {
            'underlay-color': '#6366f1', 'underlay-padding': 6,
            'underlay-opacity': 0.25, 'underlay-shape': 'ellipse',
        }},
        // Path-Highlight (path-highlight.js): cyan, klar abgesetzt von der
        // selected-Underlay (#6366f1 indigo) und von Severity-Farben.
        { selector: '.nt-path-dim', style: { 'opacity': 0.15 }},
        { selector: 'edge.nt-path-edge', style: {
            'width': 5, 'line-color': '#06b6d4', 'line-style': 'solid',
            'opacity': 1, 'z-index': 999, 'color': '#0891b2',
        }},
        { selector: 'node.nt-path-node', style: {
            'underlay-color': '#06b6d4', 'underlay-padding': 8,
            'underlay-opacity': 0.45, 'underlay-shape': 'ellipse',
            'opacity': 1, 'z-index': 999,
        }},
        // What-if-Ausfallsimulation (whatif.js): grauer Halo = simuliert tot,
        // roter Halo = dadurch vom Uplink abgeschnitten. Bewusst Underlays —
        // Inline-Styles (Heatmap/Highlight) ueberschreiben opacity/line-color,
        // Underlay-Properties setzt niemand inline.
        { selector: 'node.nt-sim-dead', style: {
            'underlay-color': '#475569', 'underlay-padding': 10,
            'underlay-opacity': 0.55, 'underlay-shape': 'ellipse',
        }},
        { selector: 'node.nt-sim-cut', style: {
            'underlay-color': '#dc2626', 'underlay-padding': 9,
            'underlay-opacity': 0.4, 'underlay-shape': 'ellipse',
        }},
        // Root-Cause-Analyse (root-cause.js): kraeftig rot = Ursache des
        // Ausfalls, amber = Folge-Ausfall dahinter.
        { selector: 'node.nt-rc-cause', style: {
            'underlay-color': '#b91c1c', 'underlay-padding': 13,
            'underlay-opacity': 0.5, 'underlay-shape': 'ellipse',
        }},
        { selector: 'node.nt-rc-victim', style: {
            'underlay-color': '#f59e0b', 'underlay-padding': 8,
            'underlay-opacity': 0.3, 'underlay-shape': 'ellipse',
        }},
    ];
}
