<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Actions;

use API;

/**
 * NetworkTopologyItems
 *
 * Liefert eine Pivot-Sicht: für eine Liste von Hostgroups und ein
 * Item-Key-Pattern (Wildcard) holt es alle matching Items + ihre
 * letzten Werte. Wird für den Items-Modus im Tabellen-Tab benutzt.
 *
 * Request (GET/POST):
 *   groupids[] = 1,2,...        (mind. 1 Hostgroup)
 *   pattern    = "vfs.fs.size[*,pused]"   (Item-Key Wildcard, * = beliebig)
 *
 * Pattern-Erklärung:
 *   - Wir akzeptieren glob-style Pattern: '*' matched jede Zeichenfolge
 *   - "vfs.fs.size[*,pused]" matched z.B. "vfs.fs.size[/,pused]",
 *     "vfs.fs.size[/var,pused]", etc.
 *   - Backend übersetzt das in ein SQL LIKE durch *.→% und _→_
 *
 * Response JSON:
 *   {
 *     "columns": [
 *       { "key": "/",     "label": "/",     "unit": "%" },
 *       { "key": "/var",  "label": "/var",  "unit": "%" },
 *       ...
 *     ],
 *     "rows": {
 *       "10656": {            // hostid
 *         "/":     45.2,
 *         "/var":  78.9,
 *         ...
 *       },
 *       ...
 *     }
 *   }
 *
 * Spalten-Erkennung:
 *   - Aus dem Item-Key extrahieren wir den "Discovery-Parameter"
 *     (z.B. "/var" aus "vfs.fs.size[/var,pused]") als Spalten-Label.
 *   - Wenn Pattern keinen [...]-Teil hat, nehmen wir den Item-Namen.
 */
class NetworkTopologyItems extends NetworkTopologyController {

