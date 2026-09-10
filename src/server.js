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
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const NAMESPACES = new Set(['C', 'A', 'I', 'M', 'W', 'X', '-']);

class ArkServer {
  constructor(options = {}) {
    this.port = options.port || 8080;
    this.host = options.host || '0.0.0.0';
    this.libraryDir = options.libraryDir || path.join(ROOT, 'library');
    this.contentDir = options.contentDir || path.join(ROOT, 'content');
    this.dataDir = options.dataDir || path.join(ROOT, 'data');
    this.webDir = path.join(ROOT, 'web');

    this.library = new LibraryManager(this.libraryDir);
    this.content = new ContentLibrary(this.contentDir);
    this.search = new UnifiedSearch();

    this.state = new Store(path.join(this.dataDir, 'state.json'), {
      profiles: [{ id: 'default', name: 'Everyone', created: new Date().toISOString() }],
      srs: {},
      school: {},
      bookmarks: [],
      lastUpdateCheck: null,
    });
  }

  async init() {
    await fsp.mkdir(this.dataDir, { recursive: true });
    this.state.load();
    await this.content.load();
    this.search.build(this.content);
    await this.library.scan();
    return this;
  }

  async start() {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        console.error('[ark]', err);
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
    return out;
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

  async readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length === 0) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return {};
    }
  }

  profileFor(id) {
    const data = this.state.get();
    return data.profiles.find((p) => p.id === id) || data.profiles[0];
  }

  // ----------------------------------------------------------------- router

  async handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api/')) return this.handleApi(req, res, url, pathname);
    if (pathname.startsWith('/z/')) return this.handleZim(req, res, pathname);
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
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'content-length': stat.size,
        'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
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
        return res.end(`<!doctype html><meta charset="utf-8"><style>body{font:15px system-ui;padding:2rem;color:#8b949e;background:#0d1117}</style><p>Not in this pack: <code>${target}</code></p><p>If this is an image, remember you chose the no-pictures build.</p>`);
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

      res.writeHead(200, {
        'content-type': found.mimeType || 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'public, max-age=86400',
      });
      res.end(body);
    } catch (err) {
      this.json(res, 500, { error: err.message });
    }
  }

  // -------------------------------------------------------------------- api

  async handleApi(req, res, url, pathname) {
    const route = pathname.slice('/api/'.length);
    const q = url.searchParams;
    const method = req.method.toUpperCase();

    // --- status -----------------------------------------------------------
    if (route === 'status') {
      const packs = this.library.list();
      return this.json(res, 200, {
        name: 'Ark',
        version: require('../package.json').version,
        node: process.version,
        platform: `${os.type()} ${os.release()}`,
        addresses: this.addresses(),
        libraryDir: this.libraryDir,
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
      const job = downloads.start({
        url: body.url,
        destDir: this.libraryDir,
        filename: body.filename,
        id: body.id,
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

    // --- school -----------------------------------------------------------
    if (route === 'school') {
      const profileId = q.get('profile') || 'default';
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
      const profileId = body.profile || 'default';
      this.state.update((d) => {
        d.school[profileId] = d.school[profileId] || {};
        d.school[profileId][body.lessonId] = {
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
    if (route === 'languages') {
      const profileId = q.get('profile') || 'default';
      const states = this.state.get().srs[profileId] || {};
      return this.json(res, 200, {
        profileId,
        languages: this.content.languages.map((lang) => ({
          ...lang,
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
      const profileId = q.get('profile') || 'default';
      const states = this.state.get().srs[profileId] || {};
      const deckId = q.get('deck');
      const cards = deckId
        ? (this.content.deck(deckId)?.cards || [])
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
      const profileId = body.profile || 'default';
      let next;
      this.state.update((d) => {
        d.srs[profileId] = d.srs[profileId] || {};
        next = srs.review(d.srs[profileId][body.cardId], body.grade);
        d.srs[profileId][body.cardId] = next;
      });
      return this.json(res, 200, { cardId: body.cardId, state: next });
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
