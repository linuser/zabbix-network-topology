# Changelog

Changes since the first public release. Versioning: MAJOR.MINOR.PATCH.

## Unreleased

### Fixed

- **The color guide explained the wrong scale.** It always showed the
  weathermap gradient — even with weathermap mode off, where edges are colored
  by *absolute* traffic. A 1.9 Mb/s edge on a 1G link is orange there (the
  1–10 Mb/s tier) and, read against the gradient, looked like ~50%
  utilization. The guide now shows the tiers of the active mode with the real
  edge colors and thresholds; the weathermap toggle updates it.

  Fixed along the way: the tooltip turned the percentage orange from 40%, the
  edge only from 55% — both now read the same table. And below 1% utilization
  the weathermap mode set an *empty* label, which Cytoscape treats as "remove
  the bypass": the traffic label came back and the edge looked as if the mode
  were off. It now reads "0.2%".

### Added

- **Configurable color scales (Super admin).** *View → Color scales* opens an
  editor for both edge scales — thresholds and colors per tier, add/remove
  tiers, live preview in the map, "Reset to defaults". Stored in
  `module.config` (new action `network.topology.scales`, CSRF-protected, Super
  admins only), applies to all users; a hand-edited entry in the DB falls back
  to the defaults when invalid. `ColorScales::sanitize()` has its own test —
  colors end up as CSS values in Cytoscape styles and the legend, hence strict
  six-digit hex.

## v5.1.2 — 2026-09-01

### Changed

