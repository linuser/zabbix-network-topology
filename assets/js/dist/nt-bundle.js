(() => {
  // assets/js/modules/utils.js
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmt(b) {
    b = +b || 0;
    if (b >= 1e9) return (b / 1e9).toFixed(1) + " Gb/s";
    if (b >= 1e6) return (b / 1e6).toFixed(1) + " Mb/s";
    if (b >= 1e3) return (b / 1e3).toFixed(1) + " Kb/s";
    return b.toFixed(0) + " b/s";
  }
  function linkCapacity(spdA, spdB) {
    return spdA > 0 && spdB > 0 ? Math.min(spdA, spdB) : spdA || spdB || 0;
  }
  function buildBaseUrl() {
    return window.location.pathname.replace("zabbix.php", "");
  }
  function mkTabTheme(dark) {
    return dark ? {
      bg: "#0d1117",
      surface: "#161b22",
      head: "#1c2128",
      hover: "#21262d",
      text: "#e6edf3",
      sub: "#8b949e",
      subSoft: "#6e7681",
      border: "#30363d",
      borderSoft: "#21262d",
      accent: "#0275b8"
    } : {
      bg: "#ffffff",
      surface: "#f8fafc",
      head: "#f1f5f9",
      hover: "#f1f5f9",
      text: "#1f2c33",
      sub: "#64748b",
      subSoft: "#94a3b8",
      border: "#dfe4e7",
      borderSoft: "#eef2f5",
      accent: "#0275b8"
    };
  }
  function aggregateValues(values, mode) {
    const nums = values.filter(function(v) {
      return typeof v === "number" && isFinite(v);
    });
    if (nums.length === 0) return null;
    if (mode === "sum") return nums.reduce(function(a, b) {
      return a + b;
    }, 0);
    if (mode === "max") return Math.max.apply(null, nums);
    if (mode === "min") return Math.min.apply(null, nums);
    if (mode === "p50" || mode === "p95" || mode === "p99") {
      const sorted = nums.slice().sort(function(a, b) {
        return a - b;
      });
      const pct = mode === "p50" ? 0.5 : mode === "p95" ? 0.95 : 0.99;
      const idx = pct * (sorted.length - 1);
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      if (lo === hi) return sorted[lo];
      const w = idx - lo;
      return sorted[lo] * (1 - w) + sorted[hi] * w;
    }
    return nums.reduce(function(a, b) {
      return a + b;
    }, 0) / nums.length;
  }
  function fmtItemValue(value, units) {
    if (value === null || value === void 0 || value === "") return "\u2014";
    units = units || "";
    const num = Number(value);
    if (!isNaN(num) && isFinite(num) && /^[-+]?\d/.test(String(value).trim())) {
      if (units === "B" || units === "Bps") {
        const abs2 = Math.abs(num);
        if (abs2 >= 1e12) return (num / 1e12).toFixed(2) + " T" + units;
        if (abs2 >= 1e9) return (num / 1e9).toFixed(2) + " G" + units;
        if (abs2 >= 1e6) return (num / 1e6).toFixed(2) + " M" + units;
        if (abs2 >= 1e3) return (num / 1e3).toFixed(1) + " K" + units;
        return num.toFixed(0) + " " + units;
      }
      const abs = Math.abs(num);
      let formatted;
      if (abs >= 1e9) formatted = (num / 1e9).toFixed(2) + "G";
      else if (abs >= 1e6) formatted = (num / 1e6).toFixed(2) + "M";
      else if (abs >= 1e3) formatted = (num / 1e3).toFixed(1) + "K";
      else if (abs > 0 && abs < 0.01) formatted = num.toExponential(2);
      else if (Number.isInteger(num)) formatted = String(num);
      else formatted = num.toFixed(2);
      return units ? formatted + " " + units : formatted;
    }
    const s = String(value);
    return s.length > 32 ? s.substring(0, 30) + "\u2026" : s;
  }

  // assets/js/modules/i18n/de.js
  var de_default = {
    // Tab-Leiste
    "tabs.tech": "Technisch",
    "tabs.mgmt": "Management",
    "tabs.table": "Tabelle",
    "tabs.geo": "Geo",
    "tabs.health": "Health",
    "tabs.stats": "Stats",
    "tabs.compliance": "Compliance",
    "tabs.lldpq": "LLDP-Q",
    "tabs.diag": "Diag",
    // Basis-Toolbar
    "toolbar.dark": "Dark",
    "toolbar.light": "Light",
    "toolbar.menu.view": "Anzeige",
    "toolbar.menu.layout": "Layout",
    "toolbar.menu.tools": "Tools",
    "toolbar.snapshot": "Snapshot",
    "toolbar.snapshot.diff": "Diff seit {age}",
    "toolbar.snapshot.set": "Aktuellen Stand merken \u2014 danach sieht man was sich veraendert hat",
    "toolbar.snapshot.new": "Neuen Snapshot setzen (ersetzt den alten)",
    "toolbar.snapshot.del": "Snapshot loeschen",
    // Health-Tab
    "health.title": "Topology Health",
    "health.summary": "{groups} Gruppen \xB7 \xD8 Score {avg} \xB7 Min Score {min} \xB7 {problems} offene Probleme insgesamt",
    "health.hosts": "Hosts",
    "health.empty": "Keine Hostgroups in den aktuellen Daten.",
    "health.m.offline": "Offline",
    "health.m.stale": "Stale",
    "health.m.critical": "Critical",
    "health.m.unacked": "Unacked",
    "health.m.problems": "Probl.",
    "health.lbl.healthy": "Gesund",
    "health.lbl.ok": "OK",
    "health.lbl.warn": "Achtung",
    "health.lbl.critical": "Kritisch",
    "health.legend.healthy": "Gesund",
    "health.legend.ok": "OK",
    "health.legend.warn": "Achtung",
    "health.legend.critical": "Kritisch",
    "health.legend.formula": "Formel: 100 \u2212 offline\xB740 \u2212 stale\xB715 \u2212 critical\xB725 \u2212 unacked\xB720 (% der Gruppe)",
    // What-if-Ausfallsimulation
    "whatif.simulate": "\u26A1 Ausfall simulieren",
    "whatif.restore": "\u26A1 Host wiederherstellen",
    "whatif.end_all": "\u2715 Simulation beenden ({n} simuliert)",
    "whatif.banner": "Simulation: {failed} ausgefallen \u2192 {cut} Hosts abgeschnitten",
    "whatif.end": "Beenden",
    "whatif.root_fallback": 'Keine Internet-Wolke/Firewall im Graph \u2014 Erreichbarkeit bezieht sich auf "{host}" (hoechster Vernetzungsgrad)',
    // Weathermap + Topology-Change
    "toolbar.weathermap": "Weathermap: {state}",
    "toolbar.weathermap.tip": "Edge-Farbe nach Auslastungs-% (Traffic / Link-Kapazitaet aus ifSpeed) statt absolutem Traffic",
    "toolbar.on": "an",
    "toolbar.off": "aus",
    "topo.added": "Topologie: neue Verbindung {a} \u2194 {b}",
    "topo.removed": "Topologie: Verbindung {a} \u2194 {b} verschwunden",
    // Kapazitäts-Forecast (Stats-Tab)
    "fc.title": "Kapazit\xE4ts-Forecast",
    "fc.caveat": "Lineare Prognose aus Zabbix-Trends (Stunden-Mittelwerte) auf Basis der Weathermap-Kapazit\xE4ten. Traffic ist host-aggregiert \u2014 ohne Port-Mapping eine Sch\xE4tzung, kein Orakel.",
    "fc.period": "Zeitraum:",
    "fc.days_unit": "Tage",
    "fc.loading": "Lade Trends ({days} Tage)\u2026",
    "fc.summary": "{links} Links mit bekannter Kapazit\xE4t \xB7 Basis: {days} Tage Trends \xB7 Schwelle: 80 %",
    "fc.nolinks": "Keine Links mit bekannter Kapazit\xE4t \u2014 es fehlen ifSpeed-/ifHighSpeed-Items auf den Edge-Endpunkten.",
    "fc.nodata": "Keine Trend-Daten f\xFCr die Link-Endpunkte gefunden (Trends aktiviert? Zeitraum zu kurz?).",
    "fc.col.link": "Link",
    "fc.col.cap": "Kapazit\xE4t",
    "fc.col.util": "Auslastung",
    "fc.col.trend": "Trend/Woche",
    "fc.col.eta": "80 % erreicht",
    "fc.eta.now": "jetzt \xFCber 80 %",
    "fc.eta.days": "in ~{d} Tagen",
    "fc.eta.gt1y": "in \xFCber einem Jahr",
    "fc.eta.stable": "stabil / fallend",
    "fc.more": "+{n} weitere Links (sp\xE4ter f\xE4llig oder stabil)",
    // Port-Labels + Root-Cause
    "toolbar.portlabels": "Port-Labels: {state}",
    "toolbar.portlabels.tip": "LLDP-Port des Reporters an den Edge-Enden anzeigen (Best-Effort aus dem Item-Key)",
    "rc.button": "\u{1F50D} Root-Cause",
    "rc.button.tip": "Offline-Hosts in Ursache vs. Folge trennen (Erreichbarkeit vom Uplink aus)",
    "rc.none": "Keine Offline-Hosts \u2014 nichts zu analysieren.",
    "rc.banner": "Root-Cause: {causes} Ursache(n) \u2192 {victims} Folge-Ausf\xE4lle \xB7 {problems} Probleme dahinter",
    "rc.cause_toast": "{host}: {n} Hosts dahinter offline",
    "rc.end": "Beenden",
    // Health-Score-Historie
    "health.hist.title": "Score-Verlauf {days} Tage \xB7 aktuell \xD8 {avg}",
    "health.hist.hint": "Score-Historie nicht eingerichtet: templates/nt_health_score_template.yaml importieren und tools/topo-change-sender.sh als Cron laufen lassen \u2014 der Sender pusht den Score automatisch mit.",
    "health.hist.avg": "\xD8 Score",
    "health.hist.min": "schlechteste Gruppe",
    // ── Vollmigration v4.28.0 (Tabs/Toolbar/Export/Detail/…) ──
    "table.type.camera": "Kamera",
    "table.type.printer": "Drucker",
    "table.type.ups": "USV",
    "table.type.unknown": "Unbekannt",
    "table.preset.all": "Alle",
    "table.preset.only_firewalls": "Nur Firewalls",
    "table.preset.only_servers": "Nur Server",
    "table.preset.only_switches": "Nur Switches",
    "table.preset.only_storage": "Nur Storage",
    "table.preset.only_offline": "Nur Offline",
    "table.preset.builtin": "Standard",
    "table.preset.custom": "Eigene",
    "table.preset.delete": "L\xF6schen",
    "table.preset.delete_confirm": "Preset \u201E{name}\u201C l\xF6schen?",
    "table.preset.save_current": "+ Aktuelle als Preset speichern\u2026",
    "table.preset.name_prompt": "Name des Presets:",
    "table.proxy.none": "Server (kein Proxy)",
    "table.proxy.with_group": "Proxy: {name} [grp:{group}]",
    "table.proxy.name": "Proxy: {name}",
    "table.proxy.group": "Proxy-Group: {name}",
    "table.no_detail_data": "Keine Detail-Daten verf\xFCgbar.",
    "table.prob.acked": "Best\xE4tigt",
    "table.offline_only_tip": "Nur unavailable Hosts anzeigen",
    "table.filter.group": "Gruppe:",
    "table.group.add": "+ Gruppe ({n})",
    "table.group.all": "Alle ({n})",
    "table.search.placeholder": "Suche \u2014 host:web, type:switch, group:dc1, ...",
    "table.search.help": 'Query-Syntax:\n  web                       Treffer in Hostname/Label/IP\n  -wartung                  NOT (Wort darf nicht vorkommen)\n  host:web                  Hostname/Label\n  ip:10.0                   IP-Adresse\n  proxy:zbx-px              Proxy-Name (nur per Prefix!)\n  group:dc1                 Hostgroup-Name\n  type:switch               Ger\xE4te-Type\n  iftype:snmp               Interface-Type\n  "with spaces"             quoted (auch field:"foo bar")\n  a OR b                    ODER (uppercase Keyword)\n  (a OR b) c                Gruppierung mit Klammern\nBare Tokens (ohne :) matchen Host/Label/IP \u2014 nicht Proxy/Gruppe/Type.\nMehrere Tokens ohne OR = UND (Standard).',
    "table.diff.new": "Neu seit Snapshot",
    "table.diff.worse": "Schlimmer seit Snapshot",
    "table.diff.better": "Besser seit Snapshot",
    "table.stale_tip": "Letzter Wert vor {m}m",
    "table.expand_problems": "Probleme aufklappen",
    "table.problems": "Probleme",
    "table.act.edit": "Bearbeiten",
    "table.col.group": "Gruppe",
    "table.no_match": "Keine Hosts entsprechen den Filtern.",
    "table.no_hosts": "Keine Hosts gefunden.",
    "table.count.all": "{n} Hosts",
    "table.count.filtered": "{shown} / {total} Hosts",
    "table.diff.since": "seit {age}",
    "table.diff.none": "keine \xC4nderung",
    "table.items.search_label": "Suche Host",
    "table.items.search_placeholder": "Hosts filtern \u2014 host:web, group:dc1, ...",
    "table.items.search_help": 'Gleiche Query-Syntax wie Hosts-Modus:\n  web                    Treffer in Host/Label/IP\n  -wartung               NOT\n  host:web / ip:10.0 / proxy:zbx-px / group:dc1 / type:switch\n  a OR b / (a OR b) c    OR + Klammern\n  "with spaces"          quoted',
    "table.items.hide_empty": "Leere ausblenden",
    "table.items.hide_empty_tip": "Hosts und Items ohne Werte verbergen",
    "table.items.heatmap_tip": "Zellen-Hintergrund nach relativer Position in der Spalte einf\xE4rben",
    "table.items.csv_tip": "Aktuelle Pivot-Sicht als CSV downloaden",
    "table.items.loading": "Lade Items...",
    "table.items.count.all": "{hosts} Hosts \xD7 {items} Items",
    "table.items.count.filtered": "{shown} / {total} Hosts \xD7 {items} Items",
    "toolbar.labels.show": "Labels zeigen",
    "toolbar.labels.hide": "Labels verbergen",
    "toolbar.fullscreen": "Vollbild",
    "toolbar.fullscreen.exit": "Vollbild verlassen",
    "toolbar.fit": "Einpassen",
    "toolbar.layout": "\u21BB Layout: {name}",
    "toolbar.taphold": "\u270B Long-Press: {ms}ms",
    "toolbar.taphold.default": "(Standard)",
    "toolbar.group.expand": "\u{1F5C2} Aufl\xF6sen",
    "toolbar.group.collapse": "\u{1F5C2} Gruppieren",
    "toolbar.cluster.auto": "\u{1F5C2} Cluster: Auto",
    "toolbar.cluster.columns": "\u{1F5C2} Cluster: Spalten",
    "toolbar.cluster.rows": "\u{1F5C2} Cluster: Reihen",
    "toolbar.cluster.off": "\u{1F5C2} Cluster: Aus",
    "toolbar.cluster.tip": "Wie sollen mehrere Hostgroups visuell getrennt werden",
    "toolbar.auto.on": "Auto: 30s",
    "toolbar.auto.off": "Auto: Aus",
    "toolbar.lldp": "LLDP: {state}",
    "toolbar.link": "Link",
    "toolbar.link.tip": "Stern-Modus: Quelle w\xE4hlen, dann beliebig viele Ziele klicken. ESC oder Quelle nochmal = fertig.",
    "toolbar.link.cancel": "Abbrechen (ESC)",
    "toolbar.unlink": "\u2715 Links",
    "toolbar.unlink.tip": "Alle manuellen Links l\xF6schen",
    "toolbar.unlink.confirm": "Alle manuellen Verbindungen l\xF6schen?",
    "toolbar.search": "Host suchen...",
    "export.report.meta": "{date} &nbsp;|&nbsp; {hosts} Hosts &nbsp;|&nbsp; {links} Links",
    "export.audit.noproxy": "Server (kein Proxy)",
    "export.audit.summary": "Zusammenfassung",
    "export.audit.hosts_total": "Hosts gesamt",
    "export.audit.crit_sev": "Kritisch (Sev \u2265 4)",
    "export.audit.unacked": "Unacked Probleme",
    "export.audit.problems_total": "Probleme gesamt",
    "export.audit.top10": "Top 10 Problemhosts",
    "export.audit.col.problems": "Probleme",
    "export.audit.ranking": "Ranking: severity\xB710 + probleme\xB72 + offline\xB750 + stale\xB715 + unacked\xB720",
    "export.audit.col.group": "Gruppe",
    "export.audit.crit_hosts": "Kritische Hosts ({n})",
    "export.audit.more": "\u2026 und {n} weitere",
    "export.audit.col.last_seen": "Letzter Wert vor",
    "export.audit.col.error": "Fehler",
    "export.audit.top_problems": "Top-Probleme ({n})",
    "export.audit.col.affected": "Betroffene Hosts",
    "export.audit.proxies": "Proxy-\xDCbersicht ({n})",
    "export.audit.stale_problem": "Krit. Problem > {days}d",
    "export.audit.compliance": "Compliance ({n} Hosts)",
    "export.audit.lvl_bad": "\u2717 Issue",
    "export.audit.lvl_good": "\u2713 Gut",
    "export.audit.lvl_info": "i Info",
    "export.audit.lvl_note": "Schlechte (\u2717) Findings sind echte Issues; Info (i) kontextabh\xE4ngig; Gut (\u2713) positiv markiert.",
    "export.audit.meta": "{date} &nbsp;\xB7&nbsp; {hosts} Hosts",
    "export.overlay.print": "Cmd+P zum Drucken / Als PDF sichern &nbsp;\xB7&nbsp; Klick zum Schliessen",
    "export.overlay.png": "Rechtsklick auf Bild \u2192 \u201EBild sichern unter\u2026\u201C &nbsp;\xB7&nbsp; Klick zum Schliessen",
    "export.menu.pdf": "PDF (Drucken)",
    "export.menu.html": "HTML speichern",
    "export.menu.audit_pdf": "Audit-Report (Drucken)",
    "export.generating": "Report wird erstellt\u2026",
    "export.menu.audit_html": "Audit-Report (HTML)",
    "stats.range_days": "{n} Tage",
    "stats.unnamed": "(unbenannt)",
    "stats.chart.empty": "Keine Events im gew\xE4hlten Zeitraum.",
    "stats.no_data": "Keine Daten.",
    "stats.title": "Statistik",
    "stats.desc": "Problem-Events aus dem History-Backend, aggregiert pro Tag. Recovery-Events und \u201Ewar schon offen vor Range\u201C werden nicht gez\xE4hlt.",
    "stats.period": "Zeitraum:",
    "stats.loading": "L\xE4dt...",
    "stats.top_hosts": "Top 10 Hosts",
    "stats.top_triggers": "Top 10 Probleme",
    "stats.loading_events": "Lade {days} Tage Events...",
    "stats.error": "Fehler: {msg}",
    "stats.agg_summary": "{events} Events &middot; {hosts} Hosts &middot; {triggers} Trigger &middot; {from} \u2013 {to}",
    "stats.truncated": "Achtung: Backend-Limit erreicht",
    "stats.col.host": "Host",
    "stats.col.events": "Events",
    "stats.col.worst": "Worst",
    "stats.col.trigger": "Trigger",
    "stats.col.hosts": "Hosts",
    "detail.type.camera": "Kamera",
    "detail.type.printer": "Drucker",
    "detail.type.ups": "USV",
    "detail.type.unknown": "Unbekannt",
    "detail.custom_icon_tip": "Custom (von nt:icon Tag)",
    "detail.badge.pinned": "Fixiert",
    "detail.badge.maintenance": "Wartung",
    "detail.badge.note": "Notiz",
    "detail.ago": "vor {v}",
    "detail.stale.last_value": "letzter Wert {ago}",
    "detail.stale.hint": "Host gilt laut Zabbix als verf\xFCgbar, aber es kommen keine aktuellen Item-Werte mehr an",
    "detail.offline.hint": "Metriken unten sind die letzten Werte vor Disconnect",
    "detail.items.show": "{n} Items anzeigen",
    "detail.act.problems": "Probleme",
    "detail.act.edit": "Bearbeiten",
    "detail.sec.identity": "Identit\xE4t",
    "detail.sec.metrics": "Metriken",
    "detail.sec.connections": "Verbindungen",
    "ctx.hosts": "{n} Hosts",
    "ctx.top_problems": "Top Probleme",
    "ctx.resolve_view": "\u{1F4CB} Diese Ansicht aufl\xF6sen",
    "ctx.edit": "\u270F\uFE0F Bearbeiten",
    "ctx.hosts_list": "\u2699\uFE0F Hosts (Liste)",
    "ctx.ext_links": "Externe Links",
    "ctx.pin": "Pin (fixieren)",
    "ctx.unpin": "Unpin",
    "ctx.note_edit": "Notiz bearbeiten",
    "ctx.note_add": "Notiz hinzuf\xFCgen",
    "ctx.note_prompt": "Notiz f\xFCr {host} (leer = l\xF6schen):",
    "ctx.path_hide": "\u2716 Pfad ausblenden",
    "ctx.path_start": "\u{1F517} Pfad von hier starten",
    "ctx.path_reset": "\u2716 Pfad-Start zur\xFCcksetzen",
    "ctx.path_to": "\u{1F517} Pfad zu hier",
    "ctx.path_none": "Kein Pfad zwischen den Hosts gefunden.",
    "presets.scope.global": "Global",
    "presets.scope.this": "Diese Auswahl",
    "presets.empty": "Noch keine Presets gespeichert. Karte einrichten und \u201ESave As\u2026\u201C klicken.",
    "presets.save.tip": "Aktives Preset mit aktuellem Stand \xFCberschreiben",
    "presets.saveas.tip": "Als neues Preset speichern",
    "presets.del.tip": "Aktives Preset l\xF6schen",
    "presets.notfound": "Aktives Preset nicht gefunden \u2014 bitte \u201ESave As\u2026\u201C statt \u201ESave\u201C.",
    "presets.name_prompt": "Name f\xFCr das neue Preset:",
    "presets.scope_confirm": "Preset-Scope w\xE4hlen:\n\nOK = Global (gilt f\xFCr alle Hostgroup-Auswahlen)\nAbbrechen = Diese Auswahl (gilt nur f\xFCr aktuelle Hostgroups)",
    "presets.overwrite_confirm": "Preset \u201E{name}\u201C existiert bereits. \xDCberschreiben?",
    "presets.delete_confirm": "Preset \u201E{name}\u201C wirklich l\xF6schen?",
    "mgmt.level.server": "Server / Virtualisierung",
    "mgmt.level.homeauto": "Home Automatisierung / Monitoring",
    "mgmt.level.devices": "Ger\xE4te",
    "mgmt.sev.crit": "Krit",
    "mgmt.stat.problems": "Mit Problem",
    "mgmt.stat.maintenance": "Wartung",
    "mgmt.stat.acked": "Best\xE4tigt",
    "mgmt.level.generic": "Ebene {n}",
    "mgmt.tile.maintenance": "In Wartung",
    "mgmt.tile.acked": "Probleme best\xE4tigt",
    "sev.ok": "OK",
    "sev.info": "Info",
    "sev.warn": "Warn",
    "sev.avg": "Avg",
    "sev.high": "High",
    "sev.offline": "Offline",
    "sev.offline.tip": "Nur offline Hosts anzeigen",
    "sev.reset.tip": "Filter zur\xFCcksetzen",
    "legend.groups": "GRUPPEN",
    "legend.severity": "SEVERITY",
    "legend.ring": "RING",
    "legend.ring.cpu": "CPU",
    "legend.ring.memory": "Memory",
    "legend.ring.traffic": "Traffic",
    "legend.ring.ping": "Ping",
    "hist.load_error": "Fehler beim Laden",
    "hist.title": "Historie",
    "hist.play_pause": "Wiedergabe / Pause",
    "hist.close": "\u2715 Schlie\xDFen",
    "hist.button": "\u{1F551} Historie",
    "hist.button.tip": "History-Modus: Trigger-Status zur ausgew\xE4hlten Zeit anzeigen",
    "layout.auto": "Auto",
    "layout.force": "Force",
    "layout.concentric": "Konzentrisch",
    "layout.grid": "Raster",
    "layout.tree": "Baum",
    "layout.hierarchy": "Hierarchie",
    "tech.badge.hosts": "Hosts",
    "tech.badge.ok": "OK",
    "tech.badge.warn": "Warn",
    "tech.badge.down": "Down",
    "tech.no_hosts": "Keine Hosts gefunden.",
    "tech.link.targets": "Ziele klicken (ESC = fertig)",
    "tip.maintenance": "Wartung",
    "tip.problem_since": "Problem seit: {t}",
    "tip.loading_history": "Lade Verlauf...",
    "tip.no_traffic_history": "Kein Traffic-Verlauf verf\xFCgbar (keine net.if-/ifIn/ifOut-Items)",
    "tip.last_1h": "letzte 1h",
    "app.pick_groups": "\u2190 Bitte Host-Gruppen w\xE4hlen und Apply klicken.",
    "app.loading": "Lade Topologie...",
    "app.error": "Error: {msg}",
    "agg.no_group": "\u2014 Ohne Gruppe \u2014",
    "minimap.tip": "Minimap \u2014 klicken zum Navigieren",
    // Wartung aus der Map (context-menu.js)
    "maint.row": "\u{1F527} Wartung {dur}",
    "maint.confirm": "{host} f\xFCr {dur} in Wartung setzen? Alarme werden unterdr\xFCckt.",
    "maint.ok": "Wartung f\xFCr {host} angelegt ({dur}) \u2014 aktiv in ~1 min.",
    "maint.fail": "Wartung fehlgeschlagen: {msg}",
    // Host-Ressourcen-Forecast (render-stats.js)
    "rf.title": "Host-Ressourcen-Forecast",
    "rf.caveat": "Lineare Prognose der CPU-%/Memory-%-Trends (Zabbix-Trends, gleicher Zeitraum wie oben). Nur Hosts mit %-Items (system.cpu.util, vm.memory\u2026pused). CPU-Trends sind volatil \u2014 Memory-Trends fangen Leaks/Wachstum zuverl\xE4ssiger. Schwellen: Memory 90 %, CPU 85 %.",
    "rf.nogroups": "Keine Hostgruppen ausgew\xE4hlt.",
    "rf.nodata": "Keine CPU-/Memory-%-Trends gefunden (Trends aktiviert? %-Items vorhanden?).",
    "rf.summary": "{hosts} Hosts mit Ressourcen-Trends \xB7 Basis: {days} Tage \xB7 Schwellen: Mem 90 %, CPU 85 %",
    "rf.col.host": "Host",
    "rf.col.mem": "Memory",
    "rf.col.mem_week": "Mem Trend/Woche",
    "rf.col.mem_eta": "Mem \u2192 90 %",
    "rf.col.cpu": "CPU",
    "rf.col.cpu_eta": "CPU \u2192 85 %",
    "rf.more": "+{n} weitere Hosts (sp\xE4ter f\xE4llig oder stabil)",
    "rf.eta.now": "Schwelle erreicht",
    // Farbcode-Leiste unten im Technical-Tab (legend.js)
    "legend.guide.title": "Farbcode",
    "legend.guide.nodes": "Knoten",
    "legend.guide.optimal": "Optimal",
    "legend.guide.offline": "Offline",
    "legend.guide.maint": "Wartung / veraltet",
    "legend.guide.edges": "Verbindungen",
    "legend.guide.link_lldp": "LLDP/CDP-Link",
    "legend.guide.link_inet": "Internet-Uplink",
    "legend.guide.iface_down": "Interface down",
    "legend.guide.weathermap": "Weathermap: Auslastung niedrig \u2192 hoch",
    "legend.guide.rings": "Metrik-Ringe",
    // Auto-Refresh-Fehler-Badge (render-tech.js)
    "tech.refresh_stale": "\u26A0 Daten veraltet \u2014 Refresh-Fehler",
    "tech.refresh_stale.tip": "{n} fehlgeschlagene Aktualisierungen in Folge. Angezeigt wird der letzte erfolgreiche Stand."
  };

  // assets/js/modules/i18n/en.js
  var en_default = {
    // Tab bar
    "tabs.tech": "Technical",
    "tabs.mgmt": "Management",
    "tabs.table": "Table",
    "tabs.geo": "Geo",
    "tabs.health": "Health",
    "tabs.stats": "Stats",
    "tabs.compliance": "Compliance",
    "tabs.lldpq": "LLDP-Q",
    "tabs.diag": "Diag",
    // Base toolbar
    "toolbar.dark": "Dark",
    "toolbar.light": "Light",
    "toolbar.menu.view": "View",
    "toolbar.menu.layout": "Layout",
    "toolbar.menu.tools": "Tools",
    "toolbar.snapshot": "Snapshot",
    "toolbar.snapshot.diff": "Diff since {age}",
    "toolbar.snapshot.set": "Remember the current state \u2014 afterwards you can see what changed",
    "toolbar.snapshot.new": "Take a new snapshot (replaces the old one)",
    "toolbar.snapshot.del": "Delete snapshot",
    // Health tab
    "health.title": "Topology Health",
    "health.summary": "{groups} groups \xB7 \xD8 score {avg} \xB7 min score {min} \xB7 {problems} open problems total",
    "health.hosts": "hosts",
    "health.empty": "No host groups in the current data.",
    "health.m.offline": "Offline",
    "health.m.stale": "Stale",
    "health.m.critical": "Critical",
    "health.m.unacked": "Unacked",
    "health.m.problems": "Probl.",
    "health.lbl.healthy": "Healthy",
    "health.lbl.ok": "OK",
    "health.lbl.warn": "Warning",
    "health.lbl.critical": "Critical",
    "health.legend.healthy": "Healthy",
    "health.legend.ok": "OK",
    "health.legend.warn": "Warning",
    "health.legend.critical": "Critical",
    "health.legend.formula": "Formula: 100 \u2212 offline\xB740 \u2212 stale\xB715 \u2212 critical\xB725 \u2212 unacked\xB720 (% of group)",
    // What-if failure simulation
    "whatif.simulate": "\u26A1 Simulate failure",
    "whatif.restore": "\u26A1 Restore host",
    "whatif.end_all": "\u2715 End simulation ({n} simulated)",
    "whatif.banner": "Simulation: {failed} failed \u2192 {cut} hosts cut off",
    "whatif.end": "End",
    "whatif.root_fallback": 'No internet cloud/firewall in graph \u2014 reachability is relative to "{host}" (highest degree)',
    // Weathermap + topology change
    "toolbar.weathermap": "Weathermap: {state}",
    "toolbar.weathermap.tip": "Edge color by utilization % (traffic / link capacity from ifSpeed) instead of absolute traffic",
    "toolbar.on": "on",
    "toolbar.off": "off",
    "topo.added": "Topology: new link {a} \u2194 {b}",
    "topo.removed": "Topology: link {a} \u2194 {b} disappeared",
    // Capacity forecast (stats tab)
    "fc.title": "Capacity forecast",
    "fc.caveat": "Linear projection from Zabbix trends (hourly averages) based on the weathermap capacities. Traffic is host-aggregated \u2014 without port mapping this is an estimate, not an oracle.",
    "fc.period": "Period:",
    "fc.days_unit": "days",
    "fc.loading": "Loading trends ({days} days)\u2026",
    "fc.summary": "{links} links with known capacity \xB7 based on {days} days of trends \xB7 threshold: 80%",
    "fc.nolinks": "No links with known capacity \u2014 ifSpeed/ifHighSpeed items missing on the edge endpoints.",
    "fc.nodata": "No trend data found for the link endpoints (trends enabled? period too short?).",
    "fc.col.link": "Link",
    "fc.col.cap": "Capacity",
    "fc.col.util": "Utilization",
    "fc.col.trend": "Trend/week",
    "fc.col.eta": "80% reached",
    "fc.eta.now": "above 80% now",
    "fc.eta.days": "in ~{d} days",
    "fc.eta.gt1y": "in over a year",
    "fc.eta.stable": "stable / falling",
    "fc.more": "+{n} more links (due later or stable)",
    // Port labels + root cause
    "toolbar.portlabels": "Port labels: {state}",
    "toolbar.portlabels.tip": "Show the reporter's LLDP port at the edge ends (best effort from the item key)",
    "rc.button": "\u{1F50D} Root cause",
    "rc.button.tip": "Split offline hosts into cause vs. consequence (reachability from the uplink)",
    "rc.none": "No offline hosts \u2014 nothing to analyze.",
    "rc.banner": "Root cause: {causes} cause(s) \u2192 {victims} downstream outages \xB7 {problems} problems behind them",
    "rc.cause_toast": "{host}: {n} hosts offline behind it",
    "rc.end": "End",
    // Health score history
    "health.hist.title": "Score history {days} days \xB7 current avg {avg}",
    "health.hist.hint": "Score history not set up: import templates/nt_health_score_template.yaml and run tools/topo-change-sender.sh as a cron \u2014 the sender pushes the score automatically.",
    "health.hist.avg": "avg score",
    "health.hist.min": "worst group",
    // ── Vollmigration v4.28.0 (Tabs/Toolbar/Export/Detail/…) ──
    "table.type.camera": "Camera",
    "table.type.printer": "Printer",
    "table.type.ups": "UPS",
    "table.type.unknown": "Unknown",
    "table.preset.all": "All",
    "table.preset.only_firewalls": "Firewalls only",
    "table.preset.only_servers": "Servers only",
    "table.preset.only_switches": "Switches only",
    "table.preset.only_storage": "Storage only",
    "table.preset.only_offline": "Offline only",
    "table.preset.builtin": "Built-in",
    "table.preset.custom": "Custom",
    "table.preset.delete": "Delete",
    "table.preset.delete_confirm": 'Delete preset "{name}"?',
    "table.preset.save_current": "+ Save current as preset\u2026",
    "table.preset.name_prompt": "Preset name:",
    "table.proxy.none": "Server (no proxy)",
    "table.proxy.with_group": "Proxy: {name} [grp:{group}]",
    "table.proxy.name": "Proxy: {name}",
    "table.proxy.group": "Proxy group: {name}",
    "table.no_detail_data": "No detail data available.",
    "table.prob.acked": "Acknowledged",
    "table.offline_only_tip": "Show only unavailable hosts",
    "table.filter.group": "Group:",
    "table.group.add": "+ Group ({n})",
    "table.group.all": "All ({n})",
    "table.search.placeholder": "Search \u2014 host:web, type:switch, group:dc1, ...",
    "table.search.help": 'Query syntax:\n  web                       match in hostname/label/IP\n  -maint                    NOT (word must not appear)\n  host:web                  hostname/label\n  ip:10.0                   IP address\n  proxy:zbx-px              proxy name (prefix only!)\n  group:dc1                 host group name\n  type:switch               device type\n  iftype:snmp               interface type\n  "with spaces"             quoted (also field:"foo bar")\n  a OR b                    OR (uppercase keyword)\n  (a OR b) c                grouping with parentheses\nBare tokens (without :) match host/label/IP \u2014 not proxy/group/type.\nMultiple tokens without OR = AND (default).',
    "table.diff.new": "New since snapshot",
    "table.diff.worse": "Worse since snapshot",
    "table.diff.better": "Better since snapshot",
    "table.stale_tip": "Last value {m}m ago",
    "table.expand_problems": "Expand problems",
    "table.problems": "Problems",
    "table.act.edit": "Edit",
    "table.col.group": "Group",
    "table.no_match": "No hosts match the filters.",
    "table.no_hosts": "No hosts found.",
    "table.count.all": "{n} hosts",
    "table.count.filtered": "{shown} / {total} hosts",
    "table.diff.since": "since {age}",
    "table.diff.none": "no change",
    "table.items.search_label": "Search host",
    "table.items.search_placeholder": "Filter hosts \u2014 host:web, group:dc1, ...",
    "table.items.search_help": 'Same query syntax as host mode:\n  web                    match in host/label/IP\n  -maint                 NOT\n  host:web / ip:10.0 / proxy:zbx-px / group:dc1 / type:switch\n  a OR b / (a OR b) c    OR + parentheses\n  "with spaces"          quoted',
    "table.items.hide_empty": "Hide empty",
    "table.items.hide_empty_tip": "Hide hosts and items without values",
    "table.items.heatmap_tip": "Color cell background by relative position in the column",
    "table.items.csv_tip": "Download current pivot view as CSV",
    "table.items.loading": "Loading items...",
    "table.items.count.all": "{hosts} hosts \xD7 {items} items",
    "table.items.count.filtered": "{shown} / {total} hosts \xD7 {items} items",
    "toolbar.labels.show": "Show Labels",
    "toolbar.labels.hide": "Hide Labels",
    "toolbar.fullscreen": "Fullscreen",
    "toolbar.fullscreen.exit": "Exit Fullscreen",
    "toolbar.fit": "Fit",
    "toolbar.layout": "\u21BB Layout: {name}",
    "toolbar.taphold": "\u270B Long-press: {ms}ms",
    "toolbar.taphold.default": "(default)",
    "toolbar.group.expand": "\u{1F5C2} Expand",
    "toolbar.group.collapse": "\u{1F5C2} Group",
    "toolbar.cluster.auto": "\u{1F5C2} Cluster: auto",
    "toolbar.cluster.columns": "\u{1F5C2} Cluster: columns",
    "toolbar.cluster.rows": "\u{1F5C2} Cluster: rows",
    "toolbar.cluster.off": "\u{1F5C2} Cluster: off",
    "toolbar.cluster.tip": "How should multiple host groups be visually separated",
    "toolbar.auto.on": "Auto: 30s",
    "toolbar.auto.off": "Auto: Off",
    "toolbar.lldp": "LLDP: {state}",
    "toolbar.link": "Link",
    "toolbar.link.tip": "Star mode: pick a source, then click any number of targets. ESC or the source again = done.",
    "toolbar.link.cancel": "Cancel (ESC)",
    "toolbar.unlink": "\u2715 Links",
    "toolbar.unlink.tip": "Delete all manual links",
    "toolbar.unlink.confirm": "Delete all manual links?",
    "toolbar.search": "Search host...",
    "export.report.meta": "{date} &nbsp;|&nbsp; {hosts} hosts &nbsp;|&nbsp; {links} links",
    "export.audit.noproxy": "Server (no proxy)",
    "export.audit.summary": "Summary",
    "export.audit.hosts_total": "Total hosts",
    "export.audit.crit_sev": "Critical (sev \u2265 4)",
    "export.audit.unacked": "Unacked problems",
    "export.audit.problems_total": "Total problems",
    "export.audit.top10": "Top 10 problem hosts",
    "export.audit.col.problems": "Problems",
    "export.audit.ranking": "Ranking: severity\xB710 + problems\xB72 + offline\xB750 + stale\xB715 + unacked\xB720",
    "export.audit.col.group": "Group",
    "export.audit.crit_hosts": "Critical hosts ({n})",
    "export.audit.more": "\u2026 and {n} more",
    "export.audit.col.last_seen": "Last seen",
    "export.audit.col.error": "Error",
    "export.audit.top_problems": "Top problems ({n})",
    "export.audit.col.affected": "Affected hosts",
    "export.audit.proxies": "Proxy overview ({n})",
    "export.audit.stale_problem": "Crit. problem > {days}d",
    "export.audit.compliance": "Compliance ({n} hosts)",
    "export.audit.lvl_bad": "\u2717 Issue",
    "export.audit.lvl_good": "\u2713 Good",
    "export.audit.lvl_info": "i Info",
    "export.audit.lvl_note": "Bad (\u2717) findings are real issues; info (i) context-dependent; good (\u2713) marked positive.",
    "export.audit.meta": "{date} &nbsp;\xB7&nbsp; {hosts} hosts",
    "export.overlay.print": "Cmd+P to print / save as PDF &nbsp;\xB7&nbsp; click to close",
    "export.overlay.png": 'Right-click the image \u2192 "Save image as\u2026" &nbsp;\xB7&nbsp; click to close',
    "export.menu.pdf": "PDF (print)",
    "export.menu.html": "Save HTML",
    "export.menu.audit_pdf": "Audit report (print)",
    "export.generating": "Generating report\u2026",
    "export.menu.audit_html": "Audit report (HTML)",
    "stats.range_days": "{n} days",
    "stats.unnamed": "(unnamed)",
    "stats.chart.empty": "No events in the selected period.",
    "stats.no_data": "No data.",
    "stats.title": "Statistics",
    "stats.desc": 'Problem events from the history backend, aggregated per day. Recovery events and "already open before range" are not counted.',
    "stats.period": "Period:",
    "stats.loading": "Loading...",
    "stats.top_hosts": "Top 10 hosts",
    "stats.top_triggers": "Top 10 problems",
    "stats.loading_events": "Loading {days} days of events...",
    "stats.error": "Error: {msg}",
    "stats.agg_summary": "{events} events &middot; {hosts} hosts &middot; {triggers} triggers &middot; {from} \u2013 {to}",
    "stats.truncated": "Note: backend limit reached",
    "stats.col.host": "Host",
    "stats.col.events": "Events",
    "stats.col.worst": "Worst",
    "stats.col.trigger": "Trigger",
    "stats.col.hosts": "Hosts",
    "detail.type.camera": "Camera",
    "detail.type.printer": "Printer",
    "detail.type.ups": "UPS",
    "detail.type.unknown": "Unknown",
    "detail.custom_icon_tip": "Custom (from nt:icon tag)",
    "detail.badge.pinned": "Pinned",
    "detail.badge.maintenance": "Maintenance",
    "detail.badge.note": "Note",
    "detail.ago": "{v} ago",
    "detail.stale.last_value": "last value {ago}",
    "detail.stale.hint": "Zabbix reports the host as available, but no current item values are arriving anymore",
    "detail.offline.hint": "Metrics below are the last values before disconnect",
    "detail.items.show": "Show {n} items",
    "detail.act.problems": "Problems",
    "detail.act.edit": "Edit",
    "detail.sec.identity": "Identity",
    "detail.sec.metrics": "Metrics",
    "detail.sec.connections": "Connections",
    "ctx.hosts": "{n} hosts",
    "ctx.top_problems": "Top problems",
    "ctx.resolve_view": "\u{1F4CB} Expand this view",
    "ctx.edit": "\u270F\uFE0F Edit",
    "ctx.hosts_list": "\u2699\uFE0F Hosts (list)",
    "ctx.ext_links": "External links",
    "ctx.pin": "Pin",
    "ctx.unpin": "Unpin",
    "ctx.note_edit": "Edit note",
    "ctx.note_add": "Add note",
    "ctx.note_prompt": "Note for {host} (empty = delete):",
    "ctx.path_hide": "\u2716 Hide path",
    "ctx.path_start": "\u{1F517} Start path from here",
    "ctx.path_reset": "\u2716 Reset path start",
    "ctx.path_to": "\u{1F517} Path to here",
    "ctx.path_none": "No path found between the hosts.",
    "presets.scope.global": "Global",
    "presets.scope.this": "This selection",
    "presets.empty": 'No presets saved yet. Set up the map and click "Save As\u2026".',
    "presets.save.tip": "Overwrite the active preset with the current state",
    "presets.saveas.tip": "Save as a new preset",
    "presets.del.tip": "Delete the active preset",
    "presets.notfound": 'Active preset not found \u2014 please use "Save As\u2026" instead of "Save".',
    "presets.name_prompt": "Name for the new preset:",
    "presets.scope_confirm": "Choose preset scope:\n\nOK = Global (applies to all host group selections)\nCancel = This selection (applies only to current host groups)",
    "presets.overwrite_confirm": 'Preset "{name}" already exists. Overwrite?',
    "presets.delete_confirm": 'Really delete preset "{name}"?',
    "mgmt.level.server": "Server / virtualization",
    "mgmt.level.homeauto": "Home automation / monitoring",
    "mgmt.level.devices": "Devices",
    "mgmt.sev.crit": "Crit",
    "mgmt.stat.problems": "With problem",
    "mgmt.stat.maintenance": "Maintenance",
    "mgmt.stat.acked": "Acknowledged",
    "mgmt.level.generic": "Level {n}",
    "mgmt.tile.maintenance": "In maintenance",
    "mgmt.tile.acked": "Problems acknowledged",
    "sev.ok": "OK",
    "sev.info": "Info",
    "sev.warn": "Warn",
    "sev.avg": "Avg",
    "sev.high": "High",
    "sev.offline": "Offline",
    "sev.offline.tip": "Show only offline hosts",
    "sev.reset.tip": "Reset filter",
    "legend.groups": "GROUPS",
    "legend.severity": "SEVERITY",
    "legend.ring": "RING",
    "legend.ring.cpu": "CPU",
    "legend.ring.memory": "Memory",
    "legend.ring.traffic": "Traffic",
    "legend.ring.ping": "Ping",
    "hist.load_error": "Loading failed",
    "hist.title": "History",
    "hist.play_pause": "Play / pause",
    "hist.close": "\u2715 Close",
    "hist.button": "\u{1F551} History",
    "hist.button.tip": "History mode: show trigger status at the selected time",
    "layout.auto": "Auto",
    "layout.force": "Force",
    "layout.concentric": "Concentric",
    "layout.grid": "Grid",
    "layout.tree": "Tree",
    "layout.hierarchy": "Hierarchy",
    "tech.badge.hosts": "Hosts",
    "tech.badge.ok": "OK",
    "tech.badge.warn": "Warn",
    "tech.badge.down": "Down",
    "tech.no_hosts": "No hosts found.",
    "tech.link.targets": "Click targets (ESC = done)",
    "tip.maintenance": "Maintenance",
    "tip.problem_since": "Problem since: {t}",
    "tip.loading_history": "Loading history...",
    "tip.no_traffic_history": "No traffic history available (no net.if/ifIn/ifOut items)",
    "tip.last_1h": "last 1h",
    "app.pick_groups": "\u2190 Please select host groups and click Apply.",
    "app.loading": "Loading topology...",
    "app.error": "Error: {msg}",
    "agg.no_group": "\u2014 No group \u2014",
    "minimap.tip": "Minimap \u2014 click to navigate",
    // Maintenance from the map (context-menu.js)
    "maint.row": "\u{1F527} Maintenance {dur}",
    "maint.confirm": "Put {host} into maintenance for {dur}? Alerts will be suppressed.",
    "maint.ok": "Maintenance created for {host} ({dur}) \u2014 active in ~1 min.",
    "maint.fail": "Maintenance failed: {msg}",
    // Host resource forecast (render-stats.js)
    "rf.title": "Host resource forecast",
    "rf.caveat": "Linear projection of CPU%/memory% trends (Zabbix trends, same period as above). Only hosts with % items (system.cpu.util, vm.memory\u2026pused). CPU trends are volatile \u2014 memory trends catch leaks/growth more reliably. Thresholds: memory 90%, CPU 85%.",
    "rf.nogroups": "No host groups selected.",
    "rf.nodata": "No CPU/memory % trends found (trends enabled? % items present?).",
    "rf.summary": "{hosts} hosts with resource trends \xB7 based on {days} days \xB7 thresholds: mem 90%, CPU 85%",
    "rf.col.host": "Host",
    "rf.col.mem": "Memory",
    "rf.col.mem_week": "Mem trend/week",
    "rf.col.mem_eta": "Mem \u2192 90%",
    "rf.col.cpu": "CPU",
    "rf.col.cpu_eta": "CPU \u2192 85%",
    "rf.more": "+{n} more hosts (due later or stable)",
    "rf.eta.now": "threshold reached",
    // Bottom color-guide bar in the Technical tab (legend.js)
    "legend.guide.title": "Color guide",
    "legend.guide.nodes": "Nodes",
    "legend.guide.optimal": "Optimal",
    "legend.guide.offline": "Offline",
    "legend.guide.maint": "Maintenance / stale",
    "legend.guide.edges": "Links",
    "legend.guide.link_lldp": "LLDP/CDP link",
    "legend.guide.link_inet": "Internet uplink",
    "legend.guide.iface_down": "Interface down",
    "legend.guide.weathermap": "Weathermap: utilization low \u2192 high",
    "legend.guide.rings": "Metric rings",
    // Auto-refresh failure badge (render-tech.js)
    "tech.refresh_stale": "\u26A0 Data stale \u2014 refresh failed",
    "tech.refresh_stale.tip": "{n} consecutive failed refreshes. Showing the last successful state."
  };

  // assets/js/modules/i18n.js
  var DICTS = { de: de_default, en: en_default };
  function detectLang() {
    const cfg = window.NT_CONFIG || {};
    const raw = String(cfg.lang || "").toLowerCase();
    if (raw.indexOf("de") === 0) return "de";
    if (raw === "default" || raw === "") {
      const nav = String(navigator.language || "en").toLowerCase();
      return nav.indexOf("de") === 0 ? "de" : "en";
    }
    return "en";
  }
  var _lang = detectLang();
  function t(key, vars) {
    let s = DICTS[_lang][key];
    if (s === void 0) s = DICTS.en[key];
    if (s === void 0) return key;
    if (vars) {
      Object.keys(vars).forEach(function(k) {
        s = s.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return s;
  }

  // assets/js/modules/storage.js
  function userPrefix() {
    const cfg = window.NT_CONFIG;
    const uid = cfg && cfg.user_id ? String(cfg.user_id) : "";
    return uid && uid !== "0" ? "u" + uid + "_" : "";
  }
  var LEG = {
    POS: "nt_pos_",
    PIN: "nt_pinned_",
    NOTES: "nt_notes_",
    LINKS: "nt_manual_links",
    LLDP: "nt_lldp_visible",
    TAB: "nt_active_tab"
  };
  var PFX = userPrefix();
  var NT_POS_PREFIX = "nt_" + PFX + "pos_";
  var NT_PINNED_PREFIX = "nt_" + PFX + "pinned_";
  var NT_NOTES_PREFIX = "nt_" + PFX + "notes_";
  var NT_LINKS_KEY = "nt_" + PFX + "manual_links";
  var NT_LLDP_KEY = "nt_" + PFX + "lldp_visible";
  var NT_WEATHERMAP_KEY = "nt_" + PFX + "weathermap";
  var NT_PORTLABELS_KEY = "nt_" + PFX + "portlabels";
  var NT_LEGEND_COLLAPSED_KEY = "nt_" + PFX + "legend_collapsed";
  var NT_TAB_KEY = "nt_" + PFX + "active_tab";
  var NT_GROUP_VIEW_KEY = "nt_" + PFX + "group_view";
  var NT_SEV_FILTER_KEY = "nt_" + PFX + "sev_filter";
  var NT_LAYOUT_KEY = "nt_" + PFX + "layout";
  var NT_GEO_PROVIDER_KEY = "nt_" + PFX + "geo_provider";
  var NT_TAPHOLD_KEY = "nt_" + PFX + "taphold_ms";
  var NT_TABLE_MODE_KEY = "nt_" + PFX + "table_mode";
  var NT_ITEMS_PATTERN_KEY = "nt_" + PFX + "items_pattern";
  var NT_ITEMS_HIDE_EMPTY_KEY = "nt_" + PFX + "items_hide_empty";
  var NT_ITEMS_HEATMAP_KEY = "nt_" + PFX + "items_heatmap";
  var NT_GROUP_CLUSTER_KEY = "nt_" + PFX + "group_cluster";
  (function migrateLegacyKeys() {
    if (!PFX) return;
    const sentinel = "nt_" + PFX + "migrated";
    try {
      if (localStorage.getItem(sentinel)) return;
    } catch (e) {
      return;
    }
    try {
      const mappings = [
        [LEG.POS, NT_POS_PREFIX],
        [LEG.PIN, NT_PINNED_PREFIX],
        [LEG.NOTES, NT_NOTES_PREFIX]
      ];
      const toMigrate = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        for (let m = 0; m < mappings.length; m++) {
          const oldP = mappings[m][0], newP = mappings[m][1];
          if (key.indexOf(oldP) === 0 && key.indexOf(newP) !== 0) {
            toMigrate.push([key, newP + key.substring(oldP.length)]);
          }
        }
      }
      toMigrate.forEach(function(pair) {
        if (localStorage.getItem(pair[1]) === null) {
          const v = localStorage.getItem(pair[0]);
          if (v !== null) localStorage.setItem(pair[1], v);
        }
      });
      [
        [LEG.LINKS, NT_LINKS_KEY],
        [LEG.LLDP, NT_LLDP_KEY],
        [LEG.TAB, NT_TAB_KEY]
      ].forEach(function(pair) {
        const v = localStorage.getItem(pair[0]);
        if (v !== null && localStorage.getItem(pair[1]) === null) {
          localStorage.setItem(pair[1], v);
        }
      });
      localStorage.setItem(sentinel, String(Date.now()));
    } catch (e) {
    }
  })();
  function selectedGroupIds() {
    const cfg = window.NT_CONFIG;
    const ids = cfg && cfg.selected_groupids ? cfg.selected_groupids.slice().sort() : [];
    return ids.join("_");
  }
  function pinnedKey() {
    return NT_PINNED_PREFIX + selectedGroupIds();
  }
  function notesKey() {
    return NT_NOTES_PREFIX + selectedGroupIds();
  }
  function posKey() {
    let viewSuffix = "";
    try {
      if (localStorage.getItem(NT_GROUP_VIEW_KEY) === "1") viewSuffix = "_grp";
    } catch (e) {
    }
    return NT_POS_PREFIX + selectedGroupIds() + viewSuffix;
  }
  function loadPinned() {
    try {
      return JSON.parse(localStorage.getItem(pinnedKey()) || "[]");
    } catch (e) {
      return [];
    }
  }
  function savePinned(cyInst) {
    const ids = [];
    cyInst.nodes("[!isGroup]").forEach(function(n) {
      if (n.locked()) ids.push(n.id());
    });
    try {
      localStorage.setItem(pinnedKey(), JSON.stringify(ids));
    } catch (e) {
    }
  }
  function loadNotes() {
    try {
      return JSON.parse(localStorage.getItem(notesKey()) || "{}");
    } catch (e) {
      return {};
    }
  }
  function saveNote(hostId, text) {
    const notes = loadNotes();
    if (text && text.trim()) notes[hostId] = text.trim();
    else delete notes[hostId];
    try {
      localStorage.setItem(notesKey(), JSON.stringify(notes));
    } catch (e) {
    }
    return notes;
  }
  function loadPositions() {
    try {
      return JSON.parse(localStorage.getItem(posKey()) || "null") || {};
    } catch (e) {
      return {};
    }
  }
  function savePositions(cyInst) {
    const pos = {};
    let nonZero = 0;
    cyInst.nodes("[!isGroup]").forEach(function(n) {
      const id = String(n.id());
      if (id.indexOf("internet_") === 0) return;
      const p = n.position();
      pos[id] = { x: Math.round(p.x), y: Math.round(p.y) };
      if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) nonZero++;
    });
    if (nonZero === 0) return;
    try {
      localStorage.setItem(posKey(), JSON.stringify(pos));
    } catch (e) {
    }
  }
  function clearPositions() {
    try {
      localStorage.removeItem(posKey());
    } catch (e) {
    }
  }
  function loadLinks() {
    try {
      return JSON.parse(localStorage.getItem(NT_LINKS_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function saveLinks(links) {
    try {
      localStorage.setItem(NT_LINKS_KEY, JSON.stringify(links));
    } catch (e) {
    }
  }
  function loadSevFilter() {
    try {
      const arr = JSON.parse(localStorage.getItem(NT_SEV_FILTER_KEY) || "[]");
      return new Set(Array.isArray(arr) ? arr.filter(function(n) {
        return typeof n === "number";
      }) : []);
    } catch (e) {
      return /* @__PURE__ */ new Set();
    }
  }
  function saveSevFilter(sevSet) {
    try {
      localStorage.setItem(NT_SEV_FILTER_KEY, JSON.stringify(Array.from(sevSet)));
    } catch (e) {
    }
  }
  function loadLayout() {
    try {
      return localStorage.getItem(NT_LAYOUT_KEY) || "auto";
    } catch (e) {
      return "auto";
    }
  }
  function saveLayout(layoutId) {
    try {
      localStorage.setItem(NT_LAYOUT_KEY, layoutId);
    } catch (e) {
    }
  }
  function loadGeoProvider() {
    try {
      return localStorage.getItem(NT_GEO_PROVIDER_KEY) || "osm";
    } catch (e) {
      return "osm";
    }
  }
  function saveGeoProvider(providerId) {
    try {
      localStorage.setItem(NT_GEO_PROVIDER_KEY, providerId);
    } catch (e) {
    }
  }
  function loadTapholdMs() {
    try {
      const v = parseInt(localStorage.getItem(NT_TAPHOLD_KEY), 10);
      return [300, 500, 800].indexOf(v) >= 0 ? v : 500;
    } catch (e) {
      return 500;
    }
  }
  function saveTapholdMs(ms) {
    try {
      localStorage.setItem(NT_TAPHOLD_KEY, String(ms));
    } catch (e) {
    }
  }
  var NT_PRESETS_KEY = "nt_" + PFX + "presets";
  var NT_ACTIVE_PRESET_KEY = "nt_" + PFX + "active_preset";
  function loadPresets() {
    try {
      return JSON.parse(localStorage.getItem(NT_PRESETS_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function savePresets(arr) {
    try {
      localStorage.setItem(NT_PRESETS_KEY, JSON.stringify(arr));
    } catch (e) {
    }
  }
  function loadRelevantPresets() {
    const all = loadPresets();
    const currentScope = selectedGroupIds();
    return all.filter(function(p) {
      if (p.scope === "global") return true;
      if (p.scope === "groupset") return p.scopeKey === currentScope;
      return false;
    });
  }
  function loadActivePreset() {
    try {
      const raw = localStorage.getItem(NT_ACTIVE_PRESET_KEY);
      if (!raw) return null;
      if (raw[0] !== "{") {
        return { name: raw, scope: null, scopeKey: null };
      }
      const parsed = JSON.parse(raw);
      return parsed && parsed.name ? parsed : null;
    } catch (e) {
      return null;
    }
  }
  function saveActivePreset(name, scope, scopeKey) {
    try {
      if (name) {
        localStorage.setItem(NT_ACTIVE_PRESET_KEY, JSON.stringify({
          name,
          scope: scope || null,
          scopeKey: scopeKey || null
        }));
      } else {
        localStorage.removeItem(NT_ACTIVE_PRESET_KEY);
      }
    } catch (e) {
    }
  }
  function savePreset(name, scope, data) {
    const all = loadPresets();
    const scopeKey = scope === "groupset" ? selectedGroupIds() : null;
    const existing = all.findIndex(function(p) {
      return p.name === name && p.scope === scope && (scope === "global" || p.scopeKey === scopeKey);
    });
    const preset = {
      name,
      scope,
      scopeKey,
      createdAt: existing >= 0 ? all[existing].createdAt : Math.floor(Date.now() / 1e3),
      updatedAt: Math.floor(Date.now() / 1e3),
      data
    };
    if (existing >= 0) all[existing] = preset;
    else all.push(preset);
    savePresets(all);
    return preset;
  }
  function deletePreset(name, scope, scopeKey) {
    const all = loadPresets();
    const filtered = all.filter(function(p) {
      return !(p.name === name && p.scope === scope && (scope === "global" || p.scopeKey === scopeKey));
    });
    savePresets(filtered);
  }
  function applyPreset(preset) {
    if (!preset || !preset.data) return;
    const d = preset.data;
    if (d.positions) {
      try {
        localStorage.setItem(posKey(), JSON.stringify(d.positions));
      } catch (e) {
      }
    }
    if (d.pinned) {
      try {
        localStorage.setItem(pinnedKey(), JSON.stringify(d.pinned));
      } catch (e) {
      }
    }
    if (d.notes) {
      try {
        localStorage.setItem(notesKey(), JSON.stringify(d.notes));
      } catch (e) {
      }
    }
    if (d.links) {
      try {
        localStorage.setItem(NT_LINKS_KEY, JSON.stringify(d.links));
      } catch (e) {
      }
    }
    saveActivePreset(preset.name, preset.scope, preset.scopeKey);
  }
  function collectCurrentState() {
    return {
      positions: loadPositions(),
      pinned: loadPinned(),
      notes: loadNotes(),
      links: loadLinks()
    };
  }
  var NT_FILTER_PRESETS_KEY = "nt_" + PFX + "filter_presets";
  function loadFilterPresets() {
    try {
      const v = JSON.parse(localStorage.getItem(NT_FILTER_PRESETS_KEY) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }
  function saveFilterPresets(arr) {
    try {
      localStorage.setItem(NT_FILTER_PRESETS_KEY, JSON.stringify(arr || []));
    } catch (e) {
    }
  }
  var NT_LAST_GROUPS_KEY = "nt_" + PFX + "last_groupids";
  function loadLastGroups() {
    try {
      return JSON.parse(localStorage.getItem(NT_LAST_GROUPS_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function saveLastGroups(groupids) {
    try {
      localStorage.setItem(NT_LAST_GROUPS_KEY, JSON.stringify(groupids || []));
    } catch (e) {
    }
  }

  // assets/js/modules/severity.js
  var SEV_COL = ["#22c55e", "#06b6d4", "#f59e0b", "#f97316", "#ef4444", "#991b1b"];
  var SEV_LBL = ["Normal", "Info", "Warning", "Average", "High", "Disaster"];
  var GRP_COLORS = [
    "#3b82f6",
    "#22c55e",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#06b6d4",
    "#f97316",
    "#ec4899",
    "#14b8a6",
    "#84cc16",
    "#6366f1",
    "#e11d48"
  ];
  var _gcMap = {};
  var _gcIdx = 0;
  function grpColor(name) {
    if (!name) return "#94a3b8";
    if (!_gcMap[name]) {
      _gcMap[name] = GRP_COLORS[_gcIdx++ % GRP_COLORS.length];
    }
    return _gcMap[name];
  }
  function primaryGroup(n, sel) {
    if (!n.groups || !n.groups.length) return null;
    if (sel && sel.length) {
      for (let i = 0; i < sel.length; i++) {
        if (n.groups.indexOf(sel[i]) >= 0) return sel[i];
      }
    }
    return n.groups[0];
  }

  // assets/js/modules/icons.js
  var TYPE_ICON = {
    server: "M-11,-13 h22 v4 h-22z M-11,-6 h22 v4 h-22z M-11,1 h22 v4 h-22z M-11,8 h22 v4 h-22z M8,-11 a1.5,1.5 0 1,1 0,0.01 M8,-4 a1.5,1.5 0 1,1 0,0.01 M8,3 a1.5,1.5 0 1,1 0,0.01 M8,10 a1.5,1.5 0 1,1 0,0.01",
    firewall: "M0,-13 L11,-8 L11,1 C11,8 6,12 0,14 C-6,12 -11,8 -11,1 L-11,-8z M-4,1 h8 M-2,-4 h4 M0,-7 v3",
    router: "M0,-12 a12,12 0 1,1 0,0.01z M-12,0 h24 M-6,-6 L6,6 M6,-6 L-6,6 M0,-12 v24",
    switch: "M-12,-5 h24 v10 h-24z M-9,0 v-8 M-5,0 v-8 M-1,0 v-8 M3,0 v-8 M7,0 v-8 M-9,-4 h2 v-4 h-2z",
    wireless: "M0,9 a2,2 0 1,1 0,0.01 M-4,4 a6,6 0 0,1 8,0 M-8,0 a12,12 0 0,1 16,0 M-12,-4 a18,18 0 0,1 24,0",
    storage: "M-11,-11 h22 v6 h-22z M-11,-2 h22 v6 h-22z M-11,7 h22 v6 h-22z M7,-8 a1.5,1.5 0 1,1 0,0.01 M7,1 a1.5,1.5 0 1,1 0,0.01",
    camera: "M-11,-7 h15 l3,-4 h4 l3,4 h3 v14 h-28z M0,3 a5,5 0 1,1 0,0.01",
    printer: "M-10,-1 h20 v9 h-20z M-7,-9 h14 v8 h-14z M-7,8 h14 v8 h-14z M-4,11 h8 M-4,14 h8",
    // Gestapelte Karten — visualisiert eine Gruppe von Hosts (Group-View)
    group: "M-11,-9 h18 v14 h-18z M-7,-13 h18 v14 h-18z M-3,-5 h8 M-3,-1 h8 M-3,3 h8",
    // Wolke — virtueller Internet-Knoten (Hierarchie-Layout)
    internet: "M-10,4 a6,6 0 0,1 0,-12 a6,6 0 0,1 5,3 a5,5 0 0,1 9,2 a5,5 0 0,1 0,7 z"
  };
  var C = 48;
  var RO = 42;
  var RI = 26;
  function pieSlice(r, sDeg, eDeg) {
    if (eDeg <= sDeg + 0.5) return "";
    const S = (sDeg - 90) * Math.PI / 180, E = (eDeg - 90) * Math.PI / 180;
    const large = eDeg - sDeg > 180 ? 1 : 0;
    return "M " + C + " " + C + " L " + (C + r * Math.cos(S)).toFixed(2) + " " + (C + r * Math.sin(S)).toFixed(2) + " A " + r + " " + r + " 0 " + large + " 1 " + (C + r * Math.cos(E)).toFixed(2) + " " + (C + r * Math.sin(E)).toFixed(2) + " Z";
  }
  function trafficPct(d) {
    return !d.traffic ? 0 : Math.min((d.traffic.in + d.traffic.out) / 2e7 * 100, 100);
  }
  function pingPct(d) {
    return !d.ping || d.ping <= 0 ? 0 : Math.min(d.ping / 200 * 100, 100);
  }
  var _imgCache = {};
  var _IMG_CACHE_MAX = 500;
  function _imgCachePrune() {
    const keys = Object.keys(_imgCache);
    if (keys.length > _IMG_CACHE_MAX) {
      keys.slice(0, 100).forEach(function(k) {
        delete _imgCache[k];
      });
    }
  }
  function clearImgCache() {
    Object.keys(_imgCache).forEach(function(k) {
      delete _imgCache[k];
    });
  }
  function makeNodeImage(d) {
    const key = [
      d.id,
      d.severity,
      d.cpu,
      d.memory,
      d.ping,
      d.traffic ? d.traffic.in : 0,
      d.traffic ? d.traffic.out : 0,
      d._primaryGroup,
      d.problems || 0,
      d.pinned ? 1 : 0,
      d.note ? 1 : 0,
      d.acknowledged ? 1 : 0,
      d.maintenance ? 1 : 0,
      d.unavailable ? 1 : 0
    ].join("|");
    if (_imgCache[key]) return _imgCache[key];
    const offline = !!d.unavailable;
    const dead = !offline && (d.severity || 0) >= 5;
    const sevCol = offline ? "#9ca3af" : SEV_COL[Math.min(d.severity || 0, SEV_COL.length - 1)];
    const gc = grpColor(d._primaryGroup);
    const segs = [
      { col: "#3b82f6", val: Math.min(d.cpu || 0, 100) },
      { col: "#8b5cf6", val: Math.min(d.memory || 0, 100) },
      { col: "#22c55e", val: trafficPct(d) },
      { col: "#f59e0b", val: pingPct(d) }
    ];
    let p = "";
    const segFillOp = offline ? "0.08" : "0.12";
    const segValOp = offline ? "0.30" : "0.85";
    segs.forEach(function(seg, i) {
      const base = i * 90;
      p += '<path d="' + pieSlice(RO, base, base + 90) + '" fill="' + seg.col + '" fill-opacity="' + segFillOp + '"/>';
      if (seg.val > 1) {
        p += '<path d="' + pieSlice(RO, base, base + seg.val * 0.9) + '" fill="' + seg.col + '" fill-opacity="' + segValOp + '"/>';
      }
      const a = (base - 90) * Math.PI / 180;
      p += '<line x1="' + (C + RI * Math.cos(a)).toFixed(1) + '" y1="' + (C + RI * Math.sin(a)).toFixed(1) + '" x2="' + (C + RO * Math.cos(a)).toFixed(1) + '" y2="' + (C + RO * Math.sin(a)).toFixed(1) + '" stroke="white" stroke-width="1.5"/>';
    });
    const ringStroke = offline ? "#9ca3af" : dead ? "#94a3b8" : sevCol;
    const ringDash = offline ? ' stroke-dasharray="6,4"' : "";
    const ringOp = offline || dead ? "0.6" : "1";
    p += '<circle cx="' + C + '" cy="' + C + '" r="' + RI + '" fill="' + gc + '" fill-opacity="' + (offline || dead ? "0.08" : "0.15") + '" stroke="' + ringStroke + '" stroke-width="3" opacity="' + ringOp + '"' + ringDash + "/>";
    if (d.acknowledged) {
      p += '<circle cx="' + C + '" cy="' + C + '" r="' + (RI + 4) + '" fill="none" stroke="#22c55e" stroke-width="2.5" opacity="0.95"/>';
      p += '<circle cx="' + C + '" cy="' + C + '" r="' + (RI + 7) + '" fill="none" stroke="#22c55e" stroke-width="1" stroke-dasharray="3,2" opacity="0.7"/>';
    }
    if (d.maintenance) {
      p += '<circle cx="' + C + '" cy="' + C + '" r="' + (RI + 10) + '" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="5,3" opacity="0.85"/>';
    }
    if (offline) {
      const icon = TYPE_ICON[d.type] || TYPE_ICON.server;
      p += '<g transform="translate(' + C + "," + C + ') scale(0.62)" fill="none" stroke="#9ca3af" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.32"><path d="' + icon + '"/></g>';
      p += '<g transform="translate(' + C + "," + C + ')" stroke="#ffffff" stroke-width="7" stroke-linecap="round" opacity="0.95"><line x1="-15" y1="-15" x2="15" y2="15"/><line x1="15"  y1="-15" x2="-15" y2="15"/></g>';
      p += '<g transform="translate(' + C + "," + C + ')" stroke="#dc2626" stroke-width="4.5" stroke-linecap="round"><line x1="-15" y1="-15" x2="15" y2="15"/><line x1="15"  y1="-15" x2="-15" y2="15"/></g>';
    } else if (dead) {
      p += '<g transform="translate(' + C + "," + (C - 3) + ') scale(0.62)"><path d="M0,-14 a13,10 0 0,1 13,10 L13,4 Q13,9 8,10 L-8,10 Q-13,9 -13,4 L-13,-4 a13,10 0 0,1 13,-10z" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1.5"/><rect x="-9" y="10" width="5" height="5" rx="1" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1.2"/><rect x="-2" y="10" width="5" height="5" rx="1" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1.2"/><rect x="5" y="10" width="5" height="5" rx="1" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1.2"/><path d="M-7,-3 L-4,0 M-4,-3 L-7,0 M4,-3 L7,0 M7,-3 L4,0" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" fill="none"/></g>';
    } else {
      const icon = TYPE_ICON[d.type] || TYPE_ICON.server;
      p += '<g transform="translate(' + C + "," + C + ') scale(0.62)" fill="none" stroke="#475569" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="' + icon + '"/></g>';
    }
    if (d.pinned) {
      p += '<circle cx="14" cy="14" r="11" fill="#3b82f6" opacity="0.92" stroke="white" stroke-width="1.2"/>';
      p += '<path d="M14,7 L14,14 M10,10 L18,10 M12,14 L16,14 M14,14 L14,19" stroke="white" stroke-width="1.8" stroke-linecap="round" fill="none"/>';
    }
    if (d.note) {
      p += '<rect x="2" y="' + (C * 2 - 24) + '" width="20" height="20" rx="3" fill="#fbbf24" stroke="#d97706" stroke-width="1"/>';
      p += '<line x1="6" y1="' + (C * 2 - 18) + '" x2="18" y2="' + (C * 2 - 18) + '" stroke="#92400e" stroke-width="1.5" stroke-linecap="round"/>';
      p += '<line x1="6" y1="' + (C * 2 - 13) + '" x2="18" y2="' + (C * 2 - 13) + '" stroke="#92400e" stroke-width="1.5" stroke-linecap="round"/>';
      p += '<line x1="6" y1="' + (C * 2 - 8) + '" x2="14" y2="' + (C * 2 - 8) + '" stroke="#92400e" stroke-width="1.5" stroke-linecap="round"/>';
    }
    const prob = d.problems || 0;
    if (prob > 0) {
      const bLabel = prob > 99 ? "99+" : String(prob);
      const bR = bLabel.length > 2 ? 13 : 10;
      const bX = C * 2 - bR - 2;
      const bY = bR + 2;
      p += '<circle cx="' + bX + '" cy="' + bY + '" r="' + bR + '" fill="#ef4444" stroke="white" stroke-width="1.5"/>';
      p += '<text x="' + bX + '" y="' + bY + '" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="' + (bLabel.length > 2 ? 8 : 10) + '" font-weight="700" fill="white">' + bLabel + "</text>";
    }
    if (d.maintenance) {
      const mR = 10;
      const mX = prob > 0 ? C * 2 - 22 - mR - 2 : C * 2 - mR - 2;
      const mY = mR + 2;
      p += '<circle cx="' + mX + '" cy="' + mY + '" r="' + mR + '" fill="#f59e0b" stroke="white" stroke-width="1.5"/>';
      p += '<g transform="translate(' + mX + "," + mY + ') scale(0.55)" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M-5,-5 L5,5 M-5,5 L5,-5"/><circle cx="-5" cy="-5" r="2.5" fill="white" stroke="none"/></g>';
    }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + C * 2 + '" height="' + C * 2 + '">' + p + "</svg>";
    const url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
    if (_imgCache[key]) delete _imgCache[key];
    _imgCache[key] = url;
    _imgCachePrune();
    return url;
  }

  // assets/js/modules/path-highlight.js
  var _startId = null;
  var _active = false;
  function getPathStart() {
    return _startId;
  }
  function isPathActive() {
    return _active;
  }
  function setPathStart(id) {
    _startId = id ? String(id) : null;
  }
  function _findPath(cy, startId, endId) {
    const parent = {};
    parent[startId] = null;
    const queue = [startId];
    let found = false;
    while (queue.length) {
      const cur2 = queue.shift();
      if (cur2 === endId) {
        found = true;
        break;
      }
      const node = cy.getElementById(cur2);
      if (!node.length) continue;
      node.connectedEdges().forEach(function(edge) {
        const sId = edge.source().id();
        const tId = edge.target().id();
        const nbr = sId === cur2 ? tId : sId;
        if (!(nbr in parent)) {
          parent[nbr] = { from: cur2, edge: edge.id() };
          queue.push(nbr);
        }
      });
    }
    if (!found) return null;
    const nodeIds = [];
    const edgeIds = [];
    let cur = endId;
    while (cur) {
      nodeIds.push(cur);
      const p = parent[cur];
      if (!p) break;
      edgeIds.push(p.edge);
      cur = p.from;
    }
    return { nodeIds, edgeIds };
  }
  function applyPathHighlight(cy, fromId, toId) {
    if (!cy || !fromId || !toId || String(fromId) === String(toId)) return false;
    clearPathHighlight(cy);
    const sId = String(fromId), tId = String(toId);
    const fromN = cy.getElementById(sId);
    const toN = cy.getElementById(tId);
    if (!fromN.length || !toN.length) return false;
    const path = _findPath(cy, sId, tId);
    if (!path) return false;
    const nodeSel = path.nodeIds.map(function(id) {
      return "#" + CSS.escape(id);
    }).join(",");
    const edgeSel = path.edgeIds.map(function(id) {
      return "#" + CSS.escape(id);
    }).join(",");
    const pathNodes = cy.nodes(nodeSel);
    const pathEdges = path.edgeIds.length ? cy.edges(edgeSel) : cy.collection();
    const pathEles = pathNodes.union(pathEdges);
    cy.elements().not(pathEles).addClass("nt-path-dim");
    pathNodes.addClass("nt-path-node");
    pathEdges.addClass("nt-path-edge");
    _active = true;
    return true;
  }
  function clearPathHighlight(cy) {
    if (!cy) return;
    cy.elements().removeClass("nt-path-dim nt-path-edge nt-path-node");
    _active = false;
  }
  function clearPathState(cy) {
    clearPathHighlight(cy);
    _startId = null;
  }

  // assets/js/modules/highlight.js
  var _activeId = null;
  function _bfs(cy, startId) {
    const visited = {};
    const queue = [startId];
    visited[startId] = true;
    while (queue.length) {
      const cur = queue.shift();
      cy.getElementById(cur).connectedEdges().forEach(function(edge) {
        [edge.source().id(), edge.target().id()].forEach(function(nid) {
          if (!visited[nid] && !cy.getElementById(nid).data("isGroup")) {
            visited[nid] = true;
            queue.push(nid);
          }
        });
      });
    }
    return visited;
  }
  function applyHighlight(cy, nodeId) {
    const visited = _bfs(cy, nodeId);
    cy.nodes("[!isGroup]").forEach(function(n) {
      n.style("opacity", visited[n.id()] ? 1 : 0.1);
    });
    cy.edges().forEach(function(e) {
      const show = visited[e.source().id()] && visited[e.target().id()];
      e.style("opacity", show ? 0.85 : 0.06);
    });
    _activeId = nodeId;
  }
  function resetHighlight(cy) {
    if (!_activeId) return;
    cy.nodes("[!isGroup]").forEach(function(n) {
      n.style("opacity", 1);
    });
    cy.edges().forEach(function(e) {
      e.style("opacity", 0.85);
    });
    _activeId = null;
  }
  function getActiveHighlightId() {
    return _activeId;
  }

  // assets/js/modules/toast.js
  var TOAST_COLORS = {
    info: { bg: "#0891b2", fg: "#ffffff" },
    // cyan
    success: { bg: "#16a34a", fg: "#ffffff" },
    // grün
    warn: { bg: "#d97706", fg: "#ffffff" },
    // orange
    error: { bg: "#dc2626", fg: "#ffffff" }
    // rot
  };
  var _stack = null;
  function _ensureStack() {
    if (_stack && document.body.contains(_stack)) return _stack;
    _stack = document.createElement("div");
    _stack.id = "nt-toast-stack";
    _stack.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:380px";
    document.body.appendChild(_stack);
    return _stack;
  }
  function toast(message, type, durationMs) {
    const t2 = TOAST_COLORS[type] || TOAST_COLORS.info;
    const ms = typeof durationMs === "number" ? durationMs : 3500;
    const stack = _ensureStack();
    const el = document.createElement("div");
    el.style.cssText = "pointer-events:auto;background:" + t2.bg + ";color:" + t2.fg + ";padding:10px 14px;border-radius:6px;font-size:13px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,0.25);cursor:pointer;opacity:0;transform:translateX(20px);transition:opacity 0.18s,transform 0.18s;max-width:100%;word-wrap:break-word";
    el.textContent = String(message);
    let timer = null;
    const remove = function() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      el.style.opacity = "0";
      el.style.transform = "translateX(20px)";
      setTimeout(function() {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 200);
    };
    el.addEventListener("click", remove);
    stack.appendChild(el);
    requestAnimationFrame(function() {
      el.style.opacity = "1";
      el.style.transform = "translateX(0)";
    });
    timer = setTimeout(remove, ms);
  }

  // assets/js/modules/whatif.js
  var _simulated = /* @__PURE__ */ new Set();
  function isSimActive() {
    return _simulated.size > 0;
  }
  function isSimulated(id) {
    return _simulated.has(String(id));
  }
  function simulatedCount() {
    return _simulated.size;
  }
  function toggleSimulatedHost(cy, hostId) {
    const id = String(hostId);
    if (_simulated.has(id)) _simulated.delete(id);
    else _simulated.add(id);
    recomputeSimulation(cy);
  }
  function clearSimulation(cy) {
    _simulated.clear();
    if (cy && !(cy.destroyed && cy.destroyed())) {
      cy.elements().removeClass("nt-sim-dead nt-sim-cut");
    }
    _removeBanner();
  }
  function findRoots(cy, excludeSimulated) {
    let roots = cy.nodes("[?_isInternet]");
    if (roots.length === 0) {
      roots = cy.nodes("[!isGroup]").filter(function(n) {
        const t2 = n.data("type");
        return t2 === "firewall" || t2 === "router";
      });
    }
    if (!excludeSimulated) return roots;
    return roots.filter(function(n) {
      return !_simulated.has(n.id());
    });
  }
  function highestDegree(cy, excludeSimulated) {
    let best = null, bestDeg = -1;
    cy.nodes("[!isGroup]").forEach(function(n) {
      if (excludeSimulated && _simulated.has(n.id())) return;
      const d = n.degree(false);
      if (d > bestDeg) {
        bestDeg = d;
        best = n;
      }
    });
    return best;
  }
  function reachable(cy, roots, blocked) {
    const visited = {};
    const queue = [];
    roots.forEach(function(n) {
      if (blocked && blocked.has(n.id())) return;
      visited[n.id()] = true;
      queue.push(n.id());
    });
    while (queue.length) {
      const cur = queue.shift();
      cy.getElementById(cur).connectedEdges().forEach(function(edge) {
        const s = edge.source().id();
        const t2 = edge.target().id();
        const nbr = s === cur ? t2 : s;
        if (visited[nbr] || blocked && blocked.has(nbr)) return;
        visited[nbr] = true;
        queue.push(nbr);
      });
    }
    return visited;
  }
  function recomputeSimulation(cy) {
    if (!cy || cy.destroyed && cy.destroyed()) return;
    cy.elements().removeClass("nt-sim-dead nt-sim-cut");
    if (_simulated.size === 0) {
      _removeBanner();
      return;
    }
    let baseRoots = findRoots(cy, false);
    if (baseRoots.length === 0) {
      baseRoots = highestDegree(cy, false);
      if (!baseRoots) {
        _removeBanner();
        return;
      }
    }
    const baseline = reachable(cy, baseRoots, null);
    let roots = findRoots(cy, true);
    if (roots.length === 0) {
      const best = highestDegree(cy, true);
      if (!best) {
        _removeBanner();
        return;
      }
      roots = best;
      toast(t("whatif.root_fallback", { host: best.data("label") || best.id() }), "info");
    }
    const visited = reachable(cy, roots, _simulated);
    let cutCount = 0;
    cy.nodes("[!isGroup]").forEach(function(n) {
      const id = n.id();
      if (_simulated.has(id)) {
        n.addClass("nt-sim-dead");
        return;
      }
      if (baseline[id] && !visited[id]) {
        n.addClass("nt-sim-cut");
        cutCount++;
      }
    });
    _showBanner(cy, cutCount);
  }
  function _removeBanner() {
    const b = document.getElementById("nt-whatif-banner");
    if (b) b.remove();
  }
  function _showBanner(cy, cutCount) {
    _removeBanner();
    const wrap = document.getElementById("nt-canvas-wrap");
    if (!wrap) return;
    const banner = document.createElement("div");
    banner.id = "nt-whatif-banner";
    banner.style.cssText = "position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:60;background:#7c2d12;color:#fff;padding:7px 14px;border-radius:6px;font-size:12px;font-family:sans-serif;display:flex;align-items:center;gap:12px;box-shadow:0 4px 16px rgba(0,0,0,0.3)";
    const txt = document.createElement("span");
    txt.textContent = t("whatif.banner", { failed: _simulated.size, cut: cutCount });
    banner.appendChild(txt);
    const btn = document.createElement("button");
    btn.textContent = t("whatif.end");
    btn.style.cssText = "background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.4);color:#fff;border-radius:4px;padding:2px 10px;font-size:11px;cursor:pointer;font-family:inherit";
    btn.addEventListener("click", function() {
      clearSimulation(cy);
    });
    banner.appendChild(btn);
    wrap.appendChild(banner);
  }

  // assets/js/modules/context-menu.js
  var _ctx = document.createElement("div");
  _ctx.style.cssText = "display:none;position:fixed;z-index:9999;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.15);min-width:190px;font-size:13px;overflow:hidden";
  document.body.appendChild(_ctx);
  document.addEventListener("click", function(e) {
    if (!_ctx.contains(e.target)) _ctx.style.display = "none";
  });
  var _onResolveAggregate = null;
  function setResolveAggregateCallback(fn) {
    _onResolveAggregate = fn;
  }
  function _ctxRow(label, color, onClick) {
    const row = document.createElement("div");
    row.textContent = label;
    row.style.cssText = "padding:8px 16px;color:" + (color || "#334155") + ";cursor:pointer;white-space:nowrap;";
    row.addEventListener("mouseenter", function() {
      row.style.background = "#f8fafc";
    });
    row.addEventListener("mouseleave", function() {
      row.style.background = "";
    });
    row.addEventListener("click", function(e) {
      e.stopPropagation();
      _ctx.style.display = "none";
      onClick();
    });
    return row;
  }
  function hideCtx() {
    _ctx.style.display = "none";
  }
  function _createMaintenance(hostId, durationSec, durLabel, hostLabel) {
    const base = window.location.pathname.replace("zabbix.php", "");
    const params = new URLSearchParams();
    params.append("action", "network.topology.v6.maintenance");
    params.append("hostids[]", hostId);
    params.append("duration", String(durationSec));
    fetch(base + "zabbix.php", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    }).then(function(r) {
      return r.json();
    }).then(function(res) {
      if (res && res.ok) {
        toast(t("maint.ok", { host: hostLabel, dur: durLabel }), "info");
      } else {
        toast(t("maint.fail", { msg: res && res.error || "?" }), "warn");
      }
    }).catch(function(e) {
      toast(t("maint.fail", { msg: e.message }), "warn");
    });
  }
  function showCtx(cx, cy2, d) {
    while (_ctx.firstChild) _ctx.removeChild(_ctx.firstChild);
    const base = window.location.pathname.replace("zabbix.php", "");
    const hostId = String(d.id);
    if (d._isAggregate) {
      const header2 = document.createElement("div");
      header2.style.cssText = "padding:8px 12px 6px;font-weight:700;border-bottom:1px solid #f1f5f9;font-size:12px;color:#0f172a";
      header2.textContent = d.label;
      const sub = document.createElement("div");
      sub.style.cssText = "font-size:10px;font-weight:400;color:#64748b;margin-top:2px";
      sub.textContent = t("ctx.hosts", { n: d._childCount || 0 });
      header2.appendChild(sub);
      _ctx.appendChild(header2);
      if (d._topProblems && d._topProblems.length) {
        const probHdr = document.createElement("div");
        probHdr.style.cssText = "padding:6px 12px 2px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px";
        probHdr.textContent = t("ctx.top_problems");
        _ctx.appendChild(probHdr);
        const SEV_LBL_LOC = ["Normal", "Info", "Warning", "Average", "High", "Disaster"];
        d._topProblems.forEach(function(p) {
          const row = document.createElement("div");
          row.style.cssText = "padding:3px 12px;font-size:11px;display:flex;justify-content:space-between;gap:8px";
          const ln = document.createElement("span");
          ln.textContent = p.label;
          ln.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1";
          const lv = document.createElement("span");
          lv.textContent = SEV_LBL_LOC[p.sev] || "Sev " + p.sev;
          lv.style.cssText = "color:" + (SEV_COL[p.sev] || SEV_COL[0]) + ";font-weight:600;font-size:10px";
          row.appendChild(ln);
          row.appendChild(lv);
          _ctx.appendChild(row);
        });
      }
      const sepA = document.createElement("div");
      sepA.style.cssText = "border-top:1px solid #f1f5f9;margin-top:6px";
      _ctx.appendChild(sepA);
      _ctx.appendChild(_ctxRow(t("ctx.resolve_view"), "#3b82f6", function() {
        try {
          localStorage.setItem(NT_GROUP_VIEW_KEY, "0");
        } catch (e) {
        }
        if (_onResolveAggregate) _onResolveAggregate();
      }));
      _ctx.style.left = cx + "px";
      _ctx.style.top = cy2 + "px";
      _ctx.style.display = "block";
      return;
    }
    function zbxUrl(action, hostid) {
      const baseUrl = window.location.origin + base + "zabbix.php?action=" + action;
      if (action === "problem.view") {
        return baseUrl + "&hostids%5B%5D=" + encodeURIComponent(hostid) + "&show=1&filter_set=1";
      }
      if (action === "charts.view") {
        return baseUrl + "&filter_hostids%5B%5D=" + encodeURIComponent(hostid) + "&filter_set=1";
      }
      return baseUrl + "&hostids%5B%5D=" + encodeURIComponent(hostid) + "&filter_set=1";
    }
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 12px 6px;font-weight:700;border-bottom:1px solid #f1f5f9;font-size:12px;color:#0f172a";
    header.textContent = d.label;
    if (d.ip) {
      const ipEl = document.createElement("div");
      ipEl.style.cssText = "font-size:10px;font-weight:400;color:#64748b;font-family:monospace;margin-top:2px";
      ipEl.textContent = "\u{1F517} " + d.ip;
      header.appendChild(ipEl);
    }
    _ctx.appendChild(header);
    if (d.note) {
      const np = document.createElement("div");
      np.style.cssText = "padding:0 16px 6px;font-size:10px;color:#64748b;font-style:italic;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      np.textContent = d.note;
      _ctx.appendChild(np);
    }
    const items = [
      [" Latest Data", zbxUrl("latest.view", hostId)],
      ["\u26A0 Problems", zbxUrl("problem.view", hostId)],
      [" Graphs", zbxUrl("charts.view", hostId)]
    ];
    if (window.NT_CONFIG && window.NT_CONFIG.can_edit) {
      items.push([t("ctx.edit"), window.location.origin + base + "zabbix.php?action=popup&popup=host.edit&hostid=" + encodeURIComponent(hostId)]);
      items.push([t("ctx.hosts_list"), window.location.origin + base + "zabbix.php?action=host.list&filter_name=" + encodeURIComponent(d.host || d.label) + "&filter_set=1"]);
    }
    items.forEach(function(item) {
      const url = item[1];
      _ctx.appendChild(_ctxRow(item[0], "#334155", function() {
        window.open(url, "_blank");
      }));
    });
    if (d.links && d.links.length) {
      const linksHdr = document.createElement("div");
      linksHdr.style.cssText = "padding:6px 12px 2px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-top:1px solid #f1f5f9;margin-top:4px";
      linksHdr.textContent = t("ctx.ext_links");
      _ctx.appendChild(linksHdr);
      d.links.forEach(function(link) {
        const lbl = (link.label || "").substring(0, 24);
        const url = String(link.url || "");
        if (!/^https?:\/\//i.test(url)) return;
        _ctx.appendChild(_ctxRow("\u{1F517} " + lbl, "#0891b2", function() {
          window.open(url, "_blank", "noopener,noreferrer");
        }));
      });
    }
    const sep = document.createElement("div");
    sep.style.cssText = "border-top:1px solid #f1f5f9;margin-top:2px";
    _ctx.appendChild(sep);
    const pinLabel = " " + (d.pinned ? t("ctx.unpin") : t("ctx.pin"));
    _ctx.appendChild(_ctxRow(pinLabel, "#3b82f6", function() {
      const cy = window._ntCy;
      if (!cy) return;
      const node = cy.getElementById(hostId);
      if (!node.length) return;
      const nowPinned = !node.data("pinned");
      node.data("pinned", nowPinned);
      clearImgCache();
      node.data("bgImage", makeNodeImage(node.data()));
      if (nowPinned) node.lock();
      else node.unlock();
      savePinned(cy);
    }));
    const noteLabel = " " + (d.note ? t("ctx.note_edit") : t("ctx.note_add"));
    _ctx.appendChild(_ctxRow(noteLabel, "#f59e0b", function() {
      const cy = window._ntCy;
      if (!cy) return;
      const node = cy.getElementById(hostId);
      if (!node.length) return;
      const text = prompt(t("ctx.note_prompt", { host: d.label }), node.data("note") || "");
      if (text === null) return;
      const notes = saveNote(hostId, text);
      node.data("note", notes[hostId] || "");
      clearImgCache();
      node.data("bgImage", makeNodeImage(node.data()));
    }));
    const pathSep = document.createElement("div");
    pathSep.style.cssText = "border-top:1px solid #f1f5f9;margin-top:2px";
    _ctx.appendChild(pathSep);
    const startId = getPathStart();
    if (isPathActive()) {
      _ctx.appendChild(_ctxRow(t("ctx.path_hide"), "#64748b", function() {
        clearPathState(window._ntCy);
      }));
    } else if (!startId) {
      _ctx.appendChild(_ctxRow(t("ctx.path_start"), "#0891b2", function() {
        const cy = window._ntCy;
        if (!cy) return;
        resetHighlight(cy);
        setPathStart(hostId);
      }));
    } else if (startId === hostId) {
      _ctx.appendChild(_ctxRow(t("ctx.path_reset"), "#64748b", function() {
        clearPathState(window._ntCy);
      }));
    } else {
      _ctx.appendChild(_ctxRow(t("ctx.path_to"), "#0891b2", function() {
        const cy = window._ntCy;
        if (!cy) return;
        resetHighlight(cy);
        const ok = applyPathHighlight(cy, startId, hostId);
        if (!ok) {
          toast(t("ctx.path_none"), "warn");
          clearPathState(cy);
        }
      }));
      _ctx.appendChild(_ctxRow(t("ctx.path_reset"), "#64748b", function() {
        clearPathState(window._ntCy);
      }));
    }
    const simSep = document.createElement("div");
    simSep.style.cssText = "border-top:1px solid #f1f5f9;margin-top:2px";
    _ctx.appendChild(simSep);
    _ctx.appendChild(_ctxRow(
      isSimulated(hostId) ? t("whatif.restore") : t("whatif.simulate"),
      "#ea580c",
      function() {
        const cy = window._ntCy;
        if (!cy) return;
        toggleSimulatedHost(cy, hostId);
      }
    ));
    if (isSimActive()) {
      _ctx.appendChild(_ctxRow(t("whatif.end_all", { n: simulatedCount() }), "#64748b", function() {
        clearSimulation(window._ntCy);
      }));
    }
    if (window.NT_CONFIG && window.NT_CONFIG.can_edit) {
      const maintSep = document.createElement("div");
      maintSep.style.cssText = "border-top:1px solid #f1f5f9;margin-top:2px";
      _ctx.appendChild(maintSep);
      [[3600, "1h"], [14400, "4h"], [28800, "8h"], [86400, "24h"]].forEach(function(dur) {
        _ctx.appendChild(_ctxRow(t("maint.row", { dur: dur[1] }), "#0d9488", function() {
          if (!confirm(t("maint.confirm", { host: d.label, dur: dur[1] }))) return;
          _createMaintenance(hostId, dur[0], dur[1], d.label);
        }));
      });
    }
    _ctx.style.left = cx + "px";
    _ctx.style.top = cy2 + "px";
    _ctx.style.display = "block";
  }

  // assets/js/modules/diff-mode.js
  var KEY = "nt_diff_snapshot_v1";
  function _hostsToMap(nodes) {
    const m = {};
    (nodes || []).forEach(function(n) {
      if (!n || !n.id) return;
      m[String(n.id)] = {
        sev: n.severity || 0,
        probs: n.problems || 0,
        unavail: !!n.unavailable,
        label: n.label || n.host || ""
      };
    });
    return m;
  }
  function saveSnapshot(nodes) {
    const snap = {
      ts: Math.floor(Date.now() / 1e3),
      byHost: _hostsToMap(nodes)
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(snap));
    } catch (e) {
    }
    return snap;
  }
  function loadSnapshot() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.byHost || !parsed.ts) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }
  function clearSnapshot() {
    try {
      localStorage.removeItem(KEY);
    } catch (e) {
    }
  }
  function _severityKey(rec) {
    return rec.unavail ? 6 : rec.sev || 0;
  }
  function computeDiff(currentNodes, snap) {
    const result = {
      new: /* @__PURE__ */ new Set(),
      gone: /* @__PURE__ */ new Set(),
      up: /* @__PURE__ */ new Set(),
      down: /* @__PURE__ */ new Set(),
      sevByHost: /* @__PURE__ */ new Map()
    };
    if (!snap || !snap.byHost) return result;
    const now = _hostsToMap(currentNodes);
    const nowKeys = Object.keys(now);
    const snapKeys = Object.keys(snap.byHost);
    nowKeys.forEach(function(id) {
      if (!snap.byHost[id]) {
        result.new.add(id);
        return;
      }
      const oldRec = snap.byHost[id];
      const newRec = now[id];
      const oldK = _severityKey(oldRec);
      const newK = _severityKey(newRec);
      if (newK > oldK) result.up.add(id);
      else if (newK < oldK) result.down.add(id);
      if (newK !== oldK) {
        result.sevByHost.set(id, { old: oldK, now: newK });
      }
    });
    snapKeys.forEach(function(id) {
      if (!now[id]) result.gone.add(id);
    });
    return result;
  }
  function formatSnapshotAge(snap) {
    if (!snap || !snap.ts) return "";
    const sec = Math.max(0, Math.floor(Date.now() / 1e3) - snap.ts);
    const m = Math.floor(sec / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return d + "d " + h % 24 + "h";
    if (h > 0) return h + "h " + m % 60 + "m";
    if (m > 0) return m + "min";
    return sec + "s";
  }

  // assets/js/modules/tabs.js
  var _getActiveTab = function() {
    return "tech";
  };
  var _onMgmtRerender = null;
  function setActiveTabGetter(fn) {
    _getActiveTab = fn;
  }
  function setMgmtRerenderCallback(fn) {
    _onMgmtRerender = fn;
  }
  function applyDarkMode(forceState) {
    const root = document.getElementById("nt-root");
    if (!root) return;
    const nowDark = forceState !== void 0 ? !!forceState : !root.classList.contains("nt-dark");
    root.classList.toggle("nt-dark", nowDark);
    const btn = document.getElementById("nt-btn-dark");
    if (btn) btn.textContent = nowDark ? "Light" : "Dark";
    const activeTab = _getActiveTab();
    if (activeTab === "tech" && window._ntCy) {
      try {
        window._ntCy.nodes("[!isGroup]").style({
          "color": nowDark ? "#e2e8f0" : "#334155",
          "text-background-color": nowDark ? "#1e293b" : "#f8fafc"
        });
        window._ntCy.edges().style("line-color", nowDark ? "#334155" : "#cbd5e1");
        window._ntCy.nodes("[?isGroup]").forEach(function(n) {
          n.style("color", nowDark ? "#e2e8f0" : grpColor(n.data("label")));
        });
      } catch (e) {
      }
    }
    if (activeTab === "mgmt" && _onMgmtRerender) {
      _onMgmtRerender();
    }
  }
  function ensureBaseToolbar(wrap) {
    const bar = document.querySelector(".nt-topbar__actions");
    if (!bar) return;
    const activeTab = _getActiveTab();
    const isAdmin = !!(window.NT_CONFIG && window.NT_CONFIG.can_edit);
    const TABS = [
      { id: "nt-tab-tech", lbl: t("tabs.tech"), tab: "tech" },
      { id: "nt-tab-mgmt", lbl: t("tabs.mgmt"), tab: "mgmt" },
      { id: "nt-tab-tree", lbl: t("tabs.table"), tab: "tree" },
      { id: "nt-tab-geo", lbl: t("tabs.geo"), tab: "geo" },
      { id: "nt-tab-health", lbl: t("tabs.health"), tab: "health" },
      { id: "nt-tab-stats", lbl: t("tabs.stats"), tab: "stats" },
      { id: "nt-tab-lldpq", lbl: t("tabs.lldpq"), tab: "lldpq", dataOptional: true }
    ];
    if (isAdmin) TABS.push({ id: "nt-tab-compliance", lbl: t("tabs.compliance"), tab: "compliance", dataOptional: true });
    const isSuperAdmin = !!(window.NT_CONFIG && window.NT_CONFIG.is_super_admin);
    if (isSuperAdmin) TABS.push({ id: "nt-tab-diag", lbl: t("tabs.diag"), tab: "diag", dataOptional: true });
    if (!document.getElementById("nt-tab-wrap")) {
      const tw = document.createElement("div");
      tw.id = "nt-tab-wrap";
      tw.style.cssText = "display:flex;gap:2px;margin-right:8px;padding-right:8px;border-right:1px solid #e2e8f0;flex-shrink:0";
      TABS.forEach(function(item) {
        const b = document.createElement("button");
        b.id = item.id;
        b.textContent = item.lbl;
        b.className = "btn-alt btn-small";
        b.style.margin = "0";
        b.addEventListener("click", function() {
          const d = window._ntLastData || {};
          if (!item.dataOptional && (!d.nodes || !d.nodes.length)) return;
          if (window.switchTab) window.switchTab(item.tab, wrap, d.nodes || [], d.edges || [], d.url || "");
        });
        tw.appendChild(b);
      });
      bar.insertBefore(tw, bar.firstChild);
    }
    if (isSuperAdmin && !document.getElementById("nt-tab-diag")) {
      const tw = document.getElementById("nt-tab-wrap");
      const b = document.createElement("button");
      b.id = "nt-tab-diag";
      b.textContent = t("tabs.diag");
      b.className = "btn-alt btn-small";
      b.style.margin = "0";
      b.addEventListener("click", function() {
        const d = window._ntLastData || {};
        if (window.switchTab) window.switchTab("diag", wrap, d.nodes || [], d.edges || [], d.url || "");
      });
      if (tw) tw.appendChild(b);
    }
    TABS.forEach(function(item) {
      const b = document.getElementById(item.id);
      if (b) {
        b.style.background = activeTab === item.tab ? "#3b82f6" : "";
        b.style.color = activeTab === item.tab ? "#fff" : "";
      }
    });
    if (!document.getElementById("nt-btn-dark")) {
      const bDark = document.createElement("button");
      bDark.id = "nt-btn-dark";
      bDark.className = "btn-alt btn-small";
      bDark.style.marginLeft = "4px";
      const isDark = !!(document.getElementById("nt-root") && document.getElementById("nt-root").classList.contains("nt-dark"));
      bDark.textContent = isDark ? "Light" : "Dark";
      bDark.addEventListener("click", function() {
        applyDarkMode();
      });
      bar.appendChild(bDark);
    }
    if (!document.getElementById("nt-btn-snap")) {
      const bSnap = document.createElement("button");
      bSnap.id = "nt-btn-snap";
      bSnap.className = "btn-alt btn-small";
      bSnap.style.marginLeft = "4px";
      bSnap.addEventListener("click", function() {
        const d = window._ntLastData || {};
        if (!d.nodes || !d.nodes.length) return;
        saveSnapshot(d.nodes);
        ensureBaseToolbar(wrap);
        if (window.switchTab) window.switchTab(_getActiveTab(), wrap, d.nodes, d.edges || [], d.url || "");
      });
      bar.appendChild(bSnap);
      const bClear = document.createElement("button");
      bClear.id = "nt-btn-snap-clear";
      bClear.className = "btn-alt btn-small";
      bClear.style.marginLeft = "2px";
      bClear.textContent = "\u2715";
      bClear.title = t("toolbar.snapshot.del");
      bClear.addEventListener("click", function() {
        clearSnapshot();
        ensureBaseToolbar(wrap);
        const d = window._ntLastData || {};
        if (window.switchTab && d.nodes) window.switchTab(_getActiveTab(), wrap, d.nodes, d.edges || [], d.url || "");
      });
      bar.appendChild(bClear);
    }
    const snap = loadSnapshot();
    const bSnapEl = document.getElementById("nt-btn-snap");
    const bClearEl = document.getElementById("nt-btn-snap-clear");
    if (bSnapEl) {
      bSnapEl.textContent = snap ? t("toolbar.snapshot.diff", { age: formatSnapshotAge(snap) }) : t("toolbar.snapshot");
      bSnapEl.title = snap ? t("toolbar.snapshot.new") : t("toolbar.snapshot.set");
    }
    if (bClearEl) bClearEl.style.display = snap ? "" : "none";
    regroupToolbar();
  }
  var _GRAPH_ONLY_SELECTORS = [
    "#nt-btn-labels",
    // Hide Labels
    ".nt-zoom-btns",
    // +/-/100% Wrapper
    "#nt-btn-reset",
    // Fit
    "#nt-layout-wrap",
    // Layout-Dropdown
    "#nt-btn-groupview",
    // Gruppieren
    "#nt-cluster-wrap",
    // Cluster-Mode-Toggle
    "#nt-btn-lldp",
    // LLDP an/aus
    "#nt-btn-weathermap",
    // Weathermap-Modus (Auslastungs-%)
    "#nt-btn-portlabels",
    // Port-Labels an Edge-Enden
    "#nt-btn-rootcause",
    // Root-Cause-Analyse
    "#nt-btn-link",
    // Link-Mode
    "#nt-btn-unlink",
    // Links entfernen
    "#nt-preset-wrap",
    // Presets + Save/Erase/Trash
    "#nt-sev-filter",
    // Severity-Pills (Tabelle hat eigene)
    "#nt-search-input",
    // Host-Suche (Tabelle hat eigene)
    "#nt-taphold-wrap"
    // Touch-Long-Press-Picker
  ];
  function _ensureGraphHideStyle() {
    if (document.getElementById("nt-graph-hide-style")) return;
    const st = document.createElement("style");
    st.id = "nt-graph-hide-style";
    st.textContent = "body.nt-graph-hidden " + _GRAPH_ONLY_SELECTORS.join(",body.nt-graph-hidden ") + " { display: none !important; }";
    document.head.appendChild(st);
  }
  function setGraphToolbarVisible(visible) {
    _ensureGraphHideStyle();
    document.body.classList.toggle("nt-graph-hidden", !visible);
  }
  function _closeAllMenuPops() {
    document.querySelectorAll("[data-nt-menu-pop]").forEach(function(p) {
      p.style.display = "none";
    });
  }
  function _ensureMenuOutsideHandler() {
    if (window._ntMenuHandlerDone) return;
    window._ntMenuHandlerDone = true;
    document.addEventListener("click", function(e) {
      const t2 = e.target;
      if (t2 && t2.closest && t2.closest("[data-nt-menu-pop],[data-nt-menu-trigger]")) return;
      _closeAllMenuPops();
    });
  }
  function _ensureMenuStyle() {
    if (document.getElementById("nt-menu-style")) return;
    const st = document.createElement("style");
    st.id = "nt-menu-style";
    st.textContent = "[data-nt-menu-pop] > button,[data-nt-menu-pop] > div {  display: block !important;  width: 100% !important;  text-align: left !important;  margin: 0 0 1px 0 !important;  padding: 6px 10px !important;  border: 1px solid transparent !important;  border-radius: 4px !important;  background: transparent !important;  color: #334155 !important;  font-size: 12px !important;  font-weight: 500 !important;  cursor: pointer !important;  box-shadow: none !important;  white-space: nowrap !important;  position: static !important;}[data-nt-menu-pop] > button:hover,[data-nt-menu-pop] > div:hover {  background: #f1f5f9 !important;}[data-nt-menu-pop] > div > button:first-child {  display: block !important;  width: 100% !important;  text-align: left !important;  margin: 0 !important;  padding: 0 !important;  border: none !important;  background: transparent !important;  color: inherit !important;  box-shadow: none !important;  font-size: 12px !important;  font-weight: 500 !important;}[data-nt-menu-pop] > div > div {  position: static !important;  background: #f8fafc !important;  border: 1px solid #e2e8f0 !important;  border-radius: 4px !important;  margin-top: 4px !important;  padding: 2px !important;  box-shadow: none !important;}[data-nt-menu-pop] > div > div > button {  display: block !important;  width: 100% !important;  text-align: left !important;  margin: 0 !important;  padding: 4px 8px !important;  border: none !important;  background: transparent !important;  font-size: 11px !important;  border-radius: 3px !important;  cursor: pointer !important;}[data-nt-menu-pop] > div > div > button:hover {  background: #e2e8f0 !important;}#nt-root.nt-dark [data-nt-menu-pop] {  background: #1e293b !important;  border-color: #334155 !important;}#nt-root.nt-dark [data-nt-menu-pop] > button,#nt-root.nt-dark [data-nt-menu-pop] > div {  color: #e2e8f0 !important;}#nt-root.nt-dark [data-nt-menu-pop] > button:hover,#nt-root.nt-dark [data-nt-menu-pop] > div:hover {  background: #334155 !important;}";
    document.head.appendChild(st);
  }
  function _mkMenuShell(id, label) {
    let wrap = document.getElementById(id + "-wrap");
    if (wrap) return wrap;
    wrap = document.createElement("div");
    wrap.id = id + "-wrap";
    wrap.style.cssText = "position:relative;display:inline-block;margin-left:4px";
    const btn = document.createElement("button");
    btn.id = id;
    btn.className = "btn-alt btn-small";
    btn.style.margin = "0";
    btn.textContent = label + " \u25BE";
    btn.dataset.ntMenuTrigger = "1";
    wrap.appendChild(btn);
    const pop = document.createElement("div");
    pop.id = id + "-pop";
    pop.dataset.ntMenuPop = "1";
    pop.style.cssText = "display:none;position:absolute;top:100%;right:0;background:#fff;border:1px solid #cbd5e1;border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,0.14);padding:6px;min-width:170px;z-index:9000;margin-top:4px";
    wrap.appendChild(pop);
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      const wasOpen = pop.style.display !== "none" && pop.style.display !== "";
      _closeAllMenuPops();
      if (!wasOpen) pop.style.display = "block";
    });
    return wrap;
  }
  function _moveIntoMenu(srcId, menuId) {
    const el = document.getElementById(srcId);
    const pop = document.getElementById(menuId + "-pop");
    if (!el || !pop) return;
    if (el.parentNode === pop) return;
    el.style.removeProperty("margin");
    el.style.removeProperty("margin-left");
    el.style.removeProperty("margin-right");
    el.style.removeProperty("margin-top");
    el.style.removeProperty("margin-bottom");
    el.style.removeProperty("display");
    el.style.removeProperty("position");
    pop.appendChild(el);
  }
  function regroupToolbar() {
    _ensureMenuOutsideHandler();
    _ensureMenuStyle();
    const bar = document.querySelector(".nt-topbar__actions");
    if (!bar) return;
    const mView = _mkMenuShell("nt-menu-view", t("toolbar.menu.view"));
    const mLayout = _mkMenuShell("nt-menu-layout", t("toolbar.menu.layout"));
    const mTools = _mkMenuShell("nt-menu-tools", t("toolbar.menu.tools"));
    if (!mView.parentNode) bar.appendChild(mView);
    if (!mLayout.parentNode) bar.appendChild(mLayout);
    if (!mTools.parentNode) bar.appendChild(mTools);
    _moveIntoMenu("nt-btn-dark", "nt-menu-view");
    _moveIntoMenu("nt-btn-fullscreen", "nt-menu-view");
    _moveIntoMenu("nt-btn-labels", "nt-menu-view");
    _moveIntoMenu("nt-btn-reset", "nt-menu-view");
    _moveIntoMenu("nt-btn-weathermap", "nt-menu-view");
    _moveIntoMenu("nt-btn-portlabels", "nt-menu-view");
    _moveIntoMenu("nt-layout-wrap", "nt-menu-layout");
    _moveIntoMenu("nt-btn-groupview", "nt-menu-layout");
    _moveIntoMenu("nt-cluster-wrap", "nt-menu-layout");
    _moveIntoMenu("nt-btn-snap", "nt-menu-tools");
    _moveIntoMenu("nt-btn-snap-clear", "nt-menu-tools");
    _moveIntoMenu("nt-btn-link", "nt-menu-tools");
    _moveIntoMenu("nt-btn-unlink", "nt-menu-tools");
    _moveIntoMenu("nt-btn-history", "nt-menu-tools");
    _moveIntoMenu("nt-btn-rootcause", "nt-menu-tools");
    _moveIntoMenu("nt-preset-wrap", "nt-menu-tools");
    const layoutWrap = document.getElementById("nt-menu-layout-wrap");
    if (layoutWrap && _GRAPH_ONLY_SELECTORS.indexOf("#nt-menu-layout-wrap") < 0) {
      _GRAPH_ONLY_SELECTORS.push("#nt-menu-layout-wrap");
      const oldStyle = document.getElementById("nt-graph-hide-style");
      if (oldStyle) oldStyle.remove();
      _ensureGraphHideStyle();
      if (document.body.classList.contains("nt-graph-hidden")) {
        document.body.classList.remove("nt-graph-hidden");
        document.body.classList.add("nt-graph-hidden");
      }
    }
  }

  // assets/js/modules/items-pivot.js
  var PRESETS = [
    // Filesystem
    {
      id: "disks",
      lbl: t("items.preset.disks.lbl"),
      pattern: "vfs.fs.size[*,pused]",
      unit: "%",
      desc: t("items.preset.disks.desc")
    },
    {
      id: "disks_used",
      lbl: t("items.preset.disks_used.lbl"),
      pattern: "vfs.fs.size[*,used]",
      unit: "B",
      desc: t("items.preset.disks_used.desc")
    },
    // Block-Device IO (Standard Linux-Template, Zabbix 7.x)
    {
      id: "dev_util",
      lbl: t("items.preset.dev_util.lbl"),
      pattern: "vfs.dev.util[*]",
      unit: "%",
      desc: t("items.preset.dev_util.desc")
    },
    {
      id: "dev_rrate",
      lbl: t("items.preset.dev_rrate.lbl"),
      pattern: "vfs.dev.read.rate[*]",
      unit: "",
      desc: t("items.preset.dev_rrate.desc")
    },
    {
      id: "dev_wrate",
      lbl: t("items.preset.dev_wrate.lbl"),
      pattern: "vfs.dev.write.rate[*]",
      unit: "",
      desc: t("items.preset.dev_wrate.desc")
    },
    {
      id: "dev_queue",
      lbl: t("items.preset.dev_queue.lbl"),
      pattern: "vfs.dev.queue_size[*]",
      unit: "",
      desc: t("items.preset.dev_queue.desc")
    },
    {
      id: "dev_rawait",
      lbl: t("items.preset.dev_rawait.lbl"),
      pattern: "vfs.dev.read.await[*]",
      unit: "ms",
      desc: t("items.preset.dev_rawait.desc")
    },
    {
      id: "dev_wawait",
      lbl: t("items.preset.dev_wawait.lbl"),
      pattern: "vfs.dev.write.await[*]",
      unit: "ms",
      desc: t("items.preset.dev_wawait.desc")
    },
    // System
    {
      id: "mem",
      lbl: t("items.preset.mem.lbl"),
      pattern: "vm.memory.size[*]",
      unit: "B",
      desc: t("items.preset.mem.desc")
    },
    {
      id: "cpu",
      lbl: t("items.preset.cpu.lbl"),
      pattern: "system.cpu.util*",
      unit: "%",
      desc: t("items.preset.cpu.desc")
    },
    // Network
    {
      id: "netin",
      lbl: t("items.preset.netin.lbl"),
      pattern: "net.if.in[*]",
      unit: "bps",
      desc: t("items.preset.netin.desc")
    },
    {
      id: "netout",
      lbl: t("items.preset.netout.lbl"),
      pattern: "net.if.out[*]",
      unit: "bps",
      desc: t("items.preset.netout.desc")
    },
    // Connectivity
    {
      id: "ping",
      lbl: t("items.preset.ping.lbl"),
      pattern: "icmpping*",
      unit: "",
      desc: t("items.preset.ping.desc")
    }
  ];
  var _data = null;
  var _sparkPivotCache = /* @__PURE__ */ new Map();
  var _SPARK_TTL_MS = 6e4;
  function _fetchAndRenderSparklines(container, baseUrl, theme) {
    if (!container) return;
    const sparkSlots = /* @__PURE__ */ new Map();
    const trendSlots = /* @__PURE__ */ new Map();
    container.querySelectorAll(".nt-pivot-spark[data-itemid]").forEach(function(el) {
      const iid = el.dataset.itemid;
      if (!iid) return;
      if (!sparkSlots.has(iid)) sparkSlots.set(iid, []);
      sparkSlots.get(iid).push(el);
    });
    if (!sparkSlots.size) return;
    container.querySelectorAll(".nt-pivot-trend[data-itemid]").forEach(function(el) {
      const iid = el.dataset.itemid;
      if (!iid) return;
      if (!trendSlots.has(iid)) trendSlots.set(iid, []);
      trendSlots.get(iid).push(el);
    });
    const wanted = [];
    const now = Date.now();
    sparkSlots.forEach(function(_els, iid) {
      const cached = _sparkPivotCache.get(iid);
      if (cached && now - cached.ts < _SPARK_TTL_MS) {
        _renderSparklineIntoSlots(sparkSlots, trendSlots, iid, cached.data, theme);
      } else {
        wanted.push(iid);
      }
    });
    if (!wanted.length) return;
    const chunks = [];
    for (let i = 0; i < wanted.length; i += 500) chunks.push(wanted.slice(i, i + 500));
    chunks.forEach(function(chunk) {
      const params = new URLSearchParams();
      params.append("action", "network.topology.v6.item_history");
      chunk.forEach(function(iid) {
        params.append("itemids[]", iid);
      });
      const url = baseUrl + "zabbix.php?" + params.toString();
      fetch(url, {
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" }
      }).then(function(r) {
        return r.json();
      }).then(function(byIid) {
        if (!byIid || byIid.error) return;
        Object.keys(byIid).forEach(function(iid) {
          const arr = byIid[iid] || [];
          _sparkPivotCache.set(iid, { data: arr, ts: Date.now() });
          _renderSparklineIntoSlots(sparkSlots, trendSlots, iid, arr, theme);
        });
      }).catch(function() {
      });
    });
  }
  function _renderSparklineIntoSlots(sparkSlots, trendSlots, itemid, values, theme) {
    const els = sparkSlots.get(itemid);
    if (!els || !els.length) return;
    const svg = _buildSparklineSvg(values, theme);
    els.forEach(function(el) {
      el.innerHTML = svg;
    });
    const trend = _buildTrendArrow(values);
    if (trend) {
      (trendSlots.get(itemid) || []).forEach(function(el) {
        el.innerHTML = trend;
      });
    }
  }
  function _buildTrendArrow(values) {
    if (!values || values.length < 3) return "";
    function median3(arr) {
      if (arr.length === 0) return null;
      const s = arr.slice().sort(function(a, b) {
        return a - b;
      });
      return s[Math.floor(s.length / 2)];
    }
    const head = values.slice(0, Math.min(3, values.length));
    const tail = values.slice(-Math.min(3, values.length));
    const first = median3(head);
    const last = median3(tail);
    if (first == null || last == null || !isFinite(first) || !isFinite(last)) return "";
    const base = Math.abs(first) || 1;
    const rel = (last - first) / base;
    const THRESHOLD = 0.05;
    let sym = "\u2192", col = "#94a3b8";
    if (rel > THRESHOLD) {
      sym = "\u2191";
      col = "#dc2626";
    } else if (rel < -THRESHOLD) {
      sym = "\u2193";
      col = "#16a34a";
    }
    const pct = Math.round(Math.abs(rel) * 100);
    const title = t("items.trend_1h", { sign: rel >= 0 ? "+" : "\u2212", pct });
    return '<span title="' + title + '" style="color:' + col + ';font-weight:700;font-size:11px;margin-right:2px">' + sym + "</span>";
  }
  function _buildSparklineSvg(values, theme) {
    if (!values || values.length < 2) return "";
    const W = 56, H = 14, PAD2 = 1;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < values.length; i++) {
      if (!isFinite(values[i])) continue;
      if (values[i] < mn) mn = values[i];
      if (values[i] > mx) mx = values[i];
    }
    if (!isFinite(mn) || !isFinite(mx)) return "";
    const range = mx - mn || 1;
    const step = (W - PAD2 * 2) / Math.max(1, values.length - 1);
    const pts = values.map(function(v, i) {
      const x = PAD2 + i * step;
      const y = PAD2 + (H - PAD2 * 2) * (1 - (v - mn) / range);
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    const col = function() {
      const n = values.length;
      if (n < 3) return theme && theme.link ? theme.link : "#3b82f6";
      const a = values[n - 3], b = values[n - 1];
      if (b > a * 1.05) return "#dc2626";
      if (b < a * 0.95) return "#16a34a";
      return theme && theme.link ? theme.link : "#3b82f6";
    }();
    return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><polyline points="' + pts + '" fill="none" stroke="' + col + '" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function fmtVal(v, unit) {
    if (v === null || v === void 0 || isNaN(v)) return "\u2014";
    if (unit === "%") return v.toFixed(1) + " %";
    if (unit === "B") {
      if (v < 1024) return v + " B";
      if (v < 1048576) return (v / 1024).toFixed(1) + " KB";
      if (v < 1073741824) return (v / 1048576).toFixed(1) + " MB";
      if (v < 1099511627776) return (v / 1073741824).toFixed(2) + " GB";
      return (v / 1099511627776).toFixed(2) + " TB";
    }
    if (unit === "bps") {
      if (v < 1e3) return Math.round(v) + " bps";
      if (v < 1e6) return (v / 1e3).toFixed(1) + " Kbps";
      if (v < 1e9) return (v / 1e6).toFixed(1) + " Mbps";
      return (v / 1e9).toFixed(2) + " Gbps";
    }
    if (unit === "ms") return v.toFixed(2) + " ms";
    if (v === Math.floor(v)) return String(v);
    return v.toFixed(2);
  }
  async function fetchItemsPivot(pattern) {
    const cfg = window.NT_CONFIG;
    const groupids = cfg && cfg.selected_groupids || [];
    if (!groupids.length || !pattern) return null;
    const params = new URLSearchParams();
    params.append("action", "network.topology.v6.items");
    params.append("pattern", pattern);
    groupids.forEach(function(g) {
      params.append("groupids[]", String(g));
    });
    const url = buildBaseUrl() + "zabbix.php?" + params.toString();
    try {
      const resp = await fetch(url, {
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" }
      });
      const data = await resp.json();
      if (data.error) {
        console.warn("Items fetch error:", data.error);
        return { error: data.error };
      }
      _data = data;
      return data;
    } catch (e) {
      console.error("Items fetch failed:", e);
      return { error: e.message };
    }
  }
  var _discoverCache = /* @__PURE__ */ new Map();
  function fetchPatternSuggestions() {
    const cfg = window.NT_CONFIG;
    const groupids = cfg && cfg.selected_groupids || [];
    if (!groupids.length) return Promise.resolve({ patterns: [] });
    const cacheKey = groupids.slice().sort().join(",");
    if (_discoverCache.has(cacheKey)) return _discoverCache.get(cacheKey);
    const params = new URLSearchParams();
    params.append("action", "network.topology.v6.discover_patterns");
    groupids.forEach(function(g) {
      params.append("groupids[]", String(g));
    });
    const url = buildBaseUrl() + "zabbix.php?" + params.toString();
    const promise = fetch(url, {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    }).then(function(r) {
      return r.json();
    }).then(function(data) {
      if (data.error) {
        _discoverCache.delete(cacheKey);
        return { error: data.error, patterns: [] };
      }
      return {
        patterns: data.patterns || [],
        truncated: !!data.truncated,
        cached: !!data.cached
        // Backend setzt true bei APCu-Hit
      };
    }).catch(function(e) {
      _discoverCache.delete(cacheKey);
      return { error: e.message, patterns: [] };
    });
    _discoverCache.set(cacheKey, promise);
    return promise;
  }
  var FALLBACK_THEME = {
    head: "#f8fafc",
    surface: "#ffffff",
    inputBg: "#ffffff",
    border: "#e2e8f0",
    borderSoft: "#f1f5f9",
    text: "#1e293b",
    textStrong: "#0f172a",
    sub: "#64748b",
    subSoft: "#94a3b8",
    accent: "#2563eb",
    link: "#2563eb",
    hover: "#f1f5f9"
    // renderList nutzt t.hover — fehlte (→ "undefined" im Style)
  };
  function buildPivotToolbar(onApply, theme) {
    const t2 = theme || FALLBACK_THEME;
    const wrap = document.createElement("div");
    wrap.id = "nt-items-toolbar";
    wrap.style.cssText = "display:flex;align-items:center;gap:10px;padding:0;flex-wrap:wrap";
    const lbl = document.createElement("span");
    lbl.textContent = t("items.preset_label");
    lbl.style.cssText = "font-size:11px;color:" + t2.sub + ";font-weight:700;text-transform:uppercase;letter-spacing:0.06em";
    wrap.appendChild(lbl);
    const combo = document.createElement("div");
    combo.id = "nt-items-preset";
    combo.style.cssText = "position:relative;display:inline-block";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.style.cssText = "padding:3px 24px 3px 8px;border:1px solid " + t2.border + ";border-radius:2px;font-size:12px;background:" + t2.surface + ";color:" + t2.text + ";font-family:inherit;cursor:pointer;min-width:200px;text-align:left;position:relative";
    trigger.appendChild(document.createTextNode(PRESETS[0].lbl));
    const caret = document.createElement("span");
    caret.textContent = "\u25BE";
    caret.style.cssText = "position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:9px;opacity:0.6;pointer-events:none";
    trigger.appendChild(caret);
    combo.appendChild(trigger);
    const popup = document.createElement("div");
    popup.style.cssText = "display:none;position:absolute;top:100%;left:0;z-index:1000;margin-top:2px;min-width:280px;max-width:480px;background:" + t2.surface + ";border:1px solid " + t2.border + ";border-radius:2px;box-shadow:0 2px 8px rgba(0,0,0,0.10);overflow:hidden";
    const filterIn = document.createElement("input");
    filterIn.type = "text";
    filterIn.placeholder = t("items.search_ph");
    filterIn.style.cssText = "width:100%;box-sizing:border-box;padding:5px 10px;border:none;border-bottom:1px solid " + t2.borderSoft + ";outline:none;font-size:12px;background:" + t2.head + ";color:" + t2.text + ";font-family:inherit";
    popup.appendChild(filterIn);
    const listBox = document.createElement("div");
    listBox.style.cssText = "max-height:340px;overflow-y:auto;padding:2px 0";
    popup.appendChild(listBox);
    combo.appendChild(popup);
    wrap.appendChild(combo);
    const _disc = { loading: true, patterns: [], error: null, truncated: false };
    let _items = [];
    function patternMatchesAnyStem(pattern, stems) {
      if (!stems || stems.length === 0) return false;
      const re = new RegExp("^" + pattern.split("*").map(function(p) {
        return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }).join(".*") + "$");
      return stems.some(function(s) {
        return re.test(s);
      });
    }
    function rebuildItemsList() {
      _items = [];
      const stems = (_disc.patterns || []).map(function(p) {
        return p.stem;
      });
      const showAllPresets = _disc.loading || _disc.error || stems.length === 0;
      const visiblePresets = showAllPresets ? PRESETS : PRESETS.filter(function(p) {
        return patternMatchesAnyStem(p.pattern, stems);
      });
      _items.push({ type: "header", label: t("items.header.presets") });
      visiblePresets.forEach(function(p) {
        _items.push({
          type: "item",
          label: p.lbl,
          value: p.pattern,
          desc: p.desc || ""
        });
      });
      _items.push({
        type: "item",
        label: t("items.custom_pattern"),
        value: "__custom__"
      });
      _items.push({ type: "header", label: t("items.header.discovered") });
      if (_disc.loading) {
        _items.push({
          type: "item",
          label: t("items.loading_patterns"),
          value: null,
          disabled: true
        });
      } else if (_disc.error) {
        _items.push({
          type: "item",
          label: t("items.error", { msg: _disc.error }),
          value: null,
          disabled: true
        });
      } else if (_disc.patterns.length === 0) {
        _items.push({
          type: "item",
          label: t("items.no_patterns"),
          value: null,
          disabled: true
        });
      } else {
        _disc.patterns.forEach(function(p) {
          _items.push({
            type: "item",
            label: p.stem,
            value: p.stem,
            sub: "(" + p.items + "x, " + p.hosts + "h)"
          });
        });
        if (_disc.truncated) {
          _items.push({
            type: "item",
            label: t("items.scan_truncated"),
            value: null,
            disabled: true
          });
        }
      }
      renderList(filterIn.value);
    }
    function renderList(q) {
      listBox.innerHTML = "";
      const ql = (q || "").toLowerCase();
      let pendingHeader = null;
      _items.forEach(function(it) {
        if (it.type === "header") {
          pendingHeader = it;
          return;
        }
        const hay = (it.label + " " + (it.sub || "")).toLowerCase();
        if (ql && hay.indexOf(ql) < 0) return;
        if (pendingHeader) {
          const h = document.createElement("div");
          h.textContent = pendingHeader.label;
          h.style.cssText = "padding:4px 10px;font-size:10px;font-weight:700;color:" + t2.sub + ";text-transform:uppercase;letter-spacing:0.04em;background:" + t2.head;
          listBox.appendChild(h);
          pendingHeader = null;
        }
        const row = document.createElement("div");
        row.style.cssText = "padding:5px 10px;cursor:" + (it.disabled ? "default" : "pointer") + ";font-size:12px;color:" + (it.disabled ? t2.subSoft : t2.text) + ";display:flex;flex-direction:column;gap:2px" + (it.disabled ? ";font-style:italic" : "");
        const topRow = document.createElement("div");
        topRow.style.cssText = "display:flex;align-items:baseline;gap:8px";
        const lab = document.createElement("span");
        lab.textContent = it.label;
        lab.style.flex = "1";
        topRow.appendChild(lab);
        if (it.sub) {
          const sub = document.createElement("span");
          sub.textContent = it.sub;
          sub.style.cssText = "color:" + t2.subSoft + ";font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
          topRow.appendChild(sub);
        }
        row.appendChild(topRow);
        if (it.desc && !it.disabled) {
          const dl = document.createElement("div");
          dl.textContent = it.desc;
          dl.style.cssText = "font-size:10px;color:" + t2.subSoft + ";line-height:1.3;padding-left:0";
          row.appendChild(dl);
        }
        if (!it.disabled) {
          row.addEventListener("mouseenter", function() {
            this.style.background = t2.hover;
          });
          row.addEventListener("mouseleave", function() {
            this.style.background = "";
          });
          row.addEventListener("click", function() {
            if (it.value === "__custom__") {
              trigger.firstChild.nodeValue = t("items.custom_pattern");
              pat.value = "";
              closePopup();
              pat.focus();
            } else {
              trigger.firstChild.nodeValue = it.label;
              pat.value = it.value;
              closePopup();
            }
          });
        }
        listBox.appendChild(row);
      });
      if (listBox.children.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = t("items.no_matches");
        empty.style.cssText = "padding:14px;text-align:center;color:" + t2.subSoft + ";font-size:12px;font-style:italic";
        listBox.appendChild(empty);
      }
    }
    function openPopup() {
      popup.style.display = "block";
      filterIn.value = "";
      renderList("");
      setTimeout(function() {
        filterIn.focus();
      }, 0);
    }
    function closePopup() {
      popup.style.display = "none";
    }
    trigger.addEventListener("click", function(e) {
      e.stopPropagation();
      if (popup.style.display === "block") closePopup();
      else openPopup();
    });
    filterIn.addEventListener("input", function() {
      renderList(this.value);
    });
    filterIn.addEventListener("keydown", function(e) {
      if (e.key === "Escape") {
        closePopup();
        trigger.focus();
      }
    });
    document.addEventListener("click", function _outside(e) {
      if (!document.contains(combo)) {
        document.removeEventListener("click", _outside);
        return;
      }
      if (!combo.contains(e.target)) closePopup();
    });
    rebuildItemsList();
    fetchPatternSuggestions().then(function(res) {
      _disc.loading = false;
      if (res && res.error) _disc.error = res.error;
      _disc.patterns = res && res.patterns || [];
      _disc.truncated = !!(res && res.truncated);
      rebuildItemsList();
    });
    const patWrap = document.createElement("span");
    patWrap.style.cssText = "display:flex;align-items:center;gap:8px;flex:1;min-width:200px";
    const patLbl = document.createElement("span");
    patLbl.textContent = "Pattern";
    patLbl.style.cssText = "font-size:11px;color:" + t2.sub + ";font-weight:700;text-transform:uppercase;letter-spacing:0.06em";
    patWrap.appendChild(patLbl);
    const pat = document.createElement("input");
    pat.type = "text";
    pat.id = "nt-items-pattern";
    pat.placeholder = "z.B. vfs.fs.size[*,pused]";
    pat.value = PRESETS[0].pattern;
    pat.style.cssText = "flex:1;padding:3px 8px;border:1px solid " + t2.border + ";border-radius:2px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:" + t2.inputBg + ";color:" + t2.text + ";outline:none;transition:border-color 0.12s";
    pat.addEventListener("focus", function() {
      this.style.borderColor = t2.accent;
    });
    pat.addEventListener("blur", function() {
      this.style.borderColor = t2.border;
    });
    patWrap.appendChild(pat);
    wrap.appendChild(patWrap);
    const apply = document.createElement("button");
    apply.textContent = "Anwenden";
    apply.style.cssText = "padding:3px 12px;border:1px solid " + t2.accent + ";border-radius:2px;background:" + t2.accent + ";color:#ffffff;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;transition:filter 0.12s";
    wrap.appendChild(apply);
    pat.addEventListener("input", function() {
      const v = pat.value;
      const matchPreset = PRESETS.find(function(p) {
        return p.pattern === v;
      });
      if (matchPreset) {
        trigger.firstChild.nodeValue = matchPreset.lbl;
      } else {
        const matchDisc = (_disc.patterns || []).find(function(p) {
          return p.stem === v;
        });
        trigger.firstChild.nodeValue = matchDisc ? matchDisc.stem : "\u2014 Custom-Pattern \u2014";
      }
      _scheduleCountProbe(v);
    });
    apply.addEventListener("click", function() {
      if (onApply) onApply(pat.value);
    });
    pat.addEventListener("keydown", function(e) {
      if (e.key === "Enter" && onApply) onApply(pat.value);
    });
    const countHint = document.createElement("div");
    countHint.id = "nt-items-count-hint";
    countHint.style.cssText = "flex-basis:100%;font-size:11px;color:" + t2.subSoft + ";padding:2px 0 0 0;min-height:14px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
    wrap.appendChild(countHint);
    let _probeTimer = null;
    let _probeSeq = 0;
    function _scheduleCountProbe(pattern) {
      if (_probeTimer) clearTimeout(_probeTimer);
      const p = (pattern || "").trim();
      if (!p || p.replace(/\*/g, "").length < 2) {
        countHint.textContent = "";
        return;
      }
      countHint.textContent = "\u2026";
      _probeTimer = setTimeout(function() {
        const cfg = window.NT_CONFIG || {};
        const groupids = cfg.selected_groupids || [];
        if (!groupids.length) {
          countHint.textContent = "";
          return;
        }
        const params = new URLSearchParams();
        params.append("action", "network.topology.v6.item_count");
        params.append("pattern", p);
        groupids.forEach(function(g) {
          params.append("groupids[]", String(g));
        });
        const seq = ++_probeSeq;
        fetch(buildBaseUrl() + "zabbix.php?" + params.toString(), {
          credentials: "same-origin",
          headers: { "X-Requested-With": "XMLHttpRequest" }
        }).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (seq !== _probeSeq) return;
          countHint.style.color = t2.subSoft;
          if (!d || d.error) {
            countHint.textContent = "";
            return;
          }
          if (d.hint) {
            countHint.textContent = d.hint;
            return;
          }
          if (d.count === 0) {
            countHint.textContent = "0 Items matchen \u2014 Pattern pruefen";
            countHint.style.color = "#f59e0b";
            return;
          }
          const sample = (d.sample || []).slice(0, 3).join("  \xB7  ");
          countHint.textContent = d.count + " Items matchen" + (sample ? "   z.B. " + sample : "");
        }).catch(function() {
          if (seq === _probeSeq) countHint.textContent = "";
        });
      }, 400);
    }
    return wrap;
  }
  function renderPivotTable(container, data, hostsLookup, sortHostIds, sortCol, sortDir, theme, options) {
    const t2 = theme || FALLBACK_THEME;
    const monoFam = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
    const opt = options || {};
    const hideEmpty = !!opt.hideEmpty;
    const heatmap = !!opt.heatmap;
    container.innerHTML = "";
    if (!data || data.error) {
      container.innerHTML = '<div style="padding:30px;text-align:center;color:' + t2.subSoft + '">Fehler beim Laden: ' + esc(data && data.error || "unbekannt") + "</div>";
      return;
    }
    if (!data.columns || data.columns.length === 0) {
      const reasons = '<ul style="text-align:left;display:inline-block;margin-top:10px;color:' + t2.sub + ';font-size:12px;line-height:1.7"><li>Pattern matched keine Items in den ausgew\xE4hlten Hostgroups</li><li>Items sind nicht numerisch (nur Float/Int werden angezeigt)</li><li>Items sind nicht aktiviert (disabled/unsupported)</li><li>Pattern zu spezifisch \u2014 versuche z.B. mit \u201E*\u201D zu erweitern</li></ul>';
      container.innerHTML = '<div style="padding:48px 30px;text-align:center;color:' + t2.text + '"><div style="font-size:32px;margin-bottom:10px;opacity:0.4">\u{1F50D}</div><div style="font-size:14px;font-weight:600;margin-bottom:4px">Keine matching Items gefunden.</div>' + reasons + "</div>";
      return;
    }
    let cols = data.columns;
    const rows = data.rows || {};
    const hostMeta = data.hosts || {};
    let hostIds = sortHostIds;
    if (!hostIds) {
      hostIds = Object.keys(hostMeta);
      hostIds.sort(function(a, b) {
        return (hostMeta[a] || "").localeCompare(hostMeta[b] || "");
      });
    }
    const _primaryGroup = {};
    if (Array.isArray(hostsLookup)) {
      hostsLookup.forEach(function(n) {
        _primaryGroup[String(n.id)] = n._primaryGroup || "";
      });
    }
    const _selOrder = window.NT_CONFIG && window.NT_CONFIG.selected_group_names || [];
    const _groupRank = function(hid) {
      const g = _primaryGroup[String(hid)] || "";
      const idx = _selOrder.indexOf(g);
      return idx >= 0 ? idx : 999;
    };
    const _groupSet = /* @__PURE__ */ new Set();
    hostIds.forEach(function(hid) {
      const g = _primaryGroup[String(hid)];
      if (g) _groupSet.add(g);
    });
    const _hasMultiGroups = _groupSet.size >= 2;
    if (_hasMultiGroups) {
      hostIds = hostIds.slice().sort(function(a, b) {
        const ra = _groupRank(a), rb = _groupRank(b);
        return ra - rb;
      });
    }
    if (hideEmpty) {
      cols = cols.filter(function(c) {
        return hostIds.some(function(hid) {
          const v = rows[hid] && rows[hid][c.key];
          return v != null;
        });
      });
      hostIds = hostIds.filter(function(hid) {
        return cols.some(function(c) {
          const v = rows[hid] && rows[hid][c.key];
          return v != null;
        });
      });
      if (cols.length === 0 || hostIds.length === 0) {
        container.innerHTML = '<div style="padding:48px 30px;text-align:center;color:' + t2.text + '"><div style="font-size:32px;margin-bottom:10px;opacity:0.4">\u{1F4ED}</div><div style="font-size:14px;font-weight:600;margin-bottom:4px">Alles leer.</div><div style="color:' + t2.sub + ';font-size:12px;margin-top:6px">"Leere ausblenden" hat alle Hosts/Items entfernt \u2014 Toggle deaktivieren um die volle Pivot zu sehen.</div></div>';
        return;
      }
    }
    const baseUrl = buildBaseUrl();
    const aggregate2 = aggregateValues;
    const _unitSet = new Set(cols.map(function(c) {
      return c.unit || "";
    }));
    const _aggUnit = (_unitSet.size === 1 ? cols[0] && cols[0].unit : "") || "";
    const _anomalyStats = {};
    cols.forEach(function(c) {
      const vals = [];
      hostIds.forEach(function(hid) {
        const v = rows[hid] && rows[hid][c.key];
        if (typeof v === "number" && isFinite(v)) vals.push(v);
      });
      if (vals.length < 5) {
        _anomalyStats[c.key] = null;
        return;
      }
      const sorted = vals.slice().sort(function(a, b) {
        return a - b;
      });
      const median = sorted[Math.floor(sorted.length / 2)];
      const devs = sorted.map(function(v) {
        return Math.abs(v - median);
      }).sort(function(a, b) {
        return a - b;
      });
      const mad = devs[Math.floor(devs.length / 2)];
      if (mad <= 0) {
        _anomalyStats[c.key] = null;
        return;
      }
      _anomalyStats[c.key] = { median, sigma: mad * 1.4826 };
    });
    function isAnomaly(v, colKey) {
      const s = _anomalyStats[colKey];
      if (!s || typeof v !== "number" || !isFinite(v)) return false;
      return Math.abs(v - s.median) > 2 * s.sigma;
    }
    const _colStats = {};
    if (heatmap) {
      cols.forEach(function(c) {
        let mn = Infinity, mx = -Infinity, n = 0;
        hostIds.forEach(function(hid) {
          const v = rows[hid] && rows[hid][c.key];
          if (typeof v === "number" && isFinite(v)) {
            if (v < mn) mn = v;
            if (v > mx) mx = v;
            n++;
          }
        });
        _colStats[c.key] = n >= 2 && mn < mx ? { min: mn, max: mx } : null;
      });
    }
    let _avgStats = null;
    if (heatmap) {
      const allAvgs = [];
      hostIds.forEach(function(hid) {
        const row = rows[hid] || {};
        const vals = [];
        cols.forEach(function(c) {
          const v = row[c.key];
          if (typeof v === "number" && isFinite(v)) vals.push(v);
        });
        const a = aggregate2(vals, "avg");
        if (a != null) allAvgs.push(a);
      });
      if (allAvgs.length >= 2) {
        const mn = Math.min.apply(null, allAvgs);
        const mx = Math.max.apply(null, allAvgs);
        if (mn < mx) _avgStats = { min: mn, max: mx };
      }
    }
    function cellBg(v, unit, statsForCol) {
      if (typeof v !== "number" || !isFinite(v)) return "";
      if (heatmap && statsForCol) {
        const norm = Math.max(0, Math.min(1, (v - statsForCol.min) / (statsForCol.max - statsForCol.min)));
        const hue = Math.round(120 - norm * 120);
        return ";background:hsla(" + hue + ",65%,50%,0.18)";
      }
      if (unit === "%") {
        if (v >= 95) return ";background:rgba(220,38,38,0.18)";
        if (v >= 80) return ";background:rgba(245,158,11,0.20)";
      }
      return "";
    }
    const arrow = function(col) {
      if (col !== sortCol) return "";
      return sortDir === "desc" ? " \u25BC" : " \u25B2";
    };
    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px";
    let thead = '<thead><tr style="background:' + t2.head + ";border-bottom:1px solid " + t2.border + '"><th data-sort="__host__" style="padding:6px 8px;text-align:left;font-size:11px;font-weight:700;color:' + (sortCol === "__host__" || !sortCol ? t2.textStrong : t2.sub) + ";text-transform:uppercase;letter-spacing:0.04em;cursor:pointer;user-select:none;position:sticky;left:0;background:" + t2.head + ';z-index:1">Host' + arrow("__host__") + (!sortCol ? " \u25B2" : "") + "</th>";
    const cleanLabel = function(s) {
      return String(s || "").replace(/^"+|"+$/g, "");
    };
    cols.forEach(function(c) {
      const isActive = c.key === sortCol;
      thead += '<th data-sort="' + esc(c.key) + '" style="padding:6px 8px;text-align:right;font-size:11px;font-weight:700;color:' + (isActive ? t2.textStrong : t2.sub) + ";text-transform:uppercase;letter-spacing:0.04em;cursor:pointer;user-select:none;font-family:" + monoFam + ';white-space:nowrap" title="' + esc(c.key) + '">' + esc(cleanLabel(c.label)) + (c.unit ? ' <span style="opacity:0.55">(' + esc(c.unit) + ")</span>" : "") + arrow(c.key) + "</th>";
    });
    thead += '<th style="padding:6px 8px;text-align:right;font-size:11px;font-weight:700;color:' + t2.sub + ";text-transform:uppercase;letter-spacing:0.04em;font-family:" + monoFam + ";white-space:nowrap;border-left:2px solid " + t2.border + '" title="Durchschnitt ueber alle Item-Spalten">Avg</th>';
    thead += "</tr></thead>";
    table.innerHTML = thead;
    const tbody = document.createElement("tbody");
    let _lastGroup = null;
    const _colspan = cols.length + 2;
    hostIds.forEach(function(hid) {
      const hostname = hostMeta[hid] || "";
      const row = rows[hid] || {};
      const grp = _primaryGroup[String(hid)] || "";
      if (_hasMultiGroups && grp !== _lastGroup) {
        tbody.insertAdjacentHTML(
          "beforeend",
          '<tr><td colspan="' + _colspan + '" style="padding:8px 14px;background:' + t2.head + ";color:" + t2.sub + ";font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;border-top:1px solid " + t2.border + ";border-bottom:1px solid " + t2.borderSoft + ';position:sticky;left:0">' + esc(grp || "\u2014 Ohne Gruppe \u2014") + "</td></tr>"
        );
        _lastGroup = grp;
      }
      const latestHostUrl = window.location.origin + baseUrl + "zabbix.php?action=latest.view&filter_set=1&hostids%5B%5D=" + encodeURIComponent(hid);
      let html = '<tr style="border-bottom:1px solid ' + t2.borderSoft + ';transition:background 0.12s"><td style="padding:5px 8px;font-weight:600;font-size:13px;position:sticky;left:0;background:' + t2.surface + ";z-index:1;border-right:1px solid " + t2.borderSoft + '"><a href="' + esc(latestHostUrl) + '" target="_blank" rel="noopener noreferrer" style="color:' + t2.link + ';text-decoration:none">' + esc(hostname) + "</a></td>";
      const rowVals = [];
      const meta = data.item_meta && data.item_meta[hid] || {};
      cols.forEach(function(c) {
        const v = row[c.key];
        if (v != null) rowVals.push(v);
        const im = meta[c.key];
        let cellLink;
        if (im && im.id) {
          cellLink = window.location.origin + baseUrl + "zabbix.php?action=latest.view&filter_set=1&itemids%5B%5D=" + encodeURIComponent(im.id);
        } else {
          cellLink = window.location.origin + baseUrl + "zabbix.php?action=latest.view&filter_set=1&hostids%5B%5D=" + encodeURIComponent(hid) + "&name=" + encodeURIComponent(cleanLabel(c.label) || c.key);
        }
        const cellColor = v == null ? t2.subSoft : t2.text;
        const bg = cellBg(v, c.unit, _colStats[c.key]);
        const anomalous = isAnomaly(v, c.key);
        const anomalyBorder = anomalous ? ";box-shadow:inset 3px 0 0 #a855f7" : "";
        const anomalyMark = anomalous ? '<span title="Anomalie: weicht deutlich vom Spalten-Median ab" style="color:#a855f7;font-weight:700;margin-right:2px">\u25C6</span>' : "";
        const ttParts = [];
        if (im && im.name) ttParts.push(im.name);
        if (im && im.desc) ttParts.push("\u2014 " + im.desc);
        if (anomalous && _anomalyStats[c.key]) {
          ttParts.push("\u25C6 Anomalie: Spalten-Median " + fmtVal(_anomalyStats[c.key].median, c.unit));
        }
        const tt = ttParts.length ? ttParts.join("\n") : "In Latest Data oeffnen";
        const trendSlot = im && im.id ? '<span class="nt-pivot-trend" data-itemid="' + esc(im.id) + '" style="display:inline-block;min-width:12px;text-align:center"></span>' : "";
        const sparkSlot = im && im.id ? '<span class="nt-pivot-spark" data-itemid="' + esc(im.id) + '" style="display:inline-block;width:56px;height:14px;vertical-align:middle;margin-right:4px;opacity:0.7"></span>' : "";
        html += '<td style="padding:0;text-align:right;font-family:' + monoFam + ";font-size:12px" + bg + anomalyBorder + '">' + (v != null ? '<a href="' + esc(cellLink) + '" target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;justify-content:flex-end;padding:5px 8px;color:' + cellColor + ';text-decoration:none" title="' + esc(tt) + '">' + sparkSlot + trendSlot + anomalyMark + "<span>" + esc(fmtVal(v, c.unit)) + "</span></a>" : '<span style="display:block;padding:5px 8px;color:' + cellColor + '">' + esc(fmtVal(v, c.unit)) + "</span>") + "</td>";
      });
      const avgVal = aggregate2(rowVals, "avg");
      const avgBg = cellBg(avgVal, _aggUnit, _avgStats);
      html += '<td style="padding:5px 8px;text-align:right;font-family:' + monoFam + ";font-size:12px;color:" + (avgVal == null ? t2.subSoft : t2.textStrong) + ";font-weight:600;border-left:2px solid " + t2.border + avgBg + '">' + esc(fmtVal(avgVal, _aggUnit)) + "</td>";
      html += "</tr>";
      tbody.insertAdjacentHTML("beforeend", html);
    });
    table.appendChild(tbody);
    if (hostIds.length > 0) {
      const tfoot = document.createElement("tfoot");
      ["sum", "avg", "p50", "p95", "p99", "max"].forEach(function(mode, idx) {
        const lblMap = { sum: "Sum", avg: "Avg", p50: "P50", p95: "P95", p99: "P99", max: "Max" };
        let row = '<tr style="background:' + t2.head + ";border-top:" + (idx === 0 ? "2px solid " + t2.border : "1px solid " + t2.borderSoft) + '"><td style="padding:5px 8px;font-size:11px;font-weight:700;color:' + t2.sub + ";text-transform:uppercase;letter-spacing:0.04em;position:sticky;left:0;background:" + t2.head + ";z-index:1;border-right:1px solid " + t2.borderSoft + '">' + lblMap[mode] + "</td>";
        const flatVals = [];
        cols.forEach(function(c) {
          const colVals = hostIds.map(function(hid) {
            return rows[hid] && rows[hid][c.key];
          });
          colVals.forEach(function(v2) {
            if (v2 != null) flatVals.push(v2);
          });
          const v = aggregate2(colVals, mode);
          row += '<td style="padding:5px 8px;text-align:right;font-family:' + monoFam + ";font-size:12px;color:" + (v == null ? t2.subSoft : t2.textStrong) + ';font-weight:600">' + esc(fmtVal(v, c.unit)) + "</td>";
        });
        const footerCross = aggregate2(flatVals, mode);
        row += '<td style="padding:5px 8px;text-align:right;font-family:' + monoFam + ";font-size:12px;color:" + (footerCross == null ? t2.subSoft : t2.textStrong) + ";font-weight:600;border-left:2px solid " + t2.border + '">' + esc(fmtVal(footerCross, _aggUnit)) + "</td>";
        row += "</tr>";
        tfoot.insertAdjacentHTML("beforeend", row);
      });
      table.appendChild(tfoot);
    }
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function() {
        _fetchAndRenderSparklines(container, baseUrl, t2);
      });
    } else {
      setTimeout(function() {
        _fetchAndRenderSparklines(container, baseUrl, t2);
      }, 0);
    }
    if (data.truncated) {
      const warn = document.createElement("div");
      warn.style.cssText = "padding:10px 14px;background:#fef3c7;color:#92400e;font-size:12px;border-radius:2px;margin-bottom:8px;font-weight:500";
      warn.textContent = "\u26A0 Sehr viele Items \u2014 Liste wurde abgeschnitten. Spezifischeres Pattern verwenden.";
      container.appendChild(warn);
    }
    const scroll = document.createElement("div");
    scroll.style.cssText = "overflow-x:auto;background:" + t2.surface + ";border:1px solid " + t2.border + ";border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,0.04)";
    scroll.appendChild(table);
    container.appendChild(scroll);
  }

  // assets/js/modules/query.js
  var FIELD_PREFIXES = ["host", "label", "ip", "type", "iftype", "proxy", "group"];
  var _FIELD_SET = {};
  FIELD_PREFIXES.forEach(function(f) {
    _FIELD_SET[f] = true;
  });
  function _rawTokens(input) {
    const out = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (inQuote) {
        if (c === '"') inQuote = false;
        else cur += c;
        continue;
      }
      if (c === '"') {
        inQuote = true;
        continue;
      }
      if (/\s/.test(c)) {
        if (cur) {
          out.push(cur);
          cur = "";
        }
        continue;
      }
      if (c === "(" || c === ")") {
        if (cur) {
          out.push(cur);
          cur = "";
        }
        out.push(c);
        continue;
      }
      cur += c;
    }
    if (cur) out.push(cur);
    return out;
  }
  function _tokenize(input) {
    return _rawTokens(input).map(function(raw) {
      if (raw === "(" || raw === ")") return { type: raw };
      const up = raw.toUpperCase();
      if (up === "OR") return { type: "OR" };
      if (up === "AND") return { type: "AND" };
      let neg = false;
      let body = raw;
      if (body[0] === "-" && body.length > 1) {
        neg = true;
        body = body.slice(1);
      }
      let field = null;
      let value = body;
      const ci = body.indexOf(":");
      if (ci > 0 && ci < body.length - 1) {
        const f = body.slice(0, ci).toLowerCase();
        if (_FIELD_SET[f]) {
          field = f;
          value = body.slice(ci + 1);
        }
      }
      return { type: "ATOM", neg, field, value: value.toLowerCase() };
    });
  }
  function parseQuery(text) {
    if (!text || !text.trim()) return null;
    const tokens = _tokenize(text);
    if (tokens.length === 0) return null;
    let i = 0;
    function peek() {
      return tokens[i];
    }
    function consume(t2) {
      const tok = tokens[i];
      if (!tok) return null;
      if (t2 && tok.type !== t2) return null;
      i++;
      return tok;
    }
    function parseOr() {
      let left = parseAnd();
      while (peek() && peek().type === "OR") {
        consume("OR");
        const right = parseAnd();
        if (!right) break;
        left = { type: "or", a: left, b: right };
      }
      return left;
    }
    function parseAnd() {
      let left = parsePrimary();
      if (!left) return null;
      while (peek()) {
        const t2 = peek().type;
        if (t2 === "AND") {
          consume("AND");
          const right = parsePrimary();
          if (!right) break;
          left = { type: "and", a: left, b: right };
        } else if (t2 === "ATOM" || t2 === "(") {
          const right = parsePrimary();
          if (!right) break;
          left = { type: "and", a: left, b: right };
        } else {
          break;
        }
      }
      return left;
    }
    function parsePrimary() {
      const t2 = peek();
      if (!t2) return null;
      if (t2.type === "(") {
        consume("(");
        const e = parseOr();
        consume(")");
        return e;
      }
      if (t2.type === "ATOM") {
        consume("ATOM");
        const atom = { type: "match", field: t2.field, value: t2.value };
        return t2.neg ? { type: "not", a: atom } : atom;
      }
      return null;
    }
    return parseOr();
  }
  function matchQuery(ast, fields) {
    if (!ast) return true;
    switch (ast.type) {
      case "match": {
        const hay = ast.field ? fields[ast.field] || "" : fields._any || "";
        return hay.indexOf(ast.value) >= 0;
      }
      case "not":
        return !matchQuery(ast.a, fields);
      case "and":
        return matchQuery(ast.a, fields) && matchQuery(ast.b, fields);
      case "or":
        return matchQuery(ast.a, fields) || matchQuery(ast.b, fields);
    }
    return true;
  }
  function nodeToQueryFields(n) {
    const fHost = ((n.host || "") + " " + (n.label || "")).toLowerCase();
    const fIp = (n.ip || "").toLowerCase();
    const fType = (n.type || "").toLowerCase();
    const fIftype = (n.iftype || "").toLowerCase();
    const fProxy = ((n.proxy_name || "") + " " + (n.proxy_group_name || "")).toLowerCase();
    const fGroup = (n.groups || []).join(" ").toLowerCase();
    return {
      host: fHost,
      label: fHost,
      ip: fIp,
      type: fType,
      iftype: fIftype,
      proxy: fProxy,
      group: fGroup,
      _any: fHost + " " + fIp
    };
  }

  // assets/js/modules/detail-panel.js
  var TYPE_INFO = {
    firewall: { lbl: "Firewall", icon: "\u{1F525}", col: "#dc2626" },
    // 🔥
    router: { lbl: "Router", icon: "\u{1F4E1}", col: "#7c3aed" },
    // 📡
    switch: { lbl: "Switch", icon: "\u{1F500}", col: "#2563eb" },
    // 🔀
    wireless: { lbl: "Wireless AP", icon: "\u{1F4F6}", col: "#0891b2" },
    // 📶
    server: { lbl: "Server", icon: "\u{1F5A5}", col: "#475569" },
    // 🖥
    storage: { lbl: "Storage", icon: "\u{1F4BE}", col: "#0e7490" },
    // 💾
    hypervisor: { lbl: "Hypervisor", icon: "\u{1F9F1}", col: "#7c2d12" },
    // 🧱
    camera: { lbl: t("detail.type.camera"), icon: "\u{1F4F7}", col: "#71717a" },
    // 📷
    printer: { lbl: t("detail.type.printer"), icon: "\u{1F5A8}", col: "#52525b" },
    // 🖨
    ups: { lbl: t("detail.type.ups"), icon: "\u{1F50B}", col: "#16a34a" },
    // 🔋
    homeauto: { lbl: "Smart Home", icon: "\u{1F3E0}", col: "#ea580c" },
    // 🏠
    mailserver: { lbl: "Mail-Server", icon: "\u2709\uFE0F", col: "#7c3aed" },
    // ✉️
    webserver: { lbl: "Web-Server", icon: "\u{1F310}", col: "#0d9488" },
    // 🌐
    container: { lbl: "Container", icon: "\u{1F4E6}", col: "#0369a1" },
    // 📦
    monitoring: { lbl: "Monitoring", icon: "\u{1F4CA}", col: "#9333ea" },
    // 📊
    linux: { lbl: "Linux Server", icon: "\u{1F427}", col: "#0f172a" },
    // 🐧
    windows: { lbl: "Windows", icon: "\u{1FA9F}", col: "#1d4ed8" },
    // 🪟
    macos: { lbl: "macOS", icon: "\u{1F34F}", col: "#52525b" },
    // 🍏
    internet: { lbl: "Internet", icon: "\u{1F30D}", col: "#3b82f6" }
    // 🌍
  };
  function typeInfo(type) {
    return TYPE_INFO[type] || { lbl: t("detail.type.unknown"), icon: "\u2753", col: "#94a3b8" };
  }
  function showDetail(panel, d, cy) {
    const sc = SEV_COL[d.severity || 0] || SEV_COL[0];
    const ti = typeInfo(d.type);
    const customMark = d.icon_override ? ' <span title="' + esc(t("detail.custom_icon_tip")) + '" style="color:#f59e0b;font-weight:700">*</span>' : "";
    const proxyTxt = function() {
      const pn = d.proxy_name || "", pg = d.proxy_group_name || "";
      if (pn && pg) return " via " + pn + " [grp:" + pg + "]";
      if (pn) return " via " + pn;
      if (pg) return " via grp:" + pg;
      return "";
    }();
    const ifaceCell = esc(d.iftype || "\u2014") + (proxyTxt ? '<span style="color:#94a3b8;font-size:11px">' + esc(proxyTxt) + "</span>" : "");
    const isOff = !!d.unavailable;
    const STALE_S2 = 300;
    const nowSec = Math.floor(Date.now() / 1e3);
    const ageSec = d.last_seen && d.last_seen > 0 ? nowSec - d.last_seen : 0;
    const isStale = !isOff && d.last_seen > 0 && ageSec > STALE_S2;
    const offColor = "#9ca3af";
    const staleStyle = isOff || isStale ? "opacity:0.55;text-decoration:line-through;text-decoration-style:wavy;" : "";
    const staleNote = isOff || isStale ? ' <span style="color:' + offColor + ';font-size:10px">(stale)</span>' : "";
    const fmtMetric = function(rawHtml) {
      return isOff || isStale ? '<span style="' + staleStyle + '">' + rawHtml + "</span>" + staleNote : rawHtml;
    };
    const section = function(label) {
      return '<div style="margin-top:10px;padding-top:6px;border-top:1px solid #f1f5f9;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">' + label + "</div>";
    };
    const statusPill = isOff ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:11px;background:rgba(229,55,66,0.13);color:#e53742;font-size:12px;font-weight:700"><span style="width:8px;height:8px;border-radius:50%;background:#e53742;display:inline-block"></span>OFFLINE</span>' : isStale ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:11px;background:rgba(245,158,11,0.13);color:#92400e;font-size:12px;font-weight:700"><span style="width:8px;height:8px;border-radius:50%;background:#f59e0b;display:inline-block"></span>STALE</span>' : '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:11px;background:' + sc + "22;color:" + sc + ';font-size:12px;font-weight:700"><span style="width:8px;height:8px;border-radius:50%;background:' + sc + ';display:inline-block"></span>' + esc(SEV_LBL[d.severity || 0] || "Normal") + "</span>";
    const badges = [];
    if (d.pinned) badges.push('<span style="background:rgba(59,130,246,0.13);color:#3b82f6;font-size:10px;font-weight:600;padding:2px 7px;border-radius:9px">&#128204; ' + esc(t("detail.badge.pinned")) + "</span>");
    if (d.maintenance) badges.push('<span style="background:rgba(245,158,11,0.13);color:#92400e;font-size:10px;font-weight:600;padding:2px 7px;border-radius:9px">\u{1F527} ' + esc(t("detail.badge.maintenance")) + "</span>");
    if (d.acknowledged) badges.push('<span style="background:rgba(34,197,94,0.13);color:#16a34a;font-size:10px;font-weight:600;padding:2px 7px;border-radius:9px">\u2714 Acked</span>');
    if (d.note) badges.push('<span style="background:rgba(245,158,11,0.13);color:#92400e;font-size:10px;font-weight:600;padding:2px 7px;border-radius:9px" title="' + esc(d.note) + '">&#127991; ' + esc(t("detail.badge.note")) + "</span>");
    const idRow = function(k, v) {
      return '<div style="display:flex;font-size:12px;line-height:1.4;padding:1px 0"><span style="color:#64748b;min-width:72px;flex-shrink:0">' + k + '</span><span style="color:#1f2c33;font-weight:500;overflow:hidden;text-overflow:ellipsis">' + v + "</span></div>";
    };
    const identityHtml = idRow("Host", esc(d.host || d.label)) + idRow("Type", '<b style="color:' + ti.col + '">' + ti.icon + " " + esc(ti.lbl) + "</b>" + customMark) + idRow("IP", esc(d.ip || "\u2014")) + idRow("Interface", ifaceCell);
    const metricsHtml = idRow("CPU", fmtMetric(d.cpu != null ? "<b>" + d.cpu + "%</b>" : "\u2014")) + idRow("Memory", fmtMetric(d.memory != null ? "<b>" + d.memory + "%</b>" : "\u2014")) + idRow("Ping", fmtMetric(d.ping > 0 ? "<b>" + d.ping + " ms</b>" : "\u2014")) + idRow("&#8595; In", fmtMetric('<span style="color:#22c55e">' + fmt(d.traffic ? d.traffic.in : 0) + "</span>")) + idRow("&#8593; Out", fmtMetric('<span style="color:#38bdf8">' + fmt(d.traffic ? d.traffic.out : 0) + "</span>"));
    const fmtAgo = function(unixTs) {
      if (!unixTs || unixTs <= 0) return "";
      const sec = Math.max(0, Math.floor(Date.now() / 1e3) - unixTs);
      if (sec < 60) return t("detail.ago", { v: sec + "s" });
      if (sec < 3600) return t("detail.ago", { v: Math.floor(sec / 60) + "m" });
      if (sec < 86400) return t("detail.ago", { v: Math.floor(sec / 3600) + "h" });
      return t("detail.ago", { v: Math.floor(sec / 86400) + "d" });
    };
    const staleBanner = isStale && !isOff ? '<div style="background:rgba(245,158,11,0.13);border:1px solid #f59e0b;border-left:4px solid #f59e0b;border-radius:2px;padding:6px 10px;margin-bottom:8px;color:#92400e;font-size:12px"><div style="font-weight:700">&#9888; STALE &middot; ' + esc(t("detail.stale.last_value", { ago: fmtAgo(d.last_seen) })) + '</div><div style="font-size:11px;margin-top:2px;font-style:italic">' + esc(t("detail.stale.hint")) + "</div></div>" : "";
    const offlineBanner = isOff ? '<div style="background:rgba(229,55,66,0.12);border:1px solid #e53742;border-left:4px solid #e53742;border-radius:2px;padding:6px 10px;margin-bottom:8px;color:#e53742;font-size:12px"><div style="font-weight:700">&#9888; OFFLINE' + (d.down_since ? " &middot; " + fmtAgo(d.down_since) : "") + "</div>" + (d.down_error ? '<div style="font-size:11px;color:#9c1a25;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(d.down_error) + '">' + esc(d.down_error) + "</div>" : "") + '<div style="font-size:11px;color:#9c1a25;margin-top:2px;font-style:italic">' + esc(t("detail.offline.hint")) + "</div></div>" : "";
    let peers = "";
    cy.getElementById(d.id).connectedEdges().forEach(function(edge) {
      const other = edge.source().id() === d.id ? edge.target() : edge.source();
      if (other.data("isGroup")) return;
      peers += (peers ? "<br>" : "") + "&#8596; " + esc(other.data("label"));
    });
    const _tPct = !d.traffic ? 0 : Math.min((d.traffic.in + d.traffic.out) / 2e7 * 100, 100);
    const _pPct = !d.ping || d.ping <= 0 ? 0 : Math.min(d.ping / 200 * 100, 100);
    const rings = [
      { col: "#3b82f6", lbl: "CPU", val: d.cpu != null ? d.cpu + "%" : "\u2014", pct: Math.min(d.cpu || 0, 100) },
      { col: "#8b5cf6", lbl: "Memory", val: d.memory != null ? d.memory + "%" : "\u2014", pct: Math.min(d.memory || 0, 100) },
      { col: "#22c55e", lbl: "Traffic", val: d.traffic ? fmt(d.traffic.in) + " / " + fmt(d.traffic.out) : "\u2014", pct: _tPct },
      { col: "#f59e0b", lbl: "Ping", val: d.ping > 0 ? d.ping + " ms" : "\u2014", pct: _pPct }
    ];
    let ringHtml = '<div style="display:flex;gap:8px;margin-bottom:6px;padding:2px 0">';
    rings.forEach(function(r) {
      ringHtml += '<div style="flex:1;text-align:center"><svg width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" fill="none" stroke="' + r.col + '22" stroke-width="4"/>' + (r.pct > 0 ? '<circle cx="18" cy="18" r="14" fill="none" stroke="' + r.col + '" stroke-width="4" stroke-dasharray="' + (r.pct / 100 * 87.96).toFixed(1) + ' 87.96" stroke-dashoffset="21.99" stroke-linecap="round"/>' : "") + '</svg><div style="font-size:9px;color:' + r.col + ';font-weight:700;margin-top:1px">' + r.lbl + '</div><div style="font-size:10px;color:#334155;font-weight:600">' + r.val + "</div></div>";
    });
    ringHtml += "</div>";
    panel.style.display = "block";
    const _items = d.extra_items || [];
    const _itemsCollapsible = _items.length > 4;
    const _itemsHtml = _items.map(function(it) {
      const val = it.error ? '<span style="color:#94a3b8;font-style:italic">' + esc(it.error) + "</span>" : "<b>" + esc(fmtItemValue(it.value, it.units)) + "</b>";
      return '<div style="display:flex;font-size:11px;line-height:1.45;padding:1px 0"><span style="color:#64748b;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:10px" title="' + esc(it.name || "") + '">' + esc((it.name || "").substring(0, 40)) + '</span><span style="color:#1f2c33;font-weight:500;flex-shrink:0">' + val + "</span></div>";
    }).join("");
    const extraBlock = _items.length > 0 ? section("Items") + (_itemsCollapsible ? '<details><summary style="font-size:11px;color:#0275b8;cursor:pointer;user-select:none;margin-bottom:4px">' + esc(t("detail.items.show", { n: _items.length })) + "</summary>" + _itemsHtml + "</details>" : _itemsHtml) : "";
    const zbxBase = function() {
      const p = window.location.pathname;
      const i = p.indexOf("/zabbix.php");
      return i > 0 ? p.substring(0, i + 1) : "/";
    }();
    const zbxOrigin = window.location.origin + zbxBase;
    const hostId = encodeURIComponent(d.id);
    const actions = [
      {
        lbl: "\u{1F4CA}",
        title: "Latest Data",
        url: zbxOrigin + "zabbix.php?action=latest.view&filter_set=1&hostids%5B%5D=" + hostId
      },
      {
        lbl: "\u26A0",
        title: t("detail.act.problems"),
        url: zbxOrigin + "zabbix.php?action=problem.view&filter_set=1&hostids%5B%5D=" + hostId
      },
      {
        lbl: "\u{1F4C8}",
        title: "Graphs",
        url: zbxOrigin + "zabbix.php?action=charts.view&filter_set=1&filter_hostids%5B%5D=" + hostId
      }
    ];
    if (window.NT_CONFIG && window.NT_CONFIG.can_edit) {
      actions.push({
        lbl: "\u2699\uFE0F",
        title: t("detail.act.edit"),
        url: zbxOrigin + "zabbix.php?action=popup&popup=host.edit&hostid=" + hostId
      });
    }
    const actionBar = '<div style="display:flex;gap:4px;margin-bottom:4px">' + actions.map(function(a, i) {
      return '<button data-act="' + i + '" title="' + esc(a.title) + '" style="flex:1;padding:5px;background:#f4f6f7;border:1px solid #dfe4e7;border-radius:2px;cursor:pointer;font-size:13px;color:#1f2c33;transition:background 0.12s">' + a.lbl + "</button>";
    }).join("") + "</div>";
    const statusSection = section("Status") + '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px">' + statusPill + (badges.length ? badges.join("") : "") + "</div>";
    panel.innerHTML = // Header: Icon + Hostname + Type-Pill + Close-Button
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:6px"><div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0"><span style="font-size:18px;line-height:1;flex-shrink:0">' + ti.icon + '</span><span style="font-weight:700;font-size:14px;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(d.label) + '">' + esc(d.label) + '</span><span style="display:inline-block;padding:1px 6px;border-radius:9px;background:' + ti.col + "22;color:" + ti.col + ';font-size:9px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;flex-shrink:0">' + esc(ti.lbl) + customMark + '</span></div><button id="nt-detail-close" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:18px;line-height:1;padding:0;flex-shrink:0">&#x2715;</button></div>' + offlineBanner + staleBanner + actionBar + statusSection + section(esc(t("detail.sec.identity"))) + identityHtml + section(esc(t("detail.sec.metrics"))) + ringHtml + metricsHtml + extraBlock + (peers ? section(esc(t("detail.sec.connections"))) + '<div style="font-size:11px;color:#475569;line-height:1.6">' + peers + "</div>" : "");
    const cb = document.getElementById("nt-detail-close");
    if (cb) cb.addEventListener("click", function(e) {
      e.stopPropagation();
      panel.style.display = "none";
      if (window._ntCy) {
        window._ntCy.nodes("[!isGroup]").forEach(function(n) {
          n.style("opacity", 1);
        });
        window._ntCy.edges().forEach(function(ed) {
          ed.style("opacity", 0.85);
        });
      }
    });
    panel.querySelectorAll("button[data-act]").forEach(function(btn) {
      btn.addEventListener("mouseenter", function() {
        this.style.background = "#e2e8f0";
      });
      btn.addEventListener("mouseleave", function() {
        this.style.background = "#f8fafc";
      });
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        const idx = parseInt(this.dataset.act, 10);
        if (actions[idx]) window.open(actions[idx].url, "_blank", "noopener,noreferrer");
      });
    });
  }

  // assets/js/modules/render-table.js
  var TYPE_ICON2 = {
    firewall: "\u{1F525}",
    router: "\u{1F4E1}",
    switch: "\u{1F500}",
    wireless: "\u{1F4F6}",
    server: "\u{1F5A5}",
    storage: "\u{1F4BE}",
    hypervisor: "\u{1F9F1}",
    camera: "\u{1F4F7}",
    printer: "\u{1F5A8}",
    ups: "\u{1F50B}",
    homeauto: "\u{1F3E0}",
    mailserver: "\u2709\uFE0F",
    webserver: "\u{1F310}",
    container: "\u{1F4E6}",
    monitoring: "\u{1F4CA}",
    linux: "\u{1F427}",
    windows: "\u{1FA9F}",
    macos: "\u{1F34F}",
    internet: "\u{1F30D}"
  };
  var TYPE_LBL = {
    firewall: "Firewall",
    router: "Router",
    switch: "Switch",
    wireless: "WAP",
    server: "Server",
    storage: "Storage",
    hypervisor: "Hypervisor",
    camera: t("table.type.camera"),
    printer: t("table.type.printer"),
    ups: t("table.type.ups"),
    homeauto: "Smart Home",
    mailserver: "Mail",
    webserver: "Web",
    container: "Container",
    monitoring: "Monitoring",
    linux: "Linux",
    windows: "Windows",
    macos: "macOS",
    internet: "Internet"
  };
  var _filterStatuses = /* @__PURE__ */ new Set([0, 1, 2, 3, 4, 5]);
  var _filterGroups = /* @__PURE__ */ new Set();
  var _filterText = "";
  var _filterQuery = null;
  var BUILTIN_FILTER_PRESETS = [
    { name: t("table.preset.all"), builtin: true, filter: {} },
    { name: t("table.preset.only_firewalls"), builtin: true, filter: { text: "type:firewall" } },
    { name: t("table.preset.only_servers"), builtin: true, filter: { text: "type:server" } },
    { name: t("table.preset.only_switches"), builtin: true, filter: { text: "type:switch" } },
    { name: t("table.preset.only_storage"), builtin: true, filter: { text: "type:storage" } },
    { name: t("table.preset.only_offline"), builtin: true, filter: { offline: true } },
    { name: "Disaster", builtin: true, filter: { sev: [5] } },
    { name: "Crit + High", builtin: true, filter: { sev: [4, 5] } }
  ];
  var _renderWrap = null;
  var _renderNodes = null;
  var _renderEdges = null;
  function _applyFilterPreset(preset) {
    const f = preset && preset.filter || {};
    _filterStatuses = new Set(Array.isArray(f.sev) ? f.sev : [0, 1, 2, 3, 4, 5]);
    _filterGroups = new Set(Array.isArray(f.groups) ? f.groups : []);
    _filterText = typeof f.text === "string" ? f.text : "";
    _reparseTokens();
    _filterOfflineOnly = !!f.offline;
    _sortCol = typeof f.sort === "string" ? f.sort : "severity";
    _sortDir = f.sortDir === "asc" || f.sortDir === "desc" ? f.sortDir : "desc";
    if (_renderWrap && _renderNodes) renderTable(_renderWrap, _renderNodes, _renderEdges || []);
  }
  function _currentFilterState() {
    const f = {};
    const sev = Array.from(_filterStatuses).sort();
    if (sev.length !== 6) f.sev = sev;
    if (_filterGroups.size > 0) f.groups = Array.from(_filterGroups).sort();
    if (_filterText) f.text = _filterText;
    if (_filterOfflineOnly) f.offline = true;
    if (_sortCol && _sortCol !== "severity") f.sort = _sortCol;
    if (_sortDir && _sortDir !== "desc") f.sortDir = _sortDir;
    return f;
  }
  function _rebuildPresetPop(pop, theme) {
    pop.innerHTML = "";
    function row(label, color, onClick) {
      const r = document.createElement("div");
      r.style.cssText = "padding:5px 10px;cursor:pointer;font-size:12px;color:" + (color || theme.text) + ";border-radius:3px;display:flex;align-items:center;gap:8px";
      r.innerHTML = label;
      r.addEventListener("mouseenter", function() {
        r.style.background = theme.head;
      });
      r.addEventListener("mouseleave", function() {
        r.style.background = "";
      });
      r.addEventListener("click", function(e) {
        e.stopPropagation();
        pop.style.display = "none";
        onClick();
      });
      return r;
    }
    function header(text) {
      const h = document.createElement("div");
      h.textContent = text;
      h.style.cssText = "padding:6px 10px 2px;font-size:10px;color:" + theme.sub + ";text-transform:uppercase;letter-spacing:0.05em;font-weight:700";
      return h;
    }
    pop.appendChild(header(t("table.preset.builtin")));
    BUILTIN_FILTER_PRESETS.forEach(function(p) {
      pop.appendChild(row(esc(p.name), theme.text, function() {
        _applyFilterPreset(p);
      }));
    });
    const user = loadFilterPresets();
    if (user.length > 0) {
      pop.appendChild(header(t("table.preset.custom")));
      user.forEach(function(p) {
        const r = document.createElement("div");
        r.style.cssText = "padding:5px 10px;cursor:pointer;font-size:12px;color:" + theme.text + ";border-radius:3px;display:flex;align-items:center;gap:8px";
        r.innerHTML = '<span style="flex:1">' + esc(p.name) + '</span><span data-del="1" title="' + esc(t("table.preset.delete")) + '" style="color:' + theme.subSoft + ';padding:0 4px;cursor:pointer">\xD7</span>';
        r.addEventListener("mouseenter", function() {
          r.style.background = theme.head;
        });
        r.addEventListener("mouseleave", function() {
          r.style.background = "";
        });
        r.addEventListener("click", function(e) {
          e.stopPropagation();
          if (e.target.dataset && e.target.dataset.del) {
            if (!confirm(t("table.preset.delete_confirm", { name: p.name }))) return;
            const arr = loadFilterPresets().filter(function(x) {
              return x.name !== p.name;
            });
            saveFilterPresets(arr);
            _rebuildPresetPop(pop, theme);
            return;
          }
          pop.style.display = "none";
          _applyFilterPreset(p);
        });
        pop.appendChild(r);
      });
    }
    const sep = document.createElement("div");
    sep.style.cssText = "height:1px;background:" + theme.borderSoft + ";margin:4px 0";
    pop.appendChild(sep);
    pop.appendChild(row(esc(t("table.preset.save_current")), theme.accent, function() {
      const name = prompt(t("table.preset.name_prompt"));
      if (!name || !name.trim()) return;
      const arr = loadFilterPresets().filter(function(x) {
        return x.name !== name.trim();
      });
      arr.push({ name: name.trim(), filter: _currentFilterState() });
      saveFilterPresets(arr);
    }));
  }
  var _diff = null;
  var _filterOfflineOnly = false;
  var _sortCol = "severity";
  var _sortDir = "desc";
  var _tableMode = "hosts";
  var _itemsPattern = "vfs.fs.size[*,pused]";
  var _itemsData = null;
  var _itemsSearch = "";
  var _itemsQuery = null;
  var _itemsSortCol = "";
  var _itemsSortDir = "desc";
  var _itemsHideEmpty = false;
  var _itemsHeatmap = false;
  try {
    const m = localStorage.getItem(NT_TABLE_MODE_KEY);
    if (m === "hosts" || m === "items") _tableMode = m;
    const p = localStorage.getItem(NT_ITEMS_PATTERN_KEY);
    if (p) _itemsPattern = p;
    const he = localStorage.getItem(NT_ITEMS_HIDE_EMPTY_KEY);
    if (he === "1") _itemsHideEmpty = true;
    const hm = localStorage.getItem(NT_ITEMS_HEATMAP_KEY);
    if (hm === "1") _itemsHeatmap = true;
  } catch (e) {
  }
  var URL_KEYS = {
    sev: "t_sev",
    group: "t_g",
    q: "t_q",
    off: "t_off",
    sort: "t_sort",
    sdir: "t_sdir",
    mode: "t_mode"
  };
  function _urlSync() {
    if (typeof window === "undefined" || !window.history) return;
    const p = new URLSearchParams(window.location.search);
    if (_filterStatuses.size > 0 && _filterStatuses.size < 6) {
      p.set(URL_KEYS.sev, Array.from(_filterStatuses).sort().join(","));
    } else {
      p.delete(URL_KEYS.sev);
    }
    if (_filterGroups.size > 0) {
      p.set(URL_KEYS.group, Array.from(_filterGroups).sort().join(","));
    } else {
      p.delete(URL_KEYS.group);
    }
    if (_filterText) p.set(URL_KEYS.q, _filterText);
    else p.delete(URL_KEYS.q);
    if (_filterOfflineOnly) p.set(URL_KEYS.off, "1");
    else p.delete(URL_KEYS.off);
    if (_sortCol && _sortCol !== "severity") p.set(URL_KEYS.sort, _sortCol);
    else p.delete(URL_KEYS.sort);
    if (_sortDir && _sortDir !== "desc") p.set(URL_KEYS.sdir, _sortDir);
    else p.delete(URL_KEYS.sdir);
    if (_tableMode === "items") p.set(URL_KEYS.mode, "items");
    else p.delete(URL_KEYS.mode);
    const q = p.toString();
    const newUrl = window.location.pathname + (q ? "?" + q : "") + window.location.hash;
    if (newUrl !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(null, "", newUrl);
    }
  }
  function _urlRestore() {
    if (typeof window === "undefined" || !window.location) return;
    const p = new URLSearchParams(window.location.search);
    const sev = p.get(URL_KEYS.sev);
    if (sev !== null) {
      _filterStatuses = /* @__PURE__ */ new Set();
      sev.split(",").forEach(function(s) {
        const n = parseInt(s, 10);
        if (n >= 0 && n <= 5) _filterStatuses.add(n);
      });
      if (_filterStatuses.size === 0) _filterStatuses = /* @__PURE__ */ new Set([0, 1, 2, 3, 4, 5]);
    }
    const grp = p.get(URL_KEYS.group);
    if (grp) grp.split(",").forEach(function(g) {
      if (g) _filterGroups.add(g);
    });
    const q = p.get(URL_KEYS.q);
    if (q) {
      _filterText = q;
      _reparseTokens();
    }
    if (p.get(URL_KEYS.off) === "1") _filterOfflineOnly = true;
    const sc = p.get(URL_KEYS.sort);
    if (sc) _sortCol = sc;
    const sd = p.get(URL_KEYS.sdir);
    if (sd === "asc" || sd === "desc") _sortDir = sd;
    const md = p.get(URL_KEYS.mode);
    if (md === "items") _tableMode = "items";
  }
  _urlRestore();
  function mkTheme(dark) {
    if (dark) {
      return {
        bg: "#0d1117",
        surface: "#161b22",
        head: "#1c2128",
        hover: "#1f242c",
        stripe: "#13181f",
        border: "#30363d",
        borderSoft: "#21262d",
        text: "#e6edf3",
        textStrong: "#f0f6fc",
        sub: "#8b949e",
        subSoft: "#6e7681",
        link: "#4f9bdb",
        accent: "#0275b8",
        inputBg: "#0d1117",
        actionBg: "#21262d",
        actionBorder: "#30363d",
        actionText: "#c9d1d9",
        detailBg: "#0d1117",
        detailText: "#e6edf3",
        counterText: "#8b949e",
        problemBg: "rgba(229,55,66,0.18)",
        problemText: "#e57280"
      };
    }
    return {
      bg: "#ffffff",
      surface: "#ffffff",
      head: "#f6fafd",
      // Zabbix list-table thead
      hover: "#eaf6fb",
      // Zabbix row hover
      stripe: "#fbfdfe",
      border: "#dfe4e7",
      // Zabbix table-border
      borderSoft: "#ebeef0",
      text: "#1f2c33",
      // Zabbix body text
      textStrong: "#000000",
      sub: "#768d99",
      // Zabbix muted text
      subSoft: "#a4afb5",
      link: "#0275b8",
      // Zabbix anchor color
      accent: "#0275b8",
      // Zabbix primary blue
      inputBg: "#ffffff",
      actionBg: "#f4f6f7",
      actionBorder: "#dfe4e7",
      actionText: "#1f2c33",
      detailBg: "#fafbfc",
      detailText: "#1f2c33",
      counterText: "#768d99",
      problemBg: "rgba(229,55,66,0.13)",
      problemText: "#e53742"
      // Zabbix critical red
    };
  }
  var NT_R = {
    sm: "2px",
    // Inputs, Buttons
    md: "3px",
    // Containers
    pill: "11px"
    // Status-/Severity-Pills (bleiben rund)
  };
  function buildBaseUrl2() {
    const p = window.location.pathname;
    const i = p.indexOf("/zabbix.php");
    return i > 0 ? p.substring(0, i + 1) : "/";
  }
  function fmtPct(v) {
    if (v === null || v === void 0 || isNaN(v)) return "\u2014";
    return Math.round(v) + "%";
  }
  function fmtMs(v) {
    if (v === null || v === void 0 || isNaN(v) || v < 0) return "\u2014";
    return v.toFixed(1) + " ms";
  }
  function proxyTooltip(n) {
    const pn = n.proxy_name || "";
    const pg = n.proxy_group_name || "";
    if (!pn && !pg) return t("table.proxy.none");
    if (pn && pg) return t("table.proxy.with_group", { name: pn, group: pg });
    if (pn) return t("table.proxy.name", { name: pn });
    return t("table.proxy.group", { name: pg });
  }
  function fmtBps(bps) {
    if (bps === null || bps === void 0 || isNaN(bps) || bps < 0) return "\u2014";
    if (bps < 1e3) return Math.round(bps) + " bps";
    if (bps < 1e6) return (bps / 1e3).toFixed(1) + " Kbps";
    if (bps < 1e9) return (bps / 1e6).toFixed(1) + " Mbps";
    return (bps / 1e9).toFixed(2) + " Gbps";
  }
  function fmtAge(clock) {
    if (!clock || clock <= 0) return "";
    const sec = Math.max(0, Math.floor(Date.now() / 1e3) - clock);
    if (sec < 60) return sec + "s";
    if (sec < 3600) return Math.floor(sec / 60) + "m";
    if (sec < 86400) return Math.floor(sec / 3600) + "h";
    return Math.floor(sec / 86400) + "d";
  }
  function buildProblemDetailRow(n, colspan, theme) {
    const list = n.problem_list || [];
    if (list.length === 0) {
      return '<tr class="nt-prob-detail" data-host-id="' + esc(String(n.id)) + '"><td colspan="' + colspan + '" style="padding:14px 18px 14px 22px;background:' + theme.detailBg + ";border-bottom:1px solid " + theme.borderSoft + ";color:" + theme.subSoft + ';font-size:12px">' + esc(t("table.no_detail_data")) + "</td></tr>";
    }
    let body = "";
    list.forEach(function(p) {
      const sev = p.severity || 0;
      const col = SEV_COL[sev] || theme.subSoft;
      const lbl = SEV_LBL[sev] || "";
      const age = fmtAge(p.clock);
      body += '<div style="display:flex;align-items:center;gap:10px;padding:5px 0;font-size:12.5px;line-height:1.4"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + col + ";flex-shrink:0;box-shadow:0 0 0 2px " + col + '22"></span><span style="color:' + col + ';font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;min-width:64px">' + esc(lbl) + '</span><span style="flex:1;color:' + theme.detailText + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.name || "") + "</span>" + (p.acknowledged ? '<span title="' + esc(t("table.prob.acked")) + '" style="color:#16a34a;font-size:11px;font-weight:700;flex-shrink:0">\u2714</span>' : "") + (age ? '<span style="color:' + theme.subSoft + ';font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;flex-shrink:0;min-width:42px;text-align:right">' + esc(age) + "</span>" : "") + "</div>";
    });
    return '<tr class="nt-prob-detail" data-host-id="' + esc(String(n.id)) + '"><td colspan="' + colspan + '" style="padding:10px 18px 14px 38px;background:' + theme.detailBg + ";border-bottom:1px solid " + theme.borderSoft + '">' + body + "</td></tr>";
  }
  function passesFilter(n) {
    if (_filterOfflineOnly) {
      if (!n.unavailable) return false;
    } else {
      if (!_filterStatuses.has(n.severity || 0)) return false;
    }
    if (_filterGroups.size > 0) {
      const hostGroups = n.groups || [];
      let allFound = true;
      for (const g of _filterGroups) {
        if (hostGroups.indexOf(g) < 0) {
          allFound = false;
          break;
        }
      }
      if (!allFound) return false;
    }
    if (_filterQuery) {
      if (!matchQuery(_filterQuery, nodeToQueryFields(n))) return false;
    }
    return true;
  }
  function _reparseTokens() {
    _filterQuery = parseQuery(_filterText);
  }
  function compare(a, b) {
    const dir = _sortDir === "desc" ? -1 : 1;
    let av, bv;
    switch (_sortCol) {
      case "host":
        av = (a.label || "").toLowerCase();
        bv = (b.label || "").toLowerCase();
        break;
      case "type":
        av = (a.type || "").toLowerCase();
        bv = (b.type || "").toLowerCase();
        break;
      case "group":
        av = (a._primaryGroup || "").toLowerCase();
        bv = (b._primaryGroup || "").toLowerCase();
        break;
      case "ip":
        av = a.ip || "";
        bv = b.ip || "";
        break;
      case "cpu":
        av = a.cpu || -1;
        bv = b.cpu || -1;
        break;
      case "memory":
        av = a.memory || -1;
        bv = b.memory || -1;
        break;
      case "ping":
        av = a.ping == null ? 1e9 : a.ping;
        bv = b.ping == null ? 1e9 : b.ping;
        break;
      // Traffic-Sortierung: Summe in+out (gibt einen sinnvollen "Lasttreiber"-Sort)
      case "traffic":
        av = (a.traffic && a.traffic.in || 0) + (a.traffic && a.traffic.out || 0);
        bv = (b.traffic && b.traffic.in || 0) + (b.traffic && b.traffic.out || 0);
        break;
      case "problems":
        av = a.problems || 0;
        bv = b.problems || 0;
        break;
      case "severity":
      default:
        av = a.severity || 0;
        bv = b.severity || 0;
        break;
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  }
  function buildFilterBar(nodes, groupNames, theme) {
    const bar = document.createElement("div");
    bar.id = "nt-table-filterbar";
    bar.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px;background:" + theme.head + ";border-bottom:1px solid " + theme.border + ";flex-wrap:wrap";
    const modeWrap = document.createElement("div");
    modeWrap.style.cssText = "display:inline-flex;border:1px solid " + theme.border + ";border-radius:" + NT_R.sm + ";overflow:hidden;background:" + theme.surface;
    const mkModeBtn = function(id, lbl) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.mode = id;
      b.textContent = lbl;
      const active = _tableMode === id;
      b.style.cssText = "padding:3px 12px;border:none;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;transition:background 0.12s,color 0.12s;background:" + (active ? theme.accent : "transparent") + ";color:" + (active ? "#ffffff" : theme.sub);
      modeWrap.appendChild(b);
      return b;
    };
    mkModeBtn("hosts", "Hosts");
    mkModeBtn("items", "Items");
    bar.appendChild(modeWrap);
    if (_tableMode === "items") {
      return bar;
    }
    const sevWrap = document.createElement("div");
    sevWrap.style.cssText = "display:flex;gap:4px;align-items:center";
    const sevLabel = document.createElement("span");
    sevLabel.textContent = "Status:";
    sevLabel.style.cssText = "font-size:12px;color:" + theme.sub + ";font-weight:600;margin-right:2px";
    sevWrap.appendChild(sevLabel);
    [0, 1, 2, 3, 4, 5].forEach(function(sev) {
      const pill = document.createElement("button");
      pill.type = "button";
      const active = _filterStatuses.has(sev);
      pill.dataset.sev = String(sev);
      pill.textContent = "\u25CF " + SEV_LBL[sev];
      const dimmed = _filterOfflineOnly;
      pill.style.cssText = "padding:2px 8px;border:1px solid " + (active ? SEV_COL[sev] : theme.border) + ";background:" + (active ? SEV_COL[sev] + "22" : theme.surface) + ";color:" + (active ? SEV_COL[sev] : theme.subSoft) + ";border-radius:" + NT_R.pill + ";font-size:11px;font-weight:600;cursor:pointer;transition:all 0.12s;font-family:inherit" + (dimmed ? ";opacity:0.4;pointer-events:none" : "");
      sevWrap.appendChild(pill);
    });
    bar.appendChild(sevWrap);
    const offBtn = document.createElement("button");
    offBtn.type = "button";
    offBtn.id = "nt-table-offline-only";
    offBtn.textContent = "\u25CF Offline";
    offBtn.title = t("table.offline_only_tip");
    const _setOffStyle = function() {
      const active = _filterOfflineOnly;
      offBtn.style.cssText = "padding:2px 8px;border:1px solid " + (active ? "#e53742" : theme.border) + ";background:" + (active ? "rgba(229,55,66,0.13)" : theme.surface) + ";color:" + (active ? "#e53742" : theme.subSoft) + ";border-radius:" + NT_R.pill + ";font-size:11px;font-weight:600;cursor:pointer;transition:all 0.12s;font-family:inherit;margin-left:6px";
    };
    _setOffStyle();
    bar.appendChild(offBtn);
    if (groupNames.length >= 2) {
      const grpWrap = document.createElement("div");
      grpWrap.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap";
      const grpLabel = document.createElement("span");
      grpLabel.textContent = t("table.filter.group");
      grpLabel.style.cssText = "font-size:12px;color:" + theme.sub + ";font-weight:600";
      grpWrap.appendChild(grpLabel);
      const activeGroups = Array.from(_filterGroups).sort();
      activeGroups.forEach(function(g) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.dataset.removeGroup = g;
        chip.style.cssText = "display:inline-flex;align-items:center;gap:4px;padding:2px 4px 2px 8px;border:1px solid " + theme.accent + ";border-radius:" + NT_R.pill + ";background:" + theme.accent + "22;color:" + theme.accent + ";font-size:11px;font-weight:600;cursor:pointer;font-family:inherit";
        chip.innerHTML = esc(g) + '<span style="font-size:13px;line-height:1;opacity:0.7">\xD7</span>';
        grpWrap.appendChild(chip);
      });
      const grpSel = document.createElement("select");
      grpSel.id = "nt-table-group";
      grpSel.style.cssText = "padding:3px 6px;border:1px solid " + theme.border + ";border-radius:" + NT_R.sm + ";font-size:12px;background:" + theme.surface + ";color:" + theme.text + ";font-family:inherit;cursor:pointer";
      const optAll = document.createElement("option");
      optAll.value = "";
      const remaining = groupNames.length - _filterGroups.size;
      optAll.textContent = _filterGroups.size > 0 ? t("table.group.add", { n: remaining }) : t("table.group.all", { n: groupNames.length });
      grpSel.appendChild(optAll);
      groupNames.forEach(function(g) {
        if (_filterGroups.has(g)) return;
        const opt = document.createElement("option");
        opt.value = g;
        opt.textContent = g;
        grpSel.appendChild(opt);
      });
      grpWrap.appendChild(grpSel);
      bar.appendChild(grpWrap);
    }
    const presetWrap = document.createElement("div");
    presetWrap.id = "nt-table-preset-wrap";
    presetWrap.style.cssText = "position:relative;display:inline-block";
    const presetBtn = document.createElement("button");
    presetBtn.type = "button";
    presetBtn.style.cssText = "padding:3px 8px;border:1px solid " + theme.border + ";border-radius:" + NT_R.sm + ";font-size:12px;background:" + theme.surface + ";color:" + theme.text + ";font-family:inherit;cursor:pointer";
    presetBtn.textContent = "Preset \u25BE";
    presetWrap.appendChild(presetBtn);
    const presetPop = document.createElement("div");
    presetPop.id = "nt-table-preset-pop";
    presetPop.style.cssText = "display:none;position:absolute;top:100%;left:0;z-index:9000;background:" + theme.surface + ";border:1px solid " + theme.border + ";border-radius:" + NT_R.sm + ";box-shadow:0 6px 20px rgba(0,0,0,0.14);min-width:200px;max-height:340px;overflow:auto;padding:4px;margin-top:4px";
    presetWrap.appendChild(presetPop);
    bar.appendChild(presetWrap);
    presetBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      const open = presetPop.style.display === "block";
      presetPop.style.display = open ? "none" : "block";
      if (!open) _rebuildPresetPop(presetPop, theme);
    });
    document.addEventListener("click", function(e) {
      if (!presetWrap.contains(e.target)) presetPop.style.display = "none";
    });
    const search = document.createElement("input");
    search.id = "nt-table-search";
    search.type = "text";
    search.placeholder = t("table.search.placeholder");
    search.title = t("table.search.help");
    search.value = _filterText;
    search.style.cssText = "padding:3px 8px;border:1px solid " + theme.border + ";border-radius:" + NT_R.sm + ";font-size:12px;width:240px;background:" + theme.inputBg + ";color:" + theme.text + ";font-family:inherit;outline:none;transition:border-color 0.12s";
    search.addEventListener("focus", function() {
      this.style.borderColor = theme.accent;
    });
    search.addEventListener("blur", function() {
      this.style.borderColor = theme.border;
    });
    bar.appendChild(search);
    const counter = document.createElement("div");
    counter.id = "nt-table-count";
    counter.style.cssText = "margin-left:auto;font-size:12px;color:" + theme.counterText + ";font-weight:600;letter-spacing:0.02em";
    bar.appendChild(counter);
    return bar;
  }
  function _diffBadgeHtml(id) {
    if (!_diff) return "";
    const sid = String(id);
    const base = "display:inline-block;width:14px;height:14px;line-height:14px;border-radius:50%;color:#fff;font-size:10px;font-weight:700;text-align:center;margin-right:5px;vertical-align:middle";
    if (_diff.new.has(sid)) {
      return '<span title="' + esc(t("table.diff.new")) + '" style="' + base + ';background:#06b6d4">+</span>';
    }
    if (_diff.up.has(sid)) {
      const ch = _diff.sevByHost.get(sid);
      const tt = ch ? "Severity: " + ch.old + " \u2192 " + ch.now : t("table.diff.worse");
      return '<span title="' + esc(tt) + '" style="' + base + ';background:#dc2626">\u2191</span>';
    }
    if (_diff.down.has(sid)) {
      const ch = _diff.sevByHost.get(sid);
      const tt = ch ? "Severity: " + ch.old + " \u2192 " + ch.now : t("table.diff.better");
      return '<span title="' + esc(tt) + '" style="' + base + ';background:#16a34a">\u2193</span>';
    }
    return "";
  }
  function rowHtml(n, baseUrl, theme) {
    const sev = n.severity || 0;
    const sevCol = SEV_COL[sev];
    const sevLbl = SEV_LBL[sev];
    const ti = TYPE_ICON2[n.type] || "\u2753";
    const tl = TYPE_LBL[n.type] || (n.type || t("table.type.unknown"));
    const grp = n._primaryGroup || "";
    const grpCol = grp ? grpColor(grp) : theme.subSoft;
    const cellPad = "padding:5px 8px";
    const cellPadR = cellPad + ";text-align:right";
    const monoFam = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
    const monoNum = "font-family:" + monoFam + ";font-variant-numeric:tabular-nums";
    const hostId = encodeURIComponent(n.id);
    const latestUrl = window.location.origin + baseUrl + "zabbix.php?action=latest.view&filter_set=1&hostids%5B%5D=" + hostId;
    const probUrl = window.location.origin + baseUrl + "zabbix.php?action=problem.view&filter_set=1&hostids%5B%5D=" + hostId;
    const chartsUrl = window.location.origin + baseUrl + "zabbix.php?action=charts.view&filter_set=1&filter_hostids%5B%5D=" + hostId;
    const editUrl = window.location.origin + baseUrl + "zabbix.php?action=popup&popup=host.edit&hostid=" + hostId;
    const tIn = n.traffic && n.traffic.in != null ? n.traffic.in : null;
    const tOut = n.traffic && n.traffic.out != null ? n.traffic.out : null;
    const trafIn = tIn != null && tIn > 0 ? fmtBps(tIn) : "\u2014";
    const trafOut = tOut != null && tOut > 0 ? fmtBps(tOut) : "\u2014";
    const actBtn = function(url, lbl, title) {
      return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" data-no-detail="1" title="' + esc(title) + '" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin:0 1px;background:' + theme.actionBg + ";border:1px solid " + theme.actionBorder + ";border-radius:" + NT_R.sm + ";text-decoration:none;color:" + theme.actionText + ';font-size:11px;line-height:1;transition:filter 0.12s">' + lbl + "</a>";
    };
    const isOff = !!n.unavailable;
    const STALE_S2 = 300;
    const _nowSec = Math.floor(Date.now() / 1e3);
    const _ageSec = n.last_seen && n.last_seen > 0 ? _nowSec - n.last_seen : 0;
    const isStale = !isOff && n.last_seen > 0 && _ageSec > STALE_S2;
    const offColor = "#9ca3af";
    const rowOpacity = isOff || isStale ? "opacity:0.55;" : "";
    const sevCellHtml = isOff ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:' + NT_R.pill + ';background:rgba(229,55,66,0.13);color:#e53742;font-size:11px;font-weight:700"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#e53742"></span>OFFLINE</span>' : isStale ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:' + NT_R.pill + ';background:rgba(245,158,11,0.13);color:#92400e;font-size:11px;font-weight:700" title="' + esc(t("table.stale_tip", { m: Math.floor(_ageSec / 60) })) + '"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#f59e0b"></span>STALE</span>' : '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:' + NT_R.pill + ";background:" + sevCol + "22;color:" + sevCol + ';font-size:11px;font-weight:700"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + sevCol + '"></span>' + esc(sevLbl) + "</span>";
    const metricColor = isOff || isStale ? offColor : theme.text;
    return '<tr data-host-id="' + esc(String(n.id)) + '" style="border-bottom:1px solid ' + theme.borderSoft + ";cursor:pointer;border-left:3px solid " + (isOff ? "#9ca3af" : sevCol) + ";transition:background 0.12s;" + rowOpacity + '"><td style="' + cellPad + '">' + _diffBadgeHtml(n.id) + sevCellHtml + '</td><td style="' + cellPad + '"><a href="' + esc(latestUrl) + '" target="_blank" rel="noopener noreferrer" data-no-detail="1" style="color:' + theme.link + ';text-decoration:none;font-weight:600;font-size:12px">' + esc(n.label || n.host || "") + '</a></td><td style="' + cellPad + ";font-size:12px;color:" + metricColor + '"><span style="margin-right:5px">' + ti + "</span>" + esc(tl) + '</td><td style="' + cellPad + '"><span style="display:inline-block;padding:1px 7px;border-radius:' + NT_R.pill + ";background:" + grpCol + "22;color:" + grpCol + ';font-size:11px;font-weight:600">' + esc(grp || "\u2014") + '</span></td><td style="' + cellPad + ";font-size:12px;color:" + metricColor + ";" + monoNum + '">' + esc(n.ip || "\u2014") + (n.iftype ? ' <span title="' + esc(proxyTooltip(n)) + '" style="color:' + theme.subSoft + ";font-size:11px;cursor:help;border-bottom:1px dotted " + theme.border + '">(' + esc(n.iftype) + ")</span>" : "") + '</td><td style="' + cellPadR + ";font-size:12px;color:" + metricColor + ";" + monoNum + '">' + fmtPct(n.cpu) + '</td><td style="' + cellPadR + ";font-size:12px;color:" + metricColor + ";" + monoNum + '">' + fmtPct(n.memory) + '</td><td style="' + cellPadR + ";font-size:12px;color:" + metricColor + ";" + monoNum + '">' + fmtMs(n.ping) + '</td><td style="' + cellPadR + ";font-size:11px;color:" + metricColor + ";" + monoNum + ';line-height:1.4;white-space:nowrap">\u2193 ' + trafIn + "<br>\u2191 " + trafOut + '</td><td style="' + cellPadR + '">' + (n.problems > 0 ? '<button type="button" data-toggle-problems="' + esc(String(n.id)) + '" data-no-detail="1" title="' + esc(t("table.expand_problems")) + '" style="display:inline-flex;align-items:center;gap:3px;padding:1px 8px;border:none;border-radius:' + NT_R.pill + ";background:" + theme.problemBg + ";color:" + theme.problemText + ';font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;transition:filter 0.12s"><span class="nt-prob-arrow" style="font-size:9px;display:inline-block;transition:transform 0.15s;line-height:1">\u25B6</span>' + n.problems + "</button>" : '<span style="color:' + theme.subSoft + ';font-size:12px">0</span>') + '</td><td style="padding:5px;text-align:right;white-space:nowrap">' + actBtn(latestUrl, "\u{1F4CA}", "Latest Data") + actBtn(probUrl, "\u26A0", t("table.problems")) + actBtn(chartsUrl, "\u{1F4C8}", "Graphs") + (window.NT_CONFIG && window.NT_CONFIG.can_edit ? actBtn(editUrl, "\u2699\uFE0F", t("table.act.edit")) : "") + "</td></tr>";
  }
  function buildTable(nodes, baseUrl, theme) {
    const cols = [
      { id: "severity", lbl: "Status", align: "left" },
      { id: "host", lbl: "Host", align: "left" },
      { id: "type", lbl: "Type", align: "left" },
      { id: "group", lbl: t("table.col.group"), align: "left" },
      { id: "ip", lbl: "IP", align: "left" },
      { id: "cpu", lbl: "CPU", align: "right" },
      { id: "memory", lbl: "Memory", align: "right" },
      { id: "ping", lbl: "Ping", align: "right" },
      { id: "traffic", lbl: "Traffic", align: "right" },
      { id: "problems", lbl: t("table.problems"), align: "right" },
      // Actions-Spalte: nicht sortierbar, deshalb data-sort weggelassen
      { id: "_actions", lbl: "", align: "right", noSort: true }
    ];
    let thead = '<thead style="position:sticky;top:0;background:' + theme.head + ';z-index:1;backdrop-filter:saturate(1.4)"><tr style="border-bottom:1px solid ' + theme.border + '">';
    cols.forEach(function(c) {
      const isActive = c.id === _sortCol;
      const arrow = isActive && !c.noSort ? _sortDir === "desc" ? " \u25BC" : " \u25B2" : "";
      const sortAttr = c.noSort ? "" : ' data-sort="' + c.id + '"';
      const cursor = c.noSort ? "default" : "pointer";
      thead += "<th" + sortAttr + ' style="padding:6px 8px;text-align:' + c.align + ";font-size:11px;font-weight:700;color:" + (isActive ? theme.textStrong : theme.sub) + ";text-transform:uppercase;letter-spacing:0.04em;cursor:" + cursor + ';user-select:none;white-space:nowrap">' + esc(c.lbl) + arrow + "</th>";
    });
    thead += "</tr></thead>";
    let tbody = "<tbody>";
    const sorted = nodes.slice().sort(compare);
    let visible = 0;
    sorted.forEach(function(n) {
      if (passesFilter(n)) {
        tbody += rowHtml(n, baseUrl, theme);
        visible++;
      }
    });
    tbody += "</tbody>";
    if (visible === 0) {
      tbody = '<tbody><tr><td colspan="' + cols.length + '" style="padding:48px;text-align:center;color:' + theme.subSoft + ';font-size:13px;font-weight:500"><div style="font-size:32px;margin-bottom:10px;opacity:0.4">\u{1F50D}</div>' + esc(t("table.no_match")) + "</td></tr></tbody>";
    }
    return {
      html: '<table style="width:100%;border-collapse:collapse;font-size:13px">' + thead + tbody + "</table>",
      visible,
      total: nodes.length
    };
  }
  function renderTable(wrap, nodes, edges) {
    if (window._ntEdgeAnim) {
      clearInterval(window._ntEdgeAnim);
      window._ntEdgeAnim = null;
    }
    if (window._ntCy) {
      try {
        window._ntCy.destroy();
      } catch (e) {
      }
      window._ntCy = null;
    }
    _renderWrap = wrap;
    _renderNodes = nodes;
    _renderEdges = edges;
    _urlSync();
    const dark = !!(document.getElementById("nt-root") && document.getElementById("nt-root").classList.contains("nt-dark"));
    const theme = mkTheme(dark);
    if (!nodes.length) {
      wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:' + theme.subSoft + ";background:" + theme.bg + '">' + esc(t("table.no_hosts")) + "</div>";
      return;
    }
    const realNodes = nodes.filter(function(n) {
      return !(n._isInternet || n.id && String(n.id).indexOf("internet_") === 0);
    });
    const cfg = window.NT_CONFIG;
    const sel = cfg && cfg.selected_group_names || [];
    realNodes.forEach(function(n) {
      const gs = n.groups || [];
      let primary = "";
      for (let i = 0; i < sel.length; i++) {
        if (gs.indexOf(sel[i]) >= 0) {
          primary = sel[i];
          break;
        }
      }
      n._primaryGroup = primary || gs[0] || "";
    });
    const groupNames = [];
    const _groupSeen = {};
    realNodes.forEach(function(n) {
      (n.groups || []).forEach(function(g) {
        if (g && !_groupSeen[g]) {
          _groupSeen[g] = true;
          groupNames.push(g);
        }
      });
    });
    groupNames.sort();
    const baseUrl = buildBaseUrl2();
    wrap.innerHTML = "";
    const root = document.createElement("div");
    root.style.cssText = "display:flex;flex-direction:column;width:100%;height:100%;background:" + theme.bg + ";overflow:hidden";
    wrap.appendChild(root);
    const filterBar = buildFilterBar(realNodes, groupNames, theme);
    root.appendChild(filterBar);
    const tableArea = document.createElement("div");
    tableArea.id = "nt-table-area";
    tableArea.style.cssText = "flex:1;overflow:auto;background:" + theme.bg;
    root.appendChild(tableArea);
    const oldPanel = document.getElementById("nt-detail-panel");
    if (oldPanel) oldPanel.remove();
    const detailPanel = document.createElement("div");
    detailPanel.id = "nt-detail-panel";
    detailPanel.style.cssText = "position:fixed;top:170px;right:20px;width:300px;background:" + theme.surface + ";border:1px solid " + theme.border + ";border-radius:10px;padding:14px;color:" + theme.text + ";box-shadow:0 8px 24px rgba(0,0,0,0.12);z-index:200;display:none;max-height:calc(100vh - 200px);overflow-y:auto";
    document.body.appendChild(detailPanel);
    function rerenderTable() {
      _urlSync();
      const snap = loadSnapshot();
      _diff = snap ? computeDiff(realNodes, snap) : null;
      const r = buildTable(realNodes, baseUrl, theme);
      tableArea.innerHTML = r.html;
      const counter = document.getElementById("nt-table-count");
      if (counter) {
        let txt = r.visible === r.total ? t("table.count.all", { n: r.total }) : t("table.count.filtered", { shown: r.visible, total: r.total });
        if (_diff) {
          const parts = [];
          if (_diff.new.size) parts.push('<span style="color:#06b6d4;font-weight:700">+' + _diff.new.size + "</span>");
          if (_diff.gone.size) parts.push('<span style="color:#94a3b8;font-weight:700">\u2212' + _diff.gone.size + "</span>");
          if (_diff.up.size) parts.push('<span style="color:#dc2626;font-weight:700">\u2191' + _diff.up.size + "</span>");
          if (_diff.down.size) parts.push('<span style="color:#16a34a;font-weight:700">\u2193' + _diff.down.size + "</span>");
          const diffTxt = parts.length ? " \xB7 " + esc(t("table.diff.since", { age: formatSnapshotAge(snap) })) + ": " + parts.join(" ") : " \xB7 " + esc(t("table.diff.since", { age: formatSnapshotAge(snap) })) + ": " + esc(t("table.diff.none"));
          counter.innerHTML = esc(txt) + '<span style="color:#94a3b8">' + diffTxt + "</span>";
        } else {
          counter.textContent = txt;
        }
      }
      wireTable();
    }
    async function renderItemsMode() {
      tableArea.innerHTML = "";
      detailPanel.style.display = "none";
      const wrapInner = document.createElement("div");
      wrapInner.style.cssText = "padding:12px 18px;background:" + theme.head + ";border-bottom:1px solid " + theme.border;
      tableArea.appendChild(wrapInner);
      const toolbar = buildPivotToolbar(function(pattern) {
        _itemsPattern = pattern;
        try {
          localStorage.setItem(NT_ITEMS_PATTERN_KEY, pattern);
        } catch (e) {
        }
        loadAndRenderItems();
      }, theme);
      wrapInner.appendChild(toolbar);
      const patIn = toolbar.querySelector("#nt-items-pattern");
      if (patIn) {
        patIn.value = _itemsPattern;
        patIn.dispatchEvent(new Event("input"));
      }
      const row2 = document.createElement("div");
      row2.style.cssText = "display:flex;align-items:center;gap:10px;margin-top:8px";
      const searchLbl = document.createElement("span");
      searchLbl.textContent = t("table.items.search_label");
      searchLbl.style.cssText = "font-size:11px;color:" + theme.sub + ";font-weight:700;text-transform:uppercase;letter-spacing:0.06em";
      row2.appendChild(searchLbl);
      const searchIn = document.createElement("input");
      searchIn.type = "text";
      searchIn.id = "nt-items-hostsearch";
      searchIn.placeholder = t("table.items.search_placeholder");
      searchIn.title = t("table.items.search_help");
      searchIn.value = _itemsSearch;
      searchIn.setAttribute("list", "nt-items-hostlist");
      searchIn.setAttribute("autocomplete", "off");
      searchIn.style.cssText = "flex:1;max-width:280px;padding:6px 10px;border:1px solid " + theme.border + ";border-radius:6px;font-size:12px;background:" + theme.inputBg + ";color:" + theme.text + ";font-family:inherit;outline:none;transition:border-color 0.15s,box-shadow 0.15s";
      searchIn.addEventListener("focus", function() {
        this.style.borderColor = theme.accent;
        this.style.boxShadow = "0 0 0 3px " + theme.accent + "22";
      });
      searchIn.addEventListener("blur", function() {
        this.style.borderColor = theme.border;
        this.style.boxShadow = "none";
      });
      row2.appendChild(searchIn);
      const hostList = document.createElement("datalist");
      hostList.id = "nt-items-hostlist";
      row2.appendChild(hostList);
      const hideEmptyBtn = document.createElement("button");
      hideEmptyBtn.type = "button";
      hideEmptyBtn.id = "nt-items-hide-empty";
      const _setHideEmptyStyle = function() {
        const active = _itemsHideEmpty;
        hideEmptyBtn.style.cssText = "padding:5px 10px;border:1px solid " + (active ? theme.accent : theme.border) + ";border-radius:6px;background:" + (active ? theme.accent + "22" : theme.surface) + ";color:" + (active ? theme.accent : theme.sub) + ";font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;letter-spacing:0.02em;transition:all 0.15s";
      };
      hideEmptyBtn.textContent = t("table.items.hide_empty");
      hideEmptyBtn.title = t("table.items.hide_empty_tip");
      _setHideEmptyStyle();
      hideEmptyBtn.addEventListener("click", function() {
        _itemsHideEmpty = !_itemsHideEmpty;
        try {
          localStorage.setItem(NT_ITEMS_HIDE_EMPTY_KEY, _itemsHideEmpty ? "1" : "0");
        } catch (e) {
        }
        _setHideEmptyStyle();
        renderPivotInto(pivotArea, counter);
      });
      row2.appendChild(hideEmptyBtn);
      const heatmapBtn = document.createElement("button");
      heatmapBtn.type = "button";
      heatmapBtn.id = "nt-items-heatmap";
      const _setHeatmapStyle = function() {
        const active = _itemsHeatmap;
        heatmapBtn.style.cssText = "padding:5px 10px;border:1px solid " + (active ? theme.accent : theme.border) + ";border-radius:6px;background:" + (active ? theme.accent + "22" : theme.surface) + ";color:" + (active ? theme.accent : theme.sub) + ";font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;letter-spacing:0.02em;transition:all 0.15s";
      };
      heatmapBtn.textContent = "Heatmap";
      heatmapBtn.title = t("table.items.heatmap_tip");
      _setHeatmapStyle();
      heatmapBtn.addEventListener("click", function() {
        _itemsHeatmap = !_itemsHeatmap;
        try {
          localStorage.setItem(NT_ITEMS_HEATMAP_KEY, _itemsHeatmap ? "1" : "0");
        } catch (e) {
        }
        _setHeatmapStyle();
        renderPivotInto(pivotArea, counter);
      });
      row2.appendChild(heatmapBtn);
      const csvBtn = document.createElement("button");
      csvBtn.type = "button";
      csvBtn.id = "nt-items-csv";
      csvBtn.textContent = "\u2B07 CSV";
      csvBtn.title = t("table.items.csv_tip");
      csvBtn.style.cssText = "padding:5px 10px;border:1px solid " + theme.border + ";border-radius:6px;background:" + theme.surface + ";color:" + theme.sub + ";font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;letter-spacing:0.02em;transition:all 0.15s";
      csvBtn.addEventListener("click", function() {
        _exportPivotCsv();
      });
      row2.appendChild(csvBtn);
      const counter = document.createElement("span");
      counter.id = "nt-items-count";
      counter.style.cssText = "font-size:11px;color:" + theme.subSoft + ";margin-left:auto;font-weight:600";
      row2.appendChild(counter);
      wrapInner.appendChild(row2);
      const pivotArea = document.createElement("div");
      pivotArea.id = "nt-items-pivot-area";
      pivotArea.style.cssText = "padding:12px";
      tableArea.appendChild(pivotArea);
      let _searchTimer = null;
      searchIn.addEventListener("input", function() {
        const v = this.value;
        if (_searchTimer) clearTimeout(_searchTimer);
        _searchTimer = setTimeout(function() {
          _itemsSearch = v;
          _itemsQuery = parseQuery(_itemsSearch);
          renderPivotInto(pivotArea, counter);
        }, 150);
      });
      let _itemsFetchSeq = 0;
      async function loadAndRenderItems() {
        pivotArea.innerHTML = '<div style="text-align:center;padding:30px;color:' + theme.subSoft + '"><span style="display:inline-block;animation:nt-spin 1.2s linear infinite">\u23F3</span> ' + esc(t("table.items.loading")) + "</div>";
        const seq = ++_itemsFetchSeq;
        const data = await fetchItemsPivot(_itemsPattern);
        if (seq !== _itemsFetchSeq) return;
        _itemsData = data;
        renderPivotInto(pivotArea, counter);
      }
      function renderPivotInto(area, counter2) {
        if (!_itemsData) return;
        const dlExpect = String(Object.keys(_itemsData.hosts || {}).length);
        if (hostList && hostList.dataset.filled !== dlExpect) {
          while (hostList.firstChild) hostList.removeChild(hostList.firstChild);
          Object.values(_itemsData.hosts || {}).forEach(function(hn) {
            if (!hn) return;
            const o = document.createElement("option");
            o.value = hn;
            hostList.appendChild(o);
          });
          hostList.dataset.filled = dlExpect;
        }
        const allIds = Object.keys(_itemsData.hosts || {});
        let visibleIds = allIds;
        if (_itemsQuery) {
          const byId = {};
          realNodes.forEach(function(n) {
            byId[String(n.id)] = n;
          });
          visibleIds = allIds.filter(function(hid) {
            const n = byId[String(hid)];
            if (n) return matchQuery(_itemsQuery, nodeToQueryFields(n));
            const hn = (_itemsData.hosts[hid] || "").toLowerCase();
            return matchQuery(_itemsQuery, { _any: hn, host: hn, label: hn });
          });
        }
        const sortHostIds = sortPivotHostIds(_itemsData, visibleIds);
        renderPivotTable(
          area,
          _itemsData,
          realNodes,
          sortHostIds,
          _itemsSortCol,
          _itemsSortDir,
          theme,
          { hideEmpty: _itemsHideEmpty, heatmap: _itemsHeatmap }
        );
        const total = allIds.length;
        const visible = visibleIds.length;
        counter2.textContent = visible === total ? t("table.items.count.all", { hosts: total, items: (_itemsData.columns || []).length }) : t("table.items.count.filtered", { shown: visible, total, items: (_itemsData.columns || []).length });
        area.querySelectorAll("th[data-sort]").forEach(function(th) {
          th.style.cursor = "pointer";
          th.style.userSelect = "none";
          th.addEventListener("click", function() {
            const col = this.dataset.sort;
            if (col === _itemsSortCol) {
              _itemsSortDir = _itemsSortDir === "desc" ? "asc" : "desc";
            } else {
              _itemsSortCol = col;
              _itemsSortDir = "desc";
            }
            renderPivotInto(area, counter2);
          });
        });
      }
      function _exportPivotCsv() {
        if (!_itemsData || !_itemsData.columns) return;
        let cols = _itemsData.columns;
        const allIds = Object.keys(_itemsData.hosts || {});
        let visibleIds = allIds;
        if (_itemsQuery) {
          const byId = {};
          realNodes.forEach(function(n) {
            byId[String(n.id)] = n;
          });
          visibleIds = allIds.filter(function(hid) {
            const n = byId[String(hid)];
            if (n) return matchQuery(_itemsQuery, nodeToQueryFields(n));
            const hn = (_itemsData.hosts[hid] || "").toLowerCase();
            return matchQuery(_itemsQuery, { _any: hn, host: hn, label: hn });
          });
        }
        let sortedIds = sortPivotHostIds(_itemsData, visibleIds);
        if (_itemsHideEmpty) {
          cols = cols.filter(function(c) {
            return sortedIds.some(function(hid) {
              const v = _itemsData.rows[hid] && _itemsData.rows[hid][c.key];
              return v != null;
            });
          });
          sortedIds = sortedIds.filter(function(hid) {
            return cols.some(function(c) {
              const v = _itemsData.rows[hid] && _itemsData.rows[hid][c.key];
              return v != null;
            });
          });
        }
        function esc2(s) {
          s = String(s == null ? "" : s);
          if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
          if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
          return s;
        }
        function fmt2(v, unit) {
          if (v == null || !isFinite(v)) return "";
          let n = Number(v);
          if (Number.isInteger(n)) return String(n);
          if (Math.abs(n) >= 100) return n.toFixed(1);
          return n.toFixed(3);
        }
        const header = ["Host"].concat(cols.map(function(c) {
          return (c.label || c.key) + (c.unit ? " (" + c.unit + ")" : "");
        })).concat(["Avg"]);
        const lines = [header.map(esc2).join(",")];
        const aggregateLocal = aggregateValues;
        sortedIds.forEach(function(hid) {
          const row = _itemsData.rows[hid] || {};
          const rowVals = [];
          const cells = cols.map(function(c) {
            const v = row[c.key];
            if (v != null) rowVals.push(v);
            return fmt2(v);
          });
          const avg = aggregateLocal(rowVals, "avg");
          const csvRow = [_itemsData.hosts[hid] || hid].concat(cells).concat([fmt2(avg)]);
          lines.push(csvRow.map(esc2).join(","));
        });
        ["Sum", "Avg", "P50", "P95", "P99", "Max"].forEach(function(lbl) {
          const mode = lbl.toLowerCase();
          const cells = cols.map(function(c) {
            const colVals = sortedIds.map(function(hid) {
              return _itemsData.rows[hid] && _itemsData.rows[hid][c.key];
            });
            return fmt2(aggregateLocal(colVals, mode));
          });
          const flat = [];
          sortedIds.forEach(function(hid) {
            cols.forEach(function(c) {
              const v = _itemsData.rows[hid] && _itemsData.rows[hid][c.key];
              if (v != null) flat.push(v);
            });
          });
          lines.push([lbl].concat(cells).concat([fmt2(aggregateLocal(flat, mode))]).map(esc2).join(","));
        });
        const csv = lines.join("\n") + "\n";
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "nt-pivot-" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() {
          URL.revokeObjectURL(url);
        }, 1e3);
      }
      function sortPivotHostIds(data, ids) {
        ids = ids.slice();
        const dir = _itemsSortDir === "desc" ? -1 : 1;
        if (!_itemsSortCol || _itemsSortCol === "__host__") {
          ids.sort(function(a, b) {
            const ha = (data.hosts[a] || "").toLowerCase();
            const hb = (data.hosts[b] || "").toLowerCase();
            return ha < hb ? -1 * dir : ha > hb ? 1 * dir : 0;
          });
        } else {
          ids.sort(function(a, b) {
            const va = data.rows[a] && data.rows[a][_itemsSortCol];
            const vb = data.rows[b] && data.rows[b][_itemsSortCol];
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
          });
        }
        return ids;
      }
      await loadAndRenderItems();
    }
    function renderCurrentMode() {
      if (_tableMode === "items") {
        renderItemsMode();
      } else {
        rerenderTable();
      }
    }
    function wireTable() {
      tableArea.querySelectorAll("th[data-sort]").forEach(function(th) {
        th.addEventListener("click", function() {
          const col = this.dataset.sort;
          if (col === _sortCol) {
            _sortDir = _sortDir === "desc" ? "asc" : "desc";
          } else {
            _sortCol = col;
            _sortDir = "desc";
          }
          rerenderTable();
        });
      });
      tableArea.querySelectorAll("tr[data-host-id]:not(.nt-prob-detail)").forEach(function(tr) {
        tr.addEventListener("mouseenter", function() {
          this.style.background = theme.hover;
        });
        tr.addEventListener("mouseleave", function() {
          this.style.background = "";
        });
        tr.addEventListener("click", function(e) {
          if (e.target && e.target.closest && e.target.closest("[data-no-detail]")) return;
          const id = this.dataset.hostId;
          const n = realNodes.find(function(x) {
            return String(x.id) === String(id);
          });
          if (!n) return;
          detailPanel.style.display = "block";
          showDetail(detailPanel, n, null);
        });
      });
      tableArea.querySelectorAll("button[data-toggle-problems]").forEach(function(btn) {
        btn.addEventListener("click", function(e) {
          e.stopPropagation();
          const id = this.dataset.toggleProblems;
          const tr = this.closest("tr");
          if (!tr) return;
          const next = tr.nextElementSibling;
          const arrow = this.querySelector(".nt-prob-arrow");
          if (next && next.classList.contains("nt-prob-detail") && next.dataset.hostId === id) {
            next.remove();
            if (arrow) arrow.style.transform = "";
            return;
          }
          const n = realNodes.find(function(x) {
            return String(x.id) === String(id);
          });
          if (!n) return;
          const tbl = tr.closest("table");
          const colspan = tbl ? tbl.querySelectorAll("thead th").length : 11;
          tr.insertAdjacentHTML("afterend", buildProblemDetailRow(n, colspan, theme));
          if (arrow) arrow.style.transform = "rotate(90deg)";
        });
      });
    }
    filterBar.querySelectorAll("button[data-sev]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        const sev = parseInt(this.dataset.sev, 10);
        if (_filterStatuses.has(sev)) _filterStatuses.delete(sev);
        else _filterStatuses.add(sev);
        const active = _filterStatuses.has(sev);
        this.style.borderColor = active ? SEV_COL[sev] : theme.border;
        this.style.background = active ? SEV_COL[sev] + "22" : theme.surface;
        this.style.color = active ? SEV_COL[sev] : theme.subSoft;
        rerenderTable();
      });
    });
    const offBtnRef = document.getElementById("nt-table-offline-only");
    if (offBtnRef) {
      offBtnRef.addEventListener("click", function() {
        _filterOfflineOnly = !_filterOfflineOnly;
        renderTable(wrap, nodes, edges);
      });
    }
    const grpSel = document.getElementById("nt-table-group");
    if (grpSel) {
      grpSel.addEventListener("change", function() {
        if (!this.value) return;
        _filterGroups.add(this.value);
        renderTable(wrap, nodes, edges);
      });
    }
    filterBar.querySelectorAll("button[data-remove-group]").forEach(function(chip) {
      chip.addEventListener("click", function() {
        _filterGroups.delete(this.dataset.removeGroup);
        renderTable(wrap, nodes, edges);
      });
    });
    const search = document.getElementById("nt-table-search");
    if (search) {
      let _searchTimer = null;
      search.addEventListener("input", function() {
        const v = this.value;
        if (_searchTimer) clearTimeout(_searchTimer);
        _searchTimer = setTimeout(function() {
          _filterText = v;
          _reparseTokens();
          rerenderTable();
        }, 150);
      });
    }
    filterBar.querySelectorAll("button[data-mode]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        const newMode = this.dataset.mode;
        if (newMode === _tableMode) return;
        _tableMode = newMode;
        try {
          localStorage.setItem(NT_TABLE_MODE_KEY, newMode);
        } catch (e) {
        }
        renderTable(wrap, nodes, edges);
      });
    });
    renderCurrentMode();
  }
  function cleanupTable() {
    const dp = document.getElementById("nt-detail-panel");
    if (dp && dp.parentNode === document.body) dp.parentNode.removeChild(dp);
  }

  // assets/js/modules/minimap.js
  var _el = null;
  var _timer = null;
  var MM_W = 180;
  var MM_H = 120;
  var PAD = 8;
  var SEV_COLORS = ["#22c55e", "#06b6d4", "#f59e0b", "#f97316", "#ef4444", "#991b1b"];
  function setupMinimap(cy, wrap) {
    const isFirstInit = !_el;
    if (isFirstInit) {
      _el = document.createElement("div");
      _el.id = "nt-minimap";
      _el.style.cssText = [
        "position:absolute;bottom:16px;right:16px",
        "width:" + MM_W + "px;height:" + MM_H + "px",
        "background:rgba(255,255,255,0.92)",
        "border:1px solid #e2e8f0",
        "border-radius:8px",
        "box-shadow:0 2px 8px rgba(0,0,0,0.12)",
        "overflow:hidden;cursor:pointer",
        "z-index:40",
        "backdrop-filter:blur(4px)"
      ].join(";");
      _el.title = t("minimap.tip");
      wrap.appendChild(_el);
    } else if (_el.parentNode !== wrap) {
      wrap.appendChild(_el);
    }
    function drawMinimap() {
      if (!window._ntCy || !_el) return;
      const visNodes = [];
      cy.nodes("[!isGroup]").forEach(function(n) {
        if (n.style("display") === "none") return;
        const p = n.position();
        if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
        visNodes.push({ x: p.x, y: p.y, sev: n.data("severity") || 0 });
      });
      if (!visNodes.length) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      visNodes.forEach(function(n) {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
      });
      const rangeX = Math.max(maxX - minX, 1);
      const rangeY = Math.max(maxY - minY, 1);
      const scale = Math.min((MM_W - PAD * 2) / rangeX, (MM_H - PAD * 2) / rangeY);
      function tx(x) {
        return PAD + (x - minX) * scale;
      }
      function ty(y) {
        return PAD + (y - minY) * scale;
      }
      const ext = cy.extent();
      let vpX1 = isFinite(ext.x1) ? tx(ext.x1) : 0;
      let vpY1 = isFinite(ext.y1) ? ty(ext.y1) : 0;
      let vpX2 = isFinite(ext.x2) ? tx(ext.x2) : MM_W;
      let vpY2 = isFinite(ext.y2) ? ty(ext.y2) : MM_H;
      vpX1 = Math.max(0, Math.min(MM_W, vpX1));
      vpY1 = Math.max(0, Math.min(MM_H, vpY1));
      vpX2 = Math.max(vpX1 + 4, Math.min(MM_W, vpX2));
      vpY2 = Math.max(vpY1 + 4, Math.min(MM_H, vpY2));
      const dots = visNodes.map(function(n) {
        const col = SEV_COLORS[Math.min(n.sev, SEV_COLORS.length - 1)];
        return '<circle cx="' + tx(n.x).toFixed(1) + '" cy="' + ty(n.y).toFixed(1) + '" r="3" fill="' + col + '" opacity="0.85"/>';
      }).join("");
      const vpRect = '<rect x="' + vpX1.toFixed(1) + '" y="' + vpY1.toFixed(1) + '" width="' + (vpX2 - vpX1).toFixed(1) + '" height="' + (vpY2 - vpY1).toFixed(1) + '" fill="rgba(59,130,246,0.08)" stroke="#3b82f6" stroke-width="1.5" rx="2"/>';
      const dark = document.getElementById("nt-root") && document.getElementById("nt-root").classList.contains("nt-dark");
      _el.style.background = dark ? "rgba(22,27,34,0.95)" : "rgba(255,255,255,0.95)";
      _el.innerHTML = '<svg width="' + MM_W + '" height="' + MM_H + '" xmlns="http://www.w3.org/2000/svg">' + dots + vpRect + "</svg>";
    }
    if (isFirstInit) {
      _el.addEventListener("click", function(e) {
        const cyRef = window._ntCy;
        if (!cyRef || cyRef.destroyed && cyRef.destroyed()) return;
        const rect = _el.getBoundingClientRect();
        const relX = e.clientX - rect.left;
        const relY = e.clientY - rect.top;
        const visNodes = [];
        cyRef.nodes("[!isGroup]").forEach(function(n) {
          if (n.style("display") !== "none") visNodes.push(n.position());
        });
        if (!visNodes.length) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        visNodes.forEach(function(p) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        });
        const scale = Math.min(
          (MM_W - PAD * 2) / Math.max(maxX - minX, 1),
          (MM_H - PAD * 2) / Math.max(maxY - minY, 1)
        );
        const worldX = minX + (relX - PAD) / scale;
        const worldY = minY + (relY - PAD) / scale;
        const w = _el.parentNode || wrap;
        cyRef.animate(
          { pan: { x: w.clientWidth / 2 - worldX * cyRef.zoom(), y: w.clientHeight / 2 - worldY * cyRef.zoom() } },
          { duration: 200 }
        );
      });
    }
    cy.on("zoom pan", function() {
      clearTimeout(_timer);
      _timer = setTimeout(drawMinimap, 80);
    });
    setTimeout(drawMinimap, 1e3);
    if (window._ntMinimapTimer) clearInterval(window._ntMinimapTimer);
    window._ntMinimapTimer = setInterval(drawMinimap, 5e3);
  }
  function showMinimap() {
    if (_el) _el.style.display = "";
  }
  function hideMinimap() {
    if (_el) _el.style.display = "none";
    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }
  }

  // assets/js/modules/render-mgmt.js
  var MGMT_LEVEL = {
    firewall: 0,
    router: 1,
    switch: 2,
    wireless: 3,
    hypervisor: 4,
    linux: 4,
    windows: 4,
    macos: 4,
    webserver: 4,
    container: 4,
    mailserver: 4,
    server: 4,
    storage: 5,
    homeauto: 6,
    monitoring: 6,
    ups: 7,
    camera: 7,
    printer: 7
  };
  var MGMT_LEVEL_NAMES = {
    0: "Firewall / Gateway",
    1: "Router",
    2: "Switch",
    3: "Wireless",
    4: t("mgmt.level.server"),
    5: "Storage / NAS",
    6: t("mgmt.level.homeauto"),
    7: t("mgmt.level.devices")
  };
  function mgmtSevStyle(sev) {
    const colors = ["#22c55e", "#06b6d4", "#f59e0b", "#f97316", "#ef4444", "#991b1b"];
    const labels = ["OK", "Info", "Warn", "Avg", "High", t("mgmt.sev.crit")];
    const c = colors[Math.min(sev || 0, colors.length - 1)];
    const l = labels[Math.min(sev || 0, labels.length - 1)];
    return { color: c, label: l };
  }
  function renderManagement(wrap, nodes, edges) {
    if (window._ntCy) {
      try {
        window._ntCy.destroy();
      } catch (e) {
      }
      window._ntCy = null;
    }
    if (window._ntEdgeAnim) {
      clearInterval(window._ntEdgeAnim);
      window._ntEdgeAnim = null;
    }
    if (window._ntRefreshTimer) {
      clearInterval(window._ntRefreshTimer);
      window._ntRefreshTimer = null;
    }
    if (window._ntMinimapTimer) {
      clearInterval(window._ntMinimapTimer);
      window._ntMinimapTimer = null;
    }
    window._ntToolbarDone = false;
    hideMinimap();
    Array.from(wrap.children).forEach(function(ch) {
      if (ch.id !== "nt-loading") wrap.removeChild(ch);
    });
    const dark = !!(document.getElementById("nt-root") && document.getElementById("nt-root").classList.contains("nt-dark"));
    const bg = dark ? "#0d1117" : "#f0f2f5";
    const card = dark ? "#161b22" : "#ffffff";
    const text = dark ? "#e6edf3" : "#1e293b";
    const sub = dark ? "#8b949e" : "#64748b";
    const bdr = dark ? "#30363d" : "#e2e8f0";
    const container = document.createElement("div");
    container.style.cssText = "width:100%;height:100%;overflow-y:auto;overflow-x:hidden;padding:24px 20px;box-sizing:border-box;background:" + bg;
    const levels = {};
    const levelMaxSev = {};
    nodes.forEach(function(n) {
      const lvl = MGMT_LEVEL[n.type] !== void 0 ? MGMT_LEVEL[n.type] : 4;
      if (!levels[lvl]) levels[lvl] = [];
      levels[lvl].push(n);
      const sev = n.severity || 0;
      if (sev > (levelMaxSev[lvl] || 0)) levelMaxSev[lvl] = sev;
    });
    const sortedLevels = Object.keys(levels).map(Number).sort(function(a, b) {
      const sb = levelMaxSev[b] || 0, sa = levelMaxSev[a] || 0;
      if (sb !== sa) return sb - sa;
      return a - b;
    });
    const sevCounts = [0, 0, 0, 0, 0, 0];
    let maintCount = 0, ackCount = 0, offCount = 0;
    nodes.forEach(function(n) {
      const s = n.severity || 0;
      if (s >= 0 && s <= 5) sevCounts[s]++;
      if (n.maintenance) maintCount++;
      if (n.acknowledged) ackCount++;
      if (n.unavailable) offCount++;
    });
    const totalHosts = nodes.length;
    const problemHosts = totalHosts - sevCounts[0];
    const statsBar = document.createElement("div");
    statsBar.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 14px;margin-bottom:18px;background:" + card + ";border:1px solid " + bdr + ";border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,0.04)";
    const _statBlocks = [];
    function addStat(label, value, color) {
      const wrap2 = document.createElement("div");
      wrap2.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;padding:2px 12px;border-right:1px solid " + bdr;
      const v = document.createElement("div");
      v.style.cssText = "font-size:18px;font-weight:700;line-height:1.1;color:" + (color || text);
      v.textContent = String(value);
      const l = document.createElement("div");
      l.style.cssText = "font-size:10px;font-weight:600;color:" + sub + ";text-transform:uppercase;letter-spacing:0.05em;margin-top:2px";
      l.textContent = label;
      wrap2.appendChild(v);
      wrap2.appendChild(l);
      statsBar.appendChild(wrap2);
      _statBlocks.push(wrap2);
    }
    addStat("Hosts", totalHosts, text);
    addStat(t("mgmt.stat.problems"), problemHosts, problemHosts > 0 ? "#dc2626" : text);
    if (offCount > 0) addStat("Offline", offCount, "#e53742");
    if (maintCount > 0) addStat(t("mgmt.stat.maintenance"), maintCount, "#92400e");
    if (ackCount > 0) addStat(t("mgmt.stat.acked"), ackCount, "#16a34a");
    if (_statBlocks.length > 0) {
      _statBlocks[_statBlocks.length - 1].style.borderRight = "none";
    }
    const sevColors = ["#22c55e", "#06b6d4", "#f59e0b", "#f97316", "#ef4444", "#991b1b"];
    const sevLabels = ["OK", "Info", "Warn", "Avg", "High", t("mgmt.sev.crit")];
    const pills = document.createElement("div");
    pills.style.cssText = "display:flex;align-items:center;gap:6px;padding:0 8px;margin-left:auto;flex-wrap:wrap";
    for (let s = 5; s >= 1; s--) {
      if (!sevCounts[s]) continue;
      const pill = document.createElement("span");
      pill.style.cssText = "display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:11px;background:" + sevColors[s] + "22;color:" + sevColors[s] + ";font-size:11px;font-weight:700";
      pill.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + sevColors[s] + '"></span>' + sevLabels[s] + " " + sevCounts[s];
      pills.appendChild(pill);
    }
    if (pills.children.length > 0) statsBar.appendChild(pills);
    container.appendChild(statsBar);
    const _mgmtNotes = loadNotes();
    sortedLevels.forEach(function(lvl) {
      const lvlNodes = levels[lvl];
      const header = document.createElement("div");
      header.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid " + bdr + ";margin-top:" + (lvl === sortedLevels[0] ? "0" : "24px");
      const hLbl = document.createElement("span");
      hLbl.style.cssText = "font-size:11px;font-weight:700;color:" + sub + ";text-transform:uppercase;letter-spacing:0.08em";
      hLbl.textContent = MGMT_LEVEL_NAMES[lvl] || t("mgmt.level.generic", { n: lvl });
      header.appendChild(hLbl);
      const hCount = document.createElement("span");
      hCount.style.cssText = "font-size:10px;font-weight:700;color:" + sub + ";background:" + (dark ? "#21262d" : "#eef2f6") + ";border-radius:9px;padding:1px 8px";
      hCount.textContent = String(lvlNodes.length);
      header.appendChild(hCount);
      const wsev = levelMaxSev[lvl] || 0;
      if (wsev > 0) {
        const wdot = document.createElement("span");
        wdot.style.cssText = "width:7px;height:7px;border-radius:50%;flex-shrink:0;background:" + sevColors[wsev];
        wdot.title = mgmtSevStyle(wsev).label;
        header.appendChild(wdot);
      }
      container.appendChild(header);
      const row = document.createElement("div");
      row.style.cssText = "display:flex;flex-wrap:wrap;gap:12px;margin-bottom:4px";
      lvlNodes.sort(function(a, b) {
        return (b.severity || 0) - (a.severity || 0) || (a.label || "").localeCompare(b.label || "");
      });
      lvlNodes.forEach(function(n) {
        const sev = mgmtSevStyle(n.severity);
        const noteText = _mgmtNotes[String(n.id)] || "";
        const problems = n.problems || 0;
        const isOff = !!n.unavailable;
        const accentColor = isOff ? "#9ca3af" : sev.color;
        const tile = document.createElement("div");
        const ackShadow = n.acknowledged ? "0 0 0 2px #22c55e, " : "";
        tile.style.cssText = [
          "width:190px;min-height:80px;background:" + card,
          "border:1px solid " + bdr,
          "border-left:4px solid " + accentColor,
          "border-radius:8px;padding:11px 14px",
          "cursor:pointer;position:relative",
          "box-shadow:" + ackShadow + "0 1px 4px rgba(0,0,0,0.07)",
          "transition:box-shadow 0.15s,transform 0.15s",
          "box-sizing:border-box",
          isOff ? "opacity:0.6" : n.maintenance ? "opacity:0.75" : ""
        ].filter(Boolean).join(";");
        const topRow = document.createElement("div");
        topRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:6px";
        const pillColor = isOff ? "#e53742" : sev.color;
        const sevPill = document.createElement("span");
        sevPill.style.cssText = "display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:" + pillColor + "1a;color:" + pillColor;
        sevPill.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;flex-shrink:0;background:' + pillColor + '"></span>' + (isOff ? "OFFLINE" : sev.label);
        topRow.appendChild(sevPill);
        if (n.maintenance) {
          const mb = document.createElement("span");
          mb.title = t("mgmt.tile.maintenance");
          mb.style.cssText = "background:#fef3c7;color:#92400e;border-radius:8px;font-size:9px;font-weight:600;padding:1px 5px";
          mb.textContent = "\u{1F527}";
          topRow.appendChild(mb);
        }
        if (n.acknowledged) {
          const ab = document.createElement("span");
          ab.title = t("mgmt.tile.acked");
          ab.style.cssText = "background:#dcfce7;color:#166534;border-radius:8px;font-size:9px;font-weight:600;padding:1px 5px";
          ab.textContent = "\u2714";
          topRow.appendChild(ab);
        }
        if (problems > 0) {
          const badge = document.createElement("span");
          badge.style.cssText = "margin-left:auto;background:#ef4444;color:#fff;border-radius:10px;font-size:9px;font-weight:700;padding:1px 5px;flex-shrink:0";
          badge.textContent = problems > 99 ? "99+" : String(problems);
          topRow.appendChild(badge);
        }
        tile.appendChild(topRow);
        const name = document.createElement("div");
        name.style.cssText = "font-size:13px;font-weight:600;color:" + text + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
        name.title = n.label;
        name.textContent = n.label;
        tile.appendChild(name);
        if (n.ip) {
          const ip = document.createElement("div");
          ip.style.cssText = "font-size:10px;color:" + sub + ";margin-top:2px";
          ip.textContent = n.ip;
          tile.appendChild(ip);
        }
        if (n.cpu != null || n.memory != null) {
          let metricSpan = function(lbl, val) {
            const v = +val;
            const col = v >= 90 ? "#ef4444" : v >= 75 ? "#f59e0b" : sub;
            const w = v >= 75 ? ";font-weight:600" : "";
            return '<span style="color:' + col + w + '">' + lbl + " " + val + "%</span>";
          };
          const metrics = document.createElement("div");
          metrics.style.cssText = "display:flex;gap:8px;margin-top:6px;font-size:10px;color:" + sub;
          if (n.cpu != null) metrics.innerHTML += metricSpan("CPU", n.cpu);
          if (n.memory != null) metrics.innerHTML += metricSpan("RAM", n.memory);
          tile.appendChild(metrics);
        }
        if (noteText) {
          const noteEl = document.createElement("div");
          noteEl.style.cssText = "font-size:10px;color:#f59e0b;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
          noteEl.title = noteText;
          noteEl.textContent = "Note: " + noteText;
          tile.appendChild(noteEl);
        }
        tile.addEventListener("mouseenter", function() {
          tile.style.boxShadow = "0 4px 16px rgba(0,0,0,0.12)";
          tile.style.transform = "translateY(-2px)";
        });
        tile.addEventListener("mouseleave", function() {
          tile.style.boxShadow = "0 1px 4px rgba(0,0,0,0.07)";
          tile.style.transform = "";
        });
        tile.addEventListener("contextmenu", function(e) {
          e.preventDefault();
          showCtx(e.clientX, e.clientY, n);
        });
        tile.addEventListener("click", function() {
          const pnl = document.getElementById("nt-detail");
          if (pnl) showDetail(pnl, n, {
            getElementById: function() {
              return {
                data: function() {
                  return {};
                },
                connectedEdges: function() {
                  return { forEach: function() {
                  } };
                }
              };
            }
          });
        });
        row.appendChild(tile);
      });
      container.appendChild(row);
    });
    wrap.appendChild(container);
  }

  // assets/js/modules/aggregation.js
  function aggregateByGroup(nodes, edges) {
    const groups = {};
    nodes.forEach(function(n) {
      const g = n._primaryGroup || t("agg.no_group");
      if (!groups[g]) groups[g] = [];
      groups[g].push(n);
    });
    const aggNodes = [];
    const nodeToGroup = {};
    Object.keys(groups).forEach(function(gname) {
      const children = groups[gname];
      children.forEach(function(c) {
        nodeToGroup[String(c.id)] = gname;
      });
      let maxSev = 0, sumProblems = 0;
      let cpuSum = 0, cpuCnt = 0, memSum = 0, memCnt = 0, pingMin = null;
      let trIn = 0, trOut = 0;
      let allAcked = true;
      let anyProblems = false;
      let allMaintenance = true;
      const topProblems = [];
      children.forEach(function(c) {
        const s = c.severity || 0;
        if (s > maxSev) maxSev = s;
        sumProblems += c.problems || 0;
        if (c.cpu != null && !isNaN(c.cpu)) {
          cpuSum += c.cpu;
          cpuCnt++;
        }
        if (c.memory != null && !isNaN(c.memory)) {
          memSum += c.memory;
          memCnt++;
        }
        if (c.ping != null && c.ping > 0) {
          if (pingMin === null || c.ping < pingMin) pingMin = c.ping;
        }
        if (c.traffic) {
          trIn += c.traffic.in || 0;
          trOut += c.traffic.out || 0;
        }
        if ((c.problems || 0) > 0) {
          anyProblems = true;
          if (!c.acknowledged) allAcked = false;
        }
        if (!c.maintenance) allMaintenance = false;
        if (s >= 3) topProblems.push({ label: c.label || c.host || c.id, sev: s });
      });
      topProblems.sort(function(a, b) {
        return b.sev - a.sev;
      });
      aggNodes.push({
        id: "grp_" + gname,
        label: gname + " (" + children.length + ")",
        host: gname,
        ip: null,
        type: "group",
        iftype: null,
        severity: maxSev,
        problems: sumProblems,
        acknowledged: anyProblems && allAcked,
        maintenance: allMaintenance,
        cpu: cpuCnt ? Math.round(cpuSum / cpuCnt) : null,
        memory: memCnt ? Math.round(memSum / memCnt) : null,
        ping: pingMin,
        traffic: { in: trIn, out: trOut },
        groups: [gname],
        _primaryGroup: gname,
        _isAggregate: true,
        _childCount: children.length,
        _topProblems: topProblems.slice(0, 3)
      });
    });
    const aggEdgeMap = {};
    edges.forEach(function(e) {
      const src = String(e.source || e.from || "");
      const tgt = String(e.target || e.to || "");
      const srcGroup = nodeToGroup[src];
      const tgtGroup = nodeToGroup[tgt];
      if (!srcGroup || !tgtGroup || srcGroup === tgtGroup) return;
      const key = [srcGroup, tgtGroup].sort().join("|");
      if (!aggEdgeMap[key]) {
        aggEdgeMap[key] = {
          source: "grp_" + srcGroup,
          target: "grp_" + tgtGroup,
          count: 0
        };
      }
      aggEdgeMap[key].count++;
    });
    const aggEdges = Object.keys(aggEdgeMap).map(function(k) {
      return aggEdgeMap[k];
    });
    return { nodes: aggNodes, edges: aggEdges };
  }

  // assets/js/modules/root-cause.js
  var _active2 = false;
  function isRootCauseActive() {
    return _active2;
  }
  function clearRootCause(cy) {
    _active2 = false;
    if (cy && !(cy.destroyed && cy.destroyed())) {
      cy.elements().removeClass("nt-rc-cause nt-rc-victim");
    }
    _removeBanner2();
  }
  function toggleRootCause(cy) {
    if (_active2) clearRootCause(cy);
    else runRootCause(cy, true);
  }
  function runRootCause(cy, verbose) {
    if (!cy || cy.destroyed && cy.destroyed()) return;
    const wasActive = _active2;
    clearRootCause(cy);
    const down = /* @__PURE__ */ new Set();
    cy.nodes("[!isGroup]").forEach(function(n) {
      if (n.data("_isInternet")) return;
      if (n.data("unavailable")) down.add(n.id());
    });
    if (down.size === 0) {
      if (verbose || wasActive) toast(t("rc.none"), "info");
      return;
    }
    let roots = findRoots(cy, false);
    if (roots.length === 0) {
      roots = highestDegree(cy, false);
      if (!roots) return;
    }
    const baseline = reachable(cy, roots, null);
    const alive = reachable(cy, roots, down);
    const rootIds = {};
    roots.forEach(function(r) {
      rootIds[r.id()] = true;
    });
    const causes = {};
    cy.nodes("[!isGroup]").forEach(function(n) {
      const id = n.id();
      if (!down.has(id) || !baseline[id]) return;
      let frontier = !!rootIds[id];
      if (!frontier) {
        n.connectedEdges().forEach(function(e) {
          const nb = e.source().id() === id ? e.target().id() : e.source().id();
          if (alive[nb]) frontier = true;
        });
      }
      if (frontier) causes[id] = true;
    });
    const deadZone = {};
    cy.nodes("[!isGroup]").forEach(function(n) {
      const id = n.id();
      if (baseline[id] && !alive[id]) deadZone[id] = true;
    });
    const compOf = {};
    const comps = [];
    Object.keys(deadZone).forEach(function(start) {
      if (compOf[start] !== void 0) return;
      const ci = comps.length;
      const comp = { causes: [], victims: [], problems: 0 };
      comps.push(comp);
      compOf[start] = ci;
      const q = [start];
      while (q.length) {
        const cur = q.shift();
        const node = cy.getElementById(cur);
        if (causes[cur]) {
          comp.causes.push(cur);
        } else if (down.has(cur)) {
          comp.victims.push(cur);
          comp.problems += node.data("problems") || 0;
        }
        node.connectedEdges().forEach(function(e) {
          const nb = e.source().id() === cur ? e.target().id() : e.source().id();
          if (deadZone[nb] && compOf[nb] === void 0) {
            compOf[nb] = ci;
            q.push(nb);
          }
        });
      }
    });
    let nCauses = 0, nVictims = 0, nProblems = 0;
    comps.forEach(function(c) {
      nCauses += c.causes.length;
      nVictims += c.victims.length;
      nProblems += c.problems;
      c.causes.forEach(function(id) {
        cy.getElementById(id).addClass("nt-rc-cause");
      });
      c.victims.forEach(function(id) {
        cy.getElementById(id).addClass("nt-rc-victim");
      });
    });
    _active2 = true;
    if (verbose) {
      const list = [];
      comps.forEach(function(c) {
        c.causes.forEach(function(id) {
          list.push({ id, victims: c.victims.length });
        });
      });
      list.sort(function(a, b) {
        return b.victims - a.victims;
      });
      list.slice(0, 3).forEach(function(e) {
        if (e.victims === 0) return;
        const n = cy.getElementById(e.id);
        toast(t("rc.cause_toast", { host: n.data("label") || e.id, n: e.victims }), "warn");
      });
    }
    _showBanner2(cy, nCauses, nVictims, nProblems);
  }
  function _removeBanner2() {
    const b = document.getElementById("nt-rc-banner");
    if (b) b.remove();
  }
  function _showBanner2(cy, causes, victims, problems) {
    _removeBanner2();
    const wrap = document.getElementById("nt-canvas-wrap");
    if (!wrap) return;
    const top = document.getElementById("nt-whatif-banner") ? 52 : 12;
    const banner = document.createElement("div");
    banner.id = "nt-rc-banner";
    banner.style.cssText = "position:absolute;top:" + top + "px;left:50%;transform:translateX(-50%);z-index:59;background:#7f1d1d;color:#fff;padding:7px 14px;border-radius:6px;font-size:12px;font-family:sans-serif;display:flex;align-items:center;gap:12px;box-shadow:0 4px 16px rgba(0,0,0,0.3)";
    const txt = document.createElement("span");
    txt.textContent = t("rc.banner", { causes, victims, problems });
    banner.appendChild(txt);
    const btn = document.createElement("button");
    btn.textContent = t("rc.end");
    btn.style.cssText = "background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.4);color:#fff;border-radius:4px;padding:2px 10px;font-size:11px;cursor:pointer;font-family:inherit";
    btn.addEventListener("click", function() {
      clearRootCause(cy);
    });
    banner.appendChild(btn);
    wrap.appendChild(banner);
  }

  // assets/js/modules/port-labels.js
  var _on = false;
  try {
    _on = localStorage.getItem(NT_PORTLABELS_KEY) === "1";
  } catch (e) {
  }
  function portLabelsOn() {
    return _on;
  }
  function setPortLabels(v) {
    _on = !!v;
    try {
      localStorage.setItem(NT_PORTLABELS_KEY, _on ? "1" : "0");
    } catch (e) {
    }
  }
  function applyPortLabels(cy) {
    if (!cy || cy.destroyed && cy.destroyed()) return;
    cy.edges().forEach(function(e) {
      if (e.data("_isInternetEdge")) return;
      const ps = e.data("portSrc") || "";
      const pt = e.data("portTgt") || "";
      if (_on && ps) e.style("source-label", ps);
      else e.removeStyle("source-label");
      if (_on && pt) e.style("target-label", pt);
      else e.removeStyle("target-label");
    });
  }

  // assets/js/modules/topo-notify.js
  function notifyTopoChanges(tc) {
    if (!tc) return;
    const added = tc.added || [];
    const removed = tc.removed || [];
    const events = [];
    added.forEach(function(x) {
      events.push({ key: "topo.added", x, level: "info" });
    });
    removed.forEach(function(x) {
      events.push({ key: "topo.removed", x, level: "warn" });
    });
    if (!events.length) return;
    events.slice(0, 4).forEach(function(ev) {
      toast(t(ev.key, { a: ev.x.a || "?", b: ev.x.b || "?" }), ev.level, 8e3);
    });
    if (events.length > 4) {
      toast("+" + (events.length - 4) + " \u2026", "info", 8e3);
    }
  }

  // assets/js/modules/tooltip.js
  var _tip = document.createElement("div");
  _tip.id = "nt-ring-tip";
  _tip.style.cssText = "display:none;position:fixed;z-index:99998;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.12);padding:10px 14px;font-size:12px;font-family:sans-serif;pointer-events:none;min-width:160px;";
  document.body.appendChild(_tip);
  var _sparkCache = {};
  var _sparkPending = {};
  function fetchSparkData(hostid, d, onDone) {
    const now = Date.now();
    const cached = _sparkCache[hostid];
    if (cached && now - cached.ts < 6e4) {
      onDone(cached);
      return;
    }
    if (_sparkPending[hostid]) return;
    _sparkPending[hostid] = true;
    const cfg = window.NT_CONFIG;
    if (!cfg || !cfg.data_url) {
      delete _sparkPending[hostid];
      return;
    }
    const sparkUrl = cfg.data_url.replace("network.topology.v6.data", "network.topology.v6.spark") + "&hostids%5B%5D=" + encodeURIComponent(hostid);
    fetch(sparkUrl, { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } }).then(function(r) {
      return r.json();
    }).then(function(data) {
      const h = data[String(hostid)] || {};
      const result = {
        cpu: h.cpu || [],
        ping: h.ping || [],
        since: h.since || null,
        ts: now
      };
      _sparkCache[hostid] = result;
      delete _sparkPending[hostid];
      onDone(result);
    }).catch(function() {
      const result = {
        cpu: d && d.cpu != null ? Array(12).fill(d.cpu || 0) : [],
        ping: d && d.ping != null ? Array(12).fill(d.ping || 0) : [],
        since: null,
        ts: now
      };
      _sparkCache[hostid] = result;
      delete _sparkPending[hostid];
      onDone(result);
    });
  }
  function drawSparkline(values, color, width, height) {
    if (!values || !values.length) return "";
    const w = width || 80, h = height || 24;
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const range = Math.max(max - min, 1);
    const step = w / (values.length - 1 || 1);
    const pts = values.map(function(v, i) {
      return (i * step).toFixed(1) + "," + (h - ((v - min) / range * (h - 2) + 1)).toFixed(1);
    }).join(" ");
    return '<svg width="' + w + '" height="' + h + '" style="vertical-align:middle;flex-shrink:0"><polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="' + (values.length - 1) * step + '" cy="' + (h - ((values[values.length - 1] - min) / range * (h - 2) + 1)).toFixed(1) + '" r="2" fill="' + color + '"/></svg>';
  }
  function showTip(evt, d) {
    const traffic = d.traffic || { in: 0, out: 0 };
    function bar(pct) {
      const filled = Math.round((pct || 0) / 100 * 8);
      return '<span style="color:#334155;font-family:monospace">' + "\u2588".repeat(Math.max(0, filled)) + '<span style="opacity:0.2">' + "\u2588".repeat(Math.max(0, 8 - filled)) + "</span></span>";
    }
    const rows = [
      { col: "#3b82f6", lbl: "CPU", val: d.cpu != null ? bar(d.cpu) + " <b>" + d.cpu + "%</b>" : '<span style="color:#94a3b8">\u2014</span>' },
      { col: "#8b5cf6", lbl: "Memory", val: d.memory != null ? bar(d.memory) + " <b>" + d.memory + "%</b>" : '<span style="color:#94a3b8">\u2014</span>' },
      { col: "#22c55e", lbl: "Traffic", val: "<b>\u2193 " + fmt(traffic.in) + "</b>  <b>\u2191 " + fmt(traffic.out) + "</b>" },
      { col: "#f59e0b", lbl: "Ping", val: d.ping > 0 ? "<b>" + d.ping + " ms</b>" : '<span style="color:#94a3b8">\u2014</span>' }
    ];
    function buildHtml(spark) {
      const sparkCpu = spark ? drawSparkline(spark.cpu, "#3b82f6", 72, 22) : "";
      const sparkPing = spark ? drawSparkline(spark.ping, "#f59e0b", 72, 22) : "";
      const ipLine = d.ip ? '<div style="font-size:10px;color:#64748b;font-family:monospace;margin-top:2px">&#128279; ' + esc(d.ip) + "</div>" : "";
      const pills = [];
      if (d.maintenance) pills.push('<span style="display:inline-block;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;margin-right:4px">\u{1F527} ' + esc(t("tip.maintenance")) + "</span>");
      if (d.acknowledged) pills.push('<span style="display:inline-block;background:#dcfce7;color:#166534;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;margin-right:4px">\u2714 Acked</span>');
      const pillLine = pills.length ? '<div style="margin-top:3px">' + pills.join("") + "</div>" : "";
      return '<div style="font-weight:700;font-size:11px;color:#0f172a;margin-bottom:7px;padding-bottom:5px;border-bottom:1px solid #f1f5f9">' + esc(d.label) + ipLine + pillLine + "</div>" + rows.map(function(r, i) {
        let sparkEl = "";
        if (spark) {
          if (i === 0 && sparkCpu) sparkEl = '<span style="margin-left:auto">' + sparkCpu + "</span>";
          if (i === 3 && sparkPing) sparkEl = '<span style="margin-left:auto">' + sparkPing + "</span>";
        }
        return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="width:8px;height:8px;border-radius:50%;background:' + r.col + ';flex-shrink:0;display:inline-block"></span><span style="color:#64748b;width:48px;flex-shrink:0">' + r.lbl + '</span><span style="flex:1">' + r.val + "</span>" + sparkEl + "</div>";
      }).join("") + (d.extra_items && d.extra_items.length ? function() {
        const items = d.extra_items.map(function(it) {
          const lblShort = esc((it.name || "").substring(0, 28));
          const val = it.error ? '<span style="color:#94a3b8;font-style:italic">' + esc(it.error) + "</span>" : "<b>" + esc(fmtItemValue(it.value, it.units)) + "</b>";
          return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;font-size:10px"><span style="width:8px;height:8px;border-radius:50%;background:#06b6d4;flex-shrink:0"></span><span style="color:#64748b;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(it.name || "") + '">' + lblShort + '</span><span style="flex-shrink:0">' + val + "</span></div>";
        }).join("");
        return '<div style="margin-top:5px;padding-top:5px;border-top:1px solid #f1f5f9">' + items + "</div>";
      }() : "") + (spark && spark.since ? function() {
        const elapsed = Math.floor(Date.now() / 1e3) - spark.since;
        const hh = Math.floor(elapsed / 3600);
        const mm = Math.floor(elapsed % 3600 / 60);
        const dd = Math.floor(hh / 24);
        const sinceStr = dd > 0 ? dd + "d " + Math.floor(hh % 24) + "h" : hh > 0 ? hh + "h " + mm + "m" : mm + "m";
        return '<div style="font-size:10px;color:#f59e0b;margin-top:5px;padding-top:4px;border-top:1px solid #f1f5f9">\u23F1 ' + t("tip.problem_since", { t: "<b>" + esc(sinceStr) + "</b>" }) + "</div>";
      }() : "") + (spark ? "" : '<div style="font-size:9px;color:#cbd5e1;margin-top:4px">\u231B ' + esc(t("tip.loading_history")) + "</div>");
    }
    _tip.style.width = "240px";
    _tip.innerHTML = buildHtml(null);
    _tip.style.display = "block";
    moveTip(evt);
    if (d.id && (d.cpu != null || d.ping != null)) {
      fetchSparkData(String(d.id), d, function(spark) {
        if (_tip.style.display === "block") {
          _tip.innerHTML = buildHtml(spark);
        }
      });
    }
  }
  function moveTip(evt) {
    const x = evt.originalEvent ? evt.originalEvent.clientX : evt.clientX || 0;
    const y = evt.originalEvent ? evt.originalEvent.clientY : evt.clientY || 0;
    const tw = _tip.offsetWidth || 180;
    const th = _tip.offsetHeight || 120;
    const wx = window.innerWidth, wy = window.innerHeight;
    _tip.style.left = (x + 14 + tw > wx ? x - tw - 8 : x + 14) + "px";
    _tip.style.top = (y + 14 + th > wy ? y - th - 8 : y + 14) + "px";
  }
  function hideTip() {
    _tip.style.display = "none";
  }
  function _sumArrays(a, b) {
    const len = Math.max(a && a.length || 0, b && b.length || 0);
    if (len === 0) return [];
    const out = new Array(len);
    for (let i = 0; i < len; i++) out[i] = (a && a[i] || 0) + (b && b[i] || 0);
    return out;
  }
  function showEdgeTip(evt, edgeData, srcLabel, tgtLabel) {
    const tIn = edgeData.trafficIn || 0;
    const tOut = edgeData.trafficOut || 0;
    const srcId = edgeData.source || edgeData.from || "";
    const tgtId = edgeData.target || edgeData.to || "";
    function buildHtml(sparkSrc, sparkTgt) {
      const inArr = sparkSrc || sparkTgt ? _sumArrays(sparkSrc && sparkSrc.traffic_in, sparkTgt && sparkTgt.traffic_in) : null;
      const outArr = sparkSrc || sparkTgt ? _sumArrays(sparkSrc && sparkSrc.traffic_out, sparkTgt && sparkTgt.traffic_out) : null;
      const inSpark = inArr && inArr.length ? drawSparkline(inArr, "#06b6d4", 160, 26) : "";
      const outSpark = outArr && outArr.length ? drawSparkline(outArr, "#f97316", 160, 26) : "";
      const haveData = inSpark || outSpark;
      const srcArr = edgeData.src && edgeData.src.length ? edgeData.src : [];
      const srcBadge = srcArr.length ? ' <span style="font-size:9px;color:#fff;background:#64748b;border-radius:3px;padding:1px 5px;margin-left:4px;letter-spacing:0.05em;text-transform:uppercase;font-weight:600">' + esc(srcArr.join("+")) + "</span>" : "";
      const header = '<div style="font-weight:700;font-size:11px;color:#0f172a;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid #f1f5f9">' + esc(srcLabel) + ' <span style="color:#94a3b8">\u2194</span> ' + esc(tgtLabel) + srcBadge + "</div>";
      const capBps = edgeData.capBps || 0;
      let utilPart = "";
      if (capBps > 0) {
        const pct = Math.min(999, Math.max(tIn, tOut) / 2 / capBps * 100);
        const pctCol = pct >= 70 ? "#ef4444" : pct >= 40 ? "#f97316" : "#16a34a";
        utilPart = '<span style="color:#94a3b8">\xB7</span><span><b style="color:' + pctCol + '">' + pct.toFixed(1) + '%</b> <span style="color:#94a3b8">/ ' + fmt(capBps) + "</span></span>";
      }
      const liveRow = '<div style="display:flex;gap:10px;font-size:11px;color:#475569;margin-bottom:4px"><span><span style="color:#06b6d4">\u2193</span> <b>' + fmt(tIn) + '</b></span><span><span style="color:#f97316">\u2191</span> <b>' + fmt(tOut) + "</b></span>" + utilPart + "</div>";
      const ifDown = edgeData.ifaceDown || 0;
      const ifErr = edgeData.ifaceErr || 0;
      const ifDrop = edgeData.ifaceDrop || 0;
      let healthRow = "";
      if (ifDown > 0 || ifErr > 0.1 || ifDrop > 0.1) {
        const parts = [];
        if (ifDown > 0) parts.push('<span style="color:#dc2626;font-weight:600">\u2B07 ' + ifDown + " down</span>");
        if (ifErr > 0.1) parts.push('<span style="color:#f97316">err ' + ifErr.toFixed(1) + "/s</span>");
        if (ifDrop > 0.1) parts.push('<span style="color:#f59e0b">drop ' + ifDrop.toFixed(1) + "/s</span>");
        healthRow = '<div style="display:flex;gap:10px;font-size:10px;margin-bottom:4px;padding-bottom:3px;border-bottom:1px dotted #f1f5f9">' + parts.join(" \xB7 ") + "</div>";
      }
      if (!haveData && (sparkSrc || sparkTgt)) {
        return header + liveRow + healthRow + '<div style="font-size:10px;color:#94a3b8;margin-top:4px">' + esc(t("tip.no_traffic_history")) + "</div>";
      }
      const sparkBlock = haveData ? '<div style="margin-top:6px;font-size:10px;color:#64748b">' + (inSpark ? '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px"><span style="color:#06b6d4">\u2193 In</span>' + inSpark + "</div>" : "") + (outSpark ? '<div style="display:flex;align-items:center;gap:6px"><span style="color:#f97316">\u2191 Out</span>' + outSpark + "</div>" : "") + '<div style="font-size:9px;color:#cbd5e1;margin-top:3px">' + esc(t("tip.last_1h")) + "</div></div>" : '<div style="font-size:9px;color:#cbd5e1;margin-top:4px">\u231B ' + esc(t("tip.loading_history")) + "</div>";
      return header + liveRow + healthRow + sparkBlock;
    }
    _tip.style.width = "210px";
    _tip.innerHTML = buildHtml(null, null);
    _tip.style.display = "block";
    moveTip(evt);
    if (!srcId || !tgtId) return;
    const cfg = window.NT_CONFIG;
    if (!cfg || !cfg.data_url) return;
    const cacheS = _sparkCache[srcId], cacheT = _sparkCache[tgtId];
    const now = Date.now();
    if (cacheS && cacheT && now - cacheS.ts < 6e4 && now - cacheT.ts < 6e4) {
      _tip.innerHTML = buildHtml(cacheS, cacheT);
      return;
    }
    const url = cfg.data_url.replace("network.topology.v6.data", "network.topology.v6.spark") + "&hostids%5B%5D=" + encodeURIComponent(srcId) + "&hostids%5B%5D=" + encodeURIComponent(tgtId);
    fetch(url, { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } }).then(function(r) {
      return r.json();
    }).then(function(data) {
      const s = data[String(srcId)] || null;
      const t2 = data[String(tgtId)] || null;
      if (s) _sparkCache[srcId] = Object.assign({}, s, { ts: now });
      if (t2) _sparkCache[tgtId] = Object.assign({}, t2, { ts: now });
      if (_tip.style.display === "block") _tip.innerHTML = buildHtml(s, t2);
    }).catch(function() {
      if (_tip.style.display === "block") {
        _tip.innerHTML = buildHtml(
          { traffic_in: [], traffic_out: [] },
          { traffic_in: [], traffic_out: [] }
        );
      }
    });
  }

  // assets/js/modules/legend.js
  function setupLegend(groupNames, nodes) {
    const leg = document.getElementById("nt-legend");
    if (!leg) return;
    let html = '<div style="font-weight:600;color:#475569;margin-bottom:5px;font-size:10px">' + esc(t("legend.groups")) + "</div>";
    groupNames.forEach(function(name) {
      const col = grpColor(name);
      const cnt = nodes.filter(function(n) {
        return n._primaryGroup === name;
      }).length;
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px"><div style="width:9px;height:9px;border-radius:50%;background:' + col + '"></div><span style="color:#475569;flex:1;font-size:11px">' + esc(name) + '</span><span style="color:#94a3b8;font-size:11px">' + cnt + "</span></div>";
    });
    html += '<div style="font-weight:600;color:#475569;margin:6px 0 4px;font-size:10px;border-top:1px solid #f1f5f9;padding-top:5px">' + esc(t("legend.severity")) + "</div>";
    SEV_LBL.forEach(function(lbl, i) {
      const cnt = nodes.filter(function(n) {
        return (n.severity || 0) === i;
      }).length;
      if (!cnt) return;
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px"><div style="width:9px;height:9px;border-radius:50%;background:' + SEV_COL[i] + '"></div><span style="color:#475569;flex:1;font-size:11px">' + lbl + '</span><span style="color:#94a3b8;font-size:11px">' + cnt + "</span></div>";
    });
    html += '<div style="font-weight:600;color:#475569;margin:6px 0 4px;font-size:10px;border-top:1px solid #f1f5f9;padding-top:5px">' + esc(t("legend.ring")) + "</div>";
    [
      [t("legend.ring.cpu"), "#3b82f6"],
      [t("legend.ring.memory"), "#8b5cf6"],
      [t("legend.ring.traffic"), "#22c55e"],
      [t("legend.ring.ping"), "#f59e0b"]
    ].forEach(function(r) {
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px"><div style="width:9px;height:9px;border-radius:50%;background:' + r[1] + '"></div><span style="color:#475569;font-size:11px">' + esc(r[0]) + "</span></div>";
    });
    leg.innerHTML = html;
  }
  function setupBottomLegend(wrap, dark) {
    if (!wrap) return;
    const old = document.getElementById("nt-bottom-legend");
    if (old) old.remove();
    if (document.body.classList.contains("nt-wallboard")) return;
    let collapsed = true;
    try {
      collapsed = localStorage.getItem(NT_LEGEND_COLLAPSED_KEY) !== "0";
    } catch (e) {
    }
    const bg = dark ? "rgba(22,27,34,0.80)" : "rgba(255,255,255,0.82)";
    const bdr = dark ? "#2a2f36" : "#e5e9ee";
    const txt = dark ? "#c9d1d9" : "#475569";
    const bar = document.createElement("div");
    bar.id = "nt-bottom-legend";
    bar.style.cssText = "position:absolute;left:10px;bottom:8px;z-index:8;max-width:calc(100% - 190px);background:" + bg + ";border:1px solid " + bdr + ";border-radius:7px;box-shadow:0 1px 3px rgba(0,0,0,0.05);backdrop-filter:blur(2px);font-family:sans-serif;font-size:10.5px;color:" + txt + ";overflow:hidden;opacity:0.9";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:7px;padding:4px 9px;cursor:pointer;user-select:none;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;font-size:9px;opacity:0.6";
    head.innerHTML = "<span>" + esc(t("legend.guide.title")) + '</span><span id="nt-bl-caret" style="opacity:0.7">' + (collapsed ? "\u25B4" : "\u25BE") + "</span>";
    bar.appendChild(head);
    function dot(c) {
      return '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + c + ';vertical-align:middle;margin-right:4px"></span>';
    }
    function line(c, dashed) {
      return '<span style="display:inline-block;width:16px;height:0;border-top:3px ' + (dashed ? "dashed" : "solid") + " " + c + ';vertical-align:middle;margin-right:5px"></span>';
    }
    function chip(inner) {
      return '<span style="display:inline-flex;align-items:center;white-space:nowrap;margin-right:12px">' + inner + "</span>";
    }
    function grpTitle(label) {
      return '<span style="font-weight:700;opacity:0.6;margin-right:8px">' + esc(label) + "</span>";
    }
    function rowDiv(inner) {
      return '<div style="display:flex;flex-wrap:wrap;align-items:center;margin-bottom:3px">' + inner + "</div>";
    }
    let r1 = grpTitle(t("legend.guide.nodes"));
    r1 += chip(dot(SEV_COL[0]) + "<b>" + esc(t("legend.guide.optimal")) + "</b>");
    for (let i = 1; i <= 5; i++) r1 += chip(dot(SEV_COL[i]) + esc(SEV_LBL[i]));
    r1 += chip('<span style="color:#dc2626;font-weight:800;margin-right:4px">\u2715</span>' + esc(t("legend.guide.offline")));
    r1 += chip('<span style="opacity:0.4;margin-right:4px">\u25D0</span>' + esc(t("legend.guide.maint")));
    let r2 = grpTitle(t("legend.guide.edges"));
    r2 += chip(line("#22c55e", true) + esc(t("legend.guide.link_lldp")));
    r2 += chip(line("#3b82f6", false) + esc(t("legend.guide.link_inet")));
    r2 += chip(line("#dc2626", true) + esc(t("legend.guide.iface_down")));
    r2 += chip('<span style="display:inline-block;width:74px;height:7px;border-radius:3px;margin-right:5px;vertical-align:middle;background:linear-gradient(90deg,#3b82f6,#22c55e,#eab308,#f59e0b,#ef4444,#a21caf)"></span>' + esc(t("legend.guide.weathermap")));
    let r3 = grpTitle(t("legend.guide.rings"));
    r3 += chip(dot("#3b82f6") + esc(t("legend.ring.cpu")));
    r3 += chip(dot("#8b5cf6") + esc(t("legend.ring.memory")));
    r3 += chip(dot("#22c55e") + esc(t("legend.ring.traffic")));
    r3 += chip(dot("#f59e0b") + esc(t("legend.ring.ping")));
    const body = document.createElement("div");
    body.style.cssText = "padding:2px 10px 8px;max-width:840px;display:" + (collapsed ? "none" : "block");
    body.innerHTML = rowDiv(r1) + rowDiv(r2) + rowDiv(r3);
    bar.appendChild(body);
    head.addEventListener("click", function() {
      collapsed = !collapsed;
      body.style.display = collapsed ? "none" : "block";
      const caret = document.getElementById("nt-bl-caret");
      if (caret) caret.textContent = collapsed ? "\u25B4" : "\u25BE";
      try {
        localStorage.setItem(NT_LEGEND_COLLAPSED_KEY, collapsed ? "1" : "0");
      } catch (e) {
      }
    });
    bar.addEventListener("mouseenter", function() {
      bar.style.opacity = "1";
    });
    bar.addEventListener("mouseleave", function() {
      bar.style.opacity = "0.9";
    });
    wrap.appendChild(bar);
  }

  // assets/js/modules/manual-links.js
  var _linkMode = false;
  var _linkFirst = null;
  function isLinkModeActive() {
    return _linkMode;
  }
  function getLinkFirst() {
    return _linkFirst;
  }
  function setLinkFirst(n) {
    _linkFirst = n;
  }
  function enterLinkMode() {
    _linkMode = true;
    _linkFirst = null;
  }
  function exitLinkMode() {
    _linkMode = false;
    if (_linkFirst) {
      try {
        _linkFirst.style("underlay-opacity", 0);
      } catch (e) {
      }
      _linkFirst = null;
    }
    if (window._ntCy) {
      window._ntCy.nodes("[!isGroup]").forEach(function(n) {
        n.style("opacity", 1);
      });
    }
    const bLinkBtn = document.getElementById("nt-btn-link");
    if (bLinkBtn) {
      bLinkBtn.style.background = "";
      bLinkBtn.style.color = "";
      bLinkBtn.textContent = "Link";
    }
    const wrap = document.getElementById("nt-canvas-wrap");
    if (wrap) wrap.style.cursor = "";
  }
  function edgeLabel(cyInst, srcId, tgtId) {
    const sn = cyInst.getElementById(String(srcId)).data();
    const tn = cyInst.getElementById(String(tgtId)).data();
    if ((sn.severity || 0) >= 5 || (tn.severity || 0) >= 5) return "\u26A0 No Connection";
    const tIn = (sn.traffic && sn.traffic.in || 0) + (tn.traffic && tn.traffic.in || 0);
    const tOut = (sn.traffic && sn.traffic.out || 0) + (tn.traffic && tn.traffic.out || 0);
    return tIn || tOut ? "\u2193" + fmt(tIn / 2) + "\n\u2191" + fmt(tOut / 2) : "";
  }
  function applyManualLinks(cyInst) {
    const links = loadLinks();
    const existingIds = {};
    cyInst.edges().forEach(function(e) {
      existingIds[e.id()] = true;
    });
    links.forEach(function(l) {
      const id = "ml_" + l.s + "_" + l.t;
      if (existingIds[id]) return;
      if (!cyInst.getElementById(String(l.s)).length) return;
      if (!cyInst.getElementById(String(l.t)).length) return;
      const ml2 = edgeLabel(cyInst, l.s, l.t);
      cyInst.add({
        data: { id, source: String(l.s), target: String(l.t), tLabel: ml2, trafficIn: 0, trafficOut: 0 }
      });
    });
  }

  // assets/js/modules/traffic.js
  function trafficTier(bitsPerSec) {
    if (bitsPerSec <= 0) return { w: 2, col: "#94a3b8", tcol: "#94a3b8", dash: true };
    if (bitsPerSec < 1e4) return { w: 2, col: "#22c55e", tcol: "#16a34a", dash: false };
    if (bitsPerSec < 1e5) return { w: 3, col: "#06b6d4", tcol: "#0891b2", dash: false };
    if (bitsPerSec < 1e6) return { w: 4.5, col: "#3b82f6", tcol: "#1d4ed8", dash: false };
    if (bitsPerSec < 1e7) return { w: 6, col: "#f97316", tcol: "#c2410c", dash: false };
    return { w: 8, col: "#ef4444", tcol: "#b91c1c", dash: false };
  }
  var HEALTH_ERR_THRESHOLD = 1;
  var HEALTH_DROP_THRESHOLD = 5;
  var _weathermap = false;
  function setWeathermapMode(on) {
    _weathermap = !!on;
  }
  function utilizationTier(pct) {
    if (pct < 1) return { w: 2, col: "#94a3b8" };
    if (pct < 10) return { w: 3, col: "#3b82f6" };
    if (pct < 25) return { w: 4, col: "#22c55e" };
    if (pct < 40) return { w: 4.5, col: "#a3e635" };
    if (pct < 55) return { w: 5, col: "#facc15" };
    if (pct < 70) return { w: 6, col: "#f97316" };
    if (pct < 85) return { w: 7, col: "#ef4444" };
    return { w: 8, col: "#a21caf" };
  }
  function edgeUtilizationPct(edge) {
    const cap = edge.data("capBps") || 0;
    if (cap <= 0) return null;
    const t2 = Math.max(edge.data("trafficIn") || 0, edge.data("trafficOut") || 0) / 2;
    return Math.min(999, t2 / cap * 100);
  }
  function applyTrafficHeatmap(cy) {
    if (!cy) return;
    cy.edges().forEach(function(edge) {
      if (edge.hasClass("dead-edge")) return;
      const tIn = edge.data("trafficIn") || 0;
      const tOut = edge.data("trafficOut") || 0;
      const total = Math.max(tIn, tOut);
      let t2 = trafficTier(total);
      let wmPct = null;
      if (_weathermap) {
        wmPct = edgeUtilizationPct(edge);
        if (wmPct !== null) {
          const u = utilizationTier(wmPct);
          t2 = { w: u.w, col: u.col, tcol: u.col, dash: total <= 0 };
        }
      }
      const ifDownRatio = edge.data("ifaceDownRatio") || 0;
      const ifErr = edge.data("ifaceErr") || 0;
      const ifDrop = edge.data("ifaceDrop") || 0;
      let w = t2.w, col = t2.col, dashPat = t2.dash ? [4, 8] : [6, 5], op = t2.dash ? 0.75 : 0.9;
      if (ifDownRatio >= 0.5) {
        w = Math.max(w, 4);
        col = "#dc2626";
        dashPat = [4, 4];
        op = 0.95;
      } else if (ifErr > HEALTH_ERR_THRESHOLD) {
        w = Math.max(w, 4);
        col = "#f97316";
        dashPat = [6, 5];
        op = 0.9;
      } else if (ifDrop > HEALTH_DROP_THRESHOLD) {
        w = Math.max(w, 3);
        col = "#f59e0b";
        dashPat = [3, 5];
        op = 0.9;
      }
      edge.style("width", w);
      edge.style("line-color", col);
      edge.style("color", t2.tcol);
      edge.style("line-style", "dashed");
      edge.style("line-dash-pattern", dashPat);
      edge.style("opacity", op);
      if (_weathermap && wmPct !== null) {
        edge.style("label", wmPct < 1 ? "" : wmPct.toFixed(0) + "%");
      } else {
        edge.removeStyle("label");
      }
    });
  }
  function startEdgeAnimation(cy, nodes) {
    const deadIds = {};
    nodes.forEach(function(n) {
      if ((n.severity || 0) >= 5) deadIds[String(n.id)] = true;
    });
    cy.edges().forEach(function(e) {
      if (deadIds[e.source().id()] || deadIds[e.target().id()]) e.addClass("dead-edge");
      else e.removeClass("dead-edge");
    });
    if (window._ntEdgeAnim) clearInterval(window._ntEdgeAnim);
    let offset = 0;
    window._ntEdgeAnim = setInterval(function() {
      const c = window._ntCy;
      if (!c || c.destroyed && c.destroyed()) {
        clearInterval(window._ntEdgeAnim);
        window._ntEdgeAnim = null;
        return;
      }
      if (document.hidden) return;
      offset = (offset + 1) % 22;
      c.edges().filter(function(e) {
        return !e.hasClass("dead-edge");
      }).style("line-dash-offset", -offset);
    }, 50);
  }

  // assets/js/modules/layouts.js
  var LAYOUT_OPTIONS = [
    { id: "auto", label: t("layout.auto") },
    { id: "cose", label: t("layout.force") },
    { id: "concentric", label: t("layout.concentric") },
    { id: "grid", label: t("layout.grid") },
    { id: "breadthfirst", label: t("layout.tree") },
    { id: "hierarchy", label: t("layout.hierarchy") }
  ];
  var TIER_ORDER = {
    firewall: 0,
    router: 1,
    switch: 2,
    wireless: 3,
    hypervisor: 4,
    linux: 4,
    windows: 4,
    macos: 4,
    webserver: 4,
    container: 4,
    mailserver: 4,
    server: 4,
    storage: 5,
    monitoring: 6,
    homeauto: 6,
    ups: 7,
    camera: 7,
    printer: 7
  };
  var TIER_DEFAULT = 4;
  function buildHierarchyPositions(nodes) {
    const tierGap = 180;
    const nodeGap = 150;
    const byTier = {};
    nodes.forEach(function(n) {
      let tier;
      if (String(n.id).indexOf("internet_") === 0) {
        tier = -1;
      } else {
        tier = TIER_ORDER[n.type] !== void 0 ? TIER_ORDER[n.type] : TIER_DEFAULT;
      }
      if (!byTier[tier]) byTier[tier] = [];
      byTier[tier].push(n);
    });
    Object.keys(byTier).forEach(function(t2) {
      byTier[t2].sort(function(a, b) {
        return (b.severity || 0) - (a.severity || 0) || (a.label || "").localeCompare(b.label || "");
      });
    });
    const tiers = Object.keys(byTier).map(Number).sort(function(a, b) {
      return a - b;
    });
    const positions = {};
    tiers.forEach(function(tier, tierIdx) {
      const row = byTier[tier];
      const totalWidth = (row.length - 1) * nodeGap;
      const startX = -totalWidth / 2;
      row.forEach(function(node, i) {
        positions[String(node.id)] = {
          x: startX + i * nodeGap,
          y: tierIdx * tierGap
        };
      });
    });
    return positions;
  }
  function buildLayoutConfig(layoutId, nodes, edges, forceFresh) {
    if (layoutId === "auto" && !forceFresh) {
      const sp = loadPositions();
      const ids = nodes.map(function(n) {
        return String(n.id);
      });
      const hits = ids.filter(function(id) {
        return !!sp[id];
      }).length;
      const coverage = ids.length > 0 ? hits / ids.length : 0;
      const hasNonZero = ids.some(function(id) {
        const p = sp[id];
        return p && (Math.abs(p.x) > 1 || Math.abs(p.y) > 1);
      });
      if (coverage >= 0.8 && hasNonZero) {
        return {
          name: "preset",
          positions: function(node) {
            return sp[node.id()] || void 0;
          },
          padding: 30
        };
      }
      const edgeCount = edges && edges.length || 0;
      const connectivity = ids.length > 0 ? edgeCount / ids.length : 0;
      if (connectivity < 0.3 && ids.length > 5) layoutId = "concentric";
      else layoutId = "cose";
    } else if (layoutId === "auto" && forceFresh) {
      layoutId = "cose";
    }
    switch (layoutId) {
      case "cose":
        return {
          name: "cose",
          animate: true,
          animationDuration: 500,
          randomize: true,
          padding: 50,
          nodeRepulsion: 8e3,
          idealEdgeLength: 100,
          gravity: 1,
          fit: true,
          componentSpacing: 40
        };
      case "concentric":
        return {
          name: "concentric",
          animate: true,
          animationDuration: 500,
          padding: 50,
          fit: true,
          minNodeSpacing: 60,
          concentric: function(node) {
            return node.degree();
          },
          levelWidth: function() {
            return 1;
          }
        };
      case "grid":
        return {
          name: "grid",
          animate: true,
          animationDuration: 500,
          padding: 50,
          fit: true,
          avoidOverlap: true,
          condense: false
        };
      case "breadthfirst":
        return {
          name: "breadthfirst",
          animate: true,
          animationDuration: 500,
          directed: false,
          padding: 50,
          fit: true,
          spacingFactor: 1.4,
          avoidOverlap: true
        };
      case "hierarchy":
        return {
          name: "preset",
          positions: function() {
            const pos = buildHierarchyPositions(nodes);
            return function(node) {
              return pos[node.id()] || void 0;
            };
          }(),
          padding: 50,
          fit: true,
          animate: true,
          animationDuration: 500
        };
      default:
        return {
          name: "cose",
          animate: true,
          animationDuration: 500,
          randomize: true,
          padding: 50,
          nodeRepulsion: 8e3,
          idealEdgeLength: 100,
          gravity: 1,
          fit: true,
          componentSpacing: 40
        };
    }
  }

  // assets/js/modules/render-tech-style.js
  function buildCytoscapeStyle(dark) {
    return [
      { selector: "node[!isGroup]", style: {
        "width": 96,
        "height": 96,
        "background-opacity": 0,
        "border-width": 0,
        "background-image": "data(bgImage)",
        "background-fit": "contain",
        "background-clip": "none",
        "label": "data(label)",
        "text-valign": "bottom",
        "text-halign": "center",
        "font-size": 11,
        "font-family": "sans-serif",
        "color": dark ? "#e2e8f0" : "#334155",
        "text-margin-y": 6,
        "text-background-opacity": dark ? 0.75 : 0.85,
        "text-background-color": dark ? "#1e293b" : "#f8fafc",
        "text-background-padding": "2px",
        "text-background-shape": "roundrectangle",
        "min-zoomed-font-size": 8
      } },
      { selector: "edge", style: {
        "width": 2.5,
        "line-color": "#22c55e",
        "line-style": "dashed",
        "line-dash-pattern": [6, 5],
        "line-dash-offset": 0,
        "curve-style": "unbundled-bezier",
        "control-point-distances": [60],
        "control-point-weights": [0.5],
        "target-arrow-shape": "none",
        "opacity": 0.85,
        "label": "data(tLabel)",
        "font-size": 9,
        "font-family": "monospace",
        "text-wrap": "wrap",
        "text-background-color": dark ? "#1e293b" : "#f8fafc",
        "text-background-opacity": 0.88,
        "text-background-padding": "2px",
        "color": dark ? "#94a3b8" : "#16a34a",
        "line-cap": "round",
        "text-rotation": "none",
        "text-margin-y": -12,
        // Port-Labels an den Edge-Enden (port-labels.js setzt source-/
        // target-label inline; hier nur die Offsets weg vom Node)
        "source-text-offset": 26,
        "target-text-offset": 26
      } },
      { selector: "edge.dead-edge", style: {
        "width": 1.5,
        "line-color": "#94a3b8",
        "line-style": "dashed",
        "line-dash-pattern": [4, 8],
        "opacity": 0.55,
        "color": "#ef4444",
        "font-weight": "600"
      } },
      { selector: "edge[?_isInternetEdge]", style: {
        // Internet-Uplinks visuell als kräftige blaue Linie
        "width": 4,
        "line-color": "#3b82f6",
        "line-style": "solid",
        "opacity": 0.85,
        "curve-style": "straight"
      } },
      { selector: "node[!isGroup]:selected", style: {
        "underlay-color": "#6366f1",
        "underlay-padding": 6,
        "underlay-opacity": 0.25,
        "underlay-shape": "ellipse"
      } },
      // Path-Highlight (path-highlight.js): cyan, klar abgesetzt von der
      // selected-Underlay (#6366f1 indigo) und von Severity-Farben.
      { selector: ".nt-path-dim", style: { "opacity": 0.15 } },
      { selector: "edge.nt-path-edge", style: {
        "width": 5,
        "line-color": "#06b6d4",
        "line-style": "solid",
        "opacity": 1,
        "z-index": 999,
        "color": "#0891b2"
      } },
      { selector: "node.nt-path-node", style: {
        "underlay-color": "#06b6d4",
        "underlay-padding": 8,
        "underlay-opacity": 0.45,
        "underlay-shape": "ellipse",
        "opacity": 1,
        "z-index": 999
      } },
      // What-if-Ausfallsimulation (whatif.js): grau getoent = simuliert tot,
      // rot getoent = dadurch vom Uplink abgeschnitten.
      //
      // OVERLAY statt underlay: die Nodes haben background-opacity:0
      // (transparenter Body, nur das SVG-Icon per background-image). Ein
      // underlay wird HINTER dem Body kompositiert — Firefox ueberspringt
      // die Ebene bei transparentem Body, die Halos blieben dort unsichtbar
      // (in Chrome gingen sie). overlay-* rendert OBEN drauf (Cytoscapes
      // battle-tested Selektions-Highlight) und ist cross-browser zuverlaessig.
      // Niemand setzt overlay-* inline → kein Heatmap-Konflikt.
      { selector: "node.nt-sim-dead", style: {
        "overlay-color": "#475569",
        "overlay-padding": 9,
        "overlay-opacity": 0.45
      } },
      { selector: "node.nt-sim-cut", style: {
        "overlay-color": "#dc2626",
        "overlay-padding": 9,
        "overlay-opacity": 0.4
      } },
      // Root-Cause-Analyse (root-cause.js): kraeftig rot = Ursache des
      // Ausfalls, amber = Folge-Ausfall dahinter. Gleiche Overlay-Begruendung.
      { selector: "node.nt-rc-cause", style: {
        "overlay-color": "#b91c1c",
        "overlay-padding": 11,
        "overlay-opacity": 0.45
      } },
      { selector: "node.nt-rc-victim", style: {
        "overlay-color": "#f59e0b",
        "overlay-padding": 7,
        "overlay-opacity": 0.35
      } }
    ];
  }

  // assets/js/modules/build-elements.js
  function injectInternetCloud(nodes, edges, layoutId) {
    if (layoutId !== "hierarchy") return { nodes, edges };
    const edgeDevices = nodes.filter(function(n) {
      return n.type === "firewall" || n.type === "router";
    });
    if (edgeDevices.length === 0) return { nodes, edges };
    const internetLabel = window.NT_CONFIG && window.NT_CONFIG.internet_label || "Internet";
    const internetNode = {
      id: "internet_root",
      label: internetLabel,
      host: internetLabel,
      ip: "",
      iftype: "",
      type: "internet",
      severity: 0,
      problems: 0,
      _isInternet: true,
      // Flag für Render und Kontextmenü
      groups: [],
      traffic: { in: 0, out: 0 }
    };
    const newNodes = [internetNode].concat(nodes);
    const synthEdges = edgeDevices.map(function(dev) {
      return {
        id: "einet_" + dev.id,
        source: "internet_root",
        target: String(dev.id),
        _isInternetEdge: true
      };
    });
    const newEdges = synthEdges.concat(edges || []);
    return { nodes: newNodes, edges: newEdges };
  }
  function buildNodeElements(nodes) {
    const elements = [];
    nodes.forEach(function(n) {
      const nodeData = {
        id: n.id,
        label: function() {
          const lbl = n.label || n.host || "";
          if (/^\d+\.\d+\.\d+\.\d+$/.test(lbl) && n.host && n.host !== lbl) return n.host;
          return lbl || String(n.id);
        }(),
        isGroup: false,
        severity: n.severity || 0,
        cpu: n.cpu,
        memory: n.memory,
        ping: n.ping,
        traffic: n.traffic,
        iface_health: n.iface_health || null,
        link_speed: n.link_speed || 0,
        type: n.type,
        host: n.host,
        ip: n.ip,
        iftype: n.iftype,
        groups: n.groups,
        _primaryGroup: n._primaryGroup,
        problems: n.problems || 0,
        acknowledged: !!n.acknowledged,
        maintenance: !!n.maintenance,
        // Offline-Status durchreichen (Backend liefert 'unavailable' bool +
        // 'down_since' Unix-TS) — render-tech-style + detail-panel nutzen das.
        unavailable: !!n.unavailable,
        down_since: n.down_since || 0,
        down_error: n.down_error || "",
        // Stale-Detection: max(lastclock) aller Live-Metrik-Items.
        // Wenn das deutlich aelter als 5min ist, ist der Host stale.
        last_seen: n.last_seen || 0,
        // Extra-Items aus nt:show-Tags + icon_override-Flag
        extra_items: n.extra_items || [],
        icon_override: !!n.icon_override,
        // Custom-Links aus nt:link-Tags (Kontextmenü)
        links: n.links || [],
        pinned: false,
        // wird nach cy-Init aus localStorage gesetzt
        note: ""
        // dito
      };
      if (n._isInternet) nodeData._isInternet = true;
      if (n._isAggregate) {
        nodeData._isAggregate = true;
        nodeData._childCount = n._childCount;
        nodeData._topProblems = n._topProblems;
      }
      nodeData.bgImage = makeNodeImage(nodeData);
      elements.push({ data: nodeData });
    });
    return elements;
  }
  function buildEdgeElements(edges, nodes) {
    const elements = [];
    const nodeIds = {}, edgeSeen = {};
    const nodeById = {};
    nodes.forEach(function(n) {
      nodeIds[n.id] = true;
      nodeById[String(n.id)] = n;
    });
    edges.forEach(function(e, i) {
      const src = String(e.source || e.from || "");
      const tgt = String(e.target || e.to || "");
      if (!nodeIds[src] || !nodeIds[tgt] || src === tgt) return;
      const k = [src, tgt].sort().join("_");
      if (edgeSeen[k]) return;
      edgeSeen[k] = true;
      if (e._isInternetEdge) {
        elements.push({
          data: {
            id: e.id || "einet_" + i,
            source: src,
            target: tgt,
            trafficIn: 0,
            trafficOut: 0,
            tLabel: "",
            isLLDP: false,
            _isInternetEdge: true
          }
        });
        return;
      }
      const srcNode = nodeById[src];
      const tgtNode = nodeById[tgt];
      const tIn = (srcNode && srcNode.traffic ? srcNode.traffic.in : 0) + (tgtNode && tgtNode.traffic ? tgtNode.traffic.in : 0);
      const tOut = (srcNode && srcNode.traffic ? srcNode.traffic.out : 0) + (tgtNode && tgtNode.traffic ? tgtNode.traffic.out : 0);
      const srcDead = (srcNode || {}).severity || 0;
      const tgtDead = (tgtNode || {}).severity || 0;
      const tLabel = srcDead >= 5 || tgtDead >= 5 ? "\u26A0 No Connection" : tIn || tOut ? "\u2193" + fmt(tIn / 2) + "\n\u2191" + fmt(tOut / 2) : "";
      const srcH = srcNode && srcNode.iface_health || null;
      const tgtH = tgtNode && tgtNode.iface_health || null;
      let downCnt = 0, errorsRate = 0, discardsRate = 0, downRatio = 0;
      if (srcH) {
        downCnt += srcH.down || 0;
        errorsRate = Math.max(errorsRate, srcH.errors || 0);
        discardsRate = Math.max(discardsRate, srcH.discards || 0);
        if (srcH.count > 0) downRatio = Math.max(downRatio, (srcH.down || 0) / srcH.count);
      }
      if (tgtH) {
        downCnt += tgtH.down || 0;
        errorsRate = Math.max(errorsRate, tgtH.errors || 0);
        discardsRate = Math.max(discardsRate, tgtH.discards || 0);
        if (tgtH.count > 0) downRatio = Math.max(downRatio, (tgtH.down || 0) / tgtH.count);
      }
      const spdA = srcNode && srcNode.link_speed || 0;
      const spdB = tgtNode && tgtNode.link_speed || 0;
      const capBps = linkCapacity(spdA, spdB);
      const ports = e.ports || {};
      elements.push({
        data: {
          id: "e" + i,
          source: src,
          target: tgt,
          portSrc: ports[src] || "",
          portTgt: ports[tgt] || "",
          trafficIn: tIn,
          trafficOut: tOut,
          tLabel,
          isLLDP: true,
          // Discovery-Quelle(n): ['lldp'], ['cdp'], oder ['cdp','lldp']
          // wenn die Verbindung von beiden Protokollen gemeldet wurde
          src: e.src || [],
          // Interface-Health-Aggregat fuer Edge-Styling + Tooltip.
          // downRatio (worst-case beider Endpunkte) steuert das
          // Edge-Coloring — der Roh-Count wuerde bei einem Switch
          // mit vielen unbenutzten Ports jede Edge rot faerben.
          ifaceDown: downCnt,
          ifaceErr: errorsRate,
          ifaceDrop: discardsRate,
          ifaceDownRatio: downRatio,
          // Link-Kapazitaet in bps (0 = unbekannt) fuer Weathermap
          capBps
        }
      });
    });
    return elements;
  }

  // assets/js/modules/group-hulls.js
  var NS = "http://www.w3.org/2000/svg";
  var PADDING = 30;
  var LABEL_OFFSET = 18;
  var _svg = null;
  var _redrawHandle = null;
  function convexHull(points) {
    if (points.length < 3) return points.slice();
    const pts = points.slice().sort(function(a, b) {
      return a.x - b.x || a.y - b.y;
    });
    function cross(O, A, B) {
      return (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
    }
    const lower = [];
    for (let i = 0; i < pts.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) {
        lower.pop();
      }
      lower.push(pts[i]);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) {
        upper.pop();
      }
      upper.push(pts[i]);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  }
  function inflate(points, pad) {
    const out = [];
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [0.7071, 0.7071],
      [-0.7071, 0.7071],
      [0.7071, -0.7071],
      [-0.7071, -0.7071]
    ];
    points.forEach(function(p) {
      dirs.forEach(function(d) {
        out.push({ x: p.x + d[0] * pad, y: p.y + d[1] * pad });
      });
    });
    return out;
  }
  function ensureSvg(wrap) {
    if (_svg) return _svg;
    _svg = document.createElementNS(NS, "svg");
    _svg.id = "nt-group-hulls";
    _svg.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5";
    wrap.appendChild(_svg);
    return _svg;
  }
  function clearSvg() {
    if (!_svg) return;
    while (_svg.firstChild) _svg.removeChild(_svg.firstChild);
  }
  function redraw(cy) {
    if (!_svg) return;
    clearSvg();
    const byGroup = {};
    let _added = 0;
    cy.nodes("[!isGroup]").forEach(function(n) {
      const d = n.data();
      if (d._isInternet || d._isAggregate) return;
      const g = d._primaryGroup;
      if (!g) return;
      const pos = n.renderedPosition();
      if (!pos || !isFinite(pos.x) || !isFinite(pos.y)) return;
      _added++;
      if (!byGroup[g]) byGroup[g] = [];
      byGroup[g].push({ x: pos.x, y: pos.y });
    });
    if (_added === 0) return;
    Object.keys(byGroup).forEach(function(g) {
      const pts = byGroup[g];
      if (pts.length === 0) return;
      const inflated = inflate(pts, PADDING);
      const hull = convexHull(inflated);
      if (hull.length < 3) return;
      const allFinite = hull.every(function(p) {
        return isFinite(p.x) && isFinite(p.y);
      });
      if (!allFinite) return;
      const col = grpColor(g);
      const dStr = hull.map(function(p, i) {
        return (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1);
      }).join(" ") + " Z";
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", dStr);
      path.setAttribute("fill", col);
      path.setAttribute("fill-opacity", "0.10");
      path.setAttribute("stroke", col);
      path.setAttribute("stroke-opacity", "0.45");
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("stroke-dasharray", "6,4");
      path.setAttribute("stroke-linejoin", "round");
      _svg.appendChild(path);
      let topPoint = hull[0];
      for (let i = 1; i < hull.length; i++) {
        if (hull[i].y < topPoint.y) topPoint = hull[i];
      }
      const text = document.createElementNS(NS, "text");
      text.setAttribute("x", topPoint.x);
      text.setAttribute("y", topPoint.y - LABEL_OFFSET);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("fill", col);
      text.setAttribute("font-size", "12");
      text.setAttribute("font-weight", "700");
      text.setAttribute("font-family", "sans-serif");
      text.setAttribute("opacity", "0.7");
      text.textContent = g;
      _svg.appendChild(text);
    });
  }
  function setupGroupHulls(cy, wrap) {
    if (!cy || !wrap) return;
    ensureSvg(wrap);
    function scheduleRedraw() {
      if (_redrawHandle) return;
      _redrawHandle = requestAnimationFrame(function() {
        _redrawHandle = null;
        redraw(cy);
      });
    }
    cy.on("pan zoom drag dragfree position layoutstop", scheduleRedraw);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(scheduleRedraw);
      ro.observe(wrap);
      _svg._ro = ro;
    }
    redraw(cy);
  }
  function destroyGroupHulls(wrap) {
    if (!_svg) return;
    if (_svg._ro) {
      try {
        _svg._ro.disconnect();
      } catch (e) {
      }
    }
    if (_svg.parentNode) _svg.parentNode.removeChild(_svg);
    _svg = null;
    if (_redrawHandle) {
      cancelAnimationFrame(_redrawHandle);
      _redrawHandle = null;
    }
  }

  // assets/js/modules/group-cluster-layout.js
  var COLUMN_PADDING = 110;
  var ROW_PADDING = 110;
  var TOP_RESERVE = 80;
  var BOTTOM_PADDING = 30;
  var LABEL_OFFSET2 = 24;
  var MIN_COLUMN_W = 200;
  var MIN_ROW_H = 140;
  function proportionalSizes(counts, available, minSize) {
    const total = counts.reduce(function(a, b) {
      return a + Math.max(1, b);
    }, 0);
    let sizes = counts.map(function(c) {
      return Math.max(1, c) / total * available;
    });
    sizes = sizes.map(function(s) {
      return Math.max(minSize, s);
    });
    let sum = sizes.reduce(function(a, b) {
      return a + b;
    }, 0);
    let guard = 0;
    while (sum > available && guard < 20) {
      guard++;
      const flexIdx = [];
      let flexSum = 0;
      sizes.forEach(function(s, i) {
        if (s > minSize + 1e-4) {
          flexIdx.push(i);
          flexSum += s;
        }
      });
      if (flexIdx.length === 0) break;
      const overflow = sum - available;
      flexIdx.forEach(function(i) {
        const share = sizes[i] / flexSum * overflow;
        sizes[i] = Math.max(minSize, sizes[i] - share);
      });
      const newSum = sizes.reduce(function(a, b) {
        return a + b;
      }, 0);
      if (newSum >= sum - 0.5) break;
      sum = newSum;
    }
    return sizes;
  }
  function resolveMode(mode, numGroups) {
    if (mode === "columns" || mode === "rows" || mode === "off") return mode;
    if (numGroups <= 3) return "columns";
    return "rows";
  }
  function buildClusterLayoutConfig(boundingBox, nodeCount, innerLayoutId) {
    const id = innerLayoutId || "cose";
    if (id === "grid") {
      return {
        name: "grid",
        animate: false,
        fit: false,
        padding: 20,
        boundingBox,
        avoidOverlap: true,
        condense: true
      };
    }
    if (id === "breadthfirst") {
      return {
        name: "breadthfirst",
        animate: false,
        fit: false,
        padding: 20,
        boundingBox,
        directed: false,
        spacingFactor: 1
      };
    }
    if (id === "concentric") {
      return {
        name: "concentric",
        animate: false,
        fit: false,
        padding: 20,
        boundingBox,
        minNodeSpacing: 30,
        avoidOverlap: true
      };
    }
    if (id === "circle") {
      return {
        name: "circle",
        animate: false,
        fit: false,
        padding: 20,
        boundingBox,
        avoidOverlap: true
      };
    }
    return {
      name: "cose",
      animate: false,
      randomize: true,
      padding: 20,
      nodeRepulsion: 6e3,
      idealEdgeLength: 80,
      gravity: 0.8,
      fit: false,
      boundingBox,
      componentSpacing: 30,
      numIter: nodeCount < 6 ? 500 : 1e3
    };
  }
  function runGroupClusterLayout(cy, groupNames, mode, onComplete, innerLayoutId) {
    if (!cy || cy.destroyed()) return;
    if (!groupNames || groupNames.length < 2) {
      if (onComplete) onComplete();
      return;
    }
    const effective = resolveMode(mode || "auto", groupNames.length);
    if (effective === "off") {
      if (onComplete) onComplete();
      return;
    }
    const canvasW = cy.width();
    const canvasH = cy.height();
    const count = groupNames.length;
    const nodesByGroup = {};
    cy.nodes("[!isGroup]").forEach(function(n) {
      const d = n.data();
      if (d._isInternet || d._isAggregate) return;
      const g = d._primaryGroup;
      if (!g) return;
      if (!nodesByGroup[g]) nodesByGroup[g] = cy.collection();
      nodesByGroup[g] = nodesByGroup[g].union(n);
    });
    const counts = groupNames.map(function(g) {
      return nodesByGroup[g] && nodesByGroup[g].length || 0;
    });
    const isCircular = innerLayoutId === "concentric" || innerLayoutId === "circle";
    const equalSplit = function(avail, n) {
      return Array(n).fill(avail / n);
    };
    const boxes = {};
    if (effective === "columns") {
      const totalGap = COLUMN_PADDING * (count + 1);
      const availW = canvasW - totalGap;
      const colH = canvasH - TOP_RESERVE - BOTTOM_PADDING;
      if (availW < MIN_COLUMN_W * count || colH < 100) {
        cy.fit(cy.nodes(), 40);
        if (onComplete) onComplete();
        return;
      }
      const colWidths = isCircular ? equalSplit(availW, count) : proportionalSizes(counts, availW, MIN_COLUMN_W);
      let xCursor = COLUMN_PADDING;
      groupNames.forEach(function(g, idx) {
        boxes[g] = {
          x1: xCursor,
          y1: TOP_RESERVE,
          w: colWidths[idx],
          h: colH
        };
        xCursor += colWidths[idx] + COLUMN_PADDING;
      });
    } else {
      const totalGap = ROW_PADDING * (count - 1);
      const availH = canvasH - TOP_RESERVE - BOTTOM_PADDING - totalGap;
      const rowW = canvasW - 2 * ROW_PADDING;
      if (rowW < 100 || availH < MIN_ROW_H * count) {
        cy.fit(cy.nodes(), 40);
        if (onComplete) onComplete();
        return;
      }
      const rowHeights = isCircular ? equalSplit(availH, count) : proportionalSizes(counts, availH, MIN_ROW_H);
      let yCursor = TOP_RESERVE;
      groupNames.forEach(function(g, idx) {
        boxes[g] = {
          x1: ROW_PADDING,
          y1: yCursor,
          w: rowW,
          h: rowHeights[idx]
        };
        yCursor += rowHeights[idx] + ROW_PADDING;
      });
    }
    const internetNodes = cy.nodes("[!isGroup]").filter(function(n) {
      return n.data("_isInternet");
    });
    if (internetNodes.length > 0) {
      internetNodes.position({
        x: canvasW / 2,
        y: TOP_RESERVE / 2
      });
    }
    const groupsToLayout = groupNames.filter(function(g) {
      const nodes = nodesByGroup[g];
      return nodes && nodes.length > 0;
    });
    const pending = groupsToLayout.length;
    let completed = 0;
    function checkDone() {
      if (completed >= pending) {
        cy.fit(cy.nodes(), 30);
        if (onComplete) onComplete();
      }
    }
    if (pending === 0) {
      if (onComplete) onComplete();
      return;
    }
    groupsToLayout.forEach(function(g) {
      const nodes = nodesByGroup[g].not(":locked");
      if (nodes.length === 0) {
        completed++;
        checkDone();
        return;
      }
      const bb = Object.assign({}, boxes[g]);
      bb.y1 += LABEL_OFFSET2;
      bb.h -= LABEL_OFFSET2;
      const lay = nodes.layout(buildClusterLayoutConfig(bb, nodes.length, innerLayoutId));
      lay.one("layoutstop", function() {
        completed++;
        checkDone();
      });
      lay.run();
    });
  }

  // assets/js/modules/render-tech.js
  var _setupToolbar = function() {
  };
  function setSetupToolbarCallback(fn) {
    _setupToolbar = fn;
  }
  var _posSaveTimer = null;
  function updateBadge(nodes) {
    const badge = document.getElementById("nt-badge");
    if (!badge) return;
    let ok = 0, warn = 0, down = 0;
    nodes.forEach(function(n) {
      const s = n.severity || 0;
      if (s === 0) ok++;
      else if (s >= 5) down++;
      else warn++;
    });
    badge.innerHTML = "<b>" + nodes.length + "</b> " + esc(t("tech.badge.hosts")) + ' &nbsp;|&nbsp; <span style="color:#22c55e"><b>' + ok + "</b> " + esc(t("tech.badge.ok")) + '</span> &nbsp;|&nbsp; <span style="color:#f59e0b"><b>' + warn + "</b> " + esc(t("tech.badge.warn")) + '</span> &nbsp;|&nbsp; <span style="color:#ef4444"><b>' + down + "</b> " + esc(t("tech.badge.down")) + "</span>";
  }
  var _refreshFails = 0;
  function _clearRefreshWarn() {
    _refreshFails = 0;
    const b = document.getElementById("nt-refresh-warn");
    if (b) b.remove();
  }
  function _markRefresh(ok) {
    if (ok) {
      _clearRefreshWarn();
      return;
    }
    _refreshFails++;
    if (_refreshFails < 2) return;
    const wrap = document.getElementById("nt-canvas-wrap");
    if (!wrap) return;
    let b = document.getElementById("nt-refresh-warn");
    if (!b) {
      b = document.createElement("div");
      b.id = "nt-refresh-warn";
      b.style.cssText = "position:absolute;top:10px;right:12px;z-index:9;background:#fef3c7;color:#92400e;border:1px solid #f59e0b;border-radius:6px;padding:4px 10px;font:600 11px sans-serif;box-shadow:0 2px 6px rgba(0,0,0,0.12)";
      wrap.appendChild(b);
    }
    b.textContent = t("tech.refresh_stale");
    b.title = t("tech.refresh_stale.tip", { n: _refreshFails });
  }
  function render(wrap, nodes, edges, dataUrl) {
    const pnl = document.getElementById("nt-detail");
    if (!nodes.length) {
      wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999">' + esc(t("tech.no_hosts")) + "</div>";
      return;
    }
    const cfg = window.NT_CONFIG;
    const sel = cfg && cfg.selected_group_names || [];
    nodes.forEach(function(n) {
      n.id = String(n.id);
      n._primaryGroup = primaryGroup(n, sel);
    });
    const _present = {};
    nodes.forEach(function(n) {
      if (n._primaryGroup) _present[n._primaryGroup] = true;
    });
    const groupNames = [];
    sel.forEach(function(g) {
      if (_present[g]) {
        groupNames.push(g);
        _present[g] = false;
      }
    });
    Object.keys(_present).forEach(function(g) {
      if (_present[g]) groupNames.push(g);
    });
    let _groupViewActive = false;
    try {
      _groupViewActive = localStorage.getItem(NT_GROUP_VIEW_KEY) === "1";
    } catch (e) {
    }
    if (_groupViewActive && groupNames.length > 0) {
      const agg = aggregateByGroup(nodes, edges);
      nodes = agg.nodes;
      edges = agg.edges;
    }
    const _currentLayout = loadLayout();
    const withInet = injectInternetCloud(nodes, edges, _currentLayout);
    nodes = withInet.nodes;
    edges = withInet.edges;
    const elements = buildNodeElements(nodes).concat(buildEdgeElements(edges, nodes));
    if (window._ntEdgeAnim) {
      clearInterval(window._ntEdgeAnim);
      window._ntEdgeAnim = null;
    }
    if (window._ntCy) {
      try {
        clearPathState(window._ntCy);
      } catch (e) {
      }
      try {
        clearSimulation(window._ntCy);
      } catch (e) {
      }
      try {
        clearRootCause(window._ntCy);
      } catch (e) {
      }
      try {
        window._ntCy.destroy();
      } catch (e) {
      }
      window._ntCy = null;
    }
    window._ntToolbarDone = false;
    const oldSev = document.getElementById("nt-sev-filter");
    if (oldSev) oldSev.remove();
    const oldSearch = document.getElementById("nt-search-input");
    if (oldSearch) oldSearch.remove();
    Array.from(wrap.children).forEach(function(ch) {
      if (ch.id !== "nt-loading") wrap.removeChild(ch);
    });
    const cyDiv = document.createElement("div");
    cyDiv.style.cssText = "width:100%;height:100%;position:absolute;top:0;left:0";
    wrap.style.position = "relative";
    wrap.appendChild(cyDiv);
    const useLayout = "cose";
    const dark = !!(document.getElementById("nt-root") && document.getElementById("nt-root").classList.contains("nt-dark"));
    cyDiv.style.width = wrap.clientWidth + "px";
    cyDiv.style.height = wrap.clientHeight + "px";
    let _clusterMode = "auto";
    try {
      const s = localStorage.getItem(NT_GROUP_CLUSTER_KEY);
      if (s === "auto" || s === "columns" || s === "rows" || s === "off") {
        _clusterMode = s;
      }
    } catch (e) {
    }
    const _useCluster = !_groupViewActive && groupNames.length >= 2 && _clusterMode !== "off";
    const _initialLayout = _useCluster ? { name: "preset", positions: function() {
      return void 0;
    }, fit: false } : buildLayoutConfig(loadLayout(), nodes, edges, false);
    const cy = cytoscape({
      container: cyDiv,
      elements,
      style: buildCytoscapeStyle(dark),
      layout: _initialLayout,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      minZoom: 0.1,
      maxZoom: 4,
      // Performance bei grossen Graphen (~150-200+ Hosts): Kanten waehrend
      // Pan/Zoom ausblenden und den Viewport als Textur cachen -> deutlich
      // fluessigeres Pannen/Zoomen. motionBlur aus (Default) gegen Ghosting.
      hideEdgesOnViewport: true,
      textureOnViewport: true,
      motionBlur: false,
      // Mobile: Long-Press auf einen Knoten öffnet das Kontextmenü.
      // Default 1000ms ist zu langsam, User-konfigurierbar 300/500/800ms.
      tapholdDuration: loadTapholdMs()
    });
    if (_useCluster) {
      const _innerLayout = loadLayout();
      setTimeout(function() {
        if (cy && !cy.destroyed()) {
          runGroupClusterLayout(cy, groupNames, _clusterMode, null, _innerLayout);
        }
      }, 50);
    }
    window._ntCy = cy;
    window._ntNodes = nodes;
    setTimeout(function() {
      if (cy && !cy.destroyed()) {
        cy.resize();
        cy.fit(cy.nodes(), 40);
      }
    }, 200);
    setTimeout(function() {
      if (cy && !cy.destroyed()) {
        cy.resize();
        cy.fit(cy.nodes(), 40);
      }
    }, 600);
    cy.one("layoutready", function() {
      const usedPreset = loadPositions && Object.keys(loadPositions()).length > 0;
      if (usedPreset) {
        setTimeout(function() {
          if (window._ntCy) {
            window._ntCy.resize();
            window._ntCy.fit(window._ntCy.nodes(), 40);
          }
        }, 300);
      }
    });
    cy.on("tap", "node[!isGroup]", function(e) {
      if (e.target.data("_isInternet")) return;
      if (isLinkModeActive()) {
        const node = e.target;
        const first = getLinkFirst();
        if (!first) {
          setLinkFirst(node);
          node.style("underlay-color", "#3b82f6");
          node.style("underlay-opacity", 0.35);
          node.style("underlay-padding", 8);
          const bLinkBtn = document.getElementById("nt-btn-link");
          if (bLinkBtn) bLinkBtn.textContent = t("tech.link.targets");
          cy.nodes("[!isGroup]").forEach(function(n) {
            if (n.id() !== node.id()) n.style("opacity", 0.25);
          });
        } else {
          if (first.id() === node.id()) {
            exitLinkMode();
            return;
          }
          const s = first.id(), t2 = node.id();
          const eid = "ml_" + s + "_" + t2;
          const eid2 = "ml_" + t2 + "_" + s;
          if (!cy.getElementById(eid).length && !cy.getElementById(eid2).length) {
            const ml = edgeLabel(cy, s, t2);
            cy.add({ data: { id: eid, source: s, target: t2, tLabel: ml, trafficIn: 0, trafficOut: 0 } });
            const lnks = loadLinks();
            lnks.push({ s, t: t2 });
            saveLinks(lnks);
            node.style("opacity", 1);
            node.style("underlay-color", "#22c55e");
            node.style("underlay-opacity", 0.3);
            node.style("underlay-padding", 6);
            setTimeout(function() {
              node.style("underlay-opacity", 0);
            }, 600);
          }
        }
        return;
      }
      const clickedId = e.target.id();
      if (!isPathActive()) {
        if (getActiveHighlightId() === clickedId) {
          resetHighlight(cy);
        } else {
          applyHighlight(cy, clickedId);
        }
      }
      showDetail(pnl, e.target.data(), cy);
    });
    cy.on("mouseover", "node[!isGroup]", function(e) {
      if (e.target.data("_isInternet")) return;
      showTip(e, e.target.data());
    });
    cy.on("mousemove", "node[!isGroup]", function(e) {
      moveTip(e);
    });
    cy.on("mouseout", "node[!isGroup]", function() {
      hideTip();
    });
    cy.on("mouseover", "edge", function(e) {
      const ed = e.target.data();
      if (ed._isInternetEdge) return;
      const src = e.target.source();
      const tgt = e.target.target();
      if (!src || !tgt) return;
      showEdgeTip(e, ed, src.data("label") || src.id(), tgt.data("label") || tgt.id());
    });
    cy.on("mousemove", "edge", function(e) {
      moveTip(e);
    });
    cy.on("mouseout", "edge", function() {
      hideTip();
    });
    cy.on("tap", function(e) {
      hideTip();
      if (e.target === cy) {
        if (pnl) pnl.style.display = "none";
        hideCtx();
        resetHighlight(cy);
        clearPathState(cy);
      }
    });
    cy.on("cxttap", "node[!isGroup]", function(e) {
      const oe = e.originalEvent;
      if (oe) oe.preventDefault();
      hideTip();
      if (e.target.data("_isInternet")) return;
      const pos = oe ? { x: oe.clientX, y: oe.clientY } : e.renderedPosition;
      showCtx(pos.x, pos.y, e.target.data());
    });
    cy.on("taphold", "node[!isGroup]", function(e) {
      hideTip();
      if (e.target.data("_isInternet")) return;
      const oe = e.originalEvent;
      let cx, cy2;
      if (oe && oe.touches && oe.touches[0]) {
        cx = oe.touches[0].clientX;
        cy2 = oe.touches[0].clientY;
      } else if (oe && oe.clientX !== void 0) {
        cx = oe.clientX;
        cy2 = oe.clientY;
      } else {
        const r = e.renderedPosition;
        cx = r.x;
        cy2 = r.y;
      }
      showCtx(cx, cy2, e.target.data());
    });
    _setupToolbar(cy, wrap, nodes, groupNames, dark, useLayout);
    ensureBaseToolbar(wrap);
    setupLegend(groupNames, nodes);
    setupBottomLegend(wrap, dark);
    updateBadge(nodes);
    destroyGroupHulls(wrap);
    if (_useCluster) {
      setupGroupHulls(cy, wrap);
    }
    nodes.forEach(function(n) {
      if (n._historyDimmed) {
        const cyNode = cy.getElementById(String(n.id));
        if (cyNode && cyNode.length) {
          cyNode.style("opacity", 0.25);
        }
      }
    });
    startEdgeAnimation(cy, nodes);
    setTimeout(function() {
      applyTrafficHeatmap(cy);
      applyPortLabels(cy);
    }, 1800);
    setupMinimap(cy, wrap);
    applyManualLinks(cy);
    showMinimap();
    (function() {
      const pinned = loadPinned();
      const notes = loadNotes();
      clearImgCache();
      cy.nodes("[!isGroup]").forEach(function(n) {
        const isPinned = pinned.indexOf(n.id()) >= 0;
        const note = notes[n.id()] || "";
        n.data("pinned", isPinned);
        n.data("note", note);
        n.data("bgImage", makeNodeImage(n.data()));
        if (isPinned) n.lock();
      });
    })();
    cy.on("dragfree", "node[!isGroup]", function() {
      clearTimeout(_posSaveTimer);
      _posSaveTimer = setTimeout(function() {
        savePositions(cy);
      }, 400);
    });
    cy.on("grab", "node[!isGroup]", function() {
      window._ntDragActive = true;
    });
    cy.on("dragfree", "node[!isGroup]", function() {
      clearTimeout(window._ntDragReleaseTimer);
      window._ntDragReleaseTimer = setTimeout(function() {
        window._ntDragActive = false;
      }, 1e3);
    });
    cy.one("layoutstop", function() {
      setTimeout(function() {
        if (window._ntCy) {
          savePositions(window._ntCy);
          window._ntCy.fit(window._ntCy.nodes(), 40);
          applyTrafficHeatmap(window._ntCy);
          applyPortLabels(window._ntCy);
        }
      }, 800);
    });
    if (window._ntRefreshTimer) clearInterval(window._ntRefreshTimer);
    _clearRefreshWarn();
    window._ntRefreshTimer = setInterval(function() {
      if (window._ntRefreshOn === false || !window._ntCy) return;
      if (window._ntDragActive) return;
      fetch(dataUrl, {
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" }
      }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (!data || !data.nodes) {
          _markRefresh(false);
          return;
        }
        _markRefresh(true);
        window._ntLastData = window._ntLastData || {};
        window._ntLastData.nodes = data.nodes;
        window._ntLastData.edges = data.edges || [];
        window._ntLastData.lldp_quality = data.lldp_quality || [];
        notifyTopoChanges(data.topo_changes);
        let inGroupView = false;
        try {
          inGroupView = localStorage.getItem(NT_GROUP_VIEW_KEY) === "1";
        } catch (e) {
        }
        if (inGroupView) {
          render(wrap, data.nodes.slice(), (data.edges || []).slice(), dataUrl);
          return;
        }
        const map = {};
        (data.nodes || []).forEach(function(n) {
          map[String(n.id)] = n;
        });
        clearImgCache();
        cy.nodes("[!isGroup]").forEach(function(node) {
          const u = map[node.id()];
          if (!u) return;
          node.data("severity", u.severity || 0);
          node.data("cpu", u.cpu);
          node.data("memory", u.memory);
          node.data("ping", u.ping);
          node.data("traffic", u.traffic);
          if (u.problems !== void 0) node.data("problems", u.problems);
          if ("acknowledged" in u) node.data("acknowledged", !!u.acknowledged);
          if ("maintenance" in u) node.data("maintenance", !!u.maintenance);
          if ("extra_items" in u) node.data("extra_items", u.extra_items || []);
          if ("unavailable" in u) node.data("unavailable", !!u.unavailable);
          if ("down_since" in u) node.data("down_since", u.down_since || 0);
          if ("last_seen" in u) node.data("last_seen", u.last_seen || 0);
          node.data("bgImage", makeNodeImage(node.data()));
        });
        updateBadge(data.nodes || []);
        window._ntCy && window._ntCy.edges('[id^="ml_"]').forEach(function(e) {
          e.data("tLabel", edgeLabel(window._ntCy, e.source().id(), e.target().id()));
        });
        applyTrafficHeatmap(window._ntCy);
        if (isSimActive()) recomputeSimulation(window._ntCy);
        if (isRootCauseActive()) runRootCause(window._ntCy, false);
      }).catch(function() {
        _markRefresh(false);
      });
    }, 3e4);
  }

  // assets/js/modules/geo-providers.js
  var GEO_PROVIDERS = [
    {
      id: "osm",
      label: "OpenStreetMap Mapnik",
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    },
    {
      id: "opentopomap",
      label: "OpenTopoMap",
      url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
      maxZoom: 17,
      subdomains: "abc"
    },
    {
      id: "stamen-toner",
      label: "Stamen Toner Lite (API-Key!)",
      url: "https://tiles.stadiamaps.com/tiles/stamen_toner_lite/{z}/{x}/{y}{r}.png",
      attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://stamen.com/">Stamen Design</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 20,
      warning: "Stamen-Tiles ben\xF6tigen seit 2023 einen Stadia-Maps-Account. Ohne Domain-Whitelist erscheinen Auth-Warning-Tiles. Kostenloser Account: https://stadiamaps.com/"
    },
    {
      id: "stamen-terrain",
      label: "Stamen Terrain (API-Key!)",
      url: "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png",
      attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://stamen.com/">Stamen Design</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
      warning: "Stamen-Tiles ben\xF6tigen seit 2023 einen Stadia-Maps-Account. Ohne Domain-Whitelist erscheinen Auth-Warning-Tiles. Kostenloser Account: https://stadiamaps.com/"
    },
    {
      id: "usgs-topo",
      label: "USGS US Topo",
      url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
      attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>',
      maxZoom: 16
    },
    {
      id: "usgs-imagery",
      label: "USGS US Imagery",
      url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
      attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>',
      maxZoom: 16
    }
  ];
  function getProvider(id) {
    return GEO_PROVIDERS.find(function(p) {
      return p.id === id;
    }) || GEO_PROVIDERS[0];
  }

  // assets/js/modules/render-geo.js
  var _map = null;
  var _markerLayer = null;
  var _edgeLayer = null;
  var _tileLayer = null;
  function buildMarkerIcon(node) {
    const sev = node.severity || 0;
    const isOff = !!node.unavailable;
    const col = isOff ? "#9ca3af" : SEV_COL[Math.min(sev, SEV_COL.length - 1)] || SEV_COL[0];
    const probs = node.problems || 0;
    const r = Math.min(12 + probs, 24);
    const opacity = isOff ? 0.6 : node.maintenance ? 0.55 : 1;
    const ackRing = node.acknowledged ? '<circle cx="' + (r + 2) + '" cy="' + (r + 2) + '" r="' + (r - 1) + '" fill="none" stroke="#22c55e" stroke-width="2.5" opacity="0.9"/>' : "";
    const offX = isOff ? '<g transform="translate(' + (r + 2) + "," + (r + 2) + ')" stroke="#e53742" stroke-width="3" stroke-linecap="round"><line x1="-' + r * 0.5 + '" y1="-' + r * 0.5 + '" x2="' + r * 0.5 + '" y2="' + r * 0.5 + '"/><line x1="' + r * 0.5 + '" y1="-' + r * 0.5 + '" x2="-' + r * 0.5 + '" y2="' + r * 0.5 + '"/></g>' : "";
    const html = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (r + 2) * 2 + '" height="' + (r + 2) * 2 + '" style="opacity:' + opacity + '"><circle cx="' + (r + 2) + '" cy="' + (r + 2) + '" r="' + r + '" fill="' + col + '" stroke="white" stroke-width="2"/>' + ackRing + offX + (probs > 0 && !isOff ? '<text x="' + (r + 2) + '" y="' + (r + 2) + '" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="' + (probs > 9 ? 9 : 11) + '" font-weight="700" fill="white">' + (probs > 99 ? "99+" : probs) + "</text>" : "") + "</svg>";
    return L.divIcon({
      html,
      className: "nt-geo-marker",
      iconSize: [(r + 2) * 2, (r + 2) * 2],
      iconAnchor: [r + 2, r + 2]
    });
  }
  function buildPopup(node) {
    const sev = node.severity || 0;
    const col = SEV_COL[Math.min(sev, SEV_COL.length - 1)] || SEV_COL[0];
    const lbl = SEV_LBL[sev] || "Normal";
    const tr = node.traffic || { in: 0, out: 0 };
    function mk(tag, css, text) {
      const e = document.createElement(tag);
      if (css) e.style.cssText = css;
      if (text !== void 0) e.textContent = text;
      return e;
    }
    const root = mk("div", "font-family:sans-serif;min-width:200px");
    root.appendChild(mk(
      "div",
      "font-weight:700;color:#0f172a;margin-bottom:4px",
      node.label || ""
    ));
    if (node.ip) {
      root.appendChild(mk(
        "div",
        "font-size:10px;color:#64748b;font-family:monospace",
        node.ip
      ));
    }
    if (node.location) {
      root.appendChild(mk(
        "div",
        "font-size:10px;color:#64748b;margin-top:2px",
        "\u{1F4CD} " + node.location
      ));
    }
    if (node.maintenance || node.acknowledged) {
      const row = mk("div", "margin-top:4px");
      if (node.maintenance) {
        row.appendChild(mk(
          "span",
          "background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;margin-right:4px",
          "\u{1F527} Wartung"
        ));
      }
      if (node.acknowledged) {
        row.appendChild(mk(
          "span",
          "background:#dcfce7;color:#166534;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;margin-right:4px",
          "\u2714 Acked"
        ));
      }
      root.appendChild(row);
    }
    const stats = mk(
      "div",
      "margin-top:6px;padding-top:6px;border-top:1px solid #f1f5f9;font-size:11px;color:#334155"
    );
    const sevLine = mk("div");
    sevLine.appendChild(mk("span", "color:" + col + ";font-weight:600", "\u25CF " + lbl));
    if (node.problems > 0) {
      sevLine.appendChild(document.createTextNode("   "));
      sevLine.appendChild(mk("b", "color:#ef4444", String(node.problems)));
      sevLine.appendChild(document.createTextNode(" Probleme"));
    }
    stats.appendChild(sevLine);
    function metric(label, val) {
      const r = mk("div");
      r.textContent = label + ": ";
      r.appendChild(mk("b", "", String(val)));
      stats.appendChild(r);
    }
    if (node.cpu != null) metric("CPU", node.cpu + "%");
    if (node.memory != null) metric("RAM", node.memory + "%");
    if (node.ping > 0) metric("Ping", node.ping + " ms");
    if (tr.in || tr.out) {
      const r = mk("div");
      r.textContent = "Traffic: ";
      r.appendChild(mk("span", "color:#22c55e", "\u2193 " + fmt(tr.in)));
      r.appendChild(document.createTextNode(" "));
      r.appendChild(mk("span", "color:#06b6d4", "\u2191 " + fmt(tr.out)));
      stats.appendChild(r);
    }
    root.appendChild(stats);
    return root;
  }
  function showToast(message) {
    const existing = document.getElementById("nt-toast");
    if (existing) existing.remove();
    const toast2 = document.createElement("div");
    toast2.id = "nt-toast";
    toast2.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:10001;background:#fef3c7;color:#92400e;padding:12px 18px;border-radius:8px;font-size:13px;line-height:1.5;max-width:520px;box-shadow:0 4px 16px rgba(0,0,0,0.2);border:1px solid #f59e0b;cursor:pointer;font-family:sans-serif";
    toast2.textContent = "\u26A0 " + message;
    toast2.title = "Klicken zum Schliessen";
    toast2.addEventListener("click", function() {
      toast2.remove();
    });
    document.body.appendChild(toast2);
    setTimeout(function() {
      if (toast2 && toast2.parentNode) toast2.remove();
    }, 6e3);
  }
  function switchProvider(providerId) {
    if (!_map) return;
    saveGeoProvider(providerId);
    if (_tileLayer) _map.removeLayer(_tileLayer);
    const p = getProvider(providerId);
    const opts = { maxZoom: p.maxZoom || 19, attribution: p.attribution };
    if (p.subdomains) opts.subdomains = p.subdomains;
    _tileLayer = L.tileLayer(p.url, opts).addTo(_map);
    if (p.warning) showToast(p.warning);
  }
  function rebuildMarkersAndEdges(geoNodes, edges) {
    if (!_markerLayer || !_edgeLayer) return;
    _markerLayer.clearLayers();
    _edgeLayer.clearLayers();
    const nodePos = {};
    geoNodes.forEach(function(n) {
      nodePos[String(n.id)] = [n.lat, n.lon];
    });
    geoNodes.forEach(function(node) {
      const marker = L.marker([node.lat, node.lon], {
        icon: buildMarkerIcon(node),
        riseOnHover: true,
        title: node.label
      });
      marker.bindPopup(buildPopup(node), { maxWidth: 280 });
      marker.addTo(_markerLayer);
    });
    edges.forEach(function(e) {
      const src = String(e.source || e.from || "");
      const tgt = String(e.target || e.to || "");
      const a = nodePos[src], b = nodePos[tgt];
      if (!a || !b) return;
      L.polyline([a, b], {
        color: "#22c55e",
        weight: 2,
        opacity: 0.6,
        dashArray: "6,5"
      }).addTo(_edgeLayer);
    });
  }
  function cleanupGeo() {
    if (window._ntGeoRefreshTimer) {
      clearInterval(window._ntGeoRefreshTimer);
      window._ntGeoRefreshTimer = null;
    }
    if (_map) {
      try {
        _map.remove();
      } catch (e) {
      }
      _map = null;
    }
    _markerLayer = null;
    _edgeLayer = null;
    _tileLayer = null;
  }
  var _leafletPromise = null;
  function ensureLeaflet() {
    if (window.L) return Promise.resolve();
    if (_leafletPromise) return _leafletPromise;
    const BASE = "modules/network_topology_v6/assets/js/leaflet/";
    _leafletPromise = new Promise(function(resolve, reject) {
      if (!document.getElementById("nt-leaflet-css")) {
        const link = document.createElement("link");
        link.id = "nt-leaflet-css";
        link.rel = "stylesheet";
        link.href = BASE + "leaflet.css";
        document.head.appendChild(link);
      }
      const s = document.createElement("script");
      s.src = BASE + "leaflet.js";
      s.onload = function() {
        resolve();
      };
      s.onerror = function() {
        _leafletPromise = null;
        reject(new Error("leaflet.js konnte nicht geladen werden"));
      };
      document.head.appendChild(s);
    });
    return _leafletPromise;
  }
  function renderGeo(wrap, nodes, edges, dataUrl) {
    if (window._ntCy) {
      try {
        window._ntCy.destroy();
      } catch (e) {
      }
      window._ntCy = null;
    }
    if (window._ntEdgeAnim) {
      clearInterval(window._ntEdgeAnim);
      window._ntEdgeAnim = null;
    }
    if (window._ntRefreshTimer) {
      clearInterval(window._ntRefreshTimer);
      window._ntRefreshTimer = null;
    }
    if (window._ntMinimapTimer) {
      clearInterval(window._ntMinimapTimer);
      window._ntMinimapTimer = null;
    }
    cleanupGeo();
    window._ntToolbarDone = false;
    Array.from(wrap.children).forEach(function(ch) {
      if (ch.id !== "nt-loading") wrap.removeChild(ch);
    });
    const geoNodes = nodes.filter(function(n) {
      return typeof n.lat === "number" && typeof n.lon === "number" && !isNaN(n.lat) && !isNaN(n.lon) && n.lat >= -90 && n.lat <= 90 && n.lon >= -180 && n.lon <= 180;
    });
    const totalHosts = nodes.length;
    const geoHosts = geoNodes.length;
    if (geoHosts === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#64748b;text-align:center;padding:40px";
      empty.innerHTML = '<div style="font-size:48px;margin-bottom:16px">\u{1F5FA}\uFE0F</div><div style="font-size:16px;font-weight:600;color:#334155;margin-bottom:8px">Keine Hosts mit Geo-Koordinaten</div><div style="font-size:13px;max-width:480px;line-height:1.5">Setze in <b>Configuration \u2192 Hosts \u2192 Inventory</b> die Felder <code>Location latitude</code> und <code>Location longitude</code> (als Dezimalwerte, z.\u202FB. <code>49.4521, 7.0064</code>).<br><br>Geomap zeigt nur Hosts mit beiden Werten.</div>';
      wrap.appendChild(empty);
      return;
    }
    const container = document.createElement("div");
    container.style.cssText = "position:relative;width:100%;height:100%";
    wrap.appendChild(container);
    if (geoHosts < totalHosts) {
      const missing = totalHosts - geoHosts;
      const banner = document.createElement("div");
      banner.style.cssText = "position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:1000;background:#fef3c7;color:#92400e;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:500;box-shadow:0 2px 6px rgba(0,0,0,0.15);border:1px solid #f59e0b";
      banner.textContent = "\u26A0 " + missing + " von " + totalHosts + " Hosts haben keine Geo-Koordinaten";
      container.appendChild(banner);
    }
    const switcher = document.createElement("div");
    switcher.style.cssText = "position:absolute;top:8px;right:8px;z-index:1000;background:white;border:1px solid #e2e8f0;border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,0.12);padding:4px 6px";
    const sel = document.createElement("select");
    sel.style.cssText = "border:none;outline:none;background:transparent;font-size:12px;cursor:pointer";
    GEO_PROVIDERS.forEach(function(p) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      sel.appendChild(opt);
    });
    const currentProvider = loadGeoProvider();
    sel.value = currentProvider;
    sel.addEventListener("change", function() {
      switchProvider(sel.value);
    });
    switcher.appendChild(sel);
    container.appendChild(switcher);
    const mapDiv = document.createElement("div");
    mapDiv.style.cssText = "width:100%;height:100%";
    container.appendChild(mapDiv);
    ensureLeaflet().then(function() {
      if (!mapDiv.isConnected) return;
      _map = L.map(mapDiv, { zoomControl: true, attributionControl: true });
      const p = getProvider(currentProvider);
      const opts = { maxZoom: p.maxZoom || 19, attribution: p.attribution };
      if (p.subdomains) opts.subdomains = p.subdomains;
      _tileLayer = L.tileLayer(p.url, opts).addTo(_map);
      _markerLayer = L.layerGroup().addTo(_map);
      _edgeLayer = L.layerGroup().addTo(_map);
      rebuildMarkersAndEdges(geoNodes, edges);
      if (geoNodes.length === 1) {
        _map.setView([geoNodes[0].lat, geoNodes[0].lon], 13);
      } else {
        const bounds = L.latLngBounds(geoNodes.map(function(n) {
          return [n.lat, n.lon];
        }));
        _map.fitBounds(bounds, { padding: [40, 40] });
      }
      setTimeout(function() {
        if (_map) _map.invalidateSize();
      }, 100);
      setTimeout(function() {
        if (_map) _map.invalidateSize();
      }, 500);
      if (dataUrl && window._ntRefreshOn !== false) {
        window._ntGeoRefreshTimer = setInterval(function() {
          if (window._ntRefreshOn === false || !_map) return;
          fetch(dataUrl, {
            credentials: "same-origin",
            headers: { "X-Requested-With": "XMLHttpRequest" }
          }).then(function(r) {
            return r.json();
          }).then(function(data) {
            if (!data || !data.nodes) return;
            window._ntLastData = window._ntLastData || {};
            window._ntLastData.nodes = data.nodes;
            window._ntLastData.edges = data.edges || [];
            const fresh = data.nodes.filter(function(n) {
              return typeof n.lat === "number" && typeof n.lon === "number" && !isNaN(n.lat) && !isNaN(n.lon);
            });
            rebuildMarkersAndEdges(fresh, data.edges || []);
          }).catch(function() {
          });
        }, 3e4);
      }
    }).catch(function(err) {
      if (mapDiv) mapDiv.textContent = "Leaflet konnte nicht geladen werden: " + String(err && err.message || err);
    });
  }

  // assets/js/modules/render-diag.js
  function _bytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }
  function _ago(ts) {
    const sec = Math.max(0, Math.floor(Date.now() / 1e3) - ts);
    if (sec < 60) return sec + "s";
    if (sec < 3600) return Math.floor(sec / 60) + "m";
    return Math.floor(sec / 3600) + "h " + Math.floor(sec % 3600 / 60) + "m";
  }
  function _aggStats(entries) {
    const byAction = {};
    entries.forEach(function(e) {
      const a = e.action || "?";
      if (!byAction[a]) byAction[a] = { count: 0, totMs: 0, maxMs: 0, totBytes: 0, hits: 0 };
      byAction[a].count++;
      byAction[a].totMs += e.elapsed_ms || 0;
      byAction[a].maxMs = Math.max(byAction[a].maxMs, e.elapsed_ms || 0);
      byAction[a].totBytes += e.bytes || 0;
      if (e.cache_hit) byAction[a].hits++;
    });
    return byAction;
  }
  function _buildSummary(byAction, theme) {
    const actions = Object.keys(byAction).sort();
    if (actions.length === 0) return '<div style="color:' + theme.subSoft + '">Keine Eintraege.</div>';
    let html = '<table style="border-collapse:collapse;font-size:12px;width:auto"><thead><tr style="border-bottom:1px solid ' + theme.border + '">' + ["Action", "Count", "Avg ms", "Max ms", "Avg Size", "Cache Hit"].map(function(h) {
      return '<th style="padding:6px 14px;text-align:left;color:' + theme.sub + ';font-weight:600">' + h + "</th>";
    }).join("") + "</tr></thead><tbody>";
    actions.forEach(function(a) {
      const s = byAction[a];
      const avg = s.count > 0 ? s.totMs / s.count : 0;
      const avgBytes = s.count > 0 ? s.totBytes / s.count : 0;
      const hitRate = s.count > 0 ? Math.round(100 * s.hits / s.count) : 0;
      const slowCol = s.maxMs > 1e3 ? "#dc2626" : s.maxMs > 500 ? "#f59e0b" : theme.text;
      html += '<tr style="border-bottom:1px solid ' + theme.borderSoft + '"><td style="padding:4px 14px;font-weight:600">' + esc(a) + '</td><td style="padding:4px 14px;text-align:right">' + s.count + '</td><td style="padding:4px 14px;text-align:right">' + avg.toFixed(1) + '</td><td style="padding:4px 14px;text-align:right;color:' + slowCol + ';font-weight:600">' + s.maxMs.toFixed(1) + '</td><td style="padding:4px 14px;text-align:right">' + _bytes(avgBytes) + '</td><td style="padding:4px 14px;text-align:right">' + (s.hits > 0 ? hitRate + "% (" + s.hits + "/" + s.count + ")" : "\u2014") + "</td></tr>";
    });
    return html + "</tbody></table>";
  }
  function _buildLog(entries, theme) {
    if (!entries.length) {
      return '<div style="color:' + theme.subSoft + ';padding:20px 0">Noch keine Aufrufe protokolliert. Wechsel auf einen anderen Tab und zurueck \u2014 dann tauchen Eintraege auf.</div>';
    }
    const rows = entries.slice().reverse().map(function(e) {
      const slowCol = (e.elapsed_ms || 0) > 1e3 ? "#dc2626" : (e.elapsed_ms || 0) > 500 ? "#f59e0b" : theme.text;
      const cacheLbl = e.cache_hit ? '<span style="color:#16a34a">HIT</span>' : '<span style="color:' + theme.subSoft + '">\u2014</span>';
      const countsStr = e.counts ? Object.keys(e.counts).map(function(k) {
        return k + ":" + e.counts[k];
      }).join(", ") : "";
      return '<tr style="border-bottom:1px solid ' + theme.borderSoft + '"><td style="padding:4px 12px;color:' + theme.sub + ';font-family:monospace">' + _ago(e.ts) + '</td><td style="padding:4px 12px;font-weight:600">' + esc(e.action || "?") + '</td><td style="padding:4px 12px;text-align:right;color:' + slowCol + ';font-family:monospace">' + (e.elapsed_ms || 0).toFixed(1) + ' ms</td><td style="padding:4px 12px;text-align:right;font-family:monospace">' + _bytes(e.bytes || 0) + '</td><td style="padding:4px 12px;text-align:center">' + cacheLbl + '</td><td style="padding:4px 12px;color:' + theme.sub + ';font-family:monospace;font-size:11px">' + esc(countsStr) + "</td></tr>";
    }).join("");
    return '<table style="border-collapse:collapse;font-size:12px;width:100%"><thead><tr style="border-bottom:1px solid ' + theme.border + '">' + ["vor", "Action", "Latenz", "Size", "Cache", "Counts"].map(function(h) {
      return '<th style="padding:6px 12px;text-align:left;color:' + theme.sub + ';font-weight:600">' + h + "</th>";
    }).join("") + "</tr></thead><tbody>" + rows + "</tbody></table>";
  }
  function renderDiag(wrap) {
    if (window._ntCy) {
      try {
        window._ntCy.destroy();
      } catch (e) {
      }
      window._ntCy = null;
    }
    if (window._ntEdgeAnim) {
      clearInterval(window._ntEdgeAnim);
      window._ntEdgeAnim = null;
    }
    const dark = !!(document.getElementById("nt-root") && document.getElementById("nt-root").classList.contains("nt-dark"));
    const theme = mkTabTheme(dark);
    Array.from(wrap.children).forEach(function(ch) {
      if (ch.id !== "nt-loading") wrap.removeChild(ch);
    });
    const root = document.createElement("div");
    root.style.cssText = "padding:20px;background:" + theme.bg + ";color:" + theme.text + ";height:100%;overflow:auto;font-family:sans-serif";
    const head = document.createElement("div");
    head.innerHTML = '<h2 style="margin:0 0 6px;font-size:16px">Diagnose</h2><div style="font-size:12px;color:' + theme.sub + ';margin-bottom:18px">Backend-Aufrufe der letzten Stunde aus APCu-Ring-Buffer (Super-Admin only). Latenz > 1000 ms rot, > 500 ms orange.</div>';
    root.appendChild(head);
    const summaryWrap = document.createElement("div");
    summaryWrap.style.marginBottom = "24px";
    const summaryHead = document.createElement("div");
    summaryHead.innerHTML = '<h3 style="margin:0 0 8px;font-size:13px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.04em">Zusammenfassung</h3>';
    summaryWrap.appendChild(summaryHead);
    const summaryBody = document.createElement("div");
    summaryBody.innerHTML = '<div style="color:' + theme.subSoft + '">Laedt...</div>';
    summaryWrap.appendChild(summaryBody);
    root.appendChild(summaryWrap);
    const logHead = document.createElement("div");
    logHead.innerHTML = '<h3 style="margin:0 0 8px;font-size:13px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.04em">Letzte Aufrufe</h3>';
    root.appendChild(logHead);
    const logBody = document.createElement("div");
    logBody.innerHTML = '<div style="color:' + theme.subSoft + '">Laedt...</div>';
    root.appendChild(logBody);
    wrap.appendChild(root);
    const url = buildBaseUrl() + "zabbix.php?action=network.topology.v6.diag";
    fetch(url, {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    }).then(function(r) {
      return r.json();
    }).then(function(data) {
      if (data.error) {
        summaryBody.innerHTML = '<div style="color:#dc2626">' + esc(data.error) + "</div>";
        logBody.innerHTML = "";
        return;
      }
      if (!data.apcu) {
        summaryBody.innerHTML = '<div style="color:#f59e0b">APCu ist auf dem Server nicht aktiv \u2014 Diagnose-Daten koennen nicht gespeichert werden.</div>';
        logBody.innerHTML = "";
        return;
      }
      const entries = data.entries || [];
      summaryBody.innerHTML = _buildSummary(_aggStats(entries), theme);
      logBody.innerHTML = _buildLog(entries, theme);
    }).catch(function(e) {
      summaryBody.innerHTML = '<div style="color:#dc2626">Fehler: ' + esc(e.message) + "</div>";
      logBody.innerHTML = "";
    });
  }

  // assets/js/modules/render-health.js
  var STALE_S = 300;
  var COL_OK = "#16a34a";
  var COL_WARN = "#f59e0b";
  var COL_BAD = "#f97316";
  var COL_CRIT = "#dc2626";
  function _scoreColor(s) {
    if (s >= 85) return COL_OK;
    if (s >= 65) return COL_WARN;
    if (s >= 40) return COL_BAD;
    return COL_CRIT;
  }
  function _scoreLabel(s) {
    if (s >= 85) return t("health.lbl.healthy");
    if (s >= 65) return t("health.lbl.ok");
    if (s >= 40) return t("health.lbl.warn");
    return t("health.lbl.critical");
  }
  function statsByGroup(nodes) {
    return _statsByGroup(nodes);
  }
  function scoreColor(s) {
    return _scoreColor(s);
  }
  function scoreLabel(s) {
    return _scoreLabel(s);
  }
  function _statsByGroup(nodes) {
    const now = Math.floor(Date.now() / 1e3);
    const byGroup = {};
    (nodes || []).forEach(function(n) {
      if (n._isInternet) return;
      (n.groups || []).forEach(function(g) {
        if (!g) return;
        if (!byGroup[g]) byGroup[g] = {
          name: g,
          total: 0,
          offline: 0,
          stale: 0,
          critical: 0,
          unacked: 0,
          worstSev: 0,
          problems: 0
        };
        const s = byGroup[g];
        s.total++;
        const isOff = !!n.unavailable;
        if (isOff) s.offline++;
        const age = n.last_seen ? now - n.last_seen : 0;
        if (!isOff && n.last_seen > 0 && age > STALE_S) s.stale++;
        if ((n.severity || 0) >= 4) s.critical++;
        if ((n.problems || 0) > 0 && !n.acknowledged) s.unacked++;
        if ((n.severity || 0) > s.worstSev) s.worstSev = n.severity || 0;
        s.problems += n.problems || 0;
      });
    });
    Object.values(byGroup).forEach(function(s) {
      const t2 = Math.max(1, s.total);
      let score = 100 - s.offline / t2 * 40 - s.stale / t2 * 15 - s.critical / t2 * 25 - s.unacked / t2 * 20;
      s.score = Math.max(0, Math.min(100, Math.round(score)));
    });
    return Object.values(byGroup);
  }
  function _card(s, theme) {
    const col = _scoreColor(s.score);
    const lbl = _scoreLabel(s.score);
    function metric(num, txt, color) {
      const c = num > 0 ? color : theme.subSoft;
      return '<div style="display:flex;flex-direction:column;align-items:center;min-width:42px"><span style="font-size:17px;font-weight:700;color:' + c + ';font-family:monospace">' + num + '</span><span style="font-size:9px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.03em">' + esc(txt) + "</span></div>";
    }
    return '<div style="background:' + theme.surface + ";border:1px solid " + theme.border + ";border-left:4px solid " + col + ';border-radius:6px;padding:12px 14px;display:flex;align-items:center;gap:14px;min-width:0;overflow:hidden"><div style="display:flex;flex-direction:column;align-items:center;min-width:70px;flex-shrink:0"><span style="font-size:34px;font-weight:700;color:' + col + ';line-height:1;font-family:monospace">' + s.score + '</span><span style="font-size:10px;color:' + col + ';font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-top:3px">' + esc(lbl) + '</span></div><div style="flex:1;display:flex;flex-direction:column;gap:6px;min-width:0"><div style="font-size:13px;font-weight:700;color:' + theme.text + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(s.name) + '">' + esc(s.name) + ' <span style="font-weight:400;color:' + theme.sub + '">\xB7 ' + s.total + " " + esc(t("health.hosts")) + '</span></div><div style="display:flex;gap:8px;flex-wrap:wrap">' + metric(s.offline, t("health.m.offline"), COL_CRIT) + metric(s.stale, t("health.m.stale"), COL_WARN) + metric(s.critical, t("health.m.critical"), COL_CRIT) + metric(s.unacked, t("health.m.unacked"), COL_BAD) + metric(s.problems, t("health.m.problems"), theme.text) + "</div></div></div>";
  }
  var HIST_DAYS = 14;
  function _loadScoreHistory(box, theme) {
    const params = new URLSearchParams();
    params.append("action", "network.topology.v6.health_history");
    params.append("days", String(HIST_DAYS));
    fetch(
      buildBaseUrl() + "zabbix.php?" + params.toString(),
      { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } }
    ).then(function(r) {
      return r.json();
    }).then(function(data) {
      if (!box.isConnected) return;
      if (data.error || !data.item_found || !(data.avg || []).length) {
        box.innerHTML = '<div style="font-size:11px;color:' + theme.subSoft + '">' + esc(t("health.hist.hint")) + "</div>";
        return;
      }
      box.innerHTML = _histChart(data, theme);
    }).catch(function() {
    });
  }
  function _histChart(data, theme) {
    const avg = data.avg, mn = data.min || [];
    const W = 720, H = 110, padL = 30, padR = 8, padT = 8, padB = 18;
    const iw = W - padL - padR, ih = H - padT - padB;
    const from = avg[0][0];
    const to = avg[avg.length - 1][0];
    const span = Math.max(1, to - from);
    function pts(series) {
      return series.map(function(p) {
        const x = padL + (p[0] - from) / span * iw;
        const v = Math.max(0, Math.min(100, p[1]));
        const y = padT + ih * (1 - v / 100);
        return x.toFixed(1) + "," + y.toFixed(1);
      }).join(" ");
    }
    let grid = "";
    [[85, COL_OK], [65, COL_WARN], [40, COL_BAD]].forEach(function(g) {
      const y = padT + ih * (1 - g[0] / 100);
      grid += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="' + g[1] + '" stroke-width="0.5" opacity="0.45" stroke-dasharray="3 3"/><text x="' + (padL - 5) + '" y="' + (y + 3) + '" text-anchor="end" font-size="8" font-family="monospace" fill="' + theme.sub + '">' + g[0] + "</text>";
    });
    function dlbl(ts) {
      const d = new Date(ts * 1e3);
      return ("0" + d.getDate()).slice(-2) + "." + ("0" + (d.getMonth() + 1)).slice(-2) + ".";
    }
    const lastAvg = Math.round(avg[avg.length - 1][1]);
    const title = t("health.hist.title", {
      days: data.days || HIST_DAYS,
      avg: '<b style="color:' + _scoreColor(lastAvg) + '">' + lastAvg + "</b>"
    });
    let svg = '<svg width="' + W + '" height="' + H + '" style="display:block">' + grid + '<polyline fill="none" stroke="' + theme.accent + '" stroke-width="1.8" points="' + pts(avg) + '"/>';
    if (mn.length) {
      svg += '<polyline fill="none" stroke="' + COL_CRIT + '" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.7" points="' + pts(mn) + '"/>';
    }
    svg += '<text x="' + padL + '" y="' + (H - 5) + '" font-size="9" font-family="monospace" fill="' + theme.sub + '">' + dlbl(from) + '</text><text x="' + (W - padR) + '" y="' + (H - 5) + '" text-anchor="end" font-size="9" font-family="monospace" fill="' + theme.sub + '">' + dlbl(to) + "</text></svg>";
    let leg = '<div style="font-size:10px;color:' + theme.sub + ';display:flex;gap:12px;margin-top:2px"><span><span style="display:inline-block;width:14px;height:2px;background:' + theme.accent + ';vertical-align:middle;margin-right:4px"></span>' + esc(t("health.hist.avg")) + "</span>";
    if (mn.length) {
      leg += '<span><span style="display:inline-block;width:14px;height:2px;background:' + COL_CRIT + ';opacity:0.7;vertical-align:middle;margin-right:4px"></span>' + esc(t("health.hist.min")) + "</span>";
    }
    leg += "</div>";
    return '<div style="font-size:12px;color:' + theme.sub + ';margin-bottom:4px">' + title + '</div><div style="overflow-x:auto">' + svg + leg + "</div>";
  }
  function renderHealth(wrap, nodes) {
    if (window._ntCy) {
      try {
        window._ntCy.destroy();
      } catch (e) {
      }
      window._ntCy = null;
    }
    if (window._ntEdgeAnim) {
      clearInterval(window._ntEdgeAnim);
      window._ntEdgeAnim = null;
    }
    const dark = !!(document.getElementById("nt-root") && document.getElementById("nt-root").classList.contains("nt-dark"));
    const theme = mkTabTheme(dark);
    Array.from(wrap.children).forEach(function(ch) {
      if (ch.id !== "nt-loading") wrap.removeChild(ch);
    });
    const root = document.createElement("div");
    root.style.cssText = "padding:20px;background:" + theme.bg + ";color:" + theme.text + ";height:100%;overflow:auto;font-family:sans-serif";
    const stats = _statsByGroup(nodes);
    stats.sort(function(a, b) {
      return a.score - b.score;
    });
    if (stats.length === 0) {
      root.innerHTML = '<div style="color:' + theme.subSoft + ';padding:40px;text-align:center">' + esc(t("health.empty")) + "</div>";
      wrap.appendChild(root);
      return;
    }
    const tot = stats.reduce(function(acc, s) {
      acc.score += s.score;
      acc.problems += s.problems;
      acc.minScore = Math.min(acc.minScore, s.score);
      return acc;
    }, { score: 0, problems: 0, minScore: 100 });
    const avg = Math.round(tot.score / stats.length);
    const head = document.createElement("div");
    head.style.marginBottom = "20px";
    head.innerHTML = '<h2 style="margin:0 0 8px;font-size:16px">' + esc(t("health.title")) + '</h2><div style="font-size:12px;color:' + theme.sub + '">' + t("health.summary", {
      groups: stats.length,
      avg: '<b style="color:' + _scoreColor(avg) + '">' + avg + "</b>",
      min: '<b style="color:' + _scoreColor(tot.minScore) + '">' + tot.minScore + "</b>",
      problems: tot.problems
    }) + "</div>";
    root.appendChild(head);
    const hist = document.createElement("div");
    hist.style.cssText = "margin-bottom:18px";
    root.appendChild(hist);
    _loadScoreHistory(hist, theme);
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill, minmax(380px, 1fr));gap:12px";
    grid.innerHTML = stats.map(function(s) {
      return _card(s, theme);
    }).join("");
    root.appendChild(grid);
    const legend = document.createElement("div");
    legend.style.cssText = "margin-top:24px;padding-top:12px;border-top:1px solid " + theme.border + ";font-size:11px;color:" + theme.sub + ";display:flex;gap:14px;flex-wrap:wrap";
    legend.innerHTML = '<span><b style="color:' + COL_OK + '">85-100</b> ' + esc(t("health.legend.healthy")) + '</span><span><b style="color:' + COL_WARN + '">65-85</b> ' + esc(t("health.legend.ok")) + '</span><span><b style="color:' + COL_BAD + '">40-65</b> ' + esc(t("health.legend.warn")) + '</span><span><b style="color:' + COL_CRIT + '">&lt;40</b> ' + esc(t("health.legend.critical")) + '</span><span style="margin-left:auto">' + esc(t("health.legend.formula")) + "</span>";
    root.appendChild(legend);
    wrap.appendChild(root);
  }

  // assets/js/modules/render-stats.js
  var RANGES = [
    { lbl: t("stats.range_days", { n: 7 }), days: 7 },
    { lbl: t("stats.range_days", { n: 14 }), days: 14 },
    { lbl: t("stats.range_days", { n: 30 }), days: 30 }
  ];
  var DEFAULT_DAYS = 7;
  var SEV_COLORS2 = ["#22c55e", "#06b6d4", "#f59e0b", "#f97316", "#ef4444", "#991b1b"];
  var SEV_LBL2 = ["Normal", "Info", "Warning", "Average", "High", "Disaster"];
  function aggregate(data, hostMeta) {
    const events = data.events || {};
    const from = data.from || 0;
    const to = data.to || 0;
    const dayMs = 86400;
    const dayCount = Math.max(1, Math.ceil((to - from) / dayMs));
    const dayStart = from;
    const perDay = new Array(dayCount).fill(0);
    const perDaySev = [];
    for (let i = 0; i < dayCount; i++) perDaySev.push({});
    const perHost = {};
    const perTrigger = {};
    let totalEvents = 0;
    let worstSev = 0;
    Object.keys(events).forEach(function(hid) {
      const list = events[hid] || [];
      list.forEach(function(e) {
        if (e.pre) return;
        if (e.val === 0) return;
        totalEvents++;
        const sev = e.sev || 0;
        if (sev > worstSev) worstSev = sev;
        const di = Math.min(dayCount - 1, Math.max(0, Math.floor((e.ts - dayStart) / dayMs)));
        perDay[di]++;
        perDaySev[di][sev] = (perDaySev[di][sev] || 0) + 1;
        if (!perHost[hid]) perHost[hid] = { count: 0, worstSev: 0 };
        perHost[hid].count++;
        perHost[hid].worstSev = Math.max(perHost[hid].worstSev, sev);
        const tname = e.name || t("stats.unnamed");
        if (!perTrigger[tname]) perTrigger[tname] = { count: 0, worstSev: 0, hosts: {} };
        perTrigger[tname].count++;
        perTrigger[tname].worstSev = Math.max(perTrigger[tname].worstSev, sev);
        perTrigger[tname].hosts[hid] = true;
      });
    });
    const topHosts = Object.keys(perHost).map(function(hid) {
      return {
        id: hid,
        label: hostMeta[hid] && (hostMeta[hid].label || hostMeta[hid].host) || "hostid:" + hid,
        count: perHost[hid].count,
        worstSev: perHost[hid].worstSev
      };
    }).sort(function(a, b) {
      return b.count - a.count || b.worstSev - a.worstSev;
    }).slice(0, 10);
    const topTriggers = Object.keys(perTrigger).map(function(name) {
      return {
        name,
        count: perTrigger[name].count,
        worstSev: perTrigger[name].worstSev,
        hostCount: Object.keys(perTrigger[name].hosts).length
      };
    }).sort(function(a, b) {
      return b.count - a.count || b.worstSev - a.worstSev;
    }).slice(0, 10);
    return {
      from,
      to,
      dayCount,
      perDay,
      perDaySev,
      totalEvents,
      worstSev,
      distinctHosts: Object.keys(perHost).length,
      distinctTriggers: Object.keys(perTrigger).length,
      topHosts,
      topTriggers,
      truncated: !!data.truncated
    };
  }
  function buildDayChart(agg, theme) {
    if (agg.dayCount === 0 || agg.totalEvents === 0) {
      return '<div style="color:' + theme.subSoft + ';font-style:italic;padding:20px 0">' + esc(t("stats.chart.empty")) + "</div>";
    }
    const W = 720, H = 180, padL = 38, padR = 12, padT = 12, padB = 28;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const maxV = Math.max.apply(null, agg.perDay) || 1;
    const barW = innerW / agg.dayCount;
    const niceMax = Math.pow(10, Math.floor(Math.log10(maxV))) * Math.ceil(maxV / Math.pow(10, Math.floor(Math.log10(maxV))));
    let grid = "";
    for (let i = 1; i <= 3; i++) {
      const y = padT + innerH - innerH * i / 3;
      const v = Math.round(niceMax * i / 3);
      grid += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="' + theme.borderSoft + '" stroke-width="1"/><text x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end" font-family="monospace" font-size="9" fill="' + theme.sub + '">' + v + "</text>";
    }
    let bars = "";
    for (let d = 0; d < agg.dayCount; d++) {
      const x = padL + d * barW;
      let yCursor = padT + innerH;
      const sevMap = agg.perDaySev[d] || {};
      [0, 1, 2, 3, 4, 5].forEach(function(sev) {
        const v = sevMap[sev] || 0;
        if (v === 0) return;
        const h = v / niceMax * innerH;
        yCursor -= h;
        bars += '<rect x="' + (x + 1) + '" y="' + yCursor + '" width="' + (barW - 2) + '" height="' + h + '" fill="' + SEV_COLORS2[sev] + '" opacity="0.92"><title>' + SEV_LBL2[sev] + ": " + v + "</title></rect>";
      });
    }
    function dayLabel(idx) {
      const ts = (agg.from + idx * 86400) * 1e3;
      const d = new Date(ts);
      return ("0" + d.getDate()).slice(-2) + "." + ("0" + (d.getMonth() + 1)).slice(-2);
    }
    const labelXs = [0, Math.floor(agg.dayCount / 2), agg.dayCount - 1];
    let xlabels = "";
    labelXs.forEach(function(idx) {
      if (idx < 0 || idx >= agg.dayCount) return;
      const cx = padL + idx * barW + barW / 2;
      xlabels += '<text x="' + cx + '" y="' + (H - 10) + '" text-anchor="middle" font-family="monospace" font-size="9" fill="' + theme.sub + '">' + dayLabel(idx) + "</text>";
    });
    let legend = "";
    SEV_LBL2.forEach(function(lbl, i) {
      const lx = padL + i * 60;
      legend += '<rect x="' + lx + '" y="4" width="9" height="9" fill="' + SEV_COLORS2[i] + '"/><text x="' + (lx + 12) + '" y="12" font-size="9" fill="' + theme.sub + '">' + lbl + "</text>";
    });
    return '<svg width="' + W + '" height="' + H + '" style="display:block">' + grid + bars + xlabels + '</svg><div style="margin-top:4px"><svg width="' + W + '" height="18">' + legend + "</svg></div>";
  }
  function buildTopTable(rows, theme, headers, cellsFn) {
    if (rows.length === 0) {
      return '<div style="color:' + theme.subSoft + ';font-style:italic">' + esc(t("stats.no_data")) + "</div>";
    }
    return '<table style="border-collapse:collapse;font-size:12px;width:100%"><thead><tr style="border-bottom:1px solid ' + theme.border + '">' + headers.map(function(h) {
      return '<th style="padding:6px 10px;text-align:left;color:' + theme.sub + ';font-weight:600">' + h + "</th>";
    }).join("") + "</tr></thead><tbody>" + rows.map(function(r) {
      return '<tr style="border-bottom:1px solid ' + theme.borderSoft + '">' + cellsFn(r).map(function(c) {
        if (c && typeof c === "object") {
          return '<td style="padding:4px 10px;' + (c.style || "") + '">' + c.text + "</td>";
        }
        return '<td style="padding:4px 10px">' + c + "</td>";
      }).join("") + "</tr>";
    }).join("") + "</tbody></table>";
  }
  function renderStats(wrap, nodes) {
    if (window._ntCy) {
      try {
        window._ntCy.destroy();
      } catch (e) {
      }
      window._ntCy = null;
    }
    if (window._ntEdgeAnim) {
      clearInterval(window._ntEdgeAnim);
      window._ntEdgeAnim = null;
    }
    const dark = !!(document.getElementById("nt-root") && document.getElementById("nt-root").classList.contains("nt-dark"));
    const theme = mkTabTheme(dark);
    Array.from(wrap.children).forEach(function(ch) {
      if (ch.id !== "nt-loading") wrap.removeChild(ch);
    });
    const hostMeta = {};
    (nodes || []).forEach(function(n) {
      hostMeta[String(n.id)] = n;
    });
    const root = document.createElement("div");
    root.style.cssText = "padding:20px;background:" + theme.bg + ";color:" + theme.text + ";height:100%;overflow:auto;font-family:sans-serif";
    const head = document.createElement("div");
    head.innerHTML = '<h2 style="margin:0 0 6px;font-size:16px">' + esc(t("stats.title")) + '</h2><div style="font-size:12px;color:' + theme.sub + ';margin-bottom:14px">' + esc(t("stats.desc")) + "</div>";
    root.appendChild(head);
    const rangeWrap = document.createElement("div");
    rangeWrap.style.cssText = "display:flex;gap:6px;margin-bottom:16px;align-items:center";
    const rangeLbl = document.createElement("span");
    rangeLbl.textContent = t("stats.period");
    rangeLbl.style.cssText = "font-size:12px;color:" + theme.sub + ";font-weight:600;margin-right:4px";
    rangeWrap.appendChild(rangeLbl);
    let _days = DEFAULT_DAYS;
    const rangeBtns = [];
    RANGES.forEach(function(r) {
      const b = document.createElement("button");
      b.textContent = r.lbl;
      b.style.cssText = "padding:4px 10px;border:1px solid " + theme.border + ";border-radius:4px;background:" + theme.surface + ";color:" + theme.text + ";cursor:pointer;font-size:12px;font-family:inherit";
      b.addEventListener("click", function() {
        _days = r.days;
        rangeBtns.forEach(function(rb) {
          rb.style.background = rb.dataset.days == r.days ? theme.accent : theme.surface;
          rb.style.color = rb.dataset.days == r.days ? "#fff" : theme.text;
          rb.style.borderColor = rb.dataset.days == r.days ? theme.accent : theme.border;
        });
        loadAndRender();
      });
      b.dataset.days = String(r.days);
      if (r.days === DEFAULT_DAYS) {
        b.style.background = theme.accent;
        b.style.color = "#fff";
        b.style.borderColor = theme.accent;
      }
      rangeBtns.push(b);
      rangeWrap.appendChild(b);
    });
    root.appendChild(rangeWrap);
    const aggHead = document.createElement("div");
    aggHead.style.cssText = "font-size:12px;color:" + theme.sub + ";margin-bottom:10px";
    aggHead.textContent = t("stats.loading");
    root.appendChild(aggHead);
    const chartBox = document.createElement("div");
    chartBox.style.cssText = "margin-bottom:24px;overflow:auto";
    root.appendChild(chartBox);
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:24px";
    const hostsBox = document.createElement("div");
    const trigBox = document.createElement("div");
    hostsBox.innerHTML = '<h3 style="margin:0 0 8px;font-size:13px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.04em">' + esc(t("stats.top_hosts")) + '</h3><div data-slot="hosts" style="color:' + theme.subSoft + '">\u2026</div>';
    trigBox.innerHTML = '<h3 style="margin:0 0 8px;font-size:13px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.04em">' + esc(t("stats.top_triggers")) + '</h3><div data-slot="triggers" style="color:' + theme.subSoft + '">\u2026</div>';
    grid.appendChild(hostsBox);
    grid.appendChild(trigBox);
    root.appendChild(grid);
    const fcRoot = document.createElement("div");
    fcRoot.style.cssText = "margin-top:28px;padding-top:18px;border-top:1px solid " + theme.border;
    fcRoot.innerHTML = '<h3 style="margin:0 0 4px;font-size:13px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.04em">' + esc(t("fc.title")) + '</h3><div style="font-size:11px;color:' + theme.subSoft + ';margin-bottom:10px;max-width:760px">' + esc(t("fc.caveat")) + "</div>";
    const fcCtl = document.createElement("div");
    fcCtl.style.cssText = "display:flex;gap:6px;margin-bottom:12px;align-items:center";
    const fcLbl = document.createElement("span");
    fcLbl.textContent = t("fc.period");
    fcLbl.style.cssText = "font-size:12px;color:" + theme.sub + ";font-weight:600;margin-right:4px";
    fcCtl.appendChild(fcLbl);
    let _fcDays = 30;
    const fcBtns = [];
    [30, 60, 90].forEach(function(d) {
      const b = document.createElement("button");
      b.textContent = d + " " + t("fc.days_unit");
      b.dataset.days = String(d);
      b.style.cssText = "padding:4px 10px;border:1px solid " + theme.border + ";border-radius:4px;background:" + theme.surface + ";color:" + theme.text + ";cursor:pointer;font-size:12px;font-family:inherit";
      if (d === _fcDays) {
        b.style.background = theme.accent;
        b.style.color = "#fff";
        b.style.borderColor = theme.accent;
      }
      b.addEventListener("click", function() {
        _fcDays = d;
        fcBtns.forEach(function(fb) {
          const on = fb.dataset.days == d;
          fb.style.background = on ? theme.accent : theme.surface;
          fb.style.color = on ? "#fff" : theme.text;
          fb.style.borderColor = on ? theme.accent : theme.border;
        });
        loadForecast();
        loadResourceForecast();
      });
      fcBtns.push(b);
      fcCtl.appendChild(b);
    });
    const fcStatus = document.createElement("div");
    fcStatus.style.cssText = "font-size:12px;color:" + theme.sub + ";margin-bottom:8px";
    const fcSlot = document.createElement("div");
    fcRoot.appendChild(fcCtl);
    fcRoot.appendChild(fcStatus);
    fcRoot.appendChild(fcSlot);
    root.appendChild(fcRoot);
    const rfRoot = document.createElement("div");
    rfRoot.style.cssText = "margin-top:24px;padding-top:16px;border-top:1px solid " + theme.border;
    rfRoot.innerHTML = '<h3 style="margin:0 0 4px;font-size:13px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.04em">' + esc(t("rf.title")) + '</h3><div style="font-size:11px;color:' + theme.subSoft + ';margin-bottom:10px;max-width:760px">' + esc(t("rf.caveat")) + "</div>";
    const rfStatus = document.createElement("div");
    rfStatus.style.cssText = "font-size:12px;color:" + theme.sub + ";margin-bottom:8px";
    const rfSlot = document.createElement("div");
    rfRoot.appendChild(rfStatus);
    rfRoot.appendChild(rfSlot);
    root.appendChild(rfRoot);
    wrap.appendChild(root);
    let _seq = 0;
    function loadAndRender() {
      const cfg = window.NT_CONFIG || {};
      const groupids = cfg && cfg.selected_groupids || [];
      const now = Math.floor(Date.now() / 1e3);
      const from = now - _days * 86400;
      const params = new URLSearchParams();
      params.append("action", "network.topology.v6.history");
      params.append("from", String(from));
      params.append("to", String(now));
      groupids.forEach(function(g) {
        params.append("groupids[]", String(g));
      });
      const url = buildBaseUrl() + "zabbix.php?" + params.toString();
      aggHead.textContent = t("stats.loading_events", { days: _days });
      chartBox.innerHTML = "";
      hostsBox.querySelector('[data-slot="hosts"]').textContent = "\u2026";
      trigBox.querySelector('[data-slot="triggers"]').textContent = "\u2026";
      const seq = ++_seq;
      fetch(url, { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (seq !== _seq) return;
        if (data.error) {
          aggHead.innerHTML = '<span style="color:#dc2626">' + esc(t("stats.error", { msg: data.error })) + "</span>";
          return;
        }
        const agg = aggregate(data, hostMeta);
        const fromStr = new Date(agg.from * 1e3).toLocaleDateString("de-DE");
        const toStr = new Date(agg.to * 1e3).toLocaleDateString("de-DE");
        aggHead.innerHTML = t("stats.agg_summary", {
          events: "<b>" + agg.totalEvents + "</b>",
          hosts: "<b>" + agg.distinctHosts + "</b>",
          triggers: "<b>" + agg.distinctTriggers + "</b>",
          from: esc(fromStr),
          to: esc(toStr)
        }) + (agg.truncated ? ' &middot; <span style="color:#f59e0b">' + esc(t("stats.truncated")) + "</span>" : "");
        chartBox.innerHTML = buildDayChart(agg, theme);
        hostsBox.querySelector('[data-slot="hosts"]').innerHTML = buildTopTable(
          agg.topHosts,
          theme,
          [esc(t("stats.col.host")), esc(t("stats.col.events")), esc(t("stats.col.worst"))],
          function(r) {
            return [
              esc(r.label),
              { text: r.count, style: "text-align:right;font-family:monospace;font-weight:600" },
              { text: '<span style="color:' + SEV_COLORS2[r.worstSev] + '">' + SEV_LBL2[r.worstSev] + "</span>" }
            ];
          }
        );
        trigBox.querySelector('[data-slot="triggers"]').innerHTML = buildTopTable(
          agg.topTriggers,
          theme,
          [esc(t("stats.col.trigger")), esc(t("stats.col.events")), esc(t("stats.col.hosts")), esc(t("stats.col.worst"))],
          function(r) {
            return [
              esc(r.name),
              { text: r.count, style: "text-align:right;font-family:monospace;font-weight:600" },
              { text: r.hostCount, style: "text-align:right;font-family:monospace" },
              { text: '<span style="color:' + SEV_COLORS2[r.worstSev] + '">' + SEV_LBL2[r.worstSev] + "</span>" }
            ];
          }
        );
      }).catch(function(e) {
        if (seq !== _seq) return;
        aggHead.innerHTML = '<span style="color:#dc2626">' + esc(t("stats.error", { msg: e.message })) + "</span>";
      });
    }
    loadAndRender();
    let _fcSeq = 0;
    function loadForecast() {
      const d = window._ntLastData || {};
      const nodesArr = d.nodes || nodes || [];
      const speed = {}, labelOf = {};
      nodesArr.forEach(function(n) {
        speed[String(n.id)] = n.link_speed || 0;
        labelOf[String(n.id)] = n.label || n.host || String(n.id);
      });
      const links = [], seenE = {};
      (d.edges || []).forEach(function(e) {
        const a = String(e.source || e.from || ""), b = String(e.target || e.to || "");
        if (!a || !b || a === b) return;
        const k = [a, b].sort().join("|");
        if (seenE[k]) return;
        seenE[k] = true;
        const cap = linkCapacity(speed[a] || 0, speed[b] || 0);
        if (cap > 0) links.push({ a, b, cap });
      });
      if (links.length === 0) {
        fcStatus.textContent = "";
        fcSlot.innerHTML = '<div style="color:' + theme.subSoft + ';font-style:italic;font-size:12px">' + esc(t("fc.nolinks")) + "</div>";
        return;
      }
      const hostSet = {};
      links.forEach(function(l) {
        hostSet[l.a] = true;
        hostSet[l.b] = true;
      });
      const cfg = window.NT_CONFIG || {};
      const params = new URLSearchParams();
      params.append("action", "network.topology.v6.capacity_forecast");
      params.append("days", String(_fcDays));
      (cfg && cfg.selected_groupids || []).forEach(function(g) {
        params.append("groupids[]", String(g));
      });
      Object.keys(hostSet).forEach(function(h) {
        params.append("hostids[]", h);
      });
      fcStatus.textContent = t("fc.loading", { days: _fcDays });
      fcSlot.innerHTML = "";
      const seq = ++_fcSeq;
      fetch(
        buildBaseUrl() + "zabbix.php?" + params.toString(),
        { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } }
      ).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (seq !== _fcSeq || !fcSlot.isConnected) return;
        if (data.error) {
          fcStatus.innerHTML = '<span style="color:#dc2626">' + esc(data.error) + "</span>";
          return;
        }
        renderForecast(links, labelOf, data.hosts || {});
      }).catch(function(e) {
        if (seq !== _fcSeq) return;
        fcStatus.innerHTML = '<span style="color:#dc2626">' + esc(e.message) + "</span>";
      });
    }
    function renderForecast(links, labelOf, fcHosts) {
      const rows = [];
      links.forEach(function(l) {
        const fa = fcHosts[l.a] || null, fb = fcHosts[l.b] || null;
        if (!fa && !fb) return;
        function dir(key) {
          const A = fa && fa[key], B = fb && fb[key];
          if (A && B) return { now: (A.now + B.now) / 2, slope: (A.slope + B.slope) / 2 };
          return A || B || null;
        }
        const din = dir("in"), dout = dir("out");
        if (!din && !dout) return;
        const nowMax = Math.max(din ? din.now : 0, dout ? dout.now : 0);
        const target = 0.8 * l.cap;
        let eta = null, etaSlope = null;
        [din, dout].forEach(function(dd) {
          if (!dd) return;
          let e = null;
          if (dd.now >= target) e = 0;
          else if (dd.slope > 0) e = (target - dd.now) / dd.slope / 86400;
          if (e !== null && (eta === null || e < eta)) {
            eta = e;
            etaSlope = dd.slope;
          }
        });
        const domSlope = etaSlope !== null ? etaSlope : Math.max(din ? din.slope : -Infinity, dout ? dout.slope : -Infinity);
        rows.push({
          label: (labelOf[l.a] || l.a) + " \u2194 " + (labelOf[l.b] || l.b),
          cap: l.cap,
          util: nowMax / l.cap * 100,
          weekPP: isFinite(domSlope) ? domSlope * 604800 / l.cap * 100 : 0,
          eta
        });
      });
      if (rows.length === 0) {
        fcStatus.textContent = "";
        fcSlot.innerHTML = '<div style="color:' + theme.subSoft + ';font-style:italic;font-size:12px">' + esc(t("fc.nodata")) + "</div>";
        return;
      }
      rows.sort(function(a, b) {
        if (a.eta === null !== (b.eta === null)) return a.eta === null ? 1 : -1;
        if (a.eta !== null && b.eta !== null && a.eta !== b.eta) return a.eta - b.eta;
        return b.util - a.util;
      });
      fcStatus.textContent = t("fc.summary", { links: rows.length, days: _fcDays });
      const shown = rows.slice(0, 20);
      fcSlot.innerHTML = buildTopTable(
        shown,
        theme,
        [
          esc(t("fc.col.link")),
          esc(t("fc.col.cap")),
          esc(t("fc.col.util")),
          esc(t("fc.col.trend")),
          esc(t("fc.col.eta"))
        ],
        function(r) {
          return [
            esc(r.label),
            { text: esc(fmt(r.cap)), style: "font-family:monospace;white-space:nowrap" },
            {
              text: '<b style="color:' + _utilColor(r.util) + '">' + r.util.toFixed(1) + "%</b>",
              style: "text-align:right;font-family:monospace"
            },
            {
              text: (r.weekPP >= 0 ? "+" : "") + r.weekPP.toFixed(2) + " pp",
              style: "text-align:right;font-family:monospace;color:" + (r.weekPP > 0.5 ? "#f97316" : theme.sub)
            },
            _etaCell(r.eta)
          ];
        }
      ) + (rows.length > shown.length ? '<div style="font-size:11px;color:' + theme.subSoft + ';margin-top:6px">' + esc(t("fc.more", { n: rows.length - shown.length })) + "</div>" : "");
    }
    function _utilColor(u) {
      if (u < 40) return "#16a34a";
      if (u < 55) return "#eab308";
      if (u < 70) return "#f59e0b";
      if (u < 85) return "#f97316";
      return "#dc2626";
    }
    function _etaCell(eta) {
      if (eta === null) {
        return { text: '<span style="color:' + theme.subSoft + '">' + esc(t("fc.eta.stable")) + "</span>" };
      }
      if (eta <= 0.5) {
        return { text: '<b style="color:#dc2626">' + esc(t("fc.eta.now")) + "</b>" };
      }
      const days = Math.round(eta);
      if (days > 365) {
        return { text: '<span style="color:' + theme.subSoft + '">' + esc(t("fc.eta.gt1y")) + "</span>" };
      }
      const col = days <= 30 ? "#dc2626" : days <= 90 ? "#f97316" : "#ca8a04";
      return { text: '<b style="color:' + col + '">' + esc(t("fc.eta.days", { d: days })) + "</b>" };
    }
    function _rfEtaCell(eta) {
      if (eta === null) {
        return { text: '<span style="color:' + theme.subSoft + '">' + esc(t("fc.eta.stable")) + "</span>" };
      }
      if (eta <= 0.5) {
        return { text: '<b style="color:#dc2626">' + esc(t("rf.eta.now")) + "</b>" };
      }
      const days = Math.round(eta);
      if (days > 365) {
        return { text: '<span style="color:' + theme.subSoft + '">' + esc(t("fc.eta.gt1y")) + "</span>" };
      }
      const col = days <= 30 ? "#dc2626" : days <= 90 ? "#f97316" : "#ca8a04";
      return { text: '<b style="color:' + col + '">' + esc(t("fc.eta.days", { d: days })) + "</b>" };
    }
    const RF_MEM_TH = 90, RF_CPU_TH = 85;
    let _rfSeq = 0;
    function loadResourceForecast() {
      const cfg = window.NT_CONFIG || {};
      const groupids = cfg && cfg.selected_groupids || [];
      if (groupids.length === 0) {
        rfStatus.textContent = "";
        rfSlot.innerHTML = '<div style="color:' + theme.subSoft + ';font-style:italic;font-size:12px">' + esc(t("rf.nogroups")) + "</div>";
        return;
      }
      const params = new URLSearchParams();
      params.append("action", "network.topology.v6.resource_forecast");
      params.append("days", String(_fcDays));
      groupids.forEach(function(g) {
        params.append("groupids[]", String(g));
      });
      rfStatus.textContent = t("fc.loading", { days: _fcDays });
      rfSlot.innerHTML = "";
      const seq = ++_rfSeq;
      fetch(
        buildBaseUrl() + "zabbix.php?" + params.toString(),
        { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } }
      ).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (seq !== _rfSeq || !rfSlot.isConnected) return;
        if (data.error) {
          rfStatus.innerHTML = '<span style="color:#dc2626">' + esc(data.error) + "</span>";
          return;
        }
        renderResourceForecast(data.hosts || {});
      }).catch(function(e) {
        if (seq !== _rfSeq) return;
        rfStatus.innerHTML = '<span style="color:#dc2626">' + esc(e.message) + "</span>";
      });
    }
    function _etaTo(metric, threshold) {
      if (!metric) return null;
      if (metric.now >= threshold) return 0;
      if (metric.slope > 0) return (threshold - metric.now) / metric.slope / 86400;
      return null;
    }
    function renderResourceForecast(rfHosts) {
      const rows = [];
      Object.keys(rfHosts).forEach(function(hid) {
        const h = rfHosts[hid];
        if (!h || !h.cpu && !h.mem) return;
        const memEta = _etaTo(h.mem, RF_MEM_TH);
        const cpuEta = _etaTo(h.cpu, RF_CPU_TH);
        let soon = null;
        [memEta, cpuEta].forEach(function(e) {
          if (e !== null && (soon === null || e < soon)) soon = e;
        });
        rows.push({
          label: h.label || hid,
          mem: h.mem || null,
          cpu: h.cpu || null,
          // slope ist %/s → *604800 = Prozentpunkte/Woche
          memWeek: h.mem ? h.mem.slope * 604800 : null,
          memEta,
          cpuEta,
          soon
        });
      });
      if (rows.length === 0) {
        rfStatus.textContent = "";
        rfSlot.innerHTML = '<div style="color:' + theme.subSoft + ';font-style:italic;font-size:12px">' + esc(t("rf.nodata")) + "</div>";
        return;
      }
      rows.sort(function(a, b) {
        if (a.soon === null !== (b.soon === null)) return a.soon === null ? 1 : -1;
        if (a.soon !== null && b.soon !== null && a.soon !== b.soon) return a.soon - b.soon;
        const am = Math.max(a.mem ? a.mem.now : 0, a.cpu ? a.cpu.now : 0);
        const bm = Math.max(b.mem ? b.mem.now : 0, b.cpu ? b.cpu.now : 0);
        return bm - am;
      });
      rfStatus.textContent = t("rf.summary", { hosts: rows.length, days: _fcDays });
      const dash = '<span style="color:' + theme.subSoft + '">\u2014</span>';
      function pct(m) {
        if (!m) return { text: dash, style: "text-align:right" };
        return {
          text: '<b style="color:' + _utilColor(m.now) + '">' + m.now.toFixed(0) + "%</b>",
          style: "text-align:right;font-family:monospace"
        };
      }
      const shown = rows.slice(0, 20);
      rfSlot.innerHTML = buildTopTable(
        shown,
        theme,
        [
          esc(t("rf.col.host")),
          esc(t("rf.col.mem")),
          esc(t("rf.col.mem_week")),
          esc(t("rf.col.mem_eta")),
          esc(t("rf.col.cpu")),
          esc(t("rf.col.cpu_eta"))
        ],
        function(r) {
          return [
            esc(r.label),
            pct(r.mem),
            r.memWeek === null ? { text: dash, style: "text-align:right" } : {
              text: (r.memWeek >= 0 ? "+" : "") + r.memWeek.toFixed(2) + " pp",
              style: "text-align:right;font-family:monospace;color:" + (r.memWeek > 0.3 ? "#f97316" : theme.sub)
            },
            _rfEtaCell(r.memEta),
            pct(r.cpu),
            _rfEtaCell(r.cpuEta)
          ];
        }
      ) + (rows.length > shown.length ? '<div style="font-size:11px;color:' + theme.subSoft + ';margin-top:6px">' + esc(t("rf.more", { n: rows.length - shown.length })) + "</div>" : "");
    }
    loadForecast();
    loadResourceForecast();
  }

  // assets/js/modules/render-compliance.js
  var COMPLIANCE_CHECKS = [
    { key: "snmp_v2", lbl: "SNMP v1/v2c", short: "SNMP v2", level: "bad" },
    { key: "snmp_v3", lbl: "SNMP v3", short: "SNMP v3", level: "good" },
    { key: "no_tls", lbl: "Agent ohne TLS", short: "no TLS", level: "bad" },
    { key: "no_proxy", lbl: "Kein Proxy", short: "no Proxy", level: "info" },
    { key: "no_inventory", lbl: "Inventory aus", short: "no Inv", level: "info" },
    { key: "no_location", lbl: "Kein Standort", short: "no Loc", level: "info" },
    { key: "no_template", lbl: "Kein Template", short: "no Tpl", level: "bad" },
    { key: "stale_problem", lbl: "Stale Krit-Problem", short: "stale", level: "bad" },
    { key: "mtnc_no_comment", lbl: "Wartung ohne Kommentar", short: "mtnc?", level: "info" }
  ];
  var CHECKS = COMPLIANCE_CHECKS;
  function fetchComplianceData() {
    const cfg = window.NT_CONFIG || {};
    const groupids = cfg && cfg.selected_groupids || [];
    if (!groupids.length) return Promise.resolve(null);
    const params = new URLSearchParams();
    params.append("action", "network.topology.v6.compliance");
    groupids.forEach(function(g) {
      params.append("groupids[]", String(g));
    });
    const url = buildBaseUrl() + "zabbix.php?" + params.toString();
    return fetch(url, { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } }).then(function(r) {
      return r.json();
    }).then(function(d) {
      return d && !d.error ? d : null;
    }).catch(function() {
      return null;
    });
  }
  var COL_GOOD = "#16a34a";
  var COL_INFO = "#0891b2";
  var COL_BAD2 = "#dc2626";
  var COL_NONE = "#cbd5e1";
  function _checkColor(check) {
    return check.level === "good" ? COL_GOOD : check.level === "info" ? COL_INFO : COL_BAD2;
  }
  function _checkSymbol(check, hit) {
    if (!hit) return '<span style="color:' + COL_NONE + '">\xB7</span>';
    if (check.level === "good") return '<span style="color:' + COL_GOOD + '">\u2713</span>';
    if (check.level === "info") return '<span style="color:' + COL_INFO + '">i</span>';
    return '<span style="color:' + COL_BAD2 + ';font-weight:700">\u2717</span>';
  }
  function _aggregateCards(agg, total, theme, onlyIssues) {
    const cards = CHECKS.map(function(c) {
      const n = agg[c.key] || 0;
      const col = _checkColor(c);
      const pct = total > 0 ? Math.round(100 * n / total) : 0;
      return '<div style="background:' + theme.surface + ";border:1px solid " + theme.border + ';border-radius:4px;padding:8px 10px;display:flex;flex-direction:column"><div style="font-size:10px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.05em">' + esc(c.lbl) + '</div><div style="display:flex;align-items:baseline;gap:6px;margin-top:2px"><span style="font-size:20px;font-weight:700;color:' + (n > 0 ? col : theme.subSoft) + ';font-family:monospace">' + n + '</span><span style="font-size:11px;color:' + theme.sub + '">/ ' + total + '</span><span style="font-size:10px;color:' + theme.subSoft + ';margin-left:auto">' + pct + "%</span></div></div>";
    }).join("");
    const filterToggle = '<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:' + theme.sub + ';cursor:pointer;margin-left:auto"><input type="checkbox" id="nt-compl-only-issues"' + (onlyIssues ? " checked" : "") + "> Nur Hosts mit Issues (bad-Level)</label>";
    return '<div style="display:flex;align-items:center;margin-bottom:8px"><h3 style="margin:0;font-size:13px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.04em">Aggregat (' + total + " Hosts)</h3>" + filterToggle + '</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:18px">' + cards + "</div>";
  }
  function _hostTable(hosts, theme) {
    if (!hosts.length) {
      return '<div style="color:' + theme.subSoft + ';padding:20px 0">Keine Hosts entsprechen dem Filter.</div>';
    }
    let html = '<table style="border-collapse:collapse;font-size:12px;width:100%"><thead><tr style="border-bottom:1px solid ' + theme.border + '"><th style="padding:6px 12px;text-align:left;color:' + theme.sub + ';font-weight:600">Host</th>';
    CHECKS.forEach(function(c) {
      html += '<th title="' + esc(c.lbl) + '" style="padding:6px 8px;text-align:center;color:' + theme.sub + ';font-weight:600;writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;font-size:10px">' + esc(c.short) + "</th>";
    });
    html += "</tr></thead><tbody>";
    hosts.forEach(function(h) {
      html += '<tr style="border-bottom:1px solid ' + theme.borderSoft + '"><td style="padding:5px 12px"><b>' + esc(h.label || h.host || "") + "</b></td>";
      CHECKS.forEach(function(c) {
        html += '<td style="padding:5px 8px;text-align:center;font-size:14px">' + _checkSymbol(c, !!h.checks[c.key]) + "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    return html;
  }
  function renderCompliance(wrap) {
    if (window._ntCy) {
      try {
        window._ntCy.destroy();
      } catch (e) {
      }
      window._ntCy = null;
    }
    if (window._ntEdgeAnim) {
      clearInterval(window._ntEdgeAnim);
      window._ntEdgeAnim = null;
    }
    const dark = !!(document.getElementById("nt-root") && document.getElementById("nt-root").classList.contains("nt-dark"));
    const theme = mkTabTheme(dark);
    Array.from(wrap.children).forEach(function(ch) {
      if (ch.id !== "nt-loading") wrap.removeChild(ch);
    });
    const root = document.createElement("div");
    root.style.cssText = "padding:20px;background:" + theme.bg + ";color:" + theme.text + ";height:100%;overflow:auto;font-family:sans-serif";
    const head = document.createElement("div");
    head.innerHTML = '<h2 style="margin:0 0 6px;font-size:16px">Compliance</h2><div style="font-size:12px;color:' + theme.sub + ';margin-bottom:16px">Security- und Konfigurations-Checks pro Host. Schlechte (\u2717) Findings sind echte Issues; Info (i) sind Hinweise die kontextabhaengig sein koennen; Gut (\u2713) ist positiv markiert.</div>';
    root.appendChild(head);
    const aggBox = document.createElement("div");
    const tableBox = document.createElement("div");
    root.appendChild(aggBox);
    root.appendChild(tableBox);
    aggBox.innerHTML = '<div style="color:' + theme.subSoft + ';padding:20px">Laedt...</div>';
    wrap.appendChild(root);
    const cfg = window.NT_CONFIG || {};
    const groupids = cfg && cfg.selected_groupids || [];
    if (!groupids.length) {
      aggBox.innerHTML = '<div style="color:' + theme.subSoft + ';padding:20px">Bitte Host groups oben waehlen.</div>';
      return;
    }
    let _onlyIssues = false;
    fetchComplianceData().then(function(data) {
      if (!data) {
        aggBox.innerHTML = '<div style="color:' + COL_BAD2 + '">Compliance-Daten nicht verfuegbar (Berechtigung oder Backend-Fehler).</div>';
        return;
      }
      const allHosts = data.hosts || [];
      const agg = data.aggregate || {};
      const total = data.total || 0;
      function rerender() {
        aggBox.innerHTML = _aggregateCards(agg, total, theme, _onlyIssues);
        let filteredHosts = allHosts;
        if (_onlyIssues) {
          const badKeys = CHECKS.filter(function(c) {
            return c.level === "bad";
          }).map(function(c) {
            return c.key;
          });
          filteredHosts = allHosts.filter(function(h) {
            return badKeys.some(function(k) {
              return h.checks && h.checks[k];
            });
          });
        }
        const badKeys2 = CHECKS.filter(function(c) {
          return c.level === "bad";
        }).map(function(c) {
          return c.key;
        });
        filteredHosts.sort(function(a, b) {
          const ba = badKeys2.reduce(function(n, k) {
            return n + (a.checks[k] ? 1 : 0);
          }, 0);
          const bb = badKeys2.reduce(function(n, k) {
            return n + (b.checks[k] ? 1 : 0);
          }, 0);
          return bb - ba || (a.label || "").localeCompare(b.label || "");
        });
        tableBox.innerHTML = _hostTable(filteredHosts, theme);
        const cb = document.getElementById("nt-compl-only-issues");
        if (cb) cb.addEventListener("change", function() {
          _onlyIssues = this.checked;
          rerender();
        });
      }
      rerender();
    }).catch(function(e) {
      aggBox.innerHTML = '<div style="color:' + COL_BAD2 + '">Fehler: ' + esc(e.message) + "</div>";
    });
  }

  // assets/js/modules/render-lldp-quality.js
  var COL_GOOD2 = "#16a34a";
  var COL_WARN2 = "#f59e0b";
  var COL_BAD3 = "#dc2626";
  function _srcBadge(src) {
    const colors = { lldp: "#0891b2", cdp: "#a855f7", other: "#64748b" };
    const c = colors[src] || colors.other;
    return '<span style="display:inline-block;background:' + c + ';color:#fff;padding:0 5px;border-radius:3px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em">' + esc(src) + "</span>";
  }
  function _aggregateBlock(perHost, theme) {
    let totalMatched = 0, totalUnmatched = 0, totalAmbiguous = 0, totalSelf = 0;
    perHost.forEach(function(h) {
      totalMatched += h.matched;
      totalUnmatched += (h.unmatched || []).length;
      totalAmbiguous += (h.ambiguous || []).length;
      totalSelf += h.self || 0;
    });
    const total = totalMatched + totalUnmatched + totalAmbiguous;
    const matchPct = total > 0 ? Math.round(100 * totalMatched / total) : 0;
    const pctCol = matchPct >= 90 ? COL_GOOD2 : matchPct >= 70 ? COL_WARN2 : COL_BAD3;
    const reporters = perHost.length;
    return '<div style="background:' + theme.surface + ";border:1px solid " + theme.border + ';border-radius:6px;padding:14px 18px;margin-bottom:18px;display:flex;gap:24px;align-items:center;flex-wrap:wrap"><div><div style="font-size:10px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.05em">Match-Quote</div><div style="font-size:28px;font-weight:700;color:' + pctCol + ';font-family:monospace;line-height:1">' + matchPct + '%</div></div><div><div style="font-size:10px;color:' + theme.sub + ';text-transform:uppercase">Reporter</div><div style="font-size:20px;font-weight:700;color:' + theme.text + ';font-family:monospace">' + reporters + '</div></div><div><div style="font-size:10px;color:' + theme.sub + ';text-transform:uppercase">Matched</div><div style="font-size:20px;font-weight:700;color:' + COL_GOOD2 + ';font-family:monospace">' + totalMatched + '</div></div><div><div style="font-size:10px;color:' + theme.sub + ';text-transform:uppercase">Unmatched</div><div style="font-size:20px;font-weight:700;color:' + (totalUnmatched > 0 ? COL_BAD3 : theme.subSoft) + ';font-family:monospace">' + totalUnmatched + '</div></div><div><div style="font-size:10px;color:' + theme.sub + ';text-transform:uppercase">Ambiguous</div><div style="font-size:20px;font-weight:700;color:' + (totalAmbiguous > 0 ? COL_WARN2 : theme.subSoft) + ';font-family:monospace">' + totalAmbiguous + '</div></div><div><div style="font-size:10px;color:' + theme.sub + ';text-transform:uppercase">Self-Loops</div><div style="font-size:20px;font-weight:700;color:' + theme.subSoft + ';font-family:monospace">' + totalSelf + "</div></div></div>";
  }
  function _perHostTable(perHost, theme) {
    if (!perHost.length) {
      return '<div style="color:' + theme.subSoft + ';padding:20px 0;font-style:italic">Keine Hosts melden LLDP/CDP-Nachbarn in der aktuellen Auswahl.</div>';
    }
    const sorted = perHost.slice().sort(function(a, b) {
      const ia = (a.unmatched || []).length + (a.ambiguous || []).length;
      const ib = (b.unmatched || []).length + (b.ambiguous || []).length;
      return ib - ia || b.matched - a.matched;
    });
    let html = '<h3 style="margin:18px 0 8px;font-size:13px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.04em">Pro Reporter</h3><table style="border-collapse:collapse;font-size:12px;width:100%"><thead><tr style="border-bottom:1px solid ' + theme.border + '">' + ["Reporter", "Matched", "Unmatched", "Ambiguous", "Self", "Details"].map(function(h) {
      return '<th style="padding:6px 10px;text-align:left;color:' + theme.sub + ';font-weight:600">' + h + "</th>";
    }).join("") + "</tr></thead><tbody>";
    sorted.forEach(function(h) {
      const u = (h.unmatched || []).length;
      const a = (h.ambiguous || []).length;
      const detailItems = [];
      (h.unmatched || []).slice(0, 5).forEach(function(x) {
        detailItems.push('<div style="display:flex;gap:6px;align-items:center">' + _srcBadge(x.src) + '<span style="color:' + COL_BAD3 + '">\u2717</span> <code style="font-size:11px">' + esc(x.raw) + "</code></div>");
      });
      if (u > 5) detailItems.push('<div style="color:' + theme.subSoft + ';font-size:10px">\u2026 und ' + (u - 5) + " weitere unmatched</div>");
      (h.ambiguous || []).slice(0, 3).forEach(function(x) {
        detailItems.push('<div style="display:flex;gap:6px;align-items:center">' + _srcBadge(x.src) + '<span style="color:' + COL_WARN2 + '">?</span> <code style="font-size:11px">' + esc(x.raw) + '</code> <span style="color:' + theme.subSoft + ';font-size:10px">(' + (x.candidates || []).length + " Kandidaten)</span></div>");
      });
      html += '<tr style="border-bottom:1px solid ' + theme.borderSoft + '"><td style="padding:5px 10px;font-weight:600">' + esc(h.label) + '</td><td style="padding:5px 10px;text-align:right;color:' + COL_GOOD2 + ';font-family:monospace">' + h.matched + '</td><td style="padding:5px 10px;text-align:right;color:' + (u > 0 ? COL_BAD3 : theme.subSoft) + ';font-family:monospace">' + u + '</td><td style="padding:5px 10px;text-align:right;color:' + (a > 0 ? COL_WARN2 : theme.subSoft) + ';font-family:monospace">' + a + '</td><td style="padding:5px 10px;text-align:right;color:' + theme.subSoft + ';font-family:monospace">' + (h.self || 0) + '</td><td style="padding:5px 10px">' + (detailItems.length ? detailItems.join("") : '<span style="color:' + theme.subSoft + '">\u2014</span>') + "</td></tr>";
    });
    html += "</tbody></table>";
    return html;
  }
  function _topUnmatchedTable(perHost, theme) {
    const counts = {};
    perHost.forEach(function(h) {
      (h.unmatched || []).forEach(function(x) {
        const k = x.raw + "\0" + x.src;
        if (!counts[k]) counts[k] = { raw: x.raw, src: x.src, count: 0, reporters: {} };
        counts[k].count++;
        counts[k].reporters[h.id] = h.label;
      });
    });
    const list = Object.values(counts).sort(function(a, b) {
      return b.count - a.count;
    });
    if (!list.length) {
      return "";
    }
    let html = '<h3 style="margin:18px 0 8px;font-size:13px;color:' + theme.sub + ';text-transform:uppercase;letter-spacing:0.04em">Top Unmatched Neighbors</h3><table style="border-collapse:collapse;font-size:12px;width:100%"><thead><tr style="border-bottom:1px solid ' + theme.border + '">' + ["Reported Name", "Source", "Hits", "Gemeldet von"].map(function(h) {
      return '<th style="padding:6px 10px;text-align:left;color:' + theme.sub + ';font-weight:600">' + h + "</th>";
    }).join("") + "</tr></thead><tbody>";
    list.slice(0, 50).forEach(function(u) {
      const reporters = Object.values(u.reporters).slice(0, 3).map(esc).join(", ");
      const more = Object.keys(u.reporters).length - 3;
      html += '<tr style="border-bottom:1px solid ' + theme.borderSoft + '"><td style="padding:5px 10px"><code>' + esc(u.raw) + '</code></td><td style="padding:5px 10px">' + _srcBadge(u.src) + '</td><td style="padding:5px 10px;text-align:right;font-family:monospace;font-weight:600">' + u.count + '</td><td style="padding:5px 10px;color:' + theme.sub + ';font-size:11px">' + reporters + (more > 0 ? ' <span style="color:' + theme.subSoft + '">(+' + more + ")</span>" : "") + "</td></tr>";
    });
    if (list.length > 50) {
      html += '<tr><td colspan="4" style="padding:6px 10px;color:' + theme.subSoft + ';font-style:italic">\u2026 und ' + (list.length - 50) + " weitere distinct</td></tr>";
    }
    html += "</tbody></table>";
    return html;
  }
  function renderLldpQuality(wrap) {
    if (window._ntCy) {
      try {
        window._ntCy.destroy();
      } catch (e) {
      }
      window._ntCy = null;
    }
    if (window._ntEdgeAnim) {
      clearInterval(window._ntEdgeAnim);
      window._ntEdgeAnim = null;
    }
    const dark = !!(document.getElementById("nt-root") && document.getElementById("nt-root").classList.contains("nt-dark"));
    const theme = mkTabTheme(dark);
    Array.from(wrap.children).forEach(function(ch) {
      if (ch.id !== "nt-loading") wrap.removeChild(ch);
    });
    const root = document.createElement("div");
    root.style.cssText = "padding:20px;background:" + theme.bg + ";color:" + theme.text + ";height:100%;overflow:auto;font-family:sans-serif";
    const head = document.createElement("div");
    head.innerHTML = '<h2 style="margin:0 0 6px;font-size:16px">LLDP / CDP Quality</h2><div style="font-size:12px;color:' + theme.sub + ';margin-bottom:16px">Wie zuverlaessig kann Zabbix die LLDP-/CDP-Nachbarn auf bekannte Hosts mappen? Match-Quote &lt; 90% bedeutet meist: Nachbarn existieren in der echten Welt aber nicht in Zabbix, oder die Naming-Konventionen weichen ab.</div>';
    root.appendChild(head);
    const data = window._ntLastData || {};
    const perHost = data.lldp_quality || [];
    root.appendChild(_makeDiv(_aggregateBlock(perHost, theme)));
    root.appendChild(_makeDiv(_perHostTable(perHost, theme)));
    root.appendChild(_makeDiv(_topUnmatchedTable(perHost, theme)));
    wrap.appendChild(root);
  }
  function _makeDiv(html) {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d;
  }

  // assets/js/modules/export.js
  var SEV_LBL3 = ["Normal", "Info", "Warning", "Average", "High", "Disaster"];
  var SEV_COLORS3 = {
    Normal: "#22c55e",
    Info: "#06b6d4",
    Warning: "#f59e0b",
    Average: "#f97316",
    High: "#ef4444",
    Disaster: "#991b1b"
  };
  function currentBg() {
    const root = document.getElementById("nt-root");
    return root && root.classList.contains("nt-dark") ? "#0f172a" : "#f8fafc";
  }
  function buildReportHtml(opts) {
    if (!window._ntCy || !window._ntNodes) return null;
    const nodes = window._ntNodes;
    const links = loadLinks();
    const now = (/* @__PURE__ */ new Date()).toLocaleString("de-DE");
    const mapImg = opts.includeMap ? window._ntCy.png({ full: true, scale: 2, bg: currentBg() }) : null;
    const rows = nodes.slice().sort(function(a, b) {
      return (b.severity || 0) - (a.severity || 0) || (a.label || "").localeCompare(b.label || "");
    }).map(function(n) {
      const sev = SEV_LBL3[n.severity || 0] || "Normal";
      const col = SEV_COLORS3[sev] || "#22c55e";
      const tr = n.traffic || { in: 0, out: 0 };
      return "<tr><td>" + esc(n.label || n.host) + '</td><td><span style="color:' + col + ';font-weight:600">&#9679; ' + sev + "</span></td><td>" + esc(n.ip || "\u2014") + "</td><td>" + (n.cpu != null ? n.cpu + "%" : "\u2014") + "</td><td>" + (n.memory != null ? n.memory + "%" : "\u2014") + "</td><td>" + (n.ping > 0 ? n.ping + " ms" : "\u2014") + '</td><td style="color:#22c55e">' + fmt(tr.in) + '</td><td style="color:#06b6d4">' + fmt(tr.out) + "</td></tr>";
    }).join("");
    const meta = t("export.report.meta", { date: now, hosts: nodes.length, links: links.length });
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>NT Report</title><style>body{font-family:sans-serif;margin:20px;color:#1e293b}h1{font-size:18px;border-bottom:2px solid #3b82f6;padding-bottom:6px}.meta{font-size:11px;color:#64748b;margin-bottom:16px}.map{text-align:center;margin-bottom:20px}.map img{max-width:100%;border:1px solid #e2e8f0;border-radius:6px}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#f8fafc;padding:7px 10px;text-align:left;border-bottom:2px solid #e2e8f0;color:#475569}td{padding:6px 10px;border-bottom:1px solid #f1f5f9}@media print{@page{size:A4 landscape;margin:10mm}}</style></head><body><h1>Network Topology &mdash; Report</h1><div class="meta">' + meta + "</div>" + (mapImg ? '<div class="map"><img src="' + mapImg + '"/></div>' : "") + "<table><thead><tr><th>Name</th><th>Status</th><th>IP</th><th>CPU</th><th>Memory</th><th>Ping</th><th>IN</th><th>OUT</th></tr></thead><tbody>" + rows + "</tbody></table></body></html>";
  }
  function buildAuditHtml(complianceData) {
    if (!window._ntNodes) return null;
    const nodes = window._ntNodes.filter(function(n) {
      return !n._isInternet;
    });
    const now = (/* @__PURE__ */ new Date()).toLocaleString("de-DE");
    const STALE_S2 = 300;
    const nowSec = Math.floor(Date.now() / 1e3);
    let countOff = 0, countStale = 0, countCrit = 0, countUnack = 0, totalProbs = 0;
    nodes.forEach(function(n) {
      if (n.unavailable) countOff++;
      const age = n.last_seen ? nowSec - n.last_seen : 0;
      if (!n.unavailable && n.last_seen > 0 && age > STALE_S2) countStale++;
      if ((n.severity || 0) >= 4) countCrit++;
      if ((n.problems || 0) > 0 && !n.acknowledged) countUnack++;
      totalProbs += n.problems || 0;
    });
    const groupStats = statsByGroup(nodes).sort(function(a, b) {
      return a.score - b.score;
    });
    const stale_now = nowSec;
    const top10 = nodes.map(function(n) {
      const sev = n.severity || 0;
      const probs = n.problems || 0;
      const isOff = !!n.unavailable;
      const age = n.last_seen ? stale_now - n.last_seen : 0;
      const isStl = !isOff && n.last_seen > 0 && age > STALE_S2;
      let bad = sev * 10 + probs * 2;
      if (isOff) bad += 50;
      if (isStl) bad += 15;
      if (probs > 0 && !n.acknowledged) bad += 20;
      return { n, bad, isOff, isStl };
    }).filter(function(x) {
      return x.bad > 0;
    }).sort(function(a, b) {
      return b.bad - a.bad;
    }).slice(0, 10);
    const critHosts = nodes.filter(function(n) {
      return (n.severity || 0) >= 4;
    }).sort(function(a, b) {
      return (b.severity || 0) - (a.severity || 0);
    });
    const offline = nodes.filter(function(n) {
      return n.unavailable;
    });
    const stale = nodes.filter(function(n) {
      const age = n.last_seen ? nowSec - n.last_seen : 0;
      return !n.unavailable && n.last_seen > 0 && age > STALE_S2;
    });
    const problemHits = {};
    nodes.forEach(function(n) {
      const dets = n.problems_detail || n._problems_detail || [];
      dets.forEach(function(p) {
        const name = p && p.name || "";
        if (!name) return;
        if (!problemHits[name]) problemHits[name] = { count: 0, worstSev: 0 };
        problemHits[name].count++;
        problemHits[name].worstSev = Math.max(problemHits[name].worstSev, p.sev || 0);
      });
    });
    const topProblems = Object.keys(problemHits).map(function(name) {
      return { name, count: problemHits[name].count, sev: problemHits[name].worstSev };
    }).sort(function(a, b) {
      return b.count - a.count || b.sev - a.sev || a.name.localeCompare(b.name);
    }).slice(0, 10);
    const byProxy = {};
    nodes.forEach(function(n) {
      const p = n.proxy_name && n.proxy_name.trim() ? n.proxy_name : t("export.audit.noproxy");
      if (!byProxy[p]) byProxy[p] = { name: p, total: 0, offline: 0, problems: 0 };
      byProxy[p].total++;
      if (n.unavailable) byProxy[p].offline++;
      byProxy[p].problems += n.problems || 0;
    });
    const proxyList = Object.values(byProxy).sort(function(a, b) {
      return b.total - a.total;
    });
    function tr(cells) {
      return "<tr>" + cells.map(function(c) {
        return "<td" + (c && c.style ? ' style="' + c.style + '"' : "") + ">" + (c && c.text !== void 0 ? c.text : c) + "</td>";
      }).join("") + "</tr>";
    }
    function th(labels) {
      return "<tr>" + labels.map(function(l) {
        return "<th>" + l + "</th>";
      }).join("") + "</tr>";
    }
    function sevPill(sev) {
      const lbl = SEV_LBL3[sev || 0] || "Normal";
      const col = SEV_COLORS3[lbl] || "#22c55e";
      return '<span style="color:' + col + ';font-weight:600">&#9679; ' + esc(lbl) + "</span>";
    }
    function ageStr(ts) {
      if (!ts) return "\u2014";
      const s = nowSec - ts;
      if (s < 60) return s + "s";
      if (s < 3600) return Math.floor(s / 60) + "m";
      if (s < 86400) return Math.floor(s / 3600) + "h";
      return Math.floor(s / 86400) + "d";
    }
    const summarySection = "<section><h2>" + t("export.audit.summary") + '</h2><table class="summary"><tbody><tr><th>' + t("export.audit.hosts_total") + "</th><td>" + nodes.length + "</td></tr><tr><th>Offline</th><td" + (countOff > 0 ? ' class="bad"' : "") + ">" + countOff + "</td></tr><tr><th>Stale</th><td" + (countStale > 0 ? ' class="warn"' : "") + ">" + countStale + "</td></tr><tr><th>" + t("export.audit.crit_sev") + "</th><td" + (countCrit > 0 ? ' class="bad"' : "") + ">" + countCrit + "</td></tr><tr><th>" + t("export.audit.unacked") + "</th><td" + (countUnack > 0 ? ' class="warn"' : "") + ">" + countUnack + "</td></tr><tr><th>" + t("export.audit.problems_total") + "</th><td>" + totalProbs + "</td></tr></tbody></table></section>";
    const top10Section = top10.length === 0 ? "" : "<section><h2>" + t("export.audit.top10") + "</h2><table><thead>" + th(["#", "Host", "IP", "Severity", "Status", t("export.audit.col.problems"), "Acked", "Proxy"]) + "</thead><tbody>" + top10.map(function(x, i) {
      const n = x.n;
      const status = x.isOff ? '<b style="color:#dc2626">OFFLINE</b>' : x.isStl ? '<b style="color:#f59e0b">STALE</b>' : "\u2014";
      return tr([
        { text: "<b>" + (i + 1) + "</b>", style: "color:#64748b;font-family:monospace" },
        esc(n.label || n.host || ""),
        esc(n.ip || "\u2014"),
        sevPill(n.severity),
        status,
        { text: n.problems || 0, style: (n.problems || 0) > 0 ? "font-weight:600" : "color:#94a3b8" },
        n.acknowledged ? "\u2714" : "\u2014",
        esc(n.proxy_name || "\u2014")
      ]);
    }).join("") + '</tbody></table><div style="font-size:10px;color:#94a3b8;margin-top:4px">' + t("export.audit.ranking") + "</div></section>";
    const groupsSection = "<section><h2>Hostgroups (" + groupStats.length + ")</h2><table><thead>" + th([t("export.audit.col.group"), "Hosts", "Offline", "Stale", "Critical", "Unacked", "Score"]) + "</thead><tbody>" + groupStats.map(function(g) {
      const col = scoreColor(g.score);
      return tr([
        "<b>" + esc(g.name) + "</b>",
        g.total,
        { text: g.offline, style: g.offline > 0 ? "color:#dc2626;font-weight:600" : "" },
        { text: g.stale, style: g.stale > 0 ? "color:#f59e0b;font-weight:600" : "" },
        { text: g.critical, style: g.critical > 0 ? "color:#dc2626;font-weight:600" : "" },
        { text: g.unacked, style: g.unacked > 0 ? "color:#f97316;font-weight:600" : "" },
        { text: "<b>" + g.score + "</b> " + scoreLabel(g.score), style: "color:" + col + ";font-weight:700" }
      ]);
    }).join("") + "</tbody></table></section>";
    const critSection = critHosts.length === 0 ? "" : "<section><h2>" + t("export.audit.crit_hosts", { n: critHosts.length }) + "</h2><table><thead>" + th(["Host", "IP", "Severity", t("export.audit.col.problems"), "Acked", "Proxy"]) + "</thead><tbody>" + critHosts.slice(0, 100).map(function(n) {
      return tr([
        esc(n.label || n.host || ""),
        esc(n.ip || "\u2014"),
        sevPill(n.severity),
        n.problems || 0,
        n.acknowledged ? "\u2714" : "\u2014",
        esc(n.proxy_name || "\u2014")
      ]);
    }).join("") + (critHosts.length > 100 ? '<tr><td colspan="6"><i>' + t("export.audit.more", { n: critHosts.length - 100 }) + "</i></td></tr>" : "") + "</tbody></table></section>";
    const offlineSection = offline.length === 0 && stale.length === 0 ? "" : "<section><h2>Offline &amp; Stale</h2>" + (offline.length > 0 ? "<h3>Offline (" + offline.length + ")</h3><table><thead>" + th(["Host", "IP", t("export.audit.col.last_seen"), "Proxy", t("export.audit.col.error")]) + "</thead><tbody>" + offline.map(function(n) {
      return tr([
        esc(n.label || n.host || ""),
        esc(n.ip || "\u2014"),
        ageStr(n.last_seen),
        esc(n.proxy_name || "\u2014"),
        esc(n.down_error || "\u2014")
      ]);
    }).join("") + "</tbody></table>" : "") + (stale.length > 0 ? "<h3>Stale (" + stale.length + ")</h3><table><thead>" + th(["Host", "IP", t("export.audit.col.last_seen"), "Proxy"]) + "</thead><tbody>" + stale.map(function(n) {
      return tr([
        esc(n.label || n.host || ""),
        esc(n.ip || "\u2014"),
        ageStr(n.last_seen),
        esc(n.proxy_name || "\u2014")
      ]);
    }).join("") + "</tbody></table>" : "") + "</section>";
    const topProbsSection = topProblems.length === 0 ? "" : "<section><h2>" + t("export.audit.top_problems", { n: topProblems.length }) + "</h2><table><thead>" + th(["Trigger", "Severity", t("export.audit.col.affected")]) + "</thead><tbody>" + topProblems.map(function(p) {
      return tr([esc(p.name), sevPill(p.sev), p.count]);
    }).join("") + "</tbody></table></section>";
    const proxySection = "<section><h2>" + t("export.audit.proxies", { n: proxyList.length }) + "</h2><table><thead>" + th(["Proxy", "Hosts", "Offline", t("export.audit.col.problems")]) + "</thead><tbody>" + proxyList.map(function(p) {
      return tr([
        "<b>" + esc(p.name) + "</b>",
        p.total,
        { text: p.offline, style: p.offline > 0 ? "color:#dc2626;font-weight:600" : "" },
        p.problems
      ]);
    }).join("") + "</tbody></table></section>";
    let complianceSection = "";
    if (complianceData && complianceData.aggregate) {
      const checks = COMPLIANCE_CHECKS.map(function(c) {
        if (c.key === "stale_problem") {
          return {
            key: c.key,
            level: c.level,
            lbl: t("export.audit.stale_problem", { days: complianceData.cutoff_days || 7 })
          };
        }
        return c;
      });
      const colOf = function(lvl) {
        return lvl === "bad" ? "#dc2626" : lvl === "good" ? "#16a34a" : "#0891b2";
      };
      const tot = complianceData.total || 0;
      complianceSection = "<section><h2>" + t("export.audit.compliance", { n: tot }) + "</h2><table><thead>" + th(["Check", "Level", t("export.audit.col.affected"), "%"]) + "</thead><tbody>" + checks.map(function(c) {
        const n = complianceData.aggregate[c.key] || 0;
        const pct = tot > 0 ? Math.round(100 * n / tot) : 0;
        const lvlLbl = c.level === "bad" ? t("export.audit.lvl_bad") : c.level === "good" ? t("export.audit.lvl_good") : t("export.audit.lvl_info");
        return tr([
          "<b>" + esc(c.lbl) + "</b>",
          { text: '<span style="color:' + colOf(c.level) + ';font-weight:600">' + lvlLbl + "</span>" },
          { text: n, style: n > 0 && c.level === "bad" ? "color:#dc2626;font-weight:700" : n > 0 ? "font-weight:600" : "color:#94a3b8" },
          { text: pct + "%", style: "color:#64748b" }
        ]);
      }).join("") + '</tbody></table><div style="font-size:10px;color:#94a3b8;margin-top:4px">' + t("export.audit.lvl_note") + "</div></section>";
    }
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>NT Audit Report</title><style>body{font-family:sans-serif;margin:28px;color:#1e293b;line-height:1.4}h1{font-size:20px;border-bottom:3px solid #0275b8;padding-bottom:8px;margin:0 0 4px}h2{font-size:14px;color:#0275b8;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #dfe4e7;padding-bottom:4px;margin:24px 0 10px}h3{font-size:12px;color:#475569;margin:14px 0 6px}.meta{font-size:11px;color:#64748b;margin-bottom:14px}section{margin-bottom:8px}table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:6px}th{background:#f1f5f9;padding:5px 9px;text-align:left;border-bottom:2px solid #cbd5e1;color:#334155;font-weight:600}td{padding:4px 9px;border-bottom:1px solid #eef2f5}table.summary{width:auto;min-width:280px;font-size:12px}table.summary th{background:transparent;width:180px;font-weight:500;color:#64748b;border-bottom:1px solid #eef2f5}table.summary td{font-weight:700;font-family:monospace}.bad{color:#dc2626}.warn{color:#f59e0b}@media print{@page{size:A4;margin:12mm}h1{page-break-after:avoid}h2{page-break-after:avoid}}</style></head><body><h1>Network Topology \u2014 Audit Report</h1><div class="meta">' + t("export.audit.meta", { date: esc(now), hosts: nodes.length }) + "</div>" + summarySection + top10Section + groupsSection + critSection + offlineSection + topProbsSection + proxySection + complianceSection + "</body></html>";
  }
  function ntShowExportOverlay(png, printMode) {
    const existing = document.getElementById("nt-export-overlay");
    if (existing) existing.remove();
    const ov = document.createElement("div");
    ov.id = "nt-export-overlay";
    ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.88);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer";
    const hint = printMode ? t("export.overlay.print") : t("export.overlay.png");
    ov.innerHTML = '<div style="color:#ccc;font-family:sans-serif;font-size:12px;margin-bottom:12px;text-align:center">' + hint + '</div><img src="' + png + '" style="max-width:95vw;max-height:85vh;display:block;border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,0.5)"/>';
    ov.addEventListener("click", function() {
      ov.remove();
    });
    document.body.appendChild(ov);
    if (printMode) setTimeout(function() {
      window.print();
    }, 500);
  }
  function setupExportMenu(bar, isFirstRun) {
    const existing = document.getElementById("nt-export-wrap");
    if (existing) existing.remove();
    const expWrap = document.createElement("div");
    expWrap.id = "nt-export-wrap";
    expWrap.style.cssText = "position:relative;display:inline-block;margin-left:4px";
    const expBtn = document.createElement("button");
    expBtn.className = "btn-alt btn-small";
    expBtn.style.margin = "0";
    expBtn.textContent = "\u2B07 Export";
    const expMenu = document.createElement("div");
    expMenu.style.cssText = "display:none;position:absolute;top:100%;left:0;z-index:9999;background:#fff;border:1px solid #e2e8f0;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:150px;overflow:hidden;margin-top:2px";
    function mItem(icon, label, fn) {
      const row = document.createElement("div");
      row.style.cssText = "padding:8px 14px;cursor:pointer;font-size:13px;color:#334155;white-space:nowrap;display:flex;align-items:center;gap:8px";
      row.innerHTML = "<span>" + icon + "</span><span>" + label + "</span>";
      row.addEventListener("mouseover", function() {
        this.style.background = "#f8fafc";
      });
      row.addEventListener("mouseout", function() {
        this.style.background = "";
      });
      row.addEventListener("click", function() {
        expMenu.style.display = "none";
        fn();
      });
      expMenu.appendChild(row);
    }
    mItem("&#128444;", "PNG", function() {
      if (!window._ntCy) return;
      ntShowExportOverlay(window._ntCy.png({
        full: true,
        scale: 2,
        bg: currentBg()
      }), false);
    });
    mItem("&#128196;", t("export.menu.pdf"), function() {
      const h = buildReportHtml({ includeMap: true });
      if (!h) return;
      const w = window.open();
      if (w) {
        w.document.write(h);
        w.document.close();
        setTimeout(function() {
          w.print();
        }, 800);
      }
    });
    mItem("&#128190;", t("export.menu.html"), function() {
      const h = buildReportHtml({ includeMap: true });
      if (!h) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([h], { type: "text/html" }));
      a.download = "network-topology-" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".html";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
    const _fetchCompliance = fetchComplianceData;
    mItem("&#128203;", t("export.menu.audit_pdf"), function() {
      const w = window.open();
      if (!w) return;
      w.document.write('<p style="font-family:sans-serif;color:#64748b">' + t("export.generating") + "</p>");
      _fetchCompliance().then(function(compl) {
        const h = buildAuditHtml(compl);
        if (!h) {
          w.close();
          return;
        }
        w.document.open();
        w.document.write(h);
        w.document.close();
        setTimeout(function() {
          w.print();
        }, 800);
      });
    });
    mItem("&#128221;", t("export.menu.audit_html"), function() {
      _fetchCompliance().then(function(compl) {
        const h = buildAuditHtml(compl);
        if (!h) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([h], { type: "text/html" }));
        a.download = "nt-audit-" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".html";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
    });
    expBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      expMenu.style.display = expMenu.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("click", function() {
      expMenu.style.display = "none";
    });
    expWrap.appendChild(expBtn);
    expWrap.appendChild(expMenu);
    if (bar && isFirstRun) bar.appendChild(expWrap);
  }

  // assets/js/modules/history-mode.js
  var _active3 = false;
  var _bar = null;
  var _slider = null;
  var _timeLabel = null;
  var _rangeSel = null;
  var _playBtn = null;
  var _playTimer = null;
  var _playSpeed = 1;
  var _eventsCache = null;
  var _currentTs = 0;
  var _liveRefreshPauseFn = null;
  var _liveRefreshResumeFn = null;
  var _renderFn = function() {
  };
  function setHistoryRenderCallback(fn) {
    _renderFn = fn;
  }
  function setLiveRefreshHooks(pauseFn, resumeFn) {
    _liveRefreshPauseFn = pauseFn;
    _liveRefreshResumeFn = resumeFn;
  }
  var RANGE_PRESETS = [
    { lbl: "1h", sec: 3600 },
    { lbl: "24h", sec: 86400 },
    { lbl: "7d", sec: 7 * 86400 }
  ];
  function fmtTs(ts) {
    const d = new Date(ts * 1e3);
    const pad = function(n) {
      return n < 10 ? "0" + n : "" + n;
    };
    return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function buildBaseUrl3() {
    const p = window.location.pathname;
    const i = p.indexOf("/zabbix.php");
    return i > 0 ? p.substring(0, i + 1) : "/";
  }
  function computeSeveritiesAt(ts) {
    if (!_eventsCache || !_eventsCache.events) return {};
    const result = {};
    Object.keys(_eventsCache.events).forEach(function(hid) {
      const evs = _eventsCache.events[hid] || [];
      const open = {};
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e.ts > ts) break;
        if (e.val === 1) {
          open[e.name] = e.sev;
        } else {
          delete open[e.name];
        }
      }
      let max = 0;
      Object.keys(open).forEach(function(n) {
        if (open[n] > max) max = open[n];
      });
      if (max > 0) result[hid] = max;
    });
    return result;
  }
  function isHistoryActive() {
    return _active3;
  }
  function getHistorySeverities() {
    if (!_active3) return null;
    return computeSeveritiesAt(_currentTs);
  }
  async function fetchHistory(rangeSec) {
    const cfg = window.NT_CONFIG;
    const groupids = cfg && cfg.selected_groupids || [];
    if (!groupids.length) return null;
    const now = Math.floor(Date.now() / 1e3);
    const from = now - rangeSec;
    const to = now;
    const params = new URLSearchParams();
    params.append("action", "network.topology.v6.history");
    params.append("from", String(from));
    params.append("to", String(to));
    groupids.forEach(function(g) {
      params.append("groupids[]", String(g));
    });
    const url = buildBaseUrl3() + "zabbix.php?" + params.toString();
    try {
      const resp = await fetch(url, {
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" }
      });
      const data = await resp.json();
      if (data.error) {
        console.warn("History fetch error:", data.error);
        return null;
      }
      return {
        from: data.from,
        to: data.to,
        events: data.events || {},
        truncated: !!data.truncated,
        fetchedAt: Date.now()
      };
    } catch (e) {
      console.error("History fetch failed:", e);
      return null;
    }
  }
  function updateTimeLabel() {
    if (_timeLabel) _timeLabel.textContent = fmtTs(_currentTs);
  }
  function setSliderRange() {
    if (!_eventsCache || !_slider) return;
    _slider.min = String(_eventsCache.from);
    _slider.max = String(_eventsCache.to);
    _slider.value = String(_currentTs);
  }
  var _fetchSeq = 0;
  async function applyRange(rangeSec) {
    if (_bar) _bar.style.opacity = "0.5";
    const seq = ++_fetchSeq;
    const data = await fetchHistory(rangeSec);
    if (seq !== _fetchSeq) return;
    if (_bar) _bar.style.opacity = "1";
    if (!data) {
      if (_timeLabel) _timeLabel.textContent = t("hist.load_error");
      return;
    }
    _eventsCache = data;
    _currentTs = data.to;
    setSliderRange();
    updateTimeLabel();
    _renderFn();
  }
  function buildBar() {
    const bar = document.createElement("div");
    bar.id = "nt-history-bar";
    bar.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 12px;background:#fef3c7;border-bottom:1px solid #fcd34d;flex-wrap:wrap;transition:opacity 0.2s";
    const lbl = document.createElement("span");
    lbl.innerHTML = "\u{1F551} <strong>" + t("hist.title") + "</strong>";
    lbl.style.cssText = "font-size:13px;color:#78350f";
    bar.appendChild(lbl);
    const rangeSel = document.createElement("select");
    rangeSel.id = "nt-history-range";
    rangeSel.style.cssText = "padding:3px 6px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px;background:#fff";
    RANGE_PRESETS.forEach(function(r, i) {
      const opt = document.createElement("option");
      opt.value = String(r.sec);
      opt.textContent = r.lbl;
      if (i === 1) opt.selected = true;
      rangeSel.appendChild(opt);
    });
    bar.appendChild(rangeSel);
    _rangeSel = rangeSel;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.id = "nt-history-slider";
    slider.style.cssText = "flex:1;min-width:200px;cursor:pointer";
    bar.appendChild(slider);
    _slider = slider;
    const tl = document.createElement("span");
    tl.id = "nt-history-time";
    tl.style.cssText = "font-family:monospace;font-size:12px;color:#0f172a;font-weight:700;min-width:130px;text-align:center;background:#fff;padding:3px 8px;border-radius:4px;border:1px solid #fcd34d";
    tl.textContent = "\u2014";
    bar.appendChild(tl);
    _timeLabel = tl;
    const play = document.createElement("button");
    play.id = "nt-history-play";
    play.textContent = "\u25B6";
    play.style.cssText = "padding:3px 10px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;cursor:pointer;font-size:13px;color:#475569";
    play.title = t("hist.play_pause");
    bar.appendChild(play);
    _playBtn = play;
    const close = document.createElement("button");
    close.textContent = t("hist.close");
    close.style.cssText = "padding:3px 10px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;color:#475569;margin-left:auto";
    bar.appendChild(close);
    rangeSel.addEventListener("change", function() {
      applyRange(parseInt(this.value, 10));
    });
    let _sliderTimer = null;
    slider.addEventListener("input", function() {
      _currentTs = parseInt(this.value, 10);
      updateTimeLabel();
      if (_sliderTimer) clearTimeout(_sliderTimer);
      _sliderTimer = setTimeout(function() {
        _renderFn();
      }, 50);
    });
    play.addEventListener("click", function() {
      if (_playTimer) {
        clearInterval(_playTimer);
        _playTimer = null;
        play.textContent = "\u25B6";
      } else {
        play.textContent = "\u23F8";
        _playTimer = setInterval(function() {
          if (!_eventsCache) return;
          const range = _eventsCache.to - _eventsCache.from;
          const step = Math.max(1, Math.floor(range / 100));
          _currentTs += step * _playSpeed;
          if (_currentTs >= _eventsCache.to) {
            _currentTs = _eventsCache.to;
            clearInterval(_playTimer);
            _playTimer = null;
            play.textContent = "\u25B6";
          }
          slider.value = String(_currentTs);
          updateTimeLabel();
          _renderFn();
        }, 1e3);
      }
    });
    close.addEventListener("click", deactivate);
    return bar;
  }
  function activate() {
    if (_active3) return;
    _active3 = true;
    if (_liveRefreshPauseFn) try {
      _liveRefreshPauseFn();
    } catch (e) {
    }
    const topbar = document.querySelector(".nt-topbar");
    if (!topbar || !topbar.parentNode) return;
    if (!_bar) _bar = buildBar();
    topbar.parentNode.insertBefore(_bar, topbar.nextSibling);
    applyRange(parseInt(_rangeSel.value, 10));
    const btn = document.getElementById("nt-btn-history");
    if (btn) {
      btn.style.background = "#fbbf24";
      btn.style.color = "#78350f";
    }
  }
  function deactivate() {
    if (!_active3) return;
    _active3 = false;
    if (_playTimer) {
      clearInterval(_playTimer);
      _playTimer = null;
    }
    if (_bar && _bar.parentNode) _bar.parentNode.removeChild(_bar);
    _bar = null;
    _slider = null;
    _timeLabel = null;
    _rangeSel = null;
    _playBtn = null;
    _eventsCache = null;
    _currentTs = 0;
    const btn = document.getElementById("nt-btn-history");
    if (btn) {
      btn.style.background = "";
      btn.style.color = "";
    }
    if (_liveRefreshResumeFn) try {
      _liveRefreshResumeFn();
    } catch (e) {
    }
    _renderFn();
  }
  function toggleHistoryMode() {
    if (_active3) deactivate();
    else activate();
  }
  function addHistoryButton(bar, isFirstRun) {
    if (!bar || !isFirstRun) return;
    if (document.getElementById("nt-btn-history")) return;
    const b = document.createElement("button");
    b.id = "nt-btn-history";
    b.className = "btn-alt btn-small";
    b.style.marginLeft = "4px";
    b.textContent = t("hist.button");
    b.title = t("hist.button.tip");
    b.addEventListener("click", toggleHistoryMode);
    bar.appendChild(b);
  }

  // assets/js/modules/presets-ui.js
  var _renderFn2 = function() {
  };
  function setRenderCallback(fn) {
    _renderFn2 = fn;
  }
  function presetMatches(p, ident) {
    if (!ident || !p) return false;
    if (p.name !== ident.name) return false;
    if (ident.scope === null || ident.scope === void 0) return true;
    if (p.scope !== ident.scope) return false;
    if (p.scope === "global") return true;
    return p.scopeKey === ident.scopeKey;
  }
  function setupPresetsUI(bar, isFirstRun, cy) {
    if (!bar) return;
    if (document.getElementById("nt-preset-wrap")) return;
    if (!isFirstRun) return;
    const wrap = document.createElement("div");
    wrap.id = "nt-preset-wrap";
    wrap.style.cssText = "display:inline-flex;align-items:center;gap:2px;margin-left:8px;padding-left:8px;border-left:1px solid #e2e8f0";
    let _active4 = loadActivePreset();
    const ddWrap = document.createElement("div");
    ddWrap.style.cssText = "position:relative;display:inline-block";
    const ddBtn = document.createElement("button");
    ddBtn.className = "btn-alt btn-small";
    ddBtn.style.margin = "0";
    ddBtn.id = "nt-preset-dd-btn";
    const ddMenu = document.createElement("div");
    ddMenu.style.cssText = "display:none;position:absolute;top:100%;left:0;z-index:9999;background:#fff;border:1px solid #e2e8f0;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:200px;max-width:320px;overflow-y:auto;max-height:360px;margin-top:2px";
    function ddLabel() {
      const n = _active4 && _active4.name;
      return n ? "\u{1F4C2} " + (n.length > 16 ? n.substring(0, 14) + "\u2026" : n) : "\u{1F4C2} Presets";
    }
    ddBtn.textContent = ddLabel();
    function rebuildMenu() {
      while (ddMenu.firstChild) ddMenu.removeChild(ddMenu.firstChild);
      const presets = loadRelevantPresets();
      const groupset = presets.filter(function(p) {
        return p.scope === "groupset";
      });
      const global = presets.filter(function(p) {
        return p.scope === "global";
      });
      function addRow(p) {
        const row = document.createElement("div");
        const isActive = presetMatches(p, _active4);
        row.style.cssText = "padding:8px 14px;cursor:pointer;font-size:13px;color:" + (isActive ? "#1d4ed8" : "#334155") + ";background:" + (isActive ? "#dbeafe" : "transparent") + ";font-weight:" + (isActive ? "600" : "400") + ";display:flex;align-items:center;gap:6px;white-space:nowrap";
        const icon = p.scope === "global" ? "\u{1F30D}" : "\u{1F4CC}";
        const txt = document.createElement("span");
        txt.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis";
        txt.textContent = icon + " " + p.name;
        txt.title = p.name + " (" + (p.scope === "global" ? t("presets.scope.global") : t("presets.scope.this")) + ")";
        row.appendChild(txt);
        row.addEventListener("mouseover", function() {
          if (!isActive) this.style.background = "#f8fafc";
        });
        row.addEventListener("mouseout", function() {
          this.style.background = isActive ? "#dbeafe" : "transparent";
        });
        row.addEventListener("click", function() {
          ddMenu.style.display = "none";
          applyPreset(p);
          _active4 = { name: p.name, scope: p.scope, scopeKey: p.scopeKey };
          saveActivePreset(p.name, p.scope, p.scopeKey);
          ddBtn.textContent = ddLabel();
          updateButtons();
          const wrap2 = document.getElementById("nt-canvas-wrap");
          const ld = window._ntLastData || {};
          _renderFn2(wrap2, (ld.nodes || []).slice(), (ld.edges || []).slice(), ld.url || "");
        });
        ddMenu.appendChild(row);
      }
      function addHeader(label) {
        const h = document.createElement("div");
        h.style.cssText = "padding:6px 14px 2px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px";
        h.textContent = label;
        ddMenu.appendChild(h);
      }
      if (groupset.length === 0 && global.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding:12px 14px;font-size:12px;color:#94a3b8;font-style:italic";
        empty.textContent = t("presets.empty");
        ddMenu.appendChild(empty);
        return;
      }
      if (groupset.length > 0) {
        addHeader(t("presets.scope.this"));
        groupset.forEach(addRow);
      }
      if (global.length > 0) {
        addHeader(t("presets.scope.global"));
        global.forEach(addRow);
      }
    }
    ddBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      if (ddMenu.style.display === "none") {
        rebuildMenu();
        ddMenu.style.display = "block";
      } else {
        ddMenu.style.display = "none";
      }
    });
    document.addEventListener("click", function() {
      ddMenu.style.display = "none";
    });
    ddWrap.appendChild(ddBtn);
    ddWrap.appendChild(ddMenu);
    wrap.appendChild(ddWrap);
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn-alt btn-small";
    saveBtn.style.margin = "0";
    saveBtn.title = t("presets.save.tip");
    saveBtn.textContent = "\u{1F4BE}";
    const saveAsBtn = document.createElement("button");
    saveAsBtn.className = "btn-alt btn-small";
    saveAsBtn.style.margin = "0";
    saveAsBtn.title = t("presets.saveas.tip");
    saveAsBtn.textContent = "\u{1F4DD}";
    const delBtn = document.createElement("button");
    delBtn.className = "btn-alt btn-small";
    delBtn.style.margin = "0";
    delBtn.title = t("presets.del.tip");
    delBtn.textContent = "\u{1F5D1}";
    function updateButtons() {
      const has = !!(_active4 && _active4.name);
      saveBtn.disabled = !has;
      delBtn.disabled = !has;
      saveBtn.style.opacity = has ? "1" : "0.4";
      delBtn.style.opacity = has ? "1" : "0.4";
      saveBtn.style.cursor = has ? "pointer" : "not-allowed";
      delBtn.style.cursor = has ? "pointer" : "not-allowed";
    }
    saveBtn.addEventListener("click", function() {
      if (!_active4 || !_active4.name) return;
      const existing = loadRelevantPresets().find(function(p) {
        return presetMatches(p, _active4);
      });
      if (!existing) {
        toast(t("presets.notfound"), "warn");
        _active4 = null;
        saveActivePreset("", null, null);
        ddBtn.textContent = ddLabel();
        updateButtons();
        return;
      }
      const saved = savePreset(existing.name, existing.scope, collectCurrentState());
      _active4 = { name: saved.name, scope: saved.scope, scopeKey: saved.scopeKey };
      saveActivePreset(saved.name, saved.scope, saved.scopeKey);
      saveBtn.style.background = "#dcfce7";
      setTimeout(function() {
        saveBtn.style.background = "";
      }, 600);
    });
    saveAsBtn.addEventListener("click", function() {
      const name = prompt(t("presets.name_prompt"));
      if (!name || !name.trim()) return;
      const cleanName = name.trim().substring(0, 40);
      const isGlobal = confirm(t("presets.scope_confirm"));
      const scope = isGlobal ? "global" : "groupset";
      const existing = loadRelevantPresets().find(function(p) {
        return p.name === cleanName && p.scope === scope;
      });
      if (existing && !confirm(t("presets.overwrite_confirm", { name: cleanName }))) {
        return;
      }
      const saved = savePreset(cleanName, scope, collectCurrentState());
      _active4 = { name: saved.name, scope: saved.scope, scopeKey: saved.scopeKey };
      saveActivePreset(saved.name, saved.scope, saved.scopeKey);
      ddBtn.textContent = ddLabel();
      updateButtons();
    });
    delBtn.addEventListener("click", function() {
      if (!_active4 || !_active4.name) return;
      if (!confirm(t("presets.delete_confirm", { name: _active4.name }))) return;
      const existing = loadRelevantPresets().find(function(p) {
        return presetMatches(p, _active4);
      });
      if (existing) {
        deletePreset(existing.name, existing.scope, existing.scopeKey);
      }
      _active4 = null;
      saveActivePreset("", null, null);
      ddBtn.textContent = ddLabel();
      updateButtons();
    });
    wrap.appendChild(saveBtn);
    wrap.appendChild(saveAsBtn);
    wrap.appendChild(delBtn);
    bar.appendChild(wrap);
    updateButtons();
  }

  // assets/js/modules/sev-filter.js
  var _sevFilter = loadSevFilter();
  var _offlineOnly = false;
  function applyFilter(cy) {
    if (_offlineOnly) {
      cy.nodes("[!isGroup]").forEach(function(n) {
        n.style("display", n.data("unavailable") ? "element" : "none");
      });
      cy.edges().forEach(function(e) {
        const show = e.source().data("unavailable") || e.target().data("unavailable");
        e.style("display", show ? "element" : "none");
      });
      return;
    }
    if (_sevFilter.size === 0) {
      cy.elements().style("display", "element");
      return;
    }
    cy.nodes("[!isGroup]").forEach(function(n) {
      n.style("display", _sevFilter.has(n.data("severity") || 0) ? "element" : "none");
    });
    cy.edges().forEach(function(e) {
      const show = _sevFilter.has(e.source().data("severity") || 0) && _sevFilter.has(e.target().data("severity") || 0);
      e.style("display", show ? "element" : "none");
    });
  }
  function buildSevFilter(bar, cy) {
    if (document.getElementById("nt-sev-filter")) return;
    const wrap = document.createElement("div");
    wrap.id = "nt-sev-filter";
    wrap.style.cssText = "display:flex;align-items:center;gap:5px;margin-left:10px;padding-left:8px;border-left:1px solid #e2e8f0;flex-shrink:0";
    [
      { sev: 0, col: "#22c55e", lbl: t("sev.ok") },
      { sev: 2, col: "#06b6d4", lbl: t("sev.info") },
      { sev: 3, col: "#f59e0b", lbl: t("sev.warn") },
      { sev: 4, col: "#f97316", lbl: t("sev.avg") },
      { sev: 5, col: "#ef4444", lbl: t("sev.high") }
    ].forEach(function(sd) {
      const pill = document.createElement("button");
      pill.dataset.sev = sd.sev;
      pill.style.cssText = "display:flex;align-items:center;gap:3px;padding:2px 7px;border-radius:12px;border:1.5px solid " + sd.col + ";background:transparent;cursor:pointer;font-size:11px;color:" + sd.col + ";font-weight:600";
      pill.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:' + sd.col + ';display:inline-block"></span>' + esc(sd.lbl);
      if (_sevFilter.has(sd.sev)) {
        pill.style.background = sd.col + "33";
        pill.style.boxShadow = "0 0 0 2px " + sd.col + "44";
      }
      pill.addEventListener("click", function() {
        const s = parseInt(this.dataset.sev);
        if (_sevFilter.has(s)) {
          _sevFilter.delete(s);
          this.style.background = "transparent";
          this.style.boxShadow = "none";
        } else {
          _sevFilter.add(s);
          this.style.background = sd.col + "33";
          this.style.boxShadow = "0 0 0 2px " + sd.col + "44";
        }
        applyFilter(cy);
        saveSevFilter(_sevFilter);
      });
      wrap.appendChild(pill);
    });
    const offBtn = document.createElement("button");
    offBtn.id = "nt-offline-only";
    offBtn.title = t("sev.offline.tip");
    offBtn.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:#9ca3af;display:inline-block;margin-right:3px"></span>' + esc(t("sev.offline"));
    const _setOffStyle = function() {
      const a = _offlineOnly;
      offBtn.style.cssText = "display:flex;align-items:center;padding:2px 7px;border-radius:12px;border:1.5px solid " + (a ? "#e53742" : "#cbd5e1") + ";background:" + (a ? "rgba(229,55,66,0.13)" : "transparent") + ";cursor:pointer;font-size:11px;font-weight:600;color:" + (a ? "#e53742" : "#94a3b8");
    };
    _setOffStyle();
    offBtn.addEventListener("click", function() {
      _offlineOnly = !_offlineOnly;
      _setOffStyle();
      wrap.querySelectorAll("button[data-sev]").forEach(function(b) {
        b.style.opacity = _offlineOnly ? "0.4" : "";
        b.style.pointerEvents = _offlineOnly ? "none" : "";
      });
      applyFilter(cy);
    });
    wrap.appendChild(offBtn);
    const clr = document.createElement("button");
    clr.textContent = "\u2715";
    clr.title = t("sev.reset.tip");
    clr.style.cssText = "padding:2px 5px;border-radius:10px;border:0.5px solid #e2e8f0;background:transparent;cursor:pointer;font-size:11px;color:#94a3b8";
    clr.addEventListener("click", function() {
      _sevFilter.clear();
      _offlineOnly = false;
      _setOffStyle();
      wrap.querySelectorAll("button[data-sev]").forEach(function(b) {
        b.style.background = "transparent";
        b.style.boxShadow = "none";
        b.style.opacity = "";
        b.style.pointerEvents = "";
      });
      applyFilter(cy);
      saveSevFilter(_sevFilter);
    });
    wrap.appendChild(clr);
    bar.appendChild(wrap);
    if (_sevFilter.size > 0) applyFilter(cy);
  }

  // assets/js/modules/toolbar.js
  var _renderFn3 = function() {
  };
  function setRenderCallback2(fn) {
    _renderFn3 = fn;
  }
  function setupToolbar(cy, wrap, nodes, groupNames, isDark, useLayout) {
    const bar = document.querySelector(".nt-topbar__actions");
    const isFirstRun = !window._ntToolbarDone;
    window._ntToolbarDone = true;
    function mkbtn(id, lbl, fn) {
      const existing = id ? document.getElementById(id) : null;
      if (existing) return existing;
      const b = document.createElement("button");
      b.className = "btn-alt btn-small";
      b.style.marginLeft = "4px";
      b.textContent = lbl;
      if (id) b.id = id;
      if (fn) b.addEventListener("click", fn);
      if (bar && isFirstRun) bar.appendChild(b);
      return b;
    }
    const bIn = document.getElementById("nt-btn-zoom-in");
    const bOut = document.getElementById("nt-btn-zoom-out");
    if (bIn) {
      bIn.onclick = null;
      bIn.addEventListener("click", function() {
        cy.zoom({
          level: cy.zoom() * 1.3,
          renderedPosition: { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 }
        });
      });
    }
    if (bOut) {
      bOut.onclick = null;
      bOut.addEventListener("click", function() {
        cy.zoom({
          level: cy.zoom() * 0.77,
          renderedPosition: { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 }
        });
      });
    }
    const bLbl = document.getElementById("nt-btn-labels");
    if (bLbl) bLbl.onclick = function() {
      const hide = this.dataset.hidden !== "1";
      cy.nodes("[!isGroup]").style("label", hide ? "" : "data(label)");
      this.dataset.hidden = hide ? "1" : "0";
      this.textContent = hide ? t("toolbar.labels.show") : t("toolbar.labels.hide");
    };
    const bFs = document.getElementById("nt-btn-fullscreen");
    if (bFs) bFs.addEventListener("click", function() {
      const root = document.getElementById("nt-root");
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
        bFs.textContent = t("toolbar.fullscreen.exit");
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        bFs.textContent = t("toolbar.fullscreen");
      }
    });
    if (!window._ntFsListenerInstalled) {
      window._ntFsListenerInstalled = true;
      const _onFsChange = function() {
        setTimeout(function() {
          if (window._ntCy && !window._ntCy.destroyed()) {
            window._ntCy.resize();
            window._ntCy.fit(window._ntCy.nodes(), 40);
          }
        }, 100);
        if (bFs) {
          const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
          bFs.textContent = inFs ? t("toolbar.fullscreen.exit") : t("toolbar.fullscreen");
        }
      };
      document.addEventListener("fullscreenchange", _onFsChange);
      document.addEventListener("webkitfullscreenchange", _onFsChange);
    }
    const bReset = mkbtn("nt-btn-reset", t("toolbar.fit"), null);
    bReset.addEventListener("click", function() {
      cy.fit(cy.nodes(), 40);
      setTimeout(function() {
        savePositions(cy);
      }, 200);
    });
    (function buildLayoutDropdown() {
      const existing = document.getElementById("nt-layout-wrap");
      if (existing) existing.remove();
      const oldBtn = document.getElementById("nt-btn-layout");
      if (oldBtn) oldBtn.remove();
      const wrap2 = document.createElement("div");
      wrap2.id = "nt-layout-wrap";
      wrap2.style.cssText = "position:relative;display:inline-block;margin-left:4px";
      const btn = document.createElement("button");
      btn.className = "btn-alt btn-small";
      btn.style.margin = "0";
      const _currentLayout = loadLayout();
      const _currentLabel = (LAYOUT_OPTIONS.find(function(o) {
        return o.id === _currentLayout;
      }) || LAYOUT_OPTIONS[0]).label;
      btn.textContent = t("toolbar.layout", { name: _currentLabel });
      const menu = document.createElement("div");
      menu.style.cssText = "display:none;position:absolute;top:100%;left:0;z-index:9999;background:#fff;border:1px solid #e2e8f0;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:160px;overflow:hidden;margin-top:2px";
      LAYOUT_OPTIONS.forEach(function(opt) {
        const row = document.createElement("div");
        const isActive = opt.id === _currentLayout;
        row.style.cssText = "padding:8px 14px;cursor:pointer;font-size:13px;color:" + (isActive ? "#1d4ed8" : "#334155") + ";background:" + (isActive ? "#dbeafe" : "transparent") + ";white-space:nowrap;font-weight:" + (isActive ? "600" : "400");
        row.textContent = opt.label;
        row.addEventListener("mouseover", function() {
          if (!isActive) this.style.background = "#f8fafc";
        });
        row.addEventListener("mouseout", function() {
          if (!isActive) this.style.background = "transparent";
        });
        row.addEventListener("click", function() {
          menu.style.display = "none";
          saveLayout(opt.id);
          clearPositions();
          cy.resize();
          let _clusterMode = "auto";
          try {
            const s = localStorage.getItem(NT_GROUP_CLUSTER_KEY);
            if (s === "auto" || s === "columns" || s === "rows" || s === "off") _clusterMode = s;
          } catch (e) {
          }
          const _useCluster = groupNames && groupNames.length >= 2 && _clusterMode !== "off";
          if (_useCluster) {
            runGroupClusterLayout(cy, groupNames, _clusterMode, function() {
              setTimeout(function() {
                savePositions(cy);
                savePinned(cy);
                cy.fit(cy.nodes(), 30);
              }, 200);
            }, opt.id);
          } else {
            const lo = cy.layout(buildLayoutConfig(opt.id, nodes, [], true));
            lo.one("layoutstop", function() {
              setTimeout(function() {
                savePositions(cy);
                savePinned(cy);
                cy.fit(cy.nodes(), 40);
              }, 400);
            });
            lo.run();
          }
          btn.textContent = t("toolbar.layout", { name: opt.label });
          Array.from(menu.children).forEach(function(child, i) {
            const o = LAYOUT_OPTIONS[i];
            const a = o.id === opt.id;
            child.style.color = a ? "#1d4ed8" : "#334155";
            child.style.background = a ? "#dbeafe" : "transparent";
            child.style.fontWeight = a ? "600" : "400";
          });
        });
        menu.appendChild(row);
      });
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        menu.style.display = menu.style.display === "none" ? "block" : "none";
      });
      document.addEventListener("click", function() {
        menu.style.display = "none";
      });
      wrap2.appendChild(btn);
      wrap2.appendChild(menu);
      if (bar && isFirstRun) bar.appendChild(wrap2);
    })();
    const isTouchDevice = "ontouchstart" in window || window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (isTouchDevice && !document.getElementById("nt-taphold-wrap")) {
      let tapLabel = function() {
        return t("toolbar.taphold", { ms: _tapMs });
      };
      const tapWrap = document.createElement("div");
      tapWrap.id = "nt-taphold-wrap";
      tapWrap.style.cssText = "position:relative;display:inline-block;margin-left:4px";
      const tapBtn = document.createElement("button");
      tapBtn.className = "btn-alt btn-small";
      tapBtn.style.margin = "0";
      const tapMenu = document.createElement("div");
      tapMenu.style.cssText = "display:none;position:absolute;top:100%;left:0;z-index:9999;background:#fff;border:1px solid #e2e8f0;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:130px;overflow:hidden;margin-top:2px";
      let _tapMs = loadTapholdMs();
      tapBtn.textContent = tapLabel();
      [300, 500, 800].forEach(function(ms) {
        const row = document.createElement("div");
        const isActive = ms === _tapMs;
        row.style.cssText = "padding:8px 14px;cursor:pointer;font-size:13px;color:" + (isActive ? "#1d4ed8" : "#334155") + ";background:" + (isActive ? "#dbeafe" : "transparent") + ";font-weight:" + (isActive ? "600" : "400");
        row.textContent = ms + " ms" + (ms === 500 ? " " + t("toolbar.taphold.default") : "");
        row.addEventListener("mouseover", function() {
          if (ms !== _tapMs) this.style.background = "#f8fafc";
        });
        row.addEventListener("mouseout", function() {
          this.style.background = ms === _tapMs ? "#dbeafe" : "transparent";
        });
        row.addEventListener("click", function() {
          _tapMs = ms;
          saveTapholdMs(ms);
          tapBtn.textContent = tapLabel();
          tapMenu.style.display = "none";
          Array.from(tapMenu.children).forEach(function(c, i) {
            const cms = [300, 500, 800][i];
            const a = cms === _tapMs;
            c.style.color = a ? "#1d4ed8" : "#334155";
            c.style.background = a ? "#dbeafe" : "transparent";
            c.style.fontWeight = a ? "600" : "400";
          });
        });
        tapMenu.appendChild(row);
      });
      tapBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        tapMenu.style.display = tapMenu.style.display === "none" ? "block" : "none";
      });
      document.addEventListener("click", function() {
        tapMenu.style.display = "none";
      });
      tapWrap.appendChild(tapBtn);
      tapWrap.appendChild(tapMenu);
      if (bar && isFirstRun) bar.appendChild(tapWrap);
    }
    let _groupViewOn = false;
    try {
      _groupViewOn = localStorage.getItem(NT_GROUP_VIEW_KEY) === "1";
    } catch (e) {
    }
    const bGroup = mkbtn(
      "nt-btn-groupview",
      _groupViewOn ? t("toolbar.group.expand") : t("toolbar.group.collapse"),
      null
    );
    if (_groupViewOn) {
      bGroup.style.background = "#3b82f6";
      bGroup.style.color = "#fff";
    }
    bGroup.onclick = function() {
      const nowOn = localStorage.getItem(NT_GROUP_VIEW_KEY) !== "1";
      try {
        localStorage.setItem(NT_GROUP_VIEW_KEY, nowOn ? "1" : "0");
      } catch (e) {
      }
      const d = window._ntLastData || {};
      if (d.nodes && d.nodes.length) {
        _renderFn3(wrap, d.nodes.slice(), (d.edges || []).slice(), d.url || "");
      }
    };
    if (bar && isFirstRun && !document.getElementById("nt-cluster-wrap")) {
      const clusterWrap = document.createElement("div");
      clusterWrap.id = "nt-cluster-wrap";
      clusterWrap.style.cssText = "position:relative;display:inline-block;margin-left:4px";
      const cMode = function() {
        try {
          return localStorage.getItem(NT_GROUP_CLUSTER_KEY) || "auto";
        } catch (e) {
          return "auto";
        }
      }();
      const labels = {
        auto: t("toolbar.cluster.auto"),
        columns: t("toolbar.cluster.columns"),
        rows: t("toolbar.cluster.rows"),
        off: t("toolbar.cluster.off")
      };
      const cBtn = document.createElement("button");
      cBtn.className = "btn-alt btn-small";
      cBtn.id = "nt-btn-cluster";
      cBtn.textContent = labels[cMode] || labels.auto;
      cBtn.title = t("toolbar.cluster.tip");
      clusterWrap.appendChild(cBtn);
      const cMenu = document.createElement("div");
      cMenu.style.cssText = "position:absolute;top:100%;left:0;background:#fff;border:1px solid #e2e8f0;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.08);min-width:170px;z-index:300;display:none;margin-top:2px";
      ["auto", "columns", "rows", "off"].forEach(function(opt) {
        const item = document.createElement("div");
        item.textContent = labels[opt];
        item.dataset.mode = opt;
        item.style.cssText = "padding:7px 12px;cursor:pointer;font-size:12px;color:#334155";
        if (opt === cMode) {
          item.style.background = "#dbeafe";
          item.style.fontWeight = "600";
        }
        item.addEventListener("mouseenter", function() {
          if (item.dataset.mode !== cMode) item.style.background = "#f1f5f9";
        });
        item.addEventListener("mouseleave", function() {
          if (item.dataset.mode !== cMode) item.style.background = "";
        });
        item.addEventListener("click", function(e) {
          e.stopPropagation();
          const newMode = this.dataset.mode;
          try {
            localStorage.setItem(NT_GROUP_CLUSTER_KEY, newMode);
          } catch (e2) {
          }
          cMenu.style.display = "none";
          const d = window._ntLastData || {};
          if (d.nodes && d.nodes.length) {
            _renderFn3(wrap, d.nodes.slice(), (d.edges || []).slice(), d.url || "");
          }
        });
        cMenu.appendChild(item);
      });
      clusterWrap.appendChild(cMenu);
      cBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        cMenu.style.display = cMenu.style.display === "none" ? "block" : "none";
      });
      document.addEventListener("click", function() {
        cMenu.style.display = "none";
      });
      bar.appendChild(clusterWrap);
    }
    mkbtn("nt-btn-auto", t("toolbar.auto.on"), function() {
      window._ntRefreshOn = !window._ntRefreshOn;
      this.textContent = window._ntRefreshOn ? t("toolbar.auto.on") : t("toolbar.auto.off");
      this.style.opacity = window._ntRefreshOn ? "1" : "0.5";
    });
    let _lldpVisible = localStorage.getItem(NT_LLDP_KEY) !== "0";
    const bLldp = mkbtn(
      "nt-btn-lldp",
      t("toolbar.lldp", { state: _lldpVisible ? t("toolbar.on") : t("toolbar.off") }),
      null
    );
    bLldp.style.opacity = _lldpVisible ? "1" : "0.5";
    if (!_lldpVisible) cy.edges("[?isLLDP]").style("display", "none");
    bLldp.addEventListener("click", function() {
      _lldpVisible = !_lldpVisible;
      localStorage.setItem(NT_LLDP_KEY, _lldpVisible ? "1" : "0");
      cy.edges("[?isLLDP]").style("display", _lldpVisible ? "element" : "none");
      bLldp.textContent = t("toolbar.lldp", { state: _lldpVisible ? t("toolbar.on") : t("toolbar.off") });
      bLldp.style.opacity = _lldpVisible ? "1" : "0.5";
    });
    let _wmOn = false;
    try {
      _wmOn = localStorage.getItem(NT_WEATHERMAP_KEY) === "1";
    } catch (e) {
    }
    setWeathermapMode(_wmOn);
    const bWm = mkbtn("nt-btn-weathermap", "", null);
    const _setWmLabel = function() {
      bWm.textContent = t("toolbar.weathermap", { state: _wmOn ? t("toolbar.on") : t("toolbar.off") });
      bWm.style.opacity = _wmOn ? "1" : "0.5";
      bWm.title = t("toolbar.weathermap.tip");
    };
    _setWmLabel();
    bWm.addEventListener("click", function() {
      _wmOn = !_wmOn;
      try {
        localStorage.setItem(NT_WEATHERMAP_KEY, _wmOn ? "1" : "0");
      } catch (e) {
      }
      setWeathermapMode(_wmOn);
      _setWmLabel();
      applyTrafficHeatmap(window._ntCy);
    });
    const bPorts = mkbtn("nt-btn-portlabels", "", null);
    const _setPortsLabel = function() {
      bPorts.textContent = t("toolbar.portlabels", { state: portLabelsOn() ? t("toolbar.on") : t("toolbar.off") });
      bPorts.style.opacity = portLabelsOn() ? "1" : "0.5";
      bPorts.title = t("toolbar.portlabels.tip");
    };
    _setPortsLabel();
    bPorts.addEventListener("click", function() {
      setPortLabels(!portLabelsOn());
      _setPortsLabel();
      applyPortLabels(window._ntCy);
    });
    const bRc = mkbtn("nt-btn-rootcause", t("rc.button"), null);
    bRc.title = t("rc.button.tip");
    bRc.addEventListener("click", function() {
      toggleRootCause(window._ntCy);
    });
    setupExportMenu(bar, isFirstRun);
    setupPresetsUI(bar, isFirstRun, cy);
    const bLink = mkbtn("nt-btn-link", t("toolbar.link"), null);
    bLink.title = t("toolbar.link.tip");
    bLink.onclick = function() {
      if (isLinkModeActive()) {
        exitLinkMode();
        return;
      }
      resetHighlight(cy);
      enterLinkMode();
      bLink.style.background = "#dbeafe";
      bLink.style.color = "#1d4ed8";
      bLink.textContent = t("toolbar.link.cancel");
      document.getElementById("nt-canvas-wrap").style.cursor = "crosshair";
    };
    if (!window._ntEscListenerInstalled) {
      window._ntEscListenerInstalled = true;
      document.addEventListener("keydown", function(e) {
        if (e.key !== "Escape") return;
        if (isLinkModeActive()) {
          exitLinkMode();
          return;
        }
        const cyRef = window._ntCy;
        if (cyRef && (isPathActive() || getPathStart())) {
          clearPathState(cyRef);
          return;
        }
        if (cyRef && isSimActive()) {
          clearSimulation(cyRef);
          return;
        }
        if (cyRef && isRootCauseActive()) clearRootCause(cyRef);
      });
    }
    const bUnlink = mkbtn("nt-btn-unlink", t("toolbar.unlink"), null);
    bUnlink.title = t("toolbar.unlink.tip");
    bUnlink.onclick = function() {
      if (!confirm(t("toolbar.unlink.confirm"))) return;
      saveLinks([]);
      if (window._ntCy) window._ntCy.edges('[id^="ml_"]').remove();
    };
    addHistoryButton(bar, isFirstRun);
    if (bar) buildSevFilter(bar, cy);
    if (!document.getElementById("nt-search-input")) {
      const si = document.createElement("input");
      si.id = "nt-search-input";
      si.type = "text";
      si.placeholder = t("toolbar.search");
      si.style.cssText = "width:140px;height:26px;font-size:12px;margin-left:8px;padding:0 8px;border:1px solid #e2e8f0;border-radius:4px;outline:none;background:#fff;color:#334155";
      si.addEventListener("input", function() {
        const q = this.value.toLowerCase();
        cy.nodes("[!isGroup]").forEach(function(n) {
          n.style("opacity", !q || (n.data("label") || "").toLowerCase().indexOf(q) >= 0 ? 1 : 0.15);
        });
      });
      if (bar) bar.appendChild(si);
    }
  }

  // assets/js/network-topology.js
  var _activeTab = "tech";
  try {
    _activeTab = localStorage.getItem(NT_TAB_KEY) || "tech";
  } catch (e) {
  }
  setResolveAggregateCallback(function() {
    const dd = window._ntLastData || {};
    const wrap = document.getElementById("nt-canvas-wrap");
    if (wrap && dd.nodes) render(wrap, dd.nodes.slice(), (dd.edges || []).slice(), dd.url || "");
  });
  setActiveTabGetter(function() {
    return _activeTab;
  });
  setMgmtRerenderCallback(function() {
    const d = window._ntLastData || {};
    const wrap = document.getElementById("nt-canvas-wrap");
    if (wrap) renderManagement(wrap, d.nodes || [], d.edges || []);
  });
  setSetupToolbarCallback(function(cy, wrap, nodes, groupNames, isDark, useLayout) {
    setupToolbar(cy, wrap, nodes, groupNames, isDark, useLayout);
  });
  setRenderCallback2(render);
  setRenderCallback(render);
  window._ntRefreshOn = window._ntRefreshOn === void 0 ? true : window._ntRefreshOn;
  function applyHistoryOverrides(nodes) {
    if (!nodes) return;
    if (isHistoryActive()) {
      const sevs = getHistorySeverities() || {};
      nodes.forEach(function(n) {
        if (n._liveSeverity === void 0) n._liveSeverity = n.severity || 0;
        if (n._liveProblems === void 0) n._liveProblems = n.problems || 0;
        const newSev = sevs[String(n.id)] || 0;
        n.severity = newSev;
        n.problems = newSev > 0 ? 1 : 0;
        n._historyDimmed = newSev === 0;
      });
    } else {
      nodes.forEach(function(n) {
        if (n._liveSeverity !== void 0) {
          n.severity = n._liveSeverity;
          delete n._liveSeverity;
        }
        if (n._liveProblems !== void 0) {
          n.problems = n._liveProblems;
          delete n._liveProblems;
        }
        delete n._historyDimmed;
      });
    }
  }
  function switchTab(tab, wrap, nodes, edges, dataUrl) {
    if (_activeTab === "geo" && tab !== "geo") {
      cleanupGeo();
    }
    if (_activeTab === "tree" && tab !== "tree") {
      cleanupTable();
    }
    _activeTab = tab;
    try {
      localStorage.setItem(NT_TAB_KEY, tab);
    } catch (e) {
    }
    applyHistoryOverrides(nodes);
    if (tab === "mgmt") renderManagement(wrap, nodes, edges);
    else if (tab === "tree") renderTable(wrap, nodes, edges);
    else if (tab === "geo") renderGeo(wrap, nodes, edges, dataUrl);
    else if (tab === "diag") renderDiag(wrap);
    else if (tab === "health") renderHealth(wrap, nodes);
    else if (tab === "stats") renderStats(wrap, nodes);
    else if (tab === "compliance") renderCompliance(wrap);
    else if (tab === "lldpq") renderLldpQuality(wrap);
    else render(wrap, nodes, edges, dataUrl);
    ensureBaseToolbar(wrap);
    setGraphToolbarVisible(tab === "tech");
  }
  window.switchTab = switchTab;
  setHistoryRenderCallback(function() {
    const d = window._ntLastData;
    if (!d || !d.nodes) return;
    switchTab(
      _activeTab,
      document.getElementById("nt-canvas-wrap"),
      d.nodes,
      d.edges || [],
      d.url || ""
    );
  });
  var _refreshSavedState = null;
  setLiveRefreshHooks(
    function pause() {
      _refreshSavedState = window._ntRefreshOn;
      window._ntRefreshOn = false;
    },
    function resume() {
      if (_refreshSavedState !== null) {
        window._ntRefreshOn = _refreshSavedState;
        _refreshSavedState = null;
      }
    }
  );
  function init() {
    const cfg = window.NT_CONFIG;
    if (!cfg) return;
    const wrap = document.getElementById("nt-canvas-wrap");
    const spin = document.getElementById("nt-loading");
    function fixHeight() {
      const root = document.getElementById("nt-root");
      if (!root) return;
      const top = root.getBoundingClientRect().top;
      const h = window.innerHeight - top - 8;
      if (h > 300) root.style.height = h + "px";
    }
    fixHeight();
    window.addEventListener("resize", function() {
      fixHeight();
      if (window._ntCy) {
        window._ntCy.resize();
        window._ntCy.fit(window._ntCy.nodes(), 40);
      }
    });
    ensureBaseToolbar(wrap);
    if (!cfg.selected_groupids || !cfg.selected_groupids.length) {
      const lastGroups = loadLastGroups();
      if (lastGroups && lastGroups.length) {
        const u = new URL(window.location.href);
        u.searchParams.delete("groupids[]");
        lastGroups.forEach(function(id) {
          u.searchParams.append("groupids[]", id);
        });
        window.location.replace(u.toString());
        return;
      }
      if (spin) spin.innerHTML = '<span style="color:#64748b">' + esc(t("app.pick_groups")) + "</span>";
      return;
    }
    if (spin) spin.innerHTML = '<span style="color:#64748b">' + esc(t("app.loading")) + "</span>";
    const params = new URLSearchParams();
    cfg.selected_groupids.forEach(function(id) {
      params.append("groupids[]", id);
    });
    const url = cfg.data_url + "&" + params;
    fetch(url, { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } }).then(function(r) {
      return r.json();
    }).then(function(data) {
      spin.style.display = "none";
      window._ntLastData = {
        nodes: data.nodes || [],
        edges: data.edges || [],
        lldp_quality: data.lldp_quality || [],
        url
      };
      notifyTopoChanges(data.topo_changes);
      switchTab(_activeTab, wrap, data.nodes || [], data.edges || [], url);
      if (data.nodes && data.nodes.length > 0) {
        saveLastGroups(cfg.selected_groupids);
      }
      if (cfg.wallboard) {
        const hasGeoHosts = (data.nodes || []).some(function(n) {
          return typeof n.lat === "number" && typeof n.lon === "number";
        });
        if (hasGeoHosts) {
          setInterval(function() {
            const next = _activeTab === "tech" ? "geo" : "tech";
            const ld = window._ntLastData || {};
            switchTab(next, wrap, ld.nodes || [], ld.edges || [], ld.url || url);
          }, 3e4);
        }
      }
    }).catch(function(err) {
      spin.innerHTML = '<span style="color:#ef4444">' + esc(t("app.error", { msg: err.message })) + "</span>";
    });
  }
  window._ntInit = init;
  if (!window._ntInitStarted) {
    window._ntInitStarted = true;
    init();
  }
})();
