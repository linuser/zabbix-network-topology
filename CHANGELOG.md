# Changelog

Changes since the first public release. Versioning: MAJOR.MINOR.PATCH.

## v5.6.0 — 2026-10-29

### Undo / redo for the layout

- **Node arrangement can now be undone and redone.** Drag a node (or several) and
  press **Ctrl/Cmd+Z** to put it back, **Ctrl/Cmd+Shift+Z** (or Ctrl+Y) to redo.
  Two toolbar buttons (↶ / ↷) do the same and grey out when there is nothing to
  undo or redo.
- **Applying a layout is undoable too:** picking a different layout records the
  current hand-made arrangement first, so one undo brings it back.
- Snapshot-based (the whole position map per step, capped at 60), robust against
  nodes that appear or vanish between steps. The history survives an in-place
  refresh and resets only on a real view change (a different set of nodes). In
  host+hops focus mode undo works on screen but is not persisted, same as every
  other position save there. New module `layout-history.js`, unit-tested.

### Security review fixes (F08–F13)

The rest of the external review, each verified against the code.

- **Shared config writes fail closed (F08).** `SharedConfig::fresh()` fell back to
  the possibly stale bootstrap copy when the API read failed, and the write then
  overwrote another super-admin's concurrent change. A failed fresh read now
  aborts; a module with no config yet (first write) is still handled.
- **Permission signature in the cache key (F09).** APCu keys already carried the
  user id (no cross-user leak); they now also carry role + user type, so a role
  or type change invalidates immediately. A host-group rights change within the
  same role still clears only after the TTL (data: 60 s) — a bounded,
  same-user window, now documented in `NtCache`.
- **Ghost-host management IP labelled as advertised (F10).** The prefilled SNMP
  interface IP is the neighbour's advertised LLDP address, shown in the detail
  panel and treated as a manually chosen value, not verified server-side. Noted
  in LLDP-SETUP.md; host creation needs the Hosts role right (see F01).
- **Plan background URLs must be HTTPS (F11).** Plain `http://` backgrounds are
  rejected, and the external image is loaded with `referrerpolicy="no-referrer"`
  so the image host does not learn the Zabbix URL.
- **Manual asset loading documented (F13).** Why the main module injects its CSS,
  guard and Cytoscape via HTML tags instead of the manifest `assets` object (the
  deploy-exact cache-buster and the assign-guard ordering around Cytoscape) is now
  written next to the tags.

F12 (reducing the 77 intentional DOM-sink suppressions) and F16 (splitting the
large render/controller files) are iterative refactors, not single fixes; F14
(direct history SQL) and F15 (the Zabbix-8 Object.assign guard) are already
documented and carry no proven bug per the review.

## v5.5.102 — 2026-10-29

### Security review fixes (F01–F07)

From an external code/security review of 5.5.97. Each verified against the code
before fixing.

- **Host creation now also checks the UI role right (F01).** `create_host` only
  checked `getUserType() >= ADMIN`; Zabbix's own host controller additionally
  requires `CRoleHelper::UI_CONFIGURATION_HOSTS`. A role can lock host
  configuration while the user stays an Admin, so the module could create hosts
  the native UI would refuse. `checkPermissions()` now enforces both, and the
  context-menu "Create host" entry hangs off a new `can_create_host` flag.
- **Sender TLS is verified by default (F02).** `tools/topo-change-sender.sh` used
  `curl -sfk` — `-k` disabled certificate verification, exposing credentials and
  the session cookie to MITM. Verification is now on; `ZBX_CACERT` points at an
  internal CA, and `ZBX_INSECURE=1` is a loud, opt-in lab-only escape hatch.
- **Sender password out of the process arguments (F03).** The password was passed
  as a `curl` argv entry, visible in `/proc`. It now goes through a 0600 temp file
  read via `--data-urlencode name@file`.
- **Sender reads the topology response from a file, not argv (F07).** The full
  graph JSON was passed to `python3` as an argument and hit `Argument list too
  long` past ~140 KB. It is now written to a 0600 file and read from there.
- **Deployment is now rollback-safe (F04).** `deploy.sh` did `rm -rf` then `mv`;
  if the `mv` failed the module (or a half-swapped set of widgets) was gone. The
  old directories are now renamed to a backup first, the new ones moved in, and
  on any failure everything is rolled back.
- **Plan image upload reports real failures (F06).** `API::Image()->create()` can
  return `false` without throwing; the upload action returned `ok: true` with an
  empty image id. It now returns an error, like the host-create path.

## v5.5.101 — 2026-10-29

### Shared host+hops layouts were silently discarded

- A super-admin's **shared node positions saved in host+hops focus mode** never
  survived the permission filter. The view key for that mode is host-scoped —
  `host<hostid>_h<hops>` (e.g. `host10084_h2`) — but `SharedLayerFilter::positions`
  split every key on `_` and required each part to be a visible **group** id.
  `host10084` and `h2` are not groups, so the whole saved layout was dropped on
  load, while group and plan views were kept.
- The filter now recognises the host+hops key and checks it against the visible
  **host** ids instead: a user who may see the host gets the shared layout, one
  who may not still does not. Group and plan keys are unchanged.
- Found by an external code/security review (reproduced); regression tests added.

## v5.5.100 — 2026-10-29

### PoE budget: an alert and a trend on the faceplate

- **Threshold alert.** The switch PoE budget on the faceplate footer used to read
  `PoE: 78 / 95 W` in the same muted colour at any load — 82 % looked like 5 %.
  It now shows the percentage and turns **amber at ≥ 80 %** and **red with a ⚠ at
  ≥ 95 %**, so a switch near its power limit is visible at a glance. Colours follow
  the theme's `--nt-warn`/`--nt-crit` tokens (light and dark).
- **Usage trend.** When the switch delivers a budget, the faceplate now draws a
  small sparkline of the PoE consumption (`nt.poe.used`) over the last six hours
  next to the figure — "is the load climbing?" before "is it at the limit?". The
  history is read through `API::History()` (the ClickHouse/Elasticsearch-safe
  path, like the spark action), down-sampled to at most 48 points. No history
  (a fresh host, or a switch without `pethMainPse*`) simply draws no line.

## v5.5.99 — 2026-10-28

### CDP: opaque hex device-ids no longer invent edges

- A CDP `cdpCacheDeviceId` can be an opaque, space-delimited hex sequence that is
  **not** a six-byte MAC — e.g. five bytes `01 02 03 04 05`. `macForm()` only
  accepts six-byte forms, so such a value fell through to `cleanNeighbor()`, which
  truncated it at the first space to `01` and then matched an unrelated host named
  `01` — a **false edge that looks like a measurement**. Worse, several such ids
  collapsed into a single phantom ghost `01` with edges to unrelated switches, the
  same failure the six-byte-MAC guard already warned about.
- `LldpEdgeBuilder` now recognises a non-MAC, space-delimited hex sequence, keeps
  the full observation and skips the name fallbacks for it. An exact match on the
  complete raw value is still possible; six-byte MACs and normal names are
  unchanged.
- Found and diagnosed in the Liberamente fork by Mauro Majeroni (mmajer, PR #7);
  verified present in this code and fixed here with our own regression tests.

## v5.5.98 — 2026-10-28

### Review fixes for the management-IP path (5.5.97)

- **Missing label:** an edge resolved via the new `mgmt_ip` match path showed the
  raw key `edge.match.mgmt_ip` in the confidence tooltip — the key was never added
  to `i18n/en.js` / `de.js`. `ci:i18n` cannot catch a key built at runtime
  (`t('edge.match.' + matchKind)`), the gotcha the project's own notes warn about.
  Added in both languages.
- **Ambiguous management IP now flagged:** when the same advertised management IP
  belongs to more than one monitored host (NAT, a shared management VLAN),
  `resolveByMgmtIp` already drew no edge — but it now records the collision as
  *ambiguous* for the LLDP-Q tab instead of silently passing the neighbour through
  as a ghost, matching the name- and IP-resolution paths.

## v5.5.97 — 2026-10-28

### LLDP: use the neighbour's advertised management IP

- **The LLDP template now collects `lldpRemManAddr` (OID table …4.2), the
  management address the neighbour advertises.** The catch: in that table the
  address is not a value — it is encoded in the OID *index*
  (`TimeMark.LocalPort.RemIndex.AddrSubtype.AddrLen.<octets>`). The new item
  prototype parses the IPv4 straight out of the index (AddrSubtype 1, AddrLen 4);
  IPv6 entries are skipped on purpose, because the module matches against
  monitored hosts' IPv4 interfaces.
- **A new last-resort match path** (`LldpEdgeBuilder::resolveByMgmtIp`): a
  neighbour whose name and chassis-MAC did not resolve, but whose advertised
  management IP belongs to exactly one monitored host, now draws an edge to that
  host (match kind `mgmt_ip`, confidence 50 — as strong as a name that *is* an
  IP). Ambiguous or self addresses are ignored, the same rule as everywhere: a
  wrong edge is worse than a missing one.
- **Ghosts carry a real address now.** An unmonitored neighbour that advertises a
  management IP shows it in the detail panel, tooltip and context menu — and
  "create host" prefills an SNMP interface on that IP (community left as the
  `{$SNMP_COMMUNITY}` macro, not a guessed value). The address is not invented;
  the device names it itself.
- **Re-import the `NT LLDP Neighbors by SNMP` template** to pick up the new walk
  column and item prototype — see docs/LLDP-SETUP.md.
- Optional TLV: measured 2026-10-28, HPE Instant On advertises it richly,
  MikroTik RouterOS not at all — absent is no error. (Second half of the
  LLDP-quality follow-up; the chassis-id subtype was 5.5.96.)

## v5.5.96 — 2026-10-28

### LLDP: type the chassis-id instead of guessing it

- **The LLDP template now collects `lldpRemChassisIdSubtype` (OID …4.1.1.4).**
  It says what *kind* of identifier the neighbour's chassis-id is — 4 = MAC
  address, 5 = network address (an IP), 7 = locally assigned (a name). Until now
  the module had to guess from the value's shape whether the chassis-id was a MAC
  it could match against a monitored host.
- **With the subtype, that guess becomes an answer:** a chassis-id whose subtype
  is not a MAC is no longer bent into a made-up MAC and mis-matched. `rowChassis`
  in `LldpEdgeBuilder` only resolves a chassis-id as a MAC when the subtype is 4
  (or absent — then it falls back to the old shape heuristic, so a device or an
  older template that does not send the column behaves exactly as before). This
  only ever *adds* reliability to the existing chassis resolution path.
- The subtype gets no separate confidence-score point — it makes the chassis
  match correct, it is not a new kind of evidence.
- **Re-import the `NT LLDP Neighbors by SNMP` template** to pick up the new walk
  column and item prototype — see docs/LLDP-SETUP.md.
- Measured 2026-10-28 on the lab: MikroTik RouterOS and HPE Instant On both fill
  the subtype. (First half of the LLDP-quality follow-up; the management-address
  path, lldpRemManAddr, is the next step.)

## v5.5.95 — 2026-10-28

### Large maps: wide hierarchy tiers wrap instead of vanishing

- **The hop and hierarchy layouts now wrap wide tiers into multiple rows.** On a
  large network the access tier holds most of the hosts — measured on a 2000-host
  load test, one tier had 768 nodes. Laid out in a single row it was ~115,000 px
  wide against ~1,700 px tall; `fit()` then clamped against `minZoom` and showed
  an empty slice, so the map looked blank although every node was there (no hang,
  no error, the main thread stayed responsive). Tiers now wrap to keep the layout
  roughly square (`placeTiersWrapped`, rows of about √N). Small tiers are
  unchanged, so ordinary maps look exactly as before.
- **`minZoom` relaxes for large graphs** (0.02 above 800 nodes, 0.1 otherwise) so
  `fit()` can zoom out far enough to frame the whole map.
- This is **not** a performance change: the backend (~0.1 s warm at 2000 hosts)
  and drawing 2000 elements were already fast. It was a layout-visibility bug at
  scale. Accepted live on the 2000-host load test: the map renders as a visible
  hierarchy pyramid in ~0.6 s where it used to come up blank.
- `ci:frontend` now asserts a wide tier wraps and the tier layout's aspect ratio
  stays bounded.

## v5.5.94 — 2026-10-28

### VLAN view: review fixes

- **The VLAN picker now works in the grouped ("Fold groups") view.** An
  aggregate node inherits the union of its members' VLANs, so the picker lists
  them and the filter dims a group only when none of its members carry the VLAN.
- `collectVlans` prefers a non-empty VLAN name: a VLAN named on one switch and
  unnamed on another now shows the name regardless of iteration order.
- Dropped the unused `vlan_access` node field from the wire and the Cytoscape
  payload (reported in review).

## v5.5.93 — 2026-10-28

### VLAN view: pick a VLAN, see where it runs

The map can now filter by 802.1Q VLAN. A VLAN picker appears in the Technical
toolbar when switches report VLAN data; choosing a VLAN dims everything not on
it, leaving the devices and links that carry it. The strongest extension on the
roadmap, and the one that needed real hardware to prove first.

- **New template `NT VLAN by SNMP`** collects the Q-BRIDGE tables in one bulk
  walk (`nt.vlan.walk`): VLAN names, static + current egress bitmasks, PVID,
  `dot1dBasePortIfIndex`, `ifName`. Add it to 802.1Q switches — a fresh import,
  not a re-import. Validated against an HPE Instant On 1830; a MikroTik CRS310
  (RouterOS) does not fill the dot1q group, so run `tools/nt-vlan-probe.sh` on a
  switch first to check.
- **`VlanParser`** decodes the egress PortList bitmask (port 1 = MSB of byte 0)
  and resolves bridge-ports to ifIndexes through `dot1dBasePortIfIndex` — the
  step a wrong read would turn into fake cabling, so it is a pure, tested class,
  validated end-to-end against the live HPE walk.
- **Backend** attaches VLAN membership to the graph: each node carries its VLANs
  (id + name), each edge the VLANs on the local port of at least one end (a
  trunk stays visible when only one side reports). `MetricExtractor` routes the
  walk, `NodeBuilder` sets the node fields, `VlanParser::annotateEdges` the edges.
- **Frontend** VLAN picker (toolbar dropdown) + filter; the choice persists per
  view and re-applies across refreshes. The picker stays hidden on instances
  without VLAN data.

VLAN names are shown to the operator on their own instance and never leave the
Zabbix server.

## v5.5.92 — 2026-10-28

### UniFi: a client's AP, named — and Wi-Fi links drawn as Wi-Fi

- **A UniFi client now names the access point it is on.** The tooltip shows
  `📶 <AP>` and the detail panel marks the uplink peer with the Wi-Fi glyph, so
  "which AP is this phone on?" is answered where you already clicked. Derived
  from the client's `uplink.id` edge (`tagWlanAp` in `build-elements.js`) — no
  new item, no template re-import.
- **Wi-Fi associations are drawn as Wi-Fi.** A UniFi `uplink.id` edge whose end
  is a client (client↔AP), or that joins two APs (AP↔AP mesh), now renders cyan
  and dotted instead of the wired weathermap colour; an AP→switch uplink stays a
  wired link. `_unifiWireless` is set in `build-elements.js` and honoured both in
  the static stylesheet and in the weathermap (`traffic.js`), which otherwise
  recolours every edge by utilisation. The device-wide uplink throughput stays
  on the edge label.
- Frontend only; `ci:frontend` gains a scenario (client→AP is Wi-Fi and carries
  `wlan_ap`, an AP→switch uplink stays wired, a non-UniFi edge is never Wi-Fi).

## v5.5.91 — 2026-10-27

### UniFi switches: per-port traffic in the faceplate

- **The faceplate now shows per-port throughput on UniFi switches.** The classic
  controller API carries a per-port rate (`rx_bytes-r`/`tx_bytes-r`) that the
  integration API lacked, so UniFi port rows used to have empty traffic. Read as
  `port.rx[N]`/`port.tx[N]` items and mapped into the faceplate's `in`/`out` (bytes/s
  → bit/s, the same ×8 convention as the SNMP octet path). Open a UniFi switch on the
  map and its ports show real rx/tx, like the SNMP switches.
- `FaceplateBuilder::collectUniFi` and the faceplate action fetch gained the two keys;
  no change for switches without the items (ports just show no traffic, as before).

## v5.5.90 — 2026-10-27

### Review fixes for the UniFi client/WLAN work

- **A UniFi client host with an explicit `nt:icon` tag is no longer hidden on the
  map.** It used to keep `is_client` (so client-focus hid it) even though the
  override won the type — contradicting "an explicit choice wins". Now the override
  wins fully: such a host keeps its icon *and* stays visible.
- **Backend clamps a negative `wlan.satisfaction`.** An idle AP's `-1` sentinel is
  dropped in the extractor too, so a plain-JSONPath item (not the documented JS)
  can't surface a red "-1 %".
- The node detail panel's WLAN section now also renders when satisfaction is the
  only WLAN datum present.
- Noted the satisfaction colour thresholds as a hand-kept duplicate between the
  panel and the widget (not `ci:parity`-guarded); removed a dead exported function
  in `client-focus.js`.

## v5.5.89 — 2026-10-27

### Docs: correct the satisfaction item setup

- `docs/UNIFI-SETUP.md` described `wlan.satisfaction` as a plain JSONPath on
  `$.satisfaction`. That fails on an idle AP: with no clients UniFi reports
  `satisfaction: -1`, which an unsigned item rejects ("not supported"), measured on
  the live site. The doc now specifies a JavaScript step that maps a missing or
  negative value to 100 (idle = nothing to complain about) and returns the score
  otherwise. No code change — the module already reads the resulting value.

## v5.5.88 — 2026-10-27

### WLAN satisfaction (the degradation signal)

