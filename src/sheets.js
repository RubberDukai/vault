'use strict';
/**
 * Spreadsheets.
 *
 * Workbooks live as JSON in library/sheets — the vault's own format, plain
 * enough to read with a text editor. XLSX files (Excel, LibreOffice, Google
 * Sheets exports) and CSVs can be imported from the same folder or uploaded;
 * workbooks export back to both. The XLSX reader and writer here are
 * deliberately small: cells, formulas, shared strings, basic styles and
 * column widths — what a household spreadsheet uses.
 *
 * Workbook shape:
 *   { id, name, active, updated, sheets: [ { name, cells: { A1: { v, s } }, cols: { A: 96 } } ] }
 * where v is what was typed (a formula starts with "=") and s is a style
 * object: { b, i, u, align, bg, color, fmt, dp }.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { ZipFile } = require('./docs/zip');

// ------------------------------------------------------------- helpers

function colLetters(index) { // 0 -> A
  let s = '';
  let n = index + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function colIndex(letters) { // A -> 0
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function splitRef(ref) {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref);
  return m ? { col: colIndex(m[1]), row: Number(m[2]) - 1 } : null;
}

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlUnescape = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');

/** Tiny tag scanner: every <name ...>...</name> or <name .../> with its attributes and inner text. */
function tags(xml, name) {
  const out = [];
  // Attributes are matched lazily so a self-closing tag's "/" is not eaten
  // as an attribute character, which would swallow the next element too.
  const re = new RegExp(`<${name}(\\s[^>]*?)?\\s*(/>|>([\\s\\S]*?)</${name}>)`, 'g');
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    for (const a of (m[1] || '').matchAll(/([\w:]+)="([^"]*)"/g)) attrs[a[1]] = xmlUnescape(a[2]);
    out.push({ attrs, inner: m[3] || '' });
  }
  return out;
}

// ---------------------------------------------------------------- CSV

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const delim = (text.split('\n')[0] || '').split('\t').length > (text.split('\n')[0] || '').split(',').length ? '\t' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// --------------------------------------------------------------- XLSX in

const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47]);

function styleFromXlsx(xf, numFmts, fonts, fills) {
  const s = {};
  const fmtId = Number(xf.numFmtId || 0);
  if (fmtId === 9) { s.fmt = 'percent'; s.dp = 0; }
  else if (fmtId === 10) { s.fmt = 'percent'; s.dp = 2; }
  else if (fmtId === 1) { s.fmt = 'number'; s.dp = 0; }
  else if (fmtId === 2 || fmtId === 4) { s.fmt = 'number'; s.dp = 2; }
  else if (DATE_FORMAT_IDS.has(fmtId)) s.fmt = 'date';
  else if (fmtId >= 164) {
    const code = numFmts[fmtId] || '';
    if (/[£$€]/.test(code)) { s.fmt = 'currency'; s.dp = /\.0+/.test(code) ? (code.match(/\.(0+)/) || ['', '00'])[1].length : 0; }
    else if (/%/.test(code)) { s.fmt = 'percent'; s.dp = (code.match(/\.(0+)/) || ['', ''])[1].length; }
    else if (/[dmyh]/i.test(code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''))) s.fmt = 'date';
    else if (/0/.test(code)) { s.fmt = 'number'; s.dp = (code.match(/\.(0+)/) || ['', ''])[1].length; }
  }
  const font = fonts[Number(xf.fontId || 0)];
  if (font) { if (font.b) s.b = true; if (font.i) s.i = true; if (font.u) s.u = true; if (font.color) s.color = font.color; }
  const fill = fills[Number(xf.fillId || 0)];
  if (fill && Number(xf.applyFill ?? 1)) s.bg = fill;
  return s;
}

