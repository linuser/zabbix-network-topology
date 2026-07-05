// context-menu.js — Rechtsklick-Kontextmenü auf Hosts und Aggregat-Nodes.
//
// Bei normalen Hosts: Direktlinks zu Latest Data, Problems, Graphs und
// Konfiguration in Zabbix; plus Pin- und Notiz-Aktionen.
// Bei Aggregat-Nodes (Group-View): Top-Probleme-Liste und ein Button zum
// Auflösen der Gruppen-Ansicht.
//
// Damit das Modul nicht direkt von render() abhängt (das wäre eine zirkuläre
// Abhängigkeit), wird die "Auflösen"-Aktion als Callback per setResolveAggregateCallback()
// von außen injiziert. Pin-/Note-Aktionen brauchen dagegen nur das makeNodeImage,
// das wir importieren — und savePinned/saveNote aus storage.js.

import { SEV_COL } from './severity.js';
import { NT_GROUP_VIEW_KEY, savePinned, saveNote } from './storage.js';
import { makeNodeImage, clearImgCache } from './icons.js';
import { getPathStart, isPathActive, setPathStart,
         applyPathHighlight, clearPathState } from './path-highlight.js';
import { resetHighlight } from './highlight.js';
import { toast } from './toast.js';
import { isSimulated, isSimActive, simulatedCount,
         toggleSimulatedHost, clearSimulation } from './whatif.js';
import { t } from './i18n.js';

const _ctx = document.createElement('div');
_ctx.style.cssText = 'display:none;position:fixed;z-index:9999;background:#fff;border:1px solid #ddd;'
    + 'border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.15);min-width:190px;font-size:13px;overflow:hidden';
document.body.appendChild(_ctx);

document.addEventListener('click', function(e) {
    if (!_ctx.contains(e.target)) _ctx.style.display = 'none';
});

// Callback-Hook: wird aus dem Hauptmodul gesetzt, damit "Auflösen" ein Re-Render
// triggern kann ohne dass context-menu.js render() direkt importieren muss.
let _onResolveAggregate = null;
export function setResolveAggregateCallback(fn) { _onResolveAggregate = fn; }

function _ctxRow(label, color, onClick) {
    const row = document.createElement('div');
    row.textContent = label;
    row.style.cssText = 'padding:8px 16px;color:' + (color || '#334155') + ';cursor:pointer;white-space:nowrap;';
    row.addEventListener('mouseenter', function() { row.style.background = '#f8fafc'; });
    row.addEventListener('mouseleave', function() { row.style.background = ''; });
    row.addEventListener('click', function(e) {
        e.stopPropagation();
        _ctx.style.display = 'none';
        onClick();
    });
    return row;
}

export function hideCtx() {
    _ctx.style.display = 'none';
}