- **UniFi AP satisfaction** (the controller's 0–100 experience score) is now read
  from `wlan.satisfaction` and shown in the node detail panel and as a coloured
  `Sat` column in the NT WLAN widget (green ≥ 70, orange ≥ 40, red below). This is
  the "is the Wi-Fi actually good?" number — low means degraded even while the AP
  is up.
- The module only *shows* it; the red/orange alert on the map comes from a Zabbix
  **trigger** on the item (the setup script ships two tiers, warning and high). See
  `docs/UNIFI-SETUP.md`.

## v5.5.87 — 2026-10-27

### Read UniFi CPU/memory (they were collecting but not shown)

- **UniFi devices show CPU and memory again.** Their HTTP-agent template exposes
  the plain keys `cpu.utilization` / `memory.utilization` (direct percent), which
  the metric reader did not recognise — so UniFi APs and switches read
  "not collected" in the panel and showed `—` for CPU/Mem in the NT WLAN widget,
  even though the items were updating fine (measured: AP CPU 6 %, mem 34 %). Both
  keys are now fetched and mapped like the agent/SNMP variants.

## v5.5.86 — 2026-10-26

### Map: client endpoints are hidden until you click their AP

- **UniFi client endpoints are hidden on the Technical map by default** — dozens
  of phones, IoT gadgets and laptops hanging off the controller/APs were burying
  the actual topology. Their edges hide with them, so the map shows the
  infrastructure cleanly.
- **Click an AP (or switch/gateway) to reveal the clients that hang off it** — only
  that host's clients appear, arranged in a ring around it; clicking elsewhere or
  the background hides them again. The association is real data: each client carries
  `uplink.id` = its AP's UUID, which the module already draws as an edge. No toolbar
  toggle — a plain click, as requested.
- Built on the existing graph (no re-layout): clients stay in the map, only their
  visibility is toggled (`client-focus.js`, driven by the `is_client` flag from
  5.5.85). Enabling "Collapse leaves" still bundles them as before.

## v5.5.85 — 2026-10-26

### UniFi clients are their own device class (no longer "servers"), plus Wi-Fi retries

- **UniFi client endpoints (phones, IoT, …) are now typed `client`**, not `server`.
  They hang off the "UniFi Network API - Client" template; the module detects that
  and gives them a dedicated class, icon and label. This fixes the mis-categorisation
  where ~30 client stubs showed up under "Servers" in the Management and Table views
  — they now sit in the "Devices" category / `Client` type. An explicit `nt:icon`
  tag still wins.
- **New: Wi-Fi retransmission rate per band.** The AP's existing
  `radios.txRestries[<band>]` item (integration API, in %) is now read and shown as
  `Retr` per band in the node detail panel — a ready degradation signal, no new item
  needed. (The template's key carries the upstream typo "txRestries"; we match it.)
- Node payload carries an `is_client` flag; the map click-to-focus for clients builds
  on it next.

## v5.5.84 — 2026-10-26

### WLAN: the SSIDs an AP broadcasts

- **A UniFi AP node now lists the SSIDs it broadcasts**, folded by name with the
  client count summed across bands (guest SSIDs marked). Read from the classic
  controller API's `vap_table` as a `wlan.ssids` item on the AP host (same API
  key, dependent on the `unifi.classic.device` master), pre-condensed to a compact
  JSON list so the module just displays it.
- Shown in the **node detail panel** (one row per SSID with its client count) and
  as a new **`SSIDs`** column in the **NT WLAN** widget. SSID names come from the
  network, so they go through `textContent`/escaping, and the list is capped.
- The 802.11 standard still comes from the Integration API; APs without the new
  item simply show no SSID list. See `docs/UNIFI-SETUP.md` for the item.

## v5.5.83 — 2026-10-26

### WLAN: client count and air utilization straight from the AP host

- **The AP client count now comes from the UniFi AP host itself**, read from the
  **classic controller API** (`/stat/device` → `num_sta`) as a `wlan.clients` item,
  using the same API key as the Integration template. This **replaces** the earlier
  cross-host IP-join against a second, SNMP-monitored host: the whole `WlanResolver`
  class and its controller-side lookups (`ipItemsForJoin`, `wlanClientsByIp`) are
  gone. One data path, one host, no "… WLAN SNMP" companion host required.
- **New: air (channel) utilization per band.** The classic API's
  `radio_table_stats[].cu_total` feeds a `wlan.cu[<band>]` item, folded into the
  radios map. It shows in the node detail panel (`Util` per band) and as a new
  **`Air`** column in the NT WLAN widget.
- The 802.11 standard still comes from the Integration API (`radio.*`) — the classic
  radio stats do not carry it; channel, clients and utilization come from the classic
  API. See `docs/UNIFI-SETUP.md` for the exact items (one master + three dependent).
- No change for sites that do not add the new items: APs still show their radios,
  just without the client badge and utilization.

## v5.5.82 — 2026-10-26

### New: NT WLAN dashboard widget

- **An eighth dashboard widget, "NT WLAN"** — a WLAN overview of the access points
  in the selected host groups: one row per AP with its client count, radios
  (channel · standard · width per band), CPU, memory and status. It reads the same
  nodes as the map (`network.topology.data`) and filters the wireless ones, so the
  client count and radios come from the enrichment added in 5.5.81 — no extra
  endpoint. Requires the main module.
- Wired into the build and packaging like the other widgets (shared ES5 blocks via
  `sync-widget-shared`, guarded by `ci:parity`; `deploy.sh`, eslint, the install/
  uninstall scripts).

## v5.5.81 — 2026-10-26

### Access points show their WLAN on the map

- **UniFi AP nodes now carry a client-count badge** (blue, bottom-right) and a
  **WLAN section** in the node detail panel: the radios per band (channel, width,
  standard, e.g. `5 GHz → Ch 36 · 40 MHz · 802.11ac`), read from the UniFi API
  (`radio.*`).
- **Client count is joined from a second host by IP.** UniFi's device data has no
  client count — it lives on a separate SNMP-monitored host per AP (`wlan.clients`).
  The module matches the two by IP (the UniFi AP's `ip` item == the SNMP host's
  interface IP) via the new `WlanResolver` (pure, tested, drops colliding IPs). The
  count is fetched **by AP IP, group-independently**, so the SNMP host need not be in
  the loaded group and never shows up as a duplicate node. No SNMP AP host → radios
  still show, no client count. See `docs/UNIFI-SETUP.md`.
- Internally: `MetricExtractor` emits per-host `radios`; `NodeBuilder` puts `radios`
  on the node; the controller does the IP join after building nodes — a small
  exact-filter fetch of the `ip` item for AP nodes, then `hostinterface.get` +
  `item.get` for `wlan.clients` by those IPs.

## v5.5.80 — 2026-10-26

### UniFi uplink throughput on the edge

- **The UniFi uplink edge now shows its throughput.** The topology edge built from
  `uplink.id` carries no port (the controller API names only the parent device), so
  it had no traffic. It now shows the device's own uplink throughput
  (`uplink.rx`/`uplink.tx`, already bit/s) as the edge's traffic — honestly
  device-level, not per-port. There is no uplink capacity in the API, so the
  weathermap does not colour this edge by utilisation; it shows the rate only.
- Internally: `MetricExtractor` emits a per-host `uplink_rate`, and
  `LldpEdgeBuilder` attaches it to the `unifi` edge when the port path found no
  per-port metric (a real port metric still wins). No change for SNMP edges.

## v5.5.79 — 2026-10-26

### New: UniFi devices show their ports

- **UniFi switches, APs and the gateway now draw with their ports.** UniFi gear
  is monitored through the UniFi controller API (HTTP), not SNMP, so its data
  arrives under a different set of item keys (`port.state[N]`, `port.speed[N]`,
  `port.poe.*[N]`, `uplink.id`). The module now reads those: the faceplate (inline
  and the NT Faceplate widget) shows each port's state, speed, connector and PoE,
  and down ports count toward device health — the same picture the SNMP switches
  already got. Detection is by item presence, so no configuration is needed.
- **The uplink topology was already drawn** from `uplink.id`; it now carries a
  **UniFi** badge in the edge panel so it is no longer an anonymous link.
- **No per-port traffic, by measurement.** The UniFi Network Integration API
  exposes per-port state/speed/PoE but **no per-port byte counter** — only
  device-level throughput. UniFi port rows therefore show no traffic bars; that is
  honest, not a gap in the module. See `docs/UNIFI-SETUP.md`.
- STP, FDB and exact LLDP remote-port features remain SNMP-only (not in the UniFi
  API) and are unaffected for the rest of your switches.

## v5.5.78 — 2026-10-26

### Internal: Link quality score tidy-up (no behaviour change)

- Refactor only — the score, colours, labels and every user-visible string are
  unchanged. The four penalty terms in `link-quality.js` (errors, drops,
  utilisation, flap) now share one `ramp(weight, frac)` helper instead of each
  spelling out `Math.min(weight, frac * weight)`, so the bands stay uniform.
- De-nested two triple-ternaries into if/else chains (per the house style): the
  per-band edge width in `traffic.js` and the legend title selection in
  `legend.js`. Same thresholds, same keys, same outcome.

## v5.5.77 — 2026-10-25

### Security: Plan background reference endpoint

- **`op=ref` and `op=positions` now filter by group visibility.** Both endpoints
  served the shared plan reference (image id / URL) and the shared node positions
  for any `view` key a signed-in user could guess, regardless of whether they may
  see the groups it names. A user could therefore enumerate view keys and learn
  the background image id or URL a super-admin set for another group's plan — an
  information leak. Both now require every group (or the single host) named by the
  view to be visible through the permission-checked API, mirroring
  `SharedLayerFilter` on the main page.
- **Hardened the plan background URL filter.** `PlanBackground::sanitize()` now
  rejects URLs containing control characters, whitespace or characters dangerous
  in markup/CSS (`" ' < > ( ) \` \\`), on top of the existing http(s)/length
  check — the same shape as the `nt:link` tag parser. Legitimate URLs encode such
  characters anyway; this closes a path a future HTML/CSS-interpolating renderer
  could otherwise make injectable.

## v5.5.76 — 2026-10-24

### New: Link quality score

- **A 0–100 quality score per cable**, from errors, drops, utilisation, down-state
  and recent flaps — so you see which link *runs badly*, not just which is *full*.
  Coloured on the same bands as the host health score (green/amber/orange/red).
- **Toggle "Link quality"** in the toolbar colours the edges by score instead of
  utilisation (mutually exclusive with the weathermap; its own colour guide). The
  edge detail panel shows the score and the biggest contributors (e.g. "errors ·
  high utilization · recent flap").
- **Flaps use a proxy, honestly labelled:** the link's uptime (seconds since the
  last state change) — a recently-bounced link has low uptime and loses points.
  No new data collection; a real per-interface flap counter stays a follow-up.
- Four of the five inputs were already measured per-link (errors, drops, speed,
  utilisation); the score lives in one place (`link-quality.js`) — no widget copy
  yet, so `ci:parity` is not extended (a future widget copy must).

## v5.5.75 — 2026-10-24

### Plan view: markers stay on the image

- **Device markers can no longer land off the background image.** Placing,
  dragging past an edge, and loading older positions from a differently-sized
  image are all clamped to the image bounds — a dragged marker snaps back inside,
  and stale off-image positions are corrected and written back once on load. This
  also removes the stray connection line that ran off into the margin.

## v5.5.74 — 2026-10-24

### Plan view: connection lines are now a toggle

- **The LLDP/CDP connection lines on the Plan view can be switched off.** A new
  *Links* toggle in the Plan toolbar shows or hides the green dashed links between
  placed devices; the choice is remembered per browser. It defaults to **off** —
  a floor plan usually wants just the devices and their status, and you turn the
  links on when you want to see which device uplinks where. (Geo is unchanged.)

## v5.5.73 — 2026-10-24

### Plan view: smaller markers, tighter fit

- **Markers on the Plan view are smaller.** On a floor plan the geo-style markers
  — which grow with the open-problem count up to ~50px — crowded the rooms; they
  now render at 60% scale in Plan mode (the Geo map is unchanged). A busy device
  stays legible (its count still shows) without covering a whole room.
- **The plan image fills the pane.** The Plan map now fits the background with a
  fractional zoom instead of snapping to a coarse power-of-two level, so the floor
  plan uses the available space instead of sitting small with a wide margin.

## v5.5.72 — 2026-10-24

### NT Plan widget — review fixes (incl. a permission fix)

- **The plan positions endpoint now filters by host permission.** `op=positions`
  returned the shared plan's full host→pixel map to any logged-in user; it now
  returns only placements for hosts the requesting user may see (ghost
  neighbours excepted, as on the main map), closing an information disclosure of
  host ids/coordinates.
- **The NT Plan tile no longer flashes on every refresh.** The background image
  is rebuilt only when its source actually changes; otherwise just the markers
  are re-placed, so the plan stays steady through Zabbix's refresh cycle.
- **Markers land correctly even if the tile lays out at zero width** (the scale
  is recomputed once the image box has a real size), and the empty-state message
  now follows the dashboard's light/dark theme.

## v5.5.71 — 2026-10-23

### New dashboard widget: NT Plan

- **A new "NT Plan" dashboard widget** renders the Plan view as a read-only tile:
  the background image (floor plan / aerial) with every placed device at its real
  spot, coloured by severity/status, labels optional. Configure it with the same
  **host groups** you used to set up the plan in the module's Plan tab — the
  widget shows that selection's shared background and placement. Hover a marker
  for host, status and open-problem count.
- **Lightweight by design:** no Leaflet in the tile. The background is an
  `<img>` served by Zabbix's `imgstore.php`; markers are positioned from the
  shared plan coordinates and scaled to the tile, re-laid-out on resize. Node
  severity comes through the shared `NtWidgetData` path (so several NT widgets on
  one dashboard still issue a single data request).
- **Backend:** the plan action gains a read-only `op=positions` that returns the
  shared marker positions for a view, so a dashboard tile (which has no
  `NT_CONFIG`) can obtain them. The widget is a separate module
  (`network_topology_plan_widget` 1.0.0) and requires the main module.

## v5.5.70 — 2026-10-23

### Fix: Plan background image now loads

- The Plan view now serves a chosen Zabbix background image through Zabbix's own
  image server (`imgstore.php?iconid=…`) — the same path the built-in network
  maps use — instead of round-tripping the bytes as a base64 data URI. The old
  path could leave the map showing *"The background image could not be loaded"*;
  serving it natively fixes that and drops the data-URI/MIME-sniffing code and the
  extra endpoint op. URL-referenced backgrounds are unchanged.

## v5.5.69 — 2026-10-23

### New "Plan" view — place devices on an aerial or floor plan

- **A background image behind the map, with devices dragged onto their real
  spot.** A new **Plan** tab (next to Geo) draws a static image — an aerial
  photo, a site plan, a floor plan — and lets you place markers on it in image
  pixels, carrying the live Zabbix status. The Wi-Fi-planning view (UniFi/Ekahau
  style), and unlike Geo it works indoors. Unplaced devices wait in a side list;
  click to drop one onto the image, then drag it into place. Edges are drawn
  between placed markers.
- **The image lives in Zabbix's own image store.** Pick an existing *Background*
  image (*Administration → General → Images*), upload a new one straight from the
  tab (Super admins only — Zabbix's own limit, format and 1 MB cap enforced by
  Zabbix, the browser downscales first), or reference an image **URL**. The module
  stores only a tiny reference (an image id or URL) per view, fetched lazily when
  the tab opens — never the image bytes, never in the page bootstrap. No Google
  Earth/Maps tiles (license-locked); bring your own licensed image.
- **Positions persist the familiar two-level way.** A Super admin writes the
  shared plan everyone sees; everyone else saves their own placement on top, per
  host-group selection — the same model as the graph layout, under its own key so
  the two never collide. See [docs/PLAN-SETUP.md](docs/PLAN-SETUP.md). The marker,
  popup and edge drawing are now shared with the Geo view (one source).

## v5.5.68 — 2026-10-23

### Internal cleanup (no behaviour change)

- The faceplate builder now reads all PoE data — per-port delivering state and
  class, and the switch budget — in a single pass over the item list instead of
  four, with one shared choice of PSE group. Output is byte-for-byte the same
  (the existing faceplate tests pin it).
- Dropped a dead sub-condition in the PoE budget footer check (the budget is
  always either absent or fully populated), in both the faceplate module and the
  NT Faceplate widget.

## v5.5.67 — 2026-10-23

### Two faceplate/geo robustness fixes

- **PoE class and delivering-state always come from the same stack member.** On
  a stacked switch where the class column and the detection column cover
  different PSE groups, the per-port tooltip could pair a class from one member
  with a power state from another. Both now read one chosen group (the smallest
  with any PoE data); if that group lacks the detection column, the port shows
  just its class with no power claim, rather than borrowing one from another
  member.
- **Switching to a shallower basemap no longer leaves blank tiles.** Changing the
  geo provider now clamps the map zoom to the new provider's maximum, so going
  from a deep-zoom layer (Esri/OSM, z19) to a shallower one (USGS Imagery, z16)
  while zoomed in pulls the view back to a level that still has tiles, instead of
  showing a blank grey map.

## v5.5.66 — 2026-10-22

### Fixes and a worldwide aerial basemap

- **A worldwide satellite basemap for the geo map.** The Geomap view gains an
  **"Esri World Imagery"** provider — the aerial layer USGS Imagery does not give
  outside the United States. Put it behind your nodes to see sites on real
  terrain; access points and other hosts with coordinates sit on the image. It
  works without an API key (attribution is carried automatically); heavy or
  commercial use should move to an ArcGIS token endpoint. (Groundwork for placing
  devices on an aerial — see the roadmap's *"Aerial background and placing APs on
  the image"*.)
- **PoE tooltip no longer claims "not delivering" for an unknown port.** A port
  that reports a PoE class but has no detection item now shows just
  *"PoE: Class N"* — not *"… , not delivering"*. The old text asserted a power
  state that was never measured, against the project's rule to never label what
  is not known. (faceplate and NT Faceplate widget.)
- **PoE class and budget survive on large switches.** The per-port class and the
  switch budget items are now re-fetched the way STP items already were, so on a
  core switch with thousands of items they no longer silently drop out of the
  capped item query and vanish from the faceplate.

## v5.5.65 — 2026-10-22

### PoE class per port and switch power budget on the faceplate

- **The switch faceplate now shows the PoE class of each port.** Hovering a port
  that negotiated Power-over-Ethernet adds a line to its tooltip —
  *"PoE: Class 4, delivering power"* (or *"… , not delivering"* for a port that
  agreed a class but draws nothing). The delivering lightning bolt is unchanged;
  this adds the class next to it. Watts-per-port stay out — those are vendor MIBs,
  not the standard.
- **A switch's total PoE budget appears in the faceplate footer** —
  *"PoE: 37 / 195 W"* (used / nominal), when the device fills the standard
  `pethMainPse*` counters. Not every switch does; when they are empty the module
  simply draws no budget line.
- **One template drives it: "NT PoE by SNMP"** (`templates/nt_poe_snmp.yaml`,
  import and link to your managed PoE switches). All items are standard SNMP over
  the POWER-ETHERNET-MIB (RFC 3621) — no external collector. A bulk walk feeds a
  discovery that creates the per-port class/detection items automatically; two
  scalar items read the switch budget. Opt-in and additive: without the template
  the faceplate still shows whatever PoE detection it already had. See
  [docs/POE-SETUP.md](docs/POE-SETUP.md). Verified end-to-end on a live Zabbix 8.0
  instance against an HPE 1830 (per-port class; that model leaves the budget empty).

## v5.5.64 — 2026-10-22

### Layout import is back — and it merges instead of replacing

- **The ⬆ import button returns next to ⬇ export** (Tools menu). A layout file —
  positions, pins, notes, manual links — can again be carried from one browser,
  device, or Zabbix install to another. The import was pulled earlier because the
  old apply path was written for complete states from the live map, while a file
  is an arbitrary partial state: a missing section deleted the existing data, and
  a super-admin importing a file without links wiped **every** user's manual links.
- **It now merges, never replaces.** Positions overlay per node, links union
  (deduplicated), pins union, notes overlay — a partial file can no longer delete
  anything. The import writes the user's own layer (a super-admin publishes to the
  shared map after a confirmation naming the scope; everyone else stays personal).
  The file is validated before anything is written. In cluster mode (two or more
  host groups) the adaptive layout still owns positions; the import is stored and
  shows once cluster mode is off, as the existing notice explains.

## v5.5.63 — 2026-10-22

### SLA relevance on the map

- **A new KPI chip answers "does this problem cost anything", not "how bad".** A
  host is *SLA-relevant* when one of its active problems feeds a Zabbix **Service**
  (and thus an SLA commitment). The magenta `SLA-relevant` chip sits next to the
  problem chips with a count; a muted `0 · all services met` stays visible as its
  own statement. Clicking it filters the map to the SLA-relevant hosts (its own
  axis, like offline-only). The host detail panel gains a badge naming the affected
  service and its SLO. No new signal on the node itself — colour is already
  overloaded there.
- **How it is computed — a join, not a rebuild.** `service.get` with
  `selectProblemEvents` gives the events each service is in problem over; the map
  already knows which host each event belongs to, so the whole thing is an
  event-id join (`topology/SlaResolver.php`, pure and tested). `sla.get` adds the
  SLO target via the SLA's service tags. Nothing to configure: with no Services
  the chip simply reads `0`. Verified end-to-end on a live Zabbix 8.0 instance.

## v5.5.62 — 2026-10-21

### Faster first paint

- **The post-layout step no longer waits 800 ms.** A built-in timer delayed the
  traffic heatmap, port labels and ring highlights by 800 ms after the layout had
  already settled; it is now 250 ms, so the finished map appears ~550 ms sooner.
  Measured with the render instrumentation (5.5.60): the whole technical render is
  ~1.4 s for ~18 nodes, and the backend data build stays well under a second — the
  "slow load" some installs report is Zabbix' own page bootstrap, not this module.

## v5.5.61 — 2026-10-21

### Management tab reads as a plain overview

- **The Management tab is now aimed at non-technical viewers — "what devices do we
  have, and are they up".** Every card carries the device-type icon (the same
  glyphs as the map), the status is plain language — **Running / Warning /
  Critical / Off** instead of the Zabbix severities (OK/Info/Warning/Average/High/
  Disaster) — and the categories fold to five readable groups: **Network**
  (firewall, router, switch, wireless together), **Servers**, **Storage**, **Smart
  home & sensors**, **Devices**. The header is a short "N devices · X running · Y
  warning · Z critical" line; the technical KPI row (edges, ghosts, expected,
  STP-blocked) is hidden here and returns on the Technical tab. Technical and Table
  keep the full severity vocabulary and the colour guide for admins — two
  audiences, two vocabularies.

## v5.5.60 — 2026-10-21

### Render timing instrumentation (debug)

- **Opt-in render timing** for chasing "the map is slow" reports: enable with
  `localStorage.setItem('nt_perf','1')` (or `?ntperf=1`), reload, and the console
  prints an `[NT-PERF]` timeline across the render phases (elements, Cytoscape
  init, layout, overlays). Silent by default — no console output in normal use.

## v5.5.59 — 2026-10-21

### Self-loop drawn as a loop

- **Both ends of a self-loop are now shown as one loop on the faceplate.** The
  blocked end carries a filled badge with a slash, the forwarding end a ring, and
  a dashed arc with a ⚠ connects the two — so it reads at a glance as *one cable
  looped on this switch*. The colour is **amber**: a self-loop caught by STP is
  contained but wants action (pull the cable), not an outage — so it is not red.
  Red stays reserved for an *active* loop (broadcast storm, MAC flap, STP churn).
  A plain STP-blocked redundancy link to **another** switch keeps its neutral cyan
  badge — that is healthy design, not something to fix.
