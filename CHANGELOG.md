# Changelog

Änderungen ab dem ersten öffentlichen Release. Versionsschema: MAJOR.MINOR.PATCH.
*Changes since the first public release. Versioning: MAJOR.MINOR.PATCH.*

## Unreleased

### Added
- **Manuelle Verbindungen liegen jetzt auf dem Server, nicht mehr im
  `localStorage`.** Bisher waren die handgezogenen Kanten an einen Browser
  gebunden: weg beim Cache-Leeren, unsichtbar für Kollegen, weg auf dem
  Zweitrechner. Sie liegen jetzt in **zwei Ebenen**:

  | Ebene | Speicher | schreibt | sieht es |
  |---|---|---|---|
  | geteilt | `module.config` | nur Super-Admins | alle |
  | persönlich | `CProfile` des Users | jeder für sich | nur er selbst |

  Wer die geteilte Karte pflegen darf, pflegt sie auch: ein Super-Admin zeichnet
  in die geteilte Ebene, alle anderen in ihre persönliche. Beide werden beim
  Laden zusammengeführt, geteilte Kanten gewinnen bei Dopplung. In der Karte
  sind sie unterscheidbar — geteilt kräftiger und länger gestrichelt.

  Die Rechtegrenze ist keine Design-Entscheidung, sondern Zabbix: `CModule`
  prüft in `update()` hart auf `USER_TYPE_SUPER_ADMIN`. Gelesen wird
  `module.config` deshalb **nicht** über die API — die verweigert
  Nicht-Super-Admins auch das Lesen — sondern über den ModuleManager, in dem
  Zabbix die Config beim Bootstrap ohnehin schon liegen hat.

  Vorhandene `localStorage`-Links wandern beim ersten Aufruf einmalig in die
  persönliche Ebene, sofern serverseitig noch nichts liegt. Der alte Eintrag
  bleibt als Sicherheitsnetz stehen, wird aber nicht mehr gelesen.

  Kein Host-Tag wie bei `nt:parent`: ein Link darf auf einen **Ghost-Knoten**
  zeigen — einen per LLDP gemeldeten Nachbarn, den es in Zabbix gar nicht gibt.
  Ein Tag bräuchte einen Host, den es hier nicht gibt.

  Geschrieben wird über die neue Action `network.topology.links` (POST, eigener
  CSRF-Token, Drosselung, `USER_TYPE_ZABBIX_USER` für die persönliche und
  Super-Admin für die geteilte Ebene). Das Frontend schreibt optimistisch: die
  Kante erscheint sofort, scheitert der POST, wird zurückgerollt und der Fehler
  gemeldet — sonst stünde eine Kante auf dem Schirm, die es serverseitig nicht
  gibt.

  `tests/ManualLinksTest.php` deckt die Validierung ab (21 Prüfungen). Zwei
  Regeln sind dabei leicht zu übersehen: der **Pipe** ist in Node-IDs verboten,
  weil persönliche Links als `s|t` je einer `CProfile`-Zeile liegen; und das
  Paar wird **sortiert** abgelegt, weil eine Kante ungerichtet ist und `{a,b}`
  sonst neben `{b,a}` landet.

- **Kennzahlen-Zeile über der Karte.** Sechs Zahlen auf einen Blick: Hosts,
  OK/Warn/Krit., Kanten und nicht überwachte Nachbarn. Standardmäßig als
  kompakte Chips (~40 px), im Wallboard-Modus (`?wallboard=1`) als große
  Kacheln — unter der Zeile liegt kein Scrollbereich, sondern der Graph, und
  Höhe die oben weggeht fehlt ihm dauerhaft.

  Zwei der Zahlen gab es bisher nirgends: **Kanten** nach Herkunft
  aufgeschlüsselt (manuell gezogen, aus LLDP/CDP, zu Ghosts) und **Ghosts** —
  per LLDP gemeldete Nachbarn ohne Host in Zabbix. Alles aus dem Graphen
  gelesen, kein Backend, keine neue Action.

  Nebenbei entfernt: `updateBadge()` in `render-tech.js` wollte seit v4.18.3
  Zahlen in ein Element `#nt-badge` schreiben, das **in der gesamten Historie
  nie erzeugt wurde** — die Funktion stieg bei jedem Aufruf in Zeile 2 aus, die
  Zahlen hat nie jemand gesehen. Mit ihr fällt die einzige unterdrückte
  `no-unsanitized`-Stelle der Datei weg.

