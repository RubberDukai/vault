'use strict';
/**
 * Satellite imagery and terrain come from tile services, not single files.
 * These entries tell the downloader which tiles to harvest into an MBTiles
 * archive. Sizes are estimates from a typical tile; the real figure is
 * reported as it runs.
 */

const { tileCount } = require('../src/library/tileset');

// Where things are, as [west, south, east, north].
const BRITAIN = [-11, 49.5, 2.2, 61];
const EUROPE = [-12, 34, 42, 72];
const JAPAN = [128, 30, 146.5, 46];
const WORLD = [-180, -85, 180, 85];

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const S2 = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/{z}/{y}/{x}.jpg';
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
// The Protomaps daily planet build; the downloader moves the date on as builds expire.
const PROTOMAPS = 'https://build.protomaps.com/20260916.pmtiles';

function tileset({ id, title, description, filename, url, format, bounds, minZoom, maxZoom, perTile, name, attribution, type, encoding, priority, recommended, source, category }) {
  const spec = { url, format, bounds, minZoom, maxZoom, name, attribution, type: type || 'overlay', description, ...(encoding ? { encoding } : {}), ...(source ? { source } : {}) };
  const count = tileCount(spec);
  return {
    id, category: category || 'imagery', title,
    description: `${description} ${count.toLocaleString()} tiles.`,
    size: count * perTile, dest: 'library/maps', priority, recommended: Boolean(recommended),
    files: [{ filename, tileset: spec }],
  };
}

