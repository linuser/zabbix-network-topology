# Documentation — Network Topology for Zabbix

Start here. The module works out of the box for **nodes** and **LLDP/CDP edges**;
every other view — VLAN, PoE, loops, UniFi, floor plan, MAC finder — is **opt-in**
and needs one template or a handful of items, each documented in its own guide
below.

## Install

- **[INSTALL.md](INSTALL.md)** — requirements, where `modules/` lives,
  RHEL/SELinux, the dashboard widgets, building from source, troubleshooting.
  Bilingual (🇬🇧 / 🇩🇪).

The project [README](../README.md) carries a quickstart; INSTALL.md is the full
guide.

## Feature setup

| Guide | What it enables |
|---|---|
| **[LLDP-SETUP.md](LLDP-SETUP.md)** | The **edges**: LLDP/CDP neighbour tables over SNMP. Read this first for any "nodes but no edges" case — includes a vendor matrix (TP-Link / Ubiquiti / HP-Aruba / Cisco / Huawei / MikroTik) and a test command. |
| **[STP-SETUP.md](STP-SETUP.md)** | **Loop & ring detection** from the switches' Spanning-Tree state — safe redundant rings vs. a loop that is actually forwarding. One template (+ one optional cron). |
| **[VLAN-SETUP.md](VLAN-SETUP.md)** | The **802.1Q VLAN** view — pick a VLAN and see only the devices and links it runs on. One template (standard Q-BRIDGE-MIB). |
| **[POE-SETUP.md](POE-SETUP.md)** | **Power-over-Ethernet** on the switch faceplate — the PoE class per port and the switch's power budget. One template. |
| **[UNIFI-SETUP.md](UNIFI-SETUP.md)** | **UniFi gear** — switches, APs and the gateway with their ports and uplink topology, from the UniFi Network API templates. |
| **[PLAN-SETUP.md](PLAN-SETUP.md)** | The **Plan view** — an aerial photo or floor plan behind the map, devices dragged onto their real physical spot, live status on each. |
| **[FDB-SETUP.md](FDB-SETUP.md)** | The **MAC/IP finder** — "which switch port is this MAC on?" Four items added to a switch. |

## Reference

- **[../README.md](../README.md)** — overview, features, screenshots
- **[../CHANGELOG.md](../CHANGELOG.md)** — version history
- **[../CONTRIBUTING.md](../CONTRIBUTING.md)** — how to contribute, and what the CI enforces
- **[../SECURITY.md](../SECURITY.md)** — reporting a vulnerability
- **[../ROADMAP.md](../ROADMAP.md)** — what's built, planned, and deliberately dropped

---

The feature guides are in English. The project README and INSTALL also carry a
German section (🇩🇪).
