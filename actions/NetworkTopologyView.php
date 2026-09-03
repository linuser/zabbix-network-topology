<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
/**
 * Network Topology — View Action (Zabbix 7.4)
 * Fixes: BUG-7 (imports), BUG-8 (fatal response), BUG-9 (API import)
 */

declare(strict_types = 1);

namespace Modules\NetworkTopology\Actions;

use CController;
use CControllerResponseData;
use CControllerResponseFatal;
// Ohne diesen Import sucht PHP die Klasse im Modul-Namespace und die Seite
// endet in einem Fatal — WEISSE SEITE, kein Hinweis. Funktionen fallen auf den
// globalen Namensraum zurueck (getUserTheme unten tut das), Klassen nicht.
use CWebUser;
use Modules\NetworkTopology\Topology\ManualLinks;
use Modules\NetworkTopology\Topology\NodePositions;
use Modules\NetworkTopology\Topology\SharedLayerFilter;
use Modules\NetworkTopology\Topology\Revision;
use Modules\NetworkTopology\Topology\ColorScales;
use API;

class NetworkTopologyView extends CController {

    protected function init(): void {
        // Read-only page — no CSRF needed
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        $fields = [
            'groupids' => 'array_id',
            'groups'   => 'string',  // Komma-Liste von Gruppennamen für Bookmarks
            'internet' => 'string',  // Optionaler Provider-Label für Internet-Wolke (Hierarchie-Layout)
            'wallboard' => 'in 0,1', // Vollbild-Modus für Büro-Monitor
            // Host+hops mode: one host + its N-hop neighbourhood instead of a
            // group selection. A set hostid wins over groupids in the data
            // action; both can sit in the URL side by side.
            'hostid'   => 'id',
            'hops'     => 'int32'
        ];

        $ret = $this->validateInput($fields);

        // BUG-8 fix: set fatal response on validation failure
        if (!$ret) {
            $this->setResponse(new CControllerResponseFatal());
        }

        return $ret;
    }

    protected function checkPermissions(): bool {
        return $this->getUserType() >= USER_TYPE_ZABBIX_USER;
    }

