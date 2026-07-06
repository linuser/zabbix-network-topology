<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
/**
 * Network Topology View — Zabbix 7.4
 */

$this->addJsFile('multiselect.js');

// Only pass selected groups to CMultiSelect data (pre-selected items)
$selected_groups = array_filter(
    $data['hostgroups'],
    static function(array $g) use ($data): bool {
        return in_array($g['groupid'], $data['selected_groupids'], false);
    }
);

$selected_data = array_map(
    static function(array $g): array {
        return ['id' => $g['groupid'], 'name' => $g['name']];
    },
    $selected_groups
);

(new CHtmlPage())
    ->setTitle(_('Network Topology'))
    ->setDocUrl('')
    ->addItem(
        (new CForm('get', 'zabbix.php'))
            ->addVar('action', 'network.topology.v6.view')
            ->setId('nt-filter-form')
            ->addItem(
                (new CDiv())
                    ->addClass('filter-container')
                    ->addItem(
                        (new CFormList())
                            ->addRow(
                                new CLabel(_('Host groups'), 'groupids_ms'),
                                (new CMultiSelect([
                                    'name'        => 'groupids[]',
                                    'object_name' => 'hostGroup',
                                    'data'        => $selected_data,
                                    'popup' => [
                                        'parameters' => [
                                            'srctbl'  => 'host_groups',
                                            'srcfld1' => 'groupid',
                                            'dstfrm'  => 'nt-filter-form',
                                            'dstfld1' => 'groupids_'
                                        ]
                                    ]
                                ]))->setWidth(ZBX_TEXTAREA_FILTER_STANDARD_WIDTH)
                            )
                            ->addRow(
                                '',
                                (new CButton('clear_groups', _('Auswahl leeren')))
                                    ->setAttribute('type', 'button')
                                    ->setAttribute('onclick',
                                        'document.querySelectorAll("#groupids_ span.zi-remove-smaller").forEach(function(s){s.click();});'
                                    )
                                    ->addClass('btn-alt')
                            )
                    )
                    ->addItem(
                        (new CDiv())
                            ->addClass('filter-buttons')
                            ->addItem(
                                (new CSubmit('apply', _('Apply')))->addClass('btn-primary')
                            )
                            ->addItem(
                                (new CRedirectButton(_('Reset'),
                                    (new CUrl('zabbix.php'))->setArgument('action', 'network.topology.v6.view')
                                ))->addClass('btn-alt')
                            )

                    )
            )
    )
    ->addItem(
        (new CDiv())
            ->setId('nt-root')
            ->addItem(
                (new CDiv())
                    ->addClass('nt-topbar')
                    ->addItem(
                        (new CDiv())
                            ->addClass('nt-topbar__actions')
                            ->addItem(
                                (new CButton('nt-btn-labels', _('Hide Labels')))
                                    ->setId('nt-btn-labels')
                                    ->addClass('btn-alt btn-small')
                            )
                            ->addItem(
                                (new CButton('nt-btn-fullscreen', "\xe2\x9b\xb6 " . _('Fullscreen')))
                                    ->setId('nt-btn-fullscreen')
                                    ->addClass('btn-alt btn-small')
                            )
                            ->addItem(
                                (new CDiv())
                                    ->addClass('nt-zoom-btns')
                                    ->addItem(
                                        (new CButton('nt-btn-zoom-in', '+'))
                                            ->setId('nt-btn-zoom-in')
                                            ->addClass('btn-alt btn-small')
                                    )
                                    ->addItem(
                                        (new CButton('nt-btn-zoom-out', "\xe2\x88\x92"))
                                            ->setId('nt-btn-zoom-out')
                                            ->addClass('btn-alt btn-small')
                                    )
                                    ->addItem(
                                        (new CSpan())->setId('nt-zoom-label')->addItem('100%')
                                    )
                            )
                    )
            )
            ->addItem(
                (new CDiv())
                    ->setId('nt-canvas-wrap')
                    ->addClass('nt-canvas-wrap')
                    ->addItem(
                        (new CDiv())
                            ->setId('nt-loading')
                            ->addClass('nt-loading')
                            ->addItem(new CDiv())
                            ->addItem(new CSpan(_('Loading topology...')))
                    )
            )
            ->addItem(
                (new CDiv())->setId('nt-detail')->addClass('nt-detail')
            )
            ->addItem(
                // Footer: Autor + Version + Lizenz. Version kommt aus
                // manifest.json (unten geparst). Im Wallboard-Mode blendet
                // CSS (body.nt-wallboard) die Zeile aus — dort zaehlt jeder
                // Pixel Vertikalplatz.
                (new CDiv())
                    ->setId('nt-footer')
                    ->addClass('nt-footer')
                    ->addItem(new CSpan(
                        'Network Topology for Zabbix ' . (static function() {
                            $m = @json_decode((string) @file_get_contents(dirname(__DIR__) . '/manifest.json'), true);
                            return 'v' . (is_array($m) && !empty($m['version']) ? $m['version'] : '?');
                        })() . ' — © Alexander Fox | PlaNet Fox — AGPL-3.0'
                    ))
            )
    )
    ->show();
