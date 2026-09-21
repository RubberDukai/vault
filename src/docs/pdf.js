'use strict';
/**
 * Best-effort PDF text extraction, with no dependencies.
 *
 * A PDF is a graph of objects; text lives in per-page content streams as
 * drawing operators, and the bytes those operators draw are font codes, not
 * characters. Getting words back out means: find the pages, decode their
 * streams, follow each font's ToUnicode map, and reassemble the operators in
 * reading order. This does that well enough to index a textbook. It does not
 * try to be a renderer — the browser already has one of those.
 *
 * Where a font ships no ToUnicode map the output can be garbled; that is
 * detected and reported rather than silently indexed as gibberish.
 *
 * Reference: ISO 32000-1, sections 7 (syntax), 9 (text), 9.10 (ToUnicode).
 */

const fsp = require('node:fs/promises');
const zlib = require('node:zlib');

// --------------------------------------------------------------- lexing

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITER = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

const isWhite = (c) => WHITESPACE.has(c);
const isDelim = (c) => DELIMITER.has(c);
const isRegular = (c) => !isWhite(c) && !isDelim(c);

/**
 * A tokenizer over a latin1 string (one char per byte, offsets preserved).
 * Used for both object syntax and content streams; they share a lexicon.
 */
class Lexer {
  constructor(src, pos = 0) {
    this.src = src;
    this.pos = pos;
  }

  get done() {
    return this.pos >= this.src.length;
  }

  code(offset = 0) {
    return this.src.charCodeAt(this.pos + offset);
  }

  skipSpace() {
    while (!this.done) {
      const c = this.code();
      if (isWhite(c)) this.pos++;
      else if (c === 0x25) { // % comment to end of line
        while (!this.done && this.code() !== 0x0a && this.code() !== 0x0d) this.pos++;
      } else break;
    }
  }

  /** Next token: { t: type, v: value }. Types: num, str, name, op, [ ] << >> { } eof */
  next() {
    this.skipSpace();
    if (this.done) return { t: 'eof' };
    const c = this.code();

    if (c === 0x28) return { t: 'str', v: this._literalString() };
    if (c === 0x3c) {
      if (this.code(1) === 0x3c) { this.pos += 2; return { t: '<<' }; }
      return { t: 'str', v: this._hexString() };
    }
    if (c === 0x3e) {
      if (this.code(1) === 0x3e) { this.pos += 2; return { t: '>>' }; }
      this.pos++; return { t: 'op', v: '>' };
    }
    if (c === 0x5b) { this.pos++; return { t: '[' }; }
    if (c === 0x5d) { this.pos++; return { t: ']' }; }
    if (c === 0x7b) { this.pos++; return { t: '{' }; }
    if (c === 0x7d) { this.pos++; return { t: '}' }; }
    if (c === 0x2f) { this.pos++; return { t: 'name', v: this._regular() }; }
    if (c === 0x29) { this.pos++; return this.next(); } // stray ) — skip

    const word = this._regular();
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: 'num', v: parseFloat(word) };
    return { t: 'op', v: word };
  }

  _regular() {
    const start = this.pos;
    while (!this.done && isRegular(this.code())) this.pos++;
    if (this.pos === start) this.pos++; // never stall
    let s = this.src.slice(start, this.pos);
    // Names can contain #xx escapes.
    if (s.includes('#')) s = s.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return s;
  }

  _literalString() {
    this.pos++; // (
    let depth = 1;
    let out = '';
    while (!this.done) {
      const c = this.code();
      this.pos++;
      if (c === 0x5c) { // backslash
        const n = this.src[this.pos];
        this.pos++;
        switch (n) {
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case '\n': break;
          case '\r': if (this.src[this.pos] === '\n') this.pos++; break;
          default:
            if (n >= '0' && n <= '7') {
              let oct = n;
              for (let i = 0; i < 2 && this.src[this.pos] >= '0' && this.src[this.pos] <= '7'; i++) oct += this.src[this.pos++];
              out += String.fromCharCode(parseInt(oct, 8));
            } else {
              out += n;
            }
        }
      } else if (c === 0x28) { depth++; out += '('; }
      else if (c === 0x29) { depth--; if (depth === 0) break; out += ')'; }
      else out += String.fromCharCode(c);
    }
    return out;
  }

  _hexString() {
    this.pos++; // <
    let hex = '';
    while (!this.done && this.code() !== 0x3e) {
      const ch = this.src[this.pos++];
      if (/[0-9a-fA-F]/.test(ch)) hex += ch;
    }
    this.pos++; // >
    if (hex.length % 2) hex += '0';
    let out = '';
    for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    return out;
  }
}

