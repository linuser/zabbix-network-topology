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

console.log('');
if (fehler > 0) {
    console.error(`✖ ${fehler} Befund(e).`);
    process.exit(1);
}
console.log('✓ Oberflaeche gibt aus, was sie soll.');
