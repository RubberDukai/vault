'use strict';
/* A spreadsheet formula engine: tokeniser, parser, evaluator and a library
   of the functions a household actually uses. Cell values are numbers,
   strings, booleans, null (blank) or an error object. Dates are Excel serial
   numbers (days since 30 Dec 1899) so arithmetic on them just works. */

const SHEET_ERRORS = {
  DIV0: { error: '#DIV/0!' }, NAME: { error: '#NAME?' }, REF: { error: '#REF!' }, VALUE: { error: '#VALUE!' },
  NA: { error: '#N/A' }, CYCLE: { error: '#CYCLE!' }, NUM: { error: '#NUM!' },
};
const isErr = (v) => v !== null && typeof v === 'object' && 'error' in v;

// ------------------------------------------------------------- addresses

function colToIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function indexToCol(index) {
  let s = '';
  let n = index + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const addr = (row, col) => `${indexToCol(col)}${row + 1}`;
function parseAddr(text) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(text);
  return m ? { row: Number(m[2]) - 1, col: colToIndex(m[1]) } : null;
}

// ----------------------------------------------------------------- dates

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const dateToSerial = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - EXCEL_EPOCH) / 86400000);
function serialToDate(serial) {
  return new Date(EXCEL_EPOCH + Math.floor(serial) * 86400000);
}
function parseDateText(text) {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return dateToSerial(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(text); // British: day first
  if (m) return dateToSerial(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2})$/.exec(text);
  if (m) return dateToSerial(2000 + Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}
function formatDateSerial(serial) {
  const d = serialToDate(serial);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

// ------------------------------------------------------------ coercion

/** What a typed cell means as a value: numbers, dates, booleans, else text. */
function literalValue(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw);
  if (s === '') return null;
  const t = s.trim();
  if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return Number(t);
  if (/^-?[\d,]+\.?\d*$/.test(t) && /\d/.test(t)) return Number(t.replace(/,/g, ''));
  if (t === 'TRUE') return true;
  if (t === 'FALSE') return false;
  const date = parseDateText(t);
  if (date !== null) return date;
  return s;
}

function toNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isErr(v)) return v;
  const lit = literalValue(String(v).trim());
  if (typeof lit === 'number') return lit;
  const pct = /^(-?[\d.]+)%$/.exec(String(v).trim());
  if (pct) return Number(pct[1]) / 100;
  return SHEET_ERRORS.VALUE;
}
function toText(v) {
  if (v === null || v === undefined) return '';
  if (isErr(v)) return v.error;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}
function toBool(v) {
  if (isErr(v)) return v;
  if (typeof v === 'boolean') return v;
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE') return false;
  return SHEET_ERRORS.VALUE;
}

// ----------------------------------------------------------- tokeniser

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let j = i + 1; let s = '';
      while (j < src.length) { if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += src[j++]; }
      tokens.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    if (ch === "'") { // 'Sheet name'!A1
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw SHEET_ERRORS.NAME;
      tokens.push({ t: 'sheet', v: src.slice(i + 1, end) }); i = end + 1;
      if (src[i] === '!') i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { tokens.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const word = /^[A-Za-z_][A-Za-z0-9_.]*(\$?\d+)?/.exec(src.slice(i)) || /^\$[A-Za-z]{1,3}\$?\d+/.exec(src.slice(i));
    if (word) {
      const text = word[0];
      i += text.length;
      if (src[i] === '!') { tokens.push({ t: 'sheet', v: text }); i++; continue; }
      if (/^\$?[A-Za-z]{1,3}\$?\d+$/.test(text)) { tokens.push({ t: 'ref', v: text }); continue; }
      if (src[i] === '(') { tokens.push({ t: 'func', v: text.toUpperCase() }); continue; }
      const upper = text.toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') { tokens.push({ t: 'bool', v: upper === 'TRUE' }); continue; }
      tokens.push({ t: 'name', v: upper }); continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') { tokens.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^&=<>%'.includes(ch)) { tokens.push({ t: 'op', v: ch }); i++; continue; }
    if (ch === '(') { tokens.push({ t: 'lp' }); i++; continue; }
    if (ch === ')') { tokens.push({ t: 'rp' }); i++; continue; }
    if (ch === ',' || ch === ';') { tokens.push({ t: 'comma' }); i++; continue; }
    if (ch === ':') { tokens.push({ t: 'colon' }); i++; continue; }
    throw SHEET_ERRORS.NAME;
  }
  return tokens;
}

