// build-elements.js — Cytoscape-Element-Aufbau für den Tech-Tab.
//
// Drei Schritte:
//   1. injectInternetCloud(nodes, edges, layoutId)
//      → Bei layout='hierarchy' und mind. 1 Firewall/Router wird ein
//        virtueller Internet-Knoten oben angeflanscht, mit synthetischen
//        Edges zu allen Edge-Devices.
//
//   2. buildNodeElements(nodes)
//      → Map über alle Hosts; gibt Cytoscape-Element-Array zurück mit
//        nodeData (severity, type, traffic, extra_items, links, ...) +
//        bgImage (SVG via makeNodeImage).
//
//   3. buildEdgeElements(edges, nodes)
//      → Edge-Map mit Deduplizierung (Self-Loops und A-B-vs-B-A) +
//        Traffic-Berechnung pro Edge. Internet-Edges werden separat
//        markiert damit die Style-Engine sie als Uplink rendert.
//
// Diese Funktionen kapseln den ganzen Element-Aufbau, sodass render() in
// render-tech.js sich aufs Cytoscape-Init und die Event-Handler konzentrieren
// kann.

import { fmt, linkCapacity } from './utils.js';
import { makeNodeImage } from './icons.js';
import { SEV_COL } from './severity.js';

// Synthetische Internet-Wolke + Edges injizieren, falls nötig.
// Mutiert NICHT die Eingabe-Arrays — gibt neue Arrays zurück.
export function injectInternetCloud(nodes, edges, layoutId) {
    if (layoutId !== 'hierarchy') return { nodes: nodes, edges: edges };

    const edgeDevices = nodes.filter(function(n) {
        return n.type === 'firewall' || n.type === 'router';
    });
    if (edgeDevices.length === 0) return { nodes: nodes, edges: edges };

    const internetLabel = (window.NT_CONFIG && window.NT_CONFIG.internet_label) || 'Internet';
    const internetNode = {
        id: 'internet_root',
        label: internetLabel,
        host: internetLabel,
        ip: '',
        iftype: '',
        type: 'internet',
        severity: 0,
        problems: 0,
        _isInternet: true,   // Flag für Render und Kontextmenü
        groups: [],
        traffic: { in: 0, out: 0 }
    };
    // Prepend statt push — semantisch oben
    const newNodes = [internetNode].concat(nodes);
    // Synthetische Edges: Internet → jedes Edge-Device
    const synthEdges = edgeDevices.map(function(dev) {
        return {
            id: 'einet_' + dev.id,
            source: 'internet_root',
            target: String(dev.id),
            _isInternetEdge: true
        };
    });
    const newEdges = synthEdges.concat(edges || []);
    return { nodes: newNodes, edges: newEdges };
}

