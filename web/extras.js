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

/**
 * Where "here" is.
 *
 * Everything that depends on where you are stands on this: which stars are
 * above you, when the sun rises, which way is north at noon, when the frosts
 * come. It is set once in Setup and kept on the server, so every device in
 * the house agrees and a wiped browser does not lose it.
 *
 * Failing that, wherever the map was last left — which is at least somewhere
 * the person has actually been looking — and failing that the middle of
 * Britain, because a copy has to start somewhere. The last one is the only
 * part that assumes anything, and Setup says so.
 */
function homePosition() {
  const home = (typeof STATUS !== 'undefined' && STATUS && STATUS.home) || null;
  if (home && Number.isFinite(home.lat) && Number.isFinite(home.lon)) {
    return { lat: home.lat, lon: home.lon, name: home.name || '', source: 'set' };
  }
  try {
    const v = JSON.parse(localStorage.getItem('vault.mapView') || 'null');
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lon)) {
      return { lat: v.lat, lon: v.lon, name: '', source: 'map', fromMap: true };
    }
  } catch { /* fall through */ }
  return { lat: 54.0, lon: -2.0, name: '', source: 'default', fromMap: false };
}

/** How to say where these times are worked out for, and whether to trust it. */
function describeHome(home) {
  const coords = `${home.lat.toFixed(2)}, ${home.lon.toFixed(2)}`;
  if (home.source === 'set') return home.name ? `${home.name} (${coords})` : coords;
  if (home.source === 'map') return `${coords} — where the map was left. Set where you live in Setup › Where you are.`;
  return 'the middle of Britain, because nowhere has been set. Setup › Where you are.';
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
  where.textContent = describeHome(home);

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

// =================================================================== audio

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

/** Anything on the page that should stop when the page changes registers here. */
function pageCleanup() {
  const fns = [];
  window.addEventListener('hashchange', () => { for (const fn of fns) fn(); }, { once: true });
  return (fn) => fns.push(fn);
}

// =================================================================== music

async function renderMusic() {
  view.innerHTML = `
    <h1 style="margin:0 0 4px">Music</h1>
    <p class="muted" style="margin:0 0 16px">An instrument that needs no batteries beyond the one in this machine. Enough to learn the notes, keep time, and tune a real one.</p>

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
        <p class="faint" style="margin:10px 0 0">Largo 40–60 · Adagio 66–76 · Andante 76–108 · Moderato 108–120 · Allegro 120–168 · Presto 168–200</p>
      </div>

      <div class="card tool-card">
        <h2 style="margin:0 0 8px">Tuning</h2>
        <p class="faint" style="margin:0 0 8px">Reference pitches. Play one and tune the string until the beating stops.</p>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm tone" data-midi="69">A 440</button>
          <span class="faint" style="width:100%">Guitar, low to high:</span>
          <button class="btn btn-sm tone" data-midi="40">E2</button>
          <button class="btn btn-sm tone" data-midi="45">A2</button>
          <button class="btn btn-sm tone" data-midi="50">D3</button>
          <button class="btn btn-sm tone" data-midi="55">G3</button>
          <button class="btn btn-sm tone" data-midi="59">B3</button>
          <button class="btn btn-sm tone" data-midi="64">E4</button>
          <span class="faint" style="width:100%">Violin:</span>
          <button class="btn btn-sm tone" data-midi="55">G3</button>
          <button class="btn btn-sm tone" data-midi="62">D4</button>
          <button class="btn btn-sm tone" data-midi="69">A4</button>
          <button class="btn btn-sm tone" data-midi="76">E5</button>
          <span class="faint" style="width:100%">Ukulele:</span>
          <button class="btn btn-sm tone" data-midi="67">G4</button>
          <button class="btn btn-sm tone" data-midi="60">C4</button>
          <button class="btn btn-sm tone" data-midi="64">E4</button>
          <button class="btn btn-sm tone" data-midi="69">A4</button>
        </div>
        <h3 style="margin:14px 0 6px">First chords</h3>
        <div class="row" style="gap:6px;flex-wrap:wrap" id="chords"></div>
        <p class="faint" style="margin:8px 0 0">Click a chord to hear it. Major sounds settled; minor sounds sad. Most songs ever written use four of these.</p>
      </div>
    </div>`;

  const onCleanup = pageCleanup();

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
        <span class="piano-note">${midiName(midi)}</span>${letter ? `<span class="piano-letter">${letter.toUpperCase()}</span>` : ''}
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
  onCleanup(() => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('keyup', onKeyUp); });
  paintPiano();

  for (const button of view.querySelectorAll('.tone')) {
    button.onclick = () => playNote(Number(button.dataset.midi), { hold: 2.2, velocity: 0.45 });
  }

  // --- chords ---
  const CHORDS = [
    ['C', [60, 64, 67]], ['G', [55, 59, 62, 67]], ['Am', [57, 60, 64]], ['F', [53, 57, 60, 65]],
    ['D', [62, 66, 69]], ['Em', [52, 55, 59, 64]], ['Dm', [62, 65, 69]], ['E', [52, 56, 59, 64]], ['A', [57, 61, 64]],
  ];
  document.getElementById('chords').innerHTML = CHORDS.map(([name, notes]) => `<button class="btn btn-sm chord" data-notes="${notes.join(',')}">${name}</button>`).join('');
  for (const button of view.querySelectorAll('.chord')) {
    button.onclick = () => {
      const notes = button.dataset.notes.split(',').map(Number);
      notes.forEach((n, i) => setTimeout(() => playNote(n, { hold: 1.8, velocity: 0.35 }), i * 35));
    };
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
  onCleanup(stopMetro);
}

// =================================================================== tools

const UNITS = {
  length: { base: 'metre', units: { mm: 0.001, cm: 0.01, m: 1, km: 1000, inch: 0.0254, foot: 0.3048, yard: 0.9144, mile: 1609.344, 'nautical mile': 1852 } },
  mass: { base: 'kilogram', units: { g: 0.001, kg: 1, tonne: 1000, oz: 0.028349523, lb: 0.45359237, stone: 6.35029318 } },
  volume: { base: 'litre', units: { ml: 0.001, litre: 1, tsp: 0.005, tbsp: 0.015, 'cup (metric)': 0.25, 'pint (UK)': 0.56826125, 'pint (US)': 0.473176473, 'gallon (UK)': 4.54609, 'gallon (US)': 3.785411784 } },
  area: { base: 'square metre', units: { 'm²': 1, ha: 10000, 'km²': 1e6, 'ft²': 0.09290304, acre: 4046.8564224, 'sq mile': 2589988.11 } },
  speed: { base: 'metre per second', units: { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, knot: 0.514444 } },
  temperature: { base: '°C', units: { '°C': null, '°F': null, K: null } },
  energy: { base: 'joule', units: { J: 1, kJ: 1000, kcal: 4184, Wh: 3600, kWh: 3.6e6 } },
  pressure: { base: 'pascal', units: { Pa: 1, kPa: 1000, bar: 1e5, atm: 101325, psi: 6894.757, mmHg: 133.322 } },
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

// --- calculator: a small expression evaluator, no eval() ------------------

const CALC_FUNCTIONS = {
  sin: (x, deg) => Math.sin(deg ? x * Math.PI / 180 : x),
  cos: (x, deg) => Math.cos(deg ? x * Math.PI / 180 : x),
  tan: (x, deg) => Math.tan(deg ? x * Math.PI / 180 : x),
  asin: (x, deg) => (deg ? Math.asin(x) * 180 / Math.PI : Math.asin(x)),
  acos: (x, deg) => (deg ? Math.acos(x) * 180 / Math.PI : Math.acos(x)),
  atan: (x, deg) => (deg ? Math.atan(x) * 180 / Math.PI : Math.atan(x)),
  sqrt: (x) => Math.sqrt(x), cbrt: (x) => Math.cbrt(x),
  ln: (x) => Math.log(x), log: (x) => Math.log10(x), log2: (x) => Math.log2(x),
  exp: (x) => Math.exp(x), abs: (x) => Math.abs(x),
  round: (x) => Math.round(x), floor: (x) => Math.floor(x), ceil: (x) => Math.ceil(x),
};
const CALC_CONSTANTS = { pi: Math.PI, e: Math.E, g: 9.80665, c: 299792458 };

/**
 * Evaluate "2*(3+4)^2 / sqrt(16)" and the like. A hand-rolled recursive
 * descent parser: numbers, + − × ÷ ^ %, brackets, the functions above,
 * pi and e, and "ans" for the previous answer.
 */
function calculate(text, { degrees = true, ans = 0 } = {}) {
  const src = text.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, '');
  let pos = 0;
  const peek = () => src[pos];
  const fail = (why) => { throw new Error(why); };

  function number() {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(pos));
    if (!m) fail(`Expected a number at "${src.slice(pos, pos + 6) || 'end'}"`);
    pos += m[0].length;
    return Number(m[0]);
  }
  function primary() {
    const ch = peek();
    if (ch === undefined) fail('Unexpected end');
    if (ch === '(') {
      pos++;
      const v = expression();
      if (peek() !== ')') fail('Missing )');
      pos++;
      return v;
    }
    if (ch === '-') { pos++; return -power(); } // so -3^2 is -9, as on paper
    if (ch === '+') { pos++; return power(); }
    const word = /^[a-z][a-z0-9]*/i.exec(src.slice(pos));
    if (word) {
      const name = word[0].toLowerCase();
      pos += name.length;
      if (name === 'ans') return ans;
      if (name in CALC_CONSTANTS) return CALC_CONSTANTS[name];
      if (name in CALC_FUNCTIONS) {
        if (peek() !== '(') fail(`${name} needs brackets: ${name}(…)`);
        pos++;
        const v = expression();
        if (peek() !== ')') fail('Missing )');
        pos++;
        return CALC_FUNCTIONS[name](v, degrees);
      }
      fail(`Unknown word "${name}"`);
    }
    return number();
  }
  function unary() {
    let v = primary();
    while (peek() === '!') { pos++; v = factorial(v); }
    while (peek() === '%') { pos++; v /= 100; }
    return v;
  }
  function power() {
    const base = unary();
    if (peek() === '^') { pos++; return Math.pow(base, power()); }
    return base;
  }
  function term() {
    let v = power();
    for (;;) {
      const ch = peek();
      if (ch === '*') { pos++; v *= power(); }
      else if (ch === '/') { pos++; v /= power(); }
      else if (ch === '(' ) { v *= primary(); } // 2(3+4)
      else return v;
    }
  }
  function expression() {
    let v = term();
    for (;;) {
      const ch = peek();
      if (ch === '+') { pos++; v += term(); }
      else if (ch === '-') { pos++; v -= term(); }
      else return v;
    }
  }
  function factorial(n) {
    if (n < 0 || n !== Math.floor(n) || n > 170) fail('Factorial needs a whole number up to 170');
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  if (!src) return null;
  const value = expression();
  if (pos < src.length) fail(`Did not understand "${src.slice(pos)}"`);
  return value;
}

// --- Morse ---------------------------------------------------------------

const MORSE = {
  a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---',
  k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-',
  u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..',
  1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', 0: '-----',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '@': '.--.-.',
};
const MORSE_REVERSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

function textToMorse(text) {
  return text.toLowerCase().split(/\s+/).map((word) => [...word].map((ch) => MORSE[ch] || '').filter(Boolean).join(' ')).join(' / ');
}

function morseToText(code) {
  return code.trim().split(/\s*\/\s*|\s{3,}/).map((word) => word.trim().split(/\s+/).map((c) => MORSE_REVERSE[c] || '?').join('')).join(' ');
}

/** Play Morse at a given words-per-minute (PARIS standard: dit = 1200 / wpm ms). */
function playMorse(text, wpm = 12, pitch = 700) {
  const ctx = ensureAudio();
  const dit = 1.2 / wpm;
  let t = ctx.currentTime + 0.05;
  const words = text.toLowerCase().split(/\s+/);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = pitch;
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  const tone = (len) => {
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.45, t + 0.004);
    gain.gain.setValueAtTime(0.45, t + len - 0.004);
    gain.gain.linearRampToValueAtTime(0, t + len);
    t += len;
  };
  words.forEach((word, wi) => {
    [...word].forEach((ch, ci) => {
      const code = MORSE[ch];
      if (!code) return;
      [...code].forEach((sym, si) => {
        tone(sym === '.' ? dit : dit * 3);
        if (si < code.length - 1) t += dit;
      });
      if (ci < word.length - 1) t += dit * 3;
    });
    if (wi < words.length - 1) t += dit * 7;
  });
  osc.stop(t + 0.1);
  return { seconds: t - ctx.currentTime, stop() { try { osc.stop(); } catch { /* done */ } } };
}