// -------------------------------------------------------------- parser

function parse(src) {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (t) => { const tok = next(); if (!tok || tok.t !== t) throw SHEET_ERRORS.NAME; return tok; };

  function primary() {
    const tok = next();
    if (!tok) throw SHEET_ERRORS.NAME;
    if (tok.t === 'num') return { type: 'num', v: tok.v };
    if (tok.t === 'str') return { type: 'str', v: tok.v };
    if (tok.t === 'bool') return { type: 'bool', v: tok.v };
    if (tok.t === 'lp') { const e = expression(); expect('rp'); return e; }
    if (tok.t === 'op' && (tok.v === '-' || tok.v === '+')) { return { type: 'un', op: tok.v, e: unary() }; }
    if (tok.t === 'sheet') {
      const ref = expect('ref');
      return refOrRange(ref.v, tok.v);
    }
    if (tok.t === 'ref') return refOrRange(tok.v, null);
    if (tok.t === 'func') {
      expect('lp');
      const args = [];
      if (peek() && peek().t !== 'rp') {
        for (;;) {
          if (peek() && (peek().t === 'comma')) { args.push({ type: 'blank' }); next(); continue; }
          args.push(expression());
          if (peek() && peek().t === 'comma') { next(); if (peek() && peek().t === 'rp') { args.push({ type: 'blank' }); } continue; }
          break;
        }
      }
      expect('rp');
      return { type: 'call', name: tok.v, args };
    }
    if (tok.t === 'name') {
      if (tok.v === 'PI') return { type: 'num', v: Math.PI };
      throw SHEET_ERRORS.NAME;
    }
    throw SHEET_ERRORS.NAME;
  }
  function refOrRange(first, sheet) {
    const a = parseAddr(first);
    if (!a) throw SHEET_ERRORS.REF;
    if (peek() && peek().t === 'colon') {
      next();
      const b = parseAddr(expect('ref').v);
      if (!b) throw SHEET_ERRORS.REF;
      return { type: 'range', sheet, r1: Math.min(a.row, b.row), c1: Math.min(a.col, b.col), r2: Math.max(a.row, b.row), c2: Math.max(a.col, b.col) };
    }
    return { type: 'ref', sheet, row: a.row, col: a.col };
  }
  function unary() {
    let e = primary();
    while (peek() && peek().t === 'op' && peek().v === '%') { next(); e = { type: 'pct', e }; }
    return e;
  }
  function power() {
    // Left to right, as Excel does it: 2^3^2 is 64, not 512.
    let l = unary();
    while (peek() && peek().t === 'op' && peek().v === '^') { next(); l = { type: 'bin', op: '^', l, r: unary() }; }
    return l;
  }
  function term() {
    let l = power();
    while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) { const op = next().v; l = { type: 'bin', op, l, r: power() }; }
    return l;
  }
  function additive() {
    let l = term();
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) { const op = next().v; l = { type: 'bin', op, l, r: term() }; }
    return l;
  }
  function concat() {
    let l = additive();
    while (peek() && peek().t === 'op' && peek().v === '&') { next(); l = { type: 'bin', op: '&', l, r: additive() }; }
    return l;
  }
  function expression() {
    let l = concat();
    while (peek() && peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) { const op = next().v; l = { type: 'bin', op, l, r: concat() }; }
    return l;
  }
  const ast = expression();
  if (pos < tokens.length) throw SHEET_ERRORS.NAME;
  return ast;
}

// ------------------------------------------------------------ functions

const flatten = (args) => {
  const out = [];
  for (const a of args) {
    if (Array.isArray(a)) for (const row of a) for (const v of row) out.push(v);
    else out.push(a);
  }
  return out;
};
const numbers = (args) => flatten(args).filter((v) => typeof v === 'number');
const firstErr = (args) => flatten(args).find(isErr);

