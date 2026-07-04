<?php
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CController;
use CControllerResponseData;
use API;

/**
 * NetworkTopologyCapacityForecast
 *
 * Kapazitaets-Forecast: holt fuer die Edge-Endpunkte des Frontends die
 * Traffic-Trends (stuendliche value_avg) und legt pro Host+Richtung eine
 * lineare Regression durch. Das Frontend kombiniert die Host-Geraden zu
 * Edge-Prognosen ("Link erreicht 80% in ~N Tagen") — die Summe zweier
 * Geraden ist wieder eine Gerade, deshalb reichen slope+now pro Host und
 * die stuendlichen Rohserien muessen nie uebers Netz.
 *
 * Request:  groupids[] (Pflicht), hostids[] (Pflicht, max 200 — die
 *           Edge-Endpunkte mit bekannter Kapazitaet), days (7|14|30|60|90,
 *           default 30)
 * Response: { days: N, hosts: { hostid: { in:  {slope, now, n}|null,
 *                                          out: {slope, now, n}|null } } }
 *           slope = bps pro Sekunde, now = Geradenwert bei t=jetzt (bps),
 *           n = Anzahl Stundenpunkte der Regression.
 *
 * Die Traffic-Klassifikation spiegelt die data-Action (dort per Branch-
 * Reihenfolge geloest): Health-/Speed-Keys sind KEIN Traffic, net.if-
 * Agent-Items werden ueber den Item-NAMEN (received/sent) gerichtet,
 * SNMP-Octets werden x8 auf bps gerechnet.
 */
class NetworkTopologyCapacityForecast extends CController {

    private const MAX_HOSTS  = 200;
    private const CACHE_TTL  = 1800;   // Trends rollen stuendlich — 30min reicht
    private const MIN_POINTS = 24;     // < 1 Tag Stundenwerte → keine Aussage
    private const ROW_BUDGET = 40000;  // max erwartete Rows pro trend.get-Call

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
            'hostids'  => 'array_id',
            'days'     => 'in 7,14,30,60,90',
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
        $_t0      = microtime(true);
        $groupids = $this->getInput('groupids', []);
        $hostids  = array_slice($this->getInput('hostids', []), 0, self::MAX_HOSTS);
        $days     = (int) $this->getInput('days', 30);

        if (!$groupids || !$hostids) {
            $this->out(['days' => $days, 'hosts' => (object) []], $_t0, false);
            return;
        }

        // APCu-Cache: user-scoped (Permissions!). Trends aendern sich nur
        // stuendlich — der Cache nimmt Tab-Wechseln/Reloads den DB-Druck.
        $uid = (int) (\CWebUser::$data['userid'] ?? 0);
        $gk = array_map('strval', $groupids);
        sort($gk);
        $hk = array_map('strval', $hostids);
        sort($hk);
        $cache_key = 'nt_fc_' . $uid . '_'
            . md5($days . '|' . implode(',', $gk) . '|' . implode(',', $hk));
        if ($uid > 0 && function_exists('apcu_fetch')) {
            $ok = false;
            $cached = apcu_fetch($cache_key, $ok);
            if ($ok && is_array($cached)) {
                $this->out($cached, $_t0, true);
                return;
            }
        }

        // Permission-Schnitt: nur Hosts die der User in diesen Gruppen sieht.
        $hosts = API::Host()->get([
            'output'          => ['hostid'],
            'groupids'        => $groupids,
            'hostids'         => $hostids,
            'monitored_hosts' => true,
            'preservekeys'    => true,
        ]);
        if (!$hosts) {
            $this->out(['days' => $days, 'hosts' => (object) []], $_t0, false);
            return;
        }

        // trend.get kann nur numerische Items — Filter spart die Text-Items
        // (LLDP & Co.) gleich im Item-Call weg.
        $items = API::Item()->get([
            'output'      => ['itemid', 'hostid', 'key_', 'name'],
            'hostids'     => array_keys($hosts),
            'search'      => ['key_' => [
                'net.if', 'ifInOctets', 'ifOutOctets', 'ifHCInOctets', 'ifHCOutOctets',
            ]],
            'searchByAny' => true,
            'monitored'   => true,
            'filter'      => ['value_type' => [ITEM_VALUE_TYPE_FLOAT, ITEM_VALUE_TYPE_UINT64]],
        ]);

        $meta = [];   // itemid => [hostid, dir, multiplikator]
        foreach ($items as $it) {
            $cls = $this->classifyTraffic($it['key_'], $it['name']);
            if ($cls === null) continue;
            $meta[(string) $it['itemid']] = [(string) $it['hostid'], $cls[0], $cls[1]];
        }
        if (!$meta) {
            $this->out(['days' => $days, 'hosts' => (object) []], $_t0, false);
            return;
        }

