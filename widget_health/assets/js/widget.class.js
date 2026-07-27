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
 * verfuegbar). Wenn sich die Formel im Haupt-Tab aendert, hier mitziehen.
 */

class WidgetNetworkTopologyHealth extends CWidget {

    onInitialize() {
        this._timer       = null;
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

    onActivate() {
        // Laden + Rendern gehoert in onActivate (Widget aktiv, DOM bereit) —
        // NICHT in onStart. Genau das war der zweite Teil des Bugs: onStart lief
        // zu frueh, der Canvas war noch nicht da. Spiegelt das Topology-Widget.
        this._loadAndRender();
        if (this._timer) clearInterval(this._timer);
        // Refresh-Cycle: 60s — Health-Aenderungen entwickeln sich langsam.
        var self = this;
        this._timer = setInterval(function() { self._loadAndRender(); }, 60000);
    }

    onDeactivate() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }

    _loadAndRender() {
        var self = this;
        var ids = this._groupids;
        if (!ids || !ids.length) {
            // Backend liefert ohne groupids nichts — UX-Hinweis statt 0/0
            this._renderError('Bitte Host groups in der Widget-Konfiguration waehlen.');
            return;
        }
        var params = new URLSearchParams();
        params.append('action', 'network.topology.v6.data');
        for (var i = 0; i < ids.length; i++) params.append('groupids[]', String(ids[i]));
        var url = 'zabbix.php?' + params.toString();
        fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data && data.error) {
                    self._renderError(String(data.error));
                    return;
                }
                self._render((data && data.nodes) || []);
            })
            .catch(function(e) {
                self._renderError(e && e.message || 'Fehler');
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
        if (s >= 85) return 'Gesund';
        if (s >= 65) return 'OK';
        if (s >= 40) return 'Achtung';
        return 'Kritisch';
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

    _render(nodes) {
        var root = this._target.querySelector('.nt-health-widget-canvas');
        if (!root) return;
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
                + 'Keine Hostgroups gefunden.</div>';
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
            +   stats.length + ' Gruppen · Ø '
            +   '<b style="color:' + this._scoreColor(avg)      + '">' + avg      + '</b> · Min '
            +   '<b style="color:' + this._scoreColor(minScore) + '">' + minScore + '</b>'
            + '</div>'
            + '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(240px, 1fr));gap:8px">';
        for (var k = 0; k < stats.length; k++) html += this._cardHtml(stats[k]);
        html += '</div>';
        if (this._showLegend) {
            html += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid ' + this._COL_BORDER
                + ';font-size:10px;color:' + this._COL_SUB + ';display:flex;gap:12px;flex-wrap:wrap">'
                + '<span><b style="color:' + this._COL_OK   + '">85+</b> Gesund</span>'
                + '<span><b style="color:' + this._COL_WARN + '">65-85</b> OK</span>'
                + '<span><b style="color:' + this._COL_BAD  + '">40-65</b> Achtung</span>'
                + '<span><b style="color:' + this._COL_CRIT + '">&lt;40</b> Kritisch</span>'
                + '</div>';
        }
        html += '</div>';
        root.innerHTML = html;
    }

    _renderError(msg) {
        var root = this._target.querySelector('.nt-health-widget-canvas');
        if (!root) return;
        root.innerHTML = '<div style="padding:14px;color:' + this._COL_CRIT + ';font-size:12px">'
            + 'Health-Widget: Hauptmodul nicht erreichbar (' + this._esc(msg) + ')</div>';
    }
}
