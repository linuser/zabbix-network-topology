// render-stats.js — Wochen-/Monatsuebersicht aus dem History-Backend.
//
// Holt fuer einen waehlbaren Zeitraum (7d/14d/30d) die Problem-Events aus
// network.topology.history und aggregiert sie:
//   - Tagesbalken (Bar-Chart, SVG)
//   - Top 10 Hosts mit den meisten Events
//   - Top 10 Trigger-Namen mit den meisten Events
//   - Aggregat-Header: Events gesamt, distinct Hosts/Trigger, Range
//
// Backend-Limit: MAX_EVENTS=50000, MAX_RANGE_SECONDS=31d. Wenn truncated,
// zeigen wir einen Hinweis. "Pre"-Events (vor Range-Start bereits offen)
// werden ausgeklammert — sie zaehlen nicht als neue Events.

import { esc, mkTabTheme, buildBaseUrl, fmt, linkCapacity, isDark, clearWrap } from './utils.js';
import { t } from './i18n.js';

const RANGES = [
    { lbl: t('stats.range_days', { n: 7 }),  days: 7 },
    { lbl: t('stats.range_days', { n: 14 }), days: 14 },
    { lbl: t('stats.range_days', { n: 30 }), days: 30 },
];
const DEFAULT_DAYS = 7;

