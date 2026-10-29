// vlan-filter.js — VLAN-Ansicht: nur Geraete/Links auf einem gewaehlten VLAN
// hervorheben, den Rest dimmen.
//
// Datenquelle sind die Felder, die der Backend seit 3.5b liefert (NT VLAN by
// SNMP): jeder Knoten traegt data('vlans') = [{id,name}] (die VLANs, auf denen
// das Geraet liegt), jede Kante data('vlans') = [VLAN-IDs] ("mindestens ein
// Ende"). Ohne nt.vlan.walk fehlen die Felder -> collectVlans() liefert leer,
// und die Toolbar blendet den Waehler gar nicht erst ein.
//
// Gedimmt statt versteckt: der Kontext (wo liegt das VLAN IM Netz) geht sonst
// verloren -- dieselbe Entscheidung wie beim Pfad-Highlight.

// Alle im Graphen vorkommenden VLANs einsammeln, nach ID sortiert, dedupliziert.
export function collectVlans(cy) {
    const seen = {};
    cy.nodes().forEach(function(n) {
        const vs = n.data('vlans');
        if (vs && vs.length) {
            vs.forEach(function(v) {
                // Nicht-leerer Name gewinnt: ein Switch benennt das VLAN, ein
                // anderer liefert es ohne Namen -- sonst entschied, wer zuerst lief.
                if (v && v.id != null && (!(v.id in seen) || (!seen[v.id] && v.name))) {
                    seen[v.id] = v.name || seen[v.id] || '';
                }
            });
        }
    });
    return Object.keys(seen).map(function(k) {
        return { id: parseInt(k, 10), name: seen[k] };
    }).sort(function(a, b) { return a.id - b.id; });
}

// Filter anwenden: alles, was NICHT auf vlanId liegt, bekommt .nt-vlan-off
// (die Style-Engine dimmt es). Knoten ohne VLAN-Daten gelten als "nicht auf
// diesem VLAN" und werden gedimmt -- ehrlich, denn wir wissen es nicht.
export function applyVlanFilter(cy, vlanId) {
    clearVlanFilter(cy);
    if (vlanId == null || vlanId === '') {
        return;
    }
    const id = parseInt(vlanId, 10);
    cy.batch(function() {
        cy.nodes().forEach(function(n) {
            const vs = n.data('vlans');
            const on = !!(vs && vs.some(function(v) { return v.id === id; }));
            if (!on) {
                n.addClass('nt-vlan-off');
            }
        });
        cy.edges().forEach(function(e) {
            const vs = e.data('vlans');
            const on = !!(vs && vs.indexOf(id) !== -1);
            if (!on) {
                e.addClass('nt-vlan-off');
            }
        });
    });
}

export function clearVlanFilter(cy) {
    cy.elements('.nt-vlan-off').removeClass('nt-vlan-off');
}
