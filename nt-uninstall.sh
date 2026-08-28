#!/usr/bin/env bash
#
# nt-uninstall.sh — Remove the "Network Topology for Zabbix" frontend module.
# Run this ON the Zabbix (frontend) host.
#
# Usage:
#   ./nt-uninstall.sh                 Remove module + widget directories
#   ./nt-uninstall.sh --dry-run       Show what would happen, change nothing
#   ./nt-uninstall.sh --purge         Also delete the per-user rows in "profiles"
#   ./nt-uninstall.sh --yes           Do not ask for confirmation
#
# The directories are MOVED to a timestamped backup, not deleted — the script
# prints how to restore them and how to get rid of them for good.
#
# Requirements: bash, sudo (or run as root), a Zabbix frontend.
# Autodetect override:  ZBX_UI_PATH=/path/to/zabbix/ui  ./nt-uninstall.sh
# Backup elsewhere:     NT_BACKUP_DIR=/srv/backups  ./nt-uninstall.sh
#
# WAS DIESES SKRIPT NICHT ANFASST
# -------------------------------
# Host-Tags (nt:parent, nt:icon, nt:label, nt:note, nt:link, nt:show), die
# importierten Templates, den Cron fuer tools/topo-change-sender.sh und den
# dafuer angelegten Monitoring-User. Das sind Daten, die jemand selbst angelegt
# hat — nt:parent beschreibt die eigene Infrastruktur, nicht unsere. Sie
# stillschweigend zu loeschen waere uebergriffig. Das Skript ZAEHLT sie und
# nennt sie am Ende beim Namen, mitsamt dem SQL zum Selbstausfuehren.

set -uo pipefail   # NICHT -e: mehrere Schritte pruefen Rueckgabewerte selbst.

# PATH haerten — gleiche Begruendung wie in nt-install.sh.
export PATH="/usr/sbin:/usr/bin:/sbin:/bin${PATH:+:$PATH}"

readonly MODULE="network_topology"
readonly WIDGETS=(
    "network_topology_widget"
    "network_topology_health_widget"
    "network_topology_table_widget"
    "network_topology_kpi_widget"
    "network_topology_items_widget"
)
# Alte Namen aus 4.x. Wer von dort kommt, hat sie evtl. noch liegen — und
# manche Handinstallation hat das QUELLverzeichnis als Namen genommen
# (widget_health/ statt network_topology_v6_health_widget/). Solche Leichen
# deklarieren dieselbe Modul-ID zweimal, und Zabbix registriert dann keines
# von beiden. Auf einer echten Instanz genau so vorgefunden.
readonly LEGACY=(
    "network_topology_v6"
    "network_topology_v6_widget"
    "network_topology_v6_health_widget"
    "network_topology_v6_table_widget"
    "widget_health" "widget_table" "widget_kpi" "widget_items" "widget"
)
# Die persoenliche Ebene. Anders als die geteilte (module.config) haengt sie
# NICHT an der module-Zeile und ueberlebt jede Deinstallation.
readonly PROFILE_KEYS=(
    "web.network_topology.manual_links"
    "web.network_topology.positions"
)

# ── Ausgabe ──────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then C_OK=$'\e[32m'; C_ERR=$'\e[31m'; C_WARN=$'\e[33m'; C_DIM=$'\e[2m'; C_RST=$'\e[0m'
else C_OK=""; C_ERR=""; C_WARN=""; C_DIM=""; C_RST=""; fi
ok()   { echo "  ${C_OK}✓${C_RST} $*"; }
bad()  { echo "  ${C_ERR}✗${C_RST} $*"; }
warn() { echo "  ${C_WARN}!${C_RST} $*"; }
die()  { echo "${C_ERR}❌ $*${C_RST}" >&2; exit 1; }

DRY=0 PURGE=0 ASSUME_YES=0
for a in "$@"; do
    case "$a" in
        --dry-run) DRY=1 ;;
        --purge)   PURGE=1 ;;
        --yes|-y)  ASSUME_YES=1 ;;
        -h|--help|help) sed -n '3,26p' "$0" | sed 's/^#[[:space:]]\{0,1\}//'; exit 0 ;;
        *) die "Unbekannte Option: $a (--dry-run | --purge | --yes)" ;;
    esac
done

if [[ -n "${NT_SUDO+x}" ]]; then
    case "$NT_SUDO" in
        ""|sudo|doas) SUDO="$NT_SUDO" ;;
        *) die "NT_SUDO nur '', 'sudo' oder 'doas' erlaubt (nicht: $NT_SUDO)" ;;
    esac
