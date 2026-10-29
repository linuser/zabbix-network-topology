// storage.js — localStorage-Verwaltung mit User-Trennung.
//
// Alle persistenten UI-Settings (Positionen, Pins, Notizen, manuelle Links,
// LLDP-Toggle, aktiver Tab, Group-View) bekommen ein User-Prefix "u<id>_"
// eingeschoben, damit mehrere Zabbix-User am selben Browser sich nicht in die
// Quere kommen. Bei fehlender user_id Fallback auf alte ungeprefixte Keys.

import { fetchJson } from './http.js';

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
const NT_POS_PREFIX     = 'nt_' + PFX + 'pos_';
const NT_PINNED_PREFIX  = 'nt_' + PFX + 'pinned_';
const NT_NOTES_PREFIX   = 'nt_' + PFX + 'notes_';
const NT_LINKS_KEY      = 'nt_' + PFX + 'manual_links';
export const NT_LLDP_KEY       = 'nt_' + PFX + 'lldp_visible';
export const NT_WEATHERMAP_KEY = 'nt_' + PFX + 'weathermap';
export const NT_LINKQUALITY_KEY = 'nt_' + PFX + 'linkquality';
export const NT_PORTLABELS_KEY = 'nt_' + PFX + 'portlabels';
// Parallel links (LAG, several cables): '1' all links (fan when zoomed in),
// '0' always one line with ×N. See parallel-links.js.
export const NT_PARLINKS_KEY   = 'nt_' + PFX + 'parlinks';
// §9: Ghost-Knoten (unmatched LLDP-Nachbarn) ein-/ausblenden. Default AUS —
// in Netzen mit vielen unbekannten Geraeten wuerde die Karte sonst zuwuchern.
export const NT_GHOSTS_KEY     = 'nt_' + PFX + 'ghosts';

// Geister-Modus: 'off' | 'infra' | 'all'.
//
// Bis 5.3.2 stand dort '1' oder '0', und beides muss weiter funktionieren —
// der Wert liegt im Browser jedes Benutzers und wird von keiner Migration
// erreicht. '1' war "alle zeigen", also bleibt es das.
export function loadGhostMode() {
    let v = null;
    try { v = localStorage.getItem(NT_GHOSTS_KEY); } catch (e) {}
    if (v === 'all' || v === 'infra' || v === 'off') return v;
    return v === '1' ? 'all' : 'off';
}

export function saveGhostMode(modus) {
    try { localStorage.setItem(NT_GHOSTS_KEY, modus); } catch (e) {}
}

// Ring-/Loop-Erkennung: an/aus. Default aus — ein Ring ist meist gewollte
// Redundanz, die Anzeige soll man bewusst einschalten.
export const NT_RINGS_KEY = 'nt_' + PFX + 'rings';
export function loadRings() {
    try { return localStorage.getItem(NT_RINGS_KEY) === '1'; } catch (e) { return false; }
}
export function saveRings(on) {
    try { localStorage.setItem(NT_RINGS_KEY, on ? '1' : '0'); } catch (e) {}
}

// Soll/Ist-Overlay (nt:expect): erwartete Verkabelung gegen gemessene halten.
// Default aus — das Feature greift nur, wenn jemand nt:expect-Tags gesetzt hat.
export const NT_EXPECTED_KEY = 'nt_' + PFX + 'expected';
export function loadExpected() {
    try { return localStorage.getItem(NT_EXPECTED_KEY) === '1'; } catch (e) { return false; }
}
export function saveExpected(on) {
    try { localStorage.setItem(NT_EXPECTED_KEY, on ? '1' : '0'); } catch (e) {}
}

// VLAN-Filter: die gewaehlte VLAN-ID als String, '' = alle (kein Filter).
// Anders als die Toggles ein Wert statt an/aus — der VLAN-Waehler ist ein
// Dropdown. Ungueltige/leere Wahl loescht den Eintrag.
export const NT_VLAN_KEY = 'nt_' + PFX + 'vlan';
export function loadVlanFilter() {
    try { return localStorage.getItem(NT_VLAN_KEY) || ''; } catch (e) { return ''; }
}
export function saveVlanFilter(id) {
    try {
        if (id === '' || id == null) { localStorage.removeItem(NT_VLAN_KEY); }
        else { localStorage.setItem(NT_VLAN_KEY, String(id)); }
    } catch (e) {}
}

export const NT_LEGEND_COLLAPSED_KEY = 'nt_' + PFX + 'legend_collapsed';
export const NT_PERF_KEY = 'nt_' + PFX + 'perf';

// Punktgroesse der Hosts. Drei Stufen; der Faktor skaliert Knoten UND
// Beschriftung gemeinsam (render-tech-style). Default 'normal' = Faktor 1,0,
// also optisch unveraendert fuer alle, die nichts umstellen. Gemerkt pro
// Browser wie die uebrigen Ansichts-Schalter — es ist eine Lesevorliebe, kein
// Bestand, der geteilt gehoert.
export const NT_NODESIZE_KEY = 'nt_' + PFX + 'nodesize';
const NODESIZE_STEPS  = ['klein', 'normal', 'gross'];
const NODESIZE_FACTOR = { klein: 0.7, normal: 1.0, gross: 1.35 };
export function loadNodeSize() {
    try {
        const v = localStorage.getItem(NT_NODESIZE_KEY);
        if (v && NODESIZE_FACTOR[v] != null) return v;
    } catch (e) {}
    return 'normal';
}
export function saveNodeSize(step) {
    if (NODESIZE_FACTOR[step] == null) return;
    try { localStorage.setItem(NT_NODESIZE_KEY, step); } catch (e) {}
}
export function nodeSizeFactor(step) {
    return NODESIZE_FACTOR[step || loadNodeSize()] || 1;
}
// Naechste Stufe im Ring (klein -> normal -> gross -> klein) fuer den Toggle.
export function nextNodeSize(step) {
    const i = NODESIZE_STEPS.indexOf(step || loadNodeSize());
    return NODESIZE_STEPS[(i + 1) % NODESIZE_STEPS.length];
}

export const NT_TAB_KEY        = 'nt_' + PFX + 'active_tab';
export const NT_GROUP_VIEW_KEY = 'nt_' + PFX + 'group_view';
export const NT_GROUP_OPEN_KEY = 'nt_' + PFX + 'group_open';

