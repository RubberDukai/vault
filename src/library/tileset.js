'use strict';
/**
 * Tile harvesting: build an MBTiles archive from a public tile service.
 *
 * Satellite imagery and terrain come as millions of small tiles rather than
 * one big file, so a "download" here means fetching every tile in a region
 * down to a chosen zoom and packing them into a SQLite database the map
 * reader already understands. It resumes: tiles already in the archive are
 * not fetched twice.
 */

const fsp = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const { PMTiles, decompress } = require('../maps/pmtiles');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const USER_AGENT = 'Vault/0.1 (offline knowledge vault; tile harvest, low rate)';

function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  const merc = Math.log(Math.tan(rad) + 1 / Math.cos(rad));
  return Math.floor(((1 - merc / Math.PI) / 2) * Math.pow(2, z));
}

/** Every tile in the bounds between the two zooms. */
function listTiles(spec) {
  const [west, south, east, north] = spec.bounds || [-180, -85, 180, 85];
  const tiles = [];
  for (let z = spec.minZoom; z <= spec.maxZoom; z++) {
    const span = Math.pow(2, z);
    const x0 = Math.max(0, lonToTileX(west, z));
    const x1 = Math.min(span - 1, lonToTileX(east, z));
    const y0 = Math.max(0, latToTileY(Math.min(85, north), z));
    const y1 = Math.min(span - 1, latToTileY(Math.max(-85, south), z));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([z, x, y]);
  }
  return tiles;
}

function tileCount(spec) {
  return listTiles(spec).length;
}