async function renderTools() {
  view.innerHTML = `
    <h1 style="margin:0 0 4px">Tools</h1>
    <p class="muted" style="margin:0 0 16px">Small things that are hard to do without when the phone is dead. All of them run in the page; none of them need a file.</p>

    <div class="tools-grid">
      <div class="card tool-card">
        <h2 style="margin:0 0 8px">Calculator</h2>
        <form id="calc-form" class="row" style="gap:6px">
          <input class="map-select mono" id="calc-input" placeholder="2 * (3 + 4)^2 / sqrt(16)" autocomplete="off" style="flex:1" spellcheck="false">
          <button class="btn btn-primary" type="submit">=</button>
        </form>
        <div class="calc-result mono" id="calc-result">&nbsp;</div>
        <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">
          <label class="checkbox-row" style="font-size:13px"><input type="checkbox" id="calc-degrees" checked><span>Angles in degrees</span></label>
        </div>
        <div class="calc-keys" id="calc-keys">
          ${['7', '8', '9', '÷', '(', ')', '4', '5', '6', '×', '^', 'sqrt(', '1', '2', '3', '−', 'pi', 'sin(', '0', '.', 'ans', '+', 'e', 'cos(', '%', '!', 'log(', 'ln(', 'tan(', 'C'].map((k) => `<button type="button" class="btn btn-sm" data-key="${esc(k)}">${esc(k)}</button>`).join('')}
        </div>
        <div id="calc-history" class="faint" style="margin-top:8px"></div>
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
        <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap">
          <span class="timer-face mono" id="watch-face" style="margin:0">0:00.0</span>
          <button class="btn btn-sm" id="watch-toggle">Start</button>
          <button class="btn btn-sm" id="watch-lap">Lap</button>
          <button class="btn btn-sm" id="watch-reset">Reset</button>
        </div>
        <div id="watch-laps" class="mono faint" style="margin-top:6px"></div>
      </div>

      <div class="card tool-card">
        <h2 style="margin:0 0 8px">Morse code</h2>
        <p class="faint" style="margin:0 0 8px">Works over a torch, a whistle, a radio carrier or a tapped pipe. SOS is <span class="mono">··· −−− ···</span>.</p>
        <textarea class="map-select mono" id="morse-text" rows="2" placeholder="Type text here…" style="width:100%"></textarea>
        <div class="morse-out mono" id="morse-out">&nbsp;</div>
        <div class="row" style="gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px">
          <button class="btn" id="morse-play">Play</button>
          <label class="faint">Speed <input type="range" id="morse-wpm" min="5" max="30" value="12" style="vertical-align:middle"> <span class="mono" id="morse-wpm-label">12 wpm</span></label>
          <button class="btn btn-sm" id="morse-flash" title="Flash the screen instead of sounding it">Flash it</button>
        </div>
        <h3 style="margin:14px 0 6px">Practice</h3>
        <p class="faint" style="margin:0 0 6px">Hear a letter, type what it was. Start with the easy ones and it adds more as you get them right.</p>
        <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-sm" id="morse-quiz-play">Play one</button>
          <input class="map-select mono" id="morse-answer" maxlength="1" style="width:4rem;text-align:center" placeholder="?">
          <span id="morse-quiz-result" class="mono"></span>
          <span class="faint" id="morse-quiz-score"></span>
        </div>
        <details style="margin-top:10px"><summary class="faint">The alphabet</summary>
          <div class="morse-table mono">${Object.entries(MORSE).filter(([k]) => /^[a-z0-9]$/.test(k)).map(([k, v]) => `<span><b>${k.toUpperCase()}</b> ${v.replace(/\./g, '·').replace(/-/g, '−')}</span>`).join('')}</div>
        </details>
      </div>
    </div>`;

  const onCleanup = pageCleanup();

  // --- calculator ---
  const calcInput = document.getElementById('calc-input');
  const calcResult = document.getElementById('calc-result');
  const calcHistory = document.getElementById('calc-history');
  let ans = 0;
  const history = [];
  const evaluate = () => {
    try {
      const value = calculate(calcInput.value, { degrees: document.getElementById('calc-degrees').checked, ans });
      if (value === null) { calcResult.innerHTML = '&nbsp;'; return; }
      ans = value;
      calcResult.textContent = Number.isInteger(value) && Math.abs(value) < 1e15 ? value.toLocaleString() : tidy(value);
      calcResult.classList.remove('bad');
      history.unshift(`${calcInput.value} = ${calcResult.textContent}`);
      calcHistory.innerHTML = history.slice(0, 5).map((h) => `<div>${esc(h)}</div>`).join('');
    } catch (err) {
      calcResult.textContent = err.message;
      calcResult.classList.add('bad');
    }
  };
  document.getElementById('calc-form').onsubmit = (e) => { e.preventDefault(); evaluate(); };
  for (const key of view.querySelectorAll('#calc-keys [data-key]')) {
    key.onclick = () => {
      const k = key.dataset.key;
      if (k === 'C') { calcInput.value = ''; calcResult.innerHTML = '&nbsp;'; }
      else calcInput.value += k;
      calcInput.focus();
    };
  }

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
  onCleanup(stopTimer);

  // --- stopwatch ---
  const watchFace = document.getElementById('watch-face');
  const watchToggle = document.getElementById('watch-toggle');
  const laps = document.getElementById('watch-laps');
  let watchStart = 0;
  let watchBase = 0;
  let watchTick = null;
  let lapCount = 0;
  const elapsedMs = () => watchBase + (watchTick ? Date.now() - watchStart : 0);
  const fmtWatch = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
  const showWatch = () => { watchFace.textContent = fmtWatch(elapsedMs()); };
  const stopWatch = () => { if (watchTick) { watchBase += Date.now() - watchStart; clearInterval(watchTick); watchTick = null; } watchToggle.textContent = 'Start'; showWatch(); };
  watchToggle.onclick = () => {
    if (watchTick) return stopWatch();
    watchStart = Date.now();
    watchTick = setInterval(showWatch, 100);
    watchToggle.textContent = 'Stop';
  };
  document.getElementById('watch-lap').onclick = () => {
    if (!watchTick && !watchBase) return;
    lapCount++;
    laps.insertAdjacentHTML('afterbegin', `<div>Lap ${lapCount} · ${fmtWatch(elapsedMs())}</div>`);
  };
  document.getElementById('watch-reset').onclick = () => { stopWatch(); watchBase = 0; lapCount = 0; laps.innerHTML = ''; showWatch(); };
  onCleanup(stopWatch);

  // --- morse ---
  const morseText = document.getElementById('morse-text');
  const morseOut = document.getElementById('morse-out');
  const wpmInput = document.getElementById('morse-wpm');
  const wpmLabel = document.getElementById('morse-wpm-label');
  let playing = null;
  morseText.oninput = () => {
    const t = morseText.value.trim();
    morseOut.textContent = t ? (/^[.\-·−\s/]+$/.test(t) ? morseToText(t.replace(/·/g, '.').replace(/−/g, '-')) : textToMorse(t).replace(/\./g, '·').replace(/-/g, '−')) : '';
    if (!t) morseOut.innerHTML = '&nbsp;';
  };
  wpmInput.oninput = () => { wpmLabel.textContent = `${wpmInput.value} wpm`; };
  document.getElementById('morse-play').onclick = () => {
    if (playing) playing.stop();
    const t = morseText.value.trim();
    if (!t) return;
    const text = /^[.\-·−\s/]+$/.test(t) ? morseToText(t.replace(/·/g, '.').replace(/−/g, '-')) : t;
    playing = playMorse(text, Number(wpmInput.value));
  };
  // A visual send: the whole page flashes, for a torch across a valley or
  // teaching without waking the house.
  let flashTimers = [];
  document.getElementById('morse-flash').onclick = () => {
    for (const id of flashTimers) clearTimeout(id);
    flashTimers = [];
    const t = morseText.value.trim();
    if (!t) return;
    const dit = 1200 / Number(wpmInput.value);
    let at = 0;
    const flash = document.createElement('div');
    flash.className = 'morse-flash';
    document.body.appendChild(flash);
    const on = (len) => {
      flashTimers.push(setTimeout(() => { flash.style.opacity = '1'; }, at));
      flashTimers.push(setTimeout(() => { flash.style.opacity = '0'; }, at + len));
      at += len;
    };
    t.toLowerCase().split(/\s+/).forEach((word, wi, words) => {
      [...word].forEach((ch, ci) => {
        const code = MORSE[ch];
        if (!code) return;
        [...code].forEach((sym, si) => { on(sym === '.' ? dit : dit * 3); if (si < code.length - 1) at += dit; });
        if (ci < word.length - 1) at += dit * 3;
      });
      if (wi < words.length - 1) at += dit * 7;
    });
    flashTimers.push(setTimeout(() => flash.remove(), at + 300));
    onCleanup(() => { for (const id of flashTimers) clearTimeout(id); flash.remove(); });
  };
  onCleanup(() => { if (playing) playing.stop(); });

  // Practice: Koch-style — a few letters at first, another when you are right often.
  const KOCH = 'kmrsuaptlowi.njef0yv,g5/q9zh38b?427c1d6x';
  let known = 2;
  let asked = null;
  let right = 0;
  let total = 0;
  const answer = document.getElementById('morse-answer');
  const result = document.getElementById('morse-quiz-result');
  const score = document.getElementById('morse-quiz-score');
  document.getElementById('morse-quiz-play').onclick = () => {
    asked = KOCH[Math.floor(Math.random() * known)];
    playMorse(asked, Math.max(15, Number(wpmInput.value)));
    answer.value = '';
    answer.focus();
    result.textContent = '';
  };
  answer.oninput = () => {
    if (!asked || !answer.value) return;
    total++;
    if (answer.value.toLowerCase() === asked) {
      right++;
      result.textContent = `✓ ${asked.toUpperCase()}`;
      if (right % 4 === 0 && known < KOCH.length) known++;
    } else {
      result.textContent = `✗ it was ${asked.toUpperCase()} (${MORSE[asked].replace(/\./g, '·').replace(/-/g, '−')})`;
    }
    score.textContent = `${right}/${total} · ${known} letters in play`;
    asked = null;
  };
}

window.renderCalendar = renderCalendar;
window.renderMusic = renderMusic;
window.renderTools = renderTools;
window.vaultAudio = { ensureAudio, playNote, beep, click };
window.vaultCalc = { calculate };
window.homePosition = homePosition;
window.describeHome = describeHome;
