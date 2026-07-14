<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Topology;

/**
 * MetricExtractor
 *
 * Zweiter Schnitt der Data.php-Aufteilung (Review §6) — und der wichtigste:
 * die Metrik-Klassifikation. Sie war mit ~290 Zeilen der groesste Block im
 * 1200-Zeilen-doAction() und zugleich der, der am dringendsten Tests braucht:
 * hier wird aus rohen Item-Keys geraten, was CPU, Memory, Traffic, Link-Speed,
 * Interface-Health und Ping eines Hosts sind — quer ueber Agent-, SNMP-,
 * Proxmox-, Windows- und hrStorage-Varianten. Genau in dieser Heuristik sass
 * schon einmal ein Bug, der CPU/Memory fuer JEDEN Host leer liess.
 *
 * Der Block ist vollstaendig REIN: rein gehen die Items (mit injiziertem
 * 'lastvalue'), raus kommen sieben Arrays. Kein API-Call, kein Controller-
 * Zustand, keine Seiteneffekte. Dadurch ist er erstmals einzeln pruefbar,
 * ohne eine ganze Zabbix-Request-Umgebung hochzuziehen — was das Review als
 * Kernproblem der Monolith-Datei benennt.
 *
 * Die interne Mechanik (Reihenfolge der Branches, Oper/Admin-Korrelation,
 * Memory-Prioritaeten, hrStorage-Aufloesung) ist unveraendert aus Data.php
 * uebernommen — dies ist ein reiner Struktur-Umbau, keine Verhaltensaenderung.
 */
final class MetricExtractor {

    /**
     * Klassifiziert die Items eines Requests zu Host-Metriken.
     *
     * @param array $items_a  Items MIT bereits injiziertem 'lastvalue'
     *
     * @return array{
     *     traffic:  array<string, array{in: float, out: float}>,
     *     iface:    array<string, array{down: int, errors: float, discards: float, count: int}>,
     *     speed:    array<string, float>,
     *     cpu:      array<string, float>,
     *     memory:   array<string, int>,
     *     ping:     array<string, mixed>,
     *     lldp_raw: array<int, array{hostid: string, key_: string, lastvalue: mixed, src: string}>
     * }
     */
    public static function extract(array $items_a): array {
        // ── 4. PROCESS ITEMS ──────────────────────────────────────────────
        $host_traffic   = [];
        // Interface-Health pro Host: aggregiert ueber alle Interfaces.
        //   down_count    Anzahl Interfaces mit ifOperStatus != 1 (up)
        //   errors_rate   Summe in+out Errors/sec ueber alle Interfaces
        //   discards_rate Summe in+out Discards/sec ueber alle Interfaces
        //   iface_count   Anzahl beobachteter Interfaces (Kontext)
        $host_iface     = [];   // hid => ['down'=>N, 'errors'=>X, 'discards'=>X, 'count'=>N]
        $iface_oper     = [];   // hid => [ifaceParam => operStatus]  (Roh-Sammlung)
        $iface_admin    = [];   // hid => [ifaceParam => adminStatus] (fuer Korrelation)
        $host_speed     = [];   // hid => max Link-Speed in bps (Weathermap-Kapazitaet)
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

            // WICHTIG: Health-Branches VOR dem generischen net.if-Traffic-Branch.
            // Moderne SNMP-Template-Keys wie net.if.status[ifOperStatus.1] und
            // net.if.in.errors[ifInErrors.1] beginnen mit "net.if" — der
            // Traffic-Branch wuerde sie sonst schlucken und iface_health bliebe
            // fuer Standard-Zabbix-7-Templates leer.
            if (strpos($key, 'ifOperStatus') !== false) {
                // Oper-Status pro Interface. Bracket-Param als Korrelations-
                // Key zu ifAdminStatus, damit admin-down (absichtlich
                // deaktivierte Ports) unten nicht als "Link down" zaehlt.
                $iface_oper[$hid][HostMetadata::ifaceParam($key)] = (int) $val;
            } elseif (strpos($key, 'ifAdminStatus') !== false) {
                $iface_admin[$hid][HostMetadata::ifaceParam($key)] = (int) $val;
            } elseif (strpos($key, 'ifInErrors') !== false || strpos($key, 'ifOutErrors') !== false
                  || preg_match('/net\.if\.(?:in|out)\[[^\]]*,errors\]/', $key)) {
                if (!isset($host_iface[$hid])) $host_iface[$hid] = ['down'=>0,'errors'=>0.0,'discards'=>0.0,'count'=>0];
                $host_iface[$hid]['errors'] += (float) $val;
            } elseif (strpos($key, 'ifInDiscards') !== false || strpos($key, 'ifOutDiscards') !== false
                  || preg_match('/net\.if\.(?:in|out)\[[^\]]*,dropped\]/', $key)) {
                if (!isset($host_iface[$hid])) $host_iface[$hid] = ['down'=>0,'errors'=>0.0,'discards'=>0.0,'count'=>0];
                $host_iface[$hid]['discards'] += (float) $val;
            } elseif (strpos($key, 'ifHighSpeed') !== false) {
                // ifHighSpeed = Mbps. ABER: das Zabbix-Standard-Template
                // multipliziert per Preprocessing schon auf bps. Heuristik:
                // Werte < 1e7 sind Mbps (800G-Link = 8e5 Mbps), Werte >= 1e7
                // sind bereits bps (kleinster realer bps-Wert: 10M = 1e7).
                $sp = (float) $val;
                if ($sp > 0) {
                    if ($sp < 1.0e7) $sp *= 1.0e6;
                    if (!isset($host_speed[$hid]) || $sp > $host_speed[$hid]) $host_speed[$hid] = $sp;
                }
            } elseif (strpos($key, 'ifSpeed') !== false) {
                // ifSpeed = bps direkt (32bit-Counter, capped bei ~4.3G)
                $sp = (float) $val;
                if ($sp > 0 && (!isset($host_speed[$hid]) || $sp > $host_speed[$hid])) {
                    $host_speed[$hid] = $sp;
                }
            } elseif (strpos($key, 'net.if') === 0) {
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
                $src = (strpos($key, 'cdp') !== false)
                    ? 'cdp'
                    : ((strpos($key, 'lldp') !== false) ? 'lldp' : 'other');
                $lldp_raw[] = ['hostid' => $hid, 'key_' => $key, 'lastvalue' => $val, 'src' => $src];
            }
        }

