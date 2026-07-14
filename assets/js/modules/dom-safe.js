// dom-safe.js — explizite DOM-Helfer fuer NEUEN Code (Code-Review §12).
//
// Das Modul baut sein UI historisch ueber innerHTML + esc(). Das ist heute sauber
// (der XSS-Tripwire laeuft durch), haengt aber daran, dass JEDE kuenftige
// Aenderung esc() konsequent mitzieht — genau die Kritik aus dem Review: ein
// Grep-Tripwire kann Datenfluesse ueber mehrere Funktionen hinweg nicht sehen.
//
// Statt die ~76 Bestands-Sinks umzuschreiben (ein groesserer Eingriff als die
// Data.php-Aufteilung), gibt es zwei Absicherungen:
//
//   1. Der ESLint-Gate (eslint.config.mjs, no-unsanitized) laesst KEINEN neuen
//      unsicheren Sink mehr durch — der Bestand ist gebaselined.
//   2. Diese Helfer geben neuem Code einen Weg, bei dem die Absicht im Namen
//      steht, statt sie dem Leser zu ueberlassen:
//
//        setText(el, wert)        — untrusted Wert → landet als TEXT, nie als HTML
//        setStaticHtml(el, html)  — BEWUSST statisches, im Code stehendes HTML
//        elText(tag, wert)        — Element mit Text erzeugen (die DOM-Variante,
//                                   die das Review empfiehlt)
//
// Ehrlich dazu: setStaticHtml ist eine Konvention, keine Garantie — es kann
// technisch alles entgegennehmen. Sein Wert liegt darin, dass ein
// `setStaticHtml(el, userInput)` im Review sofort als falsch ins Auge springt,
// waehrend ein `el.innerHTML = x` untergeht.

/**
 * Untrusted Wert als reinen Text setzen. Nichts davon wird als HTML geparst —
 * der sichere Default fuer alles, was aus Zabbix-Daten kommt (Hostnamen,
 * Item-Keys, SNMP-/LLDP-Werte, Trigger-Namen ...).
 */
export function setText(el, value) {
    if (!el) return;
    el.textContent = (value === null || value === undefined) ? '' : String(value);
}

/**
 * Bewusst statisches HTML setzen — NUR mit im Code stehenden String-Literalen
 * aufrufen (Icons, Geruest, Platzhalter). Kommt hier je ein dynamischer Wert an,
 * ist der Aufruf falsch: dann gehoert er nach setText() oder durch esc().
 */
export function setStaticHtml(el, html) {
    if (!el) return;
    // eslint-disable-next-line no-unsanitized/property -- per Vertrag nur statische Literale; siehe Modul-Kommentar
    el.innerHTML = html;
}

/**
 * Element mit Textinhalt erzeugen. Der vom Review empfohlene Weg fuer neue
 * Komponenten (createElement + textContent statt HTML-String-Bau).
 */
export function elText(tag, value, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = (value === null || value === undefined) ? '' : String(value);
    return el;
}
