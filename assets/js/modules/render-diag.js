// render-diag.js — Admin-Diagnose-Tab.
//
// Zeigt die letzten ~50 Backend-Aufrufe (Data/History/Items/Discover/Spark)
// aus dem APCu-Ring-Buffer pro User: elapsed_ms, bytes, cache_hit, Counts.
// Plus eine Summary mit Avg/Max-Latenz pro Action und Cache-Hit-Rate.
//
// Nur sichtbar fuer Admins (NT_CONFIG.can_edit). Backend prueft das nochmal,
// aber wir blenden den Tab im Frontend gleich aus.

import { esc, mkTabTheme, buildBaseUrl } from './utils.js';
import { t } from './i18n.js';

function _bytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function _ago(ts) {
    const sec = Math.max(0, Math.floor(Date.now() / 1000) - ts);
    if (sec < 60)    return sec + 's';
    if (sec < 3600)  return Math.floor(sec / 60) + 'm';
    return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
}

function _aggStats(entries) {
    const byAction = {};
    entries.forEach(function(e) {
        const a = e.action || '?';
        if (!byAction[a]) byAction[a] = { count: 0, totMs: 0, maxMs: 0, totBytes: 0, hits: 0 };
        byAction[a].count++;
        byAction[a].totMs   += e.elapsed_ms || 0;
        byAction[a].maxMs   = Math.max(byAction[a].maxMs, e.elapsed_ms || 0);
        byAction[a].totBytes += e.bytes || 0;
        if (e.cache_hit) byAction[a].hits++;
    });
    return byAction;
}

function _buildSummary(byAction, theme) {
    const actions = Object.keys(byAction).sort();
    if (actions.length === 0) return '<div style="color:' + theme.subSoft + '">' + esc(t('diag.no_entries')) + '</div>';
    let html = '<table style="border-collapse:collapse;font-size:12px;width:auto">'
        + '<thead><tr style="border-bottom:1px solid ' + theme.border + '">'
        + ['Action', 'Count', 'Avg ms', 'Max ms', 'Avg Size', 'Cache Hit'].map(function(h) {
            return '<th style="padding:6px 14px;text-align:left;color:' + theme.sub + ';font-weight:600">' + h + '</th>';
        }).join('') + '</tr></thead><tbody>';
    actions.forEach(function(a) {
        const s = byAction[a];
        const avg = s.count > 0 ? (s.totMs / s.count) : 0;
        const avgBytes = s.count > 0 ? (s.totBytes / s.count) : 0;
        const hitRate = s.count > 0 ? Math.round(100 * s.hits / s.count) : 0;
        const slowCol = s.maxMs > 1000 ? '#dc2626' : (s.maxMs > 500 ? '#f59e0b' : theme.text);
        html += '<tr style="border-bottom:1px solid ' + theme.borderSoft + '">'
            + '<td style="padding:4px 14px;font-weight:600">' + esc(a) + '</td>'
            + '<td style="padding:4px 14px;text-align:right">' + s.count + '</td>'
            + '<td style="padding:4px 14px;text-align:right">' + avg.toFixed(1) + '</td>'
            + '<td style="padding:4px 14px;text-align:right;color:' + slowCol + ';font-weight:600">' + s.maxMs.toFixed(1) + '</td>'
            + '<td style="padding:4px 14px;text-align:right">' + _bytes(avgBytes) + '</td>'
            + '<td style="padding:4px 14px;text-align:right">' + (s.hits > 0 ? hitRate + '% (' + s.hits + '/' + s.count + ')' : '—') + '</td>'
            + '</tr>';
    });
    return html + '</tbody></table>';
}

