// graphml.js — die Topologie als GraphML herausgeben.
//
// WARUM
// -----
// Exportiert wurden bisher PNG, PDF und HTML: Bilder und Berichte. Alle drei
// sind Endstationen — man kann sie ansehen und ablegen, aber nicht weiter
// verarbeiten. Was in Ops-Teams als Erstes gefragt wird, ist der Weg IN ein
// anderes Werkzeug hinein: die entdeckte Verkabelung in die Netzdokumentation
// uebernehmen, ohne sie abzutippen.
//
// GraphML statt eines eigenen draw.io-Formats: draw.io importiert GraphML
// direkt (Extras -> Importieren), yEd ebenfalls, Gephi und NetworkX auch. Ein
// Format, vier Ziele — ein zweiter Exporter waere doppelte Pflege fuer nichts.
//
// Die Positionen fahren mit. Ohne sie wirft das Zielwerkzeug ein eigenes Layout
// darueber, und genau die Anordnung, die jemand von Hand gelegt und geteilt
// hat, waere weg — also das, was den Export ueberhaupt lohnend macht.

import { esc } from './utils.js';

/**
 * XML 1.0 erlaubt Tab, LF und CR, sonst KEINE Steuerzeichen unter 0x20 — und
 * 0x7F-0x9F sind ebenfalls unzulaessig. Host- und vor allem Portnamen kommen
 * ueber LLDP/CDP von FREMDEN Geraeten; ein einziges solches Byte macht die
 * Datei unlesbar, und der Parser im Zielwerkzeug meldet dann einen Fehler in
 * Zeile 400 statt "dein Switch schickt Muell".
 *
 * esc() deckt die fuenf Entities ab, aber nicht diesen Fall — deshalb hier.
 */
function xmlText(v) {
    // Erlaubt bleiben Tab (09), LF (0A) und CR (0D); verworfen wird alles
    // andere unter 0x20 sowie 0x7F-0x9F. Als Escape-Sequenzen geschrieben:
    // echte Steuerzeichen im Quelltext sieht niemand, und genau das ist der
    // Fehler, den diese Funktion verhindern soll.
    const STEUER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
    return esc(String(v == null ? '' : v).replace(STEUER, ''));
}

/**
 * Ein <key>-Element der GraphML-Kopfzeile.
 *
 * Die vier Werte kommen aus NODE_KEYS/EDGE_KEYS, sind also ASCII-Konstanten
 * aus dieser Datei — Steuerzeichen kann es hier nicht geben, deshalb reicht
 * esc() und es braucht kein xmlText().
 *
 * Dass esc() woertlich auf der Zeile steht, ist zusaetzlich Absicht: check-xss
 * ist ein grep-Stolperdraht und befreit eine Zeile nur, wenn 'esc(' darauf
 * vorkommt. Eine Hilfsfunktion davorzuschalten wuerde das Escaping vor dem
 * Gate verstecken — und sie so zu benennen, dass der grep zufrieden ist, waere
 * das Austricksen, das dieses Gate gerade verhindern soll.
 */
function keyDef(id, forWhat, name, type) {
    return '  <key id="' + esc(id) + '" for="' + esc(forWhat)
        + '" attr.name="' + esc(name) + '" attr.type="' + esc(type) + '"/>';
}

/** Ein <data>-Element, aber nur wenn wirklich etwas drinsteht. */
function dataEl(id, value) {
    if (value === undefined || value === null || value === '') return '';
    return '      <data key="' + id + '">' + xmlText(value) + '</data>\n';
}

const NODE_KEYS = [
    ['n_label',    'label',     'string'],
    ['n_host',     'host',      'string'],
    ['n_ip',       'ip',        'string'],
    ['n_type',     'devicetype','string'],
    ['n_group',    'hostgroup', 'string'],
    ['n_severity', 'severity',  'int'],
    ['n_monitored','monitored', 'boolean'],
    ['n_x',        'x',         'double'],
    ['n_y',        'y',         'double'],
];

