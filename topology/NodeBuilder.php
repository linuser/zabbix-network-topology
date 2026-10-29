<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

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
        // WLAN-Funkmodule je UniFi-AP (band => {channel,width,std,cu}) und die
        // Client-Zahl je AP. Seit 5.5.83 liegen BEIDE als eigene Items am
        // AP-Host selbst (klassische Controller-API, derselbe API-Key) — der
        // frühere Cross-Host-IP-Join (WlanResolver) entfällt.
        $host_radios        = $metrics['radios'] ?? [];
        $host_wlan_clients  = $metrics['wlan_clients'] ?? [];
        $host_ssids         = $metrics['ssids'] ?? [];
        $host_wlan_sat      = $metrics['wlan_satisfaction'] ?? [];
        // VLAN-Mitgliedschaft je Host (hid => {vlans, byIfIndex, access}), aus
        // nt.vlan.walk via VlanParser. Fuer den VLAN-Filter (Knoten + Kanten).
        $host_vlan          = $metrics['vlan'] ?? [];
        // STP-Portzustaende je Host (ifIndex => state). Fuer das Node-Flag
        // "blockt dieser Host IRGENDWO einen Port" — das trennt eine echte
        // Loop-Gefahr von Redundanz, die STP auf einem Link bremst, den die
        // Karte nicht als Kante sieht (geblockte Ports tragen oft keinen
        // LLDP-Nachbarn). Siehe rings.js.
        $host_port_stp      = $metrics['port_stp'] ?? [];
        // Port-Status je Host (ifIndex => true=down|false=up). Ein down-Port
        // meldet bei RouterOS discarding(2) — das ist kein geblockter Loop, nur
        // eine tote Buchse. Ohne diese Schranke galt jeder Host mit toten Ports
        // als "STP blocking".
        $host_port_status   = $metrics['port_status'] ?? [];
        // STP-Topology-Change-Rate je Host (changes/s). Ueber der Schwelle gilt
        // der Baum als instabil -> Loop-Fruehwarnung (Stufe 3a). Konstante wie
        // die Health-Formel, nicht per Makro (vererbte Template-Makros sind aus
        // dem Modul nicht sauber lesbar). Ein stabiler Baum sitzt bei ~0; ein
        // einzelnes Reconverge ist ein kurzer Blip, ein Loop haelt es oben.
        $host_stp_churn     = $metrics['stp_churn'] ?? [];
        $STP_CHURN_THRESH   = 0.1;
        // Broadcast-Storm (Stufe 3b): hoechste Broadcast-Paketrate ueber die Ports
        // eines Hosts. Normal sind ein paar Pakete/s (ARP/DHCP); ein Loop treibt die
        // Schleifen-Ports in die Tausende. Schwelle als Konstante wie oben.
        $host_bcast_max     = $metrics['bcast_max'] ?? [];
        $BCAST_STORM_THRESH = 200.0;
        // MAC-Flapping (Stufe 3c): Anzahl MACs, die den Port gewechselt haben
        // (nt-mac-flap-sender.sh). Ein, zwei Moves sind normal (Geraet umgesteckt,
        // Roaming-Client); erst mehr deutet auf einen Loop. Konstante wie oben.
        $host_mac_flap      = $metrics['mac_flap'] ?? [];
        $MAC_FLAP_THRESH    = 2;

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
        // Beide optional: aeltere Aufrufer (und die Tests) kennen sie nicht,
        // und ohne sie faellt die Typerkennung genau auf den alten Stand zurueck.
        $lldp_host_caps     = $context['lldp_host_caps'] ?? [];
        $lldp_speakers      = $context['lldp_speakers']  ?? [];
        // SLA-Relevanz je Host (hostid => [{service, slo}, ...]). Optional: ohne
        // Services ist die Karte leer, der Knoten traegt dann kein SLA-Feld.
        $host_sla           = $context['sla'] ?? [];

        // ── 6. BUILD NODES ────────────────────────────────────────────────
        $nodes = [];
        foreach ($hosts as $hid => $h) {
            $tpls    = array_column($h['parentTemplates'] ?? [], 'name');
            $ifaces  = $h['interfaces'] ?? [];
            // Ein Host gilt als "acknowledged", wenn alle Probleme acked sind.
            $total = $host_ack_total[$hid] ?? 0;
            $acked = $host_ack_acked[$hid] ?? 0;
            $all_acked = $total > 0 && $acked === $total;

            // Device-Type in fuenf Stufen. Die Reihenfolge ist der Punkt:
            //
            //   1. nt:icon-Tag           — explizit gesetzt, gewinnt immer
            //   2. Name/Template-Muster  — unveraendert wie bisher
            //   3. LLDP-Capabilities     — was der Nachbar ueber ihn meldet
            //   4. spricht LLDP/CDP      — dann ist es Netzwerkgeraet, kein Server
            //   5. sichtbarer Name/Gruppen — letzter Ausweg, siehe unten
            //
            // 3 bis 5 greifen NUR, wenn Stufe 2 im 'server'-Fallback gelandet
            // ist. Andersherum waere es riskant: ein Host namens "rtr-core-01"
            // meldet als L3-Switch auch das Bridge-Bit und wuerde vom Protokoll
            // zum Switch umgestempelt, obwohl der Name die Absicht kennt. So
            // aendert sich an keinem Host etwas, der heute richtig erkannt wird.
            $detected_type = HostMetadata::deviceType($h['host'], $tpls);
            if ($detected_type === 'server') {
                $from_caps = HostMetadata::typeFromCaps($lldp_host_caps[$hid] ?? []);
                if ($from_caps !== '') {
                    $detected_type = $from_caps;
                }
                elseif (isset($lldp_speakers[$hid])) {
                    // Kein Capability-Bit bekannt (niemand Ueberwachtes sieht ihn
                    // als Nachbarn), aber er fuehrt selbst eine Nachbartabelle.
                    // Server tun das nicht.
                    //
                    // Die Stufe greift enger als sie aussieht: sie setzt voraus,
                    // dass Stufe 2 GAR NICHTS erkannt hat. Ein Linux-Host mit
                    // lldpd faellt nicht hierher, weil 'Linux by Zabbix agent'
                    // vorher trifft (siehe tests/DeviceTypeTest.php). Uebrig
                    // bleibt der namenlose Host mit unbekanntem Template — und
                    // da ist Switch die bessere Wette als Server.
                    $detected_type = 'switch';
                }
                else {
                    // Stufe 5, die letzte: sichtbarer Name und Host-Gruppen.
                    // Bei LLD-Hosts ist der technische Name eine UUID, und
                    // Template-Namen gelten fuer alle Geraeteklassen — ueber
                    // sie ist dann nichts bekannt. Ausdruecklich NACH Caps und
                    // Nachbartabelle: ein Gruppenname ist frei gewaehlt, ein
                    // Bridge-Bit meldet das Geraet selbst (siehe typeFromHints).
                    $from_hints = HostMetadata::typeFromHints(
                        array_merge([(string) ($h['name'] ?? '')], $host_group_names[$hid] ?? [])
                    );
                    if ($from_hints !== '') {
                        $detected_type = $from_hints;
                    }
                }
            }
            // UniFi-Clients (Endgeraete am Controller) haengen am Template
            // "UniFi Network API - Client". Als eigene Klasse 'client' fuehren,
            // damit sie NICHT als 'server' fehlkategorisiert werden (Management-/
            // Tabellensicht zeigte sie unter "Servers") und die Karte sie als
            // Endgeraete behandeln kann. Schlaegt den Heuristik-Fallback, aber
            // NICHT das explizite nt:icon — eine bewusste Setzung gewinnt weiter.
            $is_client = false;
            $has_icon_override = isset($host_icon_override[$hid]);
            foreach ($tpls as $tpl) {
                if (stripos((string) $tpl, 'UniFi Network API - Client') !== false) {
                    // NUR ohne explizites nt:icon: dann Typ 'client' + per Flag
                    // auf der Karte ausgeblendet. MIT Override gewinnt die bewusste
                    // Setzung VOLL — Typ UND Sichtbarkeit: der Host bleibt sichtbar
                    // und behaelt sein Wunsch-Icon (sonst verschwaende ein bewusst
                    // gesetzter Client-Host trotzdem von der Karte). Review 5.5.90.
                    if (!$has_icon_override) {
                        $is_client = true;
                        $detected_type = 'client';
                    }
                    break;
                }
            }
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
                        'error' => _('Item not found')
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
                // Blockt dieser Host IRGENDEINEN Port per STP? (dot1dStpPortState==2
                // an einem beliebigen Port, auch ohne LLDP-Nachbarn). Die
                // Ring-Klassifizierung wertet das aus: ein Ring, dessen Host
                // irgendwo blockt, ist von STP gezaehmt (sicher), kein Loop.
                'stp_block'   => self::hasActiveStpBlock($host_port_stp[$hid] ?? [], $host_port_status[$hid] ?? []),
                // STP-Instabilitaet: Topology-Change-Rate ueber der Schwelle ->
                // "STP unstable" (Loop-Fruehwarnung). Rate wird mitgegeben, damit
                // das Panel sie zeigen kann.
                'stp_churn'   => isset($host_stp_churn[$hid]) && $host_stp_churn[$hid] > $STP_CHURN_THRESH,
                'stp_churn_rate' => isset($host_stp_churn[$hid]) ? round((float) $host_stp_churn[$hid], 3) : null,
                // Broadcast-Storm: lautester Port ueber der Schwelle = aktiver Loop.
                'bcast_storm' => isset($host_bcast_max[$hid]) && $host_bcast_max[$hid] > $BCAST_STORM_THRESH,
                'bcast_rate'  => isset($host_bcast_max[$hid]) ? round((float) $host_bcast_max[$hid]) : null,
                // MAC-Flapping: mehr als ein paar MACs wechseln den Port = Loop.
                'mac_flap'    => isset($host_mac_flap[$hid]) && $host_mac_flap[$hid] > $MAC_FLAP_THRESH,
                'mac_flap_n'  => isset($host_mac_flap[$hid]) ? (int) $host_mac_flap[$hid] : null,
                // Max Link-Speed (bps) — Weathermap-Kapazitaet. 0 = unbekannt.
                'link_speed'  => $host_speed[$hid] ?? 0,
                'cpu'         => $host_cpu[$hid]       ?? null,
                'memory'      => $host_memory[$hid]    ?? null,
                'ping'        => $host_ping[$hid]      ?? null,
                // WLAN-Funkmodule (UniFi-AP): band => {channel,width,std,cu}; null
                // bei Nicht-APs (spart Payload).
                'radios'      => !empty($host_radios[$hid]) ? $host_radios[$hid] : null,
                // WLAN-Client-Zahl je AP (wlan.clients am AP-Host selbst); null,
                // wo kein solches Item existiert — dann fehlt Badge/Zeile ehrlich.
                'wlan_clients' => isset($host_wlan_clients[$hid]) ? (int) $host_wlan_clients[$hid] : null,
                // Ausgestrahlte SSIDs (wlan.ssids, nach Name zusammengefasst); null
                // bei Nicht-APs oder ohne das Item.
                'ssids'       => !empty($host_ssids[$hid]) ? $host_ssids[$hid] : null,
                // WLAN-Satisfaction (0..100); null ohne das Item. Trigger darauf
                // faerbt den AP, das ist nur der angezeigte Wert.
                'wlan_satisfaction' => isset($host_wlan_sat[$hid]) ? (int) $host_wlan_sat[$hid] : null,
                // VLAN-Mitgliedschaft (NT VLAN by SNMP): vlans = [{id,name}] fuer
                // den VLAN-Waehler, vlan_by_if = ifIndex -> [VLAN-IDs] fuer den
                // Kanten-Kreuzabgleich, vlan_access = ifIndex -> Access-VLAN (PVID).
                // null, wo der Host keinen nt.vlan.walk liefert (spart Payload).
                'vlans'       => empty($host_vlan[$hid]['vlans']) ? null
                                 : array_map(static fn($v) => ['id' => $v['id'], 'name' => $v['name']],
                                             $host_vlan[$hid]['vlans']),
                'vlan_by_if'  => !empty($host_vlan[$hid]['byIfIndex']) ? $host_vlan[$hid]['byIfIndex'] : null,
                // UniFi-Client-Endgeraet (Template „… - Client")? Steuert Karte
                // (Default ausgeblendet, Klick-Fokus) und Kategorie in den Views.
                'is_client'   => $is_client,
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
                // SLA-Relevanz: haengt ein aktives Problem dieses Hosts an einem
                // Zabbix-Service? Nur gesetzt, wenn ja — sonst faellt das Feld
                // weg und das Frontend liest ein leeres []/false.
                'sla_relevant' => isset($host_sla[(string) $hid]),
                'sla_services' => $host_sla[(string) $hid] ?? [],
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

    /**
     * Blockt der Host einen Port per STP AN EINEM AKTIVEN LINK? Ein down-Port
     * meldet bei RouterOS discarding(2) — das ist kein geblockter Loop, nur eine
     * tote Buchse. Nur state 2 an einem Port, der NICHT explizit down ist, zaehlt.
     *
     * Nur bei EXPLIZIT aktivem Link zaehlen: port_status ist true(down),
     * false(up) oder FEHLT (unknown/notPresent/admin-down, oder kein oper-Item).
     * Ein fehlender Eintrag heisst "Link nicht als aktiv belegt" -> zaehlt NICHT,
     * wie die Faceplate, die bei fehlendem oper ebenfalls kein Badge zeigt. So
     * kippt ein down- oder unbekannter Port nicht faelschlich auf "STP blocking".
     *
     * @param array<int|string,int>  $stp     ifIndex => dot1dStpPortState
     * @param array<string,bool>     $status  ifIndex => true(down)|false(up)
     */
    private static function hasActiveStpBlock(array $stp, array $status): bool {
        foreach ($stp as $ifx => $st) {
            if ($st === 2 && ($status[(string) $ifx] ?? true) === false) {
                return true;
            }
        }
        return false;
    }
}
