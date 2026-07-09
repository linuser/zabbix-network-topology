# LLDP/CDP Topology-Setup — Network Topology for Zabbix

Wie das Modul aus LLDP/CDP-Daten die **Verbindungen (Kanten)** zeichnet, und was du auf
Switches, Clients und in Zabbix tun musst.

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

Der Wert wird an `,`, Zeilenumbruch und `|` gesplittet — ein einzelnes Item darf also eine
Liste aller Nachbarn enthalten.

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
- **Port-Labels** (optional) kommen aus dem Item-Key-Bracket: `lldpRemSysName[0.24.1]` → mittlere
  Zahl = lokaler Port; `lldp.rem.sysname[eth0]` → `eth0`.

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
| **Ubiquiti UniFi** (USW/UDM) | ⚠ SNMP schwach | **API-Weg** | LLDP lebt im Controller (Inform), nicht im SNMP → Controller-API → `neighbor.sysName` |
| **Cisco** (IOS/NX-OS) | ✓ | **funktioniert** | CDP default an, LLDP opt-in (`lldp run`) |
| **MikroTik** (RouterOS) | ✓ | **funktioniert** | via SNMP oder `discovery.neighbor`-Item |

> **UniFi im Detail:** UniFi baut LLDP für den *eigenen* Controller, nicht primär fürs externe
> SNMP-Polling — die `lldpRemTable` kommt per SNMP oft leer. Besser die **UniFi-Controller-API**
> anzapfen (Zabbix HTTP-Agent-Item, das die Nachbar-SysNames als Wert liefert). Das Modul erkennt
> dafür die Keys `neighbor.sysName` / `discovery.neighbor` — die Datenquelle musst du nur bauen.

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

## Warum fehlen Kanten? (Troubleshooting)

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

---

## Lücken schließen (manuell)

Für alles, was LLDP/SNMP nicht hergibt (Easy-Smart-Switches, unmanaged, UniFi-ohne-API,
sende-nur-Geräte) bleibt die **Deklaration von Hand** — der bewährte Ansatz ist
**LLDP-Backbone + gezielte manuelle Ergänzung**:

- **Star-Mode-Handverknüpfungen** (Manuelle Links) — Verbindungen im UI selbst ziehen.
- **`nt:parent`-Tag** — Containment-Beziehungen (VM→Hypervisor, Container→Node), die LLDP
  ohnehin nie sieht.

So bekommst du die Selbst-Aktualität von LLDP **und** die Vollständigkeit der Handarbeit,
ohne dass die Karte von der Realität wegdriftet.
