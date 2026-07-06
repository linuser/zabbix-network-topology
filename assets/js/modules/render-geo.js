// render-geo.js — Geomap-Ansicht (Leaflet).
//
// Vierter Tab neben Technisch/Management/Hierarchisch. Zeigt Hosts mit
// Inventory-Koordinaten (location_lat / location_lon) als Marker auf einer
// echten Karte. LLDP-Edges werden als Polylines gezeichnet, sofern beide
// Endpunkte Koordinaten haben.
//
// Marker-Stil:
//   - Severity-Farbe als Füllung (gleiches Schema wie Tech-Tab)
//   - Größe proportional zur Anzahl Probleme
//   - Click → Popup mit Hostname/IP/CPU/Memory/Status
//   - Acked-Hosts bekommen grünen Outer-Ring
//   - Maintenance-Hosts werden halb-transparent
//
// Tile-Provider werden aus geo-providers.js geladen, die Auswahl steht im
// user-scoped localStorage und ist über ein Dropdown in der Toolbar wechselbar.
//
// Leaflet ist als globales L verfügbar (vor diesem Modul per <script> geladen).

import { fmt } from './utils.js';
import { SEV_COL, SEV_LBL } from './severity.js';
import { loadGeoProvider, saveGeoProvider } from './storage.js';
import { GEO_PROVIDERS, getProvider } from './geo-providers.js';

let _map         = null;   // Leaflet-Map-Instance
let _markerLayer = null;   // LayerGroup für Host-Marker
let _edgeLayer   = null;   // LayerGroup für LLDP-Polylines
let _tileLayer   = null;   // aktueller Tile-Layer (für Provider-Wechsel)

// Erzeugt einen kreisförmigen DivIcon-Marker mit Severity-Farbe.
// Größe wächst sanft mit Anzahl der Probleme (12px → 24px).
function buildMarkerIcon(node) {
    const sev = node.severity || 0;
    const isOff = !!node.unavailable;
    // Offline ueberschreibt die Severity-Farbe — der Marker wird grau und
    // bekommt ein rotes "X" damit man auf der Karte sofort tote Hosts sieht.
    const col = isOff
        ? '#9ca3af'
        : (SEV_COL[Math.min(sev, SEV_COL.length - 1)] || SEV_COL[0]);
    const probs = node.problems || 0;
    const r = Math.min(12 + probs, 24);
    const opacity = isOff ? 0.6 : (node.maintenance ? 0.55 : 1);
    const ackRing = node.acknowledged
        ? '<circle cx="' + (r + 2) + '" cy="' + (r + 2) + '" r="' + (r - 1)
            + '" fill="none" stroke="#22c55e" stroke-width="2.5" opacity="0.9"/>'
        : '';
    // Bei Offline: rotes X im Marker statt Problem-Counter
    const offX = isOff
        ? '<g transform="translate(' + (r + 2) + ',' + (r + 2) + ')"'
            + ' stroke="#e53742" stroke-width="3" stroke-linecap="round">'
            + '<line x1="-' + (r * 0.5) + '" y1="-' + (r * 0.5) + '" x2="' + (r * 0.5) + '" y2="' + (r * 0.5) + '"/>'
            + '<line x1="' + (r * 0.5) + '" y1="-' + (r * 0.5) + '" x2="-' + (r * 0.5) + '" y2="' + (r * 0.5) + '"/>'
            + '</g>'
        : '';
    const html =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + ((r + 2) * 2) + '" height="' + ((r + 2) * 2) + '"'
        + ' style="opacity:' + opacity + '">'
        + '<circle cx="' + (r + 2) + '" cy="' + (r + 2) + '" r="' + r
        + '" fill="' + col + '" stroke="white" stroke-width="2"/>'
        + ackRing
        + offX
        + (probs > 0 && !isOff
            ? '<text x="' + (r + 2) + '" y="' + (r + 2) + '" text-anchor="middle" dominant-baseline="central"'
              + ' font-family="sans-serif" font-size="' + (probs > 9 ? 9 : 11) + '" font-weight="700"'
              + ' fill="white">' + (probs > 99 ? '99+' : probs) + '</text>'
            : '')
        + '</svg>';
    return L.divIcon({
        html: html,
        className: 'nt-geo-marker',
        iconSize: [(r + 2) * 2, (r + 2) * 2],
        iconAnchor: [r + 2, r + 2]
    });
}

