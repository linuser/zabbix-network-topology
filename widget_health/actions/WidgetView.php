<?php declare(strict_types = 0);

namespace Modules\NetworkTopologyV6HealthWidget\Actions;

use CControllerDashboardWidgetView;
use CControllerResponseData;

/**
 * Health-Widget-Backend: reicht Form-Werte (Hostgroups, Sort, Max-Groups,
 * Legend-Toggle) plus Data-URL des Hauptmoduls an die View weiter.
 * Die eigentliche Score-Berechnung passiert im Frontend (widget.class.js),
 * weil das Hauptmodul ohnehin die Topology-Daten liefert und wir damit
 * eine zweite Backend-Action sparen.
 *
 * Voraussetzung: Hauptmodul "network_topology_v6" ist installiert + enabled.
 */
class WidgetView extends CControllerDashboardWidgetView {

    protected function doAction(): void {
        $this->setResponse(new CControllerResponseData([
            'name'        => $this->getInput('name', $this->widget->getDefaultName()),
            'groupids'    => array_values(array_map('strval', $this->fields_values['groupids'] ?? [])),
            'worst_first' => (bool) ($this->fields_values['worst_first'] ?? true),
            'max_groups'  => (int)  ($this->fields_values['max_groups']  ?? 0),
            'show_legend' => (bool) ($this->fields_values['show_legend'] ?? true),
            'user' => ['debug_mode' => $this->getDebugMode()]
        ]));
    }
}
