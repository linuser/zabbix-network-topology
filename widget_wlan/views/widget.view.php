<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

/**
 * NT WLAN Widget — View
 *
 * Setzt data-groupids auf den Container; das JS liest die Hostgroups daraus, mit
 * Fallback auf this._fields (in Zabbix 7.4 kommt data-groupids am Client leer an
 * — siehe die anderen NT-Widgets).
 *
 * @var CView $this
 * @var array $data
 */

(new CWidgetView($data))
    ->addItem(
        (new CDiv())
            ->addClass('nt-wlan-widget-root')
            ->setAttribute('data-groupids', json_encode($data['groupids'] ?? [],
                JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT))
            ->addStyle('width:100%;height:100%;position:relative;min-height:60px;overflow:auto;')
            ->addItem(
                (new CDiv(_('Loading...')))
                    ->addClass('nt-wlan-widget-loading')
                    ->addStyle('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#768d99;font-size:11px;')
            )
    )
    ->show();
