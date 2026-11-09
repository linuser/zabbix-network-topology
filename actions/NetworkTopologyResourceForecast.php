<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Actions;

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

        // Cache-Key nur groups+days (bounded) — Hosts werden serverseitig aus
        // den Gruppen abgeleitet, nicht vom Client. User-Scoping, Sortierung
        // der groupids und Schema-Version macht NtCache.
        $cached = NtCache::get('resource_forecast', [$groupids, $days]);
        if ($cached !== null) {
            $this->out($cached, $_t0, true);
            return;
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
            'output'      => ['itemid', 'hostid', 'key_', 'name'],
            'hostids'     => array_keys($hosts),
            'search'      => ['key_' => [
                'system.cpu.util', 'hrProcessorLoad',
                'vm.memory.utilization', 'vm.memory.size', 'memory.util',
                // Windows: "CPU utilization" ist ein perf_counter auf
                // \Processor(_Total)\% Processor Time (kein system.cpu.util).
                // "Processor Time" ist eng genug (nicht Queue/User/Privileged).
                'Processor Time',
            ]],
            'searchByAny' => true,
            'monitored'   => true,
            'filter'      => ['value_type' => [ITEM_VALUE_TYPE_FLOAT, ITEM_VALUE_TYPE_UINT64]],
        ]);

        // Pro CPU-Subtyp eine Rangfolge: Gesamtauslastung schlaegt idle schlaegt
        // Einzelkerne schlaegt die reine Index-Form. Pro Host wird genau EINE
        // Quelle genommen (unten), damit der Forecast nicht Gesamt, idle und
        // Teilkategorien mittelt (Review #6). cpu:idx steht UNTER cpu:core,
        // damit ein Host mit echtem per-Kern-Wert (hrProcessorLoad) nicht sein
        // Aggregat system.cpu.util[0] mit den Kernen mischt — dieselbe Vorrang-
        // folge wie im Panel (MetricExtractor nimmt die Index-Form als Fallback).
        static $CPU_PRIO = ['cpu:total' => 4, 'cpu:idle' => 3, 'cpu:core' => 2, 'cpu:idx' => 1];
        $meta = [];           // itemid => [hostid, metric('cpu'|'mem'), subtype|null]
        $host_cpu_sub = [];   // hid => gewaehlter cpu-subtype (hoechste Prio)
        foreach ($items as $it) {
            $c = $this->classify($it['key_']);
            if ($c === null) continue;
            $hid = (string) $it['hostid'];
            if ($c === 'mem') {
                $meta[(string) $it['itemid']] = [$hid, 'mem', null];
                continue;
            }
            // Die reine Index-Form unterscheidet Auslastung nicht von Leerlauf;
            // nennt der Item-NAME "idle", NICHT als Last nehmen (wie im Panel).
            if ($c === 'cpu:idx'
                    && stripos((string) ($it['name'] ?? ''), 'idle') !== false) {
                continue;
            }
            // cpu:total | cpu:idle | cpu:core | cpu:idx
            $meta[(string) $it['itemid']] = [$hid, 'cpu', $c];
            if (!isset($host_cpu_sub[$hid])
                    || ($CPU_PRIO[$c] ?? 0) > ($CPU_PRIO[$host_cpu_sub[$hid]] ?? 0)) {
                $host_cpu_sub[$hid] = $c;
            }
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
                [$hid, $metric, $subtype] = $m;
                // CPU: nur die pro Host gewaehlte Quelle; andere Subtypen (idle
                // neben Gesamt, oder Teilkategorien) wuerden sonst zu Unsinn
                // vermischt (80 % Auslastung + 20 % idle -> 50 %). Review #6.
                if ($metric === 'cpu' && $subtype !== ($host_cpu_sub[$hid] ?? null)) {
                    continue;
                }
                $v = (float) $r['value_avg'];
                if ($metric === 'cpu' && $subtype === 'cpu:idle') {
                    $v = max(0.0, 100.0 - $v);   // idle -> Auslastung
                }
                $clk = (int) $r['clock'];
                $sum[$hid][$metric][$clk] = ($sum[$hid][$metric][$clk] ?? 0.0) + $v;
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
        NtCache::set('resource_forecast', [$groupids, $days], $payload, self::CACHE_TTL);
        $this->out($payload, $_t0, false);
    }

    /**
     * Nur %-Items zulassen. Rueckgabe 'mem' | 'cpu:total' | 'cpu:idle' |
     * 'cpu:core' | 'cpu:idx' | null — der CPU-Subtyp steuert die Quellenwahl
     * pro Host (cpu:idx = reine Index-Form, niedrigste CPU-Prio, s. $CPU_PRIO).
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
        // CPU-% — nach Subtyp getrennt, damit der Aufrufer pro Host EINE Quelle
        // waehlen kann. Teilkategorien (system.cpu.util[,user] etc.) und die
        // geklammerte Form mit leerem Typ (Default = user/system) sind KEINE
        // Gesamtauslastung und fliegen raus (Review #6).
        if (strpos($key, 'hrProcessorLoad') !== false) {
            return 'cpu:core';
        }
        if ($key === 'system.cpu.util' || $key === 'system.cpu.utilization') {
            return 'cpu:total';
        }
        if (preg_match('/^system\.cpu\.util\[/', $key)) {
            if (strpos($key, 'idle') !== false) return 'cpu:idle';
            // Reine Index-Form system.cpu.util[0]/[1] (nur eine CPU-Nummer, KEIN
            // Typ, kein Komma) ist die Gesamtlast genau dieses Prozessors —
            // SNMP-Templates wie "TrueNAS CORE by SNMP" keyen ihren aus 100-idle
            // berechneten Aggregatwert so. Als cpu:idx werten (niedrigste CPU-
            // Prio): die Quellenwahl mittelt einen oder mehrere Indizes zu einem
            // %, aber ein echter cpu:total/idle/core gewinnt vorher — sonst
            // mischte ein Host mit hrProcessorLoad (core) sein Aggregat mit den
            // Kernen. Teilkategorien (system.cpu.util[,user]) mit Komma/Typ
            // bleiben draussen.
            if (preg_match('/^system\.cpu\.util\[\s*\d+\s*\]$/', $key)) {
                return 'cpu:idx';
            }
            return null;
        }
        // Windows: perf_counter auf "% Processor Time". Die _Total-Instanz ist
        // die Gesamtauslastung, Einzelkerne zaehlen als core (die Quellenwahl
        // pro Host nimmt dann Total). Spiegel des perf_counter-Zweigs in
        // MetricExtractor::extract() — beide zusammen pflegen.
        if (strpos($key, 'perf_counter') === 0 && stripos($key, 'Processor Time') !== false) {
            return stripos($key, '_Total') !== false ? 'cpu:total' : 'cpu:core';
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
        $sx = $sy = $sxx = $sxy = $syy = 0.0;
        foreach ($points as $clk => $v) {
            $x = (float) ($clk - $t0);
            $sx  += $x; $sy += $v; $sxx += $x * $x; $sxy += $x * $v; $syy += $v * $v;
        }
        $den = $n * $sxx - $sx * $sx;
        if ($den == 0.0) return null;
        $slope = ($n * $sxy - $sx * $sy) / $den;
        $icept = ($sy - $slope * $sx) / $n;
        // Bestimmtheitsmass R^2 der Geraden: 1 = die Punkte liegen sauber auf
        // einer Geraden, ~0 = Rauschen. Ein verrauschter Trend (typisch CPU)
        // macht eine Jahresprojektion zum Raten — das Frontend dimmt sie dann.
        $ssTot = $syy - $sy * $sy / $n;
        $ssRes = $syy - $icept * $sy - $slope * $sxy;
        $r2 = $ssTot > 1e-9 ? max(0.0, min(1.0, 1.0 - $ssRes / $ssTot)) : 1.0;
        $nowVal = $icept + $slope * ($now - $t0);
        return [
            'slope' => $slope,
            'now'   => max(0.0, min(100.0, $nowVal)),
            'n'     => $n,
            'r2'    => round($r2, 3),
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
