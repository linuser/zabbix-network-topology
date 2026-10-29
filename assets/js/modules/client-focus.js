// client-focus.js — UniFi client endpoints (type 'client', flag is_client) are
// hidden on the map by default and revealed per AP on demand.
//
// Why: a site with UniFi monitors every connected phone, IoT gadget and laptop
// as a host. On a TOPOLOGY map those are noise — dozens of leaf nodes hanging
// off the controller/APs, and their edges crisscross everything (the "chaos"
// the field reported, 2026-10-26). But the association is useful on demand:
// each client carries uplink.id = the UUID of the AP it is on, so the module
// already draws a client→AP edge. The answer to "who hangs off this AP?" is one
// click away.
//
// The interaction is deliberately a plain tap, no toolbar toggle (user's call):
//   - default            every client hidden (its edges hide with it)
//   - tap an AP/switch   reveal ONLY the clients adjacent to it, hide the rest
//   - tap the background  hide them all again
//
// No re-layout: the clients ARE in the graph and were positioned next to their
// AP by the force layout; we only toggle a display class. That also means no
// interaction with the aggregation/collapse paths (which run before the build)
// — in the default view the clients are individual nodes, exactly what this
// toggles. Cytoscape hides an edge automatically once an endpoint is display:none,
// so the client edges follow their node without extra bookkeeping.

const HIDDEN = 'nt-client-hidden';

let _cy = null;

function _clients() {
    return _cy ? _cy.nodes('[?is_client]') : null;
}

// Hide every client. Called once right after the graph is built, and whenever
// the selection is cleared.
export function initClientFocus(cy) {
    _cy = cy;
    const cl = _clients();
    if (cl) cl.addClass(HIDDEN);
}

export function hideAllClients() {
    const cl = _clients();
    if (cl) cl.addClass(HIDDEN);
}

// Reveal the clients directly attached to `nodeId` (an AP/switch/gateway) and
// hide all others. Returns the number shown. Tapping a node with no clients
// simply hides whatever was shown — a clean way to "close" the last reveal.
export function revealClientsOf(nodeId) {
    if (!_cy) return 0;
    const host = _cy.getElementById(String(nodeId));
    if (!host || !host.length) { hideAllClients(); return 0; }

    // Direct client neighbours of this host (via the uplink.id edge).
    const mine = host.neighborhood('node[?is_client]');
    const cl = _clients();
    if (cl) cl.addClass(HIDDEN);     // start from all-hidden …
    mine.removeClass(HIDDEN);        // … then show just this host's clients

    // Arrange the revealed clients in a ring around their host. These hosts
    // carried scattered saved positions from their old 'server' days; a ring
    // makes the reveal read as "these hang off this AP" rather than dots all
    // over the canvas. Set programmatically → ephemeral, not persisted here.
    if (mine.length) {
        const c = host.position();
        const r = 64 + mine.length * 3;
        mine.forEach(function(cn, i) {
            const ang = (2 * Math.PI * i) / mine.length - Math.PI / 2;
            cn.position({ x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) });
        });
    }
    return mine.length;
}

// Is a given node a client endpoint? (so render-tech can skip re-revealing when
// the tap landed on a client itself).
export function isClientNode(node) {
    return !!(node && node.data && node.data('is_client'));
}
