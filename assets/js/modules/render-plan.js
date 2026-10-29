// render-plan.js — Plan-Modus: Hintergrundbild (Luftbild/Grundriss) + Marker,
// die man per Drag an ihre echte physische Stelle setzt.
//
// Unterschied zum Geo-Modus (render-geo.js): dort echte lat/lon auf Kartentiles
// (CRS.EPSG3857), read-only aus Zabbix-Inventory. HIER Bild-Pixel auf einem
// statischen Bild (CRS.Simple), die das Modul SELBST besitzt und speichert. Die
// Marker-/Popup-/Kantenbausteine sind dieselben (geo-markers.js, eine Quelle).
//
// Das Bild liegt in Zabbix' eigenem Bild-Store (siehe PlanBackground.php); das
// Modul merkt sich je Ansicht nur eine Referenz und holt die Bytes beim Oeffnen
// lazy. Positionen laufen ueber die bestehende Zwei-Ebenen-Pixelspeicherung
// (storage.js, eigener "_plan"-viewKey) — shared fuer Super-Admins, sonst die
// eigene Abweichung, wie beim Ziehen in der Technik-Ansicht.

import { clearWrap, esc } from './utils.js';
import { t } from './i18n.js';
import { buildMarkerIcon, buildPopup, drawEdges, ensureLeaflet } from './geo-markers.js';
import {
    loadPlanPositions, savePlanPositions,
    planGetRef, planListImages,
    planSetRef, planClearRef, planUploadImage, planCanUpload
} from './storage.js';

let _map        = null;
let _markerLayer = null;
let _edgeLayer   = null;
let _imgLayer    = null;
let _posMap      = {};   // id -> {x,y} in Bild-Pixeln, Ursprung OBEN LINKS
let _markers     = {};   // id -> L.marker
let _saveTimer   = null;
let _imgW = 0, _imgH = 0;
let _nodes = [], _edges = [];
let _linksOn = false;    // Verbindungslinien (LLDP/CDP) — Default aus auf dem Plan

const MAX_IMG_W     = 1600;      // Upload auf diese Breite herunterrechnen
const MAX_DATA_URI  = 1200000;   // ~880 KB binaer < Zabbix' 1-MB-Grenze
// Marker kleiner als im Geo-Modus — auf einem Grundriss sind die mit der
// Problemzahl wachsenden Geo-Marker (bis ~50px) zu gross fuer die Raeume.
const PLAN_MARKER_SCALE = 0.6;
// Toggle-Zustand pro Browser gemerkt. Default aus: ein Grundriss zeigt meist nur
// Geraete + Status; wer die Uplinks sehen will, schaltet die Kanten an.
const PLAN_LINKS_KEY = 'nt_plan_links';
function _loadLinksOn() {
    try { return localStorage.getItem(PLAN_LINKS_KEY) === '1'; } catch (e) { return false; }
}
function _saveLinksOn(on) {
    try { localStorage.setItem(PLAN_LINKS_KEY, on ? '1' : '0'); } catch (e) {}
}

function _cfg() { return window.NT_CONFIG || {}; }

export function cleanupPlan() {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    if (_map) { try { _map.remove(); } catch (e) {} _map = null; }
    _markerLayer = _edgeLayer = _imgLayer = null;
    _markers = {}; _posMap = {}; _nodes = []; _edges = [];
    _imgW = _imgH = 0;
}

// Bild-Pixel (Ursprung oben links) ↔ CRS.Simple-LatLng. In CRS.Simple waechst
// lat nach OBEN, das Bild liegt in Bounds [[0,0],[h,w]] — ein Pixel (px,py) von
// oben links liegt also bei lat = h-py, lng = px. Als reine Funktionen
// exportiert (kein L noetig), damit die Geometrie testbar ist.
export function planLatLngFromPixel(pos, imgH) {
    return { lat: imgH - pos.y, lng: pos.x };
}
export function planPixelFromLatLng(ll, imgH) {
    return { x: Math.round(ll.lng), y: Math.round(imgH - ll.lat) };
}
function toLatLng(pos) {
    const p = planLatLngFromPixel(pos, _imgH);
    return L.latLng(p.lat, p.lng);
}
function fromLatLng(ll) { return planPixelFromLatLng(ll, _imgH); }

