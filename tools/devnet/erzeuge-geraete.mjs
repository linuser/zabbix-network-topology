#!/usr/bin/env node
// erzeuge-geraete.mjs — simulierte SNMP-Geraete in Massen, plus die Soll-Datei.
//
// WOZU
// ----
// Die Dateien in geraete/ sind BELEGE: je eine pro echter Fehlermeldung, und
// ihr Wert liegt darin, dass sie genau einen Vorfall nachstellen. Fuer die
// Frage "haelt das Modul 200 Geraete aus?" taugen sie nicht — dafuer braucht
// es Masse, und Masse von Hand zu schreiben ist weder machbar noch sinnvoll.
//
// Deshalb schreibt dieses Skript in ein EIGENES Verzeichnis
// (geraete-generiert/, nicht eingecheckt). Erzeugtes neben Belege zu legen
// heisst, dass irgendwann jemand einen Beleg wegraeumt, weil er ihn fuer
// Generat haelt — oder ein Generat pflegt, als haenge eine Fehlermeldung
// daran.
//
// DIE SOLL-DATEI IST DER EIGENTLICHE PUNKT
// ----------------------------------------
// Neben den .snmprec-Dateien entsteht soll.json: welches Geraet haengt ueber
// welchen Port an welchem, bevor das Modul es ausrechnet. Damit misst ein
// Lauf nicht nur Tempo, sondern RICHTIGKEIT bei Groesse — falsche
// Aufspaltungen und falsche Verschmelzungen fallen auf. Bei fuenf Geraeten
// sieht man das von Hand, bei zweihundert nicht mehr, und laut CLAUDE.md ist
// die falsche Aufspaltung die teure Fehlerart.
//
// Aufruf:
//   node tools/devnet/erzeuge-geraete.mjs --anzahl 200
//   node tools/devnet/erzeuge-geraete.mjs --anzahl 50 --lag-anteil 0.3 --seed 7
//
// Alle Werte sind ERFUNDEN. Kein Walk aus einem echten Netz, auch nicht
// leicht veraendert — dieselbe Regel wie fuer die Belege.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Nachbarskript ueber die eigene Lage finden, nicht ueber das
// Arbeitsverzeichnis. Mit einem relativen Pfad lief der Selbsttest nur aus
// dem Wurzelverzeichnis des Repositories, und im Pod des Lasttests liegt das
// Skript ohnehin woanders. Schlimmer war die Meldung: "der Generator hat
// ungueltige Dateien geschrieben", obwohl nur der Pruefer fehlte.
const PRUEFER = fileURLToPath(new URL('../check-snmprec.mjs', import.meta.url));

// ── Parameter ──────────────────────────────────────────────────────────────

const STANDARD = {
    anzahl: 200,
    'zugang-je-verteiler': 12,
    'lag-anteil': 0.15,
    'geister-anteil': 0.05,
    'einseitig-anteil': 0.03,
    seed: 1,
    ziel: 'tools/devnet/geraete-generiert',
};

const HILFE = `
erzeuge-geraete.mjs — simulierte SNMP-Geraete fuer den Lasttest

  --anzahl N              Geraete insgesamt            (${STANDARD.anzahl})
  --zugang-je-verteiler N Zugangs-Switches je Verteiler (${STANDARD['zugang-je-verteiler']})
  --lag-anteil F          Anteil Verbindungen als LAG   (${STANDARD['lag-anteil']})
  --geister-anteil F      Anteil Geraete mit Geister-Nachbar (${STANDARD['geister-anteil']})
  --einseitig-anteil F    Anteil nur von EINER Seite gemeldeter Kabel (${STANDARD['einseitig-anteil']})
  --seed N                Zufallssaat, gleicher Seed = gleiche Ausgabe (${STANDARD.seed})
  --ziel PFAD             Ausgabeverzeichnis           (${STANDARD.ziel})
`;

