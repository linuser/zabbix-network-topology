<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

namespace Modules\NetworkTopologyKpiWidget\Includes;

use Zabbix\Widgets\CWidgetForm;
use Zabbix\Widgets\Fields\CWidgetFieldMultiSelectGroup;
use Zabbix\Widgets\Fields\CWidgetFieldRadioButtonList;

/**
 * Widget-Konfiguration:
 *   - Host groups (multi-select) — ohne sie liefert das Backend nichts.
 *   - Display: Ring oder Kacheln.
 *
 * Warum zwei Darstellungen statt einer: der Ring beantwortet "ist alles
 * gruen?" ohne dass man Zahlen liest, braucht aber Breite fuer die Legende
 * daneben. Die Kacheln tragen schmale, hohe Zuschnitte besser. Welche passt,
 * haengt am Platz im Dashboard — das kann nur der wissen, der es baut.
 */
class WidgetForm extends CWidgetForm {

    public const DISPLAY_RING  = 0;
    public const DISPLAY_TILES = 1;

    public function addFields(): self {
        return $this
            ->addField(
                new CWidgetFieldMultiSelectGroup('groupids', _('Host groups'))
            )
            ->addField(
                (new CWidgetFieldRadioButtonList('display', _('Display'), [
                    self::DISPLAY_RING  => _('Ring'),
                    self::DISPLAY_TILES => _('Tiles')
                ]))->setDefault(self::DISPLAY_RING)
            );
    }
}
