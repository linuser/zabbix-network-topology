#!/usr/bin/env bash
#
# nt-lldp-probe.sh — beantwortet die eine Frage, an der die Kanten haengen:
# gibt DIESES Geraet seine LLDP-Nachbartabelle ueber SNMP heraus?
#
# Aufruf:
#   NT_COMMUNITY=<community> tools/nt-lldp-probe.sh <ip>
#   tools/nt-lldp-probe.sh <ip>            (fragt die Community interaktiv ab)
#
# WARUM DIESES SKRIPT
# -------------------
# Der nackte Walk steht in LLDP-SETUP.md und ist eine Zeile lang. Das Problem
# ist nicht der Aufruf, sondern die leere Antwort: sie kann DREI voellig
# verschiedene Dinge heissen, und die Verwechslung kostet Nachmittage.
#
#   sysDescr leer            Geraet nicht erreichbar oder Community falsch.
#                            Mit LLDP hat das nichts zu tun.
#   sysDescr da, LLDP leer   Das Geraet antwortet, aber die SNMP-VIEW gibt die
#                            LLDP-MIB nicht her. Sieht exakt aus wie "kann kein
#                            LLDP" und ist doch nur eine Zeile Konfiguration.
#                            Genau das ist einem Melder auf Huawei-Switches
#                            passiert (Issue #2).
#   LLDP-MIB da, remote leer LLDP laeuft nicht oder hat noch keinen Nachbarn
#                            gesehen (Kabel, Nachbar sendet nicht).
#
# Deshalb drei Abfragen statt einer.
#
# WAS ES AUSGIBT — UND WAS NICHT
# ------------------------------
# Am Ende steht ein fertiger Markdown-Block fuer eine Rueckmeldung. Er enthaelt
# ZAHLEN, keine Nachbarnamen, und die Community taucht nirgends auf. Wer den
# Block weitergibt, muss also nichts schwaerzen — es steht gar nicht erst drin.
# Die einzige Zeile, die vom Geraet kommt und Text traegt, ist sysDescr
# (Hersteller/Modell/Firmware); sie ist genau deshalb einzeln markiert.
#
# Das Skript sendet NICHTS irgendwohin. Der einzige Netzverkehr geht an die IP,
# die der Aufrufer uebergeben hat. Was mit dem Block passiert, entscheidet ein
# Mensch, nachdem er ihn gelesen hat.
#
# Liegt in tools/ und ist damit aus dem Modul-Paket ausgeschlossen (deploy.sh,
# bewacht von tools/check-package.mjs): ein Shell-Skript gehoert nicht unter
# den Web-Root.

set -uo pipefail

readonly OID_SYSDESCR='1.3.6.1.2.1.1.1.0'
readonly OID_LLDP_LOC='1.0.8802.1.1.2.1.3.3.0'        # lldpLocSysName
readonly OID_LLDP_REM='1.0.8802.1.1.2.1.4.1.1.9'      # lldpRemSysName
readonly OID_CDP_REM='1.3.6.1.4.1.9.9.23.1.2.1.1.6'   # cdpCacheDeviceId

if [[ -t 1 ]]; then C_OK=$'\e[32m'; C_ERR=$'\e[31m'; C_WARN=$'\e[33m'; C_DIM=$'\e[2m'; C_RST=$'\e[0m'
else C_OK=""; C_ERR=""; C_WARN=""; C_DIM=""; C_RST=""; fi

