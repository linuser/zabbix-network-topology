// layouts.js — Layout-Konfigurationen für die technische Cytoscape-Ansicht.
//
// Wird von render-tech.js (initiales Layout beim Render) und toolbar.js
// (Layout-Button für Re-Layout) gemeinsam genutzt — damit die User-Auswahl
// und die Heuristik an einer Stelle leben statt synchron gehalten werden zu
// müssen.
//
// Layouts:
//   auto         — Heuristik (Preset bei gespeicherten Positionen, sonst
//                  concentric bei sparse Graphen, sonst cose)
//   cose         — Force-Directed: gut für dichte, vermaschte Topologien
//   concentric   — Konzentrische Ringe nach Knoten-Grad: Hub im Zentrum
//   grid         — Gleichmäßiges Raster: gut für Übersichten ohne Edges
//   breadthfirst — Hierarchischer Baum von oben nach unten

import { loadPositions } from './storage.js';
import { t } from './i18n.js';

// Optionen für das Toolbar-Dropdown. Die Reihenfolge bestimmt die Anzeige.
export const LAYOUT_OPTIONS = [
    { id: 'auto',         label: t('layout.auto')       },
    { id: 'cose',         label: t('layout.force')      },
    { id: 'concentric',   label: t('layout.concentric') },
    { id: 'grid',         label: t('layout.grid')       },
    { id: 'breadthfirst', label: t('layout.tree')       },
    { id: 'hierarchy',    label: t('layout.hierarchy')  }
];

// Tier-Reihenfolge für das Hierarchie-Layout: niedrige Zahl = oben.
// Internet (Tier -1) wird ggf. virtuell oben drüber gesetzt.
// Spiegelt die Logik in render-mgmt.js MGMT_LEVEL — Single Source of Truth
// wäre theoretisch besser, aber render-mgmt nutzt eigene Layer-Labels.
const TIER_ORDER = {
    firewall: 0, router: 1, switch: 2, wireless: 3,
    hypervisor: 4, linux: 4, windows: 4, macos: 4,
    webserver: 4, container: 4, mailserver: 4, server: 4,
    storage: 5, monitoring: 6, homeauto: 6,
    ups: 7, camera: 7, printer: 7
};
const TIER_DEFAULT = 4;   // unbekannte Device-Types landen bei "Server"

// Berechnet feste Positionen (preset) für alle Knoten basierend auf ihrem
// device-type. Innerhalb einer Tier werden die Knoten gleichmäßig
// horizontal verteilt. Internet-Knoten (id beginnt mit 'internet_') landet
// oben auf Tier -1.
//
// Layout-Parameter:
//   tierGap     — vertikaler Abstand zwischen Tiers (Pixel)
//   nodeGap     — horizontaler Abstand zwischen Nodes derselben Tier
//
// Returns: { 'nodeId': {x, y}, ... } — Map für Cytoscape preset-Layout.
function buildHierarchyPositions(nodes) {
    const tierGap = 180;
    const nodeGap = 150;

    // Nodes nach Tier gruppieren
    const byTier = {};
    nodes.forEach(function(n) {
        let tier;
        if (String(n.id).indexOf('internet_') === 0) {
            tier = -1;
        } else {
            tier = TIER_ORDER[n.type] !== undefined ? TIER_ORDER[n.type] : TIER_DEFAULT;
        }
        if (!byTier[tier]) byTier[tier] = [];
        byTier[tier].push(n);
    });

    // Sortierung pro Tier: nach Severity desc (Probleme oben), dann Label asc
    Object.keys(byTier).forEach(function(t) {
        byTier[t].sort(function(a, b) {
            return (b.severity || 0) - (a.severity || 0)
                || (a.label || '').localeCompare(b.label || '');
        });
    });

    const tiers = Object.keys(byTier).map(Number).sort(function(a, b) { return a - b; });
    const positions = {};

    tiers.forEach(function(tier, tierIdx) {
        const row = byTier[tier];
        // Horizontal zentrieren um x=0
        const totalWidth = (row.length - 1) * nodeGap;
        const startX = -totalWidth / 2;
        row.forEach(function(node, i) {
            positions[String(node.id)] = {
                x: startX + i * nodeGap,
                y: tierIdx * tierGap
            };
        });
    });

    return positions;
}

