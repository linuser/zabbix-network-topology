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
// Dieselbe Formel steht ES5-konform in widget_health/assets/js/widget.class.js
// (die Widget-Loader kennen keine ES-Module). tools/check-parity.mjs vergleicht
// Gewichte und Schwellen beider Stellen und bricht die CI ab, wenn sie
// auseinanderlaufen — sonst zeigte dieselbe Hostgroup auf Karte und Dashboard
// verschiedene Scores.
//
// Rendern: Karten-Grid, sortiert nach worst Score zuerst. Jede Karte zeigt
// den Score gross + farbig (rot/orange/gelb/gruen) plus die Detail-Zahlen.

import { esc, mkTabTheme, buildBaseUrl } from './utils.js';
import { t } from './i18n.js';

const STALE_S = 300;
const COL_OK   = '#16a34a';   // 85-100
const COL_WARN = '#f59e0b';   // 65-85
const COL_BAD  = '#f97316';   // 40-65
const COL_CRIT = '#dc2626';   // <40

function _scoreColor(s) {
    if (s >= 85) return COL_OK;
    if (s >= 65) return COL_WARN;
    if (s >= 40) return COL_BAD;
    return COL_CRIT;
}

function _scoreLabel(s) {
    if (s >= 85) return t('health.lbl.healthy');
    if (s >= 65) return t('health.lbl.ok');
    if (s >= 40) return t('health.lbl.warn');
    return t('health.lbl.critical');
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
        return '<div style="display:flex;flex-direction:column;align-items:center;min-width:42px">'
            + '<span style="font-size:17px;font-weight:700;color:' + c + ';font-family:monospace">'
            + num + '</span>'
            + '<span style="font-size:9px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.03em">'
            + esc(txt) + '</span>'
            + '</div>';
    }
    // Layout-Rechnung: Score 74 + gap 14 + 5 Metriken à >=42 + 4 gaps à 8
    // + Padding 28 ≈ 380px — passt in die minmax(400px)-Grid-Spalte. Die
    // Metrik-Zeile hat zusaetzlich flex-wrap als Sicherheitsnetz fuer lange
    // Zahlen (z.B. 4-stellige Problem-Counts), statt rechts aus der Karte
    // zu laufen.
    return '<div style="background:' + theme.surface + ';border:1px solid ' + theme.border
        + ';border-left:4px solid ' + col + ';border-radius:6px;padding:12px 14px;'
        + 'display:flex;align-items:center;gap:14px;min-width:0;overflow:hidden">'
        // Score-Wert links
        + '<div style="display:flex;flex-direction:column;align-items:center;min-width:70px;flex-shrink:0">'
        +   '<span style="font-size:34px;font-weight:700;color:' + col + ';line-height:1;font-family:monospace">'
        +     s.score + '</span>'
        +   '<span style="font-size:10px;color:' + col + ';font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-top:3px">'
        +     esc(lbl) + '</span>'
        + '</div>'
        // Name + Metriken
        + '<div style="flex:1;display:flex;flex-direction:column;gap:6px;min-width:0">'
        +   '<div style="font-size:13px;font-weight:700;color:' + theme.text
        +     ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(s.name) + '">'
        +     esc(s.name)
        +     ' <span style="font-weight:400;color:' + theme.sub + '">· ' + s.total + ' ' + esc(t('health.hosts')) + '</span></div>'
        +   '<div style="display:flex;gap:8px;flex-wrap:wrap">'
        +     metric(s.offline,  t('health.m.offline'),  COL_CRIT)
        +     metric(s.stale,    t('health.m.stale'),    COL_WARN)
        +     metric(s.critical, t('health.m.critical'), COL_CRIT)
        +     metric(s.unacked,  t('health.m.unacked'),  COL_BAD)
        +     metric(s.problems, t('health.m.problems'), theme.text)
        +   '</div>'
        + '</div>'
        + '</div>';
}

// ── Score-Historie ─────────────────────────────────────────────────────────
// Verlaufs-Chart aus den Trapper-Items nt.health.score / .min, die der
// Sender-Cron fuellt (tools/topo-change-sender.sh + Template
// nt_health_score_template.yaml). Nicht eingerichtet → dezenter Hinweis.

const HIST_DAYS = 14;

function _loadScoreHistory(box, theme) {
    const params = new URLSearchParams();
    params.append('action', 'network.topology.health_history');
    params.append('days', String(HIST_DAYS));
    fetch(buildBaseUrl() + 'zabbix.php?' + params.toString(),
          { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!box.isConnected) return;
            if (data.error || !data.item_found || !(data.avg || []).length) {
                box.innerHTML = '<div style="font-size:11px;color:' + theme.subSoft + '">'
                    + esc(t('health.hist.hint')) + '</div>';
                return;
            }
            box.innerHTML = _histChart(data, theme);
        })
        .catch(function() { /* Historie ist Nice-to-have */ });
}

