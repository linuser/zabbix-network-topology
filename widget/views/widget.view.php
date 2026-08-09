<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

/**
 * Network Topology - Widget View
 * PlaNet Fox | Alexander Fox
 *
 * Setzt data-* Attribute auf den Canvas-Container damit das JS-Modul
 * (widget.class.js) View-Mode + Hostgroups + Data-URL daraus lesen kann
 * — Fallback auf this._fields wenn fields-Format anders ist.
 *
 * @var CView $this
 * @var array $data
 */

(new CWidgetView($data))
    ->addItem(
        (new CDiv())
            ->addClass('nt-widget-canvas')
            ->setAttribute('data-view-mode',  $data['view_mode']  ?? 'tech')
            ->setAttribute('data-data-url',   $data['data_url']   ?? '')
            ->setAttribute('data-show-lldp',  !empty($data['show_lldp'])    ? '1' : '0')
            ->setAttribute('data-hide-offline', !empty($data['hide_offline']) ? '1' : '0')
            ->setAttribute('data-groupids',   json_encode($data['groupids'] ?? [],
                JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT))
            ->addStyle('width:100%;height:100%;position:relative;min-height:80px;')
            ->addItem(
                (new CDiv(_('Loading...')))
                    ->addClass('nt-widget-loading')
                    ->addStyle('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#768d99;font-size:11px;')
            )
    )
    ->show();