- Review fixes from the same work: the blocked badge now keys off the resolved
  loop (not the per-port item, which can lag behind the walk), and the STP items
  are fetched so they cannot fall out of a large switch's item limit.

## v5.5.58 — 2026-10-21

### Down ports are not STP-blocked loops

- **A down port is no longer marked as STP-blocked.** RouterOS (and others) report
  `dot1dStpPortState = discarding(2)` for a port that is simply down; the faceplate
  and the map `STP blocked` count now treat a port as blocked only when its link is
  actually up. Previously every dead socket on such a switch wore the badge.

## v5.5.57 — 2026-10-21

### Self-loop: which port is the other end

- **The faceplate now finds the forwarding partner of a blocked self-loop.** RSTP
  blocks only one port of a cable looped on the switch itself; the other end keeps
  forwarding and looked like any healthy up-port. The blocked port's designated
  bridge/port (BRIDGE-MIB) names the partner when the designated bridge is the
  switch's own — decoded by `topology/StpLoopResolver.php` (pure, unit-tested
  against a real HPE 1830: loop 21↔23, port 23 blocked → partner 21). **The
  "NT Spanning-Tree by SNMP" template gained three OIDs in its walk** (designated
  bridge/port + the base bridge address) and a short history; **re-import the
  template to pick them up** — see docs/STP-SETUP.md.

## v5.5.56 — 2026-10-21

### Clearer STP marker

- The STP-blocked port marker became a filled disc (it was a thin outline that
  washed out on a green port).

## v5.5.55 — 2026-10-21

### Fixes

- **The Expected (soll/ist) deviation pill stayed empty even when there were
  deviations.** The backend sent `expected_links`, but the frontend rebuilt its
  per-tab data cache without that field, so the KPI pill read nothing. Fixed.
- The STP-blocked marker moved from red to cyan (STP blocking is the healthy case,
  not an alarm) — later refined to amber for a self-loop (5.5.59). `nt-stp-probe.sh`
  now also walks the designated-bridge/port OIDs, to confirm a switch can resolve
  the loop partner before the feature relies on it.

## v5.5.54 — 2026-10-21

### Faceplate marks the STP-blocked port

- **The front panel (and the NT Faceplate widget) now marks a Spanning-Tree-
  blocked port with a red ⊘.** Hover shows "STP: blocking (loop broken here)".
  This is where a self-loop finally becomes visible on a per-port level: a cable
  from a switch back into itself gets one of its ports blocked by RSTP — you now
  see exactly which port. The faceplate reads the per-port STP state
  (`nt.if.stp[...]`, from the "NT Spanning-Tree by SNMP" template); without it
  the marker simply never appears.

## v5.5.53 — 2026-10-21

### STP-blocked port is now visible

- **A host with an STP-blocked port now shows it** — a cyan `STP blocked` KPI
  pill (count of such hosts) and an `STP blocking` badge in the host detail
  panel. The per-port STP state was already read (it classifies rings as safe);
  this surfaces it on its own. It makes the one case that was invisible
  show up: a self-loop (a cable from a switch back into itself) that RSTP
  blocks — it forms no edge and no host-ring, so nothing drew it before, even
  though the switch had quietly blocked a port. Neutral colour: a blocked port
  is usually healthy redundancy, sometimes a caught loop.

## v5.5.52 — 2026-10-21

### Expected vs measured cabling (soll/ist)

- **A new `nt:expect` host tag declares the expected neighbour and the map holds
  it against the measured LLDP/CDP topology.** `nt:expect=<host>` (optionally
  `nt:expect=<host>/<port>`, several allowed) says "this host should hang off
  that neighbour". Unlike `nt:uplink`, it draws nothing by itself — it verifies.
  The new **◇ Expected** toolbar toggle draws every expected link that LLDP/CDP
  does **not** confirm as a red dashed edge: *misconnected* (the host is measured
  on something else) or *not seen* (it reports no neighbour at all). Matches stay
  quiet; the deviation count also shows as a KPI pill. For catching re-plugged
  cables, accidentally disconnected links and third-party work.
- Deliberately conservative and host-level: the port from the tag is shown but
  not used for matching (the common fault is "plugged into the wrong switch").
  The comparison is pure and unit-tested (`topology/ExpectedLinks.php`).

## v5.5.51 — 2026-10-20

### LLDP-Q tab — health summary line

- **The LLDP/CDP Quality tab now opens with a one-line health summary**: total
  neighbours, how many are confirmed (reported by both ends) versus one-sided,
  how many are in conflict (ambiguous), and what share of the switches/routers
  report LLDP at all (`87% of switches report LLDP`). All of it is computed from
  data already on the page — `confirmed` on each edge, `ambiguous` from the
  per-host quality, coverage from node type and the reporter set — so it is pure
  presentation, no new query.

## v5.5.50 — 2026-10-20

### Compliance — firmware/model drift

- **The Compliance tab now flags a device whose firmware differs from the
  majority of the same model** ("7× Aruba 2930F, one on a different firmware") —
  an eighth check next to the existing seven. It is not a rule anyone maintains
  but a deviation from the majority: hosts are grouped by inventory `model`, the
  most common `software_full` (or `software`) is taken as expected, and the
  minority is flagged; hovering the cell shows what it runs versus the majority.
  Deliberately conservative — a model with fewer than three devices, or no clear
  majority (a tie), yields no finding, and versions are compared for equality,
  not "newer than". Needs the `model` and `software`/`software_full` inventory
  fields, which the official network-device templates fill. Admin-only, like the
  rest of the tab.

## v5.5.49 — 2026-10-20

### Topology widget — nicer nodes

- **The Topology dashboard widget now draws a coloured, type-specific icon per
  device** (switch, router, server, firewall, access point, storage, camera)
  instead of one generic grey glyph for everything — the same shape vocabulary
  the main map already uses, ported to the widget's ES5 drawing code. The
  severity ring around each node is unchanged (ring colour still means status).
  Unknown or finer types fall back to the server icon, as on the main map.
  (Widget `network_topology_widget` 3.3.0.)

## v5.5.48 — 2026-10-20

### Removed

- **The Dependencies tab (service-dependency map) has been removed.** The
  read-only tab that drew Zabbix Services as a directed dependency tree (with
  SLA% and web response time), and the in-progress editing action behind it, are
  gone — along with their backend (`ServiceTree`, the `network.topology.services`
  and `network.topology.service_edit` actions), the `render-services.js` module
  and all their strings. The physical topology, all other tabs and the
  `nt:parent` host hierarchy are unaffected. After updating, run *Administration
  → General → Modules → Scan directory* so Zabbix drops the two removed actions.

## v5.5.47 — 2026-10-20

### Security

- **The MAC-flap sender now writes its state snapshots privately.** The per-host
  snapshots under `STATE_DIR` hold the switch FDB — i.e. device MAC addresses —
  and were created with the login's default umask, which on a shared box (a proxy
  often also carries `ansible`/`zabbix` accounts) can leave them group- or
  world-readable. The sender now sets `umask 077` before writing and forces the
  state directory to `700`, so the MAC data stays readable only by the user
  running the cron.

## v5.5.46 — 2026-10-20

### Fixes

- **MAC-flap count no longer double-counts on switches that populate both FDB
  tables.** The sender keyed its move detection on the full OID, but a switch
  usually carries the same MAC in *both* `dot1d` and `dot1q` (and per-VLAN in
  `dot1q`), so a single MAC changing port was counted twice (or more). That made
  the reported `nt.mac.flap` count roughly double the real number of moved MACs
  and effectively halved the `>2` threshold — a false-positive risk on normal
  roaming. The sender now keys on the **MAC** (the last six OID octets), which
  collapses the `dot1d`/`dot1q`/VLAN duplicates so one move counts once.

## v5.5.45 — 2026-10-19

### Fixes

- **The MAC-flap sender now works behind a Zabbix proxy.** It used to always push
  with `zabbix_sender -c /etc/zabbix/zabbix_agentd.conf`, but a proxy host has no
  such agent config — so every push failed silently (swallowed by the per-host
  `|| true`) and `nt.mac.flap` stayed empty forever. And `-c` with the *proxy's*
  config would be wrong anyway: it points at the main server, which rejects a
  trapper value for a proxy-monitored host. New env vars `ZBX_SENDER_HOST` /
  `ZBX_SENDER_PORT` (default port 10051) send straight to a trapper endpoint with
  `-z/-p` — behind a proxy set `ZBX_SENDER_HOST=127.0.0.1` to push to the local
  proxy. The send target is now validated once up front: a missing target aborts
  loudly instead of being swallowed per host.

## v5.5.44 — 2026-10-19

### Fixes

- **The MAC-flap sender (`tools/nt-mac-flap-sender.sh`) now accepts host-group
  *names* in `GROUPIDS`, not just numeric IDs.** `item.get` requires numeric group
  ids, so a plain group name (e.g. `GROUPIDS=FOX`) produced a cryptic *"Database
  error occurred"*. The sender now resolves any non-numeric entry to its id via
  `hostgroup.get` after login (numeric ids still pass straight through, and the two
  may be mixed). An unknown name aborts with a clear *"Hostgruppe(n) nicht
  gefunden"* message instead of the database error.

## v5.5.43 — 2026-10-19

### Fixes

- **The *NT Spanning-Tree by SNMP* template imports again.** The new `nt.mac.flap`
  trapper item (added in 5.5.42) used the YAML item type `TRAPPER`, which Zabbix
  rejects on import — the correct export constant is `TRAP`. Re-import the template.

## v5.5.42 — 2026-10-19

### MAC-flapping detection (loop symptom)

- **The same MAC moving back and forth across ports is caught.** That is the
  classic symptom of a switching loop — but it is *temporal* (a MAC moving over
  time), which neither the stateless frontend nor SNMP preprocessing can compute.
  A new cron sender, `tools/nt-mac-flap-sender.sh`, reads each switch's FDB item
  (`nt.fdb.dot1d`, which Zabbix already collects — works behind a proxy), diffs
  it against its last snapshot, counts the MACs that changed port, and pushes the
  number to a new trapper item `nt.mac.flap` with `zabbix_sender`. Run it as a
  cron (1–5 min).
- Shown as a **"MAC flapping" KPI pill**, a red badge with the count in the host
  detail panel, and a ring whose host is flapping turns red (**"flap"**). The ring
  severity order is now storm > flap > open > churn > safe > unknown.
- Needs the opt-in FDB items (see FDB-SETUP.md) on the switches, the updated
  *NT Spanning-Tree by SNMP* template (the new trapper item), and the cron sender.
  Completes the loop-symptom set (3a topology-churn, 3b broadcast storm, 3c MAC
  flapping).

## v5.5.41 — 2026-10-19

### Broadcast-storm detection (active loop)

- **A switching loop that is actively flooding is caught.** A loop circulates
  and multiplies broadcast frames, driving the looped ports to a packet rate far
  above anything normal (ARP/DHCP sit at a few per second). The Spanning-Tree
  template now collects `ifHCInBroadcastPkts` per port as a rate; the module takes
  each host's busiest port and flags a **broadcast storm** above ~200 packets/s.
- Shown as a **"Broadcast storm" KPI pill**, a red badge with the rate in the host
  detail panel, and — with Rings on — a ring whose host is storming turns the
  strongest red (**"storm"**, ranked above every other ring state, because the
  loop is live now). This catches the case neither the ring view nor the STP-churn
  warning can see: a loop with no LLDP cycle and no flapping STP (e.g. STP off).
- Needs the updated *NT Spanning-Tree by SNMP* template (a new walk + discovery);
  re-import it.

## v5.5.40 — 2026-10-19

### STP instability as a loop early warning

- **A spanning tree that keeps reconverging is flagged.** The Spanning-Tree
  template now collects `dot1dStpTopChanges` as a rate (changes per second); a
  host whose rate stays above ~0.1/s is marked **STP unstable** — the classic
  symptom of a loop STP is fighting (a flapping link, a cable looped on a switch,
  an unmanaged device bridging two ports). This catches the dangerous case the
  ring view cannot: a loop that forms no LLDP cycle of monitored hosts.
- Shown as a **"STP unstable" KPI pill** (independent of the Rings toggle), a
  badge with the rate in the host detail panel, and — with Rings on — a ring
  whose host is flapping turns **amber** ("churn"), ranked above safe but below a
  no-block loop risk. Needs the updated *NT Spanning-Tree by SNMP* template
  (one new item); re-import it.

### Fixes

- **The "safe" ring halo now actually shows.** A classified-safe ring (STP blocks
  somewhere) was tagged with a CSS class that had no style, so its cyan halo —
  and the ring row in the edge panel — never rendered. Red loop-risk and grey
  unknown were unaffected.

## v5.5.39 — 2026-10-18

### Ring / loop detection

- **Redundant rings are highlighted, and a real loop is told apart from safe
  redundancy.** A new toggle "◯ Rings" marks cycles in the LLDP/CDP cable graph
  (circuit rank for the count, bridge-finding for the edges; parallel cables /
  LAG are collapsed to one logical link and do not count as a ring). A ring is
  usually *intended* redundancy, so it is drawn with a neutral underlay halo, not
  as an alarm.
- **Safe vs. dangerous comes from STP.** Using the per-port state collected since
  5.5.36, a ring is marked **safe** (cyan) when STP blocks somewhere in it, a
  **loop risk** (red) when STP data is present but nothing blocks, and neutral
  grey when there is no STP data. The "safe" test looks at whether any *host* in
  the ring blocks any port at all — not just the visible edges — because STP
  often blocks a redundant link that carries no LLDP neighbour and is therefore
  not drawn as an edge (found on real hardware, a MikroTik CRS310). KPI pills show
  "Rings" and, only when warranted, "Loop risk".
- Frontend graph work plus one backend field (`stp_block` per host); needs no
  template change beyond the existing LLDP + Spanning-Tree templates.

## v5.5.38 — 2026-10-18

### CDP-only neighbours resolve to the host, not a ghost

- **A neighbour named only by its MAC now resolves to the owning host.** Cisco
  CDP reports a peer by `cdpCacheDeviceId` — a MAC, not a sys-name — and on Cisco
  the LLDP local sys-name is often empty. Until now such a peer, when no other
  switch had reported that MAC together with a name, was drawn as a ghost. Each
  host now collects its own identity MAC (`nt.self.chassis` = lldpLocChassisId,
  `nt.self.basemac` = dot1dBaseBridgeAddress) and `LldpEdgeBuilder` seeds the
  chassis resolver with it, so the MAC maps straight to the host. Shared MACs
  (stacks / HA pairs) stay unresolved rather than guessed.
- **Works on the main map and in the Host + N hops graph** (both edge-build
  paths). Verified live on two Cisco SB switches: the previously unresolved
  CDP-only ghost became a confirmed edge.
- Requires the updated *NT LLDP Neighbors by SNMP* template (two new items);
  re-import it to pick up `nt.self.chassis` / `nt.self.basemac`.

## v5.5.37 — 2026-10-16

### Code-review follow-ups (Spanning-Tree)

- **STP state is read at the FAR end of an edge too.** When only the neighbour
  reported the blocking port, the edge carried no STP state and was drawn as
  active; LldpEdgeBuilder now fills port_metrics[neighbour].stp as well.
- **A collapsed LAG trunk picks up a blocked member.** trunkData aggregates
  _isStpBlocked across members, so a blocked redundancy in a folded bundle is no
  longer hidden until it is expanded.
- **A not-yet-polled STP item no longer reads as "state 0".** An empty lastvalue
  is skipped (only states 1-6 stored) instead of (int)'' = 0 showing a bogus pill.
- **MetricExtractor's STP branch gets a strpos pre-filter** like the other
  hot-loop item branches, so the regex no longer runs on every item.
- **The map edge labels are localised** ("⊘ STP blocked" and the pre-existing
  "⚠ No Connection"), de/en.

Tests added for the far-end state and the empty-value guard.

## v5.5.36 — 2026-10-16

### Spanning-Tree awareness -- the map now marks the blocked link

The render half of 5.5.35: an edge whose local port is STP-blocking is drawn as a
dimmed, dashed slate line labelled "⊘ STP blocked" instead of a normal active
link -- so a redundancy link parked by Spanning-Tree is told apart from the active
path at a glance. The edge detail panel shows the STP state per end (forwarding
green, blocking red). Only where the "NT Spanning-Tree by SNMP" template feeds
nt.if.stp; a real port failure (red) still outranks a blocked link in the colour.

## v5.5.35 — 2026-10-16

### Spanning-Tree awareness -- data collection + backend (render to follow)

Groundwork for telling an STP-BLOCKED redundancy link from an active one on the
map. A new template **"NT Spanning-Tree by SNMP"** collects `dot1dStpPortState`
(BRIDGE-MIB) per port, keyed by ifIndex via `dot1dBasePortIfIndex`, as
`nt.if.stp[<ifIndex>]`. The data action now reads those items and attaches the
per-port STP state to each edge's local end (`edge.port_metrics[host].stp`), so a
blocking(2) port is known right where the edge is built. The map does not dim the
blocked edge yet -- that is the next step; this is the pipeline it hangs off.
Covered by tests in MetricExtractor and LldpEdgeBuilder.

Measured first on three lab switches (see ROADMAP): MikroTik CRS310 reports
forwarding+blocking live, HPE 1830 forwarding, TP-Link all "other". Link the
template to STP switches that expose the BRIDGE-MIB; no change for anyone else.

## v5.5.34 — 2026-10-16

### NT Faceplate in the host detail panel

Selecting a switch on the technical map now shows its front panel inline in the
detail panel -- the same layout as the dashboard widget (RJ45 blocks + SFP cages,
coloured by link state, PoE bolt, severity outline for a port with an open
problem), fetched on demand from the `network.topology.faceplate` action. Hover a
port for its name/status/speed, click it to open the item graph. Only for
switch-type hosts; nothing changes for other devices. A new ES-module renderer
`faceplate-svg.js` ports the widget's drawing into the map bundle, because the
map page loads only the main bundle, not the ES5 widget files.

## v5.5.33 — 2026-10-16

### Code-review follow-ups (NT Faceplate + SNMP probe scripts)

- **Faceplate: keep real management/stacking ports.** The 5.5.32 fix that ignores
  a VLAN interface mislabelled as `ethernetCsmacd(6)` was too broad — it ran the
  full virtual-name filter on *every* interface, so a genuine OOB/management or
  stacking RJ45 port (ethernet ifType, name like `mgmt0` / `Stack1`) would have
  been hidden. The always-on check now matches only unambiguously virtual names
  (VLAN / loopback / LAG / tunnel / …); `mgmt` / `oob` / `stack` are kept when the
  switch reports a physical ifType. Covered by a regression test.
- **`tools/nt-stp-probe.sh`:** `dot1dStpProtocolSpecification` was decoded with the
  wrong enum (`1=none, 2=unknown`); corrected to the BRIDGE-MIB values
  (`1=unknown, 2=decLb100, 3=ieee8021d`). The port-state table is now walked once
  (a single snapshot, less load), and the verdict no longer claims "all forwarding"
  when every port is in another state.
- **`tools/nt-poe-probe.sh`:** each OID is walked once instead of twice.

(Diagnostic scripts live in `tools/`, outside the shipped module.)

## v5.5.32 — 2026-10-16

### Fixed: NT Faceplate drew phantom SFP cages on switches that mislabel their VLAN interface

On a switch that reports its VLAN/management interface as `ethernetCsmacd(6)`
instead of a virtual ifType — seen on TP-Link JetStream (e.g. TL-SG2008P, which
reports `Vlan-interface1` as type 6) — the faceplate counted that interface as a
front port. Its trailing name digit collided with a real port's, so numbering
fell back to position, the port count went one too high, and an 8-port switch
was drawn as "8+2" with two empty SFP cages — every port shifted by one.

The front-port filter now applies the virtual-name check to **every** interface,
not only to those without an ifType, so a mislabelled `Vlan-interface…` is dropped
regardless of its reported type. The TL-SG2008P now renders as a clean 8-port
front with no SFP. Covered by a regression test built from the device's real
SNMP walk (`tests/FaceplateBuilderTest.php`).

## v5.5.31 — 2026-10-16

### New widget: NT Faceplate

The front panel of one switch as a dashboard tile. Every port is drawn as a
socket: RJ45 in blocks of six with the odd ports on top, SFP cages set apart
on the right. Ports are coloured by link state (up / down / no data) or by
link speed (10M … 10G+). Admin-down ports have a dashed outline, and a port
with an open problem is outlined in that problem's severity colour. A bolt marks PoE
ports that are delivering power (POWER-ETHERNET-MIB). Hovering a port shows
its name, alias, speed, traffic, errors and LLDP neighbour. Clicking it opens
the graph of its status item.

