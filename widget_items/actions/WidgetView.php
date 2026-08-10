<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

namespace Modules\NetworkTopologyItemsWidget\Actions;

use CControllerDashboardWidgetView;
use CControllerResponseData;

/**
 * Items-Widget-Backend: reicht Hostgruppen, Muster und Anzeigeoptionen an die
 * View weiter. Geholt und gerendert wird im Frontend ueber die Action des
 * Hauptmoduls (network.topology.items) — keine zweite Backend-Action noetig.
 *
 * Voraussetzung: Hauptmodul "network_topology" ist installiert + enabled.
 */
class WidgetView extends CControllerDashboardWidgetView {

    protected function doAction(): void {
        $this->setResponse(new CControllerResponseData([
            'name'       => $this->getInput('name', $this->widget->getDefaultName()),
            'groupids'   => array_values(array_map('strval', $this->fields_values['groupids'] ?? [])),
            'pattern'    => (string) ($this->fields_values['pattern']    ?? ''),
            'hide_empty' => (bool)   ($this->fields_values['hide_empty'] ?? true),
            'max_rows'   => (int)    ($this->fields_values['max_rows']   ?? 0),
            'user' => ['debug_mode' => $this->getDebugMode()]
        ]));
    }
}
