# Installation — Network Topology for Zabbix

**🇩🇪 [Deutsch](#-deutsch) · 🇬🇧 [English](#-english)**

Technische Modul-ID / technical module id: **`network_topology_v6`** — das
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

> Das Verzeichnis **muss** `network_topology_v6` heißen (= die Modul-ID). Ein direkt heruntergeladenes Repo heißt evtl. `zabbix-network-topology-v2-main` o. ä. → **umbenennen**.

```bash
# In den Modules-Ordner deiner Zabbix-UI wechseln
# (typisch /usr/share/zabbix/ui/modules — bei anderen Setups
#  z. B. /var/www/html/zabbix/ui/modules)
cd /usr/share/zabbix/ui/modules

# Variante A — Release-ZIP entpacken (Download: github.com/linuser/zabbix-network-topology/releases):
sudo unzip /pfad/zu/network_topology_v6.zip

# Variante B — aus dem Git-Repo:
sudo git clone https://github.com/linuser/zabbix-network-topology.git network_topology_v6

# Rechte setzen (Owner wie der Rest deiner Zabbix-UI — meist root:root
# oder www-data:www-data)
sudo chown -R root:root network_topology_v6

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
> scp network_topology_v6*.zip <server>:/tmp/
>
> # auf dem Zabbix-Server
> cd /usr/share/zabbix/ui/modules
> sudo unzip -q /tmp/network_topology_v6.zip && rm /tmp/network_topology_v6*.zip
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
> - **SELinux** (Hauptursache für „Modul erscheint nicht"): nach dem Ablegen den httpd-Lesekontext setzen, sonst kann php-fpm die Dateien nicht lesen → `sudo restorecon -Rv /usr/share/zabbix/ui/modules/network_topology_v6`
> - **Owner/Service**: Web-User ist `apache` (nicht www-data), der Dienst heißt `php-fpm` → `sudo chown -R apache:apache network_topology_v6` und `sudo systemctl reload php-fpm`
> - **APCu** (optional, empfohlen für Cache + Rate-Limit): `sudo dnf install php-pecl-apcu` und für die **FPM**-SAPI aktivieren. Ohne APCu läuft das Modul trotzdem — nur ohne Cache/Drosselung (fail-open).

### 2. Modul aktivieren

1. **Administration → General → Modules → Scan directory**
2. In der Liste **„Network Topology for Zabbix"** auf **Enabled** stellen.
3. Aufruf über **Monitoring → Network Topology for Zabbix**.

### 3. Optional: Dashboard-Widgets

Drei separate Widget-Module (nutzen die Daten des Hauptmoduls) — Topologie-Graph, Health-Score und Tabelle:

```bash
cd /usr/share/zabbix/ui/modules
sudo unzip /pfad/network_topology_v6_widget.zip        -d network_topology_v6_widget
sudo unzip /pfad/network_topology_v6_health_widget.zip -d network_topology_v6_health_widget
sudo unzip /pfad/network_topology_v6_table_widget.zip  -d network_topology_v6_table_widget
sudo chown -R root:root network_topology_v6_widget network_topology_v6_health_widget network_topology_v6_table_widget
sudo systemctl reload php8.2-fpm      # Dienstname wie oben ermittelt
```
Dann **Scan directory** → „Network Topology for Zabbix — Widget", „— Health Widget" bzw. „NT Table" aktivieren → im Dashboard-Editor verfügbar.
**Voraussetzung:** Das Hauptmodul muss installiert + aktiviert sein — und **Zabbix 7.4** (die Widgets laufen nicht auf 7.0 LTS; das Hauptmodul schon).

### 4. Optional: Topologie-Events + Health-Score-Historie

Für echte Zabbix-Events bei Topologie-Änderungen und einen Health-Score-Verlauf:

1. Templates importieren (Data collection → Templates → Import):
   - `templates/nt_topology_change_template.yaml`
   - `templates/nt_health_score_template.yaml`
   → an einen Trägerhost linken (z. B. „Zabbix server").
2. **Dedizierten Monitoring-User** anlegen (USER-Rolle, Lesezugriff auf die Hostgruppen). Wichtig: die APCu-Baseline ist user-scoped — ein geteilter User würde sich die Baseline mit UI-Sessions verrollen.
3. `tools/topo-change-sender.sh` auf den Zabbix-Server, als **Cron** (alle 2 min), konfiguriert per ENV (`ZBX_URL`, `ZBX_USER`, `ZBX_PASS`, `GROUPIDS`, `SENDER_HOST`). Das Skript pusht Topo-Änderungen **und** den Health-Score per `zabbix_sender`.

### 5. Optional: Aus Source bauen (Entwickler)

Nur nötig, wenn du die JS-Module änderst:

```bash
npm install          # esbuild (devDependency)
npm run build        # -> assets/js/dist/nt-bundle.js
```
`deploy.sh` baut das Bundle vor dem Ausrollen ohnehin frisch aus dem Source.

### Update

Verzeichnis `network_topology_v6` durch die neue Version ersetzen, `chown`, php-fpm reload, **Scan directory**. Pins/Notizen/Presets liegen im Browser-`localStorage` und bleiben erhalten. Nach einem Update mit neuen Actions ist „Scan directory" **Pflicht**.

### Deinstallation

Modul in der UI auf **Disabled**, dann Verzeichnis löschen und php-fpm reloaden.

### Troubleshooting

| Symptom | Ursache / Lösung |
|---|---|
| `Unit php8.3-fpm.service not found` | Dein php-fpm heißt anders. `systemctl list-units --type=service \| grep -i fpm` zeigt den echten Namen (Debian 12 → `php8.2-fpm`, RHEL → `php-fpm`). |
| `curl: (7) Failed to connect … after 1 ms` | Firewall blockt ausgehend TCP/443. ZIP auf einem Arbeitsplatz laden und per `scp` übertragen — oder `deploy.sh` nutzen (braucht kein Server-Internet). |
| Modul erscheint nicht in der Liste | Verzeichnis heißt nicht exakt `network_topology_v6`, oder falsche Rechte/Owner. Auf **RHEL/Rocky/Alma** zusätzlich `sudo restorecon -Rv …` (SELinux). |
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

> The directory **must** be named `network_topology_v6` (the module id). A repo downloaded directly may be named `zabbix-network-topology-v2-main` or similar → **rename it**.

```bash
# Go to your Zabbix UI modules folder
# (typically /usr/share/zabbix/ui/modules — other setups
#  e.g. /var/www/html/zabbix/ui/modules)
cd /usr/share/zabbix/ui/modules

# Option A — unzip the release ZIP (download: github.com/linuser/zabbix-network-topology/releases):
sudo unzip /path/to/network_topology_v6.zip

# Option B — from the Git repo:
sudo git clone https://github.com/linuser/zabbix-network-topology.git network_topology_v6

# Set ownership (same as the rest of your Zabbix UI — usually root:root
# or www-data:www-data)
sudo chown -R root:root network_topology_v6

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
> scp network_topology_v6*.zip <server>:/tmp/
>
> # on the Zabbix server
> cd /usr/share/zabbix/ui/modules
> sudo unzip -q /tmp/network_topology_v6.zip && rm /tmp/network_topology_v6*.zip
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
> - **SELinux** (the usual reason for "module not shown"): restore the httpd read context after copying, otherwise php-fpm can't read the files → `sudo restorecon -Rv /usr/share/zabbix/ui/modules/network_topology_v6`
> - **Owner/service**: the web user is `apache` (not www-data), the service is `php-fpm` → `sudo chown -R apache:apache network_topology_v6` and `sudo systemctl reload php-fpm`
> - **APCu** (optional, recommended for cache + rate-limit): `sudo dnf install php-pecl-apcu` and enable it for the **FPM** SAPI. Without APCu the module still works — just without cache/throttling (fail-open).

### 2. Enable the module

1. **Administration → General → Modules → Scan directory**
2. Set **"Network Topology for Zabbix"** to **Enabled**.
3. Open it via **Monitoring → Network Topology for Zabbix**.

### 3. Optional: dashboard widgets

Three separate widget modules (they consume the main module's data) — topology graph, health score and table:

```bash
cd /usr/share/zabbix/ui/modules
sudo unzip /path/network_topology_v6_widget.zip        -d network_topology_v6_widget
sudo unzip /path/network_topology_v6_health_widget.zip -d network_topology_v6_health_widget
sudo unzip /path/network_topology_v6_table_widget.zip  -d network_topology_v6_table_widget
sudo chown -R root:root network_topology_v6_widget network_topology_v6_health_widget network_topology_v6_table_widget
sudo systemctl reload php8.2-fpm      # Dienstname wie oben ermittelt
```
Then **Scan directory** → enable "Network Topology for Zabbix — Widget" / "— Health Widget" / "NT Table" → available in the dashboard editor.
**Prerequisite:** the main module must be installed + enabled — and **Zabbix 7.4** (the widgets don't run on 7.0 LTS; the main module does).

### 4. Optional: topology events + health-score history

For real Zabbix events on topology changes and a health-score trend:

1. Import the templates (Data collection → Templates → Import):
   - `templates/nt_topology_change_template.yaml`
   - `templates/nt_health_score_template.yaml`
   → link them to a carrier host (e.g. "Zabbix server").
2. Create a **dedicated monitoring user** (USER role, read access to the host groups). Important: the APCu baseline is user-scoped — a shared user would roll its baseline against your UI sessions.
3. Put `tools/topo-change-sender.sh` on the Zabbix server as a **cron** (every 2 min), configured via ENV (`ZBX_URL`, `ZBX_USER`, `ZBX_PASS`, `GROUPIDS`, `SENDER_HOST`). It pushes topology changes **and** the health score via `zabbix_sender`.

### 5. Optional: build from source (developers)

Only needed if you change the JS modules:

```bash
npm install          # esbuild (devDependency)
npm run build        # -> assets/js/dist/nt-bundle.js
```
`deploy.sh` rebuilds the bundle from source before deploying anyway.

### Update

Replace the `network_topology_v6` directory with the new version, `chown`, reload php-fpm, **Scan directory**. Pins/notes/presets live in the browser `localStorage` and are preserved. After an update that adds new actions, "Scan directory" is **mandatory**.

### Uninstall

Set the module to **Disabled** in the UI, then delete the directory and reload php-fpm.

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Unit php8.3-fpm.service not found` | Your php-fpm has a different name. `systemctl list-units --type=service \| grep -i fpm` shows the real one (Debian 12 → `php8.2-fpm`, RHEL → `php-fpm`). |
| `curl: (7) Failed to connect … after 1 ms` | A firewall rejects outbound TCP/443. Download the ZIP on a workstation and `scp` it over — or use `deploy.sh` (needs no internet on the server). |
| Module not shown in the list | Directory isn't named exactly `network_topology_v6`, or wrong permissions/owner. On **RHEL/Rocky/Alma** also run `sudo restorecon -Rv …` (SELinux). |
| Stuck on "Loading topology…" / blank area | Open the browser **console** (F12). Most common cause in hardened setups: a **Content-Security-Policy**. As of v4.30.0 (bundle) `script-src 'self'` is enough; you get real stack traces (file + line). |
| Weathermap doesn't color edges | No `ifSpeed`/`ifHighSpeed` item on the hosts → SNMP interface monitoring required. |
| "Unknown action …" (maintenance/forecast) | You forgot "Scan directory" after the update. |

---

---

**Projektseite / project site: [zabfox.de](https://zabfox.de)** · **Repo + Issues: [github.com/linuser/zabbix-network-topology](https://github.com/linuser/zabbix-network-topology)**

*Lizenz / License: **AGPL-3.0-or-later** — © 2026 PlaNet Fox / Alexander Fox. Siehe / see [LICENSE](LICENSE) & [README](README.md).*