// §9 Ghost-Nodes: LLDP/CDP-Nachbarn, die auf KEINEN ueberwachten Zabbix-Host
// aufloesen, als "Geisterknoten" zeigen. Sie existieren im Netz (ein Switch
// meldet sie), aber nicht in Zabbix — genau die Luecke, die man sehen will.
//
// Datenquelle ist lldp_quality[].unmatched, das das Backend ohnehin liefert:
// pro Reporter { id, label, unmatched: [{raw, src}] }. Mehrere Reporter koennen
// denselben Unbekannten melden → EIN Ghost-Knoten, mehrere Kanten.
//
// Mutiert die Eingabe-Arrays NICHT — gibt neue zurueck (wie injectInternetCloud).
export function injectGhostNodes(nodes, edges, lldpQuality) {
    if (!lldpQuality || !lldpQuality.length) return { nodes: nodes, edges: edges };

    const known = {};
    nodes.forEach(function(n) { known[String(n.id)] = true; });

    const ghosts     = {};   // gid → Ghost-Node
    const ghostEdges = [];
    const edgeSeen   = {};

    lldpQuality.forEach(function(q) {
        const reporter = String((q && q.id) || '');
        // Reporter muss selbst auf der Karte sein, sonst haengt der Ghost im Nichts
        // (z.B. wenn die Gruppen-Auswahl den meldenden Host gar nicht enthaelt).
        if (!reporter || !known[reporter]) return;

        (q.unmatched || []).forEach(function(u) {
            const raw = String((u && u.raw) || '').trim();
            if (!raw) return;
            const gid = 'ghost_' + raw.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');
            if (known[gid]) return;   // theoretische ID-Kollision → lieber auslassen

            if (!ghosts[gid]) {
                ghosts[gid] = {
                    id: gid, label: raw, host: raw, ip: '', iftype: '',
                    type: 'ghost', severity: 0, problems: 0,
                    _isGhost: true,
                    _ghostSrc:    [],   // 'lldp' / 'cdp'
                    _ghostSeenBy: [],   // Labels der meldenden Hosts (fuer Tooltip)
                    // Zusatzangaben aus der lldpRemTable, sofern das Template sie
                    // liefert. Ueber ein nicht ueberwachtes Geraet ist sonst nur
                    // der Name bekannt — damit wird aus "da haengt sw-edge-03"
                    // ein "da haengt ein Cisco-Switch".
                    _ghostDesc:    '',  // Hersteller/Modell (lldpRemSysDesc)
                    _ghostCaps:    [],  // Bridge / Router / WLAN AP / Telephone
                    _ghostChassis: '',  // Basis-MAC (lldpRemChassisId)
                    groups: [], traffic: { in: 0, out: 0 }
                };
            }
            const g   = ghosts[gid];
            const src = String((u && u.src) || 'lldp');
            if (g._ghostSrc.indexOf(src) === -1) g._ghostSrc.push(src);
            const rlbl = String((q && q.label) || reporter);
            if (g._ghostSeenBy.indexOf(rlbl) === -1) g._ghostSeenBy.push(rlbl);

            // Erster Melder gewinnt: dasselbe Geraet kann von mehreren Nachbarn
            // gesehen werden, und die Angaben sollten identisch sein. Sind sie
            // es nicht, ist die erste so gut wie jede andere — sie zu mischen
            // waere schlechter als eine zu nehmen.
            if (!g._ghostDesc && u && u.desc)       g._ghostDesc    = String(u.desc);
            if (!g._ghostChassis && u && u.chassis) g._ghostChassis = String(u.chassis);
            if (!g._ghostCaps.length && u && u.caps && u.caps.length) {
                g._ghostCaps = u.caps.slice();
            }

            const eid = 'eghost_' + reporter + '_' + gid;
            if (edgeSeen[eid]) return;
            edgeSeen[eid] = true;
            ghostEdges.push({ id: eid, source: reporter, target: gid, _isGhostEdge: true });
        });
    });

    const list = Object.keys(ghosts).map(function(k) { return ghosts[k]; });
    if (!list.length) return { nodes: nodes, edges: edges };
    return { nodes: nodes.concat(list), edges: (edges || []).concat(ghostEdges) };
}

