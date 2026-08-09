<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * HostTagParser
 *
 * Vierter Schnitt der Data.php-Aufteilung (Review §6).
 *
 * Liest die nt:*-Tags, mit denen ein Admin einzelne Hosts steuert:
 *
 *   nt:icon=<typ>     Icon erzwingen (ueberstimmt die Template-Heuristik)
 *   nt:show=<key>     zusaetzliche Item-Werte am Knoten einblenden
 *   nt:link=<label>|<url>   eigene Links ins Kontextmenue
 *   nt:parent=<host>  Traeger-Beziehung (VM->Hypervisor) -> hosts-Kante
 *
 * Das ist Verarbeitung von Daten, die ein Mensch frei eintippt — inklusive der
 * Validierung, die verhindert, dass daraus etwas Gefaehrliches wird (nur
 * http/https-URLs, Laengen-Caps, keine Steuerzeichen). Solche Regeln gehoeren
 * an eine Stelle, an der man sie einzeln pruefen kann, statt tief in einem
 * 1200-Zeilen-doAction() zu liegen.
 *
 * Rein: die Hosts (mit ihren Tags). Raus: vier Maps. Kein API-Call, kein
 * Controller-Zustand. Code unveraendert uebernommen — reiner Struktur-Umbau.
 */
final class HostTagParser {

    /**
     * @param array $hosts  hostid => Host-Datensatz (mit 'tags')
     *
     * @return array{icon_override: array, show_keys: array, links: array, parent: array}
     */
    public static function parse(array $hosts): array {
        // ── 2b. TAG-SCAN: nt:icon, nt:show ────────────────────────────────
        // Per Host: 'nt:icon'-Tag (max 1) und 'nt:show'-Tags (n) sammeln.
        // - nt:icon=router  → überschreibt die Auto-Erkennung in deviceType()
        // - nt:show=<key>   → das Item wird in den Tooltip aufgenommen
        // - nt:link=Label|URL  → Custom-Link im Kontextmenü (mehrfach möglich)
        $host_icon_override = [];   // hid => 'router'|'firewall'|...
        $host_show_keys     = [];   // hid => ['system.cpu.util', 'vfs.fs.size[/,pused]', ...]
        $host_links         = [];   // hid => [{label, url}, ...]
        $host_parent        = [];   // hid => 'ParentHostname' (nt:parent-Tag → hosts-Kante)
        // Whitelist für nt:icon: nur bekannte Typen, sonst wird ignoriert
        $allowed_icons = ['firewall', 'router', 'switch', 'wireless',
                          'server', 'storage', 'camera', 'printer',
                          'hypervisor', 'linux', 'windows', 'macos',
                          'webserver', 'container', 'mailserver',
                          'monitoring', 'homeauto', 'ups', 'internet'];

        foreach ($hosts as $hid => $h) {
            foreach ($h['tags'] ?? [] as $tag) {
                $name  = $tag['tag']   ?? '';
                $value = $tag['value'] ?? '';
                if ($name === 'nt:icon' && $value !== '') {
                    $value = strtolower(trim($value));
                    if (in_array($value, $allowed_icons, true)) {
                        $host_icon_override[$hid] = $value;
                    }
                } elseif ($name === 'nt:show' && $value !== '') {
                    // Item-Key-Cap: realistisch nie >200 Zeichen. Schutz gegen
                    // teure API-Filter-Listen wenn jemand pathologisch lange
                    // Tag-Werte setzt (Host-Tag-Edit-Rechte vorausgesetzt).
                    $v = trim($value);
                    if (strlen($v) > 200) continue;
                    if (!isset($host_show_keys[$hid])) $host_show_keys[$hid] = [];
                    // Begrenzung pro Host: 4 (Tooltip-Platz). Weitere Tags ignorieren.
                    if (count($host_show_keys[$hid]) < 4) {
                        $host_show_keys[$hid][] = $v;
                    }
                } elseif ($name === 'nt:link' && $value !== '') {
                    // Format: "Label|URL" — Pipe-getrennt. Wenn kein Pipe vorhanden,
                    // ist der ganze Wert die URL und das Label wird die Domain.
                    // Begrenzung pro Host: 6 (sonst wird das Untermenü unhandlich).
                    if (!isset($host_links[$hid])) $host_links[$hid] = [];
                    if (count($host_links[$hid]) >= 6) continue;

                    // Hard cap am ganzen Tag-Value: 2500 Zeichen reicht für jede
                    // realistische URL+Label, schützt aber vor pathologisch großen
                    // Tags die das JSON-Response aufblähen.
                    if (strlen($value) > 2500) continue;

                    $pipe_pos = strpos($value, '|');
                    if ($pipe_pos !== false) {
                        $label = trim(substr($value, 0, $pipe_pos));
                        $url   = trim(substr($value, $pipe_pos + 1));
                    } else {
                        $url   = trim($value);
                        // Domain als Label extrahieren ("https://nas.example.com:5000" → "nas.example.com")
                        $parsed = parse_url($url);
                        $label  = $parsed['host'] ?? $url;
                    }

                    // Sicherheits-Validierung der URL: nur http/https, keine
                    // javascript:/data:/file: Schemes (würden XSS via Tooltip
                    // ermöglichen wenn ein User die Tags eines anderen sehen
                    // kann). Anchor-Tags werden im Frontend zusätzlich escaped.
                    if ($label === '' || $url === '') continue;
                    if (!preg_match('#^https?://#i', $url)) continue;

                    // Length-Caps + Control-Char-Filter:
                    //   - URL > 2048 Zeichen: realistisch nie sinnvoll, bricht
                    //     den meisten Browsern eh
                    //   - Label > 200 Zeichen: würde das Kontextmenü zerstören
                    //   - Control-Chars (CR/LF/Tab/0x00-0x1F) raus damit kein
                    //     Header-Injection o.ä. möglich ist falls die URL irgendwo
                    //     unsauber landet (z.B. in Logs, in einer redirect-Kette)
                    if (strlen($url) > 2048 || strlen($label) > 200) continue;
                    if (preg_match('/[\x00-\x1F\x7F]/', $url)) continue;
                    if (preg_match('/[\x00-\x1F\x7F]/', $label)) continue;

                    $host_links[$hid][] = ['label' => $label, 'url' => $url];
                } elseif ($name === 'nt:parent' && $value !== '') {
                    // Containment/Hosting: dieser Host laeuft auf $value
                    // (Traeger-Host, z.B. Hypervisor). Erste Angabe gewinnt —
                    // ein Host hat genau einen Traeger. Namensaufloesung unten,
                    // sobald alle sichtbaren Hosts bekannt sind.
                    if (!isset($host_parent[$hid])) {
                        $pv = trim($value);
                        if ($pv !== '' && strlen($pv) <= 128) $host_parent[$hid] = $pv;
                    }
                }
            }
        }


        return [
            'icon_override' => $host_icon_override,
            'show_keys'     => $host_show_keys,
            'links'         => $host_links,
            'parent'        => $host_parent,
        ];
    }
}
