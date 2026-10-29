#!/usr/bin/env bash
#
# nt-vlan-probe.sh — beantwortet die eine Frage, an der die VLAN-Ansicht haengt:
# gibt DIESER Switch seine 802.1Q-VLAN-Tabellen ueber SNMP heraus — und laesst
# sich die Port-Bitmaske auf echte Interfaces aufloesen?
#
# Aufruf:
#   NT_COMMUNITY=<community> tools/nt-vlan-probe.sh <ip>
#   tools/nt-vlan-probe.sh <ip>          (fragt die Community interaktiv ab)
#
# WARUM DIESES SKRIPT
# -------------------
# Die VLAN-Ansicht (VLAN waehlen -> nur Geraete/Links zeigen, auf denen es
# vorkommt) ist die staerkste Erweiterung der Karte und die teuerste. VLAN kommt
# im Modul bisher NIRGENDS vor: LLDP traegt keine VLAN-Mitgliedschaft. Belastbar
# waere allein die Q-BRIDGE-MIB — aber ob ein Switch sie fuellt und in welcher
# Form, variiert stark nach Hersteller. Bevor ein Template, eine Discovery und
# ein Bitmasken-Parser gebaut werden, klaert dieses Skript an echter Hardware,
# ob die Daten ueberhaupt da sind. Ein Nachmittag statt eines Releases.
#
# Vier Dinge muessen stimmen, und eine leere Antwort kann jedes davon heissen:
#
#   dot1qVlanStaticName           VLAN-ID -> Name. Beweist, dass VLANs ueberhaupt
#                                 sichtbar sind (Zahl = Anzahl benannter VLANs).
#   dot1qVlanStaticEgressPorts    je VLAN die Mitglieds-Ports als BITMASKE. Der
#   dot1qVlanCurrentEgressPorts   statische bzw. der aktuelle (betriebliche)
#                                 Stand. Mindestens einer muss gefuellt sein,
#                                 sonst weiss man zwar, DASS es ein VLAN gibt,
#                                 aber nicht, auf welchen Ports.
#   dot1dBasePortIfIndex          Bridge-Port -> ifIndex. Die Egress-Bitmaske
#                                 adressiert BRIDGE-PORTS, nicht ifIndizes —
#                                 ohne diese Tabelle ist die Maske nicht auf ein
#                                 Interface abbildbar. Derselbe zweite Schritt,
#                                 der bei der FDB gern vergessen wird.
#
# dot1qPvid (Port -> Access-VLAN) wird als Beigabe mitgezaehlt: fuer Access-Ports
# oft aussagekraeftiger als die Egress-Maske.
#
# WAS ES AUSGIBT — UND WAS NICHT
# ------------------------------
# Am Ende steht ein fertiger Markdown-Block fuer eine Rueckmeldung. Er enthaelt
# ausschliesslich ZAHLEN und die sysDescr-Zeile — KEINE VLAN-Namen. Das ist hier
# besonders wichtig: VLAN-Namen tragen oft Kundennamen ("VLAN_ACME_VOICE") oder
# Standorte. Sie tauchen nirgends in der Ausgabe auf, es wird nur gezaehlt. Die
# Egress-Maske IST kein Kundendatum (ein Port-Bitfeld), deshalb wird EINE als
# Laengenbeispiel gezeigt — als Hex, damit der Bitmasken-Aufwand sichtbar wird.
# Die Community erscheint nie.
#
# Das Skript sendet NICHTS irgendwohin. Der einzige Netzverkehr geht an die IP,
# die der Aufrufer uebergeben hat.
#
# Liegt in tools/ und ist damit aus dem Modul-Paket ausgeschlossen (deploy.sh,
# bewacht von tools/check-package.mjs): ein Shell-Skript gehoert nicht unter
# den Web-Root.

set -uo pipefail

