# Changelog

Änderungen ab dem ersten öffentlichen Release. Versionsschema: MAJOR.MINOR.PATCH.
*Changes since the first public release. Versioning: MAJOR.MINOR.PATCH.*

## v4.38.3 — 2026-07-27

### Fixed
- **Dashboard-Widgets blieben je nach Timing auf „Loading…" stehen.** Zwei unabhängige Ursachen, beide im Widget-Frontend:
  1. `data-groupids` kommt in Zabbix 7.4 **leer** am Client an — die Feldwerte stehen dort nur in `this._fields`. Der Fallback darauf existierte bisher nur im `else`-Zweig (Canvas bei `onStart` noch nicht da). Existierte der Canvas schon, gewann das leere Attribut und das Widget fetchte **nie**. Welches der drei Widgets es traf, entschied allein das Timing. Der Fallback greift jetzt in beiden Zweigen.
  2. Das Cytoscape-Layout lief, während die Widget-Fläche im Dashboard noch **0 px** groß war. `cose`/`cola` können dann nicht verteilen und legen **alle** Knoten auf `{0,0}`; das nachgelagerte `fit()` zoomt daraufhin auf eine entartete Bounding-Box (Zoom 4) — der Graph ist geladen, aber unsichtbar. Ein `resize()`+`fit()` allein heilt das nicht, weil die Positionen bereits feststehen. Das Layout läuft jetzt per `ResizeObserver` erneut, sobald der Container echte Größe hat (dieselbe Lösung wie in `render-tech.js` des Hauptmoduls); der Observer wird in `_destroyCy()` mit abgeräumt.
- **Dark-Mode-Button war nicht übersetzbar**: `tabs.js` setzte „Light"/„Dark" hart, obwohl die i18n-Keys `toolbar.light`/`toolbar.dark` in beiden Sprachdateien existierten.

### Removed
- Toter Code: `assets/js/modules/dom-safe.js` (nie importiert, nicht im Bundle), der ungenutzte Export `hasSnapshot()` aus `diff-mode.js` und 7 CSS-Regeln für `.nt-lbl`/`.nt-node` (beide Klassen werden von keinem JS/PHP je gesetzt — Icons gehen als Data-URI an Cytoscape).

### Added
- **`CONTRIBUTING.md`** (DE/EN): Entwicklungs-Setup und vor allem die drei Dinge, die die CI hart erzwingt (mitcommittetes Bundle, XSS-Gates, ESLint-Baseline).
- **GitHub-Issue-Vorlage** als Formular — fragt Modul-/Zabbix-/PHP-Version und bei fehlenden Kanten den SNMP-Vendor ab.

### Changed
- **README ist jetzt zweisprachig (DE/EN)** und ohne Demo-Verweise; Architektur-, Screenshot- und Lizenzabschnitte werden gemeinsam genutzt statt doppelt geführt.
- **Changelog beginnt beim ersten öffentlichen Release** — die Entwicklungshistorie davor ist nicht Teil dieses Repos.

## v4.38.2 — 2026-07-27

Härtungs-Runde vor der Veröffentlichung (externes Security-Review + Repo-Audit).

### Security
- **`deploy.sh`: Root-Code-Execution über vorhersagbaren `/tmp`-Pfad geschlossen** (High). Die Zips wurden auf dem Zielserver unter festen Namen (`/tmp/network_topology_v6.zip`) abgelegt. Ein beliebiger unprivilegierter User dort konnte den Pfad vorab als **Symlink** anlegen; `scp` folgt ihm (`O_CREAT|O_TRUNC`), womit der Angreifer die Datei kontrolliert, die Sekunden später von `sudo unzip` als **root** entpackt wird — ohne Zip-Slip-Filter also beliebige Dateien außerhalb des Modulverzeichnisses. Lokales **und** entferntes Arbeitsverzeichnis sind jetzt `mktemp -d` mit `umask 077`; der EXIT-Trap räumt beide ab (die Remote-Zips blieben vorher dauerhaft liegen). Der SSH-Control-Socket liegt ebenfalls im 0700-Tempdir statt unter einem aus dem Servernamen ableitbaren `/tmp`-Pfad.
- **Die drei Widget-Module liefen durch kein einziges CI-Gate.** `eslint.config.mjs`, `tools/check-xss.sh` und `package.json` kannten nur `assets/js/**` — ausgerechnet die Dateien, die ihr HTML per String-Konkatenation bauen, wurden nie geprüft. Beide Gates decken jetzt `widget*/assets/js/**` mit ab (verifiziert: ein absichtlich eingebauter unescapter Sink lässt beide rot werden, die bestehende Baseline unterdrückt ihn nicht).
- **Unescapter `innerHTML`-Sink im Topology-Widget** (`widget/assets/js/widget.class.js`, `_showMsg`): die Fehlermeldung wurde roh in HTML konkateniert — der einzige Bruch der Escaping-Konvention in allen drei Widgets, entstanden genau in der Gate-Blindstelle. Baut die Nachricht jetzt über `textContent`, ist damit per Konstruktion kein HTML-Sink mehr.
- ESLint erkennt `this._esc()` der Widgets als Escape-Methode (`escape.methods` um `_esc` erweitert); die 8 dadurch neu sichtbaren, **inhaltlich geprüften** Bestands-Sinks sind in `eslint-suppressions.json` gebaselined — wie die ~100 im Hauptmodul.

