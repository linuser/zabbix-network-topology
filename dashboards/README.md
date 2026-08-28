# Sample-Dashboard

Ein vorgefertigtes Dashboard, das das Hauptmodul und alle fünf Widgets nutzt.

## Zuerst das Wichtigste: der Import geht erst ab Zabbix 8

**Eigenständige Dashboards kennt der Zabbix-Import erst ab 8.0.** Auf 7.0 LTS
und 7.4 gibt es weder einen Import- noch einen Export-Knopf für Dashboards, und
der Import-Validator lehnt das Wurzel-Tag ab. Gegen die Validatoren von 7.0,
7.2 und 7.4 nachgemessen — alle drei antworten:

```
Invalid tag "/": unexpected tag "dashboards".
```

Wer 7.0 LTS oder 7.4 fährt, baut das Dashboard **von Hand** nach. Das ist kein
Rückschritt: bei einem einzelnen Setup ist es ohnehin schneller, und die
Anordnung unten ist die Vorlage dafür.

Ältere Fassungen dieser Datei trugen `version: '7.0'` und eine Anleitung
„Dashboards → Import". Beides ging nicht; der Weg existierte in keiner der
unterstützten Versionen.

## Voraussetzung

Alle sechs Module müssen installiert **und aktiviert** sein:

| Modul | Widget im Menü |
|---|---|
| `network_topology` | — (Hauptmodul) |
| `network_topology_widget` | NT Topology |
| `network_topology_health_widget` | NT Health Score |
| `network_topology_table_widget` | NT Table |
| `network_topology_kpi_widget` | NT KPI |
| `network_topology_items_widget` | NT Items |

Fehlt eines, scheitert der Import mit „unknown widget type".

## Import (nur Zabbix 8+)

1. *Dashboards → Alle Dashboards*
2. *Import*, Datei `nt-overview.yaml` wählen
3. Danach in **jedem** Widget die **Host groups** setzen — die Datei bringt
   bewusst keine mit, sonst verwiese sie auf Gruppen-IDs, die es auf deiner
   Installation nicht gibt.

## Von Hand nachbauen (7.0 LTS und 7.4)

Das Raster ist 72 Spalten breit. Diese Anordnung entspricht der Datei:

| Widget | Position | Größe |
|---|---|---|
| NT Topology | 0, 0 | 48 × 10 |
| NT KPI | 48, 0 | 24 × 5 |
| NT Health Score | 48, 5 | 24 × 5 |
| NT Table | 0, 10 | 40 × 8 |
| NT Items | 40, 10 | 32 × 8 |

Vorgeschlagene Einstellungen: Topology auf *Technical* mit LLDP-Kanten, KPI als
*Ring*, Health Score mit „worst first", Items mit dem Muster
`system.cpu.util`.

> Findest du kein passendes Item-Muster, zeigt NT Items „keine Items". Das ist
> kein Fehler, sondern eine andere Template-Welt — SNMP-Switches und Windows
> liefern andere Keys als die Linux-Standardtemplates. Das Dropdown im Widget
> listet unter „Discovered" die tatsächlich vorhandenen.

## Eigene Vorlage erzeugen

Die zuverlässigste Methode für eigene Dashboards: eines in **deiner**
Zabbix-Version von Hand anlegen und, sofern deine Version das kann, exportieren.
Die so erzeugte YAML passt garantiert zu deinem Schema — anders als eine Datei,
die für eine andere Version geschrieben wurde.
