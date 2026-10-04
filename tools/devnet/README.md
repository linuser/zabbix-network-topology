# devnet — a development network that fits in a repository

Everything interesting about this module hangs on SNMP values: LLDP and CDP
neighbour tables, port names, interface counters. A Zabbix agent provides none
of that, so a development environment built from agents answers none of the
questions we actually get asked.

Here, **snmpsim** answers instead. Each simulated device is one `.snmprec` file
in [`geraete/`](geraete), and every bug report can become one — reproducible in
minutes, for anyone, without the hardware.

**All values in these files are invented.** No walk from anyone's network, not
even slightly altered. That is a rule, not a preference: the people who send us
screenshots do it in confidence.

## What is simulated

| File | Reproduces |
|---|---|
| `aruba-cdp.snmprec` | A switch whose CDP cache answers with the neighbour's **MAC** instead of its name — the ghost nodes named after two hex digits |
| `switch24.snmprec` | 24 ports with names and aliases, counters in the ifTable |
| `tplink-lldp.snmprec` | The two-part LLDP index (no TimeMark) that made discovery find nothing at all — issue #15 |
| `kunde-a.snmprec`, `kunde-b.snmprec` | Two sites sharing the same private address, one of them reporting a neighbour by IP — issue #14 |
| `lab-access-endpoints.snmprec` | An access switch with four unmonitored endpoint neighbours (workstation/phone/printer/camera, Station/Telephone caps) — the bundle node that folds them into one, plus `ifLastChange` per port for link uptime |
| `lab-core-01.snmprec` | A core switch that reports `lab-access-endpoints` back on its downlink — the confirmed switch-to-switch edge used to show the per-port RX/TX sparkline and link uptime |

The **community string selects the device**: one snmpsim serves all of them, and
a host configured with `{$SNMP_COMMUNITY} = aruba-cdp` talks to
`geraete/aruba-cdp.snmprec`.

## Starting it

```bash
cd tools/devnet
cp .env.example .env          # put a password in it
docker compose up -d
```

The frontend is on <http://localhost:8081>, `Admin` / `zabbix` on a fresh
database. The module itself is mounted from `tools/devnet/modul/` — rsync your
working tree there, or point the mount somewhere else.

Then create the simulated hosts (SNMP interface pointing at the container name
`devnetz-snmpsim`, one host per file, `{$SNMP_COMMUNITY}` set to the file name),
create an API token under *Users → API tokens*, and run:

```bash
python3 tools/devnet/setup.py --token-datei ~/.devnetz-token
```

That imports the module's LLDP template, links it to every `lab-*` host and
shortens the polling intervals, because nobody wants to wait an hour for the
next discovery run while debugging.

## Many devices at once — the load test

The files above are **evidence**: one per real report, and their value is that
each reproduces exactly one incident. For "does this hold up at 200 devices?"
they are useless, and writing 200 by hand is neither feasible nor sensible.

```bash
node tools/devnet/erzeuge-geraete.mjs --anzahl 200
node tools/devnet/erzeuge-geraete.mjs --anzahl 50 --lag-anteil 0.3 --seed 7
```

They land in `geraete-generiert/`, which is **not** checked in — a generated
file next to the evidence is a file someone will eventually maintain as if a
bug report hung on it, or delete as if it were disposable. Same seed, same
output, so a measurement can be repeated.

The shape is core / distribution / access, because that is the topology where
"host + 6 hops" runs into the whole network — the case from
[#22](https://github.com/linuser/zabbix-network-topology/issues/22). A flat
chain would be easier to generate and would measure the opposite.

**The point is `soll.json`, written alongside**: which device hangs on which
port of which other one, *before* the module works it out. That turns a run
from a speed measurement into a correctness measurement — a false split or a
false merge shows up as a difference against a known answer. With five devices
you see that by eye; with two hundred you do not, and the false split is the
expensive failure mode (see CLAUDE.md).

| Option | Meaning |
|---|---|
| `--anzahl` | devices in total |
| `--zugang-je-verteiler` | access switches per distribution switch |
| `--lag-anteil` | share of connections built as a bundle of 2–4 cables |
| `--geister-anteil` | share of devices reporting a neighbour that has no host |
| `--einseitig-anteil` | share of cables reported from **one** end only |
| `--seed` | repeat a run exactly |

The generator checks its own output with `tools/check-snmprec.mjs` — the same
gate the evidence goes through, not a second copy of the rules.

**Before measuring, check the queue.** `ZBX_STARTSNMPPOLLERS` is 4 in the
compose file. Two hundred devices on a one-minute interval fill the queue with
that, and then the number on the screen is Zabbix's backlog, not the module's
cost. Raise the pollers, wait for *Administration → Queue* to be empty, and
only then look at the Diag tab.

## Writing a new device

A line is `OID|TAG|VALUE`. Tag 4 is an octet string, `4x` the same thing in hex,
6 an OID, 65 a Counter32, 66 a Gauge32.

Two rules that cost an afternoon each when broken, and both are now enforced by
`npm run ci:snmprec`:

- **Sorted by OID, numerically.** snmpsim searches the file as an index. Behind
  the first line that is out of order, everything answers `No Such Instance` —
  no error, no log line, just a device that seems to know nothing.
- **Hex values without `0x`.** `4x|001122aabb01` is right, `4x|0x001122aabb01`
  is silently unreadable, and the whole subtree below it disappears.

## Why the web container is built here

The official `zabbix-web` image ships without APCu — and `NtCache` is a no-op
without it. That is not just a missing cache: the topology **baseline** lives
there. Without it the diff never reports a change ("cable gone", "replugged"),
edges never age into dashed ex-links, and the Diag tab shows an empty ring
buffer.

So this network could not reproduce the very things 5.4.0 is about. Noticed
while trying to capture the notification for a failed LAG member: it never
came, and the module was not the reason. `web/Dockerfile` adds the extension,
nothing else.

The PHP version is pinned by the base image (php85 today). When Zabbix moves
it, the package name here has to move with it — the build then fails, which is
the right direction for that kind of surprise: loud, not silent.

## Two notes on snmpsim

- The package is `snmpsim-lextudio`, and **1.1.1 is the last version** — higher
  numbers do not exist.
- It insists on dropping privileges, so `--process-user` and `--process-group`
  are not optional, even on an unprivileged port.

## What is still missing

- Counters do not move: the values in the files are static, so "per second"
  comes out as zero. snmpsim's `numeric` variation module can count for us.
- A port that is **down** exists (`tplink-lldp.snmprec` has `ifOperStatus` 2 on
  interface 7), but the module only sees it when the host carries matching
  `net.if.status[<ifIndex>]` items. The bundled LLDP template does not create
  them — add them by hand, or link an interface template, and the LAG between
  `lab-tplink-01` and `lab-switch-24` turns into the one picture worth having:
  `×2 (1 down)`.
- A second instance on 7.4 for the widgets, and one on 8.0 to finally test the
  branch that has been waiting for a test instance.
