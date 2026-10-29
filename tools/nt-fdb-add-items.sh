#!/usr/bin/env bash
#
# nt-fdb-add-items.sh — legt die vier walk[]-Items fuer den MAC-Finder auf einem
# Switch an (siehe docs/FDB-SETUP.md). EIN Befehl statt vier Klicks in der UI.
#
# Aufruf:
#   NT_ZBX_URL='https://<zabbix>/api_jsonrpc.php' \
#   NT_ZBX_TOKEN='<api-token>' \
#   tools/nt-fdb-add-items.sh <switch-ip-oder-hostname>
#
# WARUM TOKEN UND NICHT PASSWORT
# ------------------------------
# Ein API-Token (Zabbix: Users -> API tokens) ist widerrufbar und braucht kein
# Passwort in der Shell. Er steht in einer Umgebungsvariable, nicht als
# Argument (Argumente stehen in der History und sind per 'ps' sichtbar). Das
# Script gibt den Token nirgends aus und sendet nur an NT_ZBX_URL.
#
# WAS ES TUT
# ----------
# Findet den Host (per IP ueber seine SNMP-Schnittstelle, sonst per Hostname) +
# dessen SNMP-interfaceid, und legt die vier Items an, SOFERN ihr Key noch nicht
# existiert (idempotent — ein zweiter Lauf legt nichts doppelt an). Es LOESCHT
# nichts.
#
# Liegt in tools/ und ist aus dem Modul-Paket ausgeschlossen (deploy.sh).

set -uo pipefail

if [[ -t 1 ]]; then C_OK=$'\e[32m'; C_ERR=$'\e[31m'; C_DIM=$'\e[2m'; C_RST=$'\e[0m'
else C_OK=""; C_ERR=""; C_DIM=""; C_RST=""; fi

usage() { sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
[[ $# -ge 1 ]] || usage 1
case "$1" in -h|--help|help) usage 0 ;; esac
readonly TARGET="$1"

command -v curl >/dev/null 2>&1 || { echo "${C_ERR}curl not found.${C_RST}" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "${C_ERR}python3 not found (used only to read JSON).${C_RST}" >&2; exit 1; }

URL="${NT_ZBX_URL:-}"
TOKEN="${NT_ZBX_TOKEN:-}"
[[ -n "$URL"   ]] || { echo "${C_ERR}Set NT_ZBX_URL=https://<zabbix>/api_jsonrpc.php${C_RST}" >&2; exit 1; }
[[ -n "$TOKEN" ]] || { echo "${C_ERR}Set NT_ZBX_TOKEN=<api-token>${C_RST}" >&2; exit 1; }

# Ein API-Call. $1 = JSON-params-Objekt fuer die Methode $0-unabhaengig; wir
# bauen die ganze Anfrage hier und reichen nur method+params rein.
api() {
    local method="$1" params="$2"
    curl -s -H 'Content-Type: application/json-rpc' \
        -H "Authorization: Bearer $TOKEN" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"$method\",\"params\":$params,\"id\":1}" \
        "$URL"
}

# Einen Wert aus einer JSON-Antwort ziehen (python3, kein jq-Zwang).
jget() { python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
cur=d
for k in sys.argv[1:]:
    if isinstance(cur,list):
        cur=cur[int(k)] if len(cur)>int(k) else None
    elif isinstance(cur,dict):
        cur=cur.get(k)
    else:
        cur=None
    if cur is None: break
print(cur if cur is not None else "")' "$@"; }

# ── Host + SNMP-Interface finden ─────────────────────────────────────────────
# Erst ueber die IP der SNMP-Schnittstelle, sonst ueber den Hostnamen.
IFRESP="$(api hostinterface.get "{\"output\":[\"interfaceid\",\"hostid\"],\"filter\":{\"ip\":[\"$TARGET\"],\"type\":[2]}}")"
IFID="$(printf '%s' "$IFRESP" | jget result 0 interfaceid)"
HID="$(printf '%s' "$IFRESP" | jget result 0 hostid)"

if [[ -z "$HID" ]]; then
    HRESP="$(api host.get "{\"output\":[\"hostid\"],\"filter\":{\"host\":[\"$TARGET\"]},\"selectInterfaces\":[\"interfaceid\",\"type\"]}")"
    HID="$(printf '%s' "$HRESP" | jget result 0 hostid)"
    # erste SNMP-Schnittstelle (type 2)
    IFID="$(printf '%s' "$HRESP" | python3 -c 'import sys,json
d=json.load(sys.stdin); r=d.get("result") or []
if r:
  for i in r[0].get("interfaces",[]):
    if str(i.get("type"))=="2": print(i.get("interfaceid")); break' )"
fi

if [[ -z "$HID" ]]; then
    echo "${C_ERR}x${C_RST} Host for '$TARGET' not found (by SNMP-interface IP or hostname)." >&2
    echo "${C_DIM}  API said:${C_RST} $(printf '%s' "$IFRESP" | head -c 300)" >&2
    exit 2
fi
[[ -n "$IFID" ]] || { echo "${C_ERR}x${C_RST} Host $HID has no SNMP interface (type 2)." >&2; exit 2; }
echo "  ${C_OK}v${C_RST} host $HID, SNMP interface $IFID"

# ── Die vier Items ───────────────────────────────────────────────────────────
# key -> "Name|walk-OID"
names=("nt.fdb.dot1d|NT FDB dot1d|walk[1.3.6.1.2.1.17.4.3.1.2]"
       "nt.fdb.dot1q|NT FDB dot1q|walk[1.3.6.1.2.1.17.7.1.2.2.1.2]"
       "nt.fdb.baseport|NT bridge-port to ifIndex|walk[1.3.6.1.2.1.17.1.4.1.2]"
       "nt.fdb.ifname|NT ifName|walk[1.3.6.1.2.1.31.1.1.1.1]")

created=0 skipped=0 failed=0
for spec in "${names[@]}"; do
    key="${spec%%|*}"; rest="${spec#*|}"; name="${rest%%|*}"; oid="${rest#*|}"
    # Existiert der Key schon auf dem Host?
    EX="$(api item.get "{\"output\":[\"itemid\"],\"hostids\":[\"$HID\"],\"filter\":{\"key_\":[\"$key\"]}}")"
    if [[ -n "$(printf '%s' "$EX" | jget result 0 itemid)" ]]; then
        echo "  ${C_DIM}-${C_RST} $key already exists — skipped."
        skipped=$((skipped+1)); continue
    fi
    # type 20 = SNMP agent, value_type 4 = text, delay 3m, history 1d, trends 0.
    CR="$(api item.create "{\"name\":\"$name\",\"key_\":\"$key\",\"hostid\":\"$HID\",\"type\":20,\"snmp_oid\":\"$oid\",\"interfaceid\":\"$IFID\",\"value_type\":4,\"delay\":\"3m\",\"history\":\"1d\",\"trends\":\"0\"}")"
    if [[ -n "$(printf '%s' "$CR" | jget result itemids 0)" ]]; then
        echo "  ${C_OK}v${C_RST} created $key"
        created=$((created+1))
    else
        echo "  ${C_ERR}x${C_RST} $key failed: $(printf '%s' "$CR" | jget error data)"
        failed=$((failed+1))
    fi
done

echo
echo "  ${C_DIM}created $created, skipped $skipped, failed $failed.${C_RST}"
echo "  ${C_DIM}Collection starts within one interval (~3 min); then search a MAC in the module (the 🔎 MAC button).${C_RST}"
[[ "$failed" -eq 0 ]]
