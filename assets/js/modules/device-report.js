// device-report.js — Geraetebericht fuer die Vendor-Matrix, aus der Oberflaeche.
//
// WARUM
// -----
// Die Vendor-Matrix lebt von Nutzermeldungen. Sie hat sich an einem einzigen
// Tag von Behauptungen zu Messungen gewandelt — Huawei und MikroTik —, weil
// zwei Leute sich die Muehe gemacht haben. Es gibt `nt-lldp-probe.sh`, es gibt
// die Issue-Vorlage "Device report". Was fehlte, ist der Weg dazwischen: die
// Zahlen, die das Modul ohnehin schon hat, zusammenstellen, statt sie von Hand
// aus vier Ansichten abzuschreiben.
//
// WAS DRINSTEHT UND WAS NICHT
// ---------------------------
// **Anzahlen und Faehigkeiten, keine Namen.** Kein Hostname, keine IP, kein
// Nachbarname, keine Community. Das ist keine Vorsicht um ihrer selbst willen:
// die Issue-Vorlage verlangt vor dem Absenden ausdruecklich die Bestaetigung,
// dass nichts davon im Text steht, und ein Knopf, der diese Zusage im Stillen
// bricht, waere schlimmer als gar keiner.
//
// Aus demselben Grund wird der Bericht ANGEZEIGT und nicht bloss in die
// Zwischenablage gelegt. Wer ihn teilt, soll gelesen haben, was er teilt — ein
// "kopiert!"-Toast ueber ungesehenem Text nimmt genau die Pruefung weg, die
// die Vorlage einfordert.
//
// Die interessanteste Zahl ist die Port-Zuordnung. Ob ein Geraet
// `lldpRemLocalPortNum == ifIndex` einhaelt, entscheidet darueber, ob die
// Karte am Port MISST oder aus Knotensummen SCHAETZT — und das laesst sich
// nirgends nachlesen, nur messen. Genau dafuer ist die Matrix da.

import { t } from './i18n.js';

function cfg() {
    return (typeof window !== 'undefined' && window.NT_CONFIG) || {};
}

/**
 * Stellt den Bericht als Markdown zusammen — passend zu den Feldern der
 * Issue-Vorlage, damit man ihn hineinkopieren kann statt ihn umzuschreiben.
 */
export function buildDeviceReport() {
    const d = (typeof window !== 'undefined' && window._ntLastData) || null;
    if (!d || !Array.isArray(d.nodes) || !d.nodes.length) return null;

    const edges = Array.isArray(d.edges) ? d.edges : [];

    // ── Port-Zuordnung: die Kernfrage der Matrix ────────────────────────────
    let beidePorts = 0, einPort = 0, keinPort = 0, mitMetrik = 0;
    const proto = {};

    edges.forEach(function(e) {
        const p = e.ports || {};
        const n = Object.keys(p).filter(function(k) { return p[k]; }).length;
        if (n >= 2)      beidePorts++;
        else if (n === 1) einPort++;
        else              keinPort++;

        if (e.port_metrics && Object.keys(e.port_metrics).length) mitMetrik++;

        // src ist backendseitig ein Objekt {lldp: true} oder eine Liste.
        const s = e.src || {};
        const namen = Array.isArray(s) ? s : Object.keys(s);
        namen.forEach(function(x) { proto[x] = (proto[x] || 0) + 1; });
    });

    // ── LLDP-Quality, nur Summen ────────────────────────────────────────────
    const q = d.lldp_quality || {};
    let matched = 0, unmatched = 0, ambiguous = 0, selbst = 0, melder = 0;
    Object.keys(q).forEach(function(hid) {
        const e = q[hid] || {};
        melder++;
        matched   += e.matched || 0;
        unmatched += (e.unmatched  || []).length;
        ambiguous += (e.ambiguous  || []).length;
        selbst    += e.self || 0;
    });

    // ── Geraetetypen: sagt etwas ueber das Netz, ohne einen Host zu nennen ──
    const typen = {};
    d.nodes.forEach(function(n) {
        const ty = n.type || 'unknown';
        typen[ty] = (typen[ty] || 0) + 1;
    });

    const zeile = function(k, v) { return '| ' + k + ' | ' + v + ' |'; };
    const paare = function(o) {
        const ks = Object.keys(o).sort();
        return ks.length ? ks.map(function(k) { return k + ': ' + o[k]; }).join(', ') : '—';
    };

    const L = [];
    L.push('### Network Topology for Zabbix — device report');
    L.push('');
    L.push('_Generated from the LLDP-Q tab. Counts and capabilities only —');
    L.push('no host names, IP addresses, neighbour names or community strings._');
    L.push('');
    L.push('| | |');
    L.push('|---|---|');
    L.push(zeile('Module version', cfg().module_version || '?'));
    L.push(zeile('Zabbix version', '<!-- please fill in -->'));
    L.push(zeile('Vendor / model / firmware', '<!-- please fill in -->'));
    L.push(zeile('Hosts on the map', d.nodes.length));
    L.push(zeile('Hosts reporting neighbours', melder));
    L.push(zeile('Device types', paare(typen)));
    L.push('');
    L.push('**Neighbour resolution**');
    L.push('');
    L.push('| | |');
    L.push('|---|---|');
    L.push(zeile('Discovery protocol', paare(proto)));
    L.push(zeile('Neighbours matched to a host', matched));
    L.push(zeile('Neighbours not matched', unmatched));
    L.push(zeile('Ambiguous (several candidates)', ambiguous));
    L.push(zeile('Self-references discarded', selbst));
    L.push('');
    L.push('**Port mapping** — the question the vendor matrix exists for');
    L.push('');
    L.push('| | |');
    L.push('|---|---|');
    L.push(zeile('Links total', edges.length));
    L.push(zeile('Port reported on both ends', beidePorts));
    L.push(zeile('Port on one end only', einPort));
    L.push(zeile('No port reported', keinPort));
    L.push(zeile('Interface counters matched to a port', mitMetrik));
    L.push('');
    L.push('_The last row answers whether `lldpRemLocalPortNum == ifIndex` holds');
    L.push('on this hardware. Where it does not, the map estimates link traffic');
    L.push('from host totals instead of measuring it at the port._');
    L.push('');
    L.push('**What the device needed beyond `lldp enable`**');
    L.push('');
    L.push('<!-- e.g. SNMP view, a specific template, a shorter discovery interval -->');
    L.push('');

    return L.join('\n');
}