function _histChart(data, theme) {
    const avg = data.avg, mn = data.min || [];
    const W = 720, H = 110, padL = 30, padR = 8, padT = 8, padB = 18;
    const iw = W - padL - padR, ih = H - padT - padB;
    const from = avg[0][0];
    const to   = avg[avg.length - 1][0];
    const span = Math.max(1, to - from);
    function pts(series) {
        return series.map(function(p) {
            const x = padL + (p[0] - from) / span * iw;
            const v = Math.max(0, Math.min(100, p[1]));
            const y = padT + ih * (1 - v / 100);
            return x.toFixed(1) + ',' + y.toFixed(1);
        }).join(' ');
    }
    // Schwellen-Linien bei 40/65/85 — gleiche Grenzen wie die Karten-Farben.
    let grid = '';
    [[85, COL_OK], [65, COL_WARN], [40, COL_BAD]].forEach(function(g) {
        const y = padT + ih * (1 - g[0] / 100);
        grid += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y
              + '" stroke="' + g[1] + '" stroke-width="0.5" opacity="0.45" stroke-dasharray="3 3"/>'
              + '<text x="' + (padL - 5) + '" y="' + (y + 3) + '" text-anchor="end" font-size="8" '
              + 'font-family="monospace" fill="' + theme.sub + '">' + g[0] + '</text>';
    });
    function dlbl(ts) {
        const d = new Date(ts * 1000);
        return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.';
    }
    const lastAvg = Math.round(avg[avg.length - 1][1]);
    // Platzhalter darf HTML enthalten (farbiges <b>) — eigene Zahl, kein User-Input.
    const title = t('health.hist.title', {
        days: data.days || HIST_DAYS,
        avg:  '<b style="color:' + _scoreColor(lastAvg) + '">' + lastAvg + '</b>',
    });
    let svg = '<svg width="' + W + '" height="' + H + '" style="display:block">' + grid
        + '<polyline fill="none" stroke="' + theme.accent + '" stroke-width="1.8" points="' + pts(avg) + '"/>';
    if (mn.length) {
        svg += '<polyline fill="none" stroke="' + COL_CRIT + '" stroke-width="1.2" '
             + 'stroke-dasharray="4 3" opacity="0.7" points="' + pts(mn) + '"/>';
    }
    svg += '<text x="' + padL + '" y="' + (H - 5) + '" font-size="9" font-family="monospace" fill="'
         + theme.sub + '">' + dlbl(from) + '</text>'
         + '<text x="' + (W - padR) + '" y="' + (H - 5) + '" text-anchor="end" font-size="9" '
         + 'font-family="monospace" fill="' + theme.sub + '">' + dlbl(to) + '</text>'
         + '</svg>';
    let leg = '<div style="font-size:10px;color:' + theme.sub + ';display:flex;gap:12px;margin-top:2px">'
        + '<span><span style="display:inline-block;width:14px;height:2px;background:' + theme.accent
        + ';vertical-align:middle;margin-right:4px"></span>' + esc(t('health.hist.avg')) + '</span>';
    if (mn.length) {
        leg += '<span><span style="display:inline-block;width:14px;height:2px;background:' + COL_CRIT
             + ';opacity:0.7;vertical-align:middle;margin-right:4px"></span>' + esc(t('health.hist.min')) + '</span>';
    }
    leg += '</div>';
    return '<div style="font-size:12px;color:' + theme.sub + ';margin-bottom:4px">' + title + '</div>'
        + '<div style="overflow-x:auto">' + svg + leg + '</div>';
}

export function renderHealth(wrap, nodes) {
    if (window._ntCy)       { try { window._ntCy.destroy(); } catch (e) {} window._ntCy = null; }
    if (window._ntEdgeAnim) { clearInterval(window._ntEdgeAnim); window._ntEdgeAnim = null; }

    const dark = !!(document.getElementById('nt-root')
                 && document.getElementById('nt-root').classList.contains('nt-dark'));
    const theme = mkTabTheme(dark);

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
            + esc(t('health.empty')) + '</div>';
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
    // Platzhalter-Werte duerfen HTML enthalten (farbige <b>) — sie kommen
    // ausschliesslich aus eigenen Zahlen/Farb-Konstanten, kein User-Input.
    head.innerHTML = '<h2 style="margin:0 0 8px;font-size:16px">' + esc(t('health.title')) + '</h2>'
        + '<div style="font-size:12px;color:' + theme.sub + '">'
        + t('health.summary', {
            groups:   stats.length,
            avg:      '<b style="color:' + _scoreColor(avg) + '">' + avg + '</b>',
            min:      '<b style="color:' + _scoreColor(tot.minScore) + '">' + tot.minScore + '</b>',
            problems: tot.problems,
        })
        + '</div>';
    root.appendChild(head);

    // Score-Verlauf (async — Hinweis oder Chart, je nach Sender-Setup)
    const hist = document.createElement('div');
    hist.style.cssText = 'margin-bottom:18px';
    root.appendChild(hist);
    _loadScoreHistory(hist, theme);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(380px, 1fr));gap:12px';
    grid.innerHTML = stats.map(function(s) { return _card(s, theme); }).join('');
    root.appendChild(grid);

    // Legende
    const legend = document.createElement('div');
    legend.style.cssText = 'margin-top:24px;padding-top:12px;border-top:1px solid ' + theme.border
        + ';font-size:11px;color:' + theme.sub + ';display:flex;gap:14px;flex-wrap:wrap';
    legend.innerHTML = ''
        + '<span><b style="color:' + COL_OK   + '">85-100</b> ' + esc(t('health.legend.healthy'))  + '</span>'
        + '<span><b style="color:' + COL_WARN + '">65-85</b> '  + esc(t('health.legend.ok'))       + '</span>'
        + '<span><b style="color:' + COL_BAD  + '">40-65</b> '  + esc(t('health.legend.warn'))     + '</span>'
        + '<span><b style="color:' + COL_CRIT + '">&lt;40</b> ' + esc(t('health.legend.critical')) + '</span>'
        + '<span style="margin-left:auto">' + esc(t('health.legend.formula')) + '</span>';
    root.appendChild(legend);

    wrap.appendChild(root);
}
