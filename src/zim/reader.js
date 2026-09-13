'use strict';
/**
 * Pure-JavaScript reader for the ZIM file format (openzim.org).
 *
 * Deliberately dependency-free: it uses only Node's built-in zlib, which since
 * Node 22.15 includes native zstd. Modern Kiwix ZIM files are zstd-compressed,
 * so nothing here needs to be compiled, downloaded or maintained. That matters
 * for a tool whose whole purpose is to still work in ten years with no network.
 *
 * Format reference: https://wiki.openzim.org/wiki/ZIM_file_format
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const ZIM_MAGIC = 0x44d495a;

const REDIRECT_MIME = 0xffff;
const LINKTARGET_MIME = 0xfffe;
const DELETED_MIME = 0xfffd;

const COMPRESSION_NAMES = {
  0: 'none', 1: 'none', 2: 'zlib', 3: 'bzip2', 4: 'lzma', 5: 'zstd',
};

/** Read a NUL-terminated string out of a buffer. Returns null if unterminated. */
function readCString(buf, start) {
  const end = buf.indexOf(0, start);
  if (end === -1) return null;
  return { value: buf.toString('utf8', start, end), next: end + 1 };
}

/** Simple size-bounded LRU, used to keep hot decompressed clusters around. */
class LruCache {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key, value, size) {
    if (this.map.has(key)) {
      this.bytes -= this.map.get(key).size;
      this.map.delete(key);
    }
    this.map.set(key, { value, size });
    this.bytes += size;
    while (this.bytes > this.maxBytes && this.map.size > 1) {
      const oldest = this.map.keys().next().value;
      this.bytes -= this.map.get(oldest).size;
      this.map.delete(oldest);
    }
  }
}

class ZimFile {
  constructor(filePath, handle, fileSize) {
    this.filePath = filePath;
    this.fh = handle;
    this.fileSize = fileSize;
    this.header = null;
    this.mimeTypes = [];
    this._urlPtrs = null;      // Buffer of uint64 LE, one per entry
    this._clusterPtrs = null;  // Buffer of uint64 LE, one per cluster
    this._titleList = null;    // Buffer of uint32 LE indices into url order
    this._entryCache = new Map();
    this._clusterCache = new LruCache(96 * 1024 * 1024);
    this._metadata = null;
  }

  static async open(filePath) {
    const handle = await fsp.open(filePath, 'r');
    const stat = await handle.stat();
    const zim = new ZimFile(filePath, handle, stat.size);
    try {
      await zim._init();
    } catch (err) {
      await handle.close();
      throw err;
    }
    return zim;
  }

  async close() {
    await this.fh.close();
  }

  async _read(offset, length) {
    if (length <= 0) return Buffer.alloc(0);
    const buf = Buffer.allocUnsafe(length);
    const { bytesRead } = await this.fh.read(buf, 0, length, offset);
    return bytesRead === length ? buf : buf.subarray(0, bytesRead);
  }

  async _init() {
    const h = await this._read(0, 80);
    if (h.length < 80) throw new Error('File is too short to be a ZIM archive');
    const magic = h.readUInt32LE(0);
    if (magic !== ZIM_MAGIC) {
      throw new Error(`Not a ZIM file (magic 0x${magic.toString(16)}). Split archives (.zimaa) are not supported yet.`);
    }
    this.header = {
      majorVersion: h.readUInt16LE(4),
      minorVersion: h.readUInt16LE(6),
      uuid: h.subarray(8, 24).toString('hex'),
      entryCount: h.readUInt32LE(24),
      clusterCount: h.readUInt32LE(28),
      urlPtrPos: Number(h.readBigUInt64LE(32)),
      titlePtrPos: Number(h.readBigUInt64LE(40)),
      clusterPtrPos: Number(h.readBigUInt64LE(48)),
      mimeListPos: Number(h.readBigUInt64LE(56)),
      mainPage: h.readUInt32LE(64),
      layoutPage: h.readUInt32LE(68),
      checksumPos: Number(h.readBigUInt64LE(72)),
    };

    // MIME type list: NUL-terminated strings, terminated by an empty string.
    const mimeSpan = Math.max(0, Math.min(65536, this.header.urlPtrPos - this.header.mimeListPos));
    const mimeBuf = await this._read(this.header.mimeListPos, mimeSpan || 8192);
    let p = 0;
    while (p < mimeBuf.length) {
      const s = readCString(mimeBuf, p);
      if (!s || s.value === '') break;
      this.mimeTypes.push(s.value);
      p = s.next;
    }

    // Pointer lists are read wholesale. 8 bytes per entry means even the full
    // English Wikipedia (~7M entries) costs ~56MB, which is a fair trade for
    // making every lookup two reads instead of three.
    this._urlPtrs = await this._read(this.header.urlPtrPos, this.header.entryCount * 8);
    this._clusterPtrs = await this._read(this.header.clusterPtrPos, this.header.clusterCount * 8);
  }

