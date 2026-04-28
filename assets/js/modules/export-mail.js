// export-mail.js — Export-Menü (PNG/PDF/HTML/Mail) und Vollbild-Overlay
// für PNG-Anzeige.
//
// Zwei UI-Einstiegspunkte:
//   - setupExportMenu(): Dropdown im Toolbar mit allen vier Export-Formaten.
//     PDF/HTML/Mail nutzen alle den gleichen HTML-Generator und können
//     optional einen Map-Screenshot (cy.png()) einbetten.
//   - setupMailButton(): eigenständiger Mail-Button rechts in der Toolbar.
//     Nutzt eine kompaktere Mail-Variante ohne Map-Screenshot, mit Inline-
//     Styles für maximale E-Mail-Client-Kompatibilität.
//
// Beide Code-Pfade rufen denselben buildReportHtml()-Helper auf — der
// `mode`-Parameter steuert nur, ob CSS in <style>-Block oder als Inline-
// Styles ausgegeben wird (E-Mail-Clients ignorieren oft <style>).
//
// Mail-Versand spricht das NetworkTopologyMail-Backend per POST an, mit
// CSRF-Token aus NT_CONFIG.

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

// Gemeinsamer HTML-Report-Generator. Ein einzelner Codepfad sowohl für
// PDF/HTML-Datei (mode='document') als auch für Mail (mode='email').
//
// Optionen:
//   includeMap: bool — Map-Screenshot via cy.png() einbetten
//   mode:       'document' | 'email'  (Style-Strategie)
//
// Returns: HTML-String oder null wenn keine Daten verfügbar
function buildReportHtml(opts) {
    if (!window._ntCy || !window._ntNodes) return null;
    const nodes = window._ntNodes;
    const links = loadLinks();
    const now   = new Date().toLocaleString('de-DE');
    const isEmail = opts.mode === 'email';

    const mapImg = opts.includeMap
        ? window._ntCy.png({ full: true, scale: 2, bg: currentBg() })
        : null;

    // Inline-Styles für E-Mail (viele Clients ignorieren <style>);
    // Class-basierte Styles fürs PDF/HTML-Dokument.
    const tdStyle = isEmail ? ' style="padding:6px 10px;border-bottom:1px solid #f1f5f9"' : '';

    const rows = nodes.slice()
        .sort(function(a, b) {
            return (b.severity || 0) - (a.severity || 0)
                || (a.label || '').localeCompare(b.label || '');
        })
        .map(function(n) {
            const sev = SEV_LBL[n.severity || 0] || 'Normal';
            const col = SEV_COLORS[sev] || '#22c55e';
            const tr  = n.traffic || { in: 0, out: 0 };
            const cellSev    = isEmail ? ' style="padding:6px 10px;border-bottom:1px solid #f1f5f9"' : '';
            const cellTrIn   = isEmail ? ' style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#22c55e"' : ' style="color:#22c55e"';
            const cellTrOut  = isEmail ? ' style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#06b6d4"' : ' style="color:#06b6d4"';
            return '<tr>'
                + '<td' + tdStyle + '>' + esc(n.label || n.host) + '</td>'
                + '<td' + cellSev + '><span style="color:' + col + ';font-weight:600">&#9679; ' + sev + '</span></td>'
                + '<td' + tdStyle + '>' + esc(n.ip || '\u2014') + '</td>'
                + '<td' + tdStyle + '>' + (n.cpu    != null ? n.cpu    + '%'   : '\u2014') + '</td>'
                + '<td' + tdStyle + '>' + (n.memory != null ? n.memory + '%'   : '\u2014') + '</td>'
                + '<td' + tdStyle + '>' + (n.ping > 0       ? n.ping   + ' ms' : '\u2014') + '</td>'
                + '<td' + cellTrIn  + '>' + fmt(tr.in)  + '</td>'
                + '<td' + cellTrOut + '>' + fmt(tr.out) + '</td>'
                + '</tr>';
        }).join('');

    const meta = now + ' &nbsp;|&nbsp; ' + nodes.length + ' Hosts &nbsp;|&nbsp; ' + links.length + ' Links';

    if (isEmail) {
        // E-Mail: alle Styles inline für maximale Client-Kompatibilität
        return '<html><body style="font-family:sans-serif;color:#1e293b;max-width:900px;margin:20px auto">'
            + '<h2 style="border-bottom:2px solid #3b82f6;padding-bottom:6px">Network Topology Report</h2>'
            + '<p style="color:#64748b;font-size:12px">' + meta + '</p>'
            + (mapImg ? '<div style="text-align:center;margin-bottom:20px">'
                      + '<img src="' + mapImg + '" style="max-width:100%;border:1px solid #e2e8f0;border-radius:6px"/>'
                      + '</div>' : '')
            + '<table style="width:100%;border-collapse:collapse;font-size:13px">'
            + '<thead><tr style="background:#f8fafc">'
            + ['Name', 'Status', 'IP', 'CPU', 'Memory', 'Ping', 'IN', 'OUT'].map(function(h) {
                return '<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0">' + h + '</th>';
            }).join('')
            + '</tr></thead><tbody>' + rows + '</tbody></table>'
            + '<p style="color:#94a3b8;font-size:11px;margin-top:20px">Gesendet von Zabbix Network Topology</p>'
            + '</body></html>';
    }

    // Document: <style>-Block, druckfreundlich (@page A4 landscape)
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

// Sendet einen Report-HTML per POST an den Mail-Endpoint. Kapselt CSRF-
// Handling, Body-Encoding (Base64), Erfolgs-/Fehler-Anzeige.
//
// `button` ist optional — wenn gegeben, wird er während des Sendens
// disabled und mit "Sende..." beschriftet.
function sendReport(html, to, button) {
    const cfg = window.NT_CONFIG;
    if (!cfg) return;
    const mailUrl = cfg.data_url.replace('network.topology.v6.data', 'network.topology.v6.mail');
    const b64  = btoa(unescape(encodeURIComponent(html)));
    const csrf = cfg.csrf_token || '';

    const originalLabel = button ? button.textContent : null;
    if (button) {
        button.textContent = 'Sende...';
        button.disabled = true;
    }

    fetch(mailUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: 'to=' + encodeURIComponent(to.trim())
            + '&html_b64=' + encodeURIComponent(b64)
            + '&_csrf_token=' + encodeURIComponent(csrf)
    })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (button) { button.disabled = false; button.textContent = originalLabel; }
            alert(d.success
                ? '\u2705 Report gesendet an: ' + to
                : '\u274C Fehler: ' + (d.error || 'Unbekannt'));
        })
        .catch(function(err) {
            if (button) { button.disabled = false; button.textContent = originalLabel; }
            alert('\u274C Fehler: ' + err.message);
        });
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
        ? 'Cmd+P zum Drucken / Als PDF sichern &nbsp;\u00B7&nbsp; Klick zum Schliessen'
        : 'Rechtsklick auf Bild \u2192 "Bild sichern unter..." &nbsp;\u00B7&nbsp; Klick zum Schliessen';
    ov.innerHTML = '<div style="color:#ccc;font-family:sans-serif;font-size:12px;'
        + 'margin-bottom:12px;text-align:center">' + hint + '</div>'
        + '<img src="' + png + '" style="max-width:95vw;max-height:85vh;display:block;'
        + 'border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,0.5)"/>';
    ov.addEventListener('click', function() { ov.remove(); });
    document.body.appendChild(ov);
    if (printMode) setTimeout(function() { window.print(); }, 500);
}

