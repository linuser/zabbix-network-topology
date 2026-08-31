#!/usr/bin/env bash
#
# smoke.sh — der automatisierbare Teil des Clean-Install-Tests.
#
# WARUM NICHT DER GANZE TEST
# --------------------------
# Der Test daneben (README.md) ist bewusst manuell: er klickt sich durch die
# Oberflaeche und braucht dafuer eine Anmeldung. Zabbix hat ausserdem keine
# API fuer "Scan directory" — ein Modul aktiviert man im Frontend. Beides ist
# nicht sinnvoll zu skripten.
#
# Was sich OHNE Anmeldung pruefen laesst, ist trotzdem der Teil, der am
# haeufigsten bricht:
#
#   1. Laesst sich das Modul ueberhaupt paketieren?
#   2. Kommt das Frontend hoch, wenn das Modul gemountet ist? Ein Parse- oder
#      Fatal-Error im Modulcode legt PHP lahm, bevor irgendjemand etwas
#      anklickt.
#   3. Laeuft der Modulcode durch die PHP-Version des ECHTEN Zabbix-Images?
#      Unser php-lint-Job nutzt php:8.2-cli-alpine — das Web-Image kann eine
#      andere Version fahren.
#   4. Werden die Assets ueber den Web-Root ausgeliefert? Ein 404 auf das
#      Bundle sieht in der UI aus wie "Modul kaputt".
#   5. Steht nach alledem etwas im PHP-Fehlerlog?
#
# Was der Test NICHT abdeckt, steht ehrlich am Ende der Ausgabe.
#
# Aufruf:  tools/clean-install-test/smoke.sh
# Braucht: docker + docker compose. Raeumt am Ende selbst auf.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

MOUNT=/usr/share/zabbix/modules/network_topology
BASE=http://127.0.0.1:8080
fails=0

note() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  [ ok ] %s\n' "$1"; }
bad()  { printf '  [FAIL] %s\n' "$1"; fails=$((fails + 1)); }

# Zwei Codes fuer denselben Sachverhalt, je nach shellcheck-Version: 0.11
# meldet SC2329 ("function never invoked"), aeltere Fassungen SC2317
# ("command appears to be unreachable") an den Zeilen im Rumpf. Beide sehen
# den Aufruf ueber 'trap cleanup EXIT' nicht. Lokal faellt nur der eine auf —
# der andere kam vom GitHub-Runner, der eine aeltere Version mitbringt.
# shellcheck disable=SC2329,SC2317
cleanup() {
    note "Aufraeumen"
    docker compose down -v >/dev/null 2>&1 || true
    # '|| true' wie eine Zeile darueber: unter 'set -e' bestimmt der LETZTE
    # Befehl des EXIT-Traps den Rueckgabewert des Skripts. Ein rm, das an
    # Dateirechten scheitert, faerbt den Job damit rot, obwohl jede Pruefung
    # bestanden hat — nachgestellt, es passiert wirklich.
    rm -rf "$HERE/module" || true
}
trap cleanup EXIT

note "1. Modul paketieren"
if ./build-module.sh >/dev/null 2>&1; then
    ok "build-module.sh durchgelaufen ($(find module -type f | wc -l | tr -d ' ') Dateien)"
else
    bad "build-module.sh gescheitert"
    exit 1
fi

note "2. Zabbix hochfahren"
docker compose up -d >/dev/null 2>&1
printf '  warte auf das Frontend '
up=0
for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$BASE/index.php" 2>/dev/null; then up=1; break; fi
    printf '.'
    sleep 5
done
printf '\n'
if [ "$up" = 1 ]; then
    ok "Frontend antwortet — PHP laeuft mit gemountetem Modul"
else
    bad "Frontend kam nicht hoch (300 s). Letzte Logzeilen:"
    docker compose logs --tail 25 web | sed 's/^/         /'
    exit 1
fi

note "3. PHP-Lint mit der PHP-Version des Zabbix-Images"
php_ver=$(docker compose exec -T web php -v 2>/dev/null | head -1 || echo '?')
printf '  Image-PHP: %s\n' "$php_ver"
if docker compose exec -T web sh -c \
     "find $MOUNT -name '*.php' -print0 | xargs -0 -n1 php -l" >/tmp/nt_smoke_lint 2>&1; then
    ok "$(grep -c 'No syntax errors' /tmp/nt_smoke_lint) Dateien fehlerfrei"
else
    bad "Syntaxfehler unter der Image-PHP-Version:"
    grep -v 'No syntax errors' /tmp/nt_smoke_lint | head -10 | sed 's/^/         /'
fi

note "4. Assets ueber den Web-Root"
for asset in \
    assets/js/dist/nt-bundle.js \
    assets/js/cytoscape.min.js \
    assets/css/network-topology.css
do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/modules/network_topology/$asset")
    if [ "$code" = 200 ]; then ok "$asset → 200"
    else bad "$asset → $code"; fi
done

note "5. PHP-Fehlerlog"
errs=$(docker compose logs web 2>&1 | grep -iE 'PHP (Fatal|Parse|Warning)' | grep -i 'network_topology' || true)
if [ -z "$errs" ]; then
    ok "keine Modul-bezogenen PHP-Fehler"
else
    bad "PHP-Fehler im Log:"
    printf '%s\n' "$errs" | head -10 | sed 's/^/         /'
fi

note "Ergebnis"
if [ "$fails" -eq 0 ]; then
    printf '  smoke.sh: alle Pruefungen bestanden\n'
else
    printf '  smoke.sh: %s Problem(e)\n' "$fails"
fi
cat <<'LIMITS'

  NICHT abgedeckt — das bleibt der manuelle Test in README.md:
    - "Scan directory" und Aktivieren des Moduls (keine Zabbix-API dafuer)
    - Rendern der Seite, Tabs, Browser-Console
    - Rechte, CSRF, CProfile, geteilte vs. persoenliche Ebene
    - Zabbix 7.0 (dieses Compose faehrt 7.4; docker-compose.7.0.yml daneben)
LIMITS

if [ "$fails" -eq 0 ]; then
    exit 0
fi
exit 1
