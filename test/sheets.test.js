'use strict';
/**
 * Spreadsheet import and export. The one that matters most is the CSV
 * export: a cell of text that another spreadsheet would run as a formula is
 * a real way to attack whoever opens the file, and it was fixed once.
 */

const test = require('node:test');
const assert = require('node:assert');
const { parseCsv, exportCsv, importCsv, colLetters, colIndex, makeZip } = require('../src/sheets');

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
