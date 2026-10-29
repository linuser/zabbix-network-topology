// layout-file.js — Layout als Datei sichern und zurueckholen.
//
// WARUM ES DAS BRAUCHT
// --------------------
// Presets sammeln denselben Zustand schon (collectCurrentState), nur liegen sie
// im localStorage: kein Browserwechsel, kein zweites Geraet, und schon gar nicht
// der Weg von einer Zabbix-Installation zur naechsten. Datei-Export/-Import
// schliessen diese Luecke.
//
// WARUM DER IMPORT ZUSAMMENFUEHRT, NICHT ERSETZT
// ----------------------------------------------
// Der Import war einmal gebaut und wurde ausgebaut: der alte Apply-Pfad
// (applyPreset -> setPositions/setLinks) ist fuer VOLLSTAENDIGE Zustaende aus
// der laufenden Karte geschrieben, eine Datei ist aber ein beliebiger
// TEILzustand. Fehlende Abschnitte loeschten den Bestand ({}/[] sind truthy),
// und ein Super-Admin loeschte mit einer Datei ohne Links die manuellen
// Verbindungen ALLER Nutzer — mit gruener Erfolgsmeldung.
//
// Jetzt ueberlagert der Import (storage.js: mergePositions/mergeLinks/
// mergePinned/mergeNotes) statt zu ersetzen:
//   - Positionen pro Knoten, Links als Vereinigung, Pins/Notizen additiv.
//   - Fehlt ein Abschnitt, passiert nichts. Eine Teildatei kann NIE loeschen.
//   - Geschrieben wird in die Default-Ebene des Nutzers (Super-Admin: geteilt =
//     "veroeffentlichen", sonst persoenlich) — wie jeder andere Schreibpfad.
//
// DIE PRUEFUNG BEIM EINLESEN IST DER EIGENTLICHE INHALT
// ----------------------------------------------------
// Eine importierte Datei ist Fremdeingabe, auch wenn sie "vom eigenen System"
// kommt — sie hat unterwegs jeden Editor passieren koennen. Und sie landet
// nicht in einem Anzeigefeld, sondern im Positions-/Link-Speicher (Server) und
// spaeter als Knoten-IDs in Element-IDs im DOM ("ml_<s>_<t>"). Muster und
// Obergrenzen sind DIESELBEN wie serverseitig in ManualLinks/NodePositions,
// damit der Client nichts durchlaesst, was der Server danach still verwirft.
// (sanitizeLayout war nie der Grund fuer den Ausbau — sie kommt unveraendert
// zurueck.)
//
// Was NICHT geprueft wird: ob die Host-IDs auf diesem System existieren. Beim
// Uebertrag zwischen zwei Installationen tun sie das oft nicht, und das ist kein
// Fehler — Positionen unbekannter Knoten liegen einfach brach.

import {
    collectCurrentState,
    mergePositions, mergeLinks, mergePinned, mergeNotes
} from './storage.js';
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
 * Liefert { data, stats } oder wirft mit einem uebersetzten Grund. Wirft nur bei
 * Struktur-Fehlern; einzelne unbrauchbare Eintraege werden still verworfen und
 * in stats gezaehlt — eine Datei mit einer kaputten Position soll nicht komplett
 * scheitern.
 *
 * data enthaelt NUR die Abschnitte, die in der Datei WIRKLICH standen (nicht
 * leere Container): so ueberlagert der Import nur, was da ist, und loescht nie.
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

    // ── Positionen ──────────────────────────────────────────────────────────
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

    // ── Pins ────────────────────────────────────────────────────────────────
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

    // ── Notizen ─────────────────────────────────────────────────────────────
    // Der Text wird NICHT hier escaped — das tut der Renderer ueber esc(). Hier
    // nur begrenzen, damit niemand ein Megabyte je Knoten ablegt.
    const notes = {};
    if (d.notes && typeof d.notes === 'object' && !Array.isArray(d.notes)) {
        for (const id in d.notes) {
            const txt = d.notes[id];
            if (!ID_RX.test(id) || typeof txt !== 'string') { stats.verworfen++; continue; }
            notes[id] = txt.slice(0, MAX_NOTE);
            stats.notes++;
        }
    }

    // ── Manuelle Verbindungen ─────────────────────────────────────────────────
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

    // NUR die Abschnitte zurueckgeben, die in der Datei WIRKLICH standen — der
    // Merge-Pfad ueberlagert dann nur diese. (Der alte Import gab immer alle
    // fuenf als leere Container zurueck, und {}/[] sind truthy: die Waechter,
    // die einen fehlenden Abschnitt ueberspringen sollten, griffen IMMER, und
    // der Ersetzen-Pfad loeschte den Bestand.)
    const data = { posGrp: d.posGrp === true };
    if (d.positions && typeof d.positions === 'object' && !Array.isArray(d.positions)) {
        data.positions = positions;
    }
    if (Array.isArray(d.pinned)) {
        data.pinned = pinned;
    }
    if (d.notes && typeof d.notes === 'object' && !Array.isArray(d.notes)) {
        data.notes = notes;
    }
    if (Array.isArray(d.links)) {
        data.links = links;
    }

    return { data: data, stats: stats };
}

/** Baut den Dateiinhalt aus dem aktuellen Zustand. */
function buildLayoutFile(moduleVersion) {
    return JSON.stringify({
        format:  FORMAT,
        version: VERSION,
        // Nur zur Nachvollziehbarkeit beim Lesen der Datei — beim Import wird sie
        // nicht geprueft. Ein Layout aus 5.1.2 auf 5.3 einzuspielen ist erlaubt;
        // das Format traegt seine eigene Version.
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
 * Liest eine Datei und gibt den geprueften Inhalt { data, stats } zurueck —
 * OHNE etwas anzuwenden. Getrennt vom Anwenden, damit der Aufrufer bei einem
 * Super-Admin (geteilte Ebene) vorher bestaetigen lassen kann.
 */
export function readLayoutFile(file) {
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
            try {
                resolve(sanitizeLayout(parsed));
            } catch (e) {
                reject(e);
            }
        };
        fr.readAsText(file);
    });
}

/**
 * Wendet einen geprueften Teilzustand an — ueberlagernd, nie ersetzend.
 *
 * Positionen setzen das Skip-Flag: der durch den anschliessenden Re-Render
 * ausgeloeste layoutstop darf die gerade gemergten Positionen NICHT mit dem
 * (im Cluster-Modus neu berechneten) Layout-Stand ueberschreiben. Gezeichnet
 * werden die Positionen nach den normalen Regeln der Ansicht; im Cluster-Modus
 * weist der bestehende cluster.overrides_positions-Hinweis darauf hin, dass das
 * adaptive Layout sie erst nach einem 'Raster aus' zeigt.
 */
export function importLayout(data) {
    if (!data || typeof data !== 'object') return;
    if (data.positions) {
        window._ntSkipNextLayoutSave = true;
        mergePositions(data.positions, data.posGrp === true);
    }
    if (data.pinned) mergePinned(data.pinned);
    if (data.notes)  mergeNotes(data.notes);
    if (data.links)  mergeLinks(data.links);
}
