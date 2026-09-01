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
            ->addVar('action', 'network.topology.view')
            ->setId('nt-filter-form')
            ->addItem(
                (new CDiv())
                    ->addClass('filter-container')
                    ->setAttribute('style', 'padding:6px 12px;')
                    // Native Zabbix filter look (Problems page): stacked
                    // CFormList rows, labels right-aligned in the left column,
                    // fields aligned underneath each other — the theme styles
                    // this consistently, unlike hand-rolled flex columns.
                    // Inline extras (Clear, Hops) sit in the field cell.
                    // A selected host wins over the group selection — the
                    // groups stay in the form untouched, so clearing the host
                    // falls straight back to the group view.
                    ->addItem(
                        (new CFormList())
                            ->addRow(
                                new CLabel(_('Host groups'), 'groupids_ms'),
                                // Flex with a real gap: inline siblings of a
                                // multiselect otherwise wrap flush underneath
                                // it, glued to the box.
                                (new CDiv())
                                    ->setAttribute('style', 'display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap;')
                                    ->addItem(
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
                                    ->addItem(
                                        (new CButton('clear_groups', _('Clear')))
                                            ->setAttribute('type', 'button')
                                            ->setAttribute('onclick',
                                                'document.querySelectorAll("#groupids_ span.zi-remove-smaller").forEach(function(s){s.click();});'
                                            )
                                            ->addClass('btn-alt')
                                    )
                            )
                            ->addRow(
                                new CLabel(_('Host (hop mode)'), 'hostid_ms'),
                                (new CDiv())
                                    ->setAttribute('style', 'display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap;')
                                    ->addItem(
                                        (new CMultiSelect([
                                            'name'        => 'hostid',
                                            'object_name' => 'hosts',
                                            'multiple'    => false,
                                            'data'        => ($data['selected_hostid'] ?? '') !== ''
                                                ? [['id' => $data['selected_hostid'], 'name' => $data['selected_host_name']]]
                                                : [],
                                            'popup' => [
                                                'parameters' => [
                                                    'srctbl'  => 'hosts',
                                                    'srcfld1' => 'hostid',
                                                    'dstfrm'  => 'nt-filter-form',
                                                    'dstfld1' => 'hostid'
                                                ]
                                            ]
                                        ]))->setWidth(ZBX_TEXTAREA_FILTER_STANDARD_WIDTH)
                                    )
                                    ->addItem(
                                        (new CDiv())
                                            ->setAttribute('style', 'display:flex;align-items:center;gap:6px;')
                                            ->addItem(new CLabel(_('Hops'), 'hops'))
                                            ->addItem(
                                                (new CSelect('hops'))
                                                    ->setId('hops')
                                                    ->setValue((string) ($data['hops'] ?? 1))
                                                    ->addOptions(CSelect::createOptionsFromArray([
                                                        1 => '1', 2 => '2', 3 => '3', 4 => '4', 5 => '5', 6 => '6'
                                                    ]))
                                            )
                                    )
                            )
                            // One-line explanation of the two scopes, in the
                            // field column so it lines up with the inputs.
                            ->addRow(
                                '',
                                (new CDiv(_('Show whole host groups or pick a single host plus a hop radius. If single host selected, the map then contains only that host and everything within N hops (LLDP/CDP, nt:parent and manual links). A selected host overrides the group selection.')))
                                    ->setAttribute('style', 'color:#7c8594;font-size:12px;max-width:920px;')
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
                                    (new CUrl('zabbix.php'))->setArgument('action', 'network.topology.view')
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
                        })() . ' — © Alexander Fox | PlaNet Fox — AGPL-3.0 — zabfox.de'
                    ))
            )
    )
    ->show();
?>

<?php
// Cache-Buster gegen klebrigen Browser-Cache: mtime des gebundelten
// nt-bundle.js + CSS + manifest.json ergibt einen ?v=-Token, der sich bei
// jedem Deploy (Rebuild) aendert. Da nur EINE gebundelte Datei geladen wird,
// reicht deren mtime — kein Sub-Modul-Cache-Problem mehr wie beim alten
// Blob-Loader.
$_nt_module_root = dirname(__DIR__);
$_nt_main_js  = $_nt_module_root . '/assets/js/dist/nt-bundle.js';
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
      href="modules/network_topology/assets/css/network-topology.css?v=<?= $_nt_v ?>">
<script src="modules/network_topology/assets/js/cytoscape.min.js"></script>
<?php // Leaflet (CSS+JS, ~144 KB) wird NICHT upfront geladen — nur im Geo-Tab
      // gebraucht; render-geo.js injiziert es per ensureLeaflet() lazy.
      // cola-Layout wurde entfernt (kein LAYOUT_OPTIONS-Eintrag nutzte es). ?>