readonly OID_SYSDESCR='1.3.6.1.2.1.1.1.0'
readonly OID_VLAN_NAME='1.3.6.1.2.1.17.7.1.4.3.1.1'   # dot1qVlanStaticName (VLAN -> Name)
readonly OID_VLAN_SEGRESS='1.3.6.1.2.1.17.7.1.4.3.1.2' # dot1qVlanStaticEgressPorts (Bitmaske)
readonly OID_VLAN_CEGRESS='1.3.6.1.2.1.17.7.1.4.2.1.4' # dot1qVlanCurrentEgressPorts (Bitmaske, +TimeMark)
readonly OID_VLAN_PVID='1.3.6.1.2.1.17.7.1.4.5.1.1'    # dot1qPvid (Port -> Access-VLAN)
readonly OID_DOT1D_IFX='1.3.6.1.2.1.17.1.4.1.2'        # dot1dBasePortIfIndex (Bridge-Port -> ifIndex)
readonly OID_IFNAME='1.3.6.1.2.1.31.1.1.1.1'           # ifName (ifIndex -> Portname)

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
# fuer jeden sichtbar, der 'ps' aufrufen kann. Deshalb per Umgebungsvariable
# oder interaktiv ohne Echo.
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
# "leer" ist hier ein Ergebnis und kein Fehler. -Oq unterdrueckt die OID-Namen.
# Fuer die Tabellen zaehlen wir Zeilen, nicht Werte, um KEINE VLAN-Namen oder
# -Indizes auszugeben.
walk_count() {
    snmpwalk -v2c -c "$COMMUNITY" -t 3 -r 1 -Oq "$IP" "$1" 2>/dev/null \
        | grep -v -e 'No Such' -e 'End of MIB' -e '^$' | grep -c . || true
}
walk_val() {
    snmpwalk -v2c -c "$COMMUNITY" -t 3 -r 1 -Ov -Oq "$IP" "$1" 2>/dev/null \
        | grep -v -e '^No Such' -e '^End of MIB' -e '^$' || true
}

echo
echo "${C_DIM}Probing $IP -- read-only, counts only (no VLAN names printed).${C_RST}"

SYSDESCR="$(walk_val "$OID_SYSDESCR" | head -1)"
if [[ -z "$SYSDESCR" ]]; then
    echo
    echo "  ${C_ERR}x${C_RST} No answer to sysDescr."
    echo
    echo "  This is ${C_WARN}not a VLAN finding${C_RST}: the device is unreachable, SNMP is"
    echo "  off, the community is wrong, or a firewall blocks UDP/161."
    echo "      snmpwalk -v2c -c <community> $IP $OID_SYSDESCR"
    exit 2
fi
echo "  ${C_OK}v${C_RST} Device answers."

n_name="$(walk_count "$OID_VLAN_NAME")"
n_se="$(walk_count "$OID_VLAN_SEGRESS")"
n_ce="$(walk_count "$OID_VLAN_CEGRESS")"
n_pv="$(walk_count "$OID_VLAN_PVID")"
n_ix="$(walk_count "$OID_DOT1D_IFX")"
n_if="$(walk_count "$OID_IFNAME")"

