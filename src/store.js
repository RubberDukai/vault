'use strict';
/**
 * Tiny durable JSON store. Every write goes to a temp file and is renamed into
 * place, so a power cut mid-save can never leave a half-written state file —
 * which is not a theoretical concern for a machine running off a battery.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

class Store {
  constructor(filePath, defaults = {}) {
    this.filePath = filePath;
    this.defaults = defaults;
    this.data = null;
    this._writeQueue = Promise.resolve();
  }

  load() {
    if (this.data) return this.data;
    let raw = null;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch {
      raw = null; // no file yet: start from the defaults
    }
    if (raw === null) {
      this.data = structuredClone(this.defaults);
      return this.data;
    }
    try {
      this.data = { ...structuredClone(this.defaults), ...JSON.parse(raw) };
    } catch (err) {
      // A file that exists but will not parse is set aside, never overwritten:
      // whatever is in it may be recoverable by hand, and the defaults that
      // replace it are started fresh rather than saved over the top.
      const quarantine = `${this.filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try { fs.renameSync(this.filePath, quarantine); } catch { /* leave it where it is */ }
      console.error(`[vault] ${path.basename(this.filePath)} could not be read (${err.message}); kept as ${path.basename(quarantine)} and starting afresh`);
      this.data = structuredClone(this.defaults);
    }
    return this.data;
  }

  get() {
    return this.load();
  }

  save() {
    // Many updates in quick succession become one write of the latest state,
    // so the queue cannot grow without bound under a burst of reviews.
    // Callers still get a promise that settles only once *their* state is on
    // disk: while a write is in flight, everyone joins one follow-up write.
    if (this._pendingWrite) {
      if (!this._followUp) {
        this._followUp = this._pendingWrite.then(() => { this._followUp = null; return this.save(); });
      }
      return this._followUp;
    }
    this._pendingWrite = this._writeOnce().finally(() => { this._pendingWrite = null; });
    return this._pendingWrite;
  }

  _writeOnce() {
    const snapshot = JSON.stringify(this.load(), null, 2);
    this._writeQueue = this._writeQueue.then(async () => {
      await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      // Write, flush to disk, then rename: a power cut leaves either the old
      // file or the new one, never half of either.
      const handle = await fsp.open(tmp, 'w');
      try {
        await handle.writeFile(snapshot, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fsp.rename(tmp, this.filePath);
    }).catch((err) => {
      // Logged and remembered: the status page can say the disk is failing
      // instead of the app silently pretending everything was kept.
      this.lastError = { at: new Date().toISOString(), message: err.message };
      console.error(`[vault] could not save ${path.basename(this.filePath)}:`, err.message);
    });
    return this._writeQueue;
  }

  update(fn) {
    fn(this.load());
    return this.save();
  }
}

module.exports = { Store };
