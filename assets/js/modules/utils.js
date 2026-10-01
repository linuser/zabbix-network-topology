// utils.js — generische Helfer ohne Abhängigkeiten
//
// Was hier steht, wird überall gebraucht (Escaping, Bandbreiten-Format, ein
// DOM-Element bauen) und hat deshalb ein eigenes Modul ohne weitere Imports.
// Die Regel dafür ist einfach: kommt ein Helfer in einer zweiten Datei vor,
// gehört er hierher — sonst driften die Kopien auseinander, und genau das ist
// bei den Auslastungsstufen schon einmal passiert (siehe tooltip.js).

export function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function fmt(b) {
    b = +b || 0;
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' Gb/s';
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' Mb/s';
    if (b >= 1e3) return (b / 1e3).toFixed(1) + ' Kb/s';
    return b.toFixed(0) + ' b/s';
}

// isDark — is the module in dark mode? The class on #nt-root is the single
// source of truth (tabs.js sets it). Was copied as a two-liner in seven
// modules; new call sites use this.
export function isDark() {
    const root = document.getElementById('nt-root');
    return !!(root && root.classList.contains('nt-dark'));
}

// linkCapacity — Edge-Kapazitaet aus den Max-Link-Speeds beider Endpunkte:
// Engpass = min der beiden (>0), sonst der einzige bekannte Wert, sonst 0.
// Genutzt von build-elements (Weathermap) und render-stats (Forecast).
export function linkCapacity(spdA, spdB) {
    return (spdA > 0 && spdB > 0) ? Math.min(spdA, spdB) : (spdA || spdB || 0);
}

// buildBaseUrl — Zabbix-Basis-Pfad (alles vor "zabbix.php"). War 4× in
// den Tab-Modulen dupliziert.
export function buildBaseUrl() {
    return window.location.pathname.replace('zabbix.php', '');
}

// mkTabTheme — gemeinsame Farb-Palette der "einfachen" Tabs (Diag / Health /
// Compliance / LLDP-Q / Stats). War 4× dupliziert und driftete bereits
// (hover vs. accent je nach Modul). Superset beider Varianten.
// Die Tabelle (render-table.js) hat bewusst ihr eigenes, umfangreicheres
// Zabbix-Native-Theme — das bleibt getrennt.
// ── Auto-Refresh: der Takt richtet sich nach der Kartengroesse ────────────
//
// Dieselbe Schwelle wie der Perf-Modus, und aus demselben Grund. Nur war der
// Perf-Modus bisher allein damit: er macht das ZEICHNEN billiger, waehrend der
// Refresh stur alle 30 Sekunden weiterlief. Auf dem Lasttest heisst das, dass
// ein Abruf 4,4 Sekunden Serverzeit kostet und 1,2 MB bewegt — alle 30
// Sekunden, fuer EINEN Betrachter. Der Browser kommt dazwischen nicht zur
// Ruhe, und genau so fuehlt es sich an.
//
// Hier und nicht in render-tech, weil auch die Werkzeugleiste die Zahl
// nennen muss. Zwei Stellen, die dieselbe Schwelle getrennt fuehren, laufen
// auseinander — und dann behauptet die Aufschrift etwas anderes, als der
// Takt tut. Genau diesen Fehler hatte der Einklapp-Knopf.

export const REFRESH_GROSS_AB = 400;

export function refreshIntervallMs(knotenzahl) {
    return (knotenzahl || 0) >= REFRESH_GROSS_AB ? 120000 : 30000;
}

/** "30s" oder "2m" — was in der Aufschrift steht. */
export function refreshLabel(knotenzahl) {
    const ms = refreshIntervallMs(knotenzahl);
    return ms >= 60000 ? (ms / 60000) + 'm' : (ms / 1000) + 's';
}

// ── Host-Formular: zwei Zabbix-Versionen, zwei verschiedene URLs ─────────
//
// Es gibt KEINE Adresse, die auf beiden funktioniert. Nachgemessen an einer
// 7.0.31 und einer 7.4.12:
//
//                          action=host.edit        action=popup&popup=host.edit
//   Zabbix 7.0             vollstaendige Seite     Fatal error
//   Zabbix 7.4             JSON-Fragment           funktioniert
//
// Auf 7.0 kennt CControllerPopup ueberhaupt nur 'acknowledge.edit', und sein
// Pflichtfeld heisst 'popup_action' — ein Aufruf mit 'popup' endet dort auf
// der roten Seite "Fatal error, please report to the Zabbix team". Auf 7.4
// existiert host.edit zwar, antwortet aber als JSON: in einem neuen Tab
// stuende roher Text.
//
// Gemeldet beim Anlegen eines Hosts aus einem Geisterknoten. Das Modul sagt
// 7.0 LTS und 7.4 zu, und dieser Weg war auf 7.0 nie begehbar.
//
// Die Entscheidung faellt im Backend, wo die Version bekannt ist
// (NT_CONFIG.host_edit_popup); hier steht nur noch, was daraus folgt.

