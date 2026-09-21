'use strict';
/* Ark front end. No framework, no build step — open the folder in ten years
   and it still runs. Hash routing so it works from a file server or a socket. */

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
const profileSelect = document.getElementById('profile');
const searchForm = document.getElementById('global-search');
const searchInput = document.getElementById('q');
const footerStatus = document.getElementById('footer-status');

let PROFILE = localStorage.getItem('vault.profile') || localStorage.getItem('ark.profile') || 'default';
let STATUS = null;
let pollTimer = null;
let MASCOT = null;

// ------------------------------------------------------------- appearance

const themeSelect = document.getElementById('theme');
const phosphorSelect = document.getElementById('phosphor');

function applyAppearance() {
  const theme = localStorage.getItem('vault.theme') || 'pipboy';
  const phosphor = localStorage.getItem('vault.phosphor') || 'amber';

  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.phosphor = phosphor;
  phosphorSelect.hidden = theme !== 'pipboy';

  themeSelect.value = theme;
  phosphorSelect.value = phosphor;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.content = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg').trim() || '#0d1117';
  }
}

/**
 * Scanlines for the retro terminal, drawn so the pattern is consistent
 * across the whole screen: one dark device pixel, then clear ones, as an
 * image sized to a whole number of device pixels. Re-done when the zoom
 * level (and so the device pixel ratio) changes.
 */
function alignScanlines() {
  const dpr = window.devicePixelRatio || 1;
  const period = dpr >= 2 ? 4 : 3; // device pixels per line
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = period;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 1, period);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, 1, 1);
  const root = document.documentElement.style;
  root.setProperty('--scanlines', `url(${canvas.toDataURL()})`);
  root.setProperty('--scanline-size', `1px ${period / dpr}px`);
}
alignScanlines();
window.addEventListener('resize', alignScanlines);

themeSelect.onchange = () => {
  localStorage.setItem('vault.theme', themeSelect.value);
  applyAppearance();
};

phosphorSelect.onchange = () => {
  localStorage.setItem('vault.phosphor', phosphorSelect.value);
  applyAppearance();
};

applyAppearance();

// ------------------------------------------------------------------ utils

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

async function api(path, options) {
  const res = await fetch(`/api/${path}`, {
    headers: { 'content-type': 'application/json', 'x-vault-client': '1' },
    ...options,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || `Request failed (${res.status})`);
  }
  return res.json();
}

function ageBadge(days) {
  if (days === null || days === undefined) return '<span class="tag">date unknown</span>';
  if (days < 1) return '<span class="tag tag-good">cloned today</span>';
  const text = days < 60 ? `${days} days old`
    : days < 730 ? `${Math.round(days / 30)} months old`
    : `${(days / 365).toFixed(1)} years old`;
  const cls = days < 200 ? 'tag-good' : days < 550 ? 'tag-warn' : 'tag-bad';
  return `<span class="tag ${cls}">${text}</span>`;
}

function setBusy(message = 'Loading…') {
  view.innerHTML = `<div class="loading">${esc(message)}</div>`;
}

function showError(err) {
  view.innerHTML = `<div class="card"><strong>Something went wrong.</strong><p class="muted">${esc(err.message)}</p></div>`;
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ----------------------------------------------------------------- router

const routes = [
  [/^\/$/, renderHome],
  [/^\/library$/, renderLibrary],
  [/^\/(?:get|setup)$/, renderSetup],
  [/^\/handbook$/, renderHandbook],
  [/^\/handbook\/(.+)$/, renderChapter],
  [/^\/languages$/, renderLanguages],
  [/^\/languages\/([^/]+)\/guide$/, renderLanguageGuide],
  [/^\/study(?:\/(.+))?$/, renderStudy],
  [/^\/maps$/, renderMaps],
  [/^\/comms$/, renderComms],
  [/^\/manual$/, renderManual],
  [/^\/manual\/(.+)$/, renderManualPage],
  [/^\/school$/, renderSchool],
  [/^\/school\/(.+)$/, renderLesson],
  [/^\/doc\/([^/]+)(?:\/(\d+))?$/, renderDocument],
  [/^\/read\/([^/]+)$/, renderPack],
  [/^\/read\/([^/]+)\/(.+)$/, renderArticle],
  [/^\/search$/, renderSearch],
  [/^\/calendar$/, () => window.renderCalendar()],
  [/^\/tools$/, () => window.renderTools()],
  [/^\/music$/, () => window.renderMusic()],
  [/^\/science$/, (p) => window.renderScience(p)],
  [/^\/notebook$/, (p) => window.renderNotebook(p)],
  [/^\/sheets$/, (p) => window.renderSheets(p)],
  [/^\/media$/, (p) => window.renderMedia(p)],
  [/^\/games$/, (p) => window.renderGames(p)],
];

// Each section remembers where you were. Leave the Library on an article,
// go and look at the map, come back — the article is still open. The nav
// links are re-pointed at the remembered place after every navigation.
let lastRoute = {};
try { lastRoute = JSON.parse(localStorage.getItem('vault.lastRoute') || '{}'); } catch { lastRoute = {}; }

// Sections whose "where you were" is worth keeping. Search results and the
// study session are deliberately not remembered.
const SECTION_ROOT = {
  library: '#/library', handbook: '#/handbook', maps: '#/maps', calendar: '#/calendar',
  comms: '#/comms', languages: '#/languages', school: '#/school', tools: '#/tools',
  manual: '#/manual', setup: '#/setup', music: '#/music', science: '#/science',
  notebook: '#/notebook', media: '#/media', games: '#/games', sheets: '#/sheets',
};

// The three folders in the sidebar fold and unfold; remembered per browser.
let foldedGroups = [];
try { foldedGroups = JSON.parse(localStorage.getItem('vault.navFolded') || '[]'); } catch { foldedGroups = []; }
for (const group of tabs.querySelectorAll('.nav-group')) {
  const name = group.dataset.group;
  const heading = group.querySelector('.nav-heading');
  const apply = () => {
    const folded = foldedGroups.includes(name);
    group.classList.toggle('folded', folded);
    heading.setAttribute('aria-expanded', String(!folded));
  };
  heading.onclick = () => {
    foldedGroups = foldedGroups.includes(name) ? foldedGroups.filter((g) => g !== name) : [...foldedGroups, name];
    try { localStorage.setItem('vault.navFolded', JSON.stringify(foldedGroups)); } catch { /* fine */ }
    apply();
  };
  apply();
}

function rememberRoute(hash) {
  for (const link of tabs.querySelectorAll('a')) {
    const section = link.dataset.section;
    if (!section || !SECTION_ROOT[section]) continue;
    if (new RegExp(link.dataset.match).test(hash)) {
      lastRoute[section] = hash;
      try { localStorage.setItem('vault.lastRoute', JSON.stringify(lastRoute)); } catch { /* fine */ }
    }
  }
}

function repointNav(currentHash) {
  for (const link of tabs.querySelectorAll('a')) {
    const section = link.dataset.section;
    const active = new RegExp(link.dataset.match).test(currentHash);
    link.classList.toggle('active', active);
    if (!section || !SECTION_ROOT[section]) continue;
    // Clicking the active section's link takes you to its root (a way back
    // to the list); an inactive one takes you to wherever you left it.
    const remembered = lastRoute[section];
    link.href = active || !remembered ? SECTION_ROOT[section] : remembered;
  }
}

// ------------------------------------------------------------ back / forward
// The browser keeps the real history; we only need to know whether there is
// anywhere to go, which it will not tell us. So each page visited in this
// session gets a position in history.state, and the buttons compare it to
// how far we have been. The article reader has its own inner history (links
// inside the iframe), which is stepped through first.
const NAV = { pos: 0, max: 0 };
const navBack = document.getElementById('nav-back');
const navFwd = document.getElementById('nav-fwd');
const navCrumb = document.getElementById('nav-crumb');

function updateNavButtons() {
  const reader = window.vaultReader && location.hash.startsWith('#/read/') ? window.vaultReader : null;
  navBack.disabled = !(NAV.pos > 0 || (reader && reader.canBack()));
  navFwd.disabled = !(NAV.pos < NAV.max || (reader && reader.canForward()));
}

function navGo(delta) {
  const reader = window.vaultReader && location.hash.startsWith('#/read/') ? window.vaultReader : null;
  if (reader && (delta < 0 ? reader.canBack() : reader.canForward())) { reader.go(delta); return; }
  if (delta < 0 ? NAV.pos > 0 : NAV.pos < NAV.max) history.go(delta);
}
navBack.onclick = () => navGo(-1);
navFwd.onclick = () => navGo(1);
window.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); navGo(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); navGo(1); }
});

function setCrumb(hash) {
  const link = [...tabs.querySelectorAll('a')].find((a) => a.dataset.match && new RegExp(a.dataset.match).test(hash));
  const section = link ? link.querySelector('.nav-label')?.textContent || link.textContent : '';
  navCrumb.textContent = section.trim();
}

