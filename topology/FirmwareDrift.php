<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

/**
 * FirmwareDrift — findet Geraete, die bei gleichem Modell eine ANDERE Firmware
 * fahren als die Mehrheit ihrer Geschwister ("7x Aruba 2930F, einer auf anderer
 * Firmware"). Keine gepflegte Regel, sondern eine Abweichung von der Mehrheit —
 * genau die Form, die im Alltag auffaellt.
 *
 * Reine Logik, kein Zabbix/DB/HTTP — damit testbar. Der Compliance-Controller
 * sammelt Modell + Firmware je Host aus dem Inventory und reicht sie hier rein.
 *
 * BEWUSST KONSERVATIV, drei Entscheidungen, jede fuer "nie falsch warnen":
 *   1. Gruppen unter $minGroup (Default 3) liefern KEINEN Befund. Bei zwei
 *      Geraeten mit zwei Versionen gibt es keine Mehrheit — das ist eine
 *      Beobachtung, kein Fund.
 *   2. Verglichen wird auf GLEICHHEIT, nicht auf "neuer als". Firmware-Strings
 *      sind Freitext (WC.16.10.0021); "neuer" truege ohne Versions-Parser nicht.
 *   3. Gibt es keine EINDEUTIGE Mehrheit (zwei Firmwares teilen sich den
 *      Hoechststand), wird die Gruppe uebersprungen. Lieber unterwarnen als eine
 *      willkuerliche "Mehrheit" ausrufen.
 *
 * Modell und Firmware werden exakt (nach trim) verglichen, nicht normalisiert:
 * eine Normalisierung raet und erzeugt Fehltreffer, und ein Fehltreffer sieht
 * aus wie eine Messung.
 */
final class FirmwareDrift {

    public const MIN_GROUP = 3;

    /**
     * @param array<string,array{model:string,fw:string}> $hosts
     *        hid => Modell + Firmware. Eintraege ohne beides ignoriert der Aufrufer.
     * @param int $minGroup Mindestzahl Geraete je Modell fuer einen Befund.
     * @return array<string,array{fw:string,expected:string,model:string,n:int}>
     *         hid => Detail, NUR fuer abweichende Hosts (fw=eigene, expected=Mehrheit,
     *         n=Anzahl auf der Mehrheits-Firmware). Nach hid sortiert.
     */
    public static function detect(array $hosts, int $minGroup = self::MIN_GROUP): array {
        // Je Modell die Firmwares einsammeln (nur vollstaendige Eintraege).
        $byModel = [];
        foreach ($hosts as $hid => $h) {
            $model = trim((string) ($h['model'] ?? ''));
            $fw    = trim((string) ($h['fw'] ?? ''));
            if ($model === '' || $fw === '') {
                continue;
            }
            $byModel[$model][(string) $hid] = $fw;
        }

        $out = [];
        foreach ($byModel as $model => $fwByHid) {
            if (count($fwByHid) < $minGroup) {
                continue;                       // zu wenige -> Beobachtung, kein Fund
            }

            // Firmwares zaehlen.
            $counts = [];
            foreach ($fwByHid as $fw) {
                $counts[$fw] = ($counts[$fw] ?? 0) + 1;
            }
            if (count($counts) < 2) {
                continue;                       // alle gleich -> keine Abweichung
            }

            // Hoechststand + Pruefung auf EINDEUTIGKEIT.
            $maxN = 0;
            foreach ($counts as $c) {
                if ($c > $maxN) $maxN = $c;
            }
            $top = [];
            foreach ($counts as $fw => $c) {
                if ($c === $maxN) $top[] = $fw;
            }
            if (count($top) !== 1) {
                continue;                       // keine eindeutige Mehrheit
            }
            $expected = $top[0];

            foreach ($fwByHid as $hid => $fw) {
                if ($fw === $expected) {
                    continue;
                }
                $out[$hid] = [
                    'fw'       => $fw,
                    'expected' => $expected,
                    'model'    => $model,
                    'n'        => $maxN,
                ];
            }
        }

        ksort($out);
        return $out;
    }
}