const TILESETS = [
  tileset({
    id: 'map-world', title: 'Map — the whole world (offline)', category: 'maps',
    description: 'Coastlines, countries, rivers, major roads and cities everywhere, to about 2 km per pixel. The base the sea charts and satellite views sit on when the internet has gone.',
    filename: 'Map - World.mbtiles', url: PROTOMAPS, format: 'pbf', bounds: WORLD, minZoom: 0, maxZoom: 6, source: 'pmtiles',
    perTile: 90000, name: 'Map — World', attribution: 'Protomaps basemap © OpenStreetMap contributors', type: 'baselayer',
    priority: 40, recommended: true,
  }),
  tileset({
    id: 'map-britain', title: 'Map — Britain and Ireland (offline, streets)', category: 'maps',
    description: 'Every road down to residential streets, footpaths, buildings from zoom 13, rivers, woods, and the points of interest. The map to have when the online one is gone.',
    filename: 'Map - Britain and Ireland.mbtiles', url: PROTOMAPS, format: 'pbf', bounds: BRITAIN, minZoom: 0, maxZoom: 13, source: 'pmtiles',
    perTile: 14000, name: 'Map — Britain & Ireland', attribution: 'Protomaps basemap © OpenStreetMap contributors', type: 'baselayer',
    priority: 41, recommended: true,
  }),
  tileset({
    id: 'map-europe', title: 'Map — Europe (offline)', category: 'maps',
    description: 'Main roads, towns and rivers across Europe to about 300 m per pixel. For the journey, not the street.',
    filename: 'Map - Europe.mbtiles', url: PROTOMAPS, format: 'pbf', bounds: EUROPE, minZoom: 0, maxZoom: 9, source: 'pmtiles',
    perTile: 45000, name: 'Map — Europe', attribution: 'Protomaps basemap © OpenStreetMap contributors', type: 'baselayer',
    priority: 42, recommended: false,
  }),
  tileset({
    id: 'map-japan', title: 'Map — Japan (offline)', category: 'maps',
    description: 'Roads, towns, rivers and places across Japan to about 80 m per pixel.',
    filename: 'Map - Japan.mbtiles', url: PROTOMAPS, format: 'pbf', bounds: JAPAN, minZoom: 0, maxZoom: 11, source: 'pmtiles',
    perTile: 25000, name: 'Map — Japan', attribution: 'Protomaps basemap © OpenStreetMap contributors', type: 'baselayer',
    priority: 43, recommended: false,
  }),
  tileset({
    id: 'satellite-blue-marble', title: 'Satellite — the whole world (NASA Blue Marble)',
    description: 'True-colour satellite view of the planet, cloud-free, to about 2 km per pixel. Continents, deserts, forests, ice; not streets. Public domain.',
    filename: 'Satellite - Blue Marble (world).mbtiles', url: GIBS, format: 'jpg', bounds: WORLD, minZoom: 0, maxZoom: 6,
    perTile: 11000, name: 'Satellite — Blue Marble (world)', attribution: 'NASA Earth Observatory Blue Marble, via GIBS', type: 'baselayer',
    priority: 45, recommended: true,
  }),
  tileset({
    id: 'satellite-sentinel-britain', title: 'Satellite — Britain and Ireland (Sentinel-2)',
    description: 'Cloud-free satellite view to about 40 m per pixel: fields, woods, rivers, towns. Non-commercial licence — fine for a household, not for sale.',
    filename: 'Satellite - Britain and Ireland.mbtiles', url: S2, format: 'jpg', bounds: BRITAIN, minZoom: 0, maxZoom: 11,
    perTile: 22000, name: 'Satellite — Britain & Ireland', attribution: 'Sentinel-2 cloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2021), CC BY-NC-SA 4.0', type: 'baselayer',
    priority: 46, recommended: true,
  }),
  tileset({
    id: 'satellite-sentinel-europe', title: 'Satellite — Europe (Sentinel-2)',
    description: 'Cloud-free satellite view of Europe to about 300 m per pixel. Non-commercial licence.',
    filename: 'Satellite - Europe.mbtiles', url: S2, format: 'jpg', bounds: EUROPE, minZoom: 0, maxZoom: 8,
    perTile: 20000, name: 'Satellite — Europe', attribution: 'Sentinel-2 cloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2021), CC BY-NC-SA 4.0', type: 'baselayer',
    priority: 47, recommended: false,
  }),
  tileset({
    id: 'satellite-sentinel-japan', title: 'Satellite — Japan (Sentinel-2)',
    description: 'Cloud-free satellite view of Japan to about 80 m per pixel. Non-commercial licence.',
    filename: 'Satellite - Japan.mbtiles', url: S2, format: 'jpg', bounds: JAPAN, minZoom: 0, maxZoom: 10,
    perTile: 22000, name: 'Satellite — Japan', attribution: 'Sentinel-2 cloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2021), CC BY-NC-SA 4.0', type: 'baselayer',
    priority: 48, recommended: false,
  }),
  tileset({
    id: 'terrain-britain', title: 'Terrain — Britain and Ireland (heights)',
    description: 'Ground height for every point, about 150 m apart. Gives route plans their climb and descent, and the map its hill shading.',
    filename: 'Terrain - Britain and Ireland.mbtiles', url: TERRARIUM, format: 'png', bounds: BRITAIN, minZoom: 0, maxZoom: 10,
    perTile: 70000, name: 'Terrain — Britain & Ireland', attribution: 'Mapzen/AWS Terrain Tiles: SRTM, GMTED2010, ETOPO1 and others', type: 'overlay', encoding: 'terrarium',
    priority: 49, recommended: true,
  }),
  tileset({
    id: 'terrain-world', title: 'Terrain — the whole world (coarse heights)',
    description: 'Ground height everywhere, about 2 km apart. Enough to know a mountain range is in the way; not enough for a day\'s walk.',
    filename: 'Terrain - World.mbtiles', url: TERRARIUM, format: 'png', bounds: WORLD, minZoom: 0, maxZoom: 6,
    perTile: 60000, name: 'Terrain — World', attribution: 'Mapzen/AWS Terrain Tiles: SRTM, GMTED2010, ETOPO1 and others', type: 'overlay', encoding: 'terrarium',
    priority: 50, recommended: false,
  }),
];

module.exports = { TILESETS };