        $now   = time();
        $from  = $now - $days * 86400;
        $hours = $days * 24;
        // Chunk-Groesse so, dass items*stunden das Row-Budget nicht sprengt
        // (90d = 2160h → 18 Items/Call; 30d = 720h → 55 Items/Call).
        $chunk_size = max(1, (int) floor(self::ROW_BUDGET / max(1, $hours)));

        // Stundensummen pro Host+Richtung: clock => sum(value_avg * mult)
        $series = [];
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
                $clk = (int) $r['clock'];
                $series[$m[0]][$m[1]][$clk]
                    = ($series[$m[0]][$m[1]][$clk] ?? 0.0) + (float) $r['value_avg'] * $m[2];
            }
            unset($rows);
        }

        $out_hosts = [];
        foreach ($series as $hid => $dirs) {
            $entry = ['in' => null, 'out' => null];
            foreach (['in', 'out'] as $dir) {
                if (isset($dirs[$dir])) {
                    $entry[$dir] = $this->regress($dirs[$dir], $now);
                }
            }
            if ($entry['in'] !== null || $entry['out'] !== null) {
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
     * Spiegel der Traffic-Klassifikation aus NetworkTopologyData (dort per
     * Branch-Reihenfolge geloest — Aenderungen synchron halten!).
     *
     * @return array{0:string,1:float}|null  [Richtung, Multiplikator] oder
     *                                       null wenn kein Traffic-Item.
     */
    private function classifyTraffic(string $key, string $name): ?array {
        // Health-/Speed-/Status-Keys matchen die net.if-/IF-MIB-Substrings
        // ebenfalls, sind aber kein Traffic.
        foreach (['ifOperStatus', 'ifAdminStatus', 'ifInErrors', 'ifOutErrors',
                  'ifInDiscards', 'ifOutDiscards', 'ifHighSpeed', 'ifSpeed'] as $ex) {
            if (strpos($key, $ex) !== false) return null;
        }
        if (preg_match('/net\.if\.(?:in|out)\[[^\]]*,(?:errors|dropped)\]/', $key)) {
            return null;
        }
        if (strpos($key, 'net.if') === 0) {
            // Agent-Items liefern bits/s; Richtung steckt im Namen.
            $n = strtolower($name);
            if (strpos($n, 'received') !== false || strpos($n, 'bits in') !== false) {
                return ['in', 1.0];
            }
            if (strpos($n, 'sent') !== false || strpos($n, 'bits out') !== false) {
                return ['out', 1.0];
            }
            return null;
        }
        if (strpos($key, 'ifHCInOctets') !== false || strpos($key, 'ifInOctets') !== false) {
            return ['in', 8.0];    // octets/s → bits/s
        }
        if (strpos($key, 'ifHCOutOctets') !== false || strpos($key, 'ifOutOctets') !== false) {
            return ['out', 8.0];
        }
        return null;
    }

    /**
     * Kleinste-Quadrate-Gerade durch (clock, bps).
     * slope = bps pro Sekunde, now = Geradenwert bei $now (geclampt >= 0).
     */
    private function regress(array $points, int $now): ?array {
        $n = count($points);
        if ($n < self::MIN_POINTS) return null;
        ksort($points);
        $t0 = array_key_first($points);
        $sx = $sy = $sxx = $sxy = 0.0;
        foreach ($points as $clk => $v) {
            $x = (float) ($clk - $t0);
            $sx  += $x;
            $sy  += $v;
            $sxx += $x * $x;
            $sxy += $x * $v;
        }
        $den = $n * $sxx - $sx * $sx;
        if ($den == 0.0) return null;
        $slope = ($n * $sxy - $sx * $sy) / $den;
        $icept = ($sy - $slope * $sx) / $n;
        return [
            'slope' => $slope,
            'now'   => max(0.0, $icept + $slope * ($now - $t0)),
            'n'     => $n,
        ];
    }

    private function out(array $payload, float $t0, bool $cache_hit): void {
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE);
        NetworkTopologyDiag::record([
            'action'     => 'capacity_forecast',
            'elapsed_ms' => round((microtime(true) - $t0) * 1000, 1),
            'bytes'      => strlen($json),
            'cache_hit'  => $cache_hit,
            'counts'     => ['hosts' => is_array($payload['hosts'] ?? null) ? count($payload['hosts']) : 0],
        ]);
        $this->setResponse(new CControllerResponseData(['main_block' => $json]));
    }
}
