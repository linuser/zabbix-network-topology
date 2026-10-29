// link-quality.js — Güte-Wert je Kante (0–100) aus Errors, Drops, Auslastung,
// Down-Zustand und einem Flap-Proxy. Ein hoher Wert = gesunder Link, nicht nur
// ein leerer. Gegenstueck zur Weathermap, die nur die Auslastung faerbt.
//
// VORBILD + PARITY-PFLICHT
// ------------------------
// Dieselbe Idee wie der Host-Health-Score (render-health.js): gewichtete Abzuege
// von 100, Farbbaender 85/65/40. Der Health-Score liegt DOPPELT (Modul +
// widget_health) und wird von ci:parity bewacht. DIESER Score liegt bewusst nur
// HIER, an EINER Stelle — es gibt (noch) keine Widget-Kopie. **Sobald eine
// Widget-Kopie entsteht, MUSS ci:parity um einen §1b-Block erweitert werden**
// (Gewichte + Schwellen gegenschneiden, wie in tools/check-parity.mjs §1).
//
// FLAPS = PROXY, kein Zaehler
// ---------------------------
// Einen Flap-Zaehler je Interface erhebt das Modul nicht. Stattdessen der
// ehrliche Proxy: die Kante traegt die Link-UPTIME je Ende (Sekunden seit dem
// letzten ifLastChange). Ist das juengere Ende erst kurz oben, ist der Link
// kuerzlich gebounced → abklingender Abzug. Kein neuer Datenbedarf.

import { utilizationPct } from './traffic.js';

// Baender wie beim Host-Health-Score — bewusst dieselben Grenzen UND Farben,
// damit "85 = gut" ueberall dasselbe heisst.
const COL_OK   = '#16a34a';   // >= 85
const COL_WARN = '#f59e0b';   // >= 65
const COL_BAD  = '#f97316';   // >= 40
const COL_CRIT = '#dc2626';   // < 40

// Abzugs-Gewichte (Startwerte, justierbar). Real treffen selten alle zu; die
// Summe wird ohnehin auf 0..100 geclamped.
const W_DOWN = 65;   // Port down = schwerster Einzelabzug (allein schon Crit)
const W_ERR  = 25;   // voll ab ERR_FULL Errors/s
const W_DROP = 20;   // voll ab DROP_FULL Discards/s
const W_UTIL = 15;   // ab UTIL_KNEE %, voll bei 100 %
const W_FLAP = 20;   // Uptime-Proxy, voll bei frischem Reconnect

const ERR_FULL    = 1;      // 1 Error/s ist nach Zabbix-change-per-second schon viel
const DROP_FULL   = 5;      // 5 Discards/s
const UTIL_KNEE   = 80;     // Auslastung erst ab hier strafen
const FLAP_WINDOW = 3600;   // Sekunden: darunter gilt der Link als kuerzlich geflappt

// Baender als DATEN (nicht nur als if-Kaskade), damit die Legende (legend.js)
// dieselben Grenzen + Farben zeigt wie der Score — derselbe Grund wie bei den
// Traffic-/Util-Stufen in traffic.js. min = untere (inklusive) Grenze, absteigend.
export const LINK_QUALITY_BANDS = [
    { min: 85, col: COL_OK,   key: 'ok'   },
    { min: 65, col: COL_WARN, key: 'warn' },
    { min: 40, col: COL_BAD,  key: 'bad'  },
    { min: 0,  col: COL_CRIT, key: 'crit' }
];

function scoreColor(s) {
    for (let i = 0; i < LINK_QUALITY_BANDS.length; i++) {
        if (s >= LINK_QUALITY_BANDS[i].min) return LINK_QUALITY_BANDS[i].col;
    }
    return COL_CRIT;
}

// Hat die Kante gemessene Link-Daten? Ghost-/synthetische Kanten und solche
// ohne jede Kapazitaet/Portmetrik bekommen KEINEN Score (null statt 100 —
// "unbekannt" ist nicht "perfekt", dieselbe Linie wie quality.js/ci:quality).
function hasMeasuredData(d) {
    if (!d) return false;
    if (d._isGhostEdge || d._isInternetEdge || d._isBundleEdge) return false;
    return !!(d.capBps || d.portErr != null || d.portDrop != null
        || d.portDown != null || d.portSrcUptime || d.portTgtUptime);
}

// Linearer, bei 'weight' gedeckelter Abzug: Bruchteil der vollen Last (frac,
// 0..1+) mal Gewicht, nie mehr als das Gewicht. Viermal stand dieselbe
// Rechnung Math.min(W, frac*W) buchstabiert da — Errors, Drops, Auslastung,
// Flap. Einmal benannt haelt die vier Baender zwangslaeufig gleichfoermig.
function ramp(weight, frac) {
    return Math.min(weight, frac * weight);
}

/**
 * Güte-Wert einer Kante aus ihrem DATENOBJEKT (nicht dem Cytoscape-Element) —
 * dieselbe Konvention wie utilizationPct(): die Aufrufer (Heatmap, Panel, Test)
 * haben die Daten, nicht immer das Element.
 *
 * @return {{score:number, color:string, parts:Array<{key:string,pen:number,val?:number}>}|null}
 */
export function linkQualityScore(d) {
    if (!hasMeasuredData(d)) return null;

    const parts = [];
    let penalty = 0;

    if (d.portDown === true) {
        penalty += W_DOWN;
        parts.push({ key: 'down', pen: W_DOWN });
    }

    const err = Math.max(0, d.portErr || 0);
    if (err > 0) {
        const p = ramp(W_ERR, err / ERR_FULL);
        penalty += p; parts.push({ key: 'errors', pen: p, val: err });
    }

    const drop = Math.max(0, d.portDrop || 0);
    if (drop > 0) {
        const p = ramp(W_DROP, drop / DROP_FULL);
        penalty += p; parts.push({ key: 'drops', pen: p, val: drop });
    }

    const util = utilizationPct(d);
    if (util != null && util > UTIL_KNEE) {
        const p = ramp(W_UTIL, (util - UTIL_KNEE) / (100 - UTIL_KNEE));
        penalty += p; parts.push({ key: 'util', pen: p, val: util });
    }

    // Flap-Proxy: das JUENGERE Ende (min Uptime > 0) entscheidet. 0/fehlend =
    // unbekannt → kein Abzug (nicht als "stabil" werten).
    const up = [d.portSrcUptime, d.portTgtUptime].filter(function(u) { return u > 0; });
    if (up.length) {
        const minUp = Math.min.apply(null, up);
        if (minUp < FLAP_WINDOW) {
            const p = ramp(W_FLAP, 1 - minUp / FLAP_WINDOW);
            penalty += p; parts.push({ key: 'flap', pen: p, val: minUp });
        }
    }

    const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
    parts.sort(function(a, b) { return b.pen - a.pen; });   // groesster Abzug zuerst
    return { score: score, color: scoreColor(score), parts: parts };
}
