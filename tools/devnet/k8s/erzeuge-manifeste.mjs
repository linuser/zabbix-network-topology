#!/usr/bin/env node
// erzeuge-manifeste.mjs — aus soll.json werden Services und eine Hostliste.
//
// WARUM EIN SERVICE JE GERAET
// ---------------------------
// Im Compose-Stack bedient EIN snmpsim alle Geraete, und der Community-String
// waehlt die Datei. Alle fuenf haengen damit an derselben Adresse. Fuer fuenf
// Belege ist das egal, fuer einen Lasttest nicht: LldpEdgeBuilder hat eine
// Zuordnungsstufe ueber IP-Adressen, und wenn zweihundert Geraete dieselbe
// IP tragen, misst man dort Unsinn statt Last.
//
// Zweihundert Pods zu starten waere die teure Loesung. Die billige: ein
// snmpsim-Pod, zweihundert Services mit DEMSELBEN Selector. Jeder Service
// bekommt eine eigene ClusterIP, alle zeigen auf denselben Pod, und der
// Community-String waehlt weiter die Datei. Aus Sicht von Zabbix ist jedes
// Geraet eine eigene Adresse.
//
// Die Adressen kommen aus dem SERVICE-NETZ des Clusters (bei k3s ueblich
// 10.43.0.0/16), sind also clusterintern — kein Stueck aus dem Netz, in dem
// die Proxmox-Knoten stehen. Deshalb muss der Zabbix-Server mit IN den
// Cluster: von aussen ist eine ClusterIP nicht erreichbar.
//
// Die IPs werden FEST vergeben und nicht hinterher ausgelesen. Sonst muesste
// die Hostliste auf das Anlegen der Services warten und beides koennte
// auseinanderlaufen; so kennen Manifest und Zabbix-Host dieselbe Adresse aus
// derselben Rechnung.
//
// Aufruf:
//   node tools/devnet/k8s/erzeuge-manifeste.mjs --ip-basis 10.43.200.1
//
// Vorher laeuft erzeuge-geraete.mjs. Was hier entsteht, ist erzeugt und
// gehoert nicht in den Commit.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STANDARD = {
    soll: 'tools/devnet/geraete-generiert/soll.json',
    ziel: 'tools/devnet/geraete-generiert',
    'ip-basis': '',
    namensraum: 'nt-last',
    'snmp-port': 1161,
    gruppen: '',
};

const HILFE = `
erzeuge-manifeste.mjs — Services und Hostliste aus soll.json

  --ip-basis A.B.C.D   erste ClusterIP, aus dem Service-Netz des Clusters
                       (k3s meist 10.43.0.0/16) — PFLICHT
  --soll PFAD          Soll-Datei                 (${STANDARD.soll})
  --ziel PFAD          Ausgabeverzeichnis         (${STANDARD.ziel})
  --namensraum NAME    Kubernetes-Namespace       (${STANDARD.namensraum})
  --snmp-port N        Port des snmpsim-Pods      (${STANDARD['snmp-port']})
  --gruppen A:200,B:300,C:500
                       Hosts auf mehrere Zabbix-Gruppen aufteilen, in
                       dieser Reihenfolge. Damit laesst sich dieselbe
                       Installation bei 200, 500 und 1000 Hosts messen,
                       indem man eine, zwei oder drei Gruppen auswaehlt —
                       ohne sie dreimal aufzubauen.

Die Service-CIDR steht auf dem Node in der kube-apiserver-Konfiguration
(k3s: --service-cidr, Standard 10.43.0.0/16). Eine Basis ausserhalb davon
lehnt der Cluster beim Anlegen ab — laut und sofort, nicht still.
`;

function parameter(argv) {
    const w = { ...STANDARD };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--hilfe' || a === '--help' || a === '-h') {
            console.log(HILFE);
            process.exit(0);
        }
        const name = a.startsWith('--') ? a.slice(2) : null;
        if (name === null || !(name in w)) {
            throw new Error(`unbekanntes Argument: ${a}${HILFE}`);
        }
        const wert = argv[++i];
        if (wert === undefined) throw new Error(`--${name} ohne Wert`);
        w[name] = name === 'snmp-port' ? Number(wert) : wert;
    }
    if (!w['ip-basis']) {
        throw new Error(`--ip-basis fehlt.${HILFE}`);
    }
    // Hier pruefen, nicht erst beim Rechnen: sonst kommt eine Tippfehler-IP
    // als Stacktrace heraus statt als Satz.
    zuZahl(w['ip-basis']);
    if (!Number.isInteger(w['snmp-port']) || w['snmp-port'] < 1 || w['snmp-port'] > 65535) {
        throw new Error(`--snmp-port ausserhalb 1..65535`);
    }
    return w;
}

