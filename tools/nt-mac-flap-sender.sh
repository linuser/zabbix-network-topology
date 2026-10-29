#!/usr/bin/env bash
#
# nt-mac-flap-sender.sh — MAC-Flapping als Zabbix-Trapper-Item (Loop-Erkennung,
# Stufe 3c).
#
# Pusht je Switch:
#   nt.mac.flap   Anzahl MAC-Adressen, die seit dem letzten Lauf den
#                 Forwarding-Port gewechselt haben.
#
# WARUM EIN SENDER UND KEIN ITEM: MAC-Flapping ist ZEITLICH -- dieselbe MAC
# wandert ueber die Zeit zwischen Ports. Das kann weder das zustandslose
# Frontend-Modul noch SNMP-Preprocessing rechnen. Dieses Skript hat Zustand:
# es liest je Switch die FDB-Items nt.fdb.dot1d/dot1q (die Zabbix ohnehin sammelt, s.
# docs/FDB-SETUP.md -- funktioniert auch hinter einem Proxy), vergleicht es mit dem
# letzten Snapshot (STATE_DIR), zaehlt die MACs mit geaendertem Port und pusht
# den Count per zabbix_sender. Als Cron alle 1-5 Minuten laufen lassen.
#
# Ein MAC-Move ist: dieselbe FDB-Zeile (gleiche MAC) mit ANDEREM Port in zwei
# aufeinanderfolgenden Snapshots. Neu gelernte oder gealterte MACs (nur in einem
# Snapshot) zaehlen NICHT -- das ist normales Lernen/Altern, kein Flap.
#
# Voraussetzung: die FDB-Items (nt.fdb.dot1d/dot1q) auf den Switchen (docs/FDB-SETUP.md) und
# das Trapper-Item nt.mac.flap (im Template "NT Spanning-Tree by SNMP").
#
# Verwendung (Cron-Beispiel, alle 2 Minuten):
#   */2 * * * * /opt/nt-tools/nt-mac-flap-sender.sh >/dev/null 2>&1
#
# Konfiguration ueber Environment:
set -euo pipefail

ZBX_URL="${ZBX_URL:-https://zabbix.example.com}"            # Frontend-/API-Basis-URL
ZBX_TOKEN="${ZBX_TOKEN:-}"                                  # API-Token (bevorzugt)
ZBX_USER="${ZBX_USER:-nt-mac-flap-monitor}"                # sonst User-Login
ZBX_PASS="${ZBX_PASS:-changeme}"
GROUPIDS="${GROUPIDS:-}"                                    # IDs ODER Namen, z.B. "24,25" oder "Fox" — leer = Fehler
SENDER_CONF="${SENDER_CONF:-/etc/zabbix/zabbix_agentd.conf}" # -c-Ziel, wenn ZBX_SENDER_HOST leer ist
ZBX_SENDER_HOST="${ZBX_SENDER_HOST:-}"                     # gesetzt -> Push per -z an diesen Trapper statt -c; HINTER EINEM PROXY: 127.0.0.1
ZBX_SENDER_PORT="${ZBX_SENDER_PORT:-10051}"                # Trapper-Port fuer -z
STATE_DIR="${STATE_DIR:-/var/lib/nt-mac-flap}"             # je Host ein Snapshot

if [[ -z "$GROUPIDS" ]]; then
    echo "GROUPIDS ist leer — kommasepariert setzen (z.B. GROUPIDS=24,25)" >&2
    exit 1
fi
command -v zabbix_sender >/dev/null || { echo "zabbix_sender nicht gefunden" >&2; exit 1; }

# Die Snapshots im STATE_DIR enthalten die FDB -- also MAC-Adressen von Geraeten
# im Netz. Die gehen keinen anderen Account auf der Box etwas an (ein Proxy
# traegt oft noch ansible-/zabbix-User). Darum privat anlegen: umask 077 fuer die
# neuen .json, und das Verzeichnis selbst auf 700, falls es schon offener lag.
umask 077
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR" 2>/dev/null || true

API="$ZBX_URL/api_jsonrpc.php"
SENDER_IN=$(mktemp /tmp/nt_macflap_in.XXXXXX)
trap 'rm -f "$SENDER_IN"' EXIT

