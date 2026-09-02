<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

use API;
use APP;

/**
 * ColorScales
 *
 * The link color scales — which color a connection gets at which traffic
 * (weathermap off, absolute bit/s) or at which utilization (weathermap on,
 * percent of link capacity).
 *
 * Until 5.1.2 the tiers were hard-coded in the frontend (traffic.js). For a
 * campus network with 10G uplinks "red from 10 Mb/s" is nonsense, and anyone
 * who wants weathermap to warn early could not move the 55% orange boundary.
 * Now a Super admin can override both scales; the setting lives in
 * module.config and applies to all users — it is a statement about how this
 * organisation reads its links, not a personal preference.
 *
 * FORMAT
 * ------
 *   ['traffic' => ['bounds' => [10000, 100000, ...], 'colors' => ['#22c55e', ...]],
 *    'util'    => ['bounds' => [1, 10, 25, ...],     'colors' => ['#94a3b8', ...]]]
 *
 *   bounds  strictly ascending exclusive upper bounds (value < bound → tier)
 *   colors  one color MORE than bounds: the last one applies above the last
 *           bound. Six-digit hex, normalised to lowercase.
 *
 * Not set (null) means: the built-in defaults from traffic.js. The defaults
 * deliberately live ONLY in the frontend — the server does not need them, and
 * two copies would drift apart.
 *
 * Read without the API, write through the API — same reasoning as in
 * ManualLinks: CModule::get() throws for non-Super-admins, but the
 * ModuleManager has already loaded the config anyway; the permission check
 * for writing sits in CModule::update().
 */
final class ColorScales {

    /** Module ID from manifest.json — key for the ModuleManager. */
    private const MODULE_ID = 'network_topology';

    /** Key inside module.config. */
    private const CONFIG_KEY = 'color_scales';

    /** Nobody can tell more tiers apart; and it bounds the payload. */
    public const MAX_COLORS = 12;

    /** Utilization is in percent; the frontend caps at 999. */
    public const MAX_UTIL_BOUND = 1000.0;

    /**
     * Shared scales from module.config, or null = defaults. Readable by EVERY
     * user. A broken entry (hand-edited in the DB) falls back to null instead
     * of feeding the frontend nonsense.
     */
    public static function loadShared(): ?array {
        $module = APP::ModuleManager()->getModule(self::MODULE_ID);

        if ($module === null) {
            return null;
        }

        $config = $module->getConfig();
        $raw    = $config[self::CONFIG_KEY] ?? null;

        return is_array($raw) ? self::sanitize($raw) : null;
    }

    /**
     * Replace the scales (null = reset to defaults, i.e. remove the entry).
     * Throws InvalidArgumentException on invalid content — callers who want a
     * friendly message should ask sanitize() first.
     *
     * Note: setConfig() only updates the instance in the current request;
     * persistence goes through the API (where the Super admin check sits).
     */
    public static function saveShared(?array $scales): ?array {
        $clean = null;

        if ($scales !== null) {
            $clean = self::sanitize($scales);
            if ($clean === null) {
                throw new \InvalidArgumentException('invalid color scales');
            }
        }

        $module = APP::ModuleManager()->getModule(self::MODULE_ID);

        if ($module === null) {
            return null;
        }

        $config = $module->getConfig();

        if ($clean === null) {
            unset($config[self::CONFIG_KEY]);
        }
        else {
            $config[self::CONFIG_KEY] = $clean;
        }

        API::Module()->update([[
            'moduleid' => $module->getModuleId(),
            'config'   => $config
        ]]);

        $module->setConfig($config);

        return $clean;
    }

    /**
     * Turns what the client sends into something storable — or null if it is
     * not. No "repair as well as possible": a half-accepted scale would look
     * saved in the UI and would not be.
     *
     * The colors later end up as CSS values in Cytoscape styles and in the
     * legend (inline style="background:…") — hence a strict hex pattern
     * instead of "any string".
     */
    public static function sanitize(array $raw): ?array {
        $out = [];

        foreach (['traffic' => null, 'util' => self::MAX_UTIL_BOUND] as $key => $max_bound) {
            if (!isset($raw[$key]) || !is_array($raw[$key])) {
                return null;
            }

            $scale = self::sanitizeScale($raw[$key], $max_bound);

            if ($scale === null) {
                return null;
            }

            $out[$key] = $scale;
        }

        return $out;
    }

    private static function sanitizeScale(array $scale, ?float $max_bound): ?array {
        $bounds = $scale['bounds'] ?? null;
        $colors = $scale['colors'] ?? null;

        if (!is_array($bounds) || !is_array($colors)) {
            return null;
        }

        $bounds = array_values($bounds);
        $colors = array_values($colors);
        $n      = count($colors);

        if ($n < 2 || $n > self::MAX_COLORS || count($bounds) !== $n - 1) {
            return null;
        }

        $clean_bounds = [];
        $prev         = 0.0;

        foreach ($bounds as $b) {
            if (!is_int($b) && !is_float($b)) {
                return null;
            }

            $v = (float) $b;

            // > 0 (the first bound is compared against 0.0), strictly ascending, finite.
            if (!is_finite($v) || $v <= $prev) {
                return null;
            }

            if ($max_bound !== null && $v > $max_bound) {
                return null;
            }

            $clean_bounds[] = $v;
            $prev           = $v;
        }

        $clean_colors = [];

        foreach ($colors as $c) {
            if (!is_string($c) || !preg_match('/^#[0-9a-fA-F]{6}$/', $c)) {
                return null;
            }

            $clean_colors[] = strtolower($c);
        }

        return ['bounds' => $clean_bounds, 'colors' => $clean_colors];
    }
}
