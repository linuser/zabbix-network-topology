<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * VersionCheck — Versionsvergleich fuer die manuelle Update-Abfrage.
 *
 * WARUM DAS EINE EIGENE KLASSE IST
 * --------------------------------
 * Der Rest der Abfrage (HTTP zu GitHub) laesst sich nicht testen, ohne ein
 * Netz zu haben. Der Vergleich schon — und er ist der Teil, der schiefgeht:
 * "5.10.0" ist NEUER als "5.9.0", als Zeichenkette aber kleiner. Wer hier
 * strcmp nimmt, meldet ab 5.10.0 nie wieder ein Update, und zwar still.
 *
 * Verglichen wird numerisch je Stelle, fehlende Stellen zaehlen als 0
 * ("5.4" == "5.4.0"). Ein Vorab-Suffix ("5.5.0-rc1") gilt als KLEINER als
 * die fertige Version, wie bei semver — und eine Vorabversion wird nie als
 * Update gemeldet, siehe istNeuer().
 */
class VersionCheck {

    /** Hoechstlaenge einer Version, die wir ueberhaupt ansehen. */
    private const MAX_LEN = 32;

    /**
     * Tag-Namen auf eine Version bringen: "v5.4.0" -> "5.4.0".
     *
     * Kommt etwas voellig anderes (leer, zu lang, Buchstabensalat), gibt es
     * '' zurueck — der Aufrufer meldet dann "nicht ermittelbar" statt zu
     * raten. Eine Versionsangabe, die wir nicht verstehen, ist kein Update.
     */
    public static function normalisiere(string $tag): string {
        $t = trim($tag);
        if ($t === '' || strlen($t) > self::MAX_LEN) {
            return '';
        }
        if ($t[0] === 'v' || $t[0] === 'V') {
            $t = substr($t, 1);
        }
        // Ziffern, Punkte und ein optionales Vorab-Suffix nach - oder +
        return preg_match('/^\d+(\.\d+)*([-+][0-9A-Za-z.\-]+)?$/', $t) === 1 ? $t : '';
    }

    /**
     * Vergleicht zwei Versionen. -1 = $a aelter, 0 = gleich, 1 = $a neuer.
     */
    public static function vergleiche(string $a, string $b): int {
        [$za, $va] = self::zerlege($a);
        [$zb, $vb] = self::zerlege($b);

        $len = max(count($za), count($zb));
        for ($i = 0; $i < $len; $i++) {
            $x = $za[$i] ?? 0;
            $y = $zb[$i] ?? 0;
            if ($x !== $y) {
                return $x < $y ? -1 : 1;
            }
        }

        // Zahlen gleich: eine Vorabversion ist aelter als die fertige.
        if ($va === $vb) {
            return 0;
        }
        if ($va === '') {
            return 1;   // fertig schlaegt Vorab
        }
        if ($vb === '') {
            return -1;
        }
        return strcmp($va, $vb) < 0 ? -1 : 1;
    }

    /**
     * Ist $entfernt ein Update gegenueber $lokal?
     *
     * Vorabversionen zaehlen NICHT als Update: wer 5.4.0 laeuft, soll nicht
     * auf 5.5.0-rc1 gestossen werden. Wer selbst eine Vorabversion faehrt,
     * bekommt die fertige gemeldet, sobald sie da ist.
     */
    public static function istNeuer(string $lokal, string $entfernt): bool {
        if ($lokal === '' || $entfernt === '') {
            return false;
        }
        [, $vorab] = self::zerlege($entfernt);
        if ($vorab !== '') {
            return false;
        }
        return self::vergleiche($entfernt, $lokal) === 1;
    }

    /** "5.4.0-rc1" -> [[5,4,0], "rc1"] */
    private static function zerlege(string $v): array {
        $vorab = '';
        $pos = strcspn($v, '-+');
        if ($pos < strlen($v)) {
            $vorab = substr($v, $pos + 1);
            $v = substr($v, 0, $pos);
        }
        $zahlen = [];
        foreach (explode('.', $v) as $teil) {
            $zahlen[] = ctype_digit($teil) ? (int) $teil : 0;
        }
        return [$zahlen, $vorab];
    }
}
