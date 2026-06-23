// presets-ui.js — Layout-Preset-Verwaltung in der Toolbar.
//
// Eigener Bereich rechts neben Export-Menü mit:
//   - Dropdown der gespeicherten Presets (gefiltert nach Scope:
//     "Diese Auswahl" oder "Global")
//   - 💾 Save: aktives Preset mit Live-State überschreiben
//   - 📝 Save As: neues Preset speichern (prompt für Name + Scope-Wahl)
//   - 🗑 Löschen: aktives Preset entfernen
//
// Cross-Module-Glue:
//   render() aus dem Hauptmodul wird beim Preset-Wechsel gebraucht, damit
//   die neuen Positionen/Pins sichtbar werden. Klassischer
//   Callback-Injection-Pattern wie auch in toolbar.js.

import {
    loadRelevantPresets, savePreset, deletePreset, applyPreset,
    collectCurrentState, loadActivePreset, saveActivePreset
} from './storage.js';
import { toast } from './toast.js';

// Cross-Module-Glue: render() wird aus dem Hauptmodul injiziert
let _renderFn = function() {};
export function setRenderCallback(fn) { _renderFn = fn; }

// Helper: matched zwei Preset-Identitäten exakt (Name + Scope + ScopeKey).
// Brauchen wir an mehreren Stellen — Dropdown-Highlight, Save, Delete.
function presetMatches(p, ident) {
    if (!ident || !p) return false;
    if (p.name !== ident.name) return false;
    // Scope-Vergleich: wenn ident.scope null ist (Legacy), nur per Name matchen.
    if (ident.scope === null || ident.scope === undefined) return true;
    if (p.scope !== ident.scope) return false;
    if (p.scope === 'global') return true;
    return p.scopeKey === ident.scopeKey;
}