function parameter(argv) {
    const w = { ...STANDARD };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--hilfe' || a === '--help' || a === '-h') {
            console.log(HILFE);
            process.exit(0);
        }
        if (!a.startsWith('--')) {
            throw new Error(`unbekanntes Argument: ${a}`);
        }
        const name = a.slice(2);
        if (!(name in w)) {
            throw new Error(`unbekannter Parameter: --${name}${HILFE}`);
        }
        const wert = argv[++i];
        if (wert === undefined) {
            throw new Error(`--${name} ohne Wert`);
        }
        w[name] = name === 'ziel' ? wert : Number(wert);
        if (name !== 'ziel' && !Number.isFinite(w[name])) {
            throw new Error(`--${name} braucht eine Zahl, bekam "${wert}"`);
        }
    }
    if (w.anzahl < 3) {
        throw new Error('--anzahl unter 3 ergibt kein Netz (zwei Kerne plus etwas)');
    }
    for (const k of ['lag-anteil', 'geister-anteil', 'einseitig-anteil']) {
        if (w[k] < 0 || w[k] > 1) {
            throw new Error(`--${k} liegt ausserhalb von 0..1`);
        }
    }
    return w;
}

// ── Zufall mit Saat ────────────────────────────────────────────────────────
//
// Math.random() waere hier falsch: ein Lasttest, der sich nicht wiederholen
// laesst, vergleicht zwei verschiedene Netze miteinander. Mulberry32, weil es
// in zehn Zeilen passt und niemand hier Kryptographie braucht.

