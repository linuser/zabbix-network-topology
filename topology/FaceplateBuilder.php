<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * FaceplateBuilder
 *
 * Baut aus den Interface-Items EINES Switches die Portliste fuer das
 * Faceplate-Widget: welche Interfaces sind Frontports, welche Nummer tragen
 * sie auf der Front, welche davon Kupfer und welche SFP, und wie steht es um
 * jeden.
 *
 * Warum nicht MetricExtractor::extract: der verdichtet fuer Karte und Kanten.
 * Er verwirft admin-down- und notPresent-Ports, weil die dort nichts bedeuten
 * — auf einer Frontansicht sind genau das die grauen Buchsen, die man sehen
 * will. Und er kennt ifType nicht, ohne den sich VLAN-, Loopback- und
 * LAG-Interfaces nicht von Buchsen trennen lassen. Die Schluessel- und
 * Speed-Regeln dagegen sind DIESELBEN (snmpIfKey, highSpeedBps, speedBps,
 * capName) — zwei Fassungen davon zeigten fuer denselben Port verschiedene
 * Geschwindigkeiten.
 *
 * Rein wie MetricExtractor: Items rein, Ports raus. Kein API-Call.
 *
 * Woher die Werte kommen
 * ----------------------
 * Die IF-MIB-Items der ueblichen SNMP-Templates, in beiden Schreibweisen:
 *   net.if.status[ifOperStatus.12]   (Network Generic Device by SNMP, 7.x)
 *   ifOperStatus[12] / ifOperStatus.12
 *   net.if.status[12]                (Cisco-/pfSense-Familie, Index nackt)
 * ifAlias und ifName haben diese Templates meist nicht als Item — sie stecken
 * im aufgeloesten Item-Namen "Interface Gi1/0/12(Drucker): Operational status".
 * Deshalb wird der Name als letzte Quelle mitgelesen.
 *
 * Portnummer
 * ----------
 * Die Nummer auf der Front ist NICHT die Position in der Liste. Faellt ein
 * Interface weg — die LLD filtert notPresent heraus, ein Item ist
 * unsupported —, wuerden sonst alle folgenden Ports umnummeriert, und die
 * Grenze Kupfer/SFP rutschte. Reihenfolge der Quellen (portNumbers):
 *   1. Ziffern am Ende des Namens (Gi1/0/12, 1/12, Port 12, 12), wenn sie
 *      eindeutig sind — in einem Stack kommt 1/0/1 und 2/0/1 vor, dann nicht.
 *   2. ifIndex relativ zum kleinsten (1..52, 1001..1052, 10101..10152),
 *      wenn die Spanne auf eine Front passt.
 *   3. Erst dann die Position.
 * Luecken bleiben Luecken: das Widget zeichnet dort eine leere Buchse.
 *
 * Layout
 * ------
 * Feste Zuschnitte (24+2, 24+4, 48+4 ...). Bei "auto" entscheidet die hoechste
 * Portnummer (pickLayout). Kupfer sind die Nummern bis zur Kupferzahl des
 * Zuschnitts, SFP die danach — so nummerieren HPE, Aruba, UniFi und Cisco-SMB.
 */
final class FaceplateBuilder {

    /** Feste Zuschnitte: [Kupfer, SFP]. Reihenfolge = Auswahlreihenfolge bei auto. */
    public const LAYOUTS = [
        '8+2'  => [8, 2],
        '16+2' => [16, 2],
        '24+2' => [24, 2],
        '24+4' => [24, 4],
        '48+4' => [48, 4],
        '48+6' => [48, 6],
    ];

    /** Mehr Ports als das zeichnet keine Kachel sinnvoll. */
    public const MAX_PORTS = 96;

    /**
     * ifType-Werte, die eine Buchse sind: ethernetCsmacd(6), iso88023(7),
     * fastEther(62), fastEtherFX(69), gigabitEthernet(117).
     */
    private const PHYS_TYPES = [6, 7, 62, 69, 117];

    /** Ohne ifType: Namen, die sicher KEINE Buchse sind (breit — trk/stack/mgmt/oob
     *  sind dann kein echter Port, wenn uns ifType nicht das Gegenteil belegt). */
    private const VIRT_NAME = '/^(?:vlan|vl\d|lo(?:\d|$|opback)|cpu|null|tunnel|trk|lag|port-?channel|po\d|bond|br\d|bridge|virtual|stack|mgmt|oob|dummy|sit|ip\s|switch\s*loopback|default\s*vlan)/i';

