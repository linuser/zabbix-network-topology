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
| **Pfad zwischen zwei Hosts** | **Fertig** (`path-highlight.js`, 119 Zeilen). Kürzester Pfad per BFS, Auswahl über Kontextmenü „Pfad von hier" / „Pfad zu hier", alles außerhalb gedimmt, Pfadkanten fett-cyan. Eigene BFS-Implementierung mit begründetem Vorbehalt: Cytoscapes `bfs()` lieferte in der minifizierten Fassung `found:null` bei verbundenen Knoten. |
| **Unmanaged Devices** | **Fertig — heißen „Ghost Nodes"** (`build-elements.js`, §9). LLDP/CDP-Nachbarn, die auf keinen überwachten Host auflösen, aus `lldp_quality[].unmatched`. Mehrere Melder desselben Unbekannten ergeben **einen** Knoten mit mehreren Kanten. Umschalter „👻 Ghost nodes" im Technical-Tab, standardmäßig aus. |
| **Mini Map bei großen Topologien** | **Fertig** (`minimap.js`, 164 Zeilen). SVG unten rechts, severity-farbige Punkte, Viewport-Rechteck, Klick schwenkt die Karte, Aktualisierung auf zoom/pan (80 ms entprellt) plus alle 5 s. |
| **Cluster-Knoten zusammenfassen** | **Fertig** (`aggregation.js`, 106 Zeilen). `aggregateByGroup()` verschmilzt alle Hosts einer Gruppe zu einem Pseudo-Knoten, Kanten zwischen Gruppen werden zu Aggregat-Kanten. Reine Funktion ohne Seiteneffekte. Umschalter „🗂 Group". Nicht zu verwechseln mit `group-cluster-layout.js` — das ordnet Gruppen räumlich an, ohne zu verschmelzen. |
| **Parallele Links / LAG** | **Fertig in 5.4.0** (`parallel-links.js`, `LldpEdgeBuilder::findMember()`). Ein Kabel = eine Kante, je eigene Ports, Zähler und Zustand. Hineingezoomt aufgefächert, in der Übersicht zu einer Linie mit ×N zusammengeklappt. Beigesteuert von Christos Diamantis, [#21](https://github.com/linuser/zabbix-network-topology/pull/21). Siehe Punkt 6 unten. |
| **Presets (Positionen, Pins, Notizen, Links)** | Vorhanden. Achtung: Positionen wurden bis zur Korrektur still verschluckt, weil `applyPreset()` in den localStorage schrieb, den seit der Server-Umstellung nur noch die Migration liest. |
| **Link-Uptime** | **Fertig** (`HostMetadata::linkUptime`, `NetworkTopologyData` holt `ifLastChange`+`sysUpTime`). Opportunistisch: zeigt sich nur, wo ein Template die OIDs sammelt — kein erzwungener Re-Import. Stand früher als „offen" unter Punkt 1. |
| **Sparklines für RX/TX je Port** | **Fertig** (`edge-detail.js` `portSparkline`, Action `network.topology.spark`). RX/TX-Kurve unter jeder Port-Zeile im Kanten-Panel, nachgeladen. Stand früher als „offen" unter Punkt 1. |
| **NetBox-Export** | **Fertig** (`netbox.js` `buildNetboxCsv`, Menüeintrag neben GraphML). Kabelliste im NetBox-Importformat, die vier Regeln umgesetzt (nur beidseitige Ports, nur gemessen/konfident, `_ntRawNodes` statt gerenderter Karte, Gerätenamen), übersprungene Zeilen gezählt. Siehe Punkt 5 unten für die Begründung. |

---

## Als Nächstes

### 1. Interface-Ansicht — Schritt 2 — ERLEDIGT (Kanten-Panel, Errors/Drops, Portnamen, Link-Uptime, RX/TX-Sparklines; offen nur der dokumentierte Port→Traffic-Vorbehalt)

Schritt 1 ist mit `edge-detail.js` (5.3) gebaut: Klick auf eine Kante oeffnet
ein bleibendes Panel mit Ports, Traffic, Auslastung und Interface-Zustand.

**Errors und Drops sind seit 5.3 drin** — `ifInErrors` und `ifOutDiscards`
werden je Port ausgewertet und im Kanten-Panel angezeigt, nicht mehr als
Host-Summe. Ebenfalls dazugekommen: Portnamen aus `ifName`/`ifDescr`/`ifAlias`
statt nackter Indizes.

**Die zwei zuletzt offenen Punkte sind inzwischen gebaut (jetzt oben in „Bereits
vorhanden"):**

- **Link-Uptime** aus `ifLastChange` + `sysUpTime` — `HostMetadata::linkUptime`
  rechnet sie in Sekunden aus, `NetworkTopologyData` holt die OIDs
  **opportunistisch** (nur wo ein Template sie sammelt, sonst bleibt die Zeile
  leer). Damit entfaellt der erzwungene Re-Import, der der eigentliche Grund fuer
  den Aufschub war.
- **Sparklines fuer RX/TX je Port** — `edge-detail.js` `portSparkline` haengt die
  RX/TX-Kurve unter jede Port-Zeile, nachgeladen ueber `network.topology.spark`.
  Die Frage „laesst sie sich auf Port-Items umbiegen" ist damit mit ja
  beantwortet.

> **Vorbehalt, der beim Bauen nicht verschwunden, sondern sichtbar geworden
> ist:** die Zuordnung Port → Traffic setzt `lldpRemLocalPortNum == ifIndex`
> voraus. Das Panel schreibt deshalb an jede Zahl, ob sie am Port gemessen oder
> aus den Knotensummen geschaetzt ist. Mit eigenen Port-Items faellt der
> Unterschied noch staerker auf.


### 2. SLA-Bezug auf der Karte — ERLEDIGT (5.5.63)

Wenn in Zabbix **Services mit SLA** hinterlegt sind, zeigt die Karte, welche
Hosts SLA-relevant sind — eine andere Frage als die Severity: nicht "wie
schlimm", sondern "kostet es etwas".

**Gebaut als KPI-Pille, Detail-Badge und Karten-Filter** (magenta
`SLA-relevant` neben den Problem-Pillen; Klick filtert auf die betroffenen
Hosts; das Detail-Panel nennt den Service + sein SLO). Der Weg ist ein **Join
auf die Event-ID**, kein Nachbau der Service-Auswertung: `service.get` mit
`selectProblemEvents` gibt je Service die betroffenen Events, die Karte kennt
Host je Event — `topology/SlaResolver.php`, rein und getestet. `sla.get` liefert
das SLO-Ziel ueber Service-Tags.

**Zwei alte Sorgen, beide ausgeraeumt.** Der Platz: nichts am Knoten (der traegt
schon sieben Signale), sondern eine Zeile in der KPI-Leiste + das Detail-Panel —
genau der Satz, den ein Verantwortlicher wissen will, ohne einen Millimeter auf
der Karte. Die Pruefbarkeit (es gab lange null Services/SLAs auf den Instanzen):
auf einer echten **Zabbix-8.0**-Instanz end-to-end nachgemessen — ein Service
"Checkout" mit SLA band sich an das Problem eines Hosts, die Data-Action gab ihn
als SLA-relevant mit SLO 99,9 aus. Das devnet-Fixture dafuer liegt in
`tools/devnet/erzeuge-sla.py`.

### 3. Zabbix 8 — ERLEDIGT (auf 8.0rc1 verifiziert)

Guard (`nt-assign-guard.js`) ist auf main. Der ursprüngliche **Blocker ist weg**:
seit 10/2026 läuft eine eigene **Zabbix-8.0rc1-Test-VM** (Proxmox, Debian 12 +
PG15), auf der Modul **und** Widgets ausgerollt und geprüft sind — die Karte
rendert, der xor-Guard greift (Cytoscape lud auf 8.0 sonst nicht, weil
`Array.prototype.xor` dort read-only ist). Seither ist die VM ein reguläres
Deploy-Ziel und bekommt jede Release mit.

**Offen bleibt nur das Laufende:** 8.0 bis zur finalen Version weiter
gegenprüfen (neue RCs), und die 8.0-spezifischen API-/Makro-Chancen bewerten
(eigener Punkt, wenn konkret).

**Non-SQL-History — erledigt (5.5.28, #26).** Zabbix 8 kann History per
`HistoryProvider=clickhouse` (oder seit jeher Elasticsearch) außerhalb der
SQL-`history*`-Tabellen ablegen. `NetworkTopologyData::fetchLastValues()` las die
letzten Werte **direkt per SQL** (schneller Fenster-Scan) — bei einem Nicht-SQL-
Provider sind diese Tabellen leer, also `lastvalue=null` für jedes Item: Karte
ohne Kanten und ohne Metriken. Jetzt läuft der Last-Value-Lesepfad pro value_type
über die Frontend-Abstraktion `Manager::History()->getLastValues()` (dieselbe, die
die Zabbix-UI nutzt); der schnelle Direkt-SQL-Scan bleibt für value_types, die in
SQL liegen. Gemeldet von christos-diamantis (#26), auf einer echten
**Zabbix-8.0rc1-VM mit ClickHouse** reproduziert und verifiziert.

### 4. Layout-Import — ERLEDIGT (5.5.64), zusammenführend statt ersetzend

Der ⬆-Import ist zurück, neben dem ⬇-Export. Eine Layout-Datei (Positionen,
Pins, Notizen, manuelle Kanten) reist wieder von Browser zu Browser, Gerät zu
Gerät, Instanz zu Instanz.

**Die Kernfrage war: ersetzen oder zusammenführen? — Zusammenführen.** Damit
fallen alle drei Apply-Pfad-Defekte und der schlimme vierte (eine Teildatei
löschte Bestand, weil `{}`/`[]` truthy sind) **strukturell** weg, statt
umschifft zu werden:

- **Positionen** überlagern pro Knoten, **Links** als Vereinigung, Pins union,
  Notizen überlagern — eine Teildatei kann nie löschen (`overlayPositions`/
  `unionLinks`, rein und getestet; `mergePositions`/`mergeLinks` in `storage.js`).
- Geschrieben wird die **Default-Ebene** des Nutzers (Super-Admin → geteilt =
  „veröffentlichen", mit Bestätigung die den Umfang nennt; sonst persönlich).
  Defekt 2 (Super-Admin überschreibt die geteilte Ebene komplett) und Defekt 3
  (Ebenen-Verwechslung) sind damit gegenstandslos.
- Defekt 1 (der `layoutstop`-Save überschrieb den Import im Cluster-Modus) ist
  über ein einmaliges Skip-Flag behoben. Im Cluster-Modus ordnet das adaptive
  Layout die Karte weiter selbst; der Import ist gespeichert und erscheint bei
  „Raster aus", worauf der bestehende `cluster.overrides_positions`-Hinweis zeigt.
- Die alte `sanitizeLayout`-Prüfung kam unverändert zurück (sie war **nie** das
  Problem). Preset-Pfad (ersetzen) bleibt unberührt.

Live auf einer Produktiv-Instanz abgenommen (Merge gewinnt, der zwischendurch verschobene
Knoten bleibt).

### 5. NetBox-Export — Kabelliste im NetBox-Importformat — ERLEDIGT

> **Gebaut** (`netbox.js` `buildNetboxCsv`, Menüeintrag neben GraphML in
> `export.js`). Die vier Regeln unten sind umgesetzt, übersprungene Zeilen werden
> gezählt und im Dialog gemeldet. Der folgende Text bleibt als **Begründung**
> stehen, warum es so und nicht anders gebaut wurde.

Nutzerwunsch vom September 2026. Die Gegenrichtung zur
[Dokumentationsdrift gegen NetBox](#dokumentationsdrift-gegen-netbox) weiter
unten — und deutlich billiger, weil sie deren zwei Sicherheitsfragen gar nicht
erst stellt.

**Die Idee:** das Modul schreibt eine CSV-Datei im Kabel-Importformat von
NetBox, der Admin spielt sie in NetBox über *Import* ein. Kein Token, keine
Verbindung zu NetBox, keine neue Action — die Datei entsteht im Browser, wie
die GraphML-Datei.

**Nachgesehen, was schon da ist:** `graphml.js` gibt pro Kante bereits
`sourceport`, `targetport`, `protocol`, Kapazität und Verkehr aus. Die Ports
stammen aus `edge.ports` (`{hostid: port}` — Lokalport am Melder, Remote-Port am
Nachbarn). Eine NetBox-CSV ist im Kern dieselbe Kantenliste in anderer Form:
Gerät und Interface je Seite, dazu Status und Beschreibung. Die genauen
Spaltennamen vor dem Bau gegen die eingesetzte NetBox-Version prüfen, nicht aus
dem Gedächtnis schreiben.

**Vier Regeln, ohne die der Export mehr schadet als nützt:**

1. **Nur Kanten mit Port auf beiden Seiten.** UniFi-Uplinks (`uplink.id`),
   manuelle Verbindungen und `nt:parent`-Kanten haben keinen Port und können
   kein Kabel werden. Überspringen und im Dialog zählen, nicht still weglassen.
2. **Nur gemessene, sichere Kanten.** Ein Kabel in NetBox ist eine
   Tatsachenbehauptung; ein falsches schadet mehr als ein fehlendes. Beidseitig
   bestätigt oder oberhalb einer Konfidenzschwelle, Quelle und Konfidenz in die
   Beschreibung.
3. **Rohdaten, nicht die gerenderte Karte.** GraphML exportiert, was zu sehen
   ist — in der Gruppenansicht also Gruppenknoten. Für eine Zeichnung richtig,
   für NetBox falsch. Genau dieser Fehler stand bis 5.3.1 in den Berichten
   (`window._ntNodes` statt `_ntRawNodes`).
4. **Gerätenamen.** Sie müssen zu NetBox passen, und `sw01` gibt es bei jedem
   Kunden ([#14](https://github.com/linuser/zabbix-network-topology/issues/14)).
   Ob NetBox je Seite einen Standort zur Unterscheidung annimmt, beim Bau
   prüfen; er könnte aus einem Host-Tag kommen. Für eine erste Fassung optional.

**Die Nebenwirkung ist mehr wert als die Datei:** NetBox prüft beim Import jede
Zeile selbst — unbekanntes Gerät, unbekanntes Interface, Interface schon belegt.
Der erste Import ist damit ein Abgleich gegen die Dokumentation, ohne dass das
Modul etwas vergleicht. Und er zeigt mit echten Daten, wie gut Geräte- und
Portnamen zwischen beiden Welten zusammenpassen — Frage 3 der Drift, beantwortet,
bevor jemand den Vergleich baut.

**Aufwand:** reines Frontend, ein Menüeintrag neben GraphML, kein Backend, keine
Zugangsdaten. Etwa ein Tag mit Tests. Die Portnamen sind erst seit 5.3.1
verlässlich: `ifName`, `ifDescr` und `ifAlias` wurden vorher gar nicht
abgefragt.

### 6. Parallele Verbindungen (LAG) — erledigt in 5.4.0

Gemeldet von Christos Diamantis in
[#20](https://github.com/linuser/zabbix-network-topology/issues/20), und er hat
den Umbau in
[#21](https://github.com/linuser/zabbix-network-topology/pull/21) gleich selbst
beigesteuert. Hingen zwei Geräte mit mehreren Kabeln aneinander, zeichnete die
Karte **eine** Linie — weil die Identität einer Kante das Hostpaar war, in drei
Schichten unabhängig voneinander vorausgesetzt (`LldpEdgeBuilder`, `TopoDiff`,
`build-elements.js`).

**Die ernsteste Folge war nicht die fehlende Linie:** Fiel ein Mitglied aus,
änderte sich auf der Karte nichts, weil die übrigen sie hielten. Dazu kam der
Verkehr eines einzigen Mitglieds, gegen dessen Kapazität gemessen — ein
4×10G-Bündel sah ausgelastet aus, wenn es das nicht war.

**Was daraus wurde:** Schlüssel ist das Portpaar, normalisiert wie beim
Portabgleich (`findMember()`); ohne Portbezug bleibt es beim Paar, denn
`nt:parent`, manuelle Links und UniFi-`uplink.id` sind keine Kabel. Die teure
Fehlerart ist dabei nicht das übersehene Kabel, sondern die falsche
Aufspaltung: dieselbe Leitung, von beiden Enden mit unvergleichbaren
Bezeichnungen gemeldet, darf nicht doppelt erscheinen.

**Bei der Darstellung hatte dieser Eintrag ursprünglich das Gegenteil
vorgeschlagen** — eine Linie mit ×N als Voreinstellung, Parallellinien nur als
Option. Umgesetzt ist die bessere Lösung: hineingezoomt fächert das Bündel auf,
in der Übersicht klappt es zu einer Linie mit ×N zusammen. Das bedient beide
Fälle ohne Schalter — aufgefächerte Bündel auf einer herausgezoomten Karte
erzeugen genau dort mehr Linien, wo ein großer Standort ohnehin zu viele hat.
Wer dauerhaft zusammengeklappt will, schaltet „All parallel links" ab.

### 7. „An welchem Port hängt das Ding?" — als Suche und als Liste — ERLEDIGT (Suche + Liste + Geister; MAC via MAC/FDB-Suche 5.5.18–5.5.22)

Nutzerwunsch vom September 2026, und der ehrlichste Satz dazu steht in seiner
Mail: **das war der Grund, aus dem er die Karte überhaupt gesucht hat.**

**Der Ablauf heute, ohne Modul:** Ein Access Point ist tot und soll per PoE neu
gestartet werden. Also auf den Switch, `show lldp neighbors`, die Ausgabe gegen
die Portbeschreibungen in der Konfiguration halten und suchen, welcher Port
fehlt. Dann Port aus, Port an.

**Was seit 5.4.0 davon da ist:** Ein Klick auf das Gerät zeigt in der
Verbindungsliste den Port an beiden Enden. Und weil Kanten altern statt zu
verschwinden, steht dort auch bei einem toten Gerät noch der Port, an dem es
zuletzt hing — genau der Fall aus der Mail.

**Stand nach 5.5.0 — erledigt, bis auf die MAC:**

1. ~~**Suche nach Gerät, Antwort Port.**~~ **Fertig.** Das Suchfeld steht auf
   Karte und Tabelle und versteht eine Abfragesprache (`host:`, `ip:`,
   `type:`, `port:`, Negation, ODER). `port:lab-sw-01` beantwortet dabei die
   Umkehrung: welche Geräte hängen an diesem Switch.
   **Offen bleibt die MAC** — die beantwortet nicht LLDP, sondern die
   Forwarding-Tabelle, und das ist der eigene Posten
   [MAC/FDB-Suche](#macfdb-suche--hängt-an-switch-x-port-y) weiter unten. Eine
   neue Erhebung, kein Anzeigeproblem.
2. ~~**Eine Liste statt einer Karte.**~~ **Fertig.** Spalte „Connected to" mit
   Gerät und Port der Gegenseite, Infrastruktur zuerst sortiert, alternde
   Einträge als „last seen here" gekennzeichnet, im CSV-Export enthalten.
3. ~~**Geister mitnehmen.**~~ **Fertig in 5.5.0.** Teurer als hier geschätzt,
   und zwar aus einem Grund, der vorher nicht dastand: `switchTab()` übergibt
   der Tabelle die **Rohdaten** vom Backend, Geister entstehen aber erst beim
   Zeichnen. Der `_isGhostEdge`-Filter in `buildUplinks()` war deshalb toter
   Code. Nötig waren fünf Teile statt „fast geschenkt":
   der Port im `unmatched`-Eintrag des Backends (er lag in `$row['ctx']`
   bereit und wurde nie weitergegeben), `ports` auf der Geisterkante,
   `injectGhostNodes` in `renderTable`, die Richtungsregel (ein Geist hängt am
   Switch, nicht umgekehrt) und die Geisterbehandlung in Zeile, Zähler **und**
   CSV. Letzteres hätte sonst „Normal" für ein unüberwachtes Gerät
   geschrieben — dieselbe Störung, die auf dem Schirm schon einmal gemeldet
   wurde, nur in einer Datei, die weitergegeben wird.

**Der Nachbar dieser Idee** ist die MAC/FDB-Suche weiter unten: dieselbe Frage,
aber für Geräte, die gar nichts melden — dort beantwortet sie die
Forwarding-Tabelle des Switches statt LLDP.

### 8. Endgeräte bündeln — ein Knoten statt achtundvierzig — ERLEDIGT („Bundle endpoints")

**ERLEDIGT.** Der Toggle „Bundle endpoints" fasst Endgeräte an EINEM Switch zu
einem aufklappbaren Knoten zusammen (`aggregation.js`, `aggregateEndpoints`) —
genau das Gruppen-Aggregat-Muster. Der Rest unten ist die ursprüngliche Planung.

Nutzerwunsch vom September 2026, per Mail, mit Screenshot. Die zweite Hälfte
dessen, was in 5.3.2 als Filter gebaut wurde: Geister lassen sich jetzt auf
Netzgeräte beschränken (`aus → nur Netzgeräte → alle`), aber wer sie
tatsächlich **alle** sehen will, bekommt an einem Access-Switch mit 48 Ports
auch 48 Knoten.

**Die Idee:** Geister, die nur an EINEM Switch hängen und nichts weiter
melden, werden zu einem Knoten zusammengefasst — „34 Endgeräte" — der sich per
Klick aufklappt. Dasselbe Muster wie die Gruppen-Aggregate, die es schon gibt.

**Was dafür spricht:** Die Information bleibt vollständig, nur die Fläche
schrumpft. Der Filter aus 5.3.2 wirft Geräte weg; das Bündeln nicht.

**Was daran teuer ist**, und weshalb es nicht im selben Zug entstand:

1. **Positionen.** Ein Bündel hat eine Position, seine Kinder haben beim
   Aufklappen keine. Dieselbe Falle, die bei den Geistern zum Stapel auf (0,0)
   geführt hat — gelöst ist sie dort über den Ring um den Melder, hier bräuchte
   es dasselbe noch einmal für den Aufklappzustand.
2. **Aufklappzustand speichern.** Pro Karte oder pro Benutzer? Die Karte kennt
   bereits zwei Ebenen (geteilt und persönlich), und ein dritter Zustand, der
   sich anders verhält als beide, wäre eine Erklärung wert.
3. **Export und Bericht.** GraphML, Geräte-Bericht und die KPI-Zeile zählen
   Knoten. Ein Bündel darf dort nicht als ein Gerät durchgehen.
4. **Was ist ein Endgerät?** Die Antwort steckt schon in `INFRA_CAPS`
   (`build-elements.js`), aber ein Gerät ohne gemeldete Fähigkeiten gilt dort
   bewusst als unbekannt und wird behalten. Beim Bündeln wäre dieselbe
   Entscheidung strenger zu treffen, sonst bündelt man Switches.

**Aufwand:** reines Frontend, aber kein Nachmittag. Ein Tag für das Bündeln
selbst, ein weiterer für Positionen, Export und Zählung.

## Später

### VLAN-Ansicht — GEBAUT (5.5.93, Review-Fixes 5.5.94)

> **Gebaut, released und live abgenommen.** Ein VLAN-Wähler „⬡ VLAN" erscheint
> in der Technical-Toolbar, sobald Switches VLAN-Daten melden; die Wahl dimmt
> alles, was nicht auf dem gewählten VLAN liegt, und hält pro Ansicht an. Knoten
> tragen ihre VLANs (id + Name), eine Kante das VLAN auf dem lokalen Port
> **mindestens eines** Endes. Im gruppierten View erbt der Aggregat-Knoten die
> Vereinigung der Mitglieder-VLANs. Live an zwei HPE-Instant-On-1830-Switches
> (ein 24-Port + ein 8-Port) abgenommen. Einrichtung:
> **[docs/VLAN-SETUP.md](docs/VLAN-SETUP.md)**.

VLAN kam im Projekt lange nicht vor — der Grund ist LLDP: es trägt keine
VLAN-Mitgliedschaft. `lldpXdot1LocVlanName` ist eine optionale Erweiterung, die
viele Geräte nicht liefern. Belastbar ist die Q-BRIDGE-MIB
(`dot1qVlanStaticName`, `dot1qVlanCurrentEgressPorts`) — deren Egress-Ports
kommen als **Bitmaske**, die gegen `dot1dBasePortIfIndex` auf echte ifIndexe
aufgelöst werden muss (Port 1 = MSB von Byte 0). Genau diese Bitmasken-Klasse
machte den Eintrag teurer als die Nachbartabellen aus [#2], [#3] und [#4].

**So gebaut:** ein Template `NT VLAN by SNMP` (ein Bulk-Walk `nt.vlan.walk` über
die Q-BRIDGE-Tabellen, frischer Import, kein Re-Import), `VlanParser` dekodiert
Maske + Mitgliedschaft rein und testbar, das Backend hängt VLANs an Knoten und
Kanten (`VlanParser::annotateEdges`), der Frontend-Wähler liegt in
`vlan-filter.js`. **Herstellerbefund** (per `tools/nt-vlan-probe.sh` read-only
gemessen, der „erst messen"-Schritt): HPE Instant On 1830 = voller
Q-BRIDGE-Support; MikroTik RouterOS und TP-Link JetStream füllen die
dot1q-Gruppe **nicht** (private MIB) — vor dem Verlinken also proben. VLAN-Namen
bleiben auf der Instanz des Betreibers und werden nie exportiert.

### MAC/FDB-Suche — „hängt an Switch X, Port Y" — ERLEDIGT (5.5.18–5.5.22)

> **Gebaut, released und live verifiziert.** Der Toolbar-Knopf „🔎 MAC" nimmt
> eine **MAC, IPv4 oder IPv6** und nennt Zugangsswitch + Port mit Alter und
> `ambiguous`-Ehrlichkeit: MAC-Suche (5.5.18), LLDP-gestützte Access/Uplink-
> Klassifikation (5.5.21), IPv4 via ARP (5.5.22) und IPv6 via EUI-64 + ND-Tabelle
> (`nt.nd`). Alles API-only (liest `nt.fdb.*`/`nt.arp`/`nt.nd`-`walk[]`-Items,
> nie direktes SNMP → proxy-tauglich). Opt-in-Items in **docs/FDB-SETUP.md**. An einem
> Aruba-Switch hinterm Proxy live bestätigt (2026-10-09/11). Der Rest unten ist der
> ursprüngliche Entwurf und nur noch Historie.

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

### Spanning-Tree — aktiver gegen geblockten Pfad — GEBAUT (5.5.35–5.5.37; Selbst-Loop 5.5.53–5.5.59)

Die Karte zeichnet die PHYSISCHE Nachbarschaft aus LLDP/CDP, nicht den
Weiterleitungszustand. Ein durch STP geblockter Redundanzlink erscheint
deshalb als normale Kante — LLDP laeuft auch ueber einen blocking-Port, und
`ifOperStatus` meldet ihn weiter als up. Zwei Switches mit zwei Kabeln und
aktivem Spanning-Tree sehen auf der Karte aus wie zwei aktive Pfade, obwohl
einer blockt. Aus einer Nutzerfrage im 10/2026 („beruecksichtigt das Tool den
Spanning-Tree, oder zeichnet es doppelte Pfade als aktiv?").

Was es HEUTE schon unterscheidet: die Weathermap. Ein geblockter Link traegt
nur BPDUs, liegt also bei ~0 gemessener Auslastung, waehrend der aktive Pfad
sich nach Last faerbt. Den lebenden Pfad erkennt man an den Zahlen — nur nicht
an einer Beschriftung.

Der Schritt dahin: `dot1dStpPortState` aus der BRIDGE-MIB lesen
(forwarding/blocking/listening/learning, OID `1.3.6.1.2.1.17.2.15.1.3`) und
geblockte Kanten dimmen oder stricheln, mit einem Status-Hinweis im
Kanten-Panel. Pro VLAN wird es feiner — MSTP/PVST melden je Instanz einen
Zustand, teils nur ueber eine VLAN-Kontext-Community; der einfache dot1dStp-
Fall ist der erste Schritt.

**Gemessen (2026-10-16, `nt-stp-probe.sh` an drei Vendoren im Lab) — GO:**

| Switch | `dot1dStpPortState` | Bridge-Port -> ifIndex |
|---|---|---|
| **MikroTik CRS310-8G+2S+** | forwarding 4 / blocking 6 / other 0 — **blockt live** | ja (10) |
| **HPE 1830 (JL813A)** | forwarding 13 / blocking 0 / other 21 | ja (34) |
| **Cisco SB** (SG200-50, 28-Port SG) | ieee8021d, plain dot1dStp — **kein community@vlan noetig** | ja (54 / 36) |
| TP-Link TL-SG2008P | alle „other", unbrauchbar | ja, aber wertlos |

Vier Vendoren gemessen; drei liefern brauchbaren Per-Port-Zustand, und der MikroTik
hat **live geblockte Ports** — damit ist „geblockte Kante dimmen" nicht nur baubar,
sondern auch **visuell beweisbar**. **Cisco Small Business gibt die plain
`dot1dStp`-Tabelle her** (anders als Cisco-IOS/PVST, das pro VLAN eine
VLAN-Kontext-Community braeuchte). TP-Link fuellt die Tabelle nur formal (alles other).
**GEBAUT (5.5.35 Template+Backend, 5.5.36 Render, 5.5.37 Review-Fixes)** — am MikroTik
(blockt live) auch visuell abgenommen.

**Selbst-Loop portgenau auf der Faceplate — GEBAUT (5.5.53–5.5.59).** Ein Kabel vom
Switch auf sich selbst bildet KEINEN LLDP-Zyklus und keinen Host-Ring — die
Ring-Erkennung sieht ihn nicht; RSTP blockt aber einen Port. Die Frontblende
(inline + NT-Faceplate-Widget) markiert jetzt **beide Enden**: das geblockte Ende
als Badge mit Slash, das weiterleitende als Ring, dazu ein gestrichelter Bogen mit
⚠ dazwischen — man liest „EIN Kabel, auf diesem Switch geloopt". Der Partner-Port
kommt aus `dot1dStpPortDesignatedBridge/-Port` (zeigt die designierte Bridge auf die
eigene → Selbst-Loop), dekodiert in `topology/StpLoopResolver.php` (rein, getestet
am HPE 1830: 21↔23). **Farbe amber** (von STP abgefangen = Handlungsbedarf, kein
Ausfall; rot bleibt dem aktiven Loop aus 3a/3b/3c vorbehalten); ein normaler
Redundanz-Block zu einem ANDEREN Switch bleibt neutral cyan. Zwei Nebenfixe: ein
down-Port, den RouterOS als `discarding(2)` meldet, zählt nicht mehr als Block
(Faceplate + KPI-Pille), und das STP-Template holt drei OIDs mehr im Walk —
**Template neu importieren** (docs/STP-SETUP.md).

### Loop-/Ring-Erkennung — Redundanz von Loop unterscheiden — GEBAUT (5.5.39)

**GEBAUT (5.5.39), beide Stufen.** Toggle „◯ Rings": `rings.js` findet Zyklen im
Kabel-Graphen (Kreisrang für die Zahl, Brückensuche für die Kanten; parallele
Kabel/LAG zu einem logischen Paar verdichtet, kein Ring). Klassifizierung über den
STP-Portzustand (seit 5.5.36): **sicher** (cyan), wenn im Ring irgendwo blockt,
**Loop-Gefahr** (rot), wenn STP-Daten da sind und nichts blockt, **grau** ohne
STP-Daten. Entscheidend und an echter Hardware (MikroTik CRS310) nachgeschärft:
das „sicher" prüft, ob ein **Host** im Ring *irgendeinen* Port blockt — nicht nur
die sichtbaren Kanten —, weil STP den Redundanz-Link oft auf einem Port blockt,
der keinen LLDP-Nachbarn trägt und damit keine Kante ist. KPI-Pillen „Rings" und,
nur wenn berechtigt, „Loop risk". **Stufe 3a GEBAUT (5.5.40):** `dot1dStpTopChanges`
als Rate (Item `nt.stp.topchanges`) — ein Host, dessen Baum ständig neu konvergiert
(> ~0,1/s), wird „STP unstable" (KPI-Pille + Panel-Badge), und ein Ring mit so einem
Host wird amber („churn"). Das fängt den Loop, der KEINEN LLDP-Zyklus bildet
(gebrücktes Kabel, STP aus). **Stufe 3b GEBAUT (5.5.41):** Broadcast-Storm — das
STP-Template sammelt `ifHCInBroadcastPkts` je Port als Rate
(`nt.if.bcast[ifIndex]`), je Host das Maximum; über ~200 pkt/s = „Broadcast storm"
(KPI-Pille + roter Badge + Ring-Status „storm" = höchste Stufe). Fängt den aktiven
Loop, der weder LLDP-Zyklus bildet noch STP flappen lässt. **Stufe 3c GEBAUT
(5.5.42):** MAC-Flapping — dieselbe MAC wandert über die Zeit zwischen Ports. Weil
das zeitlich ist (weder Modul noch SNMP-Prep können es rechnen), löst es ein
Cron-Sender wie die bestehenden: `tools/nt-mac-flap-sender.sh` liest je Switch die
FDB-Items `nt.fdb.dot1d`/`nt.fdb.dot1q` (auf die MAC dedupliziert, damit ein Move
nicht doppelt zählt), diff't gegen den letzten Snapshot, zählt bewegte MACs und
pusht sie an das Trapper-Item `nt.mac.flap`; das Modul flaggt > 2 → „MAC flapping"
(Pille + Badge + Ring-Status „flap"). Braucht die opt-in-FDB-Items (docs/FDB-SETUP.md) +
den Cron. **Damit sind alle drei Loop-Symptome (3a/3b/3c) gebaut.** Finale
Ring-Rangfolge: storm > flap > open > churn > safe > unknown. Der Rest unten ist die
ursprüngliche Planung.

Zwei Fragen, die gern zusammengeworfen werden: „gibt es Ringe in der
Verkabelung?" und „loopt gerade etwas?". Das sind zwei verschiedene Dinge, und
das Modul kann sie getrennt angehen. Aus einer Nutzerfrage 10/2026.

**Ringe erkennen — billig, aus vorhandenen Daten.** Eine physische Schleife ist
ein Zyklus im LLDP/CDP-Nachbargraphen. Den Graphen hat das Modul komplett, und
`path-highlight.js` faehrt schon eine eigene BFS — Zyklen zu finden ist dieselbe
Klasse Graphlauf. Ein Quick-Win waere, sie hervorzuheben („N redundante Ringe").
**ABER:** ein Ring ist meist *gewollte* Redundanz (Ring-Topologie, Dual-Uplink),
kein Fehler. Ein erkannter Zyklus heisst „redundanter Pfad", nicht „Loop" — als
Alarm getarnte Redundanz waere schlimmer als gar keine Anzeige.

**Sicher von gefaehrlich trennen — braucht STP-Status.** Der kritische Fall ist
ein Zyklus, in dem STP *keinen* Zweig blockt: STP aus, fehlkonfiguriert, oder ein
unmanaged Switch brueckt zwei Ports. Das unterscheidet erst `dot1dStpPortState`
(siehe den Spanning-Tree-Eintrag direkt darueber) — ein Zyklus mit blockendem
Zweig ist gruen, einer mit lauter forwardenden Zweigen ist Loop-Gefahr. Pro VLAN
wird es feiner (MSTP/PVST), derselbe Vorbehalt wie dort.

**Symptome eines aktiven Loops — teils schon messbar:**
- **Weathermap:** ein echter Loop treibt die Ring-Ports in einen Broadcast-Storm
  (ploetzliche Saettigung), waehrend ein geblockter Link bei ~0 liegt.
- **MAC-Flapping:** seit dem FDB-/MAC-Finder liest das Modul die FDB. Dieselbe
  MAC, die ueber mehrere Access-Ports springt, ist das klassische Loop-Symptom —
  braucht aber Historie/Mehrfach-Sampling, um „flappt" von „umgezogen" zu trennen.
- **`dot1dStpTopChanges`:** schnell steigende TopologyChange-Zaehler = Instabilitaet.

**Erster Schritt:** der Zyklen-Teil steht auf vorhandenen Daten und ist ein
kleiner, ehrlicher Anfang — Ringe markieren, als Redundanz, nicht als Alarm. Die
Loop-*Klassifizierung* haengt am STP-Portstatus und teilt sich Mess-Script und
Vorbehalte mit dem Spanning-Tree-Eintrag.

### Gestackte Switches und MLAG — ein Knoten oder zwei?

Zwei verwandte Faelle, die beide nicht sauber aus LLDP/CDP fallen. Aus einer
Nutzerfrage im 10/2026 („koennt ihr auch gestackte Switches abbilden? jeder
Hersteller hat sein Verfahren, es gibt aber auch den herstelleruebergreifenden
Begriff MLAG").

**Ein Stack ist heute schon ein Knoten — unbeabsichtigt richtig.** Ein Stack
(Cisco StackWise/VSS, Juniper Virtual Chassis, Aruba VSF, …) tritt mit EINER
Management-IP und EINER LLDP-Chassis-ID auf, also zeichnet die Karte ihn als
einen Knoten. Das ist das gewuenschte Bild. Was fehlt, ist die Information
DAHINTER: wie viele Einheiten im Stack, welche ist der Master, ist ein Member
ausgefallen. Das steht nicht in der Nachbartabelle, sondern in der
`ENTITY-MIB` (`entPhysicalTable`, mehrere physische Einheiten unter einem
Chassis) — ein Standard-OID, kein Herstellertrick, und damit der erste Schritt:
die Member-Zahl und ihren Zustand als Badge an den Stack-Knoten, etwa
„Stack ×4".

**MLAG ist der schwierige Fall.** Hier bleiben es ZWEI Switches mit je eigener
Management-IP, die einem Downstream-Geraet gemeinsam ein LAG anbieten. Aus
dessen LLDP kommen zwei verschiedene Chassis-IDs, die Karte zeichnet also
korrekt zwei Kanten zu zwei Knoten — und verdeckt damit, dass die beiden ein
MLAG-Paar sind. „MLAG" ist dabei kein IEEE-Standard wie LACP (802.3ad),
sondern der herstellerneutrale Sammelbegriff; jeder nennt es anders (Cisco
vPC, Arista/Dell MLAG, Cumulus CLAG, Juniper MC-LAG), und jeder legt die
Peer-Beziehung in eine EIGENE MIB. Ein einheitliches OID gibt es nicht.

Der ehrliche Schnitt: den Stack-Fall ueber die `ENTITY-MIB` zuerst, weil er
standardisiert und sofort nuetzlich ist. Die MLAG-Erkennung braucht pro
Hersteller eine eigene Probe — und wie bei STP und FDB gilt: erst auf echter
Hardware messen, ob die Peer-MIB verlaeslich das Paar nennt, dann ein
Paar-Lasso wie bei den Gruppen-Clustern ziehen. Nicht spekulativ bauen.

### Link Quality Score — GEBAUT (5.5.76)

**GEBAUT (5.5.76).** 0–100-Güte-Wert je Kante (`assets/js/modules/link-quality.js`,
`linkQualityScore()`): gewichtete Abzüge von 100 aus **Down** (65), **Errors**
(25), **Drops** (20), **Auslastung >80 %** (15) und **Flaps** (20). Bänder/Farben
wie der Host-Health-Score (85/65/40). **Flaps = Uptime-Proxy** (niedrige Link-
Uptime = kürzlich gebounced; kein neuer Datenbedarf) — ein echter Flap-Zähler
(neue Template-Items) bleibt als Folgepunkt. Sichtbar als **„Link quality"-Toggle**
auf der Karte (`traffic.js`/`toolbar.js`, färbt Kanten nach Score, gegenseitig
ausschließend mit der Weathermap, eigene Legende) und als Score-Zeile im
Kanten-Panel (`edge-detail.js`). **Kein Widget** → bewusst nur EINE Formel-Stelle;
`ci:parity` ist NICHT erweitert — eine Widget-Kopie MUSS das nachziehen (im
Dateikopf vermerkt).

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

### Firmware-/Modell-Abweichung — GEBAUT (5.5.50)

**GEBAUT (5.5.50) als Compliance-Check.** `topology/FirmwareDrift.php` (rein,
getestet) gruppiert die Hosts nach Modell und meldet die Firmware-Minderheit;
konservativ (Gruppe < 3 oder Gleichstand → kein Fund). Erscheint als achter
Check im Compliance-Tab (`render-compliance.js`) mit Tooltip. Der Rest unten ist
die ursprüngliche Planung.

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

Aus einem groesseren Vorschlagspaket von christos-diamantis. Alle umsetzbaren
Punkte sind inzwischen gebaut, mehrere geprueft und verworfen (siehe „Geprueft
und verworfen" unten):

**Confidence-Score — erledigt.** Jede Kante traegt `confidence` (0–100) und
`match`, das Panel zeigt beides. Die Skala weicht bewusst vom Vorschlag ab: der
stuetzte sich auf Chassis-ID und Management-Adresse. Beide werden inzwischen
erhoben (5.5.96 / 5.5.97, siehe unten) — die Management-IP traegt jetzt einen
eigenen Match-Typ (`mgmt_ip`, 50 Punkte), der Chassis-Subtype macht die
chassis-Aufloesung verlaesslich, bekommt aber keinen eigenen Punkt. Darueber
hinaus zaehlt, wie der Name getroffen hat, ob beide Seiten melden und wie viel
Beiwerk dazukommt.

**Port-Normalisierung — erledigt.** `Gi1/0/1` ↔ `GigabitEthernet1/0/1`. Der
gemeldete Nachbar-Port wird auf ein Interface der Gegenseite aufgeloest; damit
hat die Kante Messwerte an **beiden** Enden statt nur beim Melder. Sie traegt
einen eigenen Match-Typ (`exact` / `normalized`), der unterschiedlich in die
Bewertung eingeht — eine Annahme ueber Schreibweisen darf den Score heben, aber
nicht so weit wie ein Treffer ohne Annahme. Mehrdeutige Formen werden verworfen.

**Alterung — erledigt.** Verschwundene Kanten bleiben 15 Minuten als `stale`
auf der Karte (gepunktet, gedaempft), das Panel nennt „zuletzt vor N min
gemeldet". Damit springt die Topologie nicht mehr bei einem einzelnen
ausgefallenen Discovery-Durchlauf.

**Und der Topology-Diff ist damit erledigt.** Die offene Frage — „eine
verschwundene Kante existiert nicht mehr, wie lange zeichnet man sie?" — ist
beantwortet: so lange, wie sie altern darf. Neue Kanten tragen fuenf Minuten
lang eine gruene Glorie, verschwundene fuenfzehn Minuten die gepunktete
Darstellung, und die Legende fuehrt beide. Auch der genannte Blocker ist weg:
`topo_changes` liefert jetzt den Schluessel mit, nicht nur Labels.

**Chassis-Subtype und Management-Address — GEBAUT (5.5.96 / 5.5.97).**
`lldpRemChassisIdSubtype` (5.5.96) typisiert die Chassis-ID (4=MAC / 5=IP /
7=Name), sodass `rowChassis` eine ID nur noch als MAC aufloest, wenn der Subtype
das sagt — statt aus der Zeichenform zu raten (rein additiv: fehlt der Subtype,
greift die alte Heuristik). `lldpRemManAddr` (5.5.97) erhebt die Management-IP;
weil sie nicht im Wert, sondern im OID-INDEX der getrennten lldpRemManAddrTable
steckt (`...4.2.1.3.<TimeMark>.<Port>.<RemIndex>.<Subtype>.<Len>.<Oktette>`),
zieht ein Prototyp-Regex die IPv4 dort heraus (IPv6 uebersprungen). Daraus wird
ein letzter Treffer-Pfad (`resolveByMgmtIp`: Nachbar ohne Namens-/MAC-Treffer,
dessen Mgmt-IP zu genau einem Host gehoert → Kante `mgmt_ip`) und eine
Geist-Anreicherung (IP im Detail-Panel/Tooltip/Kontextmenue, „Host anlegen"
fuellt ein SNMP-Interface vor). Beides heisst Template-Reimport. Live abgenommen
auf einer Testinstanz ueber fuenf Hersteller (2026-10-28). Damit ist an diesem Vorschlagspaket
nichts mehr offen.

### Soll gegen Ist — GEBAUT (5.5.52)

**GEBAUT (5.5.52).** Tag `nt:expect=<host>[/<port>]` erklärt den erwarteten
Nachbarn, Toggle ◇ Expected zeichnet jede erwartete, aber nicht gemessene Kante
rot-gestrichelt (*misconnected* / *not seen*) + KPI-Pille mit der Abweichungszahl.
Logik rein und getestet (`topology/ExpectedLinks.php`); die Pillen-Anzeige wurde
in 5.5.55 nachgebessert. Der Rest unten ist die ursprüngliche Planung.

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

### LLDP-Test-Bibliothek — GEBAUT

**GEBAUT.** `tests/fixtures/lldp/*.json` — je Datei ein LLDP-Szenario (Item-Zeilen
+ erwartete Kanten/Ports), `tests/LldpFixtureTest.php` laeuft `LldpEdgeBuilder`
dagegen; faehrt in `ci:test` mit (globt `tests/*Test.php`). Vier Fixtures zum
Start: Namens-Match (exakt/FQDN/Gross), Index-Ports + PortDesc-vor-PortId,
Port-Normalisierung (kurz/lang) und die Gegenprobe „1/0/1 trifft nicht 1/0/11".
Format + eine README zum Beitragen liegen daneben. **Waechst per Fixture:** eine
neue Datei genuegt, damit eine Meldung dauerhaft ein Regressionstest wird. Daten
bleiben erfunden/anonymisiert (wie `tools/devnet`, kein echter Kundenwalk). Der
Rest unten ist die ursprüngliche Planung.

Anonymisierte echte SNMP-Ausgaben verschiedener Hersteller als Fixtures, gegen
die jeder Parser laeuft — damit ein Fix fuer Aruba nicht Cisco bricht.

**Die Form ist billig:** eine Fixture ist eine Liste von Item-Zeilen (`hostid`,
`key_`, `lastvalue`, `src`) — genau das, was `LldpEdgeBuilderTest` schon von
Hand aufbaut. Ein Verzeichnis mit JSON-Dateien und eine Schleife darueber.

**Teuer ist das Beschaffen**, und dafuer gibt es seit 5.3 den Geraetebericht.
Damit schliesst sich ein Kreis: Meldung → Fixture → Regressionstest. Wer ein
Geraet meldet, macht es dauerhaft testbar, statt eine Zeile in einer Tabelle zu
aendern.

### LLDP-Health als Zeile im LLDP-Q-Tab — GEBAUT (5.5.51)

**GEBAUT (5.5.51).** Summenzeile oben im LLDP-Q-Tab
(`render-lldp-quality.js` `_healthLine`): Nachbarn · confirmed · one-sided ·
conflict · Anteil der Switches, die LLDP liefern.

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

**Der billige erste Schritt steht oben:** der
[NetBox-Export](#5-netbox-export--kabelliste-im-netbox-importformat) braucht
weder Token noch Server-Action, und der Import in NetBox beantwortet Frage 3 mit
echten Daten.

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

### PoE je Port — ERLEDIGT (5.5.65)

**ERLEDIGT (5.5.65).** Die **Klasse je Port** steht jetzt im Port-Tooltip der
Faceplate (`pethPsePortPowerClassifications` → „PoE: Class N, delivering/not
delivering"). Template `nt_poe_snmp.yaml` (Walk + Dependent-Discovery, OID-
benannte Keys, rückwärtskompatibel zum bestehenden Detection-Matcher), Backend
`FaceplateBuilder::poeClass()`. Live auf Zabbix 8.0 am HPE 1830 abgenommen
(`pethPsePortPowerClassifications[1.4] = 3` = class2, exakt der Gerätewert). Die
**Watt pro Port** bleiben draußen (Vendor-MIB, nicht Standard) — siehe unten.

Klasse und Leistung je Port. Die **Klasse** (`pethPsePortPowerClassifications`)
ist Standard; die tatsaechlichen **Watt pro Port** sind meist herstellerspezifisch
(z. B. Cisco `cpeExtPsePortPwrConsumption`). Kleines, klar umrissenes Item —
passt am besten als Zeile **in die Interface-Ansicht** (Punkt 1), nicht als
eigenes Feature.

Messwerkzeug liegt bereit: `tools/nt-poe-probe.sh` deckt den Standard-Teil
(Erkennung + Klasse je Port) ab und zeigt, wo fuer die Watt-pro-Port eine
Vendor-MIB noetig ist.

**Gemessen (2026-10-16):** HPE 1830 (JL813A) liefert `pethPsePortDetectionStatus`
+ `pethPsePortPowerClassifications` sauber (12 PoE-Ports) — die **Klasse je Port
ist also baubar**. TP-Link TL-SG2008P gibt die POWER-ETHERNET-MIB trotz 4×PoE+
**gar nicht** her (Vendor-MIB noetig). Watt-pro-Port blieb bei beiden Standard-MIB-los.

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

### UniFi-Controller als Quelle — Topologie aus `uplink.id`, Ports aus der API — GEBAUT (5.5.79–5.5.92)

> **Gebaut, released und live abgenommen** an einer echten UniFi-Anlage
> (Gateway + 90+ UniFi-Hosts). Geliefert:
> - UniFi-Geräte zeigen ihre **Ports** (5.5.79) und den **Uplink-Durchsatz** auf
>   der Kante (5.5.80); **Kanten aus `uplink.id`** per UUID-Join, ganz ohne LLDP.
> - **Access Points auf der Karte** mit Radios (Kanal/Standard je Band),
>   **Client-Zahl** und **Air-Utilization** (5.5.81/5.5.83), den **SSIDs** die
>   sie funken (5.5.84) und dem **Satisfaction**-Signal (5.5.88); CPU/Memory
>   (5.5.87).
> - Das **NT-WLAN-Dashboard-Widget** (5.5.82, 8. Widget).
> - **Clients als eigene Geräteklasse**, erst beim Klick auf ihren AP sichtbar
>   (5.5.85/5.5.86), mit `📶 <AP>` benannt und **Wi-Fi-Links als Wi-Fi
>   gezeichnet** (5.5.92).
> - **Per-Port-Traffic in der Faceplate** auf UniFi-Switches (5.5.91).
>
> Einrichtung: **[docs/UNIFI-SETUP.md](docs/UNIFI-SETUP.md)**. Der Text darunter
> ist der **Bauplan**, nach dem das entstand (Option A, der gewählte Weg) — als
> Beleg aufbewahrt, nicht mehr offen.

Nutzerfrage 10/2026: „kann UniFi das selbst liefern wie die HPE-Switche — Ports
in den Widgets und in der Visualisierung?" **Gemessen am 2026-10-26** an einer
echten UniFi-Installation (Gateway + über 90 UniFi-Hosts). Das „erst
messen"-Gebot ist hier also schon erfüllt — der Befund
ist eindeutig und der Eintrag konkret.

**Der Befund:** UniFi wird in Zabbix **nicht per SNMP** überwacht, sondern über
das Template **„UniFi Network API – Device"** — ein HTTP-Agent gegen die
UniFi-Controller-API. Alle UniFi-Geräte (Gateway, APs, Switches) hängen an
**einer** Interface-IP (die des UniFi-Gateways); das Gateway selbst trägt nur zwei
Controller-Items und **null** Standard-SNMP. Damit sieht das Modul die
UniFi-Geräte heute **gar nicht**: es liest `ifName`/`ifHC*Octets`/`ifOperStatus`/
`ifInErrors`/`lldpRem*`/`pethPse*`/`dot1dStp*`, und davon hat ein UniFi-Host
**keinen einzigen** Key.

**Die Daten sind aber da — unter eigenem Namespace, teils reicher als die
Standard-MIB:** je Port `port.state[N]` (up/down), `port.speed[N]`,
`port.maxSpeed[N]`, `port.connector[N]` (RJ45/SFP), `port.poe.enabled/state/
standard/type[N]`; je Gerät `cpu.utilization`, `memory.utilization`,
`firmware.version`, `model`, `macaddress`, sowie `uplink.id`, `uplink.rx`,
`uplink.tx` und ein rohes `details.json`/`statistics.json`.

**Das Goldstück ist `uplink.id`:** es ist die UUID des Uplink-Geräts und
**identisch mit dem Zabbix-`host`-Feld** des Eltern-Hosts. Belegt an der echten
Installation: ein Access-Switch trägt `uplink.id` = die Host-UUID eines
Distribution-Switches, der wiederum per `uplink.id` aufs Gateway zeigt. Das ist ein **fertiger
Parent-/Uplink-Graph per UUID-Join, ganz ohne LLDP** — genau der
„UniFi-uplink.id"-Fall, den die Kanten-Logik an anderer Stelle schon als
port-lose Kante kennt.

**Der Plan (Option A): ein UniFi-Adapter in der `topology/`-Schicht**, eine neue
Quelle neben `LldpEdgeBuilder`, die die API-Template-Keys liest und aufs interne
Modell mappt:

- **Kanten aus `uplink.id`** — Join auf den Host, dessen `host`-Feld der UUID
  gleicht. Kind → Uplink, `src: ['unifi']`. `uplink.rx`/`uplink.tx` tragen den
  Verkehr der Kante.
- **Portmetriken aus `port.*[N]`** für die Faceplate/Widgets (Status, Speed,
  Connector), **PoE aus `port.poe.*`** — das speist zugleich das PoE-Feature.

**Fünf Entscheidungen, ohne die es schiefgeht** (im Stil der übrigen Einträge
vorab benannt):

1. **Kantenidentität ist hier das Gerätepaar, NICHT das Portpaar.** `uplink.id`
   nennt nur das Eltern-GERÄT, keinen vergleichbaren Remote-Port. Die
   Portpaar-Identität seit 5.4.0 (ein Kabel = eine Kante) darf hier **nicht**
   erzwungen werden, sonst spaltet der Adapter falsch auf — dieselbe teure
   Fehlerart wie bei LLDP, nur andersherum. UniFi-Kanten verschmelzen wie
   `nt:parent` übers Paar.
2. **Woran erkennt der Adapter einen UniFi-Host?** Nicht am Template-NAMEN (der
   ist umbenennbar), sondern an der **Präsenz der Keys** (`uplink.id` +
   `port.*`). Robust und sprachunabhängig.
3. **Mischbetrieb.** Eine Anlage hat oft BEIDES: UniFi (API) und HPE/Cisco
   (SNMP). `uplink.id` zeigt nur auf andere UniFi-UUIDs — eine Kante **UniFi ↔
   Nicht-UniFi** entsteht nur, wenn die Gegenseite LLDP meldet. Diese Naht
   gehört benannt, nicht übertüncht.
4. **Client-Flut.** Der Controller führt auch 90+ **Endgeräte** (Handys, …) als
   eigene Hosts, jedes mit `uplink.id` auf seinen Access-Punkt. Ungefiltert
   ertränkt das die Karte. Das ist derselbe Fall wie
   [Endgeräte bündeln](#8-endgeräte-bündeln--ein-knoten-statt-achtundvierzig--erledigt-bundle-endpoints)
   und die Geisterfilter — also opt-in/gebündelt, nicht alle einzeln.
5. **Was UniFi NICHT liefert:** kein `ifInErrors`/`ifOutDiscards` (die API-Keys
   kennen nur Status/Speed/PoE), kein STP, kein FDB, kein LLDP-Portpaar. Der
   [Link Quality Score](#link-quality-score--gebaut-5576) bekommt für UniFi-
   Kanten also nur einen Teil seiner Eingänge (Down + Auslastung aus
   speed/maxSpeed + Flap aus Uptime), keine Errors/Drops — das muss der Score
   ehrlich als „teilgemessen" ausweisen, nicht als 100 schönrechnen.

**Verhältnis zu den Nachbareinträgen:** die Typisierungs-Gabelung aus
[Nachbarschaft jenseits von LLDP/CDP](#nachbarschaft-jenseits-von-lldpcdp-ip-bgp-ospf-bridge)
gilt auch hier — aber einfacher: eine UniFi-Uplink-Kante **ist** ein Kabel
(physisch), anders als eine OSPF-/VPN-Kante. Sie lebt als `src: ['unifi']` im
selben Graphen und darf von Weathermap, Pfad-BFS, Root Cause und What-if wie
jede physische Kante gesehen werden — nur ohne Portpaar. Der APs-aufs-Bild-Teil
deckt sich mit [Luftbild-Hintergrund](#luftbild-hintergrund-und-aps-aufs-bild-setzen--stufe-1-erledigt-5566-stufe-2-gebaut-5569):
die UniFi-APs bekämen dort endlich einen Live-Status aus genau dieser Quelle.

**Option B (Gegenprobe, bewusst nicht gewählt):** die UniFi-Switches zusätzlich
per SNMP (v1/v2c im Controller aktivieren) mit einem Standard-IF-MIB/LLDP-
Template pollen — dann sähe das Modul sie wie die HPE, ohne Adapter. Dagegen:
Doppel-Monitoring je Gerät, und UniFis SNMP-LLDP ist historisch lückenhaft,
während `uplink.id` aus der API verlässlich das Paar nennt. Der Adapter ist der
ehrlichere Weg.

**Aufwand:** reiner Backend-Adapter plus die Port-Darstellung; die Mess-Arbeit
ist erledigt, die Live-Instanz steht als Validierungsziel bereit. Kein neues
Template, kein Re-Import beim Nutzer — die UniFi-Items existieren bereits, sobald
jemand das offizielle UniFi-Network-API-Template fährt.

### Standortansicht für MSPs

Deutschland → München → Firewall/Core/12 Switches.

**Teilweise vorhanden:** `selectInventory` lädt bereits `location` (neben
`location_lat`/`location_lon` für die Geo-Karte), und `nt:parent` trägt schon
eine Trägerbeziehung. Das Gruppen-Cluster-Layout kann nach `_primaryGroup`
gruppieren.

Was fehlt, ist die **Ebenen-Tiefe**: heute gibt es eine Gruppierungsebene, die
Skizze hat drei (Land → Stadt → Gebäude). Und die Frage, woher die Hierarchie
kommt — aus `location` als Freitext lässt sie sich nicht ableiten.

### Luftbild-Hintergrund und APs aufs Bild setzen — Stufe 1 ERLEDIGT (5.5.66), Stufe 2 GEBAUT (5.5.69)

**Stufe 1 ERLEDIGT (5.5.66):** Esri-World-Imagery-Provider, weltweites Luftbild
im Geo-Modus (siehe unten).

**Stufe 2 GEBAUT (5.5.69):** eigener **Plan-Modus** (`render-plan.js`, Leaflet
`CRS.Simple` + `L.imageOverlay`) neben Geo. Ein Hintergrundbild aus Zabbix' Bild-
Store (Typ Background) auswählen/hochladen (`image.get`/`image.create` via
`actions/NetworkTopologyPlan.php`; Modul speichert je Ansicht nur die `imageid`/
URL in `topology/PlanBackground.php`) — oder eine Bild-URL. Marker per Drag in
Bild-Pixeln platzieren; Positionen laufen über die bestehende Zwei-Ebenen-
Pixelspeicherung unter eigenem `_plan`-viewKey (shared für Super-Admins, sonst
persönlich). Unplatziert-Leiste, Kanten zwischen platzierten Markern, geteilte
Marker-/Popup-Bausteine mit Geo (`geo-markers.js`). **Dashboard-Widget (5.5.71):**
`widget_plan` zeigt den Plan read-only als Kachel (Hintergrund + Marker nach
Severity, leichtgewichtig ohne Leaflet; Positionen über neues `op=positions` am
Plan-Endpunkt, Severity über `NtWidgetData`). **Offene Folgepunkte:**
mehrere Pläne/Etagen je Standort, Georeferenzierung eines Plans auf echte lat/lon
(Drag-to-place im Geo-Modus), Maßstab-/Rotations-Kalibrierung, Heatmap-Overlay.

Ein Luftbild (oder ein Lageplan/Grundriss) als Hintergrund, und darauf
Access Points — und andere Geräte — an ihrer **echten physischen Stelle**
platzieren. Der klassische WLAN-Planungsblick (UniFi/Ekahau), nur mit dem
Live-Status aus Zabbix auf den Markern. Eng verwandt mit der Standortansicht
oben: dort geht es um die Hierarchie, hier um die *Fläche*.

**Die halbe Grundlage liegt schon:** der Geomap-Modus (`render-geo.js`) ist ein
voller Leaflet-Layer mit Provider-Liste (`geo-providers.js`), Knoten mit
`location_lat`/`location_lon` liegen auf einer echten Karte. Was fehlt, sind
zwei Dinge — bewusst getrennt, weil sie unterschiedlich groß sind:

**Stufe 1 — weltweites Luftbild (klein).** Heute gibt es als Luftbild nur
„USGS US Imagery", außerhalb der USA niedrig aufgelöst. Ein Provider **Esri
World Imagery** (weltweit) ins `GEO_PROVIDERS`-Array — mehr Code ist es nicht,
`render-geo.js` baut den Tile-Layer aus der Liste. **Lizenz beachten:** der
klassische `server.arcgisonline.com/.../World_Imagery`-Endpunkt läuft **ohne
API-Key** (so nutzt ihn `esri-leaflet`), Attribution ist aber Pflicht
(„Esri, Maxar, Earthstar Geographics, and the GIS User Community"), und Esri
lenkt produktiven Gebrauch formal auf ein ArcGIS-Konto mit Token
(`ibasemaps-api.arcgis.com`). Also wie Stamen behandeln: optional, Attribution
fest, Token-Vorbehalt per `warningKey` gekennzeichnet. **Keine Google-Earth-/
Maps-Kacheln** — die sind lizenzrechtlich gesperrt und laufen nicht in Leaflet.

**Stufe 2 — platzieren statt nur anzeigen (der eigentliche Punkt).** Zwei Wege,
je nach Umgebung:
- **Draußen, geo-korrekt:** einen Host auf der Satelliten-Karte **per Drag
  setzen** (schreibt lat/lon), auch wenn er noch keine Koordinaten hat. Heute
  braucht die Geomap vorhandene Koordinaten; die Lücke ist „Knoten ohne
  Koordinate durch Ziehen platzieren". Ablage in der bestehenden
  Zwei-Ebenen-Speicherung (persönlich/geteilt).
- **Drinnen, eigenes Bild:** **Bild-Underlay** (`L.imageOverlay` +
  `L.CRS.Simple`) — ein beliebiges, vom Nutzer **selbst mitgebrachtes** Bild
  (Drohnenfoto, CAD-Lageplan, Grundriss; auch ein Google-Earth-**Pro**-Export,
  falls berechtigt) als Hintergrund, APs frei in Bild-x/y. Funktioniert auch
  **indoor**, wo Satellit nichts bringt. Das ist der UniFi-/Ekahau-Fall.

Zu klären früh: ist das ein dritter Modus neben Technisch/Geo, oder eine
Spielart des Geo-Modus? Und wo das mitgebrachte Bild und seine Georeferenz
(zwei Eckpunkte → Maßstab) gespeichert werden — Host-Tag, Modul-Config, oder
pro Nutzer. **Erster Schritt ist Stufe 1** (ein Provider, sofort sichtbarer
Nutzen); Stufe 2 erst, wenn ein echter Standort das rechtfertigt.

### Cloud-Knoten und VM-Ebenen

Azure/AWS/Hetzner-Instanzen neben physischen Hosts; Workload → Node →
physischer Host → Netzwerk.

**Vermutlich fast kein neuer Code nötig.** Beides sind in Zabbix ganz normale
Hosts, und das Modul zeichnet jeden Host. Was fehlt, ist die *Verbindung* — und
dafür gibt es bereits `nt:parent=<host>` (dokumentiert als „VM → Hypervisor").
Der Kanten-Aufbau in `NetworkTopologyData` legt je Kind-Elternteil-Paar eine
eigene `hosts`-Kante an, **Ketten funktionieren also von selbst**: Pod →
Node → Hypervisor → Switch sind drei unabhängige Kanten.

Zu klären wäre eher: reicht ein Freitext-Tag, oder eine automatische Ableitung
aus den Cloud-Templates? Und wie verhindert man, dass viele Gäste je Träger die
Karte unlesbar machen — Zusammenfalten je Node?

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

### PoE-Budget je Switch — GEBAUT (5.5.65), auf echter Hardware noch unbelegt

**GEBAUT (5.5.65), Live-Beleg steht aus.** Die Fußzeile der Faceplate zeigt
„PoE: used / nominal W", sobald ein Switch `pethMainPsePower` /
`pethMainPseConsumptionPower` füllt (Template `nt_poe_snmp.yaml`, zwei Scalar-
Items `nt.poe.nominal` / `nt.poe.used`; Backend `FaceplateBuilder::poeBudget()`).
Degradiert sauber: leere Items → keine Budget-Zeile (am HPE 1830 live so gesehen,
state=noSuchName). Die Render-Logik ist über den Frontend-Test mit synthetischem
`poe_budget` belegt. **Offen bleibt nur ein echter Switch, der die beiden
Zähler tatsächlich bedient** — im Lab tut das keiner (HPE 1830 leer, TP-Link
ohne PoE-MIB).

**Alert + Verlauf ergänzt (5.5.100).** Die Budget-Zeile war in jeder Last
gleich gedämpft („78 / 95 W" sah aus wie 5 %); jetzt zeigt sie die Prozent und
färbt ab 80 % amber, ab 95 % rot + ⚠ (Token `--nt-warn`/`--nt-crit`). Dazu eine
kleine Sparkline des Verbrauchs (`nt.poe.used`, letzte 6 h) neben der Zahl, über
`API::History()` geholt (ClickHouse/Elasticsearch-sicher) und auf ≤48 Punkte
ausgedünnt. Fehlt Historie, keine Linie. Frontend- und Backend-getestet.

Gesamtbudget und Verbrauch: `pethMainPsePower` (nominal) und
`pethMainPseConsumptionPower` (verbraucht) aus derselben POWER-ETHERNET-MIB wie
die Port-Leistung. **Standard-MIB, zwei Items** — der kleinste Punkt in diesem
Abschnitt. Gehört zusammen mit dem PoE-Wert je Port erledigt, nicht getrennt.

`tools/nt-poe-probe.sh` misst beides schon mit (verbraucht/nominal je PSE),
also baubar, sobald ein PoE-Switch die Werte bestaetigt.

**Gemessen (2026-10-16): noch kein Beleg.** Die HPE 1830 (JL813A, ein PoE-Switch)
gibt `pethMainPse*` **nicht** her (Budget leer), TP-Link gar keine PoE-MIB. Auf
diesen Geraeten braeuchte das Switch-Budget also doch eine Vendor-MIB — anders als
gedacht ist es hier NICHT der kleinste Punkt. Vor dem Bauen einen Switch finden,
der `pethMainPseConsumptionPower`/`pethMainPsePower` wirklich fuellt.

### 1000+ Hosts — gemessen, und es war nicht, was es schien — BEHOBEN (5.5.95)

> **Nachgemessen am 2026-10-28 auf der k8s-Lasttestumgebung (3002 Hosts, eine
> 2000-Host-Gruppe mit 1999 Kanten) — und der „ehrliche erste Schritt" hat die
> Vermutung umgeworfen:** Es war **kein Performance-Problem**. Das Backend
> lieferte in 0,6 s (kalt) / 0,1 s (warm), und das Zeichnen von 2000 Elementen
> war mit `grid` in 0,67 s fertig und sichtbar. Der Hauptthread hing nie.
>
> **Die Karte kam trotzdem leer hoch — und das lag am Layout, nicht am Tempo.**
> Die Tier-Presets (`hops`/`hierarchy`) legten jeden Tier in EINE Zeile ohne
> Breitenbegrenzung. Ein realer Zugangs-Tier trägt die meisten Hosts (gemessen:
> 768 Knoten auf einer Ebene) → ~115.000 px breit bei ~1.700 px hoch; `fit()`
> klemmte gegen `minZoom` und zeigte einen leeren Ausschnitt. Jeder Knoten war
> da, man sah nur keinen. **Fix (5.5.95): breite Tiers mehrzeilig umbrechen
> (`placeTiersWrapped`, grob quadratisch), `minZoom` bei >800 Knoten lockern.**
> Live am 2000-Host-Lasttest abgenommen: sichtbare Hierarchie-Pyramide in ~0,6 s.

Damit ist **progressives Rendern (häppchenweise ZEICHNEN) vom Tisch** — es wäre
die Lösung für ein Problem gewesen, das es nicht gibt. Der Performance-Modus
(ab 400 Knoten: Farbpunkt statt Icon, kleinere Knoten, Labels erst bei Zoom,
keine Layout-Animation) bleibt, was er ist: **billiger zeichnen**. Er war nie
der Flaschenhals, und die 400er-Schwelle ist weiter gesetzt, nicht gemessen —
aber ohne belegtes Tempoproblem gibt es daran auch nichts zu feilen.

**Was offen BLEIBT, falls jemand noch größer geht:** der fit-Zoom hat mit
`minZoom 0.02` eine neue, höhere Decke, aber immer noch eine — bei etwa
10.000+ Knoten in einer Gruppe käme das Sub-Pixel-Problem wieder. Das ist dann
ein echter Messpunkt für den Tag, an dem jemand so eine Anlage hat; bis dahin
kein Code. Das Messwerkzeug steht: `&ntperf=1` an die URL hängt die
`[NT-PERF]`-Marken aus `perf.js` in die Browser-Konsole, Phase für Phase.

### Historie / Topology-Snapshots

„Wie sah das Netz gestern um 14:00 aus?" Der Diff ist heute **flüchtig** (APCu,
weg beim php-fpm-Neustart). Persistenz heißt ein Datenmodell — der größte
Brocken der Liste.

Nicht zu verwechseln mit `diff-mode.js`: das macht einen **Host**-Snapshot
(neu/weg/Severity) im localStorage, nicht **Kanten** über Zeit.

### Hierarchie-Layout (Core → Distribution → Access) — GEBAUT (Layouts `hierarchy` + `hops`; Skalen-Fix 5.5.95)

Keine Layout-Frage, sondern eine Erkennungsfrage: woran erkennt man die Rolle?
Nachbarzahl, `nt:parent`, Gerätetyp, Namensmuster? Ohne belastbare Heuristik
wird es Raten mit hübscher Anordnung.

**Beantwortet — und zwar zweifach**, beide als Layout-Option in `layouts.js`
(`LAYOUT_OPTIONS`):
- **`hierarchy`** — Rolle über den **Gerätetyp** (`TIER_ORDER` in
  `buildHierarchyPositions`: firewall→router→switch→…), die Rechenzentrums-Sicht.
- **`hops`** — Rolle über den **Hop-Abstand zur Graph-Mitte** (Doppel-BFS in
  `buildHopTierPositions`): Kern 0, Verteilung 1, Zugang 2 — genau das
  Core→Distribution→Access-Bild, und die Heuristik, die ein Campusnetz trennt,
  wo alle drei Ebenen `switch` sind. `auto` wählt es ab 150 Knoten selbst.

Beide brechen breite Tiers seit 5.5.95 mehrzeilig um (sichtbar auch bei 2000+
Knoten, siehe den 1000+-Hosts-Eintrag). Was offen BLIEBE, wäre nur eine
*dritte* Heuristik (z. B. Namensmuster `core-*`/`dist-*`) — bisher ohne Bedarf.

### Rollen/Berechtigungen für geteilte Layouts

Greift in die Zwei-Ebenen-Logik ein, die `ci:layers` bewacht, und in Zabbix'
eigenes Rechtemodell. Hoher Aufwand, macht die Logik dauerhaft komplizierter.

### Undo/Redo fürs Layout — GEBAUT (5.6.0)

**GEBAUT (5.6.0), auf die ANORDNUNG beschränkt.** Strg/Cmd+Z nimmt einen
Knoten-Drag (oder einen Layout-Wechsel) zurück, Strg/Cmd+Shift+Z (oder Strg+Y)
stellt wieder her; dazu zwei Toolbar-Buttons (↶/↷), die bei leerem Stapel
ausgrauen. Snapshot-basiert (`layout-history.js`, volle Positionskarte je
Schritt, Cap 60), robust gegen Knoten, die zwischen Schritten kommen/gehen; die
Historie überlebt einen In-Place-Refresh und setzt nur bei echtem View-Wechsel
zurück (andere Knotenmenge). In Focus-Mode visuell, nicht persistiert (wie dort
jede Positions-Speicherung). Speichern entprellt. **Live am Lab abgenommen**
(nt-last, 3002 Hosts): Tastatur + Buttons + exakte Positions-Wiederherstellung,
0 Konsolenfehler. Unit-getestet; vier Code-Review-Funde nachgezogen.

Offen bleibt der ursprüngliche, größere Vorschlag — ein Befehlsstapel über
ALLES Editierbare: manuelle Links, Pins und Notizen sind noch nicht im Stapel.
Die Anordnung ist der häufigste und zugleich riskanteste Edit, deshalb zuerst.

### CDP-only (Cisco) — validiert und aufgelöst (5.5.38)

**Erledigt.** CDP war im Modul schon umgesetzt — `LldpEdgeBuilder`/`MetricExtractor`
werten `cdpCacheDeviceId`/`cdpCacheDevicePort`, den 2-teiligen CDP-Index (erster
Teil = ifIndex, gegen LLDP 3-teilig) und den Aruba-CDP-MAC-Fall aus. Offen waren der
Nachweis am lebenden Gerät und eine Lücke, die erst echte Cisco zeigten.

**Live gemessen (2026-10-18, zwei Cisco Small Business):** beide geben
`cdpCacheDeviceId` her, die Verbindung ist beidseitig über CDP sichtbar. Schlüssel­
befund: auf einem ist der **LLDP-SysName leer** — nur CDP trägt den Nachbarn, und die
CDP-Device-ID kommt als **MAC**, nicht als Name. Genau die CDP-Daseinsberechtigung
(in Cisco-Umgebungen ist LLDP oft schwach, CDP füllt die Lücke). Aufgekommen nach
Andrew Wojnareks Summit-'26-Talk „Topology at Scale".

**Dabei fiel eine Lücke auf — und wurde gefixt (5.5.38):** eine CDP-Device-ID-MAC
löste bis dahin nur auf, wenn ein *anderer* Switch dieselbe MAC schon zusammen mit
einem Namen gemeldet hatte; ein reiner CDP-only-Nachbar ohne Namenssichtung wurde
ein Geist. Jetzt sammelt jeder Host seine **eigene** MAC (`nt.self.chassis` =
lldpLocChassisId, `nt.self.basemac` = dot1dBaseBridgeAddress), und der Chassis-
Resolver trifft die MAC direkt auf den besitzenden Host — auf der Hauptkarte wie im
Host+Hops-Graphen. Am echten Cisco belegt: aus dem Geist wurde eine **bestätigte**
Kante. Braucht den Template-Re-Import (zwei neue Items).

Offen bleibt nur das Feinere: MSTP/PVST je VLAN-Instanz (teils VLAN-Kontext-
Community) — derselbe Schritt wie beim Spanning-Tree oben.

---

## Geprueft und verworfen

Vorschlaege, die einzeln geprueft und **nicht** weiterverfolgt werden. Sie
stehen hier mit dem Grund, damit sie nicht alle paar Monate neu aufkommen — und
damit sichtbar bleibt, dass sie angesehen und nicht ueberlesen wurden.

| Vorschlag | Warum nicht |
|---|---|
| **MIB-Auto-Erkennung** (Cisco-, Aruba-, Extreme-Varianten selbst erkennen) | Falsche Schicht. Das Modul spricht kein SNMP — `LldpEdgeBuilder` liest `lastvalue` und `key_`, nie eine OID. Welche MIB abgefragt wird, entscheidet das Template. Der Wunsch heisst „mehr Templates". |
| **Hostname-Zuordnung „automatisch lernen"** | Eine gelernte falsche Zuordnung ist klebrig: sie ueberlebt die Korrektur der Ursache und verliert ihre Herkunft. Mit einem Confidence-Score festhalten, WIE zugeordnet wurde, statt DASS. Der FQDN-/Kurznamen-Teil laeuft ohnehin seit jeher. |
| **Neighbor Inventory Cache** | **Gemessen, und der Verdacht stimmte halb.** Hier stand "erst messen" mit der Vermutung, die Zeit haenge an den Zabbix-API-Aufrufen und nicht am Kantenbauen. Der Lasttest (1000 Geraete, 1425 Kanten, 43.200 Items) sagt: Kantenbauen 33 ms von 1581 ms — zwei Prozent, der Verdacht war dort richtig. Die API (`items:get`) ist aber auch nur 26 %; die Mehrheit lag mit 86 % beim SQL fuer die letzten Werte, und das ist seit 5.4.2 auf ein Viertel gefallen (Fenster-Scan mit Rueckfall). Ein eigener Nachbar-Cache braeuchte es demnach nicht: gespeichert wuerde das Billige, und das Teure bliebe. Was sich lohnt, steht in der Diag-Zeile — `items:` neben `edges:`, dreissig Nachschlaege je gezeichneter Kante. |
| **Stabilitaets-Score ueber 30 Tage** | Nicht selbst speichern. Zabbix IST eine Zeitreihen-Datenbank, und `tools/topo-change-sender.sh` schiebt Aenderungen bereits als Items dorthin — dann liefert Zabbix Auswertung, Trends und Trigger ohne eine Zeile Speicher-Code. |
| **Port-ID-Normalisierung als eigener Schritt** | Nicht vor dem Confidence-Score. Sie erzeugt zwangslaeufig Fehltreffer, und eine falsche Kante ist schlimmer als eine fehlende — sie sieht aus wie eine Messung. |
| **Raw-LLDP-Inspector** (alle TLVs je Kante) | Die Roh-TLVs liegen nicht vor; erhoben werden gezielte OIDs. Dieselbe Vorbedingung wie beim Chassis-Subtype, und ueberschneidet sich mit dem Vendor Debug Profile. |
| **LLDP-MED, VLAN, LAG** (Voice-VLAN, PVID, Aggregation, MTU) | Fachlich reizvoll, aber durchweg neue SNMP-Items: mehr Polling, wieder ein Template-Re-Import, und VoIP ist eine andere Zielgruppe als der Rest der Karte. Steht hinter allem, was mit vorhandenen Daten auskommt. |
| **Vendor Debug Profile mit Rohwerten** | Nicht in dieser Form: die Werte sind Nachbarnamen aus dem Netz des Nutzers. Falls doch, dann als **Form** statt Wert — Schluesselname, Laenge, maskiertes Zeichenmuster, erkannter Subtype. Das beantwortet „dieser Hersteller schreibt eine MAC in die PortId", ohne einen Namen preiszugeben. |
| **Bundle nach Sprache trennen** | Nachgemessen, und die Zahl traegt nicht: beide Woerterbuecher kosten roh 33 KB, ueber die Leitung aber nur **10,3 KB** (105,6 → 95,3 KB gzip). Es sind dieselben 572 Schluessel in derselben Reihenfolge, gzip komprimiert sie gegeneinander weg. Dagegen stuenden ein zweites eingechecktes Bundle, ein zweites Drift-Gate und Aenderungen an View, Paketbau und `deploy.sh` — fuer 10 KB, die der Browser einmal holt. Die vermeintlich elegantere Variante, das Woerterbuch als eigene Datei daneben, ist mit 107,0 KB sogar **schlechter als heute**: allein verliert es die Querkompression, und ein Request kommt dazu. Auch die 72 unuebersetzten deutschen Strings (13 %) bringen nur 2,1 KB roh und wuerden die `ci:i18n`-Regel „dieselben Schluessel in beiden Dateien" kosten. |


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

- ~~**Farbe ist oft der einzige Träger von Zustand.**~~ — **erledigt in 5.3.1**
  (`ff542cf`). Severity hängt jetzt an der Ringstärke **und** an gezählten
  Kerben (eine bei Warning bis vier bei Disaster), Offline am ✕, Wartung am
  gestrichelten Ring plus Schlüssel-Badge. Bei den Kanten unterscheiden sich
  Down, Errors und Discards zusätzlich in Strichmuster und Breite, und die
  Heatmap trägt die Größenordnung in der Linienbreite. Nachgeprüft am
  2026-09-23, nicht nur abgehakt.

- ~~**Wartung und Offline sind beide ein ✕**~~ — **ebenfalls erledigt in
  5.3.1**, im selben Commit. Der „vereinfachte" Schraubenschlüssel, von dem
  nur ein ✕ übrig war, ist ein offener Schlüsselkopf mit einer Diagonale als
  Griff; die Legende zeigt den orange gestrichelten Ring statt eines ◐, das
  auf der Karte nie vorkam. Dieser Eintrag stand hier noch, als beides längst
  gebaut war — genau der Fall, vor dem der Kopf dieser Datei warnt.

- **Fullscreen:** Promise-Behandlung und Beschriftung sind repariert; **warum
  Chrome ablehnt**, ist ungeklärt.

[#2]: https://github.com/linuser/zabbix-network-topology/issues/2
[#3]: https://github.com/linuser/zabbix-network-topology/issues/3
[#4]: https://github.com/linuser/zabbix-network-topology/issues/4
