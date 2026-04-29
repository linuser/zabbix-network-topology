// sev-filter.js — Severity-Filter-Pills in der Toolbar.
//
// Eigener Toolbar-Bereich rechts mit fünf klickbaren Pills (OK / Info /
// Warn / Avg / High). Pro Pill toggelt einen Severity-Level im Filter.
// Eine "X"-Schaltfläche setzt zurück.
//
// Filter-Zustand ist persistent im user-scoped localStorage (saveSevFilter)
// und überlebt Tab-Wechsel und Reload. Leer = kein Filter, alle sichtbar.

import { loadSevFilter, saveSevFilter } from './storage.js';

// Modul-State: Set<number> der aktiven Severity-Levels.
const _sevFilter = loadSevFilter();

// Filter-Logik einmal als Helper, wird beim Build initial und bei jedem
// Pillen-Klick erneut angewendet. Empty Set → alle sichtbar via reset-style.
function applyFilter(cy) {
    if (_sevFilter.size === 0) {
        cy.elements().style('display', 'element');
        return;
    }
    cy.nodes('[!isGroup]').forEach(function(n) {
        n.style('display', _sevFilter.has(n.data('severity') || 0) ? 'element' : 'none');
    });
    cy.edges().forEach(function(e) {
        const show = _sevFilter.has(e.source().data('severity') || 0)
                  && _sevFilter.has(e.target().data('severity') || 0);
        e.style('display', show ? 'element' : 'none');
    });
}

export function buildSevFilter(bar, cy) {
    if (document.getElementById('nt-sev-filter')) return;
    const wrap = document.createElement('div');
    wrap.id = 'nt-sev-filter';
    wrap.style.cssText = 'display:flex;align-items:center;gap:5px;margin-left:10px;'
        + 'padding-left:8px;border-left:1px solid #e2e8f0;flex-shrink:0';

    [{ sev: 0, col: '#22c55e', lbl: 'OK' },
     { sev: 2, col: '#06b6d4', lbl: 'Info' },
     { sev: 3, col: '#f59e0b', lbl: 'Warn' },
     { sev: 4, col: '#f97316', lbl: 'Avg' },
     { sev: 5, col: '#ef4444', lbl: 'High' }].forEach(function(sd) {
        const pill = document.createElement('button');
        pill.dataset.sev = sd.sev;
        pill.style.cssText = 'display:flex;align-items:center;gap:3px;padding:2px 7px;'
            + 'border-radius:12px;border:1.5px solid ' + sd.col
            + ';background:transparent;cursor:pointer;font-size:11px;color:' + sd.col
            + ';font-weight:600';
        pill.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:'
            + sd.col + ';display:inline-block"></span>' + sd.lbl;

        // Wenn aus localStorage geladen schon aktiv → optisch markieren
        if (_sevFilter.has(sd.sev)) {
            pill.style.background = sd.col + '33';
            pill.style.boxShadow  = '0 0 0 2px ' + sd.col + '44';
        }

        pill.addEventListener('click', function() {
            const s = parseInt(this.dataset.sev);
            if (_sevFilter.has(s)) {
                _sevFilter.delete(s);
                this.style.background = 'transparent';
                this.style.boxShadow = 'none';
            } else {
                _sevFilter.add(s);
                this.style.background = sd.col + '33';
                this.style.boxShadow = '0 0 0 2px ' + sd.col + '44';
            }
            applyFilter(cy);
            saveSevFilter(_sevFilter);
        });
        wrap.appendChild(pill);
    });

    const clr = document.createElement('button');
    clr.textContent = '\u2715';
    clr.title = 'Filter zur\u00FCcksetzen';
    clr.style.cssText = 'padding:2px 5px;border-radius:10px;border:0.5px solid #e2e8f0;'
        + 'background:transparent;cursor:pointer;font-size:11px;color:#94a3b8';
    clr.addEventListener('click', function() {
        _sevFilter.clear();
        wrap.querySelectorAll('button[data-sev]').forEach(function(b) {
            b.style.background = 'transparent';
            b.style.boxShadow  = 'none';
        });
        applyFilter(cy);
        saveSevFilter(_sevFilter);
    });
    wrap.appendChild(clr);

    bar.appendChild(wrap);

    // Initial-Apply: gespeicherter Filter muss auf das frisch gerenderte
    // Cytoscape angewendet werden, sonst sieht man die markierten Pillen
    // ohne entsprechenden Effekt auf der Karte.
    if (_sevFilter.size > 0) applyFilter(cy);
}
