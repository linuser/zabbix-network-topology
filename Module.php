<?php
/**
 * Network Topology Module — Zabbix 7.4
 * Fixes: BUG-4 (namespace), BUG-5 (APP::Component), BUG-6 (CSS via view)
 */

namespace Modules\NetworkTopology;

use Zabbix\Core\CModule;
use APP;
use CMenuItem;

class Module extends CModule {

    /**
     * Register the menu entry under Monitoring.
     * CSS/JS are loaded from the view file — not here.
     */
    public function init(): void {
        APP::Component()->get('menu.main')
            ->findOrAdd(_('Monitoring'))
            ->getSubmenu()
            ->add(
                (new CMenuItem(_('Network Topology for Zabbix')))
                    ->setAction('network.topology.view')
            );
    }
}
