<?php
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CController;
use CControllerResponseData;
use CControllerResponseFatal;
use API;

class NetworkTopologyData extends CController {

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        $ret = $this->validateInput(['groupids' => 'array_id']);
        if (!$ret) $this->setResponse(new CControllerResponseFatal());
        return $ret;
    }

    protected function checkPermissions(): bool {
        return $this->getUserType() >= USER_TYPE_ZABBIX_USER;
    }

    protected function doAction(): void {
        $groupids = $this->getInput('groupids', []);

        if (!$groupids) {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['nodes' => [], 'edges' => []])
            ]));
            return;
        }

        // ── 1. HOSTS ──────────────────────────────────────────────────────
        // proxyid + proxy_groupid sind seit Zabbix 7.0 verfügbar (in 6.x hieß
        // proxyid noch "proxy_hostid"). Bei Verwendung in älteren Versionen
        // einfach aus dem output-Array entfernen.
        $hosts = API::Host()->get([
            'output'                => ['hostid', 'host', 'name', 'status', 'maintenance_status', 'maintenanceid', 'proxyid', 'proxy_groupid'],
            'groupids'              => $groupids,
            'selectInterfaces'      => ['ip', 'type', 'main'],
            'selectParentTemplates' => ['name'],
            'selectInventory'       => ['location_lat', 'location_lon', 'location'],
            'selectTags'            => ['tag', 'value'],
            'monitored_hosts'       => true,
            'preservekeys'          => true
        ]);

        if (!$hosts) {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['nodes' => [], 'edges' => []])
            ]));
            return;
        }
        $hostids = array_keys($hosts);

        // ── 1b. HOST GROUPS via HostGroup API (Zabbix 7.4 compatible) ──────
        $groups_with_hosts = API::HostGroup()->get([
            'output'       => ['groupid', 'name'],
            'hostids'      => $hostids,
            'selectHosts'  => ['hostid'],
            'preservekeys' => true
        ]);
        // Build hostid -> group names map
        $host_group_names = [];
        foreach ($groups_with_hosts as $grp) {
            foreach ($grp['hosts'] as $gh) {
                $host_group_names[$gh['hostid']][] = $grp['name'];
            }
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
            $problems = API::Problem()->get([
                'output'       => ['eventid', 'objectid', 'name', 'severity', 'clock', 'acknowledged'],
                'hostids'      => array_keys($host_problems),
                'recent'       => false,
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
                    if (!isset($host_show_keys[$hid])) $host_show_keys[$hid] = [];
                    // Begrenzung pro Host: 4 (Tooltip-Platz). Weitere Tags ignorieren.
                    if (count($host_show_keys[$hid]) < 4) {
                        $host_show_keys[$hid][] = trim($value);
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

        // ── 3. ITEMS — two calls covering Agent + SNMP ────────────────────

        // Call A: Traffic (Agent net.if + SNMP ifIn/ifOut/ifHC) + LLDP
        $items_a = API::Item()->get([
            'output'       => ['itemid', 'hostid', 'key_', 'name', 'value_type'],
            'hostids'      => $hostids,
            'search'       => ['key_' => [
                'net.if',           // Zabbix Agent
                'ifInOctets',       // SNMP IF-MIB 32bit
                'ifOutOctets',
                'ifHCInOctets',     // SNMP IF-MIB 64bit (high-speed)
                'ifHCOutOctets',
                'lldpRemSysName',   // LLDP
            ]],
            'searchByAny'  => true,
            'monitored'    => true,
            'preservekeys' => true
        ]);

        // Call B: CPU + Memory + Ping (Agent + SNMP variants)
        $items_b = API::Item()->get([
            'output'       => ['itemid', 'hostid', 'key_', 'name', 'value_type'],
            'hostids'      => $hostids,
            'search'       => ['key_' => [
                // CPU — Agent
                'system.cpu.util',
                // CPU — SNMP (net-snmp / HOST-RESOURCES-MIB)
                'hrProcessorLoad',
                'ssCpuUser',
                'ssCpuSystem',
                // CPU — Synology
                'synoSystem.ssCpuIdle',
                // Memory — Agent
                'vm.memory.size',
                // Memory — SNMP HOST-RESOURCES-MIB
                'hrStorageUsed',
                'hrStorageSize',
                'hrStorageType',
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
        $all_items = $items_a + $items_b + $items_show;
        $last_values = [];
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
                    $parts[] = '(SELECT ' . $iid . ' AS itemid, value FROM ' . $table
                             . ' WHERE itemid=' . $iid
                             . ' ORDER BY clock DESC LIMIT 1)';
                }
                $sql = implode(' UNION ALL ', $parts);
                $res = DBselect($sql);
                while ($row = DBfetch($res)) {
                    $last_values[(int) $row['itemid']] = $row['value'];
                }
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
        $host_traffic   = [];
        $lldp_raw       = [];
        $host_cpu       = [];
        $host_mem_used  = [];   // bytes (used)
        $host_mem_total = [];   // bytes (total)
        $host_mem_avail = [];   // bytes (available/free) \u2014 wenn used fehlt
        $host_mem_pct   = [];   // direkter Prozent-Wert (Top-Prio)
        $host_ping      = [];

        // SNMP memory helper: hrStorage entries per host
        // hrStorageType .1.3.6.1.2.1.25.2.1.2 = RAM
        $hr_used  = [];  // hostid => [index => bytes]
        $hr_total = [];
        $hr_type  = [];

        foreach ($items_a as $item) {
            $hid = $item['hostid'];
            $key = $item['key_'];
            $val = $item['lastvalue'];

            if (strpos($key, 'net.if') === 0) {
                // Zabbix agent traffic (bits/s)
                $name = strtolower($item['name']);
                if (!isset($host_traffic[$hid])) {
                    $host_traffic[$hid] = ['in' => 0.0, 'out' => 0.0];
                }
                if (strpos($name, 'received') !== false || strpos($name, 'bits in') !== false) {
                    $host_traffic[$hid]['in'] += (float) $val;
                } elseif (strpos($name, 'sent') !== false || strpos($name, 'bits out') !== false) {
                    $host_traffic[$hid]['out'] += (float) $val;
                }
            } elseif (strpos($key, 'ifHCInOctets') !== false || strpos($key, 'ifInOctets') !== false) {
                // SNMP traffic in — octets/s → bits/s × 8
                if (!isset($host_traffic[$hid])) {
                    $host_traffic[$hid] = ['in' => 0.0, 'out' => 0.0];
                }
                $host_traffic[$hid]['in'] += (float) $val * 8;
            } elseif (strpos($key, 'ifHCOutOctets') !== false || strpos($key, 'ifOutOctets') !== false) {
                // SNMP traffic out
                if (!isset($host_traffic[$hid])) {
                    $host_traffic[$hid] = ['in' => 0.0, 'out' => 0.0];
                }
                $host_traffic[$hid]['out'] += (float) $val * 8;
            } elseif ($key === 'lldpRemSysName' && !empty($val)) {
                $lldp_raw[] = ['hostid' => $hid, 'key_' => $key, 'lastvalue' => $val];
            }
        }

        foreach ($items_b as $item) {
            $hid = $item['hostid'];
            $key = $item['key_'];
            $val = (float) $item['lastvalue'];

            // ── CPU ──────────────────────────────────────────────────────
            // Prio: direkter Prozent-Wert > Aggregate.
            // Erst gefundener Wert "gewinnt" (Templates können doppelt liefern).
            if ($key === 'system.cpu.util' || $key === 'system.cpu.utilization') {
                if (!isset($host_cpu[$hid])) $host_cpu[$hid] = round($val, 1);
            } elseif (preg_match('/^system\.cpu\.util\[/', $key)) {
                // system.cpu.util[,user] / system.cpu.util[all,idle] etc.
                // Bei [*,idle]: 100 - val. Sonst direkter Wert.
                if (!isset($host_cpu[$hid])) {
                    $host_cpu[$hid] = (strpos($key, 'idle') !== false)
                        ? round(max(0.0, 100.0 - $val), 1)
                        : round($val, 1);
                }
            } elseif (preg_match('/proxmox\.[^.]*\.?cpu\.usage/', $key)) {
                // Proxmox liefert CPU als 0..1 Float (z.B. 0.42 = 42%)
                if (!isset($host_cpu[$hid])) {
                    $cpu_pct = $val <= 1.0 ? $val * 100.0 : $val;
                    $host_cpu[$hid] = round($cpu_pct, 1);
                }
            } elseif (strpos($key, 'perf_counter') === 0 && stripos($key, 'Processor') !== false
                      && stripos($key, 'Processor Time') !== false) {
                // Windows: perf_counter[\Processor(_Total)\% Processor Time]
                if (!isset($host_cpu[$hid])) $host_cpu[$hid] = round($val, 1);
            } elseif (strpos($key, 'hrProcessorLoad') !== false) {
                // HOST-RESOURCES-MIB: average across CPUs
                if (!isset($host_cpu[$hid])) {
                    $host_cpu[$hid] = round($val, 1);
                } else {
                    $host_cpu[$hid] = round(($host_cpu[$hid] + $val) / 2, 1);
                }
            } elseif ($key === 'ssCpuUser' || $key === 'ssCpuSystem') {
                if (!isset($host_cpu[$hid])) $host_cpu[$hid] = 0.0;
                $host_cpu[$hid] = round($host_cpu[$hid] + $val, 1);
            } elseif ($key === 'synoSystem.ssCpuIdle') {
                if (!isset($host_cpu[$hid])) {
                    $host_cpu[$hid] = round(max(0.0, 100.0 - $val * 0.01), 1);
                }

            // ── Memory Agent (klassisch: used/total getrennt) ─────────────
            } elseif (strpos($key, 'vm.memory.size[used]') !== false) {
                $host_mem_used[$hid] = $val;
            } elseif (strpos($key, 'vm.memory.size[total]') !== false) {
                $host_mem_total[$hid] = $val;

            // ── Memory: direkter Prozent-Wert (Top-Prio) ──────────────────
            // vm.memory.size[pused], vm.memory.utilization \u2192 sofort fertig
            } elseif (strpos($key, 'vm.memory.size[pused]') !== false
                      || $key === 'vm.memory.utilization') {
                $host_mem_pct[$hid] = round($val, 1);

            // ── Memory: available/free statt used ─────────────────────────
            // Wenn nur available + total verf\u00FCgbar sind, rechnen wir den
            // used-Wert sp\u00E4ter aus (im Resolve-Schritt).
            } elseif (strpos($key, 'vm.memory.size[available]') !== false
                      || strpos($key, 'vm.memory.size[free]') !== false) {
                $host_mem_avail[$hid] = $val;

            // ── Memory: pavailable als direkter Prozent ───────────────────
            } elseif (strpos($key, 'vm.memory.size[pavailable]') !== false) {
                if (!isset($host_mem_pct[$hid])) {
                    $host_mem_pct[$hid] = round(max(0.0, 100.0 - $val), 1);
                }

            // ── Memory: Proxmox-Template ──────────────────────────────────
            } elseif (preg_match('/proxmox\.[^.]*\.?memory\.used/', $key)) {
                $host_mem_used[$hid] = $val;
            } elseif (preg_match('/proxmox\.[^.]*\.?memory\.total/', $key)) {
                $host_mem_total[$hid] = $val;

            // ── Memory: Windows perf_counter ──────────────────────────────
            } elseif (strpos($key, 'perf_counter') === 0
                      && stripos($key, 'Committed Bytes In Use') !== false) {
                if (!isset($host_mem_pct[$hid])) $host_mem_pct[$hid] = round($val, 1);

            // ── Memory SNMP (hrStorage) ───────────────────────────────────
            // Key format: hrStorageUsed[index] / hrStorageSize[index] / hrStorageType[index]
            } elseif (strpos($key, 'hrStorageType') !== false) {
                preg_match('/\[([^\]]+)\]/', $key, $m);
                $idx = $m[1] ?? '0';
                // hrStorageType kann als Integer (2) oder OID-String kommen:
                // "2", ".2", "1.3.6.1.2.1.25.2.1.2" -> alle bedeuten RAM
                $hr_type_raw = trim((string) $val);
                if (
                    $hr_type_raw === '2' ||
                    $hr_type_raw === '.2' ||
                    substr($hr_type_raw, -2) === '.2' ||
                    strpos($hr_type_raw, '25.2.1.2') !== false
                ) {
                    $hr_type[$hid][$idx] = 2; // RAM
                } elseif (
                    $hr_type_raw === '3' ||
                    substr($hr_type_raw, -2) === '.3' ||
                    strpos($hr_type_raw, '25.2.1.3') !== false
                ) {
                    $hr_type[$hid][$idx] = 3; // Virtual Memory
                } else {
                    $hr_type[$hid][$idx] = (int) $hr_type_raw;
                }
            } elseif (strpos($key, 'hrStorageUsed') !== false) {
                preg_match('/\[([^\]]+)\]/', $key, $m);
                $idx = $m[1] ?? '0';
                $hr_used[$hid][$idx] = $val;
            } elseif (strpos($key, 'hrStorageSize') !== false) {
                preg_match('/\[([^\]]+)\]/', $key, $m);
                $idx = $m[1] ?? '0';
                $hr_total[$hid][$idx] = $val;

            // ── Ping ──────────────────────────────────────────────────────
            } elseif (strpos($key, 'icmppingsec') !== false) {
                $ms = round($val * 1000, 1);
                if (!isset($host_ping[$hid]) || $ms < $host_ping[$hid]) {
                    $host_ping[$hid] = $ms;
                }
            }
        }

        // ── Resolve SNMP hrStorage memory (pick RAM entry, type=2) ───────
        foreach ($hr_used as $hid => $entries) {
            if (isset($host_mem_used[$hid])) continue; // Agent already found
            $total_used  = 0.0;
            $total_total = 0.0;
            foreach ($entries as $idx => $used) {
                $size = $hr_total[$hid][$idx] ?? 0;
                $type = $hr_type[$hid][$idx] ?? 0;
                // type 2 = hrStorageRam only; type 0 (unknown) absichtlich ausgeschlossen
                if ($type === 2 && $size > 0) {
                    $total_used  += $used;
                    $total_total += $size;
                }
            }
            if ($total_total > 0) {
                $host_mem_used[$hid]  = $total_used;
                $host_mem_total[$hid] = $total_total;
            }
        }

        // ── Resolve available/free \u2192 used (wenn used fehlt, total da ist) ──
        foreach ($host_mem_avail as $hid => $avail) {
            if (isset($host_mem_used[$hid])) continue;
            $total = $host_mem_total[$hid] ?? 0.0;
            if ($total > 0.0 && $avail >= 0.0) {
                $host_mem_used[$hid] = max(0.0, $total - $avail);
            }
        }

        // ── Memory % \u2014 Prio: direkter pct > used/total ────────────────────
        $host_memory = [];
        // 1. Direkte Prozent-Werte (vm.memory.utilization, perf_counter, ...)
        foreach ($host_mem_pct as $hid => $pct) {
            $host_memory[$hid] = (int) round(max(0.0, min(100.0, $pct)));
        }
        // 2. used/total \u2014 nur wenn nicht schon Prozent vorhanden
        foreach ($host_mem_used as $hid => $used) {
            if (isset($host_memory[$hid])) continue;
            $total = $host_mem_total[$hid] ?? 0.0;
            if ($total > 0.0) {
                $host_memory[$hid] = (int) round($used / $total * 100);
            }
        }

        // ── 5. LLDP EDGES ─────────────────────────────────────────────────
        $name_map = [];
        $ip_map   = [];
        foreach ($hosts as $hid => $h) {
            $name_map[strtolower($h['host'])] = $hid;
            $name_map[strtolower($h['name'])] = $hid;
            foreach ($h['interfaces'] ?? [] as $iface) {
                if (!empty($iface['ip'])) {
                    $ip_map[$iface['ip']] = $hid;
                }
            }
        }

        $edges          = [];
        $seen_edges     = [];
        $lldp_unmatched = [];
        foreach ($lldp_raw as $item) {
            // Wert kann komma-separierte Liste sein: "pve,HP24GARUBA"
            $neighbors = array_map('trim', explode(',', $item['lastvalue']));
            foreach ($neighbors as $neighbor_raw) {
                if (empty($neighbor_raw)) continue;
                $lldp_val = strtolower($neighbor_raw);
                // 1. Exakter Match
                $rhid = $name_map[$lldp_val] ?? null;
                // 2. IP-Match
                if (!$rhid && isset($ip_map[$neighbor_raw])) {
                    $rhid = $ip_map[$neighbor_raw];
                }
                // 3. Short-Hostname nur wenn eindeutig
                if (!$rhid) {
                    $lldp_short = explode('.', $lldp_val)[0];
                    $candidates = [];
                    foreach ($name_map as $mapped_name => $mapped_hid) {
                        if (explode('.', $mapped_name)[0] === $lldp_short) {
                            $candidates[$mapped_hid] = true;
                        }
                    }
                    if (count($candidates) === 1) {
                        $rhid = array_key_first($candidates);
                    }
                }
                if (!$rhid || $rhid === $item['hostid']) {
                    if (!$rhid) {
                        $lldp_unmatched[] = $neighbor_raw . ' (from hostid=' . $item['hostid'] . ')';
                    }
                    continue;
                }
                $pair = [(string)$item['hostid'], (string)$rhid];
                sort($pair);
                $edge_key = implode('-', $pair);
                if (!isset($seen_edges[$edge_key])) {
                    $seen_edges[$edge_key] = true;
                    $edges[] = ['id' => 'e'.count($edges), 'from' => $item['hostid'],
                                'to' => $rhid, 'iface' => $item['key_']];
                }
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
            $detected_type = $this->deviceType($h['host'], $tpls);
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

            $nodes[] = [
                'id'          => $hid,
                'label'       => $h['name'] !== '' ? $h['name'] : $h['host'],
                'host'        => $h['host'],
                'ip'          => $this->primaryIp($ifaces),
                'iftype'      => $this->ifaceType($ifaces),
                'severity'    => $host_severity[$hid] ?? 0,
                'problems'    => $host_problems[$hid]  ?? 0,
                'problem_list' => $host_problem_list[$hid] ?? [],
                'acknowledged'=> $all_acked,
                // Type-loose: API liefert mal '1', mal 1
                'maintenance' => (int) ($h['maintenance_status'] ?? 0) === 1,
                'type'        => $effective_type,
                'icon_override' => isset($host_icon_override[$hid]),  // Frontend-Hinweis
                'groups'      => $host_group_names[$hid] ?? [],
                // Proxy/ProxyGroup-Lookup (leer wenn Host direkt am Server hängt)
                'proxy_name'       => $proxy_names[(string)($h['proxyid'] ?? '0')] ?? '',
                'proxy_group_name' => $pgroup_names[(string)($h['proxy_groupid'] ?? '0')] ?? '',
                'traffic'     => $host_traffic[$hid]  ?? ['in' => 0.0, 'out' => 0.0],
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

        $this->setResponse(new CControllerResponseData([
            'main_block' => json_encode(
                ['nodes' => $nodes, 'edges' => $edges, 'lldp_unmatched' => $lldp_unmatched],
                JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
            )
        ]));
    }

    // Returns IP from primary interface, prefers Agent but falls back to SNMP/JMX/IPMI
    private function primaryIp(array $ifaces): string {
        if (!$ifaces) return '';
        // Sort: main=1 first, then by type (1=agent, 2=snmp, 3=ipmi, 4=jmx)
        usort($ifaces, static fn($a, $b) =>
            $b['main'] !== $a['main']
                ? (int)$b['main'] - (int)$a['main']
                : (int)$a['type'] - (int)$b['type']
        );
        return $ifaces[0]['ip'] ?? '';
    }

    // Returns interface type string for JS display
    private function ifaceType(array $ifaces): string {
        foreach ($ifaces as $i) {
            if ((int)$i['main'] === 1) {
                return match((int)$i['type']) {
                    1 => 'Agent',
                    2 => 'SNMP',
                    3 => 'IPMI',
                    4 => 'JMX',
                    default => 'Unknown'
                };
            }
        }
        return 'Unknown';
    }

    private function deviceType(string $host, array $tpls): string {
        $s = strtolower($host.' '.implode(' ', $tpls));
        $map = [
            // Network security
            'firewall'       => ['fw-','firewall','fortigate','pfsense','opnsense','-asa-','srx',
                                 'opnsense by snmp'],
            'router'         => ['rtr-','router','-gw-','gateway','mikrotik routeros','vyos'],
            'switch'         => ['sw-','switch','-core-','-acc-','catalyst','procurve','nexus',
                                 'hp enterprise switch','tp-link by snmp'],
            'wireless'       => ['-ap-','wlan','wifi','wireless','unifi','omada'],
            // Storage & backup
            'storage'        => ['nas-','synology','qnap','netapp','storage','truenas',
                                 'truenas core by snmp','synology active backup'],
            // Virtualization
            'hypervisor'     => ['esxi','vmware','proxmox','proxmox ve by http',
                                 'hypervisor','pve'],
            // Surveillance
            'camera'         => ['cam-','camera','nvr','dvr','hikvision','dahua','axis'],
            // Power
            'ups'            => ['ups-','usv-','usv','ups','apc','eaton','powerware',
                                 'network ups'],
            // Home automation
            'homeauto'       => ['home assistant','homeassistant','home-assistant',
                                 'zigbee','z-wave','domoticz','openhab'],
            // Mail
            'mailserver'     => ['mail','smtp','imap','mailcow','postfix','dovecot',
                                 'mailcow complete'],
            // Web & apps
            'webserver'      => ['nginx by zabbix','apache','web-','www-'],
            // Containers
            'container'      => ['docker by zabbix','docker','container','kubernetes'],
            // Monitoring
            'monitoring'     => ['tactical rmm','rmm.cloudglue'],
            // Printer
            'printer'        => ['prt-','printer','mfp'],
            // Linux/Windows/macOS generic servers
            'linux'          => ['linux by zabbix agent','zfs on linux'],
            'windows'        => ['windows','win-'],
            'macos'          => ['macos by zabbix agent'],
            // Generic server fallback
            'server'         => ['srv-','server'],
        ];
        foreach ($map as $type => $kws) {
            foreach ($kws as $kw) {
                if (strpos($s, $kw) !== false) return $type;
            }
        }
        return 'server';
    }
}
