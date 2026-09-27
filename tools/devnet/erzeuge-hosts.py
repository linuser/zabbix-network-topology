#!/usr/bin/env python3
"""Legt die Lasttest-Hosts in Zabbix an — aus hosts.json.

Zweihundert Hosts von Hand anzuklicken ist keine Option, und es waere auch
nicht wiederholbar: ein Lasttest, der sich nicht identisch erneut aufbauen
laesst, vergleicht zwei verschiedene Netze miteinander.

Dieses Skript legt NUR die Hosts an. Das Template verlinkt danach setup.py
wie bisher — die Namen beginnen mit "lab-", also greift dessen Standard-
Praefix ohne Zutun. Zwei Skripte, weil das Verlinken auch fuer die
handgeschriebenen Belege gilt und nichts mit dem Lasttest zu tun hat.

Der API-Token kommt aus einer Datei und nie von der Kommandozeile — dort
stuende er in der Shell-History und in jeder Prozessliste.

    python3 tools/devnet/erzeuge-hosts.py --token-datei ~/.devnetz-token \\
        --hosts-datei tools/devnet/geraete-generiert/hosts.json

Aufraeumen danach:

    python3 tools/devnet/erzeuge-hosts.py --token-datei ~/.devnetz-token \\
        --hosts-datei ... --entfernen --ja
"""
import argparse
import json
import sys
import urllib.request

STANDARD_URL = 'http://localhost:8081/api_jsonrpc.php'


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--url', default=STANDARD_URL)
    p.add_argument('--token-datei', required=True)
    p.add_argument('--hosts-datei', required=True)
    p.add_argument('--entfernen', action='store_true',
                   help='die Hosts aus der Datei wieder loeschen')
    p.add_argument('--ja', action='store_true',
                   help='bei --entfernen wirklich loeschen (ohne das nur auflisten)')
    args = p.parse_args()

    token = open(args.token_datei).read().strip()
    daten = json.load(open(args.hosts_datei))
    hosts = daten['hosts']
    if not hosts:
        raise SystemExit('hosts.json enthaelt keine Hosts')

    def call(methode, params):
        anfrage = urllib.request.Request(
            args.url,
            data=json.dumps({'jsonrpc': '2.0', 'method': methode,
                             'params': params, 'id': 1}).encode(),
            headers={'Content-Type': 'application/json-rpc',
                     'Authorization': 'Bearer ' + token})
        antwort = json.loads(urllib.request.urlopen(anfrage, timeout=60).read().decode())
        if 'error' in antwort:
            raise SystemExit('%s: %s' % (methode, antwort['error'].get('data') or antwort['error']))
        return antwort['result']

    namen = [h['host'] for h in hosts]
    # exakte Namen statt search: ein "search" auf lab-gen- wuerde auch Hosts
    # treffen, die nicht aus dieser Datei stammen — und beim Loeschen waere
    # das der Unterschied zwischen aufraeumen und Schaden anrichten.
    vorhanden = {h['host']: h['hostid'] for h in
                 call('host.get', {'filter': {'host': namen}, 'output': ['hostid', 'host']})}

    if args.entfernen:
        if not vorhanden:
            print('nichts zu loeschen')
            return 0
        print('%d Host(s) aus dieser Datei sind angelegt:' % len(vorhanden))
        for n in sorted(vorhanden)[:5]:
            print('   ', n)
        if len(vorhanden) > 5:
            print('    … und %d weitere' % (len(vorhanden) - 5))
        if not args.ja:
            print('\nNichts geloescht. Mit --ja wiederholen, wenn es das sein soll.')
            return 0
        call('host.delete', list(vorhanden.values()))
        print('geloescht:', len(vorhanden))
        return 0

    gruppe = daten['hosts'][0].get('gruppe', 'Lasttest')
    gefunden = call('hostgroup.get', {'filter': {'name': [gruppe]}, 'output': ['groupid']})
    groupid = (gefunden[0]['groupid'] if gefunden
               else call('hostgroup.create', {'name': gruppe})['groupids'][0])
    print('Gruppe "%s": %s' % (gruppe, groupid))

    neu = 0
    for h in hosts:
        if h['host'] in vorhanden:
            continue
        call('host.create', {
            'host': h['host'],
            'groups': [{'groupid': groupid}],
            'interfaces': [{
                'type': 2,          # SNMP
                'main': 1,
                'useip': 1,
                'ip': h['ip'],
                'dns': '',
                'port': '161',
                # Der Community-String steht als Makro am Host und waehlt in
                # snmpsim die .snmprec-Datei. Ein fester String hier waere
                # dieselbe Angabe an zwei Stellen.
                'details': {'version': 2, 'community': '{$SNMP_COMMUNITY}', 'bulk': 1},
            }],
            'macros': [{'macro': '{$SNMP_COMMUNITY}', 'value': h['community']}],
        })
        neu += 1
        if neu % 25 == 0:
            print('  %d angelegt …' % neu)

    print('angelegt: %d, schon da: %d' % (neu, len(vorhanden)))
    print('\nJetzt das Template verlinken:')
    print('  python3 tools/devnet/setup.py --token-datei %s --url %s'
          % (args.token_datei, args.url))
    return 0


if __name__ == '__main__':
    sys.exit(main())
