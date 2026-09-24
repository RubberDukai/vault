'use strict';
/* Vault science: the periodic table and the night sky.
   The sky is computed, not downloaded — planets from their orbital elements,
   the Moon from a short series, the stars from the catalogue in stars.js —
   so it works for any place and any date with no data at all. */

// ============================================================== astronomy

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const OBLIQUITY = 23.43928 * DEG2RAD;

const norm360 = (d) => ((d % 360) + 360) % 360;

function julianDay(date) { return date.getTime() / 86400000 + 2440587.5; }

/** Greenwich mean sidereal time in degrees. */
function gmst(date) {
  const d = julianDay(date) - 2451545.0;
  const T = d / 36525;
  return norm360(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T);
}

/** Altitude and azimuth (from north, through east) of a sky position. */
function altAz(raHours, decDeg, date, lat, lon) {
  const H = (norm360(gmst(date) + lon) - raHours * 15) * DEG2RAD;
  const phi = lat * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const sinAlt = Math.sin(dec) * Math.sin(phi) + Math.cos(dec) * Math.cos(phi) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD2DEG;
  const az = norm360(Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) * RAD2DEG + 180);
  return { alt, az };
}

// Keplerian elements at J2000 and their change per century (JPL's
// approximate table, valid 1800–2050): a (AU), e, I, L, long. of perihelion, long. of node.
const PLANET_ELEMENTS = {
  Mercury: { a: [0.38709927, 0.00000037], e: [0.20563593, 0.00001906], I: [7.00497902, -0.00594749], L: [252.25032350, 149472.67411175], w: [77.45779628, 0.16047689], O: [48.33076593, -0.12534081] },
  Venus: { a: [0.72333566, 0.00000390], e: [0.00677672, -0.00004107], I: [3.39467605, -0.00078890], L: [181.97909950, 58517.81538729], w: [131.60246718, 0.00268329], O: [76.67984255, -0.27769418] },
  Earth: { a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668], L: [100.46457166, 35999.37244981], w: [102.93768193, 0.32327364], O: [0, 0] },
  Mars: { a: [1.52371034, 0.00001847], e: [0.09339410, 0.00007882], I: [1.84969142, -0.00813131], L: [-4.55343205, 19140.30268499], w: [-23.94362959, 0.44441088], O: [49.55953891, -0.29257343] },
  Jupiter: { a: [5.20288700, -0.00011607], e: [0.04838624, -0.00013253], I: [1.30439695, -0.00183714], L: [34.39644051, 3034.74612775], w: [14.72847983, 0.21252668], O: [100.47390909, 0.20469106] },
  Saturn: { a: [9.53667594, -0.00125060], e: [0.05386179, -0.00050991], I: [2.48599187, 0.00193609], L: [49.95424423, 1222.49362201], w: [92.59887831, -0.41897216], O: [113.66242448, -0.28867794] },
};

/** Heliocentric ecliptic position (AU) of a planet at a date. */
function heliocentric(name, date) {
  const el = PLANET_ELEMENTS[name];
  const T = (julianDay(date) - 2451545.0) / 36525;
  const at = (pair) => pair[0] + pair[1] * T;
  const a = at(el.a);
  const e = at(el.e);
  const I = at(el.I) * DEG2RAD;
  const L = at(el.L);
  const wBar = at(el.w);
  const O = at(el.O) * DEG2RAD;
  const w = (wBar - at(el.O)) * DEG2RAD;
  let M = norm360(L - wBar);
  if (M > 180) M -= 360;
  M *= DEG2RAD;
  // Kepler's equation by iteration.
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w); const sw = Math.sin(w);
  const cO = Math.cos(O); const sO = Math.sin(O);
  const cI = Math.cos(I); const sI = Math.sin(I);
  return {
    x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    z: (sw * sI) * xp + (cw * sI) * yp,
  };
}

/** Geocentric ecliptic → RA (hours), Dec (deg). */
function eclipticToEquatorial(x, y, z) {
  const xe = x;
  const ye = Math.cos(OBLIQUITY) * y - Math.sin(OBLIQUITY) * z;
  const ze = Math.sin(OBLIQUITY) * y + Math.cos(OBLIQUITY) * z;
  const ra = norm360(Math.atan2(ye, xe) * RAD2DEG) / 15;
  const dec = Math.atan2(ze, Math.hypot(xe, ye)) * RAD2DEG;
  return { ra, dec, distance: Math.hypot(xe, ye, ze) };
}

