<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CController;
use CControllerResponseData;
use API;

/**
 * NetworkTopologyCompliance
 *
 * Compliance-Checks pro Host in den ausgewaehlten Hostgroups. Liefert
 * pro Host die Ergebnisse + Aggregat-Counts. Kein cache: read-only,
 * relativ leicht (1 Host.get + 1 Problem.get + 1 Maintenance.get).
 *
 * Checks:
 *   snmp_v2          — Interface mit SNMP-Version 1 oder 2 (statt v3)
 *   snmp_v3          — Interface mit SNMP-Version 3 (positiv markiert)
 *   no_tls           — Agent ohne TLS/PSK (tls_connect & tls_accept = 1=none)
 *   no_proxy         — Host direkt am Server (kein Proxy / keine Proxy-Group)
 *   no_inventory     — inventory_mode = disabled
 *   no_location      — kein location_lat oder location_lon im Inventory
 *   no_template      — Host hat keinen Parent-Template
 *   stale_problem    — kritisches Problem (sev>=4) aelter als 7 Tage
 *   mtnc_no_comment  — Maintenance aktiv aber description leer
 *
 * Request: groupids[] (Pflicht).
 * Response: { hosts: [...], aggregate: { check: count, ... }, total: N }
 */
class NetworkTopologyCompliance extends CController {

