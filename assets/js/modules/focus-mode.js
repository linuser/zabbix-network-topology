// focus-mode.js — per-host focus with a hop limit ("show me the core switch
// and everything up to N hops around it").
//
// In large environments (thousands of hosts) the full map is unreadable and
// the force layout unaffordable. The focus filters the raw data BEFORE the
// Cytoscape build: right-click a host → "Focus: N hops" → depth-limited BFS
// over LLDP/CDP, hosts and manual edges, everything outside is dropped.
// Cytoscape only lays out the neighbourhood — exactly what makes the map
// readable AND fast again.
//
// The filter runs at the very top of render() (render-tech.js), BEFORE
// group-view aggregation, internet cloud and ghost injection. Consequences:
//   - the internet cloud only attaches to firewalls/routers inside the focus
//   - ghosts appear as leaves on focus hosts (strictly speaking one hop
//     more — intentional: "what hangs off this?" is the focus question)
//   - the KPI row counts the focus subset, the banner states the ratio
//     ("34 of 2180 hosts")
//
// Lifecycle mirrors whatif.js: module state (no localStorage — a reload
// shows the full map again), banner with an exit, ESC ends it (toolbar.js),
// re-render via injected callback (avoids circular imports, same pattern
// as setResolveAggregateCallback).

import { t } from './i18n.js';
import { loadLinks } from './storage.js';

const MIN_HOPS = 1;
const MAX_HOPS = 6;

let _focusId   = null;   // host id in focus (string) or null
let _focusHops = 1;
// Stats of the last filter run — the banner is built in render() AFTER the
// wrap cleanup and needs the numbers from before.
let _lastStats = { shown: 0, total: 0, label: '' };

// Re-render callback, injected from network-topology.js.
let _rerender = null;
export function setFocusRenderCallback(fn) { _rerender = fn; }

export function isFocusActive() { return _focusId !== null; }
export function getFocusId()    { return _focusId; }
export function getFocusHops()  { return _focusHops; }

export function setFocus(hostId, hops) {
    _focusId   = String(hostId);
    _focusHops = Math.min(MAX_HOPS, Math.max(MIN_HOPS, hops | 0));
    if (_rerender) _rerender();
}

export function clearFocus() {
    if (_focusId === null) return;
    _focusId = null;
    _removeBanner();
    if (_rerender) _rerender();
}

// Discard the state WITHOUT a re-render — for the "focus host disappeared
// from the data" case, which is detected in the middle of render(). A
// re-render from there would recurse; the running render simply shows the
// full map.
export function dropFocus() {
    _focusId = null;
    _removeBanner();
}

function _changeHops(delta) {
    const next = Math.min(MAX_HOPS, Math.max(MIN_HOPS, _focusHops + delta));
    if (next === _focusHops) return;
    _focusHops = next;
    if (_rerender) _rerender();
}

// Depth-limited BFS over the RAW arrays (before Cytoscape). Traverses
// LLDP/CDP edges, hosts edges (hypervisor→VM counts as a hop) and the
// manual links from storage.js — those are real topology, drawn by the
// user, and must not tear the focus apart.
//
// Does not mutate the inputs. Returns:
//   { found: false }                            focus host not in the data
//   { found: true, nodes, edges, shown, total } filtered subset
export function filterToFocus(nodes, edges) {
    const focusId = _focusId;
    const known = {};
    let focusNode = null;
    nodes.forEach(function(n) {
        const id = String(n.id);
        known[id] = true;
        if (id === focusId) focusNode = n;
    });
    if (!focusNode) return { found: false };

    const adj = {};
    function link(a, b) {
        (adj[a] = adj[a] || []).push(b);
        (adj[b] = adj[b] || []).push(a);
    }
    (edges || []).forEach(function(e) {
        const s = String(e.source || e.from || '');
        const tg = String(e.target || e.to || '');
        if (!s || !tg || s === tg || !known[s] || !known[tg]) return;
        link(s, tg);
    });
    loadLinks().forEach(function(l) {
        const s = String(l.s), tg = String(l.t);
        if (s === tg || !known[s] || !known[tg]) return;
        link(s, tg);
    });

    // depth[id] = hop distance to the focus host; only expand up to _focusHops.
    const depth = {};
    depth[focusId] = 0;
    const queue = [focusId];
    while (queue.length) {
        const cur = queue.shift();
        const d = depth[cur];
        if (d >= _focusHops) continue;
        (adj[cur] || []).forEach(function(nb) {
            if (depth[nb] !== undefined) return;
            depth[nb] = d + 1;
            queue.push(nb);
        });
    }

    const fNodes = nodes.filter(function(n) { return depth[String(n.id)] !== undefined; });
    const fEdges = (edges || []).filter(function(e) {
        const s = String(e.source || e.from || '');
        const tg = String(e.target || e.to || '');
        return depth[s] !== undefined && depth[tg] !== undefined;
    });

    _lastStats = {
        shown: fNodes.length,
        total: nodes.length,
        label: focusNode.label || focusNode.host || focusId
    };
    return { found: true, nodes: fNodes, edges: fEdges, shown: fNodes.length, total: nodes.length };
}

// ── Banner: make the running focus visible + change hops + exit ────────────
// Called by render() after the wrap cleanup (which also removes a stale
// banner — hence rebuilt from scratch every time).
function _removeBanner() {
    const b = document.getElementById('nt-focus-banner');
    if (b) b.remove();
}

export function renderFocusBanner(wrap) {
    _removeBanner();
    if (_focusId === null || !wrap) return;

    const banner = document.createElement('div');
    banner.id = 'nt-focus-banner';
    banner.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);'
        + 'z-index:60;background:var(--nt-c-1e3a8a,#1e3a8a);color:var(--nt-c-onaccent,#fff);padding:7px 14px;border-radius:6px;'
        + 'font-size:12px;font-family:sans-serif;display:flex;align-items:center;gap:10px;'
        + 'box-shadow:0 4px 16px rgba(0,0,0,0.3)';

    const txt = document.createElement('span');
    txt.textContent = t('focus.banner', {
        host:  _lastStats.label,
        hops:  _focusHops === 1 ? t('focus.hop_one') : t('focus.hop_n', { n: _focusHops }),
        shown: _lastStats.shown,
        total: _lastStats.total
    });
    banner.appendChild(txt);

    const btnCss = 'background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.4);'
        + 'color:var(--nt-c-onaccent,#fff);border-radius:4px;padding:2px 10px;font-size:11px;cursor:pointer;'
        + 'font-family:inherit';
    [['−', t('focus.minus.tip'), -1], ['+', t('focus.plus.tip'), +1]].forEach(function(def) {
        const b = document.createElement('button');
        b.textContent = def[0];
        b.title = def[1];
        b.style.cssText = btnCss;
        b.addEventListener('click', function() { _changeHops(def[2]); });
        banner.appendChild(b);
    });

    const end = document.createElement('button');
    end.textContent = t('focus.end');
    end.style.cssText = btnCss;
    end.addEventListener('click', function() { clearFocus(); });
    banner.appendChild(end);

    wrap.appendChild(banner);
}
