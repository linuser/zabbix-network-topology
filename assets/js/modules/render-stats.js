// render-stats.js — Wochen-/Monatsuebersicht aus dem History-Backend.
//
// Holt fuer einen waehlbaren Zeitraum (7d/14d/30d) die Problem-Events aus
// network.topology.v6.history und aggregiert sie:
//   - Tagesbalken (Bar-Chart, SVG)
//   - Top 10 Hosts mit den meisten Events
//   - Top 10 Trigger-Namen mit den meisten Events
//   - Aggregat-Header: Events gesamt, distinct Hosts/Trigger, Range
//
// Backend-Limit: MAX_EVENTS=50000, MAX_RANGE_SECONDS=31d. Wenn truncated,
// zeigen wir einen Hinweis. "Pre"-Events (vor Range-Start bereits offen)
// werden ausgeklammert — sie zaehlen nicht als neue Events.

import { esc } from './utils.js';

const RANGES = [
    { lbl: '7 Tage',  days: 7 },
    { lbl: '14 Tage', days: 14 },
    { lbl: '30 Tage', days: 30 },
];
const DEFAULT_DAYS = 7;

const SEV_COLORS = ['#22c55e', '#06b6d4', '#f59e0b', '#f97316', '#ef4444', '#991b1b'];
const SEV_LBL    = ['Normal', 'Info', 'Warning', 'Average', 'High', 'Disaster'];

function _theme(dark) {
    return dark
        ? { bg:'#0d1117', surface:'#161b22', text:'#e6edf3', sub:'#8b949e',
            subSoft:'#6e7681', border:'#30363d', borderSoft:'#21262d', accent:'#0275b8' }
        : { bg:'#ffffff', surface:'#f8fafc', text:'#1f2c33', sub:'#64748b',
            subSoft:'#94a3b8', border:'#dfe4e7', borderSoft:'#eef2f5', accent:'#0275b8' };
}

function buildBaseUrl() {
    return window.location.pathname.replace('zabbix.php', '');
}

// Aggregation: nimm das Backend-Format { events: {hostid: [{ts,sev,name,val,pre?}]}, from, to }
// und baue daraus die drei Statistiken (perDay, perHost, perTrigger).
function aggregate(data, hostMeta) {
    const events = data.events || {};
    const from = data.from || 0;
    const to   = data.to   || 0;
    const dayMs = 86400;
    const dayCount = Math.max(1, Math.ceil((to - from) / dayMs));
    const dayStart = from;
    const perDay = new Array(dayCount).fill(0);
    const perDaySev = [];   // per Day: { sev -> count }
    for (let i = 0; i < dayCount; i++) perDaySev.push({});
    const perHost = {};
    const perTrigger = {};
    let totalEvents = 0;
    let worstSev = 0;

    Object.keys(events).forEach(function(hid) {
        const list = events[hid] || [];
        list.forEach(function(e) {
            if (e.pre) return;            // "war schon offen vor Range" — nicht zaehlen
            if (e.val === 0) return;      // val=0 = OK-Event (Recovery), nur Problem-Events zaehlen
            totalEvents++;
            const sev = e.sev || 0;
            if (sev > worstSev) worstSev = sev;
            const di = Math.min(dayCount - 1, Math.max(0, Math.floor((e.ts - dayStart) / dayMs)));
            perDay[di]++;
            perDaySev[di][sev] = (perDaySev[di][sev] || 0) + 1;
            if (!perHost[hid]) perHost[hid] = { count: 0, worstSev: 0 };
            perHost[hid].count++;
            perHost[hid].worstSev = Math.max(perHost[hid].worstSev, sev);
            const tname = e.name || '(unbenannt)';
            if (!perTrigger[tname]) perTrigger[tname] = { count: 0, worstSev: 0, hosts: {} };
            perTrigger[tname].count++;
            perTrigger[tname].worstSev = Math.max(perTrigger[tname].worstSev, sev);
            perTrigger[tname].hosts[hid] = true;
        });
    });

    // Top-Listen
    const topHosts = Object.keys(perHost).map(function(hid) {
        return { id: hid, label: (hostMeta[hid] && (hostMeta[hid].label || hostMeta[hid].host)) || ('hostid:' + hid),
                 count: perHost[hid].count, worstSev: perHost[hid].worstSev };
    }).sort(function(a, b) { return b.count - a.count || b.worstSev - a.worstSev; }).slice(0, 10);

    const topTriggers = Object.keys(perTrigger).map(function(name) {
        return { name: name, count: perTrigger[name].count, worstSev: perTrigger[name].worstSev,
                 hostCount: Object.keys(perTrigger[name].hosts).length };
    }).sort(function(a, b) { return b.count - a.count || b.worstSev - a.worstSev; }).slice(0, 10);

    return {
        from: from, to: to, dayCount: dayCount, perDay: perDay, perDaySev: perDaySev,
        totalEvents: totalEvents, worstSev: worstSev,
        distinctHosts: Object.keys(perHost).length,
        distinctTriggers: Object.keys(perTrigger).length,
        topHosts: topHosts, topTriggers: topTriggers,
        truncated: !!data.truncated,
    };
}