        // Oper/Admin-Korrelation → down-Count pro Host. Ein Interface zaehlt
        // nur als down wenn oper=down(2)/lowerLayerDown(7) UND es nicht
        // absichtlich deaktiviert ist (admin=down(2)). notPresent(6)/unknown(4)
        // zaehlen weder als up noch down (typisch: ungenutzte Ports).
        foreach ($iface_oper as $hid => $params) {
            if (!isset($host_iface[$hid])) $host_iface[$hid] = ['down'=>0,'errors'=>0.0,'discards'=>0.0,'count'=>0];
            foreach ($params as $param => $oper) {
                if ($oper === 4 || $oper === 6) continue;
                $admin = $iface_admin[$hid][$param] ?? 1;
                if ($admin === 2) continue;   // admin-down: gewollt, kein Issue
                $host_iface[$hid]['count']++;
                if ($oper === 2 || $oper === 7) $host_iface[$hid]['down']++;
            }
        }

        // Zweiter Durchlauf ueber dieselben Items: Metrik-Klassifikation
        // (CPU/Memory/Ping/SNMP-Varianten). Frueher lief das ueber ein separates
        // $items_b, das seit einem Fetch-Merge dauerhaft leer war — dadurch
        // blieben CPU/Memory fuer JEDEN Host "—" (Fix in 4.34.0). Beide
        // Durchlaeufe iterieren jetzt eindeutig $items_a.
        foreach ($items_a as $item) {
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


        return [
            'traffic'  => $host_traffic,
            'iface'    => $host_iface,
            'speed'    => $host_speed,
            'cpu'      => $host_cpu,
            'memory'   => $host_memory,
            'ping'     => $host_ping,
            'lldp_raw' => $lldp_raw,
        ];
    }
}