else SUDO=""; [[ "$(id -u)" -eq 0 ]] || SUDO="sudo"; fi

confirm() {   # $1 = Frage. Bei --yes immer ja; ohne TTY immer nein.
    (( ASSUME_YES )) && return 0
    [[ -t 0 ]] || { warn "Keine Eingabe moeglich — uebersprungen. Mit --yes erzwingen."; return 1; }
    local a; read -r -p "  $1 [j/N] " a
    [[ "$a" =~ ^([jJ]|[yY])$ ]]
}

# ── Autodetect ───────────────────────────────────────────────────────────
UI="" FPM=""
detect_ui() {
    if [[ -n "${ZBX_UI_PATH:-}" ]]; then
        [[ -d "$ZBX_UI_PATH/modules" ]] || die "ZBX_UI_PATH=$ZBX_UI_PATH hat kein modules/-Verzeichnis."
        UI="$ZBX_UI_PATH"; return
    fi
    local c
    for c in /usr/share/zabbix/ui /var/www/html/zabbix/ui /var/www/zabbix/ui /usr/share/zabbix; do
        [[ -d "$c/modules" ]] && { UI="$c"; return; }
    done
    die "Zabbix-UI-Pfad nicht gefunden. Setze ZBX_UI_PATH=/pfad/zu/zabbix/ui."
}
# Unit-Liste einmal holen, dann ohne Pipe auswerten — siehe die ausfuehrliche
# Begruendung in nt-install.sh: "| grep -q" laesst systemctl in SIGPIPE laufen,
# und mit "set -o pipefail" gilt die Pipeline dann als fehlgeschlagen, obwohl
# der Treffer da war. Auf der RHEL-Familie ist das der einzige Zweig, der
# greifen kann, weil die Unit dort schlicht "php-fpm.service" heisst.
detect_fpm() {
    local units
    units=$(systemctl list-units --type=service --all 2>/dev/null) || units=""

    FPM=$(awk '{for (i = 1; i <= NF; i++) if ($i ~ /^php[0-9.]+-fpm\.service$/) {
                    sub(/\.service$/, "", $i); print $i; exit }}' <<<"$units")

    if [[ -z "$FPM" && "$units" == *"php-fpm.service"* ]]; then
        FPM="php-fpm"
    fi
}

# Datenbank: NUR Typ und Name aus zabbix.conf.php, nie das Passwort.
#
# Gearbeitet wird ueber die Administrations-Konten des DB-Servers
# (postgres per peer, root per unix_socket) — die brauchen kein Passwort und
# stehen dem zur Verfuegung, der dieses Skript ohnehin als root faehrt. Wo das
# nicht greift, gibt das Skript das SQL aus, statt nach Zugangsdaten zu fragen.
DBTYPE="" DBNAME=""
detect_db() {
    local cfg="$UI/conf/zabbix.conf.php"
    [[ -r "$cfg" ]] || cfg=""
    if [[ -z "$cfg" ]] && $SUDO test -r "$UI/conf/zabbix.conf.php" 2>/dev/null; then
        cfg="$UI/conf/zabbix.conf.php"
    fi
    [[ -n "$cfg" ]] || return 0
    DBTYPE=$($SUDO grep -oE "\\\$DB\['TYPE'\][[:space:]]*=[[:space:]]*'[^']+'" "$cfg" 2>/dev/null \
             | grep -oE "'[^']+'$" | tr -d "'")
    DBNAME=$($SUDO grep -oE "\\\$DB\['DATABASE'\][[:space:]]*=[[:space:]]*'[^']+'" "$cfg" 2>/dev/null \
             | grep -oE "'[^']+'$" | tr -d "'")
}

# Gibt bei Erfolg das Abfrageergebnis aus, sonst nichts (Rueckgabewert != 0).
#
# Der postgres-Zweig darf NICHT "$SUDO -u postgres" lauten: laeuft das Skript
# als root, ist $SUDO leer und daraus wuerde das Kommando "-u postgres psql".
# Als root ist der Benutzerwechsel per su zu machen, sonst per sudo -u.
db_query() {
    local sql="$1"
    case "$DBTYPE" in
        POSTGRESQL)
            if [[ -n "$SUDO" ]]; then
                $SUDO -u postgres psql -d "$DBNAME" -Atq -c "$sql" 2>/dev/null
            else
                su -s /bin/sh postgres -c "psql -d '$DBNAME' -Atq -c \"$sql\"" 2>/dev/null
            fi ;;
        MYSQL)
            $SUDO mysql --batch --skip-column-names -D "$DBNAME" -e "$sql" 2>/dev/null ;;
        *) return 1 ;;
    esac
}