    /** Nur EINDEUTIG virtuelle Namen — dieses Muster wirft auch dann raus, wenn
     *  der Switch das Interface als physischen ifType meldet (TP-Link meldet sein
     *  VLAN-IF als ethernetCsmacd(6)). Hier fehlen bewusst trk/stack/mgmt/oob: die
     *  koennen ECHTE Buchsen sein (Stacking-, OOB-, Management-Ports), und ein
     *  physischer ifType ist dann Beleg genug, sie zu behalten. */
    private const VIRT_NAME_STRICT = '/^(?:vlan|vl\d|lo(?:\d|$|opback)|cpu|null|tunnel|lag|port-?channel|po\d|bond|br\d|bridge|virtual|dummy|sit|ip\s|switch\s*loopback|default\s*vlan)/i';

    /** Item-Name der SNMP-Templates: "Interface Gi1/0/3(Drucker): ..." */
    private const NAME_RE = '/^Interface\s+(.+?)(?:\((.*)\))?:\s/u';

    /** MIB-Name im Schluessel -> Art. */
    private const MIB = [
        'ifOperStatus'  => 'oper',
        'ifAdminStatus' => 'admin',
        'ifType'        => 'type',
        'ifHighSpeed'   => 'hspeed',
        'ifSpeed'       => 'speed',
        'ifHCInOctets'  => 'in',
        'ifInOctets'    => 'in32',
        'ifHCOutOctets' => 'out',
        'ifOutOctets'   => 'out32',
        'ifInErrors'    => 'errors',
        'ifOutErrors'   => 'errors',
        'ifName'        => 'name',
        'ifDescr'       => 'descr',
        'ifAlias'       => 'alias',
    ];

    /**
     * @param array $items     Items des Hosts: key_, name, lastvalue, itemid
     * @param string $layout   'auto' oder ein Schluessel aus LAYOUTS
     * @param array $problems  [itemid => hoechste Problem-Severity]
     *
     * @return array{layout: string, copper: int, sfp: int, ports: array, extra: int, poe_budget: ?array}
     */
    public static function build(array $items, string $layout = 'auto', array $problems = []): array {
        $ifs  = self::collect($items, $problems);
        // UniFi-Geraete melden keine SNMP-IF-MIB, sondern die Portliste als
        // eigene port.<feld>[<idx>]-Items aus der Controller-API. Dieselbe
        // if-Form, damit physical()/portNumbers()/build() unveraendert greifen.
        // Ein Host ist entweder SNMP ODER UniFi (andere Vorlage), nie beides.
        $ifs += self::collectUniFi($items, $problems);
        $phys = self::physical($ifs);
        $nums = self::portNumbers($phys);

        [$name, $copper, $sfp] = self::pickLayout($nums ? max($nums) : 0, $layout);
        $slots = $copper + $sfp;

        $poe_data  = self::collectPoe($items);
        $poe       = $poe_data['poe'];
        $poe_class = $poe_data['class'];
        $stp = self::stp($items);
        // Selbst-Loops: [geblockter ifIndex => Partner-ifIndex]. Das geblockte
        // Ende traegt schon stp==2; hier kommt das WEITERLEITENDE Ende dazu.
        $loops = self::stpLoops($items);

        $ports = [];
        $extra = 0;
        foreach ($nums as $ifx => $n) {
            if ($n > $slots) {
                $extra++;
                continue;
            }
            $if = $phys[$ifx];
            $ports[$n] = [
                'n'       => $n,
                'ifindex' => (string) $ifx,
                'kind'    => $n <= $copper ? 'rj45' : 'sfp',
                'name'    => $if['name'] ?? '',
                'alias'   => $if['alias'] ?? '',
                'oper'    => $if['oper'] ?? 0,
                'admin'   => $if['admin'] ?? 0,
                'speed'   => $if['speed'] ?? 0.0,
                // 64-Bit-Zaehler vor 32-Bit: wer beide hat, haette sonst die
                // doppelte Rate. 32-Bit nur, wenn HC fehlt.
                'in'      => $if['in'] ?? ($if['in32'] ?? null),
                'out'     => $if['out'] ?? ($if['out32'] ?? null),
                'errors'  => $if['errors'] ?? null,
                'problem' => $if['problem'] ?? -1,
                // UniFi traegt den Liefer-Zustand je Port selbst ($if['poe'],
                // aus port.poe.state); SNMP kommt ueber die pethPse-Map ($poe[$n]).
                'poe'     => array_key_exists('poe', $if) ? $if['poe'] : ($poe[$n] ?? null),
                // PoE-Klasse (Rohwert RFC 3621) — null wenn kein Klassen-Item.
                // UniFi liefert keine RFC-Klasse (nur 802.3af/at/bt), daher dort null.
                'poe_class' => $poe_class[$n] ?? null,
                // Spanning-Tree-Portzustand (dot1dStpPortState): 2 = blocking =
                // der per STP gesperrte Port (z.B. ein gefangener Loop). -1 =
                // keine STP-Daten. Zeigt die Faceplate als ⊘-Marker.
                // Nur bei aktivem Link: RouterOS (und andere) melden fuer einen
                // DOWN-Port discarding(2) — das ist kein geblockter Loop, nur ein
                // toter Port. Ein echter STP-Block hat immer einen Link. Ohne
                // diese Schranke trug jede tote Buchse das Block-Badge.
                'stp'     => (int) ($if['oper'] ?? 0) === 1 ? ($stp[(string) $ifx] ?? -1) : -1,
                // Selbst-Loop: am geblockten Ende die Front-Nummer des Partners
                // (loop_partner), am weiterleitenden Ende die des geblockten
                // Ports (loop_partner_of). Beides Front-Nummern, nicht ifIndexe.
                'loop_partner'    => null,
                'loop_partner_of' => null,
                'nb'      => null,
                'itemid'  => $if['status_itemid'] ?? '',
            ];
        }
        ksort($ports, SORT_NUMERIC);

        self::attachNeighbours($ports, self::neighbours($items), array_keys($ifs));
        self::attachLoops($ports, $loops);

        return [
            'layout' => $name,
            'copper' => $copper,
            'sfp'    => $sfp,
            'ports'  => array_values($ports),
            'extra'  => $extra,
            // PoE-Budget des Switches (Watt), null wenn das Geraet pethMainPse*
            // nicht liefert — dann zeigt das Faceplate keine Budget-Zeile.
            'poe_budget' => $poe_data['budget'],
        ];
    }

