// theme.js — die Farbzuordnung fuer den Dunkelmodus, an einer Stelle.
//
// WARUM CSS-VARIABLEN UND NICHT ZWEI FARBWERTE JE STELLE
// ------------------------------------------------------
// Acht Module bauen ihre Oberflaeche mit fest verdrahteten Farben in
// Inline-CSS — zusammen rund 140 Werte, verteilt ueber innerHTML-Strings,
// style.cssText und el(). Ein "dark ? a : b" an jeder dieser Stellen waere
// 140 Gelegenheiten, eine zu vergessen, und jede vergessene ist dunkelgrauer
// Text auf dunklem Grund.
//
// Stattdessen steht in der Quelle jetzt
//
//     color:var(--nt-c-0f172a,#0f172a)
//
// Im hellen Modus ist die Variable NICHT definiert, der Rueckfall greift, und
// das Bild ist byteweise dasselbe wie vorher. Unter #nt-root.nt-dark werden
// die Variablen umdefiniert — hier, einmal. Wer eine Farbe nachziehen will,
// aendert eine Zeile und nicht vierzehn Dateien.
//
// WAS BEWUSST NICHT ZUGEORDNET IST
// --------------------------------
// Akzente, die auf dunklem Grund ohnehin lesbar sind (Bernstein, helles
// Gruen), bleiben unveraendert. Zugeordnet wird, was auf dunkel VERSCHWINDET:
// die neutrale Grau-Rampe, die dunklen Akzentvarianten und die blassen
// Flaechenfarben.

// Licht -> Dunkel. Der Schluessel ist der Farbwert aus der Quelle, ohne '#'.
const DUNKEL = {
    // Neutrale Rampe. Auf hell wird Text nach unten hin PROMINENTER
    // (0f172a ist fast schwarz), auf dunkel muss er dafuer heller werden —
    // die Rampe kippt also, sie verschiebt sich nicht.
    'ffffff': '#161b22',   // Flaechen
    'f8fafc': '#161b22',
    'f1f5f9': '#21262d',
    'e2e8f0': '#30363d',   // Raender
    'cbd5e1': '#3d444d',
    '94a3b8': '#8b949e',   // sehr gedaempfter Text
    '9ca3af': '#8b949e',
    '64748b': '#b1bac4',   // gedaempfter Text
    '475569': '#c9d1d9',
    '334155': '#d8dee4',
    '1f2c33': '#e6edf3',   // Haupttext
    '0f172a': '#e6edf3',

    // Akzente, die auf hell dunkel gewaehlt wurden und deshalb kippen muessen.
    '1d4ed8': '#58a6ff',
    '3b82f6': '#58a6ff',
    '16a34a': '#3fb950',
    '22c55e': '#56d364',
    '0891b2': '#39c5cf',
    '06b6d4': '#56d4dd',
    'c2410c': '#f0883e',
    'ea580c': '#f0883e',
    'f97316': '#ffa657',
    '92400e': '#e3b341',
    '9c1a25': '#ff7b72',
    'dc2626': '#f85149',
    'e53742': '#ff7b72',
    '7c3aed': '#bc8cff',

    // Blasse Flaechen (Tailwind-100er) — auf dunkel als dunkler Farbton.
    'dbeafe': '#172554',
    'fef3c7': '#3d2f00',
    'dcfce7': '#0f2e1a',

    // Kurzschreibweisen und Farbnamen. Die erste Fassung dieser Zuordnung
    // verlangte sechsstellige Werte — dadurch blieben genau die groessten
    // Flaechen hell: der Tooltip-Kasten, das Kontextmenue und die Knoepfe
    // stehen alle auf background:#fff. Auf der dunklen Karte war das ein
    // leuchtend weisser Block.
    'ddd': '#30363d',

    // WEISS BRAUCHT ZWEI TOKEN, nicht eines. Als FLAECHE muss es dunkel
    // werden. Als TEXT steht es auf einem Akzent, der selbst heller wird
    // (das gedaempfte Abzeichen im Tooltip faerbt sich von #64748b nach
    // #b1bac4) — weisse Schrift darauf waere dann unlesbar, also kippt sie
    // ins Dunkle. Ein einziges --nt-c-fff haette einen der beiden Faelle
    // zwangslaeufig kaputtgemacht.
    // Zabbix-eigene Grautoene und die dunklen Textfarben, die auf den
    // blassen Flaechen oben sitzen. Letztere MUESSEN mit: wenn #dbeafe zu
    // #172554 wird, ist ein #1e3a8a darauf nicht mehr zu sehen. Eine Farbe
    // zuzuordnen und die Schrift darauf zu vergessen ist schlimmer, als
    // beide hell zu lassen.
    'f4f6f7': '#21262d',
    'eef2f5': '#21262d',
    'dfe4e7': '#30363d',
    'ccc': '#30363d',
    '999': '#8b949e',
    '1e293b': '#d8dee4',
    '166534': '#3fb950',
    '0275b8': '#58a6ff',
    '1e3a8a': '#79c0ff',
    '7f1d1d': '#ff7b72',
    '7c2d12': '#ffa657',

    'surface': '#161b22',
    'onaccent': '#161b22'
};

/**
 * Die Umdefinition einmal in die Seite legen. Idempotent.
 *
 * Als eigenes <style> und nicht als Inline-Stil auf #nt-root: die Variablen
 * sollen an EINER Stelle stehen und im Entwicklerwerkzeug auffindbar sein.
 */
export function installThemeVars() {
    if (document.getElementById('nt-theme-vars')) return;

    let css = '#nt-root.nt-dark{';
    for (const hex in DUNKEL) {
        css += '--nt-c-' + hex + ':' + DUNKEL[hex] + ';';
    }
    css += '}';

    const st = document.createElement('style');
    st.id = 'nt-theme-vars';
    st.textContent = css;   // nur eigene Konstanten, kein Fremdtext
    document.head.appendChild(st);
}
