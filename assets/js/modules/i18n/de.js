// i18n/de.js — deutsche Texte. Reines Key→String-Objekt (JSON-Syntax),
// als JS-Modul damit es ueber denselben ESM-Loader (inkl. Cache-Buster)
// laeuft wie der Rest — ein fetch('de.json') haette eigenes Timing/Caching.
//
// Konvention der Keys: <bereich>.<name>, Platzhalter als {name}.
// Neue Strings IMMER in de.js UND en.js eintragen — fehlt ein Key in einer
// Sprache, faellt t() auf Englisch und dann auf den Key selbst zurueck.
export default {
    // Tab-Leiste
    'tabs.tech':       'Technisch',
    'tabs.mgmt':       'Management',
    'tabs.table':      'Tabelle',
    'tabs.geo':        'Geo',
    'tabs.health':     'Health',
    'tabs.stats':      'Stats',
    'tabs.compliance': 'Compliance',
    'tabs.lldpq':      'LLDP-Q',
    'tabs.diag':       'Diag',

    // Basis-Toolbar
    'toolbar.dark':          'Dark',
    'toolbar.light':         'Light',
    'toolbar.menu.view':     'Anzeige',
    'toolbar.menu.layout':   'Layout',
    'toolbar.menu.tools':    'Tools',
    'toolbar.snapshot':      'Snapshot',
    'toolbar.snapshot.diff': 'Diff seit {age}',
    'toolbar.snapshot.set':  'Aktuellen Stand merken — danach sieht man was sich veraendert hat',
    'toolbar.snapshot.new':  'Neuen Snapshot setzen (ersetzt den alten)',
    'toolbar.snapshot.del':  'Snapshot loeschen',

    // Health-Tab
    'health.title':      'Topology Health',
    'health.summary':    '{groups} Gruppen · Ø Score {avg} · Min Score {min} · {problems} offene Probleme insgesamt',
    'health.hosts':      'Hosts',
    'health.empty':      'Keine Hostgroups in den aktuellen Daten.',
    'health.m.offline':  'Offline',
    'health.m.stale':    'Stale',
    'health.m.critical': 'Critical',
    'health.m.unacked':  'Unacked',
    'health.m.problems': 'Probl.',
    'health.lbl.healthy':  'Gesund',
    'health.lbl.ok':       'OK',
    'health.lbl.warn':     'Achtung',
    'health.lbl.critical': 'Kritisch',
    'health.legend.healthy':  'Gesund',
    'health.legend.ok':       'OK',
    'health.legend.warn':     'Achtung',
    'health.legend.critical': 'Kritisch',
    'health.legend.formula':  'Formel: 100 − offline·40 − stale·15 − critical·25 − unacked·20 (% der Gruppe)',

    // What-if-Ausfallsimulation
    'whatif.simulate':      '⚡ Ausfall simulieren',
    'whatif.restore':       '⚡ Host wiederherstellen',
    'whatif.end_all':       '✕ Simulation beenden ({n} simuliert)',
    'whatif.banner':        'Simulation: {failed} ausgefallen → {cut} Hosts abgeschnitten',
    'whatif.end':           'Beenden',
    'whatif.root_fallback': 'Keine Internet-Wolke/Firewall im Graph — Erreichbarkeit bezieht sich auf "{host}" (hoechster Vernetzungsgrad)',
};
