'use strict';
/**
 * The Store holds everything the vault remembers: profiles, progress, review
 * schedules, the download queue. Losing it silently would be the worst kind of
 * bug, so these tests cover the durability promises it makes.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vault-store-'));
}

test('starts from the defaults when there is no file', () => {
  const dir = tmpDir();
  const store = new Store(path.join(dir, 'state.json'), { queue: [], n: 1 });
  assert.deepStrictEqual(store.get(), { queue: [], n: 1 });
});

test('defaults are cloned, not shared between stores', () => {
  const dir = tmpDir();
  const defaults = { list: [] };
  const a = new Store(path.join(dir, 'a.json'), defaults);
  const b = new Store(path.join(dir, 'b.json'), defaults);
  a.get().list.push('x');
  assert.deepStrictEqual(b.get().list, [], 'one store must not mutate another\'s defaults');
  assert.deepStrictEqual(defaults.list, [], 'the defaults object itself must be untouched');
});

test('save then load round-trips through the file', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'state.json');
  const store = new Store(file, { n: 0 });
  await store.update((d) => { d.n = 42; });

  const reopened = new Store(file, { n: 0 });
  assert.strictEqual(reopened.get().n, 42);
});

test('await save() resolves only once the data is really on disk', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'state.json');
  const store = new Store(file, { n: 0 });
  await store.update((d) => { d.n = 7; });
  const onDisk = JSON.parse(await fsp.readFile(file, 'utf8'));
  assert.strictEqual(onDisk.n, 7);
});

test('a burst of updates coalesces but the last value still lands', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'state.json');
  const store = new Store(file, { n: 0 });
  const writes = [];
  for (let i = 1; i <= 20; i++) writes.push(store.update((d) => { d.n = i; }));
  await Promise.all(writes);
  assert.strictEqual(JSON.parse(await fsp.readFile(file, 'utf8')).n, 20);
});

test('missing keys are filled in from the defaults', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, JSON.stringify({ n: 5 }));
  const store = new Store(file, { n: 0, extra: 'default' });
  assert.deepStrictEqual(store.get(), { n: 5, extra: 'default' });
});

test('a corrupt file is quarantined, never overwritten', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '{ this is not json');

  const store = new Store(file, { n: 0 });
  assert.deepStrictEqual(store.get(), { n: 0 }, 'falls back to the defaults');

  const kept = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
  assert.strictEqual(kept.length, 1, 'the unreadable file is kept for recovery');
  assert.strictEqual(fs.readFileSync(path.join(dir, kept[0]), 'utf8'), '{ this is not json');
});

test('no temp files are left behind after a write', async () => {
  const dir = tmpDir();
  const store = new Store(path.join(dir, 'state.json'), {});
  await store.update((d) => { d.x = 1; });
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

test('a write failure is remembered rather than swallowed', async () => {
  const dir = tmpDir();
  // A directory where the file should be: the rename cannot succeed.
  const file = path.join(dir, 'state.json');
  fs.mkdirSync(file);
  const store = new Store(file, { n: 0 });
  await store.update((d) => { d.n = 1; });
  assert.ok(store.lastError, 'lastError records that the save did not happen');
});
