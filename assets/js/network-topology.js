(function () {
'use strict';

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');
}
function fmt(b) {
    b = +b || 0;
    if (b >= 1e9) return (b/1e9).toFixed(1)+' Gb/s';
    if (b >= 1e6) return (b/1e6).toFixed(1)+' Mb/s';
    if (b >= 1e3) return (b/1e3).toFixed(1)+' Kb/s';
    return b.toFixed(0)+' b/s';
}

var SEV_COL = ['#22c55e','#06b6d4','#f59e0b','#f97316','#ef4444','#991b1b'];
var SEV_LBL = ['Normal','Info','Warning','Average','High','Disaster'];
var GRP_COLORS = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899','#14b8a6','#84cc16','#6366f1','#e11d48'];
var _gcMap = {}, _gcIdx = 0;
function grpColor(name) {
    if (!name) return '#94a3b8';
    if (!_gcMap[name]) { _gcMap[name] = GRP_COLORS[_gcIdx++ % GRP_COLORS.length]; }
    return _gcMap[name];
}

var TYPE_ICON = {
    server:   'M-11,-13 h22 v4 h-22z M-11,-6 h22 v4 h-22z M-11,1 h22 v4 h-22z M-11,8 h22 v4 h-22z M8,-11 a1.5,1.5 0 1,1 0,0.01 M8,-4 a1.5,1.5 0 1,1 0,0.01 M8,3 a1.5,1.5 0 1,1 0,0.01 M8,10 a1.5,1.5 0 1,1 0,0.01',
    firewall: 'M0,-13 L11,-8 L11,1 C11,8 6,12 0,14 C-6,12 -11,8 -11,1 L-11,-8z M-4,1 h8 M-2,-4 h4 M0,-7 v3',
    router:   'M0,-12 a12,12 0 1,1 0,0.01z M-12,0 h24 M-6,-6 L6,6 M6,-6 L-6,6 M0,-12 v24',
    switch:   'M-12,-5 h24 v10 h-24z M-9,0 v-8 M-5,0 v-8 M-1,0 v-8 M3,0 v-8 M7,0 v-8 M-9,-4 h2 v-4 h-2z',
    wireless: 'M0,9 a2,2 0 1,1 0,0.01 M-4,4 a6,6 0 0,1 8,0 M-8,0 a12,12 0 0,1 16,0 M-12,-4 a18,18 0 0,1 24,0',
    storage:  'M-11,-11 h22 v6 h-22z M-11,-2 h22 v6 h-22z M-11,7 h22 v6 h-22z M7,-8 a1.5,1.5 0 1,1 0,0.01 M7,1 a1.5,1.5 0 1,1 0,0.01',
    camera:   'M-11,-7 h15 l3,-4 h4 l3,4 h3 v14 h-28z M0,3 a5,5 0 1,1 0,0.01',
    printer:  'M-10,-1 h20 v9 h-20z M-7,-9 h14 v8 h-14z M-7,8 h14 v8 h-14z M-4,11 h8 M-4,14 h8',
};

// Ring SVG
var C = 48, RO = 42, RI = 26;
function pieSlice(r, sDeg, eDeg) {
    if (eDeg <= sDeg + 0.5) return '';
    var S = (sDeg-90)*Math.PI/180, E = (eDeg-90)*Math.PI/180;
    var large = (eDeg-sDeg) > 180 ? 1 : 0;
    return 'M '+C+' '+C+' L '+(C+r*Math.cos(S)).toFixed(2)+' '+(C+r*Math.sin(S)).toFixed(2)
        +' A '+r+' '+r+' 0 '+large+' 1 '+(C+r*Math.cos(E)).toFixed(2)+' '+(C+r*Math.sin(E)).toFixed(2)+' Z';
}
function trafficPct(d) { return !d.traffic ? 0 : Math.min((d.traffic.in+d.traffic.out)/2e7*100,100); }
function pingPct(d)    { return (!d.ping||d.ping<=0) ? 0 : Math.min(d.ping/200*100,100); }

var _imgCache = {};
var _IMG_CACHE_MAX = 500;
function _imgCachePrune() {
    var keys = Object.keys(_imgCache);
    if (keys.length > _IMG_CACHE_MAX) {
        // \u00C4lteste 100 Eintr\u00E4ge l\u00F6schen (FIFO approximation)
        keys.slice(0, 100).forEach(function(k) { delete _imgCache[k]; });
    }
}
function makeNodeImage(d) {
    var key = [d.id,d.severity,d.cpu,d.memory,d.ping,d.traffic?d.traffic.in:0,d.traffic?d.traffic.out:0,d._primaryGroup,d.problems||0,d.pinned?1:0,d.note?1:0].join('|');
    if (_imgCache[key]) return _imgCache[key];
    var dead = (d.severity||0) >= 5;
    var sevCol = SEV_COL[Math.min(d.severity||0, SEV_COL.length-1)];
    var gc = grpColor(d._primaryGroup);
    var segs = [{col:'#3b82f6',val:Math.min(d.cpu||0,100)},{col:'#8b5cf6',val:Math.min(d.memory||0,100)},{col:'#22c55e',val:trafficPct(d)},{col:'#f59e0b',val:pingPct(d)}];
    var p = '';
    segs.forEach(function(seg,i) {
        var base = i*90;
        p += '<path d="'+pieSlice(RO,base,base+90)+'" fill="'+seg.col+'" fill-opacity="0.12"/>';
        if (seg.val>1) p += '<path d="'+pieSlice(RO,base,base+seg.val*0.9)+'" fill="'+seg.col+'" fill-opacity="0.85"/>';
        var a = (base-90)*Math.PI/180;
        p += '<line x1="'+(C+RI*Math.cos(a)).toFixed(1)+'" y1="'+(C+RI*Math.sin(a)).toFixed(1)+'" x2="'+(C+RO*Math.cos(a)).toFixed(1)+'" y2="'+(C+RO*Math.sin(a)).toFixed(1)+'" stroke="white" stroke-width="1.5"/>';
    });
    p += '<circle cx="'+C+'" cy="'+C+'" r="'+RI+'" fill="'+gc+'" fill-opacity="'+(dead?'0.08':'0.15')+'" stroke="'+(dead?'#94a3b8':sevCol)+'" stroke-width="3" opacity="'+(dead?'0.6':'1')+'"/>';
    if (dead) {
        p += '<g transform="translate('+C+','+(C-3)+') scale(0.62)">'
            +'<path d="M0,-14 a13,10 0 0,1 13,10 L13,4 Q13,9 8,10 L-8,10 Q-13,9 -13,4 L-13,-4 a13,10 0 0,1 13,-10z" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1.5"/>'
            +'<rect x="-9" y="10" width="5" height="5" rx="1" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1.2"/>'
            +'<rect x="-2" y="10" width="5" height="5" rx="1" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1.2"/>'
            +'<rect x="5" y="10" width="5" height="5" rx="1" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1.2"/>'
            +'<path d="M-7,-3 L-4,0 M-4,-3 L-7,0 M4,-3 L7,0 M7,-3 L4,0" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" fill="none"/>'
            +'</g>';
    } else {
        var icon = TYPE_ICON[d.type]||TYPE_ICON.server;
        p += '<g transform="translate('+C+','+C+') scale(0.62)" fill="none" stroke="#475569" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="'+icon+'"/></g>';
    }
    // \u1F4CC Pinned-Icon (top-left corner) \u2014 kleiner Rei\u00DFnagel
    if (d.pinned) {
        p += '<circle cx="14" cy="14" r="11" fill="#3b82f6" opacity="0.92" stroke="white" stroke-width="1.2"/>';
        p += '<path d="M14,7 L14,14 M10,10 L18,10 M12,14 L16,14 M14,14 L14,19" stroke="white" stroke-width="1.8" stroke-linecap="round" fill="none"/>';
    }

    // \u1F3F7 Notiz-Icon (bottom-left corner) \u2014 gelbes Sticky-Note
    if (d.note) {
        p += '<rect x="2" y="'+(C*2-24)+'" width="20" height="20" rx="3" fill="#fbbf24" stroke="#d97706" stroke-width="1"/>';
        p += '<line x1="6" y1="'+(C*2-18)+'" x2="18" y2="'+(C*2-18)+'" stroke="#92400e" stroke-width="1.5" stroke-linecap="round"/>';
        p += '<line x1="6" y1="'+(C*2-13)+'" x2="18" y2="'+(C*2-13)+'" stroke="#92400e" stroke-width="1.5" stroke-linecap="round"/>';
        p += '<line x1="6" y1="'+(C*2-8)+'" x2="14" y2="'+(C*2-8)+'" stroke="#92400e" stroke-width="1.5" stroke-linecap="round"/>';
    }

    // Problem-Counter Badge (top-right corner)
    var prob = d.problems || 0;
    if (prob > 0) {
        var bLabel = prob > 99 ? '99+' : String(prob);
        var bR = bLabel.length > 2 ? 13 : 10;
        var bX = C*2 - bR - 2;
        var bY = bR + 2;
        p += '<circle cx="'+bX+'" cy="'+bY+'" r="'+bR+'" fill="#ef4444" stroke="white" stroke-width="1.5"/>';
        p += '<text x="'+bX+'" y="'+bY+'" text-anchor="middle" dominant-baseline="central" '
            + 'font-family="sans-serif" font-size="'+(bLabel.length > 2 ? 8 : 10)+'" font-weight="700" fill="white">'+bLabel+'</text>';
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="'+(C*2)+'" height="'+(C*2)+'">'+p+'</svg>';
    var url = 'data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg)));
    _imgCache[key] = url;
    _imgCachePrune();
    return url;
}

// Context menu
var _ctx = document.createElement('div');
_ctx.style.cssText = 'display:none;position:fixed;z-index:9999;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.15);min-width:190px;font-size:13px;overflow:hidden';
document.body.appendChild(_ctx);
document.addEventListener('click', function(e){
    if (!_ctx.contains(e.target)) _ctx.style.display='none';
});

function _ctxRow(label, color, onClick) {
    var row = document.createElement('div');
    row.textContent = label;
    row.style.cssText = 'padding:8px 16px;color:'+(color||'#334155')+';cursor:pointer;white-space:nowrap;';
    row.addEventListener('mouseenter', function(){ row.style.background='#f8fafc'; });
    row.addEventListener('mouseleave', function(){ row.style.background=''; });
    row.addEventListener('click', function(e){
        e.stopPropagation();
        _ctx.style.display='none';
        onClick();
    });
    return row;
}

function showCtx(cx, cy2, d) {
    while (_ctx.firstChild) _ctx.removeChild(_ctx.firstChild);

    var base   = window.location.pathname.replace('zabbix.php','');
    var hostId = String(d.id);

    // Jede Zabbix-Seite hat ihren eigenen Filter-Parameter-Namen.
    // problem.view: hostids[] (nicht filter_hostids[]) + show=1 f\u00FCr aktive Problems
    // latest.view / charts.view: filter_hostids[]
    function zbxUrl(action, hostid) {
        var base_url = window.location.origin + base + 'zabbix.php?action=' + action;
        if (action === 'problem.view') {
            return base_url
                + '&hostids%5B%5D=' + encodeURIComponent(hostid)
                + '&show=1&filter_set=1';
        }
        return base_url
            + '&filter_hostids%5B%5D=' + encodeURIComponent(hostid)
            + '&filter_set=1';
    }

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'padding:8px 12px 6px;font-weight:700;border-bottom:1px solid #f1f5f9;font-size:12px;color:#0f172a';
    header.textContent = d.label;
    if (d.ip) { var ipEl=document.createElement('div'); ipEl.style.cssText='font-size:10px;font-weight:400;color:#64748b;font-family:monospace;margin-top:2px'; ipEl.textContent='\uD83D\uDD17 '+d.ip; header.appendChild(ipEl); }
    _ctx.appendChild(header);

    // Notiz-Vorschau
    if (d.note) {
        var np = document.createElement('div');
        np.style.cssText = 'padding:0 16px 6px;font-size:10px;color:#64748b;font-style:italic;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
        np.textContent = d.note;
        _ctx.appendChild(np);
    }

    // Zabbix-Links
    [
        [' Latest Data', zbxUrl('latest.view',  hostId)],
        ['\u26A0 Problems',          zbxUrl('problem.view', hostId)],
        [' Graphs',      zbxUrl('charts.view',  hostId)],
        ['\u2699\uFE0F Konfiguration', (function(){
            // host.list: filter_hostids[] mit hostid ist zuverl\u00E4ssig \u2014 filter_name wird ignoriert
            return window.location.origin + base
                + 'zabbix.php?action=host.list'
                + '&filter_host=' + encodeURIComponent(d.host || d.label)
                + '&filter_set=1';
        })()],
    ].forEach(function(item) {
        var url = item[1];
        _ctx.appendChild(_ctxRow(item[0], '#334155', function(){
            window.open(url, '_blank');
        }));
    });

    // Trennlinie
    var sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px solid #f1f5f9;margin-top:2px';
    _ctx.appendChild(sep);

    // Pin
    var pinLabel = d.pinned ? ' Unpin' : ' Pin (fixieren)';
    _ctx.appendChild(_ctxRow(pinLabel, '#3b82f6', function(){
        var cy = window._ntCy; if (!cy) return;
        var node = cy.getElementById(hostId);
        if (!node.length) return;
        var nowPinned = !node.data('pinned');
        node.data('pinned', nowPinned);
        _imgCache = {};
        node.data('bgImage', makeNodeImage(node.data()));
        if (nowPinned) { node.lock(); } else { node.unlock(); }
        savePinned(cy);
    }));

    // Notiz
    var noteLabel = d.note ? ' Notiz bearbeiten' : ' Notiz hinzuf\u00fcgen';
    _ctx.appendChild(_ctxRow(noteLabel, '#f59e0b', function(){
        var cy = window._ntCy; if (!cy) return;
        var node = cy.getElementById(hostId);
        if (!node.length) return;
        var text = prompt('Notiz f\u00fcr ' + d.label + ' (leer = l\u00f6schen):', node.data('note') || '');
        if (text === null) return;
        var notes = saveNote(hostId, text);
        node.data('note', notes[hostId] || '');
        _imgCache = {};
        node.data('bgImage', makeNodeImage(node.data()));
    }));

    _ctx.style.left = cx + 'px';
    _ctx.style.top  = cy2 + 'px';
    _ctx.style.display = 'block';
}


// Floating ring tooltip
var _tip = document.createElement('div');
_tip.id = 'nt-ring-tip';
_tip.style.cssText = 'display:none;position:fixed;z-index:99998;background:#fff;border:1px solid #e2e8f0;'
    + 'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.12);padding:10px 14px;font-size:12px;'
    + 'font-family:sans-serif;pointer-events:none;min-width:160px;';
document.body.appendChild(_tip);

// \u2500\u2500 Sparkline: History-Daten f\u00FCr CPU + Ping \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
var _sparkCache = {};   // hostid -> { cpu: [...], ping: [...], ts: timestamp }
var _sparkPending = {}; // hostid -> true (l\u00E4uft gerade)

function fetchSparkData(hostid, d, onDone) {
    var now = Date.now();
    var cached = _sparkCache[hostid];
    if (cached && (now - cached.ts) < 60000) { onDone(cached); return; }  // 1min Cache
    if (_sparkPending[hostid]) return;
    _sparkPending[hostid] = true;

    // History via NetworkTopologySpark PHP-Action
    var cfg = window.NT_CONFIG;
    if (!cfg || !cfg.data_url) { delete _sparkPending[hostid]; return; }
    var sparkUrl = cfg.data_url.replace('network.topology.v6.data', 'network.topology.v6.spark')
        + '&hostids%5B%5D=' + encodeURIComponent(hostid);

    fetch(sparkUrl, { credentials: 'same-origin', headers: {'X-Requested-With':'XMLHttpRequest'} })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var h = data[String(hostid)] || {};
            var result = {
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
            // Fallback bei Fehler: Approximation aus aktuellem Wert
            var result = {
                cpu:   d && d.cpu  != null ? Array(12).fill(d.cpu||0)  : [],
                ping:  d && d.ping != null ? Array(12).fill(d.ping||0) : [],
                since: null, ts: now
            };
            _sparkCache[hostid] = result;
            delete _sparkPending[hostid];
            onDone(result);
        });
}

function drawSparkline(values, color, width, height) {
    if (!values || !values.length) return '';
    var w = width || 80, h = height || 24;
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = Math.max(max - min, 1);
    var step  = w / (values.length - 1 || 1);
    var pts   = values.map(function(v, i) {
        return (i * step).toFixed(1) + ',' + (h - ((v - min) / range * (h-2) + 1)).toFixed(1);
    }).join(' ');
    return '<svg width="'+w+'" height="'+h+'" style="vertical-align:middle;flex-shrink:0">'
        + '<polyline points="'+pts+'" fill="none" stroke="'+color+'" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>'
        + '<circle cx="'+(values.length-1)*step+'" cy="'+(h-((values[values.length-1]-min)/range*(h-2)+1)).toFixed(1)+'" r="2" fill="'+color+'"/>'
        + '</svg>';
}

function showTip(evt, d) {
    var traffic = d.traffic || {in:0, out:0};
    function bar(pct) {
        var filled = Math.round((pct||0) / 100 * 8);
        return '<span style="color:#334155;font-family:monospace">'
            + '\u2588'.repeat(Math.max(0,filled)) + '<span style="opacity:0.2">' + '\u2588'.repeat(Math.max(0,8-filled)) + '</span></span>';
    }
    var rows = [
        {col:'#3b82f6', lbl:'CPU',     val: d.cpu!=null    ? bar(d.cpu)+' <b>'+d.cpu+'%</b>'       : '<span style="color:#94a3b8">\u2014</span>'},
        {col:'#8b5cf6', lbl:'Memory',  val: d.memory!=null ? bar(d.memory)+' <b>'+d.memory+'%</b>' : '<span style="color:#94a3b8">\u2014</span>'},
        {col:'#22c55e', lbl:'Traffic', val: '<b>\u2193 '+fmt(traffic.in)+'</b>  <b>\u2191 '+fmt(traffic.out)+'</b>'},
        {col:'#f59e0b', lbl:'Ping',    val: d.ping>0        ? '<b>'+d.ping+' ms</b>'                : '<span style="color:#94a3b8">\u2014</span>'},
    ];

    // Basis-Tooltip sofort zeigen
    function buildHtml(spark) {
        var sparkCpu  = spark ? drawSparkline(spark.cpu,  '#3b82f6', 72, 22) : '';
        var sparkPing = spark ? drawSparkline(spark.ping, '#f59e0b', 72, 22) : '';
        var ipLine = d.ip ? '<div style="font-size:10px;color:#64748b;font-family:monospace;margin-top:2px">&#128279; '+esc(d.ip)+'</div>' : '';
        return '<div style="font-weight:700;font-size:11px;color:#0f172a;margin-bottom:7px;padding-bottom:5px;border-bottom:1px solid #f1f5f9">'
            + esc(d.label) + ipLine + '</div>'
            + rows.map(function(r, i){
                var sparkEl = '';
                if (spark) {
                    if (i === 0 && sparkCpu)  sparkEl = '<span style="margin-left:auto">'+sparkCpu+'</span>';
                    if (i === 3 && sparkPing) sparkEl = '<span style="margin-left:auto">'+sparkPing+'</span>';
                }
                return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'
                    + '<span style="width:8px;height:8px;border-radius:50%;background:'+r.col+';flex-shrink:0;display:inline-block"></span>'
                    + '<span style="color:#64748b;width:48px;flex-shrink:0">'+r.lbl+'</span>'
                    + '<span style="flex:1">'+r.val+'</span>'
                    + sparkEl
                    + '</div>';
            }).join('')
            + (spark && spark.since ? (function(){
                var elapsed = Math.floor(Date.now()/1000) - spark.since;
                var hh = Math.floor(elapsed/3600), mm = Math.floor((elapsed%3600)/60);
                var dd = Math.floor(hh/24);
                var sinceStr = dd > 0 ? dd+'d '+Math.floor(hh%24)+'h' : (hh > 0 ? hh+'h '+mm+'m' : mm+'m');
                return '<div style="font-size:10px;color:#f59e0b;margin-top:5px;padding-top:4px;border-top:1px solid #f1f5f9">'                    + '\u23F1 Problem seit: <b>'+sinceStr+'</b></div>';
            })() : '')
            + (spark ? '' : '<div style="font-size:9px;color:#cbd5e1;margin-top:4px">\u231B Lade Verlauf...</div>');
    }

    _tip.style.width = '240px';
    _tip.innerHTML = buildHtml(null);
    _tip.style.display = 'block';
    moveTip(evt);

    // Sparkline-Daten async laden und Tooltip aktualisieren
    if (d.id && (d.cpu != null || d.ping != null)) {
        fetchSparkData(String(d.id), d, function(spark) {
            if (_tip.style.display === 'block') {
                _tip.innerHTML = buildHtml(spark);
            }
        });
    }
}
function moveTip(evt) {
    var x = evt.originalEvent ? evt.originalEvent.clientX : (evt.clientX||0);
    var y = evt.originalEvent ? evt.originalEvent.clientY : (evt.clientY||0);
    var tw = _tip.offsetWidth || 180, th = _tip.offsetHeight || 120;
    var wx = window.innerWidth, wy = window.innerHeight;
    _tip.style.left = (x + 14 + tw > wx ? x - tw - 8 : x + 14) + 'px';
    _tip.style.top  = (y + 14 + th > wy ? y - th - 8 : y + 14) + 'px';
}
function hideTip() { _tip.style.display = 'none'; }

// Detail panel
function showDetail(panel, d, cy) {
    var sc = SEV_COL[d.severity||0]||SEV_COL[0];
    var rows = [
        ['Host',esc(d.host||d.label)],['IP',esc(d.ip||'\u2014')],['Interface',esc(d.iftype||'\u2014')],
        ...(d.pinned ? [['Status','<span style="color:#3b82f6;font-weight:600">&#128204; Fixiert</span>']] : []),
        ...(d.note   ? [['Notiz', '<span style="color:#f59e0b">&#127991; '+esc(d.note)+'</span>']] : []),
        ['Status','<span style="color:'+sc+';font-weight:700">&#9679; '+esc(SEV_LBL[d.severity||0]||'Normal')+'</span>'],
        ['CPU',d.cpu!=null?'<b>'+d.cpu+'%</b>':'\u2014'],['Memory',d.memory!=null?'<b>'+d.memory+'%</b>':'\u2014'],
        ['Ping',d.ping>0?'<b>'+d.ping+' ms</b>':'\u2014'],
        ['&#8595; In','<span style="color:#22c55e">'+fmt(d.traffic?d.traffic.in:0)+'</span>'],
        ['&#8593; Out','<span style="color:#38bdf8">'+fmt(d.traffic?d.traffic.out:0)+'</span>'],
    ];
    var peers = '';
    cy.getElementById(d.id).connectedEdges().forEach(function(edge){
        var other = edge.source().id()===d.id ? edge.target() : edge.source();
        if (other.data('isGroup')) return;
        peers += (peers?'<br>':'')+'&#8596; '+esc(other.data('label'));
    });
    // Ring legend
    var rings = [
        {col:'#3b82f6', lbl:'CPU',     val: d.cpu!=null    ? d.cpu+'%'    : '\u2014', pct: Math.min(d.cpu||0,100)},
        {col:'#8b5cf6', lbl:'Memory',  val: d.memory!=null ? d.memory+'%' : '\u2014', pct: Math.min(d.memory||0,100)},
        {col:'#22c55e', lbl:'Traffic', val: d.traffic ? fmt(d.traffic.in)+' / '+fmt(d.traffic.out) : '\u2014', pct: trafficPct(d)},
        {col:'#f59e0b', lbl:'Ping',    val: d.ping>0 ? d.ping+' ms' : '\u2014', pct: pingPct(d)},
    ];
    var ringHtml = '<div style="display:flex;gap:8px;margin:8px 0;padding:6px 0;border-top:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9">';
    rings.forEach(function(r){
        ringHtml += '<div style="flex:1;text-align:center">'
            +'<svg width="36" height="36" viewBox="0 0 36 36">'
            +'<circle cx="18" cy="18" r="14" fill="none" stroke="'+r.col+'22" stroke-width="4"/>'
            +(r.pct>0?'<circle cx="18" cy="18" r="14" fill="none" stroke="'+r.col+'" stroke-width="4" stroke-dasharray="'+(r.pct/100*87.96).toFixed(1)+' 87.96" stroke-dashoffset="21.99" stroke-linecap="round"/>':'')
            +'</svg>'
            +'<div style="font-size:9px;color:'+r.col+';font-weight:700;margin-top:1px">'+r.lbl+'</div>'
            +'<div style="font-size:10px;color:#334155;font-weight:600">'+r.val+'</div>'
            +'</div>';
    });
    ringHtml += '</div>';

    panel.style.display='block';
    panel.innerHTML='<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px"><div style="font-weight:700;font-size:13px;color:#0f172a;flex:1;margin-right:8px">'+esc(d.label)+'</div><button id="nt-detail-close" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:18px;line-height:1;padding:0;flex-shrink:0">&#x2715;</button></div>'
        +ringHtml
        +'<table style="width:100%;font-size:12px;border-collapse:collapse">'+rows.map(function(r){ return '<tr><td style="color:#64748b;padding:3px 0;padding-right:10px">'+r[0]+'</td><td>'+r[1]+'</td></tr>'; }).join('')+'</table>'
        +(peers?'<div style="margin-top:8px;font-size:11px;color:#475569;border-top:1px solid #f1f5f9;padding-top:6px">'+peers+'</div>':'');
    var cb=document.getElementById('nt-detail-close');
    if(cb){cb.addEventListener('click',function(e){e.stopPropagation();panel.style.display='none';if(window._ntCy){window._ntCy.nodes('[!isGroup]').forEach(function(n){n.style('opacity',1);});window._ntCy.edges().forEach(function(ed){ed.style('opacity',0.85);});}});}
}

function primaryGroup(n, sel) {
    if (!n.groups||!n.groups.length) return null;
    if (sel&&sel.length) for (var i=0;i<n.groups.length;i++) if (sel.indexOf(n.groups[i])>=0) return n.groups[i];
    return n.groups[0];
}

var _sevFilter = new Set();
var _refreshTimer = null, _refreshOn = true;
var _highlightActive = null;

// \u2500\u2500 Path-Highlight helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function _hlBfs(cy, startId) {
    // BFS \u2014 findet alle transitiv verbundenen Knoten
    var visited = {};
    var queue = [startId];
    visited[startId] = true;
    while (queue.length) {
        var cur = queue.shift();
        cy.getElementById(cur).connectedEdges().forEach(function(edge) {
            [edge.source().id(), edge.target().id()].forEach(function(nid) {
                if (!visited[nid] && !cy.getElementById(nid).data('isGroup')) {
                    visited[nid] = true;
                    queue.push(nid);
                }
            });
        });
    }
    return visited;
}
function applyHighlight(cy, nodeId) {
    var visited = _hlBfs(cy, nodeId);
    cy.nodes('[!isGroup]').forEach(function(n) {
        n.style('opacity', visited[n.id()] ? 1 : 0.1);
    });
    cy.edges().forEach(function(e) {
        var show = visited[e.source().id()] && visited[e.target().id()];
        e.style('opacity', show ? 0.85 : 0.06);
    });
    _highlightActive = nodeId;
}
function resetHighlight(cy) {
    if (!_highlightActive) return;
    cy.nodes('[!isGroup]').forEach(function(n) { n.style('opacity', 1); });
    cy.edges().forEach(function(e) { e.style('opacity', 0.85); });
    _highlightActive = null;
}