async function route() {
  stopPolling();
  const raw = location.hash.slice(1) || '/';
  const [pathname, queryString] = raw.split('?');
  const params = new URLSearchParams(queryString || '');
  const hash = `#${pathname}${queryString ? '?' + queryString : ''}`;

  // A page we have been to keeps its number; a new one goes on the end and
  // forgets any forward pages, exactly as a browser does.
  if (history.state && typeof history.state.navPos === 'number') {
    NAV.pos = history.state.navPos;
    NAV.max = Math.max(NAV.max, NAV.pos);
  } else {
    if (NAV.started) NAV.pos += 1;
    NAV.max = NAV.pos;
    history.replaceState({ ...(history.state || {}), navPos: NAV.pos }, '', location.href);
  }
  NAV.started = true;
  updateNavButtons();
  setCrumb(hash);

  rememberRoute(hash);
  repointNav(hash);

  // Wide pages get the whole screen; prose keeps its own measure.
  view.classList.toggle('wide', /^#\/(maps|read|doc|calendar|setup|tools|music|science|media|games|notebook|sheets)/.test(hash));

  // A section in a folded folder still shows where you are: unfold it.
  const activeLink = [...tabs.querySelectorAll('a')].find((a) => new RegExp(a.dataset.match).test(hash));
  const group = activeLink && activeLink.closest('.nav-group');
  if (group && group.classList.contains('folded')) group.querySelector('.nav-heading').click();

  for (const [pattern, handler] of routes) {
    const match = pathname.match(pattern);
    if (match) {
      try {
        await handler(...match.slice(1).map((s) => (s ? decodeURIComponent(s) : s)), params);
      } catch (err) {
        showError(err);
      }
      window.scrollTo(0, 0);
      return;
    }
  }
  view.innerHTML = '<div class="empty">That page does not exist in here.</div>';
}

// The article reader updates the hash as you follow links, without a
// hashchange event; keep the memory current from there too.
const _replaceState = history.replaceState.bind(history);
history.replaceState = (state, title, url) => {
  // Keep our history position when a page only rewrites its address.
  _replaceState(state === null && history.state ? history.state : state, title, url);
  if (typeof url === 'string' && url.startsWith('#')) { rememberRoute(url); repointNav(url); }
};

// ---------------------------------------------------------------- sidebar

const shell = document.getElementById('shell');
const collapseBtn = document.getElementById('sidebar-collapse');
if (localStorage.getItem('vault.sidebar') === 'collapsed') shell.classList.add('collapsed');
collapseBtn.onclick = () => {
  shell.classList.toggle('collapsed');
  localStorage.setItem('vault.sidebar', shell.classList.contains('collapsed') ? 'collapsed' : 'open');
  collapseBtn.title = shell.classList.contains('collapsed') ? 'Expand the sidebar' : 'Collapse the sidebar';
  if (MAP) requestAnimationFrame(() => MAP.resize());
};

// ------------------------------------------------------------------- home

const FEATURES = [
  ['Knowledge', null, null],
  ['Library', '#/library', 'Your encyclopedia packs and books. Every one records the day it was cloned, and tells you when a fresher copy exists.'],
  ['Handbook', '#/handbook', 'Water, fire, medicine, food, power, shelter, comms, community, repair. Written to be read before you need it.'],
  ['Languages', '#/languages', 'Spaced repetition that shows you a card just before you would have forgotten it. Japanese to N5, Spanish to A1.'],
  ['School', '#/school', 'A curriculum that needs no teacher, server or signal. Progress tracked per person.'],
  ['Music', '#/music', 'A piano you can play from the keyboard, a metronome and tuning pitches. So the music does not stop.'],
  ['Science', '#/science', 'The periodic table, and the night sky for any place, date and hour — stars, planets and the moon, computed on the spot.'],
  ['Life', null, null],
  ['Calendar', '#/calendar', 'Shared dates for the household — plus sunrise, sunset and the moon for every day, worked out on the spot.'],
  ['Comms', '#/comms', 'Message anyone else on this network. No internet, no accounts, no company in the middle.'],
  ['Maps', '#/maps', 'Offline maps you can draw on. Measure, plan routes, mark hazards and what you found where — the world changes, your map should too.'],
  ['Notebook', '#/notebook', 'Journal, recipes and lists, per person. Written here, kept here.'],
  ['Sheets', '#/sheets', 'A spreadsheet: formulas, formatting, sorting, several sheets a workbook. Opens and saves Excel files. No subscription.'],
  ['Media', '#/media', 'Your own music, photos and films, played from a folder. Nothing streams.'],
  ['Games', '#/games', 'Chess and draughts for two, or against the machine. Evenings are long.'],
  ['System', null, null],
  ['Tools', '#/tools', 'Calculator, unit converter, timer and stopwatch, Morse trainer.'],
  ['Manual', '#/manual', 'How all of this works and how it was built — so you can keep it running, or rebuild it.'],
  ['Setup', '#/setup', 'Choose what to download while you still have a connection — everything in one click, or pick and choose. The one page that needs the internet.'],
];

async function renderHome() {
  setBusy('Opening the vault…');
  const [status, library] = await Promise.all([api('status'), api('library')]);
  STATUS = status;

  if (MASCOT === null) {
    MASCOT = await fetch('/vaultboy.txt').then((r) => r.text()).catch(() => '');
  }

  const packs = library.packs;
  const ready = packs.filter((p) => p.ok);
  const stale = ready.filter((p) => p.ageDays !== null && p.ageDays > 365);

  view.innerHTML = `
    <div class="hero">
      <div class="hero-text">
        <h1>Welcome home.</h1>
        <p class="lede">
          This is a vault: a copy of what people know, kept somewhere it cannot be switched off.
          Nothing here needs the internet. Nothing here can be taken away, edited from a distance,
          or quietly retired. Pull the plug on the world and it all still opens.
        </p>
        <p class="muted">
          It is meant to be used, not admired — so poke at everything, and read the
          <a href="#/handbook">handbook</a> on a quiet evening rather than a bad one.
        </p>
      </div>
      <pre class="mascot" aria-label="Vault mascot giving a thumbs up">${esc(MASCOT)}</pre>
    </div>

    <div class="stat-row">
      <div class="stat"><div class="stat-value">${ready.length}</div><div class="stat-label">Packs</div></div>
      <div class="stat"><div class="stat-value">${esc(status.librarySize)}</div><div class="stat-label">On disk</div></div>
      <div class="stat"><div class="stat-value">${status.content.chapters}</div><div class="stat-label">Chapters</div></div>
      <div class="stat"><div class="stat-value">${status.content.cards}</div><div class="stat-label">Cards</div></div>
      <div class="stat"><div class="stat-value">${status.content.lessons}</div><div class="stat-label">Lessons</div></div>
    </div>

    ${packs.length === 0 ? `<div class="empty">
      <p>No knowledge packs yet — the shelves are still empty.</p>
      <a class="btn btn-primary" href="#/setup">Set up the library</a>
    </div>` : ''}

    ${stale.length ? `<div class="card">
      <strong>${stale.length} pack${stale.length > 1 ? 's are' : ' is'} over a year old.</strong>
      <p class="muted" style="margin:6px 0 10px">Worth refreshing while refreshing is still possible.</p>
      <a class="btn btn-sm" href="#/library">Check for updates</a>
    </div>` : ''}

    <h2>What's in here</h2>
    <div class="feature-list">
      ${FEATURES.map(([name, href, desc]) => (href ? `
        <a class="feature" href="${href}">
          <span class="feature-name">${esc(name)}</span>
          <span class="feature-desc">${esc(desc)}</span>
        </a>` : `<h3 class="feature-group">${esc(name)}</h3>`)).join('')}
    </div>

    <h2>Getting your bearings</h2>
    <div class="card">
      <p><strong>Search the lot at once.</strong> The box at the top searches the handbook, the school
      and every encyclopedia pack together. It is the fastest way in.</p>
      <p><strong>Everyone gets a profile.</strong> Top right. Flashcard schedules and lesson progress
      are kept per person, so the children's work stays theirs.</p>
      <p><strong>Read it on anything.</strong> Whatever device is serving this prints an address on
      its console — type that into a phone or tablet on the same wifi and you are in. No app to install.</p>
      <p style="margin:0"><strong>Make it yours.</strong> Three appearances under the sidebar, including a
      retro terminal with a screen colour of your choosing. Purely for the pleasure of it.</p>
    </div>
  `;

  footerStatus.textContent = `Vault · reachable at ${status.addresses.join('  ·  ')}`;
}

function packCard(pack) {
  if (!pack.ok) {
    return `<div class="card"><strong>${esc(pack.title)}</strong>
      <p class="faint" style="margin:6px 0 0">Could not be read: ${esc(pack.error)}</p></div>`;
  }
  return `
    <a class="card card-link" href="#/read/${encodeURIComponent(pack.id)}">
      <div class="row-between">
        <strong>${esc(pack.title)}</strong>
        ${ageBadge(pack.ageDays)}
      </div>
      <p class="faint" style="margin:8px 0 0">
        Cloned ${esc(pack.date || 'unknown')} · ${esc(pack.sizeHuman)} ·
        ${pack.entryCount.toLocaleString()} entries · ${esc(pack.language || '')}
      </p>
    </a>`;
}

// ---------------------------------------------------------------- library

async function renderLibrary() {
  setBusy('Reading the library…');
  const { packs } = await api('library');

  view.innerHTML = `
    <h1>Library</h1>
    <p class="lede">Each pack records the day its source was cloned. That date is the honest answer to "how current is this?"</p>

    <div class="row" style="margin-bottom:20px">
      <button class="btn btn-primary" id="check-updates">Check for updates</button>
      <button class="btn" id="rescan">Rescan folder</button>
      <span class="faint" id="check-note"></span>
    </div>

    <div id="pack-list">${packs.length ? packs.map(libraryRow).join('') : '<div class="empty">No .zim packs found.<br><a class="btn btn-primary" href="#/setup" style="margin-top:12px">Set up the library</a></div>'}</div>

    <h2>Books &amp; documents</h2>
    <p class="muted" style="margin:-6px 0 12px">PDFs and EPUBs from <span class="mono">library/docs</span>. Full text goes into search; the reader opens the book itself.</p>
    <div id="doc-list"><div class="loading">Reading the shelf…</div></div>

    <h2>Downloads</h2>
    <div id="download-list"><p class="faint">Nothing downloading.</p></div>
  `;

  api('docs').then(({ docs, docsDir, indexing }) => {
    const target = document.getElementById('doc-list');
    if (!target) return;
    const indexingNote = indexing ? '<p class="faint">Still indexing new books in the background — the shelf fills in as they finish.</p>' : '';
    target.innerHTML = indexingNote + (docs.length ? docs.map((doc) => `
      <a class="card card-link" href="#/doc/${encodeURIComponent(doc.id)}">
        <div class="row-between">
          <strong>${esc(doc.title)}</strong>
          <span class="tag">${esc(doc.type.toUpperCase())}${doc.garbled ? ' · text not indexable' : ''}</span>
        </div>
        <p class="faint" style="margin:6px 0 0">
          ${doc.author ? esc(doc.author) + ' · ' : ''}${doc.unitCount} ${esc(doc.unitLabel || 'section')}s ·
          ${(doc.words || 0).toLocaleString()} words · ${esc(doc.sizeHuman)}
          ${doc.ok === false ? ` · <span style="color:var(--bad)">${esc(doc.error)}</span>` : ''}
        </p>
      </a>`).join('') + `<div class="row" style="margin-top:6px"><button class="btn btn-sm" id="rescan-docs">Rescan documents</button></div>`
      : `<div class="empty">Nothing on the shelf yet. Drop <code>.pdf</code> or <code>.epub</code> files into<br><span class="mono">${esc(docsDir)}</span><br><button class="btn btn-sm" id="rescan-docs" style="margin-top:12px">Rescan documents</button></div>`);

    const rescan = document.getElementById('rescan-docs');
    if (rescan) rescan.onclick = async () => { rescan.disabled = true; await api('docs/scan', { method: 'POST' }); route(); };
  }).catch(() => {});

  document.getElementById('rescan').onclick = async (e) => {
    e.target.disabled = true;
    await api('library/scan', { method: 'POST' });
    route();
  };

  document.getElementById('check-updates').onclick = async (e) => {
    const note = document.getElementById('check-note');
    e.target.disabled = true;
    note.textContent = 'Contacting the catalogue…';
    try {
      const result = await api('library/check-updates', { method: 'POST', body: {} });
      if (!result.online) {
        note.textContent = 'Offline — cannot check right now.';
      } else {
        note.textContent = `Checked ${new Date(result.checked).toLocaleString()}`;
        const { packs: refreshed } = await api('library');
        document.getElementById('pack-list').innerHTML = refreshed.map(libraryRow).join('');
        wireUpdateButtons();
      }
    } catch (err) {
      note.textContent = err.message;
    }
    e.target.disabled = false;
  };

  wireUpdateButtons();
  pollDownloads();
  pollTimer = setInterval(pollDownloads, 1500);
}

function libraryRow(pack) {
  if (!pack.ok) {
    return `<div class="card"><strong>${esc(pack.title)}</strong>
      <p class="faint">Unreadable: ${esc(pack.error)}</p></div>`;
  }

  const update = pack.update;
  let updateBlock = '';
  if (update?.available) {
    updateBlock = `
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
        <div class="row-between">
          <span>Newer version from <strong>${esc(update.date)}</strong> · ${esc(update.sizeHuman)}</span>
          <button class="btn btn-primary btn-sm update-btn"
            data-url="${esc(update.url)}" data-filename="${esc(update.filename)}">Update</button>
        </div>
        <p class="faint" style="margin:8px 0 0">Downloads the whole pack — ZIM has no patch format. Your current copy keeps working until the new one is complete.</p>
      </div>`;
  } else if (update?.found === false) {
    updateBlock = '<p class="faint" style="margin:10px 0 0">Not in the Kiwix catalogue — a custom or renamed pack.</p>';
  } else if (update && !update.error) {
    updateBlock = '<p class="faint" style="margin:10px 0 0">Up to date.</p>';
  } else if (update?.error) {
    updateBlock = `<p class="faint" style="margin:10px 0 0">Check failed: ${esc(update.error)}</p>`;
  }

  return `
    <div class="card">
      <div class="row-between">
        <strong>${esc(pack.title)}</strong>
        ${ageBadge(pack.ageDays)}
      </div>
      <p class="faint" style="margin:8px 0 0">
        Cloned <strong>${esc(pack.date || 'unknown')}</strong> ·
        ${esc(pack.sizeHuman)} · ${pack.entryCount.toLocaleString()} entries ·
        ZIM ${esc(pack.zimVersion)} · <span class="mono">${esc(pack.file)}</span>
      </p>
      ${pack.description ? `<p class="faint" style="margin:6px 0 0">${esc(pack.description)}</p>` : ''}
      <div class="row" style="margin-top:12px">
        <a class="btn btn-sm" href="#/read/${encodeURIComponent(pack.id)}">Open</a>
      </div>
      ${updateBlock}
    </div>`;
}

function wireUpdateButtons() {
  for (const btn of document.querySelectorAll('.update-btn')) {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Starting…';
      await api('downloads', { method: 'POST', body: { url: btn.dataset.url, filename: btn.dataset.filename } });
      pollDownloads();
    };
  }
}

