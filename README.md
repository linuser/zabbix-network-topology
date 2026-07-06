# Network Topology for Zabbix

Zabbix 7.4 Frontend-Modul für interaktive Netzwerk-Topologie-Visualisierungen mit Cytoscape.js und Leaflet.

![Status](https://img.shields.io/badge/zabbix-7.4-red)
![Version](https://img.shields.io/badge/version-4.29.7-blue)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue)

## Was ist das?

**Network Topology for Zabbix** ist ein Frontend-Modul für Zabbix 7.4, das Hosts,
Hostgruppen, Probleme, Traffic, Health-Status und Geodaten als **interaktive
Netzwerk-Topologie** visualisiert — statt Hosts nur in Listen zu sehen, zeigt es,
_wie_ sie zusammenhängen (via LLDP/CDP entdeckt), wo es klemmt und was daraus folgt.

Highlights: Live-Graph mit Severity-Ringen · Weathermap (Link-Auslastung) ·
What-if-Ausfallsimulation & Root-Cause · Kapazitäts-Forecast · Wartung direkt aus
der Karte · Health-Score pro Hostgruppe · Geo-Karte · Wallboard-Modus · DE/EN.

> Technische Modul-ID: `network_topology_v6` (installiert als Verzeichnis gleichen
> Namens). Das „v6" ist die interne Modul-Lineage, nicht die Release-Version — die
> steht im Badge oben und im [CHANGELOG](CHANGELOG.md).

## Features

### Vier Visualisierungs-Modi

- **Technisch** — Force-Directed Graph mit Cytoscape.js. Knoten zeigen CPU/Memory/Ping/Traffic als Pie-Charts, Severity als Ring-Farbe.
- **Management** — Hosts gruppiert nach Device-Type (Firewall/Switch/Server/etc.) als Wallboard-Kacheln.
- **Tabelle** — Nagios/Icinga-Style Hostliste mit zwei Modi:
  - **Hosts** — Status, Type, IP, CPU, Memory, Ping, Traffic, Probleme pro Host
  - **Items** — Pivot-Tabelle: Hosts × Items (z.B. alle Disks der Hostgruppe)
- **Geo** — Leaflet-Karte mit GPS-Koordinaten aus dem Host-Inventory

### Layout-Optionen

- **Cluster-Modi** für Multi-Group-Auswahl: Auto / Spalten / Reihen / Aus
  - 2-3 Gruppen → vertikale Spalten
  - 4+ Gruppen → horizontale Reihen
- **Group-View** — alle Hosts einer Gruppe als ein Aggregat-Knoten
- **Force-Layout** mit cose, oder Hierarchie / Kreis / Concentric per Toggle
- **Convex-Hull-Lassos** um Hostgroups (gestrichelte Linie + Label)

### Datenfluss

- **Live-Refresh** alle 30s (toggelbar)
- **History-Mode** mit Slider — Trigger-Status zur ausgewählten Zeit (1h/24h/7d)
- **Item-Pivot** — beliebiges Item-Key-Pattern (z.B. `vfs.fs.size[*,pused]`) als Spalten
- **Manuelle Links** zwischen Hosts (Star-Mode)
- **Notizen + Pins** pro Host (lokal, im localStorage)

### Custom-Tags am Host

- `nt:icon=<typ>` — Device-Type überschreiben (firewall/router/switch/wireless/server/storage/...)
- `nt:label=<text>` — alternativer Anzeigename
- `nt:note=<text>` — Notiz-Sticker am Knoten
- `nt:link=<label>|<url>` — Custom-Link im Kontextmenü (mehrfach möglich)
- `nt:show=<key>` — zusätzlicher Item-Wert im Tooltip

### Detail-Panel

Klick auf Knoten/Zeile → rechte Seitenleiste mit:
- Severity, CPU, Memory, Ping, Traffic
- Geräte-Typ + Custom-Indikator
- Interface (Agent/SNMP/IPMI/JMX) + Proxy-Info
- Action-Buttons: Latest Data, Probleme, Graphs, Bearbeiten

### UI-Polish

- Dark-Mode-Toggle
- Fullscreen
- Zoom-In/Out + Fit
- Mini-Map unten rechts
- Severity-Filter-Pills (Disaster/High/Avg/Warn/Info/Normal togglebar)
- Suchfeld (Host/IP/Type/Interface/Proxy)
- Hide/Show Labels
- Layout-Presets (Save/Load/Delete)
- Auto-Refresh-Toggle

## Installation

```bash
cd /usr/share/zabbix/ui/modules
sudo unzip ~/Downloads/network_topology_v6_v4_X_Y.zip
sudo chown -R root:root network_topology_v6
sudo systemctl reload php8.3-fpm
```

In Zabbix-UI: Administration → General → Modules → Scan directory → "Network Topology for Zabbix" aktivieren.

Aufruf via Monitoring → Network Topology for Zabbix.

## Dashboard-Widget (optional)

Im Verzeichnis [`widget/`](widget/) liegt ein **separates Zabbix-Modul** vom Typ `widget` das die Daten dieses Hauptmoduls in einer Dashboard-Kachel rendert. Reduzierte Sicht (Tech + Mgmt), gleiche Offline/Stale-Detection, konfigurierbar pro Widget-Instanz (Hostgroups, Default-View, LLDP, Hide-Offline).

**Voraussetzung:** Hauptmodul muss installiert + enabled sein (das Widget ruft dessen `network.topology.v6.data`-Action).

```bash
cd widget
zip -r /tmp/widget.zip .
scp /tmp/widget.zip <server>:/tmp/
ssh <server>
cd /usr/share/zabbix/ui/modules
sudo mkdir network_topology_v6_widget
sudo unzip /tmp/widget.zip -d network_topology_v6_widget
sudo chown -R root:root network_topology_v6_widget
sudo systemctl reload php8.3-fpm
```

Dann Scan directory → "Network Topology for Zabbix — Widget" enablen → im Dashboard-Editor verfügbar.

## Architektur

```
network_topology_v6/
├── manifest.json              Modul-Manifest mit 14 registrierten Actions
├── Module.php                 Menü-Eintrag-Registration
├── views/
│   └── network.topology.view.php   HTML-Container + JS-Loader
├── actions/
│   ├── NetworkTopologyView.php     Haupt-Action, rendert die Seite
│   ├── NetworkTopologyData.php     JSON: nodes + edges + traffic + LLDP
│   ├── NetworkTopologyHistory.php  JSON: Trigger-Events für ein Zeitfenster
│   ├── NetworkTopologyItems.php    JSON: Items-Pivot (Wildcard-Pattern)
│   └── NetworkTopologySpark.php    JSON: CPU/Ping-History für Tooltip
└── assets/
    ├── css/network-topology.css
    └── js/
        ├── network-topology.js     Main: switchTab + Init + Refresh-Loop
        └── modules/                44 ESM-Module (Auswahl s.u.)
```

### Frontend-Module

| Datei | Aufgabe |
|---|---|
| `aggregation.js` | Group-View: Hostgroups als Aggregat-Knoten |
| `build-elements.js` | Cytoscape Node/Edge-Builder |
| `context-menu.js` | Rechtsklick-Menü auf Knoten |
| `detail-panel.js` | Rechte Seitenleiste mit Host-Details |
| `export.js` | PNG/PDF/HTML + Audit-Report-Export |
| `geo-providers.js` | Tile-Server-Definitionen für Leaflet |
| `group-cluster-layout.js` | Adaptiv: Spalten/Reihen-Layout pro Hostgroup |
| `group-hulls.js` | Convex-Hull-Lassos um Gruppen |
| `highlight.js` | Hover-Highlighting + Verbindungs-Edges |
| `history-mode.js` | Toggle + Slider für Zeit-basierte Trigger-Sicht |
| `icons.js` | SVG-Icons für 19 Device-Typen |
| `items-pivot.js` | Items-Pivot-Tabelle mit Preset-Patterns |
| `layouts.js` | Layout-Konfigurationen (cose, breadthfirst, etc.) |
| `legend.js` | Severity-Farb-Legende |
| `manual-links.js` | Star-Mode für manuelle Edges |
| `minimap.js` | Mini-Map unten rechts |
| `presets-ui.js` | Save/Load/Delete von Visual-States |
| `render-geo.js` | Geo-Tab (Leaflet) |
| `render-mgmt.js` | Management-Tab (Kachel-Layout) |
| `render-table.js` | Tabellen-Tab mit Hosts/Items-Modi |
| `render-tech.js` | Technisch-Tab (Hauptmodul, Cytoscape) |
| `render-tech-style.js` | Cytoscape-Stylesheet-Builder |
| `severity.js` | Severity-Farben + primaryGroup-Heuristik |
| `sev-filter.js` | Severity-Filter-Pills |
| `storage.js` | localStorage-Wrapper, User-scoped |
| `tabs.js` | Tab-Bar + Switching |
| `toolbar.js` | Top-Toolbar mit allen Buttons |
| `tooltip.js` | Hover-Tooltip auf Knoten |
| `traffic.js` | Edge-Animation + Traffic-Heatmap |
| `utils.js` | esc(), fmt() Helpers |

## Sicherheit

- **CSRF**: Actions setzen `disableCsrfValidation()` (das Frontend hat keinen Zabbix-Form-Token) und prüfen stattdessen `requireAjax()` (Header `X-Requested-With`) als CSRF-Last-Schutz — same-origin-Sessions können den Header setzen, cross-origin nicht (CORS-Preflight). Die einzige schreibende Action (`maintenance`, One-Time-Wartung aus der Karte) ist zusätzlich auf `USER_TYPE_ZABBIX_ADMIN` + Host-Schreibrecht gegated.
- **Permissions**: alle Actions prüfen `USER_TYPE_ZABBIX_USER`. Permission-Filter auf Hostgroups via `API::HostGroup()->get()` statt Frontend-trust.
- **XSS / Escaping-Konvention** (verbindlich): Jeder Wert aus Zabbix oder dem Netz — Host-/Gruppen-/Proxy-/Trigger-/Item-Name, Item-**Werte** (String-Items!), Notizen, IP und v. a. **LLDP/CDP-Nachbarnamen** (kommen per SNMP von _entfernten_ Geräten, ein Rogue-Device kann `<script>` announcen) — muss vor dem Einfügen in HTML durch `esc()` (`utils.js`, escapet `& < > " '`) laufen **oder** über `el.textContent` gesetzt werden. Fallstricke: `t()` (i18n) escaped **nicht** (roher Platzhalter-Ersatz) → Werte an `t()` müssen selbst escaped/numerisch sein oder das Ergebnis in `textContent`/`esc()` landen; `toast()` nutzt `textContent` (sicher); Cytoscape-Node-Labels sind Canvas-Text (kein HTML). Der gesamte `innerHTML`-Bestand ist auditiert (0 Lücken). Tripwire fürs Review/CI: [`tools/check-xss.sh`](tools/check-xss.sh) (mit `--strict` Exit 1 bei Verdacht).
- **SQL-Injection**: `(int)`-Cast oder `dbConditionInt()` bei DB-Zugriffen.
- **Item-Pattern**: Min 3 Non-Wildcard-Zeichen, max 5000 matching Items.
- **History**: max 50000 Events, max 7 Tage Range.
- **Spark**: max 50 hostids pro Call.
- **nt:link URL**: max 2048 Zeichen, nur http/https, kein CRLF.
- **nt:link Label**: max 200 Zeichen, kein Control-Char.
- **Race-Conditions**: Sequence-Counter bei async fetches (History/Items).

## Browser-Kompatibilität

- **Modern Browsers**: Chrome, Firefox, Safari, Edge (alle aktuelle Versionen)
- **ES6 Modules** (kein IE11)
- **fetch API**, **CSS inset**, **Surrogate-Paare** für Emoji
- **Mobile**: Touch + Long-Press für Kontextmenü (taphold-Duration konfigurierbar)

## Bekannte Einschränkungen

- Im History-Mode wird nur Severity zurückgespielt (CPU/Memory/Traffic bleiben Live)
- Items-Pivot zeigt nur numerische Items (FLOAT/UINT64)
- Max 7 Tage History-Range
- Geo-Tab braucht Hosts mit `inventory.location_lat` + `location_lon`
- LLDP-Edges nur wenn Items mit `lldp.rem.sysname[*]` existieren
- Zabbix 7.0+ für Proxy-Group-Info (in 6.x leer)

## Lizenz

**AGPL-3.0-or-later** — © 2026 PlaNet Fox / Alexander Fox. Volltext: [LICENSE](LICENSE).

Dieses Modul ist ein abgeleitetes Werk des Zabbix-Frontends — es leitet von
Zabbix-Klassen (`CController` u. a.) ab und läuft im selben Prozess. Zabbix 7
steht unter der AGPL-3.0; das kombinierte Werk unterliegt daher ebenfalls der
AGPL-3.0. Kurz: nutzen, weitergeben und ändern erlaubt — wer es (auch als
Netzwerk-Dienst) bereitstellt, muss den Quellcode inkl. eigener Änderungen unter
AGPL-3.0 verfügbar machen.

## Autor

PlaNet Fox / Alexander Fox <fox@planetfox.biz>
