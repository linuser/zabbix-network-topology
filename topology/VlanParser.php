<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * VlanParser — aus den 802.1Q-Rohtabellen die Port-Mitgliedschaft je VLAN
 * machen: „VLAN 55 liegt auf den Ports 24 und 48".
 *
 * WARUM DAS DER TEUERSTE TEIL IST — UND HIER ISOLIERT STEHT
 * --------------------------------------------------------
 * VLAN kommt im ganzen Modul sonst nicht vor: LLDP traegt keine VLAN-
 * Mitgliedschaft. Belastbar ist allein die Q-BRIDGE-MIB, und deren Mitglieds-
 * liste je VLAN kommt als BITMASKE (`dot1qVlanStaticEgressPorts` /
 * `…CurrentEgressPorts`) — ein 802.1Q-PortList-Oktettfeld. Genau das Dekodieren
 * dieser Maske ist die riskante Stelle: eine falsch gelesene Maske behauptet
 * eine Verkabelung, die es nicht gibt. Deshalb liegt die Logik hier als REINE,
 * testbare Klasse (wie FdbResolver/LldpEdgeBuilder) — kein SNMP, kein API-Call —
 * und wird gegen bekannte Masken geprueft, bevor irgendeine Oberflaeche sie
 * nutzt.
 *
 * DIE BIT-REIHENFOLGE (die Falle)
 * -------------------------------
 * 802.1Q PortList: Port 1 ist das HOECHSTWERTIGE Bit (MSB) von Byte 0, Port 8
 * das niederwertigste; Port 9 das MSB von Byte 1, usw. Also
 *     Bridge-Port = Byte-Index * 8 + Bit-Position_von_MSB + 1.
 * Am 2026-10-28 an einem HPE Instant On 1830 gegengeprueft: VLAN 1 = Ports
 * 1–26, VLAN 55/66 = nur Port 24 (der Uplink) — die dekodierte Mitgliedschaft
 * deckte sich mit der gelesenen ifName-Liste. Ein MikroTik CRS310 (RouterOS)
 * fuellt die dot1q-Tabelle gar nicht erst (No Such Object) — dort ist VLAN
 * ueber Standard-SNMP nicht sichtbar, das ist ein Datenquellen-, kein Parser-
 * Problem.
 *
 * DER ZWEITE SCHRITT, DER GERN VERGESSEN WIRD
 * -------------------------------------------
 * Die Maske adressiert BRIDGE-PORTS, nicht ifIndizes. Erst `dot1dBasePortIfIndex`
 * (Bridge-Port -> ifIndex) macht aus „Bit 23 ist gesetzt" ein konkretes
 * Interface. Dieselbe zweite Aufloesung, die bei der FDB (FdbResolver) noetig
 * ist. Ohne diese Tabelle bleibt die Maske unabbildbar — membership() laesst
 * einen Bridge-Port ohne Zuordnung bewusst weg, statt eine ifIndex zu raten.
 */
final class VlanParser {

    /**
     * Eine 802.1Q-PortList-Bitmaske (Hex) in die Liste der gesetzten
     * BRIDGE-PORTS (1-basiert, MSB zuerst) uebersetzen.
     *
     * Robust gegen Trennzeichen/Leerraum (snmpwalk gibt die Oktette mit
     * Leerzeichen aus) und gegen eine ungerade Hex-Laenge (dann wird das letzte
     * halbe Oktett verworfen statt abzustuerzen — eine halbe Maske ist ohnehin
     * nicht verlaesslich).
     *
     * @return int[]  aufsteigende Bridge-Port-Nummern
     */
    public static function decodeMask(string $hexmask): array {
        $hex = (string) preg_replace('/[^0-9A-Fa-f]/', '', $hexmask);
        if (strlen($hex) % 2 !== 0) {
            $hex = substr($hex, 0, strlen($hex) - 1);
        }
        if ($hex === '') {
            return [];
        }
        $ports = [];
        $bytes = str_split($hex, 2);
        foreach ($bytes as $i => $bh) {
            $byte = (int) hexdec($bh);
            for ($b = 0; $b < 8; $b++) {
                if ($byte & (0x80 >> $b)) {
                    $ports[] = $i * 8 + $b + 1;
                }
            }
        }
        return $ports;
    }

