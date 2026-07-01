#!/usr/bin/env bash
#
# deploy.sh — Deploy Zabbix Network Topology v6 auf einen Ziel-Server.
#
# Verwendung:
#   ./deploy.sh <server>              # nur Hauptmodul
#   ./deploy.sh <server> all          # Hauptmodul + beide Widgets
#   ./deploy.sh <server> widgets      # nur die Widgets (Hauptmodul schon da)
#
# Voraussetzungen auf dem Ziel:
#   - Zabbix 7.4+
#   - PHP 8.x + php-fpm
#   - unzip, sudo (fuer den SSH-User)
#   - SSH-Zugang mit Public-Key
#
# Fuehrt aus:
#   1. Build der Zips im lokalen /tmp
#   2. SCP zum Ziel-Server nach /tmp
#   3. Autodetect: PHP-FPM-Service + Zabbix-UI-Pfad
#   4. Entpacken nach <ui>/modules/
#   5. chown root:root
#   6. Reload php-fpm
#
# Nach dem Deploy MUSS in der Zabbix-UI:
#   Administration → General → Modules → Scan directory
# aufgerufen werden, damit Zabbix die neuen/geaenderten Actions erkennt.

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────
readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly TMP_MAIN="/tmp/network_topology_v6.zip"
readonly TMP_WIDGET="/tmp/network_topology_v6_widget.zip"
readonly TMP_HEALTH="/tmp/network_topology_v6_health_widget.zip"
readonly REMOTE_MAIN="/tmp/network_topology_v6.zip"
readonly REMOTE_WIDGET="/tmp/network_topology_v6_widget.zip"
readonly REMOTE_HEALTH="/tmp/network_topology_v6_health_widget.zip"

# ── Arg-Parsing ────────────────────────────────────────────────────────────
if [[ $# -lt 1 ]]; then
    cat >&2 <<EOF
Usage: $0 <server> [main|widgets|all]
  main    (Default) — nur das Hauptmodul
  widgets           — nur die beiden Widget-Module
  all               — Hauptmodul + Widgets
EOF
    exit 1
fi
readonly SERVER="$1"
readonly MODE="${2:-main}"

case "$MODE" in
    main|widgets|all) ;;
    *) echo "❌ Ungueltiger Modus: $MODE (main|widgets|all)" >&2; exit 1 ;;
esac

# ── SSH-Reachability testen ────────────────────────────────────────────────
echo "→ Test SSH-Zugang: $SERVER"
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$SERVER" "true" 2>/dev/null; then
    echo "❌ SSH zu $SERVER fehlgeschlagen. Public-Key im ~/.ssh/authorized_keys?" >&2
    exit 1
fi

# ── Remote-Umgebung autodetecten ───────────────────────────────────────────
echo "→ Autodetect PHP-FPM-Service + Zabbix-UI-Pfad auf $SERVER"
REMOTE_ENV=$(ssh "$SERVER" bash <<'REMOTE_EOF'
set -e
# PHP-FPM-Service: die genaue Version finden (php8.2-fpm, php8.3-fpm, ...)
fpm=$(systemctl list-units --type=service --all 2>/dev/null \
      | awk '/^\s*php[0-9.]+-fpm\.service/ {print $1; exit}' \
      | sed 's/\.service$//')
if [[ -z "$fpm" ]]; then
    # RedHat/Rocky nutzen manchmal einfach "php-fpm"
    if systemctl list-units --type=service --all 2>/dev/null | grep -q '^\s*php-fpm\.service'; then
        fpm="php-fpm"
    fi
fi

# Zabbix-UI-Pfad: der Ordner in dem /modules/ liegt
for candidate in /usr/share/zabbix/ui /var/www/html/zabbix/ui /var/www/zabbix/ui /usr/share/zabbix; do
    if [[ -d "$candidate/modules" ]] || [[ -d "$candidate/local/frontends/php/include/classes" ]]; then
        ui="$candidate"
        break
    fi
done

echo "FPM=${fpm:-NONE}"
echo "UI=${ui:-NONE}"
REMOTE_EOF
)

FPM_SERVICE=$(echo "$REMOTE_ENV" | grep '^FPM=' | cut -d= -f2)
UI_PATH=$(echo "$REMOTE_ENV" | grep '^UI=' | cut -d= -f2)

if [[ "$FPM_SERVICE" == "NONE" || -z "$FPM_SERVICE" ]]; then
    echo "❌ Kein php-fpm-Service auf $SERVER gefunden." >&2
    exit 1
