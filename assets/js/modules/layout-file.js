// layout-file.js — Layout als Datei sichern und zurueckholen.
//
// WARUM ES DAS BRAUCHT
// --------------------
// Presets koennen dasselbe schon: collectCurrentState() sammelt Positionen,
// Pins, Notizen und Links, applyPreset() spielt sie zurueck. Nur liegen sie im
// localStorage. Der ueberlebt keinen Browserwechsel, kein zweites Geraet und
// erst recht nicht den Weg von einer Zabbix-Installation zur naechsten. Genau
// das sind aber die Faelle, um die es geht: sichern und uebertragen.
//
// Diese Datei ist deshalb bewusst duenn. Sie serialisiert, was es schon gibt,
// und liest es zurueck — der ganze Rest liegt in storage.js.
//
// DIE PRUEFUNG BEIM EINLESEN IST DER EIGENTLICHE INHALT
// ----------------------------------------------------
// Eine importierte Datei ist Fremdeingabe, auch wenn sie "vom eigenen System"
// kommt — sie hat unterwegs jeden Editor passieren koennen. Und sie landet
// nicht in einem Anzeigefeld, sondern:
//
//   - im localStorage, aus dem der Renderer direkt liest
//   - ueber setLinks() auf dem Server
//   - als Knoten-IDs spaeter in Element-IDs im DOM ("ml_<s>_<t>")
//
// Muster und Obergrenzen sind DIESELBEN wie serverseitig in ManualLinks und
// NodePositions (ID_PATTERN, MAX_LINKS, MAX_NODES). Nicht aus Vorsicht doppelt,
// sondern damit der Client nichts durchlaesst, was der Server danach still
// verwirft — sonst importiert jemand 3000 Kanten, sieht keinen Fehler, und
// 1000 davon sind weg.
//
// Was NICHT geprueft wird: ob die Host-IDs auf diesem System existieren. Beim
// Uebertrag zwischen zwei Zabbix-Installationen tun sie das oft nicht, und das
// ist kein Fehler — Positionen unbekannter Knoten liegen einfach brach. Der
// Import meldet die Zahl, damit niemand raetselt.

import { collectCurrentState, applyPreset } from './storage.js';
import { t } from './i18n.js';

const FORMAT   = 'network-topology-layout';
const VERSION  = 1;

// Gleichlautend mit ManualLinks::ID_PATTERN / NodePositions::ID_PATTERN.
const ID_RX      = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_LINKS  = 2000;    // ManualLinks::MAX_LINKS
const MAX_NODES  = 5000;    // NodePositions::MAX_NODES
const MAX_NOTE   = 500;     // Notizen sind Kurztext, kein Dokument
const MAX_BYTES  = 4 * 1024 * 1024;

function isFiniteNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Prueft und beschneidet den Inhalt einer importierten Datei.
 *
 * Liefert { data, stats } oder wirft mit einem uebersetzten Grund. Wirft nur
 * bei Struktur-Fehlern; einzelne unbrauchbare Eintraege werden still verworfen
 * und in stats gezaehlt — eine Datei mit einer kaputten Position soll nicht
 * komplett scheitern.
 */
