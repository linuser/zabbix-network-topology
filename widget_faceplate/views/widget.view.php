<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

/**
 * NT Faceplate Widget — View
 *
 * Setzt data-* auf den Container; das JS liest Host und Darstellung daraus,
 * mit Fallback auf this._fields (in Zabbix 7 ist die View-DOM bei onStart je
 * nach Timing noch nicht gesetzt — siehe die anderen Widgets).
 *
 * @var CView $this
 * @var array $data
 */

(new CWidgetView($data))
    ->addItem(
        (new CDiv())
            ->addClass('nt-faceplate-widget-canvas')
            ->setAttribute('data-hostid',      (string) ($data['hostid'] ?? ''))
            ->setAttribute('data-layout',      (string) ($data['layout'] ?? 'auto'))
            ->setAttribute('data-color',       (string) ($data['color'] ?? 0))
            ->setAttribute('data-numbering',   (string) ($data['numbering'] ?? 0))
            ->setAttribute('data-show-labels', (string) ($data['show_labels'] ?? 1))
            ->addStyle('width:100%;height:100%;position:relative;min-height:70px;overflow:hidden;')
            ->addItem(
                (new CDiv(_('Loading...')))
                    ->addClass('nt-faceplate-widget-loading')
                    ->addStyle('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#768d99;font-size:11px;')
            )
    )
    ->show();
