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

### 1. Interface-Ansicht beim Klick auf eine Kante — **Schritt 1 erledigt**

`edge-detail.js` (5.3): Klick auf eine Kante oeffnet ein bleibendes Panel mit
Ports beider Enden, Traffic, Auslastung und dem Interface-Zustand
aufgeschluesselt. **Schritt 2 steht weiter offen** (Errors/Drops/Link-Uptime als
eigene Items, Sparklines) — unten steht, was dafuer noch fehlt.

Der Vorbehalt ist beim Bauen nicht verschwunden, sondern **sichtbar geworden**:
das Panel schreibt an die Zahl, ob sie am Port gemessen oder aus den
Knotensummen geschaetzt ist, und bei gemeldeten Ports ohne zuordenbare Metrik
steht daneben warum. Eine Zahl ohne ihre Herkunft ist in dieser Ansicht
schlimmer als keine.


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

### 4. Suche über mehr als den Anzeigenamen — **erledigt**

Die Karte benutzt jetzt dieselbe Suchsprache wie die Tabelle (`query.js`):
bare Token treffen Name **und** IP, dazu Feldsuche (`type:switch`,
`group:"core sites"`), Negation, ODER und Klammern. Es war ein Import und ein
ersetzter Handler — die Sprache lag fertig da und war nur nie angeschlossen.

Die Feld-Strings hängen per `scratch()` am Knoten, weil der Handler bei jedem
Tastendruck über alle Knoten läuft; ab der Performance-Schwelle (400) wäre das
sonst spürbar.

Alles Weitere braucht neue Daten: MAC und LLDP-Nachbar (siehe ARP/FDB unten),
Seriennummer (Inventory `serialno_a`, wird heute nicht geladen), VLAN (siehe
dort), Zabbix-Host-ID (liegt vor, nur nicht durchsucht).

**Danach: „Locate on topology"** — bei einem Treffer hinspringen statt nur zu
dimmen. Das Dimmen gibt es schon.

### 5. Teilbare Deep Links — **erledigt**

`?nt_tab=<tab>` steht jetzt im Link und wird bei jedem Wechsel mitgeschrieben.
Reihenfolge URL vor localStorage; ein fremder Wert fällt zurück statt ins Leere
zu laufen, und `replaceState` statt `pushState` hält die History sauber.

Damit ist praktisch jede Ansicht teilbar: Hostgruppen, Tabellenfilter, Tab, und
mit PR #8 auch Host + Hops.

**Weiterhin offen, bewusst:** Zoom und Ausschnitt der Karte (ein Link, der beim
Empfänger einen anderen Bildschirm trifft, zeigt einen sinnlosen Ausschnitt) und
ein Anker auf ein einzelnes Problem — dafür gibt es keinen; der Link zeigt
sinnvoller auf den Host.

### 6. Layout-Import — neu entwerfen

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

### 7. Pfad als Liste — **erledigt**

`path-list.js` (5.3): der berechnete Pfad steht nach "Path to here" als Liste
im Detail-Panel, in Leserichtung Start → Ziel, mit Ports, Auslastung und einem
Warnzeichen an jedem Link, der Ports down, Fehler oder Verworfene meldet.

Die Zwischenschritte lagen die ganze Zeit vor — `_findPath` rekonstruiert sie
ueber parent-Pointer —, sie wurden nur zum Einfaerben benutzt und danach
verworfen. Neu ist `getLastPath()`, das sie in Leserichtung behaelt.

**Die offene Frage war, was "Zustand je Link" heisst.** Beantwortet wie im
Kanten-Panel, damit beide dasselbe sagen: Ports, Auslastung aus derselben
Stufentabelle, und ob die Zahl gemessen oder geschaetzt ist.

**Weiter offen:** der *implizite* Start ("Pfad zu diesem Host", ohne A zu
waehlen). Der braucht eine Festlegung, was der Ausgangspunkt ist; `whatif.js`
und `root-cause.js` benutzen dafuer schon eine Uplink-Referenz.


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

### Einstellbare Traffic-Schwellen — **erledigt**

