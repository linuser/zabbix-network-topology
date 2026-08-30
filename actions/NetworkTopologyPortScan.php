<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Actions;

use CCsrfTokenHelper;
use API;

/**
 * NetworkTopologyPortScan
 *
 * Prueft auf Klick, welche gaengigen Dienste an einem Host antworten. Gedacht
 * fuer den Fall, den das Modul als einziges kennt: ein Geraet steht im Netz,
 * jemand hat gerade einen Host dafuer angelegt, und die Frage ist "was ist das
 * ueberhaupt?".
 *
 * Request (POST):
 *   hostid   Zabbix-Hostid — KEINE Adresse
 *   nt_csrf  CSRF-Token
 *
 * Response: { ok: true, target, results: [{port, service, state}] } oder { error }
 *
 * WARUM DER CLIENT KEINE ADRESSE SCHICKT
 * --------------------------------------
 * Das ist der Kern des Entwurfs. Der Aufrufer nennt eine hostid; die Adresse
 * loest diese Action selbst ueber API::Host()->get() auf — und die API
 * respektiert die Berechtigungen des angemeldeten Benutzers. Duerfte der Client
 * eine IP mitgeben, waere das hier ein Portscanner hinter eurem Login: jeder
 * angemeldete Benutzer koennte beliebige Adressen im Netz abklopfen, inklusive
 * interner Dienste, die er nie sehen darf. So kann er nur pruefen, was er
 * ohnehin schon im Monitoring sieht.
 *
 * Die Portliste ist aus demselben Grund fest und nicht ueberschreibbar.
 *
 * DREI ZUSTAENDE, NICHT ZWEI
 * --------------------------
 * "offen" und "zu" waeren zu wenig. Das Zabbix-Frontend steht haeufig NICHT im
 * ueberwachten Segment — dann laufen alle Verbindungen in die Zeitueberschreitung
 * und "alles zu" waere schlicht falsch. Deshalb:
 *
 *   open      Verbindung kam zustande — der Dienst antwortet
 *   refused   aktiv abgelehnt — Geraet erreichbar, Port zu
 *   timeout   keine Antwort — gefiltert ODER von hier nicht erreichbar
 *
 * Nur wenn mindestens ein "refused" dabei ist, weiss man ueberhaupt, dass das
 * Geraet von hier aus antwortet. Steht ueberall "timeout", sagt das Ergebnis
 * nichts ueber das Geraet — sondern etwas ueber den Netzweg. Das Frontend muss
 * das so anzeigen.
 *
 * Ein Scan erzeugt Eintraege in Firewall- und IDS-Logs. Das ist erwartbar und
 * gehoert in die Doku, nicht wegdiskutiert.
 */
class NetworkTopologyPortScan extends NetworkTopologyController {

    /**
     * Feste Portliste. Bewusst kurz: jeder gefilterte Port kostet die volle
     * Zeitueberschreitung, und die Summe blockiert einen PHP-Request.
     * Ausgewaehlt nach "was sagt mir, WAS das Geraet ist" — nicht nach
     * Vollstaendigkeit.
     */
    private const PORTS = [
        22   => 'SSH',
        23   => 'Telnet',
        80   => 'HTTP',
        // Label traegt das /TCP bewusst: SNMP laeuft real fast immer ueber
        // UDP, und ein TCP-Timeout hier heisst NICHT, dass SNMP am Geraet
        // nicht funktioniert. Stand hier frueher nur 'SNMP', las sich das
        // Ergebnis wie eine Aussage ueber SNMP — der Code wusste es besser
        // (Hinweis unten), der Nutzer sah es nicht. Details siehe unten.
        161  => 'SNMP/TCP',
        443  => 'HTTPS',
        445  => 'SMB',
        515  => 'LPD',
        3389 => 'RDP',
        8006 => 'Proxmox',
        8080 => 'HTTP alt',
        9100 => 'JetDirect',
    ];

