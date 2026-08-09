/*
 * Network Topology — Dashboard Widget
 * PlaNet Fox | Alexander Fox
 * Compatible with Zabbix 7.4 jsLoader (no template literals, no spread, no const).
 *
 * v2.0 — Offline/Stale-Detection + Zabbix-Native-Look (parallel zum Hauptmodul):
 *   - Offline-Hosts: graue dashed-Ring, halbtransparentes Icon, rotes X overlay
 *   - Stale-Hosts (last_seen > 5min): orange dashed-Ring
 *   - Mgmt-Tiles: gedimmte Tile + OFFLINE/STALE-Pille
 *   - Tooltip zeigt Offline/Stale-Hinweis prominent
 *   - Optional: hide_offline-Setting blendet Offline-Hosts komplett aus
 *   - Zabbix-native Farb-Palette + flache 2px Ecken
 *
 * Voraussetzung: Hauptmodul "network_topology" muss installiert sein
 * (das Widget ruft die network.topology.data Action auf).
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

class WidgetNetworkTopology extends CWidget {

    onInitialize() {
        this._cy           = null;
        this._nodes        = [];
        this._edges        = [];
        this._tab          = 'tech';
        this._libsOk       = false;
        this._nodeMap      = {};
        // Zabbix-native Farb-Palette (matches Hauptmodul mkTheme light).
        this._COL = {
            head:    '#f6fafd',
            border:  '#dfe4e7',
            text:    '#1f2c33',
            sub:     '#768d99',
            subSoft: '#a4afb5',
            accent:  '#0275b8',
            critical:'#e53742',
            warning: '#f59e0b',
            offline: '#9ca3af'
        };
        this._SEV_COL = ['#22c55e', '#06b6d4', '#f59e0b', '#f97316', '#ef4444', '#991b1b'];
        this._SEV_LBL = ['OK', 'Info', 'Warn', 'Avg', 'High', 'Krit'];
    }

    // HTML-Escape fuer alle User-Daten die in innerHTML/title-Attribute landen.
    // Hostnames kommen via LLDP/SNMP-sysName aus dem Netzwerk und sind nicht
    // vertrauenswuerdig — ohne Escape waere ein boesartiger sysName ein
    // Stored-XSS-Vektor fuer jeden Dashboard-Besucher.
    _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    onStart() {
        var root = this._target.querySelector('[data-view-mode]');
        if (root) {
            this._tab         = root.dataset.viewMode  || 'tech';
            this._showLldp    = root.dataset.showLldp  !== '0';
            this._hideOffline = root.dataset.hideOffline === '1';
            try {
                this._groupids = JSON.parse(root.dataset.groupids || '[]');
            } catch (e) {
                this._groupids = [];
            }
            // data-groupids kommt in Zabbix 7.4 leer am Client an — die Feldwerte
            // stehen zu dem Zeitpunkt nur in this._fields. Ohne diesen Fallback
            // fetcht das Widget nie und bleibt auf "Loading..." stehen. Welches
            // Widget es trifft, entschied bisher das Timing: existiert der Canvas
            // bei onStart schon, greift der (leere) dataset-Zweig; existiert er
            // noch nicht, rettete der else-Zweig unten die Konfiguration.
            if (!this._groupids.length && this._fields && this._fields.groupids) {
                this._groupids = this._fields.groupids;
            }
        } else {
            this._tab         = this._fields.view_mode === 1 ? 'mgmt' : 'tech';
            this._showLldp    = this._fields.show_lldp !== false && this._fields.show_lldp !== 0;
            this._hideOffline = this._fields.hide_offline === 1 || this._fields.hide_offline === true;
            this._groupids    = this._fields.groupids || [];
        }
    }

    onActivate() {
        this._active = true;
        this._setupButtons();
    }

    onDeactivate() {
        this._active = false;
        this._destroyCy();
    }

    /*
     * Refresh ueber Zabbix' eigenen Update-Zyklus statt ueber einen Timer.
     *
     * Vorher lief hier ein setInterval, waehrend die Basisklasse parallel
     * periodisch die View-Action rief und den Widget-Koerper durch frisches
     * View-HTML ersetzte — den "Loading..."-Platzhalter, den der Timer erst bis
     * zu 30 s spaeter ueberschrieb. Auf der Demo war der zweite Zyklus im
     * Zugriffslog als POST auf widget.network_topology_widget.view alle 60 s zu
     * sehen. Fuer den Graphen war das besonders unangenehm: der Cytoscape-
     * Container verschwand mitsamt gerendertem Graph.
     *
     * Cytoscape wird weiterhin nachgeladen, aber innerhalb der Promise-Kette —
     * ohne das gaebe es ein Zeitfenster, in dem gerendert wird, bevor die
     * Bibliothek da ist. _active bleibt als Wache: laedt die Bibliothek erst
     * nach dem Deaktivieren fertig, wird nicht mehr gerendert.
     */
    promiseUpdate() {
        var self = this;
        return Promise.resolve(super.promiseUpdate())
            .then(function () {
                return new Promise(function (resolve) { self._loadLibs(resolve); });
            })
            .then(function () {
                if (!self._active) return;
                self._setupButtons();
                return self._loadData();
            });
    }

    _setupButtons() {
        var self = this;
        // Per-Element-Flag: die Buttons ueberleben Deaktivieren/Aktivieren im DOM,
        // ohne Guard wuerde jedes onActivate einen weiteren Click-Handler anhaengen.
        this._target.querySelectorAll('.nt-tab-btn').forEach(function (btn) {
            if (btn.dataset.ntWired) return;
            btn.dataset.ntWired = '1';
            btn.addEventListener('click', function () { self._setTab(btn.dataset.tab); });
        });
        var fitBtn = this._target.querySelector('.nt-fit-btn');
        if (fitBtn && !fitBtn.dataset.ntWired) {
            fitBtn.dataset.ntWired = '1';
            fitBtn.addEventListener('click', function () {
                if (self._cy) { self._cy.fit(self._cy.nodes(), 16); }
            });
        }
    }

    _setTab(tab) {
        this._tab = tab;
        var c = this._COL;
        this._target.querySelectorAll('.nt-tab-btn').forEach(function (btn) {
            var active = btn.dataset.tab === tab;
            btn.style.background  = active ? c.accent : '#fff';
            btn.style.color       = active ? '#fff'   : c.text;
            btn.style.borderColor = active ? c.accent : c.border;
        });
        this._render();
    }

    _loadLibs(callback) {
        if (typeof cytoscape !== 'undefined') {
            this._libsOk = true;
            callback();
            return;
        }
        var self    = this;
        var base    = 'modules/network_topology/assets/js/';
        var scripts = [base + 'cytoscape.min.js'];
        var loaded  = 0;
        scripts.forEach(function (src) {
            if (document.querySelector('script[src="' + src + '"]')) {
                loaded++;
                if (loaded === scripts.length) { self._libsOk = true; callback(); }
                return;
            }
            var s = document.createElement('script');
            s.src = src;
            s.onload  = function () {
                loaded++;
                if (loaded === scripts.length) { self._libsOk = true; callback(); }
            };
            s.onerror = function () {
                loaded++;
                if (loaded === scripts.length) { callback(); }
            };
            document.head.appendChild(s);
        });
    }

    _loadData() {
        var self     = this;
        var groupids = this._groupids;
        if (!groupids.length) {
            this._showMsg('Select host groups in widget settings');
            return Promise.resolve();
        }
        // Geteilt mit den anderen NT-Widgets auf derselben Seite: liegen
        // mehrere auf einem Dashboard, holt nur eines die Daten.
        return window.NtWidgetData(groupids)
            .then(function (data) {
                if (data && data.error) { self._showMsg(String(data.error), true); return; }
                self._nodes = (data && data.nodes) || [];
                self._edges = (data && data.edges) || [];
                self._render();
            })
            .catch(function (err) { self._showMsg('Error: ' + err.message, true); });
    }

    _render() {
        // Optional Offline-Hosts ausblenden (per Widget-Setting).
        var visible = this._hideOffline
            ? this._nodes.filter(function (n) { return !n.unavailable; })
            : this._nodes;
        this._visibleNodes = visible;
        if (this._tab === 'mgmt') {
            this._renderMgmt();
        } else {
            this._renderCyto();
        }
    }

    _showMsg(msg, error) {
        var el = this._target.querySelector('.nt-widget-loading');
        if (el) {
            el.style.display = 'flex';
            // textContent statt innerHTML: msg ist der einzige String hier, der
            // nicht aus eigenem Code stammt (Fetch-/JSON-Fehlermeldungen, und
            // bei einer Angleichung an die anderen Widgets auch data.error vom
            // Backend). Per Konstruktion kein HTML-Sink — kein Escaping noetig.
            el.textContent = '';
            var span = document.createElement('span');
            span.style.color = error ? this._COL.critical : this._COL.sub;
            span.textContent = msg;
            el.appendChild(span);
        }
    }

    _getCanvas() {
        return this._target.querySelector('.nt-widget-canvas');
    }

    _destroyCy() {
        // Den ResizeObserver des Layout-Nachlaufs mit abraeumen — sonst bleibt
        // pro Re-Render einer haengen (Wallboard-Betrieb: ein Leak je Refresh).
        if (this._ro) {
            try { this._ro.disconnect(); } catch (e) {}
            this._ro = null;
        }
        if (this._cy) {
            try { this._cy.destroy(); } catch (e) {}
            this._cy = null;
        }
    }

    // Status-Detection: Offline > Stale > Severity-Hierarchy.
    // Returns { state: 'offline'|'stale'|'normal', col, lbl, ageMin }
    _hostState(n) {
        if (n.unavailable) {
            return { state: 'offline', col: this._COL.critical, lbl: 'OFFLINE', ageMin: 0 };
        }
        var STALE_S = 300;   // 5min
        var nowSec = Math.floor(Date.now() / 1000);
        if (n.last_seen && n.last_seen > 0) {
            var ageSec = nowSec - n.last_seen;
            if (ageSec > STALE_S) {
                return {
                    state: 'stale',
                    col:   this._COL.warning,
                    lbl:   'STALE',
                    ageMin: Math.floor(ageSec / 60)
                };
            }
        }
        var sev = Math.min(n.severity || 0, 5);
        return {
            state: 'normal',
            col:   this._SEV_COL[sev],
            lbl:   this._SEV_LBL[sev],
            ageMin: 0
        };
    }

    // Vereinfachter Pie-Chart-Generator fuer kleine Widget-Tiles. Echte
    // CPU/Memory/Traffic/Ping-Pies wuerden bei 44px Cytoscape-Nodes nichts
    // mehr zeigen — wir nehmen nur den Severity-Ring + Server-Icon, plus
    // bei Offline ein rotes X overlay damit man tote Hosts sofort erkennt.
    _makeSvgNode(n) {
        var st = this._hostState(n);
        var ring = st.col;
        // Bei Offline/Stale Ring grau bzw orange + dashed
        var ringDash = (st.state === 'offline' || st.state === 'stale')
            ? ' stroke-dasharray="3,3"'
            : '';
        if (st.state === 'offline') ring = this._COL.offline;
        var iconOpacity = (st.state === 'offline') ? '0.4' : '1';
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">'
            + '<circle cx="24" cy="24" r="20" fill="white" stroke="' + ring
            +     '" stroke-width="3"' + ringDash + '/>'
            + '<g opacity="' + iconOpacity + '">'
            + '<rect x="12" y="17" width="24" height="4" rx="1" fill="#64748b"/>'
            + '<rect x="12" y="23" width="24" height="4" rx="1" fill="#64748b"/>'
            + '<rect x="12" y="29" width="24" height="4" rx="1" fill="#64748b"/>'
            + '</g>';
        // Rotes X bei Offline druebergelegt
        if (st.state === 'offline') {
            svg += '<g transform="translate(24,24)" stroke="#e53742"'
                +  ' stroke-width="2.5" stroke-linecap="round">'
                +  '<line x1="-9" y1="-9" x2="9" y2="9"/>'
                +  '<line x1="9" y1="-9" x2="-9" y2="9"/>'
                +  '</g>';
        }
        svg += '</svg>';
        return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    }

    _renderCyto() {
        var self   = this;
        var canvas = this._getCanvas();
        if (!canvas) return;

        var old = canvas.querySelector('.nt-mgmt-view');
        if (old) old.remove();

        var cyDiv = canvas.querySelector('.nt-cy-div');
        if (!cyDiv) {
            cyDiv           = document.createElement('div');
            cyDiv.className = 'nt-cy-div';
            cyDiv.style.cssText = 'position:absolute;inset:0;';
            canvas.appendChild(cyDiv);
        }

        var loading = canvas.querySelector('.nt-widget-loading');
        if (loading) loading.style.display = 'none';

        this._destroyCy();

        if (!this._libsOk || typeof cytoscape === 'undefined') {
            this._showMsg('Cytoscape.js not loaded — Hauptmodul installiert?', true);
            return;
        }

        var elements = [];
        var nodeMap  = {};
        var nodes = this._visibleNodes || this._nodes;
        nodes.forEach(function (n) {
            nodeMap[String(n.id)] = n;
            elements.push({ data: {
                id:           String(n.id),
                label:        n.label || n.host,
                bgImage:      self._makeSvgNode(n),
                _unavailable: !!n.unavailable
            }});
        });
        this._nodeMap = nodeMap;

        // Edges: nur die rendern wo BEIDE Endpunkte sichtbar sind
        var visibleIds = {};
        nodes.forEach(function (n) { visibleIds[String(n.id)] = true; });
        this._edges.forEach(function (e, i) {
            if (!self._showLldp && e.iface === 'lldpRemSysName') return;
            var src = String(e.from || e.source);
            var tgt = String(e.to   || e.target);
            if (!visibleIds[src] || !visibleIds[tgt]) return;
            elements.push({ data: { id: 'e' + i, source: src, target: tgt }});
        });

        // Cola-Layout falls verfuegbar, sonst Cose. Fixer Bug: vorher hatten
        // wir die gleiche Bedingung doppelt im OR — Copy-Paste-Unfall.
        var hasCola = (typeof cytoscapeCola !== 'undefined');
        if (hasCola) {
            try { cytoscape.use(cytoscapeCola); } catch (e) {}
        }

        this._cy = cytoscape({
            container: cyDiv,
            elements:  elements,
            style: [
                { selector: 'node', style: {
                    'width': 44, 'height': 44,
                    'background-opacity': 0,
                    'background-image': 'data(bgImage)',
                    'background-fit': 'contain',
                    'label': 'data(label)',
                    'font-size': 9,
                    'text-valign': 'bottom',
                    'text-halign': 'center',
                    'color': self._COL.text,
                    'text-margin-y': 3,
                    'text-background-opacity': 0.85,
                    'text-background-color': self._COL.head,
                    'text-background-padding': '1px',
                    'min-zoomed-font-size': 7
                }},
                // Offline-Nodes mit reduzierter Gesamt-Opacity damit sie auch
                // im Cluster optisch zurueckfallen
                { selector: 'node[?_unavailable]', style: {
                    'opacity': 0.6
                }},
                { selector: 'edge', style: {
                    'width': 2,
                    'line-color': '#22c55e',
                    'line-style': 'dashed',
                    'line-dash-pattern': [5, 4],
                    'curve-style': 'unbundled-bezier',
                    'control-point-distances': [40],
                    'control-point-weights': [0.5],
                    'opacity': 0.8
                }}
            ],
            layout: hasCola
                ? { name: 'cola', animate: true, animationDuration: 500,
                    padding: 16, nodeSpacing: 10, edgeLength: 100,
                    handleDisconnected: true }
                : { name: 'cose', animate: true, padding: 16, nodeRepulsion: 5000 },
            userZoomingEnabled: true,
            userPanningEnabled: true,
            minZoom: 0.1,
            maxZoom: 4
        });

        this._setupTooltip(canvas);
        this._hasCola = hasCola;

        // Layout-Nachlauf, sobald der Container echte Groesse hat.
        //
        // Im Dashboard ist die Widget-Flaeche beim Init haeufig noch 0px gross.
        // cose/cola koennen dann nicht verteilen und legen ALLE Knoten auf
        // {0,0}; das anschliessende fit() zoomt auf eine entartete Bounding-Box
        // (Zoom 4) — der Graph ist geladen, aber unsichtbar. Ein blosses
        // resize()+fit() heilt das NICHT, weil die Positionen da schon
        // feststehen: das Layout muss neu laufen. Das Hauptmodul loest denselben
        // Race in render-tech.js per ResizeObserver.
        var self = this;
        var cy   = this._cy;
        var done = false;
        var relayout = function () {
            if (done || !cy) { return done; }
            var c = cy.container();
            if (!c || c.offsetWidth < 50 || c.offsetHeight < 50) { return false; }
            done = true;
            cy.resize();
            var l = cy.layout(self._layoutOpts());
            l.one('layoutstop', function () { cy.fit(cy.nodes(), 16); });
            l.run();
            return true;
        };

        if (!relayout() && window.ResizeObserver) {
            if (this._ro) { try { this._ro.disconnect(); } catch (e) {} }
            this._ro = new ResizeObserver(function () {
                if (relayout() && self._ro) {
                    try { self._ro.disconnect(); } catch (e) {}
                    self._ro = null;
                }
            });
            try { this._ro.observe(cyDiv); } catch (e) {}
        }
        // Fallback fuer Browser ohne ResizeObserver bzw. wenn er nicht feuert.
        setTimeout(relayout, 700);
    }

    // Layout-Optionen fuer den Nachlauf — ohne Animation, damit das Ergebnis
    // sofort steht (der Init-Lauf animiert, der Nachlauf soll nur korrigieren).
    _layoutOpts() {
        return this._hasCola
            ? { name: 'cola', animate: false, padding: 16, nodeSpacing: 10,
                edgeLength: 100, handleDisconnected: true }
            : { name: 'cose', animate: false, padding: 16, nodeRepulsion: 5000 };
    }

    _setupTooltip(canvas) {
        var self    = this;
        var nodeMap = this._nodeMap || {};

        var tooltip = canvas.querySelector('.nt-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'nt-tooltip';
            tooltip.style.cssText = [
                'position:absolute;z-index:999;pointer-events:none',
                'background:rgba(15,23,42,0.92);color:#f1f5f9',
                'border-radius:2px;padding:8px 10px;font-size:11px',
                'box-shadow:0 4px 16px rgba(0,0,0,0.3)',
                'max-width:200px;display:none;line-height:1.5'
            ].join(';');
            canvas.appendChild(tooltip);
        }

        var cy = this._cy;
        cy.on('mouseover', 'node', function (e) {
            var node = e.target;
            var nd = nodeMap[node.id()];
            if (!nd) return;
            var st = self._hostState(nd);

            // Status-Header mit der State-Farbe. Hostnames/IPs werden escaped —
            // LLDP-sysName aus dem Netzwerk ist nicht vertrauenswuerdig.
            var html = '<div style="font-weight:600;margin-bottom:4px;color:'
                + st.col + '">' + self._esc(nd.label || nd.host || '') + '</div>';
            html += '<div style="color:#94a3b8;font-size:10px;margin-bottom:4px">'
                + self._esc(nd.ip || '') + '</div>';
            html += '<div>Status: <b style="color:' + st.col + '">' + self._esc(st.lbl) + '</b>';
            if (st.state === 'stale') {
                html += ' <span style="color:#94a3b8">(' + Number(st.ageMin || 0) + 'm)</span>';
            }
            if (nd.problems) {
                html += ' <span style="background:#e53742;color:#fff;border-radius:8px;'
                     +  'padding:0 4px;font-size:9px">' + Number(nd.problems || 0) + '</span>';
            }
            html += '</div>';

            // Bei Offline/Stale: Metriken als "stale" markieren — sind eingefrorene
            // Werte vor dem Disconnect, kein Live-Stand. Numerische Felder
            // explizit zu Number gecastet (Defense-in-depth gegen Backend-Drift).
            var stale = (st.state === 'offline' || st.state === 'stale');
            var dimStyle = stale
                ? ';opacity:0.6;text-decoration:line-through'
                : '';
            if (nd.cpu != null) {
                html += '<div style="' + dimStyle.substring(1) + '">CPU: <b>'
                    + Number(nd.cpu) + '%</b></div>';
            }
            if (nd.memory != null) {
                html += '<div style="' + dimStyle.substring(1) + '">Memory: <b>'
                    + Number(nd.memory) + '%</b></div>';
            }
            if (nd.ping != null) {
                html += '<div style="' + dimStyle.substring(1) + '">Ping: <b>'
                    + Number(nd.ping) + ' ms</b></div>';
            }
            if (stale) {
                html += '<div style="margin-top:4px;color:#fbbf24;font-size:9px;'
                     +  'font-style:italic">Werte sind eingefroren</div>';
            }

            tooltip.innerHTML = html;
            tooltip.style.display = 'block';
        });

        cy.on('mouseout', 'node', function () {
            tooltip.style.display = 'none';
        });

        cy.on('mousemove', function (e) {
            if (tooltip.style.display === 'none') return;
            var rect = canvas.getBoundingClientRect();
            var x = e.originalEvent.clientX - rect.left + 12;
            var y = e.originalEvent.clientY - rect.top  + 12;
            if (x + 210 > canvas.offsetWidth)  x = x - 224;
            if (y + 130 > canvas.offsetHeight) y = y - 130;
            tooltip.style.left = x + 'px';
            tooltip.style.top  = y + 'px';
        });
    }

    _renderMgmt() {
        this._destroyCy();

        var canvas = this._getCanvas();
        if (!canvas) return;

        var cyDiv = canvas.querySelector('.nt-cy-div');
        if (cyDiv) cyDiv.remove();
        var oldTooltip = canvas.querySelector('.nt-tooltip');
        if (oldTooltip) oldTooltip.remove();

        var loading = canvas.querySelector('.nt-widget-loading');
        if (loading) loading.style.display = 'none';

        var view = canvas.querySelector('.nt-mgmt-view');
        if (!view) {
            view           = document.createElement('div');
            view.className = 'nt-mgmt-view';
            view.style.cssText = 'position:absolute;inset:0;overflow-y:auto;padding:8px;'
                + 'display:flex;flex-wrap:wrap;gap:6px;align-content:flex-start;';
            canvas.appendChild(view);
        }
        view.innerHTML = '';

        var self = this;
        var nodes = this._visibleNodes || this._nodes;

        // Sort: Offline > Stale > Severity desc — kritischste/toteste oben.
        // Internet-Cloud-Knoten ausnehmen (sind virtuell, kein echter Host).
        var sorted = nodes.filter(function(n) { return !n._isInternet; }).sort(function (a, b) {
            var sa = self._hostState(a);
            var sb = self._hostState(b);
            // Rank-Closure muss den Node + State des jeweiligen Vergleichs-Elements
            // sehen — vorher griff sie aus dem aeusseren Scope auf a.severity zu,
            // was beide Seiten gleich rankte. Fix: explizite Args.
            var rank = function (node, s) {
                if (s.state === 'offline') return 100;
                if (s.state === 'stale')   return 80;
                return Math.min(node.severity || 0, 5);
            };
            return rank(b, sb) - rank(a, sa)
                || ((b.severity || 0) - (a.severity || 0))
                || (a.label || '').localeCompare(b.label || '');
        });

        sorted.forEach(function (n) {
            var st    = self._hostState(n);
            var name  = n.label || n.host || '';
            var short = name.length > 13 ? name.slice(0, 12) + '…' : name;
            // Border-Color: Offline grey, Stale orange, sonst Severity
            var borderCol = st.state === 'offline' ? self._COL.offline
                          : st.state === 'stale'   ? self._COL.warning
                          : st.col;
            var dimOpacity = (st.state === 'offline' || st.state === 'stale') ? '0.65' : '1';

            // Alle User-Daten (name, n.ip) werden mit _esc() escaped — Hostnames
            // sind via LLDP-Discovery nicht vertrauenswuerdig. Numerische Felder
            // explizit zu Number gecastet als Defense-in-depth.
            var probBadge = n.problems
                ? '<span style="margin-left:auto;background:' + self._COL.critical
                    + ';color:#fff;border-radius:8px;padding:0 4px;font-size:9px">'
                    + Number(n.problems || 0) + '</span>'
                : '';
            var ipRow  = n.ip      ? '<div style="color:#94a3b8;margin-top:1px;font-size:9px">'  + self._esc(n.ip) + '</div>' : '';
            // CPU bei Stale/Offline gedimmt (eingefrorener Wert)
            var dimMetricStyle = (st.state === 'offline' || st.state === 'stale')
                ? 'color:' + self._COL.subSoft + ';text-decoration:line-through'
                : 'color:' + self._COL.accent;
            var cpuRow = n.cpu != null
                ? '<div style="' + dimMetricStyle + ';margin-top:2px">CPU ' + Number(n.cpu) + '%</div>'
                : '';

            var tile = document.createElement('div');
            tile.style.cssText = 'min-width:110px;max-width:140px;padding:6px 8px;'
                + 'border-radius:2px;border:1.5px solid ' + borderCol
                + ';background:white;font-size:10px;cursor:pointer;flex:1 1 110px;'
                + 'opacity:' + dimOpacity + ';transition:opacity 0.12s';
            tile.title = name + (st.state === 'stale'
                ? ' — letzter Wert vor ' + Number(st.ageMin || 0) + 'm'
                : '');
            tile.innerHTML =
                '<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">'
                    + '<span style="width:6px;height:6px;border-radius:50%;background:'
                    +     borderCol + ';flex-shrink:0"></span>'
                    + '<b style="color:' + borderCol + '">' + self._esc(st.lbl) + '</b>'
                    + probBadge
                + '</div>'
                + '<div style="font-weight:600;color:' + self._COL.text
                +     ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap" '
                +     'title="' + self._esc(name) + '">' + self._esc(short) + '</div>'
                + ipRow
                + cpuRow;

            view.appendChild(tile);
        });
    }
}
