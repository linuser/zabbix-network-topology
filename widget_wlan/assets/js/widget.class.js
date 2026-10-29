// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
//
// NT WLAN Widget — eine WLAN-Uebersicht der Access Points der gewaehlten
// Hostgruppen: Client-Zahl, Funkmodule (Kanal/Standard je Band), Funkauslastung
// (Air, Prozent je Band), ausgestrahlte SSIDs (Name + Clients), CPU/Memory,
// Satisfaction (Sat, UniFi-Erlebnisscore, gefaerbt) und Status, je AP eine
// Zeile. Es liest dieselben Knoten wie die Karte ueber
// window.NtWidgetData (network.topology.data) und filtert type === 'wireless';
// die WLAN-Felder (radios inkl. cu, wlan_clients, ssids) liegen auf den Knoten
// (radios/clients seit 5.5.81/83, SSIDs seit 5.5.84).
//
// ES5 (kein Template-Literal, kein Spread, keine Pfeilfunktion, var statt const/
// let) — der jsLoader von Zabbix verlangt es. NtFetchJson/NtTheme/NtWidgetData
// werden aus tools/widget-shared.js hierher erzeugt (ci:parity bewacht das);
// nicht von Hand bearbeiten.

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

class WidgetNetworkTopologyWlan extends CWidget {

    onInitialize() {
        this._groupids = [];
        this._nodes    = [];
        this._active   = false;
        // Severity-Skala wie im Hauptmodul/den anderen NT-Widgets (ES5-Kopie,
        // der jsLoader kennt keine ES-Module — dasselbe Prinzip wie sonst).
        this._SEV_COL = ['#22c55e', '#06b6d4', '#f59e0b', '#f97316', '#ef4444', '#991b1b'];
        this._SEV_LBL = ['OK', 'Info', 'Warn', 'Avg', 'High', 'Crit'];
        this._COL = { warning: '#f59e0b', critical: '#e53742' };
    }

    onStart() {
        var root = this._target.querySelector('[data-groupids]');
        if (root) {
            try {
                this._groupids = JSON.parse(root.dataset.groupids || '[]');
            } catch (e) {
                this._groupids = [];
            }
            // data-groupids kommt in Zabbix 7.4 leer am Client an — Fallback auf
            // die Feldwerte, sonst bleibt die Kachel auf "Loading..." stehen.
            if (!this._groupids.length && this._fields && this._fields.groupids) {
                this._groupids = this._fields.groupids;
            }
        } else {
            this._groupids = (this._fields && this._fields.groupids) || [];
        }
    }

    onActivate() { this._active = true; }
    onDeactivate() { this._active = false; }

    // Refresh ueber Zabbix' eigenen Update-Zyklus (kein setInterval), wie die
    // anderen NT-Widgets.
    promiseUpdate() {
        var self = this;
        return Promise.resolve(super.promiseUpdate()).then(function () {
            if (!self._active) return;
            return self._loadAll();
        });
    }

    _root() {
        return this._target.querySelector('.nt-wlan-widget-root') || this._target;
    }

    _theme() {
        var dark = !!(window.NtTheme && window.NtTheme.isDark(this._target));
        var p = (window.NtTheme && window.NtTheme.palette)
            ? window.NtTheme.palette(dark)
            : { sub: '#768d99', text: '#1f2c33', surface: '#ffffff', border: '#dfe4e7',
                subSoft: '#f0f3f4', head: '#1f2c33' };
        return p;
    }

    _msg(text) {
        var root = this._root();
        root.innerHTML = '';
        var d = document.createElement('div');
        d.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;'
            + 'justify-content:center;text-align:center;padding:10px;color:' + this._theme().sub
            + ';font-size:11px;line-height:1.5;';
        d.textContent = text;   // textContent: kein HTML aus Fehlermeldungen
        root.appendChild(d);
    }

    // Statushierarchie wie die anderen NT-Widgets: offline > stale (>5min) > severity.
    _hostState(n) {
        if (n.unavailable) {
            return { col: this._COL.critical, lbl: 'OFFLINE' };
        }
        if (n.last_seen && n.last_seen > 0) {
            var ageSec = Math.floor(Date.now() / 1000) - n.last_seen;
            if (ageSec > 300) {
                return { col: this._COL.warning, lbl: 'STALE' };
            }
        }
        var sev = Math.min(n.severity || 0, 5);
        return { col: this._SEV_COL[sev], lbl: this._SEV_LBL[sev] };
    }

    _loadAll() {
        var self = this;
        if (!this._groupids.length) {
            this._msg('Select host groups in widget settings');
            return Promise.resolve();
        }
        return window.NtWidgetData(this._groupids).then(function (data) {
            if (data && data.error) { self._msg(String(data.error)); return; }
            var nodes = (data && data.nodes) || [];
            self._nodes = nodes.filter(function (n) { return n.type === 'wireless'; });
            self._render();
        }).catch(function (err) {
            self._msg('Error: ' + ((err && err.message) || err));
        });
    }

    // ALLE Funkbaender eines AP in eine Zelle: "2.4G Ch6 n · 5G Ch36 ac · 6G ...".
    // Dynamisch ueber die vorhandenen Baender (aufsteigend), damit auch 6 GHz
    // (WiFi 6E/7) erscheint — fixe 2.4/5-Spalten haetten das verschluckt.
    _radiosText(radios) {
        if (!radios) return '';
        var bands = Object.keys(radios).sort(function (a, b) {
            return parseFloat(a) - parseFloat(b);
        });
        var out = [];
        for (var i = 0; i < bands.length; i++) {
            var r = radios[bands[i]] || {};
            var parts = [bands[i] + 'G'];
            if (r.channel != null) parts.push('Ch' + r.channel);
            if (r.std) parts.push(String(r.std).replace('802.11', ''));
            if (r.width) parts.push(r.width + 'M');
            out.push(parts.join(' '));
        }
        return out.join('  ·  ');
    }