function _buildLog(entries, theme) {
    if (!entries.length) {
        return '<div style="color:' + theme.subSoft + ';padding:20px 0">'
            + esc(t('diag.no_calls')) + '</div>';
    }
    const rows = entries.slice().reverse().map(function(e) {
        const slowCol = (e.elapsed_ms || 0) > 1000 ? '#dc2626'
                      : (e.elapsed_ms || 0) > 500 ? '#f59e0b' : theme.text;
        const cacheLbl = e.cache_hit
            ? '<span style="color:var(--nt-c-16a34a,#16a34a)">HIT</span>'
            : '<span style="color:' + theme.subSoft + '">—</span>';
        const countsStr = e.counts
            ? Object.keys(e.counts).map(function(k) { return k + ':' + e.counts[k]; }).join(', ')
            : '';
        return '<tr style="border-bottom:1px solid ' + theme.borderSoft + '">'
            + '<td style="padding:4px 12px;color:' + theme.sub + ';font-family:monospace">' + _ago(e.ts) + '</td>'
            + '<td style="padding:4px 12px;font-weight:600">' + esc(e.action || '?') + '</td>'
            + '<td style="padding:4px 12px;text-align:right;color:' + slowCol + ';font-family:monospace">'
                + (e.elapsed_ms || 0).toFixed(1) + ' ms</td>'
            + '<td style="padding:4px 12px;text-align:right;font-family:monospace">' + _bytes(e.bytes || 0) + '</td>'
            + '<td style="padding:4px 12px;text-align:center">' + cacheLbl + '</td>'
            + '<td style="padding:4px 12px;color:' + theme.sub + ';font-family:monospace;font-size:11px">'
                + esc(countsStr) + '</td>'
            + '</tr>';
    }).join('');
    return '<table style="border-collapse:collapse;font-size:12px;width:100%">'
        + '<thead><tr style="border-bottom:1px solid ' + theme.border + '">'
        + [t('diag.col.ago'), 'Action', t('diag.col.latency'), 'Size', 'Cache', 'Counts'].map(function(h) {
            return '<th style="padding:6px 12px;text-align:left;color:' + theme.sub + ';font-weight:600">' + h + '</th>';
        }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table>';
}

export function renderDiag(wrap) {
    if (window._ntCy)         { try { window._ntCy.destroy(); } catch (e) {} window._ntCy = null; }
    if (window._ntEdgeAnim)   { clearInterval(window._ntEdgeAnim);     window._ntEdgeAnim     = null; }

    const dark = !!(document.getElementById('nt-root')
                 && document.getElementById('nt-root').classList.contains('nt-dark'));
    const theme = mkTabTheme(dark);

    Array.from(wrap.children).forEach(function(ch) {
        if (ch.id !== 'nt-loading') wrap.removeChild(ch);
    });

    const root = document.createElement('div');
    root.style.cssText = 'padding:20px;background:' + theme.bg + ';color:' + theme.text
        + ';height:100%;overflow:auto;font-family:sans-serif';

    const head = document.createElement('div');
    head.innerHTML = '<h2 style="margin:0 0 6px;font-size:16px">' + t('diag.title') + '</h2>'
        + '<div style="font-size:12px;color:' + theme.sub + ';margin-bottom:18px">'
        + t('diag.intro')
        + '</div>';
    root.appendChild(head);

    const summaryWrap = document.createElement('div');
    summaryWrap.style.marginBottom = '24px';
    const summaryHead = document.createElement('div');
    summaryHead.innerHTML = '<h3 style="margin:0 0 8px;font-size:13px;color:' + theme.sub
        + ';text-transform:uppercase;letter-spacing:0.04em">' + t('diag.summary') + '</h3>';
    summaryWrap.appendChild(summaryHead);
    const summaryBody = document.createElement('div');
    summaryBody.innerHTML = '<div style="color:' + theme.subSoft + '">' + t('common.loading') + '</div>';
    summaryWrap.appendChild(summaryBody);
    root.appendChild(summaryWrap);

    const logHead = document.createElement('div');
    logHead.innerHTML = '<h3 style="margin:0 0 8px;font-size:13px;color:' + theme.sub
        + ';text-transform:uppercase;letter-spacing:0.04em">' + t('diag.recent') + '</h3>';
    root.appendChild(logHead);
    const logBody = document.createElement('div');
    logBody.innerHTML = '<div style="color:' + theme.subSoft + '">' + t('common.loading') + '</div>';
    root.appendChild(logBody);

    wrap.appendChild(root);

    const url = buildBaseUrl() + 'zabbix.php?action=network.topology.diag';
    fetch(url, {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.error) {
                summaryBody.innerHTML = '<div style="color:var(--nt-c-dc2626,#dc2626)">' + esc(data.error) + '</div>';
                logBody.innerHTML = '';
                return;
            }
            if (!data.apcu) {
                summaryBody.innerHTML = '<div style="color:#f59e0b">' + esc(t('diag.no_apcu')) + '</div>';
                logBody.innerHTML = '';
                return;
            }
            const entries = data.entries || [];
            summaryBody.innerHTML = _buildSummary(_aggStats(entries), theme);
            logBody.innerHTML     = _buildLog(entries, theme);
        })
        .catch(function(e) {
            summaryBody.innerHTML = '<div style="color:var(--nt-c-dc2626,#dc2626)">' + esc(t('diag.error', { msg: e.message })) + '</div>';
            logBody.innerHTML = '';
        });
}
