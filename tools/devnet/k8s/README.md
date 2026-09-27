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

**Look at the queue.** *Administration → Queue* must be empty. Two hundred
devices with twenty-four ports each is a lot of SNMP for a host with four
cores, and a backlog there turns every measurement into a measurement of
Zabbix's backlog. `ZBX_STARTSNMPPOLLERS` is set to 50 in `20-zabbix.yaml`, but
that is an assumption — the queue is the answer.

**Then read the Diag tab.** The `data` rows carry `Memory` (peak against
`memory_limit`) and `KB/edge`. Those two numbers are what this setup exists
for: `MAX_EDGES` is 6000 on the strength of a hand-measured 5.9 KB per edge,
and `MAX_HOP_HOSTS` is 1000 on no measurement at all.

**And compare against `soll.json`.** It says which device hangs on which port
of which other one, written before the module worked it out. A map that draws
more edges than the file lists has split a cable; fewer, and it has merged two.

## Taking it down

```bash
kubectl delete ns nt-last          # everything in this file lives there
```

The generated device files and manifests are in `geraete-generiert/`, which is
not checked in — `erzeuge-geraete.mjs` recreates them in seconds.
