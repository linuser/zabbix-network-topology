<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * LldpLocalPortParser — aus dem Walk der lldpLocPortTable die lokale
 * Port-Identitaet je Host machen: „lokaler LLDP-Port 13 heisst Ethernet3/1".
 *
 * WARUM DAS NOeTIG IST (#31)
 * -------------------------
 * Der LLDP-MIB-Index einer Nachbarzeile ist dreiteilig:
 * TimeMark.lldpRemLocalPortNum.lldpRemIndex. Die Mitte ist der LOKALE Port, auf
 * dem der Nachbar gesehen wurde. Auf Aruba/ProCurve/Cisco ist diese Zahl zufaellig
 * gleich dem IF-MIB-ifIndex, auf Arista EOS / Mellanox Onyx / Cumulus aber NICHT —
 * dort ist lldpRemLocalPortNum ein eigener, von der LLDP-Agent-Implementierung
 * vergebener Index. Direkt als ifIndex benutzt bindet die Karte das falsche
 * Interface (der SVI „Vlan13" statt des physischen Ports „Ethernet3/1"@3001),
 * zeigt dessen Zaehler und verpasst den Down-State des Kabels.
 *
 * Die lldpLocPortTable (1.0.8802.1.1.2.1.3.7) traegt — mit demselben
 * lldpLocPortNum als Index — den Namen des lokalen Ports. LldpEdgeBuilder
 * uebersetzt ihn dann gegen die eigenen Interface-Namen des Hosts in den echten
 * ifIndex (localIfIndex(): typisierte Port-ID zuerst, Desc als Rueckfall).
 *
 * REIN UND TESTBAR
 * ----------------
 * Wie VlanParser/FdbParser: kein SNMP, kein API-Call. Die Action holt den Walk
 * als Text und reicht ihn herein; hier wird nur geparst. Die eigentliche
 * ifIndex-Aufloesung (die riskante Stelle) liegt bewusst NICHT hier, sondern in
 * LldpEdgeBuilder, wo die Interface-Namen und normPort() schon vorliegen.
 */
final class LldpLocalPortParser {

    // lldpLocPortTable-Spalten (IEEE 802.1AB, LLDP-MIB):
    //   .7.1.2  lldpLocPortIdSubtype  (INTEGER: 5 = interfaceName, 7 = local, …)
    //   .7.1.3  lldpLocPortId         (STRING: je nach Subtype der Portname)
    //   .7.1.4  lldpLocPortDesc       (STRING: frei konfigurierte Beschreibung)
    private const COLS = [
        '1.0.8802.1.1.2.1.3.7.1.2.' => 'subtype',
        '1.0.8802.1.1.2.1.3.7.1.3.' => 'id',
        '1.0.8802.1.1.2.1.3.7.1.4.' => 'desc',
    ];

    /**
     * Den Walk-Text in [localPort => {id, subtype, desc}] zerlegen.
     *
     * Zeilenformat wie bei allen Walk-Items (nt.vlan.walk/nt.stp.walk):
     *   "<OID> = <TYP>: <Wert>"
     * Der Index hinter dem Spalten-Prefix IST die lokale Portnummer
     * (einteilig), kein zusammengesetzter Index.
     *
     * @return array<string, array{id:string,subtype:int,desc:string}>
     */
    public static function parseWalk(string $walk): array {
        $out = [];
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
            // "TYP: Wert" — Hex-/normale STRINGs; sonst nackter/leerer Wert.
            if (preg_match('/^[A-Za-z0-9-]+:[ ]?(.*)$/', $rhs, $m)) {
                $val = rtrim($m[1]);
            } else {
                $val = $rhs;
            }
            // STRING-Werte kommen in Anfuehrungszeichen ("Ethernet3/1") — die
            // muessen weg, sonst matcht normPort() den Portnamen nie.
            $val = trim($val, '"');
            foreach (self::COLS as $prefix => $field) {
                if (strncmp($oid, $prefix, strlen($prefix)) === 0) {
                    $port = substr($oid, strlen($prefix));
                    // Nur die reine Portnummer; ein Rest-Index (sollte es hier
                    // nicht geben) wird auf die erste Komponente reduziert.
                    if (strpos($port, '.') !== false) {
                        $port = explode('.', $port)[0];
                    }
                    if (!isset($out[$port])) {
                        $out[$port] = ['id' => '', 'subtype' => 0, 'desc' => ''];
                    }
                    $out[$port][$field] = $field === 'subtype' ? (int) $val : $val;
                    break;
                }
            }
        }
        return $out;
    }
}
