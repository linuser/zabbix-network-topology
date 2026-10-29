/*
 * NT Health Score — Dashboard Widget
 * PlaNet Fox | Alexander Fox
 * Compatible with Zabbix 7.4 jsLoader (no template literals, no spread, no const).
 *
 * Berechnet pro Hostgroup einen Score 0-100 aus den Daten des Hauptmoduls:
 *   100 − offline%·40 − stale%·15 − critical%·25 − unacked%·20
 *
 * Die Logik spiegelt assets/js/modules/render-health.js des Hauptmoduls
 * (ES5-konform fuer den Widget-Loader dupliziert — keine ESM-Imports
 * verfuegbar). Wenn sich die Formel im Haupt-Tab aendert, hier mitziehen;
 * tools/check-parity.mjs vergleicht Gewichte und Schwellen und bricht die
 * CI ab, wenn beide auseinanderlaufen.
 */

/*
 * Geteilter Datenzugriff fuer alle NT-Widgets.
 *
 * Liegen mehrere davon auf einem Dashboard, fragen sie dieselbe Action mit
 * denselben Hostgruppen ab — network.topology.data, laut eigenem Kommentar
 * "der teuerste Endpoint" (Host + Trigger + Problem + Item + Lastvalues +
 * LLDP). Ein Response-Cache existiert serverseitig nicht; NtCache haelt nur
 * die Topologie-Baseline. Drei Widgets bedeuteten also drei volle Laeufe.
 *
 * Deshalb hier zwei Dinge:
 *   Coalescing  laeuft schon eine Anfrage fuer denselben Schluessel, bekommen
 *               alle Aufrufer dasselbe Promise statt einer zweiten Anfrage.
 *   Kurzer TTL  ein frisches Ergebnis wird ein paar Sekunden weitergereicht.
 *               15 s liegen deutlich unter jedem Refresh-Intervall, die Daten
 *               sind also nie aelter als eine Runde.
 *
 * Fehler werden NICHT gecacht — sonst haengt ein Aussetzer 15 s lang an allen
 * Widgets. Definiert wird nur einmal; welches Widget zuerst laedt, ist egal.
 */
// ERZEUGT aus tools/widget-shared.js — dort bearbeiten, nicht hier.
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

// ERZEUGT aus tools/widget-shared.js — dort bearbeiten, nicht hier.
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

// ERZEUGT aus tools/widget-shared.js — dort bearbeiten, nicht hier.
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

class WidgetNetworkTopologyHealth extends CWidget {

    onInitialize() {
        this._groupids    = [];
        this._worstFirst  = true;
        this._maxGroups   = 0;
        this._showLegend  = true;
        this._STALE_S     = 300;
        this._COL_OK      = '#16a34a';
        this._COL_WARN    = '#f59e0b';
        this._COL_BAD     = '#f97316';
        this._COL_CRIT    = '#dc2626';
        this._COL_TEXT    = '#1f2c33';
        this._COL_SUB     = '#768d99';
        this._COL_SUBSOFT = '#a4afb5';
        this._COL_BORDER  = '#dfe4e7';
        this._COL_SURFACE = '#f8fafc';
    }

    onStart() {
        var root = this._target.querySelector('.nt-health-widget-canvas');
        if (root) {
            this._worstFirst = root.dataset.worstFirst !== '0';
            this._maxGroups  = parseInt(root.dataset.maxGroups || '0', 10) || 0;
            this._showLegend = root.dataset.showLegend !== '0';
            try {
                this._groupids = JSON.parse(root.dataset.groupids || '[]');
            } catch (e) {
                this._groupids = [];
            }
            // s. Topology-Widget: data-groupids kommt leer an, die Feldwerte
            // stehen nur in this._fields. Ohne Fallback haengt das Widget je
            // nach Timing auf "Loading...".
            if (!this._groupids.length && this._fields && this._fields.groupids) {
                this._groupids = this._fields.groupids;
            }
        } else {
            // Fallback wie im Topology-Widget: bei onStart ist die View-DOM in
            // Zabbix 7 haeufig noch nicht gesetzt -> die Config direkt aus
            // this._fields lesen statt aus data-* am (noch fehlenden) Canvas.
            // Ohne das blieb this._groupids leer, das Widget fetchte NIE und
            // haengte auf "Loading...".
            this._worstFirst = this._fields.worst_first !== false && this._fields.worst_first !== 0;
            this._maxGroups  = parseInt(this._fields.max_groups || 0, 10) || 0;
            this._showLegend = this._fields.show_legend !== false && this._fields.show_legend !== 0;
            this._groupids   = this._fields.groupids || [];
        }
    }

