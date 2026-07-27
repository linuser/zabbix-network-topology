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

## Drei Dinge, die die CI hart erzwingt

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

Alles zusammen lokal prüfen:

```bash
npm run build && npm run ci:eslint && npm run ci:xss && npm run ci:test
```

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
