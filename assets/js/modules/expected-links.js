// expected-links.js — Soll/Ist-Overlay: die ERWARTETE Verkabelung (nt:expect-Tag)
// gegen die GEMESSENE halten. Das Backend (ExpectedLinks) liefert die
// Abweichungen in window._ntLastData.expected_links.deviations; hier werden sie als
// gestrichelte Overlay-Kante zwischen den beiden Hosts gezeichnet — NUR die
// Abweichungen, Treffer sind ohnehin schon als normale Kante vorhanden.
//
// Reine Darstellung, keine Layout-Abhaengigkeit: die Overlay-Kante haengt an
// den vorhandenen Knoten. Eine Abweichung, deren erwarteter Nachbar NICHT in
// der Ansicht liegt (to leer), kann nicht gezeichnet werden und zaehlt nur in
// der KPI-Pille.

import { t } from './i18n.js';

const SI_CLASS  = 'nt-expected';
const SI_PREFIX = 'si_';

export function clearExpected(cy) {
    if (!cy) return;
    try { cy.edges('.' + SI_CLASS).remove(); } catch (e) {}
}

export function applyExpected(cy) {
    if (!cy) return;
    clearExpected(cy);
    const data = (window._ntLastData && window._ntLastData.expected_links) || null;
    if (!data || !Array.isArray(data.deviations)) return;

    let n = 0;
    data.deviations.forEach(function(dev) {
        const from = String(dev.from || '');
        const to   = String(dev.to || '');
        if (!from || !to) return;                        // Nachbar nicht in der Ansicht
        if (cy.getElementById(from).empty() || cy.getElementById(to).empty()) return;

        const key = dev.status === 'misconnected' ? 'misconnected' : 'not_seen';
        const port = dev.port ? ' (' + dev.port + ')' : '';
        cy.add({
            group:   'edges',
            classes: SI_CLASS,
            data: {
                id:          SI_PREFIX + (n++),
                source:      from,
                target:      to,
                _expectedGap:    true,
                _siStatus:   dev.status,
                _siExpected: dev.expected || '',
                _siPort:     dev.port || '',
                _siActual:   dev.actual || [],
                tLabel:      t('expected.edge.' + key) + port,
            },
        });
    });
}