    private const MAX_ITEMS = 5000;     // Schutz gegen riesige Pattern-Matches

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        if (!$this->requireAjax()) return false;
        $ret = $this->validateInput([
            'groupids' => 'array_id',
            'pattern'  => 'string|not_empty',
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
        $_t0 = microtime(true);
        if (!$this->throttle('items', 20, 10)) return;
        $groupids = $this->getInput('groupids', []);
        $pattern  = trim($this->getInput('pattern', ''));

        if (empty($groupids) || $pattern === '') {
            $this->respond(['error' => 'groupids and pattern required']);
            return;
        }
        // Schutz: zu kurze Pattern verbieten (sonst potenziell zigtausende Items)
        $stripped = str_replace('*', '', $pattern);
        if (strlen($stripped) < 3) {
            $this->respond(['error' => 'Pattern too short (min 3 non-wildcard chars)']);
            return;
        }
        // Schutz gegen Pattern-DoS: zu viele Wildcards oder uebermaessige
        // Laenge → Zabbix-LIKE-Filter wird teuer. Max 4 Wildcards + max 200
        // Zeichen + keine Control-Chars (CR/LF/Tab kann Log-Injection sein).
        if (strlen($pattern) > 200) {
            $this->respond(['error' => 'Pattern too long (max 200 chars)']);
            return;
        }
        if (substr_count($pattern, '*') > 4) {
            $this->respond(['error' => 'Pattern has too many wildcards (max 4)']);
            return;
        }
        if (preg_match('/[\x00-\x1F\x7F]/', $pattern)) {
            $this->respond(['error' => 'Pattern contains control characters']);
            return;
        }

        // Permissions
        $allowed_groups = API::HostGroup()->get([
            'output'   => ['groupid'],
            'groupids' => $groupids,
            'preservekeys' => true,
        ]);
        $allowed_ids = array_keys($allowed_groups);
        if (empty($allowed_ids)) {
            $this->respond(['error' => 'No accessible hostgroups']);
            return;
        }

        // Hosts der Gruppen sammeln
        $hosts = API::Host()->get([
            'output'   => ['hostid', 'host'],
            'groupids' => $allowed_ids,
            'preservekeys' => true,
        ]);
        if (empty($hosts)) {
            $this->respond(['columns' => [], 'rows' => new \stdClass()]);
            return;
        }
        $hostids = array_keys($hosts);

        // Zabbix 7.4 hat die Filesystem-Items im "Linux by Zabbix agent"-Template
        // von vfs.fs.size[...] auf vfs.fs.dependent.size[...] umgestellt (Dependent-
        // Item-Modell, Master = vfs.fs.get). Damit die Disk-Presets auf 6.x UND 7.4
        // matchen, machen wir das fuehrende "vfs.fs."-Segment per Wildcard tolerant:
        // "vfs.fs." -> "vfs.fs*" matcht sowohl vfs.fs.size[...] als auch
        // vfs.fs.dependent.size[...] (searchWildcardsEnabled: * -> beliebige Zeichen).
        $search_pattern = $pattern;
        if (strncmp($search_pattern, 'vfs.fs.', 7) === 0
                && strncmp($search_pattern, 'vfs.fs.dependent.', 17) !== 0) {
            $search_pattern = 'vfs.fs*' . substr($search_pattern, 7);
        }

        // Pattern → Wildcard-Suche via item.get search.
        // Zabbix unterstützt 'searchWildcardsEnabled' für Wildcard-Match
        // im 'search' Parameter.
        $items = API::Item()->get([
            'output'   => ['itemid', 'hostid', 'key_', 'name', 'description', 'units', 'value_type', 'lastvalue', 'lastclock'],
            'hostids'  => $hostids,
            'search'   => ['key_' => $search_pattern],
            'searchWildcardsEnabled' => true,
            'monitored' => true,
            'limit'    => self::MAX_ITEMS,
        ]);
        if (empty($items)) {
            $this->respond(['columns' => [], 'rows' => new \stdClass()]);
            return;
        }

        // Spalten-Label extrahieren: aus dem Discovery-Parameter im Key.
        // Beispiele:
        //   vfs.fs.size[/var,pused]      → "/var"
        //   net.if.in[eth0]              → "eth0"
        //   vm.memory.size[available]    → "available"
        //   icmpping                     → "icmpping" (kein [..]-Teil → ganzer Key)
        //
        // Heuristik: Wenn der Key Klammern hat, nimm den ersten Parameter.
        // Sonst nimm den ganzen Key.
        $columns_map = [];   // colKey → ['key' => ..., 'label' => ..., 'unit' => ...]
        $rows = [];          // hostid → [colKey => value, ...]
        // Fuer Tooltip + Sparkline-Lazyfetch: pro (hid, colKey) merken wir uns
        // die itemid + item_name + description. Nur der Item-Eintrag der auch
        // den Wert lieferte (worst-case wenn mehrere Items denselben colKey
        // matchen) wird gespeichert.
        $item_meta = [];      // hid → colKey → [id, name, desc]

        foreach ($items as $it) {
            $hid    = $it['hostid'];
            $key    = $it['key_'];
            $units  = $it['units'] ?? '';
            $vtype  = (int) ($it['value_type'] ?? 0);

            // Numerische Items (float, uint64) konvertieren — strings/text/log
            // ergeben in einer Pivot-Tabelle wenig Sinn.
            if ($vtype !== ITEM_VALUE_TYPE_FLOAT && $vtype !== ITEM_VALUE_TYPE_UINT64) {
                continue;
            }

            // Spalten-Label aus Key extrahieren
            $col_key = $this->extractColumnKey($key);

            // Spalten-Map updaten. Unit: erste NICHT-leere gewinnt — sonst kann
            // ein Sub-Item wie net.if.in["eth0",dropped] (units='') die echte
            // bps-Unit von net.if.in["eth0"] verdraengen (beide -> Spalten-Key "eth0").
            if (!isset($columns_map[$col_key])) {
                $columns_map[$col_key] = [
                    'key'   => $col_key,
                    'label' => $col_key,
                    'unit'  => $units,
                ];
            }
            elseif ($units !== '' && $columns_map[$col_key]['unit'] === '') {
                $columns_map[$col_key]['unit'] = $units;
            }

            // Wert
            $val = $it['lastvalue'] ?? null;
            if ($val !== null && $val !== '') {
                // (int) wuerde UINT64-Counter > PHP_INT_MAX (z.B. ifHCInOctets auf
                // Langlaeufern) auf PHP_INT_MAX kappen → solche Werte als
                // numerischen String behalten, sonst normaler int-Cast.
                $val = ($vtype === ITEM_VALUE_TYPE_FLOAT)
                    ? (float) $val
                    : (is_numeric($val) && (float) $val > PHP_INT_MAX ? $val : (int) $val);
                if (!isset($rows[$hid])) $rows[$hid] = [];
                // Falls Host mehrere Items mit gleichem col_key hat (z.B. doppelte
                // Discoverys), nehmen wir den höheren Wert (worst-case).
                if (!isset($rows[$hid][$col_key]) || $val > $rows[$hid][$col_key]) {
                    $rows[$hid][$col_key] = $val;
                    $item_meta[$hid][$col_key] = [
                        'id'   => (string) $it['itemid'],
                        'name' => (string) ($it['name'] ?? ''),
                        'desc' => (string) ($it['description'] ?? ''),
                        'vt'   => $vtype,
                    ];
                }
            }
        }

        // Spalten alphabetisch sortieren — gibt eine deterministische Sicht
        ksort($columns_map);
        $columns = array_values($columns_map);

        // Hostnames mitliefern damit das Frontend nicht extra mappen muss
        $host_meta = [];
        foreach ($rows as $hid => $_v) {
            $host_meta[$hid] = $hosts[$hid]['host'] ?? '';
        }

        $_payload = [
            'columns' => $columns,
            'rows'    => $rows ?: new \stdClass(),
            'hosts'   => $host_meta ?: new \stdClass(),
            // item_meta pro (hid, colKey): itemid + name + description +
            // value_type. Frontend nutzt das fuer Zellen-Tooltip und
            // fuer Sparkline-Lazyfetch via network.topology.item_history
            'item_meta' => $item_meta ?: new \stdClass(),
            'truncated' => count($items) >= self::MAX_ITEMS,
        ];
        NetworkTopologyDiag::record([
            'action'     => 'items',
            'elapsed_ms' => round((microtime(true) - $_t0) * 1000, 1),
            'bytes'      => strlen($this->encodeJson($_payload)),
            'cache_hit'  => false,
            'counts'     => ['items' => count($items), 'cols' => count($columns), 'hosts' => count($host_meta)],
        ]);
        $this->respond($_payload);
    }

    /**
     * Extrahiert das Spalten-Label aus einem Item-Key.
     *  - "vfs.fs.size[/var,pused]" → "/var"
     *  - "net.if.in[eth0]"         → "eth0"
     *  - "icmpping"                → "icmpping"
     *  - "vm.memory.size[available]" → "available"
     */
    private function extractColumnKey(string $key): string {
        $open = strpos($key, '[');
        if ($open === false) {
            return $key;
        }
        $close = strrpos($key, ']');
        if ($close === false || $close <= $open) {
            return $key;
        }
        $params = substr($key, $open + 1, $close - $open - 1);
        // Erster Parameter = Label
        $first = explode(',', $params)[0];
        return trim($first);
    }

    private function respond(array $data): void {
        $this->jsonResponse($data);
    }
}