/**
 * Zeigt den Bericht in einem Overlay — bewusst zum LESEN, mit Kopierknopf
 * daneben. Siehe Kopfkommentar: die Issue-Vorlage verlangt eine Zusage ueber
 * den Inhalt, und die kann nur geben, wer ihn gesehen hat.
 */
export function showDeviceReport() {
    const txt = buildDeviceReport();

    const alt = document.getElementById('nt-devreport');
    if (alt) alt.remove();

    const ov = document.createElement('div');
    ov.id = 'nt-devreport';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,0.45);'
        + 'display:flex;align-items:center;justify-content:center;padding:24px';

    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:10px;max-width:760px;width:100%;'
        + 'max-height:100%;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.25);'
        + 'font-family:sans-serif';

    const head = document.createElement('div');
    head.style.cssText = 'padding:14px 18px 8px;font-size:15px;font-weight:600;color:#0f172a';
    head.textContent = t('devreport.title');
    box.appendChild(head);

    const sub = document.createElement('div');
    sub.style.cssText = 'padding:0 18px 10px;font-size:12px;color:#64748b;line-height:1.5';
    sub.textContent = t('devreport.intro');
    box.appendChild(sub);

    const ta = document.createElement('textarea');
    ta.readOnly = true;
    ta.style.cssText = 'flex:1;min-height:280px;margin:0 18px;padding:10px;font-family:ui-monospace,'
        + 'SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.5;border:1px solid #e2e8f0;'
        + 'border-radius:6px;resize:vertical;color:#334155';
    ta.value = txt || t('devreport.nodata');
    box.appendChild(ta);

    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding:12px 18px 16px';

    const mk = function(label, primary) {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'padding:6px 14px;border-radius:6px;font-size:13px;cursor:pointer;border:1px solid '
            + (primary ? '#2563eb' : '#cbd5e1') + ';background:' + (primary ? '#2563eb' : '#fff')
            + ';color:' + (primary ? '#fff' : '#334155');
        return b;
    };

    const copy = mk(t('devreport.copy'), true);
    copy.disabled = !txt;
    copy.addEventListener('click', function() {
        ta.select();
        // execCommand ist veraltet, funktioniert aber ohne Berechtigung und
        // ohne sicheren Kontext — navigator.clipboard scheitert auf einer
        // Zabbix-Installation ueber http lautlos.
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        copy.textContent = ok ? t('devreport.copied') : t('devreport.copy_manual');
    });

    const close = mk(t('devreport.close'), false);
    close.addEventListener('click', function() { ov.remove(); });

    foot.appendChild(copy);
    foot.appendChild(close);
    box.appendChild(foot);
    ov.appendChild(box);

    ov.addEventListener('click', function(e) { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
}