# ── 1. Bestandsaufnahme ──────────────────────────────────────────────────
detect_ui; detect_fpm; detect_db

echo "→ Gefunden"
echo "    UI-Pfad:  $UI"
echo "    php-fpm:  ${FPM:-${C_WARN}kein Service gefunden${C_RST}}"
echo "    DB:       ${DBTYPE:-unbekannt}${DBNAME:+ / $DBNAME}"
echo

FOUND=()
for d in "$MODULE" "${WIDGETS[@]}" "${LEGACY[@]}"; do
    [[ -d "$UI/modules/$d" ]] || continue
    # Nur was wirklich von uns ist: die Modul-ID muss passen. Sonst raeumt das
    # Skript ein fremdes "widget"-Verzeichnis mit weg.
    mf="$UI/modules/$d/manifest.json"
    id=$($SUDO sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$mf" 2>/dev/null | head -1)
    case "$id" in
        network_topology|network_topology_*) FOUND+=("$d|$id") ;;
        *) [[ -n "$id" ]] && warn "uebersprungen: $d (fremde Modul-ID '$id')" ;;
    esac
done

if [[ ${#FOUND[@]} -eq 0 ]]; then
    echo "  Keine Verzeichnisse dieses Moduls unter $UI/modules/ gefunden."
else
    echo "→ Wird entfernt (${#FOUND[@]})"
    for e in "${FOUND[@]}"; do
        # Farbcodes als ARGUMENT, nicht im Format-String — sonst wuerde printf
        # sie als Formatanweisungen lesen (und shellcheck SC2059 meckern).
        printf "    %-38s %sid=%s%s\n" "${e%%|*}" "$C_DIM" "${e##*|}" "$C_RST"
    done
fi
echo

# ── 2. Verzeichnisse beiseite schieben ───────────────────────────────────
BK=""
if [[ ${#FOUND[@]} -gt 0 ]]; then
    if ! (( DRY )) && ! confirm "Diese Verzeichnisse verschieben?"; then
        die "Abgebrochen."
    fi
    # /var/backups ist der uebliche Platz und gehoert root — was passt, weil
    # das Entfernen eines systemweiten Moduls ohnehin Root-Rechte braucht.
    # NT_BACKUP_DIR macht es ueberschreibbar, u.a. fuer Tests ohne sudo.
    BK="${NT_BACKUP_DIR:-/var/backups}/nt-uninstall-$(date +%Y%m%d-%H%M%S)"
    # Kein "✓ verschoben" im Trockenlauf: eine Erfolgsmeldung fuer etwas, das
    # nicht stattgefunden hat, ist schlimmer als gar keine Ausgabe.
    if (( DRY )); then
        echo "    ${C_DIM}wuerde anlegen:  $BK${C_RST}"
        for e in "${FOUND[@]}"; do
            echo "    ${C_DIM}wuerde schieben: ${e%%|*}  →  $BK/${C_RST}"
        done
    else
        $SUDO mkdir -p "$BK" || die "Backup-Verzeichnis $BK nicht anlegbar."
        for e in "${FOUND[@]}"; do
            d="${e%%|*}"
            if $SUDO mv "$UI/modules/$d" "$BK/"; then ok "verschoben: $d"
            else bad "konnte $d nicht verschieben"; fi
        done
        echo
        ok "Sicherung: $BK"
    fi
fi

# ── 3. php-fpm neu laden ─────────────────────────────────────────────────
if [[ -z "$FPM" ]]; then
    warn "Kein php-fpm-Service erkannt. Webserver von Hand neu laden."
elif (( DRY )); then
    echo "    ${C_DIM}wuerde neu laden: $FPM${C_RST}"
elif $SUDO systemctl reload "$FPM"; then
    ok "$FPM neu geladen"
else
    warn "Reload von $FPM fehlgeschlagen — von Hand nachziehen."
fi
echo

# ── 4. Was serverseitig zurueckbleibt ────────────────────────────────────
echo "→ Serverseitige Reste"

# Die geteilte Ebene braucht kein Aufraeumen: module.config ist eine SPALTE der
# module-Zeile und verschwindet mit ihr, sobald Zabbix beim naechsten
# "Scan directory" merkt, dass das Verzeichnis weg ist.
echo "    ${C_DIM}Geteilte Links/Positionen liegen in module.config und verschwinden"
echo "    mit der module-Zeile beim naechsten 'Scan directory'.${C_RST}"

PROF_TOTAL=0
if [[ -n "$DBTYPE" && -n "$DBNAME" ]]; then
    for k in "${PROFILE_KEYS[@]}"; do
        n=$(db_query "SELECT count(*) FROM profiles WHERE idx = '$k';" | tr -d ' \n')
        [[ "$n" =~ ^[0-9]+$ ]] || { n=""; }
        if [[ -z "$n" ]]; then
            warn "DB nicht abfragbar — persoenliche Ebene ungeprueft."
            PROF_TOTAL=-1; break
        fi
        u=$(db_query "SELECT count(DISTINCT userid) FROM profiles WHERE idx = '$k';" | tr -d ' \n')
        printf "    %-42s %s Zeile(n), %s Benutzer\n" "$k" "$n" "${u:-?}"
        PROF_TOTAL=$(( PROF_TOTAL + n ))
    done
else
    warn "DB-Typ/Name nicht ermittelbar — persoenliche Ebene ungeprueft."
    PROF_TOTAL=-1
fi

if (( PROF_TOTAL > 0 )) && (( ! PURGE )); then
    echo
    warn "$PROF_TOTAL Zeile(n) bleiben liegen. Mit --purge entfernen, oder von Hand:"
    for k in "${PROFILE_KEYS[@]}"; do
        echo "        DELETE FROM profiles WHERE idx = '$k';"
    done
fi

# ── 5. --purge ───────────────────────────────────────────────────────────
if (( PURGE )); then
    echo
    if (( PROF_TOTAL < 0 )); then
        bad "--purge nicht moeglich: die Datenbank ist von hier nicht erreichbar."
        echo "        Das SQL steht oben; es laesst sich als DB-Admin direkt ausfuehren."
    elif (( PROF_TOTAL == 0 )); then
        ok "Nichts zu loeschen — die persoenliche Ebene ist leer."
    else
        echo "→ --purge: $PROF_TOTAL Zeile(n) in profiles loeschen"
        warn "Das trifft die persoenlichen Karten ALLER Benutzer und ist endgueltig."
        if (( DRY )); then
            for k in "${PROFILE_KEYS[@]}"; do
                echo "      ${C_DIM}[dry-run] DELETE FROM profiles WHERE idx = '$k';${C_RST}"
            done
        elif confirm "Wirklich loeschen?"; then
            for k in "${PROFILE_KEYS[@]}"; do
                if db_query "DELETE FROM profiles WHERE idx = '$k';" >/dev/null; then
                    ok "geloescht: $k"
                else
                    bad "DELETE fehlgeschlagen: $k"
                fi
            done
        else
            echo "      uebersprungen."
        fi
    fi
fi

# ── 6. Was das Skript bewusst stehen laesst ──────────────────────────────
echo
echo "→ Nicht angefasst (eigene Daten, kein Modul-Ballast)"
if [[ -n "$DBTYPE" && -n "$DBNAME" ]]; then
    tags=$(db_query "SELECT tag || ' (' || count(*) || ')' FROM host_tag WHERE tag LIKE 'nt:%' GROUP BY tag ORDER BY tag;")
    if [[ -n "$tags" ]]; then
        echo "    Host-Tags:"
        echo "$tags" | sed 's/^/      /'
        echo "      ${C_DIM}Entfernen — nur wenn du sicher bist:${C_RST}"
        echo "        DELETE FROM host_tag WHERE tag LIKE 'nt:%';"
    else
        echo "    Host-Tags: keine"
    fi
fi
echo "    Templates:  NT LLDP Neighbors by SNMP, NT Health Score, NT Topology Change"
echo "                ${C_DIM}in der UI unter Data collection → Templates loeschen${C_RST}"
echo "    Cron:       tools/topo-change-sender.sh und der dafuer angelegte User"
echo "    Browser:    Pins, Notizen, Filter-Presets und Toolbar-Einstellungen"
echo "                ${C_DIM}liegen im localStorage jedes Benutzers (Schluessel 'nt_...')${C_RST}"

# ── 7. Schluss ───────────────────────────────────────────────────────────
echo
if (( DRY )); then
    echo "${C_WARN}Trockenlauf — es wurde nichts geaendert.${C_RST}"
    exit 0
fi
echo "${C_OK}✓ Deinstallation fertig${C_RST}"
echo "  Naechster Schritt in der UI:"
echo "    Administration → General → Modules → Scan directory"
echo "  Erst danach sind die Modul-Eintraege (und module.config) aus der DB verschwunden."
if [[ -n "$BK" ]]; then
    echo
    echo "  Zurueckholen:   sudo mv $BK/* $UI/modules/ && sudo systemctl reload ${FPM:-php-fpm}"
    echo "  Endgueltig weg: sudo rm -rf $BK"
fi