// Baut das Layout-Config für Cytoscape. `layoutId` ist eine der LAYOUT_OPTIONS-
// IDs ('auto' = Heuristik mit Preset-Versuch). nodes/edges werden nur für die
// Heuristik bei 'auto' und für 'hierarchy' (Positions-Berechnung) gebraucht;
// alle anderen Layouts ignorieren sie.
//
// `forceFresh=true` überspringt den Preset-Versuch (wird vom Layout-Button
// genutzt: "Layout neu rechnen" soll nicht die alten Positionen wiederverwenden).
export function buildLayoutConfig(layoutId, nodes, edges, forceFresh) {
    if (layoutId === 'auto' && !forceFresh) {
        // Preset-Versuch: 80% der Nodes haben gespeicherte, plausible Positionen
        const sp = loadPositions();
        const ids = nodes.map(function(n) { return String(n.id); });
        const hits = ids.filter(function(id) { return !!sp[id]; }).length;
        const coverage = ids.length > 0 ? hits / ids.length : 0;
        // Schutz gegen vergiftete localStorage-Snapshots (alle bei 0,0)
        const hasNonZero = ids.some(function(id) {
            const p = sp[id];
            return p && (Math.abs(p.x) > 1 || Math.abs(p.y) > 1);
        });
        if (coverage >= 0.8 && hasNonZero) {
            return {
                name: 'preset',
                positions: function(node) { return sp[node.id()] || undefined; },
                padding: 30
            };
        }
        // Bei sparse Graphen (edges/nodes < 0.3) ist concentric besser als
        // cose, weil cose isolierte Nodes in einer Spalte stapelt.
        const edgeCount = (edges && edges.length) || 0;
        const connectivity = ids.length > 0 ? edgeCount / ids.length : 0;
        if (connectivity < 0.3 && ids.length > 5) layoutId = 'concentric';
        else                                       layoutId = 'cose';
    } else if (layoutId === 'auto' && forceFresh) {
        // Bei "Layout neu rechnen" mit auto: einfach cose (default für die
        // meisten Topologien)
        layoutId = 'cose';
    }

    switch (layoutId) {
        case 'cose':
            return {
                name: 'cose', animate: true, animationDuration: 500, randomize: true,
                padding: 50, nodeRepulsion: 8000, idealEdgeLength: 100, gravity: 1,
                fit: true, componentSpacing: 40
            };
        case 'concentric':
            return {
                name: 'concentric', animate: true, animationDuration: 500,
                padding: 50, fit: true, minNodeSpacing: 60,
                concentric: function(node) { return node.degree(); },
                levelWidth: function() { return 1; }
            };
        case 'grid':
            return {
                name: 'grid', animate: true, animationDuration: 500,
                padding: 50, fit: true, avoidOverlap: true, condense: false
            };
        case 'breadthfirst':
            // Wurzel = höchstgradiger Knoten (gleiche Heuristik wie render-tree)
            return {
                name: 'breadthfirst', animate: true, animationDuration: 500,
                directed: false, padding: 50, fit: true, spacingFactor: 1.4,
                avoidOverlap: true
            };
        case 'hierarchy':
            // Tier-basiertes Preset-Layout — Positionen kommen aus
            // buildHierarchyPositions() die device-type→tier mapped.
            // Internet-Knoten ist hier (sofern vorhanden) bereits in
            // nodes enthalten und bekommt automatisch die Top-Tier-Position.
            return {
                name: 'preset',
                positions: (function() {
                    const pos = buildHierarchyPositions(nodes);
                    return function(node) { return pos[node.id()] || undefined; };
                })(),
                padding: 50,
                fit: true,
                animate: true,
                animationDuration: 500
            };
        default:
            // Fallback: cose
            return {
                name: 'cose', animate: true, animationDuration: 500, randomize: true,
                padding: 50, nodeRepulsion: 8000, idealEdgeLength: 100, gravity: 1,
                fit: true, componentSpacing: 40
            };
    }
}
