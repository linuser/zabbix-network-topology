// collapse-leaves.js — Blätter einklappen, damit die Übersicht eine bleibt.
//
// WOZU
// ----
// Der Lasttest mit 200 simulierten Geräten hat das Bild geliefert, das es
// vorher nicht gab: 182 der 200 Knoten sind Zugangs-Switches mit genau einem
// Uplink und nichts dahinter. In der Übersicht tragen sie keine
// Topologieinformation — nur ihre ANZAHL tut das. Gezeichnet werden sie
// trotzdem alle, mitsamt Beschriftung, und übrig bleibt ein Haarball.
//
// Eingeklappt wird deshalb, was zugleich gilt:
//   * Grad 1 (genau eine Kante),
//   * der einzige Nachbar hat Grad >= 3 (ein Verteiler, kein Paar),
//   * kein Geist, keine Gruppe, keine Internet-Wolke.
//
// WAS AUSDRÜCKLICH NICHT PASSIERT
// -------------------------------
// Es wird nichts entfernt und nichts Synthetisches erzeugt. Die Knoten und
// Kanten bleiben im Graphen und nur ihre Darstellung wird abgeschaltet.
// Der Grund steht in CLAUDE.md: eine synthetische Kante zählt jeder
// cy.edges()-Aufrufer mit — KPI, Export, What-if, Pfadsuche. Dasselbe gilt
// fürs Entfernen, nur andersherum: die Kopfzeile meldete plötzlich 18 Hosts
// statt 200, und niemand könnte sagen, ob die Karte oder das Netz schrumpfte.
// So bleiben alle Zählungen richtig, und "200 Hosts · 288 Edges" stimmt
// weiterhin, während 18 Knoten zu sehen sind.
//
// Der Elternknoten sagt, wie viele hinter ihm liegen, und ein Klick auf ihn
// klappt genau seine Blätter wieder aus — das ist die Bewegung, die man
// erwartet, wenn irgendwo "+12" steht.

import { t } from './i18n.js';

const KLASSE = 'nt-leaf-hidden';
const AUSGEKLAPPT = 'nt-leaf-open';
const SCHLUESSEL = 'nt_collapse_leaves';

/** Ab so vielen Blaettern lohnt es sich von allein. */
export const COLLAPSE_SCHWELLE = 40;

let _aktiv = false;

export function isCollapsed() { return _aktiv; }

// ── Wer die Beschriftung traegt, muss von JEDER Aenderung erfahren ─────────
//
// Auch von der, die niemand angeklickt hat: die Karte klappt beim ersten
// Zeichnen von allein ein (COLLAPSE_SCHWELLE), und der Werkzeugknopf wird
// VORHER gebaut. Bei tausend Geraeten stand er danach auf "off (921)",
// waehrend genau diese 921 Blaetter versteckt waren — und ausgegraut, als
// laufe die Funktion nicht. Der Klick tat trotzdem das Richtige, weil
// isCollapsed() den echten Zustand kennt; falsch war nur die Aufschrift,
// und die ist das Einzige, woran man den Zustand ablesen kann.
//
// Ein Melder statt eines Imports, weil toolbar.js und render-tech.js
// einander nicht kennen und das auch so bleiben soll. Beide kennen dieses
// Modul.

let _melder = null;

/** Beschriftung anmelden. Wird sofort einmal gerufen. */
export function onCollapseChanged(fn) {
    _melder = typeof fn === 'function' ? fn : null;
    melde();
}

function melde() {
    if (_melder) {
        // Ein Fehler in der Beschriftung darf das Einklappen nicht abbrechen:
        // sonst bliebe die Karte halb umgebaut stehen.
        try { _melder(); } catch (e) {}
    }
}

/**
 * Gespeicherte Wahl: true, false — oder null, wenn der Benutzer nie etwas
 * gesagt hat. Die drei Zustaende sind nicht dasselbe: nur bei null darf die
 * Karte selbst entscheiden. Wer einmal ausgeklappt hat, soll nicht beim
 * naechsten Laden wieder eingeklappt vorfinden, weil eine Schwelle das so
 * sieht. Dieselbe Unterscheidung wie bei der Gruppenansicht.
 */
export function collapsePref() {
    try {
        const v = localStorage.getItem(SCHLUESSEL);
        return v === null ? null : v === '1';
    } catch (e) { return null; }
}

export function setCollapsePref(v) {
    try { localStorage.setItem(SCHLUESSEL, v ? '1' : '0'); } catch (e) {}
}

/** Kandidaten finden. Reine Lesefunktion — auch für die Vorschau im Button. */
export function leafCandidates(cy) {
    if (!cy || (cy.destroyed && cy.destroyed())) return [];
    const raus = [];
    cy.nodes('[!isGroup]').forEach(function(n) {
        if (n.data('_isGhost') || n.data('_isInternet')) return;
        // Kanten ohne Schleifen zählen; eine Schleife machte aus einem Blatt
        // rechnerisch einen Verteiler.
        const kanten = n.connectedEdges().filter(function(e) {
            return e.source().id() !== e.target().id();
        });
        // Mehrere Kabel zu DEMSELBEN Nachbarn sind ein Bündel, kein zweiter
        // Nachbar. Ohne diese Unterscheidung wäre ein Zugangs-Switch mit
        // 2x10G-LAG kein Blatt mehr — und im Lasttest hing genau daran jeder
        // dritte davon.
        const nachbarn = {};
        kanten.forEach(function(e) {
            const o = e.source().id() === n.id() ? e.target() : e.source();
            nachbarn[o.id()] = o;
        });
        const ids = Object.keys(nachbarn);
        if (ids.length !== 1) return;
        const eltern = nachbarn[ids[0]];
        if (eltern.data('_isGhost') || eltern.data('isGroup')) return;
        if (nachbarZahl(eltern) < 3) return;
        raus.push({ blatt: n, eltern: eltern });
    });
    return raus;
}