async function pollDownloads() {
  const target = document.getElementById('download-list');
  if (!target) return stopPolling();

  const { jobs } = await api('downloads');
  if (jobs.length === 0) {
    target.innerHTML = '<p class="faint">Nothing downloading.</p>';
    return;
  }

  target.innerHTML = jobs.map((job) => `
    <div class="card">
      <div class="row-between">
        <strong class="mono">${esc(job.filename)}</strong>
        <span class="tag ${job.status === 'complete' ? 'tag-good' : job.status === 'failed' ? 'tag-bad' : ''}">${esc(job.status)}</span>
      </div>
      <div class="progress"><div style="width:${job.percent}%"></div></div>
      <div class="row-between">
        <span class="faint">${esc(job.receivedHuman)} of ${esc(job.totalHuman)} · ${job.percent}%${job.rateHuman ? ` · ${esc(job.rateHuman)}` : ''}${
          job.etaSeconds ? ` · ${formatEta(job.etaSeconds)} left` : ''
        }</span>
        ${job.status === 'downloading' ? `<button class="btn btn-sm cancel-btn" data-id="${esc(job.id)}">Cancel</button>` : ''}
      </div>
      ${job.error ? `<p class="faint" style="color:var(--bad);margin:8px 0 0">${esc(job.error)}</p>` : ''}
      ${job.status === 'complete' ? '<p class="faint" style="margin:8px 0 0">Done. Rescan the folder to load it.</p>' : ''}
    </div>
  `).join('');

  for (const btn of target.querySelectorAll('.cancel-btn')) {
    btn.onclick = () => api(`downloads/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
  }
}

function formatEta(seconds) {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} hr`;
}

// ------------------------------------------------------------------ setup

const STATUS_LABEL = {
  installed: ['Installed', 'tag-good'],
  downloading: ['Downloading…', 'tag-warn'],
  queued: ['Queued', ''],
  partial: ['Partly here', 'tag-warn'],
  failed: ['Failed', 'tag-bad'],
  missing: ['', ''],
};

async function renderSetup() {
  setBusy('Reading the catalogue…');
  let data = await api('setup');

  const paint = () => {
    const byCategory = data.categories.map((c) => ({ ...c, items: data.items.filter((i) => i.category === c.id) }));
    const t = data.totals;
    const busy = data.running && data.active;

    view.innerHTML = `
      <h1>Set up the library</h1>
      <p class="lede">The Vault itself is tiny; the knowledge is downloaded afterwards, while there is still an internet to download it from.
      Tick what you want, or take the lot. Downloads run one at a time, resume if interrupted, and carry on after a restart.</p>

      <div class="stat-row">
        <div class="stat"><div class="stat-value">${esc(t.installedHuman)}</div><div class="stat-label">Installed</div></div>
        <div class="stat"><div class="stat-value">${esc(t.remainingRecommendedHuman)}</div><div class="stat-label">Recommended, still to get</div></div>
        <div class="stat"><div class="stat-value">${esc(t.everythingHuman)}</div><div class="stat-label">Everything</div></div>
        ${data.diskFreeHuman ? `<div class="stat"><div class="stat-value">${esc(data.diskFreeHuman)}</div><div class="stat-label">Free on this disk</div></div>` : ''}
      </div>

      <div class="card">
        <div class="row">
          <button class="btn btn-primary" id="get-recommended" ${busy ? '' : ''}>Download everything recommended — ${esc(t.remainingRecommendedHuman)}</button>
          <button class="btn" id="get-everything">Everything in the catalogue</button>
          <span class="faint">Queues in order of usefulness: medical and small things first, the 49 GB Wikipedia last.</span>
        </div>
      </div>

      <div id="queue-panel">${queueHtml()}</div>

      <h2>Share on this network</h2>
      <div class="card" id="network-panel"><p class="faint">Checking…</p></div>

      <h2>Whose vault</h2>
      <div class="card">
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
          <label for="credit-name">Name shown in the footer</label>
          <input id="credit-name" class="map-select" style="flex:1;min-width:200px" maxlength="120" placeholder="e.g. the Watkins family" value="${esc(STATUS?.credit || '')}">
          <button class="btn btn-sm" id="credit-save">Save</button>
        </div>
        <p class="faint" style="margin:8px 0 0">Optional. A copy made for someone else starts blank, so your name does not travel with it.</p>
      </div>

      ${byCategory.map((c) => `
        <h2>${esc(c.title)} <span class="faint" style="font-weight:400;font-size:13px">${c.items.length} · ${esc(humanGb(c.items.reduce((n, i) => n + i.size, 0)))}</span></h2>
        ${c.items.map((i) => {
          const [label, cls] = STATUS_LABEL[i.status] || ['', ''];
          const checkable = i.status === 'missing' || i.status === 'partial' || i.status === 'failed';
          return `
          <label class="pack-row ${i.status}">
            <input type="checkbox" class="pack-pick" value="${esc(i.id)}" ${checkable ? '' : 'disabled'} ${i.recommended && checkable ? 'data-rec="1"' : ''}>
            <span class="pack-main">
              <span class="pack-title">${esc(i.title)}${i.recommended ? ' <span class="faint">· recommended</span>' : ''}</span>
              <span class="faint">${esc(i.description)}</span>
              ${i.error ? `<span class="faint" style="color:var(--bad)">${esc(i.error)}</span>` : ''}
            </span>
            <span class="pack-side">
              <span class="mono">${esc(i.sizeHuman)}</span>
              ${label ? `<span class="tag ${cls}">${label}</span>` : ''}
            </span>
          </label>`;
        }).join('')}
      `).join('')}

      <div class="card" style="margin-top:20px;position:sticky;bottom:12px">
        <div class="row-between">
          <span id="pick-summary" class="muted">Nothing selected.</span>
          <div class="row" style="gap:8px">
            <button class="btn btn-sm" id="pick-recommended">Tick recommended</button>
            <button class="btn btn-sm" id="pick-none">Clear</button>
            <button class="btn btn-primary" id="install-picked" disabled>Download selected</button>
          </div>
        </div>
      </div>

      <h2>Anything else from Kiwix</h2>
      <p class="muted" style="margin:-6px 0 12px">The full catalogue — hundreds of packs in dozens of languages.</p>
      <form class="row" id="catalog-form" style="margin-bottom:20px">
        <input id="catalog-q" class="btn" style="flex:1;min-width:200px;text-align:left" value="" placeholder="wikipedia, medicine, gutenberg, stackexchange…">
        <button class="btn" type="submit">Search catalogue</button>
      </form>
      <div id="catalog-results"></div>

      <p class="faint" style="margin-top:28px">${esc(data.note)}</p>
    `;

    wire();
  };

  const humanGb = (bytes) => (bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${Math.round(bytes / 1048576)} MB`);

  const queueHtml = () => {
    const a = data.active;
    const q = data.queue;
    if (!a && !q.length) return '';
    const job = a && a.job;
    return `
      <div class="card" style="border-color:var(--accent)">
        ${a ? `
          <div class="row-between">
            <strong>${esc(a.title)}</strong>
            <span class="faint">${a.fileCount > 1 ? `file ${a.fileIndex + 1} of ${a.fileCount} · ` : ''}${a.attempt > 1 ? `attempt ${a.attempt} · ` : ''}<button class="btn btn-sm" id="cancel-active">Cancel</button></span>
          </div>
          <div class="progress"><div style="width:${job ? job.percent : 0}%"></div></div>
          <div class="faint">${job ? `${esc(job.receivedHuman)}${job.total ? ` of ${esc(job.totalHuman)} · ${job.percent}%` : ''}${job.rateHuman ? ` · ${esc(job.rateHuman)}` : ''}${job.etaSeconds ? ` · ${formatEta(job.etaSeconds)} left` : ''}` : 'Starting…'}</div>
        ` : data.lockedElsewhere && q.length ? (() => {
          const first = data.items.find((i) => i.id === q[0].id);
          const pct = first && first.size ? Math.round((first.bytesOnDisk / first.size) * 100) : 0;
          return `<strong>${esc(q[0].title)}</strong>
            <div class="progress"><div style="width:${pct}%"></div></div>
            <div class="faint">Being downloaded by another Vault window on this machine · ${esc(humanGb(first ? first.bytesOnDisk : 0))} of ${esc(q[0].sizeHuman)} on disk</div>`;
        })() : '<strong>Queue paused</strong> <span class="faint">— it resumes when the Vault is next started</span>'}
        ${q.length ? `<p class="faint" style="margin:10px 0 0">Then: ${q.slice(0, 6).map((i) => esc(i.title)).join(' · ')}${q.length > 6 ? ` · and ${q.length - 6} more` : ''} — ${esc(humanGb(q.reduce((n, i) => n + i.size, 0)))} in all
          <button class="btn btn-sm" id="cancel-all" style="margin-left:8px">Clear queue</button></p>` : ''}
      </div>`;
  };

  const wire = () => {
    const picks = () => [...view.querySelectorAll('.pack-pick:checked')].map((b) => b.value);
    const summarise = () => {
      const ids = picks();
      const bytes = ids.reduce((n, id) => n + (data.items.find((i) => i.id === id)?.size || 0), 0);
      document.getElementById('pick-summary').textContent = ids.length ? `${ids.length} selected · ${humanGb(bytes)}` : 'Nothing selected.';
      document.getElementById('install-picked').disabled = ids.length === 0;
    };
    for (const box of view.querySelectorAll('.pack-pick')) box.onchange = summarise;

    document.getElementById('pick-recommended').onclick = () => {
      for (const box of view.querySelectorAll('.pack-pick[data-rec]')) box.checked = true;
      summarise();
    };
    document.getElementById('pick-none').onclick = () => {
      for (const box of view.querySelectorAll('.pack-pick')) box.checked = false;
      summarise();
    };
    document.getElementById('install-picked').onclick = async () => {
      await api('setup/install', { method: 'POST', body: { ids: picks() } });
      await refresh();
    };
    document.getElementById('get-recommended').onclick = async () => {
      await api('setup/install', { method: 'POST', body: { bundle: 'recommended' } });
      await refresh();
    };
    document.getElementById('get-everything').onclick = async () => {
      if (!confirm(`Queue everything in the catalogue — ${data.totals.everythingHuman}?`)) return;
      await api('setup/install', { method: 'POST', body: { bundle: 'everything' } });
      await refresh();
    };
    const cancelActive = document.getElementById('cancel-active');
    if (cancelActive) cancelActive.onclick = async () => { await api('setup/cancel', { method: 'POST', body: { id: data.active.id } }); await refresh(); };
    const cancelAll = document.getElementById('cancel-all');
    if (cancelAll) cancelAll.onclick = async () => { if (confirm('Clear the whole queue?')) { await api('setup/cancel', { method: 'POST', body: {} }); await refresh(); } };

    wireCatalogSearch();
    paintNetwork();
    const creditSave = document.getElementById('credit-save');
    if (creditSave) creditSave.onclick = async () => {
      const { credit } = await api('settings', { method: 'POST', body: { credit: document.getElementById('credit-name').value } });
      if (STATUS) STATUS.credit = credit;
      const el = document.getElementById('footer-credit-name');
      if (el) el.innerHTML = credit ? `Prepared by <strong>${esc(credit)}</strong>.` : '';
      creditSave.textContent = 'Saved';
      setTimeout(() => { creditSave.textContent = 'Save'; }, 1500);
    };
  };

  // The sharing switch. Off, the vault answers only this machine; on, any
  // device on the same wifi can open it. The server rebinds without a restart.
  const paintNetwork = async () => {
    const panel = document.getElementById('network-panel');
    if (!panel) return;
    let net;
    try { net = await api('network'); } catch { panel.innerHTML = '<p class="faint">Could not read the network state.</p>'; return; }
    const others = net.addresses.slice(1);
    panel.innerHTML = `
      <div class="row-between" style="align-items:flex-start;gap:16px;flex-wrap:wrap">
        <div style="flex:1;min-width:260px">
          <p style="margin:0 0 6px"><strong>${net.sharing ? 'On — other devices on this wifi can open the vault.' : 'Off — only this computer can open the vault.'}</strong></p>
          ${net.sharing
            ? `<p style="margin:0 0 6px">On a phone, tablet or another computer on the same wifi, open a browser and type${others.length === 1 ? ' this address' : ' one of these'}:</p>
               ${others.length ? others.map((a) => `<p class="mono" style="font-size:20px;margin:4px 0">${esc(a)}</p>`).join('') : '<p class="faint">This computer has no wifi or cable connection right now, so there is nothing to share yet.</p>'}
               <p class="faint" style="margin:8px 0 0">Nothing installs on the other device, and nothing leaves your wifi. Anyone on the wifi can read everything and can post messages, calendar events and map markings. Switch it off when you do not need it.</p>`
            : `<p class="faint" style="margin:0">The vault never touches the internet either way. Switching this on lets phones, tablets and other computers on your own wifi read it — useful for the household, unnecessary on a laptop used alone.</p>`}
        </div>
        <button class="btn ${net.sharing ? '' : 'btn-primary'}" id="share-toggle" ${net.locked ? 'disabled title="Fixed on the command line with --host"' : ''}>${net.sharing ? 'Switch off' : 'Switch on'}</button>
      </div>
      <details style="margin-top:12px"${net.sharing ? '' : ' open'}>
        <summary>How it works, step by step</summary>
        <ol style="margin:8px 0 0 18px;padding:0;line-height:1.6">
          <li><strong>Switch on.</strong> The vault starts listening for the other devices. Nothing else changes.</li>
          <li><strong>Windows asks once</strong> whether "Node.js JavaScript Runtime" may accept connections. Tick <em>Private networks</em>, untick <em>Public</em>, and Allow. (If you cancelled that box before, sharing will not work until you allow it: Windows Settings → Privacy &amp; security → Windows Security → Firewall &amp; network protection → Allow an app through firewall.)</li>
          <li><strong>On the other device,</strong> make sure it is on the same wifi, open any browser, and type the address shown above — the numbers and the colon and the port, exactly.</li>
          <li><strong>Add it to the home screen</strong> (Share → Add to Home Screen on iPhone; ⋮ → Add to Home screen on Android) and it opens like an app from then on, as long as this computer is running the vault.</li>
          <li><strong>Switch off</strong> when you are done, or leave it on for the household: the choice is remembered across restarts.</li>
        </ol>
        <p class="faint" style="margin:8px 0 0">What "on" means for safety: the vault has no passwords, so anyone who can join your wifi can read it and write to the shared parts (Comms, Calendar, map markings, shared notebook pages). It is still invisible from the internet — your router does not pass inbound connections unless you set that up yourself. On a public or shared wifi, keep it off.</p>
      </details>`;
    const toggle = document.getElementById('share-toggle');
    if (toggle) toggle.onclick = async () => {
      toggle.disabled = true;
      toggle.textContent = 'Switching…';
      await api('network/share', { method: 'POST', body: { on: !net.sharing } });
      // The server drops every connection while it rebinds; give it a moment.
      await new Promise((r) => setTimeout(r, 700));
      paintNetwork();
    };
  };

  const refresh = async () => {
    const scrollY = window.scrollY;
    data = await api('setup');
    paint();
    window.scrollTo(0, scrollY);
  };

  // While something is downloading, redraw only the queue panel so the
  // tick-list does not jump under the cursor.
  const tick = async () => {
    if (!document.getElementById('queue-panel')) return stopPolling();
    const fresh = await api('setup');
    const structural = fresh.items.map((i) => i.status).join() !== data.items.map((i) => i.status).join();
    data = fresh;
    if (structural) { paint(); return; }
    const panel = document.getElementById('queue-panel');
    if (panel) { panel.innerHTML = queueHtml(); wire(); }
  };

  paint();
  pollTimer = setInterval(tick, 2500);

  function wireCatalogSearch() {
    const form = document.getElementById('catalog-form');
    const results = document.getElementById('catalog-results');
    if (!form || form.dataset.wired) return;
    form.dataset.wired = '1';

    const runSearch = async () => {
      const q = document.getElementById('catalog-q').value.trim();
      if (!q) return;
      results.innerHTML = '<div class="loading">Searching…</div>';
      try {
        const found = await api(`catalog/search?q=${encodeURIComponent(q)}`);
        if (!found.online) { results.innerHTML = `<div class="empty">Could not reach the catalogue. You are offline.</div>`; return; }
        results.innerHTML = found.entries.length ? found.entries.map((entry) => `
          <div class="card">
            <div class="row-between"><strong>${esc(entry.title)}</strong><span class="tag">${esc(entry.sizeHuman)}</span></div>
            <p class="faint" style="margin:6px 0 0">${esc(entry.date || '')} · ${esc(entry.language || '')}${entry.flavour ? ` · ${esc(entry.flavour)}` : ''}${entry.articleCount ? ` · ${entry.articleCount.toLocaleString()} articles` : ''}</p>
            ${entry.summary ? `<p class="faint" style="margin:6px 0 0">${esc(entry.summary.slice(0, 240))}</p>` : ''}
            <div class="row" style="margin-top:12px">
              <button class="btn btn-sm get-btn" data-url="${esc(entry.url)}" data-filename="${esc(entry.filename)}">Download</button>
              <span class="faint mono">${esc(entry.filename || '')}</span>
            </div>
          </div>`).join('') : '<div class="empty">Nothing matched.</div>';
        for (const btn of results.querySelectorAll('.get-btn')) {
          btn.onclick = async () => {
            btn.disabled = true; btn.textContent = 'Downloading…';
            await api('downloads', { method: 'POST', body: { url: btn.dataset.url, filename: btn.dataset.filename } });
            location.hash = '#/library';
          };
        }
      } catch (err) {
        results.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
      }
    };
    form.onsubmit = (e) => { e.preventDefault(); runSearch(); };
  }
}

// --------------------------------------------------------------- handbook

async function renderHandbook() {
  setBusy();
  const { modules } = await api('handbook');

  view.innerHTML = `
    <h1>Survival handbook</h1>
    <p class="lede">Written for the day the search engine is not there. Skim it now; you will not want to be reading it for the first time in an emergency.</p>
    ${modules.length === 0 ? '<div class="empty">No handbook content installed.</div>' : modules.map((mod) => `
      <h2>${esc(mod.title)}</h2>
      ${mod.summary ? `<p class="muted" style="margin:-6px 0 12px">${esc(mod.summary)}</p>` : ''}
      ${mod.chapters.map((ch) => `
        <a class="card card-link" href="#/handbook/${encodeURIComponent(ch.id)}">
          <strong>${esc(ch.title)}</strong>
          ${ch.summary ? `<p class="faint" style="margin:6px 0 0">${esc(ch.summary)}</p>` : ''}
        </a>
      `).join('')}
    `).join('')}
  `;
}

async function renderChapter(id) {
  setBusy();
  const chapter = await api(`handbook/${id.split('/').map(encodeURIComponent).join('/')}`);
  view.innerHTML = printable(
    `<a href="#/handbook">Handbook</a> · ${esc(chapter.moduleTitle)}`,
    chapter.html,
    `Handbook · ${chapter.moduleTitle} · ${chapter.title}`
  );
  resolveWikiLinksWithFallback(view);
}

// wiki:Title links in authored pages open the article in the best installed
// encyclopedia: full English Wikipedia first, then Simple English, then any
// Wikipedia. With none installed the link explains itself instead.
let WIKI_PACK;
async function wikiPack() {
  if (WIKI_PACK !== undefined) return WIKI_PACK;
  try {
    const { packs } = await api('library');
    const ok = packs.filter((p) => p.ok !== false);
    const pick = (re) => ok.find((p) => re.test(p.id));
    WIKI_PACK = pick(/^wikipedia-en-all/) || pick(/^wikipedia-en-simple/) || pick(/^wikipedia-en/) || pick(/^wikipedia/) || null;
  } catch { WIKI_PACK = null; }
  return WIKI_PACK;
}
async function resolveWikiLinks(root) {
  const links = root.querySelectorAll('a.wiki-link');
  if (!links.length) return;
  const pack = await wikiPack();
  for (const a of links) {
    const title = decodeURIComponent(a.getAttribute('href').slice(5)).replace(/ /g, '_');
    if (pack) {
      a.href = `#/read/${encodeURIComponent(pack.id)}/${encodeURIComponent(title)}`;
      a.title = `${title.replace(/_/g, ' ')} — ${pack.title}`;
    } else {
      a.href = '#/setup';
      a.title = 'No encyclopedia installed yet — Setup → Encyclopedias';
    }
  }
}
// A link may offer alternatives — wiki:Corylus_avellana|Hazel — because the
// Latin name is an article in the full Wikipedia but only the common name is
// in the Simple English one. The first title the pack actually has wins.
const WIKI_HAS = new Map();
async function packHas(pack, title) {
  const key = `${pack.id}/${title}`;
  if (!WIKI_HAS.has(key)) {
    WIKI_HAS.set(key, fetch(`/z/${encodeURIComponent(pack.id)}/C/${encodeURIComponent(title)}`, { method: 'HEAD' })
      .then((r) => r.ok).catch(() => false));
  }
  return WIKI_HAS.get(key);
}
async function resolveWikiLinksWithFallback(root) {
  const links = root.querySelectorAll('a.wiki-link');
  if (!links.length) return;
  const pack = await wikiPack();
  if (!pack) return resolveWikiLinks(root);
  await Promise.all([...links].map(async (a) => {
    const options = decodeURIComponent(a.getAttribute('href').slice(5)).split('|').map((t) => t.trim().replace(/ /g, '_')).filter(Boolean);
    let chosen = options[0];
    for (const t of options) { if (await packHas(pack, t)) { chosen = t; break; } }
    a.href = `#/read/${encodeURIComponent(pack.id)}/${encodeURIComponent(chosen)}`;
    a.title = `${chosen.replace(/_/g, ' ')} — ${pack.title}`;
  }));
}

// -------------------------------------------------------------- languages

async function renderLanguages() {
  setBusy();
  const { languages } = await api(`languages?profile=${encodeURIComponent(PROFILE)}`);

  const totalCards = languages.reduce((sum, l) => sum + l.decks.reduce((n, d) => n + d.cardCount, 0), 0);
  const settings = studySettings();

  view.innerHTML = `
    <h1>Languages</h1>
    <p class="lede">Spaced repetition: each card comes back just before you would have forgotten it. Ten minutes a day beats an hour a week.</p>

    <div class="card" style="margin-bottom:18px">
      <div class="row" style="gap:18px;flex-wrap:wrap;align-items:center">
        <label class="row" style="gap:8px">
          <span>New cards per session</span>
          <select id="study-new" class="map-select" style="width:auto">
            ${[5, 10, 20, 40, 100].map((n) => `<option value="${n}" ${n === settings.newLimit ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </label>
        <label class="row" style="gap:8px">
          <span>Session size</span>
          <select id="study-limit" class="map-select" style="width:auto">
            ${[30, 60, 100, 200].map((n) => `<option value="${n}" ${n === settings.limit ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" id="study-reading" ${settings.showReading ? 'checked' : ''}>
          <span>Show pronunciation on the front of the card</span>
        </label>
      </div>
      <p class="faint" style="margin:10px 0 0">A session is everything due for review plus up to this many cards you have not seen yet — so the first
      session of a new deck shows ${settings.newLimit} cards, not the whole deck. ${totalCards} cards are installed across
      ${languages.length} languages. Pronunciation is written the way an English speaker would say it (rōmaji for Japanese,
      pinyin for Mandarin) — hide it once you can read the script. Cards can also be spoken aloud (the Say it button, or P)
      using the voices installed in Windows; that works offline, but only for languages whose voice is installed.</p>
    </div>

    ${languages.length === 0 ? '<div class="empty">No language decks installed.</div>' : languages.map((lang) => `
      <h2>${esc(lang.name)}${lang.nativeName ? ` <span class="muted" style="font-weight:400">${esc(lang.nativeName)}</span>` : ''}</h2>
      <div class="row" style="margin:-6px 0 12px">
        <span class="tag ${lang.stats.due ? 'tag-warn' : 'tag-good'}">${lang.stats.due} due</span>
        <span class="tag">${lang.stats.new} new</span>
        <span class="tag">${lang.stats.mature} known</span>
        <a class="btn btn-primary btn-sm" href="#/study?language=${encodeURIComponent(lang.id)}">Study ${esc(lang.name)}</a>
        ${lang.guide ? `<a class="btn btn-sm" href="#/languages/${encodeURIComponent(lang.id)}/guide">How it works</a>` : ''}
      </div>
      ${lang.notes ? `<p class="faint" style="margin:0 0 12px">${esc(lang.notes)}</p>` : ''}
      ${lang.syllabus ? `<p class="faint" style="margin:0 0 12px"><strong>Where this sits:</strong> ${esc(lang.syllabus)}</p>` : ''}
      ${lang.decks.map((deck) => `
        <div class="card">
          <div class="row-between">
            <div>
              <strong>${esc(deck.title)}</strong>
              ${deck.description ? `<p class="faint" style="margin:4px 0 0">${esc(deck.description)}</p>` : ''}
            </div>
            <a class="btn btn-sm" href="#/study/${encodeURIComponent(deck.id)}">Study</a>
          </div>
          <p class="faint" style="margin:8px 0 0">${deck.cardCount} cards · ${deck.stats.due} due · ${deck.stats.new} new · ${deck.stats.mature} known</p>
        </div>
      `).join('')}
    `).join('')}
  `;

  document.getElementById('study-new').onchange = (e) => saveStudySettings({ newLimit: Number(e.target.value) });
  document.getElementById('study-limit').onchange = (e) => saveStudySettings({ limit: Number(e.target.value) });
  document.getElementById('study-reading').onchange = (e) => saveStudySettings({ showReading: e.target.checked });
}

/** How big a study session is and whether the reading shows before the flip. Per browser. */
function studySettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('vault.study') || '{}'); } catch { saved = {}; }
  return { newLimit: 10, limit: 60, showReading: true, autoSpeak: false, ...saved };
}

// Spoken pronunciation comes from the browser's own speech engine, which works
// offline as long as Windows has the language's voice installed (Settings ›
// Time & language › Speech › Add voices). Nothing is fetched.
const SPEECH_LANG = { japanese: 'ja', mandarin: 'zh', hindi: 'hi', spanish: 'es', english: 'en' };

function speechVoice(langId) {
  if (!('speechSynthesis' in window)) return null;
  const code = SPEECH_LANG[langId];
  if (!code) return null;
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang.toLowerCase().startsWith(code) && v.localService)
    || voices.find((v) => v.lang.toLowerCase().startsWith(code))
    || null;
}

