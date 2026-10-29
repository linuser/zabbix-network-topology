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

// window.NtTheme — geteiltes Theme fuer alle NT-Widgets. Dasselbe Prinzip wie
// die Hauptkarte (tabs.js: seiteIstDunkel), nur ES5 und ohne Modulimport:
// isDark() MISST den Hintergrund (relative Luminanz nach WCAG) statt den
// Theme-Namen zu raten — ein eigenes dunkles Zabbix-Theme ("corporate") oder
// das neue Dark-Blue in Zabbix 8.0 wuerde ein namensbasierter Test uebersehen,
// und das Widget stuende hell in einem dunklen Dashboard. palette() liefert die
// Token fuer hell und dunkel, abgestimmt mit den --nt-*-Farben des Hauptmoduls
// (assets/css/network-topology.css). Geht in ALLE FUENF Widgets.
if (!window.NtTheme) {
    window.NtTheme = {
        isDark: function (el) {
            try {
                var node = el || document.body;
                while (node && node.nodeType === 1) {
                    var bg = window.getComputedStyle(node).backgroundColor || '';
                    var m = bg.replace(/\s/g, '').match(/^rgba?\((\d+),(\d+),(\d+)(?:,([0-9.]+))?\)$/i);
                    if (m) {
                        var a = m[4] === undefined ? 1 : parseFloat(m[4]);
                        if (a > 0.1) {
                            var lin = function (v) {
                                v = parseInt(v, 10) / 255;
                                return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
                            };
                            var L = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
                            return L < 0.4;
                        }
                    }
                    node = node.parentNode;
                }
            } catch (e) {}
            return false;
        },
        palette: function (dark) {
            // sev[] ist die Severity-Skala (Normal, Info, Warning, Average,
            // High, Disaster) fuer Punkte/Balken in Topology- und Table-Widget.
            // head = Kopfzeilen-/Flaechenton eine Stufe von surface abgesetzt.
            return dark ? {
                text:    '#e6edf3',
                ok:      '#4ade80',
                warn:    '#fbbf24',
                bad:     '#fb923c',
                crit:    '#fca5a5',
                link:    '#a78bfa',
                accent:  '#58a6ff',
                ghost:   '#8b949e',
                sub:     '#8b949e',
                subSoft: '#6e7681',
                border:  '#30363d',
                track:   '#21262d',
                surface: '#161b22',
                head:    '#1c2128',
                sev:     ['#4ade80', '#22d3ee', '#fbbf24', '#fb923c', '#f87171', '#dc2626']
            } : {
                text:    '#1f2c33',
                ok:      '#166534',
                warn:    '#92400e',
                bad:     '#c2410c',
                crit:    '#9c1a25',
                link:    '#7c3aed',
                accent:  '#0275b8',
                ghost:   '#64748b',
                sub:     '#64748b',
                subSoft: '#94a3b8',
                border:  '#dfe4e7',
                track:   '#eef2f5',
                surface: '#f8fafc',
                head:    '#f1f5f9',
                sev:     ['#16a34a', '#0891b2', '#ca8a04', '#ea580c', '#dc2626', '#991b1b']
            };
        }
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
