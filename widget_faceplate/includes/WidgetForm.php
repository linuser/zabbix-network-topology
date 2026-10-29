<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

namespace Modules\NetworkTopologyFaceplateWidget\Includes;

use Zabbix\Widgets\CWidgetField;
use Zabbix\Widgets\CWidgetForm;
use Zabbix\Widgets\Fields\CWidgetFieldCheckBox;
use Zabbix\Widgets\Fields\CWidgetFieldMultiSelectHost;
use Zabbix\Widgets\Fields\CWidgetFieldRadioButtonList;
use Zabbix\Widgets\Fields\CWidgetFieldSelect;

/**
 * Widget-Konfiguration:
 *   - Host (genau einer) — der Switch, dessen Front gezeichnet wird.
 *   - Layout: Automatisch oder ein fester Zuschnitt. Automatisch waehlt den
 *     kleinsten Zuschnitt, in den die gefundenen Frontports passen. Fest ist
 *     fuer Geraete, deren ifIndex-Reihenfolge nicht Kupfer-dann-SFP ist.
 *   - Farbe: Link-Status oder Link-Speed.
 *   - Nummerierung: ungerade oben (wie auf fast jeder Switch-Front) oder
 *     fortlaufend (obere Reihe 1..12, untere 13..24).
 *   - Admin-down als eigenen Zustand zeigen: abgeschaltete Ports gestrichelt
 *     statt einfach grau — wer die Front als Patch-Plan nutzt, will das sehen.
 */
class WidgetForm extends CWidgetForm {

    /**
     * CWidgetFieldSelect speichert Ganzzahlen — die Zuschnitte stehen deshalb
     * als Index hier und werden in WidgetView auf den Namen abgebildet, den
     * die Action versteht. 0 = automatisch.
     */
    public const LAYOUTS = [1 => '8+2', 2 => '16+2', 3 => '24+2', 4 => '24+4', 5 => '48+4', 6 => '48+6'];

    public const COLOR_STATUS = 0;
    public const COLOR_SPEED  = 1;

    public const NUMBER_ODD_TOP = 0;
    public const NUMBER_ROWS    = 1;

    public function addFields(): self {
        return $this
            ->addField(
                (new CWidgetFieldMultiSelectHost('hostids', _('Host')))
                    ->setFlags(CWidgetField::FLAG_NOT_EMPTY | CWidgetField::FLAG_LABEL_ASTERISK)
                    ->setMultiple(false)
            )
            ->addField(
                (new CWidgetFieldSelect('layout', _('Layout'), [0 => _('Automatic')] + array_map(
                    static function (string $l): string {
                        return str_replace('+', ' + ', $l) . ' SFP';
                    }, self::LAYOUTS)))->setDefault(0)
            )
            ->addField(
                (new CWidgetFieldRadioButtonList('color', _('Colour by'), [
                    self::COLOR_STATUS => _('Link status'),
                    self::COLOR_SPEED  => _('Link speed')
                ]))->setDefault(self::COLOR_STATUS)
            )
            ->addField(
                (new CWidgetFieldRadioButtonList('numbering', _('Numbering'), [
                    self::NUMBER_ODD_TOP => _('Odd on top'),
                    self::NUMBER_ROWS    => _('Row by row')
                ]))->setDefault(self::NUMBER_ODD_TOP)
            )
            ->addField(
                (new CWidgetFieldCheckBox('show_labels', _('Show port numbers')))
                    ->setDefault(1)
            );
    }
}
