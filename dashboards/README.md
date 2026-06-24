# Sample-Dashboards

Vorgefertigte Zabbix-Dashboards die das Hauptmodul + die Widgets nutzen.

## Voraussetzungen

Beide Module müssen installiert + enabled sein:
- `network_topology_v6` (Hauptmodul)
- `network_topology_v6_widget` (Topology-Widget)
- `network_topology_v6_health_widget` (Health-Score-Widget)

Wenn ein Widget-Modul fehlt, schlägt der Import mit "unknown widget type" fehl.

## Import

In der Zabbix-UI:
1. *Dashboards → Alle Dashboards*
2. Oben rechts *Import*
3. Datei wählen (z.B. `nt-overview.yaml`)
4. *Import*

Nach dem Import musst du noch:
- Im Topology-Widget die **Host groups** wählen (Dashboard kennt deine Gruppen-IDs nicht)
- Im Health-Score-Widget die **Host groups** wählen (gleicher Grund)

## Verfügbare Dashboards

### `nt-overview.yaml`
NOC-Übersicht mit drei Widgets:
- **Oben (volle Breite)**: Topology-Widget — interaktive Karte mit LLDP-Edges
- **Unten links**: Health-Score-Widget — per-Hostgroup-Bewertung
- **Unten rechts**: Zabbix-Native Problems-Widget — aktuelle Probleme

Geeignet als Standard-Dashboard für Operator-Sicht.

## Eigenes Dashboard bauen

Manuell ist einfacher als YAML-Import wenn du nur ein Setup pflegst:

1. *Dashboards → Create dashboard*
2. *Add widget → Type "Topology"* (= `network_topology_v6_widget`) → Hostgroups wählen
3. *Add widget → Type "NT Health Score"* (= `network_topology_v6_health_widget`)
4. Optional: native Zabbix-Widgets ergänzen (*Problems*, *Top hosts*, *Trigger overview*, *Geomap*)
5. *Save dashboard*

## Hinweis YAML-Format

Das YAML-Format ist Zabbix-Version-abhängig (export-version `7.0`). Bei Zabbix 8+
musst du eventuell die `version`-Zeile anpassen oder das Dashboard manuell
nachbauen. Sicherste Methode: bestehendes Dashboard in deiner Zabbix-Version
einmal manuell anlegen, dann via *Export* die für deine Version passende YAML
generieren — die nutzt du als Vorlage für weitere Setups.
