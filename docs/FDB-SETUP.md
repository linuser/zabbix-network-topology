# MAC/IP finder setup — Network Topology for Zabbix

How the module answers **"which switch port is this MAC on?"**, and the four
Zabbix items you add to a switch to make it work.

*[← Documentation index](README.md)*

> This is new and opt-in. Without the items below, the finder simply has no data
> for that switch and says so — nothing else in the module changes.

---

## The mental model

A MAC address sits in the forwarding database (FDB) of **every** switch on its
path — on each one at the *uplink* port that faces the device. A raw FDB lookup
therefore returns several hits and no answer. The useful one is the **access
port**: the single port where the MAC lives that is **not** an uplink.

The module reads each switch's FDB from Zabbix, turns `MAC → bridge-port` into
`MAC → real port name`, and reports the access port — and is honest when it
can't be sure (several candidates, or the MAC only on uplinks).

**It never does SNMP itself.** It reads the values of `walk[]` items that Zabbix
(through its proxy, if any) already collected. That is the whole point: it works
for switches behind a proxy that the frontend cannot reach directly.

---

## The four items (per switch)

Add these to the switch host — directly, or in a template you link to your
switches. All are **SNMP agent** items; the walk goes in the **SNMP OID** field
(Zabbix 6.0+ `walk[...]`), the **key is fixed** (the module finds the items by
these keys):

| Name (free) | Key (**exact**) | SNMP OID | Info type |
|---|---|---|---|
| NT FDB (dot1d) | `nt.fdb.dot1d` | `walk[1.3.6.1.2.1.17.4.3.1.2]` | Text |
| NT FDB (dot1q, per-VLAN) | `nt.fdb.dot1q` | `walk[1.3.6.1.2.1.17.7.1.2.2.1.2]` | Text |
| NT bridge-port → ifIndex | `nt.fdb.baseport` | `walk[1.3.6.1.2.1.17.1.4.1.2]` | Text |
| NT ifName (port names) | `nt.fdb.ifname` | `walk[1.3.6.1.2.1.31.1.1.1.1]` | Text |

- **`nt.fdb.baseport` is not optional.** The FDB returns *bridge-port* numbers,
  and a bridge-port is **not** an ifIndex. Without this item a hit resolves only
  to a bridge-port number, not a port.
- **`nt.fdb.ifname`** turns the ifIndex into a readable port name. Without it the
  finder shows the ifIndex number instead.
- **`nt.fdb.dot1q`** is enough on its own on VLAN-aware switches that populate
  only the Q-BRIDGE FDB; on classic switches `nt.fdb.dot1d` is enough. Having
  both is fine — the finder de-duplicates.
- **Update interval:** the FDB ages (~300 s by default). 2–5 min is a sensible
  interval. **History:** short (a day is plenty) — this is a live snapshot, not
  a trend.

Check a switch gives this data at all with `tools/nt-fdb-probe.sh <ip>` before
you wire the items (it counts entries, never prints MACs).

---

## Optional: search by IP address (ARP)

The finder also accepts an **IP address** (IPv4 or IPv6). It resolves it to a MAC
through the **ARP/ND table** of a router or L3 switch, then runs the normal FDB
lookup — so you get the access port straight from an IP. Add these items to the
device that holds those tables (the gateway for those hosts):

| Name (free) | Key (**exact**) | SNMP OID | Info type |
|---|---|---|---|
| NT ARP (IPv4 → MAC) | `nt.arp` | `walk[1.3.6.1.2.1.4.22.1.2]` | Text |
| NT ND (IPv6 → MAC) | `nt.nd` | `walk[1.3.6.1.2.1.4.35.1.4]` | Text |

- Same kind of item as the four above: **SNMP agent**, walk in the **SNMP OID**
  field, **fixed key**. Put them on the **router / L3 switch**, not on the access
  switches.
- `nt.arp` = `ipNetToMediaPhysAddress` — the classic **IPv4** ARP table.
- `nt.nd` = `ipNetToPhysicalPhysAddress` — the **IPv6** neighbor (ND) table.
- Several routers can each carry the items; the finder uses the **newest** entry
  across them. Interval/history like the FDB items (both tables age).
- Check a device first with `tools/nt-arp-probe.sh <ip>` — it counts both tables
  and shows one **masked** sample line (never a real MAC or IP).

**IPv6 shortcut:** a link-local or SLAAC address carries the MAC inside it
(EUI-64), so the finder resolves those **with no item at all** — `nt.nd` is only
needed for privacy-extension / DHCPv6 addresses. Without these items, MAC search
works unchanged; only IP search has no data.

---

## What it can and cannot tell you (honesty)

- **Access vs uplink** is decided from **LLDP** where the switch has it: a local
  port whose LLDP neighbor advertises Bridge/Router capability is an uplink,
  everything else is access. Switches without LLDP fall back to a **heuristic** (a
  port carrying many MACs is treated as an uplink) — weaker, because an access
  port to a **hypervisor** (many VMs) or a **downstream unmanaged switch** looks
  like an uplink. The panel says which method stood behind the answer. When
  several access ports match, the finder says **ambiguous** and shows them all
  rather than guessing one.
- **Every hit carries a timestamp.** "On port 18" is always a snapshot; the
  finder shows how old it is.
- **No data for a switch** (items missing, or the switch doesn't expose the FDB)
  is reported as such — it is not silently dropped.
