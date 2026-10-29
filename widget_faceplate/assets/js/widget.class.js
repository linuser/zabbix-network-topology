/*
 * NT Faceplate — Dashboard Widget
 * PlaNet Fox | Alexander Fox
 * Compatible with Zabbix 7.4 jsLoader (ES5-Stil: keine Template-Literals,
 * kein Spread, kein const/let, keine Arrow-Functions).
 *
 * Zeichnet die Front EINES Switches: jeder Port eine Buchse, gefaerbt nach
 * Link-Status oder Link-Speed, mit Alias, Traffic, PoE und LLDP-Nachbar im
 * Tooltip. Kein Herstellerbild — ein generisches Raster aus Kupfer-Bloecken
 * zu je sechs Spalten und abgesetzten SFP-Schaechten, damit derselbe Code
 * HPE, Aruba, UniFi und Cisco-SMB mit 8 bis 48 Ports traegt.
 *
 * Die Ports liefert network.topology.faceplate (Topology\FaceplateBuilder);
 * welcher Port Kupfer und welcher SFP ist, entscheidet dort der Zuschnitt.
 *
 * Gebaut mit createElementNS/textContent statt innerHTML: Portnamen, Aliase
 * und LLDP-Nachbarn kommen per SNMP aus dem Netz und sind nicht
 * vertrauenswuerdig.
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

class WidgetNetworkTopologyFaceplate extends CWidget {

    onInitialize() {
        this._hostid     = '';
        this._layout     = 'auto';
        this._color      = 0;
        this._numbering  = 0;
        this._showLabels = true;
        this._data       = null;
        this._tip        = null;

        this._COL  = window.NtTheme.palette(false);
        this._dark = false;
    }

    onStart() {
        var root = this._target.querySelector('.nt-faceplate-widget-canvas');
        var f = this._fields || {};
        // Formular speichert den Zuschnitt als Index (CWidgetFieldSelect kennt
        // nur Ganzzahlen); WidgetView bildet ihn ab, dieser Fallback ebenso.
        var LAYOUTS = ['auto', '8+2', '16+2', '24+2', '24+4', '48+4', '48+6'];

        if (root) {
            this._hostid     = root.dataset.hostid || '';
            this._layout     = root.dataset.layout || 'auto';
            this._color      = parseInt(root.dataset.color || '0', 10) || 0;
            this._numbering  = parseInt(root.dataset.numbering || '0', 10) || 0;
            this._showLabels = root.dataset.showLabels !== '0';
        }
        // s. die anderen Widgets: data-* kommt in Zabbix 7.4 je nach Timing
        // leer am Client an, die Feldwerte stehen dann nur in this._fields.
        if (!this._hostid && f.hostids && f.hostids.length) {
            this._hostid = String(f.hostids[0]);
            this._layout = LAYOUTS[parseInt(f.layout || 0, 10)] || 'auto';
            this._color  = parseInt(f.color || 0, 10) || 0;
            this._numbering = parseInt(f.numbering || 0, 10) || 0;
            this._showLabels = f.show_labels !== 0 && f.show_labels !== '0';
        }
    }

    /*
     * Refresh ueber Zabbix' eigenen Update-Zyklus statt ueber einen Timer —
     * wie bei den anderen NT-Widgets.
     */
    promiseUpdate() {
        var self = this;
        return Promise.resolve(super.promiseUpdate()).then(function () {
            return self._loadAndRender();
        });
    }

    onResize() {
        // Das SVG skaliert selbst (viewBox); nur der Tooltip wuerde an einer
        // alten Position haengen bleiben.
        this._hideTip();
    }

    _loadAndRender() {
        var self = this;

        if (!this._hostid) {
            this._renderMsg('Select a host in the widget configuration.');
            return Promise.resolve();
        }

        var params = new URLSearchParams();
        params.append('action', 'network.topology.faceplate');
        params.append('hostid', this._hostid);
        params.append('layout', this._layout);

        return window.NtFetchJson('zabbix.php?' + params.toString(), {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
            .then(function (data) {
                if (data && data.error) { self._renderMsg(String(data.error)); return; }
                self._data = data || {};
                self._render(self._data);
            })
            .catch(function (e) {
                self._renderMsg((e && e.message) || 'Request failed');
            });
    }

    // ── Formatierung ───────────────────────────────────────────────────────

    _fmtBits(v) {
        if (v === null || v === undefined || isNaN(Number(v))) return '';
        var n = Number(v);
        var u = ['bit/s', 'kbit/s', 'Mbit/s', 'Gbit/s', 'Tbit/s'];
        var i = 0;
        while (n >= 1000 && i < u.length - 1) { n = n / 1000; i++; }
        return (n >= 100 || i === 0 ? Math.round(n) : Math.round(n * 10) / 10) + ' ' + u[i];
    }

    _fmtSpeed(bps) {
        if (!bps) return '';
        if (bps >= 1e9) return (Math.round(bps / 1e8) / 10) + ' G';
        if (bps >= 1e6) return Math.round(bps / 1e6) + ' M';
        return Math.round(bps / 1e3) + ' k';
    }

    _operText(o) {
        var t = { 1: 'up', 2: 'down', 3: 'testing', 4: 'unknown', 5: 'dormant', 6: 'not present', 7: 'lower layer down' };
        return t[o] || 'no data';
    }

    // ── Farben ─────────────────────────────────────────────────────────────

    /*
     * Feste Farbtoene fuer die Zustaende, nur Rahmen und Text kommen aus der
     * Theme-Palette. Gruen/Grau muessen auf hellem und dunklem Dashboard
     * gleich lesbar sein — die Toene unten sind fuer beide gewaehlt.
     */
    _fill(p) {
        var up = p.oper === 1;
        if (p.absent) return 'none';                                // kein Interface
        if (!p.oper) return this._dark ? '#30363d' : '#e5e7eb';    // keine Daten
        if (!up) return this._dark ? '#484f58' : '#6b7280';        // down / leer
        if (this._color !== 1) return '#22c55e';
        var s = p.speed || 0;
        if (s >= 1e10) return '#8b5cf6';     // 10G+
        if (s >= 2.5e9) return '#3b82f6';    // 2.5G / 5G
        if (s >= 1e9) return '#22c55e';      // 1G
        if (s >= 1e8) return '#f59e0b';      // 100M — oft ein Autoneg-Problem
        return '#ef4444';                    // 10M
    }

    _sevColor(sev) {
        // Zabbix-Severity-Farben (Default-Theme): Info .. Disaster.
        var c = ['#97aab3', '#7499ff', '#ffc859', '#ffa059', '#e97659', '#e45959'];
        return c[sev] || c[0];
    }

    // ── Geometrie ──────────────────────────────────────────────────────────

    /*
     * Port n (1-basiert) -> [Spalte, Reihe] im Kupferfeld.
     * Ungerade oben: 1/2 in Spalte 0, 3/4 in Spalte 1 ... — wie auf der Front.
     * Zeilenweise:   obere Reihe 1..cols, untere cols+1..2*cols.
     */
    _cell(n, cols) {
        if (this._numbering === 1) {
            return n <= cols ? [n - 1, 0] : [n - 1 - cols, 1];
        }
        return [Math.floor((n - 1) / 2), (n - 1) % 2];
    }

    // ── Darstellung ────────────────────────────────────────────────────────

    _canvas() {
        var root = this._target.querySelector('.nt-faceplate-widget-canvas');
        if (!root) return null;
        root.textContent = '';
        this._tip = null;
        return root;
    }

    _renderMsg(msg) {
        var root = this._canvas();
        if (!root) return;
        var d = document.createElement('div');
        d.style.cssText = 'display:flex;align-items:center;justify-content:center;'
            + 'height:100%;min-height:60px;padding:8px;text-align:center;'
            + 'font-size:11px;color:' + this._COL.sub;
        d.textContent = msg;
        root.appendChild(d);
    }

    _svg(tag, attrs) {
        var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (var k in attrs) {
            if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, String(attrs[k]));
        }
        return el;
    }

    _render(data) {
        var root = this._canvas();
        if (!root) return;
        this._dark = window.NtTheme.isDark(root);
        this._COL  = window.NtTheme.palette(this._dark);

        var ports = data.ports || [];
        if (!ports.length) {
            this._renderMsg('No switch ports found on this host. The faceplate needs the IF-MIB items '
                + 'of an SNMP template (for example "Network Generic Device by SNMP").');
            return;
        }

        var copper = parseInt(data.copper || 0, 10) || 0;
        var sfp    = parseInt(data.sfp || 0, 10) || 0;

        // Masse in viewBox-Einheiten; das SVG skaliert auf die Kachel.
        var PW = 20, PH = 16, GX = 3, GY = 4, BLOCK = 6, BGAP = 6;
        var SW = 24, SH = 14, SGAP = 14;
        var LBL = this._showLabels ? 7 : 0;
        var PAD = 6;

        var cols   = Math.ceil(copper / 2);
        var blocks = Math.ceil(cols / BLOCK);
        var copperW = cols * PW + (cols - 1) * GX + (blocks - 1) * BGAP;
        if (cols === 0) copperW = 0;

        var sfpTwoRows = sfp > 2;
        var sfpCols = sfpTwoRows ? Math.ceil(sfp / 2) : sfp;
        var sfpW = sfp ? (sfpCols * SW + (sfpCols - 1) * GX) : 0;

        var fieldH = 2 * PH + GY;
        var W = PAD * 2 + copperW + (sfp && copper ? SGAP : 0) + sfpW;
        var H = PAD * 2 + LBL * 2 + fieldH;

        var svg = this._svg('svg', {
            viewBox: '0 0 ' + W + ' ' + H,
            preserveAspectRatio: 'xMidYMid meet',
            width: '100%',
            role: 'img'
        });
        svg.style.cssText = 'display:block;max-height:calc(100% - 18px);flex:1 1 auto;min-height:0;';

        // Gehaeuse
        svg.appendChild(this._svg('rect', {
            x: 0.5, y: 0.5, width: W - 1, height: H - 1, rx: 3,
            fill: this._COL.surface, stroke: this._COL.border, 'stroke-width': 1
        }));

        var self = this;
        var top0 = PAD + LBL;
        var up = 0, down = 0;
        var loopGeo = {};   // Front-Nr -> {cx,cy,top} der Selbst-Loop-Enden, fuer den Bogen

        // Jede Buchse des Zuschnitts zeichnen, auch die, fuer die keine Daten
        // kamen (LLD filtert notPresent, Item unsupported): die Portnummer
        // ist die echte Frontnummer, eine Luecke bleibt als leere Buchse
        // stehen, statt die folgenden Ports aufruecken zu lassen.
        var byN = {};
        for (var j = 0; j < ports.length; j++) byN[ports[j].n] = ports[j];

        for (var n = 1; n <= copper + sfp; n++) {
            var p = byN[n] || { n: n, kind: n <= copper ? 'rj45' : 'sfp', absent: true,
                                oper: 0, admin: 0, problem: -1, poe: null, stp: -1, itemid: '' };
            var x, y, w, h, row;
            if (p.kind === 'sfp') {
                var k = p.n - copper;   // 1-basiert innerhalb der SFP-Schaechte
                var sc, sr;
                if (sfpTwoRows) {
                    sc = Math.floor((k - 1) / 2);
                    sr = (k - 1) % 2;
                } else {
                    sc = k - 1;
                    sr = -1;            // eine Reihe, mittig
                }
                x = PAD + copperW + (copper ? SGAP : 0) + sc * (SW + GX);
                y = sr < 0 ? top0 + (fieldH - SH) / 2 : top0 + sr * (PH + GY) + (PH - SH) / 2;
                w = SW; h = SH;
                row = sr < 0 ? 0 : sr;
            } else {
                var cell = this._cell(p.n, cols);
                var c = cell[0];
                row = cell[1];
                x = PAD + c * (PW + GX) + Math.floor(c / BLOCK) * BGAP;
                y = top0 + row * (PH + GY);
                w = PW; h = PH;
            }
            if (p.oper === 1) up++; else if (p.oper) down++;

            var g = this._svg('g', { 'class': 'nt-fp-port', cursor: p.itemid ? 'pointer' : 'default' });
            if (p.absent) g.setAttribute('opacity', '0.45');
            g.appendChild(this._portShape(p, x, y, w, h, row));

            // Selbst-Loop-Ende: kraeftiger ORANGER Rahmen um den ganzen Port
            // (faellt im kleinen Ueberblick auf). Orange = Loop von STP
            // abgefangen (kontrolliert, Kabel ziehen), kein Alarm. Geometrie fuer
            // den verbindenden Bogen merken.
            if (p.loop_partner || p.loop_partner_of) {
                var lblk = this._dark ? '#fb923c' : '#ea580c';
                loopGeo[p.n] = { cx: x + w / 2, cy: y + h / 2, top: y };
                g.appendChild(this._svg('rect', { x: x - 2, y: y - 2, width: w + 4, height: h + 4,
                    rx: 3, fill: 'none', stroke: lblk, 'stroke-width': 2.6 }));
            }

            if (p.poe === true) {
                // Blitz oben rechts in der Buchse
                var bx = x + w - 6, by = y + 2;
                g.appendChild(this._svg('path', {
                    d: 'M' + (bx + 2.6) + ' ' + by + 'l-2.2 3.4h1.6l-1 2.6 2.6-3.6h-1.6z',
                    fill: '#facc15', stroke: '#713f12', 'stroke-width': 0.3
                }));
            }

            // Marker, drei Faelle in dieser Reihenfolge:
            //  1) Selbst-Loop, GEBLOCKTES Ende -> oranges Badge mit Slash. An
            //     loop_partner gehaengt, NICHT an stp==2 (das per-Port-Item kann
            //     noch nicht gepollt sein, waehrend der Walk den Loop schon kennt).
            //  2) Normaler Redundanz-Block (stp==2, kein Selbst-Loop) -> neutrales
            //     cyanes Badge: gesundes Design, kein Handlungsbedarf.
            //  3) Selbst-Loop, WEITERLEITENDES Ende -> oranger Ring.
            var mcx = x + w / 2, mcy = y + h / 2, mrr = Math.min(w, h) * 0.3, mhx = mrr * 0.6;
            var corange = this._dark ? '#fb923c' : '#ea580c';
            var ccyan = this._dark ? '#22d3ee' : '#0891b2';
            if (p.loop_partner) {
                g.appendChild(this._svg('circle', { cx: mcx, cy: mcy, r: mrr + 0.6, fill: 'rgba(8,24,30,0.6)' }));
                g.appendChild(this._svg('circle', { cx: mcx, cy: mcy, r: mrr, fill: corange }));
                g.appendChild(this._svg('line', { x1: mcx - mhx, y1: mcy - mhx, x2: mcx + mhx, y2: mcy + mhx,
                    stroke: '#ffffff', 'stroke-width': 1.7, 'stroke-linecap': 'round' }));
            }
            else if (p.stp === 2) {
                g.appendChild(this._svg('circle', { cx: mcx, cy: mcy, r: mrr + 0.6, fill: 'rgba(8,24,30,0.6)' }));
                g.appendChild(this._svg('circle', { cx: mcx, cy: mcy, r: mrr, fill: ccyan }));
                g.appendChild(this._svg('line', { x1: mcx - mhx, y1: mcy - mhx, x2: mcx + mhx, y2: mcy + mhx,
                    stroke: '#ffffff', 'stroke-width': 1.7, 'stroke-linecap': 'round' }));
            }
            else if (p.loop_partner_of) {
                g.appendChild(this._svg('circle', { cx: mcx, cy: mcy, r: mrr + 0.6, fill: 'rgba(8,24,30,0.6)' }));
                g.appendChild(this._svg('circle', { cx: mcx, cy: mcy, r: mrr, fill: corange }));
                g.appendChild(this._svg('circle', { cx: mcx, cy: mcy, r: mrr - 1.6, fill: this._fill(p) }));
            }

            if (LBL) {
                var ly = (p.kind === 'sfp' && sr < 0) ? y - 2
                       : (row === 0 ? y - 2 : y + h + LBL - 1.5);
                var t = this._svg('text', {
                    x: x + w / 2, y: ly, 'text-anchor': 'middle',
                    'font-size': 5.5, fill: this._COL.sub,
                    'font-family': 'system-ui, sans-serif'
                });
                t.textContent = String(p.n);
                g.appendChild(t);
            }

            if (p.absent) {
                svg.appendChild(g);
                continue;
            }

            (function (port, el) {
                el.addEventListener('mouseenter', function (ev) { self._showTip(port, ev); });
                el.addEventListener('mousemove', function (ev) { self._moveTip(ev); });
                el.addEventListener('mouseleave', function () { self._hideTip(); });
                el.addEventListener('click', function () {
                    if (!port.itemid) return;
                    window.open('history.php?action=showgraph&itemids%5B%5D=' + encodeURIComponent(port.itemid), '_blank', 'noopener');
                });
            })(p, g);

            svg.appendChild(g);
        }

        // Loop-Leitung: gestrichelter Bogen zwischen den beiden Enden eines
        // Selbst-Loops — erst damit liest man "diese zwei Ports sind EIN Loop".
        // Hinter die Ports gelegt (direkt ueber den Hintergrund).
        var ablk = this._dark ? '#fb923c' : '#ea580c';
        var arcs = this._svg('g', {});
        for (var ai = 0; ai < ports.length; ai++) {
            var lp = ports[ai];
            if (!lp.loop_partner) continue;     // einmal je Paar, vom geblockten Ende
            var a = loopGeo[lp.n], b = loopGeo[lp.loop_partner];
            if (!a || !b) continue;
            // Nach oben begrenzen: ohne Portnummern (LBL=0) ist kaum Rand ueber
            // den Ports, sonst raegte Bogen + Glyph ueber den SVG-Rand.
            var peak = Math.max(4, Math.min(a.top, b.top) - 9);
            arcs.appendChild(this._svg('path', {
                d: 'M' + a.cx + ' ' + a.cy + ' C' + a.cx + ' ' + peak + ', '
                    + b.cx + ' ' + peak + ', ' + b.cx + ' ' + b.cy,
                fill: 'none', stroke: ablk, 'stroke-width': 2.4,
                'stroke-dasharray': '4 3', 'stroke-linecap': 'round'
            }));
            // Warn-Glyph am Scheitel: oranger Punkt mit weissem "!".
            var mx = (a.cx + b.cx) / 2, my = peak + 1.5;
            arcs.appendChild(this._svg('circle', { cx: mx, cy: my, r: 4.6, fill: 'rgba(8,24,30,0.6)' }));
            arcs.appendChild(this._svg('circle', { cx: mx, cy: my, r: 4, fill: ablk }));
            var bang = this._svg('text', { x: mx, y: my + 2.4, 'text-anchor': 'middle',
                'font-size': 6.5, 'font-weight': '700', fill: '#ffffff',
                'font-family': 'system-ui, sans-serif' });
            bang.textContent = '!';
            arcs.appendChild(bang);
        }
        if (arcs.childNodes.length) {
            svg.insertBefore(arcs, svg.childNodes[1] || null);
        }

        var wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;padding:4px;box-sizing:border-box;';
        wrap.appendChild(svg);

        // Fusszeile: Host, Zuschnitt, Zaehler — und was fehlt, sagt sie auch.
        var notes = [String(data.host || ''), String(data.layout || ''),
                     up + ' up', down + ' down'];
        if (data.extra) {
            notes.push(data.extra + ' more ports do not fit this layout');
        }
        if (data.truncated) {
            notes.push('item limit reached');
        }
        // Switch-PoE-Budget (nur wenn das Geraet pethMainPse* liefert).
        // poe_budget ist entweder null oder {used,nominal} (beide ints) — das
        // Vorhandensein genuegt als Bedingung.
        if (data.poe_budget) {
            notes.push('PoE: ' + (data.poe_budget.used || 0) + ' / ' + (data.poe_budget.nominal || 0) + ' W');
        }
        var foot = document.createElement('div');
        foot.style.cssText = 'flex:0 0 auto;padding-top:3px;font-size:10px;color:' + this._COL.sub
            + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        foot.textContent = notes.filter(function (s) { return s !== ''; }).join(' · ');
        wrap.appendChild(foot);

        root.appendChild(wrap);
    }

    /*
     * Eine Buchse. RJ45 mit der Rastnase zur Reihenmitte hin — obere Reihe
     * Nase unten, untere Reihe Nase oben, wie bei gegenueberliegend
     * verbauten Buchsen. SFP als flacher Schacht.
     *
     * Rahmen: offenes Problem in Severity-Farbe, admin-down gestrichelt.
     */
    _portShape(p, x, y, w, h, row) {
        var fill   = this._fill(p);
        var stroke = p.problem >= 0 ? this._sevColor(p.problem) : this._COL.border;
        var sw     = p.problem >= 0 ? 1.6 : 0.8;
        var attrs  = { fill: fill, stroke: stroke, 'stroke-width': sw };
        if (p.admin === 2) attrs['stroke-dasharray'] = '2 1.5';

        if (p.kind === 'sfp') {
            attrs.x = x; attrs.y = y; attrs.width = w; attrs.height = h; attrs.rx = 1;
            return this._svg('rect', attrs);
        }
        // RJ45-Umriss: Rechteck mit Nase (Breite 40 %, Tiefe 3) an der Innenseite.
        var nw = w * 0.4, nx = x + (w - nw) / 2, nd = 3;
        var d;
        if (row === 0) {
            d = 'M' + x + ' ' + y + 'h' + w + 'v' + (h - nd)
              + 'h' + (-(w - nw) / 2) + 'v' + nd + 'h' + (-nw) + 'v' + (-nd)
              + 'H' + x + 'z';
        } else {
            d = 'M' + x + ' ' + (y + nd) + 'H' + nx + 'v' + (-nd) + 'h' + nw + 'v' + nd
              + 'H' + (x + w) + 'v' + (h - nd) + 'H' + x + 'z';
        }
        attrs.d = d;
        return this._svg('path', attrs);
    }

    // ── Tooltip ────────────────────────────────────────────────────────────

    _showTip(p, ev) {
        var root = this._target.querySelector('.nt-faceplate-widget-canvas');
        if (!root) return;
        if (!this._tip) {
            this._tip = document.createElement('div');
            this._tip.style.cssText = 'position:absolute;z-index:10;pointer-events:none;'
                + 'padding:5px 7px;border-radius:4px;font-size:11px;line-height:1.45;'
                + 'max-width:260px;box-shadow:0 2px 8px rgba(0,0,0,.25);'
                + 'background:' + (this._dark ? '#1f242c' : '#ffffff') + ';color:' + this._COL.text
                + ';border:1px solid ' + this._COL.border + ';';
            root.appendChild(this._tip);
        }
        var lines = [];
        var head = 'Port ' + p.n + (p.name && p.name !== String(p.n) ? '  ' + p.name : '');
        lines.push([head, true]);
        if (p.alias) lines.push([p.alias, false]);
        var st = this._operText(p.oper) + (p.admin === 2 ? ' (disabled)' : '');
        if (p.oper === 1 && p.speed) st += ', ' + this._fmtSpeed(p.speed) + 'bit/s';
        lines.push([st, false]);
        if (p.oper === 1 && (p.in !== null || p.out !== null)) {
            lines.push(['↓ ' + this._fmtBits(p.in) + '   ↑ ' + this._fmtBits(p.out), false]);
        }
        if (p.errors) lines.push(['errors ' + (Math.round(p.errors * 100) / 100) + '/s', false]);
        // PoE: Klasse (Rohwert RFC 3621: 1=class0 … 5=class4) plus Liefer-Zustand.
        // Liefer-Zustand nur behaupten, wenn er BEKANNT ist: poe===true liefert,
        // ===false liefert nicht, null = kein Detection-Item = unbekannt. Sonst
        // stuende "not delivering" ueber Unbekanntem (Geister-/Quality-Verstoss).
        if (p.poe_class >= 1 && p.poe_class <= 5) {
            var poeSuffix = '';
            if (p.poe === true) { poeSuffix = ', delivering power'; }
            else if (p.poe === false) { poeSuffix = ', not delivering'; }
            lines.push(['PoE: Class ' + (p.poe_class - 1) + poeSuffix, false]);
        } else if (p.poe === true) {
            lines.push(['PoE: delivering power', false]);
        }
        if (p.loop_partner) {
            lines.push(['Self-loop: STP blocked this end — other end is port ' + p.loop_partner
                + ' (loop contained, remove the cable)', false]);
        }
        else if (p.stp === 2) {
            lines.push(['STP: blocking a redundant link (healthy)', false]);
        }
        else if (p.loop_partner_of) {
            lines.push(['Self-loop: forwarding end — blocked end is port ' + p.loop_partner_of, false]);
        }
        if (p.nb) lines.push(['⇄ ' + p.nb.host + (p.nb.port ? ' · ' + p.nb.port : ''), false]);
        if (p.problem >= 0) lines.push(['open problem on this port', false]);

        this._tip.textContent = '';
        for (var i = 0; i < lines.length; i++) {
            var d = document.createElement('div');
            d.textContent = lines[i][0];
            if (lines[i][1]) d.style.fontWeight = '600';
            this._tip.appendChild(d);
        }
        this._tip.style.display = 'block';
        this._moveTip(ev);
    }

    _moveTip(ev) {
        if (!this._tip) return;
        var root = this._tip.parentNode;
        var r = root.getBoundingClientRect();
        var x = ev.clientX - r.left + 12;
        var y = ev.clientY - r.top + 12;
        var tw = this._tip.offsetWidth, th = this._tip.offsetHeight;
        if (x + tw > r.width) x = Math.max(0, ev.clientX - r.left - tw - 12);
        if (y + th > r.height) y = Math.max(0, ev.clientY - r.top - th - 12);
        this._tip.style.left = x + 'px';
        this._tip.style.top  = y + 'px';
    }

    _hideTip() {
        if (this._tip) this._tip.style.display = 'none';
    }
}
