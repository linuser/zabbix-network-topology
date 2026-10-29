<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 PlaNet Fox / Alexander Fox
declare(strict_types = 1);

namespace Modules\NetworkTopology\Actions;

use API;
use CCsrfTokenHelper;
use Modules\NetworkTopology\Topology\NodePositions;
use Modules\NetworkTopology\Topology\PlanBackground;

/**
 * NetworkTopologyPlan
 *
 * Der Plan-Modus legt ein Hintergrundbild (Luftbild/Grundriss) unter die Karte
 * und platziert Marker darauf. Das BILD liegt in Zabbix' eigenem Bild-Store
 * (Administration → General → Images, Typ Background) — dieses Modul speichert je
 * Ansicht nur eine Referenz (imageid ODER url, siehe [[PlanBackground]]). Die
 * Marker-POSITIONEN laufen ueber den bestehenden Positions-Endpunkt (eigener
 * "_plan"-viewKey), nicht hier.
 *
 * Eine Action, mehrere Operationen ueber `op`:
 *   LESEN (XHR-Pflicht, kein CSRF):
 *     list      — Background-Bilder (image.get imagetype=2): [{imageid, name}]
 *     ref       — wirksame Referenz der Ansicht: {kind:image|url|none, ...}
 *     positions — GETEILTE Marker-Positionen der Ansicht (fuers Dashboard-Widget)
 *   (Die Bild-BYTES liefert Zabbix' eigenes imgstore.php?iconid=<id> aus — das
 *    Frontend verweist direkt dorthin, kein base64-Umweg ueber dieses Modul.)
 *   SCHREIBEN (POST + CSRF + Drosselung; scope=shared verlangt Super-Admin):
 *     set    — Referenz speichern (imageid gegen image.get geschnitten | url)
 *     clear  — Referenz der Ansicht entfernen
 *     upload — neues Background-Bild anlegen (image.create, NUR Super-Admin;
 *              Zabbix erzwingt 1 MB + Format selbst)
 */
class NetworkTopologyPlan extends NetworkTopologyController {

    /** base64 eines 1-MB-Bildes ist ~1.37 MB; etwas Reserve drauf. */
    private const MAX_PAYLOAD = 1572864;

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        $ret = $this->validateInput([
            'op'      => 'required|in list,ref,positions,set,clear,upload',
            'view'    => 'string',
            'imageid' => 'string',
            'scope'   => 'in shared,personal',
            'kind'    => 'in image,url',
            'url'     => 'string',
            'name'    => 'string',
            'data'    => 'string',
            'nt_csrf' => 'string',
        ]);

        if (!$ret) {
            $this->jsonResponse(['error' => 'Invalid input']);
            return false;
        }

        $op     = (string) $this->getInput('op', '');
        $writes = ['set', 'clear', 'upload'];

