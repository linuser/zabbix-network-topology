// detail-panel.js — Detail-Panel rechts unten, das nach Klick auf einen Host
// dessen vollständige Werte und verbundene Peers anzeigt.
//
// Wird vom Tap-Handler im Render-Modul mit der Cytoscape-Node-Data gefüttert.
// Schließbar über das X oben rechts; setzt dabei alle Node-Opacities zurück
// (war zuvor durch Pfad-Highlight gedimmt).
//
// AUS ZEICHENKETTEN WURDEN ELEMENTE
// ---------------------------------
// Bis 5.4.2 baute dieses Panel seinen Inhalt als eine große HTML-Zeichenkette
// und wies sie innerHTML zu. Das war nicht falsch — jede eingesetzte Angabe
// lief durch esc() —, aber es war nur so lange richtig, wie jemand daran
// dachte. Und was hier eingesetzt wird, ist genau das, wovor die Projektregel
// warnt: Hostnamen, Notizen, IPs und vor allem LLDP/CDP-Namen und
// -Beschreibungen von FREMDEN Geräten, die niemand kontrolliert.
//
// Jetzt entsteht alles als Elemente, Text geht über textContent. Eine
// vergessene Maskierung kann es damit nicht mehr geben: Text ist Text, auch
// wenn er wie Markup aussieht. Dafür steht der Eintrag dieser Datei nicht
// mehr in eslint-suppressions.json.
//
// Die Stilangaben sind dabei ZEICHENWEISE dieselben geblieben und nur von
// der Zeichenkette an style.cssText gewandert. Das war Absicht: ein Umbau
// ohne Netz soll wenigstens nichts am Aussehen ändern, und so bleibt die
// Verschachtelung Zeile für Zeile vergleichbar.
//
// Die Ereignisse hängen jetzt direkt an den Knöpfen. Vorher wurden sie nach
// dem Zuweisen über document.getElementById('nt-detail-close') und
// querySelectorAll('button[data-act]') wieder eingesammelt — ein Umweg, den
// es nur gab, weil die Knöpfe zwischendurch Text waren.

import { el, fmt, fmtItemValue } from './utils.js';
import { SEV_COL, SEV_LBL } from './severity.js';
import { t } from './i18n.js';

// Mapping von Backend-Type-String zu deutschem Label + Emoji-Icon.
// Die Strings hier müssen mit deviceType() in NetworkTopologyData.php
// und mit $allowed_icons (Whitelist für nt:icon) konsistent sein.
const TYPE_INFO = {
    firewall:   { lbl: 'Firewall',     icon: '\u{1F525}', col: '#dc2626' },  // 🔥
    router:     { lbl: 'Router',       icon: '\u{1F4E1}', col: '#7c3aed' },  // 📡
    switch:     { lbl: 'Switch',       icon: '\u{1F500}', col: '#2563eb' },  // 🔀
    wireless:   { lbl: 'Wireless AP',  icon: '\u{1F4F6}', col: '#0891b2' },  // 📶
    server:     { lbl: 'Server',       icon: '\u{1F5A5}',  col: '#475569' },  // 🖥
    storage:    { lbl: 'Storage',      icon: '\u{1F4BE}', col: '#0e7490' },  // 💾
    hypervisor: { lbl: 'Hypervisor',   icon: '\u{1F9F1}', col: '#7c2d12' },  // 🧱
    camera:     { lbl: t('detail.type.camera'),  icon: '\u{1F4F7}', col: '#71717a' },  // 📷
    printer:    { lbl: t('detail.type.printer'), icon: '\u{1F5A8}',  col: '#52525b' },  // 🖨
    ups:        { lbl: t('detail.type.ups'),     icon: '\u{1F50B}', col: '#16a34a' },  // 🔋
    homeauto:   { lbl: 'Smart Home',   icon: '\u{1F3E0}', col: '#ea580c' },  // 🏠
    mailserver: { lbl: 'Mail-Server',  icon: '\u{2709}\u{FE0F}',  col: '#7c3aed' },  // ✉️
    webserver:  { lbl: 'Web-Server',   icon: '\u{1F310}', col: '#0d9488' },  // 🌐
    container:  { lbl: 'Container',    icon: '\u{1F4E6}', col: '#0369a1' },  // 📦
    monitoring: { lbl: 'Monitoring',   icon: '\u{1F4CA}', col: '#9333ea' },  // 📊
    linux:      { lbl: 'Linux Server', icon: '\u{1F427}', col: '#0f172a' },  // 🐧
    windows:    { lbl: 'Windows',      icon: '\u{1FA9F}', col: '#1d4ed8' },  // 🪟
    macos:      { lbl: 'macOS',        icon: '\u{1F34F}', col: '#52525b' },  // 🍏
    internet:   { lbl: 'Internet',     icon: '\u{1F30D}', col: '#3b82f6' },  // 🌍
};