function saatGenerator(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Das Netz ───────────────────────────────────────────────────────────────
//
// Kern / Verteilung / Zugang, weil das die Form ist, bei der "Host + 6 Hops"
// in ein ganzes Netz laeuft — der Fall aus #22. Eine flache Kette waere
// bequemer zu erzeugen und wuerde das Gegenteil messen.

const ROLLE = {
    kern:      { ports: 48, praefix: 'core', speed: 10000 },
    verteiler: { ports: 24, praefix: 'dist', speed: 10000 },
    zugang:    { ports: 24, praefix: 'acc',  speed: 1000 },
};

function baueNetz(w, zufall) {
    const geraete = [];
    const neu = (rolle, nr) => {
        const name = `lab-gen-${ROLLE[rolle].praefix}-${String(nr).padStart(4, '0')}`;
        const g = {
            name, rolle,
            index: geraete.length + 1,
            ports: ROLLE[rolle].ports,
            speed: ROLLE[rolle].speed,
            naechsterPort: 1,
            nachbarn: [],   // {port, fern_name, fern_port, fern_mac, melden}
        };
        geraete.push(g);
        return g;
    };

    const kerne = [neu('kern', 1), neu('kern', 2)];

    // Wie viele Verteiler: so viele, dass die uebrigen Geraete als Zugang
    // darunter passen. Mindestens einer, sonst haengt alles direkt am Kern
    // und der Hop-Abstand bleibt bei zwei.
    const uebrig = w.anzahl - kerne.length;
    const verteilerZahl = Math.max(1, Math.ceil(uebrig / (w['zugang-je-verteiler'] + 1)));
    const verteiler = [];
    for (let i = 1; i <= verteilerZahl && geraete.length < w.anzahl; i++) {
        verteiler.push(neu('verteiler', i));
    }
    const zugang = [];
    for (let i = 1; geraete.length < w.anzahl; i++) {
        zugang.push(neu('zugang', i));
    }

    const kanten = [];
    let buendelId = 0;

    // Eine Verbindung: ein oder mehrere Kabel zwischen zwei Geraeten. Jedes
    // Kabel bekommt an beiden Enden einen eigenen Port — das ist genau die
    // Identitaet, die das Backend seit 5.4.0 vergibt.
    const verbinde = (a, b, kabelZahl) => {
        buendelId++;
        const einseitig = zufall() < w['einseitig-anteil'];
        for (let k = 0; k < kabelZahl; k++) {
            const pa = a.naechsterPort++;
            const pb = b.naechsterPort++;
            if (pa > a.ports || pb > b.ports) {
                throw new Error(`${a.name}/${b.name}: Ports alle — --zugang-je-verteiler senken`);
            }
            // Bei einseitigen Kabeln meldet nur A. Das ist der Fall, in dem
            // das Modul dieselbe Leitung aus einer einzigen Richtung erkennen
            // muss, und er kommt in echten Netzen dauernd vor (ein Ende ohne
            // LLDP, ein Ende nicht ueberwacht).
            a.nachbarn.push({ port: pa, fern: b, fern_port: pb });
            if (!einseitig) {
                b.nachbarn.push({ port: pb, fern: a, fern_port: pa });
            }
            kanten.push({
                a: a.name, port_a: portName(a, pa),
                b: b.name, port_b: portName(b, pb),
                buendel: buendelId, kabel_im_buendel: kabelZahl,
                beidseitig: !einseitig,
            });
        }
    };

    const kabelZahl = () => (zufall() < w['lag-anteil'] ? 2 + Math.floor(zufall() * 3) : 1);

    // Der Kern-Spine ist immer ein LAG. Ohne ihn haengt die Karte an einem
    // einzelnen Kabel, und jede Ausfall-Simulation zerfaellt in zwei Haelften.
    if (kerne.length === 2) {
        verbinde(kerne[0], kerne[1], 2);
    }
    for (const v of verteiler) {
        for (const kern of kerne) {
            verbinde(kern, v, kabelZahl());
        }
    }
    zugang.forEach((z, i) => {
        verbinde(verteiler[i % verteiler.length], z, kabelZahl());
    });

    // Geister: Nachbarn, zu denen es keinen Host gibt. In echten Netzen sind
    // das Accesspoints, Telefone, Drucker — das Modul zeichnet sie als
    // Geisterknoten, und ihre Zahl entscheidet mit ueber die Kartengroesse.
    const geister = [];
    for (const g of geraete) {
        if (g.rolle === 'kern' || zufall() >= w['geister-anteil']) continue;
        const port = g.naechsterPort++;
        if (port > g.ports) continue;
        const name = `gen-ap-${String(geister.length + 1).padStart(4, '0')}`;
        g.nachbarn.push({ port, fernName: name, fern_port: 'eth0', fernMac: mac(9000 + geister.length) });
        geister.push({ name, an: g.name, port: portName(g, port) });
    }

    return { geraete, kanten, geister, verteilerZahl };
}

// ── SNMP-Darstellung ───────────────────────────────────────────────────────

const OID = {
    sysDescr: '1.3.6.1.2.1.1.1.0',
    sysObjectID: '1.3.6.1.2.1.1.2.0',
    sysName: '1.3.6.1.2.1.1.5.0',
    ifNumber: '1.3.6.1.2.1.2.1.0',
    ifIndex: '1.3.6.1.2.1.2.2.1.1',
    ifDescr: '1.3.6.1.2.1.2.2.1.2',
    ifType: '1.3.6.1.2.1.2.2.1.3',
    ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
    ifInOctets: '1.3.6.1.2.1.2.2.1.10',
    ifOutOctets: '1.3.6.1.2.1.2.2.1.16',
    ifName: '1.3.6.1.2.1.31.1.1.1.1',
    ifHighSpeed: '1.3.6.1.2.1.31.1.1.1.15',
    ifAlias: '1.3.6.1.2.1.31.1.1.1.18',
    lldpLocPortId: '1.0.8802.1.1.2.1.3.7.1.3',
    lldpRemChassisId: '1.0.8802.1.1.2.1.4.1.1.5',
    lldpRemPortId: '1.0.8802.1.1.2.1.4.1.1.7',
    lldpRemPortDesc: '1.0.8802.1.1.2.1.4.1.1.8',
    lldpRemSysName: '1.0.8802.1.1.2.1.4.1.1.9',
    lldpRemSysDesc: '1.0.8802.1.1.2.1.4.1.1.10',
    lldpRemSysCapEnabled: '1.0.8802.1.1.2.1.4.1.1.12',
};

// lldpRemSysCapEnabled, erstes Byte, Bits nach IEEE 802.1AB:
// 0x20 Bridge, 0x10 WLAN-AP, 0x08 Router, 0x04 Telefon.
//
// Dass diese beiden OIDs anfangs FEHLTEN, hat erst der Lauf im Cluster
// gezeigt: 1.186 Items blieben ohne Wert, weil das Template sie abfragt und
// niemand sie beantwortete. Das Modul liest beide — SysDesc als Hersteller
// und Modell, die Faehigkeiten fuer die Geraeteart, also Symbol und
// Einordnung. Ohne sie waere der Lasttest eine Karte aus lauter unbekannten
// Kaesten gewesen und haette etwas anderes gemessen als eine echte.
const FAEHIGKEIT = {
    kern:      '2800',   // Bridge + Router
    verteiler: '2800',
    zugang:    '2000',   // nur Bridge
    geist:     '1000',   // WLAN-AP — die Geister sind Accesspoints
};

const SYSBESCHREIBUNG = {
    kern:      'GENERATED core switch (erzeuge-geraete.mjs)',
    verteiler: 'GENERATED distribution switch (erzeuge-geraete.mjs)',
    zugang:    'GENERATED access switch (erzeuge-geraete.mjs)',
    geist:     'GENERATED wireless access point (erzeuge-geraete.mjs)',
};

const portName = (g, nr) => (g.rolle === 'zugang' ? `Gi1/0/${nr}` : `Te1/0/${nr}`);

// Lokal verwaltete MAC (02:...) — schon am ersten Byte als erfunden erkennbar.
function mac(index) {
    const h = index.toString(16).padStart(10, '0');
    return ('02' + h).slice(0, 12);
}

function oidVergleich(a, b) {
    const x = a.split('.').map(Number);
    const y = b.split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const va = x[i] === undefined ? -1 : x[i];
        const vb = y[i] === undefined ? -1 : y[i];
        if (va !== vb) return va - vb;
    }
    return 0;
}

