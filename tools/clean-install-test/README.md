# Clean-Install-Test (Docker)

Wegwerf-**Zabbix 7.4** zum Testen des Moduls auf einer **sauberen** Instanz —
ohne Alt-Configs, Macros oder Klon-Cruft. Simuliert, was ein Beta-Tester erlebt,
der das Modul frisch auf seiner Zabbix installiert.

Nur `tools/` (repo-only, **nicht** im Release-ZIP).

## Ablauf

```bash
cd tools/clean-install-test

# 1. Modul bauen (= exakter Inhalt des Release-ZIP)
./build-module.sh

# 2. Zabbix hochfahren (erster Start: ~1-2 Min, DB-Schema-Import)
docker compose up -d

# 3. Login
#    http://localhost:8080   →   Admin / zabbix

# 4. Modul aktivieren:
#    Administration → General → Modules → Scan directory
#    → "Network Topology for Zabbix" → Enable

# 5. Aufraeumen (inkl. DB-Volume)
docker compose down -v
```

## Was der Test prüft (die eigentliche Verifikation)

- **Lädt das Modul überhaupt?** Monitoring → *Network Topology for Zabbix* →
  Seite rendert, Footer zeigt die Version (**v4.33.0**).
- **Leere Instanz** (frische Zabbix hat 0 Hosts) → **graceful**? Kein Crash,
  sauberer „keine Hosts"-Zustand statt weißem Bildschirm.
- **Console (F12)** → keine roten Fehler (Bundle lädt, kein 404, keine CSP-Blockade).
- **Alle Tabs** durchklicken (Technical/Management/Table/Geo/Health/Stats).
- Optional mit Daten: einen Host anlegen (Data collection → Hosts) oder ein
  Standard-Template importieren → erscheint der Host im Graph?

## Modul updaten (nach Code-Änderung)

```bash
./build-module.sh                 # neu bauen
docker compose restart web        # Frontend neu laden (Opcache)
# Browser: Strg+F5
```

## Hinweise

- Der Container nutzt **kein** `systemctl` → `nt-install.sh` ist hier nicht der
  Weg; das Modul wird gemountet + per `restart web` neu geladen. `nt-install.sh`
  testest du auf einer echten VM/Box.
- Findet Zabbix das Modul nicht: im Web-Container den Modul-Pfad prüfen —
  `docker compose exec web find / -name manifest.json -path '*modules*' 2>/dev/null`
  — und den Mount-Pfad in `docker-compose.yml` anpassen.
- Ports: Web **8080**, Server-Trapper **10051** (nur falls du echte Agents anbinden willst).
