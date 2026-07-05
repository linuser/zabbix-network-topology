// render-tree.js — Hierarchische Top-Down-Ansicht (breadthfirst).
//
// Wählt automatisch den am stärksten verbundenen Knoten als Wurzel und legt
// die Topologie als Baum von oben nach unten an. Gut für klassische Star-/
// Tree-Topologien, wo die logische Hierarchie wichtiger ist als physische
// Geografie.
//
// Cytoscape ist als globales Symbol verfügbar (über separates Script-Tag in
// der View geladen, vor dem ES-Module).

import { makeNodeImage } from './icons.js';
import { esc } from './utils.js';
import { t } from './i18n.js';
import { showTip, hideTip, moveTip } from './tooltip.js';
import { showCtx, hideCtx } from './context-menu.js';

const SEV_BORDER = ['#cbd5e1', '#06b6d4', '#f59e0b', '#f97316', '#ef4444', '#991b1b'];

export function renderTree(wrap, nodes, edges) {
    if (!nodes.length) {
        wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;'
                       + 'height:100%;color:#999">' + esc(t('tech.no_hosts')) + '</div>';
        return;
    }

    if (window._ntEdgeAnim) { clearInterval(window._ntEdgeAnim); window._ntEdgeAnim = null; }
    if (window._ntCy) { try { window._ntCy.destroy(); } catch (e) {} window._ntCy = null; }

    wrap.innerHTML = '';
    const canvas = document.createElement('div');
    canvas.style.cssText = 'width:' + wrap.clientWidth + 'px;height:' + wrap.clientHeight + 'px;';
    wrap.appendChild(canvas);

    // Wurzel = der Knoten mit dem höchsten Grad
    const degree = {};
    nodes.forEach(function(n) { degree[String(n.id)] = 0; });
    edges.forEach(function(e) {
        const f = String(e.from), t = String(e.to);
        if (degree[f] !== undefined) degree[f]++;
        if (degree[t] !== undefined) degree[t]++;
    });
    const rootId = String(nodes.reduce(function(best, n) {
        return (degree[String(n.id)] || 0) > (degree[String(best.id)] || 0) ? n : best;
    }, nodes[0]).id);

    const elements = [];
    nodes.forEach(function(n) {
        elements.push({
            data: {
                id: String(n.id),
                label: n.label || n.host || String(n.id),
                type: n.type || 'server',
                severity: n.severity || 0,
                ip: n.ip || '',
                host: n.host || '',
                iftype: n.iftype || '',
                cpu: n.cpu, memory: n.memory, ping: n.ping,
                traffic: n.traffic || { in: 0, out: 0 },
                bgImage: makeNodeImage(n)
            }
        });
    });
    edges.forEach(function(e) {
        elements.push({ data: { id: 'te_' + e.id, source: String(e.from), target: String(e.to) } });
    });

    const cy = cytoscape({
        container: canvas,
        elements: elements,
        layout: {
            name: 'breadthfirst', directed: true, roots: ['#' + rootId],
            padding: 50, spacingFactor: 1.4, avoidOverlap: true, animate: false, fit: true
        },
        style: [
            { selector: 'node', style: {
                'width': 44, 'height': 44,
                'background-image': 'data(bgImage)',
                'background-fit': 'contain',
                'background-color': '#f8fafc',
                'border-width': 2,
                'border-color': function(ele) { return SEV_BORDER[ele.data('severity') || 0] || '#cbd5e1'; },
                'label': 'data(label)', 'font-size': 10, 'font-family': 'sans-serif',
                'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 4,
                'color': '#334155', 'text-max-width': 90, 'text-wrap': 'ellipsis'
            }},
            { selector: 'edge', style: {
                'width': 1.5, 'line-color': '#cbd5e1',
                'target-arrow-color': '#94a3b8', 'target-arrow-shape': 'triangle',
                'arrow-scale': 0.7, 'curve-style': 'taxi',
                'taxi-direction': 'downward', 'taxi-turn': '50%'
            }},
            { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#3b82f6' }}
        ]
    });

    setTimeout(function() {
        if (cy && !cy.destroyed()) { cy.resize(); cy.fit(cy.nodes(), 40); }
    }, 100);

    cy.on('mouseover', 'node', function(e) { showTip(e, e.target.data()); });
    cy.on('mousemove', 'node', function(e) { moveTip(e); });
    cy.on('mouseout',  'node', function()  { hideTip(); });
    cy.on('tap', function(e) { if (e.target === cy) { hideCtx(); hideTip(); } });
    cy.on('cxttap', 'node', function(e) {
        const oe = e.originalEvent;
        if (oe) oe.preventDefault();
        hideTip();
        const pos = oe ? { x: oe.clientX, y: oe.clientY } : e.renderedPosition;
        showCtx(pos.x, pos.y, e.target.data());
    });

    window._ntCy = cy;
}
