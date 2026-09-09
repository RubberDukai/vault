'use strict';
/**
 * The library: every ZIM pack on disk, what it is, and when it was cloned.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const { ZimFile } = require('../zim/reader');
const catalog = require('./catalog');

function slugify(name) {
  return name.toLowerCase().replace(/\.zim$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function humanBytes(bytes) {
  if (!bytes || bytes < 0) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

class LibraryManager {
  constructor(libraryDir) {
    this.libraryDir = libraryDir;
    this.packs = new Map();   // id -> descriptor
    this._open = new Map();   // id -> ZimFile
  }

  async scan() {
    await fsp.mkdir(this.libraryDir, { recursive: true });
    const files = (await fsp.readdir(this.libraryDir)).filter((f) => f.toLowerCase().endsWith('.zim'));

    const seen = new Set();
    for (const file of files) {
      const fullPath = path.join(this.libraryDir, file);
      const id = slugify(file);
      seen.add(id);
      if (this.packs.has(id) && this.packs.get(id).ok) continue;

      try {
        const stat = await fsp.stat(fullPath);
        const zim = await ZimFile.open(fullPath);
        const meta = await zim.metadata();
        this._open.set(id, zim);

        this.packs.set(id, {
          id,
          file,
          path: fullPath,
          ok: true,
          title: meta.Title || file.replace(/\.zim$/, ''),
          name: meta.Name || file.replace(/_\d{4}-\d{2}\.zim$/, '').replace(/\.zim$/, ''),
          flavour: meta.Flavour || '',
          description: meta.Description || '',
          language: meta.Language || '',
          creator: meta.Creator || '',
          publisher: meta.Publisher || '',
          /** The day this snapshot of the source was taken. */
          date: meta.Date || null,
          tags: meta.Tags || '',
          entryCount: zim.entryCount,
          articleCount: Number((meta.Counter || '').match(/text\/html[^;]*=(\d+)/)?.[1] || 0) || null,
          size: stat.size,
          sizeHuman: humanBytes(stat.size),
          zimVersion: `${zim.header.majorVersion}.${zim.header.minorVersion}`,
          update: null,
        });
      } catch (err) {
        this.packs.set(id, {
          id, file, path: fullPath, ok: false,
          title: file.replace(/\.zim$/, ''),
          error: err.message,
          size: await fsp.stat(fullPath).then((s) => s.size).catch(() => 0),
        });
      }
    }

    for (const id of [...this.packs.keys()]) {
      if (!seen.has(id)) {
        const zim = this._open.get(id);
        if (zim) { await zim.close().catch(() => {}); this._open.delete(id); }
        this.packs.delete(id);
      }
    }

    return this.list();
  }

  list() {
    return [...this.packs.values()].sort((a, b) => a.title.localeCompare(b.title));
  }

  get(id) {
    return this.packs.get(id) || null;
  }

  zim(id) {
    return this._open.get(id) || null;
  }

  /** How stale is this pack, in days? */
  ageInDays(pack) {
    if (!pack || !pack.date) return null;
    const then = Date.parse(pack.date);
    if (Number.isNaN(then)) return null;
    return Math.floor((Date.now() - then) / 86400000);
  }

  /**
   * Ask the Kiwix catalogue whether anything newer exists. Requires internet;
   * fails soft so the app is never broken by being offline — which is, after
   * all, the condition it is built for.
   */
  async checkUpdates(ids = null) {
    const targets = (ids ? ids.map((id) => this.get(id)) : this.list()).filter((p) => p && p.ok);
    const results = [];

    for (const pack of targets) {
      try {
        const latest = await catalog.findLatest(pack.name, pack.flavour, pack.title);
        if (!latest) {
          pack.update = { checked: new Date().toISOString(), found: false };
          results.push({ id: pack.id, found: false });
          continue;
        }
        const newer = Boolean(latest.date && pack.date && latest.date > pack.date);
        pack.update = {
          checked: new Date().toISOString(),
          found: true,
          available: newer,
          date: latest.date,
          size: latest.size,
          sizeHuman: humanBytes(latest.size),
          url: latest.url,
          filename: latest.filename,
        };
        results.push({ id: pack.id, ...pack.update });
      } catch (err) {
        pack.update = { checked: new Date().toISOString(), error: err.message };
        results.push({ id: pack.id, error: err.message });
      }
    }
    return results;
  }

  async close() {
    for (const zim of this._open.values()) await zim.close().catch(() => {});
    this._open.clear();
  }
}

module.exports = { LibraryManager, humanBytes, slugify };