    /**
     * Zuschnitt waehlen; $max ist die hoechste Portnummer.
     *
     *   - Fest gewaehlt: gilt.
     *   - Genau 8/16/24/48: reine Kupferfront, keine leeren SFP-Schaechte.
     *   - Sonst der kleinste Zuschnitt, in den $max passt. Liegt $max dabei
     *     NOCH IM KUPFERTEIL (20 Ports -> 24+2), ist es kein solcher Switch:
     *     dann eine reine Kupferfront mit $max (aufgerundet auf gerade)
     *     Buchsen statt vier erfundener Kupfer- und zwei SFP-Schaechte.
     *     Liegt $max im SFP-Teil (9 -> 8+2, 25 -> 24+2), ist es der
     *     Zuschnitt mit fehlendem Port — der bleibt eine leere Buchse.
     *   - Groesser als alles Bekannte: alles Kupfer, bis MAX_PORTS.
     *
     * @return array{0: string, 1: int, 2: int}
     */
    public static function pickLayout(int $max, string $layout): array {
        if (isset(self::LAYOUTS[$layout])) {
            return [$layout, self::LAYOUTS[$layout][0], self::LAYOUTS[$layout][1]];
        }
        if (in_array($max, [8, 16, 24, 48], true)) {
            return [$max . '+0', $max, 0];
        }
        foreach (self::LAYOUTS as $name => [$c, $s]) {
            if ($max <= $c + $s) {
                if ($max > $c) {
                    return [$name, $c, $s];
                }
                break;
            }
        }
        $c = min($max + ($max % 2), self::MAX_PORTS);
        return [$c . '+0', $c, 0];
    }

    /**
     * Welcher Interface-Wert steckt in diesem Key, und fuer welchen ifIndex?
     * Arten wie in MIB; die nackte Form (net.if.status[24]) ueber
     * MetricExtractor::snmpIfKey, dort ist net.if.speed[N] schon bit/s.
     *
     * @return array{0: string, 1: string}|null
     */
    public static function ifKey(string $key): ?array {
        if (preg_match('/(if(?:OperStatus|AdminStatus|Type|HighSpeed|Speed|HCInOctets|InOctets|HCOutOctets|OutOctets|InErrors|OutErrors|Name|Descr|Alias))[.\[](\d+)\]?$/', $key, $m)) {
            return [self::MIB[$m[1]], $m[2]];
        }
        $bare = MetricExtractor::snmpIfKey($key);
        if ($bare === null) {
            return null;
        }
        $map = ['in' => 'in', 'out' => 'out', 'speed' => 'bps', 'status' => 'oper',
                'type' => 'type', 'errors' => 'errors'];
        return isset($map[$bare[0]]) ? [$map[$bare[0]], $bare[1]] : null;
    }