export function sanitizeLayout(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(t('layoutfile.err.structure'));
    }
    if (raw.format !== FORMAT) {
        throw new Error(t('layoutfile.err.format'));
    }
    if (raw.version !== VERSION) {
        throw new Error(t('layoutfile.err.version', { v: String(raw.version) }));
    }

    const d = (raw.data && typeof raw.data === 'object') ? raw.data : {};
    const stats = { positions: 0, pinned: 0, notes: 0, links: 0, verworfen: 0 };

    // ── Positionen ────────────────────────────────────────────────────────
    const positions = {};
    if (d.positions && typeof d.positions === 'object' && !Array.isArray(d.positions)) {
        for (const id in d.positions) {
            if (stats.positions >= MAX_NODES) { stats.verworfen++; continue; }
            const p = d.positions[id];
            if (!ID_RX.test(id) || !p || typeof p !== 'object'
                || !isFiniteNum(p.x) || !isFiniteNum(p.y)) {
                stats.verworfen++;
                continue;
            }
            positions[id] = { x: p.x, y: p.y };
            stats.positions++;
        }
    }

    // ── Pins ──────────────────────────────────────────────────────────────
    const pinned = [];
    if (Array.isArray(d.pinned)) {
        d.pinned.forEach(function(id) {
            if (typeof id === 'string' && ID_RX.test(id) && pinned.indexOf(id) === -1) {
                pinned.push(id);
                stats.pinned++;
            } else {
                stats.verworfen++;
            }
        });
    }

    // ── Notizen ───────────────────────────────────────────────────────────
    // Der Text wird NICHT hier escaped — das tut der Renderer ueber esc().
    // Hier nur begrenzen, damit niemand ein Megabyte je Knoten ablegt.
    const notes = {};
    if (d.notes && typeof d.notes === 'object' && !Array.isArray(d.notes)) {
        for (const id in d.notes) {
            const txt = d.notes[id];
            if (!ID_RX.test(id) || typeof txt !== 'string') { stats.verworfen++; continue; }
            notes[id] = txt.slice(0, MAX_NOTE);
            stats.notes++;
        }
    }

    // ── Manuelle Verbindungen ─────────────────────────────────────────────
    // Normalisiert wie serverseitig: kleinere ID zuerst, damit A-B und B-A
    // dieselbe Kante sind und nicht doppelt landen.
    const links = [];
    const seen  = {};
    if (Array.isArray(d.links)) {
        d.links.forEach(function(l) {
            if (links.length >= MAX_LINKS) { stats.verworfen++; return; }
            if (!l || typeof l !== 'object') { stats.verworfen++; return; }
            let s = typeof l.s === 'string' ? l.s : '';
            let tt = typeof l.t === 'string' ? l.t : '';
            if (!ID_RX.test(s) || !ID_RX.test(tt) || s === tt) { stats.verworfen++; return; }
            if (s > tt) { const tmp = s; s = tt; tt = tmp; }
            const key = s + '|' + tt;
            if (seen[key]) { stats.verworfen++; return; }
            seen[key] = true;
            links.push({ s: s, t: tt });
            stats.links++;
        });
    }

    return {
        data: {
            positions: positions,
            posGrp:    d.posGrp === true,
            pinned:    pinned,
            notes:     notes,
            links:     links
        },
        stats: stats
    };
}

/** Baut den Dateiinhalt aus dem aktuellen Zustand. */
export function buildLayoutFile(moduleVersion) {
    return JSON.stringify({
        format:  FORMAT,
        version: VERSION,
        // Nur zur Nachvollziehbarkeit beim Lesen der Datei — beim Import wird
        // sie nicht geprueft. Ein Layout aus 5.1.2 auf 5.3 einzuspielen ist
        // ausdruecklich erlaubt; das Format traegt seine eigene Version.
        module:  moduleVersion || '',
        created: new Date().toISOString(),
        data:    collectCurrentState()
    }, null, 2);
}

/** Loest den Download aus. */
export function downloadLayout(moduleVersion) {
    const text = buildLayoutFile(moduleVersion);
    const url  = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'nt-layout-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

/**
 * Liest eine Datei ein und wendet sie an. Liefert die Statistik.
 *
 * applyPreset() bekommt eine leere Preset-Identitaet: ein Import IST kein
 * Preset, und danach soll die Preset-Auswahl auf "keins" stehen statt auf einem
 * Namen, unter dem nichts gespeichert ist.
 */
export function importLayoutFile(file) {
    return new Promise(function(resolve, reject) {
        if (!file) { reject(new Error(t('layoutfile.err.nofile'))); return; }
        if (file.size > MAX_BYTES) { reject(new Error(t('layoutfile.err.toobig'))); return; }
        const fr = new FileReader();
        fr.onerror = function() { reject(new Error(t('layoutfile.err.read'))); };
        fr.onload  = function() {
            let parsed;
            try {
                parsed = JSON.parse(String(fr.result));
            } catch (e) {
                reject(new Error(t('layoutfile.err.json')));
                return;
            }
            let clean;
            try {
                clean = sanitizeLayout(parsed);
            } catch (e) {
                reject(e);
                return;
            }
            applyPreset({ name: '', scope: null, scopeKey: null, data: clean.data });
            resolve(clean.stats);
        };
        fr.readAsText(file);
    });
}