function speak(text, langId) {
  const voice = speechVoice(langId);
  if (!voice) return false;
  speechSynthesis.cancel();
  // Cards like "他 / 她" or "一二三四五" read better one part at a time.
  const utter = new SpeechSynthesisUtterance(text.replace(/\s*\/\s*/g, ', ').replace(/…/g, ''));
  utter.voice = voice;
  utter.lang = voice.lang;
  utter.rate = 0.85;
  speechSynthesis.speak(utter);
  return true;
}
if ('speechSynthesis' in window) speechSynthesis.getVoices(); // warms the list; Chrome fills it asynchronously

function saveStudySettings(patch) {
  const next = { ...studySettings(), ...patch };
  localStorage.setItem('vault.study', JSON.stringify(next));
  return next;
}

async function renderLanguageGuide(langId) {
  setBusy();
  const guide = await api(`languages/${encodeURIComponent(langId)}/guide`);
  view.innerHTML = printable(
    `<a href="#/languages">Languages</a> · ${esc(guide.language)}`,
    guide.html,
    `Languages · ${guide.language} · ${guide.title}`
  );
}

async function renderStudy(deckId, params) {
  setBusy('Building your review queue…');

  const settings = studySettings();
  const query = new URLSearchParams({ profile: PROFILE, limit: settings.limit, new: settings.newLimit });
  if (deckId) query.set('deck', deckId);
  const language = params?.get('language');
  if (language) query.set('language', language);

  const data = await api(`srs/queue?${query}`);
  const queue = data.queue;

  if (queue.length === 0) {
    view.innerHTML = `
      <h1>Nothing due</h1>
      <p class="lede">Every card in this set is scheduled for later. That is the system working.</p>
      <div class="stat-row">
        <div class="stat"><div class="stat-value">${data.stats.total}</div><div class="stat-label">Total</div></div>
        <div class="stat"><div class="stat-value">${data.stats.mature}</div><div class="stat-label">Known</div></div>
        <div class="stat"><div class="stat-value">${data.stats.learning}</div><div class="stat-label">Learning</div></div>
        <div class="stat"><div class="stat-value">${data.stats.new}</div><div class="stat-label">Unseen</div></div>
      </div>
      <a class="btn" href="#/languages">Back to languages</a>`;
    return;
  }

  let index = 0;
  let revealed = false;
  let done = 0;

  const draw = () => {
    const card = queue[index];
    const voice = speechVoice(card.language);
    view.innerHTML = `<div class="study">
      <div class="row-between" style="margin-bottom:12px">
        <span class="faint">${done} reviewed · ${queue.length - index} left</span>
        <span>
          ${voice ? `<button class="btn btn-sm" id="say-it" title="Say it (P)">🔊 Say it</button>
          <button class="btn btn-sm ${settings.autoSpeak ? 'btn-primary' : ''}" id="auto-speak" title="Speak every card as it appears">Auto</button>` : ''}
          <a class="btn btn-sm" href="#/languages">Finish</a>
        </span>
      </div>
      <div class="progress"><div style="width:${(index / queue.length) * 100}%"></div></div>

      <div class="flashcard" id="card">
        <div class="front">${esc(card.front)}</div>
        ${card.reading && (revealed || settings.showReading) ? `<div class="reading">${esc(card.reading)}</div>` : ''}
        ${revealed ? `<div class="back">${esc(card.back)}</div>` : ''}
        ${revealed && card.note ? `<div class="note">${esc(card.note)}</div>` : ''}
        ${!revealed ? '<div class="hint">tap, or press space, to reveal</div>' : ''}
      </div>
      ${!voice && card.language && SPEECH_LANG[card.language] && index === 0 && !revealed ? `<p class="faint" style="text-align:center;font-size:12px">No ${esc(card.language[0].toUpperCase() + card.language.slice(1))} voice is installed, so the cards cannot be spoken. Windows: Settings › Time &amp; language › Speech › Add voices — it works offline once installed.</p>` : ''}

      ${revealed ? `
        <div class="grade-row">
          <button class="btn grade-0" data-grade="0">Again</button>
          <button class="btn grade-1" data-grade="1">Hard</button>
          <button class="btn grade-2" data-grade="2">Good</button>
          <button class="btn grade-3" data-grade="3">Easy</button>
        </div>
        <p class="faint" style="text-align:center;margin-top:10px">keys 1 – 4</p>
      ` : ''}
      <p class="faint" style="margin-top:16px">${esc(card.deckTitle || '')}${card.deckTitle && card.reading ? ' · ' : ''}${card.reading ? `<a href="#" id="toggle-reading">${settings.showReading ? 'hide' : 'show'} pronunciation before the flip</a>` : ''}</p>
    </div>`;

    const toggle = document.getElementById('toggle-reading');
    if (toggle) {
      toggle.onclick = (e) => {
        e.preventDefault();
        settings.showReading = !settings.showReading;
        saveStudySettings({ showReading: settings.showReading });
        draw();
      };
    }

    document.getElementById('card').onclick = () => { if (!revealed) { revealed = true; draw(); } };
    for (const btn of view.querySelectorAll('[data-grade]')) {
      btn.onclick = () => grade(Number(btn.dataset.grade));
    }

    const sayIt = document.getElementById('say-it');
    if (sayIt) {
      sayIt.onclick = () => speak(card.front, card.language);
      document.getElementById('auto-speak').onclick = () => {
        settings.autoSpeak = !settings.autoSpeak;
        saveStudySettings({ autoSpeak: settings.autoSpeak });
        draw();
      };
      // Speak once per card, when it first appears — not again on the flip.
      if (settings.autoSpeak && !revealed) speak(card.front, card.language);
    }
  };

  const grade = async (value) => {
    const card = queue[index];
    await api('srs/review', { method: 'POST', body: { profile: PROFILE, cardId: card.id, grade: value } });
    done += 1;

    // "Again" puts the card back near the end of this session.
    if (value === 0) queue.push(card);

    index += 1;
    revealed = false;
    if (index >= queue.length) {
      view.innerHTML = `
        <h1>Session done</h1>
        <p class="lede">${done} cards reviewed. Come back tomorrow — the schedule does the rest.</p>
        <a class="btn btn-primary" href="#/languages">Back to languages</a>`;
      document.onkeydown = null;
      return;
    }
    draw();
  };

  document.onkeydown = (e) => {
    if (!location.hash.startsWith('#/study')) { document.onkeydown = null; return; }
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space' || e.key === 'Enter') {
      e.preventDefault();
      if (!revealed) { revealed = true; draw(); }
    } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
      grade(Number(e.key) - 1);
    } else if (e.key === 'p' || e.key === 'P') {
      const card = queue[index];
      if (card) speak(card.front, card.language);
    }
  };

  draw();
}

// ------------------------------------------------------------------- maps

let MAP = null;