// Popup-HTML für einen Host
function buildPopup(node) {
    const sev = node.severity || 0;
    const col = SEV_COL[Math.min(sev, SEV_COL.length - 1)] || SEV_COL[0];
    const lbl = SEV_LBL[sev] || 'Normal';
    const tr = node.traffic || { in: 0, out: 0 };

    function mk(tag, css, text) {
        const e = document.createElement(tag);
        if (css) e.style.cssText = css;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    const root = mk('div', 'font-family:sans-serif;min-width:200px');
    root.appendChild(mk('div', 'font-weight:700;color:#0f172a;margin-bottom:4px',
        node.label || ''));
    if (node.ip) {
        root.appendChild(mk('div', 'font-size:10px;color:#64748b;font-family:monospace',
            node.ip));
    }
    if (node.location) {
        root.appendChild(mk('div', 'font-size:10px;color:#64748b;margin-top:2px',
            '\u{1F4CD} ' + node.location));
    }
    if (node.maintenance || node.acknowledged) {
        const row = mk('div', 'margin-top:4px');
        if (node.maintenance) {
            row.appendChild(mk('span',
                'background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;margin-right:4px',
                '\u{1F527} Wartung'));
        }
        if (node.acknowledged) {
            row.appendChild(mk('span',
                'background:#dcfce7;color:#166534;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;margin-right:4px',
                '\u2714 Acked'));
        }
        root.appendChild(row);
    }

    const stats = mk('div',
        'margin-top:6px;padding-top:6px;border-top:1px solid #f1f5f9;font-size:11px;color:#334155');
    const sevLine = mk('div');
    sevLine.appendChild(mk('span', 'color:' + col + ';font-weight:600', '\u25CF ' + lbl));
    if (node.problems > 0) {
        sevLine.appendChild(document.createTextNode('   '));
        sevLine.appendChild(mk('b', 'color:#ef4444', String(node.problems)));
        sevLine.appendChild(document.createTextNode(' Probleme'));
    }
    stats.appendChild(sevLine);
    function metric(label, val) {
        const r = mk('div'); r.textContent = label + ': ';
        r.appendChild(mk('b', '', String(val))); stats.appendChild(r);
    }
    if (node.cpu    != null) metric('CPU', node.cpu + '%');
    if (node.memory != null) metric('RAM', node.memory + '%');
    if (node.ping > 0)       metric('Ping', node.ping + ' ms');
    if (tr.in || tr.out) {
        const r = mk('div'); r.textContent = 'Traffic: ';
        r.appendChild(mk('span', 'color:#22c55e', '\u2193 ' + fmt(tr.in)));
        r.appendChild(document.createTextNode(' '));
        r.appendChild(mk('span', 'color:#06b6d4', '\u2191 ' + fmt(tr.out)));
        stats.appendChild(r);
    }
    root.appendChild(stats);
    return root;
}

// Kurzlebiger Toast unten am Bildschirmrand für Provider-Warnungen.
// Verschwindet nach 6 Sekunden oder bei Klick.
function showToast(message) {
    const existing = document.getElementById('nt-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'nt-toast';
    toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);'
        + 'z-index:10001;background:#fef3c7;color:#92400e;padding:12px 18px;border-radius:8px;'
        + 'font-size:13px;line-height:1.5;max-width:520px;'
        + 'box-shadow:0 4px 16px rgba(0,0,0,0.2);border:1px solid #f59e0b;'
        + 'cursor:pointer;font-family:sans-serif';
    toast.textContent = '\u26A0 ' + message;
    toast.title = 'Klicken zum Schliessen';
    toast.addEventListener('click', function() { toast.remove(); });
    document.body.appendChild(toast);
    setTimeout(function() {
        if (toast && toast.parentNode) toast.remove();
    }, 6000);
}

// Aktuell aktiven Tile-Layer austauschen (Provider-Wechsel).
// Wenn der gewählte Provider eine `warning`-Property hat (z.B. Stamen mit
// API-Key-Pflicht), zeigen wir einen Toast — sonst sieht der User nur
// kaputte Tiles ohne Erklärung.
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

// Helper: Marker und Edges aus den Layern aufbauen. Wird sowohl beim
// initialen Render als auch beim Auto-Refresh aufgerufen — Karte und
// Zoom bleiben dabei unverändert.
function rebuildMarkersAndEdges(geoNodes, edges) {
    if (!_markerLayer || !_edgeLayer) return;
    _markerLayer.clearLayers();
    _edgeLayer.clearLayers();

    const nodePos = {};
    geoNodes.forEach(function(n) { nodePos[String(n.id)] = [n.lat, n.lon]; });

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
        const src = String(e.source || e.from || '');
        const tgt = String(e.target || e.to || '');
        const a = nodePos[src], b = nodePos[tgt];
        if (!a || !b) return;
        L.polyline([a, b], {
            color: '#22c55e', weight: 2, opacity: 0.6, dashArray: '6,5'
        }).addTo(_edgeLayer);
    });
}