// ── Welche Gruppenebenen aufgeklappt sind ─────────────────────────────────
//
// Pro Browser, nicht pro Server: wie tief jemand gerade hineingesehen hat,
// ist eine Blickrichtung und keine Eigenschaft der Karte. Zwei Leute duerfen
// gleichzeitig verschiedene Standorte offen haben.
//
// Als Objekt { "Berlin": true, "Berlin/Campus": true } und nicht als Liste,
// weil die Abfrage in der heissen Schleife steckt (einmal je Host) und ein
// indexOf dort unnoetig waere.

export function loadGroupOpen() {
    try {
        const roh = JSON.parse(localStorage.getItem(NT_GROUP_OPEN_KEY) || '{}');
        return (roh && typeof roh === 'object' && !Array.isArray(roh)) ? roh : {};
    } catch (e) { return {}; }
}

export function saveGroupOpen(offen) {
    try { localStorage.setItem(NT_GROUP_OPEN_KEY, JSON.stringify(offen || {})); } catch (e) {}
}

/** Eine Ebene auf- oder zuklappen. Liefert den neuen Stand. */
export function toggleGroupOpen(pfad) {
    const offen = loadGroupOpen();
    if (offen[pfad]) {
        // Zuklappen heisst AUCH: alles darunter zuklappen. Sonst bleibt eine
        // Ebene offen, die niemand mehr sieht, und beim naechsten Oeffnen
        // springt die Karte zwei Stufen weit auf.
        Object.keys(offen).forEach(function(k) {
            if (k === pfad || k.indexOf(pfad + '/') === 0) delete offen[k];
        });
    } else {
        offen[pfad] = true;
    }
    saveGroupOpen(offen);
    return offen;
}

// ── Endgeraete-Buendel: An/Aus und welche Switches aufgeklappt sind ────────
//
// Pro Browser, wie der Gruppen-Aufklappzustand — es ist eine Blickrichtung,
// keine Eigenschaft der Karte. Zwei getrennte Schluessel: ob ueberhaupt
// gebuendelt wird (ein Schalter), und welche einzelnen Switches gerade offen
// stehen (eine Menge von Switch-IDs).
export const NT_BUNDLE_KEY      = 'nt_' + PFX + 'bundle';
export const NT_BUNDLE_OPEN_KEY = 'nt_' + PFX + 'bundle_open';

// Voreingestellt AN: wer die Geister auf 'alle' stellt, will die Uebersicht
// nicht gleich wieder von achtundvierzig Arbeitsplatzrechnern zugestellt
// bekommen. Ausschalten zeigt sie wieder einzeln.
export function loadBundleMode() {
    try {
        const v = localStorage.getItem(NT_BUNDLE_KEY);
        return v === null ? true : v === '1';
    } catch (e) { return true; }
}
export function saveBundleMode(an) {
    try { localStorage.setItem(NT_BUNDLE_KEY, an ? '1' : '0'); } catch (e) {}
}

export function loadBundleOpen() {
    try {
        const roh = JSON.parse(localStorage.getItem(NT_BUNDLE_OPEN_KEY) || '{}');
        return (roh && typeof roh === 'object' && !Array.isArray(roh)) ? roh : {};
    } catch (e) { return {}; }
}
export function saveBundleOpen(offen) {
    try { localStorage.setItem(NT_BUNDLE_OPEN_KEY, JSON.stringify(offen || {})); } catch (e) {}
}
/** Ein Buendel auf- oder zuklappen (am Switch). Liefert den neuen Stand. */
export function toggleBundleOpen(switchId) {
    const offen = loadBundleOpen();
    if (offen[switchId]) { delete offen[switchId]; } else { offen[switchId] = true; }
    saveBundleOpen(offen);
    return offen;
}

// Der TATSAECHLICHE Zustand der Gruppenansicht, nicht die gespeicherte Wahl.
//
// Beides faellt seit der Schwelle auseinander: ist nichts gespeichert und die
// Karte hat sehr viele Knoten, gruppiert render-tech von selbst. Der Schluessel
// bleibt dabei absichtlich LEER — eine automatische Entscheidung soll keine
// Vorliebe werden, sonst bliebe die Karte gruppiert, lange nachdem sie wieder
// klein geworden ist.
//
// Ohne diesen Wert las die Toolbar den leeren Schluessel als "aus", zeigte den
// Haken nicht, waehrend die Karte gruppiert war — und ihr Umschalter haette
// beim Klick "an" gesetzt, also sichtbar nichts getan. render-tech schreibt
// hier bei jedem Render den Zustand hinein, den es wirklich benutzt hat.
let _groupViewEffective = false;

export function setGroupViewEffective(on) { _groupViewEffective = !!on; }
export function isGroupViewEffective()    { return _groupViewEffective; }
const NT_SEV_FILTER_KEY = 'nt_' + PFX + 'sev_filter';
const NT_LAYOUT_KEY     = 'nt_' + PFX + 'layout';
const NT_GEO_PROVIDER_KEY = 'nt_' + PFX + 'geo_provider';
const NT_TAPHOLD_KEY    = 'nt_' + PFX + 'taphold_ms';
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
    // Host+hops mode gets its own view-key space: positions/pins/notes saved
    // for "core-sw + 2 hops" must not collide with a group selection — both
    // layers store the COMPLETE state per view key, so a shared key would let
    // one view's save wipe the other's arrangement.
    if (cfg && cfg.selected_hostid) {
        return 'host' + cfg.selected_hostid + '_h' + (cfg.hops || 1);
    }
    const ids = (cfg && cfg.selected_groupids) ? cfg.selected_groupids.slice().sort() : [];
    return ids.join('_');
}

function pinnedKey() { return NT_PINNED_PREFIX + selectedGroupIds(); }
function notesKey()  { return NT_NOTES_PREFIX  + selectedGroupIds(); }

function _groupViewOn() {
    try { return localStorage.getItem(NT_GROUP_VIEW_KEY) === '1'; } catch (e) { return false; }
}

