<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use Modules\NetworkTopologyV6\Topology\HostMetadata;
use Modules\NetworkTopologyV6\Topology\MetricExtractor;
use Modules\NetworkTopologyV6\Topology\LldpEdgeBuilder;
use Modules\NetworkTopologyV6\Topology\HostTagParser;
use Modules\NetworkTopologyV6\Topology\NodeBuilder;
use Modules\NetworkTopologyV6\Topology\ProblemLoader;
use CControllerResponseFatal;
use API;

class NetworkTopologyData extends NetworkTopologyController {

    // Schutz vor CSRF-Last-Abuse (Lese-Endpoint, kein CSRF-Token):
    // Cap auf max 100 Gruppen pro Request. Realistisch hat ein User
    // selten >10 Gruppen ausgewaehlt — 100 ist 10x Sicherheits-Puffer
    // gegen einen Browser-Cross-Origin-Trigger mit riesigem Group-Array.
    private const MAX_GROUPS = 100;

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        if (!$this->requireAjax()) return false;
        $ret = $this->validateInput(['groupids' => 'array_id']);
        if (!$ret) $this->setResponse(new CControllerResponseFatal());
        return $ret;
    }

    protected function checkPermissions(): bool {
        return $this->getUserType() >= USER_TYPE_ZABBIX_USER;
    }

    protected function doAction(): void {
        // Grosszuegiges Rate-Limit: data ist der teuerste Endpoint (Host + Trigger
        // + Problem + Item + gebatchte Lastvalues). Der Auto-Refresh macht ~1
        // Call/30s, manuelles Gruppen-Umschalten ein paar mehr — 30/10s trifft
        // legitime Nutzung nie, kappt aber ein Runaway-Skript / viele Tabs.
        if (!$this->throttle('data', 30, 10)) return;
        $_t0 = microtime(true);
        $groupids = $this->getInput('groupids', []);

        if (!$groupids) {
            $this->jsonResponse(['nodes' => [], 'edges' => []]);
            return;
        }
        // Nicht still abschneiden: die Zahlen gehen mit in die Antwort, damit das
        // Frontend warnen kann, statt ein unvollstaendiges Bild als vollstaendig
        // darzustellen.
        $requested_groups = count($groupids);
        if ($requested_groups > self::MAX_GROUPS) {
            $groupids = array_slice($groupids, 0, self::MAX_GROUPS);
        }

        // ── 1. HOSTS ──────────────────────────────────────────────────────
        // proxyid + proxy_groupid sind seit Zabbix 7.0 verfügbar (in 6.x hieß
        // proxyid noch "proxy_hostid"). Bei Verwendung in älteren Versionen
        // einfach aus dem output-Array entfernen.
        // active_available: Zabbix 7.0+ exposes ACTIVE-agent availability als
        // Top-Level-Feld am Host (separat von interface.available das nur den
        // PASSIVEN Heartbeat-Agent trackt). Aelteren Versionen ignorieren das
        // Feld silently — keine Auswirkung. Werte: 0=unknown, 1=available,
        // 2=unavailable.
        $hosts = API::Host()->get([
            'output'                => ['hostid', 'host', 'name', 'status', 'maintenance_status', 'maintenanceid', 'proxyid', 'proxy_groupid', 'active_available'],
            'groupids'              => $groupids,
            // available + errors_from + disable_until pro Interface — fuer
            // Offline-Detection. Zabbix-API: available 0=unknown, 1=available,
            // 2=unavailable. errors_from = Unix-Timestamp seit wann es
            // Probleme gibt (= last_seen-Aequivalent fuer "down since").
            'selectInterfaces'      => ['ip', 'type', 'main', 'available', 'errors_from', 'error'],
            'selectParentTemplates' => ['name'],
            'selectInventory'       => ['location_lat', 'location_lon', 'location'],
            'selectTags'            => ['tag', 'value'],
            // Seit Zabbix 7.0 verfuegbar — spart einen zweiten HostGroup.get
            // Roundtrip plus N×M-Loop fuers Hostid→Groups-Mapping.
            'selectHostGroups'      => ['name'],
            'monitored_hosts'       => true,
            'preservekeys'          => true
        ]);

        if (!$hosts) {
            $this->jsonResponse(['nodes' => [], 'edges' => []]);
            return;
        }
        $hostids = array_keys($hosts);

        // hostid → ['Group A', 'Group B', ...] aus dem schon geholten Host.get
        $host_group_names = [];
        foreach ($hosts as $hid => $h) {
            $host_group_names[$hid] = array_column($h['hostgroups'] ?? [], 'name');
        }

        // ── 2. SEVERITY + ACKNOWLEDGED ────────────────────────────────────
        // Trigger + Probleme holen und verdichten — ausgelagert nach
        // topology/ProblemLoader.php (§6). Der API-Kontakt steckt dort in EINER
        // duennen Methode, die eigentliche Aggregation (worst-case-Severity,
        // Ack-Zaehler, gekappte Problemliste) in zwei REINEN, getesteten.
        $prob              = ProblemLoader::load($hostids);
        $host_severity     = $prob['severity'];
        $host_problems     = $prob['problems'];
        $host_ack_total    = $prob['ack_total'];
        $host_ack_acked    = $prob['ack_acked'];
        $host_problem_list = $prob['problem_list'];

        // ── 2b. TAG-SCAN: nt:icon, nt:show, nt:link, nt:parent ────────────
        // Tag-Auswertung ausgelagert nach topology/HostTagParser.php (Review §6).
        // Hosts rein, vier Maps raus — rein, kein API-Call, einzeln testbar.
        $tags               = HostTagParser::parse($hosts);
        $host_icon_override = $tags['icon_override'];
        $host_show_keys     = $tags['show_keys'];
        $host_links         = $tags['links'];
        $host_parent        = $tags['parent'];
        // ── 2c. Integration-Links aus Zabbix Global-Macros ────────────────
        // Pattern: {$NT.INT.<NAME>.LABEL} / {$NT.INT.<NAME>.URL}. Beide
        // muessen gesetzt sein. URL-Templates duerfen Tokens enthalten:
        //   {host}, {label}, {ip}, {location}
        // Pro Host wird der Template-String mit URL-encoded Werten gefuellt
        // und an host_links angehaengt. Cap analog nt:link bei 6 Links/Host.
        $integration_templates = HostMetadata::loadIntegrationTemplates();
        // primaryIp() sortiert die interfaces in-place (usort) — beim wiederholten
        // Aufruf pro Template UND spaeter in der Host-Assembly nicht noetig.
        // Einmal pro Host cachen.
        $primary_ip_cache = [];
        if (!empty($integration_templates)) {
            foreach ($hosts as $hid => $h) {
                if (!isset($host_links[$hid])) $host_links[$hid] = [];
                if (!isset($primary_ip_cache[$hid])) {
                    $primary_ip_cache[$hid] = HostMetadata::primaryIp($h['interfaces'] ?? []);
                }
                foreach ($integration_templates as $tpl) {
                    if (count($host_links[$hid]) >= 6) break;
                    $ip = $primary_ip_cache[$hid];
                    $loc = '';
                    $inv = $h['inventory'] ?? null;
                    if (is_array($inv) && isset($inv['location'])) $loc = (string) $inv['location'];
                    $url = strtr($tpl['url'], [
                        '{host}'     => rawurlencode($h['host']  ?? ''),
                        '{label}'    => rawurlencode($h['name']  ?? ''),
                        '{ip}'       => rawurlencode($ip),
                        '{location}' => rawurlencode($loc),
                    ]);
                    // Validierung wie bei nt:link
                    if (!preg_match('#^https?://#i', $url)) continue;
                    if (strlen($url) > 2048) continue;
                    if (preg_match('/[\x00-\x1F\x7F]/', $url)) continue;
                    $host_links[$hid][] = ['label' => $tpl['label'], 'url' => $url];
                }
            }
        }

        // Items für nt:show-Tags holen. Nur wenn überhaupt jemand Tags gesetzt hat.
        // Wir nutzen exakte Key-Match (nicht 'search' substring) und filtern
        // pro Host, damit ein 'system.cpu.util'-Tag nicht versehentlich beim
        // falschen Host landet.
        $items_show = [];
        $show_item_per_host = [];   // hid => [key => itemid]
        if (!empty($host_show_keys)) {
            $all_show_keys = [];
            foreach ($host_show_keys as $keys) {
                foreach ($keys as $k) $all_show_keys[$k] = true;
            }
            $hosts_with_show = array_keys($host_show_keys);
            $items_show = API::Item()->get([
                'output'       => ['itemid', 'hostid', 'key_', 'name', 'value_type', 'units'],
                'hostids'      => $hosts_with_show,
                'filter'       => ['key_' => array_keys($all_show_keys)],
                'monitored'    => true,
                'preservekeys' => true
            ]);
            // Pro Host die gefundenen Items nach Key indexieren
            foreach ($items_show as $iid => $it) {
                $hid = $it['hostid'];
                if (!isset($show_item_per_host[$hid])) $show_item_per_host[$hid] = [];
                $show_item_per_host[$hid][$it['key_']] = $iid;
            }
        }

        // ── 3. ITEMS — alle relevanten Keys in einem API-Call ─────────────
        // Frueher zwei getrennte Calls (Traffic+LLDP separat von CPU+Mem+Ping).
        // searchByAny=true machte beide identisch von der API-Logik — nur ein
        // Roundtrip noetig. Spart 50% API-Latenz auf dieser Stelle.
        $items_a = API::Item()->get([
            'output'       => ['itemid', 'hostid', 'key_', 'name', 'value_type'],
            'hostids'      => $hostids,
            'search'       => ['key_' => [
                // Traffic — Agent + SNMP
                'net.if', 'ifInOctets', 'ifOutOctets', 'ifHCInOctets', 'ifHCOutOctets',
                // Interface-Health: oper-/admin-status + errors + discards
                // (SNMP IF-MIB, moderne net.if.*-Template-Keys enthalten die
                // MIB-Namen im Bracket und matchen ueber dieselben Substrings,
                // Agent-Varianten net.if.*[*,errors|dropped] via Regex unten)
                'ifOperStatus', 'ifAdminStatus', 'ifInErrors', 'ifOutErrors',
                'ifInDiscards', 'ifOutDiscards',
                // Link-Kapazitaet fuer den Weathermap-Modus (ifSpeed = bps
                // 32bit, ifHighSpeed = Mbps 64bit; matcht auch die modernen
                // net.if.speed[ifHighSpeed.X]-Template-Keys via Substring)
                'ifHighSpeed', 'ifSpeed',
                // LLDP (IEEE 802.1AB standard MIB)
                'lldpRemSysName',
                // CDP (Cisco Discovery Protocol, Cisco-spezifisch)
                'cdpCacheDeviceId',
                // Generische Neighbor-Discovery: Ubiquiti UniFi, MikroTik, custom
                'neighbor.sysName', 'discovery.neighbor',
                // CPU — Agent + SNMP variants
                'system.cpu.util', 'hrProcessorLoad', 'ssCpuUser', 'ssCpuSystem',
                'synoSystem.ssCpuIdle',
                // Memory — Agent + SNMP HOST-RESOURCES-MIB
                'vm.memory.size', 'hrStorageUsed', 'hrStorageSize', 'hrStorageType',
                // Ping
                'icmppingsec',
            ]],
            'searchByAny'  => true,
            'monitored'    => true,
            'preservekeys' => true
        ]);

        // ── 3b. LASTVALUE via batched UNION-ALL Queries (Chunk=20 Items/Query)
        // Statt N separaten DB-Roundtrips machen wir eine Query pro 20 Items
        // mit UNION ALL von Subqueries. Jedes Subquery nutzt den Index (itemid, clock)
        // über ORDER BY clock DESC LIMIT 1 effizient.
        // Für 482 Items reduziert das 482 Queries auf ~25.
        $all_items = $items_a + $items_show;
        $last_values = [];
        $last_clocks = [];   // itemid => max(clock) — fuer Stale-Detection
        $CHUNK = 20;

        foreach ([
            ITEM_VALUE_TYPE_FLOAT  => 'history',
            ITEM_VALUE_TYPE_UINT64 => 'history_uint',
            ITEM_VALUE_TYPE_STR    => 'history_str',
            ITEM_VALUE_TYPE_TEXT   => 'history_text',
        ] as $vtype => $table) {
            $type_itemids = array_keys(array_filter($all_items, function($i) use ($vtype) {
                return (int)$i['value_type'] === $vtype;
            }));
            if (empty($type_itemids)) continue;

            foreach (array_chunk($type_itemids, $CHUNK) as $chunk) {
                $parts = [];
                foreach ($chunk as $iid) {
                    $iid = (int) $iid;
                    // value + clock fuer Stale-Detection beide aus dem
                    // selben SELECT — kein zusaetzlicher Roundtrip.
                    $parts[] = '(SELECT ' . $iid . ' AS itemid, value, clock FROM ' . $table
                             . ' WHERE itemid=' . $iid
                             . ' ORDER BY clock DESC LIMIT 1)';
                }
                $sql = implode(' UNION ALL ', $parts);
                $res = DBselect($sql);
                while ($row = DBfetch($res)) {
                    $iid = (int) $row['itemid'];
                    $last_values[$iid] = $row['value'];
                    $last_clocks[$iid] = (int) $row['clock'];
                }
            }
        }

        // Stale-Detection: pro Host das max(lastclock) aller seiner Items.
        // Wenn das alle Items des Hosts mehrere Minuten alt sind, kommen
        // keine neuen Daten mehr an — Host ist effektiv stale (auch wenn
        // unavailable=false). Nur Items aus all_items (Live-Metriken),
        // nicht aus Discovery oder anderen Quellen.
        $host_last_seen = [];
        foreach ($all_items as $iid => $item) {
            if (!isset($last_clocks[$iid])) continue;
            $hid = (int) $item['hostid'];
            $clk = $last_clocks[$iid];
            if (!isset($host_last_seen[$hid]) || $clk > $host_last_seen[$hid]) {
                $host_last_seen[$hid] = $clk;
            }
        }

        // Inject lastvalue back into items
        foreach ($items_a as $iid => &$item) {
            $item['lastvalue'] = $last_values[$iid] ?? null;
        }
        unset($item);
        foreach ($items_show as $iid => &$item) {
            $item['lastvalue'] = $last_values[$iid] ?? null;
        }
        unset($item);

        // ── 4. PROCESS ITEMS ──────────────────────────────────────────────
        // Metrik-Klassifikation ausgelagert nach topology/MetricExtractor.php
        // (Review §6). Items rein, sieben Metrik-Arrays raus — reine
        // Transformation, kein API-Call, kein Controller-Zustand. Dadurch
        // erstmals einzeln testbar, statt nur ueber einen kompletten Request.
        $metrics      = MetricExtractor::extract($items_a);
        $lldp_raw     = $metrics['lldp_raw'];
        // ── 5. LLDP EDGES ─────────────────────────────────────────────────
        // Nachbar-Matching + Kantenbau ausgelagert nach
        // topology/LldpEdgeBuilder.php (Review §6). Hosts + Roh-Nachbarn rein,
        // Kanten + Qualitaetsstatistik raus — rein, kein API-Call, testbar.
        // §3 Port-zu-Port: Remote-Port + Per-Interface-Traffic mitgeben, damit die
        // Kanten Port-Labels (beide Enden) und Per-Link-Auslastung tragen.
        $lldp           = LldpEdgeBuilder::build($hosts, $lldp_raw,
                              $metrics['lldp_ports'], $metrics['port_traffic'], $metrics['port_speed']);
        $edges          = $lldp['edges'];
        $lldp_quality   = $lldp['quality'];
        $lldp_unmatched = $lldp['unmatched'];
        // ── 5a. HOSTING/CONTAINMENT-KANTEN (nt:parent-Tag) ────────────────
        // Ein Host deklariert via Tag  nt:parent = <Hostname>  seinen Traeger
        // (VM → Hypervisor, Container → Node, ...). Ergibt eine GERICHTETE
        // hosts-Kante Parent→Child. Anders als LLDP ist das eine harte
        // Abhaengigkeit: faellt der Parent, ist der Child weg — What-if/
        // Root-Cause werten _type=hosts entsprechend aus. Aufloesung nach
        // technischem Namen (host) ODER Anzeigename (name), case-insensitiv;
        // technischer Name gewinnt. Referenzen auf nicht sichtbare/unbekannte
        // Hosts werden still verworfen (Kante zu Nicht-Knoten faellt eh weg).
        if ($host_parent) {
            $name_to_id = [];
            foreach ($hosts as $h2id => $h2) {
                $vis = strtolower(trim((string) ($h2['name'] ?? '')));
                if ($vis !== '' && !isset($name_to_id[$vis])) $name_to_id[$vis] = $h2id;
            }
            foreach ($hosts as $h2id => $h2) {
                $tech = strtolower(trim((string) ($h2['host'] ?? '')));
                if ($tech !== '') $name_to_id[$tech] = $h2id;   // technischer Name gewinnt
            }
            $hn = 0;
            foreach ($host_parent as $child_id => $ref) {
                $pid = $name_to_id[strtolower($ref)] ?? null;
                if ($pid === null || (string) $pid === (string) $child_id) continue;
                $edges[] = ['id' => 'h' . $hn++, 'from' => $pid, 'to' => $child_id,
                            '_type' => 'hosts'];
            }
        }

        // ── 5b. PROXY + PROXY-GROUP LOOKUP ────────────────────────────────
        // Hosts können via Proxy oder Proxy-Group (Zabbix 7+) monitored werden.
        // Wir sammeln die unique Proxy-IDs und Proxy-Group-IDs aus den Hosts
        // und holen dann je einen Lookup-Call (proxy.get / proxygroup.get).
        // Hosts ohne Proxy haben proxyid=0, ohne Group proxy_groupid=0.
        $unique_proxyids = [];
        $unique_pgids    = [];
        foreach ($hosts as $h) {
            $pid  = (string) ($h['proxyid']        ?? '0');
            $pgid = (string) ($h['proxy_groupid']  ?? '0');
            if ($pid !== '0' && $pid !== '')  $unique_proxyids[$pid]  = true;
            if ($pgid !== '0' && $pgid !== '') $unique_pgids[$pgid]   = true;
        }
        $proxy_names = [];        // proxyid → name
        $pgroup_names = [];       // proxy_groupid → name
        if ($unique_proxyids) {
            // proxy.get gibt es seit Zabbix 7.0; in 6.x hieß es noch nicht so.
            // Bei Versions-Inkompatibilität fängt der try-catch den Fehler ab,
            // damit das Modul nicht komplett abbricht.
            try {
                $proxies = API::Proxy()->get([
                    'output'   => ['proxyid', 'name'],
                    'proxyids' => array_keys($unique_proxyids),
                    'preservekeys' => true,
                ]);
                foreach ($proxies as $pid => $p) {
                    $proxy_names[$pid] = $p['name'] ?? '';
                }
            } catch (\Throwable $e) {
                // Silent fail — Proxy-Info bleibt leer
            }
        }
        if ($unique_pgids) {
            try {
                $pgroups = API::ProxyGroup()->get([
                    'output'        => ['proxy_groupid', 'name'],
                    'proxy_groupids' => array_keys($unique_pgids),
                    'preservekeys'  => true,
                ]);
                foreach ($pgroups as $pgid => $pg) {
                    $pgroup_names[$pgid] = $pg['name'] ?? '';
                }
            } catch (\Throwable $e) {
                // Silent fail — ProxyGroup-Info bleibt leer
            }
        }

        // ── 6. BUILD NODES ────────────────────────────────────────────────
        // Knoten-Zusammenbau ausgelagert nach topology/NodeBuilder.php (§6).
        // Die Buendel von MetricExtractor und HostTagParser gehen UNENTPACKT
        // durch — genau deshalb sind es fuenf Parameter und nicht 23.
        $built = NodeBuilder::build(
            $hosts,
            $metrics,
            $tags,
            [
                'severity'     => $host_severity,
                'problems'     => $host_problems,
                'problem_list' => $host_problem_list,
                'ack_total'    => $host_ack_total,
                'ack_acked'    => $host_ack_acked,
                'last_seen'    => $host_last_seen,
            ],
            [
                'group_names'        => $host_group_names,
                'proxy_names'        => $proxy_names,
                'pgroup_names'       => $pgroup_names,
                'lldp_quality'       => $lldp_quality,
                'items_show'         => $items_show,
                'show_item_per_host' => $show_item_per_host,
                'primary_ip_cache'   => $primary_ip_cache,
            ]
        );
        $nodes            = $built['nodes'];
        $lldp_quality_out = $built['lldp_quality'];
        // ── Health-Score (Server-Spiegel der Formel aus render-health.js) ──
        // 100 − offline%·40 − stale%·15 − critical%·25 − unacked%·20 pro
        // Gruppe; avg/min ueber alle Gruppen. Der Sender-Cron pusht beides
        // an Trapper-Items (nt.health.score / .min) → echte Zabbix-Historie
        // + Trigger. Formel-Aenderungen HIER und in render-health.js
        // synchron halten.
        $g_stats = [];
        $now_ts  = time();
        foreach ($nodes as $n) {
            foreach ($n['groups'] as $gname) {
                if ($gname === '') continue;
                if (!isset($g_stats[$gname])) {
                    $g_stats[$gname] = ['total'=>0, 'offline'=>0, 'stale'=>0, 'critical'=>0, 'unacked'=>0];
                }
                $gs =& $g_stats[$gname];
                $gs['total']++;
                if ($n['unavailable']) {
                    $gs['offline']++;
                }
                elseif ($n['last_seen'] > 0 && ($now_ts - $n['last_seen']) > 300) {
                    $gs['stale']++;
                }
                if ($n['severity'] >= 4) $gs['critical']++;
                if ($n['problems'] > 0 && !$n['acknowledged']) $gs['unacked']++;
                unset($gs);
            }
        }
        $health = ['avg' => null, 'min' => null];
        if ($g_stats) {
            $sum = 0;
            $min = 100;
            foreach ($g_stats as $gs) {
                $tot = max(1, $gs['total']);
                $score = 100
                    - ($gs['offline']  / $tot) * 40
                    - ($gs['stale']    / $tot) * 15
                    - ($gs['critical'] / $tot) * 25
                    - ($gs['unacked']  / $tot) * 20;
                $score = (int) round(max(0, min(100, $score)));
                $sum += $score;
                if ($score < $min) $min = $score;
            }
            $health['avg'] = (int) round($sum / count($g_stats));
            $health['min'] = $min;
        }

        // ── Topology-Change-Detection ─────────────────────────────────────
        // Aktuellen Edge-Stand gegen die APCu-Baseline diffen und die
        // Baseline weiterrollen. Kein Baseline-Eintrag (Erstaufruf oder
        // php-fpm-Restart) → seed + leerer Diff, kein False-Alarm.
        // Key ist user+groups-scoped: verschiedene User sehen permission-
        // bedingt verschiedene Subgraphen und wuerden sich sonst gegenseitig
        // die Baseline verrollen. Der Sender-Cron (eigener Monitoring-User)
        // rollt damit unabhaengig von UI-Usern.
        $topo_changes = ['added' => [], 'removed' => []];
        $host_label = static function($hid) use ($hosts) {
            $h = $hosts[$hid] ?? null;
            if (!$h) return (string) $hid;
            return ($h['name'] ?? '') !== '' ? $h['name'] : ($h['host'] ?? (string) $hid);
        };
        // Baseline der letzten Abfrage (user- + gruppengebunden, 7 Tage). Das ist
        // KEIN Response-Cache, sondern ein "letzter Stand"-Speicher: der Diff
        // dagegen ergibt topo_changes. User-Scoping, Sortierung der groupids und
        // Schema-Version macht NtCache; ohne APCu ist es ein No-Op und
        // topo_changes bleibt schlicht leer.
        $current = [];   // "idA|idB" → [labelA, labelB]
        foreach ($edges as $e) {
            if (!empty($e['_isInternetEdge'])) continue;
            $pair = [(string) $e['from'], (string) $e['to']];
            sort($pair);
            $current[$pair[0] . '|' . $pair[1]] = [$host_label($pair[0]), $host_label($pair[1])];
        }
        $baseline = NtCache::get('topo_baseline', [$groupids]);
        if (is_array($baseline)) {
            foreach ($current as $k => $lbls) {
                if (!isset($baseline[$k])) $topo_changes['added'][] = ['a' => $lbls[0], 'b' => $lbls[1]];
            }
            foreach ($baseline as $k => $lbls) {
                if (!isset($current[$k])) $topo_changes['removed'][] = ['a' => $lbls[0], 'b' => $lbls[1]];
            }
        }
        NtCache::set('topo_baseline', [$groupids], $current, 7 * 86400);

        $_payload = $this->encodeJson(
            ['nodes' => $nodes, 'edges' => $edges,
             'lldp_unmatched' => $lldp_unmatched,
             'lldp_quality'   => $lldp_quality_out,
             'topo_changes'   => $topo_changes,
             'health'         => $health,
             // Truncation sichtbar machen (statt still abzuschneiden).
             'truncated'       => $requested_groups > self::MAX_GROUPS,
             'requested_count' => $requested_groups,
             'processed_count' => count($groupids),
             // Review §12: versionierter, dokumentierter API-Contract. Additiv,
             // bestehende Top-Level-Felder bleiben unveraendert.
             'api_version'     => self::API_VERSION,
             'generated_at'    => time(),
             'capabilities'    => $this->capabilities()]
        );
        NetworkTopologyDiag::record([
            'action'     => 'data',
            'elapsed_ms' => round((microtime(true) - $_t0) * 1000, 1),
            'bytes'      => strlen($_payload),
            'cache_hit'  => false,
            'counts'     => ['hosts' => count($nodes), 'edges' => count($edges)],
        ]);
        $this->jsonResponseRaw($_payload);
    }

}
