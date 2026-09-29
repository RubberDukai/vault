'use strict';
/**
 * The document manager turns PDF and EPUB files in a folder into readable
 * books. The one thing that must never happen is two files quietly becoming
 * one because their names collapse to the same id.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DocumentManager } = require('../src/docs/manager');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vault-docs-'));
}

test('two files whose names slugify the same both survive a scan', async () => {
  const dir = tmpDir();
  // "A Book.pdf" and "a-book.epub" both slugify to "a-book".
  fs.writeFileSync(path.join(dir, 'A Book.pdf'), 'not really a pdf');
  fs.writeFileSync(path.join(dir, 'a-book.epub'), 'not really an epub');

  const dm = new DocumentManager(dir, path.join(dir, '.cache'));
  await dm.scan();

  const ids = [...dm.docs.keys()];
  assert.strictEqual(ids.length, 2, 'both files must be kept, not collapsed into one');
  assert.strictEqual(new Set(ids).size, 2, 'the ids must be distinct');

  // The id is a stable hash of the filename, so a second scan does not churn it.
  const before = [...dm.docs.keys()].sort();
  await dm.scan();
  assert.deepStrictEqual([...dm.docs.keys()].sort(), before, 'ids are stable across scans');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('re-pointing an id at a new EPUB closes the old handle (no fd leak)', async () => {
  const dir = tmpDir();
  const dm = new DocumentManager(dir, path.join(dir, '.cache'));
  let closed = 0;
  const epubA = { close: async () => { closed++; } };
  const epubB = { close: async () => { closed++; } };

  await dm._setEpub('x', epubA);
  assert.strictEqual(closed, 0, 'first assignment closes nothing');
  assert.strictEqual(dm._epubs.get('x'), epubA);

  await dm._setEpub('x', epubB);
  assert.strictEqual(closed, 1, 'replacing A with B closes A');
  assert.strictEqual(dm._epubs.get('x'), epubB, 'B is now held');

  await dm._setEpub('x', epubB); // same object again
  assert.strictEqual(closed, 1, 'setting the same EPUB does not close it');

  fs.rmSync(dir, { recursive: true, force: true });
});
