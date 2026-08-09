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
readonly MIN_MAJOR=7 MIN_MINOR=4
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
detect_fpm() {   # FPM leer, wenn kein Service gefunden — Aufrufer prüft.
    FPM=$(systemctl list-units --type=service --all 2>/dev/null \
          | awk '/php[0-9.]+-fpm\.service/ {print $1; exit}' | sed 's/\.service$//') || true
    if [[ -z "$FPM" ]] && systemctl list-units --type=service --all 2>/dev/null | grep -q 'php-fpm\.service'; then
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
        local rf
        for rf in "${REQUIRED_FILES[@]}"; do
            [[ -r "$mod/$rf" ]] && ok "Datei: $rf" || { bad "fehlt/nicht lesbar: $rf"; rc=1; }
        done
    else
        bad "Modulverzeichnis fehlt: $mod"; rc=1
        local wrong
        wrong=$(find "$UI/modules" -maxdepth 1 -type d -iname '*network*topolog*' 2>/dev/null \
                | grep -v "/$MODULE$" | head -1) || true
        [[ -n "$wrong" ]] && warn "unter falschem Namen gefunden: $wrong  → mv nach $MODULE"
    fi

    if command -v php >/dev/null 2>&1; then
        local pv; pv=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;' 2>/dev/null) || true
        [[ "${pv%%.*}" == "8" ]] && ok "PHP: $pv" || warn "PHP ${pv:-?} — empfohlen 8.x"
    else warn "php-CLI nicht gefunden (php-fpm kann trotzdem laufen)"; fi

    detect_fpm
    if [[ -n "$FPM" ]]; then
        systemctl is-active --quiet "$FPM" 2>/dev/null && ok "php-fpm: $FPM (aktiv)" || warn "php-fpm: $FPM (nicht aktiv?)"
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

    stage=$(mktemp -d) || die "mktemp fehlgeschlagen — kein beschreibbares TMP?"
    _CLEAN="$stage"
    # Zip-Slip-Schutz: keine absoluten (/…) oder ../-Pfade im Archiv — unabhaengig
    # von der unzip-Implementierung geprueft (busybox-unzip filtert nicht immer).
    if unzip -Z1 "$zip" 2>/dev/null | grep -qE '^/|(^|/)\.\.(/|$)'; then
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
            $SUDO mv "$prev" "$mod.bak" && echo "→ Backup: $mod.bak" \
                || warn "Backup-Umbenennung fehlgeschlagen — alte Version liegt unter: $prev"
        else $SUDO rm -rf "$prev"; fi
    fi

    # Migration 4.x → 5.0: bis 4.38.3 hieß das Verzeichnis network_topology_v6.
    # Bleibt es liegen, registriert Zabbix beide Module und der Menüeintrag
    # erscheint doppelt — deshalb wird genau dieser Konflikt entfernt.
    local moddir legacy
    moddir=$(dirname "$mod")
    if [[ -d "$moddir/network_topology_v6" ]]; then
        $SUDO rm -rf "$moddir/network_topology_v6" \
            && echo "→ entfernt: network_topology_v6 (Altbestand vor 5.0, sonst doppelter Menüeintrag)" \
            || warn "konnte $moddir/network_topology_v6 nicht entfernen — bitte von Hand löschen."
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
    ""|-h|--help|help) sed -n '3,22p' "$0" | sed 's/^#\s\?//' ;;
    *) die "Unbekanntes Kommando: ${1:-} (install | update | check)";;
esac
