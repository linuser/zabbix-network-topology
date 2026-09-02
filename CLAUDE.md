# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Diese Datei ist auf Deutsch, wie die Kommentare im Code. Alles, was ein
**Benutzer** liest, ist Englisch — siehe „Sprachregel" unten.

## Was das ist

Ein **Zabbix-Frontend-Modul**: eine eigene Seite unter *Monitoring → Network
Topology*, **kein** Dashboard-Widget. Die fünf `widget*/`-Verzeichnisse sind
optionale Kacheln obendrauf und brauchen Zabbix 7.4; das Hauptmodul läuft auch
auf 7.0 LTS. Diese Unterscheidung wird regelmäßig missverstanden — sie steht
deshalb im ersten Absatz von README und Release-Notes.

## Befehle

```bash
npm run build        # esbuild -> assets/js/dist/nt-bundle.js (eingecheckt!)
./deploy.sh <server> all     # Hauptmodul + Widgets per SSH ausrollen
```

**Die vollständige Gate-Kette — alle zwölf, nicht nur die Node-Gates:**

```bash
npm run build && npm run ci:lint-php && npm run ci:test && npm run ci:eslint \
  && npm run ci:xss && npm run ci:parity && npm run ci:templates \
  && npm run ci:package && npm run ci:layers && npm run ci:i18n \
  && npm run ci:pipeline && npm run ci:shellcheck
```

`ci:lint-php` und `ci:test` brauchen `php` — **das ist installiert**
(`/opt/homebrew/bin/php`). Sie zu überspringen hat schon einmal einen
PHP-Fatal durchrutschen lassen (ein doppeltes `use` nach einem Merge, den git
konfliktfrei zusammenführte). „Alle Gates grün" heißt zwölf, nicht neun.

Einzelnen Test fahren — kein PHPUnit, kein DB-Zugriff, reines PHP:

```bash
php tests/LldpEdgeBuilderTest.php
```

`ci:bundle-drift` fehlt in der Kette oben, weil es nach `npm run build` nur
prüft, ob das Bundle eingecheckt ist. **Das gebaute Bundle gehört in den
Commit** — das Modul soll sich ohne Node installieren lassen.

## Architektur

Drei Schichten, und die Trennung ist der Punkt:

- **`actions/` (19 Controller)** — HTTP-Rand. Rate-Limiting, CSRF, Rechte,
  JSON. `NetworkTopologyData` ist der teuerste und wichtigste: er baut den
  gesamten Graphen. `NetworkTopologyView` rendert die Seite **und** legt die
  Konfiguration als `NT_CONFIG` ins DOM — unter anderem die manuellen
  Verbindungen. Widgets haben keinen solchen View-Controller; was nur dort
  liegt, sehen sie nie.
- **`topology/` (10 Klassen)** — reine Logik ohne Zabbix-Abhängigkeiten,
  deshalb testbar. Hier lebt alles Interessante: `LldpEdgeBuilder` (Kanten aus
  SNMP-Nachbartabellen), `NodeBuilder`, `ManualLinks`, `SharedLayerFilter`.
- **`assets/js/` → ein Bundle.** `network-topology.js` ist nur Orchestrator;
  der Renderer liegt in `modules/render-*.js` (10 davon, 46 Module insgesamt). Cytoscape.js für den
  Graphen, Leaflet für Geo.

### Zwei-Ebenen-Speicherung

Positionen und manuelle Links existieren **doppelt**: geteilt in
`module.config` (nur Super-Admins schreiben) und persönlich in `CProfile`.
Beim Lesen gilt:

- **Positionen:** persönlich gewinnt **pro Knoten** — nicht als Ganzes, sonst
  verdeckt ein einziger eigener Speichervorgang die geteilte Karte für immer.
- **Links:** geteilt gewinnt, damit dieselbe Kante nicht doppelt erscheint.

`npm run ci:layers` prüft das mit gestellten Daten, jedes Szenario in einem
eigenen Prozess (`storage.js` liest die Konfiguration beim Import).