- **No German text in the UI any more — and a gate that keeps it that way.**
  26 places converted: seven PHP messages to `_('English')` (the convention was
  already in the code), 13 places in the main module's JS through `t()` with
  twelve new keys in `de.js` **and** `en.js`, six widget messages simply in
  English — widgets have no `t()`.

  One of them had escaped the module altogether: the description written into
  the Zabbix database when a maintenance window is created
  (`NetworkTopologyMaintenance.php`).

  New: **`npm run ci:i18n`** (`tools/check-i18n.mjs`). It reads string literals
  with its own scanner rather than with grep, because both grep approaches fail
  on real code: a trailing `// Toggle "show offline hosts only"` is a comment
  and must be ignored, while `url: 'https://…'` carries a `//` *inside* the
  string. Comments may stay German — that is deliberate.

  Three gaps in the first version were closed, each covered by a regression
  test: the word list was case-sensitive (it missed „Ohne …"), it knew no noun
  endings (it missed „Zusammenfassung", which only surfaced in the browser), and
  it knew no ASCII transliteration (it missed „Laedt…" three times). `-tum` is
  deliberately **not** in the ending rule: it would catch "Momentum" and
  "Quantum".

### Fixed

- **Dashboard widgets did not count manual links.** The main module showed
  "4 edges, 4 manual" while the NT KPI widget next to it showed "0 edges" — the
  same data, different numbers. The reason: manual links arrive through the main
  module's page config (`NetworkTopologyView` → `NT_CONFIG`), and the edges are
  built in the client. A widget has no such view controller and therefore could
  never see them; the `ml_` counter in the KPI widget was dead code.

  `network.topology.data` now returns them on request (`manual_links=1`). Only
  the widgets set that flag — the main module keeps building its edges itself,
  otherwise they would exist twice.

  Deliberately **the shared layer only**: the personal layer belongs to an
  individual user (`CProfile`), and a dashboard whose edge count depends on who
  is looking would be worse than one that counts too low.

- **Topology widget: a single oversized node instead of the graph**
  (widget 3.1.1). The constructor ran a layout with `animate: true`, and the
  follow-up layout started a second one alongside it. Both write positions. The
  follow-up finished after ~30 ms and produced a usable picture — seconds later
  the animated init layout finished and put every node back on the same spot.
  After that nobody fits the view again, the zoom stays where it was, and one
  node fills the tile while the others sit exactly behind it.

  Recorded on a fresh 7.4 instance with six hosts: two `layoutready` events 1 ms
  apart, then the drop from 6 positions to 1 at 18.6 s. The constructor now uses
  `preset` (which moves nothing), so the follow-up is the only place a layout
  ever runs.

  Second, the follow-up only counts as done once its **result** is usable.
  Previously `done = true` was set *before* the layout ran, which is why the
  state never healed by itself. It now retries up to five times while the nodes
  are still coincident.

  **Not to be confused with [#7]**: that is a different bug, in the *main
  module*. There, `cose` **with `boundingBox`** writes `y = null` into every node
  position, the canvas stays empty while the KPI bar keeps counting. The commit
  fixing the widget bug references #7 by mistake — it is already published and
  cannot be rewritten. #7 remains open and is addressed by PR #8.

[#7]: https://github.com/linuser/zabbix-network-topology/issues/7

## v5.1.1 — 2026-09-01

### Changed

- **The LLDP template polls with `walk[]` instead of instance-exact GETs.**
  The SNMP index of `lldpRemTable` is
  `lldpRemTimeMark.lldpRemLocalPortNum.lldpRemIndex` — and `lldpRemTimeMark` is
  an RMON-2 TimeFilter. On two independent device classes that makes the old
  item prototypes unusable: **FortiGate** increments the TimeMark on every LLDP
  PDU it receives, so the index noted during discovery is invalid seconds later.
  **MikroTik RouterOS** answers walks on this subtree but returns
  `noSuchObject` for exact GETs — discovery therefore created items every single
  one of which stayed permanently unsupported.

  Both are our design error, not a device fault: instance-exact GETs against a
  TimeFilter table are fragile by construction. There is now a `walk[]` master
  item covering the six required columns; discovery and all six prototypes hang
  off it as **dependent** items and parse the walk text. The index is normalised
  to `0.Port.RemIndex`, and a guard discards duplicates (highest TimeMark wins).

  **No change needed in the module** — the key shape stays, and
  `LldpEdgeBuilder` still reads the local port from the middle of the index.

  **Item keys change on update**, from `lldpRemSysName[582295907.23.4]` to
  `[0.23.4]`. The prototypes keep their UUIDs and update in place on import; the
  already *discovered* items run into the lost-resource lifetime and take their
  history with them. They are rediscovered on the next walk.

  Contributed by **@christos-diamantis**, tested against a FortiGate and a
  MikroTik CRS326-24S+2Q+
  ([#3](https://github.com/linuser/zabbix-network-topology/issues/3),
  [#4](https://github.com/linuser/zabbix-network-topology/issues/4),
  [PR #5](https://github.com/linuser/zabbix-network-topology/pull/5)).

- **The MikroTik row of the vendor matrix is a measurement.** It had said
  "unverified" ever since it was written, because nobody had confirmed what
  RouterOS actually does. It now states what was measured: walks yes, exact GETs
  no. With that the matrix has **no unsupported row left** — Huawei and MikroTik
  went from claims to measurements within a single day, both through user
  reports.

- **The LLDP template speaks English too.** The remaining twelve description
  blocks are translated — template, macro, discovery rules and all eight
  prototypes. None of the three shipped templates contains German text any more.

### Fixed

- **The installation guide put the hardest path first.** Step 1 was 93 lines
  long — directory layouts, permissions, SELinux, service names, installing
  without internet access — while `nt-install.sh`, which does all of that
  itself, appeared only in three footnotes. A newcomer therefore read the manual
  procedure and only afterwards learned it had not been necessary.

  Now four commands using the script come first (about 20 lines including
  explanation), and the manual procedure sits below it in full, inside a
  collapsible block. **Nothing was deleted** — those 93 lines were hard-won, and
  by the guide's own troubleshooting table SELinux is the most common reason for
  "the module does not appear". They are simply no longer in the way.

  Both language versions. The URLs used are verified: the
  `releases/latest/download` address serves 712 KB, the script 20 KB.

- **The shipped templates carried German descriptions.** Not in comments, but in
  `description:` fields — precisely the text Zabbix displays in the UI after
  import. Anyone following the by-then English guide ended up with German
  Zabbix. `nt_health_score` and `nt_topology_change` are converted (four
  descriptions each, including the multi-line template description).

  `nt_lldp_snmp_template.yaml` with its 27 places follows once
  [PR #5](https://github.com/linuser/zabbix-network-topology/pull/5) is merged —
  that PR is restructuring the same file, and two parallel rewrites of one file
  produce nothing but conflicts.

- **"Module" was read as "widget".** In Zabbix most community modules are
  dashboard widgets, and that is how some people understood this one — even
  though the main module is a **page of its own** under *Monitoring → Network
  Topology*, and the five widgets are an optional extra that cannot run without
  it. Until now that only appeared in step 3 of the installation guide. It is
  now in the first paragraph of the README, in both languages, with a table:
  what is required, what is optional, and what each of them assumes.

- **The geo tab crashed as soon as no host had coordinates.**
  `render-geo.js` calls `esc()` three times in its empty state but does not
  import it from `utils.js`. esbuild bundles that without complaint — the free
  name ends up in the bundle, and at runtime you get
  `ReferenceError: esc is not defined`. The trigger is an everyday one: a host
  group without geo coordinates is enough. Found by **@christos-diamantis**
  while debugging something entirely different.

  The real finding, though, is that it passed twelve gates: ESLint ran here with
  `no-unsanitized` only, and `no-undef` was not enabled. It is now — with an
  explicit list of the 25 foreign globals this module assumes (browser,
  Cytoscape, Leaflet, Zabbix's `CWidget`) rather than a new dependency. Verified
  that the rule really catches the error: import removed again → three
  diagnostics, import restored → clean.

- **The Huawei row of the vendor matrix is now a measurement.** It had said
  "unverified", because no S5700 was available to cross-check and there is no
  public SNMP recording of such a device carrying LLDP data — the six Huawei
  walks in the LibreNMS collection are radio links, UPS and power supplies. The
  reporter from [issue #2](https://github.com/linuser/zabbix-network-topology/issues/2)
  settled it on the device: template linked, discovery triggered, edges there.
  VRP answers the IEEE standard LLDP MIB.

- **The SNMP view was the second hurdle — and no line of documentation
  mentioned it.** On some of his switches `snmpwalk` returned nothing although
  LLDP was demonstrably running: the LLDP OIDs were not in the device's view at
  all. What is not in the view does not exist as far as SNMP is concerned. On
  VRP:

      snmp-agent mib-view include iso-view iso
      snmp-agent community read <community> mib-view iso-view

  This is now in the Huawei box and as a row of its own in both troubleshooting
  tables. Nothing about it is Huawei-specific — any device with a restricted
  SNMP view behaves this way. It is the same class of failure as the three-hour
  discovery interval from 5.1.0: a cause nobody sees, because it looks like a
  broken feature.

### Added

- **`tools/nt-lldp-probe.sh` — one command instead of three guesses.** The bare
  `snmpwalk` has always been in the guide and is one line long. The problem was
  never the invocation but the **empty answer**: it can mean the device is
  unreachable, that the SNMP view hides the LLDP MIB, or that the table is
  simply still empty. Three completely different causes, one identical picture —
  and confusing them costs afternoons, see above.

  The script therefore makes three queries instead of one, names the case and
  prints a finished report. It **only reads** and **sends nothing anywhere**;
  the only connection goes to the IP the caller passes in. The community is
  taken from an environment variable or a hidden prompt, never as an argument —
  arguments end up in the shell history and are visible to anyone who can run
  `ps`. The report contains **counts, not neighbour names**, and never the
  community: there is nothing to redact. Verified against an `snmpwalk` stub
  across all four cases.

  It lives in `tools/` and is therefore **not in the module ZIP** — a shell
  script does not belong under the web root. Fetch it with `curl`, like
  `topo-change-sender.sh` and the template YAMLs.

- **A second issue template: "Device report".** Until now there was only "report
  a bug", and a device report is not a bug — someone who merely confirms that
  their Aruba works is reluctant to open a bug ticket for it. The template asks
  for exactly the fields a matrix row needs, including **Zabbix and module
  version separately** (item collection changed between releases, and the LLDP-Q
  tab only exists from 5.1.0 on). It explicitly invites **negative** results: a
  "✗ no queryable neighbour table" saves the next person the same afternoon. And
  before submitting it asks for confirmation that no community string, host
  names or IP addresses appear in the text.

## v5.1.0 — 2026-08-30

### Updating from 5.0 — "Scan directory" is mandatory

5.1 brings three new actions: `network.topology.links`,
`network.topology.positions` and `network.topology.portscan`. Zabbix registers
actions when it **scans** the module directory, not when the files are copied.
Anyone who swaps the files and skips *Administration → General → Modules → Scan
directory* gets a map that loads — and manual links plus the saved node layout
that stall with "Unknown action". The old version worked, the new one does not,
and nobody connects that to a forgotten menu item.

`nt-install.sh update` therefore compares the action lists of the old and new
version and says so when new ones appeared; until now only the first-install
path pointed at "Scan directory". `nt-install.sh check` additionally reports the
installed version and the widgets present with their own version numbers — the
widgets are not installed by this script and would otherwise be left behind
unnoticed during an update.

Saved data stays: map layout and manual edges live on the server, pins, notes
and presets in the browser's `localStorage`. There is nothing to migrate — even
the revision field guarding against concurrent writes is derived from the
content and stored nowhere.

Coming from **4.x**? The directory rename is described under v5.0.0 further
down; `nt-install.sh update` clears the old installation itself.

### Added

- **Concurrent editing no longer overwrites anything.** Both layers — manual
  edges and map layout — save the *complete* state, not a delta. Two tabs of the
  same user, or two super admins:

      A loads, B loads, A moves a node and saves,
      B moves another one and saves — A's change is gone.

  Nobody got an error; the loss only surfaced on the next load and then looked
  like a module bug. The client now sends the revision its change is based on,
  and the server rejects instead of overwriting — with a message and the current
  state in the response.

  The identifier is derived from the content, so there is no new stored field
  and nothing to migrate. Before hashing, the data is sorted recursively: the
  *set* is what counts, not the write order — otherwise two clients that stored
  identical content would report a conflict.

- **Truncated links are reported.** `ManualLinks` caps at 2000 edges and used to
  cut off silently: saving 2500 returned "ok", and you noticed on the next load
  that 500 were missing. Positions have reported their truncation since 5.1; the
  edges do so now as well. The limit of 50 **views** for positions is reported
  too — until now the counter only counted discarded nodes and reported
  "0 truncated" while entire views were dropped.

- **Automated part of the clean-install test**
  (`tools/clean-install-test/smoke.sh`): package the module, bring up a real
  Zabbix 7.4, mount the module into it and check that the frontend answers, that
  the code is clean under the PHP version of the Zabbix image, and that the
  assets are served from the web root. Triggered **manually** as a CI job,
  because it needs Docker-in-Docker. Enabling the module and rendering stay
  manual — Zabbix has no API for "Scan directory".

- **Manual links now live on the server, no longer in `localStorage`.** Until
  now hand-drawn edges were tied to one browser: gone when the cache was
  cleared, invisible to colleagues, gone on the second machine. They now live in
  **two layers**:

  | Layer | Storage | Who writes | Who sees it |
  |---|---|---|---|
  | shared | `module.config` | super admins only | everyone |
  | personal | the user's `CProfile` | everyone, for themselves | only they |

  Whoever may maintain the shared map does maintain it: a super admin draws into
  the shared layer, everyone else into their personal one. Both are merged on
  load, and shared edges win on duplicates. They are distinguishable on the map —
  shared ones are stronger and dashed more widely.

  The permission boundary is not a design decision but Zabbix: `CModule` checks
  hard for `USER_TYPE_SUPER_ADMIN` in `update()`. `module.config` is therefore
  **not** read through the API — which denies non-super-admins even read access —
  but through the ModuleManager, where Zabbix already holds the config after
  bootstrap.

  Existing `localStorage` links move once into the personal layer on first load,
  provided nothing is stored server-side yet. The old entry stays as a safety
  net but is no longer read.

  No host tag as with `nt:parent`: a link may point at a **ghost node** — a
  neighbour reported over LLDP that does not exist in Zabbix at all. A tag would
  need a host, and there is none here.

  Writing goes through the new action `network.topology.links` (POST, its own
  CSRF token, rate limiting, `USER_TYPE_ZABBIX_USER` for the personal layer and
  super admin for the shared one). The frontend writes optimistically: the edge
  appears at once, and if the POST fails it is rolled back and the error is
  reported — otherwise an edge would sit on screen that does not exist on the
  server.

  `tests/ManualLinksTest.php` covers the validation (21 checks). Two rules are
  easy to overlook: the **pipe** is forbidden in node IDs, because personal links
  are stored as `s|t`, one per `CProfile` row; and the pair is stored **sorted**,
  because an edge is undirected and `{a,b}` would otherwise sit next to `{b,a}`.

- **A KPI row above the map.** Six numbers at a glance: hosts, OK/warn/crit,
  edges and unmonitored neighbours. By default as compact chips (~40 px), in
  wallboard mode (`?wallboard=1`) as large tiles — below the row there is no
  scroll area but the graph itself, and height taken at the top is missing from
  it permanently.

  Two of the numbers did not exist anywhere before: **edges** broken down by
  origin (drawn by hand, from LLDP/CDP, to ghosts) and **ghosts** — neighbours
  reported over LLDP without a host in Zabbix. All read from the graph, no
  backend, no new action.

  Removed along the way: `updateBadge()` in `render-tech.js` had been trying
  since v4.18.3 to write numbers into an element `#nt-badge` that **was never
  created anywhere in the entire history** — the function bailed out on line 2 on
  every call, and nobody ever saw those numbers. With it goes the file's only
  suppressed `no-unsanitized` site.

- **Two new dashboard widgets.** That brings the package to five:
  - **NT KPI** — the same figures as a tile, either as a ring (severity
    distribution with the host count in the middle) or as a grid.
  - **NT Items** — one item pattern pivoted across all hosts of the selected
    groups: hosts as rows, matching keys as columns. A fixed pattern in the form
    instead of the main tab's interactive selection; on a tile that interaction
    does not exist.

  Both build with `createElement`/`textContent` instead of `innerHTML` and
  therefore need no entry in `eslint-suppressions.json`.

- **The map layout now lives on the server — with a shared layer.** Where the
  nodes sit used to live in `localStorage`: tied to one browser, gone when the
  cache was cleared, and everyone arranged their own map.

  Two layers as with manual links: a **super admin** maintains *the* map — the
  one everyone sees, the one you link into a ticket, the one on the wallboard.
  Everyone else deviates from it personally.

  The difference from links is in the merge: the personal layer wins **per
  node**, not as a whole. Move three devices and you keep three positions of your
  own — everything else keeps following the shared map, even if an admin
  rearranges it later. Non-admins only store the **deviation**; if the full
  layout were stored there it would mask the shared layer forever.

  Positions depend on the group selection, so the view key is part of the
  structure — with its own entry for the group view, which has pseudo nodes of
  its own. Existing `localStorage` layouts move once into the personal layer on
  first load, provided nothing is stored server-side for that view yet.

  Writing goes through the new action `network.topology.positions` (POST, its own
  CSRF token, rate limiting). `tests/NodePositionsTest.php` covers the validation
  with 23 checks — the view key is validated just as strictly as the node IDs: if
  it were freely choosable, a client could fill `module.config` with arbitrary
  keys.

  **Pins and notes stay in `localStorage` for now.**

- **Turning an unmonitored neighbour into a host.** Ghost nodes now have a
  context menu of their own, with provenance (which host reported them over
  LLDP/CDP) and — for admins — an entry that opens Zabbix's own host form
  **pre-filled**: name, current host group, provenance in the description.

  The host is deliberately not created by us: no writing action, no permission
  check of our own, no half-created hosts. Zabbix validates, creates and
  rejects. Until now ghosts fell into the host branch of the menu and got entries
  such as "Latest data", which inevitably lead nowhere for a host that does not
  exist.

- **Vendor, device type and MAC of unmonitored neighbours.** "Turn a ghost into a
  host" fails in practice on a simple question: *what is that thing?* A name like
  `CNQ6KD51WK` does not answer it.

  The LLDP template therefore collects three more fields that the switches report
  anyway — system description (`.10`), capabilities (`.12`) and chassis ID
  (`.5`). From those the ghost menu derives vendor, device type and MAC. The
  capabilities are an OCTET STRING bitmap; it is decoded defensively and, in
  doubt, returns nothing rather than a false claim.

  If you have already linked the template, the fields arrive with the next
  discovery. If they are missing, nothing changes — all three are optional, and
  many devices report only some of them.

- **Device type from the protocol instead of a vendor list.** Reported: Cisco
  switches end up under "Server / virtualization" instead of "Switch". The cause
  was not a missing entry but the approach. `deviceType()` guesses from host name
  and template names, and the patterns had been written against invented names —
  counted against a real installation, they matched **2 of 14** official Zabbix
  network templates. `mikrotik routeros` also missed, because the template is
  called "MikroTik by SNMP".

  Extending the list would be the wrong answer: for Cisco alone Zabbix ships nine
  templates, two of which (UCS, UCS Manager) are servers — a `cisco` pattern
  would misfile those. Instead the protocol answers the question. The **LLDP
  capabilities** per IEEE 802.1AB say `Bridge`, `Router` or `WLAN AP`, vendor
  independently; the module already decoded them, but only for unmonitored
  neighbours.

  Four stages, first one wins:

  | | Signal |
  |---|---|
  | 1 | `nt:icon` tag |
  | 2 | name and template patterns (unchanged) |
  | 3 | LLDP capability a neighbour reports |
  | 4 | maintains a neighbour table itself → network device |

  Stages 3 and 4 only apply **if** stage 2 ended in the `server` fallback. The
  other way round would be risky: a host named `rtr-core-01` also reports the
  bridge bit as an L3 switch and would be restamped as a switch by the protocol,
  although the name knows the intent. This way nothing changes for any host that
  is correctly detected today.

  `tests/DeviceTypeTest.php` pins the order, using real template names from a 7.4
  installation rather than invented ones.

- **An uninstall script that also names the leftovers.** `nt-uninstall.sh`
  removes the main module and the widgets — and then shows what stays behind on
  the server. That became necessary once the map was stored server-side: the
  **shared** layer clears itself, because `module.config` is a column of the
  `module` row and dies with it. The **personal** layer hangs off the user
  profile and survives any uninstall without anyone noticing.

  ```bash
  ./nt-uninstall.sh --dry-run     # shows only, changes nothing
  ./nt-uninstall.sh --purge       # additionally clears the user profile
  ```

  Directories are **moved**, not deleted — to
  `/var/backups/nt-uninstall-<date>/`, with the restore command printed. Only
  things whose `manifest.json` carries a `network_topology` ID are touched; a
  foreign module that happens to be called `widget/` is left alone. Old `_v6`
  directories from 4.x are included — even those named after the source folder.

  Host tags, templates, cron and monitoring users stay **untouched**. Those are
  data you created yourself; `nt:parent` describes the user's infrastructure, not
  the module. The script lists them and prints the SQL, but running it is up to
  you.

- **Service probe on click.** The host context menu has an entry that checks a
  fixed list of 11 ports (SSH, Telnet, HTTP/S, SNMP, SMB, LPD, RDP, Proxmox,
  HTTP-alt, JetDirect) and distinguishes *open* / *refused* / *timeout* — the
  three states are different statements, and "refused" means: there is a device,
  just not this service.

  Deliberately kept narrow: it runs on click only and never by itself, the port
  list lives in server code and cannot be chosen by the client, the client sends
  **only a hostid** — the server resolves the address through the Zabbix API so
  that the user's permissions apply —, it requires at least Zabbix Admin, and it
  is limited to 5 calls per minute per user. 0.4 s per port, so 4.4 s in the
  worst case.

  Meant as "what is this box", not as a scanner.

### Changed

- **The widgets now follow Zabbix's own update cycle.** All of them ran their own
  `setInterval` (30/30/60 s), while the `CWidget` base class periodically called
  the view action in parallel and replaced the widget body with fresh view
  HTML — the "Loading…" placeholder, which their own timer only overwrote up to
  60 s later. The widget tiles therefore fell back to "Loading…" regularly.

  They now override `promiseUpdate()`. With that the dashboard's refresh setting
  applies instead of three hard-wired numbers, and the cycle pauses by itself
  when the page is inactive.

- **Version bump for the three existing widgets** — NT Topology to 3.1.0, NT
  Health Score and NT Table to 2.1.0. Their JavaScript was rewritten by 266 lines
  (update cycle, shared data access) while the version number stayed put. Anyone
  updating would see the same number in the module list with different behaviour
  and could not tell installed from outdated.

- **Consistent names.** In the dashboard menu the widgets are all called `NT …`
  (Zabbix sorts alphabetically — without a common prefix they sat in three
  different places in the list). In the module list they all carry an English
  description in the same shape; the graph widget was only called "— Widget"
  there and is now "— Topology Widget". Display text only: the widget IDs stay,
  and existing tiles keep their stored title.

### Fixed

- **The shared layer went to every user unfiltered.** The topology comes from the
  Zabbix API and is permission-filtered; the shared map lives in `module.config`
  and knew no permissions. Nothing of it was visible — the frontend only draws an
  edge between nodes that exist — but the delivered JSON contained host IDs from
  foreign groups, group IDs in the view keys, and device names announced over
  LLDP from network segments the user has no access to. It is now filtered
  against the visible hosts and groups.

- **Without APCu there was no rate limiting at all.** The rate limit started with
  "no APCu → let it through". Defensible for the reading actions, not for the
  port scan: it works synchronously, eleven ports times timeout block a PHP
  worker for several seconds, and the limit of 5 per 60 s simply did not exist
  without APCu — while INSTALL.md explicitly lists APCu as optional. It now falls
  back to a sliding window in the session.

- **Error messages went to the client unchecked.** The actions for edges and
  positions passed every exception message through; database, schema and
  TypeError texts can contain paths, class and column names. Now as with the
  maintenance windows: only Zabbix API messages go out, the rest into the server
  log. Along with it `catch (Throwable)` instead of `catch (Exception)` — a
  TypeError was not caught at all before.

- **The diagnostics ring buffer lost entries under load.** Read, append, write
  back is not atomic; two concurrent requests overwrote each other. It is now a
  real ring buffer over atomically assigned sequence numbers.

- **CI did not run at all for 32 commits.** An explicit `stages` list replaces
  GitLab's defaults — the `parity` job was added with `stage: test`, but `test`
  was not in the list. GitLab does not skip such a job, it rejects the *entire*
  pipeline. Nothing turned red, which is why nobody noticed. A new gate
  (`npm run ci:pipeline`) catches this **locally** in future — in the pipeline it
  would be too late, because an invalid CI file cannot start a job any more.

- **The security documentation described an outdated model.** `SECURITY.md` spoke
  of "the only writing action" — there are four (maintenance, edges, positions,
  port scan) — and of three widget modules, where there are five. `INSTALL.md`
  recommended `chown -R apache:apache` for RHEL, while three paragraphs earlier
  the same file prescribes `root:root` so that a compromised PHP process cannot
  rewrite the module code.

- **Port 161 was labelled "SNMP" in the port list.** SNMP actually runs over UDP;
  a TCP timeout there says nothing about SNMP. The code had always known that,
  the user only saw "SNMP: timeout". It is now called "SNMP/TCP".

- **The KPI row counted ghosts as hosts — and still reported "0 ghosts".** With
  the ghost toggle on, the count received the already enriched node array. Both
  followed from that at once: `injectGhostNodes` skips every ID it already knows,
  so the difference stayed zero — precisely when the ghosts were visibly on the
  map. And a ghost has `severity 0`, so it went through the severity loop as
  **OK**. On a map with 11 devices and one ghost the row read "12 hosts, 4 OK"
  next to three green nodes.

  Both numbers corrected themselves after 30 seconds, because the refresh path
  passes the raw backend nodes — the most unpleasant kind of bug: by the time you
  look, it is gone.

  The count now filters out `_isGhost` and the internet cloud before anything is
  counted — including for the "hosts" figure itself. The first attempt had only
  changed the severity split, which is why the row visibly stopped adding up:
  "14 hosts, 11 OK" and nothing else.

  On top of that, all four callers now get the same set, namely the raw host list
  from the backend. The render path was the only one passing the version enriched
  with group aggregates, internet cloud and ghosts; in the group view the number
  jumped from "3 hosts" to "47 hosts" while an edge was being dragged, without a
  single host having changed. The KPI **widget** was never affected; it gets the
  backend data directly and derives the ghosts itself.

- **Port-to-port labels had been dead all along.** The README advertises that on
  LLDP/SNMP switches every edge carries the local **and** the remote port. It
  never did: the item lookup did not query the port OIDs at all, `lldpRemPortId`
  and `lldpRemPortDesc` were not in the key list. The labels fell back silently
  to host-to-host — silently, because missing ports look like "this device does
  not report any".

  Measured against a switch: from 9 to 19 items fetched. Cross-checked on two
  SNMP switches that see each other — the edge between them now carries the port
  at both ends.

  The weathermap depends on this too: without a port mapping it could not colour
  by the *measured* utilization of the interface concerned, only by an estimate
  at node level.

- **The super admin could not see their own shared map.** When the layout moved
  to the server, existing `localStorage` positions migrated into the **personal**
  layer — for the super admin as well. Their personal layer then masked the
  shared one they were maintaining themselves: they arranged the map for
  everyone but kept seeing their own old state. The migration now writes into the
  layer that matches the role, and saving to the shared layer deletes the
  personal entry for that view.

- **Two of the three shipped templates could not be imported.**
  `nt_health_score_template.yaml` and `nt_topology_change_template.yaml` had no
  `uuid` under `template_groups`, which Zabbix 7.0 requires there. The import
  aborted with

  ```
  Invalid tag "/zabbix_export/template_groups/template_group(1)":
  the tag "uuid" is missing.
  ```

  Both are recommended for import as step 4 in `INSTALL.md` — so everyone who
  followed the guide saw it.

  Behind that were two further errors, each revealed only by the next import
  attempt. **The wrong group:** the added `uuid` had been copied from the working
  third template — but it belongs to `Templates/Network devices`, not to
  `Templates`. Two different group names therefore carried the same `uuid`. **And
  five `uuid`s that were not:** hand-typed patterns such as
  `8a2b3c4d5e6f47081920a1b2c3d4e5f6` — 32 hex characters, but not a UUIDv4.
  Zabbix checks version and variant:

  ```
  Invalid parameter "/2/uuid": UUIDv4 is expected.
  ```

  The correct group values are in the `hstgrp` table and are the same on every
  installation: `Templates` is `79f31eeab03146229b1e019097fad672`,
  `Templates/Network devices` is `7df96b18c230490a9a0a9e2307226338`. The five
  typed `uuid`s were replaced with generated ones. The LLDP template was never
  affected — every `uuid` there is genuinely generated, which is why that one of
  all things always went through.

  The new CI job `templates` checks four rules: `uuid` present, name → `uuid`
  unique, `uuid` → name unique, and **every** `uuid` in the file a real UUIDv4.
  The last rule is not restricted to groups — the five broken ones were in items
  and triggers.

  All three templates have been imported on a 7.0 instance; the LLDP template
  runs against two SNMP switches.

- **A gate over the two-layer logic.** What different users see on the same map
  had only ever been reasoned through by hand. `npm run ci:layers` checks it with
  fabricated `NT_CONFIG` data:

  - A user without positions of their own sees exactly the shared map.
  - **Personal wins per node**, not as a whole — the rest keeps following the
    shared layer.
  - A deviation in one view does not touch other views.
  - Super admins write shared, everyone else personal.
  - For manual links **shared** wins, in the reversed direction too — an edge is
    undirected and must not appear twice.

  Each scenario runs in its own process: `storage.js` reads the configuration in
  IIFEs at import time, and a second import with different data would get the old
  state. That is also the most honest reproduction of "another user loads the
  page".

  **Not covered** is the path server → database → permission check; that needs
  two logged-in users in a browser.

- **A gate over the package contents.** `npm run ci:package` simulates what would
  end up in the module ZIP and rejects what does not belong there: shell scripts,
  `tools/`, `templates/`, `tests/`, source maps, the repository itself.
  Conversely it checks that the mandatory files **are** there — without the
  bundle or Cytoscape the package is broken, and that otherwise only shows up
  during installation.

  The gate reads the exclusion patterns **from `deploy.sh`** rather than
  repeating them. A second list would be a second place to drift — and then the
  gate checks something other than what the installer builds. That is exactly how
  `nt-uninstall.sh` slipped into the package: the list only named the scripts
  known at the time, and it was noticed only because somebody looked.

- **The shipped dashboard could not be imported on any supported version.**
  `dashboards/nt-overview.yaml` carried `version: '7.0'`, and
  `dashboards/README.md` described a "Dashboards → Import" route. Neither works:
  **standalone dashboards are only importable from Zabbix 8.0 on.** Measured
  against the validators of 7.0, 7.2 and 7.4, all three answer

  ```
  Invalid tag "/": unexpected tag "dashboards".
  ```

  and in the UI of those versions there is neither an import nor an export button
  for dashboards. Noticed while testing against Zabbix 8, where the import does
  work — there the `uuid` was then in the way, which Zabbix does not know at
  dashboard level.

  The file is now a valid 8.0 version, with **all five widgets** instead of the
  previous three (KPI and Items had been missing since they were introduced), and
  without a pre-set host group — otherwise it would refer after import to group
  IDs that do not exist on the target installation. Accepted by Zabbix's own
  import validator. The `README.md` beside it now says that 7.0 and 7.4 have to
  rebuild the dashboard by hand, and supplies the geometry for it.

- **The `ci:templates` gate tripped over comments.** A line such as
  `# No uuid: the validator rejects it` was read as an invalid `uuid` — found
  when exactly that sentence went into the dashboard file. Comments are now
  stripped before the check. A gate that fails on prose teaches you to stop
  looking.

- **The README still named only one module path.** Precisely the error a user had
  reported — it had only been fixed in `INSTALL.md`, while the short version in
  the README stayed at `/usr/share/zabbix/ui/modules`. Anyone reading the landing
  page instead of the guide ended up in front of a path that does not exist on
  their system. Both layouts are now there as well, with the `find` one-liner.

  On top of that, `nt-install.sh` and `nt-uninstall.sh` were missing from the
  README entirely, even though the installer detects the path itself and sets the
  SELinux context on RHEL — that is, exactly the two traps a manual installation
  falls into. And the warning about `git clone` is now on the landing page too,
  not only in the guide.

- **The README still described 4.x in substance.** The version number in the
  badge was right, the feature set below it was not: the KPI row, ghost nodes,
  device type from the protocol and the service probe appeared **zero times** —
  that is, precisely the things that make up the jump. Anyone arriving from the
  forum or from zabfox.de read a landing page that omitted half the scope. Added
  in both languages, including the highlights line at the very top.

- **LLDP capabilities were read wrongly on half the devices.** Only noticed once
  real values flowed again after the proxy outage. The field arrives in **two
  shapes**, depending on the template:

  ```
  HP Instant On   "20 00", "28 00"                raw hex bytes
  TP-Link         "Bridge", "WLAN Access Point"   resolved by a value map
  ```

  The decoder only knew hex. Filtering `Bridge` left the hex digits `B`, `d`,
  `e`, from which came `0xBD`, from which came **five capabilities that were
  never reported** — and a switch turned into an access point. The comment
  promised "in doubt, rather nothing"; that was not true, the result was
  confidently wrong. The ghost display, which has shown this list since `bc5da3f`,
  was affected too.

  The two are now told apart by their characters: hex digits and whitespace only
  → hex, otherwise text. No capability name consists solely of hex digits, so the
  split is unambiguous. `tests/DeviceTypeTest.php` checks both shapes with the
  real values from both switches.

- **The `shellcheck` CI job had been red for a long time — unnoticed.** It fails
  on *info* diagnostics too, and five places in `nt-install.sh` carried the
  pattern `A && B || C` (SC2015). That is already in v4.38.3, every pipeline
  since then was red, and because the local `npm run ci:shellcheck` simply says
  nothing without `shellcheck` installed, it never came up. The five places are
  now real `if` constructs — not merely for the diagnostic: with `A && B || C`,
  `C` also runs when `A` was true and `B` failed.

  `nt-uninstall.sh` was not in the gate at all; it has been added, in
  `package.json` and in `.gitlab-ci.yml`. All four scripts now pass with exit 0,
  verified with shellcheck 0.10.0.

- **The 5000-node limit on positions truncated silently.** Arranging a map with
  more nodes than that got you part of it saved and no indication — on the next
  load, positions were missing for no visible reason. That looks like data loss,
  not like a limit. The action now returns how many nodes it discarded, and the
  map reports it. Noticed while preparing a load test: a silent truncation would
  have produced measurements there that nobody could have interpreted.

- **The vendor matrix listed MikroTik as "works" — without evidence.** All that
  was established was that the module looks for `discovery.neighbor` items and
  processes them. Whether RouterOS serves the neighbour table over ordinary SNMP
  had never been checked on a device; there is neither a test nor a fixture. The
  row now reads **unverified**, with a concrete `snmpwalk` that lets any RouterOS
  operator settle the question in five minutes.

- **The installation guide assumed a directory layout that does not hold
  everywhere.** A user reported that the `ui` folder was missing on their system.
  Packages from the Zabbix repository put the frontend into `/usr/share/zabbix` —
  **without** `ui`; other installations have `/usr/share/zabbix/ui`.
  `nt-install.sh` and `deploy.sh` have always detected both, but anyone following
  the guide by hand faced a path that does not exist for them. Both layouts are
  now named, with a `find` one-liner to check.

- **The guide did not advise against `git clone` — now it does, with a reason.**
  The route stood beside the others as an equivalent variant B. But it puts the
  **entire repository** under the web root, and Zabbix's nginx configuration only
  blocks `/\.ht` there, not `.git`. Measured on a test installation:

  ```
  /modules/<directory>/.git/HEAD                      HTTP 200
  /modules/<directory>/.git/index                     HTTP 200
  /modules/<directory>/tools/topo-change-sender.sh    HTTP 200
  ```

  The repository is public, so nothing secret escapes at first. But `tools/`
  contains the sender script, which reads credentials from environment variables
  — put them into the file and they are on the internet. That is exactly what the
  exclusion list in the release ZIP is for. The variant has been removed from the
  guide and replaced by a warning plus a clean-up command.

- **`unzip` is now listed under the prerequisites**, likewise after a user
  report: minimal installations do not ship it.

- **The guide recommended `www-data` as the owner.** The web server only needs to
  **read** the module files. Give it ownership and a compromised PHP process can
  overwrite the module code. `root:root` is enough and now stands alone.

- **Four views spoke German regardless of the configured language.** Reported by
  a user on an English UI: *"Most is in English, but some is in German."* They
  had not missed anything — the translation was incomplete, and `i18n.js` says so
  in its own header comment: modules not yet migrated keep hard-wired German.

  Affected were the **Compliance, Diag, Geo and LLDP-Q** tabs with 23 strings
  between them, including the complete labelling of the compliance checks (`Agent
  without TLS`, `Inventory off`, `Stale crit problem`, `Maintenance without
  comment` …), which also appears in the audit report from `export.js`. They all
  go through `t()` now, with 25 new keys in `de.js` and `en.js`.

  For the geo notice the markup stays in the code and only the text parts come
  from the translation — an i18n file carrying HTML would be the wrong route, and
  sentence structure differs between languages anyway.

- **`nt-install.sh` aborted across the whole RHEL family.** Detection of the
  php-fpm service ran into a SIGPIPE trap:

  ```bash
  systemctl list-units … | grep -q 'php-fpm\.service'
  ```

  `grep -q` exits on the first match and closes the pipe, `systemctl` then ends
  with 141 — and because the script sets `set -o pipefail`, the whole pipeline
  counts as failed **even though the match was there**. Measured on Rocky 9:
  without `pipefail` exit 0, with `pipefail` exit 141.

  On Debian this never showed, because the first branch matches there
  (`php8.2-fpm.service`). On RHEL the unit is simply called `php-fpm.service`, so
  **only** the second branch can match — and that was the broken one. The
  installer reported "no php-fpm service found" on a machine where php-fpm was
  running, and aborted before it ever reached `restorecon`.

  The unit list is now fetched once into a variable and evaluated without a pipe.

- **The same trap in the zip-slip check — fail-open there.** The protection
  against absolute and `../` paths in the archive read
  `unzip -Z1 … | grep -qE …` directly in the condition. If `grep` finds an unsafe
  path it exits immediately, `unzip` runs into SIGPIPE, `pipefail` makes the
  condition **false** — and the archive *with* the unsafe paths, of all things,
  would have slipped through. Whether it happens depends on whether `unzip` is
  still writing when `grep` exits: usually not for small archives, yes for large
  ones. A security check that sometimes works and sometimes does not.

- **The installer demanded Zabbix 7.4 although it installs the main module.**
  That runs on 7.0 LTS; only the widgets need 7.4, and `nt-install.sh` does not
  install those at all. On a 7.0 LTS the check warned about exactly the
  combination the documentation recommends.

  **Reproduced on a real Rocky 9.8 with SELinux in enforcing mode** (Proxmox VM,
  not a container — there is no SELinux in a container, and the installer would
  skip `restorecon` and appear to pass). The before/after proof from inside the
  real php-fpm process:

  ```
  user_tmp_t  →  Failed to open stream: Permission denied
  usr_t       →  read, 2704 bytes
  ```

- **Step 4 of the installation was not executable along the documented route.**
  `INSTALL.md` referred to `templates/…` and `tools/topo-change-sender.sh`, and
  `LLDP-SETUP.md` called the LLDP template "shipped". None of those four files is
  in the module ZIP — `deploy.sh` excludes `tools` and `templates`. Anyone
  installing from the ZIP had relative paths pointing nowhere and no hint where
  the files come from.

  The exclusion stays and is correct: the module directory sits under the web
  root and is publicly retrievable — a 1 MB source map once lived there. The
  runtime does not need a sender script and template YAMLs. Instead both
  documents now name the files without a directory prefix, explain in a box why
  they are not in the package, and give `curl` lines against the repository. The
  exclusion in `deploy.sh` now carries a comment pointing at step 4.

- **Both installers now set the SELinux context themselves.** `nt-install.sh` and
  `deploy.sh` unpack into `/tmp` and move the result into place with `cp -a` or
  `mv` — both **preserve** the context. Files from `/tmp` carry `user_tmp_t`,
  php-fpm runs as `httpd_t` and may not read that. The module therefore sat on
  RHEL/Rocky/Alma with correct permissions and correct owner in the right
  place — and still did not appear in the UI. Both now call `restorecon -R` when
  it is available and SELinux is active; on Debian/Ubuntu the call is a silent
  no-op and never fatal. `INSTALL.md` points out in both languages that the
  manual step is now only needed when unpacking by hand.

- **A High problem counted as "Warn".** The severity buckets of the KPI row threw
  everything between OK and Disaster into one pot — a host with **High** appeared
  under "Warn", while the toolbar one line above shows separate pills for Warn,
  Avg and High and the node glows red in the graph. Now: `ok` = Normal, `warn` =
  Info through Average, `crit` = High and Disaster.

- **"0 ghosts" was a claim, not a measurement.** Ghost nodes only enter the graph
  when the toolbar toggle is on (default: off) — but the count was taken from the
  graph. With the toggle off it read zero regardless of how many there were, and
  that on the very figure meant to prompt an action. The count now comes from the
  same source the injection uses; with the toggle off, "hidden" is shown beside
  it.

- **German strings in an English UI.** The button below the host group selector
  called `_('Auswahl leeren')` — the *source* string was German, and Zabbix's
  gettext translates against English source text, so it passes a German one
  through unchanged. Likewise the health widget was the only one still carrying
  German labels (score labels, header, legend), and the header wrote "1 Gruppen"
  — singular and plural were not distinguished. Both fixed; the package is now
  English throughout.

- **The percentage column in the Items widget jumped.** Rounding cut the trailing
  zero, so "6%" stood next to "5.9%". Fixed decimal place.

- **A firewall and a video recorder were drawn as wireless access points.** The
  type heuristic had `unifi` and `omada` in the "wireless" list — but those are
  **product lines, not device classes**: UniFi covers gateways, switches,
  cameras, recorders and access points. On top of that "wireless" is checked
  before "camera", so the broad vendor name even beat the specific `nvr`.
  Matching runs against host name **plus** template names, and both devices were
  linked to the UniFi template — so they carried the vendor name implicitly.

  The vendor name now decides nothing; model ranges are recognised instead:
  UDM/USG/UXG → firewall, USW → switch, UAP/U6/U7 and the Omada EAP range →
  access point. Where nothing matches it stays at the server default — more
  honest than a guessed class, and anyone who disagrees sets `nt:icon`.

  These short abbreviations are bound to word boundaries rather than searched as
  substrings: `udm` occurs in "cloudmail", `uxg` in "luxgate", and "firewall" is
  checked first — a mail server would otherwise have become a firewall. For the
  same reason `unifi ap` must be followed by a word boundary: without it "UniFi
  API" matches too, and the recorder would hang in the network as a WAP again.
  **Icons may change after the update** — that changes nothing about the data.

- **The edge counter stalled for up to 30 seconds after every change.** Drawing
  an edge in star mode or deleting all links showed up in the graph at once — in
  the row beside it only on the next refresh. Noticed on a screenshot: three
  visible edges, "0 edges" next to them. Anyone seeing that assumes the number is
  broken, not stale.

  On first load the number read zero for the same reason, because it was taken
  before the stored edges were inserted. The rollback path now recounts too: if
  the server rejects an edge it disappears from the graph — and the row kept
  claiming it until the next refresh. A number confirming a failed save is worse
  than a stale one.

- **"PDF (print)" stopped opening a window.** `window.open()` sat behind the
  construction of the report, and that renders the whole map through `cy.png()` —
  hundreds of milliseconds on a larger topology. By then the user-gesture window
  has closed, the popup blocker kicks in, `window.open()` returns `null`, and the
  surrounding `if (w) { … }` swallowed exactly that: click, nothing happens, no
  message. The window now opens synchronously within the click, and the expensive
  part comes afterwards — with distinct messages for a blocked popup, a missing
  map and a failed report.

  Printing now waits until the embedded map snapshot has loaded; before that
  there was a fixed timeout, which printed an empty image on large maps. The
  audit report had only received half of this — both now share the same routine,
  including releasing the blob URL after the download.

- **The LLDP-Q tab reported "0 %" in red when there was nothing to assess.**
  Without LLDP items the match rate is not zero but undefined. The red zero
  looked like a measurement and made the module look broken, while the cause lies
  upstream: the shipped template is not linked, or discovery has not run yet. If
  no host reports neighbours, that is exactly what it now says — with the way to
  check — instead of a figure.

- **The export menu ran off the right edge of the window.** The button sits at
  the right end of the toolbar and the menu opened to the right: "PDF (pri…",
  "Save HT…" and "Audit rep…" were cut off and not clickable. It now opens
  right-aligned.

### Performance

- **Response cache for `network.topology.data`.** The action is the module's most
  expensive endpoint (host + trigger + problem + item + batched last values +
  LLDP) and was the only one of seven caching actions **without** a response
  cache — `NtCache` held only the topology baseline for it. 15 s TTL, well below
  any refresh interval.

  Two things stay outside the cache on purpose. **`topo_changes`** is based on a
  diff against the previous query; served from the cache, the diff would only run
  on cache misses and the same "new link" would be reported repeatedly for the
  duration of the TTL. **`requested_count`** depends on the untruncated input
  value, which is not part of the cache key.

- **Several widgets on one dashboard fetch the data only once.** Previously each
  queried `network.topology.data` separately — same action, same host groups. A
  shared accessor with request coalescing and a 15 s TTL bundles that. On a
  dashboard with four NT widgets that is demonstrably **one** data request per
  round instead of four.

### Internal

- **Documentation English first.** Two pieces of feedback mentioned the high
  proportion of German. `LLDP-SETUP.md` — the file users with missing edges are
  pointed at — existed only in German; it is now English, with the original
  alongside it as `LLDP-SETUP.de.md`. In the README the English section comes
  before the German one.

- **"Execute now" appeared in no documentation file**, and the default intervals
  nowhere — only the macro names. Anyone linking the LLDP template and reloading
  the map waits, without knowing it, up to three hours for something that looks
  like a broken feature. That was a documentation gap with the effect of a bug,
  and the common denominator of two error reports.

- **Huawei** listed as *unverified* in the vendor matrix, with the `snmpwalk`
  beside it and an explanation of why the official VRP template is not enough:
  the module does not speak SNMP, it reads items.

- **Direct access to the history tables is documented.** The last-value query
  assumes SQL history; with Elasticsearch as history backend the map shows nodes
  without metrics.

- `npm audit fix` — `brace-expansion` (high) through eslint → minimatch.

- **A gate against drift in the two deliberate duplicates.** The widget modules
  cannot import the main module's code — Zabbix's jsLoader knows no ES modules —
  so the same thing exists twice. Until now the request to keep them in sync was
  a comment in the files; `npm run ci:parity` turns it into a check. It guards the
  weights and thresholds of the health score formula (main module against widget)
  and the shared data accessor across four widget files. If the extraction finds
  nothing, that is a failure and not a pass.

## v5.0.0 — 2026-08-08

### ⚠️ Breaking — the `_v6` suffix is gone

Internally the module had always been called `network_topology_v6`; the "v6" was
a development number from before the first release and never had anything to do
with the Zabbix or the module version. It regularly led people to assume the
module was tied to Zabbix 6 — the opposite is true, it runs on 7.0 LTS and 7.4.
The suffix therefore disappears completely from every identifier.

| | before | now |
|---|---|---|
| Directory | `network_topology_v6` | `network_topology` |
| Module ID | `network_topology_v6` | `network_topology` |
| PHP namespace | `Modules\NetworkTopologyV6` | `Modules\NetworkTopology` |
| Actions | `network.topology.v6.*` | `network.topology.*` |
| Widget IDs | `network_topology_v6_*_widget` | `network_topology_*_widget` |

**There are deliberately no compatibility aliases.** The old action names are
gone, not deprecated.

### Migrating from 4.x

1. **Remove the old directory**, otherwise Zabbix registers both modules and the
   menu entry appears twice:
   ```bash
   cd /usr/share/zabbix/ui/modules
   sudo rm -rf network_topology_v6 network_topology_v6_widget \
               network_topology_v6_health_widget network_topology_v6_table_widget
   ```
2. Unpack the new ZIPs (see `INSTALL.md`), then
   **Administration → General → Modules → Scan directory** and set the modules to
   *Enabled*. The old entries disappear by themselves in the process.
3. **Update the dashboards.** The three widget IDs are stored in `widget.type`;
   after the rename Zabbix no longer knows the old type and hides the tiles. They
   have to be added and configured once. Only the tile is affected, not the
   dashboard.
4. **Update bookmarks** — the view now lives at
   `zabbix.php?action=network.topology.view`.

#### Optional: keep the dashboards, via SQL

If you would rather not rebuild the tiles, you can rewrite the identifiers in the
database instead. That is exactly what "Scan directory" plus a manual rebuild
would do — only without the clicking. **Take a backup first**, and only run it
once the new directories are already on disk:

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

`UPDATE` rather than `DELETE`+`INSERT` is deliberate: it preserves the
`moduleid`, to which `role_rule.value_moduleid` is tied by a foreign key with
`ON DELETE CASCADE` — deleting would silently remove role-based module
permissions along with it. Reload php-fpm afterwards.

**This route makes steps 2 and 3 above unnecessary.** Because the rows are
renamed rather than replaced, `status` is preserved — the modules stay enabled,
"Scan directory" and re-enabling are not needed, and the dashboard tiles stay
where they are. If you want to use widgets added since, you still need "Scan
directory" once: Zabbix does not know those yet.

Reproduced on two independent installations — the project demo and a second
instance on PostgreSQL. Both times: seven rows changed, all modules still
enabled, all tiles preserved.

**Everything user-side is preserved:** node positions, pins, notes, manual links,
filter presets and all toolbar settings. The localStorage keys carry a user
prefix (`u<id>_`) and were never tied to the module name. Host tags (`nt:parent`)
are untouched anyway.

### Changed

- Widget versions each gain a major because of the changed IDs: topology graph
  `2.0.0 → 3.0.0`, health score `1.0.1 → 2.0.0`, table `1.0.0 → 2.0.0`.
- Release assets are named accordingly: `network_topology.zip`,
  `network_topology_widget.zip`, `network_topology_health_widget.zip`,
  `network_topology_table_widget.zip`.

## v4.38.3 — 2026-07-27

### Fixed

- **Dashboard widgets stayed on "Loading…" depending on timing.** Two independent
  causes, both in the widget frontend:
  1. `data-groupids` arrives at the client **empty** in Zabbix 7.4 — the field
     values are only in `this._fields` there. The fallback to those existed only
     in the `else` branch (canvas not yet present at `onStart`). If the canvas did
     exist, the empty attribute won and the widget **never** fetched. Which of the
     three widgets was hit was decided purely by timing. The fallback now applies
     in both branches.
  2. The Cytoscape layout ran while the widget area in the dashboard was still
     **0 px**. `cose`/`cola` then cannot distribute and put **all** nodes at
     `{0,0}`; the subsequent `fit()` zooms onto a degenerate bounding box (zoom 4)
     — the graph is loaded but invisible. A `resize()`+`fit()` alone does not heal
     that, because the positions are already fixed. The layout now runs again
     through a `ResizeObserver` as soon as the container has a real size (the same
     solution as in the main module's `render-tech.js`); the observer is cleaned up
     in `_destroyCy()`.
- **The dark-mode button was not translatable**: `tabs.js` hard-coded
  "Light"/"Dark" although the i18n keys `toolbar.light`/`toolbar.dark` existed in
  both language files.

### Removed

- Dead code: `assets/js/modules/dom-safe.js` (never imported, not in the bundle),
  the unused export `hasSnapshot()` from `diff-mode.js` and 7 CSS rules for
  `.nt-lbl`/`.nt-node` (neither class is ever set by any JS or PHP — icons go to
  Cytoscape as data URIs).

### Added

- **`CONTRIBUTING.md`**: development setup and above all the three things CI
  enforces hard (the bundle committed alongside, the XSS gates, the ESLint
  baseline).
- **GitHub issue template** as a form — asks for module, Zabbix and PHP version,
  and for the SNMP vendor when edges are missing.

### Changed

- **The README is now bilingual** and free of demo references; the architecture,
  screenshot and licence sections are shared rather than kept twice.
- **The changelog begins at the first public release** — the development history
  before that is not part of this repository.

## v4.38.2 — 2026-07-27

Hardening round before publication (external security review + repository audit).

### Security

- **`deploy.sh`: root code execution through a predictable `/tmp` path closed**
  (high). The ZIPs were placed on the target server under fixed names
  (`/tmp/network_topology_v6.zip`). Any unprivileged user there could create the
  path in advance as a **symlink**; `scp` follows it (`O_CREAT|O_TRUNC`), which
  gives the attacker control of the file that `sudo unzip` extracts as **root**
  seconds later — without a zip-slip filter, therefore arbitrary files outside
  the module directory. The local **and** remote working directories are now
  `mktemp -d` with `umask 077`; the EXIT trap cleans up both (the remote ZIPs used
  to stay behind permanently). The SSH control socket likewise lives in the 0700
  temp directory rather than under a `/tmp` path derivable from the server name.
- **The three widget modules passed through not a single CI gate.**
  `eslint.config.mjs`, `tools/check-xss.sh` and `package.json` only knew
  `assets/js/**` — the very files that build their HTML by string concatenation
  were never checked. Both gates now cover `widget*/assets/js/**` as well
  (verified: a deliberately introduced unescaped sink turns both red, and the
  existing baseline does not suppress it).
- **Unescaped `innerHTML` sink in the topology widget**
  (`widget/assets/js/widget.class.js`, `_showMsg`): the error message was
  concatenated raw into HTML — the only break of the escaping convention across
  all three widgets, and it arose precisely in the gates' blind spot. It now
  builds the message through `textContent` and is therefore no longer an HTML
  sink by construction.
- ESLint recognises the widgets' `this._esc()` as an escaping method
  (`escape.methods` extended by `_esc`); the 8 pre-existing sinks made visible by
  that, **each reviewed on its merits**, are baselined in
  `eslint-suppressions.json` — like the ~100 in the main module.

### Changed

- **Real infrastructure references removed**: own host and network data in the
  changelog, tests and code comments replaced with generic placeholders
  (`192.0.2.x` per RFC 5737, `example.com`, `SW-CORE-01`). No functional impact —
  device-type keywords such as `truenas`/`pve` in `HostMetadata.php` are
  functional code and stay.
- **Version consistency**: `manifest.json`, `package.json`, `package-lock.json`,
  the README badge and the changelog had drifted apart by up to four releases and
  are now in sync.

### Added

- **`SECURITY.md`**: reporting channel for vulnerabilities, response time, scope
  and the documented security model.
- **README**: link row (project page, demo, repository, changelog, installation)
  and a "Feedback & contributing" section. **INSTALL**: clone URL and release ZIP
  point at the public repository.
- `.gitignore` covers `.claude/`, `*.log` and `.env`.

## v4.38.1 — 2026-07-27

### Fixed

- **i18n gap in the items pivot**: about 15 strings were hard-coded in German and
  stayed German in EN mode — the error and empty states (including the four
  explanatory lines), "everything empty", the group separator "no group", anomaly
  tooltips, "open in Latest data", the pattern label and placeholder. They all go
  through `t()` now, with new keys in `i18n/{de,en}.js`. That it was an oversight
  is shown by `— custom pattern —`: the same string already went through
  `t('items.custom_pattern')` in two places and was hard-coded in a third.

### Added

- `fmtVal` now also formats the Zabbix unit **`Bps`** (bytes/s → B/s, KB/s, MB/s,
  GB/s). Until now it fell back to raw numeric output (`bps` = bits/s was already
  covered).
- **README**: a table of which **Linux templates** the items-pivot presets need
  (`Linux by Zabbix agent` for disks/block IO/CPU/memory/network, `ICMP Ping` for
  ping) — plus the note that SNMP switches and Windows deliver different keys and
  that the custom pattern or the "discovered" list should be used there. Without a
  matching template the pivot stays empty, which until now looked like a fault.

## v4.38.0 — 2026-07-27

### Added

- **A third dashboard widget, "NT Table"** (`network_topology_v6_table_widget`):
  the table view (Nagios/Icinga-style host list) as a dashboard tile — **status**
  (severity/offline/stale), **host**, **CPU**, **mem**, **ping**, **traffic**
  (↓/↑), **open problems**. Sorted offline → severity → name; configurable: host
  groups, hide offline, only problems, max rows. It uses the same
  `network.topology.v6.data` action as the main tab (no second backend) and the
  ES5 jsLoader style (Zabbix 7.4) like the existing widgets. `deploy.sh` now ships
  three widgets (`widgets`/`all` mode).

---

*Development history prior to the first public release is not part of this
changelog.*
