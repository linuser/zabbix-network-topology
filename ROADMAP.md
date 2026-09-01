# Roadmap

Arbeitsliste, kein Versprechen. Auf Deutsch wie die Kommentare im Code; was ein
Benutzer liest, bleibt Englisch.

**Die wichtigste Spalte ist „Stand".** Mehrere Punkte, die auf Wunschlisten
standen, waren bereits gebaut — und wurden trotzdem erneut vorgeschlagen, weil
niemand nachgesehen hatte. Wer hier etwas einträgt, prüft vorher im Code nach
und schreibt hin, was er gefunden hat.

---

## Bereits vorhanden — nicht neu bauen

| Wunsch | Stand |
|---|---|
| **Layout sperren / Knoten fixieren** | **Fertig.** Kontextmenü Pin/Unpin, `node.lock()`, `savePinned()` persistiert, eigenes Knotenbild, `group-cluster-layout.js` filtert `.not(':locked')`. |
| **Export/Import der Layouts als JSON** | **Fertig seit v5.2-Arbeit** (`layout-file.js`). Zwei Knöpfe neben den Presets, Prüfung beim Einlesen mit denselben Mustern und Grenzen wie serverseitig. |
| **Konflikterkennung bei gleichzeitigem Bearbeiten** | **Fertig, war aber wirkungslos.** Revisionen, `base`, `Revision::matches()`, Konfliktmeldung — das View-Template reichte `revisions` nur nicht durch. Behoben. |
| **Pfad zwischen zwei Hosts** | **Fertig** (`path-highlight.js`, 98 Zeilen). Kürzester Pfad per BFS, Auswahl über Kontextmenü „Pfad von hier" / „Pfad zu hier", alles außerhalb gedimmt, Pfadkanten fett-cyan. Eigene BFS-Implementierung mit begründetem Vorbehalt: Cytoscapes `bfs()` lieferte in der minifizierten Fassung `found:null` bei verbundenen Knoten. |
| **Unmanaged Devices** | **Fertig — heißen „Ghost Nodes"** (`build-elements.js`, §9). LLDP/CDP-Nachbarn, die auf keinen überwachten Host auflösen, aus `lldp_quality[].unmatched`. Mehrere Melder desselben Unbekannten ergeben **einen** Knoten mit mehreren Kanten. Umschalter „👻 Ghost nodes" im Technical-Tab, standardmäßig aus. |
| **Mini Map bei großen Topologien** | **Fertig** (`minimap.js`, 164 Zeilen). SVG unten rechts, severity-farbige Punkte, Viewport-Rechteck, Klick schwenkt die Karte, Aktualisierung auf zoom/pan (80 ms entprellt) plus alle 5 s. |
| **Presets (Positionen, Pins, Notizen, Links)** | Vorhanden. Achtung: Positionen wurden bis zur Korrektur still verschluckt, weil `applyPreset()` in den localStorage schrieb, den seit der Server-Umstellung nur noch die Migration liest. |

---

## Als Nächstes

### 1. Interface-Ansicht beim Klick auf eine Kante

**Schritt 1 — nur vorhandene Daten.** Eine Kante trägt bereits `ports` (beide
Enden) und `port_metrics` mit `in`, `out`, `speed`. Es fehlt allein die
Interaktion: **einen Klick auf Kanten gibt es heute gar nicht**, nur Knoten
haben ein Kontextmenü. Ein Panel plus Tap-Handler, kein Template, keine neuen
Items.

**Schritt 2 — neue Messwerte.** Errors, Drops, Link-Uptime aus `ifInErrors`,
`ifOutDiscards`, `ifLastChange`. Standard-OIDs, die praktisch jedes Gerät
liefert. Dazu Sparklines für RX/TX — die Action `network.topology.spark`
existiert für Knoten, ob sie sich auf Port-Items umbiegen lässt, ist ungeprüft.

> **Vorbehalt, der schon im Code steht:** die Zuordnung Port → Traffic setzt
> `lldpRemLocalPortNum == ifIndex` voraus. Auf Aruba/ProCurve stimmt das 1:1,
> sonst gibt es keine Metrik. In einer Ansicht, deren Zweck Portdetails sind,
> fällt das deutlich stärker auf als im heutigen Beiwerk.