// Group-View hat eigene Positionen — Pseudo-Node-IDs (grp_Fox) würden sonst die
// Host-Positionen überschreiben. Ohne Argument gilt die AKTUELLE View; mit
// explizitem Bool die gewünschte — Presets speichern ihre View mit (posGrp) und
// schreiben beim Anwenden in den PASSENDEN Key statt in den der gerade aktiven
// View (sonst landen z.B. Host-Positionen im _grp-Key → Mismatch → verpuffen).
function posKey(groupView) {
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

// Ebenen-Namen. Stehen hier oben, weil BEIDE serverseitigen Bereiche sie
// nutzen — Positionen und manuelle Links — und die Migrations-IIFE der
// Positionen schon beim Laden des Moduls laeuft. Weiter unten deklariert
// waeren sie zu dem Zeitpunkt noch in der temporalen Todeszone.
const SCOPE_SHARED   = 'shared';
const SCOPE_PERSONAL = 'personal';

// ── Knotenpositionen ─────────────────────────────────────────────────────────
//
// Serverseitig seit 5.1. Vorher lagen sie im localStorage: an einen Browser
// gebunden, weg beim Cache-Leeren — und jeder ordnete sich seine eigene Karte.
//
// Zwei Ebenen (Details in topology/NodePositions.php):
//   shared    module.config — DIE Karte, die alle sehen. Schreiben nur
//             Super-Admins; das prueft Zabbix, nicht wir.
//   personal  CProfile      — die eigene Abweichung davon.
//
// Beim Lesen gewinnt personal PRO KNOTEN. Wer drei Geraete verschiebt, behaelt
// drei eigene Positionen, alles andere folgt weiter der geteilten Karte. Ohne
// diese Feinheit waere die geteilte Ebene wertlos: eine einzige persoenliche
// Speicherung wuerde sie komplett verdecken.
//
// Struktur beider Ebenen: { "<viewKey>": { "<nodeId>": {x, y} } } — der
// viewKey ist die sortierte Gruppenauswahl, mit "_grp" fuer die Group-View.

let _posShared   = {};
let _posPersonal = {};

(function hydratePositions() {
    const p = _cfg().positions || {};
    _posShared   = (p.shared   && typeof p.shared   === 'object') ? p.shared   : {};
    _posPersonal = (p.personal && typeof p.personal === 'object') ? p.personal : {};
})();

/** Nur der View-Anteil des Schluessels — serverseitig gibt es kein User-Praefix. */
function posViewKey(groupView) {
    const gv = (groupView === undefined) ? _groupViewOn() : !!groupView;
    return selectedGroupIds() + (gv ? '_grp' : '');
}

export function defaultPositionScope() {
    return _cfg().is_super_admin ? SCOPE_SHARED : SCOPE_PERSONAL;
}

export function loadPositions() {
    const view   = posViewKey();
    const shared = _posShared[view]   || {};
    const own    = _posPersonal[view] || {};
    const out    = {};

    for (const id in shared) {
        if (Object.prototype.hasOwnProperty.call(shared, id)) out[id] = shared[id];
    }
    for (const id in own) {
        if (Object.prototype.hasOwnProperty.call(own, id)) out[id] = own[id];
    }
    return out;
}

// Pro Ebene EINE Serverfahrt gleichzeitig.
//
// Ohne das schicken zwei Speichervorgaenge, die dicht aufeinander folgen,
// DIESELBE base-Revision: die erste aendert sie serverseitig, die zweite kommt
// mit der veralteten an und wird abgelehnt. Ein Konflikt ohne zweiten
// Beteiligten — und seit die Karte auf den Serverstand zurueckrueckt, springt
// sie dabei auch noch. Zwei Klicks auf "Fit" genuegten; jede andere Kombination
// aus Layout-Knopf, Drag und Auto-Speichern innerhalb der Antwortzeit ebenso.
//
// Die naechste Fahrt startet erst, wenn die vorige durch ist, und liest base
// UND Nutzlast dann frisch — deshalb wird der Body hier drinnen gebaut und
// nicht davor. Ein Fehler der vorigen Fahrt haelt die naechste nicht auf.
const _queues = {};

function _serial(key, run) {
    const vorher = _queues[key] || Promise.resolve();
    const jetzt  = vorher.catch(function() {}).then(run);
    _queues[key] = jetzt.catch(function() {});
    return jetzt;
}

// Ein Konflikt ist kein gewoehnlicher Fehler. Er hat eine eigene Meldung und
// einen eigenen Weg zurueck, deshalb traegt er eine Markierung: die generischen
// Fehlerkanaele (_onPosError, der Toast in manual-links.js) ueberspringen ihn.
// Vorher standen bei jedem Konflikt ZWEI Meldungen uebereinander, die dasselbe
// sagten — die Konfliktmeldung und "konnte nicht gespeichert werden".
function _conflictError(d) {
    const e = new Error((d && d.error) || 'conflict');
    e.conflict = true;
    return e;
}

// Konflikte melden sich ueber _onConflict; der generische Toast entfaellt.
function _reportPosError(e) {
    if (e && e.conflict) return;
    if (_onPosError) _onPosError(e);
}

// Den Stand uebernehmen, den der Server im Konflikt MITSCHICKT
// (NetworkTopologyPositions.php:129). Ihn zu verwerfen war der eigentliche
// Fehler, und er wog schwerer als die stehengebliebene Karte:
//
//   Der abgelehnte Schreibvorgang blieb im Speicher stehen, waehrend _rev auf
//   die NEUE Server-Revision gesetzt wurde. Damit passte die Basis beim
//   naechsten Speichern wieder — und der veraltete lokale Stand ging als
//   gueltig durch, ueber die fremde Aenderung hinweg. Die Konflikterkennung
//   hat das Ueberschreiben also nicht verhindert, nur um einen
//   Speichervorgang verschoben.
//
// Array-Pruefung, weil PHP eine leere Map als [] kodiert, nicht als {}.
function _adoptPositions(scope, views) {
    const clean = (views && typeof views === 'object' && !Array.isArray(views))
        ? views : {};
    if (scope === SCOPE_SHARED) _posShared = clean;
    else                        _posPersonal = clean;
}

// Duenner Mantel: die Reihenfolge hier, die Fahrt darunter. Der Body wird erst
// IN _postPositions gebaut, also mit der Revision und der Nutzlast, die zum
// Zeitpunkt des Absendens gelten — genau darum geht es beim Serialisieren.
function _persistPositions(scope, views) {
    return _serial(_revKey('positions', scope), function() {
        return _postPositions(scope, views);
    });
}

function _postPositions(scope, views) {
    const cfg  = _cfg();
    const url  = cfg.positions_url || 'zabbix.php?action=network.topology.positions';
    const body = new URLSearchParams();
    body.set('positions', JSON.stringify(views));
    body.set('scope', scope);
    body.set('nt_csrf', cfg.positions_csrf || '');
    body.set('base', _rev[_revKey('positions', scope)] || '');

    return fetchJson(url, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest',
                   'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'same-origin',
        body: body.toString()
    })
    .then(function(d) {
        // Siehe _persist: zwischenzeitlich hat jemand anderes geschrieben.
        if (d && d.conflict) {
            _adoptPositions(scope, d.positions);
            _rev[_revKey('positions', scope)] = d.revision || '';
            if (typeof _onConflict === 'function') _onConflict('positions', d);
            throw _conflictError(d);
        }
        if (!d || d.error) throw new Error((d && d.error) || 'unknown');
        if (typeof d.revision === 'string') {
            _rev[_revKey('positions', scope)] = d.revision;
        }
        // Der Server hat die Obergrenze angewendet und einen Teil verworfen.
        // Kein Fehler — gespeichert wurde etwas — aber es darf nicht
        // stillschweigend passieren: beim naechsten Laden fehlten sonst
        // Positionen, und das sieht nach Datenverlust aus statt nach Grenze.
        if (d.truncated > 0 && typeof _onPosTruncated === 'function') {
            _onPosTruncated(d.truncated);
        }
        return d;
    });
}

