<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Actions;

use Modules\NetworkTopology\Topology\VersionCheck;

/**
 * NetworkTopologyUpdateCheck
 *
 * "Gibt es ein Update?" — auf Knopfdruck, nie von allein.
 *
 * WARUM MANUELL UND NICHT AUTOMATISCH
 * -----------------------------------
 * Ein Monitoring-Modul, das ungefragt nach Hause telefoniert, ist ein
 * Vertrauensproblem: in vielen Haeusern verbietet die Richtlinie genau das,
 * und wer sein Zabbix abgeschottet betreibt, will keine Abfrage, die ins
 * Leere laeuft. Der Klick IST die Einwilligung — damit entfaellt der
 * Konfigurationsschalter, der TTL-Cache und die Frage, ob eine Hintergrund-
 * abfrage den Seitenaufbau bremst.
 *
 * Und der Fehlerfall wird dadurch nuetzlich statt laestig: "GitHub ist von
 * diesem Server aus nicht erreichbar" ist die Antwort auf eine gestellte
 * Frage. Dieselbe Meldung muesste eine automatische Pruefung verschweigen,
 * sonst haette jede abgeschottete Installation dauerhaft eine Warnung im
 * Bild.
 *
 * WAS RAUSGEHT
 * ------------
 * Ein nackter GET auf die Releases-API. Keine Parameter, keine
 * Versionsangabe, keine Kennung der Installation. GitHub sieht die IP des
 * Zabbix-Servers und den User-Agent — mehr gibt es hier nicht zu senden,
 * und mehr wird auch nie gesendet. Der User-Agent ist Pflicht: ohne ihn
 * antwortet die API mit 403.
 *
 * Request: GET (kein Body).
 * Response: { current, latest, newer, url, published, error? }
 *
 * Zugriff: nur Super-Admin. Nur wer das Modul austauschen kann, soll den
 * Hinweis sehen — und nur der loest damit ausgehenden Verkehr aus.
 */
class NetworkTopologyUpdateCheck extends NetworkTopologyController {

    /** Oeffentliche Release-API des Projekts. Fest verdrahtet, nicht konfigurierbar:
     *  eine vom Client oder aus der Konfiguration gelieferte URL waere eine
     *  Server-Side-Request-Forgery-Stelle mitten in einer Admin-Action. */
    private const API = 'https://api.github.com/repos/linuser/zabbix-network-topology/releases/latest';
    private const RELEASES = 'https://github.com/linuser/zabbix-network-topology/releases';

    /** Sekunden. Kurz genug, dass ein haengendes GitHub niemanden aufhaelt. */
    private const TIMEOUT_CONNECT = 3;
    private const TIMEOUT_TOTAL   = 6;

