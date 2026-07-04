<?php
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CController;
use CControllerResponseData;
use API;

/**
 * NetworkTopologyHealthHistory
 *
 * Historie der Health-Score-Trapper-Items fuer den Verlaufs-Chart im
 * Health-Tab. Die Items (nt.health.score / nt.health.score.min) werden
 * vom Sender-Cron gefuellt (tools/topo-change-sender.sh — derselbe Cron
 * der auch Topologie-Aenderungen pusht), Template:
 * templates/nt_health_score_template.yaml.
 *
 * Nicht eingerichtet oder keine Leserechte auf den Traeger-Host →
 * item_found=false, das Frontend zeigt dann einen Einrichtungs-Hinweis
 * statt der Kurve.
 *
 * Request:  days (7|14|30|90, default 14)
 * Response: { item_found: bool, days: N,
 *             avg: [[clock, score], ...], min: [[clock, score], ...] }
 *           Serien sind auf max ~240 Buckets (Mittelwert) verdichtet —
 *           ein 2min-Sender x 90d waeren sonst 65k Punkte.
 */
class NetworkTopologyHealthHistory extends CController {

    private const KEY_AVG   = 'nt.health.score';
    private const KEY_MIN   = 'nt.health.score.min';
    private const MAX_ROWS  = 40000;
    private const BUCKETS   = 240;
    private const CACHE_TTL = 120;

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
            'days' => 'in 7,14,30,90',
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
        $_t0  = microtime(true);
        $days = (int) $this->getInput('days', 14);

        $uid = (int) (\CWebUser::$data['userid'] ?? 0);
        $cache_key = 'nt_hh_' . $uid . '_' . $days;
        if ($uid > 0 && function_exists('apcu_fetch')) {
            $ok = false;
            $cached = apcu_fetch($cache_key, $ok);
            if ($ok && is_array($cached)) {
                $this->out($cached, $_t0, true);
                return;
            }
        }

        // Items per Key suchen — Item.get ehrt die User-Permissions. Gibt
        // es die Keys auf mehreren Hosts, gewinnt deterministisch die
        // kleinste itemid; gedacht ist EIN Traeger-Host ("Zabbix server").
        $items = API::Item()->get([
            'output'    => ['itemid', 'key_', 'value_type'],
            'filter'    => ['key_' => [self::KEY_AVG, self::KEY_MIN]],
            'sortfield' => 'itemid',
        ]);
        $by_key = [];
        foreach ($items as $it) {
            if (!isset($by_key[$it['key_']])) {
                $by_key[$it['key_']] = $it;
            }
        }

        $now  = time();
        $from = $now - $days * 86400;
        $payload = [
            'item_found' => isset($by_key[self::KEY_AVG]),
            'days'       => $days,
            'avg'        => $this->fetchSeries($by_key[self::KEY_AVG] ?? null, $from, $now),
            'min'        => $this->fetchSeries($by_key[self::KEY_MIN] ?? null, $from, $now),
        ];

        if ($uid > 0 && function_exists('apcu_store')) {
            apcu_store($cache_key, $payload, self::CACHE_TTL);
        }
        $this->out($payload, $_t0, false);
    }

    /**
     * History eines Items holen und auf BUCKETS Mittelwert-Punkte
     * verdichten. Rueckgabe: [[bucket_mid_clock, score], ...] aufsteigend.
     */
    private function fetchSeries(?array $item, int $from, int $now): array {
        if ($item === null) return [];
        $hist = API::History()->get([
            'output'    => ['clock', 'value'],
            'itemids'   => [$item['itemid']],
            'history'   => (int) $item['value_type'],
            'time_from' => $from,
            'time_till' => $now,
            'sortfield' => 'clock',
            'sortorder' => 'DESC',       // neueste zuerst — Limit kappt die aeltesten
            'limit'     => self::MAX_ROWS,
        ]);
        if (!$hist) return [];

        $span = max(1, (int) ceil(($now - $from) / self::BUCKETS));
        $sum = [];
        $cnt = [];
        foreach ($hist as $h) {
            $b = intdiv(((int) $h['clock']) - $from, $span);
            $sum[$b] = ($sum[$b] ?? 0.0) + (float) $h['value'];
            $cnt[$b] = ($cnt[$b] ?? 0) + 1;
        }
        ksort($sum);
        $out = [];
        foreach ($sum as $b => $s) {
            $out[] = [$from + $b * $span + (int) ($span / 2), round($s / $cnt[$b], 1)];
        }
        return $out;
    }

    private function out(array $payload, float $t0, bool $cache_hit): void {
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE);
        NetworkTopologyDiag::record([
            'action'     => 'health_history',
            'elapsed_ms' => round((microtime(true) - $t0) * 1000, 1),
            'bytes'      => strlen($json),
            'cache_hit'  => $cache_hit,
            'counts'     => ['points' => count($payload['avg'] ?? [])],
        ]);
        $this->setResponse(new CControllerResponseData(['main_block' => $json]));
    }
}
