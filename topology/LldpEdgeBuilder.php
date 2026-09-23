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
    /**
     * Obergrenze fuer LLDP/CDP-Kanten. NICHT gegen Unuebersichtlichkeit —
     * gegen einen PHP-Fatal.
     *
     * NACHGEMESSEN, nicht geschaetzt: der Kantenbau braucht rund 5,2 KB
     * Spitzenspeicher je Kante (400 Hosts / 9.600 Kanten -> 50 MB;
     * 800 / 19.200 -> 99 MB, linear dazwischen). Zabbix verlangt fuer das
     * Frontend mindestens 128 MB, und in diesem Prozess liegen daneben schon
     * die Host- und Item-Listen. Der erste Messlauf ist genau daran
     * gestorben: "Allowed memory size exhausted" — also eine WEISSE SEITE
     * ohne Meldung, mitten im Kartenaufbau.
     *
     * 8.000 Kanten sind rund 41 MB und lassen dem Rest Luft. Die Zahl ist
     * bewusst weit jenseits dessen, was eine lesbare Karte hat (die
     * Obergrenze fuer manuelle Verbindungen liegt bei 2.000): sie soll nie
     * greifen, und wenn doch, dann statt eines Absturzes.
     */
    private const MAX_EDGES = 8000;

    /**
     * Wie viele Kanten die Obergrenze verworfen hat. Wer eine gekappte Karte
     * bekommt, soll das ERFAHREN — eine stillschweigend unvollstaendige
     * Topologie ist schlimmer als gar keine, weil sie aussieht wie eine
     * vollstaendige. Dieselbe Ueberlegung wie bei ManualLinks.
     */
    private static int $truncated = 0;

    public static function lastTruncated(): int {
        return self::$truncated;
    }

    public static function build(array $hosts, array $lldp_raw,
            array $lldp_ports = [], array $port_traffic = [], array $port_speed = [],
            array $lldp_meta = [], array $port_errors = [], array $port_discards = [],
            array $port_names = [], array $rtt = [], array $port_status = []): array {
        // ── 5. LLDP EDGES ─────────────────────────────────────────────────
        self::$truncated = 0;

        $name_map = [];
        $ip_map   = [];
        // Namen, unter denen ein Host laut Tag nt:lldp auf dem DRAHT auftritt.
        // Der Name in Zabbix und der ausgesendete Name sind zwei Dinge, und wo
        // sie auseinanderlaufen, melden die Nachbarn etwas, das es in Zabbix
        // nicht gibt: ein Geist neben dem Host, den er meint. Eigene Map, damit
        // ein erklaerter Name einen ECHTEN Namen nie verdraengt.
        $alias_map = [];
        foreach ($hosts as $hid => $h) {
            $name_map[strtolower($h['host'])] = $hid;
            $name_map[strtolower($h['name'])] = $hid;
            foreach ($h['nt_aliases'] ?? [] as $alias) {
                $alias = strtolower(trim((string) $alias));
                if ($alias !== '') {
                    $alias_map[$alias][(string) $hid] = $hid;
                }
            }
            foreach ($h['interfaces'] ?? [] as $iface) {
                if (!empty($iface['ip'])) {
                    // KANDIDATENLISTE, nicht Ueberschreiben. Dieselbe private
                    // Adresse kommt bei mehreren Kunden vor — 192.168.1.1 steht
                    // in jedem zweiten Netz. Bis 5.3.1 gewann hier der zuletzt
                    // eingelesene Host, still: der Melder bekam eine Kante zu
                    // einem fremden Mandanten, mit 60 Punkten Sicherheit und
                    // ohne einen Hinweis im Qualitaets-Tab. Gemeldet von einem
                    // Dienstleister mit mehreren Kunden auf einer Karte (#14).
                    $ip_map[$iface['ip']][(string) $hid] = $hid;
                }
            }
        }
        // Kurzform der erklaerten Namen: ein Nachbar kann denselben Namen mit
        // einer anderen Domain melden als der, die im Tag steht.
        $alias_short_map = [];
        foreach ($alias_map as $alias => $hids) {
            $kurz = explode('.', (string) $alias)[0];
            foreach ($hids as $ahid) {
                $alias_short_map[$kurz][(string) $ahid] = $ahid;
            }
        }

        // Einen erklaerten Namen auf EINEN Host aufloesen. Gleiche Regel wie bei
        // der IP: mehrere Anspruchsteller heisst keine Kante, sondern eine
        // Meldung im Qualitaets-Tab. Zwei Hosts, die denselben Namen fuer sich
        // beanspruchen, sind ein Konfigurationsfehler, und ihn zu raten hiesse,
        // die Haelfte der Faelle falsch zu zeichnen.
        $aliasTreffer = static function (string $name, bool $kurz = false)
                use ($alias_map, $alias_short_map): array {
            $name = strtolower($name);
            $kandidaten = $kurz
                ? ($alias_short_map[explode('.', $name)[0]] ?? [])
                : ($alias_map[$name] ?? []);
            if (count($kandidaten) === 1) {
                return [reset($kandidaten), null];
            }
            if (count($kandidaten) > 1) {
                return [null, array_values($kandidaten)];
            }
            return [null, null];
        };

        // Eine IP auf EINEN Host aufloesen. Gibt [hostid, null] bei genau einem
        // Kandidaten, [null, [hostids]] bei mehreren und [null, null] wenn die
        // Adresse unbekannt ist. Mehrdeutig heisst: keine Kante. Dieselbe Regel
        // wie beim Kurznamen — eine falsche Kante ist schlimmer als eine
        // fehlende, weil sie wie eine Messung aussieht.
        $ipTreffer = static function (string $ip) use ($ip_map): array {
            $kandidaten = $ip_map[$ip] ?? [];
            if (count($kandidaten) === 1) {
                return [reset($kandidaten), null];
            }
            if (count($kandidaten) > 1) {
                return [null, array_values($kandidaten)];
            }
            return [null, null];
        };

        // Short-Name-Map einmal vorberechnen statt pro Edge linear durch
        // alle name_map-Eintraege zu iterieren. Bei 500 Hosts × 500 LLDP-
        // Neighbors war das vorher 250k Vergleiche.
        // (string) ist Pflicht, kein Zierrat: PHP macht aus einem numerischen
        // Array-Schluessel ein int. Ein Host, der schlicht "192" oder "42"
        // heisst, liefert hier also eine Zahl, und explode() wirft unter PHP 8
        // einen TypeError — die Karte waere eine weisse Seite. Gefunden beim
        // Test zur doppelt vergebenen IP, nicht im Feld.
        $short_name_map = [];   // short → [hid, ...]
        foreach ($name_map as $mapped_name => $mapped_hid) {
            $short = explode('.', (string) $mapped_name)[0];
            $short_name_map[$short][$mapped_hid] = true;
        }

        $edges          = [];
        // Host pair "a-b" => list of edge indices. One entry per physical
        // link: a LAG or a set of parallel cables is SEVERAL edges between
        // the same two hosts, not one. See findMember().
        $seen_edges     = [];
        // Per edge index: hostid => [port key => true], and the set of
        // "reporter|protocol" that already reported it. Internal only.
        $member_keys    = [];
        $member_rep     = [];
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

        // ── Durchgang 1: jede gemeldete Zeile einem Host zuordnen ─────────────
        //
        // ZWEI DURCHGAENGE STATT EINEM, seit Nachbarn auch ueber MAC und Port
        // aufgeloest werden. Beides braucht das GESAMTBILD: welche Chassis-ID
        // zu welchem Host gehoert, weiss man erst, wenn ein anderer Melder
        // denselben Host mit Namen UND Chassis-ID genannt hat — und welcher
        // Host am anderen Ende eines Kabels steckt, erst, wenn dessen eigene
        // Meldung gelesen ist. Beides kann in $lldp_raw spaeter kommen.
        $rows = [];
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
                $match_kind = '';
                $ip_mehrdeutig = null;
                $alias_mehrdeutig = null;
                $rhid = $name_map[strtolower($neighbor_full)] ?? null;
                if ($rhid) $match_kind = 'exact';
                if (!$rhid) {
                    [$treffer, $mehrere] = $aliasTreffer($neighbor_full);
                    if ($treffer !== null) {
                        $rhid = $treffer;
                        $match_kind = 'alias';
                    } elseif ($mehrere !== null) {
                        $alias_mehrdeutig = $mehrere;
                    }
                }
                if (!$rhid) {
                    [$treffer, $mehrere] = $ipTreffer($neighbor_full);
                    if ($treffer !== null) {
                        $rhid = $treffer;
                        $match_kind = 'ip';
                    } elseif ($mehrere !== null) {
                        $ip_mehrdeutig = $mehrere;
                    }
                }

                // MAC STATT NAME. Manche Geraete nennen ihren Nachbarn nicht
                // beim Namen, sondern bei seiner Basis-MAC — als Bytefolge, die
                // Zabbix als "02 5E 10 00 00 01" liefert. cleanNeighbor() schnitt
                // die am ersten Leerzeichen ab, uebrig blieb das erste Byte.
                // Gemeldet aus dem Feld: ein Geisterknoten aus zwei Hex-Ziffern
                // mit denselben Kanten wie der Core-Switch. Schlimmer als der falsche Name war die Folge:
                // ALLE Geraete, deren MAC mit demselben Byte beginnt, fielen in
                // EINEN Geist zusammen — ein Verteiler, den es nicht gibt, mit
                // Kanten zu Switches, die nichts miteinander zu tun haben.
                $mac = $rhid ? null : self::macForm($neighbor_full);

                $neighbor_raw = $rhid ? $neighbor_full
                    : ($mac !== null ? $mac : $cleanNeighbor($neighbor_full));
                if ($neighbor_raw === '') continue;
                $lldp_val = strtolower($neighbor_raw);

                // Eine MAC ist kein Name: die Namensstufen 1-3 duerfen sie
                // nicht sehen. Ein Host, der zufaellig "02" heisst, waere sonst
                // ein Kurznamen-Treffer.
                $ambiguous_candidates = null;
                if ($mac === null) {
                    // 1. Exakter Match gegen cleaned host/visiblename/lowercase
                    if (!$rhid) {
                        $rhid = $name_map[$lldp_val] ?? null;
                        if ($rhid) $match_kind = 'exact_clean';
                    }

                    // 1b. Erklaerter Name, jetzt gegen die bereinigte Form —
                    //     ein Nachbar kann den Namen mit Domain melden.
                    if (!$rhid) {
                        [$treffer, $mehrere] = $aliasTreffer($neighbor_raw);
                        if ($treffer !== null) {
                            $rhid = $treffer;
                            $match_kind = 'alias';
                        } elseif ($mehrere !== null) {
                            $alias_mehrdeutig = $mehrere;
                        }
                    }

                    // 1c. Erklaerter Name als Kurzform — der Nachbar meldet
                    //     denselben Namen mit einer anderen Domain.
                    if (!$rhid && $alias_mehrdeutig === null) {
                        [$treffer, $mehrere] = $aliasTreffer($neighbor_raw, true);
                        if ($treffer !== null) {
                            $rhid = $treffer;
                            $match_kind = 'alias';
                        } elseif ($mehrere !== null) {
                            $alias_mehrdeutig = $mehrere;
                        }
                    }

                    // 2. IP-Match (auch falls Klammern/Praefix entfernt wurden)
                    if (!$rhid) {
                        [$treffer, $mehrere] = $ipTreffer($neighbor_raw);
                        if ($treffer !== null) {
                            $rhid = $treffer;
                            $match_kind = 'ip';
                        } elseif ($mehrere !== null) {
                            $ip_mehrdeutig = $mehrere;
                        }
                    }

                    // 2b. reverse-DNS-Pattern wie "ip-10-0-0-5" oder "host-10-0-0-5"
                    //     → extrahiere die IP und versuche IP-Match
                    if (!$rhid && preg_match('/(?:^|[-_])(\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3})/', $lldp_val, $mm)) {
                        $extracted_ip = str_replace('-', '.', $mm[1]);
                        [$treffer, $mehrere] = $ipTreffer($extracted_ip);
                        if ($treffer !== null) {
                            $rhid = $treffer;
                            $match_kind = 'ip_derived';
                        } elseif ($mehrere !== null) {
                            $ip_mehrdeutig = $mehrere;
                        }
                    }

                    // 3. Short-Hostname (O(1)-Lookup via Map) — unique vs ambiguous tracken
                    //
                    // Eine mehrdeutige IP bricht hier ab: "192.168.1.10" wuerde
                    // sonst auf den Kurznamen "192" zurueckfallen und bei einem
                    // Host dieses Namens zufaellig treffen.
                    if (!$rhid && $alias_mehrdeutig !== null) {
                        $ambiguous_candidates = $alias_mehrdeutig;
                    }
                    if (!$rhid && $ambiguous_candidates === null && $ip_mehrdeutig !== null) {
                        $ambiguous_candidates = $ip_mehrdeutig;
                    }
                    if (!$rhid && $ambiguous_candidates === null) {
                        $lldp_short = explode('.', $lldp_val)[0];
                        $candidates = $short_name_map[$lldp_short] ?? [];
                        if (count($candidates) === 1) {
                            $rhid = array_key_first($candidates);
                            $match_kind = 'short';
                        } elseif (count($candidates) > 1) {
                            // Ambiguous: Short-Name matched mehrere Hosts → fuer
                            // Quality-Tab merken, aber nicht als Edge anlegen
                            // (sonst zufaellige Zuordnung).
                            $ambiguous_candidates = array_keys($candidates);
                        }
                    }
                }

                if (!$rhid && $ambiguous_candidates === null) {
                    $ambiguous_candidates = $alias_mehrdeutig ?? $ip_mehrdeutig;
                }

                $rid = $item['hostid'];
                $rows[] = [
                    'item'      => $item,
                    'rid'       => $rid,
                    'rhid'      => $rhid,
                    'match'     => $match_kind,
                    'raw'       => $neighbor_raw,
                    'mac'       => $mac !== null,
                    'ambiguous' => $ambiguous_candidates,
                    'ctx'       => self::portContext($item, (string) $rid, $lldp_ports, $port_names),
                ];
            }
        }

        self::resolveByChassis($rows, $lldp_meta);
        self::resolveByPort($rows, $port_names);

        // ── Durchgang 2: Kanten, Qualitaet, Geister ───────────────────────────
        foreach ($rows as $row) {
            $item                 = $row['item'];
            $rid                  = $row['rid'];
            $rhid                 = $row['rhid'];
            $match_kind           = $row['match'];
            $neighbor_raw         = $row['raw'];
            $ambiguous_candidates = $row['ambiguous'];
            [$idx, $port, $port_idx, $remote_port] = $row['ctx'];
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
            // (string)-Vergleich, NICHT ===.
            //
            // $hosts kommt aus API::Host()->get([...'preservekeys' => true]),
            // und PHP normalisiert numerische Array-Schluessel zu int. $rhid
            // ist damit 10084, waehrend $rid = $item['hostid'] der rohe
            // API-String "10084" ist. Ein striktes === war immer falsch:
            // der Self-Loop wurde nie erkannt, ein Host der sich selbst
            // meldet bekam eine echte Schleifen-Kante, und die "self"-Spalte
            // im LLDP-Q-Tab stand auf JEDER Installation auf null.
            //
            // Im Test faellt das nicht auf, weil die Host-IDs dort
            // 'h1'/'aruba' heissen — nicht numerisch, also keine
            // Normalisierung, also stimmen die Typen zufaellig ueberein.
            if ((string) $rhid === (string) $rid) {
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

            // §3b Per-Link-Traffic am lokalen Port des Reporters. Setzt
            // lldpRemLocalPortNum == ifIndex voraus (auf Aruba/ProCurve 1:1);
            // passt es nicht, gibt es schlicht keinen Treffer → keine Metrik.
            // Nicht mehr nur an $port_traffic gebunden: Errors und Discards
            // koennen vorliegen, wo kein Traffic-Item existiert, und
            // umgekehrt. Frueher fiel dann alles weg, weil der Traffic den
            // Einstieg bildete.
            // ACHTUNG: ab hier der INDEX, nicht das Label. Seit der Port
            // einen Namen tragen kann, sind die beiden verschieden — und
            // port_traffic/-speed/-errors sind nach ifIndex gekeyt. Mit dem
            // Label gesucht faende man nichts mehr, und zwar still: es gaebe
            // schlicht keine Per-Link-Metrik mehr.
            $pidx = $port_idx ?? $port;
            $my_metrics = null;
            if ($pidx !== '') {
                if (isset($port_traffic[$rid][$pidx])) {
                    $pt = $port_traffic[$rid][$pidx];
                    $my_metrics = ['in' => round($pt['in']), 'out' => round($pt['out'])];
                }
                if (isset($port_speed[$rid][$pidx]) && $port_speed[$rid][$pidx] > 0) {
                    $my_metrics ??= [];
                    $my_metrics['speed'] = round($port_speed[$rid][$pidx]);
                }
                // Errors/Discards AN DIESEM PORT — nicht die Host-Summe.
                // Der Unterschied ist der ganze Punkt: ein Switch mit einem
                // defekten Uplink traegt sonst an jeder seiner Kanten
                // dieselbe Fehlerrate.
                if (isset($port_errors[$rid][$pidx])) {
                    $my_metrics ??= [];
                    $my_metrics['errors'] = round((float) $port_errors[$rid][$pidx], 3);
                }
                if (isset($port_discards[$rid][$pidx])) {
                    $my_metrics ??= [];
                    $my_metrics['discards'] = round((float) $port_discards[$rid][$pidx], 3);
                }
                // Zustand DIESES Ports. Die Kantenfarbe soll sich daran halten
                // und nicht an der Hostsumme ueber alle Interfaces.
                if (isset($port_status[$rid][$pidx])) {
                    $my_metrics ??= [];
                    $my_metrics['down'] = (bool) $port_status[$rid][$pidx];
                }
            }

            // Den gemeldeten Nachbar-Port auf ein Interface DES NACHBARN
            // aufloesen. Gelingt es, hat die Kante Messwerte an beiden
            // Enden — und die Aufloesung belegt zugleich, dass der
            // gemeldete Port auf dem vermuteten Host existiert.
            $far_metrics = null;
            $port_match  = '';
            $fidx        = '';
            if ($remote_port !== '' && !empty($port_names[$rhid])) {
                $auf = self::resolveRemotePort($remote_port, $port_names[$rhid]);
                if ($auf !== null) {
                    [$fidx, $port_match] = $auf;
                    if (isset($port_traffic[$rhid][$fidx])) {
                        $ft = $port_traffic[$rhid][$fidx];
                        $far_metrics = ['in' => round($ft['in']), 'out' => round($ft['out'])];
                    }
                    if (isset($port_speed[$rhid][$fidx]) && $port_speed[$rhid][$fidx] > 0) {
                        $far_metrics ??= [];
                        $far_metrics['speed'] = round($port_speed[$rhid][$fidx]);
                    }
                    if (isset($port_errors[$rhid][$fidx])) {
                        $far_metrics ??= [];
                        $far_metrics['errors'] = round((float) $port_errors[$rhid][$fidx], 3);
                    }
                    if (isset($port_discards[$rhid][$fidx])) {
                        $far_metrics ??= [];
                        $far_metrics['discards'] = round((float) $port_discards[$rhid][$fidx], 3);
                    }
                    if (isset($port_status[$rhid][$fidx])) {
                        $far_metrics ??= [];
                        $far_metrics['down'] = (bool) $port_status[$rhid][$fidx];
                    }
                    // Der Name, den der Nachbar SELBST fuer diesen Port fuehrt,
                    // schlaegt den angekuendigten Text: "Gi1/0/9" ist brauchbarer
                    // als "Port 9", und es ist seine eigene Auskunft statt der des
                    // Gegenuebers.
                    if (($port_names[$rhid][$fidx] ?? '') !== '') {
                        $remote_port = self::capLabel((string) $port_names[$rhid][$fidx]);
                    }
                }
            }

            $pair = [(string) $rid, (string) $rhid];
            sort($pair);
            $edge_key = implode('-', $pair);
            // Obergrenze NUR fuer NEUE Kanten. Der Merge-Zweig unten
            // ergaenzt eine bereits bekannte Kante um Quelle, Ports und
            // Metrik — das kostet keinen nennenswerten Speicher und macht
            // die Kanten, die wir behalten, VOLLSTAENDIGER. Hier
            // abzubrechen wuerde also nichts sparen und stattdessen
            // halbfertige Kanten hinterlassen.
            $lkeys = self::portKeys($port, $port_idx);
            $rkeys = self::portKeys($remote_port, $fidx);
            $eidx  = self::findMember($seen_edges[$edge_key] ?? [], $member_keys, $member_rep,
                                      (string) $rid, (string) $rhid, $src, $lkeys, $rkeys);
            if ($eidx === null && count($edges) >= self::MAX_EDGES) {
                self::$truncated++;
                continue;
            }
            if ($eidx === null) {
                $eidx = count($edges);
                $seen_edges[$edge_key][] = $eidx;
                $member_keys[$eidx] = [(string) $rid => $lkeys, (string) $rhid => $rkeys];
                $member_rep[$eidx]  = [(string) $rid . '|' . $src => true];
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
                            'match' => $match_kind,
                            'port_match' => $port_match,
                            'ports' => $ports,
                            // Der ifIndex des Reporter-Ports. Das LABEL
                            // kann sich aendern, ohne dass jemand ein Kabel
                            // angefasst hat — faellt das ifName-Item aus,
                            // steht dort wieder die nackte Zahl. Der Index
                            // ist stabil und deshalb die richtige Groesse
                            // fuer den Vergleich zweier Staende.
                            'port_idx' => $port_idx !== '' ? [(string) $rid => $port_idx] : [],
                            'port_metrics' => array_filter([
                                (string) $rid  => $my_metrics,
                                (string) $rhid => $far_metrics,
                            ], static fn($v) => $v !== null)];
            } else {
                // Edge schon bekannt (z.B. von LLDP) — Source/Ports/Metrik
                // ergaenzen, wenn jetzt CDP oder die Gegenseite dieselbe
                // Verbindung meldet (merge-Logik, first-wins pro Feld).
                $member_keys[$eidx][(string) $rid]  = ($member_keys[$eidx][(string) $rid] ?? []) + $lkeys;
                $member_keys[$eidx][(string) $rhid] = ($member_keys[$eidx][(string) $rhid] ?? []) + $rkeys;
                $member_rep[$eidx][(string) $rid . '|' . $src] = true;
                // Dieser Zweig WUSSTE schon immer, dass die Kante ein
                // zweites Mal gemeldet wird — er hat es nur nie
                // aufgeschrieben. Genau hier entsteht die Bestaetigung.
                $edges[$eidx]['reporters'][(string) $rid] = true;
                // Beste Match-Art gewinnt, nicht die erste: melden beide
                // Seiten, hat womoeglich nur eine den Namen exakt getroffen
                // — und dann ist die Kante so sicher wie ihr BESTER Beleg,
                // nicht so unsicher wie ihr schlechtester.
                if (self::matchRank($match_kind) > self::matchRank($edges[$eidx]['match'] ?? '')) {
                    $edges[$eidx]['match'] = $match_kind;
                }
                if (!isset($edges[$eidx]['src'][$src])) {
                    $edges[$eidx]['src'][$src] = true;
                }
                // Der EIGENE lokale Port ueberschreibt, was die Gegenseite
                // ueber ihn behauptet hat. Bisher gewann, was zuerst eintraf —
                // auf einer Kante stand dann "29" (roher ifIndex des Melders)
                // und "Port 9" (Text des Nachbarn), und es sah aus, als kenne
                // das Modul nur eine Seite. Gemeldet mit Screenshot.
                // Seit es mehrere Kanten je Hostpaar gibt, ist "die Kante"
                // aber nicht mehr eindeutig: findMember() ordnet in Regel 3
                // zu, OHNE die Ports vergleichen zu koennen. Traegt die Kante
                // fuer uns bereits einen anderen eigenen ifIndex, ist das ein
                // anderes Kabel desselben Buendels — und das Ueberschreiben
                // wuerde unser Label auf das falsche Mitglied stempeln.
                // Indizes vergleichen sich verlaesslich, Labels nicht; ohne
                // Index auf einer der beiden Seiten bleibt es deshalb beim
                // bereits belegten Namen.
                $eigen_idx = (string) ($edges[$eidx]['port_idx'][(string) $rid] ?? '');
                $selber_port = $eigen_idx === '' || $eigen_idx === $port_idx;
                if ($port !== '' && $selber_port) {
                    $edges[$eidx]['ports'][(string) $rid] = $port;
                }
                if ($port_idx !== '' && !isset($edges[$eidx]['port_idx'][(string) $rid])) {
                    $edges[$eidx]['port_idx'][(string) $rid] = $port_idx;
                }
                if ($remote_port !== '' && !isset($edges[$eidx]['ports'][(string) $rhid])) {
                    $edges[$eidx]['ports'][(string) $rhid] = $remote_port;
                }
                if ($my_metrics !== null && !isset($edges[$eidx]['port_metrics'][(string) $rid])) {
                    $edges[$eidx]['port_metrics'][(string) $rid] = $my_metrics;
                }
                if ($far_metrics !== null && !isset($edges[$eidx]['port_metrics'][(string) $rhid])) {
                    $edges[$eidx]['port_metrics'][(string) $rhid] = $far_metrics;
                }
                // Ein EXAKTER Porttreffer schlaegt einen normalisierten.
                if ($port_match === 'exact'
                        || ($port_match === 'normalized' && ($edges[$eidx]['port_match'] ?? '') === '')) {
                    $edges[$eidx]['port_match'] = $port_match;
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
                $_e['confidence'] = self::confidence($_e, $hosts, $rtt);
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

    /**
     * Ist der gemeldete Nachbar eine MAC-Adresse? Liefert sie in einer
     * einheitlichen Form ("02:5E:10:00:00:01") oder null.
     *
     * Erkannt werden die Schreibweisen, die tatsaechlich ankommen:
     *
     *   "02 5E 10 00 00 01"   Bytefolge — so gibt Zabbix einen OCTET STRING
     *                         aus, der kein druckbarer Text ist
     *   "02:5e:10:00:00:01"   "02-5e-10-00-00-01"
     *   "025e.1000.0001"      Cisco
     *   "025e10000001"
     *
     * Die einheitliche Form ist der Punkt: dasselbe Geraet, von einem Switch
     * als Bytefolge und vom anderen mit Doppelpunkten gemeldet, wird EIN
     * Geist und nicht zwei.
     */
    private static function macForm(string $s): ?string {
        $s = trim($s);
        if (preg_match('/^(?:0x)?([0-9a-f]{12})$/i', $s, $m)) {
            $hex = $m[1];
        } elseif (preg_match('/^([0-9a-f]{2})([ :-])([0-9a-f]{2})\2([0-9a-f]{2})\2([0-9a-f]{2})\2([0-9a-f]{2})\2([0-9a-f]{2})$/i', $s, $m)) {
            $hex = $m[1] . $m[3] . $m[4] . $m[5] . $m[6] . $m[7];
        } elseif (preg_match('/^([0-9a-f]{4})\.([0-9a-f]{4})\.([0-9a-f]{4})$/i', $s, $m)) {
            $hex = $m[1] . $m[2] . $m[3];
        } else {
            return null;
        }
        return implode(':', str_split(strtoupper($hex), 2));
    }

    /**
     * Taugt diese MAC als Identitaet? 00:00:00:00:00:00 und FF:FF:FF:FF:FF:FF
     * melden Geraete, die ihre eigene nicht kennen — viele verschiedene
     * Geraete koennen sie tragen, eine Zuordnung darueber waere geraten.
     */
    private static function macUsable(?string $mac): bool {
        return $mac !== null && $mac !== '00:00:00:00:00:00' && $mac !== 'FF:FF:FF:FF:FF:FF';
    }

    /** Chassis-ID der Zeile aus lldpRemChassisId, sofern sie eine MAC ist. */
    private static function rowChassis(array $row, array $lldp_meta): ?string {
        $cidx = HostMetadata::ifaceParam($row['item']['key_'] ?? '');
        if ($cidx === '') {
            return null;
        }
        $raw = (string) ($lldp_meta[$row['rid']][$cidx]['chassis'] ?? '');
        $mac = $raw === '' ? null : self::macForm($raw);
        return self::macUsable($mac) ? $mac : null;
    }

    /**
     * Nicht zugeordnete Zeilen ueber die Chassis-ID aufloesen.
     *
     * Die Chassis-ID ist die einzige STABILE Kennung, die LLDP ueber einen
     * Nachbarn liefert. Welche davon zu welchem Host gehoert, lernen wir von
     * den Zeilen, die ueber den NAMEN sicher getroffen haben und die
     * Chassis-ID mitbringen. Meldet ein anderer Switch dasselbe Geraet nur per
     * MAC — oder unter einem alten Namen —, ist es damit trotzdem erkannt.
     *
     * Nur sichere Namenstreffer lehren eine Chassis-ID. Ein Kurznamen-Treffer
     * kann danebenliegen, und ein Fehler hier vervielfaeltigt sich: jede
     * weitere Meldung dieser MAC landete am falschen Host.
     *
     * Beanspruchen zwei Hosts dieselbe MAC (Stacks, HA-Paare mit geteilter
     * Adresse), wird sie gar nicht verwendet.
     */
    private static function resolveByChassis(array &$rows, array $lldp_meta): void {
        $sicher = ['exact' => true, 'exact_clean' => true, 'ip' => true];
        $map = [];   // MAC => hostid, oder null bei Widerspruch
        foreach ($rows as $r) {
            if (!$r['rhid'] || !isset($sicher[$r['match']])) {
                continue;
            }
            $mac = self::rowChassis($r, $lldp_meta);
            if ($mac === null) {
                continue;
            }
            if (!array_key_exists($mac, $map)) {
                $map[$mac] = $r['rhid'];
            } elseif ($map[$mac] !== null && (string) $map[$mac] !== (string) $r['rhid']) {
                $map[$mac] = null;
            }
        }
        if (!$map) {
            return;
        }
        foreach ($rows as &$r) {
            if ($r['rhid'] || $r['ambiguous'] !== null) {
                continue;
            }
            $kandidaten = [
                ($r['mac'] && self::macUsable($r['raw'])) ? $r['raw'] : null,
                self::rowChassis($r, $lldp_meta),
            ];
            foreach ($kandidaten as $mac) {
                if ($mac !== null && ($map[$mac] ?? null) !== null) {
                    $r['rhid']  = $map[$mac];
                    $r['match'] = 'chassis';
                    break;
                }
            }
        }
        unset($r);
    }

    /**
     * Nicht zugeordnete MAC-Zeilen ueber das KABEL aufloesen.
     *
     * Beide Enden einer Verbindung melden ihren Port. Sagt der Core "an mir
     * haengt sw-access, dort auf Port 48" und sagt sw-access "an meinem Port
     * 48 haengt 02:5E:10:…", dann beschreiben beide dasselbe Kabel — und die
     * MAC ist der Core. Gemeldet aus dem Feld: Access-Switches, die ihren Core
     * nur per MAC nennen, waehrend der Core sie mit Namen meldet. Jede
     * Verbindung stand doppelt auf der Karte, einmal richtig und einmal zu
     * einem Geist.
     *
     * Das braucht keine Daten, die wir nicht schon haben, und haengt an keiner
     * Schreibweise eines Namens — nur daran, dass der Port auf beiden Seiten
     * derselbe ist.
     *
     * DREI BEDINGUNGEN, SONST NICHTS
     *
     *   * Nur Zeilen, die eine MAC melden. Eine Zeile mit einem NAMEN, der auf
     *     keinen Host passt, ist ein anderes Geraet — der Port-Treffer waere
     *     dann ein Widerspruch, keine Bestaetigung.
     *   * Der Port des Melders traegt genau EINE Nachbarzeile. Sieht ein Port
     *     mehrere Nachbarn (ein nicht verwalteter Switch dazwischen), ist
     *     nicht zu sagen, welche Zeile welches Geraet ist.
     *   * Genau EIN Host meldet diesen Port als Gegenstelle.
     */
    private static function resolveByPort(array &$rows, array $port_names): void {
        // Wer meldet welchen Port welches Hosts als Gegenstelle?
        //   "<host>|i:<ifIndex>" — aufgeloest auf ein Interface des Hosts
        //   "<host>|n:<portname>" — nur der normalisierte Name
        $gegenstelle = [];
        foreach ($rows as $r) {
            if (!$r['rhid']) {
                continue;
            }
            $rp = $r['ctx'][3];
            if ($rp === '') {
                continue;
            }
            $ziel = (string) $r['rhid'];
            if (!empty($port_names[$ziel])) {
                $auf = self::resolveRemotePort($rp, $port_names[$ziel]);
                if ($auf !== null) {
                    $gegenstelle[$ziel . '|i:' . $auf[0]][(string) $r['rid']] = $r['rid'];
                }
            }
            $gegenstelle[$ziel . '|n:' . self::normPort($rp)][(string) $r['rid']] = $r['rid'];
        }

        $schluessel = static function (array $r): array {
            $melder = (string) $r['rid'];
            return [
                $r['ctx'][2] !== '' ? $melder . '|i:' . $r['ctx'][2] : '',
                $r['ctx'][1] !== '' ? $melder . '|n:' . self::normPort($r['ctx'][1]) : '',
            ];
        };

        // Was haengt sonst noch an diesem Port? Zwei Zahlen je Port:
        //   offen    — Zeilen ohne Zuordnung (die MAC selbst zaehlt mit)
        //   zu       — Hosts, auf die andere Zeilen dieses Ports zeigen
        $offen = [];
        $zu    = [];
        foreach ($rows as $r) {
            foreach ($schluessel($r) as $k) {
                if ($k === '') {
                    continue;
                }
                if ($r['rhid']) {
                    $zu[$k][(string) $r['rhid']] = $r['rhid'];
                } else {
                    $offen[$k] = ($offen[$k] ?? 0) + 1;
                }
            }
        }

        foreach ($rows as &$r) {
            if ($r['rhid'] || !$r['mac'] || $r['ambiguous'] !== null) {
                continue;
            }
            foreach ($schluessel($r) as $k) {
                if ($k === '') {
                    continue;
                }
                // Zwei offene Zeilen am selben Port: welche welches Geraet ist,
                // steht nirgends. Das passiert mit einem nicht verwalteten
                // Switch dazwischen.
                if (($offen[$k] ?? 0) !== 1) {
                    continue;
                }
                $andere = $zu[$k] ?? [];

                // 1. DERSELBE PORT MELDET DEN HOST SCHON MIT NAMEN.
                //
                // Aruba-Switches beantworten die CDP-Nachbartabelle mit der MAC
                // des Nachbarn, waehrend dieselbe Verbindung ueber LLDP einen
                // sauberen Namen traegt. Beide Zeilen haengen am selben lokalen
                // Port — also ist es dasselbe Kabel und dasselbe Geraet.
                // Gemeldet mit Screenshot: die Karte zeigte die Verbindung zum
                // Core und daneben einen Geist aus zwei Hex-Ziffern.
                if (count($andere) === 1) {
                    $host = reset($andere);
                    if ((string) $host !== (string) $r['rid']) {
                        $r['rhid']  = $host;
                        $r['match'] = 'port';
                        break;
                    }
                    continue;
                }
                if ($andere !== []) {
                    // Mehrere verschiedene Hosts an diesem Port — nichts raten.
                    continue;
                }

                // 2. DAS ANDERE KABELENDE MELDET DIESEN PORT.
                if (!isset($gegenstelle[$k]) || count($gegenstelle[$k]) !== 1) {
                    continue;
                }
                $host = reset($gegenstelle[$k]);
                if ((string) $host === (string) $r['rid']) {
                    continue;
                }
                $r['rhid']  = $host;
                $r['match'] = 'port';
                break;
            }
        }
        unset($r);
    }

    /**
     * Portangaben einer Nachbarzeile: [SNMP-Index, lokales Port-Label,
     * lokaler ifIndex, Port-Label am Nachbar-Ende]. Haengt nur an der Zeile
     * selbst, nicht an der Zuordnung — deshalb schon im ersten Durchgang,
     * wo die Port-Zuordnung (resolveByPort) sie braucht.
     */
    private static function portContext(array $item, string $rid, array $lldp_ports, array $port_names): array {
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
        $idx      = '';
        $port     = '';
        $port_idx = '';
        if (strpos($item['key_'], '[') !== false) {
            $idx  = HostMetadata::ifaceParam($item['key_']);
            $port = $idx;
            if (preg_match('/^\d+\.(\d+)\.\d+$/', $idx, $pm)) {
                $port = $pm[1];            // LLDP: Mitte = lokaler Port
            } elseif (preg_match('/^(\d+)\.\d+$/', $idx, $pm)) {
                $port = $pm[1];            // CDP: erster Teil = ifIndex
            }
            // Der ifIndex ist die Korrelationsgroesse — als ANZEIGE
            // taugt eine nackte "9" nichts, waehrend das Nachbar-Ende
            // "Gi1/0/8" zeigt. Liefert das Template einen
            // Interface-Namen, gewinnt der; sonst bleibt es beim Index.
            // $port_idx behaelt den Index fuer die Metrik-Zuordnung.
            $port_idx = $port;
            if ($port !== '' && isset($port_names[$rid][$port]) && $port_names[$rid][$port] !== '') {
                $port = $port_names[$rid][$port];
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

        return [$idx, $port, $port_idx, $remote_port];
    }

    /**
     * Kanten aus dem Tag nt:uplink=<host>:<port>.
     *
     * WOFUER
     * ------
     * Eine USV, eine PDU, ein Drucker: angeschlossen, aber stumm. Sie melden
     * keinen Nachbarn, also zeichnet die Karte auch keine Verbindung — obwohl
     * der Admin genau weiss, in welchem Port das Kabel steckt. Bisher blieb
     * nur die von Hand gezogene Verbindung, und die traegt keinen Port.
     *
     * DER PORT IST DER PUNKT. Mit ihm bekommt die Kante alles, was eine
     * LLDP-Kante auch hat: Verkehr, Fehler, Discards und Geschwindigkeit an
     * genau diesem Port, denn die Zaehler liegen ohnehin nach ifIndex vor. Die
     * Verbindung ist damit nicht nur gezeichnet, sondern gemessen — gemessen
     * wird das Switch-Ende, das stumme Geraet gibt nichts her.
     *
     * WAS SIE NICHT IST: ein Beleg. Ein Mensch hat sie behauptet; kein Geraet
     * hat sie bestaetigt. Deshalb eine eigene Match-Art ('tag'), keine
     * beidseitige Bestaetigung und eine Sicherheit, die das ausdrueckt.
     *
     * Der Port darf der ifIndex selbst sein ("8") oder ein Name ("Gi1/0/8");
     * Namen werden ueber dieselbe Aufloesung wie beim LLDP-Nachbarn auf einen
     * ifIndex gebracht, inklusive Schreibweisen-Normalisierung.
     *
     * Gibt es die Kante schon (das Geraet spricht doch LLDP, oder die
     * Gegenseite meldet es), wird sie ERGAENZT statt verdoppelt: die Messung
     * ist dieselbe, und zwei Linien zwischen denselben Knoten waeren eine
     * Aussage ueber das Netz, die niemand gemacht hat.
     *
     * @param array $uplinks hostid => ['host' => <Name>, 'port' => <Port|''>]
     */
    public static function uplinkEdges(array $hosts, array $uplinks, array $edges,
            array $port_traffic = [], array $port_speed = [], array $port_errors = [],
            array $port_discards = [], array $port_names = []): array {
        if (!$uplinks) {
            return $edges;
        }
        // Namensaufloesung wie bei nt:parent: technischer Name gewinnt.
        $name_to_id = [];
        foreach ($hosts as $hid => $h) {
            $vis = strtolower(trim((string) ($h['name'] ?? '')));
            if ($vis !== '' && !isset($name_to_id[$vis])) {
                $name_to_id[$vis] = $hid;
            }
        }
        foreach ($hosts as $hid => $h) {
            $tech = strtolower(trim((string) ($h['host'] ?? '')));
            if ($tech !== '') {
                $name_to_id[$tech] = $hid;
            }
        }

        $vorhanden = [];   // "a-b" => [Index in $edges, ...] — parallel links
        foreach ($edges as $i => $e) {
            $paar = [(string) ($e['from'] ?? ''), (string) ($e['to'] ?? '')];
            sort($paar);
            $vorhanden[implode('-', $paar)][] = $i;
        }

        foreach ($uplinks as $hid => $angabe) {
            $ziel = $name_to_id[strtolower((string) $angabe['host'])] ?? null;
            if ($ziel === null || (string) $ziel === (string) $hid) {
                continue;
            }

            // Port auf einen ifIndex des ZIELS bringen.
            $port  = trim((string) ($angabe['port'] ?? ''));
            $ifidx = '';
            $label = '';
            if ($port !== '') {
                if (preg_match('/^\d+$/', $port)) {
                    $ifidx = $port;
                    $label = $port_names[(string) $ziel][$port] ?? $port;
                } else {
                    $auf = self::resolveRemotePort($port, $port_names[(string) $ziel] ?? []);
                    $ifidx = $auf !== null ? $auf[0] : '';
                    $label = $port;
                }
                $label = self::capLabel($label);
            }

            $metrik = null;
            if ($ifidx !== '') {
                if (isset($port_traffic[(string) $ziel][$ifidx])) {
                    $pt = $port_traffic[(string) $ziel][$ifidx];
                    $metrik = ['in' => round($pt['in']), 'out' => round($pt['out'])];
                }
                if (isset($port_speed[(string) $ziel][$ifidx]) && $port_speed[(string) $ziel][$ifidx] > 0) {
                    $metrik ??= [];
                    $metrik['speed'] = round($port_speed[(string) $ziel][$ifidx]);
                }
                if (isset($port_errors[(string) $ziel][$ifidx])) {
                    $metrik ??= [];
                    $metrik['errors'] = round((float) $port_errors[(string) $ziel][$ifidx], 3);
                }
                if (isset($port_discards[(string) $ziel][$ifidx])) {
                    $metrik ??= [];
                    $metrik['discards'] = round((float) $port_discards[(string) $ziel][$ifidx], 3);
                }
            }

            $paar = [(string) $ziel, (string) $hid];
            sort($paar);
            $key = implode('-', $paar);

            if (isset($vorhanden[$key])) {
                // Schon gemeldet — nur ergaenzen, was fehlt.
                // src ist HIER schon eine sortierte LISTE: build() hat die Map
                // am Ende umgewandelt. Mit ['tag'] => true entstuende daraus
                // ein gemischtes Array, und json_encode macht daraus ein
                // Objekt statt einer Liste — die Quellen-Pille im Panel, der
                // Tooltip, der GraphML-Export und der Geraetebericht pruefen
                // alle auf eine Liste und schweigen dann einfach.
                // Between parallel links: the one on the declared port, else
                // the first. Adding the tag to every member would claim a
                // port on each of them that only one of them has.
                // Das Label wird dabei normalisiert verglichen, der ifIndex
                // nicht: "Gi1/0/8" im Tag und "GigabitEthernet1/0/8" auf der
                // Kante sind derselbe Port, und byteweise vergleichen hiesse,
                // beim ersten Member zu landen — also womoeglich am falschen
                // Kabel des Buendels.
                $idx  = $vorhanden[$key][0];
                $norm = $label !== '' ? self::normPort($label) : '';
                foreach ($vorhanden[$key] as $cand) {
                    $kidx = (string) ($edges[$cand]['port_idx'][(string) $ziel] ?? '');
                    $klab = (string) ($edges[$cand]['ports'][(string) $ziel] ?? '');
                    if (($ifidx !== '' && $kidx === $ifidx)
                            || ($norm !== '' && $klab !== '' && self::normPort($klab) === $norm)) {
                        $idx = $cand;
                        break;
                    }
                }
                if (is_array($edges[$idx]['src']) && !in_array('tag', $edges[$idx]['src'], true)) {
                    $edges[$idx]['src'][] = 'tag';
                    sort($edges[$idx]['src']);
                }
                if ($label !== '' && !isset($edges[$idx]['ports'][(string) $ziel])) {
                    $edges[$idx]['ports'][(string) $ziel] = $label;
                }
                if ($ifidx !== '' && !isset($edges[$idx]['port_idx'][(string) $ziel])) {
                    $edges[$idx]['port_idx'][(string) $ziel] = $ifidx;
                }
                if ($metrik !== null && !isset($edges[$idx]['port_metrics'][(string) $ziel])) {
                    $edges[$idx]['port_metrics'][(string) $ziel] = $metrik;
                }
                continue;
            }

            $kante = [
                'id'    => 'u' . count($edges),
                'from'  => $ziel,
                'to'    => $hid,
                'iface' => 'nt:uplink',
                'src'   => ['tag'],
                // Kein Melder: niemand hat diese Kante gesehen, jemand hat sie
                // erklaert. 'reporters' leer zu lassen haelt 'confirmed' falsch.
                'reporters'    => [],
                'confirmed'    => false,
                'match'        => 'tag',
                'port_match'   => '',
                'ports'        => $label !== '' ? [(string) $ziel => $label] : [],
                'port_idx'     => $ifidx !== '' ? [(string) $ziel => $ifidx] : [],
                'port_metrics' => $metrik !== null ? [(string) $ziel => $metrik] : [],
            ];
            $kante['confidence'] = self::confidence($kante, $hosts);
            $edges[] = $kante;
            $vorhanden[$key][] = count($edges) - 1;
        }

        return $edges;
    }

    /** Port-Label auf 24 Zeichen kappen (einheitlich fuer lokalen + Remote-Port). */
    /**
     * Rang einer Match-Art. Hoeher = besserer Beleg.
     * Nur fuer den Vergleich beim Merge; die Punkte stehen in confidence().
     */
    private static function matchRank(string $kind): int {
        switch ($kind) {
            case 'exact':       return 9;
            case 'alias':       return 8;
            case 'ip':          return 7;
            case 'chassis':     return 6;
            case 'exact_clean': return 5;
            case 'tag':         return 4;
            case 'port':        return 3;
            case 'ip_derived':  return 2;
            case 'short':       return 1;
            default:            return 0;
        }
    }

    /**
     * Wie sicher ist diese Kante? 0-100.
     *
     * WARUM DAS UEBERHAUPT NOETIG IST
     * -------------------------------
     * Auf der Karte sah bisher jede Kante gleich sicher aus. Tatsaechlich
     * beruht die eine darauf, dass zwei Geraete einander unabhaengig melden
     * und der Name exakt auf einen Host passt — die andere darauf, dass ein
     * einzelner Switch einen Namen nannte, den wir nach Abschneiden der Domain
     * auf genau einen Host zurueckfuehren konnten.
     *
     * Der Score ist zudem die VORBEDINGUNG fuer eine Normalisierung von
     * Port-IDs. Die erzeugt zwangslaeufig Fehltreffer, und eine falsche Kante
     * ist schlimmer als eine fehlende, weil sie wie eine Messung aussieht. Mit
     * einer Sicherheitsangabe daneben wird aus dem Risiko eine Auskunft.
     *
     * WARUM DIESE SKALA UND NICHT DIE VORGESCHLAGENE
     * ----------------------------------------------
     * Der urspruengliche Vorschlag stuetzt sich auf Chassis-ID und Management-
     * Adresse. Beide werden NICHT erhoben (lldpRemChassisIdSubtype und
     * lldpRemManAddr fehlen in allen Templates) — eine Skala, die sich auf
     * nicht vorhandene Daten beruft, waere eine erfundene Zahl. Bewertet wird
     * deshalb, was wirklich vorliegt: WIE der Name getroffen hat, ob BEIDE
     * Seiten es melden, und wie viel Beiwerk (Protokolle, Ports) dazukommt.
     *
     * Die Grundpunkte spiegeln die Reihenfolge des Abgleichs oben:
     *
     *   exact        60  der gemeldete Name IST der Hostname
     *   ip           50  der Nachbar nannte eine IP, die zu einem Host gehoert
     *   exact_clean  50  exakt, aber erst nach Abschneiden eines Zusatzes
     *   chassis      50  die gemeldete MAC gehoert zu einem sicher getroffenen Host
     *   port         40  eine MAC, aufgeloest ueber denselben Port an beiden Kabelenden
     *   ip_derived   35  IP aus einem Namensmuster ("ip-10-0-0-5") GERATEN
     *   short        30  nur der Kurzname, in DIESER Auswahl eindeutig
     *
     * Der groesste Zuschlag ist die beidseitige Bestaetigung: zwei Geraete, die
     * unabhaengig voneinander dasselbe sagen, wiegen mehr als jede Feinheit des
     * Namensabgleichs.
     */
    private static function confidence(array $e, array $hosts = [], array $rtt = []): int {
        $basis = [
            'exact'       => 60,
            // Der gemeldete Name IST der erklaerte Name. Die einzige Annahme
            // ist die Erklaerung selbst, und die hat ein Mensch getippt.
            'alias'       => 55,
            'ip'          => 50,
            'exact_clean' => 50,
            'chassis'     => 50,
            // Von Hand erklaert (nt:uplink). Kein Geraet hat sie bestaetigt,
            // aber auch nichts daran ist geraten — jemand weiss, wo das Kabel
            // steckt. Zwischen "IP getroffen" und "nur der Kurzname".
            'tag'         => 45,
            'port'        => 40,
            'ip_derived'  => 35,
            'short'       => 30,
        ];
        $score = $basis[$e['match'] ?? ''] ?? 25;

        if (!empty($e['confirmed'])) {
            $score += 30;
        }
        // Zwei Protokolle sahen dieselbe Verbindung.
        if (isset($e['src']) && is_array($e['src']) && count($e['src']) >= 2) {
            $score += 10;
        }
        // Ports an BEIDEN Enden bekannt — spricht dafuer, dass die Zuordnung
        // nicht nur ueber den Namen laeuft.
        if (isset($e['ports']) && is_array($e['ports']) && count($e['ports']) >= 2) {
            $score += 10;
        }

        // Der gemeldete Nachbar-Port liess sich auf ein Interface des
        // vermuteten Nachbarn aufloesen. Das ist ein Beleg fuer die Kante
        // selbst — der gemeldete Port EXISTIERT dort.
        //
        // Normalisiert zaehlt weniger als exakt, und das ist der Punkt:
        // "GigabitEthernet1/0/1" auf "Gi1/0/1" abzubilden ist eine Annahme
        // ueber Schreibweisen, kein Messwert. Sie darf den Score heben, aber
        // nicht so weit wie ein Treffer, der keine Annahme braucht.
        if (($e['port_match'] ?? '') === 'exact') {
            $score += 10;
        } elseif (($e['port_match'] ?? '') === 'normalized') {
            $score += 5;
        }

        $score -= self::rttAbschlag($e, $hosts, $rtt);

        return max(0, min(100, $score));
    }

    /**
     * Abschlag, wenn die Laufzeiten beider Enden nicht zu Nachbarn passen.
     *
     * WOHER DIE IDEE
     * --------------
     * Aus r/zabbix, von jemandem, der ein aehnliches Werkzeug baut und LLDP,
     * MNDP, CDP, FIB UND Laufzeiten in seinen Score einrechnet. Der Punkt, den
     * er trifft: unser Score bewertet ausschliesslich, WIE der Name zugeordnet
     * wurde. Er ist damit blind gegen einen Treffer, der physikalisch unmoeglich
     * ist — ein exakter Namenstreffer bekommt 60 Punkte, auch wenn das Geraet
     * nachweislich hinter einer WAN-Strecke sitzt.
     *
     * WARUM DIE SCHWELLE SO HOCH IST
     * ------------------------------
     * Unser einziger Laufzeitwert ist icmppingsec — gemessen vom Server oder
     * Proxy zum Host, NICHT zwischen den beiden Nachbarn. Verwertbar ist daran
     * nur der UNTERSCHIED, und auch der nur mit Vorsicht: LLDP-Kanten
     * verbinden ueberwiegend Switches, und Switches sind fuer traege
     * ICMP-Antworten beruechtigt, weil ihre CPU sie nachrangig behandelt. Ein
     * belasteter Switch kann zweistellige Millisekunden zeigen und trotzdem
     * direkt angeschlossen sein.
     *
     * Deshalb 100 ms und nicht 20: bei diesem Abstand ist keine
     * ICMP-Nachrangigkeit mehr die Erklaerung, sondern eine andere Strecke.
     * Lieber ein Signal, das selten anschlaegt und dann recht hat, als eines,
     * das oft anschlaegt und richtige Kanten abwertet — eine falsch
     * abgewertete Kante ist derselbe Schaden wie eine falsch aufgewertete.
     *
     * NUR ABSCHLAG, NIE BONUS. Aehnliche Laufzeiten beweisen keine
     * Nachbarschaft; zwei Geraete im selben Rack sehen gleich aus, egal ob ein
     * Kabel zwischen ihnen liegt.
     *
     * NUR BEI GLEICHEM PROXY. Werden zwei Hosts von verschiedenen Proxies
     * gemessen, sind die Werte gar nicht vergleichbar — dann sagt der
     * Unterschied etwas ueber die Standorte der Proxies, nicht ueber die Hosts.
     */
    private static function rttAbschlag(array $e, array $hosts, array $rtt): int {
        if (!$rtt) {
            return 0;
        }
        $a = (string) ($e['from'] ?? '');
        $b = (string) ($e['to']   ?? '');

        $ra = (float) ($rtt[$a] ?? 0);
        $rb = (float) ($rtt[$b] ?? 0);
        if ($ra <= 0 || $rb <= 0) {
            return 0;   // ohne beide Werte keine Aussage
        }

        // Verschiedene Messpunkte => nicht vergleichbar.
        //
        // Proxy-GRUPPEN (Zabbix 7.0+) zuerst: ein Host, der ueber eine
        // Proxy-Gruppe laeuft, traegt proxyid 0 — genau wie einer am Server.
        // Der Vergleich der proxyid allein hielt die beiden deshalb fuer
        // denselben Messpunkt, und eine korrekt verkabelte Kante ueber einen
        // entfernten Proxy verlor bis zu 20 Punkte. Welcher Proxy der Gruppe
        // gerade pingt, wechselt zudem; zwei Hosts derselben Gruppe sind also
        // ebenso wenig vergleichbar. Diese Pruefung zieht nur ab und vergibt
        // nie etwas — im Zweifel zu schweigen kostet nichts.
        foreach ([$a, $b] as $hid) {
            $pg = (string) ($hosts[$hid]['proxy_groupid'] ?? '0');
            if ($pg !== '0' && $pg !== '') {
                return 0;
            }
        }
        $pa = (string) ($hosts[$a]['proxyid'] ?? '');
        $pb = (string) ($hosts[$b]['proxyid'] ?? '');
        if ($pa !== $pb) {
            return 0;
        }

        // MetricExtractor legt den Wert bereits in MILLISEKUNDEN ab
        // (round($val * 1000, 1) bei icmppingsec) — hier NICHT noch einmal
        // umrechnen.
        //
        // Genau das stand hier zuerst, und der Fehler war schlimmer als er
        // aussieht: aus 0,5 ms und 1,2 ms wurden 700 "ms", also der volle
        // Abschlag von 20 Punkten auf JEDE Kante in einem gesunden LAN. Der
        // Test hat es nicht gefangen, weil ich ihn mit Sekundenwerten
        // gefuettert habe — er pruefte meine Annahme, nicht die Wirklichkeit.
        $diff_ms = abs($ra - $rb);

        if ($diff_ms > 250.0) {
            return 20;
        }
        if ($diff_ms > 100.0) {
            return 10;
        }
        return 0;
    }

    /**
     * Portnamen auf eine Vergleichsform bringen.
     *
     *   "GigabitEthernet1/0/1"  ->  "gi1/0/1"
     *   "Gi1/0/1"               ->  "gi1/0/1"
     *   "Te 1/1/4"              ->  "te1/1/4"
     *   "ether1"                ->  "ether1"
     *
     * Nur Kleinschreibung, Leerzeichen weg und die gaengigen Langformen auf
     * ihre uebliche Kurzform. BEWUSST KEIN Abschneiden von Ziffern oder
     * Trennern: "1/0/1" und "1/0/11" duerfen nie zusammenfallen.
     *
     * Die Liste ist nach Laenge sortiert und bricht beim ersten Treffer ab —
     * sonst machte "ethernet" aus "gigabitethernet1/0/1" ein "gigabiteth...".
     */
    /**
     * Identity keys of ONE end of a link: the ifIndex where known, the
     * normalised label otherwise (both, when both are known). Two reports
     * name the same cable end if they share any key.
     */
    private static function portKeys(string $label, string $ifidx): array {
        $k = [];
        if ($ifidx !== '') {
            $k['i:' . $ifidx] = true;
        }
        if ($label !== '') {
            $k['n:' . self::normPort($label)] = true;
        }
        return $k;
    }

    /**
     * Which existing edge between this host pair does a report belong to?
     * Returns its index, or null for "a further physical link".
     *
     * PARALLEL LINKS
     * --------------
     * Until 5.3 every pair had exactly one edge, and a second report for the
     * same pair was merged first-wins. For a LAG that meant: one member's
     * port, one member's counters, and a failed member was invisible. Now
     * each cable is its own edge; the frontend fans them out.
     *
     * THE DANGER IS THE FALSE SPLIT, NOT THE MISSED ONE
     * ------------------------------------------------
     * Both ends report the same cable, often with labels that do not compare
     * ("10101" here, "GigabitEthernet1/0/1" there), and LLDP and CDP may
     * number the same local port differently. A naive "different port =
     * different link" would draw every such cable twice. Hence the order:
     *
     *   1. a shared port key at either end -> same link
     *   2. the report carries no local port at all -> old behaviour, merge
     *   3. an edge this reporter has NOT yet reported with this protocol
     *      -> same link (the other end's view, or the other protocol's)
     *   4. only when this reporter already reported every existing edge with
     *      this protocol, on other ports, is it really a further cable.
     *
     * The count is therefore exact: it is the number of distinct local
     * ports one device reports for the neighbour over one protocol. What
     * can go wrong in (3) is the PAIRING of member ends when labels are
     * incomparable — never the number of lines drawn.
     */
    private static function findMember(array $members, array $keys, array $rep,
            string $rid, string $rhid, string $src, array $lkeys, array $rkeys): ?int {
        if (!$members) {
            return null;
        }
        foreach ($members as $m) {
            if (array_intersect_key($keys[$m][$rid] ?? [], $lkeys)
                    || array_intersect_key($keys[$m][$rhid] ?? [], $rkeys)) {
                return $m;
            }
        }
        if (!$lkeys) {
            return $members[0];
        }
        foreach ($members as $m) {
            if (!isset($rep[$m][$rid . '|' . $src])) {
                return $m;
            }
        }
        return null;
    }

    private static function normPort(string $p): string {
        $p = preg_replace('/\s+/', '', strtolower(trim($p)));
        $syn = [
            'tengigabitethernet'    => 'te',
            'fortygigabitethernet'  => 'fo',
            'hundredgigabitethernet'=> 'hu',
            'twentyfivegigabitethernet' => 'twe',
            'gigabitethernet'       => 'gi',
            'fastethernet'          => 'fa',
            'tengige'               => 'te',
            'ethernet'              => 'eth',
        ];
        foreach ($syn as $lang => $kurz) {
            if (strpos($p, $lang) === 0) {
                return $kurz . substr($p, strlen($lang));
            }
        }
        return $p;
    }

    /**
     * Den vom Nachbarn gemeldeten Portnamen auf ein Interface DES NACHBARN
     * aufloesen. Gibt [ifIndex, 'exact'|'normalized'] zurueck oder null.
     *
     * WARUM DAS MEHR IST ALS KOSMETIK
     * -------------------------------
     * Gelingt es, hat die Kante Messwerte an BEIDEN Enden statt nur beim
     * Melder — und die Aufloesung ist zugleich ein Beleg: der gemeldete Port
     * existiert auf dem Geraet, das wir fuer den Nachbarn halten.
     *
     * WARUM MEHRDEUTIGKEIT VERWORFEN WIRD
     * -----------------------------------
     * Faellt die normalisierte Form auf mehrere Interfaces, wird NICHTS
     * zugeordnet. Dieselbe Regel wie beim Kurznamen-Abgleich der Hosts: eine
     * falsche Zuordnung ist schlimmer als keine, weil die Zahlen danach
     * aussehen wie eine Messung am richtigen Port.
     */
    private static function resolveRemotePort(string $name, array $names): ?array {
        if ($name === '' || !$names) {
            return null;
        }
        // 1. Exakt, wie gemeldet.
        foreach ($names as $ifx => $nm) {
            if ((string) $nm === $name) {
                return [(string) $ifx, 'exact'];
            }
        }
        // 2. Normalisiert — und nur, wenn eindeutig.
        $ziel = self::normPort($name);
        $treffer = [];
        foreach ($names as $ifx => $nm) {
            if (self::normPort((string) $nm) === $ziel) {
                $treffer[] = (string) $ifx;
            }
        }
        return count($treffer) === 1 ? [$treffer[0], 'normalized'] : null;
    }

    private static function capLabel(string $s): string {
        // mb_substr, NICHT substr. Seit hier auch Interface-Namen durchlaufen
        // (ifName/ifDescr/ifAlias, und ifAlias ist frei getippter Text), ist
        // ein byteweiser Schnitt gefaehrlich: mitten in einer UTF-8-Sequenz
        // gekappt scheitert json_encode() an der ganzen Antwort — die Karte
        // laedt dann GAR NICHT mehr, wegen eines Umlauts in einer
        // Portbeschreibung. Die Geschwisterstellen (Zeile 203, 206,
        // MetricExtractor::capName) machen es laengst richtig.
        return mb_strlen($s) > 24 ? mb_substr($s, 0, 24) : $s;
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
