// storage.js — localStorage-Verwaltung mit User-Trennung.
//
// Alle persistenten UI-Settings (Positionen, Pins, Notizen, manuelle Links,
// LLDP-Toggle, aktiver Tab, Group-View) bekommen ein User-Prefix "u<id>_"
// eingeschoben, damit mehrere Zabbix-User am selben Browser sich nicht in die
// Quere kommen. Bei fehlender user_id Fallback auf alte ungeprefixte Keys.

function userPrefix() {
    const cfg = window.NT_CONFIG;
    const uid = cfg && cfg.user_id ? String(cfg.user_id) : '';
    return (uid && uid !== '0') ? 'u' + uid + '_' : '';
}

// Legacy-Keys (vor Multi-User-Trennung) — nur für die einmalige Migration
const LEG = {
    POS:    'nt_pos_',
    PIN:    'nt_pinned_',
    NOTES:  'nt_notes_',
    LINKS:  'nt_manual_links',
    LLDP:   'nt_lldp_visible',
    TAB:    'nt_active_tab'
};

const PFX = userPrefix();
export const NT_POS_PREFIX     = 'nt_' + PFX + 'pos_';
export const NT_PINNED_PREFIX  = 'nt_' + PFX + 'pinned_';
export const NT_NOTES_PREFIX   = 'nt_' + PFX + 'notes_';
export const NT_LINKS_KEY      = 'nt_' + PFX + 'manual_links';
export const NT_LLDP_KEY       = 'nt_' + PFX + 'lldp_visible';
export const NT_WEATHERMAP_KEY = 'nt_' + PFX + 'weathermap';
export const NT_PORTLABELS_KEY = 'nt_' + PFX + 'portlabels';
export const NT_LEGEND_COLLAPSED_KEY = 'nt_' + PFX + 'legend_collapsed';
export const NT_PERF_KEY = 'nt_' + PFX + 'perf';
export const NT_TAB_KEY        = 'nt_' + PFX + 'active_tab';
export const NT_GROUP_VIEW_KEY = 'nt_' + PFX + 'group_view';
export const NT_SEV_FILTER_KEY = 'nt_' + PFX + 'sev_filter';
export const NT_LAYOUT_KEY     = 'nt_' + PFX + 'layout';
export const NT_GEO_PROVIDER_KEY = 'nt_' + PFX + 'geo_provider';
export const NT_TAPHOLD_KEY    = 'nt_' + PFX + 'taphold_ms';
export const NT_TABLE_MODE_KEY     = 'nt_' + PFX + 'table_mode';
export const NT_ITEMS_PATTERN_KEY  = 'nt_' + PFX + 'items_pattern';
export const NT_ITEMS_HIDE_EMPTY_KEY = 'nt_' + PFX + 'items_hide_empty';
export const NT_ITEMS_HEATMAP_KEY    = 'nt_' + PFX + 'items_heatmap';
export const NT_GROUP_CLUSTER_KEY  = 'nt_' + PFX + 'group_cluster';   // 'auto'|'columns'|'rows'|'off'

// ── Einmalige Migration der Legacy-Keys ──────────────────────────────────────
// Kopiert (nicht verschiebt) Legacy-Daten in die User-scoped Keys, damit andere
// User am selben Browser ihre Daten behalten. Sentinel verhindert Mehrfach-Lauf.
(function migrateLegacyKeys() {
    if (!PFX) return;
    const sentinel = 'nt_' + PFX + 'migrated';
    try {
        if (localStorage.getItem(sentinel)) return;
    } catch (e) { return; }

    try {
        const mappings = [
            [LEG.POS,   NT_POS_PREFIX],
            [LEG.PIN,   NT_PINNED_PREFIX],
            [LEG.NOTES, NT_NOTES_PREFIX]
        ];
        const toMigrate = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            for (let m = 0; m < mappings.length; m++) {
                const oldP = mappings[m][0], newP = mappings[m][1];
                if (key.indexOf(oldP) === 0 && key.indexOf(newP) !== 0) {
                    toMigrate.push([key, newP + key.substring(oldP.length)]);
                }
            }
        }
        toMigrate.forEach(function(pair) {
            if (localStorage.getItem(pair[1]) === null) {
                const v = localStorage.getItem(pair[0]);
                if (v !== null) localStorage.setItem(pair[1], v);
            }
        });
        [[LEG.LINKS, NT_LINKS_KEY],
         [LEG.LLDP,  NT_LLDP_KEY],
         [LEG.TAB,   NT_TAB_KEY]].forEach(function(pair) {
            const v = localStorage.getItem(pair[0]);
            if (v !== null && localStorage.getItem(pair[1]) === null) {
                localStorage.setItem(pair[1], v);
            }
        });
        localStorage.setItem(sentinel, String(Date.now()));
    } catch (e) {}
})();

