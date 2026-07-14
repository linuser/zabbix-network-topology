<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use API;

/**
 * NetworkTopologyResourceForecast
 *
 * Kapazitaets-Forecast fuer Host-Ressourcen (CPU-% und Memory-%): holt die
 * Zabbix-Trends der Auslastungs-Items, legt pro Host+Metrik eine lineare
 * Regression durch und liefert slope+now. Das Frontend rechnet daraus die
 * ETA bis zu einer Saettigungsschwelle ("Host X erreicht 90 % Memory in
 * ~N Tagen"). Schwester der Link-Version (NetworkTopologyCapacityForecast) —
 * dieselbe Regressions-/Cache-/Chunk-Infrastruktur.
 *
 * NUR %-Items: die Klassifikation nimmt bewusst nur Keys auf, deren Wert ein
 * Prozentsatz ist (system.cpu.util(ization), hrProcessorLoad, vm.memory…pused,
 * vm.memory.utilization) — sonst wuerde die Schwelle 90 gegen absolute Bytes
 * verglichen. Hosts ohne solche Items fallen raus.
 *
 * Hosts werden serverseitig aus den groups abgeleitet (permission-gefiltert,
 * MAX_HOSTS-Cap) — NICHT vom Client-hostids, damit der Cache-Key bounded
 * bleibt (Lehre aus dem Link-Forecast-Audit-Fix).
 *
 * Request:  groupids[] (Pflicht), days (7|14|30|60|90, default 30)
 * Response: { days, hosts: { hostid: { label, cpu: {slope,now,n}|null,
 *                                       mem: {slope,now,n}|null } } }
 *           slope = %/Sekunde, now = Geradenwert bei jetzt (0..~100).
 */
class NetworkTopologyResourceForecast extends NetworkTopologyController {

