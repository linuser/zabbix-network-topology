// ghost-create.js — aus unueberwachten Nachbarn Zabbix-Hosts machen.
//
// WOZU
// ----
// Die Karte zeigt seit 5.5.0, welche Geraete kein Zabbix kennen UND an
// welchem Switch und Port sie haengen. Der naechste Schritt ist, daraus einen
// Host zu machen, ohne dass jemand abtippt, was eine Sekunde vorher auf dem
// Schirm stand.
//
// WARUM NICHT MEHR UEBER DAS FORMULAR
// -----------------------------------
// Bis hierher oeffnete das Kontextmenue Zabbix' Host-Formular mit
// ?host=…&description=…&groupids[]=…. Auf 7.0.31 nachgemessen: NUR groupids
// kommt an. Name und Beschreibung wurden stillschweigend verworfen — das
// Formular ging auf, war leer, und abgetippt werden musste trotzdem. Die
// Zabbix-Dokumentation fuehrt groupids als Seitenparameter, den Hostnamen
// nicht; zugesichert war es also nie.
//
// Ueber die Action laesst sich ausserdem setzen, was ueber eine URL ohnehin
// nie ginge: das Tag nt:uplink. Damit sitzt der neue Host sofort an der
// richtigen Stelle auf der Karte — bevor er selbst irgendetwas meldet.

import { t } from './i18n.js';
import { buildBaseUrl } from './utils.js';
import { fetchJson } from './http.js';

/**
 * Was die Action je Geist braucht.
 *
 * Erwartet den Geisterknoten und seinen Uplink-Eintrag (aus buildUplinks:
 * { nb, port, … }). Gibt null zurueck, wenn der Knoten kein Geist ist oder
 * keinen Namen hat — ein Host ohne Namen ergibt keinen Sinn.
 *
 * DIE MELDER-ID WIRD MITGESCHICKT, NICHT DER MELDER-NAME. Den Namen holt die
 * Action aus Zabbix: was im Tag nt:uplink landet, soll nicht das sein, was
 * der Browser behauptet.
 */
export function ghostRequestItem(node, uplink) {
    if (!node || !node._isGhost) return null;
    const name = String(node.host || node.label || '').trim();
    if (!name) return null;
    const u = uplink || {};
    return {
        name: name,
        reporter_hostid: String(u.nb || ''),
        port: String(u.port || ''),
        via: (node._ghostSrc && node._ghostSrc.length)
            ? String(node._ghostSrc[0]) : 'lldp'
    };
}

/**
 * Mehrere auf einmal. Reihenfolge bleibt, Dubletten fallen raus.
 *
 * Dubletten entstehen leicht: derselbe Geist kann in der Tabelle und auf der
 * Karte ausgewaehlt sein, und zweimal denselben Host anzulegen scheitert beim
 * zweiten Mal mit einer Fehlermeldung, die wie ein echtes Problem aussieht.
 */
export function ghostRequestItems(paare) {
    const raus = [];
    const gesehen = Object.create(null);
    (paare || []).forEach(function(p) {
        const item = ghostRequestItem(p && p.node, p && p.uplink);
        if (!item) return;
        const k = item.name.toLowerCase();
        if (gesehen[k]) return;
        gesehen[k] = true;
        raus.push(item);
    });
    return raus;
}

/**
 * Was nach dem Anlegen dasteht.
 *
 * TEILERFOLG WIRD BENANNT, NICHT GERUNDET. Zwanzig anzulegen und an einem
 * Namen zu scheitern, den Zabbix nicht annimmt, darf nicht als "20 angelegt"
 * durchgehen — und auch nicht als Fehlschlag. Beide Zahlen stehen da, und der
 * erste Fehlergrund dazu, damit man weiss, wonach man sucht.
 */
export function createResultText(res) {
    const erzeugt = (res && res.created) ? res.created.length : 0;
    const schief  = (res && res.failed)  ? res.failed.length  : 0;
    if (!erzeugt && !schief) return t('ghost.create.none');
    if (!schief) return t('ghost.create.ok', { n: erzeugt });
    if (!erzeugt) {
        return t('ghost.create.allfailed', {
            n: schief, why: String(res.failed[0].error || '')
        });
    }
    return t('ghost.create.partial', {
        n: erzeugt, failed: schief, why: String(res.failed[0].error || '')
    });
}

/**
 * Die Action rufen. Liefert das Ergebnis oder wirft.
 *
 * POST mit CSRF-Token — die Action nimmt nichts anderes an.
 */
export function createGhostHosts(items, groupid) {
    const cfg = window.NT_CONFIG || {};
    const body = new URLSearchParams();
    body.append('ghosts', JSON.stringify(items || []));
    body.append('groupid', String(groupid || ''));
    body.append('nt_csrf', cfg.create_host_csrf || '');
    return fetchJson(buildBaseUrl() + 'zabbix.php?action=network.topology.create_host', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: body.toString()
    });
}

/**
 * Der Satz, den der Bestaetigungsdialog zeigt.
 *
 * ES WIRD GEFRAGT, BEVOR ETWAS ENTSTEHT. Hosts anzulegen ist nicht mit einem
 * Klick rueckgaengig zu machen, und bei einer Mehrfachauswahl sieht man der
 * Karte nicht an, wie viele es gerade sind. Der Satz nennt deshalb die Zahl
 * und den ersten Namen.
 */
export function confirmText(items, gruppenName) {
    const n = (items || []).length;
    if (n === 1) {
        return t('ghost.create.confirm.one', {
            name: items[0].name, group: gruppenName || ''
        });
    }
    return t('ghost.create.confirm.many', {
        n: n, first: n ? items[0].name : '', group: gruppenName || ''
    });
}
