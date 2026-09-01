# Changelog

Änderungen ab dem ersten öffentlichen Release. Versionsschema: MAJOR.MINOR.PATCH.
*Changes since the first public release. Versioning: MAJOR.MINOR.PATCH.*

## v5.1.1 — unveröffentlicht

### Fixed

- **Die Installationsanleitung stellte den schwersten Weg nach vorn.** Schritt 1
  war 93 Zeilen lang — Verzeichnis-Layouts, Rechte, SELinux, Service-Namen,
  Installation ohne Internet — während `nt-install.sh`, das genau das alles
  selbst erledigt, nur in drei Fußnoten vorkam. Wer neu ist, liest also die
  Handarbeit und erfährt erst danach, dass es sie nicht gebraucht hätte.

  Jetzt stehen vorn vier Befehle mit dem Skript (rund 20 Zeilen inklusive
  Erklärung), und die Handarbeit steht vollständig darunter in einem
  aufklappbaren Block. **Nichts davon ist gelöscht** — die 93 Zeilen sind hart
  erarbeitet, SELinux ist laut eigener Troubleshooting-Tabelle der häufigste
  Grund für „Modul erscheint nicht". Sie stehen nur nicht mehr im Weg.

  Beide Sprachfassungen. Die verwendeten URLs sind gegengeprüft: die
  `releases/latest/download`-Adresse liefert 712 KB, das Skript 20 KB.