/**
 * Macht aus einer beliebigen {id: {x,y}}-Sammlung das, was gespeichert werden
 * darf — oder null, wenn nichts uebrig bleibt, das jemand gemeint haben kann.
 *
 * Das stand frueher NUR in savePositions(), und setPositions() hat die
 * Ebenen-Logik daneben ein zweites Mal gefuehrt, ohne diesen Teil. Die
 * Abweichung war still: Presets tragen ihre Positionen aus loadPositions(),
 * also aus schon geputzten Serverdaten, und fielen deshalb nicht auf. Presets
 * aus der Zeit VOR der Server-Umstellung kommen dagegen aus dem localStorage
 * und koennen beides mitbringen — Internet-Knoten und Nachkommastellen.
 */
function _cleanPositions(pos) {
    const out = {};
    let nonZero = 0;

    for (const key in pos) {
        if (!Object.prototype.hasOwnProperty.call(pos, key)) continue;

        // Virtuelle Knoten (Internet-Wolke) NICHT speichern — sie werden pro
        // Render frisch injiziert und ihre Position ist nicht user-signifikant.
        const id = String(key);
        if (id.indexOf('internet_') === 0) continue;

        const p = pos[key];
        if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;

        out[id] = { x: Math.round(p.x), y: Math.round(p.y) };
        if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) nonZero++;
    }

    // Leer oder alles auf 0,0: der Moment vor dem ersten Layout-Durchlauf,
    // keine Anordnung. Wuerde ueber diesen Weg die gespeicherte Karte loeschen.
    return nonZero === 0 ? null : out;
}

/**
 * Die Ebenen-Logik, EINMAL. Beide Wege — aus der Karte gelesen und fertig
 * uebergeben — muenden hier; vorher fuehrten sie sie getrennt und drifteten
 * auseinander.
 */
function _writePositions(pos, view) {
    if (defaultPositionScope() === SCOPE_SHARED) {
        // Der Super-Admin pflegt die Karte: seine Anordnung IST sie, komplett.
        _posShared[view] = pos;
        _persistPositions(SCOPE_SHARED, _posShared)
            .catch(_reportPosError);

        // Eine eigene Abweichung fuer diese Ansicht loesen wir dabei auf.
        // Sonst gewinnt sie pro Knoten weiter — und der Admin saehe seine
        // gerade gespeicherte Karte selbst nicht. Genau das passierte, wenn
        // eine alte localStorage-Anordnung vorher in die persoenliche Ebene
        // gewandert war.
        if (_posPersonal[view]) {
            delete _posPersonal[view];
            _persistPositions(SCOPE_PERSONAL, _posPersonal)
                .catch(_reportPosError);
        }
        return;
    }

    // Alle anderen speichern nur die ABWEICHUNG von der geteilten Karte. Wuerde
    // hier die volle Anordnung landen, verdeckte sie die geteilte Ebene fuer
    // immer — auch an Knoten, die der Nutzer nie angefasst hat, und selbst wenn
    // ein Admin die Karte spaeter neu ordnet.
    const shared = _posShared[view] || {};
    const delta  = {};
    for (const id in pos) {
        if (!Object.prototype.hasOwnProperty.call(pos, id)) continue;
        const s = shared[id];
        if (!s || s.x !== pos[id].x || s.y !== pos[id].y) delta[id] = pos[id];
    }

    if (Object.keys(delta).length) _posPersonal[view] = delta;
    else delete _posPersonal[view];

    _persistPositions(SCOPE_PERSONAL, _posPersonal)
        .catch(_reportPosError);
}

export function savePositions(cyInst) {
    const pos = {};
    cyInst.nodes('[!isGroup]').forEach(function(n) {
        pos[String(n.id())] = n.position();
    });

    const clean = _cleanPositions(pos);
    if (clean) _writePositions(clean, posViewKey());
}

/**
 * Wie savePositions(), aber aus einem fertigen {id: {x,y}}-Objekt statt aus der
 * Cytoscape-Instanz. Fuer Preset-Anwendung und Datei-Import.
 *
 * WARUM ES DAS BRAUCHT
 * --------------------
 * applyPreset() schrieb Positionen frueher nach localStorage (posKey()). Seit
 * Positionen auf dem Server liegen, wird dieser Schluessel nur noch an EINER
 * Stelle gelesen: in der einmaligen Migration, und die kehrt sofort zurueck,
 * wenn der Server fuer die Ansicht schon etwas hat. Ein Preset anzuwenden hat
 * die Positionen deshalb still verschluckt — Pins und Notizen kamen an, die
 * Anordnung nicht. Aufgefallen beim Bauen des Datei-Imports, der denselben
 * Weg nahm.
 *
 * Die Ebenen-Logik ist NICHT nur "dieselbe wie in savePositions()", sie ist
 * inzwischen dasselbe Stueck Code (_writePositions). Solange es zwei waren, ist
 * genau das passiert, was bei Duplikaten passiert: savePositions() bekam den
 * View-Parameter und das Putzen, setPositions() nicht.
 */
