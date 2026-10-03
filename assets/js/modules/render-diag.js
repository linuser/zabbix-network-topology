// render-diag.js — Admin-Diagnose-Tab.
//
// Zeigt die letzten ~50 Backend-Aufrufe (Data/History/Items/Discover/Spark)
// aus dem APCu-Ring-Buffer pro User: elapsed_ms, bytes, cache_hit, Counts.
// Plus eine Summary mit Avg/Max-Latenz pro Action und Cache-Hit-Rate.
//
// Nur sichtbar fuer Admins (NT_CONFIG.can_edit). Backend prueft das nochmal,
// aber wir blenden den Tab im Frontend gleich aus.

import { esc, el, mkTabTheme, buildBaseUrl, isDark, clearWrap } from './utils.js';
import { t } from './i18n.js';
import { fetchJson } from './http.js';

function _bytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
}

// Spitzenverbrauch, und wie nah er an der Grenze lag. Beides nebeneinander,
// weil die eine Zahl ohne die andere nichts sagt: 38 MB sind harmlos bei 128
// und der sichere Absturz bei 48. Ein ueberschrittenes memory_limit ist eine
// WEISSE SEITE ohne Meldung — wer das kommen sehen will, muss den Abstand
// sehen, nicht den Verbrauch.
function _mem(e) {
    if (!e.mem_peak_kb) return '';
    const peak  = _bytes(e.mem_peak_kb * 1024);
    const grenze = e.mem_limit_kb ? _bytes(e.mem_limit_kb * 1024) : '∞';
    return peak + ' / ' + grenze;
}

// Was der Kantenbau allein hinzugefuegt hat, je Kante. Genau diese Zahl steht
// im MAX_EDGES-Docblock und war bis zum ersten Lasttest von Hand gemessen.
function _proKante(e) {
    const kanten = e.counts && e.counts.edges;
    // Auf null pruefen, nicht auf Falsy: eine gemessene 0 ist ein Ergebnis
    // ("der Kantenbau haelt nichts fest") und soll dastehen. null heisst
    // dagegen, dass gar nicht gebaut wurde — Cache-Treffer.
    if (!kanten || e.mem_edges_kb == null) return '';
    // Unter einer Handvoll Kanten sagt der Quotient nichts: der Zaehler ist
    // der Speicher, den der Kantenbau hinterlaesst, und darin steckt ein
    // Sockel, der nicht mit der Kantenzahl waechst. Bei zwei Kanten kamen so
    // "1163.0 KB/edge" heraus — das sieht aus wie eine Messung und ist
    // keine. Lieber nichts anzeigen als eine Zahl, der jemand glaubt.
    if (kanten < 50) return '';
    return (e.mem_edges_kb / kanten).toFixed(1) + ' KB/edge';
}

/**
 * Die Abschnitte eines data-Aufrufs als eine Zeile, der teuerste zuerst.
 *
 * Nach Groesse sortiert und nicht in der Reihenfolge des Durchlaufs: gesucht
 * wird der Abschnitt, an dem sich Arbeit lohnt, und der soll vorne stehen. Die
 * Reihenfolge der Pipeline kennt man ohnehin, die Verteilung nicht.
 *
 * Exportiert, weil der Anteil gerechnet wird und Rechnen eine Gegenprobe
 * verdient.
 */
export function phasenZeile(e) {
    const p = e && e.phases;
    if (!p || typeof p !== 'object') return '';
    const namen = Object.keys(p).filter(function(k) {
        return typeof p[k] === 'number' && isFinite(p[k]);
    });
    if (!namen.length) return '';
    const summe = namen.reduce(function(a, k) { return a + p[k]; }, 0);
    namen.sort(function(a, b) { return p[b] - p[a]; });
    return namen.map(function(k) {
        // Der Anteil ist die eigentliche Auskunft: "3100 ms" sagt wenig,
        // "items 70%" sagt, wo man anfaengt. Bei einer Summe von 0 gaebe es
        // keinen Anteil, nur eine Division durch null.
        const anteil = summe > 0 ? Math.round(100 * p[k] / summe) : 0;
        return k + ' ' + Math.round(p[k]) + 'ms (' + anteil + '%)';
    }).join(' · ');
}