    private const MAX_HOSTS  = 300;
    private const CACHE_TTL  = 1800;
    private const MIN_POINTS = 24;
    private const ROW_BUDGET = 40000;

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        if (!$this->requireAjax()) return false;
        $ret = $this->validateInput([
            'groupids' => 'array_id',
            'days'     => 'in 7,14,30,60,90',
        ]);
        if (!$ret) {
            $this->jsonResponse(['error' => 'Invalid input']);
        }
        return $ret;
    }

    protected function checkPermissions(): bool {
        return $this->getUserType() >= USER_TYPE_ZABBIX_USER;
    }

    protected function doAction(): void {
        if (!$this->throttle('resource_forecast')) return;
        $_t0      = microtime(true);
        $groupids = $this->getInput('groupids', []);
        $days     = (int) $this->getInput('days', 30);

        if (!$groupids) {
            $this->out(['days' => $days, 'hosts' => (object) []], $_t0, false);
            return;
        }

        // Cache-Key nur uid+groups+days (bounded, user-scoped) — Hosts werden
        // serverseitig aus den Gruppen abgeleitet, nicht vom Client.
        $uid = (int) (\CWebUser::$data['userid'] ?? 0);
        $gk = array_map('strval', $groupids);
        sort($gk);
        $cache_key = 'nt_rf_' . $uid . '_' . md5($days . '|' . implode(',', $gk));
        if ($uid > 0 && function_exists('apcu_fetch')) {
            $ok = false;
            $cached = apcu_fetch($cache_key, $ok);
            if ($ok && is_array($cached)) {
                $this->out($cached, $_t0, true);
                return;
            }
        }

        $hosts = API::Host()->get([
            'output'          => ['hostid', 'host', 'name'],
            'groupids'        => $groupids,
            'monitored_hosts' => true,
            'preservekeys'    => true,
            'limit'           => self::MAX_HOSTS,
        ]);
        if (!$hosts) {
            $this->out(['days' => $days, 'hosts' => (object) []], $_t0, false);
            return;
        }

        $items = API::Item()->get([
            'output'      => ['itemid', 'hostid', 'key_'],
            'hostids'     => array_keys($hosts),
            'search'      => ['key_' => [
                'system.cpu.util', 'hrProcessorLoad',
                'vm.memory.utilization', 'vm.memory.size', 'memory.util',
            ]],
            'searchByAny' => true,
            'monitored'   => true,
            'filter'      => ['value_type' => [ITEM_VALUE_TYPE_FLOAT, ITEM_VALUE_TYPE_UINT64]],
        ]);

        $meta = [];   // itemid => [hostid, metric ('cpu'|'mem')]
        foreach ($items as $it) {
            $m = $this->classify($it['key_']);
            if ($m === null) continue;
            $meta[(string) $it['itemid']] = [(string) $it['hostid'], $m];
        }
        if (!$meta) {
            $this->out(['days' => $days, 'hosts' => (object) []], $_t0, false);
            return;
        }

        $now   = time();
        $from  = $now - $days * 86400;
        $hours = $days * 24;
        $chunk_size = max(1, (int) floor(self::ROW_BUDGET / max(1, $hours)));

        // Pro Host+Metrik: Summe UND Anzahl je Stunde → Mittelwert (mehrere
        // CPU-Cores / Items zaehlen gleichrangig, Ergebnis bleibt ein %).
        $sum = [];   // hid => metric => clock => sum
        $cnt = [];   // hid => metric => clock => n
        foreach (array_chunk(array_keys($meta), $chunk_size) as $chunk) {
            $rows = API::Trend()->get([
                'output'    => ['itemid', 'clock', 'value_avg'],
                'itemids'   => $chunk,
                'time_from' => $from,
                'time_till' => $now,
            ]);
            foreach ($rows as $r) {
                $m = $meta[(string) $r['itemid']] ?? null;
                if ($m === null) continue;
                [$hid, $metric] = $m;
                $clk = (int) $r['clock'];
                $sum[$hid][$metric][$clk] = ($sum[$hid][$metric][$clk] ?? 0.0) + (float) $r['value_avg'];
                $cnt[$hid][$metric][$clk] = ($cnt[$hid][$metric][$clk] ?? 0) + 1;
            }
            unset($rows);
        }

        $out_hosts = [];
        foreach ($sum as $hid => $metrics) {
            $entry = ['cpu' => null, 'mem' => null];
            foreach (['cpu', 'mem'] as $metric) {
                if (!isset($metrics[$metric])) continue;
                $series = [];
                foreach ($metrics[$metric] as $clk => $s) {
                    $n = $cnt[$hid][$metric][$clk] ?? 1;
                    $series[$clk] = $s / max(1, $n);
                }
                $entry[$metric] = $this->regress($series, $now);
            }
            if ($entry['cpu'] !== null || $entry['mem'] !== null) {
                $h = $hosts[$hid] ?? null;
                $entry['label'] = $h
                    ? (($h['name'] ?? '') !== '' ? $h['name'] : ($h['host'] ?? (string) $hid))
                    : (string) $hid;
                $out_hosts[(string) $hid] = $entry;
            }
        }

        $payload = ['days' => $days, 'hosts' => $out_hosts ?: (object) []];
        if ($uid > 0 && function_exists('apcu_store')) {
            apcu_store($cache_key, $payload, self::CACHE_TTL);
        }
        $this->out($payload, $_t0, false);
    }

    /**
     * Nur %-Items zulassen. Rueckgabe 'cpu' | 'mem' | null.
     * vm.memory.size wird nur bei pused (Prozent) akzeptiert — die absolute
     * Byte-Variante (available/total/used) wandert NICHT in den Forecast.
     */
    private function classify(string $key): ?string {
        // Memory-% zuerst (vm.memory.size[pused] enthaelt "vm.memory" und
        // "memory.util" nicht — explizit auf pused/utilization pruefen).
        if (strpos($key, 'vm.memory.utilization') !== false
                || strpos($key, 'memory.util') !== false
                || strpos($key, 'pused') !== false) {
            return 'mem';
        }
        if (strpos($key, 'vm.memory.size') !== false) {
            return null;   // absolute Bytes (available/total/…) — kein %
        }
        // CPU-%
        if (strpos($key, 'system.cpu.util') !== false        // util + utilization
                || strpos($key, 'hrProcessorLoad') !== false) {
            return 'cpu';
        }
        return null;
    }

    /**
     * Kleinste-Quadrate-Gerade durch (clock, %). slope in %/Sekunde,
     * now = Geradenwert bei $now (geclampt 0..100, es ist ein Prozentsatz).
     */
    private function regress(array $points, int $now): ?array {
        $n = count($points);
        if ($n < self::MIN_POINTS) return null;
        ksort($points);
        $t0 = array_key_first($points);
        $sx = $sy = $sxx = $sxy = 0.0;
        foreach ($points as $clk => $v) {
            $x = (float) ($clk - $t0);
            $sx  += $x; $sy += $v; $sxx += $x * $x; $sxy += $x * $v;
        }
        $den = $n * $sxx - $sx * $sx;
        if ($den == 0.0) return null;
        $slope = ($n * $sxy - $sx * $sy) / $den;
        $icept = ($sy - $slope * $sx) / $n;
        $nowVal = $icept + $slope * ($now - $t0);
        return [
            'slope' => $slope,
            'now'   => max(0.0, min(100.0, $nowVal)),
            'n'     => $n,
        ];
    }

    private function out(array $payload, float $t0, bool $cache_hit): void {
        $json = $this->encodeJson($payload);
        NetworkTopologyDiag::record([
            'action'     => 'resource_forecast',
            'elapsed_ms' => round((microtime(true) - $t0) * 1000, 1),
            'bytes'      => strlen($json),
            'cache_hit'  => $cache_hit,
            'counts'     => ['hosts' => is_array($payload['hosts'] ?? null) ? count($payload['hosts']) : 0],
        ]);
        $this->jsonResponseRaw($json);
    }
}
