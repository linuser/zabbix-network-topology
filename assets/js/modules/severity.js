// severity.js — Severity-Farben/Labels und Gruppen-Farb-Pool.
//
// SEV_COL: Farben für Severity 0-5 (Normal/Info/Warning/Average/High/Disaster)
// SEV_LBL: Klartext-Labels in derselben Reihenfolge
// grpColor(name): liefert deterministisch dieselbe Farbe pro Gruppen-Namen,
//   nimmt zyklisch aus GRP_COLORS, mappt einmal pro Lebenszeit der Page.

export const SEV_COL = ['#22c55e', '#06b6d4', '#f59e0b', '#f97316', '#ef4444', '#991b1b'];
export const SEV_LBL = ['Normal', 'Info', 'Warning', 'Average', 'High', 'Disaster'];

const GRP_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
                    '#f97316', '#ec4899', '#14b8a6', '#84cc16', '#6366f1', '#e11d48'];

const _gcMap = {};
let _gcIdx = 0;

export function grpColor(name) {
    if (!name) return '#94a3b8';
    if (!_gcMap[name]) {
        _gcMap[name] = GRP_COLORS[_gcIdx++ % GRP_COLORS.length];
    }
    return _gcMap[name];
}

// primaryGroup ist eng mit Gruppen verknüpft, daher hier:
// liefert die "primäre" Gruppe eines Hosts. Bevorzugt Gruppen aus der aktuellen
// Auswahl (sel), sonst die erste in n.groups.
export function primaryGroup(n, sel) {
    if (!n.groups || !n.groups.length) return null;
    if (sel && sel.length) {
        for (let i = 0; i < n.groups.length; i++) {
            if (sel.indexOf(n.groups[i]) >= 0) return n.groups[i];
        }
    }
    return n.groups[0];
}
