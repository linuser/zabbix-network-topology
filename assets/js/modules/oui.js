// oui.js — aus der Chassis-ID eines Nachbarn den Hersteller lesen.
//
// WOZU
// ----
// Ein unueberwachter Nachbar meldet ueber LLDP seine Chassis-ID, und das ist
// fast immer eine MAC. Deren erste drei Bytes sind die Hersteller-Kennung.
// Damit wird aus "unbekanntes Geraet an sw-og-2, Port 8" ein
// "Ubiquiti-Geraet an sw-og-2, Port 8" — oft schon die Antwort auf "was
// steckt da eigentlich", und ohne eine einzige neue Abfrage: die Chassis-ID
// liegt seit 5.4 in jedem Geist.
//
// DIE TABELLE IST NICHT IM BUNDLE
// -------------------------------
// oui-table.json wird beim ERSTEN Nachschlagen geholt und danach im Modul
// behalten; der Browser hat sie ohnehin im Cache (die Modul-Assets kommen mit
// vierzehn Tagen Cache-Header). Wer nie einen Geist ansieht, laedt sie nie.
//
// WAS OHNE TABELLE SCHON FESTSTEHT
// --------------------------------
// Zwei Bits im ERSTEN Byte beantworten die Frage manchmal ohne jede Liste:
//
//   Bit 0 (0x01) gesetzt -> Multicast. Keine Geraeteadresse.
//   Bit 1 (0x02) gesetzt -> LOKAL VERGEBEN. Diese Adresse hat per Definition
//                           keinen Hersteller: sie stammt aus einer VM, einer
//                           zufallsgenerierten MAC oder einem Generator.
//
// Das ist eine echte Auskunft und keine Luecke — "lokal vergeben" sagt, dass
// hier kein Geraet mit Typenschild haengt. In der Tabelle nachzusehen waere
// sinnlos, und ein Treffer dort waere sogar falsch.

import { buildBaseUrl } from './utils.js';

let _tabelle = null;     // { v: { Hersteller: "oui1oui2…" } }
let _laden   = null;     // laufendes Versprechen, damit nicht zehnmal geholt wird
let _index   = null;     // OUI -> Hersteller, beim ersten Zugriff aufgebaut

/**
 * Die ersten drei Bytes als sechs Hex-Zeichen — oder ''.
 *
 * Die Schreibweisen kommen so aus dem Feld, wie das Geraet sie liefert:
 * "3C EC EF 79 2C 88" (Zabbix' SNMP-Hex-Form), "3c:ec:ef:79:2c:88",
 * "3cecef792c88". Alles andere — ein Name, eine IP als Chassis-ID, ein
 * Bruchstueck — ergibt '' statt eines geratenen Praefixes.
 */
export function ouiVon(chassis) {
    const hex = String(chassis || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    // Genau 12 Zeichen: eine MAC. Kuerzer ist kein vollstaendiger Bezeichner,
    // laenger ist etwas anderes (manche Geraete melden eine lange ID als
    // Chassis). In beiden Faellen lieber nichts sagen.
    if (hex.length !== 12) return '';
    return hex.slice(0, 6);
}

/** Lokal vergebene Adresse? Dann gibt es per Definition keinen Hersteller. */
export function istLokal(chassis) {
    const o = ouiVon(chassis);
    if (!o) return false;
    return (parseInt(o.slice(0, 2), 16) & 0x02) !== 0;
}

/** Multicast-Adresse? Keine Geraeteadresse. */
export function istMulticast(chassis) {
    const o = ouiVon(chassis);
    if (!o) return false;
    return (parseInt(o.slice(0, 2), 16) & 0x01) !== 0;
}

/**
 * Was ohne Tabelle schon feststeht.
 *
 * 'lokal' | 'multicast' | 'unbrauchbar' | 'suchen'
 */
export function vorbefund(chassis) {
    if (!ouiVon(chassis)) return 'unbrauchbar';
    if (istMulticast(chassis)) return 'multicast';
    if (istLokal(chassis)) return 'lokal';
    return 'suchen';
}

/** Die Tabelle holen (einmal). */
function tabelle() {
    if (_tabelle) return Promise.resolve(_tabelle);
    if (_laden) return _laden;
    _laden = fetch(buildBaseUrl() + 'modules/network_topology/assets/js/modules/oui-table.json',
        { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
            _tabelle = (d && d.v) ? d : { v: {} };
            return _tabelle;
        })
        .catch(function() { _tabelle = { v: {} }; return _tabelle; });
    return _laden;
}

/** Aus { Hersteller: "oui1oui2…" } eine Karte OUI -> Hersteller machen. */
function index() {
    if (_index) return _index;
    _index = Object.create(null);
    const v = (_tabelle && _tabelle.v) || {};
    Object.keys(v).forEach(function(name) {
        const kette = String(v[name] || '');
        for (let i = 0; i + 6 <= kette.length; i += 6) {
            _index[kette.slice(i, i + 6)] = name;
        }
    });
    return _index;
}

/**
 * Hersteller zu einer Chassis-ID.
 *
 * Liefert { zustand, hersteller } — zustand ist einer von
 * 'treffer' | 'unbekannt' | 'lokal' | 'multicast' | 'unbrauchbar'.
 *
 * 'unbekannt' heisst: die Kennung sieht aus wie eine Herstelleradresse, steht
 * aber nicht in UNSERER Auswahl. Das ist etwas anderes als 'lokal' und wird
 * auch anders angezeigt — sonst klaenge eine unvollstaendige Liste wie eine
 * Aussage ueber das Geraet.
 */
export function herstellerVon(chassis) {
    const vor = vorbefund(chassis);
    if (vor !== 'suchen') {
        return Promise.resolve({ zustand: vor, hersteller: '' });
    }
    return tabelle().then(function() {
        const name = index()[ouiVon(chassis)];
        return name
            ? { zustand: 'treffer', hersteller: name }
            : { zustand: 'unbekannt', hersteller: '' };
    });
}

/** Nur fuer Tests: den geladenen Stand setzen, ohne zu holen. */
export function _setzeTabelle(d) {
    _tabelle = d;
    _index = null;
    _laden = null;
}