/** Wie viele VERSCHIEDENE Nachbarn ein Knoten hat (Bündel zählen einfach). */
function nachbarZahl(n) {
    const gesehen = {};
    n.connectedEdges().forEach(function(e) {
        const a = e.source().id(), b = e.target().id();
        if (a === b) return;
        gesehen[a === n.id() ? b : a] = 1;
    });
    return Object.keys(gesehen).length;
}

export function collapseLeaves(cy) {
    if (!cy || (cy.destroyed && cy.destroyed())) return 0;
    // Still, nicht ueber expandLeaves: sonst meldet ein Einklappen zuerst
    // "aus" und gleich darauf "an". Zu sehen ist der Zwischenstand nie,
    // aber jeder Melder muesste damit rechnen.
    _ausklappen(cy);

    const kandidaten = leafCandidates(cy);
    if (!kandidaten.length) return 0;

    const proEltern = {};
    cy.startBatch();
    kandidaten.forEach(function(k) {
        k.blatt.addClass(KLASSE);
        k.blatt.connectedEdges().addClass(KLASSE);
        (proEltern[k.eltern.id()] = proEltern[k.eltern.id()] || []).push(k.blatt.id());
    });

    Object.keys(proEltern).forEach(function(id) {
        const eltern = cy.getElementById(id);
        if (!eltern || !eltern.length) return;
        // Das Originallabel merken statt es neu zu bauen: es entsteht in
        // build-elements aus label/host/IP mit einer eigenen Regel, und die
        // hier zu wiederholen hiesse, sie zweimal zu pflegen.
        if (eltern.data('_labelVorEinklappen') === undefined) {
            eltern.data('_labelVorEinklappen', eltern.data('label') || '');
        }
        eltern.data('_blaetter', proEltern[id].length);
        eltern.data('label', (eltern.data('_labelVorEinklappen') || '')
            + '  ▸' + proEltern[id].length);
    });
    cy.endBatch();

    _aktiv = true;
    melde();
    return kandidaten.length;
}

export function expandLeaves(cy) {
    _ausklappen(cy);
    melde();
}

function _ausklappen(cy) {
    if (!cy || (cy.destroyed && cy.destroyed())) return;
    cy.startBatch();
    cy.elements('.' + KLASSE).removeClass(KLASSE);
    cy.elements('.' + AUSGEKLAPPT).removeClass(AUSGEKLAPPT);
    cy.nodes('[_blaetter]').forEach(function(n) {
        if (n.data('_labelVorEinklappen') !== undefined) {
            n.data('label', n.data('_labelVorEinklappen'));
        }
        n.removeData('_blaetter');
    });
    cy.endBatch();
    _aktiv = false;
}

/**
 * Einen einzelnen Elternknoten aufklappen, ohne den Rest anzufassen.
 *
 * Wer auf "+12" klickt, will diese zwölf sehen und nicht die anderen
 * hundertsiebzig dazu.
 */
export function expandOne(cy, eltern) {
    if (!eltern || !eltern.length || !eltern.data('_blaetter')) return;
    cy.startBatch();
    eltern.connectedEdges('.' + KLASSE).forEach(function(e) {
        const blatt = e.source().id() === eltern.id() ? e.target() : e.source();
        blatt.removeClass(KLASSE).addClass(AUSGEKLAPPT);
        e.removeClass(KLASSE).addClass(AUSGEKLAPPT);
    });
    if (eltern.data('_labelVorEinklappen') !== undefined) {
        eltern.data('label', eltern.data('_labelVorEinklappen'));
    }
    eltern.removeData('_blaetter');
    cy.endBatch();
    // Auch hier: die Zahl in der Aufschrift ist jetzt um zwoelf kleiner.
    melde();
}

/**
 * Klick auf einen eingeklappten Elternknoten klappt ihn auf.
 *
 * Einmal binden, nicht bei jedem Ein- und Ausklappen: ein zweiter Handler auf
 * demselben Ereignis klappte beim ersten Klick auf und beim selben Klick
 * gleich wieder zu.
 */
export function bindCollapse(cy) {
    if (!cy || cy.scratch('_ntLeafGebunden')) return;
    cy.scratch('_ntLeafGebunden', true);
    cy.on('tap', 'node[_blaetter]', function(ev) {
        expandOne(cy, ev.target);
    });
}

/** Text für den Werkzeugknopf. */
export function collapseLabel(cy) {
    const n = _aktiv
        ? cy.nodes('.' + KLASSE).length
        : leafCandidates(cy).length;
    return t('toolbar.collapse', {
        state: _aktiv ? t('toolbar.on') : t('toolbar.off'), n: n
    });
}
