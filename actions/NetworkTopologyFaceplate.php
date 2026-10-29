<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Actions;

use API;
use Modules\NetworkTopology\Topology\FaceplateBuilder;

/**
 * NetworkTopologyFaceplate
 *
 * Portliste EINES Switches fuer das Faceplate-Widget.
 *
 * Request (GET):
 *   hostid = 10656
 *   layout = auto | 8+2 | 16+2 | 24+2 | 24+4 | 48+4 | 48+6
 *
 * Response JSON:
 *   {
 *     "host":   "sw-etage1",
 *     "layout": "24+2", "copper": 24, "sfp": 2,
 *     "ports":  [ { n, ifindex, kind, name, alias, oper, admin, speed,
 *                   in, out, errors, problem, poe, nb, itemid }, ... ],
 *     "extra":  0          // Frontports, die nicht in den Zuschnitt passten
 *   }
 *
 * Eigene Action statt network.topology.data: die arbeitet auf Hostgruppen,
 * verdichtet pro Host und verwirft genau die Ports, die eine Frontansicht
 * zeigen muss (admin-down, notPresent). Hier geht es um einen Host und alle
 * seine Buchsen — ein Item-Request, ein Trigger-Request.
 */
class NetworkTopologyFaceplate extends NetworkTopologyController {

    private const MAX_ITEMS = 5000;