    protected function doAction(): void {
        // Fetch only hostgroups accessible to the current session user
        $hostgroups = API::HostGroup()->get([
            'output'               => ['groupid', 'name'],
            'with_monitored_hosts' => true,
            'sortfield'            => 'name',
            'preservekeys'         => true
        ]);

        $selected_groupids = $this->getInput('groupids', []);

        // Bookmark-fähige URL: ?groups=Fox,Office wird zu group-IDs aufgelöst,
        // sofern noch keine groupids[]-Parameter angegeben wurden. So bleiben
        // existierende Multiselect-Auswahlen unverändert, aber gespeicherte
        // Links mit Gruppen-Namen funktionieren auch nach Backup-Restore o.Ä.
        // wenn die Group-IDs sich verschoben haben.
        if (!$selected_groupids) {
            // Cap auf max 200 Eintraege gegen O(n^2)-DoS bei pathologisch
            // grossem ?groups=... URL-Parameter (in_array innerhalb foreach).
            $groupNames = array_slice(
                array_filter(array_map('trim', explode(',', $this->getInput('groups', '')))),
                0, 200
            );
            if ($groupNames) {
                foreach ($hostgroups as $g) {
                    if (in_array($g['name'], $groupNames, true)) {
                        $selected_groupids[] = (string) $g['groupid'];
                    }
                }
            }
        }

        // Permission-Filter: URL-Parameter könnten Gruppen-IDs enthalten, auf
        // die der aktuelle User keinen Zugriff (mehr) hat. API::HostGroup
        // respektiert die User-Permissions automatisch — wir nehmen nur die
        // IDs zurück die wirklich zugänglich sind. Sonst sieht das Frontend
        // eine Auswahl, das Backend filtert sie weg, und die Karte bleibt
        // mysteriös leer.
        if ($selected_groupids) {
            $accessible = API::HostGroup()->get([
                'output'   => ['groupid'],
                'groupids' => $selected_groupids,
                'preservekeys' => true
            ]);
            $selected_groupids = array_values(array_intersect(
                $selected_groupids,
                array_map('strval', array_keys($accessible))
            ));
        }

        // (Der Permission-Filter oben deckt „URL enthält fremde/gelöschte
        // Group-IDs" bereits ab — ein zweiter, identischer HostGroup.get-Filter
        // stand hier frueher redundant; entfernt.)

        // Host+hops mode: resolve and permission-check the selected host. The
        // API call is permission-filtered — an inaccessible or deleted hostid
        // silently falls back to group mode instead of leaving the multiselect
        // prefilled with a host the data action will then refuse.
        $selected_hostid    = (string) $this->getInput('hostid', '0');
        $selected_host_name = '';
        $hops               = max(1, min(6, (int) $this->getInput('hops', 1)));
        if ($selected_hostid !== '0' && $selected_hostid !== '') {
            $sel_host = API::Host()->get([
                'output'  => ['hostid', 'name'],
                'hostids' => [$selected_hostid]
            ]);
            if ($sel_host) {
                $selected_host_name = (string) $sel_host[0]['name'];
            } else {
                $selected_hostid = '0';
            }
        }

        // Was der Benutzer ueberhaupt sehen darf. Beide Abfragen sind
        // API-seitig rechtegefiltert; 'output' bleibt minimal, damit die
        // Kosten auch bei mehreren tausend Hosts eine reine ID-Liste sind.
        $visible_hostids = API::Host()->get([
            'output'       => [],
            'preservekeys' => true
        ]);
        $visible_groupids = API::HostGroup()->get([
            'output'       => [],
            'preservekeys' => true
        ]);

        // Revisionen der UNGEFILTERTEN Staende: der Client schickt sie beim
        // Speichern zurueck, und der Server vergleicht dort ebenfalls gegen
        // den ungefilterten Stand. Wuerde hier die gefilterte Fassung
        // gehasht, meldete jeder Nicht-Super-Admin sofort einen Konflikt.
        $links_current     = ManualLinks::loadShared();
        $positions_current = NodePositions::loadShared();

        $response = new CControllerResponseData([
            'hostgroups'        => $hostgroups,
            'selected_groupids' => $selected_groupids,
            // Host+hops mode ('' = group mode)
            'selected_hostid'    => $selected_hostid !== '0' ? $selected_hostid : '',
            'selected_host_name' => $selected_host_name,
            'hops'               => $hops,
            'internet_label'    => trim($this->getInput('internet', '')),
            // Dunkles Theme: NICHT selbst entscheiden, sondern Zabbix fragen.
            //
            // Das Modul hatte einmal einen eigenen Umschalter. Der war nie
            // persistiert — nach jedem Neuladen war die Karte wieder hell —
            // und er ist deshalb entfernt worden. Ein zweiter Schalter neben
            // dem von Zabbix waere derselbe Fehler noch einmal: zwei Quellen
            // fuer dieselbe Frage, die auseinanderlaufen.
            //
            // getUserTheme() loest die Benutzereinstellung UND den Fall
            // THEME_DEFAULT auf (dann gilt die Systemvorgabe).
            //
            // SUBSTRING STATT NAMENSLISTE. Hier stand zuerst
            // in_array($theme, ['dark-theme', 'hc-dark']) — eine Liste der
            // heute ausgelieferten dunklen Themes. Zabbix 8.0 bringt mit
            // ZBXNEXT-10657 ein weiteres ("Dark blue theme"), und eine
            // Namensliste haette es als HELL eingestuft: dunkles Zabbix,
            // helle Karte. Ein Substring faengt jede Benennung ab, die das
            // Wort ueberhaupt enthaelt.
            //
            // Das ist trotzdem nur ein HINWEIS, keine Wahrheit. Wer sein
            // Zabbix mit eigenem Theme-CSS faehrt, kann es "corporate"
            // nennen und trotzdem schwarz sein. Die Entscheidung faellt
            // deshalb im Browser anhand der tatsaechlichen Hintergrundfarbe;
            // dieser Wert greift nur, wenn sich dort nichts messen laesst.
            //
            // function_exists(), weil das Modul auch auf 7.0 LTS laeuft und
            // eine fehlende Hilfsfunktion die Seite sonst mit einem Fatal
            // beenden wuerde statt nur ohne Dunkelmodus zu starten.
            'dark'              => self::themeIstDunkel(),
            'wallboard'         => (int) $this->getInput('wallboard', 0) === 1,
            // Link color scales set by a Super admin (module.config); null =
            // the built-in defaults from traffic.js.
            'color_scales'      => ColorScales::loadShared(),
            'user'              => [
                'type'           => $this->getUserType(),
                'can_edit'       => $this->getUserType() >= USER_TYPE_ZABBIX_ADMIN,
                'is_super_admin' => $this->getUserType() === USER_TYPE_SUPER_ADMIN
            ],
            // Manuelle Kanten direkt mitliefern statt per zweitem Request: sie
            // werden beim ersten Rendern gebraucht, und ein eigener Roundtrip
            // wuerde die Karte kurz ohne die Links zeigen.
            'manual_links'      => [
                // Die geteilte Ebene liegt in module.config und kennt keine
                // Rechte — anders als die Topologie, die aus der API kommt.
                // Ungefiltert enthielt das ausgelieferte JSON Host-IDs,
                // Gruppen-IDs und per LLDP annoncierte Geraetenamen aus
                // Netzteilen ohne Zugriff. Sichtbar wurde davon nichts (das
                // Frontend zeichnet nur Kanten zwischen vorhandenen Knoten),
                // aber das Sicherheitsmodell soll an einer Stelle gelten.
                'shared'   => SharedLayerFilter::links(
                    $links_current, $visible_hostids
                ),
                'personal' => ManualLinks::loadPersonal()
            ],
            // Knotenpositionen ebenso direkt mit: sie werden beim ersten
            // Rendern gebraucht, ein zweiter Roundtrip liesse die Karte kurz
            // im Auto-Layout stehen und dann sichtbar umspringen.
            'positions'         => [
                // Wie oben. Bei den Positionen kommt hinzu, dass der
                // View-Schluessel AUS Gruppen-IDs besteht — eine fremde
                // Gruppe darin verraet ihre Existenz, auch ohne einen
                // einzigen Knoten.
                'shared'   => SharedLayerFilter::positions(
                    $positions_current, $visible_hostids, $visible_groupids
                ),
                'personal' => NodePositions::loadPersonal()
            ],
            // Basis fuer die Konflikterkennung beim Speichern.
            'revisions'         => [
                'links_shared'       => Revision::of($links_current),
                'links_personal'     => Revision::of(ManualLinks::loadPersonal()),
                'positions_shared'   => Revision::of($positions_current),
                'positions_personal' => Revision::of(NodePositions::loadPersonal())
            ]
        ]);

        // Title is set on the response object, not in data array
        $response->setTitle(_('Network Topology'));
        $this->setResponse($response);
    }