function planetPosition(name, date) {
  const earth = heliocentric('Earth', date);
  if (name === 'Sun') return eclipticToEquatorial(-earth.x, -earth.y, -earth.z);
  const p = heliocentric(name, date);
  return eclipticToEquatorial(p.x - earth.x, p.y - earth.y, p.z - earth.z);
}

/** The Moon, geocentric, to about a third of a degree (Astronomical Almanac low-precision series). */
function moonPosition(date) {
  const T = (julianDay(date) - 2451545.0) / 36525;
  const s = (deg) => Math.sin(deg * DEG2RAD);
  const lambda = 218.32 + 481267.881 * T
    + 6.29 * s(135.0 + 477198.87 * T) - 1.27 * s(259.3 - 413335.36 * T) + 0.66 * s(235.7 + 890534.22 * T)
    + 0.21 * s(269.9 + 954397.74 * T) - 0.19 * s(357.5 + 35999.05 * T) - 0.11 * s(186.5 + 966404.03 * T);
  const beta = 5.13 * s(93.3 + 483202.02 * T) + 0.28 * s(228.2 + 960400.89 * T) - 0.28 * s(318.3 + 6003.15 * T) - 0.17 * s(217.6 - 407332.21 * T);
  const l = lambda * DEG2RAD; const b = beta * DEG2RAD;
  return eclipticToEquatorial(Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b));
}

const PLANET_STYLE = {
  Mercury: { colour: '#c8c0b0', size: 3 }, Venus: { colour: '#fff4c0', size: 5 }, Mars: { colour: '#ff7a50', size: 4 },
  Jupiter: { colour: '#f0d8a8', size: 5 }, Saturn: { colour: '#f4e0a0', size: 4 },
};

window.vaultSky = { altAz, planetPosition, moonPosition, gmst };

// ================================================================ science

let SCI_STATE = null;
try { SCI_STATE = JSON.parse(localStorage.getItem('vault.science') || 'null'); } catch { SCI_STATE = null; }
if (!SCI_STATE) SCI_STATE = { tab: 'sky', lines: true, names: true, constellations: true, element: 26 };
if (SCI_STATE.constellations === undefined) SCI_STATE.constellations = true;
const saveSci = () => { try { localStorage.setItem('vault.science', JSON.stringify(SCI_STATE)); } catch { /* fine */ } };

async function renderScience(params) {
  const tabParam = params && params.get('tab');
  if (tabParam === 'elements' || tabParam === 'sky') SCI_STATE.tab = tabParam;
  view.innerHTML = `
    <div class="row-between" style="flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <h1 style="margin:0">Science</h1>
      <div class="row" style="gap:6px">
        <button class="btn btn-sm sci-tab" data-tab="sky">Night sky</button>
        <button class="btn btn-sm sci-tab" data-tab="elements">Periodic table</button>
      </div>
    </div>
    <div id="sci-body"></div>`;
  for (const t of view.querySelectorAll('.sci-tab')) {
    t.classList.toggle('btn-active', t.dataset.tab === SCI_STATE.tab);
    t.onclick = () => { SCI_STATE.tab = t.dataset.tab; saveSci(); renderScience(); };
  }
  if (SCI_STATE.tab === 'elements') renderElements(document.getElementById('sci-body'));
  else renderSky(document.getElementById('sci-body'));
}

// --- periodic table -------------------------------------------------------

