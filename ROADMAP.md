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
| **Export der Layouts als JSON** | **Fertig** (`layout-file.js`). Ein Knopf neben den Presets. **Der Import ist wieder ausgebaut** — siehe unten. |
| **Konflikterkennung bei gleichzeitigem Bearbeiten** | **Fertig, war aber wirkungslos.** Revisionen, `base`, `Revision::matches()`, Konfliktmeldung — das View-Template reichte `revisions` nur nicht durch. Behoben. |
| **Pfad zwischen zwei Hosts** | **Fertig** (`path-highlight.js`, 98 Zeilen). Kürzester Pfad per BFS, Auswahl über Kontextmenü „Pfad von hier" / „Pfad zu hier", alles außerhalb gedimmt, Pfadkanten fett-cyan. Eigene BFS-Implementierung mit begründetem Vorbehalt: Cytoscapes `bfs()` lieferte in der minifizierten Fassung `found:null` bei verbundenen Knoten. |
| **Unmanaged Devices** | **Fertig — heißen „Ghost Nodes"** (`build-elements.js`, §9). LLDP/CDP-Nachbarn, die auf keinen überwachten Host auflösen, aus `lldp_quality[].unmatched`. Mehrere Melder desselben Unbekannten ergeben **einen** Knoten mit mehreren Kanten. Umschalter „👻 Ghost nodes" im Technical-Tab, standardmäßig aus. |
| **Mini Map bei großen Topologien** | **Fertig** (`minimap.js`, 164 Zeilen). SVG unten rechts, severity-farbige Punkte, Viewport-Rechteck, Klick schwenkt die Karte, Aktualisierung auf zoom/pan (80 ms entprellt) plus alle 5 s. |
| **Cluster-Knoten zusammenfassen** | **Fertig** (`aggregation.js`, 106 Zeilen). `aggregateByGroup()` verschmilzt alle Hosts einer Gruppe zu einem Pseudo-Knoten, Kanten zwischen Gruppen werden zu Aggregat-Kanten. Reine Funktion ohne Seiteneffekte. Umschalter „🗂 Group". Nicht zu verwechseln mit `group-cluster-layout.js` — das ordnet Gruppen räumlich an, ohne zu verschmelzen. |
| **Presets (Positionen, Pins, Notizen, Links)** | Vorhanden. Achtung: Positionen wurden bis zur Korrektur still verschluckt, weil `applyPreset()` in den localStorage schrieb, den seit der Server-Umstellung nur noch die Migration liest. |

---

## Als Nächstes

### 1. Interface-Ansicht — Schritt 2

Schritt 1 ist mit `edge-detail.js` (5.3) gebaut: Klick auf eine Kante oeffnet
ein bleibendes Panel mit Ports, Traffic, Auslastung und Interface-Zustand.

**Offen sind die neuen Messwerte:** Errors, Drops und Link-Uptime aus
`ifInErrors`, `ifOutDiscards`, `ifLastChange` — Standard-OIDs, die praktisch
jedes Geraet liefert. Dazu Sparklines fuer RX/TX; die Action
`network.topology.spark` existiert fuer Knoten, ob sie sich auf Port-Items
umbiegen laesst, ist ungeprueft.

> **Vorbehalt, der beim Bauen nicht verschwunden, sondern sichtbar geworden
> ist:** die Zuordnung Port → Traffic setzt `lldpRemLocalPortNum == ifIndex`
> voraus. Das Panel schreibt deshalb an jede Zahl, ob sie am Port gemessen oder
> aus den Knotensummen geschaetzt ist. Mit eigenen Port-Items faellt der
> Unterschied noch staerker auf.


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

### 4. Layout-Import — neu entwerfen

Der Import war gebaut und ist wieder ausgebaut worden. Der Export bleibt: er
liest nur und löst bereits die Hälfte des Zwecks.

**Ein Defekt war schlimm und ist behoben:** fehlende Abschnitte in der Datei
löschten den jeweiligen Bestand, weil `{}` und `[]` truthy sind und die Wächter
in `applyPreset()` deshalb immer griffen. Eine Datei ohne Links rief
`setLinks([])` — bei einem Super-Admin **alle manuellen Verbindungen aller
Nutzer**, mit grüner Erfolgsmeldung. Ausgelöst schon von der minimalen gültigen
Datei.

