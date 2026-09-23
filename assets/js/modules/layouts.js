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

// Position fuer Knoten OHNE gespeicherte Koordinate — Geister vor allem.
//
// Das preset-Layout gibt fuer sie undefined zurueck, und Cytoscape laesst den
// Knoten dann dort, wo er ist: auf (0,0). Bei einem Dutzend Geistern liegt
// damit ein Dutzend Knoten uebereinander im selben Punkt. Gemeldet mit
// Screenshot, eine einzelne Hostgruppe, Layout "Auto" — also genau der Pfad,
// der die gespeicherten Positionen wiederverwendet.
//
// Gesetzt wird ringfoermig um den NACHBARN, der eine Position hat: ein Geist
// haengt definitionsgemaess an einem gemeldeten Host, und dort gehoert er auch
// hin. Der Winkel kommt aus der Reihenfolge, nicht aus dem Zufall — sonst
// springt die Karte bei jedem Neuzeichnen.
function buildFallbackPositions(nodes, edges, saved) {
    const fehlt = nodes.filter(function(n) { return !saved[String(n.id)]; });
    if (!fehlt.length) return {};

    // Nachbarn einsammeln (nur Knoten MIT Position sind als Anker brauchbar).
    const anker = {};
    (edges || []).forEach(function(e) {
        const a = String(e.source !== undefined ? e.source : e.from);
        const b = String(e.target !== undefined ? e.target : e.to);
        if (saved[a] && !saved[b]) (anker[b] = anker[b] || []).push(a);
        if (saved[b] && !saved[a]) (anker[a] = anker[a] || []).push(b);
    });

    // Mitte der bekannten Karte — Rueckfall fuer Knoten ganz ohne Anker.
    const ids = Object.keys(saved);
    let mx = 0, my = 0;
    ids.forEach(function(id) { mx += saved[id].x || 0; my += saved[id].y || 0; });
    if (ids.length) { mx /= ids.length; my /= ids.length; }

    const proAnker = {};
    const pos = {};
    let ohne = 0;
    fehlt.forEach(function(n) {
        const id = String(n.id);
        const a = (anker[id] || []).sort()[0];
        if (a) {
            const k = proAnker[a] = (proAnker[a] || 0) + 1;
            // Ring um den Anker: die ersten acht auf 110 px, danach weiter aussen.
            const ring = Math.floor((k - 1) / 8);
            const w = ((k - 1) % 8) * (Math.PI / 4);
            const r = 110 + ring * 70;
            pos[id] = { x: (saved[a].x || 0) + Math.cos(w) * r,
                        y: (saved[a].y || 0) + Math.sin(w) * r };
        } else {
            // Kein Anker: Raster neben der Karte statt Stapel auf (0,0).
            pos[id] = { x: mx + (ohne % 10) * 140, y: my + 260 + Math.floor(ohne / 10) * 140 };
            ohne++;
        }
    });
    return pos;
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
        // Geister zaehlen bei der Abdeckung NICHT mit. Sie haben nie eine
        // gespeicherte Position, und je mehr davon auf der Karte sind, desto
        // sicherer fiel die eigene Anordnung unter die 80 % und wurde
        // kommentarlos durch ein frisches Force-Layout ersetzt.
        const ids = nodes.map(function(n) { return String(n.id); })
            .filter(function(id) { return id.indexOf('ghost_') !== 0; });
        const hits = ids.filter(function(id) { return !!sp[id]; }).length;
        const coverage = ids.length > 0 ? hits / ids.length : 0;
        // Schutz gegen vergiftete localStorage-Snapshots (alle bei 0,0)
        const hasNonZero = ids.some(function(id) {
            const p = sp[id];
            return p && (Math.abs(p.x) > 1 || Math.abs(p.y) > 1);
        });
        if (coverage >= 0.8 && hasNonZero) {
            const fallback = buildFallbackPositions(nodes, edges, sp);
            return {
                name: 'preset',
                positions: function(node) { return sp[node.id()] || fallback[node.id()]; },
                padding: 30
            };
        }
        // Bei sparse Graphen (edges/nodes < 0.3) ist concentric besser als
        // cose, weil cose isolierte Nodes in einer Spalte stapelt.
        // Beide Seiten OHNE Geister zaehlen. ids ist oben schon gefiltert;
        // die Kanten mitzufiltern gehoert dazu, sonst steigt der Quotient mit
        // jedem Geist und die Wahl zwischen concentric und cose kippt an der
        // Schwelle aus einem Grund, der mit dem Graphen nichts zu tun hat.
        const edgeCount = (edges || []).filter(function(e) {
            const a = String(e.source !== undefined ? e.source : e.from);
            const b = String(e.target !== undefined ? e.target : e.to);
            return a.indexOf('ghost_') !== 0 && b.indexOf('ghost_') !== 0;
        }).length;
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
                fit: true, componentSpacing: 40,
                // Die Beschriftung mitrechnen. Ohne das kennt das Layout nur
                // den Knotenkreis von 44 px, waehrend ein Name wie "sw-edge-14.rack3" dreimal
                // so breit ist — die Kreise standen frei, die Namen lagen
                // uebereinander.
                nodeDimensionsIncludeLabels: true
            };
        case 'concentric':
            return {
                name: 'concentric', animate: true, animationDuration: 500,
                padding: 50, fit: true, minNodeSpacing: 60,
                nodeDimensionsIncludeLabels: true,
                concentric: function(node) { return node.degree(); },
                levelWidth: function() { return 1; }
            };
        case 'grid':
            return {
                name: 'grid', animate: true, animationDuration: 500,
                padding: 50, fit: true, avoidOverlap: true, condense: false,
                nodeDimensionsIncludeLabels: true
            };
        case 'breadthfirst':
            // Wurzel = höchstgradiger Knoten (gleiche Heuristik wie render-tree)
            return {
                name: 'breadthfirst', animate: true, animationDuration: 500,
                directed: false, padding: 50, fit: true, spacingFactor: 1.4,
                avoidOverlap: true, nodeDimensionsIncludeLabels: true
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
                fit: true, componentSpacing: 40,
                // Die Beschriftung mitrechnen. Ohne das kennt das Layout nur
                // den Knotenkreis von 44 px, waehrend ein Name wie "sw-edge-14.rack3" dreimal
                // so breit ist — die Kreise standen frei, die Namen lagen
                // uebereinander.
                nodeDimensionsIncludeLabels: true
            };
    }
}
