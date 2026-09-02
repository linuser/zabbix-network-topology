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
import { downloadLayout } from './layout-file.js';
import { toast } from './toast.js';
import { t } from './i18n.js';

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
        + 'background:var(--nt-surface);border:1px solid var(--nt-line);border-radius:6px;'
        + 'box-shadow:var(--nt-shadow);min-width:200px;max-width:320px;'
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
                + 'color:' + (isActive ? 'var(--nt-active-text)' : 'var(--nt-text-2)') + ';'
                + 'background:' + (isActive ? 'var(--nt-active-bg)' : 'transparent') + ';'
                + 'font-weight:' + (isActive ? '600' : '400') + ';'
                + 'display:flex;align-items:center;gap:6px;white-space:nowrap';
            const icon = p.scope === 'global' ? '\u{1F30D}' : '\u{1F4CC}';
            const txt = document.createElement('span');
            txt.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis';
            txt.textContent = icon + ' ' + p.name;
            txt.title = p.name + ' (' + (p.scope === 'global' ? t('presets.scope.global') : t('presets.scope.this')) + ')';
            row.appendChild(txt);
            row.addEventListener('mouseover', function() {
                if (!isActive) this.style.background = 'var(--nt-surface-2)';
            });
            row.addEventListener('mouseout', function() {
                this.style.background = isActive ? 'var(--nt-active-bg)' : 'transparent';
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
            empty.textContent = t('presets.empty');
            ddMenu.appendChild(empty);
            return;
        }
        if (groupset.length > 0) {
            addHeader(t('presets.scope.this'));
            groupset.forEach(addRow);
        }
        if (global.length > 0) {
            addHeader(t('presets.scope.global'));
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
    saveBtn.title = t('presets.save.tip');
    saveBtn.textContent = '\u{1F4BE}';

    const saveAsBtn = document.createElement('button');
    saveAsBtn.className = 'btn-alt btn-small';
    saveAsBtn.style.margin = '0';
    saveAsBtn.title = t('presets.saveas.tip');
    saveAsBtn.textContent = '\u{1F4DD}';

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-alt btn-small';
    delBtn.style.margin = '0';
    delBtn.title = t('presets.del.tip');
    delBtn.textContent = '\u{1F5D1}';

    // Datei-EXPORT. Bewusst NEBEN den Presets und nicht als weiterer
    // Preset-Eintrag: ein Preset lebt im localStorage dieses Browsers, eine
    // Datei geht auf ein anderes Geraet oder in ein anderes Zabbix.
    //
    // KEIN Import-Knopf — bewusst, nicht vergessen.
    //
    // Der Import war gebaut und ist wieder ausgebaut worden, weil ein
    // Code-Review drei Defekte fand, die alle dieselbe Wurzel haben: der
    // Apply-Pfad (applyPreset/setPositions/setLinks) wurde fuer VOLLSTAENDIGE
    // Zustaende aus der laufenden Karte geschrieben, eine importierte Datei ist
    // aber ein beliebiger TEILzustand.
    //
    //   1. Der Re-Render nach dem Import speichert den live gerenderten Stand
    //      zurueck (layoutstop -> savePositions). Im Cluster-Modus — dem
    //      Standard ab zwei Hostgruppen — kommen die importierten Positionen
    //      gar nicht erst an und werden ~1,4 s spaeter ueberschrieben.
    //   2. Ein Super-Admin schreibt in die GETEILTE Ebene, und setPositions()
    //      ersetzt sie komplett. Ein Import mit zwoelf Knoten loescht damit die
    //      Positionen aller uebrigen Hosts fuer alle Nutzer.
    //   3. loadLinks() liefert geteilte UND persoenliche Links gemischt, die
    //      Datei traegt die Ebene nicht mit, und setLinks() schreibt alles in
    //      defaultLinkScope(). Aus privaten Kanten werden geteilte oder
    //      umgekehrt.
    //
    // Nichts davon ist im Import selbst zu reparieren; es braucht eine
    // Entscheidung, was "importieren" bei einer geteilten Karte heissen soll —
    // ersetzen oder zusammenfuehren. Siehe ROADMAP.md.
    //
    // Der Export bleibt: er liest nur und kann nichts kaputt machen. Und er
    // loest bereits die Haelfte des Zwecks, naemlich sichern.
    const dlBtn = document.createElement('button');
    dlBtn.className = 'btn-alt btn-small';
    dlBtn.style.margin = '0';
    dlBtn.title = t('layoutfile.export.tip');
    dlBtn.textContent = '\u2B07';

    dlBtn.addEventListener('click', function() {
        try {
            const cfg = window.NT_CONFIG || {};
            downloadLayout(cfg.module_version || '');
            toast(t('layoutfile.exported'), 'info', 4000);
        } catch (e) {
            toast(t('layoutfile.err.export', { err: (e && e.message) || '?' }), 'error', 8000);
        }
    });

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
            toast(t('presets.notfound'), 'warn');
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
        const name = prompt(t('presets.name_prompt'));
        if (!name || !name.trim()) return;
        const cleanName = name.trim().substring(0, 40);

        // Scope-Auswahl per confirm — einfacher als ein eigenes Modal-Dialog
        const isGlobal = confirm(t('presets.scope_confirm'));
        const scope = isGlobal ? 'global' : 'groupset';

        // Existiert schon? → Confirm zum Überschreiben (gleicher Name + Scope)
        const existing = loadRelevantPresets().find(function(p) {
            return p.name === cleanName && p.scope === scope;
        });
        if (existing && !confirm(t('presets.overwrite_confirm', { name: cleanName }))) {
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
        if (!confirm(t('presets.delete_confirm', { name: _active.name }))) return;
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
    wrap.appendChild(dlBtn);
    bar.appendChild(wrap);

    updateButtons();
}
