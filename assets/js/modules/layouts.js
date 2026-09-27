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
    { id: 'hierarchy',    label: t('layout.hierarchy')  },
    { id: 'hops',         label: t('layout.hops')       }
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

/**
 * Schichten nach HOP-ABSTAND statt nach Geraetetyp.
 *
 * WARUM NEBEN buildHierarchyPositions
 * -----------------------------------
 * Das Hierarchie-Layout sortiert nach TIER_ORDER, also nach dem, WAS ein
 * Geraet ist. In einem Rechenzentrum trennt das sauber: Firewall, Router,
 * Switch, Server. In einem Campusnetz nicht — Kern, Verteilung und Zugang
 * sind alle drei 'switch', und alles landet in EINER Zeile.
 *
 * Hier zaehlt stattdessen, WO ein Geraet steht: der Abstand in Hops zur
 * Uplink-Referenz. Kern 0, Verteilung 1, Zugang 2 — das Bild, das Leute an
 * Whiteboards malen. Aufgefallen am Lasttest mit 200 Geraeten, wo "auto"
 * cose waehlte (Konnektivitaet 1,44) und aus einem Baum eine Wolke machte.
 *
 * Die Wurzel: Internet, sonst Firewall/Router — so weit wie findRoots() in
 * whatif.js. Danach aber NICHT "der Knoten mit den meisten Nachbarn", wie es
 * die Ursachenanalyse als Rueckfall nimmt. Fuer eine Karte ist das falsch:
 * ein Verteiler mit einem Kern und vier Zugaengen hat fuenf Nachbarn, der
 * Kern mit drei Verteilern nur drei — und die Karte haengt am Verteiler, der
 * Kern rutscht eine Schicht nach unten. Genau so ist es beim ersten Lauf des
 * Gates passiert.
 *
 * Stattdessen die MITTE des Graphen, ueber die uebliche Doppel-BFS: vom
 * beliebigen Knoten zum entferntesten, von dort zum entferntesten, und die
 * Mitte dieses laengsten Weges ist der Punkt, von dem aus alles am nächsten
 * liegt. Bei Kern/Verteilung/Zugang ist das der Kern. Zwei BFS-Laeufe, also
 * linear — bei 200 Knoten nicht messbar.
 *
 * findRoots() selbst ist hier ohnehin nicht verwendbar: es braucht eine
 * fertige cy-Instanz, und das Layout wird gebraucht, bevor es die gibt.
 */
/** BFS von einem Knoten: liefert {tiefe, entferntester}. */
function bfsVon(start, nachbarn) {
    const tiefe = {};
    tiefe[start] = 0;
    let rand = [start], letzter = start;
    while (rand.length) {
        const naechste = [];
        rand.forEach(function(id) {
            Object.keys(nachbarn[id] || {}).forEach(function(o) {
                if (tiefe[o] === undefined) { tiefe[o] = tiefe[id] + 1; naechste.push(o); letzter = o; }
            });
        });
        rand = naechste;
    }
    return { tiefe: tiefe, entferntester: letzter };
}

/** Mitte des laengsten Weges — siehe buildHopTierPositions(). */
function graphMitte(nodes, nachbarn) {
    // Von einem Knoten der GROESSTEN Komponente starten, sonst landet die
    // Mitte in einer Insel aus zwei Geraeten.
    let start = null, bestGroesse = -1;
    const besucht = {};
    nodes.forEach(function(n) {
        const id = String(n.id);
        if (besucht[id]) return;
        const r = bfsVon(id, nachbarn);
        const ids = Object.keys(r.tiefe);
        ids.forEach(function(k) { besucht[k] = 1; });
        if (ids.length > bestGroesse) { bestGroesse = ids.length; start = id; }
    });
    if (start === null) return null;

    const a = bfsVon(start, nachbarn).entferntester;
    const vonA = bfsVon(a, nachbarn);
    const b = vonA.entferntester;
    const vonB = bfsVon(b, nachbarn);

    // Der Knoten auf dem Weg a..b, dessen groesserer Abstand zu beiden Enden
    // am kleinsten ist.
    let mitte = a, bestMax = Infinity;
    Object.keys(vonA.tiefe).forEach(function(id) {
        if (vonB.tiefe[id] === undefined) return;
        if (vonA.tiefe[id] + vonB.tiefe[id] !== vonA.tiefe[b]) return;   // nur auf dem Weg
        const m = Math.max(vonA.tiefe[id], vonB.tiefe[id]);
        if (m < bestMax) { bestMax = m; mitte = id; }
    });
    return mitte;
}

