'use strict';
/**
 * Spreadsheet import and export. The one that matters most is the CSV
 * export: a cell of text that another spreadsheet would run as a formula is
 * a real way to attack whoever opens the file, and it was fixed once.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseCsv, exportCsv, importCsv, colLetters, colIndex, makeZip, SheetLibrary } = require('../src/sheets');
const lock = require('../src/lock');

test('column letters and indexes round-trip', () => {
  for (const [i, letters] of [[0, 'A'], [1, 'B'], [25, 'Z'], [26, 'AA'], [27, 'AB'], [51, 'AZ'], [52, 'BA']]) {
    assert.strictEqual(colLetters(i), letters, `index ${i}`);
    assert.strictEqual(colIndex(letters), i, `letters ${letters}`);
  }
});

test('parseCsv handles plain rows', () => {
  assert.deepStrictEqual(parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
});

test('parseCsv handles quotes, commas and doubled quotes inside a field', () => {
  const rows = parseCsv('name,note\n"Smith, J","he said ""no"""\n');
  assert.deepStrictEqual(rows[1], ['Smith, J', 'he said "no"']);
});

test('parseCsv handles CRLF line endings', () => {
  assert.deepStrictEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('parseCsv keeps empty fields rather than dropping them', () => {
  assert.deepStrictEqual(parseCsv('a,,c\n'), [['a', '', 'c']]);
});

test('a tab-separated file is detected', () => {
  assert.deepStrictEqual(parseCsv('a\tb\tc\n1\t2\t3\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

const firstSheet = (csv) => importCsv(csv, 'x').sheets[0];

test('exported CSV neutralises text another spreadsheet would run as a formula', () => {
  // A value starting with + - or @ is text here but a live formula in Excel,
  // so it leaves with a leading apostrophe, as Excel itself writes it.
  for (const lead of ['+', '-', '@']) {
    const out = exportCsv(firstSheet(`a\n${lead}CMD\n`));
    assert.ok(out.includes(`'${lead}CMD`), `${lead} not neutralised: ${JSON.stringify(out)}`);
    assert.ok(!new RegExp(`(^|[,\\n"])\\${lead}CMD`).test(out), `a bare ${lead}CMD was written: ${out}`);
  }
});

test('a cell that is itself a formula exports its computed value, not the formula', () => {
  const out = exportCsv(firstSheet('a\n=1+1\n'));
  assert.ok(!out.includes('=1+1'), `the formula text escaped into the CSV: ${JSON.stringify(out)}`);
});

test('a cell containing a comma or a quote is quoted on the way out', () => {
  const out = exportCsv(firstSheet('a\n"Smith, J"\n'));
  assert.ok(out.includes('"Smith, J"'), `not quoted: ${out}`);
});

test('importCsv produces a workbook whose cells are keyed by reference', () => {
  const book = importCsv('a,b\n1,2\n', 'test.csv');
  assert.strictEqual(book.name, 'test', 'the extension is dropped from the name');
  const sheet = book.sheets[0];
  assert.strictEqual(sheet.cells.A1.v, 'a');
  assert.strictEqual(sheet.cells.B2.v, '2');
  assert.strictEqual(Object.keys(sheet.cells).length, 4);
});

test('a CSV round-trips through import and export', () => {
  const out = exportCsv(firstSheet('a,b\n1,2\n'));
  const rows = parseCsv(out.replace(/^﻿/, ''));
  assert.deepStrictEqual(rows[0], ['a', 'b']);
  assert.deepStrictEqual(rows[1], ['1', '2']);
});

test('makeZip produces something that starts with the zip signature', () => {
  const buf = makeZip({ 'a.txt': 'hello' });
  assert.ok(Buffer.isBuffer(buf));
  assert.strictEqual(buf.subarray(0, 2).toString('latin1'), 'PK', 'a zip begins PK');
  assert.ok(buf.includes(Buffer.from('a.txt')), 'the filename is in the archive');
});

test('workbooks are encrypted at rest when a PIN is set, and readable again when removed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-sheets-enc-'));
  const lib = new SheetLibrary(dir);
  const secret = 'SECRET-SALARY-99999';
  const wb = await lib.save({ name: 'Budget', sheets: [{ name: 'S1', cells: { A1: { v: secret } } }] });
  const file = path.join(dir, `${wb.id}.json`);

  // Before a PIN: plaintext on disk.
  assert.ok(!lock.looksEncrypted(fs.readFileSync(file)), 'plaintext before a PIN');
  assert.ok(fs.readFileSync(file, 'utf8').includes(secret));

  // Enabling a PIN (server: setKey then reencrypt) encrypts existing files.
  const key = crypto.randomBytes(32);
  lib.setKey(key);
  await lib.reencrypt(null);
  const enc = fs.readFileSync(file);
  assert.ok(lock.looksEncrypted(enc), 'ciphertext after the PIN');
  assert.ok(!enc.toString('binary').includes(secret), 'the secret is not readable on disk');
  assert.strictEqual((await lib.get(wb.id)).sheets[0].cells.A1.v, secret, 'still readable through the app');

  // A save while locked stays ciphertext.
  await lib.save(await lib.get(wb.id));
  assert.ok(lock.looksEncrypted(fs.readFileSync(file)), 'a fresh save stays ciphertext');

  // Removing the PIN (server: capture key, setKey(null), reencrypt(old)) restores plaintext.
  lib.setKey(null);
  await lib.reencrypt(key);
  assert.ok(!lock.looksEncrypted(fs.readFileSync(file)), 'plaintext again after removing the PIN');
  assert.strictEqual((await lib.get(wb.id)).sheets[0].cells.A1.v, secret);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a locked workbook file cannot be read without the key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-sheets-locked-'));
  const key = crypto.randomBytes(32);
  const lib = new SheetLibrary(dir).setKey(key);
  const wb = await lib.save({ name: 'x', sheets: [] });

  const noKey = new SheetLibrary(dir); // no key set = locked
  await assert.rejects(() => noKey.get(wb.id), /locked/);
  fs.rmSync(dir, { recursive: true, force: true });
});
