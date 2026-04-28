<?php
/**
 * Network Topology — View Action (Zabbix 7.4)
 * Fixes: BUG-7 (imports), BUG-8 (fatal response), BUG-9 (API import)
 */

declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CController;
use CControllerResponseData;
use CControllerResponseFatal;
use API;

class NetworkTopologyView extends CController {

    protected function init(): void {
        // Read-only page — no CSRF needed
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        $fields = [
            'groupids' => 'array_id',
            'groups'   => 'string'   // Komma-Liste von Gruppennamen für Bookmarks
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
            $groupNames = array_filter(array_map('trim', explode(',', $this->getInput('groups', ''))));
            if ($groupNames) {
                foreach ($hostgroups as $g) {
                    if (in_array($g['name'], $groupNames, true)) {
                        $selected_groupids[] = (string) $g['groupid'];
                    }
                }
            }
        }

        $response = new CControllerResponseData([
            'hostgroups'        => $hostgroups,
            'selected_groupids' => $selected_groupids,
            'user'              => [
                'type'     => $this->getUserType(),
                'can_edit' => $this->getUserType() >= USER_TYPE_ZABBIX_ADMIN
            ]
        ]);

        // Title is set on the response object, not in data array
        $response->setTitle(_('Network Topology'));
        $this->setResponse($response);
    }
}
