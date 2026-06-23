// export.js — Export-Menü (PNG/PDF/HTML) und Vollbild-Overlay für PNG.
//
// Frueher hiess das Modul export-mail.js und konnte Reports per E-Mail
// verschicken. Die Mail-Funktion wurde entfernt (siehe CHANGELOG); was
// uebrig blieb ist der HTML-Report-Generator fuer PDF-Druck und
// HTML-Download, plus das PNG-Overlay.
//
// Ein einziger Einstiegspunkt:
//   setupExportMenu(bar, isFirstRun) — baut den Export-Dropdown in der
//   Toolbar (PNG / PDF / HTML).
//
// buildReportHtml() erzeugt einen druckfreundlichen Report (A4 landscape,
// inline <style>-Block) mit aktuellem Stand der Hosts. Optionaler
// Map-Screenshot via cy.png() wird oben eingebettet.

import { esc, fmt } from './utils.js';
import { loadLinks } from './storage.js';

const SEV_LBL = ['Normal', 'Info', 'Warning', 'Average', 'High', 'Disaster'];
const SEV_COLORS = {
    Normal: '#22c55e', Info: '#06b6d4', Warning: '#f59e0b',
    Average: '#f97316', High: '#ef4444', Disaster: '#991b1b'
};

// Bestimmt den richtigen PNG-Hintergrund anhand des aktuellen Dark-Mode-
// Status. Wird zur Render-Zeit ausgewertet (nicht beim Toolbar-Build),
// damit ein Dark-Mode-Toggle nach dem ersten Render trotzdem im PNG
// reflektiert wird.
function currentBg() {
    const root = document.getElementById('nt-root');
    return (root && root.classList.contains('nt-dark')) ? '#0f172a' : '#f8fafc';
}

// HTML-Report-Generator fuer PDF-Druck und HTML-Download. Liefert ein
// druckfreundliches Dokument mit @page A4 landscape + Map-Screenshot
// (cy.png()) + Hosts-Tabelle. null wenn keine Cy-Instance verfuegbar.
function buildReportHtml(opts) {
    if (!window._ntCy || !window._ntNodes) return null;
    const nodes = window._ntNodes;
    const links = loadLinks();
    const now   = new Date().toLocaleString('de-DE');

    const mapImg = opts.includeMap
        ? window._ntCy.png({ full: true, scale: 2, bg: currentBg() })
        : null;

    const rows = nodes.slice()
        .sort(function(a, b) {
            return (b.severity || 0) - (a.severity || 0)
                || (a.label || '').localeCompare(b.label || '');
        })
        .map(function(n) {
            const sev = SEV_LBL[n.severity || 0] || 'Normal';
            const col = SEV_COLORS[sev] || '#22c55e';
            const tr  = n.traffic || { in: 0, out: 0 };
            return '<tr>'
                + '<td>' + esc(n.label || n.host) + '</td>'
                + '<td><span style="color:' + col + ';font-weight:600">&#9679; ' + sev + '</span></td>'
                + '<td>' + esc(n.ip || '—') + '</td>'
                + '<td>' + (n.cpu    != null ? n.cpu    + '%'   : '—') + '</td>'
                + '<td>' + (n.memory != null ? n.memory + '%'   : '—') + '</td>'
                + '<td>' + (n.ping > 0       ? n.ping   + ' ms' : '—') + '</td>'
                + '<td style="color:#22c55e">' + fmt(tr.in)  + '</td>'
                + '<td style="color:#06b6d4">' + fmt(tr.out) + '</td>'
                + '</tr>';
        }).join('');

    const meta = now + ' &nbsp;|&nbsp; ' + nodes.length + ' Hosts &nbsp;|&nbsp; ' + links.length + ' Links';

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>NT Report</title>'
        + '<style>'
        + 'body{font-family:sans-serif;margin:20px;color:#1e293b}'
        + 'h1{font-size:18px;border-bottom:2px solid #3b82f6;padding-bottom:6px}'
        + '.meta{font-size:11px;color:#64748b;margin-bottom:16px}'
        + '.map{text-align:center;margin-bottom:20px}'
        + '.map img{max-width:100%;border:1px solid #e2e8f0;border-radius:6px}'
        + 'table{width:100%;border-collapse:collapse;font-size:12px}'
        + 'th{background:#f8fafc;padding:7px 10px;text-align:left;border-bottom:2px solid #e2e8f0;color:#475569}'
        + 'td{padding:6px 10px;border-bottom:1px solid #f1f5f9}'
        + '@media print{@page{size:A4 landscape;margin:10mm}}'
        + '</style></head><body>'
        + '<h1>Network Topology &mdash; Report</h1>'
        + '<div class="meta">' + meta + '</div>'
        + (mapImg ? '<div class="map"><img src="' + mapImg + '"/></div>' : '')
        + '<table><thead><tr>'
        + '<th>Name</th><th>Status</th><th>IP</th><th>CPU</th><th>Memory</th><th>Ping</th><th>IN</th><th>OUT</th>'
        + '</tr></thead><tbody>' + rows + '</tbody></table>'
        + '</body></html>';
}

