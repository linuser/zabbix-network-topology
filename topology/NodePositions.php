<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

use API;
use APP;
use CProfile;

/**
 * NodePositions
 *
 * Wo die Knoten auf der Karte liegen. Bis 5.0 lag das im localStorage: an einen
 * Browser gebunden, weg beim Cache-Leeren — und jeder ordnete sich seine eigene
 * Karte. Wer zwanzig Minuten in eine Anordnung steckte, fing danach von vorn an.
 *
 * Zwei Ebenen, wie bei [[ManualLinks]]:
 *
 *   shared    -> module.config. DIE Karte: die, die alle sehen, die man in ein
 *               Ticket verlinkt, die im Wallboard haengt. Schreiben nur
 *               Super-Admins — das prueft CModule::update() hart, es ist keine
 *               Entscheidung von uns.
 *
 *   personal  -> CProfile des Users. Die eigene Abweichung davon.
 *
 * Beim Lesen gewinnt die persoenliche Ebene PRO KNOTEN. Wer drei Geraete
 * verschiebt, behaelt drei eigene Positionen; alles andere folgt weiter der
 * geteilten Karte. Ohne diese Feinheit waere die geteilte Ebene wertlos: eine
 * einzige persoenliche Speicherung wuerde sie komplett verdecken.
 *
 * AUFBAU
 * ------
 * Positionen haengen an der Gruppenauswahl — eine andere Auswahl ergibt eine
 * andere Karte. Der "View-Key" ist deshalb Teil der Struktur:
 *
 *   { "22_25":     { "10084": {"x":100,"y":-40}, ... },
 *     "22_25_grp": { "grp_Fox": {"x":0,"y":0}, ... } }
 *
 * Das "_grp" unterscheidet die Group-View, die eigene Pseudo-Knoten hat
 * (grp_Fox) und die Host-Positionen sonst ueberschreiben wuerde.
 *
 * WARUM CHUNKS IM CPROFILE
 * ------------------------
 * profiles.value_str ist auf PostgreSQL ein TEXT — auf anderen Backends konnte
 * ich das nicht nachpruefen. Statt darauf zu wetten, wird das JSON in Stuecke
 * zerlegt und ueber CProfile::updateArray in mehrere Zeilen gelegt. Das
 * funktioniert unabhaengig von der Spaltenlaenge; updateArray raeumt
 * ueberzaehlige alte Zeilen selbst ab.
 */
final class NodePositions {

    public const SCOPE_SHARED   = 'shared';
    public const SCOPE_PERSONAL = 'personal';

    /** Modul-ID aus manifest.json — Schluessel fuer den ModuleManager. */
    private const MODULE_ID = 'network_topology';

    /** Schluessel innerhalb von module.config. */
    private const CONFIG_KEY = 'node_positions';

    /** profiles.idx ist varchar(96) — dieser Wert hat 31 Zeichen. */
    private const PROFILE_IDX = 'web.network_topology.positions';

    /**
     * Zeichen je CProfile-Zeile. Bewusst konservativ: die kuerzeste
     * value_str-Definition, die mir in freier Wildbahn begegnet ist, waren
     * 255 Zeichen — mit 200 bleibt Luft, und die Zeilenzahl ist bei realen
     * Kartengroessen trotzdem zweistellig.
     */
    private const CHUNK = 200;

    /** Obergrenzen gegen Fuellangriffe auf module.config bzw. profiles. */
    private const MAX_VIEWS = 50;
    private const MAX_NODES = 5000;

    /** Node-IDs sind Hostids, Ghost-Slugs oder Gruppen-Pseudoknoten. */
    private const ID_PATTERN = '/^[A-Za-z0-9_.:-]{1,128}$/';

    /** View-Key: sortierte Group-IDs mit "_" verbunden, optional "_grp". */
    private const VIEW_PATTERN = '/^[0-9_]{0,200}$/';

    /**
     * Wie viele Knoten der letzte sanitize()-Lauf wegen MAX_NODES verworfen hat.
     * Die Action liest den Wert aus und gibt ihn an den Client zurueck, damit
     * dort eine Meldung erscheinen kann statt lautlosem Teilverlust.
     */
    private static int $truncated = 0;

    /** Verworfene ANSICHTEN des letzten sanitize()-Laufs (MAX_VIEWS). */
    private static int $truncated_views = 0;

    public static function lastTruncatedViews(): int {
        return self::$truncated_views;
    }

    public static function lastTruncated(): int {
        return self::$truncated;
    }

    /** Koordinaten jenseits davon sind kein Bedienfall, sondern Muell. */
    private const COORD_MAX = 1000000;

    // ── Lesen ────────────────────────────────────────────────────────────────

    public static function loadShared(): array {
        $module = APP::ModuleManager()->getModule(self::MODULE_ID);

        if ($module === null) {
            return [];
        }

        $config = $module->getConfig();
        $raw    = $config[self::CONFIG_KEY] ?? [];

        return is_array($raw) ? self::sanitize($raw) : [];
    }

    public static function loadPersonal(): array {
        $rows = CProfile::getArray(self::PROFILE_IDX, []);

        if (!is_array($rows) || !$rows) {
            return [];
        }

        $json = implode('', array_map('strval', $rows));
        $data = json_decode($json, true);

        return is_array($data) ? self::sanitize($data) : [];
    }