    /**
     * Items nach ifIndex sammeln.
     *
     * @return array<string, array>
     */
    private static function collect(array $items, array $problems): array {
        $ifs = [];
        foreach ($items as $it) {
            $key = (string) ($it['key_'] ?? '');
            $val = $it['lastvalue'] ?? null;
            $hit = self::ifKey($key);
            if ($hit === null) {
                continue;
            }
            [$what, $ifx] = $hit;
            $iid = (string) ($it['itemid'] ?? '');

            // Ein Status- oder Speed-ITEM macht das Interface zu einem
            // ueberwachten — auch ohne Wert (neu, unsupported, nodata).
            // Fiele es weg, rutschte nichts mehr, seit die Nummer nicht mehr
            // die Position ist; aber die Buchse waere leer statt grau.
            if (in_array($what, ['oper', 'hspeed', 'speed', 'bps'], true)) {
                $ifs[$ifx]['seen'] = true;
                if ($what === 'oper' && $iid !== '') {
                    $ifs[$ifx]['status_itemid'] = $iid;
                }
            }
            if (preg_match(self::NAME_RE, (string) ($it['name'] ?? ''), $nm)) {
                if (!isset($ifs[$ifx]['name'])) {
                    $ifs[$ifx]['name'] = MetricExtractor::capName(trim($nm[1]));
                }
                if (isset($nm[2]) && trim($nm[2]) !== '' && !isset($ifs[$ifx]['alias'])) {
                    $ifs[$ifx]['alias'] = MetricExtractor::capName(trim($nm[2]));
                }
            }
            if ($iid !== '' && isset($problems[$iid])) {
                $ifs[$ifx]['problem'] = max($ifs[$ifx]['problem'] ?? -1, (int) $problems[$iid]);
            }
            if ($val === null || $val === '') {
                continue;
            }

            switch ($what) {
                case 'oper':
                    $ifs[$ifx]['oper'] = (int) $val;
                    break;
                case 'admin':
                    $ifs[$ifx]['admin'] = (int) $val;
                    break;
                case 'type':
                    $ifs[$ifx]['type'] = (int) $val;
                    break;
                case 'hspeed':
                    $sp = MetricExtractor::highSpeedBps($val);
                    if ($sp > 0) {
                        $ifs[$ifx]['speed'] = $sp;
                    }
                    break;
                case 'bps':
                    // net.if.speed[24]: in dieser Template-Familie schon bit/s
                    // aus ifHighSpeed — kein 32-Bit-Anschlag, 10G ist 1e10.
                    if ((float) $val > 0) {
                        $ifs[$ifx]['speed'] = (float) $val;
                    }
                    break;
                case 'speed':
                    // ifSpeed: 4294967295 ist der Anschlag, dann gilt ifHighSpeed.
                    $sp = MetricExtractor::speedBps($val);
                    if ($sp > 0 && !isset($ifs[$ifx]['speed'])) {
                        $ifs[$ifx]['speed'] = $sp;
                    }
                    break;
                case 'in':
                case 'out':
                case 'in32':
                case 'out32':
                    // net.if.* ist per Preprocessing schon bit/s, rohe Octets nicht.
                    $ifs[$ifx][$what] = strncmp($key, 'net.if', 6) === 0 ? (float) $val : (float) $val * 8;
                    break;
                case 'errors':
                    $ifs[$ifx]['errors'] = ($ifs[$ifx]['errors'] ?? 0.0) + (float) $val;
                    break;
                case 'name':
                    // Ein echtes ifName-Item schlaegt den Namen aus dem Item-Namen.
                    $ifs[$ifx]['name'] = MetricExtractor::capName(trim((string) $val));
                    break;
                case 'descr':
                    if (!isset($ifs[$ifx]['name'])) {
                        $ifs[$ifx]['name'] = MetricExtractor::capName(trim((string) $val));
                    }
                    break;
                case 'alias':
                    $ifs[$ifx]['alias'] = MetricExtractor::capName(trim((string) $val));
                    break;
            }
        }
        return $ifs;
    }

