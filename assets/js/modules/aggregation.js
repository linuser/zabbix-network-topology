// aggregation.js — Group-View Aggregation.
//
// Verschmilzt alle Hosts einer Host-Gruppe (n._primaryGroup) zu einem einzelnen
// Pseudo-Node und rechnet Edges zwischen verschiedenen Gruppen zu Aggregat-Edges
// um. Pure Function, keine Seiteneffekte — gut isolierbar und testbar.
//
// Eingabe-Nodes brauchen das _primaryGroup-Feld (wird in render() via
// primaryGroup() aus severity.js gesetzt).
//
// VERSCHACHTELTE GRUPPEN
// ----------------------
// Zabbix' Gruppenhierarchie ist eine Namenskonvention: "Berlin/Campus/Access"
// ist eine Gruppe, deren Name drei Ebenen beschreibt. Bis 5.4.2 wurde dieser
// Name als Ganzes genommen, und die Karte zeigte je einen Knoten pro
// BLATTGRUPPE — bei einem Netz ueber mehrere Standorte also fast so viele
// Knoten wie vorher, nur anders beschriftet.
//
// Jetzt entscheidet `ausgeklappt`, wie tief aufgeloest wird. Wer nichts
// aufgeklappt hat, sieht die oberste Ebene; ein Klick auf einen Standort
// loest ihn eine Ebene weiter auf, und ganz unten stehen wieder die Hosts
// selbst. Das ist die Bewegung, die man von einem Ordnerbaum kennt.
//
// Angestossen hat es eine Rueckmeldung zur Lasttest-Karte: tausend Hosts
// anzuzeigen sei sinnlos, sinnvoller waere eine Gruppenebene mit Aufklappen
// auf Zuruf. Das Zusammenfassen gab es da schon, die Ebenen nicht.

import { t } from './i18n.js';
import { INFRA_CAPS } from './device-caps.js';

/**
 * Auf welchem Namen wird dieser Host zusammengefasst — oder gar nicht?
 *
 * Genommen wird die oberste Ebene, und je Ebene, die aufgeklappt ist, eine
 * mehr. Ist auch die letzte aufgeklappt, bleibt nichts zu buendeln: dann
 * liefert die Funktion null, und der Host erscheint als er selbst.
 *
 * Das gilt auch fuer flache Namen ohne '/'. Eine Gruppe "DMZ" aufzuklappen
 * heisst dann schlicht: zeig ihre Hosts. Verschachtelung und Aufklappen sind
 * damit derselbe Mechanismus und nicht zwei.
 *
 * @param {string} name        voller Gruppenname, z.B. "Berlin/Campus/Access"
 * @param {Object} ausgeklappt Praefixe, die offen sind: { "Berlin": true }
 * @return {?string} Name der Ebene, auf der gebuendelt wird, oder null
 */
export function gruppenEbene(name, ausgeklappt) {
    // hasOwnProperty statt offen[x]: ein Gruppenname wie "toString" waere
    // sonst IMMER aufgeklappt, weil er den geerbten Wert trifft.
    const roh = ausgeklappt || {};
    const offen = { has: function(k) { return Object.prototype.hasOwnProperty.call(roh, k) && !!roh[k]; } };
    const teile = String(name || '').split('/');
    let tiefe = 1;
    while (tiefe < teile.length && offen.has(teile.slice(0, tiefe).join('/'))) {
        tiefe++;
    }
    const schluessel = teile.slice(0, tiefe).join('/');
    if (tiefe === teile.length && offen.has(schluessel)) {
        return null;
    }
    return schluessel;
}

/** Nur der letzte Abschnitt — "Berlin/Campus/Access" wird zu "Access". */
export function ebenenLabel(schluessel) {
    const teile = String(schluessel || '').split('/');
    return teile[teile.length - 1] || schluessel;
}

/**
 * Beschriftungen fuer eine ganze MENGE von Pfaden: je das kuerzeste Ende,
 * das diesen Pfad von allen anderen unterscheidet.
 *
 *   Lasttest/Berlin/Core  +  Lasttest/Muenchen/Core
 *     -> "Berlin/Core"    und  "Muenchen/Core"
 *   Lasttest/Berlin/Core  +  Lasttest/Berlin/Dist
 *     -> "Core"           und  "Dist"
 *
 * Der letzte Abschnitt allein genuegt naemlich nicht. Genau das war an den
 * Gruppen-Huellen zu sehen: zwei Kerne an verschiedenen Standorten standen
 * beide als "Core" nebeneinander und waren nicht mehr zu unterscheiden. Der
 * volle Pfad im Tooltip hilft beim Nachsehen, nicht beim Hinsehen.
 *
 * Quadratisch in der Zahl der Pfade. Das ist hier richtig so: es geht um
 * die Gruppen EINER Karte, und davon gibt es Dutzende, keine Tausende.
 */
