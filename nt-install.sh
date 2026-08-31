#!/usr/bin/env bash
#
# nt-install.sh — Install / update / check the "Network Topology for Zabbix"
# frontend module. Run this ON the Zabbix (frontend) host.
#
# Usage:
#   ./nt-install.sh check                 Verify environment + an existing install
#   ./nt-install.sh install [<zip>]       Fresh install from a release ZIP
#   ./nt-install.sh update  [<zip>]       Update in place (backs up first)
#   ./nt-install.sh update  --rollback    Restore the pre-update backup
#
# If <zip> is omitted it looks for  ./network_topology.zip  then ~/network_topology.zip
# The module is ALWAYS installed as  <ui>/modules/network_topology  (the name is mandatory).
#
# Requirements: bash, unzip, sudo (or run as root), a Zabbix 7.4+ frontend.
# Autodetect override:  ZBX_UI_PATH=/path/to/zabbix/ui  ./nt-install.sh ...

set -uo pipefail   # NICHT -e: check() erwartet fehlschlagende Tests; kritische
                   # Schritte in install/update sind einzeln mit || die abgesichert.

# PATH haerten: System-Verzeichnisse zuerst, damit ein manipuliertes PATH
# (z.B. sudo -E / root-cron) keine Trojaner-Binary vor systemctl/unzip/awk schiebt.
export PATH="/usr/sbin:/usr/bin:/sbin:/bin${PATH:+:$PATH}"

readonly MODULE="network_topology"
# Dieses Skript installiert das HAUPTMODUL, und das laeuft auf 7.0 LTS genauso
# wie auf 7.4. Nur die Dashboard-Widgets brauchen 7.4 — sie werden hier nicht
# installiert. Vorher stand hier 7.4, und der Check meldete auf einer 7.0-LTS
# "Modul braucht 7.4+", also eine Warnung vor einer Kombination, die die
# Dokumentation ausdruecklich empfiehlt.
readonly MIN_MAJOR=7 MIN_MINOR=0
readonly MAX_UNPACKED=$((100 * 1024 * 1024))   # 100 MiB — Cap gegen Zip-Bomben
readonly REQUIRED_FILES=(
    "manifest.json"
    "assets/js/dist/nt-bundle.js"
    "assets/js/cytoscape.min.js"
    "assets/js/leaflet/leaflet.js"
)

# ── Ausgabe ──────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then C_OK=$'\e[32m'; C_ERR=$'\e[31m'; C_WARN=$'\e[33m'; C_DIM=$'\e[2m'; C_RST=$'\e[0m'
else C_OK=""; C_ERR=""; C_WARN=""; C_DIM=""; C_RST=""; fi
ok()   { echo "  ${C_OK}✓${C_RST} $*"; }
bad()  { echo "  ${C_ERR}✗${C_RST} $*"; }
warn() { echo "  ${C_WARN}!${C_RST} $*"; }
die()  { echo "${C_ERR}❌ $*${C_RST}" >&2; exit 1; }

# SELinux-Kontext wiederherstellen (RHEL/Rocky/Alma, Fedora).
#
# Das Modul wird aus einem Staging-Verzeichnis unter /tmp per "cp -a" bzw. "mv"
# an seinen Platz gebracht — beide ERHALTEN den Kontext. Dateien aus /tmp tragen
# user_tmp_t; php-fpm laeuft als httpd_t und darf das nicht lesen. Ergebnis:
# das Modul liegt korrekt, mit richtigen Rechten und Owner, und taucht in der
# UI trotzdem nicht auf — der haeufigste Stolperstein auf der RHEL-Familie.
# restorecon setzt den Typ auf das, was die Policy fuer den Pfad vorsieht
# (httpd_sys_content_t unter /usr/share/zabbix).
#
# Nie fatal: auf Debian/Ubuntu ohne SELinux existiert restorecon gar nicht, und
# bei abgeschaltetem SELinux waere der Aufruf sinnlos.
restore_context() {
    local target="$1"
    command -v restorecon >/dev/null 2>&1 || return 0
    # selinuxenabled fehlt auf manchen Minimal-Images; dann einfach versuchen.
    if command -v selinuxenabled >/dev/null 2>&1 && ! selinuxenabled 2>/dev/null; then
        return 0
    fi
    if $SUDO restorecon -R "$target" 2>/dev/null; then
        ok "SELinux-Kontext gesetzt: $target"
    else
        warn "restorecon fehlgeschlagen fuer $target — bei aktivem SELinux von Hand nachziehen:"
        warn "    sudo restorecon -R '$target'"
    fi
}

