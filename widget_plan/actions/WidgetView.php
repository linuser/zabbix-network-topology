<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

namespace Modules\NetworkTopologyPlanWidget\Actions;

use CControllerDashboardWidgetView;
use CControllerResponseData;

/**
 * Plan-Widget-Backend: reicht Hostgroups + Darstellung an die View weiter.
 * Das JS baut daraus den Plan-viewKey (<groupids>_plan) und holt sich alles
 * selbst: Hintergrund-Referenz und geteilte Marker-Positionen ueber
 * network.topology.plan (op=ref / op=positions) und die Knoten-Severity ueber
 * network.topology.data — derselbe Weg wie bei den anderen NT-Widgets, damit
 * Zabbix' Refresh-Zyklus die Daten erneuert.
 *
 * Voraussetzung: Hauptmodul "network_topology" ist installiert + enabled.
 */
class WidgetView extends CControllerDashboardWidgetView {

    protected function doAction(): void {
        $this->setResponse(new CControllerResponseData([
            'name'        => $this->getInput('name', $this->widget->getDefaultName()),
            'groupids'    => array_values(array_map('strval', $this->fields_values['groupids'] ?? [])),
            'show_labels' => (int) ($this->fields_values['show_labels'] ?? 0),
            'user' => ['debug_mode' => $this->getDebugMode()]
        ]));
    }
}