function _ago(ts) {
    const sec = Math.max(0, Math.floor(Date.now() / 1000) - ts);
    if (sec < 60)    return sec + 's';
    if (sec < 3600)  return Math.floor(sec / 60) + 'm';
    return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
}

function _aggStats(entries) {
    const byAction = {};
    entries.forEach(function(e) {
        const a = e.action || '?';
        if (!byAction[a]) byAction[a] = { count: 0, totMs: 0, maxMs: 0, totBytes: 0, hits: 0 };
        byAction[a].count++;
        byAction[a].totMs   += e.elapsed_ms || 0;
        byAction[a].maxMs   = Math.max(byAction[a].maxMs, e.elapsed_ms || 0);
        byAction[a].totBytes += e.bytes || 0;
        if (e.cache_hit) byAction[a].hits++;
    });
    return byAction;
}

/**
 * Der Verlauf ueber Tage — und was er bedeutet.
 *
 * Der Ring oben haelt eine Stunde: er sagt, wie lange die Karte GERADE
 * braucht. Die Frage nach einem Update ist eine andere — ist sie langsamer
 * geworden? Dafuer stehen hier die Tagesschnitte.
 *
 * NUR VOLLE KARTENAUFBAUTEN. Cache-Treffer dauern 20 ms statt 1600 und
 * wuerden den Schnitt danach verschieben, wie viele Leute zugesehen haben.
 */
function _buildTage(tage, trend, theme) {
    if (!tage || tage.length < 2) {
        return null;
    }
    const wrap = el('div', '');
    // NUR UEBER DIE GEZEICHNETEN TAGE skalieren. Ueber alle dreissig gerechnet
    // drueckte ein einzelner alter Ausreisser jeden sichtbaren Balken auf die
    // Mindestbreite — der Verlauf saehe flach aus, obwohl er es nicht ist.
    const sichtbar = tage.slice(-14);
    const max = sichtbar.reduce(function(m, d) { return Math.max(m, d.avg || 0); }, 0) || 1;

    if (trend) {
        // Die Richtung bekommt eine Farbe, aber erst ab einer Groesse, bei der
        // sie etwas heisst. Alles unter zehn Prozent ist Tagesschwankung, und
        // sie rot zu faerben hiesse, Rauschen als Befund auszugeben.
        const p = trend.prozent;
        const deutlich = Math.abs(p) >= 10;
        // theme.ok statt eines festen Hex: mkTabTheme() liefert fuer jedes
        // Thema eine passende Gruentoene, und ein fester Wert ist genau das,
        // was die Farbregel dieses Projekts verbietet — auf hellem Grund kam
        // #16a34a zudem nur auf rund 3,3:1 Kontrast.
        const farbe = !deutlich ? theme.sub : (p > 0 ? theme.crit : theme.ok);
        const z = el('div', 'font-size:12px;margin-bottom:8px;color:' + farbe
            + (deutlich ? ';font-weight:600' : ''),
            p > 0 ? t('diag.days.slower', { p: p, before: trend.vorher, now: trend.jetzt })
                  : p < 0 ? t('diag.days.faster', { p: -p, before: trend.vorher, now: trend.jetzt })
                  : t('diag.days.same', { now: trend.jetzt }));
        wrap.appendChild(z);
    }

    sichtbar.forEach(function(d) {
        const zeile = el('div', 'display:flex;align-items:center;gap:8px;'
            + 'font-size:11.5px;line-height:1.7');
        zeile.appendChild(el('span', 'color:' + theme.sub + ';min-width:84px;'
            + 'font-variant-numeric:tabular-nums', d.tag));
        const balken = el('span', 'display:inline-block;height:9px;border-radius:2px;'
            + 'background:' + (d.avg > 1000 ? theme.crit : d.avg > 500 ? theme.warn : theme.sub)
            + ';opacity:0.55;width:' + Math.max(2, Math.round((d.avg / max) * 190)) + 'px');
        zeile.appendChild(balken);
        zeile.appendChild(el('span', 'color:' + theme.text + ';font-weight:600;'
            + 'font-variant-numeric:tabular-nums', Math.round(d.avg) + ' ms'));
        zeile.appendChild(el('span', 'color:' + theme.subSoft,
            t('diag.days.calls', { n: d.n })));
        wrap.appendChild(zeile);
    });
    return wrap;
}

