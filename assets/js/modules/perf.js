// perf.js — schmale, abschaltbare Render-Zeitmessung fuer die Fehlersuche.
//
// Warum: "die Karte laedt 10s" ist ohne Zahlen nicht zu beheben. Diese Marken
// legen eine Zeitachse ueber die Render-Phasen (Elemente bauen, Cytoscape-Init,
// Layout, Overlays), sodass in der DevTools-Konsole genau abzulesen ist, welche
// Phase die Zeit frisst. Standardmaessig STUMM — nur aktiv, wenn der Benutzer es
// einschaltet, damit keine Konsolen-Ausgabe im normalen Betrieb entsteht.
//
// Einschalten (eins davon):
//   - in der Konsole:  localStorage.setItem('nt_perf','1')  und neu laden
//   - URL anhaengen:   &ntperf=1
//   - in der Konsole:  window.NT_PERF = true   (nur bis zum naechsten Reload)
// Ausschalten:  localStorage.removeItem('nt_perf')

let _t0 = 0;

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

export function perfOn() {
    try {
        if (typeof window !== 'undefined' && window.NT_PERF === true) return true;
        if (typeof localStorage !== 'undefined' && localStorage.getItem('nt_perf') === '1') return true;
        if (typeof window !== 'undefined' && window.location && window.location.search
                && window.location.search.indexOf('ntperf') !== -1) return true;
    } catch (e) { /* localStorage kann in manchen Kontexten werfen */ }
    return false;
}

// Zeitachse starten (setzt den Nullpunkt) und den Start loggen.
export function perfBegin(label) {
    if (!perfOn()) return;
    _t0 = _now();
    try { console.log('[NT-PERF] ▶ ' + label); } catch (e) { /* noop */ }
}

// Zwischenmarke: Millisekunden seit perfBegin.
export function perfMark(label) {
    if (!perfOn()) return;
    const ms = Math.round((_now() - _t0) * 10) / 10;
    try { console.log('[NT-PERF]   ' + label + ' @ +' + ms + ' ms'); } catch (e) { /* noop */ }
}
