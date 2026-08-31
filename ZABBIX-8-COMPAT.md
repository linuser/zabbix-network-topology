# Zabbix 8 — was wir gelernt haben

Interne Notiz zum Befund vom 29.08.2026. Sie erklärt, warum die Karte auf
Zabbix 8 leer blieb, wie wir darauf gekommen sind, warum der Fix so aussieht
wie er aussieht — und welche Wege wir vergeblich gegangen sind, damit das
niemand ein zweites Mal tut.

---

## Der Befund in drei Sätzen

Zabbix 8 legt `Array.prototype.xor` per `Object.defineProperty` an, ohne
`writable` und `configurable` zu nennen. Beide fallen damit auf `false` — die
Eigenschaft ist für die gesamte Seitenlebensdauer unveränderlich. Cytoscape
setzt beim Start sein eigenes `xor` auf einen Prototyp, der von
`Array.prototype` erbt, scheitert daran und bricht komplett ab.

Folge: `window.cytoscape` bleibt `undefined`, die Karte ist leer, **und in
unserem Code taucht kein einziger Fehler auf** — weil unser Code nie an die
Reihe kommt.

---

## Die Kette im Detail

### 1. Was Zabbix 8 tut

`ui/js/common.js:114`:

```js
Object.defineProperty(Array.prototype, 'xor', {
    value: function(arr) {
        const merged = this.concat(arr);
        return merged.filter(e => merged.indexOf(e) === merged.lastIndexOf(e));
    },
    enumerable: false
});
```

`Object.defineProperty` setzt jedes nicht genannte Attribut auf `false`. Der
resultierende Deskriptor, nachgemessen:

```
writable = false   configurable = false   enumerable = false
```

Beides hat Konsequenzen:

- **Zuweisen unmöglich.** `[[Set]]` darf eine nicht beschreibbare *geerbte*
  Eigenschaft nicht überschatten, und `Object.assign` benutzt `[[Set]]`.
- **Nicht rückgängig zu machen.** `delete Array.prototype.xor` gibt `false`
  zurück, Neudefinieren wirft `Cannot redefine property: xor`. Von außen ist an
  die Eigenschaft selbst nicht heranzukommen.

Die Absicht war vermutlich `enumerable: false`, damit der Helfer nicht mehr in
`for…in`-Schleifen über Arrays auftaucht. Das ist ein legitimes Ziel — die
Unveränderlichkeit ist ein Nebeneffekt der Defaults.

### 2. Was Cytoscape tut

Cytoscape legt seinen Collection-Prototyp mit `Object.create(Array.prototype)`
an, damit Collections sich array-artig verhalten, und merged darauf seine
Module — darunter ein eigenes `xor` (symmetrische Differenz, inhaltlich
dieselbe Idee wie der Zabbix-Helfer):

```js
[…, To, Mo, Io, qo, Wo].forEach(function(e){ Object.assign(Jo, e) })
```

Instrumentiert nachgewiesen: `proto === Array.prototype: true`, 189 eigene
Keys. Das ist Cytoscapes Design, nicht versionsspezifisch — ein Update der
Bibliothek hätte das Problem also **nicht** gelöst.

### 3. Das Ergebnis

```
TypeError: Cannot assign to read only property 'xor' of object '[object Object]'
```

Kein Engine-Bug, sondern korrektes ECMAScript-Verhalten. In Chrome 148 und
Safari identisch reproduziert.

---

## Warum nur 8.0

Gemessen an vier Installationen, jeweils dieselbe Datei, dieselbe Zeile:

| Zabbix | `js/common.js:114` | Folge |
|---|---|---|
| 7.0 (offizielles Image `zabbix-web-nginx-pgsql:alpine-7.0`) | `Array.prototype.xor = function(arr) {` | beschreibbar → keine Kollision |
| 7.4 (Produktivinstanz) | `Array.prototype.xor = function(arr) {` | beschreibbar → keine Kollision |
| 7.x (zweite Produktivinstanz) | `Array.prototype.xor = function(arr) {` | beschreibbar → keine Kollision |
| 8.0.0beta2 (Test-VM) | `Object.defineProperty(Array.prototype, 'xor', {…})` | **Kollision** |

Die 7.0-Zeile ist die nachprüfbarste: das Image lässt sich ziehen, die Datei
liegt unter `/usr/share/zabbix/js/common.js`. Wer die Aussage anzweifelt,
braucht dafür keinen Zugang zu irgendeiner unserer Instanzen.