// ------------------------------------------------------------- objects

class Ref {
  constructor(num, gen) { this.num = num; this.gen = gen; }
}

/** Parse one PDF object (dict, array, name, number, string, ref...) at the lexer's position. */
function parseObject(lexer, depth = 0) {
  if (depth > 64) return null;
  const tok = lexer.next();
  return parseFromToken(lexer, tok, depth);
}

function parseFromToken(lexer, tok, depth) {
  switch (tok.t) {
    case 'num': {
      // Could be the start of a reference: N G R
      const save = lexer.pos;
      const t2 = lexer.next();
      if (t2.t === 'num' && Number.isInteger(tok.v) && Number.isInteger(t2.v)) {
        const save2 = lexer.pos;
        const t3 = lexer.next();
        if (t3.t === 'op' && t3.v === 'R') return new Ref(tok.v, t2.v);
        lexer.pos = save2;
        lexer.pos = save;
        return tok.v;
      }
      lexer.pos = save;
      return tok.v;
    }
    case 'str': return { str: tok.v };
    case 'name': return { name: tok.v };
    case '[': {
      const arr = [];
      for (;;) {
        const t = lexer.next();
        if (t.t === ']' || t.t === 'eof') break;
        arr.push(parseFromToken(lexer, t, depth + 1));
      }
      return arr;
    }
    case '<<': {
      const dict = {};
      for (;;) {
        const t = lexer.next();
        if (t.t === '>>' || t.t === 'eof') break;
        if (t.t !== 'name') continue;
        dict[t.v] = parseObject(lexer, depth + 1);
      }
      return dict;
    }
    case 'op':
      if (tok.v === 'true') return true;
      if (tok.v === 'false') return false;
      if (tok.v === 'null') return null;
      return { op: tok.v };
    default:
      return null;
  }
}

const isName = (v, n) => v && typeof v === 'object' && v.name === n;
const nameOf = (v) => (v && typeof v === 'object' && 'name' in v ? v.name : null);

// ---------------------------------------------------------------- CMaps

/**
 * Parse a ToUnicode CMap into a code -> string map, plus code byte width.
 *
 * The width comes from the mapping entries themselves, not from the
 * codespace declaration: InDesign writes `<0000> <FFFF>` above one-byte
 * fonts, and trusting it turns every page into replacement characters.
 */
