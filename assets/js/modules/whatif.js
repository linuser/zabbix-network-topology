// whatif.js — Ausfall-Simulation ("darf ich den Switch rebooten?").
//
// Rechtsklick auf Host → "Ausfall simulieren": der Host gilt als tot, und
// alle Hosts die dadurch ihre Verbindung zum Netz-Uplink verlieren werden
// rot markiert. Mehrere Hosts gleichzeitig simulierbar (z.B. beide Core-
// Switches) — jede Aenderung rechnet die Erreichbarkeit neu.
//
// Referenzpunkt ("Uplink") in absteigender Prioritaet:
//   1. Internet-Wolke (_isInternet) — existiert nur im Hierarchie-Layout
//   2. alle Firewall-/Router-Nodes (gleiche Heuristik wie injectInternetCloud)
//   3. der Nicht-simulierte Host mit dem hoechsten Degree (mit Toast-Hinweis,
//      damit klar ist worauf sich "abgeschnitten" bezieht)
//
// "Abgeschnitten" = war in der Baseline (BFS ohne Ausfaelle) vom Uplink aus
// erreichbar und ist es mit den simulierten Ausfaellen nicht mehr. Inseln
// ohne LLDP/CDP-Kanten waren nie erreichbar und zaehlen deshalb nicht mit —
// sonst wuerden sie jedem beliebigen simulierten Host angelastet.
//
// Markierung via Cytoscape-Klassen (Overlays) statt Inline-Styles — die
// Traffic-Heatmap und highlight.js setzen Inline-opacity/line-color, die
// wuerden Klassen-Styles auf denselben Properties ueberschreiben. overlay-*
// setzt niemand inline und rendert oben drauf (cross-browser, auch Firefox,
// wo underlay hinter dem transparenten Node-Body unsichtbar blieb).
//
// Lebenszyklus analog path-highlight: Re-Render/Tab-Wechsel beendet die
// Simulation (render-tech cleanup), ESC ebenso (toolbar), sonst Banner-Button.

import { toast } from './toast.js';
import { t } from './i18n.js';

let _simulated = new Set();   // host-ids die als ausgefallen gelten

export function isSimActive() { return _simulated.size > 0; }
export function isSimulated(id) { return _simulated.has(String(id)); }
export function simulatedCount() { return _simulated.size; }

// Host in die Simulation aufnehmen / wieder rausnehmen, dann neu rechnen.
export function toggleSimulatedHost(cy, hostId) {
    const id = String(hostId);
    if (_simulated.has(id)) _simulated.delete(id);
    else _simulated.add(id);
    recomputeSimulation(cy);
}

export function clearSimulation(cy) {
    _simulated.clear();
    if (cy && !(cy.destroyed && cy.destroyed())) {
        cy.elements().removeClass('nt-sim-dead nt-sim-cut');
    }
    _removeBanner();
}

// Uplink-Referenz bestimmen (siehe Header). excludeSimulated=true filtert
// tote Hosts raus (fuer die Sim-BFS); die Baseline nutzt die volle Menge.
// Exportiert: root-cause.js nutzt dieselbe Referenz + BFS.
export function findRoots(cy, excludeSimulated) {
    let roots = cy.nodes('[?_isInternet]');
    if (roots.length === 0) {
        roots = cy.nodes('[!isGroup]').filter(function(n) {
            const t2 = n.data('type');
            return t2 === 'firewall' || t2 === 'router';
        });
    }
    if (!excludeSimulated) return roots;
    return roots.filter(function(n) { return !_simulated.has(n.id()); });
}

// Fallback-Referenz: Host mit dem hoechsten Degree (Collection aus 1 Node).
export function highestDegree(cy, excludeSimulated) {
    let best = null, bestDeg = -1;
    cy.nodes('[!isGroup]').forEach(function(n) {
        if (excludeSimulated && _simulated.has(n.id())) return;
        const d = n.degree(false);
        if (d > bestDeg) { bestDeg = d; best = n; }
    });
    return best;
}

// BFS von den Roots aus; blocked (Set oder null) gilt als tot und
// blockiert sowohl das Seeding als auch den Weg.
export function reachable(cy, roots, blocked) {
    const visited = {};
    const queue = [];
    roots.forEach(function(n) {
        if (blocked && blocked.has(n.id())) return;
        visited[n.id()] = true;
        queue.push(n.id());
    });
    while (queue.length) {
        const cur = queue.shift();
        cy.getElementById(cur).connectedEdges().forEach(function(edge) {
            // NUR ueber Netzwege laufen.
            //
            // connectedEdges() liefert ALLE Kanten, auch die aus nt:parent
            // (kind='hosts'). Das ist eine TRAEGERbeziehung — "pve betreibt
            // diese VM" —, kein Kabel. Als Weg benutzt hiess das: faellt ein
            // Switch aus, gilt der Hypervisor weiter als erreichbar, weil der
            // BFS ueber eine seiner VMs dorthin zurueckfand. Ein Gast kann
            // seinem Wirt keine Netzanbindung verschaffen.
            //
            // Dass die beiden verschieden sind, weiss diese Datei ohnehin: der
            // Containment-Block weiter unten propagiert entlang genau dieser
            // Kanten in die andere Richtung (toter Traeger reisst Gaeste mit).
            // Sie zusaetzlich als Weg zu zaehlen war doppelt und falsch.
            if (edge.data('kind') === 'hosts') return;
            const s = edge.source().id();
            const t2 = edge.target().id();
            const nbr = (s === cur) ? t2 : s;
            if (visited[nbr] || (blocked && blocked.has(nbr))) return;
            visited[nbr] = true;
            queue.push(nbr);
        });
    }
    return visited;
}

