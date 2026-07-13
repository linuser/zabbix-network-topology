#!/usr/bin/env bash
#
# build-module.sh — stellt das Modul unter ./module/network_topology_v6/
# zusammen, byte-genau wie der Inhalt des Release-ZIP (gleiche Excludes wie
# deploy.sh). Dann per docker-compose read-only in die Zabbix-Web-Instanz
# gemountet -> testet den ECHTEN Auslieferungsstand, nicht den Repo-Baum.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DEST="$HERE/module/network_topology_v6"

echo "→ Bundle bauen (esbuild)"
( cd "$REPO" && npm run build >/dev/null )

echo "→ Modul stagen (Release-ZIP-Excludes)"
rm -rf "$HERE/module"
mkdir -p "$DEST"
rsync -a \
    --exclude '.git' --exclude '.claude' --exclude '.vscode' --exclude '.idea' \
    --exclude 'widget' --exclude 'widget_health' --exclude 'dashboards' \
    --exclude 'tools' --exclude 'templates' \
    --exclude 'node_modules' --exclude 'package.json' --exclude 'package-lock.json' \
    --exclude '.DS_Store' --exclude '*.zip' \
    --exclude 'nt_smtp_password' --exclude '.gitignore' --exclude 'deploy.sh' --exclude 'nt-install.sh' \
    "$REPO/" "$DEST/"

echo "✓ fertig: $DEST"
echo "  jetzt:  docker compose up -d   (dann http://localhost:8080, Admin/zabbix)"
