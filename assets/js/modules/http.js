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
//   2. HTTP-Status ausserhalb 2xx                   → http.timeout / http.status
//   3. Antwort kein JSON (Login-Seite, PHP-Fatal)   → http.not_json
// und wirft jeweils einen Error mit uebersetzter Nachricht und .status. Ein
// {error: ...} im JSON bleibt Sache des Aufrufers — manche Endpunkte melden
// darueber Fachliches (conflict), das kein Fehler im Sinn dieses Helfers ist.

import { t } from './i18n.js';

// Gateway-Codes: der Webserver vor PHP hat aufgegeben oder PHP ist
// abgestuerzt. Fast immer ist die Abfrage zu gross, und dafuer gibt es einen
// konkreten Rat statt nur einer Nummer.
const GATEWAY = { 502: true, 503: true, 504: true };

function httpError(message, status) {
    const err = new Error(message);
    err.status = status;
    return err;
}

export function fetchJson(url, opts) {
    return fetch(url, opts).then(
        function(r) {
            if (!r.ok) {
                const status = r.status;
                throw httpError(GATEWAY[status]
                    ? t('http.timeout', { status: status })
                    : t('http.status', { status: status, text: r.statusText || '' }).trim(), status);
            }
            // Als Text lesen und selbst parsen: nur so laesst sich ein
            // Nicht-JSON-Body von einem Netzfehler unterscheiden.
            return r.text().then(function(body) {
                try {
                    return JSON.parse(body);
                } catch (e) {
                    throw httpError(t('http.not_json'), r.status);
                }
            });
        },
        function() {
            throw httpError(t('http.network'), 0);
        }
    );
}
