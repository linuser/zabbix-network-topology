/*
 * NT Items — Dashboard Widget
 * PlaNet Fox | Alexander Fox
 * Compatible with Zabbix 7.4 jsLoader (ES5-Stil: keine Template-Literals,
 * kein Spread, kein const/let, keine Arrow-Functions).
 *
 * Pivotiert EIN Item-Muster ueber alle Hosts der gewaehlten Gruppen: Hosts als
 * Zeilen, passende Item-Keys als Spalten. Reduzierte Variante von
 * assets/js/modules/items-pivot.js — ES5-konform dupliziert, der Widget-Loader
 * kennt keine ESM-Imports.
 *
 * Warum ein festes Muster statt der interaktiven Auswahl des Haupt-Tabs: dort
 * schlaegt network.topology.discover_patterns vor, was auf den Hosts wirklich
 * existiert, man filtert und sieht die Trefferzahl. Auf einer Kachel gibt es
 * diese Interaktion nicht — also ein freies Textfeld. Eine feste Preset-Liste
 * waere unehrlich zur Datenlage: welche Keys es gibt, weiss nur die jeweilige
 * Umgebung.
 *
 * Eigener Fetch statt window.NtWidgetData: der geteilte Zugriff ist auf
 * network.topology.data und den Schluessel "Hostgruppen" zugeschnitten. Dieses
 * Widget ruft eine andere Action mit einem zusaetzlichen Parameter (pattern),
 * der in den Cache-Schluessel gehoerte. Zwei Items-Widgets mit identischem
 * Muster holen also getrennt — ein seltener Fall, den ich nicht mit einer
 * Verallgemeinerung ueber fuenf Widget-Dateien erkaufen wollte.
 *
 * Gebaut mit createElement/textContent statt innerHTML: Hostnamen und
 * Item-Labels stammen aus Zabbix bzw. per SNMP/LLDP aus dem Netz und sind
 * nicht vertrauenswuerdig.
 */

class WidgetNetworkTopologyItems extends CWidget {

    onInitialize() {
        this._groupids  = [];
        this._pattern   = '';
        this._hideEmpty = true;
        this._maxRows   = 0;

        this._COL_TEXT   = '#1f2c33';
        this._COL_SUB    = '#768d99';
        this._COL_BORDER = '#dfe4e7';
        this._COL_HEAD   = '#f8fafc';
    }

    onStart() {
        var root = this._target.querySelector('.nt-items-widget-canvas');
        if (root) {
            this._pattern   = root.dataset.pattern || '';
            this._hideEmpty = root.dataset.hideEmpty !== '0';
            this._maxRows   = parseInt(root.dataset.maxRows || '0', 10) || 0;
            try {
                this._groupids = JSON.parse(root.dataset.groupids || '[]');
            } catch (e) {
                this._groupids = [];
            }
            // s. die anderen Widgets: data-groupids kommt in Zabbix 7.4 leer am
            // Client an, die Feldwerte stehen dann nur in this._fields.
            if (!this._groupids.length && this._fields && this._fields.groupids) {
                this._groupids = this._fields.groupids;
            }
            if (!this._pattern && this._fields && this._fields.pattern) {
                this._pattern = this._fields.pattern;
            }
        } else {
            this._pattern   = this._fields.pattern || '';
            this._hideEmpty = this._fields.hide_empty !== 0 && this._fields.hide_empty !== false;
            this._maxRows   = parseInt(this._fields.max_rows || 0, 10) || 0;
            this._groupids  = this._fields.groupids || [];
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

        if (!this._groupids || !this._groupids.length) {
            this._renderMsg('Select host groups in the widget configuration.');
            return Promise.resolve();
        }
        // Die Action lehnt ein leeres Muster ab (not_empty) — das hier vorher
        // abzufangen erspart einen Request und liefert eine brauchbare Meldung.
        if (!this._pattern) {
            this._renderMsg('Set an item pattern, for example system.cpu.util');
            return Promise.resolve();
        }

        var params = new URLSearchParams();
        params.append('action', 'network.topology.items');
        params.append('pattern', this._pattern);
        for (var i = 0; i < this._groupids.length; i++) {
            params.append('groupids[]', String(this._groupids[i]));
        }

        return fetch('zabbix.php?' + params.toString(), {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.error) { self._renderMsg(String(data.error)); return; }
                self._render(data || {});
            })
            .catch(function (e) {
                self._renderMsg((e && e.message) || 'Request failed');
            });
    }

    // ── Formatierung ───────────────────────────────────────────────────────

