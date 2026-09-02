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
// startEdgeAnimation() markiert Edges zu Disaster-Hosts als "dead-edge",
// laesst diese Hosts pulsieren und
// startet eine setInterval-Schleife, die line-dash-offset auf allen lebenden
// Edges animiert — das erzeugt die wandernden Punkte in der Karte.

// Both scales exist as data (not just as an if-cascade) so the legend
// (legend.js) and the tooltip (tooltip.js) show the same thresholds and colors
// as the edges. Three copies used to drift apart: the legend gradient had
// different colors than the edges, and the tooltip turned the percentage
// orange at 40% while the edge only did so at 55%.
// max = exclusive upper bound of the tier; the last tier has max: Infinity.
//
// Since 5.2 a Super admin can override both scales (View menu →
// "Color scales…", stored in module.config, action network.topology.scales).
// Scale format: { bounds: [ascending exclusive upper bounds],
// colors: [bounds.length + 1 colors] } — the last color applies above the
// last bound. The tier arrays below are built from it; line width grows
// linearly across the tiers from 2 to 8 px, the label color is the line
// color slightly darkened.
export const DEFAULT_SCALES = {
    traffic: { bounds: [10e3, 100e3, 1e6, 10e6],
               colors: ['#22c55e', '#06b6d4', '#3b82f6', '#f97316', '#ef4444'] },
    util:    { bounds: [1, 10, 25, 40, 55, 70, 85],
               colors: ['#94a3b8', '#3b82f6', '#22c55e', '#a3e635', '#facc15', '#f97316', '#ef4444', '#a21caf'] },
};
export const MAX_SCALE_COLORS = 12;

// Filled in place (applyColorScales) so imports in legend.js and friends
// always see the current state.
export const TRAFFIC_TIERS = [];
export const UTIL_TIERS    = [];
export const IDLE_TIER = { w: 2, col: '#94a3b8', tcol: '#94a3b8' };

function darken(hex, f) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return hex;
    return '#' + [1, 2, 3].map(function(i) {
        return ('0' + Math.round(parseInt(m[i], 16) * (1 - f)).toString(16)).slice(-2);
    }).join('');
}

function buildTiers(target, scale) {
    target.length = 0;
    const n = scale.colors.length;
    scale.colors.forEach(function(col, i) {
        const w = n > 1 ? 2 + 6 * i / (n - 1) : 4;
        target.push({
            max:  i < scale.bounds.length ? scale.bounds[i] : Infinity,
            w:    Math.round(w * 2) / 2,
            col:  col,
            tcol: darken(col, 0.25),
        });
    });
}

// Validates a scales configuration (client draft or NT_CONFIG) and returns a
// cleaned copy — or null. Mirror of ColorScales::sanitize() in the backend;
// both must accept the same input.
export function normalizeScales(cfg) {
    if (!cfg || typeof cfg !== 'object') return null;
    const out = {};
    const limits = { traffic: Infinity, util: 1000 };
    for (const key in limits) {
        const s = cfg[key];
        if (!s || !Array.isArray(s.bounds) || !Array.isArray(s.colors)) return null;
        const n = s.colors.length;
        if (n < 2 || n > MAX_SCALE_COLORS || s.bounds.length !== n - 1) return null;
        const bounds = [], colors = [];
        let prev = 0;
        for (let i = 0; i < s.bounds.length; i++) {
            const v = Number(s.bounds[i]);
            if (!isFinite(v) || v <= prev || v > limits[key]) return null;
            bounds.push(v); prev = v;
        }
        for (let i = 0; i < n; i++) {
            const c = String(s.colors[i] || '');
            if (!/^#[0-9a-fA-F]{6}$/.test(c)) return null;
            colors.push(c.toLowerCase());
        }
        out[key] = { bounds: bounds, colors: colors };
    }
    return out;
}

let _scales = null;     // active scales (cleaned)
let _custom = false;    // true = overridden by an admin, false = defaults

// Activate scales. null/invalid → defaults. Rebuilds the tier arrays; the
// caller must follow up with applyTrafficHeatmap() so the edges follow.
export function applyColorScales(cfg) {
    const norm = normalizeScales(cfg);
    _custom = norm !== null;
    _scales = norm || normalizeScales(DEFAULT_SCALES);
    buildTiers(TRAFFIC_TIERS, _scales.traffic);
    buildTiers(UTIL_TIERS,    _scales.util);
}
export function getColorScales() { return JSON.parse(JSON.stringify(_scales)); }
export function hasCustomScales() { return _custom; }
applyColorScales(null);

function trafficTier(bitsPerSec) {
    if (bitsPerSec <= 0) return { w: IDLE_TIER.w, col: IDLE_TIER.col, tcol: IDLE_TIER.tcol, dash: true };
    const tier = TRAFFIC_TIERS.find(function(x) { return bitsPerSec < x.max; });
    return { w: tier.w, col: tier.col, tcol: tier.tcol, dash: false };
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
export function isWeathermapMode() { return _weathermap; }

function utilizationTier(pct) {
    return UTIL_TIERS.find(function(x) { return pct < x.max; });
}

// Color for a utilization % — for the tooltip, so the number there is tinted
// in the same tier as the edge next to it.
export function utilizationColor(pct) {
    return utilizationTier(pct).col;
}

// Utilization label: one decimal below 10% ("0.2%"), integer otherwise. Below
// 1% an empty label used to be set — but Cytoscape treats an empty bypass as
// "remove the bypass", so the traffic label from the stylesheet came back and
// the edge looked as if weathermap mode were off.
export function formatUtilization(pct) {
    return (pct < 10 ? pct.toFixed(1) : pct.toFixed(0)) + '%';
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
        // §9 Ghost-Kanten haben keine gemessenen Daten — die Heatmap wuerde ihre
        // Inline-Styles ueber den (bewusst dezenten) Ghost-Style aus dem
        // Stylesheet legen. Also auslassen.
        if (edge.data('_isGhostEdge')) return;
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
        if (_weathermap && wmPct !== null && total > 0) {
            edge.style('label', formatUtilization(wmPct));
        } else {
            edge.removeStyle('label');
        }
    });
}

