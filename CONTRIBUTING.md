# Beitragen

Danke fürs Interesse! Dieses Modul ist ein Freizeitprojekt — Rückmeldungen und
Patches sind willkommen, brauchen aber manchmal etwas Geduld.

**Sicherheitslücken bitte nicht als Issue** melden, sondern vertraulich per Mail:
siehe [SECURITY.md](SECURITY.md).

## Bug melden

Ein [Issue](https://github.com/linuser/zabbix-network-topology/issues) mit:

- **Modul-Version** (Footer der Modul-Seite oder `manifest.json`)
- **Zabbix-Version** und **PHP-Version**
- bei fehlenden Kanten: **SNMP-Vendor** des Geräts → vorher die Vendor-Matrix in
  [LLDP-SETUP.md](LLDP-SETUP.md) prüfen, viele „keine Kanten"-Fälle stehen dort
- bei JS-Problemen: die Meldung aus der **Browser-Konsole** (F12)

## Entwicklungs-Setup

```bash
npm install          # nur esbuild, sonst keine Laufzeit-Abhängigkeiten
npm run build        # -> assets/js/dist/nt-bundle.js
```

Zum Testen gegen ein echtes Zabbix: `./deploy.sh <server>` rollt das Modul per
SSH aus. Für eine Wegwerf-Instanz siehe
[`tools/clean-install-test/`](tools/clean-install-test/) (Docker, Zabbix 7.4 oder
7.0 LTS).

## Was die CI hart erzwingt

Das sind die Stolperfallen — ein erster Patch fällt sonst durch die Pipeline,
ohne dass klar ist warum:

1. **Das gebaute Bundle gehört mit in den Commit.** `assets/js/dist/nt-bundle.js`
   ist absichtlich eingecheckt, damit das Modul ohne Node installierbar ist
   (INSTALL.md: „Keine Build-Tools nötig"). Der Job `bundle-drift` baut neu und
   vergleicht — wer JS ändert, muss `npm run build` laufen lassen **und** das
   Ergebnis committen.

2. **Keine neuen unescapten DOM-Sinks.** Alles, was aus Zabbix oder vom Netz
   kommt — Host-/Item-/Proxy-Namen, Notizen, IPs und besonders
   **LLDP/CDP-Nachbarnamen, die von fremden Geräten stammen** — muss vor dem
   Einfügen ins DOM durch `esc()` (`assets/js/modules/utils.js`) laufen oder über
   `textContent` gesetzt werden. Zwei Gates prüfen das:
   `npm run ci:xss` (Grep-Tripwire) und `npm run ci:eslint`
   (`no-unsanitized`). Beide decken auch die Widget-Module ab.

3. **Die ESLint-Baseline darf nicht wachsen.** `eslint-suppressions.json`
   enthält die ~100 historisch gewachsenen `innerHTML`-Stellen, die intern
   sauber escapen. Neue Einträge dort sind kein akzeptierter Weg, um das Gate
   ruhigzustellen — neuer Code soll ohne Suppression auskommen.

4. **Die beiden bewussten Duplikate müssen synchron bleiben.** Die
   Widget-Module können den Code des Hauptmoduls nicht importieren — Zabbix'
   jsLoader kennt keine ES-Module. Zweimal steht deshalb dasselbe da, und
   `npm run ci:parity` bewacht beide Stellen:

   - Die **Health-Score-Formel** in `assets/js/modules/render-health.js` und
     `widget_health/`. Gewichte und Schwellen werden verglichen. Läuft das
     auseinander, zeigt dieselbe Hostgroup auf der Karte und im Dashboard
     verschiedene Scores — und niemand sieht, welcher stimmt.
   - Der **geteilte Datenzugriff** (`window.NtWidgetData`) in vier
     Widget-Dateien. Byte-Vergleich: liefe eine Kopie mit anderem TTL oder
     Cache-Schlüssel, hinge das Verhalten des Dashboards an der
     Ladereihenfolge — ein Fehler, der sich nicht reproduzieren lässt.

   Wer eine der Stellen ändert, ändert die andere mit. Das Gate sagt genau,
   welche Datei ausschert.

5. **Die mitgelieferten Templates müssen importierbar bleiben.** Zabbix 7.0
   verlangt in `template_groups` ein `uuid`; fehlt es, weist der Import die
   Datei ab. Zwei der drei Templates waren so unterwegs, obwohl INSTALL.md
   ihren Import als Schritt 4 empfiehlt — gemerkt hat es erst ein Nutzer.
   `npm run ci:templates` prüft:

   - Jeder Gruppeneintrag hat ein `uuid`.
   - Derselbe Gruppenname trägt in **allen** Dateien dasselbe `uuid`.
   - Dasselbe `uuid` hängt an **genau einem** Gruppennamen.

   Zabbix ordnet Gruppen über das `uuid` zu, nicht über den Namen, und die
   Werte sind auf jeder Installation gleich. Sie stehen in der Tabelle
   `hstgrp` — dort nachsehen statt raten oder aus einer anderen Datei
   abschreiben:

   | Gruppe | `uuid` |
   |---|---|
   | `Templates` | `79f31eeab03146229b1e019097fad672` |
   | `Templates/Network devices` | `7df96b18c230490a9a0a9e2307226338` |

   Die dritte Regel gibt es, weil beim Reparieren der ersten genau das
   passiert ist: die `uuid` wurde aus dem funktionierenden Template kopiert,
   in der Annahme, sie gehöre zu `Templates` — sie gehört aber zu
   `Templates/Network devices`. Die zwei reparierten Dateien wurden daraufhin
   wieder abgewiesen, und Regel 2 sah es nicht, weil sie nur Name → `uuid`
   prüft.

6. **Nichts darf ins Modul-ZIP rutschen, was nicht hineingehört.** Das
   Modulverzeichnis liegt unter dem Web-Root und ist öffentlich abrufbar —
   Shell-Skripte, `tools/`, `templates/`, Source-Maps und das Repository selbst
   haben dort nichts verloren. `npm run ci:package` simuliert den Paketinhalt
   und prüft ihn.

   Die Ausschlussmuster liest das Gate **aus `deploy.sh`**, statt sie zu
   wiederholen: eine zweite Liste wäre eine zweite Stelle, die ausschert, und
   dann prüft das Gate etwas anderes, als der Installer baut. Genau so ist
   `nt-uninstall.sh` ins Paket gerutscht — die Liste nannte nur die damals
   bekannten Skripte beim Namen.

7. **Die Zwei-Ebenen-Logik entscheidet, was verschiedene Benutzer sehen.**
   Positionen und manuelle Links liegen geteilt (`module.config`, nur
   Super-Admins schreiben) und persönlich (`CProfile`, jeder für sich). Beim
   Lesen gewinnt **persönlich pro Knoten** — nicht als Ganzes, sonst verdeckte
   eine einzige eigene Speicherung die geteilte Karte für immer. Bei den Links
   gewinnt **geteilt**, damit dieselbe Kante nicht doppelt erscheint.

   `npm run ci:layers` prüft das mit gestellten `NT_CONFIG`-Daten, jedes
   Szenario in einem eigenen Prozess (`storage.js` liest die Konfiguration beim
   Import, ein zweiter Import bekäme den alten Stand). Der eine Fehler, der hier
   schon auftrat, ist die Sorte, die man beim Lesen übersieht: ein Super-Admin
   sah nach der Migration seine **eigene** geteilte Karte nicht, weil sein
   alter `localStorage`-Stand als persönliche Ebene darüberlag.

   **Was das Gate nicht abdeckt:** den Weg Server → Datenbank → Rechteprüfung.
   Dafür braucht es zwei angemeldete Benutzer in einem Browser.

Alles zusammen lokal prüfen:

```bash
npm run build && npm run ci:eslint && npm run ci:xss && npm run ci:parity \
  && npm run ci:templates && npm run ci:package && npm run ci:layers \
  && npm run ci:pipeline && npm run ci:test
```

> Drei Gates fehlen in dieser Kette, weil sie Werkzeuge brauchen, die nicht
> jeder lokal hat: **`ci:lint-php`** und **`ci:test`** brauchen `php`,
> **`ci:shellcheck`** braucht `shellcheck`. Sie laufen in der Pipeline
> ohnehin — wer sie lokal hat, haengt sie an:
>
> ```bash
> npm run ci:lint-php && npm run ci:shellcheck
> ```
>
> **`ci:bundle-drift`** ist die Ausnahme in die andere Richtung: es baut neu
> und vergleicht gegen den eingecheckten Stand, schlaegt also fehl, solange das
> Bundle nicht committet ist. Nach `npm run build` gehoert
> `assets/js/dist/nt-bundle.js` mit in den Commit.

> **`ci:pipeline` ist das einzige Gate ohne CI-Job — mit Absicht.** Es prüft die
> `.gitlab-ci.yml` selbst, und eine ungültige CI-Datei lässt gar keinen Job mehr
> laufen; ein Job, der genau dann prüfen soll, kommt zu spät. Deshalb gehört es
> **vor den Push** und in diese Kette. Wie teuer das Vergessen ist, steht in der
> Datei: eine nicht deklarierte Stage hat die Pipeline 32 Commits lang
> stillgelegt, ohne dass irgendwo etwas rot wurde.

## Tests

`tests/*Test.php` sind reines PHP — **keine Datenbank, kein Zabbix, kein
PHPUnit** nötig:

```bash
npm run ci:test
```

Wer Logik in `topology/` anfasst (Metrik-Extraktion, LLDP-Matching,
Node-Building), sollte einen Fall ergänzen. Als Vorlage dient jeder bestehende
Test; Fixtures bitte **generisch** halten (`example.com`, `192.0.2.x` nach
RFC 5737) — keine echten Hostnamen oder Adressen.

## Code-Stil

- **PHP:** `declare(strict_types = 1)` in neuen Dateien, Zabbix-API (`API::…->get()`)
  statt direkter DB-Zugriffe, IDs vom Client immer gegen die API schneiden.
- **JS (Hauptmodul):** ES-Module, ES2019-Ziel. Neue Strings über `t()` und die
  Keys in `assets/js/modules/i18n/de.js` **und** `en.js` eintragen — beide
  Dateien müssen dieselben Keys haben.
- **JS (Widgets, `widget*/`):** hier läuft der Zabbix-jsLoader, deshalb
  **ES5-Stil** — keine Template-Literals, kein Spread, keine Arrow-Functions,
  `var` statt `const`/`let`.
- Kommentare erklären **warum**, nicht was. Der Bestand ist auf Deutsch.

## Pull Requests

Branch von `main`, ein Thema pro PR, Commit-Message beschreibt die Wirkung
(nicht die Datei-Liste). Wenn sich das Verhalten ändert: Eintrag in
[CHANGELOG.md](CHANGELOG.md) unter einer neuen Version.

## Lizenz

Beiträge stehen unter **AGPL-3.0-or-later**, wie das Modul selbst.
