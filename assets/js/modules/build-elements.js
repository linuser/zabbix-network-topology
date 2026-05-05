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

import { fmt } from './utils.js';
import { makeNodeImage } from './icons.js';

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

// Baut Cytoscape-Element-Array für alle Hosts.
// Jedes Element bekommt:
//   - data.bgImage: SVG-data:URL aus makeNodeImage (Severity-Ring + Icons)
//   - alle Felder die Tooltip / Detail-Panel / Kontextmenü brauchen
//   - Aggregat-Marker werden durchgereicht (für Group-View)
export function buildNodeElements(nodes) {
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
            cpu: n.cpu, memory: n.memory, ping: n.ping, traffic: n.traffic,
            type: n.type, host: n.host, ip: n.ip, iftype: n.iftype,
            groups: n.groups, _primaryGroup: n._primaryGroup,
            problems: n.problems || 0,
            acknowledged: !!n.acknowledged,
            maintenance:  !!n.maintenance,
            // Offline-Status durchreichen (Backend liefert 'unavailable' bool +
            // 'down_since' Unix-TS) — render-tech-style + detail-panel nutzen das.
            unavailable:  !!n.unavailable,
            down_since:   n.down_since || 0,
            down_error:   n.down_error || '',
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
        // Aggregat-Marker durchreichen, damit context-menu sie erkennt
        if (n._isAggregate) {
            nodeData._isAggregate = true;
            nodeData._childCount  = n._childCount;
            nodeData._topProblems = n._topProblems;
        }
        nodeData.bgImage = makeNodeImage(nodeData);
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
    nodes.forEach(function(n) { nodeIds[n.id] = true; });

    edges.forEach(function(e, i) {
        const src = String(e.source || e.from || '');
        const tgt = String(e.target || e.to || '');
        if (!nodeIds[src] || !nodeIds[tgt] || src === tgt) return;
        const k = [src, tgt].sort().join('_');
        if (edgeSeen[k]) return;
        edgeSeen[k] = true;

        // Synthetische Internet-Edges: ohne Traffic-Berechnung, ohne LLDP-Flag
        if (e._isInternetEdge) {
            elements.push({
                data: { id: e.id || ('einet_' + i), source: src, target: tgt,
                        trafficIn: 0, trafficOut: 0, tLabel: '', isLLDP: false,
                        _isInternetEdge: true }
            });
            return;
        }

        const srcNode = nodes.find(function(n) { return String(n.id) === src; });
        const tgtNode = nodes.find(function(n) { return String(n.id) === tgt; });
        const tIn  = (srcNode && srcNode.traffic ? srcNode.traffic.in  : 0)
                   + (tgtNode && tgtNode.traffic ? tgtNode.traffic.in  : 0);
        const tOut = (srcNode && srcNode.traffic ? srcNode.traffic.out : 0)
                   + (tgtNode && tgtNode.traffic ? tgtNode.traffic.out : 0);
        const srcDead = (srcNode || {}).severity || 0;
        const tgtDead = (tgtNode || {}).severity || 0;
        const tLabel = (srcDead >= 5 || tgtDead >= 5) ? '\u26A0 No Connection'
                     : (tIn || tOut) ? '\u2193' + fmt(tIn / 2) + '\n\u2191' + fmt(tOut / 2) : '';
        elements.push({
            data: { id: 'e' + i, source: src, target: tgt,
                    trafficIn: tIn, trafficOut: tOut, tLabel: tLabel, isLLDP: true }
        });
    });
    return elements;
}