function typeInfo(type) {
    return TYPE_INFO[type] || { lbl: t('detail.type.unknown'), icon: '❓', col: '#94a3b8' };  // ❓
}

/** Mehrere Kinder auf einmal anhaengen; null und '' werden uebersprungen. */
function fuege(eltern) {
    for (let i = 1; i < arguments.length; i++) {
        const k = arguments[i];
        if (k) eltern.appendChild(k);
    }
    return eltern;
}

/** Textknoten — kuerzer als document.createTextNode an zwanzig Stellen. */
function tx(s) {
    return document.createTextNode(String(s));
}

// Close the panel — and let the color guide return to its place. Every site
// that hides the panel goes through here (close X, background click in
// render-tech).
export function hideDetail(panel) {
    if (panel) panel.style.display = 'none';
    const root = document.getElementById('nt-root');
    if (root) root.classList.remove('nt-detail-open');
}

export function showDetail(panel, d, cy) {
    const sc = SEV_COL[d.severity || 0] || SEV_COL[0];
    // GEISTER SIND KEINE HOSTS. Bis hierher wurden sie wie welche behandelt:
    // eine gruene Pille "Normal" fuer ein Geraet, das gar nicht ueberwacht
    // wird, daneben leere Felder fuer CPU, Speicher und Ping. Beides ist eine
    // Aussage, die niemand gemacht hat. Die Karte selbst haelt sich laengst
    // daran (kein Severity-Ring am Geisterknoten), nur dieses Panel nicht.
    // Gemeldet mit Screenshot.
    const istGeist = !!d._isGhost;

    const ti = typeInfo(d.type);
    /** Das Sternchen hinter dem Typ, wenn das Icon von Hand gesetzt wurde. */
    const sternchen = function() {
        if (!d.icon_override) return null;
        const s = el('span', 'color:#f59e0b;font-weight:700', ' *');
        s.setAttribute('title', t('detail.custom_icon_tip'));
        return s;
    };

    // Interface-Zeile mit Proxy-Info anreichern: nach dem Iftype steht in
    // grau "via <Proxy>" oder "via grp:<Group>" — hilft beim Debuggen wenn
    // Daten fehlen weil ein Proxy down ist.
    const proxyTxt = (function() {
        const pn = d.proxy_name || '', pg = d.proxy_group_name || '';
        if (pn && pg) return ' via ' + pn + ' [grp:' + pg + ']';
        if (pn)       return ' via ' + pn;
        if (pg)       return ' via grp:' + pg;
        return '';
    })();
    const ifaceCell = function() {
        const s = el('span');
        s.appendChild(tx(d.iftype || '—'));
        if (proxyTxt) {
            s.appendChild(el('span', 'color:var(--nt-muted);font-size:11px', proxyTxt));
        }
        return s;
    };

    // Offline-Detection: wenn Host laut Zabbix unavailable ist, kennzeichnen
    // wir alle Metriken als STALE (letzter Wert vor Disconnect). Sonst sieht
    // ein toter Host mit eingefrorenem CPU 96% wie ein heisser Host aus.
    const isOff = !!d.unavailable;
    // Stale-Detection: Host scheint zwar online (unavailable=false) aber
    // letzter Item-Update liegt > 5min zurueck. Kann passieren wenn der
    // Agent zwar antwortet aber Items disabled / not-supported sind, oder
    // wenn ein Polling-Pause aktiv ist. Schwellwert: 5min
    // (300s) — typisch fuer Live-Metriken die alle 30-60s aktualisiert werden.
    const STALE_S = 300;
    const nowSec = Math.floor(Date.now() / 1000);
    const ageSec = (d.last_seen && d.last_seen > 0) ? (nowSec - d.last_seen) : 0;
    const isStale = !isOff && d.last_seen > 0 && ageSec > STALE_S;
    const offColor = '#9ca3af';   // grey-500
    const staleStyle = (isOff || isStale)
        ? 'opacity:0.55;text-decoration:line-through;' + 'text-decoration-style:wavy;'
        : '';
    /** Metrikwert durchstreichen und "(stale)" dahinter, wenn er alt ist. */
    const fmtMetric = function(innen) {
        if (!(isOff || isStale)) return innen;
        const wrap = el('span');
        fuege(wrap, fuege(el('span', staleStyle), innen),
                    el('span', 'color:' + offColor + ';font-size:10px', ' (stale)'));
        return wrap;
    };

    // Card-Sections: Detail-Panel als sequenz von kleinen Sections statt
    // einer flachen Rows-Tabelle. Macht den Inhalt strukturierter und gibt
    // Raum fuer logische Hierarchie (Status oben, Identitaet, Metriken,
    // Custom Items, Peers).
    //
    // Section-Helper: kleines Uppercase-Header-Label + duenne Trennlinie,
    // standardisiertes Format quer durch alle Sections.
    const section = function(label) {
        return el('div', 'margin-top:10px;padding-top:6px;'
            + 'border-top:1px solid var(--nt-line-soft);'
            + 'font-size:10px;color:var(--nt-muted);font-weight:700;'
            + 'text-transform:uppercase;letter-spacing:0.06em;'
            + 'margin-bottom:6px', label);
    };

    /** Die farbige Pille mit einem Punkt davor — Status wie Severity. */
    const pille = function(stil, punktStil, text) {
        const p = el('span', 'display:inline-flex;align-items:center;gap:4px;'
            + 'padding:3px 10px;border-radius:11px;' + stil
            + 'font-size:12px;font-weight:700');
        fuege(p, el('span', 'width:8px;height:8px;border-radius:50%;' + punktStil
            + 'display:inline-block'), tx(text));
        return p;
    };

    // Status-Pille (gross + prominent) — Offline > Stale > Severity Hierarchie
    const statusPill = istGeist
        ? pille('background:rgba(148,163,184,0.16);color:var(--nt-muted);',
                'border:2px dashed currentColor;', t('detail.ghost.status'))
        : isOff
        ? pille('background:rgba(229,55,66,0.13);color:#e53742;',
                'background:#e53742;', 'OFFLINE')
        : isStale
        ? pille('background:rgba(245,158,11,0.13);color:var(--nt-warn-text);',
                'background:#f59e0b;', 'STALE')
        : pille('background:' + sc + '22;color:' + sc + ';',
                'background:' + sc + ';', SEV_LBL[d.severity || 0] || 'Normal');

    // Status-Badges (Pinned, Wartung, Acked, Note) als kleine Chips daneben
    const chip = function(stil, text, titel) {
        const c = el('span', stil + 'font-size:10px;font-weight:600;'
            + 'padding:2px 7px;border-radius:9px', text);
        if (titel) c.setAttribute('title', titel);
        return c;
    };
    const badges = [];
    if (d.pinned) {
        badges.push(chip('background:rgba(59,130,246,0.13);color:#3b82f6;',
            '\u{1F4CC} ' + t('detail.badge.pinned')));
    }
    if (d.maintenance) {
        badges.push(chip('background:rgba(245,158,11,0.13);color:var(--nt-warn-text);',
            '\u{1F527} ' + t('detail.badge.maintenance')));
    }
    if (d.acknowledged) {
        badges.push(chip('background:rgba(34,197,94,0.13);color:var(--nt-ok-text);',
            '✔ Acked'));
    }
    if (d.note) {
        badges.push(chip('background:rgba(245,158,11,0.13);color:var(--nt-warn-text);',
            '\u{1F3F7} ' + t('detail.badge.note'), d.note));
    }

    // Identitaets-Section (Host, Type, IP, Interface) — kompakte Key-Value-Liste
    //
    // v nimmt Text ODER einen Knoten. Text geht ueber textContent und kann
    // damit kein Markup mehr sein — genau darum ging der Umbau.
    const idRow = function(k, v) {
        const row = el('div', 'display:flex;font-size:12px;line-height:1.4;'
            + 'padding:1px 0');
        const wert = el('span', 'color:var(--nt-text-2);font-weight:500;'
            + 'overflow:hidden;text-overflow:ellipsis');
        if (typeof v === 'string') wert.textContent = v; else fuege(wert, v);
        fuege(row, el('span', 'color:var(--nt-sub);min-width:72px;flex-shrink:0', k), wert);
        return row;
    };
    /** Die Typ-Zelle: fettes Icon + Label in der Typfarbe. */
    const typZelle = function(mitStern) {
        const s = el('span');
        fuege(s, el('b', 'color:' + ti.col, ti.icon + ' ' + ti.lbl),
                 mitStern ? sternchen() : null);
        return s;
    };

    const identitaet = [];
    identitaet.push(idRow('Host', d.host || d.label));
    identitaet.push(idRow('Type', typZelle(!istGeist)));
    if (istGeist) {
        identitaet.push(idRow(t('detail.ghost.seen_via'),
            (d._ghostSrc || []).join(', ').toUpperCase() || '—'));
        identitaet.push(idRow(t('detail.ghost.seen_by'),
            (d._ghostSeenBy || []).join(', ') || '—'));
        if (d._ghostChassis) identitaet.push(idRow('MAC', d._ghostChassis));
        if (d._ghostCaps && d._ghostCaps.length) {
            identitaet.push(idRow(t('detail.ghost.caps'), d._ghostCaps.join(', ')));
        }
        if (d._ghostDesc) identitaet.push(idRow(t('detail.ghost.desc'), d._ghostDesc));
    } else {
        identitaet.push(idRow('IP', d.ip || '—'));
        identitaet.push(idRow('Interface', ifaceCell()));
    }

    // Metrik-Numeric-Liste (zusaetzlich zu den Rings — gibt exakte Werte
    // mit Unit). Stale-Marker greifen hier durch fmtMetric().
    const fettOderStrich = function(wert, einheit) {
        return wert != null ? el('b', '', wert + (einheit || '')) : tx('—');
    };
    const metriken = [
        idRow('CPU',    fmtMetric(fettOderStrich(d.cpu, '%'))),
        idRow('Memory', fmtMetric(fettOderStrich(d.memory, '%'))),
        idRow('Ping',   fmtMetric(d.ping > 0 ? el('b', '', d.ping + ' ms') : tx('—'))),
        idRow('↓ In',  fmtMetric(el('span', 'color:#22c55e',
            fmt(d.traffic ? d.traffic.in : 0)))),
        idRow('↑ Out', fmtMetric(el('span', 'color:#38bdf8',
            fmt(d.traffic ? d.traffic.out : 0)))),
    ];

    // Offline-Banner: rote prominente Box ueber dem Action-Bar.
    // "vor 5m" / "vor 2h" / "vor 3d" relative-time-Format.
    const fmtAgo = function(unixTs) {
        if (!unixTs || unixTs <= 0) return '';
        const sec = Math.max(0, Math.floor(Date.now() / 1000) - unixTs);
        if (sec < 60)    return t('detail.ago', { v: sec + 's' });
        if (sec < 3600)  return t('detail.ago', { v: Math.floor(sec / 60) + 'm' });
        if (sec < 86400) return t('detail.ago', { v: Math.floor(sec / 3600) + 'h' });
        return t('detail.ago', { v: Math.floor(sec / 86400) + 'd' });
    };
    // Stale-Banner: orangener Hinweis wenn Host zwar online aber Items
    // veraltet sind — separate Box, kommt NACH dem Offline-Banner falls beide
    // zutreffen (selten, aber moeglich wenn Zabbix unavailable=false meldet
    // und gleichzeitig keine neuen Werte ankommen).
    const staleBanner = (isStale && !isOff)
        ? fuege(el('div', 'background:rgba(245,158,11,0.13);border:1px solid #f59e0b;'
                + 'border-left:4px solid #f59e0b;border-radius:2px;padding:6px 10px;'
                + 'margin-bottom:8px;color:var(--nt-warn-text);font-size:12px'),
            el('div', 'font-weight:700',
                '⚠ STALE · ' + t('detail.stale.last_value', { ago: fmtAgo(d.last_seen) })),
            el('div', 'font-size:11px;margin-top:2px;font-style:italic',
                t('detail.stale.hint')))
        : null;
    const offlineBanner = isOff
        ? (function() {
            const b = el('div', 'background:rgba(229,55,66,0.12);border:1px solid #e53742;'
                + 'border-left:4px solid #e53742;border-radius:2px;padding:6px 10px;'
                + 'margin-bottom:8px;color:#e53742;font-size:12px');
            b.appendChild(el('div', 'font-weight:700',
                '⚠ OFFLINE' + (d.down_since ? ' · ' + fmtAgo(d.down_since) : '')));
            if (d.down_error) {
                const z = el('div', 'font-size:11px;color:var(--nt-crit-text);margin-top:2px;'
                    + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
                    d.down_error);
                z.setAttribute('title', d.down_error);
                b.appendChild(z);
            }
            b.appendChild(el('div', 'font-size:11px;color:var(--nt-crit-text);margin-top:2px;'
                + 'font-style:italic', t('detail.offline.hint')));
            return b;
        })()
        : null;

    // cy kann null sein (Tabellen-Tab ruft showDetail ohne Cytoscape) → Peers-
    // Liste nur bauen, wenn ein Graph da ist; sonst leer statt null-Deref-Crash.
    const peers = [];
    if (cy) {
        cy.getElementById(d.id).connectedEdges().forEach(function(edge) {
            const other = edge.source().id() === d.id ? edge.target() : edge.source();
            if (other.data('isGroup')) return;
            // AN WELCHEM PORT HAENGT DAS DING.
            //
            // Die Frage, mit der jemand die Karte ueberhaupt erst sucht: ein
            // Access Point ist tot und soll per PoE neu gestartet werden, also
            // "show lldp neighbors" auf dem Switch und mit der Konfiguration
            // vergleichen, welcher Port fehlt. Die Antwort lag schon in der
            // Kante, nur eine Ebene tiefer — im Kanten-Panel, das man erst
            // treffen muss. Hier steht sie an dem Geraet, das man ohnehin
            // angeklickt hat.
            //
            // Bleibt auch stehen, wenn das Geraet nicht mehr meldet: Kanten
            // altern (stale), statt zu verschwinden. Dann ist es der Port, an
            // dem es ZULETZT hing — und genau den sucht man.
            const eigener = edge.data('source') === d.id ? edge.data('portSrc') : edge.data('portTgt');
            const drueben = edge.data('source') === d.id ? edge.data('portTgt') : edge.data('portSrc');
            const zeile = el('span');
            zeile.appendChild(tx('↔ ' + other.data('label')));
            if (eigener || drueben) {
                zeile.appendChild(el('span', 'color:var(--nt-muted);font-size:10px',
                    (eigener ? ' ' + eigener : '') + (drueben ? ' → ' + drueben : '')));
            }
            peers.push(zeile);
        });
    }

    // Ring-Legend (CPU/Memory/Traffic/Ping als kleine Donuts)
    const _tPct = (!d.traffic) ? 0 : Math.min((d.traffic.in + d.traffic.out) / 2e7 * 100, 100);
    const _pPct = (!d.ping || d.ping <= 0) ? 0 : Math.min(d.ping / 200 * 100, 100);
    const rings = [
        { col: '#3b82f6', lbl: 'CPU',     val: d.cpu    != null ? d.cpu    + '%' : '—', pct: Math.min(d.cpu    || 0, 100) },
        { col: '#8b5cf6', lbl: 'Memory',  val: d.memory != null ? d.memory + '%' : '—', pct: Math.min(d.memory || 0, 100) },
        { col: '#22c55e', lbl: 'Traffic', val: d.traffic ? fmt(d.traffic.in) + ' / ' + fmt(d.traffic.out) : '—', pct: _tPct },
        { col: '#f59e0b', lbl: 'Ping',    val: d.ping > 0 ? d.ping + ' ms' : '—', pct: _pPct },
    ];

    const SVGNS = 'http://www.w3.org/2000/svg';
    const kreis = function(col, pct) {
        const svg = document.createElementNS(SVGNS, 'svg');
        svg.setAttribute('width', '36');
        svg.setAttribute('height', '36');
        svg.setAttribute('viewBox', '0 0 36 36');
        const spur = document.createElementNS(SVGNS, 'circle');
        spur.setAttribute('cx', '18'); spur.setAttribute('cy', '18');
        spur.setAttribute('r', '14');  spur.setAttribute('fill', 'none');
        spur.setAttribute('stroke', col + '22');
        spur.setAttribute('stroke-width', '4');
        svg.appendChild(spur);
        if (pct > 0) {
            const bogen = document.createElementNS(SVGNS, 'circle');
            bogen.setAttribute('cx', '18'); bogen.setAttribute('cy', '18');
            bogen.setAttribute('r', '14');  bogen.setAttribute('fill', 'none');
            bogen.setAttribute('stroke', col);
            bogen.setAttribute('stroke-width', '4');
            bogen.setAttribute('stroke-dasharray', (pct / 100 * 87.96).toFixed(1) + ' 87.96');
            bogen.setAttribute('stroke-dashoffset', '21.99');
            bogen.setAttribute('stroke-linecap', 'round');
            svg.appendChild(bogen);
        }
        return svg;
    };
    const ringBlock = el('div', 'display:flex;gap:8px;margin-bottom:6px;padding:2px 0');
    rings.forEach(function(r) {
        fuege(ringBlock, fuege(el('div', 'flex:1;text-align:center'),
            kreis(r.col, r.pct),
            el('div', 'font-size:9px;color:' + r.col + ';font-weight:700;margin-top:1px', r.lbl),
            el('div', 'font-size:10px;color:var(--nt-text-2);font-weight:600', r.val)));
    });

    panel.style.display = 'block';
    // The color guide at the bottom left moves out of the panel's way (CSS: .nt-detail-open).
    const _root = document.getElementById('nt-root');
    if (_root) _root.classList.add('nt-detail-open');
    // Extra-Items-Block (nt:show-Tags) — bei mehr als 4 Items collapsible
    // mit Summary "X Items anzeigen", verhindert dass das Panel ausufert.
    const _items = d.extra_items || [];
    const _itemsCollapsible = _items.length > 4;
    const itemZeilen = _items.map(function(it) {
        const wert = it.error
            ? el('span', 'color:var(--nt-muted);font-style:italic', it.error)
            : el('b', '', fmtItemValue(it.value, it.units));
        const name = el('span', 'color:var(--nt-sub);flex:1;min-width:0;'
            + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
            + 'padding-right:10px', (it.name || '').substring(0, 40));
        name.setAttribute('title', it.name || '');
        return fuege(el('div', 'display:flex;font-size:11px;line-height:1.45;padding:1px 0'),
            name,
            fuege(el('span', 'color:var(--nt-text-2);font-weight:500;flex-shrink:0'), wert));
    });
    const extraBlock = _items.length > 0
        ? (function() {
            const halter = el('div');
            halter.appendChild(section('Items'));
            if (_itemsCollapsible) {
                const det = el('details');
                det.appendChild(el('summary', 'font-size:11px;color:#0275b8;cursor:pointer;'
                    + 'user-select:none;margin-bottom:4px',
                    t('detail.items.show', { n: _items.length })));
                itemZeilen.forEach(function(z) { det.appendChild(z); });
                halter.appendChild(det);
            } else {
                itemZeilen.forEach(function(z) { halter.appendChild(z); });
            }
            return halter;
        })()
        : null;

    // Zabbix-URLs für Action-Buttons. Base-Path detektion wie im
    // Kontextmenü — Zabbix kann unter /, /zabbix/ oder anderen Prefixes laufen.
    const zbxBase = (function() {
        const p = window.location.pathname;
        const i = p.indexOf('/zabbix.php');
        return i > 0 ? p.substring(0, i + 1) : '/';
    })();
    const zbxOrigin = window.location.origin + zbxBase;
    const hostId = encodeURIComponent(d.id);
    // Edit-Action nur fuer Admins (NT_CONFIG.can_edit). Zabbix wuerde es
    // serverseitig blocken, aber die UI soll keinen Button anzeigen der
    // dann auf "Forbidden" landet.
    const actions = [
        { lbl: '\u{1F4CA}', title: 'Latest Data',
          url: zbxOrigin + 'zabbix.php?action=latest.view&filter_set=1&hostids%5B%5D=' + hostId },
        { lbl: '⚠',    title: t('detail.act.problems'),
          url: zbxOrigin + 'zabbix.php?action=problem.view&filter_set=1&hostids%5B%5D=' + hostId },
        { lbl: '\u{1F4C8}', title: 'Graphs',
          url: zbxOrigin + 'zabbix.php?action=charts.view&filter_set=1&filter_hostids%5B%5D=' + hostId },
    ];
    if (window.NT_CONFIG && window.NT_CONFIG.can_edit) {
        actions.push({ lbl: '⚙️', title: t('detail.act.edit'),
          url: zbxOrigin + 'zabbix.php?action=popup&popup=host.edit&hostid=' + hostId });
    }
    const actionBar = el('div', 'display:flex;gap:4px;margin-bottom:4px');
    actions.forEach(function(a) {
        const b = el('button', 'flex:1;padding:5px;background:var(--nt-surface-2);'
            + 'border:1px solid var(--nt-line);'
            + 'border-radius:2px;cursor:pointer;font-size:13px;color:var(--nt-text-2);'
            + 'transition:background 0.12s', a.lbl);
        b.setAttribute('title', a.title);
        // Direkt gebunden statt ueber data-act und einen Rueckgriff auf das
        // DOM: der Knopf kennt seine Aktion jetzt selbst.
        b.addEventListener('mouseenter', function() { b.style.background = 'var(--nt-surface-3)'; });
        b.addEventListener('mouseleave', function() { b.style.background = 'var(--nt-surface-2)'; });
        b.addEventListener('click', function(e) {
            e.stopPropagation();
            window.open(a.url, '_blank', 'noopener,noreferrer');
        });
        actionBar.appendChild(b);
    });

    // Status-Section: Status-Pille + optionale Status-Badges nebeneinander.
    const statusZeile = el('div', 'display:flex;align-items:center;flex-wrap:wrap;gap:5px');
    statusZeile.appendChild(statusPill);
    badges.forEach(function(b) { statusZeile.appendChild(b); });

    // ── Zusammensetzen ────────────────────────────────────────────────────
    while (panel.firstChild) panel.removeChild(panel.firstChild);

    // Header: Icon + Hostname + Type-Pille + Close-Button
    const kopf = el('div', 'display:flex;align-items:center;justify-content:space-between;'
        + 'margin-bottom:8px;gap:6px');
    const kopfLinks = el('div', 'display:flex;align-items:center;gap:6px;flex:1;min-width:0');
    kopfLinks.appendChild(el('span', 'font-size:18px;line-height:1;flex-shrink:0', ti.icon));
    const name = el('span', 'font-weight:700;font-size:14px;color:var(--nt-text);'
        + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', d.label);
    name.setAttribute('title', d.label || '');
    kopfLinks.appendChild(name);
    const typPille = el('span', 'display:inline-block;padding:1px 6px;border-radius:9px;'
        + 'background:' + ti.col + '22;color:' + ti.col + ';'
        + 'font-size:9px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;'
        + 'flex-shrink:0', ti.lbl);
    fuege(typPille, sternchen());
    kopfLinks.appendChild(typPille);

    const schliessen = el('button', 'background:none;border:none;cursor:pointer;'
        + 'color:var(--nt-muted);font-size:18px;line-height:1;padding:0;flex-shrink:0', '✕');
    schliessen.addEventListener('click', function(e) {
        e.stopPropagation();
        hideDetail(panel);
        if (window._ntCy) {
            window._ntCy.nodes('[!isGroup]').forEach(function(n) { n.style('opacity', 1); });
            window._ntCy.edges().forEach(function(ed) { ed.style('opacity', 0.85); });
        }
    });
    fuege(kopf, kopfLinks, schliessen);

    fuege(panel, kopf, offlineBanner, staleBanner,
        istGeist ? null : actionBar,
        section('Status'), statusZeile,
        section(t('detail.sec.identity')));
    identitaet.forEach(function(r) { panel.appendChild(r); });

    if (istGeist) {
        panel.appendChild(el('div', 'margin-top:8px;font-size:11px;color:var(--nt-muted);'
            + 'line-height:1.5', t('detail.ghost.hint')));
    } else {
        fuege(panel, section(t('detail.sec.metrics')), ringBlock);
        metriken.forEach(function(r) { panel.appendChild(r); });
        fuege(panel, extraBlock);
    }

    if (peers.length) {
        panel.appendChild(section(t('detail.sec.connections')));
        const liste = el('div', 'font-size:11px;color:var(--nt-text-2);line-height:1.6');
        peers.forEach(function(z, i) {
            if (i) liste.appendChild(el('br'));
            liste.appendChild(z);
        });
        panel.appendChild(liste);
    }
}
