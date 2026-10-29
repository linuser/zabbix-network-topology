<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

use APP;
use CProfile;

/**
 * PlanBackground
 *
 * Welches Hintergrundbild unter dem Plan-Modus liegt — aber NICHT das Bild
 * selbst. Die Bytes liegen in Zabbix' eigenem Bild-Store (Administration →
 * General → Images, Typ Background), genau dem, den die Zabbix-Netzwerkkarten
 * fuer ihre Hintergruende nutzen. Dieses Modul merkt sich je Ansicht nur eine
 * REFERENZ: eine `imageid` (Verweis in jene Tabelle) ODER eine externe `url`.
 *
 * Darum ist diese Klasse winzig gegenueber [[NodePositions]]: keine Byte-Ablage,
 * kein Chunking noetig (eine Referenz ist ein paar Dutzend Zeichen), keine
 * MIME-/Groessen-Logik — die erzwingt Zabbix beim image.create selbst (1 MB,
 * PNG/JPEG/GIF). Die Ebenen-Trennung ist dieselbe wie bei Positionen/Links:
 *
 *   shared    -> module.config (Schluessel plan_background). Nur Super-Admins
 *                schreiben; das prueft CModule::update() hart.
 *   personal  -> CProfile des Users. Die eigene Abweichung davon.
 *
 * Aufbau, je Ebene: { "<viewKey>": {"imageid": 42} } ODER
 *                    { "<viewKey>": {"url": "https://..."} }
 * Der viewKey ist die Gruppenauswahl mit Suffix "_plan" (siehe storage.js).
 */
final class PlanBackground {

    public const SCOPE_SHARED   = 'shared';
    public const SCOPE_PERSONAL = 'personal';

    private const MODULE_ID   = 'network_topology';
    private const CONFIG_KEY   = 'plan_background';
    private const PROFILE_IDX  = 'web.network_topology.plan_bg';

    /** Wie NodePositions: konservative Zeilenlaenge fuers CProfile. */
    private const CHUNK = 200;

    /** Obergrenzen gegen Fuellangriffe. */
    private const MAX_VIEWS = 50;
    private const MAX_URL   = 2048;

    /** View-Key endet auf "_plan"; der Rest wie bei NodePositions. */
    private const VIEW_PATTERN = '/^(?:[0-9_]{0,200}|host[0-9]{1,20}_h[0-9]{1,2})_plan$/';

    // ── Lesen ────────────────────────────────────────────────────────────────

    public static function loadShared(): array {
        $module = APP::ModuleManager()->getModule(self::MODULE_ID);
        if ($module === null) {
            return [];
        }
        $raw = $module->getConfig()[self::CONFIG_KEY] ?? [];
        return is_array($raw) ? self::sanitize($raw) : [];
    }

    public static function loadPersonal(): array {
        $rows = CProfile::getArray(self::PROFILE_IDX, []);
        if (!is_array($rows) || !$rows) {
            return [];
        }
        $data = json_decode(implode('', array_map('strval', $rows)), true);
        return is_array($data) ? self::sanitize($data) : [];
    }

    /**
     * Die wirksame Referenz fuer eine Ansicht: persoenlich gewinnt, sonst
     * geteilt, sonst leeres Array. (Anders als bei Positionen gibt es je
     * Ansicht nur EINE Referenz — kein Pro-Knoten-Merge.)
     */
    public static function resolve(string $view): array {
        $personal = self::loadPersonal();
        if (isset($personal[$view])) {
            return $personal[$view];
        }
        $shared = self::loadShared();
        return $shared[$view] ?? [];
    }

    // ── Schreiben ────────────────────────────────────────────────────────────

    public static function saveShared(array $views): array {
        $clean  = self::sanitize($views);
        $module = APP::ModuleManager()->getModule(self::MODULE_ID);
        if ($module === null) {
            return [];
        }
        SharedConfig::write($module, self::CONFIG_KEY, $clean);
        return $clean;
    }

    public static function savePersonal(array $views): array {
        $clean = self::sanitize($views);
        $rows  = [];
        if ($clean) {
            $json = json_encode($clean, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
            $rows = str_split($json, self::CHUNK);
        }
        CProfile::updateArray(self::PROFILE_IDX, $rows, PROFILE_TYPE_STR);
        return $clean;
    }

    /**
     * Eine einzelne Referenz setzen oder entfernen. Liest die passende Ebene
     * frisch, ersetzt genau diese Ansicht und schreibt zurueck — so bleiben
     * andere Ansichten unberuehrt.
     *
     * @param array $ref  ['imageid' => int] | ['url' => string] | [] zum Loeschen
     */
    public static function setRef(string $scope, string $view, array $ref): array {
        $views = $scope === self::SCOPE_SHARED ? self::loadShared() : self::loadPersonal();
        if ($ref) {
            $views[$view] = $ref;
        }
        else {
            unset($views[$view]);
        }
        return $scope === self::SCOPE_SHARED
            ? self::saveShared($views)
            : self::savePersonal($views);
    }

    // ── Validierung ──────────────────────────────────────────────────────────

    /**
     * Macht aus dem Rohobjekt speicherbare Referenzen. Je Ansicht genau EIN
     * Eintrag mit entweder einer positiven `imageid` ODER einer http(s)-`url`.
     * Ob die imageid wirklich auf ein Background-Bild zeigt, prueft die Action
     * (image.get) — hier wird nur die Form gesichert, damit sanitize() rein und
     * ohne API-Aufruf bleibt.
     */
    public static function sanitize(array $raw): array {
        $out   = [];
        $views = 0;

        foreach ($raw as $view => $ref) {
            $view = (string) $view;
            if (!preg_match(self::VIEW_PATTERN, $view) || !is_array($ref)) {
                continue;
            }

            $clean = null;
            if (isset($ref['imageid']) && is_numeric($ref['imageid']) && (int) $ref['imageid'] > 0) {
                $clean = ['imageid' => (int) $ref['imageid']];
            }
            elseif (isset($ref['url']) && is_string($ref['url'])) {
                $url = trim($ref['url']);
                // NUR HTTPS. Ein Plan-Hintergrund wird beim Anzeigen vom Browser
                // jedes Betrachters geladen; ueber http liefe das im Klartext und
                // gaebe die Adresse ungeschuetzt preis (Security-Review F11).
                // Dazu Laenge UND keine Steuerzeichen/Whitespace oder in
                // Markup/CSS gefaehrliche Zeichen (wie HostTagParser nt:link):
                // heute landet die URL nur als img.src-Property (ungefaehrlich),
                // aber ein kuenftiger Render-Pfad, der sie in HTML/CSS
                // interpoliert, waere sonst injizierbar. Legitime URLs kodieren
                // solche Zeichen ohnehin prozentual.
                if ($url !== '' && strlen($url) <= self::MAX_URL
                        && preg_match('#^https://#i', $url)
                        && !preg_match('/[\x00-\x20\x7F"\'<>()`\\\\]/', $url)) {
                    $clean = ['url' => $url];
                }
            }

            if ($clean === null) {
                continue;
            }

            $out[$view] = $clean;
            if (++$views >= self::MAX_VIEWS) {
                break;
            }
        }

        return $out;
    }
}