    /**
     * Egress-Masken (VLAN-ID -> Hex-Maske) gegen die Bridge-Port->ifIndex-
     * Tabelle aufloesen: VLAN-ID -> Liste der Mitglieds-ifIndizes.
     *
     * Ein Bridge-Port ohne Eintrag in $basePortIfIndex wird WEGGELASSEN — die
     * Maske nennt dann einen Port, den die Bridge-Tabelle nicht auf ein
     * Interface abbildet; ihn zu raten waere die Art Falschaussage, gegen die
     * diese Klasse antritt.
     *
     * @param array<int|string,string>   $egressByVlan     VLAN-ID -> Hex-Maske
     * @param array<int|string,int|string> $basePortIfIndex Bridge-Port -> ifIndex
     * @return array<int,int[]>  VLAN-ID -> ifIndizes
     */
    public static function membership(array $egressByVlan, array $basePortIfIndex): array {
        $out = [];
        foreach ($egressByVlan as $vid => $mask) {
            $ifx = [];
            foreach (self::decodeMask((string) $mask) as $bp) {
                if (isset($basePortIfIndex[$bp])) {
                    $ifx[] = (int) $basePortIfIndex[$bp];
                }
            }
            $out[(int) $vid] = $ifx;
        }
        return $out;
    }

    /**
     * Access-VLAN je Port (PVID): Bridge-Port->VLAN gegen Bridge-Port->ifIndex
     * aufloesen -> ifIndex -> VLAN-ID. Fuer Access-Ports oft aussagekraeftiger
     * als die Egress-Maske, und ohne Bitmaske — ein direkter Join.
     *
     * @param array<int|string,int|string> $pvidByBridgePort Bridge-Port -> PVID
     * @param array<int|string,int|string> $basePortIfIndex  Bridge-Port -> ifIndex
     * @return array<int,int>  ifIndex -> Access-VLAN-ID
     */
    public static function accessVlans(array $pvidByBridgePort, array $basePortIfIndex): array {
        $out = [];
        foreach ($pvidByBridgePort as $bp => $vid) {
            if (isset($basePortIfIndex[$bp])) {
                $out[(int) $basePortIfIndex[$bp]] = (int) $vid;
            }
        }
        return $out;
    }

    /**
     * Den Rohtext von `nt.vlan.walk` (ein Zabbix-SNMP-Walk, Format wie
     * `snmpwalk -On`: `.<OID> = TYP: Wert`) in die sechs Spalten zerlegen.
     *
     * Zwei Fallen aus dem echten HPE-Walk (2026-10-28):
     *   - ein LEERER String kommt als `= ""` OHNE `STRING:`-Praefix — nicht jede
     *     Zeile hat also ein `TYP:`-Feld; dann ist der Wert der (entanfuehrungs-)
     *     Rest hinter `=`.
     *   - `dot1qVlanCurrentEgressPorts` ist nach {TimeMark}.{VLAN} indiziert
     *     (z. B. `.4.0.1`), die VLAN-ID ist die LETZTE Indexkomponente.
     *
     * @return array{name:array,egressStatic:array,egressCurrent:array,pvid:array,baseport:array,ifname:array}
     *         je Spalte: Index (als String) -> Wert
     */
    public static function parseWalk(string $walk): array {
        $cols = [
            '1.3.6.1.2.1.17.7.1.4.3.1.1.' => 'name',          // VLAN -> Name
            '1.3.6.1.2.1.17.7.1.4.3.1.2.' => 'egressStatic',  // VLAN -> Maske (statisch)
            '1.3.6.1.2.1.17.7.1.4.2.1.4.' => 'egressCurrent', // {TimeMark}.VLAN -> Maske (aktuell)
            '1.3.6.1.2.1.17.7.1.4.5.1.1.' => 'pvid',          // Bridge-Port -> Access-VLAN
            '1.3.6.1.2.1.17.1.4.1.2.'     => 'baseport',      // Bridge-Port -> ifIndex
            '1.3.6.1.2.1.31.1.1.1.1.'     => 'ifname',        // ifIndex -> Portname
        ];
        $out = ['name' => [], 'egressStatic' => [], 'egressCurrent' => [],
                'pvid' => [], 'baseport' => [], 'ifname' => []];
        foreach (preg_split('/\r?\n/', $walk) as $line) {
            $line = trim((string) $line);
            if ($line === '') {
                continue;
            }
            $eq = strpos($line, ' = ');
            if ($eq === false) {
                continue;
            }
            $oid = ltrim(substr($line, 0, $eq), '.');
            $rhs = substr($line, $eq + 3);
            if (preg_match('/^[A-Za-z0-9-]+:[ ]?(.*)$/', $rhs, $m)) {
                $val = rtrim($m[1]);              // "TYP: Wert" — Hex-STRING hat Trailing-Space
            } else {
                $val = trim($rhs, '"');           // `= ""` oder nackter Wert
            }
            foreach ($cols as $prefix => $key) {
                if (strncmp($oid, $prefix, strlen($prefix)) === 0) {
                    $idx = substr($oid, strlen($prefix));
                    if ($key === 'egressCurrent') {
                        $p   = explode('.', $idx);
                        $idx = (string) end($p);  // VLAN = letzte Komponente (TimeMark weg)
                    }
                    $out[$key][$idx] = $val;
                    break;
                }
            }
        }
        return $out;
    }

