// device-caps.js — welche LLDP/CDP-Faehigkeiten ein Geraet zu INFRASTRUKTUR
// machen.
//
// WARUM EIN EIGENES, WINZIGES MODUL
// ---------------------------------
// Die Liste wird an ZWEI Stellen gebraucht: build-elements.js (der Geister-
// filter "nur Netzgeraete") und aggregation.js (das Buendeln von Endgeraeten,
// das genau die NICHT-Infrastruktur zusammenfasst). Beide muessen dieselbe
// Grenze ziehen — ein Switch, der hier anders eingestuft wuerde als dort, waere
// genau die Verwechslung, die beide vermeiden.
//
// Sie liegt NICHT in build-elements.js, obwohl sie dort entstand: dieses Modul
// zieht ueber icons.js das window nach und laesst sich ohne Browser nicht
// importieren. aggregation.js ist aber eine reine Funktion, die der Frontend-
// Gate ohne Browser prueft. Eine Konstante in einem schweren Modul haette die
// Pruefbarkeit der reinen Funktion gekostet.

// Genau die drei Faehigkeiten, die ein Netz aufspannen. Telefone und
// Arbeitsplatzrechner melden 'Station' oder 'Telephone' und gehoeren nicht
// dazu.
export const INFRA_CAPS = ['Bridge', 'Router', 'WLAN AP'];
