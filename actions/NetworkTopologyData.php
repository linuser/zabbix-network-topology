<?php
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CController;
use CControllerResponseData;
use CControllerResponseFatal;
use API;

class NetworkTopologyData extends CController {

    // Schutz vor CSRF-Last-Abuse (Lese-Endpoint, kein CSRF-Token):
    // Cap auf max 100 Gruppen pro Request. Realistisch hat ein User
    // selten >10 Gruppen ausgewaehlt — 100 ist 10x Sicherheits-Puffer
    // gegen einen Browser-Cross-Origin-Trigger mit riesigem Group-Array.
    private const MAX_GROUPS = 100;

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    // Read-only Endpunkt — nur XHR-Aufrufe akzeptieren. Cross-Origin-Browser
    // koennen X-Requested-With nicht ohne CORS-Preflight setzen, also
    // schuetzt das gegen CSRF-Last (Daten kann der Angreifer wegen Same-
    // Origin sowieso nicht lesen, aber er koennte teure Queries triggern).
    private function requireAjax(): bool {
        if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'XMLHttpRequest') {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['error' => 'AJAX only'])
            ]));
            return false;
        }
        return true;
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
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['nodes' => [], 'edges' => []])
            ]));
            return;
        }
        if (count($groupids) > self::MAX_GROUPS) {
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
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['nodes' => [], 'edges' => []])
            ]));
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
                }
            }
        }

        // ── 2c. Integration-Links aus Zabbix Global-Macros ────────────────
        // Pattern: {$NT_INT_<NAME>_LABEL} / {$NT_INT_<NAME>_URL}. Beide
        // muessen gesetzt sein. URL-Templates duerfen Tokens enthalten:
        //   {host}, {label}, {ip}, {location}
        // Pro Host wird der Template-String mit URL-encoded Werten gefuellt
        // und an host_links angehaengt. Cap analog nt:link bei 6 Links/Host.
        $integration_templates = $this->loadIntegrationTemplates();
        // primaryIp() sortiert die interfaces in-place (usort) — beim wiederholten
        // Aufruf pro Template UND spaeter in der Host-Assembly nicht noetig.
        // Einmal pro Host cachen.
        $primary_ip_cache = [];
        if (!empty($integration_templates)) {
            foreach ($hosts as $hid => $h) {
                if (!isset($host_links[$hid])) $host_links[$hid] = [];
                if (!isset($primary_ip_cache[$hid])) {
                    $primary_ip_cache[$hid] = $this->primaryIp($h['interfaces'] ?? []);
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
            } elseif (!empty($val) && (
                    $key === 'lldpRemSysName'
                 || strpos($key, 'cdpCacheDeviceId')  !== false   // Cisco CDP
                 || strpos($key, 'neighbor.sysName')  !== false   // generisch / Ubiquiti
                 || strpos($key, 'discovery.neighbor') !== false  // MikroTik & andere
                 || preg_match('/(?:^|\.)(lldp.*sysname|cdp.*device)/i', $key)
                 )) {
                // Quelle merken (lldp/cdp/other) — Frontend kann das spaeter
                // anzeigen oder zum Debuggen nutzen. Fuer den Match selber egal.
                $src = (strpos($key, 'cdp') !== false) ? 'cdp'
                     : (strpos($key, 'lldp') !== false) ? 'lldp' : 'other';
                $lldp_raw[] = ['hostid' => $hid, 'key_' => $key, 'lastvalue' => $val, 'src' => $src];
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
        // Short-Name-Map einmal vorberechnen statt pro Edge linear durch
        // alle name_map-Eintraege zu iterieren. Bei 500 Hosts × 500 LLDP-
        // Neighbors war das vorher 250k Vergleiche.
        $short_name_map = [];   // short → [hid, ...]
        foreach ($name_map as $mapped_name => $mapped_hid) {
            $short = explode('.', $mapped_name)[0];
            $short_name_map[$short][$mapped_hid] = true;
        }

        $edges          = [];
        $seen_edges     = [];
        $lldp_unmatched = [];

        // Cleanup-Helper fuer Vendor-spezifische Neighbor-Strings:
        //   Cisco IP-Phones: "SEP00112233AABB" → enthaelt MAC, kein Host-Match
        //   Cisco APs:       "AP-corp-01.example.com(JAFXXXXXXX)" → Serial in Klammern
        //   HP/Aruba:        "ProCurve_Switch_2530-24G" → manchmal SysDescr statt SysName
        //   Ubiquiti:        "UAP-AC-PRO" oder "ubnt-12345"
        //   reverse-DNS:     "ip-10-0-0-5.eu-central-1.compute.internal"
        // Wir reduzieren auf den ersten "echten" Token vor Leerzeichen/Klammer.
        $cleanNeighbor = static function(string $raw): string {
            $s = trim($raw);
            // Vor erstem Leerzeichen abschneiden ("hostname Description...")
            $sp = strpos($s, ' ');  if ($sp !== false) $s = substr($s, 0, $sp);
            // Vor offener Klammer abschneiden ("hostname(serial)")
            $br = strpos($s, '(');  if ($br !== false) $s = substr($s, 0, $br);
            // Trailing-Punkte (FQDN-Wurzel) entfernen
            $s = rtrim($s, '.');
            return trim($s);
        };

        foreach ($lldp_raw as $item) {
            // Wert kann komma-separierte Liste sein: "pve,HP24GARUBA".
            // CDP kann auch "\n"-separiert oder mit Pipe kommen.
            $neighbors = preg_split('/[,\n\r\|]+/', $item['lastvalue']);
            foreach ($neighbors as $neighbor_raw) {
                $neighbor_raw = $cleanNeighbor((string) $neighbor_raw);
                if ($neighbor_raw === '') continue;
                $lldp_val = strtolower($neighbor_raw);

                // 1. Exakter Match gegen host/visiblename/lowercase
                $rhid = $name_map[$lldp_val] ?? null;

                // 2. IP-Match (auch falls Klammern/Praefix entfernt wurden)
                if (!$rhid && isset($ip_map[$neighbor_raw])) {
                    $rhid = $ip_map[$neighbor_raw];
                }

                // 2b. reverse-DNS-Pattern wie "ip-10-0-0-5" oder "host-10-0-0-5"
                //     → extrahiere die IP und versuche IP-Match
                if (!$rhid && preg_match('/(?:^|[-_])(\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3})/', $lldp_val, $mm)) {
                    $extracted_ip = str_replace('-', '.', $mm[1]);
                    if (isset($ip_map[$extracted_ip])) $rhid = $ip_map[$extracted_ip];
                }

                // 3. Short-Hostname nur wenn eindeutig (O(1)-Lookup via Map)
                if (!$rhid) {
                    $lldp_short = explode('.', $lldp_val)[0];
                    $candidates = $short_name_map[$lldp_short] ?? [];
                    if (count($candidates) === 1) {
                        $rhid = array_key_first($candidates);
                    }
                }

                if (!$rhid || $rhid === $item['hostid']) {
                    if (!$rhid) {
                        $lldp_unmatched[] = $neighbor_raw . ' (from hostid=' . $item['hostid']
                                          . ', src=' . ($item['src'] ?? '?') . ')';
                    }
                    continue;
                }
                $pair = [(string)$item['hostid'], (string)$rhid];
                sort($pair);
                $edge_key = implode('-', $pair);
                $src = $item['src'] ?? 'other';
                if (!isset($seen_edges[$edge_key])) {
                    $seen_edges[$edge_key] = count($edges);
                    $edges[] = ['id' => 'e'.count($edges), 'from' => $item['hostid'],
                                'to' => $rhid, 'iface' => $item['key_'],
                                'src' => [$src => true]];
                } else {
                    // Edge schon bekannt (z.B. von LLDP) — Source ergaenzen
                    // wenn jetzt CDP dieselbe Verbindung meldet (merge-Logik).
                    $eidx = $seen_edges[$edge_key];
                    if (!isset($edges[$eidx]['src'][$src])) {
                        $edges[$eidx]['src'][$src] = true;
                    }
                }
            }
        }
        // src-Map zu sortierter Liste konvertieren fuers Frontend ("lldp", "cdp")
        foreach ($edges as &$_e) {
            if (isset($_e['src']) && is_array($_e['src'])) {
                $_e['src'] = array_keys($_e['src']);
                sort($_e['src']);
            }
        }
        unset($_e);

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
                'ip'          => $primary_ip_cache[$hid] ?? ($primary_ip_cache[$hid] = $this->primaryIp($ifaces)),
                'iftype'      => $this->ifaceType($ifaces),
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

        $_payload = json_encode(
            ['nodes' => $nodes, 'edges' => $edges, 'lldp_unmatched' => $lldp_unmatched],
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
        );
        NetworkTopologyDiag::record([
            'action'     => 'data',
            'elapsed_ms' => round((microtime(true) - $_t0) * 1000, 1),
            'bytes'      => strlen($_payload),
            'cache_hit'  => false,
            'counts'     => ['hosts' => count($nodes), 'edges' => count($edges)],
        ]);
        $this->setResponse(new CControllerResponseData(['main_block' => $_payload]));
    }

    /**
     * Laedt Integration-Templates aus Zabbix Global-Macros.
     * Erwartet Paare: {$NT_INT_<NAME>_LABEL} + {$NT_INT_<NAME>_URL}.
     * Liefert ein Array [{name, label, url}, ...] mit dem URL-Template
     * (Tokens noch nicht expandiert).
     *
     * Beispiel-Macros:
     *   {$NT_INT_NETBOX_LABEL} = NetBox
     *   {$NT_INT_NETBOX_URL}   = https://netbox.fox1.de/dcim/devices/?q={host}
     */
    private function loadIntegrationTemplates(): array {
        try {
            $macros = API::UserMacro()->get([
                'output'      => ['macro', 'value'],
                'globalmacro' => true,
            ]);
        } catch (\Throwable $e) {
            return [];   // API nicht verfuegbar → leise no-op
        }
        $by_name = [];   // name → ['label' => ?, 'url' => ?]
        foreach ($macros as $m) {
            $macro = $m['macro'] ?? '';
            if (!preg_match('/^\{\$NT_INT_([A-Z0-9_]+)_(LABEL|URL)\}$/', $macro, $mm)) continue;
            $name = $mm[1];
            $part = strtolower($mm[2]);
            $by_name[$name][$part] = (string) ($m['value'] ?? '');
        }
        $out = [];
        foreach ($by_name as $name => $parts) {
            $label = trim($parts['label'] ?? '');
            $url   = trim($parts['url']   ?? '');
            if ($label === '' || $url === '') continue;
            // Schutz-Caps analog nt:link
            if (strlen($label) > 200 || strlen($url) > 2048) continue;
            if (!preg_match('#^https?://#i', $url)) continue;
            if (preg_match('/[\x00-\x1F\x7F]/', $url . $label)) continue;
            $out[] = ['name' => $name, 'label' => $label, 'url' => $url];
        }
        return $out;
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
