// utils.js — generische Helfer ohne Abhängigkeiten
//
// Diese beiden Funktionen werden überall im Code gebraucht (HTML-Escaping,
// Bandbreiten-Format) und sollten daher in einem eigenen Modul ohne weitere
// Imports stehen.

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