// Init
function init() {
    var cfg = window.NT_CONFIG;
    if (!cfg) return;
    var wrap = document.getElementById('nt-canvas-wrap');
    var spin = document.getElementById('nt-loading');
    (function fixHeight() {
        var root = document.getElementById('nt-root');
        if (!root) return;
        var top = root.getBoundingClientRect().top;
        var h = window.innerHeight - top - 8;
        if (h > 300) root.style.height = h + 'px';
    })();
    window.addEventListener('resize', function() {
        var root = document.getElementById('nt-root');
        if (!root) return;
        var top = root.getBoundingClientRect().top;
        var h = window.innerHeight - top - 8;
        if (h > 300) root.style.height = h + 'px';
        if (window._ntCy) { window._ntCy.resize(); window._ntCy.fit(window._ntCy.nodes(), 40); }
    });
    // Basis-Toolbar (Tabs + Dark-Button) einmal initial bauen.
    // ensureBaseToolbar ist idempotent und wird bei jedem switchTab erneut aufgerufen.
    ensureBaseToolbar(wrap);
    if (!cfg.selected_groupids||!cfg.selected_groupids.length) {
        if(spin) spin.innerHTML='<span style="color:#64748b">&#8592; Bitte Host-Gruppen w\u00E4hlen und Apply klicken.</span>';
        return;
    }
    if(spin) spin.innerHTML='<span style="color:#64748b">Lade Topologie...</span>';
    var params = new URLSearchParams();
    (cfg.selected_groupids||[]).forEach(function(id){ params.append('groupids[]',id); });
    var url = cfg.data_url+'&'+params;
    fetch(url,{credentials:'same-origin',headers:{'X-Requested-With':'XMLHttpRequest'}})
        .then(function(r){ return r.json(); })
        .then(function(data){ spin.style.display='none'; window._ntLastData={nodes:data.nodes||[],edges:data.edges||[],url:url}; switchTab(_activeTab,wrap,data.nodes||[],data.edges||[],url); })
        .catch(function(err){ spin.innerHTML='<span style="color:#ef4444">Error: '+esc(err.message)+'</span>'; });
}

