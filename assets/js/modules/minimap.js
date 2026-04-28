// minimap.js — SVG-Übersichtskarte unten rechts.
//
// Zeigt alle sichtbaren Nodes als Severity-farbige Punkte plus ein Viewport-Rechteck.
// Klick auf die Minimap pannt Cytoscape zu der Position. Aktualisiert sich
// auf zoom/pan-Events (debounced 80ms) und alle 5 Sekunden im Hintergrund.
//
// State:
//   _el   — das DOM-Element (einmal angelegt, danach wiederverwendet)
//   _timer — Debounce-Timer für zoom/pan-Updates
// Beim renderManagement() wird die Minimap versteckt — dafür hideMinimap().

let _el = null;
let _timer = null;

const MM_W = 180, MM_H = 120, PAD = 8;
const SEV_COLORS = ['#22c55e', '#06b6d4', '#f59e0b', '#f97316', '#ef4444', '#991b1b'];

export function setupMinimap(cy, wrap) {
    if (!_el) {
        _el = document.createElement('div');
        _el.id = 'nt-minimap';
        _el.style.cssText = [
            'position:absolute;bottom:16px;right:16px',
            'width:' + MM_W + 'px;height:' + MM_H + 'px',
            'background:rgba(255,255,255,0.92)',
            'border:1px solid #e2e8f0',
            'border-radius:8px',
            'box-shadow:0 2px 8px rgba(0,0,0,0.12)',
            'overflow:hidden;cursor:pointer',
            'z-index:40',
            'backdrop-filter:blur(4px)'
        ].join(';');
        _el.title = 'Minimap \u2014 klicken zum Navigieren';
        wrap.appendChild(_el);
    }

    function drawMinimap() {
        if (!window._ntCy || !_el) return;

        // Sichtbare Nodes sammeln
        const visNodes = [];
        cy.nodes('[!isGroup]').forEach(function(n) {
            if (n.style('display') === 'none') return;
            const p = n.position();
            visNodes.push({ x: p.x, y: p.y, sev: n.data('severity') || 0 });
        });
        if (!visNodes.length) return;

        // Bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        visNodes.forEach(function(n) {
            if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
        });
        const rangeX = Math.max(maxX - minX, 1);
        const rangeY = Math.max(maxY - minY, 1);
        const scale  = Math.min((MM_W - PAD * 2) / rangeX, (MM_H - PAD * 2) / rangeY);

        function tx(x) { return PAD + (x - minX) * scale; }
        function ty(y) { return PAD + (y - minY) * scale; }

        // Viewport-Rechteck
        const ext = cy.extent();
        let vpX1 = isFinite(ext.x1) ? tx(ext.x1) : 0;
        let vpY1 = isFinite(ext.y1) ? ty(ext.y1) : 0;
        let vpX2 = isFinite(ext.x2) ? tx(ext.x2) : MM_W;
        let vpY2 = isFinite(ext.y2) ? ty(ext.y2) : MM_H;
        vpX1 = Math.max(0, Math.min(MM_W, vpX1));
        vpY1 = Math.max(0, Math.min(MM_H, vpY1));
        vpX2 = Math.max(vpX1 + 4, Math.min(MM_W, vpX2));
        vpY2 = Math.max(vpY1 + 4, Math.min(MM_H, vpY2));

        const dots = visNodes.map(function(n) {
            const col = SEV_COLORS[Math.min(n.sev, SEV_COLORS.length - 1)];
            return '<circle cx="' + tx(n.x).toFixed(1) + '" cy="' + ty(n.y).toFixed(1)
                 + '" r="3" fill="' + col + '" opacity="0.85"/>';
        }).join('');

        const vpRect = '<rect x="' + vpX1.toFixed(1) + '" y="' + vpY1.toFixed(1)
            + '" width="' + (vpX2 - vpX1).toFixed(1) + '" height="' + (vpY2 - vpY1).toFixed(1)
            + '" fill="rgba(59,130,246,0.08)" stroke="#3b82f6" stroke-width="1.5" rx="2"/>';

        const dark = document.getElementById('nt-root')
                  && document.getElementById('nt-root').classList.contains('nt-dark');
        _el.style.background = dark ? 'rgba(22,27,34,0.95)' : 'rgba(255,255,255,0.95)';
        _el.innerHTML = '<svg width="' + MM_W + '" height="' + MM_H + '" xmlns="http://www.w3.org/2000/svg">'
            + dots + vpRect + '</svg>';
    }

    // Klick → Pan zu dieser Position
    _el.addEventListener('click', function(e) {
        const rect = _el.getBoundingClientRect();
        const relX = e.clientX - rect.left;
        const relY = e.clientY - rect.top;

        const visNodes = [];
        cy.nodes('[!isGroup]').forEach(function(n) {
            if (n.style('display') !== 'none') visNodes.push(n.position());
        });
        if (!visNodes.length) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        visNodes.forEach(function(p) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        });
        const scale = Math.min(
            (MM_W - PAD * 2) / Math.max(maxX - minX, 1),
            (MM_H - PAD * 2) / Math.max(maxY - minY, 1)
        );

        const worldX = minX + (relX - PAD) / scale;
        const worldY = minY + (relY - PAD) / scale;
        cy.animate(
            { pan: { x: wrap.clientWidth / 2 - worldX * cy.zoom(), y: wrap.clientHeight / 2 - worldY * cy.zoom() } },
            { duration: 200 }
        );
    });

    cy.on('zoom pan', function() {
        clearTimeout(_timer);
        _timer = setTimeout(drawMinimap, 80);
    });

    setTimeout(drawMinimap, 1000);

    // Hintergrund-Refresh — Reference auf window damit Tab-Wechsel sie clearen kann
    if (window._ntMinimapTimer) clearInterval(window._ntMinimapTimer);
    window._ntMinimapTimer = setInterval(drawMinimap, 5000);
}

export function showMinimap() {
    if (_el) _el.style.display = '';
}

export function hideMinimap() {
    if (_el) _el.style.display = 'none';
}