    // Funkkanal-Auslastung je Band in eine Zelle: "2.4G 28%  ·  5G 22%".
    // Dynamisch ueber die vorhandenen Baender; nur Baender mit cu-Wert.
    _utilText(radios) {
        if (!radios) return '';
        var bands = Object.keys(radios).sort(function (a, b) {
            return parseFloat(a) - parseFloat(b);
        });
        var out = [];
        for (var i = 0; i < bands.length; i++) {
            var r = radios[bands[i]] || {};
            if (r.cu != null) out.push(bands[i] + 'G ' + r.cu + '%');
        }
        return out.join('  ·  ');
    }

    // Ausgestrahlte SSIDs in eine Zelle: "Office WiFi (3)  ·  Guest (0)".
    // Nach Name zusammengefasst (schon serverseitig), Clients ueber beide Baender;
    // Gast-SSIDs mit Stern. Namen aus fremder Hand -> _cell setzt sie textContent.
    _ssidsText(ssids) {
        if (!ssids || !ssids.length) return '';
        var out = [];
        for (var i = 0; i < ssids.length; i++) {
            var s = ssids[i] || {};
            var name = (s.ssid != null) ? String(s.ssid) : '';
            if (!name) continue;
            var c = (typeof s.clients === 'number') ? s.clients : 0;
            out.push(name + ' (' + c + ')' + (s.guest ? ' *' : ''));
        }
        return out.join('  ·  ');
    }

    _render() {
        if (!this._active) return;
        var th = this._theme();
        var root = this._root();
        root.innerHTML = '';

        var aps = (this._nodes || []).slice().sort(function (a, b) {
            return String(a.label || a.host || '').toLowerCase()
                .localeCompare(String(b.label || b.host || '').toLowerCase());
        });
        if (!aps.length) {
            this._msg('No access points in the selected host groups.');
            return;
        }

        var tbl = document.createElement('table');
        tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;color:' + th.text + ';';

        // Kopf.
        var cols = ['AP', 'Clients', 'Radios', 'Air', 'SSIDs', 'CPU', 'Mem', 'Sat', 'Status'];
        var thead = document.createElement('thead');
        var hr = document.createElement('tr');
        for (var c = 0; c < cols.length; c++) {
            var hc = document.createElement('th');
            hc.textContent = cols[c];
            hc.style.cssText = 'text-align:' + (c === 1 || c === 5 || c === 6 || c === 7 ? 'right' : 'left')
                + ';padding:3px 6px;border-bottom:1px solid ' + th.border + ';color:' + th.sub
                + ';font-weight:600;white-space:nowrap;position:sticky;top:0;background:' + th.surface + ';';
            hr.appendChild(hc);
        }
        thead.appendChild(hr);
        tbl.appendChild(thead);

        var tbody = document.createElement('tbody');
        for (var i = 0; i < aps.length; i++) {
            var n = aps[i];
            var st = this._hostState(n);
            var tr = document.createElement('tr');
            tr.style.cssText = 'border-bottom:1px solid ' + th.subSoft + ';';

            // AP-Name.
            this._cell(tr, n.label || n.host || '', 'left', th.text, true);
            // Clients (Zahl oder —).
            this._cell(tr, (typeof n.wlan_clients === 'number') ? String(n.wlan_clients) : '—',
                'right', th.text, false);
            // Funkbaender (alle, dynamisch — inkl. 6 GHz bei WiFi 6E/7).
            this._cell(tr, this._radiosText(n.radios) || '—', 'left', th.sub, false);
            // Funkauslastung je Band (cu, Prozent).
            this._cell(tr, this._utilText(n.radios) || '—', 'left', th.sub, false);
            // Ausgestrahlte SSIDs (Name + Clients, Gast mit *).
            this._cell(tr, this._ssidsText(n.ssids) || '—', 'left', th.sub, false);
            // CPU / Mem.
            this._cell(tr, (n.cpu != null) ? (n.cpu + '%') : '—', 'right', th.sub, false);
            this._cell(tr, (n.memory != null) ? (n.memory + '%') : '—', 'right', th.sub, false);
            // Satisfaction (0..100), nach Schwelle gefaerbt; der Trigger alarmiert.
            // Schwellen/Farben mit detail-panel.js SYNCHRON halten (kein ci:parity).
            var sv = (typeof n.wlan_satisfaction === 'number') ? n.wlan_satisfaction : null;
            var satCol = (sv == null) ? th.sub : (sv >= 70 ? '#22c55e' : (sv >= 40 ? '#f97316' : '#ef4444'));
            this._cell(tr, (sv == null) ? '—' : (sv + '%'), 'right', satCol, false);
            // Status als farbige Pille.
            var sc = document.createElement('td');
            sc.style.cssText = 'padding:3px 6px;white-space:nowrap;';
            var pill = document.createElement('span');
            pill.textContent = st.lbl;
            pill.style.cssText = 'display:inline-block;padding:1px 6px;border-radius:8px;font-size:10px;'
                + 'font-weight:700;color:#fff;background:' + st.col + ';';
            sc.appendChild(pill);
            tr.appendChild(sc);

            tbody.appendChild(tr);
        }
        tbl.appendChild(tbody);
        root.appendChild(tbl);
    }

    _cell(tr, text, align, color, bold) {
        var td = document.createElement('td');
        td.textContent = text;   // textContent: kein HTML aus Namen/Werten (XSS)
        td.style.cssText = 'padding:3px 6px;text-align:' + align + ';color:' + color
            + ';white-space:nowrap;' + (bold ? 'font-weight:600;' : '');
        tr.appendChild(td);
    }
}