**Drei stehen offen, alle mit derselben Wurzel:** der Apply-Pfad
(`applyPreset`, `setPositions`, `setLinks`) ist für **vollständige** Zustände
aus der laufenden Karte geschrieben, eine importierte Datei ist aber ein
beliebiger **Teil**zustand.

1. Der Re-Render speichert den live gerenderten Stand zurück
   (`layoutstop` → `savePositions`). Im **Cluster-Modus** — Standard ab zwei
   Hostgruppen — kommen die importierten Positionen gar nicht erst an und
   werden ~1,4 s später überschrieben.
2. Ein Super-Admin schreibt in die geteilte Ebene, und `setPositions()` ersetzt
   sie **komplett**. Zwölf importierte Knoten löschen die Positionen aller
   übrigen Hosts, für alle Nutzer.
3. `loadLinks()` mischt geteilte und persönliche Kanten, die Datei trägt die
   Ebene nicht mit, `setLinks()` schreibt alles in `defaultLinkScope()`. Aus
   privaten Kanten werden geteilte oder umgekehrt.

**Die eigentliche Frage vor jedem Code:** was heißt „importieren" bei einer
**geteilten** Karte — ersetzen oder zusammenführen? Solange die offen ist,
lässt sich Punkt 2 nicht sinnvoll beheben, nur verschieben.

Die ausgebaute Prüfung (`sanitizeLayout`, ~90 Zeilen mit den serverseitigen
Mustern und Grenzen) steht in der Git-Historie. Sie war **nicht** das Problem.

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

### MAC/FDB-Suche — „hängt an Switch X, Port Y"

MAC oder IP eingeben, Antwort: Zugangsswitch und Port. Im Support die Frage,
die man am häufigsten stellt.

**Warum das hierher gehört und nicht in ein Zabbix-Item:** eine MAC steht in der
FDB **jedes** Switches auf dem Pfad — bei jedem auf dem Uplink-Port. Eine
schlichte Abfrage liefert also fünf Treffer und keine Antwort. Brauchbar ist
allein der **Zugangsport**: der eine Switch-Port, auf dem die MAC steht und der
**kein** Uplink ist.

Genau diese Unterscheidung kann dieses Modul treffen und ein generisches Item
nicht: es weiß aus LLDP bereits, welche Ports Switch-zu-Switch gehen —
`lldp_ports[hid][port]` je Host, und jede Kante trägt `ports` für beide Enden.
Aus einem rohen FDB-Abzug wird damit eine Aussage.

**Datenquellen** (beides Standard-MIBs, keine Bitmasken wie bei VLAN):

- **BRIDGE-MIB** `dot1dTpFdbPort` (MAC → Bridge-Port), aufgelöst über
  `dot1dBasePortIfIndex` (Bridge-Port → ifIndex). Der zweite Schritt ist nötig
  und wird gern vergessen: Bridge-Port-Nummern sind **nicht** ifIndex.
- **ARP** für IP → MAC: `ipNetToMediaPhysAddress` (bzw.
  `ipNetToPhysicalPhysAddress`) vom Router, nicht vom Switch.

**Was bleibt schwierig:**

- FDB-Einträge altern (Standard 300 s). „Gefunden auf Port 18" ist immer eine
  Momentaufnahme und muss ihren **Zeitstempel** mitführen — sonst behauptet die
  Oberfläche Gegenwart, wo sie Vergangenheit meint.
- Bei mehreren MACs an einem Port (nachgelagerter unmanaged Switch, VMs hinter
  einem Hypervisor) ist der „Zugangsport" nicht eindeutig. Das muss die Anzeige
  sagen dürfen, statt sich auf einen festzulegen.
- Ohne LLDP auf einem Switch fehlt dessen Uplink-Kennzeichnung — dann fällt man
  auf „MAC steht auf diesen Ports" zurück. Kein Fehler, aber die Antwort ist
  schwächer, und das gehört gesagt.

**Erster Schritt:** ein `nt-fdb-probe.sh` nach dem Muster von
`tools/nt-lldp-probe.sh` — auf echten Switches messen, ob die BRIDGE-MIB
herausrückt und ob `dot1dBasePortIfIndex` gefüllt ist. Ein Nachmittag.

