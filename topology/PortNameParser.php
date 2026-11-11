<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * PortNameParser
 *
 * Portnamen je ifIndex aus dem ITEM-NAMEN eines Interface-Items — der
 * Rueckfall fuer Hosts OHNE ifName/ifDescr/ifAlias-Items.
 *
 * WARUM ER EXISTIERT (Issue #29, Nebenbefund)
 * -------------------------------------------
 * MetricExtractor liest den Portnamen aus dem WERT eines ifName[<idx>]-
 * (bzw. ifDescr/ifAlias-)Items. Zabbix' offizielles „Cisco IOS by SNMP"-
 * Template legt solche Items aber gar nicht an: es keyt die Interfaces als
 * net.if.status[ifOperStatus.<idx>], net.if.in[ifHCInOctets.<idx>] usw. und
 * traegt den Portnamen NUR im Item-NAMEN („Interface Gi1/0/9(Uplink): …",
 * aus dem {#IFNAME} der Interface-LLD). Ohne Portnamen kann
 * LldpEdgeBuilder::resolveRemotePort() den Gegenport nicht aufloesen — der
 * Proven-Index-Guard aus #29 bleibt wirkungslos, und mehrere Kabel zwischen
 * zwei solchen Switches fallen auf den konservativen Merge zurueck (weniger
 * Linien als Kabel). Der Melder hat sich mit zusaetzlichen ifName[<idx>]-
 * Items beholfen; diese Klasse macht es mit den Stock-Templates unnoetig.
 *
 * Bewusst getrennt von MetricExtractor: der Haupt-Item-Abruf holt KEIN
 * 'name'-Feld (halbe Nutzlast, eigene Test-Zusicherung). Die Portnamen
 * kommen deshalb aus einem gezielten Zweitabruf in der Action — nur fuer
 * Hosts ohne bereits bekannten Portnamen — und laufen hier durch. Rein und
 * testbar: rein die Roh-Zeilen, raus [hid => [ifIndex => Portname]].
 */
final class PortNameParser {

    /**
     * Baut [hostid => [ifIndex => Portname]] aus Interface-Item-Zeilen.
     *
     * @param list<array{hostid?:mixed, key_?:mixed, name?:mixed}> $rows
     *        item.get-Zeilen mit 'hostid', 'key_' und 'name'.
     * @return array<string, array<string,string>>
     */
    public static function build(array $rows): array {
        $out = [];
        foreach ($rows as $row) {
            $hid = (string) ($row['hostid'] ?? '');
            $key = (string) ($row['key_'] ?? '');
            if ($hid === '' || $key === '') {
                continue;
            }
            $ifx = self::ifIndexOf($key);
            if ($ifx === null) {
                continue;
            }
            // Erster gewinnt: alle Interface-Items EINES Index (in/out/status/
            // speed) tragen denselben {#IFNAME}, ein weiterer Treffer aendert
            // nichts. So bleibt das Ergebnis unabhaengig von der Item-
            // Reihenfolge.
            if (isset($out[$hid][$ifx])) {
                continue;
            }
            $name = self::fromItemName((string) ($row['name'] ?? ''));
            if ($name !== null) {
                // Dieselbe Kappung wie der ifName-Pfad (MetricExtractor::capName),
                // damit sich Fallback- und ifName-Portnamen gleich verhalten.
                $out[$hid][$ifx] = MetricExtractor::capName($name);
            }
        }
        return $out;
    }

    /**
     * Portname aus einem Zabbix-Interface-Item-Namen.
     *
     * Die Interface-LLD benennt ihre Items „Interface {#IFNAME}({#IFALIAS}):
     * <Metrik>" bzw. „Interface {#IFNAME}: <Metrik>". Der {#IFNAME} steht
     * zwischen „Interface " und der ersten '(' oder ':'. Faengt der Name nicht
     * mit „Interface " an, raten wir nichts — lieber kein Portname als ein
     * falscher (dieselbe Linie wie resolveRemotePort bei Mehrdeutigkeit).
     */
    public static function fromItemName(string $name): ?string {
        $name = trim($name);
        if (!preg_match('/^Interface\s+(.+)$/u', $name, $m)) {
            return null;
        }
        // Bis zur ersten Klammer (Alias) oder dem Doppelpunkt (Metrikname).
        $teil = preg_split('/[(:]/u', $m[1], 2);
        $rest = trim($teil[0]);
        return $rest !== '' ? $rest : null;
    }

    /**
     * ifIndex aus einem net.if-Interface-Key.
     *
     * net.if.status[ifOperStatus.10126] -> "10126" (Cisco-IOS-Stock-Template,
     * MIB-Name vor dem Index), net.if.in[24] -> "24" (nackte Index-Form). Ein
     * Agent-Namens-Interface (net.if.in[eth0], net.if.in["ens18"]) traegt
     * keinen numerischen Index und ergibt null — es hat ohnehin keinen
     * LLDP-Port-Bezug. Nur der net.if.-Praefix, damit kein fremder Key (etwa
     * nt.if.stp[<idx>]) hier hereinrutscht.
     */
    public static function ifIndexOf(string $key): ?string {
        if (strncmp($key, 'net.if.', 7) !== 0) {
            return null;
        }
        // Letzter Zifferblock direkt vor der schliessenden Klammer; ein
        // optionaler MIB-Name davor wird per '.'/'[' abgetrennt.
        if (preg_match('/\[(?:[^\]]*[.\[])?(\d+)\]$/', $key, $m)) {
            return $m[1];
        }
        return null;
    }
}