Eine einfache Zuweisung lässt die Eigenschaft beschreibbar und konfigurierbar.
Zabbix hat in 8.0 genau diese eine Zeile umgestellt.

Zur Vollständigkeit geprüft: In ganz `ui/js/` gibt es **genau einen** weiteren
`defineProperty`-Aufruf auf einem Prototyp — `OverlayCollection.prototype.length`
in `class.overlaycollection.js:28`. Das ist eine Zabbix-eigene Klasse und
betrifft Dritte nicht.

---

## Der Fix

`assets/js/nt-assign-guard.js`. `Object.defineProperty` legt eine **eigene**
Eigenschaft an und schaut die Prototypkette gar nicht erst an — im Gegensatz
zur Zuweisung. Der Guard tauscht `Object.assign` nur für die Dauer des
Cytoscape-Ladens gegen eine Variante, die bei einem Fehlschlag darauf
ausweicht, und stellt das Original unmittelbar danach wieder her.

### Warum 7.0 und 7.4 nichts davon merken

Der Guard prüft vor dem Eingriff den **Deskriptor** und tut sonst gar nichts:

```js
var d = Object.getOwnPropertyDescriptor(Array.prototype, 'xor');
return !!d && d.writable === false && d.configurable === false;
```

Gemessen im offiziellen Image `zabbix/zabbix-web-nginx-pgsql:alpine-7.0`:
7.0 legt den Helfer in derselben Zeile `common.js:114` per **schlichter
Zuweisung** an — `Array.prototype.xor = function(arr) {…}`. Eine Zuweisung
erzeugt `writable: true, configurable: true`, Cytoscape überschattet sie
problemlos. Erst 8.0 stellt auf `Object.defineProperty` ohne diese beiden
Attribute um; die Umstellung war vermutlich als „nicht aufzählbar" gemeint,
damit `for…in` über Arrays den Helfer nicht mitnimmt.

Der Nutzen der Prüfung ist nicht Sparsamkeit, sondern eine Zusicherung: Auf
jeder Version, deren Deskriptor anders aussieht, wird `Object.assign`
**überhaupt nicht angefasst** — der Code läuft identisch zu dem ohne Guard.
Wir müssen also nicht wissen, was 7.4 oder ein künftiges 8.x tun; geprüft wird
die eine Bedingung, die den Fehler ausmacht.

Nachgestellt in sechs Fällen: 7.0-Form → kein Eingriff · kein `xor` → kein
Eingriff · 8.0-Form → Eingriff, Cytoscape lädt, der Zabbix-Helfer bleibt
funktionsfähig · zwei Widgets nacheinander → Zähler hält den Patch bis zum
letzten `off()` · `off()` ohne `on()` → wirkungslos · `safeAssign` gegen die
Spezifikation (Symbole, null-Quellen, String-Quellen, Getter, null-Ziel wirft,
Rückgabe ist das Ziel).

Verdrahtet an zwei Stellen:

- `views/network.topology.view.php` — Guard, `on()`, Cytoscape, `off()` als
  vier aufeinanderfolgende Script-Tags. Synchron, also deterministisch.
- `widget/assets/js/widget.class.js` → `_loadLibs()` — sequenziell statt
  `forEach`, weil die Reihenfolge tragend ist.

### Warum diese Form und keine andere

| Alternative | Warum nicht |
|---|---|
| Zabbix' `xor` löschen oder überschreiben | Geht nicht — nicht konfigurierbar. Nachgemessen. |
| Cytoscape updaten | Löst nichts. Die Kollision folgt aus Cytoscapes Prototyp-Design, nicht aus einer Version. |
| Minifizierte Bibliothek patchen | Bei jedem Upgrade wieder fällig. Der Guard überlebt Upgrades. |
| Cytoscape vor `common.js` laden | Nicht in unserer Hand — `common.js` ist Kern und lädt zuerst. |
| `Object.assign` dauerhaft ersetzen | Langsamer und in Randfällen (werfende Getter) anders. Das wollen wir Zabbix' eigenem Code nicht antun. |

### Was der Fix nachweislich leistet

Isoliert verifiziert, mit der echten Zabbix-Zeile davor:

```
Object.assign wiederhergestellt: ja (nativ)
Fehler beim Laden: keiner
Instanz: nodes=3 edges=2
xor() rechnet: 2 Knoten (erwartet 2)
Zabbix Array.prototype.xor unversehrt: [1,4]
Layout gelaufen: ja
```

