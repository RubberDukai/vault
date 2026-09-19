'use strict';
/**
 * Your own media: music, photographs and films in library/media, played by
 * the browser straight from the folder. Nothing is transcoded; what the
 * browser can play, it plays.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const KINDS = {
  audio: new Set(['.mp3', '.ogg', '.oga', '.opus', '.wav', '.flac', '.m4a', '.aac', '.weba']),
  video: new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov']),
  image: new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.avif']),
};

const MIME = {
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.weba': 'audio/webm',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
};

function kindOf(ext) {
  for (const [kind, set] of Object.entries(KINDS)) if (set.has(ext)) return kind;
  return null;
}

class MediaLibrary {
  constructor(dir) {
    this.dir = dir;
  }

  /** Every playable file, grouped by the folder it sits in (an album, a trip). */
  async list() {
    await fsp.mkdir(this.dir, { recursive: true });
    const files = [];
    const walk = async (rel, depth) => {
      const full = path.join(this.dir, rel);
      let entries = [];
      try { entries = await fsp.readdir(full, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (depth < 4) await walk(relPath, depth + 1);
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        const kind = kindOf(ext);
        if (!kind) continue;
        let size = 0;
        let mtime = 0;
        try { const st = await fsp.stat(path.join(full, entry.name)); size = st.size; mtime = st.mtimeMs; } catch { /* skip */ }
        files.push({
          path: relPath,
          name: entry.name.replace(/\.[^.]+$/, ''),
          folder: rel || '',
          kind,
          ext,
          size,
          mtime,
          url: `/media/${relPath.split('/').map(encodeURIComponent).join('/')}`,
        });
      }
    };
    await walk('', 0);
    files.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    return files;
  }

  /** Stream a file with HTTP range support, which seeking in a player needs. */
  async serve(req, res, relPath) {
    const target = path.resolve(this.dir, relPath);
    if (!target.startsWith(path.resolve(this.dir) + path.sep)) {
      res.writeHead(403); return res.end('Forbidden');
    }
    let stat;
    try { stat = await fsp.stat(target); } catch { res.writeHead(404); return res.end('Not found'); }
    if (!stat.isFile()) { res.writeHead(404); return res.end('Not found'); }

    const ext = path.extname(target).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      let start = range[1] ? Number(range[1]) : 0;
      let end = range[2] ? Number(range[2]) : stat.size - 1;
      if (!range[1] && range[2]) { start = Math.max(0, stat.size - Number(range[2])); end = stat.size - 1; }
      if (start >= stat.size || end >= stat.size || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
        return res.end();
      }
      res.writeHead(206, {
        'content-type': type,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${stat.size}`,
        'accept-ranges': 'bytes',
        'cache-control': 'private, max-age=3600',
      });
      return fs.createReadStream(target, { start, end }).pipe(res);
    }
    res.writeHead(200, {
      'content-type': type,
      'content-length': stat.size,
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=3600',
    });
    return fs.createReadStream(target).pipe(res);
  }
}

module.exports = { MediaLibrary };
