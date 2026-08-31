#!/usr/bin/env bash
#
# build-module.sh — stellt das Modul unter ./module/network_topology/
# zusammen, byte-genau wie der Inhalt des Release-ZIP (gleiche Excludes wie
# deploy.sh). Dann per docker-compose read-only in die Zabbix-Web-Instanz
# gemountet -> testet den ECHTEN Auslieferungsstand, nicht den Repo-Baum.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DEST="$HERE/module/network_topology"

echo "→ Bundle bauen (esbuild)"
( cd "$REPO" && npm run build >/dev/null )

echo "→ Modul stagen (Ausschluesse aus deploy.sh)"
rm -rf "$HERE/module"
mkdir -p "$DEST"

# Die Liste wird GELESEN, nicht wiederholt — dieselbe Ueberlegung wie in
# tools/check-package.mjs: eine zweite Liste ist eine zweite Stelle, die
# auseinanderlaeuft. Und genau das war passiert. Hier fehlten 'widget_kpi'
# und 'widget_items', und 'nt-install.sh' stand namentlich da, wo deploy.sh
# laengst das Muster 'nt-*.sh' hat. Dieses Skript baut also ein Paket, das
# "byte-genau wie das Release-ZIP" heisst und drei Dinge mehr enthielt —
# ausgerechnet der Test, der den Auslieferungsstand pruefen soll.
excl_args=()
n_pat=0
while IFS= read -r pat; do
    excl_args+=(--exclude "$pat")
    n_pat=$((n_pat + 1))
done < <(grep -oE -- "--exclude '[^']+'" "$REPO/deploy.sh" | sed -E "s/^--exclude '//; s/'$//")

# Eigener Zaehler statt ${#excl_args[@]}: das Array traegt zwei Eintraege je
# Muster ('--exclude' und das Muster), die Laenge waere also das Doppelte.
if [[ $n_pat -lt 10 ]]; then
    echo "✗ Ausschlussliste aus deploy.sh nicht lesbar ($n_pat Muster gefunden)." >&2
    echo "  Hat sich der rsync-Aufruf dort geaendert? Dann muss dieses Skript mit." >&2
    exit 1
fi
echo "  $n_pat Muster aus deploy.sh uebernommen"

rsync -a "${excl_args[@]}" "$REPO/" "$DEST/"

echo "✓ fertig: $DEST"
echo "  jetzt:  docker compose up -d   (dann http://localhost:8080, Admin/zabbix)"