// Positionskarte entprellt speichern (wie render-tech.js bei 'dragfree').
function schedulePlanSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function() { savePlanPositions(_posMap); }, 400);
}

// Kanten zwischen PLATZIERTEN Markern neu zeichnen (unplatzierte haben keine
// Position und werden von drawEdges uebersprungen).
function rebuildPlanEdges() {
    if (!_edgeLayer) return;
    _edgeLayer.clearLayers();
    if (!_linksOn) return;   // Verbindungslinien per Toggle abgeschaltet
    const nodePos = {};
    for (const id in _posMap) {
        if (Object.prototype.hasOwnProperty.call(_posMap, id)) {
            nodePos[id] = toLatLng(_posMap[id]);
        }
    }
    drawEdges(_edgeLayer, _edges, nodePos);
}

// Eine Position auf die Bildflaeche begrenzen (0..Breite / 0..Hoehe). Haelt
// Marker im Bild — beim Platzieren, beim Ziehen ueber den Rand UND beim Laden
// von Altpositionen eines frueheren/anders grossen Bildes. Ohne das landeten
// Marker (und die an ihnen haengenden Kabel-Enden) im grauen Rand.
function clampPos(pos) {
    return {
        x: Math.max(0, Math.min(_imgW, Math.round(pos.x))),
        y: Math.max(0, Math.min(_imgH, Math.round(pos.y)))
    };
}

// Einen Knoten an einer Bild-Position platzieren (Marker anlegen, ziehbar).
function placeNode(node, pos) {
    const cpos = clampPos(pos);
    _posMap[String(node.id)] = cpos;
    const marker = L.marker(toLatLng(cpos), {
        icon: buildMarkerIcon(node, PLAN_MARKER_SCALE),
        riseOnHover: true,
        draggable: true,
        title: node.label
    });
    marker.bindPopup(buildPopup(node), { maxWidth: 280 });
    marker.on('dragend', function() {
        const np = clampPos(fromLatLng(marker.getLatLng()));
        _posMap[String(node.id)] = np;
        marker.setLatLng(toLatLng(np));   // zurueckschnappen, falls ueber den Rand gezogen
        rebuildPlanEdges();
        schedulePlanSave();
    });
    marker.addTo(_markerLayer);
    _markers[String(node.id)] = marker;
}

// Seitenleiste der noch nicht platzierten Knoten. Klick setzt den Knoten in die
// Bildmitte und persistiert; von dort zieht man ihn fein.
function buildUnplacedRail(container) {
    const rail = document.createElement('div');
    rail.className = 'nt-plan-rail';
    rail.style.cssText = 'position:absolute;top:8px;left:8px;z-index:1000;max-height:70%;'
        + 'overflow:auto;background:var(--nt-surface,white);border:1px solid var(--nt-line,#e2e8f0);'
        + 'border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,0.12);padding:6px 8px;'
        + 'font-size:12px;min-width:160px;max-width:220px';

    function refresh() {
        clearWrap(rail);
        const unplaced = _nodes.filter(function(n) {
            return !Object.prototype.hasOwnProperty.call(_posMap, String(n.id));
        });
        const head = document.createElement('div');
        head.style.cssText = 'font-weight:600;color:var(--nt-text-2,#334155);margin-bottom:4px';
        head.textContent = t('plan.unplaced', { n: unplaced.length });
        rail.appendChild(head);
        if (!unplaced.length) {
            const done = document.createElement('div');
            done.style.cssText = 'color:var(--nt-sub,#64748b)';
            done.textContent = t('plan.all_placed');
            rail.appendChild(done);
            return;
        }
        unplaced.forEach(function(n) {
            const row = document.createElement('button');
            row.type = 'button';
            row.style.cssText = 'display:block;width:100%;text-align:left;border:none;background:none;'
                + 'cursor:pointer;padding:3px 4px;border-radius:4px;color:var(--nt-text,#0f172a);'
                + 'font-size:12px';
            row.textContent = n.label || String(n.id);
            row.title = t('plan.place_hint');
            row.addEventListener('click', function() {
                placeNode(n, { x: Math.round(_imgW / 2), y: Math.round(_imgH / 2) });
                rebuildPlanEdges();
                schedulePlanSave();
                refresh();
            });
            rail.appendChild(row);
        });
    }

    rail._refresh = refresh;
    refresh();
    container.appendChild(rail);
    return rail;
}