    /** Sekunden je Verbindungsversuch. 11 Ports x 0.4 s = 4.4 s Worst Case. */
    private const TIMEOUT = 0.4;

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
            $this->jsonResponse(['error' => 'Method not allowed']);
            return false;
        }
        if (!$this->requireAjax()) {
            return false;
        }

        $ret = $this->validateInput([
            'hostid'  => 'required|id',
            'nt_csrf' => 'string',
        ]);

        if (!$ret) {
            $this->jsonResponse(['error' => 'Invalid input']);
            return false;
        }

        if (!CCsrfTokenHelper::check((string) $this->getInput('nt_csrf', ''),
                'network.topology.portscan')) {
            $this->jsonResponse(['error' => 'CSRF token invalid']);
            return false;
        }

        return true;
    }

    protected function checkPermissions(): bool {
        // Admin-Sache. Deckt sich mit can_edit im Frontend, das den
        // Menue-Eintrag ohnehin nur Admins zeigt.
        return $this->getUserType() >= USER_TYPE_ZABBIX_ADMIN;
    }

    protected function doAction(): void {
        // Straff gedrosselt: ein Scan dauert Sekunden und erzeugt Netzverkehr.
        // 5 in 60 s reicht fuer die Bedienung und stoppt ein Skript.
        if (!$this->throttle('portscan', 5, 60)) {
            return;
        }

        $hostid = (string) $this->getInput('hostid');

        // Adresse ueber die API aufloesen — DIE Rechtepruefung dieser Action.
        // Ein Host, den der Benutzer nicht sehen darf, kommt hier als leeres
        // Ergebnis zurueck, und der Scan findet nicht statt.
        $hosts = API::Host()->get([
            'output'           => ['hostid', 'host', 'name'],
            'hostids'          => [$hostid],
            'selectInterfaces' => ['ip', 'dns', 'useip', 'main', 'type'],
        ]);

        if (!$hosts) {
            $this->jsonResponse(['error' => _('Host not found or not accessible.')]);
            return;
        }

        $target = $this->pickAddress($hosts[0]['interfaces'] ?? []);

        if ($target === '') {
            $this->jsonResponse(['error' => _('Host has no usable interface address.')]);
            return;
        }

        $results = [];
        foreach (self::PORTS as $port => $service) {
            $results[] = [
                'port'    => $port,
                'service' => $service,
                'state'   => $this->probe($target, (int) $port),
            ];
        }

        // Zaehlung mitgeben, damit das Frontend die Aussagekraft beurteilen
        // kann, ohne die Liste selbst auszuwerten: nur Zeitueberschreitungen
        // bedeuten "von hier nicht erreichbar", nicht "alles dicht".
        $states = array_count_values(array_column($results, 'state'));

        $this->jsonResponse([
            'ok'      => true,
            'target'  => $target,
            'results' => $results,
            'summary' => [
                'open'      => $states['open']    ?? 0,
                'refused'   => $states['refused'] ?? 0,
                'timeout'   => $states['timeout'] ?? 0,
                'reachable' => (($states['open'] ?? 0) + ($states['refused'] ?? 0)) > 0,
            ],
        ]);
    }

    /**
     * Bevorzugt die IP des Haupt-Agent-Interfaces, sonst das erste brauchbare.
     * DNS-Namen werden mitgenommen, wenn useip=0 — dann loest PHP auf.
     */
    private function pickAddress(array $interfaces): string {
        $fallback = '';

        foreach ($interfaces as $if) {
            $addr = (int) ($if['useip'] ?? 1) === 1
                ? trim((string) ($if['ip'] ?? ''))
                : trim((string) ($if['dns'] ?? ''));

            if ($addr === '') {
                continue;
            }
            if ((int) ($if['main'] ?? 0) === 1) {
                return $addr;
            }
            if ($fallback === '') {
                $fallback = $addr;
            }
        }

        return $fallback;
    }

    /**
     * Ein TCP-Verbindungsversuch. Unterscheidet aktiv abgelehnt von keiner
     * Antwort — daran haengt, ob das Gesamtergebnis ueberhaupt etwas aussagt.
     *
     * Hinweis zu Port 161 (SNMP): der ist in der Praxis UDP. Ein TCP-Versuch
     * darauf liefert fast immer "timeout" und ist damit ohne Aussage. Er steht
     * trotzdem in der Liste, weil einige Geraete SNMP ueber TCP anbieten — das
     * Frontend muss ihn entsprechend zurueckhaltend darstellen.
     */
    private function probe(string $host, int $port): string {
        $errno  = 0;
        $errstr = '';

        $sock = @stream_socket_client(
            'tcp://' . $host . ':' . $port,
            $errno,
            $errstr,
            self::TIMEOUT,
            STREAM_CLIENT_CONNECT
        );

        if ($sock !== false) {
            fclose($sock);
            return 'open';
        }

        // ECONNREFUSED ist die einzige Antwort, die "Geraet da, Port zu"
        // bedeutet. Alles andere (Zeitueberschreitung, kein Netzweg,
        // unerreichbar) fassen wir zu "timeout" zusammen — feiner zu
        // unterscheiden waere plattformabhaengig und im Ergebnis egal.
        //
        // Die Fehlernummern stehen hier als Literale, NICHT als
        // SOCKET_ECONNREFUSED: diese Konstante kommt aus der sockets-Erweiterung,
        // die fuer stream_socket_client gar nicht noetig ist. Fehlt sie, wuerde
        // PHP 8 bei der undefinierten Konstante abbrechen — der Scan endete mit
        // einem Fatal statt mit einem Ergebnis.
        //   111  Linux      61  BSD/macOS      10061  Windows
        $refused = in_array($errno, [111, 61, 10061], true)
            || stripos($errstr, 'refused') !== false;

        return $refused ? 'refused' : 'timeout';
    }
}
