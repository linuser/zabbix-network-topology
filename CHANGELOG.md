# Changelog

Alle relevanten Änderungen am Modul. Versionsschema: MAJOR.MINOR.PATCH.

## v4.29.6 — 2026-07-06

### Changed
- **Farbcode-Leiste (Technical-Tab) dezenter**: standardmäßig eingeklappt (nur ein kleines „Color guide"-Chip unten links statt des präsenten weißen Kastens) — die Wahl wird gemerkt. Ausgeklappt jetzt leichter: transparenter (leichter Blur), weicherer Schatten, gedämpfter Header; volle Deckkraft bei Hover.

## v4.29.5 — 2026-07-06

### Changed (Pre-Release-Politur — Branding, Sicherheit, Doku)
- **Produktname vereinheitlicht → „Network Topology for Zabbix"** (Anzeigename im Manifest, Menü-Eintrag, Footer, beide Widgets, README-H1 + Intro). Die technische Modul-ID `network_topology_v6`, der Namespace `NetworkTopologyV6` und die Action-Namen `network.topology.v6.*` bleiben unverändert (Umbenennen würde alle Installs/Actions brechen) — der README erklärt das v6=Lineage-vs-Release-Version-Verhältnis.

### Security
- **`can_edit`-Fallback fällt jetzt „closed"**: der JS-Fallback in der View (greift nur, wenn PHP `NT_CONFIG` nicht liefert) setzte `can_edit = true` und hätte damit einem Nicht-Admin die Admin-UI (Bearbeiten-Links, **Wartungs-Button**) zeigen können. Jetzt `false` — ohne verlässliche Rolle keine Edit-UI. (Das Backend blockte schon immer; die UI soll aber gar nicht „fail open" sein.)

### Fixed
- **Modul-Loader scheitert nicht mehr still**: bei einem Ladefehler (häufigste Ursache: Content-Security-Policy ohne `blob:` in `script-src`) zeigt die Seite jetzt eine sichtbare Fehlermeldung mit genau diesem CSP-Hinweis statt eines weißen Screens.

### Docs
- README: **„Was ist das?"-Intro** für Erstnutzer vorangestellt. Veraltete Angaben korrigiert: 14 (statt 5) Actions, 44 (statt 32) Module, `export.js` (statt nicht mehr existentem `export-mail.js`), aktualisierte CSRF-/Write-Action-Security-Notiz.

## v4.29.4 — 2026-07-06

### Added
- **Farbcode-Leiste unten im Technical-Tab**: einklappbare Legende, die erklärt, was die Farben bedeuten — Knoten-Severity (mit **Optimal** grün hervorgehoben, dann Info/Warning/Average/High/Disaster), Zustände (✕ Offline, gedimmt = Wartung/veraltet), **Verbindungen** (LLDP/CDP grün gestrichelt, Internet-Uplink blau, Interface-down rot gestrichelt, Weathermap-Auslastungsskala als Verlauf) und die Metrik-Ringe (CPU/RAM/Traffic/Ping). Zustand in localStorage, im Wallboard ausgeblendet. Ergänzt die bestehende Seiten-Legende (die nur Counts, aber keine Edge-/Zustands-Bedeutung zeigte).

### Tooling
- **deploy.sh: SSH-Connection-Multiplexing (ControlMaster)** — alle ssh/scp-Schritte eines Deploys teilen sich jetzt EINE Verbindung statt bei jedem der ~10 Round-Trips neu zu verbinden. Auf flakigen Links (wie zuletzt beim Zielserver) überlebt der ganze Deploy ein einzelnes stabiles Fenster; ServerAlive erkennt echte Abbrüche schnell, ControlMaster degradiert sauber auf normale Verbindungen.

## v4.29.3 — 2026-07-06

### Changed (Lizenzwechsel MIT → AGPL-3.0)
- **Lizenz auf AGPL-3.0-or-later umgestellt** (wie Zabbix 7). Begründung: Das Modul ist ein abgeleitetes Werk des Zabbix-Frontends — es leitet von Zabbix-Klassen (`CController` u. a.) ab und läuft im selben Prozess; Zabbix 7 steht unter AGPL-3.0, damit unterliegt das kombinierte Werk faktisch der AGPL. MIT auf einem AGPL-Derivat versprach Freiheiten, die fürs Gesamtwerk gar nicht gewährt werden können. AGPL-3.0 ist das ehrliche, eindeutige Label.
- `LICENSE` → offizieller AGPL-3.0-Volltext (verbatim von gnu.org). Footer, README-Badge + Lizenz-Sektion, `SPDX-License-Identifier: AGPL-3.0-or-later`-Header in allen 23 PHP-Dateien + JS-Entry. Copyright bleibt bei PlaNet Fox / Alexander Fox.

## v4.29.2 — 2026-07-06

### Fixed
- **What-if-/Root-Cause-Markierungen waren in Firefox unsichtbar**: die Nodes haben `background-opacity:0` (transparenter Body, nur SVG-Icon per `background-image`) — Cytoscape rendert `underlay-*` HINTER dem Body, und Firefox überspringt diese Ebene bei transparentem Body (Chrome kompositiert sie). Die roten/grauen Halos der Ausfall-Simulation und der Root-Cause-Ansicht erschienen so nur in Chrome. Fix: die vier Marker (`nt-sim-dead`, `nt-sim-cut`, `nt-rc-cause`, `nt-rc-victim`) nutzen jetzt `overlay-*` (rendert oben drauf, Cytoscapes battle-tested Selektions-Highlight) → cross-browser sichtbar. Die betroffenen Hosts werden jetzt getönt statt umkränzt (semantisch sogar klarer).

### Changed
- **Management-Tab aufgehübscht**: Karten mit ruhigem neutralem Rahmen + kräftigem linkem Severity-Akzentstreifen (statt lautem Vollrand in der Signalfarbe); Severity als Pill (Punkt + Label, konsistent mit den Header-Pillen); Sektions-Header mit Host-Count-Badge + Worst-Severity-Dot der Ebene; CPU/RAM-Werte farbcodiert (≥90 % rot, ≥75 % amber).

## v4.29.1 — 2026-07-06