// Die Leaflet-Karte mit Bild-Overlay bauen und die gespeicherten Marker setzen.
function buildMap(container, imgSrc) {
    const mapDiv = document.createElement('div');
    mapDiv.style.cssText = 'width:100%;height:100%';
    container.appendChild(mapDiv);

    // Natuerliche Bildgroesse ermitteln → Bounds in CRS.Simple.
    const probe = document.createElement('img');
    probe.onload = function() {
        if (!mapDiv.isConnected) return;
        _imgW = probe.naturalWidth || 1000;
        _imgH = probe.naturalHeight || 1000;
        const bounds = [[0, 0], [_imgH, _imgW]];

        // zoomSnap:0 laesst fitBounds eine FRAKTIONALE Zoomstufe waehlen, die das
        // Bild eng in die Flaeche legt. Ohne das zwingen die groben CRS.Simple-
        // Ganzzahlstufen (Zweierpotenzen) die Karte auf die naechstkleinere Stufe
        // — das Bild wirkt dann zu klein mit viel Rand.
        _map = L.map(mapDiv, { crs: L.CRS.Simple, minZoom: -5, maxZoom: 5,
            zoomSnap: 0, zoomDelta: 0.5, zoomControl: true, attributionControl: false });
        // Kein Referrer an einen externen Bild-Host: er soll nicht erfahren,
        // von welcher Zabbix-Adresse das Bild geladen wird (Security-Review
        // F11). referrerPolicy MUSS vor dem src stehen — nach L.imageOverlay()
        // laeuft die Anfrage schon. Leaflet nimmt ein fertiges IMG-Element als
        // Quelle (_initImage: "IMG"===_url.tagName → es setzt die src NICHT neu,
        // liest sie nur). Harmlos fuer den Zabbix-eigenen Bild-Store (same-origin).
        const _ovImg = document.createElement('img');
        _ovImg.referrerPolicy = 'no-referrer';
        _ovImg.src = imgSrc;
        _imgLayer    = L.imageOverlay(_ovImg, bounds).addTo(_map);
        _edgeLayer   = L.layerGroup().addTo(_map);
        _markerLayer = L.layerGroup().addTo(_map);
        _map.fitBounds(bounds);

        // Gespeicherte Positionen setzen (nur Knoten, die es noch gibt).
        const saved = loadPlanPositions();
        const byId  = {};
        _nodes.forEach(function(n) { byId[String(n.id)] = n; });
        let healed = false;
        for (const id in saved) {
            if (Object.prototype.hasOwnProperty.call(saved, id) && byId[id]) {
                placeNode(byId[id], { x: saved[id].x, y: saved[id].y });
                // placeNode hat ggf. geclampt — hat sich die Position geaendert,
                // war sie ausserhalb des (aktuellen) Bildes und wird einmal
                // sauber zurueckgeschrieben.
                const after = _posMap[id];
                if (after && (after.x !== saved[id].x || after.y !== saved[id].y)) {
                    healed = true;
                }
            }
        }
        if (healed) schedulePlanSave();
        rebuildPlanEdges();
        buildUnplacedRail(container);

        setTimeout(function() { if (_map) _map.invalidateSize(); }, 100);
        setTimeout(function() { if (_map) _map.invalidateSize(); }, 500);
    };
    probe.onerror = function() {
        if (mapDiv.isConnected) mapDiv.textContent = t('plan.image_failed');
    };
    probe.referrerPolicy = 'no-referrer';   // kein Referrer an externe Bild-Hosts (F11)
    probe.src = imgSrc;
}