### 2. Topology-Diff auf der Karte hervorheben

`topo_changes` (added/removed) wird bei jedem Datenabruf gegen eine
APCu-Baseline berechnet und heute **nur als Toast** gemeldet — Toasts
verschwinden, die Karte bleibt unmarkiert.

**Offene Entscheidung, von der der Aufwand abhängt:** `added` lässt sich
hervorheben, die Kante existiert. `removed` existiert **nicht mehr** und müsste
gezeichnet werden. Bleibt sie bis zum nächsten Poll? Bis zum Wegklicken? Zählt
sie in der KPI-Leiste? `topo_changes` liefert außerdem nur **Labels**, keine
IDs — die müssen zurückgemappt werden.

### 3. Zabbix 8

Branch `feat/zabbix-8`: Guard (`nt-assign-guard.js`), 261 Zeilen Befundtext,
auf zwei Installationen bestätigt. Merged **konfliktfrei** auf main, ist in
Kombination mit den Widget-Änderungen aber **ungetestet**.

**Blocker:** kein Zabbix-8.0-Image erreichbar (Docker Hub 403, auf app.fox1.de
liegt nur 7.4). Ohne Testinstanz nicht verifizierbar, und ungetestet gehört es
in kein Release.

### 4. Suche über mehr als den Anzeigenamen

Das Suchfeld im Technical-Tab vergleicht heute **ausschließlich `label`**
(`toolbar.js`, ein `indexOf` auf den Anzeigenamen).

Ein Knoten trägt aber bereits `host` (technischer Name) und `ip`. **Zwei
weitere Vergleiche**, und Hostname und IP sind abgedeckt — der billigste Punkt
auf dieser ganzen Liste, gemessen an dem, wie oft man ihn benutzt.

Alles Weitere braucht neue Daten: MAC und LLDP-Nachbar (siehe ARP/FDB unten),
Seriennummer (Inventory `serialno_a`, wird heute nicht geladen), VLAN (siehe
dort), Zabbix-Host-ID (liegt vor, nur nicht durchsucht).

**Danach: „Locate on topology"** — bei einem Treffer hinspringen statt nur zu
dimmen. Das Dimmen gibt es schon.

### 5. Pfad als Liste, nicht nur als Hervorhebung

Der Pfad wird berechnet und auf der Karte markiert (siehe Tabelle oben). Was
fehlt, ist die **textuelle Hop-Liste** mit Zustand je Link:

```
Core-SW  →  Distribution-SW  →  Access-SW-03  →  VMware Host  →  VM
```

Die Zwischenschritte hat der BFS bereits; er rekonstruiert den Pfad über
Parent-Pointer. Es fehlt die Darstellung und die Frage, was „Zustand" je Link
heißt — dieselben Portmetriken wie bei der Interface-Ansicht.

