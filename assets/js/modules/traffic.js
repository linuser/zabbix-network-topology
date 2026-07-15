// traffic.js — Traffic-Heatmap auf Edges plus animierte "fließende Punkte".
//
// applyTrafficHeatmap() färbt und skaliert jede Edge nach Spitzen-Traffic:
//   0 b/s         → grau gestrichelt   (kein Traffic)
//   < 10 Kb/s     → grün
//   < 100 Kb/s    → cyan
//   < 1 Mb/s      → blau
//   < 10 Mb/s     → orange
//   ≥ 10 Mb/s     → rot dick
//
// startEdgeAnimation() markiert Edges zu Disaster-Hosts als "dead-edge" und
// startet eine setInterval-Schleife, die line-dash-offset auf allen lebenden
// Edges animiert — das erzeugt die wandernden Punkte in der Karte.

function trafficTier(bitsPerSec) {
    if (bitsPerSec <= 0)    return { w: 2,   col: '#94a3b8', tcol: '#94a3b8', dash: true  };
    if (bitsPerSec < 10e3)  return { w: 2,   col: '#22c55e', tcol: '#16a34a', dash: false };
    if (bitsPerSec < 100e3) return { w: 3,   col: '#06b6d4', tcol: '#0891b2', dash: false };
    if (bitsPerSec < 1e6)   return { w: 4.5, col: '#3b82f6', tcol: '#1d4ed8', dash: false };
    if (bitsPerSec < 10e6)  return { w: 6,   col: '#f97316', tcol: '#c2410c', dash: false };
    return                         { w: 8,   col: '#ef4444', tcol: '#b91c1c', dash: false };
}

// Schwellen fuer Interface-Health-Override. Errors/Discards sind nach
// Zabbix-Preprocessing 'change per second' — 1 Error/sec ist schon viel.
const HEALTH_ERR_THRESHOLD  = 1;
const HEALTH_DROP_THRESHOLD = 5;

// ── Weathermap-Modus ───────────────────────────────────────────────────────
// Klassische PHP-Weathermap-Skala: Farbe nach Auslastungs-% statt absolutem
// Traffic. 51 Mbps sind auf einem 1G-Link 5% (gruen), auf einem 100M-Link
// 51% (gelb) — genau die Info die absolute Faerbung verschluckt.
// Kapazitaet kommt als edge.data('capBps') aus min(ifSpeed beider Endpunkte).
let _weathermap = false;
export function setWeathermapMode(on) { _weathermap = !!on; }

function utilizationTier(pct) {
    if (pct < 1)   return { w: 2,   col: '#94a3b8' };   // idle
    if (pct < 10)  return { w: 3,   col: '#3b82f6' };   // blau
    if (pct < 25)  return { w: 4,   col: '#22c55e' };   // gruen
    if (pct < 40)  return { w: 4.5, col: '#a3e635' };   // lime
    if (pct < 55)  return { w: 5,   col: '#facc15' };   // gelb
    if (pct < 70)  return { w: 6,   col: '#f97316' };   // orange
    if (pct < 85)  return { w: 7,   col: '#ef4444' };   // rot
    return           { w: 8,   col: '#a21caf' };        // magenta (>85, Weathermap-Klassiker)
}

// Auslastung einer Edge in %. Bei der Node-Summen-Schaetzung ist Traffic die
// SUMME beider Endpunkte (siehe build-elements) → /2 fuer die Link-Schaetzung.
// Bei §3-Per-Link-Metrik (perLink) ist trafficIn/Out bereits der echte Port-
// Wert → NICHT teilen.
function edgeUtilizationPct(edge) {
    const cap = edge.data('capBps') || 0;
    if (cap <= 0) return null;
    const raw = Math.max(edge.data('trafficIn') || 0, edge.data('trafficOut') || 0);
    const t = edge.data('perLink') ? raw : raw / 2;
    return Math.min(999, (t / cap) * 100);
}