export function kurzeLabels(namen) {
    const liste = (namen || []).map(String);
    const raus = Object.create(null);
    const ende = function(pfad, tiefe) {
        const t = pfad.split('/');
        return t.slice(Math.max(0, t.length - tiefe)).join('/');
    };
    liste.forEach(function(n) {
        const teile = n.split('/');
        let tiefe = 1;
        while (tiefe < teile.length) {
            const suffix = ende(n, tiefe);
            let gleich = 0;
            liste.forEach(function(m) { if (ende(m, tiefe) === suffix) gleich++; });
            if (gleich === 1) break;
            tiefe++;
        }
        raus[n] = ende(n, tiefe) || n;
    });
    return raus;
}

export function aggregateByGroup(nodes, edges, ausgeklappt) {
    const offen = ausgeklappt || {};
    // Hosts nach Ebene bündeln. Wer auf keiner Ebene mehr gebuendelt wird,
    // geht unveraendert durch — so stehen aufgeklappte Gruppen neben
    // zusammengefassten, und man sieht, wo man gerade hineingesehen hat.
    // Ohne Prototyp. Eine Hostgruppe heisst, wie der Betreiber sie nennt, und
    // bei "constructor" oder "toString" trifft groups[name] sonst eine
    // geerbte Funktion: die Pruefung !groups[name] ist dann falsch, es wird
    // nie initialisiert, und .push() auf eine Funktion wirft. Die Karte
    // bliebe weiss. Nachgestellt, nicht vermutet.
    const groups = Object.create(null);
    const einzeln = [];
    nodes.forEach(function(n) {
        const g = n._primaryGroup || t('agg.no_group');
        const schluessel = gruppenEbene(g, offen);
        if (schluessel === null) {
            einzeln.push(n);
            return;
        }
        if (!groups[schluessel]) groups[schluessel] = [];
        groups[schluessel].push(n);
    });

    const aggNodes = einzeln.slice();
    const nodeToGroup = Object.create(null);   // hostId -> Ebenenname (für Edge-Aggregation)
    // Beschriftungen ueber die ganze Menge, nicht je Gruppe einzeln: zwei
    // Ebenen gleichen Namens an verschiedenen Stellen muessen unterscheidbar
    // bleiben.
    const kurz = kurzeLabels(Object.keys(groups));

    Object.keys(groups).forEach(function(gname) {
        const children = groups[gname];
        children.forEach(function(c) { nodeToGroup[String(c.id)] = gname; });

        let maxSev = 0, sumProblems = 0;
        let cpuSum = 0, cpuCnt = 0, memSum = 0, memCnt = 0, pingMin = null;
        let trIn = 0, trOut = 0;
        let allAcked = true;       // alle Probleme in der Gruppe acked?
        let anyProblems = false;
        let allMaintenance = true; // alle Hosts in Wartung?
        const topProblems = [];

        children.forEach(function(c) {
            const s = c.severity || 0;
            if (s > maxSev) maxSev = s;
            sumProblems += (c.problems || 0);
            if (c.cpu    != null && !isNaN(c.cpu))    { cpuSum += c.cpu; cpuCnt++; }
            if (c.memory != null && !isNaN(c.memory)) { memSum += c.memory; memCnt++; }
            if (c.ping   != null && c.ping > 0) {
                if (pingMin === null || c.ping < pingMin) pingMin = c.ping;
            }
            if (c.traffic) {
                trIn  += c.traffic.in  || 0;
                trOut += c.traffic.out || 0;
            }
            // Acked-Aggregation: Gruppe gilt nur als acked, wenn alle Hosts
            // mit Problemen ihre Probleme acked haben.
            if ((c.problems || 0) > 0) {
                anyProblems = true;
                if (!c.acknowledged) allAcked = false;
            }
            if (!c.maintenance) allMaintenance = false;
            if (s >= 3) topProblems.push({ label: c.label || c.host || c.id, sev: s });
        });
        topProblems.sort(function(a, b) { return b.sev - a.sev; });

        aggNodes.push({
            id:      'grp_' + gname,
            // Nur der letzte Abschnitt, sonst steht bei tiefen Hierarchien
            // dreimal derselbe Standort an jedem Knoten. Der volle Pfad
            // bleibt in host und wird im Detail-Panel und Tooltip gezeigt.
            label:   kurz[gname] + ' (' + children.length + ')',
            host:    gname,
            ip:      null,
            type:    'group',
            iftype:  null,
            severity: maxSev,
            problems: sumProblems,
            acknowledged: anyProblems && allAcked,
            maintenance:  allMaintenance,
            cpu:    cpuCnt ? Math.round(cpuSum / cpuCnt) : null,
            memory: memCnt ? Math.round(memSum / memCnt) : null,
            ping:   pingMin,
            traffic: { in: trIn, out: trOut },
            groups: [gname],
            _primaryGroup: gname,
            _isAggregate: true,
            // Woran die Oberflaeche erkennt, dass hier noch etwas drin ist.
            _gruppenPfad: gname,
            _childCount: children.length,
            _topProblems: topProblems.slice(0, 3)
        });
    });

    // Edges aggregieren: Edges innerhalb derselben Gruppe entfallen,
    // Cross-Group-Edges werden zu einer einzelnen Edge mit Summen-Counter.
    // Wer vertritt einen Knoten: sein Aggregat — oder er selbst, wenn seine
    // Gruppe aufgeklappt ist. Ohne diese Unterscheidung verloeren aufgeklappte
    // Hosts jede Kante zur restlichen Karte und haengen im Nichts.
    const vertreter = Object.create(null);
    nodes.forEach(function(n) {
        const id = String(n.id);
        vertreter[id] = nodeToGroup[id] ? 'grp_' + nodeToGroup[id] : id;
    });

    const aggEdgeMap = {};
    const echte = [];
    edges.forEach(function(e) {
        const sId = String(e.source || e.from || '');
        const tId = String(e.target || e.to || '');
        const src = vertreter[sId];
        const tgt = vertreter[tId];
        if (!src || !tgt || src === tgt) return;

        // Haengt das Kabel an ZWEI aufgeklappten Hosts, bleibt es, wie es ist.
        //
        // Das ist kein Feinschliff, daran ist die Karte gestorben. Eine
        // Aggregat-Kante ist {source, target, count} — ohne id, Ports,
        // Verkehr, LLDP-Kennzeichen. Solange ALLES zusammengefasst war, gab
        // es nie eine andere Art Kante und die magere Form war richtig. Seit
        // eine Gruppe ganz geoeffnet werden kann, treffen echte Hosts
        // aufeinander, und ihre Kabel als Aggregate nachzubauen heisst, sie
        // zu zerstoeren: "Loading topology…" blieb stehen, der Server hatte
        // laengst 1,3 MB geliefert.
        if (!nodeToGroup[sId] && !nodeToGroup[tId]) {
            echte.push(e);
            return;
        }

        const key = [src, tgt].sort().join('|');
        if (!aggEdgeMap[key]) {
            aggEdgeMap[key] = { source: src, target: tgt, count: 0 };
        }
        aggEdgeMap[key].count++;
    });
    const aggEdges = echte.concat(
        Object.keys(aggEdgeMap).map(function(k) { return aggEdgeMap[k]; }));

    return { nodes: aggNodes, edges: aggEdges };
}


