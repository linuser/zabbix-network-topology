<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

namespace Modules\NetworkTopologyWidget\Actions;

use CControllerDashboardWidgetView;
use CControllerResponseData;
use Modules\NetworkTopologyWidget\Includes\WidgetForm;

/**
 * Widget-Backend: liest die Form-Werte (Hostgroups, Default-View, LLDP)
 * und gibt sie an die View weiter. Reicht zusaetzlich die Data-URL durch
 * die auf die Action des Hauptmoduls (network.topology.data) zeigt.
 *
 * Voraussetzung: Hauptmodul "network_topology" ist installiert + enabled.
 * Falls nicht, liefert die Data-Action 404 und das Widget zeigt einen Fehler.
 */
class WidgetView extends CControllerDashboardWidgetView {

    protected function doAction(): void {
        $view_mode_int = (int) ($this->fields_values['view_mode'] ?? WidgetForm::VIEW_TECH);
        $view_mode = $view_mode_int === WidgetForm::VIEW_MGMT ? 'mgmt' : 'tech';

        $this->setResponse(new CControllerResponseData([
            'name'         => $this->getInput('name', $this->widget->getDefaultName()),
            'groupids'     => array_values(array_map('strval', $this->fields_values['groupids'] ?? [])),
            'view_mode'    => $view_mode,
            'show_lldp'    => (bool) ($this->fields_values['show_lldp'] ?? true),
            'hide_offline' => (bool) ($this->fields_values['hide_offline'] ?? false),
            'data_url'     => (new \CUrl('zabbix.php'))
                ->setArgument('action', 'network.topology.data')
                ->getUrl(),
            'user' => ['debug_mode' => $this->getDebugMode()]
        ]));
    }
}
