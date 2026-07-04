# Changelog

Alle relevanten Änderungen am Modul. Versionsschema: MAJOR.MINOR.PATCH.

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
