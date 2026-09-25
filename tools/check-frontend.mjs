#!/usr/bin/env node
// check-frontend.mjs — prueft, was die Oberflaeche AUSGIBT, nicht nur, dass sie laedt.
//
// WARUM ES DIESEN GATE GIBT
// -------------------------
// Drei der Fehler aus den Meldungen im September 2026 lagen nicht in der Logik,
// sondern in dem, was die Oberflaeche daraus machte — und keiner davon haette
// einen bestehenden Test rot gemacht:
//
//   * Das Detail-Panel zeigte fuer einen Geisterknoten eine gruene Pille
//     "Normal" und leere Felder fuer CPU, Speicher und Ping. Fuer ein Geraet,
//     das gar nicht ueberwacht wird.
//   * Der Tooltip tat dasselbe und schickte sogar die Verlaufsabfrage los, mit
//     einer ID, zu der es keinen Host gibt. An Knoten UND an Kanten.
//   * "Auto" uebernahm eine gespeicherte Anordnung, die 30 von 157 gezeichneten
//     Knoten abdeckte, und die Karte sah aus wie ein Knaeuel.
//
// Alle drei sind Aussagen ueber die AUSGABE. Geprueft wird sie hier ohne
// Browser: die Module bauen ihre Inhalte als HTML-Zeichenkette oder als
// Datenstruktur, und beides laesst sich in Node ansehen.
//
// WAS DAS HIER NICHT IST
// ----------------------
// Kein Browser-Test. Ob die gestrichelte Pille im dunklen Theme gut aussieht
// oder ein Panel umbricht, sagt dieser Gate nicht. Er prueft, WAS dasteht,
// nicht wie es aussieht — und genau daran lagen die Fehler.
//
// Aufruf: node tools/check-frontend.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODULE = (name) => new URL('../assets/js/modules/' + name, import.meta.url).href;

// Minimale DOM-Attrappe. Die Module brauchen davon wenig: ein Element mit
// style/classList, document.createElement fuer Zwischenschritte, und window
// mit NT_CONFIG. Mehr nachzubauen waere eine zweite Browser-Implementierung.
const KOPF = `
    const leer = () => ({ style: {}, classList: { toggle(){}, add(){}, remove(){}, contains: () => false },
        appendChild(){}, addEventListener(){}, removeEventListener(){}, querySelectorAll: () => [],
        querySelector: () => null, setAttribute(){}, remove(){}, innerHTML: '', textContent: '' });
    globalThis.document = { getElementById: () => null, querySelector: () => null,
        querySelectorAll: () => [], createElement: leer, body: leer(), documentElement: leer(),
        addEventListener(){}, removeEventListener(){} };
    globalThis.localStorage = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; },
        setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
    try { Object.defineProperty(globalThis, 'navigator', { value: { language: 'en' }, configurable: true }); } catch (e) {}
    globalThis.fetchAufrufe = 0;
    globalThis.fetch = () => { globalThis.fetchAufrufe++; return new Promise(() => {}); };
`;

