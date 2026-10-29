#!/usr/bin/env bash
#
# nt-poe-probe.sh — beantwortet die PoE-Frage: was gibt DIESER Switch ueber die
# Standard-POWER-ETHERNET-MIB (RFC 3621) her — Erkennung und Klasse je Port, und
# das Leistungsbudget des Switches — und wo faengt das Herstellerspezifische an?
#
# Aufruf:
#   NT_COMMUNITY=<community> tools/nt-poe-probe.sh <ip>
#   tools/nt-poe-probe.sh <ip>          (fragt die Community interaktiv ab)
#
# WARUM DIESES SKRIPT
# -------------------
# Das Faceplate zeigt heute schon, WELCHE Ports Strom liefern (der Blitz, aus
# pethPsePortDetectionStatus). Zwei PoE-Erweiterungen stehen auf der ROADMAP,
# und beide haengen daran, was die Hardware hergibt:
#
#   PoE je Port        Wattzahl/Klasse pro Port. Die KLASSE
#                      (pethPsePortPowerClassifications) ist Standard; die
#                      tatsaechlichen WATT pro Port sind meist herstellerspezifisch
#                      (Cisco cpeExtPsePortPwrConsumption .1.3.6.1.4.1.9.9.402.1.2.1.7
#                      und aehnliche) — die klaert nur ein echtes Geraet.
#   PoE-Budget         verbraucht gegen verfuegbar: pethMainPseConsumptionPower
#                      gegen pethMainPsePower. Beides Standard und direkt lesbar —
#                      der guenstigere der beiden Punkte.
#
# Dieses Skript misst den Standard-Teil und zeigt, ob das Budget da ist. Fuer
# Watt-pro-Port sagt es, in welche Vendor-MIB zu schauen waere.
#
# WAS ES AUSGIBT — UND WAS NICHT
# ------------------------------
# Ein fertiger Markdown-Block fuer eine Rueckmeldung: Zaehlwerte, die
# Budget-WATT (Gesamtleistung des Switches, KEIN Kundendatum) und die
# sysDescr-Zeile. Keine Portnamen, keine MACs, keine Community.
#
# Das Skript sendet NICHTS irgendwohin. Der einzige Netzverkehr geht an die IP,
# die der Aufrufer uebergeben hat.
#
# Liegt in tools/ und ist damit aus dem Modul-Paket ausgeschlossen (deploy.sh,
# bewacht von tools/check-package.mjs): ein Shell-Skript gehoert nicht unter
# den Web-Root.

set -uo pipefail

readonly OID_SYSDESCR='1.3.6.1.2.1.1.1.0'
readonly OID_PETH_DET='1.3.6.1.2.1.105.1.1.1.6'    # pethPsePortDetectionStatus (3=deliveringPower)
readonly OID_PETH_CLASS='1.3.6.1.2.1.105.1.1.1.7'  # pethPsePortPowerClassifications (class0..4)
readonly OID_PETH_NOM='1.3.6.1.2.1.105.1.3.1.2'    # pethMainPsePower (nominal, Watt)
readonly OID_PETH_USE='1.3.6.1.2.1.105.1.3.1.4'    # pethMainPseConsumptionPower (verbraucht, Watt)

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

# "leer" ist ein Ergebnis, kein Fehler. walk_count zaehlt Zeilen; walk_val
# liefert reine Werte; walk_num summiert numerische Werte (fuer das Budget, das
# bei gestackten Switches pro PSE eine Zeile hat).
walk_count() {
    snmpwalk -v2c -c "$COMMUNITY" -t 3 -r 1 -Oq "$IP" "$1" 2>/dev/null \
        | grep -v -e 'No Such' -e 'End of MIB' -e '^$' | grep -c . || true
}
walk_val() {
    snmpwalk -v2c -c "$COMMUNITY" -t 3 -r 1 -Ov -Oq -Oe "$IP" "$1" 2>/dev/null \
        | grep -v -e '^No Such' -e '^End of MIB' -e '^$' || true
}
walk_num() {
    walk_val "$1" | awk 'NF{s+=($1+0)} END{printf "%d", s+0}'
}

echo
echo "${C_DIM}Probing $IP -- read-only, standard POWER-ETHERNET-MIB (no port names, no MACs).${C_RST}"

