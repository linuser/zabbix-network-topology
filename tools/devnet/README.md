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

## Two notes on snmpsim

- The package is `snmpsim-lextudio`, and **1.1.1 is the last version** — higher
  numbers do not exist.
- It insists on dropping privileges, so `--process-user` and `--process-group`
  are not optional, even on an unprivileged port.

## What is still missing

- Counters do not move: the values in the files are static, so "per second"
  comes out as zero. snmpsim's `numeric` variation module can count for us.
- A second instance on 7.4 for the widgets, and one on 8.0 to finally test the
  branch that has been waiting for a test instance.
