'use strict';
/**
 * Map packs: PMTiles vector basemaps and MBTiles raster overlays.
 *
 * Vector tiles are decoded here rather than in the browser, so the client stays
 * a plain canvas renderer with no protobuf handling, and so points of interest
 * can be filtered by category before they ever hit the wire.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const { PMTiles } = require('./pmtiles');
const { decodeTile } = require('./mvt');
const zlib = require('node:zlib');
const { resolveProtomapsUrl } = require('../library/tileset');

// node:sqlite is built in from Node 22.5. It is only needed for MBTiles
// overlays, so a runtime without it simply loses that one feature.
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

/**
 * Points of interest, grouped by what they are worth to someone with no shops
 * and no services — rather than by what a business would pay to be listed as.
 */
const POI_CATEGORIES = {
  water: {
    label: 'Water',
    colour: '#4fa8e8',
    kinds: ['spring', 'water_well', 'drinking_water', 'water_point', 'water_tower',
      'watering_place', 'fountain', 'reservoir', 'well'],
  },
  medical: {
    label: 'Medical',
    colour: '#f85149',
    kinds: ['hospital', 'clinic', 'doctors', 'pharmacy', 'chemist', 'veterinary', 'dentist',
      'nursing_home', 'healthcare', 'optician', 'medical_supply'],
  },
  food: {
    label: 'Food',
    colour: '#3fb950',
    kinds: ['supermarket', 'grocery', 'convenience', 'greengrocer', 'butcher', 'bakery',
      'farm', 'marketplace', 'deli', 'farm_shop', 'agrarian', 'seafood', 'confectionery',
      'beverages', 'alcohol', 'cheese', 'dairy', 'food_court', 'wholesale'],
  },
  supplies: {
    label: 'Supplies & tools',
    colour: '#e3b341',
    kinds: ['hardware', 'doityourself', 'trade', 'department_store', 'general', 'variety_store',
      'garden_centre', 'fuel', 'chandlery', 'outdoor', 'sports', 'car_repair', 'bicycle',
      'homewares', 'furniture', 'electronics', 'clothes', 'shoes', 'stationery', 'books',
      'pet', 'agrarian_supply', 'paint', 'tyres', 'car_parts'],
  },
  shelter: {
    label: 'Shelter & gathering',
    colour: '#bc8cff',
    kinds: ['hotel', 'hostel', 'shelter', 'community_centre', 'place_of_worship', 'school',
      'college', 'university', 'library', 'townhall', 'civic', 'public_building',
      'guest_house', 'motel', 'apartment', 'social_facility', 'arts_centre'],
  },
  infrastructure: {
    label: 'Infrastructure',
    colour: '#ff9c6e',
    kinds: ['power', 'substation', 'plant', 'generator', 'water_works', 'wastewater_plant',
      'communications_tower', 'mast', 'tower', 'windmill', 'watermill', 'dam', 'weir',
      'lighthouse', 'recycling', 'post_office', 'telephone_exchange', 'works', 'quarry'],
  },
  historic: {
    label: 'Monuments & historic',
    colour: '#d2a679',
    kinds: ['monument', 'memorial', 'castle', 'ruins', 'archaeological_site', 'fort',
      'city_gate', 'museum', 'attraction', 'artwork', 'historic', 'battlefield'],
  },
  emergency: {
    label: 'Emergency services',
    colour: '#ff7b72',
    kinds: ['fire_station', 'police', 'ambulance_station', 'defibrillator', 'rescue_station',
      'emergency_phone', 'lifeguard'],
  },
  transport: {
    label: 'Transport',
    colour: '#79c0ff',
    kinds: ['bus_station', 'railway_station', 'station', 'airport', 'aerodrome', 'helipad',
      'ferry_terminal', 'marina', 'harbour', 'port', 'slipway', 'parking', 'bus_stop'],
  },
};

const GEOMETRY_CODES = { point: 1, line: 2, polygon: 3 };

/** Reverse index from an OSM-style `kind` value to our category id. */
const KIND_TO_CATEGORY = (() => {
  const index = new Map();
  for (const [id, category] of Object.entries(POI_CATEGORIES)) {
    for (const kind of category.kinds) index.set(kind, id);
  }
  return index;
})();

function categoryFor(properties) {
  const kind = properties.kind || properties.class || properties.amenity || properties.shop;
  if (!kind) return null;
  return KIND_TO_CATEGORY.get(String(kind).toLowerCase()) || null;
}

