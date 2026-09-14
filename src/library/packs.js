'use strict';
/**
 * The content catalogue and its download queue.
 *
 * The Vault itself is small enough to email. Everything heavy — the
 * encyclopedias, the sea charts, the textbooks — is fetched afterwards, from
 * a catalogue (content/packs.json) that says what exists, how big it is and
 * where it lives. This module turns a tick-list into downloads: one at a
 * time, resumable, remembered across restarts, and rescanned into the
 * library as each one lands.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const downloads = require('./download');
const { Store } = require('../store');

function humanBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

class PackCatalog {
  constructor({ manifestPath, rootDir, dataDir }) {
    this.manifestPath = manifestPath;
    this.rootDir = rootDir;
    this.manifest = { categories: [], items: [] };
    this.state = new Store(path.join(dataDir, 'downloads.json'), {
      queue: [],          // item ids, in order
      failed: {},         // id -> last error
      completed: [],      // ids finished by this queue (informational)
    });
    this.active = null;   // { id, fileIndex, jobId }
    this._running = false;
    this.onInstalled = null; // async (item) => void — rescan hook
  }

  load() {
    this.manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
    this.state.load();
    return this;
  }

  item(id) {
    return this.manifest.items.find((i) => i.id === id) || null;
  }

  _destDir(item) {
    return path.join(this.rootDir, item.dest);
  }

  /** Where each file of an item stands on disk. */
  _fileStatus(item) {
    const dir = this._destDir(item);
    return item.files.map((f) => {
      const full = path.join(dir, f.filename);
      const part = `${full}.part`;
      let onDisk = 0;
      let partial = 0;
      try { onDisk = fs.statSync(full).size; } catch { /* absent */ }
      try { partial = fs.statSync(part).size; } catch { /* absent */ }
      return { filename: f.filename, url: f.url, installed: onDisk > 0, onDisk, partial };
    });
  }

  /** The catalogue with live status folded in. */
  status() {
    const queued = new Set(this.state.get().queue);
    const failed = this.state.get().failed || {};

    const items = this.manifest.items.map((item) => {
      const files = this._fileStatus(item);
      const installedFiles = files.filter((f) => f.installed).length;
      const bytesOnDisk = files.reduce((n, f) => n + f.onDisk + f.partial, 0);

      let status = 'missing';
      if (installedFiles === files.length) {
        status = 'installed';
        // A failure recorded before the files arrived is no longer true.
        if (failed[item.id]) this.state.update((d) => { delete d.failed[item.id]; });
      }
      else if (this.active && this.active.id === item.id) status = 'downloading';
      else if (queued.has(item.id)) status = 'queued';
      else if (failed[item.id]) status = 'failed';
      else if (installedFiles > 0 || bytesOnDisk > 0) status = 'partial';

      return {
        id: item.id, category: item.category, title: item.title, description: item.description,
        size: item.size, sizeHuman: humanBytes(item.size), recommended: Boolean(item.recommended),
        fileCount: files.length, installedFiles, bytesOnDisk,
        status, error: failed[item.id] || null,
      };
    });

    const sum = (list) => list.reduce((n, i) => n + i.size, 0);
    const installed = items.filter((i) => i.status === 'installed');
    const recommended = items.filter((i) => i.recommended);

    return {
      categories: this.manifest.categories,
      note: this.manifest.note,
      updated: this.manifest.updated,
      items,
      totals: {
        everything: sum(items), everythingHuman: humanBytes(sum(items)),
        recommended: sum(recommended), recommendedHuman: humanBytes(sum(recommended)),
        installed: sum(installed), installedHuman: humanBytes(sum(installed)),
        remainingRecommended: sum(recommended.filter((i) => i.status !== 'installed')),
        remainingRecommendedHuman: humanBytes(sum(recommended.filter((i) => i.status !== 'installed'))),
      },
      queue: this.state.get().queue.map((id) => this.item(id)).filter(Boolean).map((i) => ({ id: i.id, title: i.title, size: i.size, sizeHuman: humanBytes(i.size) })),
      active: this.active ? {
        ...this.active,
        title: this.item(this.active.id)?.title,
        job: downloads.get(this.active.jobId),
        fileCount: this.item(this.active.id)?.files.length,
      } : null,
      running: this._running,
      lockedElsewhere: !this._running && this.lockedElsewhere(),
    };
  }

  async diskFree() {
    try {
      const s = await fsp.statfs(this.rootDir);
      return s.bavail * s.bsize;
    } catch {
      return null;
    }
  }

  /** Add items to the queue (skipping anything installed) and start work. */
  enqueue(ids) {
    const current = new Set(this.state.get().queue);
    const added = [];
    for (const id of ids) {
      const item = this.item(id);
      if (!item || current.has(id)) continue;
      if (this._fileStatus(item).every((f) => f.installed)) continue;
      current.add(id);
      added.push(id);
    }
    if (added.length) {
      this.state.update((d) => {
        d.queue.push(...added);
        for (const id of added) delete d.failed[id];
      });
    }
    this.run();
    return added;
  }

  enqueueBundle(which) {
    const ids = this.manifest.items
      .filter((i) => which === 'everything' || i.recommended)
      .sort((a, b) => a.priority - b.priority)
      .map((i) => i.id);
    return this.enqueue(ids);
  }

  dequeue(id) {
    this.state.update((d) => { d.queue = d.queue.filter((q) => q !== id); });
    if (this.active && this.active.id === id) downloads.cancel(this.active.jobId);
  }

  clear() {
    this.state.update((d) => { d.queue = []; });
    if (this.active) downloads.cancel(this.active.jobId);
  }

  /**
   * Only one process may run the queue. Two Vaults on one machine — the
   * Desktop icon and a copy already running — would otherwise both write
   * the same .part file. A lock file with a heartbeat settles it; a stale
   * lock (no heartbeat for two minutes) is taken over.
   */
  _lockPath() {
    return path.join(path.dirname(this.state.filePath), 'downloads.lock');
  }

  /** Is the process that wrote a lock still alive? A dead one is not waited for. */
  _lockHolderAlive(existing) {
    if (existing.pid === process.pid) return false;
    if (Date.now() - existing.at >= 120000) return false;
    try { process.kill(existing.pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
  }

  _acquireLock() {
    const lock = this._lockPath();
    try {
      const existing = JSON.parse(fs.readFileSync(lock, 'utf8'));
      if (this._lockHolderAlive(existing)) return false;
    } catch { /* no lock, or unreadable — take it */ }
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }));
    this._heartbeat = setInterval(() => {
      try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() })); } catch { /* ignore */ }
    }, 30000);
    return true;
  }

  _releaseLock() {
    clearInterval(this._heartbeat);
    this._heartbeat = null;
    try {
      const existing = JSON.parse(fs.readFileSync(this._lockPath(), 'utf8'));
      if (existing.pid === process.pid) fs.unlinkSync(this._lockPath());
    } catch { /* already gone */ }
  }

  lockedElsewhere() {
    try {
      return this._lockHolderAlive(JSON.parse(fs.readFileSync(this._lockPath(), 'utf8')));
    } catch {
      return false;
    }
  }

  /** The worker: one file at a time, in queue order, until the queue is empty. */
  async run() {
    if (this._running) return;
    if (!this._acquireLock()) {
      // Try again later: when the other window closes, this one carries on.
      if (!this._retry) {
        console.log('[vault] another Vault on this machine is running the download queue; leaving it to that one');
        this._retry = setTimeout(() => { this._retry = null; this.run().catch(() => {}); }, 60000);
        if (this._retry.unref) this._retry.unref();
      }
      return;
    }
    this._running = true;

    try {
      for (;;) {
        const queue = this.state.get().queue;
        const id = queue[0];
        if (!id) break;

        const item = this.item(id);
        if (!item) {
          this.state.update((d) => { d.queue.shift(); });
          continue;
        }

        const failure = await this._downloadItem(item);

        this.state.update((d) => {
          d.queue = d.queue.filter((q) => q !== id);
          if (failure) d.failed[id] = failure;
          else {
            delete d.failed[id];
            if (!d.completed.includes(id)) d.completed.push(id);
          }
        });

        if (!failure && this.onInstalled) {
          try { await this.onInstalled(item); } catch (err) { console.error('[vault] rescan after install failed:', err.message); }
        }
      }
    } finally {
      this._running = false;
      this.active = null;
      this._releaseLock();
    }
  }

  /** Every file of one item, in order. Returns an error message, or null. */
  async _downloadItem(item) {
    const dir = this._destDir(item);
    await fsp.mkdir(dir, { recursive: true });

    for (let index = 0; index < item.files.length; index++) {
      const file = item.files[index];
      const full = path.join(dir, file.filename);
      const present = async () => { try { return (await fsp.stat(full)).size > 0; } catch { return false; } };
      if (await present()) continue; // already here

      // Three tries with a pause between; a dropped connection is not a reason
      // to abandon a 50 GB download that is resumable anyway.
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (await present()) { lastError = null; break; } // someone else finished it
        const jobId = `${item.id}:${index}`;
        this.active = { id: item.id, fileIndex: index, jobId, filename: file.filename, attempt };
        downloads.start({ url: file.url, destDir: dir, filename: file.filename, id: jobId });
        const result = await downloads.wait(jobId);
        downloads.prune();

        if (result && result.status === 'complete') { lastError = null; break; }
        if (result && result.status === 'cancelled') return 'cancelled';
        lastError = (result && result.error) || 'download failed';
        await new Promise((r) => setTimeout(r, 5000 * attempt));
      }
      if (lastError) return `${file.filename}: ${lastError}`;
    }
    return null;
  }
}

module.exports = { PackCatalog, humanBytes };
