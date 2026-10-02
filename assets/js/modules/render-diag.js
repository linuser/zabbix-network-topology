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
        })
        .catch(function(e) {
            zeigeMeldung(summaryBody, t('diag.error', { msg: e.message }), theme.crit);
            logBody.innerHTML = '';
        });
}
