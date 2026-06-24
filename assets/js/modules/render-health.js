// render-health.js — Topology Health Score pro Hostgroup.
//
// Berechnet eine Gesamtbewertung 0-100 pro Hostgroup aus den aktuellen
// Node-Daten:
//   - Offline-Hosts:  Host laut Zabbix unavailable
//   - Stale-Hosts:    nicht offline, aber last_seen > 5 min alt
//   - Critical:       Severity >= 4 (High/Disaster)
//   - Unacked:        offene Probleme ohne Acknowledgement
//
// Score-Formel (gewichteter Abzug, clamp 0..100):
//   100 − offline%·40 − stale%·15 − critical%·25 − unacked%·20
//
// Rendern: Karten-Grid, sortiert nach worst Score zuerst. Jede Karte zeigt
// den Score gross + farbig (rot/orange/gelb/gruen) plus die Detail-Zahlen.

import { esc } from './utils.js';

const STALE_S = 300;
const COL_OK   = '#16a34a';   // 85-100
const COL_WARN = '#f59e0b';   // 65-85
const COL_BAD  = '#f97316';   // 40-65
const COL_CRIT = '#dc2626';   // <40

function _theme(dark) {
    return dark
        ? { bg:'#0d1117', surface:'#161b22', head:'#1c2128', text:'#e6edf3', sub:'#8b949e',
            subSoft:'#6e7681', border:'#30363d', borderSoft:'#21262d' }
        : { bg:'#ffffff', surface:'#f8fafc', head:'#f1f5f9', text:'#1f2c33', sub:'#64748b',
            subSoft:'#94a3b8', border:'#dfe4e7', borderSoft:'#eef2f5' };
}

function _scoreColor(s) {
    if (s >= 85) return COL_OK;
    if (s >= 65) return COL_WARN;
    if (s >= 40) return COL_BAD;
    return COL_CRIT;
}

function _scoreLabel(s) {
    if (s >= 85) return 'Gesund';
    if (s >= 65) return 'OK';
    if (s >= 40) return 'Achtung';
    return 'Kritisch';
}

// Stats pro Hostgroup aus den Nodes ableiten.
// Exportiert weil der Audit-Report (export.js) dieselbe Berechnung braucht.
export function statsByGroup(nodes) { return _statsByGroup(nodes); }
export function scoreColor(s)       { return _scoreColor(s); }
export function scoreLabel(s)       { return _scoreLabel(s); }

function _statsByGroup(nodes) {
    const now = Math.floor(Date.now() / 1000);
    const byGroup = {};
    (nodes || []).forEach(function(n) {
        if (n._isInternet) return;
        (n.groups || []).forEach(function(g) {
            if (!g) return;
            if (!byGroup[g]) byGroup[g] = {
                name: g, total: 0, offline: 0, stale: 0, critical: 0, unacked: 0,
                worstSev: 0, problems: 0
            };
            const s = byGroup[g];
            s.total++;
            const isOff = !!n.unavailable;
            if (isOff) s.offline++;
            const age = n.last_seen ? (now - n.last_seen) : 0;
            if (!isOff && n.last_seen > 0 && age > STALE_S) s.stale++;
            if ((n.severity || 0) >= 4) s.critical++;
            if ((n.problems || 0) > 0 && !n.acknowledged) s.unacked++;
            if ((n.severity || 0) > s.worstSev) s.worstSev = n.severity || 0;
            s.problems += (n.problems || 0);
        });
    });
    // Score berechnen
    Object.values(byGroup).forEach(function(s) {
        const t = Math.max(1, s.total);
        let score = 100
            - (s.offline  / t) * 40
            - (s.stale    / t) * 15
            - (s.critical / t) * 25
            - (s.unacked  / t) * 20;
        s.score = Math.max(0, Math.min(100, Math.round(score)));
    });
    return Object.values(byGroup);
}

