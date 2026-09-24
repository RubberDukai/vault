'use strict';
/**
 * Tiny durable JSON store. Every write goes to a temp file and is renamed into
 * place, so a power cut mid-save can never leave a half-written state file —
 * which is not a theoretical concern for a machine running off a battery.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const lock = require('./lock');

class Store {
  constructor(filePath, defaults = {}) {
    this.filePath = filePath;
    this.defaults = defaults;
    this.data = null;
    this._writeQueue = Promise.resolve();
    // When the vault is locked, the key that this file is written under.
    // Null means plain JSON, which is how an unlocked vault has always worked.
    this._key = null;
  }

  /**
   * Encrypt this file from now on, or stop. Setting a key does not rewrite
   * the file — the caller decides when to do that, because turning the lock
   * on has to rewrite every store at once or not at all.
   */
  setKey(key) {
    this._key = key || null;
    return this;
  }

  load() {
    if (this.data) return this.data;
    let raw = null;
    try {
      const bytes = fs.readFileSync(this.filePath);
      // A file written while the vault was locked is ciphertext. One that
      // predates the lock is not, and must still open — turning the lock on
      // is a migration, not a cliff.
      raw = lock.looksEncrypted(bytes)
        ? (this._key ? lock.decrypt(this._key, bytes).toString('utf8') : null)
        : bytes.toString('utf8');
      if (raw === null) throw new Error('locked');
    } catch (err) {
      if (err && err.message === 'locked') {
        // Asked to read an encrypted file with no key. Never quarantine it:
        // that would destroy data whose only problem is that we are locked.
        throw new Error(`${path.basename(this.filePath)} is encrypted and the vault is locked`);
      }
      raw = null; // no file yet, or unreadable: start from the defaults
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
    const json = JSON.stringify(this.load(), null, 2);
    const snapshot = this._key ? lock.encrypt(this._key, Buffer.from(json, 'utf8')) : json;
    this._writeQueue = this._writeQueue.then(async () => {
      await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      // Write, flush to disk, then rename: a power cut leaves either the old
      // file or the new one, never half of either.
      const handle = await fsp.open(tmp, 'w');
      try {
        await handle.writeFile(snapshot, Buffer.isBuffer(snapshot) ? undefined : 'utf8');
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
