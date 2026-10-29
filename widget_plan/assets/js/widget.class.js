// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
//
// NT Plan Widget — zeigt den Plan-Modus read-only als Dashboard-Kachel: das
// Hintergrundbild (Luftbild/Grundriss) mit den platzierten Geraeten als Marker,
// gefaerbt nach Severity/Status. Platziert wird im Hauptmodul (Plan-Tab); das
// Widget bildet nur ab.
//
// Datenwege (wie die anderen NT-Widgets):
//   - Hintergrund-Referenz + geteilte Positionen: network.topology.plan
//     (op=ref / op=positions), viewKey = <groupids sortiert>_plan
//   - Knoten-Severity: window.NtWidgetData(groupids) -> network.topology.data
//   - Bild-Bytes: Zabbix' imgstore.php?iconid=<imageid>
//
// Leichtgewichtig: kein Leaflet. Das Bild ist ein <img>, die Marker sind absolut
// positionierte Punkte an (x,y)*Skalierung (Positionen sind Bild-Pixel, Ursprung
// oben links). NtFetchJson/NtTheme/NtWidgetData werden aus tools/widget-shared.js
// hierher erzeugt (siehe Marke oben am jeweiligen Block).

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

class WidgetNetworkTopologyPlan extends CWidget {

    onInitialize() {
        this._groupids   = [];
        this._showLabels = false;
        this._nodes      = [];
        this._positions  = {};
        this._bgSrc      = null;
        this._renderedSrc = null;
        this._imgNatW    = 0;
        this._imgNatH    = 0;
        this._lastImg    = null;
        this._lastOverlay = null;
        this._retry      = false;
        this._active     = false;
        // Severity-Skala wie im Hauptmodul/Haupt-Widget (ES5-Kopie, der jsLoader
        // kennt keine ES-Module — dasselbe Prinzip wie bei der Health-Formel).
        this._SEV_COL = ['#22c55e', '#06b6d4', '#f59e0b', '#f97316', '#ef4444', '#991b1b'];
        this._SEV_LBL = ['OK', 'Info', 'Warn', 'Avg', 'High', 'Krit'];
        this._COL = { warning: '#f59e0b', critical: '#e53742', text: '#1f2c33', sub: '#768d99' };
    }