    /**
     * UniFi-Ports aus den Items der Vorlage „UniFi Network API – Device".
     * Diese zeichnet NICHT per SNMP, sondern holt die Portliste als JSON aus der
     * UniFi-Controller-API; je Port stehen Zustand/Speed/Connector/PoE als eigene
     * Items `port.<feld>[<idx>]`, wobei <idx> schon die Frontportnummer ist.
     *
     * Gemessen 2026-10-26 an einer echten UniFi-Anlage: `state`
     * = UP|DOWN, `connector` = RJ45|SFP, `speed`/`maxSpeed` bereits in bit/s (die
     * Vorlage rechnet Mbit/s ×1e6), `poe.enabled` = "true", `poe.state` = UP|DOWN,
     * `poe.standard` z.B. "802.3at". **Kein Per-Port-Traffic** — die neue UniFi
     * Network Integration API liefert je Port kein Byte-Feld, nur geraeteweit
     * (uplink.rx/tx); darum bleibt in/out hier leer, ehrlich statt geschaetzt.
     *
     * Erkennung an der KEY-PRAESENZ, nicht am Vorlagennamen (der ist umbenennbar).
     * Dieselbe if-Form wie collect(), damit physical()/portNumbers()/build()
     * unveraendert greifen; `kind` (rj45/sfp) kommt wie bei allen Herstellern aus
     * dem Layout — UniFi nummeriert SFP hinter Kupfer, genau diese Annahme.
     *
     * @return array<string, array>  [idx => if-Eintrag wie collect()]
     */
    private static function collectUniFi(array $items, array $problems): array {
        $ifs = [];
        foreach ($items as $it) {
            if (!preg_match('/^port\.(state|speed|maxSpeed|connector|rx|tx|poe\.enabled|poe\.state|poe\.standard|poe\.type)\[(\d+)\]$/',
                    (string) ($it['key_'] ?? ''), $m)) {
                continue;
            }
            $field = $m[1];
            $ifx   = $m[2];
            $val   = trim((string) ($it['lastvalue'] ?? ''));
            $iid   = (string) ($it['itemid'] ?? '');

            // Ein port.*-Item macht den Port zu einem ueberwachten (auch ohne Wert:
            // neu/nodata). type=6 (ethernetCsmacd) behaelt physical() sicher, der
            // Name "Port N" ergibt in portNumbers() die Frontnummer N.
            $ifs[$ifx]['seen'] = true;
            $ifs[$ifx]['type'] = 6;
            if (!isset($ifs[$ifx]['name'])) {
                $ifs[$ifx]['name'] = 'Port ' . $ifx;
            }
            if ($field === 'state') {
                if ($iid !== '') {
                    $ifs[$ifx]['status_itemid'] = $iid;
                }
                if ($iid !== '' && isset($problems[$iid])) {
                    $ifs[$ifx]['problem'] = max($ifs[$ifx]['problem'] ?? -1, (int) $problems[$iid]);
                }
            }
            if ($val === '') {
                continue;
            }

            switch ($field) {
                case 'state':
                    $ifs[$ifx]['oper']  = strcasecmp($val, 'UP') === 0 ? 1 : 2;
                    $ifs[$ifx]['admin'] = 1;   // die API trennt admin-down nicht
                    break;
                case 'speed':
                    // schon bit/s; nur ein linkender Port hat > 0.
                    if ((float) $val > 0) {
                        $ifs[$ifx]['speed'] = (float) $val;
                    }
                    break;
                case 'maxSpeed':
                    // Portkapazitaet — Rueckfall fuer die Anzeige, wenn speed==0
                    // (down-Port), damit die Buchse "1 Gbps" statt nichts zeigt.
                    $ifs[$ifx]['maxspeed'] = (float) $val;
                    break;
                case 'rx':
                    // UniFi rx_bytes-r ist bytes/s; die Faceplate fuehrt in/out in
                    // bit/s (SNMP: Octets x8) -> hier dieselbe x8-Konvention.
                    $ifs[$ifx]['in'] = (float) $val * 8;
                    break;
                case 'tx':
                    $ifs[$ifx]['out'] = (float) $val * 8;
                    break;
                case 'poe.enabled':
                    $ifs[$ifx]['poe_enabled'] = (strcasecmp($val, 'true') === 0);
                    break;
                case 'poe.state':
                    // deliveringPower: der PoE-Port speist gerade (state UP).
                    $ifs[$ifx]['poe'] = (strcasecmp($val, 'UP') === 0);
                    break;
                // connector / poe.standard / poe.type werden heute nicht in der
                // Port-Form dargestellt (kind kommt aus dem Layout); bewusst nur
                // mitgelesen, damit die Erkennung an ihnen greifen kann.
            }
        }

        foreach ($ifs as &$if) {
            // Kapazitaet als Speed-Rueckfall (down-Port zeigt so seine 1G/10G).
            if (empty($if['speed']) && !empty($if['maxspeed'])) {
                $if['speed'] = $if['maxspeed'];
            }
            // Der PoE-Blitz nur an Ports, die PoE koennen: nicht-PoE -> null (kein
            // Indikator); PoE-faehig ohne poe.state -> false (nicht liefernd).
            if (empty($if['poe_enabled'])) {
                $if['poe'] = null;
            }
            elseif (!array_key_exists('poe', $if)) {
                $if['poe'] = false;
            }
        }
        unset($if);

        return $ifs;
    }

