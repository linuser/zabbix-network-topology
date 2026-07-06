<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

namespace Modules\NetworkTopologyV6Widget\Includes;

use Zabbix\Widgets\CWidgetForm;
use Zabbix\Widgets\Fields\CWidgetFieldMultiSelectGroup;
use Zabbix\Widgets\Fields\CWidgetFieldRadioButtonList;
use Zabbix\Widgets\Fields\CWidgetFieldCheckBox;

/**
 * Widget-Konfiguration (sichtbar im Dashboard-Editor):
 *   - Host groups (multi-select)
 *   - Default view: Technisch / Management
 *   - Show LLDP edges
 *   - Hide offline (NEU): blendet Offline-Hosts komplett aus
 */
class WidgetForm extends CWidgetForm {

    public const VIEW_TECH = 0;
    public const VIEW_MGMT = 1;

    public function addFields(): self {
        return $this
            ->addField(
                new CWidgetFieldMultiSelectGroup('groupids', _('Host groups'))
            )
            ->addField(
                (new CWidgetFieldRadioButtonList('view_mode', _('Default view'), [
                    self::VIEW_TECH => _('Technical'),
                    self::VIEW_MGMT => _('Management'),
                ]))->setDefault(self::VIEW_TECH)
            )
            ->addField(
                (new CWidgetFieldCheckBox('show_lldp', _('Show LLDP edges')))
                    ->setDefault(1)
            )
            ->addField(
                (new CWidgetFieldCheckBox('hide_offline', _('Hide offline hosts')))
                    ->setDefault(0)
            );
    }
}
