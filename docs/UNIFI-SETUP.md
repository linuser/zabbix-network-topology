# UniFi setup — Network Topology for Zabbix

How the module draws **UniFi gear** — switches, APs and the gateway — with their
**ports** and the **uplink topology**, and what it deliberately cannot show.

*[← Documentation index](README.md)*

> This is opt-in and uses an existing template. Without UniFi hosts in Zabbix the
> module behaves exactly as before — nothing else changes.

---

## The mental model

UniFi devices are **not polled over SNMP** the way an HPE, Aruba, Cisco or
MikroTik switch is. They are monitored through the **UniFi Network API** — a
Zabbix HTTP-agent template that talks to your UniFi controller (UDM / Cloud Key /
self-hosted) and discovers every adopted device as its own Zabbix host.

So the module sees UniFi through a different door. It recognises those hosts by
the items that template creates, with **no configuration**, and maps them onto
the same picture as the SNMP switches.

## What you need

The community **"UniFi Network API"** template pair, linked to your controller
host and its devices:

- **UniFi Network API** — on the controller/gateway host.
- **UniFi Network API – Device** — on each discovered device (switches, APs).
  This is the one that matters here: it carries the per-port items and the
  `uplink.id` the module reads.

If your devices already appear in Zabbix with items such as `port.state[1]`,
`port.speed[1]`, `port.poe.state[1]` and `uplink.id`, you are done — the module
picks them up on the next map load. Detection is by **item presence**, not by the
template name, so renaming the template changes nothing.

## What the module shows

- **Topology.** Each device's `uplink.id` is the UUID of its upstream device, and
  that UUID is the upstream host's Zabbix host name — so the module joins them
  into the real **uplink tree** (AP → switch → gateway) with no LLDP needed. These
  edges carry a **UniFi** badge in the edge panel.
- **Ports (faceplate).** Click a UniFi switch and the front panel shows every
  port with its **state** (up/down), **speed**, connector (RJ45/SFP) and **PoE**
  (a lit port is delivering power). This is the same faceplate the SNMP switches
  get, inline and in the **NT Faceplate** dashboard widget.
- **Health.** Down ports count toward the device's interface health like any other
  switch.

## What it deliberately does not show (and why)

- **Per-port traffic.** The UniFi Network Integration API does **not** expose a
  per-port byte counter — the device JSON carries per-port state/speed/PoE but no
  traffic field (measured 2026-10-26). The only throughput UniFi reports is
  **device-level** (`uplink.rx`/`uplink.tx`), not per port. So UniFi port rows show
  no traffic bars; that is honest, not a bug. Getting per-port traffic would need a
  different data source (the classic controller `/stat/device` `port_table`, or
  SNMP) — a separate effort, not this integration.
- **STP / FDB / LLDP port pairs.** Not part of the UniFi API, so the loop/ring,
  MAC-finder and exact remote-port features do not apply to UniFi edges. They keep
  working for your SNMP switches.

## Access points: radios, client count and air utilization

A UniFi AP node on the map shows its **WLAN** in the node detail panel (click it):
the radios per band (channel, width, standard, e.g. `2.4 GHz → Ch 6 · 20 MHz ·
802.11n`), read straight from the Integration API (`radio.*`). A blue badge on the
node carries the **client count**, and the detail panel and the **NT WLAN** widget
add the **air utilization** per band (the `Air` column / `Util` row, in percent).

Client count and air utilization are **not** in the Integration API. Since 5.5.83
they come from the **classic controller API** (`/proxy/network/api/s/<site>/stat/device`,
which carries `num_sta` and `radio_table_stats[].cu_total`) as **items on the UniFi
AP host itself**, using the **same API key** — no second SNMP host and no IP-join.
Add these items per AP host (one master call, three dependent items):

- **Master** — HTTP agent, key `unifi.classic.device`, type *Text*, URL
  `https://<controller>/proxy/network/api/s/<site>/stat/device`, header
  `X-API-KEY: {$UNIFI_NETWORK_API_KEY}`, *SSL verify peer/host: No*. A JavaScript
  preprocessing step reduces the array to this device (match `_id`/`mac` against
  `{HOST.HOST}`) and returns `JSON.stringify(dev)`.
- **`wlan.clients`** (unsigned) — dependent on the master, JSONPath `$.num_sta`.
- **`wlan.cu[2.4]`** / **`wlan.cu[5]`** (float, `%`) — dependent, pick the radio
  with `radio == "ng"` (2.4 GHz) resp. `"na"` (5 GHz) and return its `cu_total`.
- **`wlan.ssids`** (text) — dependent on the master; fold `vap_table` by `essid`
  (sum `num_sta` across bands, keep `is_guest`) into a compact JSON list
  `[{ssid,clients,guest},…]`. The detail panel lists the SSIDs with their client
  count (guest SSIDs marked), and the NT WLAN widget shows them in a `SSIDs` column.
- **`wlan.satisfaction`** (unsigned) — dependent on the master. The AP's 0–100
  experience score, shown as a coloured `Sat` value. **Not a plain JSONPath:** an
  AP with no clients reports `satisfaction: -1` (a sentinel), and an unsigned item
  rejects the negative value. Use a **JavaScript** step that maps a missing or
  negative value to 100 (idle = nothing to complain about) and returns the score
  otherwise:

  ```javascript
  var d = JSON.parse(value), s = d.satisfaction;
  return (s == null || s < 0) ? 100 : s;
  ```

  Put a **trigger** on it (e.g. `min(/host/wlan.satisfaction,5m) < {$WLAN.SAT.WARN}`
  warning, `< {$WLAN.SAT.HIGH}` high) so a degraded AP turns orange/red on the map —
  the module reflects the trigger, it does not alert itself.

The 802.11 standard stays from the Integration API (the classic radio stats do not
carry it); channel, clients and utilization come from the classic API. If an AP has
no such items, the radios still show — just no badge and no utilization.

## Mixed environments

A site with both UniFi (API) and SNMP switches (HPE, Cisco, MikroTik …) draws
both on one map. A UniFi device's `uplink.id` only points at other UniFi devices,
so a cable **between** a UniFi switch and a non-UniFi switch is drawn only when the
non-UniFi side reports it over LLDP/CDP.
