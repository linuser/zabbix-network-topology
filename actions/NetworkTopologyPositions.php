<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Actions;

use CCsrfTokenHelper;
use Modules\NetworkTopology\Topology\NodePositions;
use Exception;

/**
 * NetworkTopologyPositions
 *
 * Speichert die Knotenpositionen serverseitig — bis 5.0 lagen sie im
 * localStorage und waren damit an einen Browser gebunden.
 *
 * Request (POST):
 *   positions  JSON, {"<viewKey>": {"<nodeId>": {"x":100,"y":-40}, ...}}
 *   scope      "shared" | "personal"
 *   nt_csrf    CSRF-Token
 *
 * Response: { ok: true, scope, views } oder { error }
 *
 * Zwei Ebenen, siehe NodePositions:
 *   shared    module.config — DIE Karte, nur Super-Admins schreiben
 *   personal  CProfile      — die eigene Abweichung davon
 *
 * WRITE-Action. Schutz wie bei network.topology.links: echter CSRF-Token, nur
 * POST, requireAjax(), Drosselung, und scope=shared verlangt Super-Admin. Die
 * Node-IDs validiert NodePositions::sanitize() gegen ein enges Zeichenmuster —
 * sie landen spaeter wieder als Element-IDs im DOM.
 *
 * Die Drosselung ist hier straffer als bei den Links: Positionen werden beim
 * Ziehen gespeichert, das Frontend entprellt zwar (400 ms), aber ein haengender
 * Client koennte sonst dauerhaft schreiben.
 */
class NetworkTopologyPositions extends NetworkTopologyController {

    /**
     * Laengen-Cap fuer das rohe JSON. MAX_NODES (5000) x ~30 Zeichen je
     * Eintrag, plus Reserve fuer mehrere Views. Verhindert, dass json_decode
     * auf einem Megabyte-Payload arbeitet.
     */
    private const MAX_PAYLOAD = 524288;

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
            'positions' => 'required|string',
            'scope'     => 'required|in shared,personal',
            'nt_csrf'   => 'string',
        ]);

        if (!$ret) {
            $this->jsonResponse(['error' => 'Invalid input']);
            return false;
        }

        if (!CCsrfTokenHelper::check((string) $this->getInput('nt_csrf', ''),
                'network.topology.positions')) {
            $this->jsonResponse(['error' => 'CSRF token invalid']);
            return false;
        }

        return true;
    }

    protected function checkPermissions(): bool {
        // Die eigene Anordnung darf jeder speichern, der die Karte sehen darf.
        // Die schaerfere Huerde fuer scope=shared steht in doAction().
        return $this->getUserType() >= USER_TYPE_ZABBIX_USER;
    }

    protected function doAction(): void {
        if (!$this->throttle('positions', 30, 10)) {
            return;
        }

        $scope = (string) $this->getInput('scope', NodePositions::SCOPE_PERSONAL);
        $raw   = (string) $this->getInput('positions', '{}');

        if (strlen($raw) > self::MAX_PAYLOAD) {
            $this->jsonResponse(['error' => 'Payload too large']);
            return;
        }

        $decoded = json_decode($raw, true);

        if (!is_array($decoded)) {
            $this->jsonResponse(['error' => 'Invalid positions payload']);
            return;
        }

        if ($scope === NodePositions::SCOPE_SHARED
                && $this->getUserType() !== USER_TYPE_SUPER_ADMIN) {
            $this->jsonResponse([
                'error' => _('Only Super admins can change the shared layout.')
            ]);
            return;
        }

        try {
            $saved = $scope === NodePositions::SCOPE_SHARED
                ? NodePositions::saveShared($decoded)
                : NodePositions::savePersonal($decoded);
        }
        catch (Exception $e) {
            // Typisch: API::Module()->update() lehnt ab. Die Meldung stammt aus
            // Zabbix und ist fuer den Nutzer brauchbar.
            $this->jsonResponse(['error' => $e->getMessage()]);
            return;
        }

        // Nur die Anzahl zurueck, nicht die Daten: der Client kennt sie schon,
        // und eine volle Karte waere eine unnoetig grosse Antwort.
        //
        // truncated sagt, wie viele Knoten die Obergrenze verworfen hat. Ist
        // der Wert > 0, wurde nur ein Teil gespeichert — das muss der Nutzer
        // erfahren, sonst fehlen beim naechsten Laden Positionen ohne Grund.
        $this->jsonResponse([
            'ok'        => true,
            'scope'     => $scope,
            'views'     => count($saved),
            'truncated' => NodePositions::lastTruncated()
        ]);
    }
}