// \u2500\u2500 Tab-State \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Wert wird weiter unten gesetzt, nachdem die User-scoped Keys definiert sind.
var _activeTab = 'tech';


window.switchTab = null; // wird nach Definition gesetzt

// Globaler Dark-Mode-Toggle \u2014 funktioniert tab-\u00FCbergreifend
function applyDarkMode(forceState) {
    var root = document.getElementById('nt-root');
    if (!root) return;
    var nowDark = (forceState !== undefined)
        ? !!forceState
        : !root.classList.contains('nt-dark');
    root.classList.toggle('nt-dark', nowDark);
    var btn = document.getElementById('nt-btn-dark');
    if (btn) btn.textContent = nowDark ? 'Light' : 'Dark';

    // Technisch aktiv \u2192 Cytoscape-Styles nachziehen
    if (_activeTab === 'tech' && window._ntCy) {
        try {
            window._ntCy.nodes('[!isGroup]').style({
                'color': nowDark ? '#e2e8f0' : '#334155',
                'text-background-color': nowDark ? '#1e293b' : '#f8fafc'
            });
            window._ntCy.edges().style('line-color', nowDark ? '#334155' : '#cbd5e1');
            window._ntCy.nodes('[?isGroup]').forEach(function(n){
                n.style('color', nowDark ? '#e2e8f0' : grpColor(n.data('label')));
            });
        } catch(e) {}
    }
    // Management aktiv \u2192 komplett neu rendern (Kachel-Farben sind statisch gesetzt)
    if (_activeTab === 'mgmt') {
        var d = window._ntLastData || {};
        var wrap = document.getElementById('nt-canvas-wrap');
        if (wrap) renderManagement(wrap, d.nodes||[], d.edges||[]);
    }
}

// Idempotenter Bau der Basis-Toolbar: 3 Tabs + Dark-Button.
// Wird von jedem render-Pfad aufgerufen, baut Elemente nur wenn sie fehlen,
// und h\u00E4lt den aktiven Tab-State synchron.
function ensureBaseToolbar(wrap) {
    var bar = document.querySelector('.nt-topbar__actions');
    if (!bar) return;

    // Tab-Wrap (genau einmal)
    if (!document.getElementById('nt-tab-wrap')) {
        var tw = document.createElement('div');
        tw.id = 'nt-tab-wrap';
        tw.style.cssText = 'display:flex;gap:2px;margin-right:8px;padding-right:8px;border-right:1px solid #e2e8f0;flex-shrink:0';
        [{id:'nt-tab-tech',lbl:'Technisch',tab:'tech'},
         {id:'nt-tab-mgmt',lbl:'Management',tab:'mgmt'},
         {id:'nt-tab-tree',lbl:'Hierarchisch',tab:'tree'}].forEach(function(item){
            var b = document.createElement('button');
            b.id = item.id; b.textContent = item.lbl;
            b.className = 'btn-alt btn-small'; b.style.margin = '0';
            b.addEventListener('click', function(){
                var d = window._ntLastData || {};
                if (!d.nodes || !d.nodes.length) return;
                if (window.switchTab) window.switchTab(item.tab, wrap, d.nodes, d.edges||[], d.url||'');
            });
            tw.appendChild(b);
        });
        bar.insertBefore(tw, bar.firstChild);
    }

    // Aktiven Tab-State anzeigen (auch wenn Tabs schon existieren)
    ['tech','mgmt','tree'].forEach(function(t) {
        var b = document.getElementById('nt-tab-'+t);
        if (b) {
            b.style.background = _activeTab===t ? '#3b82f6' : '';
            b.style.color      = _activeTab===t ? '#fff'    : '';
        }
    });

    // Dark-Button (persistent, global, einmal gebunden)
    if (!document.getElementById('nt-btn-dark')) {
        var bDark = document.createElement('button');
        bDark.id = 'nt-btn-dark';
        bDark.className = 'btn-alt btn-small';
        bDark.style.marginLeft = '4px';
        var isDark = !!(document.getElementById('nt-root') &&
                        document.getElementById('nt-root').classList.contains('nt-dark'));
        bDark.textContent = isDark ? 'Light' : 'Dark';
        bDark.addEventListener('click', function(){ applyDarkMode(); });
        bar.appendChild(bDark);
    }
}

// Alter Name beibehalten (f\u00FCr Aufrufer), delegiert an ensureBaseToolbar
function ensureTabs(wrap) { ensureBaseToolbar(wrap); }

function switchTab(tab, wrap, nodes, edges, dataUrl) {
    _activeTab = tab;
    localStorage.setItem(NT_TAB_KEY, tab);
    if (tab==='mgmt') { renderManagement(wrap,nodes,edges); }
    else if (tab==='tree') { renderTree(wrap,nodes,edges); }
    else { render(wrap,nodes,edges,dataUrl); }
    ensureBaseToolbar(wrap);
}

