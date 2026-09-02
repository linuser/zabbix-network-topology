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

import { esc, fmt, fmtItemValue, isDark } from './utils.js';
import { utilizationColor, utilizationPct } from './traffic.js';
import { t } from './i18n.js';

// The tooltip is attached to <body>, not inside #nt-root: it inherits neither
// the color tokens nor the dark class. .nt-float brings the tokens along
// (network-topology.css), _syncTheme() applies the dark class when shown.
// color MUST be set explicitly — without it the tooltip inherited the text
// color of the Zabbix body, in the Zabbix dark theme near-white on the white
// tooltip (the values were unreadable).
const _tip = document.createElement('div');
_tip.id = 'nt-ring-tip';
_tip.className = 'nt-float';
_tip.style.cssText = 'display:none;position:fixed;z-index:99998;background:var(--nt-surface);'
    + 'border:1px solid var(--nt-line);color:var(--nt-text-2);'
    + 'border-radius:8px;box-shadow:var(--nt-shadow);padding:10px 14px;font-size:12px;'
    + 'font-family:sans-serif;pointer-events:none;min-width:160px;';
document.body.appendChild(_tip);

function _syncTheme() {
    _tip.classList.toggle('nt-dark', isDark());
}

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
    const sparkUrl = cfg.data_url.replace('network.topology.data', 'network.topology.spark')
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
        return '<span style="color:var(--nt-text-2);font-family:monospace">'
            + '\u2588'.repeat(Math.max(0, filled))
            + '<span style="opacity:0.2">' + '\u2588'.repeat(Math.max(0, 8 - filled)) + '</span></span>';
    }

    const rows = [
        { col: '#3b82f6', lbl: 'CPU',     val: d.cpu    != null ? bar(d.cpu)    + ' <b>' + d.cpu    + '%</b>' : '<span style="color:var(--nt-muted)">\u2014</span>' },
        { col: '#8b5cf6', lbl: 'Memory',  val: d.memory != null ? bar(d.memory) + ' <b>' + d.memory + '%</b>' : '<span style="color:var(--nt-muted)">\u2014</span>' },
        { col: '#22c55e', lbl: 'Traffic', val: '<b>\u2193 ' + fmt(traffic.in) + '</b>  <b>\u2191 ' + fmt(traffic.out) + '</b>' },
        { col: '#f59e0b', lbl: 'Ping',    val: d.ping > 0       ? '<b>' + d.ping + ' ms</b>' : '<span style="color:var(--nt-muted)">\u2014</span>' },
    ];

    function buildHtml(spark) {
        const sparkCpu  = spark ? drawSparkline(spark.cpu,  '#3b82f6', 72, 22) : '';
        const sparkPing = spark ? drawSparkline(spark.ping, '#f59e0b', 72, 22) : '';
        const ipLine = d.ip
            ? '<div style="font-size:10px;color:var(--nt-sub);font-family:monospace;margin-top:2px">&#128279; ' + esc(d.ip) + '</div>'
            : '';
        // Status-Pillen (Wartung, Acked) wenn relevant
        const pills = [];
        if (d.maintenance) pills.push('<span style="display:inline-block;background:rgba(245,158,11,0.18);color:var(--nt-warn-text);'
            + 'padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;margin-right:4px">'
            + '\u{1F527} ' + esc(t('tip.maintenance')) + '</span>');
        if (d.acknowledged) pills.push('<span style="display:inline-block;background:rgba(34,197,94,0.18);color:var(--nt-ok-text);'
            + 'padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;margin-right:4px">'
            + '\u2714 Acked</span>');
        const pillLine = pills.length
            ? '<div style="margin-top:3px">' + pills.join('') + '</div>'
            : '';
        return '<div style="font-weight:700;font-size:11px;color:var(--nt-text);margin-bottom:7px;padding-bottom:5px;border-bottom:1px solid var(--nt-line-soft)">'
            + esc(d.label) + ipLine + pillLine + '</div>'
            + rows.map(function(r, i) {
                let sparkEl = '';
                if (spark) {
                    if (i === 0 && sparkCpu)  sparkEl = '<span style="margin-left:auto">' + sparkCpu  + '</span>';
                    if (i === 3 && sparkPing) sparkEl = '<span style="margin-left:auto">' + sparkPing + '</span>';
                }
                return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'
                    + '<span style="width:8px;height:8px;border-radius:50%;background:' + r.col + ';flex-shrink:0;display:inline-block"></span>'
                    + '<span style="color:var(--nt-sub);width:48px;flex-shrink:0">' + r.lbl + '</span>'
                    + '<span style="flex:1">' + r.val + '</span>'
                    + sparkEl
                    + '</div>';
            }).join('')
            // Extra-Items aus nt:show-Tags — eigener Block unter den Standard-Zeilen
            + (d.extra_items && d.extra_items.length ? (function() {
                const items = d.extra_items.map(function(it) {
                    const lblShort = esc((it.name || '').substring(0, 28));
                    const val = it.error
                        ? '<span style="color:var(--nt-muted);font-style:italic">' + esc(it.error) + '</span>'
                        : '<b>' + esc(fmtItemValue(it.value, it.units)) + '</b>';
                    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;font-size:10px">'
                        + '<span style="width:8px;height:8px;border-radius:50%;background:#06b6d4;flex-shrink:0"></span>'
                        + '<span style="color:var(--nt-sub);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(it.name || '') + '">' + lblShort + '</span>'
                        + '<span style="flex-shrink:0">' + val + '</span>'
                        + '</div>';
                }).join('');
                return '<div style="margin-top:5px;padding-top:5px;border-top:1px solid var(--nt-line-soft)">' + items + '</div>';
            })() : '')
            + (spark && spark.since ? (function() {
                const elapsed = Math.floor(Date.now() / 1000) - spark.since;
                const hh = Math.floor(elapsed / 3600);
                const mm = Math.floor((elapsed % 3600) / 60);
                const dd = Math.floor(hh / 24);
                const sinceStr = dd > 0 ? dd + 'd ' + Math.floor(hh % 24) + 'h'
                              : (hh > 0 ? hh + 'h ' + mm + 'm' : mm + 'm');
                return '<div style="font-size:10px;color:#f59e0b;margin-top:5px;padding-top:4px;border-top:1px solid var(--nt-line-soft)">'
                    + '\u23F1 ' + t('tip.problem_since', { t: '<b>' + esc(sinceStr) + '</b>' }) + '</div>';
            })() : '')
            + (spark ? '' : '<div style="font-size:9px;color:var(--nt-faint);margin-top:4px">\u231B ' + esc(t('tip.loading_history')) + '</div>');
    }

    _syncTheme();
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