### Die absichtlichen Duplikate

Widgets können den Code des Hauptmoduls **nicht** importieren — Zabbix'
jsLoader kennt keine ES-Module. Zwei Dinge existieren deshalb zweimal, und
`ci:parity` bewacht beide:

- die **Health-Score-Formel** (`render-health.js` ↔ `widget_health/`)
- der **geteilte Datenzugriff** `window.NtWidgetData` — byteweise identisch in
  vier Widget-Dateien. `widget_items` gehört bewusst nicht dazu, es holt seine
  Daten über eine andere Action.

Eine Stelle ändern heißt: die andere mitändern.

## Sprachregel

- **Kommentare: Deutsch.** Bleibt so. Neue Kommentare auf Englisch sind
  trotzdem willkommen — niemand muss den Rest übersetzen.
- **Alles, was ein Benutzer liest: Englisch.** `npm run ci:i18n` erzwingt das.
  - Hauptmodul-JS → `t()`, Schlüssel in `i18n/de.js` **und** `en.js` (beide
    müssen dieselben Schlüssel tragen)
  - PHP → `_('English text')`, Zabbix' eigene Übersetzungsfunktion
  - **Widgets → schlicht Englisch.** Dort gibt es kein `t()`.

## Code-Stil

- **PHP:** `declare(strict_types = 1)`, Zabbix-API (`API::…->get()`) statt
  direktem DB-Zugriff, vom Client gelieferte IDs immer gegen die API schneiden.
- **JS Hauptmodul:** ES-Module, Ziel ES2019.
- **JS Widgets (`widget*/`):** **ES5** — keine Template-Literale, kein Spread,
  keine Pfeilfunktionen, `var` statt `const`/`let`. Der jsLoader verlangt es.
- Kommentare erklären **warum**, nicht was. Der Stil im Bestand ist
  ausführlich und nennt den Vorfall, der eine Regel ausgelöst hat — das ist
  gewollt, nicht Redundanz.

## Sicherheit

Alles, was von Zabbix oder aus dem Netz kommt — Host-/Item-Namen, Notizen, IPs,
und vor allem **LLDP/CDP-Nachbarnamen von fremden Geräten** — muss durch `esc()`
(`modules/utils.js`) oder über `textContent`. Zwei Gates prüfen das:
`ci:xss` (grep-Stolperdraht) und `ci:eslint` (`no-unsanitized`).
`eslint-suppressions.json` enthält die historisch gewachsenen Altfälle;
**dort etwas einzutragen ist kein Weg**, ein Gate stillzulegen.

## Vor dem Push

`ci:pipeline` hat als einziges Gate **keinen GitLab-Job** — es prüft
`.gitlab-ci.yml` selbst, und eine kaputte CI-Datei lässt dort keinen Job mehr
laufen. Auf GitHub läuft es als Schritt in `gates.yml`; lokal gehört es
trotzdem vor den Push. Wer ein Gate ergänzt, ergänzt es in `.gitlab-ci.yml`
**und** `.github/workflows/gates.yml`; `ci:pipeline` fällt sonst.

Die Begründung zu jedem Gate — jeweils mit dem Vorfall, der es ausgelöst hat —
steht in [CONTRIBUTING.md](CONTRIBUTING.md) unter „Was die CI hart erzwingt".

## Umgebung

- **Docker-Images fehlen lokal**, Docker Hub antwortet mit 403.
  `tools/clean-install-test/` läuft deshalb nicht auf diesem Rechner, wohl aber
  auf `app.fox1.de`, wo die Images liegen.
- Beim Packen auf dem Mac `COPYFILE_DISABLE=1 tar …` setzen, sonst legt bsdtar
  zu jeder Datei ein AppleDouble-`._*` an — die landen sonst unter dem Web-Root.
- Release-ZIPs mit `zip -rq` bauen, **ohne** `-X`: das ist der Weg, den
  `deploy.sh` geht, und `-X` erzeugt abweichende Bytes.