    /**
     * Nur Buchsen behalten. Mit ifType ist das eindeutig; ohne ifType muss
     * der Name reichen. Ein Interface ohne Status- oder Speed-Item ist keins,
     * das das Template als Port ueberwacht.
     */
    private static function physical(array $ifs): array {
        $out = [];
        foreach ($ifs as $ifx => $if) {
            if (empty($if['seen'])) {
                continue;
            }
            $typed = isset($if['type']);
            // ifType, wenn vorhanden, muss eine Buchse sein.
            if ($typed && !in_array($if['type'], self::PHYS_TYPES, true)) {
                continue;
            }
            // Namensbasiert verwerfen. MIT physischem ifType nur eindeutig
            // virtuelle Namen (VLAN/Loopback/LAG ...) -- so faellt ein als
            // ethernetCsmacd(6) fehlgemeldetes "Vlan-interface1" (TP-Link) raus,
            // aber ein echter Stacking-/OOB-/mgmt-Port bleibt. OHNE ifType fehlt
            // dieser Beleg, dann greift die breitere Liste.
            $name = trim($if['name'] ?? '');
            if ($name !== '' && preg_match($typed ? self::VIRT_NAME_STRICT : self::VIRT_NAME, $name)) {
                continue;
            }
            $out[$ifx] = $if;
        }
        return $out;
    }

    /**
     * Frontnummer je ifIndex — Quellen und Reihenfolge im Klassenkommentar.
     *
     * @return array<string|int, int>  [ifIndex => Portnummer], nach Nummer sortiert
     */
    public static function portNumbers(array $phys): array {
        if (!$phys) {
            return [];
        }

        // 1. Ziffern am Namensende, eindeutig und im Rahmen.
        $by_name = [];
        foreach ($phys as $ifx => $if) {
            if (!preg_match('/(\d+)\s*$/', (string) ($if['name'] ?? ''), $m)) {
                $by_name = null;
                break;
            }
            $by_name[$ifx] = (int) $m[1];
        }
        if ($by_name && min($by_name) >= 1 && max($by_name) <= self::MAX_PORTS
                && count(array_unique($by_name)) === count($by_name)) {
            asort($by_name, SORT_NUMERIC);
            return $by_name;
        }

        // 2. ifIndex relativ zum kleinsten.
        $idx = array_map('intval', array_keys($phys));
        $min = min($idx);
        if (max($idx) - $min < self::MAX_PORTS) {
            $out = [];
            foreach ($phys as $ifx => $_) {
                $out[$ifx] = (int) $ifx - $min + 1;
            }
            asort($out, SORT_NUMERIC);
            return $out;
        }

        // 3. Position.
        $keys = array_keys($phys);
        sort($keys, SORT_NUMERIC);
        $out = [];
        foreach ($keys as $i => $ifx) {
            $out[$ifx] = $i + 1;
        }
        return $out;
    }

    /**
     * LLDP-Nachbarn an die Ports haengen. lldpRemTable ist nach lldpLocPortNum
     * indiziert. Die ist auf den meisten Switches gleich dem ifIndex, auf
     * manchen (HPE Comware, einige SMB) die Portnummer. Darum zuerst ifIndex;
     * die Portnummer nur, wenn lldpLocPortNum KEIN bekannter ifIndex ist —
     * sonst landete ein Nachbar an einem LAG oder VLAN (ifIndex 5, als
     * virtuell ausgefiltert) auf Frontport 5.
     *
     * @param array $ports     [n => port], nach n
     * @param array $nb        [lldpLocPortNum => ['host','port']]
     * @param array $all_ifx   alle bekannten ifIndexe, auch virtuelle
     */
    private static function attachNeighbours(array &$ports, array $nb, array $all_ifx): void {
        $by_ifx = [];
        foreach ($ports as $n => $p) {
            $by_ifx[$p['ifindex']] = $n;
        }
        $known = array_flip(array_map('strval', $all_ifx));
        foreach ($nb as $loc => $info) {
            $n = $by_ifx[(string) $loc] ?? null;
            if ($n === null && !isset($known[(string) $loc]) && isset($ports[$loc])) {
                $n = $loc;
            }
            if ($n !== null && $ports[$n]['nb'] === null) {
                $ports[$n]['nb'] = $info;
            }
        }
    }

