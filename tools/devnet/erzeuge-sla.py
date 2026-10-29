#!/usr/bin/env python3
"""Legt im devnet einen Zabbix-Service + eine SLA an und loest ein passendes,
getaggtes Problem aus — damit die SLA-Pille des Moduls etwas zu zeigen hat.

Der SLA-Bezug (ROADMAP-Punkt 2) laesst sich nur mit echten Services pruefen, und
die haengen an SNMP-Werten vorbei: ein Service wird ueber *Problem-Tags* mit
Problemen verknuepft, eine SLA ueber *Service-Tags* mit dem Service. Dieses
Skript baut genau diese Kette in einem frischen devnet auf:

  1. ein Trapper-Item + Trigger (High) auf einem bestehenden Lab-Host, der
     Trigger traegt den Tag  Service=checkout
  2. ein Wert 1 an den Trapper (Zabbix-Sender-Protokoll) → der Trigger feuert,
     das Problem-Event erbt den Tag
  3. ein Service "Checkout" mit Problem-Tag  Service=checkout  → das Event zaehlt
     auf ihn, und sein problem_events traegt genau diese eventid
  4. eine SLA "Gold" mit Service-Tag  Tier=gold, der Service traegt denselben Tag
     → die SLA gilt fuer den Service (slo-Label auf der Pille)

Danach findet NetworkTopologyData ueber SlaResolver den Host als SLA-relevant.

ALLE Namen/Werte sind erfunden (devnet-Regel). Der API-Token kommt aus einer
Datei, nie von der Kommandozeile.

    python3 tools/devnet/erzeuge-sla.py --token-datei ~/.devnetz-token

Token anlegen: Oberflaeche → Users → API tokens, Benutzer Admin.
"""
import argparse
import json
import re
import socket
import struct
import sys
import time
import urllib.request
from datetime import datetime, timezone

STANDARD_URL = 'http://localhost:8081/api_jsonrpc.php'