// Render
function render(wrap, nodes, edges, dataUrl) {
    var pnl = document.getElementById('nt-detail');
    if (!nodes.length) { wrap.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999">No hosts found.</div>'; return; }
    var cfg = window.NT_CONFIG;
    var sel = (cfg&&cfg.selected_group_names)||[];
    nodes.forEach(function(n){ n.id=String(n.id); n._primaryGroup=primaryGroup(n,sel); });
    var groupNames=[];
    nodes.forEach(function(n){ if(n._primaryGroup&&groupNames.indexOf(n._primaryGroup)<0) groupNames.push(n._primaryGroup); });

    var elements=[];

    // \u2500\u2500 FIX 1: Gruppen-Farbe als data-Property, nicht als Style-Funktion \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // Compound Nodes deaktiviert

    // \u2500\u2500 FIX 2: bgImage vorberechnen und in node.data speichern \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    nodes.forEach(function(n){
        var nodeData = {
            id: n.id,
            label: (function(n){
                // Verhindert dass IP-Adressen als Label erscheinen
                var lbl = n.label || n.host || '';
                // Wenn label wie eine IP aussieht und host auch verf\u00FCgbar ist, host bevorzugen
                if (/^\d+\.\d+\.\d+\.\d+$/.test(lbl) && n.host && n.host !== lbl) return n.host;
                return lbl || String(n.id);
            })(n),
            // parent deaktiviert
            isGroup: false,
            severity: n.severity||0,
            cpu: n.cpu,
            memory: n.memory,
            ping: n.ping,
            traffic: n.traffic,
            type: n.type,
            host: n.host,
            ip: n.ip,
            iftype: n.iftype,
            groups: n.groups,
            _primaryGroup: n._primaryGroup,
            problems: n.problems || 0,
            pinned: false,   // wird nach cy-Init aus localStorage gesetzt
            note:   ''       // wird nach cy-Init aus localStorage gesetzt
        };
        nodeData.bgImage = makeNodeImage(nodeData);
        elements.push({data: nodeData});
    });

    var nodeIds={}, edgeSeen={};
    nodes.forEach(function(n){ nodeIds[n.id]=true; });
    edges.forEach(function(e,i){
        var src=String(e.source||e.from||''), tgt=String(e.target||e.to||'');
        if(!nodeIds[src]||!nodeIds[tgt]||src===tgt) return;
        var k=[src,tgt].sort().join('_');
        if(edgeSeen[k]) return; edgeSeen[k]=true;
        var srcNode = nodes.find(function(n){ return String(n.id)===src; });
        var tgtNode = nodes.find(function(n){ return String(n.id)===tgt; });
        var tIn  = (srcNode&&srcNode.traffic ? srcNode.traffic.in  : 0) + (tgtNode&&tgtNode.traffic ? tgtNode.traffic.in  : 0);
        var tOut = (srcNode&&srcNode.traffic ? srcNode.traffic.out : 0) + (tgtNode&&tgtNode.traffic ? tgtNode.traffic.out : 0);
        var srcDead = (nodes.find(function(n){ return String(n.id)===src; })||{}).severity||0;
        var tgtDead = (nodes.find(function(n){ return String(n.id)===tgt; })||{}).severity||0;
        var tLabel = (srcDead>=5||tgtDead>=5) ? '\u26A0 No Connection'
                   : (tIn||tOut) ? '\u2193'+fmt(tIn/2)+'\n\u2191'+fmt(tOut/2) : '';
        elements.push({data:{id:'e'+i,source:src,target:tgt,trafficIn:tIn,trafficOut:tOut,tLabel:tLabel,isLLDP:true}});
    });

    if(window._ntEdgeAnim){ clearInterval(window._ntEdgeAnim); window._ntEdgeAnim=null; }
    if(window._ntCy){ try{window._ntCy.destroy();}catch(e){} window._ntCy=null; }
    window._ntToolbarDone=false;
    var oldSev=document.getElementById('nt-sev-filter'); if(oldSev) oldSev.remove();
    var oldSearch=document.getElementById('nt-search-input'); if(oldSearch) oldSearch.remove();
    Array.from(wrap.children).forEach(function(ch){ if(ch.id!=='nt-loading') wrap.removeChild(ch); });
    var cyDiv=document.createElement('div');
    cyDiv.style.cssText='width:100%;height:100%;position:absolute;top:0;left:0';
    wrap.style.position='relative';
    wrap.appendChild(cyDiv);

    if(typeof cytoscapeCola!=='undefined'){ try{ cytoscape.use(cytoscapeCola); }catch(e){} }
    var useLayout = 'cose';
    var dark = !!(document.getElementById('nt-root')&&document.getElementById('nt-root').classList.contains('nt-dark'));

    // Force browser to layout cyDiv before Cytoscape measures it
    cyDiv.style.width = wrap.clientWidth + 'px';
    cyDiv.style.height = wrap.clientHeight + 'px';

    var cy = cytoscape({
        container: cyDiv,
        elements: elements,
        style: [
            {selector:'node[!isGroup]',style:{
                'width':96,'height':96,'background-opacity':0,'border-width':0,
                // \u2500\u2500 FIX 2: data()-Referenz statt Funktion \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
                'background-image':'data(bgImage)',
                'background-fit':'contain','background-clip':'none',
                'label':'data(label)','text-valign':'bottom','text-halign':'center',
                'font-size':11,'font-family':'sans-serif',
                'color':dark?'#e2e8f0':'#334155',
                'text-margin-y':6,'text-background-opacity':dark?0.75:0.85,
                'text-background-color':dark?'#1e293b':'#f8fafc',
                'text-background-padding':'2px','text-background-shape':'roundrectangle',
                'min-zoomed-font-size':8,
            }},
            {selector:'node[?isGroup]',style:{
                // \u2500\u2500 FIX 1: data()-Referenzen f\u00FCr Gruppen-Farben \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
                'background-color':'data(grpColor)',
                'background-opacity':0.07,
                'border-color':'data(grpColor)',
                'border-width':1.5,'border-style':'dashed',
                'label':'data(label)','font-size':12,'font-weight':'bold','font-family':'sans-serif',
                'text-valign':'top','text-halign':'center','text-margin-y':-4,'padding':20,
                'color':'data(grpColor)',
                'shape':'roundrectangle','compound-sizing-wrt-labels':'exclude',
                'padding':52,
            }},
            {selector:'edge',style:{
                'width':2.5,
                'line-color':'#22c55e',
                'line-style':'dashed',
                'line-dash-pattern':[6,5],
                'line-dash-offset':0,
                // Unbundled-Bezier: weiche S-Kurven wie Unifi
                'curve-style':'unbundled-bezier',
                'control-point-distances':[60],
                'control-point-weights':[0.5],
                'target-arrow-shape':'none','opacity':0.85,
                'label':'data(tLabel)',
                'font-size':9,'font-family':'monospace','text-wrap':'wrap',
                'text-background-color':dark?'#1e293b':'#f8fafc',
                'text-background-opacity':0.88,'text-background-padding':'2px',
                'color':dark?'#94a3b8':'#16a34a',
                'line-cap':'round',
                'text-rotation':'none',
                'text-margin-y':-12,
            }},
            // Traffic-Heatmap wird dynamisch via applyTrafficHeatmap() gesetzt
            {selector:'edge.dead-edge',style:{
                'width':1.5,'line-color':'#94a3b8','line-style':'dashed',
                'line-dash-pattern':[4,8],'opacity':0.55,'color':'#ef4444','font-weight':'600',
            }},
            {selector:'node[!isGroup]:selected',style:{
                'underlay-color':'#6366f1','underlay-padding':6,'underlay-opacity':0.25,'underlay-shape':'ellipse',
            }},
        ],
        layout: (function(){
            var _sp = loadPositions();
            var _nodeIds = nodes.map(function(n){ return String(n.id); });
            var _hits = _nodeIds.filter(function(id){ return !!_sp[id]; }).length;
            var _coverage = _nodeIds.length > 0 ? _hits / _nodeIds.length : 0;
            // Preset-Layout nur wenn Positionen auch plausibel sind (nicht alle bei 0,0).
            // Sch\u00FCtzt gegen vergiftete localStorage-Snapshots aus fr\u00FCheren
            // kaputten Init-Durchl\u00E4ufen.
            var _hasNonZero = _nodeIds.some(function(id){
                var p = _sp[id];
                return p && (Math.abs(p.x) > 1 || Math.abs(p.y) > 1);
            });
            if (_coverage >= 0.8 && _hasNonZero) {
                // 80% der Nodes haben gespeicherte Positionen \u2192 Preset-Layout
                return {
                    name: 'preset',
                    positions: function(node) { return _sp[node.id()] || undefined; },
                    padding: 30
                };
            }
            // Kein gespeicherter Stand \u2192 Layout-Heuristik:
            // Bei wenig Konnektivit\u00E4t (edges/nodes < 0.3) ist cose schlecht \u2014
            // isolierte Knoten landen in einer Spalte. Concentric platziert sie
            // gleichm\u00E4\u00DFig im Kreis um die verbundenen Hosts.
            // Schwelle 0.3 = jeder dritte Knoten hat eine Edge im Schnitt.
            var _edgeCount = (typeof edges === 'object' && edges) ? edges.length : 0;
            var _connectivity = _nodeIds.length > 0 ? _edgeCount / _nodeIds.length : 0;
            if (_connectivity < 0.3 && _nodeIds.length > 5) {
                return {
                    name: 'concentric', animate: true, animationDuration: 500,
                    padding: 50, fit: true, minNodeSpacing: 60,
                    // Verbundene Knoten ins Zentrum, isolierte au\u00DFen
                    concentric: function(node) { return node.degree(); },
                    levelWidth: function() { return 1; }
                };
            }
            return {
                name:'cose',animate:true,animationDuration:500,randomize:true,padding:50,
                nodeRepulsion:8000,idealEdgeLength:100,gravity:1,
                fit:true,componentSpacing:40,
            };
        })(),
        userZoomingEnabled:true,userPanningEnabled:true,boxSelectionEnabled:false,
        minZoom:0.1,maxZoom:4,
    });

    window._ntCy=cy; window._ntNodes=nodes; window._ntGroupNames=groupNames; window._ntDataUrl=dataUrl;
    // Force resize after DOM settles
    setTimeout(function(){ if(cy && !cy.destroyed()){ cy.resize(); cy.fit(cy.nodes(),40); } }, 200);
    setTimeout(function(){ if(cy && !cy.destroyed()){ cy.resize(); cy.fit(cy.nodes(),40); } }, 600);
    // fit f\u00FCr preset-Layout (layoutstop deckt das f\u00FCr auto-Layout ab)
    cy.one('layoutready', function() {
        var usedPreset = (loadPositions && Object.keys(loadPositions()).length > 0);
        if (usedPreset) {
            setTimeout(function(){ if(window._ntCy){ window._ntCy.resize(); window._ntCy.fit(window._ntCy.nodes(), 40); } }, 300);
        }
    });

    cy.on('tap','node[!isGroup]',function(e){
        // Link mode \u2014 star
        if(_linkMode) {
            var node = e.target;
            if(!_linkFirst) {
                _linkFirst = node;
                node.style('underlay-color','#3b82f6');
                node.style('underlay-opacity', 0.35);
                node.style('underlay-padding', 8);
                var bLinkBtn = document.getElementById('nt-btn-link');
                if(bLinkBtn) bLinkBtn.textContent = 'Ziele klicken (ESC = fertig)';
                cy.nodes('[!isGroup]').forEach(function(n){
                    if(n.id()!==node.id()) n.style('opacity', 0.25);
                });
            } else {
                if(_linkFirst.id()===node.id()){ exitLinkMode(); return; }
                var s=_linkFirst.id(), t=node.id();
                var eid='ml_'+s+'_'+t, eid2='ml_'+t+'_'+s;
                if(!cy.getElementById(eid).length && !cy.getElementById(eid2).length) {
                    var ml=edgeLabel(cy,s,t);
                    cy.add({data:{id:eid,source:s,target:t,tLabel:ml,trafficIn:0,trafficOut:0}});
                    var lnks=loadLinks(); lnks.push({s:s,t:t}); saveLinks(lnks);
                    node.style('opacity',1);
                    node.style('underlay-color','#22c55e');
                    node.style('underlay-opacity',0.3);
                    node.style('underlay-padding',6);
                    setTimeout(function(){ node.style('underlay-opacity',0); },600);
                }
            }
            return;
        }
        // Path-Highlight: Toggle beim erneuten Klick auf denselben Node
        var clickedId = e.target.id();
        if (_highlightActive === clickedId) {
            resetHighlight(cy);
        } else {
            applyHighlight(cy, clickedId);
        }
        showDetail(pnl,e.target.data(),cy);
    });
    cy.on('mouseover','node[!isGroup]',function(e){ showTip(e, e.target.data()); });
    cy.on('mousemove','node[!isGroup]',function(e){ moveTip(e); });
    cy.on('mouseout', 'node[!isGroup]',function(){ hideTip(); });
    cy.on('tap', function(){ hideTip(); });
    cy.on('tap',function(e){ if(e.target===cy){ if(pnl)pnl.style.display='none'; _ctx.style.display='none'; resetHighlight(cy); } });
    // Doppelklick auf Gruppe: kollabieren / expandieren
    cy.on('dbltap','node[?isGroup]',function(e){
        var grpNode = e.target;
        var grpId   = grpNode.id();
        var children = cy.nodes('[!isGroup]').filter(function(n){ return n.data('parent') === grpId; });
        if (!children.length) return;
        if (_collapsedGroups[grpId]) {
            // Expandieren
            delete _collapsedGroups[grpId];
            children.style('display', 'element');
            cy.edges().filter(function(edge){
                return children.map(function(n){return n.id();}).indexOf(edge.source().id()) >= 0
                    || children.map(function(n){return n.id();}).indexOf(edge.target().id()) >= 0;
            }).style('display', 'element');
            grpNode.data('label', grpNode.data('_origLabel') || grpNode.data('label'));
        } else {
            // Kollabieren
            _collapsedGroups[grpId] = true;
            grpNode.data('_origLabel', grpNode.data('label'));
            grpNode.data('label', grpNode.data('label') + ' (' + children.length + ')');
            children.style('display', 'none');
            cy.edges().filter(function(edge){
                return children.map(function(n){return n.id();}).indexOf(edge.source().id()) >= 0
                    || children.map(function(n){return n.id();}).indexOf(edge.target().id()) >= 0;
            }).style('display', 'none');
        }
    });

    cy.on('cxttap','node[!isGroup]',function(e){
        var oe=e.originalEvent; if(oe)oe.preventDefault();
        hideTip();   // Hover-Tooltip schlie\u00DFen bevor Kontextmen\u00FC erscheint
        var pos=oe?{x:oe.clientX,y:oe.clientY}:e.renderedPosition;
        showCtx(pos.x,pos.y,e.target.data());
    });

    setupToolbar(cy,wrap,nodes,groupNames,dark,useLayout);
    ensureBaseToolbar(wrap);
    setupLegend(groupNames,nodes);
    updateBadge(nodes);

    // \u2500\u2500 Animierte Kanten: flie\u00DFende Punkte + tote Verbindungen gestrichelt grau \u2500\u2500
    startEdgeAnimation(cy, nodes);

    // \u2500\u2500 Traffic-Heatmap (nach Layout-Animation) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    setTimeout(function() { applyTrafficHeatmap(cy); }, 1800);

    // \u2500\u2500 Minimap \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    setupMinimap(cy, wrap);

    // \u2500\u2500 Manuelle Links aus localStorage wiederherstellen \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    applyManualLinks(cy);
    // Minimap einblenden
    if (_minimapEl) _minimapEl.style.display = '';

    // \u2500\u2500 Pinned Nodes + Notizen aus localStorage wiederherstellen \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    (function() {
        var pinned = loadPinned();
        var notes  = loadNotes();
        _imgCache  = {};   // SVG-Cache leeren damit Icons neu gerendert werden
        cy.nodes('[!isGroup]').forEach(function(n) {
            var isPinned = pinned.indexOf(n.id()) >= 0;
            var note     = notes[n.id()] || '';
            n.data('pinned', isPinned);
            n.data('note',   note);
            n.data('bgImage', makeNodeImage(n.data()));
            if (isPinned) n.lock();
        });
    })();

    // \u2500\u2500 Node-Positionen: nach Drag speichern (debounced 400 ms) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    cy.on('dragfree', 'node[!isGroup]', function() {
        clearTimeout(_posSaveTimer);
        _posSaveTimer = setTimeout(function() { savePositions(cy); }, 400);
    });

    // \u2500\u2500 Nach automatischem Layout Positionen einmalig speichern \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    cy.one('layoutstop', function() {
        // Kurz warten bis Animation fertig, dann speichern + fitten
        setTimeout(function() {
            if (window._ntCy) {
                savePositions(window._ntCy);
                window._ntCy.fit(window._ntCy.nodes(), 40);
                applyTrafficHeatmap(window._ntCy);
            }
        }, 800);
    });


    if(_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer=setInterval(function(){
        if(!_refreshOn||!window._ntCy) return;
        fetch(dataUrl,{credentials:'same-origin',headers:{'X-Requested-With':'XMLHttpRequest'}})
            .then(function(r){ return r.json(); })
            .then(function(data){
                var map={};
                (data.nodes||[]).forEach(function(n){ map[String(n.id)]=n; });
                _imgCache={};
                cy.nodes('[!isGroup]').forEach(function(node){
                    var u=map[node.id()]; if(!u) return;
                    node.data('severity',u.severity||0); node.data('cpu',u.cpu);
                    node.data('memory',u.memory); node.data('ping',u.ping); node.data('traffic',u.traffic);
                    // \u2500\u2500 FIX 2: bgImage in data aktualisieren \u2192 Cytoscape re-rendert automatisch
                    if (u.problems !== undefined) node.data('problems', u.problems);
                    node.data('bgImage', makeNodeImage(node.data()));
                });
                updateBadge(data.nodes||[]);
                // refresh manual edge labels
                window._ntCy && window._ntCy.edges('[id^="ml_"]').forEach(function(e){
                    e.data('tLabel', edgeLabel(window._ntCy, e.source().id(), e.target().id()));
                });
                // Traffic-Heatmap neu anwenden (Werte haben sich ggf. ge\u00E4ndert)
                applyTrafficHeatmap(window._ntCy);
            });
    },30000);
}


// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// MANAGEMENT VIEW \u2014 Hierarchische Top-Down Kachelansicht
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

// Ebenen-Reihenfolge nach Device-Type
var MGMT_LEVEL = { firewall:0, router:1, switch:2, wireless:3, hypervisor:4, linux:4, windows:4, macos:4, webserver:4, container:4, mailserver:4, server:4, storage:5, homeauto:6, monitoring:6, ups:7, camera:7, printer:7 };

function mgmtSevStyle(sev) {
    var colors = ['#22c55e','#06b6d4','#f59e0b','#f97316','#ef4444','#991b1b'];
    var labels = ['OK','Info','Warn','Avg','High','Krit'];
    var c = colors[Math.min(sev||0, colors.length-1)];
    var l = labels[Math.min(sev||0, labels.length-1)];
    return { color: c, label: l };
}

function renderManagement(wrap, nodes, edges) {
    // Vorherige Cytoscape-Instanz aufr\u00E4umen
    if (window._ntCy) { try { window._ntCy.destroy(); } catch(e){} window._ntCy = null; }
    if (window._ntEdgeAnim) { clearInterval(window._ntEdgeAnim); window._ntEdgeAnim = null; }
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
    if (window._ntMinimapTimer) { clearInterval(window._ntMinimapTimer); window._ntMinimapTimer = null; }

    // _ntToolbarDone resetten damit beim Wechsel zur\u00FCck zu Technisch die Toolbar neu gebaut wird
    window._ntToolbarDone = false;
    // Minimap verstecken im Management-Tab
    if (_minimapEl) _minimapEl.style.display = 'none';

    // Hinweis: Basis-Toolbar (Tabs + Dark-Button) wird von ensureBaseToolbar()
    // verwaltet, das switchTab() am Ende aufruft. Wir fassen sie hier nicht mehr an.
    // Tech-spezifische Buttons (Fit, Layout, LLDP, Export, Link, Mail, ...) bleiben
    // im DOM stehen, auch wenn sie in Management funktionslos sind \u2014 das ist billiger
    // als sie rauszurei\u00DFen und beim R\u00FCckwechsel zu Technisch neu zu binden.

    // Canvas leeren
    Array.from(wrap.children).forEach(function(ch) {
        if (ch.id !== 'nt-loading') wrap.removeChild(ch);
    });

    var dark = !!(document.getElementById('nt-root') && document.getElementById('nt-root').classList.contains('nt-dark'));
    var bg   = dark ? '#0d1117' : '#f0f2f5';
    var card = dark ? '#161b22' : '#ffffff';
    var text = dark ? '#e6edf3' : '#1e293b';
    var sub  = dark ? '#8b949e' : '#64748b';
    var bdr  = dark ? '#30363d' : '#e2e8f0';

    // Container
    var container = document.createElement('div');
    container.style.cssText = 'width:100%;height:100%;overflow-y:auto;overflow-x:hidden;padding:24px 20px;box-sizing:border-box;background:'+bg;

    // Nodes nach Level gruppieren
    var levels = {};
    nodes.forEach(function(n) {
        var lvl = MGMT_LEVEL[n.type] !== undefined ? MGMT_LEVEL[n.type] : 4;
        if (!levels[lvl]) levels[lvl] = [];
        levels[lvl].push(n);
    });

    var sortedLevels = Object.keys(levels).map(Number).sort(function(a,b){return a-b;});

    var levelNames = { 0:'Firewall / Gateway', 1:'Router', 2:'Switch', 3:'Wireless', 4:'Server / Virtualisierung', 5:'Storage / NAS', 6:'Home Automatisierung / Monitoring', 7:'Geraete' };

    // Notizen einmal laden (nicht pro Node in der Schleife)
    var _mgmtNotes = loadNotes();

    sortedLevels.forEach(function(lvl) {
        var lvlNodes = levels[lvl];

        // Ebenen-Header
        var header = document.createElement('div');
        header.style.cssText = 'font-size:11px;font-weight:700;color:'+sub+';text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;padding-bottom:4px;border-bottom:1px solid '+bdr+';margin-top:'+(lvl===sortedLevels[0]?'0':'24px');
        header.textContent = levelNames[lvl] || ('Ebene '+lvl);
        container.appendChild(header);

        // Kacheln-Row
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;margin-bottom:4px';

        lvlNodes.sort(function(a,b){ return (b.severity||0)-(a.severity||0)||(a.label||'').localeCompare(b.label||''); });

        lvlNodes.forEach(function(n) {
            var sev = mgmtSevStyle(n.severity);
            var noteText = _mgmtNotes[String(n.id)] || '';
            var problems = n.problems || 0;

            var tile = document.createElement('div');
            tile.style.cssText = [
                'width:190px;min-height:80px;background:'+card,
                'border:1.5px solid '+sev.color,
                'border-radius:10px;padding:12px 14px',
                'cursor:pointer;position:relative',
                'box-shadow:0 1px 4px rgba(0,0,0,0.07)',
                'transition:box-shadow 0.15s,transform 0.15s',
                'box-sizing:border-box'
            ].join(';');

            // Ampel-Dot + Severity
            var topRow = document.createElement('div');
            topRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px';
            var dot = document.createElement('div');
            dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:'+sev.color+';flex-shrink:0';
            var sevLbl = document.createElement('span');
            sevLbl.style.cssText = 'font-size:10px;font-weight:700;color:'+sev.color;
            sevLbl.textContent = sev.label;
            topRow.appendChild(dot);
            topRow.appendChild(sevLbl);

            // Problem-Counter
            if (problems > 0) {
                var badge = document.createElement('span');
                badge.style.cssText = 'margin-left:auto;background:#ef4444;color:#fff;border-radius:10px;font-size:9px;font-weight:700;padding:1px 5px;flex-shrink:0';
                badge.textContent = problems > 99 ? '99+' : String(problems);
                topRow.appendChild(badge);
            }
            tile.appendChild(topRow);

            // Name
            var name = document.createElement('div');
            name.style.cssText = 'font-size:13px;font-weight:600;color:'+text+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
            name.title = n.label;
            name.textContent = n.label;
            tile.appendChild(name);

            // IP
            if (n.ip) {
                var ip = document.createElement('div');
                ip.style.cssText = 'font-size:10px;color:'+sub+';margin-top:2px';
                ip.textContent = n.ip;
                tile.appendChild(ip);
            }

            // Metriken (CPU/Memory wenn vorhanden)
            if (n.cpu != null || n.memory != null) {
                var metrics = document.createElement('div');
                metrics.style.cssText = 'display:flex;gap:8px;margin-top:6px;font-size:10px;color:'+sub;
                if (n.cpu != null)    metrics.innerHTML += '<span>CPU '+n.cpu+'%</span>';
                if (n.memory != null) metrics.innerHTML += '<span>RAM '+n.memory+'%</span>';
                tile.appendChild(metrics);
            }

            // Notiz
            if (noteText) {
                var noteEl = document.createElement('div');
                noteEl.style.cssText = 'font-size:10px;color:#f59e0b;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
                noteEl.title = noteText;
                noteEl.textContent = 'Note: '+noteText;
                tile.appendChild(noteEl);
            }

            // Hover
            tile.addEventListener('mouseenter', function(){ tile.style.boxShadow='0 4px 16px rgba(0,0,0,0.12)'; tile.style.transform='translateY(-2px)'; });
            tile.addEventListener('mouseleave', function(){ tile.style.boxShadow='0 1px 4px rgba(0,0,0,0.07)'; tile.style.transform=''; });

            // Klick -> Kontextmen\u00FC
            tile.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                showCtx(e.clientX, e.clientY, n);
            });

            // Linksklick -> Detail
            tile.addEventListener('click', function() {
                var pnl = document.getElementById('nt-detail');
                if (pnl) showDetail(pnl, n, { getElementById: function(){ return { data:function(){return{};}, connectedEdges:function(){ return { forEach:function(){} }; } }; } });
            });

            row.appendChild(tile);
        });

        container.appendChild(row);
    });

    wrap.appendChild(container);
}


// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// MINIMAP \u2014 SVG-\u00DCbersichtskarte unten rechts
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

var _minimapEl = null;
var _minimapTimer = null;

function setupMinimap(cy, wrap) {
    // Container erstellen
    if (!_minimapEl) {
        _minimapEl = document.createElement('div');
        _minimapEl.id = 'nt-minimap';
        _minimapEl.style.cssText = [
            'position:absolute;bottom:16px;right:16px',
            'width:180px;height:120px',
            'background:rgba(255,255,255,0.92)',
            'border:1px solid #e2e8f0',
            'border-radius:8px',
            'box-shadow:0 2px 8px rgba(0,0,0,0.12)',
            'overflow:hidden;cursor:pointer',
            'z-index:40',
            'backdrop-filter:blur(4px)'
        ].join(';');
        _minimapEl.title = 'Minimap \u2014 klicken zum Navigieren';
        wrap.appendChild(_minimapEl);
    }

    function drawMinimap() {
        if (!window._ntCy || !_minimapEl) return;
        var MM_W = 180, MM_H = 120, PAD = 8;

        // Alle sichtbaren Nodes sammeln
        var visNodes = [];
        cy.nodes('[!isGroup]').forEach(function(n) {
            if (n.style('display') === 'none') return;
            var p = n.position();
            visNodes.push({ x: p.x, y: p.y, sev: n.data('severity')||0 });
        });
        if (!visNodes.length) return;

        // Bounding box der Nodes
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        visNodes.forEach(function(n) {
            if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
        });
        var rangeX = Math.max(maxX - minX, 1);
        var rangeY = Math.max(maxY - minY, 1);
        var scaleX = (MM_W - PAD*2) / rangeX;
        var scaleY = (MM_H - PAD*2) / rangeY;
        var scale  = Math.min(scaleX, scaleY);

        function tx(x) { return PAD + (x - minX) * scale; }
        function ty(y) { return PAD + (y - minY) * scale; }

        // Viewport-Rechteck berechnen
        var ext = cy.extent();
        var vpX1 = isFinite(ext.x1) ? tx(ext.x1) : 0;
        var vpY1 = isFinite(ext.y1) ? ty(ext.y1) : 0;
        var vpX2 = isFinite(ext.x2) ? tx(ext.x2) : MM_W;
        var vpY2 = isFinite(ext.y2) ? ty(ext.y2) : MM_H;
        vpX1 = Math.max(0, Math.min(MM_W, vpX1));
        vpY1 = Math.max(0, Math.min(MM_H, vpY1));
        vpX2 = Math.max(vpX1 + 4, Math.min(MM_W, vpX2));
        vpY2 = Math.max(vpY1 + 4, Math.min(MM_H, vpY2));

        var sevColors = ['#22c55e','#06b6d4','#f59e0b','#f97316','#ef4444','#991b1b'];

        // SVG aufbauen
        var dots = visNodes.map(function(n) {
            var col = sevColors[Math.min(n.sev, sevColors.length-1)];
            return '<circle cx="'+tx(n.x).toFixed(1)+'" cy="'+ty(n.y).toFixed(1)+'" r="3" fill="'+col+'" opacity="0.85"/>';
        }).join('');

        var vpRect = '<rect x="'+vpX1.toFixed(1)+'" y="'+vpY1.toFixed(1)+
            '" width="'+(vpX2-vpX1).toFixed(1)+'" height="'+(vpY2-vpY1).toFixed(1)+
            '" fill="rgba(59,130,246,0.08)" stroke="#3b82f6" stroke-width="1.5" rx="2"/>';

        var dark = document.getElementById('nt-root') && document.getElementById('nt-root').classList.contains('nt-dark');
        var bg = dark ? 'rgba(22,27,34,0.95)' : 'rgba(255,255,255,0.95)';

        _minimapEl.style.background = bg;
        _minimapEl.innerHTML = '<svg width="'+MM_W+'" height="'+MM_H+'" xmlns="http://www.w3.org/2000/svg">'
            + dots + vpRect + '</svg>';
    }

    // Klick auf Minimap = Pan zu dieser Position
    _minimapEl.addEventListener('click', function(e) {
        var rect = _minimapEl.getBoundingClientRect();
        var MM_W = 180, MM_H = 120, PAD = 8;
        var relX = e.clientX - rect.left;
        var relY = e.clientY - rect.top;

        var visNodes = [];
        cy.nodes('[!isGroup]').forEach(function(n) {
            if (n.style('display') !== 'none') visNodes.push(n.position());
        });
        if (!visNodes.length) return;

        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        visNodes.forEach(function(p) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        });
        var scale = Math.min((MM_W-PAD*2)/Math.max(maxX-minX,1), (MM_H-PAD*2)/Math.max(maxY-minY,1));

        var worldX = minX + (relX - PAD) / scale;
        var worldY = minY + (relY - PAD) / scale;
        cy.animate({ pan: { x: wrap.clientWidth/2 - worldX * cy.zoom(), y: wrap.clientHeight/2 - worldY * cy.zoom() } }, { duration: 200 });
    });

    // Bei Zoom/Pan neu zeichnen
    cy.on('zoom pan', function() {
        clearTimeout(_minimapTimer);
        _minimapTimer = setTimeout(drawMinimap, 80);
    });

    // Initial zeichnen
    setTimeout(drawMinimap, 1000);

    // Regelm\u00E4\u00DFig aktualisieren \u2014 Referenz speichern damit wir clearen k\u00F6nnen
    if (window._ntMinimapTimer) clearInterval(window._ntMinimapTimer);
    window._ntMinimapTimer = setInterval(drawMinimap, 5000);
}