    // ── Schreiben ────────────────────────────────────────────────────────────

    /**
     * Geteilte Karte ersetzen. Wirft, wenn der User kein Super-Admin ist —
     * die Pruefung sitzt in CModule::update(), wir verlassen uns darauf statt
     * sie zu duplizieren.
     */
    public static function saveShared(array $views): array {
        $clean  = self::sanitize($views);
        $module = APP::ModuleManager()->getModule(self::MODULE_ID);

        if ($module === null) {
            return [];
        }

        $config                   = $module->getConfig();
        $config[self::CONFIG_KEY] = $clean;

        API::Module()->update([[
            'moduleid' => $module->getModuleId(),
            'config'   => $config
        ]]);

        $module->setConfig($config);

        return $clean;
    }

    /**
     * Persoenliche Abweichungen ersetzen. Ein leeres Array loescht sauber:
     * updateArray entfernt ueberzaehlige alte Zeilen selbst.
     */
    public static function savePersonal(array $views): array {
        $clean = self::sanitize($views);
        $rows  = [];

        if ($clean) {
            // SUBSTITUTE, obwohl hier heute kein ungueltiges UTF-8 ankommen
            // kann: sanitize() laesst als Node-ID nur ID_PATTERN durch, also
            // reines ASCII. Die Sicherheit dieser Zeile haengt damit an einer
            // Zusicherung, die achtzig Zeilen weiter unten steht. Faellt sie
            // irgendwann (ein Label-Feld, ein Notizfeld), gibt json_encode
            // `false` zurueck, str_split() macht daraus ein leeres Array — und
            // CProfile::updateArray LOESCHT dann die gespeicherten Positionen,
            // ohne dass irgendwo ein Fehler auftaucht.
            $json = json_encode($clean, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
            $rows = str_split($json, self::CHUNK);
        }

        CProfile::updateArray(self::PROFILE_IDX, $rows, PROFILE_TYPE_STR);

        return $clean;
    }

    // ── Validierung ──────────────────────────────────────────────────────────

    /**
     * Macht aus dem, was der Client schickt, etwas Speicherbares.
     *
     * Die Node-IDs landen spaeter wieder als Cytoscape-Element-IDs im DOM,
     * deshalb dasselbe enge Zeichenmuster wie bei den manuellen Links. Die
     * Koordinaten werden auf Ganzzahlen gerundet — Nachkommastellen sind bei
     * Pixelpositionen bedeutungslos und blaehen das JSON auf.
     */
    public static function sanitize(array $raw): array {
        $out   = [];
        $views = 0;
        self::$truncated = 0;
        self::$truncated_views = 0;

        foreach ($raw as $view => $nodes) {
            $view = (string) $view;

            // Die Group-View haengt "_grp" an; fuer die Pruefung abtrennen,
            // damit das Muster nur die Group-IDs sehen muss.
            $base = substr($view, -4) === '_grp' ? substr($view, 0, -4) : $view;
            if (!preg_match(self::VIEW_PATTERN, $base)) {
                continue;
            }
            if (!is_array($nodes)) {
                continue;
            }

            $clean = [];
            foreach ($nodes as $id => $p) {
                $id = (string) $id;
                if (!preg_match(self::ID_PATTERN, $id) || !is_array($p)) {
                    continue;
                }
                if (!isset($p['x'], $p['y']) || !is_numeric($p['x']) || !is_numeric($p['y'])) {
                    continue;
                }
                $x = (int) round((float) $p['x']);
                $y = (int) round((float) $p['y']);
                if (abs($x) > self::COORD_MAX || abs($y) > self::COORD_MAX) {
                    continue;
                }

                $clean[$id] = ['x' => $x, 'y' => $y];

                if (count($clean) >= self::MAX_NODES) {
                    // Der Rest faellt weg — aber nicht mehr stillschweigend.
                    // Vorher stand hier nur das break, und wer eine Karte mit
                    // mehr als MAX_NODES Knoten anordnete, bekam einen Teil
                    // gespeichert und keinerlei Hinweis darauf. Beim naechsten
                    // Laden fehlten Positionen, ohne erkennbaren Grund — das
                    // sieht aus wie Datenverlust, nicht wie eine Grenze.
                    self::$truncated += max(0, count($nodes) - count($clean));
                    break;
                }
            }

            if (!$clean) {
                continue;
            }

            $out[$view] = $clean;
            $views++;

            if ($views >= self::MAX_VIEWS) {
                // Eigener Zaehler, NICHT $truncated. Der zaehlt verworfene
                // Knoten; Ansichten sind etwas anderes, und eine Zahl, die
                // beides addiert, ist in beiden Bedeutungen falsch. Bisher
                // wurde das Kappen von Ansichten gar nicht gemeldet: wer mehr
                // als MAX_VIEWS gespeichert hatte, verlor ganze Ansichten und
                // bekam "0 gekappt" — schlimmer als keine Meldung, weil sie
                // das Gegenteil behauptete.
                self::$truncated_views = max(0, count($raw) - $views);
                break;
            }
        }

        return $out;
    }
}
