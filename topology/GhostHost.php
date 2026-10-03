<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * GhostHost — aus einem unueberwachten Nachbarn einen Zabbix-Host machen.
 *
 * WOZU
 * ----
 * Die Karte zeigt seit 5.5.0 unueberwachte Nachbarn mit dem Switch und dem
 * PORT, an dem sie haengen. Der naechste Schritt ist, daraus einen Host zu
 * machen — und zwar ohne dass jemand abtippt, was eine Sekunde vorher auf dem
 * Schirm stand.
 *
 * WARUM DAS NICHT UEBER DAS FORMULAR GEHT
 * ---------------------------------------
 * Bis hierher oeffnete das Kontextmenue Zabbix' Host-Formular mit
 * ?host=…&description=…&groupids[]=…. Auf 7.0.31 nachgemessen: NUR groupids
 * kommt an. Name und Beschreibung werden stillschweigend verworfen — das
 * Formular ging auf, war aber leer, und genau das Abtippen blieb. Die
 * Zabbix-Dokumentation fuehrt groupids als Seitenparameter, den Hostnamen
 * nicht; es war also nie zugesichert.
 *
 * Deshalb legt das Modul den Host ueber die API an. Dort laesst sich auch das
 * setzen, was ueber eine URL ohnehin nie ginge: das Tag nt:uplink, mit dem
 * der neue Host sofort an der richtigen Stelle auf der Karte sitzt, bevor er
 * selbst irgendetwas meldet.
 *
 * WAS HIER DRIN LIEGT UND WAS NICHT
 * ---------------------------------
 * Hier liegt die Pruefung und der Bau der Nutzlast — ohne Zabbix, ohne API,
 * ohne Controller-Zustand, und damit einzeln pruefbar. Die Rechte, der
 * CSRF-Token und der eigentliche Aufruf liegen in der Action.
 *
 * DIE EINGABEN SIND NICHT VERTRAUENSWUERDIG. Der Name kommt ueber LLDP/CDP
 * von einem fremden Geraet, der Portname ebenso. Beide gehen von dort in
 * einen Hostnamen und in einen Tag-Wert.
 */
final class GhostHost {

    /** Zabbix' Grenze fuer den technischen Hostnamen. */
    public const MAX_NAME = 128;

    /** Zabbix' Grenze fuer einen Tag-Wert; der Parser kappt bei 256. */
    public const MAX_TAG_VALUE = 255;

    /** Beschreibung: dieselbe Grenze, die das Kontextmenue schon benutzte. */
    public const MAX_DESC = 250;

    /**
     * Taugt dieser Name als technischer Hostname?
     *
     * ABSICHTLICH ABLEHNEN STATT STILL UMSCHREIBEN. Ein Name, aus dem wir
     * verbotene Zeichen entfernen, erzeugt einen Host, der ANDERS heisst als
     * das Geraet auf der Karte — und damit genau die Verbindung kappt, um die
     * es hier geht: der Melder nennt den Nachbarn weiter beim alten Namen,
     * und der neue Host wird nie dazu aufgeloest. Lieber sagen, dass es nicht
     * geht, und den Menschen entscheiden lassen.
     */
    public static function nameOk(string $name): bool {
        $n = trim($name);
        if ($n === '' || mb_strlen($n) > self::MAX_NAME) {
            return false;
        }
        // Zeichensatz des technischen Hostnamens in Zabbix: Buchstaben,
        // Ziffern, Leerzeichen, Punkt, Bindestrich, Unterstrich.
        return (bool) preg_match('/^[A-Za-z0-9 ._-]+$/', $n);
    }

    /**
     * Der Wert fuer nt:uplink — oder '', wenn er nicht sicher baubar ist.
     *
     * HostTagParser trennt am LETZTEN Doppelpunkt, weil Portnamen keinen
     * tragen und Hostnamen theoretisch doch (IPv6 als Name). Daraus folgt
     * eine Falle: traegt der PORT einen Doppelpunkt — eine Port-ID in
     * MAC-Form wie "3C:EC:EF:79:2C:88" kommt ueber LLDP durchaus vor —, dann
     * trennt der Parser an der falschen Stelle und der Host haengt danach an
     * einem Geraet, das es nicht gibt.
     *
     * In dem Fall entsteht hier KEIN Tag. Ein fehlender Uplink ist ein
     * fehlender Hinweis; ein falscher ist eine Behauptung ueber die
     * Verkabelung, die aussieht wie eine Messung.
     */
    public static function uplinkValue(string $reporterHost, string $port): string {
        $h = trim($reporterHost);
        $p = trim($port);
        if ($h === '' || $p === '') {
            return '';
        }
        if (strpos($p, ':') !== false) {
            return '';
        }
        if (preg_match('/[\x00-\x1F\x7F]/', $h . $p)) {
            return '';
        }
        $wert = $h . ':' . $p;
        return mb_strlen($wert) > self::MAX_TAG_VALUE ? '' : $wert;
    }

    /**
     * Woher der Host kommt — fuer das Beschreibungsfeld.
     *
     * Der Satz soll in einem halben Jahr noch erklaeren, warum es diesen Host
     * gibt und wer ihn gesehen hat.
     */
    public static function description(string $via, string $reporterHost, string $port): string {
        $v = strtoupper(trim($via)) ?: 'LLDP';
        $h = trim($reporterHost);
        $txt = 'Discovered via ' . $v;
        if ($h !== '') {
            $txt .= ' by ' . $h;
            if (trim($port) !== '') {
                $txt .= ' on port ' . trim($port);
            }
        }
        $txt .= ' (Network Topology)';
        $txt = preg_replace('/[\x00-\x1F\x7F]/', ' ', $txt);
        return mb_substr($txt, 0, self::MAX_DESC);
    }

    /**
     * Die Nutzlast fuer API::Host()->create().
     *
     * @param array $in  name, groupid, reporter_host, port, via
     * @return array{ok: bool, error?: string, payload?: array}
     *
     * OHNE INTERFACE. Ueber ein unueberwachtes Geraet ist keine Adresse
     * bekannt — eine zu erfinden waere schlimmer als keine. Zabbix laesst
     * Hosts ohne Interface zu; wer das Geraet abfragen will, traegt es im
     * Formular nach.
     */
    public static function payload(array $in): array {
        $name = trim((string) ($in['name'] ?? ''));
        if (!self::nameOk($name)) {
            return ['ok' => false, 'error' => 'name'];
        }
        $groupid = (string) ($in['groupid'] ?? '');
        if ($groupid === '' || !ctype_digit($groupid)) {
            return ['ok' => false, 'error' => 'group'];
        }

        $melder = (string) ($in['reporter_host'] ?? '');
        $port   = (string) ($in['port'] ?? '');

        $payload = [
            'host'        => $name,
            'groups'      => [['groupid' => $groupid]],
            'description' => self::description((string) ($in['via'] ?? ''), $melder, $port),
        ];

        $uplink = self::uplinkValue($melder, $port);
        if ($uplink !== '') {
            $payload['tags'] = [['tag' => 'nt:uplink', 'value' => $uplink]];
        }

        return ['ok' => true, 'payload' => $payload];
    }
}