?>

<?php
// Cache-Buster gegen klebrigen Browser-Cache (besonders ES-Module in Safari).
// mtime der Haupt-JS-Datei + manifest.json kombiniert ergibt einen Token,
// der sich bei jedem Deploy aendert. ES-Module-Sub-Imports bekommen das ?v=
// nicht automatisch, fallen aber auf ETag/Last-Modified-Validierung zurueck —
// wenn beim Deploy das ganze Modul-Verzeichnis ersetzt wird (was praktisch
// immer der Fall ist), werden die mtimes aller Sub-Module mit-aktualisiert
// und der bedingte GET liefert frischen Code statt Cache.
$_nt_module_root = dirname(__DIR__);
$_nt_main_js  = $_nt_module_root . '/assets/js/network-topology.js';
$_nt_main_css = $_nt_module_root . '/assets/css/network-topology.css';
$_nt_manifest = $_nt_module_root . '/manifest.json';
$_nt_v = (string) max(
    is_file($_nt_main_js)  ? filemtime($_nt_main_js)  : 0,
    is_file($_nt_main_css) ? filemtime($_nt_main_css) : 0,
    is_file($_nt_manifest) ? filemtime($_nt_manifest) : 0
);
if ($_nt_v === '0' || $_nt_v === '') $_nt_v = (string) time();
?>
<link rel="stylesheet" type="text/css"
      href="modules/network_topology_v6/assets/css/network-topology.css?v=<?= $_nt_v ?>">
<script src="modules/network_topology_v6/assets/js/cytoscape.min.js"></script>
<?php // Leaflet (CSS+JS, ~144 KB) wird NICHT upfront geladen — nur im Geo-Tab
      // gebraucht; render-geo.js injiziert es per ensureLeaflet() lazy.
      // cola-Layout wurde entfernt (kein LAYOUT_OPTIONS-Eintrag nutzte es). ?>


<?php
$data_url = (new CUrl('zabbix.php'))
    ->setArgument('action', 'network.topology.v6.data')
    ->getUrl();

