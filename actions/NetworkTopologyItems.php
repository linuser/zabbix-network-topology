<?php
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CController;
use CControllerResponseData;
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
class NetworkTopologyItems extends CController {

    private const MAX_ITEMS = 5000;     // Schutz gegen riesige Pattern-Matches

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
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

        // Pattern → Wildcard-Suche via item.get search.
        // Zabbix unterstützt 'searchWildcardsEnabled' für Wildcard-Match
        // im 'search' Parameter.
        $items = API::Item()->get([
            'output'   => ['itemid', 'hostid', 'key_', 'name', 'units', 'value_type', 'lastvalue', 'lastclock'],
            'hostids'  => $hostids,
            'search'   => ['key_' => $pattern],
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

            // Spalten-Map updaten (wir nehmen das erste vorkommende Unit)
            if (!isset($columns_map[$col_key])) {
                $columns_map[$col_key] = [
                    'key'   => $col_key,
                    'label' => $col_key,
                    'unit'  => $units,
                ];
            }

            // Wert
            $val = $it['lastvalue'] ?? null;
            if ($val !== null && $val !== '') {
                $val = ($vtype === ITEM_VALUE_TYPE_FLOAT)
                    ? (float) $val
                    : (int) $val;
                if (!isset($rows[$hid])) $rows[$hid] = [];
                // Falls Host mehrere Items mit gleichem col_key hat (z.B. doppelte
                // Discoverys), nehmen wir den höheren Wert (worst-case).
                if (!isset($rows[$hid][$col_key]) || $val > $rows[$hid][$col_key]) {
                    $rows[$hid][$col_key] = $val;
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

        $this->respond([
            'columns' => $columns,
            'rows'    => $rows ?: new \stdClass(),
            'hosts'   => $host_meta ?: new \stdClass(),
            'truncated' => count($items) >= self::MAX_ITEMS,
        ]);
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
        $this->setResponse(new CControllerResponseData([
            'main_block' => json_encode($data, JSON_UNESCAPED_SLASHES)
        ]));
    }
}
