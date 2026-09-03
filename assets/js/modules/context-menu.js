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
import { showPathList } from './path-list.js';
import { resetHighlight } from './highlight.js';
import { toast } from './toast.js';
import { isSimulated, isSimActive, simulatedCount,
         toggleSimulatedHost, clearSimulation } from './whatif.js';
import { isFocusActive, getFocusId, getFocusHops,
         setFocus, clearFocus } from './focus-mode.js';
import { t } from './i18n.js';

const _ctx = document.createElement('div');
_ctx.style.cssText = 'display:none;position:fixed;z-index:9999;background:var(--nt-c-surface,#fff);border:1px solid var(--nt-c-ddd,#ddd);'
    + 'border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.15);min-width:190px;font-size:13px;overflow:hidden';
document.body.appendChild(_ctx);

// Menü an (cx,cy) zeigen und in den Viewport clampen — sonst laeuft ein langes
// Menue (z.B. mit Maintenance-Eintraegen) unten/rechts aus dem Bild. max-height
// + Scroll fangen ab, wenn das Menue hoeher als der Screen ist. position:fixed
// → die Koordinaten sind viewport-relativ, also direkt gegen innerWidth/Height.
function _showCtxAt(cx, cy) {
    const m = 8;   // Mindestabstand zum Bildrand
    _ctx.style.maxHeight = (window.innerHeight - 2 * m) + 'px';
    _ctx.style.overflowY = 'auto';
    _ctx.style.left = cx + 'px';
    _ctx.style.top  = cy + 'px';
    _ctx.style.display = 'block';
    // jetzt messbar → bei Ueberlauf nach innen schieben
    const w = _ctx.offsetWidth, h = _ctx.offsetHeight;
    if (cx + w > window.innerWidth  - m) _ctx.style.left = Math.max(m, window.innerWidth  - w - m) + 'px';
    if (cy + h > window.innerHeight - m) _ctx.style.top  = Math.max(m, window.innerHeight - h - m) + 'px';
}

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
    row.addEventListener('mouseenter', function() { row.style.background = 'var(--nt-c-f8fafc,#f8fafc)'; });
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

// POST an die Maintenance-Action (WRITE). Echter CSRF-Schutz: der action- +
// session-gebundene Token aus NT_CONFIG wird mitgeschickt und serverseitig via
// CCsrfTokenHelper::check geprueft. Zusaetzlich same-origin, X-Requested-With,
// USER_TYPE_ZABBIX_ADMIN + Host-Schreibrecht (Defense in Depth).
function _createMaintenance(hostId, durationSec, durLabel, hostLabel) {
    const base = window.location.pathname.replace('zabbix.php', '');
    const params = new URLSearchParams();
    params.append('action', 'network.topology.maintenance');
    params.append('hostids[]', hostId);
    params.append('duration', String(durationSec));
    params.append('nt_csrf', (window.NT_CONFIG && window.NT_CONFIG.csrf_token) || '');
    fetch(base + 'zabbix.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
    })
        .then(function(r) { return r.json(); })
        .then(function(res) {
            if (res && res.ok) {
                toast(t('maint.ok', { host: hostLabel, dur: durLabel }), 'info');
            } else {
                toast(t('maint.fail', { msg: (res && res.error) || '?' }), 'warn');
            }
        })
        .catch(function(e) { toast(t('maint.fail', { msg: e.message }), 'warn'); });
}

// POST an die Portscan-Action. Geschickt wird NUR die hostid — die Adresse
// loest das Backend selbst ueber die Zabbix-API auf, damit die Rechte des
// Benutzers auf diesen Host greifen.
//
// Der Scan dauert Sekunden (jeder gefilterte Port kostet die volle
// Zeitueberschreitung), deshalb vorab ein Hinweis-Toast — sonst wirkt die
// Oberflaeche haengengeblieben.
function _probePorts(hostId, hostLabel) {
    const base = window.location.pathname.replace('zabbix.php', '');
    const cfg  = window.NT_CONFIG || {};
    const params = new URLSearchParams();
    params.append('action', 'network.topology.portscan');
    params.append('hostid', hostId);
    params.append('nt_csrf', cfg.portscan_csrf || '');

    toast(t('scan.running', { host: hostLabel }), 'info', 4000);

    fetch(base + 'zabbix.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
    })
        .then(function(r) { return r.json(); })
        .then(function(res) {
            if (!res || !res.ok) {
                toast(t('scan.fail', { msg: (res && res.error) || '?' }), 'warn');
                return;
            }

            // Antwortete das Geraet ueberhaupt? Kam auf KEINEN Port eine
            // Reaktion — weder offen noch abgelehnt —, sagt das Ergebnis nichts
            // ueber das Geraet, sondern etwas ueber den Netzweg: das Frontend
            // steht haeufig nicht im ueberwachten Segment. Das als "alle Ports
            // zu" darzustellen waere schlicht falsch.
            if (!res.summary || !res.summary.reachable) {
                toast(t('scan.unreachable', { host: hostLabel, target: res.target }), 'warn', 9000);
                return;
            }

            const open = (res.results || []).filter(function(r) { return r.state === 'open'; });

            if (!open.length) {
                toast(t('scan.none', { host: hostLabel, target: res.target }), 'info', 7000);
                return;
            }

            const list = open.map(function(r) { return r.service + ' (' + r.port + ')'; }).join(', ');
            toast(t('scan.found', { host: hostLabel, n: open.length, list: list }), 'info', 12000);
        })
        .catch(function(e) { toast(t('scan.fail', { msg: e.message }), 'warn'); });
}

