// edge-detail.js — Detail-Panel fuer eine KANTE, nach Klick darauf.
//
// WARUM ES DAS BRAUCHT
// --------------------
// Kanten trugen ihre Daten seit jeher mit — Ports beider Enden, Traffic,
// Kapazitaet, Interface-Health — und es gab **keinen einzigen Klick-Handler
// auf Kanten**. Nur Knoten hatten ein Kontextmenue und ein Panel. Sichtbar war
// das alles ausschliesslich im Hover-Tooltip: der verschwindet beim ersten
// Mausschubser, man kann nichts daraus kopieren und nichts darin anklicken.
//
// Dieses Panel zeigt dieselben Daten bleibend, mit Platz fuer das, wofuer im
// Tooltip keiner war: die Interface-Health aufgeschluesselt statt als
// Aggregat, die Herkunft der Kante, und — der eigentliche Punkt — eine
// ehrliche Auskunft darueber, WOHER die Traffic-Zahl stammt.
//
// DER VORBEHALT, DER HIER SICHTBAR WIRD
// -------------------------------------
// Eine Kante bekommt ihre Port-Metrik nur, wenn das Backend sie einer Seite
// zuordnen konnte (perLink). Das setzt `lldpRemLocalPortNum == ifIndex`
// voraus — auf Aruba/ProCurve stimmt das 1:1, anderswo nicht. Ist es nicht so,
// zeigt die Karte die SCHAETZUNG aus den Knotensummen (halbiert), und das sah
// bisher genauso aus wie eine echte Messung.
//
// In einer Ansicht, deren Zweck Portdetails sind, faellt das viel staerker auf
// als im bisherigen Beiwerk. Deshalb sagt das Panel es hin: "am Port gemessen"
// gegen "geschaetzt", und wo Ports gemeldet sind, aber keine Metrik zugeordnet
// werden konnte, steht daneben warum. Eine Zahl ohne ihre Herkunft ist hier
// schlimmer als keine Zahl.
//
// WARUM DOM STATT innerHTML
// -------------------------
// Der Bestand baut sein HTML per String-Konkatenation, und die ~100 daraus
// entstandenen Sinks sind in eslint-suppressions.json gebaselined. Fuer NEUEN
// Code ist das ausdruecklich nicht der Weg — die beiden Widgets aus 5.1.0
// bauen deshalb mit createElement/textContent und brauchen keinen Eintrag.
// Hier dasselbe: Portnamen kommen von FREMDEN Geraeten ueber LLDP/CDP, und
// ueber textContent gibt es die Escaping-Frage gar nicht erst.

import { fmt } from './utils.js';
import { t } from './i18n.js';
import { utilizationColor } from './traffic.js';

// Schwellen wie in traffic.js — Errors/Discards sind nach Zabbix-Preprocessing
// 'change per second', 1 Error/s ist bereits viel.
const ERR_THRESHOLD  = 1;
const DROP_THRESHOLD = 5;

function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css)  e.style.cssText = css;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
}

function section(parent, label) {
    parent.appendChild(el('div',
        'font-size:9px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;'
        + 'color:#94a3b8;margin:9px 0 4px;border-top:1px solid #f1f5f9;padding-top:6px', label));
}

/** Beschriftete Zeile. `value` ist Text; `valueEl` erlaubt eigene Auszeichnung. */
function row(parent, label, value, valueEl) {
    const r = el('div', 'display:flex;gap:8px;font-size:11px;margin-bottom:3px');
    r.appendChild(el('span', 'color:#94a3b8;min-width:88px;flex-shrink:0', label));
    if (valueEl) { valueEl.style.color = valueEl.style.color || '#475569'; r.appendChild(valueEl); }
    else         { r.appendChild(el('span', 'color:#475569', value)); }
    parent.appendChild(r);
}

function pill(text, col, tip) {
    const p = el('span',
        'display:inline-block;padding:1px 6px;border-radius:9px;background:' + col + '22;'
        + 'color:' + col + ';font-size:9px;font-weight:700;letter-spacing:0.04em;'
        + 'text-transform:uppercase', text);
    if (tip) p.title = tip;
    return p;
}

function hint(parent, text) {
    parent.appendChild(el('div',
        'font-size:10px;color:#92400e;background:rgba(245,158,11,0.10);border-radius:5px;'
        + 'padding:5px 7px;margin-top:5px;line-height:1.45', text));
}

/**
 * Baut das Panel fuer eine Kante.
 *
 * `ed` ist das Cytoscape-Edge-Objekt, nicht nur .data() — die Endpunkte kommen
 * ueber source()/target(), deren Labels stehen nicht an der Kante.
 */
