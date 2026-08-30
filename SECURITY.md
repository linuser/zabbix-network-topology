# Security Policy

**🇩🇪 [Deutsch](#-deutsch) · 🇬🇧 [English](#-english)**

---

## 🇩🇪 Deutsch

### Sicherheitslücke melden

**Bitte nicht** über einen öffentlichen Issue melden — sonst ist die Lücke bekannt,
bevor ein Fix existiert.

Stattdessen per Mail an **<mail@zabfox.de>**, gerne mit dem Betreff
`[SECURITY] network-topology`.

Hilfreich im Bericht:

- betroffene Modul-Version (steht im Footer der Modul-Seite und in `manifest.json`)
- Zabbix- und PHP-Version
- eine möglichst knappe Reproduktion — gerne Request/Response oder ein kurzer Ablauf
- die Einschätzung, was ein Angreifer damit erreichen kann

Ich bestätige den Eingang **innerhalb von 7 Tagen** und melde mich mit einer
Einschätzung, sobald ich den Fall nachvollzogen habe. Das ist ein Ein-Personen-
Projekt in der Freizeit — feste Fix-Fristen kann ich nicht zusagen, aber
sicherheitsrelevante Meldungen haben Vorrang vor Features.

Wenn du möchtest, nenne ich dich im CHANGELOG namentlich als Finder — sag einfach
Bescheid, ob und wie.

### Unterstützte Versionen

Fixes gibt es nur für die **jeweils neueste Version** (siehe
[CHANGELOG](CHANGELOG.md)). Ein Backport auf ältere Stände ist nicht vorgesehen.

### Was in den Geltungsbereich fällt

**Ja:** dieses Modul — die PHP-Actions unter `actions/`, die Topologie-Logik unter
`topology/`, das Frontend unter `assets/js/`, die fünf Widget-Module unter
`widget*/` sowie die mitgelieferten Skripte `deploy.sh`, `nt-install.sh` und
`tools/`.

**Nein:** Zabbix selbst (→ [Zabbix Security](https://www.zabbix.com/security)),
die mitgelieferten Fremdbibliotheken (Cytoscape.js, Leaflet — bitte direkt
upstream melden).

### Sicherheitsmodell in Kürze

Das Modul dokumentiert seine Annahmen offen im
[README, Abschnitt „Sicherheit"](README.md#sicherheit) — insbesondere:

- **CSRF:** lesende Actions verlangen `X-Requested-With` (`requireAjax()`).
  **Vier Actions wirken nach außen** und prüfen zusätzlich einen echten
  Zabbix-CSRF-Token:

  | Action | Wirkung | Gate |
  |---|---|---|
  | `network.topology.maintenance` | legt ein Wartungsfenster an | Admin **plus** Host-Schreibrecht |
  | `network.topology.links` | schreibt manuelle Kanten | geteilte Ebene nur Super-Admin |
  | `network.topology.positions` | schreibt die Kartenanordnung | geteilte Ebene nur Super-Admin |
  | `network.topology.portscan` | **Netzwerk-Seiteneffekt**: TCP-Verbindungsversuche | Admin, feste Portliste, Ziel wird serverseitig über die API aufgelöst, gedrosselt |

  Der Portscan ist der einzige mit einer Wirkung außerhalb von Zabbix. Er nimmt
  **keine** Adresse vom Client entgegen — sie wird aus der Host-ID über die API
  aufgelöst, womit die Rechte des Benutzers gelten und SSRF ausscheidet.

  Frühere Fassungen dieser Datei sprachen von „der einzigen schreibenden
  Action". Das stimmte zuletzt in 4.x; Links, Positionen und Portscan kamen
  danach dazu.
- **XSS:** alles, was aus Zabbix oder vom Netz kommt — inklusive **LLDP/CDP-Nachbarnamen,
  die von fremden Geräten stammen** — muss vor dem Einfügen ins DOM durch `esc()`
  laufen oder über `textContent` gesetzt werden. Zwei CI-Gates wachen darüber
  (`tools/check-xss.sh --strict` und ESLint `no-unsanitized`).
- **Berechtigungen:** IDs vom Client werden immer gegen die Zabbix-API geschnitten,
  nie direkt vertraut. APCu-Cache-Keys sind user-scoped.

Findest du eine Stelle, die diese Zusagen bricht, ist das ein gültiger Report —
auch ohne fertigen Exploit.

---

## 🇬🇧 English

### Reporting a vulnerability

**Please do not** open a public issue — that would disclose the flaw before a fix
exists.

Email **<mail@zabfox.de>** instead, ideally with the subject
`[SECURITY] network-topology`.

Useful in a report:

- affected module version (shown in the page footer and in `manifest.json`)
- Zabbix and PHP version
- the shortest reproduction you can manage — request/response or a brief sequence
- your view of what an attacker gains

I acknowledge reports **within 7 days** and follow up with an assessment once I
have reproduced the issue. This is a one-person side project, so I cannot promise
fixed remediation deadlines — but security reports take priority over features.

Happy to credit you by name in the CHANGELOG; just tell me whether and how.

### Supported versions

Fixes are provided for the **latest release only** (see [CHANGELOG](CHANGELOG.md)).
Backports to older versions are not planned.

### Scope

**In scope:** this module — the PHP actions in `actions/`, topology logic in
`topology/`, the frontend in `assets/js/`, the five widget modules in `widget*/`,
and the shipped scripts `deploy.sh`, `nt-install.sh`, `tools/`.

**Out of scope:** Zabbix itself (→ [Zabbix Security](https://www.zabbix.com/security))
and the bundled third-party libraries (Cytoscape.js, Leaflet — please report those
upstream).

### Security model in brief

The module states its assumptions openly in the
[README, "Sicherheit" section](README.md#sicherheit):

- **CSRF:** read actions require `X-Requested-With` (`requireAjax()`).
  **Four actions have outward effects** and additionally verify a real Zabbix
  CSRF token:

  | Action | Effect | Gate |
  |---|---|---|
  | `network.topology.maintenance` | creates a maintenance window | admin **plus** host write permission |
  | `network.topology.links` | writes manual edges | shared layer is Super admin only |
  | `network.topology.positions` | writes the map layout | shared layer is Super admin only |
  | `network.topology.portscan` | **network side effect**: TCP connect attempts | admin, fixed port list, target resolved server-side via the API, throttled |

  The port probe is the only one with an effect outside Zabbix. It accepts **no**
  address from the client — the target is resolved from the host ID through the
  API, so the user's permissions apply and SSRF is ruled out.

  Earlier revisions of this file spoke of "the single writing action". That was
  last true in 4.x; links, positions and the port probe came afterwards.
- **XSS:** anything coming from Zabbix or from the network — including **LLDP/CDP
  neighbour names announced by foreign devices** — must pass through `esc()` or be
  set via `textContent` before reaching the DOM. Two CI gates enforce this
  (`tools/check-xss.sh --strict` and ESLint `no-unsanitized`).
- **Permissions:** client-supplied IDs are always intersected against the Zabbix
  API, never trusted directly. APCu cache keys are user-scoped.

If you find a spot that breaks these promises, that is a valid report — even
without a working exploit.
