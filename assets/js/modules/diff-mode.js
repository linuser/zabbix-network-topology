// diff-mode.js — Schicht-Snapshot fuer "was hat sich seit dann veraendert".
//
// Use-Case: Schichtwechsel. User macht einen Snapshot, geht weg, kommt zurueck
// (vielleicht aus dem Urlaub) und sieht sofort: 3 Hosts neu, 1 Host weg,
// 5 Hosts haben jetzt schlimmere Severity.
//
// Snapshot persistiert in localStorage und enthaelt:
//   ts         — Unix-Timestamp wann gesetzt
//   byHost[id] — { sev, probs, unavail, label } pro Host
//
// API:
//   saveSnapshot(nodes)      Snapshot setzen aus aktuellem Daten-Array
//   loadSnapshot()           {ts, byHost} oder null
//   clearSnapshot()          loescht den Snapshot
//   hasSnapshot()            bool
//   computeDiff(nodes, snap) → { new: Set, gone: Set, up: Set, down: Set,
//                                 sevByHost: Map<id, {old, now}> }

const KEY = 'nt_diff_snapshot_v1';

function _hostsToMap(nodes) {
    const m = {};
    (nodes || []).forEach(function(n) {
        if (!n || !n.id) return;
        m[String(n.id)] = {
            sev:     n.severity || 0,
            probs:   n.problems || 0,
            unavail: !!n.unavailable,
            label:   n.label || n.host || '',
        };
    });
    return m;
}

export function saveSnapshot(nodes) {
    const snap = {
        ts:     Math.floor(Date.now() / 1000),
        byHost: _hostsToMap(nodes),
    };
    try { localStorage.setItem(KEY, JSON.stringify(snap)); } catch (e) {}
    return snap;
}

export function loadSnapshot() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.byHost || !parsed.ts) return null;
        return parsed;
    } catch (e) { return null; }
}

export function clearSnapshot() {
    try { localStorage.removeItem(KEY); } catch (e) {}
}

export function hasSnapshot() {
    return loadSnapshot() !== null;
}

// Vergleicht den aktuellen Daten-Stand gegen den Snapshot. Liefert Sets von
// host-IDs in 4 Kategorien plus ein Detail-Map mit Severity-Aenderungen.
//   new:  jetzt da, im Snapshot nicht
//   gone: im Snapshot da, jetzt nicht
//   up:   Severity (oder unavailable) verschlechtert
//   down: Severity (oder unavailable) verbessert
// "unavail" wird wie Severity 6 (schlimmer als Disaster) behandelt damit
// "online → offline" als up und "offline → online" als down kommt.
function _severityKey(rec) {
    return rec.unavail ? 6 : (rec.sev || 0);
}

export function computeDiff(currentNodes, snap) {
    const result = { new: new Set(), gone: new Set(), up: new Set(), down: new Set(),
                     sevByHost: new Map() };
    if (!snap || !snap.byHost) return result;
    const now = _hostsToMap(currentNodes);
    const nowKeys = Object.keys(now);
    const snapKeys = Object.keys(snap.byHost);
    nowKeys.forEach(function(id) {
        if (!snap.byHost[id]) { result.new.add(id); return; }
        const oldRec = snap.byHost[id];
        const newRec = now[id];
        const oldK = _severityKey(oldRec);
        const newK = _severityKey(newRec);
        if (newK > oldK) result.up.add(id);
        else if (newK < oldK) result.down.add(id);
        if (newK !== oldK) {
            result.sevByHost.set(id, { old: oldK, now: newK });
        }
    });
    snapKeys.forEach(function(id) {
        if (!now[id]) result.gone.add(id);
    });
    return result;
}

// Formatiert das Snapshot-Alter fuer UI-Labels.
export function formatSnapshotAge(snap) {
    if (!snap || !snap.ts) return '';
    const sec = Math.max(0, Math.floor(Date.now() / 1000) - snap.ts);
    const m = Math.floor(sec / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return d + 'd ' + (h % 24) + 'h';
    if (h > 0) return h + 'h ' + (m % 60) + 'm';
    if (m > 0) return m + 'min';
    return sec + 's';
}