function parseCMap(text) {
  const map = new Map();
  let bytes = 0;
  const lexer = new Lexer(text);
  const hexToCode = (s) => { let n = 0; for (let i = 0; i < s.length; i++) n = (n << 8) | s.charCodeAt(i); return n; };
  const hexToUtf16 = (s) => {
    let out = '';
    for (let i = 0; i + 1 < s.length; i += 2) out += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1));
    if (s.length % 2) out += String.fromCharCode(s.charCodeAt(s.length - 1));
    return out;
  };

  const stack = [];
  for (;;) {
    const t = lexer.next();
    if (t.t === 'eof') break;
    if (t.t === 'op') {
      if (t.v === 'begincodespacerange') {
        for (;;) {
          const lo = lexer.next();
          if (lo.t !== 'str') break;
          const hi = lexer.next();
          if (hi.t !== 'str') break;
        }
      } else if (t.v === 'beginbfchar') {
        for (;;) {
          const src = lexer.next();
          if (src.t !== 'str') break;
          const dst = lexer.next();
          if (dst.t === 'str') map.set(hexToCode(src.v), hexToUtf16(dst.v));
          else if (dst.t === 'name') map.set(hexToCode(src.v), dst.v);
          bytes = Math.max(bytes, src.v.length);
        }
      } else if (t.v === 'beginbfrange') {
        for (;;) {
          const lo = lexer.next();
          if (lo.t !== 'str') break;
          const hi = lexer.next();
          if (hi.t !== 'str') break;
          bytes = Math.max(bytes, lo.v.length);
          const a = hexToCode(lo.v);
          const b = hexToCode(hi.v);
          const dst = lexer.next();
          if (dst.t === 'str') {
            const base = hexToUtf16(dst.v);
            const last = base.charCodeAt(base.length - 1);
            for (let c = a; c <= b && c - a < 65536; c++) {
              map.set(c, base.slice(0, -1) + String.fromCharCode(last + (c - a)));
            }
          } else if (dst.t === '[') {
            let c = a;
            for (;;) {
              const item = lexer.next();
              if (item.t === ']' || item.t === 'eof') break;
              if (item.t === 'str') map.set(c++, hexToUtf16(item.v));
            }
          }
        }
      }
      stack.length = 0;
    } else {
      stack.push(t);
    }
  }
  return { map, bytes: Math.min(bytes || 1, 4) };
}

// ------------------------------------------------------------ document

class PdfDocument {
  constructor(src) {
    this.src = src;               // latin1 string of the whole file
    this.offsets = new Map();     // object number -> byte offset of "N G obj"
    this.compressed = new Map();  // object number -> { streamNum, index }
    this.cache = new Map();       // object number -> parsed value
    this.trailer = {};
    this.pages = [];
    this.title = null;
    this.author = null;
    this.warnings = [];
  }

  static async open(filePath) {
    const buf = await fsp.readFile(filePath);
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Not a PDF');
    const doc = new PdfDocument(buf.toString('latin1'));
    doc._index();
    doc._readTrailer();
    doc._readObjectStreams();
    doc._readPages();
    doc._readInfo();
    return doc;
  }

