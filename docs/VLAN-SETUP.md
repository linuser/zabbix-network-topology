# VLAN setup — Network Topology for Zabbix

How the module shows **802.1Q VLANs** on the map — pick a VLAN and see only the
devices and links it runs on — and the one template you add to make it work.

*[← Documentation index](README.md)*

> This is opt-in and additive. Without the template below the map behaves exactly
> as before; the VLAN picker simply does not appear. Link the template to the
> switches whose VLANs you care about and the picker shows up on its own.

---

## What it shows

In the **Technical** view a VLAN picker — **⬡ VLAN** — appears in the toolbar as
soon as at least one switch reports VLAN data. It lists every VLAN seen on the
map (id + name). Pick one and:

- everything **not** on that VLAN dims out, leaving the devices and links that
  carry it;
- a node is kept lit when it has the VLAN on any port; an **edge** is kept when
  the VLAN is egress-tagged on the local port of **at least one** end;
- in the grouped (**Fold groups**) view an aggregate node inherits the **union**
  of its members' VLANs, so the picker still lists them and a group only dims
  when none of its members carry the VLAN.

The choice persists per view. Clearing it (**⬡ VLAN: all**) restores the full map.

VLAN **names** come from the switch (`dot1qVlanStaticName`). They often carry
site or customer names (e.g. `VLAN_ACME_VOICE`) — they are shown to the operator
on their own instance and are **never** exported or sent anywhere by the module.

---

## The template

Import **`templates/nt_vlan_snmp.yaml`** (*Data collection → Templates → Import*)
and link **“NT VLAN by SNMP”** to your 802.1Q switches. It is a **fresh import**
(a new template), not a re-import of an existing one. One SNMP-agent item, a
single bulk walk over the standard **Q-BRIDGE-MIB (RFC 4363)** and **BRIDGE-MIB
(RFC 4188)** — no external collector, no discovery rule.

| What | Key | Collects |
|---|---|---|
| Q-BRIDGE table (one bulk walk) | `nt.vlan.walk` | VLAN names, static + current egress bitmasks, PVID, bridge-port→ifIndex, ifName |

The single walk covers six OIDs:

| OID | Name | Meaning |
|---|---|---|
| `1.3.6.1.2.1.17.7.1.4.3.1.1` | `dot1qVlanStaticName` | VLAN id → name |
| `1.3.6.1.2.1.17.7.1.4.3.1.2` | `dot1qVlanStaticEgressPorts` | members, static (**bitmask**) |
| `1.3.6.1.2.1.17.7.1.4.2.1.4` | `dot1qVlanCurrentEgressPorts` | members, operational (**bitmask**) |
| `1.3.6.1.2.1.17.7.1.4.5.1.1` | `dot1qPvid` | bridge-port → access VLAN |
| `1.3.6.1.2.1.17.1.4.1.2` | `dot1dBasePortIfIndex` | bridge-port → ifIndex |
| `1.3.6.1.2.1.31.1.1.1.1` | `ifName` | ifIndex → port name |

The module reads the walk text directly and parses it (the same approach as the
STP template's `nt.stp.walk`), so the item carries only a short history (1h).

**Why a bitmask, and why two steps.** The egress columns are an 802.1Q
**PortList**: a bit field where **port 1 is the most significant bit of byte 0**.
The set bits name **bridge-ports**, not ifIndexes — `dot1dBasePortIfIndex` is the
second step that turns a set bit into a real interface. The module's `VlanParser`
does both (`VlanParser::membership`); `dot1qPvid` gives the access VLAN per
bridge-port (`VlanParser::accessVlans`), often more telling for an access port
than the egress mask.

**Macro** (sensible default, override per host if needed):

| Macro | Default | Meaning |
|---|---|---|
| `{$NT.VLAN.INTERVAL}` | `10m` | poll interval of the VLAN walk. VLAN membership changes rarely (a config change, not traffic), so a slow interval is plenty and keeps the per-switch load low. |

---

## What your switch needs to serve

VLAN over SNMP rests on the standard Q-BRIDGE `dot1q` group. Not every vendor
fills it — some keep VLANs only in a private MIB.

| Vendor / model | Standard Q-BRIDGE `dot1q`? | In the VLAN view |
|---|---|---|
| **HPE / Aruba Instant On 1830** (measured: 24p JL813A, 8p) | **Yes** — names, egress masks, PVID, base-port all filled | full VLAN membership |
| **Aruba CX / HP 2930** (standard Q-BRIDGE) | Yes (expected) | full VLAN membership |
| **MikroTik** RouterOS (measured: CRS310) | **No** — the `dot1q` group is not implemented | not visible; would need the MIKROTIK-private MIB |
| **TP-Link** JetStream (measured: TL-SG2008P) | **No** — names/egress empty, private MIB only | not visible |

> **Measure first.** `tools/nt-vlan-probe.sh <ip>` reads the Q-BRIDGE tables
> read-only and tells you, for one switch, whether `dot1qVlanStaticName`, the
> egress bitmasks and `dot1dBasePortIfIndex` are populated — i.e. whether the
> mask can be resolved to real ports at all. Run it **before** linking the
> template so you know what to expect. An empty `nt.vlan.walk` means the switch
> does not fill the standard table (private MIB only) **or** simply has no 802.1Q
> VLANs configured — the probe tells the two apart.

---

## Summary

| Add to the switch | Gets you |
|---|---|
| nothing extra | no VLAN picker (the map is unchanged) |
| link **NT VLAN by SNMP** on a standard-Q-BRIDGE switch | the **⬡ VLAN** picker and VLAN-aware dimming across the map |
| link it on a switch with no standard Q-BRIDGE | an empty `nt.vlan.walk`; probe first to avoid a dead item |

Everything here is opt-in and additive: a switch without the template contributes
nothing to the VLAN view and the map is otherwise untouched.
