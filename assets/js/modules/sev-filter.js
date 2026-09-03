// sev-filter.js — Severity-Filter-Pills in der Toolbar.
//
// Eigener Toolbar-Bereich rechts mit fünf klickbaren Pills (OK / Info /
// Warn / Avg / High). Pro Pill toggelt einen Severity-Level im Filter.
// Eine "X"-Schaltfläche setzt zurück.
//
// Filter-Zustand ist persistent im user-scoped localStorage (saveSevFilter)
// und überlebt Tab-Wechsel und Reload. Leer = kein Filter, alle sichtbar.

import { loadSevFilter, saveSevFilter } from './storage.js';
import { esc } from './utils.js';
import { t } from './i18n.js';

// Modul-State: Set<number> der aktiven Severity-Levels.
const _sevFilter = loadSevFilter();
// Modul-State: Toggle "nur offline-Hosts zeigen". Persistiert NICHT in
// localStorage — das ist eher ein Ad-hoc-Filter ("zeig mir gerade die
// Toten") als eine Dauer-Praeferenz.
let _offlineOnly = false;

// Filter-Logik einmal als Helper, wird beim Build initial und bei jedem
// Pillen-Klick erneut angewendet. Empty Set → alle sichtbar via reset-style.
function applyFilter(cy) {
    // Offline-Only ueberschreibt Severity: Sev-Pills sind dann irrelevant.
    if (_offlineOnly) {
        cy.nodes('[!isGroup]').forEach(function(n) {
            n.style('display', n.data('unavailable') ? 'element' : 'none');
        });
        cy.edges().forEach(function(e) {
            const show = e.source().data('unavailable') || e.target().data('unavailable');
            e.style('display', show ? 'element' : 'none');
        });
        return;
    }
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
        + 'padding-left:8px;border-left:1px solid var(--nt-c-e2e8f0,#e2e8f0);flex-shrink:0';

    [{ sev: 0, col: '#22c55e', lbl: t('sev.ok') },
     { sev: 2, col: '#06b6d4', lbl: t('sev.info') },
     { sev: 3, col: '#f59e0b', lbl: t('sev.warn') },
     { sev: 4, col: '#f97316', lbl: t('sev.avg') },
     { sev: 5, col: '#ef4444', lbl: t('sev.high') }].forEach(function(sd) {
        const pill = document.createElement('button');
        pill.dataset.sev = sd.sev;
        pill.style.cssText = 'display:flex;align-items:center;gap:3px;padding:2px 7px;'
            + 'border-radius:12px;border:1.5px solid ' + sd.col
            + ';background:transparent;cursor:pointer;font-size:11px;color:' + sd.col
            + ';font-weight:600';
        pill.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:'
            + sd.col + ';display:inline-block"></span>' + esc(sd.lbl);

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

    // Offline-Only Toggle \u2014 separate Pille rechts. Aktiver Zustand mit
    // rotem Akzent damit man sofort sieht "Filter ist scharf, andere Hosts
    // sind ausgeblendet" \u2014 das ist ein recht aggressiver Filter.
    const offBtn = document.createElement('button');
    offBtn.id = 'nt-offline-only';
    offBtn.title = t('sev.offline.tip');
    offBtn.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;'
        + 'background:var(--nt-c-9ca3af,#9ca3af);display:inline-block;margin-right:3px"></span>' + esc(t('sev.offline'));
    const _setOffStyle = function() {
        const a = _offlineOnly;
        offBtn.style.cssText = 'display:flex;align-items:center;padding:2px 7px;'
            + 'border-radius:12px;border:1.5px solid '
            + (a ? '#e53742' : '#cbd5e1')
            + ';background:' + (a ? 'rgba(229,55,66,0.13)' : 'transparent')
            + ';cursor:pointer;font-size:11px;font-weight:600;'
            + 'color:' + (a ? '#e53742' : '#94a3b8');
    };
    _setOffStyle();
    offBtn.addEventListener('click', function() {
        _offlineOnly = !_offlineOnly;
        _setOffStyle();
        // Wenn Offline-Only aktiviert wird, dimmen wir die Sev-Pills optisch
        // (sie haben aktuell keinen Effekt) \u2014 beim Deaktivieren wieder normal.
        wrap.querySelectorAll('button[data-sev]').forEach(function(b) {
            b.style.opacity = _offlineOnly ? '0.4' : '';
            b.style.pointerEvents = _offlineOnly ? 'none' : '';
        });
        applyFilter(cy);
    });
    wrap.appendChild(offBtn);

    const clr = document.createElement('button');
    clr.textContent = '\u2715';
    clr.title = t('sev.reset.tip');
    clr.style.cssText = 'padding:2px 5px;border-radius:10px;border:0.5px solid var(--nt-c-e2e8f0,#e2e8f0);'
        + 'background:transparent;cursor:pointer;font-size:11px;color:var(--nt-c-94a3b8,#94a3b8)';
    clr.addEventListener('click', function() {
        _sevFilter.clear();
        _offlineOnly = false;
        _setOffStyle();
        wrap.querySelectorAll('button[data-sev]').forEach(function(b) {
            b.style.background = 'transparent';
            b.style.boxShadow  = 'none';
            b.style.opacity = '';
            b.style.pointerEvents = '';
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