// ── Key-Builder (gruppen-abhängig) ───────────────────────────────────────────
// Alle drei Schlüssel hängen am Set der ausgewählten Host-Gruppen — sodass eine
// andere Auswahl andere Positionen/Pins/Notizen liefert.

function selectedGroupIds() {
    const cfg = window.NT_CONFIG;
    const ids = (cfg && cfg.selected_groupids) ? cfg.selected_groupids.slice().sort() : [];
    return ids.join('_');
}

export function pinnedKey() { return NT_PINNED_PREFIX + selectedGroupIds(); }
export function notesKey()  { return NT_NOTES_PREFIX  + selectedGroupIds(); }

function _groupViewOn() {
    try { return localStorage.getItem(NT_GROUP_VIEW_KEY) === '1'; } catch (e) { return false; }
}

// Group-View hat eigene Positionen — Pseudo-Node-IDs (grp_Fox) würden sonst die
// Host-Positionen überschreiben. Ohne Argument gilt die AKTUELLE View; mit
// explizitem Bool die gewünschte — Presets speichern ihre View mit (posGrp) und
// schreiben beim Anwenden in den PASSENDEN Key statt in den der gerade aktiven
// View (sonst landen z.B. Host-Positionen im _grp-Key → Mismatch → verpuffen).
export function posKey(groupView) {
    const gv = (groupView === undefined) ? _groupViewOn() : !!groupView;
    return NT_POS_PREFIX + selectedGroupIds() + (gv ? '_grp' : '');
}

// ── Pinned helpers ───────────────────────────────────────────────────────────
export function loadPinned() {
    try { return JSON.parse(localStorage.getItem(pinnedKey()) || '[]'); }
    catch (e) { return []; }
}
export function savePinned(cyInst) {
    const ids = [];
    cyInst.nodes('[!isGroup]').forEach(function(n) { if (n.locked()) ids.push(n.id()); });
    try { localStorage.setItem(pinnedKey(), JSON.stringify(ids)); } catch (e) {}
}
// ── Notes helpers ────────────────────────────────────────────────────────────
export function loadNotes() {
    try { return JSON.parse(localStorage.getItem(notesKey()) || '{}'); }
    catch (e) { return {}; }
}
export function saveNote(hostId, text) {
    const notes = loadNotes();
    if (text && text.trim()) notes[hostId] = text.trim();
    else delete notes[hostId];
    try { localStorage.setItem(notesKey(), JSON.stringify(notes)); } catch (e) {}
    return notes;
}

// ── Position helpers ─────────────────────────────────────────────────────────
export function loadPositions() {
    try { return JSON.parse(localStorage.getItem(posKey()) || 'null') || {}; }
    catch (e) { return {}; }
}
export function savePositions(cyInst) {
    const pos = {};
    let nonZero = 0;
    cyInst.nodes('[!isGroup]').forEach(function(n) {
        // Virtuelle Knoten (Internet-Wolke) NICHT speichern — sie werden
        // pro Render frisch injiziert und ihre Position ist nicht user-
        // signifikant. Sonst würden sie für immer in localStorage liegen
        // selbst wenn der User auf ein Layout ohne Internet-Wolke wechselt.
        const id = String(n.id());
        if (id.indexOf('internet_') === 0) return;
        const p = n.position();
        pos[id] = { x: Math.round(p.x), y: Math.round(p.y) };
        if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) nonZero++;
    });
    // Degenerate snapshot (alle bei 0,0) nicht persistieren.
    if (nonZero === 0) return;
    try { localStorage.setItem(posKey(), JSON.stringify(pos)); } catch (e) {}
}
export function clearPositions() {
    try { localStorage.removeItem(posKey()); } catch (e) {}
}

// ── Manual Links helpers ─────────────────────────────────────────────────────
export function loadLinks() {
    try { return JSON.parse(localStorage.getItem(NT_LINKS_KEY) || '[]'); }
    catch (e) { return []; }
}
export function saveLinks(links) {
    try { localStorage.setItem(NT_LINKS_KEY, JSON.stringify(links)); } catch (e) {}
}

// ── Severity-Filter helpers ──────────────────────────────────────────────────
// Persistiert die aktiven Severity-Pillen als Array von Integers (0..5).
// Set wird beim Laden/Speichern in Array konvertiert (JSON-serialisierbar).
export function loadSevFilter() {
    try {
        const arr = JSON.parse(localStorage.getItem(NT_SEV_FILTER_KEY) || '[]');
        return new Set(Array.isArray(arr) ? arr.filter(function(n) { return typeof n === 'number'; }) : []);
    } catch (e) { return new Set(); }
}
export function saveSevFilter(sevSet) {
    try {
        localStorage.setItem(NT_SEV_FILTER_KEY, JSON.stringify(Array.from(sevSet)));
    } catch (e) {}
}

