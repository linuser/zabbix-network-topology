# Contributing

**🇬🇧 [English](#-english) · 🇩🇪 [Deutsch](#-deutsch)**

## 🇬🇧 English

Thanks for your interest. This module is a spare-time project — feedback and
patches are welcome, but sometimes need a little patience.

**Please don't report security issues as an issue** — mail them confidentially
instead, see [SECURITY.md](SECURITY.md).

### Reporting a bug

An [issue](https://github.com/linuser/zabbix-network-topology/issues) with:

- the **module version** (footer of the module page, or `manifest.json`)
- your **Zabbix version** and **PHP version**
- for missing edges: the **SNMP vendor** of the device → check the vendor matrix
  in [LLDP-SETUP.md](LLDP-SETUP.md) first, many "no edges" cases are listed there
- for JS problems: the message from the **browser console** (F12)

### Development setup

```bash
npm install          # only esbuild, no runtime dependencies
npm run build        # -> assets/js/dist/nt-bundle.js
```

To test against a real Zabbix, `./deploy.sh <server>` ships the module over SSH.
For a throwaway instance see
[`tools/clean-install-test/`](tools/clean-install-test/) (Docker, Zabbix 7.4 or
7.0 LTS).

### What the CI enforces

The gates run in two places: on a self-hosted GitLab and — ever since PR #5 sat
for a day without a single signal — as a GitHub Action
(`.github/workflows/gates.yml`) on every pull request here. Both run the same
checks; `npm run ci:pipeline` fails if one side gains a gate and the other
doesn't.

These are the traps. Without knowing them a first patch fails the pipeline
without it being clear why:

1. **The built bundle belongs in the commit.** `assets/js/dist/nt-bundle.js` is
   checked in on purpose, so the module installs without Node (INSTALL.md: "no
   build tools required"). The `bundle-drift` job rebuilds and compares — if you
   touch JS, run `npm run build` **and** commit the result.

2. **No new unescaped DOM sinks.** Anything coming from Zabbix or off the wire —
   host/item/proxy names, notes, IPs, and above all **LLDP/CDP neighbour names,
   which come from foreign devices** — has to pass through `esc()`
   (`assets/js/modules/utils.js`) before it enters the DOM, or be set via
   `textContent`. Two gates check this: `npm run ci:xss` (a grep tripwire) and
   `npm run ci:eslint` (`no-unsanitized`). Both cover the widget modules too.

3. **The ESLint baseline must not grow.** `eslint-suppressions.json` holds the
   ~100 historically grown `innerHTML` sites that escape internally. Adding
   entries there is not an accepted way to silence the gate — new code should do
   without a suppression.

4. **The two deliberate duplicates have to stay in sync.** The widget modules
   cannot import the main module's code — Zabbix' jsLoader knows nothing about ES
   modules. So the same thing exists twice, and `npm run ci:parity` guards both:

   - The **health-score formula** in `assets/js/modules/render-health.js` and
     `widget_health/`. Weights and thresholds are compared. If they drift, the
     same host group shows different scores on the map and on the dashboard —
     and nobody can tell which one is right.
   - The **shared data access** (`window.NtWidgetData`) across four widget files.
     Compared byte for byte: if one copy ran with a different TTL or cache key,
     the dashboard's behaviour would depend on load order — a bug you cannot
     reproduce.

   Change one site, change the other. The gate names the file that stepped out
   of line.

5. **The shipped templates have to stay importable.** Zabbix 7.0 requires a
   `uuid` in `template_groups`; without it the import rejects the file. Two of
   the three templates travelled that way while INSTALL.md recommends importing
   them in step 4 — and a user was the one who noticed. `npm run ci:templates`
   checks:

   - every group entry has a `uuid`
   - the same group name carries the same `uuid` in **all** files
   - the same `uuid` belongs to **exactly one** group name

   Zabbix matches groups by `uuid`, not by name, and the values are identical on
   every installation. They live in the `hstgrp` table — look there instead of
   guessing or copying from another file:

   | Group | `uuid` |
   |---|---|
   | `Templates` | `79f31eeab03146229b1e019097fad672` |
   | `Templates/Network devices` | `7df96b18c230490a9a0a9e2307226338` |

   The third rule exists because fixing the first one produced exactly that
   mistake: the `uuid` was copied from the working template, assuming it belonged
   to `Templates` — it belongs to `Templates/Network devices`. The two repaired
   files were rejected again, and rule 2 didn't see it, because it only checks
   name → `uuid`.

6. **Nothing may slip into the module ZIP that doesn't belong there.** The module
   directory sits under the web root and is publicly reachable — shell scripts,
   `tools/`, `templates/`, source maps and the repository itself have no business
   there. `npm run ci:package` simulates the package contents and checks them.

   The gate **reads the exclusion patterns from `deploy.sh`** instead of
   repeating them: a second list would be a second place to drift, and then the
   gate checks something other than what the installer builds. That is exactly
   how `nt-uninstall.sh` ended up in the package — the list named only the
   scripts known at the time.

7. **The two-layer logic decides what different users see.** Positions and manual
   links live both shared (`module.config`, only super admins write) and personal
   (`CProfile`, everyone for themselves). On read, **personal wins per node** —
   not as a whole, otherwise a single own save would hide the shared map forever.
   For links, **shared wins**, so the same edge doesn't appear twice.

   `npm run ci:layers` checks this with staged `NT_CONFIG` data, each scenario in
   its own process (`storage.js` reads the configuration at import time; a second
   import would get the old state). The one bug that did occur here is the kind
   you read past: after the migration a super admin could not see his **own**
   shared map, because his old `localStorage` state sat on top of it as the
   personal layer.

   **What the gate does not cover:** the path server → database → permission
   check. That needs two logged-in users in one browser.

8. **No German text may reach the UI.** Comments in this repository are German
   and stay that way — but anything a user reads has to be English.
   `npm run ci:i18n` checks it.

   The gate exists because the hand-kept list of leftover German strings was
   wrong at four places when it was finally checked: two entries were comments,
   three strings were missing entirely, and every line number had drifted. A
   list nobody maintains is not a list.

   Where the string belongs depends on where it is:

   - **Main module JS:** through `t()`, key in `i18n/de.js` **and** `en.js`.
   - **PHP:** `_('English text')` — Zabbix' own translation function, as in
     `NetworkTopologyLinks.php`.
   - **Widgets:** plain English. They have no `t()` — the jsLoader knows nothing
     about the main module's i18n.

   The gate parses string literals with its own scanner rather than grep, and
   that is not over-engineering — both grep approaches fail on real code here:
   a trailing `// Toggle "nur Offline-Hosts zeigen"` is a comment and must be
   ignored, while `url: 'https://…'` contains `//` inside a string. Cutting at
   the first `//` breaks the second; anchoring comments to line starts misses
   the first.

Run everything locally:

```bash
npm run build && npm run ci:eslint && npm run ci:xss && npm run ci:parity \
  && npm run ci:templates && npm run ci:package && npm run ci:layers \
  && npm run ci:i18n && npm run ci:pipeline
```

> Three gates are missing from that chain because they need tools not everyone
> has locally: **`ci:lint-php`** and **`ci:test`** need `php`,
> **`ci:shellcheck`** needs `shellcheck`. They run in the pipeline anyway —
> if you have them, append:
>
> ```bash
> npm run ci:lint-php && npm run ci:test && npm run ci:shellcheck
> ```
>
> **`ci:bundle-drift`** is the exception in the other direction: it rebuilds and
> compares against the checked-in state, so it fails as long as the bundle isn't
> committed. After `npm run build`, `assets/js/dist/nt-bundle.js` belongs in the
> commit.

> **`ci:pipeline` is the only gate without a CI job — deliberately.** It checks
> `.gitlab-ci.yml` itself, and an invalid CI file lets no job run at all; a job
> meant to check exactly that comes too late. So it belongs **before the push**
> and in this chain. How expensive forgetting it is, is written in the file: an
> undeclared stage silenced the pipeline for 32 commits without anything turning
> red anywhere.

### Tests

`tests/*Test.php` is plain PHP — **no database, no Zabbix, no PHPUnit** needed:

```bash
npm run ci:test
```

If you touch logic in `topology/` (metric extraction, LLDP matching, node
building), please add a case. Any existing test works as a template; keep
fixtures **generic** (`example.com`, `192.0.2.x` per RFC 5737) — no real host
names or addresses.

### Code style

- **PHP:** `declare(strict_types = 1)` in new files, the Zabbix API
  (`API::…->get()`) instead of direct DB access, always cut client-supplied IDs
  against the API.
- **JS (main module):** ES modules, ES2019 target. New strings go through `t()`,
  with the keys added to `assets/js/modules/i18n/de.js` **and** `en.js` — both
  files must carry the same keys.
- **JS (widgets, `widget*/`):** this is Zabbix' jsLoader, so **ES5 style** — no
  template literals, no spread, no arrow functions, `var` instead of
  `const`/`let`.
- Comments explain **why**, not what. **The existing ones are in German** — that
  is the one place where this project is not bilingual. Writing new comments in
  English is fine and welcome; nobody will ask you to translate the rest.

### Pull requests

Branch off `main`, one topic per PR, and let the commit message describe the
effect (not the list of files). If behaviour changes, add an entry to
[CHANGELOG.md](CHANGELOG.md) under a new version.

### Licence

Contributions are **AGPL-3.0-or-later**, like the module itself.

---

## 🇩🇪 Deutsch

Danke fürs Interesse! Dieses Modul ist ein Freizeitprojekt — Rückmeldungen und
Patches sind willkommen, brauchen aber manchmal etwas Geduld.

**Sicherheitslücken bitte nicht als Issue** melden, sondern vertraulich per Mail:
siehe [SECURITY.md](SECURITY.md).

### Bug melden

Ein [Issue](https://github.com/linuser/zabbix-network-topology/issues) mit:

- **Modul-Version** (Footer der Modul-Seite oder `manifest.json`)
- **Zabbix-Version** und **PHP-Version**
- bei fehlenden Kanten: **SNMP-Vendor** des Geräts → vorher die Vendor-Matrix in
  [LLDP-SETUP.md](LLDP-SETUP.md) prüfen, viele „keine Kanten"-Fälle stehen dort
- bei JS-Problemen: die Meldung aus der **Browser-Konsole** (F12)

### Entwicklungs-Setup

```bash
npm install          # nur esbuild, sonst keine Laufzeit-Abhängigkeiten
npm run build        # -> assets/js/dist/nt-bundle.js
```

Zum Testen gegen ein echtes Zabbix: `./deploy.sh <server>` rollt das Modul per
SSH aus. Für eine Wegwerf-Instanz siehe
[`tools/clean-install-test/`](tools/clean-install-test/) (Docker, Zabbix 7.4 oder
7.0 LTS).

### Was die CI hart erzwingt

Die Gates laufen an zwei Orten: auf einem selbstgehosteten GitLab und — seit
PR #5 einen Tag lang ohne jedes Signal dastand — als GitHub-Action
(`.github/workflows/gates.yml`) auch an jedem Pull Request hier. Beide führen
dieselben Prüfungen aus; `npm run ci:pipeline` fällt, wenn eine Seite ein Gate
bekommt und die andere nicht.

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

8. **Kein deutscher Text darf ins UI.** Die Kommentare in diesem Repository sind
   deutsch und bleiben es — was ein Benutzer liest, muss aber englisch sein.
   `npm run ci:i18n` prüft das.

   Das Gate gibt es, weil die handgepflegte Liste der übrig gebliebenen
   deutschen Strings beim Nachprüfen an vier Stellen falsch war: zwei Einträge
   waren Kommentare, drei Strings fehlten ganz, und sämtliche Zeilennummern
   hatten sich verschoben. Eine Liste, die niemand pflegt, ist keine.

   Wohin der String gehört, hängt davon ab, wo er steht:

   - **Hauptmodul-JS:** über `t()`, Schlüssel in `i18n/de.js` **und** `en.js`.
   - **PHP:** `_('English text')` — Zabbix' eigene Übersetzungsfunktion, wie in
     `NetworkTopologyLinks.php`.
   - **Widgets:** schlicht Englisch. Dort gibt es kein `t()` — der jsLoader weiß
     nichts von der i18n des Hauptmoduls.

   Das Gate liest String-Literale mit einem eigenen Scanner statt mit grep, und
   das ist keine Spielerei — beide grep-Wege scheitern hier an echtem Code: ein
   `// Toggle "nur Offline-Hosts zeigen"` am Zeilenende ist ein Kommentar und
   muss ignoriert werden, während `url: 'https://…'` ein `//` **im** String
   trägt. Wer beim ersten `//` abschneidet, zerlegt das zweite; wer Kommentare
   am Zeilenanfang verankert, übersieht das erste.

Alles zusammen lokal prüfen:

```bash
npm run build && npm run ci:eslint && npm run ci:xss && npm run ci:parity \
  && npm run ci:templates && npm run ci:package && npm run ci:layers \
  && npm run ci:i18n && npm run ci:pipeline
```

> Drei Gates fehlen in dieser Kette, weil sie Werkzeuge brauchen, die nicht
> jeder lokal hat: **`ci:lint-php`** und **`ci:test`** brauchen `php`,
> **`ci:shellcheck`** braucht `shellcheck`. Sie laufen in der Pipeline
> ohnehin — wer sie lokal hat, haengt sie an:
>
> ```bash
> npm run ci:lint-php && npm run ci:test && npm run ci:shellcheck
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

### Tests

`tests/*Test.php` sind reines PHP — **keine Datenbank, kein Zabbix, kein
PHPUnit** nötig:

```bash
npm run ci:test
```

Wer Logik in `topology/` anfasst (Metrik-Extraktion, LLDP-Matching,
Node-Building), sollte einen Fall ergänzen. Als Vorlage dient jeder bestehende
Test; Fixtures bitte **generisch** halten (`example.com`, `192.0.2.x` nach
RFC 5737) — keine echten Hostnamen oder Adressen.

### Code-Stil

- **PHP:** `declare(strict_types = 1)` in neuen Dateien, Zabbix-API (`API::…->get()`)
  statt direkter DB-Zugriffe, IDs vom Client immer gegen die API schneiden.
- **JS (Hauptmodul):** ES-Module, ES2019-Ziel. Neue Strings über `t()` und die
  Keys in `assets/js/modules/i18n/de.js` **und** `en.js` eintragen — beide
  Dateien müssen dieselben Keys haben.
- **JS (Widgets, `widget*/`):** hier läuft der Zabbix-jsLoader, deshalb
  **ES5-Stil** — keine Template-Literals, kein Spread, keine Arrow-Functions,
  `var` statt `const`/`let`.
- Kommentare erklären **warum**, nicht was. Der Bestand ist auf Deutsch.

### Pull Requests

Branch von `main`, ein Thema pro PR, Commit-Message beschreibt die Wirkung
(nicht die Datei-Liste). Wenn sich das Verhalten ändert: Eintrag in
[CHANGELOG.md](CHANGELOG.md) unter einer neuen Version.

### Lizenz

Beiträge stehen unter **AGPL-3.0-or-later**, wie das Modul selbst.
