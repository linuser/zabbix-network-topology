# Installation — Network Topology for Zabbix

**🇩🇪 [Deutsch](#-deutsch) · 🇬🇧 [English](#-english)**

Technische Modul-ID / technical module id: **`network_topology`** — das
Installationsverzeichnis **muss** genau so heißen / the install directory
**must** be named exactly like this.

---

## 🇩🇪 Deutsch

### Voraussetzungen

- **Zabbix 7.0 LTS oder 7.4+** (Frontend) — die Dashboard-Widgets (Abschnitt 3) brauchen **7.4**
- **PHP 8.x** mit php-fpm (bzw. der PHP-Handler deines Webservers)
- Schreibzugriff auf das Zabbix-UI-Verzeichnis `modules/` und die Möglichkeit, php-fpm neu zu laden
- Moderner Browser (ES2019 — Chrome/Firefox/Safari/Edge, aktuelle Versionen)
- **Keine Build-Tools nötig**: das fertige JS-Bundle (`assets/js/dist/nt-bundle.js`) liegt im Paket. Node/esbuild brauchst du nur, wenn du aus dem Quellcode neu bauen willst (siehe [Aus Source bauen](#5-optional-aus-source-bauen-entwickler)).
- **Für den Weathermap-Modus** (Edge-Farbe nach Auslastung): die Geräte müssen per **SNMP** mit einem Interface-Template überwacht werden, das `ifSpeed`/`ifHighSpeed` liefert. Der Zabbix-Agent liefert **keine** Link-Speed (siehe README → Weathermap).

### 1. Hauptmodul installieren

> Das Verzeichnis **muss** `network_topology` heißen (= die Modul-ID). Ein direkt heruntergeladenes Repo heißt evtl. `zabbix-network-topology-v2-main` o. ä. → **umbenennen**.

```bash
# In den Modules-Ordner deiner Zabbix-UI wechseln
# (typisch /usr/share/zabbix/ui/modules — bei anderen Setups
#  z. B. /var/www/html/zabbix/ui/modules)
cd /usr/share/zabbix/ui/modules

# Variante A — Release-ZIP entpacken (Download: github.com/linuser/zabbix-network-topology/releases):
sudo unzip /pfad/zu/network_topology.zip

# Variante B — aus dem Git-Repo:
sudo git clone https://github.com/linuser/zabbix-network-topology.git network_topology

# Rechte setzen (Owner wie der Rest deiner Zabbix-UI — meist root:root
# oder www-data:www-data)
sudo chown -R root:root network_topology

# php-fpm neu laden. ACHTUNG: Der Dienstname haengt von Distribution UND
# PHP-Version ab — erst nachsehen, dann neu laden:
systemctl list-units --type=service | grep -i fpm
sudo systemctl reload php8.2-fpm       # gefundenen Namen einsetzen!
```

> **Der Dienstname ist die haeufigste Stolperfalle.** `php8.2-fpm` (Debian 12) ·
> `php8.3-fpm` / `php8.4-fpm` (neuere PHP-Versionen) · `php-fpm` (RHEL/Rocky/Alma).
> Findet `grep -i fpm` gar nichts, laeuft PHP als Webserver-Modul — dann stattdessen
> `sudo systemctl reload apache2` bzw. `httpd`.
>
> [`deploy.sh`](deploy.sh) erkennt den Dienst **selbst** und nimmt dir das ab.

> **Kein Internet auf dem Zabbix-Server?** Der Normalfall bei Monitoring-Systemen —
> sie stehen oft bewusst ohne ausgehenden Zugang. Dann das ZIP **nicht dort** laden,
> sondern auf einem Arbeitsplatz und übertragen:
>
> ```bash
> # auf dem Arbeitsplatz
> scp network_topology*.zip <server>:/tmp/
>
> # auf dem Zabbix-Server
> cd /usr/share/zabbix/ui/modules
> sudo unzip -q /tmp/network_topology.zip && rm /tmp/network_topology*.zip
> ```
>
> Merke: Der Server antwortet auf `ping`, aber `curl` scheitert nach wenigen
> Millisekunden? Dann blockiert eine Firewall ausgehend TCP/443 (ICMP ist oft
> erlaubt) — kein DNS- oder IPv6-Problem. Gegenprobe:
> `curl -4 -sS -o /dev/null -w '%{http_code}\n' --max-time 8 https://github.com`
>
> Am bequemsten ist in dem Fall [`deploy.sh`](deploy.sh): es baut lokal, überträgt
> per SSH und braucht auf dem Server **keinerlei** Internet-Zugang.

> **RHEL / RedHat / Rocky / Alma** — drei Extra-Punkte:
> - **SELinux** (Hauptursache für „Modul erscheint nicht"): nach dem Ablegen den httpd-Lesekontext setzen, sonst kann php-fpm die Dateien nicht lesen → `sudo restorecon -Rv /usr/share/zabbix/ui/modules/network_topology`. **Wer `nt-install.sh` oder `deploy.sh` nutzt, braucht das nicht** — beide rufen `restorecon` seit 5.0 selbst auf. Nötig ist es nur beim Entpacken von Hand.
> - **Owner/Service**: Web-User ist `apache` (nicht www-data), der Dienst heißt `php-fpm` → `sudo chown -R apache:apache network_topology` und `sudo systemctl reload php-fpm`
> - **APCu** (optional, empfohlen für Cache + Rate-Limit): `sudo dnf install php-pecl-apcu` und für die **FPM**-SAPI aktivieren. Ohne APCu läuft das Modul trotzdem — nur ohne Cache/Drosselung (fail-open).

### 2. Modul aktivieren

1. **Administration → General → Modules → Scan directory**
2. In der Liste **„Network Topology for Zabbix"** auf **Enabled** stellen.
3. Aufruf über **Monitoring → Network Topology for Zabbix**.

### 3. Optional: Dashboard-Widgets

Fünf separate Widget-Module (alle nutzen die Daten des Hauptmoduls):

| ZIP | Im Dashboard-Menü | Zeigt |
|---|---|---|
| `network_topology_widget.zip` | **NT Topology** | die Karte als Kachel |
| `network_topology_health_widget.zip` | **NT Health Score** | Score je Hostgruppe |
| `network_topology_table_widget.zip` | **NT Table** | Nagios-Style Hostliste |
| `network_topology_kpi_widget.zip` | **NT KPI** | Kennzahlen als Ring oder Kacheln |
| `network_topology_items_widget.zip` | **NT Items** | ein Item-Muster über alle Hosts |

```bash
cd /usr/share/zabbix/ui/modules
for w in widget health_widget table_widget kpi_widget items_widget; do
    sudo unzip "/pfad/network_topology_$w.zip" -d "network_topology_$w"
done
sudo chown -R root:root network_topology_*_widget network_topology_widget
sudo systemctl reload php8.2-fpm      # Dienstname wie oben ermittelt
```
Dann **Scan directory** → die gewünschten Module auf *Enabled* → im Dashboard-Editor verfügbar. Die ZIPs enthalten ihre Dateien **direkt**, ohne Oberordner — deshalb ist `-d <ziel>` zwingend.
**Voraussetzung:** Das Hauptmodul muss installiert + aktiviert sein — und **Zabbix 7.4** (die Widgets laufen nicht auf 7.0 LTS; das Hauptmodul schon).

> **Warum nicht eigenständig?** Die Daten-Action `network.topology.data` gehört dem Hauptmodul, und das Topologie-Widget lädt Cytoscape.js aus `modules/network_topology/assets/js/` — die Bibliothek liegt bewusst nur einmal im Paket. Ohne (oder mit deaktiviertem) Hauptmodul zeigen die Kacheln eine Fehlermeldung. Deshalb **erst das Hauptmodul installieren und aktivieren, dann die Widgets.**

### 4. Optional: Topologie-Events + Health-Score-Historie

Für echte Zabbix-Events bei Topologie-Änderungen und einen Health-Score-Verlauf:

> **Die drei Dateien für diesen Schritt sind absichtlich nicht im Modul-ZIP.**
> Das Modulverzeichnis liegt unter dem Web-Root und ist öffentlich abrufbar —
> dort gehört nur hinein, was zur Laufzeit gebraucht wird. Templates und das
> Sender-Skript holst du direkt aus dem Repository:
>
> ```bash
> curl -fLO https://raw.githubusercontent.com/linuser/zabbix-network-topology/main/templates/nt_topology_change_template.yaml
> curl -fLO https://raw.githubusercontent.com/linuser/zabbix-network-topology/main/templates/nt_health_score_template.yaml
> curl -fLO https://raw.githubusercontent.com/linuser/zabbix-network-topology/main/tools/topo-change-sender.sh
> ```

1. Templates importieren (Data collection → Templates → Import):
   - `nt_topology_change_template.yaml`
   - `nt_health_score_template.yaml`
   → an einen Trägerhost linken (z. B. „Zabbix server").
2. **Dedizierten Monitoring-User** anlegen (USER-Rolle, Lesezugriff auf die Hostgruppen). Wichtig: die APCu-Baseline ist user-scoped — ein geteilter User würde sich die Baseline mit UI-Sessions verrollen.
3. `topo-change-sender.sh` auf den Zabbix-Server, als **Cron** (alle 2 min), konfiguriert per ENV (`ZBX_URL`, `ZBX_USER`, `ZBX_PASS`, `GROUPIDS`, `SENDER_HOST`). Das Skript pusht Topo-Änderungen **und** den Health-Score per `zabbix_sender`.

### 5. Optional: Aus Source bauen (Entwickler)

Nur nötig, wenn du die JS-Module änderst:

```bash
npm install          # esbuild (devDependency)
npm run build        # -> assets/js/dist/nt-bundle.js
```
`deploy.sh` baut das Bundle vor dem Ausrollen ohnehin frisch aus dem Source.

### Update

Verzeichnis `network_topology` durch die neue Version ersetzen, `chown`, php-fpm reload, **Scan directory**. Kartenanordnung und manuelle Links liegen serverseitig und bleiben ohnehin erhalten; Pins, Notizen und Presets im Browser-`localStorage`. Nach einem Update mit neuen Actions ist „Scan directory" **Pflicht**.

#### Umstieg von 4.x auf 5.0

In 5.0 ist der `_v6`-Suffix aus allen Bezeichnern entfallen — das Verzeichnis heißt jetzt `network_topology` statt `network_topology_v6`. **Das alte Verzeichnis muss weg**, sonst registriert Zabbix beide Module und der Menüeintrag erscheint doppelt:

Am sichersten mit dem Uninstaller — er kennt die alten Namen, verschiebt statt zu löschen und lässt fremde Module in Ruhe:

```bash
./nt-uninstall.sh --dry-run     # erst ansehen
./nt-uninstall.sh
```

Von Hand geht es auch, dann aber **vorher nachsehen, was wirklich dort liegt**:

```bash
cd /usr/share/zabbix/ui/modules
grep -l '"id".*network_topology' */manifest.json     # zeigt ALLE Verzeichnisse des Moduls
sudo rm -rf network_topology_v6 network_topology_v6_widget \
            network_topology_v6_health_widget network_topology_v6_table_widget
```

Der `grep` ist nicht überflüssig: Bei einer Handinstallation wird gern das **Quellverzeichnis** als Name genommen — `widget_health/` statt `network_topology_v6_health_widget/`. Beide deklarieren dann dieselbe Modul-ID, und Zabbix registriert **keines** von beiden. Auf einer realen Instanz genau so vorgefunden; von vier Modulen standen nur zwei in der Datenbank, ohne jede Fehlermeldung.

Danach normal installieren (Schritt 1–3) und **Scan directory** ausführen; die alten Einträge verschwinden dabei von selbst.

Zwei Dinge musst du danach von Hand nachziehen:

- **Dashboard-Kacheln.** Die Widget-IDs sind Teil des Dashboards; Zabbix kennt den alten Typ nicht mehr und blendet die Kacheln aus. Einmalig neu hinzufügen und konfigurieren — das Dashboard selbst bleibt intakt.

  Wer das vermeiden will, findet im [CHANGELOG](CHANGELOG.md) unter „Optional: Dashboards per SQL erhalten" ein `UPDATE`-Skript, das die Bezeichner direkt in der Datenbank umschreibt. **Auf diesem Weg entfallen auch Schritt 2 und 3**: die Module bleiben aktiviert, „Scan directory" ist nicht nötig, und die Kacheln bleiben stehen. Nachgefahren auf zwei unabhängigen Installationen, davon eine auf PostgreSQL.
- **Lesezeichen.** Die Ansicht liegt jetzt unter `zabbix.php?action=network.topology.view`.

Alles Nutzerseitige bleibt erhalten. Kartenanordnung und manuelle Links liegen serverseitig — an `module.config` und am Benutzerprofil, nicht am Modulnamen. Pins, Notizen, Filter-Presets und Toolbar-Einstellungen liegen im `localStorage`, dessen Schlüssel nie an den Modulnamen gebunden waren. Host-Tags (`nt:parent`) sind ohnehin unberührt.

### Deinstallation

```bash
./nt-uninstall.sh --dry-run     # zeigt nur, was passieren würde
./nt-uninstall.sh               # entfernt Hauptmodul + alle Widgets
```

Das Skript **verschiebt** die Verzeichnisse nach `/var/backups/nt-uninstall-<datum>/`, statt sie zu löschen, und nennt am Ende den Befehl zum Zurückholen. Es fasst nur Verzeichnisse an, deren `manifest.json` eine `network_topology`-ID trägt — ein fremdes Modul, das zufällig `widget/` heißt, bleibt liegen. Alte `_v6`-Verzeichnisse aus 4.x nimmt es mit.

Danach in der UI **Administration → General → Modules → Scan directory**. Erst dann verschwinden die Modul-Einträge aus der Datenbank — und mit ihnen die **geteilten** Links und Positionen, die als `module.config` an der Modul-Zeile hängen.

Von Hand geht es genauso: Modul in der UI auf **Disabled**, Verzeichnisse löschen, php-fpm reloaden, *Scan directory*.

**Was liegen bleibt.** Die **persönliche** Ebene hängt nicht an der Modul-Zeile, sondern im Benutzerprofil, und überlebt jede Deinstallation:

```sql
DELETE FROM profiles WHERE idx = 'web.network_topology.manual_links';
DELETE FROM profiles WHERE idx = 'web.network_topology.positions';
```

`./nt-uninstall.sh --purge` erledigt das nach Rückfrage — es zeigt vorher, wie viele Zeilen wie viele Benutzer betrifft.

**Was das Skript bewusst nicht anfasst:** die Host-Tags (`nt:parent`, `nt:icon`, …), die importierten Templates, den Cron für `topo-change-sender.sh` und den dafür angelegten Monitoring-User. Das sind selbst angelegte Daten — `nt:parent` beschreibt deine Infrastruktur, nicht das Modul. Das Skript zählt sie auf und gibt das SQL aus, ausführen musst du es selbst. Pins, Notizen und Filter-Presets liegen im `localStorage` der jeweiligen Browser und lassen sich serverseitig ohnehin nicht entfernen.

### Troubleshooting

| Symptom | Ursache / Lösung |
|---|---|
| `Unit php8.3-fpm.service not found` | Dein php-fpm heißt anders. `systemctl list-units --type=service \| grep -i fpm` zeigt den echten Namen (Debian 12 → `php8.2-fpm`, RHEL → `php-fpm`). |
| `curl: (7) Failed to connect … after 1 ms` | Firewall blockt ausgehend TCP/443. ZIP auf einem Arbeitsplatz laden und per `scp` übertragen — oder `deploy.sh` nutzen (braucht kein Server-Internet). |
| Modul erscheint nicht in der Liste | Verzeichnis heißt nicht exakt `network_topology`, oder falsche Rechte/Owner. Auf **RHEL/Rocky/Alma** zusätzlich `sudo restorecon -Rv …` (SELinux). |
| „Loading topology…" bleibt / leerer Bereich | Browser-**Console** öffnen (F12). Häufigste Ursache in gehärteten Setups: eine **Content-Security-Policy**. Ab v4.30.0 (Bundle) reicht `script-src 'self'`; es werden echte Stacktraces (Datei + Zeile) angezeigt. |
| Weathermap färbt Edges nicht | Kein `ifSpeed`/`ifHighSpeed`-Item auf den Hosts → SNMP-Interface-Monitoring nötig. |
| „Unknown action …" (Wartung/Forecast) | Nach dem Update „Scan directory" vergessen. |

---

## 🇬🇧 English

### Requirements

- **Zabbix 7.0 LTS or 7.4+** (frontend) — the dashboard widgets (section 3) require **7.4**
- **PHP 8.x** with php-fpm (or your web server's PHP handler)
- Write access to the Zabbix UI `modules/` directory and the ability to reload php-fpm
- A modern browser (ES2019 — current Chrome/Firefox/Safari/Edge)
- **No build tools required**: the prebuilt JS bundle (`assets/js/dist/nt-bundle.js`) ships in the package. You only need Node/esbuild if you want to rebuild from source (see [Build from source](#5-optional-build-from-source-developers)).
- **For weathermap mode** (edge color by utilization): devices must be monitored via **SNMP** with an interface template that provides `ifSpeed`/`ifHighSpeed`. The Zabbix agent does **not** report link speed (see README → Weathermap).

### 1. Install the main module

> The directory **must** be named `network_topology` (the module id). A repo downloaded directly may be named `zabbix-network-topology-v2-main` or similar → **rename it**.

```bash
# Go to your Zabbix UI modules folder
# (typically /usr/share/zabbix/ui/modules — other setups
#  e.g. /var/www/html/zabbix/ui/modules)
cd /usr/share/zabbix/ui/modules

# Option A — unzip the release ZIP (download: github.com/linuser/zabbix-network-topology/releases):
sudo unzip /path/to/network_topology.zip

# Option B — from the Git repo:
sudo git clone https://github.com/linuser/zabbix-network-topology.git network_topology

# Set ownership (same as the rest of your Zabbix UI — usually root:root
# or www-data:www-data)
sudo chown -R root:root network_topology

# Reload php-fpm. NOTE: the service name depends on both the distribution AND
# the PHP version — look it up first, then reload:
systemctl list-units --type=service | grep -i fpm
sudo systemctl reload php8.2-fpm       # use the name you found!
```

> **The service name is the most common pitfall.** `php8.2-fpm` (Debian 12) ·
> `php8.3-fpm` / `php8.4-fpm` (newer PHP) · `php-fpm` (RHEL/Rocky/Alma).
> If `grep -i fpm` finds nothing, PHP runs as a web server module — reload
> `apache2` or `httpd` instead.
>
> [`deploy.sh`](deploy.sh) detects the service **automatically**.

> **No internet access on the Zabbix server?** That is the normal case for
> monitoring systems — they are often deliberately kept without outbound access.
> Download the ZIP on a workstation and transfer it instead:
>
> ```bash
> # on your workstation
> scp network_topology*.zip <server>:/tmp/
>
> # on the Zabbix server
> cd /usr/share/zabbix/ui/modules
> sudo unzip -q /tmp/network_topology.zip && rm /tmp/network_topology*.zip
> ```
>
> Note: the server answers `ping` but `curl` fails after a few milliseconds? Then a
> firewall rejects outbound TCP/443 (ICMP is often allowed) — it is neither a DNS
> nor an IPv6 problem. Check with:
> `curl -4 -sS -o /dev/null -w '%{http_code}\n' --max-time 8 https://github.com`
>
> The most convenient route here is [`deploy.sh`](deploy.sh): it builds locally,
> transfers over SSH and needs **no** internet access on the server at all.

> **RHEL / RedHat / Rocky / Alma** — three extra points:
> - **SELinux** (the usual reason for "module not shown"): restore the httpd read context after copying, otherwise php-fpm can't read the files → `sudo restorecon -Rv /usr/share/zabbix/ui/modules/network_topology`. **Not needed when using `nt-install.sh` or `deploy.sh`** — both call `restorecon` themselves as of 5.0. It only applies to unpacking by hand.
> - **Owner/service**: the web user is `apache` (not www-data), the service is `php-fpm` → `sudo chown -R apache:apache network_topology` and `sudo systemctl reload php-fpm`
> - **APCu** (optional, recommended for cache + rate-limit): `sudo dnf install php-pecl-apcu` and enable it for the **FPM** SAPI. Without APCu the module still works — just without cache/throttling (fail-open).

### 2. Enable the module

1. **Administration → General → Modules → Scan directory**
2. Set **"Network Topology for Zabbix"** to **Enabled**.
3. Open it via **Monitoring → Network Topology for Zabbix**.

### 3. Optional: dashboard widgets

Five separate widget modules (they all consume the main module's data):

| ZIP | In the dashboard menu | Shows |
|---|---|---|
| `network_topology_widget.zip` | **NT Topology** | the map as a tile |
| `network_topology_health_widget.zip` | **NT Health Score** | score per host group |
| `network_topology_table_widget.zip` | **NT Table** | Nagios-style host list |
| `network_topology_kpi_widget.zip` | **NT KPI** | key figures as a ring or tiles |
| `network_topology_items_widget.zip` | **NT Items** | one item pattern across all hosts |

```bash
cd /usr/share/zabbix/ui/modules
for w in widget health_widget table_widget kpi_widget items_widget; do
    sudo unzip "/path/network_topology_$w.zip" -d "network_topology_$w"
done
sudo chown -R root:root network_topology_*_widget network_topology_widget
sudo systemctl reload php8.2-fpm      # service name as determined above
```
Then **Scan directory** → set the modules you want to *Enabled* → available in the dashboard editor. The widget ZIPs carry their files **directly**, without a top-level folder — that is why `-d <target>` is required.
**Prerequisite:** the main module must be installed + enabled — and **Zabbix 7.4** (the widgets don't run on 7.0 LTS; the main module does).

> **Why not standalone?** The data action `network.topology.data` belongs to the main module, and the topology widget loads Cytoscape.js from `modules/network_topology/assets/js/` — the library ships only once on purpose. Without the main module (or with it disabled) the tiles show an error. So **install and enable the main module first, then the widgets.**

### 4. Optional: topology events + health-score history

For real Zabbix events on topology changes and a health-score trend:

> **The three files for this step are deliberately not in the module ZIP.**
> The module directory sits under the web root and is publicly readable — only
> what is needed at runtime belongs there. Fetch the templates and the sender
> script straight from the repository:
>
> ```bash
> curl -fLO https://raw.githubusercontent.com/linuser/zabbix-network-topology/main/templates/nt_topology_change_template.yaml
> curl -fLO https://raw.githubusercontent.com/linuser/zabbix-network-topology/main/templates/nt_health_score_template.yaml
> curl -fLO https://raw.githubusercontent.com/linuser/zabbix-network-topology/main/tools/topo-change-sender.sh
> ```

1. Import the templates (Data collection → Templates → Import):
   - `nt_topology_change_template.yaml`
   - `nt_health_score_template.yaml`
   → link them to a carrier host (e.g. "Zabbix server").
2. Create a **dedicated monitoring user** (USER role, read access to the host groups). Important: the APCu baseline is user-scoped — a shared user would roll its baseline against your UI sessions.
3. Put `topo-change-sender.sh` on the Zabbix server as a **cron** (every 2 min), configured via ENV (`ZBX_URL`, `ZBX_USER`, `ZBX_PASS`, `GROUPIDS`, `SENDER_HOST`). It pushes topology changes **and** the health score via `zabbix_sender`.

### 5. Optional: build from source (developers)

Only needed if you change the JS modules:

```bash
npm install          # esbuild (devDependency)
npm run build        # -> assets/js/dist/nt-bundle.js
```
`deploy.sh` rebuilds the bundle from source before deploying anyway.

### Update

Replace the `network_topology` directory with the new version, `chown`, reload php-fpm, **Scan directory**. The map layout and manual links are stored server-side and survive regardless; pins, notes and presets live in the browser `localStorage`. After an update that adds new actions, "Scan directory" is **mandatory**.

#### Upgrading from 4.x to 5.0

5.0 drops the `_v6` suffix from every identifier — the directory is now `network_topology` instead of `network_topology_v6`. **The old directory has to go**, otherwise Zabbix registers both modules and the menu entry shows up twice:

Safest with the uninstaller — it knows the old names, moves instead of deleting, and leaves other people's modules alone:

```bash
./nt-uninstall.sh --dry-run     # look first
./nt-uninstall.sh
```

By hand works too, but **check what is actually there first**:

```bash
cd /usr/share/zabbix/ui/modules
grep -l '"id".*network_topology' */manifest.json     # lists EVERY directory of this module
sudo rm -rf network_topology_v6 network_topology_v6_widget \
            network_topology_v6_health_widget network_topology_v6_table_widget
```

That `grep` is not busywork: a manual install often takes the **source** directory name — `widget_health/` instead of `network_topology_v6_health_widget/`. Both then declare the same module ID, and Zabbix registers **neither**. Found exactly like that on a real instance: of four modules only two were in the database, with no error message anywhere.

Then install as usual (steps 1–3) and run **Scan directory**; the stale entries disappear on their own.

Two things need a manual follow-up:

- **Dashboard tiles.** The widget IDs are part of the dashboard; Zabbix no longer recognises the old type and hides the tiles. Add and configure them once more — the dashboard itself stays intact.

  To avoid that, the [CHANGELOG](CHANGELOG.md) section "Optional: Dashboards per SQL erhalten" carries an `UPDATE` script that rewrites the identifiers directly in the database. **That path also removes steps 2 and 3**: the modules stay enabled, "Scan directory" is not required, and the tiles stay in place. Rehearsed on two independent installations, one of them on PostgreSQL.
- **Bookmarks.** The view now lives at `zabbix.php?action=network.topology.view`.

Everything user-side is preserved. The map layout and manual links live server-side — in `module.config` and the user profile, not tied to the module name. Pins, notes, filter presets and toolbar settings live in `localStorage`, whose keys were never tied to the module name either. Host tags (`nt:parent`) are unaffected anyway.

### Uninstall

```bash
./nt-uninstall.sh --dry-run     # show what would happen, change nothing
./nt-uninstall.sh               # remove the main module and all widgets
```

The script **moves** the directories to `/var/backups/nt-uninstall-<date>/` instead of deleting them, and prints the command to put them back. It only touches directories whose `manifest.json` carries a `network_topology` ID — someone else's module that happens to be called `widget/` is left alone. Old `_v6` directories from 4.x are picked up too.

Afterwards, in the UI: **Administration → General → Modules → Scan directory**. Only then do the module rows leave the database — and with them the **shared** links and positions, which live in `module.config` on the module row.

By hand it is the same: set the module to **Disabled**, delete the directories, reload php-fpm, run *Scan directory*.

**What stays behind.** The **personal** layer does not hang off the module row but off the user profile, and survives any uninstall:

```sql
DELETE FROM profiles WHERE idx = 'web.network_topology.manual_links';
DELETE FROM profiles WHERE idx = 'web.network_topology.positions';
```

`./nt-uninstall.sh --purge` does this after asking — it first shows how many rows across how many users are affected.

**What the script deliberately does not touch:** the host tags (`nt:parent`, `nt:icon`, …), the imported templates, the cron for `topo-change-sender.sh` and the monitoring user created for it. Those are data someone entered themselves — `nt:parent` describes your infrastructure, not the module. The script lists them and prints the SQL; running it is your call. Pins, notes and filter presets live in each browser's `localStorage` and cannot be removed server-side anyway.

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Unit php8.3-fpm.service not found` | Your php-fpm has a different name. `systemctl list-units --type=service \| grep -i fpm` shows the real one (Debian 12 → `php8.2-fpm`, RHEL → `php-fpm`). |
| `curl: (7) Failed to connect … after 1 ms` | A firewall rejects outbound TCP/443. Download the ZIP on a workstation and `scp` it over — or use `deploy.sh` (needs no internet on the server). |
| Module not shown in the list | Directory isn't named exactly `network_topology`, or wrong permissions/owner. On **RHEL/Rocky/Alma** also run `sudo restorecon -Rv …` (SELinux). |
| Stuck on "Loading topology…" / blank area | Open the browser **console** (F12). Most common cause in hardened setups: a **Content-Security-Policy**. As of v4.30.0 (bundle) `script-src 'self'` is enough; you get real stack traces (file + line). |
| Weathermap doesn't color edges | No `ifSpeed`/`ifHighSpeed` item on the hosts → SNMP interface monitoring required. |
| "Unknown action …" (maintenance/forecast) | You forgot "Scan directory" after the update. |

---

---

**Projektseite / project site: [zabfox.de](https://zabfox.de)** · **Repo + Issues: [github.com/linuser/zabbix-network-topology](https://github.com/linuser/zabbix-network-topology)**

*Lizenz / License: **AGPL-3.0-or-later** — © 2026 PlaNet Fox / Alexander Fox. Siehe / see [LICENSE](LICENSE) & [README](README.md).*
