<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

use API;

/**
 * HostMetadata
 *
 * Erster Schnitt der Data.php-Aufteilung (Review §6): die Host-Metadaten-
 * Ableitungen. Das sind reine Ableitungen aus Host-Feldern und Item-Keys —
 * kein Zustand, keine Abhaengigkeit zum Controller. Genau deshalb lagen sie
 * falsch in einem 1200-Zeilen-doAction(): so sind sie einzeln testbar, ohne
 * eine ganze Zabbix-Request-Umgebung hochzuziehen.
 *
 * Alles static: die Methoden haengen an keinem Objektzustand.
 *
 * Ausnahme von "rein": loadIntegrationTemplates() liest Zabbix-Global-Macros
 * (der einzige API-Call hier) — es gehoert trotzdem hierher, weil es dieselbe
 * Frage beantwortet ("was fuer ein Ding ist dieser Host und was haengt dran").
 */
final class HostMetadata {

    /**
     * Integration-Links aus den Zabbix-Global-Macros.
     *
     * Kanonisch ist die Dot-Notation ({$NT.INT.<NAME>.URL}) — Zabbix-Konvention;
     * die alte Underscore-Form ({$NT_INT_..._URL}) wird aus Kompatibilitaet
     * weiter akzeptiert.
     *
     * @return array<int, array{name: string, label: string, url: string}>
     */
    public static function loadIntegrationTemplates(): array {
        try {
            $macros = API::UserMacro()->get([
                'output'      => ['macro', 'value'],
                'globalmacro' => true,
            ]);
        } catch (\Throwable $e) {
            return [];   // API nicht verfuegbar → leise no-op
        }

        $by_name = [];   // name → ['label' => ?, 'url' => ?]
        foreach ($macros as $m) {
            $macro = $m['macro'] ?? '';
            if (!preg_match('/^\{\$NT[._]INT[._]([A-Z0-9_]+)[._](LABEL|URL)\}$/', $macro, $mm)) continue;
            $name = $mm[1];
            $part = strtolower($mm[2]);
            $by_name[$name][$part] = (string) ($m['value'] ?? '');
        }

        $out = [];
        foreach ($by_name as $name => $parts) {
            $label = trim($parts['label'] ?? '');
            $url   = trim($parts['url']   ?? '');
            if ($label === '' || $url === '') continue;
            // Schutz-Caps analog nt:link
            if (strlen($label) > 200 || strlen($url) > 2048) continue;
            if (!preg_match('#^https?://#i', $url)) continue;
            if (preg_match('/[\x00-\x1F\x7F]/', $url . $label)) continue;
            $out[] = ['name' => $name, 'label' => $label, 'url' => $url];
        }

        return $out;
    }

    /**
     * Extrahiert den Bracket-Parameter eines Item-Keys als Korrelations-Key
     * fuer Interface-Items ("ifOperStatus[eth0]" → "eth0",
     * "net.if.status[ifOperStatus.3]" → "ifOperStatus.3" → normalisiert "3").
     * Ohne Bracket: ganzer Key.
     */
    public static function ifaceParam(string $key): string {
        $p = strpos($key, '[');
        if ($p === false) return $key;
        $q = strrpos($key, ']');
        $param = substr($key, $p + 1, ($q !== false ? $q : strlen($key)) - $p - 1);
        // "ifOperStatus.3" / "ifAdminStatus.3" → "3", damit Oper und Admin
        // desselben Interfaces trotz MIB-Name-Praefix korrelieren.
        return preg_replace('/^if(?:Oper|Admin)Status\./', '', $param);
    }

    /**
     * IP des primaeren Interfaces. Bevorzugt main=1, dann nach Typ
     * (1=Agent, 2=SNMP, 3=IPMI, 4=JMX).
     */
    public static function primaryIp(array $ifaces): string {
        if (!$ifaces) return '';
        usort($ifaces, static fn($a, $b) =>
            $b['main'] !== $a['main']
                ? (int) $b['main'] - (int) $a['main']
                : (int) $a['type'] - (int) $b['type']
        );

        return $ifaces[0]['ip'] ?? '';
    }

    /**
     * Interface-Typ des primaeren Interfaces als Anzeige-String fuers Frontend.
     */
    public static function ifaceType(array $ifaces): string {
        foreach ($ifaces as $i) {
            if ((int) $i['main'] === 1) {
                return match((int) $i['type']) {
                    1 => 'Agent',
                    2 => 'SNMP',
                    3 => 'IPMI',
                    4 => 'JMX',
                    default => 'Unknown'
                };
            }
        }

        return 'Unknown';
    }

    /**
     * Geraetetyp aus Hostname + Template-Namen raten (steuert das Icon).
     * Erster Treffer gewinnt — die Reihenfolge der Map ist daher bedeutsam
     * (spezifisch vor generisch), Fallback 'server'.
     */
    public static function deviceType(string $host, array $tpls): string {
        $s = strtolower($host . ' ' . implode(' ', $tpls));
        $map = [
            // Network security
            'firewall'       => ['fw-','firewall','fortigate','pfsense','opnsense','-asa-','srx',
                                 'opnsense by snmp'],
            'router'         => ['rtr-','router','-gw-','gateway','mikrotik routeros','vyos'],
            'switch'         => ['sw-','switch','-core-','-acc-','catalyst','procurve','nexus',
                                 'hp enterprise switch','tp-link by snmp'],
            'wireless'       => ['-ap-','wlan','wifi','wireless','unifi','omada'],
            // Storage & backup
            'storage'        => ['nas-','synology','qnap','netapp','storage','truenas',
                                 'truenas core by snmp','synology active backup'],
            // Virtualization
            'hypervisor'     => ['esxi','vmware','proxmox','proxmox ve by http',
                                 'hypervisor','pve'],
            // Surveillance
            'camera'         => ['cam-','camera','nvr','dvr','hikvision','dahua','axis'],
            // Power
            'ups'            => ['ups-','usv-','usv','ups','apc','eaton','powerware',
                                 'network ups'],
            // Home automation
            'homeauto'       => ['home assistant','homeassistant','home-assistant',
                                 'zigbee','z-wave','domoticz','openhab'],
            // Mail
            'mailserver'     => ['mail','smtp','imap','mailcow','postfix','dovecot',
                                 'mailcow complete'],
            // Web & apps
            'webserver'      => ['nginx by zabbix','apache','web-','www-'],
            // Containers
            'container'      => ['docker by zabbix','docker','container','kubernetes'],
            // Monitoring
            'monitoring'     => ['tactical rmm','rmm.cloudglue'],
            // Printer
            'printer'        => ['prt-','printer','mfp'],
            // Linux/Windows/macOS generic servers
            'linux'          => ['linux by zabbix agent','zfs on linux'],
            'windows'        => ['windows','win-'],
            'macos'          => ['macos by zabbix agent'],
            // Generic server fallback
            'server'         => ['srv-','server'],
        ];

        foreach ($map as $type => $kws) {
            foreach ($kws as $kw) {
                if (strpos($s, $kw) !== false) return $type;
            }
        }

        return 'server';
    }
}