// Downscale eines Upload-Files auf eine gedeckelte Data-URI (JPEG, Qualitaet
// absenken bis unter die Groesse). Haelt den Upload unter Zabbix' 1-MB-Grenze.
function downscaleImage(file) {
    return new Promise(function(resolve, reject) {
        // Object-URL in BEIDEN Pfaden freigeben — sonst leckt jeder nicht
        // dekodierbare Upload die Blob-Referenz fuer die Seitenlebensdauer.
        const url = URL.createObjectURL(file);
        const img = document.createElement('img');
        img.onload = function() {
            let w = img.naturalWidth || 1, h = img.naturalHeight || 1;
            const scale = Math.min(1, MAX_IMG_W / w);
            w = Math.max(1, Math.round(w * scale));
            h = Math.max(1, Math.round(h * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            let q = 0.92;
            let data = canvas.toDataURL('image/jpeg', q);
            while (data.length > MAX_DATA_URI && q > 0.4) {
                q -= 0.1;
                data = canvas.toDataURL('image/jpeg', q);
            }
            URL.revokeObjectURL(url);
            resolve(data);
        };
        img.onerror = function() {
            URL.revokeObjectURL(url);
            reject(new Error(t('plan.image_failed')));
        };
        img.src = url;
    });
}

// Steuerleiste oben rechts: Bild auswaehlen / per URL / hochladen / entfernen.
// Nach jeder Aenderung wird der Plan neu geladen (reload).
function buildControls(container, reload) {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;top:8px;right:8px;z-index:1000;display:flex;gap:6px;'
        + 'align-items:center;background:var(--nt-surface,white);border:1px solid var(--nt-line,#e2e8f0);'
        + 'border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,0.12);padding:4px 6px;font-size:12px';

    // Verbindungslinien-Toggle (LLDP/CDP). Reine Ansichts-Praeferenz, fuer alle
    // sichtbar — nicht an Rechte gebunden. Zustand merkt sich der Browser.
    const linkBtn = mkBtn('', function() {
        _linksOn = !_linksOn;
        _saveLinksOn(_linksOn);
        paintLinkBtn();
        rebuildPlanEdges();
    });
    function paintLinkBtn() {
        linkBtn.textContent = t('plan.links') + ': ' + (_linksOn ? t('plan.on') : t('plan.off'));
        linkBtn.style.background = _linksOn ? 'var(--nt-accent,#0275b8)' : 'var(--nt-surface,white)';
        linkBtn.style.color = _linksOn ? '#fff' : 'var(--nt-text,#0f172a)';
    }
    paintLinkBtn();
    bar.appendChild(linkBtn);

    // Auswahl aus den vorhandenen Background-Bildern.
    const sel = document.createElement('select');
    sel.style.cssText = 'border:1px solid var(--nt-line,#e2e8f0);border-radius:4px;font-size:12px;max-width:160px';
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = t('plan.pick_image');
    sel.appendChild(ph);
    planListImages().then(function(imgs) {
        imgs.forEach(function(i) {
            const o = document.createElement('option');
            o.value = i.imageid; o.textContent = i.name;
            sel.appendChild(o);
        });
    }).catch(function() {});
    sel.addEventListener('change', function() {
        if (!sel.value) return;
        planSetRef({ kind: 'image', imageid: sel.value }).then(reload).catch(showErr);
    });
    bar.appendChild(sel);

    // URL-Alternative.
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.placeholder = t('plan.url_placeholder');
    urlInput.style.cssText = 'border:1px solid var(--nt-line,#e2e8f0);border-radius:4px;font-size:12px;width:140px';
    const urlBtn = mkBtn(t('plan.set'), function() {
        const u = urlInput.value.trim();
        if (!u) return;
        planSetRef({ kind: 'url', url: u }).then(reload).catch(showErr);
    });
    bar.appendChild(urlInput);
    bar.appendChild(urlBtn);

    // Upload (nur Super-Admins — Zabbix-Grenze).
    if (planCanUpload()) {
        const file = document.createElement('input');
        file.type = 'file';
        file.accept = 'image/png,image/jpeg,image/gif,image/webp';
        file.style.cssText = 'display:none';
        const upBtn = mkBtn(t('plan.upload'), function() { file.click(); });
        file.addEventListener('change', function() {
            const f = file.files && file.files[0];
            if (!f) return;
            upBtn.disabled = true;
            downscaleImage(f).then(function(dataUri) {
                return planUploadImage(f.name.replace(/\.[^.]+$/, '') || 'plan', dataUri);
            }).then(function(imageid) {
                return planSetRef({ kind: 'image', imageid: imageid });
            }).then(reload).catch(showErr).then(function() { upBtn.disabled = false; });
        });
        bar.appendChild(upBtn);
        bar.appendChild(file);
    }

    // Entfernen.
    bar.appendChild(mkBtn(t('plan.clear'), function() {
        planClearRef().then(reload).catch(showErr);
    }));

    container.appendChild(bar);

    function showErr(e) {
        const msg = (e && e.message) ? e.message : t('plan.save_failed');
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:10001;'
            + 'background:var(--nt-warn-bg,#fef3c7);color:var(--nt-warn-text,#92400e);padding:10px 16px;'
            + 'border-radius:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,0.2);border:1px solid #f59e0b';
        toast.textContent = '⚠ ' + msg;
        document.body.appendChild(toast);
        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 6000);
    }
}

function mkBtn(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'border:1px solid var(--nt-line,#e2e8f0);background:var(--nt-surface,white);'
        + 'color:var(--nt-text,#0f172a);border-radius:4px;padding:2px 8px;cursor:pointer;font-size:12px';
    b.addEventListener('click', onClick);
    return b;
}

function buildEmptyState(container) {
    const empty = document.createElement('div');
    empty.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;'
        + 'height:100%;color:var(--nt-sub,#64748b);text-align:center;padding:40px';
    empty.innerHTML = '<div style="font-size:48px;margin-bottom:16px">\u{1F5BC}️</div>'
        + '<div style="font-size:16px;font-weight:600;color:var(--nt-text-2,#334155);margin-bottom:8px">'
        + esc(t('plan.empty.title')) + '</div>'
        + '<div style="font-size:13px;max-width:460px;line-height:1.5">'
        + esc(t('plan.empty.hint')) + '</div>';
    container.appendChild(empty);
}

export function renderPlan(wrap, nodes, edges, dataUrl) {
    // Vorherigen Tab-State aufraeumen (wie renderGeo).
    if (window._ntCy)         { try { window._ntCy.destroy(); } catch (e) {} window._ntCy = null; }
    if (window._ntEdgeAnim)   { clearInterval(window._ntEdgeAnim);     window._ntEdgeAnim     = null; }
    if (window._ntRefreshTimer) { clearInterval(window._ntRefreshTimer); window._ntRefreshTimer = null; }
    if (window._ntMinimapTimer) { clearInterval(window._ntMinimapTimer); window._ntMinimapTimer = null; }
    if (window._ntGeoRefreshTimer) { clearInterval(window._ntGeoRefreshTimer); window._ntGeoRefreshTimer = null; }
    cleanupPlan();
    window._ntToolbarDone = false;

    clearWrap(wrap);

    _linksOn = _loadLinksOn();
    _nodes = Array.isArray(nodes) ? nodes : [];
    _edges = Array.isArray(edges) ? edges : [];

    const container = document.createElement('div');
    container.style.cssText = 'position:relative;width:100%;height:100%';
    wrap.appendChild(container);

    function reload() {
        // Neu rendern (Referenz hat sich geaendert).
        renderPlan(wrap, window._ntLastData ? window._ntLastData.nodes : _nodes,
            window._ntLastData ? window._ntLastData.edges : _edges, dataUrl);
    }

    ensureLeaflet().then(function() {
        if (!container.isConnected) return;
        buildControls(container, reload);

        planGetRef().then(function(ref) {
            if (ref.kind === 'image') {
                // Ueber Zabbix' eigenen Bild-Server ausliefern (richtiger
                // Content-Type, kein base64/Data-URI). imgstore.php?iconid=<id>
                // serviert jedes gespeicherte Bild per id — so zeichnet auch die
                // Zabbix-Karte ihren Hintergrund. Relativ zur Frontend-Wurzel,
                // dieselbe, von der zabbix.php kommt.
                return 'imgstore.php?iconid=' + encodeURIComponent(ref.imageid);
            }
            if (ref.kind === 'url') {
                return ref.url;
            }
            return null;
        }).then(function(src) {
            if (!container.isConnected) return;
            if (src) buildMap(container, src);
            else buildEmptyState(container);
        }).catch(function() {
            if (container.isConnected) buildEmptyState(container);
        });
    }).catch(function(err) {
        if (container.isConnected) {
            container.textContent = t('geo.leaflet_error', { err: String((err && err.message) || err) });
        }
    });
}
