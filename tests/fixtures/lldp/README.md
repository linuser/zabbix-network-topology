# LLDP fixture library

Each `*.json` here is one real-shaped LLDP scenario. `tests/LldpFixtureTest.php`
loads every file, runs `LldpEdgeBuilder` against it, and checks the expected
edges/ports — so a parser fix for one vendor can't silently break another. The
test runs in `npm run ci:test` (it globs `tests/*Test.php`); nothing to wire up.

**To add a device:** drop a JSON file in here. The format (and every optional
field) is documented at the top of `tests/LldpFixtureTest.php`. Minimum is
`hosts`, `lldp_raw` and an `expect.edges` list.

**Keep the data invented or anonymised.** Like `tools/devnet`, these fixtures
ship in the repo (including the public mirror). Model them on a real walk's
*shape*, but use invented host names, ports and MACs — never a capture from a
customer network. The device report (since 5.3) gives you the shape to copy.

Current fixtures:

| File | Covers |
|---|---|
| `01-name-matching.json` | exact / FQDN+uppercase name match; unknown neighbour → unmatched, no false edge |
| `02-indexed-ports-portdesc.json` | indexed `lldpRemSysName[…]` keys; local port from the SNMP index; PortDesc preferred over a PortId that is a MAC |
| `03-port-normalization.json` | `Gi1/0/1` ↔ `GigabitEthernet1/0/1` → `normalized` port match |
| `04-port-normalization-digits.json` | `1/0/1` must not normalise onto `1/0/11` → no port match, edge still stands |
