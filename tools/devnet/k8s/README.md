# The load test on Kubernetes

Two hundred simulated SNMP devices, each on its own address, with their own
Zabbix beside them. This directory holds the manifests; the devices themselves
come from `tools/devnet/erzeuge-geraete.mjs`.

## Why it is built this way

**One snmpsim pod, one Service per device.** In the compose stack all devices
answer on a single address and the community string picks the file. Fine for
five pieces of evidence, wrong here: `LldpEdgeBuilder` has a matching stage
that works on IP addresses, and two hundred devices behind one address measure
nonsense there instead of load. Two hundred pods would be the expensive way
out — two hundred Services with the same selector give every device its own
ClusterIP while a single pod answers all of them.

**Zabbix has to live in the cluster.** ClusterIPs are not reachable from
outside it, so a Zabbix server anywhere else could not poll a single device.

**The devices are a recipe, not a payload.** Two hundred `.snmprec` files are
about 1.6 MB and a ConfigMap may hold 1 MiB. The generator therefore runs as
an initContainer and writes into an `emptyDir`; the same seed produces the same
files, and changing the size of the test is one line in `40-snmpsim.yaml`.

## Setting it up

Everything below was run against k3s v1.35.5 on a single control-plane node.

**1. Namespace and the database password.** The password is generated on the
node and written straight into a Secret — it is never typed, logged or stored
in a file here.

```bash
kubectl apply -f 00-namespace.yaml
kubectl -n nt-last create secret generic nt-last-db \
    --from-literal=passwort="$(openssl rand -base64 24)"
kubectl apply -f 10-db.yaml -f 20-zabbix.yaml
```

**2. The frontend image.** The official image has no APCu, and without APCu
`NtCache` is a no-op: no topology baseline, no change notifications, no ageing
edges — and an **empty Diag tab**, which is exactly where the memory figures of
this whole exercise land. Build it from the same Dockerfile the compose stack
uses, on the node:

```bash
apt-get install -y buildah                      # the node has only ctr
buildah bud -t nt-web-apcu:7.0 -f Dockerfile .  # from tools/devnet/web/
buildah push localhost/nt-web-apcu:7.0 \
    oci-archive:/tmp/nt-web.tar:docker.io/library/nt-web-apcu:7.0
ctr -n k8s.io images import /tmp/nt-web.tar
```

> The `docker.io/library/` prefix in the archive name is not decoration.
> kubelet normalises `nt-web-apcu:7.0` to `docker.io/library/nt-web-apcu:7.0`
> and looks for exactly that; an image imported under the bare name sits in
> containerd while the pod hangs in `ImagePullBackOff` reporting that the
> repository does not exist.

**3. The module and the frontend.** The module directory is a `hostPath` mount,
so the working tree goes to the node first:

```bash
tar -czf modul.tgz -C tools/clean-install-test/module network_topology
scp modul.tgz <node>:/tmp/ && ssh <node> \
    'tar -xzf /tmp/modul.tgz -C /tmp && cp -a /tmp/network_topology/. /opt/nt-last/modul/'
kubectl apply -f 30-web.yaml
```

The frontend is then on `http://<node>:30081`. **This is a Zabbix that has
never seen the module, so "Scan directory" is genuinely required here** — new
module *directory*, not new action.

**4. The devices.**

```bash
kubectl -n nt-last create configmap nt-generator \
    --from-file=tools/devnet/erzeuge-geraete.mjs \
    --from-file=tools/check-snmprec.mjs
kubectl apply -f 40-snmpsim.yaml

node tools/devnet/erzeuge-geraete.mjs --anzahl 200 --geister-anteil 0.08 --seed 1
node tools/devnet/k8s/erzeuge-manifeste.mjs --ip-basis 10.43.200.1
kubectl apply -f tools/devnet/geraete-generiert/50-services.yaml
```

Check one before going further:

```bash
snmpget -v2c -c lab-gen-core-0001 10.43.200.1 1.3.6.1.2.1.1.5.0
snmpwalk -v2c -c lab-gen-core-0001 10.43.200.1 1.0.8802.1.1.2.1.4.1.1.9
```

The second command must list the neighbours, a bundled link showing the same
name once per cable.

**5. The hosts in Zabbix.** Needs an API token: sign in to the frontend, create
one under *Users → API tokens*, put it in a file.

```bash
python3 tools/devnet/erzeuge-hosts.py --token-datei ~/.nt-last-token \
    --hosts-datei tools/devnet/geraete-generiert/hosts.json \
    --url http://<node>:30081/api_jsonrpc.php
python3 tools/devnet/setup.py --token-datei ~/.nt-last-token \
    --url http://<node>:30081/api_jsonrpc.php
```

## Before believing any number

**Look at the queue, and raise the intervals first.** Measured at 1000
devices: `setup.py` leaves the LLDP interval at 1 minute, the standard
interface template polls at 1 m and 3 m, and a few items at 30 s. Together
that is around 300 polls per second, which four shared cores do not keep up
with — roughly 16,000 of 57,000 items ran permanently late. The map then
reads stale values and the measurement is of the backlog, not the module.

At 5 minutes for both the LLDP items and the interface prototypes it settles.
The map does not care: it reads last values, not intervals.

```bash
# the host macros win over the template, so remove them first — one call
# instead of a thousand host.update
kubectl ... # see the API snippet in the load-test notes
```

**And check lateness against each item's own interval, not against a fixed
number.** A first attempt flagged 8,000 items as late by comparing everything
to 15 minutes; 2,880 of them were `net.if.type` on an hourly interval and
5,000 were `system.*` on a quarter-hourly one, all of them perfectly on time.
The items that matter for the map — `lldpRem*` and `net.if.in/out` — were
current throughout.

`ZBX_STARTSNMPPOLLERS` is set to 50 in `20-zabbix.yaml`, but that is an
assumption — the queue is the answer.

**Then read the Diag tab.** The `data` rows carry `Memory`, `KB/edge`,
`items:` and a per-stage breakdown of the request. This setup was built to put
numbers under `MAX_EDGES` (6000, resting on a hand-measured 5.9 KB per edge)
and `MAX_HOP_HOSTS` (1000, resting on nothing). It did, and the answer was not
the one either constant assumes:

| | |
|---|---|
| 1000 devices, 1425 edges | 43200 items — thirty per edge drawn |
| edge building | 33 ms of 1581 ms, 2% |
| fetching the values | ~950 ms, 58% |
| retained memory | 7.3 KB per edge, 34 MB of 512 |

**Neither host count nor edge count is the cost driver — the item count is,**
and nothing guards it. The same finding came out of the hop-limit run before
it. Expect to be wrong here: over one session the edge builder, the SQL chunk
size and the idea of fetching fewer values were each the obvious culprit, and
each was measured out of the running.

Correctness is a separate question and this setup answers it too: the map drew
1425 edges against 1425 cables in `soll.json`, and 79 ghosts against 79.

**And compare against `soll.json`.** It says which device hangs on which port
of which other one, written before the module worked it out. A map that draws
more edges than the file lists has split a cable; fewer, and it has merged two.

## Taking it down

```bash
kubectl delete ns nt-last          # everything in this file lives there
```

The generated device files and manifests are in `geraete-generiert/`, which is
not checked in — `erzeuge-geraete.mjs` recreates them in seconds.