const EDGE_KEYS = [
    ['e_srcport',  'sourceport', 'string'],
    ['e_tgtport',  'targetport', 'string'],
    ['e_proto',    'protocol',   'string'],
    ['e_speed',    'capacitybps','double'],
    ['e_in',       'trafficin',  'double'],
    ['e_out',      'trafficout', 'double'],
];

/**
 * Baut das GraphML-Dokument aus der laufenden Cytoscape-Instanz.
 * Gibt null zurueck, wenn es nichts zu exportieren gibt.
 */
export function buildGraphml(cy) {
    if (!cy) return null;

    // '[!isGroup]' laesst die Gruppen-Aggregate weg: sie sind eine
    // Darstellungsform dieser Karte, kein Geraet, und in einer
    // Netzdokumentation waeren sie irrefuehrend.
    //
    // Ghost-Knoten bleiben ABSICHTLICH drin. Ein per LLDP gemeldeter Nachbar
    // ohne Host in Zabbix ist trotzdem ein Geraet am Kabel — fuer eine
    // Dokumentation ist gerade er interessant, weil er dort fehlt. Damit das
    // Zielwerkzeug ihn unterscheiden kann, traegt jeder Knoten 'monitored'.
    const nodes = cy.nodes('[!isGroup]');
    if (!nodes.length) return null;

    const drin = {};
    nodes.forEach(function(n) { drin[n.id()] = true; });

    let out = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<graphml xmlns="http://graphml.graphdrawing.org/xmlns"\n'
        + '         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n'
        + '         xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns'
        + ' http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">\n'
        + '  <!-- Network Topology for Zabbix — exported ' + xmlText(new Date().toISOString()) + ' -->\n';

    NODE_KEYS.forEach(function(k) { out += keyDef(k[0], 'node', k[1], k[2]) + '\n'; });
    EDGE_KEYS.forEach(function(k) { out += keyDef(k[0], 'edge', k[1], k[2]) + '\n'; });

    // Ungerichtet: eine Kabelverbindung hat keine Richtung, und die Kanten
    // liegen sortiert vor (siehe ManualLinks) — ein gerichteter Graph wuerde
    // im Zielwerkzeug Pfeilspitzen erfinden, die es nicht gibt.
    out += '  <graph id="G" edgedefault="undirected">\n';

    nodes.forEach(function(n) {
        const d = n.data();
        const p = n.position();
        out += '    <node id="' + xmlText(n.id()) + '">\n'
            + dataEl('n_label',    d.label)
            + dataEl('n_host',     d.host)
            + dataEl('n_ip',       d.ip)
            + dataEl('n_type',     d.type)
            + dataEl('n_group',    d._primaryGroup)
            + dataEl('n_severity', d.severity)
            + dataEl('n_monitored', d._isGhost ? 'false' : 'true')
            + dataEl('n_x', Number.isFinite(p.x) ? Math.round(p.x) : 0)
            + dataEl('n_y', Number.isFinite(p.y) ? Math.round(p.y) : 0)
            + '    </node>\n';
    });

    let eIdx = 0;
    cy.edges().forEach(function(ed) {
        const sId = ed.source().id(), tId = ed.target().id();
        // Kanten zu weggelassenen Knoten wuerden das Dokument ungueltig machen:
        // GraphML verlangt, dass source und target vorher deklariert sind.
        if (!drin[sId] || !drin[tId]) return;
        const d = ed.data();
        const proto = Array.isArray(d.src) && d.src.length
            ? d.src.join('+')
            : (String(d.id || '').indexOf('ml_') === 0 ? 'manual' : '');
        out += '    <edge id="e' + (eIdx++) + '" source="' + xmlText(sId)
            + '" target="' + xmlText(tId) + '">\n'
            + dataEl('e_srcport', d.portSrc)
            + dataEl('e_tgtport', d.portTgt)
            + dataEl('e_proto',   proto)
            + dataEl('e_speed',   d.capBps || '')
            + dataEl('e_in',      d.trafficIn  || '')
            + dataEl('e_out',     d.trafficOut || '')
            + '    </edge>\n';
    });

    out += '  </graph>\n</graphml>\n';
    return out;
}