- **Zwei neue Dashboard-Widgets.** Damit liefert das Paket fünf:
  - **NT KPI** — dieselben Kennzahlen als Kachel, wahlweise als Ring
    (Severity-Verteilung mit der Host-Zahl in der Mitte) oder als Raster.
  - **NT Items** — ein Item-Muster über alle Hosts der gewählten Gruppen
    gepivotet: Hosts als Zeilen, passende Keys als Spalten. Festes Muster im
    Formular statt der interaktiven Auswahl des Haupt-Tabs; auf einer Kachel
    gibt es diese Interaktion nicht.

  Beide bauen mit `createElement`/`textContent` statt `innerHTML` und brauchen
  deshalb keinen Eintrag in `eslint-suppressions.json`.

- **Aus einem unüberwachten Nachbarn einen Host machen.** Ghost-Knoten haben
  jetzt ein eigenes Kontextmenü mit Herkunftsangabe (welcher Host sie per
  LLDP/CDP gemeldet hat) und — für Admins — einem Eintrag, der Zabbix' eigenes
  Host-Formular **vorbefüllt** öffnet: Name, aktuelle Hostgruppe, Herkunft in
  der Beschreibung.

  Angelegt wird der Host bewusst nicht von uns: keine schreibende Action, keine
  eigene Rechteprüfung, keine halb angelegten Hosts. Zabbix validiert, legt an
  und lehnt ab. Bisher fielen Ghosts in den Host-Zweig des Menüs und bekamen
  Einträge wie „Latest Data", die für einen nicht existierenden Host
  zwangsläufig ins Leere führen.

### Changed
- **Die Widgets folgen jetzt Zabbix' eigenem Update-Zyklus.** Alle liefen mit
  eigenem `setInterval` (30/30/60 s), während die Basisklasse `CWidget`
  parallel periodisch die View-Action rief und den Widget-Körper durch frisches
  View-HTML ersetzte — den „Loading…"-Platzhalter, den der eigene Timer erst
  bis zu 60 s später überschrieb. Die Widget-Kacheln fielen dadurch regelmäßig
  auf „Loading…" zurück.

  Sie überschreiben jetzt `promiseUpdate()`. Damit gilt die
  Refresh-Einstellung des Dashboards statt drei fest verdrahteter Zahlen, und
  bei inaktiver Seite pausiert der Zyklus von selbst.

- **Einheitliche Namen.** Im Dashboard-Menü heißen die Widgets durchgehend
  `NT …` (Zabbix sortiert alphabetisch — ohne gemeinsames Präfix standen sie an
  drei Stellen der Liste). In der Modulliste tragen alle eine englische
  Beschreibung in gleicher Form; das Graph-Widget hieß dort nur „— Widget" und
  heißt jetzt „— Topology Widget". Nur Anzeigetexte: die Widget-IDs bleiben,
  bestehende Kacheln behalten ihren gespeicherten Titel.

### Fixed
- **Beide Installer setzen den SELinux-Kontext jetzt selbst.** `nt-install.sh`
  und `deploy.sh` entpacken nach `/tmp` und schieben das Ergebnis per `cp -a`
  bzw. `mv` an seinen Platz — beide **erhalten** den Kontext. Dateien aus
  `/tmp` tragen `user_tmp_t`, php-fpm läuft als `httpd_t` und darf das nicht
  lesen. Das Modul lag damit auf RHEL/Rocky/Alma mit korrekten Rechten und
  korrektem Owner am richtigen Platz — und erschien trotzdem nicht in der UI.
  Beide rufen nun `restorecon -R` auf, sofern vorhanden und SELinux aktiv;
  auf Debian/Ubuntu ist der Aufruf ein stiller No-Op und niemals fatal.
  `INSTALL.md` weist in beiden Sprachen darauf hin, dass der Handgriff nur
  noch beim Entpacken von Hand nötig ist.

- **Ein High-Problem zählte als „Warn".** Die Severity-Eimer der Kennzahlen
  warfen alles zwischen OK und Disaster in einen Topf — ein Host mit **High**
  erschien unter „Warn", während die Toolbar eine Zeile darüber getrennte
  Pillen für Warn, Avg und High zeigt und der Knoten im Graphen rot leuchtet.
  Jetzt: `ok` = Normal, `warn` = Info bis Average, `krit` = High und Disaster.