function _buildSummary(byAction, theme) {
    const actions = Object.keys(byAction).sort();
    if (actions.length === 0) return '<div style="color:' + theme.subSoft + '">' + esc(t('diag.no_entries')) + '</div>';
    let html = '<table style="border-collapse:collapse;font-size:12px;width:auto">'
        + '<thead><tr style="border-bottom:1px solid ' + theme.border + '">'
        + ['Action', 'Count', 'Avg ms', 'Max ms', 'Avg Size', 'Cache Hit'].map(function(h) {
            return '<th style="padding:6px 14px;text-align:left;color:' + theme.sub + ';font-weight:600">' + h + '</th>';
        }).join('') + '</tr></thead><tbody>';
    actions.forEach(function(a) {
        const s = byAction[a];
        const avg = s.count > 0 ? (s.totMs / s.count) : 0;
        const avgBytes = s.count > 0 ? (s.totBytes / s.count) : 0;
        const hitRate = s.count > 0 ? Math.round(100 * s.hits / s.count) : 0;
        const slowCol = s.maxMs > 1000 ? theme.crit : (s.maxMs > 500 ? theme.warn : theme.text);
        html += '<tr style="border-bottom:1px solid ' + theme.borderSoft + '">'
            + '<td style="padding:4px 14px;font-weight:600">' + esc(a) + '</td>'
            + '<td style="padding:4px 14px;text-align:right">' + s.count + '</td>'
            + '<td style="padding:4px 14px;text-align:right">' + avg.toFixed(1) + '</td>'
            + '<td style="padding:4px 14px;text-align:right;color:' + slowCol + ';font-weight:600">' + s.maxMs.toFixed(1) + '</td>'
            + '<td style="padding:4px 14px;text-align:right">' + _bytes(avgBytes) + '</td>'
            + '<td style="padding:4px 14px;text-align:right">' + (s.hits > 0 ? hitRate + '% (' + s.hits + '/' + s.count + ')' : '—') + '</td>'
            + '</tr>';
    });
    return html + '</tbody></table>';
}

// ── Gehen die Antworten komprimiert ueber die Leitung? ───────────────────
//
// Die Kartenantwort ist bei 1000 Hosts rund 1,2 MB JSON. Am Lasttest
// gemessen: gzip macht daraus 73 KB, also 17:1. Unkomprimiert geht dieselbe
// Karte alle zwei Minuten je Betrachter in voller Groesse ueber die Leitung.
//
// IM LAN MERKT DAS NIEMAND, und das gehoert zur Aussage dazu: 1,2 MB bei
// Gigabit sind rund 10 ms. Der Hinweis zielt auf die Lage, in der Monitoring
// tatsaechlich angesehen wird — ueber VPN, aus dem Homeoffice, vom Mobil-
// geraet. Bei 10 Mbit/s wird aus 1,2 MB rund eine Sekunde, bei 2 Mbit/s
// fuenf. Das ist dort mehr, als am SQL ueberhaupt zu holen waere.
//
// Warum der Browser das feststellt und nicht PHP: das Modul weiss nicht, was
// der Webserver hinter ihm mit der Antwort macht. Die Resource-Timing-API
// weiss es — encodedBodySize ist die Groesse auf der Leitung,
// decodedBodySize die danach. Sind sie gleich, wurde nicht komprimiert.
//
// Und warum nicht selbst komprimieren (ob_gzhandler, gzencode): das ist
// Aufgabe des Webservers. Ein Modul, das sich daran vorbeimogelt, bricht
// Content-Length und Caching an Stellen, die niemand bei ihm sucht.

/** Ab welcher Antwortgroesse der Hinweis ueberhaupt lohnt. */
export const KOMPRESSION_AB = 256 * 1024;