// ── IPv4 als Zahl ──────────────────────────────────────────────────────────
//
// Von Hand am letzten Oktett hochzuzaehlen geht bis .255 gut und danach
// falsch. Ein Lasttest mit 300 Geraeten laeuft genau da hinein.

function zuZahl(ip) {
    const t = ip.split('.').map(Number);
    if (t.length !== 4 || t.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) {
        throw new Error(`keine IPv4-Adresse: ${ip}`);
    }
    return ((t[0] << 24) >>> 0) + (t[1] << 16) + (t[2] << 8) + t[3];
}

const zuText = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

// ── YAML von Hand ──────────────────────────────────────────────────────────
//
// Kein YAML-Paket: die Struktur ist immer dieselbe, und eine Abhaengigkeit
// mehr heisst ein Gate mehr, das rot werden kann (ci:audit fragt die
// Advisory-Datenbank live ab). Die Werte sind erzeugte Namen und Zahlen, kein
// fremder Text.

function service(w, geraet, ip) {
    if (!/^[a-z0-9-]+$/.test(geraet.name)) {
        throw new Error(`Name taugt nicht als Kubernetes-Objekt: ${geraet.name}`);
    }
    return `---
apiVersion: v1
kind: Service
metadata:
  name: ${geraet.name}
  namespace: ${w.namensraum}
  labels:
    app: snmpsim
    nt-rolle: ${geraet.rolle}
    nt-erzeugt: "ja"
spec:
  type: ClusterIP
  clusterIP: ${ip}
  selector:
    app: snmpsim
  ports:
    - name: snmp
      protocol: UDP
      port: 161
      targetPort: ${w['snmp-port']}
`;
}

function main() {
    let w;
    try {
        w = parameter(process.argv.slice(2));
    } catch (e) {
        console.error(`\n✖ ${e.message}\n`);
        return 2;
    }

    let soll;
    try {
        soll = JSON.parse(readFileSync(w.soll, 'utf8'));
    } catch (e) {
        console.error(`\n✖ ${w.soll} nicht lesbar — erst erzeuge-geraete.mjs laufen lassen.\n  ${e.message}\n`);
        return 2;
    }

    // "A:200,B:300" -> Liste von Gruppennamen, einer je Host.
    const gruppenPlan = [];
    if (w.gruppen) {
        w.gruppen.split(',').forEach(function(teil) {
            const p2 = teil.split(':');
            const name = (p2[0] || '').trim();
            const anzahl = Number(p2[1]);
            if (!name || !Number.isFinite(anzahl) || anzahl < 1) {
                throw new Error(`--gruppen: "${teil}" ist kein NAME:ANZAHL`);
            }
            for (let i = 0; i < anzahl; i++) gruppenPlan.push(name);
        });
    }

    const basis = zuZahl(w['ip-basis']);
    const hosts = [];
    let yaml = `# ERZEUGT von tools/devnet/k8s/erzeuge-manifeste.mjs — nicht bearbeiten.\n`
        + `# Quelle: ${w.soll} (Seed ${soll.parameter?.seed})\n`
        + `# ${soll.geraete.length} Services, alle auf denselben snmpsim-Pod.\n`;

    soll.geraete.forEach((g, i) => {
        const ip = zuText(basis + i);
        yaml += service(w, g, ip);
        hosts.push({
            host: g.name,
            ip,
            community: g.community,
            rolle: g.rolle,
            // Die Gruppe trennt die Lasttest-Hosts von allem anderen. Ohne
            // das zieht eine Kartenansicht "alle Gruppen" die zweihundert
            // mit, und jede andere Messung im selben Zabbix ist hinueber.
            // Mit --gruppen wird zusaetzlich AUFGETEILT, damit sich dieselbe
            // Installation bei verschiedenen Groessen messen laesst.
            gruppe: gruppenPlan[i] || 'Lasttest',
        });
    });

    mkdirSync(w.ziel, { recursive: true });
    writeFileSync(join(w.ziel, '50-services.yaml'), yaml);
    writeFileSync(join(w.ziel, 'hosts.json'), JSON.stringify({
        erzeugt_von: 'tools/devnet/k8s/erzeuge-manifeste.mjs',
        namensraum: w.namensraum,
        ip_von: zuText(basis),
        ip_bis: zuText(basis + hosts.length - 1),
        hosts,
    }, null, 2) + '\n');

    console.log(`
  ${hosts.length} Services  ->  ${join(w.ziel, '50-services.yaml')}
  Adressen ${zuText(basis)} … ${zuText(basis + hosts.length - 1)}
  Hostliste ->  ${join(w.ziel, 'hosts.json')}

  Naechster Schritt auf dem Node:
    kubectl apply -f 50-services.yaml
    python3 tools/devnet/erzeuge-hosts.py --token-datei ~/.devnetz-token \\
        --hosts-datei hosts.json
`);
    return 0;
}

process.exit(main());
