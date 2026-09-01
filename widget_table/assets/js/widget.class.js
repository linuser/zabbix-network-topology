/*
 * NT Table — Dashboard Widget
 * PlaNet Fox | Alexander Fox
 * Compatible with Zabbix 7.4 jsLoader (ES5-Stil: keine Template-Literals,
 * kein Spread, kein const/let, keine Arrow-Functions).
 *
 * Rendert eine kompakte Tabellen-Ansicht (Nagios-/Icinga-Style Hostliste) aus
 * den Daten des Hauptmoduls (network.topology.data): Status, Host, CPU,
 * Mem, Ping, Traffic, Probleme. Spiegelt eine reduzierte Variante von
 * assets/js/modules/render-table.js — ES5-konform fuer den Widget-Loader
 * dupliziert (keine ESM-Imports verfuegbar).
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

            var p = fetch('zabbix.php?' + params.toString(), {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            }).then(function (r) { return r.json(); });

            p.catch(function () {
                if (cache[key] && cache[key].p === p) { delete cache[key]; }
            });

            cache[key] = { t: now, p: p };
            return p;
        };
    })();
}

class WidgetNetworkTopologyTable extends CWidget {

    onInitialize() {
        this._groupids     = [];
        this._hideOffline  = false;
        this._problemsOnly = false;
        this._maxRows      = 0;
        this._STALE_S      = 300;
        // Severity 0..5 (0 = OK). Farben angelehnt an Zabbix-Severity + OK-Gruen.
        this._SEV_NAME = ['Normal', 'Info', 'Warning', 'Average', 'High', 'Disaster'];
        this._SEV_COL  = ['#16a34a', '#7499ff', '#f2c14e', '#ffa059', '#e97659', '#e45959'];
        this._COL_TEXT    = '#1f2c33';
        this._COL_SUB     = '#768d99';
        this._COL_SUBSOFT = '#a4afb5';
        this._COL_BORDER  = '#dfe4e7';
        this._COL_HEAD    = '#f8fafc';
        this._COL_OFF     = '#97a3ab';
        this._COL_STALE   = '#f59e0b';
        this._COL_CRIT    = '#dc2626';
    }

    onStart() {
        var root = this._target.querySelector('.nt-table-widget-canvas');
        if (root) {
            this._hideOffline  = root.dataset.hideOffline === '1';
            this._problemsOnly = root.dataset.problemsOnly === '1';
            this._maxRows      = parseInt(root.dataset.maxRows || '0', 10) || 0;
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
            // Fallback: in Zabbix 7 ist die View-DOM bei onStart oft noch nicht
            // gesetzt -> Config direkt aus this._fields lesen (sonst haengt das
            // Widget auf "Loading...", weil _groupids leer bleibt).
            this._hideOffline  = this._fields.hide_offline === 1 || this._fields.hide_offline === true;
            this._problemsOnly = this._fields.problems_only === 1 || this._fields.problems_only === true;
            this._maxRows      = parseInt(this._fields.max_rows || 0, 10) || 0;
            this._groupids     = this._fields.groupids || [];
        }
    }

    /*
     * Refresh laeuft ueber Zabbix' eigenen Update-Zyklus, nicht ueber einen
     * eigenen Timer.
     *
     * Vorher stand hier ein setInterval — parallel dazu ruft die Basisklasse
     * aber ohnehin periodisch die View-Action auf und ersetzt den Widget-
     * Koerper durch frisches View-HTML. Das enthaelt den "Loading..."-
     * Platzhalter, den unser Timer erst bis zu 30 s spaeter wieder ueberschrieb:
     * das Widget flackerte regelmaessig auf "Loading..." zurueck. Im Zugriffslog
     * der Demo war der zweite Zyklus als POST auf
     * widget.network_topology_table_widget.view alle 60 s sichtbar.
     *
     * Jetzt haengt das Rendern hinter super.promiseUpdate(): erst holt die
     * Basisklasse den Koerper, dann fuellen wir ihn — in derselben Promise-
     * Kette, waehrend der Preloader noch laeuft. Nebenbei gilt damit die
     * Refresh-Einstellung des Dashboards statt einer fest verdrahteten Zahl,
     * und bei inaktiver Seite pausiert der Zyklus von selbst.
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
            this._renderError('Select host groups in the widget configuration.');
            return Promise.resolve();
        }
        return window.NtWidgetData(ids)
            .then(function(data) {
                if (data && data.error) { self._renderError(String(data.error)); return; }
                self._render((data && data.nodes) || []);
            })
            .catch(function(e) { self._renderError((e && e.message) || 'Request failed'); });
    }

    _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    _pct(v) {
        return (v == null) ? '' : (Math.round(Number(v)) + '%');
    }

    _ms(v) {
        if (v == null) return '';
        v = Number(v);
        return (v < 10 ? v.toFixed(1) : String(Math.round(v))) + ' ms';
    }

    _bps(bps) {
        bps = Number(bps) || 0;
        if (bps <= 0) return '';
        if (bps < 1e3) return Math.round(bps) + ' bps';
        if (bps < 1e6) return (bps / 1e3).toFixed(1) + ' Kbps';
        if (bps < 1e9) return (bps / 1e6).toFixed(1) + ' Mbps';
        return (bps / 1e9).toFixed(1) + ' Gbps';
    }

    _status(n) {
        var now = Math.floor(Date.now() / 1000);
        if (n.unavailable) return { label: 'Offline', color: this._COL_OFF };
        if (n.last_seen > 0 && (now - n.last_seen) > this._STALE_S) {
            return { label: 'Stale', color: this._COL_STALE };
        }
        var sev = n.severity || 0;
        if (sev < 0) sev = 0; if (sev > 5) sev = 5;
        return { label: this._SEV_NAME[sev], color: this._SEV_COL[sev] };
    }

    _render(nodes) {
        var root = this._target.querySelector('.nt-table-widget-canvas');
        if (!root) return;

        // Filtern: keine Internet-Wolke, keine Ghost-Knoten; Offline-/Problem-Filter
        var rows = [];
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (n._isInternet || n._isGhost) continue;
            if (this._hideOffline && n.unavailable) continue;
            if (this._problemsOnly && !((n.problems || 0) > 0)) continue;
            rows.push(n);
        }

        // Sort: Offline zuerst, dann hoechste Severity, dann Name.
        rows.sort(function(a, b) {
            var ao = a.unavailable ? 1 : 0, bo = b.unavailable ? 1 : 0;
            if (ao !== bo) return bo - ao;
            var as = a.severity || 0, bs = b.severity || 0;
            if (as !== bs) return bs - as;
            return String(a.label || '').localeCompare(String(b.label || ''));
        });

        var total = rows.length;
        if (this._maxRows > 0 && rows.length > this._maxRows) rows = rows.slice(0, this._maxRows);

        if (total === 0) {
            root.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;'
                + 'height:100%;color:' + this._COL_SUBSOFT + ';font-size:11px">Keine Hosts.</div>';
            return;
        }

        var th = 'text-align:left;padding:4px 8px;font-size:9px;text-transform:uppercase;'
            + 'letter-spacing:.03em;color:' + this._COL_SUB + ';border-bottom:1px solid ' + this._COL_BORDER
            + ';position:sticky;top:0;background:' + this._COL_HEAD + ';white-space:nowrap';
        var thR = th + ';text-align:right';
        var td  = 'padding:4px 8px;border-bottom:1px solid ' + this._COL_BORDER + ';white-space:nowrap';
        var tdR = td + ';text-align:right;font-family:monospace';

        var html = '<div style="font-family:sans-serif;font-size:11px">'
            + '<table style="width:100%;border-collapse:collapse">'
            + '<thead><tr>'
            +   '<th style="' + th  + '">Status</th>'
            +   '<th style="' + th  + '">Host</th>'
            +   '<th style="' + thR + '">CPU</th>'
            +   '<th style="' + thR + '">Mem</th>'
            +   '<th style="' + thR + '">Ping</th>'
            +   '<th style="' + thR + '">Traffic</th>'
            +   '<th style="' + thR + '">Prob</th>'
            + '</tr></thead><tbody>';

        for (var k = 0; k < rows.length; k++) {
            var r    = rows[k];
            var st   = this._status(r);
            var tin  = (r.traffic && r.traffic.in)  || 0;
            var tout = (r.traffic && r.traffic.out) || 0;
            var prob = r.problems || 0;
            html += '<tr>'
                + '<td style="' + td + '">'
                +   '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'
                +     st.color + ';margin-right:6px;vertical-align:middle"></span>'
                +   '<span style="color:' + st.color + ';font-weight:600">' + this._esc(st.label) + '</span>'
                + '</td>'
                + '<td style="' + td + ';max-width:220px;overflow:hidden;text-overflow:ellipsis;color:'
                +     this._COL_TEXT + '" title="' + this._esc(r.label) + '">' + this._esc(r.label) + '</td>'
                + '<td style="' + tdR + '">' + this._esc(this._pct(r.cpu)) + '</td>'
                + '<td style="' + tdR + '">' + this._esc(this._pct(r.memory)) + '</td>'
                + '<td style="' + tdR + '">' + this._esc(this._ms(r.ping)) + '</td>'
                + '<td style="' + tdR + ';color:' + this._COL_SUB + '">'
                +   ((tin || tout)
                        ? '&#8595;' + this._esc(this._bps(tin)) + ' &#8593;' + this._esc(this._bps(tout))
                        : '')
                + '</td>'
                + '<td style="' + tdR + '">'
                +   ((prob > 0)
                        ? '<span style="color:' + this._COL_CRIT + ';font-weight:700">' + prob + '</span>'
                        : '<span style="color:' + this._COL_SUBSOFT + '">0</span>')
                + '</td>'
                + '</tr>';
        }
        html += '</tbody></table>';
        if (this._maxRows > 0 && total > this._maxRows) {
            html += '<div style="padding:4px 8px;font-size:10px;color:' + this._COL_SUB + '">'
                + '… ' + (total - this._maxRows) + ' weitere (Limit ' + this._maxRows + ')</div>';
        }
        html += '</div>';
        root.innerHTML = html;
    }

    _renderError(msg) {
        var root = this._target.querySelector('.nt-table-widget-canvas');
        if (!root) return;
        root.innerHTML = '<div style="padding:14px;color:' + this._COL_CRIT + ';font-size:12px">'
            + 'Table-Widget: Hauptmodul nicht erreichbar (' + this._esc(msg) + ')</div>';
    }
}