export function showCtx(cx, cy2, d) {
    while (_ctx.firstChild) _ctx.removeChild(_ctx.firstChild);

    const base   = window.location.pathname.replace('zabbix.php', '');
    const hostId = String(d.id);

    // ── Ghost-Knoten ────────────────────────────────────────────────────────
    //
    // Ein Ghost ist ein per LLDP/CDP gemeldeter Nachbar, den Zabbix nicht
    // kennt — ein Geraet, das im Netz steht und nicht ueberwacht wird. Bisher
    // war das eine Feststellung; hier wird eine Handlung daraus.
    //
    // Angelegt wird der Host NICHT von uns. Wir oeffnen Zabbix' eigenes
    // Formular mit vorbefuelltem Namen (dieselbe popup=host.edit-URL, die das
    // Menue schon fuers Bearbeiten nutzt). Damit gibt es keine schreibende
    // Action, keine eigene Rechtepruefung und keine halbe Host-Anlage: Zabbix
    // validiert, Zabbix legt an, Zabbix lehnt ab. Der Eintrag erscheint nur
    // fuer Admins — das Formular selbst weist andere ohnehin ab, aber ein
    // Menuepunkt, der in "Access denied" laeuft, ist keiner.
    if (d._isGhost) {
        const gh = document.createElement('div');
        gh.style.cssText = 'padding:8px 12px 6px;font-weight:700;border-bottom:1px solid var(--nt-c-f1f5f9,#f1f5f9);font-size:12px;color:var(--nt-c-0f172a,#0f172a)';
        gh.textContent = d.label || d.host || String(d.id);

        const ghSub = document.createElement('div');
        ghSub.style.cssText = 'font-size:10px;font-weight:400;color:var(--nt-c-64748b,#64748b);margin-top:2px';
        const seenBy = (d._ghostSeenBy || []).join(', ');
        const via    = (d._ghostSrc || ['lldp']).join('/').toUpperCase();
        ghSub.textContent = seenBy
            ? t('ctx.ghost.seen_by', { via: via, hosts: seenBy })
            : t('ctx.ghost.unmonitored');
        gh.appendChild(ghSub);

        // Was LLDP sonst noch ueber das Geraet verraet. Fehlt es, fehlt die
        // Zeile — lieber nichts zeigen als eine leere Beschriftung. Die Angaben
        // liefert das Template erst, seit es lldpRemSysDesc / SysCapEnabled /
        // ChassisId mit einsammelt; aeltere Installationen sehen hier nichts.
        [[d._ghostCaps && d._ghostCaps.length ? d._ghostCaps.join(', ') : '', 'ctx.ghost.caps'],
         [d._ghostDesc    || '', 'ctx.ghost.desc'],
         [d._ghostChassis || '', 'ctx.ghost.chassis']].forEach(function(pair) {
            if (!pair[0]) return;
            const row = document.createElement('div');
            row.style.cssText = 'font-size:10px;font-weight:400;color:var(--nt-c-64748b,#64748b);margin-top:2px';
            row.textContent = t(pair[1], { v: pair[0] });
            gh.appendChild(row);
        });

        _ctx.appendChild(gh);

        if (window.NT_CONFIG && window.NT_CONFIG.can_edit) {
            _ctx.appendChild(_ctxRow(t('ctx.ghost.create'), '#0275b8', function() {
                // Gruppe vorbelegen: die erste der gerade gewaehlten. Eine
                // bessere Vermutung gibt es nicht — der Nachbar traegt keine
                // Gruppenzugehoerigkeit, er ist ja nirgends erfasst. Im
                // Formular laesst sich das aendern.
                const cfg  = window.NT_CONFIG || {};
                const grp  = (cfg.selected_groupids || [])[0];
                const note = seenBy
                    ? 'Discovered via ' + via + ' by ' + seenBy + ' (Network Topology)'
                    : 'Discovered via ' + via + ' (Network Topology)';
                let url = window.location.origin + base
                    + 'zabbix.php?action=popup&popup=host.edit'
                    + '&host=' + encodeURIComponent(d.label || d.host || '')
                    + '&description=' + encodeURIComponent(note.slice(0, 250));
                if (grp) url += '&groupids[]=' + encodeURIComponent(grp);
                window.open(url, '_blank', 'noopener,noreferrer');
            }));
        }

        _showCtxAt(cx, cy2);
        return;
    }

    // ── Aggregat-Node (Group-View) ──────────────────────────────────────────
    if (d._isAggregate) {
        const header = document.createElement('div');
        header.style.cssText = 'padding:8px 12px 6px;font-weight:700;border-bottom:1px solid var(--nt-c-f1f5f9,#f1f5f9);font-size:12px;color:var(--nt-c-0f172a,#0f172a)';
        header.textContent = d.label;
        const sub = document.createElement('div');
        sub.style.cssText = 'font-size:10px;font-weight:400;color:var(--nt-c-64748b,#64748b);margin-top:2px';
        sub.textContent = t('ctx.hosts', { n: d._childCount || 0 });
        header.appendChild(sub);
        _ctx.appendChild(header);

        if (d._topProblems && d._topProblems.length) {
            const probHdr = document.createElement('div');
            probHdr.style.cssText = 'padding:6px 12px 2px;font-size:10px;color:var(--nt-c-64748b,#64748b);text-transform:uppercase;letter-spacing:0.5px';
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
        sepA.style.cssText = 'border-top:1px solid var(--nt-c-f1f5f9,#f1f5f9);margin-top:6px';
        _ctx.appendChild(sepA);

        _ctx.appendChild(_ctxRow(t('ctx.resolve_view'), '#3b82f6', function() {
            try { localStorage.setItem(NT_GROUP_VIEW_KEY, '0'); } catch (e) {}
            if (_onResolveAggregate) _onResolveAggregate();
        }));

        _showCtxAt(cx, cy2);
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
    header.style.cssText = 'padding:8px 12px 6px;font-weight:700;border-bottom:1px solid var(--nt-c-f1f5f9,#f1f5f9);font-size:12px;color:var(--nt-c-0f172a,#0f172a)';
    header.textContent = d.label;
    if (d.ip) {
        const ipEl = document.createElement('div');
        ipEl.style.cssText = 'font-size:10px;font-weight:400;color:var(--nt-c-64748b,#64748b);font-family:monospace;margin-top:2px';
        ipEl.textContent = '\uD83D\uDD17 ' + d.ip;
        header.appendChild(ipEl);
    }
    _ctx.appendChild(header);

    if (d.note) {
        const np = document.createElement('div');
        np.style.cssText = 'padding:0 16px 6px;font-size:10px;color:var(--nt-c-64748b,#64748b);font-style:italic;max-width:220px;'
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
            window.open(url, '_blank', 'noopener,noreferrer');
        }));
    });

    // Custom-Links aus nt:link-Tags. Wenn vorhanden: eigene Sektion mit
    // Header. Maximal 6 Links (Backend begrenzt das schon).
    if (d.links && d.links.length) {
        const linksHdr = document.createElement('div');
        linksHdr.style.cssText = 'padding:6px 12px 2px;font-size:10px;color:var(--nt-c-64748b,#64748b);'
            + 'text-transform:uppercase;letter-spacing:0.5px;'
            + 'border-top:1px solid var(--nt-c-f1f5f9,#f1f5f9);margin-top:4px';
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
    sep.style.cssText = 'border-top:1px solid var(--nt-c-f1f5f9,#f1f5f9);margin-top:2px';
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
        // Don't persist in focus mode: savePinned stores the pins of the
        // WHOLE view from the graph, and only the focus subset is in there —
        // pins outside the focus would be lost. The pin then only lasts for
        // the running session within the excerpt.
        if (!isFocusActive()) savePinned(cy);
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
    pathSep.style.cssText = 'border-top:1px solid var(--nt-c-f1f5f9,#f1f5f9);margin-top:2px';
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
                return;
            }
            // Der Pfad steht jetzt auch als Liste im Detail-Panel. Bei drei
            // Hops liest man ihn noch von der Karte ab, bei sieben quer ueber
            // eine grosse Karte nicht mehr — und kopieren kann man eine Farbe
            // ohnehin nicht.
            showPathList(document.getElementById('nt-detail'), cy);
        }));
        _ctx.appendChild(_ctxRow(t('ctx.path_reset'), '#64748b', function() {
            clearPathState(window._ntCy);
        }));
    }

    // What-if-Ausfallsimulation: Host als tot simulieren \u2192 whatif.js rechnet
    // per BFS aus welche Hosts dadurch vom Uplink abgeschnitten waeren.
    // Mehrere Hosts stapelbar (beide Core-Switches gleichzeitig testen).
    const simSep = document.createElement('div');
    simSep.style.cssText = 'border-top:1px solid var(--nt-c-f1f5f9,#f1f5f9);margin-top:2px';
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

    // Per-host focus: boil the map down to this host + N hops (focus-mode.js).
    // The tool for large environments — "show me the core switch and what
    // hangs off it" instead of a thousand nodes. The hop count can be changed
    // later via the banner (+/−) or by re-focusing here.
    const focusSep = document.createElement('div');
    focusSep.style.cssText = 'border-top:1px solid var(--nt-c-f1f5f9,#f1f5f9);margin-top:2px';
    _ctx.appendChild(focusSep);
    [1, 2, 3].forEach(function(hops) {
        // Don't offer the combination that is already active
        if (isFocusActive() && getFocusId() === hostId && getFocusHops() === hops) return;
        _ctx.appendChild(_ctxRow(
            hops === 1 ? t('focus.row_one') : t('focus.row_n', { n: hops }),
            '#1d4ed8',
            function() { setFocus(hostId, hops); }
        ));
    });
    if (isFocusActive()) {
        _ctx.appendChild(_ctxRow(t('focus.end_ctx'), '#64748b', function() {
            clearFocus();
        }));
    }
    // Server-side hop view: navigates to the map scoped to THIS host + N hops
    // (data fetched only for the neighbourhood — the tool for environments
    // where even loading the group payload is too much). The client focus
    // above filters what is already loaded; this reloads scoped.
    _ctx.appendChild(_ctxRow(t('focus.hop_view'), '#1d4ed8', function() {
        window.location.href = window.location.origin + base
            + 'zabbix.php?action=network.topology.view'
            + '&hostid=' + encodeURIComponent(hostId)
            + '&hops=' + encodeURIComponent(String((window.NT_CONFIG && window.NT_CONFIG.hops) || 2));
    }));

    // Wartung direkt aus der Map (nur Admins — can_edit = >= ZABBIX_ADMIN;
    // die Action prueft die Rechte serverseitig nochmal). One-Time-Wartung
    // fuer den Host, Alarme werden unterdrueckt. "darf ich rebooten?" → an.
    if (window.NT_CONFIG && window.NT_CONFIG.can_edit) {
        const scanSep = document.createElement('div');
        scanSep.style.cssText = 'border-top:1px solid var(--nt-c-f1f5f9,#f1f5f9);margin-top:2px';
        _ctx.appendChild(scanSep);

        // Dienste-Probe auf Klick: welche gaengigen Ports antworten. Gedacht
        // fuer frisch angelegte Hosts, bei denen noch niemand weiss, was das
        // Geraet ueberhaupt ist — der Fall, in den "Host aus Ghost" muendet.
        //
        // Der Aufruf schickt nur die hostid. Die Adresse loest das Backend
        // selbst ueber die API auf, damit die Rechte des Benutzers auf diesen
        // Host greifen; eine mitgegebene IP waere ein Portscanner hinter dem
        // Login.
        _ctx.appendChild(_ctxRow(t('scan.row'), '#7c3aed', function() {
            if (!confirm(t('scan.confirm', { host: d.label }))) return;
            _probePorts(hostId, d.label);
        }));

        [[3600, '1h'], [14400, '4h'], [28800, '8h'], [86400, '24h']].forEach(function(dur) {
            _ctx.appendChild(_ctxRow(t('maint.row', { dur: dur[1] }), '#0d9488', function() {
                if (!confirm(t('maint.confirm', { host: d.label, dur: dur[1] }))) return;
                _createMaintenance(hostId, dur[0], dur[1], d.label);
            }));
        });
    }

    _showCtxAt(cx, cy2);
}