// Cleanup beim Tab-Wechsel weg von Geo. Räumt Leaflet-Map und alle
// gehefteten Event-Listener auf, damit kein Memory-Leak entsteht.
// Wird aus tabs.js / switchTab beim Wechsel aufgerufen.
export function cleanupGeo() {
    if (window._ntGeoRefreshTimer) {
        clearInterval(window._ntGeoRefreshTimer);
        window._ntGeoRefreshTimer = null;
    }
    if (_map) {
        try { _map.remove(); } catch (e) {}
        _map = null;
    }
    _markerLayer = null;
    _edgeLayer   = null;
    _tileLayer   = null;
}

export function renderGeo(wrap, nodes, edges, dataUrl) {
    // Aufräumen vorheriger Tab-State (inklusive eigene Karte falls vorhanden)
    if (window._ntCy)         { try { window._ntCy.destroy(); } catch (e) {} window._ntCy = null; }
    if (window._ntEdgeAnim)   { clearInterval(window._ntEdgeAnim);     window._ntEdgeAnim     = null; }
    if (window._ntRefreshTimer) { clearInterval(window._ntRefreshTimer); window._ntRefreshTimer = null; }
    if (window._ntMinimapTimer) { clearInterval(window._ntMinimapTimer); window._ntMinimapTimer = null; }
    cleanupGeo();   // räumt _map, _markerLayer, _edgeLayer und Geo-Refresh-Timer auf
    window._ntToolbarDone = false;

    // Canvas leeren (Loading-Spinner behalten)
    Array.from(wrap.children).forEach(function(ch) {
        if (ch.id !== 'nt-loading') wrap.removeChild(ch);
    });

    // Hosts mit gültigen Koordinaten filtern (beide gesetzt + numerisch)
    const geoNodes = nodes.filter(function(n) {
        return typeof n.lat === 'number' && typeof n.lon === 'number'
            && !isNaN(n.lat) && !isNaN(n.lon)
            && n.lat >= -90 && n.lat <= 90
            && n.lon >= -180 && n.lon <= 180;
    });
    const totalHosts = nodes.length;
    const geoHosts   = geoNodes.length;

    // Kein einziger Host mit Koordinaten → freundlicher Hinweis statt leerer Karte
    if (geoHosts === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'display:flex;flex-direction:column;align-items:center;'
            + 'justify-content:center;height:100%;color:#64748b;text-align:center;padding:40px';
        empty.innerHTML = '<div style="font-size:48px;margin-bottom:16px">\u{1F5FA}\uFE0F</div>'
            + '<div style="font-size:16px;font-weight:600;color:#334155;margin-bottom:8px">'
            + 'Keine Hosts mit Geo-Koordinaten</div>'
            + '<div style="font-size:13px;max-width:480px;line-height:1.5">'
            + 'Setze in <b>Configuration \u2192 Hosts \u2192 Inventory</b> die Felder '
            + '<code>Location latitude</code> und <code>Location longitude</code> '
            + '(als Dezimalwerte, z.\u202FB. <code>49.4521, 7.0064</code>).'
            + '<br><br>Geomap zeigt nur Hosts mit beiden Werten.'
            + '</div>';
        wrap.appendChild(empty);
        return;
    }

    // Container für Karte + ggf. Hinweis-Banner
    const container = document.createElement('div');
    container.style.cssText = 'position:relative;width:100%;height:100%';
    wrap.appendChild(container);

    // Banner wenn nicht alle Hosts Koordinaten haben
    if (geoHosts < totalHosts) {
        const missing = totalHosts - geoHosts;
        const banner = document.createElement('div');
        banner.style.cssText = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);'
            + 'z-index:1000;background:#fef3c7;color:#92400e;padding:6px 14px;border-radius:6px;'
            + 'font-size:12px;font-weight:500;box-shadow:0 2px 6px rgba(0,0,0,0.15);'
            + 'border:1px solid #f59e0b';
        banner.textContent = '\u26A0 ' + missing + ' von ' + totalHosts + ' Hosts haben keine Geo-Koordinaten';
        container.appendChild(banner);
    }

    // Provider-Switcher (Dropdown rechts oben über der Karte)
    const switcher = document.createElement('div');
    switcher.style.cssText = 'position:absolute;top:8px;right:8px;z-index:1000;'
        + 'background:white;border:1px solid #e2e8f0;border-radius:6px;'
        + 'box-shadow:0 2px 6px rgba(0,0,0,0.12);padding:4px 6px';
    const sel = document.createElement('select');
    sel.style.cssText = 'border:none;outline:none;background:transparent;font-size:12px;cursor:pointer';
    GEO_PROVIDERS.forEach(function(p) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.label;
        sel.appendChild(opt);
    });
    const currentProvider = loadGeoProvider();
    sel.value = currentProvider;
    sel.addEventListener('change', function() { switchProvider(sel.value); });
    switcher.appendChild(sel);
    container.appendChild(switcher);

    // Map-DIV
    const mapDiv = document.createElement('div');
    mapDiv.style.cssText = 'width:100%;height:100%';
    container.appendChild(mapDiv);

    // Leaflet-Map initialisieren
    _map = L.map(mapDiv, { zoomControl: true, attributionControl: true });

    // Tile-Provider laden
    const p = getProvider(currentProvider);
    const opts = { maxZoom: p.maxZoom || 19, attribution: p.attribution };
    if (p.subdomains) opts.subdomains = p.subdomains;
    _tileLayer = L.tileLayer(p.url, opts).addTo(_map);

    // Marker-Layer
    _markerLayer = L.layerGroup().addTo(_map);
    _edgeLayer   = L.layerGroup().addTo(_map);

    // Initial-Build der Marker und Edges
    rebuildMarkersAndEdges(geoNodes, edges);

    // View an Marker-Bounds anpassen (alle Marker im Bild + Padding)
    if (geoNodes.length === 1) {
        _map.setView([geoNodes[0].lat, geoNodes[0].lon], 13);
    } else {
        const bounds = L.latLngBounds(geoNodes.map(function(n) { return [n.lat, n.lon]; }));
        _map.fitBounds(bounds, { padding: [40, 40] });
    }

    // Tile-Cache lädt async — invalidateSize nach kurzer Pause damit alle
    // Tiles korrekt rendern (sonst manchmal grauer Bereich nach Tab-Wechsel).
    setTimeout(function() { if (_map) _map.invalidateSize(); }, 100);
    setTimeout(function() { if (_map) _map.invalidateSize(); }, 500);

    // Auto-Refresh alle 30s wenn dataUrl gesetzt ist und Auto-Refresh aktiv.
    // Nur Marker und Edges werden neu gebaut — Karte/Zoom bleiben intakt,
    // damit der User nicht ständig sein Pan/Zoom verliert.
    if (dataUrl && window._ntRefreshOn !== false) {
        window._ntGeoRefreshTimer = setInterval(function() {
            if (window._ntRefreshOn === false || !_map) return;
            fetch(dataUrl, {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!data || !data.nodes) return;
                    window._ntLastData = window._ntLastData || {};
                    window._ntLastData.nodes = data.nodes;
                    window._ntLastData.edges = data.edges || [];
                    // Hosts mit gültigen Koordinaten neu filtern
                    const fresh = data.nodes.filter(function(n) {
                        return typeof n.lat === 'number' && typeof n.lon === 'number'
                            && !isNaN(n.lat) && !isNaN(n.lon);
                    });
                    rebuildMarkersAndEdges(fresh, data.edges || []);
                })
                .catch(function() { /* Network-Hiccup ignorieren */ });
        }, 30000);
    }
}