function buildHopTierPositions(nodes, edges) {
    const tierGap = 190;
    const nodeGap = 150;

    const nachbarn = {};
    const merke = function(a, b) {
        a = String(a); b = String(b);
        if (a === b) return;
        (nachbarn[a] = nachbarn[a] || {})[b] = 1;
        (nachbarn[b] = nachbarn[b] || {})[a] = 1;
    };
    (edges || []).forEach(function(e) {
        merke(e.source !== undefined ? e.source : e.from,
              e.target !== undefined ? e.target : e.to);
    });

    // Wurzel: Internet, sonst Firewall/Router, sonst meiste Nachbarn.
    let wurzeln = nodes.filter(function(n) { return String(n.id).indexOf('internet_') === 0; });
    if (!wurzeln.length) {
        wurzeln = nodes.filter(function(n) { return n.type === 'firewall' || n.type === 'router'; });
    }
    if (!wurzeln.length && nodes.length) {
        const mitte = graphMitte(nodes, nachbarn);
        wurzeln = mitte ? [{ id: mitte }] : [];
    }

    const tiefe = {};
    let rand = wurzeln.map(function(n) { return String(n.id); });
    rand.forEach(function(id) { tiefe[id] = 0; });
    for (let d = 1; rand.length; d++) {
        const naechste = [];
        rand.forEach(function(id) {
            Object.keys(nachbarn[id] || {}).forEach(function(o) {
                if (tiefe[o] === undefined) { tiefe[o] = d; naechste.push(o); }
            });
        });
        rand = naechste;
    }

    // Was der BFS nicht erreicht hat — Inseln ohne Weg zur Wurzel — kommt
    // GANZ nach unten statt auf (0,0). Cytoscape laesst Knoten ohne Position
    // sonst uebereinander liegen, und ein Dutzend Geister im selben Punkt war
    // schon einmal eine Meldung.
    let maxTiefe = 0;
    Object.keys(tiefe).forEach(function(k) { maxTiefe = Math.max(maxTiefe, tiefe[k]); });

    const byTier = {};
    nodes.forEach(function(n) {
        const t2 = tiefe[String(n.id)] !== undefined ? tiefe[String(n.id)] : maxTiefe + 1;
        (byTier[t2] = byTier[t2] || []).push(n);
    });

    const positions = {};
    Object.keys(byTier).map(Number).sort(function(a, b) { return a - b; })
        .forEach(function(tier, idx) {
            const reihe = byTier[tier];
            reihe.sort(function(a, b) {
                return (b.severity || 0) - (a.severity || 0)
                    || String(a.label || '').localeCompare(String(b.label || ''));
            });
            const breite = (reihe.length - 1) * nodeGap;
            reihe.forEach(function(node, i) {
                positions[String(node.id)] = { x: -breite / 2 + i * nodeGap, y: idx * tierGap };
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
// Warum der letzte Aufruf NICHT das gespeicherte Preset genommen hat.
// '' = kein Grund, 'geister' = zu viele Geister fuer eine Anordnung, die nur
// die Hosts kennt. Der Renderer liest es direkt nach dem Aufruf.
let _letzterGrund = '';

export function letzterLayoutGrund() {
    return _letzterGrund;
}

export function buildLayoutConfig(layoutId, nodes, edges, forceFresh) {
    _letzterGrund = '';
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
        // WIE VIEL DER KARTE DECKT DIE GESPEICHERTE ANORDNUNG UEBERHAUPT AB?
        //
        // Die Abdeckung oben fragt nur nach den Hosts, und das ist richtig:
        // Geister haben nie eine gespeicherte Position, und ihre Anwesenheit
        // soll die eigene Anordnung nicht wegwerfen. Gezeichnet werden sie
        // aber trotzdem. Gemeldet aus dem Feld: 30 Hosts, 127 Geister, und auf
        // "Auto" liegt alles uebereinander, waehrend "Force" sauber aussieht.
        //
        // Der Ring um den meldenden Switch traegt acht Geister gut und vierzig
        // nicht mehr. Ueberwiegen sie die Hosts deutlich, ist das Preset kein
        // Preset mehr, sondern ein Drittel Karte mit zwei Dritteln Notbehelf —
        // dann rechnet ein frischer Lauf das bessere Bild. Die Schwelle ist
        // absichtlich hoch: wer seine Anordnung von Hand gelegt hat, soll sie
        // nicht wegen ein paar Geistern verlieren.
        const geister = nodes.length - ids.length;
        const geisterUeberwiegen = ids.length > 0 && geister > ids.length * 2;

        if (coverage >= 0.8 && hasNonZero && !geisterUeberwiegen) {
            const fallback = buildFallbackPositions(nodes, edges, sp);
            return {
                name: 'preset',
                positions: function(node) { return sp[node.id()] || fallback[node.id()]; },
                padding: 30
            };
        }
        // Der Aufrufer soll es SAGEN koennen: eine Karte, die sich anders
        // anordnet als beim letzten Mal, ohne dass jemand etwas geklickt hat,
        // wird sonst fuer einen Fehler gehalten.
        if (coverage >= 0.8 && hasNonZero && geisterUeberwiegen) {
            _letzterGrund = 'geister';
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
        // Ab ein paar hundert Knoten ist cose ein Haarball, egal wie vermascht
        // der Graph ist: die Konnektivitaet des Lasttests lag bei 1,44, also
        // klar ueber jeder Schwelle fuer "dicht" — und 200 Knoten in 215
        // Verbindungen sind trotzdem fast genau ein BAUM. Force-Directed
        // verteilt einen Baum zu einer Wolke. Zwischen "lesbar" und perfMode
        // (ab 1000 Knoten) klaffte hier eine Luecke.
        if (ids.length > 150)                      layoutId = 'hops';
        else if (connectivity < 0.3 && ids.length > 5) layoutId = 'concentric';
        else                                       layoutId = 'cose';
    } else if (layoutId === 'auto' && forceFresh) {
        // Bei "Layout neu rechnen" mit auto: cose — ausser die Karte ist zu
        // gross dafuer. Diese Schwelle stand zuerst nur im anderen Zweig, und
        // damit lieferte derselbe Knopf je nach gespeicherten Positionen ein
        // anderes Ergebnis. Das Gate hat es gefunden.
        const echte = (nodes || []).filter(function(n) {
            return String(n.id).indexOf('ghost_') !== 0;
        }).length;
        layoutId = echte > 150 ? 'hops' : 'cose';
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
        case 'hops':
            // Schichten nach Hop-Abstand zur Uplink-Referenz statt nach
            // Geraetetyp — siehe buildHopTierPositions().
            return {
                name: 'preset',
                positions: (function() {
                    const pos = buildHopTierPositions(nodes, edges);
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