// ── ENDGERÄTE BÜNDELN ──────────────────────────────────────────────────────
//
// An einem Access-Switch mit 48 Ports haengen 48 Geister, wenn man sie alle
// zeigt. Diese Funktion fasst die ENDGERÄTE darunter zu EINEM Knoten je Switch
// zusammen ("34 Endgeraete"), der sich per Klick aufklappt. Anders als der
// Geisterfilter (5.3.2), der Geraete WEGWIRFT, bleibt hier alles erhalten —
// nur die Flaeche schrumpft.
//
// WAS GEBÜNDELT WIRD — strenger als beim Filter, sonst buendelt man Switches:
//   - ein Geist (unueberwacht)
//   - der an GENAU EINEM Geraet haengt (ein Blatt, eine Kante)
//   - ohne Infrastruktur-Faehigkeit (nicht Bridge/Router/WLAN AP)
//
// Die Umkehrung zum Filter ist Absicht. Dort gilt "keine Faehigkeiten = behalten"
// (ein unbekanntes Geraet koennte ein unueberwachter Switch sein). Beim Buendeln
// ist ein namenloses, EINSEITIG haengendes Blatt ohne Infra-Faehigkeit mit
// grosser Mehrheit ein Endgeraet — PC, Drucker, Telefon —, und genau die sind
// die achtundvierzig. Ein Switch meldet Bridge ODER haengt an mehreren Ports;
// beides schliesst ihn hier aus.

/** Ab wie vielen Endgeraeten an einem Switch sich ein Buendel lohnt. */
export const BUENDEL_AB = 3;

/**
 * Ist dieser Knoten ein buendelbares Endgeraet?
 *
 * Erwartet den Knoten und seinen Grad (Anzahl Kanten). Die Infrastruktur-
 * Faehigkeiten kommen aus build-elements (INFRA_CAPS), damit die Grenze an
 * EINER Stelle steht — ein Switch, der hier anders eingestuft wuerde als dort,
 * waere genau die Verwechslung, die diese Pruefung vermeiden soll.
 */
