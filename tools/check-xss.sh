#!/usr/bin/env bash
#
# check-xss.sh — heuristischer XSS-Tripwire fuer das Frontend.
#
# Sucht Zeilen, in denen ein untrusted-aussehender Zabbix-/Netzwerk-Wert
# (Host-/Gruppen-/Proxy-/Trigger-/Item-Name, Notiz, LLDP-Nachbar, IP …)
# in einen HTML-Kontext (innerHTML / HTML-String-Konkatenation) geht, OHNE
# durch esc() zu laufen.
#
# WICHTIG: Das ist eine HEURISTIK, kein Beweis. Mehrzeilige HTML-Strings,
# ueber Aliase umbenannte Variablen und vorab-escapte Werte kann ein Grep
# nicht sauber aufloesen — echte Sicherheit liefert nur Code-Review + die
# Konvention (siehe README, Abschnitt "Escaping-Konvention"). Der Tripwire
# ist dazu da, NEUE offensichtliche Luecken im Review/CI aufzuzeigen.
#
# Verwendung:
#   tools/check-xss.sh            # advisory: listet Verdachtsfaelle, Exit 0
#   tools/check-xss.sh --strict   # Exit 1 wenn Verdachtsfaelle (fuer CI)
#
# Stand: auf dem aktuellen Code 0 Treffer (das Audit war sauber). Ein neuer
# Treffer bedeutet: pruefen, ob dort esc() fehlt.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# ALLE JS-Verzeichnisse des Moduls — inklusive der drei Widget-Module. Die
# Widget-Klassen bauen ihr HTML ebenfalls per String-Konkatenation, liefen aber
# bis v4.38.2 durch KEIN Gate (weder hier noch in eslint), weil beide nur
# assets/js kannten. Ihr Escaping heisst dort this._esc() — der 'esc('-Filter
# unten greift dadurch automatisch.
JS_DIRS=("$ROOT/assets/js")
for _w in "$ROOT"/widget*/assets/js; do
    [[ -d "$_w" ]] && JS_DIRS+=("$_w")
done
STRICT=0
[[ "${1:-}" == "--strict" ]] && STRICT=1

# Untrusted-Property-Heuristik (Werte, die aus Zabbix/vom Netz stammen).
# Hinweis: '.key' bewusst NICHT drin — es tritt fast nur als Objekt-Index
# (h.checks[c.key]) und als STATISCHER Check-/Preset-Identifier auf, nicht als
# in HTML interpolierter Item-Key; Item-Keys sind im Audit ohnehin alle esc()t.
UNTRUSTED='\.(label|host|name|proxy_name|proxy_group_name|note|raw|ip|iftype|desc|message)\b|\b(neighbor|sysName|hostname|srcLabel|tgtLabel)\b'

# Kandidaten: Zeile konkateniert einen untrusted Wert per '+' in einen
# String UND wirkt HTML-artig (enthaelt '<' oder innerHTML/insertAdjacentHTML/
# document.write), aber KEIN esc( auf derselben Zeile. Sichere Nicht-HTML-
# Senken (textContent/.style/.title/dataset/…) werden ausgefiltert.
mapfile -t hits < <(
  grep -rnE "(innerHTML|insertAdjacentHTML|document\.write|<[a-zA-Z/]|>['\"])" "${JS_DIRS[@]}" --include='*.js' 2>/dev/null \
    | grep -vE '/(leaflet|cytoscape|cola|dagre|dist)' \
    | grep -E "\+[^+]*($UNTRUSTED)" \
    | grep -v 'esc(' \
    | grep -vE '\.textContent|\.style|\.title *=|\.dataset|\.value\b|createElement|getElementById|querySelector|addEventListener|classList|^\s*[0-9]+:\s*//' \
    || true
)

if [[ ${#hits[@]} -eq 0 ]]; then
    echo "✓ check-xss: keine offensichtlichen unescapten untrusted->HTML-Stellen."
    exit 0
fi

echo "⚠ check-xss: ${#hits[@]} Verdachtsfall/-faelle (untrusted Wert -> HTML ohne esc() auf der Zeile):"
echo "  Bitte pruefen: fehlt esc()? Oder ist es ein Fehlalarm (Wert vorab escaped / textContent)?"
echo
for h in "${hits[@]}"; do
    echo "  $h"
done
echo
[[ $STRICT -eq 1 ]] && exit 1
exit 0
