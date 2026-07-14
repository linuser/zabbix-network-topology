<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Topology;

/**
 * NodeBuilder
 *
 * Fuenfter Schnitt der Data.php-Aufteilung (Review §6, dort "TopologyBuilder").
 *
 * Der Zusammenbau-Schritt: aus Hosts, Metriken, Tags, Problemen und ein paar
 * Nachschlage-Tabellen entstehen die Knoten-Objekte, die das Frontend zeichnet.
 *
 * Anmerkung zur Signatur, weil ich es zwischenzeitlich falsch eingeschaetzt
 * hatte: dieser Block liest 23 Variablen, und ich hielt eine Auslagerung
 * deshalb fuer sinnlos ("23-Parameter-Signatur"). Das war ein Denkfehler — die
 * 23 sind keine 23 unabhaengigen Dinge, sondern fuenf GRUPPEN. Zwei davon
 * ($metrics, $tags) liefern MetricExtractor und HostTagParser bereits fertig
 * gebuendelt; sie wurden in doAction() nur wieder auseinandergepflueckt. Reicht
 * man die Buendel einfach durch, bleiben fuenf Parameter — genau die Form, die
 * das Review selbst skizziert (build($hosts, $metrics, $links)).
 *
 * Rein: Hosts + vier Gruppen. Raus: Knoten + die aufbereitete LLDP-Qualitaet.
 * Kein API-Call, kein Controller-Zustand. Code unveraendert uebernommen.
 */
final class NodeBuilder {