async function importXlsx(filePath, name) {
  const zip = await ZipFile.open(filePath);
  try {
    const workbookXml = await zip.readText('xl/workbook.xml');
    const relsXml = zip.has('xl/_rels/workbook.xml.rels') ? await zip.readText('xl/_rels/workbook.xml.rels') : '';
    const rels = {};
    for (const r of tags(relsXml, 'Relationship')) rels[r.attrs.Id] = r.attrs.Target;

    const shared = [];
    if (zip.has('xl/sharedStrings.xml')) {
      const ss = await zip.readText('xl/sharedStrings.xml');
      for (const si of tags(ss, 'si')) {
        shared.push(tags(si.inner, 't').map((t) => xmlUnescape(t.inner)).join(''));
      }
    }

    const numFmts = {};
    const fonts = [];
    const fills = [];
    const xfs = [];
    if (zip.has('xl/styles.xml')) {
      const st = await zip.readText('xl/styles.xml');
      for (const f of tags(st, 'numFmt')) numFmts[Number(f.attrs.numFmtId)] = f.attrs.formatCode || '';
      const fontsBlock = (st.match(/<fonts[\s\S]*?<\/fonts>/) || [''])[0];
      for (const f of tags(fontsBlock, 'font')) {
        const colour = /<color[^>]*rgb="([0-9A-Fa-f]{8})"/.exec(f.inner);
        fonts.push({ b: /<b\b/.test(f.inner), i: /<i\b/.test(f.inner), u: /<u\b/.test(f.inner), color: colour ? `#${colour[1].slice(2)}` : null });
      }
      const fillsBlock = (st.match(/<fills[\s\S]*?<\/fills>/) || [''])[0];
      for (const f of tags(fillsBlock, 'fill')) {
        const fg = /<fgColor[^>]*rgb="([0-9A-Fa-f]{8})"/.exec(f.inner);
        fills.push(fg && /patternType="solid"/.test(f.inner) ? `#${fg[1].slice(2)}` : null);
      }
      const xfsBlock = (st.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0];
      for (const x of tags(xfsBlock, 'xf')) {
        const align = /<alignment[^>]*horizontal="(\w+)"/.exec(x.inner);
        const s = styleFromXlsx(x.attrs, numFmts, fonts, fills);
        if (align && ['left', 'center', 'right'].includes(align[1])) s.align = align[1];
        xfs.push(s);
      }
    }

    const sheets = [];
    for (const sh of tags(workbookXml, 'sheet')) {
      const target = rels[sh.attrs['r:id']] || `worksheets/sheet${sheets.length + 1}.xml`;
      const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\/?xl\//, '')}`;
      if (!zip.has(sheetPath)) continue;
      const xml = await zip.readText(sheetPath);
      const cells = {};
      const cols = {};
      for (const c of tags(xml, 'col')) {
        const w = Number(c.attrs.width);
        if (!w) continue;
        for (let i = Number(c.attrs.min); i <= Math.min(Number(c.attrs.max), 200); i++) cols[colLetters(i - 1)] = Math.round(w * 7 + 5);
      }
      for (const c of tags(xml, 'c')) {
        const ref = c.attrs.r;
        if (!ref) continue;
        const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(c.inner);
        const vTag = /<v>([\s\S]*?)<\/v>/.exec(c.inner);
        const t = c.attrs.t || 'n';
        let value = '';
        if (f) value = `=${xmlUnescape(f[1])}`;
        else if (t === 's') value = shared[Number(vTag ? vTag[1] : -1)] ?? '';
        else if (t === 'inlineStr') value = tags(c.inner, 't').map((x) => xmlUnescape(x.inner)).join('');
        else if (t === 'b') value = vTag && vTag[1] === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'str') value = vTag ? xmlUnescape(vTag[1]) : '';
        else value = vTag ? xmlUnescape(vTag[1]) : '';
        const style = xfs[Number(c.attrs.s || 0)] || {};
        if (value === '' && !Object.keys(style).length) continue;
        const cell = { v: value };
        if (Object.keys(style).length) cell.s = { ...style };
        cells[ref.toUpperCase()] = cell;
      }
      sheets.push({ name: sh.attrs.name || `Sheet${sheets.length + 1}`, cells, cols });
    }
    if (!sheets.length) sheets.push({ name: 'Sheet1', cells: {}, cols: {} });
    return { name: name.replace(/\.xlsx$/i, ''), sheets, active: 0 };
  } finally {
    await zip.close();
  }
}

function importCsv(text, name) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const cells = {};
  rows.forEach((row, r) => row.forEach((v, c) => { if (v !== '') cells[`${colLetters(c)}${r + 1}`] = { v }; }));
  return { name: name.replace(/\.(csv|tsv|txt)$/i, ''), sheets: [{ name: 'Sheet1', cells, cols: {} }], active: 0 };
}

// -------------------------------------------------------------- XLSX out