  get entryCount() { return this.header.entryCount; }
  get clusterCount() { return this.header.clusterCount; }

  _urlPtr(index) {
    return Number(this._urlPtrs.readBigUInt64LE(index * 8));
  }

  _clusterPtr(index) {
    return Number(this._clusterPtrs.readBigUInt64LE(index * 8));
  }

  /** Read and parse the directory entry at URL-order position `index`. */
  async dirEntry(index) {
    if (index < 0 || index >= this.entryCount) return null;
    const cached = this._entryCache.get(index);
    if (cached) return cached;

    const offset = this._urlPtr(index);
    let buf = await this._read(offset, 512);
    let entry = this._parseDirEntry(buf, index);
    if (entry === null) {
      // Unusually long url/title; re-read with room to spare.
      buf = await this._read(offset, 8192);
      entry = this._parseDirEntry(buf, index);
      if (entry === null) throw new Error(`Malformed directory entry at index ${index}`);
    }

    if (this._entryCache.size > 20000) this._entryCache.clear();
    this._entryCache.set(index, entry);
    return entry;
  }

  _parseDirEntry(buf, index) {
    if (buf.length < 16) return null;
    const mimeIdx = buf.readUInt16LE(0);
    const parameterLen = buf.readUInt8(2);
    const namespace = String.fromCharCode(buf.readUInt8(3));
    const revision = buf.readUInt32LE(4);
    const isRedirect = mimeIdx === REDIRECT_MIME;

    let redirectIndex = null;
    let clusterNumber = null;
    let blobNumber = null;
    let p;

    if (isRedirect) {
      redirectIndex = buf.readUInt32LE(8);
      p = 12;
    } else {
      clusterNumber = buf.readUInt32LE(8);
      blobNumber = buf.readUInt32LE(12);
      p = 16;
    }

    const url = readCString(buf, p);
    if (!url) return null;
    const title = readCString(buf, url.next);
    if (!title) return null;

    return {
      index,
      namespace,
      url: url.value,
      title: title.value || url.value,
      revision,
      isRedirect,
      redirectIndex,
      clusterNumber,
      blobNumber,
      parameterLen,
      mimeType: isRedirect || mimeIdx === LINKTARGET_MIME || mimeIdx === DELETED_MIME
        ? null
        : (this.mimeTypes[mimeIdx] || 'application/octet-stream'),
    };
  }

