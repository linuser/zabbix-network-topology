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
        $hosts = API::Host()->get([
            'output'                => ['hostid', 'host', 'name', 'status', 'maintenance_status', 'maintenanceid'],
            'groupids'              => $groupids,
            'selectInterfaces'      => ['ip', 'type', 'main'],
            'selectParentTemplates' => ['name'],
            'selectInventory'       => ['location_lat', 'location_lon', 'location'],
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
        if ($host_problems) {
            $problems = API::Problem()->get([
                'output'       => ['eventid', 'objectid', 'acknowledged'],
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
                foreach ($hids as $hid) {
                    $host_ack_total[$hid] = ($host_ack_total[$hid] ?? 0) + 1;
                    if ($is_acked) {
                        $host_ack_acked[$hid] = ($host_ack_acked[$hid] ?? 0) + 1;
                    }
                }
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
        $all_items = $items_a + $items_b;
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

        // ── 6. BUILD NODES ────────────────────────────────────────────────
        $nodes = [];
        foreach ($hosts as $hid => $h) {
            $tpls    = array_column($h['parentTemplates'] ?? [], 'name');
            $ifaces  = $h['interfaces'] ?? [];
            // Ein Host gilt als "acknowledged", wenn alle Probleme acked sind.
            $total = $host_ack_total[$hid] ?? 0;
            $acked = $host_ack_acked[$hid] ?? 0;
            $all_acked = $total > 0 && $acked === $total;
            $nodes[] = [
                'id'          => $hid,
                'label'       => $h['name'] !== '' ? $h['name'] : $h['host'],
                'host'        => $h['host'],
                'ip'          => $this->primaryIp($ifaces),
                'iftype'      => $this->ifaceType($ifaces),
                'severity'    => $host_severity[$hid] ?? 0,
                'problems'    => $host_problems[$hid]  ?? 0,
                'acknowledged'=> $all_acked,
                // Type-loose: API liefert mal '1', mal 1
                'maintenance' => (int) ($h['maintenance_status'] ?? 0) === 1,
                'type'        => $this->deviceType($h['host'], $tpls),
                'groups'      => $host_group_names[$hid] ?? [],
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