### Changed
- **Reale Infrastruktur-Referenzen entfernt**: eigene Host-/Netzdaten in CHANGELOG, Tests und Code-Kommentaren durch generische Platzhalter ersetzt (`192.0.2.x` nach RFC 5737, `example.com`, `SW-CORE-01`). Betrifft keine Funktionalität — Device-Type-Keywords wie `truenas`/`pve` in `HostMetadata.php` sind funktionaler Code und bleiben.
- **Versions-Konsistenz**: `manifest.json`, `package.json`, `package-lock.json`, README-Badge und CHANGELOG liefen bis zu vier Releases auseinander und sind jetzt synchron.

### Added
- **`SECURITY.md`** (DE/EN): Meldeweg für Sicherheitslücken, Reaktionszeit, Geltungsbereich und das dokumentierte Sicherheitsmodell.
- **README**: Link-Zeile (Projektseite, Demo, Repo, Changelog, Installation) und Abschnitt „Feedback & Mitmachen". **INSTALL**: Clone-URL und Release-ZIP verweisen auf das öffentliche Repository.
- `.gitignore` deckt `.claude/`, `*.log` und `.env` ab.

## v4.38.1 — 2026-07-27

### Fixed
- **i18n-Lücke in der Items-Pivot**: ~15 Strings waren hart auf Deutsch codiert und blieben im EN-Modus deutsch — der Fehler-/Empty-State (inkl. der vier Erklär-Zeilen), „Alles leer", der Gruppen-Separator „Ohne Gruppe", Anomalie-Tooltips, „In Latest Data öffnen", Pattern-Label + -Placeholder. Alle laufen jetzt über `t()`, neue Keys in `i18n/{de,en}.js`. Dass es ein Versehen war zeigt `— Custom-Pattern —`: derselbe String lief an zwei Stellen bereits über `t('items.custom_pattern')`, an einer dritten hart-codiert.

### Added
- `fmtVal` formatiert jetzt auch die Zabbix-Unit **`Bps`** (Byte/s → B/s, KB/s, MB/s, GB/s). Bisher fiel sie auf die rohe Zahlenausgabe zurück (`bps` = Bit/s war bereits abgedeckt).
- **README**: Tabelle, welche **Linux-Templates** für die Items-Pivot-Presets nötig sind (`Linux by Zabbix agent` für Disks/Block-IO/CPU/Memory/Netz, `ICMP Ping` für Ping) — plus der Hinweis, dass SNMP-Switches/Windows andere Keys liefern und dort das Custom-Pattern bzw. die „Discovered"-Liste zu nutzen ist. Ohne passendes Template bleibt die Pivot leer, was bisher wie ein Fehler wirkte.

## v4.38.0 — 2026-07-27

### Added
- **Drittes Dashboard-Widget „NT Table"** (`network_topology_v6_table_widget`): die Tabellen-Ansicht (Nagios-/Icinga-Style Hostliste) als Dashboard-Kachel — **Status** (Severity/Offline/Stale), **Host**, **CPU**, **Mem**, **Ping**, **Traffic** (↓/↑), **offene Probleme**. Sortierung Offline → Severity → Name; konfigurierbar: Hostgroups, Hide-offline, Only-problems, Max-rows. Nutzt dieselbe `network.topology.v6.data`-Action wie der Haupt-Tab (kein zweites Backend), ES5-jsLoader-Stil (Zabbix 7.4) wie die bestehenden Widgets. `deploy.sh` liefert die Widgets jetzt zu dritt aus (`widgets`/`all`-Modus).

---

*Die Entwicklungshistorie vor dem ersten öffentlichen Release ist nicht Bestandteil dieses Changelogs.*
*Development history prior to the first public release is not part of this changelog.*
