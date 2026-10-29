<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

namespace Modules\NetworkTopologyPlanWidget\Includes;

use Zabbix\Widgets\CWidgetForm;
use Zabbix\Widgets\Fields\CWidgetFieldMultiSelectGroup;
use Zabbix\Widgets\Fields\CWidgetFieldCheckBox;

/**
 * Widget-Konfiguration (Dashboard-Editor):
 *   - Host groups (multi-select) — bestimmt die Plan-Ansicht: das Widget zeigt
 *     den Hintergrund + die Platzierung, die im Hauptmodul (Plan-Tab) fuer
 *     DIESELBE Gruppenauswahl hinterlegt wurden (geteilte Ebene).
 *   - Show device labels — Namen neben den Markern einblenden.
 */
class WidgetForm extends CWidgetForm {

    public function addFields(): self {
        return $this
            ->addField(
                new CWidgetFieldMultiSelectGroup('groupids', _('Host groups'))
            )
            ->addField(
                (new CWidgetFieldCheckBox('show_labels', _('Show device labels')))
                    ->setDefault(0)
            );
    }
}