export function showCtx(cx, cy2, d) {
    while (_ctx.firstChild) _ctx.removeChild(_ctx.firstChild);

    const base   = window.location.pathname.replace('zabbix.php', '');
    const hostId = String(d.id);

    // ── Aggregat-Node (Group-View) ──────────────────────────────────────────
    if (d._isAggregate) {
        const header = document.createElement('div');
        header.style.cssText = 'padding:8px 12px 6px;font-weight:700;border-bottom:1px solid #f1f5f9;font-size:12px;color:#0f172a';
        header.textContent = d.label;
        const sub = document.createElement('div');
        sub.style.cssText = 'font-size:10px;font-weight:400;color:#64748b;margin-top:2px';
        sub.textContent = t('ctx.hosts', { n: d._childCount || 0 });
        header.appendChild(sub);
        _ctx.appendChild(header);

        if (d._topProblems && d._topProblems.length) {
            const probHdr = document.createElement('div');
            probHdr.style.cssText = 'padding:6px 12px 2px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px';
            probHdr.textContent = t('ctx.top_problems');
            _ctx.appendChild(probHdr);
            const SEV_LBL_LOC = ['Normal', 'Info', 'Warning', 'Average', 'High', 'Disaster'];
            d._topProblems.forEach(function(p) {
                const row = document.createElement('div');
                row.style.cssText = 'padding:3px 12px;font-size:11px;display:flex;justify-content:space-between;gap:8px';
                const ln = document.createElement('span');
                ln.textContent = p.label;
                ln.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1';
                const lv = document.createElement('span');
                lv.textContent = SEV_LBL_LOC[p.sev] || ('Sev ' + p.sev);
                lv.style.cssText = 'color:' + (SEV_COL[p.sev] || SEV_COL[0]) + ';font-weight:600;font-size:10px';
                row.appendChild(ln); row.appendChild(lv);
                _ctx.appendChild(row);
            });
        }

        const sepA = document.createElement('div');
        sepA.style.cssText = 'border-top:1px solid #f1f5f9;margin-top:6px';
        _ctx.appendChild(sepA);

        _ctx.appendChild(_ctxRow(t('ctx.resolve_view'), '#3b82f6', function() {
            try { localStorage.setItem(NT_GROUP_VIEW_KEY, '0'); } catch (e) {}
            if (_onResolveAggregate) _onResolveAggregate();
        }));

        _ctx.style.left = cx + 'px';
        _ctx.style.top  = cy2 + 'px';
        _ctx.style.display = 'block';
        return;
    }

    // ── Normaler Host ───────────────────────────────────────────────────────
    // Zabbix 7+ verwendet Parameter ohne "filter_" Präfix (hostids[], groupids[]).
    // Alte filter_hostids[] Form aus Zabbix 4/5 wird in 7.4 ignoriert, weshalb
    // der Filter sonst beim Aufruf verworfen würde.
    function zbxUrl(action, hostid) {
        const baseUrl = window.location.origin + base + 'zabbix.php?action=' + action;
        if (action === 'problem.view') {
            return baseUrl
                + '&hostids%5B%5D=' + encodeURIComponent(hostid)
                + '&show=1&filter_set=1';
        }
        if (action === 'charts.view') {
            // charts.view braucht filter_hostids[] (nicht hostids[])
            return baseUrl
                + '&filter_hostids%5B%5D=' + encodeURIComponent(hostid)
                + '&filter_set=1';
        }
        // latest.view: "hostids[]" + "filter_set=1"
        return baseUrl
            + '&hostids%5B%5D=' + encodeURIComponent(hostid)
            + '&filter_set=1';
    }

    const header = document.createElement('div');
    header.style.cssText = 'padding:8px 12px 6px;font-weight:700;border-bottom:1px solid #f1f5f9;font-size:12px;color:#0f172a';
    header.textContent = d.label;
    if (d.ip) {
        const ipEl = document.createElement('div');
        ipEl.style.cssText = 'font-size:10px;font-weight:400;color:#64748b;font-family:monospace;margin-top:2px';
        ipEl.textContent = '\uD83D\uDD17 ' + d.ip;
        header.appendChild(ipEl);
    }
    _ctx.appendChild(header);

    if (d.note) {
        const np = document.createElement('div');
        np.style.cssText = 'padding:0 16px 6px;font-size:10px;color:#64748b;font-style:italic;max-width:220px;'
                         + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
        np.textContent = d.note;
        _ctx.appendChild(np);
    }

    // Read-only Links sind fuer alle sichtbar. Edit-Links (Bearbeiten +
    // Hosts-Liste) nur fuer Admins (NT_CONFIG.can_edit = true). Zabbix
    // prueft das serverseitig nochmal, aber die UI soll keine Buttons
    // anzeigen die zu "Forbidden" fuehren.
    const items = [
        [' Latest Data',          zbxUrl('latest.view',  hostId)],
        ['\u26A0 Problems',       zbxUrl('problem.view', hostId)],
        [' Graphs',               zbxUrl('charts.view',  hostId)],
    ];
    if (window.NT_CONFIG && window.NT_CONFIG.can_edit) {
        items.push([t('ctx.edit'), window.location.origin + base
            + 'zabbix.php?action=popup&popup=host.edit&hostid=' + encodeURIComponent(hostId)]);
        items.push([t('ctx.hosts_list'), window.location.origin + base
            + 'zabbix.php?action=host.list'
            + '&filter_name=' + encodeURIComponent(d.host || d.label)
            + '&filter_set=1']);
    }
    items.forEach(function(item) {
        const url = item[1];
        _ctx.appendChild(_ctxRow(item[0], '#334155', function() {
            window.open(url, '_blank');
        }));
    });

    // Custom-Links aus nt:link-Tags. Wenn vorhanden: eigene Sektion mit
    // Header. Maximal 6 Links (Backend begrenzt das schon).
    if (d.links && d.links.length) {
        const linksHdr = document.createElement('div');
        linksHdr.style.cssText = 'padding:6px 12px 2px;font-size:10px;color:#64748b;'
            + 'text-transform:uppercase;letter-spacing:0.5px;'
            + 'border-top:1px solid #f1f5f9;margin-top:4px';
        linksHdr.textContent = t('ctx.ext_links');
        _ctx.appendChild(linksHdr);
        d.links.forEach(function(link) {
            // Label kürzen falls überlang. Backend validiert URL bereits
            // auf http(s)://, aber Defense-in-depth: noch ein Client-Check
            // damit ein Backend-Bug oder ein manipulierter Link nicht zu
            // javascript:/data:/file: URLs fuehrt.
            const lbl = (link.label || '').substring(0, 24);
            const url = String(link.url || '');
            if (!/^https?:\/\//i.test(url)) return;
            _ctx.appendChild(_ctxRow('\u{1F517} ' + lbl, '#0891b2', function() {
                window.open(url, '_blank', 'noopener,noreferrer');
            }));
        });
    }

    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px solid #f1f5f9;margin-top:2px';
    _ctx.appendChild(sep);

    // Pin
    const pinLabel = ' ' + (d.pinned ? t('ctx.unpin') : t('ctx.pin'));
    _ctx.appendChild(_ctxRow(pinLabel, '#3b82f6', function() {
        const cy = window._ntCy; if (!cy) return;
        const node = cy.getElementById(hostId);
        if (!node.length) return;
        const nowPinned = !node.data('pinned');
        node.data('pinned', nowPinned);
        clearImgCache();
        node.data('bgImage', makeNodeImage(node.data()));
        if (nowPinned) node.lock(); else node.unlock();
        savePinned(cy);
    }));

    // Notiz
    const noteLabel = ' ' + (d.note ? t('ctx.note_edit') : t('ctx.note_add'));
    _ctx.appendChild(_ctxRow(noteLabel, '#f59e0b', function() {
        const cy = window._ntCy; if (!cy) return;
        const node = cy.getElementById(hostId);
        if (!node.length) return;
        const text = prompt(t('ctx.note_prompt', { host: d.label }), node.data('note') || '');
        if (text === null) return;
        const notes = saveNote(hostId, text);
        node.data('note', notes[hostId] || '');
        clearImgCache();
        node.data('bgImage', makeNodeImage(node.data()));
    }));

    // Pfad-Highlight: BFS-Pfad zwischen zwei Hosts.
    //   - Pfad aktiv               \u2192 "Pfad ausblenden"
    //   - Start gesetzt = this     \u2192 "Pfad-Start zur\u00FCcksetzen"
    //   - Start gesetzt \u2260 this     \u2192 "Pfad zu hier" + "Pfad-Start zur\u00FCcksetzen"
    //   - kein Start               \u2192 "Pfad von hier starten"
    const pathSep = document.createElement('div');
    pathSep.style.cssText = 'border-top:1px solid #f1f5f9;margin-top:2px';
    _ctx.appendChild(pathSep);

    const startId = getPathStart();
    if (isPathActive()) {
        _ctx.appendChild(_ctxRow(t('ctx.path_hide'), '#64748b', function() {
            clearPathState(window._ntCy);
        }));
    } else if (!startId) {
        _ctx.appendChild(_ctxRow(t('ctx.path_start'), '#0891b2', function() {
            const cy = window._ntCy; if (!cy) return;
            resetHighlight(cy);   // Connected-Component-Dim aus, sonst Konflikt
            setPathStart(hostId);
        }));
    } else if (startId === hostId) {
        _ctx.appendChild(_ctxRow(t('ctx.path_reset'), '#64748b', function() {
            clearPathState(window._ntCy);
        }));
    } else {
        _ctx.appendChild(_ctxRow(t('ctx.path_to'), '#0891b2', function() {
            const cy = window._ntCy; if (!cy) return;
            resetHighlight(cy);
            const ok = applyPathHighlight(cy, startId, hostId);
            if (!ok) {
                toast(t('ctx.path_none'), 'warn');
                clearPathState(cy);
            }
        }));
        _ctx.appendChild(_ctxRow(t('ctx.path_reset'), '#64748b', function() {
            clearPathState(window._ntCy);
        }));
    }

    // What-if-Ausfallsimulation: Host als tot simulieren \u2192 whatif.js rechnet
    // per BFS aus welche Hosts dadurch vom Uplink abgeschnitten waeren.
    // Mehrere Hosts stapelbar (beide Core-Switches gleichzeitig testen).
    const simSep = document.createElement('div');
    simSep.style.cssText = 'border-top:1px solid #f1f5f9;margin-top:2px';
    _ctx.appendChild(simSep);
    _ctx.appendChild(_ctxRow(
        isSimulated(hostId) ? t('whatif.restore') : t('whatif.simulate'),
        '#ea580c',
        function() {
            const cy = window._ntCy; if (!cy) return;
            toggleSimulatedHost(cy, hostId);
        }
    ));
    if (isSimActive()) {
        _ctx.appendChild(_ctxRow(t('whatif.end_all', { n: simulatedCount() }), '#64748b', function() {
            clearSimulation(window._ntCy);
        }));
    }

    _ctx.style.left = cx + 'px';
    _ctx.style.top  = cy2 + 'px';
    _ctx.style.display = 'block';
}
