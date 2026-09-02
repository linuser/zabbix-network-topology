<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

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
     *     lldp_raw: array<int, array{hostid: string, key_: string, lastvalue: mixed, src: string}>,
     *     port_traffic: array<string, array<string, array{in: float, out: float}>>,
     *     port_speed:   array<string, array<string, float>>,
     *     lldp_ports:   array<string, array<string, array{id?: string, desc?: string}>>,
     *     lldp_meta:    array<string, array<string, array{desc?: string, caps?: string, chassis?: string}>>
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
        // §3 Port-zu-Port: per-Interface-Traffic/-Speed (ifIndex-Key) + Remote-Port
        // je LLDP/CDP-SNMPINDEX. Getrennt von den Host-Aggregaten oben, damit die
        // bestehende Knoten-Metrik unveraendert bleibt.
        $port_traffic   = [];   // hid => [ifIndex => ['in'=>bps, 'out'=>bps]]
        $port_speed     = [];   // hid => [ifIndex => bps]
        // Errors/Discards PRO Interface — zusaetzlich zur Host-Summe unten.
        //
        // Die Werte wurden schon immer erhoben, aber nur aufsummiert. Damit
        // trug eine Kante am Ende die Host-Zahl ("worst case beider
        // Endpunkte"), und die sagt ueber DIESEN Link nichts: ein Switch mit
        // einem einzigen defekten Uplink faerbte so jede seiner Kanten. Fuer
        // die Faerbung ist das Aggregat richtig, fuer eine Portansicht nicht.
        $port_errors    = [];   // hid => [ifIndex => errors/s]
        $port_discards  = [];   // hid => [ifIndex => discards/s]
        $lldp_ports     = [];   // hid => [snmpindex => ['id'=>?, 'desc'=>?]]
        $lldp_meta      = [];   // hid => [snmpindex => ['desc'|'caps'|'chassis']]
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

            // §3b Per-Interface-Traffic: ifIndex + Richtung aus SNMP-Octets-Keys
            // (ifHCInOctets.8 / net.if.in[ifHCInOctets.8] / ifInOctets.8). Eigenes
            // Array — stoert die Host-Aggregation unten NICHT. net.if.*-Werte sind
            // schon bits/s (Template-Preprocessing ×8); rohe *Octets sind octets/s
            // → hier ×8. Nur numerische ifIndex-Keys; agent-Namens-Interfaces
            // ("ens18") haben ohnehin keinen LLDP-Port-Bezug.
            // ifIndex-Trenner ist je nach Template ein Punkt (net.if.in[ifHCInOctets.8])
            // oder eine Klammer (ifHCInOctets[8]) → [.\[] deckt beide.
            // Billiger strpos-Vorfilter vor dem Regex: die grosse Mehrheit der
            // Items (CPU/Mem/Ping/Status) enthaelt weder "Octets" noch "Speed",
            // spart also je einen Regex-Lauf pro Item im Hot-Loop.
            if (strpos($key, 'Octets') !== false
                    && preg_match('/(?:HC)?(In|Out)Octets[.\[](\d+)/', $key, $om)) {
                $ifx  = $om[2];
                $bits = (strpos($key, 'net.if') === 0) ? (float) $val : (float) $val * 8;
                if (!isset($port_traffic[$hid][$ifx])) $port_traffic[$hid][$ifx] = ['in' => 0.0, 'out' => 0.0];
                $port_traffic[$hid][$ifx][strtolower($om[1])] += $bits;
            }
            // §3b Per-Interface-Speed als Auslastungs-Divisor (optional). ifHighSpeed
            // = Mbps (highSpeedBps normalisiert, gleiche Heuristik wie Host-Speed);
            // ifSpeed = bps direkt.
            if (strpos($key, 'Speed') !== false) {
                if (preg_match('/ifHighSpeed[.\[](\d+)/', $key, $sm)) {
                    $sp = self::highSpeedBps($val);
                    if ($sp > 0) $port_speed[$hid][$sm[1]] = $sp;
                } elseif (preg_match('/ifSpeed[.\[](\d+)/', $key, $sm)) {
                    $sp = (float) $val;
                    if ($sp > 0 && !isset($port_speed[$hid][$sm[1]])) $port_speed[$hid][$sm[1]] = $sp;
                }
            }

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
                $ifx_e = self::ifIndexOf($key);
                if ($ifx_e !== '') {
                    $port_errors[$hid][$ifx_e] = ($port_errors[$hid][$ifx_e] ?? 0.0) + (float) $val;
                }
            } elseif (strpos($key, 'ifInDiscards') !== false || strpos($key, 'ifOutDiscards') !== false
                  || preg_match('/net\.if\.(?:in|out)\[[^\]]*,dropped\]/', $key)) {
                if (!isset($host_iface[$hid])) $host_iface[$hid] = ['down'=>0,'errors'=>0.0,'discards'=>0.0,'count'=>0];
                $host_iface[$hid]['discards'] += (float) $val;
                $ifx_d = self::ifIndexOf($key);
                if ($ifx_d !== '') {
                    $port_discards[$hid][$ifx_d] = ($port_discards[$hid][$ifx_d] ?? 0.0) + (float) $val;
                }
            } elseif (strpos($key, 'ifHighSpeed') !== false) {
                // ifHighSpeed = Mbps (highSpeedBps normalisiert Mbps→bps; das
                // Zabbix-Standard-Template liefert teils schon bps → Heuristik dort).
                $sp = self::highSpeedBps($val);
                if ($sp > 0 && (!isset($host_speed[$hid]) || $sp > $host_speed[$hid])) {
                    $host_speed[$hid] = $sp;
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
            } elseif (strpos($key, 'lldpRemPortId') !== false) {
                // §3 Remote-Port (LLDP). Gleicher SNMPINDEX wie lldpRemSysName →
                // LldpEdgeBuilder ordnet ihn der Nachbar-Zeile zu. PortId kann laut
                // PortIdSubtype eine MAC sein → beim Label gewinnt PortDesc.
                $lldp_ports[$hid][HostMetadata::ifaceParam($key)]['id'] = (string) $val;
            } elseif (strpos($key, 'lldpRemPortDesc') !== false) {
                $lldp_ports[$hid][HostMetadata::ifaceParam($key)]['desc'] = (string) $val;
            } elseif (strpos($key, 'lldpRemSysDesc') !== false) {
                // §5 Zusatzangaben ueber den Nachbarn. Gleicher SNMPINDEX wie
                // lldpRemSysName → LldpEdgeBuilder ordnet sie derselben
                // Nachbar-Zeile zu. Wichtig sind sie bei NICHT ueberwachten
                // Nachbarn: dort ist sonst nur der Name bekannt.
                $lldp_meta[$hid][HostMetadata::ifaceParam($key)]['desc'] = (string) $val;
            } elseif (strpos($key, 'lldpRemSysCapEnabled') !== false) {
                $lldp_meta[$hid][HostMetadata::ifaceParam($key)]['caps'] = (string) $val;
            } elseif (strpos($key, 'lldpRemChassisId') !== false) {
                $lldp_meta[$hid][HostMetadata::ifaceParam($key)]['chassis'] = (string) $val;
            } elseif (strpos($key, 'cdpCacheDevicePort') !== false) {
                // CDP-Remote-Port: menschenlesbar → als 'desc'. MUSS vor der
                // Neighbor-Branch stehen, deren Regex "cdp.*device" diesen Port sonst
                // faelschlich als Device-NAMEN (Nachbar) einsammeln wuerde.
                $lldp_ports[$hid][HostMetadata::ifaceParam($key)]['desc'] = (string) $val;
            } elseif (!empty($val) && (
                    $key === 'lldpRemSysName'
                 || $key === 'uplink.id'                          // UniFi Network API
                 || strpos($key, 'cdpCacheDeviceId')  !== false   // Cisco CDP
                 || strpos($key, 'neighbor.sysName')  !== false   // generisch / Ubiquiti
                 || strpos($key, 'discovery.neighbor') !== false  // MikroTik & andere
                 || preg_match('/(?:^|\.)(lldp.*sysname|cdp.*device)/i', $key)
                 )) {
                // uplink.id (UniFi Network API): KEIN Geraete-Protokoll wie LLDP/CDP,
                // sondern die Controller-Sicht — das Template holt per JSONPath
                // $.uplinkDeviceId "an welchem Geraet haenge ich". Der Wert ist die
                // UniFi-Geraete-UUID, und weil dasselbe Template seine Hosts nach
                // eben dieser UUID benennt, ist er zugleich der technische Hostname
                // des Uplink-Hosts → das bestehende Namens-Matching im
                // LldpEdgeBuilder loest ihn ohne Sonderlogik auf.
                // Quelle merken (lldp/cdp/unifi/other) — Frontend kann das anzeigen
                // oder zum Debuggen nutzen. Fuer den Match selber egal.
                $src = ($key === 'uplink.id')            ? 'unifi'
                    : ((strpos($key, 'cdp')  !== false)  ? 'cdp'
                    : ((strpos($key, 'lldp') !== false)  ? 'lldp' : 'other'));
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
            // §3 Port-zu-Port (Review „fehlende Funktionen" §3): per-Interface-
            // Traffic/-Speed nach ifIndex + Remote-Port je LLDP/CDP-SNMPINDEX.
            'port_traffic' => $port_traffic,
            'port_speed'   => $port_speed,
            'port_errors'   => $port_errors,
            'port_discards' => $port_discards,
            'lldp_ports'   => $lldp_ports,
            'lldp_meta'    => $lldp_meta,
        ];
    }

    /**
     * ifHighSpeed → bps. ifHighSpeed ist Mbps, ABER das Zabbix-Standard-Template
     * multipliziert per Preprocessing teils schon auf bps. Heuristik: < 1e7 = Mbps
     * (800G-Link = 8e5 Mbps), >= 1e7 = bereits bps (kleinster realer bps: 10M = 1e7).
     *
     * @return float bps, oder 0.0 bei nicht-positivem Wert.
     */
    /**
     * ifIndex aus einem Error-/Discard-Schluessel ziehen — oder '', wenn er
     * sich nicht bestimmen laesst.
     *
     * Zwei Formen kommen vor, beide im selben Indexraum wie beim Traffic
     * (ifIndex), damit sich Port-Metrik und LLDP-Port spaeter treffen:
     *
     *   ifInErrors[3]                       klassisch
     *   net.if.in.errors[ifInErrors.3]      Zabbix-7-SNMP-Templates
     *   net.if.in[ifHCInOctets.3,errors]    Variante mit Suffix im Parameter
     *
     * Findet sich keiner, bleibt es bei der Host-Summe. Ein GERATENER Index
     * waere schlimmer als keiner: die Zahl landete an der falschen Kante und
     * saehe dort aus wie eine Messung.
     */
    private static function ifIndexOf(string $key): string {
        if (preg_match('/(?:In|Out)(?:Errors|Discards)[.\[](\d+)/', $key, $m)) {
            return $m[1];
        }
        if (preg_match('/net\.if\.(?:in|out)\[[^\],]*[.\[](\d+)[^\],]*,\s*(?:errors|dropped)\]/', $key, $m)) {
            return $m[1];
        }
        return '';
    }

    private static function highSpeedBps($val): float {
        $sp = (float) $val;
        if ($sp <= 0) return 0.0;
        return $sp < 1.0e7 ? $sp * 1.0e6 : $sp;
    }
}