export function setPositions(pos, groupView) {
    if (!pos || typeof pos !== 'object') return;

    const clean = _cleanPositions(pos);
    if (!clean) return;

    // groupView durchreichen: der Aufrufer weiss, in WELCHER Ansicht die
    // Positionen erfasst wurden (Presets tragen das als posGrp mit). Ohne
    // diesen Parameter nahm setPositions() immer die gerade aktive Ansicht —
    // ein in der Gruppenansicht erfasstes Preset schrieb seine grp_*-IDs dann
    // in den Host-Schluessel, wo sie zu keinem Knoten passen. Genau die Regel,
    // die der Kommentar oben bei posKey() beschreibt.
    _writePositions(clean, posViewKey(groupView));
}

/** Setzt die eigene Ebene fuer die aktuelle Ansicht zurueck. */
export function clearPositions() {
    const view  = posViewKey();
    const scope = defaultPositionScope();
    const store = scope === SCOPE_SHARED ? _posShared : _posPersonal;

    delete store[view];
    _persistPositions(scope, store)
        .catch(_reportPosError);
}

// ── Plan-Positionen (Bild-Underlay) ──────────────────────────────────────────
//
// Der Plan-Modus (render-plan.js) platziert Marker in BILD-Pixeln auf einem
// Hintergrundbild — ein anderes Koordinatensystem als die Technik-Ansicht. Damit
// beide nicht kollidieren, haengen Plan-Positionen an einem eigenen viewKey mit
// Suffix "_plan" (analog zu "_grp"). Darunter nutzen sie exakt dieselbe
// Zwei-Ebenen-Persistenz wie die Technik-Positionen: shared fuer Super-Admins,
// sonst persoenliche Abweichung, Konflikt/Revision inklusive — kein neuer
// Endpunkt. Die Gruppen-View-Umschaltung spielt hier keine Rolle (ein Plan ist
// ein Plan), deshalb KEIN "_grp" im Schluessel.
function planViewKey() {
    return selectedGroupIds() + '_plan';
}

/** Gespeicherte Plan-Positionen der aktuellen Gruppenauswahl (shared + eigene). */
export function loadPlanPositions() {
    const view   = planViewKey();
    const shared = _posShared[view]   || {};
    const own    = _posPersonal[view] || {};
    const out    = {};
    for (const id in shared) {
        if (Object.prototype.hasOwnProperty.call(shared, id)) out[id] = shared[id];
    }
    for (const id in own) {
        if (Object.prototype.hasOwnProperty.call(own, id)) out[id] = own[id];
    }
    return out;
}

/**
 * Die VOLLE Plan-Positionskarte schreiben ({id:{x,y}} in Bild-Pixeln). Der
 * Aufrufer (render-plan.js) haelt die Karte, aktualisiert den gezogenen Knoten
 * und uebergibt das Ganze — wie savePositions() aus der Cytoscape-Instanz. Die
 * Ebenen-Logik (_writePositions) ist identisch; nur der viewKey traegt "_plan".
 */
export function savePlanPositions(pos) {
    if (!pos || typeof pos !== 'object') return;
    const clean = _cleanPositions(pos);
    if (!clean) return;
    _writePositions(clean, planViewKey());
}

// ── Plan-Hintergrundbild (nur die Referenz — die Bytes liegen in Zabbix) ──────
//
// Das Bild selbst liegt in Zabbix' eigenem Bild-Store (Administration → General →
// Images, Typ Background), wie die Karten-Hintergruende. Das Modul merkt sich je
// Ansicht nur eine Referenz: eine `imageid` ODER eine URL. Diese duennen Wrapper
// sprechen den Plan-Endpunkt (network.topology.plan) an; die Logik liegt in
// render-plan.js. GET-Operationen (list/ref/image) sind Lesezugriffe ohne CSRF,
// set/clear/upload aendern Zustand und tragen das CSRF-Token.
function _planUrl() { return _cfg().plan_url || 'zabbix.php?action=network.topology.plan'; }

/** Darf der aktuelle Nutzer neue Bilder hochladen? (Super-Admin — Zabbix-Grenze.) */
export function planCanUpload() { return !!_cfg().plan_can_upload; }

function _planGet(op, extra) {
    let url = _planUrl() + '&op=' + encodeURIComponent(op);
    if (extra) {
        for (const k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) {
                url += '&' + k + '=' + encodeURIComponent(extra[k]);
            }
        }
    }
    return fetchJson(url, {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function(d) {
        // Eine Fehlerantwort (Drosselung, ungueltige Eingabe) ist KEINE gueltige
        // Nutzlast — sonst laese render-plan {error:...} als "kein Bild" und
        // zeigte faelschlich den Leerzustand. Wie _planPost behandeln.
        if (d && d.error) {
            throw new Error(d.error);
        }
        return d;
    });
}

/** Background-Bilder in Zabbix (image.get imagetype=2): [{imageid, name}]. */
export function planListImages() {
    return _planGet('list').then(function(d) { return (d && d.images) || []; });
}

/** Hintergrund-Referenz der aktuellen Ansicht: {kind:'image'|'url'|'none', ...}. */
export function planGetRef() {
    return _planGet('ref', { view: planViewKey() }).then(function(d) { return d || { kind: 'none' }; });
}


function _planPost(fields) {
    const cfg  = _cfg();
    const body = new URLSearchParams();
    body.set('nt_csrf', cfg.plan_csrf || '');
    for (const k in fields) {
        if (Object.prototype.hasOwnProperty.call(fields, k)) body.set(k, fields[k]);
    }
    return fetchJson(_planUrl(), {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest',
                   'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'same-origin',
        body: body.toString()
    }).then(function(d) {
        if (!d || d.error) throw new Error((d && d.error) || 'unknown');
        return d;
    });
}