# Privileg-Eskalation: NT_SUDO override (z.B. "doas", oder "" zum Testen),
# sonst automatisch: als root nichts, sonst sudo.
if [[ -n "${NT_SUDO+x}" ]]; then
    # Allow-list statt beliebiger Kommandostring — $SUDO laeuft mit Root-Rechten.
    case "$NT_SUDO" in
        ""|sudo|doas) SUDO="$NT_SUDO" ;;
        *) echo "❌ NT_SUDO nur '', 'sudo' oder 'doas' erlaubt (nicht: $NT_SUDO)." >&2; exit 1 ;;
    esac
else SUDO=""; [[ "$(id -u)" -eq 0 ]] || SUDO="sudo"; fi

# Aufräumen des Stage-Verzeichnisses, auch bei die/Abbruch.
_CLEAN=""
trap '[[ -n "$_CLEAN" ]] && rm -rf "$_CLEAN" 2>/dev/null || true' EXIT

# ── Autodetect (setzen Globals; die() wirkt hier, weil KEINE Subshell) ────
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
# FPM leer, wenn kein Service gefunden — Aufrufer prüft.
#
# Die Unit-Liste wird EINMAL in eine Variable geholt und danach ohne Pipe
# ausgewertet. Vorher stand hier
#
#     ... | grep -q 'php-fpm\.service'
#
# und das war auf der gesamten RHEL-Familie kaputt: "grep -q" beendet sich beim
# ersten Treffer und schliesst die Pipe, systemctl bekommt SIGPIPE und endet mit
# 141 — und weil oben "set -o pipefail" steht, gilt die ganze Pipeline als
# fehlgeschlagen, OBWOHL der Treffer da war. Nachgemessen auf Rocky 9:
# ohne pipefail exit 0, mit pipefail exit 141.
#
# Auf Debian/Ubuntu fiel das nie auf, weil dort der erste Zweig greift
# (php8.2-fpm.service). Auf RHEL heisst die Unit "php-fpm.service" ohne
# Version, also kann NUR der zweite Zweig treffen — und der war der kaputte.
# Der Installer brach dort mit "kein php-fpm-Service gefunden" ab, auf einer
# Maschine, auf der php-fpm laeuft.
#
# Das Feld wird ueber alle Spalten gesucht statt ueber $1: bei einer Unit im
# Fehlerzustand stellt systemd ein "●" voran, dann waere $1 der Punkt.
detect_fpm() {
    local units
    units=$(systemctl list-units --type=service --all 2>/dev/null) || units=""

    # Debian/Ubuntu: versionierter Name
    FPM=$(awk '{for (i = 1; i <= NF; i++) if ($i ~ /^php[0-9.]+-fpm\.service$/) {
                    sub(/\.service$/, "", $i); print $i; exit }}' <<<"$units")

    # RHEL-Familie: unversioniert. Reiner Bash-Vergleich, keine Pipe.
    if [[ -z "$FPM" && "$units" == *"php-fpm.service"* ]]; then
        FPM="php-fpm"
    fi
}

zbx_version() {   # liest ZABBIX_VERSION aus den Frontend-Files ($1 = UI-Pfad)
    local f="$1/include/defines.inc.php"
    [[ -r "$f" ]] || return 0
    grep -oE "ZABBIX_VERSION'[^0-9]*[0-9]+\.[0-9]+\.[0-9]+" "$f" 2>/dev/null \
        | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true
}
manifest_version() {
    grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' "$1" 2>/dev/null \
        | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true
}