    /**
     * LLDP-Nachbarn je lldpLocPortNum aus lldpRemSysName/-PortId/-PortDesc.
     * Index ist "timeMark.localPort.remIndex" oder schon die Portnummer.
     *
     * @return array<int, array{host: string, port: string}>
     */
    private static function neighbours(array $items): array {
        $nb = [];
        foreach ($items as $it) {
            if (!preg_match('/lldpRem(SysName|PortId|PortDesc)[.\[]([\d.]+)\]?$/', (string) ($it['key_'] ?? ''), $m)) {
                continue;
            }
            $val = trim((string) ($it['lastvalue'] ?? ''));
            if ($val === '') {
                continue;
            }
            $parts = explode('.', $m[2]);
            $loc = (int) (count($parts) >= 3 ? $parts[count($parts) - 2] : $parts[0]);
            if ($loc <= 0) {
                continue;
            }
            if (!isset($nb[$loc])) {
                $nb[$loc] = ['host' => '', 'port' => ''];
            }
            if ($m[1] === 'SysName') {
                $nb[$loc]['host'] = MetricExtractor::capName($val);
            }
            // PortDesc ist lesbarer als eine PortId, die oft eine MAC ist.
            elseif ($m[1] === 'PortDesc' || $nb[$loc]['port'] === '') {
                $nb[$loc]['port'] = MetricExtractor::capName($val);
            }
        }
        return array_filter($nb, static function (array $e): bool {
            return $e['host'] !== '';
        });
    }

    /**
     * Alle PoE-Werte der POWER-ETHERNET-MIB in EINEM Durchlauf: Liefer-Zustand
     * und Klasse je Port (nach PSE-Gruppe gebuendelt) plus das Switch-Budget.
     * Frueher drei, zuletzt vier getrennte Scans ueber die (bis MAX_ITEMS grosse)
     * Item-Liste; hier einer.
     *
     * Quellen: pethPsePortDetectionStatus.<gruppe>.<port> (3 = deliveringPower),
     * pethPsePortPowerClassifications.<gruppe>.<port> (Rohwert nach RFC 3621:
     * 1=class0 … 5=class4, 6/7=Sonderfaelle — roh durchgereicht, das Frontend
     * bildet das Label 0..4), und die Host-Scalars nt.poe.used
     * (pethMainPseConsumptionPower) / nt.poe.nominal (pethMainPsePower), je Watt.
     * Port ist die Frontportnummer, nicht der ifIndex.
     *
     * Beide Portspalten werden aus DERSELBEN Gruppe gelesen: der KLEINSTEN mit
     * irgendwelchen PoE-Daten. In einem Stack ist jede Gruppe ein Mitglied mit
     * eigener Front 1..n, und die Faceplate zeigt eine Front; ohne gemeinsame
     * Wahl kreuzte der Tooltip "Class X, delivering" eine Klasse aus Mitglied 1
     * mit dem Strom aus Mitglied 2 (je nach Item-Reihenfolge). Fehlt der
     * gewaehlten Gruppe eine Spalte, bleibt ihr Port-Feld leer (null) statt aus
     * einem anderen Mitglied geborgt — der Tooltip zeigt dann nur die Klasse.
     *
     * Budget: fehlt eines der beiden Items oder ist leer, zaehlt es als 0;
     * fehlen beide, gibt es kein Budget (null) — viele Switches liefern
     * pethMainPse* nicht, und eine erfundene Null waere schlimmer als nichts.
     *
     * @return array{poe: array<int, bool>, class: array<int, int>, budget: array{used: int, nominal: int}|null}
     */
    private static function collectPoe(array $items): array {
        $det = [];       // [gruppe => [frontport => bool deliveringPower]]
        $cls = [];       // [gruppe => [frontport => int klasse-rohwert]]
        $used = null;
        $nominal = null;
        foreach ($items as $it) {
            $key = (string) ($it['key_'] ?? '');
            $val = $it['lastvalue'] ?? '';
            if ($val === '') {
                continue;
            }
            if (preg_match('/pethPsePortDetectionStatus[.\[](\d+)\.(\d+)\]?$/', $key, $m)) {
                $det[(int) $m[1]][(int) $m[2]] = ((int) $val === 3);
            }
            elseif (preg_match('/pethPsePortPowerClassifications[.\[](\d+)\.(\d+)\]?$/', $key, $m)) {
                $cls[(int) $m[1]][(int) $m[2]] = (int) $val;
            }
            elseif ($key === 'nt.poe.used') {
                $used = (int) $val;
            }
            elseif ($key === 'nt.poe.nominal') {
                $nominal = (int) $val;
            }
        }
        // Die anzuzeigende Gruppe: kleinster Index, der in IRGENDEINER Portspalte
        // vorkommt ($det + $cls vereint die Gruppen-Schluessel).
        $group_keys = array_keys($det + $cls);
        $group = $group_keys ? min($group_keys) : null;
        return [
            'poe'    => $group !== null ? ($det[$group] ?? []) : [],
            'class'  => $group !== null ? ($cls[$group] ?? []) : [],
            'budget' => ($used === null && $nominal === null)
                ? null
                : ['used' => $used ?? 0, 'nominal' => $nominal ?? 0],
        ];
    }

