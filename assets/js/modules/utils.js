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
export function mkTabTheme(dark) {
    return dark
        ? { bg:'#0d1117', surface:'#161b22', head:'#1c2128', hover:'#21262d',
            text:'#e6edf3', sub:'#8b949e', subSoft:'#6e7681',
            border:'#30363d', borderSoft:'#21262d', accent:'#0275b8' }
        : { bg:'#ffffff', surface:'#f8fafc', head:'#f1f5f9', hover:'#f1f5f9',
            text:'#1f2c33', sub:'#64748b', subSoft:'#94a3b8',
            border:'#dfe4e7', borderSoft:'#eef2f5', accent:'#0275b8' };
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
