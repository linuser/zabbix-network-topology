# Network Topology for Zabbix

Zabbix 7.0 LTS / 7.4 Frontend-Modul für interaktive Netzwerk-Topologie-Visualisierungen mit Cytoscape.js und Leaflet.
*Zabbix 7.0 LTS / 7.4 frontend module for interactive network topology visualisation, built on Cytoscape.js and Leaflet.*

![Status](https://img.shields.io/badge/zabbix-7.0_LTS_%2B_7.4-red)
![Version](https://img.shields.io/badge/version-5.0.0-blue)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue)

**[🌐 zabfox.de](https://zabfox.de)** · **[💾 Repository](https://github.com/linuser/zabbix-network-topology)** · **[📋 Changelog](CHANGELOG.md)** · **[📦 Installation](INSTALL.md)** · **[🤝 Contributing](CONTRIBUTING.md)**

**🇩🇪 [Deutsch](#-deutsch) · 🇬🇧 [English](#-english)**

> Technische Modul-ID / technical module id: `network_topology` — das Installationsverzeichnis **muss** genau so heißen. *The installation directory must carry exactly this name.*
>
> **Umstieg von 4.x:** In 5.0 ist der `_v6`-Suffix entfallen; das alte Verzeichnis `network_topology_v6` muss weg, und die Dashboard-Kacheln sind einmalig neu einzufügen — siehe [CHANGELOG](CHANGELOG.md) und [INSTALL.md](INSTALL.md). *Upgrading from 4.x: the `_v6` suffix is gone — remove the old directory and re-add the dashboard tiles once.*

---

## Screenshots

**Technische Topologie** — Force-Directed Graph mit Severity-Ringen, CPU/Memory/Ping/Traffic als Pie-Charts und Per-Link-Weathermap.
*Technical topology — force-directed graph with severity rings, CPU/memory/ping/traffic pie charts and per-link weathermap.*

![Technische Topologie / technical topology](screenshots/01-technical-graph.png)

**What-if-Ausfallsimulation** — Rechtsklick auf einen Host → „Simulate failure": das Modul markiert, welche Hosts dadurch ihre Verbindung zum Netz-Uplink verlieren.
*What-if failure simulation — right-click a host → "Simulate failure": the module marks every host that loses its path to the network uplink.*

![What-if-Simulation / what-if simulation](screenshots/02-whatif-simulation.gif)

**Item-Pivot mit Heatmap** — beliebiges Item-Key-Pattern (z. B. `vfs.fs.size[*,pused]`) als Spalten über alle Hosts, farbcodiert, mit Perzentilen (P50/P95/P99) und CSV-Export.
*Item pivot with heatmap — any item key pattern as columns across all hosts, colour-coded, with percentiles and CSV export.*

![Item-Pivot / item pivot](screenshots/07-table-items.png)

<table>
<tr>
<td width="50%"><img src="screenshots/03-management.png" alt="Management"><br><sub><b>Management</b> — Hosts nach Gerätetyp gruppiert, mit Problem-Badges und CPU/RAM je Kachel.<br><i>Hosts grouped by device type, with problem badges and CPU/RAM per tile.</i></sub></td>
<td width="50%"><img src="screenshots/06-health.png" alt="Health"><br><sub><b>Health</b> — Health-Score pro Hostgruppe mit 14-Tage-Verlauf.<br><i>Health score per host group with a 14-day trend.</i></sub></td>
</tr>
<tr>
<td width="50%"><img src="screenshots/04-table.png" alt="Tabelle / table"><br><sub><b>Tabelle / Table</b> — Nagios-Style Hostliste mit Status, Typ, IP, CPU/Memory/Ping, Traffic, Problemen.<br><i>Nagios-style host list with status, type, IP, metrics and open problems.</i></sub></td>
<td width="50%"><img src="screenshots/05-geo.jpg" alt="Geo"><br><sub><b>Geo</b> — Leaflet-Karte mit Host-Standorten aus dem Host-Inventory.<br><i>Leaflet map with host locations from the host inventory.</i></sub></td>
</tr>
</table>

---

## 🇩🇪 Deutsch

### Was ist das?

**Network Topology for Zabbix** ist ein Frontend-Modul für **Zabbix 7.0 LTS und 7.4**, das Hosts, Hostgruppen, Probleme, Traffic, Health-Status und Geodaten als **interaktive Netzwerk-Topologie** visualisiert — statt Hosts nur in Listen zu sehen, zeigt es, _wie_ sie zusammenhängen (via LLDP/CDP entdeckt), wo es klemmt und was daraus folgt.

Highlights: Live-Graph mit Severity-Ringen · **Port-zu-Port-Weathermap** (gemessene Link-Auslastung) · What-if-Ausfallsimulation & Root-Cause · Kapazitäts-Forecast · Wartung direkt aus der Karte · Health-Score pro Hostgruppe · Geo-Karte · Wallboard-Modus · DE/EN.

### Features

**Vier Visualisierungs-Modi**

- **Technisch** — Force-Directed Graph mit Cytoscape.js. Knoten zeigen CPU/Memory/Ping/Traffic als Pie-Charts, Severity als Ring-Farbe.
- **Management** — Hosts gruppiert nach Device-Type (Firewall/Switch/Server/etc.) als Wallboard-Kacheln.
- **Tabelle** — Nagios/Icinga-Style Hostliste mit zwei Modi: **Hosts** (Status, Type, IP, CPU, Memory, Ping, Traffic, Probleme) und **Items** (Pivot: Hosts × Items, z. B. alle Disks der Hostgruppe).
- **Geo** — Leaflet-Karte mit GPS-Koordinaten aus dem Host-Inventory.

> **Items-Pivot — Voraussetzung (Templates):** Die eingebauten Presets suchen nach den Item-Keys der Standard-Linux-Templates. Ist keines davon zugewiesen, bleibt die Pivot leer („Keine matching Items gefunden") — der Mechanismus ist ok, es fehlen nur die passenden Items.
>
> | Preset | Item-Keys | Liefert das Template |
> |---|---|---|
> | Disks, Block-Device-IO | `vfs.fs.size[*,pused]`, `vfs.dev.util[*]`, `vfs.dev.*.rate[*]` | **Linux by Zabbix agent** |
> | CPU, Memory | `system.cpu.util`, `vm.memory.size[*]` | dasselbe Template |
> | Netz | `net.if.in[*]`, `net.if.out[*]` | **Linux by Zabbix agent** |
> | Ping | `icmpping*` | Template **ICMP Ping** |
>
> **SNMP-Switches** (`ifHCInOctets[…]`) und **Windows** liefern *andere* Keys — dafür ein **Custom-Pattern** eingeben; das Dropdown zeigt unter „Discovered" die real vorhandenen Keys.

**Layout**

- **Cluster-Modi** für Multi-Group-Auswahl: Auto / Spalten / Reihen / Aus
- **Group-View** — alle Hosts einer Gruppe als ein Aggregat-Knoten
- **Force-Layout** (cose), Hierarchie, Kreis oder Concentric per Toggle
- **Convex-Hull-Lassos** um Hostgroups

**Datenfluss**

- **Live-Refresh** alle 30 s (abschaltbar)
- **History-Mode** mit Slider — Trigger-Status zur ausgewählten Zeit (1 h/24 h/7 d)
- **Item-Pivot** — beliebiges Item-Key-Pattern als Spalten
- **Manuelle Links** zwischen Hosts und **Kartenanordnung** — serverseitig, in zwei Ebenen: ein Super-Admin pflegt die für alle sichtbare Karte, jeder andere weicht persönlich davon ab. Notizen und Pins liegen weiterhin im `localStorage`
- **Port-zu-Port-Kanten** — auf LLDP/SNMP-Switches trägt jede Kante lokalen **und** Remote-Port; die Weathermap färbt nach *gemessener* Per-Interface-Auslastung statt Node-Schätzung ([LLDP-SETUP.md](LLDP-SETUP.md#port-zu-port--per-link-weathermap))

**Custom-Tags am Host**

- `nt:icon=<typ>` — Device-Type überschreiben (firewall/router/switch/server/storage/…)
- `nt:label=<text>` — alternativer Anzeigename
- `nt:note=<text>` — Notiz-Sticker am Knoten
- `nt:link=<label>|<url>` — Custom-Link im Kontextmenü (mehrfach möglich)
- `nt:show=<key>` — zusätzlicher Item-Wert im Tooltip
- `nt:parent=<hostname>` — Träger-Host deklarieren (VM→Hypervisor, Container→Node). Zeichnet eine gerichtete **hosts**-Kante und gilt der What-if-Simulation als **harte Abhängigkeit**: fällt der Parent aus, fällt der Child — unabhängig vom Netzpfad.

**Weitere UI**

Detail-Panel je Host (Severity, Metriken, Interface, Proxy, Action-Buttons) · Dark-Mode · Fullscreen · Zoom + Fit · Mini-Map · Severity-Filter-Pills · Suchfeld mit Query-Sprache · Layout-Presets.

### Installation

📦 **Ausführliche, zweisprachige Anleitung: [INSTALL.md](INSTALL.md)** — Voraussetzungen, RHEL/SELinux, Widgets, Aus-Source-Bauen, Troubleshooting.

Kurzfassung (das Verzeichnis **muss** `network_topology` heißen):

```bash
cd /usr/share/zabbix/ui/modules
sudo unzip ~/Downloads/network_topology.zip
sudo chown -R root:root network_topology
sudo systemctl reload php8.2-fpm      # Dienstname je nach Distro/PHP-Version
```

Dann in der Zabbix-UI: **Administration → General → Modules → Scan directory** → „Network Topology for Zabbix" aktivieren. Aufruf über **Monitoring → Network Topology for Zabbix**.

### Kanten / Topologie (LLDP)

Die **Verbindungen (Kanten)** entstehen aus den LLDP/CDP-Nachbar-Tabellen der Geräte, die per SNMP an Zabbix geliefert werden. **Knoten da, aber keine Kanten?** → 📡 **[LLDP-SETUP.md](LLDP-SETUP.md)**: was auf Switches/Clients/Zabbix zu tun ist, eine **Vendor-Matrix** (TP-Link / Ubiquiti / HP-Aruba / Cisco / MikroTik) und ein Test-Kommando zum Gegenchecken.

### Dashboard-Widgets (optional)

Fünf separate Widget-Module rendern die Daten des Hauptmoduls in Dashboard-Kacheln. Im Widget-Menü heißen sie **NT …**:

| Verzeichnis | Widget | Inhalt |
|---|---|---|
| [`widget/`](widget/) | **NT Topology** | Topologie-Graph, reduzierte Tech-/Mgmt-Sicht |
| [`widget_health/`](widget_health/) | **NT Health Score** | Health-Score pro Hostgruppe |
| [`widget_table/`](widget_table/) | **NT Table** | Tabelle (Status/CPU/Mem/Ping/Traffic/Probleme) |
| [`widget_kpi/`](widget_kpi/) | **NT KPI** | Kennzahlen als Ring (Severity-Verteilung mit Host-Zahl in der Mitte) oder als Raster |
| [`widget_items/`](widget_items/) | **NT Items** | ein Item-Muster über alle Hosts der gewählten Gruppen gepivotet |

Alle nutzen dieselbe `network.topology.data`-Action (kein zweites Backend) und teilen sich deren Antwort: liegen mehrere Kacheln auf einem Dashboard, wird die Action **einmal** abgefragt, nicht je Kachel. **Voraussetzung:** Hauptmodul installiert + aktiviert.

> **Die Widgets funktionieren nicht eigenständig** — und zwar aus zwei Gründen: Die Daten-Action `network.topology.data` registriert das **Hauptmodul**, und das Topologie-Widget lädt zusätzlich Cytoscape.js aus dessen Verzeichnis (`modules/network_topology/assets/js/`), damit die ~360 KB große Bibliothek nur einmal im Paket liegt. Fehlt oder deaktivierst du das Hauptmodul, zeigen die Kacheln eine Fehlermeldung („Hauptmodul nicht erreichbar" bzw. „Cytoscape.js not loaded"). Reihenfolge beim Installieren also: **erst Hauptmodul, dann Widgets.**

> **Zabbix-Version:** Die Widgets brauchen **Zabbix 7.4**. Auf **7.0 LTS** registrieren sie sich zwar, bleiben aber wegen der abweichenden Widget-JS-Basisklasse auf „Loading…" hängen. Das **Hauptmodul** läuft auf **7.0 LTS und 7.4**.

### Sicherheit

- **CSRF:** Lesende Actions prüfen `requireAjax()` (Header `X-Requested-With`) — same-origin-Sessions können ihn setzen, cross-origin nicht (CORS-Preflight). Die einzige schreibende Action (Wartungsfenster) prüft zusätzlich einen echten Zabbix-CSRF-Token und ist auf `USER_TYPE_ZABBIX_ADMIN` **plus** Host-Schreibrecht gegated.
- **Permissions:** Alle Actions prüfen den User-Typ; IDs vom Client werden gegen `API::…->get()` geschnitten statt ihnen zu vertrauen.
- **XSS / Escaping-Konvention** (verbindlich): Jeder Wert aus Zabbix oder dem Netz — Host-/Gruppen-/Proxy-/Item-Name, Item-**Werte**, Notizen, IP und v. a. **LLDP/CDP-Nachbarnamen** (kommen per SNMP von _fremden_ Geräten; ein Rogue-Device kann `<script>` announcen) — muss durch `esc()` laufen oder über `textContent` gesetzt werden. Zwei CI-Gates wachen darüber: [`tools/check-xss.sh`](tools/check-xss.sh) und ESLint `no-unsanitized` — beide decken auch die Widget-Module ab.
- **SQL-Injection:** `(int)`-Cast bzw. `dbConditionInt()`; genau eine Rohquery im gesamten Code.
- **Grenzen:** Item-Pattern min. 3 Nicht-Wildcard-Zeichen / max. 5000 Items · History max. 50 000 Events und 7 Tage · Spark max. 50 hostids · `nt:link`-URL max. 2048 Zeichen, nur http/https.

Sicherheitslücke gefunden? → [SECURITY.md](SECURITY.md) (bitte **nicht** als öffentliches Issue).

### Browser

Aktuelle Chrome, Firefox, Safari, Edge. ES6-Module (kein IE11), `fetch`, CSS `inset`. Mobil: Touch + Long-Press fürs Kontextmenü.

### Bekannte Einschränkungen

- Im History-Mode wird nur Severity zurückgespielt (CPU/Memory/Traffic bleiben live)
- Items-Pivot zeigt nur numerische Items (FLOAT/UINT64)
- Max. 7 Tage History-Range
- Geo-Tab braucht Hosts mit `inventory.location_lat` + `location_lon`
- LLDP-Kanten brauchen Nachbar-Items per SNMP → [LLDP-SETUP.md](LLDP-SETUP.md)
- Zabbix 7.0+ für Proxy-Group-Info (in 6.x leer)
- **Dashboard-Widgets nur Zabbix 7.4**; das Hauptmodul läuft auf 7.0 LTS + 7.4

### Feedback & Mitmachen

- **Bug gefunden?** → [Issue anlegen](https://github.com/linuser/zabbix-network-topology/issues). Bitte Zabbix-Version, PHP-Version und bei fehlenden Kanten den SNMP-Vendor angeben.
- **Patch beisteuern?** → [CONTRIBUTING.md](CONTRIBUTING.md) — dort stehen die drei Dinge, die die CI hart erzwingt.
- **Sicherheitslücke?** → [SECURITY.md](SECURITY.md), vertraulich per Mail.

---

## 🇬🇧 English

### What is this?

**Network Topology for Zabbix** is a frontend module for **Zabbix 7.0 LTS and 7.4** that visualises hosts, host groups, problems, traffic, health status and geo data as an **interactive network topology** — instead of seeing hosts as a flat list, you see _how_ they connect (discovered via LLDP/CDP), where it hurts, and what follows from it.

Highlights: live graph with severity rings · **port-to-port weathermap** (measured link utilisation) · what-if failure simulation & root cause · capacity forecast · maintenance straight from the map · health score per host group · geo map · wallboard mode · German/English UI.

### Features

**Four visualisation modes**

- **Technical** — force-directed graph (Cytoscape.js). Nodes show CPU/memory/ping/traffic as pie charts, severity as ring colour.
- **Management** — hosts grouped by device type (firewall/switch/server/…) as wallboard tiles.
- **Table** — Nagios/Icinga-style host list in two modes: **Hosts** (status, type, IP, CPU, memory, ping, traffic, problems) and **Items** (pivot: hosts × items, e.g. every disk in the group).
- **Geo** — Leaflet map using GPS coordinates from the host inventory.

> **Item pivot — prerequisite (templates):** the built-in presets look for the item keys of the standard Linux templates. With none of them linked, the pivot stays empty ("no matching items") — the mechanism is fine, the items are simply missing.
>
> | Preset | Item keys | Provided by |
> |---|---|---|
> | Disks, block device IO | `vfs.fs.size[*,pused]`, `vfs.dev.util[*]`, `vfs.dev.*.rate[*]` | **Linux by Zabbix agent** |
> | CPU, memory | `system.cpu.util`, `vm.memory.size[*]` | same template |
> | Network | `net.if.in[*]`, `net.if.out[*]` | **Linux by Zabbix agent** |
> | Ping | `icmpping*` | **ICMP Ping** template |
>
> **SNMP switches** (`ifHCInOctets[…]`) and **Windows** expose *different* keys — use a **custom pattern** there; the dropdown lists the keys actually present under "Discovered".

**Layout**

- **Cluster modes** for multi-group selections: auto / columns / rows / off
- **Group view** — every host of a group collapsed into one aggregate node
- **Force layout** (cose), hierarchy, circle or concentric via toggle
- **Convex-hull lassos** around host groups

**Data flow**

- **Live refresh** every 30 s (can be turned off)
- **History mode** with slider — trigger state at the selected time (1 h/24 h/7 d)
- **Item pivot** — any item key pattern as columns
- **Manual links** between hosts and the **map layout** — stored server-side in two layers: a Super admin curates the map everyone sees, anyone else deviates personally. Notes and pins still live in `localStorage`
- **Port-to-port edges** — on LLDP/SNMP switches each edge carries both the local **and** the remote port; the weathermap colours by *measured* per-interface utilisation instead of a node-level estimate ([LLDP-SETUP.md](LLDP-SETUP.md))

**Custom host tags**

- `nt:icon=<type>` — override the device type (firewall/router/switch/server/storage/…)
- `nt:label=<text>` — alternative display name
- `nt:note=<text>` — note sticker on the node
- `nt:link=<label>|<url>` — custom link in the context menu (repeatable)
- `nt:show=<key>` — extra item value in the tooltip
- `nt:parent=<hostname>` — declare a carrier host (VM→hypervisor, container→node). Draws a directed **hosts** edge, and the what-if simulation treats it as a **hard dependency**: if the parent dies, the child dies — regardless of the network path.

**More UI**

Per-host detail panel (severity, metrics, interface, proxy, action buttons) · dark mode · fullscreen · zoom + fit · mini-map · severity filter pills · search field with a small query language · layout presets.

### Installation

📦 **Full bilingual guide: [INSTALL.md](INSTALL.md)** — requirements, RHEL/SELinux, widgets, building from source, troubleshooting.

Short version (the directory **must** be named `network_topology`):

```bash
cd /usr/share/zabbix/ui/modules
sudo unzip ~/Downloads/network_topology.zip
sudo chown -R root:root network_topology
sudo systemctl reload php8.2-fpm      # Dienstname je nach Distro/PHP-Version
```

Then in the Zabbix UI: **Administration → General → Modules → Scan directory** → enable "Network Topology for Zabbix". Open it via **Monitoring → Network Topology for Zabbix**.

### Edges / topology (LLDP)

**Edges** come from the LLDP/CDP neighbour tables of your devices, delivered to Zabbix via SNMP. **Nodes but no edges?** → 📡 **[LLDP-SETUP.md](LLDP-SETUP.md)**: what to configure on switches/clients/Zabbix, a **vendor matrix** (TP-Link / Ubiquiti / HP-Aruba / Cisco / MikroTik) and a test command to verify.

### Dashboard widgets (optional)

Five separate widget modules render the main module's data as dashboard tiles. They appear as **NT …** in the widget menu:

| Directory | Widget | What it shows |
|---|---|---|
| [`widget/`](widget/) | **NT Topology** | topology graph, reduced tech/mgmt view |
| [`widget_health/`](widget_health/) | **NT Health Score** | health score per host group |
| [`widget_table/`](widget_table/) | **NT Table** | table (status/CPU/mem/ping/traffic/problems) |
| [`widget_kpi/`](widget_kpi/) | **NT KPI** | key figures as a ring (severity distribution with the host count in the middle) or as a grid |
| [`widget_items/`](widget_items/) | **NT Items** | one item pattern pivoted across all hosts of the selected groups |

All consume the same `network.topology.data` action (no second backend) and share its response: with several tiles on one dashboard the action is fetched **once**, not per tile. **Prerequisite:** the main module installed and enabled.

> **The widgets do not work standalone** — for two reasons: the data action `network.topology.data` is registered by the **main module**, and the topology widget additionally loads Cytoscape.js from its directory (`modules/network_topology/assets/js/`), so the ~360 KB library ships only once. Without the main module — or with it disabled — the tiles show an error ("main module unreachable" / "Cytoscape.js not loaded"). So install in this order: **main module first, widgets second.**

> **Zabbix version:** the widgets require **Zabbix 7.4**. On **7.0 LTS** they do register, but stay stuck on "Loading…" because the widget JS base class differs. The **main module** runs on **7.0 LTS and 7.4**.

### Security

- **CSRF:** read actions require `requireAjax()` (`X-Requested-With` header) — same-origin sessions can set it, cross-origin cannot (CORS preflight). The single writing action (maintenance windows) additionally verifies a real Zabbix CSRF token and is gated on `USER_TYPE_ZABBIX_ADMIN` **plus** host write permission.
- **Permissions:** every action checks the user type; client-supplied IDs are intersected against `API::…->get()` rather than trusted.
- **XSS / escaping convention** (binding): every value from Zabbix or from the network — host/group/proxy/item names, item **values**, notes, IPs and especially **LLDP/CDP neighbour names** (announced by _foreign_ devices via SNMP; a rogue device can announce `<script>`) — must pass through `esc()` or be set via `textContent`. Two CI gates enforce this: [`tools/check-xss.sh`](tools/check-xss.sh) and ESLint `no-unsanitized` — both cover the widget modules as well.
- **SQL injection:** `(int)` casts / `dbConditionInt()`; exactly one raw query in the whole codebase.
- **Limits:** item pattern min. 3 non-wildcard chars / max. 5000 items · history max. 50,000 events and 7 days · spark max. 50 host ids · `nt:link` URL max. 2048 chars, http/https only.

Found a vulnerability? → [SECURITY.md](SECURITY.md) (please **not** as a public issue).

### Browsers

Current Chrome, Firefox, Safari, Edge. ES6 modules (no IE11), `fetch`, CSS `inset`. Mobile: touch + long-press for the context menu.

### Known limitations

- History mode replays severity only (CPU/memory/traffic stay live)
- Item pivot shows numeric items only (FLOAT/UINT64)
- History range capped at 7 days
- Geo tab needs hosts with `inventory.location_lat` + `location_lon`
- LLDP edges need neighbour items via SNMP → [LLDP-SETUP.md](LLDP-SETUP.md)
- Zabbix 7.0+ for proxy group info (empty on 6.x)
- **Dashboard widgets are Zabbix 7.4 only**; the main module runs on 7.0 LTS + 7.4

### Feedback & contributing

- **Found a bug?** → [open an issue](https://github.com/linuser/zabbix-network-topology/issues). Please include your Zabbix version, PHP version, and for missing edges the SNMP vendor.
- **Want to send a patch?** → [CONTRIBUTING.md](CONTRIBUTING.md) — it lists the three things CI enforces strictly.
- **Security issue?** → [SECURITY.md](SECURITY.md), confidentially by mail.

---

## Architektur / Architecture

```
network_topology/
├── manifest.json              Modul-Manifest, 14 Actions / module manifest, 14 actions
├── Module.php                 Menü-Eintrag / menu registration
├── views/
│   └── network.topology.view.php   HTML container + JS loader
├── actions/                        14 actions (JSON via layout.json)
│   ├── NetworkTopologyView.php               renders the page (layout.htmlpage)
│   ├── NetworkTopologyData.php               nodes + edges + traffic + LLDP/CDP + health
│   ├── NetworkTopologyHistory.php            trigger events for a time window
│   ├── NetworkTopologyItems.php              item pivot (wildcard pattern)
│   ├── NetworkTopologyItemHistory.php        batch sparklines for the pivot
│   ├── NetworkTopologyItemCount.php          live autocomplete count
│   ├── NetworkTopologySpark.php              CPU/ping history for tooltips
│   ├── NetworkTopologyDiscoverPatterns.php   preset pattern suggestions
│   ├── NetworkTopologyCompliance.php         per-host compliance checks (admin)
│   ├── NetworkTopologyDiag.php               backend telemetry (super admin)
│   ├── NetworkTopologyCapacityForecast.php   link capacity forecast (trends)
│   ├── NetworkTopologyResourceForecast.php   CPU/memory forecast (trends)
│   ├── NetworkTopologyHealthHistory.php      health score history (trapper items)
│   └── NetworkTopologyMaintenance.php        one-time maintenance (WRITE, admin)
├── topology/                       HostMetadata · HostTagParser · LldpEdgeBuilder
│                                   MetricExtractor · NodeBuilder · ProblemLoader
└── assets/
    ├── css/network-topology.css
    └── js/
        ├── network-topology.js     main: tab switching, init, refresh loop
        └── modules/                ~47 ES modules
```

Key frontend modules: `build-elements.js` (Cytoscape node/edge builder) · `render-tech.js` / `render-mgmt.js` / `render-table.js` / `render-geo.js` (the four views) · `items-pivot.js` (pivot table) · `whatif.js` + `root-cause.js` (failure simulation) · `traffic.js` (weathermap) · `aggregation.js` (group view) · `query.js` (table query language) · `storage.js` (user-scoped localStorage) · `utils.js` (`esc()`, formatters) · `i18n.js` + `i18n/{de,en}.js`.

## Lizenz / License

**AGPL-3.0-or-later** — © 2026 PlaNet Fox / Alexander Fox. Volltext / full text: [LICENSE](LICENSE).

Dieses Modul ist ein abgeleitetes Werk des Zabbix-Frontends — es leitet von Zabbix-Klassen (`CController` u. a.) ab und läuft im selben Prozess. Zabbix 7 steht unter der AGPL-3.0; das kombinierte Werk unterliegt daher ebenfalls der AGPL-3.0. Kurz: nutzen, weitergeben und ändern erlaubt — wer es (auch als Netzwerk-Dienst) bereitstellt, muss den Quellcode inkl. eigener Änderungen unter AGPL-3.0 verfügbar machen.

*This module is a derivative work of the Zabbix frontend — it extends Zabbix classes (`CController` and others) and runs in the same process. Zabbix 7 is AGPL-3.0, so the combined work is AGPL-3.0 as well: use, share and modify freely — but anyone who provides it (including as a network service) must make the source, including their own changes, available under AGPL-3.0.*

Mitgelieferte Fremdkomponenten / bundled third-party components (Cytoscape.js — MIT, Leaflet 1.9.4 — BSD-2-Clause): [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).

## Autor / Author

PlaNet Fox / Alexander Fox — <mail@zabfox.de> · [zabfox.de](https://zabfox.de)