# Action-Namen aus einem Manifest. Bewusst ohne JSON-Parser: die Namen sind
# als "network.topology.x" eindeutig, und ein Parser waere eine Abhaengigkeit
# mehr auf einem Frontend-Host, auf dem nur bash sicher vorhanden ist.
manifest_actions() {
    grep -oE '"network\.topology[^"]*"' "$1" 2>/dev/null | tr -d '"' | sort -u || true
}

find_zip() {   # echot Pfad; die() hier ok, weil Aufrufer mit  || exit 1  abfängt
    local z="${1:-}"
    if [[ -n "$z" ]]; then [[ -f "$z" ]] || die "ZIP nicht gefunden: $z"; echo "$z"; return; fi
    for z in "./$MODULE.zip" "${HOME:-}/$MODULE.zip"; do
        [[ -f "$z" ]] && { echo "$z"; return; }
    done
    die "Kein ZIP angegeben und $MODULE.zip nicht in . oder ~ gefunden."
}

# ── check ────────────────────────────────────────────────────────────────
cmd_check() {
    local ver rc=0
    echo "${C_DIM}Prüfe Umgebung + Installation…${C_RST}"
    detect_ui; ok "Zabbix-UI: $UI"
    local mod="$UI/modules/$MODULE"

    if [[ -d "$mod" ]]; then
        ok "Modulverzeichnis: $mod (Name korrekt)"
        # Die erste Frage bei jeder Meldung lautet "welche Version laeuft bei
        # dir?" — und bisher beantwortete dieser Check sie nicht.
        local iv; iv=$(manifest_version "$mod/manifest.json")
        if [[ -n "$iv" ]]; then ok "Version: $iv"
        else bad "Version nicht lesbar — manifest.json fehlt oder ist beschaedigt"; rc=1; fi
        local rf
        for rf in "${REQUIRED_FILES[@]}"; do
            if [[ -r "$mod/$rf" ]]; then ok "Datei: $rf"
            else bad "fehlt/nicht lesbar: $rf"; rc=1; fi
        done
    else
        bad "Modulverzeichnis fehlt: $mod"; rc=1
        local wrong
        wrong=$(find "$UI/modules" -maxdepth 1 -type d -iname '*network*topolog*' 2>/dev/null \
                | grep -v "/$MODULE$" | head -1) || true
        [[ -n "$wrong" ]] && warn "unter falschem Namen gefunden: $wrong  → mv nach $MODULE"
    fi

    # Die Widgets sind eigene Module mit EIGENEN Versionsnummern und werden von
    # diesem Skript nicht mitinstalliert. Beim Aktualisieren bleiben sie deshalb
    # leicht liegen — hier wenigstens sichtbar machen, was tatsaechlich liegt.
    local w wdir wv found_w=0
    for w in network_topology_widget network_topology_health_widget \
             network_topology_table_widget network_topology_kpi_widget \
             network_topology_items_widget; do
        wdir="$UI/modules/$w"
        [[ -d "$wdir" ]] || continue
        found_w=1
        wv=$(manifest_version "$wdir/manifest.json")
        ok "Widget: $w (v${wv:-?})"
    done
    if [[ $found_w -eq 0 ]]; then
        echo "  ${C_DIM}i${C_RST} keine Dashboard-Widgets installiert (optional, brauchen Zabbix 7.4)"
    fi

    if command -v php >/dev/null 2>&1; then
        local pv; pv=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;' 2>/dev/null) || true
        if [[ "${pv%%.*}" == "8" ]]; then ok "PHP: $pv"
        else warn "PHP ${pv:-?} — empfohlen 8.x"; fi
    else warn "php-CLI nicht gefunden (php-fpm kann trotzdem laufen)"; fi

    detect_fpm
    if [[ -n "$FPM" ]]; then
        if systemctl is-active --quiet "$FPM" 2>/dev/null; then ok "php-fpm: $FPM (aktiv)"
        else warn "php-fpm: $FPM (nicht aktiv?)"; fi
    else bad "kein php-fpm-Service gefunden"; rc=1; fi

    ver=$(zbx_version "$UI")
    if [[ -n "$ver" ]]; then
        local maj min; maj=${ver%%.*}; min=$(echo "$ver" | cut -d. -f2)
        if (( maj > MIN_MAJOR || (maj == MIN_MAJOR && min >= MIN_MINOR) )); then ok "Zabbix: $ver"
        else warn "Zabbix $ver — Modul braucht ${MIN_MAJOR}.${MIN_MINOR}+"; fi
    else warn "Zabbix-Version nicht lesbar (defines.inc.php)"; fi

    echo
    [[ $rc -eq 0 ]] && echo "${C_OK}✓ Check bestanden.${C_RST}" || echo "${C_ERR}✗ Check: Probleme gefunden (siehe oben).${C_RST}"
    return $rc
}