// Baut Cytoscape-Element-Array für alle Hosts.
// Jedes Element bekommt:
//   - data.bgImage: SVG-data:URL aus makeNodeImage (Severity-Ring + Icons)
//   - alle Felder die Tooltip / Detail-Panel / Kontextmenü brauchen
//   - Aggregat-Marker werden durchgereicht (für Group-View)
// perfMode=true: vereinfachte Knoten (Severity-Punkt via sevColor statt SVG-
// Pie) — spart die makeNodeImage-SVG-Erzeugung, entscheidend bei 1000+ Hosts.
export function buildNodeElements(nodes, perfMode) {
    const elements = [];
    nodes.forEach(function(n) {
        const nodeData = {
            id: n.id,
            label: (function() {
                // IP-Adressen nicht als Label nehmen, falls Host-Name verfügbar
                const lbl = n.label || n.host || '';
                if (/^\d+\.\d+\.\d+\.\d+$/.test(lbl) && n.host && n.host !== lbl) return n.host;
                return lbl || String(n.id);
            })(),
            isGroup: false,
            severity: n.severity || 0,
            // Severity-Farbe fuer den Performance-Modus (background-color statt
            // SVG-Image). Offline (unavailable) sticht als grau heraus.
            sevColor: n.unavailable ? '#9ca3af'
                : SEV_COL[Math.min(n.severity || 0, SEV_COL.length - 1)],
            cpu: n.cpu, memory: n.memory, ping: n.ping, traffic: n.traffic,
            iface_health: n.iface_health || null,
            link_speed: n.link_speed || 0,
            type: n.type, host: n.host, ip: n.ip, iftype: n.iftype,
            groups: n.groups, _primaryGroup: n._primaryGroup,
            // Proxy-Felder durchreichen. Sie fehlten hier, und das schlug an
            // ZWEI Stellen durch, die beide aus n.data() lesen:
            //   - detail-panel.js baut daraus die "via <Proxy>"-Zeile; sie war
            //     dauerhaft leer
            //   - die Kartensuche fragt ueber nodeToQueryFields() danach.
            //     'proxy:core' verglich gegen einen einzelnen Leerraum, traf
            //     also nichts und dimmte JEDEN Host — eine leere Karte ohne
            //     Fehlermeldung, waehrend dieselbe Abfrage in der Tabelle
            //     funktionierte (die bekommt den Backend-Knoten direkt).
            proxy_name: n.proxy_name || '',
            proxy_group_name: n.proxy_group_name || '',
            problems: n.problems || 0,
            acknowledged: !!n.acknowledged,
            maintenance:  !!n.maintenance,
            // Offline-Status durchreichen (Backend liefert 'unavailable' bool +
            // 'down_since' Unix-TS) — render-tech-style + detail-panel nutzen das.
            unavailable:  !!n.unavailable,
            down_since:   n.down_since || 0,
            down_error:   n.down_error || '',
            // Stale-Detection: max(lastclock) aller Live-Metrik-Items.
            // Wenn das deutlich aelter als 5min ist, ist der Host stale.
            last_seen:    n.last_seen || 0,
            // Extra-Items aus nt:show-Tags + icon_override-Flag
            extra_items:  n.extra_items || [],
            icon_override: !!n.icon_override,
            // Custom-Links aus nt:link-Tags (Kontextmenü)
            links:        n.links || [],
            pinned: false,   // wird nach cy-Init aus localStorage gesetzt
            note:   ''       // dito
        };
        // Internet-Wolken-Marker durchreichen
        if (n._isInternet) nodeData._isInternet = true;
        // Ghost-Marker + Herkunft durchreichen (§9) — Style, Tooltip und
        // Kontextmenue erkennen daran den nicht-ueberwachten Nachbarn.
        if (n._isGhost) {
            nodeData._isGhost     = true;
            nodeData._ghostSrc    = n._ghostSrc    || [];
            nodeData._ghostSeenBy = n._ghostSeenBy || [];
        }
        // Aggregat-Marker durchreichen, damit context-menu sie erkennt
        if (n._isAggregate) {
            nodeData._isAggregate = true;
            nodeData._childCount  = n._childCount;
            nodeData._topProblems = n._topProblems;
        }
        // Im Performance-Modus kein SVG bauen — der nt-perf-Style nutzt sevColor.
        // WICHTIG: 'none', NICHT '' — der Basis-Node-Style bildet
        // background-image: data(bgImage) ab; ein LEERER String crasht Cytoscapes
        // Style-Parser beim fit()/Layout ("background-image: is invalid" -> null
        // is not an object). 'none' ist ein gueltiger Wert (= kein Bild).
        nodeData.bgImage = perfMode ? 'none' : makeNodeImage(nodeData);
        elements.push({ data: nodeData });
    });
    return elements;
}