    private const STALE_PROBLEM_DAYS = 7;
    private const MAX_GROUPS = 100;

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
        $ret = $this->validateInput(['groupids' => 'array_id']);
        if (!$ret) {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['error' => 'Invalid input'])
            ]));
        }
        return $ret;
    }

    protected function checkPermissions(): bool {
        // Admin+: der Endpoint liefert eine Security-Posture-Karte pro Host
        // ("Agent ohne TLS", "SNMP v1/v2c", "stale Krit-Problem") — fuer
        // Read-only-User waere das eine Recon-Hilfe (welche Hosts sind am
        // schwaechsten konfiguriert). Frontend blendet den Tab analog aus.
        return $this->getUserType() >= USER_TYPE_ZABBIX_ADMIN;
    }

    protected function doAction(): void {
        $_t0 = microtime(true);
        $groupids = $this->getInput('groupids', []);
        if (!$groupids) {
            $this->respond(['hosts' => [], 'aggregate' => (object)[], 'total' => 0]);
            return;
        }
        if (count($groupids) > self::MAX_GROUPS) {
            $groupids = array_slice($groupids, 0, self::MAX_GROUPS);
        }

        // Kurzer APCu-Cache (60s, user-scoped): 1 Host.get ueber bis zu 100
        // Gruppen mit selectInterfaces/Inventory/Templates + Problem.get +
        // Maintenance.get ist teuer genug dass ein authentifizierter User den
        // Endpoint nicht im Sekundentakt haemmern soll.
        $cache_ids = array_map('strval', $groupids);
        sort($cache_ids);
        $uid = (int) (\CWebUser::$data['userid'] ?? 0);
        $cache_key = ($uid > 0 && function_exists('apcu_fetch'))
            ? 'nt_compl_' . $uid . '_' . md5(implode(',', $cache_ids))
            : '';
        if ($cache_key !== '') {
            $ok = false;
            $cached = apcu_fetch($cache_key, $ok);
            if ($ok && is_array($cached)) {
                $this->respond($cached);
                return;
            }
        }

        // Hosts mit allen benoetigten Feldern in einem Call.
        // selectInterfaces.details.version: 1=v1, 2=v2c, 3=v3 (nur fuer SNMP-Type).
        // tls_connect/tls_accept: 1=none, 2=PSK, 4=cert. Wir flaggen wenn BEIDES none.
        // inventory_mode: -1=disabled, 0=manual, 1=automatic.
        $hosts = API::Host()->get([
            'output'                => ['hostid', 'host', 'name', 'proxyid', 'proxy_groupid',
                                        'tls_connect', 'tls_accept', 'inventory_mode',
                                        'maintenance_status', 'maintenanceid'],
            'groupids'              => $groupids,
            'selectInterfaces'      => ['type', 'details'],
            'selectInventory'       => ['location_lat', 'location_lon', 'location'],
            'selectParentTemplates' => ['templateid'],
            'monitored_hosts'       => true,
            'preservekeys'          => true
        ]);

        // Kritische Probleme (sev>=4) aelter als Cutoff. Server-seitig via
        // time_till gefiltert statt client-seitig: mit eventid-DESC-Sort +
        // Limit flogen sonst genau die AELTESTEN (= stale) Events zuerst
        // raus → False-Negatives bei vielen Problemen. recent=true entfernt:
        // das schloss kuerzlich-resolvte Events ein, wir wollen nur OFFENE.
        $hostids = array_keys($hosts);
        $stale_problem_hosts = [];   // hid => true wenn mind. ein altes krit Problem
        if ($hostids) {
            $cutoff = time() - (self::STALE_PROBLEM_DAYS * 86400);
            $problems = API::Problem()->get([
                'output'      => ['clock'],
                'hostids'     => $hostids,
                'severities'  => [4, 5],
                'time_till'   => $cutoff,
                'selectHosts' => ['hostid'],
                'limit'       => max(1000, count($hostids) * 5),
            ]);
            foreach ($problems as $p) {
                foreach ($p['hosts'] ?? [] as $ph) {
                    $stale_problem_hosts[$ph['hostid']] = true;
                }
            }
        }

        // Maintenance-Eintraege fuer alle aktiv-in-maintenance Hosts ziehen.
        // hostmaintenance.description ist leer = kein Kommentar = ein
        // Compliance-Issue (Wartungsfenster ohne Begruendung).
        $mtnc_no_comment_hosts = [];
        $active_mtnc_hids = [];
        foreach ($hosts as $hid => $h) {
            if (!empty($h['maintenance_status']) && !empty($h['maintenanceid'])) {
                $active_mtnc_hids[$h['maintenanceid']][] = $hid;
            }
        }
        if ($active_mtnc_hids) {
            $maint = API::Maintenance()->get([
                'output'         => ['maintenanceid', 'description'],
                'maintenanceids' => array_keys($active_mtnc_hids),
                'preservekeys'   => true,
            ]);
            foreach ($maint as $mid => $m) {
                if (trim((string) ($m['description'] ?? '')) !== '') continue;
                foreach ($active_mtnc_hids[$mid] ?? [] as $hid) {
                    $mtnc_no_comment_hosts[$hid] = true;
                }
            }
        }

        // ── Per-Host Checks evaluieren + Aggregat aufbauen ────────────────
        $out_hosts = [];
        $agg = [
            'snmp_v2'         => 0,
            'snmp_v3'         => 0,
            'no_tls'          => 0,
            'no_proxy'        => 0,
            'no_inventory'    => 0,
            'no_location'     => 0,
            'no_template'     => 0,
            'stale_problem'   => 0,
            'mtnc_no_comment' => 0,
        ];

        foreach ($hosts as $hid => $h) {
            $checks = [];

            // SNMP-Version pro Host: scannen ueber SNMP-Interfaces (type=2)
            $snmp_v2 = false;
            $snmp_v3 = false;
            foreach ($h['interfaces'] ?? [] as $iface) {
                if ((int) ($iface['type'] ?? 0) !== 2) continue;   // 2 = SNMP
                $v = (int) ($iface['details']['version'] ?? 0);
                if ($v === 1 || $v === 2) $snmp_v2 = true;
                if ($v === 3)             $snmp_v3 = true;
            }
            if ($snmp_v2) { $checks['snmp_v2'] = true; $agg['snmp_v2']++; }
            if ($snmp_v3) { $checks['snmp_v3'] = true; $agg['snmp_v3']++; }

            // TLS: nur als Issue wenn BEIDES (connect + accept) = 1 (none) UND
            // mindestens ein Agent-Interface (type=1) existiert.
            $has_agent_iface = false;
            foreach ($h['interfaces'] ?? [] as $iface) {
                if ((int) ($iface['type'] ?? 0) === 1) { $has_agent_iface = true; break; }
            }
            $tls_c = (int) ($h['tls_connect'] ?? 1);
            $tls_a = (int) ($h['tls_accept']  ?? 1);
            if ($has_agent_iface && $tls_c === 1 && $tls_a === 1) {
                $checks['no_tls'] = true; $agg['no_tls']++;
            }

            // Proxy: weder proxyid noch proxy_groupid gesetzt
            if (empty($h['proxyid']) && empty($h['proxy_groupid'])) {
                $checks['no_proxy'] = true; $agg['no_proxy']++;
            }

            // Inventory: disabled (-1) oder Inventory komplett leer
            $inv_mode = (int) ($h['inventory_mode'] ?? -1);
            if ($inv_mode === -1) {
                $checks['no_inventory'] = true; $agg['no_inventory']++;
            }

            // Location: kein location_lat / location_lon im Inventory
            $inv = $h['inventory'] ?? [];
            $lat = trim((string) ($inv['location_lat'] ?? ''));
            $lon = trim((string) ($inv['location_lon'] ?? ''));
            if ($lat === '' || $lon === '') {
                $checks['no_location'] = true; $agg['no_location']++;
            }

            // Template: kein Parent-Template
            if (empty($h['parentTemplates'])) {
                $checks['no_template'] = true; $agg['no_template']++;
            }

            // Stale krit. Problem (>7d)
            if (isset($stale_problem_hosts[$hid])) {
                $checks['stale_problem'] = true; $agg['stale_problem']++;
            }

            // Maintenance ohne Kommentar
            if (isset($mtnc_no_comment_hosts[$hid])) {
                $checks['mtnc_no_comment'] = true; $agg['mtnc_no_comment']++;
            }

            $out_hosts[] = [
                'id'     => (string) $hid,
                'host'   => (string) ($h['host'] ?? ''),
                'label'  => (string) (($h['name'] ?? '') !== '' ? $h['name'] : ($h['host'] ?? '')),
                'checks' => $checks,
            ];
        }

        $payload = [
            'hosts'     => $out_hosts,
            'aggregate' => $agg,
            'total'     => count($out_hosts),
            'cutoff_days' => self::STALE_PROBLEM_DAYS,
        ];

        if ($cache_key !== '' && function_exists('apcu_store')) {
            apcu_store($cache_key, $payload, 60);
        }

        NetworkTopologyDiag::record([
            'action'     => 'compliance',
            'elapsed_ms' => round((microtime(true) - $_t0) * 1000, 1),
            'bytes'      => strlen(json_encode($payload)),
            'cache_hit'  => false,
            'counts'     => ['hosts' => count($out_hosts)],
        ]);
        $this->respond($payload);
    }

    private function respond(array $data): void {
        $this->setResponse(new CControllerResponseData([
            'main_block' => json_encode($data, JSON_UNESCAPED_UNICODE)
        ]));
    }
}