    /**
     * Laeuft Zabbix mit einem dunklen Theme? Nur ein HINWEIS fuer den Browser.
     *
     * Die Entscheidung faellt im Frontend an der gemessenen Hintergrundfarbe
     * (seiteIstDunkel in utils.js). Dieser Wert greift nur, wenn sich dort
     * nichts messen laesst — und deshalb darf er unter keinen Umstaenden die
     * Seite kosten.
     *
     * ALS EIGENE METHODE MIT EIGENEM SCHUTZ, und das ist teuer gelernt: die
     * erste Fassung stand als Ausdruck mitten im Antwort-Array und rief
     * CWebUser::$data auf, ohne dass die Klasse importiert war. Im Namespace
     * des Moduls sucht PHP sie unter Modules\NetworkTopology\Actions\CWebUser,
     * findet nichts und beendet die Anfrage — WEISSE SEITE auf einer
     * Produktionsinstanz, und php -l sieht davon nichts, weil die Syntax
     * einwandfrei ist.
     *
     * Ein Dunkelmodus ist Kosmetik. Er darf nicht mehr kaputtmachen als sich
     * selbst, also fangen wir hier alles ab, was schiefgehen kann, und geben
     * im Zweifel false zurueck.
     */
    private static function themeIstDunkel(): bool {
        try {
            if (!function_exists('getUserTheme') || !class_exists('CWebUser')) {
                return false;
            }

            $theme = getUserTheme(CWebUser::$data ?? []);

            // Substring statt Namensliste: Zabbix 8.0 bringt mit
            // ZBXNEXT-10657 ein weiteres dunkles Theme, und eine Liste der
            // heute bekannten haette es als hell eingestuft.
            return stripos((string) $theme, 'dark') !== false;
        }
        catch (\Throwable $e) {
            return false;
        }
    }
}