// ── Layout helpers ───────────────────────────────────────────────────────────
// Persistiert die Layout-Auswahl ('auto'|'cose'|'concentric'|'grid'|'breadthfirst').
export function loadLayout() {
    try { return localStorage.getItem(NT_LAYOUT_KEY) || 'auto'; }
    catch (e) { return 'auto'; }
}
export function saveLayout(layoutId) {
    try { localStorage.setItem(NT_LAYOUT_KEY, layoutId); } catch (e) {}
}

// ── Geomap provider helpers ──────────────────────────────────────────────────
// Persistiert die Tile-Provider-Auswahl (Provider-ID aus geo-providers.js).
export function loadGeoProvider() {
    try { return localStorage.getItem(NT_GEO_PROVIDER_KEY) || 'osm'; }
    catch (e) { return 'osm'; }
}
export function saveGeoProvider(providerId) {
    try { localStorage.setItem(NT_GEO_PROVIDER_KEY, providerId); } catch (e) {}
}

// ── Taphold-Duration für Mobile-Kontextmenü ────────────────────────────────
// Wert in Millisekunden — User-konfigurierbar in der Toolbar.
// Default 500ms ist ein guter Mittelweg zwischen "schnell genug" und "nicht
// versehentlich auslösbar beim Scrollen".
export function loadTapholdMs() {
    try {
        const v = parseInt(localStorage.getItem(NT_TAPHOLD_KEY), 10);
        return [300, 500, 800].indexOf(v) >= 0 ? v : 500;
    } catch (e) { return 500; }
}
export function saveTapholdMs(ms) {
    try { localStorage.setItem(NT_TAPHOLD_KEY, String(ms)); } catch (e) {}
}

// ── Layout-Presets ───────────────────────────────────────────────────────────
// Mehrere benannte Layouts pro User. Jedes Preset enthält den kompletten
// Visual-State (Positionen + Pins + Notes + Manual-Links). Scope kann
// "groupset" (gilt nur bei der gespeicherten Hostgroup-Auswahl) oder
// "global" (gilt überall, unbekannte Hosts fallen auf Auto-Layout zurück).
//
// Storage-Format: ein flaches Array unter NT_PRESETS_KEY. Filterung beim
// Anzeigen, nicht beim Speichern, damit ein Preset von "Fox-Home" auch
// sichtbar bleibt wenn der User später globale Auswahl ändert.
const NT_PRESETS_KEY        = 'nt_' + PFX + 'presets';
const NT_ACTIVE_PRESET_KEY  = 'nt_' + PFX + 'active_preset';

export function loadPresets() {
    try { return JSON.parse(localStorage.getItem(NT_PRESETS_KEY) || '[]'); }
    catch (e) { return []; }
}

function savePresets(arr) {
    try { localStorage.setItem(NT_PRESETS_KEY, JSON.stringify(arr)); } catch (e) {}
}

// Liefert nur die Presets die für die aktuelle Hostgroup-Auswahl relevant
// sind: alle globalen + die mit passender groupset-Scope-Key.
export function loadRelevantPresets() {
    const all = loadPresets();
    const currentScope = selectedGroupIds();
    return all.filter(function(p) {
        if (p.scope === 'global') return true;
        if (p.scope === 'groupset') return p.scopeKey === currentScope;
        return false;
    });
}

// Aktives Preset merken — als {name, scope, scopeKey}-Tripel, damit
// gleiche Namen mit verschiedenen Scopes eindeutig sind. Beim Reload
// wird damit exakt das richtige Preset rekonstruiert.
//
// Legacy: alte Versionen speicherten nur den String-Namen. Wir lesen
// das fallback-mäßig und konvertieren beim nächsten Save automatisch.
export function loadActivePreset() {
    try {
        const raw = localStorage.getItem(NT_ACTIVE_PRESET_KEY);
        if (!raw) return null;
        // Legacy-Format (nur Name als String, kein JSON)
        if (raw[0] !== '{') {
            return { name: raw, scope: null, scopeKey: null };
        }
        const parsed = JSON.parse(raw);
        return parsed && parsed.name ? parsed : null;
    } catch (e) { return null; }
}
export function saveActivePreset(name, scope, scopeKey) {
    try {
        if (name) {
            localStorage.setItem(NT_ACTIVE_PRESET_KEY, JSON.stringify({
                name: name, scope: scope || null, scopeKey: scopeKey || null
            }));
        } else {
            localStorage.removeItem(NT_ACTIVE_PRESET_KEY);
        }
    } catch (e) {}
}