async function renderMaps() {
  setBusy('Loading maps…');
  const { packs, categories, mapsDir } = await api('maps');

  const vectorPacks = packs.filter((p) => p.ok !== false && p.kind === 'vector');
  const rasterPacks = packs.filter((p) => p.ok !== false && p.kind === 'raster' && !p.baselayer);
  const satellitePacks = packs.filter((p) => p.ok !== false && p.kind === 'raster' && p.baselayer);
  const terrainPacks = packs.filter((p) => p.ok !== false && p.kind === 'terrain');

  view.innerHTML = `
    <div class="row-between" style="margin-bottom:12px">
      <h1 style="margin:0">Maps</h1>
      <div class="row" style="gap:6px">
        <button class="btn btn-sm" id="map-zoom-out">−</button>
        <button class="btn btn-sm" id="map-zoom-in">+</button>
        <button class="btn btn-sm" id="map-style">Dark</button>
      </div>
    </div>

    <div class="map-shell">
      <canvas id="map-canvas"></canvas>
      <div class="map-readout" id="map-readout">—</div>
    </div>

    <div class="map-controls">
      <div class="map-panel">
        <h3>Base map</h3>
        ${vectorPacks.length ? `<select id="map-base" class="map-select">
          ${vectorPacks.map((p) => `<option value="${esc(p.id)}">${esc(p.title)} · ${esc(p.sizeHuman)}</option>`).join('')}
        </select>` : '<p class="faint">None installed.</p>'}

        <h3 style="margin-top:16px">Satellite</h3>
        ${satellitePacks.length ? `<select id="map-satellite" class="map-select">
          <option value="">Off — the drawn map</option>
          ${satellitePacks.map((p) => `<option value="${esc(p.id)}">${esc(p.title)} · ${esc(p.sizeHuman)}</option>`).join('')}
        </select>
        <p class="faint" style="margin:6px 0 0">Roads, boundaries and names stay drawn over the photograph.</p>`
        : '<p class="faint" style="margin:0">No imagery installed. Setup → Satellite &amp; terrain.</p>'}

        <h3 style="margin-top:16px">Terrain</h3>
        ${terrainPacks.length ? `<label class="checkbox-row">
          <input type="checkbox" id="map-hillshade">
          <span>Hill shading</span>
        </label>
        <p class="faint" style="margin:6px 0 0">${esc(terrainPacks.map((p) => p.title).join(', '))} installed. Route plans get their climb from it.</p>`
        : '<p class="faint" style="margin:0">No heights installed, so routes cannot say how much climb there is. Setup → Satellite &amp; terrain.</p>'}

        ${rasterPacks.length ? `<h3 style="margin-top:16px">Overlays</h3>
          ${rasterPacks.map((p) => `
            <label class="checkbox-row" style="margin-bottom:6px">
              <input type="checkbox" class="map-overlay" value="${esc(p.id)}">
              <span>${esc(p.title)} <span class="faint">${esc(p.sizeHuman)}</span></span>
            </label>`).join('')}` : ''}

        <h3 style="margin-top:16px">Go to</h3>
        <form class="row" id="map-goto" style="gap:6px">
          <input class="map-select" id="map-coords" placeholder="a place name, or 54.05, -2.80" style="flex:1" autocomplete="off">
          <button class="btn btn-sm" type="submit">Go</button>
        </form>
        <div id="map-places"></div>
        <p class="faint" id="map-places-note" style="margin:6px 0 0">A town, village or country from the installed maps, or latitude, longitude in decimal degrees.</p>
      </div>

      <div class="map-panel">
        <div class="row-between">
          <h3 style="margin:0">Points of interest</h3>
          <button class="btn btn-sm" id="map-poi-all">None</button>
        </div>
        <p class="faint" style="margin:6px 0 10px">Categories chosen for usefulness, not for who paid to be listed.</p>
        <div id="map-categories">
          ${categories.map((c) => `
            <label class="checkbox-row poi-row">
              <input type="checkbox" class="map-cat" value="${esc(c.id)}" checked>
              <span class="poi-dot" style="background:${esc(c.colour)}"></span>
              <span>${esc(c.label)}</span>
            </label>`).join('')}
        </div>
        <label class="checkbox-row" style="margin-top:12px">
          <input type="checkbox" id="map-labels" checked>
          <span>Place names</span>
        </label>
      </div>

      <div class="map-panel">
        <div class="row-between">
          <h3 style="margin:0">Your markings</h3>
          <label class="checkbox-row" style="font-size:13px">
            <input type="checkbox" id="map-show-ann" checked>
            <span>Show</span>
          </label>
        </div>
        <p class="faint" style="margin:6px 0 10px">Drawn on the map and saved here, so everyone on
        the network sees the same routes and notes.</p>

        <div class="row" style="gap:6px;margin-bottom:8px;flex-wrap:wrap">
          <button class="btn btn-sm" id="tool-pan">Pan</button>
          <button class="btn btn-sm" id="tool-pen">Draw</button>
          <button class="btn btn-sm" id="tool-pin">Pin</button>
          <button class="btn btn-sm" id="tool-eraser">Erase</button>
          <button class="btn btn-sm" id="tool-measure">Measure</button>
          <button class="btn btn-sm" id="tool-route">Route</button>
        </div>
        <p class="faint" id="tool-hint" style="margin:0 0 8px"></p>
        <div id="measure-panel" class="tool-panel" hidden></div>
        <div id="route-panel" class="tool-panel" hidden></div>

        <div class="swatches" id="swatches"></div>
        <div class="pen-sizes" id="pen-sizes"></div>

        <h3 style="margin-top:14px">Layers</h3>
        <div id="ann-layers"></div>
        <button class="btn btn-sm" id="add-layer" style="margin-top:8px">+ New layer</button>
      </div>

      <div class="map-panel">
        <div class="row-between">
          <h3 style="margin:0">Almanac</h3>
          <input type="date" id="almanac-date" class="map-select" style="width:auto;padding:4px 8px;font-size:13px">
        </div>
        <p class="faint" style="margin:6px 0 8px">For the centre of the map. Computed, not looked up — it works with no data at all.</p>
        <div class="row" style="gap:8px;align-items:center;margin-bottom:6px">
          <input type="range" id="almanac-time" min="0" max="1439" step="5" style="flex:1" title="Time of day">
          <span class="mono" id="almanac-time-label" style="min-width:3.2rem">12:00</span>
          <button class="btn btn-sm" id="almanac-now">Now</button>
        </div>
        <label class="checkbox-row" style="font-size:13px;margin-bottom:8px">
          <input type="checkbox" id="almanac-night" checked>
          <span>Shade the night side of the world at this time</span>
        </label>
        <div id="almanac-body" class="almanac"></div>
      </div>
    </div>

    ${packs.length === 0 ? `<div class="card" style="margin-top:16px">
      <strong>No map packs installed.</strong>
      <p class="muted" style="margin:8px 0">Put <code>.pmtiles</code> or <code>.mbtiles</code> files in this folder and reload:</p>
      <p class="mono" style="word-break:break-all">${esc(mapsDir)}</p>
      <p class="muted" style="margin:12px 0 0">See <a href="#/handbook/comms/offline-maps">the handbook chapter on offline maps</a> for exactly how to build a regional extract.</p>
    </div>` : `<div class="row" style="margin-top:12px">
      <button class="btn btn-sm" id="map-rescan">Rescan map folder</button>
      <span class="faint">${packs.length} pack${packs.length === 1 ? '' : 's'} in ${esc(mapsDir)}</span>
    </div>`}
  `;

  const canvas = document.getElementById('map-canvas');
  const readout = document.getElementById('map-readout');
  const colours = Object.fromEntries(categories.map((c) => [c.id, c.colour]));

  // Come back to the map where you left it.
  let savedView = null;
  try { savedView = JSON.parse(localStorage.getItem('vault.mapView') || 'null'); } catch { savedView = null; }

  MAP = new VaultMap(canvas, {
    categories: colours,
    lon: savedView?.lon, lat: savedView?.lat, zoom: savedView?.zoom,
    style: savedView?.style === 'dark' ? 'dark' : 'paper',
  });
  MAP.setRasterInfo(packs.filter((p) => p.ok !== false));
  window.vaultMap = MAP; // handy when debugging from the console

  let saveTimer = null;
  const saveView = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem('vault.mapView', JSON.stringify({
          lon: MAP.centre.lon, lat: MAP.centre.lat, zoom: MAP.zoom, style: MAP.styleName,
          base: document.getElementById('map-base')?.value || null,
          overlays: [...view.querySelectorAll('.map-overlay:checked')].map((b) => b.value),
          satellite: document.getElementById('map-satellite')?.value || '',
          hillshade: Boolean(document.getElementById('map-hillshade')?.checked),
        }));
      } catch { /* storage full or blocked: not worth a fuss */ }
    }, 400);
  };
  MAP.onMove = saveView;
  MAP.onHover = (position) => {
    if (!position) return;
    readout.dataset.position = `${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}  ·  zoom ${MAP.zoom.toFixed(1)}`;
    readout.textContent = readout.dataset.measure
      ? `${readout.dataset.measure}  ·  ${readout.dataset.position}`
      : readout.dataset.position;
  };

  const baseSelect = document.getElementById('map-base');
  if (baseSelect) {
    if (savedView?.base && vectorPacks.some((p) => p.id === savedView.base)) baseSelect.value = savedView.base;
    const applyBase = () => {
      const pack = vectorPacks.find((p) => p.id === baseSelect.value);
      MAP.setBase(pack.id, pack);
      saveView();
    };
    baseSelect.onchange = applyBase;
    applyBase();
  } else {
    MAP.draw();
  }

  document.getElementById('map-zoom-in').onclick = () => MAP.zoomBy(1);
  document.getElementById('map-zoom-out').onclick = () => MAP.zoomBy(-1);

  // Three looks, cycled: paper, dark, and an Ordnance Survey imitation.
  const STYLE_CYCLE = { paper: 'dark', dark: 'os', os: 'paper' };
  const STYLE_LABELS = { paper: 'Paper', dark: 'Dark', os: 'OS style' };
  const styleBtn = document.getElementById('map-style');
  styleBtn.title = 'Switch the map look';
  styleBtn.textContent = STYLE_LABELS[STYLE_CYCLE[MAP.styleName] || 'paper'];
  styleBtn.onclick = () => {
    const next = STYLE_CYCLE[MAP.styleName] || 'paper';
    MAP.setStyle(next);
    styleBtn.textContent = STYLE_LABELS[STYLE_CYCLE[next]];
    saveView();
  };

  const satelliteSelect = document.getElementById('map-satellite');
  if (satelliteSelect) {
    if (savedView?.satellite && satellitePacks.some((p) => p.id === savedView.satellite)) satelliteSelect.value = savedView.satellite;
    satelliteSelect.onchange = () => { MAP.setBaseRaster(satelliteSelect.value); saveView(); };
    if (satelliteSelect.value) MAP.setBaseRaster(satelliteSelect.value);
  }
  const hillshadeBox = document.getElementById('map-hillshade');
  if (hillshadeBox) {
    const best = terrainPacks.slice().sort((a, b) => (b.maxZoom || 0) - (a.maxZoom || 0))[0];
    hillshadeBox.checked = savedView?.hillshade !== false; // on by default once a pack exists
    hillshadeBox.onchange = () => { MAP.setHillshade(hillshadeBox.checked ? best.id : null); saveView(); };
    if (hillshadeBox.checked) MAP.setHillshade(best.id);
  }

  const overlayBoxes = [...view.querySelectorAll('.map-overlay')];
  const syncOverlays = () => {
    MAP.setOverlays(overlayBoxes.filter((b) => b.checked).map((b) => b.value));
    saveView();
  };
  for (const box of overlayBoxes) {
    if (Array.isArray(savedView?.overlays) && savedView.overlays.includes(box.value)) box.checked = true;
    box.onchange = syncOverlays;
  }
  if (overlayBoxes.some((b) => b.checked)) MAP.setOverlays(overlayBoxes.filter((b) => b.checked).map((b) => b.value));

  const catBoxes = [...view.querySelectorAll('.map-cat')];
  const syncCategories = () => {
    MAP.enabledCategories = new Set(catBoxes.filter((b) => b.checked).map((b) => b.value));
    MAP.showPoi = MAP.enabledCategories.size > 0;
    MAP.draw();
  };
  for (const box of catBoxes) box.onchange = syncCategories;

  const allBtn = document.getElementById('map-poi-all');
  allBtn.onclick = () => {
    const turningOff = catBoxes.some((b) => b.checked);
    for (const box of catBoxes) box.checked = !turningOff;
    allBtn.textContent = turningOff ? 'All' : 'None';
    syncCategories();
  };

  document.getElementById('map-labels').onchange = (e) => {
    MAP.showLabels = e.target.checked;
    MAP.draw();
  };

  // One box for both: a pair of numbers is a coordinate, anything else is a
  // place name looked up in the index built from the vector packs.
  const placesBox = document.getElementById('map-places');
  const placesNote = document.getElementById('map-places-note');
  const coordsInput = document.getElementById('map-coords');
  const PLACE_ZOOM = { country: 5, region: 8, county: 9, locality: 12, macrohood: 13, neighbourhood: 14 };
  let placeTimer = null;
  let placeSeq = 0;

  const showPlaces = (data) => {
    if (!data.ready) {
      placesBox.innerHTML = data.building
        ? '<p class="faint" style="margin:6px 0 0">Building the place index… try again in a minute.</p>'
        : `<p class="faint" style="margin:6px 0 0">No place index yet. <a href="#" id="build-places">Build it</a> from the installed maps — under a minute, once.</p>`;
      const build = document.getElementById('build-places');
      if (build) build.onclick = async (e) => { e.preventDefault(); showPlaces(await api('maps/places/build', { method: 'POST' })); };
      return;
    }
    if (!data.results.length) {
      placesBox.innerHTML = '<p class="faint" style="margin:6px 0 0">Nothing by that name in the installed maps.</p>';
      return;
    }
    placesBox.innerHTML = `<div class="place-results">${data.results.map((r, i) => `
      <a href="#" class="place-result" data-i="${i}">
        <span>${esc(r.name)}</span>
        <span class="faint">${esc(r.kind.replace('_', ' '))} · ${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}</span>
      </a>`).join('')}</div>`;
    for (const link of placesBox.querySelectorAll('.place-result')) {
      link.onclick = (e) => {
        e.preventDefault();
        const r = data.results[Number(link.dataset.i)];
        MAP.goTo(r.lon, r.lat, PLACE_ZOOM[r.kind] || 12);
        MAP.setMarker(r.lon, r.lat);
        coordsInput.value = r.name;
        placesBox.innerHTML = '';
      };
    }
  };

  const lookUp = async (raw) => {
    const parts = raw.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n));
    if (parts.length >= 2 && /^[-\d.,\s]+$/.test(raw)) {
      MAP.goTo(parts[1], parts[0], Math.max(MAP.zoom, 12));
      MAP.setMarker(parts[1], parts[0]);
      placesBox.innerHTML = '';
      return;
    }
    if (raw.length < 2) { placesBox.innerHTML = ''; return; }
    const seq = ++placeSeq;
    const data = await api(`maps/places?q=${encodeURIComponent(raw)}&near=${MAP.centre.lat.toFixed(3)},${MAP.centre.lon.toFixed(3)}`);
    if (seq !== placeSeq) return; // a newer keystroke has answered
    showPlaces(data);
  };

  document.getElementById('map-goto').onsubmit = (e) => {
    e.preventDefault();
    clearTimeout(placeTimer);
    lookUp(coordsInput.value.trim());
  };
  coordsInput.oninput = () => {
    clearTimeout(placeTimer);
    placeTimer = setTimeout(() => lookUp(coordsInput.value.trim()), 250);
  };
  api('maps/places').then((data) => {
    if (data.ready) placesNote.textContent = `${data.count.toLocaleString()} place names from the installed maps, or latitude, longitude in decimal degrees.`;
    else showPlaces(data);
  }).catch(() => {});

  const rescan = document.getElementById('map-rescan');
  if (rescan) {
    rescan.onclick = async () => {
      rescan.disabled = true;
      await api('maps/scan', { method: 'POST' });
      route();
    };
  }

  await setUpAnnotations();
  setUpAlmanac();

  // The canvas has no size until it is in the document.
  requestAnimationFrame(() => MAP.resize());
}