usage() {
    sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

[[ $# -ge 1 ]] || usage 1
case "$1" in -h|--help|help) usage 0 ;; esac

readonly IP="$1"
command -v snmpwalk >/dev/null 2>&1 || {
    echo "${C_ERR}snmpwalk not found.${C_RST} Install net-snmp:" >&2
    echo "  Debian/Ubuntu: sudo apt install snmp   RHEL: sudo dnf install net-snmp-utils" >&2
    exit 1
}

# Community NICHT als Argument: Argumente stehen in der Shell-History und sind
# fuer jeden sichtbar, der auf der Maschine 'ps' aufrufen kann. Deshalb per
# Umgebungsvariable oder interaktiv ohne Echo.
COMMUNITY="${NT_COMMUNITY:-}"
if [[ -z "$COMMUNITY" ]]; then
    if [[ -t 0 ]]; then
        read -rsp "SNMP community for $IP (input stays hidden): " COMMUNITY
        echo
    else
        echo "${C_ERR}No community given.${C_RST} Set NT_COMMUNITY=<community>." >&2
        exit 1
    fi
fi
[[ -n "$COMMUNITY" ]] || { echo "${C_ERR}Community is empty.${C_RST}" >&2; exit 1; }

# Ein Walk. Gibt die Zeilen aus; Rueckgabewert 0 auch bei leerer Antwort, denn
# "leer" ist hier ein Ergebnis und kein Fehler.
walk() {
    snmpwalk -v2c -c "$COMMUNITY" -t 3 -r 1 -Ov -Oq "$IP" "$1" 2>/dev/null \
        | grep -v -e '^No Such' -e '^End of MIB' -e '^$' || true
}

count() { printf '%s' "${1}" | grep -c . || true; }

echo
echo "${C_DIM}Probing $IP -- three queries, read-only.${C_RST}"

SYSDESCR="$(walk "$OID_SYSDESCR" | head -1)"
if [[ -z "$SYSDESCR" ]]; then
    echo
    echo "  ${C_ERR}x${C_RST} No answer to sysDescr."
    echo
    echo "  This is ${C_WARN}not an LLDP finding${C_RST}: the device is unreachable, SNMP is"
    echo "  off, the community is wrong, or a firewall blocks UDP/161."
    echo "  Before looking any further, this line has to return text:"
    echo "      snmpwalk -v2c -c <community> $IP $OID_SYSDESCR"
    exit 2
fi
echo "  ${C_OK}v${C_RST} Device answers."

LOC="$(walk "$OID_LLDP_LOC")"
REM="$(walk "$OID_LLDP_REM")"
CDP="$(walk "$OID_CDP_REM")"
n_rem="$(count "$REM")"
n_cdp="$(count "$CDP")"

# ── Befund ───────────────────────────────────────────────────────────────
if [[ "$n_rem" -gt 0 ]]; then
    verdict="works"
    snmp_col="ok"
    echo "  ${C_OK}v${C_RST} LLDP neighbour table: $n_rem entry/entries."
    hint="Device side is done. If edges are still missing it is Zabbix (template linked? discovery run?) or name resolution -- see the LLDP-Q tab."
elif [[ -n "$LOC" ]]; then
    verdict="no neighbours yet"
    snmp_col="mib ok, table empty"
    echo "  ${C_WARN}!${C_RST} LLDP MIB is there, but ${C_WARN}no neighbour${C_RST} in the table."
    hint="The MIB is visible, the table empty: LLDP is not active on this port or device, the neighbour does not send, or it was only just switched on (neighbours take up to 30 s)."
else
    verdict="MIB not visible"
    snmp_col="hidden by SNMP view"
    echo "  ${C_ERR}x${C_RST} Device answers, but the ${C_ERR}LLDP MIB is not visible${C_RST}."
    hint="The device answers sysDescr but does not hand out the LLDP MIB -- typically a restricted SNMP view. On Huawei VRP: 'snmp-agent mib-view include iso-view iso' and 'snmp-agent community read <community> mib-view iso-view'. Other vendors: widen the view accordingly."
fi
[[ "$n_cdp" -gt 0 ]] && echo "  ${C_DIM}i${C_RST} plus $n_cdp CDP neighbour(s) (Cisco proprietary)."

echo
echo "${C_DIM}--- copy from here ------------------------------------------${C_RST}"
echo
cat <<REPORT
### <vendor> <model>, firmware <version>

| Question | Result |
|---|---|
| Device answers SNMP | yes |
| LLDP MIB visible | $([[ -n "$LOC" || "$n_rem" -gt 0 ]] && echo yes || echo "**no -- SNMP view**") |
| Neighbours in \`lldpRemSysName\` | $n_rem |
| CDP neighbours | $n_cdp |
| Verdict | **$verdict** ($snmp_col) |

sysDescr (straight from the device -- please read it before posting):

    $SYSDESCR

Still to fill in -- these come from the module, not from SNMP:

| Question | Answer |
|---|---|
| Items came from | vendor template / nt_lldp_snmp_template.yaml / own items |
| Needed on the device | just 'lldp enable' / plus SNMP view widened / separate community / nothing |
| LLDP-Q for one host | matched ... / unmatched ... / ambiguous ... |
| Edges on the map | yes / no |
REPORT
echo
echo "${C_DIM}-------------------------------------------------------------${C_RST}"
echo
printf '%s\n' "$hint" | fold -s -w 74 | sed 's/^/  /'
echo
echo "  ${C_DIM}The block holds counts, no neighbour names, no community string."
echo "  This script sends nothing anywhere -- what happens to it is your call.${C_RST}"
echo
