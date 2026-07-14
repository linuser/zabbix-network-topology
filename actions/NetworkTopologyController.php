<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CController;
use CControllerResponseData;

/**
 * NetworkTopologyController
 *
 * Gemeinsame Basisklasse fuer die JSON-Actions des Moduls. Zentralisiert das,
 * was vorher in jeder Action einzeln (und leicht unterschiedlich) stand:
 *
 *   - encodeJson():  EIN json_encode mit einheitlichen Flags. Vor allem
 *     JSON_INVALID_UTF8_SUBSTITUTE — Geraete-/Interface-Namen, SNMP- und
 *     LLDP-Werte koennen ungueltige Bytefolgen enthalten; ohne dieses Flag
 *     gibt json_encode dann false zurueck und die Action liefert eine leere/
 *     kaputte Antwort. Mit Substitute wird der Fehlerbyte ersetzt statt alles
 *     zu verwerfen. false (z.B. Rekursion) faengt der Fallback ab.
 *   - jsonResponse(): Standard-Antwort in main_block (layout.json).
 *   - jsonResponseRaw(): Antwort aus bereits fertigem JSON-String — fuer die
 *     Pfade, die die Byte-Laenge vorab fuers Diagnose-Logging brauchen.
 *   - requireAjax(): XHR-Pflicht (X-Requested-With) als CSRF-Last-Schutz fuer
 *     die lesenden Endpunkte.
 *   - throttle()/rateLimitOk(): APCu-Rate-Limit pro (User, Bucket) fuer die
 *     teuren Read-Actions — Schutz vor Hammering (Abuse/Runaway/gekapert).
 *
 * Schreibende Actions bringen ihren eigenen, echten CSRF-Token mit
 * (CCsrfTokenHelper) — requireAjax bleibt dort nur zusaetzliche Huerde.
 */
abstract class NetworkTopologyController extends CController {

    /**
     * Einheitliches JSON-Encoding fuer alle Modul-Antworten.
     */
    protected function encodeJson($data): string {
        $json = json_encode($data, JSON_UNESCAPED_UNICODE
            | JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_SLASHES);

        return $json === false ? '{"error":"JSON encoding failed"}' : $json;
    }

    /**
     * JSON-Antwort in main_block (layout.json). Akzeptiert Array oder Objekt.
     */
    protected function jsonResponse($data): void {
        $this->setResponse(new CControllerResponseData([
            'main_block' => $this->encodeJson($data)
        ]));
    }

    /**
     * Antwort aus einem bereits fertig serialisierten JSON-String (z.B. wenn
     * die Byte-Laenge vorher fuers Diag-Logging gebraucht wird).
     */
    protected function jsonResponseRaw(string $json): void {
        $this->setResponse(new CControllerResponseData([
            'main_block' => $json
        ]));
    }

    /**
     * Read-only-Endpunkte: nur XHR-Aufrufe akzeptieren (CSRF-Last-Schutz;
     * zusaetzlich same-origin-Session-Cookie).
     */
    protected function requireAjax(): bool {
        if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'XMLHttpRequest') {
            $this->jsonResponse(['error' => 'AJAX only']);
            return false;
        }
        return true;
    }

    /**
     * Fixed-Window-Rate-Limit pro (User, Bucket) via APCu. Schuetzt die teuren
     * Read-Actions vor Hammering (Abuse / Runaway-Script / gekaperter Account);
     * normale UI-Interaktion liegt weit unter dem Limit. Ohne APCu wird nicht
     * gedrosselt (fail-open — APCu ist optional, Funktion geht vor Schutz).
     *
     * apcu_add legt den Zaehler nur beim Fensterstart an (setzt dabei die TTL);
     * apcu_inc erhoeht atomar und erbt die TTL des bestehenden Keys. Nach
     * $window Sekunden verfaellt der Key → das Fenster beginnt neu. Bucket +
     * User-ID trennen die Zaehler, damit sich Actions/User nicht gegenseitig
     * drosseln.
     *
     * @return bool true = erlaubt, false = Limit ueberschritten.
     */
    protected function rateLimitOk(string $bucket, int $max = 10, int $window = 5): bool {
        if (!function_exists('apcu_add') || !function_exists('apcu_inc')) {
            return true;
        }
        $uid = (int) (\CWebUser::$data['userid'] ?? 0);
        $key = 'nt_rl_' . $bucket . '_' . $uid;
        apcu_add($key, 0, $window);   // Fensterstart: Key + TTL (nur wenn neu)
        $n = apcu_inc($key);          // atomar hochzaehlen (erbt die TTL)
        return $n === false ? true : ($n <= $max);
    }

    /**
     * Rate-Limit-Guard fuer den Anfang von doAction(): sendet bei Ueberschreitung
     * einen JSON-Fehler und liefert false.
     *
     *   protected function doAction(): void {
     *       if (!$this->throttle('history')) return;
     *       ...
     *   }
     */
    protected function throttle(string $bucket, int $max = 10, int $window = 5): bool {
        if ($this->rateLimitOk($bucket, $max, $window)) {
            return true;
        }
        $this->jsonResponse(['error' => 'Too many requests']);
        return false;
    }
}