function tileUrl(spec, z, x, y) {
  return spec.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

/** GET a tile into a buffer. 404/204 mean "no tile here", which is fine. */
function fetchTile(url, signal) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { headers: { 'user-agent': USER_AGENT }, signal }, (res) => {
      const status = res.statusCode || 0;
      if (status === 404 || status === 204) { res.resume(); return resolve(null); }
      if (status !== 200) { res.resume(); return reject(new Error(`HTTP ${status}`)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timed out')));
  });
}

function openArchive(partPath, spec) {
  const db = new DatabaseSync(partPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT);
    CREATE TABLE IF NOT EXISTS tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
    CREATE UNIQUE INDEX IF NOT EXISTS tile_index ON tiles (zoom_level, tile_column, tile_row);
  `);
  const meta = {
    name: spec.name || 'tiles',
    format: spec.format || 'png',
    minzoom: String(spec.minZoom),
    maxzoom: String(spec.maxZoom),
    bounds: (spec.bounds || [-180, -85, 180, 85]).join(','),
    type: spec.type || 'overlay',
    version: '1.1',
    attribution: spec.attribution || '',
    description: spec.description || '',
    ...(spec.encoding ? { encoding: spec.encoding } : {}),
  };
  db.exec('DELETE FROM metadata');
  const insertMeta = db.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(meta)) insertMeta.run(k, v);
  return db;
}

/**
 * The latest planet build Protomaps still has. They keep about a week of
 * daily builds, so a fixed date goes stale; probe back from today.
 */
async function resolveProtomapsUrl(url) {
  const m = /^(https:\/\/build\.protomaps\.com\/)(\d{8})\.pmtiles$/.exec(url);
  if (!m) return url;
  const probe = (u) => new Promise((resolve) => {
    const req = https.request(u, { method: 'HEAD', headers: { 'user-agent': USER_AGENT } }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(15000, () => { req.destroy(); resolve(false); });
    req.end();
  });
  if (await probe(url)) return url;
  for (let back = 0; back < 12; back++) {
    const d = new Date(Date.now() - back * 86400000);
    const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    const candidate = `${m[1]}${stamp}.pmtiles`;
    if (await probe(candidate)) return candidate;
  }
  throw new Error('No recent Protomaps build could be found');
}

/**
 * Pull a region out of a remote PMTiles archive into an MBTiles file. Tiles
 * are located first (directory lookups, cheap), sorted by where they sit in
 * the archive, and read in long contiguous runs — a few hundred big range
 * requests instead of tens of thousands of small ones.
 */
async function runPmtilesExtract(job, spec, db, have, insert) {
  const url = await resolveProtomapsUrl(spec.url);
  const archive = await PMTiles.openRemote(url);
  const tiles = listTiles(spec).filter(([z, x, y]) => !have.has(`${z}/${x}/${Math.pow(2, z) - 1 - y}`));
  job.received = job.total - tiles.length;
  job.resumedFrom = job.received;

  // Locate every tile. Some do not exist (open sea at high zoom): count them done.
  const located = [];
  for (const [z, x, y] of tiles) {
    if (job.controller.signal.aborted) return;
    const where = await archive.locateTile(z, x, y);
    if (!where) { job.received++; continue; }
    located.push({ z, x, y, ...where });
  }
  located.sort((a, b) => a.offset - b.offset);

  // Merge into runs of at most 8 MB, tolerating small gaps between tiles.
  const runs = [];
  for (const t of located) {
    const last = runs[runs.length - 1];
    if (last && t.offset - (last.offset + last.length) <= 65536 && (t.offset + t.length) - last.offset <= 8 * 1024 * 1024) {
      last.length = Math.max(last.length, t.offset + t.length - last.offset);
      last.tiles.push(t);
    } else {
      runs.push({ offset: t.offset, length: t.length, tiles: [t] });
    }
  }

  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    db.exec('BEGIN');
    for (const [z, x, row, data] of pending) insert.run(z, x, row, data);
    db.exec('COMMIT');
    pending = [];
  };
  let index = 0;
  let failures = 0;
  const worker = async () => {
    while (index < runs.length) {
      if (job.controller.signal.aborted) return;
      const run = runs[index++];
      let buffer = null;
      for (let attempt = 1; attempt <= 3 && !buffer; attempt++) {
        try { buffer = await archive.readRange(run.offset, run.length); } catch (err) {
          if (attempt === 3) failures++;
          else await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
      if (!buffer) { job.received += run.tiles.length; continue; }
      for (const t of run.tiles) {
        let data = buffer.subarray(t.offset - run.offset, t.offset - run.offset + t.length);
        // MBTiles convention: vector tiles are gzip-compressed.
        if (t.compression !== 2) data = zlib.gzipSync(decompress(Buffer.from(data), t.compression));
        pending.push([t.z, t.x, Math.pow(2, t.z) - 1 - t.y, Buffer.from(data)]);
        job.received++;
      }
      if (pending.length >= 200) flush();
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  flush();
  if (failures) throw new Error(`${failures} runs of tiles could not be read; run it again to fill the gaps`);
}

/**
 * Harvest a tileset into job.partPath, then rename it into place. Reports
 * progress on the job in tiles rather than bytes. Six fetches in flight at
 * once: quick enough to be useful, polite enough not to be noticed.
 */
async function run(job) {
  if (!DatabaseSync) throw new Error('Tile packs need node:sqlite (Node 22.5 or newer)');
  const spec = job.tileset;
  await fsp.mkdir(job.destDir, { recursive: true });

  const tiles = listTiles(spec);
  job.total = tiles.length;

  const db = openArchive(job.partPath, spec);
  try {
    const have = new Set();
    for (const row of db.prepare('SELECT zoom_level z, tile_column x, tile_row y FROM tiles').all()) {
      have.add(`${row.z}/${row.x}/${row.y}`);
    }
    const insert = db.prepare('INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)');

    if (spec.source === 'pmtiles') {
      await runPmtilesExtract(job, spec, db, have, insert);
      if (job.controller.signal.aborted) return;
      db.close();
      await fsp.rename(job.partPath, job.destPath);
      job.status = 'complete';
      return;
    }

    const todo = tiles.filter(([z, x, y]) => !have.has(`${z}/${x}/${Math.pow(2, z) - 1 - y}`));
    job.received = tiles.length - todo.length;
    job.resumedFrom = job.received;

    let failures = 0;
    let index = 0;
    let pending = [];
    const flush = () => {
      if (!pending.length) return;
      db.exec('BEGIN');
      for (const [z, x, row, data] of pending) insert.run(z, x, row, data);
      db.exec('COMMIT');
      pending = [];
    };

    const worker = async () => {
      while (index < todo.length) {
        if (job.controller.signal.aborted) return;
        const [z, x, y] = todo[index++];
        const url = tileUrl(spec, z, x, y);
        let data = null;
        let ok = false;
        for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
          try {
            data = await fetchTile(url, job.controller.signal);
            ok = true;
          } catch (err) {
            if (job.controller.signal.aborted) return;
            if (attempt === 3) failures++;
            else await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
        }
        if (ok && data && data.length) pending.push([z, x, Math.pow(2, z) - 1 - y, data]);
        job.received++;
        if (pending.length >= 40) flush();
        if (failures > 50 && failures > todo.length * 0.02) throw new Error(`${failures} tiles could not be fetched`);
      }
    };

    await Promise.all(Array.from({ length: spec.concurrency || 6 }, worker));
    flush();

    if (job.controller.signal.aborted) return;
    if (failures) throw new Error(`${failures} tiles could not be fetched; run it again to fill the gaps`);
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }

  if (job.controller.signal.aborted) return;
  await fsp.rename(job.partPath, job.destPath);
  job.status = 'complete';
}

/** Rough size before downloading, for the catalogue. */
function estimateBytes(spec, perTile) {
  return tileCount(spec) * perTile;
}

module.exports = { run, listTiles, tileCount, estimateBytes, resolveProtomapsUrl };