function snmprec(g, seed) {
    // Zeilen als Map sammeln und am Ende numerisch sortieren. Von Hand in der
    // richtigen Reihenfolge zu schreiben ginge auch — bis jemand eine OID
    // ergaenzt. snmpsim sucht binaer und findet hinter der ersten falsch
    // einsortierten Zeile nichts mehr, ohne sich zu beschweren.
    const zeilen = new Map();
    const setze = (oid, tag, wert) => zeilen.set(oid, `${oid}|${tag}|${wert}`);

    setze(OID.sysDescr, 4,
        `${g.rolle} switch, ${g.ports} ports (GENERATED by erzeuge-geraete.mjs, seed ${seed})`);
    setze(OID.sysObjectID, 6, '1.3.6.1.4.1.8072.3.2.10');
    setze(OID.sysName, 4, g.name);
    setze(OID.ifNumber, 2, g.ports);

    for (let i = 1; i <= g.ports; i++) {
        const name = portName(g, i);
        const belegt = g.nachbarn.some((n) => n.port === i);
        setze(`${OID.ifIndex}.${i}`, 2, i);
        setze(`${OID.ifDescr}.${i}`, 4, name);
        setze(`${OID.ifType}.${i}`, 2, 6);
        // Nur belegte Ports sind up. Ein Switch, auf dem alle 48 Ports up
        // melden, obwohl an dreien ein Kabel haengt, faerbt die Karte rot —
        // das war eine echte Meldung im September.
        setze(`${OID.ifOperStatus}.${i}`, 2, belegt ? 1 : 2);
        setze(`${OID.ifInOctets}.${i}`, 65, (g.index * 1000003 + i * 700001) % 4000000000);
        setze(`${OID.ifOutOctets}.${i}`, 65, (g.index * 900007 + i * 500009) % 4000000000);
        setze(`${OID.ifName}.${i}`, 4, name);
        setze(`${OID.ifHighSpeed}.${i}`, 66, g.speed);
        setze(`${OID.ifAlias}.${i}`, 4, belegt ? `to ${g.nachbarn.find((n) => n.port === i).fern?.name
            || g.nachbarn.find((n) => n.port === i).fernName}` : '');
    }

    // LLDP. Der Index der Fern-Tabelle ist TimeMark.LokalerPort.Nummer —
    // TimeMark 0, wie in den Belegen. Die zweiteilige Form ohne TimeMark ist
    // die Besonderheit aus #15 und bleibt bei ihrem Beleg.
    g.nachbarn.forEach((n, i) => {
        const lokal = portName(g, n.port);
        const fernName = n.fern ? n.fern.name : n.fernName;
        const fernPort = n.fern ? portName(n.fern, n.fern_port) : n.fern_port;
        const fernMac = n.fern ? mac(n.fern.index) : n.fernMac;
        setze(`${OID.lldpLocPortId}.${n.port}`, 4, lokal);
        setze(`${OID.lldpRemChassisId}.0.${n.port}.${i + 1}`, '4x', fernMac);
        setze(`${OID.lldpRemPortId}.0.${n.port}.${i + 1}`, 4, fernPort);
        setze(`${OID.lldpRemPortDesc}.0.${n.port}.${i + 1}`, 4, fernPort);
        setze(`${OID.lldpRemSysName}.0.${n.port}.${i + 1}`, 4, fernName);
        const fernRolle = n.fern ? n.fern.rolle : 'geist';
        setze(`${OID.lldpRemSysDesc}.0.${n.port}.${i + 1}`, 4, SYSBESCHREIBUNG[fernRolle]);
        setze(`${OID.lldpRemSysCapEnabled}.0.${n.port}.${i + 1}`, '4x', FAEHIGKEIT[fernRolle]);
    });

    return [...zeilen.keys()].sort(oidVergleich).map((o) => zeilen.get(o)).join('\n') + '\n';
}

