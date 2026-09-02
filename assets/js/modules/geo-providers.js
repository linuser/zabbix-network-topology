// geo-providers.js — Tile-Provider-Liste für die Geomap-Ansicht.
//
// Die Liste matcht 1:1 die in Zabbix native vordefinierten Provider
// (Administration → General → Geographical maps), damit User dieselbe
// Vertrautheit haben.
//
// ⚠ Stamen Toner Lite und Stamen Terrain wurden 2023 zu Stadia Maps migriert
//    und benötigen seither einen API-Key oder Domain-Authentifizierung.
//    Ohne Stadia-Account erscheinen "Stamen Maps requires authentication"-
//    Warning-Tiles. Wer Stamen produktiv nutzen will, muss bei stadiamaps.com
//    einen kostenlosen Account anlegen und seine Domain whitelisten oder die
//    URL hier um ?api_key=... erweitern.
//
// USGS-Tiles (US Topo, US Imagery) liefern weltweit Tiles, sind aber nur in
// den USA hochauflösend. Außerhalb davon erscheinen niedrigauflösende Daten.

export const GEO_PROVIDERS = [
    {
        id: 'osm',
        label: 'OpenStreetMap Mapnik',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
    },
    {
        id: 'opentopomap',
        label: 'OpenTopoMap',
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, '
                   + 'SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> '
                   + '(<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
        maxZoom: 17,
        subdomains: 'abc'
    },
    {
        id: 'stamen-toner',
        label: 'Stamen Toner Lite (API-Key!)',
        url: 'https://tiles.stadiamaps.com/tiles/stamen_toner_lite/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> '
                   + '&copy; <a href="https://stamen.com/">Stamen Design</a> '
                   + '&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> '
                   + '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 20,
        // Nur der Schluessel: diese Liste wird beim Laden des Moduls
        // ausgewertet, t() erst zur Anzeige (render-geo.js).
        warningKey: 'geo.provider.stamen_warning'
    },
    {
        id: 'stamen-terrain',
        label: 'Stamen Terrain (API-Key!)',
        url: 'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> '
                   + '&copy; <a href="https://stamen.com/">Stamen Design</a> '
                   + '&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> '
                   + '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
        // Nur der Schluessel: diese Liste wird beim Laden des Moduls
        // ausgewertet, t() erst zur Anzeige (render-geo.js).
        warningKey: 'geo.provider.stamen_warning'
    },
    {
        id: 'usgs-topo',
        label: 'USGS US Topo',
        url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>',
        maxZoom: 16
    },
    {
        id: 'usgs-imagery',
        label: 'USGS US Imagery',
        url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>',
        maxZoom: 16
    }
];

export function getProvider(id) {
    return GEO_PROVIDERS.find(function(p) { return p.id === id; }) || GEO_PROVIDERS[0];
}
