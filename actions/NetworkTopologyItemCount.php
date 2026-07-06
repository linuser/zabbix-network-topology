<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CController;
use CControllerResponseData;
use API;

/**
 * NetworkTopologyItemCount
 *
 * Lightweight-Endpoint fuer Live-Autocomplete beim Custom-Pattern-Tippen im
 * Items-Pivot. Liefert nur die Anzahl matchender Items + ein paar Sample-
 * Keys — keine Werte, keine Historie. countOutput macht das billig genug
 * fuer Tipp-Frequenz (debounced im Frontend).
 *
 * Request:  groupids[], pattern
 * Response: { count: N, sample: ['k1', ...], truncated: bool, hint?: str }
 */
class NetworkTopologyItemCount extends CController {

    private const SAMPLE_SIZE = 5;

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
        $ret = $this->validateInput([
            'groupids' => 'array_id',
            'pattern'  => 'string|not_empty',
        ]);
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
        $groupids = $this->getInput('groupids', []);
        $pattern  = trim($this->getInput('pattern', ''));

        // Kurze Patterns rejecten — sonst matched z.B. "v" zigtausend Items
        // und die DB leidet ohne dass der User sinnvolle Info bekommt.
        $stripped = str_replace('*', '', $pattern);
        if (strlen($stripped) < 2) {
            $this->respond(['count' => null, 'sample' => [], 'truncated' => false,
                            'hint' => 'Min. 2 Zeichen']);
            return;
        }
        if (strlen($pattern) > 200 || substr_count($pattern, '*') > 4
            || preg_match('/[\x00-\x1F\x7F]/', $pattern)) {
            $this->respond(['error' => 'Invalid pattern']);
            return;
        }

        // Permission-Filter analog NetworkTopologyItems
        $allowed = API::HostGroup()->get([
            'output'       => ['groupid'],
            'groupids'     => $groupids,
            'preservekeys' => true,
        ]);
        $allowed_ids = array_keys($allowed);
        if (!$allowed_ids) {
            $this->respond(['count' => 0, 'sample' => [], 'truncated' => false]);
            return;
        }

        // countOutput: nur eine Zahl statt Item-Liste — deutlich billiger.
        $count = (int) API::Item()->get([
            'countOutput' => true,
            'groupids'    => $allowed_ids,
            'search'      => ['key_' => $pattern],
            'searchWildcardsEnabled' => true,
            'monitored'   => true,
        ]);

        // Sample-Keys (distinct) fuer die Vorschau unterm Input
        $sample = [];
        if ($count > 0) {
            $probe = API::Item()->get([
                'output'      => ['itemid', 'key_'],
                'groupids'    => $allowed_ids,
                'search'      => ['key_' => $pattern],
                'searchWildcardsEnabled' => true,
                'monitored'   => true,
                'limit'       => self::SAMPLE_SIZE * 4,
            ]);
            $seen = [];
            foreach ($probe as $it) {
                $k = $it['key_'] ?? '';
                if ($k === '' || isset($seen[$k])) continue;
                $seen[$k] = true;
                $sample[] = $k;
                if (count($sample) >= self::SAMPLE_SIZE) break;
            }
        }

        $payload = ['count' => $count, 'sample' => $sample, 'truncated' => false];
        NetworkTopologyDiag::record([
            'action'     => 'item_count',
            'elapsed_ms' => round((microtime(true) - $_t0) * 1000, 1),
            'bytes'      => strlen(json_encode($payload)),
            'cache_hit'  => false,
            'counts'     => ['matches' => $count],
        ]);
        $this->respond($payload);
    }

    private function respond(array $data): void {
        $this->setResponse(new CControllerResponseData([
            'main_block' => json_encode($data, JSON_UNESCAPED_UNICODE)
        ]));
    }
}