function updateBadge(nodes) {
    var badge=document.getElementById('nt-badge'); if(!badge) return;
    var ok=0,warn=0,down=0;
    nodes.forEach(function(n){ var s=n.severity||0; if(s===0)ok++; else if(s>=5)down++; else warn++; });
    badge.innerHTML='<b>'+nodes.length+'</b> Hosts &nbsp;|&nbsp; <span style="color:#22c55e"><b>'+ok+'</b> OK</span> &nbsp;|&nbsp; <span style="color:#f59e0b"><b>'+warn+'</b> Warn</span> &nbsp;|&nbsp; <span style="color:#ef4444"><b>'+down+'</b> Down</span>';
}

function ntShowExportOverlay(png, printMode) {
    var ov = document.getElementById('nt-export-overlay');
    if(ov) ov.remove();
    ov = document.createElement('div');
    ov.id = 'nt-export-overlay';
    ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.88);'
        +'z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer';
    var hint = printMode
        ? 'Cmd+P zum Drucken / Als PDF sichern &nbsp;\u00B7&nbsp; Klick zum Schliessen'
        : 'Rechtsklick auf Bild \u2192 "Bild sichern unter..." &nbsp;\u00B7&nbsp; Klick zum Schliessen';
    ov.innerHTML = '<div style="color:#ccc;font-family:sans-serif;font-size:12px;margin-bottom:12px;text-align:center">'+hint+'</div>'
        + '<img src="'+png+'" style="max-width:95vw;max-height:85vh;display:block;border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,0.5)"/>';
    ov.addEventListener('click', function(){ ov.remove(); });
    document.body.appendChild(ov);
    if(printMode) setTimeout(function(){ window.print(); }, 500);
}

// \u2500\u2500 Manual Link helpers (module-level so all functions can access them) \u2500\u2500\u2500\u2500\u2500\u2500

var _linkMode = false, _linkFirst = null;
var _posSaveTimer = null;
var _collapsedGroups = {};   // groupId -> true wenn kollabiert

// \u2500\u2500 localStorage-Keys \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Alle Keys bekommen ein User-Prefix "u<id>_" eingeschoben, damit mehrere
// Zabbix-User am selben Browser nicht dieselben Pins/Notes/Positionen sehen.
// F\u00E4llt bei fehlender user_id auf den alten Key ohne Prefix zur\u00FCck \u2014
// dann verhalten sich die Daten wie vor der Multi-User-Trennung.

function userPrefix() {
    var cfg = window.NT_CONFIG;
    var uid = cfg && cfg.user_id ? String(cfg.user_id) : '';
    return (uid && uid !== '0') ? 'u' + uid + '_' : '';
}

// Legacy-Keys (vor Multi-User-Trennung)
var NT_POS_PREFIX_LEGACY    = 'nt_pos_';
var NT_PINNED_PREFIX_LEGACY = 'nt_pinned_';
var NT_NOTES_PREFIX_LEGACY  = 'nt_notes_';
var NT_LINKS_KEY_LEGACY     = 'nt_manual_links';
var NT_LLDP_KEY_LEGACY      = 'nt_lldp_visible';
var NT_TAB_KEY_LEGACY       = 'nt_active_tab';

// Aktuelle Keys (mit User-Prefix)
var NT_POS_PREFIX    = 'nt_' + userPrefix() + 'pos_';
var NT_PINNED_PREFIX = 'nt_' + userPrefix() + 'pinned_';
var NT_NOTES_PREFIX  = 'nt_' + userPrefix() + 'notes_';
var NT_LINKS_KEY     = 'nt_' + userPrefix() + 'manual_links';
var NT_LLDP_KEY      = 'nt_' + userPrefix() + 'lldp_visible';
var NT_TAB_KEY       = 'nt_' + userPrefix() + 'active_tab';

// \u2500\u2500 Einmalige Migration von Legacy-Keys f\u00FCr diesen User \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Wir kopieren (nicht verschieben) die alten Keys, damit andere User am selben
// Browser ihre Daten nicht verlieren. Sentinel verhindert Mehrfach-Migration.
(function migrateLegacyKeys() {
    var prefix = userPrefix();
    if (!prefix) return;   // Kein User bekannt \u2192 nichts zu tun
    var sentinel = 'nt_' + prefix + 'migrated';
    try {
        if (localStorage.getItem(sentinel)) return;
    } catch(e) { return; }

    try {
        // Prefix-Keys: Keys erst einsammeln, DANACH schreiben \u2014 sonst
        // verschiebt setItem() die Indizes w\u00E4hrend der Iteration.
        var mappings = [
            [NT_POS_PREFIX_LEGACY,    NT_POS_PREFIX],
            [NT_PINNED_PREFIX_LEGACY, NT_PINNED_PREFIX],
            [NT_NOTES_PREFIX_LEGACY,  NT_NOTES_PREFIX]
        ];
        var toMigrate = [];
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (!key) continue;
            for (var m = 0; m < mappings.length; m++) {
                var oldP = mappings[m][0], newP = mappings[m][1];
                if (key.indexOf(oldP) === 0 && key.indexOf(newP) !== 0) {
                    var newKey = newP + key.substring(oldP.length);
                    toMigrate.push([key, newKey]);
                }
            }
        }
        toMigrate.forEach(function(pair) {
            if (localStorage.getItem(pair[1]) === null) {
                var val = localStorage.getItem(pair[0]);
                if (val !== null) localStorage.setItem(pair[1], val);
            }
        });
        // Einzelne Keys
        [[NT_LINKS_KEY_LEGACY, NT_LINKS_KEY],
         [NT_LLDP_KEY_LEGACY,  NT_LLDP_KEY],
         [NT_TAB_KEY_LEGACY,   NT_TAB_KEY]].forEach(function(pair) {
            var oldV = localStorage.getItem(pair[0]);
            if (oldV !== null && localStorage.getItem(pair[1]) === null) {
                localStorage.setItem(pair[1], oldV);
            }
        });
        localStorage.setItem(sentinel, String(Date.now()));
    } catch(e) {}
})();

// _activeTab wurde weiter oben deklariert, aber nicht initialisiert \u2014 erst
// jetzt (nachdem NT_TAB_KEY und die Migration stehen) den Wert lesen.
try { _activeTab = localStorage.getItem(NT_TAB_KEY) || 'tech'; } catch(e) { _activeTab = 'tech'; }

// \u2500\u2500 Pinned-Node helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function pinnedKey() {
    var cfg = window.NT_CONFIG;
    var ids = (cfg && cfg.selected_groupids) ? cfg.selected_groupids.slice().sort() : [];
    return NT_PINNED_PREFIX + ids.join('_');
}
function loadPinned() {
    try { return JSON.parse(localStorage.getItem(pinnedKey()) || '[]'); } catch(e) { return []; }
}
function savePinned(cyInst) {
    var ids = [];
    cyInst.nodes('[!isGroup]').forEach(function(n) { if (n.locked()) ids.push(n.id()); });
    try { localStorage.setItem(pinnedKey(), JSON.stringify(ids)); } catch(e) {}
}
function clearPinned() {
    try { localStorage.removeItem(pinnedKey()); } catch(e) {}
}

// \u2500\u2500 Node-Notizen helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function notesKey() {
    var cfg = window.NT_CONFIG;
    var ids = (cfg && cfg.selected_groupids) ? cfg.selected_groupids.slice().sort() : [];
    return NT_NOTES_PREFIX + ids.join('_');
}
function loadNotes() {
    try { return JSON.parse(localStorage.getItem(notesKey()) || '{}'); } catch(e) { return {}; }
}
function saveNote(hostId, text) {
    var notes = loadNotes();
    if (text && text.trim()) {
        notes[hostId] = text.trim();
    } else {
        delete notes[hostId];
    }
    try { localStorage.setItem(notesKey(), JSON.stringify(notes)); } catch(e) {}
    return notes;
}

// \u2500\u2500 Node-Position helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function posKey() {
    var cfg = window.NT_CONFIG;
    var ids = (cfg && cfg.selected_groupids) ? cfg.selected_groupids.slice().sort() : [];
    return NT_POS_PREFIX + ids.join('_');
}
function loadPositions() {
    try { return JSON.parse(localStorage.getItem(posKey()) || 'null') || {}; } catch(e) { return {}; }
}
function savePositions(cyInst) {
    var pos = {};
    var nonZero = 0;
    cyInst.nodes('[!isGroup]').forEach(function(n) {
        var p = n.position();
        pos[n.id()] = { x: Math.round(p.x), y: Math.round(p.y) };
        if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) nonZero++;
    });
    // Degenerate snapshot (alle Nodes bei 0,0) nicht persistieren \u2014 sonst
    // bleibt bei n\u00E4chstem Reload die Karte leer, weil das Preset-Layout greift.
    if (nonZero === 0) return;
    try { localStorage.setItem(posKey(), JSON.stringify(pos)); } catch(e) {}
}
function clearPositions() {
    try { localStorage.removeItem(posKey()); } catch(e) {}
}

function exitLinkMode() {
    _linkMode = false;
    if(_linkFirst) { try{ _linkFirst.style('underlay-opacity', 0); }catch(e){} _linkFirst = null; }
    window._ntCy && window._ntCy.nodes('[!isGroup]').forEach(function(n){ n.style('opacity', 1); });
    var bLinkBtn = document.getElementById('nt-btn-link');
    if(bLinkBtn) { bLinkBtn.style.background=''; bLinkBtn.style.color=''; bLinkBtn.textContent='Link'; }
    var wrap = document.getElementById('nt-canvas-wrap');
    if(wrap) wrap.style.cursor = '';
}

function edgeLabel(cyInst, srcId, tgtId) {
    var sn = cyInst.getElementById(String(srcId)).data();
    var tn = cyInst.getElementById(String(tgtId)).data();
    if((sn.severity||0)>=5 || (tn.severity||0)>=5) return '\u26A0 No Connection';
    var tIn  = ((sn.traffic&&sn.traffic.in)||0)  + ((tn.traffic&&tn.traffic.in)||0);
    var tOut = ((sn.traffic&&sn.traffic.out)||0) + ((tn.traffic&&tn.traffic.out)||0);
    return tIn||tOut ? '\u2193'+fmt(tIn/2)+'\n\u2191'+fmt(tOut/2) : '';
}
function loadLinks() {
    try { return JSON.parse(localStorage.getItem(NT_LINKS_KEY)||'[]'); } catch(e){ return []; }
}
function saveLinks(links) {
    localStorage.setItem(NT_LINKS_KEY, JSON.stringify(links));
}
function applyManualLinks(cyInst) {
    var links = loadLinks();
    var existingIds = {};
    cyInst.edges().forEach(function(e){ existingIds[e.id()]=true; });
    links.forEach(function(l) {
        var id = 'ml_'+l.s+'_'+l.t;
        if(existingIds[id]) return;
        if(!cyInst.getElementById(String(l.s)).length) return;
        if(!cyInst.getElementById(String(l.t)).length) return;
        var ml2 = edgeLabel(cyInst, l.s, l.t);
        cyInst.add({data:{id:id, source:String(l.s), target:String(l.t), tLabel:ml2, trafficIn:0, trafficOut:0}});
    });
}

