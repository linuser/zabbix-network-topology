<?php
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
<link rel="stylesheet" type="text/css"
      href="modules/network_topology_v6/assets/js/leaflet/leaflet.css">
<script src="modules/network_topology_v6/assets/js/cytoscape.min.js"></script>
<script src="modules/network_topology_v6/assets/js/cola.min.js"></script>
<script src="modules/network_topology_v6/assets/js/cytoscape-cola.min.js"></script>
<script src="modules/network_topology_v6/assets/js/leaflet/leaflet.js"></script>


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
    'can_edit'   => (bool) $data['user']['can_edit'],
    // Optionaler Provider-Name für die Internet-Wolke im Hierarchie-Layout.
    // Aus URL-Parameter ?internet=Vodafone gelesen; leer = "Internet" als Default.
    'internet_label' => (string) ($data['internet_label'] ?? ''),
    // Wallboard-Mode: ?wallboard=1 → vollflächig, kein Header, Auto-Tab-Wechsel
    'wallboard'  => (bool) ($data['wallboard'] ?? false),
    // User-ID f\u00FCr Multi-User-Trennung der localStorage-Keys.
    // F\u00E4llt auf 0 zur\u00FCck, falls CWebUser nicht verf\u00FCgbar \u2014 dann teilt
    // sich der Browser wie fr\u00FCher die Daten (non-breaking Fallback).
    'user_id'    => (string) (\CWebUser::$data['userid'] ?? 0)
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
        window.NT_CONFIG.can_edit = true;
    }
}

</script>
<script type="module" src="modules/network_topology_v6/assets/js/network-topology.js?v=<?= $_nt_v ?>"></script>
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


