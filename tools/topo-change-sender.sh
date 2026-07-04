#!/usr/bin/env bash
#
# topo-change-sender.sh — Topologie-Aenderungen + Health-Score als
# Zabbix-Items/-Events.
#
# Pollt die network.topology.v6.data-Action und pusht per zabbix_sender:
#
#   nt.topo.changes        Anzahl added+removed Edges seit letztem Poll
#   nt.topo.changes.text   menschenlesbare Liste ("-" wenn nichts)
#   nt.health.score        Topology-Health-Score, Durchschnitt (0-100)
#   nt.health.score.min    Score der schlechtesten Hostgroup (0-100)
#
# Trigger dazu liefern die Templates:
#   templates/nt_topology_change_template.yaml  (changes > 0 → Event)
#   templates/nt_health_score_template.yaml     (score < 70 → Event)
#
# Hintergrund: Zabbix-Frontend-Modul-Actions brauchen eine Frontend-
# Session (kein API-Token-Support fuer zabbix.php) — deshalb macht dieses
# Skript den Login-Dance per curl statt dass ein HTTP-Agent-Item direkt
# pollt. Als Cron alle 1-5 Minuten laufen lassen, mit einem dedizierten
# Monitoring-User (USER-Rolle reicht, braucht Lese-Zugriff auf die
# Hostgroups).
#
# WICHTIG: eigener Monitoring-User! Die APCu-Topo-Baseline ist user-scoped —
# ein geteilter User wuerde sich die Baseline mit UI-Sessions verrollen.
#
# Verwendung (Cron-Beispiel, alle 2 Minuten):
#   */2 * * * * /opt/nt-tools/topo-change-sender.sh >/dev/null 2>&1
#
# Konfiguration ueber Environment oder die Defaults hier anpassen:
set -euo pipefail

ZBX_URL="${ZBX_URL:-https://zabbix.example.com}"          # Frontend-Basis-URL
ZBX_USER="${ZBX_USER:-nt-topo-monitor}"                    # dedizierter User!
ZBX_PASS="${ZBX_PASS:-changeme}"
GROUPIDS="${GROUPIDS:-}"                                   # z.B. "24,25" — leer = Fehler
SENDER_HOST="${SENDER_HOST:-Zabbix server}"                # Host dem die Trapper-Items gehoeren
SENDER_CONF="${SENDER_CONF:-/etc/zabbix/zabbix_agentd.conf}"

if [[ -z "$GROUPIDS" ]]; then
    echo "GROUPIDS ist leer — kommasepariert setzen (z.B. GROUPIDS=24,25)" >&2
    exit 1
fi

JAR=$(mktemp /tmp/nt_topo_jar.XXXXXX)
trap 'rm -f "$JAR"' EXIT

# 1. Frontend-Login (Session-Cookie in die Jar)
curl -sfk -c "$JAR" -o /dev/null \
    --data-urlencode "name=$ZBX_USER" \
    --data-urlencode "password=$ZBX_PASS" \
    --data-urlencode "enter=Sign in" \
    "$ZBX_URL/index.php"

# 2. Data-Action pollen (rollt die Topo-Baseline serverseitig weiter)
QS="action=network.topology.v6.data"
IFS=',' read -ra GIDS <<< "$GROUPIDS"
for g in "${GIDS[@]}"; do
    QS="$QS&groupids%5B%5D=$g"
done
RESP=$(curl -sfk -b "$JAR" -H "X-Requested-With: XMLHttpRequest" \
    "$ZBX_URL/zabbix.php?$QS")

# 3. topo_changes + health extrahieren (python3 statt jq — praktisch immer
#    da). Ausgabe zeilenweise: count / text / health_avg / health_min —
#    text enthaelt Leerzeichen, deshalb kein wortbasiertes read.
OUT="$(python3 - "$RESP" <<'PYEOF'
import json, sys
try:
    d = json.loads(sys.argv[1])
except Exception:
    print(0); print('parse-error'); print(''); print('')
    raise SystemExit
tc = d.get('topo_changes') or {}
added   = tc.get('added')   or []
removed = tc.get('removed') or []
parts  = ['+ %s <-> %s' % (x.get('a','?'), x.get('b','?')) for x in added]
parts += ['- %s <-> %s' % (x.get('a','?'), x.get('b','?')) for x in removed]
text = '; '.join(parts).replace('\n', ' ') or '-'
h = d.get('health') or {}
avg = h.get('avg'); mn = h.get('min')
print(len(added) + len(removed))
print(text)
print('' if avg is None else avg)
print('' if mn is None else mn)
PYEOF
)"
COUNT=$(sed -n 1p <<< "$OUT")
TEXT=$( sed -n 2p <<< "$OUT")
AVG=$(  sed -n 3p <<< "$OUT")
MIN=$(  sed -n 4p <<< "$OUT")

# 4. per zabbix_sender an die Trapper-Items
zabbix_sender -c "$SENDER_CONF" -s "$SENDER_HOST" -k nt.topo.changes      -o "$COUNT" >/dev/null
zabbix_sender -c "$SENDER_CONF" -s "$SENDER_HOST" -k nt.topo.changes.text -o "$TEXT"  >/dev/null
# Health-Score nur wenn das Backend ihn liefert (Modul >= 4.27) UND die
# Items existieren — zabbix_sender-Fehler (Template nicht importiert)
# sollen den Topo-Teil nicht mit runterreissen.
if [[ -n "$AVG" ]]; then
    zabbix_sender -c "$SENDER_CONF" -s "$SENDER_HOST" -k nt.health.score     -o "$AVG" >/dev/null || true
fi
if [[ -n "$MIN" ]]; then
    zabbix_sender -c "$SENDER_CONF" -s "$SENDER_HOST" -k nt.health.score.min -o "$MIN" >/dev/null || true
fi

echo "topo-changes: $COUNT ($TEXT) · health: ${AVG:--}/${MIN:--}"
