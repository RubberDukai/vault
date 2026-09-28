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