Beide `xor`-Implementierungen koexistieren. Auf 7.0/7.4 ist der Guard
folgenlos — dort gibt es nichts abzufangen; Kosten: ein Request, 5 KB.

---

## Die diagnostische Lehre

**Das Symptom zeigte auf den falschen Ort.** Leere Fläche, keine Fehlermeldung,
Daten kamen mit HTTP 200 an. Alles deutete auf unseren Code oder die
Zabbix-API. Tatsächlich war die Bibliothek schon tot, bevor irgendetwas von uns
lief.

Merksatz für das nächste Mal: **Wenn die Fläche leer ist und der eigene Code
schweigt, ist der eigene Code vielleicht gar nicht gelaufen.** Zuerst prüfen,
ob die Abhängigkeiten überhaupt existieren (`typeof cytoscape`), erst danach
die eigene Logik.

Der entscheidende Schritt war die **isolierte Reproduktion**: eine HTML-Seite,
die nur die eine Zabbix-Zeile und die Bibliothek enthält. Damit ließ sich in
Minuten trennen, was Zabbix, was Browser, was Erweiterung, was unser Code ist.
Der kleinste Reproducer braucht am Ende nicht einmal Cytoscape:

```js
Object.defineProperty(Array.prototype, 'xor', { value: function(a){return a}, enumerable: false });
const proto = Object.create(Array.prototype);
Object.assign(proto, { xor: function(){} });   // TypeError
```

---

## Sackgassen — bitte nicht noch einmal

Alle vier sahen plausibel aus und waren falsch. Der Vollständigkeit halber
festgehalten, damit sie niemand erneut abläuft:

1. **„Die Daten-Action wird nie aufgerufen."** Ein Log-Filter, der `HTTP/1.1`
   direkt hinter dem Action-Namen verlangte, konnte die Daten-URL nie matchen —
   dort folgt `&groupids[]=…`. Tatsächlich lief sie 4×, alle 200.
2. **„jQuery ist in Zabbix 8 entfernt."** Ein `find` mit `-maxdepth 2` hat es
   verfehlt; es liegt unter `js/vendors/jQuery/jquery.js`.
3. **„Alte Cytoscape-Version verträgt sich nicht mit neuem Chrome."** Isoliert
   in Chrome 148 geladen: fehlerfrei, Instanz, `xor` vorhanden.
4. **„Eine Chrome-Erweiterung friert Objekte ein."** Die Console zeigte
   `Content Script: Initializing`. Inkognito reproduzierte den Fehler
   unverändert — und Safari ebenso.

Server- und deployseitig war übrigens alles in Ordnung, und das ließ sich
schnell zeigen: Bundle bit-identisch zum lokalen Build, alle Assets 200, keine
PHP-Fehler, alle `select*`-Optionen der `host.get`-Abfrage in 8.0 gültig.

---

## Konsequenzen für das Projekt

**Das Modul lief auf Zabbix 8 nie.** Die frühere Prüfung „Zabbix 8 akzeptiert
alle sechs Module ohne Fehler" war richtig, hat aber nur das **Laden** der
Module geprüft, nicht das Rendern. Die Karte war von Anfang an leer; es hat nur
niemand nachgesehen.

Daraus zwei Punkte:

- **Modul lädt ≠ Modul funktioniert.** Für künftige Versionsfreigaben gehört
  ein Blick auf die gerenderte Karte dazu, nicht nur auf die Modulliste.
- Mit dem Guard ist 8.0 real nutzbar. Ob wir es als unterstützte Version
  aufnehmen, ist eine eigene Entscheidung — Badges und README nennen bisher nur
  7.0 LTS und 7.4.

---

## Offen

- **Bugreport an Zabbix** ist formuliert, aber noch nicht abgeschickt. Vorher
  gegen ein aktuelleres 8.0-Paket prüfen, ob die Zeile noch so dasteht — die
  Messung stammt von `8.0.0beta2`.
- **Entscheidung zur Versionsunterstützung** (Badges, README, Testmatrix).
- **CHANGELOG-Eintrag** für den Guard.

---

## Belege

Test-VM: Zabbix `8.0.0beta2`, Paket `zabbix-frontend-php 2:8.0.0~beta2-1+debian13`,
Debian 13, PHP 8.4.24, nginx. Cytoscape `3.28.1`. Browser: Chrome 148, Safari.
Alle Angaben in diesem Dokument sind gemessen, nicht schlussgefolgert.
