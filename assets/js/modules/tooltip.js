// tooltip.js — Floating-Tooltip mit Live-Werten und CPU/Ping-Sparklines.
//
// Der Tooltip wird einmalig beim Modul-Load ins document.body gehängt und
// dann via show/hide/move gesteuert. Sparkline-Daten werden lazy nachgeladen
// (über die NetworkTopologySpark-PHP-Action) und im _sparkCache gehalten.
//
// State (Modul-privat):
//   _tip          — das gemeinsame DOM-Element
//   _sparkCache   — hostid -> {cpu:[...], ping:[...], since, ts}
//   _sparkPending — hostid -> true, verhindert parallele Fetches

import { esc, fmt, fmtItemValue } from './utils.js';

const _tip = document.createElement('div');
_tip.id = 'nt-ring-tip';
_tip.style.cssText = 'display:none;position:fixed;z-index:99998;background:#fff;border:1px solid #e2e8f0;'
    + 'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.12);padding:10px 14px;font-size:12px;'
    + 'font-family:sans-serif;pointer-events:none;min-width:160px;';
document.body.appendChild(_tip);

const _sparkCache   = {};
const _sparkPending = {};

function fetchSparkData(hostid, d, onDone) {
    const now = Date.now();
    const cached = _sparkCache[hostid];
    if (cached && (now - cached.ts) < 60000) { onDone(cached); return; }
    if (_sparkPending[hostid]) return;
    _sparkPending[hostid] = true;

    const cfg = window.NT_CONFIG;
    if (!cfg || !cfg.data_url) { delete _sparkPending[hostid]; return; }
    const sparkUrl = cfg.data_url.replace('network.topology.v6.data', 'network.topology.v6.spark')
        + '&hostids%5B%5D=' + encodeURIComponent(hostid);

    fetch(sparkUrl, { credentials: 'same-origin', headers: {'X-Requested-With': 'XMLHttpRequest'} })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            const h = data[String(hostid)] || {};
            const result = {
                cpu:   h.cpu   || [],
                ping:  h.ping  || [],
                since: h.since || null,
                ts:    now
            };
            _sparkCache[hostid] = result;
            delete _sparkPending[hostid];
            onDone(result);
        })
        .catch(function() {
            // Fallback: aktuellen Wert als Pseudo-Verlauf
            const result = {
                cpu:   d && d.cpu  != null ? Array(12).fill(d.cpu  || 0) : [],
                ping:  d && d.ping != null ? Array(12).fill(d.ping || 0) : [],
                since: null, ts: now
            };
            _sparkCache[hostid] = result;
            delete _sparkPending[hostid];
            onDone(result);
        });
}

function drawSparkline(values, color, width, height) {
    if (!values || !values.length) return '';
    const w = width || 80, h = height || 24;
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const range = Math.max(max - min, 1);
    const step = w / (values.length - 1 || 1);
    const pts = values.map(function(v, i) {
        return (i * step).toFixed(1) + ',' + (h - ((v - min) / range * (h - 2) + 1)).toFixed(1);
    }).join(' ');
    return '<svg width="' + w + '" height="' + h + '" style="vertical-align:middle;flex-shrink:0">'
        + '<polyline points="' + pts + '" fill="none" stroke="' + color
        + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>'
        + '<circle cx="' + (values.length - 1) * step + '" cy="'
        + (h - ((values[values.length - 1] - min) / range * (h - 2) + 1)).toFixed(1)
        + '" r="2" fill="' + color + '"/>'
        + '</svg>';
}