/** Referenz setzen: {kind:'image', imageid} oder {kind:'url', url}. */
export function planSetRef(ref) {
    const f = { op: 'set', view: planViewKey(), scope: defaultPositionScope(), kind: ref.kind };
    if (ref.kind === 'image') f.imageid = ref.imageid;
    else f.url = ref.url || '';
    return _planPost(f);
}

/** Referenz der aktuellen Ansicht entfernen. */
export function planClearRef() {
    return _planPost({ op: 'clear', view: planViewKey(), scope: defaultPositionScope() });
}

/** Ein neues Background-Bild hochladen (image.create, nur Super-Admin). */
export function planUploadImage(name, dataUri) {
    return _planPost({ op: 'upload', name: name, data: dataUri })
        .then(function(d) { return d.imageid; });
}

// Fehlerkanal wie bei den Links — storage.js soll nichts ueber Toasts wissen.
let _onPosError = null;
export function setPositionErrorHandler(fn) { _onPosError = fn; }

// Zweiter Kanal neben _onPosError, aus demselben Grund: storage.js soll nichts
// ueber Toasts und Uebersetzungen wissen. network-topology.js haengt sich ein.
let _onPosTruncated = null;
export function setPositionTruncatedHandler(fn) { _onPosTruncated = fn; }

// Einmalige Uebernahme der alten localStorage-Anordnung in die eigene Ebene.
// Laeuft nur, wenn serverseitig fuer diese Ansicht noch nichts liegt — sonst
// wuerde ein alter Browser-Stand eine gepflegte Karte ueberschreiben.
(function migrateLegacyPositions() {
    try {
        const view = posViewKey();
        if (_posShared[view] || _posPersonal[view]) return;
        const raw = localStorage.getItem(posKey());
        if (!raw) return;
        const old = JSON.parse(raw);
        if (!old || typeof old !== 'object' || !Object.keys(old).length) return;
        // In die Ebene, die dieser Nutzer ohnehin beschreibt. Fuer einen
        // Super-Admin wird seine bisherige Anordnung damit zur GETEILTEN
        // Karte — was richtig ist: wer die Karte pflegt, soll die behalten,
        // die er schon hatte. Ginge sie stur in die persoenliche Ebene,
        // verdeckte sie ihm anschliessend seine eigene geteilte Karte.
        const mscope = defaultPositionScope();
        const mstore = mscope === SCOPE_SHARED ? _posShared : _posPersonal;
        mstore[view] = old;
        _persistPositions(mscope, mstore)
            .catch(function() { delete mstore[view]; });
    } catch (e) {}
})();

// ── Manual Links ─────────────────────────────────────────────────────────────
//
// Serverseitig seit 5.0.1. Vorher lagen die handgezogenen Kanten im
// localStorage: an einen Browser gebunden, weg beim Cache-Leeren, und der
// Kollege sah sie nie.
//
// Zwei Ebenen (Details in topology/ManualLinks.php):
//   shared    module.config — gilt fuer alle, schreiben nur Super-Admins
//   personal  CProfile      — jeder seine eigenen, ueber Rechner hinweg
//
// Gehalten wird beides im Speicher und beim Laden aus NT_CONFIG befuellt, damit
// loadLinks() SYNCHRON bleiben kann — die Aufrufer zeichnen damit mitten im
// Cytoscape-Rendering, ein Promise waere dort nicht unterzubringen. Schreiben
// laeuft optimistisch: erst der Speicher (die Kante erscheint sofort), dann der
// POST; scheitert er, wird zurueckgerollt und der Nutzer informiert.


let _linksShared   = [];
let _linksPersonal = [];

function _cfg() { return window.NT_CONFIG || {}; }

// ── Konflikterkennung ───────────────────────────────────────────────────────
// Beide Ebenen speichern den VOLLSTAENDIGEN Zustand, nicht ein Delta. Ohne
// Basis-Revision gewinnt der letzte Schreiber, und die Aenderung des anderen
// ist weg — ohne Fehlermeldung, sichtbar erst beim naechsten Laden. Betrifft
// zwei Tabs desselben Benutzers genauso wie zwei Super-Admins auf der
// geteilten Ebene.
//
// Der Server liefert die Revision beim Seitenaufbau (NT_CONFIG.revisions) und
// nach jedem erfolgreichen Schreiben. Wir schicken sie als "base" mit; passt
// sie nicht mehr, lehnt der Server ab statt zu ueberschreiben.
const _rev = {
    links_shared:       '',
    links_personal:     '',
    positions_shared:   '',
    positions_personal: ''
};
(function initRevisions() {
    const r = _cfg().revisions || {};
    for (const k in _rev) {
        if (typeof r[k] === 'string') _rev[k] = r[k];
    }
})();

function _revKey(kind, scope) { return kind + '_' + scope; }

// Konfliktkanal: das Entry-File haengt sich hier ein, damit storage.js nichts
// ueber Toasts oder Uebersetzungen wissen muss.
let _onConflict = null;
export function setConflictHandler(fn) { _onConflict = fn; }


(function hydrateLinks() {
    const ml = _cfg().manual_links || {};
    _linksShared   = Array.isArray(ml.shared)   ? ml.shared.slice()   : [];
    _linksPersonal = Array.isArray(ml.personal) ? ml.personal.slice() : [];
})();

// Welche Ebene beschreibt ein Klick? Wer die geteilte Karte pflegen darf, pflegt
// sie auch — fuer alle anderen sind es persoenliche Notizen.
export function defaultLinkScope() {
    return _cfg().is_super_admin ? SCOPE_SHARED : SCOPE_PERSONAL;
}

// Beide Ebenen zusammengefuehrt. Jeder Eintrag traegt seinen scope, damit die
// Darstellung geteilte und persoenliche Kanten unterscheiden kann.
export function loadLinks() {
    const out  = [];
    const seen = {};

    [[_linksShared, SCOPE_SHARED], [_linksPersonal, SCOPE_PERSONAL]].forEach(function(pair) {
        pair[0].forEach(function(l) {
            if (!l || !l.s || !l.t) return;
            // Geteilt gewinnt: dieselbe Kante nicht doppelt zeichnen, wenn
            // jemand sie zusaetzlich persoenlich angelegt hat.
            const key = String(l.s) < String(l.t) ? l.s + '|' + l.t : l.t + '|' + l.s;
            if (seen[key]) return;
            seen[key] = true;
            out.push({ s: l.s, t: l.t, scope: pair[1] });
        });
    });

    return out;
}

