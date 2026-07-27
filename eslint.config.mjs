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
// Sink laesst die CI rot werden. Fuer neuen Code gibt es die expliziten Helfer in
// assets/js/modules/dom-safe.js (setText / setStaticHtml).

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
        },

        plugins: {
            'no-unsanitized': noUnsanitized,
        },

        rules: {
            // esc() ist die Escaping-Konvention des Moduls — Aufrufe davon gelten
            // als sicher, alles andere Dynamische nicht.
            'no-unsanitized/property': ['error', { escape: { methods: ['esc', '_esc'] } }],
            'no-unsanitized/method':   ['error', { escape: { methods: ['esc', '_esc'] } }],
        },
    },
];