// Baut Cytoscape-Edge-Element-Array.
// - Self-Loops werden weggeworfen
// - Beidseitige Edges (A-B und B-A) werden zu einer reduziert (deduplizierung
//   per sortiertem Endpunkt-Paar)
// - Edges zu nicht-existierenden Knoten werden weggeworfen
// - Internet-Edges (e._isInternetEdge) bekommen einen eigenen leeren
//   Traffic-Datensatz und werden NICHT als isLLDP markiert (sonst würde
//   der LLDP-Toggle sie verstecken).
export function buildEdgeElements(edges, nodes) {
    const elements = [];
    const nodeIds = {}, edgeSeen = {};
    // nodeById-Map einmal bauen statt pro Edge .find() — bei 500 Hosts × 800
    // Edges spart das ~800k Vergleiche pro Render.
    const nodeById = {};
    nodes.forEach(function(n) { nodeIds[n.id] = true; nodeById[String(n.id)] = n; });

    edges.forEach(function(e, i) {
        const src = String(e.source || e.from || '');
        const tgt = String(e.target || e.to || '');
        if (!nodeIds[src] || !nodeIds[tgt] || src === tgt) return;
        const isHosts = (e._type === 'hosts' || e.kind === 'hosts');
        // hosts-Kanten mit eigenem Key-Prefix dedupen, damit sie NICHT mit
        // einer physischen LLDP-Kante zwischen denselben zwei Hosts kollidieren
        // (Hypervisor↔VM koennte theoretisch beides haben — die gerichtete
        // hosts-Kante soll dann ueberleben).
        const k = (isHosts ? 'h_' : '') + [src, tgt].sort().join('_');
        if (edgeSeen[k]) return;
        edgeSeen[k] = true;

        // Hosting/Containment-Kante (nt:parent): GERICHTET Parent→Child, kein
        // Traffic, kein LLDP-Flag (der LLDP-Toggle soll sie nicht verstecken).
        // Style-Engine rendert edge[kind="hosts"] gestrichelt mit Pfeil aufs Child.
        if (isHosts) {
            elements.push({
                data: { id: e.id || ('hosts_' + i), source: src, target: tgt,
                        kind: 'hosts', isLLDP: false,
                        trafficIn: 0, trafficOut: 0, tLabel: '' }
            });
            return;
        }

        // §9 Ghost-Kanten: KEINE Traffic-Berechnung. Sonst erbt die Kante den
        // Node-Summen-Traffic des meldenden Hosts (der Ghost selbst hat 0) und
        // die Weathermap faerbt sie als hoch ausgelastet — voellig irrefuehrend
        // fuer eine Verbindung zu einem Geraet, das wir gar nicht messen.
        if (e._isGhostEdge) {
            elements.push({
                data: { id: e.id || ('eghost_' + i), source: src, target: tgt,
                        trafficIn: 0, trafficOut: 0, tLabel: '', isLLDP: false,
                        _isGhostEdge: true }
            });
            return;
        }

        // Synthetische Internet-Edges: ohne Traffic-Berechnung, ohne LLDP-Flag
        if (e._isInternetEdge) {
            elements.push({
                data: { id: e.id || ('einet_' + i), source: src, target: tgt,
                        trafficIn: 0, trafficOut: 0, tLabel: '', isLLDP: false,
                        _isInternetEdge: true }
            });
            return;
        }

        const srcNode = nodeById[src];
        const tgtNode = nodeById[tgt];
        const tIn  = (srcNode && srcNode.traffic ? srcNode.traffic.in  : 0)
                   + (tgtNode && tgtNode.traffic ? tgtNode.traffic.in  : 0);
        const tOut = (srcNode && srcNode.traffic ? srcNode.traffic.out : 0)
                   + (tgtNode && tgtNode.traffic ? tgtNode.traffic.out : 0);
        const srcDead = (srcNode || {}).severity || 0;
        const tgtDead = (tgtNode || {}).severity || 0;
        const tLabel = (srcDead >= 5 || tgtDead >= 5) ? '\u26A0 No Connection'
                     : (tIn || tOut) ? '\u2193' + fmt(tIn / 2) + '\n\u2191' + fmt(tOut / 2) : '';
        // Edge-Health aus den iface_health-Aggregaten beider Endpunkte:
        // worst-case (max) → wenn EITHER seite Down-Interfaces oder Errors meldet,
        // ist die Verbindung suspekt. False-positives moeglich wenn der Reporter
        // viele Interfaces hat — Tooltip zeigt detaillierte Werte.
        const srcH = (srcNode && srcNode.iface_health) || null;
        const tgtH = (tgtNode && tgtNode.iface_health) || null;
        let downCnt = 0, errorsRate = 0, discardsRate = 0, downRatio = 0;
        if (srcH) {
            downCnt      += srcH.down || 0;
            errorsRate    = Math.max(errorsRate,   srcH.errors   || 0);
            discardsRate  = Math.max(discardsRate, srcH.discards || 0);
            if (srcH.count > 0) downRatio = Math.max(downRatio, (srcH.down || 0) / srcH.count);
        }
        if (tgtH) {
            downCnt      += tgtH.down || 0;
            errorsRate    = Math.max(errorsRate,   tgtH.errors   || 0);
            discardsRate  = Math.max(discardsRate, tgtH.discards || 0);
            if (tgtH.count > 0) downRatio = Math.max(downRatio, (tgtH.down || 0) / tgtH.count);
        }
        // Weathermap-Kapazitaet: Engpass = min der Max-Link-Speeds beider
        // Endpunkte (>0). Ohne Port-Mapping ist das eine Schaetzung — der
        // Tooltip nennt die Basis explizit.
        const spdA = (srcNode && srcNode.link_speed) || 0;
        const spdB = (tgtNode && tgtNode.link_speed) || 0;
        const capBps = linkCapacity(spdA, spdB);
        // Port-Labels (Best-Effort aus dem LLDP-Item-Key des Reporters):
        // Backend liefert edge.ports = {hostid: port} pro gemeldeter Seite —
        // seit §3 lokaler Port am Reporter- UND Remote-Port am Nachbar-Ende.
        const ports = e.ports || {};

        // §3 Per-Link-Traffic: liegt fuer ein Ende eine echte Port-Metrik vor
        // (LLDP-Lokalport ↔ ifIndex korreliert im Backend), ersetzt sie die
        // Node-Summen-Schaetzung — aus geschaetzter Weathermap wird gemessene.
        // port_metrics ist nach Reporter-Hostid gekeyt (in/out/speed des Ports).
        // perLink steuert, dass traffic.js NICHT durch 2 teilt (kein Doppelzaehlen).
        const pm = (e.port_metrics && (e.port_metrics[src] || e.port_metrics[tgt])) || null;
        let perLink = false, eIn = tIn, eOut = tOut, eCap = capBps, tLbl = tLabel;
        if (pm) {
            perLink = true;
            // in/out konsistent aus Sicht des SRC-Knotens: pm ist nach Reporter-
            // Hostid gekeyt; ist der Reporter das TGT-Ende, sind pm.in/out relativ
            // zu SRC gespiegelt → sonst kippen ↓/↑ je nach Melde-Reihenfolge.
            const fromSrc = !!(e.port_metrics && e.port_metrics[src]);
            eIn  = (fromSrc ? pm.in  : pm.out) || 0;
            eOut = (fromSrc ? pm.out : pm.in)  || 0;
            if (pm.speed) eCap = pm.speed;
            tLbl = (srcDead >= 5 || tgtDead >= 5) ? '⚠ No Connection'
                 : (eIn || eOut) ? '↓' + fmt(eIn) + '\n↑' + fmt(eOut) : '';
        }

        elements.push({
            data: { id: 'e' + i, source: src, target: tgt,
                    portSrc: ports[src] || '', portTgt: ports[tgt] || '',
                    trafficIn: eIn, trafficOut: eOut, tLabel: tLbl, isLLDP: true,
                    // Discovery-Quelle(n): ['lldp'], ['cdp'], oder ['cdp','lldp']
                    // wenn die Verbindung von beiden Protokollen gemeldet wurde
                    src: e.src || [],
                    // WER die Kante gemeldet hat. Melden beide Endpunkte
                    // einander, ist sie beidseitig bestaetigt; sieht nur eine
                    // Seite den Nachbarn, ist das ein Diagnosehinweis — meist
                    // LLDP auf der Gegenseite aus, seltener eine Fehlzuordnung.
                    confirmed: e.confirmed === true,
                    reporters: e.reporters || [],
                    // Interface-Health-Aggregat fuer Edge-Styling + Tooltip.
                    // downRatio (worst-case beider Endpunkte) steuert das
                    // Edge-Coloring — der Roh-Count wuerde bei einem Switch
                    // mit vielen unbenutzten Ports jede Edge rot faerben.
                    ifaceDown: downCnt, ifaceErr: errorsRate, ifaceDrop: discardsRate,
                    ifaceDownRatio: downRatio,
                    // Link-Kapazitaet in bps (0 = unbekannt) fuer Weathermap;
                    // perLink=true → echte Port-Metrik statt Node-Schaetzung
                    capBps: eCap, perLink: perLink }
        });
    });
    return elements;
}