# Ein Egress-Wert als Laengenbeispiel: nur die HEX-Bytes zaehlen (Port-Bitfeld,
# kein Kundendatum). Erst die statische, sonst die aktuelle Tabelle. 1 Byte = 8
# adressierbare Ports -- zeigt, wie breit die Maske gegen ifIndex aufzuloesen ist.
sample="$(walk_val "$OID_VLAN_SEGRESS" | head -1)"
[[ -z "$sample" ]] && sample="$(walk_val "$OID_VLAN_CEGRESS" | head -1)"
mask_bytes=0
if [[ -n "$sample" ]]; then
    hex="${sample//[^0-9A-Fa-f]/}"
    mask_bytes=$(( ${#hex} / 2 ))
fi

# line <count> <ok-glyph> <ok-msg> <bad-glyph> <bad-msg> — echtes if/then/else,
# nicht A && B || C (dort liefe C auch, wenn B fehlschluege; shellcheck SC2015).
line() { if [[ "$1" -gt 0 ]]; then echo "  $2 $3"; else echo "  $4 $5"; fi; }
line "$n_name" "${C_OK}v${C_RST}" "VLAN names (dot1qVlanStaticName): $n_name VLAN(s)." \
               "${C_DIM}-${C_RST}" "VLAN names (dot1qVlanStaticName): empty."
line "$n_se" "${C_OK}v${C_RST}" "Static egress bitmask (dot1qVlanStaticEgressPorts): $n_se." \
             "${C_DIM}-${C_RST}" "Static egress bitmask (dot1qVlanStaticEgressPorts): empty."
line "$n_ce" "${C_OK}v${C_RST}" "Current egress bitmask (dot1qVlanCurrentEgressPorts): $n_ce." \
             "${C_DIM}-${C_RST}" "Current egress bitmask (dot1qVlanCurrentEgressPorts): empty."
line "$n_pv" "${C_OK}v${C_RST}" "Port PVID (dot1qPvid): $n_pv port(s)." \
             "${C_WARN}!${C_RST}" "Port PVID (dot1qPvid): empty -- access-port VLAN unknown."
line "$n_ix" "${C_OK}v${C_RST}" "Bridge-Port -> ifIndex (dot1dBasePortIfIndex): $n_ix." \
             "${C_ERR}x${C_RST}" "Bridge-Port -> ifIndex: EMPTY -- egress mask unresolvable."
line "$n_if" "${C_OK}v${C_RST}" "ifName: $n_if (port names available)." \
             "${C_WARN}!${C_RST}" "ifName: empty -- ports would show as ifIndex numbers."
if [[ "$mask_bytes" -gt 0 ]]; then
    echo "  ${C_DIM}i${C_RST} Egress mask is $mask_bytes byte(s) wide = up to $(( mask_bytes * 8 )) addressable ports."
fi

# ── Verdict ──────────────────────────────────────────────────────────────────
if [[ "$n_name" -eq 0 && "$n_se" -eq 0 && "$n_ce" -eq 0 ]]; then
    verdict="no Q-BRIDGE VLAN data visible"
    hint="The device answers but hands out no 802.1Q VLAN table. Either a restricted SNMP view (widen it to include the Q-BRIDGE-MIB, 1.3.6.1.2.1.17.7) or the switch is not VLAN-aware over SNMP. Some vendors expose VLANs only through a private MIB -- note the sysDescr so we can check."
elif [[ "$n_se" -eq 0 && "$n_ce" -eq 0 ]]; then
    verdict="VLAN names only -- no port membership"
    hint="We would know WHICH VLANs exist but not on which ports. Without an egress bitmask the view cannot be drawn. Check whether the SNMP view covers dot1qVlanStaticEgressPorts / dot1qVlanCurrentEgressPorts."
elif [[ "$n_ix" -eq 0 ]]; then
    verdict="VLAN membership present, but bridge-port -> ifIndex MISSING"
    hint="The egress mask lists BRIDGE-PORT positions, not ifIndex. Without dot1dBasePortIfIndex it cannot be turned into a real interface. Check whether the SNMP view includes 1.3.6.1.2.1.17.1.4."
else
    verdict="Q-BRIDGE VLAN usable"
    hint="VLAN names + egress bitmask + bridge-port->ifIndex are all there. The VLAN view is feasible on this switch. Next: confirm the mask bit order (port 1 = MSB of byte 0 per 802.1Q) against ifName on a VLAN with known members."
fi
echo
echo "  ${C_DIM}Verdict:${C_RST} $verdict"

echo
echo "${C_DIM}--- copy from here ------------------------------------------${C_RST}"
echo
cat <<REPORT
### <vendor> <model>, firmware <version>

| Question | Result |
|---|---|
| Device answers SNMP | yes |
| VLAN names (dot1qVlanStaticName) | $n_name |
| Static egress bitmask (dot1qVlanStaticEgressPorts) | $n_se |
| Current egress bitmask (dot1qVlanCurrentEgressPorts) | $n_ce |
| Port PVID (dot1qPvid) | $n_pv |
| Bridge-port -> ifIndex (dot1dBasePortIfIndex) | $n_ix |
| ifName (port names) | $n_if |
| Egress mask width (bytes) | $mask_bytes |
| Verdict | **$verdict** |

sysDescr (straight from the device -- please read it before posting):

    $SYSDESCR
REPORT
echo
echo "${C_DIM}-------------------------------------------------------------${C_RST}"
echo "  ${C_DIM}Note:${C_RST} $hint"
echo
