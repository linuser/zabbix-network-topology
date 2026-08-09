<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Actions;

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
class NetworkTopologyDiscoverPatterns extends NetworkTopologyController {

    private const MAX_ITEMS  = 20000;
    private const MAX_STEMS  = 500;
    private const CACHE_TTL  = 60;      // 60s — Permission-Drift-Schutz: wenn ein
                                         // Admin Hostgroup-Permissions entzieht,
                                         // sieht der User max 1min lang noch alte
                                         // Pattern-Stems aus entzogenen Gruppen.
                                         // Vorher 300s war zu lang fuer den
                                         // Stale-Risk vs. Performance-Trade-off.

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        if (!$this->requireAjax()) return false;
        $ret = $this->validateInput([
            'groupids' => 'array_id',
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
        if (!$this->throttle('discover_patterns')) return;
        $_t0 = microtime(true);
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

        // Cache-Lookup: Item-Scan ueber 20k Items kostet 1-2s, aber Pattern-
        // Stems aendern sich selten. Gecacht wird ueber die ERLAUBTEN groupids
        // (nicht die angefragten), damit der Permission-Filter beim Cache-Hit
        // gewahrt bleibt (User A sieht andere Gruppen als User B → andere
        // Stems). User-ID + Schema-Version haengt NtCache selbst an den Key,
        // Sortierung der IDs ebenfalls.
        $cached = NtCache::get('discover_patterns', [$allowed_ids]);
        if ($cached !== null) {
            $cached['cached'] = true;
            NetworkTopologyDiag::record([
                'action'     => 'discover',
                'elapsed_ms' => round((microtime(true) - $_t0) * 1000, 1),
                'bytes'      => strlen($this->encodeJson($cached)),
                'cache_hit'  => true,
                'counts'     => ['patterns' => count($cached['patterns'] ?? [])],
            ]);
            $this->respond($cached);
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
        // Wenn das Limit erreicht ist, ist der Scan vermutlich incomplete —
        // weiter unten wird das Flag mitgeschickt damit das Frontend warnen
        // kann statt unvollstaendige Pattern-Counts als wahr darzustellen.
        $itemsTruncated = count($items) >= self::MAX_ITEMS;

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
        $stemsTruncated = false;
        if (count($patterns) > self::MAX_STEMS) {
            $patterns = array_slice($patterns, 0, self::MAX_STEMS);
            $stemsTruncated = true;
        }

        $payload = [
            'patterns'         => $patterns,
            'truncated'        => $itemsTruncated,
            'stems_truncated'  => $stemsTruncated,
        ];
        // Cache-Write fuer naechste Aufrufe innerhalb der TTL — wir cachen
        // nur das Roh-Payload, das 'cached'-Flag wird beim Hit injiziert.
        NtCache::set('discover_patterns', [$allowed_ids], $payload, self::CACHE_TTL);
        $payload['cached'] = false;
        NetworkTopologyDiag::record([
            'action'     => 'discover',
            'elapsed_ms' => round((microtime(true) - $_t0) * 1000, 1),
            'bytes'      => strlen($this->encodeJson($payload)),
            'cache_hit'  => false,
            'counts'     => ['patterns' => count($patterns)],
        ]);
        $this->respond($payload);
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
        $params   = $this->splitParams($paramStr);
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

    /**
     * Quote-aware Komma-Split fuer Item-Key-Parameter. Standard-explode(',')
     * mis-splittet bei Real-Zabbix-Keys wie:
     *   log[/var/log/syslog,"a,b,c"]   <- Komma in quoted param
     *   web.page.regexp[host,"GET ,POST"]
     *   vfs.file.regexp[/etc/hosts,"a,b"]
     * Diese Keys existieren in Standard-Zabbix-Templates und sind sonst
     * fehlklassifiziert (verschmolzen in falsche Stems).
     */
    private function splitParams(string $paramStr): array {
        if ($paramStr === '') return [''];
        $parts    = [];
        $cur      = '';
        $inQuotes = false;
        $len      = strlen($paramStr);
        for ($i = 0; $i < $len; $i++) {
            $ch = $paramStr[$i];
            if ($ch === '"') {
                $inQuotes = !$inQuotes;
                $cur .= $ch;
            } elseif ($ch === ',' && !$inQuotes) {
                $parts[] = $cur;
                $cur = '';
            } else {
                $cur .= $ch;
            }
        }
        $parts[] = $cur;
        return $parts;
    }

    private function respond(array $data): void {
        $this->jsonResponse($data);
    }
}
