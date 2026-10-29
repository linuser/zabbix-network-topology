<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

namespace Modules\NetworkTopologyWlanWidget\Actions;

use CControllerDashboardWidgetView;
use CControllerResponseData;

/**
 * WLAN-Widget-Backend: reicht die Hostgroups an die View weiter. Das JS holt die
 * Knoten ueber network.topology.data (derselbe Weg wie die anderen NT-Widgets,
 * damit Zabbix' Refresh-Zyklus die Daten erneuert), filtert die Access Points
 * (type wireless) und baut die Tabelle. Die WLAN-Felder (radios, wlan_clients)
 * liegen seit 5.5.81 auf den Knoten — kein eigener Endpoint noetig.
 *
 * Voraussetzung: Hauptmodul "network_topology" ist installiert + enabled.
 */
class WidgetView extends CControllerDashboardWidgetView {

    protected function doAction(): void {
        $this->setResponse(new CControllerResponseData([
            'name'     => $this->getInput('name', $this->widget->getDefaultName()),
            'groupids' => array_values(array_map('strval', $this->fields_values['groupids'] ?? [])),
            'user' => ['debug_mode' => $this->getDebugMode()]
        ]));
    }
}
