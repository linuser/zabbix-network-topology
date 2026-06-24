<?php declare(strict_types = 0);

namespace Modules\NetworkTopologyV6HealthWidget\Includes;

use Zabbix\Widgets\CWidgetForm;
use Zabbix\Widgets\Fields\CWidgetFieldMultiSelectGroup;
use Zabbix\Widgets\Fields\CWidgetFieldCheckBox;
use Zabbix\Widgets\Fields\CWidgetFieldIntegerBox;

/**
 * Widget-Konfiguration:
 *   - Host groups (multi-select) — REQUIRED. Leer = leeres Widget. Das
 *     Hauptmodul-Backend liefert ohne groupids ein leeres Result.
 *   - Worst-first: per Default sortiert nach niedrigstem Score
 *   - Max groups: optionales Limit (z.B. nur Top 5 Worst anzeigen)
 *   - Show legend: Legende mit Score-Bereichen am Fuss anzeigen
 */
class WidgetForm extends CWidgetForm {

    public function addFields(): self {
        return $this
            ->addField(
                new CWidgetFieldMultiSelectGroup('groupids', _('Host groups'))
            )
            ->addField(
                (new CWidgetFieldCheckBox('worst_first', _('Sort worst score first')))
                    ->setDefault(1)
            )
            ->addField(
                (new CWidgetFieldIntegerBox('max_groups', _('Max groups (0 = all)'), 0, 200))
                    ->setDefault(0)
            )
            ->addField(
                (new CWidgetFieldCheckBox('show_legend', _('Show legend')))
                    ->setDefault(1)
            );
    }
}