    /**
     * Per-Port Spanning-Tree-Zustand aus den nt.if.stp[<ifIndex>]-Items
     * (dot1dStpPortState, STP-Template). Werte: 1=disabled, 2=blocking,
     * 3=listening, 4=learning, 5=forwarding, 6=broken. Interessant ist 2
     * (blocking) — der per STP gesperrte Port.
     *
     * @return array<string,int>  ifIndex => Zustand
     */
    private static function stp(array $items): array {
        $out = [];
        foreach ($items as $it) {
            if (preg_match('/nt\.if\.stp\[(\d+)\]$/', (string) ($it['key_'] ?? ''), $m)
                    && ($it['lastvalue'] ?? '') !== '') {
                $out[(string) $m[1]] = (int) $it['lastvalue'];
            }
        }
        return $out;
    }

    /**
     * Selbst-Loops aus dem nt.stp.walk-Item (die BRIDGE-MIB-Tabellen als
     * Walk-Text). StpLoopResolver dekodiert daraus [geblockter ifIndex =>
     * Partner-ifIndex]. Fehlt das Item (STP-Template nicht verlinkt oder aelter),
     * ist die Liste leer und die Faceplate markiert wie bisher nur das geblockte
     * Ende.
     *
     * @return array<int,int>  ifIndex (geblockt) => ifIndex (Partner)
     */
    private static function stpLoops(array $items): array {
        foreach ($items as $it) {
            if ((string) ($it['key_'] ?? '') === 'nt.stp.walk') {
                return StpLoopResolver::resolve((string) ($it['lastvalue'] ?? ''));
            }
        }
        return [];
    }

    /**
     * Partner-Enden an die Ports haengen. Die Loop-Map ist nach ifIndex
     * geschluesselt, die Ports nach Front-Nummer — hier wird ueber den ifIndex
     * jedes Ports zurueckuebersetzt. Nur Loops, deren BEIDE Enden auf der
     * gezeichneten Front liegen (ein Port kann ausserhalb des Zuschnitts oder
     * als virtuell ausgefiltert sein).
     *
     * @param array $ports  [n => port], nach n
     * @param array $loops  [geblockter ifIndex => Partner-ifIndex]
     */
    private static function attachLoops(array &$ports, array $loops): void {
        if (!$loops) {
            return;
        }
        $by_ifx = [];
        foreach ($ports as $n => $p) {
            $by_ifx[(string) $p['ifindex']] = $n;
        }
        foreach ($loops as $blockedIfx => $partnerIfx) {
            $bn = $by_ifx[(string) $blockedIfx] ?? null;
            $pn = $by_ifx[(string) $partnerIfx] ?? null;
            if ($bn === null || $pn === null) {
                continue;
            }
            // Beide Enden brauchen einen aktiven Link — ein Loop ueber eine tote
            // Buchse gibt es nicht (ein down-Port in discarding ist kein Partner).
            if ((int) ($ports[$bn]['oper'] ?? 0) !== 1 || (int) ($ports[$pn]['oper'] ?? 0) !== 1) {
                continue;
            }
            $ports[$bn]['loop_partner']    = $pn;   // geblockt -> Partner-Front-Nr
            $ports[$pn]['loop_partner_of'] = $bn;   // weiterleitend -> geblockte Front-Nr
        }
    }
}