export function applyTrafficHeatmap(cy) {
    if (!cy) return;
    cy.edges().forEach(function(edge) {
        if (edge.hasClass('dead-edge')) return;
        const tIn  = edge.data('trafficIn')  || 0;
        const tOut = edge.data('trafficOut') || 0;
        const total = Math.max(tIn, tOut);   // Spitzenwert entscheidet
        let t = trafficTier(total);

        // Weathermap-Modus: Auslastungs-% statt absoluter Traffic — sofern
        // die Kapazitaet bekannt ist. Edges ohne Kapazitaet fallen auf die
        // absolute Skala zurueck. Zusaetzlich zeigt das Edge-Label die %.
        let wmPct = null;
        if (_weathermap) {
            wmPct = edgeUtilizationPct(edge);
            if (wmPct !== null) {
                const u = utilizationTier(wmPct);
                t = { w: u.w, col: u.col, tcol: u.col, dash: total <= 0 };
            }
        }

        // Interface-Health-Override: wenn einer der Endpunkte Down-Interfaces
        // oder hohe Error/Discard-Raten meldet, ueberschreiben wir das Traffic-
        // Styling mit einer Health-Warnung. Hierarchie:
        //   downRatio >= 0.5 → rot dashed (Mehrheit der Ports down = Incident;
        //                      Roh-Count wuerde bei Switches mit unbenutzten
        //                      Ports jede Edge einfaerben — Tooltip zeigt den
        //                      Count weiterhin)
        //   errors > T       → orange (CRC, framing etc.)
        //   discards > T     → orange dashed (queue full)
        const ifDownRatio = edge.data('ifaceDownRatio') || 0;
        const ifErr  = edge.data('ifaceErr')  || 0;
        const ifDrop = edge.data('ifaceDrop') || 0;

        let w = t.w, col = t.col, dashPat = t.dash ? [4, 8] : [6, 5], op = t.dash ? 0.75 : 0.9;
        if (ifDownRatio >= 0.5) {
            w = Math.max(w, 4); col = '#dc2626'; dashPat = [4, 4]; op = 0.95;
        } else if (ifErr > HEALTH_ERR_THRESHOLD) {
            w = Math.max(w, 4); col = '#f97316'; dashPat = [6, 5]; op = 0.9;
        } else if (ifDrop > HEALTH_DROP_THRESHOLD) {
            w = Math.max(w, 3); col = '#f59e0b'; dashPat = [3, 5]; op = 0.9;
        }

        edge.style('width',      w);
        edge.style('line-color', col);
        edge.style('color',      t.tcol);
        edge.style('line-style', 'dashed');
        edge.style('line-dash-pattern', dashPat);
        edge.style('opacity', op);

        // Label: im Weathermap-Modus die Auslastung inline, sonst zurueck
        // auf das Stylesheet-Mapping (data(tLabel) mit Traffic-Werten).
        if (_weathermap && wmPct !== null) {
            edge.style('label', wmPct < 1 ? '' : (wmPct.toFixed(0) + '%'));
        } else {
            edge.removeStyle('label');
        }
    });
}

export function startEdgeAnimation(cy, nodes) {
    // Edges zu disaster-severity-Hosts als dead markieren
    const deadIds = {};
    nodes.forEach(function(n) { if ((n.severity || 0) >= 5) deadIds[String(n.id)] = true; });
    cy.edges().forEach(function(e) {
        if (deadIds[e.source().id()] || deadIds[e.target().id()]) e.addClass('dead-edge');
        else e.removeClass('dead-edge');
    });

    // Lebende Edges animieren — "fließende Punkte" via line-dash-offset.
    // Defenses: cy.destroyed()-Check, document.hidden-Guard (kein Render
    // wenn Tab im Hintergrund), interval-Handle in window damit Tab-Wechsel
    // sie sauber clearen kann.
    if (window._ntEdgeAnim) clearInterval(window._ntEdgeAnim);
    let offset = 0;
    window._ntEdgeAnim = setInterval(function() {
        const c = window._ntCy;
        if (!c || (c.destroyed && c.destroyed())) {
            clearInterval(window._ntEdgeAnim);
            window._ntEdgeAnim = null;
            return;
        }
        if (document.hidden) return;   // CPU sparen wenn Tab unsichtbar
        offset = (offset + 1) % 22;
        c.edges().filter(function(e) { return !e.hasClass('dead-edge'); })
            .style('line-dash-offset', -offset);
    }, 50);
}
