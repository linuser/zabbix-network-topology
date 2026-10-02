// severity.js — Severity-Farben/Labels und Gruppen-Farb-Pool.
//
// SEV_COL: Farben für Severity 0-5 (Normal/Info/Warning/Average/High/Disaster)
// SEV_LBL: Klartext-Labels in derselben Reihenfolge
// grpColor(name): liefert deterministisch dieselbe Farbe pro Gruppen-Namen,
//   nimmt zyklisch aus GRP_COLORS, mappt einmal pro Lebenszeit der Page.

export const SEV_COL = ['#22c55e', '#06b6d4', '#f59e0b', '#f97316', '#ef4444', '#991b1b'];
export const SEV_LBL = ['Normal', 'Info', 'Warning', 'Average', 'High', 'Disaster'];

// ── EIN GEIST IST KEIN HOST ──────────────────────────────────────────────
//
// Ein Geisterknoten — ein LLDP/CDP-Nachbar ohne eigenen Zabbix-Host — traegt
// severity 0. Nicht, weil alles in Ordnung ist, sondern weil ueber ihn NICHTS
// BEKANNT ist. Wer SEV_LBL[0] darauf anwendet, schreibt "Normal" an ein
// Geraet, ueber das niemand etwas weiss.
//
// DAS IST KEINE THEORIE. Es wurde einmal aus dem Feld gemeldet (gruene Pille
// "Normal" am Geisterknoten) und entstand beim Bau der Tabellenansicht in
// 5.5.0 an FUENF weiteren Stellen neu: Statuspille der Zeile, Zeilenzaehler,
// CSV-Export, Filterpille und der Link am Namen. Drei davon fielen erst in
// der Durchsicht auf, eine erst durch eine Rueckfrage.
//
// Der Grund war strukturell: die Entscheidung wurde an jeder Stelle neu
// getroffen, und es gab keinen Ort, an dem einmal steht, dass sie falsch ist.
// Dieser Ort ist hier. `npm run ci:ghost` erzwingt es — SEV_LBL mit einer
// Severity aus einem Knoten zu indizieren faellt dort auf.

/** Ist dieser Knoten ein Nachbar ohne eigenen Zabbix-Host? */
export function istGeist(d) {
    return !!(d && d._isGhost);
}

/**
 * Was als STATUS dieses Knotens dasteht — ueberall dieselbe Antwort.
 *
 * Erwartet die Knoten-DATEN (bei Cytoscape also ele.data(), nicht das
 * Element). Ein Geist bekommt seine eigene Aussage, alles andere die
 * Severity-Bezeichnung.
 *
 * Die Zeichenkette fuer den Geist kommt von aussen (`geistText`), damit
 * dieses Modul nicht von i18n abhaengt: severity.js wird auch dort
 * importiert, wo es kein t() gibt. Ohne Angabe die englische Vorgabe.
 */
export function statusLabel(d, geistText) {
    if (istGeist(d)) {
        return geistText || 'NOT MONITORED';
    }
    return SEV_LBL[klemme(d && d.severity)];
}

/**
 * Severity auf 0..5 begrenzen.
 *
 * Das Math.min stand vorher an drei Stellen einzeln (build-elements, icons,
 * render-tech) und fehlte an zwei anderen. Es GEHOERT dazu: ein Wert ueber 5
 * traefe sonst ins Leere, und ein `|| SEV_COL[0]` dahinter machte daraus
 * ausgerechnet Gruen — aus "schlimmer als Disaster" wuerde "Normal". Nach
 * unten gilt dasselbe fuer einen negativen Wert.
 */
function klemme(sev) {
    const n = Math.floor(Number(sev)) || 0;
    if (n < 0) {
        return 0;
    }
    return n > SEV_LBL.length - 1 ? SEV_LBL.length - 1 : n;
}

/** Farbe zum Status. Ein Geist wird gedaempft, nicht gruen. */
export function statusColor(d) {
    if (istGeist(d)) {
        return '#94a3b8';
    }
    return SEV_COL[klemme(d && d.severity)];
}

const GRP_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
                    '#f97316', '#ec4899', '#14b8a6', '#84cc16', '#6366f1', '#e11d48'];

const _gcMap = {};
let _gcIdx = 0;

export function grpColor(name) {
    if (!name) return '#94a3b8';
    if (!_gcMap[name]) {
        _gcMap[name] = GRP_COLORS[_gcIdx++ % GRP_COLORS.length];
    }
    return _gcMap[name];
}

// primaryGroup ist eng mit Gruppen verknüpft, daher hier:
// liefert die "primäre" Gruppe eines Hosts. Bevorzugt Gruppen aus der aktuellen
// Auswahl (sel) — und zwar in der REIHENFOLGE der Auswahl, nicht in der
// Reihenfolge von n.groups.
//
// Beispiel: User wählt [Fox, Hugo]. Host hat n.groups=[Hugo, Fox] (alphabetisch
// vom Backend). Mit Iteration über n.groups würde Hugo gewinnen — falsch.
// Wir iterieren über sel, dann gewinnt Fox (die zuerst gewählte Gruppe), was
// dem User-Intent entspricht: "in welche Spalte gehört der Host?"
export function primaryGroup(n, sel) {
    if (!n.groups || !n.groups.length) return null;
    if (sel && sel.length) {
        for (let i = 0; i < sel.length; i++) {
            if (n.groups.indexOf(sel[i]) >= 0) return sel[i];
        }
    }
    return n.groups[0];
}
