<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Topology;

use API;

/**
 * SlaResolver
 *
 * Beantwortet eine ANDERE Frage als die Severity: nicht "wie schlimm", sondern
 * "kostet es etwas". Ein Host ist SLA-relevant, wenn eines seiner aktiven
 * Probleme einen in Zabbix hinterlegten **Service** betrifft — und damit auf
 * eine SLA-Zusage einzahlt.
 *
 * Der technische Weg (ROADMAP-Punkt 2) ist bewusst ein JOIN, kein Nachbau der
 * Service-Auswertung: `service.get` mit `selectProblemEvents` liefert je Service
 * die betroffenen EVENTS mit ihrer eventid. Die Karte kennt aus ProblemLoader
 * bereits eventid → [hostid] (eventHostMap). Der Schnitt dieser beiden ist die
 * ganze Logik — keine Tag-Heuristik, kein Rechnen an der SLA selbst.
 *
 * Das SLA-Ziel (slo %) ist optional und nur Beschriftung: `sla.get` liefert
 * SLA-Definitionen mit ihren service_tags; eine SLA gilt fuer einen Service,
 * wenn dessen Tags ALLE service_tags der SLA erfuellen (Zabbix-Semantik).
 * matchSlaTargets() macht genau das, rein und getestet.
 *
 * Aufbau wie ProblemLoader: der API-Kontakt steckt in EINER duennen Methode
 * (load), die interessante Logik in REINEN (resolve, matchSlaTargets) — direkt
 * testbar ohne Zabbix-API. Siehe tests/SlaResolverTest.php.
 *
 * NICHT live abgenommen: auf den erreichbaren Instanzen gibt es null Services
 * und null SLAs. Die reine Logik ist getestet; der API-Teil folgt dem
 * dokumentierten Pfad, ist aber erst an einer Instanz mit echten Services zu
 * verifizieren. Ohne Services liefert service.get [] → count 0 → graue Pille,
 * kein Fehler.
 */
final class SlaResolver {

    /**
     * REIN: (eventid→hosts) ⋈ (eventid→services) → SLA-relevante Hosts.
     *
     * @param array<string, string[]> $event_hosts   eventid => [hostid, ...]
     * @param array<string, array<int, array{name: string, slo: float|null}>> $service_events
     *        eventid => [ {name, slo}, ... ]  (Services, die dieses Event betrifft)
     *
     * @return array{host_sla: array<string, array<int, array{service: string, slo: float|null}>>,
     *               count: int, services: string[]}
     *   host_sla  hostid => [ {service, slo}, ... ]   (nur betroffene Hosts)
     *   count     Anzahl betroffener Hosts
     *   services  alle betroffenen Service-Namen (dedupliziert, sortiert)
     */
    public static function resolve(array $event_hosts, array $service_events): array {
        $host_sla  = [];   // hostid => [serviceName => slo]
        $services  = [];   // serviceName => true
        foreach ($service_events as $eid => $svcs) {
            $hids = $event_hosts[(string) $eid] ?? [];
            if (!$hids) {
                continue;
            }
            foreach ($svcs as $svc) {
                $name = (string) ($svc['name'] ?? '');
                if ($name === '') {
                    continue;
                }
                $slo = $svc['slo'] ?? null;
                $services[$name] = true;
                foreach ($hids as $hid) {
                    $hid = (string) $hid;
                    // Pro Host je Service nur einmal; die staerkste (kleinste
                    // tolerierte Abweichung = groesste) slo gewinnt als Label,
                    // damit ein Host, der zwei Services mit verschiedenen Zielen
                    // beruehrt, das striktere zeigt.
                    if (!isset($host_sla[$hid][$name]) || ($slo !== null
                            && ($host_sla[$hid][$name] === null || $slo > $host_sla[$hid][$name]))) {
                        $host_sla[$hid][$name] = $slo;
                    }
                }
            }
        }

        // Von [serviceName => slo] auf eine stabile Liste [{service, slo}]
        // umsetzen, nach Service-Name sortiert (deterministische Ausgabe).
        $out = [];
        foreach ($host_sla as $hid => $svcmap) {
            ksort($svcmap);
            $list = [];
            foreach ($svcmap as $name => $slo) {
                $list[] = ['service' => $name, 'slo' => $slo];
            }
            $out[$hid] = $list;
        }

        $svc_names = array_keys($services);
        sort($svc_names);

        return [
            'host_sla' => $out,
            'count'    => count($out),
            'services' => $svc_names,
        ];
    }

