// toast.js — kleine Toast-Notifications statt blockierender alert()-Dialoge.
//
// Nicht-modal: stack-bottom-right, auto-dismiss nach Timeout, Klick = sofort weg.
// Vier Typen mit eigenen Farben: info / success / warn / error.
//
// API: toast(message, type='info', durationMs=3500)

const TOAST_COLORS = {
    info:    { bg: '#0891b2', fg: '#ffffff' },   // cyan
    success: { bg: '#16a34a', fg: '#ffffff' },   // grün
    warn:    { bg: '#d97706', fg: '#ffffff' },   // orange
    error:   { bg: '#dc2626', fg: '#ffffff' },   // rot
};

let _stack = null;

function _ensureStack() {
    if (_stack && document.body.contains(_stack)) return _stack;
    _stack = document.createElement('div');
    _stack.id = 'nt-toast-stack';
    _stack.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:10000;'
        + 'display:flex;flex-direction:column;gap:8px;pointer-events:none;'
        + 'max-width:380px';
    document.body.appendChild(_stack);
    return _stack;
}

export function toast(message, type, durationMs) {
    const t = TOAST_COLORS[type] || TOAST_COLORS.info;
    const ms = (typeof durationMs === 'number') ? durationMs : 3500;
    const stack = _ensureStack();

    const el = document.createElement('div');
    el.style.cssText = 'pointer-events:auto;background:' + t.bg + ';color:' + t.fg + ';'
        + 'padding:10px 14px;border-radius:6px;font-size:13px;font-weight:500;'
        + 'box-shadow:0 4px 16px rgba(0,0,0,0.25);cursor:pointer;'
        + 'opacity:0;transform:translateX(20px);transition:opacity 0.18s,transform 0.18s;'
        + 'max-width:100%;word-wrap:break-word';
    el.textContent = String(message);

    // Klick zum Schliessen
    let timer = null;
    const remove = function() {
        if (timer) { clearTimeout(timer); timer = null; }
        el.style.opacity = '0';
        el.style.transform = 'translateX(20px)';
        setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    };
    el.addEventListener('click', remove);

    stack.appendChild(el);
    // Einblendung im naechsten Frame anstossen (CSS-Transition greift)
    requestAnimationFrame(function() {
        el.style.opacity = '1';
        el.style.transform = 'translateX(0)';
    });
    timer = setTimeout(remove, ms);
}
