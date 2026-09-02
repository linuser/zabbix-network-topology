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
     * @param array $lldp_meta     §5: hostid => [snmpindex => ['desc','caps','chassis']]
     *                             Zusatzangaben ueber den Nachbarn — nur bei NICHT
     *                             ueberwachten von Belang, dort ist sonst nur der
     *                             Name bekannt.
     *
     * @return array{edges: array, quality: array, unmatched: array}
     */
    public static function build(array $hosts, array $lldp_raw,
            array $lldp_ports = [], array $port_traffic = [], array $port_speed = [],
            array $lldp_meta = []): array {
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

        // Capabilities der GETROFFENEN Nachbarn: hostid → ['Bridge','Router',…].
        //
        // Bisher wurden die nur fuer Ghosts ausgewertet. Sie sind aber auch fuer
        // ueberwachte Hosts die beste Antwort auf "was ist das Geraet?" — und
        // zwar eine herstellerunabhaengige: IEEE 802.1AB, das Geraet sagt es
        // selbst. Eine Keyword-Liste pro Hersteller waere die Alternative, und
        // die veraltet schneller als man sie pflegt (allein Cisco hat neun
        // Templates, davon zwei Server).
        //
        // Gemeldet wird immer vom NACHBARN, nie vom Geraet selbst: Switch A
        // sagt, was B ist. Ein Geraet ohne ueberwachten Nachbarn taucht hier
        // deshalb nicht auf — dafuer gibt es die schwaechere Stufe "spricht
        // ueberhaupt LLDP".
        $host_caps = [];
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
                        // Zusatzangaben mitgeben, sofern das Template sie
                        // liefert. Ueber denselben SNMPINDEX wie der SysName —
                        // dieselbe Nachbar-Zeile in der lldpRemTable.
                        $entry = ['raw' => $neighbor_raw, 'src' => $src];
                        $midx  = HostMetadata::ifaceParam($item['key_']);
                        if ($midx !== '' && isset($lldp_meta[$rid][$midx])) {
                            $m = $lldp_meta[$rid][$midx];
                            if (($m['desc'] ?? '') !== '') {
                                // Auf eine Zeile kuerzen: SysDesc ist bei Cisco &
                                // Co. ein mehrzeiliger Absatz mit Copyright und
                                // Compile-Datum. Fuer "was ist das?" reicht der
                                // Anfang, und der Rest blaeht die Antwort auf.
                                $entry['desc'] = mb_substr(trim(preg_replace('/\s+/u', ' ', $m['desc'])), 0, 120);
                            }
                            if (($m['chassis'] ?? '') !== '') {
                                $entry['chassis'] = mb_substr(trim($m['chassis']), 0, 64);
                            }
                            $caps = self::decodeCaps($m['caps'] ?? '');
                            if ($caps) {
                                $entry['caps'] = $caps;
                            }
                        }
                        $lldp_quality[$rid]['unmatched'][] = $entry;
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

                // Capabilities des getroffenen Nachbarn merken — gleiche
                // Zeile der lldpRemTable wie der SysName, also gleicher Index.
                // Erster Melder gewinnt: sehen zwei Switches dasselbe Geraet,
                // sind die Angaben identisch; waeren sie es nicht, ist die
                // erste so gut wie jede andere.
                if (!isset($host_caps[$rhid])) {
                    $cidx = HostMetadata::ifaceParam($item['key_']);
                    if ($cidx !== '' && isset($lldp_meta[$rid][$cidx]['caps'])) {
                        $c = self::decodeCaps($lldp_meta[$rid][$cidx]['caps']);
                        if ($c) {
                            $host_caps[$rhid] = $c;
                        }
                    }
                }
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
                                // WER die Kante gemeldet hat, nicht nur DASS sie
                                // gemeldet wurde. Siehe den Kommentar am Ende der
                                // Schleife: daraus faellt die Unterscheidung
                                // "beidseitig bestaetigt" gegen "einseitig".
                                'reporters' => [(string) $rid => true],
                                'ports' => $ports,
                                'port_metrics' => $my_metrics !== null ? [(string) $rid => $my_metrics] : []];
                } else {
                    // Edge schon bekannt (z.B. von LLDP) — Source/Ports/Metrik
                    // ergaenzen, wenn jetzt CDP oder die Gegenseite dieselbe
                    // Verbindung meldet (merge-Logik, first-wins pro Feld).
                    $eidx = $seen_edges[$edge_key];
                    // Dieser Zweig WUSSTE schon immer, dass die Kante ein
                    // zweites Mal gemeldet wird — er hat es nur nie
                    // aufgeschrieben. Genau hier entsteht die Bestaetigung.
                    $edges[$eidx]['reporters'][(string) $rid] = true;
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
        //
        // Dasselbe fuer reporters — und daraus 'confirmed'. Eine Kante gilt als
        // beidseitig bestaetigt, wenn BEIDE Endpunkte einander gemeldet haben.
        //
        // ACHTUNG, die naheliegende Abkuerzung ist falsch: count(ports) === 2
        // beweist das NICHT. Ein einzelner Melder traegt beide Ports ein — den
        // eigenen lokalen (lldpRemLocalPortNum) und den vom Nachbarn gelernten
        // (lldpRemPortId/-Desc). Zwei Port-Eintraege sind also kein Beleg fuer
        // zwei Melder, und wer danach ginge, meldete praktisch jede Kante als
        // bestaetigt. Deshalb das explizite Set.
        foreach ($edges as &$_e) {
            if (isset($_e['src']) && is_array($_e['src'])) {
                $_e['src'] = array_keys($_e['src']);
                sort($_e['src']);
            }
            if (isset($_e['reporters']) && is_array($_e['reporters'])) {
                $_e['reporters'] = array_keys($_e['reporters']);
                sort($_e['reporters']);
                $_e['confirmed'] = count($_e['reporters']) >= 2;
            }
        }
        unset($_e);


        return [
            'edges'     => $edges,
            'quality'   => $lldp_quality,
            'unmatched' => $lldp_unmatched,
            'host_caps' => $host_caps,
        ];
    }

    /** Port-Label auf 24 Zeichen kappen (einheitlich fuer lokalen + Remote-Port). */
    private static function capLabel(string $s): string {
        return strlen($s) > 24 ? substr($s, 0, 24) : $s;
    }

    /**
     * lldpRemSysCapEnabled in lesbare Namen.
     *
     * Der Wert ist laut IEEE 802.1AB ein OCTET STRING mit zwei Bytes, dessen
     * Bits die Faehigkeiten tragen. Was davon in Zabbix ankommt, haengt am
     * Geraet UND am Template. An zwei echten Switches nachgesehen:
     *
     *   HP Instant On   "20 00", "28 00"          → rohe Hex-Bytes
     *   TP-Link         "Bridge", "WLAN Access Point" → schon aufgeloest
     *
     * Die zweite Form entsteht, wenn das Template eine Value-Map auf das Item
     * legt. Sie MUSS getrennt behandelt werden: als Hex gelesen ergibt
     * "Bridge" die Zeichen B, d, e, daraus 0xBD, daraus fuenf Faehigkeiten,
     * die nie gemeldet wurden — und aus einem Switch wird ein Access Point.
     * Das ist nicht nur falsch, es ist selbstbewusst falsch.
     *
     * Unterschieden wird an den Zeichen: reine Hex-Ziffern plus Leerraum → Hex,
     * alles andere → Text. Kein Faehigkeitsname besteht nur aus Hex-Ziffern,
     * die Unterscheidung ist also eindeutig.
     *
     * Bit-Reihenfolge nach lldpRemSysCapEnabled, hoechstwertiges Bit zuerst.
     */
    private static function decodeCaps(string $raw): array {
        $raw = trim($raw);
        if ($raw === '') {
            return [];
        }

        // ── Textform (Value-Map im Template) ────────────────────────────────
        if (!preg_match('/^[0-9a-fA-F\s]+$/', $raw)) {
            $hay   = strtolower($raw);
            $found = [];
            // Reihenfolge wie die Bits, damit die Ausgabe unabhaengig von der
            // Schreibweise des Geraets immer gleich sortiert ist.
            foreach ([
                'Repeater'  => ['repeater'],
                'Bridge'    => ['bridge'],
                'WLAN AP'   => ['wlan', 'access point'],
                'Router'    => ['router'],
                'Telephone' => ['telephone', 'phone'],
                'DOCSIS'    => ['docsis'],
                'Station'   => ['station'],
            ] as $name => $needles) {
                foreach ($needles as $n) {
                    if (strpos($hay, $n) !== false) {
                        $found[] = $name;
                        break;
                    }
                }
            }

            return $found;
        }

        // ── Hexform ─────────────────────────────────────────────────────────
        $hex = preg_replace('/[^0-9a-fA-F]/', '', $raw);

        if ($hex !== '' && strlen($hex) >= 2 && strlen($hex) <= 4) {
            $byte = hexdec(substr($hex, 0, 2));
        }
        elseif (strlen($raw) >= 1) {
            // Rohbytes: erstes Zeichen als Bitmaske deuten. Erreichbar nur
            // noch fuer Werte aus reinen Hex-Ziffern, deren Laenge nicht
            // passt — Text ist oben schon abgebogen.
            $byte = ord($raw[0]);
        }
        else {
            return [];
        }

        $bits = [
            0x40 => 'Repeater',
            0x20 => 'Bridge',
            0x10 => 'WLAN AP',
            0x08 => 'Router',
            0x04 => 'Telephone',
            0x02 => 'DOCSIS',
            0x01 => 'Station',
        ];

        $out = [];
        foreach ($bits as $mask => $name) {
            if ($byte & $mask) {
                $out[] = $name;
            }
        }

        return $out;
    }
}
