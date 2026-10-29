<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * StpLoopResolver
 *
 * Findet das ZWEITE Ende eines Selbst-Loops. Ein Kabel vom Switch auf sich
 * selbst bekommt von RSTP genau EINEN Port geblockt (dot1dStpPortState == 2);
 * das andere Ende LEITET WEITER (state 5) und ist aus dem Zustand allein nicht
 * von einem gesunden Up-Port zu trennen. Die Faceplate markierte deshalb nur
 * das geblockte Ende. Hier wird der Partner-Port bestimmt, damit beide Enden
 * sichtbar werden.
 *
 * Woher der Partner kommt (BRIDGE-MIB, RFC 4188):
 *   dot1dStpPortDesignatedBridge  .17.2.15.1.8  8 Byte Bridge-ID (2 Byte Prio +
 *                                 6 Byte MAC) des designierten Bridge am Segment.
 *   dot1dStpPortDesignatedPort    .17.2.15.1.9  2 Byte Port-ID (4 Bit Prio +
 *                                 12 Bit Portnummer) des designierten Ports.
 *   dot1dBaseBridgeAddress        .17.1.1.0     die eigene Bridge-MAC.
 *   dot1dBasePortIfIndex          .17.1.4.1.2   Bridge-Port -> ifIndex.
 *
 * Ein geblockter Port, dessen designierte Bridge die EIGENE ist, blockt gegen
 * einen EIGENEN Port — ein Selbst-Loop. Die designierte Port-Nummer nennt
 * diesen Partner-Bridge-Port, der ueber dot1dBasePortIfIndex zum ifIndex wird.
 * Zeigt die designierte Bridge auf ein FREMDES Geraet, ist es ein normaler
 * Redundanz-Block (Partner liegt auf dem anderen Switch) — den zeigt eine
 * Frontansicht EINES Hosts nicht, also faellt er hier weg.
 *
 * Am HPE 1830 (JL813A) live belegt: Loop 21<->23, RSTP blockt Bridge-Port 23,
 * designatedBridge[23] = Prio+eigene MAC, designatedPort[23] = 0x8015 -> Port 21.
 *
 * Eingabe ist der Text des nt.stp.walk-Items (Zabbix-walk[]-Ausgabe,
 * "<oid> = <TYP>: <wert>" je Zeile). Rein und testbar, kein API-Call.
 */
final class StpLoopResolver {

    /**
     * @param string $walk  Wert des nt.stp.walk-Items (vier Spalten + Base-Bridge)
     *
     * @return array<int,int>  [geblockter ifIndex => Partner-ifIndex], nur Selbst-Loops
     */
    public static function resolve(string $walk): array {
        if (trim($walk) === '') {
            return [];
        }

        $state = [];    // bridge-port => dot1dStpPortState
        $ifx = [];      // bridge-port => ifIndex
        $dbridge = [];  // bridge-port => Hex-Bytes der designierten Bridge-ID
        $dport = [];    // bridge-port => Hex-Bytes der designierten Port-ID
        $base = [];     // Hex-Bytes der eigenen Bridge-MAC

        foreach (preg_split('/\r?\n/', $walk) as $line) {
            if (preg_match('/17\.2\.15\.1\.3\.(\d+)\s*=\s*[^:]*:\s*(\d+)/', $line, $m)) {
                $state[$m[1]] = (int) $m[2];
            }
            elseif (preg_match('/17\.1\.4\.1\.2\.(\d+)\s*=\s*[^:]*:\s*(\d+)/', $line, $m)) {
                $ifx[$m[1]] = (int) $m[2];
            }
            elseif (preg_match('/17\.2\.15\.1\.8\.(\d+)\s*=\s*(.+)$/', $line, $m)) {
                $dbridge[$m[1]] = self::hexBytes($m[2]);
            }
            elseif (preg_match('/17\.2\.15\.1\.9\.(\d+)\s*=\s*(.+)$/', $line, $m)) {
                $dport[$m[1]] = self::hexBytes($m[2]);
            }
            elseif (preg_match('/17\.1\.1\.0\s*=\s*(.+)$/', $line, $m)) {
                $base = self::hexBytes($m[1]);
            }
        }

        // Eigene MAC: die letzten 6 Byte (dot1dBaseBridgeAddress ist genau 6).
        $baseMac = self::last6($base);
        if ($baseMac === '') {
            return [];
        }

        $out = [];
        foreach ($state as $bp => $st) {
            if ($st !== 2) {
                continue;                               // nur geblockte Ports
            }
            // designierte Bridge == eigene Bridge? Sonst Redundanz-Block zu einem
            // fremden Switch, kein Selbst-Loop.
            if (self::last6($dbridge[$bp] ?? []) !== $baseMac) {
                continue;
            }
            $dp = $dport[$bp] ?? [];
            if (count($dp) < 2) {
                continue;
            }
            // Port-ID: 4 Bit Prioritaet + 12 Bit Portnummer.
            $portId = (hexdec($dp[0]) << 8) | hexdec($dp[1]);
            $partnerBp = (string) ($portId & 0x0FFF);

            $blockedIfx = $ifx[(string) $bp] ?? null;
            $partnerIfx = $ifx[$partnerBp] ?? null;
            if ($blockedIfx !== null && $partnerIfx !== null && $blockedIfx !== $partnerIfx) {
                $out[$blockedIfx] = $partnerIfx;
            }
        }
        return $out;
    }

    /**
     * Hex-Bytepaare aus einem Zabbix-walk-Wert. Ein fuehrendes Typ-Label
     * ("Hex-STRING: ", "STRING: ") faellt weg, dann zaehlen die Bytepaare,
     * egal ob durch Leerzeichen oder Doppelpunkt getrennt.
     *
     * @return array<int,string>  Byte als zweistelliges Kleinbuchstaben-Hex
     */
    private static function hexBytes(string $s): array {
        $s = preg_replace('/^\s*[A-Za-z0-9-]+:\s*/', '', $s);
        preg_match_all('/[0-9A-Fa-f]{2}/', (string) $s, $mm);
        return array_map('strtolower', $mm[0]);
    }

    /** Letzte 6 Byte als zusammenhaengender Hex-String, oder '' wenn zu kurz. */
    private static function last6(array $bytes): string {
        if (count($bytes) < 6) {
            return '';
        }
        return implode('', array_slice($bytes, -6));
    }
}
