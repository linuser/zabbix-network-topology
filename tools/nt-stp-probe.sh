#!/usr/bin/env bash
#
# nt-stp-probe.sh — beantwortet die eine Frage, an der die Spanning-Tree-Ansicht
# haengt: gibt DIESER Switch seinen STP-Portzustand (forwarding/blocking) ueber
# SNMP heraus — und laesst sich der Bridge-Port auf einen ifIndex aufloesen?
#
# Aufruf:
#   NT_COMMUNITY=<community> tools/nt-stp-probe.sh <ip>
#   tools/nt-stp-probe.sh <ip>          (fragt die Community interaktiv ab)
#
# WARUM DIESES SKRIPT
# -------------------
# Die Karte zeichnet die PHYSISCHE Nachbarschaft aus LLDP/CDP, nicht den
# Weiterleitungszustand. Ein per STP GEBLOCKTER Redundanzlink sieht deshalb aus
# wie eine aktive Kante: LLDP laeuft auch ueber einen blocking-Port, und
# ifOperStatus meldet ihn weiter als "up". Zwei Switches mit zwei Kabeln und
# aktivem Spanning-Tree erscheinen so als zwei aktive Pfade, obwohl einer blockt.
#
# Um das zu markieren (geblockte Kante dimmen/stricheln), braucht es den echten
# Portzustand aus der BRIDGE-MIB. Ob ein Switch ihn hergibt und in welcher Form,
# variiert stark — und bei MSTP/PVST steht er oft nur je VLAN-Instanz, teils nur
# ueber eine VLAN-Kontext-Community (Cisco: community@vlan). Bevor dafuer etwas
# gebaut wird, klaert dieses Skript an echter Hardware, ob die Daten da sind.
# Ein Nachmittag statt eines Releases.
#
# Drei Dinge muessen stimmen, und eine leere Antwort kann jedes davon heissen:
#
#   dot1dStpProtocolSpec   laeuft ueberhaupt 802.1D-STP auf dem Geraet?
#   dot1dStpPortState      je Bridge-Port der Zustand: forwarding(5), blocking(2),
#                          listening(3), learning(4), disabled(1), broken(6).
#                          Der blocking-Port ist der interessante Fall.
#   dot1dBasePortIfIndex   Bridge-Port -> ifIndex. Der Zustand haengt an einer
#                          BRIDGE-Port-Nummer, nicht an einem ifIndex — ohne
#                          diese Tabelle ist er keiner Kante zuzuordnen. Derselbe
#                          zweite Schritt, der bei FDB und VLAN gern vergessen wird.
#
# WAS ES AUSGIBT — UND WAS NICHT
# ------------------------------
# Am Ende steht ein fertiger Markdown-Block fuer eine Rueckmeldung. Er enthaelt
# ausschliesslich ZAHLEN (Zustands-Verteilung) und die sysDescr-Zeile — keine
# MACs, keine Portnamen, keine Community. STP-Zustaende sind kein Kundendatum,
# trotzdem bleibt die Ausgabe bei Zaehlwerten, damit der Block ohne Schwaerzen
# weitergegeben werden kann.
#
# Das Skript sendet NICHTS irgendwohin. Der einzige Netzverkehr geht an die IP,
# die der Aufrufer uebergeben hat.
#
# Liegt in tools/ und ist damit aus dem Modul-Paket ausgeschlossen (deploy.sh,
# bewacht von tools/check-package.mjs): ein Shell-Skript gehoert nicht unter
# den Web-Root.

set -uo pipefail

readonly OID_SYSDESCR='1.3.6.1.2.1.1.1.0'
readonly OID_STP_SPEC='1.3.6.1.2.1.17.2.1.0'      # dot1dStpProtocolSpecification (1=unknown,2=decLb100,3=ieee8021d)
readonly OID_STP_STATE='1.3.6.1.2.1.17.2.15.1.3'  # dot1dStpPortState (Bridge-Port -> Zustand)
readonly OID_STP_DESIG_BR='1.3.6.1.2.1.17.2.15.1.8' # dot1dStpPortDesignatedBridge (Bridge-ID am anderen Ende)
readonly OID_STP_DESIG_PT='1.3.6.1.2.1.17.2.15.1.9' # dot1dStpPortDesignatedPort (Port-ID am anderen Ende)
readonly OID_BASE_BRIDGE='1.3.6.1.2.1.17.1.1.0'   # dot1dBaseBridgeAddress (eigene Bridge-MAC)
readonly OID_DOT1D_IFX='1.3.6.1.2.1.17.1.4.1.2'   # dot1dBasePortIfIndex (Bridge-Port -> ifIndex)
readonly OID_IFNAME='1.3.6.1.2.1.31.1.1.1.1'      # ifName (ifIndex -> Portname)

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

