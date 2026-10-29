<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

/**
 * NT Plan Widget — View
 *
 * Setzt data-* auf den Container; das JS liest Hostgroups + Darstellung daraus,
 * mit Fallback auf this._fields (in Zabbix 7.4 kommt data-groupids am Client
 * leer an — siehe die anderen NT-Widgets).
 *
 * @var CView $this
 * @var array $data
 */

(new CWidgetView($data))
    ->addItem(
        (new CDiv())
            ->addClass('nt-plan-widget-canvas')
            ->setAttribute('data-groupids', json_encode($data['groupids'] ?? [],
                JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT))
            ->setAttribute('data-show-labels', (string) ($data['show_labels'] ?? 0))
            ->addStyle('width:100%;height:100%;position:relative;min-height:80px;overflow:hidden;')
            ->addItem(
                (new CDiv(_('Loading...')))
                    ->addClass('nt-plan-widget-loading')
                    ->addStyle('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#768d99;font-size:11px;')
            )
    )
    ->show();