    /**
     * @param array $hosts     hostid => Host-Datensatz
     * @param array $metrics   MetricExtractor::extract()  (cpu, memory, traffic, iface, speed, ping)
     * @param array $tags      HostTagParser::parse()      (icon_override, show_keys, links)
     * @param array $problems  severity, problems, problem_list, ack_total, ack_acked, last_seen
     * @param array $context   group_names, proxy_names, pgroup_names, lldp_quality,
     *                         items_show, show_item_per_host, primary_ip_cache
     *
     * @return array{nodes: array, lldp_quality: array}
     */
    public static function build(array $hosts, array $metrics, array $tags,
            array $problems, array $context): array {

        // Gruppen auspacken. Der Rumpf darunter ist unveraendert aus Data.php
        // uebernommen und benutzt weiter die alten Variablennamen — bewusst,
        // damit der Umbau ein reines Verschieben bleibt und kein Umschreiben.
        $host_cpu           = $metrics['cpu'];
        $host_memory        = $metrics['memory'];
        $host_traffic       = $metrics['traffic'];
        $host_iface         = $metrics['iface'];
        $host_speed         = $metrics['speed'];
        $host_ping          = $metrics['ping'];

        $host_icon_override = $tags['icon_override'];
        $host_show_keys     = $tags['show_keys'];
        $host_links         = $tags['links'];

        $host_severity      = $problems['severity'];
        $host_problems      = $problems['problems'];
        $host_problem_list  = $problems['problem_list'];
        $host_ack_total     = $problems['ack_total'];
        $host_ack_acked     = $problems['ack_acked'];
        $host_last_seen     = $problems['last_seen'];

        $host_group_names   = $context['group_names'];
        $proxy_names        = $context['proxy_names'];
        $pgroup_names       = $context['pgroup_names'];
        $lldp_quality       = $context['lldp_quality'];
        $items_show         = $context['items_show'];
        $show_item_per_host = $context['show_item_per_host'];
        $primary_ip_cache   = $context['primary_ip_cache'];

        // ── 6. BUILD NODES ────────────────────────────────────────────────
        $nodes = [];
        foreach ($hosts as $hid => $h) {
            $tpls    = array_column($h['parentTemplates'] ?? [], 'name');
            $ifaces  = $h['interfaces'] ?? [];
            // Ein Host gilt als "acknowledged", wenn alle Probleme acked sind.
            $total = $host_ack_total[$hid] ?? 0;
            $acked = $host_ack_acked[$hid] ?? 0;
            $all_acked = $total > 0 && $acked === $total;

            // Auto-Detection des Device-Type, ggf. überschrieben durch nt:icon-Tag
            $detected_type = HostMetadata::deviceType($h['host'], $tpls);
            $effective_type = $host_icon_override[$hid] ?? $detected_type;

            // Extra-Items für nt:show-Tags zusammenstellen — in der Reihenfolge
            // wie der User die Tags gesetzt hat.
            $extra_items = [];
            foreach ($host_show_keys[$hid] ?? [] as $key) {
                $iid = $show_item_per_host[$hid][$key] ?? null;
                if (!$iid) {
                    // Tag gesetzt, aber Item nicht gefunden — als Hinweis im Tooltip
                    $extra_items[] = [
                        'name'  => $key,
                        'value' => null,
                        'units' => '',
                        'error' => 'Item nicht gefunden'
                    ];
                    continue;
                }
                $item = $items_show[$iid];
                $extra_items[] = [
                    'name'  => $item['name']  ?: $item['key_'],
                    'value' => $item['lastvalue'],
                    'units' => $item['units'] ?? ''
                ];
            }

            // Offline-Detection mit zwei Signalen:
            //
            // 1) interface.available === 2: passiver Heartbeat-Agent (Port 10050),
            //    SNMP, IPMI, JMX. Plus errors_from = "down since"-Timestamp.
            //
            // 2) host.active_available === 2: ACTIVE-Agent-Verfuegbarkeit
            //    (separater Mechanismus seit Zabbix 7.0). Active-Agent-Hosts
            //    haben oft interface.available=0 (unknown, weil passiver Port
            //    nicht abgefragt wird), aber Zabbix trackt die Erreichbarkeit
            //    ueber das Active-Agent-Heartbeat. Ohne diese 2. Detection
            //    wuerden Active-Agent-Hosts als "online" durchgehen obwohl
            //    Zabbix sie als "not available" markiert hat.
            $host_unavailable = false;
            $down_since = 0;
            $down_error = '';
            foreach ($ifaces as $iface) {
                if ((int) ($iface['available'] ?? 0) === 2) {
                    $host_unavailable = true;
                    $ef = (int) ($iface['errors_from'] ?? 0);
                    if ($ef > 0 && ($down_since === 0 || $ef < $down_since)) {
                        $down_since = $ef;
                    }
                    if (empty($down_error) && !empty($iface['error'])) {
                        $down_error = (string) $iface['error'];
                    }
                }
            }
            // Active-Agent-Verfuegbarkeit (Zabbix 7.0+). Top-Level-Feld am Host.
            if (!$host_unavailable && isset($h['active_available'])
                    && (int) $h['active_available'] === 2) {
                $host_unavailable = true;
                // Active-Agent hat keinen errors_from-Timestamp am Host-Level.
                // down_since bleibt 0 — Detail-Panel zeigt dann "OFFLINE" ohne
                // Zeitangabe, was OK ist.
            }

            $nodes[] = [
                'id'          => $hid,
                'label'       => $h['name'] !== '' ? $h['name'] : $h['host'],
                'host'        => $h['host'],
                'ip'          => $primary_ip_cache[$hid] ?? ($primary_ip_cache[$hid] = HostMetadata::primaryIp($ifaces)),
                'iftype'      => HostMetadata::ifaceType($ifaces),
                'severity'    => $host_severity[$hid] ?? 0,
                'problems'    => $host_problems[$hid]  ?? 0,
                'problem_list' => $host_problem_list[$hid] ?? [],
                'acknowledged'=> $all_acked,
                // Offline-Status (eines der monitored Interfaces ist unavailable)
                'unavailable' => $host_unavailable,
                'down_since'  => $down_since,    // 0 wenn nicht offline, sonst Unix-TS
                'down_error'  => $down_error,    // Last Zabbix-Error-Message vom Interface
                'last_seen'   => $host_last_seen[$hid] ?? 0,   // max(lastclock) fuer Stale-Detection
                // Type-loose: API liefert mal '1', mal 1
                'maintenance' => (int) ($h['maintenance_status'] ?? 0) === 1,
                'type'        => $effective_type,
                'icon_override' => isset($host_icon_override[$hid]),  // Frontend-Hinweis
                'groups'      => $host_group_names[$hid] ?? [],
                // Proxy/ProxyGroup-Lookup (leer wenn Host direkt am Server hängt)
                'proxy_name'       => $proxy_names[(string)($h['proxyid'] ?? '0')] ?? '',
                'proxy_group_name' => $pgroup_names[(string)($h['proxy_groupid'] ?? '0')] ?? '',
                'traffic'     => $host_traffic[$hid]  ?? ['in' => 0.0, 'out' => 0.0],
                // Interface-Health aggregat (Edge-Coloring + Tooltip).
                // Werte sind pro Sekunde (nach Zabbix-Preprocessing 'change per second')
                // oder als absolute Counter — Frontend zeigt nur "> threshold".
                'iface_health' => $host_iface[$hid] ?? ['down'=>0, 'errors'=>0.0, 'discards'=>0.0, 'count'=>0],
                // Max Link-Speed (bps) — Weathermap-Kapazitaet. 0 = unbekannt.
                'link_speed'  => $host_speed[$hid] ?? 0,
                'cpu'         => $host_cpu[$hid]       ?? null,
                'memory'      => $host_memory[$hid]    ?? null,
                'ping'        => $host_ping[$hid]      ?? null,
                // Inventory-Geo: leere Strings -> null. Lat/Lon werden als
                // Floats geliefert, Frontend nutzt nur Hosts mit beiden Werten.
                'lat'         => isset($h['inventory']['location_lat']) && $h['inventory']['location_lat'] !== ''
                                 ? (float) $h['inventory']['location_lat'] : null,
                'lon'         => isset($h['inventory']['location_lon']) && $h['inventory']['location_lon'] !== ''
                                 ? (float) $h['inventory']['location_lon'] : null,
                'location'    => $h['inventory']['location'] ?? '',
                // Extra-Items aus nt:show-Tags (Tooltip + Detail-Panel)
                'extra_items' => $extra_items,
                // Custom-Links aus nt:link-Tags (Kontextmenü)
                'links'       => $host_links[$hid] ?? [],
            ];
        }

        // lldp_quality: hostid → counters → fuer das Frontend als Liste mit
        // Host-Labels die Anzeige praktisch. Hosts ohne Daten weglassen.
        $lldp_quality_out = [];
        foreach ($lldp_quality as $hid => $q) {
            if ($q['matched'] === 0 && empty($q['unmatched']) && empty($q['ambiguous']) && $q['self'] === 0) continue;
            $h = $hosts[$hid] ?? null;
            $lldp_quality_out[] = [
                'id'    => (string) $hid,
                'label' => $h ? (($h['name'] ?? '') !== '' ? $h['name'] : ($h['host'] ?? '')) : (string) $hid,
                'matched'   => $q['matched'],
                'unmatched' => $q['unmatched'],
                'ambiguous' => $q['ambiguous'],
                'self'      => $q['self'],
            ];
        }


        return [
            'nodes'        => $nodes,
            'lldp_quality' => $lldp_quality_out,
        ];
    }
}
