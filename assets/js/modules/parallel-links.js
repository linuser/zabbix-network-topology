// parallel-links.js — several physical links between the same two hosts.
//
// WHAT THIS IS
// ------------
// A LAG, a bond or simply two cables: the backend (LldpEdgeBuilder::
// findMember) now delivers ONE EDGE PER CABLE. Until 5.3 it merged them
// first-wins into a single line — one member's port, one member's counters,
// and a failed member was invisible.
//
// Two ways to draw a bundle:
//
//   fan    every member its own curve, side by side, each with its own
//          weathermap colour, ports and state. A failed member is a red
//          dashed line among live ones.
//   trunk  ONE thicker line with "×N", total traffic against total capacity.
//          Amber glow when a member is down. For the overview, where a fan
//          of lines is just clutter.
//
// View -> "All parallel links":
//   on   (default) fanned from AUTO_ZOOM upwards, trunk below it
//   off  always the trunk. For dense maps — switches meshed with six or
//        seven cables each turn into a thicket of curves at any zoom.
//
// WHY THE MEMBERS STAY IN THE GRAPH WHEN COLLAPSED
// ------------------------------------------------
// The trunk is the lead member restyled, not a synthetic edge. A synthetic
// one would be counted by every cy.edges() user — KPI, export, what-if,
// path search — and each of them would need to learn to skip it. The other
// members are hidden with `visibility`, not `display`: display is owned
// inline by the LLDP toggle and the severity filter, and an inline value
// beats any class.

import { NT_PARLINKS_KEY } from './storage.js';
import { fmt } from './utils.js';
import { t } from './i18n.js';

const AUTO_ZOOM = 0.6;
// Distance between two member curves, px. The single-edge bow is 60 px
// (render-tech-style.js); a bundle fans out around that same bow so that it
// reads as "this link, several times".
// Large bundles are packed tighter: the fan never gets wider than MAX_SPREAD,
// or seven cables would spread over 84 px.
const STEP       = 14;
const MAX_SPREAD = 60;
const BOW    = 60;
// Port labels at the ends would sit on top of each other where the curves
// converge. Staggering them ALONG the edge is not enough — a label is far
// wider than the step, so on a flat edge they still collide. Stacked
// vertically they form a small port list, whatever the edge's direction.
const PORT_LINE = 18;

// '0' = off. Anything else is on — including 'auto', 'fan' and 'trunk'
// from the first cut of this feature, of which only 'trunk' meant "never
// fan out".
let _all = true;
try {
    const v = localStorage.getItem(NT_PARLINKS_KEY);
    if (v === '0' || v === 'trunk') _all = false;
} catch (e) { /* private window: default */ }

export function allLinksOn() { return _all; }

export function setAllLinks(on) {
    _all = !!on;
    try { localStorage.setItem(NT_PARLINKS_KEY, _all ? '1' : '0'); } catch (e) { /* no storage */ }
}

function isMember(d) {
    // Physical links only: measured LLDP/CDP edges and ageing ones. Hosting
    // edges, ghosts, the internet cloud and manual links are no cables.
    return !!(d.isLLDP || d._isStaleEdge) && d.kind !== 'hosts';
}

// A member counts as down when it is no longer reported (stale) OR when its
// port is operationally down. The second case is the one 5.3.2 taught the
// backend to see (port_metrics.down per interface, not the host's ratio of
// down ports), and it is the one that matters here: a LAG member whose cable
// was pulled keeps being reported by the OTHER end for the whole stale TTL,
// so the bundle would still read "x4, all fine" for fifteen minutes.
export function memberDown(d) {
    return !!d._isStaleEdge || d.portDown === true;
}

