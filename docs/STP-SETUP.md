# Loop & ring detection setup — Network Topology for Zabbix

How the module shows **physical loops in your switch fabric** — redundant rings
and the active symptoms of a loop that is actually forwarding — and the one
template (plus one optional cron) you add to make it work.

*[← Documentation index](README.md)*

**🇬🇧 English**

> This is opt-in. Without the template below, the map simply draws no rings and
> raises no loop warnings — nothing else in the module changes.

---

## The mental model

The map already knows the **cable graph** from LLDP/CDP. A redundant layout
contains **cycles** — rings. A ring is not a problem in itself: that is what
Spanning Tree is for. A ring is only dangerous when **nothing blocks it**, so a
frame can circle forever (a broadcast storm).

So the module does two things:

1. **Finds the rings** in the cable graph (`rings.js`, frontend-only). Parallel
   links / LAGs collapse to one logical pair, so a bundle is not mistaken for a
   ring.
2. **Classifies each ring** from the switches' **Spanning-Tree state** and three
   active loop symptoms, read over SNMP from the template below.

It is deliberately conservative: a ring is only called *safe* when STP is
proven to block it somewhere, and only called *dangerous* on real evidence. A
ring the module knows nothing about is drawn **grey (unknown)** — never a false
alarm.

---

## The template

Import **`templates/nt_stp_snmp.yaml`** (*Data collection → Templates → Import*)
and link **“NT Spanning-Tree by SNMP”** to your managed switches. All items are
**SNMP agent** except the one trapper noted below.

| What | Key | Source OID | Feeds |
|---|---|---|---|
| STP port-state table (walk) | `nt.stp.walk` | `dot1dStpPortState` + `dot1dBasePortIfIndex` + `dot1dStpPortDesignatedBridge/-Port` + `dot1dBaseBridgeAddress` | per-port STP state → ring *safe/blocked*, **and the forwarding partner of a self-loop on the faceplate** |
| STP topology changes/s | `nt.stp.topchanges` | `dot1dStpTopChanges` (1.3.6.1.2.1.17.2.4.0), change/s | ring *churn* (stage 3a) |
| Broadcast in-packets table (walk) | `nt.bcast.walk` | `ifHCInBroadcastPkts` | per-port rate → ring *storm* (stage 3b) |
| MAC flapping (last interval) | `nt.mac.flap` | **trapper** — fed by the cron below | ring *flap* (stage 3c) |

The walks drive two discovery rules that create the per-port items
`nt.if.stp[…]` and `nt.if.bcast[…]` automatically — nothing to configure.

> **Upgrading from an earlier version? Re-import the template.** Since 5.5.57 the
> `nt.stp.walk` item walks three more OIDs (designated bridge/port + the base
> bridge address) and keeps a short history, so the faceplate can name the *other*
> end of a self-loop. *Data collection → Templates → Import* the YAML with
> “Update existing” for items; the new columns appear on the next poll.

**Macros** (sensible defaults, override per host if needed):

| Macro | Default | Meaning |
|---|---|---|
| `{$NT.STP.INTERVAL}` | `5m` | poll interval of the STP items (STP changes on convergence; minutes is plenty) |
| `{$NT.BCAST.INTERVAL}` | `2m` | poll interval of the per-port broadcast rate (shorter — a loop floods broadcast, catch it sooner) |

Switches that don't speak STP over SNMP simply leave those items unsupported;
their rings stay **unknown** (grey), and the module does not warn on them.

> **Vendor note — `dot1dStpTopChanges` is not universal.** Some switches serve
> the per-port STP state (`nt.stp.walk`) but **not** the topology-change counter.
> MikroTik RouterOS (measured on a CRS310) leaves `nt.stp.topchanges`
> *not supported* — so the **churn** early-warning (stage 3a) cannot fire there.
> That is not a problem: a loop on such a switch still shows up, because RSTP
> **blocks** one of the looped ports and the per-port state (`nt.if.stp[…] = 2`,
> blocking) is captured — the switch gets the `stp_block` flag, and a ring around
> it reads **safe**. In short: on hardware without the counter, a loop is caught
> by the blocked port, not by churn. A self-loop (one port cabled back into the
> same switch) is caught the same way, even though it draws no ring on the map.

> **Self-loop on the faceplate.** A self-loop forms no edge and no ring, so the
> map cannot draw it — but the **front panel** (host detail panel and the NT
> Faceplate widget) now marks **both ends**: the port RSTP blocked as an amber
> badge with a slash, the forwarding partner as a ring, and a dashed arc with a ⚠
> connecting them — so it reads as *one cable looped on this switch, go pull it*.
> The partner is resolved from the designated bridge/port in the walk above; a
> plain STP-blocked redundancy link to **another** switch stays neutral cyan, and
> a port that is merely **down** (some switches report it as *discarding*) is not
> treated as blocked.