function setUpAlmanac() {
  const A = window.vaultAlmanac;
  const body = document.getElementById('almanac-body');
  const dateInput = document.getElementById('almanac-date');
  if (!A || !body || !dateInput) return;

  const today = new Date();
  dateInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const timeInput = document.getElementById('almanac-time');
  const timeLabel = document.getElementById('almanac-time-label');
  const nightBox = document.getElementById('almanac-night');
  timeInput.value = today.getHours() * 60 + today.getMinutes();
  let followClock = true; // until the slider is touched, the time is now

  const chosenInstant = () => {
    const [y, m, d] = dateInput.value.split('-').map(Number);
    if (!y) return new Date();
    const minutes = Number(timeInput.value);
    return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  };

  const paint = () => {
    const [y, m, d] = dateInput.value.split('-').map(Number);
    if (!y) return;
    const date = new Date(y, m - 1, d);
    const { lat, lon } = MAP.centre;
    const sun = A.sunTimes(date, lat, lon);
    const moon = A.moonPhase(date);

    const at = chosenInstant();
    timeLabel.textContent = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const pos = A.sunPosition(at, lat, lon);
    const isToday = date.toDateString() === new Date().toDateString();

    MAP.sunTime = at;
    MAP.showNight = nightBox.checked;
    MAP.draw();

    const row = (label, value) => `<div class="almanac-row"><span class="faint">${label}</span><span class="mono">${value}</span></div>`;

    body.innerHTML = `
      ${sun.polar ? `<p class="muted">Polar ${sun.polar}: the sun does not ${sun.polar === 'day' ? 'set' : 'rise'} here on this date.</p>` : ''}
      ${row('First light', A.formatTime(sun.dawn))}
      ${row('Sunrise', A.formatTime(sun.sunrise))}
      ${row('Solar noon', A.formatTime(sun.solarNoon) + ' · due south')}
      ${row('Sunset', A.formatTime(sun.sunset))}
      ${row('Last light', A.formatTime(sun.dusk))}
      ${row('Day length', A.formatDuration(sun.dayLengthMinutes))}
      ${row(isToday && followClock ? 'Sun now' : `Sun at ${timeLabel.textContent}`, pos.altitude > 0
        ? `${pos.azimuth.toFixed(0)}° ${A.compassPoint(pos.azimuth)} · ${pos.altitude.toFixed(0)}° up · shadow ${pos.altitude > 2 ? (1 / Math.tan(pos.altitude * Math.PI / 180)).toFixed(1) + '× your height' : 'very long'}`
        : `below the horizon (${(-pos.altitude).toFixed(0)}° under)`)}
      ${row('Moon', `${moon.glyph} ${moon.name} · ${Math.round(moon.illumination * 100)}% lit`)}
      ${row('Next full moon', moon.nextFull.toLocaleDateString())}
      <p class="faint" style="margin:10px 0 0">${lat.toFixed(3)}, ${lon.toFixed(3)} · local time. First and last light are civil twilight — enough to work by without a lamp.</p>
    `;
  };

  dateInput.onchange = paint;
  timeInput.oninput = () => { followClock = false; paint(); };
  nightBox.onchange = paint;
  document.getElementById('almanac-now').onclick = () => {
    const now = new Date();
    dateInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    timeInput.value = now.getHours() * 60 + now.getMinutes();
    followClock = true;
    paint();
  };
  // While following the clock, keep the shadow moving.
  const clock = setInterval(() => {
    if (!document.getElementById('almanac-time')) { clearInterval(clock); return; }
    if (followClock) { const now = new Date(); timeInput.value = now.getHours() * 60 + now.getMinutes(); paint(); }
  }, 60000);
  const previous = MAP.onHover;
  // Recompute when the map is moved: cheap, and the panel follows the view.
  let lastCentre = '';
  const watch = () => {
    const key = `${MAP.centre.lat.toFixed(2)},${MAP.centre.lon.toFixed(2)}`;
    if (key !== lastCentre) { lastCentre = key; paint(); }
  };
  MAP.onHover = (p) => { if (previous) previous(p); watch(); };
  paint();
}

const PEN_COLOURS = ['#f85149', '#e3b341', '#3fb950', '#6cb6ff', '#bc8cff', '#ffffff', '#1a1a1a'];
const PEN_WIDTHS = [2, 4, 7, 12];

