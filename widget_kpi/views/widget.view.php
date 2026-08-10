<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

/**
 * NT KPI Widget — View
 *
 * Setzt data-* auf den Container; das JS liest Hostgruppen und Darstellung
 * daraus, mit Fallback auf this._fields (in Zabbix 7 ist die View-DOM bei
 * onStart je nach Timing noch nicht gesetzt — siehe die anderen Widgets).
 *
 * @var CView $this
 * @var array $data
 */

(new CWidgetView($data))
    ->addItem(
        (new CDiv())
            ->addClass('nt-kpi-widget-canvas')
            ->setAttribute('data-display',  (string) ($data['display'] ?? 0))
            ->setAttribute('data-groupids', json_encode($data['groupids'] ?? [],
                JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT))
            ->addStyle('width:100%;height:100%;position:relative;min-height:70px;overflow:auto;')
            ->addItem(
                (new CDiv(_('Loading...')))
                    ->addClass('nt-kpi-widget-loading')
                    ->addStyle('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#768d99;font-size:11px;')
            )
    )
    ->show();
