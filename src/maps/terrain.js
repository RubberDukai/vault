'use strict';
/**
 * Heights from terrain tiles.
 *
 * Terrarium tiles are ordinary PNGs where each pixel's colour is a height:
 *   metres = red * 256 + green + blue / 256 - 32768
 * So this decodes just enough PNG to read pixels — 8-bit RGB or RGBA, no
 * interlace, which is all the tiles ever use — and samples heights along a
 * route to say how much of it is uphill.
 */

const zlib = require('node:zlib');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decode a PNG into { width, height, channels, data } with 8-bit samples. */
function decodePng(buffer) {
  if (!buffer || buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Not a PNG');
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  let interlace = 0;
  const idat = [];
  let palette = null;

  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('latin1', pos + 4, pos + 8);
    const body = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colourType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`);
  if (interlace) throw new Error('Interlaced PNG not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colourType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);

  // Undo the per-row filters. Each row starts with a byte naming its filter.
  let inPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[inPos++];
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[inPos + i];
      const a = i >= channels ? out[rowStart + i - channels] : 0;
      const b = y > 0 ? out[prevStart + i] : 0;
      const c = y > 0 && i >= channels ? out[prevStart + i - channels] : 0;
      let value;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`Bad PNG filter ${filter}`);
      }
      out[rowStart + i] = value & 0xff;
    }
    inPos += stride;
  }

  if (colourType === 3) {
    // Palette: expand to RGB so callers see one layout.
    if (!palette) throw new Error('Palette PNG without PLTE');
    const rgb = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      const idx = out[i] * 3;
      rgb[i * 3] = palette[idx];
      rgb[i * 3 + 1] = palette[idx + 1];
      rgb[i * 3 + 2] = palette[idx + 2];
    }
    return { width, height, channels: 3, data: rgb };
  }
  return { width, height, channels, data: out };
}

// ------------------------------------------------------------- sampling

const lonToWorldX = (lon, z) => ((lon + 180) / 360) * Math.pow(2, z);
function latToWorldY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  const merc = Math.log(Math.tan(rad) + 1 / Math.cos(rad));
  return ((1 - merc / Math.PI) / 2) * Math.pow(2, z);
}

/** Great-circle distance in metres. */
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6378137 * Math.asin(Math.sqrt(a));
}

class Elevation {
  constructor(maps) {
    this.maps = maps;
    this._decoded = new Map(); // "pack/z/x/y" -> decoded tile or null
  }

  /** Terrain packs covering a point, best resolution first. */
  _packsFor(lon, lat) {
    return this.maps.list()
      .filter((p) => p.ok !== false && p.kind === 'terrain')
      .filter((p) => !p.bounds || (lon >= p.bounds[0] && lon <= p.bounds[2] && lat >= p.bounds[1] && lat <= p.bounds[3]))
      .sort((a, b) => (b.maxZoom || 0) - (a.maxZoom || 0));
  }

  async _tile(packId, z, x, y) {
    const key = `${packId}/${z}/${x}/${y}`;
    if (this._decoded.has(key)) return this._decoded.get(key);
    let tile = null;
    try {
      const raw = await this.maps.rawTile(packId, z, x, y);
      if (raw) tile = decodePng(raw);
    } catch {
      tile = null;
    }
    if (this._decoded.size > 64) this._decoded.delete(this._decoded.keys().next().value);
    this._decoded.set(key, tile);
    return tile;
  }

  /** Height in metres at a point, or null with no terrain pack there. */
  async at(lon, lat) {
    for (const pack of this._packsFor(lon, lat)) {
      const z = pack.maxZoom;
      const wx = lonToWorldX(lon, z);
      const wy = latToWorldY(lat, z);
      const tx = Math.floor(wx);
      const ty = Math.floor(wy);
      const tile = await this._tile(pack.id, z, tx, ty);
      if (!tile) continue;
      // Bilinear between the four nearest pixels.
      const px = (wx - tx) * tile.width - 0.5;
      const py = (wy - ty) * tile.height - 0.5;
      const x0 = Math.max(0, Math.min(tile.width - 1, Math.floor(px)));
      const y0 = Math.max(0, Math.min(tile.height - 1, Math.floor(py)));
      const x1 = Math.min(tile.width - 1, x0 + 1);
      const y1 = Math.min(tile.height - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, px - x0));
      const fy = Math.max(0, Math.min(1, py - y0));
      const h = (x, y) => {
        const i = (y * tile.width + x) * tile.channels;
        return tile.data[i] * 256 + tile.data[i + 1] + tile.data[i + 2] / 256 - 32768;
      };
      const top = h(x0, y0) * (1 - fx) + h(x1, y0) * fx;
      const bottom = h(x0, y1) * (1 - fx) + h(x1, y1) * fx;
      return { metres: top * (1 - fy) + bottom * fy, source: pack.id, zoom: z };
    }
    return null;
  }

  /**
   * A height profile along a route: every node plus points between them,
   * about `spacing` metres apart. Returns the samples and the climb totals.
   */
  async profile(points, spacing = 100, maxSamples = 400) {
    const legs = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const d = haversine(points[i - 1][1], points[i - 1][0], points[i][1], points[i][0]);
      legs.push(d);
      total += d;
    }
    const step = Math.max(spacing, total / maxSamples);

    const samples = [];
    let distance = 0;
    for (let i = 0; i < points.length; i++) {
      if (i > 0) {
        const [lon0, lat0] = points[i - 1];
        const [lon1, lat1] = points[i];
        const n = Math.max(1, Math.round(legs[i - 1] / step));
        for (let k = 1; k < n; k++) {
          const t = k / n;
          samples.push({ lon: lon0 + (lon1 - lon0) * t, lat: lat0 + (lat1 - lat0) * t, distance: distance + legs[i - 1] * t, node: null });
        }
        distance += legs[i - 1];
      }
      samples.push({ lon: points[i][0], lat: points[i][1], distance, node: i });
    }

    let source = null;
    for (const s of samples) {
      const h = await this.at(s.lon, s.lat);
      s.metres = h ? Math.round(h.metres) : null;
      if (h && !source) source = h.source;
    }

    // Climb and descent, ignoring wobble under 3 m so noise is not counted.
    let gain = 0;
    let loss = 0;
    let last = null;
    let highest = null;
    let lowest = null;
    for (const s of samples) {
      if (s.metres === null) continue;
      if (highest === null || s.metres > highest) highest = s.metres;
      if (lowest === null || s.metres < lowest) lowest = s.metres;
      if (last !== null) {
        const delta = s.metres - last;
        if (delta >= 3) { gain += delta; last = s.metres; }
        else if (delta <= -3) { loss += -delta; last = s.metres; }
      } else {
        last = s.metres;
      }
    }

    const covered = samples.filter((s) => s.metres !== null).length;
    return {
      samples: samples.map(({ distance: d, metres, node }) => ({ distance: Math.round(d), metres, node })),
      gain: Math.round(gain), loss: Math.round(loss), highest, lowest,
      coverage: samples.length ? covered / samples.length : 0,
      source,
    };
  }
}

module.exports = { decodePng, Elevation };
