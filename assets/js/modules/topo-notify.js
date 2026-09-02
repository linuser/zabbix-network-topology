// topo-notify.js — Topologie-Aenderungen als Toasts melden.
//
// Das Backend difft bei jedem /data-Fetch den Edge-Stand gegen seine
// APCu-Baseline (user+groups-scoped, rollt pro Poll weiter) und liefert
// topo_changes: { added: [{a,b}], removed: [{a,b}], moved: [{a,b,ports}] }.
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
    added.forEach(function(x)   { events.push({ key: 'topo.added',   x: x, level: 'info' }); });
    removed.forEach(function(x) { events.push({ key: 'topo.removed', x: x, level: 'warn' }); });
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
            host: ev.x.host || '?', from: ev.x.from || '?', to: ev.x.to || '?'
        }), ev.level, 8000);
    });
    if (events.length > 4) {
        toast('+' + (events.length - 4) + ' …', 'info', 8000);
    }
}