export function recomputeSimulation(cy) {
    if (!cy || (cy.destroyed && cy.destroyed())) return;
    cy.elements().removeClass('nt-sim-dead nt-sim-cut');
    if (_simulated.size === 0) { _removeBanner(); return; }

    // Baseline: was haengt OHNE Ausfaelle am Uplink? Nur wer hier drin ist
    // kann durch die Simulation etwas verlieren.
    let baseRoots = findRoots(cy, false);
    if (baseRoots.length === 0) {
        baseRoots = highestDegree(cy, false);
        if (!baseRoots) { _removeBanner(); return; }
    }
    const baseline = reachable(cy, baseRoots, null);

    // Sind ALLE Referenzknoten selbst simuliert ausgefallen?
    //
    // Das ist der wichtigste Fall der ganzen Funktion und war bis 5.3 falsch.
    // Wer eine einzelne Firewall hat und fragt "was, wenn mein Router
    // ausfaellt?", bekam "0 Hosts abgeschnitten" — weil die Referenzmenge leer
    // wurde und Rueckfall 3 ersatzweise den ueberlebenden Host mit den meisten
    // Kanten nahm. Von einem Switch aus ist die restliche Switch-Landschaft
    // natuerlich weiter erreichbar.
    //
    // Damit beantwortete die Simulation stillschweigend eine ANDERE Frage:
    // nicht "haengt das noch am Uplink", sondern "haengt das noch an
    // irgendeinem ueberlebenden Geraet". Bei einem Router-Ausfall ist das
    // genau die falsche, und die Antwort war beruhigend statt richtig.
    //
    // Richtig ist: faellt die Referenz selbst aus, gibt es keinen Uplink mehr
    // — dann ist alles abgeschnitten, was ueber sie hing. Der Rueckfall bleibt
    // fuer den anderen Fall: es gab NIE eine Referenz, weil die Karte gar
    // keine Firewall und keinen Router enthaelt.
    const alleReferenzenTot = baseRoots.length > 0
        && baseRoots.filter(function(n) { return !_simulated.has(n.id()); }).length === 0;

    let roots = findRoots(cy, true);
    if (roots.length === 0 && alleReferenzenTot) {
        roots = cy.collection();   // leer -> nichts ist erreichbar
        toast(t('whatif.root_all_down'), 'warn', 9000);
    } else if (roots.length === 0) {
        // Fallback 3: hoechster Degree unter den Ueberlebenden. Toast macht
        // transparent worauf sich die Erreichbarkeit bezieht.
        const best = highestDegree(cy, true);
        if (!best) { _removeBanner(); return; }
        roots = best;
        toast(t('whatif.root_fallback', { host: best.data('label') || best.id() }), 'info');
    }
    const visited = reachable(cy, roots, _simulated);

    let cutCount = 0;
    cy.nodes('[!isGroup]').forEach(function(n) {
        const id = n.id();
        if (_simulated.has(id)) { n.addClass('nt-sim-dead'); return; }
        if (baseline[id] && !visited[id]) { n.addClass('nt-sim-cut'); cutCount++; }
    });

    // Hosting-Containment (nt:parent → hosts-Kante): ein toter oder
    // abgeschnittener Traeger reisst seine gehosteten Children mit — eine VM
    // ohne ihren Hypervisor ist weg, auch wenn ihr eigenes Interface noch einen
    // Netzpfad haette. Gerichtete Propagation entlang der hosts-Kanten
    // (source=Parent → target=Child), transitiv (Chassis→Node→VM). Ohne
    // hosts-Kanten kostet der Block nichts.
    const hostsChildren = {};
    cy.edges('[kind = "hosts"]').forEach(function(e) {
        const p = e.source().id();
        (hostsChildren[p] = hostsChildren[p] || []).push(e.target().id());
    });
    if (Object.keys(hostsChildren).length) {
        const work = [];
        cy.nodes('.nt-sim-dead, .nt-sim-cut').forEach(function(n) { work.push(n.id()); });
        while (work.length) {
            const kids = hostsChildren[work.shift()];
            if (!kids) continue;
            kids.forEach(function(childId) {
                if (_simulated.has(childId)) return;            // bleibt 'dead'
                const c = cy.getElementById(childId);
                if (c.hasClass('nt-sim-cut')) return;           // schon markiert
                c.addClass('nt-sim-cut'); cutCount++;
                work.push(childId);
            });
        }
    }

    _showBanner(cy, cutCount);
}

// ── Banner: laufende Simulation sichtbar machen + Ausstieg anbieten ────────
function _removeBanner() {
    const b = document.getElementById('nt-whatif-banner');
    if (b) b.remove();
}

function _showBanner(cy, cutCount) {
    _removeBanner();
    const wrap = document.getElementById('nt-canvas-wrap');
    if (!wrap) return;
    const banner = document.createElement('div');
    banner.id = 'nt-whatif-banner';
    banner.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);'
        + 'z-index:60;background:#7c2d12;color:#fff;padding:7px 14px;border-radius:6px;'
        + 'font-size:12px;font-family:sans-serif;display:flex;align-items:center;gap:12px;'
        + 'box-shadow:0 4px 16px rgba(0,0,0,0.3)';
    const txt = document.createElement('span');
    txt.textContent = t('whatif.banner', { failed: _simulated.size, cut: cutCount });
    banner.appendChild(txt);
    const btn = document.createElement('button');
    btn.textContent = t('whatif.end');
    btn.style.cssText = 'background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.4);'
        + 'color:#fff;border-radius:4px;padding:2px 10px;font-size:11px;cursor:pointer;'
        + 'font-family:inherit';
    btn.addEventListener('click', function() { clearSimulation(cy); });
    banner.appendChild(btn);
    wrap.appendChild(banner);
}
