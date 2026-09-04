// render-compliance.js — Security/Compliance-Tab.
//
// Fetcht network.topology.compliance fuer die aktuell ausgewaehlten
// Hostgroups und zeigt:
//   - Aggregat-Header: Counter pro Check (klickbar → Host-Filter)
//   - Per-Host-Tabelle: ein Symbol pro Check + Host-Spalte
//
// Checks und ihre Semantik (Definition im Backend):
//   snmp_v2          schlecht  — SNMPv1/v2c (sollte v3 sein)
//   snmp_v3          neutral   — SNMPv3 erkannt (positiv markiert)
//   no_tls           schlecht  — Agent ohne TLS/PSK
//   no_proxy         info      — Host direkt am Server (kann gewollt sein)
//   no_inventory    info       — kein Inventory-Mode
//   no_location      info      — kein location_lat/lon
//   no_template      schlecht  — Host hat keinen Parent-Template
//   stale_problem    schlecht  — krit. Problem (sev>=4) > 7 Tage offen
//   mtnc_no_comment  info      — Maintenance aktiv aber description leer
//
// "schlecht" zaehlt fuer den UI-Filter "nur Issues", "info" und "neutral"
// nicht. Aggregat-Counter sind unabhaengig — zaehlen wie viele Hosts
// von einem Check betroffen sind.

import { esc, mkTabTheme, buildBaseUrl, isDark, clearWrap } from './utils.js';
import { t } from './i18n.js';

// Check-Definitionen (exportiert — der Audit-Report in export.js rendert
// dieselbe Tabelle und importiert sie von hier statt eigener Kopie).
export const COMPLIANCE_CHECKS = [
    { key: 'snmp_v2',         lbl: 'SNMP v1/v2c',     short: 'SNMP v2',  level: 'bad'  },
    { key: 'snmp_v3',         lbl: 'SNMP v3',          short: 'SNMP v3', level: 'good' },
    { key: 'no_tls',          lbl: t('compliance.check.no_tls'),   short: 'no TLS',  level: 'bad'  },
    { key: 'no_proxy',        lbl: t('compliance.check.no_proxy'),       short: 'no Proxy',level: 'info' },
    { key: 'no_inventory',    lbl: t('compliance.check.no_inventory'),    short: 'no Inv',  level: 'info' },
    { key: 'no_location',     lbl: t('compliance.check.no_location'),    short: 'no Loc',  level: 'info' },
    { key: 'no_template',     lbl: t('compliance.check.no_template'),    short: 'no Tpl',  level: 'bad'  },
    { key: 'stale_problem',   lbl: t('compliance.check.stale_problem'), short: 'stale', level: 'bad'  },
    { key: 'mtnc_no_comment', lbl: t('compliance.check.mtnc_no_comment'), short: 'mtnc?', level: 'info' },
];
const CHECKS = COMPLIANCE_CHECKS;

// Compliance-Daten vom Backend holen (exportiert — auch der Audit-Report
// nutzt diesen Fetch). null bei Fehler/fehlender Group-Auswahl.
export function fetchComplianceData() {
    const cfg = window.NT_CONFIG || {};
    const groupids = (cfg && cfg.selected_groupids) || [];
    if (!groupids.length) return Promise.resolve(null);
    const params = new URLSearchParams();
    params.append('action', 'network.topology.compliance');
    groupids.forEach(function(g) { params.append('groupids[]', String(g)); });
    const url = buildBaseUrl() + 'zabbix.php?' + params.toString();
    return fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function(r) { return r.json(); })
        .then(function(d) { return (d && !d.error) ? d : null; })
        .catch(function() { return null; });
}

const COL_GOOD = '#16a34a';
const COL_INFO = '#0891b2';
const COL_BAD  = '#dc2626';
const COL_NONE = '#cbd5e1';

function _checkColor(check) {
    return check.level === 'good' ? COL_GOOD
         : check.level === 'info' ? COL_INFO
         : COL_BAD;
}

function _checkSymbol(check, hit) {
    if (!hit) return '<span style="color:' + COL_NONE + '">·</span>';
    if (check.level === 'good') return '<span style="color:' + COL_GOOD + '">✓</span>';
    if (check.level === 'info') return '<span style="color:' + COL_INFO + '">i</span>';
    return '<span style="color:' + COL_BAD + ';font-weight:700">✗</span>';
}

function _aggregateCards(agg, total, theme, onlyIssues) {
    const cards = CHECKS.map(function(c) {
        const n = agg[c.key] || 0;
        const col = _checkColor(c);
        const pct = total > 0 ? Math.round(100 * n / total) : 0;
        return '<div style="background:' + theme.surface
            + ';border:1px solid ' + theme.border + ';border-radius:4px;padding:8px 10px;'
            + 'display:flex;flex-direction:column">'
            + '<div style="font-size:10px;color:' + theme.sub + ';text-transform:uppercase;'
            +   'letter-spacing:0.05em">' + esc(c.lbl) + '</div>'
            + '<div style="display:flex;align-items:baseline;gap:6px;margin-top:2px">'
            +   '<span style="font-size:20px;font-weight:700;color:' + (n > 0 ? col : theme.subSoft)
            +     ';font-family:monospace">' + n + '</span>'
            +   '<span style="font-size:11px;color:' + theme.sub + '">/ ' + total + '</span>'
            +   '<span style="font-size:10px;color:' + theme.subSoft + ';margin-left:auto">'
            +     pct + '%</span>'
            + '</div>'
            + '</div>';
    }).join('');

    const filterToggle = '<label style="display:inline-flex;align-items:center;gap:6px;'
        + 'font-size:12px;color:' + theme.sub + ';cursor:pointer;margin-left:auto">'
        + '<input type="checkbox" id="nt-compl-only-issues"' + (onlyIssues ? ' checked' : '') + '> '
        + esc(t('compl.only_issues')) + '</label>';

    return '<div style="display:flex;align-items:center;margin-bottom:8px">'
        + '<h3 style="margin:0;font-size:13px;color:' + theme.sub + ';text-transform:uppercase;'
        +   'letter-spacing:0.04em">' + esc(t('compl.aggregate', { n: total })) + '</h3>'
        + filterToggle
        + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));'
        +   'gap:8px;margin-bottom:18px">' + cards + '</div>';
}