export function hostEditUrl(basis, params) {
    const cfg = (typeof window !== 'undefined' && window.NT_CONFIG) || {};
    // Ohne Angabe die Popup-Form: das ist der Stand, der auf den aktuellen
    // Versionen laeuft, und ein fehlendes Feld soll die neueren nicht
    // schlechter stellen.
    const alsPopup = cfg.host_edit_popup !== false;
    let url = basis + 'zabbix.php?action='
        + (alsPopup ? 'popup&popup=host.edit' : 'host.edit');
    Object.keys(params || {}).forEach(function(k) {
        const v = params[k];
        if (v === undefined || v === null || v === '') return;
        url += '&' + k + '=' + encodeURIComponent(v);
    });
    return url;
}

export function mkTabTheme(dark) {
    // ok/warn/crit gehoeren dazu, weil die Tabs sie ohnehin brauchen und sie
    // sich sonst als rohe Hex-Werte in die Module schleichen — in render-diag
    // standen sie schon, und das Rot #dc2626 ist auf dunklem Zabbix kaum zu
    // lesen. Die Werte sind dieselben wie --nt-ok-text/--nt-crit-text in
    // network-topology.css; eine CSS-Variable hilft hier nicht, weil diese
    // Tabs ihre Farben als JS-Zeichenketten in style-Attribute schreiben.
    return dark
        ? { bg:'#0d1117', surface:'#161b22', head:'#1c2128', hover:'#21262d',
            text:'#e6edf3', sub:'#8b949e', subSoft:'#6e7681',
            border:'#30363d', borderSoft:'#21262d', accent:'#0275b8',
            ok:'#4ade80', warn:'#fbbf24', crit:'#fca5a5' }
        : { bg:'#ffffff', surface:'#f8fafc', head:'#f1f5f9', hover:'#f1f5f9',
            text:'#1f2c33', sub:'#64748b', subSoft:'#94a3b8',
            border:'#dfe4e7', borderSoft:'#eef2f5', accent:'#0275b8',
            ok:'#166534', warn:'#92400e', crit:'#9c1a25' };
}

// aggregateValues — Sum/Avg/Min/Max/P50/P95/P99 ueber non-null numerische
// Werte. Strikte number-Filterung damit numeric-Strings ("12.5") im
// Sum-Modus keine String-Konkatenation ausloesen. Perzentile linear
// interpoliert. War 2× dupliziert (items-pivot + CSV-Export).
export function aggregateValues(values, mode) {
    const nums = values.filter(function(v) {
        return typeof v === 'number' && isFinite(v);
    });
    if (nums.length === 0) return null;
    if (mode === 'sum') return nums.reduce(function(a, b) { return a + b; }, 0);
    if (mode === 'max') return Math.max.apply(null, nums);
    if (mode === 'min') return Math.min.apply(null, nums);
    if (mode === 'p50' || mode === 'p95' || mode === 'p99') {
        const sorted = nums.slice().sort(function(a, b) { return a - b; });
        const pct = mode === 'p50' ? 0.5 : mode === 'p95' ? 0.95 : 0.99;
        const idx = pct * (sorted.length - 1);
        const lo = Math.floor(idx), hi = Math.ceil(idx);
        if (lo === hi) return sorted[lo];
        const w = idx - lo;
        return sorted[lo] * (1 - w) + sorted[hi] * w;
    }
    return nums.reduce(function(a, b) { return a + b; }, 0) / nums.length;
}

// fmtItemValue — formatiert einen Item-Wert mit seinen Zabbix-Units.
// Numerische Werte mit großen Zahlen werden abgekürzt (1234567 → 1.23M).
// Für Bytes-Units (B) wird in passende Größenordnungen umgerechnet.
// String-Werte werden 1:1 durchgereicht (max 32 Zeichen).
export function fmtItemValue(value, units) {
    if (value === null || value === undefined || value === '') return '\u2014';
    units = units || '';
    const num = Number(value);
    // Numerischer Wert?
    if (!isNaN(num) && isFinite(num) && /^[-+]?\d/.test(String(value).trim())) {
        // Bytes-spezifische Formatierung
        if (units === 'B' || units === 'Bps') {
            const abs = Math.abs(num);
            if (abs >= 1e12) return (num / 1e12).toFixed(2) + ' T' + units;
            if (abs >= 1e9)  return (num / 1e9).toFixed(2)  + ' G' + units;
            if (abs >= 1e6)  return (num / 1e6).toFixed(2)  + ' M' + units;
            if (abs >= 1e3)  return (num / 1e3).toFixed(1)  + ' K' + units;
            return num.toFixed(0) + ' ' + units;
        }
        // Sehr große oder sehr kleine Zahlen abkürzen
        const abs = Math.abs(num);
        let formatted;
        if (abs >= 1e9)      formatted = (num / 1e9).toFixed(2) + 'G';
        else if (abs >= 1e6) formatted = (num / 1e6).toFixed(2) + 'M';
        else if (abs >= 1e3) formatted = (num / 1e3).toFixed(1) + 'K';
        else if (abs > 0 && abs < 0.01) formatted = num.toExponential(2);
        else if (Number.isInteger(num)) formatted = String(num);
        else formatted = num.toFixed(2);
        return units ? (formatted + ' ' + units) : formatted;
    }
    // String-Wert — kürzen bei Bedarf
    const s = String(value);
    return s.length > 32 ? s.substring(0, 30) + '\u2026' : s;
}

