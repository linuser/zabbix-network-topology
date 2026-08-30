<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

use API;
use APP;
use CProfile;

/**
 * ManualLinks
 *
 * Manuell gezogene Kanten — die Verbindungen, die LLDP/CDP nicht meldet und die
 * jemand von Hand einzeichnet, weil er die Verkabelung kennt.
 *
 * Bis 5.0 lagen sie im localStorage: an einen Browser gebunden, weg beim
 * Cache-Leeren, und der Kollege sah sie nie. Seit 5.0.1 liegen sie auf dem
 * Server, in ZWEI Ebenen:
 *
 *   shared    -> module.config (Spalte config der module-Tabelle)
 *                Eine Aussage ueber das Netz. Alle sehen sie.
 *                Schreiben nur Super-Admins — das ist keine Design-Entscheidung
 *                von uns, sondern in CModule::update() hart geprueft.
 *
 *   personal  -> CProfile des jeweiligen Users
 *                Eine persoenliche Notiz. Jeder pflegt seine eigenen, sie
 *                folgen ihm ueber Browser und Rechner hinweg.
 *
 * Beim Lesen werden beide Ebenen zusammengefuehrt; das Frontend faerbt sie
 * unterschiedlich ein, damit erkennbar bleibt, was verbindlich ist.
 *
 * LESEN OHNE API
 * --------------
 * module.config wird bewusst NICHT ueber API::Module()->get() gelesen: das
 * wirft fuer jeden Nicht-Super-Admin eine Permission-Exception (CModule::get()
 * prueft das im Rumpf, unabhaengig von den deklarierten ACCESS_RULES). Ein
 * Modul darf seine eigene Config aber ohnehin lesen — Zabbix hat sie beim
 * Bootstrap bereits aus der DB geholt und in den ModuleManager gelegt.
 * Schreiben laeuft dagegen ueber die API, weil dort die Rechtepruefung sitzt.
 *
 * WARUM KEINE HOST-TAGS
 * ---------------------
 * Naheliegend waere ein nt:*-Tag am Host, wie bei nt:parent. Geht aber nicht:
 * ein Link darf auf einen Ghost-Knoten zeigen (ein per LLDP gemeldeter Nachbar,
 * der in Zabbix gar nicht existiert, Node-ID "ghost_<slug>"). Ein Tag braucht
 * einen Host, den es hier nicht gibt.
 */
final class ManualLinks {

    public const SCOPE_SHARED   = 'shared';
    public const SCOPE_PERSONAL = 'personal';

    /** Modul-ID aus manifest.json — Schluessel fuer den ModuleManager. */
    private const MODULE_ID = 'network_topology';

    /** Schluessel innerhalb von module.config. */
    private const CONFIG_KEY = 'manual_links';

    /**
     * profiles.idx ist varchar(96) — dieser Wert hat 34 Zeichen.
     * Gespeichert wird EIN Link pro Zeile ueber CProfile::updateArray(), nicht
     * ein JSON-Blob: value_str ist je nach DB-Backend unterschiedlich lang, ein
     * wachsendes Array wuerde irgendwann still abgeschnitten.
     */
    private const PROFILE_IDX = 'web.network_topology.manual_links';

    /**
     * Obergrenze. Eine Topologie mit mehr als 2000 handgezogenen Kanten ist
     * kein Bedienfall mehr, sondern ein Fuellangriff auf die profiles- bzw.
     * module-Tabelle. Ueberzaehlige werden verworfen, nicht gemeldet — der
     * Client kann die Grenze nicht sinnvoll anzeigen.
     */
    private const MAX_LINKS = 2000;

    /**
     * Wie viele Kanten der letzte sanitize()-Lauf verworfen hat.
     *
     * NodePositions meldet sein Kappen seit 5.1 an den Client; hier fiel es
     * stillschweigend unter den Tisch. Wer 2100 Kanten speichert und 2000
     * zurueckbekommt, soll das erfahren — sonst sieht es aus, als haette das
     * Speichern funktioniert, und die fehlenden 100 fallen erst viel spaeter
     * auf.
     */
    private static int $truncated = 0;

    public static function lastTruncated(): int {
        return self::$truncated;
    }

    /** Node-IDs sind Hostids ("10084") oder Ghost-Slugs ("ghost_sw01_lan"). */
    private const ID_PATTERN = '/^[A-Za-z0-9_.:-]{1,128}$/';

    // ── Lesen ────────────────────────────────────────────────────────────────