async function setUpAnnotations() {
  let { layers } = await api('maps/annotations');
  MAP.setAnnotations(layers);

  const layerList = document.getElementById('ann-layers');
  const swatches = document.getElementById('swatches');
  const sizes = document.getElementById('pen-sizes');

  const toolButtons = {
    pan: document.getElementById('tool-pan'),
    pen: document.getElementById('tool-pen'),
    pin: document.getElementById('tool-pin'),
    eraser: document.getElementById('tool-eraser'),
    measure: document.getElementById('tool-measure'),
    route: document.getElementById('tool-route'),
  };
  const hint = document.getElementById('tool-hint');
  const measurePanel = document.getElementById('measure-panel');
  const routePanel = document.getElementById('route-panel');
  const HINTS = {
    pan: 'Drag to move, scroll to zoom.',
    pen: 'Drag to draw. The length of each line is shown at its end.',
    pin: 'Click to drop a labelled marker.',
    eraser: 'Drag over lines, pins or routes to remove them.',
    measure: 'Click points to measure a distance. Click the first point again (or Close) for a perimeter and area. Escape clears.',
    route: 'Click to add each node of the route. Backspace removes the last node, Escape clears. Save it to a layer when it is right.',
  };

  const selectTool = (name) => {
    MAP.setTool(name === 'pan' ? null : name);
    for (const [key, btn] of Object.entries(toolButtons)) {
      btn.classList.toggle('btn-active', key === name);
    }
    hint.textContent = HINTS[name] || '';
    measurePanel.hidden = name !== 'measure';
    routePanel.hidden = name !== 'route';
    if (name === 'measure') paintMeasure(MAP.measurement());
    if (name === 'route') paintRoute(MAP.routePlan());
  };
  for (const [name, btn] of Object.entries(toolButtons)) btn.onclick = () => selectTool(name);

  const G = window.vaultGeo;
  const readout = document.getElementById('map-readout');

  const paintMeasure = (m) => {
    if (!m || !m.points) {
      measurePanel.innerHTML = '<p class="faint" style="margin:0">Nothing measured yet.</p>';
      return;
    }
    measurePanel.innerHTML = `
      <div class="almanac-row"><span class="faint">${m.closed ? 'Perimeter' : 'Distance'}</span><span class="mono">${G.formatDistance(m.length)}</span></div>
      ${m.closed ? `<div class="almanac-row"><span class="faint">Area</span><span class="mono">${G.formatArea(m.area)} · ${(m.area / 4046.86).toLocaleString(undefined, { maximumFractionDigits: m.area < 4e5 ? 2 : 0 })} acres</span></div>` : ''}
      <div class="almanac-row"><span class="faint">Points</span><span class="mono">${m.points}</span></div>
      <div class="row" style="gap:6px;margin-top:8px">
        ${!m.closed && m.points >= 3 ? '<button class="btn btn-sm" id="measure-close">Close shape</button>' : ''}
        <button class="btn btn-sm" id="measure-clear">Clear</button>
      </div>`;
    const closeBtn = document.getElementById('measure-close');
    if (closeBtn) closeBtn.onclick = () => MAP.closeMeasure();
    document.getElementById('measure-clear').onclick = () => MAP.clearMeasure();
  };

  MAP.onMeasure = (metres, points, mode, m) => {
    if (readout) {
      if (points < 1) {
        readout.dataset.measure = '';
      } else {
        const label = mode === 'closed'
          ? `perimeter ${G.formatDistance(metres)} · ${G.formatArea(m.area)}`
          : `${mode === 'drawing' ? 'line' : 'distance'} ${G.formatDistance(metres)}`;
        readout.dataset.measure = label;
      }
      readout.textContent = readout.dataset.measure
        ? `${readout.dataset.measure}  ·  ${readout.dataset.position || ''}`
        : (readout.dataset.position || '—');
    }
    if (mode !== 'drawing') paintMeasure(m || MAP.measurement());
  };

  // Route planner: the legs read out as a table you could copy onto paper.
  const paintRoute = (plan) => {
    if (!plan.points.length) {
      routePanel.innerHTML = '<p class="faint" style="margin:0">Click the map to place the first node.</p>';
      return;
    }
    const rows = plan.legs.map((leg, i) => `
      <tr><td class="mono">${i + 1} → ${i + 2}</td>
          <td class="mono">${G.formatDistance(leg.distance)}</td>
          <td class="mono">${String(Math.round(leg.bearing)).padStart(3, '0')}° ${window.vaultAlmanac ? window.vaultAlmanac.compassPoint(leg.bearing) : ''}</td></tr>`).join('');
    const walking = plan.length / 5000; // hours at a steady 5 km/h on the flat
    routePanel.innerHTML = `
      <table class="route-table">
        <thead><tr><th>Leg</th><th>Distance</th><th>Bearing</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="faint">One node so far.</td></tr>'}</tbody>
      </table>
      <div class="almanac-row"><span class="faint">Total</span><span class="mono">${G.formatDistance(plan.length)}${plan.length > 500 ? ` · about ${window.vaultAlmanac ? window.vaultAlmanac.formatDuration(Math.round(walking * 60)) : Math.round(walking * 60) + ' min'} walking` : ''}</span></div>
      <div id="route-elevation"><div class="almanac-row"><span class="faint">Climb</span><span class="mono faint">…</span></div></div>
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
        <button class="btn btn-sm" id="route-undo" ${plan.points.length ? '' : 'disabled'}>Undo node</button>
        <button class="btn btn-sm" id="route-clear">Clear</button>
        <button class="btn btn-sm btn-primary" id="route-save" ${plan.points.length > 1 ? '' : 'disabled'}>Save route</button>
      </div>`;
    paintElevation(plan);
    document.getElementById('route-undo').onclick = () => MAP.undoRouteNode();
    document.getElementById('route-clear').onclick = () => MAP.clearRoute();
    document.getElementById('route-save').onclick = async () => {
      const name = prompt('Name this route (where to, and why):', '');
      if (name === null) return;
      const target = layers.find((l) => l.id === MAP.activeLayerId) || layers[0];
      if (!target) return;
      const saved = await api('maps/annotations/strokes', {
        method: 'POST',
        body: {
          layerId: target.id, type: 'route', name: name.trim(), colour: MAP.penColour, width: 3,
          points: plan.points, legs: plan.legs.map((l) => ({ distance: Math.round(l.distance), bearing: Math.round(l.bearing) })),
          length: plan.length,
        },
      });
      target.strokes.push(saved.stroke);
      MAP.setAnnotations(layers);
      MAP.clearRoute();
      paintLayers();
    };
  };
  MAP.onRoute = paintRoute;

  // Ask the server for heights along the route, if any terrain pack covers it.
  let elevationSeq = 0;
  const paintElevation = async (plan) => {
    const box = document.getElementById('route-elevation');
    if (!box) return;
    if (plan.points.length < 2) { box.innerHTML = ''; return; }
    const seq = ++elevationSeq;
    let profile;
    try {
      profile = await api('elevation/profile', { method: 'POST', body: { points: plan.points } });
    } catch {
      profile = null;
    }
    if (seq !== elevationSeq || !document.getElementById('route-elevation')) return;
    if (!profile || !profile.coverage) {
      box.innerHTML = '<div class="almanac-row"><span class="faint">Climb</span><span class="mono faint" title="No terrain pack covers this route. Setup → Satellite &amp; terrain.">no heights here</span></div>';
      return;
    }
    const partial = profile.coverage < 0.98 ? ` <span class="faint">(${Math.round(profile.coverage * 100)}% covered)</span>` : '';
    box.innerHTML = `
      <div class="almanac-row"><span class="faint">Climb</span><span class="mono">+${profile.gain} m · −${profile.loss} m${partial}</span></div>
      <div class="almanac-row"><span class="faint">Highest · lowest</span><span class="mono">${profile.highest} m · ${profile.lowest} m</span></div>
      <canvas class="route-profile" id="route-profile" width="300" height="70"></canvas>`;
    drawProfile(document.getElementById('route-profile'), profile);
    // Naismith: add an hour for every 600 m of climb.
    const total = document.querySelector('#route-panel .almanac-row .mono');
    if (total && profile.gain) total.insertAdjacentHTML('beforeend', ` <span class="faint">+${Math.round(profile.gain / 10)} min for the climb</span>`);
  };

  const drawProfile = (canvas, profile) => {
    const ratio = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 300;
    const cssH = 70;
    canvas.width = cssW * ratio; canvas.height = cssH * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    const pts = profile.samples.filter((p) => p.metres !== null);
    if (pts.length < 2) return;
    const maxD = profile.samples[profile.samples.length - 1].distance || 1;
    const lo = profile.lowest;
    const hi = Math.max(profile.highest, lo + 10);
    const x = (d) => 4 + (d / maxD) * (cssW - 8);
    const y = (m) => cssH - 14 - ((m - lo) / (hi - lo)) * (cssH - 24);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e3b341';
    const faint = getComputedStyle(document.documentElement).getPropertyValue('--text-faint').trim() || '#888';
    ctx.beginPath();
    ctx.moveTo(x(pts[0].distance), cssH - 14);
    for (const p of pts) ctx.lineTo(x(p.distance), y(p.metres));
    ctx.lineTo(x(pts[pts.length - 1].distance), cssH - 14);
    ctx.closePath();
    ctx.fillStyle = accent; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath();
    for (const p of pts) ctx.lineTo(x(p.distance), y(p.metres));
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = faint;
    ctx.font = '10px system-ui, sans-serif';
    for (const p of profile.samples) {
      if (p.node === null || p.metres === null) continue;
      ctx.beginPath(); ctx.arc(x(p.distance), y(p.metres), 2.5, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
      ctx.fillStyle = faint;
      ctx.fillText(String(p.node + 1), x(p.distance) - 3, cssH - 3);
    }
    ctx.textAlign = 'right';
    ctx.fillText(`${hi} m`, cssW - 2, 10);
    ctx.fillText(`${lo} m`, cssW - 2, cssH - 16);
  };

  selectTool('pan');

  document.addEventListener('keydown', (e) => {
    if (!MAP || !document.getElementById('map-canvas')) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (e.key === 'Escape' && MAP.drawMode === 'measure') MAP.clearMeasure();
    if (e.key === 'Escape' && MAP.drawMode === 'route') MAP.clearRoute();
    if (e.key === 'Backspace' && MAP.drawMode === 'route' && !typing) { e.preventDefault(); MAP.undoRouteNode(); }
  });

  MAP.onPin = async (position) => {
    const label = prompt('Label for this pin (what is here?):');
    if (label === null) return;
    const target = layers.find((l) => l.id === MAP.activeLayerId) || layers[0];
    if (!target) return;
    const saved = await api('maps/annotations/strokes', {
      method: 'POST',
      body: { layerId: target.id, type: 'pin', lon: position.lon, lat: position.lat, label: label.trim(), colour: MAP.penColour },
    });
    target.strokes.push(saved.stroke);
    MAP.setAnnotations(layers);
    paintLayers();
  };

  swatches.innerHTML = PEN_COLOURS.map((colour, i) => `
    <button class="swatch${i === 0 ? ' selected' : ''}" data-colour="${colour}"
      style="background:${colour}" title="${colour}"></button>`).join('');
  for (const swatch of swatches.querySelectorAll('.swatch')) {
    swatch.onclick = () => {
      MAP.penColour = swatch.dataset.colour;
      swatches.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
      swatch.classList.add('selected');
    };
  }

  sizes.innerHTML = PEN_WIDTHS.map((width, i) => `
    <button class="pen-size${i === 1 ? ' selected' : ''}" data-width="${width}" title="${width}px">
      <i style="width:${width + 2}px;height:${width + 2}px"></i>
    </button>`).join('');
  MAP.penWidth = PEN_WIDTHS[1];
  for (const button of sizes.querySelectorAll('.pen-size')) {
    button.onclick = () => {
      MAP.penWidth = Number(button.dataset.width);
      sizes.querySelectorAll('.pen-size').forEach((b) => b.classList.remove('selected'));
      button.classList.add('selected');
    };
  }

  // Which layers are unfolded to show their marks; per browser.
  let openLayers = new Set();
  try { openLayers = new Set(JSON.parse(localStorage.getItem('vault.openLayers') || '[]')); } catch { openLayers = new Set(); }

  const describeMark = (mark) => {
    if (mark.type === 'pin') return { glyph: '⌖', text: mark.label || 'Pin', sub: '' };
    if (mark.type === 'route') return { glyph: '↝', text: mark.name || 'Route', sub: `${mark.points.length} nodes · ${window.vaultGeo.formatDistance(mark.length || 0)}` };
    return { glyph: '〰', text: 'Line', sub: mark.length ? window.vaultGeo.formatDistance(mark.length) : `${mark.points.length} points` };
  };

  const paintLayers = () => {
    layerList.innerHTML = layers.map((layer) => `
      <div class="layer-row">
        <input type="checkbox" class="layer-visible" data-id="${esc(layer.id)}" ${layer.visible ? 'checked' : ''} title="Show this layer">
        <input type="radio" name="active-layer" class="layer-active" data-id="${esc(layer.id)}"
          ${layer.id === MAP.activeLayerId ? 'checked' : ''} title="Draw into this layer">
        <button class="layer-name layer-toggle" data-id="${esc(layer.id)}" title="Show what is in this layer">${openLayers.has(layer.id) ? '▾' : '▸'} ${esc(layer.name)}</button>
        <span class="faint">${layer.strokes.length}</span>
        ${layers.length > 1 ? `<button class="btn btn-sm layer-delete" data-id="${esc(layer.id)}" title="Delete layer">×</button>` : ''}
      </div>
      ${openLayers.has(layer.id) ? `<div class="mark-list">
        ${layer.strokes.length ? layer.strokes.map((mark) => {
          const d = describeMark(mark);
          return `<div class="mark-row">
            <span class="mark-glyph" style="color:${esc(mark.colour || '#f85149')}">${d.glyph}</span>
            <span class="mark-text">${esc(d.text)}${d.sub ? ` <span class="faint">${esc(d.sub)}</span>` : ''}</span>
            <button class="btn btn-sm mark-goto" data-id="${esc(mark.id)}" title="Centre the map on it">→</button>
            <button class="btn btn-sm mark-delete" data-id="${esc(mark.id)}" title="Delete this mark">×</button>
          </div>`;
        }).join('') : '<p class="faint" style="margin:2px 0 6px 10px">Nothing drawn in this layer yet.</p>'}
      </div>` : ''}`).join('');

    for (const button of layerList.querySelectorAll('.layer-toggle')) {
      button.onclick = () => {
        if (openLayers.has(button.dataset.id)) openLayers.delete(button.dataset.id); else openLayers.add(button.dataset.id);
        try { localStorage.setItem('vault.openLayers', JSON.stringify([...openLayers])); } catch { /* fine */ }
        paintLayers();
      };
    }
    const findMark = (id) => {
      for (const layer of layers) { const m = layer.strokes.find((s) => s.id === id); if (m) return { layer, mark: m }; }
      return null;
    };
    for (const button of layerList.querySelectorAll('.mark-goto')) {
      button.onclick = () => {
        const found = findMark(button.dataset.id);
        if (!found) return;
        const { mark } = found;
        if (mark.type === 'pin') { MAP.goTo(mark.lon, mark.lat, Math.max(MAP.zoom, 13)); return; }
        const lons = mark.points.map((p) => p[0]);
        const lats = mark.points.map((p) => p[1]);
        MAP.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]);
      };
    }
    for (const button of layerList.querySelectorAll('.mark-delete')) {
      button.onclick = async () => {
        const found = findMark(button.dataset.id);
        if (!found) return;
        const d = describeMark(found.mark);
        if (!confirm(`Delete ${d.text}${d.sub ? ' (' + d.sub + ')' : ''}?`)) return;
        await api('maps/annotations/strokes/delete', { method: 'POST', body: { strokeIds: [found.mark.id] } });
        found.layer.strokes = found.layer.strokes.filter((s) => s.id !== found.mark.id);
        MAP.setAnnotations(layers);
        paintLayers();
      };
    }

    for (const box of layerList.querySelectorAll('.layer-visible')) {
      box.onchange = () => {
        const layer = layers.find((l) => l.id === box.dataset.id);
        if (layer) layer.visible = box.checked;
        MAP.setAnnotations(layers);
      };
    }
    for (const radio of layerList.querySelectorAll('.layer-active')) {
      radio.onchange = () => { MAP.activeLayerId = radio.dataset.id; };
    }
    for (const button of layerList.querySelectorAll('.layer-delete')) {
      button.onclick = async () => {
        if (!confirm('Delete this layer and everything drawn on it?')) return;
        const result = await api(`maps/annotations/layers/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
        layers = result.layers;
        if (!layers.find((l) => l.id === MAP.activeLayerId)) MAP.activeLayerId = layers[0]?.id || null;
        MAP.setAnnotations(layers);
        paintLayers();
      };
    }
  };
  paintLayers();

  document.getElementById('add-layer').onclick = async () => {
    const name = prompt('Name this layer (routes, hazards, water, whatever you need):');
    if (!name) return;
    const result = await api('maps/annotations/layers', { method: 'POST', body: { name } });
    layers = result.layers;
    MAP.activeLayerId = result.id;
    MAP.setAnnotations(layers);
    paintLayers();
  };

  document.getElementById('map-show-ann').onchange = (e) => {
    MAP.showAnnotations = e.target.checked;
    MAP.draw();
  };

  MAP.onStroke = async (stroke) => {
    const target = layers.find((l) => l.id === MAP.activeLayerId) || layers[0];
    if (!target) return;
    const saved = await api('maps/annotations/strokes', {
      method: 'POST',
      body: { layerId: target.id, ...stroke },
    });
    target.strokes.push(saved.stroke);
    MAP.setAnnotations(layers);
    paintLayers();
  };

  MAP.onErase = async (strokeIds) => {
    await api('maps/annotations/strokes/delete', { method: 'POST', body: { strokeIds } });
    const gone = new Set(strokeIds);
    for (const layer of layers) layer.strokes = layer.strokes.filter((s) => !gone.has(s.id));
    MAP.setAnnotations(layers);
    paintLayers();
  };
}


// ------------------------------------------------------------ print view

/** Wrap rendered prose with a print button and a footer that only prints. */
function printable(breadcrumbHtml, articleHtml, sourceLabel) {
  return `
    <div class="row-between print-bar">
      <p class="faint" style="margin:0">${breadcrumbHtml}</p>
      <button class="btn btn-sm" onclick="window.print()" title="Print this page, or save it as a PDF">Print</button>
    </div>
    <article class="prose">${articleHtml}</article>
    <p class="print-footer">From the Vault · ${esc(sourceLabel)} · printed ${new Date().toLocaleDateString()} · verify anything that matters against a second source.</p>
  `;
}

// ------------------------------------------------------------------ comms

async function renderComms() {
  setBusy('Opening the channel…');
  let channel = localStorage.getItem('vault.channel') || 'general';
  let data = await api(`comms?channel=${encodeURIComponent(channel)}`);

  const paint = () => {
    view.innerHTML = `
      <h1>Outpost comms</h1>
      <p class="lede">Messages stay on this machine and reach everyone on this network. No internet,
      no accounts, nobody in the middle. Anyone who can open the vault can read and post.</p>

      <div class="channel-row" id="channels">
        ${data.channels.map((c) => `
          <button class="btn btn-sm channel-btn${c === channel ? ' btn-active' : ''}" data-channel="${esc(c)}">#${esc(c)}</button>
        `).join('')}
        <button class="btn btn-sm" id="new-channel">+ channel</button>
      </div>

      <div class="chat-shell">
        <div class="chat-log" id="chat-log"></div>
        <form class="chat-form" id="chat-form">
          <input id="chat-text" placeholder="Message #${esc(channel)}…" autocomplete="off" maxlength="2000">
          <button class="btn btn-primary" type="submit">Send</button>
        </form>
      </div>

      <p class="faint" style="margin-top:12px">
        Posting as <strong>${esc(profileName())}</strong>. Change profile in the sidebar.
        Setting up a network to run this over is covered in
        <a href="#/handbook/comms/mesh-networks">the handbook</a>.
      </p>
    `;

    paintLog();

    for (const btn of view.querySelectorAll('.channel-btn')) {
      btn.onclick = async () => {
        channel = btn.dataset.channel;
        localStorage.setItem('vault.channel', channel);
        data = await api(`comms?channel=${encodeURIComponent(channel)}`);
        paint();
      };
    }

    document.getElementById('new-channel').onclick = async () => {
      const name = prompt('Channel name (letters, numbers and dashes):');
      if (!name) return;
      const result = await api('comms/channels', { method: 'POST', body: { name } });
      data.channels = result.channels;
      paint();
    };

    document.getElementById('chat-form').onsubmit = async (e) => {
      e.preventDefault();
      const input = document.getElementById('chat-text');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      const { message } = await api('comms', {
        method: 'POST',
        body: { channel, text, author: profileName() },
      });
      data.messages.push(message);
      paintLog();
    };
  };

  const paintLog = () => {
    const log = document.getElementById('chat-log');
    if (!log) return;
    const pinned = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;

    log.innerHTML = data.messages.length ? data.messages.map((m) => `
      <div class="chat-msg">
        <div class="chat-meta">
          <span class="chat-author">${esc(m.author)}</span>
          · ${new Date(m.at).toLocaleString()}
        </div>
        <p class="chat-body">${esc(m.text)}</p>
      </div>
    `).join('') : '<p class="faint">Nothing here yet. Say something.</p>';

    if (pinned) log.scrollTop = log.scrollHeight;
  };

  paint();

  // Poll for anyone else's messages. Crude, robust, and fine on a LAN.
  pollTimer = setInterval(async () => {
    if (!document.getElementById('chat-log')) return stopPolling();
    const since = data.messages.length ? data.messages[data.messages.length - 1].at : 0;
    const update = await api(`comms?channel=${encodeURIComponent(channel)}&since=${since}`);
    if (update.messages.length) {
      data.messages.push(...update.messages);
      paintLog();
    }
  }, 3000);
}

// ----------------------------------------------------------------- manual

async function renderManual() {
  setBusy();
  const { pages } = await api('manual');

  view.innerHTML = `
    <h1>The manual</h1>
    <p class="lede">How the vault works, how it was built, and how to keep it alive. Written on the
    assumption that one day the person reading it will not be the person who made it.</p>
    ${pages.length === 0 ? '<div class="empty">No manual pages installed.</div>' : pages.map((page) => `
      <a class="card card-link" href="#/manual/${encodeURIComponent(page.slug)}">
        <strong>${esc(page.title)}</strong>
        ${page.summary ? `<p class="faint" style="margin:6px 0 0">${esc(page.summary)}</p>` : ''}
      </a>
    `).join('')}
  `;
}

async function renderManualPage(slug) {
  setBusy();
  const page = await api(`manual/${encodeURIComponent(slug)}`);
  view.innerHTML = printable(`<a href="#/manual">Manual</a>`, page.html, `Manual · ${page.title}`);
}

// ----------------------------------------------------------------- school

// Lessons are written in key stages; the page shows them in that order so a
// parent can see the road, not just a list.
const STAGE_ORDER = ['Guide', 'KS1', 'KS2', 'KS3', 'Core'];
const STAGE_LABELS = { Guide: 'Start here', KS1: 'Key Stage 1 — ages 5 to 7', KS2: 'Key Stage 2 — ages 7 to 11', KS3: 'Key Stage 3 — ages 11 to 14', Core: 'Core' };
function groupByStage(lessons) {
  const groups = new Map();
  for (const l of lessons) { const k = l.stage || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
  const rank = (k) => { const i = STAGE_ORDER.indexOf(k); return i < 0 ? 99 : i; };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
}

// The Answers section of a lesson is folded away so the child works first
// and the adult checks after.
function foldAnswers(html) {
  const box = document.createElement('div');
  box.innerHTML = html;
  for (const h of [...box.querySelectorAll('h2')]) {
    if (!/^answers/i.test(h.textContent.trim())) continue;
    const details = document.createElement('details');
    details.className = 'answers';
    const summary = document.createElement('summary');
    summary.textContent = h.textContent;
    details.appendChild(summary);
    let node = h.nextSibling;
    while (node && !(node.nodeType === 1 && /^H[12]$/.test(node.tagName))) { const next = node.nextSibling; details.appendChild(node); node = next; }
    h.replaceWith(details);
  }
  return box.innerHTML;
}

async function renderSchool() {
  setBusy();
  const { subjects } = await api(`school?profile=${encodeURIComponent(PROFILE)}`);
  const allLessons = subjects.flatMap((s) => s.lessons);
  const doneCount = allLessons.filter((l) => l.done).length;

  view.innerHTML = `
    <h1>School</h1>
    <p class="lede">A curriculum that does not need a teacher, a server or a signal. Progress is tracked per person — switch profile in the sidebar.</p>
    ${allLessons.length ? `<div class="progress" style="height:8px"><div style="width:${(doneCount / allLessons.length) * 100}%"></div></div>
    <p class="faint" style="margin:4px 0 24px">${doneCount} of ${allLessons.length} lessons complete for ${esc(profileName())}</p>` : ''}

    ${subjects.length === 0 ? '<div class="empty">No curriculum installed yet.</div>' : subjects.map((subject) => `
      <h2>${esc(subject.title)}</h2>
      ${subject.summary ? `<p class="muted" style="margin:-6px 0 12px">${esc(subject.summary)}</p>` : ''}
      ${groupByStage(subject.lessons).map(([stage, lessons]) => `
        ${stage ? `<h3 class="stage-heading">${esc(STAGE_LABELS[stage] || stage)}</h3>` : ''}
        ${lessons.map((lesson) => `
          <a class="card card-link" href="#/school/${encodeURIComponent(lesson.id)}">
            <div class="row-between">
              <strong>${lesson.done ? '✓ ' : ''}${esc(lesson.title)}</strong>
              ${lesson.ages ? `<span class="tag">ages ${esc(lesson.ages)}</span>` : ''}
            </div>
            ${lesson.summary ? `<p class="faint" style="margin:6px 0 0">${esc(lesson.summary)}</p>` : ''}
          </a>
        `).join('')}
      `).join('')}
    `).join('')}
  `;
}

async function renderLesson(id) {
  setBusy();
  const lesson = await api(`school/${id.split('/').map(encodeURIComponent).join('/')}`);
  const { subjects } = await api(`school?profile=${encodeURIComponent(PROFILE)}`);
  const done = subjects.flatMap((s) => s.lessons).find((l) => l.id === lesson.id)?.done || false;

  view.innerHTML = printable(
    `<a href="#/school">School</a> · ${esc(lesson.subjectTitle)}${lesson.ages ? ` · ages ${esc(lesson.ages)}` : ''}`,
    foldAnswers(lesson.html),
    `School · ${lesson.subjectTitle} · ${lesson.title}`
  ) + `
    <div class="card" style="margin-top:32px">
      <label class="checkbox-row">
        <input type="checkbox" id="lesson-done" ${done ? 'checked' : ''}>
        <span>Mark complete for <strong>${esc(profileName())}</strong></span>
      </label>
    </div>
  `;

  document.getElementById('lesson-done').onchange = (e) => api('school/progress', {
    method: 'POST',
    body: { profile: PROFILE, lessonId: lesson.id, completed: e.target.checked },
  });
}

// --------------------------------------------------------- document reader

async function renderDocument(docId, unitStr) {
  setBusy('Opening the book…');
  const doc = await api(`docs/${encodeURIComponent(docId)}`);
  let current = unitStr !== undefined ? Number(unitStr) : 0;
  if (!Number.isInteger(current) || current < 0) current = 0;

  // A PDF can be shown two ways: the browser's own viewer (the real pages,
  // but it needs the whole file and phones cannot do it inline) or the text
  // of one page at a time. Text is the default wherever inline PDF is not
  // available, and a toggle switches at will.
  const canShowPdf = doc.type !== 'pdf' || navigator.pdfViewerEnabled !== false;
  let textMode = doc.type === 'pdf' && (!canShowPdf || localStorage.getItem('vault.pdfText') === '1');
  const frameSrc = (index) => (doc.type === 'pdf'
    ? (textMode ? `/doc/${encodeURIComponent(docId)}/page/${index}` : `/doc/${encodeURIComponent(docId)}/file#page=${index + 1}`)
    : `/doc/${encodeURIComponent(docId)}/chapter/${index}`);

  view.innerHTML = `
    <div class="reader-bar">
      <button class="btn btn-sm" id="doc-prev" title="Previous ${esc(doc.unitLabel)}">←</button>
      <button class="btn btn-sm" id="doc-next" title="Next ${esc(doc.unitLabel)}">→</button>
      <span class="reader-title" id="doc-title"></span>
      <span class="spacer"></span>
      <button class="btn btn-sm" id="doc-toc">Contents</button>
      ${doc.type === 'pdf' && canShowPdf ? `<button class="btn btn-sm" id="doc-mode" title="Switch between the page as printed and its text">${textMode ? 'Show pages' : 'Show text'}</button>` : ''}
      <a class="btn btn-sm" href="#/library">Library</a>
      <a class="btn btn-sm" href="/doc/${encodeURIComponent(docId)}/file" target="_blank" rel="noreferrer">Open file</a>
    </div>

    <div class="doc-layout">
      <nav class="doc-outline" id="doc-outline" hidden>
        <p class="faint" style="margin:0 0 8px">${esc(doc.title)}${doc.author ? ` · ${esc(doc.author)}` : ''}</p>
        ${doc.units.map((u) => `
          <a class="doc-outline-item" data-index="${u.index}" href="#/doc/${encodeURIComponent(docId)}/${u.index}">
            <span class="faint mono">${String(u.index + 1).padStart(3)}</span> ${esc(u.title)}
          </a>`).join('')}
      </nav>
      <iframe class="reader-frame doc-frame" id="doc-frame" title="${esc(doc.title)}"></iframe>
    </div>
  `;

  const frame = document.getElementById('doc-frame');
  const outline = document.getElementById('doc-outline');
  const titleEl = document.getElementById('doc-title');

  // The browser's PDF viewer will not run inside a sandbox; HTML pages
  // (EPUB chapters, page text) are sandboxed so nothing in them can run.
  const applySandbox = () => {
    if (doc.type === 'pdf' && !textMode) frame.removeAttribute('sandbox');
    else frame.setAttribute('sandbox', 'allow-same-origin allow-popups');
  };

  const show = (index) => {
    current = Math.max(0, Math.min(doc.units.length - 1, index));
    const unit = doc.units[current];
    titleEl.textContent = doc.units.length > 1 ? `${unit.title}  ·  ${current + 1} / ${doc.units.length}` : doc.title;
    applySandbox();
    frame.src = frameSrc(current);
    history.replaceState(null, '', `#/doc/${encodeURIComponent(docId)}/${current}`);
    for (const item of outline.querySelectorAll('.doc-outline-item')) {
      item.classList.toggle('active', Number(item.dataset.index) === current);
    }
    document.getElementById('doc-prev').disabled = current === 0;
    document.getElementById('doc-next').disabled = current >= doc.units.length - 1;
  };

  document.getElementById('doc-prev').onclick = () => show(current - 1);
  document.getElementById('doc-next').onclick = () => show(current + 1);
  document.getElementById('doc-toc').onclick = () => { outline.hidden = !outline.hidden; };
  const modeBtn = document.getElementById('doc-mode');
  if (modeBtn) modeBtn.onclick = () => {
    textMode = !textMode;
    try { localStorage.setItem('vault.pdfText', textMode ? '1' : '0'); } catch { /* fine */ }
    modeBtn.textContent = textMode ? 'Show pages' : 'Show text';
    show(current);
  };
  for (const item of outline.querySelectorAll('.doc-outline-item')) {
    item.onclick = (e) => { e.preventDefault(); show(Number(item.dataset.index)); outline.hidden = true; };
  }

  document.onkeydown = (e) => {
    if (!location.hash.startsWith('#/doc/')) { document.onkeydown = null; return; }
    if (e.target.tagName === 'INPUT') return;
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); show(current - 1); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); show(current + 1); }
  };

  // Show the contents first for a book with real chapters; a PDF opens straight in.
  if (doc.type !== 'pdf' && unitStr === undefined && doc.units.length > 3) outline.hidden = false;
  show(current);
}