export function showEdgeDetail(panel, ed) {
    const d  = ed.data();
    const s  = ed.source(), tg = ed.target();
    const sLbl = (s && s.data('label')) || (s && s.id()) || '?';
    const tLbl = (tg && tg.data('label')) || (tg && tg.id()) || '?';

    // Drei Sorten Kante, und sie tragen voellig verschiedene Daten: LLDP/CDP
    // hat Ports und Metrik, eine manuelle hat nichts davon, eine Ghost-Kante
    // fuehrt zu einem Geraet, das Zabbix gar nicht kennt.
    const istManuell = String(d.id || '').indexOf('ml_') === 0;
    const istGhost   = !!d._isGhostEdge;
    const quellen    = Array.isArray(d.src) ? d.src : [];

    panel.style.display = 'block';
    panel.textContent = '';

    // ── Kopf ────────────────────────────────────────────────────────────────
    const head = el('div', 'display:flex;align-items:center;gap:7px;margin-bottom:2px');
    const title = el('div',
        'flex:1;min-width:0;font-size:13px;font-weight:600;color:#0f172a;'
        + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
    title.appendChild(el('span', '', sLbl));
    title.appendChild(el('span', 'color:#94a3b8;margin:0 4px', '↔'));
    title.appendChild(el('span', '', tLbl));
    head.appendChild(title);

    const close = el('button',
        'background:none;border:none;cursor:pointer;color:#94a3b8;font-size:18px;'
        + 'line-height:1;padding:0;flex-shrink:0', '✕');
    close.addEventListener('click', function(e) {
        e.stopPropagation();
        panel.style.display = 'none';
    });
    head.appendChild(close);
    panel.appendChild(head);

    // ── Herkunft ────────────────────────────────────────────────────────────
    // Die Protokollnamen stehen als Literale da, statt d.src durchzureichen:
    // der Satz ist geschlossen, das Backend meldet 'lldp' und 'cdp'. Ein
    // Zugehoerigkeitstest ist besser als escapen — so gelangt gar nichts
    // Fremdes in die Ausgabe.
    const srcRow = el('div', 'display:flex;gap:4px;margin-bottom:2px');
    if (istManuell) {
        srcRow.appendChild(pill(t('edge.src.manual'), '#7c3aed', t('edge.src.manual.tip')));
    } else if (istGhost) {
        srcRow.appendChild(pill(t('edge.src.ghost'), '#94a3b8', t('edge.src.ghost.tip')));
    } else {
        if (quellen.indexOf('lldp') >= 0) srcRow.appendChild(pill('LLDP', '#16a34a', ''));
        if (quellen.indexOf('cdp')  >= 0) srcRow.appendChild(pill('CDP',  '#16a34a', ''));
    }
    if (!srcRow.childNodes.length) srcRow.appendChild(el('span', 'color:#94a3b8', '—'));

    // Beidseitig bestaetigt oder nur von einer Seite gesehen. Das ist die
    // ehrlichste Auskunft, die diese Karte ueber eine Kante geben kann: bis
    // hierher sah jede Verbindung gleich sicher aus, obwohl die eine von
    // beiden Enden bestaetigt wird und die andere auf einer einzigen Meldung
    // beruht. Bei manuellen und Ghost-Kanten sagt das nichts — dort weggelassen.
    if (!istManuell && !istGhost && Array.isArray(d.reporters) && d.reporters.length) {
        if (d.confirmed) {
            srcRow.appendChild(pill('\u2713 ' + t('edge.confirmed'), '#16a34a',
                t('edge.confirmed.tip')));
        } else {
            const wer = ed.cy().getElementById(String(d.reporters[0]));
            const name = (wer && wer.length && wer.data('label')) || '';
            srcRow.appendChild(pill('\u2192 ' + t('edge.onesided'), '#f59e0b',
                name ? t('edge.onesided.tip_named', { host: name }) : t('edge.onesided.tip')));
        }
    }
    // Sicherheit der Zuordnung. Die Farbe folgt derselben Logik wie ueberall
    // sonst im Modul: gruen heisst nicht "gut", sondern "belegt".
    if (!istManuell && !istGhost && typeof d.confidence === 'number') {
        const c = d.confidence;
        const col = c >= 80 ? '#16a34a' : (c >= 50 ? '#f59e0b' : '#c2410c');
        const wie = d.matchKind ? t('edge.match.' + d.matchKind) : '';
        srcRow.appendChild(pill(c + '%', col,
            wie ? t('edge.confidence.tip', { how: wie }) : t('edge.confidence.tip_plain')));
    }
    panel.appendChild(srcRow);

    // ── Ports ───────────────────────────────────────────────────────────────
    const pS = d.portSrc || '', pT = d.portTgt || '';
    section(panel, t('edge.sec.ports'));
    if (pS || pT) {
        row(panel, sLbl, null, el('b', '', pS || '?'));
        row(panel, tLbl, null, el('b', '', pT || '?'));
    } else {
        panel.appendChild(el('div', 'font-size:11px;color:#94a3b8',
            (istManuell || istGhost) ? t('edge.ports.none_kind') : t('edge.ports.none')));
    }

    // ── Traffic, mit der Herkunft der Zahl ──────────────────────────────────
    const tIn = d.trafficIn || 0, tOut = d.trafficOut || 0;
    const cap = d.capBps || 0;
    section(panel, t('edge.sec.traffic'));

    if (!tIn && !tOut && !cap) {
        panel.appendChild(el('div', 'font-size:11px;color:#94a3b8', t('edge.traffic.none')));
    } else {
        const live = el('div',
            'display:flex;gap:12px;font-size:12px;margin-bottom:5px;align-items:center');
        [['↓', '#06b6d4', tIn], ['↑', '#f97316', tOut]].forEach(function(pair) {
            const w = el('span');
            w.appendChild(el('span', 'color:' + pair[1], pair[0]));
            w.appendChild(document.createTextNode(' '));
            w.appendChild(el('b', '', fmt(pair[2])));
            live.appendChild(w);
        });
        live.appendChild(d.perLink
            ? pill(t('edge.metric.perlink'),  '#16a34a', t('edge.metric.perlink.tip'))
            : pill(t('edge.metric.estimate'), '#f59e0b', t('edge.metric.estimate.tip')));
        panel.appendChild(live);

        if (cap > 0) {
            // Dieselbe Rechnung wie in traffic.js: die Knotensumme zaehlt beide
            // Richtungen, die Per-Link-Metrik ist bereits der Portwert.
            const pct = Math.min(999, (Math.max(tIn, tOut) / (d.perLink ? 1 : 2) / cap) * 100);
            const v = el('span');
            v.appendChild(el('b', 'color:' + utilizationColor(pct), pct.toFixed(1) + '%'));
            v.appendChild(document.createTextNode(' '));
            v.appendChild(el('span', 'color:#94a3b8', t('edge.of', { cap: fmt(cap) })));
            row(panel, t('edge.util'), null, v);
        } else {
            row(panel, t('edge.util'), null, el('span', 'color:#94a3b8', t('edge.cap.unknown')));
        }

        // Ports gemeldet, aber keine Metrik zugeordnet — genau der Fall, den
        // der Vorbehalt im Kopf beschreibt. Ohne diesen Hinweis sieht die
        // Schaetzung aus wie eine Messung am Port.
        if (!d.perLink && (pS || pT)) hint(panel, t('edge.metric.why_estimate'));
    }

    // ── Interface-Zustand ───────────────────────────────────────────────────
    //
    // ZWEI EBENEN, und sie auseinanderzuhalten ist der Punkt. Die erste
    // Fassung dieses Panels zeigte ifaceErr/ifaceDrop unter der Ueberschrift
    // "Interface health", als beschrieben sie DIESEN Link. Sie tun es nicht:
    // es ist ein Host-Aggregat ueber ALLE Interfaces beider Endpunkte, gebaut
    // fuer die Kantenfaerbung. Ein Switch mit einem einzigen defekten Uplink
    // trug damit an jeder seiner Kanten dieselbe Fehlerrate — dieselbe Sorte
    // Halbwahrheit wie die geschaetzte Traffic-Zahl darueber.
    //
    // portErr/portDrop sind die Werte am tatsaechlichen Port. Liegen sie vor,
    // stehen sie oben und das Aggregat darunter, ausdruecklich als
    // "hostweit" beschriftet.
    const down  = d.ifaceDown || 0;
    const ratio = d.ifaceDownRatio || 0;
    const errs  = d.ifaceErr || 0;
    const drops = d.ifaceDrop || 0;
    const pErr  = (d.portErr  === null || d.portErr  === undefined) ? null : d.portErr;
    const pDrop = (d.portDrop === null || d.portDrop === undefined) ? null : d.portDrop;

    if (pErr !== null || pDrop !== null) {
        section(panel, t('edge.sec.port_health'));
        [[t('edge.errors'), pErr, ERR_THRESHOLD], [t('edge.discards'), pDrop, DROP_THRESHOLD]]
            .forEach(function(m) {
                if (m[1] === null) return;
                const v = el('span');
                v.appendChild(el('b', 'color:' + (m[1] > m[2] ? '#c2410c' : '#475569'), m[1].toFixed(2)));
                v.appendChild(document.createTextNode(' '));
                v.appendChild(el('span', 'color:#94a3b8', t('edge.threshold', { n: m[2] })));
                row(panel, m[0], null, v);
            });
    }

    if (down || errs || drops) {
        section(panel, t('edge.sec.health'));
        // Ohne diese Zeile liest sich das Aggregat wie eine Aussage ueber den
        // Link. Sie steht bewusst VOR den Zahlen.
        panel.appendChild(el('div',
            'font-size:10px;color:#94a3b8;line-height:1.4;margin-bottom:4px',
            t('edge.health.hostwide')));
        if (down) {
            const v = el('span');
            v.appendChild(el('b', '', String(down)));
            v.appendChild(document.createTextNode(' '));
            v.appendChild(el('span', 'color:#94a3b8', '(' + Math.round(ratio * 100) + '%)'));
            row(panel, t('edge.down'), null, v);
        }
        [[t('edge.errors'), errs, ERR_THRESHOLD], [t('edge.discards'), drops, DROP_THRESHOLD]]
            .forEach(function(m) {
                if (!m[1]) return;
                const v = el('span');
                v.appendChild(el('b', 'color:' + (m[1] > m[2] ? '#c2410c' : '#475569'), m[1].toFixed(2)));
                v.appendChild(document.createTextNode(' '));
                v.appendChild(el('span', 'color:#94a3b8', t('edge.threshold', { n: m[2] })));
                row(panel, m[0], null, v);
            });
    }
}