export function showTip(evt, d) {
    const traffic = d.traffic || { in: 0, out: 0 };

    function bar(pct) {
        const filled = Math.round((pct || 0) / 100 * 8);
        return '<span style="color:#334155;font-family:monospace">'
            + '\u2588'.repeat(Math.max(0, filled))
            + '<span style="opacity:0.2">' + '\u2588'.repeat(Math.max(0, 8 - filled)) + '</span></span>';
    }

    const rows = [
        { col: '#3b82f6', lbl: 'CPU',     val: d.cpu    != null ? bar(d.cpu)    + ' <b>' + d.cpu    + '%</b>' : '<span style="color:#94a3b8">\u2014</span>' },
        { col: '#8b5cf6', lbl: 'Memory',  val: d.memory != null ? bar(d.memory) + ' <b>' + d.memory + '%</b>' : '<span style="color:#94a3b8">\u2014</span>' },
        { col: '#22c55e', lbl: 'Traffic', val: '<b>\u2193 ' + fmt(traffic.in) + '</b>  <b>\u2191 ' + fmt(traffic.out) + '</b>' },
        { col: '#f59e0b', lbl: 'Ping',    val: d.ping > 0       ? '<b>' + d.ping + ' ms</b>' : '<span style="color:#94a3b8">\u2014</span>' },
    ];

    function buildHtml(spark) {
        const sparkCpu  = spark ? drawSparkline(spark.cpu,  '#3b82f6', 72, 22) : '';
        const sparkPing = spark ? drawSparkline(spark.ping, '#f59e0b', 72, 22) : '';
        const ipLine = d.ip
            ? '<div style="font-size:10px;color:#64748b;font-family:monospace;margin-top:2px">&#128279; ' + esc(d.ip) + '</div>'
            : '';
        // Status-Pillen (Wartung, Acked) wenn relevant
        const pills = [];
        if (d.maintenance) pills.push('<span style="display:inline-block;background:#fef3c7;color:#92400e;'
            + 'padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;margin-right:4px">'
            + '\u{1F527} Wartung</span>');
        if (d.acknowledged) pills.push('<span style="display:inline-block;background:#dcfce7;color:#166534;'
            + 'padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;margin-right:4px">'
            + '\u2714 Acked</span>');
        const pillLine = pills.length
            ? '<div style="margin-top:3px">' + pills.join('') + '</div>'
            : '';
        return '<div style="font-weight:700;font-size:11px;color:#0f172a;margin-bottom:7px;padding-bottom:5px;border-bottom:1px solid #f1f5f9">'
            + esc(d.label) + ipLine + pillLine + '</div>'
            + rows.map(function(r, i) {
                let sparkEl = '';
                if (spark) {
                    if (i === 0 && sparkCpu)  sparkEl = '<span style="margin-left:auto">' + sparkCpu  + '</span>';
                    if (i === 3 && sparkPing) sparkEl = '<span style="margin-left:auto">' + sparkPing + '</span>';
                }
                return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'
                    + '<span style="width:8px;height:8px;border-radius:50%;background:' + r.col + ';flex-shrink:0;display:inline-block"></span>'
                    + '<span style="color:#64748b;width:48px;flex-shrink:0">' + r.lbl + '</span>'
                    + '<span style="flex:1">' + r.val + '</span>'
                    + sparkEl
                    + '</div>';
            }).join('')
            // Extra-Items aus nt:show-Tags — eigener Block unter den Standard-Zeilen
            + (d.extra_items && d.extra_items.length ? (function() {
                const items = d.extra_items.map(function(it) {
                    const lblShort = esc((it.name || '').substring(0, 28));
                    const val = it.error
                        ? '<span style="color:#94a3b8;font-style:italic">' + esc(it.error) + '</span>'
                        : '<b>' + esc(fmtItemValue(it.value, it.units)) + '</b>';
                    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;font-size:10px">'
                        + '<span style="width:8px;height:8px;border-radius:50%;background:#06b6d4;flex-shrink:0"></span>'
                        + '<span style="color:#64748b;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(it.name || '') + '">' + lblShort + '</span>'
                        + '<span style="flex-shrink:0">' + val + '</span>'
                        + '</div>';
                }).join('');
                return '<div style="margin-top:5px;padding-top:5px;border-top:1px solid #f1f5f9">' + items + '</div>';
            })() : '')
            + (spark && spark.since ? (function() {
                const elapsed = Math.floor(Date.now() / 1000) - spark.since;
                const hh = Math.floor(elapsed / 3600);
                const mm = Math.floor((elapsed % 3600) / 60);
                const dd = Math.floor(hh / 24);
                const sinceStr = dd > 0 ? dd + 'd ' + Math.floor(hh % 24) + 'h'
                              : (hh > 0 ? hh + 'h ' + mm + 'm' : mm + 'm');
                return '<div style="font-size:10px;color:#f59e0b;margin-top:5px;padding-top:4px;border-top:1px solid #f1f5f9">'
                    + '\u23F1 Problem seit: <b>' + sinceStr + '</b></div>';
            })() : '')
            + (spark ? '' : '<div style="font-size:9px;color:#cbd5e1;margin-top:4px">\u231B Lade Verlauf...</div>');
    }

    _tip.style.width = '240px';
    _tip.innerHTML = buildHtml(null);
    _tip.style.display = 'block';
    moveTip(evt);

    // Sparkline async nachladen
    if (d.id && (d.cpu != null || d.ping != null)) {
        fetchSparkData(String(d.id), d, function(spark) {
            if (_tip.style.display === 'block') {
                _tip.innerHTML = buildHtml(spark);
            }
        });
    }
}

export function moveTip(evt) {
    const x = evt.originalEvent ? evt.originalEvent.clientX : (evt.clientX || 0);
    const y = evt.originalEvent ? evt.originalEvent.clientY : (evt.clientY || 0);
    const tw = _tip.offsetWidth || 180;
    const th = _tip.offsetHeight || 120;
    const wx = window.innerWidth, wy = window.innerHeight;
    _tip.style.left = (x + 14 + tw > wx ? x - tw - 8 : x + 14) + 'px';
    _tip.style.top  = (y + 14 + th > wy ? y - th - 8 : y + 14) + 'px';
}

export function hideTip() {
    _tip.style.display = 'none';
}
