<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

namespace Modules\NetworkTopologyFaceplateWidget\Actions;

use CControllerDashboardWidgetView;
use CControllerResponseData;
use Modules\NetworkTopologyFaceplateWidget\Includes\WidgetForm;

/**
 * Faceplate-Widget-Backend: reicht Host und Darstellung an die View weiter.
 * Die Ports holt das JS ueber network.topology.faceplate aus dem Hauptmodul —
 * derselbe Weg wie bei den anderen NT-Widgets, damit der Refresh-Zyklus von
 * Zabbix die Daten erneuert, ohne dass die View neu gerendert werden muss.
 *
 * Voraussetzung: Hauptmodul "network_topology" ist installiert + enabled.
 */
class WidgetView extends CControllerDashboardWidgetView {

    protected function doAction(): void {
        $hostids = array_values(array_map('strval', $this->fields_values['hostids'] ?? []));

        $this->setResponse(new CControllerResponseData([
            'name'        => $this->getInput('name', $this->widget->getDefaultName()),
            'hostid'      => $hostids[0] ?? '',
            'layout'      => WidgetForm::LAYOUTS[(int) ($this->fields_values['layout'] ?? 0)] ?? 'auto',
            'color'       => (int) ($this->fields_values['color'] ?? 0),
            'numbering'   => (int) ($this->fields_values['numbering'] ?? 0),
            'show_labels' => (int) ($this->fields_values['show_labels'] ?? 1),
            'user' => ['debug_mode' => $this->getDebugMode()]
        ]));
    }
}
