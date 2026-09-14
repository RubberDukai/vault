'use strict';
/* Vault: the calendar and the tools page.
   Loaded before app.js; these functions are picked up by its router. They lean
   on app.js's helpers (api, esc, view, setBusy) which exist by the time any
   of this runs. */

// ================================================================ calendar

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EVENT_COLOURS = ['#e3b341', '#f85149', '#3fb950', '#6cb6ff', '#bc8cff', '#ff9a62'];

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Does this event land on this day? Repeats never run before their first date. */
function eventOn(event, day) {
  const start = fromIso(event.date);
  if (day < start && !sameDay(day, start)) return false;
  switch (event.repeat) {
    case 'weekly': return day.getDay() === start.getDay();
    case 'monthly': return day.getDate() === start.getDate();
    case 'yearly': return day.getDate() === start.getDate() && day.getMonth() === start.getMonth();
    default: return sameDay(day, start);
  }
}

/** Where "here" is: the last place the map was looking, or the middle of Britain. */
function homePosition() {
  try {
    const v = JSON.parse(localStorage.getItem('vault.mapView') || 'null');
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lon)) return { lat: v.lat, lon: v.lon, fromMap: true };
  } catch { /* fall through */ }
  return { lat: 54.0, lon: -2.0, fromMap: false };
}

let CAL = null;
try { CAL = JSON.parse(localStorage.getItem('vault.calendar') || 'null'); } catch { CAL = null; }
if (!CAL || !Number.isFinite(CAL.year)) {
  const now = new Date();
  CAL = { year: now.getFullYear(), month: now.getMonth(), selected: isoDate(now) };
}
const saveCal = () => { try { localStorage.setItem('vault.calendar', JSON.stringify(CAL)); } catch { /* fine */ } };

