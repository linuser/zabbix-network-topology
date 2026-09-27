#!/usr/bin/env python3
"""Baut ein tiefes Netz aus Hosts ohne SNMP — fuer die Hop-Grenze.

WARUM GETRENNT VOM SNMP-LASTTEST
--------------------------------
Zwei offene Zahlen, zwei verschiedene Fragen. MAX_EDGES fragt, was eine KANTE
kostet — dafuer braucht es echte LLDP-Kanten mit Ports und Metrik, also
simulierte Geraete. MAX_HOP_HOSTS fragt, wie viele HOSTS die Anreicherung in
EINER Anfrage vertraegt; das ist der Fall aus #22, wo sechs Hops praktisch das
ganze Netz erfassten und nginx nach 60 Sekunden abbrach.

Fuer die zweite Frage ist SNMP nur teuer. Ein Baum aus Hosts mit nt:parent
liefert denselben Graphen, ohne einen einzigen Poller zu beschaeftigen:
keine Schnittstelle, kein Geraet, kein Service, kein Wert. Die Hosts sind
trotzdem echt, und genau ueber sie laeuft die Pipeline, die umgefallen ist.

nt:parent statt manueller Verbindungen, weil ManualLinks bei MAX_LINKS = 2000
deckelt und in module.config schreibt — ein Tag am Host hat keine dieser
Grenzen und ist der dokumentierte Weg.

    python3 tools/devnet/erzeuge-hop-netz.py --token-datei ~/.nt-last-token \\
        --url http://<node>:30081/api_jsonrpc.php --anzahl 2000

Aufraeumen:  ... --entfernen --ja
"""
import argparse
import json
import sys
import time
import urllib.request