<?php
$data_url = (new CUrl('zabbix.php'))
    ->setArgument('action', 'network.topology.data')
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
    // Host+hops mode ('' = group mode). The JS builds the data URL from these
    // instead of groupids when a host is selected.
    'selected_hostid'    => (string) ($data['selected_hostid'] ?? ''),
    'selected_host_name' => (string) ($data['selected_host_name'] ?? ''),
    'hops'               => (int) ($data['hops'] ?? 1),
    'data_url'   => $data_url,
    'can_edit'       => (bool) $data['user']['can_edit'],
    'is_super_admin' => (bool) ($data['user']['is_super_admin'] ?? false),
    // CSRF-Token fuer die schreibende Maintenance-Action (action- + session-
    // gebunden). Das JS sendet es mit; NetworkTopologyMaintenance prueft es via
    // CCsrfTokenHelper::check -> echter CSRF-Schutz statt nur X-Requested-With.
    'csrf_token' => \CCsrfTokenHelper::get('network.topology.maintenance'),
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
    'lang'       => (string) (\CWebUser::$data['lang'] ?? 'default'),
    // Manuell gezogene Kanten, serverseitig seit 5.0.1. Zwei Ebenen:
    // shared kommt aus module.config und gilt fuer alle, personal aus dem
    // CProfile des Users. Direkt eingebettet, damit die Karte beim ersten
    // Rendern schon vollstaendig ist.
    'manual_links' => [
        'shared'   => $data['manual_links']['shared']   ?? [],
        'personal' => $data['manual_links']['personal'] ?? []
    ],
    // Eigener Token fuer die schreibende Links-Action.
    'links_csrf' => \CCsrfTokenHelper::get('network.topology.links'),
    'links_url'  => 'zabbix.php?action=network.topology.links',
    // Knotenpositionen, serverseitig seit 5.1. Zwei Ebenen wie bei den Links:
    // shared ist DIE Karte (module.config), personal die eigene Abweichung
    // davon (CProfile). Beim Lesen gewinnt personal pro Knoten.
    'positions'      => [
        'shared'   => $data['positions']['shared']   ?? new stdClass(),
        'personal' => $data['positions']['personal'] ?? new stdClass()
    ],
    'positions_csrf' => \CCsrfTokenHelper::get('network.topology.positions'),
    'positions_url'  => 'zabbix.php?action=network.topology.positions',
    // Port-Probe auf Klick. Nur Admins bekommen den Menue-Eintrag; die
    // Action prueft es noch einmal und loest die Adresse selbst ueber die API
    // auf — der Client schickt nie eine IP.
    'portscan_csrf' => \CCsrfTokenHelper::get('network.topology.portscan'),
    'portscan_url'  => 'zabbix.php?action=network.topology.portscan'
], JSON_HEX_TAG | JSON_HEX_AMP) ?>;

// Fallback: groupids/hostid aus URL wenn PHP NT_CONFIG nicht liefert
if (!window.NT_CONFIG || ((!window.NT_CONFIG.selected_groupids || !window.NT_CONFIG.selected_groupids.length) && !window.NT_CONFIG.selected_hostid)) {
    var _p = new URLSearchParams(window.location.search);
    // Host+hops mode first — it also wins server-side.
    var _h = _p.get('hostid');
    if (_h && /^\d+$/.test(_h)) {
        window.NT_CONFIG = window.NT_CONFIG || {};
        window.NT_CONFIG.selected_hostid = _h;
        window.NT_CONFIG.hops = Math.max(1, Math.min(6, parseInt(_p.get('hops'), 10) || 1));
        window.NT_CONFIG.selected_groupids = window.NT_CONFIG.selected_groupids || [];
        window.NT_CONFIG.selected_group_names = window.NT_CONFIG.selected_group_names || [];
        window.NT_CONFIG.data_url = window.NT_CONFIG.data_url || 'zabbix.php?action=network.topology.data';
        // Fail closed, same reasoning as the group fallback below.
        if (window.NT_CONFIG.can_edit === undefined) window.NT_CONFIG.can_edit = false;
    }
    var _g = _p.getAll('groupids[]');
    if (!_g.length) _g = _p.getAll('groupids%5B%5D');
    if (_g.length && !(window.NT_CONFIG && window.NT_CONFIG.selected_hostid)) {
        window.NT_CONFIG = window.NT_CONFIG || {};
        window.NT_CONFIG.selected_groupids = _g;
        window.NT_CONFIG.selected_group_names = [];
        window.NT_CONFIG.data_url = 'zabbix.php?action=network.topology.data';
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
<?php // Blob-Loader ersetzt durch ein esbuild-Bundle (IIFE): EINE Datei,
      // echte Stacktraces, kein Import-Rewriting-Regex. defer = Modul-
      // defer-Semantik (DOM fertig, cytoscape davor geladen). Nach
      // JS-Aenderungen `npm run build` (deploy.sh baut ausserdem selbst). ?>
<script defer src="modules/network_topology/assets/js/dist/nt-bundle.js?v=<?= $_nt_v ?>"></script>
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
            // Host+hops mode: mirror the group handling for the single-host
            // multiselect. With no host selected, drop hostid AND hops from
            // the submit so group-mode URLs stay clean and bookmarkable.
            form.querySelectorAll("input[name='hostid']").forEach(function(el){ el.remove(); });
            var hostItems = jQuery('#hostid').multiSelect('getData');
            if (hostItems.length) {
                var hinp = document.createElement("input");
                hinp.type = "hidden";
                hinp.name = "hostid";
                hinp.value = hostItems[0].id;
                form.appendChild(hinp);
            } else {
                var hopsSel = document.getElementById("hops");
                if (hopsSel) hopsSel.disabled = true;   // disabled = not submitted
            }
        });
    }
    // Nur aufrufen wenn Bootstrap es noch nicht getan hat
    if (!window._ntInitStarted) { window._ntInit && window._ntInit(); }
});</script>


