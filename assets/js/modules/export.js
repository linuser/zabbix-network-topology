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

// Ein einziger Document-Close-Handler (schliesst das Dropdown bei Aussenklick).
// Modul-Level, damit setupExportMenu ihn vor dem Neu-Anlegen entfernen kann —
// sonst sammelt sich pro Re-Render (im Group-View alle 30s) ein Listener an.
let _expDocClose = null;
import { loadLinks } from './storage.js';
import { statsByGroup, scoreColor, scoreLabel } from './render-health.js';
import { COMPLIANCE_CHECKS, fetchComplianceData } from './render-compliance.js';
import { t } from './i18n.js';

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

    const meta = t('export.report.meta', { date: now, hosts: nodes.length, links: links.length });

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

// Audit-Report — strukturierter HTML-Bericht mit:
//   - Header + Aggregat-Stats
//   - Hostgroup-Bewertung (Health-Score-Tabelle)
//   - Kritische Hosts (Severity >= 4)
//   - Offline/Stale-Liste
//   - Top-Probleme (haeufigste Trigger nach Anzahl betroffener Hosts)
//   - Proxy-Uebersicht (Hosts pro Zabbix-Proxy)
//
// Returns: HTML-String oder null wenn keine Daten verfuegbar.
function buildAuditHtml(complianceData) {
    if (!window._ntNodes) return null;
    const nodes = window._ntNodes.filter(function(n) { return !n._isInternet; });
    const now   = new Date().toLocaleString('de-DE');
    const STALE_S = 300;
    const nowSec  = Math.floor(Date.now() / 1000);

    // Aggregat
    let countOff = 0, countStale = 0, countCrit = 0, countUnack = 0, totalProbs = 0;
    nodes.forEach(function(n) {
        if (n.unavailable) countOff++;
        const age = n.last_seen ? (nowSec - n.last_seen) : 0;
        if (!n.unavailable && n.last_seen > 0 && age > STALE_S) countStale++;
        if ((n.severity || 0) >= 4) countCrit++;
        if ((n.problems || 0) > 0 && !n.acknowledged) countUnack++;
        totalProbs += (n.problems || 0);
    });

    // Hostgroups via Health-Score-Helper
    const groupStats = statsByGroup(nodes).sort(function(a, b) { return a.score - b.score; });

    // Top-10 Problemhosts: Badness-Score zusammengesetzt aus Offline (+50),
    // Severity (×10), Probleme-Anzahl (×2), Unacked (+20). Hosts ohne
    // Probleme und nicht offline/stale fallen automatisch raus (Score 0).
    const stale_now = nowSec;   // alias fuer Closure-Lesbarkeit
    const top10 = nodes.map(function(n) {
        const sev   = n.severity || 0;
        const probs = n.problems || 0;
        const isOff = !!n.unavailable;
        const age   = n.last_seen ? (stale_now - n.last_seen) : 0;
        const isStl = !isOff && n.last_seen > 0 && age > STALE_S;
        let bad = sev * 10 + probs * 2;
        if (isOff) bad += 50;
        if (isStl) bad += 15;
        if (probs > 0 && !n.acknowledged) bad += 20;
        return { n: n, bad: bad, isOff: isOff, isStl: isStl };
    })
    .filter(function(x) { return x.bad > 0; })
    .sort(function(a, b) { return b.bad - a.bad; })
    .slice(0, 10);

    // Kritische Hosts (sev >= 4) sortiert nach severity desc
    const critHosts = nodes.filter(function(n) { return (n.severity || 0) >= 4; })
        .sort(function(a, b) { return (b.severity || 0) - (a.severity || 0); });

    // Offline + Stale separat
    const offline = nodes.filter(function(n) { return n.unavailable; });
    const stale   = nodes.filter(function(n) {
        const age = n.last_seen ? (nowSec - n.last_seen) : 0;
        return !n.unavailable && n.last_seen > 0 && age > STALE_S;
    });

    // Top-Probleme: distinct Trigger-Names aus den Problem-Listen, zaehlen
    // wieviele Hosts betroffen sind. Wir greifen auf node._problems_detail
    // zurueck falls vom Backend mitgeliefert (siehe NetworkTopologyData);
    // sonst nur Counts, keine Namen.
    const problemHits = {};
    nodes.forEach(function(n) {
        const dets = n.problems_detail || n._problems_detail || [];
        dets.forEach(function(p) {
            const name = (p && p.name) || '';
            if (!name) return;
            if (!problemHits[name]) problemHits[name] = { count: 0, worstSev: 0 };
            problemHits[name].count++;
            problemHits[name].worstSev = Math.max(problemHits[name].worstSev, p.sev || 0);
        });
    });
    const topProblems = Object.keys(problemHits)
        .map(function(name) { return { name: name, count: problemHits[name].count, sev: problemHits[name].worstSev }; })
        .sort(function(a, b) {
            return b.count - a.count || b.sev - a.sev || a.name.localeCompare(b.name);
        })
        .slice(0, 10);
    // (alte Top-20-Variante: jetzt auf 10 reduziert fuer konsistentes Audit-Format)

    // Proxy-Uebersicht: Hosts pro Proxy-Name (+ "Server (kein Proxy)")
    const byProxy = {};
    nodes.forEach(function(n) {
        const p = (n.proxy_name && n.proxy_name.trim()) ? n.proxy_name : t('export.audit.noproxy');
        if (!byProxy[p]) byProxy[p] = { name: p, total: 0, offline: 0, problems: 0 };
        byProxy[p].total++;
        if (n.unavailable) byProxy[p].offline++;
        byProxy[p].problems += (n.problems || 0);
    });
    const proxyList = Object.values(byProxy).sort(function(a, b) { return b.total - a.total; });

    // ── HTML zusammenbauen ──
    function tr(cells) { return '<tr>' + cells.map(function(c) {
        return '<td' + (c && c.style ? ' style="' + c.style + '"' : '') + '>' + (c && c.text !== undefined ? c.text : c) + '</td>';
    }).join('') + '</tr>'; }
    function th(labels) { return '<tr>' + labels.map(function(l) { return '<th>' + l + '</th>'; }).join('') + '</tr>'; }

    function sevPill(sev) {
        const lbl = SEV_LBL[sev || 0] || 'Normal';
        const col = SEV_COLORS[lbl] || '#22c55e';
        return '<span style="color:' + col + ';font-weight:600">&#9679; ' + esc(lbl) + '</span>';
    }
    function ageStr(ts) {
        if (!ts) return '—';
        const s = nowSec - ts;
        if (s < 60)   return s + 's';
        if (s < 3600) return Math.floor(s / 60) + 'm';
        if (s < 86400) return Math.floor(s / 3600) + 'h';
        return Math.floor(s / 86400) + 'd';
    }

    const summarySection = '<section>'
        + '<h2>' + t('export.audit.summary') + '</h2>'
        + '<table class="summary"><tbody>'
        +   '<tr><th>' + t('export.audit.hosts_total') + '</th><td>' + nodes.length + '</td></tr>'
        +   '<tr><th>Offline</th><td' + (countOff   > 0 ? ' class="bad"' : '') + '>' + countOff   + '</td></tr>'
        +   '<tr><th>Stale</th><td'   + (countStale > 0 ? ' class="warn"' : '') + '>' + countStale + '</td></tr>'
        +   '<tr><th>' + t('export.audit.crit_sev') + '</th><td' + (countCrit > 0 ? ' class="bad"' : '') + '>' + countCrit + '</td></tr>'
        +   '<tr><th>' + t('export.audit.unacked') + '</th><td' + (countUnack > 0 ? ' class="warn"' : '') + '>' + countUnack + '</td></tr>'
        +   '<tr><th>' + t('export.audit.problems_total') + '</th><td>' + totalProbs + '</td></tr>'
        + '</tbody></table>'
        + '</section>';

    const top10Section = top10.length === 0
        ? ''
        : '<section><h2>' + t('export.audit.top10') + '</h2>'
            + '<table><thead>' + th(['#', 'Host', 'IP', 'Severity', 'Status', t('export.audit.col.problems'), 'Acked', 'Proxy']) + '</thead><tbody>'
            + top10.map(function(x, i) {
                const n = x.n;
                const status = x.isOff ? '<b style="color:#dc2626">OFFLINE</b>'
                             : x.isStl ? '<b style="color:#f59e0b">STALE</b>'
                             : '—';
                return tr([
                    { text: '<b>' + (i + 1) + '</b>', style: 'color:#64748b;font-family:monospace' },
                    esc(n.label || n.host || ''),
                    esc(n.ip || '—'),
                    sevPill(n.severity),
                    status,
                    { text: n.problems || 0, style: (n.problems || 0) > 0 ? 'font-weight:600' : 'color:#94a3b8' },
                    n.acknowledged ? '✔' : '—',
                    esc(n.proxy_name || '—'),
                ]);
            }).join('')
            + '</tbody></table>'
            + '<div style="font-size:10px;color:#94a3b8;margin-top:4px">'
            + t('export.audit.ranking')
            + '</div></section>';

    const groupsSection = '<section><h2>Hostgroups (' + groupStats.length + ')</h2>'
        + '<table><thead>' + th([t('export.audit.col.group'), 'Hosts', 'Offline', 'Stale', 'Critical', 'Unacked', 'Score']) + '</thead><tbody>'
        + groupStats.map(function(g) {
            const col = scoreColor(g.score);
            return tr([
                '<b>' + esc(g.name) + '</b>',
                g.total,
                { text: g.offline, style: g.offline > 0 ? 'color:#dc2626;font-weight:600' : '' },
                { text: g.stale,   style: g.stale   > 0 ? 'color:#f59e0b;font-weight:600' : '' },
                { text: g.critical,style: g.critical> 0 ? 'color:#dc2626;font-weight:600' : '' },
                { text: g.unacked, style: g.unacked > 0 ? 'color:#f97316;font-weight:600' : '' },
                { text: '<b>' + g.score + '</b> ' + scoreLabel(g.score), style: 'color:' + col + ';font-weight:700' },
            ]);
        }).join('')
        + '</tbody></table></section>';

    const critSection = critHosts.length === 0
        ? ''
        : '<section><h2>' + t('export.audit.crit_hosts', { n: critHosts.length }) + '</h2>'
            + '<table><thead>' + th(['Host', 'IP', 'Severity', t('export.audit.col.problems'), 'Acked', 'Proxy']) + '</thead><tbody>'
            + critHosts.slice(0, 100).map(function(n) {
                return tr([
                    esc(n.label || n.host || ''),
                    esc(n.ip || '—'),
                    sevPill(n.severity),
                    n.problems || 0,
                    n.acknowledged ? '✔' : '—',
                    esc(n.proxy_name || '—'),
                ]);
            }).join('')
            + (critHosts.length > 100 ? '<tr><td colspan="6"><i>' + t('export.audit.more', { n: critHosts.length - 100 }) + '</i></td></tr>' : '')
            + '</tbody></table></section>';

    const offlineSection = (offline.length === 0 && stale.length === 0)
        ? ''
        : '<section><h2>Offline &amp; Stale</h2>'
            + (offline.length > 0
                ? '<h3>Offline (' + offline.length + ')</h3>'
                + '<table><thead>' + th(['Host', 'IP', t('export.audit.col.last_seen'), 'Proxy', t('export.audit.col.error')]) + '</thead><tbody>'
                + offline.map(function(n) {
                    return tr([
                        esc(n.label || n.host || ''),
                        esc(n.ip || '—'),
                        ageStr(n.last_seen),
                        esc(n.proxy_name || '—'),
                        esc(n.down_error || '—'),
                    ]);
                }).join('')
                + '</tbody></table>'
                : '')
            + (stale.length > 0
                ? '<h3>Stale (' + stale.length + ')</h3>'
                + '<table><thead>' + th(['Host', 'IP', t('export.audit.col.last_seen'), 'Proxy']) + '</thead><tbody>'
                + stale.map(function(n) {
                    return tr([
                        esc(n.label || n.host || ''),
                        esc(n.ip || '—'),
                        ageStr(n.last_seen),
                        esc(n.proxy_name || '—'),
                    ]);
                }).join('')
                + '</tbody></table>'
                : '')
            + '</section>';

    const topProbsSection = topProblems.length === 0
        ? ''
        : '<section><h2>' + t('export.audit.top_problems', { n: topProblems.length }) + '</h2>'
            + '<table><thead>' + th(['Trigger', 'Severity', t('export.audit.col.affected')]) + '</thead><tbody>'
            + topProblems.map(function(p) {
                return tr([esc(p.name), sevPill(p.sev), p.count]);
            }).join('')
            + '</tbody></table></section>';

    const proxySection = '<section><h2>' + t('export.audit.proxies', { n: proxyList.length }) + '</h2>'
        + '<table><thead>' + th(['Proxy', 'Hosts', 'Offline', t('export.audit.col.problems')]) + '</thead><tbody>'
        + proxyList.map(function(p) {
            return tr([
                '<b>' + esc(p.name) + '</b>',
                p.total,
                { text: p.offline,  style: p.offline  > 0 ? 'color:#dc2626;font-weight:600' : '' },
                p.problems,
            ]);
        }).join('')
        + '</tbody></table></section>';

    // Compliance-Sektion — nur wenn der Caller die Daten geliefert hat
    // (network.topology.compliance Action). Sonst leer.
    let complianceSection = '';
    if (complianceData && complianceData.aggregate) {
        // Check-Definitionen aus render-compliance.js (Single Source) —
        // nur das stale_problem-Label wird hier mit dem dynamischen
        // Cutoff aus der Backend-Response angereichert.
        const checks = COMPLIANCE_CHECKS.map(function(c) {
            if (c.key === 'stale_problem') {
                return { key: c.key, level: c.level,
                         lbl: t('export.audit.stale_problem', { days: complianceData.cutoff_days || 7 }) };
            }
            return c;
        });
        const colOf = function(lvl) { return lvl === 'bad' ? '#dc2626' : lvl === 'good' ? '#16a34a' : '#0891b2'; };
        const tot   = complianceData.total || 0;
        complianceSection = '<section><h2>' + t('export.audit.compliance', { n: tot }) + '</h2>'
            + '<table><thead>' + th(['Check', 'Level', t('export.audit.col.affected'), '%']) + '</thead><tbody>'
            + checks.map(function(c) {
                const n   = complianceData.aggregate[c.key] || 0;
                const pct = tot > 0 ? Math.round(100 * n / tot) : 0;
                const lvlLbl = c.level === 'bad' ? t('export.audit.lvl_bad') : c.level === 'good' ? t('export.audit.lvl_good') : t('export.audit.lvl_info');
                return tr([
                    '<b>' + esc(c.lbl) + '</b>',
                    { text: '<span style="color:' + colOf(c.level) + ';font-weight:600">' + lvlLbl + '</span>' },
                    { text: n, style: n > 0 && c.level === 'bad' ? 'color:#dc2626;font-weight:700' : (n > 0 ? 'font-weight:600' : 'color:#94a3b8') },
                    { text: pct + '%', style: 'color:#64748b' },
                ]);
            }).join('')
            + '</tbody></table>'
            + '<div style="font-size:10px;color:#94a3b8;margin-top:4px">'
            + t('export.audit.lvl_note') + '</div></section>';
    }

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>NT Audit Report</title>'
        + '<style>'
        + 'body{font-family:sans-serif;margin:28px;color:#1e293b;line-height:1.4}'
        + 'h1{font-size:20px;border-bottom:3px solid #0275b8;padding-bottom:8px;margin:0 0 4px}'
        + 'h2{font-size:14px;color:#0275b8;text-transform:uppercase;letter-spacing:0.05em;'
        +   'border-bottom:1px solid #dfe4e7;padding-bottom:4px;margin:24px 0 10px}'
        + 'h3{font-size:12px;color:#475569;margin:14px 0 6px}'
        + '.meta{font-size:11px;color:#64748b;margin-bottom:14px}'
        + 'section{margin-bottom:8px}'
        + 'table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:6px}'
        + 'th{background:#f1f5f9;padding:5px 9px;text-align:left;border-bottom:2px solid #cbd5e1;color:#334155;font-weight:600}'
        + 'td{padding:4px 9px;border-bottom:1px solid #eef2f5}'
        + 'table.summary{width:auto;min-width:280px;font-size:12px}'
        + 'table.summary th{background:transparent;width:180px;font-weight:500;color:#64748b;'
        +   'border-bottom:1px solid #eef2f5}'
        + 'table.summary td{font-weight:700;font-family:monospace}'
        + '.bad{color:#dc2626}.warn{color:#f59e0b}'
        + '@media print{@page{size:A4;margin:12mm}h1{page-break-after:avoid}h2{page-break-after:avoid}}'
        + '</style></head><body>'
        + '<h1>Network Topology — Audit Report</h1>'
        + '<div class="meta">' + t('export.audit.meta', { date: esc(now), hosts: nodes.length }) + '</div>'
        + summarySection + top10Section + groupsSection + critSection + offlineSection + topProbsSection + proxySection + complianceSection
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
        ? t('export.overlay.print')
        : t('export.overlay.png');
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
        // icon ist bewusst eine statische HTML-Entity (&#128444; usw.) und bleibt.
        // label defensiv escapen — aktuell immer statisch/i18n, aber so ist der
        // Helfer auch gegen ein kuenftiges dynamisches Label sicher.
        row.innerHTML = '<span>' + icon + '</span><span>' + esc(label) + '</span>';
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

    mItem('&#128196;', t('export.menu.pdf'), function() {
        const h = buildReportHtml({ includeMap: true });
        if (!h) return;
        const w = window.open();
        if (w) {
            w.document.write(h);
            w.document.close();
            setTimeout(function() { w.print(); }, 800);
        }
    });

    mItem('&#128190;', t('export.menu.html'), function() {
        const h = buildReportHtml({ includeMap: true });
        if (!h) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([h], { type: 'text/html' }));
        a.download = 'network-topology-' + new Date().toISOString().slice(0, 10) + '.html';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    // Audit-Report: strukturierter Bericht (Hostgroups + Kritische + Offline/Stale
    // + Top-Probleme + Proxy + Compliance). Kein Map-Screenshot — fokussiert auf
    // Audit-relevante Daten. Compliance-Fetch kommt aus render-compliance.js
    // (Single Source); bei Fehler/fehlender Berechtigung (Endpoint ist Admin-
    // only) faellt der Report auf "ohne Compliance-Sektion" zurueck.
    const _fetchCompliance = fetchComplianceData;

    mItem('&#128203;', t('export.menu.audit_pdf'), function() {
        // Fenster SYNCHRON im Click oeffnen (User-Activation) — window.open()
        // im .then() nach dem Fetch wuerde der Popup-Blocker schlucken
        // (v.a. Firefox bei langsamem Backend). Inhalt kommt async nach.
        const w = window.open();
        if (!w) return;
        w.document.write('<p style="font-family:sans-serif;color:#64748b">' + t('export.generating') + '</p>');
        _fetchCompliance().then(function(compl) {
            const h = buildAuditHtml(compl);
            if (!h) { w.close(); return; }
            w.document.open();
            w.document.write(h);
            w.document.close();
            setTimeout(function() { w.print(); }, 800);
        });
    });

    mItem('&#128221;', t('export.menu.audit_html'), function() {
        _fetchCompliance().then(function(compl) {
            const h = buildAuditHtml(compl);
            if (!h) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([h], { type: 'text/html' }));
            a.download = 'nt-audit-' + new Date().toISOString().slice(0, 10) + '.html';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    });

    expBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        expMenu.style.display = expMenu.style.display === 'none' ? 'block' : 'none';
    });
    if (_expDocClose) document.removeEventListener('click', _expDocClose);
    _expDocClose = function() { expMenu.style.display = 'none'; };
    document.addEventListener('click', _expDocClose);

    expWrap.appendChild(expBtn);
    expWrap.appendChild(expMenu);
    if (bar && isFirstRun) bar.appendChild(expWrap);
}