export function setupPresetsUI(bar, isFirstRun, cy) {
    if (!bar) return;
    // Idempotent: wenn das Wrapper-Element schon da ist, nichts neu anlegen.
    // Schützt vor doppelten Toolbars bei Cache-Problemen oder unerwarteten
    // Re-Render-Pfaden (z.B. Tab-Wechsel).
    if (document.getElementById('nt-preset-wrap')) return;
    if (!isFirstRun) return;

    const wrap = document.createElement('div');
    wrap.id = 'nt-preset-wrap';
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:2px;margin-left:8px;'
        + 'padding-left:8px;border-left:1px solid #e2e8f0';

    // Aktives Preset als Tripel {name, scope, scopeKey} — eindeutig identifizierbar
    // auch wenn zwei Presets gleichen Namens (verschiedene Scopes) existieren.
    let _active = loadActivePreset();

    // Dropdown-Container
    const ddWrap = document.createElement('div');
    ddWrap.style.cssText = 'position:relative;display:inline-block';

    const ddBtn = document.createElement('button');
    ddBtn.className = 'btn-alt btn-small';
    ddBtn.style.margin = '0';
    ddBtn.id = 'nt-preset-dd-btn';

    const ddMenu = document.createElement('div');
    ddMenu.style.cssText = 'display:none;position:absolute;top:100%;left:0;z-index:9999;'
        + 'background:#fff;border:1px solid #e2e8f0;border-radius:6px;'
        + 'box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:200px;max-width:320px;'
        + 'overflow-y:auto;max-height:360px;margin-top:2px';

    function ddLabel() {
        const n = _active && _active.name;
        return n
            ? '\u{1F4C2} ' + (n.length > 16 ? n.substring(0, 14) + '\u2026' : n)
            : '\u{1F4C2} Presets';
    }
    ddBtn.textContent = ddLabel();

    function rebuildMenu() {
        while (ddMenu.firstChild) ddMenu.removeChild(ddMenu.firstChild);
        const presets = loadRelevantPresets();
        const groupset = presets.filter(function(p) { return p.scope === 'groupset'; });
        const global   = presets.filter(function(p) { return p.scope === 'global'; });

        function addRow(p) {
            const row = document.createElement('div');
            const isActive = presetMatches(p, _active);
            row.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;'
                + 'color:' + (isActive ? '#1d4ed8' : '#334155') + ';'
                + 'background:' + (isActive ? '#dbeafe' : 'transparent') + ';'
                + 'font-weight:' + (isActive ? '600' : '400') + ';'
                + 'display:flex;align-items:center;gap:6px;white-space:nowrap';
            const icon = p.scope === 'global' ? '\u{1F30D}' : '\u{1F4CC}';
            const txt = document.createElement('span');
            txt.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis';
            txt.textContent = icon + ' ' + p.name;
            txt.title = p.name + ' (' + (p.scope === 'global' ? 'Global' : 'Diese Auswahl') + ')';
            row.appendChild(txt);
            row.addEventListener('mouseover', function() {
                if (!isActive) this.style.background = '#f8fafc';
            });
            row.addEventListener('mouseout', function() {
                this.style.background = isActive ? '#dbeafe' : 'transparent';
            });
            row.addEventListener('click', function() {
                ddMenu.style.display = 'none';
                applyPreset(p);
                _active = { name: p.name, scope: p.scope, scopeKey: p.scopeKey };
                saveActivePreset(p.name, p.scope, p.scopeKey);
                ddBtn.textContent = ddLabel();
                updateButtons();
                // Re-Render damit die neuen Positionen/Pins sichtbar werden.
                // _renderFn = render() aus render-tech.js — braucht
                // (wrap, nodes, edges, url). Wir nutzen den Cache aus _ntLastData.
                const wrap = document.getElementById('nt-canvas-wrap');
                const ld   = window._ntLastData || {};
                _renderFn(wrap, (ld.nodes || []).slice(), (ld.edges || []).slice(), ld.url || '');
            });
            ddMenu.appendChild(row);
        }

        function addHeader(label) {
            const h = document.createElement('div');
            h.style.cssText = 'padding:6px 14px 2px;font-size:10px;color:#94a3b8;'
                + 'text-transform:uppercase;letter-spacing:0.5px';
            h.textContent = label;
            ddMenu.appendChild(h);
        }

        if (groupset.length === 0 && global.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'padding:12px 14px;font-size:12px;color:#94a3b8;font-style:italic';
            empty.textContent = 'Noch keine Presets gespeichert. Karte einrichten und "Save As..." klicken.';
            ddMenu.appendChild(empty);
            return;
        }
        if (groupset.length > 0) {
            addHeader('Diese Auswahl');
            groupset.forEach(addRow);
        }
        if (global.length > 0) {
            addHeader('Global');
            global.forEach(addRow);
        }
    }

    ddBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (ddMenu.style.display === 'none') {
            rebuildMenu();
            ddMenu.style.display = 'block';
        } else {
            ddMenu.style.display = 'none';
        }
    });
    document.addEventListener('click', function() { ddMenu.style.display = 'none'; });

    ddWrap.appendChild(ddBtn);
    ddWrap.appendChild(ddMenu);
    wrap.appendChild(ddWrap);

    // Save-Button: überschreibt das aktive Preset mit dem Live-State.
    // Disabled solange kein Preset aktiv ist (dann führt nur "Save As..." weiter).
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-alt btn-small';
    saveBtn.style.margin = '0';
    saveBtn.title = 'Aktives Preset mit aktuellem Stand \u00FCberschreiben';
    saveBtn.textContent = '\u{1F4BE}';

    const saveAsBtn = document.createElement('button');
    saveAsBtn.className = 'btn-alt btn-small';
    saveAsBtn.style.margin = '0';
    saveAsBtn.title = 'Als neues Preset speichern';
    saveAsBtn.textContent = '\u{1F4DD}';

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-alt btn-small';
    delBtn.style.margin = '0';
    delBtn.title = 'Aktives Preset l\u00F6schen';
    delBtn.textContent = '\u{1F5D1}';

    function updateButtons() {
        const has = !!(_active && _active.name);
        saveBtn.disabled = !has;
        delBtn.disabled  = !has;
        saveBtn.style.opacity = has ? '1' : '0.4';
        delBtn.style.opacity  = has ? '1' : '0.4';
        saveBtn.style.cursor  = has ? 'pointer' : 'not-allowed';
        delBtn.style.cursor   = has ? 'pointer' : 'not-allowed';
    }

    saveBtn.addEventListener('click', function() {
        if (!_active || !_active.name) return;
        // Existierendes Preset suchen — präziser Match dank Tripel-Identität
        const existing = loadRelevantPresets().find(function(p) {
            return presetMatches(p, _active);
        });
        if (!existing) {
            toast('Aktives Preset nicht gefunden — bitte "Save As..." statt "Save".', 'warn');
            _active = null;
            saveActivePreset('', null, null);
            ddBtn.textContent = ddLabel();
            updateButtons();
            return;
        }
        // savePreset gibt das gespeicherte Preset zurück — wir aktualisieren
        // _active mit dem (eventuell neu gesetzten) ScopeKey, falls Hostgroup-
        // Auswahl sich seit letztem Save geändert hat.
        const saved = savePreset(existing.name, existing.scope, collectCurrentState());
        _active = { name: saved.name, scope: saved.scope, scopeKey: saved.scopeKey };
        saveActivePreset(saved.name, saved.scope, saved.scopeKey);
        // Kurzes visuelles Feedback
        saveBtn.style.background = '#dcfce7';
        setTimeout(function() { saveBtn.style.background = ''; }, 600);
    });

    saveAsBtn.addEventListener('click', function() {
        const name = prompt('Name f\u00FCr das neue Preset:');
        if (!name || !name.trim()) return;
        const cleanName = name.trim().substring(0, 40);

        // Scope-Auswahl per confirm — einfacher als ein eigenes Modal-Dialog
        const isGlobal = confirm(
            'Preset-Scope w\u00E4hlen:\n\n'
            + 'OK = Global (gilt f\u00FCr alle Hostgroup-Auswahlen)\n'
            + 'Abbrechen = Diese Auswahl (gilt nur f\u00FCr aktuelle Hostgroups)'
        );
        const scope = isGlobal ? 'global' : 'groupset';

        // Existiert schon? → Confirm zum Überschreiben (gleicher Name + Scope)
        const existing = loadRelevantPresets().find(function(p) {
            return p.name === cleanName && p.scope === scope;
        });
        if (existing && !confirm('Preset "' + cleanName + '" existiert bereits. \u00DCberschreiben?')) {
            return;
        }

        // savePreset gibt das gespeicherte Preset zurück; daraus übernehmen
        // wir name/scope/scopeKey für _active (der scopeKey wird vom Storage
        // gesetzt, das Frontend kennt ihn nicht direkt).
        const saved = savePreset(cleanName, scope, collectCurrentState());
        _active = { name: saved.name, scope: saved.scope, scopeKey: saved.scopeKey };
        saveActivePreset(saved.name, saved.scope, saved.scopeKey);
        ddBtn.textContent = ddLabel();
        updateButtons();
    });

    delBtn.addEventListener('click', function() {
        if (!_active || !_active.name) return;
        if (!confirm('Preset "' + _active.name + '" wirklich l\u00F6schen?')) return;
        const existing = loadRelevantPresets().find(function(p) {
            return presetMatches(p, _active);
        });
        if (existing) {
            deletePreset(existing.name, existing.scope, existing.scopeKey);
        }
        _active = null;
        saveActivePreset('', null, null);
        ddBtn.textContent = ddLabel();
        updateButtons();
    });

    wrap.appendChild(saveBtn);
    wrap.appendChild(saveAsBtn);
    wrap.appendChild(delBtn);
    bar.appendChild(wrap);

    updateButtons();
}
