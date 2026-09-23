#!/usr/bin/env python3
"""Richtet die Entwicklungsumgebung in einem frischen Zabbix ein.

Importiert das LLDP-Template des Moduls, legt es auf die simulierten Geraete
und stellt die Abfrageintervalle kurz. Ohne das bleibt die Karte leer: die
Geraete antworten zwar, aber niemand fragt sie nach ihren Nachbarn.

Der API-Token kommt aus einer Datei und nie von der Kommandozeile — dort stuende
er in der Shell-History und in jeder Prozessliste.

    python3 tools/devnet/setup.py --token-datei ~/.devnetz-token

Token anlegen: in der Oberflaeche unter Users -> API tokens, Benutzer Admin.
"""
import argparse
import json
import re
import sys
import urllib.request

STANDARD_URL = 'http://localhost:8081/api_jsonrpc.php'
TEMPLATE = 'templates/nt_lldp_snmp_template.yaml'
TEMPLATE_NAME = 'NT LLDP Neighbors by SNMP'
GRUPPE = 'Templates/Network devices'


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url', default=STANDARD_URL)
    p.add_argument('--token-datei', required=True)
    p.add_argument('--template', default=TEMPLATE)
    p.add_argument('--praefix', default='lab-', help='Hosts mit diesem Praefix bekommen das Template')
    args = p.parse_args()

    token = open(args.token_datei).read().strip()

    def call(methode, params, auth=True):
        kopf = {'Content-Type': 'application/json-rpc'}
        if auth:
            kopf['Authorization'] = 'Bearer ' + token
        anfrage = urllib.request.Request(
            args.url,
            data=json.dumps({'jsonrpc': '2.0', 'method': methode, 'params': params, 'id': 1}).encode(),
            headers=kopf)
        antwort = json.loads(urllib.request.urlopen(anfrage, timeout=60).read().decode())
        if 'error' in antwort:
            raise SystemExit('%s: %s' % (methode, antwort['error'].get('data') or antwort['error']))
        return antwort['result']

    print('Zabbix', call('apiinfo.version', {}, auth=False))

    quelle = open(args.template).read()
    # Die Template-Gruppe gibt es in einer frischen Instanz schon, aber mit
    # einer anderen UUID. Der Import wuerde sie sonst ANLEGEN wollen und mit
    # "already exists" abbrechen.
    vorhanden = call('templategroup.get', {'filter': {'name': GRUPPE}, 'output': ['uuid']})
    if vorhanden and vorhanden[0].get('uuid'):
        quelle = re.sub(r'(template_groups:\s*\n\s*- uuid: )[0-9a-f]{32}',
                        r'\g<1>' + vorhanden[0]['uuid'], quelle, count=1)

    regel = {'createMissing': True, 'updateExisting': True}
    call('configuration.import', {
        'format': 'yaml',
        'rules': {
            'template_groups': regel, 'templates': regel, 'items': regel,
            'discoveryRules': regel, 'triggers': regel, 'valueMaps': regel,
            'templateLinkage': {'createMissing': True},
            'templateDashboards': regel,
        },
        'source': quelle,
    })
    print('Template importiert:', TEMPLATE_NAME)

    tpl = call('template.get', {'filter': {'host': TEMPLATE_NAME}, 'output': ['templateid']})
    if not tpl:
        raise SystemExit('Template nach dem Import nicht gefunden')
    tid = tpl[0]['templateid']

    hosts = call('host.get', {'search': {'host': args.praefix}, 'output': ['hostid', 'host'],
                              'selectParentTemplates': ['templateid']})
    if not hosts:
        raise SystemExit('Keine Hosts mit Praefix "%s" — erst die Geraete anlegen.' % args.praefix)

    neu = [h for h in hosts if tid not in [t['templateid'] for t in h['parentTemplates']]]
    if neu:
        call('host.massadd', {'hosts': [{'hostid': h['hostid']} for h in neu],
                              'templates': [{'templateid': tid}]})
    print('verlinkt:', ', '.join(sorted(h['host'] for h in neu)) or 'nichts neu')

    # Kurze Intervalle: in der Entwicklung will niemand eine Stunde auf die
    # naechste Discovery warten.
    for h in hosts:
        makros = call('usermacro.get', {'hostids': h['hostid'], 'output': ['macro', 'value']})
        behalten = [{'macro': m['macro'], 'value': m['value']}
                    for m in makros if m['macro'] not in ('{$NT.LLDP.INTERVAL}', '{$NT.LLDP.DISCOVERY.INTERVAL}')]
        behalten += [{'macro': '{$NT.LLDP.INTERVAL}', 'value': '1m'},
                     {'macro': '{$NT.LLDP.DISCOVERY.INTERVAL}', 'value': '2m'}]
        call('host.update', {'hostid': h['hostid'], 'macros': behalten})
    print('Intervalle auf 1m / 2m gesetzt')

    offen = call('item.get', {'search': {'key_': 'lldp'}, 'countOutput': True})
    print('LLDP-Items jetzt:', offen)
    return 0


if __name__ == '__main__':
    sys.exit(main())