// Serverfahrt. Gibt ein Promise zurueck, das die Aufrufer ignorieren duerfen —
// der Speicher ist zu dem Zeitpunkt schon aktuell.
// Gleicher Mantel wie bei den Positionen — dieselbe Wettlaufsituation, nur
// seltener ausgeloest: manuelle Kanten entstehen einzeln per Klick.
function _persist(scope, links) {
    return _serial(_revKey('links', scope), function() {
        return _postLinks(scope, links);
    });
}

function _postLinks(scope, links) {
    const cfg = _cfg();
    const url = cfg.links_url || 'zabbix.php?action=network.topology.links';
    const body = new URLSearchParams();
    body.set('links', JSON.stringify(links.map(function(l) { return { s: l.s, t: l.t }; })));
    body.set('scope', scope);
    body.set('nt_csrf', cfg.links_csrf || '');
    body.set('base', _rev[_revKey('links', scope)] || '');

    return fetchJson(url, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest',
                   'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'same-origin',
        body: body.toString()
    })
    .then(function(d) {
        // Jemand anderes war schneller. Der Server hat NICHT geschrieben und
        // schickt den aktuellen Stand mit — damit setzt der Client neu auf,
        // statt eine weitere Runde zu drehen.
        if (d && d.conflict) {
            _adoptLinks(scope, d.links);
            _rev[_revKey('links', scope)] = d.revision || '';
            if (typeof _onConflict === 'function') _onConflict('links', d);
            throw _conflictError(d);
        }
        if (!d || d.error) throw new Error((d && d.error) || 'unknown');
        if (typeof d.revision === 'string') {
            _rev[_revKey('links', scope)] = d.revision;
        }
        // Gleiche Ueberlegung wie bei den Positionen: der Server hat die
        // Obergrenze angewendet und einen Teil verworfen. Kein Fehler —
        // gespeichert wurde etwas — aber stillschweigend darf es nicht
        // passieren, sonst fehlen beim naechsten Laden Kanten und es sieht
        // nach Datenverlust aus statt nach Grenze.
        if (d.truncated > 0 && typeof _onLinkTruncated === 'function') {
            _onLinkTruncated(d.truncated);
        }
        return d;
    });
}

// Gegenstueck zu _adoptPositions: der Konfliktzweig schickt den aktuellen
// Stand mit (NetworkTopologyLinks.php:139), und der Kommentar dort versprach
// schon immer, der Client setze damit neu auf. Bis hierher tat er es nicht.
function _adoptLinks(scope, links) {
    const clean = Array.isArray(links)
        ? links.filter(function(l) { return l && l.s && l.t; })
               .map(function(l) { return { s: String(l.s), t: String(l.t) }; })
        : [];
    if (scope === SCOPE_SHARED) _linksShared = clean;
    else                        _linksPersonal = clean;
}

function _rollback(scope, snapshot, err) {
    // Bei einem Konflikt steht der SERVER-Stand schon im Speicher (_adoptLinks).
    // Den lokalen Schnappschuss darueberzulegen waere ein Rueckschritt: er ist
    // genau der veraltete Stand, dessentwegen der Server abgelehnt hat.
    if (!(err && err.conflict)) {
        if (scope === SCOPE_SHARED) _linksShared = snapshot;
        else                        _linksPersonal = snapshot;
    }
    // Der Kanal feuert in BEIDEN Faellen: manual-links.js zeichnet darin die
    // Kanten aus dem Speicher neu — bei einem Konflikt also die des Servers.
    // Nur der generische Toast entfaellt dort.
    if (typeof _onLinkError === 'function') _onLinkError(err);
}

// Fehlerkanal: manual-links.js haengt sich hier ein, damit storage.js nichts
// ueber Toasts oder Uebersetzungen wissen muss.
let _onLinkError = null;
export function setLinkErrorHandler(fn) { _onLinkError = fn; }

// Zweiter Kanal, parallel zu setPositionTruncatedHandler: das Kappen bei
// MAX_LINKS war bisher nur serverseitig sichtbar.
let _onLinkTruncated = null;
export function setLinkTruncatedHandler(fn) { _onLinkTruncated = fn; }

export function addLink(s, t, scope) {
    const sc   = scope || defaultLinkScope();
    const list = sc === SCOPE_SHARED ? _linksShared : _linksPersonal;
    const snap = list.slice();

    list.push({ s: s, t: t });
    _persist(sc, list).catch(function(e) { _rollback(sc, snap, e); });

    return sc;
}

// Leert eine Ebene. Ohne scope: die, die der User ohnehin beschreibt.
export function clearLinks(scope) {
    const sc   = scope || defaultLinkScope();
    const snap = (sc === SCOPE_SHARED ? _linksShared : _linksPersonal).slice();

    if (sc === SCOPE_SHARED) _linksShared = [];
    else                     _linksPersonal = [];

    _persist(sc, []).catch(function(e) { _rollback(sc, snap, e); });
}

// Ersetzt eine Ebene komplett — genutzt vom Preset-Import.
export function setLinks(links, scope) {
    const sc    = scope || defaultLinkScope();
    const clean = (Array.isArray(links) ? links : [])
        .filter(function(l) { return l && l.s && l.t; })
        .map(function(l) { return { s: l.s, t: l.t }; });
    const snap  = (sc === SCOPE_SHARED ? _linksShared : _linksPersonal).slice();

    if (sc === SCOPE_SHARED) _linksShared = clean;
    else                     _linksPersonal = clean;

    _persist(sc, clean).catch(function(e) { _rollback(sc, snap, e); });
}

// ── Layout-Import: ueberlagern statt ersetzen ──────────────────────────────
//
// Der Datei-Import (layout-file.js) darf NIE Bestand loeschen und die geteilte
// Karte nicht versehentlich ueberschreiben. Deshalb ueberlagert er: Positionen
// pro Knoten, Links als Vereinigung. Fehlt ein Abschnitt in der Datei, passiert
// nichts (leeres Overlay/Union) — genau der Defekt, an dem der alte Import
// scheiterte ({}/[] truthy, Waechter griffen immer). Geschrieben wird in die
// Default-Ebene des Nutzers wie bei jedem anderen Schreibpfad. Der PRESET-Pfad
// (setPositions/setLinks = ersetzen) bleibt unberuehrt: ein Preset IST ein
// vollstaendiger Zustand aus der laufenden Karte, eine Datei ein Teilzustand.

