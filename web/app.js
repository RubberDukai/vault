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
  const theme = localStorage.getItem('vault.theme') || 'dark';
  const phosphor = localStorage.getItem('vault.phosphor') || 'green';

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

const FEATURES = [
  ['Library', '#/library', 'Your encyclopedia packs. Every one records the day it was cloned, and tells you when a fresher copy exists.'],
  ['Handbook', '#/handbook', 'Water, fire, medicine, food, power, shelter, comms. Written to be read before you need it.'],
  ['Maps', '#/maps', 'Offline maps you can draw on. Mark routes, hazards and what you found where — the world changes, your map should too.'],
  ['Comms', '#/comms', 'Message anyone else on this network. No internet, no accounts, no company in the middle.'],
  ['Languages', '#/languages', 'Spaced repetition that shows you a card just before you would have forgotten it.'],
  ['School', '#/school', 'A curriculum that needs no teacher, server or signal. Progress tracked per person.'],
  ['Manual', '#/manual', 'How all of this works and how it was built — so you can keep it running, or rebuild it.'],
  ['Get packs', '#/get', 'Add to the library while you still have a connection. This is the one page that needs one.'],
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
      <a class="btn btn-primary" href="#/get">Get your first pack</a>
    </div>` : ''}

    ${stale.length ? `<div class="card">
      <strong>${stale.length} pack${stale.length > 1 ? 's are' : ' is'} over a year old.</strong>
      <p class="muted" style="margin:6px 0 10px">Worth refreshing while refreshing is still possible.</p>
      <a class="btn btn-sm" href="#/library">Check for updates</a>
    </div>` : ''}

    <h2>What's in here</h2>
    <div class="feature-list">
      ${FEATURES.map(([name, href, desc]) => `
        <a class="feature" href="${href}">
          <span class="feature-name">${esc(name)}</span>
          <span class="feature-desc">${esc(desc)}</span>
        </a>`).join('')}
    </div>

    <h2>Getting your bearings</h2>
    <div class="card">
      <p><strong>Search the lot at once.</strong> The box at the top searches the handbook, the school
      and every encyclopedia pack together. It is the fastest way in.</p>
      <p><strong>Everyone gets a profile.</strong> Top right. Flashcard schedules and lesson progress
      are kept per person, so the children's work stays theirs.</p>
      <p><strong>Read it on anything.</strong> Whatever device is serving this prints an address on
      its console — type that into a phone or tablet on the same wifi and you are in. No app to install.</p>
      <p style="margin:0"><strong>Make it yours.</strong> Three appearances in the top right, including a
      phosphor terminal with a screen colour of your choosing. Purely for the pleasure of it.</p>
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

    <div id="pack-list">${packs.length ? packs.map(libraryRow).join('') : '<div class="empty">No .zim packs found.<br><a class="btn btn-primary" href="#/get" style="margin-top:12px">Get packs</a></div>'}</div>

    <h2>Books &amp; documents</h2>
    <p class="muted" style="margin:-6px 0 12px">PDFs and EPUBs from <span class="mono">library/docs</span>. Full text goes into search; the reader opens the book itself.</p>
    <div id="doc-list"><div class="loading">Reading the shelf…</div></div>

    <h2>Downloads</h2>
    <div id="download-list"><p class="faint">Nothing downloading.</p></div>
  `;

  api('docs').then(({ docs, docsDir }) => {
    const target = document.getElementById('doc-list');
    if (!target) return;
    target.innerHTML = docs.length ? docs.map((doc) => `
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
      : `<div class="empty">Nothing on the shelf yet. Drop <code>.pdf</code> or <code>.epub</code> files into<br><span class="mono">${esc(docsDir)}</span><br><button class="btn btn-sm" id="rescan-docs" style="margin-top:12px">Rescan documents</button></div>`;

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
  view.innerHTML = printable(
    `<a href="#/handbook">Handbook</a> · ${esc(chapter.moduleTitle)}`,
    chapter.html,
    `Handbook · ${chapter.moduleTitle} · ${chapter.title}`
  );
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
        ${lang.guide ? `<a class="btn btn-sm" href="#/languages/${encodeURIComponent(lang.id)}/guide">How it works</a>` : ''}
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

        <div class="row" style="gap:6px;margin-bottom:8px">
          <button class="btn btn-sm" id="tool-pan">Pan</button>
          <button class="btn btn-sm" id="tool-pen">Draw</button>
          <button class="btn btn-sm" id="tool-pin">Pin</button>
          <button class="btn btn-sm" id="tool-eraser">Erase</button>
          <button class="btn btn-sm" id="tool-measure">Measure</button>
        </div>
        <p class="faint" id="tool-hint" style="margin:0 0 8px"></p>

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
        <p class="faint" style="margin:6px 0 10px">For the centre of the map. Computed, not looked up — it works with no data at all.</p>
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

  MAP = new VaultMap(canvas, { categories: colours });
  window.vaultMap = MAP; // handy when debugging from the console
  MAP.onHover = (position) => {
    if (!position) return;
    readout.dataset.position = `${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}  ·  zoom ${MAP.zoom.toFixed(1)}`;
    readout.textContent = readout.dataset.measure
      ? `${readout.dataset.measure}  ·  ${readout.dataset.position}`
      : readout.dataset.position;
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

  const paint = () => {
    const [y, m, d] = dateInput.value.split('-').map(Number);
    if (!y) return;
    const date = new Date(y, m - 1, d);
    const { lat, lon } = MAP.centre;
    const sun = A.sunTimes(date, lat, lon);
    const moon = A.moonPhase(date);

    const isToday = date.toDateString() === new Date().toDateString();
    const now = new Date();
    const pos = isToday ? A.sunPosition(now, lat, lon) : null;

    const row = (label, value) => `<div class="almanac-row"><span class="faint">${label}</span><span class="mono">${value}</span></div>`;

    body.innerHTML = `
      ${sun.polar ? `<p class="muted">Polar ${sun.polar}: the sun does not ${sun.polar === 'day' ? 'set' : 'rise'} here on this date.</p>` : ''}
      ${row('First light', A.formatTime(sun.dawn))}
      ${row('Sunrise', A.formatTime(sun.sunrise))}
      ${row('Solar noon', A.formatTime(sun.solarNoon) + ' · due south')}
      ${row('Sunset', A.formatTime(sun.sunset))}
      ${row('Last light', A.formatTime(sun.dusk))}
      ${row('Day length', A.formatDuration(sun.dayLengthMinutes))}
      ${pos ? row('Sun now', pos.altitude > 0
        ? `${pos.azimuth.toFixed(0)}° ${A.compassPoint(pos.azimuth)} · ${pos.altitude.toFixed(0)}° up`
        : 'below the horizon') : ''}
      ${row('Moon', `${moon.glyph} ${moon.name} · ${Math.round(moon.illumination * 100)}% lit`)}
      ${row('Next full moon', moon.nextFull.toLocaleDateString())}
      <p class="faint" style="margin:10px 0 0">${lat.toFixed(3)}, ${lon.toFixed(3)} · local time. First and last light are civil twilight — enough to work by without a lamp.</p>
    `;
  };

  dateInput.onchange = paint;
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
  };
  const hint = document.getElementById('tool-hint');
  const HINTS = {
    pan: 'Drag to move, scroll to zoom.',
    pen: 'Drag to draw. The length of each line is shown at its end.',
    pin: 'Click to drop a labelled marker.',
    eraser: 'Drag over lines or pins to remove them.',
    measure: 'Click points to measure a route. Press Escape or choose another tool to clear.',
  };

  const selectTool = (name) => {
    MAP.setTool(name === 'pan' ? null : name);
    for (const [key, btn] of Object.entries(toolButtons)) {
      btn.classList.toggle('btn-active', key === name);
    }
    hint.textContent = HINTS[name] || '';
  };
  for (const [name, btn] of Object.entries(toolButtons)) btn.onclick = () => selectTool(name);
  selectTool('pan');

  const readout = document.getElementById('map-readout');
  MAP.onMeasure = (metres, points, mode) => {
    if (!readout) return;
    if (points < 1) { readout.dataset.measure = ''; return; }
    const label = metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(2)} km`;
    readout.dataset.measure = `${mode === 'drawing' ? 'line' : 'route'} ${label}`;
    readout.textContent = `${readout.dataset.measure}  ·  ${readout.dataset.position || ''}`;
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && MAP.drawMode === 'measure') MAP.clearMeasure();
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

  const paintLayers = () => {
    layerList.innerHTML = layers.map((layer) => `
      <div class="layer-row">
        <input type="checkbox" class="layer-visible" data-id="${esc(layer.id)}" ${layer.visible ? 'checked' : ''}>
        <input type="radio" name="active-layer" class="layer-active" data-id="${esc(layer.id)}"
          ${layer.id === MAP.activeLayerId ? 'checked' : ''} title="Draw into this layer">
        <span class="layer-name">${esc(layer.name)}</span>
        <span class="faint">${layer.strokes.length}</span>
        ${layers.length > 1 ? `<button class="btn btn-sm layer-delete" data-id="${esc(layer.id)}" title="Delete layer">×</button>` : ''}
      </div>`).join('');

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
        Posting as <strong>${esc(profileName())}</strong>. Change profile in the top right.
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

  view.innerHTML = printable(
    `<a href="#/school">School</a> · ${esc(lesson.subjectTitle)}${lesson.ages ? ` · ages ${esc(lesson.ages)}` : ''}`,
    lesson.html,
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

  const frameSrc = (index) => (doc.type === 'pdf'
    ? `/doc/${encodeURIComponent(docId)}/file#page=${index + 1}`
    : `/doc/${encodeURIComponent(docId)}/chapter/${index}`);

  view.innerHTML = `
    <div class="reader-bar">
      <button class="btn btn-sm" id="doc-prev" title="Previous ${esc(doc.unitLabel)}">←</button>
      <button class="btn btn-sm" id="doc-next" title="Next ${esc(doc.unitLabel)}">→</button>
      <span class="reader-title" id="doc-title"></span>
      <span class="spacer"></span>
      <button class="btn btn-sm" id="doc-toc">Contents</button>
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

  const show = (index) => {
    current = Math.max(0, Math.min(doc.units.length - 1, index));
    const unit = doc.units[current];
    titleEl.textContent = doc.units.length > 1 ? `${unit.title}  ·  ${current + 1} / ${doc.units.length}` : doc.title;
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
    await loadProfiles();
  } catch {
    footerStatus.textContent = 'Could not reach the Ark server.';
  }
  route();
})();
