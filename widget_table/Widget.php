<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 0);

namespace Modules\NetworkTopologyTableWidget;

use Zabbix\Core\CWidget;

class Widget extends CWidget {

    public function getDefaultName(): string {
        return _('NT Table');
    }
}
