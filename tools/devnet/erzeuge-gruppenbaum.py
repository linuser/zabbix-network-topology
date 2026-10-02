#!/usr/bin/env python3
"""Haengt die Lasttest-Hosts ZUSAETZLICH in einen Gruppenbaum.

WOZU
----
Zabbix' Gruppenhierarchie ist eine Namenskonvention: "Lasttest/Berlin/Access"
ist EINE Gruppe, deren Name drei Ebenen beschreibt. Die Gruppenansicht der
Karte loest seit 5.4.2 entlang dieser Ebenen auf — nur laesst sich das mit
einer einzigen flachen Gruppe nicht ausprobieren.

Dieses Skript legt den Baum an und haengt jeden Host an der passenden Stelle
ein. Die Rolle kommt aus dem Namen (lab-gen-core-/dist-/acc-), der Standort
aus der laufenden Nummer — erfunden, aber deterministisch, damit zwei Laeufe
dasselbe Bild ergeben.

ZUSAETZLICH, nicht stattdessen: die Hosts bleiben in "Lasttest". Das ist
wichtig, und zwar aus einem Grund, der schon einmal eine Messung ruiniert
hat. Wer eine zusammenhaengende Topologie auf eine TEILMENGE von Gruppen
einschraenkt, macht aus jedem Nachbarn ausserhalb der Auswahl einen Geist —
bei einem frueheren Versuch waren das 812 statt 24. Weil hier alle Teilgruppen
zusammen wieder die vollstaendigen 1000 Hosts ergeben, entsteht das nicht,
solange man sie GEMEINSAM auswaehlt.

In der Karte also:
  * Gruppe "Lasttest"              -> flach, wie bisher
  * alle "Lasttest/..."-Gruppen    -> Baum, aufklappbar

Der API-Token kommt aus einer Datei und nie von der Kommandozeile — dort
stuende er in der Shell-History und in jeder Prozessliste.

    python3 tools/devnet/erzeuge-gruppenbaum.py --token-datei ~/.nt-last-token \\
        --url http://<node>:30081/api_jsonrpc.php

Aufraeumen (loest nur die Baum-Gruppen, die Hosts bleiben in "Lasttest"):

    ... --entfernen --ja
"""
import argparse
import json
import re
import sys
import urllib.request

PRAEFIX = 'lab-gen-'
WURZEL  = 'Lasttest'
# Erfundene Standorte. Zwei reichen, um das Aufklappen ueber drei Ebenen zu
# zeigen, und mehr macht die Karte nur unuebersichtlicher.
STANDORTE = ['Berlin', 'Muenchen']
ROLLEN = {'core': 'Core', 'dist': 'Dist', 'acc': 'Access'}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--url', required=True)
    p.add_argument('--token-datei', required=True)
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
        antwort = json.loads(urllib.request.urlopen(anfrage, timeout=120).read().decode())
        if 'error' in antwort:
            raise SystemExit('%s: %s' % (methode, antwort['error'].get('data') or antwort['error']))
        return antwort['result']

    if args.entfernen:
        vorhanden = call('hostgroup.get', {'search': {'name': WURZEL + '/'},
                                           'startSearch': True, 'output': ['groupid', 'name']})
        if not vorhanden:
            print('kein Gruppenbaum da')
            return 0
        print('%d Baum-Gruppe(n):' % len(vorhanden))
        for g in sorted(x['name'] for x in vorhanden):
            print('   ', g)
        if not args.ja:
            print('\nNichts geloescht. Mit --ja wiederholen.')
            return 0
        # Die Hosts bleiben in "Lasttest" — hostgroup.delete loest nur die
        # Zuordnung, es loescht keine Hosts.
        call('hostgroup.delete', [g['groupid'] for g in vorhanden])
        print('geloescht:', len(vorhanden))
        return 0

    hosts = call('host.get', {'search': {'host': PRAEFIX}, 'startSearch': True,
                              'output': ['hostid', 'host']})
    if not hosts:
        raise SystemExit('keine Hosts mit Praefix "%s" gefunden' % PRAEFIX)
    print('Hosts gefunden:', len(hosts))

    # Name -> (Standort, Rolle). Nach der Nummer aufgeteilt und nicht zufaellig:
    # zwei Laeufe sollen dasselbe Bild ergeben, sonst vergleicht man beim
    # zweiten Hinsehen zwei verschiedene Netze.
    zuordnung = {}
    for h in hosts:
        m = re.match(r'^' + re.escape(PRAEFIX) + r'(core|dist|acc)-(\d+)$', h['host'])
        if not m:
            continue
        rolle = ROLLEN[m.group(1)]
        standort = STANDORTE[int(m.group(2)) % len(STANDORTE)]
        name = '%s/%s/%s' % (WURZEL, standort, rolle)
        zuordnung.setdefault(name, []).append(h['hostid'])

    if not zuordnung:
        raise SystemExit('kein Hostname passte auf das Muster')

    for name in sorted(zuordnung):
        gefunden = call('hostgroup.get', {'filter': {'name': [name]}, 'output': ['groupid']})
        gid = (gefunden[0]['groupid'] if gefunden
               else call('hostgroup.create', {'name': name})['groupids'][0])
        # massadd statt host.update: update wuerde die Gruppen ERSETZEN, und
        # damit flaege "Lasttest" heraus — genau das soll nicht passieren.
        call('host.massadd', {'hosts': [{'hostid': i} for i in zuordnung[name]],
                              'groups': [{'groupid': gid}]})
        print('  %-28s %4d Hosts' % (name, len(zuordnung[name])))

    print('\nIn der Karte:')
    print('  Gruppe "%s"            -> flach wie bisher' % WURZEL)
    print('  alle "%s/..."-Gruppen  -> Baum, Klick auf eine Gruppe klappt sie auf' % WURZEL)
    print('  (gemeinsam auswaehlen, sonst werden Nachbarn ausserhalb zu Geistern)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
