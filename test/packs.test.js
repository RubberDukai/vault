'use strict';
/**
 * The download queue uses a lock file so two Vault windows don't fight over
 * the same .part. The danger is the opposite: a window force-closed
 * mid-download leaves a lock behind, and a fresh window must recognise it as
 * stale and take over, or the queue stalls forever.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PackCatalog } = require('../src/library/packs');

function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-packs-'));
  const p = new PackCatalog({
    manifestPath: path.join(__dirname, '..', 'content', 'packs.json'),
    rootDir: dir,
    dataDir: dir,
  });
  return { p, dir };
}

test('a stale download lock (dead holder) is seen as free and taken over', () => {
  const { p, dir } = make();
  const lockPath = path.join(dir, 'downloads.lock');
  // A lock from a process that is long gone: an impossible pid, an old stamp.
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 2147483646, at: Date.now() - 5 * 60000 }));

  assert.strictEqual(p.lockedElsewhere(), false, 'a stale lock is not "locked elsewhere"');
  assert.strictEqual(p._acquireLock(), true, 'the stale lock is taken over');
  assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid, process.pid, 'the lock now belongs to this process');

  p._releaseLock();
  assert.ok(!fs.existsSync(lockPath), 'releasing removes our own lock');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a recently-stamped lock from a dead pid is still taken over', () => {
  const { p, dir } = make();
  const lockPath = path.join(dir, 'downloads.lock');
  // Fresh timestamp, but the pid does not exist — the holder crashed seconds ago.
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 2147483646, at: Date.now() }));
  assert.strictEqual(p.lockedElsewhere(), false, 'a dead pid is not alive, however fresh the stamp');
  assert.strictEqual(p._acquireLock(), true);
  p._releaseLock();
  fs.rmSync(dir, { recursive: true, force: true });
});
