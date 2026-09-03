// root-cause.js — Root-Cause-Analyse: welcher Offline-Host ist Ursache,
// welche sind nur Folge?
//
// Idee: zweimal BFS vom Uplink (gleiche Referenz wie die What-if-Simulation,
// deshalb kommen findRoots/reachable/highestDegree aus whatif.js):
//   baseline = erreichbar ohne Beruecksichtigung von Ausfaellen
//   alive    = erreichbar wenn Offline-Hosts den Weg blockieren
// Ursache  = Offline-Host mit mind. einem noch erreichbaren Nachbarn
//            ("Frontier" — sein Uplink lebt, er selbst nicht) oder selbst
//            Uplink-Referenz (Firewall down).
// Folge    = Offline-Host in der Baseline hinter einer Ursache.
// Verfuegbare Hosts werden NIE markiert — wenn Zabbix sie erreicht, sind
// sie kein Opfer, egal was der (unvollstaendige) Graph behauptet. Inseln
// ohne Pfad zum Uplink bleiben aussen vor (Lehre aus dem What-if-Bugfix:
// nur wer in der Baseline war, kann etwas verlieren).
//
// Opfer werden ueber die Zusammenhangskomponente der "toten Zone"
// (baseline minus alive) ihren Ursachen zugerechnet — bei redundanten
// Pfaden mit mehreren toten Frontier-Hosts teilen die sich die Opfer.
//
// Markierung via Overlays (nt-rc-cause rot, nt-rc-victim amber) — gleiche
// Begruendung wie whatif.js: Heatmap/Highlight setzen Inline-Styles auf
// opacity/line-color, overlay-* setzt niemand inline; overlay rendert oben
// drauf und damit auch in Firefox (underlay blieb dort unsichtbar).
//
// Lebenszyklus wie die Simulation: Tools-Menue-Button toggelt, ESC beendet
// (toolbar), Re-Render raeumt auf (render-tech), Auto-Refresh rechnet eine
// aktive Analyse mit frischen Offline-Flags neu.

import { toast } from './toast.js';
import { t } from './i18n.js';
import { findRoots, reachable, highestDegree } from './whatif.js';

let _active = false;

export function isRootCauseActive() { return _active; }

export function clearRootCause(cy) {
    _active = false;
    if (cy && !(cy.destroyed && cy.destroyed())) {
        cy.elements().removeClass('nt-rc-cause nt-rc-victim');
    }
    _removeBanner();
}

export function toggleRootCause(cy) {
    if (_active) clearRootCause(cy);
    else runRootCause(cy, true);
}