// ------------------------------------------------------------ pack reader

async function renderPack(packId) {
  setBusy();
  const pack = await api(`library/${encodeURIComponent(packId)}`);

  view.innerHTML = `
    <div class="row-between">
      <h1 style="margin:0">${esc(pack.title)}</h1>
      ${ageBadge(pack.ageDays)}
    </div>
    <p class="faint" style="margin:8px 0 20px">
      Cloned ${esc(pack.date || 'unknown')} · ${esc(pack.sizeHuman)} · ${pack.entryCount.toLocaleString()} entries
    </p>

    <form class="row" id="pack-search" style="margin-bottom:16px">
      <input id="pack-q" class="btn" style="flex:1;min-width:200px;text-align:left" placeholder="Search article titles…" autofocus>
      <button class="btn btn-primary" type="submit">Search</button>
      <button class="btn" type="button" id="random-btn">Random</button>
    </form>
    <div id="pack-results"><p class="faint">Type a topic. Titles are indexed, so this stays instant however large the pack is.</p></div>
  `;

  const input = document.getElementById('pack-q');
  const results = document.getElementById('pack-results');

  const run = async () => {
    const query = input.value.trim();
    if (!query) return;
    results.innerHTML = '<div class="loading">Searching…</div>';
    const data = await api(`packs/${encodeURIComponent(packId)}/search?q=${encodeURIComponent(query)}`);
    results.innerHTML = data.results.length ? data.results.map((hit) => `
      <div class="result">
        <a href="#/read/${encodeURIComponent(packId)}/${encodeURIComponent(hit.url)}">${esc(hit.title)}</a>
      </div>
    `).join('') : '<div class="empty">No titles matched.</div>';
  };

  document.getElementById('pack-search').onsubmit = (e) => { e.preventDefault(); run(); };
  document.getElementById('random-btn').onclick = async () => {
    const hit = await api(`packs/${encodeURIComponent(packId)}/random`);
    location.hash = `#/read/${encodeURIComponent(packId)}/${encodeURIComponent(hit.url)}`;
  };
}

async function renderArticle(packId, articleUrl) {
  const src = `/z/${encodeURIComponent(packId)}/C/${articleUrl.split('/').map(encodeURIComponent).join('/')}`;

  view.innerHTML = `
    <div class="reader-bar">
      <button class="btn btn-sm" id="art-back" title="Previous article (Alt+←)" disabled>←</button>
      <button class="btn btn-sm" id="art-fwd" title="Next article (Alt+→)" disabled>→</button>
      <span class="reader-title" id="art-title">Loading…</span>
      <span class="spacer"></span>
      <a class="btn btn-sm" href="#/read/${encodeURIComponent(packId)}">Search</a>
      <a class="btn btn-sm" href="${src}" target="_blank" rel="noreferrer">Full page</a>
    </div>
    <iframe class="reader-frame" id="art-frame" src="${src}" title="Article" sandbox="allow-same-origin allow-popups"></iframe>
  `;

  const frame = document.getElementById('art-frame');
  const backBtn = document.getElementById('art-back');
  const fwdBtn = document.getElementById('art-fwd');
  const titleEl = document.getElementById('art-title');

  // The iframe keeps its own history as you follow links between articles, so
  // "back" means stepping through that rather than leaving the reader. We track
  // depth ourselves because cross-document history length is not readable.
  let depth = 0;
  let maxDepth = 0;
  let firstLoad = true;

  const updateButtons = () => {
    backBtn.disabled = depth <= 0;
    fwdBtn.disabled = depth >= maxDepth;
    updateNavButtons();
  };

  frame.addEventListener('load', () => {
    if (firstLoad) {
      firstLoad = false;
    } else {
      // A navigation we did not initiate is a link click: it truncates any
      // forward history, exactly as a browser does.
      if (!frame.dataset.moving) {
        depth += 1;
        maxDepth = depth;
      }
      delete frame.dataset.moving;
    }

    try {
      const doc = frame.contentDocument;
      titleEl.textContent = (doc && doc.title) || 'Article';

      // Keep the address bar honest without re-rendering the view.
      const path = frame.contentWindow.location.pathname;
      const marker = `/z/${encodeURIComponent(packId)}/C/`;
      if (path.startsWith(marker)) {
        const current = decodeURIComponent(path.slice(marker.length));
        history.replaceState(null, '', `#/read/${encodeURIComponent(packId)}/${encodeURIComponent(current)}`);
      }
    } catch {
      titleEl.textContent = 'Article';
    }

    updateButtons();
  });

  const go = (delta) => {
    const next = depth + delta;
    if (next < 0 || next > maxDepth) return;
    depth = next;
    frame.dataset.moving = '1';
    frame.contentWindow.history.go(delta);
  };

  backBtn.onclick = () => go(-1);
  fwdBtn.onclick = () => go(1);

  // The global back/forward bar steps through articles first, then pages.
  window.vaultReader = { go, canBack: () => depth > 0, canForward: () => depth < maxDepth };

  updateButtons();
}

// ----------------------------------------------------------------- search

async function renderSearch(params) {
  const query = params.get('q') || '';
  searchInput.value = query;
  if (!query.trim()) {
    view.innerHTML = '<div class="empty">Type something to search.</div>';
    return;
  }

  setBusy(`Searching for “${query}”…`);
  const data = await api(`search?q=${encodeURIComponent(query)}`);

  const section = (title, items, render) => items.length
    ? `<h2>${title}</h2>${items.map(render).join('')}`
    : '';

  view.innerHTML = `
    <h1>“${esc(query)}”</h1>
    <p class="lede">${data.total} result${data.total === 1 ? '' : 's'} across the handbook, school and your packs.</p>
    ${section('Handbook, school and languages', data.content, (hit) => `
      <div class="result">
        <a href="${esc(hit.href)}">${esc(hit.title)}</a>
        <span class="faint"> · ${esc(hit.context)}</span>
        ${hit.snippet ? `<p class="snippet">${esc(hit.snippet)}</p>` : ''}
      </div>`)}
    ${section('Books and documents', data.documents || [], (hit) => `
      <div class="result">
        <a href="${esc(hit.href)}">${esc(hit.title)}</a>
        <span class="faint"> · ${esc(hit.context)}</span>
        ${hit.snippet ? `<p class="snippet">${esc(hit.snippet)}</p>` : ''}
      </div>`)}
    ${section('Encyclopedia packs', data.packs, (hit) => `
      <div class="result">
        <a href="${esc(hit.href)}">${esc(hit.title)}</a>
        <span class="faint"> · ${esc(hit.context)}</span>
      </div>`)}
    ${data.total === 0 ? '<div class="empty">Nothing found. Try a shorter or more common word.</div>' : ''}
  `;
}

// --------------------------------------------------------------- profiles

function profileName() {
  return STATUS?.profiles.find((p) => p.id === PROFILE)?.name || 'Everyone';
}

async function loadProfiles() {
  const { profiles } = await api('profiles');
  if (STATUS) STATUS.profiles = profiles;
  profileSelect.innerHTML = profiles.map((p) =>
    `<option value="${esc(p.id)}"${p.id === PROFILE ? ' selected' : ''}>${esc(p.name)}</option>`
  ).join('') + '<option value="__new">+ Add person…</option>';
}

profileSelect.onchange = async () => {
  if (profileSelect.value === '__new') {
    const name = prompt('Name for the new profile (each person gets their own progress):');
    if (name) {
      await api('profiles', { method: 'POST', body: { name } });
      PROFILE = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      localStorage.setItem('vault.profile', PROFILE);
    }
    await loadProfiles();
    profileSelect.value = PROFILE;
  } else {
    PROFILE = profileSelect.value;
    localStorage.setItem('vault.profile', PROFILE);
  }
  route();
};

searchForm.onsubmit = (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (query) location.hash = `#/search?q=${encodeURIComponent(query)}`;
};

// ------------------------------------------------------------------- boot

window.addEventListener('hashchange', route);

(async () => {
  try {
    STATUS = await api('status');
    const creditEl = document.getElementById('footer-credit-name');
    if (creditEl && STATUS.credit) { creditEl.innerHTML = `Prepared by <strong>${esc(STATUS.credit)}</strong>.`; }
    await loadProfiles();
  } catch {
    footerStatus.textContent = 'Could not reach the Vault server.';
  }
  route();
})();