Ein *impliziter* Start („Pfad **zu** diesem Host", ohne A zu wählen) bräuchte
außerdem eine Festlegung, was der Ausgangspunkt ist. `whatif.js` und
`root-cause.js` benutzen dafür schon eine Uplink-Referenz.

---

## Später

### VLAN-Ansicht

VLAN auswählen, nur Geräte und Links anzeigen, auf denen es vorkommt. Wäre die
stärkste Erweiterung — und ist die teuerste.

**VLAN kommt im ganzen Projekt nicht vor.** Der Grund ist LLDP: es trägt keine
VLAN-Mitgliedschaft. `lldpXdot1LocVlanName` ist eine optionale Erweiterung, die
viele Geräte nicht liefern. Belastbar ist die Q-BRIDGE-MIB
(`dot1qVlanStaticName`, `dot1qVlanCurrentEgressPorts`) — deren Egress-Ports
kommen als **Bitmaske**, die gegen die ifIndex-Tabelle aufgelöst werden muss.

Neues Template, neue Discovery, neue Parserlogik, und die Herstellerunterschiede
sind größer als bei LLDP. Genau die Klasse Problem, aus der [#2], [#3] und [#4]
entstanden — dort ging es nur um Nachbartabellen, nicht um Bitmasken.

**Erster Schritt ist kein Code, sondern eine Messung:** ein `nt-vlan-probe.sh`
nach dem Muster von `tools/nt-lldp-probe.sh`, um auf echten Switches zu prüfen,
ob die MIB überhaupt herausrückt. Ein Nachmittag statt eines Releases.

### ARP + MAC/FDB — „wo steckt dieses Gerät?"

MAC auf Switch/Port auflösen, IP dazu, Hostname dazu. Wäre im Alltag stark und
ist die Voraussetzung für die halbe Suchliste oben.

Braucht zwei neue Quellen: **BRIDGE-MIB** (`dot1dTpFdbPort`, MAC → Bridge-Port)
plus die Umsetzung Bridge-Port → ifIndex über `dot1dBasePortIfIndex`, und
**ARP** aus `ipNetToMediaPhysAddress` (oder `ipNetToPhysicalPhysAddress`) vom
Router. Zwei Tabellen, zwei Auflösungsschritte, und FDB-Einträge altern schnell
(Standard 300 s) — eine Anzeige „gefunden auf Port 18" ist also immer eine
Momentaufnahme und muss ihren Zeitstempel mitführen.

Beides sind Standard-MIBs, anders als bei VLAN gibt es keine Bitmasken. Machbar,
aber es ist ein eigenes Erhebungsthema, kein Anzeigethema.

### PoE je Port

`pethPsePortActualPower` aus der POWER-ETHERNET-MIB. Kleines, klar umrissenes
Item — passt am besten als Zeile **in die Interface-Ansicht** (Punkt 1), nicht
als eigenes Feature.

### BGP/OSPF — physische gegen logische Ansicht

Ein zweiter Graph über denselben Knoten: Nachbarschaften statt Kabel. Datenquelle
wäre die BGP4-MIB (`bgpPeerState`) beziehungsweise OSPF-MIB.

Der Aufwand steckt nicht im Einsammeln, sondern in der Umschaltung: der ganze
Renderpfad geht heute davon aus, dass eine Kante ein Kabel ist — Weathermap,
Pfad-BFS, Root Cause, What-if. Ein zweiter Kantentyp berührt alle vier.

### Standortansicht für MSPs

Deutschland → München → Firewall/Core/12 Switches.

**Teilweise vorhanden:** `selectInventory` lädt bereits `location` (neben
`location_lat`/`location_lon` für die Geo-Karte), und `nt:parent` trägt schon
eine Trägerbeziehung. Das Gruppen-Cluster-Layout kann nach `_primaryGroup`
gruppieren.

Was fehlt, ist die **Ebenen-Tiefe**: heute gibt es eine Gruppierungsebene, die
Skizze hat drei (Land → Stadt → Gebäude). Und die Frage, woher die Hierarchie
kommt — aus `location` als Freitext lässt sie sich nicht ableiten.

### Cloud-Knoten und Docker/Kubernetes-Ebenen

Azure/AWS/Hetzner-Instanzen neben physischen Hosts; Workload → Node →
physischer Host → Netzwerk.

**Vermutlich fast kein neuer Code nötig.** Beides sind in Zabbix ganz normale
Hosts, und das Modul zeichnet jeden Host. Was fehlt, ist die *Verbindung* — und
dafür gibt es bereits `nt:parent=<host>` (dokumentiert als „VM → Hypervisor").
Der Kanten-Aufbau in `NetworkTopologyData` legt je Kind-Elternteil-Paar eine
eigene `hosts`-Kante an, **Ketten funktionieren also von selbst**: Pod →
Node → Hypervisor → Switch sind drei unabhängige Kanten.

Zu klären wäre eher: reicht ein Freitext-Tag, oder braucht es eine automatische
Ableitung aus den Cloud-/Kubernetes-Templates? Und wie verhindert man, dass 400
Pods die Karte unlesbar machen — Zusammenfalten je Node?

**Erster Schritt ist ein Versuch, kein Feature:** ein paar Hosts mit
`nt:parent` verketten und sehen, wie es sich anfühlt.

### Optical Metrics (SFP DDM)

RX/TX Optical Power, Temperatur, Warnbereiche.

**Die heikelste Datenquelle auf der ganzen Liste.** Es gibt zwar die
ENTITY-SENSOR-MIB (`entPhySensorValue`), aber die Zuordnung Sensor → Port ist
herstellerspezifisch, und viele Geräte liefern DDM nur über eigene MIBs
(`CISCO-ENTITY-SENSOR-MIB` und Verwandte, bei anderen völlig anders benannt).
Die Warnbereiche kommen teils gar nicht per SNMP.

Gleiche Klasse wie VLAN: **erst messen, dann planen.** Ohne eine Probe auf
echten Geräten ist jede Aufwandsschätzung geraten.

### PoE-Budget je Switch

Gesamtbudget und Verbrauch: `pethMainPsePower` und `pethMainPseUsagePower` aus
derselben POWER-ETHERNET-MIB wie die Port-Leistung. **Standard-MIB, zwei
Items** — der kleinste Punkt in diesem Abschnitt. Gehört zusammen mit dem
PoE-Wert je Port erledigt, nicht getrennt.

### Historie / Topology-Snapshots

„Wie sah das Netz gestern um 14:00 aus?" Der Diff ist heute **flüchtig** (APCu,
weg beim php-fpm-Neustart). Persistenz heißt ein Datenmodell — der größte
Brocken der Liste.

Nicht zu verwechseln mit `diff-mode.js`: das macht einen **Host**-Snapshot
(neu/weg/Severity) im localStorage, nicht **Kanten** über Zeit.

### Hierarchie-Layout (Core → Distribution → Access)

Keine Layout-Frage, sondern eine Erkennungsfrage: woran erkennt man die Rolle?
Nachbarzahl, `nt:parent`, Gerätetyp, Namensmuster? Ohne belastbare Heuristik
wird es Raten mit hübscher Anordnung.

### Rollen/Berechtigungen für geteilte Layouts

Greift in die Zwei-Ebenen-Logik ein, die `ci:layers` bewacht, und in Zabbix'
eigenes Rechtemodell. Hoher Aufwand, macht die Logik dauerhaft komplizierter.

### Undo/Redo

Klingt klein, ist es nie: Befehlsstapel über alles Editierbare, und dieselbe
Zustandsverwaltung, an der gerade die Konflikterkennung gescheitert ist. Erst
die Revisionslogik im Alltag beobachten.

---

## Nachmessen, nicht neu bauen

Drei Dinge waren heute gebaut, sahen richtig aus **und wirkten nicht**: die
Konflikterkennung (Template reichte `revisions` nicht durch), die Positionen
beim Preset-Anwenden (schrieben in einen Schlüssel, den nur die Migration
liest), und das Layout im Topologie-Widget (zwei Layouts rannten gegeneinander).
Alle drei fielen erst auf, als jemand sie im Betrieb ansah.

Deshalb gehört zu jedem „ist schon da" ein Test, bevor es als erledigt gilt:

- **Rechte-Filterung geteilter Links** — `SharedLayerFilter` macht es für
  Positionen. Ob für Links dieselbe Lücke besteht, ist ungeprüft.
- **Teilweise importierte Anordnung** — liegt auf dem Server, die Karte legte
  im Test ein eigenes Layout darüber.

## Kleinigkeiten

- **Farbe ist oft der einzige Träger von Zustand.** Grüner Ring = OK, roter =
  kritisch. Für Rot-Grün-Schwäche unbrauchbar. Der Compliance-Tab macht es
  bereits richtig (✗ / i / ✓ **zusätzlich** zur Farbe) — der Beleg, dass es im
  Modul geht.
- **Sprachumschalter uneinheitlich.** README und CONTRIBUTING beginnen
  englisch, INSTALL und SECURITY deutsch. Ausgerechnet `INSTALL.md` führt eine
  neue Nutzerin mit Deutsch an.
- **Fullscreen:** Promise-Behandlung und Beschriftung sind repariert; **warum
  Chrome ablehnt**, ist ungeklärt.

[#2]: https://github.com/linuser/zabbix-network-topology/issues/2
[#3]: https://github.com/linuser/zabbix-network-topology/issues/3
[#4]: https://github.com/linuser/zabbix-network-topology/issues/4
