<?php declare(strict_types = 0);

namespace Modules\NetworkTopologyV6HealthWidget;

use Zabbix\Core\CWidget;

class Widget extends CWidget {

    public function getDefaultName(): string {
        return _('NT Health Score');
    }
}