function renderElements(root) {
  const { ELEMENTS, ELEMENT_CATEGORIES } = window.vaultElements;
  const byNumber = Object.fromEntries(ELEMENTS.map((e) => [e[0], e]));
  root.innerHTML = `
    <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <input class="map-select" id="el-search" placeholder="Find an element…" style="width:14rem">
      <span class="faint">Click any element. Colours are the families.</span>
    </div>
    <div class="ptable-wrap"><div class="ptable" id="ptable"></div></div>
    <div class="el-legend">${Object.entries(ELEMENT_CATEGORIES).map(([k, v]) => `<span><i class="el-swatch cat-${k}"></i>${esc(v)}</span>`).join('')}</div>
    <div class="card" id="el-detail" style="margin-top:14px"></div>`;

  const table = document.getElementById('ptable');
  const cells = [];
  // Main body: 7 periods × 18 groups; lanthanides and actinides in two rows below.
  const grid = {};
  for (const e of ELEMENTS) {
    const [z, , , , cat, group, period] = e;
    if (cat === 'lanthanide' && z !== 57) grid[`${9}-${z - 57 + 3}`] = e;
    else if (cat === 'actinide' && z !== 89) grid[`${10}-${z - 89 + 3}`] = e;
    else grid[`${period}-${group}`] = e;
  }
  // La and Ac sit in group 3 of the body; the series rows start at Ce and Th, with a marker.
  for (let row = 1; row <= 10; row++) {
    for (let col = 1; col <= 18; col++) {
      const e = grid[`${row}-${col}`];
      if (!e) {
        if (row === 9 && col === 2) cells.push('<span class="el-note">57–71</span>');
        else if (row === 10 && col === 2) cells.push('<span class="el-note">89–103</span>');
        else cells.push(row === 8 ? '<span class="el-gap"></span>' : '<span></span>');
        continue;
      }
      cells.push(`<button class="el cat-${e[4]}" data-z="${e[0]}" title="${esc(e[2])}"><span class="el-z">${e[0]}</span><span class="el-sym">${e[1]}</span><span class="el-name">${esc(e[2])}</span></button>`);
    }
  }
  table.innerHTML = cells.join('');

  const detail = document.getElementById('el-detail');
  const show = (z) => {
    const e = byNumber[z];
    if (!e) return;
    SCI_STATE.element = z; saveSci();
    for (const b of table.querySelectorAll('.el')) b.classList.toggle('active', Number(b.dataset.z) === z);
    const [num, sym, name, mass, cat, group, period, state, note] = e;
    detail.innerHTML = `
      <div class="row" style="gap:16px;align-items:flex-start;flex-wrap:wrap">
        <div class="el-big cat-${cat}"><span class="el-z">${num}</span><span class="el-sym">${sym}</span><span class="el-mass">${esc(mass)}</span></div>
        <div style="flex:1;min-width:220px">
          <h2 style="margin:0 0 4px">${esc(name)}</h2>
          <p class="faint" style="margin:0 0 8px">${esc(ELEMENT_CATEGORIES[cat])} · group ${group} · period ${period} · ${state} at room temperature · atomic weight ${esc(mass)}</p>
          <p style="margin:0">${esc(note)}</p>
          <p class="faint" style="margin:8px 0 0">Atomic number ${num} means ${num} protons in the nucleus and, in the neutral atom, ${num} electrons. The weight is in units of a twelfth of a carbon-12 atom; a bracket means no stable form exists and the longest-lived isotope is given.</p>
        </div>
      </div>`;
  };
  for (const b of table.querySelectorAll('.el')) b.onclick = () => show(Number(b.dataset.z));
  document.getElementById('el-search').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const b of table.querySelectorAll('.el')) {
      const el = byNumber[Number(b.dataset.z)];
      b.classList.toggle('dim', Boolean(q) && !(el[2].toLowerCase().includes(q) || el[1].toLowerCase() === q || String(el[0]) === q));
    }
    const hit = q && ELEMENTS.find((el) => el[2].toLowerCase().startsWith(q) || el[1].toLowerCase() === q || String(el[0]) === q);
    if (hit) show(hit[0]);
  };
  show(SCI_STATE.element || 26);
}

// --- the night sky --------------------------------------------------------