### Link Quality Score

Ein Wert je Kante aus Errors, Drops, Flaps, Speed und Auslastung — statt nur
Auslastung wie heute in der Weathermap.

**Zwei der fünf Eingangsgrößen liegen bereits vor:** `port_metrics` trägt `in`,
`out` und `speed`, die Weathermap rechnet daraus schon die Auslastung. Es
fehlen:

- **Errors und Drops** — `ifInErrors`, `ifOutDiscards`. Kommen ohnehin mit der
  Interface-Ansicht (Punkt 1, Schritt 2).
- **Flaps** — die einzige echte Neuerung. Ein Flap ist kein Messwert, sondern
  ein *Ereignis über Zeit*: `ifLastChange` beobachten oder Trigger-Historie
  auswerten. Das braucht eine Entscheidung über den Zeitraum („Flaps der
  letzten 24 h") und einen Ort, an dem der Verlauf liegt.

**Der Bauplan existiert schon — samt der Falle darin.** Der Health-Score macht
genau das für Hosts: gewichtete Faktoren (offline 40, stale 15, critical 25,
unacked 20), Schwellen [85, 65, 40], im UI als Zahl mit Farbband.

Diese Formel steht an **zwei** Stellen — im Hauptmodul und im Health-Widget,
weil Widgets den Modulcode nicht importieren können. Genau deshalb gibt es
`ci:parity`: laufen die auseinander, zeigt dieselbe Hostgruppe auf Karte und
Dashboard verschiedene Werte, und niemand weiß, welcher stimmt.

**Ein Link-Score würde denselben Weg gehen** — sichtbar auf der Karte, und
früher oder später auch in einer Kachel. Wer ihn baut, erweitert `ci:parity`
im selben Zug, nicht später.

### Firmware-/Modell-Abweichung

„7× Aruba 2930F, davon einer auf anderer Firmware." Nicht eine Regel, die
jemand pflegt, sondern eine **Abweichung von der Mehrheit** — genau die Form,
die im Alltag auffällt.

**Der Rahmen steht schon.** Der Compliance-Tab hat sieben Prüfungen (SNMP v1/v2c,
SNMP v3, Agent ohne TLS, kein Proxy, Inventory aus, kein Standort, kein
Template, veraltetes kritisches Problem, Wartung ohne Kommentar), eine Aggregat-
zeile und eine Matrix je Host. Eine achte einzuhängen ist Fleißarbeit, kein
Umbau.

**Was fehlt, ist eine Zeile in der API-Abfrage.** `NetworkTopologyCompliance`
holt heute `selectInventory => ['location_lat', 'location_lon', 'location']`.
Zabbix führt daneben `model`, `serialno_a`, `hardware`, `software`,
`software_full`, `os` und `os_full` — alles, was gebraucht wird, und für viele
Netzwerkgeräte füllt das offizielle Template diese Felder automatisch.

**Der interessante Teil ist die Auswertung, nicht die Erhebung:**

- Gruppieren nach `model`, dann innerhalb der Gruppe die Firmware vergleichen.
  Mehrheit = Soll, Abweichler = Befund.
- Ab welcher Gruppengröße lohnt die Aussage? Bei zwei Geräten mit zwei
  Versionen gibt es keine Mehrheit — dann ist es kein Befund, sondern eine
  Beobachtung.
- Versionsstrings sind Freitext (`WC.16.10.0021`). Ein Vergleich auf
  Gleichheit trägt; ein Vergleich auf „neuer als" trägt nicht ohne
  herstellerspezifisches Parsen. **Bei Gleichheit bleiben.**
- Leere Felder sind kein Verstoß. Ein Gerät ohne ausgelesene Firmware ist
  unbekannt, nicht abweichend — die bestehenden Prüfungen unterscheiden das
  bereits über die Stufen bad/info/good.

Mit ARP/FDB und der Interface-Ansicht zusammen ist das der kleinste Posten in
diesem Abschnitt.

### VPN-Overlay

IPsec/WireGuard/OpenVPN als logische Kanten über der physischen Topologie.

**Dasselbe Grundproblem wie BGP/OSPF** (siehe dort), deshalb gehören beide
zusammen entschieden: der gesamte Renderpfad nimmt an, **eine Kante ist ein
Kabel**. Weathermap, Pfad-BFS, Root Cause und What-if hängen alle daran. Ein
zweiter Kantentyp berührt alle vier — und bei Root Cause wäre es sogar falsch,
ihn mitzurechnen: ein Tunnel fällt aus, *weil* die Leitung darunter ausfällt,
nicht unabhängig davon.

Wenn ein zweiter Kantentyp kommt, dann einmal und für beide — mit einer
klaren Regel, welche Analysen welchen Typ sehen.

Datenseitig ist VPN dazu heterogener als Routing: WireGuard hat keine
Standard-MIB, IPsec je nach Gerät `IPSEC-FLOW-MONITOR-MIB` oder Herstellereigenes,
OpenVPN meist gar kein SNMP. In der Praxis liefe es auf Zabbix-Items je
Plattform hinaus und nicht auf eine gemeinsame Quelle.

### LLDP-Qualitaet — was davon noch offen ist

Aus einem groesseren Vorschlagspaket von christos-diamantis. Zwei Punkte sind
gebaut, mehrere geprueft und verworfen (siehe „Geprueft und verworfen" unten).
Was bleibt:

**Confidence-Score.** Aufbauend auf `reporters`/`confirmed` (5.3). Die
Rohsignale liegen vor: `matched`, `ambiguous` mit Kandidatenliste, `unmatched`,
Ports, Melder. Wichtiger als die Skala ist, wofuer sie da ist — eine
Normalisierungsschicht fuer Port-IDs (`Gi1/0/1` ↔ `GigabitEthernet1/0/1`)
erzeugt zwangslaeufig Fehltreffer, und **eine falsche Kante ist schlimmer als
eine fehlende**, weil sie wie eine Messung aussieht. Mit einem Score daneben
wird aus dem Risiko eine Auskunft. Also Score zuerst, Normalisierung danach.

**Alterung / stale neighbors.** Verschwundene Nachbarn nicht sofort loeschen,
sondern befristet als `stale` fuehren — sonst springt die Topologie bei kurzen
LLDP-Aussetzern. Gehoert mit „Topology-Diff auf der Karte" zusammen gebaut:
derselbe Diff, dieselbe offene Frage, wie lange etwas sichtbar bleibt.

**Chassis-Subtype und Management-Address.** `lldpRemChassisIdSubtype` und
`lldpRemManAddr` werden nicht erhoben — nachgesehen, null Treffer. Ohne den
Subtype ist jede Chassis-ID-Normalisierung Raten; ohne `lldpRemManAddr` gibt es
keine Management-IP zum Abgleichen. Beides heisst Template-Aenderung und
Re-Import bei jedem Nutzer, ist also die Vorbedingung fuer alles, was darauf
aufbaut.

### Soll gegen Ist — das Fundament liegt schon

Eine erwartete Verkabelung gegen die gemessene halten:

    🔴 Topology deviation
       SW02 expected on Core01
       actual: SW01 / Gi1/0/47

Fuer Verkabelungsfehler, versehentlich umgesteckte Kabel und Arbeiten von
Fremdfirmen die nuetzlichste Auskunft, die diese Karte geben koennte.

**Der Erklaerungsmechanismus existiert bereits:** `nt:parent` ist eine von Hand
eingetippte Soll-Beziehung, validiert im `HostTagParser`, von `parentEdges()`
zu Kanten gemacht. Heute werden diese Kanten mit den gemessenen
**zusammengefuehrt** (`array_merge`, `NetworkTopologyData:432`) — das Feature
besteht darin, sie stattdessen zu **vergleichen**. Kein neuer Speicher, keine
Oberflaeche zum Erklaeren:

    erklaert und gemessen        ✓
    erklaert, nicht gemessen     ⚠ erwartet, aber nicht gesehen
    gemessen, nicht erklaert     ⚠ da, aber nirgends dokumentiert

**Deckt sich mit der NetBox-Drift** — dort ist die Soll-Quelle extern, hier
lokal, die Auswertung ist dieselbe. Ein Mechanismus mit mehreren Soll-Quellen,
nicht zwei Vergleiche nebeneinander.

Offen: `nt:parent` beschreibt Traeger-Beziehungen (VM → Hypervisor), also nicht
zwangslaeufig Verkabelung, und kennt keinen Port.

### LLDP-Test-Bibliothek

Anonymisierte echte SNMP-Ausgaben verschiedener Hersteller als Fixtures, gegen
die jeder Parser laeuft — damit ein Fix fuer Aruba nicht Cisco bricht.

**Die Form ist billig:** eine Fixture ist eine Liste von Item-Zeilen (`hostid`,
`key_`, `lastvalue`, `src`) — genau das, was `LldpEdgeBuilderTest` schon von
Hand aufbaut. Ein Verzeichnis mit JSON-Dateien und eine Schleife darueber.

**Teuer ist das Beschaffen**, und dafuer gibt es seit 5.3 den Geraetebericht.
Damit schliesst sich ein Kreis: Meldung → Fixture → Regressionstest. Wer ein
Geraet meldet, macht es dauerhaft testbar, statt eine Zeile in einer Tabelle zu
aendern.

### LLDP-Health als Zeile im LLDP-Q-Tab

    126 neighbors / 122 confirmed / 3 one-sided / 1 conflict
    87 % der Switches liefern LLDP

**Alle Zahlen liegen vor.** `lldp_quality` fuehrt je Host `matched`,
`unmatched` und `ambiguous` (= der „conflict"-Fall), `confirmed`/`one-sided`
sind seit 5.3 an jeder Kante, und der Geraetebericht rechnet die
Vollstaendigkeitsquote bereits aus. Darstellung, keine Datenbeschaffung.

Als Zeile im Tab ein Nachmittag. Als eigenes Widget faellt die ES5-Frage an
(siehe NT Neighbours) — den Aufwand ist es dafuer nicht wert.


### Dokumentationsdrift gegen NetBox

Die Integrations-Makros für NetBox gibt es schon (`{$NT.INT.NETBOX.URL}`), sie
setzen aber nur einen Link pro Host. Der eigentliche Wert liegt eine Stufe
weiter: **die Karte kennt die echte Verkabelung, NetBox die dokumentierte.**
Die Differenz — „NetBox sagt A–B, LLDP sagt A–C" — ist für einen Netzbetreiber
wertvoller als beide Datensätze einzeln.

**Was zuerst zu entscheiden ist, und es ist keine Codefrage:**

1. **Wo liegen die Zugangsdaten?** Ein NetBox-Token ist ein Geheimnis. Global-
   Makros können `{$SECRET}` sein, `module.config` ist es nicht — dort läge er
   im Klartext, und die Konfiguration geht bei jedem Seitenaufbau ins DOM. Das
   schließt den naheliegenden Weg aus.
2. **Wer fragt an?** Ein Aufruf aus dem Browser bräuchte CORS und legte den
   Token offen. Also serverseitig, also eine neue Action mit Rate-Limit — die
   sechste. Und sie ruft erstmals einen **fremden** Dienst; alles bisherige
   spricht nur mit Zabbix.
3. **Was ist der Vergleich?** NetBox-Kabel haben Interfaces, LLDP-Kanten haben
   Portnamen, und die stimmen nicht zwangsläufig überein (`Gi1/0/1` gegen
   `GigabitEthernet1/0/1`). Ohne Normalisierung meldet der Abgleich lauter
   Falschmeldungen und ist damit wertlos.

**Deshalb liegt es hier und nicht weiter oben.** Punkt 1 und 2 sind
Sicherheitsentscheidungen, Punkt 3 ist ein Haufen Fleißarbeit mit ungewissem
Ausgang. Als Kantentyp gedacht deckt es sich mit
[Nachbarschaft jenseits von LLDP/CDP](#nachbarschaft-jenseits-von-lldpcdp-ip-bgp-ospf-bridge)
— eine „dokumentiert, aber nicht gemessen"-Kante ist derselbe Fall wie eine
OSPF-Kante: eine Kante, die kein Kabel ist.

### NT Neighbours — Widget fürs Host-Dashboard

PR #8 hat den Hop-Radius serverseitig gebaut, Zabbix 7 hat Host-Dashboards. Ein
Widget, das **diesen einen Host plus einen Hop** zeigt, wäre die natürliche
Verlängerung: die Frage aus seinem PR — „show me this switch and what hangs off
it" — dort beantwortet, wo man den Switch ohnehin gerade anschaut.

**Warum es klein sein könnte:** keine neue Datenquelle. `HopScope` und die
`hostid`/`hops`-Parameter der Data-Action existieren; das Widget bräuchte nur
den Host aus dem Dashboard-Kontext zu ziehen.

**Warum es das vermutlich nicht ist, und das gehört vorher gesagt:**

- Widgets sind **ES5** und können den Code des Hauptmoduls nicht importieren.
  Der Rendercode für einen Graphen läge damit ein zweites Mal da — das
  Topologie-Widget zeigt, was das heißt: es hat seinen eigenen Layout-Fehler
  gehabt, den das Hauptmodul nie hatte.
- Ein sechstes Widget heißt eine sechste Kopie von `window.NtWidgetData`, die
  `ci:parity` byteweise bewacht.
- Der Host-Kontext eines Dashboards ist eine 7.4-Sache; auf 7.0 LTS liefe es
  nicht, wie alle Widgets.

**Zuerst zu klären:** reicht eine Liste statt eines Graphen? „Diese sechs
Nachbarn, mit Port und Auslastung" beantwortet dieselbe Frage, braucht kein
Cytoscape im Widget und macht die ES5-Dopplung auf ein Zehntel kleiner. Wenn
ja, ist es ein Nachmittag statt einer Woche.

### Network Insights als Widget

Deine Einordnung aus dem Feature-Block: **eher ein Widget als ein Tab.** Eine
Kachel, die die Karte nicht zeichnet, sondern über sie berichtet — was sich
seit gestern geändert hat, welche Kante am meisten Last trägt, wo LLDP-Nachbarn
verschwunden sind.

Das passt zum Dashboard, nicht zur Vollbildkarte, und es ist der einzige
Vorschlag aus der Sammlung, der **keinen** neuen Datenpfad braucht: alles, was
er anzeigen würde, liegt schon in `NetworkTopologyData`.

Zu beachten: Widgets sind **ES5** und können den Code des Hauptmoduls nicht
importieren. Was hier an Auswertung entsteht, entsteht ein zweites Mal — und
`ci:parity` will dann wissen, welche Stelle die Vorlage ist.

### PoE je Port

`pethPsePortActualPower` aus der POWER-ETHERNET-MIB. Kleines, klar umrissenes
Item — passt am besten als Zeile **in die Interface-Ansicht** (Punkt 1), nicht
als eigenes Feature.

### Nachbarschaft jenseits von LLDP/CDP (IP, BGP, OSPF, Bridge)

Ein zweiter Graph über denselben Knoten: Nachbarschaften statt Kabel. Datenquelle
wäre die BGP4-MIB (`bgpPeerState`) beziehungsweise OSPF-MIB.

Der Aufwand steckt nicht im Einsammeln, sondern in der Umschaltung: der ganze
Renderpfad geht heute davon aus, dass eine Kante ein Kabel ist — Weathermap,
Pfad-BFS, Root Cause, What-if. Ein zweiter Kantentyp berührt alle vier.

**christos-diamantis hat das am 2026-09-02 als eigenen Backlog-Punkt genannt**
und dabei breiter gefasst als dieser Eintrag: IP, BGP, OSPF **und Bridge**. Er
schätzt es selbst als „huge work" ein, will erst nachdenken und sich melden,
wenn er eine Idee oder ein MVP hat.

**Zwei Dinge, die er wissen sollte, bevor er entwirft:**

1. **Die Naht existiert schon.** Jede Kante trägt `src: ['lldp']` oder
   `['cdp']` (`build-elements.js`) — eine Vorstellung davon, *woher* sie kommt,
   ist da, und das Kanten-Panel zeigt sie seit 5.3 an. `src: ['ospf']` wäre die
   Erweiterung; eine Parallelstruktur daneben wäre der teure Weg.
2. **Die Gabelung, die früh zu entscheiden ist:** zweiter Graph zum
   *Umschalten*, oder zusätzliche, *typisierte* Kanten im selben Graphen? Davon
   hängt ab, ob die vier oben genannten Verbraucher einen Filter bekommen oder
   eine zweite Codebahn. Spät entschieden wird das teuer.

**Überschneidungen im Blick behalten:** „IP" (ARP/Nachbarn) liegt neben
[MAC/FDB-Suche](#macfdb-suche--hängt-an-switch-x-port-y), „Bridge" (STP) neben
der VLAN-Ansicht. Drei Einträge, ein Thema — wer hier anfängt, sollte alle drei
gelesen haben.

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

### Progressives Rendern bei 1000+ Hosts

**Teilweise vorhanden, aber nicht dasselbe.** Es gibt einen Performance-Modus,
der **ab 400 Knoten automatisch** greift (`PERF_THRESHOLD` in `render-tech.js`,
per „⚡ Performance" auch manuell): keine gerenderten Icons mehr (Farbe und Rand
statt Bild), kleinere Knoten, Labels erst ab stärkerem Zoom, keine
Layout-Animation.

Das ist **billiger zeichnen, nicht schrittweise zeichnen**. Ein progressives
Rendern würde in Häppchen aufbauen — erst die Struktur, dann Details — und die
Oberfläche zwischendurch bedienbar halten.

**Vor dem Bauen zu klären: reicht der Performance-Modus?** Die Schwelle von 400
ist gesetzt, nicht gemessen, und niemand hier hat eine Installation mit 1000+
Hosts. Ohne eine solche Messung wäre progressives Rendern eine Lösung für ein
unbelegtes Problem — die Testinstanz lässt sich mit 1500 Attrappen-Hosts füllen,
das wäre der ehrliche erste Schritt.

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

## Geprueft und verworfen

Vorschlaege, die einzeln geprueft und **nicht** weiterverfolgt werden. Sie
stehen hier mit dem Grund, damit sie nicht alle paar Monate neu aufkommen — und
damit sichtbar bleibt, dass sie angesehen und nicht ueberlesen wurden.

| Vorschlag | Warum nicht |
|---|---|
| **MIB-Auto-Erkennung** (Cisco-, Aruba-, Extreme-Varianten selbst erkennen) | Falsche Schicht. Das Modul spricht kein SNMP — `LldpEdgeBuilder` liest `lastvalue` und `key_`, nie eine OID. Welche MIB abgefragt wird, entscheidet das Template. Der Wunsch heisst „mehr Templates". |
| **Hostname-Zuordnung „automatisch lernen"** | Eine gelernte falsche Zuordnung ist klebrig: sie ueberlebt die Korrektur der Ursache und verliert ihre Herkunft. Mit einem Confidence-Score festhalten, WIE zugeordnet wurde, statt DASS. Der FQDN-/Kurznamen-Teil laeuft ohnehin seit jeher. |
| **Neighbor Inventory Cache** | Erst messen. Response-Cache und Baseline gibt es seit 5.1.0; der Verdacht ist, dass die Zeit an den Zabbix-API-Aufrufen haengt und nicht am Kantenbauen. Dann braeuchte es ihn nicht. |
| **Stabilitaets-Score ueber 30 Tage** | Nicht selbst speichern. Zabbix IST eine Zeitreihen-Datenbank, und `tools/topo-change-sender.sh` schiebt Aenderungen bereits als Items dorthin — dann liefert Zabbix Auswertung, Trends und Trigger ohne eine Zeile Speicher-Code. |
| **Port-ID-Normalisierung als eigener Schritt** | Nicht vor dem Confidence-Score. Sie erzeugt zwangslaeufig Fehltreffer, und eine falsche Kante ist schlimmer als eine fehlende — sie sieht aus wie eine Messung. |
| **Raw-LLDP-Inspector** (alle TLVs je Kante) | Die Roh-TLVs liegen nicht vor; erhoben werden gezielte OIDs. Dieselbe Vorbedingung wie beim Chassis-Subtype, und ueberschneidet sich mit dem Vendor Debug Profile. |
| **LLDP-MED, VLAN, LAG** (Voice-VLAN, PVID, Aggregation, MTU) | Fachlich reizvoll, aber durchweg neue SNMP-Items: mehr Polling, wieder ein Template-Re-Import, und VoIP ist eine andere Zielgruppe als der Rest der Karte. Steht hinter allem, was mit vorhandenen Daten auskommt. |
| **Vendor Debug Profile mit Rohwerten** | Nicht in dieser Form: die Werte sind Nachbarnamen aus dem Netz des Nutzers. Falls doch, dann als **Form** statt Wert — Schluesselname, Laenge, maskiertes Zeichenmuster, erkannter Subtype. Das beantwortet „dieser Hersteller schreibt eine MAC in die PortId", ohne einen Namen preiszugeben. |


## Nachmessen, nicht neu bauen

Drei Dinge waren heute gebaut, sahen richtig aus **und wirkten nicht**: die
Konflikterkennung (Template reichte `revisions` nicht durch), die Positionen
beim Preset-Anwenden (schrieben in einen Schlüssel, den nur die Migration
liest), und das Layout im Topologie-Widget (zwei Layouts rannten gegeneinander).
Alle drei fielen erst auf, als jemand sie im Betrieb ansah.

Deshalb gehört zu jedem „ist schon da" ein Test, bevor es als erledigt gilt:

- ~~Rechte-Filterung geteilter Links~~ — **geprüft, keine Lücke.**
  `SharedLayerFilter::links()` existiert und wird in `NetworkTopologyView`
  benutzt: eine geteilte Kante überlebt nur, wenn beide Endpunkte sichtbare
  Hosts sind oder einer davon ein Ghost ist. Es leckt keine fremde Host-ID.
- **Teilweise importierte Anordnung** — liegt auf dem Server, die Karte legte
  im Test ein eigenes Layout darüber.

## Kleinigkeiten

- **Farbe ist oft der einzige Träger von Zustand.** Grüner Ring = OK, roter =
  kritisch. Für Rot-Grün-Schwäche unbrauchbar. Der Compliance-Tab macht es
  bereits richtig (✗ / i / ✓ **zusätzlich** zur Farbe) — der Beleg, dass es im
  Modul geht.

- **Wartung und Offline sind beide ein ✕, unterschieden nur durch die Farbe.**
  Am 2026-09-02 an einem Knoten auf der Wegwerf-Instanz aufgefallen, nicht
  gemeldet. Drei Aussagen stehen nebeneinander:

  | | zeigt |
  |---|---|
  | `icons.js:217` Kommentar | „Schraubenschlüssel-Glyph (vereinfacht)" |
  | `icons.js:220` Pfad | `M-5,-5 L5,5 M-5,5 L5,-5` — **ein ✕** |
  | `icons.js:160` Offline | „Rotes X als klarer Offline-Indikator" |
  | `legend.js:123` Legende | ein gedimmtes **◐** |

  Die „Vereinfachung" hat den Schraubenschlüssel so weit vereinfacht, dass
  nichts davon übrig ist. Damit tragen zwei verschiedene Zustände dasselbe
  Zeichen, und was sie trennt, ist orange gegen rot — ausgerechnet die Paarung,
  die bei Rot-Grün-Schwäche am ehesten zusammenfällt. Der Punkt darüber ist hier
  also nicht theoretisch.

  Der ◐ in der Legende kommt auf der Karte überhaupt nicht vor; gemeint war
  vermutlich „der Knoten ist gedimmt".

  **Dieselbe Fehlerklasse wie Issue #9** — die Legende beschreibt etwas anderes
  als das, was gezeichnet wird —, nur bei den Knoten statt bei den Kanten. Fix:
  ein eindeutiges Glyph für Wartung, und die Legende auf das umstellen, was
  wirklich zu sehen ist (Ring **und** Badge). Danach ist ✕ wieder eindeutig
  Offline. Bewusst auf das nächste Bündel geschoben, nicht auf eine 5.2.1.
- **Fullscreen:** Promise-Behandlung und Beschriftung sind repariert; **warum
  Chrome ablehnt**, ist ungeklärt.

[#2]: https://github.com/linuser/zabbix-network-topology/issues/2
[#3]: https://github.com/linuser/zabbix-network-topology/issues/3
[#4]: https://github.com/linuser/zabbix-network-topology/issues/4