// Ein Element mit Inline-CSS und Text bauen.
//
// Stand dreimal fast gleich im Code (edge-detail, path-list, color-scales-ui).
// Der Text geht IMMER über textContent — dieser Helfer ist einer der Gründe,
// warum die neuen Panels ohne innerHTML auskommen, obwohl dort Portnamen und
// Nachbarnamen von fremden Geräten landen.
export function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
}

/**
 * Ist die Zabbix-Seite dunkel? Gemessen, nicht geraten.
 *
 * WARUM NICHT AM THEME-NAMEN
 * --------------------------
 * Der Aufrufer reicht einen Hinweis herein, der auf dem DATEINAMEN des
 * eingebundenen Stylesheets beruht (detectZabbixDark in tabs.js, dort steht
 * auch, warum der Name allein nicht reicht). Die Seite selbst weiss es besser
 * als jede Namensliste — also fragen wir sie.
 *
 * MEHRERE ELEMENTE, NICHT NUR EINES. Die erste Fassung mass nur <main> und
 * gab bei durchsichtigem Hintergrund sofort den Hinweis zurueck. Genau das
 * ist bei Zabbix aber der Normalfall: die Grundfarbe liegt auf <body> oder
 * einem Wrapper, <main> erbt sie nur optisch und meldet selbst
 * "rgba(0,0,0,0)". Damit lief die Messung praktisch nie, und uebrig blieb die
 * Dateinamen-Heuristik, die sie ersetzen sollte.
 *
 * Jetzt wird die Kette von innen nach aussen abgeklopft und das erste
 * Element genommen, das wirklich eine Farbe traegt.
 *
 * @param {boolean} hinweis Voreinstellung, wenn sich nirgends etwas messen laesst.
 */
export function seiteIstDunkel(hinweis) {
    try {
        const kanal = function(c) {
            c = c / 255;
            return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };

        const kandidaten = [
            document.querySelector('main'),
            document.querySelector('.wrapper'),
            document.body,
            document.documentElement
        ];

        for (let i = 0; i < kandidaten.length; i++) {
            const el = kandidaten[i];
            if (!el) continue;
            const m = (window.getComputedStyle(el).backgroundColor || '').match(/rgba?\(([^)]+)\)/);
            if (!m) continue;
            const teile = m[1].split(',').map(function(v) { return parseFloat(v); });
            // Alpha 0 heisst: hier ist gar keine Farbe, nur Durchsicht —
            // weitersuchen statt aufgeben.
            if (teile.length > 3 && teile[3] === 0) continue;
            const L = 0.2126 * kanal(teile[0]) + 0.7152 * kanal(teile[1]) + 0.0722 * kanal(teile[2]);
            // 0.18 statt 0.5: die Grenze soll dunkle Themes treffen, nicht
            // bloss graue. Sie liegt bei etwa #777; Zabbix' dark-theme liegt
            // weit darunter, blue-theme weit darueber.
            return L < 0.18;
        }
        return !!hinweis;
    } catch (e) {
        // getComputedStyle kann in exotischen Kontexten werfen. Dann gilt
        // der Hinweis; ein Fehler hier darf die Karte nicht kosten.
        return !!hinweis;
    }
}

/**
 * Die Zeichenflaeche leeren, aber den Lade-Hinweis stehen lassen.
 *
 * Stand achtmal wortgleich in den Render-Modulen. Die Ausnahme fuer
 * #nt-loading ist der Grund, warum es kein schlichtes innerHTML = '' ist:
 * das Element gehoert der Seite, nicht dem Tab, und wer es mitloescht, hat
 * beim naechsten Laden keinen Hinweis mehr — sichtbar wird das erst auf einer
 * langsamen Instanz.
 */
export function clearWrap(wrap) {
    if (!wrap) return;
    Array.from(wrap.children).forEach(function(ch) {
        if (ch.id !== 'nt-loading') wrap.removeChild(ch);
    });
}