// Eine einzelne Score-Karte.
function _card(s, theme) {
    const col = _scoreColor(s.score);
    const lbl = _scoreLabel(s.score);
    function metric(num, txt, color) {
        const c = num > 0 ? color : theme.subSoft;
        return '<div style="display:flex;flex-direction:column;align-items:center;min-width:46px">'
            + '<span style="font-size:18px;font-weight:700;color:' + c + ';font-family:monospace">'
            + num + '</span>'
            + '<span style="font-size:10px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.04em">'
            + esc(txt) + '</span>'
            + '</div>';
    }
    return '<div style="background:' + theme.surface + ';border:1px solid ' + theme.border
        + ';border-left:4px solid ' + col + ';border-radius:6px;padding:14px 16px;'
        + 'display:flex;align-items:center;gap:18px;min-width:380px">'
        // Score-Wert links
        + '<div style="display:flex;flex-direction:column;align-items:center;min-width:74px">'
        +   '<span style="font-size:34px;font-weight:700;color:' + col + ';line-height:1;font-family:monospace">'
        +     s.score + '</span>'
        +   '<span style="font-size:10px;color:' + col + ';font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-top:3px">'
        +     esc(lbl) + '</span>'
        + '</div>'
        // Name + Metriken
        + '<div style="flex:1;display:flex;flex-direction:column;gap:6px">'
        +   '<div style="font-size:13px;font-weight:700;color:' + theme.text + '">' + esc(s.name)
        +     ' <span style="font-weight:400;color:' + theme.sub + '">· ' + s.total + ' Hosts</span></div>'
        +   '<div style="display:flex;gap:14px">'
        +     metric(s.offline,  'Offline',  COL_CRIT)
        +     metric(s.stale,    'Stale',    COL_WARN)
        +     metric(s.critical, 'Critical', COL_CRIT)
        +     metric(s.unacked,  'Unacked',  COL_BAD)
        +     metric(s.problems, 'Probleme', theme.text)
        +   '</div>'
        + '</div>'
        + '</div>';
}

export function renderHealth(wrap, nodes) {
    if (window._ntCy)       { try { window._ntCy.destroy(); } catch (e) {} window._ntCy = null; }
    if (window._ntEdgeAnim) { clearInterval(window._ntEdgeAnim); window._ntEdgeAnim = null; }

    const dark = !!(document.getElementById('nt-root')
                 && document.getElementById('nt-root').classList.contains('nt-dark'));
    const theme = _theme(dark);

    Array.from(wrap.children).forEach(function(ch) {
        if (ch.id !== 'nt-loading') wrap.removeChild(ch);
    });

    const root = document.createElement('div');
    root.style.cssText = 'padding:20px;background:' + theme.bg + ';color:' + theme.text
        + ';height:100%;overflow:auto;font-family:sans-serif';

    const stats = _statsByGroup(nodes);
    // worst zuerst → niedrigster Score oben
    stats.sort(function(a, b) { return a.score - b.score; });

    if (stats.length === 0) {
        root.innerHTML = '<div style="color:' + theme.subSoft + ';padding:40px;text-align:center">'
            + 'Keine Hostgroups in den aktuellen Daten.</div>';
        wrap.appendChild(root);
        return;
    }

    // Aggregat-Header: Anzahl Gruppen, Min/Avg Score, Gesamt-Probleme
    const tot = stats.reduce(function(acc, s) {
        acc.score += s.score; acc.problems += s.problems;
        acc.minScore = Math.min(acc.minScore, s.score);
        return acc;
    }, { score: 0, problems: 0, minScore: 100 });
    const avg = Math.round(tot.score / stats.length);
    const head = document.createElement('div');
    head.style.marginBottom = '20px';
    head.innerHTML = '<h2 style="margin:0 0 8px;font-size:16px">Topology Health</h2>'
        + '<div style="font-size:12px;color:' + theme.sub + '">'
        +   stats.length + ' Gruppen · Ø Score <b style="color:' + _scoreColor(avg) + '">' + avg + '</b>'
        +   ' · Min Score <b style="color:' + _scoreColor(tot.minScore) + '">' + tot.minScore + '</b>'
        +   ' · ' + tot.problems + ' offene Probleme insgesamt'
        + '</div>';
    root.appendChild(head);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(380px, 1fr));gap:12px';
    grid.innerHTML = stats.map(function(s) { return _card(s, theme); }).join('');
    root.appendChild(grid);

    // Legende
    const legend = document.createElement('div');
    legend.style.cssText = 'margin-top:24px;padding-top:12px;border-top:1px solid ' + theme.border
        + ';font-size:11px;color:' + theme.sub + ';display:flex;gap:14px;flex-wrap:wrap';
    legend.innerHTML = ''
        + '<span><b style="color:' + COL_OK   + '">85-100</b> Gesund</span>'
        + '<span><b style="color:' + COL_WARN + '">65-85</b> OK</span>'
        + '<span><b style="color:' + COL_BAD  + '">40-65</b> Achtung</span>'
        + '<span><b style="color:' + COL_CRIT + '">&lt;40</b> Kritisch</span>'
        + '<span style="margin-left:auto">Formel: 100 − offline·40 − stale·15 − critical·25 − unacked·20 (% der Gruppe)</span>';
    root.appendChild(legend);

    wrap.appendChild(root);
}
