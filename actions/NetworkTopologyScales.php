<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Actions;

use CCsrfTokenHelper;
use Modules\NetworkTopology\Topology\ColorScales;

/**
 * NetworkTopologyScales
 *
 * Stores the link color scales (absolute traffic / weathermap utilization) in
 * module.config — for all users. See ColorScales for the format.
 *
 * Request (POST):
 *   scales  JSON object {traffic:{bounds,colors}, util:{bounds,colors}}
 *   reset   "1" instead of scales: remove the entry, back to the defaults
 *   nt_csrf CSRF token
 *
 * Response: { ok: true, scales: {...}|null } or { error }
 *
 * WRITE action, Super admins only. Protection as in network.topology.links:
 * real CSRF token, POST only, requireAjax(), throttling. The content is
 * validated by ColorScales::sanitize() — colors end up as CSS values in the DOM.
 */
class NetworkTopologyScales extends NetworkTopologyController {

    /** 12 colors x 2 scales is a few hundred characters; this is generous. */
    private const MAX_PAYLOAD = 8192;

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
            $this->jsonResponse(['error' => 'Method not allowed']);
            return false;
        }

        if (!$this->requireAjax()) {
            return false;
        }

        $ret = $this->validateInput([
            'scales'  => 'string',
            'reset'   => 'in 0,1',
            'nt_csrf' => 'string',
        ]);

        if (!$ret) {
            $this->jsonResponse(['error' => 'Invalid input']);
            return false;
        }

        if (!CCsrfTokenHelper::check((string) $this->getInput('nt_csrf', ''),
                'network.topology.scales')) {
            $this->jsonResponse(['error' => 'CSRF token invalid']);
            return false;
        }

        return true;
    }

    protected function checkPermissions(): bool {
        return $this->getUserType() === USER_TYPE_SUPER_ADMIN;
    }

    protected function doAction(): void {
        if (!$this->throttle('scales', 10, 10)) {
            return;
        }

        $reset = (int) $this->getInput('reset', 0) === 1;
        $clean = null;

        if (!$reset) {
            $raw = (string) $this->getInput('scales', '');

            if ($raw === '' || strlen($raw) > self::MAX_PAYLOAD) {
                $this->jsonResponse(['error' => 'Invalid scales payload']);
                return;
            }

            $decoded = json_decode($raw, true);
            $clean   = is_array($decoded) ? ColorScales::sanitize($decoded) : null;

            if ($clean === null) {
                $this->jsonResponse([
                    'error' => _('Thresholds must be positive and strictly ascending; colors six-digit hex.')
                ]);
                return;
            }
        }

        try {
            $saved = ColorScales::saveShared($clean);
        }
        catch (\Throwable $e) {
            // As in the other write actions: only pass clean API messages
            // through, anything else could leak internals.
            error_log('network.topology.scales: ' . $e);
            $this->jsonResponse(['error' => $e instanceof \APIException
                ? $e->getMessage()
                : _('The color scales could not be saved (internal error).')]);
            return;
        }

        $this->jsonResponse(['ok' => true, 'scales' => $saved]);
    }
}