fi
if [[ "$UI_PATH" == "NONE" || -z "$UI_PATH" ]]; then
    echo "❌ Zabbix-UI-Pfad auf $SERVER nicht gefunden. Manuell setzen:" >&2
    echo "   export ZBX_UI_PATH=/pfad/zu/zabbix/ui" >&2
    exit 1
fi

readonly REMOTE_MODULES="$UI_PATH/modules"
echo "  php-fpm:    $FPM_SERVICE"
echo "  UI-Pfad:    $UI_PATH"
echo "  Modules:    $REMOTE_MODULES"

# ── Zips lokal bauen ───────────────────────────────────────────────────────
echo "→ Baue Zips lokal"
if [[ "$MODE" == "main" || "$MODE" == "all" ]]; then
    STAGE=$(mktemp -d)
    rsync -a \
        --exclude '.git' --exclude '.claude' --exclude '.vscode' --exclude '.idea' \
        --exclude 'widget' --exclude 'widget_health' --exclude 'dashboards' \
        --exclude '.DS_Store' --exclude '*.zip' --exclude 'dist' \
        --exclude 'nt_smtp_password' --exclude '.gitignore' --exclude 'deploy.sh' \
        "$SCRIPT_DIR/" "$STAGE/network_topology_v6/"
    rm -f "$TMP_MAIN"
    (cd "$STAGE" && zip -rq "$TMP_MAIN" network_topology_v6)
    rm -rf "$STAGE"
    echo "  → $TMP_MAIN ($(du -h "$TMP_MAIN" | cut -f1))"
fi
if [[ "$MODE" == "widgets" || "$MODE" == "all" ]]; then
    rm -f "$TMP_WIDGET" "$TMP_HEALTH"
    (cd "$SCRIPT_DIR/widget"        && zip -rq "$TMP_WIDGET" .)
    (cd "$SCRIPT_DIR/widget_health" && zip -rq "$TMP_HEALTH" .)
    echo "  → $TMP_WIDGET ($(du -h "$TMP_WIDGET" | cut -f1))"
    echo "  → $TMP_HEALTH ($(du -h "$TMP_HEALTH" | cut -f1))"
fi

# ── SCP zum Server ─────────────────────────────────────────────────────────
echo "→ SCP zum Server"
if [[ "$MODE" == "main"    || "$MODE" == "all" ]]; then scp -q "$TMP_MAIN"   "$SERVER:$REMOTE_MAIN"; fi
if [[ "$MODE" == "widgets" || "$MODE" == "all" ]]; then
    scp -q "$TMP_WIDGET" "$SERVER:$REMOTE_WIDGET"
    scp -q "$TMP_HEALTH" "$SERVER:$REMOTE_HEALTH"
fi

# ── Installieren auf dem Server ────────────────────────────────────────────
echo "→ Installiere auf $SERVER"
ssh "$SERVER" bash -s <<REMOTE_INSTALL
set -e
cd "$REMOTE_MODULES"
$([[ "$MODE" == "main" || "$MODE" == "all" ]] && cat <<'MAIN'
sudo rm -rf network_topology_v6
sudo unzip -q "$REMOTE_MAIN"
sudo chown -R root:root network_topology_v6
MAIN
)
$([[ "$MODE" == "widgets" || "$MODE" == "all" ]] && cat <<'WIDGETS'
sudo rm -rf network_topology_v6_widget network_topology_v6_health_widget
sudo mkdir network_topology_v6_widget network_topology_v6_health_widget
sudo unzip -q "$REMOTE_WIDGET" -d network_topology_v6_widget
sudo unzip -q "$REMOTE_HEALTH" -d network_topology_v6_health_widget
sudo chown -R root:root network_topology_v6_widget network_topology_v6_health_widget
WIDGETS
)
sudo systemctl reload "$FPM_SERVICE"
echo "  deployed: \$(date)"
REMOTE_INSTALL

# ── Fertig ─────────────────────────────────────────────────────────────────
cat <<EOF

✓ Deploy fertig auf $SERVER

Naechste Schritte in der Zabbix-UI:
  1. Administration → General → Modules → Scan directory
  2. Betroffene Module aktivieren:
       Network Topology v6              (Hauptmodul)
       Network Topology v6 Widget       (Topology-Widget)
       NT Health Score Widget           (Health-Widget)
  3. Aufruf via Monitoring → Network Topology v6

Optional: Integration-Links via Global-Macros
  Administration → General → Macros
    {\$NT_INT_NETBOX_LABEL} = NetBox
    {\$NT_INT_NETBOX_URL}   = https://netbox.example.com/dcim/devices/?q={host}
EOF
