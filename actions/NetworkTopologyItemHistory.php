<?php
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CController;
use CControllerResponseData;
use API;

/**
 * NetworkTopologyItemHistory
 *
 * Batch-Fetch fuer Item-History (1h, ~20 Sample-Punkte pro Item).
 * Wird vom Items-Pivot verwendet um pro Zelle eine Sparkline zu rendern —
 * ein einziger Request pro Pivot-Render statt ein Roundtrip pro Cell.
 *
 * Request: itemids[] (Pflicht, max 500)
 * Response: { itemid: [v0, v1, ..., vN], ... }  (leere Arrays wenn kein History)
 */
class NetworkTopologyItemHistory extends CController {

    private const MAX_ITEMS   = 500;   // Cap gegen missbrauchen
    private const SAMPLE_N    = 20;    // Sparkline-Aufloesung
    private const TIME_WINDOW = 3600;  // 1 Stunde zurueck

    protected function init(): void {
        $this->disableCsrfValidation();
    }

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
        $ret = $this->validateInput(['itemids' => 'array_id']);
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
        $itemids = $this->getInput('itemids', []);
        if (!$itemids) {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode((object) [])
            ]));
            return;
        }
        if (count($itemids) > self::MAX_ITEMS) {
            $itemids = array_slice($itemids, 0, self::MAX_ITEMS);
        }

        // Permission-Filter: nur Items zu denen der User Zugang hat.
        // Item.get ehrt die User-Permissions.
        $items = API::Item()->get([
            'output'       => ['itemid', 'value_type'],
            'itemids'      => $itemids,
            'preservekeys' => true,
        ]);
        if (!$items) {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode((object) [])
            ]));
            return;
        }

        // Items nach value_type gruppieren — History.get braucht type-flag
        $by_type = [ITEM_VALUE_TYPE_FLOAT => [], ITEM_VALUE_TYPE_UINT64 => []];
        foreach ($items as $iid => $it) {
            $vt = (int) ($it['value_type'] ?? 0);
            if (isset($by_type[$vt])) $by_type[$vt][] = $iid;
        }

        $now      = time();
        $timeFrom = $now - self::TIME_WINDOW;
        $out      = [];

        // Chunks à 50 Items mit proportionalem Limit (120 Samples/Item = 1h
        // bei 30s-Intervall). Ein globales Limit ueber ALLE itemids liess
        // chatty Items (1s-Intervall) das Budget fressen — Sparklines zeigten
        // dann nur die ersten Minuten der Stunde und andere Items gingen
        // komplett leer aus.
        foreach ($by_type as $vt => $ids) {
            if (!$ids) continue;
            foreach (array_chunk($ids, 50) as $chunk) {
                $hist = API::History()->get([
                    'output'    => ['itemid', 'clock', 'value'],
                    'itemids'   => $chunk,
                    'history'   => $vt,
                    'time_from' => $timeFrom,
                    'time_till' => $now,
                    'sortfield' => 'clock',
                    'sortorder' => 'ASC',
                    'limit'     => count($chunk) * 120,
                ]);
                $tmp = [];
                foreach ($hist as $h) {
                    $tmp[$h['itemid']][] = ($vt === ITEM_VALUE_TYPE_FLOAT)
                        ? (float) $h['value'] : (int) $h['value'];
                }
                foreach ($tmp as $iid => $arr) {
                    $out[(string) $iid] = $this->sample($arr, self::SAMPLE_N);
                }
            }
        }
        // Items ohne History bekommen ein leeres Array — Frontend rendert dann
        // "keine Sparkline" statt "Item fehlt".
        foreach ($itemids as $iid) {
            $key = (string) $iid;
            if (!isset($out[$key])) $out[$key] = [];
        }

        NetworkTopologyDiag::record([
            'action'     => 'item_history',
            'elapsed_ms' => round((microtime(true) - $_t0) * 1000, 1),
            'bytes'      => strlen(json_encode($out)),
            'cache_hit'  => false,
            'counts'     => ['items' => count($out)],
        ]);
        $this->setResponse(new CControllerResponseData([
            'main_block' => json_encode($out, JSON_UNESCAPED_UNICODE)
        ]));
    }

    /**
     * Downsample gleichmaessig auf max $n Werte.
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
