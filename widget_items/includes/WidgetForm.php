<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

namespace Modules\NetworkTopologyItemsWidget\Includes;

use Zabbix\Widgets\CWidgetForm;
use Zabbix\Widgets\Fields\CWidgetFieldMultiSelectGroup;
use Zabbix\Widgets\Fields\CWidgetFieldTextBox;
use Zabbix\Widgets\Fields\CWidgetFieldCheckBox;
use Zabbix\Widgets\Fields\CWidgetFieldIntegerBox;

/**
 * Widget-Konfiguration:
 *   - Host groups   ohne sie liefert das Backend nichts.
 *   - Item pattern  FESTES Muster, z.B. system.cpu.util oder net.if.in.
 *                   Im Haupt-Tab waehlt man es interaktiv aus dem, was auf den
 *                   Hosts existiert (network.topology.discover_patterns); auf
 *                   einer Kachel gibt es diese Interaktion nicht. Ein freies
 *                   Textfeld statt einer Preset-Liste, weil nur die jeweilige
 *                   Umgebung weiss, welche Keys es dort gibt — die ueblichen
 *                   Presets sind damit als Sonderfall abgedeckt.
 *   - Hide hosts without values
 *   - Max rows (0 = all)
 */
class WidgetForm extends CWidgetForm {

    public function addFields(): self {
        return $this
            ->addField(
                new CWidgetFieldMultiSelectGroup('groupids', _('Host groups'))
            )
            ->addField(
                (new CWidgetFieldTextBox('pattern', _('Item pattern')))
                    ->setDefault('')
            )
            ->addField(
                (new CWidgetFieldCheckBox('hide_empty', _('Hide hosts without values')))
                    ->setDefault(1)
            )
            ->addField(
                (new CWidgetFieldIntegerBox('max_rows', _('Max rows (0 = all)'), 0, 1000))
                    ->setDefault(0)
            );
    }
}