- **„0 Ghosts" war eine Behauptung, keine Messung.** Ghost-Knoten kommen nur in
  den Graphen, wenn der Toolbar-Toggle an ist (Standard: aus) — gezählt wurde
  aber aus dem Graphen. Bei ausgeschaltetem Toggle stand dort null, unabhängig
  davon wie viele es gab, und das ausgerechnet bei der Kennzahl, die zu etwas
  auffordern soll. Gezählt wird jetzt aus derselben Quelle, aus der auch
  injiziert wird; ist der Toggle aus, steht „ausgeblendet" daneben.

- **Deutsche Zeichenketten in einer englischen Oberfläche.** Der Knopf unter der
  Hostgruppen-Auswahl rief `_('Auswahl leeren')` — die *Ausgangs*-Zeichenkette
  war deutsch, und Zabbix' gettext übersetzt gegen englische Quelltexte, reicht
  einen deutschen also unverändert durch. Ebenso trug das Health-Widget als
  einziges noch deutsche Beschriftungen (Score-Labels, Kopfzeile, Legende), und
  die Kopfzeile schrieb „1 Gruppen" — Singular und Plural waren nicht
  unterschieden. Beides behoben; das Paket ist jetzt durchgängig englisch.

- **Prozentspalte im Items-Widget sprang.** Die Rundung schnitt die abschließende
  Null ab, wodurch „6%" neben „5.9%" stand. Feste Nachkommastelle.

### Performance
- **Response-Cache für `network.topology.data`.** Die Action ist der teuerste
  Endpoint des Moduls (Host + Trigger + Problem + Item + gebatchte Lastvalues +
  LLDP) und war als einzige von sieben cachenden Actions **ohne**
  Response-Cache — in `NtCache` lag dort nur die Topologie-Baseline. 15 s TTL,
  deutlich unter jedem Refresh-Intervall.

  Zwei Dinge bleiben bewusst außerhalb des Caches. **`topo_changes`** beruht auf
  einem Diff gegen die letzte Abfrage; aus dem Cache bedient, liefe der Diff nur
  noch bei Cache-Misses und dieselbe „neue Verbindung" würde für die Dauer der
  TTL wiederholt gemeldet. **`requested_count`** hängt am ungekürzten
  Eingabewert, der nicht im Cache-Schlüssel steckt.

- **Mehrere Widgets auf einem Dashboard holen die Daten nur noch einmal.**
  Vorher fragte jedes `network.topology.data` einzeln ab — dieselbe Action,
  dieselben Hostgruppen. Ein geteilter Zugriff mit Request-Coalescing und 15 s
  TTL bündelt das. Auf einem Dashboard mit vier NT-Widgets sind es damit
  nachweislich **eine** Datenabfrage pro Runde statt vier.

### Intern
- **Gate gegen Drift in den beiden bewussten Duplikaten.** Die Widget-Module
  können den Code des Hauptmoduls nicht importieren — Zabbix' jsLoader kennt
  keine ES-Module —, deshalb steht zweimal dasselbe da. Bisher stand die Bitte,
  das synchron zu halten, als Kommentar in den Dateien; `npm run ci:parity`
  macht daraus eine Prüfung. Bewacht werden die Gewichte und Schwellen der
  Health-Score-Formel (Hauptmodul gegen Widget) und der geteilte Datenzugriff
  über vier Widget-Dateien. Findet die Extraktion nichts, ist das ein Fehler
  und kein Durchlauf.

## v5.0.0 — 2026-08-08

### ⚠️ Breaking — der `_v6`-Suffix entfällt

Das Modul hieß intern seit jeher `network_topology_v6`; die „v6" war eine
Entwicklungsnummer aus der Zeit vor dem ersten Release und hatte nie etwas mit
der Zabbix- oder der Modulversion zu tun. Sie führte regelmäßig zu der Annahme,
das Modul sei an Zabbix 6 gebunden — das Gegenteil stimmt, es läuft auf 7.0 LTS
und 7.4. Der Suffix verschwindet daher restlos aus allen Bezeichnern.

*The `_v6` suffix is gone. It was a pre-release development number, never a
Zabbix-version marker, and it kept being read as „requires Zabbix 6". Migration
steps below.*

| | vorher | jetzt |
|---|---|---|
| Verzeichnis | `network_topology_v6` | `network_topology` |
| Modul-ID | `network_topology_v6` | `network_topology` |
| PHP-Namespace | `Modules\NetworkTopologyV6` | `Modules\NetworkTopology` |
| Actions | `network.topology.v6.*` | `network.topology.*` |
| Widget-IDs | `network_topology_v6_*_widget` | `network_topology_*_widget` |

**Es gibt bewusst keine Kompatibilitäts-Aliase.** Die alten Action-Namen sind
weg, nicht deprecated.

