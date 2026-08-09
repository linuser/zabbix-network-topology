<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Actions;

use CCsrfTokenHelper;
use Modules\NetworkTopology\Topology\ManualLinks;
use Exception;

/**
 * NetworkTopologyLinks
 *
 * Speichert die manuell gezogenen Kanten serverseitig — bis 5.0 lagen sie im
 * localStorage und waren damit an einen Browser gebunden.
 *
 * Request (POST):
 *   links   JSON-Array, [{"s":"10084","t":"ghost_sw01"}, ...]
 *   scope   "shared" | "personal"
 *   nt_csrf CSRF-Token
 *
 * Response: { ok: true, scope, links: [...] } oder { error }
 *
 * Zwei Ebenen, siehe ManualLinks:
 *   shared    module.config — alle sehen sie, nur Super-Admins schreiben
 *   personal  CProfile      — jeder seine eigenen, ueber Browser hinweg
 *
 * WRITE-Action. Schutz (Defense in Depth):
 *   - Echter CSRF-Token, action- + session-gebunden (Feld nt_csrf), analog zur
 *     Maintenance-Action.
 *   - Nur POST.
 *   - requireAjax() (X-Requested-With) + same-origin-Session-Cookie.
 *   - Drosselung, damit ein Runaway-Skript die profiles-Tabelle nicht flutet.
 *   - scope=shared verlangt Super-Admin. Die Pruefung sitzt ohnehin in
 *     CModule::update(); wir fangen sie hier frueher ab, um statt einer
 *     API-Exception eine verstaendliche Meldung zu liefern.
 *   - Die Node-IDs validiert ManualLinks::sanitize() gegen ein enges
 *     Zeichenmuster — sie landen spaeter wieder als Element-IDs im DOM.
 */
class NetworkTopologyLinks extends NetworkTopologyController {

    /**
     * Laengen-Cap fuer das rohe JSON, bevor ueberhaupt dekodiert wird.
     * MAX_LINKS (2000) x ~40 Zeichen je Eintrag, plus Reserve. Verhindert, dass
     * json_decode auf einem Megabyte-Payload arbeitet.
     */
    private const MAX_PAYLOAD = 131072;

    protected function init(): void {
        // Zabbix' automatische Form-Token-Pruefung aus (kein Zabbix-Formular);
        // den Token pruefen wir selbst in checkInput().
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
            'links'   => 'required|string',
            'scope'   => 'required|in shared,personal',
            'nt_csrf' => 'string',
        ]);

        if (!$ret) {
            $this->jsonResponse(['error' => 'Invalid input']);
            return false;
        }

        if (!CCsrfTokenHelper::check((string) $this->getInput('nt_csrf', ''),
                'network.topology.links')) {
            $this->jsonResponse(['error' => 'CSRF token invalid']);
            return false;
        }

        return true;
    }

    protected function checkPermissions(): bool {
        // Persoenliche Links darf jeder pflegen, der die Karte sehen darf.
        // Die schaerfere Huerde fuer scope=shared steht in doAction().
        return $this->getUserType() >= USER_TYPE_ZABBIX_USER;
    }

    protected function doAction(): void {
        if (!$this->throttle('links', 20, 10)) {
            return;
        }

        $scope = (string) $this->getInput('scope', ManualLinks::SCOPE_PERSONAL);
        $raw   = (string) $this->getInput('links', '[]');

        if (strlen($raw) > self::MAX_PAYLOAD) {
            $this->jsonResponse(['error' => 'Payload too large']);
            return;
        }

        $decoded = json_decode($raw, true);

        if (!is_array($decoded)) {
            $this->jsonResponse(['error' => 'Invalid links payload']);
            return;
        }

        if ($scope === ManualLinks::SCOPE_SHARED
                && $this->getUserType() !== USER_TYPE_SUPER_ADMIN) {
            $this->jsonResponse([
                'error' => _('Only Super admins can change shared links.')
            ]);
            return;
        }

        try {
            $links = $scope === ManualLinks::SCOPE_SHARED
                ? ManualLinks::saveShared($decoded)
                : ManualLinks::savePersonal($decoded);
        }
        catch (Exception $e) {
            // Typisch: API::Module()->update() lehnt ab. Die Meldung stammt aus
            // Zabbix und ist fuer den Nutzer brauchbar.
            $this->jsonResponse(['error' => $e->getMessage()]);
            return;
        }

        $this->jsonResponse([
            'ok'    => true,
            'scope' => $scope,
            'links' => $links
        ]);
    }
}