---

## The ring colours

Turn the overlay on with the **“◯ Rings”** toolbar toggle. Each ring's cable
edges get a coloured halo; the KPI row shows a matching pill.

| Colour | State | When |
|---|---|---|
| cyan | **safe** | STP blocks the ring somewhere (a port in the ring's cluster is *blocking*) |
| amber | **churn** | STP topology changes **> 0.1/s** on a ring member |
| red | **loop risk** (*open*) | STP data present, **nothing** blocks the ring |
| red | **broadcast storm** | a ring member's port exceeds **200 broadcast pkt/s** |
| red | **MAC flapping** | **> 2** MACs changed port in the last interval (needs the cron below) |
| grey | **unknown** | no STP data for the ring — **no alarm** |

When several apply, the worst wins:
**storm > flap > open > churn > safe > unknown.**

> The classification is per 2-edge-connected **cluster**, not per edge. On a
> figure-8 topology that can *under*-warn (one blocked port marks the whole
> cluster safe), but it never warns falsely — the deliberate trade-off.

The per-host symptoms also show without the overlay: a badge in the host detail
panel (with the measured rate/count) and their own KPI pills (*STP unstable*,
*Broadcast storm*, *MAC flapping*).

---

## MAC-flapping: the cron sender (stage 3c)

MAC flapping — the same MAC bouncing between ports — is the classic symptom of a
forwarding loop, but it is **temporal**: a MAC moving *over time*. Neither the
stateless frontend nor SNMP preprocessing can compute that. So a small cron does:

`tools/nt-mac-flap-sender.sh` reads each switch's FDB from Zabbix (the
`nt.fdb.dot1d` / `nt.fdb.dot1q` items — see **[FDB-SETUP.md](FDB-SETUP.md)**),
diffs it against the last snapshot, counts the MACs that **changed port**, and
pushes the number to the `nt.mac.flap` trapper with `zabbix_sender`. New or aged
MACs (seen in only one snapshot) don't count — that is normal learning, not a
flap.

**Prerequisites**

- The **FDB items** `nt.fdb.dot1d` / `nt.fdb.dot1q` on the switches (FDB-SETUP.md).
- This **STP template** linked (it carries the `nt.mac.flap` trapper).
- The switches in a **host group** you can name below.

**Configure** via environment (put it in a file the cron sources, `chmod 600`):

| Variable | Example | Notes |
|---|---|---|
| `ZBX_URL` | `https://zabbix.example.com` | frontend / API base URL |
| `ZBX_TOKEN` | *(persistent API token)* | *Users → API tokens*. A **read-only** user is enough — the push itself uses no API token. |
| `GROUPIDS` | `Switches,Fox` | group **names or numeric IDs** (mixed is fine) |
| `ZBX_SENDER_HOST` | `127.0.0.1` | **behind a Zabbix proxy:** run the sender *on the proxy* and push to its local trapper. Omit on a direct setup and set `SENDER_CONF` instead. |
| `ZBX_SENDER_PORT` | `10051` | trapper port for `-z` (default) |
| `SENDER_CONF` | `/etc/zabbix/zabbix_agent2.conf` | used only when `ZBX_SENDER_HOST` is unset |
| `STATE_DIR` | `/var/lib/nt-mac-flap` | per-host snapshots (hold MACs — kept `700`/`600`) |

**Run it from cron**, every 1–5 minutes:

```cron
*/2 * * * * . $HOME/.nt-mac-flap.env && $HOME/nt-mac-flap-sender.sh >/dev/null 2>&1
```

The **first run only builds the baseline** (`pushing: 0`); from the second run it
reports the moved-MAC count. A real loop moves many MACs at once — a single
device roaming does not trip the `> 2` threshold.

> **Behind a NAT'd / active proxy** the Zabbix server cannot reach the proxy, so
> run the sender **on the proxy** with `ZBX_SENDER_HOST=127.0.0.1`: it reads via
> the API and pushes to the proxy's own trapper, which forwards to the server.
> Using `-c` with the proxy's config would be wrong — that config points at the
> main server, which rejects a trapper value for a proxy-monitored host.

---

## What each switch needs (summary)

| Goal | Add to the switch |
|---|---|
| Ring drawn at all | nothing extra — LLDP/CDP neighbours (see LLDP-SETUP.md) |
| Ring *safe vs loop-risk* | link **NT Spanning-Tree by SNMP** |
| STP churn / broadcast-storm warning | same template (automatic once linked) |
| MAC-flapping warning | same template **+** FDB items (FDB-SETUP.md) **+** the cron sender |

Everything here is opt-in and additive: a switch without the template still draws
its rings — they just stay *unknown* rather than classified.