    /**
     * Aus dem Walk-Text die VLAN-Mitgliedschaft je Host machen: welche VLANs
     * laufen auf welchen Ports. Statische Egress-Maske gewinnt; fehlt sie fuer
     * ein VLAN (oder ist leer), greift die aktuelle (betriebliche) als Rueckfall
     * — manche Switches fuellen nur eine der beiden.
     *
     * @return array{vlans:list<array{id:int,name:string,ports:list<string>}>,access:array<int,int>}
     *         vlans: je VLAN Name + Mitglieds-Portnamen (ifName, sonst ifIndex);
     *         access: ifIndex -> Access-VLAN (PVID).
     */
    public static function vlansForHost(string $walk): array {
        $t = self::parseWalk($walk);

        $egress = $t['egressStatic'];
        foreach ($t['egressCurrent'] as $vid => $mask) {
            if (!isset($egress[$vid]) || trim((string) $egress[$vid]) === '') {
                $egress[$vid] = $mask;
            }
        }

        $mem   = self::membership($egress, $t['baseport']);   // VLAN -> ifIndizes
        $names = $t['name'];
        $ifn   = $t['ifname'];

        $vlans = [];
        $byIf  = [];   // ifIndex -> [VLAN-IDs] (fuer den Kanten-Kreuzabgleich)
        foreach ($mem as $vid => $ifx) {
            $ports = [];
            foreach ($ifx as $ix) {
                $ports[]        = (isset($ifn[$ix]) && $ifn[$ix] !== '') ? (string) $ifn[$ix] : (string) $ix;
                $byIf[$ix][]    = (int) $vid;
            }
            $vlans[$vid] = [
                'id'    => (int) $vid,
                'name'  => (string) ($names[$vid] ?? ''),
                'ports' => $ports,
            ];
        }
        ksort($vlans);
        foreach ($byIf as &$vids) {
            sort($vids);
        }
        unset($vids);

        return [
            'vlans'     => array_values($vlans),
            'byIfIndex' => $byIf,
            'access'    => self::accessVlans($t['pvid'], $t['baseport']),
        ];
    }

    /**
     * VLANs je Kante bestimmen: eine Kante traegt ein VLAN, wenn es auf dem
     * LOKALEN Port MINDESTENS EINES Endes liegt. „Mindestens ein Ende" ist
     * Absicht — ein VLAN-Trunk soll sichtbar sein, auch wenn nur eine Seite das
     * nt.vlan.walk-Item liefert; der strenge Soll/Ist-Abgleich (beide Enden)
     * kaeme separat.
     *
     * Reine Funktion: der Controller reicht die schon gebauten Kanten und die
     * `vlan_by_if`-Karten der Knoten rein. Jede Kante kennt ihren lokalen
     * ifIndex je Seite in `port_idx` ({hostid => ifIndex}); je Host sagt
     * `vlanByHost[hostid][ifIndex]`, welche VLANs dort egress-getaggt sind.
     *
     * @param array<int,array> $edges      Kanten, je {source,target,port_idx:{hid:ifIndex}}
     * @param array<string,array<int|string,int[]>> $vlanByHost hostid -> (ifIndex -> [VLAN-IDs])
     * @return array<int,array>  dieselben Kanten; Kante['vlans'] (sortiert) gesetzt, wo es Treffer gibt
     */
    public static function annotateEdges(array $edges, array $vlanByHost): array {
        if (!$vlanByHost) {
            return $edges;
        }
        foreach ($edges as &$e) {
            $pi  = $e['port_idx'] ?? [];
            $set = [];
            foreach ([$e['source'] ?? $e['from'] ?? null, $e['target'] ?? $e['to'] ?? null] as $hid) {
                if ($hid === null) {
                    continue;
                }
                $hid = (string) $hid;
                $ifx = $pi[$hid] ?? null;
                if ($ifx === null) {
                    continue;
                }
                foreach ($vlanByHost[$hid][$ifx] ?? [] as $vid) {
                    $set[(int) $vid] = true;
                }
            }
            if ($set) {
                $vids = array_keys($set);
                sort($vids);
                $e['vlans'] = $vids;
            }
        }
        unset($e);
        return $edges;
    }
}
