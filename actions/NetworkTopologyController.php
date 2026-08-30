<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Actions;

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
     * Version des JSON-Antwort-Contracts (Review §12). Bumpen, wenn sich die
     * Response-Struktur breaking aendert — externe Integrationen/Widgets koennen
     * daran ihre Kompatibilitaet festmachen. Additive Felder erhoehen sie NICHT.
     */
    public const API_VERSION = 1;

    /**
     * Welche Modul-Features dieser Server unterstuetzt (Review §12). Server-Ebene,
     * NICHT per-User-Permission — ob der aktuelle User z.B. Wartung anlegen darf,
     * steht in NT_CONFIG.can_edit. port_metrics: seit §3 liefern die Kanten
     * Port-Labels an beiden Enden (edge.ports) und Per-Link-Traffic
     * (edge.port_metrics), sofern die Geraete lldpRemPortId/-Desc bzw. per-
     * Interface-Traffic (ifHCInOctets.<ifIndex>) per SNMP liefern.
     */
    protected function capabilities(): array {
        return [
            'lldp'         => true,
            'history'      => true,
            'maintenance'  => true,
            'health'       => true,
            'forecast'     => true,
            'compliance'   => true,
            'port_metrics' => true,
        ];
    }

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
     * Haengt die Truncation-Felder an ein Payload (Review §9). Mehrere Endpunkte
     * kappen zu lange Eingabelisten (MAX_GROUPS/MAX_HOSTS/MAX_ITEMS) — bisher
     * still, sodass der Aufrufer ein unvollstaendiges Ergebnis fuer vollstaendig
     * halten musste. Jetzt sieht er es.
     *
     * BEWUSST nicht mitgecacht: die Felder werden erst NACH dem Cache-Read/Write
     * angehaengt. Sonst bekaeme eine spaetere, nicht gekappte Anfrage mit
     * gleichem Cache-Key (der Key entsteht aus der bereits gekappten Liste!) das
     * truncated-Flag der frueheren Anfrage.
     */
    protected function withTruncation(array $payload, int $requested, int $processed): array {
        $payload['truncated']       = $requested > $processed;
        $payload['requested_count'] = $requested;
        $payload['processed_count'] = $processed;

        return $payload;
    }

    /**
     * Fixed-Window-Rate-Limit pro (User, Bucket) via APCu. Schuetzt die teuren
     * Read-Actions vor Hammering (Abuse / Runaway-Script / gekaperter Account);
     * normale UI-Interaktion liegt weit unter dem Limit. Ohne APCu greift ein
     * schwaecherer Session-Fallback (siehe sessionRateLimitOk) statt wie
     * frueher gar keiner Drosselung.
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
        $uid = (int) (\CWebUser::$data['userid'] ?? 0);

        if (function_exists('apcu_add') && function_exists('apcu_inc')) {
            $key = 'nt_rl_' . $bucket . '_' . $uid;
            apcu_add($key, 0, $window);   // Fensterstart: Key + TTL (nur wenn neu)
            $n = apcu_inc($key);          // atomar hochzaehlen (erbt die TTL)
            return $n === false ? true : ($n <= $max);
        }

        return self::sessionRateLimitOk($bucket, $max, $window);
    }

    /**
     * Fallback ohne APCu: gleitendes Fenster in der Zabbix-Session.
     *
     * Frueher stand hier ein blankes "return true". Fuer die Read-Actions war
     * das vertretbar — sie sind teuer, aber harmlos. Fuer den Portscan nicht:
     * er arbeitet synchron, und elf Ports mal Verbindungs-Timeout blockieren
     * einen PHP-Worker mehrere Sekunden. Ohne APCu war das unbegrenzt oft
     * ausloesbar, und APCu ist laut INSTALL.md ausdruecklich optional. Ein
     * schwaecherer Schutz ist besser als gar keiner.
     *
     * Grenzen, die man kennen muss:
     *   - Zaehlt pro SESSION, nicht pro Benutzer. Wer sich mehrfach anmeldet,
     *     bekommt mehrere Fenster. APCu zaehlt pro User-ID und ist damit
     *     strenger — deshalb bleibt es die empfohlene Variante.
     *   - Zwei gleichzeitige Requests derselben Session koennen sich
     *     ueberholen; im schlimmsten Fall rutscht einer zu viel durch.
     *
     * Beides ist fuer den Zweck egal: es geht um Hammering, nicht um eine
     * exakte Quote.
     */
    private static function sessionRateLimitOk(string $bucket, int $max, int $window): bool {
        if (!class_exists('\CSessionHelper')) {
            return true;
        }

        $key = 'nt_rl_' . $bucket;
        $now = time();

        $hits = \CSessionHelper::has($key) ? \CSessionHelper::get($key) : [];
        if (!is_array($hits)) {
            $hits = [];
        }

        // Alles ausserhalb des Fensters faellt raus.
        $hits = array_values(array_filter($hits, static function ($ts) use ($now, $window) {
            return is_int($ts) && $ts > $now - $window;
        }));

        if (count($hits) >= $max) {
            \CSessionHelper::set($key, $hits);
            return false;
        }

        $hits[] = $now;
        \CSessionHelper::set($key, $hits);
        return true;
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
