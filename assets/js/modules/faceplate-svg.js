// faceplate-svg.js — zeichnet die Switch-Frontblende als SVG fuer das
// Detail-Panel der Karte. Eigenstaendige ES-Modul-Portierung der Zeichenlogik
// aus widget_faceplate/ (das ist ES5/jsLoader und laeuft nur auf Dashboards;
// die Kartenseite laedt nur dieses Haupt-Bundle). Gleiches Bild, gleiche
// Geometrie — nur ohne Widget-Rahmen und mit nativem <title>-Tooltip statt des
// schwebenden Panels.
//
// Datenquelle: Action `network.topology.faceplate` (ports, copper, sfp, host,
// layout, extra, truncated, poe_budget). Ein Port: { n, kind:'rj45'|'sfp', oper,
// admin, problem, poe, poe_class, speed, name, alias, in, out, errors, itemid,
// absent }.

// Severity-Farben (Zabbix-Default, Info..Disaster) — wie im Widget.
const SEV = ['#97aab3', '#7499ff', '#ffc859', '#ffa059', '#e97659', '#e45959'];

function palette(dark) {
    // warn/crit spiegeln --nt-warn-text / --nt-crit-text aus network-topology.css
    // (hell UND dunkel). Hier als fertige Hex, weil das Faceplate SVG zeichnet
    // und dort keine CSS-Variable aufloest — dieselbe Regel wie fuer icons.js.
    return dark
        ? { surface: '#161b22', border: '#30363d', sub: '#8b949e', text: '#e6edf3',
            up: '#22c55e', down: '#484f58', nodata: '#30363d', block: '#22d3ee', loop: '#fb923c',
            warn: '#fbbf24', crit: '#fca5a5' }
        : { surface: '#f8fafc', border: '#dfe4e7', sub: '#64748b', text: '#1f2c33',
            up: '#22c55e', down: '#6b7280', nodata: '#e5e7eb', block: '#0891b2', loop: '#ea580c',
            warn: '#92400e', crit: '#9c1a25' };
}

function sevColor(sev) { return SEV[sev] || SEV[0]; }

function fill(p, col) {
    if (p.absent) return 'none';
    if (!p.oper) return col.nodata;   // keine Daten
    if (p.oper !== 1) return col.down; // down
    return col.up;                     // up
}

function svg(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, String(attrs[k]));
    }
    return el;
}

// Kleine Sparkline der PoE-Auslastung fuer die Fusszeile. Reihe aelteste ->
// neueste; min/max der Reihe skalieren die Hoehe — gezeigt wird die FORM
// (steigt die Last?), der Absolutwert steht als Zahl daneben. Null bei zu
// wenig Punkten; der Aufrufer zeichnet dann einfach keine.
function poeSpark(values, color, w, h) {
    const n = values.length;
    if (n < 2) return null;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
        const v = Number(values[i]);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    if (!isFinite(lo) || !isFinite(hi)) return null;
    const span = (hi - lo) || 1;
    const pts = [];
    for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * (w - 2) + 1;
        const y = h - 1 - ((Number(values[i]) - lo) / span) * (h - 2);
        pts.push(x.toFixed(1) + ',' + y.toFixed(1));
    }
    const el = svg('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h,
        style: 'vertical-align:middle;margin-left:5px;overflow:visible' });
    el.appendChild(svg('polyline', { points: pts.join(' '), fill: 'none',
        stroke: color, 'stroke-width': '1', 'stroke-linejoin': 'round',
        'stroke-linecap': 'round' }));
    return el;
}

// Port n (1-basiert) -> [Spalte, Reihe]: ungerade oben (1/2 in Spalte 0, ...).
function cell(n) { return [Math.floor((n - 1) / 2), (n - 1) % 2]; }

