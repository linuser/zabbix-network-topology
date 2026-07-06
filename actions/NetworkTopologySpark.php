<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CController;
use CControllerResponseData;
use API;

/**
 * NetworkTopologySpark
 *
 * Liefert für eine Liste von Hosts:
 *   - CPU-History (letzte 1h, max 30 Punkte)
 *   - Ping-History (letzte 1h, max 30 Punkte)
 *   - Traffic-History in/out (letzte 1h, max 30 Punkte, bps, summiert über
 *     alle net.if-/ifInOctets/ifOutOctets-Items des Hosts) — fuer
 *     Edge-Tooltip im Frontend, das die Werte beider Endpunkte addiert.
 *   - since: Unix-Timestamp wann der aktuelle Severity-Status begann
 *
 * Request (GET/POST):
 *   hostids[] = 123,456,...
 *
 * Response JSON:
 *   {
 *     "123": {
 *       "cpu": [...], "ping": [...],
 *       "traffic_in": [...], "traffic_out": [...],
 *       "since": 1710000000
 *     },
 *     ...
 *   }
 */
class NetworkTopologySpark extends CController {

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    // Read-only Endpunkt — nur XHR-Aufrufe akzeptieren (CSRF-Last-Schutz).
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
        $ret = $this->validateInput(['hostids' => 'array_id']);
        if (!$ret) {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['error' => 'Invalid input'])
            ]));
        }
        return $ret;
    }

    protected function checkPermissions(): bool {
        return $this->getUserType() >= USER_TYPE_ZABBIX_USER;
    }

    protected function doAction(): void {
        $_t0 = microtime(true);
        $hostids  = $this->getInput('hostids', []);

        // Defensive: Spark wird vom Tooltip einzeln pro Host getriggert,
        // realistisch sind 1-5 hostids pro Call. Cap bei 50 verhindert
        // dass jemand der den Endpoint direkt aufruft alle 1000 Hosts auf
        // einmal zieht (= 2 fette API-Calls über alle Hosts hinweg).
        if (count($hostids) > 50) {
            $hostids = array_slice($hostids, 0, 50);
        }

        $now      = time();
        $timeFrom = $now - 3600;   // letzte 1 Stunde
        $result   = [];

        if (!$hostids) {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode((object)[])
            ]));
            return;
        }

        // ── 1. Items suchen: CPU + Ping + Traffic (net.if + IF-MIB) ──────────
        // Traffic-Items werden ueber Key-Substring gematcht; pro Host koennen
        // mehrere existieren (mehrere Interfaces) — wir summieren spaeter.
        $items = API::Item()->get([
            'output'       => ['itemid', 'hostid', 'key_', 'value_type'],
            'hostids'      => $hostids,
            'search'       => ['key_' => [
                'system.cpu.util', 'icmppingsec',
                'net.if', 'ifInOctets', 'ifOutOctets', 'ifHCInOctets', 'ifHCOutOctets'
            ]],
            'searchByAny'  => true,
            'monitored'    => true,
            'preservekeys' => true,
        ]);

        $cpu_items     = [];   // hostid -> itemid (erstes match reicht)
        $ping_items    = [];
        $trIn_items    = [];   // hostid -> [itemids, ...] alle In-Interfaces
        $trOut_items   = [];   // hostid -> [itemids, ...]
        $trIn_scale    = [];   // itemid -> Bit-Multiplier (8 fuer Bytes, 1 fuer Bits)
        $trOut_scale   = [];

        foreach ($items as $itemid => $item) {
            $hid = $item['hostid'];
            $key = $item['key_'];
            if (strpos($key, 'system.cpu.util') !== false && !isset($cpu_items[$hid])) {
                $cpu_items[$hid] = $itemid;
            } elseif (strpos($key, 'icmppingsec') !== false && !isset($ping_items[$hid])) {
                $ping_items[$hid] = $itemid;
            } elseif (strpos($key, 'net.if.in') === 0 || strpos($key, 'ifInOctets') !== false
                  || strpos($key, 'ifHCInOctets') !== false) {
                $trIn_items[$hid][] = $itemid;
                // net.if.in liefert bps direkt (oder bytes/s — die Render-Tabelle
                // multipliziert auch *8 fuer Octets-Keys), Octets sind Bytes/s → *8.
                $trIn_scale[$itemid] = (strpos($key, 'Octets') !== false) ? 8 : 1;
            } elseif (strpos($key, 'net.if.out') === 0 || strpos($key, 'ifOutOctets') !== false
                  || strpos($key, 'ifHCOutOctets') !== false) {
                $trOut_items[$hid][] = $itemid;
                $trOut_scale[$itemid] = (strpos($key, 'Octets') !== false) ? 8 : 1;
            }
        }

        // ── 2. History holen ─────────────────────────────────────────────────
        // CPU/Ping sind FLOAT, Traffic kann FLOAT oder UINT64 sein (Counters
        // mit Change-per-second-Preprocessing → FLOAT, raw counter → UINT64).
        // Wir holen beide Typen separat und mergen.
        $cp_item_ids = array_unique(array_merge(
            array_values($cpu_items), array_values($ping_items)
        ));
        $tr_item_ids = [];
        foreach ($trIn_items as $arr)  { foreach ($arr as $iid) $tr_item_ids[] = $iid; }
        foreach ($trOut_items as $arr) { foreach ($arr as $iid) $tr_item_ids[] = $iid; }
        $tr_item_ids = array_unique($tr_item_ids);

        $history_map = [];   // itemid -> [{clock, value}, ...]

        if ($cp_item_ids) {
            $hist = API::History()->get([
                'output'    => ['itemid', 'clock', 'value'],
                'itemids'   => $cp_item_ids,
                'history'   => ITEM_VALUE_TYPE_FLOAT,
                'time_from' => $timeFrom,
                'time_till' => $now,
                'sortfield' => 'clock',
                'sortorder' => 'ASC',
                'limit'     => max(30, count($cp_item_ids) * 30),
            ]);
            foreach ($hist as $h) {
                $history_map[$h['itemid']][] = ['clock' => (int)$h['clock'], 'value' => (float)$h['value']];
            }
        }
        if ($tr_item_ids) {
            foreach ([ITEM_VALUE_TYPE_FLOAT, ITEM_VALUE_TYPE_UINT64] as $vtype) {
                $hist = API::History()->get([
                    'output'    => ['itemid', 'clock', 'value'],
                    'itemids'   => $tr_item_ids,
                    'history'   => $vtype,
                    'time_from' => $timeFrom,
                    'time_till' => $now,
                    'sortfield' => 'clock',
                    'sortorder' => 'ASC',
                    'limit'     => max(60, count($tr_item_ids) * 60),
                ]);
                foreach ($hist as $h) {
                    $history_map[$h['itemid']][] = ['clock' => (int)$h['clock'], 'value' => (float)$h['value']];
                }
            }
        }

        // ── 3. "Seit wann" — letzter Problem-Event pro Host ──────────────────
        // Wir holen den ältesten noch aktiven Problem-Event pro Host
        $since_map = [];   // hostid -> clock

        // selectHosts direkt auf Problem.get spart den separaten Trigger.get-
        // Roundtrip. recent=true: nur aktuell offene Probleme statt historic
        // (war false → potentiell tausende alter Events).
        $problems = API::Problem()->get([
            'output'       => ['objectid', 'clock'],
            'hostids'      => $hostids,
            'recent'       => true,
            'selectHosts'  => ['hostid'],
            'preservekeys' => false,
        ]);

        if ($problems) {
            foreach ($problems as $prob) {
                $clock = (int) $prob['clock'];
                foreach ($prob['hosts'] ?? [] as $th) {
                    $hid = $th['hostid'];
                    // Aeltesten Problem-Timestamp merken (= seit wann Probleme bestehen)
                    if (!isset($since_map[$hid]) || $clock < $since_map[$hid]) {
                        $since_map[$hid] = $clock;
                    }
                }
            }
        }

        // ── 4. Ergebnis zusammenbauen ─────────────────────────────────────────
        foreach ($hostids as $hid) {
            // CPU/Ping: erstes Match-Item, einfache Wert-Liste
            $cpu_vals  = isset($cpu_items[$hid])
                ? array_map(static fn($e) => round($e['value'], 2), $history_map[$cpu_items[$hid]] ?? [])
                : [];
            $ping_raw = isset($ping_items[$hid])
                ? array_map(static fn($e) => $e['value'], $history_map[$ping_items[$hid]] ?? [])
                : [];
            $ping_ms = array_map(static fn($v) => round($v * 1000, 1), $ping_raw);

            // Traffic in/out: Summe ueber alle Interfaces des Hosts, gebucketet
            // pro Minute (60 Buckets/h) damit verschiedene Items mit
            // unterschiedlichen Sample-Raten korrekt addiert werden.
            $tr_in_bucketed  = $this->bucketSumScaled($history_map, $trIn_items[$hid]  ?? [], $trIn_scale,  $timeFrom, 60);
            $tr_out_bucketed = $this->bucketSumScaled($history_map, $trOut_items[$hid] ?? [], $trOut_scale, $timeFrom, 60);

            $result[$hid] = [
                'cpu'         => $this->sample($cpu_vals,  30),
                'ping'        => $this->sample($ping_ms,   30),
                'traffic_in'  => $this->sample($tr_in_bucketed,  30),
                'traffic_out' => $this->sample($tr_out_bucketed, 30),
                'since'       => $since_map[$hid] ?? null,
            ];
        }

        $_payload = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        NetworkTopologyDiag::record([
            'action'     => 'spark',
            'elapsed_ms' => round((microtime(true) - $_t0) * 1000, 1),
            'bytes'      => strlen($_payload),
            'cache_hit'  => false,
            'counts'     => ['hosts' => count($hostids)],
        ]);
        $this->setResponse(new CControllerResponseData(['main_block' => $_payload]));
    }

    /**
     * Gleichmäßiges Subsampling eines Arrays auf max $n Werte.
     */
    private function sample(array $arr, int $n): array {
        $len = count($arr);
        if ($len <= $n || $len === 0) return $arr;
        $result = [];
        for ($i = 0; $i < $n; $i++) {
            $idx      = (int) round($i * ($len - 1) / ($n - 1));
            $result[] = $arr[$idx];
        }
        return $result;
    }

    /**
     * Bucketed Sum: Mehrere Items mit unterschiedlichen Sample-Raten in
     * gleichgrosse Zeit-Buckets aufteilen, pro Bucket den letzten Wert pro
     * Item verwenden, dann ueber alle Items summieren. Skalar $scale[$itemid]
     * (1 oder 8) konvertiert Bytes/s → bit/s falls Counter-Items.
     *
     * Liefert ein Array der Laenge $buckets, fehlende Buckets = 0.
     */
    private function bucketSumScaled(array $history_map, array $itemids, array $scale, int $timeFrom, int $buckets): array {
        if (!$itemids) return [];
        $bucketSize = 3600 / $buckets;
        $out = array_fill(0, $buckets, 0.0);
        // Pro Bucket: pro Item den letzten Wert behalten, dann summieren.
        $perBucket = [];   // bucket -> itemid -> latestVal
        foreach ($itemids as $iid) {
            $entries = $history_map[$iid] ?? [];
            $mul = $scale[$iid] ?? 1;
            foreach ($entries as $e) {
                $b = (int) (($e['clock'] - $timeFrom) / $bucketSize);
                if ($b < 0 || $b >= $buckets) continue;
                $perBucket[$b][$iid] = $e['value'] * $mul;
            }
        }
        foreach ($perBucket as $b => $items) {
            $sum = 0.0;
            foreach ($items as $v) $sum += $v;
            $out[$b] = round($sum, 1);
        }
        return $out;
    }
}