GRUPPE = 'Hop-Lasttest'
PRAEFIX = 'hop-'
TEMPLATE = 'NT Hop Load'


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--url', required=True)
    p.add_argument('--token-datei', required=True)
    p.add_argument('--anzahl', type=int, default=2000)
    p.add_argument('--verzweigung', type=int, default=4,
                   help='Kinder je Knoten — bestimmt, wie tief der Baum wird')
    p.add_argument('--items', type=int, default=5,
                   help='Trapper-Items je Host; sie werden nie befuellt, aber '
                        'die Anreicherung holt sie')
    p.add_argument('--entfernen', action='store_true')
    p.add_argument('--ja', action='store_true')
    args = p.parse_args()

    token = open(args.token_datei).read().strip()

    def call(methode, params):
        anfrage = urllib.request.Request(
            args.url,
            data=json.dumps({'jsonrpc': '2.0', 'method': methode,
                             'params': params, 'id': 1}).encode(),
            headers={'Content-Type': 'application/json-rpc',
                     'Authorization': 'Bearer ' + token})
        antwort = json.loads(urllib.request.urlopen(anfrage, timeout=300).read().decode())
        if 'error' in antwort:
            raise SystemExit('%s: %s' % (methode, antwort['error'].get('data') or antwort['error']))
        return antwort['result']

    if args.entfernen:
        vorhanden = call('host.get', {'search': {'host': PRAEFIX}, 'output': ['hostid', 'host'],
                                      'startSearch': True})
        if not vorhanden:
            print('nichts zu loeschen')
            return 0
        print('%d Host(s) mit Praefix "%s"' % (len(vorhanden), PRAEFIX))
        if not args.ja:
            print('Nichts geloescht. Mit --ja wiederholen.')
            return 0
        # In Haeppchen: ein host.delete mit 2000 IDs laeuft in die
        # Zeitueberschreitung des Webservers, und dann weiss niemand, wie
        # viele davon weg sind.
        ids = [h['hostid'] for h in vorhanden]
        for i in range(0, len(ids), 200):
            call('host.delete', ids[i:i + 200])
            print('  geloescht: %d/%d' % (min(i + 200, len(ids)), len(ids)))
        return 0

    # ── Gruppe und Template ────────────────────────────────────────────────
    g = call('hostgroup.get', {'filter': {'name': [GRUPPE]}, 'output': ['groupid']})
    groupid = g[0]['groupid'] if g else call('hostgroup.create', {'name': GRUPPE})['groupids'][0]

    tg = call('templategroup.get', {'filter': {'name': ['Templates/Applications']},
                                    'output': ['groupid']})
    if not tg:
        tg = [{'groupid': call('templategroup.create',
                               {'name': 'Templates/Applications'})['groupids'][0]}]

    t = call('template.get', {'filter': {'host': [TEMPLATE]}, 'output': ['templateid']})
    if t:
        templateid = t[0]['templateid']
    else:
        templateid = call('template.create', {
            'host': TEMPLATE, 'groups': [{'groupid': tg[0]['groupid']}]})['templateids'][0]
        for i in range(args.items):
            call('item.create', {
                'hostid': templateid, 'name': 'Load probe %d' % (i + 1),
                'key_': 'nt.hop.probe[%d]' % (i + 1),
                # Trapper: braucht keine Schnittstelle und wird nie abgefragt.
                # Er existiert nur, damit die Anreicherung etwas zu holen hat —
                # genau das ist der Teil, der bei #22 zu lange gebraucht hat.
                'type': 2, 'value_type': 3,
            })
    print('Gruppe %s, Template %s (%d Items)' % (groupid, templateid, args.items))

    # ── Baum planen ────────────────────────────────────────────────────────
    namen = [PRAEFIX + '%05d' % i for i in range(args.anzahl)]
    eltern = {}
    for i in range(1, args.anzahl):
        eltern[namen[i]] = namen[(i - 1) // args.verzweigung]

    tiefe = {namen[0]: 0}
    for i in range(1, args.anzahl):
        tiefe[namen[i]] = tiefe[eltern[namen[i]]] + 1
    je_tiefe = {}
    for n, d in tiefe.items():
        je_tiefe[d] = je_tiefe.get(d, 0) + 1
    print('Baum: %d Hosts, Tiefe %d' % (args.anzahl, max(tiefe.values())))
    kumuliert = 0
    for d in sorted(je_tiefe):
        kumuliert += je_tiefe[d]
        print('   Hop %d: %5d Hosts   (kumuliert %d)' % (d, je_tiefe[d], kumuliert))

    # ── Anlegen ────────────────────────────────────────────────────────────
    da = {h['host'] for h in call('host.get', {'search': {'host': PRAEFIX},
                                               'startSearch': True, 'output': ['host']})}
    offen = [n for n in namen if n not in da]
    neu = 0
    t0 = time.time()
    # Stapelweise: host.create nimmt eine Liste. Einzeln gerufen brauchte es
    # 0,4 s je Host — bei 2000 Hosts dreizehn Minuten, und jeder Abbruch
    # dazwischen hinterlaesst einen halben Baum.
    STAPEL = 50
    for i in range(0, len(offen), STAPEL):
        gruppe = []
        for name in offen[i:i + STAPEL]:
            params = {
                'host': name,
                'groups': [{'groupid': groupid}],
                'templates': [{'templateid': templateid}],
            }
            # Keine Schnittstelle: ohne sie fragt niemand dieses Geraet ab,
            # und der Lasttest misst die Pipeline statt der Poller.
            if name in eltern:
                params['tags'] = [{'tag': 'nt:parent', 'value': eltern[name]}]
            gruppe.append(params)
        call('host.create', gruppe)
        neu += len(gruppe)
        if neu % 250 < STAPEL:
            print('  %d/%d angelegt (%.0f s)' % (neu, len(offen), time.time() - t0), flush=True)

    print('angelegt: %d, schon da: %d, Dauer %.0f s' % (neu, len(da), time.time() - t0))
    print('\nHop-Ansicht: Host "%s", Hops 6' % namen[0])
    return 0


if __name__ == '__main__':
    sys.exit(main())
