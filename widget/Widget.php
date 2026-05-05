<?php declare(strict_types = 0);

namespace Modules\NetworkTopologyV6Widget;

use Zabbix\Core\CWidget;

class Widget extends CWidget {

    public function getDefaultName(): string {
        return _('Network Topology v6');
    }
}
