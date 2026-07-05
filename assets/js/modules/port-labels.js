// port-labels.js — LLDP-Port-Labels an den Edge-Enden (Best-Effort).
//
// Das Backend extrahiert pro Edge und Richtung den Bracket-Parameter des
// meldenden LLDP/CDP-Items (edge.ports = {hostid: port}); build-elements
// mappt das auf portSrc/portTgt. Bei LLD-Keys wie lldpRemSysName[0.24.1]
// ist das der lokale Port des Reporters — bei Comma-Listen-Items ohne
// Bracket gibt es keinen Port-Bezug und das Label bleibt leer.
//
// Anzeige via Inline-Styles (source-/target-label) — nichts anderes setzt
// diese Properties, kein Konflikt mit Heatmap/Klassen. Die Offsets stehen
// im Basis-Edge-Style (render-tech-style.js).

import { NT_PORTLABELS_KEY } from './storage.js';

let _on = false;
try { _on = localStorage.getItem(NT_PORTLABELS_KEY) === '1'; } catch (e) {}

export function portLabelsOn() { return _on; }

export function setPortLabels(v) {
    _on = !!v;
    try { localStorage.setItem(NT_PORTLABELS_KEY, _on ? '1' : '0'); } catch (e) {}
}

export function applyPortLabels(cy) {
    if (!cy || (cy.destroyed && cy.destroyed())) return;
    cy.edges().forEach(function(e) {
        if (e.data('_isInternetEdge')) return;
        const ps = e.data('portSrc') || '';
        const pt = e.data('portTgt') || '';
        if (_on && ps) e.style('source-label', ps); else e.removeStyle('source-label');
        if (_on && pt) e.style('target-label', pt); else e.removeStyle('target-label');
    });
}