function setupToolbar(cy, wrap, nodes, groupNames, isDark, useLayout) {
    var bar=document.querySelector('.nt-topbar__actions');
    var isFirstRun = !window._ntToolbarDone;
    window._ntToolbarDone = true;

    // Tabs + Dark-Button werden von ensureBaseToolbar() gemanagt (einmalig, idempotent).
    // Hier bauen wir nur noch tech-spezifische Buttons.
    var darkMode=isDark;
    function mkbtn(id,lbl,fn){
        var existing = id ? document.getElementById(id) : null;
        if(existing) return existing;
        var b=document.createElement('button');
        b.className='btn-alt btn-small'; b.style.marginLeft='4px'; b.textContent=lbl;
        if(id) b.id=id;
        if(fn) b.addEventListener('click',fn);
        if(bar && isFirstRun) bar.appendChild(b);
        return b;
    }

    var bIn=document.getElementById('nt-btn-zoom-in'), bOut=document.getElementById('nt-btn-zoom-out');
    if(bIn)  { bIn.onclick=null; bIn.addEventListener('click',  function(){ cy.zoom({level:cy.zoom()*1.3,renderedPosition:{x:wrap.clientWidth/2,y:wrap.clientHeight/2}}); }); }
    if(bOut) { bOut.onclick=null; bOut.addEventListener('click', function(){ cy.zoom({level:cy.zoom()*0.77,renderedPosition:{x:wrap.clientWidth/2,y:wrap.clientHeight/2}}); }); }

    var bLbl=document.getElementById('nt-btn-labels');
    if(bLbl) bLbl.onclick=function(){ var hide=this.textContent.indexOf('Hide')>=0; cy.nodes('[!isGroup]').style('label',hide?'':'data(label)'); this.textContent=hide?'Show Labels':'Hide Labels'; };

    var bFs=document.getElementById('nt-btn-fullscreen');
    if(bFs) bFs.addEventListener('click',function(){ var root=document.getElementById('nt-root'); if(!document.fullscreenElement&&!document.webkitFullscreenElement){ (root.requestFullscreen||root.webkitRequestFullscreen).call(root); bFs.textContent='Exit Fullscreen'; }else{ (document.exitFullscreen||document.webkitExitFullscreen).call(document); bFs.textContent='Fullscreen'; } });

    var bReset=mkbtn('nt-btn-reset','Fit',null);
    bReset.addEventListener('click',function(){
        cy.fit(cy.nodes(),40);
        // Positionen nach Fit neu speichern (Pan/Zoom \u00E4ndert nichts an node.position(),
        // aber sicherheitshalber nach kurzer Pause nochmal schreiben)
        setTimeout(function(){ savePositions(cy); }, 200);
    });

    // Dark-Button wird von ensureBaseToolbar() / applyDarkMode() verwaltet.

    var bLayout=mkbtn('nt-btn-layout','\u21BB Layout',null);
    bLayout.onclick=function(){
        clearPositions();
        var pinnedNodes=cy.nodes('[!isGroup]').filter(function(n){return n.locked();});
        pinnedNodes.unlock();
        cy.resize();
        var lo=cy.layout({name:'cose',animate:true,animationDuration:600,randomize:true,padding:30,nodeRepulsion:8000,fit:true});
        lo.one('layoutstop',function(){setTimeout(function(){pinnedNodes.lock();savePositions(cy);savePinned(cy);cy.fit(cy.nodes(),40);},400);});
        lo.run();
    };
    mkbtn('nt-btn-auto','Auto: 30s',function(){ _refreshOn=!_refreshOn; this.textContent=_refreshOn?'Auto: 30s':'Auto: Off'; this.style.opacity=_refreshOn?'1':'0.5'; });

    // LLDP-Kanten Toggle
    var _lldpVisible = localStorage.getItem(NT_LLDP_KEY) !== '0';
    var bLldp = mkbtn('nt-btn-lldp', _lldpVisible ? ' LLDP: an' : ' LLDP: aus', null);
    bLldp.style.opacity = _lldpVisible ? '1' : '0.5';
    // Initialen Zustand anwenden
    if (!_lldpVisible) {
        cy.edges('[?isLLDP]').style('display', 'none');
    }
    bLldp.addEventListener('click', function() {
        _lldpVisible = !_lldpVisible;
        localStorage.setItem(NT_LLDP_KEY, _lldpVisible ? '1' : '0');
        cy.edges('[?isLLDP]').style('display', _lldpVisible ? 'element' : 'none');
        bLldp.textContent = _lldpVisible ? ' LLDP: an' : ' LLDP: aus';
        bLldp.style.opacity = _lldpVisible ? '1' : '0.5';
    });


    (function() {
        var existing=document.getElementById('nt-export-wrap'); if(existing) existing.remove();
        var expWrap=document.createElement('div'); expWrap.id='nt-export-wrap';
        expWrap.style.cssText='position:relative;display:inline-block;margin-left:4px';
        var expBtn=document.createElement('button'); expBtn.className='btn-alt btn-small'; expBtn.style.margin='0'; expBtn.textContent='\u2B07 Export';
        var expMenu=document.createElement('div');
        expMenu.style.cssText='display:none;position:absolute;top:100%;left:0;z-index:9999;background:#fff;border:1px solid #e2e8f0;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:150px;overflow:hidden;margin-top:2px';
        function mItem(icon,label,fn){var row=document.createElement('div');row.style.cssText='padding:8px 14px;cursor:pointer;font-size:13px;color:#334155;white-space:nowrap;display:flex;align-items:center;gap:8px';row.innerHTML='<span>'+icon+'</span><span>'+label+'</span>';row.addEventListener('mouseover',function(){this.style.background='#f8fafc';});row.addEventListener('mouseout',function(){this.style.background='';});row.addEventListener('click',function(){expMenu.style.display='none';fn();});expMenu.appendChild(row);}
        function buildReport(){if(!window._ntCy||!window._ntNodes)return null;var nodes=window._ntNodes,links=loadLinks(),now=new Date().toLocaleString('de-DE');var SLBL=['Normal','Info','Warning','Average','High','Disaster'],SCOL={Normal:'#22c55e',Info:'#06b6d4',Warning:'#f59e0b',Average:'#f97316',High:'#ef4444',Disaster:'#991b1b'};var mapImg=window._ntCy.png({full:true,scale:2,bg:'#ffffff'});var rows=nodes.slice().sort(function(a,b){return(b.severity||0)-(a.severity||0)||(a.label||'').localeCompare(b.label||'');}).map(function(n){var sev=SLBL[n.severity||0]||'Normal',col=SCOL[sev]||'#22c55e',tr=n.traffic||{in:0,out:0};return'<tr><td>'+esc(n.label||n.host)+'</td><td><span style="color:'+col+';font-weight:600">&#9679; '+sev+'</span></td><td>'+(n.ip||'\u2014')+'</td><td>'+(n.cpu!=null?n.cpu+'%':'\u2014')+'</td><td>'+(n.memory!=null?n.memory+'%':'\u2014')+'</td><td>'+(n.ping>0?n.ping+' ms':'\u2014')+'</td><td style="color:#22c55e">'+fmt(tr.in)+'</td><td style="color:#06b6d4">'+fmt(tr.out)+'</td></tr>';}).join('');return'<!DOCTYPE html><html><head><meta charset="utf-8"><title>NT Report</title><style>body{font-family:sans-serif;margin:20px;color:#1e293b}h1{font-size:18px;border-bottom:2px solid #3b82f6;padding-bottom:6px}.meta{font-size:11px;color:#64748b;margin-bottom:16px}.map{text-align:center;margin-bottom:20px}.map img{max-width:100%;border:1px solid #e2e8f0;border-radius:6px}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#f8fafc;padding:7px 10px;text-align:left;border-bottom:2px solid #e2e8f0;color:#475569}td{padding:6px 10px;border-bottom:1px solid #f1f5f9}@media print{@page{size:A4 landscape;margin:10mm}}</style></head><body><h1>Network Topology &mdash; Report</h1><div class="meta">'+now+' &nbsp;|&nbsp; '+nodes.length+' Hosts &nbsp;|&nbsp; '+links.length+' Links</div><div class="map"><img src="'+mapImg+'"/></div><table><thead><tr><th>Name</th><th>Status</th><th>IP</th><th>CPU</th><th>Memory</th><th>Ping</th><th>IN</th><th>OUT</th></tr></thead><tbody>'+rows+'</tbody></table></body></html>';}
        mItem('&#128444;','PNG',function(){if(!window._ntCy)return;ntShowExportOverlay(window._ntCy.png({full:true,scale:2,bg:darkMode?'#0f172a':'#f8fafc'}),false);});
        mItem('&#128196;','PDF (Drucken)',function(){var h=buildReport();if(!h)return;var w=window.open();if(w){w.document.write(h);w.document.close();setTimeout(function(){w.print();},800);}});
        mItem('&#128190;','HTML speichern',function(){var h=buildReport();if(!h)return;var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([h],{type:'text/html'}));a.download='network-topology-'+new Date().toISOString().slice(0,10)+'.html';document.body.appendChild(a);a.click();document.body.removeChild(a);});
        var divider=document.createElement('div');divider.style.cssText='border-top:1px solid #f1f5f9;margin:2px 0';expMenu.appendChild(divider);
        mItem('&#128231;','Per Mail senden',function(){var to=prompt('Report senden an (E-Mail):');if(!to||!to.trim())return;var h=buildReport();if(!h)return;var cfg=window.NT_CONFIG;var mailUrl=cfg.data_url.replace('network.topology.v6.data','network.topology.v6.mail');var b64=btoa(unescape(encodeURIComponent(h)));var _csrf=(window.NT_CONFIG&&window.NT_CONFIG.csrf_token)||'';fetch(mailUrl,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'},body:'to='+encodeURIComponent(to.trim())+'&html_b64='+encodeURIComponent(b64)+'&_csrf_token='+encodeURIComponent(_csrf)}).then(function(r){return r.json();}).then(function(d){alert(d.success?'\u2705 Gesendet an: '+to:'\u274C Fehler: '+(d.error||'Unbekannt'));}).catch(function(e){alert('\u274C Fehler: '+e.message);});});
        expBtn.addEventListener('click',function(e){e.stopPropagation();expMenu.style.display=expMenu.style.display==='none'?'block':'none';});
        document.addEventListener('click',function(){expMenu.style.display='none';});
        expWrap.appendChild(expBtn);expWrap.appendChild(expMenu);
        if(bar&&isFirstRun)bar.appendChild(expWrap);
    })();

    // Manual link mode (state + helpers defined at module level)

    var bLink = mkbtn('nt-btn-link', 'Link', null);
    bLink.title = 'Stern-Modus: Quelle w\u00E4hlen, dann beliebig viele Ziele klicken. ESC oder Quelle nochmal = fertig.';


    bLink.onclick = function(){
        if(_linkMode) { exitLinkMode(); return; }
        resetHighlight(cy);   // Highlight vor Link-Modus zur\u00FCcksetzen
        _linkMode = true; _linkFirst = null;
        bLink.style.background = '#dbeafe';
        bLink.style.color = '#1d4ed8';
        bLink.textContent = 'Abbrechen (ESC)';
        document.getElementById('nt-canvas-wrap').style.cursor = 'crosshair';
    };

    document.addEventListener('keydown', function(e){ if(e.key==='Escape' && _linkMode) exitLinkMode(); });

    var bUnlink = mkbtn('nt-btn-unlink', '\u2715 Links', null);
    bUnlink.title = 'Alle manuellen Links l\u00F6schen';
    bUnlink.onclick = function(){
        if(!confirm('Alle manuellen Verbindungen l\u00F6schen?')) return;
        saveLinks([]);
        window._ntCy && window._ntCy.edges('[id^="ml_"]').remove();
    };


    // Mail button
    var bMail = mkbtn('nt-btn-mail', 'Mail', null);
    bMail.onclick = function(){
        if(!window._ntCy || !window._ntNodes) return;
        var to = prompt('Report senden an (E-Mail):');
        if(!to || !to.trim()) return;

        var nodes = window._ntNodes;
        var links = loadLinks();
        var now = new Date().toLocaleString('de-DE');
        var SEV_COLORS = {'Normal':'#22c55e','Info':'#06b6d4','Warning':'#f59e0b','Average':'#f97316','High':'#ef4444','Disaster':'#991b1b'};
        var SEV_LBL = ['Normal','Info','Warning','Average','High','Disaster'];

        var rows = nodes.slice().sort(function(a,b){ return (b.severity||0)-(a.severity||0)||(a.label||'').localeCompare(b.label||''); })
            .map(function(n){
                var sev = SEV_LBL[n.severity||0]||'Normal';
                var col = SEV_COLORS[sev]||'#22c55e';
                var tr = (n.traffic||{in:0,out:0});
                return '<tr>'
                    +'<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9">'+esc(n.label||n.host)+'</td>'
                    +'<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9"><span style="color:'+col+';font-weight:600">&#9679; '+sev+'</span></td>'
                    +'<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9">'+(n.cpu!=null?n.cpu+'%':'\u2014')+'</td>'
                    +'<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9">'+(n.memory!=null?n.memory+'%':'\u2014')+'</td>'
                    +'<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9">'+(n.ping>0?n.ping+' ms':'\u2014')+'</td>'
                    +'<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#22c55e">'+fmt(tr.in)+'</td>'
                    +'<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#06b6d4">'+fmt(tr.out)+'</td>'
                    +'<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#94a3b8;font-size:11px">'+esc(n.ip||'\u2014')+'</td>'
                    +'</tr>';
            }).join('');

        var html = '<html><body style="font-family:sans-serif;color:#1e293b;max-width:900px;margin:20px auto">'
            +'<h2 style="border-bottom:2px solid #3b82f6;padding-bottom:6px">Network Topology Report</h2>'
            +'<p style="color:#64748b;font-size:12px">'+now+' &nbsp;|&nbsp; '+nodes.length+' Hosts &nbsp;|&nbsp; '+links.length+' Links</p>'
            +'<table style="width:100%;border-collapse:collapse;font-size:13px">'
            +'<thead><tr style="background:#f8fafc">'
            +'<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0">Name</th>'
            +'<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0">Status</th>'
            +'<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0">CPU</th>'
            +'<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0">Memory</th>'
            +'<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0">Ping</th>'
            +'<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0">IN</th>'
            +'<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0">OUT</th>'
            +'<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0">IP</th>'
            +'</tr></thead><tbody>'+rows+'</tbody></table>'
            +'<p style="color:#94a3b8;font-size:11px;margin-top:20px">Gesendet von Zabbix Network Topology</p>'
            +'</body></html>';

        // Send via Zabbix SMTP \u2014 use GET to avoid Zabbix POST string validation
        bMail.textContent = 'Sende...';
        bMail.disabled = true;

        var cfg = window.NT_CONFIG;
        var base = cfg.data_url.replace('network.topology.v6.data','network.topology.v6.mail');
        var b64 = btoa(unescape(encodeURIComponent(html)));
        var _csrf = (cfg && cfg.csrf_token) || '';
        fetch(base, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'},
            body: 'to='+encodeURIComponent(to.trim())+'&html_b64='+encodeURIComponent(b64)+'&_csrf_token='+encodeURIComponent(_csrf)
        })
        .then(function(r){ return r.json(); })
        .then(function(d){
            bMail.disabled = false;
            bMail.textContent = 'Mail';
            if(d.success) {
                alert('\u2705 Report gesendet an: '+to);
            } else {
                alert('\u274C Fehler: '+(d.error||'Unbekannt'));
            }
        })
        .catch(function(err){
            bMail.disabled = false;
            bMail.textContent = 'Mail';
            alert('\u274C Fehler: '+err.message);
        });
    };

    if(bar) buildSevFilter(bar,cy);

    // Search input \u2014 only add once
    if(!document.getElementById('nt-search-input')) {
        var si=document.createElement('input');
        si.id='nt-search-input';
        si.type='text'; si.placeholder='Host suchen...';
        si.style.cssText='width:140px;height:26px;font-size:12px;margin-left:8px;padding:0 8px;border:1px solid #e2e8f0;border-radius:4px;outline:none;background:#fff;color:#334155';
        si.addEventListener('input',function(){
            var q=this.value.toLowerCase();
            cy.nodes('[!isGroup]').forEach(function(n){
                n.style('opacity',!q||(n.data('label')||'').toLowerCase().indexOf(q)>=0?1:0.15);
            });
        });
        if(bar) bar.appendChild(si);
    }
}

function buildSevFilter(bar, cy) {
    if(document.getElementById('nt-sev-filter')) return;
    var wrap=document.createElement('div');
    wrap.id='nt-sev-filter';
    wrap.style.cssText='display:flex;align-items:center;gap:5px;margin-left:10px;padding-left:8px;border-left:1px solid #e2e8f0;flex-shrink:0';
    [{sev:0,col:'#22c55e',lbl:'OK'},{sev:2,col:'#06b6d4',lbl:'Info'},{sev:3,col:'#f59e0b',lbl:'Warn'},{sev:4,col:'#f97316',lbl:'Avg'},{sev:5,col:'#ef4444',lbl:'High'}].forEach(function(sd){
        var pill=document.createElement('button'); pill.dataset.sev=sd.sev;
        pill.style.cssText='display:flex;align-items:center;gap:3px;padding:2px 7px;border-radius:12px;border:1.5px solid '+sd.col+';background:transparent;cursor:pointer;font-size:11px;color:'+sd.col+';font-weight:600';
        pill.innerHTML='<span style="width:7px;height:7px;border-radius:50%;background:'+sd.col+';display:inline-block"></span>'+sd.lbl;
        pill.addEventListener('click',function(){
            var s=parseInt(this.dataset.sev);
            if(_sevFilter.has(s)){ _sevFilter.delete(s); this.style.background='transparent'; this.style.boxShadow='none'; }
            else { _sevFilter.add(s); this.style.background=sd.col+'33'; this.style.boxShadow='0 0 0 2px '+sd.col+'44'; }
            cy.nodes('[!isGroup]').forEach(function(n){ n.style('display',_sevFilter.size===0||_sevFilter.has(n.data('severity')||0)?'element':'none'); });
            cy.edges().forEach(function(e){ var show=(_sevFilter.size===0||_sevFilter.has(e.source().data('severity')||0))&&(_sevFilter.size===0||_sevFilter.has(e.target().data('severity')||0)); e.style('display',show?'element':'none'); });
        });
        wrap.appendChild(pill);
    });
    var clr=document.createElement('button'); clr.textContent='\u2715'; clr.title='Filter zur\u00FCcksetzen';
    clr.style.cssText='padding:2px 5px;border-radius:10px;border:0.5px solid #e2e8f0;background:transparent;cursor:pointer;font-size:11px;color:#94a3b8';
    clr.addEventListener('click',function(){ _sevFilter.clear(); wrap.querySelectorAll('button[data-sev]').forEach(function(b){ b.style.background='transparent'; b.style.boxShadow='none'; }); cy.elements().style('display','element'); });
    wrap.appendChild(clr);
    bar.appendChild(wrap);
}

function setupLegend(groupNames, nodes) {
    var leg=document.getElementById('nt-legend'); if(!leg) return;
    var html='<div style="font-weight:600;color:#475569;margin-bottom:5px;font-size:10px">GRUPPEN</div>';
    groupNames.forEach(function(name){ var col=grpColor(name),cnt=nodes.filter(function(n){ return n._primaryGroup===name; }).length; html+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px"><div style="width:9px;height:9px;border-radius:50%;background:'+col+'"></div><span style="color:#475569;flex:1;font-size:11px">'+esc(name)+'</span><span style="color:#94a3b8;font-size:11px">'+cnt+'</span></div>'; });
    html+='<div style="font-weight:600;color:#475569;margin:6px 0 4px;font-size:10px;border-top:1px solid #f1f5f9;padding-top:5px">SEVERITY</div>';
    SEV_LBL.forEach(function(lbl,i){ var cnt=nodes.filter(function(n){ return (n.severity||0)===i; }).length; if(!cnt)return; html+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px"><div style="width:9px;height:9px;border-radius:50%;background:'+SEV_COL[i]+'"></div><span style="color:#475569;flex:1;font-size:11px">'+lbl+'</span><span style="color:#94a3b8;font-size:11px">'+cnt+'</span></div>'; });
    html+='<div style="font-weight:600;color:#475569;margin:6px 0 4px;font-size:10px;border-top:1px solid #f1f5f9;padding-top:5px">RING</div>';
    [['CPU','#3b82f6'],['Memory','#8b5cf6'],['Traffic','#22c55e'],['Ping','#f59e0b']].forEach(function(r){ html+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px"><div style="width:9px;height:9px;border-radius:50%;background:'+r[1]+'"></div><span style="color:#475569;font-size:11px">'+r[0]+'</span></div>'; });
    leg.innerHTML=html;
}

// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// TRAFFIC HEATMAP \u2014 f\u00E4rbt und skaliert Kanten nach Traffic-Volumen
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
//
//  0 b/s         \u2192 1.5px  gestrichelt  grau   #94a3b8  (kein Traffic)
//  < 1 Mb/s      \u2192 2px    gr\u00FCn         #22c55e (niedrig)
//  1\u201310 Mb/s     \u2192 3px    cyan         #06b6d4 (mittel)
//  10\u2013100 Mb/s   \u2192 4.5px  blau         #3b82f6 (erh\u00F6ht)
//  100\u2013500 Mb/s  \u2192 6px    orange       #f97316 (hoch)
//  > 500 Mb/s    \u2192 8px    rot          #ef4444 (sehr hoch)

function _trafficTier(bitsPerSec) {
    // Schwellenwerte f\u00FCr typische LAN/Home-Lab Umgebungen (Kb/s bis Mb/s Bereich)
    if (bitsPerSec <= 0)            return { w: 2,   col: '#94a3b8', tcol: '#94a3b8', dash: true  };
    if (bitsPerSec < 10e3)          return { w: 2,   col: '#22c55e', tcol: '#16a34a', dash: false }; // < 10 Kb/s
    if (bitsPerSec < 100e3)         return { w: 3,   col: '#06b6d4', tcol: '#0891b2', dash: false }; // 10-100 Kb/s
    if (bitsPerSec < 1e6)           return { w: 4.5, col: '#3b82f6', tcol: '#1d4ed8', dash: false }; // 100 Kb/s - 1 Mb/s
    if (bitsPerSec < 10e6)          return { w: 6,   col: '#f97316', tcol: '#c2410c', dash: false }; // 1-10 Mb/s
    return                                  { w: 8,   col: '#ef4444', tcol: '#b91c1c', dash: false }; // > 10 Mb/s
}

function applyTrafficHeatmap(cy) {
    if (!cy) return;
    cy.edges().forEach(function(edge) {
        if (edge.hasClass('dead-edge')) return;
        var tIn  = edge.data('trafficIn')  || 0;
        var tOut = edge.data('trafficOut') || 0;
        var total = Math.max(tIn, tOut);   // Spitzenwert entscheidet
        var t = _trafficTier(total);
        edge.style('width',      t.w);
        edge.style('line-color', t.col);
        edge.style('color',      t.tcol);
        edge.style('line-style',       'dashed');
        edge.style('line-dash-pattern', t.dash ? [4, 8] : [6, 5]);
        edge.style('opacity',           t.dash ? 0.75 : 0.9);
    });
}

function startEdgeAnimation(cy, nodes) {
    // Mark edges where source or target host is down (severity >= 5)
    var deadIds = {};
    nodes.forEach(function(n){ if((n.severity||0)>=5) deadIds[String(n.id)]=true; });
    cy.edges().forEach(function(e){
        if(deadIds[e.source().id()]||deadIds[e.target().id()]){
            e.addClass('dead-edge');
        } else {
            e.removeClass('dead-edge');
        }
    });

    // Animate live edges: flowing dots via line-dash-offset
    if(window._ntEdgeAnim) clearInterval(window._ntEdgeAnim);
    var offset=0;
    window._ntEdgeAnim = setInterval(function(){
        if(!window._ntCy) { clearInterval(window._ntEdgeAnim); return; }
        offset = (offset + 1) % 22;
        window._ntCy.edges().filter(function(e){ return !e.hasClass('dead-edge'); }).style('line-dash-offset', -offset);
    }, 50);
}

window.switchTab = switchTab; // global

function renderTree(wrap, nodes, edges) {
    if (!nodes.length) { wrap.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999">No hosts found.</div>'; return; }
    if (window._ntEdgeAnim) { clearInterval(window._ntEdgeAnim); window._ntEdgeAnim=null; }
    if (window._ntCy) { try{window._ntCy.destroy();}catch(e){} window._ntCy=null; }
    wrap.innerHTML='';
    var canvas=document.createElement('div');
    canvas.style.cssText='width:'+wrap.clientWidth+'px;height:'+wrap.clientHeight+'px;';
    wrap.appendChild(canvas);
    var degree={};
    nodes.forEach(function(n){degree[String(n.id)]=0;});
    edges.forEach(function(e){var f=String(e.from),t=String(e.to);if(degree[f]!==undefined)degree[f]++;if(degree[t]!==undefined)degree[t]++;});
    var rootId=String(nodes.reduce(function(best,n){return(degree[String(n.id)]||0)>(degree[String(best.id)]||0)?n:best;},nodes[0]).id);
    var elements=[];
    nodes.forEach(function(n){elements.push({data:{id:String(n.id),label:n.label||n.host||String(n.id),type:n.type||'server',severity:n.severity||0,ip:n.ip||'',host:n.host||'',iftype:n.iftype||'',cpu:n.cpu,memory:n.memory,ping:n.ping,traffic:n.traffic||{in:0,out:0},bgImage:makeNodeImage(n)}});});
    edges.forEach(function(e){elements.push({data:{id:'te_'+e.id,source:String(e.from),target:String(e.to)}});});
    var SEV_BORDER=['#cbd5e1','#06b6d4','#f59e0b','#f97316','#ef4444','#991b1b'];
    var cy=cytoscape({container:canvas,elements:elements,
        layout:{name:'breadthfirst',directed:true,roots:['#'+rootId],padding:50,spacingFactor:1.4,avoidOverlap:true,animate:false,fit:true},
        style:[
            {selector:'node',style:{'width':44,'height':44,'background-image':'data(bgImage)','background-fit':'contain','background-color':'#f8fafc','border-width':2,'border-color':function(ele){return SEV_BORDER[ele.data('severity')||0]||'#cbd5e1';},'label':'data(label)','font-size':10,'font-family':'sans-serif','text-valign':'bottom','text-halign':'center','text-margin-y':4,'color':'#334155','text-max-width':90,'text-wrap':'ellipsis'}},
            {selector:'edge',style:{'width':1.5,'line-color':'#cbd5e1','target-arrow-color':'#94a3b8','target-arrow-shape':'triangle','arrow-scale':0.7,'curve-style':'taxi','taxi-direction':'downward','taxi-turn':'50%'}},
            {selector:'node:selected',style:{'border-width':3,'border-color':'#3b82f6'}}
        ]});
    setTimeout(function(){if(cy&&!cy.destroyed()){cy.resize();cy.fit(cy.nodes(),40);}},100);
    cy.on('mouseover','node',function(e){showTip(e,e.target.data());});
    cy.on('mousemove','node',function(e){moveTip(e);});
    cy.on('mouseout','node',function(){hideTip();});
    cy.on('tap',function(e){if(e.target===cy){_ctx.style.display='none';hideTip();}});
    cy.on('cxttap','node',function(e){var oe=e.originalEvent;if(oe)oe.preventDefault();hideTip();var pos=oe?{x:oe.clientX,y:oe.clientY}:e.renderedPosition;showCtx(pos.x,pos.y,e.target.data());});
    window._ntCy=cy;
}

// Expose globally
window._ntInit = init;
})();

// Bootstrap \u2014 single execution guard
if (!window._ntInitStarted) {
    window._ntInitStarted = true;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', window._ntInit);
    } else {
        window._ntInit();
    }
}
