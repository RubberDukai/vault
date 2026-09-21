'use strict';
/**
 * Reader for the PMTiles v3 format — a whole map archive in a single file.
 *
 * Like the ZIM reader, this is written against the published specification with
 * no dependencies, so a map you download today stays readable indefinitely.
 *
 * Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 */

const fsp = require('node:fs/promises');
const zlib = require('node:zlib');

const MAGIC = 'PMTiles';
const HEADER_BYTES = 127;

const COMPRESSION = { 0: 'unknown', 1: 'none', 2: 'gzip', 3: 'brotli', 4: 'zstd' };
const TILE_TYPE = { 0: 'unknown', 1: 'mvt', 2: 'png', 3: 'jpeg', 4: 'webp', 5: 'avif' };

/**
 * Varints can exceed 32 bits (byte offsets into a 100GB archive), so accumulate
 * in a double rather than with bit shifts, which would silently wrap.
 */
function readVarint(buf, state) {
  let result = 0;
  let shift = 1;
  let byte;
  do {
    byte = buf[state.pos++];
    result += (byte & 0x7f) * shift;
    shift *= 128;
  } while (byte >= 0x80);
  return result;
}

function decompress(buffer, compression) {
  switch (compression) {
    case 1: return buffer;
    case 2: return zlib.gunzipSync(buffer, { maxOutputLength: 64 * 1024 * 1024 });
    case 3: return zlib.brotliDecompressSync(buffer, { maxOutputLength: 64 * 1024 * 1024 });
    case 4: return zlib.zstdDecompressSync(buffer, { maxOutputLength: 256 * 1024 * 1024 });
    default: return buffer;
  }
}

/**
 * Tile IDs follow a Hilbert curve, so tiles that are near each other on the map
 * are near each other in the file — which is what makes range requests over a
 * remote archive practical.
 */
function zxyToTileId(z, x, y) {
  if (z === 0) return 0;

  // Every tile in every lower zoom level comes first.
  let accumulator = 0;
  for (let level = 0; level < z; level++) {
    accumulator += Math.pow(4, level);
  }

  let rx;
  let ry;
  let distance = 0;
  let tx = x;
  let ty = y;

  for (let s = Math.pow(2, z) / 2; s >= 1; s /= 2) {
    rx = (tx & s) > 0 ? 1 : 0;
    ry = (ty & s) > 0 ? 1 : 0;
    distance += s * s * ((3 * rx) ^ ry);

    // Rotate the quadrant to stay on the curve.
    if (ry === 0) {
      if (rx === 1) {
        tx = s - 1 - tx;
        ty = s - 1 - ty;
      }
      const swap = tx;
      tx = ty;
      ty = swap;
    }
  }

  return accumulator + distance;
}

function deserializeDirectory(buffer) {
  const state = { pos: 0 };
  const count = readVarint(buffer, state);
  // Four varints per entry, at least a byte each: a count the buffer could
  // not possibly hold is a corrupt directory, not a reason to allocate.
  if (count < 0 || count > buffer.length) throw new Error('Corrupt PMTiles directory');
  const entries = new Array(count);

  let tileId = 0;
  for (let i = 0; i < count; i++) {
    tileId += readVarint(buffer, state);
    entries[i] = { tileId, offset: 0, length: 0, runLength: 0 };
  }
  for (let i = 0; i < count; i++) entries[i].runLength = readVarint(buffer, state);
  for (let i = 0; i < count; i++) entries[i].length = readVarint(buffer, state);

  for (let i = 0; i < count; i++) {
    const value = readVarint(buffer, state);
    // Zero means "immediately after the previous tile", the common case in a
    // clustered archive, which keeps directories small.
    entries[i].offset = value === 0 && i > 0
      ? entries[i - 1].offset + entries[i - 1].length
      : value - 1;
  }

  return entries;
}

function findEntry(entries, tileId) {
  let lo = 0;
  let hi = entries.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tileId < entries[mid].tileId) hi = mid - 1;
    else if (tileId > entries[mid].tileId) lo = mid + 1;
    else return entries[mid];
  }

  // Not an exact hit: the run starting at the preceding entry may cover it.
  if (hi >= 0) {
    const candidate = entries[hi];
    if (candidate.runLength === 0) return candidate;                  // leaf directory
    if (tileId - candidate.tileId < candidate.runLength) return candidate;
  }
  return null;
}

/**
 * PMTiles is designed so a reader only ever needs byte ranges, which is why the
 * same archive works on disk or over HTTP. Keeping the source abstract means a
 * remote archive can be read without downloading all of it.
 */
class FileSource {
  constructor(handle) {
    this.fh = handle;
  }

  async read(offset, length) {
    const buf = Buffer.allocUnsafe(length);
    const { bytesRead } = await this.fh.read(buf, 0, length, offset);
    return bytesRead === length ? buf : buf.subarray(0, bytesRead);
  }

  async close() {
    await this.fh.close();
  }
}

class HttpSource {
  constructor(url) {
    this.url = url;
  }