# ── install / update ─────────────────────────────────────────────────────
do_deploy() {
    local mode="$1" zip="$2" mod src stage prev=""
    detect_ui; detect_fpm
    [[ -n "$FPM" ]] || die "kein php-fpm-Service gefunden."
    command -v unzip >/dev/null 2>&1 || die "unzip fehlt — bitte installieren."
    mod="$UI/modules/$MODULE"

    # Actions der INSTALLIERTEN Version festhalten, solange sie noch liegt.
    # Kommen mit dem Update neue dazu, ist "Scan directory" Pflicht — sonst
    # kennt Zabbix sie nicht, und der Browser bekommt "Unknown action".
    local old_actions=""
    [[ -f "$mod/manifest.json" ]] && old_actions=$(manifest_actions "$mod/manifest.json")

    stage=$(mktemp -d) || die "mktemp fehlgeschlagen — kein beschreibbares TMP?"
    _CLEAN="$stage"
    # Zip-Slip-Schutz: keine absoluten (/…) oder ../-Pfade im Archiv — unabhaengig
    # von der unzip-Implementierung geprueft (busybox-unzip filtert nicht immer).
    #
    # Die Liste wird ERST vollstaendig eingelesen und DANN geprueft. Vorher stand
    # hier "unzip -Z1 … | grep -qE …" direkt im if, und das konnte FAIL-OPEN
    # gehen: grep -q beendet sich beim ersten Treffer, unzip bekommt SIGPIPE und
    # endet mit 141, und weil oben "set -o pipefail" steht, gilt die Pipeline als
    # fehlgeschlagen — die Bedingung wird falsch, das die() faellt aus, und
    # ausgerechnet das Archiv MIT unsicheren Pfaden waere durchgerutscht.
    # Ob es passiert, haengt davon ab, ob unzip beim Beenden von grep noch
    # schreibt: bei kleinen Archiven meist nicht, bei grossen schon. Ein Fehler,
    # der mal auftritt und mal nicht, in einer Sicherheitspruefung.
    local zip_entries
    zip_entries=$(unzip -Z1 "$zip" 2>/dev/null) || zip_entries=""
    if grep -qE '^/|(^|/)\.\.(/|$)' <<<"$zip_entries"; then
        die "ZIP enthaelt unsichere Pfade (absolut oder ../) — abgebrochen."
    fi
    # Zip-Bomben-Schutz: entpackte Gesamtgroesse VOR dem Extrahieren pruefen
    # (unzip -l liest die deklarierten Groessen aus dem Central Directory). Ist
    # sie nicht bestimmbar (z.B. busybox-unzip mit anderem Format), nur warnen
    # statt eine legitime Installation zu blockieren.
    local unpacked
    unpacked=$(unzip -l "$zip" 2>/dev/null | awk 'END {print $1}')
    if [[ "$unpacked" =~ ^[0-9]+$ ]]; then
        (( unpacked <= MAX_UNPACKED )) \
            || die "Archiv entpackt zu gross (${unpacked} > ${MAX_UNPACKED} Bytes) — abgebrochen."
    else
        warn "Archivgroesse nicht bestimmbar (unzip -l) — Zip-Bomben-Cap uebersprungen."
    fi
    unzip -q "$zip" -d "$stage" || die "unzip fehlgeschlagen: $zip"
    # Keine Symlinks im Modul (ein legitimes Modul hat keine) — verhindert, dass
    # cp -a einen aus dem Archiv stammenden Symlink ins Modulverzeichnis kopiert.
    if [[ -n "$(find "$stage" -type l -print -quit 2>/dev/null)" ]]; then
        die "ZIP enthaelt Symlinks — abgebrochen (Sicherheit)."
    fi
    # Keine Spezialdateien (Block-/Char-Devices, Named Pipes, Sockets) — ein
    # legitimes Frontend-Modul besteht nur aus regulaeren Dateien + Verzeichnissen.
    if [[ -n "$(find "$stage" \( -type b -o -type c -o -type p -o -type s \) -print -quit 2>/dev/null)" ]]; then
        die "ZIP enthaelt Geraete-/Pipe-/Socket-Dateien — abgebrochen (Sicherheit)."
    fi
    if   [[ -f "$stage/$MODULE/manifest.json" ]]; then src="$stage/$MODULE"
    elif [[ -f "$stage/manifest.json" ]];         then src="$stage"
    else die "ZIP enthält weder $MODULE/manifest.json noch manifest.json — falsches Archiv?"; fi

    echo "→ Ziel: $mod  (v$(manifest_version "$src/manifest.json" || echo '?'))"

    # Sicherer Swap: alte Version beiseite, neue rein, bei Fehler zurück.
    if [[ -d "$mod" ]]; then prev="$mod.prev.$$"; $SUDO mv "$mod" "$prev" || die "konnte alte Version nicht sichern."; fi
    if $SUDO cp -a "$src" "$mod"; then
        $SUDO chown -R root:root "$mod" 2>/dev/null \
            || warn "chown root:root fehlgeschlagen — als root/sudo laufen oder Dateirechte für den Webserver prüfen."
        # Dateirechte normalisieren: entfernt ungewoehnliche Schreib-/Exec-Bits
        # aus dem Archiv. Verzeichnisse 0755, Dateien 0644 (Webserver liest nur).
        $SUDO find "$mod" -type d -exec chmod 0755 {} + 2>/dev/null || true
        $SUDO find "$mod" -type f -exec chmod 0644 {} + 2>/dev/null || true
        restore_context "$mod"
    else
        $SUDO rm -rf "$mod"
        if [[ -n "$prev" ]]; then
            $SUDO mv "$prev" "$mod" || die "Kopieren UND Restore fehlgeschlagen — alte Version liegt unter: $prev"
        fi
        die "Kopieren fehlgeschlagen — vorherige Version wiederhergestellt."
    fi
    # Erfolg: alte Version → .bak (update, für Rollback) oder weg (install).
    if [[ -n "$prev" ]]; then
        if [[ "$mode" == "update" ]]; then
            $SUDO rm -rf "$mod.bak"
            if $SUDO mv "$prev" "$mod.bak"; then
                echo "→ Backup: $mod.bak"
            else
                warn "Backup-Umbenennung fehlgeschlagen — alte Version liegt unter: $prev"
            fi
        else $SUDO rm -rf "$prev"; fi
    fi

    # Migration 4.x → 5.0: bis 4.38.3 hieß das Verzeichnis network_topology_v6.
    # Bleibt es liegen, registriert Zabbix beide Module und der Menüeintrag
    # erscheint doppelt — deshalb wird genau dieser Konflikt entfernt.
    local moddir legacy
    moddir=$(dirname "$mod")
    if [[ -d "$moddir/network_topology_v6" ]]; then
        if $SUDO rm -rf "$moddir/network_topology_v6"; then
            echo "→ entfernt: network_topology_v6 (Altbestand vor 5.0, sonst doppelter Menüeintrag)"
        else
            warn "konnte $moddir/network_topology_v6 nicht entfernen — bitte von Hand löschen."
        fi
    fi
    # Alte Widgets werden nur gemeldet, nicht gelöscht: sie rufen die entfallenen
    # network.topology.v6.*-Actions und zeigen deshalb ab 5.0 einen Fehler.
    for legacy in network_topology_v6_widget network_topology_v6_health_widget \
                  network_topology_v6_table_widget; do
        if [[ -d "$moddir/$legacy" ]]; then
            warn "Alt-Widget gefunden: $moddir/$legacy — funktioniert ab 5.0 nicht mehr, bitte löschen und die 5.0-Widgets installieren."
        fi
    done

    echo "→ Reload $FPM"
    $SUDO systemctl reload "$FPM" || die "php-fpm reload fehlgeschlagen ($FPM) — Modul liegt, aber Opcache evtl. alt."

    echo
    echo "${C_OK}✓ $mode fertig${C_RST} — $mod (v$(manifest_version "$mod/manifest.json" || echo '?'))"
    if [[ "$mode" == "install" ]]; then
        echo "  Nächster Schritt in der UI: Administration → General → Modules → Scan directory → aktivieren."
    else
        # Der haeufigste Grund fuer "das Update hat etwas kaputt gemacht": neue
        # Actions ohne "Scan directory". Die Karte laedt dann noch, aber alles,
        # was auf eine neue Action zeigt, meldet "Unknown action" — beim Sprung
        # von 5.0 auf 5.1 sind das die manuellen Verbindungen und die
        # gespeicherte Knotenanordnung. Die alte Version lief, die neue nicht,
        # und niemand verbindet das mit einem vergessenen Menuepunkt.
        local new_actions added
        new_actions=$(manifest_actions "$mod/manifest.json")
        added=$(comm -13 <(printf '%s\n' "$old_actions") <(printf '%s\n' "$new_actions") | tr '\n' ' ')
        if [[ -n "${added// /}" ]]; then
            echo
            warn "Neue Actions in dieser Version: ${added% }"
            echo "     ${C_WARN}Administration → General → Modules → \"Scan directory\" ist damit PFLICHT.${C_RST}"
            echo "     Ohne sie bleiben genau diese Funktionen mit \"Unknown action\" stehen."
        fi
        echo "  Browser: Strg+F5.  Rollback bei Problemen:  $0 update --rollback"
    fi
}