?>
<script>
window.NT_CONFIG = <?= json_encode([
    'selected_groupids'    => array_values(array_map('strval', $data['selected_groupids'])),
    'selected_group_names' => array_values(array_column(
        array_filter($data['hostgroups'], static function($g) use ($data) {
            return in_array($g['groupid'], $data['selected_groupids'], false);
        }),
        'name'
    )),
    'data_url'   => $data_url,
    'can_edit'       => (bool) $data['user']['can_edit'],
    'is_super_admin' => (bool) ($data['user']['is_super_admin'] ?? false),
    // Optionaler Provider-Name für die Internet-Wolke im Hierarchie-Layout.
    // Aus URL-Parameter ?internet=Vodafone gelesen; leer = "Internet" als Default.
    'internet_label' => (string) ($data['internet_label'] ?? ''),
    // Wallboard-Mode: ?wallboard=1 → vollflächig, kein Header, Auto-Tab-Wechsel
    'wallboard'  => (bool) ($data['wallboard'] ?? false),
    // User-ID f\u00FCr Multi-User-Trennung der localStorage-Keys.
    // F\u00E4llt auf 0 zur\u00FCck, falls CWebUser nicht verf\u00FCgbar \u2014 dann teilt
    // sich der Browser wie fr\u00FCher die Daten (non-breaking Fallback).
    'user_id'    => (string) (\CWebUser::$data['userid'] ?? 0),
    // Zabbix-User-Sprache ("de_DE", "en_US", "default") \u2014 i18n.js mappt
    // das auf de/en, bei "default" entscheidet die Browser-Sprache.
    'lang'       => (string) (\CWebUser::$data['lang'] ?? 'default')
], JSON_HEX_TAG | JSON_HEX_AMP) ?>;

// Fallback: groupids aus URL wenn PHP NT_CONFIG nicht liefert
if (!window.NT_CONFIG || !window.NT_CONFIG.selected_groupids || !window.NT_CONFIG.selected_groupids.length) {
    var _p = new URLSearchParams(window.location.search);
    var _g = _p.getAll('groupids[]');
    if (!_g.length) _g = _p.getAll('groupids%5B%5D');
    if (_g.length) {
        window.NT_CONFIG = window.NT_CONFIG || {};
        window.NT_CONFIG.selected_groupids = _g;
        window.NT_CONFIG.selected_group_names = [];
        window.NT_CONFIG.data_url = 'zabbix.php?action=network.topology.v6.data';
        // Fail closed: dieser Fallback greift nur wenn PHP NT_CONFIG NICHT
        // geliefert hat (also auch die serverseitig ermittelte Admin-Rolle
        // fehlt). can_edit steuert Admin-only-UI (Bearbeiten-Links, Wartung).
        // Auf true zu defaulten wuerde einem Nicht-Admin diese Buttons zeigen
        // (das Backend blockt zwar, aber die UI soll gar nicht "fail open"
        // sein). Ohne verlaessliche Rolle → keine Edit-UI.
        window.NT_CONFIG.can_edit = false;
    }
}