// SVG-Bar-Chart fuer die Tagesbalken. Severity-stacked: pro Tag von unten
// nach oben Sev 0..5 gestapelt.
function buildDayChart(agg, theme) {
    if (agg.dayCount === 0 || agg.totalEvents === 0) {
        return '<div style="color:' + theme.subSoft + ';font-style:italic;padding:20px 0">'
             + 'Keine Events im gewaehlten Zeitraum.</div>';
    }
    const W = 720, H = 180, padL = 38, padR = 12, padT = 12, padB = 28;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const maxV = Math.max.apply(null, agg.perDay) || 1;
    const barW = innerW / agg.dayCount;
    const niceMax = Math.pow(10, Math.floor(Math.log10(maxV))) * Math.ceil(maxV / Math.pow(10, Math.floor(Math.log10(maxV))));

    // Y-Achse: 3 Hilfslinien
    let grid = '';
    for (let i = 1; i <= 3; i++) {
        const y = padT + innerH - (innerH * i / 3);
        const v = Math.round(niceMax * i / 3);
        grid += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y
              + '" stroke="' + theme.borderSoft + '" stroke-width="1"/>'
              + '<text x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end" '
              + 'font-family="monospace" font-size="9" fill="' + theme.sub + '">' + v + '</text>';
    }

    // Bars: pro Tag Severity-stacked
    let bars = '';
    for (let d = 0; d < agg.dayCount; d++) {
        const x = padL + d * barW;
        let yCursor = padT + innerH;
        const sevMap = agg.perDaySev[d] || {};
        // Stack von Sev 0 → 5 (unten gruen, oben rot)
        [0, 1, 2, 3, 4, 5].forEach(function(sev) {
            const v = sevMap[sev] || 0;
            if (v === 0) return;
            const h = (v / niceMax) * innerH;
            yCursor -= h;
            bars += '<rect x="' + (x + 1) + '" y="' + yCursor + '" width="' + (barW - 2) + '" height="' + h
                  + '" fill="' + SEV_COLORS[sev] + '" opacity="0.92">'
                  + '<title>' + SEV_LBL[sev] + ': ' + v + '</title></rect>';
        });
    }

    // X-Achse: nur erste, mittlere, letzte Datum-Beschriftung
    function dayLabel(idx) {
        const ts = (agg.from + idx * 86400) * 1000;
        const d = new Date(ts);
        return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2);
    }
    const labelXs = [0, Math.floor(agg.dayCount / 2), agg.dayCount - 1];
    let xlabels = '';
    labelXs.forEach(function(idx) {
        if (idx < 0 || idx >= agg.dayCount) return;
        const cx = padL + idx * barW + barW / 2;
        xlabels += '<text x="' + cx + '" y="' + (H - 10) + '" text-anchor="middle" '
                 + 'font-family="monospace" font-size="9" fill="' + theme.sub + '">' + dayLabel(idx) + '</text>';
    });

    // Legende rechts oben
    let legend = '';
    SEV_LBL.forEach(function(lbl, i) {
        const lx = padL + i * 60;
        legend += '<rect x="' + lx + '" y="' + 4 + '" width="9" height="9" fill="' + SEV_COLORS[i] + '"/>'
                + '<text x="' + (lx + 12) + '" y="' + 12 + '" font-size="9" fill="' + theme.sub + '">' + lbl + '</text>';
    });

    return '<svg width="' + W + '" height="' + H + '" style="display:block">'
         + grid + bars + xlabels + '</svg>'
         + '<div style="margin-top:4px">'
         + '<svg width="' + W + '" height="18">' + legend + '</svg>'
         + '</div>';
}