// Obergrenze wie serverseitig ManualLinks::MAX_LINKS — sonst kappt der Server
// still und beim naechsten Laden fehlten Kanten ohne erkennbaren Grund.
const MAX_LINKS = 2000;

/** REIN: incoming ueberlagert base pro Knoten; neues Objekt, keine Seiteneffekte. */
export function overlayPositions(base, incoming) {
    const out = {};
    for (const id in base) {
        if (Object.prototype.hasOwnProperty.call(base, id)) out[id] = base[id];
    }
    for (const id in incoming) {
        if (Object.prototype.hasOwnProperty.call(incoming, id)) out[id] = incoming[id];
    }
    return out;
}

/**
 * REIN: Vereinigung zweier Link-Listen, dedupliziert pro Paar (ungerichtet,
 * kleinere ID zuerst — wie loadLinks), gekappt bei cap. existing kommt ZUERST,
 * ein importiertes Duplikat aendert also weder Reihenfolge noch Ebene einer
 * schon vorhandenen Kante.
 */
export function unionLinks(existing, incoming, cap) {
    const out    = [];
    const seen   = {};
    const grenze = (typeof cap === 'number' && cap > 0) ? cap : MAX_LINKS;
    const add = function(l) {
        if (!l || !l.s || !l.t || out.length >= grenze) return;
        const s = String(l.s), t = String(l.t);
        if (s === t) return;
        const key = s < t ? s + '|' + t : t + '|' + s;
        if (seen[key]) return;
        seen[key] = true;
        out.push({ s: s, t: t });
    };
    (existing || []).forEach(add);
    (incoming || []).forEach(add);
    return out;
}

/**
 * Positionen ueberlagernd in die Default-Ebene der (Datei-)View schreiben.
 * Liest den effektiven Stand (geteilt + eigene Abweichung), legt die
 * importierten Knoten drueber und uebergibt das an denselben Ebenen-Pfad wie
 * savePositions (_writePositions: persoenlich speichert die Abweichung, geteilt
 * die volle View). Eine Teildatei kann so nie die uebrigen Knoten loeschen.
 */
export function mergePositions(pos, groupView) {
    if (!pos || typeof pos !== 'object') return;
    const clean = _cleanPositions(pos);
    if (!clean) return;
    const view = posViewKey(groupView);
    const base = overlayPositions(_posShared[view] || {}, _posPersonal[view] || {});
    _writePositions(overlayPositions(base, clean), view);
}

/**
 * Links als Vereinigung in die Default-Ebene. Union ⊇ Bestand → nie ein
 * Verlust. Das scope-Feld der Datei wird bewusst ignoriert: auf einer anderen
 * Instanz ist es bedeutungslos, und ein Nicht-Super-Admin kann ueber einen
 * Import ohnehin keine geteilte Kante setzen (defaultLinkScope).
 */
export function mergeLinks(links, scope) {
    const sc  = scope || defaultLinkScope();
    const cur = sc === SCOPE_SHARED ? _linksShared : _linksPersonal;
    setLinks(unionLinks(cur, Array.isArray(links) ? links : [], MAX_LINKS), sc);
}

/** Pins additiv (Vereinigung) in den persoenlichen localStorage-Key. */
export function mergePinned(ids) {
    if (!Array.isArray(ids)) return;
    const set = {};
    loadPinned().forEach(function(id) { set[id] = true; });
    ids.forEach(function(id) { if (typeof id === 'string') set[id] = true; });
    try { localStorage.setItem(pinnedKey(), JSON.stringify(Object.keys(set))); } catch (e) {}
}

/** Notizen ueberlagernd (pro Knoten) in den persoenlichen localStorage-Key. */
export function mergeNotes(obj) {
    if (!obj || typeof obj !== 'object') return;
    const cur = loadNotes();
    for (const id in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, id) && typeof obj[id] === 'string') {
            cur[id] = obj[id];
        }
    }
    try { localStorage.setItem(notesKey(), JSON.stringify(cur)); } catch (e) {}
}

// Einmalige Uebernahme der alten localStorage-Links in die persoenliche Ebene.
// Laeuft nur, wenn serverseitig noch nichts liegt — sonst wuerde ein alter
// Browser-Stand einen gepflegten Serverstand ueberschreiben. Der localStorage-
// Eintrag bleibt als Sicherheitsnetz liegen; er wird nur nicht mehr gelesen.
(function migrateLegacyLinks() {
    try {
        if (_linksPersonal.length || _linksShared.length) return;
        const raw = localStorage.getItem(NT_LINKS_KEY);
        if (!raw) return;
        const old = JSON.parse(raw);
        if (!Array.isArray(old) || !old.length) return;
        const clean = old.filter(function(l) { return l && l.s && l.t; })
                         .map(function(l) { return { s: String(l.s), t: String(l.t) }; });
        if (!clean.length) return;
        _linksPersonal = clean;
        _persist(SCOPE_PERSONAL, clean).catch(function() { _linksPersonal = []; });
    } catch (e) {}
})();

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

function loadPresets() {
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
    // Ueber setPositions() statt in den localStorage: der alte Weg wurde seit
    // der Server-Umstellung nur noch von der Migration gelesen und war damit
    // wirkungslos (siehe setPositions).
    if (d.positions) {
        setPositions(d.positions, d.posGrp === true);
    }
    // Pinned
    if (d.pinned) {
        try { localStorage.setItem(pinnedKey(), JSON.stringify(d.pinned)); } catch (e) {}
    }
    // Notes
    if (d.notes) {
        try { localStorage.setItem(notesKey(), JSON.stringify(d.notes)); } catch (e) {}
    }
    // Manual-Links — gehen seit 5.0.1 auf den Server. Ein Preset schreibt in
    // die Ebene, die der User ohnehin beschreibt; ein Nicht-Super-Admin kann
    // ueber einen Preset-Import also keine geteilten Kanten setzen.
    if (d.links) {
        setLinks(d.links);
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