let fehler = 0;
const pruefe = (was, gegeben, erwartet) => {
    const ok = JSON.stringify(gegeben) === JSON.stringify(erwartet);
    if (!ok) fehler++;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${was.padEnd(52)} ${ok ? '' : `got=${JSON.stringify(gegeben)} want=${JSON.stringify(erwartet)}`}`);
};

// Ein Szenario laeuft im eigenen Prozess: die Module lesen NT_CONFIG beim
// Import, und ESM cacht pro Prozess. Zwei Szenarien mit verschiedener
// Konfiguration im selben Prozess bekaemen den Stand des ersten.
function szenario(name, cfg, rumpf) {
    const dir  = mkdtempSync(join(tmpdir(), 'nt-frontend-'));
    const file = join(dir, 'run.mjs');
    writeFileSync(file, `${KOPF}
        globalThis.window = { NT_CONFIG: ${JSON.stringify(cfg)},
            location: { pathname: '/zabbix.php', search: '', href: 'http://x/zabbix.php' },
            open(){}, innerWidth: 1600, innerHeight: 900 };
        globalThis.NT_CONFIG = window.NT_CONFIG;
        ${rumpf}
    `);
    const p = spawnSync(process.execPath, [file], { encoding: 'utf8' });
    if (p.status !== 0) {
        console.error(`  [FAIL] ${name}: Szenario brach ab\n${(p.stderr || '').split('\n').slice(0, 6).join('\n')}`);
        fehler++;
        return null;
    }
    try {
        return JSON.parse(p.stdout.trim().split('\n').pop());
    } catch (e) {
        console.error(`  [FAIL] ${name}: keine Antwort (${(p.stdout || '').slice(0, 120)})`);
        fehler++;
        return null;
    }
}

const nurText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

console.log('\n  Detail-Panel: ein Geist ist kein Host\n');
const panel = szenario('panel', { lang: 'en_US' }, `
    const { showDetail } = await import(${JSON.stringify(MODULE('detail-panel.js'))});
    const p1 = { style: {}, innerHTML: '', querySelectorAll: () => [], addEventListener(){} };
    showDetail(p1, { id: 'ghost_02_5e_10_00_00_01', label: '02:5E:10:00:00:01',
        host: '02:5E:10:00:00:01', type: 'ghost', severity: 0, _isGhost: true,
        _ghostSrc: ['cdp'], _ghostSeenBy: ['lab-sw-01'], _ghostChassis: '02:5E:10:00:00:01',
        _ghostCaps: ['Bridge'], _ghostDesc: 'Example vendor' }, null);
    const p2 = { style: {}, innerHTML: '', querySelectorAll: () => [], addEventListener(){} };
    showDetail(p2, { id: '10084', label: 'lab-sw-01', host: 'lab-sw-01', type: 'switch',
        severity: 0, ip: '10.99.0.5', iftype: 'SNMP', cpu: 12, memory: 40, ping: 0.4 }, null);
    const kante = { data: (k) => ({ source: 'ap1', target: 'sw1', portSrc: 'eth0', portTgt: 'Gi1/0/8' })[k],
        source: () => ({ id: () => 'ap1', data: () => 'ap-1' }),
        target: () => ({ id: () => 'sw1', data: (k) => k === 'label' ? 'lab-sw-01' : false }) };
    const p3 = { style: {}, innerHTML: '', querySelectorAll: () => [], addEventListener(){} };
    showDetail(p3, { id: 'ap1', label: 'ap-1', host: 'ap-1', type: 'wireless', severity: 0 },
        { getElementById: () => ({ connectedEdges: () => [kante] }) });
    console.log(JSON.stringify({
        geistStatus:  /NOT MONITORED/.test(p1.innerHTML),
        geistNormal:  /Normal/.test(p1.innerHTML),
        geistRinge:   /CPU/.test(p1.innerHTML),
        geistQuelle:  /CDP/.test(p1.innerHTML) && /lab-sw-01/.test(p1.innerHTML),
        geistMac:     /02:5E:10:00:00:01/.test(p1.innerHTML),
        hostRinge:    /CPU/.test(p2.innerHTML),
        hostStatus:   /Normal/.test(p2.innerHTML),
        portPaar:     /eth0/.test(p3.innerHTML) && /Gi1\\/0\\/8/.test(p3.innerHTML),
    }));
`);
if (panel) {
    pruefe('Geist: Status "nicht ueberwacht"',      panel.geistStatus, true);
    pruefe('Geist: kein gruenes "Normal"',          panel.geistNormal, false);
    pruefe('Geist: keine Metrik-Ringe',             panel.geistRinge,  false);
    pruefe('Geist: Quelle und Melder stehen da',    panel.geistQuelle, true);
    pruefe('Geist: MAC steht da',                   panel.geistMac,    true);
    pruefe('Host: Ringe bleiben',                   panel.hostRinge,   true);
    pruefe('Host: Status bleibt',                   panel.hostStatus,  true);
    pruefe('Verbindungsliste nennt beide Ports',    panel.portPaar,    true);
}

console.log('\n  Tooltip: auch dort ist ein Geist kein Host\n');
const tip = szenario('tooltip', { lang: 'en_US', data_url: 'zabbix.php?action=network.topology.data' }, `
    const T = await import(${JSON.stringify(MODULE('tooltip.js'))});
    const evt = { originalEvent: { clientX: 10, clientY: 10 } };
    T.showTip(evt, { id: 'ghost_x', label: '02:5E:10:00:00:01', _isGhost: true,
        _ghostSrc: ['lldp'], _ghostSeenBy: ['lab-sw-01'], cpu: null, ping: null });
    const nachKnoten = globalThis.fetchAufrufe;
    T.showEdgeTip(evt, { source: 'ghost_x', target: '10084', trafficIn: 0, trafficOut: 0,
        _isGhostEdge: true }, '02:5E:10:00:00:01', 'lab-sw-01');
    console.log(JSON.stringify({ fetchKnoten: nachKnoten, fetchGesamt: globalThis.fetchAufrufe }));
`);
if (tip) {
    pruefe('Geist-Knoten: keine Verlaufsabfrage',   tip.fetchKnoten,  0);
    pruefe('Geist-Kante: keine Verlaufsabfrage',    tip.fetchGesamt,  0);
}

console.log('\n  Geisterfilter: ohne Endgeraete\n');
const filter = szenario('filter', { lang: 'en_US' }, `
    const { injectGhostNodes } = await import(${JSON.stringify(MODULE('build-elements.js'))});
    const q = [{ id: 'sw1', label: 'lab-sw-01', unmatched: [
        { raw: 'ap-1',   src: 'lldp', caps: ['Bridge', 'WLAN AP'] },
        { raw: 'pc-17',  src: 'lldp', caps: ['Station'] },
        { raw: 'tel-3',  src: 'lldp', caps: ['Telephone'] },
        { raw: 'stumm',  src: 'lldp' } ] }];
    const knoten = [{ id: 'sw1', label: 'lab-sw-01' }];
    const alle  = injectGhostNodes(knoten, [], q, 'all');
    const infra = injectGhostNodes(knoten, [], q, 'infra');
    console.log(JSON.stringify({
        alle:   alle.nodes.length, alleKanten: alle.edges.length,
        infra:  infra.nodes.map((n) => n.label).sort(),
        infraKanten: infra.edges.length, gefiltert: infra.gefiltert,
    }));
`);
if (filter) {
    pruefe('alle: vier Geister',                    filter.alle,        5);
    pruefe('ohne Endgeraete: AP und Unbekannter',   filter.infra,       ['ap-1', 'lab-sw-01', 'stumm']);
    pruefe('deren Kanten verschwinden mit',         filter.infraKanten, 2);
    pruefe('gemeldet wird, wie viele wegfielen',    filter.gefiltert,   2);
}

console.log('\n  Layout "auto": wann die eigene Anordnung noch gilt\n');
const positionen = {};
for (let i = 1; i <= 30; i++) positionen['h' + i] = { x: i * 50, y: i * 30 };
const layout = szenario('layout',
    { lang: 'en_US', user_id: 'u1', selected_groupids: ['4'],
      positions: { shared: { 4: positionen }, personal: {} } }, `
    const L = await import(${JSON.stringify(MODULE('layouts.js'))});
    const hosts = Array.from({ length: 30 }, (_, i) => ({ id: 'h' + (i + 1) }));
    const geister = (n) => Array.from({ length: n }, (_, i) => ({ id: 'ghost_g' + i }));
    const kanten = hosts.slice(1).map((h) => ({ source: 'h1', target: h.id }));
    const lauf = (n) => {
        const cfg = L.buildLayoutConfig('auto', hosts.concat(geister(n)), kanten, false);
        return cfg.name + '/' + (L.letzterLayoutGrund() || '-');
    };
    console.log(JSON.stringify({ ohne: lauf(0), wenige: lauf(20), viele: lauf(127) }));
`);
if (layout) {
    pruefe('ohne Geister: gespeicherte Anordnung',  layout.ohne,   'preset/-');
    pruefe('wenige Geister: bleibt dabei',          layout.wenige, 'preset/-');
    pruefe('Geister ueberwiegen: frisch, mit Grund', layout.viele, 'cose/geister');
}

// Ein LAG-Member kann auf zwei Arten tot sein: nicht mehr gemeldet (stale)
// oder gemeldet, aber der Port ist unten. Das Buendel muss BEIDES zaehlen —
// die zweite Art haelt die Gegenseite fuer die Dauer der Stale-TTL am Leben,
// und eingeklappt wuerde die Karte sonst "x4, alles gut" behaupten.
console.log('\n  Parallele Links: ein totes Kabel faellt auf\n');
const bund = szenario('bundle', { lang: 'en_US' }, `
    const P = await import(${JSON.stringify(MODULE('parallel-links.js'))});
    const member = (id, extra) => ({ data: Object.assign(
        { id, source: 'core', target: 'acc', isLLDP: true, portSrc: 'Gi1/0/' + id,
          trafficIn: 10, trafficOut: 5, perLink: true, capBps: 1e9 }, extra) });
    const lauf = (extras) => {
        const els = extras.map((e, i) => member(String(i + 1), e));
        P.annotateBundles(els);
        const lead = els[0].data;
        const kante = { data: (k) => k === undefined ? lead : lead, hasClass: () => true };
        const td = P.trunkData(kante);
        return { label: lead.tLabel.split('\\n')[0], down: lead.bundleDown,
                 portDown: td.portDown, err: td.ifaceErr };
    };
    console.log(JSON.stringify({
        alleOk:   lauf([{}, {}, {}]),
        einerAus: lauf([{}, { portDown: true }, {}]),
        einerAlt: lauf([{}, { _isStaleEdge: true }, {}]),
        alleAus:  lauf([{ portDown: true }, { portDown: true }]),
        fehler:   lauf([{}, { ifaceErr: 42 }]),
    }));
`);
if (bund) {
    pruefe('alle Member laufen: nur die Anzahl',   bund.alleOk.label,   '\u00d73');
    pruefe('Port unten: zaehlt als ausgefallen',   bund.einerAus.label, '\u00d73 (1 down)');
    pruefe('Port unten: Trunk nicht komplett rot', bund.einerAus.portDown, false);
    pruefe('nicht mehr gemeldet: zaehlt auch',     bund.einerAlt.label, '\u00d73 (1 down)');
    pruefe('alle unten: Trunk ist rot',            bund.alleAus.portDown, true);
    pruefe('Fehler eines Members erreicht den Trunk', bund.fehler.err,  42);
}

// "Haengt an" im Tabellen-Tab: die Spalte ist die Antwort auf die Frage, mit
// der Leute das Modul suchen. Geprueft wird der TEXT, nicht die Auszeichnung.
console.log('\n  Tabelle: an welchem Port haengt das Ding\n');
const uplink = szenario('uplink', { lang: 'en_US' }, `
    const T = await import(${JSON.stringify(MODULE('render-table.js'))});
    const nodes = [
        { id: 'ap1',  label: 'lab-ap-01', type: 'wireless' },
        { id: 'sw1',  label: 'lab-sw-01', type: 'switch' },
        { id: 'sw2',  label: 'lab-sw-02', type: 'switch' },
        { id: 'srv1', label: 'lab-srv-1', type: 'server' },
        { id: 'nix',  label: 'lab-nix-1', type: 'server' },
    ];
    const edges = [
        // AP am Switch, Port auf der Switch-Seite
        { id: 'e1', from: 'ap1', to: 'sw1', ports: { ap1: 'eth0', sw1: 'Gi1/0/8' } },
        // Hosting-Kante zaehlt nicht als Kabel
        { id: 'e2', from: 'sw1', to: 'srv1', _type: 'hosts', ports: {} },
        // Zwei Kabel zwischen den Switches (LAG) plus ein Server ohne Port
        { id: 'e3', from: 'sw1', to: 'sw2', ports: { sw1: 'Gi1/0/1', sw2: 'Te1/1/1' } },
        { id: 'e4', from: 'sw1', to: 'sw2', ports: { sw1: 'Gi1/0/2', sw2: 'Te1/1/2' } },
        { id: 'e5', from: 'srv1', to: 'sw2', ports: { sw2: 'Gi1/0/9' }, stale: true },
    ];
    Object.assign(globalThis, {});
    const map = T.buildUplinks(nodes, edges);
    // uplinkText liest den Modulzustand, den renderTable setzt — hier direkt.
    T.buildUplinks(nodes, edges);
    const txt = (id) => {
        const l = map[id] || [];
        return l.length ? (l[0].port ? l[0].name + ' | ' + l[0].port : l[0].name) : '';
    };
    console.log(JSON.stringify({
        ap:      txt('ap1'),
        srv:     txt('srv1'),
        srvAlt:  (map.srv1 || [{}])[0].stale === true,
        swZahl:  (map.sw1 || []).length,
        swErst:  txt('sw1'),
        ohne:    txt('nix'),
        hosting: (map.srv1 || []).some((u) => u.nb === 'sw1'),
    }));
`);
if (uplink) {
    pruefe('AP: Switch und Port der Gegenseite', uplink.ap,  'lab-sw-01 | Gi1/0/8');
    pruefe('Server: Port am Switch',             uplink.srv, 'lab-sw-02 | Gi1/0/9');
    pruefe('Server: als alternd gekennzeichnet', uplink.srvAlt, true);
    pruefe('LAG: beide Kabel gezaehlt',          uplink.swZahl, 3);
    pruefe('Switch: Infrastruktur zuerst',       uplink.swErst, 'lab-sw-02 | Te1/1/1');
    pruefe('ohne Nachbarn: leer',                uplink.ohne, '');
    pruefe('hosts-Kante ist kein Kabel',         uplink.hosting, false);
}

// Die Aenderungsmeldung ist der eigentliche Zweck der parallelen Links: ein
// ausgefallenes Buendelmitglied soll eine gemeldete Aenderung sein. Dann muss
// der Satz aber auch stimmen — "link A <-> B disappeared" ist falsch, solange
// drei von vier Kabeln tragen.
console.log('\n  Meldung: ein Kabel ist nicht die Verbindung\n');
const meldung = szenario('notify', { lang: 'en_US' }, `
    // toast() baut ein div und setzt textContent. Wir merken uns jedes
    // erzeugte Element und lesen hinterher, was dringestanden haette.
    const erzeugt = [];
    const create = globalThis.document.createElement;
    globalThis.document.createElement = function(tag) {
        const e = create(tag); erzeugt.push(e); return e;
    };
    globalThis.document.body.contains = () => true;
    globalThis.requestAnimationFrame = (fn) => fn();
    const N = await import(${JSON.stringify(MODULE('topo-notify.js'))});
    N.notifyTopoChanges({
        added: [{ a: 'core', b: 'acc', k: 'a|b#i2', pa: 'Gi1/0/2', pb: 'Te1/1/2', n: 2 }],
        removed: [
            { a: 'core', b: 'acc', k: 'a|b#i1', pa: 'Gi1/0/1', pb: 'Te1/1/1', left: 3, was: 4 },
            { a: 'core', b: 'sw3', k: 'a|c#i9', pa: 'Gi1/0/9', pb: 'Gi0/1', left: 0, was: 1 },
            { a: 'core', b: 'srv', k: 'a|d' },
        ],
    });
    console.log(JSON.stringify(erzeugt.map((e) => e.textContent).filter(Boolean)));
`);
if (meldung) {
    const txt = meldung.join(' | ');
    pruefe('neues Kabel: Ports und neue Anzahl',
        /another cable core Gi1\/0\/2 . acc Te1\/1\/2 . 2 parallel now/.test(txt), true);
    pruefe('ein Kabel weg: was noch traegt',
        /cable core Gi1\/0\/1 . acc Te1\/1\/1 gone . 3 of 4 still up/.test(txt), true);
    pruefe('letztes Kabel weg: Verbindung unten',
        /last cable core Gi1\/0\/9 .* the link is down/.test(txt), true);
    pruefe('einzelne Leitung: kurzer Satz wie bisher',
        /link core . srv disappeared/.test(txt), true);
    pruefe('einzelne Leitung: ohne Kabelzaehlung',
        /core . srv.*(of|parallel)/.test(txt), false);
}

// Die Legende muss zeigen, was die Karte zeichnet. Genau das ging hier schon
// zweimal auseinander (Issue #9 bei den Kanten, das gedimmte Zeichen bei den
// Knoten), und seit 5.4.0 zeichnet die Karte zwei Dinge mehr: das Buendel und
// seine Glut.
console.log('\n  Legende: zeigt sie, was gezeichnet wird?\n');
const legende = szenario('legend', { lang: 'en_US' }, `
    const erzeugt = [];
    const create = globalThis.document.createElement;
    globalThis.document.createElement = function(tag) {
        const e = create(tag); erzeugt.push(e); return e;
    };
    const L = await import(${JSON.stringify(MODULE('legend.js'))});
    L.setupBottomLegend(create('div'), false);
    const html = erzeugt.map(function(e) { return e.innerHTML || ''; }).join(' ');
    console.log(JSON.stringify({
        buendel: /parallel cables/.test(html),
        zeichen: /\u00d7N/.test(html),
        glut:    /dead cable/.test(html),
        alternd: /no longer reported/.test(html),
    }));
`);
if (legende) {
    pruefe('Legende nennt die parallelen Kabel', legende.buendel, true);
    pruefe('Legende zeigt das Zeichen selbst',   legende.zeichen, true);
    pruefe('Legende nennt das tote Kabel',       legende.glut,    true);
    pruefe('alternde Kante weiterhin drin',      legende.alternd, true);
}

// Was in einer exportierten Datei steht, ist Ausgabe der Oberflaeche — nur
// sieht sie niemand beim Hinsehen. Deshalb hier: die Patchliste als CSV.
console.log('\n  CSV: die Patchliste verlaesst den Browser\n');
const csv = szenario('csv', { lang: 'en_US' }, `
    const T = await import(${JSON.stringify(MODULE('render-table.js'))});
    const nodes = [
        { id: 'ap1', label: 'lab-ap-01', type: 'wireless', severity: 0, ip: '192.0.2.10' },
        { id: 'sw1', label: 'lab-sw-01', type: 'switch',   severity: 0 },
        // Ein Hostname, der in Excel eine Formel waere. Zabbix laesst so etwas
        // als sichtbaren Namen zu, und LLDP-Nachbarn erst recht.
        { id: 'boe', label: '=cmd|\\'/C calc\\'!A0', type: 'server', severity: 2 },
    ];
    const edges = [
        { id: 'e1', from: 'ap1', to: 'sw1', ports: { ap1: 'eth0', sw1: 'Gi1/0/8' } },
        { id: 'e2', from: 'boe', to: 'sw1', ports: { sw1: 'Gi1/0/9' }, stale: true },
    ];
    const text = T.hostsCsv(nodes, T.buildUplinks(nodes, edges));
    console.log(JSON.stringify({
        kopf:    text.split('\\n')[0],
        ap:      text.split('\\n').find((z) => z.indexOf('lab-ap-01') === 0 || z.indexOf(',lab-ap-01,') > -1) || '',
        boese:   (text.match(/^[^\\n]*calc[^\\n]*$/m) || [''])[0],
    }));
`);
if (csv) {
    pruefe('Kopfzeile trennt Geraet und Port',
        /Connected to,Port,Last seen here/.test(csv.kopf), true);
    pruefe('AP-Zeile nennt Switch und Port',
        /lab-sw-01,Gi1\/0\/8/.test(csv.ap), true);
    pruefe('alternder Eintrag ist filterbar',
        /Gi1\/0\/9,yes/.test(csv.boese), true);
    pruefe('Formel wird entschaerft',
        /^Warning,'=cmd/.test(csv.boese), true);
}

// Was der Nutzer liest, wenn der Server NICHT mit Daten antwortet. Genau hier
// lag #22: nginx schickte bei Zeitueberschreitung seine HTML-Seite, das
// Frontend parste sie als JSON, und im Kasten stand "Unexpected token '<'" —
// waehrend das Problem eine zu grosse Auswahl war. Der Fix kam als PR #23 mit
// einer Pruefung im Browser; hier steht er als Gate, damit die Saetze auch
// dann noch stimmen, wenn niemand mehr von Hand nachsieht.
console.log('\n  Fehlerfall: der Server antwortet nicht mit Daten\n');
const fehlerfall = szenario('http', { lang: 'en_US' }, `
    const J = await import(${JSON.stringify(MODULE('http.js'))});
    const antwort = (status, body) => () => Promise.resolve({
        ok: status >= 200 && status < 300,
        status: status,
        statusText: '',
        text: () => Promise.resolve(body),
    });
    const hole = async (status, body) => {
        globalThis.fetch = status === 0
            ? () => Promise.reject(new TypeError('Failed to fetch'))
            : antwort(status, body);
        try { await J.fetchJson('x'); return { ok: true }; }
        catch (e) { return { status: e.status, msg: e.message }; }
    };
    // Und einmal ohne eigene Optionen: die Vorgabe muss den Kopf setzen, den
    // requireAjax() auf jeder lesenden Action verlangt.
    let gesehen = null;
    globalThis.fetch = (u, o) => { gesehen = o; return antwort(200, '{}')(); };
    await J.fetchJson('x');
    console.log(JSON.stringify({
        timeout: await hole(504, '<html> <head><title>504 Gateway Time-out</title>'),
        denied:  await hole(403, '<html>login</html>'),
        http:    await hole(500, 'boom'),
        parse:   await hole(200, '<html> <h1>PHP Fatal error: memory</h1>'),
        netz:    await hole(0, ''),
        gut:     await hole(200, '{"nodes":[]}'),
        kopf:    (gesehen && gesehen.headers) ? gesehen.headers['X-Requested-With'] : null,
    }));
`);
if (fehlerfall) {
    pruefe('Zeitueberschreitung heisst Zeitueberschreitung',
        /did not answer in time|too large|fewer hops/.test(fehlerfall.timeout.msg || ''), true);
    pruefe('kein Wort von "Unexpected token"',
        /Unexpected token|not valid JSON/.test(fehlerfall.timeout.msg || ''), false);
    pruefe('403: Sitzung abgelaufen, neu anmelden',
        [fehlerfall.denied.status, /sign in again/.test(fehlerfall.denied.msg || '')], [403, true]);
    pruefe('anderer HTTP-Fehler nennt den Code',
        [fehlerfall.http.status, /500/.test(fehlerfall.http.msg || '')], [500, true]);
    pruefe('200 ohne JSON: sagt, womit es anfing',
        /began with: html .*PHP Fatal error/.test(fehlerfall.parse.msg || ''), true);
    pruefe('und ohne spitze Klammern darin',
        /[<>]/.test(fehlerfall.parse.msg || ''), false);
    pruefe('Server nicht erreichbar ist ein eigener Fall',
        /could not be reached/.test(fehlerfall.netz.msg || ''), true);
    pruefe('echtes JSON kommt durch',        fehlerfall.gut.ok, true);
    pruefe('X-Requested-With auch ohne Optionen', fehlerfall.kopf, 'XMLHttpRequest');
}

console.log('');
if (fehler > 0) {
    console.error(`✖ ${fehler} Befund(e).`);
    process.exit(1);
}
console.log('✓ Oberflaeche gibt aus, was sie soll.');
