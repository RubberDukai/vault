'use strict';
/**
 * The Ark server.
 *
 * Serves the whole vault over plain HTTP on the local network, so one machine
 * holding the library can feed every phone, tablet and laptop in the house with
 * no internet, no accounts and no installs on the client side.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { URL } = require('node:url');

const { LibraryManager, humanBytes } = require('./library/manager');
const catalog = require('./library/catalog');
const downloads = require('./library/download');
const { ContentLibrary } = require('./content/loader');
const { MapManager } = require('./maps/manager');
const { Elevation } = require('./maps/terrain');
const { PlaceIndex } = require('./maps/places');
const { MediaLibrary } = require('./media');
const { SheetLibrary, exportXlsx, exportCsv } = require('./sheets');
const { DocumentManager } = require('./docs/manager');
const { PackCatalog } = require('./library/packs');
const markdown = require('./content/markdown');
const { UnifiedSearch } = require('./search/unified');
const srs = require('./srs/engine');
const { Store } = require('./store');

const ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const NAMESPACES = new Set(['C', 'A', 'I', 'M', 'W', 'X', '-']);

// What a page taken from a pack or an imported book may do: show itself.
const PACK_CSP = "default-src 'self'; script-src 'none'; object-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'self'; form-action 'none'";

class ArkServer {
  constructor(options = {}) {
    this.port = options.port || 8080;
    // Where to listen. Nothing given: this machine only, unless sharing has
    // been switched on in the interface (kept in data/state.json). An explicit
    // --host always wins.
    this.hostOverride = options.host || null;
    this.host = this.hostOverride || '127.0.0.1';
    this.libraryDir = options.libraryDir || path.join(ROOT, 'library');
    this.contentDir = options.contentDir || path.join(ROOT, 'content');
    this.dataDir = options.dataDir || path.join(ROOT, 'data');
    this.webDir = path.join(ROOT, 'web');

    this.library = new LibraryManager(this.libraryDir, path.join(this.dataDir, 'title-index'));
    this.maps = new MapManager(options.mapsDir || path.join(this.libraryDir, 'maps'));
    this.elevation = new Elevation(this.maps);
    this.places = new PlaceIndex(path.join(this.dataDir, 'places.json'), this.maps);
    this.media = new MediaLibrary(options.mediaDir || path.join(this.libraryDir, 'media'));
    this.sheets = new SheetLibrary(options.sheetsDir || path.join(this.libraryDir, 'sheets'));
    this.documents = new DocumentManager(
      options.docsDir || path.join(this.libraryDir, 'docs'),
      path.join(this.dataDir, 'docs-cache')
    );
    this.content = new ContentLibrary(this.contentDir);
    this.search = new UnifiedSearch();

    this.packs = new PackCatalog({
      manifestPath: path.join(this.contentDir, 'packs.json'),
      rootDir: ROOT,
      dataDir: this.dataDir,
    });

    this.state = new Store(path.join(this.dataDir, 'state.json'), {
      profiles: [{ id: 'default', name: 'Everyone', created: new Date().toISOString() }],
      srs: {},
      school: {},
      bookmarks: [],
      lastUpdateCheck: null,
      // Off by default: the vault answers only this machine until someone
      // turns sharing on in Setup.
      share: false,
      // Whose vault this is, for the footer. Empty in a fresh copy, so a
      // vault handed on does not carry the previous owner's name.
      credit: '',
    });

    // Map annotations live server-side rather than in a browser, so a route
    // drawn on the laptop is visible on everyone else's phone.
    this.annotations = new Store(path.join(this.dataDir, 'map-annotations.json'), {
      layers: [{ id: 'notes', name: 'Notes', colour: '#f85149', visible: true, strokes: [] }],
    });

    this.messages = new Store(path.join(this.dataDir, 'messages.json'), {
      channels: { general: [] },
    });

    // One household calendar, shared by everyone on the network.
    this.calendar = new Store(path.join(this.dataDir, 'calendar.json'), { events: [] });

    // Notebooks: journal pages, recipes and lists, per person, with a flag
    // to share a page with the household.
    this.notebook = new Store(path.join(this.dataDir, 'notebook.json'), { notes: [] });
  }

  async init() {
    await fsp.mkdir(this.dataDir, { recursive: true });
    this.state.load();
    if (!this.hostOverride && this.state.get().share) this.host = '0.0.0.0';
    await this.content.load();
    await this.library.scan();
    await this.maps.scan();

    // Everything authored is searchable at once. Books and title indexes take
    // longer — a shelf of textbooks can be minutes to extract the first time —
    // so they are folded in behind the running server rather than before it.
    this.search.build(this.content, []);
    this.ready = { documents: false, titles: false };
    this._background = (async () => {
      try {
        await this.documents.scan();
        this.search.build(this.content, this.documents.searchable());
      } catch (err) {
        console.error('[vault] document scan failed:', err.message);
      }
      this.ready.documents = true;
      await this.library.buildTitleIndexes().catch(() => {});
      this.ready.titles = true;
      // Place names come from the map packs; index them once, unprompted.
      if (!this.places.status().ready && this.maps.list().some((p) => p.kind === 'vector' && !p.remote)) {
        await this.places.build().catch((err) => console.error('[vault] place index failed:', err.message));
      }
    })();

    // The content catalogue. When a pack lands, fold it into the library at
    // once so the person does not have to restart to see it.
    try {
      this.packs.load();
      this.packs.onInstalled = async (item) => {
        if (item.dest === 'library') {
          await this.library.scan();
          this.library.buildTitleIndexes().catch(() => {});
        } else if (item.dest === 'library/maps') {
          await this.maps.scan();
          this.places.build().catch((err) => console.error('[vault] place index failed:', err.message));
        } else if (item.dest === 'library/docs') {
          await this.documents.scan();
        }
        this.search.build(this.content, this.documents.searchable());
      };
      // Anything queued before the last shutdown carries on where it left off.
      if (this.packs.state.get().queue.length) {
        console.log(`[vault] resuming ${this.packs.state.get().queue.length} queued download(s)`);
        this.packs.run().catch((err) => console.error('[vault] download queue stopped:', err.message));
      }
    } catch (err) {
      console.error('[vault] content catalogue unavailable:', err.message);
    }
    return this;
  }

  async start() {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        console.error('[vault]', err);
        this.json(res, 500, { error: err.message });
      });
    });

    // If the chosen port is taken, walk up rather than failing. Someone
    // double-clicking an icon should not have to think about ports.
    const firstPort = this.port;
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        await new Promise((resolve, reject) => {
          const onError = (err) => { this.server.removeListener('listening', onListening); reject(err); };
          const onListening = () => { this.server.removeListener('error', onError); resolve(); };
          this.server.once('error', onError);
          this.server.once('listening', onListening);
          this.server.listen(this.port, this.host);
        });
        return this.addresses();
      } catch (err) {
        if (err.code !== 'EADDRINUSE') throw err;
        this.port += 1;
      }
    }
    throw new Error(`Could not find a free port between ${firstPort} and ${this.port}.`);
  }

  addresses() {
    const out = [`http://localhost:${this.port}`];
    for (const [, addrs] of Object.entries(os.networkInterfaces())) {
      for (const addr of addrs || []) {
        if (addr.family === 'IPv4' && !addr.internal) out.push(`http://${addr.address}:${this.port}`);
      }
    }
    // Only the local address is reachable while sharing is off.
    return this.sharing() ? out : out.slice(0, 1);
  }

  /** Did this request come from the machine the vault runs on? */
  isLocal(req) {
    const a = req.socket && req.socket.remoteAddress;
    return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  }

  /** A full path for this machine's own browser; a folder name for everyone else. */
  pathFor(req, absolute) {
    if (this.isLocal(req)) return absolute;
    const rel = path.relative(ROOT, absolute);
    return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : path.basename(absolute);
  }

  /** The Host header must name this machine: localhost or a bare IP address. */
  hostAllowed(host) {
    if (!host) return false;
    const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
    if (name === 'localhost' || name === '127.0.0.1' || name === '::1') return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return true;
    if (name.includes(':') && /^[0-9a-f:]+$/.test(name)) return true;
    return false;
  }

  /**
   * A state-changing request must come from the vault's own pages. The
   * client always sends x-vault-client (a cross-site form cannot; a
   * cross-site fetch would need a CORS preflight, which is never granted),
   * and browsers that label the request must label it same-origin.
   */
  sameOrigin(req) {
    if (!req.headers['x-vault-client']) return false;
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return false;
    const origin = req.headers.origin;
    if (origin) {
      try {
        const o = new URL(origin);
        if (!this.hostAllowed(o.host)) return false;
      } catch { return false; }
    }
    return true;
  }

  /** True when other devices on the network can reach the vault. */
  sharing() {
    return this.host !== '127.0.0.1' && this.host !== 'localhost' && this.host !== '::1';
  }

  /**
   * Switch sharing on or off without a restart: drop every connection, then
   * listen again on the same port from the other address. The browser that
   * asked is on localhost, so it reconnects either way.
   */
  async setSharing(on) {
    const host = on ? '0.0.0.0' : '127.0.0.1';
    if (host === this.host) return;
    this.state.update((s) => { s.share = on; });
    await new Promise((resolve) => {
      this.server.closeAllConnections();
      this.server.close(() => resolve());
    });
    this.host = host;
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => { this.server.removeListener('error', reject); resolve(); });
    });
    console.log(`[vault] sharing ${on ? 'on — reachable from the network' : 'off — this machine only'}`);
  }

  async stop() {
    if (this.server) await new Promise((r) => this.server.close(r));
    await this.library.close();
  }

  // ---------------------------------------------------------------- helpers

  json(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
      'cache-control': 'no-store',
    });
    res.end(payload);
  }

  async readRawBody(req, limit = 64 * 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new Error('Upload too large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length === 0) return {};
    // Bodies are capped so a stray upload cannot fill memory, and keys that
    // would rewrite Object.prototype are dropped as they are parsed.
    const raw = Buffer.concat(chunks);
    if (raw.length > 64 * 1024 * 1024) return {};
    try {
      const body = JSON.parse(raw.toString('utf8'), (key, value) => (
        key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value
      ));
      return body && typeof body === 'object' ? body : {};
    } catch {
      return {};
    }
  }

  /**
   * Ids that become object keys. Anything that could reach Object.prototype
   * (__proto__, constructor, prototype) or is not a plain string is refused.
   */
  safeKey(value, fallback = null) {
    if (typeof value !== 'string' || !value || value.length > 200) return fallback;
    if (value === '__proto__' || value === 'constructor' || value === 'prototype') return fallback;
    return value;
  }

  profileFor(id) {
    const data = this.state.get();
    return data.profiles.find((p) => p.id === id) || data.profiles[0];
  }

  // ----------------------------------------------------------------- router

  async handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { pathname = url.pathname; }

    // Belt and braces for a server that may be shared on a wifi: no sniffing
    // of served files, no framing by other sites, and no referrer leaking
    // article titles to anything a pack might link to.
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'SAMEORIGIN');
    res.setHeader('referrer-policy', 'no-referrer');

    // Two doors a web page you happen to visit could otherwise use to reach
    // this server through your own browser: DNS rebinding (its hostname
    // pointed at 127.0.0.1 — the Host header gives it away) and cross-site
    // requests (a form or fetch aimed at /api/… — the browser labels those).
    if (pathname.startsWith('/api/')) {
      if (!this.hostAllowed(req.headers.host)) return this.json(res, 403, { error: 'That name does not belong to this vault' });
      if (req.method !== 'GET' && req.method !== 'HEAD' && !this.sameOrigin(req)) {
        return this.json(res, 403, { error: 'Changes are only accepted from the vault itself' });
      }
    }

    if (pathname.startsWith('/api/')) return this.handleApi(req, res, url, pathname);
    if (pathname.startsWith('/z/')) return this.handleZim(req, res, pathname);
    if (pathname.startsWith('/tile/')) return this.handleTile(req, res, pathname);
    if (pathname.startsWith('/doc/')) return this.handleDoc(req, res, pathname);
    if (pathname.startsWith('/media/')) return this.media.serve(req, res, pathname.slice('/media/'.length));
    return this.handleStatic(req, res, pathname);
  }

  async handleStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = path.resolve(this.webDir, rel);

    if (!target.startsWith(path.resolve(this.webDir))) {
      return this.json(res, 403, { error: 'Forbidden' });
    }

    try {
      const stat = await fsp.stat(target);
      if (stat.isDirectory()) throw new Error('directory');
      const ext = path.extname(target).toLowerCase();
      // The app's own code is served from this machine, so caching it buys
      // nothing and guarantees a stale interface after any update. Only the
      // icons, which never change, are worth caching.
      // "no-cache" still lets a browser reuse a copy from its memory cache
      // within a session, which means an updated app can keep serving the old
      // one. Over a local network the re-fetch is free, so refuse storage
      // outright for code and markup.
      const cacheable = ext === '.ico' || ext === '.png' || ext === '.woff2';
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'content-length': stat.size,
        'cache-control': cacheable ? 'public, max-age=86400' : 'no-store, must-revalidate',
      });
      fs.createReadStream(target).pipe(res);
    } catch {
      // Single-page app: unknown paths fall through to the shell.
      const shell = path.join(this.webDir, 'index.html');
      try {
        const html = await fsp.readFile(shell);
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
        res.end(html);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
      }
    }
  }

  /** Raw pack content: articles, stylesheets, anything stored in the ZIM. */
  async handleZim(req, res, pathname) {
    const rest = pathname.slice('/z/'.length);
    const slash = rest.indexOf('/');
    if (slash === -1) return this.json(res, 400, { error: 'Bad pack path' });

    const packId = rest.slice(0, slash);
    let target = rest.slice(slash + 1);

    const zim = this.library.zim(packId);
    if (!zim) return this.json(res, 404, { error: `No pack "${packId}" in the library` });

    // A leading single-character segment is a ZIM namespace; otherwise assume
    // content. This keeps both ZIM 6 ("C") and older archives working.
    let namespace = 'C';
    const first = target.split('/')[0];
    if (first.length === 1 && NAMESPACES.has(first.toUpperCase())) {
      namespace = first.toUpperCase() === first ? first : first;
      target = target.slice(first.length + 1);
    }

    try {
      let found = await zim.getContent(namespace, target);
      if (!found && namespace === 'C') found = await zim.getContent('A', target);
      if (!found) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><meta charset="utf-8"><style>body{font:15px system-ui;padding:2rem;color:#8b949e;background:#0d1117}</style><p>Not in this pack: <code>${markdown.escapeHtml(target)}</code></p><p>If this is an image, remember you chose the no-pictures build.</p>`);
      }

      const isHtml = (found.mimeType || '').includes('html');
      let body = found.data;

      if (isHtml) {
        // Anchor relative links so nested article names resolve correctly.
        const base = `/z/${packId}/${namespace}/`;
        const injected = `<base href="${base}"><style>html{background:#fff}body{max-width:46rem;margin:0 auto;padding:1rem 1.25rem 4rem;font:16px/1.65 system-ui,-apple-system,Segoe UI,sans-serif}img{max-width:100%;height:auto}</style>`;
        const text = body.toString('utf8');
        body = Buffer.from(
          /<head[^>]*>/i.test(text)
            ? text.replace(/<head([^>]*)>/i, `<head$1>${injected}`)
            : injected + text,
          'utf8'
        );
      }

      const headers = {
        'content-type': found.mimeType || 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'public, max-age=86400',
      };
      // Pack HTML is someone else's code: no scripts, nothing fetched from
      // outside this server, never framed by another site.
      if (isHtml) headers['content-security-policy'] = PACK_CSP;
      res.writeHead(200, headers);
      res.end(body);
    } catch (err) {
      this.json(res, 500, { error: err.message });
    }
  }

  /**
   * Map tiles: /tile/<packId>/<z>/<x>/<y>
   *
   * Vector packs come back as decoded JSON so the browser needs no protobuf
   * handling; raster packs are passed straight through as images.
   */
  async handleTile(req, res, pathname) {
    const parts = pathname.slice('/tile/'.length).split('/');
    if (parts.length < 4) return this.json(res, 400, { error: 'Bad tile path' });

    const [packId, zStr, xStr, yRaw] = parts;
    const z = Number(zStr);
    const x = Number(xStr);
    const y = Number(String(yRaw).replace(/\.(png|jpg|pbf|json)$/i, ''));

    if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
      return this.json(res, 400, { error: 'Tile coordinates must be integers' });
    }

    const pack = this.maps.get(packId);
    if (!pack || pack.ok === false) return this.json(res, 404, { error: 'No such map pack' });

    try {
      if (pack.kind === 'vector') {
        const tile = await this.maps.vectorTile(packId, z, x, y);
        const payload = JSON.stringify(tile || {});
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(payload),
          'cache-control': 'public, max-age=86400',
        });
        return res.end(payload);
      }

      const raw = await this.maps.rawTile(packId, z, x, y);
      if (!raw) {
        res.writeHead(204, { 'cache-control': 'public, max-age=3600' });
        return res.end();
      }
      const imageType = pack.tileFormat === 'jpg' || pack.tileFormat === 'jpeg' ? 'jpeg'
        : pack.tileFormat === 'webp' ? 'webp' : 'png';
      res.writeHead(200, {
        'content-type': `image/${imageType}`,
        'content-length': raw.length,
        'cache-control': 'public, max-age=86400',
      });
      return res.end(raw);
    } catch (err) {
      return this.json(res, 500, { error: err.message });
    }
  }

  /**
   * Documents: /doc/<id>/file          the PDF itself, for the browser's viewer
   *            /doc/<id>/chapter/<n>   an EPUB chapter as a standalone page
   *            /doc/<id>/asset/<path>  an image or stylesheet inside an EPUB
   */
  async handleDoc(req, res, pathname) {
    const parts = pathname.slice('/doc/'.length).split('/');
    const [docId, action, ...rest] = parts;
    const doc = this.documents.get(docId);
    if (!doc || doc.ok === false) return this.json(res, 404, { error: 'No such document' });

    try {
      if (action === 'file') {
        const filePath = this.documents.filePath(docId);
        const stat = await fsp.stat(filePath);
        const type = doc.type === 'pdf' ? 'application/pdf' : 'application/epub+zip';

        // Range support lets the browser's PDF viewer jump around a big file.
        const range = req.headers.range && req.headers.range.match(/bytes=(\d*)-(\d*)/);
        if (range) {
          // A suffix range (bytes=-500) means the last 500 bytes; anything
          // outside the file is answered with 416, never handed to the stream,
          // which would throw and take the process down with it.
          let start = range[1] ? Number(range[1]) : (range[2] ? Math.max(0, stat.size - Number(range[2])) : 0);
          let end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
          if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
            res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
            return res.end();
          }
          res.writeHead(206, {
            'content-type': type,
            'content-range': `bytes ${start}-${end}/${stat.size}`,
            'content-length': end - start + 1,
            'accept-ranges': 'bytes',
          });
          return fs.createReadStream(filePath, { start, end }).pipe(res);
        }

        res.writeHead(200, {
          'content-type': type,
          'content-length': stat.size,
          'accept-ranges': 'bytes',
          'content-disposition': `inline; filename="${encodeURIComponent(doc.file)}"`,
        });
        return fs.createReadStream(filePath).pipe(res);
      }

      // The text of one page, as a light page of its own. Phones cannot show a
      // PDF inline and would otherwise download the whole book to read a page.
      if (action === 'page') {
        const unit = this.documents.unitText(docId, Number(rest[0]));
        if (!unit) return this.json(res, 404, { error: 'No such page' });
        const paragraphs = String(unit.text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
          .map((p) => `<p>${markdown.escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
        const page = `<!doctype html><html><head><meta charset="utf-8">` +
          `<meta name="viewport" content="width=device-width, initial-scale=1">` +
          `<style>body{max-width:44rem;margin:0 auto;padding:1.5rem 1.25rem 4rem;font:17px/1.7 Georgia,serif;color:#1a1a1a;background:#fbf8f2}` +
          `p{margin:0 0 1em}.faint{color:#777;font-size:13px}</style>` +
          `<title>${markdown.escapeHtml(unit.title || doc.title)}</title></head><body>` +
          `<p class="faint">${markdown.escapeHtml(doc.title)} · ${markdown.escapeHtml(unit.title || '')} · text only; figures and tables are in the PDF</p>` +
          (paragraphs || '<p class="faint">This page has no text — it is probably a figure or a blank.</p>') + `</body></html>`;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': PACK_CSP });
        return res.end(page);
      }

      if (action === 'chapter') {
        const chapter = await this.documents.chapterHtml(docId, Number(rest[0]));
        if (!chapter) return this.json(res, 404, { error: 'No such chapter' });
        const base = `/doc/${encodeURIComponent(docId)}/asset/${chapter.dir === '.' ? '' : chapter.dir + '/'}`;
        const page = `<!doctype html><html><head><meta charset="utf-8"><base href="${base}">` +
          `<meta name="viewport" content="width=device-width, initial-scale=1">` +
          `<style>body{max-width:44rem;margin:0 auto;padding:1.5rem 1.25rem 4rem;font:17px/1.7 Georgia,serif;color:#1a1a1a;background:#fbf8f2}` +
          `img{max-width:100%;height:auto}h1,h2,h3{line-height:1.25}</style>` +
          `<title>${markdown.escapeHtml(chapter.title || doc.title)}</title></head><body>${chapter.html}</body></html>`;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': PACK_CSP });
        return res.end(page);
      }

      if (action === 'asset') {
        const asset = await this.documents.asset(docId, rest.map(decodeURIComponent).join('/'));
        if (!asset) {
          res.writeHead(404, { 'content-type': 'text/plain' });
          return res.end('Not in this book');
        }
        res.writeHead(200, { 'content-type': asset.type, 'content-length': asset.data.length, 'cache-control': 'public, max-age=86400' });
        return res.end(asset.data);
      }

      return this.json(res, 404, { error: 'Unknown document action' });
    } catch (err) {
      return this.json(res, 500, { error: err.message });
    }
  }

  // -------------------------------------------------------------------- api

  async handleApi(req, res, url, pathname) {
    const route = pathname.slice('/api/'.length);
    const q = url.searchParams;
    const method = req.method.toUpperCase();

    // --- status -----------------------------------------------------------
    // --- sharing on the local network -------------------------------------
    if (route === 'network' && method === 'GET') {
      return this.json(res, 200, {
        sharing: this.sharing(),
        locked: Boolean(this.hostOverride),
        port: this.port,
        addresses: this.addresses(),
        // Every address the machine has, so the page can say what would
        // become reachable before the switch is flipped.
        interfaces: Object.entries(os.networkInterfaces()).flatMap(([name, addrs]) => (addrs || [])
          .filter((a) => a.family === 'IPv4' && !a.internal)
          .map((a) => ({ name, address: a.address }))),
      });
    }

    if (route === 'settings' && method === 'POST') {
      const body = await this.readBody(req);
      if (typeof body.credit === 'string') this.state.update((s) => { s.credit = body.credit.trim().slice(0, 120); });
      return this.json(res, 200, { credit: this.state.get().credit || '' });
    }

    if (route === 'network/share' && method === 'POST') {
      if (this.hostOverride) return this.json(res, 400, { error: 'The address was fixed on the command line (--host); it cannot be changed here.' });
      const body = await this.readBody(req);
      const on = Boolean(body.on);
      // Answer first: switching drops every open connection, this one included.
      res.on('finish', () => setTimeout(() => {
        this.setSharing(on).catch((err) => console.error('[vault] sharing switch failed:', err.message));
      }, 100));
      return this.json(res, 200, { sharing: on, port: this.port });
    }

    if (route === 'status') {
      const packs = this.library.list();
      return this.json(res, 200, {
        name: 'Vault',
        version: require('../package.json').version,
        // Machine details and folder paths stay on the machine: a phone on the
        // wifi gets a name to look for, not this computer's username.
        node: this.isLocal(req) ? process.version : null,
        platform: this.isLocal(req) ? `${os.type()} ${os.release()}` : null,
        addresses: this.addresses(),
        libraryDir: this.pathFor(req, this.libraryDir),
        credit: this.state.get().credit || '',
        packs: packs.length,
        packsOk: packs.filter((p) => p.ok).length,
        librarySize: humanBytes(packs.reduce((n, p) => n + (p.size || 0), 0)),
        content: this.content.stats(),
        profiles: this.state.get().profiles,
        lastUpdateCheck: this.state.get().lastUpdateCheck,
      });
    }

    // --- library ----------------------------------------------------------
    if (route === 'library') {
      return this.json(res, 200, {
        packs: this.library.list().map((p) => ({ ...p, ageDays: this.library.ageInDays(p) })),
      });
    }

    if (route === 'library/scan' && method === 'POST') {
      await this.library.scan();
      return this.json(res, 200, { packs: this.library.list() });
    }

    if (route === 'library/check-updates' && method === 'POST') {
      const body = await this.readBody(req);
      const online = await catalog.isOnline();
      if (!online) {
        return this.json(res, 200, { online: false, results: [], message: 'No connection to the catalogue. You are offline — which is the point.' });
      }
      const results = await this.library.checkUpdates(body.ids || null);
      this.state.update((d) => { d.lastUpdateCheck = new Date().toISOString(); });
      return this.json(res, 200, { online: true, results, checked: this.state.get().lastUpdateCheck });
    }

    if (route.startsWith('library/') && method === 'GET') {
      const pack = this.library.get(route.slice('library/'.length));
      if (!pack) return this.json(res, 404, { error: 'No such pack' });
      return this.json(res, 200, { ...pack, ageDays: this.library.ageInDays(pack) });
    }

    // --- maps -------------------------------------------------------------
    if (route === 'maps') {
      return this.json(res, 200, {
        packs: this.maps.list(),
        categories: this.maps.categories(),
        mapsDir: this.pathFor(req, this.maps.mapsDir),
      });
    }

    if (route === 'maps/scan' && method === 'POST') {
      await this.maps.scan();
      return this.json(res, 200, { packs: this.maps.list() });
    }

    // --- place names ------------------------------------------------------
    // Built from the names inside the installed vector packs; nothing is
    // fetched. Until the index exists a search just says so.
    if (route === 'maps/places' && method === 'GET') {
      const query = (q.get('q') || '').trim();
      const nearParts = (q.get('near') || '').split(',').map(Number);
      const near = nearParts.length === 2 && nearParts.every(Number.isFinite) ? { lat: nearParts[0], lon: nearParts[1] } : null;
      return this.json(res, 200, { ...this.places.status(), results: query ? this.places.search(query, Number(q.get('limit') || 12), near) : [] });
    }

    if (route === 'maps/places/build' && method === 'POST') {
      // Long enough that the client should not wait on it; it polls the status.
      this.places.build().catch((err) => console.error('Place index:', err.message));
      return this.json(res, 200, this.places.status());
    }

    // --- terrain ----------------------------------------------------------
    // Heights come from terrain packs (Setup → Satellite & terrain). With
    // none installed for the area the answer is null, never a guess.
    if (route === 'elevation' && method === 'GET') {
      const lat = Number(q.get('lat'));
      const lon = Number(q.get('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return this.json(res, 400, { error: 'lat and lon are needed' });
      return this.json(res, 200, { elevation: await this.elevation.at(lon, lat) });
    }

    if (route === 'elevation/profile' && method === 'POST') {
      const body = await this.readBody(req);
      const points = Array.isArray(body.points) ? body.points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(0, 500) : [];
      if (points.length < 1) return this.json(res, 400, { error: 'A profile needs points' });
      return this.json(res, 200, await this.elevation.profile(points));
    }

    // --- map annotations --------------------------------------------------
    // Drawings are stored as longitude/latitude, not screen pixels, so they
    // stay put at every zoom level and on every device.
    if (route === 'maps/annotations' && method === 'GET') {
      return this.json(res, 200, this.annotations.get());
    }

    if (route === 'maps/annotations/layers' && method === 'POST') {
      const body = await this.readBody(req);
      const name = (body.name || '').trim() || 'Untitled layer';
      const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'layer'}-${Date.now().toString(36)}`;
      this.annotations.update((d) => {
        d.layers.push({ id, name, colour: body.colour || '#f85149', visible: true, strokes: [] });
      });
      return this.json(res, 200, { id, layers: this.annotations.get().layers });
    }

    if (route.startsWith('maps/annotations/layers/') && method === 'DELETE') {
      const id = route.slice('maps/annotations/layers/'.length);
      this.annotations.update((d) => { d.layers = d.layers.filter((l) => l.id !== id); });
      return this.json(res, 200, { layers: this.annotations.get().layers });
    }

    if (route === 'maps/annotations/strokes' && method === 'POST') {
      const body = await this.readBody(req);
      const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      let stroke;

      if (body.type === 'pin') {
        if (!Number.isFinite(body.lon) || !Number.isFinite(body.lat)) {
          return this.json(res, 400, { error: 'A pin needs a position' });
        }
        stroke = {
          id, type: 'pin',
          lon: body.lon, lat: body.lat,
          label: String(body.label || '').slice(0, 80),
          colour: body.colour || '#f85149',
        };
      } else if (body.type === 'route') {
        // A planned route: named nodes in order, with the leg figures kept
        // so the plan reads the same on a machine without the map maths.
        const points = Array.isArray(body.points) ? body.points.filter((p) => Array.isArray(p) && p.length === 2) : [];
        if (points.length < 2) return this.json(res, 400, { error: 'A route needs at least two nodes' });
        stroke = {
          id, type: 'route',
          name: String(body.name || '').slice(0, 80),
          colour: body.colour || '#f85149',
          width: Number(body.width) || 3,
          points,
          legs: Array.isArray(body.legs) ? body.legs.slice(0, points.length) : undefined,
          length: Number.isFinite(body.length) ? Math.round(body.length) : undefined,
        };
      } else {
        if (!Array.isArray(body.points) || body.points.length < 1) {
          return this.json(res, 400, { error: 'A stroke needs points' });
        }
        stroke = {
          id,
          colour: body.colour || '#f85149',
          width: Number(body.width) || 3,
          points: body.points,
          length: Number.isFinite(body.length) ? Math.round(body.length) : undefined,
        };
      }
      let ok = false;
      this.annotations.update((d) => {
        const layer = d.layers.find((l) => l.id === body.layerId) || d.layers[0];
        if (layer) { layer.strokes.push(stroke); ok = true; }
      });
      return this.json(res, ok ? 200 : 404, ok ? { stroke } : { error: 'No such layer' });
    }

    if (route === 'maps/annotations/strokes/delete' && method === 'POST') {
      const body = await this.readBody(req);
      const ids = new Set(body.strokeIds || []);
      this.annotations.update((d) => {
        for (const layer of d.layers) layer.strokes = layer.strokes.filter((s) => !ids.has(s.id));
      });
      return this.json(res, 200, { removed: ids.size });
    }

    // --- calendar ---------------------------------------------------------
    // Events are plain dates with an optional repeat; the client works out
    // which days they land on, along with the sun and moon for each day.
    if (route === 'calendar' && method === 'GET') {
      return this.json(res, 200, { events: this.calendar.get().events });
    }

    if (route === 'calendar' && method === 'POST') {
      const body = await this.readBody(req);
      const title = String(body.title || '').trim().slice(0, 120);
      const date = String(body.date || '');
      if (!title) return this.json(res, 400, { error: 'An event needs a title' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return this.json(res, 400, { error: 'Date must be YYYY-MM-DD' });
      const repeats = ['none', 'weekly', 'monthly', 'yearly'];
      const event = {
        id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        title,
        date,
        time: /^\d{2}:\d{2}$/.test(String(body.time || '')) ? body.time : '',
        repeat: repeats.includes(body.repeat) ? body.repeat : 'none',
        notes: String(body.notes || '').trim().slice(0, 2000),
        colour: /^#[0-9a-f]{6}$/i.test(String(body.colour || '')) ? body.colour : '',
        by: String(body.by || '').slice(0, 60),
        created: new Date().toISOString(),
      };
      this.calendar.update((d) => { d.events.push(event); });
      return this.json(res, 200, { event });
    }

    if (route.startsWith('calendar/') && method === 'DELETE') {
      const id = route.slice('calendar/'.length);
      let removed = 0;
      this.calendar.update((d) => {
        const before = d.events.length;
        d.events = d.events.filter((e) => e.id !== id);
        removed = before - d.events.length;
      });
      return this.json(res, removed ? 200 : 404, removed ? { removed } : { error: 'No such event' });
    }

    // --- notebook ---------------------------------------------------------
    if (route === 'notebook' && method === 'GET') {
      const profileId = this.safeKey(q.get('profile'), 'default');
      const notes = this.notebook.get().notes.filter((n) => n.profile === profileId || n.shared);
      return this.json(res, 200, {
        notes,
        recipes: (this.content.recipes || []).map(({ body, plain, ...rest }) => ({ ...rest, html: markdown.render(body) })),
      });
    }

    if (route === 'notebook' && method === 'POST') {
      const body = await this.readBody(req);
      const kinds = ['note', 'recipe', 'list'];
      const now = new Date().toISOString();
      let saved = null;
      this.notebook.update((d) => {
        const existing = body.id ? d.notes.find((n) => n.id === body.id) : null;
        const note = existing || {
          id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          profile: String(body.profile || 'default'),
          created: now,
        };
        note.kind = kinds.includes(body.kind) ? body.kind : (note.kind || 'note');
        note.title = String(body.title ?? note.title ?? '').slice(0, 200);
        note.body = String(body.body ?? note.body ?? '').slice(0, 200000);
        note.items = Array.isArray(body.items)
          ? body.items.slice(0, 500).map((i) => ({ text: String(i.text || '').slice(0, 500), done: Boolean(i.done) }))
          : (note.items || []);
        note.shared = Boolean(body.shared ?? note.shared);
        note.updated = now;
        if (!existing) d.notes.push(note);
        saved = note;
      });
      return this.json(res, 200, { note: saved });
    }

    if (route.startsWith('notebook/') && method === 'DELETE') {
      const id = route.slice('notebook/'.length);
      let removed = 0;
      this.notebook.update((d) => {
        const before = d.notes.length;
        d.notes = d.notes.filter((n) => n.id !== id);
        removed = before - d.notes.length;
      });
      return this.json(res, removed ? 200 : 404, removed ? { removed } : { error: 'No such page' });
    }

    // --- spreadsheets -----------------------------------------------------
    if (route === 'sheets' && method === 'GET') {
      return this.json(res, 200, await this.sheets.list());
    }

    if (route === 'sheets' && method === 'POST') {
      const body = await this.readBody(req);
      if (!body || !Array.isArray(body.sheets)) return this.json(res, 400, { error: 'A workbook needs sheets' });
      const saved = await this.sheets.save({
        id: body.id || undefined,
        name: String(body.name || 'Untitled').slice(0, 120),
        active: Number(body.active) || 0,
        sheets: body.sheets.slice(0, 50).map((sh) => ({
          name: String(sh.name || 'Sheet').slice(0, 31),
          cells: sh.cells && typeof sh.cells === 'object' ? sh.cells : {},
          cols: sh.cols && typeof sh.cols === 'object' ? sh.cols : {},
          freeze: sh.freeze ? Number(sh.freeze) : 0,
          charts: Array.isArray(sh.charts) ? sh.charts.slice(0, 40).map((c) => ({
            id: String(c.id || '').slice(0, 20),
            type: ['bar', 'line', 'pie'].includes(c.type) ? c.type : 'bar',
            range: String(c.range || 'A1').slice(0, 24),
            title: String(c.title || '').slice(0, 120),
            x: Number(c.x) || 0, y: Number(c.y) || 0, w: Number(c.w) || 420, h: Number(c.h) || 260,
          })) : [],
        })),
      });
      return this.json(res, 200, { workbook: saved });
    }

    if (route === 'sheets/import' && method === 'POST') {
      const filename = q.get('filename') || '';
      const file = q.get('file') || '';
      try {
        const saved = file
          ? await this.sheets.import({ file })
          : await this.sheets.import({ buffer: await this.readRawBody(req), filename });
        return this.json(res, 200, { workbook: saved });
      } catch (err) {
        return this.json(res, 400, { error: `Could not import: ${err.message}` });
      }
    }

    if (route.startsWith('sheets/') && route.endsWith('/export') && method === 'GET') {
      const id = route.slice('sheets/'.length, -'/export'.length);
      let workbook;
      try { workbook = await this.sheets.get(id); } catch { return this.json(res, 404, { error: 'No such workbook' }); }
      const format = q.get('format') === 'csv' ? 'csv' : 'xlsx';
      const safeName = String(workbook.name || 'workbook').replace(/[^\w\- ]+/g, '').trim() || 'workbook';
      if (format === 'csv') {
        const sheet = workbook.sheets[Number(q.get('sheet')) || 0] || workbook.sheets[0];
        const csv = exportCsv(sheet);
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${safeName} - ${sheet.name}.csv"` });
        return res.end(csv);
      }
      const buf = exportXlsx(workbook);
      res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-length': buf.length, 'content-disposition': `attachment; filename="${safeName}.xlsx"` });
      return res.end(buf);
    }

    if (route.startsWith('sheets/') && method === 'GET') {
      try {
        return this.json(res, 200, { workbook: await this.sheets.get(route.slice('sheets/'.length)) });
      } catch {
        return this.json(res, 404, { error: 'No such workbook' });
      }
    }

    if (route.startsWith('sheets/') && method === 'DELETE') {
      try { await this.sheets.remove(route.slice('sheets/'.length)); return this.json(res, 200, { removed: 1 }); }
      catch { return this.json(res, 404, { error: 'No such workbook' }); }
    }

    // --- media ------------------------------------------------------------
    if (route === 'media' && method === 'GET') {
      return this.json(res, 200, { files: await this.media.list(), dir: this.media.dir });
    }

    // --- outpost comms ----------------------------------------------------
    if (route === 'comms' && method === 'GET') {
      const channel = q.get('channel') || 'general';
      const since = Number(q.get('since') || 0);
      const all = this.messages.get().channels[channel] || [];
      return this.json(res, 200, {
        channel,
        channels: Object.keys(this.messages.get().channels),
        messages: since ? all.filter((m) => m.at > since) : all.slice(-200),
        now: Date.now(),
      });
    }

    if (route === 'comms' && method === 'POST') {
      const body = await this.readBody(req);
      const text = String(body.text || '').trim();
      if (!text) return this.json(res, 400, { error: 'Empty message' });

      const channel = this.safeKey((body.channel || 'general').toLowerCase().replace(/[^a-z0-9-]/g, ''), 'general') || 'general';
      const message = {
        id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        author: String(body.author || 'anonymous').slice(0, 40),
        text: text.slice(0, 2000),
        at: Date.now(),
      };

      this.messages.update((d) => {
        if (!d.channels[channel]) d.channels[channel] = [];
        d.channels[channel].push(message);
        // Bound the log so the file cannot grow without limit on a small disk.
        if (d.channels[channel].length > 2000) {
          d.channels[channel] = d.channels[channel].slice(-2000);
        }
      });
      return this.json(res, 200, { message });
    }

    if (route === 'comms/channels' && method === 'POST') {
      const body = await this.readBody(req);
      const name = this.safeKey(String(body.name || '').toLowerCase().replace(/[^a-z0-9-]/g, ''), '');
      if (!name) return this.json(res, 400, { error: 'Bad channel name' });
      this.messages.update((d) => { if (!d.channels[name]) d.channels[name] = []; });
      return this.json(res, 200, { channels: Object.keys(this.messages.get().channels) });
    }

    // --- documents --------------------------------------------------------
    if (route === 'docs' && method === 'GET') {
      return this.json(res, 200, {
        docs: this.documents.list(),
        docsDir: this.pathFor(req, this.documents.docsDir),
        indexing: this.ready ? !this.ready.documents : false,
      });
    }

    if (route === 'docs/scan' && method === 'POST') {
      await this.documents.scan();
      this.search.build(this.content, this.documents.searchable());
      return this.json(res, 200, { docs: this.documents.list() });
    }

    if (route.startsWith('docs/')) {
      const [docId, sub, unitStr] = route.slice('docs/'.length).split('/');
      if (sub === 'unit') {
        const unit = this.documents.unitText(docId, Number(unitStr));
        if (!unit) return this.json(res, 404, { error: 'No such section' });
        return this.json(res, 200, unit);
      }
      const outline = this.documents.outline(docId);
      if (!outline) return this.json(res, 404, { error: 'No such document' });
      return this.json(res, 200, outline);
    }

    // --- setup: the content catalogue and its queue -----------------------
    if (route === 'setup' && method === 'GET') {
      const status = this.packs.status();
      status.diskFree = await this.packs.diskFree();
      status.diskFreeHuman = status.diskFree === null ? null : humanBytes(status.diskFree);
      return this.json(res, 200, status);
    }

    if (route === 'setup/install' && method === 'POST') {
      const body = await this.readBody(req);
      const added = body.bundle
        ? this.packs.enqueueBundle(body.bundle)
        : this.packs.enqueue(Array.isArray(body.ids) ? body.ids : []);
      return this.json(res, 200, { added, queue: this.packs.state.get().queue });
    }

    if (route === 'setup/cancel' && method === 'POST') {
      const body = await this.readBody(req);
      if (body.id) this.packs.dequeue(body.id);
      else this.packs.clear();
      return this.json(res, 200, { queue: this.packs.state.get().queue });
    }

    // --- catalogue + downloads -------------------------------------------
    if (route === 'catalog/search') {
      try {
        const entries = await catalog.search(q.get('q') || 'wikipedia', { count: 40 });
        return this.json(res, 200, {
          online: true,
          entries: entries.map((e) => ({ ...e, sizeHuman: humanBytes(e.size) })),
        });
      } catch (err) {
        return this.json(res, 200, { online: false, entries: [], error: err.message });
      }
    }

    if (route === 'downloads' && method === 'GET') {
      return this.json(res, 200, { jobs: downloads.list() });
    }

    if (route === 'downloads' && method === 'POST') {
      const body = await this.readBody(req);
      if (!body.url) return this.json(res, 400, { error: 'A url is required' });
      // Only the catalogue's own hosts, only https, and only a plain .zim
      // filename that stays inside the library folder.
      if (!downloads.allowedUrl(body.url)) return this.json(res, 400, { error: 'Downloads are only accepted from the Kiwix library' });
      const filename = path.basename(String(body.filename || body.url.split('/').pop() || ''));
      if (!/^[\w][\w .()+-]*\.zim$/i.test(filename) || filename.includes('..')) return this.json(res, 400, { error: 'That is not a pack filename' });
      const job = downloads.start({
        url: body.url,
        destDir: this.libraryDir,
        filename,
        id: typeof body.id === 'string' ? body.id.slice(0, 120) : undefined,
      });
      return this.json(res, 200, { job });
    }

    if (route.startsWith('downloads/') && method === 'DELETE') {
      const cancelled = downloads.cancel(route.slice('downloads/'.length));
      return this.json(res, 200, { cancelled });
    }

    // --- packs: search + read --------------------------------------------
    if (route.startsWith('packs/')) {
      const rest = route.slice('packs/'.length);
      const [packId, action] = [rest.slice(0, rest.indexOf('/')), rest.slice(rest.indexOf('/') + 1)];
      const zim = this.library.zim(packId);
      if (!zim) return this.json(res, 404, { error: 'No such pack' });

      if (action === 'search') {
        const query = q.get('q') || '';
        const results = await zim.findTitles(query, 30);
        return this.json(res, 200, { packId, query, results });
      }

      if (action === 'random') {
        const count = await zim.titleCount();
        for (let attempt = 0; attempt < 20; attempt++) {
          const entry = await zim.entryByTitlePosition(Math.floor(Math.random() * count));
          if (entry && (entry.namespace === 'C' || entry.namespace === 'A') && !entry.isRedirect) {
            return this.json(res, 200, { packId, title: entry.title, url: entry.url });
          }
        }
        return this.json(res, 404, { error: 'Could not find a random article' });
      }

      if (action === 'main') {
        const entry = await zim.mainPageEntry();
        if (!entry) return this.json(res, 404, { error: 'This pack has no main page' });
        return this.json(res, 200, { packId, title: entry.title, url: entry.url });
      }
    }

    // --- handbook ---------------------------------------------------------
    if (route === 'handbook') {
      return this.json(res, 200, {
        modules: this.content.handbook.map((m) => ({
          ...m,
          chapters: m.chapters.map(({ body, plain, ...rest }) => rest),
        })),
      });
    }

    if (route.startsWith('handbook/')) {
      const chapter = this.content.chapter(route.slice('handbook/'.length));
      if (!chapter) return this.json(res, 404, { error: 'No such chapter' });
      const { body, plain, ...meta } = chapter;
      return this.json(res, 200, { ...meta, html: markdown.render(body) });
    }

    // --- manual -----------------------------------------------------------
    if (route === 'manual') {
      return this.json(res, 200, {
        pages: this.content.manual.map(({ body, plain, ...rest }) => rest),
      });
    }

    if (route.startsWith('manual/')) {
      const page = this.content.manualPage(route.slice('manual/'.length));
      if (!page) return this.json(res, 404, { error: 'No such page' });
      const { body, plain, ...meta } = page;
      return this.json(res, 200, { ...meta, html: markdown.render(body) });
    }

    // --- school -----------------------------------------------------------
    if (route === 'school') {
      const profileId = this.safeKey(q.get('profile'), 'default');
      const progress = this.state.get().school[profileId] || {};
      return this.json(res, 200, {
        profileId,
        subjects: this.content.education.map((s) => ({
          ...s,
          lessons: s.lessons.map(({ body, plain, ...rest }) => ({
            ...rest,
            done: Boolean(progress[rest.id]?.completed),
          })),
        })),
      });
    }

    if (route === 'school/progress' && method === 'POST') {
      const body = await this.readBody(req);
      const profileId = this.safeKey(body.profile, 'default');
      const lessonId = this.safeKey(body.lessonId);
      if (!lessonId) return this.json(res, 400, { error: 'A lesson id is needed' });
      this.state.update((d) => {
        d.school[profileId] = d.school[profileId] || {};
        d.school[profileId][lessonId] = {
          completed: Boolean(body.completed),
          at: new Date().toISOString(),
        };
      });
      return this.json(res, 200, { ok: true });
    }

    if (route.startsWith('school/')) {
      const lesson = this.content.lesson(route.slice('school/'.length));
      if (!lesson) return this.json(res, 404, { error: 'No such lesson' });
      const { body, plain, ...meta } = lesson;
      return this.json(res, 200, { ...meta, html: markdown.render(body) });
    }

    // --- languages + spaced repetition ------------------------------------
    if (route.startsWith('languages/') && route.endsWith('/guide')) {
      const langId = route.slice('languages/'.length, -'/guide'.length);
      const lang = this.content.languages.find((l) => l.id === langId);
      if (!lang || !lang.guide) return this.json(res, 404, { error: 'No guide for that language' });
      return this.json(res, 200, {
        language: lang.name,
        title: lang.guide.title,
        html: markdown.render(lang.guide.body),
      });
    }

    if (route === 'languages') {
      const profileId = this.safeKey(q.get('profile'), 'default');
      const states = this.state.get().srs[profileId] || {};
      return this.json(res, 200, {
        profileId,
        languages: this.content.languages.map((lang) => ({
          ...lang,
          guide: lang.guide ? { title: lang.guide.title } : null,
          decks: lang.decks.map((deck) => ({
            id: deck.id,
            slug: deck.slug,
            title: deck.title,
            description: deck.description,
            cardCount: deck.cards.length,
            stats: srs.summarise(deck.cards, states),
          })),
          stats: srs.summarise(this.content.allCards(lang.id), states),
        })),
      });
    }

    if (route === 'srs/queue') {
      const profileId = this.safeKey(q.get('profile'), 'default');
      const states = this.state.get().srs[profileId] || {};
      const deckId = q.get('deck');
      const deck = deckId ? this.content.deck(deckId) : null;
      const cards = deckId
        ? (deck?.cards || []).map((c) => ({ ...c, deckTitle: deck.title, language: deck.language }))
        : this.content.allCards(q.get('language') || null);
      const queue = srs.buildQueue(cards, states, {
        limit: Number(q.get('limit') || 30),
        newLimit: Number(q.get('new') || 10),
      });
      return this.json(res, 200, {
        profileId,
        stats: srs.summarise(cards, states),
        queue: queue.map((c) => ({ ...c, state: states[c.id] || null })),
      });
    }

    if (route === 'srs/review' && method === 'POST') {
      const body = await this.readBody(req);
      const profileId = this.safeKey(body.profile, 'default');
      const cardId = this.safeKey(body.cardId);
      if (!cardId) return this.json(res, 400, { error: 'A card id is needed' });
      let next;
      this.state.update((d) => {
        d.srs[profileId] = d.srs[profileId] || {};
        next = srs.review(d.srs[profileId][cardId], body.grade);
        d.srs[profileId][cardId] = next;
      });
      return this.json(res, 200, { cardId, state: next });
    }

    // --- profiles ---------------------------------------------------------
    if (route === 'profiles' && method === 'GET') {
      return this.json(res, 200, { profiles: this.state.get().profiles });
    }

    if (route === 'profiles' && method === 'POST') {
      const body = await this.readBody(req);
      const name = (body.name || '').trim();
      if (!name) return this.json(res, 400, { error: 'A name is required' });
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || `p${Date.now()}`;
      this.state.update((d) => {
        if (!d.profiles.find((p) => p.id === id)) {
          d.profiles.push({ id, name, created: new Date().toISOString() });
        }
      });
      return this.json(res, 200, { profiles: this.state.get().profiles });
    }

    // --- unified search ---------------------------------------------------
    if (route === 'search') {
      const query = q.get('q') || '';
      if (!query.trim()) return this.json(res, 200, { query, content: [], packs: [], total: 0 });
      const results = await this.search.searchAll(this.library, query, {
        contentLimit: Number(q.get('limit') || 15),
        packLimit: Number(q.get('packLimit') || 8),
      });
      return this.json(res, 200, results);
    }

    return this.json(res, 404, { error: `Unknown endpoint: ${route}` });
  }
}

module.exports = { ArkServer };
