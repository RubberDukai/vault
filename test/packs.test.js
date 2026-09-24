'use strict';
/**
 * The download queue. It is the part of the vault that runs unattended for
 * days, so the things that matter are: it does not enqueue what is already on
 * disk, a pack moved to the front really goes to the front, and only one Vault
 * on a machine runs the queue at a time.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PackCatalog, humanBytes } = require('../src/library/packs');

function catalogue() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-packs-'));
  const manifestPath = path.join(dir, 'packs.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    categories: [{ id: 'books', title: 'Books' }],
    items: [
      { id: 'small', category: 'books', title: 'Small', size: 100, dest: 'library/docs', priority: 1, recommended: true, files: [{ url: 'https://example.invalid/a', filename: 'a.epub' }] },
      { id: 'huge', category: 'books', title: 'Huge', size: 50e9, dest: 'library/docs', priority: 2, recommended: true, files: [{ url: 'https://example.invalid/b', filename: 'b.zim' }] },
      { id: 'extra', category: 'books', title: 'Extra', size: 10, dest: 'library/docs', priority: 3, files: [{ url: 'https://example.invalid/c', filename: 'c.epub' }] },
    ],
  }));
  const packs = new PackCatalog({ manifestPath, rootDir: dir, dataDir: dir });
  packs.load();
  packs.run = async () => {}; // do not start real downloads in a test
  return { packs, dir };
}

test('humanBytes reads at a glance', () => {
  assert.strictEqual(humanBytes(0), '0 B');
  assert.strictEqual(humanBytes(999), '999 B');
  assert.match(humanBytes(1536), /1\.5 KB/);
  assert.match(humanBytes(50 * 1024 ** 3), /50\.0 GB|50 GB/);
});

test('enqueue adds items and ignores unknown ids', () => {
  const { packs } = catalogue();
  const added = packs.enqueue(['small', 'huge', 'no-such-pack']);
  assert.deepStrictEqual(added, ['small', 'huge']);
  assert.deepStrictEqual(packs.state.get().queue, ['small', 'huge']);
});

test('enqueue does not add the same pack twice', () => {
  const { packs } = catalogue();
  packs.enqueue(['small']);
  assert.deepStrictEqual(packs.enqueue(['small']), [], 'already queued');
  assert.deepStrictEqual(packs.state.get().queue, ['small']);
});

test('a pack whose files are already on disk is not queued again', () => {
  const { packs, dir } = catalogue();
  const dest = path.join(dir, 'library', 'docs');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'a.epub'), 'already here');

  assert.deepStrictEqual(packs.enqueue(['small']), [], 'installed packs are skipped');
  assert.strictEqual(packs.status().items.find((i) => i.id === 'small').status, 'installed');
});

test('prioritise moves a queued pack to the head', () => {
  const { packs } = catalogue();
  packs.enqueue(['huge', 'small', 'extra']);
  assert.strictEqual(packs.prioritise('small'), true);
  assert.deepStrictEqual(packs.state.get().queue, ['small', 'huge', 'extra']);
});

test('prioritise refuses a pack that is not in the queue', () => {
  const { packs } = catalogue();
  packs.enqueue(['huge']);
  assert.strictEqual(packs.prioritise('small'), false);
  assert.deepStrictEqual(packs.state.get().queue, ['huge']);
});

test('prioritising the head leaves the queue alone', () => {
  const { packs } = catalogue();
  packs.enqueue(['small', 'huge']);
  packs.prioritise('small');
  assert.deepStrictEqual(packs.state.get().queue, ['small', 'huge']);
});

test('dequeue removes one pack and leaves the rest in order', () => {
  const { packs } = catalogue();
  packs.enqueue(['small', 'huge', 'extra']);
  packs.dequeue('huge');
  assert.deepStrictEqual(packs.state.get().queue, ['small', 'extra']);
});

test('clear empties the queue', () => {
  const { packs } = catalogue();
  packs.enqueue(['small', 'huge']);
  packs.clear();
  assert.deepStrictEqual(packs.state.get().queue, []);
});

test('enqueueBundle takes the recommended packs in priority order', () => {
  const { packs } = catalogue();
  assert.deepStrictEqual(packs.enqueueBundle('recommended'), ['small', 'huge']);
});

test('enqueueBundle("everything") takes them all', () => {
  const { packs } = catalogue();
  assert.deepStrictEqual(packs.enqueueBundle('everything'), ['small', 'huge', 'extra']);
});

test('status reports queued, missing and installed, with totals', () => {
  const { packs } = catalogue();
  packs.enqueue(['small']);
  const status = packs.status();
  const byId = Object.fromEntries(status.items.map((i) => [i.id, i]));
  assert.strictEqual(byId.small.status, 'queued');
  assert.strictEqual(byId.huge.status, 'missing');
  assert.ok(status.totals.everything >= 50e9);
  assert.strictEqual(status.queue[0].id, 'small');
});

test('the queue survives a restart', async () => {
  const { packs, dir } = catalogue();
  packs.enqueue(['huge', 'small']);
  packs.prioritise('small');
  await packs.state.save(); // the queue is written asynchronously

  const reopened = new PackCatalog({ manifestPath: path.join(dir, 'packs.json'), rootDir: dir, dataDir: dir });
  reopened.load();
  assert.deepStrictEqual(reopened.state.get().queue, ['small', 'huge']);
});

test('a live lock held by another process keeps this one out', () => {
  const { packs, dir } = catalogue();
  fs.writeFileSync(path.join(dir, 'downloads.lock'), JSON.stringify({ pid: process.pid + 0, at: Date.now() }));
  // Our own pid is treated as "not someone else", so use a pid that exists
  // but is not us: the parent, which is alive while this test runs.
  fs.writeFileSync(path.join(dir, 'downloads.lock'), JSON.stringify({ pid: process.ppid, at: Date.now() }));
  assert.strictEqual(packs.lockedElsewhere(), true);
});

test('a stale lock is not respected', () => {
  const { packs, dir } = catalogue();
  fs.writeFileSync(path.join(dir, 'downloads.lock'), JSON.stringify({ pid: process.ppid, at: Date.now() - 10 * 60 * 1000 }));
  assert.strictEqual(packs.lockedElsewhere(), false, 'a lock with no heartbeat for minutes is taken over');
});

test('a lock left by a dead process is not respected', () => {
  const { packs, dir } = catalogue();
  fs.writeFileSync(path.join(dir, 'downloads.lock'), JSON.stringify({ pid: 0x7ffffffe, at: Date.now() }));
  assert.strictEqual(packs.lockedElsewhere(), false, 'no such process, so the lock is stale');
});