// verbose=true → Toasts pro Top-Ursache (nur beim manuellen Start; der
// Auto-Refresh-Recompute soll nicht alle 30s toasten).
export function runRootCause(cy, verbose) {
    if (!cy || (cy.destroyed && cy.destroyed())) return;
    const wasActive = _active;
    clearRootCause(cy);

    const down = new Set();
    cy.nodes('[!isGroup]').forEach(function(n) {
        if (n.data('_isInternet')) return;
        if (n.data('unavailable')) down.add(n.id());
    });
    if (down.size === 0) {
        // Beim Refresh-Recompute heisst das: alles wieder online — Analyse
        // beendet sich selbst, kurzer Hinweis statt kommentarlosem Ende.
        if (verbose || wasActive) toast(t('rc.none'), 'info');
        return;
    }

    let roots = findRoots(cy, false);
    if (roots.length === 0) {
        roots = highestDegree(cy, false);
        if (!roots) return;
    }
    const baseline = reachable(cy, roots, null);
    const alive    = reachable(cy, roots, down);

    // Ursachen: offline + in Baseline + (Frontier oder selbst Root)
    const rootIds = {};
    roots.forEach(function(r) { rootIds[r.id()] = true; });
    const causes = {};
    cy.nodes('[!isGroup]').forEach(function(n) {
        const id = n.id();
        if (!down.has(id) || !baseline[id]) return;
        let frontier = !!rootIds[id];
        if (!frontier) {
            n.connectedEdges().forEach(function(e) {
                const nb = e.source().id() === id ? e.target().id() : e.source().id();
                if (alive[nb]) frontier = true;
            });
        }
        if (frontier) causes[id] = true;
    });

    // Tote Zone in Komponenten zerlegen; Opfer = Offline-Nicht-Ursachen.
    // Verfuegbare-aber-abgeschnittene Hosts werden durchlaufen (Konnektivitaet
    // der Komponente), aber nicht markiert und nicht gezaehlt.
    const deadZone = {};
    cy.nodes('[!isGroup]').forEach(function(n) {
        const id = n.id();
        if (baseline[id] && !alive[id]) deadZone[id] = true;
    });
    const compOf = {};
    const comps = [];
    Object.keys(deadZone).forEach(function(start) {
        if (compOf[start] !== undefined) return;
        const ci = comps.length;
        const comp = { causes: [], victims: [], problems: 0 };
        comps.push(comp);
        compOf[start] = ci;
        const q = [start];
        while (q.length) {
            const cur = q.shift();
            const node = cy.getElementById(cur);
            if (causes[cur]) {
                comp.causes.push(cur);
            }
            else if (down.has(cur)) {
                comp.victims.push(cur);
                comp.problems += node.data('problems') || 0;
            }
            node.connectedEdges().forEach(function(e) {
                const nb = e.source().id() === cur ? e.target().id() : e.source().id();
                if (deadZone[nb] && compOf[nb] === undefined) {
                    compOf[nb] = ci;
                    q.push(nb);
                }
            });
        }
    });

    let nCauses = 0, nVictims = 0, nProblems = 0;
    comps.forEach(function(c) {
        nCauses   += c.causes.length;
        nVictims  += c.victims.length;
        nProblems += c.problems;
        c.causes.forEach(function(id)  { cy.getElementById(id).addClass('nt-rc-cause'); });
        c.victims.forEach(function(id) { cy.getElementById(id).addClass('nt-rc-victim'); });
    });

    _active = true;

    if (verbose) {
        // Top-Ursachen nach Opferzahl, max 3 Toasts
        const list = [];
        comps.forEach(function(c) {
            c.causes.forEach(function(id) {
                list.push({ id: id, victims: c.victims.length });
            });
        });
        list.sort(function(a, b) { return b.victims - a.victims; });
        list.slice(0, 3).forEach(function(e) {
            if (e.victims === 0) return;
            const n = cy.getElementById(e.id);
            toast(t('rc.cause_toast', { host: n.data('label') || e.id, n: e.victims }), 'warn');
        });
    }
    _showBanner(cy, nCauses, nVictims, nProblems);
}

// ── Banner (Muster wie whatif.js, eigenes Element + Farbe) ─────────────────
function _removeBanner() {
    const b = document.getElementById('nt-rc-banner');
    if (b) b.remove();
}

function _showBanner(cy, causes, victims, problems) {
    _removeBanner();
    const wrap = document.getElementById('nt-canvas-wrap');
    if (!wrap) return;
    // Nicht mit dem What-if-Banner ueberlappen (beide top-zentriert)
    const top = document.getElementById('nt-whatif-banner') ? 52 : 12;
    const banner = document.createElement('div');
    banner.id = 'nt-rc-banner';
    banner.style.cssText = 'position:absolute;top:' + top + 'px;left:50%;transform:translateX(-50%);'
        + 'z-index:59;background:#7f1d1d;color:#fff;padding:7px 14px;border-radius:6px;'
        + 'font-size:12px;font-family:sans-serif;display:flex;align-items:center;gap:12px;'
        + 'box-shadow:0 4px 16px rgba(0,0,0,0.3)';
    const txt = document.createElement('span');
    txt.textContent = t('rc.banner', { causes: causes, victims: victims, problems: problems });
    banner.appendChild(txt);
    const btn = document.createElement('button');
    btn.textContent = t('rc.end');
    btn.style.cssText = 'background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.4);'
        + 'color:#fff;border-radius:4px;padding:2px 10px;font-size:11px;cursor:pointer;'
        + 'font-family:inherit';
    btn.addEventListener('click', function() { clearRootCause(cy); });
    banner.appendChild(btn);
    wrap.appendChild(banner);
}