    /** PoE-Verlauf: Fenster (6 h) und Hoechstzahl an Punkten fuer die Sparkline. */
    private const POE_HISTORY_WINDOW = 21600;
    private const POE_HISTORY_POINTS = 48;

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        if (!$this->requireAjax()) return false;
        $ret = $this->validateInput([
            'hostid' => 'required|id',
            'layout' => 'string',
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
        if (!$this->throttle('faceplate', 30, 10)) return;

        $hostid = (string) $this->getInput('hostid');
        $layout = (string) $this->getInput('layout', 'auto');
        if ($layout !== 'auto' && !isset(FaceplateBuilder::LAYOUTS[$layout])) {
            $layout = 'auto';
        }

        // Rechte: host.get liefert nur, was der Benutzer sehen darf.
        $hosts = API::Host()->get([
            'output'  => ['hostid', 'host', 'name'],
            'hostids' => [$hostid],
        ]);
        if (!$hosts) {
            $this->jsonResponse(['error' => _('No permissions to referred object or it does not exist!')]);
            return;
        }
        $host = $hosts[0];

        // Nur die Interface-, PoE- und LLDP-Items. searchByAny mit Wildcards
        // haelt den Request klein, auch auf einem Core-Switch mit tausenden
        // Items fuer VLANs, Sensoren und Module.
        $items = API::Item()->get([
            'output'    => ['itemid', 'key_', 'name', 'lastvalue', 'value_type'],
            'hostids'   => [$hostid],
            'monitored' => true,
            'search'    => ['key_' => [
                '*ifOperStatus*', '*ifAdminStatus*', '*ifType*', '*Speed*',
                '*Octets*', '*Errors*', '*ifName*', '*ifDescr*', '*ifAlias*',
                'net.if.*', 'pethPsePortDetectionStatus*', 'lldpRem*', 'nt.if.stp[*',
                // PoE: Klasse je Port (pethPsePortPowerClassifications) und das
                // Switch-Budget (nt.poe.nominal/used aus nt_poe_snmp).
                'pethPsePortPowerClassifications*', 'nt.poe.nominal', 'nt.poe.used',
                // nt.stp.walk traegt die BRIDGE-MIB-Tabellen fuer das zweite
                // Loop-Ende (StpLoopResolver dekodiert daraus den Partner-Port).
                'nt.stp.walk',
                // UniFi-Ports (Vorlage „UniFi Network API – Device"): die Portliste
                // kommt als eigene port.<feld>[<idx>]-Items statt per SNMP. '*Speed*'
                // oben faengt nur port.maxSpeed (grosses S), nicht port.speed/state/
                // connector/poe — die darum hier.
                'port.state[*', 'port.speed[*', 'port.connector[*', 'port.poe.*',
                // Per-Port-Traffic (klassische API, bytes/s) -> Faceplate in/out.
                'port.rx[*', 'port.tx[*',
            ]],
            'searchByAny'            => true,
            'searchWildcardsEnabled' => true,
            'limit'     => self::MAX_ITEMS,
        ]);

        // Manche Items duerfen auf einem grossen Core-Switch (Tausende VLAN-/
        // Sensor-Items) nicht aus dem auf MAX_ITEMS limitierten Haupt-Request
        // fallen. STP: der Loop-Partner (nt.stp.walk) UND das Block-Badge
        // (nt.if.stp[*]). PoE: der liefernde Blitz (pethPsePortDetectionStatus),
        // die Klasse je Port (pethPsePortPowerClassifications) und das Switch-
        // Budget (nt.poe.nominal/used) — sonst verschwinden Klasse und Budget auf
        // einem grossen Switch lautlos, die dokumentierte Fehlerart aus CLAUDE.md.
        // Darum gezielt nachholen und ueber die itemid mergen (wenige Items,
        // eigenes kleines Limit).
        $protectedItems = API::Item()->get([
            'output'    => ['itemid', 'key_', 'name', 'lastvalue', 'value_type'],
            'hostids'   => [$hostid],
            'monitored' => true,
            'search'    => ['key_' => [
                'nt.if.stp[*', 'nt.stp.walk',
                'pethPsePortDetectionStatus*', 'pethPsePortPowerClassifications*',
                'nt.poe.nominal', 'nt.poe.used',
            ]],
            'searchByAny'            => true,
            'searchWildcardsEnabled' => true,
            'limit'     => 500,
        ]);
        if ($protectedItems) {
            $by_id = [];
            foreach ($items as $it) {
                $by_id[(string) $it['itemid']] = $it;
            }
            foreach ($protectedItems as $it) {
                $by_id[(string) $it['itemid']] = $it;
            }
            $items = array_values($by_id);
        }

        // Offene Probleme je Item: die Severity faerbt den Port-Rahmen.
        $problems = [];
        if ($items) {
            $triggers = API::Trigger()->get([
                'output'        => ['triggerid', 'priority'],
                'hostids'       => [$hostid],
                'filter'        => ['value' => TRIGGER_VALUE_TRUE],
                'monitored'     => true,
                'skipDependent' => true,
                'selectItems'   => ['itemid'],
            ]);
            foreach ($triggers as $t) {
                foreach ($t['items'] ?? [] as $ti) {
                    $iid = (string) $ti['itemid'];
                    $problems[$iid] = max($problems[$iid] ?? -1, (int) $t['priority']);
                }
            }
        }

        $face = FaceplateBuilder::build($items, $layout, $problems);

        // Verlauf der PoE-Auslastung (nt.poe.used, Watt) — nur wenn der Switch
        // ueberhaupt ein Budget liefert. Als kleine Sparkline neben der
        // Budget-Zeile: dass die Last steigt, ist die Frage vor der Frage
        // "haengt sie am Limit?". Fehlt die History (frischer Host, kein
        // Provider), bleibt das Array leer und das Faceplate zeichnet nur den
        // Ist-Wert wie bisher.
        $poe_history = $face['poe_budget'] !== null
            ? $this->poeUsedHistory($items) : [];
        $payload = ['host' => (string) ($host['name'] ?: $host['host'])] + $face
            + ['poe_history' => $poe_history]
            + ['truncated' => count($items) >= self::MAX_ITEMS];

        // Einmal kodieren: die Laenge braucht das Diag-Log, den Text die Antwort.
        $json = $this->encodeJson($payload);
        NetworkTopologyDiag::record([
            'action'     => 'faceplate',
            'elapsed_ms' => round((microtime(true) - $_t0) * 1000, 1),
            'bytes'      => strlen($json),
            'cache_hit'  => false,
            'counts'     => ['items' => count($items), 'ports' => count($face['ports'])],
        ]);
        $this->jsonResponseRaw($json);
    }

    /**
     * Verlauf der PoE-Auslastung (nt.poe.used, Watt) ueber das History-Fenster,
     * auf hoechstens POE_HISTORY_POINTS Werte ausgeduennt — nur die Zahlenreihe
     * fuer die Sparkline, aelteste zuerst. Leer, wenn es das Item nicht gibt
     * oder keine History vorliegt.
     *
     * API::History()->get liest den konfigurierten Storage (SQL, ClickHouse,
     * Elasticsearch) — also derselbe ClickHouse-sichere Weg wie die Spark-Action,
     * NICHT der Direkt-SQL-Scan aus NetworkTopologyData (siehe #26).
     *
     * @param array $items Items der Faceplate-Abfrage (mit value_type)
     * @return list<float>
     */
    private function poeUsedHistory(array $items): array {
        $used = null;
        foreach ($items as $it) {
            if (($it['key_'] ?? '') === 'nt.poe.used') {
                $used = $it;
                break;
            }
        }
        if ($used === null) {
            return [];
        }
        $vtype = (int) ($used['value_type'] ?? ITEM_VALUE_TYPE_UINT64);
        // Nur numerische Werttypen tragen eine Watt-Reihe.
        if ($vtype !== ITEM_VALUE_TYPE_FLOAT && $vtype !== ITEM_VALUE_TYPE_UINT64) {
            return [];
        }
        $hist = API::History()->get([
            'output'    => ['clock', 'value'],
            'itemids'   => [(string) $used['itemid']],
            'history'   => $vtype,
            'time_from' => time() - self::POE_HISTORY_WINDOW,
            'sortfield' => 'clock',
            'sortorder' => 'ASC',
        ]);
        if (!$hist) {
            return [];
        }
        $werte = [];
        foreach ($hist as $h) {
            $werte[] = (float) $h['value'];
        }
        return self::ausduennen($werte, self::POE_HISTORY_POINTS);
    }

    /**
     * Eine Zahlenreihe auf hoechstens $max Werte ausduennen — gleichmaessig
     * ueber die Laenge gegriffen, erster und letzter Wert bleiben erhalten.
     * Kuerzere Reihen kommen unveraendert zurueck.
     *
     * @param list<float> $werte
     * @return list<float>
     */
    private static function ausduennen(array $werte, int $max): array {
        $n = count($werte);
        if ($n <= $max || $max <= 1) {
            return $werte;
        }
        $out = [];
        // (n-1)/(max-1): verteilt die Stuetzstellen so, dass Index 0 und n-1
        // dabei sind. round() statt floor, damit kein systematischer Drift
        // nach vorn entsteht.
        $schritt = ($n - 1) / ($max - 1);
        for ($i = 0; $i < $max; $i++) {
            $out[] = $werte[(int) round($i * $schritt)];
        }
        return $out;
    }
}