// CRC-32 for the zip entries.
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Build a zip from { name: Buffer|string } — deflated, no zip64. */
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosTime = 0x0000; const dosDate = 0x21; // 1980-01-01, fine for a spreadsheet
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 6 });
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, deflated);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12); central.writeUInt16LE(dosDate, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(centralStart, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

/** Excel serial date from an ISO date string, and back. */
function excelSerial(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); }

function exportXlsx(workbook) {
  // Styles are built as they are met: each distinct combination gets an xf.
  const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'];
  const fontKeys = new Map([['', 0]]);
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const fillKeys = new Map();
  const numFmts = new Map(); // code -> id
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'];
  const xfKeys = new Map([['', 0]]);

  const numFmtFor = (s) => {
    if (!s.fmt || s.fmt === 'general' || s.fmt === 'text') return s.fmt === 'text' ? 49 : 0;
    const dp = s.dp ?? 2;
    const zeros = dp > 0 ? `.${'0'.repeat(dp)}` : '';
    let code;
    if (s.fmt === 'number') code = `#,##0${zeros}`;
    else if (s.fmt === 'percent') code = `0${zeros}%`;
    else if (s.fmt === 'currency') code = `"£"#,##0${zeros}`;
    else if (s.fmt === 'date') code = 'dd/mm/yyyy';
    else return 0;
    if (!numFmts.has(code)) numFmts.set(code, 164 + numFmts.size);
    return numFmts.get(code);
  };
  const xfFor = (s) => {
    if (!s) return 0;
    const key = JSON.stringify([s.b, s.i, s.u, s.color, s.bg, s.align, s.fmt, s.dp]);
    if (xfKeys.has(key)) return xfKeys.get(key);
    const fontKey = `${s.b ? 'b' : ''}${s.i ? 'i' : ''}${s.u ? 'u' : ''}${s.color || ''}`;
    if (!fontKeys.has(fontKey)) {
      fonts.push(`<font>${s.b ? '<b/>' : ''}${s.i ? '<i/>' : ''}${s.u ? '<u/>' : ''}<sz val="11"/>${s.color ? `<color rgb="FF${s.color.replace('#', '').toUpperCase()}"/>` : ''}<name val="Calibri"/></font>`);
      fontKeys.set(fontKey, fonts.length - 1);
    }
    let fillId = 0;
    if (s.bg) {
      if (!fillKeys.has(s.bg)) { fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${s.bg.replace('#', '').toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>`); fillKeys.set(s.bg, fills.length - 1); }
      fillId = fillKeys.get(s.bg);
    }
    const numFmtId = numFmtFor(s);
    const align = s.align ? `<alignment horizontal="${s.align === 'center' ? 'center' : s.align}"/>` : '';
    xfs.push(`<xf numFmtId="${numFmtId}" fontId="${fontKeys.get(fontKey)}" fillId="${fillId}" borderId="0" applyNumberFormat="1" applyFont="1" applyFill="${fillId ? 1 : 0}" applyAlignment="${align ? 1 : 0}">${align}</xf>`);
    xfKeys.set(key, xfs.length - 1);
    return xfs.length - 1;
  };

  const sheetXml = (sheet) => {
    const byRow = new Map();
    let maxCol = 0;
    for (const [ref, cell] of Object.entries(sheet.cells || {})) {
      const pos = splitRef(ref);
      if (!pos) continue;
      if (!byRow.has(pos.row)) byRow.set(pos.row, []);
      byRow.get(pos.row).push({ ref, cell, col: pos.col });
      maxCol = Math.max(maxCol, pos.col);
    }
    const rows = [...byRow.keys()].sort((a, b) => a - b).map((r) => {
      const cells = byRow.get(r).sort((a, b) => a.col - b.col).map(({ ref, cell }) => {
        const s = xfFor(cell.s);
        const raw = cell.v === undefined || cell.v === null ? '' : String(cell.v);
        const sAttr = s ? ` s="${s}"` : '';
        if (raw.startsWith('=')) {
          const cached = cell.c;
          const v = typeof cached === 'number' ? `<v>${cached}</v>` : typeof cached === 'string' && cached !== '' ? `<v>${xmlEscape(cached)}</v>` : '';
          const t = typeof cached === 'string' && cached !== '' ? ' t="str"' : '';
          return `<c r="${ref}"${sAttr}${t}><f>${xmlEscape(raw.slice(1))}</f>${v}</c>`;
        }
        if (raw === 'TRUE' || raw === 'FALSE') return `<c r="${ref}"${sAttr} t="b"><v>${raw === 'TRUE' ? 1 : 0}</v></c>`;
        const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw) || (/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.test(raw) ? (() => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw); return [null, m[3], m[2], m[1]]; })() : null);
        if (dateMatch && (!cell.s || cell.s.fmt !== 'text')) {
          const dateXf = xfFor({ ...(cell.s || {}), fmt: 'date' });
          return `<c r="${ref}" s="${dateXf}"><v>${excelSerial(Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3]))}</v></c>`;
        }
        if (raw !== '' && /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(raw) && (!cell.s || cell.s.fmt !== 'text')) return `<c r="${ref}"${sAttr}><v>${Number(raw)}</v></c>`;
        if (raw === '') return `<c r="${ref}"${sAttr}/>`;
        return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(raw)}</t></is></c>`;
      });
      return `<row r="${r + 1}">${cells.join('')}</row>`;
    });
    const colsXml = Object.entries(sheet.cols || {}).filter(([, w]) => w).map(([letters, w]) => {
      const i = colIndex(letters) + 1;
      return `<col min="${i}" max="${i}" width="${((w - 5) / 7).toFixed(2)}" customWidth="1"/>`;
    });
    const dim = `A1:${colLetters(Math.max(maxCol, 0))}${Math.max(...byRow.keys(), 0) + 1}`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dim}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${colsXml.length ? `<cols>${colsXml.join('')}</cols>` : ''}<sheetData>${rows.join('')}</sheetData></worksheet>`;
  };

  const sheetFiles = {};
  const sheetEntries = workbook.sheets.map((sheet, i) => {
    sheetFiles[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheet);
    return `<sheet name="${xmlEscape(String(sheet.name || `Sheet${i + 1}`).slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`;
  });

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts.size ? `<numFmts count="${numFmts.size}">${[...numFmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${xmlEscape(code)}"/>`).join('')}</numFmts>` : ''}<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${workbook.sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries.join('')}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbook.sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${workbook.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': stylesXml,
    ...sheetFiles,
  };
  return makeZip(files);
}

function exportCsv(sheet) {
  let maxRow = 0; let maxCol = 0;
  const grid = new Map();
  for (const [ref, cell] of Object.entries(sheet.cells || {})) {
    const pos = splitRef(ref);
    if (!pos) continue;
    maxRow = Math.max(maxRow, pos.row); maxCol = Math.max(maxCol, pos.col);
    grid.set(`${pos.row},${pos.col}`, cell);
  }
  const lines = [];
  for (let r = 0; r <= maxRow; r++) {
    const fields = [];
    for (let c = 0; c <= maxCol; c++) {
      const cell = grid.get(`${r},${c}`);
      // Formulas export as their last computed value, as a CSV should; dates as ISO.
      let out = cell ? (String(cell.v).startsWith('=') ? (cell.c ?? '') : cell.v) : '';
      if (cell && cell.s && cell.s.fmt === 'date' && /^-?\d+(\.\d+)?$/.test(String(out))) {
        const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(out)) * 86400000);
        out = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      }
      fields.push(csvCell(out));
    }
    lines.push(fields.join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

// --------------------------------------------------------------- store

class SheetLibrary {
  constructor(dir) {
    this.dir = dir;
  }

  async list() {
    await fsp.mkdir(this.dir, { recursive: true });
    const entries = await fsp.readdir(this.dir, { withFileTypes: true });
    const workbooks = [];
    const importable = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      const full = path.join(this.dir, e.name);
      if (/\.json$/i.test(e.name)) {
        try {
          const wb = JSON.parse(await fsp.readFile(full, 'utf8'));
          workbooks.push({ id: e.name.replace(/\.json$/i, ''), name: wb.name || e.name, updated: wb.updated || null, sheets: (wb.sheets || []).length });
        } catch { /* not ours */ }
      } else if (/\.(xlsx|csv|tsv)$/i.test(e.name)) {
        const st = await fsp.stat(full);
        importable.push({ file: e.name, size: st.size });
      }
    }
    workbooks.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
    return { workbooks, importable, dir: this.dir };
  }

  _path(id) {
    const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '');
    if (!safe) throw new Error('Bad workbook id');
    return path.join(this.dir, `${safe}.json`);
  }

  async get(id) {
    return JSON.parse(await fsp.readFile(this._path(id), 'utf8'));
  }

  async save(workbook) {
    await fsp.mkdir(this.dir, { recursive: true });
    if (!workbook.id) workbook.id = `wb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    workbook.updated = new Date().toISOString();
    const tmp = `${this._path(workbook.id)}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(workbook), 'utf8');
    await fsp.rename(tmp, this._path(workbook.id));
    return workbook;
  }

  async remove(id) {
    await fsp.unlink(this._path(id));
  }

  /** Import a file already in the folder, or a buffer sent from the browser. */
  async import({ file, buffer, filename }) {
    let name = filename || file;
    if (/\.xlsx$/i.test(name)) {
      let target = file ? path.join(this.dir, path.basename(file)) : null;
      let temp = null;
      if (!target) {
        temp = path.join(this.dir, `.upload-${Date.now()}.xlsx`);
        await fsp.writeFile(temp, buffer);
        target = temp;
      }
      try {
        const wb = await importXlsx(target, path.basename(name));
        return this.save(wb);
      } finally {
        if (temp) await fsp.unlink(temp).catch(() => {});
      }
    }
    const text = buffer ? buffer.toString('utf8') : await fsp.readFile(path.join(this.dir, path.basename(file)), 'utf8');
    return this.save(importCsv(text, path.basename(name)));
  }
}

module.exports = { SheetLibrary, importXlsx, importCsv, exportXlsx, exportCsv, parseCsv, makeZip, colLetters, colIndex };