cmd_rollback() {
    local mod tmp
    detect_ui; detect_fpm
    mod="$UI/modules/$MODULE"
    [[ -d "$mod.bak" ]] || die "Kein Backup ($mod.bak) — nichts zum Zurückrollen."
    echo "→ Rollback: $mod.bak → $mod"
    tmp="$mod.rollback.$$"
    [[ -d "$mod" ]] && { $SUDO mv "$mod" "$tmp" || die "Rollback: Swap fehlgeschlagen."; }
    if $SUDO mv "$mod.bak" "$mod"; then $SUDO rm -rf "$tmp"
    else [[ -d "$tmp" ]] && $SUDO mv "$tmp" "$mod"; die "Rollback fehlgeschlagen."; fi
    [[ -n "$FPM" ]] && $SUDO systemctl reload "$FPM"
    echo "${C_OK}✓ Rollback fertig${C_RST} — Strg+F5 im Browser."
}

# ── Main ─────────────────────────────────────────────────────────────────
case "${1:-}" in
    check)   cmd_check ;;
    install) zip=$(find_zip "${2:-}") || exit 1; do_deploy install "$zip" ;;
    update)
        if [[ "${2:-}" == "--rollback" ]]; then cmd_rollback
        else zip=$(find_zip "${2:-}") || exit 1; do_deploy update "$zip"; fi ;;
    ""|-h|--help|help) sed -n '3,22p' "$0" | sed 's/^#[[:space:]]\{0,1\}//' ;;
    *) die "Unbekanntes Kommando: ${1:-} (install | update | check)";;
esac
