<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * LldpEdgeBuilder
 *
 * Dritter Schnitt der Data.php-Aufteilung (Review §6, dort "LldpParser").
 *
 * Baut aus den LLDP-/CDP-Nachbarmeldungen der Geraete die Kanten der Topologie.
 * Das ist die heikelste Zuordnung im ganzen Modul: ein Switch meldet einen
 * Nachbarn als Namen ("sw-core", "sw-core.fritz.box", "SW-CORE") und wir muessen
 * raten, WELCHER Zabbix-Host das ist — ueber technischen Namen, Anzeigenamen,
 * FQDN-Kuerzung und Gross-/Kleinschreibung hinweg. Faellt das Matching still auf
 * die Nase, fehlen Kanten und niemand merkt es: die Karte sieht nur "leerer" aus.
 *
 * Genau deshalb gehoert die Logik hier raus aus dem 1200-Zeilen-doAction() —
 * jetzt ist sie mit synthetischen Nachbarn testbar (siehe tests/).
 *
 * Rein: die Hosts + die rohen Nachbarmeldungen (+ optional Remote-Port- und
 * Per-Interface-Traffic-Maps). Raus: Kanten, Qualitaets-Statistik (was wurde
 * gematcht, was nicht) und die unmatched-Liste fuers Frontend. Kein API-Call,
 * kein Controller-Zustand.
 *
 * Urspruenglich reiner Struktur-Umbau aus Data.php; seit v4.35 zusaetzlich die
 * Port-zu-Port-Zuordnung (Review „fehlende Funktionen" §3): Remote-Port am
 * Nachbar-Ende (lldpRemPortId/-Desc, gleicher SNMPINDEX) und Per-Link-Traffic
 * am lokalen Port des Reporters (port_traffic[hostid][ifIndex]).
 */
final class LldpEdgeBuilder {

    /**
     * @param array $hosts         hostid => Host-Datensatz (mit 'host', 'name', ...)
     * @param array $lldp_raw      Roh-Nachbarmeldungen aus dem MetricExtractor
     * @param array $lldp_ports    §3: hostid => [snmpindex => ['id'?, 'desc'?]] (Remote-Port)
     * @param array $port_traffic  §3b: hostid => [ifIndex => ['in'=>bps,'out'=>bps]]
     * @param array $port_speed    §3b: hostid => [ifIndex => bps] (Auslastungs-Divisor)
     *
     * @return array{edges: array, quality: array, unmatched: array}
     */
    public static function build(array $hosts, array $lldp_raw,
            array $lldp_ports = [], array $port_traffic = [], array $port_speed = []): array {
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
        // LLDP-Quality-Sammlung: pro Host-Reporter detailliertere Statistik
        // fuer den Quality-Tab. Vereinheitlicht 4 Kategorien:
        //   matched / unmatched / ambiguous / self
        // Strukturierte Liste plus aggregat: { hostid → { matched: N, unmatched: [{raw,src}],
        //   ambiguous: [{raw,src,candidates:[hid]}], self_loops: N } }
        $lldp_quality = [];   // hostid → counters + lists
        $ensureQ = function($hid) use (&$lldp_quality) {
            if (!isset($lldp_quality[$hid])) {
                $lldp_quality[$hid] = ['matched' => 0, 'unmatched' => [], 'ambiguous' => [], 'self' => 0];
            }
        };

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
            // Wert kann komma-separierte Liste sein: "hv-01,SW-CORE-01".
            // CDP kann auch "\n"-separiert oder mit Pipe kommen.
            $neighbors = preg_split('/[,\n\r\|]+/', $item['lastvalue']);
            foreach ($neighbors as $neighbor_full) {
                // 0. Exact-Match auf den ROHEN Wert zuerst — SysNames/Visible-
                // Names mit Leerzeichen ("Core Switch 1") matchten bis v4.21.1
                // exakt; cleanNeighbor() wuerde sie am Leerzeichen zerschneiden
                // (Regression). Cleanup nur als Fallback fuer Vendor-Suffixe.
                $neighbor_full = trim((string) $neighbor_full);
                if ($neighbor_full === '') continue;
                $rhid = $name_map[strtolower($neighbor_full)] ?? null;
                if (!$rhid && isset($ip_map[$neighbor_full])) {
                    $rhid = $ip_map[$neighbor_full];
                }

                $neighbor_raw = $rhid ? $neighbor_full : $cleanNeighbor($neighbor_full);
                if ($neighbor_raw === '') continue;
                $lldp_val = strtolower($neighbor_raw);

                // 1. Exakter Match gegen cleaned host/visiblename/lowercase
                if (!$rhid) {
                    $rhid = $name_map[$lldp_val] ?? null;
                }

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

                // 3. Short-Hostname (O(1)-Lookup via Map) — unique vs ambiguous tracken
                $ambiguous_candidates = null;
                if (!$rhid) {
                    $lldp_short = explode('.', $lldp_val)[0];
                    $candidates = $short_name_map[$lldp_short] ?? [];
                    if (count($candidates) === 1) {
                        $rhid = array_key_first($candidates);
                    } elseif (count($candidates) > 1) {
                        // Ambiguous: Short-Name matched mehrere Hosts → fuer
                        // Quality-Tab merken, aber nicht als Edge anlegen
                        // (sonst zufaellige Zuordnung).
                        $ambiguous_candidates = array_keys($candidates);
                    }
                }

                $rid = $item['hostid'];
                $src = $item['src'] ?? 'other';
                $ensureQ($rid);
                if (!$rhid) {
                    if ($ambiguous_candidates !== null) {
                        $lldp_quality[$rid]['ambiguous'][] = [
                            'raw' => $neighbor_raw, 'src' => $src, 'candidates' => $ambiguous_candidates
                        ];
                    } else {
                        $lldp_quality[$rid]['unmatched'][] = ['raw' => $neighbor_raw, 'src' => $src];
                        $lldp_unmatched[] = $neighbor_raw . ' (from hostid=' . $rid . ', src=' . $src . ')';
                    }
                    continue;
                }
                if ($rhid === $rid) {
                    // Self-Loop ignorieren (Host meldet sich selbst als Nachbarn)
                    $lldp_quality[$rid]['self']++;
                    continue;
                }
                $lldp_quality[$rid]['matched']++;
                // Port-Label (Best-Effort): Bracket-Param des Reporter-Keys.
                // LLD-Keys wie lldpRemSysName[0.24.1] tragen den LLDP-MIB-
                // Index lldpRemTimeMark.lldpRemLocalPortNum.lldpRemIndex —
                // die Mitte ist der lokale Port des Reporters. Keys wie
                // lldp.rem.sysname[eth0] liefern den Namen direkt. Comma-
                // Listen-Items ohne Bracket haben keinen Port-Bezug → leer.
                // $idx = voller Index; korreliert Remote-Port + Traffic (§3).
                // Lokaler Port auf den ifIndex reduzieren: LLDP-Index ist
                // TimeMark.LocalPort.RemIndex (3-teilig, Mitte = Port), CDP-Index
                // ist cdpCacheIfIndex.devIndex (2-teilig, erster Teil = ifIndex).
                // Beide muessen auf den ifIndex zeigen, sonst verfehlt die
                // Traffic-Korrelation (port_traffic ist nach ifIndex gekeyt).
                $idx  = '';
                $port = '';
                if (strpos($item['key_'], '[') !== false) {
                    $idx  = HostMetadata::ifaceParam($item['key_']);
                    $port = $idx;
                    if (preg_match('/^\d+\.(\d+)\.\d+$/', $idx, $pm)) {
                        $port = $pm[1];            // LLDP: Mitte = lokaler Port
                    } elseif (preg_match('/^(\d+)\.\d+$/', $idx, $pm)) {
                        $port = $pm[1];            // CDP: erster Teil = ifIndex
                    }
                    $port = self::capLabel($port);
                }

                // §3 Remote-Port des Nachbarn: gleicher SNMPINDEX wie der SysName
                // (lldpRemPortId/-Desc bzw. cdpCacheDevicePort). PortDesc ("nic0",
                // "Gi1/0/8") gewinnt vor PortId, die laut PortIdSubtype eine MAC
                // sein kann. Ergibt das Port-Label am NACHBAR-Ende der Kante —
                // Port-zu-Port auch dann, wenn nur der Reporter ueberwacht ist.
                // trim() VOR dem Leer-Test, sonst gewinnt ein whitespace-only
                // PortDesc den Ternary und faellt NICHT auf die PortId zurueck.
                $remote_port = '';
                if ($idx !== '' && isset($lldp_ports[$rid][$idx])) {
                    $rp   = $lldp_ports[$rid][$idx];
                    $desc = trim((string) ($rp['desc'] ?? ''));
                    $remote_port = self::capLabel($desc !== '' ? $desc : trim((string) ($rp['id'] ?? '')));
                }

                // §3b Per-Link-Traffic am lokalen Port des Reporters. Setzt
                // lldpRemLocalPortNum == ifIndex voraus (auf Aruba/ProCurve 1:1);
                // passt es nicht, gibt es schlicht keinen Treffer → keine Metrik.
                $my_metrics = null;
                if ($port !== '' && isset($port_traffic[$rid][$port])) {
                    $pt = $port_traffic[$rid][$port];
                    $my_metrics = ['in' => round($pt['in']), 'out' => round($pt['out'])];
                    if (isset($port_speed[$rid][$port]) && $port_speed[$rid][$port] > 0) {
                        $my_metrics['speed'] = round($port_speed[$rid][$port]);
                    }
                }

                $pair = [(string) $rid, (string) $rhid];
                sort($pair);
                $edge_key = implode('-', $pair);
                if (!isset($seen_edges[$edge_key])) {
                    $seen_edges[$edge_key] = count($edges);
                    // ports: lokaler Port am Reporter-Ende + Remote-Port am
                    // Nachbar-Ende. Meldet die Gegenseite dieselbe Edge, ergaenzt
                    // der Merge-Zweig unten ihre Sicht (first-wins).
                    $ports = [];
                    if ($port !== '')        $ports[(string) $rid]  = $port;
                    if ($remote_port !== '') $ports[(string) $rhid] = $remote_port;
                    $edges[] = ['id' => 'e'.count($edges), 'from' => $rid,
                                'to' => $rhid, 'iface' => $item['key_'],
                                'src' => [$src => true],
                                'ports' => $ports,
                                'port_metrics' => $my_metrics !== null ? [(string) $rid => $my_metrics] : []];
                } else {
                    // Edge schon bekannt (z.B. von LLDP) — Source/Ports/Metrik
                    // ergaenzen, wenn jetzt CDP oder die Gegenseite dieselbe
                    // Verbindung meldet (merge-Logik, first-wins pro Feld).
                    $eidx = $seen_edges[$edge_key];
                    if (!isset($edges[$eidx]['src'][$src])) {
                        $edges[$eidx]['src'][$src] = true;
                    }
                    if ($port !== '' && !isset($edges[$eidx]['ports'][(string) $rid])) {
                        $edges[$eidx]['ports'][(string) $rid] = $port;
                    }
                    if ($remote_port !== '' && !isset($edges[$eidx]['ports'][(string) $rhid])) {
                        $edges[$eidx]['ports'][(string) $rhid] = $remote_port;
                    }
                    if ($my_metrics !== null && !isset($edges[$eidx]['port_metrics'][(string) $rid])) {
                        $edges[$eidx]['port_metrics'][(string) $rid] = $my_metrics;
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


        return [
            'edges'     => $edges,
            'quality'   => $lldp_quality,
            'unmatched' => $lldp_unmatched,
        ];
    }

    /** Port-Label auf 24 Zeichen kappen (einheitlich fuer lokalen + Remote-Port). */
    private static function capLabel(string $s): string {
        return strlen($s) > 24 ? substr($s, 0, 24) : $s;
    }
}