# Erfundene Fixture-Namen. Der Host ist einer der evidence-Geraete (ein echter
# Kartenknoten), damit das magenta Badge auf einem sichtbaren Switch erscheint.
HOST        = 'lab-access-endpoints'
ITEM_KEY    = 'nt.sla.demo'
ITEM_NAME   = 'SLA demo (trapper)'
TRIGGER     = 'SLA demo problem (fixture)'
PROB_TAG    = ('Service', 'checkout')   # Trigger- und Service-Problem-Tag
SVC_TAG     = ('Tier', 'gold')          # Service-Tag und SLA-Service-Tag
SERVICE     = 'Checkout'
SLA         = 'Gold'
SLO         = '99.9'


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url', default=STANDARD_URL)
    p.add_argument('--token-datei', required=True)
    p.add_argument('--host', default=HOST, help='bestehender Host, der SLA-relevant werden soll')
    p.add_argument('--sender-host', default='localhost', help='Trapper-Ziel (zabbix-server)')
    p.add_argument('--sender-port', type=int, default=10051)
    p.add_argument('--warte', type=int, default=120,
                   help='max. Sekunden auf den Config-Cache (neues Trapper-Item)')
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

    # ── Host finden ────────────────────────────────────────────────────────
    hosts = call('host.get', {'filter': {'host': args.host}, 'output': ['hostid', 'host', 'name']})
    if not hosts:
        raise SystemExit('Host "%s" nicht gefunden — erst die Lab-Geraete anlegen '
                         '(siehe README) oder --host setzen.' % args.host)
    hostid = hosts[0]['hostid']
    technischer_name = hosts[0]['host']
    print('Host:', technischer_name, '(' + hostid + ')')

    # ── Trapper-Item (idempotent) ────────────────────────────────────────────
    items = call('item.get', {'hostids': hostid, 'filter': {'key_': ITEM_KEY}, 'output': ['itemid']})
    if items:
        print('Item', ITEM_KEY, 'existiert schon')
    else:
        call('item.create', {
            'hostid': hostid, 'name': ITEM_NAME, 'key_': ITEM_KEY,
            'type': 2,          # 2 = Zabbix trapper
            'value_type': 3,    # 3 = unsigned int
        })
        print('Item', ITEM_KEY, 'angelegt')

    # ── Trigger mit Problem-Tag (idempotent) ──────────────────────────────────
    trg = call('trigger.get', {'hostids': hostid, 'filter': {'description': TRIGGER},
                               'output': ['triggerid']})
    if trg:
        print('Trigger existiert schon')
    else:
        call('trigger.create', {
            'description': TRIGGER,
            'expression': 'last(/%s/%s)=1' % (technischer_name, ITEM_KEY),
            'priority': 4,   # 4 = High
            'tags': [{'tag': PROB_TAG[0], 'value': PROB_TAG[1]}],
        })
        print('Trigger angelegt (Tag %s=%s)' % PROB_TAG)

    # ── Wert an den Trapper → Trigger feuert ─────────────────────────────────
    # Ein frisch angelegtes Trapper-Item nimmt der Server erst nach einem
    # Config-Cache-Reload an (CacheUpdateFrequency). Deshalb mit Geduld: alle
    # 10 s erneut senden, bis mindestens ein Wert ankommt.
    print('sende Wert an Trapper (wartet ggf. auf den Config-Cache) …')
    ok = False
    frist = time.time() + args.warte
    while time.time() < frist:
        verarbeitet = sender_push(args.sender_host, args.sender_port,
                                  technischer_name, ITEM_KEY, '1')
        if verarbeitet:
            ok = True
            break
        time.sleep(10)
    if not ok:
        print('  ! Trapper nahm keinen Wert an. Haeufigste Ursache: der '
              'Config-Cache war noch nicht neu. Skript spaeter erneut laufen '
              'lassen — Service/SLA stehen dann schon und nur der Push wiederholt sich.')
    else:
        print('  Wert angenommen → Trigger feuert, Problem-Event mit Tag %s=%s' % PROB_TAG)

    # ── Service mit Problem-Tag + Service-Tag (idempotent) ────────────────────
    svc = call('service.get', {'filter': {'name': SERVICE}, 'output': ['serviceid']})
    if svc:
        print('Service "%s" existiert schon' % SERVICE)
    else:
        call('service.create', {
            'name': SERVICE,
            'algorithm': 1,     # ohne Kinder irrelevant; Status kommt vom Problem-Tag
            'sortorder': 0,
            'problem_tags': [{'tag': PROB_TAG[0], 'operator': 0, 'value': PROB_TAG[1]}],  # 0 = Equals
            'tags': [{'tag': SVC_TAG[0], 'value': SVC_TAG[1]}],
        })
        print('Service "%s" angelegt (Problem-Tag %s=%s, Tag %s=%s)'
              % (SERVICE, PROB_TAG[0], PROB_TAG[1], SVC_TAG[0], SVC_TAG[1]))

    # ── SLA mit Service-Tag (idempotent) ──────────────────────────────────────
    sla = call('sla.get', {'filter': {'name': SLA}, 'output': ['slaid']})
    if sla:
        print('SLA "%s" existiert schon' % SLA)
    else:
        mitternacht = int(datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0).timestamp())
        call('sla.create', {
            'name': SLA,
            'slo': SLO,
            'period': 1,         # 1 = weekly
            'timezone': 'UTC',
            'status': 1,         # 1 = enabled
            'effective_date': mitternacht,
            'service_tags': [{'tag': SVC_TAG[0], 'operator': 0, 'value': SVC_TAG[1]}],  # 0 = Equals
        })
        print('SLA "%s" angelegt (slo %s, Service-Tag %s=%s)'
              % (SLA, SLO, SVC_TAG[0], SVC_TAG[1]))

    print('\nFertig. In der Karte sollte "%s" jetzt das magenta SLA-Badge tragen '
          'und die KPI-Pille "1 SLA-relevant" zeigen (ggf. einen Poll abwarten).'
          % (hosts[0]['name'] or technischer_name))
    return 0


def sender_push(host, port, ziel_host, key, value):
    """Einen Wert per Zabbix-Sender-Protokoll (ohne TLS) schicken.

    Gibt True zurueck, wenn der Server den Wert VERARBEITET hat (processed>=1),
    sonst False — ein frisch angelegtes Trapper-Item wird bis zum naechsten
    Config-Cache-Reload als "failed" abgewiesen.
    """
    payload = json.dumps({
        'request': 'sender data',
        'data': [{'host': ziel_host, 'key': key, 'value': value}],
    }).encode()
    rahmen = b'ZBXD\x01' + struct.pack('<Q', len(payload)) + payload
    try:
        with socket.create_connection((host, port), timeout=10) as s:
            s.sendall(rahmen)
            kopf = _recv_genau(s, 13)   # 'ZBXD' + flags + 8-byte len
            if len(kopf) < 13 or kopf[:4] != b'ZBXD':
                return False
            laenge = struct.unpack('<Q', kopf[5:13])[0]
            body = _recv_genau(s, laenge)
    except OSError as e:
        print('  Sender-Fehler:', e)
        return False
    try:
        antwort = json.loads(body.decode())
    except ValueError:
        return False
    info = antwort.get('info', '')   # z.B. "processed: 1; failed: 0; total: 1; ..."
    m = re.search(r'processed:?\s*(\d+)', info)
    verarbeitet = int(m.group(1)) if m else 0
    if verarbeitet < 1:
        print('  Trapper-Antwort:', info or antwort)
    return verarbeitet >= 1


def _recv_genau(s, n):
    buf = b''
    while len(buf) < n:
        stueck = s.recv(n - len(buf))
        if not stueck:
            break
        buf += stueck
    return buf


if __name__ == '__main__':
    sys.exit(main())
