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
use Modules\NetworkTopology\Topology\ManualLinks;
use Modules\NetworkTopology\Topology\NodePositions;
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
            'wallboard' => 'in 0,1'  // Vollbild-Modus für Büro-Monitor
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

        $response = new CControllerResponseData([
            'hostgroups'        => $hostgroups,
            'selected_groupids' => $selected_groupids,
            'internet_label'    => trim($this->getInput('internet', '')),
            'wallboard'         => (int) $this->getInput('wallboard', 0) === 1,
            'user'              => [
                'type'           => $this->getUserType(),
                'can_edit'       => $this->getUserType() >= USER_TYPE_ZABBIX_ADMIN,
                'is_super_admin' => $this->getUserType() === USER_TYPE_SUPER_ADMIN
            ],
            // Manuelle Kanten direkt mitliefern statt per zweitem Request: sie
            // werden beim ersten Rendern gebraucht, und ein eigener Roundtrip
            // wuerde die Karte kurz ohne die Links zeigen.
            'manual_links'      => [
                'shared'   => ManualLinks::loadShared(),
                'personal' => ManualLinks::loadPersonal()
            ],
            // Knotenpositionen ebenso direkt mit: sie werden beim ersten
            // Rendern gebraucht, ein zweiter Roundtrip liesse die Karte kurz
            // im Auto-Layout stehen und dann sichtbar umspringen.
            'positions'         => [
                'shared'   => NodePositions::loadShared(),
                'personal' => NodePositions::loadPersonal()
            ]
        ]);

        // Title is set on the response object, not in data array
        $response->setTitle(_('Network Topology'));
        $this->setResponse($response);
    }
}
