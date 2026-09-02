// layout-file.js — Layout als Datei sichern.
//
// EXPORT JA, IMPORT NEIN — und das ist eine Entscheidung, kein Rest.
//
// Presets sammeln denselben Zustand schon (collectCurrentState), nur liegen
// sie im localStorage: kein Browserwechsel, kein zweites Geraet, und schon gar
// nicht der Weg von einer Zabbix-Installation zur naechsten. Der Export
// schliesst diese Luecke — er liest nur und kann nichts kaputt machen.
//
// Der Import war gebaut und ist wieder ausgebaut worden. Ein Code-Review fand
// drei Defekte mit derselben Wurzel: der Apply-Pfad (applyPreset,
// setPositions, setLinks) ist fuer VOLLSTAENDIGE Zustaende aus der laufenden
// Karte geschrieben, eine importierte Datei ist aber ein beliebiger
// TEILzustand.
//
//   1. Der Re-Render speichert den live gerenderten Stand zurueck
//      (layoutstop -> savePositions). Im Cluster-Modus, dem Standard ab zwei
//      Hostgruppen, kommt der Import gar nicht erst an.
//   2. Ein Super-Admin schreibt geteilt, und setPositions() ersetzt die Ebene
//      KOMPLETT — zwoelf importierte Knoten loeschen die Positionen aller
//      uebrigen Hosts, fuer alle Nutzer.
//   3. loadLinks() mischt geteilte und persoenliche Kanten, die Datei traegt
//      die Ebene nicht mit, setLinks() schreibt alles in defaultLinkScope().
//
// Ein vierter Defekt war schlimmer und ist behoben: fehlende Abschnitte in der
// Datei loeschten den jeweiligen Bestand, weil {} und [] truthy sind und die
// Waechter in applyPreset() deshalb immer griffen. Eine Datei ohne Links rief
// setLinks([]) — bei einem Super-Admin alle manuellen Verbindungen aller
// Nutzer, mit gruener Erfolgsmeldung.
//
// Der Import kommt zurueck, wenn entschieden ist, was er bei einer GETEILTEN
// Karte bedeuten soll: ersetzen oder zusammenfuehren. Die ausgebaute Pruefung
// (sanitizeLayout) steht in der Git-Historie; sie war nicht das Problem.
// Siehe ROADMAP.md.

import { collectCurrentState } from './storage.js';

// FORMAT und VERSION stehen in der Datei, damit ein spaeterer Import sie
// pruefen kann. Die Grenzen und das ID-Muster, die zur Pruefung gehoeren,
// stehen hier bewusst NICHT mehr herum — ungenutzte Konstanten, die eine
// Zusicherung behaupten, die niemand einloest, sind schlimmer als keine.
// Sie kommen mit dem Import zurueck.
const FORMAT   = 'network-topology-layout';
const VERSION  = 1;

/** Baut den Dateiinhalt aus dem aktuellen Zustand. */
function buildLayoutFile(moduleVersion) {
    return JSON.stringify({
        format:  FORMAT,
        version: VERSION,
        // Nur zur Nachvollziehbarkeit beim Lesen der Datei — beim Import wird
        // sie nicht geprueft. Ein Layout aus 5.1.2 auf 5.3 einzuspielen ist
        // ausdruecklich erlaubt; das Format traegt seine eigene Version.
        module:  moduleVersion || '',
        created: new Date().toISOString(),
        data:    collectCurrentState()
    }, null, 2);
}

/** Loest den Download aus. */
export function downloadLayout(moduleVersion) {
    const text = buildLayoutFile(moduleVersion);
    const url  = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'nt-layout-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}