    /*
     * Refresh ueber Zabbix' eigenen Update-Zyklus statt ueber einen Timer.
     * Begruendung wie im Tabellen-Widget: die Basisklasse ruft periodisch die
     * View-Action und ersetzt den Koerper durch den "Loading..."-Platzhalter;
     * ein danebenlaufender setInterval fuellte ihn erst bis zu 60 s spaeter.
     * Jetzt haengt das Rendern hinter super.promiseUpdate(), und die Kadenz
     * bestimmt die Refresh-Einstellung des Dashboards.
     */
    promiseUpdate() {
        var self = this;
        return Promise.resolve(super.promiseUpdate()).then(function () {
            return self._loadAndRender();
        });
    }

    _loadAndRender() {
        var self = this;
        var ids = this._groupids;
        if (!ids || !ids.length) {
            // Backend liefert ohne groupids nichts — UX-Hinweis statt 0/0
            this._renderError('Select host groups in the widget configuration.');
            return Promise.resolve();
        }
        return window.NtWidgetData(ids)
            .then(function(data) {
                if (data && data.error) {
                    self._renderError(String(data.error));
                    return;
                }
                self._render((data && data.nodes) || []);
            })
            .catch(function(e) {
                self._renderError(e && e.message || 'Request failed');
            });
    }

