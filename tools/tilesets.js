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

// The rest of the world, so a vault set up in Lima or Lusaka has a real map
// of where it is rather than a coastline. Each is a continent-sized box at a
// zoom that keeps the file to a few hundred megabytes; somebody who wants
// street detail for one country can cut a smaller box from the planet with
// the same machinery.
const NORTH_AMERICA = [-172, 14, -52, 72];
const SOUTH_AMERICA = [-82, -56, -34, 13];
const AFRICA = [-18, -35, 52, 38];
const MIDDLE_EAST = [25, 12, 63, 43];
const SOUTH_ASIA = [60, 5, 92, 37];
const SOUTH_EAST_ASIA = [92, -11, 141, 29];
const EAST_ASIA = [73, 18, 135, 54];
const OCEANIA = [110, -48, 180, -8];
const RUSSIA_NORTH_ASIA = [26, 41, 180, 78];

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
    id: 'map-north-america', title: 'Map — North America (offline)', category: 'maps',
    description: 'Main roads, towns and rivers across Canada, the United States and Mexico to about 300 m per pixel. For the journey, not the street.',
    filename: 'Map - North America.mbtiles', url: PROTOMAPS, format: 'pbf', bounds: NORTH_AMERICA, minZoom: 0, maxZoom: 9, source: 'pmtiles',
    perTile: 45000, name: 'Map — North America', attribution: 'Protomaps basemap © OpenStreetMap contributors', type: 'baselayer',
    priority: 43.1, recommended: false,
  }),
  tileset({
    id: 'map-south-america', title: 'Map — South America (offline)', category: 'maps',
    description: 'Main roads, towns and rivers from Colombia to Tierra del Fuego to about 300 m per pixel.',
    filename: 'Map - South America.mbtiles', url: PROTOMAPS, format: 'pbf', bounds: SOUTH_AMERICA, minZoom: 0, maxZoom: 9, source: 'pmtiles',
    perTile: 40000, name: 'Map — South America', attribution: 'Protomaps basemap © OpenStreetMap contributors', type: 'baselayer',
    priority: 43.2, recommended: false,
  }),
  tileset({
    id: 'map-africa', title: 'Map — Africa (offline)', category: 'maps',
    description: 'Main roads, towns and rivers across the whole continent to about 300 m per pixel.',
    filename: 'Map - Africa.mbtiles', url: PROTOMAPS, format: 'pbf', bounds: AFRICA, minZoom: 0, maxZoom: 9, source: 'pmtiles',
    perTile: 38000, name: 'Map — Africa', attribution: 'Protomaps basemap © OpenStreetMap contributors', type: 'baselayer',
    priority: 43.3, recommended: false,
  }),
  tileset({
    id: 'map-middle-east', title: 'Map — the Middle East (offline)', category: 'maps',
    description: 'Main roads, towns and rivers from Egypt to Iran to about 300 m per pixel.',
    filename: 'Map - Middle East.mbtiles', url: PROTOMAPS, format: 'pbf', bounds: MIDDLE_EAST, minZoom: 0, maxZoom: 9, source: 'pmtiles',
    perTile: 40000, name: 'Map — Middle East', attribution: 'Protomaps basemap © OpenStreetMap contributors', type: 'baselayer',
    priority: 43.4, recommended: false,
  }),
  tileset({
    id: 'map-south-asia', title: 'Map — South Asia (offline)', category: 'maps',
    description: 'India, Pakistan, Bangladesh, Nepal and Sri Lanka: main roads, towns and rivers to about 300 m per pixel.',
    filename: 'Map - South Asia.mbtiles', url: PROTOMAPS, format: 'pbf', bounds: SOUTH_ASIA, minZoom: 0, maxZoom: 9, source: 'pmtiles',
    perTile: 48000, name: 'Map — South Asia', attribution: 'Protomaps basemap © OpenStreetMap contributors', type: 'baselayer',
    priority: 43.5, recommended: false,
  }),
  tileset({
    id: 'map-south-east-asia', title: 'Map — South East Asia (offline)', category: 'maps',
    description: 'Indochina, Malaysia, Indonesia and the Philippines to about 300 m per pixel.',
    filename: 'Map - South East Asia.mbtiles', url: PROTOMAPS, format: 'pbf', bounds: SOUTH_EAST_ASIA, minZoom: 0, maxZoom: 9, source: 'pmtiles',
    perTile: 42000, name: 'Map — South East Asia', attribution: 'Protomaps basemap © OpenStreetMap contributors', type: 'baselayer',
    priority: 43.6, recommended: false,
  }),
  tileset({
    id: 'map-east-asia', title: 'Map — East Asia (offline)', category: 'maps',
    description: 'China, the Koreas and Mongolia: main roads, towns and rivers to about 300 m per pixel.',
    filename: 'Map - East Asia.mbtiles', url: PROTOMAPS, format: 'pbf', bounds: EAST_ASIA, minZoom: 0, maxZoom: 9, source: 'pmtiles',
    perTile: 45000, name: 'Map — East Asia', attribution: 'Protomaps basemap © OpenStreetMap contributors', type: 'baselayer',
    priority: 43.7, recommended: false,
  }),
  tileset({
    id: 'map-oceania', title: 'Map — Australia and New Zealand (offline)', category: 'maps',
    description: 'Australia, New Zealand and the Pacific islands to about 300 m per pixel.',
    filename: 'Map - Australia and New Zealand.mbtiles', url: PROTOMAPS, format: 'pbf', bounds: OCEANIA, minZoom: 0, maxZoom: 9, source: 'pmtiles',
    perTile: 35000, name: 'Map — Australia and New Zealand', attribution: 'Protomaps basemap © OpenStreetMap contributors', type: 'baselayer',
    priority: 43.8, recommended: false,
  }),
  tileset({
    id: 'map-northern-asia', title: 'Map — Russia and northern Asia (offline)', category: 'maps',
    description: 'Russia, Central Asia and the far north to about 600 m per pixel.',
    filename: 'Map - Russia and northern Asia.mbtiles', url: PROTOMAPS, format: 'pbf', bounds: RUSSIA_NORTH_ASIA, minZoom: 0, maxZoom: 8, source: 'pmtiles',
    perTile: 42000, name: 'Map — Russia and northern Asia', attribution: 'Protomaps basemap © OpenStreetMap contributors', type: 'baselayer',
    priority: 43.9, recommended: false,
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
