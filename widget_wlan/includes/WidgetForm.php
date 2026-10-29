<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

namespace Modules\NetworkTopologyWlanWidget\Includes;

use Zabbix\Widgets\CWidgetForm;
use Zabbix\Widgets\Fields\CWidgetFieldMultiSelectGroup;

/**
 * Widget-Konfiguration (Dashboard-Editor):
 *   - Host groups (multi-select) — die Access Points dieser Gruppen werden
 *     aufgelistet. Es gelten dieselben Daten wie auf der Karte (network.topology.
 *     data); die Client-Zahl haengt an den SNMP-wlan.clients-Hosts (IP-Join).
 */
class WidgetForm extends CWidgetForm {

    public function addFields(): self {
        return $this
            ->addField(
                new CWidgetFieldMultiSelectGroup('groupids', _('Host groups'))
            );
    }
}