# API + Diff in Python: holt die FDB-Items der Gruppen, vergleicht je Host gegen
# den letzten Snapshot und schreibt "<host> nt.mac.flap <count>" nach SENDER_IN.
GROUPIDS="$GROUPIDS" ZBX_API="$API" ZBX_TOKEN="$ZBX_TOKEN" ZBX_USER="$ZBX_USER" \
ZBX_PASS="$ZBX_PASS" STATE_DIR="$STATE_DIR" SENDER_IN="$SENDER_IN" python3 -I - <<'PY'
import os, re, json, urllib.request, hashlib

api   = os.environ['ZBX_API']
token = os.environ.get('ZBX_TOKEN', '')
gids_raw = [g.strip() for g in os.environ['GROUPIDS'].split(',') if g.strip()]
state = os.environ['STATE_DIR']
outf  = os.environ['SENDER_IN']

def call(method, params, auth=None):
    req = {'jsonrpc': '2.0', 'method': method, 'params': params, 'id': 1}
    headers = {'Content-Type': 'application/json-rpc'}
    if auth:
        headers['Authorization'] = 'Bearer ' + auth
    r = urllib.request.Request(api, data=json.dumps(req).encode(), headers=headers)
    d = json.load(urllib.request.urlopen(r, timeout=30))
    if 'error' in d:
        raise SystemExit('API %s: %s' % (method, d['error'].get('data', d['error'])))
    return d['result']

if not token:
    token = call('user.login', {'username': os.environ['ZBX_USER'],
                                'password': os.environ['ZBX_PASS']})

# GROUPIDS darf numerische IDs ODER Gruppennamen enthalten (gemischt). item.get
# will numerische groupids -- Namen hier per hostgroup.get aufloesen, damit man in
# der .env einfach "FOX" statt der ID schreiben kann. Erst jetzt, weil
# hostgroup.get den Token braucht.
gids   = [g for g in gids_raw if g.isdigit()]
names  = [g for g in gids_raw if not g.isdigit()]
if names:
    found = call('hostgroup.get', {'filter': {'name': names},
                                   'output': ['groupid', 'name']}, token)
    by_name = {g['name']: g['groupid'] for g in found}
    missing = [n for n in names if n not in by_name]
    if missing:
        raise SystemExit('Hostgruppe(n) nicht gefunden: ' + ', '.join(missing))
    gids += [by_name[n] for n in names]

# FDB-Items (dot1d UND dot1q) der Gruppen, mit lastvalue + Hostname. BEIDE, weil
# VLAN-faehige Switche ihre Forwarding-DB per-VLAN in dot1q fuehren und dot1d dort
# leer ist -- FdbParser liest ebenfalls beide. filter (exact) statt search, damit
# keine Fremdschluessel mitkommen.
items = call('item.get', {
    'groupids': gids,
    'filter': {'key_': ['nt.fdb.dot1d', 'nt.fdb.dot1q']},
    'output': ['itemid', 'lastvalue', 'hostid'],
    'selectHosts': ['host'],
    'monitored': True,
}, token)

# FDB-Walk-Text -> {MAC: Port}. Der Typ-Praefix ("INTEGER:") ist OPTIONAL:
# je nach Preprocessing kommt der Wert auch nackt (genau das toleriert FdbParser).
#
# Gekeyt wird auf die MAC (die letzten SECHS OID-Glieder), NICHT die ganze OID.
# Grund: ein Switch fuehrt dieselbe MAC meist in BEIDEN Tabellen gleichzeitig
# (dot1d UND dot1q, in dot1q zudem je VLAN). Auf voller OID gezaehlt wuerde ein
# EINZIGER Port-Wechsel einer MAC doppelt (bzw. je VLAN mehrfach) als "verschoben"
# zaehlen -- der Count waere ~2x zu hoch und die Schwelle (>2 MACs, NodeBuilder)
# faktisch halbiert. Die letzten sechs Glieder sind in beiden Tabellen die MAC
# (dot1d: .<mac6>, dot1q: .<vlan>.<mac6>), also dedupliziert das Key-auf-MAC
# dot1d/dot1q/VLAN von selbst: ein Move ist dann ein Move.
line_re = re.compile(r'^\.?(\S+)\s*=\s*(?:[^:]+:\s*)?(\S+)\s*$')
def parse(text):
    m = {}
    for ln in (text or '').splitlines():
        g = line_re.match(ln.strip())
        if not g:
            continue
        parts = g.group(1).split('.')
        if len(parts) < 6:
            continue                              # keine MAC am OID-Ende -> ignorieren
        m['.'.join(parts[-6:])] = g.group(2)      # Key = MAC
    return m

