// topo-notify.js — Topologie-Aenderungen als Toasts melden.
//
// Das Backend difft bei jedem /data-Fetch den Edge-Stand gegen seine
// APCu-Baseline (user+groups-scoped, rollt pro Poll weiter) und liefert
// topo_changes: { added: [{a,b}], removed: [{a,b}] }. Wir melden das als
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
    const events = [];
    added.forEach(function(x)   { events.push({ key: 'topo.added',   x: x, level: 'info' }); });
    removed.forEach(function(x) { events.push({ key: 'topo.removed', x: x, level: 'warn' }); });
    if (!events.length) return;
    // Max 4 Einzel-Toasts, danach Sammel-Zeile — ein Core-Switch-Reboot
    // wuerde sonst den Bildschirm mit Toasts fluten.
    events.slice(0, 4).forEach(function(ev) {
        toast(t(ev.key, { a: ev.x.a || '?', b: ev.x.b || '?' }), ev.level, 8000);
    });
    if (events.length > 4) {
        toast('+' + (events.length - 4) + ' …', 'info', 8000);
    }
}
