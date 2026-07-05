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
    // Weathermap + Topology-Change
    'toolbar.weathermap':     'Weathermap: {state}',
    'toolbar.weathermap.tip': 'Edge-Farbe nach Auslastungs-% (Traffic / Link-Kapazitaet aus ifSpeed) statt absolutem Traffic',
    'toolbar.on':             'an',
    'toolbar.off':            'aus',
    'topo.added':             'Topologie: neue Verbindung {a} ↔ {b}',
    'topo.removed':           'Topologie: Verbindung {a} ↔ {b} verschwunden',

    // Kapazitäts-Forecast (Stats-Tab)
    'fc.title':      'Kapazitäts-Forecast',
    'fc.caveat':     'Lineare Prognose aus Zabbix-Trends (Stunden-Mittelwerte) auf Basis der Weathermap-Kapazitäten. Traffic ist host-aggregiert — ohne Port-Mapping eine Schätzung, kein Orakel.',
    'fc.period':     'Zeitraum:',
    'fc.days_unit':  'Tage',
    'fc.loading':    'Lade Trends ({days} Tage)…',
    'fc.summary':    '{links} Links mit bekannter Kapazität · Basis: {days} Tage Trends · Schwelle: 80 %',
    'fc.nolinks':    'Keine Links mit bekannter Kapazität — es fehlen ifSpeed-/ifHighSpeed-Items auf den Edge-Endpunkten.',
    'fc.nodata':     'Keine Trend-Daten für die Link-Endpunkte gefunden (Trends aktiviert? Zeitraum zu kurz?).',
    'fc.col.link':   'Link',
    'fc.col.cap':    'Kapazität',
    'fc.col.util':   'Auslastung',
    'fc.col.trend':  'Trend/Woche',
    'fc.col.eta':    '80 % erreicht',
    'fc.eta.now':    'jetzt über 80 %',
    'fc.eta.days':   'in ~{d} Tagen',
    'fc.eta.gt1y':   'in über einem Jahr',
    'fc.eta.stable': 'stabil / fallend',
    'fc.more':       '+{n} weitere Links (später fällig oder stabil)',

    // Port-Labels + Root-Cause
    'toolbar.portlabels':     'Port-Labels: {state}',
    'toolbar.portlabels.tip': 'LLDP-Port des Reporters an den Edge-Enden anzeigen (Best-Effort aus dem Item-Key)',
    'rc.button':      '🔍 Root-Cause',
    'rc.button.tip':  'Offline-Hosts in Ursache vs. Folge trennen (Erreichbarkeit vom Uplink aus)',
    'rc.none':        'Keine Offline-Hosts — nichts zu analysieren.',
    'rc.banner':      'Root-Cause: {causes} Ursache(n) → {victims} Folge-Ausfälle · {problems} Probleme dahinter',
    'rc.cause_toast': '{host}: {n} Hosts dahinter offline',
    'rc.end':         'Beenden',

    // Health-Score-Historie
    'health.hist.title': 'Score-Verlauf {days} Tage · aktuell Ø {avg}',
    'health.hist.hint':  'Score-Historie nicht eingerichtet: templates/nt_health_score_template.yaml importieren und tools/topo-change-sender.sh als Cron laufen lassen — der Sender pusht den Score automatisch mit.',
    'health.hist.avg':   'Ø Score',
    'health.hist.min':   'schlechteste Gruppe',
};