SYSDESCR="$(snmpwalk -v2c -c "$COMMUNITY" -t 3 -r 1 -Ov -Oq "$IP" "$OID_SYSDESCR" 2>/dev/null \
    | grep -v -e '^No Such' -e '^End of MIB' -e '^$' | head -1)"
if [[ -z "$SYSDESCR" ]]; then
    echo
    echo "  ${C_ERR}x${C_RST} No answer to sysDescr."
    echo
    echo "  This is ${C_WARN}not a PoE finding${C_RST}: the device is unreachable, SNMP is"
    echo "  off, the community is wrong, or a firewall blocks UDP/161."
    echo "      snmpwalk -v2c -c <community> $IP $OID_SYSDESCR"
    exit 2
fi
echo "  ${C_OK}v${C_RST} Device answers."

# Jede OID nur EINMAL walken, dann daraus zaehlen/summieren.
det="$(walk_val "$OID_PETH_DET")"
n_det="$(printf '%s' "$det" | grep -c . || true)"
n_deliver="$(printf '%s' "$det" | grep -c '^3$' || true)"
n_class="$(walk_count "$OID_PETH_CLASS")"
nom="$(walk_val "$OID_PETH_NOM")"              # nominale Leistung je PSE
n_pse="$(printf '%s' "$nom" | grep -c . || true)"     # Anzahl PSE-Einheiten
budget_nom="$(printf '%s' "$nom" | awk 'NF{s+=($1+0)} END{printf "%d", s+0}')"
budget_use="$(walk_num "$OID_PETH_USE")"

# line <count> <ok-glyph> <ok-msg> <bad-glyph> <bad-msg> — echtes if/then/else,
# nicht A && B || C (dort liefe C auch, wenn B fehlschluege; shellcheck SC2015).
line() { if [[ "$1" -gt 0 ]]; then echo "  $2 $3"; else echo "  $4 $5"; fi; }
line "$n_det" "${C_OK}v${C_RST}" "Per-port detection (pethPsePortDetectionStatus): $n_det port(s), $n_deliver delivering." \
              "${C_DIM}-${C_RST}" "Per-port detection (pethPsePortDetectionStatus): empty -- no standard PoE MIB."
line "$n_class" "${C_OK}v${C_RST}" "Per-port class (pethPsePortPowerClassifications): $n_class port(s)." \
                "${C_WARN}!${C_RST}" "Per-port class: empty -- no class-based per-port tier."
if [[ "$n_pse" -gt 0 ]]; then
    echo "  ${C_OK}v${C_RST} Switch budget (pethMainPse*): ${budget_use} W used / ${budget_nom} W nominal, over $n_pse PSE unit(s)."
else
    echo "  ${C_WARN}!${C_RST} Switch budget (pethMainPsePower / ...ConsumptionPower): empty."
fi

# ── Verdict ──────────────────────────────────────────────────────────────────
if [[ "$n_det" -eq 0 ]]; then
    verdict="no standard PoE data visible"
    hint="The device answers but hands out no POWER-ETHERNET-MIB (1.3.6.1.2.1.105). Either it is not a PoE switch, the SNMP view is restricted, or PoE is exposed only through a vendor MIB. Note the sysDescr so we can tell which vendor tree to try."
elif [[ "$n_pse" -gt 0 ]]; then
    verdict="standard PoE usable, incl. switch budget"
    hint="Per-port detection + class and the switch-level budget are all there. 'PoE-Budget je Switch' can be built from this directly. Per-port WATTS are still vendor-specific (e.g. Cisco cpeExtPsePortPwrConsumption); class gives a tier (0..4) in the meantime."
else
    verdict="standard PoE per-port present, but no switch budget"
    hint="pethPsePortDetectionStatus/Classifications are there, but pethMainPse* (budget) is empty on this device. The per-port tier works via class; the total used/available W would need a vendor MIB here. Note the sysDescr."
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
| Per-port detection (pethPsePortDetectionStatus) | $n_det ($n_deliver delivering) |
| Per-port class (pethPsePortPowerClassifications) | $n_class |
| PSE units (pethMainPse*) | $n_pse |
| Switch budget used / nominal (W) | $budget_use / $budget_nom |
| Verdict | **$verdict** |

sysDescr (straight from the device -- please read it before posting):

    $SYSDESCR
REPORT
echo
echo "${C_DIM}-------------------------------------------------------------${C_RST}"
echo "  ${C_DIM}Note:${C_RST} $hint"
echo
