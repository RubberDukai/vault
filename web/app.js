'use strict';
/* Ark front end. No framework, no build step — open the folder in ten years
   and it still runs. Hash routing so it works from a file server or a socket. */

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
const profileSelect = document.getElementById('profile');
const searchForm = document.getElementById('global-search');
const searchInput = document.getElementById('q');
const footerStatus = document.getElementById('footer-status');

let PROFILE = localStorage.getItem('ark.profile') || 'default';
let STATUS = null;
let pollTimer = null;

// ------------------------------------------------------------------ utils

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

async function api(path, options) {
  const res = await fetch(`/api/${path}`, {
    headers: { 'content-type': 'application/json' },
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
  [/^\/get$/, renderGetPacks],
  [/^\/handbook$/, renderHandbook],
  [/^\/handbook\/(.+)$/, renderChapter],
  [/^\/languages$/, renderLanguages],
  [/^\/study(?:\/(.+))?$/, renderStudy],
  [/^\/maps$/, renderMaps],
  [/^\/school$/, renderSchool],
  [/^\/school\/(.+)$/, renderLesson],
  [/^\/read\/([^/]+)$/, renderPack],
  [/^\/read\/([^/]+)\/(.+)$/, renderArticle],
  [/^\/search$/, renderSearch],
];

async function route() {
  stopPolling();
  const raw = location.hash.slice(1) || '/';
  const [pathname, queryString] = raw.split('?');
  const params = new URLSearchParams(queryString || '');

  for (const link of tabs.querySelectorAll('a')) {
    link.classList.toggle('active', new RegExp(link.dataset.match).test(`#${pathname}`));
  }

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

// ------------------------------------------------------------------- home

async function renderHome() {
  setBusy('Opening the vault…');
  const [status, library] = await Promise.all([api('status'), api('library')]);
  STATUS = status;

  const packs = library.packs;
  const stale = packs.filter((p) => p.ok && p.ageDays !== null && p.ageDays > 365);

  view.innerHTML = `
    <h1>The vault is open</h1>
    <p class="lede">Everything below works with no internet connection. ${
      packs.length === 0 ? 'You have no knowledge packs yet — start there.' : ''
    }</p>

    <div class="stat-row">
      <div class="stat"><div class="stat-value">${packs.filter((p) => p.ok).length}</div><div class="stat-label">Packs</div></div>
      <div class="stat"><div class="stat-value">${status.librarySize}</div><div class="stat-label">On disk</div></div>
      <div class="stat"><div class="stat-value">${status.content.chapters}</div><div class="stat-label">Chapters</div></div>
      <div class="stat"><div class="stat-value">${status.content.cards}</div><div class="stat-label">Cards</div></div>
      <div class="stat"><div class="stat-value">${status.content.lessons}</div><div class="stat-label">Lessons</div></div>
    </div>

    ${stale.length ? `<div class="card" style="border-color:#4a3711">
      <strong>${stale.length} pack${stale.length > 1 ? 's are' : ' is'} over a year old.</strong>
      <p class="muted" style="margin:6px 0 10px">Worth refreshing while you still can.</p>
      <a class="btn btn-sm" href="#/library">Check for updates</a>
    </div>` : ''}

    ${packs.length === 0 ? `<div class="empty">
      <p>No knowledge packs in the library yet.</p>
      <a class="btn btn-primary" href="#/get">Get your first pack</a>
    </div>` : `<h2>Your knowledge packs</h2>${packs.map(packCard).join('')}`}

    <h2>The handbook</h2>
    <div class="grid" id="home-modules"></div>
  `;

  const handbook = await api('handbook');
  document.getElementById('home-modules').innerHTML = handbook.modules.map((mod) => `
    <a class="card card-link" href="#/handbook">
      <div class="row" style="gap:8px"><strong>${esc(mod.title)}</strong></div>
      <p class="faint" style="margin:6px 0 0">${esc(mod.summary || `${mod.chapters.length} chapters`)}</p>
    </a>
  `).join('') || '<div class="empty">No handbook content yet.</div>';

  footerStatus.textContent = `Ark · reachable at ${status.addresses.join('  ·  ')}`;
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

    <div id="pack-list">${packs.length ? packs.map(libraryRow).join('') : '<div class="empty">No .zim packs found.<br><a class="btn btn-primary" href="#/get" style="margin-top:12px">Get packs</a></div>'}</div>

    <h2>Downloads</h2>
    <div id="download-list"><p class="faint">Nothing downloading.</p></div>
  `;

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

// -------------------------------------------------------------- get packs

async function renderGetPacks() {
  view.innerHTML = `
    <h1>Get packs</h1>
    <p class="lede">Searches the Kiwix catalogue. This is the one screen that needs the internet — use it while you have it.</p>
    <form class="row" id="catalog-form" style="margin-bottom:20px">
      <input id="catalog-q" class="btn" style="flex:1;min-width:200px;text-align:left" value="wikipedia" placeholder="wikipedia, medicine, ifixit…">
      <button class="btn btn-primary" type="submit">Search catalogue</button>
    </form>
    <div id="catalog-results"></div>
  `;

  const form = document.getElementById('catalog-form');
  const results = document.getElementById('catalog-results');

  const runSearch = async () => {
    results.innerHTML = '<div class="loading">Searching…</div>';
    try {
      const data = await api(`catalog/search?q=${encodeURIComponent(document.getElementById('catalog-q').value)}`);
      if (!data.online) {
        results.innerHTML = `<div class="empty">Could not reach the catalogue. You are offline.<p class="faint">${esc(data.error || '')}</p></div>`;
        return;
      }
      results.innerHTML = data.entries.length ? data.entries.map((entry) => `
        <div class="card">
          <div class="row-between">
            <strong>${esc(entry.title)}</strong>
            <span class="tag">${esc(entry.sizeHuman)}</span>
          </div>
          <p class="faint" style="margin:6px 0 0">
            ${esc(entry.date || '')} · ${esc(entry.language || '')}
            ${entry.flavour ? ` · ${esc(entry.flavour)}` : ''}
            ${entry.articleCount ? ` · ${entry.articleCount.toLocaleString()} articles` : ''}
          </p>
          ${entry.summary ? `<p class="faint" style="margin:6px 0 0">${esc(entry.summary.slice(0, 240))}</p>` : ''}
          <div class="row" style="margin-top:12px">
            <button class="btn btn-primary btn-sm get-btn"
              data-url="${esc(entry.url)}" data-filename="${esc(entry.filename)}">Download</button>
            <span class="faint mono">${esc(entry.filename || '')}</span>
          </div>
        </div>
      `).join('') : '<div class="empty">Nothing matched.</div>';

      for (const btn of results.querySelectorAll('.get-btn')) {
        btn.onclick = async () => {
          btn.disabled = true;
          btn.textContent = 'Downloading…';
          await api('downloads', { method: 'POST', body: { url: btn.dataset.url, filename: btn.dataset.filename } });
          location.hash = '#/library';
        };
      }
    } catch (err) {
      results.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  };

  form.onsubmit = (e) => { e.preventDefault(); runSearch(); };
  runSearch();
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
  view.innerHTML = `
    <p class="faint"><a href="#/handbook">Handbook</a> · ${esc(chapter.moduleTitle)}</p>
    <article class="prose">${chapter.html}</article>
  `;
}

// -------------------------------------------------------------- languages

async function renderLanguages() {
  setBusy();
  const { languages } = await api(`languages?profile=${encodeURIComponent(PROFILE)}`);

  view.innerHTML = `
    <h1>Languages</h1>
    <p class="lede">Spaced repetition: each card comes back just before you would have forgotten it. Ten minutes a day beats an hour a week.</p>
    ${languages.length === 0 ? '<div class="empty">No language decks installed.</div>' : languages.map((lang) => `
      <h2>${esc(lang.name)}${lang.nativeName ? ` <span class="muted" style="font-weight:400">${esc(lang.nativeName)}</span>` : ''}</h2>
      <div class="row" style="margin:-6px 0 12px">
        <span class="tag ${lang.stats.due ? 'tag-warn' : 'tag-good'}">${lang.stats.due} due</span>
        <span class="tag">${lang.stats.new} new</span>
        <span class="tag">${lang.stats.mature} known</span>
        <a class="btn btn-primary btn-sm" href="#/study?language=${encodeURIComponent(lang.id)}">Study ${esc(lang.name)}</a>
      </div>
      ${lang.notes ? `<p class="faint" style="margin:0 0 12px">${esc(lang.notes)}</p>` : ''}
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
}

async function renderStudy(deckId, params) {
  setBusy('Building your review queue…');

  const query = new URLSearchParams({ profile: PROFILE });
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
    view.innerHTML = `
      <div class="row-between" style="margin-bottom:12px">
        <span class="faint">${done} reviewed · ${queue.length - index} left</span>
        <a class="btn btn-sm" href="#/languages">Finish</a>
      </div>
      <div class="progress"><div style="width:${(index / queue.length) * 100}%"></div></div>

      <div class="flashcard" id="card">
        <div class="front">${esc(card.front)}</div>
        ${revealed && card.reading ? `<div class="reading">${esc(card.reading)}</div>` : ''}
        ${revealed ? `<div class="back">${esc(card.back)}</div>` : ''}
        ${revealed && card.note ? `<div class="note">${esc(card.note)}</div>` : ''}
        ${!revealed ? '<div class="hint">tap, or press space, to reveal</div>' : ''}
      </div>

      ${revealed ? `
        <div class="grade-row">
          <button class="btn grade-0" data-grade="0">Again</button>
          <button class="btn grade-1" data-grade="1">Hard</button>
          <button class="btn grade-2" data-grade="2">Good</button>
          <button class="btn grade-3" data-grade="3">Easy</button>
        </div>
        <p class="faint" style="text-align:center;margin-top:10px">keys 1 – 4</p>
      ` : ''}
      <p class="faint" style="margin-top:16px">${esc(card.deckTitle || '')}</p>
    `;

    document.getElementById('card').onclick = () => { if (!revealed) { revealed = true; draw(); } };
    for (const btn of view.querySelectorAll('[data-grade]')) {
      btn.onclick = () => grade(Number(btn.dataset.grade));
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
  const rasterPacks = packs.filter((p) => p.ok !== false && p.kind === 'raster');

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

        ${rasterPacks.length ? `<h3 style="margin-top:16px">Overlays</h3>
          ${rasterPacks.map((p) => `
            <label class="checkbox-row" style="margin-bottom:6px">
              <input type="checkbox" class="map-overlay" value="${esc(p.id)}">
              <span>${esc(p.title)} <span class="faint">${esc(p.sizeHuman)}</span></span>
            </label>`).join('')}` : ''}

        <h3 style="margin-top:16px">Go to</h3>
        <form class="row" id="map-goto" style="gap:6px">
          <input class="map-select" id="map-coords" placeholder="54.05, -2.80" style="flex:1">
          <button class="btn btn-sm" type="submit">Go</button>
        </form>
        <p class="faint" style="margin:6px 0 0">Latitude, longitude in decimal degrees.</p>
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

  MAP = new ArkMap(canvas, { categories: colours });
  window.arkMap = MAP; // handy when debugging from the console
  MAP.onHover = (position) => {
    if (!position) return;
    readout.textContent = `${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}  ·  zoom ${MAP.zoom.toFixed(1)}`;
  };

  const baseSelect = document.getElementById('map-base');
  if (baseSelect) {
    const applyBase = () => {
      const pack = vectorPacks.find((p) => p.id === baseSelect.value);
      MAP.setBase(pack.id, pack);
    };
    baseSelect.onchange = applyBase;
    applyBase();
  } else {
    MAP.draw();
  }

  document.getElementById('map-zoom-in').onclick = () => MAP.zoomBy(1);
  document.getElementById('map-zoom-out').onclick = () => MAP.zoomBy(-1);

  const styleBtn = document.getElementById('map-style');
  styleBtn.onclick = () => {
    const next = MAP.styleName === 'paper' ? 'dark' : 'paper';
    MAP.setStyle(next);
    styleBtn.textContent = next === 'paper' ? 'Dark' : 'Paper';
  };

  for (const box of view.querySelectorAll('.map-overlay')) {
    box.onchange = () => {
      MAP.setOverlays([...view.querySelectorAll('.map-overlay:checked')].map((b) => b.value));
    };
  }

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

  document.getElementById('map-goto').onsubmit = (e) => {
    e.preventDefault();
    const raw = document.getElementById('map-coords').value.trim();
    const parts = raw.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n));
    if (parts.length < 2) return;
    MAP.goTo(parts[1], parts[0], Math.max(MAP.zoom, 12));
    MAP.setMarker(parts[1], parts[0]);
  };

  const rescan = document.getElementById('map-rescan');
  if (rescan) {
    rescan.onclick = async () => {
      rescan.disabled = true;
      await api('maps/scan', { method: 'POST' });
      route();
    };
  }

  // The canvas has no size until it is in the document.
  requestAnimationFrame(() => MAP.resize());
}

// ----------------------------------------------------------------- school

async function renderSchool() {
  setBusy();
  const { subjects } = await api(`school?profile=${encodeURIComponent(PROFILE)}`);
  const allLessons = subjects.flatMap((s) => s.lessons);
  const doneCount = allLessons.filter((l) => l.done).length;

  view.innerHTML = `
    <h1>School</h1>
    <p class="lede">A curriculum that does not need a teacher, a server or a signal. Progress is tracked per person — switch profile in the top right.</p>
    ${allLessons.length ? `<div class="progress" style="height:8px"><div style="width:${(doneCount / allLessons.length) * 100}%"></div></div>
    <p class="faint" style="margin:4px 0 24px">${doneCount} of ${allLessons.length} lessons complete for ${esc(profileName())}</p>` : ''}

    ${subjects.length === 0 ? '<div class="empty">No curriculum installed yet.</div>' : subjects.map((subject) => `
      <h2>${esc(subject.title)}</h2>
      ${subject.summary ? `<p class="muted" style="margin:-6px 0 12px">${esc(subject.summary)}</p>` : ''}
      ${subject.lessons.map((lesson) => `
        <a class="card card-link" href="#/school/${encodeURIComponent(lesson.id)}">
          <div class="row-between">
            <strong>${lesson.done ? '✓ ' : ''}${esc(lesson.title)}</strong>
            ${lesson.ages ? `<span class="tag">ages ${esc(lesson.ages)}</span>` : ''}
          </div>
          ${lesson.summary ? `<p class="faint" style="margin:6px 0 0">${esc(lesson.summary)}</p>` : ''}
        </a>
      `).join('')}
    `).join('')}
  `;
}

async function renderLesson(id) {
  setBusy();
  const lesson = await api(`school/${id.split('/').map(encodeURIComponent).join('/')}`);
  const { subjects } = await api(`school?profile=${encodeURIComponent(PROFILE)}`);
  const done = subjects.flatMap((s) => s.lessons).find((l) => l.id === lesson.id)?.done || false;

  view.innerHTML = `
    <p class="faint"><a href="#/school">School</a> · ${esc(lesson.subjectTitle)}${lesson.ages ? ` · ages ${esc(lesson.ages)}` : ''}</p>
    <article class="prose">${lesson.html}</article>
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
    <iframe class="reader-frame" id="art-frame" src="${src}" title="Article"></iframe>
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

  document.onkeydown = (e) => {
    if (!location.hash.startsWith('#/read/')) { document.onkeydown = null; return; }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  };

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
    ${section('Handbook and school', data.content, (hit) => `
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
      localStorage.setItem('ark.profile', PROFILE);
    }
    await loadProfiles();
    profileSelect.value = PROFILE;
  } else {
    PROFILE = profileSelect.value;
    localStorage.setItem('ark.profile', PROFILE);
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
    await loadProfiles();
  } catch {
    footerStatus.textContent = 'Could not reach the Ark server.';
  }
  route();
})();