    /**
     * REIN: SLA-Ziel (slo %) je Service aus den SLA-Definitionen bestimmen.
     *
     * Eine SLA gilt fuer einen Service, wenn der Service ALLE service_tags der
     * SLA traegt (Zabbix verknuepft SLA↔Service ueber Tag-Match, nicht ueber
     * eine feste serviceid). Trifft mehr als eine SLA zu, gewinnt die mit dem
     * hoechsten Ziel — die strengste Zusage ist die, die ein Verantwortlicher
     * zuerst wissen will.
     *
     * @param array<int, array{serviceid: string, name: string, tags?: array}> $services
     *        service.get-Ergebnis (output: serviceid+name, selectTags)
     * @param array<int, array{slo: float|string, service_tags?: array}> $slas
     *        sla.get-Ergebnis (output: slo, selectServiceTags)
     *
     * @return array<string, float>  serviceid => slo (nur Services mit Treffer)
     */
    public static function matchSlaTargets(array $services, array $slas): array {
        $out = [];
        foreach ($services as $svc) {
            $sid = (string) ($svc['serviceid'] ?? '');
            if ($sid === '') {
                continue;
            }
            // Service-Tags als Set "tag\x00value" fuer den Enthaltensein-Test.
            $svc_tagset = [];
            foreach ($svc['tags'] ?? [] as $tg) {
                $svc_tagset[((string) ($tg['tag'] ?? '')) . "\x00" . ((string) ($tg['value'] ?? ''))] = true;
            }
            foreach ($slas as $sla) {
                $need = $sla['service_tags'] ?? [];
                if (!$need) {
                    continue;   // eine SLA ohne Tags gilt fuer nichts Gezieltes
                }
                $all = true;
                foreach ($need as $tg) {
                    $k = ((string) ($tg['tag'] ?? '')) . "\x00" . ((string) ($tg['value'] ?? ''));
                    if (!isset($svc_tagset[$k])) {
                        $all = false;
                        break;
                    }
                }
                if ($all) {
                    $slo = (float) ($sla['slo'] ?? 0);
                    if (!isset($out[$sid]) || $slo > $out[$sid]) {
                        $out[$sid] = $slo;
                    }
                }
            }
        }
        return $out;
    }

    /**
     * Der einzige API-Kontakt. Holt Services (mit ihren betroffenen Events) und
     * SLA-Definitionen, baut die eventid→services-Karte und uebergibt sie an
     * resolve().
     *
     * @param array<string, string[]> $event_hosts  eventid => [hostid, ...]  (aus ProblemLoader)
     * @return array{host_sla: array, count: int, services: string[]}
     */
    public static function load(array $event_hosts): array {
        $empty = ['host_sla' => [], 'count' => 0, 'services' => []];
        if (!$event_hosts) {
            return $empty;   // keine Probleme → nichts zu verknuepfen, kein API-Call
        }

        // Nur Services holen, die ueberhaupt ein aktuelles Problem-Event tragen.
        // selectProblemEvents liefert je Service die offenen Events mit eventid.
        $services = API::Service()->get([
            'output'              => ['serviceid', 'name'],
            'selectProblemEvents' => ['eventid'],
            'selectTags'          => ['tag', 'value'],
            'preservekeys'        => false,
        ]);
        if (!$services) {
            return $empty;   // Instanz ohne Services → graue 0, kein Fehler
        }

        // SLA-Ziele je Service (optional, nur Label). Faellt die API weg oder
        // gibt es keine SLAs, bleibt slo schlicht null.
        $slo_by_sid = [];
        try {
            $slas = API::Sla()->get([
                'output'            => ['slaid', 'slo'],
                'selectServiceTags' => ['tag', 'value'],
                'preservekeys'      => false,
            ]);
            $slo_by_sid = self::matchSlaTargets($services, $slas ?: []);
        }
        catch (\Throwable $e) {
            $slo_by_sid = [];   // SLA-Ziel ist Kuer, nicht Pflicht
        }

        return self::resolve($event_hosts, self::buildServiceEvents($services, $slo_by_sid));
    }

    /**
     * REIN: service.get-Ergebnis → eventid → [ {name, slo}, ... ].
     *
     * Trennt die FORM-Abhaengigkeit (Zabbix liefert die betroffenen Events je
     * Service unter `problem_events`, jedes mit `eventid`) von der reinen
     * Join-Logik in resolve(). Dadurch ist genau diese Annahme ueber die
     * API-Form gegen eine aufgezeichnete Antwort testbar — der Teil, der ohne
     * echte Instanz sonst unbewiesen bliebe. Feldnamen gegen die Zabbix-7.0-API
     * verifiziert (service.get selectProblemEvents → problem_events{eventid}).
     *
     * @param array $services   service.get-Ergebnis (output serviceid+name, selectProblemEvents)
     * @param array<string, float> $slo_by_sid  serviceid => slo (aus matchSlaTargets)
     * @return array<string, array<int, array{name: string, slo: float|null}>>
     */
    public static function buildServiceEvents(array $services, array $slo_by_sid): array {
        $service_events = [];
        foreach ($services as $svc) {
            $sid  = (string) ($svc['serviceid'] ?? '');
            $name = (string) ($svc['name'] ?? '');
            $slo  = $slo_by_sid[$sid] ?? null;
            foreach ($svc['problem_events'] ?? [] as $ev) {
                $eid = (string) ($ev['eventid'] ?? '');
                if ($eid === '') {
                    continue;
                }
                $service_events[$eid][] = ['name' => $name, 'slo' => $slo];
            }
        }
        return $service_events;
    }
}