function slugify(name) {
  return name.toLowerCase().replace(/\.(pmtiles|mbtiles)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function humanBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** MBTiles is a SQLite database of tiles; used here for the nautical overlay. */
class MBTiles {
  constructor(filePath) {
    if (!DatabaseSync) {
      throw new Error('MBTiles support needs node:sqlite (Node 22.5 or newer)');
    }
    this.filePath = filePath;
    this.db = new DatabaseSync(filePath, { readOnly: true });

    this.metadata = {};
    try {
      for (const row of this.db.prepare('SELECT name, value FROM metadata').all()) {
        this.metadata[row.name] = row.value;
      }
    } catch {
      this.metadata = {};
    }

    this._select = this.db.prepare(
      'SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?'
    );
  }

  getTile(z, x, y) {
    // MBTiles rows are numbered from the bottom (TMS); web tiles from the top.
    const flipped = Math.pow(2, z) - 1 - y;
    const row = this._select.get(z, x, flipped);
    if (!row || !row.tile_data) return null;
    return Buffer.from(row.tile_data);
  }

  describe() {
    const bounds = (this.metadata.bounds || '').split(',').map(Number);
    return {
      name: this.metadata.name || null,
      // Deliberately not called `format` — that names the archive container
      // (mbtiles), and this is the image type of the tiles inside it.
      tileFormat: (this.metadata.format || 'png').toLowerCase(),
      minZoom: Number(this.metadata.minzoom ?? 0),
      maxZoom: Number(this.metadata.maxzoom ?? 18),
      bounds: bounds.length === 4 && bounds.every(Number.isFinite) ? bounds : null,
      attribution: this.metadata.attribution || null,
      // Terrain archives hold heights, not pictures; base layers are meant to
      // sit under the map rather than over it.
      encoding: this.metadata.encoding || null,
      // Photographs (JPEG) sit under the map; the sea charts call themselves
      // base layers too but are transparent PNGs meant to go over it.
      baselayer: this.metadata.type === 'baselayer' && /jpe?g/i.test(this.metadata.format || ''),
    };
  }

  close() {
    try { this.db.close(); } catch { /* already closed */ }
  }
}

class MapManager {
  constructor(mapsDir) {
    this.mapsDir = mapsDir;
    this.packs = new Map();
    this._tileCache = new Map();
  }

  async scan() {
    await fsp.mkdir(this.mapsDir, { recursive: true });
    const all = await fsp.readdir(this.mapsDir);

    // A .url file holds the address of a remote PMTiles archive. Because the
    // format only ever needs byte ranges, a whole-planet map can be browsed
    // over the internet without downloading it — useful for deciding which
    // region you actually want before committing to the download.
    for (const file of all.filter((f) => /\.url$/i.test(f))) {
      const id = slugify(file.replace(/\.url$/i, ''));
      if (this.packs.has(id)) continue;

      try {
        let url = (await fsp.readFile(path.join(this.mapsDir, file), 'utf8')).trim();
        if (!/^https?:\/\//i.test(url)) throw new Error('Not an http(s) URL');

        // Protomaps keeps a week of daily builds; a stale date is moved on.
        if (/build\.protomaps\.com\/\d{8}\.pmtiles$/.test(url)) {
          try {
            const fresh = await resolveProtomapsUrl(url);
            if (fresh !== url) { url = fresh; await fsp.writeFile(path.join(this.mapsDir, file), url + '\n'); }
          } catch { /* offline, or none found: try the one we have */ }
        }

        const archive = await PMTiles.openRemote(url);
        const info = archive.describe();
        this.packs.set(id, {
          ...info,
          id,
          file,
          remote: true,
          url,
          kind: info.tileType === 'mvt' ? 'vector' : 'raster',
          format: 'pmtiles',
          title: `${info.name || id} (online)`,
          size: 0,
          sizeHuman: 'remote',
          _archive: archive,
        });
      } catch (err) {
        this.packs.set(id, {
          id, file, ok: false, remote: true, error: err.message,
          title: file, kind: 'unknown', size: 0, sizeHuman: 'remote',
        });
      }
    }

    const files = all.filter((f) => /\.(pmtiles|mbtiles)$/i.test(f));

    for (const file of files) {
      const id = slugify(file);
      if (this.packs.has(id)) continue;

      const fullPath = path.join(this.mapsDir, file);
      try {
        const stat = await fsp.stat(fullPath);

        if (/\.pmtiles$/i.test(file)) {
          const archive = await PMTiles.open(fullPath);
          const info = archive.describe();
          this.packs.set(id, {
            ...info,
            id,
            file,
            kind: info.tileType === 'mvt' ? 'vector' : 'raster',
            format: 'pmtiles',
            title: info.name || file.replace(/\.pmtiles$/i, ''),
            size: stat.size,
            sizeHuman: humanBytes(stat.size),
            _archive: archive,
          });
        } else {
          const archive = new MBTiles(fullPath);
          const info = archive.describe();
          this.packs.set(id, {
            ...info,
            id,
            file,
            kind: info.encoding === 'terrarium' ? 'terrain'
              : info.tileFormat === 'pbf' || info.tileFormat === 'mvt' ? 'vector' : 'raster',
            format: 'mbtiles',
            title: (info.name || file.replace(/\.mbtiles$/i, '')).replace(/_/g, ' '),
            size: stat.size,
            sizeHuman: humanBytes(stat.size),
            _archive: archive,
          });
        }
      } catch (err) {
        this.packs.set(id, {
          id, file, ok: false, error: err.message,
          title: file, kind: 'unknown', size: 0, sizeHuman: '0 B',
        });
      }
    }

    return this.list();
  }

  list() {
    return [...this.packs.values()].map(({ _archive, ...rest }) => ({ ok: true, ...rest }));
  }

  get(id) {
    return this.packs.get(id) || null;
  }

  /** Raw tile bytes — used directly for raster overlays. */
  async rawTile(id, z, x, y) {
    const pack = this.packs.get(id);
    if (!pack || !pack._archive) return null;
    return pack.format === 'pmtiles'
      ? pack._archive.getTile(z, x, y)
      : pack._archive.getTile(z, x, y);
  }

  /**
   * A decoded vector tile, trimmed to what the renderer draws. Points of
   * interest are tagged with our own category so the client can filter them.
   */
  async vectorTile(id, z, x, y) {
    const key = `${id}/${z}/${x}/${y}`;
    const cached = this._tileCache.get(key);
    if (cached !== undefined) return cached;

    const raw = await this.rawTile(id, z, x, y);
    if (!raw) {
      this._tileCache.set(key, null);
      return null;
    }

    // MBTiles vector tiles are gzipped by convention; PMTiles ones arrive decompressed.
    const bytes = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw;
    const layers = decodeTile(bytes);
    const output = {};

    for (const [name, layer] of Object.entries(layers)) {
      const features = [];
      for (const feature of layer.features) {
        if (feature.geometry.length === 0) continue;

        const entry = {
          // Numeric geometry type: 1 point, 2 line, 3 polygon. Deliberately not
          // the first letter of the name — "point" and "polygon" share one.
          t: GEOMETRY_CODES[feature.type] || 0,
          g: feature.geometry.map((ring) => ring.map(([px, py]) => [
            Math.round(px * 4096) / 4096,
            Math.round(py * 4096) / 4096,
          ])),
        };

        const props = feature.properties || {};
        // Protomaps says `kind`; OS Open Zoomstack says `type` ("A Road",
        // "Village", "Index"). Lower-cased so the client can match either.
        if (props.kind) entry.k = props.kind;
        else if (props.type) entry.k = String(props.type).toLowerCase();
        // Roads carry the useful distinction (motorway vs residential) in
        // kind_detail; kind alone only says "major_road".
        if (props.kind_detail) entry.d = props.kind_detail;
        if (props.name) entry.n = props.name;
        else if (props.name1) entry.n = props.name1;
        if (props.min_zoom !== undefined) entry.z = props.min_zoom;
        // Zoomstack extras: contour heights and road numbers.
        if (props.height !== undefined) entry.h = Number(props.height);
        if (props.number) entry.r = props.number;

        const category = categoryFor(props);
        if (category) entry.c = category;

        features.push(entry);
      }
      if (features.length) output[name] = features;
    }

    if (this._tileCache.size > 600) this._tileCache.clear();
    this._tileCache.set(key, output);
    return output;
  }

  categories() {
    return Object.entries(POI_CATEGORIES).map(([id, c]) => ({
      id, label: c.label, colour: c.colour,
    }));
  }

  async close() {
    for (const pack of this.packs.values()) {
      if (!pack._archive) continue;
      if (pack.format === 'pmtiles') await pack._archive.close().catch(() => {});
      else pack._archive.close();
    }
    this.packs.clear();
  }
}

module.exports = { MapManager, POI_CATEGORIES, humanBytes };
