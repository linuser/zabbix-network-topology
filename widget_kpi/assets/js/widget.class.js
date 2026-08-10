/*
 * NT KPI — Dashboard Widget
 * PlaNet Fox | Alexander Fox
 * Compatible with Zabbix 7.4 jsLoader (ES5-Stil: keine Template-Literals,
 * kein Spread, kein const/let, keine Arrow-Functions).
 *
 * Zeigt die Kennzahlen der Topologie als Dashboard-Kachel. Vier davon gibt es
 * auch im Hauptmodul (assets/js/modules/kpi.js), zwei sind der eigentliche
 * Grund fuer dieses Widget:
 *
 *   Kanten   aufgeschluesselt nach Herkunft. Die Unterscheidung steckt in den
 *            Element-IDs: "ml_" sind manuell gezogen, _isGhostEdge fuehrt zu
 *            einem Ghost, der Rest kommt aus LLDP/CDP. Zeigt, wie weit die
 *            automatische Erkennung traegt.
 *   Ghosts   per LLDP gemeldete Nachbarn ohne Host in Zabbix — Geraete, die im
 *            Netz stehen und nicht ueberwacht werden. Die einzige Kennzahl
 *            hier, die zu etwas auffordert statt nur zu beschreiben.
 *
 * Zwei Darstellungen (Widget-Einstellung "Display"):
 *   Ring    Severity-Verteilung als Donut mit der Host-Zahl in der Mitte,
 *           Aufschluesselung daneben. Beantwortet "ist alles gruen?" ohne dass
 *           man Zahlen liest — braucht aber Breite fuer die Legende.
 *   Kacheln Sechs gleichwertige Zahlen im Raster. Traegt schmale, hohe
 *           Zuschnitte besser.
 *
 * Gebaut wird mit createElement/textContent statt innerHTML: die Zahlen sind
 * Integer und die Beschriftungen fest, aber so bleibt die Datei ohne
 * Escaping-Disziplin korrekt und ohne Eintrag in eslint-suppressions.json.
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

class WidgetNetworkTopologyKpi extends CWidget {

    onInitialize() {
        this._groupids = [];
        this._display  = 0;   // 0 = Ring, 1 = Kacheln

        this._COL = {
            neutral: '#1f2c33',
            ok:      '#16a34a',
            warn:    '#d97706',
            crit:    '#dc2626',
            link:    '#7c3aed',
            ghost:   '#64748b',
            sub:     '#768d99',
            border:  '#dfe4e7',
            track:   '#eef2f7'
        };
    }

    onStart() {
        var root = this._target.querySelector('.nt-kpi-widget-canvas');
        if (root) {
            this._display = parseInt(root.dataset.display || '0', 10) || 0;
            try {
                this._groupids = JSON.parse(root.dataset.groupids || '[]');
            } catch (e) {
                this._groupids = [];
            }
            // s. die anderen Widgets: data-groupids kommt in Zabbix 7.4 leer am
            // Client an, die Feldwerte stehen dann nur in this._fields. Ohne
            // Fallback fetcht das Widget nie und haengt auf "Loading...".
            if (!this._groupids.length && this._fields && this._fields.groupids) {
                this._groupids = this._fields.groupids;
            }
        } else {
            this._display  = parseInt(this._fields.display || 0, 10) || 0;
            this._groupids = this._fields.groupids || [];
        }
    }

    /*
     * Refresh ueber Zabbix' eigenen Update-Zyklus statt ueber einen Timer —
     * wie bei den anderen NT-Widgets. Ein danebenlaufender setInterval wuerde
     * gegen die Basisklasse arbeiten, die den Widget-Koerper periodisch durch
     * frisches View-HTML (den "Loading..."-Platzhalter) ersetzt.
     */
    promiseUpdate() {
        var self = this;
        return Promise.resolve(super.promiseUpdate()).then(function () {
            return self._loadAndRender();
        });
    }

    _loadAndRender() {
        var self = this;
        var ids  = this._groupids;

        if (!ids || !ids.length) {
            this._renderMsg('Select host groups in the widget configuration.');
            return Promise.resolve();
        }

        return window.NtWidgetData(ids)
            .then(function (data) {
                if (data && data.error) { self._renderMsg(String(data.error)); return; }
                self._render(self._collect(data || {}));
            })
            .catch(function (e) {
                self._renderMsg((e && e.message) || 'Request failed');
            });
    }

    /*
     * Zaehlt zusammen, was die Daten hergeben.
     *
     * Severity-Stufen sind Normal/Info/Warning/Average/High/Disaster. Die
     * Eimer decken sich mit dem Hauptmodul: ok = Normal, warn = Info bis
     * Average (1-3), crit = High und Disaster (4-5). Wichtig, dass High NICHT
     * unter "Warn" faellt — die Karte zeigt solche Knoten rot, und eine
     * Kennzahl, die dann "Warn" sagt, widerspricht dem Bild.
     */
    _collect(data) {
        var nodes = data.nodes || [];
        var edges = data.edges || [];
        var lq    = data.lldp_quality || [];

        var ok = 0, warn = 0, crit = 0;
        var known = {};
        var i, n, s;

        for (i = 0; i < nodes.length; i++) {
            n = nodes[i];
            if (n._isInternet) continue;
            known[String(n.id)] = true;
            s = n.severity || 0;
            if (s === 0)      ok++;
            else if (s >= 4)  crit++;
            else              warn++;
        }

        // Kanten nach Herkunft. Ghost-Kanten zaehlen nicht mit: sie fuehren
        // definitionsgemaess zu einem Knoten, den Zabbix nicht kennt.
        var total = 0, manual = 0;
        for (i = 0; i < edges.length; i++) {
            if (edges[i]._isGhostEdge) continue;
            total++;
            if (String(edges[i].id || '').indexOf('ml_') === 0) manual++;
        }

        // Ghosts: dieselbe Ableitung wie build-elements.js im Hauptmodul —
        // der meldende Host muss selbst in den Daten sein, sonst haengt der
        // Ghost im Nichts; entdoppelt wird ueber denselben Slug.
        var ghosts = {};
        for (i = 0; i < lq.length; i++) {
            var q = lq[i] || {};
            var reporter = String(q.id || '');
            if (!reporter || !known[reporter]) continue;
            var um = q.unmatched || [];
            for (var j = 0; j < um.length; j++) {
                var raw = String((um[j] && um[j].raw) || '').trim();
                if (!raw) continue;
                var gid = 'ghost_' + raw.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');
                if (known[gid]) continue;
                ghosts[gid] = true;
            }
        }

        var ghostCount = 0;
        for (var k in ghosts) {
            if (Object.prototype.hasOwnProperty.call(ghosts, k)) ghostCount++;
        }

        return {
            hosts: ok + warn + crit,
            ok: ok, warn: warn, crit: crit,
            edges: total, manual: manual, lldp: Math.max(0, total - manual),
            ghosts: ghostCount
        };
    }

    // ── Bausteine ──────────────────────────────────────────────────────────

    _canvas() {
        var root = this._target.querySelector('.nt-kpi-widget-canvas');
        if (!root) return null;
        root.textContent = '';
        return root;
    }

    _renderMsg(msg) {
        var root = this._canvas();
        if (!root) return;
        var d = document.createElement('div');
        d.style.cssText = 'display:flex;align-items:center;justify-content:center;'
            + 'height:100%;min-height:60px;padding:8px;text-align:center;font-size:11px;color:'
            + this._COL.sub;
        d.textContent = msg;
        root.appendChild(d);
    }

    _num(value, colour, size) {
        var el = document.createElement('span');
        el.style.cssText = 'font-weight:700;line-height:1;font-variant-numeric:tabular-nums;'
            + 'font-size:' + size + 'px;color:' + colour;
        el.textContent = String(value);
        return el;
    }

    _label(text) {
        var el = document.createElement('span');
        el.style.cssText = 'font-size:11px;color:' + this._COL.sub;
        el.textContent = text;
        return el;
    }

    _dot(colour) {
        var el = document.createElement('span');
        el.style.cssText = 'width:8px;height:8px;border-radius:2px;flex:none;'
            + 'align-self:center;background:' + colour;
        return el;
    }

    // ── Ring ───────────────────────────────────────────────────────────────

    _arc(colour, dash, offset) {
        var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', '21');
        c.setAttribute('cy', '21');
        // r so gewaehlt, dass der Umfang ~100 betraegt — dann ist die
        // stroke-dasharray direkt der Prozentwert, ohne Umrechnung.
        c.setAttribute('r', '15.9155');
        c.setAttribute('fill', 'none');
        c.setAttribute('stroke', colour);
        c.setAttribute('stroke-width', '4');
        c.setAttribute('stroke-dasharray', dash + ' ' + (100 - dash));
        c.setAttribute('stroke-dashoffset', String(offset));
        return c;
    }

    _renderRing(g) {
        var root = this._canvas();
        if (!root) return;

        var wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:10px 12px;';

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 42 42');
        svg.setAttribute('width', '92');
        svg.setAttribute('height', '92');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', g.ok + ' of ' + g.hosts + ' hosts OK');

        svg.appendChild(this._arc(this._COL.track, 100, 25));

        // Segmente im Uhrzeigersinn ab 12 Uhr. offset 25 dreht den Startpunkt
        // von 3 Uhr nach oben; jedes weitere Segment schiebt um die Summe der
        // vorherigen Anteile zurueck.
        var totalArc = Math.max(1, g.hosts);
        var acc = 0;
        var segs = [
            [this._COL.ok,   g.ok],
            [this._COL.warn, g.warn],
            [this._COL.crit, g.crit]
        ];
        for (var i = 0; i < segs.length; i++) {
            var share = (segs[i][1] / totalArc) * 100;
            if (share <= 0) continue;
            svg.appendChild(this._arc(segs[i][0], share, 25 - acc));
            acc += share;
        }

        var t1 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t1.setAttribute('x', '21'); t1.setAttribute('y', '20.5');
        t1.setAttribute('text-anchor', 'middle');
        t1.setAttribute('font-size', '10'); t1.setAttribute('font-weight', '700');
        t1.setAttribute('fill', this._COL.neutral);
        t1.textContent = String(g.hosts);
        svg.appendChild(t1);

        var t2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t2.setAttribute('x', '21'); t2.setAttribute('y', '26');
        t2.setAttribute('text-anchor', 'middle');
        t2.setAttribute('font-size', '3.6');
        t2.setAttribute('fill', this._COL.sub);
        t2.textContent = 'HOSTS';
        svg.appendChild(t2);

        wrap.appendChild(svg);

        var side = document.createElement('div');
        side.style.cssText = 'display:flex;flex-direction:column;gap:7px;flex:1;min-width:120px;';

        var rows = [
            [this._COL.ok,    g.ok,     'OK',           ''],
            [this._COL.warn,  g.warn,   'Warn',         ''],
            [this._COL.crit,  g.crit,   'Critical',     ''],
            [this._COL.link,  g.edges,  'Edges',        g.manual ? g.manual + ' manual' : ''],
            [this._COL.ghost, g.ghosts, 'Unmonitored',  '']
        ];

        for (var r = 0; r < rows.length; r++) {
            var line = document.createElement('div');
            line.style.cssText = 'display:flex;align-items:baseline;gap:7px;';
            line.appendChild(this._dot(rows[r][0]));
            line.appendChild(this._num(rows[r][1], rows[r][0], 15));
            line.appendChild(this._label(rows[r][2]));
            if (rows[r][3]) {
                var sub = document.createElement('span');
                sub.style.cssText = 'font-size:10px;color:' + this._COL.sub;
                sub.textContent = '(' + rows[r][3] + ')';
                line.appendChild(sub);
            }
            side.appendChild(line);
        }

        wrap.appendChild(side);
        root.appendChild(wrap);
    }

    // ── Kacheln ────────────────────────────────────────────────────────────

    _renderTiles(g) {
        var root = this._canvas();
        if (!root) return;

        var grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));'
            + 'gap:8px;padding:10px 12px;';

        var tiles = [
            [g.hosts,  'Hosts',       this._COL.neutral],
            [g.ok,     'OK',          this._COL.ok],
            [g.warn,   'Warn',        this._COL.warn],
            [g.crit,   'Critical',    this._COL.crit],
            [g.edges,  'Edges',       this._COL.link],
            [g.ghosts, 'Unmonitored', this._COL.ghost]
        ];

        for (var i = 0; i < tiles.length; i++) {
            var t = document.createElement('div');
            t.style.cssText = 'border:1px solid ' + this._COL.border
                + ';border-radius:4px;padding:8px 10px;';
            t.appendChild(this._num(tiles[i][0], tiles[i][2], 20));
            var lbl = document.createElement('div');
            lbl.style.cssText = 'font-size:9.5px;margin-top:4px;text-transform:uppercase;'
                + 'letter-spacing:0.04em;color:' + this._COL.sub;
            lbl.textContent = tiles[i][1];
            t.appendChild(lbl);
            grid.appendChild(t);
        }

        root.appendChild(grid);
    }

    _render(g) {
        if (this._display === 1) {
            this._renderTiles(g);
        } else {
            this._renderRing(g);
        }
    }
}