// ── Edge-Tooltip ───────────────────────────────────────────────────────────
// Wird beim Hover ueber LLDP-/Manual-Edges angezeigt. Aktuell Traffic in/out
// (Summe beider Endpunkte) plus 1h-Sparkline. Holt Spark-Daten fuer beide
// Endpunkte parallel und summiert element-weise.
function _sumArrays(a, b) {
    const len = Math.max((a && a.length) || 0, (b && b.length) || 0);
    if (len === 0) return [];
    const out = new Array(len);
    for (let i = 0; i < len; i++) out[i] = (a && a[i] || 0) + (b && b[i] || 0);
    return out;
}

export function showEdgeTip(evt, edgeData, srcLabel, tgtLabel) {
    const tIn  = edgeData.trafficIn  || 0;
    const tOut = edgeData.trafficOut || 0;
    const srcId = edgeData.source || edgeData.from || '';
    const tgtId = edgeData.target || edgeData.to   || '';

    function buildHtml(sparkSrc, sparkTgt) {
        const inArr  = (sparkSrc || sparkTgt)
            ? _sumArrays(sparkSrc && sparkSrc.traffic_in,  sparkTgt && sparkTgt.traffic_in)
            : null;
        const outArr = (sparkSrc || sparkTgt)
            ? _sumArrays(sparkSrc && sparkSrc.traffic_out, sparkTgt && sparkTgt.traffic_out)
            : null;
        const inSpark  = inArr  && inArr.length  ? drawSparkline(inArr,  '#06b6d4', 160, 26) : '';
        const outSpark = outArr && outArr.length ? drawSparkline(outArr, '#f97316', 160, 26) : '';
        const haveData = inSpark || outSpark;

        // Discovery-Source-Badge: LLDP/CDP/beides — falls vom Backend gemeldet
        const srcArr = (edgeData.src && edgeData.src.length) ? edgeData.src : [];
        const srcBadge = srcArr.length
            ? ' <span style="font-size:9px;color:#fff;background:#64748b;border-radius:3px;'
                + 'padding:1px 5px;margin-left:4px;letter-spacing:0.05em;text-transform:uppercase;font-weight:600">'
                + esc(srcArr.join('+')) + '</span>'
            : '';
        const header = '<div style="font-weight:700;font-size:11px;color:var(--nt-text);margin-bottom:6px;'
            + 'padding-bottom:5px;border-bottom:1px solid var(--nt-line-soft)">'
            + esc(srcLabel) + ' <span style="color:var(--nt-muted)">↔</span> ' + esc(tgtLabel)
            + srcBadge
            + '</div>';

        // §3 Port-zu-Port: lokaler Port ↔ Remote-Port, wenn das Backend sie
        // gemeldet hat (portSrc/portTgt). "per-Link" markiert, dass Traffic +
        // Auslastung unten aus der echten Port-Metrik stammen, nicht geschaetzt.
        const pSrc = edgeData.portSrc || '', pTgt = edgeData.portTgt || '';
        const portRow = (pSrc || pTgt)
            ? '<div style="font-size:10px;color:var(--nt-text-2);margin-bottom:5px">'
                + '<span style="color:var(--nt-muted)">Port</span> '
                + '<b>' + esc(pSrc || '?') + '</b> <span style="color:var(--nt-muted)">↔</span> <b>' + esc(pTgt || '?') + '</b>'
                + (edgeData.perLink ? ' <span style="font-size:9px;color:#16a34a;font-weight:600;text-transform:uppercase;letter-spacing:0.04em">per-Link</span>' : '')
                + '</div>'
            : '';

        // Auslastung wenn Kapazitaet bekannt (Weathermap-Basis).
        const capBps = edgeData.capBps || 0;
        let utilPart = '';
        if (capBps > 0) {
            // Prozentsatz UND Farbstufe kommen aus traffic.js. Die Farbstufe
            // war hier schon einmal eine eigene Kopie und lief auseinander —
            // der Tooltip wurde bei 40 % orange, die Kante erst bei 55 %.
            const pct = utilizationPct(edgeData);
            const pctCol = utilizationColor(pct);
            utilPart = '<span style="color:var(--nt-muted)">·</span>'
                + '<span><b style="color:' + pctCol + '">' + pct.toFixed(1) + '%</b>'
                + ' <span style="color:var(--nt-muted)">/ ' + fmt(capBps) + '</span></span>';
        }
        const liveRow = '<div style="display:flex;gap:10px;font-size:11px;color:var(--nt-text-2);margin-bottom:4px">'
            + '<span><span style="color:#06b6d4">↓</span> <b>' + fmt(tIn) + '</b></span>'
            + '<span><span style="color:#f97316">↑</span> <b>' + fmt(tOut) + '</b></span>'
            + utilPart
            + '</div>';

        // Interface-Health (wenn vom Backend geliefert) als zweite Zeile.
        // Werte sind aggregat ueber alle Interfaces beider Endpunkte —
        // exakte Port-Zuordnung fehlt (siehe LLDP-Quality-Tab).
        const ifDown = edgeData.ifaceDown || 0;
        const ifErr  = edgeData.ifaceErr  || 0;
        const ifDrop = edgeData.ifaceDrop || 0;
        let healthRow = '';
        if (ifDown > 0 || ifErr > 0.1 || ifDrop > 0.1) {
            const parts = [];
            if (ifDown > 0) parts.push('<span style="color:#dc2626;font-weight:600">⬇ ' + ifDown + ' down</span>');
            if (ifErr  > 0.1) parts.push('<span style="color:#f97316">err ' + ifErr.toFixed(1)  + '/s</span>');
            if (ifDrop > 0.1) parts.push('<span style="color:#f59e0b">drop ' + ifDrop.toFixed(1) + '/s</span>');
            healthRow = '<div style="display:flex;gap:10px;font-size:10px;'
                + 'margin-bottom:4px;padding-bottom:3px;border-bottom:1px dotted var(--nt-line-soft)">'
                + parts.join(' · ') + '</div>';
        }

        if (!haveData && (sparkSrc || sparkTgt)) {
            // Daten geholt, aber keine Traffic-Items vorhanden
            return header + portRow + liveRow + healthRow + '<div style="font-size:10px;color:var(--nt-muted);margin-top:4px">'
                + esc(t('tip.no_traffic_history')) + '</div>';
        }

        const sparkBlock = haveData
            ? '<div style="margin-top:6px;font-size:10px;color:var(--nt-sub)">'
                + (inSpark ? '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">'
                    + '<span style="color:#06b6d4">↓ In</span>' + inSpark + '</div>' : '')
                + (outSpark ? '<div style="display:flex;align-items:center;gap:6px">'
                    + '<span style="color:#f97316">↑ Out</span>' + outSpark + '</div>' : '')
                + '<div style="font-size:9px;color:var(--nt-faint);margin-top:3px">' + esc(t('tip.last_1h'))
                    // Bei Per-Link-Kanten stammt die Live-Zeile oben aus der Port-Metrik,
                    // die 1h-Sparkline aber aus der Host-History beider Endpunkte
                    // (der Spark-Endpoint liefert nur Host-Werte) → ausweisen.
                    + (edgeData.perLink ? ' · ' + esc(t('tip.host_total')) : '') + '</div>'
                + '</div>'
            : '<div style="font-size:9px;color:var(--nt-faint);margin-top:4px">⌛ ' + esc(t('tip.loading_history')) + '</div>';

        return header + portRow + liveRow + healthRow + sparkBlock;
    }

    _syncTheme();
    _tip.style.width = '210px';
    _tip.innerHTML = buildHtml(null, null);
    _tip.style.display = 'block';
    moveTip(evt);

    // Async: Spark fuer beide Endpunkte holen (einen Call mit beiden IDs).
    if (!srcId || !tgtId) return;
    const cfg = window.NT_CONFIG;
    if (!cfg || !cfg.data_url) return;
    const cacheS = _sparkCache[srcId], cacheT = _sparkCache[tgtId];
    const now = Date.now();
    if (cacheS && cacheT && (now - cacheS.ts) < 60000 && (now - cacheT.ts) < 60000) {
        _tip.innerHTML = buildHtml(cacheS, cacheT);
        return;
    }
    const url = cfg.data_url.replace('network.topology.data', 'network.topology.spark')
        + '&hostids%5B%5D=' + encodeURIComponent(srcId)
        + '&hostids%5B%5D=' + encodeURIComponent(tgtId);
    fetch(url, { credentials: 'same-origin', headers: {'X-Requested-With': 'XMLHttpRequest'} })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            const s = data[String(srcId)] || null;
            const t = data[String(tgtId)] || null;
            if (s) _sparkCache[srcId] = Object.assign({}, s, { ts: now });
            if (t) _sparkCache[tgtId] = Object.assign({}, t, { ts: now });
            if (_tip.style.display === 'block') _tip.innerHTML = buildHtml(s, t);
        })
        .catch(function() {
            if (_tip.style.display === 'block') {
                _tip.innerHTML = buildHtml({ traffic_in: [], traffic_out: [] },
                                          { traffic_in: [], traffic_out: [] });
            }
        });
}
