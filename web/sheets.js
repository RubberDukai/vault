'use strict';
/* Vault sheets: a spreadsheet that lives in the vault. Grid, formula bar,
   formatting, sorting, several sheets per workbook, CSV and XLSX in and out.
   The formula engine is in formula.js. Workbooks save themselves to the
   server as you type. */

const SHEET_NUMBER_FORMATS = [
  ['general', 'General'], ['number', 'Number'], ['currency', 'Currency £'], ['percent', 'Percent'], ['date', 'Date'], ['text', 'Text'],
];
const SHEET_COLOURS = ['', '#fff3b0', '#ffd6a5', '#ffadad', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#e0e0e0', '#404040'];
const TEXT_COLOURS = ['', '#c0392b', '#2e7d32', '#1565c0', '#8e24aa', '#ef6c00', '#ffffff', '#000000'];
const DEFAULT_COL_WIDTH = 96;
const ROW_HEIGHT = 24;

let SHEETS_STATE = null;
try { SHEETS_STATE = JSON.parse(localStorage.getItem('vault.sheets') || 'null'); } catch { SHEETS_STATE = null; }
if (!SHEETS_STATE) SHEETS_STATE = { open: null };
const saveSheetsState = () => { try { localStorage.setItem('vault.sheets', JSON.stringify(SHEETS_STATE)); } catch { /* fine */ } };

async function renderSheets(params) {
  const F = window.vaultFormula;
  const openParam = params && params.get('open');
  if (openParam) SHEETS_STATE.open = openParam;
  setBusy('Opening the sheets…');
  const listing = await api('sheets');

  view.innerHTML = `
    <div class="sheet-app">
      <div class="sheet-bar">
        <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-sm" id="sh-files">Files ▾</button>
          <input class="sheet-name" id="sh-name" placeholder="Workbook name" title="Workbook name">
          <span class="faint" id="sh-status"></span>
        </div>
        <div class="sheet-tools" id="sh-tools">
          <button class="btn btn-sm tool-b" data-style="b" title="Bold (Ctrl+B)"><b>B</b></button>
          <button class="btn btn-sm tool-i" data-style="i" title="Italic (Ctrl+I)"><i>I</i></button>
          <button class="btn btn-sm tool-u" data-style="u" title="Underline (Ctrl+U)"><u>U</u></button>
          <span class="sheet-sep"></span>
          <button class="btn btn-sm" data-align="left" title="Align left">⇤</button>
          <button class="btn btn-sm" data-align="center" title="Centre">☰</button>
          <button class="btn btn-sm" data-align="right" title="Align right">⇥</button>
          <span class="sheet-sep"></span>
          <select class="map-select" id="sh-fmt" title="Number format" style="width:auto;padding:3px 6px;font-size:13px">
            ${SHEET_NUMBER_FORMATS.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
          <button class="btn btn-sm" id="sh-dp-less" title="Fewer decimals">.0</button>
          <button class="btn btn-sm" id="sh-dp-more" title="More decimals">.00</button>
          <span class="sheet-sep"></span>
          <span class="sheet-palette" id="sh-bg" title="Fill colour">${SHEET_COLOURS.map((c) => `<button class="swatch-sm" data-bg="${c}" style="background:${c || 'transparent'}" title="${c || 'No fill'}">${c ? '' : '×'}</button>`).join('')}</span>
          <span class="sheet-palette" id="sh-color" title="Text colour">A ${TEXT_COLOURS.map((c) => `<button class="swatch-sm" data-color="${c}" style="background:${c || 'transparent'}" title="${c || 'Default'}">${c ? '' : '×'}</button>`).join('')}</span>
          <span class="sheet-sep"></span>
          <button class="btn btn-sm" id="sh-sort-asc" title="Sort rows by this column, A to Z">Sort ↓</button>
          <button class="btn btn-sm" id="sh-sort-desc" title="Sort rows by this column, Z to A">Sort ↑</button>
          <span class="sheet-sep"></span>
          <button class="btn btn-sm" id="sh-row-ins" title="Insert a row above">+Row</button>
          <button class="btn btn-sm" id="sh-row-del" title="Delete this row">−Row</button>
          <button class="btn btn-sm" id="sh-col-ins" title="Insert a column to the left">+Col</button>
          <button class="btn btn-sm" id="sh-col-del" title="Delete this column">−Col</button>
          <span class="sheet-sep"></span>
          <button class="btn btn-sm" id="sh-freeze" title="Freeze the top row">Freeze</button>
          <button class="btn btn-sm" id="sh-chart" title="Chart the selected cells: a header row names the series, a first column of text gives the categories">Chart</button>
          <button class="btn btn-sm" id="sh-undo" title="Undo (Ctrl+Z)">↶</button>
          <button class="btn btn-sm" id="sh-redo" title="Redo (Ctrl+Y)">↷</button>
        </div>
      </div>
      <div class="formula-bar">
        <span class="mono cell-name" id="sh-addr">A1</span>
        <span class="faint">fx</span>
        <input class="formula-input mono" id="sh-formula" spellcheck="false" autocomplete="off">
      </div>
      <div class="sheet-scroll" id="sh-scroll"><table class="sheet-grid" id="sh-grid"></table><div id="sh-charts"></div></div>
      <div class="sheet-tabs" id="sh-tabs"></div>
      <div class="sheet-files" id="sh-files-panel" hidden></div>
    </div>`;

  const nameInput = document.getElementById('sh-name');
  const status = document.getElementById('sh-status');
  const grid = document.getElementById('sh-grid');
  const scroll = document.getElementById('sh-scroll');
  const formulaInput = document.getElementById('sh-formula');
  const addrLabel = document.getElementById('sh-addr');
  const tabsBar = document.getElementById('sh-tabs');
  const filesPanel = document.getElementById('sh-files-panel');
  const fmtSelect = document.getElementById('sh-fmt');

  // ------------------------------------------------------------- state
  let book = null;
  let sheet = () => book.sheets[book.active];
  let engine = null;
  let sel = { r1: 0, c1: 0, r2: 0, c2: 0, ar: 0, ac: 0 }; // anchor at (ar, ac)
  let editing = null; // { r, c, input }
  let undo = [];
  let redo = [];
  let clipboard = null;
  let rows = 40; let cols = 20;
  let cellEls = [];
  let saveTimer = null;
  let dirty = false;

  const newBook = (name = 'Untitled') => ({ id: null, name, active: 0, sheets: [{ name: 'Sheet1', cells: {}, cols: {}, freeze: 0 }] });

  const recalc = () => { engine = new F.Engine(book); };
  const cellAt = (r, c) => sheet().cells[F.addr(r, c)] || null;
  const usedExtent = () => {
    let maxR = 0; let maxC = 0;
    for (const key of Object.keys(sheet().cells)) { const p = F.parseAddr(key); if (p) { maxR = Math.max(maxR, p.row); maxC = Math.max(maxC, p.col); } }
    return { rows: maxR + 1, cols: maxC + 1 };
  };

  const snapshot = () => JSON.stringify(book.sheets);
  const pushUndo = () => { undo.push(snapshot()); if (undo.length > 60) undo.shift(); redo = []; };
  const restore = (json) => { book.sheets = JSON.parse(json); if (book.active >= book.sheets.length) book.active = 0; recalc(); paintGrid(); paintTabs(); markDirty(); };

  const markDirty = () => {
    dirty = true;
    status.textContent = 'Unsaved…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 900);
  };
  // Computed values ride along with formulas so exports (and other
  // programs opening the file) show numbers, not blanks.
  const cacheValues = () => {
    book.sheets.forEach((s, i) => {
      for (const [key, cell] of Object.entries(s.cells)) {
        if (typeof cell.v === 'string' && cell.v.startsWith('=')) {
          const p = F.parseAddr(key);
          const v = engine.cellValue(i, p.row, p.col);
          cell.c = F.isErr(v) ? v.error : v === null ? '' : v;
        } else if ('c' in cell) delete cell.c;
      }
    });
  };

  const save = async () => {
    if (!book) return;
    try {
      cacheValues();
      const { workbook } = await api('sheets', { method: 'POST', body: book });
      book.id = workbook.id; book.updated = workbook.updated;
      SHEETS_STATE.open = book.id; saveSheetsState();
      dirty = false;
      status.textContent = `Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (err) {
      status.textContent = `Not saved: ${err.message}`;
    }
  };

  // ---------------------------------------------------------- the grid
  const paintGrid = () => {
    const ext = usedExtent();
    rows = Math.min(1000, Math.max(40, ext.rows + 15));
    cols = Math.min(104, Math.max(20, ext.cols + 5));
    const s = sheet();
    const widths = Array.from({ length: cols }, (_, c) => s.cols[F.indexToCol(c)] || DEFAULT_COL_WIDTH);
    const head = `<tr><th class="corner" id="sh-corner"></th>${Array.from({ length: cols }, (_, c) => `<th class="col-head" data-c="${c}" style="width:${widths[c]}px;min-width:${widths[c]}px">${F.indexToCol(c)}<span class="col-grip" data-c="${c}"></span></th>`).join('')}</tr>`;
    const body = [];
    cellEls = [];
    for (let r = 0; r < rows; r++) {
      const tds = [];
      for (let c = 0; c < cols; c++) tds.push(`<td data-r="${r}" data-c="${c}"></td>`);
      body.push(`<tr class="${s.freeze && r === 0 ? 'frozen' : ''}"><th class="row-head" data-r="${r}">${r + 1}</th>${tds.join('')}</tr>`);
    }
    grid.innerHTML = `<thead>${head}</thead><tbody>${body.join('')}</tbody>`;
    const trs = grid.tBodies[0].rows;
    for (let r = 0; r < rows; r++) { cellEls.push([...trs[r].cells].slice(1)); }
    paintCells();
    paintSelection();
  };

  const paintCell = (r, c) => {
    const td = cellEls[r] && cellEls[r][c];
    if (!td) return;
    const cell = cellAt(r, c);
    const value = engine.cellValue(book.active, r, c);
    const style = cell && cell.s;
    td.textContent = F.formatValue(value, style);
    let cls = '';
    if (typeof value === 'number' && !(style && style.align)) cls += ' num';
    if (F.isErr(value)) cls += ' err';
    if (style) {
      if (style.b) cls += ' b'; if (style.i) cls += ' i'; if (style.u) cls += ' u';
      if (style.align) cls += ` al-${style.align}`;
      td.style.background = style.bg || '';
      td.style.color = style.color || '';
    } else { td.style.background = ''; td.style.color = ''; }
    td.className = cls.trim();
  };
  const paintCells = () => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) paintCell(r, c); paintCharts(); };
  const repaintValues = () => { recalc(); paintCells(); };

  // ------------------------------------------------------------- charts
  // A chart is a range plus a picture: { id, type, range, title, x, y, w, h },
  // kept in sheet.charts so it saves, undoes and travels with the workbook.
  const chartsBox = document.getElementById('sh-charts');

  /** Read the chart's range as categories and series, deciding what the header row and first column mean. */
  const chartData = (chart) => {
    const [a, b] = chart.range.split(':');
    const p1 = F.parseAddr(a); const p2 = F.parseAddr(b || a);
    if (!p1 || !p2) return { categories: [], series: [] };
    const r1 = Math.min(p1.row, p2.row); const r2 = Math.max(p1.row, p2.row);
    const c1 = Math.min(p1.col, p2.col); const c2 = Math.max(p1.col, p2.col);
    const value = (r, c) => { const v = engine.cellValue(book.active, r, c); return F.isErr(v) ? null : v; };
    const isText = (v) => typeof v === 'string' && v !== '';
    const dataCols = c2 > c1 ? Array.from({ length: c2 - c1 }, (_, i) => c1 + 1 + i) : [c1];
    const hasHeader = r2 > r1 && dataCols.every((c) => isText(value(r1, c)) || value(r1, c) === null || value(r1, c) === '');
    const firstRow = hasHeader ? r1 + 1 : r1;
    const firstColText = c2 > c1 && Array.from({ length: r2 - firstRow + 1 }, (_, i) => value(firstRow + i, c1)).some(isText);
    const seriesCols = firstColText || c2 === c1 ? dataCols : Array.from({ length: c2 - c1 + 1 }, (_, i) => c1 + i);
    const categories = [];
    for (let r = firstRow; r <= r2; r++) {
      const v = firstColText ? value(r, c1) : null;
      categories.push(v === null || v === '' ? String(r + 1) : F.formatValue(v, cellAt(r, c1) && cellAt(r, c1).s));
    }
    const series = seriesCols.map((c) => ({
      name: hasHeader && isText(value(r1, c)) ? String(value(r1, c)) : F.indexToCol(c),
      values: Array.from({ length: r2 - firstRow + 1 }, (_, i) => { const v = value(firstRow + i, c); return typeof v === 'number' ? v : null; }),
    }));
    return { categories, series };
  };

  const paintCharts = () => {
    const charts = sheet().charts || [];
    const known = new Set(charts.map((c) => c.id));
    for (const el of [...chartsBox.children]) if (!known.has(el.dataset.id)) el.remove();
    for (const chart of charts) {
      let el = chartsBox.querySelector(`[data-id="${chart.id}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'sheet-chart';
        el.dataset.id = chart.id;
        el.innerHTML = `<div class="chart-head">
            <input class="chart-title" placeholder="Title" title="Chart title">
            <select class="chart-type map-select" style="width:auto;padding:1px 4px;font-size:12px">
              <option value="bar">Bar</option><option value="line">Line</option><option value="pie">Pie</option>
            </select>
            <span class="mono faint chart-range"></span>
            <button class="btn btn-sm chart-close" title="Remove this chart">×</button>
          </div><canvas></canvas><div class="chart-resize" title="Drag to resize"></div>`;
        chartsBox.appendChild(el);
        wireChart(el, chart.id);
      }
      Object.assign(el.style, { left: `${chart.x}px`, top: `${chart.y}px`, width: `${chart.w}px`, height: `${chart.h}px` });
      const title = el.querySelector('.chart-title');
      if (document.activeElement !== title) title.value = chart.title || '';
      el.querySelector('.chart-type').value = chart.type;
      el.querySelector('.chart-range').textContent = chart.range;
      window.vaultSheetCharts.drawChart(el.querySelector('canvas'), chart, chartData(chart));
    }
  };

  const wireChart = (el, id) => {
    const find = () => (sheet().charts || []).find((c) => c.id === id);
    el.querySelector('.chart-title').oninput = (e) => { const c = find(); if (c) { c.title = e.target.value; markDirty(); paintCharts(); } };
    el.querySelector('.chart-type').onchange = (e) => { const c = find(); if (c) { pushUndo(); c.type = e.target.value; markDirty(); paintCharts(); } };
    el.querySelector('.chart-close').onclick = () => { pushUndo(); sheet().charts = sheet().charts.filter((c) => c.id !== id); markDirty(); paintCharts(); };
    // Drag by the header, resize by the corner. Positions are grid pixels, so they scroll with the cells.
    const drag = (start, apply) => (e) => {
      if (e.target.closest('input, select, button')) return;
      e.preventDefault();
      const c = find(); if (!c) return;
      const from = { x: e.clientX, y: e.clientY, ...start(c) };
      const move = (ev) => { apply(c, from, ev.clientX - from.x, ev.clientY - from.y); paintCharts(); };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); markDirty(); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    };
    el.querySelector('.chart-head').onmousedown = drag((c) => ({ x0: c.x, y0: c.y }), (c, from, dx, dy) => { c.x = Math.max(0, from.x0 + dx); c.y = Math.max(0, from.y0 + dy); });
    el.querySelector('.chart-resize').onmousedown = drag((c) => ({ w0: c.w, h0: c.h }), (c, from, dx, dy) => { c.w = Math.max(180, from.w0 + dx); c.h = Math.max(120, from.h0 + dy); });
    el.onmousedown = () => { chartsBox.appendChild(el); }; // clicked chart comes to the front
  };

  const addChart = () => {
    const { r1, c1, r2, c2 } = selRange();
    if (r1 === r2 && c1 === c2) { alert('Select the cells to chart first — a column of numbers, with a heading and labels if you have them.'); return; }
    pushUndo();
    const s = sheet();
    s.charts = s.charts || [];
    const n = s.charts.length;
    s.charts.push({
      id: `c${Date.now().toString(36)}`,
      type: 'bar',
      range: `${F.addr(r1, c1)}:${F.addr(r2, c2)}`,
      title: '',
      x: scroll.scrollLeft + 60 + n * 24,
      y: scroll.scrollTop + 40 + n * 24,
      w: 420,
      h: 260,
    });
    markDirty(); paintCharts();
  };

  const paintSelection = () => {
    for (const td of grid.querySelectorAll('td.sel, td.active')) td.classList.remove('sel', 'active');
    for (const th of grid.querySelectorAll('th.hl')) th.classList.remove('hl');
    const r1 = Math.min(sel.r1, sel.r2); const r2 = Math.max(sel.r1, sel.r2);
    const c1 = Math.min(sel.c1, sel.c2); const c2 = Math.max(sel.c1, sel.c2);
    for (let r = r1; r <= Math.min(r2, rows - 1); r++) for (let c = c1; c <= Math.min(c2, cols - 1); c++) cellEls[r][c].classList.add('sel');
    const active = cellEls[sel.ar] && cellEls[sel.ar][sel.ac];
    if (active) active.classList.add('active');
    for (let c = c1; c <= Math.min(c2, cols - 1); c++) grid.querySelector(`th.col-head[data-c="${c}"]`)?.classList.add('hl');
    for (let r = r1; r <= Math.min(r2, rows - 1); r++) grid.querySelector(`th.row-head[data-r="${r}"]`)?.classList.add('hl');
    const cell = cellAt(sel.ar, sel.ac);
    addrLabel.textContent = (r1 === r2 && c1 === c2) ? F.addr(sel.ar, sel.ac) : `${F.addr(r1, c1)}:${F.addr(r2, c2)}`;
    if (document.activeElement !== formulaInput) formulaInput.value = cell ? String(cell.v ?? '') : '';
    const style = (cell && cell.s) || {};
    for (const b of document.querySelectorAll('#sh-tools [data-style]')) b.classList.toggle('btn-active', Boolean(style[b.dataset.style]));
    for (const b of document.querySelectorAll('#sh-tools [data-align]')) b.classList.toggle('btn-active', style.align === b.dataset.align);
    fmtSelect.value = style.fmt || 'general';
    document.getElementById('sh-freeze').classList.toggle('btn-active', Boolean(sheet().freeze));
    // A sum of the selection, as every spreadsheet shows in the corner.
    if (!(r1 === r2 && c1 === c2)) {
      let sum = 0; let n = 0;
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const v = engine.cellValue(book.active, r, c); if (typeof v === 'number') { sum += v; n++; } }
      if (n) status.textContent = `Sum ${F.formatValue(sum)} · Average ${F.formatValue(sum / n)} · Count ${n}`;
    }
  };

  const selectCell = (r, c, extend = false) => {
    r = Math.max(0, Math.min(rows - 1, r)); c = Math.max(0, Math.min(cols - 1, c));
    if (extend) { sel.r2 = r; sel.c2 = c; } else { sel = { r1: r, c1: c, r2: r, c2: c, ar: r, ac: c }; }
    paintSelection();
    const td = cellEls[r][c];
    if (td) {
      const box = td.getBoundingClientRect(); const view = scroll.getBoundingClientRect();
      if (box.bottom > view.bottom) scroll.scrollTop += box.bottom - view.bottom + 4;
      if (box.top < view.top + 28) scroll.scrollTop -= view.top + 28 - box.top + 4;
      if (box.right > view.right) scroll.scrollLeft += box.right - view.right + 4;
      if (box.left < view.left + 44) scroll.scrollLeft -= view.left + 44 - box.left + 4;
    }
  };
  const selRange = () => ({ r1: Math.min(sel.r1, sel.r2), c1: Math.min(sel.c1, sel.c2), r2: Math.max(sel.r1, sel.r2), c2: Math.max(sel.c1, sel.c2) });

  // ------------------------------------------------------- cell writes
  /** Type something into a cell: number formats are picked up from what was typed. */
  const setCellRaw = (r, c, text, keepStyle = true) => {
    const key = F.addr(r, c);
    const cells = sheet().cells;
    let raw = text;
    let style = keepStyle && cells[key] && cells[key].s ? { ...cells[key].s } : null;
    if (!raw.startsWith('=')) {
      const t = raw.trim();
      let m;
      if ((m = /^(-?[\d,]*\.?\d+)%$/.exec(t))) { raw = String(Number(m[1].replace(/,/g, '')) / 100); style = { ...(style || {}), fmt: 'percent', dp: (m[1].split('.')[1] || '').length }; }
      else if ((m = /^(-?)£\s?(-?[\d,]*\.?\d+)$/.exec(t))) { raw = String(Number((m[1] + m[2]).replace(/,/g, ''))); style = { ...(style || {}), fmt: 'currency', dp: 2 }; }
      else if (F.parseDateText(t) !== null && !(style && style.fmt === 'text')) { raw = String(F.parseDateText(t)); style = { ...(style || {}), fmt: 'date' }; }
      else if (/^-?[\d,]+\.?\d*$/.test(t) && t.includes(',') && (!style || !style.fmt)) { raw = String(Number(t.replace(/,/g, ''))); style = { ...(style || {}), fmt: 'number', dp: (t.split('.')[1] || '').length }; }
    }
    // A formula with no format of its own borrows one from the cells it uses,
    // as Excel does: =F1+30 on a date is a date, =B2*C2 on a price is money.
    if (raw.startsWith('=') && !(style && style.fmt)) {
      const inferred = inferFormat(raw);
      if (inferred) style = { ...(style || {}), ...inferred };
    }
    if (raw === '' && !style) delete cells[key];
    else if (raw === '' && style) cells[key] = { v: '', s: style };
    else cells[key] = style && Object.keys(style).length ? { v: raw, s: style } : { v: raw };
  };
  const inferFormat = (formula) => {
    if (/^=\s*(TODAY|NOW|DATE|EDATE|EOMONTH)\s*\(/i.test(formula)) return { fmt: 'date' };
    if (/[A-Z]{2,}\s*\(/i.test(formula.replace(/^=/, '')) && !/^=\s*(SUM|AVERAGE|MIN|MAX|ROUND|ABS)\s*\(/i.test(formula)) return null;
    const refs = formula.match(/\$?[A-Z]{1,3}\$?\d+/gi) || [];
    for (const ref of refs) {
      const cell = sheet().cells[ref.replace(/\$/g, '').toUpperCase()];
      const fmt = cell && cell.s && cell.s.fmt;
      if (fmt === 'date' && !/[*/^]/.test(formula)) return { fmt: 'date' };
      if (fmt === 'currency') return { fmt: 'currency', dp: cell.s.dp ?? 2 };
    }
    return null;
  };

  const setStyle = (patch) => {
    pushUndo();
    const { r1, c1, r2, c2 } = selRange();
    const cells = sheet().cells;
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      const key = F.addr(r, c);
      const cell = cells[key] || { v: '' };
      const s = { ...(cell.s || {}) };
      for (const [k, v] of Object.entries(typeof patch === 'function' ? patch(s) : patch)) { if (v === null || v === false || v === '') delete s[k]; else s[k] = v; }
      if (Object.keys(s).length) cells[key] = { ...cell, s }; else { delete cell.s; if (cell.v === '' || cell.v === undefined) delete cells[key]; else cells[key] = cell; }
    }
    paintCells(); paintSelection(); markDirty();
  };

  // ------------------------------------------------------------ editing
  const startEdit = (r, c, initial) => {
    if (editing) commitEdit();
    const td = cellEls[r][c];
    const cell = cellAt(r, c);
    const input = document.createElement('input');
    input.className = 'cell-editor mono';
    input.value = initial !== undefined ? initial : (cell ? String(cell.v ?? '') : '');
    const box = td.getBoundingClientRect(); const host = scroll.getBoundingClientRect();
    input.style.left = `${box.left - host.left + scroll.scrollLeft}px`;
    input.style.top = `${box.top - host.top + scroll.scrollTop}px`;
    input.style.width = `${Math.max(box.width, 120)}px`;
    input.style.height = `${box.height}px`;
    scroll.appendChild(input);
    input.focus();
    if (initial === undefined) input.select(); else input.setSelectionRange(input.value.length, input.value.length);
    editing = { r, c, input };
    input.oninput = () => { formulaInput.value = input.value; };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(); selectCell(r + (e.shiftKey ? -1 : 1), c); }
      else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); selectCell(r, c + (e.shiftKey ? -1 : 1)); }
      else if (e.key === 'Escape') { cancelEdit(); }
      e.stopPropagation();
    };
    input.onblur = () => { if (editing && editing.input === input) commitEdit(); };
  };
  const commitEdit = () => {
    if (!editing) return;
    const { r, c, input } = editing;
    editing = null;
    const text = input.value;
    input.remove();
    const before = cellAt(r, c);
    if ((before ? String(before.v ?? '') : '') !== text) {
      pushUndo();
      setCellRaw(r, c, text);
      afterChange(r, c);
    }
    scroll.focus();
  };
  const cancelEdit = () => { if (!editing) return; editing.input.remove(); editing = null; paintSelection(); scroll.focus(); };
  const afterChange = (r, c) => {
    const ext = usedExtent();
    if (ext.rows + 15 > rows || ext.cols + 5 > cols) paintGrid(); else repaintValues();
    paintSelection(); markDirty();
    void r; void c;
  };

  // ------------------------------------------------------ clipboard etc
  const copySelection = (cut = false) => {
    const { r1, c1, r2, c2 } = selRange();
    const block = [];
    for (let r = r1; r <= r2; r++) {
      const row = [];
      for (let c = c1; c <= c2; c++) { const cell = cellAt(r, c); row.push(cell ? { v: cell.v, s: cell.s ? { ...cell.s } : undefined } : null); }
      block.push(row);
    }
    clipboard = { r1, c1, block, cut };
    const text = block.map((row, i) => row.map((cell, j) => F.formatValue(engine.cellValue(book.active, r1 + i, c1 + j), cell && cell.s)).join('\t')).join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {});
    status.textContent = cut ? 'Cut' : 'Copied';
  };
  const pasteBlock = (block, srcR, srcC) => {
    const { r1, c1 } = selRange();
    pushUndo();
    const cells = sheet().cells;
    block.forEach((row, i) => row.forEach((cell, j) => {
      const key = F.addr(r1 + i, c1 + j);
      if (!cell) { delete cells[key]; return; }
      let v = cell.v;
      if (typeof v === 'string' && v.startsWith('=') && srcR !== undefined) v = F.shiftFormula(v, r1 - srcR, c1 - srcC);
      cells[key] = cell.s ? { v, s: { ...cell.s } } : { v };
    }));
    sel = { r1, c1, r2: r1 + block.length - 1, c2: c1 + (block[0] ? block[0].length : 1) - 1, ar: r1, ac: c1 };
    afterChange(r1, c1);
  };
  const pasteText = (text) => {
    const lines = text.replace(/\r/g, '').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const block = lines.map((line) => line.split('\t').map((v) => ({ v })));
    pasteBlock(block);
  };

  const deleteSelection = () => {
    pushUndo();
    const { r1, c1, r2, c2 } = selRange();
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) delete sheet().cells[F.addr(r, c)];
    afterChange(r1, c1);
  };
  const fillDown = () => {
    const { r1, c1, r2, c2 } = selRange();
    if (r2 === r1) return;
    pushUndo();
    for (let c = c1; c <= c2; c++) {
      const src = cellAt(r1, c);
      for (let r = r1 + 1; r <= r2; r++) {
        if (!src) { delete sheet().cells[F.addr(r, c)]; continue; }
        const v = typeof src.v === 'string' && src.v.startsWith('=') ? F.shiftFormula(src.v, r - r1, 0) : src.v;
        sheet().cells[F.addr(r, c)] = src.s ? { v, s: { ...src.s } } : { v };
      }
    }
    afterChange(r1, c1);
  };

  // -------------------------------------------------- rows and columns
  const insertRowsCols = (axis, at, delta) => {
    pushUndo();
    const s = sheet();
    const moved = {};
    for (const [key, cell] of Object.entries(s.cells)) {
      const p = F.parseAddr(key);
      const idx = axis === 'row' ? p.row : p.col;
      if (delta < 0 && idx >= at && idx < at - delta) continue; // deleted
      const nr = axis === 'row' && idx >= at ? p.row + delta : p.row;
      const nc = axis === 'col' && idx >= at ? p.col + delta : p.col;
      const next = { ...cell };
      if (typeof next.v === 'string' && next.v.startsWith('=')) next.v = F.adjustFormula(next.v, axis, at, delta);
      moved[F.addr(nr, nc)] = next;
    }
    s.cells = moved;
    // Other sheets referring here keep working too.
    for (const other of book.sheets) {
      if (other === s) continue;
      for (const cell of Object.values(other.cells)) {
        if (typeof cell.v === 'string' && cell.v.startsWith('=') && cell.v.toLowerCase().includes(s.name.toLowerCase())) cell.v = F.adjustFormula(cell.v, axis, at, delta);
      }
    }
    if (axis === 'col') {
      const cols2 = {};
      for (const [letters, w] of Object.entries(s.cols)) {
        const i = F.colToIndex(letters);
        if (delta < 0 && i >= at && i < at - delta) continue;
        cols2[F.indexToCol(i >= at ? i + delta : i)] = w;
      }
      s.cols = cols2;
    }
    recalc(); paintGrid(); markDirty();
  };

  const sortBy = (descending) => {
    const s = sheet();
    const ext = usedExtent();
    const sr = selRange();
    const multi = sr.r2 > sr.r1;
    let top = multi ? sr.r1 : 0;
    const bottom = multi ? sr.r2 : ext.rows - 1;
    const left = multi ? sr.c1 : 0;
    const right = multi ? sr.c2 : ext.cols - 1;
    const keyCol = sel.ac;
    if (bottom <= top) return;
    // A first row of text over numbers is a header: leave it where it is.
    const headerish = !multi && (() => {
      const first = engine.cellValue(book.active, top, keyCol);
      const second = engine.cellValue(book.active, top + 1, keyCol);
      return typeof first === 'string' && typeof second !== 'string';
    })();
    if (headerish) top++;
    pushUndo();
    const rowsData = [];
    for (let r = top; r <= bottom; r++) {
      const cells = [];
      for (let c = left; c <= right; c++) cells.push(cellAt(r, c));
      rowsData.push({ r, cells, key: engine.cellValue(book.active, r, keyCol) });
    }
    const rank = (v) => (v === null || v === '' ? 3 : F.isErr(v) ? 2 : typeof v === 'number' ? 0 : 1);
    rowsData.sort((a, b) => {
      const ra = rank(a.key); const rb = rank(b.key);
      if (ra !== rb) return ra - rb;
      let cmp = 0;
      if (ra === 0) cmp = a.key - b.key; else cmp = String(a.key).localeCompare(String(b.key), undefined, { numeric: true, sensitivity: 'base' });
      return descending && ra < 2 ? -cmp : cmp;
    });
    rowsData.forEach((row, i) => {
      const target = top + i;
      row.cells.forEach((cell, j) => {
        const key = F.addr(target, left + j);
        if (!cell) { delete s.cells[key]; return; }
        const v = typeof cell.v === 'string' && cell.v.startsWith('=') ? F.shiftFormula(cell.v, target - row.r, 0) : cell.v;
        s.cells[key] = cell.s ? { v, s: cell.s } : { v };
      });
    });
    afterChange(top, keyCol);
  };

  // ---------------------------------------------------------- events
  grid.onmousedown = (e) => {
    const td = e.target.closest('td');
    const colHead = e.target.closest('th.col-head');
    const rowHead = e.target.closest('th.row-head');
    if (e.target.classList.contains('col-grip')) return;
    if (td) {
      const r = Number(td.dataset.r); const c = Number(td.dataset.c);
      if (editing) { if (editing.r === r && editing.c === c) return; commitEdit(); }
      selectCell(r, c, e.shiftKey);
      const move = (ev) => { const t = ev.target.closest && ev.target.closest('td'); if (t) selectCell(Number(t.dataset.r), Number(t.dataset.c), true); };
      const up = () => { grid.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      grid.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      e.preventDefault(); scroll.focus();
    } else if (colHead) {
      const c = Number(colHead.dataset.c);
      if (editing) commitEdit();
      sel = { r1: 0, c1: c, r2: rows - 1, c2: c, ar: 0, ac: c }; paintSelection(); e.preventDefault(); scroll.focus();
    } else if (rowHead) {
      const r = Number(rowHead.dataset.r);
      if (editing) commitEdit();
      sel = { r1: r, c1: 0, r2: r, c2: cols - 1, ar: r, ac: 0 }; paintSelection(); e.preventDefault(); scroll.focus();
    } else if (e.target.id === 'sh-corner') {
      const ext = usedExtent();
      sel = { r1: 0, c1: 0, r2: Math.max(0, ext.rows - 1), c2: Math.max(0, ext.cols - 1), ar: 0, ac: 0 }; paintSelection();
    }
  };
  grid.ondblclick = (e) => { const td = e.target.closest('td'); if (td) startEdit(Number(td.dataset.r), Number(td.dataset.c)); };

  // Column resize by dragging the grip on the header.
  grid.addEventListener('mousedown', (e) => {
    if (!e.target.classList.contains('col-grip')) return;
    e.preventDefault(); e.stopPropagation();
    const c = Number(e.target.dataset.c);
    const th = e.target.parentElement;
    const startX = e.clientX; const startW = th.offsetWidth;
    const move = (ev) => { const w = Math.max(30, startW + ev.clientX - startX); th.style.width = `${w}px`; th.style.minWidth = `${w}px`; };
    const up = (ev) => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      const w = Math.max(30, startW + ev.clientX - startX);
      sheet().cols[F.indexToCol(c)] = Math.round(w); markDirty();
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  }, true);

  scroll.tabIndex = 0;
  scroll.onkeydown = (e) => {
    if (editing) return;
    const { r1, c1, r2, c2 } = selRange();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'c') { copySelection(false); e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'x') { copySelection(true); e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'v') { if (clipboard) { const cb = clipboard; if (cb.cut) { for (let r = 0; r < cb.block.length; r++) for (let c = 0; c < cb.block[0].length; c++) delete sheet().cells[F.addr(cb.r1 + r, cb.c1 + c)]; clipboard = { ...cb, cut: false }; } pasteBlock(cb.block, cb.cut ? undefined : cb.r1, cb.c1); e.preventDefault(); } return; }
    if (ctrl && e.key.toLowerCase() === 'z') { if (undo.length) { redo.push(snapshot()); restore(undo.pop()); } e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'y') { if (redo.length) { undo.push(snapshot()); restore(redo.pop()); } e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'b') { setStyle((s) => ({ b: !s.b })); e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'i') { setStyle((s) => ({ i: !s.i })); e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'u') { setStyle((s) => ({ u: !s.u })); e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'd') { fillDown(); e.preventDefault(); return; }
    if (ctrl && e.key.toLowerCase() === 'a') { const ext = usedExtent(); sel = { r1: 0, c1: 0, r2: Math.max(0, ext.rows - 1), c2: Math.max(0, ext.cols - 1), ar: 0, ac: 0 }; paintSelection(); e.preventDefault(); return; }
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[e.key]) {
      const [dr, dc] = moves[e.key];
      if (e.shiftKey) selectCell(sel.r2 + dr, sel.c2 + dc, true);
      else if (ctrl) { const ext = usedExtent(); selectCell(dr ? (dr < 0 ? 0 : Math.max(0, ext.rows - 1)) : sel.ar, dc ? (dc < 0 ? 0 : Math.max(0, ext.cols - 1)) : sel.ac); }
      else selectCell(sel.ar + dr, sel.ac + dc);
      e.preventDefault(); return;
    }
    if (e.key === 'Enter') { if (e.altKey) startEdit(sel.ar, sel.ac); else selectCell(sel.ar + (e.shiftKey ? -1 : 1), sel.ac); e.preventDefault(); return; }
    if (e.key === 'Tab') { selectCell(sel.ar, sel.ac + (e.shiftKey ? -1 : 1)); e.preventDefault(); return; }
    if (e.key === 'F2') { startEdit(sel.ar, sel.ac); e.preventDefault(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelection(); e.preventDefault(); return; }
    if (e.key === 'Home') { selectCell(sel.ar, 0); e.preventDefault(); return; }
    if (e.key === 'PageDown') { selectCell(sel.ar + 20, sel.ac); e.preventDefault(); return; }
    if (e.key === 'PageUp') { selectCell(sel.ar - 20, sel.ac); e.preventDefault(); return; }
    if (e.key.length === 1 && !ctrl && !e.altKey) { startEdit(sel.ar, sel.ac, e.key); e.preventDefault(); return; }
    void r1; void c1; void r2; void c2;
  };
  scroll.addEventListener('paste', (e) => {
    if (editing) return;
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text && (!clipboard || text.includes('\t') || text.includes('\n'))) { e.preventDefault(); pasteText(text); }
  });

  formulaInput.onfocus = () => { if (editing) commitEdit(); };
  formulaInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const before = cellAt(sel.ar, sel.ac);
      if ((before ? String(before.v ?? '') : '') !== formulaInput.value) { pushUndo(); setCellRaw(sel.ar, sel.ac, formulaInput.value); afterChange(sel.ar, sel.ac); }
      selectCell(sel.ar + 1, sel.ac); scroll.focus();
    } else if (e.key === 'Escape') { paintSelection(); scroll.focus(); }
  };

  // Toolbar.
  for (const b of document.querySelectorAll('#sh-tools [data-style]')) b.onclick = () => setStyle((s) => ({ [b.dataset.style]: !s[b.dataset.style] }));
  for (const b of document.querySelectorAll('#sh-tools [data-align]')) b.onclick = () => setStyle((s) => ({ align: s.align === b.dataset.align ? null : b.dataset.align }));
  fmtSelect.onchange = () => setStyle((s) => ({ fmt: fmtSelect.value === 'general' ? null : fmtSelect.value, dp: fmtSelect.value === 'percent' ? (s.dp ?? 0) : fmtSelect.value === 'number' || fmtSelect.value === 'currency' ? (s.dp ?? 2) : null }));
  document.getElementById('sh-dp-less').onclick = () => setStyle((s) => ({ fmt: s.fmt || 'number', dp: Math.max(0, (s.dp ?? 2) - 1) }));
  document.getElementById('sh-dp-more').onclick = () => setStyle((s) => ({ fmt: s.fmt || 'number', dp: Math.min(8, (s.dp ?? 2) + 1) }));
  for (const b of document.querySelectorAll('#sh-bg [data-bg]')) b.onclick = () => setStyle({ bg: b.dataset.bg || null });
  for (const b of document.querySelectorAll('#sh-color [data-color]')) b.onclick = () => setStyle({ color: b.dataset.color || null });
  document.getElementById('sh-sort-asc').onclick = () => sortBy(false);
  document.getElementById('sh-sort-desc').onclick = () => sortBy(true);
  document.getElementById('sh-row-ins').onclick = () => insertRowsCols('row', selRange().r1, selRange().r2 - selRange().r1 + 1);
  document.getElementById('sh-row-del').onclick = () => insertRowsCols('row', selRange().r1, -(selRange().r2 - selRange().r1 + 1));
  document.getElementById('sh-col-ins').onclick = () => insertRowsCols('col', selRange().c1, selRange().c2 - selRange().c1 + 1);
  document.getElementById('sh-col-del').onclick = () => insertRowsCols('col', selRange().c1, -(selRange().c2 - selRange().c1 + 1));
  document.getElementById('sh-freeze').onclick = () => { sheet().freeze = sheet().freeze ? 0 : 1; paintGrid(); markDirty(); };
  document.getElementById('sh-chart').onclick = addChart;
  document.getElementById('sh-undo').onclick = () => { if (undo.length) { redo.push(snapshot()); restore(undo.pop()); } };
  document.getElementById('sh-redo').onclick = () => { if (redo.length) { undo.push(snapshot()); restore(redo.pop()); } };
  nameInput.oninput = () => { book.name = nameInput.value; markDirty(); };

  // ------------------------------------------------------------- tabs
  const paintTabs = () => {
    tabsBar.innerHTML = `${book.sheets.map((s, i) => `<button class="sheet-tab ${i === book.active ? 'active' : ''}" data-i="${i}" title="Double-click to rename">${esc(s.name)}</button>`).join('')}
      <button class="sheet-tab add" id="sh-add-sheet" title="Add a sheet">+</button>
      <span class="faint" style="margin-left:auto;padding:0 8px">${Object.keys(sheet().cells).length} cells · double-click a cell or press F2 to edit · = starts a formula</span>`;
    for (const t of tabsBar.querySelectorAll('.sheet-tab[data-i]')) {
      t.onclick = () => { if (editing) commitEdit(); book.active = Number(t.dataset.i); sel = { r1: 0, c1: 0, r2: 0, c2: 0, ar: 0, ac: 0 }; paintGrid(); paintTabs(); markDirty(); };
      t.ondblclick = () => {
        const name = prompt('Sheet name:', book.sheets[Number(t.dataset.i)].name);
        if (name && name.trim()) { pushUndo(); book.sheets[Number(t.dataset.i)].name = name.trim().slice(0, 31); paintTabs(); recalc(); paintCells(); markDirty(); }
      };
      t.oncontextmenu = (e) => {
        e.preventDefault();
        if (book.sheets.length < 2) return;
        if (confirm(`Delete sheet "${book.sheets[Number(t.dataset.i)].name}"?`)) { pushUndo(); book.sheets.splice(Number(t.dataset.i), 1); book.active = 0; paintGrid(); paintTabs(); markDirty(); }
      };
    }
    document.getElementById('sh-add-sheet').onclick = () => { pushUndo(); book.sheets.push({ name: `Sheet${book.sheets.length + 1}`, cells: {}, cols: {}, freeze: 0 }); book.active = book.sheets.length - 1; paintGrid(); paintTabs(); markDirty(); };
  };

  // ------------------------------------------------------------ files
  const openBook = (wb) => {
    book = wb;
    if (!book.sheets || !book.sheets.length) book.sheets = [{ name: 'Sheet1', cells: {}, cols: {}, freeze: 0 }];
    book.active = Math.min(book.active || 0, book.sheets.length - 1);
    nameInput.value = book.name || '';
    undo = []; redo = [];
    sel = { r1: 0, c1: 0, r2: 0, c2: 0, ar: 0, ac: 0 };
    recalc(); paintGrid(); paintTabs();
    status.textContent = book.updated ? `Saved ${new Date(book.updated).toLocaleString()}` : 'New workbook';
    if (book.id) { SHEETS_STATE.open = book.id; saveSheetsState(); }
  };

  const paintFiles = async () => {
    const list = await api('sheets');
    filesPanel.innerHTML = `
      <div class="row-between" style="margin-bottom:8px"><strong>Workbooks</strong><button class="btn btn-sm" id="sh-files-close">×</button></div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <button class="btn btn-sm btn-primary" id="sh-new">New workbook</button>
        <label class="btn btn-sm">Import a file… <input type="file" id="sh-upload" accept=".xlsx,.csv,.tsv" hidden></label>
        ${book && book.id ? `<a class="btn btn-sm" href="/api/sheets/${encodeURIComponent(book.id)}/export?format=xlsx" download>Export .xlsx</a>
        <a class="btn btn-sm" href="/api/sheets/${encodeURIComponent(book.id)}/export?format=csv&sheet=${book.active}" download>Export this sheet .csv</a>
        <button class="btn btn-sm" id="sh-delete">Delete this workbook</button>` : ''}
      </div>
      ${list.workbooks.length ? list.workbooks.map((w) => `<button class="nb-item ${book && book.id === w.id ? 'active' : ''}" data-open="${esc(w.id)}"><span class="nb-item-title">${esc(w.name)}</span><span class="faint">${w.sheets} sheet${w.sheets === 1 ? '' : 's'} · ${w.updated ? new Date(w.updated).toLocaleString() : ''}</span></button>`).join('') : '<p class="faint">No workbooks yet.</p>'}
      ${list.importable.length ? `<h3 class="nb-heading">Files in the sheets folder</h3>${list.importable.map((f) => `<button class="nb-item" data-import="${esc(f.file)}"><span class="nb-item-title">${esc(f.file)}</span><span class="faint">${humanSize(f.size)} · click to import</span></button>`).join('')}` : ''}
      <p class="faint" style="margin:10px 0 0">Workbooks are plain JSON in <code>${esc(list.dir)}</code>. Drop .xlsx or .csv files there to import them; exports open in Excel, LibreOffice and Google Sheets.</p>`;
    document.getElementById('sh-files-close').onclick = () => { filesPanel.hidden = true; };
    document.getElementById('sh-new').onclick = async () => { const wb = newBook(); openBook(wb); await save(); filesPanel.hidden = true; };
    document.getElementById('sh-upload').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      status.textContent = 'Importing…';
      const res = await fetch(`/api/sheets/import?filename=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { 'x-vault-client': '1' } });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Import failed'); return; }
      openBook(data.workbook); filesPanel.hidden = true;
    };
    const del = document.getElementById('sh-delete');
    if (del) del.onclick = async () => {
      if (!confirm(`Delete "${book.name}"? This cannot be undone.`)) return;
      await api(`sheets/${encodeURIComponent(book.id)}`, { method: 'DELETE' });
      SHEETS_STATE.open = null; saveSheetsState();
      openBook(newBook()); filesPanel.hidden = true;
    };
    for (const b of filesPanel.querySelectorAll('[data-open]')) b.onclick = async () => { const { workbook } = await api(`sheets/${encodeURIComponent(b.dataset.open)}`); openBook(workbook); filesPanel.hidden = true; };
    for (const b of filesPanel.querySelectorAll('[data-import]')) b.onclick = async () => {
      status.textContent = 'Importing…';
      try { const { workbook } = await api(`sheets/import?file=${encodeURIComponent(b.dataset.import)}`, { method: 'POST' }); openBook(workbook); filesPanel.hidden = true; }
      catch (err) { alert(err.message); }
    };
  };
  document.getElementById('sh-files').onclick = async () => { if (editing) commitEdit(); filesPanel.hidden = !filesPanel.hidden; if (!filesPanel.hidden) await paintFiles(); };

  // Save before leaving.
  const flush = () => { if (editing) commitEdit(); if (dirty) { clearTimeout(saveTimer); navigator.sendBeacon && navigator.sendBeacon('/api/sheets', new Blob([JSON.stringify(book)], { type: 'application/json' })); } };
  window.addEventListener('hashchange', flush, { once: true });
  window.addEventListener('beforeunload', flush, { once: true });

  // Open what was open, or the newest, or a fresh one.
  let opened = null;
  const wanted = SHEETS_STATE.open;
  if (wanted && listing.workbooks.some((w) => w.id === wanted)) opened = (await api(`sheets/${encodeURIComponent(wanted)}`)).workbook;
  else if (listing.workbooks.length) opened = (await api(`sheets/${encodeURIComponent(listing.workbooks[0].id)}`)).workbook;
  openBook(opened || newBook());
  scroll.focus();
}

window.renderSheets = renderSheets;
