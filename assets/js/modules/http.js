// http.js — JSON von einem Modul-Endpunkt holen, mit lesbaren Fehlern.
//
// Warum ein eigener Helfer: Die Datenabfrage stand als
// fetch(url).then(r => r.json()) da, ohne Blick auf den HTTP-Status. Brach
// nginx eine lange Abfrage ab (504 nach 60 s, gesehen bei Host + 6 Hops in
// einem grossen Netz), kam dessen HTML-Fehlerseite zurueck, und der Benutzer
// las nur: Unexpected token '<', "<html> <h"... is not valid JSON. Weder der
// Status noch ein Hinweis, was zu tun ist, kam an.
//
// fetchJson() prueft deshalb in dieser Reihenfolge:
//   1. Netzfehler (Server nicht erreichbar)        → http.network
//   2. HTTP-Status ausserhalb 2xx                   → http.timeout /
//      http.denied / http.status
//   3. Antwort kein JSON (Login-Seite, PHP-Fatal)   → http.not_json
// und wirft jeweils einen Error mit uebersetzter Nachricht und .status. Ein
// {error: ...} im JSON bleibt Sache des Aufrufers — manche Endpunkte melden
// darueber Fachliches (conflict), das kein Fehler im Sinn dieses Helfers ist.
//
// Die Vorgaben fuer credentials und X-Requested-With stehen hier, weil jede
// lesende Action requireAjax() hat: fehlt der Kopf, antwortet der Endpunkt
// mit {"error":"AJAX only"} — Status 200, gueltiges JSON, also nichts, was
// dieser Helfer bemerken koennte. Die 22 Aufrufstellen setzen beides selbst
// und behalten den Vorrang; die Vorgabe ist fuer die dreiundzwanzigste da.

import { t } from './i18n.js';

// Gateway-Codes: der Webserver vor PHP hat aufgegeben oder PHP ist
// abgestuerzt. Fast immer ist die Abfrage zu gross, und dafuer gibt es einen
// konkreten Rat statt nur einer Nummer.
const GATEWAY = { 502: true, 503: true, 504: true };

// 401/403 ist fast immer die abgelaufene Sitzung — dagegen hilft Neuladen,
// und das ist ein Rat, den "HTTP 403" allein nicht gibt. Der zweite Fall ist
// der entzogene Super-Admin: dann stimmt die Meldung auch.
const DENIED = { 401: true, 403: true };

/**
 * Der Anfang einer Antwort, die kein JSON war — zum Wiedererkennen.
 *
 * Ob da nginx, die Zabbix-Anmeldung oder ein PHP-Fatal steht, entscheidet,
 * wo man nachsieht; "eine Webseite" allein sagt das nicht. Spitze Klammern
 * fallen dabei weg: der Text landet in Meldungen, die Aufrufer teils in
 * innerHTML schreiben, und fremder Serverausgabe dort zu trauen waere die
 * Art von Annahme, die ci:xss gerade verhindern soll.
 */
function anfang(body) {
    const s = String(body).replace(/[<>&"']/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
}

function httpError(message, status) {
    const err = new Error(message);
    err.status = status;
    return err;
}

export function fetchJson(url, opts) {
    const o = Object.assign({ credentials: 'same-origin' }, opts || {});
    o.headers = Object.assign({ 'X-Requested-With': 'XMLHttpRequest' }, o.headers || {});

    return fetch(url, o).then(
        function(r) {
            if (!r.ok) {
                const status = r.status;
                throw httpError(GATEWAY[status]
                    ? t('http.timeout', { status: status })
                    : (DENIED[status]
                        ? t('http.denied', { status: status })
                        : t('http.status', { status: status, text: r.statusText || '' }).trim()),
                    status);
            }
            // Als Text lesen und selbst parsen: nur so laesst sich ein
            // Nicht-JSON-Body von einem Netzfehler unterscheiden.
            return r.text().then(function(body) {
                try {
                    return JSON.parse(body);
                } catch (e) {
                    const start = anfang(body);
                    throw httpError(start === ''
                        ? t('http.not_json')
                        : t('http.not_json') + ' ' + t('http.body_start', { start: start }),
                        r.status);
                }
            });
        },
        function() {
            throw httpError(t('http.network'), 0);
        }
    );
}
