// render-diag.js — Admin-Diagnose-Tab.
//
// Zeigt die letzten ~50 Backend-Aufrufe (Data/History/Items/Discover/Spark)
// aus dem APCu-Ring-Buffer pro User: elapsed_ms, bytes, cache_hit, Counts.
// Plus eine Summary mit Avg/Max-Latenz pro Action und Cache-Hit-Rate.
//
// Nur sichtbar fuer Admins (NT_CONFIG.can_edit). Backend prueft das nochmal,
// aber wir blenden den Tab im Frontend gleich aus.

import { esc, el, mkTabTheme, buildBaseUrl, isDark, clearWrap } from './utils.js';
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
            ? '<span style="color:#16a34a">HIT</span>'
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

/**
 * Link auf die Releases-Seite. Die URL kommt aus der Antwort und ist damit
 * fremder Text — die Action laesst nur https://github.com/… durch, hier
 * landet sie ueber setAttribute statt in einer HTML-Zeichenkette.
 */
function releaseLink(url, theme) {
    const a = document.createElement('a');
    a.setAttribute('href', String(url || 'https://github.com/linuser/zabbix-network-topology/releases'));
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.style.color = theme.accent;
    a.textContent = t('diag.update.open');
    return a;
}

export function renderDiag(wrap) {
    if (window._ntCy)         { try { window._ntCy.destroy(); } catch (e) {} window._ntCy = null; }
    if (window._ntEdgeAnim)   { clearInterval(window._ntEdgeAnim);     window._ntEdgeAnim     = null; }

    const dark = isDark();
    const theme = mkTabTheme(dark);

    clearWrap(wrap);

    const root = document.createElement('div');
    root.style.cssText = 'padding:20px;background:' + theme.bg + ';color:' + theme.text
        + ';height:100%;overflow:auto;font-family:sans-serif';

    const head = document.createElement('div');
    head.innerHTML = '<h2 style="margin:0 0 6px;font-size:16px">' + t('diag.title') + '</h2>'
        + '<div style="font-size:12px;color:' + theme.sub + ';margin-bottom:18px">'
        + t('diag.intro')
        + '</div>';
    root.appendChild(head);

    // ── "Gibt es ein Update?" ──────────────────────────────────────────
    //
    // Auf Knopfdruck, nie von allein. Der Klick ist die Einwilligung: ein
    // Modul, das ungefragt nach Hause telefoniert, ist in vielen Haeusern
    // ein Richtlinienverstoss, und in einem abgeschotteten Netz eine
    // Abfrage, die ins Leere laeuft. Deshalb steht hier ein Knopf und kein
    // Hintergrundtakt — und deshalb ist "nicht erreichbar" hier eine
    // Antwort und keine Fehlermeldung.
    //
    // Der Abschnitt liegt im Diag-Tab, weil den ohnehin nur Super-Admins
    // sehen — und nur wer das Modul austauschen kann, soll den Hinweis
    // bekommen.
    const updWrap = document.createElement('div');
    updWrap.style.marginBottom = '24px';
    // Ueberschrift ueber el(): der Text geht durch textContent. Die
    // Nachbarabschnitte dieses Tabs setzen innerHTML, das ist Bestand —
    // neue Stellen kommen ohne aus, sonst waechst die ESLint-Baseline.
    updWrap.appendChild(el('h3',
        'margin:0 0 8px;font-size:13px;color:' + theme.sub
        + ';text-transform:uppercase;letter-spacing:0.04em',
        t('diag.update.title')));
    const updRow = document.createElement('div');
    updRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    const updBtn = document.createElement('button');
    updBtn.type = 'button';
    updBtn.textContent = t('diag.update.check');
    updBtn.style.cssText = 'padding:4px 12px;border:1px solid ' + theme.border
        + ';border-radius:4px;background:' + theme.surface + ';color:' + theme.text
        + ';font-size:12px;font-family:inherit;cursor:pointer';
    const updOut = document.createElement('div');
    updOut.style.cssText = 'font-size:12px;color:' + theme.sub;
    updOut.textContent = t('diag.update.idle');
    updRow.appendChild(updBtn);
    updRow.appendChild(updOut);
    updWrap.appendChild(updRow);
    root.appendChild(updWrap);

    updBtn.addEventListener('click', function() {
        updBtn.disabled = true;
        updOut.textContent = t('diag.update.checking');
        fetch(buildBaseUrl() + 'zabbix.php?action=network.topology.update_check', {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                updBtn.disabled = false;
                // Kein Unterschied zwischen DNS, Firewall, Proxy und einem
                // Fehler bei GitHub: fuer den Fragenden ist die Antwort
                // dieselbe, und Innenleben hilft ihm nicht weiter.
                while (updOut.firstChild) updOut.removeChild(updOut.firstChild);
                if (d.error === 'unreachable' || d.error === 'unreadable') {
                    updOut.appendChild(document.createTextNode(t('diag.update.unreachable') + ' '));
                    updOut.appendChild(releaseLink(d.url, theme));
                    return;
                }
                if (d.error) {
                    updOut.textContent = String(d.error);
                    return;
                }
                if (d.newer) {
                    updOut.appendChild(el('b', '', t('diag.update.available', { v: d.latest || '?' })));
                    updOut.appendChild(document.createTextNode(
                        ' ' + t('diag.update.you_have', { v: d.current || '?' })
                        + (d.published ? ' \u00b7 ' + d.published : '') + ' '));
                    updOut.appendChild(releaseLink(d.url, theme));
                }
                else {
                    updOut.textContent = t('diag.update.current', { v: d.current || '?' });
                }
            })
            .catch(function() {
                updBtn.disabled = false;
                updOut.textContent = t('diag.update.unreachable');
            });
    });

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
                summaryBody.innerHTML = '<div style="color:#dc2626">' + esc(data.error) + '</div>';
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
            summaryBody.innerHTML = '<div style="color:#dc2626">' + esc(t('diag.error', { msg: e.message })) + '</div>';
            logBody.innerHTML = '';
        });
}