function portShape(p, x, y, w, h, row, col) {
    const stroke = p.problem >= 0 ? sevColor(p.problem) : col.border;
    const sw = p.problem >= 0 ? 1.6 : 0.8;
    const attrs = { fill: fill(p, col), stroke, 'stroke-width': sw };
    if (p.admin === 2) attrs['stroke-dasharray'] = '2 1.5';
    if (p.kind === 'sfp') {
        Object.assign(attrs, { x, y, width: w, height: h, rx: 1 });
        return svg('rect', attrs);
    }
    // RJ45-Umriss: Rechteck mit Nase (40 % breit, 3 tief) an der Innenseite.
    const nw = w * 0.4, nx = x + (w - nw) / 2, nd = 3;
    attrs.d = row === 0
        ? 'M' + x + ' ' + y + 'h' + w + 'v' + (h - nd) + 'h' + (-(w - nw) / 2)
          + 'v' + nd + 'h' + (-nw) + 'v' + (-nd) + 'H' + x + 'z'
        : 'M' + x + ' ' + (y + nd) + 'H' + nx + 'v' + (-nd) + 'h' + nw + 'v' + nd
          + 'H' + (x + w) + 'v' + (h - nd) + 'H' + x + 'z';
    return svg('path', attrs);
}

function operText(o) { return ({ 1: 'up', 2: 'down', 3: 'testing', 5: 'dormant', 6: 'notPresent' })[o] || 'no data'; }

function fmtSpeed(bps) {
    const b = Number(bps) || 0;
    if (b >= 1e9) return (b / 1e9) + ' Gbit/s';
    if (b >= 1e6) return (b / 1e6) + ' Mbit/s';
    return b ? b + ' bit/s' : '';
}

function portTitle(p) {
    const lines = [];
    const label = p.alias || p.name || ('Port ' + p.n);
    lines.push(label + (p.name && p.alias ? ' (' + p.name + ')' : ''));
    let st = operText(p.oper) + (p.admin === 2 ? ' (disabled)' : '');
    if (p.oper === 1 && p.speed) st += ', ' + fmtSpeed(p.speed);
    lines.push(st);
    // PoE: Klasse (Rohwert RFC 3621: 1=class0 … 5=class4) plus Liefer-Zustand.
    // Ohne Klassen-Item nur der alte Delivering-Hinweis.
    if (p.poe_class >= 1 && p.poe_class <= 5) {
        // Liefer-Zustand nur behaupten, wenn er BEKANNT ist: poe===true liefert,
        // ===false liefert nicht, null/undefined = kein Detection-Item = unbekannt.
        // Ohne diese Trennung stand "not delivering" an einem Port, ueber dessen
        // Strom nichts bekannt ist — genau der Geister-/Quality-Verstoss, den
        // CLAUDE.md verbietet (nie behaupten, was man nicht weiss).
        let poeSuffix = '';
        if (p.poe === true) poeSuffix = ', delivering power';
        else if (p.poe === false) poeSuffix = ', not delivering';
        lines.push('PoE: Class ' + (p.poe_class - 1) + poeSuffix);
    }
    else if (p.poe === true) {
        lines.push('PoE: delivering power');
    }
    if (p.loop_partner) {
        lines.push('Self-loop: STP blocked this end — other end is port ' + p.loop_partner
            + ' (loop contained, remove the cable)');
    }
    else if (p.stp === 2) {
        lines.push('STP: blocking a redundant link (healthy)');
    }
    else if (p.loop_partner_of) {
        lines.push('Self-loop: forwarding end — blocked end is port ' + p.loop_partner_of);
    }
    if (p.problem >= 0) lines.push('open problem on this port');
    return lines.join('\n');
}

/**
 * Baut die Frontblende als <div> (SVG + Fusszeile). baseUrl fuer Klick ->
 * Item-Graph (wie im Widget); leer = kein Klick.
 * @returns {HTMLElement}
 */