Kam aus [Issue #9](https://github.com/linuser/zabbix-network-topology/issues/9)
und ist mit [PR #10](https://github.com/linuser/zabbix-network-topology/pull/10)
in 5.2.0 drin — beides von christos-diamantis. Ich hatte den Punkt hier
abgelegt, weil er einen Ort braucht, an dem eine Installation ihre Werte
hinterlegt; der PR nimmt `module.config` und die neue Action
`network.topology.scales`, also genau die Ebene, die für die geteilten
Positionen schon existiert.

Offen geblieben ist dabei eines: die Skalen sind die **einzige** der fünf
schreibenden Actions ohne Revisionsprüfung. Zwei Super-Admins überschreiben
sich still. Die Einsätze sind klein — eine Handvoll Zahlen gegen eine ganze
Kartenanordnung —, aber es ist eine Ausnahme von einer Regel, die der Rest
einhält.

### LLDP-Qualitaet: Confidence, Einseitigkeit, Alterung

Ein Vorschlagspaket von christos-diamantis (2026-09-02). Es ist gross, aber
nicht gleichmaessig — ein Teil ist bereits gebaut, ein Teil braucht neue Items,
und ein Teil ist erstaunlich nah dran. Sortiert nach dem, was nachgesehen
wurde, nicht nach der Reihenfolge im Vorschlag.

#### Schon vorhanden — nicht neu bauen

- **FQDN-/Kurznamen-Abgleich.** `sw01.example.local` ↔ `sw01` funktioniert
  seit jeher: `LldpEdgeBuilder` normalisiert Gross-/Kleinschreibung, schneidet
  an Leerzeichen und Klammern ab, entfernt die FQDN-Wurzel und vergleicht
  zusaetzlich den Kurznamen. Der Kopfkommentar der Datei sagt es ausdruecklich.
- **Capabilities zur Typbestimmung.** Seit 5.1.0. Vierstufig, erste gewinnt:
  `nt:icon`-Tag, Namens-/Template-Muster, LLDP-Capability, „fuehrt selbst eine
  Nachbartabelle". Stufe 3 greift **nur**, wenn Stufe 2 im server-Fallback
  gelandet ist — sonst wuerde ein L3-Switch namens `rtr-core-01` vom
  Bridge-Bit zum Switch umgestempelt.
- **Merge ueber Protokolle.** Meldet die Gegenseite oder CDP dieselbe Kante,
  ergaenzt der Merge-Zweig Quellen, Ports und Metrik (first-wins je Feld). Die
  gemeinsame Struktur, die der Vorschlag unter „Multi-Protocol Neighbor Fusion"
  fordert, existiert im Kern also — sie heisst `src` und traegt heute
  `['lldp','cdp']`.

#### Braucht zuerst neue Items — das ordnet die Liste um

`lldpRemChassisIdSubtype` und `lldpRemManAddr` werden **nicht erhoben**.
Nachgesehen: null Treffer in `topology/`, `actions/` und den Templates.

Das ist der Knackpunkt bei zwei Vorschlaegen. **Chassis-ID normalisieren** ohne
den Subtype ist Raten — erst der Subtype sagt, ob dort eine MAC, eine
Netzadresse, ein Interface-Name oder eine lokale ID steht. Und die
**Management Address** ist ohne ihr Item schlicht nicht da.

Beides heisst: Template-Aenderung, also Re-Import bei jedem Nutzer. Das ist
machbar (5.1.1 hat genau das getan), aber es ist kein Nachmittag, und es
gehoert vor die darauf aufbauenden Ideen.

#### Der staerkste Punkt, und er ist EIN Feld entfernt

**Beidseitig bestaetigte Kanten.** Der Merge-Zweig weiss bereits, dass eine
Kante ein zweites Mal gemeldet wurde — er schreibt es nur nicht auf. Ein
`reporters`-Set an der Kante, im Merge gesetzt, und die Unterscheidung steht:

    ✓ bestaetigt     beide Seiten melden einander
    → einseitig      nur eine Seite sieht den Nachbarn
    ✎ manuell        von Hand gezogen

**Die naheliegende Abkuerzung waere falsch**, und das ist der Grund, warum es
hier steht statt einfach gebaut zu werden: `count(ports) === 2` beweist es
NICHT. Ein einzelner Melder traegt beide Ports ein — seinen lokalen und den
vom Nachbarn gelernten. Zwei Eintraege sind also kein Beleg fuer zwei Melder.
Es braucht das explizite Set.

Darstellung ist da: das Kanten-Panel (5.3) zeigt schon die Herkunft, die
Legende hat eine Zeile fuer Kanten, und `ci:layers` kann so etwas pruefen.

#### Confidence-Score

Aufbauend auf dem Vorigen. Die Rohsignale liegen vor: `matched`, `ambiguous`
mit Kandidatenliste, `unmatched`, dazu Ports und kuenftig `reporters`.

**Wichtiger als die Skala ist, wofuer sie da ist:** Eine Normalisierungsschicht
fuer Port-IDs (`Gi1/0/1` ↔ `GigabitEthernet1/0/1` ↔ `1/0/1`) erzeugt
zwangslaeufig Fehltreffer, und **eine falsche Kante ist schlimmer als eine
fehlende** — sie sieht aus wie eine Messung. Mit einem Score daneben wird aus
dem Risiko eine Auskunft. Deshalb: Score zuerst, Normalisierung danach.

#### Alterung / stale neighbors

Verschwindet ein Nachbar, ihn nicht sofort loeschen, sondern fuer eine
konfigurierbare Zeit als `stale` fuehren. Loest ein echtes Aergernis: die
Topologie springt bei kurzen LLDP-Aussetzern.

Beruehrt `topo_changes`, das heute schon berechnet und **nur als Toast**
gemeldet wird — siehe „Topology-Diff auf der Karte hervorheben". Die beiden
gehoeren zusammen gedacht; getrennt gebaut ergaeben sie zwei Halbloesungen.

#### LLDP-MED, VLAN, LAG

VLAN/PVID, Aggregation, Auto-Negotiation, MTU, und LLDP-MED fuer Telefone
(Voice-VLAN, Geraetekategorie, Standort). Fachlich das Reizvollste im Paket.

Trotzdem zuletzt: es sind durchweg **neue SNMP-Items**, also mehr Polling und
wieder ein Template-Re-Import — und LLDP-MED bedient eine andere Zielgruppe
(VoIP) als der Rest der Karte. Hoher Aufwand, schmalerer Nutzen als die vier
Punkte darueber, die mit vorhandenen Daten auskommen.

**Reihenfolge, die ich vorschlagen wuerde:** Einseitigkeit → Confidence →
Alterung (mit dem Topology-Diff) → Chassis-Subtype und Management-Address →
Port-Normalisierung → LLDP-MED.

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
