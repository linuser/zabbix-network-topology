<?php
declare(strict_types = 1);

namespace Modules\NetworkTopologyV6\Actions;

use CController;
use CControllerResponseData;
use CControllerResponseFatal;

/**
 * NetworkTopologyMail — sendet einen HTML-Report per SMTP.
 *
 * Sicherheit:
 *   - Manueller CSRF-Check via CCsrfTokenHelper. disableCsrfValidation() ist nötig,
 *     weil der Standard-Zabbix-Validator Base64-Zeichen (+/=) im html_b64 ablehnt.
 *   - Nur USER_TYPE_ZABBIX_ADMIN darf senden.
 *   - X-Requested-With als zusätzliche Schicht.
 *
 * SMTP-Passwort — Lade-Reihenfolge:
 *   1. /etc/zabbix/nt_smtp_password   (bevorzugt, chmod 640, root:www-data)
 *   2. /var/lib/zabbix/nt_smtp_password
 *   3. NT_SMTP_PASSWORD-Konstante (Legacy-Fallback, NICHT empfohlen)
 */
define('NT_SMTP_PASSWORD', '');   // Legacy — besser Datei-Variante nutzen

class NetworkTopologyMail extends CController {

    protected function init(): void {
        $this->disableCsrfValidation();
    }

    protected function checkInput(): bool {
        // CSRF-Check via Zabbix-Helper
        if (class_exists('\CCsrfTokenHelper')) {
            $token = isset($_POST['_csrf_token']) ? (string) $_POST['_csrf_token'] : '';
            try {
                $ok = \CCsrfTokenHelper::check($token, 'network.topology.v6.mail');
            } catch (\Throwable $e) {
                $ok = false;
            }
            if (!$ok) {
                $this->setResponse(new CControllerResponseData([
                    'main_block' => json_encode(['error' => 'CSRF token invalid'])
                ]));
                return false;
            }
        }

        // X-Requested-With als zusätzliche Schicht
        $xrw = $_SERVER['HTTP_X_REQUESTED_WITH'] ?? '';
        if ($xrw !== 'XMLHttpRequest') {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['error' => 'Nur AJAX-Requests erlaubt'])
            ]));
            return false;
        }

        // 'to' regulär validieren; html_b64 umgeht den Validator (Base64-Zeichen)
        $ret = $this->validateInput(['to' => 'required|not_empty']);
        if (!$ret) {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['error' => 'Validation failed'])
            ]));
        }
        return $ret;
    }

    protected function checkPermissions(): bool {
        return $this->getUserType() >= USER_TYPE_ZABBIX_ADMIN;
    }

    private function loadSmtpPassword(): string {
        foreach (['/etc/zabbix/nt_smtp_password', '/var/lib/zabbix/nt_smtp_password'] as $path) {
            if (@is_readable($path)) {
                $pw = trim((string) @file_get_contents($path));
                if ($pw !== '') return $pw;
            }
        }
        return defined('NT_SMTP_PASSWORD') ? (string) NT_SMTP_PASSWORD : '';
    }

    protected function doAction(): void {
        $to  = trim($this->getInput('to', ''));
        $b64 = isset($_POST['html_b64']) ? (string) $_POST['html_b64'] : '';
        $body = base64_decode($b64, true);
        if ($body === false) { $body = ''; }
        $subject = 'Network Topology Report — ' . date('d.m.Y H:i');

        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['error' => 'Ungültige E-Mail-Adresse'])
            ]));
            return;
        }

        if (empty($body)) {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['error' => 'HTML-Body leer oder Base64 ungültig'])
            ]));
            return;
        }

        // SMTP-Konfiguration: zuerst mediatypeid=46, sonst neuester E-Mail-Type
        $db = DBselect(
            'SELECT smtp_server,smtp_port,smtp_email,smtp_security,smtp_authentication,smtp_username'
            . ' FROM media_type WHERE mediatypeid=46 LIMIT 1'
        );
        $mt = DBfetch($db);

        if (!$mt) {
            $db2 = DBselect(
                'SELECT smtp_server,smtp_port,smtp_email,smtp_security,smtp_authentication,smtp_username'
                . ' FROM media_type WHERE type=0 ORDER BY mediatypeid DESC LIMIT 1'
            );
            $mt = DBfetch($db2);
        }

        if (!$mt) {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['error' => 'Kein E-Mail Media Type in DB gefunden'])
            ]));
            return;
        }

        $smtp_server = $mt['smtp_server'];
        $smtp_port   = (int)($mt['smtp_port'] ?? 25);
        $smtp_from   = $mt['smtp_email'] ?: 'zabbix@localhost';
        $smtp_sec    = (int)($mt['smtp_security'] ?? 0);
        $smtp_auth   = (int)($mt['smtp_authentication'] ?? 0);
        $smtp_user   = $mt['smtp_username'] ?? '';
        $smtp_pass   = $this->loadSmtpPassword();

        try {
            $transport = new \Swift_SmtpTransport($smtp_server, $smtp_port);
            if ($smtp_sec === 1) $transport->setEncryption('tls');
            if ($smtp_sec === 2) $transport->setEncryption('ssl');
            if ($smtp_auth && $smtp_user !== '') {
                $transport->setUsername($smtp_user);
                if ($smtp_pass !== '') $transport->setPassword($smtp_pass);
            }

            $mailer  = new \Swift_Mailer($transport);
            $message = (new \Swift_Message($subject))
                ->setFrom([$smtp_from => 'Zabbix Network Topology'])
                ->setTo([$to])
                ->setBody($body, 'text/html', 'utf-8');

            $sent = $mailer->send($message);

            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(
                    $sent
                        ? ['success' => true]
                        : ['error' => 'Keine Empfänger erreicht — SMTP-Verbindung ok?']
                )
            ]));

        } catch (\Exception $e) {
            $this->setResponse(new CControllerResponseData([
                'main_block' => json_encode(['error' => 'SMTP: ' . $e->getMessage()])
            ]));
        }
    }
}