- **Generic, not vendor artwork.** The layouts are 8+2, 16+2, 24+2, 24+4,
  48+4 and 48+6. "Automatic" picks the smallest layout that fits the
  discovered front ports. Exactly 8/16/24/48 ports get no empty SFP cages.
  The first N ports by ifIndex are copper and the rest are SFP. A fixed
  layout can be chosen for devices that number their ports differently.
- **Real port numbers, not list positions.** The number on the front comes
  from the trailing digits of the port name when they are unique, else from
  the ifIndex relative to the lowest one, and only as a last resort from the
  position. A port the template's discovery filters out, or one whose items
  have no value yet, leaves an empty socket instead of shifting every later
  port and the copper/SFP boundary. A front that ends inside the copper part
  of the next layout (20 ports) is drawn as a plain copper front instead of
  24+2 with invented sockets.
- **Correct values on the edge cases.** `net.if.speed[N]` (Cisco/pfSense
  template family) is already bit/s and is no longer capped at the 32-bit
  ifSpeed limit, so 10G ports keep their speed. When both 64-bit and 32-bit
  octet counters exist, the 64-bit one is used and traffic is not counted
  twice. An LLDP neighbour on a LAG or VLAN interface no longer lands on the
  front port with the same number. PoE in a stack uses the lowest PSE group
  instead of letting member 2 overwrite member 1.
- **Front ports only.** VLAN, loopback, LAG and tunnel interfaces are dropped
  by ifType, or by name when the template has no ifType item.
- **Both key styles** of the common SNMP templates are read
  (`net.if.status[ifOperStatus.N]`, `ifOperStatus[N]`, and the bare
  `net.if.status[N]`). Name and alias come from the resolved item name when
  the template has no ifName/ifAlias item.
- New action `network.topology.faceplate` (one host, one item request, one
  trigger request) and a pure `Topology\FaceplateBuilder`, which shares the
  key and speed rules of `MetricExtractor` (its helpers are now public), with
  `tests/FaceplateBuilderTest.php`. The widget is wired into deploy, install
  and uninstall, ESLint and the shared-code parity check.

### Dashboard widgets follow the Zabbix theme (light / dark)

All five NT dashboard widgets — Topology, KPI, Health, Table, Items — now read the
active dashboard background and switch between a light and a dark palette instead of
a single hard-coded light set. On a dark theme the headline numbers, host names and
table text were barely legible before; they read clearly now, and severity colours
use brighter variants on dark. The colours live in one shared `NtTheme` helper
(light/dark chosen by measured background luminance, WCAG) that every widget —
including the new Faceplate — inherits, so a widget can no longer drift to its own
palette. No configuration change; the default light look is unchanged.


## v5.5.30 — 2026-10-14

### Adjustable node size on the technical map

A new **node-size control** in the technical-map toolbar (next to the Performance
toggle) cycles the host points through three steps — normal → large → small. It
scales the nodes **and their labels together**, which declutters a dense map where
the label boxes overlap, not just the circles. The setting is remembered per
browser; the default (normal) is unchanged, so existing views look exactly as
before. Switching is a live restyle — no re-layout, so positions, pins and focus
stay put. Ghost, endpoint-bundle and performance-mode nodes scale with it.

## v5.5.29 — 2026-10-14

### Fixed: LLDP items recreated on every neighbour relearn (unstable lldpRemIndex)

On switches where `lldpRemIndex` changes after an LLDP aging/relearn — e.g. a
Cisco SG200 — the same neighbour on the same local port keeps getting a new table
index. The bundled "NT LLDP Neighbors by SNMP" template used that index
(`0.LocalPort.RemIndex`) as the LLD identity, so each relearn looked like a new
resource: the old dependent items were lost/disabled and a fresh set created, and
the topology edge flickered or dropped while discovery churned.