    /** Mehr als das liest keine Antwort — die Nutzlast ist ein Tag-Name. */
    private const MAX_BYTES = 262144;

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        return $this->requireAjax();
    }

    protected function checkPermissions(): bool {
        return $this->getUserType() === USER_TYPE_SUPER_ADMIN;
    }

    protected function doAction(): void {
        // Eng gedrosselt: ein Mensch drueckt einen Knopf. Das GitHub-Limit
        // liegt bei 60 Abfragen pro Stunde und IP ohne Token; so kommt eine
        // Installation dort nie hin, auch wenn jemand draufhaemmert.
        if (!$this->throttle('update_check', 3, 60)) {
            return;
        }

        $current = self::eigeneVersion();
        $antwort = self::hole();

        if ($antwort === null) {
            $this->jsonResponse([
                'current' => $current,
                'error'   => 'unreachable',
                'url'     => self::RELEASES,
            ]);
            return;
        }

        $daten = json_decode($antwort, true);
        $tag   = is_array($daten) ? (string) ($daten['tag_name'] ?? '') : '';
        $latest = VersionCheck::normalisiere($tag);

        if ($latest === '') {
            // Verstehen wir den Tag nicht, ist das KEIN Update. Lieber
            // "nicht ermittelbar" als eine geratene Zahl.
            $this->jsonResponse([
                'current' => $current,
                'error'   => 'unreadable',
                'url'     => self::RELEASES,
            ]);
            return;
        }

        $this->jsonResponse([
            'current'   => $current,
            'latest'    => $latest,
            'newer'     => VersionCheck::istNeuer($current, $latest),
            'url'       => is_array($daten) && !empty($daten['html_url'])
                ? self::sichereUrl((string) $daten['html_url'])
                : self::RELEASES,
            'published' => is_array($daten) ? substr((string) ($daten['published_at'] ?? ''), 0, 10) : '',
        ]);
    }

    /** Version aus der manifest.json — dieselbe Quelle wie die Fusszeile. */
    private static function eigeneVersion(): string {
        $m = @json_decode((string) @file_get_contents(dirname(__DIR__) . '/manifest.json'), true);
        return is_array($m) && !empty($m['version'])
            ? VersionCheck::normalisiere((string) $m['version'])
            : '';
    }

    /**
     * Eine von GitHub gelieferte URL darf im Panel verlinkt werden — aber nur,
     * wenn sie auch dorthin zeigt. Sonst gewinnt die feste Releases-Seite.
     * Die Antwort ist fremder Text, auch wenn sie von einer vertrauten
     * Adresse kommt.
     */
    private static function sichereUrl(string $url): string {
        $teile = @parse_url($url);
        return (is_array($teile)
            && ($teile['scheme'] ?? '') === 'https'
            && ($teile['host'] ?? '') === 'github.com')
            ? $url
            : self::RELEASES;
    }

    /**
     * Der eigentliche Aufruf. Gibt den Rumpf zurueck oder null.
     *
     * Fehler werden NICHT unterschieden: ob DNS, Firewall, Proxy oder ein
     * HTTP 500 bei GitHub — fuer den Fragenden ist die Antwort dieselbe, und
     * eine Fehlermeldung mit Innenleben hilft ihm nicht weiter. Was er
     * braucht, steht im Panel: "von diesem Server aus nicht erreichbar".
     */
    private static function hole(): ?string {
        $ua = 'network-topology-for-zabbix (+https://zabfox.de)';

        if (function_exists('curl_init')) {
            $ch = curl_init(self::API);
            if ($ch === false) {
                return null;
            }
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CONNECTTIMEOUT => self::TIMEOUT_CONNECT,
                CURLOPT_TIMEOUT        => self::TIMEOUT_TOTAL,
                CURLOPT_USERAGENT      => $ua,
                CURLOPT_HTTPHEADER     => ['Accept: application/vnd.github+json'],
                // Umleitungen folgen wir nicht: die API leitet nicht um, und
                // ein Folgen waere die Stelle, an der aus einer bekannten
                // Adresse eine unbekannte wird.
                CURLOPT_FOLLOWLOCATION => false,
            ]);
            $body = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            curl_close($ch);
            return ($body !== false && $code === 200) ? substr((string) $body, 0, self::MAX_BYTES) : null;
        }

        // Ohne curl: Stream-Kontext. allow_url_fopen kann aus sein, dann
        // scheitert es hier — was dieselbe Antwort ergibt wie eine Firewall.
        $ctx = stream_context_create(['http' => [
            'method'        => 'GET',
            'timeout'       => self::TIMEOUT_TOTAL,
            'follow_location' => 0,
            'ignore_errors' => true,
            'header'        => "User-Agent: {$ua}\r\nAccept: application/vnd.github+json\r\n",
        ]]);
        $body = @file_get_contents(self::API, false, $ctx, 0, self::MAX_BYTES);
        if ($body === false) {
            return null;
        }
        $ok = false;
        foreach ($http_response_header ?? [] as $zeile) {
            if (stripos($zeile, 'HTTP/') === 0) {
                $ok = strpos($zeile, ' 200') !== false;
            }
        }
        return $ok ? $body : null;
    }
}
