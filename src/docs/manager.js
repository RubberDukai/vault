'use strict';
/**
 * Books and documents: PDFs and EPUBs dropped into library/docs.
 *
 * This is the depth layer. The handbook is the quick reference written for
 * this Vault; these are the full works — a textbook, a field manual, a
 * medical reference — indexed so a search across the Vault finds the page.
 *
 * Extracted text is cached under data/docs-cache, keyed by file size and
 * modification time, so a 500-page textbook is parsed once and not on every
 * start.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Epub } = require('./epub');
const { PdfDocument } = require('./pdf');

function slugify(name) {
  return name.toLowerCase().replace(/\.(pdf|epub)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function humanBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function titleFromFilename(file) {
  return file
    .replace(/\.(pdf|epub)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class DocumentManager {
  constructor(docsDir, cacheDir) {
    this.docsDir = docsDir;
    this.cacheDir = cacheDir;
    this.docs = new Map();     // id -> descriptor (with units text)
    this._epubs = new Map();   // id -> open Epub, for serving assets
  }

  async scan() {
    await fsp.mkdir(this.docsDir, { recursive: true });
    await fsp.mkdir(this.cacheDir, { recursive: true });

    const files = (await fsp.readdir(this.docsDir)).filter((f) => /\.(pdf|epub)$/i.test(f));
    const seen = new Set();

    for (const file of files) {
      const id = slugify(file);
      seen.add(id);
      const fullPath = path.join(this.docsDir, file);
      const stat = await fsp.stat(fullPath);
      const stamp = `${stat.size}:${Math.floor(stat.mtimeMs)}`;

      const existing = this.docs.get(id);
      if (existing && existing.stamp === stamp) continue;

      try {
        const doc = await this._load(id, file, fullPath, stat, stamp);
        this.docs.set(id, doc);
      } catch (err) {
        this.docs.set(id, {
          id, file, path: fullPath, ok: false, error: err.message,
          type: path.extname(file).slice(1).toLowerCase(),
          title: titleFromFilename(file), size: stat.size, sizeHuman: humanBytes(stat.size),
          units: [], stamp,
        });
      }
    }

    for (const id of [...this.docs.keys()]) {
      if (!seen.has(id)) {
        const epub = this._epubs.get(id);
        if (epub) { await epub.close().catch(() => {}); this._epubs.delete(id); }
        this.docs.delete(id);
      }
    }

    return this.list();
  }

  async _load(id, file, fullPath, stat, stamp) {
    const type = path.extname(file).slice(1).toLowerCase();
    const cachePath = path.join(this.cacheDir, `${id}.json`);

    // The cache holds everything but the open handle.
    try {
      const cached = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
      if (cached.stamp === stamp) {
        if (type === 'epub') this._epubs.set(id, await Epub.open(fullPath));
        return { ...cached, path: fullPath };
      }
    } catch {
      // no cache, or stale — extract afresh
    }

    let doc;
    if (type === 'epub') {
      const epub = await Epub.open(fullPath);
      this._epubs.set(id, epub);
      const info = epub.describe();
      const units = [];
      for (const chapter of info.chapters) {
        const text = (await epub.chapterText(chapter.index)) || '';
        units.push({ index: chapter.index, title: chapter.title, text });
      }
      doc = {
        id, file, type, ok: true,
        title: info.title || titleFromFilename(file),
        author: info.creator || null,
        language: info.language || null,
        unitLabel: 'chapter',
        units,
        garbled: false,
      };
    } else {
      const pdf = await PdfDocument.open(fullPath);
      const { pages, garbled } = pdf.allText();
      const units = pages.map((text, i) => ({ index: i, title: `Page ${i + 1}`, text }));
      doc = {
        id, file, type, ok: true,
        title: pdf.title || titleFromFilename(file),
        author: pdf.author || null,
        language: null,
        unitLabel: 'page',
        units,
        garbled,
        warnings: pdf.warnings,
      };
    }

    doc.size = stat.size;
    doc.sizeHuman = humanBytes(stat.size);
    doc.words = doc.units.reduce((n, u) => n + u.text.split(/\s+/).filter(Boolean).length, 0);
    doc.stamp = stamp;
    doc.extractedAt = new Date().toISOString();

    await fsp.writeFile(cachePath, JSON.stringify(doc), 'utf8').catch(() => {});
    return { ...doc, path: fullPath };
  }

  /** Listing without the text payload. */
  list() {
    return [...this.docs.values()]
      .map(({ units, path: p, stamp, ...rest }) => ({
        ...rest,
        unitCount: units.length,
        units: undefined,
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  get(id) {
    return this.docs.get(id) || null;
  }

  /** Unit titles only, for a table of contents. */
  outline(id) {
    const doc = this.docs.get(id);
    if (!doc) return null;
    const { units, path: p, stamp, ...rest } = doc;
    return {
      ...rest,
      unitCount: units.length,
      units: units.map((u) => ({ index: u.index, title: u.title, words: u.text.split(/\s+/).filter(Boolean).length })),
    };
  }

  unitText(id, index) {
    const doc = this.docs.get(id);
    if (!doc) return null;
    return doc.units[index] || null;
  }

  async chapterHtml(id, index) {
    const epub = this._epubs.get(id);
    if (!epub) return null;
    return epub.chapterHtml(index);
  }

  async asset(id, zipPath) {
    const epub = this._epubs.get(id);
    if (!epub) return null;
    return epub.asset(zipPath);
  }

  filePath(id) {
    const doc = this.docs.get(id);
    return doc ? doc.path : null;
  }

  /** Documents flattened to searchable units, for the unified index. */
  searchable() {
    const out = [];
    for (const doc of this.docs.values()) {
      if (!doc.ok || doc.garbled) continue;
      for (const unit of doc.units) {
        if (unit.text.trim().length < 40) continue;
        out.push({
          kind: 'document',
          id: `${doc.id}/${unit.index}`,
          title: doc.units.length > 1 ? `${doc.title} — ${unit.title}` : doc.title,
          context: doc.author ? `${doc.author} · ${doc.type.toUpperCase()}` : doc.type.toUpperCase(),
          summary: '',
          href: `#/doc/${doc.id}/${unit.index}`,
          text: `${doc.title} ${unit.title} ${unit.text}`,
        });
      }
    }
    return out;
  }

  async close() {
    for (const epub of this._epubs.values()) await epub.close().catch(() => {});
    this._epubs.clear();
  }
}

module.exports = { DocumentManager };