The LLD identity is now built from the **stable** neighbour attributes — the local
port plus a 32-bit hash of the remote chassis ID and port ID — kept as a numeric
`0.LocalPort.<hash>` index, so the module still reads the local port from it and
correlates the six columns by it. The volatile RemIndex is kept only as a lookup
macro the item prototypes use to read the value from the current walk; when it
changes, discovery re-syncs that macro while the item (its key) stays put. A
neighbour that advertises neither chassis nor port ID falls back to the old
RemIndex-based identity. Covered by a regression test built from the reporter's
own before/after walks (`tools/check-template-logic.mjs`). Reported on GitHub (#25).

### Updating from 5.5.28 — re-import the template

This changes the "NT LLDP Neighbors by SNMP" **template**, not the module code.
Re-import it (Data collection → Templates → Import). Existing LLDP dependent items
are recreated once with the new stable key format — their short history is lost in
that one step, after which they stop churning on relearns. The module directory
itself is unchanged.

## v5.5.28 — 2026-10-14

### Fixed: empty map (no links, no metrics) when history is stored in ClickHouse / Elasticsearch

On Zabbix 8 with `HistoryProvider=clickhouse` (and with Elasticsearch on any
version), the map showed every host but no LLDP links and no node metrics.
`NetworkTopologyData::fetchLastValues()` read the `history*` tables straight from
SQL — a deliberate fast window-scan — which assumes SQL-backed history. With a
non-SQL provider those tables are empty, so every item reached `MetricExtractor`
with `lastvalue = null` and `LldpEdgeBuilder` had no neighbours to match.

Last values now go through the frontend's own history abstraction —
`Manager::History()->getLastValues()`, the same path the Zabbix UI uses — which
reads whatever storage each value type is configured for. The fast SQL
window-scan is kept for value types stored in SQL, so SQL installations are
unchanged; only a non-SQL provider takes the new path. Reported on GitHub (#26);
reproduced and fixed on a Zabbix 8.0rc1 instance with ClickHouse history.

### Updating from 5.5.27 — replace the directory

Backend only (bundle unchanged). No new action, no template change, nothing
stored is touched. Replace the module directory, `chown`, reload php-fpm.

## v5.5.27 — 2026-10-13

### Anonymised example data in the finder tests and docstrings

An IPv6/EUI-64 example in the ARP parser's test and docstring used a real MAC
address observed while validating the feature; it is replaced with an invented
one (`00:11:22:33:44:55`), in line with the project's rule that all example data
is fabricated. No behaviour change.

## v5.5.26 — 2026-10-13

### Code-review follow-ups (MAC/IP finder)

- **IPv6 EUI-64 now checks the universal/local bit.** A privacy or DHCPv6 address
  whose random interface-ID happened to carry the `ff:fe` marker (1 in 65 536) was
  accepted as EUI-64 and yielded a fabricated MAC instead of falling through to the
  ND table. The extraction now also requires the U/L bit to be set (as a real
  MAC-derived address has), so random addresses correctly go to the ND lookup.
- **The LLDP capability query is scoped to the switches with hits** instead of
  pulling every `lldpRemSysCapEnabled` item in the install on each search.
- **The "all locations" list de-duplicates by host and port**, so a MAC seen on one
  uplink port in two VLANs (dot1q) no longer appears twice.
- **Version drift guard.** `package.json` had fallen behind `manifest.json`;
  `ci:package` now fails if the two module versions disagree.

The per-switch LLDP-vs-heuristic choice is kept as a documented, deliberate limit:
unioning them would re-introduce the hypervisor-port false uplink that LLDP fixes,
and the finder stays honest via its `ambiguous` status.

## v5.5.25 — 2026-10-13

### Improved: crisper adaptive tokens under the high-contrast dark theme

The adaptive dark palette (5.5.24) mixed mid-tone text and line colours, which is
right for dark-blue/dark/dark-classic but too soft for Zabbix's **high-contrast**
dark theme, where everything should stay maximally legible. The derivation now
detects high-contrast (background near pure black and text near pure white) and
holds the secondary text and border colours closer to the text, so they keep a
high contrast ratio on black instead of fading to grey. The other dark themes are
detected as not-high-contrast and are unchanged, so the dark-blue look from 5.5.24
is untouched.

## v5.5.24 — 2026-10-12

### Improved: the dark palette adapts to the active Zabbix theme (Zabbix 8 dark-blue)

The module's dark mode used one fixed GitHub-grey palette, so under Zabbix 8's new
**dark-blue** theme it sat as a grey island on the navy UI. It now **measures**
Zabbix's actual background and text colour at render and derives its chrome tokens
(surfaces, text, lines, muted) from them — hue-preserving, so grey themes stay grey
and dark-blue becomes navy. Backdrop, toolbar, canvas, detail panel, legend,
tooltips, context menu and the MAC panel all follow, as do the simple tabs
(Diag/Health/Stats/Compliance/LLDP-Q) via the shared tab palette. Status colours
(ok/warn/crit) stay fixed, and if the measurement fails the previous static dark
palette applies unchanged. Only dark mode is adaptive; light mode is untouched.
This builds on the existing "measure the background, don't guess the theme name"
dark-detection (`seiteIstDunkel`).

## v5.5.23 — 2026-10-11

### New: the MAC finder also searches by IPv6

IP search now covers **IPv6**, in two ways. A link-local or SLAAC address carries
its MAC inside it (EUI-64, the `ff:fe` in the middle of the interface ID), so the
finder extracts it **directly — no SNMP, no item** — and the panel says the MAC
was derived from the address. Any other IPv6 (privacy extensions, DHCPv6) is
resolved through the router's **ND table** (`ipNetToPhysicalPhysAddress`): add one
`walk[1.3.6.1.2.1.4.35.1.4]` item with key `nt.nd` next to `nt.arp` (see
FDB-SETUP.md; `tools/nt-arp-add-item.sh` now creates both). Matching is on the
canonical IPv6 form, so `fe80::1` and `fe80:0:0:0:0:0:0:1` resolve the same.

The IPv6 logic is pure and unit-tested (`ArpParser::macFromEui64` / `parseNd` /
`canonicalV6`): EUI-64 extraction with the U/L-bit flip, global vs link-local,
privacy addresses correctly declined, the ND index shape (ifIndex/type/len/addr)
with IPv4 rows skipped, and zone-id stripping.

## v5.5.22 — 2026-10-09

### New: the MAC finder also searches by IP address (ARP)

The **🔎 MAC** finder now accepts an **IP address** as well as a MAC. It resolves
the IP to a MAC through the **ARP table** of a router or L3 switch, then runs the
normal FDB lookup — so you get the access switch and port straight from an IP, and
the panel shows how the IP resolved (`IP → MAC`, which router, how fresh the ARP
entry is). Like the FDB, the ARP table comes from Zabbix, not SNMP done by the
module: add one `walk[1.3.6.1.2.1.4.22.1.2]` item with key `nt.arp` on the
gateway (see FDB-SETUP.md). Several routers can carry it; the newest ARP entry
wins. Without the item, MAC search is unchanged and IP search simply says it has
no data.

The value parser is pure and unit-tested (`ArpParser`), tolerant of the common
MAC encodings (`Hex-STRING:`, `0x…`, colon/dash/dotted), and drops incomplete
all-zero entries. `tools/nt-arp-probe.sh` checks a device before you wire the item
(counts plus one masked sample line — never a real MAC or IP).

## v5.5.21 — 2026-10-09

### Improved: MAC finder classifies uplinks by LLDP, not just MAC counts

The **🔎 MAC** finder tells an access port from an uplink so it can name the one
port where a device actually lives. Until now that was a pure heuristic — a port
carrying many MACs was assumed to be an uplink — which misreads a hypervisor port
or a downstream unmanaged switch. It now uses LLDP where the data exists: a local
port whose LLDP neighbor advertises **Bridge** or **Router** capability is an
uplink, while access devices (AP, phone, station) are not. Port names come from
the same ifName source as the FDB hits, so they line up. Switches without LLDP
fall back to the MAC-count heuristic, so nothing a search found before is lost,
and the panel says which method stood behind the answer. The classification logic
is pure and unit-tested (`LldpEdgeBuilder::uplinkPortsByCaps`), covering hex and
value-map capability forms, the LLDP vs CDP index shapes, and the ifName fallback.

## v5.5.20 — 2026-10-09

### Fixed: MAC finder returned HTTP 500 on real (numeric) host IDs

The first live search with the **🔎 MAC** finder failed with an HTTP 500. The
search action groups each switch's walk[] values under its host ID, cast to a
string — but PHP normalizes a numeric array key back to an integer, so iterating
the map handed `FdbParser::parse()` an `int` where it requires a `string`, and the
strict type threw. The unit tests never saw it because their host IDs are
non-numeric (`sw1`), the same blind spot as the numeric-host-ID note in the LLDP
builder. The host-map parse now lives in a single `FdbParser::parseHostMap()` that
casts the key back at the boundary, covered by a regression test with a numeric
key. No data or SNMP change — the walk[] items were fine.

## v5.5.19 — 2026-10-09

### Fixed: nt:lldp alias did not match MAC-formatted neighbor names

When a device reports its neighbor by **MAC address** (common with CDP, and with
switches that do not expose `lldpLocSysName`), an `nt:lldp` tag written in one MAC
notation did not match the neighbor reported in another. The alias comparison ran
against the raw neighbor string before the MAC was normalized, so
`nt:lldp = AA:BB:CC:DD:EE:FF` missed a neighbor reported as `AA BB CC DD EE FF`
even though both are the same address. MAC-shaped aliases are now also indexed in
a canonical form and MAC neighbors are matched against it, so every common
notation — colon, dash, space-separated bytes, Cisco dotted, and bare — resolves
to the same host. Ambiguity stays honest (two hosts claiming one MAC → no edge, a
Quality-tab note), and broadcast/all-zero MACs are never used as an identity.
Reported on GitHub (#24), with a precise analysis from the reporter.

## v5.5.18 — 2026-10-09

### New: find which switch port a MAC address is on

A **🔎 MAC** button in the toolbar opens a small panel: type a MAC address and
it answers with the **access switch and port** — the one port where the MAC
lives that is not an uplink. It reads each switch's forwarding database from
Zabbix (not by doing SNMP itself, so it also works for switches behind a proxy)
and is honest about the rest: it lists every location including the uplinks, with
how fresh each sighting is, and says "ambiguous" with all candidates rather than
guessing when several access ports match.

This first version estimates which ports are uplinks from the FDB itself (a port
carrying many MACs), which is weaker than LLDP — the panel says so, so ports with
a hypervisor or a downstream switch get a second look. Using the module's LLDP
knowledge of switch-to-switch ports instead is the planned refinement.

**Opt-in:** add four `walk[]` items to a switch (see `FDB-SETUP.md`) — the
finder has no data for a switch until you do, and says so.

### Data-quality markers are now gated

The measured / estimated / stale / unknown vocabulary (5.5.16–5.5.17) is now held
in one place by a gate (`ci:quality`), so a state can't be added without its glyph
and its text in both languages.

### Updating from 5.5.17 — replace the directory

Backend + frontend (bundle), one new action (`network.topology.fdb_search`).
Replace the module directory, `chown`, reload php-fpm. No template change on the
module itself; the MAC finder is inert until you add the `walk[]` items.

## v5.5.17 — 2026-10-09

### Data-quality markers now consistent across edge panel, tooltip and table

Step two of making data quality traceable. The measured / estimated / unknown
distinction introduced in the node panel (5.5.16) is now drawn the same way
everywhere:

- The edge panel's "per-link" (measured) and "estimated" markers carry the same
  glyph as the node chip (● / ◐), and the tooltip's per-link marker matches.
- In the table, a not-collected CPU, Memory, Ping or traffic value shows a muted
  dash in the "unknown" colour with a "not collected" hover title — kept as a
  dash, not a full chip, so a table of thousands of rows stays readable. The
  traffic column no longer shows a measured 0 b/s and a missing value the same
  way: a measured 0 now reads as 0, a missing one as the unknown mark.

### Updating from 5.5.16 — replace the directory

Frontend only (bundle). No new action, no template change, nothing stored is
touched. Replace the module directory, `chown`, reload php-fpm.

## v5.5.16 — 2026-10-09

### A missing metric now reads as "not collected", not a healthy dash

In the node detail panel a CPU, Memory, Ping or traffic value that was not
collected showed a bare "—", which reads like a healthy zero — the same trap
`ci:ghost` already guards against for node status. Those values now show a muted
"? not collected" chip instead. For traffic this also separates "no traffic
item" (not collected) from a genuinely measured 0 b/s.

Under the hood a new pure module (`quality.js`) defines one vocabulary —
measured / estimated / stale / unknown — reused across views, so the same
distinction is drawn the same way everywhere. This is the first step; the edge
panel, tooltip and table view follow. From the "make data quality traceable"
plan.

### Updating from 5.5.15 — replace the directory

Frontend only (bundle). No new action, no template change, nothing stored is
touched. Replace the module directory, `chown`, reload php-fpm.

## v5.5.15 — 2026-10-09

### Right-click on a node no longer also opens the browser's menu

Right-clicking a node opened the module's node menu, but the browser's own
context menu popped up on top of it — clicking dismissed both, and you had to
nudge the native menu aside to reach the node actions. The native menu was never
suppressed: the handler cancelled the wrong event (the mouse-up, not the
contextmenu event). The map now cancels the contextmenu event on its canvas, so
only the node menu shows. Present since at least 5.3.x; reported from the field.

### Label boxes are solid, so values stay readable over the lines

The host-name and traffic (`×N`, `↓`/`↑`) label boxes were slightly translucent,
so the dashed link lines ran through the text. They are now opaque (theme-aware,
light or dark), and a labelled link draws above its bundle siblings so its box
covers their lines instead of being crossed by them. Reported from the field.

### Hop view: a failed host query no longer crashes the request

`hopScope()`'s host query was unguarded. On a large install where it errors or
times out, the Zabbix API wrapper returns `false`, and the code then hit
`array_keys(false)` — an uncaught error that returned HTTP 500 for the whole
host+hops request. It now returns an empty, incomplete-flagged scope instead of
crashing, and does not cache that empty result. From the code review.

### Hop view warns when its graph came back incomplete

The incomplete-graph signal added in 5.5.14 (`scope_graph_incomplete`) now raises
a warning toast, like the existing "groups truncated" and "edges truncated"
warnings — before, the backend flagged a hop graph with missing links that the
map user never saw. From the code review.

### Updating from 5.5.14 — replace the directory

Backend + frontend (bundle). No new action, no template change, nothing stored
is touched. Replace the module directory, `chown`, reload php-fpm.

## v5.5.14 — 2026-10-08

### Host+hops: an incomplete edge graph is reported, not swallowed

When the host+hops map builds its edge graph it fetches neighbour items in host
chunks (5.5.12). If one of those chunks came back as an API error, the chunk was
skipped silently — its hosts were missing from the graph, yet the map looked
complete. The data response now carries `scope_graph_incomplete` (the count of
chunks that failed to load; 0 means complete, same convention as
`edges_truncated`), and the flag is kept on the 60-second graph cache so a cache
hit reports it too. An empty chunk (hosts that simply have no neighbour items) is
not an error and does not count. Follow-up to the external review (finding #10).

### Updating from 5.5.13 — replace the directory

Backend only. No new action, no template change, nothing stored is touched.
Replace the module directory, `chown`, reload php-fpm.

## v5.5.13 — 2026-10-08

### Fix: map data action crashed (HTTP 500) when a baseline was cached

The topology-diff privacy guard (5.5.9, review #11) referenced a `$hosts`
variable that does not exist in the method where it runs on this build — the
response builder gets its host data as nodes, and on a cache hit there is no
host.get result at all. Whenever a baseline snapshot was already cached (APCu
present, map opened a second time), the guard hit `array_keys(null)` and the
data action died with a 500 instead of drawing the map. It now derives the set
of visible hosts from the rendered nodes (the numeric node ids), which is the
correct source here and also works on a cache hit. The privacy behaviour is
unchanged: baseline endpoints not currently visible are still permission-checked
before they can count as a change.

### Updating from 5.5.12 — replace the directory

Backend only. No new action, no template change, nothing stored is touched.
Replace the module directory, `chown`, reload php-fpm.

## v5.5.12 — 2026-10-08

### Host+hops map builds its edge graph in bounded chunks

The host-and-hops view builds a graph of all cable/neighbour edges once, caches
it for a minute, then walks outward from the focus host and cuts the result to
the hop limit. The build itself was unbounded: it fetched the neighbour items of
*every* visible host in a single `item.get`, and the last-value window scan ran
over that same unbounded set — on a large installation the memory peak landed
before the hop limit ever applied, so even a "1 host + 1 hop" view paid for the
whole inventory. The fetch now runs in host-sized chunks (the same chunk size the
main map query already uses), so each query and its last-value scan stay bounded.

This chunks the *query*, not the total memory of the graph build: the neighbour
name resolution is cross-host, so the builder still needs the full item set once
it is collected. Walking only the frontier (an incremental adjacency index that
never materialises the whole graph) is the larger follow-up — it needs its own
load test against a realistically large inventory before it ships. From the
external review (finding #10).

### Updating from 5.5.11 — replace the directory

Backend only. No new action, no template change, nothing stored is touched.
Replace the module directory, `chown`, reload php-fpm.

## v5.5.11 — 2026-10-08

### Sparklines of fast items no longer freeze on the first two minutes

The hourly sparklines fetched the oldest 120 samples per item. For an item polled
every 30s that is the whole hour, but for a faster item (say every second) it was
only the first two minutes — the little chart never moved past the start of the
hour. It now fetches the most recent samples instead, so a fast item shows the
current window, which is the part you actually want. Items at 30s or slower look
the same as before. From the external review (finding #9).

### Updating from 5.5.10 — replace the directory

Backend only. No new action, no template change, nothing stored is touched.
Replace the module directory, `chown`, reload php-fpm.

## v5.5.10 — 2026-10-08

### Saving shared links, positions or colours no longer clobbers each other

The shared manual links, node positions and colour scales all live in one
`module.config`, under different keys. Each writer used the config as it was at
the start of the request, set its own key, and wrote the whole thing back — so
two people (or two browser tabs) saving different things at the same time could
undo each other: you save new links, a colleague saves positions a moment later,
and their save puts your old links back. The per-key "changed elsewhere" check
didn't catch it, because it only looked at the key being edited.

Each shared save now re-reads the config fresh from the database right before
writing and merges in only its own key, so a concurrent change to another key is
kept. The read path is unchanged. From the external review (finding #4).

### Updating from 5.5.9 — replace the directory

Backend only. No new action, no template change, nothing stored is touched.
Replace the module directory, `chown`, reload php-fpm.

## v5.5.9 — 2026-10-08

### Privacy: the change list no longer leaks a host you lost access to

The "what changed" list (`topo_changes`) is a diff against a 7-day baseline that
stores host names. The diff ran against the raw baseline, so this could happen:
you could see both ends of a link, then lost access to one host but kept others
in the selection; once the short data cache expired, the fresh topology no longer
held that host while the baseline still did, and the change list reported its
name and connection as "removed" — a name you were no longer allowed to see.

The baseline is now filtered to the hosts you can currently see (checked with a
permission-respecting `host.get`) before the diff is computed and before it is
stored, so losing access to a host neither leaks its name nor shows up as a
physical topology change. Ghost and internet endpoints carry no Zabbix host name
and are unaffected. From the external review (finding #11); covered by a test.

### Updating from 5.5.8 — replace the directory

Backend only. No new action, no template change, nothing stored is touched.
Replace the module directory, `chown`, reload php-fpm.

## v5.5.8 — 2026-10-08

### CPU: one correct source per host, never a time category

`system.cpu.util`'s default type is *user* (on Linux) or *system* (on Windows) —
a fraction of the CPU, not the total — and the bracketed subcategory keys
(`system.cpu.util[,user]`, `[,system]`, …) are the same. The total is the bare
`system.cpu.util` item (the official Linux template labels it "CPU utilization")
or `100 − system.cpu.util[,idle]`.

- The **shown CPU %** took any non-idle `system.cpu.util[...]` as the value, so
  depending on item order a subcategory (e.g. 7% user) could win over the real
  total (80%). It now uses only the bare total and `100 − idle`; named
  subcategories are ignored — an honest "—" beats a wrong number.

- The **CPU forecast** averaged total, idle and subcategories together per hour
  (80% + 20% idle → a flat 50%). It now picks one source per host
  (total → idle → per-core), converts idle to `100 − idle`, and only averages
  homogeneous series (e.g. `hrProcessorLoad` cores).

From the external review (findings #5 and #6). A MetricExtractor test covers the
selection.

### Updating from 5.5.7 — replace the directory

Backend only. No new action, no template change, nothing stored is touched.
Replace the module directory, `chown`, reload php-fpm.

## v5.5.7 — 2026-10-08

### History slider: correct state at the range start, and no name collisions

Two coupled correctness bugs in the Stats/History slider, from the external
review:

- The state at the **start of the range** was taken from the problems open
  *now* whose creation predated the range start. A problem that was open at the
  range start but has since been resolved was simply missing, so a host looked
  fine between the range start and its recovery. The start state now comes from
  the problems that were actually in the problem state at that moment (resolved
  ones included), via `event.get` with `problem_time_from`/`problem_time_till`.

- The slider closed problems by trigger **name**. Two triggers with the same
  name — or one trigger that raised several problems — overwrote each other, and
  a recovery closed the wrong one. Problems are now tracked by their event id,
  and each recovery closes exactly the problem it belongs to.

Covered by a new headless scenario (`ci:frontend`): a same-named trigger
surviving another's recovery, and an open-at-start problem recovering in range.

### Updating from 5.5.6 — replace the directory, reload with a cache bypass

The change is backend plus the bundle. No new action, no template change,
nothing stored is touched. Replace the module directory, `chown`, reload
php-fpm, then reload the topology page once with a cache bypass.

## v5.5.6 — 2026-10-08

### Maintenance creation now honours role permissions

Creating a maintenance period from the map checked only that the user was at
least an Admin. A Zabbix role can forbid an Admin from editing maintenance (and
from the configuration UI), and the internal API does not enforce those finer
role rules when it is called from a frontend controller. The action now also
checks the two role rules the native maintenance controller requires
(`ui.configuration.maintenance` and `actions.edit_maintenance`), so a role that
forbids maintenance editing is no longer bypassed.

### Failed writes are no longer reported as success

Zabbix's frontend API wrapper does not throw on an API error — it returns
`false` and registers the message. The module's write paths relied on
exceptions, so a failed write slipped through as success: a duplicate host name
came back as a created host with an empty id, a failed maintenance returned
`ok: true` with a null id, and a failed save of shared links, positions or
colour scales updated the in-request state while nothing was persisted. Each
write now checks the return value, surfaces the real API message, and reports
success only when the write actually happened.

### Correction to the 5.5.5 note

5.5.5 described the `problem.get selectHosts` fix as a Zabbix 8 change. That was
wrong: `problem.get` never supported `selectHosts` on any version — 7.0, 7.4 and
8.0 alike — so Stats, Compliance and sparklines were silently empty on 7.x too;
only on 8.0 did the PHP warnings in the log make it visible. The fix itself is
unchanged and correct; the entry below is corrected accordingly.

### Updating from 5.5.5 — replace the directory

Backend only. No new action, no template change, nothing stored is touched.
Replace the module directory, `chown`, reload php-fpm.

## v5.5.5 — 2026-10-08

### Stats, Compliance and sparklines were silently empty

Three tabs quietly produced nothing: the **Stats** timeline's "already open at
range start" markers, the **Compliance** stale-critical-problem check, and the
per-host **sparkline** problem age. Each called `problem.get` with `selectHosts`
— a parameter `problem.get` does not support on **any** version (7.0, 7.4 or
8.0). The frontend API wrapper then returned `false`, a `foreach` over it warned
in the log, and the feature produced nothing. The warnings were only noticed
during 8.0 testing, which is why this first surfaced as an "8.0" problem.

The host for a problem is now resolved through its trigger (the same
`trigger.get(selectHosts)` path the main map already uses), so these features
work again on every version. `event.get` does support `selectHosts`, so the
Stats timeline's event query is unchanged. A wider audit of the module's API and
macro usage against Zabbix 8's removals (massupdate, replacehostinterfaces, the
deprecated macros) found nothing else.

### Internal

The Object.assign guard that makes Cytoscape load on Zabbix 8 now has its own
gate (`ci:assign-guard`), wired into both CI pipelines.

### Updating from 5.5.4 — replace the directory, reload with a cache bypass

Backend only (plus one CI/tooling file). No new action, no template change,
nothing stored is touched. Replace the module directory, `chown`, reload
php-fpm, then reload the topology page once with a cache bypass.

## v5.5.4 — 2026-10-08

### Click the count tiles to filter by severity

The count chips above the map — Hosts, OK, Warn, Crit — are now clickable and
drive the same filter as the toolbar's severity pills. Click **Crit** to show
only High and Disaster, **Warn** for Info/Warning/Average, **OK** for Normal,
and **Hosts** to clear the filter. Clicking the active chip again clears it, the
active chip is ringed, and the fine pills stay in sync — so isolating *only*
Disaster is still one pill away. Edges and Ghosts stay display-only (Edges is
not a host severity; Ghosts would filter to nothing while ghost injection is
off).

### Updating from 5.5.3 — replace the directory, reload with a cache bypass

Frontend only: the change is in the bundle. No new action, no template change,
the widgets are unchanged, nothing stored is touched. Replace the module
directory, `chown`, reload php-fpm, then reload the topology page once with a
cache bypass.

## v5.5.3 — 2026-10-06

### Zabbix 8 support

The main module and the five widgets now load on **Zabbix 8** as well — verified
on 8.0.0rc1. Until this release the graph tabs (Technical, Management,
Dependencies, Geo) came up blank there, with no error in the module's own code.

The cause was outside the module. Zabbix 8 defines `Array.prototype.xor` in its
`js/common.js` with `Object.defineProperty`, whose omitted attributes default to
**non-writable and non-configurable**. Cytoscape builds its collection prototype
on top of `Array.prototype` and merges its own `xor()` method onto it with
`Object.assign`; that write cannot shadow the inherited, now non-writable
property and throws, so Cytoscape aborts at load and `window.cytoscape` is never
defined. On 7.0 and 7.4 the same line is a plain assignment (writable), so they
were never affected — and stay unaffected here.

A small guard (`nt-assign-guard.js`) swaps `Object.assign` for a
`defineProperty`-fallback variant **only while Cytoscape loads**, then restores
the original. It engages solely when the broken descriptor is actually present,
so on 7.x it is a true no-op; the Zabbix `xor` helper is left intact and no
Cytoscape update is needed. A depth counter keeps two widgets on one dashboard
from restoring the original mid-load.

### Updating from 5.5.2 — replace the directory, reload with a cache bypass

No new action, no template change, nothing stored is touched. Replace the module
directory, `chown`, reload php-fpm, then load the topology page once with a cache
bypass — the view now pulls in one new script file, and the topology widget
changed too (same guard, widget version 3.2.1).

### Changed

- Zabbix 8: guard `Object.assign` so Cytoscape loads, wired into the page view
  and the topology widget loader (`nt-assign-guard.js`).
- README and badges now list Zabbix 8 (7.0 LTS / 7.4 / 8.0).

## v5.5.2 — 2026-10-04

### Updating from 5.5.1 — replace the directory, and that is all

No new action, no template change, and the widget scripts are unchanged
except for one English label fix. Replace the module directory, `chown`,
reload php-fpm, then reload the topology page once with a cache bypass,
because the bundle changed. Nothing stored is touched.

### A quality pass — six parallel reviews, and what they turned up

All seventeen gates were green on 5.5.1; this release is what they do not
see. Six focused reviews (security, backend logic, frontend logic,
theme/colour, duplication/i18n, test coverage) ran over the whole module,
and every finding below was reproduced against the code before it was
fixed. The headline: no security vulnerability, and the two correctness
clusters were both the "draw one cable as two" error the edge builder
exists to prevent.

### Fixed

- **Two order-dependent false splits in LLDP edge building.** A reporter
  that announced a neighbour first *without* a port (a scalar
  `lldpRemSysName`, or CDP/MNDP) and then *with* one drew two edges for the
  one cable; reversing the item order drew one. And a scalar
  `lldpRemChassisId` slipped past the no-name guard, so a host with a
  scalar name got both a real neighbour and a MAC ghost. Both are fixed and
  carry counter-checks that fail without the fix. The number of edges no
  longer depends on the order Zabbix returns the items.
- **Synthetic edges no longer count, style or probe as real links.** The
  ghost edge was already excluded everywhere; the internet-cloud uplink and
  the collapsed-endpoint bundle were not, though neither is a measured link
  with a host at the far end. They inflated the "Edges" and "LLDP links"
  KPIs, the traffic heatmap overwrote the bold internet uplink with its
  faint idle style on every render, and hovering a bundle fired a history
  request to a node id that is not a host. (The 5.5.1 fix that tagged the
  bundle edge `isLLDP:false` never took effect in the KPI, which does not
  read that flag — it does now, by excluding the edge.)
- **Tint badges were illegible in dark mode.** The palette had bright
  dark-mode text colours but no matching tint background, so code hardcoded
  the pale light tint behind text that flipped bright — bright-on-pale in
  dark. New `--nt-ok/warn/crit-bg` tokens fix the maintenance/ack badges
  and the geo banners; a few hardcoded light chrome colours (a tab
  separator, an export-menu hover that hid its own row, preset borders)
  went to tokens too.
- **A handful of i18n defects a gate could not see.** `toolbar.on`/`off`
  were declared twice in both language files (the first, dead); the health
  metric labels in the German file were still English
  (Offline/Stale/Critical/Unacked → Offline/Veraltet/Kritisch/Unquittiert);
  and one table-widget string was German. None changes behaviour; all are
  now correct.

### For contributors

- The test net grew where the bugs were. **ci:parity** now also guards the
  compliance check-key set between the JS view and the PHP action — a
  second JS↔PHP duplicate nothing watched — and the health formula's stale
  window and severity cutoff, not just its weights and colour thresholds.
  **ci:i18n** now diffs the `de.js`/`en.js` key sets, so a key missing from
  one language fails the build instead of shipping a bare key. **ci:xss**
  now also flags `${…}` interpolation into `innerHTML`, not only `+`
  concatenation. **ci:frontend** gained a hostile-label scenario for the
  LLDP-quality view, the most untrusted data the module renders.
- Confirmed solid, so no one re-audits it: no security vulnerability
  (output encoding is applied throughout, every write action carries the
  full POST/CSRF/permission/throttle set, PortScan cannot be steered off a
  user's own hosts, and the inline config cannot break out of its script
  tag); the health-score formula is identical on both sides to the digit;
  and the shared widget blocks are byte-identical to their source.

## v5.5.1 — 2026-10-03

### Updating from 5.5.0 — replace the directory, and that is all

**No "Scan directory", no new template, no widget change.** There is a new
action (`network.topology.create_host`), but `loadManifest()` reads
`manifest.json` from disk on every request, so the route is live the moment
the files are in place. The five widget scripts are byte-identical to 5.5.0.

Replace the module directory, `chown`, reload php-fpm, then reload the
topology page once with a cache bypass, because the bundle changed. Layouts,
manual links, pins, notes and presets stay where they are.

### Added

- **A switch's unmonitored endpoints fold into one node.** A top-of-rack
  switch with forty workstations and phones hanging off it drew forty ghost
  nodes, and the forty said nothing a single number would not. They now
  collapse into one bundle per switch, labelled with the count; a click opens
  it. Infrastructure neighbours — anything reporting Bridge, Router or WLAN AP
  — are never bundled, because those are the map. The toggle is in the
  toolbar and the state is kept per browser.
- **RX/TX sparkline per port, from data the map already had.** Hovering a
  physical link now shows the recent traffic on each end's port as a small
  inline graph. No new items and no extra load: the values were already being
  fetched for the port counters, and the port detail opts in to the per-port
  series with a single flag so tooltips stay cheap.
- **How long a link has been up.** When a host collects `ifLastChange`, the
  port detail shows the uptime of that link — `sysUpTime − ifLastChange`,
  wrap-safe across the 32-bit TimeTicks rollover at ~497 days. It is read
  opportunistically: nothing to re-import, and ports without the item simply
  do not show the row.
- **Turn an unmonitored neighbour into a monitored host.** A ghost discovered
  over LLDP/CDP can be created as a Zabbix host from its detail panel —
  pre-filled from what the neighbour reported, placed where it already sits on
  the map. Admin-only, CSRF-guarded, throttled, and every client-supplied id
  is cut against the API.
- **The vendor, read out of the chassis MAC.** A ghost with no system name
  but a chassis MAC now shows its manufacturer from the IEEE OUI table, and
  says so plainly when the address is locally administered and therefore has
  no vendor. The OUI table is fetched lazily and is not in the bundle.
- **A daily average on the diagnostics tab, so "did it get slower?" has an
  answer.** The hour-long ring buffer could say how fast the map is right now
  but not whether an update made it slower. A per-day average of the calls
  that actually computed — cache hits excluded — now answers that, with the
  trend against the preceding days.
- **A note when responses arrive uncompressed,** with the measured factor, so
  the one gzip setting that most helps a large map is easy to find.

### Fixed

- **A neighbour with a chassis but no system name is no longer invisible.**
  Edge building keyed members off the reported system name; a device that
  reported only a chassis id produced no member and dropped off the map
  entirely. It is now synthesised from the chassis, guarded so a real name is
  never overwritten. Proven on real hardware.
- **Traffic direction comes from the item key, not its name.** In/out was read
  from the item's display name, which a user can rename; it now reads the
  `net.if.(in|out)` key, which they cannot.
- **Endpoint bundles are not collapsed as leaves, and bundle edges render as
  bundle edges.** Two bugs the review caught in the new features before anyone
  saw them live: the leaf-collapse pass would have swallowed a bundle, and a
  bundle's edge fell through to the normal LLDP styling.
- **Five corrections to the daily series** found on review — a trend that
  could label an older day "today", UTC-vs-local day boundaries, a hardcoded
  colour, and a bar scale that spanned all thirty days instead of the drawn
  ones.

### For contributors

- **`ci:ghost`** — a seventeenth gate. One place now says a ghost is not a
  host, and the gate keeps every caller going through it. The gate chain is
  seventeen.
- **The frontend gate learned the views where the reported bugs actually
  were.** The bundling render, the sparkline SVG, the ghost-create payload,
  the vendor lookup and the ghost severity are all exercised headlessly now —
  because the expensive bugs this cycle were in what the UI *emits*, which no
  logic test had ever looked at.

## v5.5.0 — 2026-10-02

### Updating from 5.4.1 — replace the directory, and that is all

**No new action, no new template, no widget change.** "Scan directory" is not
needed: the only new PHP file is an internal class, and `loadManifest()` reads
`manifest.json` from disk on every request anyway. The five widget scripts are
byte-identical to 5.4.1, so dashboards need nothing — not even a cache bypass.

Replace the module directory, `chown`, reload php-fpm, then reload the
topology page once with a cache bypass, because the bundle changed.

Layouts, manual links, pins, notes and presets stay where they are. The group
view stores one additional key in your browser (which group levels you have
open); nothing existing was touched, and an old browser simply starts with
everything folded.

### The map got about three times faster, and not one displayed number changed

This is the headline, and it was measured rather than felt. On the load-test
rig — 1000 hosts, 1425 edges, 43 200 items behind them — a full map load went
from **4681 ms to 1581 ms**.

Worth writing down is how it went, because three plausible explanations were
wrong and each cost a measurement:

- **Edge building** was the first suspect, because that is where the clever
  code lives. It was **2 %** of the time.
- **The SQL chunk size** was the second. Raising it bought **13 %**, not the
  order of magnitude the hypothesis predicted.
- **Fetching fewer values** was the third, and this one was worse than wrong:
  reading `MetricExtractor` first showed that the per-port items feed the host
  aggregates. "Ports down 17 (55 %)" would have quietly become "2 (100 %)".
  A faster map that lies is not a faster map.

What actually paid was fetching the same values **differently**. The last
value per item now comes from a single window scan bounded to the last hour,
with the old per-item query kept as a fallback for exactly the items the
window missed. That phase went from 4017 ms (86 % of the load) to about
950 ms. The cache window also moved from 15 to 60 seconds — a 15-second cache
cannot help a map whose auto-refresh is two minutes apart.

The new bottleneck is the item lookup itself at roughly 450 ms, now a quarter
of the total. It is named here so the next person does not have to rediscover
it.

### Added

- **Nested host groups, opened one level at a time.** Zabbix' group hierarchy
  is a naming convention: `Berlin/Campus/Access` is one group whose name
  describes three levels. The map now resolves along those levels — a site
  collapses to a single node, and a click opens exactly that one level while
  its siblings stay folded. The point is **readability, not speed**: a
  thousand hosts drawn at once is a correct picture that nobody can read.
  Which levels you have open is kept per browser, because how deep someone
  has looked is a direction of view, not a property of the map.
- **A NetBox cable list.** *Export → NetBox cable list (CSV)* writes a file
  NetBox accepts under *Import*. No token, no connection, no new action — it
  is built in the browser like the GraphML file.

  **The side effect is worth more than the file.** NetBox validates every row
  itself: unknown device, unknown interface, interface already occupied. The
  first import is therefore a reconciliation against your documentation
  without this module comparing anything — and it answers, with real data,
  the most expensive question of the reverse direction before anyone builds
  it: do device and port names line up between the two worlds at all?

  Four rules decide what goes in, and every omission is counted in the
  message afterwards rather than swallowed: a cable needs a port at **both**
  ends, it must be confirmed from both sides or above the confidence
  threshold, both endpoints must be real Zabbix hosts, and no field may start
  a spreadsheet formula. The `type` column stays **empty** — which cable is
  physically plugged in appears in no SNMP table, and guessing does not
  belong in a document that is treated as truth afterwards.
- **"Which port is that thing on?" now answers for devices Zabbix does not
  monitor.** The table's *Connected to* column has named the switch and port
  for a while, and the search understands `port:lab-sw-01`. Both only ever
  worked for hosts — and the device you are looking for is often precisely the
  one without a host: an access point that needs a PoE restart, something
  unknown on a wall port.

  Such neighbours now appear as rows of their own, with the reporting switch
  and the port they hang on, and they are included in the CSV, so the result
  is a patch list you can print and hold against your documentation. They are
  marked **NOT MONITORED** rather than carrying a status, on screen and in the
  file: a ghost has severity 0 because nothing is *known* about it, not
  because everything is fine — and a green "Normal" there was a reported bug
  once already. They are counted separately from the hosts for the same
  reason, and they carry no links into Zabbix, because there is no host
  behind them to open.

  The switch does **not** gain its ghosts as uplinks. A ghost hangs on the
  switch, not the other way round; the reverse reads as "lab-sw-01 is
  connected to <unknown device>", which is correctly wired and wrongly read.

  Whether they show follows the same **👻 Ghost nodes** setting as the map, so
  there is only one switch to reason about. It is off by default, which means
  nothing changes until you ask for it.
- **A "Not monitored" filter pill**, next to the severity pills, appearing
  only when the map actually holds such neighbours. Until now they were
  governed by the **OK** pill, because severity 0 is what they carry — so
  filtering for problems dropped them, and there was no way to filter *to*
  them at all. Severity 0 on a ghost means nothing is known, not that all is
  well, and the filter now says so too.
- **Four ways to make a crowded map readable again** — leaf collapsing,
  group aggregation, hulls and label shortening, each usable on its own.
- **The auto-refresh interval follows the size of the map:** two minutes from
  400 nodes upward, 30 seconds below that. A map that takes seconds to build
  should not start rebuilding while you are still reading it.

### Changed

- The Diag tab now reports **where** a load spent its time, phase by phase,
  including the number of item lookups behind it. The previous version
  reported that time had passed.

### Fixed

- **A cable between two hosts you had just expanded was redrawn as a group
  link.** With two expanded hosts in a collapsed site, the edge was rebuilt
  as a bare aggregate and the map hung on "Loading topology…" while the
  server had already delivered 1.3 MB. Edges between two un-aggregated nodes
  now pass through untouched.
- **The collapse button said "off" while 921 nodes were hidden.** The label
  was written once, and the renderer auto-collapsed afterwards. It is now
  notified, so the toolbar cannot contradict the canvas.
- **The `▸N` badge leaked out of the canvas.** It lived inside the node's
  label data, so it also appeared in the tooltip, in the detail panel's peer
  list and in the GraphML export. It is now composed in the style, where it
  belongs. (CSV and HTML exports were never affected — they read the raw
  nodes.)
- **The host form opened as a bare page on 7.0.** Before 7.2 it is
  `action=host.edit`; from 7.2 it is `action=popup&popup=host.edit`. The
  address is now chosen by the detected version, so "create host from ghost"
  works on both.
- **Two sites both had a group called "Core".** Shortened labels are now the
  shortest *unique* suffix, so two distinct groups can no longer share one
  name on the map.
- **A group hull showed the full path while its node showed the last
  segment.** Both now show the same thing.
- **The displayed IP could belong to the wrong interface.** The comparator
  that picks a host's primary interface compared `main` strictly, so an int
  `1` from our own code and a `'1'` from the API counted as different while
  their difference was zero — the sorter reported "equal" and the interface
  type never decided. An IPMI address won against an Agent address purely by
  input order. `tests/HostInterfaceTest.php` now pins this, including the
  mixed-type case that triggered it.
- **The Diag log looked frozen.** `apcu_inc` applies its TTL only when the
  counter is created, so after an hour it expired and restarted at 1 — new
  entries sorted to the bottom. The log is ordered by timestamp now.
- **Hovering the map pushed the Diag tab's own entries out.** Noisy actions
  have their own ring buffer, so they can no longer evict what the tab is for.
- **The memory figure measured the high-water mark, not what the map
  retains** — two different questions, two different instruments. And the
  KB-per-edge figure is suppressed below fifty edges, where it was noise that
  looked measured.

### Security

Both of these were found while reviewing code written in this release, and
both were reproduced before they were fixed.

- **A device name can no longer start a spreadsheet formula.** A CSV rarely
  stops at its target system — someone opens it in Excel or LibreOffice to
  look. A field beginning with `=`, `+`, `-` or `@` is evaluated there, and
  `=cmd|…` is the known DDE payload. The path is not hypothetical: the
  context menu pre-fills a new host's name with the **neighbour's** LLDP
  name, a string from a foreign device nobody here controls. The usual
  apostrophe guard was rejected because it would alter the device name, and
  the file is meant for NetBox. Such rows are dropped and counted instead.
- **The detail panel is built as elements, not assembled as markup.** It
  composed HTML strings from host names, item names, notes and LLDP
  neighbour names. Every value went through `esc()`, so no injection was
  found — but a single forgotten call would have been one, and string
  assembly makes that failure invisible. DOM construction makes it
  impossible. Behaviour is unchanged, byte for byte in the styles.

### For contributors

- **`ci:i18n` was reporting false positives and could have hidden a real
  one.** Its scanner read `return /[",\n\r]/` as a division, after which the
  `"` opened a string and swallowed the following comments. It now tracks
  whether a `/` can start a regex, and the fix was counter-checked with a
  planted German string.
- **`ci:frontend` grew a recording DOM stub**, which is what made the detail
  panel refactor safe: the test was written first, run green against the old
  string-building build, and only then was the module rewritten. New
  scenarios cover collapsing, the group view, the refresh interval, the host
  form address and the NetBox export.
- **The load-test rig is in the repository**, not in someone's notes:
  `tools/devnet/` now generates devices in bulk, gives each simulated device
  its own address, answers interface counters, and runs on k3s. 1000 hosts
  with 1425 cables, and a `soll.json` to check the drawn map against.
  `tools/devnet/erzeuge-gruppenbaum.py` builds the group tree the nested view
  needs — additively, because replacing a host's groups would drop it out of
  the load-test group and turn every neighbour outside the selection into a
  ghost. That mistake once produced 812 ghosts instead of 24.
- Three lint suppressions are gone rather than added to.

### Thanks

**[@christos-diamantis](https://github.com/christos-diamantis)** for the
observation that pushed the group view from an idea to a priority: showing a
very large number of hosts is not obviously worth doing, and tiering nested
groups to a single element that expands on demand is the more useful answer.
Two thirds of the machinery was already there — his framing is what made
clear the missing third was the nesting itself, and that the goal was
readability rather than throughput.

## v5.4.1 — 2026-09-25

### Updating from 5.4.0 — replace the directory, and that is all

One action was added (`network.topology.update_check`), and the rule written
down here for years said that makes **"Scan directory"** mandatory. It does
not, and this release is the one where that got checked properly:
`CModuleManager::loadManifest()` reads `manifest.json` **from disk on every
request**, and the `module` table holds only the path, the status and the
config. "Scan directory" reconciles module *directories* with that table — a
new action inside a module that is already registered is not a new directory.
Confirmed twice: measured on 7.4 on 2026-09-02, and read in the 7.0.30 source
for this release.

So: replace the module directory, `chown`, reload php-fpm. If the new button
in the Diag tab should answer "Unknown action" anyway, *Administration →
General → Modules → Scan directory* is the fallback — it costs one click and
breaks nothing.

Reload the page once with a cache bypass — the bundle **and all five widget
scripts** changed, and a dashboard will happily serve a cached widget script.
**No template changed**, and layouts, manual links, pins, notes and presets
stay where they are.

### Added

- **"Is there an update?" — a button, never a background call.** The Diag tab
  can now ask the project's release API whether a newer version exists, and
  it only asks when someone clicks. A monitoring module that phones home
  unasked is a trust problem: plenty of installations forbid outgoing traffic
  by policy, and an isolated one would carry a permanent, pointless warning.
  The click is the consent — which is also why there is no setting, no cache
  and no schedule to reason about.

  What goes out is a bare GET: no parameters, no version, no installation id.
  GitHub sees an IP and a user agent, and that is the whole of it. Super
  admins only — they are the ones who can replace the module, and the only
  ones who should be able to cause outgoing traffic with a click. A tag that
  cannot be read is reported as "not determinable" rather than guessed at,
  and a pre-release is never offered to someone running a final version.

### Fixed

- **Host + hops on a large network ended in "is not valid JSON".** Six hops
  from one switch reach practically every device on a campus or WAN, and the
  hop mode had no counterpart to the 100-group cap of the group mode. The whole
  pipeline ran over every host in one request until nginx gave up with a 504,
  and the map showed `Unexpected token '<', "<html> <h"... is not valid JSON`.
  Reported against 5.3.0 by a customer install; 5.4.0 was still affected, and
  a little more so, because the hop search has found more links since 5.3.1
  (`uplink.id`, MNDP, MAC matching).
  - The hop scope is now capped at **1,000 hosts, nearest first**. The search
    runs outward ring by ring, so every ring inside the cut is complete, and
    only the outer ones are missing.
  - The map says so: *"6 hops reach 4213 hosts — only the nearest 1000 are
    shown. The map is complete up to 3 hops."* Hosts the user cannot see are
    removed before the cap and do not use it up.
  - The response carries `scope_truncated`, `scope_total`, `scope_shown` and
    `scope_complete_hops` (additive; group mode reports `false`/`0`).

- **Every request says why it failed.** No fetch in the module checked the
  HTTP status before parsing, so a 504, an expired session or a PHP error
  all arrived as the same JSON parse error. All 22 calls in the main module
  now go through one helper that tells four cases apart — server unreachable,
  gateway timeout (502/503/504, with the advice to ask for less), another HTTP
  error, and a web page where data was expected. The initial load now also
  shows an `{error: …}` reply such as *Too many requests* instead of drawing
  an empty map, and the *stale* badge of the 30 s refresh names the reason in
  its tooltip.

### Widgets

- **The same error handling on the dashboard.** All five widgets fetch through
  `window.NtFetchJson`, the ES5 counterpart of the main module's helper —
  `widget_items` included, which has its own action and had the same bare
  `r.json()`.

### For contributors

- `tools/widget-shared.js` now holds **two** blocks: `NtFetchJson` goes into all
  five widget files, `NtWidgetData` into four as before.
  `tools/sync-widget-shared.mjs` and `ci:parity` handle both, each against the
  source.
- `assets/js/modules/http.js` exports `fetchJson()`. A bare `r.json()` has no
  place left in the module.
- `HopScope::distances()` (hostid → hop distance, nearest first) and
  `HopScope::cap()`; `neighborhood()` is unchanged. Covered in
  `tests/HopScopeTest.php`.
- `app.error` in `i18n/de.js` was English ("Error:"); it is German now.
- `fetchJson()` defaults to `credentials: 'same-origin'` and the
  `X-Requested-With` header; call sites that set them keep precedence. Every
  read action has `requireAjax()`, and a missing header comes back as
  `{"error":"AJAX only"}` — status 200, valid JSON, invisible to any helper.
- The five outcomes of a failed request are checked in `ci:frontend`,
  including the assertion that "Unexpected token" appears in none of them.

### Thanks

**[@christos-diamantis](https://github.com/christos-diamantis)** again, and
this time within a minute: he filed
[#22](https://github.com/linuser/zabbix-network-topology/issues/22) and
opened [#23](https://github.com/linuser/zabbix-network-topology/pull/23) with
the fix in the same breath — the second time in three days that a report
arrived with its patch attached. His branch is the one that shipped. It
reaches more call sites than the version written here in parallel, it carries
the helper into the widgets, and it found an English string sitting in
`i18n/de.js`, which is precisely the gap no gate here can see.

## v5.4.0 — 2026-09-24

### Updating from 5.3.2 — nothing to re-import

No action was added or renamed, so **no rescan**: replace the module directory,
`chown`, reload php-fpm. Reload the page once with a cache bypass — the bundle
changed, and this release changes what the map draws. **No template changed.**
Layouts, manual links, pins, notes and presets stay where they are.

**What will look different immediately:** a device pair connected by several
cables is now several lines. On a meshed core that is a visible change, and
*View → All parallel links: off* puts it back to one line per pair, marked
`×N`. Nothing is hidden either way — the count is on the line.

**Expect one burst of change notifications, once.** The baseline the topology
diff compares against knows **one** key per device pair; from this release on
it knows one per cable. On the first refresh after the upgrade the old entry
is carried over to one member of each bundle, and the remaining members are
formally new — a 4×10G LAG therefore announces *another cable … — 4 parallel
now* three times. Once, per user, then it is quiet. Nothing is wrong, and
nothing was rediscovered: the map simply counts cables now where it used to
count pairs.

### Thanks

**[@christos-diamantis](https://github.com/christos-diamantis)** reported
[#20](https://github.com/linuser/zabbix-network-topology/issues/20) and then
built it: [#21](https://github.com/linuser/zabbix-network-topology/pull/21) is
his, including the tests that pin the matching rules. His default — fan out
when zoomed in, bundle in the overview — replaced the one the roadmap had
sketched, and it is the better answer.

**A reporter who wrote by email** sent the screenshots behind four of the
fixes below: the 4.3 Gb/s that is a counter ceiling, red links on a switch
whose ports are merely unused, a port named on one side only, and a map where
30 hosts and 127 unmonitored neighbours piled up on each other.

### Added

- **Parallel links (LAG, bonding, several cables) are drawn as what they are.**
  Until now every pair of devices had exactly one edge: a second LLDP/CDP
  report for the same pair was merged into the first, first-wins. A 2×10G LAG
  showed one member's port and one member's counters, and a failed member was
  invisible. Now every cable is its own edge, with its own ports, traffic,
  utilisation and state.
  - **Fanned out** (zoomed in): one curve per member, side by side, each in its
    own weathermap colour; port labels at both ends stack into a small list.
    A member that stops being reported while its siblings still are is drawn
    red and dashed among the live ones.
  - **Bundled** (zoomed out): one line marked `×N` (only slightly thicker —
    the label carries the count), total traffic against total capacity of
    the live members, amber glow while a member is down.
  - *View → All parallel links: on / off*. On (default) fans out from 60 %
    zoom upwards and bundles below. **Off always draws one line per device
    pair with `×N`** — for meshed cores with six or seven cables between
    every pair, where a fan turns into a thicket at any zoom.
  - Clicking a bundle lists its members in the edge panel; a row opens that
    member. Path highlighting marks the whole bundle.
  - The topology diff reports a lost or added member on its own, instead of a
    false "port moved". A link that gains a second cable is not reported as
    removed and re-added.
- The dashboard widget keeps one line per device pair — the tile is too small
  for a fan — but it **counts the cables**: `×4` on the line, `×4 (1 down)`
  when a member is dead, red when all of them are. Without the count the tile
  claimed the same thing for a 4×10G bundle as for a single cable, and a
  failed member was invisible there — which is the very thing this release
  set out to fix.

- **"Connected to" — the port a device hangs on, as a column.** The hosts table
  carries device and port of the far end, and sorts and filters by them. That
  turns it into a patch list: which access point sits on which switch port,
  printable, and out through the new CSV button. Infrastructure sorts first,
  an ageing link is marked with a clock (for a device that is already gone,
  the port it hung on last is exactly the question), several cables stay one
  line with "+2 more". The table search knows `port:Gi1/0/8` as a field.

- **CSV export for the hosts table.** It existed only in Items mode. Exports
  what is on screen — filtered, sorted, visible rows — with device and port in
  two separate columns, because a spreadsheet wants to group by switch, and
  "Last seen here" as a value one can filter on.

- **The port in the connection list of the host panel.** One click on the
  device, and the list says `eth0 → Gi1/0/8` per connection. It survives the
  device going away, because edges age instead of vanishing.

- **A change notification says which cable.** A lost bundle member used to be
  announced as "link A ↔ B disappeared", which is false while the other
  members carry it. Now: *cable core Gi1/0/1 ↔ acc Te1/1/1 gone — 3 of 4 still
  up*, and when the last one dies, *the link is down*. A single line keeps the
  shorter wording.

- **The legend knows the bundle**: the `×N` line and the amber glow of a
  bundle with a dead cable, drawn with the same symbols the map uses.

### How members are matched

Both ends of one cable report it, often with labels that do not compare
("10101" on one side, "GigabitEthernet1/0/1" on the other), and LLDP and CDP
can number the same port differently. A report therefore only opens a new
member when the **same device** already reported **every** existing member
**over the same protocol** on other ports. The number of lines is exact; what
can be wrong with incomparable labels is which far-end port is paired with
which near-end port — never how many cables are drawn.

### Changed

- **The ghost filter step is called what it does.** "Network gear only" became
  "without endpoints", and when nothing can be dropped — because not one
  neighbour reports its capabilities, which is normal for CDP — the map says
  so once per session instead of leaving a step that looks broken.

- **The cluster toggle dims itself** when the map has fewer than two host
  groups, instead of silently doing nothing.

- **The upper limit for LLDP/CDP edges is 6000 instead of 8000.** It exists to
  prevent a PHP fatal — a white page mid-render — not clutter, and a member
  edge costs more than the merged one did: measured 5.9 KB against 4.6 KB,
  46 MB against 36 MB at 8000 edges. 6000 restores the headroom the number was
  chosen for. It is still far past any readable map, and when it does bite,
  the map says so.

### Fixed

- **`ifSpeed 4294967295` is not a link speed.** It is 2³²−1, the ceiling of a
  32-bit counter: a 10G port reports it and puts the truth in `ifHighSpeed`.
  The panel said "0.0 % of 4.3 Gb/s", and every utilisation percentage on such
  a link was wrong with it. The value is discarded; without `ifHighSpeed` the
  speed stays unknown rather than invented.

- **A red link meant the host, not the link.** The colour came from the ratio
  of down interfaces across both endpoints, so a switch with 17 of 31 ports
  unused but administratively up painted every one of its links red — next to
  a panel showing 0.00 errors for the actual port. The operational state of
  the port the edge hangs on now decides where it is known; the host-wide
  ratio survives only as the fallback for edges without a port mapping.

- **A port named on one side only.** One end showed `29`, the other `Port 9` —
  the reporter's raw ifIndex against the text the neighbour announces. A
  resolved neighbour port now takes that interface's own `ifName`, and a
  host's own label wins over what the far side claims about it.

- **Layout "auto" stopped reusing an arrangement that covers a third of the
  map.** With 30 hosts and 127 unmonitored neighbours, the saved positions
  covered 30 of 157 drawn nodes and the rest landed in rings around their
  reporting switch. Where ghosts outnumber hosts more than two to one, auto
  computes a fresh layout and says once why.

- **A ghost node is no longer treated as a host** in the tooltip, the detail
  panel and on its edges: no severity pill, no history request for an id that
  belongs to no host.

- **A replugged bundle member is reported as moved**, not as one cable gone
  and another arrived — and no ghost line is left next to the cable it is.

- **`nt:uplink` finds its member by port, not by spelling**: `Gi1/0/2` in the
  tag matches `GigabitEthernet1/0/2` on the edge.

- **A bundle counts a cable whose port is down**, not only one that stopped
  being reported — on the line, in the member list, and in the trunk's colour.
  The two counts used to disagree.

### Widgets

Their versions move independently of the module: **NT Topology 3.2.0** (the
cable count above), **NT Health 2.1.2**, **NT Table 2.1.2**, **NT KPI 1.0.2**
(the generated data access below). **NT Items 1.0.0** is unchanged.

**And they are not 7.4-only any more.** The note that said so came from a
test on 7.0.28 in July, where they registered but stayed on "Loading…".
Re-tested on **7.0.30** with all five on one dashboard: topology, KPI, health,
table and items render, no console errors. What changed in between is not
established — so if they do hang on a 7.0 of yours, that is worth a report
rather than a shrug.

### For contributors

- **`tools/devnet/`** — a compose stack with Zabbix 7.0, Postgres and
  **snmpsim**: simulated SNMP devices, one `.snmprec` file per device, all
  values invented. Everything interesting in this module hangs off SNMP
  values, and a bug report can be translated into a file and reproduced in
  minutes. `npm run ci:snmprec` checks the format, because snmpsim answers a
  file it does not understand with "No Such Instance" and no error at all.

- **The shared data access in the widgets is generated, not maintained.**
  `window.NtWidgetData` sat byte-identical in four widget files, because the
  jsLoader knows no ES modules and a widget cannot import the main module.
  `ci:parity` guarded the copies against each other — but a change was still
  a change in four places, and four identically wrong copies would have
  passed. The source is `tools/widget-shared.js` now, `npm run build` writes
  it into the four files, and the gate compares them against it.

- **`npm run ci:frontend`** — a gate that reads what the interface *says*,
  without a browser: detail panel, tooltip, ghost filter, layout decision,
  bundle label, notification text, legend, and the CSV export. Three bug
  reports in September 2026 lived exactly there, and no existing test went red
  for any of them, because none had ever looked at the output.

## v5.3.2 — 2026-09-23

### Updating from 5.3.1 — nothing to re-import

No action was added or renamed, so **no rescan**: replace the module directory,
`chown`, reload php-fpm. Reload the page once with a cache bypass, the bundle
changed. **No template changed** in this release. Layouts, manual links, pins,
notes and presets stay where they are.

One new host tag is available, `nt:uplink` — see *Added*. Nothing breaks if you
never set it.

### Thanks

**[@Shazral](https://github.com/Shazral)** opened
[#16](https://github.com/linuser/zabbix-network-topology/issues/16) and proved,
by walking both switches, that the thing the module blamed was not the problem.
The walk output in that report is what turned a guess into a diagnosis.

**A reporter who wrote by email** sent screenshots of a site where a ghost node
called **F8** hung off five switches, then the Latest data list that explained
it, then the vendor and firmware of every switch involved. Two of the fixes
below came out of that thread, and the second one only became obvious from the
item names in that list.

**[@bartlomiejfornalczyk](https://github.com/bartlomiejfornalczyk)** reported
[#17](https://github.com/linuser/zabbix-network-topology/issues/17) with the
exact steps, and asked for
[#18](https://github.com/linuser/zabbix-network-topology/issues/18) — which
turned into `nt:uplink`.

**[@lechu2375](https://github.com/lechu2375)** described the duplicate-address
case in [#14](https://github.com/linuser/zabbix-network-topology/issues/14). The
both fixes promised there are in this release: the duplicate address below, and
the `nt:lldp` tag above.

### Added

- **`nt:uplink=<hostname>:<port>` — say which port a silent device hangs off.**
  For everything that cannot report a neighbour: a UPS, a PDU, a printer, an
  older camera. The tag draws the edge **and** hangs the counters of that very
  port on it — traffic, errors, discards, link speed — because interface
  counters are kept per ifIndex anyway and the only thing missing was someone
  naming the port. Measured at the switch end; the silent device has nothing to
  offer.

  The port may be the ifIndex (`8`) or its name (`Gi1/0/8`,
  `GigabitEthernet1/0/8`); spellings run through the same normalisation as a
  reported neighbour port. What keeps it honest: its own match type `tag` at 45
  points, never two-sided, and the detail panel names where it came from. A
  human stated this link, no device confirmed it. If the device later starts
  reporting after all, the edge is **completed**, not drawn twice.

- **`nt:lldp=<name>` — the name a host uses on the wire.** Promised in
  [#14](https://github.com/linuser/zabbix-network-topology/issues/14). The name a
  device sends over LLDP and the name it carries in Zabbix are two different
  things: a host renamed on one side only, an inventory name against a config
  name, a device that does not know its own hostname. The neighbours then report
  something Zabbix has never heard of, and the map draws a ghost right next to
  the host it means. The tag declares the name, up to four per host, and the
  reported domain may differ from the declared one. It resolves as `alias` at 55
  points, just under an exact hit. A declared name never displaces a real one,
  and two hosts claiming the same one draw nothing and are reported as
  ambiguous.

- **Ghost nodes have three steps now: off, network gear only, all.** The
  toolbar button cycles through them. The middle one is the useful one: it keeps
  switches, routers, access points and everything that says nothing about
  itself, and drops what announces itself as a workstation or a phone. On an
  access switch with 48 ports the rest of the ghosts are desktops, and they bury
  the unmonitored switch next to them — which is what one turns ghosts on for.
  A device that reports no capabilities at all counts as unknown and stays; it
  is not a workstation just because it is quiet.

- **Neighbours that report a MAC address instead of a name now resolve.** Two
  routes, both from data already on hand: the same local port reporting the
  neighbour by name over one protocol and by MAC over another — that is one
  cable, so it is one device — and the chassis id another switch reported
  together with a name. Both refuse to guess: several open rows on one port, or
  two hosts claiming one MAC, and nothing is drawn.

### Fixed

- **Interface counters with keys that carry no MIB name were invisible**
  ([#16](https://github.com/linuser/zabbix-network-topology/issues/16)). The
  lookup required `Octets` in the item key and therefore never saw
  `net.if.in[24]` — the shape used by eight official Zabbix templates (Cisco
  Catalyst 3750V2, Nexus 9000, pfSense, OPNsense) and everything derived from
  them. The map fell back to the host totals and explained itself with
  "lldpRemLocalPortNum may not equal ifIndex", which sent the reporter off
  walking both switches to prove the one thing that was already correct. The
  hint now names both conditions. `net.if.in/out/speed/status[N]` and the errors
  and discards variants are read; the bare number in the brackets is what tells
  them from agent keys like `net.if.in[eth0]`.

- **Devices whose MAC starts with the same byte collapsed into one ghost.** A
  neighbour reported as a MAC arrived as `00 11 22 AA BB 01`, and the cleanup
  that strips vendor suffixes cut at the first space — leaving two hex digits.
  Every device sharing that byte became the same node, and the map drew a
  distribution point that does not exist, with links to switches that have
  nothing to do with each other. MAC-shaped values are now recognised, kept
  whole and normalised, so `00 11 22 …`, `00:11:22:…` and `0011.22aa.bb01` are
  one device and not three.

- **One address on several hosts produced a link to the wrong one**
  ([#14](https://github.com/linuser/zabbix-network-topology/issues/14)). The
  address map overwrote, so the last host read in won, silently. With
  192.168.1.10 in every second private network, a managed service provider got
  an edge to a foreign tenant — at 60 points of confidence and with nothing in
  the LLDP-Q tab to hint at it. Candidates are kept now: one candidate draws the
  edge as before, several draw nothing and report the address as ambiguous with
  every candidate named. A mismatched address also stops the name stages, which
  would otherwise fall through to the short name `192`.

- **A host named only with digits made the map a white page**
  ([#17](https://github.com/linuser/zabbix-network-topology/issues/17)). PHP
  turns a numeric array key into an int, and the function that strips the domain
  off a name refuses an int under PHP 8. The request died halfway through, so
  the browser got an empty body and reported `Unexpected end of JSON input`.
  Found in a test two days before the report arrived, which says something about
  what tests are for.

- **Reset and Clear in the filter did nothing visible.** Both end up on a page
  with no groups in the URL, which is exactly what the automatic restore of the
  last selection reacts to — so the old selection came straight back. Both now
  mark the selection as emptied on purpose, and the stored one is forgotten with
  it. Clear also uses the multiselect's own API instead of imitating clicks on
  its markup.

- **The cluster toggle never showed the mode you picked.** It stored the choice
  and redrew the map correctly, but label and check mark kept the state from
  when the toolbar was built. A switch that does not show the choice has not
  taken it, as far as anyone can tell.

- **Ghost nodes piled up on one spot.** When saved positions are reused, ghosts
  have none, and every one of them stayed at the origin. They also counted
  towards the threshold that decides whether the saved arrangement still
  applies, so enough of them silently replaced your own layout with a fresh
  force run. Ghosts are out of that count now, anything without a position is
  placed in a ring around the host that reports it, and the layouts finally
  account for the **label** rather than the 44-pixel circle — names three times
  wider than the node were what actually overlapped.

- **The tooltip did the same thing as the panel, one layer over.** Hovering a
  ghost showed CPU, memory and ping as empty dashes and "loading history"
  underneath — for a device Zabbix never asked, and it really did fire the
  history request. It now names the protocol it was seen over and the host that
  reported it, and says why there are no numbers. Found while taking a
  screenshot for these release notes, which is its own small argument for
  screenshots.

- **The detail panel called an unmonitored device "Normal".** A ghost node got
  the full host treatment: a green status pill and empty rows for CPU, memory
  and ping — a statement nobody made, about a device Zabbix never asked. The map
  itself had always known better and drew no severity ring. The panel now says
  *not monitored* and shows what is actually known: which protocol saw it, which
  hosts reported it, its MAC, its capabilities and its vendor string. Those last
  three were already collected and reached the context menu, but never this
  panel.

- **A link measured at one end only fell back to the estimate.** If the first
  endpoint carried an entry with just speed or errors, the other end's real
  counters were ignored. The end with counters wins now.

## v5.3.1 — 2026-09-10

### Updating from 5.3 — one template to re-import

No action was added or renamed, so **no rescan**: replacing the module
directory, `chown`, and a php-fpm reload is the procedure. Reload the page once
with a cache bypass — the bundle changed. Layouts, manual links, pins, notes and
presets stay where they are.

**One shipped template changed: `nt_lldp_snmp`.** Re-import
`templates/nt_lldp_snmp_template.yaml` with *Update existing* ticked for
discovery rules and item prototypes. That is what makes TP-Link JetStream
switches report their neighbours (see below); on every other device it changes
nothing. `nt_health_score` and `nt_topology_change` are unchanged.

**UniFi: one item you add yourself.** Only relevant if you monitor UniFi through
the official *UniFi Network API* templates. Their *Client* template carries
`uplink.id`, their *Device* template does not — so clients hang on their
switches, while switches, access points and the gateway float unconnected. Add
a dependent item `uplink.id` on the master item `details.json`, with JSONPath
`$.uplink.deviceId` — nested for devices, unlike the flat field on clients. See
the UniFi row in [LLDP-SETUP.md](docs/LLDP-SETUP.md). Until this release, UniFi
edges could not appear at all; see the second entry under *Fixed*.

### Thanks

**[@lechu2375](https://github.com/lechu2375)** opened
[#15](https://github.com/linuser/zabbix-network-topology/issues/15) with the
cause, the raw walk that proves it, a fix for both layers, and the observation
that fixing only the first layer would leave every item empty — tested on two
switches before he sent it. The fix in this release is his, verified against
both index shapes and adopted unchanged. His
[#14](https://github.com/linuser/zabbix-network-topology/issues/14), on
neighbour matching across tenants, is still open.

### Added

- **The confidence score now sanity-checks round-trip times, and MNDP counts
  as its own source.** Both suggested on r/zabbix by someone building a
  comparable tool, who scores on LLDP, MNDP, CDP, FIB *and* latency. The
  observation that landed: our score only ever judged **how the name was
  matched**. It was blind to a match that is physically impossible — an exact
  name hit scored 60 even for a device demonstrably behind a WAN link.

  An edge whose two endpoints differ wildly in ping time now loses points.
  Deliberately blunt: the threshold is **100 ms**, not 20. Our only latency
  figure is `icmppingsec`, measured from the server or proxy to the host and
  not between the neighbours, so only the *difference* means anything — and
  LLDP edges mostly join switches, which are notorious for answering ICMP
  slowly because their CPU deprioritises it. A loaded switch can show tens of
  milliseconds while being directly attached. A wrongly demoted edge does the
  same damage as a wrongly promoted one, so the check only fires where
  ICMP deprioritisation can no longer explain the gap. It never awards points:
  similar latency proves nothing about adjacency. And it stays silent when the
  two hosts sit behind different proxies, or when either is monitored through a
  proxy group — the numbers are not comparable then.

  Separately, MikroTik's **MNDP** arrived through the generic
  `discovery.neighbor` path and was scored as "other", i.e. worth nothing —
  although it makes the same statement CDP does. A key containing `mndp` is
  now its own source and carries the same weight.

### Fixed

- **LLDP discovery produced no items on TP-Link JetStream switches**
  ([#15](https://github.com/linuser/zabbix-network-topology/issues/15)).
  LLDP-MIB defines the neighbour index as `TimeMark.LocalPort.RemIndex`;
  TP-Link JetStream (tested: T2600G-28TS, HW v4) omits the TimeMark and answers
  `25.1` instead of `1234.25.1`. The discovery script and all six item
  prototypes required three parts, so every row was dropped — silently,
  because *Discard value* raises no error anywhere. Fixing only the discovery
  would not have been enough: it would have created the items, and the
  prototypes would have left every one of them empty. The TimeMark is now
  optional in both places; devices that do send one are unaffected. Needs the
  template re-import described above. The template's logic is under test from
  now on.

- **UniFi edges could never appear.** The module fetches items by key, and
  `uplink.id` was missing from the list — so the UniFi support described in
  LLDP-SETUP.md never received a single value. Fetching it needed two more
  changes to be safe. `uplink.id` no longer counts as evidence that a host is a
  network device: it does not say "whom do I see" like a neighbour table, it
  says "what do I hang on" — which every phone, camera and TV stick behind a
  controller reports, and each of them would have been drawn as a switch. And
  device classification now also consults a host's visible name and host
  groups, because discovery-created hosts are named by UUID and share one
  template name, so hostname and template say nothing. That look comes last —
  only after template, LLDP capabilities and the neighbour table have all come
  up empty — so no host recognised correctly today changes. The hop view
  queried a shorter list of its own that lacked `uplink.id` and MNDP, so around
  a UniFi switch it showed the switch alone; both queries share one list now.

- **The port names announced in 5.3.0 never appeared.** Same cause: `ifName`,
  `ifDescr` and `ifAlias` were never fetched, so port labels and port names in
  the edge panel stayed empty on every installation — while the 5.3.0 notes
  explained where their data comes from. They are fetched now.

- **`nt-install.sh` refused to install on Apache with mod_php.**
  ([#13](https://github.com/linuser/zabbix-network-topology/issues/13)) The
  script looked for a PHP-FPM service and nothing else. With mod_php there is
  no FPM service — PHP runs inside the Apache workers — so it aborted with
  "kein php-fpm-Service gefunden" **before copying a single file**, on a
  perfectly valid host. Not an exotic setup either: it is what the
  distribution's `zabbix-frontend-php` package gives you, since it pulls in
  `libapache2-mod-php` rather than FPM.

  Detection now falls back to `apache2` and `httpd`, and FPM still wins when
  both exist — with Apache *and* FPM, PHP runs in FPM and reloading Apache
  would not clear the opcache. More importantly, a missing service is no
  longer fatal at all: the files are copied either way, and the script says to
  reload PHP by hand. Refusing to install because we cannot clear a cache was
  the wrong trade. `nt-uninstall.sh` carried the same detection and got the
  same fix.

- **The items table disappeared on very large counter values.** Values beyond
  PHP's integer range are passed on as strings to keep their precision, and
  formatting then called a number method on a string. The exception was thrown
  mid-render — not one empty cell but no table at all — for items without a
  unit, and for `%` and `ms`.

- **Two characters in the item search gave a count above an empty table.** The
  counter accepted two, the query it counts for required three. Both share one
  limit now, and the frontend follows it. The hint next to the counter was also
  in German; it is English now.

- **A red "down" count on links that were perfectly fine.** Reported on
  r/zabbix: a red arrow with a number on some switch-to-switch links, while
  every port on those switches was up. The reporter was right and the number
  was wrong — it was the *raw* count of interfaces in `down` state, summed over
  **both** endpoint hosts, all of their interfaces. A 48-port switch with
  twenty unpatched sockets reports twenty down, and that appeared on every link
  touching it. People went looking for a fault and found empty sockets.

  The edge *color* had used the down **ratio** for exactly this reason — a raw
  count would paint every edge on any real switch red. Only the tooltip kept
  showing the raw number: one quantity, two representations, and the
  misleading one in front. The tooltip now shows the same ratio the color uses,
  and the row says which hosts it refers to. Exact per-port numbers have been
  in the edge panel since 5.3.

- **Cluster mode discarded saved node positions without saying so.** Also from
  r/zabbix: "every refresh throws my map back into an unreadable design." From
  two host groups up, cluster mode switches itself on, lays out its own grid
  and ignores stored positions. That behaviour is deliberate — otherwise you
  could never see columns again after saving once — but it was silent, so
  people who arranged their map by hand watched it fall apart and assumed they
  had done something wrong. The reporter had lived with it for weeks before
  asking.

  It now says so once per session, and names the way out: *Layout → Cluster:
  off*. Only when there are saved positions to lose.

- **Positions arranged in the hop view were lost on reload.** The server
  checked view names against a pattern that did not cover the hop view's
  format, skipped the whole view and still answered "ok". Every hop-view
  arrangement since the feature exists was discarded without a warning.

- **A host's only Disaster could be missing from its problem list.** Problems
  were capped at 20 per host *before* sorting by severity, while Zabbix returns
  them newest first. Twenty recent warnings and an older Disaster meant twenty
  warnings in the panel — and a red icon on the node.

- **Memory never showed for SNMP hosts.** The storage type is an OID, and it
  was read after a numeric cast that turned `1.3.6.1.2.1.25.2.1.2` into `1.3`.
  RAM was never recognised, so the node showed "—" even with used and total
  present.

- **Multi-core CPU load was halved instead of averaged.** Each further core
  was folded in as `(old + new) / 2`. An eight-core host with one busy core
  reported 0.6 % instead of 10 %, and the result depended on item order.

- **Synology showed 99 % CPU permanently.** A fixed factor assumed the idle
  value comes in hundredths of a percent, although the MIB defines it as plain
  percent — so every standard device read as saturated. Percent is the default
  now; a value above 100 can only be hundredths and is scaled back. One limit
  remains for templates that do scale to hundredths: below 1 % idle, i.e. at
  99 % load and more, their values look like percent.

- **A host named `backups01` was drawn as a UPS.** The keyword matched `ups`
  anywhere in a name, so `backups`, `workgroups` and `setups` all qualified —
  and the German `usv` matched inside `busverbindung`. Both now have to start a
  word.

- **The tooltip sparkline disagreed with the map.** It chose its bit factor by
  a different rule than the map, so for the common `net.if.in[ifHC…]` keys it
  read eight times the edge label; error and discard counters were plotted as
  traffic; and the history query returned the *oldest* rows of the window, so
  "the last hour" could end half an hour ago.

- **Reports counted host groups as hosts.** With Group View on, "Hosts total"
  was the number of groups and rows averaged CPU across a whole group; with
  ghost nodes on, reports listed devices Zabbix does not monitor. Reports now
  read the hosts, not the rendered map.

- **A late refresh could draw the map over the Table tab.** Switching tabs while
  an expensive response was in flight left the map painted on top of the table,
  with the Table tab still highlighted.

- **The items view hung on its spinner in hop mode.** With a single host
  selected there is no host group to query, and the view gave up without
  replacing the loading placeholder. It now says what is missing.

- **Wallboards grew in memory over time.** Toolbar handlers were added on every
  render and never removed, some of them holding on to entire graphs that had
  already been destroyed; the layout menu added one document listener per
  rebuild — about 120 an hour on a wallboard.

- **A host that named itself as its neighbour got a loop edge**, and the
  "self" column in the LLDP-Q tab read zero on every installation. The guard
  compared an integer with a string.

- **The port scan reported every IPv6 host as closed.** The address was built
  without brackets, which leaves an IPv6 literal ambiguous.

- **Severity was carried by color alone.** The ring around a node encoded its
  worst problem purely as a hue. Converted to greyscale, four of the six levels
  land almost on top of each other — Normal 0.41, Info 0.38, Warning 0.44,
  Average 0.33. Only High (0.23) and Disaster (0.08) stand apart, which is to
  say: exactly the two where everything is flashing anyway. For anyone who does
  not separate red from green, two thirds of the scale read the same.

  The ring now carries the level in two channels that work without color.
  **Width** rises monotonically across all six levels — which is what you want
  regardless, since a worse state should carry more visual weight. And
  **notches**: from Warning up, the ring gets `severity - 1` gaps, so one at
  Warning through four at Disaster. Counting is unambiguous even with no color
  vision at all. Normal and Info stay unbroken, so a calm map still looks calm
  and a gap actually means something.

  Offline overrides both: it keeps its long dash, because it makes a different
  statement — the severity is frozen, not current — and two dash patterns on
  one ring stop being readable.

  The color guide was showing a filled dot per level, i.e. only the channel
  that fails. It now draws the ring as the map draws it; a legend that shows a
  different shape than the map teaches nothing.

- **Two data endpoints were not rate-limited** — the health history and the
  diagnostics endpoint, the only two of eighteen without it.

## v5.3.0 — 2026-09-04

### Updating from 5.2 — nothing to do

No migration, and this time **not even a rescan**: no action was added or
renamed, so replacing the module directory, `chown`, and a php-fpm reload is
the whole procedure. Map layouts, manual links, pins, notes and presets stay
where they are.

Two things to know afterwards. **Reload once with a cache bypass** — the
bundle changed substantially, and a plain reload may still serve the cached
one. And **the map now follows your Zabbix theme**: if your profile is set to
a dark theme, it renders dark from the first load. There is no switch; that is
the point.

**No template update either.** All three shipped templates — `nt_lldp_snmp`,
`nt_health_score`, `nt_topology_change` — are unchanged since 5.1.1, and none
was added.

What is worth knowing is where the *new* port-level features get their data.
Port names, errors and discards at the port, and link utilization read
`ifName` / `ifDescr` / `ifAlias`, `ifInErrors` / `ifOutDiscards` and
`ifHighSpeed` — and those do **not** come from the LLDP template, which only
walks the LLDP remote-systems table. They come from the ordinary interface
monitoring on the same host, i.e. Zabbix's own *Network interfaces by SNMP*
discovery or a vendor template. A host that carries only the NT LLDP template
still produces edges; they simply have no port names and no per-port numbers.
See [LLDP-SETUP.md](docs/LLDP-SETUP.md), "Optional, but worth having: real port
names".

### Thanks

The theming work in this release is
**[@christos-diamantis](https://github.com/christos-diamantis)**' — the design
as much as the code. He opened
[#11](https://github.com/linuser/zabbix-network-topology/issues/11) with five
separate defects, screenshots for each, and the observation that made the
whole thing tractable: the modules had no shared palette, so every one of them
carried its own light-only colors.
[PR #12](https://github.com/linuser/zabbix-network-topology/pull/12) is the
answer to that, and it is the foundation of what shipped here.

Two of his findings would not have occurred to me. The node icons are SVG
serialized into a data URI and handed to Cytoscape as an image, so no CSS
variable can ever reach them — and the image cache has to key on the theme, or
it keeps serving the other one after a switch. And the tooltip was broken in
*light* mode: setting no text color of its own, it inherited the Zabbix body
color, which in the Zabbix dark theme is near-white on a white tooltip.

What was added on top: the tokens were extended to the modules his PR did not
touch (three of them did not exist yet when he wrote it), and the light/dark
decision now measures the page's background instead of recognizing a theme
name — because Zabbix 8.0 adds a dark theme no name list written today would
contain.

### Added

- **Click an edge for its own detail panel.** Ports on both ends, link
  utilization against the negotiated speed, errors and discards *at the port*
  rather than as a host total, which protocol reported the link, and how
  confident the match is.

- **The computed path is now a list, not only a highlight.** Between two hosts
  the map has always colored the route; on a large map with seven hops you had
  to trace a cyan chain through a hundred dimmed nodes, and a color cannot be
  pasted into a ticket. The list names every hop with its ports in walking
  direction, its utilization, and a warning where the link reports down ports,
  errors or discards.

- **Every LLDP/CDP edge says how certain it is.** A neighbour name is matched
  against Zabbix hosts by several routes — exact name, IP, normalized port,
  short name — and these are not equally trustworthy. The edge now carries the
  match type and a score, so a guess no longer looks like a measurement.

- **Two-sided links are told apart from one-sided ones.** If both ends report
  each other, that is a confirmation; if only one does, the other end may be
  mute, misconfigured, or not monitored at all.

- **Edges age instead of vanishing.** A neighbour that stops being reported is
  marked stale for a while rather than disappearing between two refreshes, and
  the difference to the previous state is shown on the map: new links are
  highlighted, moved cables are reported.

- **Port names instead of bare indices.** Where `ifName`/`ifDescr`/`ifAlias`
  is available the local port is labelled with it. Normalization ("Gi1/0/1" vs
  "GigabitEthernet1/0/1") also matches the far side, which brings measurements
  to links that previously had none — with its own match type, so the extra
  reach stays visible in the confidence score.

- **GraphML export** for draw.io and yEd, and a **device report** that
  summarizes the LLDP/CDP landscape as counts — no host names, IP addresses,
  neighbour names or community strings, so it can be pasted into an issue.

### Fixed

- **Very large maps switch to the group view by themselves.** With the item
  fetching fixed, the backend now copes with 5,000 hosts — which makes the
  browser the next wall. The performance mode already simplifies nodes from
  400 up, but past roughly a thousand that stops helping: a force layout over
  that many nodes takes seconds, and nobody can read the result anyway. Above
  1,200 nodes the map therefore aggregates by host group unless you have
  explicitly chosen otherwise, and says so once. Right-click → leave group
  view still shows every host — an automatic choice that cannot be overridden
  would be a nuisance, not a help.

- **Large host groups ran the frontend out of memory before drawing anything.**
  All metric items were fetched in a single unbounded API call. A row from
  the item API costs about 570 bytes — measured, not estimated: 200,000 items
  are 109 MB, and 5,000 switch-like hosts with 24 ports produce 840,000 of
  them, or 457 MB, in a frontend Zabbix asks to run in 128 MB. The page died
  before a single edge existed, with no message.

  Items are now fetched **in chunks of 150 hosts** and reduced immediately, so
  only one chunk is ever held raw while the result grows condensed. For 5,000
  hosts with 24 ports each that is 566 MB down to 90 MB at unchanged runtime;
  a more typical group of 5,000 servers with two interfaces each needs 22 MB.
  Chunking is by *host*, never by item — a host's items must stay together for
  the partial results to merge without loss, and there is a test for exactly
  that.

- **A very large topology crashed the page instead of saying so.** Building
  the LLDP/CDP edges costs about 5.2 KB of peak memory per edge — measured,
  not estimated: 9,600 edges take 50 MB, 19,200 take 99 MB. Zabbix asks for a
  128 MB frontend, and the host and item lists already sit in that same
  process. Past roughly 20,000 edges PHP aborted with "Allowed memory size
  exhausted", which reaches the user as a white page with no message at all.
  There is now an upper limit of 8,000 edges (~41 MB), and hitting it is
  reported: the map says how many links it did not draw. The limit is
  deliberately far beyond a readable map — it should never trigger, and if it
  does, it replaces a crash with a sentence.

- **A URL parameter could hang the map for good.** `NT_CONFIG` was written
  into the page with `json_encode()` but without `JSON_INVALID_UTF8_SUBSTITUTE`.
  On invalid UTF-8 the function returns `false`, so the page contained the
  literal `window.NT_CONFIG = ;` — a syntax error that killed the whole script
  block, including the URL fallback meant for exactly the case of a missing
  `NT_CONFIG`. The page rendered, the toolbar appeared, and the map hung on
  "Loading topology..." forever. Reachable from the address bar, since the
  `internet` parameter is free text and Zabbix's `string` validator does not
  check encoding. Not an information leak — `JSON_HEX_TAG` holds — but a
  denial of service by link.

- **What-if simulation answered a different question than the one asked.**
  Simulating the only router reported "0 hosts cut off": the reference set
  became empty and a surviving switch was picked instead, from which the rest
  of the switch landscape is of course still reachable. It also walked
  *hosting* relationships as if they were cables, so a guest VM could give its
  own hypervisor connectivity. The banner now also names the hosts it cannot
  assess at all and those that survive only through a manually drawn link.

- **Maintenance was drawn as an ✕** — the same glyph as offline, only orange
  instead of red. It is a wrench now, and the legend shows the dashed ring the
  map actually draws.


- **Dark mode was unreadable in the places that matter — and the light map
  was not safe either.** The hover tooltip, the detail panel, the context menu
  and the dropdown menus wrote their colors inline as fixed *light-palette*
  hex values. In dark mode that put slate-grey text on a near-black panel; and
  the tooltip, which never set a text color at all, inherited it from the
  Zabbix body — in the Zabbix dark theme almost white on the white tooltip, so
  CPU, memory and traffic values were invisible even with the map in light
  mode. All of these now read from one set of color tokens (`--nt-*` in
  `network-topology.css`) with a light and a dark value; body-attached
  elements (tooltip, context menu) carry the tokens via `.nt-float`.
  Contributed by **@christos-diamantis**

- **Node quadrants and icons on the dark canvas.** The device glyph was drawn
  in dark slate (`#475569`), the quadrant separators in white — on the dark
  canvas the glyph disappeared and the white lines were the loudest thing on
  the node. The icon now draws for the theme: light glyph, dark separators,
  the empty quadrants tinted a bit stronger so the four fields stay readable.
  The image cache keys on the theme. Edges on the dark canvas get a little
  more opacity.
  Contributed by **@christos-diamantis**

- **The host-group filter turned navy in dark mode.** A
  `body:has(#nt-root.nt-dark)` rule recolored the Zabbix filter form and its
  multiselect to `#0f172a`/`#1e293b` — in the Zabbix dark theme, which draws
  its inputs dark already, a blue foreign body above the map. The rule is
  gone; the filter is Zabbix UI and follows the Zabbix theme.
  Contributed by **@christos-diamantis**

- **The detail panel covered the color guide.** Both sat in the bottom-left
  corner. While the panel is open the guide moves to its right.
  Contributed by **@christos-diamantis**

### Changed

- **The map follows the Zabbix theme.** 5.2.0 removed the dark-mode toggle
  because it never survived a reload. The `nt-dark` styling it used to switch
  is now driven by the Zabbix theme instead. No setting, nothing to remember —
  the map matches the frontend around it.

  It decides by *measuring*, not by guessing: the module reads the page's
  actual background color and computes its WCAG relative luminance. A theme
  name would have been the obvious route and the wrong one — Zabbix 8.0 adds
  another dark theme (ZBXNEXT-10657, "Dark blue theme") that no list written
  today would contain, and a site shipping its own theme CSS can call it
  anything while still being black. The stylesheet filename is kept only as a
  fallback for when nothing can be measured.

## v5.2.0 — 2026-09-02

### Updating from 5.1 — nothing to do

No migration. Everything new here is client logic, documentation, or additive
on the server: no changed field, no data to move, no re-enabling. Map layouts,
manual links, pins, notes and presets all stay where they are.

5.2 does add one action, `network.topology.scales`, and 5.1.0 made a point of
"Scan directory" for exactly that reason. Measured on Zabbix 7.4 for this
release: the action answered immediately after a plain file swap, with no
rescan and no service restart — the module directory was replaced and the very
next request routed it. If *View → Color scales* nevertheless reports an
unknown action on your installation, *Administration → General → Modules →
Scan directory* settles it.

Coming from **4.x**? The directory rename is described under v5.0.0 further
down.

### Thanks

Most of what is listed below comes from
**[@christos-diamantis](https://github.com/christos-diamantis)**. He runs the
module against real networks — FortiGate, MikroTik, Huawei, campus links on
10G — and he does not stop at the report: for every issue he opened in this
cycle he also sent the patch. The host + hop-radius scope and focus mode
([#6](https://github.com/linuser/zabbix-network-topology/issues/6),
[#7](https://github.com/linuser/zabbix-network-topology/issues/7),
[PR #8](https://github.com/linuser/zabbix-network-topology/pull/8)) and the
mode-aware color guide with configurable scales
([#9](https://github.com/linuser/zabbix-network-topology/issues/9),
[PR #10](https://github.com/linuser/zabbix-network-topology/pull/10)) are his
work, tested on his own hardware and rebased on request without complaint.

This follows 5.1.1, where his FortiGate and MikroTik findings
([#3](https://github.com/linuser/zabbix-network-topology/issues/3),
[#4](https://github.com/linuser/zabbix-network-topology/issues/4)) moved the
LLDP template to `walk[]` plus dependent items
([PR #5](https://github.com/linuser/zabbix-network-topology/pull/5)) and turned
two rows of the vendor matrix from claims into measurements.

Two of the defects he found had been in the module since the code was written,
and no amount of re-reading would have surfaced them: the blank map on a
multi-group selection was reproducible for anyone with two host groups, and the
color guide had been explaining the wrong scale in the default mode all along.
Both needed someone to look at a real network and take the trouble to say so.

Thank you.

### Added

- **A single host plus a hop radius as its own map scope — next to the
  host groups.** In large environments the full map is unreadable, and the
  question is rarely "show me group X" but "show me this core switch and
  what hangs off it". The filter now additionally takes one host plus a
  hop count (1–6); a selected host wins over the group selection, which
  stays untouched. The backend resolves the neighbourhood FIRST — a cheap
  discovery pass fetches only host names/IPs/tags and the neighbour-name
  items across everything the user is allowed to see, a depth-limited BFS
  (`topology/HopScope.php`, tested) walks that graph, and only the
  resulting subset goes through the expensive enrichment. LLDP/CDP,
  `nt:parent` and manual edges all count as hops; the edge graph is cached
  per user for 60 s. Host views get their own cache and view keys
  (`host<id>_h<n>`), so they can never overwrite the stored arrangements
  of the group views.

- **Focus mode on the loaded map.** Right-click a host → "Focus: 1/2/3
  hops" filters the already-loaded data BEFORE the Cytoscape build —
  banner with ±hop and exit, ESC joins the existing mode chain.
  Deliberately ephemeral: while the focus is active, positions and pins
  are NOT saved — both layers persist the complete state per view, and a
  save from the subset would throw away the arrangement of every other
  host. "Open hop view" in the context menu leads from the focus into the
  server-side scoped view.

  Contributed by **@christos-diamantis**
  ([PR #8](https://github.com/linuser/zabbix-network-topology/pull/8)).

- **Configurable color scales (Super admin).** *View → Color scales* opens an
  editor for both edge scales — thresholds and colors per tier, add/remove
  tiers, live preview in the map, "Reset to defaults". Stored in
  `module.config` (new action `network.topology.scales`, CSRF-protected, Super
  admins only), applies to all users; a hand-edited entry in the DB falls back
  to the defaults when invalid. `ColorScales::sanitize()` has its own test —
  colors end up as CSS values in Cytoscape styles and the legend, hence strict
  six-digit hex.

  Contributed by **@christos-diamantis**
  ([PR #10](https://github.com/linuser/zabbix-network-topology/pull/10)), who
  asked for exactly this in the "Expected" part of his report: a 10G campus link
  should not be red at 10 Mb/s.

- **The map speaks the same search language as the table.** Until now the map
  had a plain `indexOf` over the display name while the table next to it
  understood fields, negation, quotes and parentheses — the same question,
  answered differently depending on which tab you were on. `query.js` was
  already there; the map now uses it:

      192.0.2.43              a bare word matches name and IP
      type:switch             field search (host, label, ip, iftype, proxy, group)
      -type:server            negation
      group:"core sites"      quoted values
      (host:fw OR host:core)  parentheses

  Non-matching nodes are dimmed rather than removed, so the shape of the
  topology stays readable while you search.

- **The active tab is part of the link.** `?nt_tab=geo` opens the geo view
  directly; switching tabs rewrites the URL through `replaceState`, so the
  address bar always describes what is on screen. Together with the host group
  parameters, a link now carries the whole view — the thing you paste into a
  ticket.

  Both the URL parameter and the remembered tab in `localStorage` are checked
  against the tabs the user is actually allowed to see; see the corresponding
  entry under *Fixed*.

- **Save the layout as a file.** *Export → Layout (JSON)* writes the current
  arrangement, pins, notes and manual links to a file. Presets already collect
  the same state, but they live in `localStorage`: no second browser, no second
  machine, and certainly no way from one Zabbix installation to the next. The
  export closes that gap — it only reads and cannot break anything.

  There is deliberately **no import counterpart yet**. It was built and taken
  out again, because the apply path is written for complete states from the
  running map while a file is an arbitrary partial one; a shared map would need
  a decision first — replace or merge. The head of `layout-file.js` states what
  has to be settled before it comes back.


### Changed

- **Documentation leads with English.** `INSTALL.md` and `SECURITY.md` now put
  the English section first, as the README already did — and this changelog is
  English throughout, all eight releases of it. It was the last piece of
  user-facing documentation still written in German only, linked from the
  README, from INSTALL and from every release. Comments in the code stay
  German; that is a deliberate choice and `ci:i18n` only reads string literals.

  Two code quotations stay German on purpose: `_('Auswahl leeren')` and
  "1 Gruppen" are the defects the surrounding paragraphs are about, and
  translating them would hide what went wrong.

### Removed

- **The dark mode toggle.** It produced a second set of colours that nobody
  maintained: the severity palette, the group hulls and the legend each drifted
  from the light version, and several views never followed the switch at all.
  Rather than fix a mode that was half-built, the button is gone. The remaining
  branches on `nt-dark` in the render modules do nothing and will follow.

### Fixed

- **Blank map as soon as the selection spans two or more primary groups.**
  The bundled Cytoscape miscomputes `cose` with a `boundingBox` and
  silently writes `y = null` into every node position — nodes without
  coordinates render nowhere, while the KPI row keeps counting merrily.
  Reproduced deterministically with a 4-node group; the hop view merely
  made the bug visible, it hit every multi-group selection. Cose now runs
  UNBOUNDED per cluster, `fitNodesIntoBox()` scales the result into the
  box (grid fallback for anything left without finite coordinates), the
  cluster guards fall back to a real whole-graph layout instead of
  fitting unpositioned nodes, and the cluster preset seeds a
  deterministic scatter — no layout failure can make the map invisible
  any more.

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


- **Concurrent-edit detection had never once fired.** 5.1.0 introduced it —
  server side, client side, a test, an error message in two languages — and it
  was inert from the day it shipped: the page never put the revisions into the
  DOM, so `storage.js` sent an empty `base`, and `Revision::matches('')`
  returns `true` by design (the escape hatch for old clients). Every write was
  therefore accepted. Two tabs of the same user overwrote each other exactly as
  before, and the release notes said the opposite.

- **On a conflict the server's answer was thrown away.** The server rejects the
  write and sends its current state along — the comment in
  `NetworkTopologyLinks.php` even says why: "the client can start over from
  this". The client took only the revision and dropped the rest, with two
  consequences. The map kept showing the rejected arrangement while the message
  said "not saved", so the user had to believe it against their own screen. And
  because the revision *was* adopted, the next save matched again and pushed
  the stale local state over the other person's work — the detection did not
  prevent the overwrite, it deferred it by one save.

  For positions that reaches further than the visible view, because every write
  sends **all** views: edit view "4" and you still ship view "7" in the state
  you loaded. A second super admin working there loses their change on your
  next save. `storage.js` now adopts what the server sent, and the map is moved
  back onto it — a nudge, not a re-render, because a render would save again
  through `layoutstop`. Pinned nodes are briefly unlocked: measured against the
  bundled Cytoscape, `position()` does not move a locked node.

  Verified with two tabs on a live instance: tab B, which never knew about tab
  A's arrangement, snapped onto it; the server was unchanged; and the next save
  from B kept A's four nodes and added only its own.

- **Two saves in quick succession produced a conflict out of nothing.** Both
  write paths built their request body before sending, so two saves inside one
  response time carried the same base revision — the second was rejected
  although nobody else had done anything. Two clicks on *Fit* were enough. The
  requests are now serialised per layer and read base and payload at send time.

  The *Fit* button also no longer saves at all. It carried a `savePositions()`
  with the comment "save again to be safe", and it could not save anything:
  `fit()` changes zoom and pan and does not touch node positions — measured
  against the library rather than assumed. What it did was one pointless round
  trip per click.

- **A preset could delete the stored map.** There are two ways into the
  position layer — read from the map, or handed over ready-made — and they
  carried the two-layer logic separately. The second had drifted: no
  `internet_*` filter, no rounding, and no guard against an arrangement in
  which everything sits at the origin. That last one is the one that bites: such
  a preset overwrote real saved positions. Both paths now share one function.

- **`proxy:` always produced an empty map.** `NodeBuilder` supplies
  `proxy_name` and `proxy_group_name` with every host, but the Cytoscape node
  was built from a fixed selection of fields that did not include them. The
  search compared against a single space, matched nothing, and dimmed every
  host — no error, no message, an empty map, while the same query worked in the
  table. The same omission left the detail panel's "via &lt;proxy&gt;" line
  permanently blank.

  The placeholder was corrected in the same breath: it promised "Search name,
  IP, type", but a bare word deliberately matches name and IP only. Anyone
  typing `switch` got an empty map for a second reason.

- **The tab URL parameter bypassed the permission check.** `?nt_tab=diag`
  opened a view for which the user had no button, and `switchTab` additionally
  wrote it into their `localStorage` — so every later visit landed there again.
  The server refused the data, so nothing leaked; what broke was usability, and
  it had no way out. `tabs.js` now holds one list for the buttons, the
  permissions and the URL check, and the remembered tab is validated as well.

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
