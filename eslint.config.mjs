// ESLint — Waechter gegen unsichere DOM-Sinks (Code-Review §12).
//
// Ausgangslage: das Modul baut sein UI groesstenteils ueber innerHTML mit einer
// esc()-Konvention. tools/check-xss.sh ist ein Grep-Tripwire und kann Datenfluesse
// ueber mehrere Funktionen hinweg NICHT verfolgen — genau das kritisiert das
// Review. eslint-plugin-no-unsanitized wertet dagegen den Ausdruck aus: statische
// String-Literale sind erlaubt, dynamische Werte nicht.
//
// Zum Bestand: es gibt ~100 solcher Sinks. Sie stammen alle aus HTML-Builder-
// Funktionen, die intern esc() nutzen, und der Tripwire laeuft sauber durch. Sie
// sind in eslint-suppressions.json GEBASELINED, nicht umgeschrieben — ein Umbau
// der kompletten Render-Schicht auf DOM-Methoden waere ein groesserer Eingriff
// als die Data.php-Aufteilung und ist bewusst nicht Teil dieses Schritts.
//
// Der Gate ist damit scharf fuer alles NEUE: jeder neu hinzugefuegte unsichere
// Sink laesst die CI rot werden. Fuer neuen Code gilt: Werte per textContent
// setzen (kein HTML-Sink) oder vor der Interpolation durch esc() schicken.

import noUnsanitized from 'eslint-plugin-no-unsanitized';

export default [
    {
        // Auch die drei Widget-Module: sie bauen HTML per String-Konkatenation
        // und liefen bis v4.38.2 durch kein Gate — genau dort ist deshalb ein
        // unescapter innerHTML-Sink entstanden (widget/…/widget.class.js).
        files: ['assets/js/**/*.js', 'widget*/assets/js/**/*.js'],

        // Nicht pruefen: das gebaute Bundle und die eingebundenen Fremd-Libs.
        ignores: [
            'assets/js/dist/**',
            'assets/js/cytoscape.min.js',
            'assets/js/cola.min.js',
            'assets/js/leaflet/**',
        ],

        languageOptions: {
            ecmaVersion: 2019,
            sourceType: 'module',

            // Ausdrueckliche Liste statt des 'globals'-Pakets: der Build haengt
            // an esbuild und sonst nichts, und eine Abhaengigkeit fuer eine
            // Lint-Regel waere der falsche Tausch. Die Liste ist ausserdem
            // Dokumentation — sie sagt, welche Fremd-Globals dieses Modul
            // ueberhaupt voraussetzt: Browser, Cytoscape, Leaflet (L), und
            // CWidget aus Zabbix' eigener Widget-Basisklasse.
            globals: {
                window: 'readonly', document: 'readonly', console: 'readonly',
                navigator: 'readonly', localStorage: 'readonly',
                setTimeout: 'readonly', clearTimeout: 'readonly',
                setInterval: 'readonly', clearInterval: 'readonly',
                requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
                fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
                Blob: 'readonly', FileReader: 'readonly', Event: 'readonly', CSS: 'readonly',
                ResizeObserver: 'readonly', btoa: 'readonly',
                confirm: 'readonly', prompt: 'readonly',
                cytoscape: 'readonly', cytoscapeCola: 'readonly',
                L: 'readonly', CWidget: 'readonly',
            },
        },

        plugins: {
            'no-unsanitized': noUnsanitized,
        },

        rules: {
            // esc() ist die Escaping-Konvention des Moduls — Aufrufe davon gelten
            // als sicher, alles andere Dynamische nicht.
            'no-unsanitized/property': ['error', { escape: { methods: ['esc', '_esc'] } }],
            'no-unsanitized/method':   ['error', { escape: { methods: ['esc', '_esc'] } }],

            // Dazugekommen, weil genau dieser Fehler ausgeliefert wurde:
            // render-geo.js rief esc() dreimal auf, ohne es aus utils.js zu
            // importieren. esbuild buendelt so etwas klaglos — der freie Name
            // steht dann im Bundle und wirft zur Laufzeit ReferenceError,
            // sichtbar erst, wenn jemand den Geo-Tab ohne Geo-Hosts oeffnet.
            // Zwoelf Gates liefen gruen daran vorbei; ein Nutzer hat es
            // gefunden. Mit der Globals-Liste oben meldet die Regel null
            // Falschtreffer.
            'no-undef': 'error',
        },
    },
];