/**
 * Welche Antworten kamen unkomprimiert an?
 *
 * Erwartet Resource-Timing-Eintraege (oder dieselbe Form). Gibt null zurueck,
 * wenn nichts zu sagen ist — lieber schweigen als raten.
 *
 * DREI FAELLE, IN DENEN KEINE AUSSAGE MOEGLICH IST, und die deshalb nicht als
 * "unkomprimiert" durchgehen duerfen:
 *
 *   transferSize === 0   aus dem Cache beantwortet, es ging nichts ueber die
 *                        Leitung. Ueber die Kompression sagt das nichts.
 *   encodedBodySize === 0 die Groesse ist nicht einsehbar (fremde Herkunft
 *                        ohne Timing-Allow-Origin).
 *   unter der Schwelle   bei kleinen Antworten ist der Hinweis Laerm.
 */
export function kompressionsBefund(eintraege, schwelle) {
    const ab = (typeof schwelle === 'number' && schwelle >= 0) ? schwelle : KOMPRESSION_AB;
    let roh = 0;
    let anzahl = 0;
    let groesste = null;
    (eintraege || []).forEach(function(e) {
        if (!e) return;
        const codiert   = Number(e.encodedBodySize) || 0;
        const decodiert = Number(e.decodedBodySize) || 0;
        const transfer  = Number(e.transferSize)    || 0;
        if (transfer <= 0 || codiert <= 0 || decodiert <= 0) return;
        if (decodiert < ab) return;
        if (codiert !== decodiert) return;          // komprimiert, alles gut
        roh += decodiert;
        anzahl++;
        if (!groesste || decodiert > groesste.bytes) {
            groesste = { name: String(e.name || ''), bytes: decodiert };
        }
    });
    return anzahl > 0 ? { anzahl: anzahl, roh: roh, groesste: groesste } : null;
}

/**
 * Aktionen, die beim blossen Ansehen der Karte entstehen.
 *
 * 'spark' faellt bei jedem Ueberfahren eines Knotens an. Auf der Lasttest-
 * Karte standen nach ein paar Sekunden Mausbewegung 35 davon gegen 6
 * data-Aufrufe im Ring — und der fasst 50. Noch etwas laenger, und genau
 * die teuren Aufrufe sind verdraengt, fuer die man diesen Tab oeffnet.
 */
const LEISE = { spark: true };

/**
 * Die Liste trennen: was gezeigt wird, und was zurueckgehalten wurde.
 *
 * Zurueckgehalten, nicht verschwiegen — die Zahl steht unter der Tabelle,
 * und in der Zusammenfassung zaehlen die Aufrufe unveraendert mit. Still
 * abzuschneiden ist in diesem Projekt nirgends der Weg.
 */
export function sichtbareAufrufe(entries) {
    const zeilen = [], verdeckt = {};
    (entries || []).forEach(function(e) {
        const a = (e && e.action) || '?';
        if (LEISE[a]) {
            verdeckt[a] = (verdeckt[a] || 0) + 1;
        } else {
            zeilen.push(e);
        }
    });
    return { zeilen: zeilen, verdeckt: verdeckt };
}

/** "35 spark" — oder leer, wenn nichts zurueckgehalten wurde. */
export function verdecktText(verdeckt) {
    const namen = Object.keys(verdeckt || {}).sort();
    if (!namen.length) return '';
    return namen.map(function(a) { return verdeckt[a] + ' ' + a; }).join(', ');
}

