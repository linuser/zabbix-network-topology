<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

namespace Modules\NetworkTopologyV6TableWidget\Includes;

use Zabbix\Widgets\CWidgetForm;
use Zabbix\Widgets\Fields\CWidgetFieldMultiSelectGroup;
use Zabbix\Widgets\Fields\CWidgetFieldCheckBox;
use Zabbix\Widgets\Fields\CWidgetFieldIntegerBox;

/**
 * Widget-Konfiguration (sichtbar im Dashboard-Editor):
 *   - Host groups (multi-select) — REQUIRED. Leer = leeres Widget (das
 *     Hauptmodul-Backend liefert ohne groupids nichts).
 *   - Hide offline hosts
 *   - Only hosts with problems: blendet Hosts ohne offene Probleme aus
 *   - Max rows (0 = all): Zeilen-Limit fuer kleine Kacheln
 */
class WidgetForm extends CWidgetForm {

    public function addFields(): self {
        return $this
            ->addField(
                new CWidgetFieldMultiSelectGroup('groupids', _('Host groups'))
            )
            ->addField(
                (new CWidgetFieldCheckBox('hide_offline', _('Hide offline hosts')))
                    ->setDefault(0)
            )
            ->addField(
                (new CWidgetFieldCheckBox('problems_only', _('Only hosts with problems')))
                    ->setDefault(0)
            )
            ->addField(
                (new CWidgetFieldIntegerBox('max_rows', _('Max rows (0 = all)'), 0, 1000))
                    ->setDefault(0)
            );
    }
}
