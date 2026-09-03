<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox

declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * Revisionskennung fuer die gespeicherten Ebenen — gegen verlorene Aenderungen
 * bei gleichzeitigem Bearbeiten.
 *
 * DAS PROBLEM
 * -----------
 * Links und Positionen werden als vollstaendiger Zustand gespeichert, nicht
 * als Delta. Zwei Tabs desselben Benutzers, oder zwei Super-Admins auf der
 * geteilten Ebene:
 *
 *   A laedt, B laedt, A verschiebt einen Knoten und speichert,
 *   B verschiebt einen anderen und speichert — A's Aenderung ist weg.
 *
 * Niemand bekommt einen Fehler. Der Verlust faellt erst beim naechsten Laden
 * auf, und dann sieht er aus wie ein Modulfehler.
 *
 * DER ANSATZ
 * ----------
 * Kein zusaetzliches gespeichertes Feld, sondern eine Kennung, die sich aus
 * dem Inhalt ergibt. Der Client bekommt sie beim Laden, schickt sie beim
 * Speichern mit, und der Server vergleicht sie mit dem, was gerade
 * gespeichert ist. Weichen sie ab, hat jemand dazwischengefunkt und der
 * Schreibvorgang wird abgelehnt statt ueberschrieben.
 *
 * Vorteil gegenueber einem echten Revisions-Zaehler: es gibt nichts zu
 * migrieren und nichts, was auseinanderlaufen kann. Bestehende Daten haben
 * ab dem ersten Laden eine gueltige Kennung.
 *
 * NORMALISIERUNG
 * --------------
 * Die Kennung muss die MENGE beschreiben, nicht ihre Schreibreihenfolge —
 * sonst melden zwei Clients einen Konflikt, die inhaltlich dasselbe
 * gespeichert haben. Deshalb wird vor dem Hashen rekursiv sortiert:
 * Listen nach ihrem serialisierten Inhalt, Maps nach ihren Schluesseln.
 */
class Revision {

    /**
     * @param mixed $data Beliebige Struktur aus Arrays und Skalaren.
     * @return string 16 Hex-Zeichen. Kurz genug fuer eine URL-Zeile, lang
     *                genug, dass eine zufaellige Kollision keine Rolle spielt:
     *                der Wert entscheidet nur ueber "ueberschreiben oder
     *                nachfragen", nicht ueber Zugriff.
     */
    public static function of($data): string {
        // SUBSTITUTE, weil ein Scheitern hier nicht auffaellt, sondern die
        // Konflikterkennung aushebelt: json_encode() gaebe `false` zurueck,
        // hash() sieht dann den leeren String — und ZWEI verschiedene Staende
        // bekaemen dieselbe Revision. matches() sagt "passt", und der zweite
        // Benutzer ueberschreibt den ersten stillschweigend. Genau das soll
        // diese Klasse verhindern.
        $json = json_encode(self::normalize($data), JSON_INVALID_UTF8_SUBSTITUTE);

        return substr(hash('sha256', (string) $json), 0, 16);
    }

    /**
     * Vergleich ohne Zeitseitenkanal — der Wert ist kein Geheimnis, aber
     * hash_equals kostet nichts und macht die Absicht klar.
     *
     * Ein leerer $client bedeutet "der Client kennt keine Revision" und wird
     * durchgelassen: aeltere Clients und der erste Speichervorgang nach einem
     * Update sollen nicht scheitern. Das schwaecht den Schutz auf genau die
     * Faelle, in denen es ohnehin keine Erwartung gab.
     */
    public static function matches(string $client, $current_data): bool {
        if ($client === '') {
            return true;
        }
        return hash_equals(self::of($current_data), $client);
    }

    private static function normalize($v) {
        if (!is_array($v)) {
            return $v;
        }

        $out = [];
        foreach ($v as $k => $item) {
            $out[$k] = self::normalize($item);
        }

        // Liste (fortlaufende Zahlen als Schluessel) → nach Inhalt sortieren,
        // damit die Reihenfolge im Speicher nicht Teil der Identitaet ist.
        if (array_keys($out) === range(0, count($out) - 1)) {
            usort($out, static function ($a, $b): int {
                return strcmp(json_encode($a), json_encode($b));
            });
            return $out;
        }

        ksort($out);
        return $out;
    }
}