  // Scan for every "N G obj" rather than trusting the xref table, which is
  // wrong in a remarkable fraction of real-world files.
  _index() {
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(this.src)) !== null) {
      // Make sure this is not the tail of a longer number.
      if (m.index > 0 && isRegular(this.src.charCodeAt(m.index - 1))) continue;
      this.offsets.set(Number(m[1]), m.index + m[0].length);
    }
  }

  _readTrailer() {
    // Classic trailer dictionaries; the last one wins.
    const re = /trailer\s*<</g;
    let m;
    let last = null;
    while ((m = re.exec(this.src)) !== null) last = m.index + 'trailer'.length;
    if (last !== null) {
      const lexer = new Lexer(this.src, last);
      const dict = parseObject(lexer);
      if (dict && typeof dict === 'object') Object.assign(this.trailer, dict);
    }

    // Cross-reference streams carry the trailer keys in their own dictionary.
    if (!this.trailer.Root) {
      for (const [num] of this.offsets) {
        const obj = this._rawObject(num);
        if (obj && obj.dict && isName(obj.dict.Type, 'XRef')) {
          if (obj.dict.Root) this.trailer.Root = obj.dict.Root;
          if (obj.dict.Info && !this.trailer.Info) this.trailer.Info = obj.dict.Info;
        }
      }
    }
  }

  /** Parse the object at an offset: { dict|value, stream? } */
  _rawObject(num) {
    const offset = this.offsets.get(num);
    if (offset === undefined) return null;
    const lexer = new Lexer(this.src, offset);
    const value = parseObject(lexer);

    lexer.skipSpace();
    if (this.src.startsWith('stream', lexer.pos)) {
      let p = lexer.pos + 6;
      if (this.src[p] === '\r') p++;
      if (this.src[p] === '\n') p++;
      const dict = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      let length = this.resolve(dict.Length);
      let end;
      if (typeof length === 'number' && length >= 0 && this.src.startsWith('endstream', this._skipWhite(p + length))) {
        end = p + length;
      } else {
        end = this.src.indexOf('endstream', p);
        if (end === -1) end = this.src.length;
        while (end > p && isWhite(this.src.charCodeAt(end - 1))) end--;
      }
      return { dict, stream: this.src.slice(p, end) };
    }
    return { dict: value };
  }

  _skipWhite(p) {
    while (p < this.src.length && isWhite(this.src.charCodeAt(p))) p++;
    return p;
  }

  /** Decode a stream's bytes according to its filters. Returns latin1 string. */
  decodeStream(obj) {
    if (!obj || obj.stream === undefined) return null;
    let data = Buffer.from(obj.stream, 'latin1');
    let filters = this.resolve(obj.dict.Filter);
    if (!filters) return data.toString('latin1');
    if (!Array.isArray(filters)) filters = [filters];

    let params = this.resolve(obj.dict.DecodeParms);
    if (!Array.isArray(params)) params = [params];

    for (let i = 0; i < filters.length; i++) {
      const filter = nameOf(this.resolve(filters[i]));
      const parm = this.resolve(params[i]) || {};
      try {
        if (filter === 'FlateDecode' || filter === 'Fl') {
          data = zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: 256 * 1024 * 1024 });
          data = this._applyPredictor(data, parm);
        } else if (filter === 'ASCIIHexDecode' || filter === 'AHx') {
          const hex = data.toString('latin1').replace(/[^0-9a-fA-F]/g, '');
          data = Buffer.from(hex, 'hex');
        } else if (filter === 'ASCII85Decode' || filter === 'A85') {
          data = ascii85Decode(data.toString('latin1'));
        } else if (filter === 'LZWDecode' || filter === 'DCTDecode' || filter === 'JPXDecode' || filter === 'CCITTFaxDecode' || filter === 'JBIG2Decode') {
          return null; // images, or a compression we do not speak
        }
      } catch {
        return null;
      }
    }
    return data.toString('latin1');
  }

  /** PNG predictors, used on cross-reference and object streams. */
  _applyPredictor(data, parm) {
    const predictor = this.resolve(parm.Predictor) || 1;
    if (predictor < 10) return data;
    const columns = this.resolve(parm.Columns) || 1;
    const colors = this.resolve(parm.Colors) || 1;
    const bpc = this.resolve(parm.BitsPerComponent) || 8;
    const bpp = Math.ceil((colors * bpc) / 8);
    const rowLength = Math.ceil((colors * bpc * columns) / 8);
    const rows = Math.floor(data.length / (rowLength + 1));
    const out = Buffer.alloc(rows * rowLength);
    let prev = Buffer.alloc(rowLength);

    for (let r = 0; r < rows; r++) {
      const type = data[r * (rowLength + 1)];
      const row = data.subarray(r * (rowLength + 1) + 1, (r + 1) * (rowLength + 1));
      const cur = Buffer.from(row);
      for (let i = 0; i < rowLength; i++) {
        const left = i >= bpp ? cur[i - bpp] : 0;
        const up = prev[i];
        const upLeft = i >= bpp ? prev[i - bpp] : 0;
        switch (type) {
          case 1: cur[i] = (cur[i] + left) & 0xff; break;
          case 2: cur[i] = (cur[i] + up) & 0xff; break;
          case 3: cur[i] = (cur[i] + ((left + up) >> 1)) & 0xff; break;
          case 4: {
            const p = left + up - upLeft;
            const pa = Math.abs(p - left);
            const pb = Math.abs(p - up);
            const pc = Math.abs(p - upLeft);
            cur[i] = (cur[i] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff;
            break;
          }
          default: break;
        }
      }
      cur.copy(out, r * rowLength);
      prev = cur;
    }
    return out;
  }

  /** Objects packed inside object streams (PDF 1.5+) are otherwise invisible. */
  _readObjectStreams() {
    for (const [num] of this.offsets) {
      const obj = this._rawObject(num);
      if (!obj || !obj.stream || !isName(obj.dict.Type, 'ObjStm')) continue;
      const data = this.decodeStream(obj);
      if (data === null) continue;
      const count = this.resolve(obj.dict.N) || 0;
      const first = this.resolve(obj.dict.First) || 0;
      const header = new Lexer(data.slice(0, first));
      for (let i = 0; i < count; i++) {
        const n = header.next();
        const off = header.next();
        if (n.t !== 'num' || off.t !== 'num') break;
        if (!this.offsets.has(n.v)) {
          this.compressed.set(n.v, { data, offset: first + off.v });
        }
      }
    }
  }

  /** Follow a reference (or return the value if it is not one). */
  resolve(value, depth = 0) {
    if (!(value instanceof Ref) || depth > 32) return value;
    if (this.cache.has(value.num)) return this.cache.get(value.num);

    let parsed = null;
    if (this.offsets.has(value.num)) {
      const obj = this._rawObject(value.num);
      parsed = obj && obj.stream !== undefined ? obj : obj ? obj.dict : null;
    } else if (this.compressed.has(value.num)) {
      const { data, offset } = this.compressed.get(value.num);
      parsed = parseObject(new Lexer(data, offset));
    }
    this.cache.set(value.num, parsed);
    return parsed;
  }

  _dictOf(value) {
    const v = this.resolve(value);
    if (!v || typeof v !== 'object') return null;
    return v.stream !== undefined ? v.dict : v;
  }

  _readPages() {
    const root = this._dictOf(this.trailer.Root);
    const visited = new Set();

    const walk = (nodeRef, inherited) => {
      const node = this._dictOf(nodeRef);
      if (!node) return;
      const key = nodeRef instanceof Ref ? nodeRef.num : Symbol();
      if (visited.has(key)) return;
      visited.add(key);

      const resources = node.Resources ? node.Resources : inherited.resources;
      if (isName(node.Type, 'Page') || (!node.Kids && node.Contents)) {
        this.pages.push({ dict: node, resources });
        return;
      }
      const kids = this.resolve(node.Kids);
      if (Array.isArray(kids)) for (const kid of kids) walk(kid, { resources });
    };

    if (root && root.Pages) walk(root.Pages, { resources: null });

    // A broken or missing page tree: fall back to every page object in file order.
    if (this.pages.length === 0) {
      const nums = [...this.offsets.keys(), ...this.compressed.keys()].sort((a, b) => a - b);
      for (const num of nums) {
        const dict = this._dictOf(new Ref(num, 0));
        if (dict && isName(dict.Type, 'Page')) this.pages.push({ dict, resources: dict.Resources || null });
      }
      if (this.pages.length) this.warnings.push('Page tree was unreadable; pages taken in file order');
    }
  }

  _readInfo() {
    const info = this._dictOf(this.trailer.Info);
    const text = (v) => {
      const r = this.resolve(v);
      if (!r || typeof r !== 'object' || !('str' in r)) return null;
      return decodePdfString(r.str);
    };
    if (info) {
      this.title = text(info.Title);
      this.author = text(info.Author);
    }
  }

  get pageCount() {
    return this.pages.length;
  }

  /** Fonts available to a page: resource name -> { map, bytes }. */
  _fontsFor(page) {
    const resources = this._dictOf(page.resources);
    const fonts = resources ? this._dictOf(resources.Font) : null;
    const out = new Map();
    if (!fonts) return out;

    for (const [name, ref] of Object.entries(fonts)) {
      const font = this._dictOf(ref);
      if (!font) continue;
      let entry = { map: null, bytes: 1 };
      const subtype = nameOf(font.Subtype);
      if (subtype === 'Type0') entry.bytes = 2;

      const toUnicode = this.resolve(font.ToUnicode);
      if (toUnicode && toUnicode.stream !== undefined) {
        const text = this.decodeStream(toUnicode);
        if (text) {
          const parsed = parseCMap(text);
          // Simple fonts (TrueType, Type1, Type3) address glyphs with one byte
          // whatever their CMap claims; composite fonts use two or more.
          entry = { map: parsed.map, bytes: subtype === 'Type0' ? Math.max(2, parsed.bytes) : 1 };
        }
      }
      out.set(name, entry);
    }
    return out;
  }

  /** Plain text of one page (0-based). */
  pageText(index) {
    const page = this.pages[index];
    if (!page) return null;

    let contents = this.resolve(page.dict.Contents);
    if (!contents) return '';
    if (!Array.isArray(contents)) contents = [contents];

    let stream = '';
    for (const part of contents) {
      const obj = this.resolve(part);
      const decoded = obj && obj.stream !== undefined ? this.decodeStream(obj) : null;
      if (decoded) stream += decoded + '\n';
    }
    if (!stream) return '';

    return extractText(stream, this._fontsFor(page));
  }

  /** Every page's text, plus a garbling estimate for the whole document. */
  allText() {
    const pages = [];
    let printable = 0;
    let total = 0;
    for (let i = 0; i < this.pages.length; i++) {
      const text = this.pageText(i) || '';
      pages.push(text);
      for (const ch of text) {
        total++;
        const c = ch.charCodeAt(0);
        if ((c >= 0x20 && c < 0x7f) || c === 0x0a || (c >= 0xa0 && c < 0x2000) || (c >= 0x3000 && c < 0xffff)) printable++;
      }
    }
    return { pages, garbled: total > 200 && printable / total < 0.85 };
  }
}

