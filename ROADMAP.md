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
| **Problem Impact / Root Cause** | **Fertig** (`root-cause.js`, 190 Zeilen). Zweimal BFS vom Uplink: Ursache = ausgefallener Host mit noch erreichbarem Nachbarn („Frontier"), Folge = ausgefallener Host dahinter. Erreichbare Hosts werden nie markiert, bei redundanten Pfaden teilen sich mehrere Frontier-Hosts die Opfer. Overlay rot (`nt-rc-cause`) / amber (`nt-rc-victim`), Knopf „🔍 Root cause" im Tools-Menü, Banner mit Ursachen- und Opferzahl. **Aber: im Betrieb nie nachgemessen** — siehe unten. |
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

- **Root Cause** — braucht einen ausgefallenen Host mit Geräten dahinter. Auf
  der Wegwerf-Instanz sind alle sechs Hosts erreichbar; ein Agent müsste
  gestoppt werden. Eine halbe Stunde.
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