  /**
   * Binary search the URL-ordered index. Entries are sorted by namespace then
   * by raw URL bytes, so comparison must be byte-wise, not by JS string order.
   */
  async findEntry(namespace, url) {
    const targetNs = namespace.charCodeAt(0);
    const targetUrl = Buffer.from(url, 'utf8');
    let lo = 0;
    let hi = this.entryCount - 1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const entry = await this.dirEntry(mid);
      const ns = entry.namespace.charCodeAt(0);
      let cmp;
      if (ns !== targetNs) {
        cmp = ns < targetNs ? -1 : 1;
      } else {
        cmp = Buffer.compare(Buffer.from(entry.url, 'utf8'), targetUrl);
      }
      if (cmp === 0) return entry;
      if (cmp < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  /** Index of the first entry in a namespace, or -1. */
  async firstInNamespace(namespace) {
    const targetNs = namespace.charCodeAt(0);
    let lo = 0;
    let hi = this.entryCount - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const entry = await this.dirEntry(mid);
      const ns = entry.namespace.charCodeAt(0);
      if (ns >= targetNs) {
        if (ns === targetNs) found = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return found;
  }

  /** Follow redirect chains to the entry that actually holds content. */
  async resolve(entry, depth = 0) {
    if (!entry) return null;
    if (!entry.isRedirect) return entry;
    if (depth > 10) return null;
    return this.resolve(await this.dirEntry(entry.redirectIndex), depth + 1);
  }

  async _readClusterData(clusterIdx) {
    const cached = this._clusterCache.get(clusterIdx);
    if (cached) return cached.value;

    const start = this._clusterPtr(clusterIdx);
    const end = clusterIdx + 1 < this.clusterCount
      ? this._clusterPtr(clusterIdx + 1)
      : (this.header.checksumPos || this.fileSize);

    const raw = await this._read(start, end - start);
    if (raw.length === 0) throw new Error(`Empty cluster ${clusterIdx}`);

    const flag = raw.readUInt8(0);
    const compression = flag & 0x0f;
    const extended = (flag & 0x10) !== 0;
    const payload = raw.subarray(1);

    let data;
    switch (compression) {
      case 0:
      case 1:
        data = payload;
        break;
      case 2:
        data = zlib.inflateSync(payload);
        break;
      case 5:
        data = zlib.zstdDecompressSync(payload, { maxOutputLength: 512 * 1024 * 1024 });
        break;
      case 4:
        throw new Error(
          'This ZIM uses LZMA compression, which Node cannot decompress natively. ' +
          'Download a newer (zstd) build of this pack from library.kiwix.org.'
        );
      default:
        throw new Error(`Unsupported ZIM compression type ${compression} (${COMPRESSION_NAMES[compression] || 'unknown'})`);
    }

    const result = { data, extended };
    this._clusterCache.set(clusterIdx, result, data.length);
    return result;
  }

  /** Extract one blob from a cluster. */
  async readBlob(clusterIdx, blobIdx) {
    const { data, extended } = await this._readClusterData(clusterIdx);
    const width = extended ? 8 : 4;
    const readOffset = extended
      ? (o) => Number(data.readBigUInt64LE(o))
      : (o) => data.readUInt32LE(o);

    const firstOffset = readOffset(0);
    const blobCount = firstOffset / width - 1;
    if (blobIdx >= blobCount) {
      throw new Error(`Blob ${blobIdx} out of range in cluster ${clusterIdx} (${blobCount} blobs)`);
    }
    const start = readOffset(blobIdx * width);
    const end = readOffset((blobIdx + 1) * width);
    return data.subarray(start, end);
  }

  /** Fetch content by namespace + url, following redirects. */
  async getContent(namespace, url) {
    const entry = await this.resolve(await this.findEntry(namespace, url));
    if (!entry || entry.clusterNumber === null) return null;
    const data = await this.readBlob(entry.clusterNumber, entry.blobNumber);
    return { data, mimeType: entry.mimeType, entry };
  }

  /**
   * Articles live in namespace 'C' in ZIM 6+, and 'A' in older archives.
   * Try both so old packs keep working.
   */
  async getArticle(url) {
    return (await this.getContent('C', url)) || (await this.getContent('A', url));
  }

  /** All M-namespace metadata as a plain object. This is where the dump date lives. */
  async metadata() {
    if (this._metadata) return this._metadata;
    const meta = {};
    const start = await this.firstInNamespace('M');
    if (start >= 0) {
      for (let i = start; i < this.entryCount; i++) {
        const entry = await this.dirEntry(i);
        if (entry.namespace !== 'M') break;
        // Skip binary illustrations; we only want the text fields.
        if (/^Illustration/i.test(entry.url)) continue;
        try {
          const resolved = await this.resolve(entry);
          if (!resolved || resolved.clusterNumber === null) continue;
          const blob = await this.readBlob(resolved.clusterNumber, resolved.blobNumber);
          if (blob.length <= 8192) meta[entry.url] = blob.toString('utf8');
        } catch {
          // A single unreadable metadata field should never stop a pack loading.
        }
      }
    }
    this._metadata = meta;
    return meta;
  }

  /** The title-ordered index: uint32 positions into the URL-ordered list. */
  async titleList() {
    if (this._titleList) return this._titleList;

    // ZIM 6 stores an article-only title listing as a regular entry, which is
    // better for search than the header's list (that one includes every image
    // and stylesheet too). Fall back to the header pointer for older files.
    for (const url of ['listing/titleOrdered/v1', 'listing/titleOrdered/v0']) {
      try {
        const found = await this.getContent('X', url);
        if (found && found.data.length >= 4) {
          this._titleList = found.data;
          return this._titleList;
        }
      } catch {
        // fall through to the header list
      }
    }

    this._titleList = await this._read(this.header.titlePtrPos, this.entryCount * 4);
    return this._titleList;
  }

  async titleCount() {
    const list = await this.titleList();
    return Math.floor(list.length / 4);
  }

  async entryByTitlePosition(pos) {
    const list = await this.titleList();
    if (pos < 0 || pos * 4 + 4 > list.length) return null;
    return this.dirEntry(list.readUInt32LE(pos * 4));
  }

  /**
   * Prefix search over the title-ordered index. This is a binary search, so it
   * stays instant whether the pack holds 250 thousand articles or 7 million.
   */
  async searchTitles(query, limit = 25) {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const count = await this.titleCount();
    let lo = 0;
    let hi = count - 1;
    let start = count;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const entry = await this.entryByTitlePosition(mid);
      const title = (entry ? entry.title : '').toLowerCase();
      if (title >= q) {
        start = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    const results = [];
    for (let i = start; i < count && results.length < limit; i++) {
      const entry = await this.entryByTitlePosition(i);
      if (!entry) break;
      if (!entry.title.toLowerCase().startsWith(q)) break;
      if (entry.namespace !== 'C' && entry.namespace !== 'A') continue;
      results.push({ title: entry.title, url: entry.url, namespace: entry.namespace });
    }
    return results;
  }

  /**
   * Substring fallback for when prefix search comes up short.
   *
   * With the in-memory index this is a string scan and takes milliseconds.
   * Without it — a pack too large to index, or one still being indexed — it
   * samples a small number of entries from disk so it stays responsive, at
   * the cost of missing most matches.
   */
  async scanTitles(query, limit = 25, maxScan = 4000) {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    if (this._titleIndex) {
      const { lower, titles, urls } = this._titleIndex;
      const results = [];
      for (let i = 0; i < lower.length && results.length < limit; i++) {
        if (lower[i].includes(q)) results.push({ title: titles[i], url: urls[i], namespace: 'C' });
      }
      return results;
    }

    const count = await this.titleCount();
    const step = Math.max(1, Math.floor(count / maxScan));
    const results = [];
    for (let i = 0; i < count && results.length < limit; i += step) {
      const entry = await this.entryByTitlePosition(i);
      if (!entry) continue;
      if (entry.namespace !== 'C' && entry.namespace !== 'A') continue;
      if (entry.title.toLowerCase().includes(q)) {
        results.push({ title: entry.title, url: entry.url, namespace: entry.namespace });
      }
    }
    return results;
  }

  /**
   * Build an in-memory list of every article title, so substring search is a
   * string scan rather than a disk seek per entry.
   *
   * Directory entries are stored contiguously, so this reads the whole
   * directory region in large sequential chunks rather than one entry at a
   * time — a few seconds for a million entries. Packs above `maxEntries` are
   * left to prefix search alone; the memory would not be worth it.
   *
   * The result is cached at `cachePath` as tab-separated lines, so the next
   * start loads it in a fraction of a second.
   */
  async buildTitleIndex({ cachePath = null, maxEntries = 2500000 } = {}) {
    if (this._titleIndex) return true;
    if (this.entryCount > maxEntries) return false;

    if (cachePath) {
      try {
        const text = await fsp.readFile(cachePath, 'utf8');
        const [header, ...lines] = text.split('\n');
        if (header === `zim-title-index v1 ${this.header.uuid}`) {
          const titles = [];
          const urls = [];
          for (const line of lines) {
            if (!line) continue;
            const tab = line.indexOf('\t');
            titles.push(line.slice(0, tab));
            urls.push(line.slice(tab + 1));
          }
          this._titleIndex = { titles, urls, lower: titles.map((t) => t.toLowerCase()) };
          return true;
        }
      } catch {
        // no cache, or a stale one — rebuild
      }
    }

    // Find the span the directory occupies: the first entry's offset to the
    // end of the last. Entries are laid out in URL order.
    let start = Infinity;
    let end = 0;
    for (let i = 0; i < this.entryCount; i++) {
      const off = this._urlPtr(i);
      if (off < start) start = off;
      if (off > end) end = off;
    }
    end += 8192; // room for the last entry's url and title

    const titles = [];
    const urls = [];
    const CHUNK = 8 * 1024 * 1024;
    let position = start;
    let carry = Buffer.alloc(0);

    while (position < end) {
      const chunk = await this._read(position, Math.min(CHUNK, end - position));
      if (chunk.length === 0) break;
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      let p = 0;

      // Walk entries back to back. An entry we cannot finish parsing is
      // carried into the next chunk.
      while (p < buf.length) {
        if (buf.length - p < 16) break;
        const mimeIdx = buf.readUInt16LE(p);
        const namespace = buf.readUInt8(p + 3);
        const isRedirect = mimeIdx === REDIRECT_MIME;
        const fixed = isRedirect ? 12 : 16;
        const urlEnd = buf.indexOf(0, p + fixed);
        if (urlEnd === -1) break;
        const titleEnd = buf.indexOf(0, urlEnd + 1);
        if (titleEnd === -1) break;
        const parameterLen = buf.readUInt8(p + 2);
        const next = titleEnd + 1 + parameterLen;
        if (next > buf.length) break;

        // Only real articles, not redirects, images or metadata.
        if (!isRedirect && (namespace === 0x43 || namespace === 0x41) && mimeIdx < this.mimeTypes.length) {
          const mime = this.mimeTypes[mimeIdx];
          if (mime && mime.startsWith('text/html')) {
            const url = buf.toString('utf8', p + fixed, urlEnd);
            const title = titleEnd > urlEnd + 1 ? buf.toString('utf8', urlEnd + 1, titleEnd) : url;
            titles.push(title);
            urls.push(url);
          }
        }
        p = next;
      }

      carry = buf.subarray(p);
      position += chunk.length;
      // Guard against a pathological entry that never parses: skip a byte.
      if (p === 0 && carry.length >= CHUNK) { carry = carry.subarray(1); }
    }

    this._titleIndex = { titles, urls, lower: titles.map((t) => t.toLowerCase()) };

    if (cachePath) {
      const lines = [`zim-title-index v1 ${this.header.uuid}`];
      for (let i = 0; i < titles.length; i++) lines.push(`${titles[i]}\t${urls[i]}`);
      await fsp.mkdir(path.dirname(cachePath), { recursive: true }).catch(() => {});
      await fsp.writeFile(cachePath, lines.join('\n'), 'utf8').catch(() => {});
    }
    return true;
  }

  get titleIndexReady() {
    return Boolean(this._titleIndex);
  }

  /**
   * Title search that copes with how people actually type.
   *
   * A title index can only answer prefix questions, so a multi-word query like
   * "radio antenna" matches nothing even though the pack is full of relevant
   * articles. Fall back through progressively looser attempts: the whole query
   * as a prefix, then as a substring, then the individual words longest first.
   */
  async findTitles(query, limit = 25) {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const results = [];
    const seen = new Set();
    const add = (hits) => {
      for (const hit of hits) {
        if (seen.has(hit.url)) continue;
        seen.add(hit.url);
        results.push(hit);
      }
    };

    add(await this.searchTitles(trimmed, limit));
    if (results.length >= limit) return results.slice(0, limit);

    add(await this.scanTitles(trimmed, limit - results.length));
    if (results.length >= limit) return results.slice(0, limit);

    const words = trimmed.split(/\s+/).filter((w) => w.length > 2).sort((a, b) => b.length - a.length);
    for (const word of words) {
      if (results.length >= limit) break;
      add(await this.searchTitles(word, limit - results.length));
    }
    for (const word of words) {
      if (results.length >= limit) break;
      add(await this.scanTitles(word, limit - results.length));
    }

    return results.slice(0, limit);
  }

  /** The archive's landing page, if it declares one. */
  async mainPageEntry() {
    if (this.header.mainPage !== 0xffffffff && this.header.mainPage < this.entryCount) {
      const entry = await this.resolve(await this.dirEntry(this.header.mainPage));
      if (entry) return entry;
    }
    const wellKnown = await this.findEntry('W', 'mainPage');
    if (wellKnown) return this.resolve(wellKnown);
    return null;
  }
}

module.exports = { ZimFile, COMPRESSION_NAMES };
