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
const NT_POS_PREFIX     = 'nt_' + PFX + 'pos_';
const NT_PINNED_PREFIX  = 'nt_' + PFX + 'pinned_';
const NT_NOTES_PREFIX   = 'nt_' + PFX + 'notes_';
const NT_LINKS_KEY      = 'nt_' + PFX + 'manual_links';
export const NT_LLDP_KEY       = 'nt_' + PFX + 'lldp_visible';
export const NT_WEATHERMAP_KEY = 'nt_' + PFX + 'weathermap';
export const NT_PORTLABELS_KEY = 'nt_' + PFX + 'portlabels';
// §9: Ghost-Knoten (unmatched LLDP-Nachbarn) ein-/ausblenden. Default AUS —
// in Netzen mit vielen unbekannten Geraeten wuerde die Karte sonst zuwuchern.
export const NT_GHOSTS_KEY     = 'nt_' + PFX + 'ghosts';
export const NT_LEGEND_COLLAPSED_KEY = 'nt_' + PFX + 'legend_collapsed';
export const NT_PERF_KEY = 'nt_' + PFX + 'perf';
export const NT_TAB_KEY        = 'nt_' + PFX + 'active_tab';
export const NT_GROUP_VIEW_KEY = 'nt_' + PFX + 'group_view';
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

function _persistPositions(scope, views) {
    const cfg  = _cfg();
    const url  = cfg.positions_url || 'zabbix.php?action=network.topology.positions';
    const body = new URLSearchParams();
    body.set('positions', JSON.stringify(views));
    body.set('scope', scope);
    body.set('nt_csrf', cfg.positions_csrf || '');
    body.set('base', _rev[_revKey('positions', scope)] || '');

    return fetch(url, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest',
                   'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'same-origin',
        body: body.toString()
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        // Siehe _persist: zwischenzeitlich hat jemand anderes geschrieben.
        if (d && d.conflict) {
            _rev[_revKey('positions', scope)] = d.revision || '';
            if (typeof _onConflict === 'function') _onConflict('positions', d);
            throw new Error(d.error || 'conflict');
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

export function savePositions(cyInst) {
    const pos = {};
    let nonZero = 0;

    cyInst.nodes('[!isGroup]').forEach(function(n) {
        // Virtuelle Knoten (Internet-Wolke) NICHT speichern — sie werden pro
        // Render frisch injiziert und ihre Position ist nicht user-signifikant.
        const id = String(n.id());
        if (id.indexOf('internet_') === 0) return;
        const p = n.position();
        pos[id] = { x: Math.round(p.x), y: Math.round(p.y) };
        if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) nonZero++;
    });

    // Degenerierter Zustand (alles auf 0,0) nicht persistieren — das ist der
    // Moment vor dem ersten Layout-Durchlauf, keine Anordnung.
    if (nonZero === 0) return;

    const view  = posViewKey();
    const scope = defaultPositionScope();

    if (scope === SCOPE_SHARED) {
        // Der Super-Admin pflegt die Karte: seine Anordnung IST sie, komplett.
        _posShared[view] = pos;
        _persistPositions(SCOPE_SHARED, _posShared)
            .catch(function(e) { if (_onPosError) _onPosError(e); });

        // Eine eigene Abweichung fuer diese Ansicht loesen wir dabei auf.
        // Sonst gewinnt sie pro Knoten weiter — und der Admin saehe seine
        // gerade gespeicherte Karte selbst nicht. Genau das passierte, wenn
        // eine alte localStorage-Anordnung vorher in die persoenliche Ebene
        // gewandert war.
        if (_posPersonal[view]) {
            delete _posPersonal[view];
            _persistPositions(SCOPE_PERSONAL, _posPersonal)
                .catch(function(e) { if (_onPosError) _onPosError(e); });
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
        .catch(function(e) { if (_onPosError) _onPosError(e); });
}

/** Setzt die eigene Ebene fuer die aktuelle Ansicht zurueck. */
export function clearPositions() {
    const view  = posViewKey();
    const scope = defaultPositionScope();
    const store = scope === SCOPE_SHARED ? _posShared : _posPersonal;

    delete store[view];
    _persistPositions(scope, store)
        .catch(function(e) { if (_onPosError) _onPosError(e); });
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
function _persist(scope, links) {
    const cfg = _cfg();
    const url = cfg.links_url || 'zabbix.php?action=network.topology.links';
    const body = new URLSearchParams();
    body.set('links', JSON.stringify(links.map(function(l) { return { s: l.s, t: l.t }; })));
    body.set('scope', scope);
    body.set('nt_csrf', cfg.links_csrf || '');
    body.set('base', _rev[_revKey('links', scope)] || '');

    return fetch(url, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest',
                   'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'same-origin',
        body: body.toString()
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        // Jemand anderes war schneller. Der Server hat NICHT geschrieben und
        // schickt den aktuellen Stand mit — damit setzt der Client neu auf,
        // statt eine weitere Runde zu drehen.
        if (d && d.conflict) {
            _rev[_revKey('links', scope)] = d.revision || '';
            if (typeof _onConflict === 'function') _onConflict('links', d);
            throw new Error(d.error || 'conflict');
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

function _rollback(scope, snapshot, err) {
    if (scope === SCOPE_SHARED) _linksShared = snapshot;
    else                        _linksPersonal = snapshot;
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