export function buildFaceplateSvg(data, dark, baseUrl) {
    const col = palette(dark);
    const ports = data.ports || [];
    const copper = parseInt(data.copper || 0, 10) || 0;
    const sfp = parseInt(data.sfp || 0, 10) || 0;

    const PW = 20, PH = 16, GX = 3, GY = 4, BLOCK = 6, BGAP = 6;
    const SW = 24, SH = 14, SGAP = 14, LBL = 7, PAD = 6;

    const cols = Math.ceil(copper / 2);
    const blocks = Math.ceil(cols / BLOCK);
    let copperW = cols * PW + (cols - 1) * GX + (blocks - 1) * BGAP;
    if (cols === 0) copperW = 0;
    const sfpTwoRows = sfp > 2;
    const sfpCols = sfpTwoRows ? Math.ceil(sfp / 2) : sfp;
    const sfpW = sfp ? (sfpCols * SW + (sfpCols - 1) * GX) : 0;
    const fieldH = 2 * PH + GY;
    const W = PAD * 2 + copperW + (sfp && copper ? SGAP : 0) + sfpW;
    const H = PAD * 2 + LBL * 2 + fieldH;
    const top0 = PAD + LBL;

    const root = svg('svg', {
        viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet',
        width: '100%', role: 'img', 'aria-label': 'Switch front panel'
    });
    root.style.cssText = 'display:block;max-width:100%;';
    root.appendChild(svg('rect', {
        x: 0.5, y: 0.5, width: W - 1, height: H - 1, rx: 3,
        fill: col.surface, stroke: col.border, 'stroke-width': 1
    }));

    const byN = {};
    for (let j = 0; j < ports.length; j++) byN[ports[j].n] = ports[j];

    let up = 0, down = 0;
    const loopGeo = {};   // Front-Nr -> {cx,cy,top} der Selbst-Loop-Enden, fuer den Bogen
    for (let n = 1; n <= copper + sfp; n++) {
        const p = byN[n] || { n, kind: n <= copper ? 'rj45' : 'sfp', absent: true,
                              oper: 0, admin: 0, problem: -1, poe: null, itemid: '' };
        let x, y, w, h, row;
        if (p.kind === 'sfp') {
            const k = p.n - copper;
            let sc, sr;
            if (sfpTwoRows) { sc = Math.floor((k - 1) / 2); sr = (k - 1) % 2; }
            else { sc = k - 1; sr = -1; }
            x = PAD + copperW + (copper ? SGAP : 0) + sc * (SW + GX);
            y = sr < 0 ? top0 + (fieldH - SH) / 2 : top0 + sr * (PH + GY) + (PH - SH) / 2;
            w = SW; h = SH; row = sr < 0 ? 0 : sr;
        } else {
            const [c, r] = cell(p.n);
            x = PAD + c * (PW + GX) + Math.floor(c / BLOCK) * BGAP;
            y = top0 + r * (PH + GY);
            w = PW; h = PH; row = r;
        }
        if (p.oper === 1) up++; else if (p.oper) down++;

        const g = svg('g', { cursor: p.itemid && baseUrl ? 'pointer' : 'default' });
        if (p.absent) g.setAttribute('opacity', '0.45');
        g.appendChild(portShape(p, x, y, w, h, row, col));

        // Selbst-Loop-Ende: kraeftiger Rahmen um den ganzen Port. Ein zentraler
        // Marker allein ging im kleinen Ueberblick unter — der Rahmen macht die
        // beiden Loop-Ports auf einen Blick auffaellig. Geometrie fuer den
        // verbindenden Bogen merken.
        if (p.loop_partner || p.loop_partner_of) {
            loopGeo[p.n] = { cx: x + w / 2, cy: y + h / 2, top: y };
            g.appendChild(svg('rect', { x: x - 2, y: y - 2, width: w + 4, height: h + 4,
                rx: 3, fill: 'none', stroke: col.loop, 'stroke-width': 2.6 }));
        }

        if (p.poe === true) {
            const bx = x + w - 6, by = y + 2;
            g.appendChild(svg('path', {
                d: 'M' + (bx + 2.6) + ' ' + by + 'l-2.2 3.4h1.6l-1 2.6 2.6-3.6h-1.6z',
                fill: '#facc15', stroke: '#713f12', 'stroke-width': 0.3
            }));
        }

        // Marker auf dem Port. Drei Faelle, in dieser Reihenfolge:
        //   1) Selbst-Loop, GEBLOCKTES Ende -> orangenes Badge mit Slash. Orange
        //      = "hier haengt ein Kabel vom Switch auf sich selbst, bitte ziehen"
        //      (sichtbar, aber kein Alarm: STP hat den Loop abgefangen). An
        //      loop_partner gehaengt, NICHT an stp==2 — das per-Port-Item
        //      nt.if.stp[] kann noch nicht gepollt sein, waehrend der Walk den
        //      Loop schon kennt; sonst stuende ein gerahmter Port ohne Badge da.
        //   2) Normaler Redundanz-Block (stp==2, kein Selbst-Loop) -> NEUTRALES
        //      cyanes Badge: STP bremst einen Uplink zu einem ANDEREN Switch,
        //      gesundes Design, kein Handlungsbedarf.
        //   3) Selbst-Loop, WEITERLEITENDES Ende -> orangener Ring (Portfarbe im
        //      Zentrum). Ring als Loop-Metapher, klar vom Badge getrennt.
        // Dunkle Kante + weisser Slash heben die Scheibe auf gruenem wie grauem
        // Port ab.
        const cx = x + w / 2, cy = y + h / 2, rr = Math.min(w, h) * 0.3, hx = rr * 0.6;
        if (p.loop_partner) {
            g.appendChild(svg('circle', { cx: cx, cy: cy, r: rr + 0.6, fill: 'rgba(8,24,30,0.6)' }));
            g.appendChild(svg('circle', { cx: cx, cy: cy, r: rr, fill: col.loop }));
            g.appendChild(svg('line', { x1: cx - hx, y1: cy - hx, x2: cx + hx, y2: cy + hx,
                stroke: '#ffffff', 'stroke-width': 1.7, 'stroke-linecap': 'round' }));
        }
        else if (p.stp === 2) {
            g.appendChild(svg('circle', { cx: cx, cy: cy, r: rr + 0.6, fill: 'rgba(8,24,30,0.6)' }));
            g.appendChild(svg('circle', { cx: cx, cy: cy, r: rr, fill: col.block }));
            g.appendChild(svg('line', { x1: cx - hx, y1: cy - hx, x2: cx + hx, y2: cy + hx,
                stroke: '#ffffff', 'stroke-width': 1.7, 'stroke-linecap': 'round' }));
        }
        else if (p.loop_partner_of) {
            g.appendChild(svg('circle', { cx: cx, cy: cy, r: rr + 0.6, fill: 'rgba(8,24,30,0.6)' }));
            g.appendChild(svg('circle', { cx: cx, cy: cy, r: rr, fill: col.loop }));
            g.appendChild(svg('circle', { cx: cx, cy: cy, r: rr - 1.6, fill: fill(p, col) }));
        }

        const ly = (p.kind === 'sfp' && sfpTwoRows === false) ? y - 2
                 : (row === 0 ? y - 2 : y + h + LBL - 1.5);
        const t = svg('text', {
            x: x + w / 2, y: ly, 'text-anchor': 'middle',
            'font-size': 5.5, fill: col.sub, 'font-family': 'system-ui, sans-serif'
        });
        t.textContent = String(p.n);
        g.appendChild(t);

        if (!p.absent) {
            const title = svg('title', {});
            title.textContent = portTitle(p);
            g.appendChild(title);
            if (p.itemid && baseUrl) {
                g.addEventListener('click', function () {
                    window.open(baseUrl + 'history.php?action=showgraph&itemids%5B%5D='
                        + encodeURIComponent(p.itemid), '_blank', 'noopener');
                });
            }
        }
        root.appendChild(g);
    }

    // Loop-Leitung: ein gestrichelter Bogen verbindet die beiden Enden eines
    // Selbst-Loops — erst damit liest man "diese zwei Ports sind EIN Loop".
    // Hinter die Ports gelegt (direkt ueber den Hintergrund): nur der Scheitel
    // schaut oben heraus, die Enden stecken scheinbar in den Buchsen.
    const arcs = svg('g', {});
    for (let j = 0; j < ports.length; j++) {
        const p = ports[j];
        if (!p.loop_partner) continue;           // einmal je Paar, vom geblockten Ende
        const a = loopGeo[p.n], b = loopGeo[p.loop_partner];
        if (!a || !b) continue;
        // Nach oben begrenzen: ohne Portnummern ist kaum Rand ueber den Ports,
        // sonst raegte Bogen + Glyph ueber den SVG-Rand und wuerde abgeschnitten.
        const peak = Math.max(4, Math.min(a.top, b.top) - 9);
        arcs.appendChild(svg('path', {
            d: 'M' + a.cx + ' ' + a.cy + ' C' + a.cx + ' ' + peak + ', '
                + b.cx + ' ' + peak + ', ' + b.cx + ' ' + b.cy,
            fill: 'none', stroke: col.loop, 'stroke-width': 2.4,
            'stroke-dasharray': '4 3', 'stroke-linecap': 'round'
        }));
        // Warn-Glyph am Bogenscheitel: orangener Punkt mit weissem "!".
        const mx = (a.cx + b.cx) / 2, my = peak + 1.5;
        arcs.appendChild(svg('circle', { cx: mx, cy: my, r: 4.6, fill: 'rgba(8,24,30,0.6)' }));
        arcs.appendChild(svg('circle', { cx: mx, cy: my, r: 4, fill: col.loop }));
        const bang = svg('text', { x: mx, y: my + 2.4, 'text-anchor': 'middle',
            'font-size': 6.5, 'font-weight': '700', fill: '#ffffff',
            'font-family': 'system-ui, sans-serif' });
        bang.textContent = '!';
        arcs.appendChild(bang);
    }
    if (arcs.childNodes.length) {
        root.insertBefore(arcs, root.childNodes[1] || null);
    }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
    wrap.appendChild(root);

    const notes = [String(data.host || ''), String(data.layout || ''), up + ' up', down + ' down'];
    if (data.extra) notes.push(data.extra + ' more ports do not fit');
    const foot = document.createElement('div');
    foot.style.cssText = 'font-size:10px;color:' + col.sub
        + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    foot.textContent = notes.filter(function (s) { return s !== ''; }).join(' · ');
    // Switch-PoE-Budget (nur wenn das Geraet pethMainPse* liefert; poe_budget ist
    // sonst null). SEPARAT eingefaerbt statt in der grauen Notizzeile: ab 80 %
    // Auslastung amber, ab 95 % rot + Warnglyph. Vorher stand "78 / 95 W" in
    // derselben gedaempften Farbe wie alles andere — 82 % Last sahen aus wie 5 %,
    // und dass der Switch fast an seinem Leistungslimit haengt, war unsichtbar.
    if (data.poe_budget) {
        const used = data.poe_budget.used || 0;
        const nominal = data.poe_budget.nominal || 0;
        const pct = nominal > 0 ? Math.round(used / nominal * 100) : 0;
        const hot = nominal > 0 && pct >= 95;
        const warm = nominal > 0 && pct >= 80;
        if (foot.textContent) foot.appendChild(document.createTextNode(' · '));
        const poe = document.createElement('span');
        poe.style.color = hot ? col.crit : (warm ? col.warn : col.sub);
        if (warm) poe.style.fontWeight = '600';
        poe.textContent = 'PoE: ' + used + ' / ' + nominal + ' W'
            + (nominal > 0 ? ' (' + pct + '%)' : '')
            + (warm ? ' ⚠' : '');
        foot.appendChild(poe);
        // Verlauf der Auslastung als Sparkline, wenn die Action History lieferte
        // (poe_history, aelteste -> neueste). In derselben Schwellwert-Farbe wie
        // die Zahl, damit "steigt" und "ist schon hoch" denselben Ton tragen.
        const hist = data.poe_history;
        if (hist && hist.length >= 2) {
            const sp = poeSpark(hist, poe.style.color || col.sub, 44, 12);
            if (sp) foot.appendChild(sp);
        }
    }
    wrap.appendChild(foot);
    return wrap;
}
