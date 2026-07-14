<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use Modules\NetworkTopologyV6\Topology\HostMetadata;
use Modules\NetworkTopologyV6\Topology\MetricExtractor;
use Modules\NetworkTopologyV6\Topology\LldpEdgeBuilder;
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
        // Trigger-API liefert die Severity (= worst-case pro Host).
        $triggers = API::Trigger()->get([
            'output'       => ['triggerid', 'priority'],
            'hostids'      => $hostids,
            'monitored'    => true,
            'only_true'    => true,
            'filter'       => ['value' => TRIGGER_VALUE_TRUE],
            'selectHosts'  => ['hostid'],
            'preservekeys' => false
        ]);

        $host_severity = [];
        $host_problems = [];   // Anzahl aktiver Trigger pro Host
        foreach ($triggers as $t) {
            $sev = (int) $t['priority'];
            foreach ($t['hosts'] as $th) {
                $hid = $th['hostid'];
                if (!isset($host_severity[$hid]) || $sev > $host_severity[$hid]) {
                    $host_severity[$hid] = $sev;
                }
                $host_problems[$hid] = ($host_problems[$hid] ?? 0) + 1;
            }
        }

        // Acknowledged-Status pro Host: ein Host gilt als "acked", wenn er
        // mindestens ein Problem hat UND alle Probleme acknowledged sind.
        // Problem-API liefert acknowledge-Flag direkt (anders als Trigger-API).
        $host_ack_total  = [];   // hid => Anzahl Probleme
        $host_ack_acked  = [];   // hid => Anzahl davon acknowledged
        $host_problem_list = []; // hid => [{name, severity, clock, acknowledged}, ...] (max 20/Host)
        if ($host_problems) {
            // recent=true: nur aktuell offene Probleme (oder kürzlich geschlossene).
            // Frueher 'false', was historische Problems zurueckgeliefert hat — bei
            // vielen Hosts tausende Events von denen wir nur 20/Host nutzen.
            // sortfield+limit als zweite Sicherung gegen runaway-Listen.
            $problems = API::Problem()->get([
                'output'       => ['eventid', 'objectid', 'name', 'severity', 'clock', 'acknowledged'],
                'hostids'      => array_keys($host_problems),
                'recent'       => true,
                'sortfield'    => ['eventid'],
                'sortorder'    => 'DESC',
                'limit'        => max(500, count($host_problems) * 25),
                'preservekeys' => false
            ]);
            // Probleme haben keinen direkten hostid — der Weg geht über
            // event.get oder über die schon geholten Trigger. Wir mappen
            // triggerid → hosts aus dem Trigger-Result.
            $trigger_hosts = [];
            foreach ($triggers as $t) {
                $trigger_hosts[$t['triggerid'] ?? ''] = array_column($t['hosts'], 'hostid');
            }
            foreach ($problems as $p) {
                $tid = $p['objectid'] ?? '';
                $hids = $trigger_hosts[$tid] ?? [];
                // Type-loose-Vergleich: Zabbix-API liefert acknowledged je
                // nach Version mal als String '1', mal als Integer 1.
                $is_acked = (int) ($p['acknowledged'] ?? 0) === 1;
                $entry = [
                    'name'         => (string) ($p['name'] ?? ''),
                    'severity'     => (int)    ($p['severity'] ?? 0),
                    'clock'        => (int)    ($p['clock'] ?? 0),
                    'acknowledged' => $is_acked,
                ];
                foreach ($hids as $hid) {
                    $host_ack_total[$hid] = ($host_ack_total[$hid] ?? 0) + 1;
                    if ($is_acked) {
                        $host_ack_acked[$hid] = ($host_ack_acked[$hid] ?? 0) + 1;
                    }
                    // Cap pro Host: 20 Probleme reichen für die UI; mehr würden
                    // den Accordion unbrauchbar machen und den Payload aufblähen.
                    if (!isset($host_problem_list[$hid])) $host_problem_list[$hid] = [];
                    if (count($host_problem_list[$hid]) < 20) {
                        $host_problem_list[$hid][] = $entry;
                    }
                }
            }
            // Pro Host: nach Severity desc, dann nach Clock desc (neueste oben).
            foreach ($host_problem_list as $hid => &$list) {
                usort($list, function($a, $b) {
                    if ($a['severity'] !== $b['severity']) return $b['severity'] - $a['severity'];
                    return $b['clock'] - $a['clock'];
                });
            }
            unset($list);
        }

        // ── 2b. TAG-SCAN: nt:icon, nt:show ────────────────────────────────
        // Per Host: 'nt:icon'-Tag (max 1) und 'nt:show'-Tags (n) sammeln.
        // - nt:icon=router  → überschreibt die Auto-Erkennung in deviceType()
        // - nt:show=<key>   → das Item wird in den Tooltip aufgenommen
        // - nt:link=Label|URL  → Custom-Link im Kontextmenü (mehrfach möglich)
        $host_icon_override = [];   // hid => 'router'|'firewall'|...
        $host_show_keys     = [];   // hid => ['system.cpu.util', 'vfs.fs.size[/,pused]', ...]
        $host_links         = [];   // hid => [{label, url}, ...]
        $host_parent        = [];   // hid => 'ParentHostname' (nt:parent-Tag → hosts-Kante)
        // Whitelist für nt:icon: nur bekannte Typen, sonst wird ignoriert
        $allowed_icons = ['firewall', 'router', 'switch', 'wireless',
                          'server', 'storage', 'camera', 'printer',
                          'hypervisor', 'linux', 'windows', 'macos',
                          'webserver', 'container', 'mailserver',
                          'monitoring', 'homeauto', 'ups', 'internet'];

        foreach ($hosts as $hid => $h) {
            foreach ($h['tags'] ?? [] as $tag) {
                $name  = $tag['tag']   ?? '';
                $value = $tag['value'] ?? '';
                if ($name === 'nt:icon' && $value !== '') {
                    $value = strtolower(trim($value));
                    if (in_array($value, $allowed_icons, true)) {
                        $host_icon_override[$hid] = $value;
                    }
                } elseif ($name === 'nt:show' && $value !== '') {
                    // Item-Key-Cap: realistisch nie >200 Zeichen. Schutz gegen
                    // teure API-Filter-Listen wenn jemand pathologisch lange
                    // Tag-Werte setzt (Host-Tag-Edit-Rechte vorausgesetzt).
                    $v = trim($value);
                    if (strlen($v) > 200) continue;
                    if (!isset($host_show_keys[$hid])) $host_show_keys[$hid] = [];
                    // Begrenzung pro Host: 4 (Tooltip-Platz). Weitere Tags ignorieren.
                    if (count($host_show_keys[$hid]) < 4) {
                        $host_show_keys[$hid][] = $v;
                    }
                } elseif ($name === 'nt:link' && $value !== '') {
                    // Format: "Label|URL" — Pipe-getrennt. Wenn kein Pipe vorhanden,
                    // ist der ganze Wert die URL und das Label wird die Domain.
                    // Begrenzung pro Host: 6 (sonst wird das Untermenü unhandlich).
                    if (!isset($host_links[$hid])) $host_links[$hid] = [];
                    if (count($host_links[$hid]) >= 6) continue;

                    // Hard cap am ganzen Tag-Value: 2500 Zeichen reicht für jede
                    // realistische URL+Label, schützt aber vor pathologisch großen
                    // Tags die das JSON-Response aufblähen.
                    if (strlen($value) > 2500) continue;

                    $pipe_pos = strpos($value, '|');
                    if ($pipe_pos !== false) {
                        $label = trim(substr($value, 0, $pipe_pos));
                        $url   = trim(substr($value, $pipe_pos + 1));
                    } else {
                        $url   = trim($value);
                        // Domain als Label extrahieren ("https://nas.fox1.de:5000" → "nas.fox1.de")
                        $parsed = parse_url($url);
                        $label  = $parsed['host'] ?? $url;
                    }

                    // Sicherheits-Validierung der URL: nur http/https, keine
                    // javascript:/data:/file: Schemes (würden XSS via Tooltip
                    // ermöglichen wenn ein User die Tags eines anderen sehen
                    // kann). Anchor-Tags werden im Frontend zusätzlich escaped.
                    if ($label === '' || $url === '') continue;
                    if (!preg_match('#^https?://#i', $url)) continue;

                    // Length-Caps + Control-Char-Filter:
                    //   - URL > 2048 Zeichen: realistisch nie sinnvoll, bricht
                    //     den meisten Browsern eh
                    //   - Label > 200 Zeichen: würde das Kontextmenü zerstören
                    //   - Control-Chars (CR/LF/Tab/0x00-0x1F) raus damit kein
                    //     Header-Injection o.ä. möglich ist falls die URL irgendwo
                    //     unsauber landet (z.B. in Logs, in einer redirect-Kette)
                    if (strlen($url) > 2048 || strlen($label) > 200) continue;
                    if (preg_match('/[\x00-\x1F\x7F]/', $url)) continue;
                    if (preg_match('/[\x00-\x1F\x7F]/', $label)) continue;

                    $host_links[$hid][] = ['label' => $label, 'url' => $url];
                } elseif ($name === 'nt:parent' && $value !== '') {
                    // Containment/Hosting: dieser Host laeuft auf $value
                    // (Traeger-Host, z.B. Hypervisor). Erste Angabe gewinnt —
                    // ein Host hat genau einen Traeger. Namensaufloesung unten,
                    // sobald alle sichtbaren Hosts bekannt sind.
                    if (!isset($host_parent[$hid])) {
                        $pv = trim($value);
                        if ($pv !== '' && strlen($pv) <= 128) $host_parent[$hid] = $pv;
                    }
                }
            }
        }

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
        $items_b = [];   // Kompatibilitaet mit der nachgelagerten Merge-Logik

        // ── 3b. LASTVALUE via batched UNION-ALL Queries (Chunk=20 Items/Query)
        // Statt N separaten DB-Roundtrips machen wir eine Query pro 20 Items
        // mit UNION ALL von Subqueries. Jedes Subquery nutzt den Index (itemid, clock)
        // über ORDER BY clock DESC LIMIT 1 effizient.
        // Für 482 Items reduziert das 482 Queries auf ~25.
        $all_items = $items_a + $items_b + $items_show;
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
        foreach ($items_b as $iid => &$item) {
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
        $host_traffic = $metrics['traffic'];
        $host_iface   = $metrics['iface'];
        $host_speed   = $metrics['speed'];
        $host_cpu     = $metrics['cpu'];
        $host_memory  = $metrics['memory'];
        $host_ping    = $metrics['ping'];
        $lldp_raw     = $metrics['lldp_raw'];
        // ── 5. LLDP EDGES ─────────────────────────────────────────────────
        // Nachbar-Matching + Kantenbau ausgelagert nach
        // topology/LldpEdgeBuilder.php (Review §6). Hosts + Roh-Nachbarn rein,
        // Kanten + Qualitaetsstatistik raus — rein, kein API-Call, testbar.
        $lldp           = LldpEdgeBuilder::build($hosts, $lldp_raw);
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
        $nodes = [];
        foreach ($hosts as $hid => $h) {
            $tpls    = array_column($h['parentTemplates'] ?? [], 'name');
            $ifaces  = $h['interfaces'] ?? [];
            // Ein Host gilt als "acknowledged", wenn alle Probleme acked sind.
            $total = $host_ack_total[$hid] ?? 0;
            $acked = $host_ack_acked[$hid] ?? 0;
            $all_acked = $total > 0 && $acked === $total;

            // Auto-Detection des Device-Type, ggf. überschrieben durch nt:icon-Tag
            $detected_type = HostMetadata::deviceType($h['host'], $tpls);
            $effective_type = $host_icon_override[$hid] ?? $detected_type;

            // Extra-Items für nt:show-Tags zusammenstellen — in der Reihenfolge
            // wie der User die Tags gesetzt hat.
            $extra_items = [];
            foreach ($host_show_keys[$hid] ?? [] as $key) {
                $iid = $show_item_per_host[$hid][$key] ?? null;
                if (!$iid) {
                    // Tag gesetzt, aber Item nicht gefunden — als Hinweis im Tooltip
                    $extra_items[] = [
                        'name'  => $key,
                        'value' => null,
                        'units' => '',
                        'error' => 'Item nicht gefunden'
                    ];
                    continue;
                }
                $item = $items_show[$iid];
                $extra_items[] = [
                    'name'  => $item['name']  ?: $item['key_'],
                    'value' => $item['lastvalue'],
                    'units' => $item['units'] ?? ''
                ];
            }

            // Offline-Detection mit zwei Signalen:
            //
            // 1) interface.available === 2: passiver Heartbeat-Agent (Port 10050),
            //    SNMP, IPMI, JMX. Plus errors_from = "down since"-Timestamp.
            //
            // 2) host.active_available === 2: ACTIVE-Agent-Verfuegbarkeit
            //    (separater Mechanismus seit Zabbix 7.0). Active-Agent-Hosts
            //    haben oft interface.available=0 (unknown, weil passiver Port
            //    nicht abgefragt wird), aber Zabbix trackt die Erreichbarkeit
            //    ueber das Active-Agent-Heartbeat. Ohne diese 2. Detection
            //    wuerden Active-Agent-Hosts als "online" durchgehen obwohl
            //    Zabbix sie als "not available" markiert hat.
            $host_unavailable = false;
            $down_since = 0;
            $down_error = '';
            foreach ($ifaces as $iface) {
                if ((int) ($iface['available'] ?? 0) === 2) {
                    $host_unavailable = true;
                    $ef = (int) ($iface['errors_from'] ?? 0);
                    if ($ef > 0 && ($down_since === 0 || $ef < $down_since)) {
                        $down_since = $ef;
                    }
                    if (empty($down_error) && !empty($iface['error'])) {
                        $down_error = (string) $iface['error'];
                    }
                }
            }
            // Active-Agent-Verfuegbarkeit (Zabbix 7.0+). Top-Level-Feld am Host.
            if (!$host_unavailable && isset($h['active_available'])
                    && (int) $h['active_available'] === 2) {
                $host_unavailable = true;
                // Active-Agent hat keinen errors_from-Timestamp am Host-Level.
                // down_since bleibt 0 — Detail-Panel zeigt dann "OFFLINE" ohne
                // Zeitangabe, was OK ist.
            }

            $nodes[] = [
                'id'          => $hid,
                'label'       => $h['name'] !== '' ? $h['name'] : $h['host'],
                'host'        => $h['host'],
                'ip'          => $primary_ip_cache[$hid] ?? ($primary_ip_cache[$hid] = HostMetadata::primaryIp($ifaces)),
                'iftype'      => HostMetadata::ifaceType($ifaces),
                'severity'    => $host_severity[$hid] ?? 0,
                'problems'    => $host_problems[$hid]  ?? 0,
                'problem_list' => $host_problem_list[$hid] ?? [],
                'acknowledged'=> $all_acked,
                // Offline-Status (eines der monitored Interfaces ist unavailable)
                'unavailable' => $host_unavailable,
                'down_since'  => $down_since,    // 0 wenn nicht offline, sonst Unix-TS
                'down_error'  => $down_error,    // Last Zabbix-Error-Message vom Interface
                'last_seen'   => $host_last_seen[$hid] ?? 0,   // max(lastclock) fuer Stale-Detection
                // Type-loose: API liefert mal '1', mal 1
                'maintenance' => (int) ($h['maintenance_status'] ?? 0) === 1,
                'type'        => $effective_type,
                'icon_override' => isset($host_icon_override[$hid]),  // Frontend-Hinweis
                'groups'      => $host_group_names[$hid] ?? [],
                // Proxy/ProxyGroup-Lookup (leer wenn Host direkt am Server hängt)
                'proxy_name'       => $proxy_names[(string)($h['proxyid'] ?? '0')] ?? '',
                'proxy_group_name' => $pgroup_names[(string)($h['proxy_groupid'] ?? '0')] ?? '',
                'traffic'     => $host_traffic[$hid]  ?? ['in' => 0.0, 'out' => 0.0],
                // Interface-Health aggregat (Edge-Coloring + Tooltip).
                // Werte sind pro Sekunde (nach Zabbix-Preprocessing 'change per second')
                // oder als absolute Counter — Frontend zeigt nur "> threshold".
                'iface_health' => $host_iface[$hid] ?? ['down'=>0, 'errors'=>0.0, 'discards'=>0.0, 'count'=>0],
                // Max Link-Speed (bps) — Weathermap-Kapazitaet. 0 = unbekannt.
                'link_speed'  => $host_speed[$hid] ?? 0,
                'cpu'         => $host_cpu[$hid]       ?? null,
                'memory'      => $host_memory[$hid]    ?? null,
                'ping'        => $host_ping[$hid]      ?? null,
                // Inventory-Geo: leere Strings -> null. Lat/Lon werden als
                // Floats geliefert, Frontend nutzt nur Hosts mit beiden Werten.
                'lat'         => isset($h['inventory']['location_lat']) && $h['inventory']['location_lat'] !== ''
                                 ? (float) $h['inventory']['location_lat'] : null,
                'lon'         => isset($h['inventory']['location_lon']) && $h['inventory']['location_lon'] !== ''
                                 ? (float) $h['inventory']['location_lon'] : null,
                'location'    => $h['inventory']['location'] ?? '',
                // Extra-Items aus nt:show-Tags (Tooltip + Detail-Panel)
                'extra_items' => $extra_items,
                // Custom-Links aus nt:link-Tags (Kontextmenü)
                'links'       => $host_links[$hid] ?? [],
            ];
        }

        // lldp_quality: hostid → counters → fuer das Frontend als Liste mit
        // Host-Labels die Anzeige praktisch. Hosts ohne Daten weglassen.
        $lldp_quality_out = [];
        foreach ($lldp_quality as $hid => $q) {
            if ($q['matched'] === 0 && empty($q['unmatched']) && empty($q['ambiguous']) && $q['self'] === 0) continue;
            $h = $hosts[$hid] ?? null;
            $lldp_quality_out[] = [
                'id'    => (string) $hid,
                'label' => $h ? (($h['name'] ?? '') !== '' ? $h['name'] : ($h['host'] ?? '')) : (string) $hid,
                'matched'   => $q['matched'],
                'unmatched' => $q['unmatched'],
                'ambiguous' => $q['ambiguous'],
                'self'      => $q['self'],
            ];
        }

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
             'processed_count' => count($groupids)]
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