// ── Hauptlauf ──────────────────────────────────────────────────────────────

function main() {
    let w;
    try {
        w = parameter(process.argv.slice(2));
    } catch (e) {
        console.error(`\n✖ ${e.message}\n`);
        return 2;
    }

    const zufall = saatGenerator(w.seed);
    const netz = baueNetz(w, zufall);

    // Nur die EIGENEN Dateien wegraeumen, nicht das Verzeichnis. Zwei Gruende:
    // im Lasttest ist das Ziel ein Mount, und ein rmSync darauf scheitert mit
    // EBUSY — das war der erste Fehlschlag im Cluster. Der zweite Grund ist
    // der wichtigere: ein Verzeichnis mit --ziel loeschen zu lassen ist eine
    // Zeile, die bei einem Tippfehler das falsche Verzeichnis trifft.
    mkdirSync(w.ziel, { recursive: true });
    for (const d of readdirSync(w.ziel)) {
        if (d.endsWith('.snmprec') || d === 'soll.json') {
            rmSync(join(w.ziel, d), { force: true });
        }
    }

    for (const g of netz.geraete) {
        writeFileSync(join(w.ziel, `${g.name}.snmprec`), snmprec(g, w.seed));
    }

    const buendel = new Set(netz.kanten.map((k) => k.buendel));
    const soll = {
        erzeugt_am: new Date().toISOString().slice(0, 19) + 'Z',
        erzeugt_von: 'tools/devnet/erzeuge-geraete.mjs',
        hinweis: 'Alle Werte erfunden. Nicht einchecken, nicht pflegen — neu erzeugen.',
        parameter: w,
        erwartet: {
            geraete: netz.geraete.length,
            kanten: netz.kanten.length,
            buendel: buendel.size,
            geister: netz.geister.length,
            kanten_einseitig: netz.kanten.filter((k) => !k.beidseitig).length,
            verteiler: netz.verteilerZahl,
        },
        geraete: netz.geraete.map((g) => ({
            name: g.name, rolle: g.rolle, community: g.name,
            datei: `${g.name}.snmprec`, ports: g.ports,
            belegte_ports: g.nachbarn.length,
        })),
        kanten: netz.kanten,
        geister: netz.geister,
    };
    writeFileSync(join(w.ziel, 'soll.json'), JSON.stringify(soll, null, 2) + '\n');

    // Die Ausgabe gegen denselben Gate halten, der die Belege prueft. Ein
    // Generator, der unlesbare Dateien schreibt, faellt sonst erst auf, wenn
    // die Discovery nichts findet — und man sucht im Modul.
    const geprueft = spawnSync(process.execPath, [PRUEFER, w.ziel], { encoding: 'utf8' });
    process.stdout.write(geprueft.stdout || '');
    process.stderr.write(geprueft.stderr || '');
    if (geprueft.error || geprueft.status === null) {
        console.error(`\n✖ Selbsttest nicht gelaufen: ${PRUEFER} — ${geprueft.error?.message || 'abgebrochen'}`);
        console.error('  Die Dateien liegen trotzdem, sind aber UNGEPRUEFT.');
        return 1;
    }
    if (geprueft.status !== 0) {
        console.error('\n✖ Der Generator hat ungueltige Dateien geschrieben.');
        return 1;
    }

    console.log(`
  ${soll.erwartet.geraete} Geraete nach ${w.ziel}
  ${soll.erwartet.kanten} Kabel in ${soll.erwartet.buendel} Verbindungen`
        + ` (${soll.erwartet.kanten - soll.erwartet.buendel} davon in Buendeln)
  ${soll.erwartet.kanten_einseitig} Kabel nur von einer Seite gemeldet
  ${soll.erwartet.geister} Geister-Nachbarn ohne Host

  Soll-Stand: ${join(w.ziel, 'soll.json')}
`);
    return 0;
}

process.exit(main());
