'use strict';

/**
 * Offline place-name search.
 *
 * There is no gazetteer to download: the names are already in the vector map
 * packs, in the `places` layer (countries, regions, towns, villages,
 * neighbourhoods). Building the index walks every tile of each vector pack at
 * one zoom level, pulls the named points out and writes them to
 * data/places.json. Britain & Ireland is about 100,000 names and takes a
 * quarter of a minute; the world pack at zoom 6 is a few thousand and takes
 * seconds. Searching is a linear scan over folded names, which is fast enough
 * at that size and needs no clever structure to persist.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { decodeTile } = require('./mvt');

// Deeper than this and the tile count explodes for no new names: Protomaps
// places every village by zoom 12.
const INDEX_ZOOM = 12;

const KIND_RANK = { country: 0, region: 1, county: 2, locality: 3, macrohood: 4, neighbourhood: 5 };

function tileToLonLat(z, x, y, fx, fy) {
  const n = Math.pow(2, z);
  const lon = ((x + fx) / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + fy)) / n)));
  return [lon, (latRad * 180) / Math.PI];
}

function lonLatToTile(lon, lat, z) {
  const n = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
}

/** Lower-case, accents stripped, punctuation collapsed — so "Ste Helier" finds "St. Hélier". */
function fold(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9Ā-￿]+/g, ' ')
    .trim();
}

class PlaceIndex {
  constructor(filePath, maps) {
    this.filePath = filePath;
    this.maps = maps;
    this.places = null; // [{ n, f, k, lat, lon, r, p }] — name, folded name, kind, rank, pack
    this.meta = null;
    this.building = null;
  }

  load() {
    if (this.places) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.meta = data.meta || null;
      this.places = (data.places || []).map(([n, k, lat, lon, r, p]) => ({ n, f: fold(n), k, lat, lon, r, p }));
    } catch {
      this.places = [];
      this.meta = null;
    }
  }

  status() {
    this.load();
    return {
      ready: this.places.length > 0,
      count: this.places.length,
      builtAt: this.meta?.builtAt || null,
      packs: this.meta?.packs || [],
      building: Boolean(this.building),
    };
  }

  /** Every named point in every installed vector pack, deduplicated. Runs once and saves. */
  async build() {
    if (this.building) return this.building;
    this.building = this._build().finally(() => { this.building = null; });
    return this.building;
  }

  async _build() {
    const seen = new Map();
    const packsDone = [];

    for (const pack of this.maps.list()) {
      if (pack.kind !== 'vector' || pack.remote) continue;
      const zoom = Math.min(INDEX_ZOOM, pack.maxZoom ?? INDEX_ZOOM);
      let count = 0;

      for await (const [z, x, y, raw] of this._tiles(pack, zoom)) {
        const bytes = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw, { maxOutputLength: 64 * 1024 * 1024 }) : raw;
        let layers;
        try { layers = decodeTile(bytes); } catch { continue; }
        const layer = layers.places;
        if (!layer) continue;

        for (const feature of layer.features) {
          const props = feature.properties || {};
          const name = props['name:en'] || props.name;
          if (!name || !feature.geometry.length || !feature.geometry[0].length) continue;
          const [fx, fy] = feature.geometry[0][0];
          // Tiles carry a buffer beyond their edge; the same point then shows up
          // in a neighbour, slightly outside 0..1. Take it once, from its own tile.
          if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) continue;
          const [lon, lat] = tileToLonLat(z, x, y, fx, fy);
          const key = `${name}|${props.kind}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
          if (seen.has(key)) continue;
          seen.set(key, [
            name,
            props.kind || 'locality',
            Number(lat.toFixed(5)),
            Number(lon.toFixed(5)),
            Number(props.population_rank ?? 0),
            pack.id,
          ]);
          count += 1;
        }
      }
      packsDone.push({ id: pack.id, title: pack.title, zoom, count });
    }

    const places = [...seen.values()];
    const meta = { builtAt: new Date().toISOString(), packs: packsDone, zoom: INDEX_ZOOM };
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    await fsp.writeFile(this.filePath, JSON.stringify({ meta, places }));
    this.places = null;
    this.load();
    return this.status();
  }

  /** Yields [z, x, y, bytes] for every tile of a pack at one zoom. */
  async *_tiles(pack, zoom) {
    const archive = this.maps.get(pack.id)?._archive;
    if (!archive) return;

    if (pack.format === 'mbtiles' && archive.db) {
      const n = Math.pow(2, zoom);
      const stmt = archive.db.prepare('SELECT tile_column, tile_row, tile_data FROM tiles WHERE zoom_level = ?');
      for (const row of stmt.iterate(zoom)) {
        if (!row.tile_data) continue;
        yield [zoom, row.tile_column, n - 1 - row.tile_row, Buffer.from(row.tile_data)];
      }
      return;
    }

    // PMTiles has no cheap listing, so walk the bounding box.
    const [west, south, east, north] = pack.bounds || [-180, -85, 180, 85];
    const [x0, y0] = lonLatToTile(west, north, zoom);
    const [x1, y1] = lonLatToTile(east, south, zoom);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const raw = await archive.getTile(zoom, x, y);
        if (raw) yield [zoom, x, y, raw];
      }
    }
  }

  /**
   * Names that start with the query rank first, then names containing it,
   * then names where every word of the query appears. Bigger places win ties.
   */
  search(query, limit = 12, near = null) {
    this.load();
    const q = fold(query);
    if (!q) return [];
    const words = q.split(' ').filter(Boolean);
    const scored = [];

    for (const place of this.places) {
      let score;
      if (place.f === q) score = 0;
      else if (place.f.startsWith(q)) score = 1;
      else if (place.f.includes(` ${q}`)) score = 2;
      else if (place.f.includes(q)) score = 3;
      else if (words.length > 1 && words.every((w) => place.f.includes(w))) score = 4;
      else continue;
      // Same name, several places: the one nearest the map wins, so from
      // Britain "Lancaster" is the one on the Lune, not the one in California.
      const dist = near ? Math.hypot(place.lat - near.lat, (place.lon - near.lon) * Math.cos((near.lat * Math.PI) / 180)) : 0;
      scored.push({ place, score, dist: Math.round(dist / 5) }); // 5° bands, so rank still decides locally
    }

    scored.sort((a, b) => a.score - b.score
      || (KIND_RANK[a.place.k] ?? 9) - (KIND_RANK[b.place.k] ?? 9)
      || a.dist - b.dist
      || b.place.r - a.place.r
      || a.place.n.localeCompare(b.place.n));

    return scored.slice(0, limit).map(({ place }) => ({
      name: place.n, kind: place.k, lat: place.lat, lon: place.lon, rank: place.r, pack: place.p,
    }));
  }
}

module.exports = { PlaceIndex, fold };