  async read(offset, length) {
    const res = await fetch(this.url, {
      headers: { range: `bytes=${offset}-${offset + length - 1}` },
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`Range request failed: HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async close() { /* nothing to release */ }
}

class PMTiles {
  constructor(source, label) {
    this.source = source;
    this.filePath = label;
    this.header = null;
    this.metadata = null;
    this._rootDirectory = null;
    this._leafCache = new Map();
  }

  static async open(filePath) {
    const handle = await fsp.open(filePath, 'r');
    const archive = new PMTiles(new FileSource(handle), filePath);
    try {
      await archive._init();
    } catch (err) {
      await handle.close();
      throw err;
    }
    return archive;
  }

  /** Read an archive served over HTTP, fetching only the bytes needed. */
  static async openRemote(url) {
    const archive = new PMTiles(new HttpSource(url), url);
    await archive._init();
    return archive;
  }

  async close() {
    await this.source.close();
  }

  async _read(offset, length) {
    if (length <= 0) return Buffer.alloc(0);
    return this.source.read(offset, length);
  }

  async _init() {
    const h = await this._read(0, HEADER_BYTES);
    if (h.length < HEADER_BYTES || h.toString('utf8', 0, 7) !== MAGIC) {
      throw new Error('Not a PMTiles archive');
    }
    if (h.readUInt8(7) !== 3) {
      throw new Error(`PMTiles version ${h.readUInt8(7)} is not supported (need v3)`);
    }

    const coord = (offset) => h.readInt32LE(offset) / 10000000;

    this.header = {
      rootOffset: Number(h.readBigUInt64LE(8)),
      rootLength: Number(h.readBigUInt64LE(16)),
      metadataOffset: Number(h.readBigUInt64LE(24)),
      metadataLength: Number(h.readBigUInt64LE(32)),
      leafOffset: Number(h.readBigUInt64LE(40)),
      leafLength: Number(h.readBigUInt64LE(48)),
      tileDataOffset: Number(h.readBigUInt64LE(56)),
      tileDataLength: Number(h.readBigUInt64LE(64)),
      addressedTiles: Number(h.readBigUInt64LE(72)),
      tileEntries: Number(h.readBigUInt64LE(80)),
      tileContents: Number(h.readBigUInt64LE(88)),
      clustered: h.readUInt8(96) === 1,
      internalCompression: h.readUInt8(97),
      tileCompression: h.readUInt8(98),
      tileType: h.readUInt8(99),
      minZoom: h.readUInt8(100),
      maxZoom: h.readUInt8(101),
      bounds: [coord(102), coord(106), coord(110), coord(114)], // west, south, east, north
      centerZoom: h.readUInt8(118),
      center: [coord(119), coord(123)],
    };

    this.header.tileTypeName = TILE_TYPE[this.header.tileType] || 'unknown';
    this.header.tileCompressionName = COMPRESSION[this.header.tileCompression] || 'unknown';

    if (this.header.metadataLength > 0) {
      try {
        const raw = await this._read(this.header.metadataOffset, this.header.metadataLength);
        this.metadata = JSON.parse(decompress(raw, this.header.internalCompression).toString('utf8'));
      } catch {
        this.metadata = null;
      }
    }

    const rootRaw = await this._read(this.header.rootOffset, this.header.rootLength);
    this._rootDirectory = deserializeDirectory(decompress(rootRaw, this.header.internalCompression));
  }

  async _leafDirectory(offset, length) {
    const key = `${offset}:${length}`;
    const cached = this._leafCache.get(key);
    if (cached) return cached;

    const raw = await this._read(this.header.leafOffset + offset, length);
    const entries = deserializeDirectory(decompress(raw, this.header.internalCompression));

    if (this._leafCache.size > 256) this._leafCache.clear();
    this._leafCache.set(key, entries);
    return entries;
  }

  /** Fetch one tile. Returns the raw (still tile-compressed) bytes, or null. */
  async getTile(z, x, y) {
    if (z < this.header.minZoom || z > this.header.maxZoom) return null;

    const tileId = zxyToTileId(z, x, y);
    let directory = this._rootDirectory;

    // Root, then up to two levels of leaf directories.
    for (let depth = 0; depth < 4; depth++) {
      const entry = findEntry(directory, tileId);
      if (!entry) return null;

      if (entry.runLength > 0) {
        const raw = await this._read(this.header.tileDataOffset + entry.offset, entry.length);
        return decompress(raw, this.header.tileCompression);
      }
      directory = await this._leafDirectory(entry.offset, entry.length);
    }
    return null;
  }

  /**
   * Where a tile's bytes live in the archive, without reading them. Lets an
   * extractor sort tiles by position and read big contiguous runs at once,
   * which over HTTP is the difference between hours and minutes.
   */
  async locateTile(z, x, y) {
    if (z < this.header.minZoom || z > this.header.maxZoom) return null;
    const tileId = zxyToTileId(z, x, y);
    let directory = this._rootDirectory;
    for (let depth = 0; depth < 4; depth++) {
      const entry = findEntry(directory, tileId);
      if (!entry) return null;
      if (entry.runLength > 0) {
        return { offset: this.header.tileDataOffset + entry.offset, length: entry.length, compression: this.header.tileCompression };
      }
      directory = await this._leafDirectory(entry.offset, entry.length);
    }
    return null;
  }

  /** Read a byte range of the archive directly (for extraction). */
  async readRange(offset, length) {
    return this._read(offset, length);
  }

  describe() {
    return {
      minZoom: this.header.minZoom,
      maxZoom: this.header.maxZoom,
      bounds: this.header.bounds,
      center: this.header.center,
      centerZoom: this.header.centerZoom,
      tileType: this.header.tileTypeName,
      addressedTiles: this.header.addressedTiles,
      name: this.metadata?.name || null,
      attribution: this.metadata?.attribution || null,
      vectorLayers: this.metadata?.vector_layers?.map((l) => l.id) || null,
    };
  }
}

module.exports = { PMTiles, zxyToTileId, deserializeDirectory, decompress };
