// nt-widget-data.js — die EINE Quelle fuer window.NtWidgetData.
//
// WARUM DIESE DATEI EXISTIERT
// ---------------------------
// Widgets koennen den Code des Hauptmoduls nicht importieren: Zabbix'
// jsLoader kennt keine ES-Module. Der geteilte Datenzugriff lag deshalb
// byteweise identisch in vier Widget-Dateien, und eine Aenderung hiess
// vier Aenderungen — `ci:parity` merkte es, aber erst hinterher.
//
// Jetzt wird er von hier aus in die Widget-Dateien GESCHRIEBEN
// (`node tools/sync-widget-shared.mjs`, laeuft in `npm run build`), und
// `ci:parity` vergleicht die Kopien zusaetzlich gegen diese Datei. Bearbeitet
// wird nur noch hier.
//
// Nachladen zur Laufzeit waere der andere Weg — das Widget holt sich
// Cytoscape schon aus dem Hauptmodul-Verzeichnis. Eine zweite asynchrone
// Abhaengigkeit in den am wenigsten getesteten Teil zu bauen, ist aber ein
// anderes Risiko als eine erzeugte Kopie im Commit, und erzeugte Dateien
// sind hier ohnehin Hausbrauch: das Bundle liegt auch im Repository.
//
// ES5, wie alles in widget*/: keine Template-Literale, kein Spread, keine
// Pfeilfunktionen, `var` statt `const`/`let`.

// window.NtFetchJson — das ES5-Gegenstueck zu assets/js/modules/http.js.
// Ein fetch().then(r => r.json()) ohne Statuspruefung zeigte bei einem 504
// von nginx nur "Unexpected token '<' ... is not valid JSON". Dieser Block
// geht in ALLE FUENF Widgets, auch widget_items (eigene Action, braucht ihn
// genauso); NtWidgetData darunter nur in vier. Texte schlicht Englisch —
// in Widgets gibt es kein t().
if (!window.NtFetchJson) {
    window.NtFetchJson = function (url, opts) {
        return fetch(url, opts).then(
            function (r) {
                var s = r.status;
                if (!r.ok) {
                    if (s === 502 || s === 503 || s === 504) {
                        throw new Error('The server did not answer in time (HTTP ' + s + '). The request was probably too large \u2014 select fewer host groups.');
                    }
                    // Auf einem Dashboard faellt eine abgelaufene Sitzung
                    // zuerst hier auf: die Kacheln laden im Hintergrund weiter,
                    // waehrend niemand mehr angemeldet ist.
                    if (s === 401 || s === 403) {
                        throw new Error('No permission for this request any more (HTTP ' + s + '). Usually the session has expired \u2014 reload the page and sign in again.');
                    }
                    throw new Error('The server answered with HTTP ' + s + (r.statusText ? ' ' + r.statusText : ''));
                }
                return r.text().then(function (body) {
                    try {
                        return JSON.parse(body);
                    } catch (e) {
                        // Der Anfang der Antwort sagt, wo man nachsieht: nginx,
                        // Anmeldeseite oder PHP-Fatal. Spitze Klammern fallen
                        // weg, der Text kann in einer Kachel landen.
                        var anf = String(body).replace(/[<>&"']/g, ' ').replace(/\s+/g, ' ').replace(/^ /, '').substring(0, 60);
                        throw new Error('The server sent a web page instead of data \u2014 the session may have expired, or PHP failed. Reload the page.'
                            + (anf ? ' The answer began with: ' + anf : ''));
                    }
                });
            },
            function () {
                throw new Error('The server could not be reached. Check the network connection and reload the page.');
            }
        );
    };
}

if (!window.NtWidgetData) {
    window.NtWidgetData = (function () {
        var cache = {};
        var TTL   = 15000;

        return function (groupids) {
            var ids = (groupids || []).map(String).sort();
            var key = ids.join(',');
            var now = new Date().getTime();
            var hit = cache[key];

            if (hit && (now - hit.t) < TTL) {
                return hit.p;
            }

            var params = new URLSearchParams();
            params.append('action', 'network.topology.data');
            for (var i = 0; i < ids.length; i++) {
                params.append('groupids[]', ids[i]);
            }
            // Widgets haben keinen View-Controller und bekommen manuelle
            // Verbindungen sonst nie zu sehen — das Hauptmodul zaehlte sie mit,
            // die Widgets nicht. Server liefert nur die GETEILTE Ebene.
            params.append('manual_links', '1');

            var p = window.NtFetchJson('zabbix.php?' + params.toString(), {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            p.catch(function () {
                if (cache[key] && cache[key].p === p) { delete cache[key]; }
            });

            cache[key] = { t: now, p: p };
            return p;
        };
    })();
}