# Ein Walk. "leer" ist hier ein Ergebnis, kein Fehler. Fuer die Tabellen zaehlen
# wir Zeilen (walk_count); walk_val liefert reine Werte; walk_state zusaetzlich
# -Oe, damit ein Zustand als ZAHL kommt (5 statt "forwarding(5)") und exakt
# gezaehlt werden kann, egal ob MIBs geladen sind.
walk_count() {
    snmpwalk -v2c -c "$COMMUNITY" -t 3 -r 1 -Oq "$IP" "$1" 2>/dev/null \
        | grep -v -e 'No Such' -e 'End of MIB' -e '^$' | grep -c . || true
}
walk_val() {
    snmpwalk -v2c -c "$COMMUNITY" -t 3 -r 1 -Ov -Oq "$IP" "$1" 2>/dev/null \
        | grep -v -e '^No Such' -e '^End of MIB' -e '^$' || true
}
walk_state() {
    snmpwalk -v2c -c "$COMMUNITY" -t 3 -r 1 -Ov -Oq -Oe "$IP" "$1" 2>/dev/null \
        | grep -v -e '^No Such' -e '^End of MIB' -e '^$' || true
}

echo
echo "${C_DIM}Probing $IP -- read-only, counts only (no port names, no MACs).${C_RST}"

SYSDESCR="$(walk_val "$OID_SYSDESCR" | head -1)"
if [[ -z "$SYSDESCR" ]]; then
    echo
    echo "  ${C_ERR}x${C_RST} No answer to sysDescr."
    echo
    echo "  This is ${C_WARN}not an STP finding${C_RST}: the device is unreachable, SNMP is"
    echo "  off, the community is wrong, or a firewall blocks UDP/161."
    echo "      snmpwalk -v2c -c <community> $IP $OID_SYSDESCR"
    exit 2
fi
echo "  ${C_OK}v${C_RST} Device answers."

spec="$(walk_state "$OID_STP_SPEC" | head -1)"
# dot1dStpPortState EINMAL walken (teuer auf grossen Switches) und als EIN
# Snapshot zaehlen -- sonst stimmt forwarding+blocking+other nicht gegen n_state.
states="$(walk_state "$OID_STP_STATE")"
n_state="$(printf '%s' "$states" | grep -c . || true)"
n_fwd="$(printf '%s' "$states" | grep -c '^5$' || true)"
n_blk="$(printf '%s' "$states" | grep -c '^2$' || true)"
n_other=$(( n_state - n_fwd - n_blk )); [[ "$n_other" -lt 0 ]] && n_other=0
n_ix="$(walk_count "$OID_DOT1D_IFX")"
n_if="$(walk_count "$OID_IFNAME")"

# ── Loop-PARTNER: welcher Port ist das ANDERE Ende? ──────────────────────────
# RSTP sperrt bei einem (Selbst-)Loop nur EINEN Port (state 2); das zweite Ende
# leitet weiter (state 5) und ist von einem gesunden Up-Port nicht zu trennen —
# genau das fehlt in der Faceplate. Der geblockte Port verraet seinen Partner
# ueber die "designated"-Felder: zeigt dot1dStpPortDesignatedBridge auf die
# EIGENE Bridge (dot1dBaseBridgeAddress), ist es ein Loop IM SELBEN Geraet, und
# dot1dStpPortDesignatedPort nennt den Partner-Bridge-Port. Hier wird nur
# geprueft, OB diese drei Werte da sind — die eigene Bridge-MAC wird dabei
# NICHT ausgegeben (sie ist ein MAC, der Rest sind Zaehlwerte).
n_db="$(walk_count "$OID_STP_DESIG_BR")"
n_dp="$(walk_count "$OID_STP_DESIG_PT")"
base_br="$(walk_val "$OID_BASE_BRIDGE" | head -1)"
has_base=$([[ -n "$base_br" ]] && echo 1 || echo 0)

# spec (BRIDGE-MIB): 1 = unknown, 2 = decLb100, 3 = ieee8021d; leer = Skalar fehlt.
case "$spec" in
    3)  spec_txt="ieee8021d (running)";;
    2)  spec_txt="decLb100";;
    1)  spec_txt="unknown";;
    "") spec_txt="not exposed";;
    *)  spec_txt="code $spec";;
esac

# line <count> <ok-glyph> <ok-msg> <bad-glyph> <bad-msg> — echtes if/then/else,
# nicht A && B || C (dort liefe C auch, wenn B fehlschluege; shellcheck SC2015).
line() { if [[ "$1" -gt 0 ]]; then echo "  $2 $3"; else echo "  $4 $5"; fi; }
echo "  ${C_DIM}i${C_RST} dot1dStpProtocolSpecification: $spec_txt"
line "$n_state" "${C_OK}v${C_RST}" "dot1dStpPortState: $n_state port(s) -- forwarding $n_fwd, blocking $n_blk, other $n_other." \
                "${C_DIM}-${C_RST}" "dot1dStpPortState: empty."