function buildTopTable(rows, theme, headers, cellsFn) {
    if (rows.length === 0) {
        return '<div style="color:' + theme.subSoft + ';font-style:italic">Keine Daten.</div>';
    }
    return '<table style="border-collapse:collapse;font-size:12px;width:100%">'
        + '<thead><tr style="border-bottom:1px solid ' + theme.border + '">'
        + headers.map(function(h) {
            return '<th style="padding:6px 10px;text-align:left;color:' + theme.sub + ';font-weight:600">' + h + '</th>';
        }).join('')
        + '</tr></thead><tbody>'
        + rows.map(function(r) {
            return '<tr style="border-bottom:1px solid ' + theme.borderSoft + '">'
                + cellsFn(r).map(function(c) {
                    if (c && typeof c === 'object') {
                        return '<td style="padding:4px 10px;' + (c.style || '') + '">' + c.text + '</td>';
                    }
                    return '<td style="padding:4px 10px">' + c + '</td>';
                }).join('')
                + '</tr>';
        }).join('')
        + '</tbody></table>';
}

export function renderStats(wrap, nodes) {
    if (window._ntCy)         { try { window._ntCy.destroy(); } catch (e) {} window._ntCy = null; }
    if (window._ntEdgeAnim)   { clearInterval(window._ntEdgeAnim); window._ntEdgeAnim = null; }

    const dark = !!(document.getElementById('nt-root')
                 && document.getElementById('nt-root').classList.contains('nt-dark'));
    const theme = _theme(dark);

    Array.from(wrap.children).forEach(function(ch) {
        if (ch.id !== 'nt-loading') wrap.removeChild(ch);
    });

    // Host-Lookup-Map (id → {label, host}) damit Top-Hosts den Namen kennen
    const hostMeta = {};
    (nodes || []).forEach(function(n) { hostMeta[String(n.id)] = n; });

    const root = document.createElement('div');
    root.style.cssText = 'padding:20px;background:' + theme.bg + ';color:' + theme.text
        + ';height:100%;overflow:auto;font-family:sans-serif';

    const head = document.createElement('div');
    head.innerHTML = '<h2 style="margin:0 0 6px;font-size:16px">Statistik</h2>'
        + '<div style="font-size:12px;color:' + theme.sub + ';margin-bottom:14px">'
        + 'Problem-Events aus dem History-Backend, aggregiert pro Tag. '
        + 'Recovery-Events und "war schon offen vor Range" werden nicht gezaehlt.'
        + '</div>';
    root.appendChild(head);

    // Range-Selector
    const rangeWrap = document.createElement('div');
    rangeWrap.style.cssText = 'display:flex;gap:6px;margin-bottom:16px;align-items:center';
    const rangeLbl = document.createElement('span');
    rangeLbl.textContent = 'Zeitraum:';
    rangeLbl.style.cssText = 'font-size:12px;color:' + theme.sub + ';font-weight:600;margin-right:4px';
    rangeWrap.appendChild(rangeLbl);
    let _days = DEFAULT_DAYS;
    const rangeBtns = [];
    RANGES.forEach(function(r) {
        const b = document.createElement('button');
        b.textContent = r.lbl;
        b.style.cssText = 'padding:4px 10px;border:1px solid ' + theme.border + ';'
            + 'border-radius:4px;background:' + theme.surface + ';color:' + theme.text + ';'
            + 'cursor:pointer;font-size:12px;font-family:inherit';
        b.addEventListener('click', function() {
            _days = r.days;
            rangeBtns.forEach(function(rb) {
                rb.style.background  = rb.dataset.days == r.days ? theme.accent : theme.surface;
                rb.style.color       = rb.dataset.days == r.days ? '#fff' : theme.text;
                rb.style.borderColor = rb.dataset.days == r.days ? theme.accent : theme.border;
            });
            loadAndRender();
        });
        b.dataset.days = String(r.days);
        if (r.days === DEFAULT_DAYS) {
            b.style.background = theme.accent;
            b.style.color = '#fff';
            b.style.borderColor = theme.accent;
        }
        rangeBtns.push(b);
        rangeWrap.appendChild(b);
    });
    root.appendChild(rangeWrap);

    const aggHead = document.createElement('div');
    aggHead.style.cssText = 'font-size:12px;color:' + theme.sub + ';margin-bottom:10px';
    aggHead.textContent = 'Laedt...';
    root.appendChild(aggHead);

    const chartBox = document.createElement('div');
    chartBox.style.cssText = 'margin-bottom:24px;overflow:auto';
    root.appendChild(chartBox);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:24px';
    const hostsBox = document.createElement('div');
    const trigBox  = document.createElement('div');
    hostsBox.innerHTML = '<h3 style="margin:0 0 8px;font-size:13px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.04em">Top 10 Hosts</h3>'
        + '<div data-slot="hosts" style="color:' + theme.subSoft + '">…</div>';
    trigBox.innerHTML  = '<h3 style="margin:0 0 8px;font-size:13px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.04em">Top 10 Probleme</h3>'
        + '<div data-slot="triggers" style="color:' + theme.subSoft + '">…</div>';
    grid.appendChild(hostsBox);
    grid.appendChild(trigBox);
    root.appendChild(grid);

    wrap.appendChild(root);

    let _seq = 0;
    function loadAndRender() {
        const cfg = window.NT_CONFIG || {};
        const groupids = (cfg && cfg.selected_groupids) || [];
        const now = Math.floor(Date.now() / 1000);
        const from = now - _days * 86400;
        const params = new URLSearchParams();
        params.append('action', 'network.topology.v6.history');
        params.append('from', String(from));
        params.append('to',   String(now));
        groupids.forEach(function(g) { params.append('groupids[]', String(g)); });
        const url = buildBaseUrl() + 'zabbix.php?' + params.toString();
        aggHead.textContent = 'Lade ' + _days + ' Tage Events...';
        chartBox.innerHTML = '';
        hostsBox.querySelector('[data-slot="hosts"]').textContent = '…';
        trigBox.querySelector('[data-slot="triggers"]').textContent = '…';

        const seq = ++_seq;
        fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (seq !== _seq) return;   // outdated response
                if (data.error) {
                    aggHead.innerHTML = '<span style="color:#dc2626">Fehler: ' + esc(data.error) + '</span>';
                    return;
                }
                const agg = aggregate(data, hostMeta);
                const fromStr = new Date(agg.from * 1000).toLocaleDateString('de-DE');
                const toStr   = new Date(agg.to   * 1000).toLocaleDateString('de-DE');
                aggHead.innerHTML = '<b>' + agg.totalEvents + '</b> Events &middot; '
                    + '<b>' + agg.distinctHosts + '</b> Hosts &middot; '
                    + '<b>' + agg.distinctTriggers + '</b> Trigger &middot; '
                    + esc(fromStr) + ' – ' + esc(toStr)
                    + (agg.truncated ? ' &middot; <span style="color:#f59e0b">Achtung: Backend-Limit erreicht</span>' : '');
                chartBox.innerHTML = buildDayChart(agg, theme);
                hostsBox.querySelector('[data-slot="hosts"]').innerHTML = buildTopTable(
                    agg.topHosts, theme,
                    ['Host', 'Events', 'Worst'],
                    function(r) {
                        return [
                            esc(r.label),
                            { text: r.count, style: 'text-align:right;font-family:monospace;font-weight:600' },
                            { text: '<span style="color:' + SEV_COLORS[r.worstSev] + '">' + SEV_LBL[r.worstSev] + '</span>' },
                        ];
                    });
                trigBox.querySelector('[data-slot="triggers"]').innerHTML = buildTopTable(
                    agg.topTriggers, theme,
                    ['Trigger', 'Events', 'Hosts', 'Worst'],
                    function(r) {
                        return [
                            esc(r.name),
                            { text: r.count, style: 'text-align:right;font-family:monospace;font-weight:600' },
                            { text: r.hostCount, style: 'text-align:right;font-family:monospace' },
                            { text: '<span style="color:' + SEV_COLORS[r.worstSev] + '">' + SEV_LBL[r.worstSev] + '</span>' },
                        ];
                    });
            })
            .catch(function(e) {
                if (seq !== _seq) return;
                aggHead.innerHTML = '<span style="color:#dc2626">Fehler: ' + esc(e.message) + '</span>';
            });
    }

    loadAndRender();
}
