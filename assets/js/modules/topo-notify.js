// topo-notify.js — Topologie-Aenderungen als Toasts melden.
//
// Das Backend difft bei jedem /data-Fetch den Edge-Stand gegen seine
// APCu-Baseline (user+groups-scoped, rollt pro Poll weiter) und liefert
// topo_changes: { added: [{a,b}], removed: [{a,b}], moved: [{a,b,ports}] }.
// Mitglieder eines Buendels tragen zusaetzlich pa/pb und eine Stueckzahl.
// 'moved' ist der Fall, der bis 5.3 durchfiel: dasselbe Host-Paar, anderer
// Port. Der Baseline-Schluessel besteht aus dem Paar, und das aendert sich
// beim Umstecken nicht — also gab es weder added noch removed und damit gar
// keine Meldung. Wir melden das als
// Toast — "jemand hat am Switch umgesteckt" als aktive Meldung statt
// Zufallsfund.
//
// Eigenes Leaf-Modul (statt in network-topology.js), weil sowohl der
// Initial-Fetch als auch der Auto-Refresh in render-tech.js es brauchen —
// ein Import aus network-topology.js waere ein zirkulaerer Import, und
// der ESM-Blob-Loader bricht bei Zyklen.

import { toast } from './toast.js';
import { t } from './i18n.js';

export function notifyTopoChanges(tc) {
    if (!tc) return;
    const added   = tc.added   || [];
    const removed = tc.removed || [];
    const moved   = tc.moved   || [];
    const events = [];
    // Ein Kabel ist nicht die Verbindung. Traegt der Eintrag Ports und eine
    // Stueckzahl, gehoert er zu einem Buendel — dann sagt die Meldung, WELCHES
    // Kabel es war und was noch traegt. "link core <-> acc disappeared" bei
    // drei von vier lebenden Kabeln schickt jemanden umsonst in den
    // Serverraum, und beim naechsten Mal glaubt er der Meldung nicht mehr.
    // Das Backend haengt die Felder nur an Buendel-Mitglieder (TopoDiff).
    const istKabel = function(x) { return x && x.pa !== undefined; };
    added.forEach(function(x) {
        events.push({ key: istKabel(x) ? 'topo.added.cable' : 'topo.added',
            x: x, level: 'info' });
    });
    removed.forEach(function(x) {
        // Faellt das LETZTE Kabel, ist die Verbindung doch weg — dann ist die
        // dringlichere Aussage die richtige.
        const key = !istKabel(x) ? 'topo.removed'
            : ((x.left || 0) > 0 ? 'topo.removed.cable' : 'topo.removed.last');
        events.push({ key: key, x: x, level: 'warn' });
    });
    // Je gewechseltem Port eine Zeile. Sind beide Enden umgesteckt, sind es
    // zwei — das sind auch zwei Handgriffe gewesen, und eine zusammengefasste
    // Zeile muesste die Ports paaren, was sie nicht kann.
    moved.forEach(function(m) {
        (m.ports || []).forEach(function(p) {
            events.push({ key: 'topo.moved', level: 'warn',
                x: { a: m.a, b: m.b, host: p.host, from: p.from, to: p.to } });
        });
    });
    if (!events.length) return;
    // Max 4 Einzel-Toasts, danach Sammel-Zeile — ein Core-Switch-Reboot
    // wuerde sonst den Bildschirm mit Toasts fluten.
    events.slice(0, 4).forEach(function(ev) {
        toast(t(ev.key, {
            a: ev.x.a || '?', b: ev.x.b || '?',
            host: ev.x.host || '?', from: ev.x.from || '?', to: ev.x.to || '?',
            // Ein unbekannter Port ist ein Fragezeichen, keine leere Stelle —
            // "cable core  <-> acc Te1/1/2" laese sich wie ein Tippfehler.
            pa: ev.x.pa || '?', pb: ev.x.pb || '?',
            n: ev.x.n || 0, left: ev.x.left || 0, was: ev.x.was || 0
        }), ev.level, 8000);
    });
    if (events.length > 4) {
        toast('+' + (events.length - 4) + ' …', 'info', 8000);
    }
}
