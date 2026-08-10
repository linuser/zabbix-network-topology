<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

namespace Modules\NetworkTopologyKpiWidget\Actions;

use CControllerDashboardWidgetView;
use CControllerResponseData;

/**
 * KPI-Widget-Backend: reicht Hostgruppen und Darstellung an die View weiter.
 * Gezaehlt wird im Frontend aus denselben Daten, die auch der Haupt-Tab nutzt
 * (network.topology.data) — keine zweite Backend-Action noetig.
 *
 * Voraussetzung: Hauptmodul "network_topology" ist installiert + enabled.
 */
class WidgetView extends CControllerDashboardWidgetView {

    protected function doAction(): void {
        $this->setResponse(new CControllerResponseData([
            'name'     => $this->getInput('name', $this->widget->getDefaultName()),
            'groupids' => array_values(array_map('strval', $this->fields_values['groupids'] ?? [])),
            'display'  => (int) ($this->fields_values['display'] ?? 0),
            'user' => ['debug_mode' => $this->getDebugMode()]
        ]));
    }
}