const SEV_COLORS = ['#22c55e', '#06b6d4', '#f59e0b', '#f97316', '#ef4444', '#991b1b'];
const SEV_LBL    = ['Normal', 'Info', 'Warning', 'Average', 'High', 'Disaster'];

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
            const tname = e.name || t('stats.unnamed');
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
             + esc(t('stats.chart.empty')) + '</div>';
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
        return '<div style="color:' + theme.subSoft + ';font-style:italic">' + esc(t('stats.no_data')) + '</div>';
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

    const dark = isDark();
    const theme = mkTabTheme(dark);

    clearWrap(wrap);

    // Host-Lookup-Map (id → {label, host}) damit Top-Hosts den Namen kennen
    const hostMeta = {};
    (nodes || []).forEach(function(n) { hostMeta[String(n.id)] = n; });

    const root = document.createElement('div');
    root.style.cssText = 'padding:20px;background:' + theme.bg + ';color:' + theme.text
        + ';height:100%;overflow:auto;font-family:sans-serif';

    const head = document.createElement('div');
    head.innerHTML = '<h2 style="margin:0 0 6px;font-size:16px">' + esc(t('stats.title')) + '</h2>'
        + '<div style="font-size:12px;color:' + theme.sub + ';margin-bottom:14px">'
        + esc(t('stats.desc'))
        + '</div>';
    root.appendChild(head);

    // Range-Selector
    const rangeWrap = document.createElement('div');
    rangeWrap.style.cssText = 'display:flex;gap:6px;margin-bottom:16px;align-items:center';
    const rangeLbl = document.createElement('span');
    rangeLbl.textContent = t('stats.period');
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
    aggHead.textContent = t('stats.loading');
    root.appendChild(aggHead);

    const chartBox = document.createElement('div');
    chartBox.style.cssText = 'margin-bottom:24px;overflow:auto';
    root.appendChild(chartBox);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:24px';
    const hostsBox = document.createElement('div');
    const trigBox  = document.createElement('div');
    hostsBox.innerHTML = '<h3 style="margin:0 0 8px;font-size:13px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.04em">' + esc(t('stats.top_hosts')) + '</h3>'
        + '<div data-slot="hosts" style="color:' + theme.subSoft + '">…</div>';
    trigBox.innerHTML  = '<h3 style="margin:0 0 8px;font-size:13px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.04em">' + esc(t('stats.top_triggers')) + '</h3>'
        + '<div data-slot="triggers" style="color:' + theme.subSoft + '">…</div>';
    grid.appendChild(hostsBox);
    grid.appendChild(trigBox);
    root.appendChild(grid);

    // ── Kapazitaets-Forecast (Zabbix-Trends × Weathermap-Kapazitaeten) ────
    const fcRoot = document.createElement('div');
    fcRoot.style.cssText = 'margin-top:28px;padding-top:18px;border-top:1px solid ' + theme.border;
    fcRoot.innerHTML = '<h3 style="margin:0 0 4px;font-size:13px;color:' + theme.sub
        + ';text-transform:uppercase;letter-spacing:0.04em">' + esc(t('fc.title')) + '</h3>'
        + '<div style="font-size:11px;color:' + theme.subSoft + ';margin-bottom:10px;max-width:760px">'
        + esc(t('fc.caveat')) + '</div>';
    const fcCtl = document.createElement('div');
    fcCtl.style.cssText = 'display:flex;gap:6px;margin-bottom:12px;align-items:center';
    const fcLbl = document.createElement('span');
    fcLbl.textContent = t('fc.period');
    fcLbl.style.cssText = 'font-size:12px;color:' + theme.sub + ';font-weight:600;margin-right:4px';
    fcCtl.appendChild(fcLbl);
    let _fcDays = 30;
    const fcBtns = [];
    [30, 60, 90].forEach(function(d) {
        const b = document.createElement('button');
        b.textContent = d + ' ' + t('fc.days_unit');
        b.dataset.days = String(d);
        b.style.cssText = 'padding:4px 10px;border:1px solid ' + theme.border + ';'
            + 'border-radius:4px;background:' + theme.surface + ';color:' + theme.text + ';'
            + 'cursor:pointer;font-size:12px;font-family:inherit';
        if (d === _fcDays) {
            b.style.background = theme.accent;
            b.style.color = '#fff';
            b.style.borderColor = theme.accent;
        }
        b.addEventListener('click', function() {
            _fcDays = d;
            fcBtns.forEach(function(fb) {
                const on = fb.dataset.days == d;
                fb.style.background  = on ? theme.accent : theme.surface;
                fb.style.color       = on ? '#fff' : theme.text;
                fb.style.borderColor = on ? theme.accent : theme.border;
            });
            loadForecast();
            loadResourceForecast();
        });
        fcBtns.push(b);
        fcCtl.appendChild(b);
    });
    const fcStatus = document.createElement('div');
    fcStatus.style.cssText = 'font-size:12px;color:' + theme.sub + ';margin-bottom:8px';
    const fcSlot = document.createElement('div');
    fcRoot.appendChild(fcCtl);
    fcRoot.appendChild(fcStatus);
    fcRoot.appendChild(fcSlot);
    root.appendChild(fcRoot);

    // ── Host-Ressourcen-Forecast (CPU-%/Memory-%) — teilt den Zeitraum-
    // Selektor oben mit dem Link-Forecast (_fcDays).
    const rfRoot = document.createElement('div');
    rfRoot.style.cssText = 'margin-top:24px;padding-top:16px;border-top:1px solid ' + theme.border;
    rfRoot.innerHTML = '<h3 style="margin:0 0 4px;font-size:13px;color:' + theme.sub
        + ';text-transform:uppercase;letter-spacing:0.04em">' + esc(t('rf.title')) + '</h3>'
        + '<div style="font-size:11px;color:' + theme.subSoft + ';margin-bottom:10px;max-width:760px">'
        + esc(t('rf.caveat')) + '</div>';
    const rfStatus = document.createElement('div');
    rfStatus.style.cssText = 'font-size:12px;color:' + theme.sub + ';margin-bottom:8px';
    const rfSlot = document.createElement('div');
    rfRoot.appendChild(rfStatus);
    rfRoot.appendChild(rfSlot);
    root.appendChild(rfRoot);

    wrap.appendChild(root);

    let _seq = 0;
    function loadAndRender() {
        const cfg = window.NT_CONFIG || {};
        const groupids = (cfg && cfg.selected_groupids) || [];
        const now = Math.floor(Date.now() / 1000);
        const from = now - _days * 86400;
        const params = new URLSearchParams();
        params.append('action', 'network.topology.history');
        params.append('from', String(from));
        params.append('to',   String(now));
        groupids.forEach(function(g) { params.append('groupids[]', String(g)); });
        const url = buildBaseUrl() + 'zabbix.php?' + params.toString();
        aggHead.textContent = t('stats.loading_events', { days: _days });
        chartBox.innerHTML = '';
        hostsBox.querySelector('[data-slot="hosts"]').textContent = '…';
        trigBox.querySelector('[data-slot="triggers"]').textContent = '…';

        const seq = ++_seq;
        fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (seq !== _seq) return;   // outdated response
                if (data.error) {
                    aggHead.innerHTML = '<span style="color:#dc2626">' + esc(t('stats.error', { msg: data.error })) + '</span>';
                    return;
                }
                const agg = aggregate(data, hostMeta);
                const fromStr = new Date(agg.from * 1000).toLocaleDateString('de-DE');
                const toStr   = new Date(agg.to   * 1000).toLocaleDateString('de-DE');
                // Platzhalter-Werte duerfen HTML enthalten (<b>-Tags) — nur
                // eigene Zahlen bzw. via esc() escapte Datums-Strings.
                aggHead.innerHTML = t('stats.agg_summary', {
                        events:   '<b>' + agg.totalEvents + '</b>',
                        hosts:    '<b>' + agg.distinctHosts + '</b>',
                        triggers: '<b>' + agg.distinctTriggers + '</b>',
                        from:     esc(fromStr),
                        to:       esc(toStr),
                    })
                    + (agg.truncated ? ' &middot; <span style="color:#f59e0b">' + esc(t('stats.truncated')) + '</span>' : '');
                chartBox.innerHTML = buildDayChart(agg, theme);
                hostsBox.querySelector('[data-slot="hosts"]').innerHTML = buildTopTable(
                    agg.topHosts, theme,
                    [esc(t('stats.col.host')), esc(t('stats.col.events')), esc(t('stats.col.worst'))],
                    function(r) {
                        return [
                            esc(r.label),
                            { text: r.count, style: 'text-align:right;font-family:monospace;font-weight:600' },
                            { text: '<span style="color:' + SEV_COLORS[r.worstSev] + '">' + SEV_LBL[r.worstSev] + '</span>' },
                        ];
                    });
                trigBox.querySelector('[data-slot="triggers"]').innerHTML = buildTopTable(
                    agg.topTriggers, theme,
                    [esc(t('stats.col.trigger')), esc(t('stats.col.events')), esc(t('stats.col.hosts')), esc(t('stats.col.worst'))],
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
                aggHead.innerHTML = '<span style="color:#dc2626">' + esc(t('stats.error', { msg: e.message })) + '</span>';
            });
    }

    loadAndRender();

    // ── Kapazitaets-Forecast: Links mit bekannter Kapazitaet einsammeln,
    // Trends vom Backend regressen lassen, Edge-ETA bis zur 80%-Schwelle
    // rechnen. Edge-Semantik wie die Live-Anzeige: beide Endpunkte zaehlen
    // dieselben Bytes → (A+B)/2; fehlt eine Seite, ist deren Wert allein
    // die beste Schaetzung (ohne Halbierung).
    let _fcSeq = 0;
    function loadForecast() {
        const d = window._ntLastData || {};
        const nodesArr = d.nodes || nodes || [];
        const speed = {}, labelOf = {};
        nodesArr.forEach(function(n) {
            speed[String(n.id)]   = n.link_speed || 0;
            labelOf[String(n.id)] = n.label || n.host || String(n.id);
        });
        const links = [], seenE = {};
        (d.edges || []).forEach(function(e) {
            const a = String(e.source || e.from || ''), b = String(e.target || e.to || '');
            if (!a || !b || a === b) return;
            const k = [a, b].sort().join('|');
            if (seenE[k]) return;
            seenE[k] = true;
            const cap = linkCapacity(speed[a] || 0, speed[b] || 0);
            if (cap > 0) links.push({ a: a, b: b, cap: cap });
        });
        if (links.length === 0) {
            fcStatus.textContent = '';
            fcSlot.innerHTML = '<div style="color:' + theme.subSoft + ';font-style:italic;font-size:12px">'
                + esc(t('fc.nolinks')) + '</div>';
            return;
        }
        const hostSet = {};
        links.forEach(function(l) { hostSet[l.a] = true; hostSet[l.b] = true; });

        const cfg = window.NT_CONFIG || {};
        const params = new URLSearchParams();
        params.append('action', 'network.topology.capacity_forecast');
        params.append('days', String(_fcDays));
        ((cfg && cfg.selected_groupids) || []).forEach(function(g) { params.append('groupids[]', String(g)); });
        Object.keys(hostSet).forEach(function(h) { params.append('hostids[]', h); });

        fcStatus.textContent = t('fc.loading', { days: _fcDays });
        fcSlot.innerHTML = '';
        const seq = ++_fcSeq;
        fetch(buildBaseUrl() + 'zabbix.php?' + params.toString(),
              { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (seq !== _fcSeq || !fcSlot.isConnected) return;
                if (data.error) {
                    fcStatus.innerHTML = '<span style="color:#dc2626">' + esc(data.error) + '</span>';
                    return;
                }
                renderForecast(links, labelOf, data.hosts || {});
            })
            .catch(function(e) {
                if (seq !== _fcSeq) return;
                fcStatus.innerHTML = '<span style="color:#dc2626">' + esc(e.message) + '</span>';
            });
    }

    function renderForecast(links, labelOf, fcHosts) {
        const rows = [];
        links.forEach(function(l) {
            const fa = fcHosts[l.a] || null, fb = fcHosts[l.b] || null;
            if (!fa && !fb) return;
            function dir(key) {
                const A = fa && fa[key], B = fb && fb[key];
                if (A && B) return { now: (A.now + B.now) / 2, slope: (A.slope + B.slope) / 2 };
                return A || B || null;
            }
            const din = dir('in'), dout = dir('out');
            if (!din && !dout) return;
            const nowMax  = Math.max(din ? din.now : 0, dout ? dout.now : 0);
            const target  = 0.8 * l.cap;
            let eta = null, etaSlope = null;
            [din, dout].forEach(function(dd) {
                if (!dd) return;
                let e = null;
                if (dd.now >= target) e = 0;
                else if (dd.slope > 0) e = (target - dd.now) / dd.slope / 86400;
                if (e !== null && (eta === null || e < eta)) { eta = e; etaSlope = dd.slope; }
            });
            const domSlope = (etaSlope !== null) ? etaSlope
                : Math.max(din ? din.slope : -Infinity, dout ? dout.slope : -Infinity);
            rows.push({
                label:  (labelOf[l.a] || l.a) + ' ↔ ' + (labelOf[l.b] || l.b),
                cap:    l.cap,
                util:   nowMax / l.cap * 100,
                weekPP: isFinite(domSlope) ? domSlope * 604800 / l.cap * 100 : 0,
                eta:    eta,
            });
        });
        if (rows.length === 0) {
            fcStatus.textContent = '';
            fcSlot.innerHTML = '<div style="color:' + theme.subSoft + ';font-style:italic;font-size:12px">'
                + esc(t('fc.nodata')) + '</div>';
            return;
        }
        // Kritischste zuerst: frueheste 80%-ETA, dann hoechste Auslastung.
        rows.sort(function(a, b) {
            if ((a.eta === null) !== (b.eta === null)) return a.eta === null ? 1 : -1;
            if (a.eta !== null && b.eta !== null && a.eta !== b.eta) return a.eta - b.eta;
            return b.util - a.util;
        });
        fcStatus.textContent = t('fc.summary', { links: rows.length, days: _fcDays });
        const shown = rows.slice(0, 20);
        fcSlot.innerHTML = buildTopTable(shown, theme,
            [esc(t('fc.col.link')), esc(t('fc.col.cap')), esc(t('fc.col.util')),
             esc(t('fc.col.trend')), esc(t('fc.col.eta'))],
            function(r) {
                return [
                    esc(r.label),
                    { text: esc(fmt(r.cap)), style: 'font-family:monospace;white-space:nowrap' },
                    { text: '<b style="color:' + _utilColor(r.util) + '">' + r.util.toFixed(1) + '%</b>',
                      style: 'text-align:right;font-family:monospace' },
                    { text: (r.weekPP >= 0 ? '+' : '') + r.weekPP.toFixed(2) + ' pp',
                      style: 'text-align:right;font-family:monospace;color:'
                          + (r.weekPP > 0.5 ? '#f97316' : theme.sub) },
                    _etaCell(r.eta),
                ];
            })
            + (rows.length > shown.length
                ? '<div style="font-size:11px;color:' + theme.subSoft + ';margin-top:6px">'
                    + esc(t('fc.more', { n: rows.length - shown.length })) + '</div>'
                : '');
    }

    // Farbstufen grob analog Weathermap-Skala.
    function _utilColor(u) {
        if (u < 40) return '#16a34a';
        if (u < 55) return '#eab308';
        if (u < 70) return '#f59e0b';
        if (u < 85) return '#f97316';
        return '#dc2626';
    }

    function _etaCell(eta) {
        if (eta === null) {
            return { text: '<span style="color:' + theme.subSoft + '">' + esc(t('fc.eta.stable')) + '</span>' };
        }
        if (eta <= 0.5) {
            return { text: '<b style="color:#dc2626">' + esc(t('fc.eta.now')) + '</b>' };
        }
        const days = Math.round(eta);
        if (days > 365) {
            return { text: '<span style="color:' + theme.subSoft + '">' + esc(t('fc.eta.gt1y')) + '</span>' };
        }
        const col = days <= 30 ? '#dc2626' : (days <= 90 ? '#f97316' : '#ca8a04');
        return { text: '<b style="color:' + col + '">' + esc(t('fc.eta.days', { d: days })) + '</b>' };
    }

    // ETA-Zelle fuer Ressourcen (Schwelle im now-Text generisch statt "80 %").
    function _rfEtaCell(eta) {
        if (eta === null) {
            return { text: '<span style="color:' + theme.subSoft + '">' + esc(t('fc.eta.stable')) + '</span>' };
        }
        if (eta <= 0.5) {
            return { text: '<b style="color:#dc2626">' + esc(t('rf.eta.now')) + '</b>' };
        }
        const days = Math.round(eta);
        if (days > 365) {
            return { text: '<span style="color:' + theme.subSoft + '">' + esc(t('fc.eta.gt1y')) + '</span>' };
        }
        const col = days <= 30 ? '#dc2626' : (days <= 90 ? '#f97316' : '#ca8a04');
        return { text: '<b style="color:' + col + '">' + esc(t('fc.eta.days', { d: days })) + '</b>' };
    }

    // ── Host-Ressourcen-Forecast: CPU-%/Memory-% Trends → ETA bis Saettigung.
    // Schwellen: Memory 90 %, CPU 85 %. Hosts serverseitig aus den Gruppen
    // abgeleitet (kein Client-hostids → bounded Cache).
    const RF_MEM_TH = 90, RF_CPU_TH = 85;
    let _rfSeq = 0;
    function loadResourceForecast() {
        const cfg = window.NT_CONFIG || {};
        const groupids = (cfg && cfg.selected_groupids) || [];
        if (groupids.length === 0) {
            rfStatus.textContent = '';
            rfSlot.innerHTML = '<div style="color:' + theme.subSoft + ';font-style:italic;font-size:12px">'
                + esc(t('rf.nogroups')) + '</div>';
            return;
        }
        const params = new URLSearchParams();
        params.append('action', 'network.topology.resource_forecast');
        params.append('days', String(_fcDays));
        groupids.forEach(function(g) { params.append('groupids[]', String(g)); });

        rfStatus.textContent = t('fc.loading', { days: _fcDays });
        rfSlot.innerHTML = '';
        const seq = ++_rfSeq;
        fetch(buildBaseUrl() + 'zabbix.php?' + params.toString(),
              { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (seq !== _rfSeq || !rfSlot.isConnected) return;
                if (data.error) {
                    rfStatus.innerHTML = '<span style="color:#dc2626">' + esc(data.error) + '</span>';
                    return;
                }
                renderResourceForecast(data.hosts || {});
            })
            .catch(function(e) {
                if (seq !== _rfSeq) return;
                rfStatus.innerHTML = '<span style="color:#dc2626">' + esc(e.message) + '</span>';
            });
    }

    function _etaTo(metric, threshold) {
        if (!metric) return null;
        if (metric.now >= threshold) return 0;
        if (metric.slope > 0) return (threshold - metric.now) / metric.slope / 86400;
        return null;
    }

    function renderResourceForecast(rfHosts) {
        const rows = [];
        Object.keys(rfHosts).forEach(function(hid) {
            const h = rfHosts[hid];
            if (!h || (!h.cpu && !h.mem)) return;
            const memEta = _etaTo(h.mem, RF_MEM_TH);
            const cpuEta = _etaTo(h.cpu, RF_CPU_TH);
            let soon = null;
            [memEta, cpuEta].forEach(function(e) {
                if (e !== null && (soon === null || e < soon)) soon = e;
            });
            rows.push({
                label:   h.label || hid,
                mem:     h.mem || null,
                cpu:     h.cpu || null,
                // slope ist %/s → *604800 = Prozentpunkte/Woche
                memWeek: h.mem ? h.mem.slope * 604800 : null,
                memEta:  memEta,
                cpuEta:  cpuEta,
                soon:    soon,
            });
        });
        if (rows.length === 0) {
            rfStatus.textContent = '';
            rfSlot.innerHTML = '<div style="color:' + theme.subSoft + ';font-style:italic;font-size:12px">'
                + esc(t('rf.nodata')) + '</div>';
            return;
        }
        // Kritischste zuerst: frueheste Saettigung, dann hoechster Ist-Wert.
        rows.sort(function(a, b) {
            if ((a.soon === null) !== (b.soon === null)) return a.soon === null ? 1 : -1;
            if (a.soon !== null && b.soon !== null && a.soon !== b.soon) return a.soon - b.soon;
            const am = Math.max(a.mem ? a.mem.now : 0, a.cpu ? a.cpu.now : 0);
            const bm = Math.max(b.mem ? b.mem.now : 0, b.cpu ? b.cpu.now : 0);
            return bm - am;
        });
        rfStatus.textContent = t('rf.summary', { hosts: rows.length, days: _fcDays });
        const dash = '<span style="color:' + theme.subSoft + '">—</span>';
        function pct(m) {
            if (!m) return { text: dash, style: 'text-align:right' };
            return { text: '<b style="color:' + _utilColor(m.now) + '">' + m.now.toFixed(0) + '%</b>',
                     style: 'text-align:right;font-family:monospace' };
        }
        const shown = rows.slice(0, 20);
        rfSlot.innerHTML = buildTopTable(shown, theme,
            [esc(t('rf.col.host')), esc(t('rf.col.mem')), esc(t('rf.col.mem_week')),
             esc(t('rf.col.mem_eta')), esc(t('rf.col.cpu')), esc(t('rf.col.cpu_eta'))],
            function(r) {
                return [
                    esc(r.label),
                    pct(r.mem),
                    (r.memWeek === null
                        ? { text: dash, style: 'text-align:right' }
                        : { text: (r.memWeek >= 0 ? '+' : '') + r.memWeek.toFixed(2) + ' pp',
                            style: 'text-align:right;font-family:monospace;color:'
                                + (r.memWeek > 0.3 ? '#f97316' : theme.sub) }),
                    _rfEtaCell(r.memEta),
                    pct(r.cpu),
                    _rfEtaCell(r.cpuEta),
                ];
            })
            + (rows.length > shown.length
                ? '<div style="font-size:11px;color:' + theme.subSoft + ';margin-top:6px">'
                    + esc(t('rf.more', { n: rows.length - shown.length })) + '</div>'
                : '');
    }

    loadForecast();
    loadResourceForecast();
}