    /**
     * Geteilte Links aus module.config. Fuer JEDEN User lesbar.
     */
    public static function loadShared(): array {
        $module = APP::ModuleManager()->getModule(self::MODULE_ID);

        if ($module === null) {
            return [];
        }

        $config = $module->getConfig();
        $raw    = $config[self::CONFIG_KEY] ?? [];

        return is_array($raw) ? self::sanitize($raw) : [];
    }

    /**
     * Persoenliche Links des angemeldeten Users.
     */
    public static function loadPersonal(): array {
        $rows = CProfile::getArray(self::PROFILE_IDX, []);

        if (!is_array($rows)) {
            return [];
        }

        $links = [];

        foreach ($rows as $row) {
            $pair = self::decode((string) $row);

            if ($pair !== null) {
                $links[] = $pair;
            }
        }

        return self::sanitize($links);
    }

    // ── Schreiben ────────────────────────────────────────────────────────────

    /**
     * Geteilte Links ersetzen. Wirft, wenn der User kein Super-Admin ist —
     * die Pruefung sitzt in CModule::update(), wir verlassen uns darauf statt
     * sie zu duplizieren.
     *
     * Achtung: setConfig() aktualisiert nur die Instanz im laufenden Request.
     * Persistiert wird ueber die API; ohne das waere die Aenderung nach dem
     * naechsten Request wieder weg.
     */
    public static function saveShared(array $links): array {
        $clean  = self::sanitize($links);
        $module = APP::ModuleManager()->getModule(self::MODULE_ID);

        if ($module === null) {
            return [];
        }

        $config                    = $module->getConfig();
        $config[self::CONFIG_KEY]  = $clean;

        API::Module()->update([[
            'moduleid' => $module->getModuleId(),
            'config'   => $config
        ]]);

        $module->setConfig($config);

        return $clean;
    }

    /**
     * Persoenliche Links ersetzen. updateArray() raeumt ueberzaehlige alte
     * Zeilen selbst ab, ein leeres Array loescht also sauber.
     */
    public static function savePersonal(array $links): array {
        $clean = self::sanitize($links);
        $rows  = [];

        foreach ($clean as $l) {
            $rows[] = self::encode($l);
        }

        CProfile::updateArray(self::PROFILE_IDX, $rows, PROFILE_TYPE_STR);

        return $clean;
    }

    // ── Validierung ──────────────────────────────────────────────────────────

    /**
     * Macht aus dem, was der Client schickt, etwas Speicherbares.
     *
     * Die Node-IDs landen spaeter als Cytoscape-Element-IDs und in
     * Edge-IDs ("ml_<s>_<t>") wieder im DOM — deshalb hier ein enges
     * Zeichenmuster statt einer Laengenpruefung allein.
     *
     * Nebenbei: das Paar wird sortiert. Eine Kante ist ungerichtet, {a,b} und
     * {b,a} sind derselbe Link; ohne Normalisierung wuerde beides
     * nebeneinander gespeichert und doppelt gezeichnet.
     */
    public static function sanitize(array $raw): array {
        $out  = [];
        $seen = [];
        self::$truncated = 0;

        foreach ($raw as $item) {
            if (!is_array($item)) {
                continue;
            }

            $s = isset($item['s']) ? (string) $item['s'] : '';
            $t = isset($item['t']) ? (string) $item['t'] : '';

            if ($s === '' || $t === '' || $s === $t) {
                continue;
            }

            if (!preg_match(self::ID_PATTERN, $s) || !preg_match(self::ID_PATTERN, $t)) {
                continue;
            }

            if (strcmp($s, $t) > 0) {
                [$s, $t] = [$t, $s];
            }

            $key = $s.'|'.$t;

            if (isset($seen[$key])) {
                continue;
            }

            $seen[$key] = true;
            $out[]      = ['s' => $s, 't' => $t];

            if (count($out) >= self::MAX_LINKS) {
                // Alles ab hier faellt weg. Die Zahl ist eine OBERGRENZE fuer
                // den Rest, keine exakte Bilanz: der ungelesene Teil wurde
                // weder auf Duplikate noch auf Gueltigkeit geprueft, koennte
                // also weniger echte Kanten enthalten. Fuer die Aussage "es
                // wurde gekappt, und zwar spuerbar" reicht das — mehr soll sie
                // nicht behaupten.
                self::$truncated = max(0, count($raw) - count($out));
                break;
            }
        }

        return $out;
    }

    // ── Serialisierung fuer CProfile ─────────────────────────────────────────

    private static function encode(array $link): string {
        return $link['s'].'|'.$link['t'];
    }

    private static function decode(string $row): ?array {
        $parts = explode('|', $row, 2);

        if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') {
            return null;
        }

        return ['s' => $parts[0], 't' => $parts[1]];
    }
}