        if (in_array($op, $writes, true)) {
            if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
                $this->jsonResponse(['error' => 'Method not allowed']);
                return false;
            }
            if (!CCsrfTokenHelper::check((string) $this->getInput('nt_csrf', ''),
                    'network.topology.plan')) {
                $this->jsonResponse(['error' => 'CSRF token invalid']);
                return false;
            }
        }
        elseif (!$this->requireAjax()) {
            return false;
        }

        return true;
    }

    protected function checkPermissions(): bool {
        // Sehen/Platzieren darf jeder, der die Karte sehen darf. Die schaerferen
        // Huerden (shared, upload) stehen in doAction().
        return $this->getUserType() >= USER_TYPE_ZABBIX_USER;
    }

    protected function doAction(): void {
        if (!$this->throttle('plan', 40, 10)) {
            return;
        }

        switch ((string) $this->getInput('op', '')) {
            case 'list':      $this->opList();      return;
            case 'ref':       $this->opRef();       return;
            case 'positions': $this->opPositions(); return;
            case 'set':       $this->opSet();       return;
            case 'clear':  $this->opClear();  return;
            case 'upload': $this->opUpload(); return;
        }

        $this->jsonResponse(['error' => 'Unknown op']);
    }

    /** Alle Background-Bilder (imagetype 2) — nur id + Name fuer die Auswahl. */
    private function opList(): void {
        $imgs = API::Image()->get([
            'output'    => ['imageid', 'name'],
            'filter'    => ['imagetype' => 2],
            'sortfield' => 'name',
        ]);

        $out = [];
        foreach ($imgs as $i) {
            $out[] = ['imageid' => (string) $i['imageid'], 'name' => (string) $i['name']];
        }
        $this->jsonResponse(['images' => $out]);
    }

    /** Die wirksame Referenz der angefragten Ansicht. */
    private function opRef(): void {
        $view = (string) $this->getInput('view', '');
        // Rechte-Gate wie bei op=positions/SharedLayerFilter: wer die Gruppen der
        // Ansicht nicht sehen darf, bekommt auch die (geteilte) Referenz nicht.
        // Ohne das koennte jeder angemeldete Nutzer viewKeys durchprobieren und
        // die hinterlegte imageid/URL fremder Gruppen erfahren (Info-Leak, z.B.
        // eine interne URL, die ein Super-Admin gesetzt hat).
        if (!$this->viewVisible($view)) {
            $this->jsonResponse(['kind' => 'none']);
            return;
        }
        $ref = PlanBackground::resolve($view);

        if (isset($ref['imageid'])) {
            $this->jsonResponse(['kind' => 'image', 'imageid' => (string) $ref['imageid']]);
        }
        elseif (isset($ref['url'])) {
            $this->jsonResponse(['kind' => 'url', 'url' => (string) $ref['url']]);
        }
        else {
            $this->jsonResponse(['kind' => 'none']);
        }
    }

    /**
     * Geteilte Plan-Positionen einer Ansicht — fuer das read-only Dashboard-
     * Widget (widget_plan), das `NT_CONFIG` nicht hat und die Positionen deshalb
     * nicht wie die Hauptseite inline bekommt. Nur die GETEILTE Ebene: ein
     * Dashboard zeigt die gemeinsame Karte, nicht die persoenliche Abweichung
     * eines Einzelnen. Die Knoten-IDs sind Hostids/Ghost-Slugs, die Werte Pixel —
     * das Widget zeichnet ohnehin nur Knoten, die es ueber network.topology.data
     * (rechtegeprueft) sehen darf.
     */
    private function opPositions(): void {
        $view  = (string) $this->getInput('view', '');
        // Gruppen-Gate wie bei op=ref (Defense-in-Depth; der Per-Host-Filter
        // unten schuetzt die Werte schon, aber die Ansicht gar nicht erst
        // bedienen ist sauberer und konsistent mit SharedLayerFilter).
        if (!$this->viewVisible($view)) {
            $this->jsonResponse(['positions' => new \stdClass()]);
            return;
        }
        $all   = NodePositions::loadShared();
        $nodes = $all[$view] ?? [];

        if ($nodes) {
            // Nur Knoten, die der Nutzer sehen darf — wie SharedLayerFilter auf
            // der Hauptseite. API::Host()->get respektiert die Rechte; Ghost-Slugs
            // (ghost_…, aus LLDP/CDP-Nachbarn) sind abgeleitet und an keine
            // Host-Berechtigung gebunden, bleiben also wie dort erlaubt. Ohne
            // diesen Filter gaebe der Endpunkt die ganze Hostid->Pixel-Karte an
            // JEDEN angemeldeten Nutzer heraus (Info-Leak ueber fremde Hosts).
            $visible = API::Host()->get(['output' => ['hostid'], 'preservekeys' => true]);
            $out = [];
            foreach ($nodes as $id => $p) {
                $sid = (string) $id;
                if (isset($visible[$sid]) || strncmp($sid, 'ghost_', 6) === 0) {
                    $out[$id] = $p;
                }
            }
            $nodes = $out;
        }

        $this->jsonResponse(['positions' => $nodes ?: new \stdClass()]);
    }

    /** Referenz speichern: imageid (gegen image.get geschnitten) oder url. */
    private function opSet(): void {
        $scope = $this->resolveScope();
        if ($scope === null) {
            return;
        }

        $view = (string) $this->getInput('view', '');
        $kind = (string) $this->getInput('kind', '');
        $ref  = [];

        if ($kind === 'image') {
            $id = (string) $this->getInput('imageid', '');
            if ($id === '' || !ctype_digit($id)) {
                $this->jsonResponse(['error' => 'Invalid imageid']);
                return;
            }
            // Existenz UND Typ gegenschneiden — eine vom Client gelieferte id
            // nie blind speichern (sie landet spaeter in einer image.get-URL).
            $exists = API::Image()->get([
                'output'   => ['imageid'],
                'imageids' => [$id],
                'filter'   => ['imagetype' => 2],
            ]);
            if (!$exists) {
                $this->jsonResponse(['error' => _('Background image not found.')]);
                return;
            }
            $ref = ['imageid' => (int) $id];
        }
        elseif ($kind === 'url') {
            // Form (http/https, Laenge) prueft PlanBackground::sanitize().
            $ref = ['url' => (string) $this->getInput('url', '')];
        }
        else {
            $this->jsonResponse(['error' => 'Invalid kind']);
            return;
        }

        try {
            PlanBackground::setRef($scope, $view, $ref);
        }
        catch (\Throwable $e) {
            error_log('network.topology.plan set: ' . $e);
            $this->jsonResponse(['error' => $e instanceof \APIException
                ? $e->getMessage()
                : _('Could not save the plan background.')]);
            return;
        }

        $this->jsonResponse(['ok' => true]);
    }

    /** Referenz der Ansicht entfernen. */
    private function opClear(): void {
        $scope = $this->resolveScope();
        if ($scope === null) {
            return;
        }

        try {
            PlanBackground::setRef($scope, (string) $this->getInput('view', ''), []);
        }
        catch (\Throwable $e) {
            error_log('network.topology.plan clear: ' . $e);
            $this->jsonResponse(['error' => _('Could not clear the plan background.')]);
            return;
        }

        $this->jsonResponse(['ok' => true]);
    }

    /** Neues Background-Bild in Zabbix anlegen (image.create). Nur Super-Admin. */
    private function opUpload(): void {
        if ($this->getUserType() !== USER_TYPE_SUPER_ADMIN) {
            $this->jsonResponse(['error' => _('Only Super admins can upload images.')]);
            return;
        }

        $name = trim((string) $this->getInput('name', ''));
        $data = (string) $this->getInput('data', '');

        if (strlen($data) > self::MAX_PAYLOAD) {
            $this->jsonResponse(['error' => 'Payload too large']);
            return;
        }
        if ($name === '') {
            $this->jsonResponse(['error' => _('Please name the image.')]);
            return;
        }
        // Data-URI -> reines base64 fuer die API. Groesse/Format erzwingt Zabbix.
        if (!preg_match('#^data:image/[a-z.+-]+;base64,#i', $data)) {
            $this->jsonResponse(['error' => _('Only image data is accepted.')]);
            return;
        }
        $b64 = substr($data, strpos($data, ',') + 1);

        try {
            $res = API::Image()->create([
                'name'      => $name,
                'imagetype' => 2,
                'image'     => $b64,
            ]);
        }
        catch (\Throwable $e) {
            error_log('network.topology.plan upload: ' . $e);
            $this->jsonResponse(['error' => $e instanceof \APIException
                ? $e->getMessage()
                : _('The image could not be uploaded.')]);
            return;
        }

        // Der Frontend-API-Wrapper WIRFT bei einem Fehler nicht, er gibt false
        // zurueck und legt die Meldung auf den Stack. Ohne diese Pruefung galt
        // ein fehlgeschlagener Upload als Erfolg mit leerer imageid, und das
        // Frontend referenzierte ein Bild, das es nicht gibt (Security-Review
        // F06). Gleiches Muster wie bei der Host-Erstellung.
        if ($res === false || empty($res['imageids'][0])) {
            $msg = implode('; ', array_column(get_and_clear_messages() ?: [], 'message'));
            $this->jsonResponse(['error' => $msg !== '' ? mb_substr($msg, 0, 250) : _('The image could not be uploaded.')]);
            return;
        }

        $this->jsonResponse(['ok' => true, 'imageid' => (string) $res['imageids'][0]]);
    }

    /**
     * Scope aus der Eingabe + Super-Admin-Gate fuer shared. Gibt null (und eine
     * Fehlerantwort) zurueck, wenn der Nutzer die geteilte Ebene nicht schreiben
     * darf — genau wie NetworkTopologyPositions.
     */
    private function resolveScope(): ?string {
        $scope = (string) $this->getInput('scope', PlanBackground::SCOPE_PERSONAL);

        if ($scope === PlanBackground::SCOPE_SHARED
                && $this->getUserType() !== USER_TYPE_SUPER_ADMIN) {
            $this->jsonResponse([
                'error' => _('Only Super admins can change the shared layout.')
            ]);
            return null;
        }

        return $scope === PlanBackground::SCOPE_SHARED
            ? PlanBackground::SCOPE_SHARED
            : PlanBackground::SCOPE_PERSONAL;
    }

    /**
     * Darf der Nutzer die durch den viewKey benannte Auswahl sehen? Spiegelt die
     * Logik von SharedLayerFilter: Suffix abtrennen, dann entweder der Host
     * (host<id>_h<hops>) oder ALLE Gruppen-IDs muessen ueber die rechtegepruefte
     * API sichtbar sein. Eine leere Auswahl nennt keine Gruppe → erlaubt.
     */
    private function viewVisible(string $view): bool {
        $base = $view;
        foreach (['_grp', '_plan'] as $suffix) {
            if (substr($base, -strlen($suffix)) === $suffix) {
                $base = substr($base, 0, -strlen($suffix));
                break;
            }
        }
        if ($base === '') {
            return true;
        }

        // Host+Hops-Form: der eine Host muss sichtbar sein.
        if (preg_match('/^host(\d+)_h\d+$/', $base, $m)) {
            return (bool) API::Host()->get(['output' => ['hostid'], 'hostids' => [$m[1]]]);
        }

        // Sonst Gruppen-IDs, mit "_" verbunden — alle muessen sichtbar sein.
        $gids = array_values(array_filter(explode('_', $base), static function ($g) {
            return $g !== '' && ctype_digit($g);
        }));
        if (!$gids) {
            return true;
        }
        $visible = API::HostGroup()->get([
            'output'      => ['groupid'],
            'groupids'    => $gids,
            'preservekeys' => true
        ]);
        foreach ($gids as $g) {
            if (!isset($visible[$g])) {
                return false;
            }
        }
        return true;
    }
}
