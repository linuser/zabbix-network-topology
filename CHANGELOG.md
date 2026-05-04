# Changelog

Alle relevanten Änderungen am Modul. Versionsschema: MAJOR.MINOR.PATCH.

## v4.19.0 — 2026-05-05

### Added
- **Probleme aufklappbar in der Tabelle**: Klick auf den Probleme-Counter öffnet eine Detail-Zeile mit den einzelnen Problemen (Severity-Punkt, Name, Acked-Häkchen, Alter). Backend liefert pro Host bis zu 20 Probleme, sortiert nach Severity desc + Clock desc.
- **Management-Tab Stats-Header**: Aggregat-Kacheln oben (Hosts / Mit Problem / Wartung / Bestätigt) plus Severity-Pillen für Krit→Info. Levels jetzt nach Worst-Severity desc sortiert (Tiebreaker: MGMT_LEVEL).
- **Dark-Mode für Tabellen-Tab**: zentrales Theme-System (`mkTheme(dark)`) liefert komplette Farb-Map an alle Build-Funktionen — keine hardcoded `#f8fafc`-Konstanten mehr im Body.
- **Layout-Routing durch Cluster**: `runGroupClusterLayout` akzeptiert optionalen `innerLayoutId`-Parameter (`cose`/`grid`/`breadthfirst`/`concentric`/`circle`). Layout-Toggle in der Toolbar respektiert jetzt Cluster-Boundaries — "Raster"/"Baum"/"Konzentrisch" laufen per-Cluster statt global.
- **Items-Pivot**: Preset-Auto-Switch auf "Custom" bei manueller Pattern-Änderung; Quotes (`"BR-MAILCOW"`) in Spalten-Headern werden gestrippt.

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
