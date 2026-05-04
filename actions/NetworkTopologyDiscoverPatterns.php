<?php
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CController;
use CControllerResponseData;
use API;

/**
 * NetworkTopologyDiscoverPatterns
 *
 * Scannt die Items aller Hosts in den uebergebenen Hostgroups und gibt
 * eine Liste der distinct "Pattern-Stems" zurueck — also Item-Key-Muster
 * mit `*` an den Stellen die zwischen Items variieren.
 *
 * Heuristik fuer den Stem:
 *   - Items ohne `[..]`           -> Stem == Item-Key
 *   - Items mit `[a]`             -> Stem == prefix[*]
 *   - Items mit `[a,b,c,...]`     -> Stem == prefix[*,b,c,...] (erster Param zu *,
 *                                   Rest behalten — das ist der haeufigste Fall in
 *                                   Zabbix-Templates: erster Param ist Discovery-
 *                                   Wert, Rest ist Type/Mode)
 *
 * Filter:
 *   - Nur numerische Items (FLOAT / UINT64) — Pivot kann eh nichts anderes
 *   - Nur monitored Items
 *   - Quotes in Params werden gestrippt damit "eth0" und eth0 gleich bucketed werden
 *
 * Cap:
 *   - max 500 distinct Stems im Output (sortiert nach hosts desc, dann items desc)
 *   - max 20000 Items pro Scan (Performance)
 *
 * Request:
 *   groupids[] = 1,2,...
 *
 * Response:
 *   { "patterns": [
 *     { "stem": "vfs.fs.size[*,pused]", "items": 45, "hosts": 14 },
 *     { "stem": "system.cpu.util",      "items": 14, "hosts": 14 },
 *     ...
 *   ] }
 */
class NetworkTopologyDiscoverPatterns extends CController {

    private const MAX_ITEMS  = 20000;
    private const MAX_STEMS  = 500;

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        $ret = $this->validateInput([
            'groupids' => 'array_id',
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
        $groupids = $this->getInput('groupids', []);
        if (empty($groupids)) {
            $this->respond(['patterns' => []]);
            return;
        }

        // Permission-Filter: User darf die Hostgroups sehen?
        $allowed_groups = API::HostGroup()->get([
            'output'       => ['groupid'],
            'groupids'     => $groupids,
            'preservekeys' => true,
        ]);
        $allowed_ids = array_keys($allowed_groups);
        if (empty($allowed_ids)) {
            $this->respond(['patterns' => []]);
            return;
        }

        // Hosts der Gruppen sammeln
        $hosts = API::Host()->get([
            'output'       => ['hostid'],
            'groupids'     => $allowed_ids,
            'preservekeys' => true,
        ]);
        if (empty($hosts)) {
            $this->respond(['patterns' => []]);
            return;
        }
        $hostids = array_keys($hosts);

        // Items holen — nur monitored, value_type-Filter macht der Caller
        $items = API::Item()->get([
            'output'    => ['hostid', 'key_', 'value_type'],
            'hostids'   => $hostids,
            'monitored' => true,
            'limit'     => self::MAX_ITEMS,
        ]);
        if (empty($items)) {
            $this->respond(['patterns' => []]);
            return;
        }

        // Nur numerische Value-Types behalten
        $stemMap = [];   // stem => ['items' => int, 'hosts' => array<hostid,bool>]
        foreach ($items as $it) {
            $vt = (int) ($it['value_type'] ?? 0);
            if ($vt !== ITEM_VALUE_TYPE_FLOAT && $vt !== ITEM_VALUE_TYPE_UINT64) {
                continue;
            }
            $stem = $this->stemFromKey($it['key_']);
            if ($stem === null) continue;

            if (!isset($stemMap[$stem])) {
                $stemMap[$stem] = ['items' => 0, 'hosts' => []];
            }
            $stemMap[$stem]['items']++;
            $stemMap[$stem]['hosts'][$it['hostid']] = true;
        }

        // Output bauen + sortieren
        $patterns = [];
        foreach ($stemMap as $stem => $info) {
            $patterns[] = [
                'stem'  => $stem,
                'items' => $info['items'],
                'hosts' => count($info['hosts']),
            ];
        }
        // Sort: hosts desc, dann items desc, dann alphabetisch fuer Determinismus
        usort($patterns, function($a, $b) {
            if ($a['hosts'] !== $b['hosts']) return $b['hosts'] - $a['hosts'];
            if ($a['items'] !== $b['items']) return $b['items'] - $a['items'];
            return strcmp($a['stem'], $b['stem']);
        });
        if (count($patterns) > self::MAX_STEMS) {
            $patterns = array_slice($patterns, 0, self::MAX_STEMS);
        }

        $this->respond(['patterns' => $patterns]);
    }

    /**
     * Berechnet den Stem fuer einen Item-Key.
     * - "vfs.fs.size[/var,pused]" -> "vfs.fs.size[*,pused]"
     * - "vfs.dev.read.rate[sda]"  -> "vfs.dev.read.rate[*]"
     * - "system.cpu.util"         -> "system.cpu.util"
     * - "icmpping[]"              -> "icmpping[*]"
     * Returns null bei broken keys.
     */
    private function stemFromKey(string $key): ?string {
        $open = strpos($key, '[');
        if ($open === false) {
            return $key;   // kein [..]-Teil, Key selbst ist der Stem
        }
        $close = strrpos($key, ']');
        if ($close === false || $close <= $open) {
            return null;   // unbalanced
        }
        $prefix   = substr($key, 0, $open);
        $paramStr = substr($key, $open + 1, $close - $open - 1);
        $params = explode(',', $paramStr);
        // Quotes strippen damit "BR-MAILCOW" und BR-MAILCOW gleich gemappt werden
        $params = array_map(function($p) {
            return trim(trim($p), '"');
        }, $params);
        // Erster Param wird zu '*' (in Zabbix-Templates ist Param[0] meistens
        // der Discovery-Wert: FS-Pfad, Device-Name, Interface). Rest bleibt
        // konkret damit "[*,pused]" und "[*,used]" verschiedene Stems sind.
        if (count($params) > 0) {
            $params[0] = '*';
        }
        return $prefix . '[' . implode(',', $params) . ']';
    }

    private function respond(array $data): void {
        $this->setResponse(new CControllerResponseData([
            'main_block' => json_encode($data, JSON_UNESCAPED_SLASHES)
        ]));
    }
}
