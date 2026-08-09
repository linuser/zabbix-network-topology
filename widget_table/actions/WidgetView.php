<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

namespace Modules\NetworkTopologyTableWidget\Actions;

use CControllerDashboardWidgetView;
use CControllerResponseData;

/**
 * Table-Widget-Backend: reicht die Form-Werte (Hostgroups, Filter, Zeilen-
 * Limit) an die View weiter. Die Tabelle wird im Frontend (widget.class.js)
 * aus denselben Daten gerendert, die auch der Haupt-Tab nutzt
 * (network.topology.data) — keine zweite Backend-Action noetig.
 *
 * Voraussetzung: Hauptmodul "network_topology" ist installiert + enabled.
 * Fehlt es, liefert die Data-Action 404 und das Widget zeigt einen Fehler.
 */
class WidgetView extends CControllerDashboardWidgetView {

    protected function doAction(): void {
        $this->setResponse(new CControllerResponseData([
            'name'          => $this->getInput('name', $this->widget->getDefaultName()),
            'groupids'      => array_values(array_map('strval', $this->fields_values['groupids'] ?? [])),
            'hide_offline'  => (bool) ($this->fields_values['hide_offline']  ?? false),
            'problems_only' => (bool) ($this->fields_values['problems_only'] ?? false),
            'max_rows'      => (int)  ($this->fields_values['max_rows']      ?? 0),
            'user' => ['debug_mode' => $this->getDebugMode()]
        ]));
    }
}
