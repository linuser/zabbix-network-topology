// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
//
// nt-assign-guard — macht Cytoscape auf Zabbix 8 wieder ladbar.
//
// DAS PROBLEM
// -----------
// Zabbix 8 legt in js/common.js:114 einen Helfer auf den Array-Prototyp:
//
//     Object.defineProperty(Array.prototype, 'xor', {
//         value: function(arr) { ... },
//         enumerable: false
//     });
//
// Object.defineProperty setzt jedes nicht genannte Attribut auf false. Damit
// ist Array.prototype.xor weder beschreibbar noch konfigurierbar — und zwar
// fuer die gesamte Lebensdauer der Seite. Es laesst sich weder loeschen
// (delete gibt false) noch neu definieren ("Cannot redefine property: xor").
// Nachgemessen, nicht vermutet.
//
// Cytoscape legt seinen Collection-Prototyp mit Object.create(Array.prototype)
// an, damit Collections sich array-artig verhalten, und setzt darauf per
// Object.assign sein eigenes xor (die symmetrische Differenz — inhaltlich
// dieselbe Idee wie der Zabbix-Helfer). Eine Zuweisung geht aber ueber [[Set]],
// und [[Set]] darf eine nicht beschreibbare geerbte Eigenschaft im Strict Mode
// nicht ueberschatten. Ergebnis:
//
//     TypeError: Cannot assign to read only property 'xor' of object
//
// Cytoscape bricht dabei komplett ab: window.cytoscape bleibt undefined, die
// Karte ist leer, und im Modulcode taucht kein einziger Fehler auf — weil der
// Modulcode nie an die Reihe kommt. Genau dieses Bild hatte der Bericht.
//
// Betroffen ist jeder Browser (in Chrome und Safari gegengeprueft), denn es ist
// kein Engine-Bug, sondern korrektes ES-Verhalten.
//
// DIE LOESUNG
// -----------
// Object.defineProperty legt eine EIGENE Eigenschaft an und schaut die
// Prototypkette gar nicht erst an — im Gegensatz zur Zuweisung. Wir tauschen
// Object.assign also fuer die Dauer des Cytoscape-Ladens gegen eine Variante,
// die bei einem Fehlschlag auf defineProperty ausweicht, und stellen das
// Original unmittelbar danach wieder her.
//
// Bewusst eng gefasst:
//   - Der Patch steht nur zwischen on() und off(), nicht dauerhaft. Ein global
//     ersetztes Object.assign waere langsamer und in Randfaellen (werfende
//     Getter) anders — das wollen wir Zabbix' eigenem Code nicht antun.
//   - Der Zabbix-Helfer bleibt unangetastet: [1,2,3].xor([2,3,4]) liefert
//     weiterhin [1,4]. Beide Implementierungen existieren nebeneinander, weil
//     Cytoscape seine als eigene Eigenschaft auf seinem Prototyp bekommt.
//   - Kein Cytoscape-Update noetig. Ein Patch an der minifizierten Bibliothek
//     waere bei jedem Upgrade wieder faellig; das hier ueberlebt Upgrades.
//
// Wird sowohl von views/network.topology.view.php als auch vom Widget-Loader
// (widget/assets/js/widget.class.js) genutzt — deshalb eine eigene Datei statt
// zweimal derselben 25 Zeilen.

(function (global) {
    'use strict';

    var original = null;
    var depth = 0;

    /**
     * Liegt der kaputte Deskriptor ueberhaupt vor?
     *
     * Das ist die Zusicherung fuer alle anderen Versionen: Zabbix 7.0 legt den
     * Helfer per schlichter Zuweisung an (common.js:114,
     * "Array.prototype.xor = function..."), und eine Zuweisung erzeugt
     * writable/configurable = true. Cytoscape ueberschattet die Eigenschaft
     * dort ohne Weiteres — nachgemessen im offiziellen 7.0-Image.
     *
     * Erst Zabbix 8 nutzt Object.defineProperty ohne diese beiden Attribute.
     * Nur dann fasst dieser Guard Object.assign an. Auf jeder Version, deren
     * Deskriptor anders aussieht — 7.0, 7.4, und auch ein kuenftiges 8.x, das
     * es repariert —, laeuft der Code identisch zu dem ohne Guard, weil gar
     * nichts ersetzt wird. Wir muessen also nicht wissen, was andere Versionen
     * tun; wir pruefen die eine Bedingung, die den Fehler ausmacht.
     */
    function needed() {
        if (typeof Object.getOwnPropertyDescriptor !== 'function') return false;
        var d;
        try { d = Object.getOwnPropertyDescriptor(Array.prototype, 'xor'); }
        catch (e) { return false; }
        return !!d && d.writable === false && d.configurable === false;
    }

    function safeAssign(target) {
        if (target === null || target === undefined) {
            throw new TypeError('Cannot convert undefined or null to object');
        }
        var to = Object(target);

        for (var i = 1; i < arguments.length; i++) {
            var source = arguments[i];
            if (source === null || source === undefined) continue;
            var from = Object(source);

            // Object.assign kopiert eigene, aufzaehlbare Keys — Strings und
            // Symbole. Object.keys deckt nur die Strings ab, die Symbole
            // holen wir separat und filtern sie auf aufzaehlbar.
            var keys = Object.keys(from);
            if (Object.getOwnPropertySymbols) {
                var symbols = Object.getOwnPropertySymbols(from);
                for (var s = 0; s < symbols.length; s++) {
                    if (Object.prototype.propertyIsEnumerable.call(from, symbols[s])) {
                        keys.push(symbols[s]);
                    }
                }
            }

            for (var k = 0; k < keys.length; k++) {
                var key = keys[k];
                try {
                    to[key] = from[key];
                }
                catch (e) {
                    // Der einzige erwartete Fall: eine geerbte, nicht
                    // beschreibbare Eigenschaft blockiert [[Set]].
                    // defineProperty legt sie als eigene an und kommt daran
                    // vorbei. Schlaegt auch das fehl, ist das Ziel selbst
                    // eingefroren — dann darf der Fehler durch.
                    Object.defineProperty(to, key, {
                        value:        from[key],
                        writable:     true,
                        enumerable:   true,
                        configurable: true
                    });
                }
            }
        }
        return to;
    }

    global.NT_ASSIGN_GUARD = {
        /**
         * Patch aktivieren — aber nur, wenn needed() den kaputten Deskriptor
         * findet. Verschachtelte Aufrufe zaehlen mit: zwei Widgets auf einem
         * Dashboard laden nacheinander, und ohne Zaehler haette das erste
         * off() den Patch mitten im zweiten Ladevorgang entfernt.
         */
        on: function () {
            if (typeof Object.assign !== 'function') return;
            if (!original && !needed()) return;
            depth++;
            if (original) return;
            original = Object.assign;
            Object.assign = safeAssign;
        },

        /** Original wiederherstellen, sobald der letzte Aufrufer fertig ist. */
        off: function () {
            if (!original) return;
            depth--;
            if (depth > 0) return;
            depth = 0;
            Object.assign = original;
            original = null;
        },

        /** Nur fuer Diagnose/Test: greift der Guard auf dieser Zabbix-Version? */
        applies: needed
    };
})(typeof window !== 'undefined' ? window : this);