/**
 * Disaster-Zustand auf Knoten und Kanten anwenden — und zurueckgeben, wer
 * betroffen ist.
 *
 * ALS EIGENE FUNKTION, NICHT ALS CLOSURE IN DER ANIMATIONSSCHLEIFE.
 * Genau hier sass der Fehler, und in einer setInterval-Closure ist er nicht
 * pruefbar: Chrome drosselt Timer in Hintergrund-Tabs auf einmal pro Minute,
 * eine laufende Animation laesst sich dort also gar nicht beobachten. So ist
 * die Logik ein direkter Aufruf und damit nachmessbar — die Animation bleibt
 * das Duenne obendrauf.
 *
 * @returns Cytoscape-Collection der Disaster-Knoten
 */
export function markDisasterState(c) {
    const tote = c.nodes('[!isGroup]').filter(function(n) {
        return (n.data('severity') || 0) >= 5;
    });
    const ids = {};
    tote.forEach(function(n) { ids[n.id()] = true; });
    c.edges().forEach(function(e) {
        if (ids[e.source().id()] || ids[e.target().id()]) e.addClass('dead-edge');
        else e.removeClass('dead-edge');
    });
    // Wer nicht mehr Disaster ist, verliert seine Glorie — sonst bleibt sie
    // stehen, wenn sich ein Problem aufloest.
    c.nodes('[!isGroup]').not(tote).style('underlay-opacity', 0);
    return tote;
}

export function startEdgeAnimation(cy) {
    // Disaster-Zustand NEU BEWERTEN, nicht einmalig festhalten.
    //
    // Vorher wurde die Liste der Disaster-Hosts genau einmal bestimmt — beim
    // Render — und der Auto-Refresh ruft diese Funktion nicht erneut auf. Er
    // schreibt nur node.data('severity'). Damit war die dead-edge-Markierung
    // zwischen zwei Renders veraltet: eine Kante zu einem gerade ausgefallenen
    // Host animierte munter weiter, und eine zu einem genesenen blieb tot. Das
    // ist so lange drin, wie es den Refresh gibt, und niemandem aufgefallen —
    // weil ein Refresh selten mit einem Ausfall zusammenfaellt und der naechste
    // Render es wieder geradezieht.
    //
    // Jetzt einmal pro Sekunde neu bewertet (jeder 20. Tick), nicht bei jedem
    // Tick: die Bewertung laeuft ueber alle Knoten, 50 ms waeren dafuer zu oft.
    // Eine Sekunde Verzug bei einem Ausfall merkt niemand.
    const bewerte = markDisasterState;

    let deadNodes = bewerte(cy);

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
        if (offset % 20 === 0) deadNodes = bewerte(c);

        c.edges().filter(function(e) { return !e.hasClass('dead-edge'); })
            .style('line-dash-offset', -offset);

        // Disaster-Knoten pulsieren lassen.
        //
        // Die Projektseite verspricht "faerbt den Ring rot und pulst" — rot
        // stimmte, gepulst hat nie etwas: kein pulse, kein blink, keine
        // Keyframes ausser dem Lade-Spinner. Eine Zusage auf der Startseite,
        // die der Code nicht einloest, ist derselbe Fehler wie eine Legende,
        // die die falsche Skala erklaert.
        //
        // Warum underlay und nicht CSS: Cytoscape zeichnet Knoten auf ein
        // Canvas, CSS-Animationen greifen dort nicht. underlay ist die
        // vorgesehene Glorie hinter dem Knoten und wird im Modul bereits
        // benutzt (Klick-Blitz in render-tech.js). Auf einem pulsierenden
        // Knoten ueberschreibt der Puls den Blitz — hinnehmbar, der Puls sagt
        // mehr.
        if (deadNodes.length) {
            const t = (Math.sin(offset / 22 * Math.PI * 2) + 1) / 2;   // 0..1
            deadNodes.style('underlay-color', '#dc2626');
            deadNodes.style('underlay-padding', 5 + t * 7);
            deadNodes.style('underlay-opacity', 0.18 + t * 0.32);
        }
    }, 50);
}