// Speichert oder überschreibt ein Preset. data sollte enthalten:
// { positions: {...}, pinned: [...], notes: {...}, links: [...] }
export function savePreset(name, scope, data) {
    const all = loadPresets();
    const scopeKey = scope === 'groupset' ? selectedGroupIds() : null;
    const existing = all.findIndex(function(p) {
        return p.name === name && p.scope === scope
            && (scope === 'global' || p.scopeKey === scopeKey);
    });
    const preset = {
        name: name,
        scope: scope,
        scopeKey: scopeKey,
        createdAt: existing >= 0 ? all[existing].createdAt : Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        data: data
    };
    if (existing >= 0) all[existing] = preset;
    else               all.push(preset);
    savePresets(all);
    return preset;
}

export function deletePreset(name, scope, scopeKey) {
    const all = loadPresets();
    const filtered = all.filter(function(p) {
        return !(p.name === name && p.scope === scope
            && (scope === 'global' || p.scopeKey === scopeKey));
    });
    savePresets(filtered);
}

// Wendet ein Preset auf den Live-State an: schreibt Positionen, Pins,
// Notes, Manual-Links in die jeweiligen Live-Storage-Keys. Danach kann
// der nächste Render diese Werte wie gewohnt lesen.
//
// Bei globalen Presets werden Hosts ohne gespeicherte Position weggelassen;
// Cytoscape kümmert sich um sie via Auto-Layout-Fallback.
export function applyPreset(preset) {
    if (!preset || !preset.data) return;
    const d = preset.data;

    // Positionen in den Key der View schreiben, in der das Preset ERFASST wurde
    // (posGrp), nicht in den der gerade aktiven View. Alte Presets ohne posGrp
    // gelten als Host-View (der Normalfall) → posKey(false).
    if (d.positions) {
        try { localStorage.setItem(posKey(d.posGrp === true), JSON.stringify(d.positions)); } catch (e) {}
    }
    // Pinned
    if (d.pinned) {
        try { localStorage.setItem(pinnedKey(), JSON.stringify(d.pinned)); } catch (e) {}
    }
    // Notes
    if (d.notes) {
        try { localStorage.setItem(notesKey(), JSON.stringify(d.notes)); } catch (e) {}
    }
    // Manual-Links
    if (d.links) {
        try { localStorage.setItem(NT_LINKS_KEY, JSON.stringify(d.links)); } catch (e) {}
    }
    saveActivePreset(preset.name, preset.scope, preset.scopeKey);
}

// Sammelt den aktuellen Live-State zu einem Preset-Daten-Objekt.
// Wird beim "Save" und "Save As" aufgerufen.
export function collectCurrentState() {
    return {
        positions: loadPositions(),
        posGrp:    _groupViewOn(),   // in welcher View wurden die Positionen erfasst
        pinned:    loadPinned(),
        notes:     loadNotes(),
        links:     loadLinks()
    };
}

// ── Filter-Presets fuer die Tabelle ──────────────────────────────────────
// User-eigene benannte Filter-Kombinationen (Severities + Gruppen + Such-
// Query + Offline-Toggle + Sortierung). Built-in-Presets ("Nur Firewalls"
// etc.) liegen direkt in render-table.js — hier nur User-eigene.
const NT_FILTER_PRESETS_KEY = 'nt_' + PFX + 'filter_presets';

export function loadFilterPresets() {
    try {
        const v = JSON.parse(localStorage.getItem(NT_FILTER_PRESETS_KEY) || '[]');
        return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
}
export function saveFilterPresets(arr) {
    try { localStorage.setItem(NT_FILTER_PRESETS_KEY, JSON.stringify(arr || [])); }
    catch (e) {}
}

// ── Letzte Hostgroup-Auswahl ─────────────────────────────────────────────
// Wird bei jedem erfolgreichen Render gespeichert. Beim Page-Load ohne
// URL-Parameter wird die gespeicherte Auswahl wiederhergestellt — User
// muss seine Lieblings-Hostgroups nicht jedes Mal neu eintippen.
const NT_LAST_GROUPS_KEY = 'nt_' + PFX + 'last_groupids';

export function loadLastGroups() {
    try { return JSON.parse(localStorage.getItem(NT_LAST_GROUPS_KEY) || '[]'); }
    catch (e) { return []; }
}
export function saveLastGroups(groupids) {
    try { localStorage.setItem(NT_LAST_GROUPS_KEY, JSON.stringify(groupids || [])); }
    catch (e) {}
}
