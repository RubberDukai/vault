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
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.data = { ...structuredClone(this.defaults), ...JSON.parse(raw) };
    } catch {
      this.data = structuredClone(this.defaults);
    }
    return this.data;
  }

  get() {
    return this.load();
  }

  save() {
    const snapshot = JSON.stringify(this.load(), null, 2);
    this._writeQueue = this._writeQueue.then(async () => {
      await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, snapshot, 'utf8');
      await fsp.rename(tmp, this.filePath);
    }).catch((err) => {
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