async function renderCalendar() {
  setBusy('Opening the calendar…');
  let { events } = await api('calendar');
  const A = window.vaultAlmanac;

  view.innerHTML = `
    <div class="row-between" style="margin-bottom:12px;flex-wrap:wrap;gap:10px">
      <div class="row" style="gap:6px">
        <button class="btn btn-sm" id="cal-prev" title="Previous month">‹</button>
        <h1 style="margin:0 8px;min-width:12rem;text-align:center" id="cal-title"></h1>
        <button class="btn btn-sm" id="cal-next" title="Next month">›</button>
        <button class="btn btn-sm" id="cal-today">Today</button>
      </div>
      <p class="faint" style="margin:0">Shared by everyone on the network. Sun and moon times are worked out for <span id="cal-where"></span>.</p>
    </div>
    <div class="cal-shell">
      <div class="cal-grid" id="cal-grid"></div>
      <aside class="cal-side" id="cal-side"></aside>
    </div>`;

  const grid = document.getElementById('cal-grid');
  const side = document.getElementById('cal-side');
  const title = document.getElementById('cal-title');
  const where = document.getElementById('cal-where');
  const home = homePosition();
  where.textContent = home.fromMap
    ? `${home.lat.toFixed(2)}, ${home.lon.toFixed(2)} (where the map was left)`
    : 'the middle of Britain — move the map to your home and this follows';

  const today = new Date();

  const paintGrid = () => {
    title.textContent = `${MONTHS[CAL.month]} ${CAL.year}`;
    const first = new Date(CAL.year, CAL.month, 1);
    const daysInMonth = new Date(CAL.year, CAL.month + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // Monday first
    const cells = [];

    for (const day of WEEKDAYS) cells.push(`<div class="cal-head">${day}</div>`);
    for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell cal-pad"></div>');

    let lastPhase = A ? A.moonPhase(new Date(CAL.year, CAL.month, 0)).name : '';
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(CAL.year, CAL.month, d);
      const iso = isoDate(date);
      const todays = events.filter((e) => eventOn(e, date));
      const moon = A ? A.moonPhase(date) : null;
      // Only mark the day a phase turns, so the grid is not wall-to-wall moons.
      const phaseTurn = moon && moon.name !== lastPhase && /New|Full|quarter/.test(moon.name);
      if (moon) lastPhase = moon.name;
      const classes = ['cal-cell'];
      if (sameDay(date, today)) classes.push('cal-today');
      if (iso === CAL.selected) classes.push('cal-selected');
      if (date.getDay() === 0 || date.getDay() === 6) classes.push('cal-weekend');
      cells.push(`
        <button class="${classes.join(' ')}" data-date="${iso}">
          <span class="cal-num">${d}${phaseTurn ? ` <span class="cal-moon" title="${esc(moon.name)}">${moon.glyph}</span>` : ''}</span>
          <span class="cal-events">${todays.slice(0, 3).map((e) => `<span class="cal-chip" style="--chip:${esc(e.colour || EVENT_COLOURS[0])}">${esc(e.title)}</span>`).join('')}${todays.length > 3 ? `<span class="faint">+${todays.length - 3} more</span>` : ''}</span>
        </button>`);
    }
    grid.innerHTML = cells.join('');
    for (const cell of grid.querySelectorAll('.cal-cell[data-date]')) {
      cell.onclick = () => { CAL.selected = cell.dataset.date; saveCal(); paintGrid(); paintSide(); };
    }
  };

  const paintSide = () => {
    const date = fromIso(CAL.selected);
    const todays = events.filter((e) => eventOn(e, date)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const sun = A ? A.sunTimes(date, home.lat, home.lon) : null;
    const moon = A ? A.moonPhase(date) : null;
    const row = (label, value) => `<div class="almanac-row"><span class="faint">${label}</span><span class="mono">${value}</span></div>`;

    // The next few weeks, so a birthday does not creep up on anyone.
    const upcoming = [];
    for (let i = 1; i <= 60 && upcoming.length < 8; i++) {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      for (const e of events) if (eventOn(e, day)) upcoming.push({ e, day, days: i });
    }

    side.innerHTML = `
      <h2 style="margin:0 0 4px">${date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
      ${sameDay(date, today) ? '<p class="faint" style="margin:0 0 10px">Today.</p>' : `<p class="faint" style="margin:0 0 10px">${describeDistance(date, today)}</p>`}

      ${sun ? `<div class="card" style="margin-bottom:12px">
        ${sun.polar ? `<p class="muted" style="margin:0 0 6px">Polar ${sun.polar} here.</p>` : ''}
        ${row('First light', A.formatTime(sun.dawn))}
        ${row('Sunrise', A.formatTime(sun.sunrise))}
        ${row('Sunset', A.formatTime(sun.sunset))}
        ${row('Last light', A.formatTime(sun.dusk))}
        ${row('Day length', A.formatDuration(sun.dayLengthMinutes))}
        ${row('Moon', `${moon.glyph} ${moon.name} · ${Math.round(moon.illumination * 100)}%`)}
      </div>` : ''}

      <h3 style="margin:0 0 8px">Events</h3>
      ${todays.length ? todays.map((e) => `
        <div class="cal-event" style="--chip:${esc(e.colour || EVENT_COLOURS[0])}">
          <div>
            <strong>${esc(e.title)}</strong>${e.time ? ` <span class="mono faint">${esc(e.time)}</span>` : ''}
            ${e.repeat !== 'none' ? `<span class="tag" style="margin-left:6px">${esc(e.repeat)}</span>` : ''}
            ${e.notes ? `<p class="muted" style="margin:4px 0 0;white-space:pre-wrap">${esc(e.notes)}</p>` : ''}
            ${e.repeat !== 'none' && e.date !== CAL.selected ? `<p class="faint" style="margin:4px 0 0">since ${esc(e.date)}</p>` : ''}
          </div>
          <button class="btn btn-sm cal-delete" data-id="${esc(e.id)}" title="Delete this event">×</button>
        </div>`).join('') : '<p class="faint" style="margin:0 0 10px">Nothing on this day.</p>'}

      <form id="cal-add" class="cal-form">
        <input class="map-select" name="title" placeholder="New event — what is happening?" required maxlength="120">
        <div class="row" style="gap:6px">
          <input class="map-select" type="date" name="date" value="${esc(CAL.selected)}" required style="flex:1">
          <input class="map-select" type="time" name="time" style="width:7.5rem">
        </div>
        <div class="row" style="gap:6px">
          <select class="map-select" name="repeat" style="flex:1">
            <option value="none">Once</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
            <option value="yearly">Every year</option>
          </select>
          <span class="swatches" style="margin:0" id="cal-colours">${EVENT_COLOURS.map((c, i) => `<button type="button" class="swatch${i === 0 ? ' selected' : ''}" data-colour="${c}" style="background:${c}"></button>`).join('')}</span>
        </div>
        <textarea class="map-select" name="notes" rows="2" placeholder="Notes (optional)"></textarea>
        <button class="btn btn-primary" type="submit">Add to the calendar</button>
      </form>

      ${upcoming.length ? `<h3 style="margin:16px 0 8px">Coming up</h3>
        ${upcoming.map(({ e, day, days }) => `
          <div class="almanac-row">
            <span><span class="cal-dot" style="--chip:${esc(e.colour || EVENT_COLOURS[0])}"></span>${esc(e.title)}</span>
            <span class="faint">${day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${days === 1 ? 'tomorrow' : `in ${days} days`}</span>
          </div>`).join('')}` : ''}
    `;

    let colour = EVENT_COLOURS[0];
    for (const swatch of side.querySelectorAll('#cal-colours .swatch')) {
      swatch.onclick = () => {
        colour = swatch.dataset.colour;
        side.querySelectorAll('#cal-colours .swatch').forEach((s) => s.classList.remove('selected'));
        swatch.classList.add('selected');
      };
    }

    document.getElementById('cal-add').onsubmit = async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const body = {
        title: form.get('title'), date: form.get('date'), time: form.get('time') || '',
        repeat: form.get('repeat'), notes: form.get('notes') || '', colour,
        by: (typeof profileSelect !== 'undefined' && profileSelect.selectedOptions[0]?.textContent) || '',
      };
      const { event } = await api('calendar', { method: 'POST', body });
      events.push(event);
      CAL.selected = event.date;
      const d = fromIso(event.date);
      CAL.year = d.getFullYear(); CAL.month = d.getMonth();
      saveCal();
      paintGrid(); paintSide();
    };

    for (const button of side.querySelectorAll('.cal-delete')) {
      button.onclick = async () => {
        const event = events.find((e) => e.id === button.dataset.id);
        const repeatNote = event && event.repeat !== 'none' ? ' This removes every repeat of it.' : '';
        if (!confirm(`Delete "${event ? event.title : 'this event'}"?${repeatNote}`)) return;
        await api(`calendar/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
        events = events.filter((e) => e.id !== button.dataset.id);
        paintGrid(); paintSide();
      };
    }
  };

  const shift = (months) => {
    const d = new Date(CAL.year, CAL.month + months, 1);
    CAL.year = d.getFullYear(); CAL.month = d.getMonth();
    saveCal(); paintGrid();
  };
  document.getElementById('cal-prev').onclick = () => shift(-1);
  document.getElementById('cal-next').onclick = () => shift(1);
  document.getElementById('cal-today').onclick = () => {
    CAL.year = today.getFullYear(); CAL.month = today.getMonth(); CAL.selected = isoDate(today);
    saveCal(); paintGrid(); paintSide();
  };

  paintGrid();
  paintSide();
}

function describeDistance(date, today) {
  const days = Math.round((date - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  if (days === 1) return 'Tomorrow.';
  if (days === -1) return 'Yesterday.';
  if (days > 0) return `In ${days} days.`;
  return `${-days} days ago.`;
}

// =================================================================== tools

let AUDIO = null;
function ensureAudio() {
  if (!AUDIO) AUDIO = new (window.AudioContext || window.webkitAudioContext)();
  if (AUDIO.state === 'suspended') AUDIO.resume();
  return AUDIO;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const midiName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

// QWERTY laid out like a piano: the home row is the white keys, the row
// above it the black ones. Same layout most music software uses.
const KEY_TO_SEMITONE = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17,
};

/** A plucked, slightly woody note: two oscillators through a low-pass, with a real envelope. */
function playNote(midi, { hold = 0.9, velocity = 0.5 } = {}) {
  const ctx = ensureAudio();
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.min(6000, midiToHz(midi) * 6), now);
  filter.frequency.exponentialRampToValueAtTime(Math.max(300, midiToHz(midi) * 1.5), now + hold);

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type = 'triangle';
  osc2.type = 'sine';
  osc1.frequency.value = midiToHz(midi);
  osc2.frequency.value = midiToHz(midi) * 2;
  const osc2Gain = ctx.createGain();
  osc2Gain.gain.value = 0.18;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(velocity, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(velocity * 0.55, now + 0.18);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + hold + 0.35);

  osc1.connect(filter);
  osc2.connect(osc2Gain).connect(filter);
  filter.connect(gain).connect(ctx.destination);
  osc1.start(now); osc2.start(now);
  osc1.stop(now + hold + 0.4); osc2.stop(now + hold + 0.4);
  return { stop() { const t = ctx.currentTime; gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25); } };
}

function click(accent) {
  const ctx = ensureAudio();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = accent ? 1600 : 1000;
  gain.gain.setValueAtTime(accent ? 0.5 : 0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now); osc.stop(now + 0.06);
}

function beep(times = 3) {
  const ctx = ensureAudio();
  for (let i = 0; i < times; i++) {
    const t = ctx.currentTime + i * 0.35;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.3);
  }
}

const UNITS = {
  length: { base: 'metre', units: { mm: 0.001, cm: 0.01, m: 1, km: 1000, inch: 0.0254, foot: 0.3048, yard: 0.9144, mile: 1609.344, 'nautical mile': 1852 } },
  mass: { base: 'kilogram', units: { g: 0.001, kg: 1, tonne: 1000, oz: 0.028349523, lb: 0.45359237, stone: 6.35029318 } },
  volume: { base: 'litre', units: { ml: 0.001, litre: 1, tsp: 0.005, tbsp: 0.015, 'cup (metric)': 0.25, 'pint (UK)': 0.56826125, 'pint (US)': 0.473176473, 'gallon (UK)': 4.54609, 'gallon (US)': 3.785411784 } },
  area: { base: 'square metre', units: { 'm²': 1, ha: 10000, 'km²': 1e6, 'ft²': 0.09290304, acre: 4046.8564224, 'sq mile': 2589988.11 } },
  speed: { base: 'metre per second', units: { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, knot: 0.514444 } },
  temperature: { base: '°C', units: { '°C': null, '°F': null, K: null } },
};

function convertUnits(category, value, from, to) {
  if (category === 'temperature') {
    const c = from === '°C' ? value : from === '°F' ? (value - 32) * 5 / 9 : value - 273.15;
    return to === '°C' ? c : to === '°F' ? c * 9 / 5 + 32 : c + 273.15;
  }
  const table = UNITS[category].units;
  return (value * table[from]) / table[to];
}

const tidy = (n) => {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  // Enough digits to keep small results meaningful: 1 mm in km is 0.000001, not 0.
  const digits = abs >= 1000 ? 1 : abs >= 10 ? 2 : abs >= 1 ? 3 : Math.min(10, 3 - Math.floor(Math.log10(abs || 1)));
  return Number(n.toFixed(digits)).toLocaleString(undefined, { maximumFractionDigits: digits });
};

async function renderTools() {
  view.innerHTML = `
    <h1 style="margin:0 0 4px">Tools</h1>
    <p class="muted" style="margin:0 0 16px">Small things that are hard to do without when the phone is dead. All of them run in the page; none of them need a file.</p>

    <div class="card tool-card">
      <div class="row-between" style="flex-wrap:wrap;gap:8px">
        <h2 style="margin:0">Piano</h2>
        <div class="row" style="gap:6px">
          <span class="faint">Octave</span>
          <button class="btn btn-sm" id="piano-down">−</button>
          <span class="mono" id="piano-octave">C4</span>
          <button class="btn btn-sm" id="piano-up">+</button>
        </div>
      </div>
      <p class="faint" style="margin:6px 0 10px">Click the keys, or play from the keyboard: the home row <span class="mono">A S D F G H J K L ; '</span> is the white keys, <span class="mono">W E T Y U O P</span> the black ones. <span class="mono">Z</span> and <span class="mono">X</span> shift octave.</p>
      <div class="piano" id="piano"></div>
    </div>

    <div class="tools-grid">
      <div class="card tool-card">
        <h2 style="margin:0 0 8px">Metronome</h2>
        <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
          <input type="range" id="metro-bpm" min="40" max="240" value="100" style="flex:1;min-width:120px">
          <span class="mono" id="metro-bpm-label" style="min-width:5rem">100 bpm</span>
        </div>
        <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
          <select class="map-select" id="metro-beats" style="width:auto">
            <option value="2">2/4</option><option value="3">3/4</option><option value="4" selected>4/4</option><option value="6">6/8</option>
          </select>
          <button class="btn" id="metro-toggle">Start</button>
          <button class="btn" id="metro-tap" title="Tap this in time to set the tempo">Tap tempo</button>
        </div>
        <div class="metro-beats" id="metro-dots"></div>
        <p class="faint" style="margin:8px 0 0">Reference pitches:
          <button class="btn btn-sm tone" data-midi="69">A 440</button>
          <button class="btn btn-sm tone" data-midi="40">E2</button>
          <button class="btn btn-sm tone" data-midi="45">A2</button>
          <button class="btn btn-sm tone" data-midi="50">D3</button>
          <button class="btn btn-sm tone" data-midi="55">G3</button>
          <button class="btn btn-sm tone" data-midi="59">B3</button>
          <button class="btn btn-sm tone" data-midi="64">E4</button>
          — the six guitar strings.</p>
      </div>

      <div class="card tool-card">
        <h2 style="margin:0 0 8px">Timer</h2>
        <div class="row" style="gap:6px;flex-wrap:wrap;align-items:center">
          <input class="map-select" type="number" id="timer-min" min="0" max="999" value="10" style="width:5rem" aria-label="minutes"> <span class="faint">min</span>
          <input class="map-select" type="number" id="timer-sec" min="0" max="59" value="0" style="width:5rem" aria-label="seconds"> <span class="faint">sec</span>
          <button class="btn" id="timer-toggle">Start</button>
          <button class="btn btn-sm" id="timer-reset">Reset</button>
        </div>
        <div class="timer-face mono" id="timer-face">10:00</div>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm" data-preset="1">1 min · rolling boil makes water safe</button>
          <button class="btn btn-sm" data-preset="3">3 min · same boil above 2,000 m</button>
          <button class="btn btn-sm" data-preset="10">10 min · rice, eggs</button>
          <button class="btn btn-sm" data-preset="45">45 min · bread in the oven</button>
        </div>
        <h3 style="margin:14px 0 6px">Stopwatch</h3>
        <div class="row" style="gap:6px;align-items:center">
          <span class="timer-face mono" id="watch-face" style="margin:0">0:00.0</span>
          <button class="btn btn-sm" id="watch-toggle">Start</button>
          <button class="btn btn-sm" id="watch-reset">Reset</button>
        </div>
      </div>

      <div class="card tool-card">
        <h2 style="margin:0 0 8px">Unit converter</h2>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <select class="map-select" id="conv-cat" style="flex:1">
            ${Object.keys(UNITS).map((c) => `<option value="${c}">${c[0].toUpperCase()}${c.slice(1)}</option>`).join('')}
          </select>
          <input class="map-select" type="number" id="conv-value" value="1" step="any" style="width:8rem">
          <select class="map-select" id="conv-from" style="flex:1"></select>
        </div>
        <div id="conv-out" style="margin-top:10px"></div>
      </div>
    </div>`;

  const cleanups = [];
  const cleanup = () => { for (const fn of cleanups) fn(); };
  window.addEventListener('hashchange', cleanup, { once: true });

  // --- piano ---
  const piano = document.getElementById('piano');
  let octaveBase = 60; // C4
  const octaveLabel = document.getElementById('piano-octave');
  const held = new Map();

  const paintPiano = () => {
    octaveLabel.textContent = midiName(octaveBase);
    const keys = [];
    for (let i = 0; i < 25; i++) {
      const midi = octaveBase + i;
      const black = NOTE_NAMES[midi % 12].includes('#');
      const letter = Object.entries(KEY_TO_SEMITONE).find(([, semi]) => semi === i)?.[0];
      keys.push(`<button class="piano-key ${black ? 'black' : 'white'}" data-midi="${midi}" title="${midiName(midi)}">
        <span class="piano-note">${black ? '' : midiName(midi)}</span>${letter ? `<span class="piano-letter">${letter.toUpperCase()}</span>` : ''}
      </button>`);
    }
    piano.innerHTML = keys.join('');
    for (const key of piano.querySelectorAll('.piano-key')) {
      key.onpointerdown = (e) => { e.preventDefault(); press(Number(key.dataset.midi)); };
      key.onpointerup = () => release(Number(key.dataset.midi));
      key.onpointerleave = () => release(Number(key.dataset.midi));
    }
  };
  const press = (midi) => {
    if (held.has(midi)) return;
    held.set(midi, playNote(midi, { hold: 1.4 }));
    piano.querySelector(`[data-midi="${midi}"]`)?.classList.add('down');
  };
  const release = (midi) => {
    const voice = held.get(midi);
    if (voice) { voice.stop(); held.delete(midi); }
    piano.querySelector(`[data-midi="${midi}"]`)?.classList.remove('down');
  };
  document.getElementById('piano-up').onclick = () => { octaveBase = Math.min(84, octaveBase + 12); paintPiano(); };
  document.getElementById('piano-down').onclick = () => { octaveBase = Math.max(24, octaveBase - 12); paintPiano(); };

  const onKeyDown = (e) => {
    if (e.repeat || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    const key = e.key.toLowerCase();
    if (key === 'z') { octaveBase = Math.max(24, octaveBase - 12); paintPiano(); return; }
    if (key === 'x') { octaveBase = Math.min(84, octaveBase + 12); paintPiano(); return; }
    if (key in KEY_TO_SEMITONE) { e.preventDefault(); press(octaveBase + KEY_TO_SEMITONE[key]); }
  };
  const onKeyUp = (e) => {
    const key = e.key.toLowerCase();
    if (key in KEY_TO_SEMITONE) release(octaveBase + KEY_TO_SEMITONE[key]);
  };
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  cleanups.push(() => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('keyup', onKeyUp); });
  paintPiano();

  for (const button of view.querySelectorAll('.tone')) {
    button.onclick = () => playNote(Number(button.dataset.midi), { hold: 2.2, velocity: 0.45 });
  }

  // --- metronome ---
  const bpmInput = document.getElementById('metro-bpm');
  const bpmLabel = document.getElementById('metro-bpm-label');
  const beatsSelect = document.getElementById('metro-beats');
  const dots = document.getElementById('metro-dots');
  const metroToggle = document.getElementById('metro-toggle');
  let metroTimer = null;
  let nextTick = 0;
  let beat = 0;
  const paintDots = (active = -1) => {
    dots.innerHTML = Array.from({ length: Number(beatsSelect.value) }, (_, i) => `<span class="metro-dot${i === active ? ' on' : ''}${i === 0 ? ' accent' : ''}"></span>`).join('');
  };
  bpmInput.oninput = () => { bpmLabel.textContent = `${bpmInput.value} bpm`; };
  beatsSelect.onchange = () => { beat = 0; paintDots(); };
  const stopMetro = () => { clearInterval(metroTimer); metroTimer = null; metroToggle.textContent = 'Start'; paintDots(); };
  metroToggle.onclick = () => {
    if (metroTimer) return stopMetro();
    const ctx = ensureAudio();
    nextTick = ctx.currentTime + 0.05;
    beat = 0;
    metroToggle.textContent = 'Stop';
    // Look a little ahead and schedule on the audio clock; setInterval alone drifts.
    metroTimer = setInterval(() => {
      while (nextTick < ctx.currentTime + 0.1) {
        const beats = Number(beatsSelect.value);
        const accent = beat % beats === 0;
        const at = nextTick;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = accent ? 1600 : 1000;
        gain.gain.setValueAtTime(accent ? 0.5 : 0.3, at);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at); osc.stop(at + 0.06);
        const thisBeat = beat % beats;
        setTimeout(() => paintDots(thisBeat), Math.max(0, (at - ctx.currentTime) * 1000));
        nextTick += 60 / Number(bpmInput.value);
        beat++;
      }
    }, 25);
  };
  const taps = [];
  document.getElementById('metro-tap').onclick = () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    click(true);
    if (taps.length >= 2) {
      const gaps = taps.slice(1).map((t, i) => t - taps[i]);
      const bpm = Math.round(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
      bpmInput.value = Math.max(40, Math.min(240, bpm));
      bpmInput.oninput();
    }
  };
  paintDots();
  cleanups.push(stopMetro);

  // --- timer ---
  const minInput = document.getElementById('timer-min');
  const secInput = document.getElementById('timer-sec');
  const face = document.getElementById('timer-face');
  const timerToggle = document.getElementById('timer-toggle');
  let remaining = 600;
  let timerTick = null;
  const showTimer = () => {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    face.textContent = `${m}:${String(s).padStart(2, '0')}`;
    face.classList.toggle('done', remaining === 0);
  };
  const setFromInputs = () => { remaining = Number(minInput.value) * 60 + Number(secInput.value); showTimer(); };
  minInput.onchange = secInput.onchange = setFromInputs;
  const stopTimer = () => { clearInterval(timerTick); timerTick = null; timerToggle.textContent = 'Start'; };
  timerToggle.onclick = () => {
    if (timerTick) return stopTimer();
    if (remaining <= 0) setFromInputs();
    if (remaining <= 0) return;
    ensureAudio();
    timerToggle.textContent = 'Pause';
    const endAt = Date.now() + remaining * 1000;
    timerTick = setInterval(() => {
      remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
      showTimer();
      if (remaining === 0) { stopTimer(); beep(4); }
    }, 250);
  };
  document.getElementById('timer-reset').onclick = () => { stopTimer(); setFromInputs(); };
  for (const button of view.querySelectorAll('[data-preset]')) {
    button.onclick = () => { stopTimer(); minInput.value = button.dataset.preset; secInput.value = 0; setFromInputs(); };
  }
  showTimer();
  cleanups.push(stopTimer);

  // --- stopwatch ---
  const watchFace = document.getElementById('watch-face');
  const watchToggle = document.getElementById('watch-toggle');
  let watchStart = 0;
  let watchBase = 0;
  let watchTick = null;
  const showWatch = () => {
    const ms = watchBase + (watchTick ? Date.now() - watchStart : 0);
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const tenths = Math.floor((ms % 1000) / 100);
    watchFace.textContent = `${m}:${String(s).padStart(2, '0')}.${tenths}`;
  };
  const stopWatch = () => { if (watchTick) { watchBase += Date.now() - watchStart; clearInterval(watchTick); watchTick = null; } watchToggle.textContent = 'Start'; showWatch(); };
  watchToggle.onclick = () => {
    if (watchTick) return stopWatch();
    watchStart = Date.now();
    watchTick = setInterval(showWatch, 100);
    watchToggle.textContent = 'Stop';
  };
  document.getElementById('watch-reset').onclick = () => { stopWatch(); watchBase = 0; showWatch(); };
  cleanups.push(stopWatch);

  // --- converter ---
  const catSelect = document.getElementById('conv-cat');
  const fromSelect = document.getElementById('conv-from');
  const valueInput = document.getElementById('conv-value');
  const out = document.getElementById('conv-out');
  const paintUnits = () => {
    fromSelect.innerHTML = Object.keys(UNITS[catSelect.value].units).map((u) => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
    convert();
  };
  const convert = () => {
    const value = Number(valueInput.value);
    const category = catSelect.value;
    const from = fromSelect.value;
    out.innerHTML = Object.keys(UNITS[category].units)
      .filter((u) => u !== from)
      .map((u) => `<div class="almanac-row"><span class="faint">${esc(u)}</span><span class="mono">${tidy(convertUnits(category, value, from, u))}</span></div>`)
      .join('');
  };
  catSelect.onchange = paintUnits;
  fromSelect.onchange = convert;
  valueInput.oninput = convert;
  paintUnits();
}

window.renderCalendar = renderCalendar;
window.renderTools = renderTools;