    _statsByGroup(nodes) {
        var now = Math.floor(Date.now() / 1000);
        var byGroup = {};
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (n._isInternet) continue;
            var gs = n.groups || [];
            for (var j = 0; j < gs.length; j++) {
                var g = gs[j];
                if (!g) continue;
                if (!byGroup[g]) byGroup[g] = {
                    name: g, total: 0, offline: 0, stale: 0, critical: 0, unacked: 0
                };
                var s = byGroup[g];
                s.total++;
                var isOff = !!n.unavailable;
                if (isOff) s.offline++;
                var age = n.last_seen ? (now - n.last_seen) : 0;
                if (!isOff && n.last_seen > 0 && age > this._STALE_S) s.stale++;
                if ((n.severity || 0) >= 4) s.critical++;
                if ((n.problems || 0) > 0 && !n.acknowledged) s.unacked++;
            }
        }
        var out = [];
        for (var k in byGroup) {
            if (Object.prototype.hasOwnProperty.call(byGroup, k)) {
                var s2 = byGroup[k];
                var t  = Math.max(1, s2.total);
                var score = 100
                    - (s2.offline  / t) * 40
                    - (s2.stale    / t) * 15
                    - (s2.critical / t) * 25
                    - (s2.unacked  / t) * 20;
                s2.score = Math.max(0, Math.min(100, Math.round(score)));
                out.push(s2);
            }
        }
        return out;
    }

    _scoreColor(s) {
        if (s >= 85) return this._COL_OK;
        if (s >= 65) return this._COL_WARN;
        if (s >= 40) return this._COL_BAD;
        return this._COL_CRIT;
    }

    _scoreLabel(s) {
        if (s >= 85) return 'Healthy';
        if (s >= 65) return 'OK';
        if (s >= 40) return 'Warning';
        return 'Critical';
    }

    _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    _metricCell(num, lbl, color) {
        var c = num > 0 ? color : this._COL_SUBSOFT;
        return '<div style="display:flex;flex-direction:column;align-items:center;min-width:40px">'
            + '<span style="font-size:14px;font-weight:700;color:' + c + ';font-family:monospace">'
            +     num + '</span>'
            + '<span style="font-size:9px;color:' + this._COL_SUB + ';text-transform:uppercase">'
            +     this._esc(lbl) + '</span>'
            + '</div>';
    }

    _cardHtml(s) {
        var col = this._scoreColor(s.score);
        var lbl = this._scoreLabel(s.score);
        return '<div style="background:' + this._COL_SURFACE + ';border:1px solid ' + this._COL_BORDER
            + ';border-left:4px solid ' + col + ';border-radius:4px;padding:10px 12px;'
            + 'display:flex;align-items:center;gap:14px;min-width:0">'
            + '<div style="display:flex;flex-direction:column;align-items:center;min-width:60px">'
            +   '<span style="font-size:24px;font-weight:700;color:' + col + ';line-height:1;font-family:monospace">'
            +     s.score + '</span>'
            +   '<span style="font-size:9px;color:' + col + ';font-weight:700;text-transform:uppercase;margin-top:2px">'
            +     this._esc(lbl) + '</span>'
            + '</div>'
            + '<div style="flex:1;display:flex;flex-direction:column;gap:4px;min-width:0">'
            +   '<div style="font-size:12px;font-weight:700;color:' + this._COL_TEXT + ';'
            +     'overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + this._esc(s.name) + '">'
            +     this._esc(s.name)
            +     ' <span style="font-weight:400;color:' + this._COL_SUB + '">· ' + s.total + '</span></div>'
            +   '<div style="display:flex;gap:10px">'
            +     this._metricCell(s.offline,  'Off',  this._COL_CRIT)
            +     this._metricCell(s.stale,    'Stl',  this._COL_WARN)
            +     this._metricCell(s.critical, 'Crit', this._COL_CRIT)
            +     this._metricCell(s.unacked,  'Unack', this._COL_BAD)
            +   '</div>'
            + '</div>'
            + '</div>';
    }

    _applyTheme(root) {
        // Farben frisch aus dem geteilten NtTheme (gemessenes hell/dunkel).
        var p = window.NtTheme.palette(window.NtTheme.isDark(root));
        this._COL_OK      = p.ok;
        this._COL_WARN    = p.warn;
        this._COL_BAD     = p.bad;
        this._COL_CRIT    = p.crit;
        this._COL_TEXT    = p.text;
        this._COL_SUB     = p.sub;
        this._COL_SUBSOFT = p.subSoft;
        this._COL_BORDER  = p.border;
        this._COL_SURFACE = p.surface;
    }

    _render(nodes) {
        var root = this._target.querySelector('.nt-health-widget-canvas');
        if (!root) return;
        this._applyTheme(root);
        var stats = this._statsByGroup(nodes);
        if (this._worstFirst) {
            stats.sort(function(a, b) { return a.score - b.score; });
        } else {
            stats.sort(function(a, b) { return b.score - a.score; });
        }
        if (this._maxGroups > 0) stats = stats.slice(0, this._maxGroups);

        if (stats.length === 0) {
            root.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;'
                + 'height:100%;color:' + this._COL_SUBSOFT + ';font-size:11px">'
                + 'No host groups found.</div>';
            return;
        }

        var totScore = 0, minScore = 100;
        for (var i = 0; i < stats.length; i++) {
            totScore += stats[i].score;
            if (stats[i].score < minScore) minScore = stats[i].score;
        }
        var avg = Math.round(totScore / stats.length);

        var html = ''
            + '<div style="padding:10px 12px;font-family:sans-serif">'
            + '<div style="font-size:11px;color:' + this._COL_SUB + ';margin-bottom:8px">'
            +   stats.length + (stats.length === 1 ? ' group' : ' groups') + ' · avg '
            +   '<b style="color:' + this._scoreColor(avg)      + '">' + avg      + '</b> · min '
            +   '<b style="color:' + this._scoreColor(minScore) + '">' + minScore + '</b>'
            + '</div>'
            + '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(240px, 1fr));gap:8px">';
        for (var k = 0; k < stats.length; k++) html += this._cardHtml(stats[k]);
        html += '</div>';
        if (this._showLegend) {
            html += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid ' + this._COL_BORDER
                + ';font-size:10px;color:' + this._COL_SUB + ';display:flex;gap:12px;flex-wrap:wrap">'
                + '<span><b style="color:' + this._COL_OK   + '">85+</b> Healthy</span>'
                + '<span><b style="color:' + this._COL_WARN + '">65-85</b> OK</span>'
                + '<span><b style="color:' + this._COL_BAD  + '">40-65</b> Warning</span>'
                + '<span><b style="color:' + this._COL_CRIT + '">&lt;40</b> Critical</span>'
                + '</div>';
        }
        html += '</div>';
        root.innerHTML = html;
    }

    _renderError(msg) {
        var root = this._target.querySelector('.nt-health-widget-canvas');
        if (!root) return;
        this._applyTheme(root);
        root.innerHTML = '<div style="padding:14px;color:' + this._COL_CRIT + ';font-size:12px">'
            + 'Health widget: main module not reachable (' + this._esc(msg) + ')</div>';
    }
}