### Migration von 4.x

1. **Altes Verzeichnis entfernen**, sonst registriert Zabbix beide Module und
   der Menüeintrag erscheint doppelt:
   ```bash
   cd /usr/share/zabbix/ui/modules
   sudo rm -rf network_topology_v6 network_topology_v6_widget \
               network_topology_v6_health_widget network_topology_v6_table_widget
   ```
2. Neue ZIPs entpacken (siehe `INSTALL.md`), dann
   **Administration → General → Modules → Scan directory** und die Module auf
   *Enabled* setzen. Die alten Einträge verschwinden dabei von selbst.
3. **Dashboards nachziehen.** Die drei Widget-IDs stehen in `widget.type`; mit
   dem Umbenennen kennt Zabbix den alten Typ nicht mehr und blendet die Kacheln
   aus. Sie müssen einmalig neu hinzugefügt und konfiguriert werden. Betroffen
   ist nur die Kachel, nicht das Dashboard.
4. **Lesezeichen aktualisieren** — die Ansicht liegt jetzt unter
   `zabbix.php?action=network.topology.view`.

#### Optional: Dashboards per SQL erhalten

Wer die Kacheln nicht neu bestücken will, kann die Bezeichner stattdessen in
der Datenbank umschreiben. Das ist genau das, was „Scan directory" plus ein
manueller Neuaufbau täte — nur ohne Klickarbeit. **Vorher Backup ziehen**, und
erst ausführen, wenn die neuen Verzeichnisse schon auf der Platte liegen:

```sql
BEGIN;
UPDATE module SET id = 'network_topology',
                  relative_path = 'modules/network_topology'
 WHERE id = 'network_topology_v6';
UPDATE module SET id = 'network_topology_widget',
                  relative_path = 'modules/network_topology_widget'
 WHERE id = 'network_topology_v6_widget';
UPDATE module SET id = 'network_topology_health_widget',
                  relative_path = 'modules/network_topology_health_widget'
 WHERE id = 'network_topology_v6_health_widget';
UPDATE module SET id = 'network_topology_table_widget',
                  relative_path = 'modules/network_topology_table_widget'
 WHERE id = 'network_topology_v6_table_widget';

UPDATE widget SET type = 'network_topology_widget'
 WHERE type = 'network_topology_v6_widget';
UPDATE widget SET type = 'network_topology_health_widget'
 WHERE type = 'network_topology_v6_health_widget';
UPDATE widget SET type = 'network_topology_table_widget'
 WHERE type = 'network_topology_v6_table_widget';
COMMIT;
```

`UPDATE` statt `DELETE`+`INSERT` ist Absicht: es erhält die `moduleid`, an der
`role_rule.value_moduleid` per Fremdschlüssel mit `ON DELETE CASCADE` hängt —
ein Löschen würde rollenbasierte Modulrechte stillschweigend mit entfernen.
Danach php-fpm neu laden.

**Auf diesem Weg entfallen die Schritte 2 und 3 oben.** Weil die Zeilen
umbenannt statt ersetzt werden, bleibt `status` erhalten — die Module sind
danach weiterhin aktiviert, „Scan directory" und das Neu-Aktivieren sind nicht
nötig, und die Dashboard-Kacheln stehen an ihrem Platz. Wer neu hinzugekommene
Widgets nutzen will, braucht „Scan directory" trotzdem einmal: die kennt Zabbix
noch nicht.

Nachgefahren auf zwei unabhängigen Installationen — der Projekt-Demo und einer
zweiten Instanz auf PostgreSQL. Beide Male: sieben Zeilen geändert, alle Module
weiter aktiviert, alle Kacheln erhalten.

**Erhalten bleibt alles Nutzerseitige:** Knotenpositionen, Pins, Notizen,
manuelle Links, Filter-Presets und sämtliche Toolbar-Einstellungen. Die
localStorage-Schlüssel tragen ein User-Präfix (`u<id>_`) und waren nie an den
Modulnamen gebunden. Host-Tags (`nt:parent`) sind ohnehin unberührt.

### Changed
- Widget-Versionen ziehen wegen der geänderten IDs je einen Major nach:
  Topologie-Graph `2.0.0 → 3.0.0`, Health-Score `1.0.1 → 2.0.0`,
  Tabelle `1.0.0 → 2.0.0`.
- Release-Assets heißen entsprechend `network_topology.zip`,
  `network_topology_widget.zip`, `network_topology_health_widget.zip`,
  `network_topology_table_widget.zip`.

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