// Baut den Export-Button samt Dropdown (PNG / PDF / HTML / Mail) und hängt
// ihn an die übergebene Toolbar-Leiste an. Idempotent: bestehende
// nt-export-wrap wird ersetzt (sodass Re-Renders kein Mehrfach-Anzeigen
// erzeugen).
//
// Hinweis: PNG-Hintergrund liest jetzt currentBg() bei jedem Klick statt
// den isDark-Snapshot aus dem Toolbar-Build — Dark-Mode-Wechsel wird im
// Export reflektiert.
export function setupExportMenu(bar, isFirstRun) {
    const existing = document.getElementById('nt-export-wrap');
    if (existing) existing.remove();

    const expWrap = document.createElement('div');
    expWrap.id = 'nt-export-wrap';
    expWrap.style.cssText = 'position:relative;display:inline-block;margin-left:4px';

    const expBtn = document.createElement('button');
    expBtn.className = 'btn-alt btn-small';
    expBtn.style.margin = '0';
    expBtn.textContent = '\u2B07 Export';

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
        const h = buildReportHtml({ includeMap: true, mode: 'document' });
        if (!h) return;
        const w = window.open();
        if (w) {
            w.document.write(h);
            w.document.close();
            setTimeout(function() { w.print(); }, 800);
        }
    });

    mItem('&#128190;', 'HTML speichern', function() {
        const h = buildReportHtml({ includeMap: true, mode: 'document' });
        if (!h) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([h], { type: 'text/html' }));
        a.download = 'network-topology-' + new Date().toISOString().slice(0, 10) + '.html';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    const divider = document.createElement('div');
    divider.style.cssText = 'border-top:1px solid #f1f5f9;margin:2px 0';
    expMenu.appendChild(divider);

    mItem('&#128231;', 'Per Mail senden', function() {
        const to = prompt('Report senden an (E-Mail):');
        if (!to || !to.trim()) return;
        const h = buildReportHtml({ includeMap: true, mode: 'email' });
        if (h) sendReport(h, to, null);
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

// Baut den eigenständigen "Mail"-Toolbar-Button.
// Nutzt buildReportHtml mit mode='email' (kein Map-Screenshot) für eine
// kompakte, schnell zu sendende Status-Übersicht.
export function setupMailButton(mkbtn) {
    const bMail = mkbtn('nt-btn-mail', 'Mail', null);
    bMail.onclick = function() {
        if (!window._ntCy || !window._ntNodes) return;
        const to = prompt('Report senden an (E-Mail):');
        if (!to || !to.trim()) return;
        const h = buildReportHtml({ includeMap: false, mode: 'email' });
        if (h) sendReport(h, to, bMail);
    };
    return bMail;
}