def moved(prev, cur):
    # MAC in BEIDEN Snapshots mit anderem Port = Move. Nur-neu/nur-weg = Lernen/Altern.
    return sum(1 for k, v in cur.items() if k in prev and prev[k] != v)

# dot1d + dot1q je Host zu EINER MAC->Port-Map vereinen. Fuehrt ein Switch eine
# MAC in beiden Tabellen (der Normalfall), fallen die zwei Eintraege hier auf
# einen zusammen -- genau das Entdoppeln, das der Count braucht.
by_host = {}
for it in items:
    host = (it.get('hosts') or [{}])[0].get('host')
    if not host:
        continue
    by_host.setdefault(host, {}).update(parse(it.get('lastvalue', '')))

lines = []
for host, cur in by_host.items():
    if not cur:
        continue                                  # noch kein FDB-Wert -> nichts melden
    sf = os.path.join(state, hashlib.sha1(host.encode()).hexdigest() + '.json')
    prev = {}
    try:
        with open(sf) as f:
            prev = json.load(f)
    except (OSError, ValueError):
        prev = {}
    if prev:                                      # erster Lauf: nur Baseline, kein Count
        # TAB-getrennt: der Hostname darf Leerzeichen enthalten (Zabbix erlaubt das),
        # der Count nicht -- so zerbricht die Push-Zeile unten nicht.
        lines.append('%s\t%d' % (host, moved(prev, cur)))
    tmp = sf + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(cur, f)
    os.replace(tmp, sf)

with open(outf, 'w') as f:
    f.write('\n'.join(lines) + ('\n' if lines else ''))
print('hosts: %d, pushing: %d' % (len(by_host), len(lines)))
PY

# Push je Host einzeln (-s/-k/-o statt -i): das -i-Format ist whitespace-getrennt
# ohne Quoting, ein Hostname mit Leerzeichen zerbricht es.
#
# Trapper-Ziel EINMAL festlegen: entweder explizit -z HOST -p PORT (wenn
# ZBX_SENDER_HOST gesetzt ist -- der Weg HINTER EINEM PROXY: an 127.0.0.1:10051
# des lokalen Proxys, nie an den Haupt-Server; der lehnt den Trapper-Wert fuer
# einen proxy-ueberwachten Host sonst ab) oder per Agent-Konfig (-c SENDER_CONF).
# Das Ziel wird hier VALIDIERT -- ein fehlendes Ziel bricht laut ab, statt vom
# per-Host "|| true" unten still verschluckt zu werden (so blieb nt.mac.flap
# sonst dauerhaft leer).
if [[ -n "$ZBX_SENDER_HOST" ]]; then
    sender_target=(-z "$ZBX_SENDER_HOST" -p "$ZBX_SENDER_PORT")
elif [[ -r "$SENDER_CONF" ]]; then
    sender_target=(-c "$SENDER_CONF")
else
    echo "Kein Trapper-Ziel: ZBX_SENDER_HOST leer UND SENDER_CONF nicht lesbar ($SENDER_CONF)." >&2
    echo "Hinter einem Proxy ZBX_SENDER_HOST=127.0.0.1 setzen." >&2
    exit 1
fi

if [[ -s "$SENDER_IN" ]]; then
    pushed=0
    while IFS=$'\t' read -r host count; do
        [[ -n "$host" ]] || continue
        # per-Host "|| true": ein fehlendes Trapper-Item auf EINEM Host (Template
        # dort nicht importiert) soll nicht den ganzen Lauf per set -e kippen.
        zabbix_sender "${sender_target[@]}" -s "$host" -k nt.mac.flap -o "$count" >/dev/null 2>&1 || true
        pushed=$((pushed + 1))
    done < "$SENDER_IN"
    echo "gepusht: $pushed Hosts"
else
    echo "nichts zu pushen (erster Lauf oder keine FDB-Daten)"
fi