function renderSky(root) {
  const { STARS, CONSTELLATION_LINES, CONSTELLATION_NAMES } = window.vaultStars;
  const A = window.vaultAlmanac;
  const home = homePosition();
  const now = new Date();

  root.innerHTML = `
    <div class="sky-shell">
      <div class="sky-stage">
        <canvas id="sky" class="sky-canvas"></canvas>
        <div class="sky-readout mono" id="sky-readout">—</div>
      </div>
      <aside class="sky-side">
        <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
          <input type="date" id="sky-date" class="map-select" style="width:auto;padding:4px 8px;font-size:13px">
          <button class="btn btn-sm" id="sky-now">Now</button>
        </div>
        <div class="row" style="gap:8px;align-items:center;margin-bottom:8px">
          <input type="range" id="sky-time" min="0" max="1439" step="5" style="flex:1">
          <span class="mono" id="sky-time-label">00:00</span>
        </div>
        <label class="checkbox-row" style="font-size:13px"><input type="checkbox" id="sky-lines" ${SCI_STATE.lines ? 'checked' : ''}><span>Constellation lines</span></label>
        <label class="checkbox-row" style="font-size:13px"><input type="checkbox" id="sky-names" ${SCI_STATE.names ? 'checked' : ''}><span>Star and planet names</span></label>
        <label class="checkbox-row" style="font-size:13px;margin-bottom:8px"><input type="checkbox" id="sky-constellations" ${SCI_STATE.constellations ? 'checked' : ''}><span>Constellation names</span></label>
        <div class="card" id="sky-moon" style="padding:10px 12px;margin-bottom:10px"></div>
        <p class="faint" style="margin:0 0 10px">The sky over ${esc(window.describeHome ? window.describeHome(home) : `${home.lat.toFixed(2)}, ${home.lon.toFixed(2)}`)}
        ${home.lat < 0 ? ' — southern hemisphere, so the sky turns the other way and the Cross replaces the Plough' : ''}.
        Hold it over your head: north at the top, east on the left, as the sky is when you look up.</p>
        <div id="sky-list"></div>
        <details style="margin-top:10px"><summary class="faint">Finding your way by it</summary>
          <p class="faint">Polaris sits almost exactly over the north pole: its bearing is north and its height above the horizon is your latitude. Find it from the Plough — the two stars at the end of the bowl point to it. In the south there is no pole star: the long axis of the Southern Cross, extended four and a half times, marks the pole. Orion's belt rises due east and sets due west everywhere on Earth. Positions here are good to about half a degree.</p>
        </details>
      </aside>
    </div>`;

  const canvas = document.getElementById('sky');
  const readout = document.getElementById('sky-readout');
  const dateInput = document.getElementById('sky-date');
  const timeInput = document.getElementById('sky-time');
  const timeLabel = document.getElementById('sky-time-label');
  const list = document.getElementById('sky-list');
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  dateInput.value = iso(now);
  timeInput.value = now.getHours() * 60 + now.getMinutes();
  let follow = true;

  const instant = () => {
    const [y, m, d] = dateInput.value.split('-').map(Number);
    const minutes = Number(timeInput.value);
    return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  };

  let placed = []; // what is drawn where, for hover
  const draw = () => {
    const date = instant();
    timeLabel.textContent = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const ratio = window.devicePixelRatio || 1;
    const size = Math.min(canvas.parentElement.clientWidth || 600, 720);
    canvas.width = size * ratio; canvas.height = size * ratio;
    canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const cx = size / 2; const cy = size / 2; const R = size / 2 - 22;
    const project = (alt, az) => { const r = R * (90 - alt) / 90; return { x: cx - r * Math.sin(az * DEG2RAD), y: cy - r * Math.cos(az * DEG2RAD) }; };

    const sun = planetPosition('Sun', date);
    const sunPos = altAz(sun.ra, sun.dec, date, home.lat, home.lon);
    const starVisibility = sunPos.alt > 0 ? 0 : sunPos.alt > -12 ? (-sunPos.alt) / 12 : 1;
    const sky = sunPos.alt > 0 ? '#7fa9dc' : sunPos.alt > -6 ? '#2c4270' : sunPos.alt > -12 ? '#151f3a' : sunPos.alt > -18 ? '#0a0f1e' : '#04060c';

    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#000';
    ctx.fillRect(0, 0, size, size);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = sky; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
    for (const alt of [30, 60]) { ctx.beginPath(); ctx.arc(cx, cy, R * (90 - alt) / 90, 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', cx, cy - R - 11); ctx.fillText('S', cx, cy + R + 11); ctx.fillText('E', cx - R - 11, cy); ctx.fillText('W', cx + R + 11, cy);

    placed = [];
    const positions = new Map();
    for (const s of STARS) {
      const p = altAz(s[1], s[2], date, home.lat, home.lon);
      positions.set(s[0], { star: s, ...p });
    }

    if (SCI_STATE.lines && starVisibility > 0) {
      ctx.strokeStyle = `rgba(140, 170, 220, ${0.45 * starVisibility})`; ctx.lineWidth = 1;
      for (const chains of Object.values(CONSTELLATION_LINES)) {
        for (const chain of chains) {
          ctx.beginPath();
          let pen = false;
          for (const name of chain) {
            const pos = positions.get(name);
            if (!pos || pos.alt < -2) { pen = false; continue; }
            const { x, y } = project(Math.max(pos.alt, -2), pos.az);
            if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
    }

    if (starVisibility > 0) {
      for (const [name, pos] of positions) {
        if (pos.alt < 0) continue;
        const mag = pos.star[3];
        if (mag > 4.6) continue;
        const { x, y } = project(pos.alt, pos.az);
        const radius = Math.max(0.7, 3.4 - mag * 0.65);
        const alpha = Math.min(1, (1.4 - mag * 0.12)) * starVisibility;
        ctx.fillStyle = name === 'Polaris' ? `rgba(255, 230, 150, ${alpha})` : `rgba(255,255,255,${alpha})`;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
        placed.push({ x, y, label: name, sub: `${CONSTELLATION_NAMES[pos.star[4]] || pos.star[4]} · magnitude ${mag}`, alt: pos.alt, az: pos.az });
        if (SCI_STATE.names && (mag <= 1.7 || name === 'Polaris')) {
          ctx.fillStyle = `rgba(200, 215, 240, ${0.9 * starVisibility})`; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left';
          ctx.fillText(name, x + radius + 3, y - 4);
        }
      }
    }

    // Constellation names, written across the middle of each shape.
    //
    // Only where enough of the figure is actually up: half a constellation
    // rising over the horizon should not be labelled as though it were
    // overhead, and a name floating on its own teaches nothing.
    if (SCI_STATE.constellations) {
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const taken = [];
      for (const [abbr, chains] of Object.entries(CONSTELLATION_LINES)) {
        const members = new Set(chains.flat());
        let sx = 0; let sy = 0; let n = 0; let lowest = 90;
        for (const star of members) {
          const pos = positions.get(star);
          if (!pos || pos.alt < 3) continue;
          const { x, y } = project(pos.alt, pos.az);
          sx += x; sy += y; n++;
          lowest = Math.min(lowest, pos.alt);
        }
        if (n < Math.max(2, Math.ceil(members.size * 0.6))) continue;

        const x = sx / n;
        const y = sy / n;
        // Do not stack one name on another.
        if (taken.some((t) => Math.abs(t.x - x) < 60 && Math.abs(t.y - y) < 16)) continue;
        taken.push({ x, y });

        // The long form carries the English name — "Ursa Major — the Plough" —
        // which is the half people actually recognise.
        const full = CONSTELLATION_NAMES[abbr] || abbr;
        ctx.fillStyle = `rgba(150, 180, 230, ${0.75 * starVisibility})`;
        ctx.fillText(full, x, y);
      }
    }

    // Planets, the Moon, the Sun.
    const bodies = [];
    for (const name of Object.keys(PLANET_STYLE)) {
      const eq = planetPosition(name, date);
      const p = altAz(eq.ra, eq.dec, date, home.lat, home.lon);
      bodies.push({ name, ...p, style: PLANET_STYLE[name] });
    }
    const moonEq = moonPosition(date);
    const moonPos = altAz(moonEq.ra, moonEq.dec, date, home.lat, home.lon);
    const phase = A ? A.moonPhase(date) : null;
    bodies.push({ name: 'Moon', ...moonPos, style: { colour: '#e8e6dc', size: 7 }, glyph: phase ? phase.glyph : '' });
    bodies.push({ name: 'Sun', ...sunPos, style: { colour: '#ffd24a', size: 8 } });

    for (const b of bodies) {
      if (b.alt < -1) continue;
      const { x, y } = project(Math.max(b.alt, 0), b.az);
      ctx.fillStyle = b.style.colour;
      ctx.beginPath(); ctx.arc(x, y, b.style.size, 0, Math.PI * 2); ctx.fill();
      if (b.name === 'Moon' && b.glyph) { ctx.font = '13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.glyph, x, y); }
      if (SCI_STATE.names) { ctx.fillStyle = b.style.colour; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(b.name, x + b.style.size + 3, y - 6); }
      placed.push({ x, y, label: b.name, sub: b.name === 'Moon' && phase ? `${phase.name}, ${Math.round(phase.illumination * 100)}% lit` : 'planet', alt: b.alt, az: b.az });
    }

    // The moon, on its own, because it is the one thing up there that
    // changes what you can do: a full moon is enough to walk, work or move
    // stock by, and a new moon is why the stars look the way they do tonight.
    const moonBox = document.getElementById('sky-moon');
    if (moonBox && phase) {
      const lit = Math.round(phase.illumination * 100);
      const days = (d) => Math.max(0, Math.round((d - date) / 86400000));
      const useful = lit >= 85 ? 'Bright enough to walk or work outside without a light.'
        : lit >= 45 ? 'Enough light to find your way on open ground.'
        : lit >= 15 ? 'Little use as a light, but the stars are good.'
        : 'Darkest skies of the month — the best nights for stars.';
      moonBox.innerHTML = `
        <div class="row" style="gap:10px;align-items:center">
          <span style="font-size:26px;line-height:1">${phase.glyph}</span>
          <div>
            <strong>${esc(phase.name)}</strong>
            <div class="faint" style="font-size:12px">${lit}% lit${moonPos.alt > 0 ? ` · up, ${moonPos.alt.toFixed(0)}° high` : ' · below the horizon'}</div>
          </div>
        </div>
        <p class="faint" style="margin:8px 0 0;font-size:12px">${useful}</p>
        ${phase.nextFull && phase.nextNew ? `<p class="faint" style="margin:6px 0 0;font-size:12px">
          Full in ${days(phase.nextFull)} day${days(phase.nextFull) === 1 ? '' : 's'} ·
          new in ${days(phase.nextNew)} day${days(phase.nextNew) === 1 ? '' : 's'}</p>` : ''}`;
    }

    // The list beside the chart.
    const cp = (az) => (A ? A.compassPoint(az) : '');
    const fmt = (b) => (b.alt > 0 ? `up · ${b.alt.toFixed(0)}° high, bearing ${b.az.toFixed(0)}° ${cp(b.az)}` : `below the horizon (${(-b.alt).toFixed(0)}° under)`);
    list.innerHTML = `
      <div class="almanac-row"><span class="faint">Sun</span><span class="mono">${fmt(sunPos)}</span></div>
      <div class="almanac-row"><span class="faint">Moon ${phase ? phase.glyph : ''}</span><span class="mono">${fmt(moonPos)}</span></div>
      ${bodies.filter((b) => b.name !== 'Sun' && b.name !== 'Moon').map((b) => `<div class="almanac-row"><span class="faint">${b.name}</span><span class="mono">${fmt(b)}</span></div>`).join('')}
      <div class="almanac-row"><span class="faint">Polaris</span><span class="mono">${home.lat > 0 ? `bearing 0° · ${home.lat.toFixed(0)}° high` : 'not visible south of the equator'}</span></div>
      <p class="faint" style="margin:8px 0 0">${sunPos.alt > 0 ? 'Daylight — stars hidden. Drag the time to after dark.' : sunPos.alt > -12 ? 'Twilight — only the brightest show.' : 'Dark.'} Mercury and Venus never stray far from the Sun; Jupiter and Saturn are the steady bright ones that do not twinkle.</p>`;
  };

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left; const y = e.clientY - rect.top;
    let best = null; let bestD = 14;
    for (const p of placed) { const d = Math.hypot(p.x - x, p.y - y); if (d < bestD) { bestD = d; best = p; } }
    readout.textContent = best ? `${best.label} · ${best.sub} · ${best.alt.toFixed(0)}° high, bearing ${best.az.toFixed(0)}°` : '—';
  };
  dateInput.onchange = () => { follow = false; draw(); };
  timeInput.oninput = () => { follow = false; draw(); };
  document.getElementById('sky-now').onclick = () => { const n = new Date(); dateInput.value = iso(n); timeInput.value = n.getHours() * 60 + n.getMinutes(); follow = true; draw(); };
  document.getElementById('sky-lines').onchange = (e) => { SCI_STATE.lines = e.target.checked; saveSci(); draw(); };
  document.getElementById('sky-names').onchange = (e) => { SCI_STATE.names = e.target.checked; saveSci(); draw(); };
  document.getElementById('sky-constellations').onchange = (e) => { SCI_STATE.constellations = e.target.checked; saveSci(); draw(); };
  const clock = setInterval(() => {
    if (!document.getElementById('sky')) { clearInterval(clock); return; }
    if (follow) { const n = new Date(); timeInput.value = n.getHours() * 60 + n.getMinutes(); draw(); }
  }, 60000);
  window.addEventListener('resize', draw);
  window.addEventListener('hashchange', () => window.removeEventListener('resize', draw), { once: true });
  draw();
}

window.renderScience = renderScience;