// ---------------------------------------------------------- text extraction

function decodePdfString(s) {
  // UTF-16BE with BOM, else PDFDocEncoding which is close enough to latin1.
  if (s.length >= 2 && s.charCodeAt(0) === 0xfe && s.charCodeAt(1) === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < s.length; i += 2) out += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1));
    return out;
  }
  return s;
}

function decodeWithFont(bytes, font) {
  if (!font || !font.map) {
    return font && font.bytes === 2 ? '' : bytes; // unmapped CID text is unrecoverable
  }
  let out = '';
  const width = font.bytes;
  for (let i = 0; i < bytes.length; i += width) {
    let code = 0;
    for (let k = 0; k < width; k++) code = (code << 8) | (bytes.charCodeAt(i + k) || 0);
    const mapped = font.map.get(code);
    if (mapped !== undefined) out += mapped;
    else if (width === 1) out += bytes[i];
    else out += '�';
  }
  return out;
}

/**
 * Walk a content stream and reassemble the text it draws. Line breaks come
 * from the text-positioning operators; word gaps from TJ kerning adjustments.
 */
function extractText(stream, fonts) {
  const lexer = new Lexer(stream);
  const operands = [];
  let font = null;
  let fontSize = 1;
  let scale = 1;          // horizontal scale from the text matrix
  let out = '';
  let lastY = null;
  let lastX = null;
  let lineHasText = false;
  let runChars = 0;       // glyphs drawn since the last positioning operator

  const emit = (s) => {
    if (!s) return;
    out += s;
    lineHasText = true;
    runChars += s.length;
  };
  const newline = () => {
    if (lineHasText) out += '\n';
    lineHasText = false;
    runChars = 0;
  };

  // Some generators position every glyph individually. A horizontal move is
  // then only a word break if it is clearly longer than the text just drawn
  // would have advanced on its own — roughly half an em per glyph.
  const horizontalMove = (dx) => {
    const em = fontSize * scale || 1;
    const expected = runChars * em * 0.5;
    if (dx < -em) newline();
    else if (dx > expected + em * 0.22 && lineHasText) emit(' ');
    runChars = 0;
  };

  for (;;) {
    const tok = lexer.next();
    if (tok.t === 'eof') break;

    if (tok.t !== 'op') {
      if (tok.t === '[') {
        const arr = [];
        for (;;) {
          const t = lexer.next();
          if (t.t === ']' || t.t === 'eof') break;
          arr.push(t);
        }
        operands.push({ t: 'arr', v: arr });
      } else if (tok.t === '<<') {
        // Inline dictionary (marked content properties): skip to matching >>
        let depth = 1;
        while (depth > 0) {
          const t = lexer.next();
          if (t.t === 'eof') break;
          if (t.t === '<<') depth++;
          if (t.t === '>>') depth--;
        }
      } else {
        operands.push(tok);
      }
      if (operands.length > 64) operands.shift();
      continue;
    }

    const op = tok.v;
    switch (op) {
      case 'BT':
        lastY = null;
        lastX = null;
        scale = 1;
        break;
      case 'ET':
        newline();
        break;
      case 'Tf': {
        const nameTok = operands[operands.length - 2];
        const sizeTok = operands[operands.length - 1];
        font = nameTok && nameTok.t === 'name' ? fonts.get(nameTok.v) || null : null;
        fontSize = sizeTok && sizeTok.t === 'num' ? Math.abs(sizeTok.v) : 1;
        break;
      }
      case 'Td':
      case 'TD': {
        const tx = operands[operands.length - 2];
        const ty = operands[operands.length - 1];
        const dy = ty && ty.t === 'num' ? ty.v : 0;
        const dx = tx && tx.t === 'num' ? tx.v : 0;
        if (Math.abs(dy) > fontSize * scale * 0.3) newline();
        else horizontalMove(dx);
        if (lastX !== null) lastX += dx;
        if (lastY !== null) lastY += dy;
        break;
      }
      case 'T*':
        newline();
        break;
      case 'Tm': {
        const a = operands[operands.length - 6];
        const x = operands[operands.length - 2];
        const y = operands[operands.length - 1];
        if (a && a.t === 'num' && a.v !== 0) scale = Math.abs(a.v);
        if (x && x.t === 'num' && y && y.t === 'num') {
          if (lastY !== null && Math.abs(y.v - lastY) > fontSize * scale * 0.3) newline();
          else if (lastX !== null) horizontalMove(x.v - lastX);
          lastX = x.v;
          lastY = y.v;
        }
        break;
      }
      case 'Tj':
      case "'":
      case '"': {
        if (op !== 'Tj') newline();
        const s = operands[operands.length - 1];
        if (s && s.t === 'str') emit(decodeWithFont(s.v, font));
        break;
      }
      case 'TJ': {
        const arr = operands[operands.length - 1];
        if (arr && arr.t === 'arr') {
          for (const item of arr.v) {
            if (item.t === 'str') emit(decodeWithFont(item.v, font));
            // A large negative adjustment is a word gap in thousandths of an em.
            else if (item.t === 'num' && item.v < -180) emit(' ');
          }
        }
        break;
      }
      case 'BI': {
        // Inline image: binary data until EI. Skip it.
        const end = stream.indexOf('EI', lexer.pos);
        lexer.pos = end === -1 ? stream.length : end + 2;
        break;
      }
      default:
        break;
    }
    operands.length = 0;
  }

  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ascii85Decode(text) {
  const clean = text.replace(/^<~/, '').replace(/~>$/, '').replace(/\s/g, '');
  const out = [];
  let tuple = 0;
  let count = 0;
  for (const ch of clean) {
    if (ch === 'z') { out.push(0, 0, 0, 0); continue; }
    tuple = tuple * 85 + (ch.charCodeAt(0) - 33);
    count++;
    if (count === 5) {
      out.push((tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff);
      tuple = 0;
      count = 0;
    }
  }
  if (count > 0) {
    for (let i = count; i < 5; i++) tuple = tuple * 85 + 84;
    const bytes = [(tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff];
    out.push(...bytes.slice(0, count - 1));
  }
  return Buffer.from(out);
}

module.exports = { PdfDocument, extractText, parseCMap };
