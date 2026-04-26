<?php
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
 *   - since: Unix-Timestamp wann der aktuelle Severity-Status begann
 *
 * Request (GET/POST):
 *   hostids[] = 123,456,...
 *
 * Response JSON:
 *   {
 *     "123": { "cpu": [1.2, 3.4, ...], "ping": [12.1, ...], "since": 1710000000 },
 *     ...
 *   }
 */
class NetworkTopologySpark extends CController {

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
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
        $hostids  = $this->getInput('hostids', []);
        $now      = time();
        $timeFrom = $now - 3600;   // letzte 1 Stunde
        $result   = [];

        if (!$hostids) {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode((object)[])
            ]));
            return;
        }

        // ── 1. Items für CPU + Ping suchen ───────────────────────────────────
        $items = API::Item()->get([
            'output'       => ['itemid', 'hostid', 'key_', 'value_type'],
            'hostids'      => $hostids,
            'search'       => ['key_' => ['system.cpu.util', 'icmppingsec']],
            'searchByAny'  => true,
            'monitored'    => true,
            'preservekeys' => true,
        ]);

        // Aufteilen: cpu_item und ping_item pro Host
        $cpu_items  = [];   // hostid -> itemid
        $ping_items = [];

        foreach ($items as $itemid => $item) {
            $hid = $item['hostid'];
            $key = $item['key_'];
            if (strpos($key, 'system.cpu.util') !== false && !isset($cpu_items[$hid])) {
                $cpu_items[$hid] = $itemid;
            }
            if (strpos($key, 'icmppingsec') !== false && !isset($ping_items[$hid])) {
                $ping_items[$hid] = $itemid;
            }
        }

        // ── 2. History holen (Typ 0 = float) ─────────────────────────────────
        $all_item_ids = array_unique(array_merge(
            array_values($cpu_items),
            array_values($ping_items)
        ));

        $history_map = [];   // itemid -> [values]

        if ($all_item_ids) {
            $history = API::History()->get([
                'output'    => ['itemid', 'clock', 'value'],
                'itemids'   => $all_item_ids,
                'history'   => ITEM_VALUE_TYPE_FLOAT,
                'time_from' => $timeFrom,
                'time_till' => $now,
                'sortfield' => 'clock',
                'sortorder' => 'ASC',
                'limit'     => max(30, count($all_item_ids) * 30),
            ]);

            foreach ($history as $h) {
                $history_map[$h['itemid']][] = round((float)$h['value'], 2);
            }
        }

        // ── 3. "Seit wann" — letzter Problem-Event pro Host ──────────────────
        // Wir holen den ältesten noch aktiven Problem-Event pro Host
        $since_map = [];   // hostid -> clock

        $problems = API::Problem()->get([
            'output'       => ['objectid', 'clock'],
            'hostids'      => $hostids,
            'recent'       => false,
            'preservekeys' => false,
        ]);

        // Trigger->Host-Mapping für Problem-Events
        if ($problems) {
            $trigger_ids = array_unique(array_column($problems, 'objectid'));
            $trigger_hosts = API::Trigger()->get([
                'output'       => ['triggerid'],
                'triggerids'   => $trigger_ids,
                'selectHosts'  => ['hostid'],
                'preservekeys' => true,
            ]);

            foreach ($problems as $prob) {
                $tid = $prob['objectid'];
                if (!isset($trigger_hosts[$tid])) continue;
                foreach ($trigger_hosts[$tid]['hosts'] as $th) {
                    $hid   = $th['hostid'];
                    $clock = (int)$prob['clock'];
                    // Ältesten Problem-Timestamp merken (= seit wann Probleme bestehen)
                    if (!isset($since_map[$hid]) || $clock < $since_map[$hid]) {
                        $since_map[$hid] = $clock;
                    }
                }
            }
        }

        // ── 4. Ergebnis zusammenbauen ─────────────────────────────────────────
        foreach ($hostids as $hid) {
            $cpu_vals  = isset($cpu_items[$hid])  ? ($history_map[$cpu_items[$hid]]  ?? []) : [];
            $ping_vals = isset($ping_items[$hid]) ? ($history_map[$ping_items[$hid]] ?? []) : [];

            // Ping: ms statt Sekunden
            $ping_ms = array_map(static fn($v) => round($v * 1000, 1), $ping_vals);

            // Auf max 30 Punkte reduzieren (gleichmäßig samplen)
            $result[$hid] = [
                'cpu'   => $this->sample($cpu_vals,  30),
                'ping'  => $this->sample($ping_ms,   30),
                'since' => $since_map[$hid] ?? null,
            ];
        }

        $this->setResponse(new CControllerResponseData([
            'main_block' => json_encode($result, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)
        ]));
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
}
