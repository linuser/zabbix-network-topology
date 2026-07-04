// i18n/en.js — English strings. Same keys as de.js; en is the fallback
// language, so every key MUST exist here.
export default {
    // Tab bar
    'tabs.tech':       'Technical',
    'tabs.mgmt':       'Management',
    'tabs.table':      'Table',
    'tabs.geo':        'Geo',
    'tabs.health':     'Health',
    'tabs.stats':      'Stats',
    'tabs.compliance': 'Compliance',
    'tabs.lldpq':      'LLDP-Q',
    'tabs.diag':       'Diag',

    // Base toolbar
    'toolbar.dark':          'Dark',
    'toolbar.light':         'Light',
    'toolbar.menu.view':     'View',
    'toolbar.menu.layout':   'Layout',
    'toolbar.menu.tools':    'Tools',
    'toolbar.snapshot':      'Snapshot',
    'toolbar.snapshot.diff': 'Diff since {age}',
    'toolbar.snapshot.set':  'Remember the current state — afterwards you can see what changed',
    'toolbar.snapshot.new':  'Take a new snapshot (replaces the old one)',
    'toolbar.snapshot.del':  'Delete snapshot',

    // Health tab
    'health.title':      'Topology Health',
    'health.summary':    '{groups} groups · Ø score {avg} · min score {min} · {problems} open problems total',
    'health.hosts':      'hosts',
    'health.empty':      'No host groups in the current data.',
    'health.m.offline':  'Offline',
    'health.m.stale':    'Stale',
    'health.m.critical': 'Critical',
    'health.m.unacked':  'Unacked',
    'health.m.problems': 'Probl.',
    'health.lbl.healthy':  'Healthy',
    'health.lbl.ok':       'OK',
    'health.lbl.warn':     'Warning',
    'health.lbl.critical': 'Critical',
    'health.legend.healthy':  'Healthy',
    'health.legend.ok':       'OK',
    'health.legend.warn':     'Warning',
    'health.legend.critical': 'Critical',
    'health.legend.formula':  'Formula: 100 − offline·40 − stale·15 − critical·25 − unacked·20 (% of group)',

    // What-if failure simulation
    'whatif.simulate':      '⚡ Simulate failure',
    'whatif.restore':       '⚡ Restore host',
    'whatif.end_all':       '✕ End simulation ({n} simulated)',
    'whatif.banner':        'Simulation: {failed} failed → {cut} hosts cut off',
    'whatif.end':           'End',
    'whatif.root_fallback': 'No internet cloud/firewall in graph — reachability is relative to "{host}" (highest degree)',
    // Weathermap + topology change
    'toolbar.weathermap':     'Weathermap: {state}',
    'toolbar.weathermap.tip': 'Edge color by utilization % (traffic / link capacity from ifSpeed) instead of absolute traffic',
    'toolbar.on':             'on',
    'toolbar.off':            'off',
    'topo.added':             'Topology: new link {a} ↔ {b}',
    'topo.removed':           'Topology: link {a} ↔ {b} disappeared',
};