function _buildLog(alleEintraege, theme) {
    const geteilt  = sichtbareAufrufe(alleEintraege);
    const entries  = geteilt.zeilen;
    const verdeckt = verdecktText(geteilt.verdeckt);
    // Der Hinweis gehoert auch unter eine LEERE Tabelle: "noch keine
    // Aufrufe" waere dann schlicht falsch, es waren welche da.
    // theme.sub, nicht subSoft: 11px in der blasseren Farbe kommen auf
    // dunklem Grund kaum ueber 4:1 Kontrast, und ein Hinweis, den man
    // uebersieht, haette man auch weglassen koennen.
    const fussnote = verdeckt
        ? '<div style="color:' + theme.sub + ';font-size:11px;padding:10px 0 2px">'
            + esc(t('diag.noisy_hidden', { list: verdeckt })) + '</div>'
        : '';
    if (!entries.length) {
        return '<div style="color:' + theme.subSoft + ';padding:20px 0">'
            + esc(t('diag.no_calls')) + '</div>' + fussnote;
    }
    const rows = entries.slice().reverse().map(function(e) {
        const slowCol = (e.elapsed_ms || 0) > 1000 ? theme.crit
                      : (e.elapsed_ms || 0) > 500 ? theme.warn : theme.text;
        const cacheLbl = e.cache_hit
            ? '<span style="color:' + theme.ok + '">HIT</span>'
            : '<span style="color:' + theme.subSoft + '">—</span>';
        // Ab drei Vierteln der Grenze wird es eng genug, um es zu faerben.
        const memAnteil = (e.mem_limit_kb && e.mem_peak_kb) ? e.mem_peak_kb / e.mem_limit_kb : 0;
        const memCol = memAnteil > 0.9 ? theme.crit : memAnteil > 0.75 ? theme.warn : theme.sub;
        const countsStr = e.counts
            ? Object.keys(e.counts).map(function(k) { return k + ':' + e.counts[k]; }).join(', ')
            : '';
        const phasen = phasenZeile(e);
        return '<tr style="border-bottom:1px solid ' + theme.borderSoft + '">'
            + '<td style="padding:4px 12px;color:' + theme.sub + ';font-family:monospace">' + _ago(e.ts) + '</td>'
            + '<td style="padding:4px 12px;font-weight:600">' + esc(e.action || '?') + '</td>'
            + '<td style="padding:4px 12px;text-align:right;color:' + slowCol + ';font-family:monospace">'
                + (e.elapsed_ms || 0).toFixed(1) + ' ms</td>'
            + '<td style="padding:4px 12px;text-align:right;font-family:monospace">' + _bytes(e.bytes || 0) + '</td>'
            + '<td style="padding:4px 12px;text-align:center">' + cacheLbl + '</td>'
            + '<td style="padding:4px 12px;text-align:right;font-family:monospace;color:' + memCol + '">'
                + esc(_mem(e)) + '</td>'
            + '<td style="padding:4px 12px;color:' + theme.sub + ';font-family:monospace;font-size:11px">'
                + esc([countsStr, _proKante(e)].filter(Boolean).join(' · '))
                + (phasen
                    ? '<div style="color:' + theme.subSoft + ';margin-top:2px">' + esc(phasen) + '</div>'
                    : '')
                + '</td>'
            + '</tr>';
    }).join('');
    return '<table style="border-collapse:collapse;font-size:12px;width:100%">'
        + '<thead><tr style="border-bottom:1px solid ' + theme.border + '">'
        + [t('diag.col.ago'), 'Action', t('diag.col.latency'), 'Size', 'Cache', 'Memory', 'Counts'].map(function(h) {
            return '<th style="padding:6px 12px;text-align:left;color:' + theme.sub + ';font-weight:600">' + h + '</th>';
        }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table>' + fussnote;
}

/**
 * Link auf die Releases-Seite. Die URL kommt aus der Antwort und ist damit
 * fremder Text — die Action laesst nur https://github.com/… durch, hier
 * landet sie ueber setAttribute statt in einer HTML-Zeichenkette.
 */
/**
 * Welchen Zustand die Update-Pruefung gemeldet hat.
 *
 * Als eigene Funktion, weil die Farbe die EINZIGE schnelle Auskunft ist: den
 * Satz liest man, den Punkt sieht man. Vier Zustaende, nicht zwei — "GitHub
 * nicht erreichbar" darf weder gruen noch rot leuchten, sonst behauptet die
 * Anzeige etwas ueber die Version, das sie gar nicht weiss.
 */
export function updateZustand(d) {
    if (!d || typeof d !== 'object') return 'unknown';
    if (d.error === 'unreachable' || d.error === 'unreadable') return 'unknown';
    if (d.error) return 'error';
    return d.newer ? 'outdated' : 'current';
}

/** Farbe und Punkt zu einem Zustand. */
export function updateFarbe(zustand, theme) {
    if (zustand === 'current')  return theme.ok;
    if (zustand === 'outdated') return theme.crit;
    if (zustand === 'error')   return theme.warn;
    return theme.sub;
}

/** Eine farbige Meldung in einen Kasten setzen — ohne innerHTML. */
function zeigeMeldung(ziel, text, farbe) {
    while (ziel.firstChild) ziel.removeChild(ziel.firstChild);
    ziel.appendChild(el('div', 'color:' + farbe, text));
}

function releaseLink(url, theme) {
    const a = document.createElement('a');
    a.setAttribute('href', String(url || 'https://github.com/linuser/zabbix-network-topology/releases'));
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.style.color = theme.accent;
    a.textContent = t('diag.update.open');
    return a;
}

export function renderDiag(wrap) {
    if (window._ntCy)         { try { window._ntCy.destroy(); } catch (e) {} window._ntCy = null; }
    if (window._ntEdgeAnim)   { clearInterval(window._ntEdgeAnim);     window._ntEdgeAnim     = null; }

    const dark = isDark();
    const theme = mkTabTheme(dark);

    clearWrap(wrap);

    const root = document.createElement('div');
    root.style.cssText = 'padding:20px;background:' + theme.bg + ';color:' + theme.text
        + ';height:100%;overflow:auto;font-family:sans-serif';

    const head = document.createElement('div');
    head.innerHTML = '<h2 style="margin:0 0 6px;font-size:16px">' + t('diag.title') + '</h2>'
        + '<div style="font-size:12px;color:' + theme.sub + ';margin-bottom:18px">'
        + t('diag.intro')
        + '</div>';
    root.appendChild(head);

    // ── "Gibt es ein Update?" ──────────────────────────────────────────
    //
    // Auf Knopfdruck, nie von allein. Der Klick ist die Einwilligung: ein
    // Modul, das ungefragt nach Hause telefoniert, ist in vielen Haeusern
    // ein Richtlinienverstoss, und in einem abgeschotteten Netz eine
    // Abfrage, die ins Leere laeuft. Deshalb steht hier ein Knopf und kein
    // Hintergrundtakt — und deshalb ist "nicht erreichbar" hier eine
    // Antwort und keine Fehlermeldung.
    //
    // Der Abschnitt liegt im Diag-Tab, weil den ohnehin nur Super-Admins
    // sehen — und nur wer das Modul austauschen kann, soll den Hinweis
    // bekommen.
    const updWrap = document.createElement('div');
    updWrap.style.marginBottom = '24px';
    // Ueberschrift ueber el(): der Text geht durch textContent. Die
    // Nachbarabschnitte dieses Tabs setzen innerHTML, das ist Bestand —
    // neue Stellen kommen ohne aus, sonst waechst die ESLint-Baseline.
    updWrap.appendChild(el('h3',
        'margin:0 0 8px;font-size:13px;color:' + theme.sub
        + ';text-transform:uppercase;letter-spacing:0.04em',
        t('diag.update.title')));
    const updRow = document.createElement('div');
    updRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    const updBtn = document.createElement('button');
    updBtn.type = 'button';
    updBtn.textContent = t('diag.update.check');
    updBtn.style.cssText = 'padding:4px 12px;border:1px solid ' + theme.border
        + ';border-radius:4px;background:' + theme.surface + ';color:' + theme.text
        + ';font-size:12px;font-family:inherit;cursor:pointer';
    const updOut = document.createElement('div');
    updOut.style.cssText = 'font-size:12px;color:' + theme.sub;
    updOut.textContent = t('diag.update.idle');
    updRow.appendChild(updBtn);
    updRow.appendChild(updOut);
    updWrap.appendChild(updRow);
    root.appendChild(updWrap);

    updBtn.addEventListener('click', function() {
        updBtn.disabled = true;
        updOut.style.color = theme.sub;
        updOut.style.fontWeight = 'normal';
        updOut.textContent = t('diag.update.checking');
        fetchJson(buildBaseUrl() + 'zabbix.php?action=network.topology.update_check')
            .then(function(d) {
                updBtn.disabled = false;
                // Kein Unterschied zwischen DNS, Firewall, Proxy und einem
                // Fehler bei GitHub: fuer den Fragenden ist die Antwort
                // dieselbe, und Innenleben hilft ihm nicht weiter.
                while (updOut.firstChild) updOut.removeChild(updOut.firstChild);
                const _zustand = updateZustand(d);
                updOut.style.color = updateFarbe(_zustand, theme);
                updOut.style.fontWeight = (_zustand === 'current' || _zustand === 'outdated')
                    ? '600' : 'normal';
                if (d.error === 'unreachable' || d.error === 'unreadable') {
                    updOut.appendChild(document.createTextNode(
                        '\u25cf ' + t('diag.update.unreachable') + ' '));
                    updOut.appendChild(releaseLink(d.url, theme));
                    return;
                }
                if (d.error) {
                    updOut.textContent = '\u25cf ' + String(d.error);
                    return;
                }
                updOut.appendChild(document.createTextNode('\u25cf '));
                if (d.newer) {
                    updOut.appendChild(el('b', '', t('diag.update.available', { v: d.latest || '?' })));
                    updOut.appendChild(document.createTextNode(
                        ' ' + t('diag.update.you_have', { v: d.current || '?' })
                        + (d.published ? ' \u00b7 ' + d.published : '') + ' '));
                    updOut.appendChild(releaseLink(d.url, theme));
                }
                else {
                    updOut.appendChild(el('b', '', t('diag.update.current', { v: d.current || '?' })));
                }
            })
            .catch(function(err) {
                updBtn.disabled = false;
                // Zwei verschiedene Fehlschlaege, und nur einer davon ist
                // absichtlich wortkarg: dass GitHub von diesem Server aus
                // nicht erreichbar ist, kommt als {error:'unreachable'} in
                // einer gelungenen Antwort an — ob DNS, Firewall oder Proxy,
                // sagen wir bewusst nicht. Scheitert dagegen die eigene
                // Abfrage, waere "GitHub nicht erreichbar" schlicht falsch:
                // dann hat das eigene Zabbix geantwortet, und fetchJson weiss
                // womit.
                updOut.style.color = theme.warn;
                updOut.textContent = '\u25cf ' + ((err && err.message)
                    ? err.message
                    : t('diag.update.unreachable'));
            });
    });

    // ── Kompression ────────────────────────────────────────────────────
    //
    // Nur wenn es etwas zu sagen gibt: kompressionsBefund() liefert null,
    // sobald die Lage unklar oder die Antwort klein ist. Ein Hinweis, der
    // immer dasteht, wird nicht gelesen.
    const befund = (typeof performance !== 'undefined' && performance.getEntriesByType)
        ? kompressionsBefund(performance.getEntriesByType('resource'))
        : null;
    if (befund) {
        const kWrap = document.createElement('div');
        kWrap.style.marginBottom = '24px';
        kWrap.appendChild(el('h3',
            'margin:0 0 8px;font-size:13px;color:' + theme.sub
            + ';text-transform:uppercase;letter-spacing:0.04em',
            t('diag.gzip.title')));
        const kBox = el('div',
            'font-size:12px;line-height:1.6;padding:10px 12px;border-radius:4px;'
            + 'border:1px solid ' + theme.border + ';background:' + theme.surface
            + ';color:' + theme.text);
        kBox.appendChild(el('div', 'font-weight:600;margin-bottom:4px',
            t('diag.gzip.found', { n: befund.anzahl, size: _bytes(befund.roh) })));
        const kZahl = el('div', 'color:' + theme.sub, t('diag.gzip.measuring'));
        kBox.appendChild(kZahl);
        kBox.appendChild(el('div', 'color:' + theme.sub + ';margin-top:6px',
            t('diag.gzip.how')));
        kWrap.appendChild(kBox);
        root.appendChild(kWrap);

        // DIE ERSPARNIS WIRD GEMESSEN, NICHT GESCHAETZT — und ohne dafuer
        // etwas nachzuladen: window._ntLastData liegt bereits im Speicher,
        // neu serialisiert ergibt es dieselbe Nutzlast. Ein Verhaeltnis aus
        // einer Faustregel waere hier besonders unangebracht, weil es genau
        // die Zahl ist, auf die hin jemand seinen Webserver umstellt.
        (function() {
            const roh = window._ntLastData;
            if (!roh || typeof CompressionStream === 'undefined') {
                kZahl.textContent = t('diag.gzip.unknown');
                return;
            }
            try {
                const bytes = new TextEncoder().encode(JSON.stringify(roh));
                const cs = new CompressionStream('gzip');
                const w  = cs.writable.getWriter();
                w.write(bytes);
                w.close();
                new Response(cs.readable).arrayBuffer().then(function(buf) {
                    const gz = buf.byteLength;
                    kZahl.textContent = t('diag.gzip.measured', {
                        raw:   _bytes(bytes.length),
                        gz:    _bytes(gz),
                        ratio: (bytes.length / Math.max(1, gz)).toFixed(1)
                    });
                }).catch(function() { kZahl.textContent = t('diag.gzip.unknown'); });
            } catch (e) {
                kZahl.textContent = t('diag.gzip.unknown');
            }
        })();
    }

    // Verlauf ueber Tage — gefuellt, sobald die Antwort da ist. Der Abschnitt
    // bleibt leer, wenn es weniger als zwei Tage mit Aufrufen gibt: ein
    // einzelner Tag ist kein Verlauf.
    const tageWrap = document.createElement('div');
    tageWrap.style.marginBottom = '24px';
    tageWrap.style.display = 'none';
    tageWrap.appendChild(el('h3',
        'margin:0 0 8px;font-size:13px;color:' + theme.sub
        + ';text-transform:uppercase;letter-spacing:0.04em',
        t('diag.days.title')));
    const tageBody = document.createElement('div');
    tageWrap.appendChild(tageBody);
    root.appendChild(tageWrap);

    const summaryWrap = document.createElement('div');
    summaryWrap.style.marginBottom = '24px';
    const summaryHead = document.createElement('div');
    summaryHead.innerHTML = '<h3 style="margin:0 0 8px;font-size:13px;color:' + theme.sub
        + ';text-transform:uppercase;letter-spacing:0.04em">' + t('diag.summary') + '</h3>';
    summaryWrap.appendChild(summaryHead);
    const summaryBody = document.createElement('div');
    summaryBody.innerHTML = '<div style="color:' + theme.subSoft + '">' + t('common.loading') + '</div>';
    summaryWrap.appendChild(summaryBody);
    root.appendChild(summaryWrap);

    const logHead = document.createElement('div');
    logHead.innerHTML = '<h3 style="margin:0 0 8px;font-size:13px;color:' + theme.sub
        + ';text-transform:uppercase;letter-spacing:0.04em">' + t('diag.recent') + '</h3>';
    root.appendChild(logHead);
    const logBody = document.createElement('div');
    logBody.innerHTML = '<div style="color:' + theme.subSoft + '">' + t('common.loading') + '</div>';
    root.appendChild(logBody);

    wrap.appendChild(root);

    const url = buildBaseUrl() + 'zabbix.php?action=network.topology.diag';
    fetchJson(url, {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
        .then(function(data) {
            if (data.error) {
                zeigeMeldung(summaryBody, data.error, theme.crit);
                logBody.innerHTML = '';
                return;
            }
            if (!data.apcu) {
                zeigeMeldung(summaryBody, t('diag.no_apcu'), theme.warn);
                logBody.innerHTML = '';
                return;
            }
            const entries = data.entries || [];
            summaryBody.innerHTML = _buildSummary(_aggStats(entries), theme);
            logBody.innerHTML     = _buildLog(entries, theme);
            const verlauf = _buildTage(data.days, data.trend, theme);
            if (verlauf) {
                while (tageBody.firstChild) tageBody.removeChild(tageBody.firstChild);
                tageBody.appendChild(verlauf);
                tageBody.appendChild(el('div',
                    'font-size:11px;color:' + theme.subSoft + ';margin-top:8px;line-height:1.5',
                    t('diag.days.hint')));
                tageWrap.style.display = '';
            }
        })
        .catch(function(e) {
            zeigeMeldung(summaryBody, t('diag.error', { msg: e.message }), theme.crit);
            logBody.innerHTML = '';
        });
}
