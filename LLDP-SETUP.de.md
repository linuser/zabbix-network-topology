# LLDP/CDP Topology-Setup — Network Topology for Zabbix

Wie das Modul aus LLDP/CDP-Daten die **Verbindungen (Kanten)** zeichnet, und was du auf
Switches, Clients und in Zabbix tun musst.

**🇬🇧 [English](LLDP-SETUP.md) · 🇩🇪 Deutsch**

> Maßgeblich ist die englische Fassung — dorthin zeigen alle Verweise aus README,
> INSTALL und den Issue-Antworten. Diese Übersetzung wird nachgezogen; weicht sie
> ab, gilt [LLDP-SETUP.md](LLDP-SETUP.md).

> **Du siehst Knoten, aber keine Kanten?** Die Antwort steht fast immer hier — meist
> ist es fehlendes LLDP, fehlendes SNMP oder ein Namens-Mismatch. Der **LLDP-Q-Tab**
> im Modul zeigt pro Host, woran es hakt (siehe [Troubleshooting](#warum-fehlen-kanten-troubleshooting)).

---

## Wie Kanten entstehen (das mentale Modell)

Das Modul liest pro Zabbix-Host ein Item, dessen **Wert der/die Nachbar-System-Name(n)**
ist — die LLDP/CDP-Nachbar-Tabelle des Geräts. Für jeden gemeldeten Nachbarn versucht es,
den Namen auf einen **anderen Zabbix-Host** aufzulösen. Klappt das, entsteht eine Kante.

> **Kante A–B = „Die Nachbar-Tabelle von A nennt B — und B ist ein überwachter Host mit
> passendem Namen."**

Zwei Konsequenzen, die man kennen muss:

- **Beide Endpunkte müssen überwachte Zabbix-Hosts sein.** Ein Nachbar, der nicht in Zabbix
  ist, erzeugt keine Kante.
- **Der Reporter braucht eine abfragbare Nachbar-Tabelle.** Ein Gerät, das LLDP nur *sendet*,
  aber die Nachbar-Tabelle nicht führt/nicht per SNMP herausgibt, meldet **selbst keine
  Nachbarn** → keine Kanten von ihm aus. Es erscheint nur, wenn seine Nachbarn *es* melden.

---

## Welche Items das Modul liest

Erkannt wird ein Item, dessen **Key** eines davon enthält (Wert = Nachbar-SysName, auch
Komma-/Zeilen-/Pipe-Liste mehrerer Nachbarn):

| Key enthält | Quelle |
|---|---|
| `lldpRemSysName` | **LLDP** (IEEE 802.1AB) — SNMP-Standard, OID `1.0.8802.1.1.2.1.4.1.1.9` |
| `cdpCacheDeviceId` | **CDP** (Cisco Discovery Protocol) — SNMP |
| `neighbor.sysName` | Generisch / Ubiquiti UniFi (z. B. via Controller-API) |
| `discovery.neighbor` | MikroTik & andere / custom |
| `uplink.id` (exakter Key) | **UniFi Network API** — Controller-Sicht, siehe unten |

Der Wert wird an `,`, Zeilenumbruch und `|` gesplittet — ein einzelnes Item darf also eine
Liste aller Nachbarn enthalten.

> **Sonderfall UniFi (`uplink.id`):** Ubiquiti gibt die LLDP-Nachbartabelle per SNMP in der
> Regel **nicht** heraus — die Topologie kennt nur der Controller. Das offizielle
> *UniFi Network API*-Template holt sie per JSONPath `$.uplinkDeviceId` aus `details.json`
> in ein Item `uplink.id` („an welchem Gerät hänge ich"). Dessen Wert ist die **Geräte-UUID**
> des Uplinks — und weil dasselbe Template seine Hosts technisch nach eben dieser UUID
> benennt, löst das normale Namens-Matching sie direkt auf den richtigen Host auf. Quelle
> erscheint im LLDP-Q-Tab als `unifi`.
>
> Zwei Einschränkungen, die man kennen muss: Es ist die **Controller-Sicht**, kein
> Geräte-Protokoll (fällt der Controller aus, veraltet die Topologie). Und es funktioniert
> nur, solange die Hosts **nach der UUID benannt** sind — benennt deine Discovery sie anders,
> trifft das Matching nicht. `uplink.rx`/`uplink.tx` (Per-Link-Traffic) wertet das Modul
> derzeit **nicht** aus.

---

## Was du tun musst

### 1. Auf Switches / Routern / Firewalls
- **LLDP einschalten** (`lldp run` global + ggf. pro Interface). Cisco: **CDP ist default an**.
- **SNMP aktivieren** (v2c/v3), damit Zabbix die LLDP-MIB (`lldpRemSysName`) bzw. CDP-MIB lesen kann.

### 2. Auf Clients / Servern
- **`lldpd` installieren** (`apt install lldpd` / `pkg install lldpd`). Damit annonciert sich
  der Server selbst → der Switch listet ihn **mit Namen** (statt nur MAC), und die Kante
  Switch↔Server entsteht.
- **Hostname = Zabbix-Hostname.** Der annoncierte SysName muss zum Zabbix-Host passen (siehe unten).
- **Windows** sendet LLDP meist nicht von sich aus → dort trägt v. a. die Switch-Seite + Namens-/IP-Matching.

### 3. In Zabbix
- **SNMP-LLD** auf dem Switch: die `lldpRemSysName`-Tabelle discovern → Item-Prototyp
  `lldpRemSysName[{#SNMPINDEX}]` (ein Item pro Nachbar). Viele **Vendor-Templates bringen das
  schon mit** — vorher unter *Latest Data* nach `lldpRemSysName`-Items schauen.
- **Turnkey:** das Template [`nt_lldp_snmp_template.yaml`](https://raw.githubusercontent.com/linuser/zabbix-network-topology/main/templates/nt_lldp_snmp_template.yaml)
  importieren und an SNMP-Switches linken — bringt LLDP- **und** Cisco-CDP-Discovery fertig mit
  (Macros `{$NT.LLDP.INTERVAL}` / `{$NT.LLDP.DISCOVERY.INTERVAL}`).

  Es liegt **nicht** im Modul-ZIP: das Modulverzeichnis ist über den Web-Root
  öffentlich abrufbar, dort gehört nur Laufzeit-Code hin. Direkt holen:

  ```bash
  curl -fLO https://raw.githubusercontent.com/linuser/zabbix-network-topology/main/templates/nt_lldp_snmp_template.yaml
  ```
- **Nach dem Linken nicht auf die Karte schauen, sondern auf die Discovery.**
  Das ist der mit Abstand häufigste Grund für „LLDP funktioniert nicht":

  | Makro | Default | heißt |
  |---|---|---|
  | `{$NT.LLDP.DISCOVERY.INTERVAL}` | **3h** | so lange kann es dauern, bis die Nachbarn *gefunden* werden |
  | `{$NT.LLDP.INTERVAL}` | **1h** | so lange, bis ihre Werte *aktuell* sind |

  Template dranhängen, Karte neu laden, nichts sehen — und daraus schließen,
  dass es nicht geht: verständlich, aber verfrüht. Zabbix hat schlicht noch
  nicht gefragt. Erzwingen:

  > *Data collection → Hosts → \<Switch\> → **Discovery rules** → **LLDP
  > neighbor discovery** → **Execute now***

  Danach unter *Latest data* nach `lldpRemSysName` filtern. **Erst wenn dort
  Werte stehen, kann das Modul Kanten zeichnen** — vorher ist die Karte
  zwangsläufig leer, und kein Modul-Neuladen ändert daran etwas.

  Bei vielen Switches: die Regel lässt sich in der Hostliste mehrfach
  markieren und in einem Rutsch ausführen.
- **Namens-Matching ist der Dreh- und Angelpunkt.** Das Modul löst den Nachbar-Namen in dieser
  Reihenfolge auf:
  1. exakter **Host-/Anzeigename** (case-insensitiv)
  2. **IP-Adresse**
  3. bereinigter Name (Vendor-Suffixe wie `(Serial)` entfernt)
  4. reverse-DNS-Muster `ip-10-0-0-5` → extrahierte IP
  5. **eindeutiger** Short-Name (erster Teil vor dem `.`)

  → Best Practice: **Zabbix-Hosts so benennen wie die Geräte-Hostnames** (oder SNMP-Interface-IP
  passend setzen). Mehrdeutige Short-Names (mehrere Hosts gleicher Kurzname) erzeugen **keine**
  Kante — sie landen im LLDP-Q-Tab als *ambiguous*.
- **Port-Labels an beiden Enden** (optional, seit v4.35): der *lokale* Port kommt aus dem
  Item-Key-Bracket (`lldpRemSysName[0.24.1]` → mittlere Zahl = lokaler Port; `lldp.rem.sysname[eth0]`
  → `eth0`), der *Remote*-Port aus `lldpRemPortId`/`lldpRemPortDesc` mit demselben SNMPINDEX
  (PortDesc bevorzugt — PortId kann eine MAC sein). Mehr unter
  [Port-zu-Port](#port-zu-port--per-link-weathermap).

---

## Vendor-Matrix — was liefert Kanten?

Nicht jedes Gerät gibt seine Nachbar-Tabelle per SNMP heraus. Grobe Einordnung (im Zweifel
mit dem [Test unten](#der-test-der-alles-entscheidet) verifizieren):

| Vendor / Linie | SNMP + LLDP-Neighbor-Tabelle? | Fürs Modul | Hinweis |
|---|---|---|---|
| **HP Aruba** (AOS-Switch / AOS-CX) | ✓ voll | **funktioniert** | Standard-LLDP-MIB |
| **HP ProCurve** (alt, z. B. 2500) | ⚠ teils nur Senden | eingeschränkt | Alt-Serien senden LLDP, führen aber teils **keine** abfragbare Nachbar-Tabelle |
| **TP-Link Omada / JetStream** (*managed*) | ✓ | **funktioniert** | volles NOS mit SNMP + LLDP-MIB |
| **TP-Link Easy Smart** (TL-SG2008P, …E) | ✗ kein SNMP | **keine Kanten** | „dumb switch"-Fall → manuell |
| **TP-Link unmanaged** | ✗ | unsichtbar | Geräte erscheinen direkt verbunden, Switch fehlt |
| **Ubiquiti EdgeSwitch / EdgeMax** | ✓ meist | **funktioniert** | EdgeOS, ordentliches SNMP |
| **Ubiquiti UniFi** (USW/UDM) | ✗ oft **gar kein** SNMP | **funktioniert via API** | LLDP lebt im Controller → offizielles *UniFi Network API*-Template liefert `uplink.id`, das Modul liest es direkt |
| **Cisco** (IOS/NX-OS) | ✓ | **funktioniert** | CDP default an, LLDP opt-in (`lldp run`) |
| **Huawei** (VRP, z. B. S5700) | ✓ | **funktioniert** | an einer S5700 im Produktivnetz bestätigt. VRP beantwortet die Standard-LLDP-MIB — die Default-SNMP-View kann sie aber verdecken, siehe unten. Das offizielle *Huawei VRP by SNMP*-Template sammelt die Nachbar-Tabelle **nicht** |
| **MikroTik** (RouterOS) | ? | **ungeprüft** | Der Modulcode hat einen Haken für `discovery.neighbor`, aber **kein RouterOS-Gerät hat das je bestätigt** — siehe unten |

> **Huawei: der Fall, der den häufigsten Irrtum zeigt.** Gemeldet aus einem
> Produktivnetz mit S5700-Switches: LLDP auf den Geräten aktiv, Namen passend,
> trotzdem ein Kreis ohne eine einzige Kante. Kein Modulfehler — die Kette hat
> drei Glieder, und das mittlere fehlte:
>
> ```
> Switch (LLDP an)  →  Zabbix-Items  →  dieses Modul
> ```
>
> Das Modul spricht **kein SNMP**. Es liest Items. Das offizielle *Huawei VRP by
> SNMP*-Template legt für die LLDP-Nachbartabelle keine an, also fragt Zabbix
> den Switch nie danach. Dasselbe gilt für die Standard-Templates von Cisco und
> HP: LLDP am Gerät einschalten ist nur die halbe Miete, ohne
> `nt_lldp_snmp_template.yaml` (oder eigene Items) bleibt die Karte leer.
>
> **Am Gerät entschieden.** Der Melder hat `nt_lldp_snmp_template.yaml` gelinkt,
> die Discovery angestoßen — und die Kanten waren da. VRP beantwortet die
> IEEE-Standard-LLDP-MIB; die Zeile oben ist jetzt eine Messung, keine Erwartung.
>
> **Ein Schritt mehr war aber nötig, und er ist leicht zu übersehen.** Auf seinen
> Switches lagen die LLDP-OIDs gar nicht in der SNMP-View: `snmpwalk` lieferte
> nichts, während LLDP nachweislich lief. VRP bringt eine eingeschränkte
> Default-View mit, und was nicht in der View steht, existiert für SNMP nicht.
> Zwei Kommandos beheben das:
>
> ```
> snmp-agent mib-view include iso-view iso
> snmp-agent community read <SNMP_COMMUNITY> mib-view iso-view
> ```
>
> Das ist im Prinzip nichts Huawei-Spezifisches — jedes Gerät mit eingeschränkter
> SNMP-View verhält sich so. Es sieht exakt aus wie „der Switch kann kein LLDP",
> und deshalb gehört es in den ersten Test und nicht ins Kleingedruckte.
>
> Quelle: [Issue #2](https://github.com/linuser/zabbix-network-topology/issues/2),
> vom Melder am 31.08.2026 bestätigt.

> **MikroTik: was hier Behauptung ist und was Messung.** Die Zeile stand lange
> als „funktioniert" in dieser Tabelle. Belegt ist davon nur die eine Hälfte:
> Das Modul **sucht** nach Items mit `discovery.neighbor` im Schlüssel und
> verarbeitet sie, wenn sie kommen. Ob RouterOS die LLDP-Nachbartabelle über
> normales SNMP herausgibt oder ob man dafür ein eigenes Item bauen muss, ist
> **an keinem Gerät geprüft worden** — es gibt weder Test noch Fixture dafür.
>
> Wer RouterOS betreibt, kann das in fünf Minuten klären und uns damit weiter
> bringen als jede Vermutung: Liefert `snmpwalk` auf
> `1.0.8802.1.1.2.1.4.1.1.9` (`lldpRemSysName`) Werte? Wenn ja, funktioniert
> der Standardweg wie bei Cisco und HP. Wenn nein, braucht es ein Item, dessen
> Schlüssel `discovery.neighbor` enthält — und dann ist die Frage, was
> darinsteht. Beides ist eine nützliche Antwort.

> **UniFi im Detail:** UniFi baut LLDP für den *eigenen* Controller, nicht fürs externe
> SNMP-Polling. In der Praxis ist es sogar deutlicher: Auf einer **UDM Pro Max** mit aktiviertem
> SNMP kam auf `sysDescr` (v1 *und* v2c, Community `public`) **gar keine Antwort** — obwohl das
> Gerät pingbar war. Der SNMP-Schalter in der Network-App aktiviert SNMP auf den *adoptierten
> Geräten*, nicht auf der Konsole selbst; und Ubiquiti baut SNMP seit Jahren zurück. Auf einen
> LLDP-Walk gegen UniFi sollte man also nicht bauen.
>
> **Der Weg, der trägt:** das offizielle **UniFi Network API**-Template. Es legt pro Gerät/Client
> ein Item **`uplink.id`** an (JSONPath `$.uplinkDeviceId` aus `details.json`) — die Geräte-UUID
> des Uplinks. Da dasselbe Template seine Hosts nach der UUID benennt, löst das Modul die Kante
> ohne Zusatzarbeit auf: **Template dranhängen genügt**, keine eigenen Items bauen. Quelle im
> LLDP-Q-Tab: `unifi`. (Die Community ist bei UniFi übrigens fest `public` und nicht einstellbar
> — deshalb fehlt das Feld in der UI.)

---

## Der Test, der alles entscheidet

Nicht raten — **snmpwalk die LLDP-Nachbar-Tabelle** und schau, ob Namen zurückkommen:

```bash
snmpwalk -v2c -c <community> <switch-ip> 1.0.8802.1.1.2.1.4.1.1.9
```

(`…4.1.1.9` = `lldpRemSysName`.)

- **Namen kommen zurück** → das Modul zieht daraus Kanten. ✓
- **leer / „No Such Object"** → dieser Switch liefert **keine** Kanten via SNMP
  (Easy Smart, UniFi-ohne-API, sende-nur-Geräte) → [manuell ergänzen](#lücken-schließen-manuell).

CDP-Äquivalent (Cisco): `1.3.6.1.4.1.9.9.23.1.2.1.1.6` (`cdpCacheDeviceId`).

---

## Port-zu-Port & Per-Link-Weathermap

Ab **v4.35** trägt jede LLDP-Kante nicht nur den *lokalen* Port des meldenden Switches,
sondern auch den **Remote-Port** am Nachbar-Ende — und, wo die Datenlage passt, die
**gemessene** Auslastung des physischen Links (Weathermap-Modus) statt einer Schätzung aus
den Host-Traffic-Summen.

**Was das Modul dafür liest** (bringt das mitgelieferte Template automatisch mit):

| Item-Key | OID | Wozu |
|---|---|---|
| `lldpRemPortId[{#SNMPINDEX}]` | `1.0.8802.1.1.2.1.4.1.1.7` | Remote-Port (kann je PortIdSubtype eine MAC sein) |
| `lldpRemPortDesc[{#SNMPINDEX}]` | `1.0.8802.1.1.2.1.4.1.1.8` | Remote-Port-Klartext — **bevorzugt** fürs Label |
| `cdpCacheDevicePort[{#SNMPINDEX}]` | `1.3.6.1.4.1.9.9.23.1.2.1.1.7` | Remote-Port bei CDP |
| `net.if.in[ifHCInOctets.<ifIndex>]` / `…out` | Interface-MIB | Per-Link-Traffic (Standard-SNMP-Interface-Monitoring) |

Der Remote-Port korreliert über **denselben `{#SNMPINDEX}`** wie der Nachbar-SysName; der
lokale Port ist die mittlere Zahl des LLDP-Index (`…[TimeMark.LokalPort.RemIndex]`).

**Voraussetzung für die *gemessene* Weathermap** (nicht nur die Labels): der lokale
LLDP-Port muss dem **ifIndex** entsprechen, unter dem der Switch seinen Interface-Traffic
zählt. Auf Aruba/ProCurve ist das 1:1. Passt es nicht, bleiben die Port-**Labels** trotzdem —
nur die Kante fällt auf die Node-Summen-**Schätzung** zurück (kein Fehler). Verifizieren:

```bash
snmpwalk -v2c -c <community> <switch-ip> 1.0.8802.1.1.2.1.4.1.1.7   # lldpRemPortId
snmpwalk -v2c -c <community> <switch-ip> 1.0.8802.1.1.2.1.4.1.1.8   # lldpRemPortDesc
```

Kommen Werte zurück → Port-zu-Port geht. Ob der Index-`<LokalPort>` als
`net.if.in[ifHCInOctets.<LokalPort>]` existiert, entscheidet über die *gemessene* Auslastung.

> **CDP:** Der CDP-`{#SNMPINDEX}` ist zweiteilig (`cdpCacheIfIndex.devIndex`). Das Modul liest
> den lokalen Port aus dem *ersten* Teil (= ifIndex) — Remote-Port-Labels **und** gemessene
> Per-Link-Auslastung funktionieren damit auch bei reinem CDP.

> **Default- vs. %-Weathermap:** Der Weathermap-**%-Modus** normiert jede Kante auf ihre
> Kapazität und ist die konsistente Vergleichssicht. Der Default-**Absolut**-View färbt nach
> Roh-Traffic — Port-zu-Port-Kanten mit *gemessener* Per-Link-Zahl stehen dort neben Kanten
> mit *geschätzter* Node-Summe; für den direkten Farbvergleich zwischen Kanten also den
> %-Modus nutzen.

---

## Warum fehlen Kanten? (Troubleshooting)

### Zuerst: die Frage, die alles halbiert

Bevor du im Modul suchst — **gibt es überhaupt LLDP-Items?** *Monitoring →
Latest data*, Filter `lldpRemSysName`:

- **Keine Treffer** → das Problem liegt **vor** dem Modul, in Zabbix oder am
  Gerät. Weiter bei [„Was du tun musst", Schritt 3](#3-in-zabbix) — meist fehlt
  das Template oder die Discovery lief noch nicht (Default **3h**, mit
  *Execute now* erzwingen).
- **Treffer, aber die Karte bleibt leer** → das Problem liegt im
  **Namens-Matching**. Weiter mit dem LLDP-Q-Tab unten.

Diese eine Minute spart den größten Teil der Fehlersuche. „Kein Item" und „Item
passt zu keinem Host" sehen im Modul identisch aus — als Kreis ohne Kanten —
haben aber nichts miteinander zu tun.

### Dann: der LLDP-Q-Tab

Öffne den **LLDP-Q-Tab** im Modul — er zeigt pro Host:

- **matched** — Nachbar sauber einem Host zugeordnet ✓
- **unmatched** — Nachbar-Name löst auf **keinen** Host auf
- **ambiguous** — Short-Name passt auf **mehrere** Hosts → keine Kante (sonst Zufallszuordnung)

Häufigste Ursachen:

| Symptom | Ursache | Fix |
|---|---|---|
| Host hat `matched: 0` | Switch führt keine Nachbar-Tabelle (Easy Smart, sende-nur, kein SNMP) | snmpwalk-Test; ggf. manuell |
| Nachbar *unmatched* | annoncierter SysName ≠ Zabbix-Hostname | Hosts umbenennen / SNMP-IP passend |
| Server taucht nicht als Nachbar auf | kein `lldpd` auf dem Server | `lldpd` installieren |
| Nachbar *ambiguous* | mehrere Hosts mit gleichem Kurznamen | eindeutige (FQDN-)Namen |
| gar keine LLDP-Items | keine SNMP-LLD / Template ohne LLDP | LLD-Regel für `lldpRemSysName` anlegen |
| Template gelinkt, trotzdem keine Items | **Discovery lief noch nicht** — Default sind 3h | *Discovery rules → LLDP neighbor discovery → **Execute now*** |
| Vendor-Template gelinkt, keine LLDP-Items | die offiziellen Templates (Huawei VRP, Cisco IOS, HP) sammeln die Nachbar-Tabelle **nicht** | zusätzlich `nt_lldp_snmp_template.yaml` linken |
| `snmpwalk` liefert nichts, obwohl LLDP läuft | die OIDs liegen nicht in der **SNMP-View** des Geräts | Huawei VRP: `snmp-agent mib-view include iso-view iso` und `snmp-agent community read <community> mib-view iso-view`. Andere Hersteller: View entsprechend erweitern |

---

## Lücken schließen (manuell)

Für alles, was LLDP/SNMP nicht hergibt (Easy-Smart-Switches, unmanaged, UniFi-ohne-API,
sende-nur-Geräte) bleibt die **Deklaration von Hand**. Bewährt hat sich
**LLDP-Backbone + gezielte manuelle Ergänzung** — so bekommst du die Selbst-Aktualität von
LLDP *und* die Vollständigkeit der Handarbeit.

### Was passiert mit Geräten, die gar nichts melden?

Zwei Fälle, die sich unterschiedlich auswirken:

**Ein unmanaged Switch ist meist unsichtbar.** Er spricht kein LLDP, reicht die Frames aber
durch, weil er sie nicht verarbeitet. Die gemanagten Geräte links und rechts sehen dadurch
*sich gegenseitig* und erscheinen direkt verbunden. Topologisch falsch — die Aussage „diese
beiden hängen zusammen" stimmt aber trotzdem.

**Eine Firewall ohne LLDP ist der unangenehmere Fall.** Sie wird überwacht, erscheint also als
Knoten — aber ohne Kanten. Sie liegt als **Insel** auf der Karte, obwohl der halbe Verkehr
durch sie läuft.

### Die drei Werkzeuge

**1. Host-Tag `nt:parent=<hostname>`** — der empfohlene Weg. Am Host ein Tag mit dem Namen des
Geräts setzen, an dem er hängt:

```
nt:parent = fw-core
```

Ein normales Zabbix-Host-Tag, also **serverseitig** gespeichert und für alle Benutzer sichtbar.
Gedacht für Träger-Beziehungen (VM→Hypervisor, Container→Node), funktioniert aber genauso für
„dieser Host hängt hinter dieser Firewall". Die Ausfallsimulation behandelt es als **harte
Abhängigkeit**: Fällt der Parent, fällt der Child — unabhängig vom Netzpfad.

**2. Manuelle Links** im Star-Mode direkt in der Karte ziehen. Seit 5.0 **serverseitig**, in zwei
Ebenen: Zeichnet ein **Super-Admin**, gilt die Kante für alle. Zeichnet jemand anderes, ist sie
seine persönliche Notiz — folgt ihm aber über Browser und Rechner hinweg. In der Karte sind beide
unterscheidbar, die geteilte kräftiger gestrichelt.
> Damit taugen manuelle Links auch für eine *gemeinsame* Topologie. Wo ein `nt:parent`-Tag besser
> passt: es ist eine **harte Abhängigkeit** in der Ausfallsimulation, ein manueller Link nur eine
> Kante auf der Karte. Für „hängt hinter dieser Firewall" nimm das Tag, für „hier liegt ein Kabel,
> das keiner meldet" den Link.

**3. Ghost-Knoten** decken den umgekehrten Fall ab: Meldet ein Nachbar ein Gerät, das in Zabbix
gar nicht überwacht wird, erscheint es als gestrichelter Platzhalter (Toggle in der Toolbar,
Default aus). So wird die Lücke **sichtbar**, statt zu verschwinden.

### Wichtig für die Ausfallsimulation

Die Simulation kennt **nur die Kanten, die sie bekommen hat**. Daraus folgen zwei Dinge:

- Ein Gerät, das nicht im Graphen steht, kann nicht als Ausfallpunkt simuliert werden.
- Eine handgezeichnete Kante, die nicht der Realität entspricht, macht die Simulation
  **zuverlässig falsch** — sie meldet dann Hosts als „sicher", die es physisch nicht sind.

Für die Pfade, auf die es wirklich ankommt, lohnt sich deshalb ein Gegencheck: Sind die Kanten
**gemessen** oder **angenommen**?
