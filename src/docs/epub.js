'use strict';
/**
 * EPUB reader.
 *
 * An EPUB is a ZIP containing XHTML chapters and a manifest saying what order
 * they go in. This reads the manifest, walks the spine, and exposes chapters
 * as HTML for the reader and as plain text for search. Images and stylesheets
 * inside the book are served on demand.
 */

const path = require('node:path').posix;
const { ZipFile } = require('./zip');

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** The text between a pair of tags, first occurrence. */
function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'i'));
  return m ? decodeEntities(m[1].replace(/<[^>]+>/g, '').trim()) : null;
}

/** All attributes of every `<tag ...>` in a document. */
function tags(xml, tag) {
  const out = [];
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}\\b([^>]*)/?>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = {};
    const attrRe = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g;
    let a;
    while ((a = attrRe.exec(m[1])) !== null) attrs[a[1] || a[3]] = decodeEntities(a[2] ?? a[4]);
    out.push(attrs);
  }
  return out;
}

/** Reduce an XHTML chapter to plain text, for indexing and snippets. */
function toPlainText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .split('\n').map((l) => decodeEntities(l).trim()).filter(Boolean).join('\n');
}

/** Just the body, for embedding in our own page. */
function bodyOf(html) {
  const m = String(html).match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : String(html);
}

class Epub {
  constructor(zip, filePath) {
    this.zip = zip;
    this.filePath = filePath;
    this.opfPath = null;
    this.opfDir = '';
    this.title = null;
    this.creator = null;
    this.language = null;
    this.manifest = new Map();  // id -> { href, type }
    this.chapters = [];         // [{ index, href, title }]
  }

  static async open(filePath) {
    const zip = await ZipFile.open(filePath);
    const epub = new Epub(zip, filePath);
    try {
      await epub._init();
    } catch (err) {
      await zip.close();
      throw err;
    }
    return epub;
  }

  async close() {
    await this.zip.close();
  }

  async _init() {
    const container = await this.zip.readText('META-INF/container.xml');
    if (!container) throw new Error('Not an EPUB (no META-INF/container.xml)');

    const rootfile = tags(container, 'rootfile').find((r) => r['full-path']);
    if (!rootfile) throw new Error('EPUB container names no root file');
    this.opfPath = rootfile['full-path'];
    this.opfDir = path.dirname(this.opfPath);
    if (this.opfDir === '.') this.opfDir = '';

    const opf = await this.zip.readText(this.opfPath);
    if (!opf) throw new Error(`EPUB root file ${this.opfPath} is missing`);

    this.title = tagText(opf, 'title');
    this.creator = tagText(opf, 'creator');
    this.language = tagText(opf, 'language');

    for (const item of tags(opf, 'item')) {
      if (item.id && item.href) this.manifest.set(item.id, { href: item.href, type: item['media-type'] || '' });
    }

    const spine = tags(opf, 'itemref').map((r) => r.idref).filter(Boolean);
    let index = 0;
    for (const idref of spine) {
      const item = this.manifest.get(idref);
      if (!item || !/html|xml/i.test(item.type)) continue;
      this.chapters.push({ index, href: item.href, title: null });
      index += 1;
    }

    // Section titles. Prefer a heading; fall back to the file's <title> only if
    // it is distinctive (Gutenberg puts the book's name in every file's), and
    // otherwise to the opening words, so a table of contents is still usable
    // for a book that was split by size rather than by chapter.
    const candidates = [];
    for (const chapter of this.chapters) {
      try {
        const html = await this.zip.readText(this._resolve(chapter.href));
        const heading = ['h1', 'h2', 'h3', 'h4'].map((h) => tagText(html, h)).find(Boolean);
        const docTitle = tagText(html, 'title');
        const opening = toPlainText(bodyOf(html)).split('\n').map((l) => l.trim()).find((l) => l.length > 3) || '';
        candidates.push({ chapter, heading, docTitle, opening });
      } catch {
        candidates.push({ chapter, heading: null, docTitle: null, opening: '' });
      }
    }

    const titleCounts = new Map();
    for (const c of candidates) if (c.docTitle) titleCounts.set(c.docTitle, (titleCounts.get(c.docTitle) || 0) + 1);

    const tidy = (s) => String(s).replace(/\s+/g, ' ').replace(/^["'“”]+|["'“”]+$/g, '').trim();

    for (const c of candidates) {
      let title = c.heading;
      if (!title && c.docTitle && titleCounts.get(c.docTitle) === 1) title = c.docTitle;
      if (!title && c.opening) title = c.opening.length > 60 ? `${c.opening.slice(0, 57).trim()}…` : c.opening;
      c.chapter.title = tidy(title || '') || `Section ${c.chapter.index + 1}`;
    }
  }

  _resolve(href) {
    const clean = decodeURIComponent(href.split('#')[0]);
    return this.opfDir ? path.normalize(path.join(this.opfDir, clean)) : path.normalize(clean);
  }

  chapterCount() {
    return this.chapters.length;
  }

  /** A chapter as HTML body, with relative links left for the server to root. */
  async chapterHtml(index) {
    const chapter = this.chapters[index];
    if (!chapter) return null;
    const html = await this.zip.readText(this._resolve(chapter.href));
    if (html === null) return null;
    return { title: chapter.title, href: chapter.href, dir: path.dirname(this._resolve(chapter.href)), html: bodyOf(html) };
  }

  async chapterText(index) {
    const chapter = await this.chapterHtml(index);
    return chapter ? toPlainText(chapter.html) : null;
  }

  /** Any file inside the book — images, stylesheets — by its zip path. */
  async asset(zipPath) {
    const clean = path.normalize(zipPath);
    if (!this.zip.has(clean)) return null;
    const data = await this.zip.read(clean);
    const ext = path.extname(clean).toLowerCase();
    const type = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
      '.svg': 'image/svg+xml', '.webp': 'image/webp', '.css': 'text/css; charset=utf-8',
      '.xhtml': 'application/xhtml+xml', '.html': 'text/html; charset=utf-8',
      '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
    }[ext] || 'application/octet-stream';
    return { data, type };
  }

  describe() {
    return {
      title: this.title,
      creator: this.creator,
      language: this.language,
      chapters: this.chapters.map((c) => ({ index: c.index, title: c.title })),
    };
  }
}

module.exports = { Epub, toPlainText };