function _hostTable(hosts, theme) {
    if (!hosts.length) {
        return '<div style="color:' + theme.subSoft + ';padding:20px 0">'
            + esc(t('compliance.no_match')) + '</div>';
    }
    let html = '<table style="border-collapse:collapse;font-size:12px;width:100%">'
        + '<thead><tr style="border-bottom:1px solid ' + theme.border + '">'
        + '<th style="padding:6px 12px;text-align:left;color:' + theme.sub + ';font-weight:600">Host</th>';
    CHECKS.forEach(function(c) {
        html += '<th title="' + esc(c.lbl) + '" style="padding:6px 8px;text-align:center;'
            + 'color:' + theme.sub + ';font-weight:600;writing-mode:vertical-rl;'
            + 'transform:rotate(180deg);white-space:nowrap;font-size:10px">'
            + esc(c.short) + '</th>';
    });
    html += '</tr></thead><tbody>';
    hosts.forEach(function(h) {
        html += '<tr style="border-bottom:1px solid ' + theme.borderSoft + '">'
            + '<td style="padding:5px 12px"><b>' + esc(h.label || h.host || '') + '</b></td>';
        CHECKS.forEach(function(c) {
            html += '<td style="padding:5px 8px;text-align:center;font-size:14px">'
                + _checkSymbol(c, !!h.checks[c.key]) + '</td>';
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
}

export function renderCompliance(wrap) {
    if (window._ntCy)       { try { window._ntCy.destroy(); } catch (e) {} window._ntCy = null; }
    if (window._ntEdgeAnim) { clearInterval(window._ntEdgeAnim); window._ntEdgeAnim = null; }

    const dark = isDark();
    const theme = mkTabTheme(dark);

    clearWrap(wrap);

    const root = document.createElement('div');
    root.style.cssText = 'padding:20px;background:' + theme.bg + ';color:' + theme.text
        + ';height:100%;overflow:auto;font-family:sans-serif';

    const head = document.createElement('div');
    head.innerHTML = '<h2 style="margin:0 0 6px;font-size:16px">Compliance</h2>'
        + '<div style="font-size:12px;color:' + theme.sub + ';margin-bottom:16px">'
        + esc(t('compliance.intro')) + '</div>';
    root.appendChild(head);

    const aggBox  = document.createElement('div');
    const tableBox = document.createElement('div');
    root.appendChild(aggBox);
    root.appendChild(tableBox);
    aggBox.innerHTML = '<div style="color:' + theme.subSoft + ';padding:20px">' + t('common.loading') + '</div>';

    wrap.appendChild(root);

    const cfg = window.NT_CONFIG || {};
    const groupids = (cfg && cfg.selected_groupids) || [];
    if (!groupids.length) {
        aggBox.innerHTML = '<div style="color:' + theme.subSoft + ';padding:20px">'
            + t('compliance.select_groups') + '</div>';
        return;
    }

    let _onlyIssues = false;

    fetchComplianceData()
        .then(function(data) {
            if (!data) {
                aggBox.innerHTML = '<div style="color:' + COL_BAD + '">'
                    + esc(t('compliance.unavailable')) + '</div>';
                return;
            }
            const allHosts = data.hosts || [];
            const agg      = data.aggregate || {};
            const total    = data.total || 0;

            function rerender() {
                aggBox.innerHTML = _aggregateCards(agg, total, theme, _onlyIssues);
                let filteredHosts = allHosts;
                if (_onlyIssues) {
                    // "bad"-Level-Checks: nur Hosts wo mindestens einer dieser hit ist
                    const badKeys = CHECKS.filter(function(c) { return c.level === 'bad'; })
                                          .map(function(c) { return c.key; });
                    filteredHosts = allHosts.filter(function(h) {
                        return badKeys.some(function(k) { return h.checks && h.checks[k]; });
                    });
                }
                // Sortierung: Hosts mit meisten bad-Hits zuerst
                const badKeys2 = CHECKS.filter(function(c) { return c.level === 'bad'; })
                                       .map(function(c) { return c.key; });
                filteredHosts.sort(function(a, b) {
                    const ba = badKeys2.reduce(function(n, k) { return n + (a.checks[k] ? 1 : 0); }, 0);
                    const bb = badKeys2.reduce(function(n, k) { return n + (b.checks[k] ? 1 : 0); }, 0);
                    return bb - ba || (a.label || '').localeCompare(b.label || '');
                });
                tableBox.innerHTML = _hostTable(filteredHosts, theme);

                // Toggle-Wiring
                const cb = document.getElementById('nt-compl-only-issues');
                if (cb) cb.addEventListener('change', function() {
                    _onlyIssues = this.checked;
                    rerender();
                });
            }
            rerender();
        })
        .catch(function(e) {
            aggBox.innerHTML = '<div style="color:' + COL_BAD + '">'
                    + esc(t('compliance.error', { msg: e.message })) + '</div>';
        });
}
