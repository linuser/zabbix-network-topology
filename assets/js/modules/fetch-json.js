// fetch-json.js — eine Antwort holen und darauf bestehen, dass es JSON ist.
//
// Eigenes Modul statt utils.js: utils ist per Kommentar oben in der Datei
// abhaengigkeitsfrei, und diese Funktion braucht t() fuer ihre Meldungen.
// Die Regel dort ist aelter als dieser Helfer und hat ihren Grund.

import { t } from './i18n.js';

/**
 * fetch + JSON, mit einer Antwort auf die Frage "und wenn nicht?".
 *
 * WARUM ES DAS GIBT
 * -----------------
 * Ueberall stand `fetch(u).then(r => r.json())`. Kommt statt JSON eine
 * HTML-Seite — und die kommt: nginx schickt bei Zeitueberschreitung eine
 * 504-Seite, Zabbix bei abgelaufener Sitzung die Anmeldung —, dann platzt
 * der Parser mit
 *
 *     Unexpected token '<', "<html> <h"... is not valid JSON
 *
 * und der Nutzer liest etwas ueber JSON, waehrend sein Problem eine
 * Zeitueberschreitung ist. Genau so gemeldet in #22.
 *
 * Der Status wird deshalb VOR dem Parsen angesehen, und der Fehler traegt
 * einen Text, der sagt, was zu tun ist. Der Aufrufer faengt ihn wie bisher
 * mit .catch() — nur hat `err.message` jetzt einen Sinn.
 *
 * `err.ntKind` nennt die Art (timeout | auth | http | parse), falls jemand
 * darauf verzweigen will.
 */
export function fetchJson(url, options) {
    const opt = Object.assign({
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }, options || {});

    return fetch(url, opt).then(function(r) {
        if (!r.ok) {
            // 504/502/408 sind der Fall aus #22: die Anfrage war zu gross
            // oder zu langsam. 401/403 heisst fast immer: Sitzung abgelaufen,
            // und ein Neuladen hilft wirklich.
            const kind = (r.status === 504 || r.status === 502 || r.status === 408)
                ? 'timeout'
                : ((r.status === 401 || r.status === 403) ? 'auth' : 'http');
            const key = kind === 'timeout' ? 'err.timeout'
                : (kind === 'auth' ? 'err.session' : 'err.http');
            const e = new Error(t(key, { code: r.status }));
            e.ntKind = kind;
            e.ntStatus = r.status;
            throw e;
        }
        return r.text().then(function(text) {
            try {
                return JSON.parse(text);
            }
            catch (parseErr) {
                // 200 und trotzdem kein JSON: ein PHP-Fatal mit
                // display_errors, eine Portalseite davor, ein Proxy. Der
                // Anfang der Antwort hilft beim Suchen, der Rest nicht.
                const e = new Error(t('err.not_json', { start: String(text).slice(0, 40) }));
                e.ntKind = 'parse';
                throw e;
            }
        });
    });
}