export function istEndgeraet(n, grad) {
    if (!n || !n._isGhost) {
        return false;
    }
    if (grad !== 1) {
        return false;   // mehr als eine Kante -> kein Blatt, eher Infrastruktur
    }
    const caps = n._ghostCaps || [];
    return !caps.some(function(c) { return INFRA_CAPS.indexOf(c) !== -1; });
}

/**
 * Endgeraete je Switch zu einem Buendel-Knoten zusammenfassen.
 *
 * Spiegelt aggregateByGroup: eine reine Funktion ohne Seiteneffekte. `offen`
 * ist die Menge der aufgeklappten Switch-IDs (pro Browser gespeichert, wie der
 * Gruppen-Aufklappzustand seit 5.5.0). Ein aufgeklappter Switch zeigt seine
 * Endgeraete wieder einzeln.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @param {Object} offen  switchId -> true
 * @return {{nodes: Array, edges: Array}}
 */
export function aggregateEndpoints(nodes, edges, offen) {
    const auf = offen || {};
    const byId = Object.create(null);
    (nodes || []).forEach(function(n) { byId[String(n.id)] = n; });

    // Grad je Knoten und — fuer Blaetter — der einzige Nachbar.
    const grad = Object.create(null);
    const nachbar = Object.create(null);
    (edges || []).forEach(function(e) {
        const a = String(e.source || e.from || '');
        const b = String(e.target || e.to || '');
        if (!a || !b || a === b) return;
        grad[a] = (grad[a] || 0) + 1;
        grad[b] = (grad[b] || 0) + 1;
        nachbar[a] = b;
        nachbar[b] = a;
    });

    // Buendelbare Endgeraete je Switch sammeln.
    const proSwitch = Object.create(null);   // switchId -> [endpointNode, ...]
    (nodes || []).forEach(function(n) {
        const id = String(n.id);
        if (!istEndgeraet(n, grad[id] || 0)) return;
        const sw = nachbar[id];
        if (!sw || !byId[sw]) return;         // Nachbar nicht auf der Karte
        (proSwitch[sw] = proSwitch[sw] || []).push(n);
    });

    // Welche Switches werden tatsaechlich gebuendelt: genug Endgeraete UND
    // nicht aufgeklappt. Ein aufgeklappter oder zu duenn besetzter Switch
    // laesst seine Endgeraete unveraendert durch.
    const gebuendelt = Object.create(null);   // endpointId -> switchId
    Object.keys(proSwitch).forEach(function(sw) {
        if (auf[sw]) return;
        if (proSwitch[sw].length < BUENDEL_AB) return;
        proSwitch[sw].forEach(function(n) { gebuendelt[String(n.id)] = sw; });
    });

    // Knoten: alles Nicht-Gebuendelte unveraendert, plus ein Buendel je Switch.
    const outNodes = [];
    (nodes || []).forEach(function(n) {
        if (!gebuendelt[String(n.id)]) outNodes.push(n);
    });
    Object.keys(proSwitch).forEach(function(sw) {
        if (auf[sw] || proSwitch[sw].length < BUENDEL_AB) return;
        const kinder = proSwitch[sw];
        outNodes.push({
            id: 'bundle_' + sw,
            label: t('bundle.label', { n: kinder.length }),
            host: '',
            type: 'bundle',
            severity: 0,
            problems: 0,
            _isEndpointBundle: true,
            _bundleSwitch: sw,
            _childCount: kinder.length,
            groups: [], traffic: { in: 0, out: 0 }
        });
    });

    // Kanten: die Kante eines gebuendelten Endgeraets wird zur Buendel-Kante.
    // Alles andere bleibt, wie es ist (vor allem die Kanten zwischen echten
    // Geraeten — dieselbe Lehre wie bei aggregateByGroup).
    const outEdges = [];
    const buendelKante = Object.create(null);   // switchId -> true (einmal je Switch)
    (edges || []).forEach(function(e) {
        const a = String(e.source || e.from || '');
        const b = String(e.target || e.to || '');
        const swA = gebuendelt[a];
        const swB = gebuendelt[b];
        if (!swA && !swB) { outEdges.push(e); return; }   // nichts Gebuendeltes
        const sw = swA || swB;
        if (buendelKante[sw]) return;                     // nur eine Buendel-Kante
        buendelKante[sw] = true;
        outEdges.push({ source: sw, target: 'bundle_' + sw, _isBundleEdge: true });
    });

    return { nodes: outNodes, edges: outEdges };
}