line "$n_ix" "${C_OK}v${C_RST}" "Bridge-Port -> ifIndex (dot1dBasePortIfIndex): $n_ix." \
             "${C_ERR}x${C_RST}" "Bridge-Port -> ifIndex: EMPTY -- STP state unmappable to a link."
line "$n_if" "${C_OK}v${C_RST}" "ifName: $n_if (port names available)." \
             "${C_WARN}!${C_RST}" "ifName: empty -- ports would show as ifIndex numbers."
if [[ "$n_state" -gt 0 && "$n_blk" -eq 0 ]]; then
    echo "  ${C_WARN}!${C_RST} No blocking port right now -- readable, but no blocked link to confirm the case."
fi

# Loop-Partner-Quelle: nur relevant, wenn ueberhaupt ein Port blockt.
partner_ok=0
if [[ "$n_blk" -gt 0 ]]; then
    echo "  ${C_DIM}--- loop partner (second end of a self-loop) ---${C_RST}"
    line "$n_db" "${C_OK}v${C_RST}" "dot1dStpPortDesignatedBridge: $n_db entry(s)." \
                 "${C_WARN}!${C_RST}" "dot1dStpPortDesignatedBridge: empty -- partner bridge unknown."
    line "$n_dp" "${C_OK}v${C_RST}" "dot1dStpPortDesignatedPort: $n_dp entry(s)." \
                 "${C_WARN}!${C_RST}" "dot1dStpPortDesignatedPort: empty -- partner port unknown."
    line "$has_base" "${C_OK}v${C_RST}" "dot1dBaseBridgeAddress: present (own bridge id available)." \
                     "${C_WARN}!${C_RST}" "dot1dBaseBridgeAddress: empty -- cannot tell a self-loop from a neighbour loop."
    if [[ "$n_db" -gt 0 && "$n_dp" -gt 0 && "$has_base" -eq 1 ]]; then
        partner_ok=1
        echo "  ${C_OK}v${C_RST} All three present -- the forwarding partner of a blocked port IS resolvable."
    fi
fi

# ── Verdict ──────────────────────────────────────────────────────────────────
if [[ "$n_state" -eq 0 ]]; then
    verdict="no STP port state visible"
    hint="The device answers but hands out no dot1dStpPortState. Either STP is off, a restricted SNMP view (widen it to include 1.3.6.1.2.1.17.2), or -- common on modern switches -- MSTP/PVST exposes the state only per VLAN instance, sometimes only through a VLAN-context community (Cisco: community@vlan). Note the sysDescr so we can tell which case."
elif [[ "$n_ix" -eq 0 ]]; then
    verdict="STP state present, but bridge-port -> ifIndex MISSING"
    hint="dot1dStpPortState is indexed by BRIDGE-PORT, not ifIndex. Without dot1dBasePortIfIndex the blocking/forwarding state cannot be tied to an interface (and thus to a map edge). Check whether the SNMP view includes 1.3.6.1.2.1.17.1.4."
elif [[ "$n_blk" -gt 0 ]]; then
    verdict="dot1dStp usable -- and a blocking port is visible"
    hint="State + port mapping are there, and at least one port is blocking: the blocked-link case reads directly. This switch can drive 'dim the STP-blocked edge'."
elif [[ "$n_fwd" -gt 0 ]]; then
    verdict="dot1dStp usable (ports forwarding, none blocking now)"
    hint="State + port mapping are there; nothing is blocking at the moment, so the interesting case isn't shown now. Re-probe a switch with an actual blocked redundancy link to confirm end to end."
else
    verdict="dot1dStp present, but no port forwarding or blocking"
    hint="State + port mapping are there, but every port is in an 'other' state (disabled/listening/learning/broken) -- none forwarding or blocking. Seen when STP is on but ports are down, or a switch fills the table without meaningful per-port state (observed on TP-Link TL-SG2008P). Re-probe with active forwarding ports to confirm the state is usable."
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
| dot1dStpProtocolSpecification | $spec_txt |
| dot1dStpPortState ports | $n_state |
|   forwarding / blocking / other | $n_fwd / $n_blk / $n_other |
| Bridge-port -> ifIndex (dot1dBasePortIfIndex) | $n_ix |
| ifName (port names) | $n_if |
| dot1dStpPortDesignatedBridge / DesignatedPort | $n_db / $n_dp |
| dot1dBaseBridgeAddress present | $([[ "$has_base" -eq 1 ]] && echo yes || echo no) |
| Loop partner resolvable | $([[ "$partner_ok" -eq 1 ]] && echo yes || echo "n/a — no blocking port or fields missing") |
| Verdict | **$verdict** |

sysDescr (straight from the device -- please read it before posting):

    $SYSDESCR
REPORT
echo
echo "${C_DIM}-------------------------------------------------------------${C_RST}"
echo "  ${C_DIM}Note:${C_RST} $hint"
echo
