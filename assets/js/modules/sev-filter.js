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

// "Nicht ueberwacht" als FILTERSCHLUESSEL.
//
// Warum eine Zahl und kein 'ghost': loadSevFilter() wirft beim Lesen alles
// weg, was keine Zahl ist. Eine Zeichenkette haette also jeden Reload nicht
// ueberlebt — und den Speichervertrag zu aendern, um ein Pill zu ergaenzen,
// waere der teurere Weg. -1 kann keine Severity sein (Zabbix kennt 0..5).
export const SEV_GHOST = -1;

// Unter welchem Schluessel steht dieser Knoten im Filter?
//
// EIN GEIST IST KEINE SEVERITY 0. Er traegt sie nur, weil ueber ihn nichts
// BEKANNT ist — nicht, weil alles in Ordnung waere. Bis hierher hing er
// deshalb an der OK-Pille: wer auf Probleme filterte, verlor die
// unueberwachten Geraete mit, und wer sie SUCHTE, hatte gar keinen Schalter.
// Dieselbe Verwechslung stand in der Tabellenzeile, im Zaehler und in der
// CSV; dies ist die vierte Stelle.
// Exportiert, damit ci:frontend die Aussage ohne Browser lesen kann: welcher
// Knoten unter welchem Schluessel steht, ist der ganze Inhalt dieser Regel.
export function filterSchluessel(n) {
    return n.data('_isGhost') ? SEV_GHOST : (n.data('severity') || 0);
}

// Modul-State: Set<number> der aktiven Severity-Levels (plus SEV_GHOST).
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
        n.style('display', _sevFilter.has(filterSchluessel(n)) ? 'element' : 'none');
    });
    cy.edges().forEach(function(e) {
        const show = _sevFilter.has(filterSchluessel(e.source()))
                  && _sevFilter.has(filterSchluessel(e.target()));
        e.style('display', show ? 'element' : 'none');
    });
}

export function buildSevFilter(bar, cy) {
    if (document.getElementById('nt-sev-filter')) return;
    const wrap = document.createElement('div');
    wrap.id = 'nt-sev-filter';
    wrap.style.cssText = 'display:flex;align-items:center;gap:5px;margin-left:10px;'
        + 'padding-left:8px;border-left:1px solid var(--nt-line);flex-shrink:0';

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
        // Punkt als Element, Text als textContent. Mit esc() in einen
        // HTML-String war es richtig, aber nur solange jemand daran denkt;
        // so kann die Beschriftung gar kein Markup mehr sein.
        const punkt = document.createElement('span');
        punkt.style.cssText = 'width:7px;height:7px;border-radius:50%;'
            + 'display:inline-block;background:' + sd.col;
        pill.appendChild(punkt);
        pill.appendChild(document.createTextNode(sd.lbl));

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

    // "Nicht ueberwacht" — NUR wenn die Karte ueberhaupt Geister traegt.
    //
    // Ein Schalter, der nichts schalten kann, ist schlimmer als keiner: er
    // sieht aus wie ein kaputter. Der Geister-Umschalter steht gleich daneben
    // und ist die Stelle, an der man sie erst einschaltet. Die Toolbar wird
    // bei jedem Render neu gebaut, die Pille kommt also von selbst dazu.
    //
    // Gestrichelt und gedaempft wie die Statuspille im Detail-Panel und in
    // der Tabelle — dieselbe Aussage soll ueberall gleich aussehen.
    if (cy.nodes().some(function(n) { return n.data('_isGhost'); })) {
        const geistCol = '#94a3b8';
        const gPill = document.createElement('button');
        gPill.id = 'nt-sev-ghost';
        gPill.title = t('sev.ghost.tip');
        const gStil = function() {
            const a = _sevFilter.has(SEV_GHOST);
            gPill.style.cssText = 'display:flex;align-items:center;gap:3px;padding:2px 7px;'
                + 'border-radius:12px;border:1.5px dashed ' + geistCol
                + ';background:' + (a ? geistCol + '33' : 'transparent')
                + ';cursor:pointer;font-size:11px;color:' + geistCol + ';font-weight:600'
                + (a ? ';box-shadow:0 0 0 2px ' + geistCol + '44' : '');
        };
        gStil();
        gPill.appendChild(document.createTextNode('\u{1F47B} ' + t('sev.ghost')));
        gPill.addEventListener('click', function() {
            if (_sevFilter.has(SEV_GHOST)) {
                _sevFilter.delete(SEV_GHOST);
            } else {
                _sevFilter.add(SEV_GHOST);
            }
            gStil();
            applyFilter(cy);
            saveSevFilter(_sevFilter);
        });
        wrap.appendChild(gPill);
    }

    // Offline-Only Toggle \u2014 separate Pille rechts. Aktiver Zustand mit
    // rotem Akzent damit man sofort sieht "Filter ist scharf, andere Hosts
    // sind ausgeblendet" \u2014 das ist ein recht aggressiver Filter.
    const offBtn = document.createElement('button');
    offBtn.id = 'nt-offline-only';
    offBtn.title = t('sev.offline.tip');
    offBtn.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;'
        + 'background:#9ca3af;display:inline-block;margin-right:3px"></span>' + esc(t('sev.offline'));
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
    clr.style.cssText = 'padding:2px 5px;border-radius:10px;border:0.5px solid var(--nt-line);'
        + 'background:transparent;cursor:pointer;font-size:11px;color:#94a3b8';
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
