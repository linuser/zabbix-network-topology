<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

/**
 * NT Table Widget - View
 * Setzt data-* Attribute auf den Canvas-Container, damit das JS-Modul
 * (widget.class.js) Filter + Hostgroups daraus lesen kann. Fallback auf
 * this._fields, falls die View-DOM bei onStart noch nicht gesetzt ist
 * (Zabbix-7-Lifecycle — siehe Health-/Topology-Widget).
 *
 * @var CView $this
 * @var array $data
 */

(new CWidgetView($data))
    ->addItem(
        (new CDiv())
            ->addClass('nt-table-widget-canvas')
            ->setAttribute('data-hide-offline',  !empty($data['hide_offline'])  ? '1' : '0')
            ->setAttribute('data-problems-only', !empty($data['problems_only']) ? '1' : '0')
            ->setAttribute('data-max-rows',      (string) ($data['max_rows'] ?? 0))
            ->setAttribute('data-groupids',      json_encode($data['groupids'] ?? [],
                JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT))
            ->addStyle('width:100%;height:100%;position:relative;min-height:80px;overflow:auto;')
            ->addItem(
                (new CDiv(_('Loading...')))
                    ->addClass('nt-table-widget-loading')
                    ->addStyle('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#768d99;font-size:11px;')
            )
    )
    ->show();
