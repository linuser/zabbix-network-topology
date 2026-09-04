# LLDP/CDP topology setup — Network Topology for Zabbix

How the module turns LLDP/CDP data into **edges**, and what you have to configure
on switches, on clients and in Zabbix.

**🇬🇧 English · 🇩🇪 [Deutsch](LLDP-SETUP.de.md)**

> **Seeing nodes but no edges?** The answer is almost always in here — usually
> missing LLDP, missing SNMP, or a name mismatch. The **LLDP-Q tab** in the module
> reports per host where it breaks (see [Troubleshooting](#why-are-edges-missing-troubleshooting)).

---

## How edges come to exist (the mental model)

For each Zabbix host, the module reads an item whose **value is the neighbour system
name(s)** — the device's LLDP/CDP neighbour table. For every neighbour reported, it
tries to resolve that name to **another Zabbix host**. When that succeeds, an edge
is drawn.

> **Edge A–B = "A's neighbour table names B — and B is a monitored host with a
> matching name."**

Two consequences worth knowing:

- **Both endpoints must be monitored Zabbix hosts.** A neighbour that isn't in
  Zabbix produces no edge.
- **The reporter needs a queryable neighbour table.** A device that only *sends*
  LLDP but doesn't keep the neighbour table, or doesn't expose it over SNMP,
  **reports no neighbours itself** → no edges originate from it. It only appears
  when its neighbours report *it*.

---

## Which items the module reads

An item is recognised when its **key** contains one of these (value = neighbour
SysName; a comma-, newline- or pipe-separated list of several neighbours is fine):

| Key contains | Source |
|---|---|
| `lldpRemSysName` | **LLDP** (IEEE 802.1AB) — SNMP standard, OID `1.0.8802.1.1.2.1.4.1.1.9` |
| `cdpCacheDeviceId` | **CDP** (Cisco Discovery Protocol) — SNMP |
| `neighbor.sysName` | Generic / Ubiquiti UniFi (e.g. via controller API) |
| `discovery.neighbor` | MikroTik and others / custom |
| `uplink.id` (exact key) | **UniFi Network API** — controller's view, see below |

The value is split on `,`, newline and `|` — so a single item may carry the whole
list of neighbours.

> **Special case UniFi (`uplink.id`):** Ubiquiti generally does **not** expose the
> LLDP neighbour table over SNMP — only the controller knows the topology. The
> official *UniFi Network API* template pulls it via JSONPath `$.uplinkDeviceId`
> from `details.json` into an item `uplink.id` ("which device am I attached to").
> Its value is the **device UUID** of the uplink — and because the same template
> names its hosts after exactly that UUID, ordinary name matching resolves it to
> the right host. The source shows up in the LLDP-Q tab as `unifi`.
>
> Two limitations to know: it is the **controller's view**, not a device protocol
> (if the controller goes down, the topology goes stale). And it only works while
> hosts are **named after the UUID** — if your discovery names them differently,
> matching won't hit. `uplink.rx` / `uplink.tx` (per-link traffic) are currently
> **not** evaluated by the module.

### Optional, but worth having: real port names

If a host also has one of these per interface, the map labels the **local** port
with its name instead of the bare index:

| Key contains | Used as |
|---|---|
| `ifName` | first choice — `Gi1/0/24` |
| `ifDescr` | second choice |
| `ifAlias` | third choice — often the patch-panel label someone typed in |

Nothing breaks without them; the port is then simply called `24`. Two things
they do buy you:

- **A moved cable becomes readable.** The module compares ports by `ifIndex`,
  which is stable, but it *shows* you the name — "Gi1/0/24 → Gi1/0/7" says more
  than "24 → 7".
- **The far side gets measurements.** Port names are normalized (`Gi1/0/1` ↔
  `GigabitEthernet1/0/1`), and that match brings traffic, errors and discards to
  links that otherwise only had the reporting end's numbers. The edge panel marks
  such a link as measured at the port rather than estimated from host totals.

Note that `ifAlias` is free text from the device — it is truncated for display
and, like every neighbour string, never trusted.

---

## What you have to do

### 1. On switches / routers / firewalls
- **Enable LLDP** (`lldp run` globally, plus per interface where needed). Cisco:
  **CDP is on by default**.
- **Enable SNMP** (v2c/v3) so Zabbix can read the LLDP-MIB (`lldpRemSysName`) or
  the CDP-MIB.

### 2. On clients / servers
- **Install `lldpd`** (`apt install lldpd` / `pkg install lldpd`). The server then
  announces itself → the switch lists it **by name** instead of just a MAC, and the
  switch↔server edge appears.
- **Hostname = Zabbix host name.** The announced SysName has to match the Zabbix
  host (see below).
- **Windows** usually doesn't send LLDP on its own → there the switch side plus
  name/IP matching does the work.

### 3. In Zabbix
- **SNMP LLD** on the switch: discover the `lldpRemSysName` table → item prototype
  `lldpRemSysName[{#SNMPINDEX}]` (one item per neighbour). Many **vendor templates
  already ship this** — check *Latest data* for `lldpRemSysName` items first.
- **Turnkey:** import [`nt_lldp_snmp_template.yaml`](https://raw.githubusercontent.com/linuser/zabbix-network-topology/main/templates/nt_lldp_snmp_template.yaml)
  and link it to SNMP switches — it brings LLDP **and** Cisco CDP discovery ready to
  go (macros `{$NT.LLDP.INTERVAL}` / `{$NT.LLDP.DISCOVERY.INTERVAL}`).

  It is **not** in the module ZIP: the module directory is publicly reachable
  through the web root, and only runtime code belongs there. Fetch it directly:

  ```bash
  curl -fLO https://raw.githubusercontent.com/linuser/zabbix-network-topology/main/templates/nt_lldp_snmp_template.yaml
  ```
- **After linking, don't look at the map — look at the discovery.** This is by far
  the most common reason for "LLDP doesn't work":

  | Macro | Default | Means |
  |---|---|---|
  | `{$NT.LLDP.DISCOVERY.INTERVAL}` | **3h** | how long it may take until neighbours are *found* |
  | `{$NT.LLDP.INTERVAL}` | **1h** | how long until their values are *current* |

  Link the template, reload the map, see nothing, and conclude it doesn't work:
  understandable, but premature. Zabbix simply hasn't asked yet. Force it:

  > *Data collection → Hosts → \<switch\> → **Discovery rules** → **LLDP neighbor
  > discovery** → **Execute now***

  Then filter *Latest data* for `lldpRemSysName`. **Only once there are values there
  can the module draw edges** — before that the map is necessarily empty, and no
  amount of reloading the module changes it.

  With many switches: the rule can be selected across multiple hosts in the host
  list and executed in one go.
- **Name matching is the crux.** The module resolves a neighbour name in this order:
  1. exact **host / visible name** (case-insensitive)
  2. **IP address**
  3. cleaned name (vendor suffixes such as `(Serial)` stripped)
  4. reverse-DNS pattern `ip-10-0-0-5` → extracted IP
  5. **unique** short name (first part before the `.`)

  → Best practice: **name Zabbix hosts the way the devices are named** (or set the
  SNMP interface IP to match). Ambiguous short names (several hosts sharing one
  short name) produce **no** edge — they land in the LLDP-Q tab as *ambiguous*.
- **Port labels at both ends** (optional, since v4.35): the *local* port comes from
  the item key bracket (`lldpRemSysName[0.24.1]` → middle number = local port;
  `lldp.rem.sysname[eth0]` → `eth0`), the *remote* port from
  `lldpRemPortId` / `lldpRemPortDesc` carrying the same SNMPINDEX (PortDesc
  preferred — PortId may be a MAC). More under
  [port-to-port](#port-to-port--per-link-weathermap).

---

## Vendor matrix — what produces edges?

Not every device hands out its neighbour table over SNMP. Rough guidance (when in
doubt, verify with the [test below](#the-test-that-settles-it)):

| Vendor / line | SNMP + LLDP neighbour table? | For the module | Note |
|---|---|---|---|
| **HP Aruba** (AOS-Switch / AOS-CX) | ✓ full | **works** | standard LLDP-MIB |
| **HP ProCurve** (older, e.g. 2500) | ⚠ partly send-only | limited | older series send LLDP but partly keep **no** queryable neighbour table |
| **TP-Link Omada / JetStream** (*managed*) | ✓ | **works** | full NOS with SNMP + LLDP-MIB |
| **TP-Link Easy Smart** (TL-SG2008P, …E) | ✗ no SNMP | **no edges** | the "dumb switch" case → add manually |
| **TP-Link unmanaged** | ✗ | invisible | devices appear directly connected, the switch is missing |
| **Ubiquiti EdgeSwitch / EdgeMax** | ✓ mostly | **works** | EdgeOS, decent SNMP |
| **Ubiquiti UniFi** (USW/UDM) | ✗ often **no** SNMP at all | **works via API** | LLDP lives in the controller → the official *UniFi Network API* template provides `uplink.id`, which the module reads directly |
| **Cisco** (IOS/NX-OS) | ✓ | **works** | CDP on by default, LLDP opt-in (`lldp run`) |
| **Huawei** (VRP, e.g. S5700) | ✓ | **works** | confirmed on an S5700 in a production network. VRP answers the standard LLDP-MIB — but the default SNMP view may hide it, see below. The official *Huawei VRP by SNMP* template does **not** collect the neighbour table |
| **MikroTik** (RouterOS) | ✓ walks only | **works** | confirmed on a CRS326-24S+2Q+ (RouterOS 7.22): the LLDP-MIB answers walks, but exact-instance GETs return `noSuchObject` — see below |

**Vendor missing, or a row that says "unverified"?** Both are gaps, not
decisions. One command on your device settles a row —
[the script](#or-let-a-script-tell-them-apart) prints a ready-made report, and
there is a form for it: [report a device](https://github.com/linuser/zabbix-network-topology/issues/new?template=device_report.yml). A **negative**
result counts just as much: "✗ no queryable neighbour table" saves the next
person the afternoon you just spent.

> **Huawei: the case that shows the most common misunderstanding.** Reported from a
> production network with S5700 switches: LLDP enabled on the devices, names
> matching, and still a circle without a single edge. Not a module bug — the chain
> has three links, and the middle one was missing:
>
> ```
> switch (LLDP on)  →  Zabbix items  →  this module
> ```
>
> The module speaks **no SNMP**. It reads items. The official *Huawei VRP by SNMP*
> template creates none for the LLDP neighbour table, so Zabbix never asks the
> switch for it. The same holds for the stock Cisco and HP templates: enabling LLDP
> on the device is only half the job — without `nt_lldp_snmp_template.yaml` (or your
> own items) the map stays empty.
>
> **Settled, on a device.** The reporter linked `nt_lldp_snmp_template.yaml`, ran
> the discovery — and the edges appeared. VRP does answer the IEEE standard
> LLDP-MIB; the row above is a measurement now, not an expectation.
>
> **But one step more was needed, and it is easy to miss.** On his switches the
> LLDP OIDs were not in the SNMP view at all: `snmpwalk` returned nothing while
> LLDP was demonstrably running. VRP ships a restricted default view, and what is
> not in the view does not exist as far as SNMP is concerned. Two commands fix it:
>
> ```
> snmp-agent mib-view include iso-view iso
> snmp-agent community read <SNMP_COMMUNITY> mib-view iso-view
> ```
>
> This is not Huawei-specific in principle — any device with a restricted SNMP
> view behaves the same way. It looks exactly like "the switch doesn't do LLDP",
> which is why it belongs in the first test, not in the fine print.
>
> Source: [Issue #2](https://github.com/linuser/zabbix-network-topology/issues/2),
> confirmed by the reporter on 2026-08-31.

> **MikroTik: measured, and it changed the template.** This row read "unverified"
> from the day it was written, because nobody had ever confirmed what RouterOS
> does. Now we know, from a CRS326-24S+2Q+ on RouterOS 7.22: the agent **answers
> walks** on the LLDP subtree, and returns `noSuchObject` for **exact-instance
> GETs** on the very rows a walk just printed.
>
> That is not a MikroTik curiosity, it is why the shipped template changed. Zabbix
> LLD uses a walk (so discovery always worked), while the old item prototypes used
> exact GETs — so every discovered item went unsupported, permanently. Since 5.1.1
> the template polls one `walk[]` master item and derives discovery and all
> prototypes from it, which removes the per-instance GET entirely.
>
> Source: [Issue #4](https://github.com/linuser/zabbix-network-topology/issues/4) and the pull request that followed it.

> **UniFi in detail:** UniFi builds LLDP for its *own* controller, not for external
> SNMP polling. In practice it's even starker: on a **UDM Pro Max** with SNMP
> enabled, `sysDescr` returned **nothing at all** (v1 *and* v2c, community `public`)
> — although the device answered pings. The SNMP switch in the Network app enables
> SNMP on the *adopted devices*, not on the console itself; and Ubiquiti has been
> winding SNMP down for years. So don't build on an LLDP walk against UniFi.
>
> **The path that holds:** the official **UniFi Network API** template. It creates
> an item **`uplink.id`** per device/client (JSONPath `$.uplinkDeviceId` from
> `details.json`) — the device UUID of the uplink. Since the same template names its
> hosts after that UUID, the module resolves the edge with no extra work:
> **linking the template is enough**, no custom items. Source in the LLDP-Q tab:
> `unifi`. (Incidentally, the community on UniFi is fixed to `public` and not
> configurable — which is why the field is absent from the UI.)

---

## The test that settles it

Don't guess — **snmpwalk the LLDP neighbour table** and see whether names come back:

```bash
snmpwalk -v2c -c <community> <switch-ip> 1.0.8802.1.1.2.1.4.1.1.9
```

(`…4.1.1.9` = `lldpRemSysName`.)

- **Names come back** → the module will draw edges from them. ✓
- **Empty / "No Such Object"** → this switch provides **no** edges via SNMP
  (Easy Smart, UniFi without the API, send-only devices) →
  [add them manually](#filling-the-gaps-manually).

> **Careful with "empty" — it means three different things.** The device may be
> unreachable or the community wrong (nothing to do with LLDP); the device may
> answer but hide the LLDP MIB behind a restricted **SNMP view**; or the MIB may
> be visible with no neighbour in the table yet. Telling these apart is what
> costs afternoons.

### Or let a script tell them apart

`tools/nt-lldp-probe.sh` runs all three queries, names which of the three cases
you are in, and prints a report block you can paste into an issue. It is **not
in the module ZIP** — `tools/` never goes under the web root — so fetch it from
the repository:

```bash
curl -fLO https://raw.githubusercontent.com/linuser/zabbix-network-topology/main/tools/nt-lldp-probe.sh
chmod +x nt-lldp-probe.sh
NT_COMMUNITY=<community> ./nt-lldp-probe.sh <switch-ip>
```

Needs `snmpwalk` (net-snmp). It reads only, never writes, and **sends nothing
anywhere** — the single connection goes to the IP you passed. The report holds
counts, not neighbour names, and never the community string, so there is nothing
to redact before posting it.

CDP equivalent (Cisco): `1.3.6.1.4.1.9.9.23.1.2.1.1.6` (`cdpCacheDeviceId`).

---

## Port-to-port & per-link weathermap

Since **v4.35** every LLDP edge carries not only the *local* port of the reporting
switch but also the **remote port** at the neighbour's end — and, where the data
supports it, the **measured** utilisation of the physical link (weathermap mode)
instead of an estimate derived from host traffic totals.

**What the module reads for this** (the bundled template brings it automatically):

| Item key | OID | Purpose |
|---|---|---|
| `lldpRemPortId[{#SNMPINDEX}]` | `1.0.8802.1.1.2.1.4.1.1.7` | remote port (may be a MAC, depending on PortIdSubtype) |
| `lldpRemPortDesc[{#SNMPINDEX}]` | `1.0.8802.1.1.2.1.4.1.1.8` | remote port in plain text — **preferred** for the label |
| `cdpCacheDevicePort[{#SNMPINDEX}]` | `1.3.6.1.4.1.9.9.23.1.2.1.1.7` | remote port under CDP |
| `net.if.in[ifHCInOctets.<ifIndex>]` / `…out` | Interface-MIB | per-link traffic (standard SNMP interface monitoring) |

The remote port correlates through **the same `{#SNMPINDEX}`** as the neighbour
SysName; the local port is the middle number of the LLDP index
(`…[TimeMark.LocalPort.RemIndex]`).

**Prerequisite for the *measured* weathermap** (not just the labels): the local LLDP
port has to correspond to the **ifIndex** under which the switch counts its interface
traffic. On Aruba/ProCurve that's 1:1. Where it doesn't line up, the port **labels**
remain — only the edge falls back to the node-total **estimate** (not an error).
To verify:

```bash
snmpwalk -v2c -c <community> <switch-ip> 1.0.8802.1.1.2.1.4.1.1.7   # lldpRemPortId
snmpwalk -v2c -c <community> <switch-ip> 1.0.8802.1.1.2.1.4.1.1.8   # lldpRemPortDesc
```

Values coming back → port-to-port works. Whether the index `<LocalPort>` exists as
`net.if.in[ifHCInOctets.<LocalPort>]` decides whether utilisation is *measured*.

> **CDP:** the CDP `{#SNMPINDEX}` has two parts (`cdpCacheIfIndex.devIndex`). The
> module takes the local port from the *first* part (= ifIndex) — so remote port
> labels **and** measured per-link utilisation work with pure CDP as well.

> **Absolute vs. % weathermap:** the weathermap's **% mode** normalises every edge
> against its capacity and is the consistent comparison view. The default
> **absolute** view colours by raw traffic — there, port-to-port edges with a
> *measured* per-link figure sit next to edges with an *estimated* node total. For
> comparing colours between edges, use % mode.

---

## Why are edges missing? (Troubleshooting)

### First: the question that halves the search

Before you go looking inside the module — **do LLDP items exist at all?**
*Monitoring → Latest data*, filter `lldpRemSysName`:

- **No results** → the problem is **upstream** of the module, in Zabbix or on the
  device. Continue at ["What you have to do", step 3](#3-in-zabbix) — usually the
  template is missing or discovery hasn't run yet (default **3h**, force it with
  *Execute now*).
- **Results, but the map stays empty** → the problem is **name matching**. Continue
  with the LLDP-Q tab below.

That one minute saves the bulk of the troubleshooting. "No item" and "item matches
no host" look identical in the module — a circle without edges — but have nothing to
do with each other.

### Then: the LLDP-Q tab

Open the **LLDP-Q tab** in the module — it reports per host:

- **matched** — neighbour cleanly resolved to a host ✓
- **unmatched** — the neighbour name resolves to **no** host
- **ambiguous** — the short name fits **several** hosts → no edge (guessing would be
  worse)

Most common causes:

| Symptom | Cause | Fix |
|---|---|---|
| host shows `matched: 0` | switch keeps no neighbour table (Easy Smart, send-only, no SNMP) | snmpwalk test; add manually if needed |
| neighbour *unmatched* | announced SysName ≠ Zabbix host name | rename hosts / set the SNMP IP to match |
| server never appears as a neighbour | no `lldpd` on the server | install `lldpd` |
| neighbour *ambiguous* | several hosts share one short name | use unique (FQDN) names |
| no LLDP items at all | no SNMP LLD / template without LLDP | create an LLD rule for `lldpRemSysName` |
| template linked, still no items | **discovery hasn't run yet** — the default is 3h | *Discovery rules → LLDP neighbor discovery → **Execute now*** |
| vendor template linked, no LLDP items | the official templates (Huawei VRP, Cisco IOS, HP) do **not** collect the neighbour table | link `nt_lldp_snmp_template.yaml` in addition |
| `snmpwalk` returns nothing although LLDP is running | the OIDs are not in the device's **SNMP view** | Huawei VRP: `snmp-agent mib-view include iso-view iso` plus `snmp-agent community read <community> mib-view iso-view`. Other vendors: widen the view accordingly |

---

## Filling the gaps (manually)

For everything LLDP/SNMP won't give you (Easy Smart switches, unmanaged gear, UniFi
without the API, send-only devices), **declaring it by hand** remains. What works
well is an **LLDP backbone plus targeted manual additions** — you get LLDP's
self-updating nature *and* the completeness of hand work.

### What happens to devices that report nothing at all?

Two cases, with different effects:

**An unmanaged switch is usually invisible.** It speaks no LLDP but passes the frames
through, because it doesn't process them. The managed devices to its left and right
therefore see *each other* and appear directly connected. Topologically wrong — but
the statement "these two are connected" still holds.

**A firewall without LLDP is the more awkward case.** It is monitored, so it appears
as a node — but without edges. It sits on the map as an **island**, even though half
the traffic runs through it.

### The three tools

**1. Host tag `nt:parent=<hostname>`** — the recommended route. Set a tag on the host
naming the device it hangs off:

```
nt:parent = fw-core
```

An ordinary Zabbix host tag, therefore stored **server-side** and visible to every
user. Intended for carrier relationships (VM→hypervisor, container→node), but it
works just as well for "this host sits behind this firewall". The failure simulation
treats it as a **hard dependency**: if the parent goes, the child goes — regardless
of the network path.

**2. Manual links** drawn straight on the map in star mode. Since 5.0 **server-side**,
in two layers: when a **Super admin** draws, the edge applies to everyone. When
anyone else draws, it's their personal note — but it follows them across browsers and
machines. Both are distinguishable on the map; the shared one is more strongly dashed.
> That makes manual links usable for a *shared* topology too. Where an `nt:parent` tag
> fits better: it is a **hard dependency** in the failure simulation, whereas a manual
> link is only an edge on the map. For "sits behind this firewall" use the tag; for
> "there's a cable here that nobody reports" use the link.

**3. Ghost nodes** cover the opposite case: when a neighbour reports a device that
isn't monitored in Zabbix at all, it appears as a dashed placeholder (toggle in the
toolbar, off by default). That makes the gap **visible** instead of letting it vanish.

### Important for the failure simulation

The simulation knows **only the edges it was given**. Two things follow:

- A device that isn't in the graph cannot be simulated as a point of failure.
- A hand-drawn edge that doesn't match reality makes the simulation **reliably
  wrong** — it will then report hosts as "safe" that physically are not.

So for the paths that genuinely matter, a cross-check pays off: are those edges
**measured** or **assumed**?
