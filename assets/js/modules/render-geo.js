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

import { esc, clearWrap } from './utils.js';
import { loadGeoProvider, saveGeoProvider } from './storage.js';
import { GEO_PROVIDERS, getProvider } from './geo-providers.js';
import { t } from './i18n.js';
import { fetchJson } from './http.js';
import { buildMarkerIcon, buildPopup, drawEdges, ensureLeaflet } from './geo-markers.js';

let _map         = null;   // Leaflet-Map-Instance
let _markerLayer = null;   // LayerGroup für Host-Marker
let _edgeLayer   = null;   // LayerGroup für LLDP-Polylines
let _tileLayer   = null;   // aktueller Tile-Layer (für Provider-Wechsel)

// buildMarkerIcon / buildPopup / drawEdges / ensureLeaflet liegen seit 5.5.69 in
// geo-markers.js, damit der Plan-Modus denselben Code nutzt (eine Quelle).
// Kurzlebiger Toast unten am Bildschirmrand für Provider-Warnungen.
// Verschwindet nach 6 Sekunden oder bei Klick.
function showToast(message) {
    const existing = document.getElementById('nt-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'nt-toast';
    toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);'
        + 'z-index:10001;background:var(--nt-warn-bg,#fef3c7);color:var(--nt-warn-text,#92400e);padding:12px 18px;border-radius:8px;'
        + 'font-size:13px;line-height:1.5;max-width:520px;'
        + 'box-shadow:0 4px 16px rgba(0,0,0,0.2);border:1px solid #f59e0b;'
        + 'cursor:pointer;font-family:sans-serif';
    toast.textContent = '\u26A0 ' + message;
    toast.title = t('geo.toast.dismiss');
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
    // Karten-Zoom auf das Maximum des neuen Providers kappen. Sonst bleibt die
    // Karte nach einem Wechsel von einem hoch-zoombaren Provider (Esri/OSM z19)
    // auf einen flacheren (USGS z16) auf dem alten Level stehen und zeigt leere
    // Tiles ohne Erklaerung. setMaxZoom() zieht den aktuellen Zoom bei Bedarf mit
    // herunter — und hebt die Decke beim Wechsel nach oben wieder an.
    _map.setMaxZoom(opts.maxZoom);
    if (p.warningKey) showToast(t(p.warningKey));
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

    drawEdges(_edgeLayer, edges, nodePos);
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
    clearWrap(wrap);

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
            + 'justify-content:center;height:100%;color:var(--nt-sub,#64748b);text-align:center;padding:40px';
        empty.innerHTML = '<div style="font-size:48px;margin-bottom:16px">\u{1F5FA}\uFE0F</div>'
            + '<div style="font-size:16px;font-weight:600;color:var(--nt-text-2,#334155);margin-bottom:8px">'
            + esc(t('geo.empty.title')) + '</div>'
            + '<div style="font-size:13px;max-width:480px;line-height:1.5">'
            // Markup bleibt im Code, nur die Textteile kommen aus der
            // Uebersetzung — sonst muesste die i18n-Datei HTML tragen, und der
            // Satzbau unterscheidet sich zwischen den Sprachen ohnehin.
            + esc(t('geo.empty.hint', {
                path:    'Configuration \u2192 Hosts \u2192 Inventory',
                lat:     'Location latitude',
                lon:     'Location longitude',
                example: '49.4521, 7.0064'
            }))
            + '<br><br>' + esc(t('geo.empty.note'))
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
            + 'z-index:1000;background:var(--nt-warn-bg,#fef3c7);color:var(--nt-warn-text,#92400e);padding:6px 14px;border-radius:6px;'
            + 'font-size:12px;font-weight:500;box-shadow:0 2px 6px rgba(0,0,0,0.15);'
            + 'border:1px solid #f59e0b';
        banner.textContent = '\u26A0 ' + t('geo.missing_coords', { missing: missing, total: totalHosts });
        container.appendChild(banner);
    }

    // Provider-Switcher (Dropdown rechts oben über der Karte)
    const switcher = document.createElement('div');
    switcher.style.cssText = 'position:absolute;top:8px;right:8px;z-index:1000;'
        + 'background:var(--nt-surface,white);border:1px solid var(--nt-line,#e2e8f0);border-radius:6px;'
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

    // Leaflet lazy laden, dann die Karte bauen. Der gesamte L-abhaengige
    // Block bis zum Funktionsende laeuft deferred im .then().
    ensureLeaflet().then(function() {
    if (!mapDiv.isConnected) return;   // Tab inzwischen gewechselt
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
            fetchJson(dataUrl, {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            })
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
    }).catch(function(err) {
        // Leaflet-Load fehlgeschlagen — sichtbare Meldung statt leerer Karte.
        if (mapDiv) mapDiv.textContent =
            t('geo.leaflet_error', { err: String((err && err.message) || err) });
    });
}