function naturalCmp(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/**
 * Group parallel links and annotate them. Runs once on the finished element
 * list of buildEdgeElements(); mutates the data objects in place.
 *
 * Per member: bundle, bundleSize, bundleIdx, cpd (curve distance), portShift
 * and the class 'nt-par'. The lead (bundleIdx 0) additionally carries the
 * totals the trunk shows.
 */
export function annotateBundles(elements) {
    const groups = {};
    elements.forEach(function(el) {
        const d = el.data;
        if (!d || !isMember(d)) return;
        const pair = [String(d.source), String(d.target)].sort();
        const k = pair[0] + '|' + pair[1];
        (groups[k] = groups[k] || []).push(el);
    });

    Object.keys(groups).forEach(function(k) {
        const members = groups[k];
        if (members.length < 2) return;

        // Stable order: live before ageing, then by port. The lead should be
        // a live member — it carries the label.
        members.sort(function(a, b) {
            const sa = a.data._isStaleEdge ? 1 : 0, sb = b.data._isStaleEdge ? 1 : 0;
            if (sa !== sb) return sa - sb;
            return naturalCmp(a.data.portSrc || a.data.portTgt || a.data.id,
                              b.data.portSrc || b.data.portTgt || b.data.id);
        });

        const live = members.filter(function(m) { return !m.data._isStaleEdge; });
        const n = members.length;

        // Estimate members carry the NODE TOTALS of both ends (build-elements).
        // Each of n cables would repeat the same totals, and a bundle of four
        // would show four times the host's traffic. Split them evenly — the
        // honest statement for "we don't know which cable carries what".
        live.forEach(function(m) {
            const d = m.data;
            if (!d.perLink && live.length > 1) {
                d.trafficIn  = (d.trafficIn  || 0) / live.length;
                d.trafficOut = (d.trafficOut || 0) / live.length;
            }
        });

        // Totals for the trunk. Measured and estimated values differ by the
        // /2 of utilizationPct(); when all members agree the flag passes
        // through, a mixed bundle is converted to link values first.
        const measured = live.length > 0 && live.every(function(m) { return m.data.perLink; });
        const anyMeasured = live.some(function(m) { return m.data.perLink; });
        let bIn = 0, bOut = 0, bCap = 0, capKnown = live.length > 0;
        live.forEach(function(m) {
            const d = m.data;
            const f = (anyMeasured && !d.perLink) ? 0.5 : 1;
            bIn  += (d.trafficIn  || 0) * f;
            bOut += (d.trafficOut || 0) * f;
            if ((d.capBps || 0) > 0) bCap += d.capBps; else capKnown = false;
        });
        const down = members.filter(function(m) { return memberDown(m.data); }).length;
        // The worst member decides the trunk's health colour, the totals
        // decide its traffic colour. Red is reserved for "nothing left" —
        // a bundle of four with one dead cable is degraded, not down, and
        // says so with the amber glow plus "(1 down)".
        let bErr = 0, bDrop = 0;
        members.forEach(function(m) {
            bErr  = Math.max(bErr,  m.data.ifaceErr  || 0);
            bDrop = Math.max(bDrop, m.data.ifaceDrop || 0);
        });

        const lead = members[0].data;
        const leadSrc = String(lead.source);
        members.forEach(function(m, i) {
            const d = m.data;
            d.bundle     = k;
            d.bundleSize = n;
            d.bundleIdx  = i;
            // Curves are measured relative to source->target; a member drawn
            // the other way round bends to the other side, so flip its sign.
            const step = Math.min(STEP, MAX_SPREAD / (n - 1));
            const off = BOW + (i - (n - 1) / 2) * step;
            d.cpd = String(d.source) === leadSrc ? off : -off;
            d.portShift = (i - (n - 1) / 2) * PORT_LINE;
            // Only the lead is labelled; n traffic labels stacked a few pixels
            // apart are unreadable. The member's own numbers stay in the
            // tooltip and panel.
            if (i > 0) d.tLabel = '';
            m.classes = ((m.classes || '') + ' nt-par').trim();
        });

        lead.bundleIn       = bIn;
        lead.bundleOut      = bOut;
        lead.bundleCap      = capKnown ? bCap : 0;
        lead.bundlePerLink  = anyMeasured;
        lead.bundleMeasured = measured;
        lead.bundleDown     = down;
        lead.bundleErr      = bErr;
        lead.bundleDrop     = bDrop;
        const shown = anyMeasured ? 1 : 0.5;   // same /2 as the edge labels
        lead.tLabel = bundleLabel(n, down, (bIn || bOut) ? ('↓' + fmt(bIn * shown) + '\n↑' + fmt(bOut * shown)) : '');
        if (down > 0) members[0].classes += ' nt-par-degraded';
    });
    return elements;
}

/** "×2", "×2 (1 down)", optionally followed by a traffic / utilisation line. */
export function bundleLabel(n, down, rest) {
    let s = '×' + n;
    if (down > 0) s += ' (' + t('parlinks.down', { n: down }) + ')';
    return rest ? s + '\n' + rest : s;
}

/** Are bundles currently collapsed into trunks? */
export function isCollapsed(cy) {
    if (!_all) return true;
    return !!cy && cy.zoom() < AUTO_ZOOM;
}

/**
 * Apply fan or trunk to every bundle. Returns true when anything changed, so
 * the caller knows whether the heatmap has to run again (the trunk is
 * coloured from the totals, a member from its own values).
 */
export function applyBundleView(cy) {
    if (!cy || (cy.destroyed && cy.destroyed())) return false;
    const collapsed = isCollapsed(cy);
    let changed = false;
    cy.batch(function() {
        cy.edges('.nt-par').forEach(function(e) {
            if (e.data('bundleIdx') === 0) {
                if (e.hasClass('nt-trunk') !== collapsed) { e.toggleClass('nt-trunk', collapsed); changed = true; }
            } else if (e.hasClass('nt-par-hidden') !== collapsed) {
                e.toggleClass('nt-par-hidden', collapsed);
                changed = true;
            }
        });
    });
    return changed;
}

/**
 * Follow the zoom while all links are on. onChange(cy) runs after a flip — the
 * heatmap, which reads the trunk class.
 */
export function bindBundleView(cy, onChange) {
    if (!cy) return;
    let pending = false;
    cy.on('zoom', function() {
        if (!_all || pending) return;
        pending = true;
        requestAnimationFrame(function() {
            pending = false;
            if (applyBundleView(cy) && onChange) onChange(cy);
        });
    });
}

/** All members of the bundle an edge belongs to (the edge alone otherwise). */
export function bundleMembers(edge) {
    const k = edge && edge.data('bundle');
    if (!k) return edge;
    return edge.cy().edges('.nt-par').filter(function(e) { return e.data('bundle') === k; });
}

/**
 * Data of an edge as the trunk presents it: totals instead of the lead's own
 * numbers. For tooltip, panel and heatmap; the edge itself is not changed.
 * Only while collapsed, unless `force` (the lead's bundle label in fan mode).
 */
export function trunkData(edge, force) {
    const d = edge.data();
    if (!(d.bundleSize > 1 && d.bundleIdx === 0) || (!force && !edge.hasClass('nt-trunk'))) return d;
    return Object.assign({}, d, {
        trafficIn: d.bundleIn || 0, trafficOut: d.bundleOut || 0,
        capBps: d.bundleCap || 0, perLink: !!d.bundlePerLink,
        portSrc: '', portTgt: '', _trunk: true,
        // Health of the BUNDLE, not of the lead member: without this the
        // trunk was drawn from the state of whichever cable happened to sort
        // first, and a dead member three curves further along was invisible
        // as soon as the map collapsed the bundle.
        // All members down -> the link is gone, red. Some down -> degraded,
        // and explicitly NOT red: the bundle still carries traffic. None
        // down -> say nothing and let the host-level fallback decide, as it
        // does for a single edge.
        portDown: (d.bundleDown || 0) >= d.bundleSize ? true
            : ((d.bundleDown || 0) > 0 ? false : d.portDown),
        ifaceErr: d.bundleErr || 0, ifaceDrop: d.bundleDrop || 0,
    });
}