// Vollbild-Overlay zum Anzeigen des PNG-Exports.
// printMode=true triggert window.print() (für PDF-Export-Variante).
export function ntShowExportOverlay(png, printMode) {
    const existing = document.getElementById('nt-export-overlay');
    if (existing) existing.remove();
    const ov = document.createElement('div');
    ov.id = 'nt-export-overlay';
    ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;'
        + 'background:rgba(0,0,0,0.88);z-index:99999;display:flex;flex-direction:column;'
        + 'align-items:center;justify-content:center;cursor:pointer';
    const hint = printMode
        ? 'Cmd+P zum Drucken / Als PDF sichern &nbsp;·&nbsp; Klick zum Schliessen'
        : 'Rechtsklick auf Bild → "Bild sichern unter..." &nbsp;·&nbsp; Klick zum Schliessen';
    ov.innerHTML = '<div style="color:#ccc;font-family:sans-serif;font-size:12px;'
        + 'margin-bottom:12px;text-align:center">' + hint + '</div>'
        + '<img src="' + png + '" style="max-width:95vw;max-height:85vh;display:block;'
        + 'border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,0.5)"/>';
    ov.addEventListener('click', function() { ov.remove(); });
    document.body.appendChild(ov);
    if (printMode) setTimeout(function() { window.print(); }, 500);
}

// Baut den Export-Button samt Dropdown (PNG / PDF / HTML) und haengt
// ihn an die uebergebene Toolbar-Leiste an. Idempotent: bestehende
// nt-export-wrap wird ersetzt (sodass Re-Renders kein Mehrfach-Anzeigen
// erzeugen).
export function setupExportMenu(bar, isFirstRun) {
    const existing = document.getElementById('nt-export-wrap');
    if (existing) existing.remove();

    const expWrap = document.createElement('div');
    expWrap.id = 'nt-export-wrap';
    expWrap.style.cssText = 'position:relative;display:inline-block;margin-left:4px';

    const expBtn = document.createElement('button');
    expBtn.className = 'btn-alt btn-small';
    expBtn.style.margin = '0';
    expBtn.textContent = '⬇ Export';

    const expMenu = document.createElement('div');
    expMenu.style.cssText = 'display:none;position:absolute;top:100%;left:0;z-index:9999;'
        + 'background:#fff;border:1px solid #e2e8f0;border-radius:6px;'
        + 'box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:150px;overflow:hidden;margin-top:2px';

    function mItem(icon, label, fn) {
        const row = document.createElement('div');
        row.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;color:#334155;'
            + 'white-space:nowrap;display:flex;align-items:center;gap:8px';
        row.innerHTML = '<span>' + icon + '</span><span>' + label + '</span>';
        row.addEventListener('mouseover', function() { this.style.background = '#f8fafc'; });
        row.addEventListener('mouseout',  function() { this.style.background = ''; });
        row.addEventListener('click', function() { expMenu.style.display = 'none'; fn(); });
        expMenu.appendChild(row);
    }

    mItem('&#128444;', 'PNG', function() {
        if (!window._ntCy) return;
        ntShowExportOverlay(window._ntCy.png({
            full: true, scale: 2, bg: currentBg()
        }), false);
    });

    mItem('&#128196;', 'PDF (Drucken)', function() {
        const h = buildReportHtml({ includeMap: true });
        if (!h) return;
        const w = window.open();
        if (w) {
            w.document.write(h);
            w.document.close();
            setTimeout(function() { w.print(); }, 800);
        }
    });

    mItem('&#128190;', 'HTML speichern', function() {
        const h = buildReportHtml({ includeMap: true });
        if (!h) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([h], { type: 'text/html' }));
        a.download = 'network-topology-' + new Date().toISOString().slice(0, 10) + '.html';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    expBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        expMenu.style.display = expMenu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', function() { expMenu.style.display = 'none'; });

    expWrap.appendChild(expBtn);
    expWrap.appendChild(expMenu);
    if (bar && isFirstRun) bar.appendChild(expWrap);
}