- **Die mitgelieferten Templates trugen deutsche Beschreibungen.** Nicht in
  Kommentaren, sondern in `description:`-Feldern — also genau dem Text, den
  Zabbix nach dem Import in der Oberfläche anzeigt. Wer der inzwischen
  englischen Anleitung folgte, bekam deutsches Zabbix. `nt_health_score` und
  `nt_topology_change` sind umgestellt (je vier Beschreibungen, darunter die
  mehrzeilige Template-Beschreibung).

  `nt_lldp_snmp_template.yaml` mit seinen 27 Stellen folgt, sobald
  [PR #5](https://github.com/linuser/zabbix-network-topology/pull/5) gemerged
  ist — der baut dieselbe Datei gerade um, und zwei parallele Umbauten an einer
  Datei ergeben nur Konflikte.

- **„Modul" wurde als „Widget" gelesen.** Bei Zabbix sind die meisten
  Community-Module Dashboard-Widgets, und genau so verstand mancher auch dieses
  — obwohl das Hauptmodul eine **eigene Seite** unter *Monitoring → Network
  Topology* ist und die fünf Widgets nur optionale Zugabe sind, die ohne das
  Hauptmodul gar nicht laufen. Das stand bisher erst in Schritt 3 der
  Installationsanleitung. Jetzt steht es im README im ersten Absatz, in beiden
  Sprachen, mit einer Tabelle: was erforderlich ist, was optional, und was
  jeweils vorausgesetzt wird.

- **Der Geo-Tab stürzte ab, sobald kein Host Koordinaten hatte.**
  `render-geo.js` ruft `esc()` dreimal im Leerzustand auf, importiert es aber
  nicht aus `utils.js`. esbuild bündelt so etwas klaglos — der freie Name landet
  im Bundle, und zur Laufzeit kommt `ReferenceError: esc is not defined`. Die
  Bedingung ist alltäglich: eine Hostgruppe ohne Geokoordinaten reicht.
  Gefunden hat es **@christos-diamantis** beim Debuggen von etwas ganz anderem.

  Der eigentliche Fund ist aber, dass es durch zwölf Gates gekommen ist: ESLint
  lief hier nur mit `no-unsanitized`, und `no-undef` war nicht aktiviert. Das ist
  es jetzt — mit einer ausdrücklichen Liste der 25 Fremd-Globals, die dieses
  Modul voraussetzt (Browser, Cytoscape, Leaflet, Zabbix' `CWidget`), statt einer
  neuen Abhängigkeit. Gegengeprüft, dass die Regel den Fehler auch wirklich
  fängt: Import wieder entfernt → drei Meldungen, Import zurück → sauber.

- **Die Huawei-Zeile der Vendor-Matrix ist jetzt eine Messung.** Sie stand auf
  „ungeprüft", weil kein S5700 zum Gegenchecken da war und es auch keine
  öffentliche SNMP-Aufzeichnung eines solchen Geräts mit LLDP-Daten gibt — die
  sechs Huawei-Walks im LibreNMS-Bestand sind Richtfunk, USV und
  Stromversorgung. Der Melder aus [Issue #2](https://github.com/linuser/zabbix-network-topology/issues/2)
  hat es am Gerät entschieden: Template gelinkt, Discovery angestoßen, Kanten
  da. VRP beantwortet die IEEE-Standard-LLDP-MIB.

- **Die SNMP-View war die zweite Hürde — und sie stand in keiner Zeile Doku.**
  Auf einigen seiner Switches lieferte `snmpwalk` nichts, obwohl LLDP
  nachweislich lief: die LLDP-OIDs lagen gar nicht in der View des Geräts. Was
  nicht in der View steht, existiert für SNMP nicht. Auf VRP:

      snmp-agent mib-view include iso-view iso
      snmp-agent community read <community> mib-view iso-view

  Steht jetzt im Huawei-Kasten und als eigene Zeile in beiden
  Troubleshooting-Tabellen. Huawei-spezifisch ist daran nichts — jedes Gerät
  mit eingeschränkter SNMP-View verhält sich so. Es ist dieselbe Fehlerklasse
  wie das 3-Stunden-Discovery-Intervall aus 5.1.0: eine Ursache, die niemand
  sieht, weil sie wie ein kaputtes Feature aussieht.

### Added

- **`tools/nt-lldp-probe.sh` — ein Kommando statt drei Vermutungen.** Der nackte
  `snmpwalk` steht seit jeher in der Anleitung und ist eine Zeile lang. Das
  Problem war nie der Aufruf, sondern die **leere Antwort**: sie kann heißen,
  dass das Gerät nicht erreichbar ist, dass die SNMP-View die LLDP-MIB verdeckt,
  oder dass die Tabelle schlicht noch leer ist. Drei völlig verschiedene
  Ursachen, ein identisches Bild — und die Verwechslung kostet Nachmittage,
  siehe oben.

  Das Skript macht deshalb drei Abfragen statt einer, benennt den Fall und
  druckt einen fertigen Bericht. Es **liest nur** und **sendet nichts
  irgendwohin**; die einzige Verbindung geht an die IP, die der Aufrufer
  übergibt. Die Community wird per Umgebungsvariable oder verdeckter Eingabe
  entgegengenommen, nie als Argument — Argumente stehen in der History und sind
  für jeden sichtbar, der `ps` aufrufen kann. Der Bericht enthält **Anzahlen,
  keine Nachbarnamen** und nie die Community: es gibt also nichts zu schwärzen.
  Nachgemessen mit einer `snmpwalk`-Attrappe über alle vier Fälle.

  Liegt in `tools/` und ist damit **nicht im Modul-ZIP** — ein Shell-Skript
  gehört nicht unter den Web-Root. Geholt wird es per `curl`, wie
  `topo-change-sender.sh` und die Template-YAMLs auch.

- **Eine zweite Issue-Vorlage: „Device report".** Bisher gab es nur „Bug
  melden", und eine Geräte-Rückmeldung ist kein Fehler — wer bloß bestätigt,
  dass sein Aruba funktioniert, öffnet dafür ungern ein Bug-Ticket. Die Vorlage
  fragt genau die Felder ab, die eine Matrix-Zeile brauchen, darunter **Zabbix-
  und Modulversion getrennt** (die Item-Erfassung hat sich zwischen Releases
  geändert, und den LLDP-Q-Tab gibt es erst ab 5.1.0). Sie lädt **negative**
  Ergebnisse ausdrücklich ein: ein „✗ keine abfragbare Nachbartabelle" erspart
  dem Nächsten denselben Nachmittag. Und sie verlangt vor dem Absenden die
  Bestätigung, dass keine Community, keine Hostnamen und keine IPs im Text
  stehen.

## v5.1.0 — 2026-08-30

### Update von 5.0 — „Scan directory" ist Pflicht

5.1 bringt drei neue Actions mit: `network.topology.links`,
`network.topology.positions` und `network.topology.portscan`. Zabbix
registriert Actions beim **Scannen** des Modulverzeichnisses, nicht beim
Kopieren der Dateien. Wer die Dateien austauscht und *Administration → General
→ Modules → Scan directory* auslässt, bekommt eine Karte, die lädt — und
manuelle Verbindungen sowie die gespeicherte Knotenanordnung, die mit „Unknown
action" stehenbleiben. Die alte Version lief, die neue nicht, und niemand
verbindet das mit einem vergessenen Menüpunkt.

`nt-install.sh update` vergleicht deshalb die Action-Listen von alter und neuer
Version und sagt es dazu, wenn welche hinzugekommen sind; bisher wies nur der
Erstinstallations-Pfad auf „Scan directory" hin. `nt-install.sh check` nennt
außerdem die installierte Version und die vorhandenen Widgets mit ihren eigenen
Versionsnummern — die Widgets werden von diesem Skript nicht mitinstalliert und
bleiben beim Aktualisieren sonst unbemerkt liegen.

Gespeichertes bleibt: Kartenanordnung und manuelle Kanten liegen serverseitig,
Pins, Notizen und Presets im `localStorage` des Browsers. Es gibt nichts zu
migrieren — auch das Revisionsfeld gegen konkurrierendes Speichern ergibt sich
aus dem Inhalt und wird nirgends abgelegt.

Wer von **4.x** kommt, findet die Umbenennung des Verzeichnisses unter v5.0.0
weiter unten; `nt-install.sh update` räumt den Altbestand selbst weg.

### Added

- **Gleichzeitiges Bearbeiten überschreibt nichts mehr.** Beide Ebenen —
  manuelle Kanten und Kartenanordnung — speichern den *vollständigen* Zustand,
  nicht ein Delta. Zwei Tabs desselben Benutzers oder zwei Super-Admins:

      A lädt, B lädt, A verschiebt einen Knoten und speichert,
      B verschiebt einen anderen und speichert — A's Änderung ist weg.

  Niemand bekam einen Fehler; der Verlust fiel erst beim nächsten Laden auf und
  sah dann nach einem Modulfehler aus. Der Client schickt jetzt die Revision
  mit, auf der seine Änderung beruht, und der Server lehnt ab statt zu
  überschreiben — mit einem Hinweis und dem aktuellen Stand in der Antwort.

  Die Kennung ergibt sich aus dem Inhalt, es gibt also kein neues gespeichertes
  Feld und nichts zu migrieren. Vor dem Hashen wird rekursiv sortiert: die
  *Menge* zählt, nicht die Schreibreihenfolge — sonst meldeten zwei Clients
  einen Konflikt, die inhaltlich dasselbe gespeichert haben.

- **Gekappte Verbindungen werden gemeldet.** `ManualLinks` begrenzt auf 2000
  Kanten und brach bisher stillschweigend ab: Wer 2500 speicherte, bekam „ok"
  und merkte beim nächsten Laden, dass 500 fehlen. Die Positionen melden ihr
  Kappen seit 5.1; die Kanten tun es jetzt auch. Ebenso gemeldet wird die
  Grenze von 50 **Ansichten** bei den Positionen — bisher zählte der Wert nur
  verworfene Knoten und meldete „0 gekappt", während ganze Ansichten wegfielen.

- **Automatisierter Teil des Clean-Install-Tests** (`tools/clean-install-test/smoke.sh`):
  Modul paketieren, echtes Zabbix 7.4 hochfahren, Modul hineinmounten und
  prüfen, ob das Frontend antwortet, ob der Code unter der PHP-Version des
  Zabbix-Images sauber ist und ob die Assets über den Web-Root kommen. Als
  CI-Job **manuell** ausgelöst, weil er Docker-in-Docker braucht. Das Aktivieren
  des Moduls und das Rendern bleiben manuell — Zabbix hat keine API für
  „Scan directory".

- **Manuelle Verbindungen liegen jetzt auf dem Server, nicht mehr im
  `localStorage`.** Bisher waren die handgezogenen Kanten an einen Browser
  gebunden: weg beim Cache-Leeren, unsichtbar für Kollegen, weg auf dem
  Zweitrechner. Sie liegen jetzt in **zwei Ebenen**:

  | Ebene | Speicher | schreibt | sieht es |
  |---|---|---|---|
  | geteilt | `module.config` | nur Super-Admins | alle |
  | persönlich | `CProfile` des Users | jeder für sich | nur er selbst |

  Wer die geteilte Karte pflegen darf, pflegt sie auch: ein Super-Admin zeichnet
  in die geteilte Ebene, alle anderen in ihre persönliche. Beide werden beim
  Laden zusammengeführt, geteilte Kanten gewinnen bei Dopplung. In der Karte
  sind sie unterscheidbar — geteilt kräftiger und länger gestrichelt.

  Die Rechtegrenze ist keine Design-Entscheidung, sondern Zabbix: `CModule`
  prüft in `update()` hart auf `USER_TYPE_SUPER_ADMIN`. Gelesen wird
  `module.config` deshalb **nicht** über die API — die verweigert
  Nicht-Super-Admins auch das Lesen — sondern über den ModuleManager, in dem
  Zabbix die Config beim Bootstrap ohnehin schon liegen hat.

  Vorhandene `localStorage`-Links wandern beim ersten Aufruf einmalig in die
  persönliche Ebene, sofern serverseitig noch nichts liegt. Der alte Eintrag
  bleibt als Sicherheitsnetz stehen, wird aber nicht mehr gelesen.

  Kein Host-Tag wie bei `nt:parent`: ein Link darf auf einen **Ghost-Knoten**
  zeigen — einen per LLDP gemeldeten Nachbarn, den es in Zabbix gar nicht gibt.
  Ein Tag bräuchte einen Host, den es hier nicht gibt.

  Geschrieben wird über die neue Action `network.topology.links` (POST, eigener
  CSRF-Token, Drosselung, `USER_TYPE_ZABBIX_USER` für die persönliche und
  Super-Admin für die geteilte Ebene). Das Frontend schreibt optimistisch: die
  Kante erscheint sofort, scheitert der POST, wird zurückgerollt und der Fehler
  gemeldet — sonst stünde eine Kante auf dem Schirm, die es serverseitig nicht
  gibt.

  `tests/ManualLinksTest.php` deckt die Validierung ab (21 Prüfungen). Zwei
  Regeln sind dabei leicht zu übersehen: der **Pipe** ist in Node-IDs verboten,
  weil persönliche Links als `s|t` je einer `CProfile`-Zeile liegen; und das
  Paar wird **sortiert** abgelegt, weil eine Kante ungerichtet ist und `{a,b}`
  sonst neben `{b,a}` landet.

- **Kennzahlen-Zeile über der Karte.** Sechs Zahlen auf einen Blick: Hosts,
  OK/Warn/Krit., Kanten und nicht überwachte Nachbarn. Standardmäßig als
  kompakte Chips (~40 px), im Wallboard-Modus (`?wallboard=1`) als große
  Kacheln — unter der Zeile liegt kein Scrollbereich, sondern der Graph, und
  Höhe die oben weggeht fehlt ihm dauerhaft.

  Zwei der Zahlen gab es bisher nirgends: **Kanten** nach Herkunft
  aufgeschlüsselt (manuell gezogen, aus LLDP/CDP, zu Ghosts) und **Ghosts** —
  per LLDP gemeldete Nachbarn ohne Host in Zabbix. Alles aus dem Graphen
  gelesen, kein Backend, keine neue Action.

  Nebenbei entfernt: `updateBadge()` in `render-tech.js` wollte seit v4.18.3
  Zahlen in ein Element `#nt-badge` schreiben, das **in der gesamten Historie
  nie erzeugt wurde** — die Funktion stieg bei jedem Aufruf in Zeile 2 aus, die
  Zahlen hat nie jemand gesehen. Mit ihr fällt die einzige unterdrückte
  `no-unsanitized`-Stelle der Datei weg.

- **Zwei neue Dashboard-Widgets.** Damit liefert das Paket fünf:
  - **NT KPI** — dieselben Kennzahlen als Kachel, wahlweise als Ring
    (Severity-Verteilung mit der Host-Zahl in der Mitte) oder als Raster.
  - **NT Items** — ein Item-Muster über alle Hosts der gewählten Gruppen
    gepivotet: Hosts als Zeilen, passende Keys als Spalten. Festes Muster im
    Formular statt der interaktiven Auswahl des Haupt-Tabs; auf einer Kachel
    gibt es diese Interaktion nicht.

  Beide bauen mit `createElement`/`textContent` statt `innerHTML` und brauchen
  deshalb keinen Eintrag in `eslint-suppressions.json`.

- **Die Kartenanordnung liegt jetzt auf dem Server — mit einer geteilten
  Ebene.** Wo die Knoten liegen, lag bisher im `localStorage`: an einen Browser
  gebunden, weg beim Cache-Leeren, und jeder ordnete sich seine eigene Karte.

  Zwei Ebenen wie bei den manuellen Links: ein **Super-Admin** pflegt *die*
  Karte — die, die alle sehen, die man in ein Ticket verlinkt, die im Wallboard
  hängt. Jeder andere weicht persönlich davon ab.

  Der Unterschied zu den Links steckt im Zusammenführen: die persönliche Ebene
  gewinnt **pro Knoten**, nicht als Ganzes. Wer drei Geräte verschiebt, behält
  drei eigene Positionen — alles andere folgt weiter der geteilten Karte, auch
  wenn ein Admin sie später neu ordnet. Gespeichert wird bei Nicht-Admins nur
  die **Abweichung**; läge dort die volle Anordnung, verdeckte sie die geteilte
  Ebene für immer.

  Positionen hängen an der Gruppenauswahl, deshalb ist der View-Schlüssel Teil
  der Struktur — mit eigenem Eintrag für die Group-View, die eigene
  Pseudo-Knoten hat. Vorhandene `localStorage`-Anordnungen wandern beim ersten
  Aufruf einmalig in die persönliche Ebene, sofern serverseitig für diese
  Ansicht noch nichts liegt.

  Geschrieben wird über die neue Action `network.topology.positions` (POST,
  eigener CSRF-Token, Drosselung). `tests/NodePositionsTest.php` deckt die
  Validierung mit 23 Prüfungen ab — der View-Schlüssel wird dabei genauso
  streng geprüft wie die Knoten-IDs: wäre er frei wählbar, könnte ein Client
  `module.config` mit beliebigen Schlüsseln vollschreiben.

  **Pins und Notizen bleiben vorerst im `localStorage`.**

- **Aus einem unüberwachten Nachbarn einen Host machen.** Ghost-Knoten haben
  jetzt ein eigenes Kontextmenü mit Herkunftsangabe (welcher Host sie per
  LLDP/CDP gemeldet hat) und — für Admins — einem Eintrag, der Zabbix' eigenes
  Host-Formular **vorbefüllt** öffnet: Name, aktuelle Hostgruppe, Herkunft in
  der Beschreibung.

  Angelegt wird der Host bewusst nicht von uns: keine schreibende Action, keine
  eigene Rechteprüfung, keine halb angelegten Hosts. Zabbix validiert, legt an
  und lehnt ab. Bisher fielen Ghosts in den Host-Zweig des Menüs und bekamen
  Einträge wie „Latest Data", die für einen nicht existierenden Host
  zwangsläufig ins Leere führen.

- **Hersteller, Gerätetyp und MAC unüberwachter Nachbarn.** „Aus einem Ghost
  einen Host machen" scheitert in der Praxis an einer simplen Frage: *was ist
  das Ding überhaupt?* Ein Name wie `CNQ6KD51WK` beantwortet sie nicht.

  Das LLDP-Template erhebt deshalb drei Felder mehr, die die Switches ohnehin
  melden — System-Beschreibung (`.10`), Capabilities (`.12`) und Chassis-ID
  (`.5`). Daraus werden im Ghost-Menü Hersteller, Gerätetyp und MAC. Die
  Capabilities sind eine OCTET-STRING-Bitmap; sie wird defensiv decodiert und
  liefert im Zweifel lieber nichts als eine falsche Behauptung.

  Wer das Template schon gelinkt hat, bekommt die Felder mit der nächsten
  Discovery. Fehlen sie, ändert sich nichts — alle drei sind optional, und viele
  Geräte melden nur einen Teil.

- **Gerätetyp aus dem Protokoll statt aus einer Herstellerliste.** Gemeldet
  wurde: Cisco-Switches landen unter „Server / virtualization" statt unter
  „Switch". Die Ursache war nicht ein fehlender Eintrag, sondern der Ansatz.
  `deviceType()` rät aus Hostname und Template-Namen, und die Muster waren
  gegen ausgedachte Namen geschrieben — an einer echten Installation
  nachgezählt trafen sie **2 von 14** offiziellen Zabbix-Netzwerk-Templates.
  Auch `mikrotik routeros` ging ins Leere, weil das Template „MikroTik by
  SNMP" heißt.

  Die Liste zu verlängern wäre die falsche Antwort: allein für Cisco führt
  Zabbix neun Templates, davon sind zwei (UCS, UCS Manager) Server — ein
  Muster `cisco` würde die falsch einsortieren. Stattdessen beantwortet das
  Protokoll die Frage. Die **LLDP-Capabilities** nach IEEE 802.1AB sagen
  `Bridge`, `Router` oder `WLAN AP`, und zwar herstellerunabhängig; das Modul
  decodierte sie bereits, aber nur für nicht überwachte Nachbarn.

  Vier Stufen, erste gewinnt:

  | | Signal |
  |---|---|
  | 1 | `nt:icon`-Tag |
  | 2 | Name- und Template-Muster (unverändert) |
  | 3 | LLDP-Capability, die ein Nachbar meldet |
  | 4 | führt selbst eine Nachbartabelle → Netzwerkgerät |

  Stufe 3 und 4 greifen **nur**, wenn Stufe 2 im `server`-Fallback gelandet
  ist. Andersherum wäre es riskant: ein Host namens `rtr-core-01` meldet als
  L3-Switch auch das Bridge-Bit und würde vom Protokoll zum Switch
  umgestempelt, obwohl der Name die Absicht kennt. So ändert sich an keinem
  Host etwas, der heute richtig erkannt wird.

  `tests/DeviceTypeTest.php` hält die Reihenfolge fest, mit echten
  Template-Namen aus einer 7.4-Installation statt erfundenen.

- **Ein Deinstallations-Skript, das auch die Reste benennt.** `nt-uninstall.sh`
  entfernt Hauptmodul und Widgets — und zeigt danach, was serverseitig
  liegenbleibt. Das war nötig, seit die Karte serverseitig gespeichert wird:
  die **geteilte** Ebene räumt sich selbst ab, weil `module.config` eine Spalte
  der `module`-Zeile ist und mit ihr stirbt. Die **persönliche** hängt am
  Benutzerprofil und überlebt jede Deinstallation, ohne dass es jemand merkt.

  ```bash
  ./nt-uninstall.sh --dry-run     # zeigt nur, ändert nichts
  ./nt-uninstall.sh --purge       # räumt zusätzlich das Benutzerprofil
  ```

  Verzeichnisse werden **verschoben**, nicht gelöscht — nach
  `/var/backups/nt-uninstall-<datum>/`, mit ausgegebenem Rückhol-Befehl.
  Angefasst wird nur, wessen `manifest.json` eine `network_topology`-ID trägt;
  ein fremdes Modul, das zufällig `widget/` heißt, bleibt liegen. Alte
  `_v6`-Verzeichnisse aus 4.x kommen mit — auch solche, die nach dem
  Quellordner benannt sind.

  Host-Tags, Templates, Cron und Monitoring-User bleiben **unberührt**. Das sind
  selbst angelegte Daten; `nt:parent` beschreibt die Infrastruktur des Nutzers,
  nicht das Modul. Das Skript zählt sie auf und gibt das SQL aus, ausführen muss
  es jemand selbst.

- **Dienste-Probe auf Klick.** Im Kontextmenü eines Hosts liegt ein Eintrag, der
  eine feste Liste von 11 Ports prüft (SSH, Telnet, HTTP/S, SNMP, SMB, LPD, RDP,
  Proxmox, HTTP-alt, JetDirect) und *offen* / *abgewiesen* / *Zeitüberschreitung*
  unterscheidet — die drei Zustände sind verschiedene Aussagen, „abgewiesen"
  heißt: da ist ein Gerät, nur nicht dieser Dienst.

  Bewusst eng gehalten: läuft nur auf Klick und nie von selbst, die Portliste
  steht im Server-Code und ist vom Client nicht wählbar, der Client schickt
  **nur eine hostid** — die Adresse löst der Server über die Zabbix-API auf,
  damit die Rechte des Benutzers greifen —, es braucht mindestens
  Zabbix-Admin, und es ist auf 5 Aufrufe pro Minute und Benutzer gedrosselt.
  0,4 s je Port, also 4,4 s im schlechtesten Fall.

  Gedacht als „was ist diese Kiste", nicht als Scanner.

### Changed
- **Die Widgets folgen jetzt Zabbix' eigenem Update-Zyklus.** Alle liefen mit
  eigenem `setInterval` (30/30/60 s), während die Basisklasse `CWidget`
  parallel periodisch die View-Action rief und den Widget-Körper durch frisches
  View-HTML ersetzte — den „Loading…"-Platzhalter, den der eigene Timer erst
  bis zu 60 s später überschrieb. Die Widget-Kacheln fielen dadurch regelmäßig
  auf „Loading…" zurück.

  Sie überschreiben jetzt `promiseUpdate()`. Damit gilt die
  Refresh-Einstellung des Dashboards statt drei fest verdrahteter Zahlen, und
  bei inaktiver Seite pausiert der Zyklus von selbst.

- **Versionssprung bei den drei bestehenden Widgets** — NT Topology auf 3.1.0,
  NT Health Score und NT Table auf 2.1.0. Ihr JavaScript wurde um 266 Zeilen
  umgebaut (Update-Zyklus, geteilter Datenzugriff), die Versionsnummer war
  dabei stehengeblieben. Wer aktualisiert hätte, sähe in der Modulliste
  dieselbe Nummer bei anderem Verhalten und könnte installiert nicht von
  veraltet unterscheiden.

- **Einheitliche Namen.** Im Dashboard-Menü heißen die Widgets durchgehend
  `NT …` (Zabbix sortiert alphabetisch — ohne gemeinsames Präfix standen sie an
  drei Stellen der Liste). In der Modulliste tragen alle eine englische
  Beschreibung in gleicher Form; das Graph-Widget hieß dort nur „— Widget" und
  heißt jetzt „— Topology Widget". Nur Anzeigetexte: die Widget-IDs bleiben,
  bestehende Kacheln behalten ihren gespeicherten Titel.

### Fixed

- **Die geteilte Ebene ging ungefiltert an jeden Benutzer.** Die Topologie
  kommt aus der Zabbix-API und ist rechtegefiltert; die geteilte Karte liegt in
  `module.config` und kannte keine Rechte. Sichtbar wurde davon nichts — das
  Frontend zeichnet eine Kante nur zwischen vorhandenen Knoten — aber im
  ausgelieferten JSON standen Host-IDs aus fremden Gruppen, Gruppen-IDs in den
  Ansichts-Schlüsseln und per LLDP annoncierte Gerätenamen aus Netzteilen ohne
  Zugriff. Wird jetzt gegen die sichtbaren Hosts und Gruppen gefiltert.

- **Ohne APCu wurde überhaupt nicht gedrosselt.** Das Rate-Limit begann mit
  „kein APCu → durchlassen". Für die lesenden Actions vertretbar, für den
  Portscan nicht: er arbeitet synchron, elf Ports mal Timeout blockieren einen
  PHP-Worker mehrere Sekunden, und das Limit von 5 pro 60 s existierte ohne
  APCu schlicht nicht — während INSTALL.md APCu ausdrücklich als optional
  führt. Fällt jetzt auf ein gleitendes Fenster in der Session zurück.

- **Fehlermeldungen gingen ungeprüft an den Client.** Die Actions für Kanten
  und Positionen reichten jede Exception-Meldung durch; DB-, Schema- und
  TypeError-Texte können Pfade, Klassen- und Spaltennamen enthalten. Jetzt wie
  bei den Wartungsfenstern: nur Zabbix-API-Meldungen gehen raus, der Rest ins
  Serverlog. Dabei auch `catch (Throwable)` statt `catch (Exception)` — ein
  TypeError wurde vorher gar nicht gefangen.

- **Der Diagnose-Ringpuffer verlor Einträge unter Last.** Lesen, anhängen,
  zurückschreiben ist nicht atomar; zwei gleichzeitige Requests überschrieben
  sich. Jetzt ein echter Ringpuffer über atomar vergebene laufende Nummern.

- **Die CI lief 32 Commits lang gar nicht.** Eine explizite `stages`-Liste
  ersetzt GitLabs Defaults — der `parity`-Job kam mit `stage: test` dazu, `test`
  stand aber nicht in der Liste. GitLab überspringt so einen Job nicht, es weist
  die *gesamte* Pipeline ab. Nichts wurde rot, deshalb fiel es niemandem auf.
  Ein neues Gate (`npm run ci:pipeline`) fängt das künftig **lokal** ab — in der
  Pipeline wäre es zu spät, weil eine ungültige CI-Datei keinen Job mehr starten
  lässt.

- **Sicherheitsdokumentation beschrieb ein überholtes Modell.** `SECURITY.md`
  sprach von „der einzigen schreibenden Action" — es sind vier (Wartung, Kanten,
  Positionen, Portscan) — und von drei Widget-Modulen, es sind fünf.
  `INSTALL.md` empfahl für RHEL `chown -R apache:apache`, während dieselbe Datei
  drei Absätze vorher `root:root` vorgibt, damit ein kompromittierter
  PHP-Prozess den Modulcode nicht umschreiben kann.

- **Port 161 hieß in der Portliste „SNMP".** SNMP läuft real über UDP; ein
  TCP-Timeout dort sagt nichts über SNMP aus. Der Code wusste das seit jeher,
  der Nutzer sah nur „SNMP: timeout". Heißt jetzt „SNMP/TCP".
- **Die Kennzahlen zählten Ghosts als Hosts — und meldeten trotzdem „0 Ghosts".**
  Bei eingeschaltetem Ghost-Toggle bekam die Zählung das bereits angereicherte
  Knoten-Array. Daraus folgte beides auf einmal: `injectGhostNodes` überspringt
  jede ID, die es schon kennt, also blieb die Differenz null — ausgerechnet
  dann, wenn die Ghosts sichtbar auf der Karte lagen. Und ein Ghost hat
  `severity 0`, lief also durch die Severity-Schleife als **OK** mit. Auf einer
  Karte mit 11 Geräten und einem Ghost stand „12 Hosts, 4 OK" bei drei grünen
  Knoten.

  Beide Zahlen korrigierten sich nach 30 Sekunden von selbst, weil der
  Refresh-Pfad die rohen Backend-Knoten übergibt — die unangenehmste Sorte
  Fehler: beim Nachsehen ist er weg.

  Die Zählung filtert jetzt `_isGhost` und die Internet-Wolke heraus, bevor
  irgendetwas gezählt wird — auch für die Zahl „Hosts" selbst. Der erste Anlauf
  hatte nur die Severity-Aufteilung umgestellt, weshalb die Zeile sichtbar nicht
  mehr aufging: „14 Hosts, 11 OK" und sonst nichts.

  Dazu bekommen alle vier Aufrufer dieselbe Menge, nämlich die rohe Hostliste
  aus dem Backend. Der Render-Pfad war der einzige, der die um Gruppen-Aggregate,
  Internet-Wolke und Ghosts angereicherte Fassung reichte; im Gruppen-View
  sprang die Zahl beim Ziehen einer Kante von „3 Hosts" auf „47 Hosts", ohne
  dass sich ein Host geändert hätte. Das KPI-**Widget** war nie betroffen; es
  bekommt die Backend-Daten direkt und leitet die Ghosts eigenständig ab.

- **Port-zu-Port-Beschriftungen waren seit jeher tot.** Das README bewirbt, dass
  jede Kante auf LLDP/SNMP-Switches den lokalen **und** den entfernten Port
  trägt. Sie tat es nie: die Item-Suche fragte die Port-OIDs überhaupt nicht ab,
  `lldpRemPortId` und `lldpRemPortDesc` standen nicht in der Schlüsselliste. Die
  Labels fielen still auf Host-zu-Host zurück — still, weil fehlende Ports
  aussehen wie „dieses Gerät meldet keine".

  Nachgemessen an einem Switch: von 9 auf 19 geholte Items. Auf zwei
  SNMP-Switches gegengeprüft, die sich gegenseitig sehen — die Kante zwischen
  ihnen trägt jetzt an beiden Enden den Port.

  Auch die Weathermap hängt daran: ohne Port-Zuordnung konnte sie nicht nach
  *gemessener* Auslastung des betroffenen Interfaces färben, sondern nur nach
  einer Schätzung auf Knotenebene.

- **Der Super-Admin sah seine eigene geteilte Karte nicht.** Beim Umzug der
  Anordnung auf den Server wanderten vorhandene `localStorage`-Positionen in die
  **persönliche** Ebene — auch beim Super-Admin. Dessen persönliche Ebene
  verdeckte danach die geteilte, die er selbst pflegte: er ordnete die Karte für
  alle, sah aber weiter seinen alten Stand. Die Migration schreibt nun in die
  Ebene, die zur Rolle passt, und wer geteilt speichert, löscht dabei seinen
  persönlichen Eintrag für diese Ansicht.

- **Zwei der drei mitgelieferten Templates ließen sich nicht importieren.**
  `nt_health_score_template.yaml` und `nt_topology_change_template.yaml`
  hatten unter `template_groups` kein `uuid`, das Zabbix 7.0 dort verlangt.
  Der Import brach ab mit

  ```
  Invalid tag "/zabbix_export/template_groups/template_group(1)":
  the tag "uuid" is missing.
  ```

  Beide werden in `INSTALL.md` als Schritt 4 zum Import empfohlen — es hat
  also jeder gesehen, der der Anleitung gefolgt ist.

  Dahinter lagen zwei weitere Fehler, die erst der jeweils nächste
  Import-Versuch zeigte. **Die falsche Gruppe:** die ergänzte `uuid` war aus
  dem funktionierenden dritten Template abgeschrieben — sie gehört aber zu
  `Templates/Network devices`, nicht zu `Templates`. Zwei verschiedene
  Gruppennamen trugen damit dieselbe `uuid`. **Und fünf `uuid`s, die keine
  waren:** von Hand getippte Muster wie `8a2b3c4d5e6f47081920a1b2c3d4e5f6` —
  32 Hex-Zeichen, aber kein UUIDv4. Zabbix prüft Version und Variante:

  ```
  Invalid parameter "/2/uuid": UUIDv4 is expected.
  ```

  Die richtigen Gruppenwerte stehen in der Tabelle `hstgrp` und sind auf jeder
  Installation gleich: `Templates` ist
  `79f31eeab03146229b1e019097fad672`, `Templates/Network devices` ist
  `7df96b18c230490a9a0a9e2307226338`. Die fünf getippten `uuid`s sind durch
  erzeugte ersetzt. Das LLDP-Template war nie betroffen — dort ist jede `uuid`
  echt erzeugt, deshalb ging ausgerechnet das immer durch.

  Der neue CI-Job `templates` prüft vier Regeln: `uuid` vorhanden, Name →
  `uuid` eindeutig, `uuid` → Name eindeutig, und **jedes** `uuid` der Datei ein
  echtes UUIDv4. Die letzte Regel gilt nicht nur für Gruppen — die fünf
  kaputten steckten in Items und Triggern.

  Alle drei Templates sind auf einer 7.0-Instanz importiert worden; das
  LLDP-Template läuft an zwei SNMP-Switches.

- **Ein Gate über die Zwei-Ebenen-Logik.** Was verschiedene Benutzer auf
  derselben Karte sehen, war bisher nur von Hand nachvollzogen. `npm run
  ci:layers` prüft es mit gestellten `NT_CONFIG`-Daten:

  - Ein Benutzer ohne eigene Positionen sieht genau die geteilte Karte.
  - **Persönlich gewinnt pro Knoten**, nicht als Ganzes — der Rest folgt weiter
    der geteilten Ebene.
  - Eine Abweichung in einer Ansicht berührt andere Ansichten nicht.
  - Super-Admins schreiben geteilt, alle anderen persönlich.
  - Bei den manuellen Links gewinnt **geteilt**, auch bei umgekehrter
    Richtung — eine Kante ist ungerichtet und darf nicht doppelt erscheinen.

  Jedes Szenario läuft in einem eigenen Prozess: `storage.js` liest die
  Konfiguration in IIFEs beim Import, ein zweiter Import mit anderen Daten
  bekäme den alten Stand. Das ist zugleich die ehrlichste Nachstellung von
  „ein anderer Benutzer lädt die Seite".

  **Nicht abgedeckt** bleibt der Weg Server → Datenbank → Rechteprüfung; dafür
  braucht es zwei angemeldete Benutzer in einem Browser.

- **Ein Gate über den Paketinhalt.** `npm run ci:package` simuliert, was im
  Modul-ZIP landen würde, und weist zurück, was dort nicht hingehört:
  Shell-Skripte, `tools/`, `templates/`, `tests/`, Source-Maps, das Repository
  selbst. Umgekehrt prüft es, dass die Pflichtdateien **da** sind — fehlt das
  Bundle oder Cytoscape, ist das Paket kaputt, und das fällt sonst erst beim
  Installieren auf.

  Die Ausschlussmuster liest das Gate **aus `deploy.sh`**, statt sie zu
  wiederholen. Eine zweite Liste wäre eine zweite Stelle, die ausschert — und
  dann prüft das Gate etwas anderes, als der Installer baut. Genau so ist
  `nt-uninstall.sh` ins Paket gerutscht: die Liste nannte nur die damals
  bekannten Skripte beim Namen, und aufgefallen ist es nur, weil jemand
  nachgesehen hat.

- **Das mitgelieferte Dashboard war auf keiner unterstützten Version
  importierbar.** `dashboards/nt-overview.yaml` trug `version: '7.0'`, und
  `dashboards/README.md` beschrieb einen Weg „Dashboards → Import". Beides ging
  nicht: **eigenständige Dashboards kennt der Zabbix-Import erst ab 8.0.** Gegen
  die Validatoren von 7.0, 7.2 und 7.4 nachgemessen, alle drei antworten

  ```
  Invalid tag "/": unexpected tag "dashboards".
  ```

  und in der UI dieser Versionen gibt es für Dashboards weder Import- noch
  Export-Knopf. Aufgefallen beim Testen gegen Zabbix 8, wo der Import
  tatsächlich funktioniert — dort störte dann noch das `uuid`, das Zabbix auf
  Dashboard-Ebene nicht kennt.

  Die Datei ist jetzt eine gültige 8.0-Fassung, mit **allen fünf Widgets**
  statt der bisherigen drei (KPI und Items fehlten seit ihrer Einführung), und
  ohne vorbelegte Hostgruppe — sonst verwiese sie nach dem Import auf
  Gruppen-IDs, die es auf der Zielinstallation nicht gibt. Von Zabbix' eigenem
  Import-Validator angenommen. `README.md` daneben sagt jetzt, dass 7.0 und 7.4
  das Dashboard von Hand nachbauen müssen, und liefert die Geometrie dafür.

- **Das Gate `ci:templates` schlug auf Kommentare an.** Eine Zeile wie
  `# Kein uuid: der Validator weist es ab` las es als ungültige `uuid` —
  gefunden, als genau dieser Satz in die Dashboard-Datei kam. Kommentare werden
  jetzt vor der Prüfung entfernt. Ein Gate, das an Prosa scheitert, gewöhnt
  einem das Hinsehen ab.

- **Das README nannte weiterhin nur einen Modulpfad.** Genau der Fehler, den
  ein Nutzer gemeldet hatte — behoben war er nur in `INSTALL.md`, die
  Kurzfassung im README blieb bei `/usr/share/zabbix/ui/modules`. Wer die
  Startseite liest statt die Anleitung, landete wieder vor einem Pfad, den es
  bei ihm nicht gibt. Beide Layouts stehen jetzt auch dort, mit dem
  `find`-Einzeiler.

  Dazu fehlten `nt-install.sh` und `nt-uninstall.sh` im README komplett, obwohl
  der Installer den Pfad selbst erkennt und auf RHEL den SELinux-Kontext setzt
  — also genau die zwei Fallen, an denen die Handinstallation scheitert. Und
  die Warnung vor `git clone` steht jetzt ebenfalls auf der Startseite, nicht
  nur in der Anleitung.

- **Das README beschrieb inhaltlich noch 4.x.** Die Versionsnummer im Badge
  stimmte, der Funktionsumfang darunter nicht: Kennzahlen-Zeile, Ghost-Knoten,
  Gerätetyp aus dem Protokoll und die Dienste-Probe kamen dort **null Mal** vor
  — also genau die Dinge, die den Sprung ausmachen. Wer vom Forum oder von
  zabfox.de kam, las eine Startseite, die den halben Umfang verschwieg.
  Ergänzt in beiden Sprachen, inklusive der Highlights-Zeile ganz oben.

- **Die LLDP-Capabilities wurden bei der Hälfte der Geräte falsch gelesen.**
  Aufgefallen erst, als nach dem Proxy-Ausfall wieder echte Werte flossen. Das
  Feld kommt in **zwei Formen** an, je nach Template:

  ```
  HP Instant On   "20 00", "28 00"                rohe Hex-Bytes
  TP-Link         "Bridge", "WLAN Access Point"   von einer Value-Map aufgelöst
  ```

  Der Decoder kannte nur Hex. Aus `Bridge` blieben nach dem Filtern die
  Hex-Ziffern `B`, `d`, `e`, daraus `0xBD`, daraus **fünf Fähigkeiten, die nie
  gemeldet wurden** — und aus einem Switch wurde ein Access Point. Der
  Kommentar versprach „im Zweifel lieber nichts"; das stimmte nicht, das
  Ergebnis war selbstbewusst falsch. Betroffen war auch die Ghost-Anzeige, die
  diese Liste seit `bc5da3f` einblendet.

  Unterschieden wird jetzt an den Zeichen: nur Hex-Ziffern und Leerraum → Hex,
  sonst Text. Kein Fähigkeitsname besteht ausschließlich aus Hex-Ziffern, die
  Trennung ist also eindeutig. `tests/DeviceTypeTest.php` prüft beide Formen
  mit den echten Werten beider Switches.

- **Der CI-Job `shellcheck` war seit Langem rot — unbemerkt.** Er scheitert
  auch an *Info*-Meldungen, und fünf Stellen in `nt-install.sh` trugen das
  Muster `A && B || C` (SC2015). Das steckt schon in v4.38.3, jede Pipeline
  seitdem war rot, und weil das lokale `npm run ci:shellcheck` ohne
  installiertes `shellcheck` schlicht nichts sagt, fiel es nie auf. Die fünf
  Stellen sind jetzt echte `if`-Konstrukte — nicht nur der Meldung wegen: bei
  `A && B || C` läuft `C` auch dann, wenn `A` wahr war und `B` fehlschlug.

  `nt-uninstall.sh` stand gar nicht im Gate; es ist ergänzt, in `package.json`
  und in `.gitlab-ci.yml`. Alle vier Skripte laufen jetzt mit Exit 0 durch,
  verifiziert mit shellcheck 0.10.0.

- **Die 5000-Knoten-Grenze bei den Positionen kürzte stillschweigend.** Wer eine
  Karte mit mehr Knoten anordnete, bekam einen Teil gespeichert und keinen
  Hinweis darauf — beim nächsten Laden fehlten Positionen ohne erkennbaren
  Grund. Das sieht nach Datenverlust aus, nicht nach einer Grenze. Die Action
  gibt jetzt zurück, wie viele Knoten sie verworfen hat, und die Karte meldet
  es. Aufgefallen bei der Vorbereitung eines Lasttests: eine stille Kürzung
  hätte dort Messwerte erzeugt, die niemand hätte deuten können.

- **Die Vendor-Matrix führte MikroTik als „funktioniert" — ohne Beleg.**
  Belegt war nur, dass das Modul nach `discovery.neighbor`-Items sucht und sie
  verarbeitet. Ob RouterOS die Nachbartabelle über normales SNMP herausgibt,
  hat nie jemand an einem Gerät geprüft; es gibt weder Test noch Fixture. Die
  Zeile steht jetzt als **ungeprüft** da, mit einem konkreten `snmpwalk`, mit
  dem jeder RouterOS-Betreiber die Frage in fünf Minuten klären kann.

- **Die Installationsanleitung setzte ein Verzeichnis-Layout voraus, das nicht
  überall gilt.** Ein Nutzer meldete, bei ihm fehle der Ordner `ui`. Pakete aus
  dem Zabbix-Repo legen das Frontend nach `/usr/share/zabbix` — **ohne** `ui`;
  andere Installationen haben `/usr/share/zabbix/ui`. `nt-install.sh` und
  `deploy.sh` erkennen beides seit jeher, aber wer der Anleitung von Hand
  folgte, stand vor einem Pfad, den es bei ihm nicht gibt. Beide Layouts sind
  jetzt genannt, mit einem `find`-Einzeiler zum Nachsehen.

- **Die Anleitung riet nicht vom `git clone` ab — jetzt tut sie es, mit Grund.**
  Der Weg stand als gleichwertige Variante B daneben. Er legt aber das
  **gesamte Repository** unter den Web-Root, und Zabbix' nginx-Konfiguration
  sperrt dort nur `/\.ht`, nicht `.git`. An einer Testinstallation
  nachgemessen:

  ```
  /modules/<verzeichnis>/.git/HEAD                    HTTP 200
  /modules/<verzeichnis>/.git/index                   HTTP 200
  /modules/<verzeichnis>/tools/topo-change-sender.sh  HTTP 200
  ```

  Das Repository ist öffentlich, es entweicht zunächst nichts Geheimes. Aber
  `tools/` enthält das Sender-Skript, das Zugangsdaten aus Umgebungsvariablen
  liest — trägt sie jemand in die Datei ein, stehen sie im Netz. Genau dafür
  gibt es die Ausschlussliste im Release-ZIP. Die Variante ist aus der
  Anleitung entfernt und durch eine Warnung samt Aufräum-Befehl ersetzt.

- **`unzip` steht jetzt bei den Voraussetzungen**, ebenfalls nach einer
  Nutzermeldung: Minimal-Installationen bringen es nicht mit.

- **Die Anleitung empfahl `www-data` als Eigentümer.** Der Webserver muss die
  Moduldateien nur **lesen**. Gibt man ihm den Besitz, kann ein kompromittierter
  PHP-Prozess den Modulcode überschreiben. `root:root` genügt und steht jetzt
  allein da.

- **Vier Ansichten sprachen Deutsch, egal welche Sprache eingestellt war.**
  Gemeldet von einem Nutzer auf einer englischen Oberfläche: *„Most is in
  English, but some is in German."* Er hatte nichts übersehen — die
  Übersetzung war unvollständig, und `i18n.js` sagt das im eigenen
  Kopfkommentar: nicht migrierte Module behalten fest verdrahtetes Deutsch.

  Betroffen waren die Tabs **Compliance, Diag, Geo und LLDP-Q** mit zusammen
  23 Zeichenketten, darunter die komplette Beschriftung der
  Compliance-Prüfungen (`Agent ohne TLS`, `Inventory aus`, `Stale
  Krit-Problem`, `Wartung ohne Kommentar` …), die auch im Audit-Report aus
  `export.js` erscheint. Alle laufen jetzt über `t()`, 25 neue Schlüssel in
  `de.js` und `en.js`.

  Beim Geo-Hinweis steht das Markup weiterhin im Code und nur die Textteile
  kommen aus der Übersetzung — eine i18n-Datei, die HTML trägt, wäre der
  falsche Weg, und der Satzbau unterscheidet sich zwischen den Sprachen
  ohnehin.

- **`nt-install.sh` brach auf der gesamten RHEL-Familie ab.** Die Erkennung des
  php-fpm-Dienstes lief in eine SIGPIPE-Falle:

  ```bash
  systemctl list-units … | grep -q 'php-fpm\.service'
  ```

  `grep -q` beendet sich beim ersten Treffer und schließt die Pipe, `systemctl`
  endet daraufhin mit 141 — und weil im Skript `set -o pipefail` steht, gilt die
  ganze Pipeline als fehlgeschlagen, **obwohl der Treffer da war**. Auf Rocky 9
  nachgemessen: ohne `pipefail` Exit 0, mit `pipefail` Exit 141.

  Auf Debian fiel das nie auf, weil dort der erste Zweig greift
  (`php8.2-fpm.service`). Auf RHEL heißt die Unit schlicht `php-fpm.service`,
  also kann **nur** der zweite Zweig treffen — und der war der kaputte. Der
  Installer meldete „kein php-fpm-Service gefunden" auf einer Maschine, auf der
  php-fpm lief, und brach ab, bevor er überhaupt zum `restorecon` kam.

  Die Unit-Liste wird jetzt einmal in eine Variable geholt und ohne Pipe
  ausgewertet.

- **Dieselbe Falle in der Zip-Slip-Prüfung — dort mit Fail-open.** Der Schutz
  gegen absolute und `../`-Pfade im Archiv lautete
  `unzip -Z1 … | grep -qE …` direkt in der Bedingung. Findet `grep` einen
  unsicheren Pfad, beendet es sich sofort, `unzip` läuft in SIGPIPE, `pipefail`
  macht die Bedingung **falsch** — und ausgerechnet das Archiv *mit* den
  unsicheren Pfaden wäre durchgerutscht. Ob es passiert, hängt daran, ob `unzip`
  beim Beenden von `grep` noch schreibt: bei kleinen Archiven meist nicht, bei
  großen schon. Eine Sicherheitsprüfung, die mal greift und mal nicht.

- **Der Installer verlangte Zabbix 7.4, obwohl er das Hauptmodul installiert.**
  Das läuft auf 7.0 LTS; nur die Widgets brauchen 7.4, und die installiert
  `nt-install.sh` gar nicht. Auf einer 7.0-LTS warnte der Check vor genau der
  Kombination, die die Dokumentation empfiehlt.

  **Nachgefahren auf einer echten Rocky 9.8 mit SELinux im Enforcing-Modus**
  (Proxmox-VM, nicht Container — im Container gibt es kein SELinux, und der
  Installer würde `restorecon` überspringen und scheinbar grün durchlaufen).
  Der Vorher-Nachher-Beweis aus dem echten php-fpm-Prozess heraus:

  ```
  user_tmp_t  →  Failed to open stream: Permission denied
  usr_t       →  gelesen, 2704 Byte
  ```

- **Schritt 4 der Installation war auf dem dokumentierten Weg nicht
  ausführbar.** `INSTALL.md` verwies auf `templates/…` und
  `tools/topo-change-sender.sh`, `LLDP-SETUP.md` nannte das LLDP-Template
  „mitgeliefert". Keine dieser vier Dateien liegt im Modul-ZIP — `deploy.sh`
  schließt `tools` und `templates` aus. Wer über das ZIP installierte, hatte
  relative Pfade ins Leere und keinen Hinweis, woher die Dateien kommen.

  Der Ausschluss bleibt und ist richtig: das Modulverzeichnis liegt unter dem
  Web-Root und ist öffentlich abrufbar — dort lag schon einmal eine 1 MB große
  Source-Map. Ein Sender-Skript und Template-YAMLs braucht die Laufzeit nicht.
  Stattdessen nennen beide Dokumente die Dateien ohne Verzeichnispräfix,
  erklären in einem Kasten, warum sie nicht im Paket sind, und geben
  `curl`-Zeilen auf das Repository. Der Ausschluss in `deploy.sh` trägt jetzt
  einen Kommentar, der auf Schritt 4 verweist.

- **Beide Installer setzen den SELinux-Kontext jetzt selbst.** `nt-install.sh`
  und `deploy.sh` entpacken nach `/tmp` und schieben das Ergebnis per `cp -a`
  bzw. `mv` an seinen Platz — beide **erhalten** den Kontext. Dateien aus
  `/tmp` tragen `user_tmp_t`, php-fpm läuft als `httpd_t` und darf das nicht
  lesen. Das Modul lag damit auf RHEL/Rocky/Alma mit korrekten Rechten und
  korrektem Owner am richtigen Platz — und erschien trotzdem nicht in der UI.
  Beide rufen nun `restorecon -R` auf, sofern vorhanden und SELinux aktiv;
  auf Debian/Ubuntu ist der Aufruf ein stiller No-Op und niemals fatal.
  `INSTALL.md` weist in beiden Sprachen darauf hin, dass der Handgriff nur
  noch beim Entpacken von Hand nötig ist.

- **Ein High-Problem zählte als „Warn".** Die Severity-Eimer der Kennzahlen
  warfen alles zwischen OK und Disaster in einen Topf — ein Host mit **High**
  erschien unter „Warn", während die Toolbar eine Zeile darüber getrennte
  Pillen für Warn, Avg und High zeigt und der Knoten im Graphen rot leuchtet.
  Jetzt: `ok` = Normal, `warn` = Info bis Average, `krit` = High und Disaster.

- **„0 Ghosts" war eine Behauptung, keine Messung.** Ghost-Knoten kommen nur in
  den Graphen, wenn der Toolbar-Toggle an ist (Standard: aus) — gezählt wurde
  aber aus dem Graphen. Bei ausgeschaltetem Toggle stand dort null, unabhängig
  davon wie viele es gab, und das ausgerechnet bei der Kennzahl, die zu etwas
  auffordern soll. Gezählt wird jetzt aus derselben Quelle, aus der auch
  injiziert wird; ist der Toggle aus, steht „ausgeblendet" daneben.

- **Deutsche Zeichenketten in einer englischen Oberfläche.** Der Knopf unter der
  Hostgruppen-Auswahl rief `_('Auswahl leeren')` — die *Ausgangs*-Zeichenkette
  war deutsch, und Zabbix' gettext übersetzt gegen englische Quelltexte, reicht
  einen deutschen also unverändert durch. Ebenso trug das Health-Widget als
  einziges noch deutsche Beschriftungen (Score-Labels, Kopfzeile, Legende), und
  die Kopfzeile schrieb „1 Gruppen" — Singular und Plural waren nicht
  unterschieden. Beides behoben; das Paket ist jetzt durchgängig englisch.

- **Prozentspalte im Items-Widget sprang.** Die Rundung schnitt die abschließende
  Null ab, wodurch „6%" neben „5.9%" stand. Feste Nachkommastelle.

- **Eine Firewall und ein Videorecorder wurden als WLAN-Accesspoint gezeichnet.**
  In der Typ-Heuristik standen `unifi` und `omada` in der Liste für „wireless" —
  das sind aber **Produktlinien, keine Geräteklassen**: UniFi umfasst Gateways,
  Switches, Kameras, Recorder und Accesspoints. Dazu wird „wireless" vor
  „camera" geprüft, weshalb der breite Herstellername sogar das spezifische
  `nvr` schlug. Gematcht wird gegen Hostname **plus** Template-Namen, und beide
  Geräte hingen am UniFi-Template — sie trugen den Herstellernamen also
  implizit mit sich.

  Der Herstellername entscheidet jetzt nichts mehr; erkannt werden Modellreihen:
  UDM/USG/UXG → Firewall, USW → Switch, UAP/U6/U7 und die Omada-EAP-Reihe →
  Accesspoint. Wo nichts passt, bleibt es beim Server-Default — ehrlicher als
  eine geratene Klasse, und wem das nicht passt, der setzt `nt:icon`.

  Diese kurzen Kürzel werden an Wortgrenzen gebunden statt als Teilstring
  gesucht: `udm` steckt in „cloudmail", `uxg` in „luxgate", und „firewall" wird
  als Erstes geprüft — ein Mailserver wäre sonst eine Firewall geworden. Aus
  demselben Grund muss hinter `unifi ap` eine Wortgrenze stehen: ohne sie passt
  auch „UniFi API", und der Recorder hinge wieder als WAP im Netz. **Nach dem
  Update können sich Icons ändern** — an den Daten ändert das nichts.

- **Der Kantenzähler blieb nach jeder Änderung bis zu 30 Sekunden stehen.** Wer
  im Stern-Modus eine Kante zog oder alle Links löschte, sah es sofort im
  Graphen — die Zeile daneben erst beim nächsten Refresh. Aufgefallen auf einem
  Screenshot: drei sichtbare Kanten, daneben „0 Edges". Wer das sieht, hält die
  Zahl für kaputt, nicht für veraltet.

  Beim ersten Laden stand die Zahl aus demselben Grund auf null, weil sie vor
  dem Einfügen der gespeicherten Kanten gezogen wurde. Auch der Rückrollweg
  zählt jetzt neu: lehnt der Server eine Kante ab, verschwindet sie aus dem
  Graphen — und die Zeile behauptete sie bis zum nächsten Refresh weiter. Eine
  Zahl, die einen gescheiterten Speichervorgang bestätigt, ist schlimmer als
  eine veraltete.

- **„PDF (print)" öffnete kein Fenster mehr.** `window.open()` stand hinter dem
  Aufbau des Reports, und der rendert die ganze Karte per `cy.png()` — bei einer
  größeren Topologie hunderte Millisekunden. Danach ist das Zeitfenster der
  Benutzeraktion zu, der Popup-Blocker greift, `window.open()` liefert `null`,
  und das umgebende `if (w) { … }` verschluckte genau das: Klick, nichts
  passiert, keine Meldung. Das Fenster geht jetzt synchron im Klick auf, der
  teure Teil kommt danach — und blockiertes Popup, fehlende Karte und
  gescheiterter Report sagen es jeweils.

  Gedruckt wird erst, wenn der eingebettete Kartenschnappschuss geladen ist;
  vorher stand dort ein fester Timeout, der bei großen Karten ein leeres Bild
  druckte. Der Audit-Report hatte davon nur die Hälfte abbekommen — beide teilen
  sich jetzt dieselbe Routine, samt Freigabe der Blob-URL nach dem Download.

- **Der LLDP-Q-Tab meldete „0 %" in Rot, wenn es nichts zu bewerten gab.** Ohne
  LLDP-Items ist die Match-Quote nicht null, sondern undefiniert. Die rote Null
  sah aus wie ein Messergebnis und ließ das Modul kaputt aussehen, während die
  Ursache davor liegt: das mitgelieferte Template ist nicht gelinkt, oder die
  Discovery lief noch nicht. Meldet kein Host Nachbarn, steht dort jetzt genau
  das — mit dem Weg zum Nachsehen — statt einer Kennzahl.

- **Das Export-Menü lief rechts aus dem Fenster.** Der Knopf sitzt am rechten
  Ende der Werkzeugleiste, das Menü klappte nach rechts auf: „PDF (pri…", „Save
  HT…" und „Audit rep…" waren abgeschnitten und nicht anklickbar. Es klappt
  jetzt rechtsbündig auf.

### Performance
- **Response-Cache für `network.topology.data`.** Die Action ist der teuerste
  Endpoint des Moduls (Host + Trigger + Problem + Item + gebatchte Lastvalues +
  LLDP) und war als einzige von sieben cachenden Actions **ohne**
  Response-Cache — in `NtCache` lag dort nur die Topologie-Baseline. 15 s TTL,
  deutlich unter jedem Refresh-Intervall.

  Zwei Dinge bleiben bewusst außerhalb des Caches. **`topo_changes`** beruht auf
  einem Diff gegen die letzte Abfrage; aus dem Cache bedient, liefe der Diff nur
  noch bei Cache-Misses und dieselbe „neue Verbindung" würde für die Dauer der
  TTL wiederholt gemeldet. **`requested_count`** hängt am ungekürzten
  Eingabewert, der nicht im Cache-Schlüssel steckt.

- **Mehrere Widgets auf einem Dashboard holen die Daten nur noch einmal.**
  Vorher fragte jedes `network.topology.data` einzeln ab — dieselbe Action,
  dieselben Hostgruppen. Ein geteilter Zugriff mit Request-Coalescing und 15 s
  TTL bündelt das. Auf einem Dashboard mit vier NT-Widgets sind es damit
  nachweislich **eine** Datenabfrage pro Runde statt vier.

### Intern

- **Dokumentation englisch zuerst.** Zwei Rückmeldungen nannten den hohen
  Deutsch-Anteil. `LLDP-SETUP.md` — die Datei, auf die Nutzer mit fehlenden
  Kanten verwiesen werden — gab es nur auf Deutsch; sie ist jetzt englisch, das
  Original steht als `LLDP-SETUP.de.md` daneben. Im README steht der englische
  Abschnitt vor dem deutschen.

- **„Execute now" stand in keiner Doku-Datei**, und die Default-Intervalle
  nirgends — nur die Makro-Namen. Wer das LLDP-Template linkt und die Karte neu
  lädt, wartet unwissentlich bis zu drei Stunden auf etwas, das aussieht wie ein
  kaputtes Feature. Das war eine Doku-Lücke mit Bug-Wirkung und der gemeinsame
  Nenner zweier Fehlermeldungen.

- **Huawei** als *ungeprüft* in der Vendor-Matrix, mit dem `snmpwalk` daneben
  und der Erklärung, warum das offizielle VRP-Template nicht reicht: das Modul
  spricht kein SNMP, es liest Items.

- **Der direkte Zugriff auf die History-Tabellen ist dokumentiert.** Die
  Lastvalue-Abfrage setzt SQL-History voraus; mit Elasticsearch als
  History-Speicher zeigt die Karte Knoten ohne Metriken.

- `npm audit fix` — `brace-expansion` (high) über eslint → minimatch.
- **Gate gegen Drift in den beiden bewussten Duplikaten.** Die Widget-Module
  können den Code des Hauptmoduls nicht importieren — Zabbix' jsLoader kennt
  keine ES-Module —, deshalb steht zweimal dasselbe da. Bisher stand die Bitte,
  das synchron zu halten, als Kommentar in den Dateien; `npm run ci:parity`
  macht daraus eine Prüfung. Bewacht werden die Gewichte und Schwellen der
  Health-Score-Formel (Hauptmodul gegen Widget) und der geteilte Datenzugriff
  über vier Widget-Dateien. Findet die Extraktion nichts, ist das ein Fehler
  und kein Durchlauf.

## v5.0.0 — 2026-08-08

### ⚠️ Breaking — der `_v6`-Suffix entfällt

Das Modul hieß intern seit jeher `network_topology_v6`; die „v6" war eine
Entwicklungsnummer aus der Zeit vor dem ersten Release und hatte nie etwas mit
der Zabbix- oder der Modulversion zu tun. Sie führte regelmäßig zu der Annahme,
das Modul sei an Zabbix 6 gebunden — das Gegenteil stimmt, es läuft auf 7.0 LTS
und 7.4. Der Suffix verschwindet daher restlos aus allen Bezeichnern.

*The `_v6` suffix is gone. It was a pre-release development number, never a
Zabbix-version marker, and it kept being read as „requires Zabbix 6". Migration
steps below.*

| | vorher | jetzt |
|---|---|---|
| Verzeichnis | `network_topology_v6` | `network_topology` |
| Modul-ID | `network_topology_v6` | `network_topology` |
| PHP-Namespace | `Modules\NetworkTopologyV6` | `Modules\NetworkTopology` |
| Actions | `network.topology.v6.*` | `network.topology.*` |
| Widget-IDs | `network_topology_v6_*_widget` | `network_topology_*_widget` |

**Es gibt bewusst keine Kompatibilitäts-Aliase.** Die alten Action-Namen sind
weg, nicht deprecated.

### Migration von 4.x

1. **Altes Verzeichnis entfernen**, sonst registriert Zabbix beide Module und
   der Menüeintrag erscheint doppelt:
   ```bash
   cd /usr/share/zabbix/ui/modules
   sudo rm -rf network_topology_v6 network_topology_v6_widget \
               network_topology_v6_health_widget network_topology_v6_table_widget
   ```
2. Neue ZIPs entpacken (siehe `INSTALL.md`), dann
   **Administration → General → Modules → Scan directory** und die Module auf
   *Enabled* setzen. Die alten Einträge verschwinden dabei von selbst.
3. **Dashboards nachziehen.** Die drei Widget-IDs stehen in `widget.type`; mit
   dem Umbenennen kennt Zabbix den alten Typ nicht mehr und blendet die Kacheln
   aus. Sie müssen einmalig neu hinzugefügt und konfiguriert werden. Betroffen
   ist nur die Kachel, nicht das Dashboard.
4. **Lesezeichen aktualisieren** — die Ansicht liegt jetzt unter
   `zabbix.php?action=network.topology.view`.

#### Optional: Dashboards per SQL erhalten

Wer die Kacheln nicht neu bestücken will, kann die Bezeichner stattdessen in
der Datenbank umschreiben. Das ist genau das, was „Scan directory" plus ein
manueller Neuaufbau täte — nur ohne Klickarbeit. **Vorher Backup ziehen**, und
erst ausführen, wenn die neuen Verzeichnisse schon auf der Platte liegen:

```sql
BEGIN;
UPDATE module SET id = 'network_topology',
                  relative_path = 'modules/network_topology'
 WHERE id = 'network_topology_v6';
UPDATE module SET id = 'network_topology_widget',
                  relative_path = 'modules/network_topology_widget'
 WHERE id = 'network_topology_v6_widget';
UPDATE module SET id = 'network_topology_health_widget',
                  relative_path = 'modules/network_topology_health_widget'
 WHERE id = 'network_topology_v6_health_widget';
UPDATE module SET id = 'network_topology_table_widget',
                  relative_path = 'modules/network_topology_table_widget'
 WHERE id = 'network_topology_v6_table_widget';

UPDATE widget SET type = 'network_topology_widget'
 WHERE type = 'network_topology_v6_widget';
UPDATE widget SET type = 'network_topology_health_widget'
 WHERE type = 'network_topology_v6_health_widget';
UPDATE widget SET type = 'network_topology_table_widget'
 WHERE type = 'network_topology_v6_table_widget';
COMMIT;
```

`UPDATE` statt `DELETE`+`INSERT` ist Absicht: es erhält die `moduleid`, an der
`role_rule.value_moduleid` per Fremdschlüssel mit `ON DELETE CASCADE` hängt —
ein Löschen würde rollenbasierte Modulrechte stillschweigend mit entfernen.
Danach php-fpm neu laden.

**Auf diesem Weg entfallen die Schritte 2 und 3 oben.** Weil die Zeilen
umbenannt statt ersetzt werden, bleibt `status` erhalten — die Module sind
danach weiterhin aktiviert, „Scan directory" und das Neu-Aktivieren sind nicht
nötig, und die Dashboard-Kacheln stehen an ihrem Platz. Wer neu hinzugekommene
Widgets nutzen will, braucht „Scan directory" trotzdem einmal: die kennt Zabbix
noch nicht.

Nachgefahren auf zwei unabhängigen Installationen — der Projekt-Demo und einer
zweiten Instanz auf PostgreSQL. Beide Male: sieben Zeilen geändert, alle Module
weiter aktiviert, alle Kacheln erhalten.

**Erhalten bleibt alles Nutzerseitige:** Knotenpositionen, Pins, Notizen,
manuelle Links, Filter-Presets und sämtliche Toolbar-Einstellungen. Die
localStorage-Schlüssel tragen ein User-Präfix (`u<id>_`) und waren nie an den
Modulnamen gebunden. Host-Tags (`nt:parent`) sind ohnehin unberührt.

### Changed
- Widget-Versionen ziehen wegen der geänderten IDs je einen Major nach:
  Topologie-Graph `2.0.0 → 3.0.0`, Health-Score `1.0.1 → 2.0.0`,
  Tabelle `1.0.0 → 2.0.0`.
- Release-Assets heißen entsprechend `network_topology.zip`,
  `network_topology_widget.zip`, `network_topology_health_widget.zip`,
  `network_topology_table_widget.zip`.

## v4.38.3 — 2026-07-27

### Fixed
- **Dashboard-Widgets blieben je nach Timing auf „Loading…" stehen.** Zwei unabhängige Ursachen, beide im Widget-Frontend:
  1. `data-groupids` kommt in Zabbix 7.4 **leer** am Client an — die Feldwerte stehen dort nur in `this._fields`. Der Fallback darauf existierte bisher nur im `else`-Zweig (Canvas bei `onStart` noch nicht da). Existierte der Canvas schon, gewann das leere Attribut und das Widget fetchte **nie**. Welches der drei Widgets es traf, entschied allein das Timing. Der Fallback greift jetzt in beiden Zweigen.
  2. Das Cytoscape-Layout lief, während die Widget-Fläche im Dashboard noch **0 px** groß war. `cose`/`cola` können dann nicht verteilen und legen **alle** Knoten auf `{0,0}`; das nachgelagerte `fit()` zoomt daraufhin auf eine entartete Bounding-Box (Zoom 4) — der Graph ist geladen, aber unsichtbar. Ein `resize()`+`fit()` allein heilt das nicht, weil die Positionen bereits feststehen. Das Layout läuft jetzt per `ResizeObserver` erneut, sobald der Container echte Größe hat (dieselbe Lösung wie in `render-tech.js` des Hauptmoduls); der Observer wird in `_destroyCy()` mit abgeräumt.
- **Dark-Mode-Button war nicht übersetzbar**: `tabs.js` setzte „Light"/„Dark" hart, obwohl die i18n-Keys `toolbar.light`/`toolbar.dark` in beiden Sprachdateien existierten.

### Removed
- Toter Code: `assets/js/modules/dom-safe.js` (nie importiert, nicht im Bundle), der ungenutzte Export `hasSnapshot()` aus `diff-mode.js` und 7 CSS-Regeln für `.nt-lbl`/`.nt-node` (beide Klassen werden von keinem JS/PHP je gesetzt — Icons gehen als Data-URI an Cytoscape).

### Added
- **`CONTRIBUTING.md`** (DE/EN): Entwicklungs-Setup und vor allem die drei Dinge, die die CI hart erzwingt (mitcommittetes Bundle, XSS-Gates, ESLint-Baseline).
- **GitHub-Issue-Vorlage** als Formular — fragt Modul-/Zabbix-/PHP-Version und bei fehlenden Kanten den SNMP-Vendor ab.

### Changed
- **README ist jetzt zweisprachig (DE/EN)** und ohne Demo-Verweise; Architektur-, Screenshot- und Lizenzabschnitte werden gemeinsam genutzt statt doppelt geführt.
- **Changelog beginnt beim ersten öffentlichen Release** — die Entwicklungshistorie davor ist nicht Teil dieses Repos.

## v4.38.2 — 2026-07-27

Härtungs-Runde vor der Veröffentlichung (externes Security-Review + Repo-Audit).

### Security
- **`deploy.sh`: Root-Code-Execution über vorhersagbaren `/tmp`-Pfad geschlossen** (High). Die Zips wurden auf dem Zielserver unter festen Namen (`/tmp/network_topology_v6.zip`) abgelegt. Ein beliebiger unprivilegierter User dort konnte den Pfad vorab als **Symlink** anlegen; `scp` folgt ihm (`O_CREAT|O_TRUNC`), womit der Angreifer die Datei kontrolliert, die Sekunden später von `sudo unzip` als **root** entpackt wird — ohne Zip-Slip-Filter also beliebige Dateien außerhalb des Modulverzeichnisses. Lokales **und** entferntes Arbeitsverzeichnis sind jetzt `mktemp -d` mit `umask 077`; der EXIT-Trap räumt beide ab (die Remote-Zips blieben vorher dauerhaft liegen). Der SSH-Control-Socket liegt ebenfalls im 0700-Tempdir statt unter einem aus dem Servernamen ableitbaren `/tmp`-Pfad.
- **Die drei Widget-Module liefen durch kein einziges CI-Gate.** `eslint.config.mjs`, `tools/check-xss.sh` und `package.json` kannten nur `assets/js/**` — ausgerechnet die Dateien, die ihr HTML per String-Konkatenation bauen, wurden nie geprüft. Beide Gates decken jetzt `widget*/assets/js/**` mit ab (verifiziert: ein absichtlich eingebauter unescapter Sink lässt beide rot werden, die bestehende Baseline unterdrückt ihn nicht).
- **Unescapter `innerHTML`-Sink im Topology-Widget** (`widget/assets/js/widget.class.js`, `_showMsg`): die Fehlermeldung wurde roh in HTML konkateniert — der einzige Bruch der Escaping-Konvention in allen drei Widgets, entstanden genau in der Gate-Blindstelle. Baut die Nachricht jetzt über `textContent`, ist damit per Konstruktion kein HTML-Sink mehr.
- ESLint erkennt `this._esc()` der Widgets als Escape-Methode (`escape.methods` um `_esc` erweitert); die 8 dadurch neu sichtbaren, **inhaltlich geprüften** Bestands-Sinks sind in `eslint-suppressions.json` gebaselined — wie die ~100 im Hauptmodul.

### Changed
- **Reale Infrastruktur-Referenzen entfernt**: eigene Host-/Netzdaten in CHANGELOG, Tests und Code-Kommentaren durch generische Platzhalter ersetzt (`192.0.2.x` nach RFC 5737, `example.com`, `SW-CORE-01`). Betrifft keine Funktionalität — Device-Type-Keywords wie `truenas`/`pve` in `HostMetadata.php` sind funktionaler Code und bleiben.
- **Versions-Konsistenz**: `manifest.json`, `package.json`, `package-lock.json`, README-Badge und CHANGELOG liefen bis zu vier Releases auseinander und sind jetzt synchron.

### Added
- **`SECURITY.md`** (DE/EN): Meldeweg für Sicherheitslücken, Reaktionszeit, Geltungsbereich und das dokumentierte Sicherheitsmodell.
- **README**: Link-Zeile (Projektseite, Demo, Repo, Changelog, Installation) und Abschnitt „Feedback & Mitmachen". **INSTALL**: Clone-URL und Release-ZIP verweisen auf das öffentliche Repository.
- `.gitignore` deckt `.claude/`, `*.log` und `.env` ab.

## v4.38.1 — 2026-07-27

### Fixed
- **i18n-Lücke in der Items-Pivot**: ~15 Strings waren hart auf Deutsch codiert und blieben im EN-Modus deutsch — der Fehler-/Empty-State (inkl. der vier Erklär-Zeilen), „Alles leer", der Gruppen-Separator „Ohne Gruppe", Anomalie-Tooltips, „In Latest Data öffnen", Pattern-Label + -Placeholder. Alle laufen jetzt über `t()`, neue Keys in `i18n/{de,en}.js`. Dass es ein Versehen war zeigt `— Custom-Pattern —`: derselbe String lief an zwei Stellen bereits über `t('items.custom_pattern')`, an einer dritten hart-codiert.

### Added
- `fmtVal` formatiert jetzt auch die Zabbix-Unit **`Bps`** (Byte/s → B/s, KB/s, MB/s, GB/s). Bisher fiel sie auf die rohe Zahlenausgabe zurück (`bps` = Bit/s war bereits abgedeckt).
- **README**: Tabelle, welche **Linux-Templates** für die Items-Pivot-Presets nötig sind (`Linux by Zabbix agent` für Disks/Block-IO/CPU/Memory/Netz, `ICMP Ping` für Ping) — plus der Hinweis, dass SNMP-Switches/Windows andere Keys liefern und dort das Custom-Pattern bzw. die „Discovered"-Liste zu nutzen ist. Ohne passendes Template bleibt die Pivot leer, was bisher wie ein Fehler wirkte.

## v4.38.0 — 2026-07-27

### Added
- **Drittes Dashboard-Widget „NT Table"** (`network_topology_v6_table_widget`): die Tabellen-Ansicht (Nagios-/Icinga-Style Hostliste) als Dashboard-Kachel — **Status** (Severity/Offline/Stale), **Host**, **CPU**, **Mem**, **Ping**, **Traffic** (↓/↑), **offene Probleme**. Sortierung Offline → Severity → Name; konfigurierbar: Hostgroups, Hide-offline, Only-problems, Max-rows. Nutzt dieselbe `network.topology.v6.data`-Action wie der Haupt-Tab (kein zweites Backend), ES5-jsLoader-Stil (Zabbix 7.4) wie die bestehenden Widgets. `deploy.sh` liefert die Widgets jetzt zu dritt aus (`widgets`/`all`-Modus).

---

*Die Entwicklungshistorie vor dem ersten öffentlichen Release ist nicht Bestandteil dieses Changelogs.*
*Development history prior to the first public release is not part of this changelog.*