### Removed (Code-Bereinigung — tote/ungenutzte Exporte, Altlasten)
- **Verwaistes Modul `render-tree.js` gelöscht** (~144 Zeilen): eine nie importierte Alt-Implementierung der Baum-Ansicht; die „Baum"-Layout-Option nutzt Cytoscapes `breadthfirst` in render-tech, nicht dieses Modul.
- **9 tote Exporte entfernt** (nirgends importiert, nicht intern genutzt): `ensureTabs` (tabs), `isHighlightActive` (highlight), `getHistoryTimestamp` + `deactivateHistoryMode` (history-mode, mit stalen „wird aufgerufen"-Kommentaren), `getLang` (i18n), `clearPinned` + `findPreset` (storage), `isWeathermapMode` (traffic, in v4.26 hinzugefügt aber nie genutzt), `hasSnapshot` (diff-mode), `effectiveClusterMode` (group-cluster-layout).
- **5 überflüssige `export` entkernt** (nur modul-intern genutzt): `computeSeveritiesAt`, `toggleHistoryMode`, `switchProvider`, `fetchPatternSuggestions` — Funktionen bleiben, nur die öffentliche Sichtbarkeit fällt weg.
- **4 ungenutzte Imports entfernt**: `fmt` (render-diag), `fmt`/`SEV_COL`/`effectiveClusterMode` (render-tech).

Verifiziert: voller `deno check` über alle Module grün (kein gebrochener Import), Re-Analyse meldet 0 verbleibende tote Exporte/ungenutzte Imports/verwaiste Module. Netto −144 Zeilen, rein nicht-funktional (kein Verhaltensänderung).

## v4.29.0 — 2026-07-06

### Added
- **Wartung direkt aus der Map** (Rechtsklick auf Host → „🔧 Wartung 1h/4h/8h/24h"): legt über die neue Action `maintenance` eine One-Time-Wartung an (`API::Maintenance.create`, `maintenance_type=0` — Metriken laufen weiter, nur Alarme werden unterdrückt). Die Map wird handlungsfähig statt nur beobachtend („darf ich rebooten?" → Wartung an). Nur für Admins sichtbar (`can_edit` = ≥ ZABBIX_ADMIN); die Action prüft `USER_TYPE_ZABBIX_ADMIN` + Host-Schreibrecht (`editable=true`) serverseitig nochmal. Bestätigungsdialog + Toast; Aktivierung durch Zabbix' Timer in ~1 min.
- **Host-Ressourcen-Forecast** (Stats-Tab, unter dem Link-Forecast): neue Action `resource_forecast` regressiert die CPU-%/Memory-%-Trends und rechnet die ETA bis zur Sättigung — „Host X erreicht 90 % Memory in ~N Tagen". Tabelle sortiert nach frühester Sättigung (Mem→90 %, CPU→85 %), teilt den Zeitraum-Selektor mit dem Link-Forecast. Nur echte %-Items (`system.cpu.util`, `hrProcessorLoad`, `vm.memory…pused`/`utilization`) — absolute Byte-Items fallen bewusst raus. Cache-Key `uid+groups+days` (bounded, Hosts serverseitig aus den Gruppen abgeleitet).

### Changed
- Manifest: neue Actions `resource_forecast` + `maintenance` → **„Scan directory" nach dem Update nötig**.

### Notes
- CPU-Trends sind naturgemäß volatil; der Memory-Trend fängt Leaks/Wachstum zuverlässiger — im UI als Caveat vermerkt.

## v4.28.1 — 2026-07-05

### Security
- **Kapazitäts-Forecast APCu-Cache-Key gehärtet**: Der Cache-Key enthielt die vom Client gelieferte `hostids`-Liste (bis 200 Einträge) → ein authentifizierter User hätte durch Variieren der Teilmengen praktisch unbegrenzt viele APCu-Einträge (je 30 min TTL) erzeugen können (Speicherdruck-DoS; kein Datenleck, da user-scoped und permission-gefiltert). Key nutzt jetzt nur noch `uid+groups+days` — bounded wie die Topo-Baseline in Data.php. (Bug-/Security-Audit über den Code seit v4.26.0.)

### Audit-Ergebnis
- Zwei parallele Audits (Korrektheit/Performance + Security) über Weathermap, Topo-Alerting, What-if, Kapazitäts-Forecast, Health-History, Root-Cause, Port-Labels und die i18n-Migration. Verifiziert sauber: AuthZ beider neuer Actions (`capacity_forecast`, `health_history`) konsistent mit dem etablierten Muster, keine Permission-Bypässe beim Trend-/History-Lesen (alles über permission-gefilterte API-Calls), keine XSS-Sinks (host-/user-stammende Strings escaped, Port-Labels als Cytoscape-Canvas-Text statt innerHTML), keine Command-Injection im Sender-Skript (sauberes Quoting, `\n`-Stripping), Health-Score-Formel Backend↔Frontend deckungsgleich, keine Division-durch-null in Forecast/Weathermap/Health-Chart.

## v4.28.0 — 2026-07-05

### Added
- **Root-Cause-Ansicht** (Tools-Menü „🔍 Root-Cause"): trennt Offline-Hosts in **Ursache** vs. **Folge**. Zweifache BFS vom Uplink (dieselbe Referenz wie die What-if-Simulation) — Baseline ohne Ausfälle vs. Erreichbarkeit mit Offline-Hosts als Blocker. Ursache = Offline-Host mit noch erreichbarem Nachbarn (Frontier) oder selbst Uplink; Folge = Offline-Host dahinter. Rote/amber Underlays, Banner mit Ursachen/Folgen/Problemzahl, Toasts für die Top-3-Ursachen. ESC-Kette (Pfad → Sim → Root-Cause), Auto-Refresh rechnet aktiv neu. Verfügbare Hosts und Graph-Inseln werden nie angelastet.
- **LLDP-Port-Labels an Edges** (Anzeige-Menü, Best-Effort): Backend hängt an jede LLDP/CDP-Edge den Bracket-Parameter des meldenden Item-Keys (`ports = {reporter_hostid: port}`); bei LLDP-MIB-Triples wie `0.24.1` wird die Portnummer extrahiert. Neues Leaf-Modul setzt `source-`/`target-label` inline.

### Changed
- **i18n-Vollmigration**: ~226 verbleibende hartcodierte UI-Strings in 19 Modulen (Tabelle, Toolbar, Export/Audit-Report, Detail-Panel, Kontextmenü, Presets, Stats, Management, Legende, Tooltip, History u. a.) auf `t()` umgestellt. DE/EN-Dictionaries jetzt deckungsgleich (305 Keys je Sprache), verifiziert ohne fehlende Keys/Drift/Duplikate. Damit ist das gesamte Modul-UI zweisprachig.
- Auto-Refresh zieht `unavailable`/`down_since`/`last_seen` in die Node-Daten (Offline-X + Root-Cause aktualisieren ohne Voll-Render).
- Manifest: keine neuen Actions.

## v4.27.0 — 2026-07-05

### Added
- **Kapazitäts-Forecast** (Stats-Tab): für jeden Link mit bekannter Weathermap-Kapazität holt eine neue Backend-Action `capacity_forecast` die Zabbix-**Trends** (30/60/90 Tage, stündliche Mittelwerte) der Traffic-Items, legt pro Host+Richtung eine lineare Regression durch und das Frontend rechnet daraus die Edge-Prognose: aktuelle Auslastung, Trend in %-Punkten/Woche und **„80 % erreicht in ~N Tagen"** — kritischste Links zuerst, farbcodiert (<30 d rot, <90 d orange). Host-aggregierter Traffic wie im Weathermap-Modus → Schätzung, der Caveat steht im UI. APCu-Cache 30 min, Item-Klassifikation gespiegelt aus der data-Action (SNMP-Octets ×8, net.if via Item-Name).
- **Health-Score-Historie**: die data-Action liefert jetzt `health {avg, min}` (Server-Spiegel der Health-Tab-Formel). Der Sender-Cron pusht beides an neue Trapper-Items `nt.health.score` / `nt.health.score.min` → echte Zabbix-Historie, Graphen und Trigger („Network health score low", <70 Warning) via neuem Template `templates/nt_health_score_template.yaml`. Der Health-Tab zeigt den 14-Tage-Verlauf als Chart (Ø-Score + schlechteste Gruppe, Schwellenlinien 40/65/85) über die neue Action `health_history`; ohne eingerichteten Sender erscheint stattdessen ein Einrichtungs-Hinweis.
- `tools/topo-change-sender.sh` pusht den Health-Score automatisch mit (rückwärtskompatibel: fehlen Items oder liefert das Backend kein `health`, läuft der Topo-Teil unverändert).

### Changed
- `linkCapacity()` nach utils.js (war in build-elements inline, jetzt auch vom Forecast genutzt).
- Manifest: neue Actions `capacity_forecast` + `health_history` → **„Scan directory" nach dem Update nötig**.

## v4.26.1 — 2026-07-04

### Fixed
- **What-if-Simulation zählte Inseln als „abgeschnitten"**: Hosts ganz ohne LLDP/CDP-Kanten (bzw. Segmente ohne Pfad zum Uplink) wurden bei jeder Simulation rot markiert und mitgezählt, obwohl sie auch ohne Ausfall nie am Uplink hingen — egal welchen Host man ausfallen ließ. Jetzt rechnet die Simulation vorab eine Baseline-Erreichbarkeit; als abgeschnitten gilt nur, wer vorher erreichbar war und es durch den Ausfall nicht mehr ist.

## v4.26.0 — 2026-07-04

### Added
- **What-if-Ausfallsimulation**: Rechtsklick auf Host → „⚡ Ausfall simulieren". BFS vom Netz-Uplink zeigt alle dadurch abgeschnittenen Hosts (roter Halo); der simulierte Host bekommt einen grauen. Mehrere Hosts stapelbar, Banner mit Live-Count + Beenden-Button, ESC/Re-Render räumen auf. Uplink-Referenz: Internet-Wolke → Firewalls/Router → höchster Vernetzungsgrad (mit Toast-Hinweis).
- **Weathermap-Modus** (Anzeige-Menü): Edge-Farbe nach **Auslastungs-%** statt absolutem Traffic — 51 Mbps sind auf 1G-Link 5% grün, auf 100M-Link 51% gelb. Klassische Weathermap-Skala (blau→grün→gelb→orange→rot→magenta >85%), Auslastung als Edge-Label, Persistenz in localStorage. Kapazität aus `ifSpeed`/`ifHighSpeed` (auch moderne `net.if.speed[ifHighSpeed.X]`-Template-Keys); Edge-Kapazität = min beider Endpunkte (ohne Port-Mapping eine Schätzung — Tooltip zeigt „x% / 1 Gb/s" explizit). Health-Overrides (down/errors) behalten Vorrang. Edges ohne Speed-Items fallen auf die absolute Skala zurück.
- **Topology-Change-Detection**: Backend difft bei jedem Daten-Fetch den LLDP/CDP-Edge-Stand gegen eine APCu-Baseline (user+groups-scoped, rollt pro Poll). UI meldet Änderungen als Toasts („Topologie: neue Verbindung A ↔ B"). Für echte Zabbix-Events: `tools/topo-change-sender.sh` (Cron, Login-Dance + zabbix_sender, da Modul-Actions Frontend-Session brauchen) + `templates/nt_topology_change_template.yaml` (2 Trapper-Items + Trigger). Wichtig: dedizierter Monitoring-User, sonst verrollt der Cron die Baseline der UI-User.
- Tooltip zeigt bei bekannter Kapazität die Link-Auslastung („5.1% / 1.0 Gb/s").

### Notes
- Baseline liegt in APCu — php-fpm-Restart re-seedet ohne False-Alarm, Änderungen im Restart-Fenster werden nicht gemeldet.

## v4.25.0 — 2026-07-04

### Added (Items-Pivot-Ausbau, Fortsetzung)
- **Sparkline pro Zelle**: 1h-Verlauf (20 Punkte) links neben dem Wert, trend-farbig (rot steigend / grün fallend / blau neutral). Lazy-Batch-Fetch via neuer Action `network.topology.v6.item_history` (Chunks à 50 Items, Permission-gefiltert), 60s-Cache im Frontend.
- **Trend-Indikator ↑↓→** pro Zelle aus denselben History-Daten: Median der ersten 3 vs. letzten 3 Punkte, Schwelle 5%, Tooltip zeigt %-Änderung.
- **P50/P95/P99** zusätzlich zu Sum/Avg/Max im Pivot-Footer (linear interpolierte Perzentile).
- **Zellen-Tooltip** mit Item-Name + Description (Backend liefert `item_meta` mit itemid/name/desc), Zellen-Link geht jetzt direkt auf die konkrete itemid.
- **CSV-Export** der Pivot-Sicht: respektiert Filter/Sort/Hide-Empty, RFC-4180-Escaping + Formel-Injection-Schutz, Footer mit allen 6 Aggregaten.
- **Live-Autocomplete** beim Pattern-Tippen: "142 Items matchen · z.B. …" nach 400ms Debounce, via neuer countOutput-Action `network.topology.v6.item_count`.
- **Preset-Descriptions** im Dropdown (was liefert das Pattern, wann ist es nützlich).
- **Anomalie-Marker ◆** (lila): Zellen > 2σ̂ vom Spalten-Median (robuste MAD-Statistik, ≥5 Werte nötig).
- **deploy.sh**: automatisiertes Deploy-Skript mit PHP-FPM-/UI-Pfad-Autodetect, Staging + atomarem Swap.

### Fixed (Audit-Runde 2 — zwei parallele Reviews über den Code seit v4.21.1)
- **iface_health war bei Standard-Zabbix-7-Templates komplett leer**: der generische `net.if`-Traffic-Branch schluckte die modernen Template-Keys (`net.if.status[ifOperStatus.1]`, `net.if.in.errors[...]`) bevor die Health-Branches griffen.
- **LLDP-Q-Tab war immer leer**: `lldp_quality` wurde vom Fetch nie in `_ntLastData` übernommen. Zusätzlich doppelter Header entfernt.
- **Down-Detection entrauscht**: `ifOperStatus`+`ifAdminStatus` via Bracket-Param korreliert (admin-down = gewollt), notPresent/unknown ignoriert, Edge färbt erst ab ≥50% down-Ratio rot (vorher färbte ein unbenutzter Switch-Port jede Edge).
- **cleanNeighbor-Regression**: Raw-Exact-Match vor dem Vendor-Cleanup — SysNames mit Leerzeichen ("Core Switch 1") wurden sonst zerschnitten und unmatched.
- **Compliance stale-Problem-Check**: serverseitig `time_till=cutoff` statt Client-Filter (eventid-DESC+Limit warf genau die ältesten Events weg → False-Negatives); `recent=true` entfernt.
- **ItemHistory-Starvation**: chatty Items (1s-Intervall) fraßen das globale History-Limit — jetzt Chunks mit proportionalem Limit.
- **Listener-Leak** der Pattern-Combo (ein document-Listener pro Items-Render, Wallboard: unbegrenzt).
- **Popup-Blocker**: Audit-Report öffnet das Fenster synchron im Click, Inhalt kommt async.
- **deploy.sh**: Remote-Variablen waren undefined (quoted Heredoc); grep unter pipefail starb stumm; rm-vor-unzip konnte das Modul ohne Rollback löschen.
- Health-Tab Karten-Layout lief rechts über ("PROBL" abgeschnitten).

### Security
- **CSV-Formel-Injection** neutralisiert (führende `= + - @` bekommen `'`-Präfix; Zahlen inkl. negativer bleiben unangetastet).
- **Compliance-Tab + Action auf ZABBIX_ADMIN** gegated (Security-Posture-Karte war für Read-only-User eine Recon-Hilfe) + 60s-APCu-Cache gegen Endpoint-Hammering.
- **deploy.sh**: `--`-Separator für ssh/scp + Guard gegen Option-Injection via Server-Argument.
- Verifiziert sauber: ItemHistory-Permission-Filterung (Client-itemids laufen durch permission-gefiltertes Item.get), alle neuen XSS-Sinks escaped, alle neuen Actions mit requireAjax + Validierung.

### Changed
- **Dedup nach utils.js**: `buildBaseUrl()`, `mkTabTheme()`, `aggregateValues()` (waren 2-4× kopiert und drifteten bereits); `COMPLIANCE_CHECKS` + `fetchComplianceData()` als Single Source in render-compliance.js.
- Manifest: neue Actions `item_history` + `item_count` → **"Scan directory" nach dem Update nötig**.

## v4.24.0 — 2026-06-25

### Added
- **Interface-Health auf Edges**: Edges im Tech-Tab zeigen jetzt nicht nur Traffic-Volumen sondern auch den Zustand der Verbindung. Backend aggregiert pro Host:
  - `ifOperStatus != 1` → `down_count`
  - `ifInErrors`/`ifOutErrors` (auch Agent-Varianten `net.if.in[*,errors]`) → `errors_rate`
  - `ifInDiscards`/`ifOutDiscards` (auch `net.if.in[*,dropped]`) → `discards_rate`
- **Edge-Styling-Hierarchie** (überschreibt Traffic-Heatmap bei Issues):
  - Down-Interface → rot dashed (`#dc2626`, pattern 4-4, dicker)
  - Errors > 1/s → orange thicker
  - Discards > 5/s → amber dashed
  - sonst → Traffic-basierte Färbung wie gehabt
- **Edge-Tooltip** zeigt zusätzliche Zeile mit `⬇ N down · err X/s · drop X/s` wenn Werte > Threshold.

### Caveat
Aggregat über alle Interfaces beider Endpunkte — exakte Port-zu-Edge-Zuordnung fehlt (würde LLD-basierte LLDP-Port-Items voraussetzen). Bei Hosts mit vielen Interfaces können False-Positives entstehen ("Interface 23 hat Errors → ALLE Edges des Hosts werden orange"). Im Zweifel die genauen Port-Stats in Zabbix selbst nachschauen.

## v4.23.0 — 2026-06-25

### Added
- **CDP-Support**: zusätzlich zu LLDP (`lldpRemSysName`) werden jetzt `cdpCacheDeviceId` (Cisco), `neighbor.sysName`, `discovery.neighbor` (Ubiquiti/MikroTik/custom) sowie generischer Regex `(lldp.*sysname|cdp.*device)` für vendor-spezifische Items erkannt.
- **Discovery-Source-Tracking**: jede Edge speichert die Quelle (`src: ['lldp']`, `['cdp']`, oder `['cdp','lldp']` wenn beide Protokolle dieselbe Verbindung melden). Edge-Tooltip im Tech-Tab zeigt ein farbiges Badge.
- **Merge-Dedup statt erstes-gewinnt**: Wenn LLDP und CDP dieselbe Verbindung erkennen → eine Edge mit beiden Sources.
- **LLDP-Q Tab**: neuer Tab "LLDP-Q" mit Aggregat-Header (Match-Quote farbig + Counts) und zwei Tabellen:
  - **Pro-Reporter**: Reporter-Host mit Matched/Unmatched/Ambiguous/Self-Counts plus inline Beispiele
  - **Top-Unmatched-Neighbors**: distinct gemeldete Namen sortiert nach Häufigkeit, mit Source-Badge und Reporter-Liste
  Zabbix selbst klassifiziert LLDP-Nachbarn nicht als "unbekannt" — diese Bewertung macht jetzt das Modul aus den rohen Item-Values.

### Changed
- **Neighbor-Trennzeichen**: `,` `\n` `\r` `|` werden jetzt alle als Separator akzeptiert (CDP-Output ist oft mehrzeilig).
- **`cleanNeighbor()`-Cleanup**: schneidet Vendor-Suffixe ab — alles ab erstem Leerzeichen (`hostname Description`), ab `(` (`hostname(serial)` — Cisco), Trailing-Punkte (FQDN-Wurzel). Damit matchen Cisco-IP-Phones, HP-Aruba SysDescr-Mixups, Ubiquiti-Strings besser.
- **Reverse-DNS-Pattern**: `ip-10-0-0-5.example.com` oder `host-10-0-0-5` wird auf IP extrahiert und gegen `ip_map` gemappt.
- **Ambiguous-Tracking**: Short-Name-Match mit >1 Kandidaten wird jetzt explizit als "ambiguous" markiert statt silent als unmatched verbucht (sonst zufällige Edge-Zuordnung).
- **`lldp_unmatched`-Log** enthält jetzt einen `src`-Marker (`lldp`/`cdp`/`other`) zum Debuggen.

### Backend
- `NetworkTopologyData` liefert neues Feld `lldp_quality[hostid]` mit strukturierten Quality-Daten pro Reporter.

## v4.22.0 — 2026-06-25

### Added
- **Compliance-Tab**: neuer Tab in der Toolbar mit Security- und Konfigurations-Checks pro Host. Aggregat-Karten oben (pro Check Count/Total/Prozent), Pro-Host-Matrix unten mit Symbol-Spalten (`✓` good / `i` info / `✗` bad / `·` keine Daten). Toggle "Nur Hosts mit Issues" filtert auf bad-Level-Hits.
- **Neue Backend-Action `network.topology.v6.compliance`**: ein `Host.get` + ein `Problem.get` + ein `Maintenance.get` liefern die Daten für 9 Checks:
  - `snmp_v2` — SNMPv1/v2c statt v3 erkannt (bad)
  - `snmp_v3` — SNMPv3 verwendet (good)
  - `no_tls` — Agent ohne TLS/PSK (tls_connect+accept=1) (bad)
  - `no_proxy` — direkt am Server, kein Proxy/-Group (info)
  - `no_inventory` — inventory_mode=disabled (info)
  - `no_location` — keine location_lat/lon im Inventory (info)
  - `no_template` — Host hat keinen Parent-Template (bad)
  - `stale_problem` — krit. Problem (sev≥4) > 7 Tage offen (bad)
  - `mtnc_no_comment` — Maintenance aktiv aber description leer (info)
- **Audit-Report bekommt Compliance-Sektion**: Click auf Audit-Report (PDF/HTML) holt die Compliance-Daten async und hängt eine Sektion mit Check/Level/Count/% am Report-Ende an. Fetch-Tolerant: bei Fehler oder leerer Group-Auswahl fällt der Report auf "ohne Compliance" zurück.

### Notes
- Manifest erweitert um Action `network.topology.v6.compliance` → `Administration → General → Modules → Scan directory` ist nach dem Update Pflicht damit Zabbix die Route kennt.

## v4.21.1 — 2026-06-25

Security- + Performance-Sweep nach zwei parallelen Audit-Reviews.
Keine neuen Features, nur Hardening und Backend-Optimierungen.

### Security
- **Diag-Tab Super-Admin-only**: `checkPermissions() === USER_TYPE_SUPER_ADMIN` (vorher >= ZABBIX_ADMIN — jeder Hostgroup-Admin sah Backend-Performance-Daten). NT_CONFIG exponiert `is_super_admin`, Tab im UI nur für Super-Admins.
- **Topology-Widget XSS-Fix**: Hostnames/IPs im Tooltip und Mgmt-Tiles via neuem `_esc()`-Helper escaped. LLDP-/SNMP-sysName aus dem Netzwerk war zuvor ein Stored-XSS-Vektor.
- **Open-Redirect-Defense-in-Depth**: `context-menu.js` prüft client-side noch einmal `^https?://` für `nt:link`- und Integration-Macro-URLs (Backend tut's schon).
- **Numerische Felder gecastet**: `Number()` vor innerHTML-Interpolation in Widget für `cpu/memory/ping/problems/ageMin` — falls Backend mal String liefert oder MITM manipuliert.
- **Pattern-DoS-Schutz**: `NetworkTopologyItems` cappt Pattern auf 200 Chars / max 4 Wildcards / keine Control-Chars.
- **APCu-TTL** `DiscoverPatterns` 300s → 60s — Permission-Drift-Schutz bei Hostgroup-Entzug.
- **JSON-Hardening** Widget-Views: `JSON_HEX_TAG|HEX_AMP|HEX_APOS|HEX_QUOT` für data-* Attribute.
- **URL-Param-Cap** `?groups=` mit `array_slice(0, 200)` gegen O(n²)-DoS.
- **`nt:show`-Tag** 200-Chars-Cap.

### Performance
- **`API::Problem`** mit `recent=true` + `sortfield=eventid DESC` + `limit` — vorher zog historic Problems (tausende bei vielen Hosts) obwohl nur 20/Host genutzt werden.
- **`selectHostGroups`** direkt im Host.get statt zweiter HostGroup.get-Roundtrip + N×M-Loop.
- **`nodeById`-Map** in `build-elements.js` statt `nodes.find()` × Edges — bei 500 Hosts × 800 Edges 800k Vergleiche weg.
- **LLDP-Short-Name-Map** vorberechnen statt linearem Scan pro Edge — 250k Vergleiche weg bei vergleichbarer Größe.
- **Zwei Item.get-Calls verschmolzen** zu einem (`searchByAny=true` macht beide API-seitig identisch).
- **`primaryIp` Cache** pro Host vermeidet doppelten `usort` der Interfaces.
- **Spark Problem.get** mit `selectHosts` statt separatem Trigger.get (N+1 weg).

### Memory / Bug Fixes
- **Widget sort-closure** liest jetzt aus dem richtigen Scope (vorher beide Sort-Seiten gleich geranked).
- **Edge-Animation** prüft `cy.destroyed()` + `document.hidden` — kein CPU-Burn bei verstecktem Tab, sauberer Stop bei Tab-Wechsel.
- **`icons.js` LRU-Fix**: `delete` vor Re-Insert damit der Pruner nicht frische Einträge rausschmeisst (JS-Object-Insertion-Order-Falle).
- **Minimap**: First-Init-Guard verhindert Listener-Akkumulation bei Re-Renders; Debounce-Timer wird in `hideMinimap()` ge-cleart.
- **ESC-Keydown** nur einmal pro Page-Load registrieren (`window._ntEscListenerInstalled`-Flag).
- **`_primaryGroup`-Cache** pro Render neu berechnen statt nur bei `!_primaryGroup` — Cache-Drift bei Group-Wechsel weg.
- **Doppelter `cy.on('tap')`-Handler** in `render-tech.js` zusammengeführt.
- **query.js TDZ-Fix**: `case 'match'` const in `{}`-Block.
- **History-Error-Message** berechnet sich jetzt aus `MAX_RANGE_SECONDS` (vorher hardcoded "7 days" obwohl Konstante 31d war).

## v4.21.0 — 2026-06-24

### Added
- **Path-Highlight** im Tech-Tab: Rechtsklick "Pfad von hier" + auf anderem Host "Pfad zu hier" → BFS-Pfad zwischen den beiden Hosts wird cyan hervorgehoben, Rest gedimmt. Manuelle BFS-Implementierung statt cytoscape's eingebauter (die war in der minifizierten Version unzuverlässig).
- **Multi-Group-Filter** in der Tabelle: AND-Verknüpfung mehrerer Hostgroups via Chip-Row + Add-Dropdown. Match läuft über `n.groups[]` (alle Gruppen), nicht mehr nur `_primaryGroup`.
- **Token-Suche** in der Tabelle: whitespace-getrennte Tokens, jeder muss matchen (AND), `-wort` für NOT. Haystack enthält Gruppennamen.
- **Query-Sprache (`query.js`)** als Erweiterung der Token-Suche: `host:fox OR host:bar`, `(a OR b) c`, `-tag:wartung`, quoted strings, Field-Prefixe `host/label/ip/type/iftype/proxy/group`. Bare Tokens matchen Host/Label/IP only (nicht Proxy/Group — sonst matchte z.B. "prx" alle Hosts wenn der Zabbix-Proxy "fox-prx" heißt). Gleiche Syntax in Hosts- und Items-Modus.
- **Toast-Notifications** (`toast.js`) statt blockierender `alert()`-Dialoge. Info/Success/Warn/Error-Varianten.
- **URL-Bookmark** der Tabellen-Sicht: Filter/Sort/Mode persistieren via `?t_sev=&t_g=&t_q=...` in der URL. Teilbar via Link, überlebt Reload.
- **Maintenance-Ring** im Tech-Tab: orange-gestrichelter Außenring um Hosts in Maintenance (zusätzlich zum bestehenden Wrench-Badge).
- **Toolbar-Refactor**: ~25 Buttons auf primary inline + 3 Dropdown-Menüs (Anzeige / Layout / Tools) reduziert. Einheitliches Item-Styling.
- **Diff-Mode** (`diff-mode.js`): Snapshot-Button merkt aktuellen Stand in localStorage. Tabelle zeigt Diff-Badge pro Zeile (+ neu, ↑ schlimmer, ↓ besser) plus Counter "+N / −N / ↑N seit Xmin".
- **Edge-Tooltip-Sparkline**: Hover über Edge → 1h-Traffic-Trend (Summe beider Endpunkte, in/out separat). Backend `Spark`-Action liefert `traffic_in[]`/`traffic_out[]` aggregiert über `net.if`/`ifIn/Out/HC`-Items.
- **Diag-Tab** (Admin-only): Letzte ~50 Backend-Aufrufe aus APCu-Ring-Buffer. Pro Eintrag: action, elapsed_ms, bytes, cache_hit, counts. Zusammenfassungs-Tabelle mit Avg/Max-Latenz pro Action.
- **Health-Tab**: Topology Health Score 0-100 pro Hostgroup. Formel: `100 − offline%·40 − stale%·15 − critical%·25 − unacked%·20`. Karten-Grid sortiert nach worst-Score zuerst, Score-Farbe Gesund/OK/Achtung/Kritisch.
- **Stats-Tab** (Wochen/Monatsübersicht): Range-Selector 7/14/30 Tage, Tagesbalken (SVG, severity-stacked), Top 10 Hosts + Top 10 Trigger. Backend `History`-Action MAX_RANGE_SECONDS 7d → 31d hochgesetzt.
- **Filter-Presets** in der Tabelle: Built-ins (Nur Firewalls/Server/Switches/Storage/Offline + Disaster + Crit+High) + User-eigene benannte Presets (localStorage, user-scoped).
- **Integration-Links** via Zabbix Global-Macros: `{$NT_INT_<NAME>_LABEL}` + `{$NT_INT_<NAME>_URL}` mit Token-Substitution `{host}/{label}/{ip}/{location}`. Backend expandiert pro Host, Frontend zeigt's im Kontextmenü wie `nt:link`-Tags. Für NetBox/Wiki/Zammad/Grafana etc.
- **Audit-Report** im Export-Dropdown (PDF/HTML): strukturierter Bericht mit Summary, Top-10 Problemhosts (Badness-Ranking), Hostgroups + Score, Kritische Hosts, Offline+Stale, Top-10 Probleme, Proxy-Übersicht.
- **Offline-X deutlicher**: weißer Halo + größeres X + kräftigeres Rot (#dc2626) im SVG-Icon für offline Hosts.
- **Health Score / Stats / Diag** alle als neue Tabs neben Tech/Mgmt/Tabelle/Geo.

### Changed
- **CSRF-Härtung**: alle 5 Read-only-Actions (Data/History/Items/Discover/Spark/Diag) prüfen jetzt `X-Requested-With: XMLHttpRequest`. Cross-Origin-Browser können den Header nicht ohne CORS-Preflight setzen — schützt vor CSRF-Last-Abuse trotz `disableCsrfValidation()`.
- **Edit-UI rolle-bewusst**: "Bearbeiten" und "Hosts (Liste)" im Kontextmenü/Detail-Panel/Tabelle-Action-Bar nur sichtbar bei `NT_CONFIG.can_edit` (Admin+).
- **Geo-Popups als DOM-Nodes** statt HTML-Strings — umgeht Leaflet-1.9.4 `bindPopup`-XSS-Pfad. User-Daten via `textContent`, kein `innerHTML` mehr.
- **Generic Search-Placeholder**: `host:web`, `group:dc1`, `proxy:zbx-px` statt umgebungsspezifischer Beispiele.
- **MAX_GROUPS=100** in `NetworkTopologyData` als Hard-Limit gegen pathologisch große Group-Arrays.
- **APCu-Cache Defense**: `cacheKey()` liefert leer bei `userid=0` (Session-Loss) → kein Cross-User-Bucket.
- **Repo-Migration** auf `git.fox1.de/planet_fox/zabbix-network-topology-v2.git` (Mono-Repo-Wechsel der Vorgänger).

### Fixed
- **Pin-Positions** bleiben beim Layout-Wechsel erhalten (vorher: unlock+layout+relock zerstörte Pin-Koordinaten).
- **ESM-Cache-Buster**: rekursiver Blob-URL-Loader für alle Module. Statische `import ... from './foo.js'`-Pfade kriegen den `?v=<mtime>`-Buster jetzt automatisch — nach Deploy reicht einfacher Reload, kein "Empty Caches" mehr nötig.

### Removed
- **Mail-Reste**: `export-mail.js` → `export.js` umbenannt (Mail-Funktion war im Vorgänger entfernt, aber `isEmail`-Branch, CSRF-Token für Mail-Action und Kommentare blieben drin).

## v4.20.0 — 2026-05-06

### Added
- **Offline-Detection** (Backend + alle 5 Tabs): `Host.get` prüft `interface.available === 2` UND `host.active_available === 2` (Zabbix 7.0+ für Active-Agents). Frontend markiert Offline-Hosts in Detail-Panel (roter Banner), Hosts-Tabelle (gedimmte Zeile + OFFLINE-Pille), Tech-Tab Cytoscape (graue dashed Pie + rotes X), Mgmt-Tab (gedimmte Tile + OFFLINE-Header), Geo-Tab (grauer Marker + rotes X).
- **Stale-Data-Detection**: Backend liefert `last_seen = max(item.lastclock)` pro Host. Frontend markiert Hosts als STALE wenn `unavailable=false` aber Items > 5 min nicht aktualisiert (orange Pille + Banner).
- **Offline-Counter im Mgmt Stats-Header** + **"Nur Offline"-Filter** in Hosts-Tabelle und Tech-Tab.
- **Detail-Panel-Refresh**: Card-Sections (Status / Identität / Metriken / Items / Verbindungen) statt flacher Rows-Tabelle. Items > 4 in `<details>`-Block kollabiert. Action-Bar Zabbix-flacher.
- **Dashboard-Widget** (`widget/`-Subdir): separates Zabbix-Modul vom Typ `widget`, rendert die Daten dieses Hauptmoduls in Dashboard-Kachel. Reduzierte Tech+Mgmt-Sicht, gleiche Offline/Stale-Detection, optionaler `hide_offline`-Toggle.

### Fixed
- **Auto-refresh-Pause während Drag**: Cytoscape `grab`/`dragfree`-Events setzen `_ntDragActive`-Flag, Auto-Refresh skippt während Drag — kein "Drag-bricht-ab"-Bug mehr.
- **Tabelle Zabbix-Native-Look**: Border-Radius 6-8px → 2-3px, Cell-Padding 11×14 → 5×8, Zabbix-Farb-Tokens (#0275b8 Accent, #1f2c33 Text, #dfe4e7 Border, #e53742 Critical), tabular-nums in numerischen Spalten.

## v4.19.0 — 2026-05-05

### Added
- **Probleme aufklappbar in der Tabelle**: Klick auf den Probleme-Counter öffnet eine Detail-Zeile mit den einzelnen Problemen (Severity-Punkt, Name, Acked-Häkchen, Alter). Backend liefert pro Host bis zu 20 Probleme, sortiert nach Severity desc + Clock desc.
- **Management-Tab Stats-Header**: Aggregat-Kacheln oben (Hosts / Mit Problem / Wartung / Bestätigt) plus Severity-Pillen für Krit→Info. Levels jetzt nach Worst-Severity desc sortiert (Tiebreaker: MGMT_LEVEL).
- **Dark-Mode für Tabellen-Tab**: zentrales Theme-System (`mkTheme(dark)`) liefert komplette Farb-Map an alle Build-Funktionen — keine hardcoded `#f8fafc`-Konstanten mehr im Body.
- **Layout-Routing durch Cluster**: `runGroupClusterLayout` akzeptiert optionalen `innerLayoutId`-Parameter (`cose`/`grid`/`breadthfirst`/`concentric`/`circle`). Layout-Toggle in der Toolbar respektiert jetzt Cluster-Boundaries — "Raster"/"Baum"/"Konzentrisch" laufen per-Cluster statt global.
- **Items-Pivot**: Preset-Auto-Switch auf "Custom" bei manueller Pattern-Änderung; Quotes (`"BR-MAILCOW"`) in Spalten-Headern werden gestrippt.
- **Cache-Buster im JS-Loader**: `?v=<mtime>` an Haupt-JS und Haupt-CSS, abgeleitet aus dem max. mtime von `network-topology.js` / `network-topology.css` / `manifest.json`. Bei jedem Deploy bekommt der Browser eine neue URL und kann die alte Version nicht mehr aus dem Cache servieren.

### Changed
- **Toolbar-Cleanup**: graph-spezifische Buttons (Layout/Cluster/Zoom/Fit/Hide-Labels/LLDP/Link/Presets/Sev-Filter/Suche) werden in Mgmt/Tabelle/Geo automatisch ausgeblendet.
- **Tabelle Polish**: Zell-Padding 6×10 → 11×14, numerische Spalten in Mono-Font (IP/CPU/Mem/Ping/Traffic), Status-Pille mit Severity-Dot, integriertes Lupen-Icon im Suchfeld + Accent-Focus-Ring.
- **Filter-Bar**: keine Trennstriche mehr, Segmente per `gap` getrennt; Mode-Toggle (Hosts/Items) mit 6px Border-Radius, Action-Buttons als 24×24-Tiles.
- **Items-Pivot Tabelle**: gleiche Header-Optik wie Hosts-Mode (12px Padding, 10.5px Schrift, sticky Host-Spalte mit Border-Right), Empty-State mit 🔍-Glyph.

### Fixed
- **Cluster-Layout Hüllen-Überlappung**: `COLUMN_PADDING` 40 → 110, `group-hulls` `PADDING` 60 → 30. Ergibt jetzt einen klaren ~90px Sichtgap zwischen benachbarten Hüllen statt der vorigen Berührung/Überlappung.
- **Spalten-Breite proportional zur Knoten-Anzahl**: kleine Gruppen bekommen nicht mehr halb-leere Boxen, in denen cose Knoten unnötig auseinanderspreizt. Min-Floor (200px Spalte / 140px Reihe) wird auch nach Shrink garantiert eingehalten.
- **Sync-Race im pending-Counter**: discrete Layouts (grid/circle/concentric/breadthfirst) feuern `layoutstop` synchron — `pending` wird jetzt in einem ersten Pass berechnet, damit `cy.fit()` und `onComplete` genau einmal feuern statt N-mal pro Cluster.
- **Console-Logs**: `[cluster] ...`-Debug-Spam entfernt.

## v4.18.3 — 2026-04-29

### Fixed
- **group-hulls + minimap**: defensive NaN-Filter beim Zeichnen + Diagnose-Logging. Race zwischen Cluster-Layout-Init (setTimeout 50ms) und SVG-Render konnte zu Console-Errors führen.

## v4.18.2 — 2026-04-29

### Fixed
- **NaN-Positions**: group-hulls und minimap überspringen jetzt Knoten mit nicht-validen Koordinaten (waren zu Layout-Init noch unpositioniert).

## v4.18.1 — 2026-04-29

### Fixed
- **primaryGroup**: Iteriert jetzt über User-Auswahl statt über `n.groups`. Hosts in mehreren Groups landen in der zuerst-gewählten Spalte (vorher: alphabetisch erste in `n.groups`).

## v4.18 — 2026-04-29

### Added
- **Adaptives Group-Cluster-Layout**: 4 Modi (Auto/Spalten/Reihen/Aus) per Toolbar-Toggle.
  - Auto: 2-3 Gruppen → Spalten, 4+ Gruppen → Reihen
  - Cluster-Layout läuft jetzt auch bei gespeicherten Positionen (User-Wunsch — vorher blockierte ein einmaliges "Speichern" das Layout permanent)
  - Modus persistent in localStorage

### Changed
- `multi-column-layout.js` umbenannt → `group-cluster-layout.js` (rewritten)
- Group-Hulls nur sichtbar wenn Cluster-Modus aktiv

## v4.17.1 — 2026-04-29

### Fixed
- **B2 Race Conditions**: Sequence-Counter `_fetchSeq` in History applyRange + Items loadAndRenderItems
- **B3 Performance**: Items-Pivot stoppt deep-clone (`JSON.parse(JSON.stringify(...))`) bei jedem Render

### Changed
- **B4**: Spark-Action capped hostids bei 50
- **S1 + S2**: nt:link URL und Label haben jetzt Length-Cap (2048/200) + Control-Char-Filter (`[\x00-\x1F\x7F]`)
- Tag-Value gesamt cap: 2500 Zeichen

## v4.17 — 2026-04-29

### Removed
- **Mail-Funktion komplett entfernt** (User-Wunsch)
  - `actions/NetworkTopologyMail.php` gelöscht
  - `network.topology.v6.mail` aus manifest.json
  - "Per Mail senden" aus Export-Menü
  - `setupMailButton()` + `sendReport()` aus toolbar/export-mail
- SMTP-Passwort-Datei-Handling entfällt

### Fixed
- **B1 Detail-Panel-Leak**: `render-table.js` prüft vor `appendChild` ob `#nt-detail-panel` schon existiert. Beim Mode-Toggle (Hosts↔Items) und Tab-Wechsel kamen sonst mehrere DOM-Elemente mit gleicher ID (sichtbar als "weißer Balken" rechts oben).

## v4.16 — 2026-04-29

### Added
- **Proxy/Proxy-Group-Info** an Hosts:
  - Backend: `host.get` mit `proxyid` + `proxy_groupid`, plus `proxy.get` und `proxygroup.get` Lookups
  - Tabelle: Tooltip am `(SNMP)`/`(Agent)`-Span zeigt "Proxy: ..." oder "Server (kein Proxy)"
  - Detail-Panel: Interface-Zeile mit "via proxy-X [grp:...]"
  - Suche akzeptiert Proxy-Name + Proxy-Group-Name
  - Try-Catch um neue API-Calls für Zabbix 6.x-Kompatibilität

## v4.15.1 — 2026-04-29

### Added
- **Items-Pivot Polish**:
  - Persistenz: Mode + Pattern in localStorage
  - Sortierbare Spalten (Klick auf Header)
  - Hostname-Filter mit 150ms Debounce + Counter
  - Spinner statt Emoji
  - Verbessertes Empty-State mit Hilfetext

## v4.15 — 2026-04-29

### Added
- **Items-Pivot-Modus** im Tabellen-Tab:
  - Toggle "Hosts/Items" in Filter-Bar
  - 7 Presets: Disks (pused/used), Memory, CPU, Net In, Net Out, Ping
  - Custom-Pattern mit Wildcards (min 3 Non-Wildcard-Zeichen)
  - Backend: neue Action `network.topology.v6.items` mit `searchWildcardsEnabled`, max 5000 Items
  - Spalten-Label aus Discovery-Parameter (`vfs.fs.size[/var,pused]` → "/var")
  - Auto-Format nach Unit (%/B/Bps/ms)
  - Sticky Hostname-Spalte beim Scrollen

## v4.14 — 2026-04-29

### Added
- **History-Mode** mit Slider:
  - Toolbar-Button "🕐 Historie" toggelt gelbe Slider-Bar
  - Range: 1h / 24h / 7d
  - Play/Pause für Auto-Step (1 Step pro Sekunde)
  - Backend: neue Action `network.topology.v6.history` (event.get + problem.get)
  - Hosts ohne aktive Probleme zur Cursor-Zeit: opacity 0.25
  - Live-Refresh pausiert während History aktiv
  - Funktioniert in allen Tabs (Tech/Mgmt/Tabelle/Geo)

## v4.13.1 — 2026-04-29

### Added
- **Interface-Typ in IP-Spalte**: zeigt `192.168.33.10 (SNMP)` etc.
- Suche akzeptiert iftype-Filter

## v4.13 — 2026-04-29

### Changed
- **Hierarchisch-Tab durch Tabellen-Tab ersetzt** (war redundant mit Hierarchie-Layout)
- 11 Spalten: Status, Host, Type, Group, IP, CPU, Mem, Ping, Traffic, Probleme, Actions
- Linker farbiger Status-Streifen pro Zeile
- Filter-Bar: Severity-Pills + Group-Dropdown + Suche
- Sortierbare Header

## v4.12.1 — 2026-04-29

### Added
- **Multi-Column-Layout** bei Multi-Group-Auswahl
- Bei ≥2 Hostgroups Spalten-Layout pro Gruppe
- Internet-Knoten zentriert oben

## v4.12 — 2026-04-29

### Added
- **Group-Hulls (Lasso)**: SVG-Overlay mit Convex-Hull pro Hostgroup
- Andrew's monotone chain Algorithm
- Padding 60px, fill-opacity 0.10, gestrichelter Stroke

## v4.11.2 — 2026-04-29

### Fixed
- Graphs-URL im Kontextmenü: braucht `filter_hostids[]` (nicht `hostids[]`)

## v4.11.1 — 2026-04-29

### Added
- **Action-Buttons im Detail-Panel**: Latest Data, Probleme, Graphs, Bearbeiten

## v4.11 — 2026-04-29

### Added
- **Geräte-Typ im Detail-Panel**:
  - Header: `🔀 HP24GARUBA [SWITCH]` mit Icon + Pille
  - Tabellen-Zeile "Type" zwischen Host und IP
  - Custom-Indikator (gelber `*`) wenn `nt:icon`-Tag den Auto-Detect überschreibt
  - 19 Device-Typen mit `TYPE_INFO` Map

## v4.10.2 — 2026-04-29

### Fixed
- Toolbar wickelt sauber bei schmalem Viewport (`flex-wrap: wrap; row-gap: 4px`)
- `setupPresetsUI` + taphold-toggle bekamen Idempotenz-Check

## v4.10.1 — 2026-04-29

### Fixed
- Alle 5 Bug-Fixes aus dem Code-Review:
  1. Active-Preset als `{name, scope, scopeKey}`-Tripel
  2. Permission-Filter für `selected_groupids` in `NetworkTopologyView.php`
  3. `saveLastGroups` erst nach erfolgreichem Fetch
  4. Internet-Knoten aus `savePositions` ausgefiltert
  5. Mail `html_b64` 5MB Size-Limit
