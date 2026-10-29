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

/**
 * @param dark        Dunkles Theme?
 * @param knotenzahl  Wie viele Knoten gezeichnet werden. Entscheidet, ab
 *                    welchem Zoom Beschriftungen erscheinen — siehe unten.
 * @param sizeFactor  Punktgroesse-Faktor (storage.nodeSizeFactor): 0,7/1,0/1,35.
 *                    Skaliert Knoten UND deren Beschriftung gemeinsam, damit die
 *                    Karte bei vielen Hosts entzerrt — nicht nur die Kreise,
 *                    denn gedraengt sind vor allem die Label-Boxen. Fehlt der
 *                    Wert (Altaufrufe), ist er 1,0 = unveraendert.
 */
export function buildCytoscapeStyle(dark, knotenzahl, sizeFactor) {
    const f = (sizeFactor && sizeFactor > 0) ? sizeFactor : 1;
    // Auf ganze Pixel runden — Cytoscape vertraegt Brueche, aber ganze Werte
    // zeichnen schaerfer. Minimum 1, damit ein kleiner Faktor nichts auf 0 druckt.
    const px = function(n) { return Math.max(1, Math.round(n * f)); };
    // Ab wann eine Beschriftung ueberhaupt gezeichnet wird. Cytoscape
    // vergleicht Schriftgroesse MAL Zoom mit diesem Wert; 8 heisst also, dass
    // bei Zoom 0,73 noch jedes der 200 Labels steht. Genau das war der Grund,
    // warum die Lasttest-Karte grau aussah: nicht die Knoten, der Text.
    // Ueber 150 Knoten muss weiter hineingezoomt werden, bis Namen erscheinen
    // — wer die Uebersicht ansieht, sucht die Form, nicht die Namen.
    const labelSchwelle = (knotenzahl || 0) > 150 ? 15 : 8;

    return [
        { selector: 'node[!isGroup]', style: {
            'width': px(96), 'height': px(96), 'background-opacity': 0, 'border-width': 0,
            'background-image': 'data(bgImage)',
            'background-fit': 'contain', 'background-clip': 'none',
            'label': 'data(label)', 'text-valign': 'bottom', 'text-halign': 'center',
            'font-size': px(11), 'font-family': 'sans-serif',
            'color': dark ? '#e2e8f0' : '#334155',
            // Deckende Label-Box: bei 0.75/0.85 liefen die gestrichelten
            // Kantenlinien durch den Hostnamen (aus dem Feld gemeldet). Farbe
            // bleibt themenabhängig — Canvas erreicht kein var(), deshalb der
            // Hex je nach dark-Flag, nicht fest weiß.
            'text-margin-y': px(6), 'text-background-opacity': 1,
            'text-background-color': dark ? '#1e293b' : '#f8fafc',
            'text-background-padding': '3px', 'text-background-shape': 'roundrectangle',
            'min-zoomed-font-size': labelSchwelle,
        }},
        // Eingeklappte Blaetter: display none, nicht visibility hidden. Der
        // Unterschied ist das Layout — versteckte Knoten belegen weiter Platz,
        // und eine Karte mit 182 unsichtbaren Luecken ist nicht aufgeraeumter
        // als vorher. Im Graphen bleiben sie, nur gezeichnet werden sie nicht:
        // cy.nodes() zaehlt sie weiter, also stimmt die Kopfzeile.
        { selector: '.nt-leaf-hidden', style: { 'display': 'none' }},
        // UniFi-Client-Endgeraete: standardmaessig ausgeblendet (client-focus.js),
        // ein Klick auf ihren AP/Switch blendet nur dessen Clients ein. Ihre Kanten
        // blendet Cytoscape mit aus, sobald ein Endpunkt display:none ist.
        { selector: '.nt-client-hidden', style: { 'display': 'none' }},
        // VLAN-Filter (vlan-filter.js): was NICHT auf dem gewaehlten VLAN liegt,
        // wird gedimmt statt versteckt -- der Kontext (wo liegt das VLAN im Netz)
        // bleibt. Kanten staerker gedimmt als Knoten, wie beim Pfad-Highlight.
        { selector: 'node.nt-vlan-off', style: { 'opacity': 0.12 }},
        { selector: 'edge.nt-vlan-off', style: { 'opacity': 0.05 }},
        // Der Elternknoten sagt, wie viele hinter ihm liegen.
        { selector: 'node[_blaetter]', style: {
            // Das Abzeichen wird HIER zusammengesetzt und nicht in die Daten
            // geschrieben. Vorher haengte collapseLeaves() das "  \u25b8N" an
            // data('label') — und damit an alles, was Labels liest: der
            // Tooltip zeigte "lab-gen-dist-0015 \u25b812", die Nachbarliste im
            // Detail-Panel haette es mitgefuehrt, und CSV, HTML und GraphML
            // haetten ein Darstellungsmerkmal als Geraetenamen exportiert.
            // Derselbe Fehler wie bei einer synthetischen Kante: was fuers
            // Auge gedacht ist, darf nicht in den Bestand.
            'label': function(ele) {
                return (ele.data('label') || '') + '  \u25b8' + ele.data('_blaetter');
            },
            'border-width': 3,
            'border-color': dark ? '#60a5fa' : '#2563eb',
            'border-opacity': 0.9,
            'font-weight': 'bold',
            // Diese Beschriftung MUSS stehen bleiben, auch wenn die anderen
            // wegen labelSchwelle verschwinden: sie ist der einzige Hinweis
            // darauf, dass dort etwas eingeklappt ist.
            'min-zoomed-font-size': 0,
        }},
        // Performance-Modus (render-tech: perfMode): einfacher Severity-Punkt
        // via background-color statt SVG-Pie-Image — spart die makeNodeImage-
        // Erzeugung und rendert 1000+ Knoten fluessig. Klasse ueberschreibt den
        // Basis-Node-Style (Klassen-Selektor > Typ-Selektor).
        { selector: 'node.nt-perf', style: {
            'background-opacity': 1,
            'background-color': 'data(sevColor)',
            'background-image': 'none',
            'width': px(38), 'height': px(38),
            'border-width': 2,
            'border-color': dark ? '#0d1117' : '#ffffff',
            'min-zoomed-font-size': 13,   // Labels erst bei staerkerem Zoom
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
            // Deckend statt 0.88: die Traffic-/×N-Box soll die kreuzenden
            // Bündel-Linien überdecken, nicht durchscheinen lassen (Feldmeldung).
            'text-background-opacity': 1, 'text-background-padding': '3px',
            'color': dark ? '#94a3b8' : '#16a34a',
            'line-cap': 'round', 'text-rotation': 'none', 'text-margin-y': -12,
            // Port-Labels an den Edge-Enden (port-labels.js setzt source-/
            // target-label inline; hier nur die Offsets weg vom Node)
            'source-text-offset': 26, 'target-text-offset': 26,
        }},
        // Beschriftete Kante über die unbeschrifteten legen: in einem Bündel
        // trägt nur der Lead ein tLabel, die Geschwister werden aber NACH ihm
        // gezeichnet (Einfügereihenfolge) und ihre gestrichelte Linie lief
        // sonst über die (jetzt deckende) Box. z-index hebt den Lead über die
        // anderen KANTEN; die Node-über-Edge-Regel (z-index-compare: auto)
        // bleibt, die Box verdeckt also keine Knoten. Path-Highlight (999)
        // liegt weiterhin darüber.
        { selector: 'edge[?tLabel]', style: { 'z-index': 10 }},
        // Hosting/Containment-Kante (nt:parent → build-elements kind=hosts):
        // gerichtet Parent→Child (Pfeil zeigt auf den gehosteten Host), violett
        // + fein gestrichelt, klar abgesetzt von gruenem LLDP und blauem Uplink.
        // Semantik: harte Abhaengigkeit — What-if/Root-Cause behandeln das als
        // "Parent tot → Child tot".
        { selector: 'edge[kind = "hosts"]', style: {
            'width': 2, 'line-color': '#a78bfa', 'line-style': 'dashed',
            'line-dash-pattern': [2, 4], 'opacity': 0.8,
            'target-arrow-shape': 'triangle', 'target-arrow-color': '#a78bfa',
            'target-arrow-fill': 'filled', 'arrow-scale': 0.9,
            'label': '', 'source-text-offset': 0, 'target-text-offset': 0,
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
        // §9 Ghost-Knoten: LLDP/CDP-Nachbar, der auf keinen ueberwachten Host
        // aufloest. BEWUSST "unfertig" gezeichnet — kleiner, halbtransparent,
        // gestrichelter Rand, kursives Label: existiert im Netz, aber NICHT in
        // der Ueberwachung. Kein bgImage (der Severity-Ring waere gruen = "OK"
        // und damit eine Falschaussage) → wie nt-perf per Farbe/Rand statt Bild.
        { selector: 'node[?_isGhost]', style: {
            'background-image': 'none',
            'background-opacity': 0.10,
            'background-color': dark ? '#94a3b8' : '#64748b',
            'width': px(44), 'height': px(44),
            'border-width': 2, 'border-style': 'dashed',
            'border-color': dark ? '#64748b' : '#94a3b8', 'border-opacity': 0.9,
            'opacity': 0.7,
            'color': dark ? '#94a3b8' : '#64748b',
            'font-style': 'italic',
            'min-zoomed-font-size': 9,
        }},
        // Endgeraete-Buendel: ein abgerundetes Rechteck statt eines Icons —
        // es ist kein Geraet, sondern eine Schachtel voller Geraete. Die
        // doppelte Kontur deutet den Stapel an; die Beschriftung ("34
        // Endgeraete") kommt aus den Daten. Klickbar, deshalb kein gedaempftes
        // opacity wie beim Geist — ein Buendel ist eine Handlungsaufforderung.
        { selector: 'node[?_isEndpointBundle]', style: {
            'background-image': 'none',
            'shape': 'round-rectangle',
            'background-color': dark ? '#475569' : '#cbd5e1',
            'background-opacity': 0.9,
            'width': px(58), 'height': px(36),
            'border-width': 2, 'border-style': 'solid',
            'border-color': dark ? '#94a3b8' : '#64748b',
            'color': dark ? '#e2e8f0' : '#334155',
            'font-size': px(10), 'font-weight': 600,
            'text-valign': 'center', 'text-halign': 'center',
            'min-zoomed-font-size': 7,
        }},
        // Neu aufgetauchte Kante. Bewusst nur eine Glorie (underlay) statt
        // einer eigenen Linienfarbe: die Kante soll weiter zeigen, was sie
        // zeigt — Traffic, Auslastung, Zustand —, und zusaetzlich auffallen.
        // Eine gruene Linie haette die Weathermap-Aussage ueberschrieben.
        { selector: 'edge[?_isFreshEdge]', style: {
            'underlay-color': '#16a34a', 'underlay-opacity': 0.22,
            'underlay-padding': 4,
        }},
        // Ring-/Loop-Erkennung (Toggle "◯ Rings"). Wie die Glorie oben: ein
        // underlay-Halo, KEINE eigene Linienfarbe — Weathermap/STP bleiben
        // sichtbar, der Ring faellt zusaetzlich auf. Drei Stufen:
        //   safe    — Zyklus mit blockendem STP-Zweig: gewollte Redundanz (cyan)
        //   unknown — Zyklus ohne STP-Daten: Ring, aber nicht beurteilbar (grau)
        //   open    — Zyklus, STP blockt NICHTS: Loop-Gefahr (rot, kraeftiger)
        { selector: 'edge.nt-ring-safe', style: {
            'underlay-color': dark ? '#22d3ee' : '#0891b2', 'underlay-opacity': 0.22,
            'underlay-padding': 4,
        }},
        { selector: 'edge.nt-ring-unknown', style: {
            'underlay-color': dark ? '#94a3b8' : '#64748b', 'underlay-opacity': 0.18,
            'underlay-padding': 3,
        }},
        { selector: 'edge.nt-ring-open', style: {
            'underlay-color': dark ? '#f87171' : '#dc2626', 'underlay-opacity': 0.4,
            'underlay-padding': 6,
        }},
        // Ring, dessen Host instabiles STP hat (Topology-Changes flappen) ->
        // Loop-Fruehwarnung. Amber, kraeftiger als "sicher", schwaecher als "open".
        { selector: 'edge.nt-ring-churn', style: {
            'underlay-color': dark ? '#f59e0b' : '#d97706', 'underlay-opacity': 0.38,
            'underlay-padding': 5,
        }},
        // Aktiver Broadcast-Storm im Ring -> ein Loop laeuft JETZT. Staerkstes
        // Signal: kraeftiges Rot, breiter Halo, ueber allem anderen.
        { selector: 'edge.nt-ring-storm', style: {
            'underlay-color': dark ? '#ef4444' : '#b91c1c', 'underlay-opacity': 0.55,
            'underlay-padding': 8,
        }},
        // MAC-Flapping im Ring -> MACs wandern, ein Loop laeuft. Rot, zwischen
        // Storm und "open".
        { selector: 'edge.nt-ring-flap', style: {
            'underlay-color': dark ? '#f87171' : '#dc2626', 'underlay-opacity': 0.46,
            'underlay-padding': 7,
        }},
        // Soll/Ist-Overlay: eine ERWARTETE Verbindung (nt:expect), die NICHT
        // gemessen wird — rot gestrichelt zwischen den beiden Hosts, mit Label.
        // Eine GEZEICHNETE Kante (kein Halo), weil die Verbindung real fehlt;
        // expected-links.js injiziert sie und entfernt sie bei Toggle-Aus.
        { selector: 'edge.nt-expected', style: {
            'width': 2.5,
            'line-color': dark ? '#f87171' : '#dc2626',
            'line-style': 'dashed',
            'line-dash-pattern': [6, 4],
            'curve-style': 'bezier',
            'target-arrow-shape': 'none',
            'opacity': 0.9,
            'z-index': 25,
            'label': 'data(tLabel)',
            'font-size': 9,
            'color': dark ? '#fca5a5' : '#b91c1c',
            'text-background-color': dark ? '#1e293b' : '#ffffff',
            'text-background-opacity': 0.85,
            'text-background-padding': 2,
        }},
        // Alternde Kante: zuletzt gemeldet, aber gerade nicht. Deutlich
        // schwaecher als eine lebende, aber KRAEFTIGER als eine Ghost-Kante —
        // sie war eben noch echt. Punktiert statt gestrichelt, damit sich die
        // beiden auf einen Blick unterscheiden.
        { selector: 'edge[?_isStaleEdge]', style: {
            'width': 2, 'line-color': dark ? '#7c6f5a' : '#c2a878',
            'line-style': 'dotted', 'line-dash-pattern': [1, 4],
            'opacity': 0.6, 'curve-style': 'straight',
            'label': '', 'source-text-offset': 0, 'target-text-offset': 0,
        }},
        { selector: 'edge[?_isGhostEdge]', style: {
            'width': 1.5, 'line-color': dark ? '#64748b' : '#94a3b8',
            'line-style': 'dashed', 'line-dash-pattern': [2, 5],
            'opacity': 0.45, 'curve-style': 'straight',
            'label': '', 'source-text-offset': 0, 'target-text-offset': 0,
        }},
        // UniFi-Funkverbindung (Client<->AP, AP<->AP-Mesh): cyan, gepunktet.
        // Fallback fuer den Fall, dass die Weathermap (traffic.js) noch nicht
        // gelaufen ist -- dort steht derselbe Stil als Inline-Override, weil
        // traffic.js sonst jede Kante nach Auslastung umfaerbt.
        { selector: 'edge[?_unifiWireless]', style: {
            'width': 2, 'line-color': dark ? '#22d3ee' : '#0891b2',
            'color': dark ? '#22d3ee' : '#0891b2',
            'line-style': 'dotted', 'line-dash-pattern': [2, 4],
            'opacity': dark ? 0.75 : 0.7,
        }},
        // Manuell gezogene Kanten. Seit 5.0.1 gibt es zwei Ebenen, und man muss
        // ihnen ansehen, welche man vor sich hat: eine geteilte Kante ist eine
        // Aussage ueber das Netz, die alle sehen — eine persoenliche nur die
        // eigene Notiz. Beide gestrichelt, weil sie nicht gemessen, sondern
        // behauptet sind; die geteilte kraeftiger und durchgezogener.
        { selector: 'edge[mlScope = "shared"]', style: {
            'width': 2.5, 'line-color': dark ? '#a78bfa' : '#7c3aed',
            'line-style': 'dashed', 'line-dash-pattern': [8, 3], 'opacity': 0.9,
        }},
        { selector: 'edge[mlScope = "personal"]', style: {
            'width': 1.5, 'line-color': dark ? '#818cf8' : '#6366f1',
            'line-style': 'dashed', 'line-dash-pattern': [3, 4], 'opacity': 0.6,
        }},
        // Parallel links (parallel-links.js). AFTER the stale/ghost/manual
        // rules on purpose: an ageing LAG member keeps its dotted look but
        // must bend with its bundle instead of going straight — and a later
        // rule of equal specificity wins.
        //
        // Every member is an unbundled bezier with its own distance (cpd),
        // fanned out around the 60 px bow of a single edge: the bundle reads
        // as "this link, several times" rather than as a different shape.
        { selector: 'edge.nt-par', style: {
            'curve-style': 'unbundled-bezier',
            'control-point-distances': 'data(cpd)', 'control-point-weights': [0.5],
            'source-text-margin-y': 'data(portShift)', 'target-text-margin-y': 'data(portShift)',
            // The ageing style zeroes these; a failed member's port label
            // must still line up with its siblings'.
            'source-text-offset': 26, 'target-text-offset': 26,
        }},
        // A member that is no longer reported while its siblings still are:
        // for a LAG that is a failed cable or port, not a flaky discovery.
        // Red instead of the beige of an ordinary ageing edge — next to live
        // members the beige barely registers.
        { selector: 'edge.nt-par[?_isStaleEdge]', style: {
            'line-color': '#dc2626', 'line-style': 'dashed', 'line-dash-pattern': [4, 4],
            'width': 2, 'opacity': 0.85,
        }},
        // Collapsed: the lead becomes the trunk on the plain bow, the rest is
        // hidden. visibility, not display — see parallel-links.js.
        // The ×N label is the only hint that this line is several cables —
        // larger and bold, so it survives a zoomed-out map.
        { selector: 'edge.nt-trunk', style: {
            'control-point-distances': [60],
            'font-size': 12, 'font-weight': 'bold',
            'source-text-margin-y': 0, 'target-text-margin-y': 0,
        }},
        { selector: 'edge.nt-par-hidden', style: { 'visibility': 'hidden', 'events': 'no' }},
        // A trunk with a failed member. A glow, not a line colour: the colour
        // stays the weathermap's statement (same reasoning as _isFreshEdge).
        // Amber-500 leuchtet auf dunklem Grund und verwaescht auf hellem —
        // deshalb im hellen Theme der dunklere Ton und weniger Deckung. Die
        // Aussage haengt ohnehin nicht allein an der Farbe: das Label sagt
        // "(1 down)" im Klartext dazu.
        { selector: 'edge.nt-trunk.nt-par-degraded', style: {
            'underlay-color': dark ? '#f59e0b' : '#d97706',
            'underlay-opacity': dark ? 0.55 : 0.4,
            'underlay-padding': 7,
        }},
        // Rollenakzent: was den Weg nach draussen haelt, soll man suchen
        // koennen, ohne Namen zu lesen. Router und Firewalls tragen deshalb
        // einen farbigen Ring — rot fuer die Firewall, violett fuer den
        // Router. Das ist bewusst nur die INFRASTRUKTUR-Rolle und keine
        // Dienstrolle: welcher Host DHCP macht, steht in keiner
        // Nachbartabelle, das weiss nur Zabbix.
        { selector: 'node[type = "firewall"]', style: {
            'border-width': 4, 'border-color': '#dc2626', 'border-opacity': 0.85,
        }},
        { selector: 'node[type = "router"]', style: {
            'border-width': 4, 'border-color': '#7c3aed', 'border-opacity': 0.85,
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
        // What-if-Ausfallsimulation (whatif.js): grau getoent = simuliert tot,
        // rot getoent = dadurch vom Uplink abgeschnitten.
        //
        // OVERLAY statt underlay: die Nodes haben background-opacity:0
        // (transparenter Body, nur das SVG-Icon per background-image). Ein
        // underlay wird HINTER dem Body kompositiert — Firefox ueberspringt
        // die Ebene bei transparentem Body, die Halos blieben dort unsichtbar
        // (in Chrome gingen sie). overlay-* rendert OBEN drauf (Cytoscapes
        // battle-tested Selektions-Highlight) und ist cross-browser zuverlaessig.
        // Niemand setzt overlay-* inline → kein Heatmap-Konflikt.
        { selector: 'node.nt-sim-dead', style: {
            'overlay-color': '#475569', 'overlay-padding': 9, 'overlay-opacity': 0.45,
        }},
        { selector: 'node.nt-sim-cut', style: {
            'overlay-color': '#dc2626', 'overlay-padding': 9, 'overlay-opacity': 0.4,
        }},
        // Root-Cause-Analyse (root-cause.js): kraeftig rot = Ursache des
        // Ausfalls, amber = Folge-Ausfall dahinter. Gleiche Overlay-Begruendung.
        { selector: 'node.nt-rc-cause', style: {
            'overlay-color': '#b91c1c', 'overlay-padding': 11, 'overlay-opacity': 0.45,
        }},
        { selector: 'node.nt-rc-victim', style: {
            'overlay-color': '#f59e0b', 'overlay-padding': 7, 'overlay-opacity': 0.35,
        }},
    ];
}
