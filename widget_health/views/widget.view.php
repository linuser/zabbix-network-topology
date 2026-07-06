<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

/**
 * NT Health Score Widget - View
 * Setzt data-* Attribute fuer das JS-Modul (widget.class.js).
 *
 * @var CView $this
 * @var array $data
 */

(new CWidgetView($data))
    ->addItem(
        (new CDiv())
            ->addClass('nt-health-widget-canvas')
            ->setAttribute('data-worst-first', !empty($data['worst_first']) ? '1' : '0')
            ->setAttribute('data-max-groups',  (string) ($data['max_groups'] ?? 0))
            ->setAttribute('data-show-legend', !empty($data['show_legend']) ? '1' : '0')
            ->setAttribute('data-groupids',    json_encode($data['groupids'] ?? [],
                JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT))
            ->addStyle('width:100%;height:100%;position:relative;min-height:80px;overflow:auto;')
            ->addItem(
                (new CDiv(_('Loading...')))
                    ->addClass('nt-health-widget-loading')
                    ->addStyle('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#768d99;font-size:11px;')
            )
    )
    ->show();