    /*
     * Zahlen lesbar machen. Die Einheit kommt aus dem Item, ist aber oft leer —
     * dann bleibt der Rohwert stehen, gekuerzt auf zwei Nachkommastellen.
     */
    _fmt(v, unit) {
        if (v === null || v === undefined || v === '') return '';
        var n = Number(v);
        if (isNaN(n)) return String(v);

        if (unit === '%') {
            return (Math.round(n * 10) / 10) + '%';
        }
        if (unit === 'B' || unit === 'Bps' || unit === 'bps') {
            var suffix = unit === 'B' ? ['B', 'KB', 'MB', 'GB', 'TB']
                                      : [unit, 'K' + unit, 'M' + unit, 'G' + unit, 'T' + unit];
            var step = 0;
            var val  = Math.abs(n);
            while (val >= 1000 && step < suffix.length - 1) { val = val / 1000; step++; }
            return (n < 0 ? '-' : '') + (Math.round(val * 10) / 10) + ' ' + suffix[step];
        }
        if (unit === 's') {
            if (n < 1)    return (Math.round(n * 1000)) + ' ms';
            if (n < 60)   return (Math.round(n * 10) / 10) + ' s';
            if (n < 3600) return Math.round(n / 60) + ' min';
            return Math.round(n / 3600) + ' h';
        }
        var r = Math.round(n * 100) / 100;
        return unit ? (r + ' ' + unit) : String(r);
    }

    _canvas() {
        var root = this._target.querySelector('.nt-items-widget-canvas');
        if (!root) return null;
        root.textContent = '';
        return root;
    }

    _renderMsg(msg) {
        var root = this._canvas();
        if (!root) return;
        var d = document.createElement('div');
        d.style.cssText = 'display:flex;align-items:center;justify-content:center;'
            + 'height:100%;min-height:60px;padding:8px;text-align:center;'
            + 'font-size:11px;color:' + this._COL_SUB;
        d.textContent = msg;
        root.appendChild(d);
    }

    // ── Tabelle ────────────────────────────────────────────────────────────

    _render(data) {
        var root = this._canvas();
        if (!root) return;

        var columns = data.columns || [];
        var rows    = data.rows    || {};
        var hosts   = data.hosts   || {};

        if (!columns.length) {
            this._renderMsg('No items match "' + this._pattern + '" on these hosts.');
            return;
        }

        // Hosts sortiert nach Namen — die Action liefert sie als Objekt, also
        // ohne verlaessliche Reihenfolge.
        var hids = [];
        for (var hid in hosts) {
            if (!Object.prototype.hasOwnProperty.call(hosts, hid)) continue;
            if (this._hideEmpty && !rows[hid]) continue;
            hids.push(hid);
        }
        var self = this;
        hids.sort(function (a, b) {
            return String(hosts[a] || '').localeCompare(String(hosts[b] || ''));
        });

        if (!hids.length) {
            this._renderMsg('No values for "' + this._pattern + '" on these hosts.');
            return;
        }

        var shown = this._maxRows > 0 ? hids.slice(0, this._maxRows) : hids;

        var table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;'
            + 'color:' + this._COL_TEXT;

        var thead = document.createElement('thead');
        var htr   = document.createElement('tr');
        htr.appendChild(this._th('Host', 'left'));
        for (var c = 0; c < columns.length; c++) {
            htr.appendChild(this._th(columns[c].label || columns[c].key, 'right'));
        }
        thead.appendChild(htr);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        for (var r = 0; r < shown.length; r++) {
            var id  = shown[r];
            var tr  = document.createElement('tr');
            var row = rows[id] || {};

            tr.appendChild(this._td(String(hosts[id] || id), 'left', false));
            for (var k = 0; k < columns.length; k++) {
                var col = columns[k];
                tr.appendChild(this._td(self._fmt(row[col.key], col.unit), 'right', true));
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        root.appendChild(table);

        // Zwei verschiedene Kuerzungen, und beide muss man sehen: das Backend
        // deckelt die Item-Menge (truncated), das Widget die Zeilen (max_rows).
        // Eine stillschweigend gekuerzte Tabelle liest sich wie eine
        // vollstaendige.
        var notes = [];
        if (data.truncated) {
            notes.push('item limit reached — result truncated by the server');
        }
        if (shown.length < hids.length) {
            notes.push((hids.length - shown.length) + ' more hosts hidden by "max rows"');
        }
        if (notes.length) {
            var foot = document.createElement('div');
            foot.style.cssText = 'padding:6px 4px 2px;font-size:10px;color:' + this._COL_SUB;
            foot.textContent = notes.join(' · ');
            root.appendChild(foot);
        }
    }

    _th(text, align) {
        var el = document.createElement('th');
        el.style.cssText = 'text-align:' + align + ';padding:4px 6px;font-weight:600;'
            + 'font-size:10px;text-transform:uppercase;letter-spacing:0.03em;'
            + 'color:' + this._COL_SUB + ';background:' + this._COL_HEAD
            + ';border-bottom:1px solid ' + this._COL_BORDER
            + ';position:sticky;top:0;';
        el.textContent = text;
        return el;
    }

    _td(text, align, mono) {
        var el = document.createElement('td');
        el.style.cssText = 'text-align:' + align + ';padding:4px 6px;'
            + 'border-bottom:1px solid ' + this._COL_BORDER
            + (mono ? ';font-variant-numeric:tabular-nums' : '');
        el.textContent = text;
        return el;
    }
}