function criteriaMatch(criteria) {
  // "=x", "<>x", ">5", ">=5", "<5", "<=5", "text", "app*" (wildcards)
  const c = criteria === null ? '' : String(criteria);
  const m = /^(<>|>=|<=|=|>|<)(.*)$/.exec(c);
  if (m) {
    const op = m[1];
    const rhs = literalValue(m[2]);
    return (v) => {
      if (typeof rhs === 'number') {
        const n = typeof v === 'number' ? v : (typeof v === 'string' ? literalValue(v) : null);
        if (typeof n !== 'number') return op === '<>';
        return op === '=' ? n === rhs : op === '<>' ? n !== rhs : op === '>' ? n > rhs : op === '<' ? n < rhs : op === '>=' ? n >= rhs : n <= rhs;
      }
      const s = toText(v).toLowerCase(); const t = String(m[2]).toLowerCase();
      return op === '=' ? s === t : op === '<>' ? s !== t : op === '>' ? s > t : op === '<' ? s < t : op === '>=' ? s >= t : s <= t;
    };
  }
  if (/[*?]/.test(c)) {
    const re = new RegExp(`^${c.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
    return (v) => re.test(toText(v));
  }
  const lit = literalValue(c);
  return (v) => (typeof lit === 'number' ? (typeof v === 'number' ? v === lit : literalValue(String(v ?? '')) === lit) : toText(v).toLowerCase() === c.toLowerCase());
}

const asMatrix = (a) => (Array.isArray(a) ? a : [[a]]);

const FUNCTIONS = {
  SUM: (args) => firstErr(args) || numbers(args).reduce((s, n) => s + n, 0),
  PRODUCT: (args) => firstErr(args) || numbers(args).reduce((s, n) => s * n, 1),
  AVERAGE: (args) => { const e = firstErr(args); if (e) return e; const n = numbers(args); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : SHEET_ERRORS.DIV0; },
  MEDIAN: (args) => { const n = numbers(args).sort((a, b) => a - b); if (!n.length) return SHEET_ERRORS.NUM; const m = n.length >> 1; return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; },
  MIN: (args) => { const n = numbers(args); return n.length ? Math.min(...n) : 0; },
  MAX: (args) => { const n = numbers(args); return n.length ? Math.max(...n) : 0; },
  COUNT: (args) => numbers(args).length,
  COUNTA: (args) => flatten(args).filter((v) => v !== null && v !== '').length,
  COUNTBLANK: (args) => flatten(args).filter((v) => v === null || v === '').length,
  STDEV: (args) => { const n = numbers(args); if (n.length < 2) return SHEET_ERRORS.DIV0; const m = n.reduce((s, x) => s + x, 0) / n.length; return Math.sqrt(n.reduce((s, x) => s + (x - m) ** 2, 0) / (n.length - 1)); },
  VAR: (args) => { const n = numbers(args); if (n.length < 2) return SHEET_ERRORS.DIV0; const m = n.reduce((s, x) => s + x, 0) / n.length; return n.reduce((s, x) => s + (x - m) ** 2, 0) / (n.length - 1); },
  LARGE: ([r, k]) => { const n = numbers([r]).sort((a, b) => b - a); const i = toNumber(k); return n[i - 1] ?? SHEET_ERRORS.NUM; },
  SMALL: ([r, k]) => { const n = numbers([r]).sort((a, b) => a - b); const i = toNumber(k); return n[i - 1] ?? SHEET_ERRORS.NUM; },
  RANK: ([v, r, order]) => { const n = numbers([r]); const x = toNumber(v); if (isErr(x)) return x; const asc = toNumber(order || 0) !== 0; const sorted = n.slice().sort((a, b) => (asc ? a - b : b - a)); const i = sorted.indexOf(x); return i < 0 ? SHEET_ERRORS.NA : i + 1; },
  ABS: ([x]) => num1(x, Math.abs),
  SQRT: ([x]) => num1(x, (n) => (n < 0 ? SHEET_ERRORS.NUM : Math.sqrt(n))),
  EXP: ([x]) => num1(x, Math.exp),
  LN: ([x]) => num1(x, (n) => (n <= 0 ? SHEET_ERRORS.NUM : Math.log(n))),
  LOG: ([x, b]) => num1(x, (n) => (n <= 0 ? SHEET_ERRORS.NUM : Math.log(n) / Math.log(b === undefined ? 10 : toNumber(b)))),
  LOG10: ([x]) => num1(x, (n) => (n <= 0 ? SHEET_ERRORS.NUM : Math.log10(n))),
  POWER: ([x, y]) => { const a = toNumber(x); const b = toNumber(y); return isErr(a) ? a : isErr(b) ? b : Math.pow(a, b); },
  MOD: ([x, y]) => { const a = toNumber(x); const b = toNumber(y); if (isErr(a)) return a; if (isErr(b)) return b; if (b === 0) return SHEET_ERRORS.DIV0; return a - b * Math.floor(a / b); },
  INT: ([x]) => num1(x, Math.floor),
  ROUND: ([x, d]) => num1(x, (n) => roundTo(n, d === undefined ? 0 : toNumber(d))),
  ROUNDUP: ([x, d]) => num1(x, (n) => { const p = Math.pow(10, d === undefined ? 0 : toNumber(d)); return Math.sign(n) * Math.ceil(Math.abs(n) * p - 1e-12) / p; }),
  ROUNDDOWN: ([x, d]) => num1(x, (n) => { const p = Math.pow(10, d === undefined ? 0 : toNumber(d)); return Math.sign(n) * Math.floor(Math.abs(n) * p + 1e-12) / p; }),
  FLOOR: ([x, s]) => num1(x, (n) => { const step = s === undefined ? 1 : toNumber(s); return step ? Math.floor(n / step) * step : SHEET_ERRORS.DIV0; }),
  CEILING: ([x, s]) => num1(x, (n) => { const step = s === undefined ? 1 : toNumber(s); return step ? Math.ceil(n / step) * step : SHEET_ERRORS.DIV0; }),
  TRUNC: ([x]) => num1(x, Math.trunc),
  SIGN: ([x]) => num1(x, Math.sign),
  PI: () => Math.PI,
  RAND: () => Math.random(),
  RANDBETWEEN: ([a, b]) => { const lo = toNumber(a); const hi = toNumber(b); return Math.floor(lo + Math.random() * (hi - lo + 1)); },
  SIN: ([x]) => num1(x, Math.sin), COS: ([x]) => num1(x, Math.cos), TAN: ([x]) => num1(x, Math.tan),
  ASIN: ([x]) => num1(x, Math.asin), ACOS: ([x]) => num1(x, Math.acos), ATAN: ([x]) => num1(x, Math.atan),
  ATAN2: ([x, y]) => Math.atan2(toNumber(y), toNumber(x)),
  RADIANS: ([x]) => num1(x, (n) => n * Math.PI / 180), DEGREES: ([x]) => num1(x, (n) => n * 180 / Math.PI),
  SUMPRODUCT: (args) => { const ms = args.map(asMatrix); const rows = ms[0].length; const cols = ms[0][0].length; let s = 0; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { let p = 1; for (const m of ms) { const v = m[r] && m[r][c]; p *= typeof v === 'number' ? v : 0; } s += p; } return s; },
  SUMIF: ([range, crit, sumRange]) => condAgg(range, crit, sumRange, 'sum'),
  COUNTIF: ([range, crit]) => condAgg(range, crit, undefined, 'count'),
  AVERAGEIF: ([range, crit, avgRange]) => condAgg(range, crit, avgRange, 'avg'),
  SUMIFS: (args) => multiCond(args, 'sum'), COUNTIFS: (args) => multiCond([null, ...args], 'count'), AVERAGEIFS: (args) => multiCond(args, 'avg'),
  MAXIFS: (args) => multiCond(args, 'max'), MINIFS: (args) => multiCond(args, 'min'),
  IF: ([c, a, b]) => { const t = toBool(c); if (isErr(t)) return t; return t ? (a === undefined ? true : a) : (b === undefined ? false : b); },
  IFS: (args) => { for (let i = 0; i + 1 < args.length; i += 2) { const t = toBool(args[i]); if (isErr(t)) return t; if (t) return args[i + 1]; } return SHEET_ERRORS.NA; },
  AND: (args) => { for (const v of flatten(args)) { const t = toBool(v); if (isErr(t)) return t; if (!t) return false; } return true; },
  OR: (args) => { for (const v of flatten(args)) { const t = toBool(v); if (isErr(t)) return t; if (t) return true; } return false; },
  NOT: ([x]) => { const t = toBool(x); return isErr(t) ? t : !t; },
  XOR: (args) => flatten(args).filter((v) => toBool(v) === true).length % 2 === 1,
  IFERROR: ([v, alt]) => (isErr(v) ? (alt === undefined ? '' : alt) : v),
  IFNA: ([v, alt]) => (isErr(v) && v.error === '#N/A' ? alt : v),
  ISBLANK: ([v]) => v === null || v === '', ISNUMBER: ([v]) => typeof v === 'number', ISTEXT: ([v]) => typeof v === 'string',
  ISERROR: ([v]) => isErr(v), ISEVEN: ([v]) => num1(v, (n) => Math.floor(n) % 2 === 0), ISODD: ([v]) => num1(v, (n) => Math.abs(Math.floor(n)) % 2 === 1),
  LEN: ([s]) => toText(s).length,
  LEFT: ([s, n]) => toText(s).slice(0, n === undefined ? 1 : toNumber(n)),
  RIGHT: ([s, n]) => { const t = toText(s); const k = n === undefined ? 1 : toNumber(n); return k >= t.length ? t : t.slice(t.length - k); },
  MID: ([s, start, n]) => toText(s).substr(toNumber(start) - 1, toNumber(n)),
  UPPER: ([s]) => toText(s).toUpperCase(), LOWER: ([s]) => toText(s).toLowerCase(),
  PROPER: ([s]) => toText(s).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (m, p, c) => p + c.toUpperCase()),
  TRIM: ([s]) => toText(s).trim().replace(/\s+/g, ' '),
  CONCAT: (args) => flatten(args).map(toText).join(''), CONCATENATE: (args) => flatten(args).map(toText).join(''),
  TEXTJOIN: ([sep, ignore, ...rest]) => flatten(rest).filter((v) => !(toBool(ignore) && (v === null || v === ''))).map(toText).join(toText(sep)),
  REPT: ([s, n]) => toText(s).repeat(Math.max(0, toNumber(n))),
  FIND: ([needle, hay, start]) => { const i = toText(hay).indexOf(toText(needle), (start === undefined ? 1 : toNumber(start)) - 1); return i < 0 ? SHEET_ERRORS.VALUE : i + 1; },
  SEARCH: ([needle, hay, start]) => { const i = toText(hay).toLowerCase().indexOf(toText(needle).toLowerCase(), (start === undefined ? 1 : toNumber(start)) - 1); return i < 0 ? SHEET_ERRORS.VALUE : i + 1; },
  SUBSTITUTE: ([s, from, to]) => toText(s).split(toText(from)).join(toText(to)),
  REPLACE: ([s, start, n, to]) => { const t = toText(s); const i = toNumber(start) - 1; return t.slice(0, i) + toText(to) + t.slice(i + toNumber(n)); },
  VALUE: ([s]) => toNumber(s), N: ([v]) => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0),
  TEXT: ([v, fmt]) => textFormat(v, toText(fmt)),
  EXACT: ([a, b]) => toText(a) === toText(b),
  CHAR: ([n]) => String.fromCharCode(toNumber(n)), CODE: ([s]) => toText(s).charCodeAt(0) || 0,
  TODAY: () => { const d = new Date(); return dateToSerial(d.getFullYear(), d.getMonth() + 1, d.getDate()); },
  NOW: () => { const d = new Date(); return dateToSerial(d.getFullYear(), d.getMonth() + 1, d.getDate()) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; },
  DATE: ([y, m, d]) => dateToSerial(toNumber(y), toNumber(m), toNumber(d)),
  YEAR: ([s]) => num1(s, (n) => serialToDate(n).getUTCFullYear()),
  MONTH: ([s]) => num1(s, (n) => serialToDate(n).getUTCMonth() + 1),
  DAY: ([s]) => num1(s, (n) => serialToDate(n).getUTCDate()),
  WEEKDAY: ([s, type]) => num1(s, (n) => { const d = serialToDate(n).getUTCDay(); return toNumber(type || 1) === 2 ? (d === 0 ? 7 : d) : d + 1; }),
  DAYS: ([a, b]) => { const x = toNumber(a); const y = toNumber(b); return isErr(x) ? x : isErr(y) ? y : Math.round(x - y); },
  EDATE: ([s, months]) => num1(s, (n) => { const d = serialToDate(n); const m = toNumber(months); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate())); return Math.round((t - EXCEL_EPOCH) / 86400000); }),
  EOMONTH: ([s, months]) => num1(s, (n) => { const d = serialToDate(n); const m = toNumber(months); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m + 1, 0)); return Math.round((t - EXCEL_EPOCH) / 86400000); }),
  DATEDIF: ([a, b, unit]) => { const x = toNumber(a); const y = toNumber(b); const u = toText(unit).toUpperCase(); if (isErr(x) || isErr(y)) return SHEET_ERRORS.VALUE; const d1 = serialToDate(x); const d2 = serialToDate(y); if (u === 'D') return Math.floor(y - x); const months = (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + d2.getUTCMonth() - d1.getUTCMonth() - (d2.getUTCDate() < d1.getUTCDate() ? 1 : 0); return u === 'M' ? months : u === 'Y' ? Math.floor(months / 12) : SHEET_ERRORS.NUM; },
  VLOOKUP: ([needle, table, col, approx]) => { const m = asMatrix(table); const c = toNumber(col) - 1; const exact = approx === undefined ? false : !toBool(approx); return lookup(needle, m.map((r) => r[0]), exact) < 0 ? SHEET_ERRORS.NA : (m[lookup(needle, m.map((r) => r[0]), exact)][c] ?? SHEET_ERRORS.REF); },
  HLOOKUP: ([needle, table, row, approx]) => { const m = asMatrix(table); const r = toNumber(row) - 1; const exact = approx === undefined ? false : !toBool(approx); const i = lookup(needle, m[0], exact); return i < 0 ? SHEET_ERRORS.NA : (m[r] ? m[r][i] : SHEET_ERRORS.REF); },
  XLOOKUP: ([needle, lookupRange, returnRange, ifNotFound]) => { const keys = flatten([lookupRange]); const vals = flatten([returnRange]); const i = lookup(needle, keys, true); return i < 0 ? (ifNotFound === undefined ? SHEET_ERRORS.NA : ifNotFound) : vals[i]; },
  INDEX: ([table, row, col]) => { const m = asMatrix(table); const r = toNumber(row); const c = col === undefined ? 1 : toNumber(col); if (m.length === 1 && col === undefined) return m[0][r - 1] ?? SHEET_ERRORS.REF; const rowArr = m[r - 1]; return rowArr ? (rowArr[c - 1] ?? SHEET_ERRORS.REF) : SHEET_ERRORS.REF; },
  MATCH: ([needle, range, type]) => { const keys = flatten([range]); const t = type === undefined ? 1 : toNumber(type); const i = lookup(needle, keys, t === 0); return i < 0 ? SHEET_ERRORS.NA : i + 1; },
  CHOOSE: ([i, ...rest]) => rest[toNumber(i) - 1] ?? SHEET_ERRORS.VALUE,
  ROWS: ([r]) => asMatrix(r).length, COLUMNS: ([r]) => asMatrix(r)[0].length,
  UNIQUE: ([r]) => { const seen = new Set(); return flatten([r]).filter((v) => { const k = toText(v); if (seen.has(k)) return false; seen.add(k); return true; }).length; },
};

function num1(x, fn) { const n = toNumber(x); return isErr(n) ? n : fn(n); }
function roundTo(n, d) { const p = Math.pow(10, d); return Math.round((n + Number.EPSILON * Math.sign(n)) * p) / p; }
function lookup(needle, keys, exact) {
  const nkey = typeof needle === 'string' ? needle.toLowerCase() : needle;
  const norm = (v) => (typeof v === 'string' ? v.toLowerCase() : v);
  if (exact) return keys.findIndex((k) => norm(k) === nkey);
  // Approximate: the last key <= needle, assuming the keys are sorted ascending.
  let best = -1;
  keys.forEach((k, i) => { if (k !== null && norm(k) <= nkey) best = i; });
  return best;
}
function condAgg(range, crit, other, mode) {
  const m = asMatrix(range);
  const o = other === undefined ? m : asMatrix(other);
  const test = criteriaMatch(crit);
  let sum = 0; let count = 0; let max = -Infinity; let min = Infinity;
  for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) {
    if (!test(m[r][c])) continue;
    const v = o[r] ? o[r][c] : null;
    count++;
    if (typeof v === 'number') { sum += v; max = Math.max(max, v); min = Math.min(min, v); }
  }
  if (mode === 'count') return count;
  if (mode === 'sum') return sum;
  if (mode === 'max') return count ? max : 0;
  if (mode === 'min') return count ? min : 0;
  return count ? sum / count : SHEET_ERRORS.DIV0;
}
function multiCond(args, mode) {
  const [target, ...pairs] = args;
  const t = target === null ? null : asMatrix(target);
  const tests = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) tests.push([asMatrix(pairs[i]), criteriaMatch(pairs[i + 1])]);
  const base = t || tests[0][0];
  let sum = 0; let count = 0; let max = -Infinity; let min = Infinity;
  for (let r = 0; r < base.length; r++) for (let c = 0; c < base[r].length; c++) {
    if (!tests.every(([m, test]) => test(m[r] ? m[r][c] : null))) continue;
    const v = t ? t[r][c] : null;
    count++;
    if (typeof v === 'number') { sum += v; max = Math.max(max, v); min = Math.min(min, v); }
  }
  if (mode === 'count') return count;
  if (mode === 'sum') return sum;
  if (mode === 'max') return count ? max : 0;
  if (mode === 'min') return count ? min : 0;
  return count ? sum / count : SHEET_ERRORS.DIV0;
}
function textFormat(v, fmt) {
  const n = toNumber(v);
  if (isErr(n)) return toText(v);
  if (/[dmy]/i.test(fmt.replace(/"[^"]*"/g, ''))) return formatDateSerial(n);
  const dp = (fmt.match(/\.(0+)/) || ['', ''])[1].length;
  if (fmt.includes('%')) return `${(n * 100).toFixed(dp)}%`;
  const s = fmt.includes(',') ? n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }) : n.toFixed(dp);
  const prefix = (fmt.match(/^"([^"]*)"/) || ['', ''])[1] || (/^[£$€]/.test(fmt) ? fmt[0] : '');
  return prefix + s;
}

// ------------------------------------------------------------ evaluator

/**
 * Evaluate every formula in a workbook. `book.sheets[i].cells[addr].v` is
 * what was typed; results land in a values map per sheet. Cells referring to
 * each other are followed on demand; a loop gives #CYCLE!.
 */
class Engine {
  constructor(book) {
    this.book = book;
    this.values = book.sheets.map(() => new Map());
    this.parsed = new Map();
    this.visiting = new Set();
  }

  sheetIndex(name) {
    if (name === null || name === undefined) return null;
    const i = this.book.sheets.findIndex((s) => s.name.toLowerCase() === String(name).toLowerCase());
    return i;
  }

  cellValue(sheet, row, col) {
    const key = addr(row, col);
    const cache = this.values[sheet];
    if (cache.has(key)) return cache.get(key);
    const cell = this.book.sheets[sheet].cells[key];
    const raw = cell ? cell.v : '';
    let value;
    if (typeof raw === 'string' && raw.startsWith('=') && raw.length > 1) {
      const vkey = `${sheet}:${key}`;
      if (this.visiting.has(vkey)) return SHEET_ERRORS.CYCLE;
      this.visiting.add(vkey);
      try {
        value = this.evaluate(this.ast(raw), sheet);
        if (Array.isArray(value)) value = value[0] && value[0].length ? value[0][0] : null;
      } catch (err) {
        value = isErr(err) ? err : SHEET_ERRORS.VALUE;
      } finally {
        this.visiting.delete(vkey);
      }
    } else if (typeof raw === 'string' && raw.startsWith("'")) {
      value = raw.slice(1);
    } else {
      value = literalValue(raw);
    }
    cache.set(key, value);
    return value;
  }

  ast(formula) {
    if (!this.parsed.has(formula)) {
      try { this.parsed.set(formula, parse(formula.slice(1))); } catch (err) { this.parsed.set(formula, { type: 'err', v: isErr(err) ? err : SHEET_ERRORS.NAME }); }
    }
    return this.parsed.get(formula);
  }

  evaluate(node, sheet) {
    switch (node.type) {
      case 'num': case 'str': case 'bool': return node.v;
      case 'blank': return null;
      case 'err': return node.v;
      case 'ref': {
        const s = node.sheet === null ? sheet : this.sheetIndex(node.sheet);
        if (s === null || s < 0) return SHEET_ERRORS.REF;
        return this.cellValue(s, node.row, node.col);
      }
      case 'range': {
        const s = node.sheet === null ? sheet : this.sheetIndex(node.sheet);
        if (s === null || s < 0) return SHEET_ERRORS.REF;
        const out = [];
        for (let r = node.r1; r <= node.r2 && r < node.r1 + 5000; r++) {
          const row = [];
          for (let c = node.c1; c <= node.c2 && c < node.c1 + 200; c++) row.push(this.cellValue(s, r, c));
          out.push(row);
        }
        return out;
      }
      case 'un': { const v = this.scalar(this.evaluate(node.e, sheet)); const n = toNumber(v); return isErr(n) ? n : node.op === '-' ? -n : n; }
      case 'pct': { const n = toNumber(this.scalar(this.evaluate(node.e, sheet))); return isErr(n) ? n : n / 100; }
      case 'bin': return this.binary(node.op, this.scalar(this.evaluate(node.l, sheet)), this.scalar(this.evaluate(node.r, sheet)));
      case 'call': {
        const fn = FUNCTIONS[node.name];
        if (!fn) return SHEET_ERRORS.NAME;
        const args = node.args.map((a) => this.evaluate(a, sheet));
        const result = fn(args);
        return result === undefined ? SHEET_ERRORS.VALUE : (Number.isNaN(result) ? SHEET_ERRORS.NUM : result);
      }
      default: return SHEET_ERRORS.NAME;
    }
  }

  scalar(v) {
    if (!Array.isArray(v)) return v;
    return v.length === 1 && v[0].length === 1 ? v[0][0] : SHEET_ERRORS.VALUE;
  }

  binary(op, a, b) {
    if (isErr(a)) return a;
    if (isErr(b)) return b;
    if (op === '&') return toText(a) + toText(b);
    if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
      const cmp = compare(a, b);
      return op === '=' ? cmp === 0 : op === '<>' ? cmp !== 0 : op === '<' ? cmp < 0 : op === '>' ? cmp > 0 : op === '<=' ? cmp <= 0 : cmp >= 0;
    }
    const x = toNumber(a); const y = toNumber(b);
    if (isErr(x)) return x;
    if (isErr(y)) return y;
    switch (op) {
      case '+': return x + y;
      case '-': return x - y;
      case '*': return x * y;
      case '/': return y === 0 ? SHEET_ERRORS.DIV0 : x / y;
      case '^': return Math.pow(x, y);
      default: return SHEET_ERRORS.NAME;
    }
  }
}

function compare(a, b) {
  const na = a === null ? 0 : a; const nb = b === null ? 0 : b;
  if (typeof na === 'number' && typeof nb === 'number') return na - nb;
  if (typeof na === 'boolean' || typeof nb === 'boolean') return (na === true ? 1 : 0) - (nb === true ? 1 : 0);
  const sa = toText(na).toLowerCase(); const sb = toText(nb).toLowerCase();
  if (typeof na === 'number') return -1; // numbers sort before text
  if (typeof nb === 'number') return 1;
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Show a value the way the cell's style asks. */
function formatValue(value, style) {
  if (value === null || value === undefined) return '';
  if (isErr(value)) return value.error;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const fmt = style && style.fmt;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '#NUM!';
    const dp = style && style.dp !== undefined ? style.dp : 2;
    if (fmt === 'date') return formatDateSerial(value);
    if (fmt === 'percent') return `${(value * 100).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}%`;
    if (fmt === 'currency') return `£${value.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
    if (fmt === 'number') return value.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
    if (fmt === 'text') return String(value);
    // General: up to 10 significant figures, no trailing zeros.
    const abs = Math.abs(value);
    if (abs !== 0 && (abs >= 1e11 || abs < 1e-6)) return value.toExponential(4).replace(/\.?0+e/, 'e');
    return String(Number(value.toPrecision(10)));
  }
  return String(value);
}

/**
 * Shift the cell references in a formula by (dr, dc), leaving $-anchored
 * parts alone — what copying a formula to another cell does.
 */
function shiftFormula(formula, dr, dc) {
  return formula.replace(/(^|[^A-Za-z0-9_"'])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g, (m, pre, dCol, col, dRow, row) => {
    const c = dCol ? colToIndex(col) : colToIndex(col) + dc;
    const r = dRow ? Number(row) - 1 : Number(row) - 1 + dr;
    if (c < 0 || r < 0) return `${pre}#REF!`;
    return `${pre}${dCol}${indexToCol(c)}${dRow}${r + 1}`;
  });
}

/**
 * Adjust references after rows/columns are inserted or deleted: everything at
 * or beyond `at` moves by `delta`; a reference into deleted space becomes #REF!.
 */
function adjustFormula(formula, axis, at, delta) {
  return formula.replace(/(^|[^A-Za-z0-9_"'])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g, (m, pre, dCol, col, dRow, row) => {
    let c = colToIndex(col); let r = Number(row) - 1;
    if (axis === 'row') {
      if (delta < 0 && r >= at && r < at - delta) return `${pre}#REF!`;
      if (r >= at) r += delta;
    } else {
      if (delta < 0 && c >= at && c < at - delta) return `${pre}#REF!`;
      if (c >= at) c += delta;
    }
    return `${pre}${dCol}${indexToCol(c)}${dRow}${r + 1}`;
  });
}

window.vaultFormula = {
  Engine, parse, tokenize, formatValue, literalValue, shiftFormula, adjustFormula,
  addr, parseAddr, colToIndex, indexToCol, isErr, toNumber, toText, dateToSerial, formatDateSerial, parseDateText, FUNCTIONS,
};
