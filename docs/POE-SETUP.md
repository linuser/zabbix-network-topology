# PoE setup — Network Topology for Zabbix

How the module shows **Power-over-Ethernet** on the switch faceplate — the PoE
**class** of each port and the switch's power **budget** — and the one template
you add to make it work.

*[← Documentation index](README.md)*

**🇬🇧 English**

> This is opt-in and additive. Without the template below the faceplate still
> marks ports that deliver power (the lightning bolt, if your switch already has
> the detection item); it just shows no class and no budget.

---

## What it shows

The faceplate (host detail panel and the NT Faceplate widget) already marks a
port **delivering power** with a lightning bolt. With this template it adds:

- **PoE class per port** — on the port tooltip: *"PoE: Class 4, delivering power"*
  (or *"… , not delivering"* for a port that negotiated a class but draws nothing).
- **Switch power budget** — in the faceplate footer: *"PoE: 37 / 195 W"* (used /
  nominal).

What it does **not** show: the actual **watts per port**. Those are vendor-specific
(e.g. Cisco `cpeExtPsePortPwrConsumption`), not part of the standard MIB, so they
are not collected here.

---

## The template

Import **`templates/nt_poe_snmp.yaml`** (*Data collection → Templates → Import*)
and link **“NT PoE by SNMP”** to your managed PoE switches. All items are SNMP
agent, over the standard **POWER-ETHERNET-MIB (RFC 3621)** — no external collector.

| What | Key | Source OID | Feeds |
|---|---|---|---|
| PoE port table (walk) | `nt.poe.walk` | `pethPsePortDetectionStatus` + `pethPsePortPowerClassifications` | per-port **class** + the delivering bolt |
| Switch budget, nominal | `nt.poe.nominal` | `pethMainPsePower.1` | footer **budget** (available W) |
| Switch budget, used | `nt.poe.used` | `pethMainPseConsumptionPower.1` | footer **budget** (consumed W) |

The walk drives one discovery rule that creates the per-port items
(`pethPsePortDetectionStatus[…]`, `pethPsePortPowerClassifications[…]`)
automatically — nothing to configure.

**Macro** (sensible default, override per host if needed):

| Macro | Default | Meaning |
|---|---|---|
| `{$NT.POE.INTERVAL}` | `5m` | poll interval of the PoE items (class/budget change rarely — a device is plugged or unplugged — so minutes is plenty) |

---

## What your switch needs to serve

PoE over SNMP is uneven across vendors. Two independent questions:

| Goal | Needs | Notes |
|---|---|---|
| Delivering bolt + **class per port** | `pethPsePortDetectionStatus` / `…Classifications` | Standard; most managed PoE switches serve it. **Measured:** HPE/Aruba Instant On 1830 (JL813A) serves both cleanly. |
| **Switch budget** | `pethMainPsePower` / `…ConsumptionPower` | Standard, but **not every switch fills it**. When empty, the module simply draws no budget line. |

> **Vendor note — the budget is not universal.** Some switches serve the per-port
> table but leave `pethMainPse*` empty, exposing the total only through a vendor
> MIB. Measured on an HPE 1830 (JL813A): per-port class works, the switch budget is
> empty. On such a device the class line appears and the budget line does not —
> that is expected, not a fault. A switch that does not speak the POWER-ETHERNET-MIB
> at all (measured: TP-Link TL-SG2008P) shows neither; its PoE lives only in a
> vendor MIB.

**Measuring tool.** `tools/nt-poe-probe.sh <ip>` reads the standard MIB read-only
and tells you, for one switch, what it serves: per-port detection, per-port class,
and whether the budget is populated. Use it before linking the template to see
what to expect.

---

## Summary

| Add to the switch | Gets you |
|---|---|
| nothing extra | the delivering bolt, **if** the detection item already exists |
| link **NT PoE by SNMP** | class per port, and the switch budget **if** the device fills `pethMainPse*` |

Everything here is opt-in and additive: a switch without the template still draws
whatever PoE detection it already has.