</script>
<script type="module">
// ES-Module-Cache-Buster fuer Safari & Co.: statische ES-Imports
// (import ... from './foo.js') ignorieren den ?v=<mtime>-Buster am Haupt-JS,
// d.h. nach einem Deploy laedt der Browser zwar das neue network-topology.js
// aber die importierten Sub-Module aus seinem Cache → ReferenceErrors.
//
// Loesung: alle Module per fetch holen, jeden 'from'-Pfad in absolute URLs
// mit ?v= umschreiben, dann als Blob-URL importieren. Browser sieht eine
// Kette frischer Blob-URLs, kein Cache-Hit moeglich. ?v=<mtime> aenders
// sich bei jedem Deploy → frischer Code, ohne Cache-Clear.
(async function ntBoot() {
    const V    = "<?= $_nt_v ?>";
    const BASE = "modules/network_topology_v6/assets/js/";
    const blobUrls = new Map();   // module-path → Blob-URL

    // Memoize die in-flight PROMISE pro Modulpfad (statt eines null-Platzhalters):
    // gleichzeitige Anforderungen desselben Moduls (shared deps) teilen sich EINE
    // Fetch/Blob-Erzeugung, und Geschwister-Imports laden PARALLEL (Promise.all)
    // statt seriell — das verkuerzt den First-/Post-Deploy-Load der ~44 Module
    // deutlich (Fetch-Wasserfall -> Fetch pro Ebene). Zyklen sind by-design
    // ausgeschlossen (Leaf-Module fuer geteilte Helfer), daher kein Deadlock.
    function loadModule(path) {
        if (blobUrls.has(path)) return blobUrls.get(path);
        const promise = (async function() {
            const r = await fetch(BASE + path + '?v=' + V);
            if (!r.ok) throw new Error('fetch failed: ' + path + ' (' + r.status + ')');
            let src = await r.text();

            // Alle 'from "./..."' / 'from "../..."' raussuchen
            const importRe = /(from\s+['"])(\.\.?\/[\w./-]+\.js)(['"])/g;
            const matches = [];
            let m;
            while ((m = importRe.exec(src)) !== null) matches.push(m[2]);

            const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/') + 1) : '';
            // Sub-Imports PARALLEL resolven + laden
            const entries = await Promise.all(matches.map(async function(rel) {
                // Pfad-Normalisierung: ./foo.js, ../foo.js, ./modules/bar.js
                const parts = (dir + rel).split('/');
                const out = [];
                for (const p of parts) {
                    if (p === '..') out.pop();
                    else if (p && p !== '.') out.push(p);
                }
                return [rel, await loadModule(out.join('/'))];
            }));
            const subs = {};
            for (const e of entries) subs[e[0]] = e[1];

            // Imports im Source auf Blob-URLs umschreiben
            src = src.replace(importRe, function(_m, a, p, c) {
                return a + (subs[p] || p) + c;
            });
            const blob = new Blob([src], { type: 'application/javascript' });
            return URL.createObjectURL(blob);
        })();
        blobUrls.set(path, promise);
        return promise;
    }

    try {
        const mainUrl = await loadModule('network-topology.js');
        await import(mainUrl);
    } catch (e) {
        // Nicht still scheitern (weisser Screen): sichtbare Meldung statt
        // leerer Seite. Haeufigste Ursache in gehaerteten Umgebungen ist eine
        // Content-Security-Policy ohne 'blob:' in script-src — dann blockiert
        // der Browser die Blob-Module. Der Fehlertext nennt genau das.
        console.error('[nt-boot] Module-Loader fehlgeschlagen:', e);
        var box = document.getElementById('nt-loading')
               || document.getElementById('nt-canvas-wrap') || document.body;
        if (box) {
            var msg = String(e && e.message ? e.message : e).replace(/[<>&]/g, function(c) {
                return c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;';
            });
            box.innerHTML = '<div style="padding:20px 24px;max-width:640px;margin:40px auto;'
                + 'font-family:sans-serif;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;'
                + 'border-radius:8px;line-height:1.55">'
                + '<b>Network Topology konnte nicht geladen werden.</b><br>'
                + 'Modul-Loader-Fehler: ' + msg + '<br>'
                + '<span style="color:#7f1d1d;font-size:13px">Falls eine Content-Security-Policy aktiv '
                + 'ist, muss <code>script-src</code> <code>blob:</code> erlauben. Details in der '
                + 'Browser-Konsole.</span></div>';
        }
    }
})();
</script>
<script>window.addEventListener("load", function(){
    // Wallboard-Mode: Body-Klasse setzen damit CSS Header/Filter ausblendet,
    // und Auto-Tab-Switch starten (Tech ↔ Geo alle 30s).
    if (window.NT_CONFIG && window.NT_CONFIG.wallboard) {
        document.body.classList.add('nt-wallboard');
    }
    var form = document.getElementById("nt-filter-form");
    if (form) {
        form.addEventListener("submit", function() {
            form.querySelectorAll("input[name='groupids[]']").forEach(function(el){ el.remove(); });
            var items = jQuery('#groupids_').multiSelect('getData');
            items.forEach(function(item) {
                var inp = document.createElement("input");
                inp.type = "hidden";
                inp.name = "groupids[]";
                inp.value = item.id;
                form.appendChild(inp);
            });
        });
    }
    // Nur aufrufen wenn Bootstrap es noch nicht getan hat
    if (!window._ntInitStarted) { window._ntInit && window._ntInit(); }
});</script>