    onStart() {
        var root = this._target.querySelector('[data-groupids]');
        if (root) {
            try {
                this._groupids = JSON.parse(root.dataset.groupids || '[]');
            } catch (e) {
                this._groupids = [];
            }
            this._showLabels = root.dataset.showLabels === '1';
            // data-groupids kommt in Zabbix 7.4 leer am Client an — Fallback auf
            // die Feldwerte, sonst bleibt die Kachel auf "Loading..." stehen.
            if (!this._groupids.length && this._fields && this._fields.groupids) {
                this._groupids = this._fields.groupids;
            }
        } else {
            this._groupids   = (this._fields && this._fields.groupids) || [];
            this._showLabels = !!(this._fields && (this._fields.show_labels === 1 || this._fields.show_labels === true));
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

    onResize() {
        if (this._lastImg && this._lastOverlay && this._imgNatW) {
            this._placeMarkers(this._lastImg, this._lastOverlay);
        }
    }

    // viewKey muss selectedGroupIds()+'_plan' des Moduls entsprechen:
    // lexikografischer Sort der (String-)Gruppen-IDs, mit "_" verbunden.
    _planViewKey() {
        var ids = (this._groupids || []).map(String).slice().sort();
        return ids.join('_') + '_plan';
    }

    _planUrl(op, view) {
        return 'zabbix.php?action=network.topology.plan&op=' + encodeURIComponent(op)
            + '&view=' + encodeURIComponent(view);
    }

    _xhr() {
        return { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    }

    _loadAll() {
        var self = this;
        if (!this._groupids.length) {
            this._msg('Select host groups in widget settings');
            return Promise.resolve();
        }
        var view = this._planViewKey();
        return Promise.all([
            window.NtWidgetData(this._groupids),
            window.NtFetchJson(this._planUrl('ref', view), this._xhr()),
            window.NtFetchJson(this._planUrl('positions', view), this._xhr())
        ]).then(function (res) {
            var data = res[0], ref = res[1], pos = res[2];
            if (data && data.error) { self._msg(String(data.error)); return; }
            self._nodes     = (data && data.nodes) || [];
            self._positions = (pos && pos.positions) || {};
            if (ref && ref.kind === 'image' && ref.imageid) {
                self._bgSrc = 'imgstore.php?iconid=' + encodeURIComponent(ref.imageid);
            } else if (ref && ref.kind === 'url' && ref.url) {
                self._bgSrc = ref.url;
            } else {
                self._bgSrc = null;
            }
            self._render();
        }).catch(function (err) {
            self._msg('Error: ' + ((err && err.message) || err));
        });
    }

    // Statushierarchie wie im Haupt-Widget: offline > stale (>5min) > severity.
    _hostState(n) {
        if (n.unavailable) {
            return { state: 'offline', col: this._COL.critical, lbl: 'OFFLINE' };
        }
        if (n.last_seen && n.last_seen > 0) {
            var ageSec = Math.floor(Date.now() / 1000) - n.last_seen;
            if (ageSec > 300) {
                return { state: 'stale', col: this._COL.warning, lbl: 'STALE' };
            }
        }
        var sev = Math.min(n.severity || 0, 5);
        return { state: 'normal', col: this._SEV_COL[sev], lbl: this._SEV_LBL[sev] };
    }

    _canvas() {
        return this._target.querySelector('.nt-plan-widget-canvas') || this._target;
    }

    // Dashboard-Theme (hell/dunkel) ueber den geteilten NtTheme-Helfer. Relevant
    // nur fuer den Leerzustand/Meldungen, die auf dem Kachel-Hintergrund liegen —
    // die Marker-Labels liegen ueber dem (meist hellen) Bild und bleiben hell.
    _theme() {
        var dark = !!(window.NtTheme && window.NtTheme.isDark(this._target));
        var p = (window.NtTheme && window.NtTheme.palette)
            ? window.NtTheme.palette(dark)
            : { sub: '#768d99', text: '#1f2c33', surface: '#ffffff' };
        return { dark: dark, sub: p.sub, text: p.text, surface: p.surface };
    }

    _msg(text) {
        // Eine Meldung ersetzt das Bild — beim naechsten Render MUSS neu aufgebaut
        // werden, sonst greift die "Quelle unveraendert"-Abkuerzung in _render()
        // auf das entfernte <img>.
        this._renderedSrc = null;
        this._lastImg = null;
        var root = this._canvas();
        root.innerHTML = '';
        var d = document.createElement('div');
        d.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;'
            + 'justify-content:center;text-align:center;padding:10px;color:' + this._theme().sub
            + ';font-size:11px;line-height:1.5;';
        d.textContent = text;   // textContent: kein HTML aus Fehlermeldungen
        root.appendChild(d);
    }

    _render() {
        if (!this._active) return;
        if (!this._bgSrc) {
            this._msg('No plan background for this host-group selection. Set it in the module’s Plan tab (same host groups).');
            return;
        }
        // Das Bild nur neu aufbauen, wenn sich die Quelle geaendert hat — sonst
        // flackert die Kachel bei jedem Refresh (~60s), weil das <img> samt src
        // neu gesetzt wuerde. Bei gleicher Quelle nur die Marker neu setzen
        // (Severity kann sich geaendert haben).
        if (this._bgSrc === this._renderedSrc && this._lastImg && this._imgNatW) {
            this._placeMarkers(this._lastImg, this._lastOverlay);
            return;
        }
        var self = this;
        var root = this._canvas();
        root.innerHTML = '';

        var wrap = document.createElement('div');
        wrap.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;';
        var inner = document.createElement('div');
        inner.style.cssText = 'position:relative;display:inline-block;max-width:100%;max-height:100%;';
        var img = document.createElement('img');
        img.style.cssText = 'display:block;max-width:100%;max-height:100%;';
        img.alt = '';
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;';

        img.onload = function () {
            self._imgNatW = img.naturalWidth || 1;
            self._imgNatH = img.naturalHeight || 1;
            self._placeMarkers(img, overlay);
        };
        img.onerror = function () { self._msg('The background image could not be loaded.'); };

        inner.appendChild(img);
        inner.appendChild(overlay);
        wrap.appendChild(inner);
        root.appendChild(wrap);

        this._lastImg = img;
        this._lastOverlay = overlay;
        this._renderedSrc = this._bgSrc;
        img.src = this._bgSrc;
    }

    _placeMarkers(img, overlay) {
        var shownW = img.clientWidth;
        if (!shownW) {
            // Layout noch nicht gesetzt (0 breit, z.B. onload vor dem Reflow) —
            // einmal nachfassen. Ohne das wuerde scale aus naturalWidth berechnet
            // (=1) und die Marker landen weit ausserhalb des skaliert gezeigten
            // Bilds, bis das naechste onResize kommt.
            var self = this;
            if (!this._retry) {
                this._retry = true;
                setTimeout(function () { self._retry = false; self._placeMarkers(img, overlay); }, 60);
            }
            return;
        }
        overlay.innerHTML = '';
        var scale = shownW / (this._imgNatW || 1);

        var byId = {};
        var i;
        for (i = 0; i < this._nodes.length; i++) {
            byId[String(this._nodes[i].id)] = this._nodes[i];
        }

        var pos = this._positions;
        for (var id in pos) {
            if (!Object.prototype.hasOwnProperty.call(pos, id)) continue;
            var n = byId[id];
            if (!n) continue;   // nur rechtegeprueft sichtbare Knoten zeichnen
            var p = pos[id];
            if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;

            var st = this._hostState(n);
            var r = 11;
            var left = p.x * scale;
            var top = p.y * scale;

            var dot = document.createElement('div');
            dot.style.cssText = 'position:absolute;width:' + (r * 2) + 'px;height:' + (r * 2) + 'px;'
                + 'left:' + left + 'px;top:' + top + 'px;margin-left:-' + r + 'px;margin-top:-' + r + 'px;'
                + 'border-radius:50%;background:' + st.col + ';border:2px solid #fff;box-sizing:border-box;'
                + 'box-shadow:0 1px 3px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;'
                + 'color:#fff;font:700 10px sans-serif;pointer-events:auto;';
            dot.title = (n.label || n.host || id) + ' — ' + st.lbl
                + (n.problems > 0 ? ' (' + n.problems + ')' : '');
            if (n.problems > 0 && st.state === 'normal') {
                dot.textContent = n.problems > 99 ? '99+' : String(n.problems);
            }
            overlay.appendChild(dot);

            if (this._showLabels) {
                var lab = document.createElement('div');
                lab.style.cssText = 'position:absolute;left:' + left + 'px;top:' + (top + r + 2) + 'px;'
                    + 'transform:translateX(-50%);font:600 10px sans-serif;color:' + this._COL.text + ';'
                    + 'background:rgba(255,255,255,.78);padding:0 3px;border-radius:3px;white-space:nowrap;';
                lab.textContent = n.label || n.host || id;
                overlay.appendChild(lab);
            }
        }
    }
}
