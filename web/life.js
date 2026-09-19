'use strict';
/* Vault: the notebook and the media player. Loaded before app.js. */

// ================================================================ notebook

const NOTE_KINDS = [
  ['note', 'Journal', 'Pages of your own: what happened, what you learned, what to remember.'],
  ['recipe', 'Recipes', 'Your recipes beside the ones that ship with the vault.'],
  ['list', 'Lists', 'Things to do, things to get, things to check. Tick them off.'],
];

let NOTEBOOK_STATE = null;
try { NOTEBOOK_STATE = JSON.parse(localStorage.getItem('vault.notebook') || 'null'); } catch { NOTEBOOK_STATE = null; }
if (!NOTEBOOK_STATE) NOTEBOOK_STATE = { tab: 'note', open: null };
const saveNotebookState = () => { try { localStorage.setItem('vault.notebook', JSON.stringify(NOTEBOOK_STATE)); } catch { /* fine */ } };

/** A very small markdown: headings, bold, italics, lists, paragraphs. Enough for a notebook. */
function miniMarkdown(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let list = null;
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
  const closeList = () => { if (list) { out.push(list === 'ul' ? '</ul>' : '</ol>'); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) { closeList(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); }
    else if (ul) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(ul[1])}</li>`); }
    else if (ol) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(ol[1])}</li>`); }
    else if (!line.trim()) { closeList(); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  return out.join('\n');
}

async function renderNotebook(params) {
  setBusy('Opening the notebook…');
  const tabParam = params && params.get('tab');
  if (tabParam === 'recipes') NOTEBOOK_STATE.tab = 'recipe';
  else if (tabParam && NOTE_KINDS.some(([k]) => k === tabParam)) NOTEBOOK_STATE.tab = tabParam;
  const openParam = params && params.get('open');
  if (openParam) NOTEBOOK_STATE.open = openParam;

  let { notes, recipes } = await api(`notebook?profile=${encodeURIComponent(PROFILE)}`);
  const profileName = profileSelect.selectedOptions[0]?.textContent || 'you';

  view.innerHTML = `
    <div class="row-between" style="flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <h1 style="margin:0">Notebook</h1>
      <div class="row" style="gap:6px" id="nb-tabs">
        ${NOTE_KINDS.map(([kind, label]) => `<button class="btn btn-sm nb-tab" data-kind="${kind}">${label}</button>`).join('')}
      </div>
    </div>
    <div class="nb-shell">
      <aside class="nb-side">
        <div class="row" style="gap:6px;margin-bottom:8px">
          <input class="map-select" id="nb-search" placeholder="Find in pages…" style="flex:1">
          <button class="btn btn-sm btn-primary" id="nb-new">+ New</button>
        </div>
        <div id="nb-list"></div>
      </aside>
      <section class="nb-main" id="nb-main"></section>
    </div>`;

  const tabs = view.querySelectorAll('.nb-tab');
  const list = document.getElementById('nb-list');
  const main = document.getElementById('nb-main');
  const search = document.getElementById('nb-search');

  const mine = () => notes.filter((n) => n.kind === NOTEBOOK_STATE.tab);
  const kindLabel = () => NOTE_KINDS.find(([k]) => k === NOTEBOOK_STATE.tab)[1];

  const paintTabs = () => {
    for (const t of tabs) t.classList.toggle('btn-active', t.dataset.kind === NOTEBOOK_STATE.tab);
  };

  const paintList = () => {
    const q = search.value.trim().toLowerCase();
    const match = (n) => !q || `${n.title} ${n.body} ${(n.items || []).map((i) => i.text).join(' ')}`.toLowerCase().includes(q);
    const items = mine().filter(match).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
    const builtin = NOTEBOOK_STATE.tab === 'recipe' ? recipes.filter((r) => !q || `${r.title} ${r.summary} ${r.plainish || ''}`.toLowerCase().includes(q)) : [];
    list.innerHTML = `
      ${items.length ? items.map((n) => `
        <button class="nb-item ${NOTEBOOK_STATE.open === n.id ? 'active' : ''}" data-id="${esc(n.id)}">
          <span class="nb-item-title">${esc(n.title || 'Untitled')}</span>
          <span class="faint">${n.shared ? 'shared · ' : ''}${new Date(n.updated || n.created).toLocaleDateString()}${n.kind === 'list' ? ` · ${(n.items || []).filter((i) => !i.done).length} left` : ''}</span>
        </button>`).join('') : `<p class="faint" style="margin:6px 4px">No ${kindLabel().toLowerCase()} pages yet${q ? ' match' : ''}.</p>`}
      ${builtin.length ? `<h3 class="nb-heading">From the vault</h3>${builtin.map((r) => `
        <button class="nb-item ${NOTEBOOK_STATE.open === `recipe:${r.id}` ? 'active' : ''}" data-id="recipe:${esc(r.id)}">
          <span class="nb-item-title">${esc(r.title)}</span>
          <span class="faint">${esc(r.time || '')}</span>
        </button>`).join('')}` : ''}`;
    for (const b of list.querySelectorAll('.nb-item')) {
      b.onclick = () => { NOTEBOOK_STATE.open = b.dataset.id; saveNotebookState(); paintList(); paintMain(); };
    }
  };

  let saveTimer = null;
  const save = async (note, immediate = false) => {
    clearTimeout(saveTimer);
    const doSave = async () => {
      const { note: saved } = await api('notebook', { method: 'POST', body: { ...note, profile: note.profile || PROFILE } });
      Object.assign(note, saved);
      paintList();
      const status = document.getElementById('nb-status');
      if (status) status.textContent = `Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    };
    if (immediate) return doSave();
    saveTimer = setTimeout(doSave, 600);
  };

  const paintMain = () => {
    const id = NOTEBOOK_STATE.open;
    if (id && id.startsWith('recipe:')) {
      const r = recipes.find((x) => x.id === id.slice(7));
      if (!r) { NOTEBOOK_STATE.open = null; return paintMain(); }
      main.innerHTML = printable('Notebook · Recipes · from the vault', `
        <h1>${esc(r.title)}</h1>
        <p class="lede">${esc(r.summary)}</p>
        <p class="faint">${r.serves ? `Makes ${esc(r.serves)} · ` : ''}${esc(r.time)}</p>
        ${r.html}
        <p><button class="btn btn-sm" id="nb-copy-recipe">Copy into my recipes to change it</button></p>`, `Recipes · ${r.title}`);
      document.getElementById('nb-copy-recipe').onclick = async () => {
        const note = { kind: 'recipe', title: r.title, body: htmlToText(r.html), items: [] };
        await save(note, true);
        notes.push(note);
        NOTEBOOK_STATE.open = note.id; saveNotebookState();
        paintList(); paintMain();
      };
      return;
    }
    const note = notes.find((n) => n.id === id);
    if (!note) {
      main.innerHTML = `<div class="empty">
        <p>${esc(NOTE_KINDS.find(([k]) => k === NOTEBOOK_STATE.tab)[2])}</p>
        <p class="faint">Pages belong to <strong>${esc(profileName)}</strong>. Tick "shared" on a page and everyone on the network sees it.</p>
        <button class="btn btn-primary" id="nb-new-2">New ${kindLabel().toLowerCase().replace(/s$/, '')}</button>
      </div>`;
      document.getElementById('nb-new-2').onclick = newNote;
      return;
    }
    const readOnly = note.profile !== PROFILE;
    main.innerHTML = `
      <div class="row-between" style="gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <input class="nb-title" id="nb-title" value="${esc(note.title)}" placeholder="Title" ${readOnly ? 'readonly' : ''}>
        <div class="row" style="gap:6px;align-items:center">
          <label class="checkbox-row" style="font-size:13px"><input type="checkbox" id="nb-shared" ${note.shared ? 'checked' : ''} ${readOnly ? 'disabled' : ''}><span>Shared</span></label>
          ${note.kind !== 'list' ? '<button class="btn btn-sm" id="nb-preview">Preview</button>' : ''}
          <button class="btn btn-sm" onclick="window.print()">Print</button>
          ${readOnly ? '' : '<button class="btn btn-sm" id="nb-delete" title="Delete this page">×</button>'}
        </div>
      </div>
      ${readOnly ? `<p class="faint" style="margin:0 0 8px">Shared by someone else — read only here.</p>` : ''}
      ${note.kind === 'list' ? `
        <div id="nb-items"></div>
        ${readOnly ? '' : `<form class="row" id="nb-add-item" style="gap:6px;margin-top:8px">
          <input class="map-select" id="nb-item-text" placeholder="Add an item…" style="flex:1" autocomplete="off">
          <button class="btn btn-sm" type="submit">Add</button>
        </form>
        <div class="row" style="gap:6px;margin-top:8px"><button class="btn btn-sm" id="nb-clear-done">Remove ticked</button></div>`}
      ` : `
        <textarea class="nb-body" id="nb-body" placeholder="Write here. A line starting with # is a heading, - is a bullet, **bold** and *italic* work." ${readOnly ? 'readonly' : ''}>${esc(note.body)}</textarea>
        <article class="prose nb-rendered" id="nb-rendered" hidden></article>
      `}
      <p class="faint" style="margin:8px 0 0"><span id="nb-status">${note.updated ? `Saved ${new Date(note.updated).toLocaleString()}` : ''}</span></p>`;

    const title = document.getElementById('nb-title');
    title.oninput = () => { note.title = title.value; save(note); };
    const shared = document.getElementById('nb-shared');
    shared.onchange = () => { note.shared = shared.checked; save(note, true); };
    const del = document.getElementById('nb-delete');
    if (del) del.onclick = async () => {
      if (!confirm(`Delete "${note.title || 'this page'}"?`)) return;
      await api(`notebook/${encodeURIComponent(note.id)}`, { method: 'DELETE' });
      notes = notes.filter((n) => n.id !== note.id);
      NOTEBOOK_STATE.open = null; saveNotebookState();
      paintList(); paintMain();
    };

    if (note.kind === 'list') {
      const itemsBox = document.getElementById('nb-items');
      const paintItems = () => {
        itemsBox.innerHTML = (note.items || []).length ? note.items.map((item, i) => `
          <label class="nb-check ${item.done ? 'done' : ''}">
            <input type="checkbox" data-i="${i}" ${item.done ? 'checked' : ''} ${readOnly ? 'disabled' : ''}>
            <span>${esc(item.text)}</span>
            ${readOnly ? '' : `<button type="button" class="nb-item-remove" data-i="${i}" title="Remove">×</button>`}
          </label>`).join('') : '<p class="faint">Nothing on the list yet.</p>';
        for (const box of itemsBox.querySelectorAll('input[type=checkbox]')) {
          box.onchange = () => { note.items[Number(box.dataset.i)].done = box.checked; save(note); paintItems(); };
        }
        for (const b of itemsBox.querySelectorAll('.nb-item-remove')) {
          b.onclick = () => { note.items.splice(Number(b.dataset.i), 1); save(note); paintItems(); };
        }
      };
      paintItems();
      const form = document.getElementById('nb-add-item');
      if (form) form.onsubmit = (e) => {
        e.preventDefault();
        const input = document.getElementById('nb-item-text');
        const text = input.value.trim();
        if (!text) return;
        note.items = note.items || [];
        note.items.push({ text, done: false });
        input.value = '';
        save(note);
        paintItems();
      };
      const clear = document.getElementById('nb-clear-done');
      if (clear) clear.onclick = () => { note.items = (note.items || []).filter((i) => !i.done); save(note); paintItems(); };
    } else {
      const body = document.getElementById('nb-body');
      const rendered = document.getElementById('nb-rendered');
      const preview = document.getElementById('nb-preview');
      body.oninput = () => { note.body = body.value; save(note); };
      preview.onclick = () => {
        const showing = !rendered.hidden;
        rendered.hidden = showing;
        body.hidden = !showing;
        preview.textContent = showing ? 'Preview' : 'Edit';
        if (!showing) rendered.innerHTML = miniMarkdown(note.body);
      };
      if (readOnly) { rendered.innerHTML = miniMarkdown(note.body); rendered.hidden = false; body.hidden = true; preview.textContent = 'Edit'; }
    }
  };

  const newNote = async () => {
    const note = { kind: NOTEBOOK_STATE.tab, title: '', body: '', items: [], shared: false };
    await save(note, true);
    notes.push(note);
    NOTEBOOK_STATE.open = note.id; saveNotebookState();
    paintList(); paintMain();
    document.getElementById('nb-title')?.focus();
  };
  document.getElementById('nb-new').onclick = newNote;

  for (const t of tabs) {
    t.onclick = () => {
      NOTEBOOK_STATE.tab = t.dataset.kind;
      const stillThere = notes.find((n) => n.id === NOTEBOOK_STATE.open && n.kind === NOTEBOOK_STATE.tab)
        || (NOTEBOOK_STATE.tab === 'recipe' && String(NOTEBOOK_STATE.open || '').startsWith('recipe:'));
      if (!stillThere) NOTEBOOK_STATE.open = null;
      saveNotebookState();
      paintTabs(); paintList(); paintMain();
    };
  }
  search.oninput = paintList;

  // A recipe opened from search.
  if (openParam && recipes.some((r) => r.id === openParam)) NOTEBOOK_STATE.open = `recipe:${openParam}`;
  if (NOTEBOOK_STATE.open && !String(NOTEBOOK_STATE.open).startsWith('recipe:') && !notes.some((n) => n.id === NOTEBOOK_STATE.open)) NOTEBOOK_STATE.open = null;

  paintTabs(); paintList(); paintMain();
}

function htmlToText(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  for (const h of div.querySelectorAll('h1,h2,h3')) h.textContent = `${'#'.repeat(Number(h.tagName[1]) - 1)} ${h.textContent}\n`;
  for (const li of div.querySelectorAll('li')) li.textContent = `- ${li.textContent}\n`;
  for (const p of div.querySelectorAll('p')) p.textContent = `${p.textContent}\n\n`;
  return div.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

// =================================================================== media

let MEDIA_STATE = null;
try { MEDIA_STATE = JSON.parse(localStorage.getItem('vault.media') || 'null'); } catch { MEDIA_STATE = null; }
if (!MEDIA_STATE) MEDIA_STATE = { tab: 'audio', folder: '' };
const saveMediaState = () => { try { localStorage.setItem('vault.media', JSON.stringify(MEDIA_STATE)); } catch { /* fine */ } };

// The player outlives the page so music keeps going while you read.
let PLAYER = null;
function getPlayer() {
  if (!PLAYER) {
    PLAYER = { audio: new Audio(), queue: [], index: -1, shuffle: false };
    PLAYER.audio.addEventListener('ended', () => playIndex(PLAYER.index + 1));
    PLAYER.audio.addEventListener('timeupdate', () => window.dispatchEvent(new CustomEvent('vault:player')));
    PLAYER.audio.addEventListener('play', () => window.dispatchEvent(new CustomEvent('vault:player')));
    PLAYER.audio.addEventListener('pause', () => window.dispatchEvent(new CustomEvent('vault:player')));
  }
  return PLAYER;
}
function playIndex(i) {
  const p = getPlayer();
  if (!p.queue.length) return;
  if (p.shuffle && i !== p.index) i = Math.floor(Math.random() * p.queue.length);
  if (i < 0 || i >= p.queue.length) { p.audio.pause(); p.index = -1; window.dispatchEvent(new CustomEvent('vault:player')); return; }
  p.index = i;
  p.audio.src = p.queue[i].url;
  p.audio.play().catch(() => { /* needs a click first; the button handles it */ });
  window.dispatchEvent(new CustomEvent('vault:player'));
}

const humanSize = (n) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const fmtTime = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

async function renderMedia(params) {
  setBusy('Reading the media folder…');
  const tabParam = params && params.get('tab');
  if (['audio', 'image', 'video'].includes(tabParam)) MEDIA_STATE.tab = tabParam;
  const { files, dir } = await api('media');

  view.innerHTML = `
    <div class="row-between" style="flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <h1 style="margin:0">Media</h1>
      <div class="row" style="gap:6px">
        <button class="btn btn-sm media-tab" data-tab="audio">Music</button>
        <button class="btn btn-sm media-tab" data-tab="image">Photos</button>
        <button class="btn btn-sm media-tab" data-tab="video">Films</button>
        <button class="btn btn-sm" id="media-rescan" title="Read the folder again">↻</button>
      </div>
    </div>
    <div id="media-player" class="media-player"></div>
    <div id="media-body"></div>
    <p class="faint" style="margin-top:16px">Put files in <code>${esc(dir)}</code> — a folder per album or trip works well. The browser plays what it can: MP3, OGG, FLAC, WAV, M4A; MP4 and WebM films; JPEG, PNG, GIF, WebP photos. Nothing is copied or converted.</p>`;

  const body = document.getElementById('media-body');
  const tabs = view.querySelectorAll('.media-tab');
  const paintTabs = () => { for (const t of tabs) t.classList.toggle('btn-active', t.dataset.tab === MEDIA_STATE.tab); };
  for (const t of tabs) t.onclick = () => { MEDIA_STATE.tab = t.dataset.tab; MEDIA_STATE.folder = ''; saveMediaState(); paintTabs(); paintBody(); };
  document.getElementById('media-rescan').onclick = () => route();

  const paintPlayer = () => {
    const box = document.getElementById('media-player');
    if (!box) return;
    const p = getPlayer();
    const track = p.queue[p.index];
    if (!track) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    const a = p.audio;
    box.innerHTML = `
      <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-sm" id="pl-prev" title="Previous">⏮</button>
        <button class="btn" id="pl-toggle">${a.paused ? '▶' : '⏸'}</button>
        <button class="btn btn-sm" id="pl-next" title="Next">⏭</button>
        <div style="flex:1;min-width:160px">
          <div><strong>${esc(track.name)}</strong> <span class="faint">${esc(track.folder || '')}</span></div>
          <input type="range" id="pl-seek" min="0" max="${Math.floor(a.duration || 0)}" value="${Math.floor(a.currentTime || 0)}" style="width:100%">
        </div>
        <span class="mono faint">${fmtTime(a.currentTime)} / ${fmtTime(a.duration)}</span>
        <button class="btn btn-sm ${p.shuffle ? 'btn-active' : ''}" id="pl-shuffle" title="Shuffle">⤮</button>
        <input type="range" id="pl-volume" min="0" max="1" step="0.05" value="${a.volume}" style="width:80px" title="Volume">
      </div>`;
    document.getElementById('pl-toggle').onclick = () => { if (a.paused) a.play(); else a.pause(); };
    document.getElementById('pl-prev').onclick = () => playIndex(p.index - 1);
    document.getElementById('pl-next').onclick = () => playIndex(p.index + 1);
    document.getElementById('pl-shuffle').onclick = () => { p.shuffle = !p.shuffle; paintPlayer(); };
    document.getElementById('pl-seek').oninput = (e) => { a.currentTime = Number(e.target.value); };
    document.getElementById('pl-volume').oninput = (e) => { a.volume = Number(e.target.value); };
  };
  // Only the time readout and slider change between ticks; repaint cheaply.
  let lastTrack = null;
  const onTick = () => {
    const p = getPlayer();
    const track = p.queue[p.index];
    if (track !== lastTrack || !document.getElementById('pl-seek')) { lastTrack = track; paintPlayer(); return; }
    const seek = document.getElementById('pl-seek');
    if (seek && document.activeElement !== seek) { seek.max = Math.floor(p.audio.duration || 0); seek.value = Math.floor(p.audio.currentTime || 0); }
    const readout = seek?.parentElement?.nextElementSibling;
    if (readout) readout.textContent = `${fmtTime(p.audio.currentTime)} / ${fmtTime(p.audio.duration)}`;
    const toggle = document.getElementById('pl-toggle');
    if (toggle) toggle.textContent = p.audio.paused ? '▶' : '⏸';
  };
  window.addEventListener('vault:player', onTick);
  window.addEventListener('hashchange', () => window.removeEventListener('vault:player', onTick), { once: true });

  const paintBody = () => {
    const kind = MEDIA_STATE.tab;
    const all = files.filter((f) => f.kind === kind);
    const folders = [...new Set(all.map((f) => f.folder))].sort();
    const shown = MEDIA_STATE.folder ? all.filter((f) => f.folder === MEDIA_STATE.folder) : all;

    if (!all.length) {
      body.innerHTML = `<div class="empty">No ${kind === 'audio' ? 'music' : kind === 'image' ? 'photos' : 'films'} found. Drop some files in the media folder and press ↻.</div>`;
      return;
    }

    const folderBar = folders.length > 1 || (folders.length === 1 && folders[0]) ? `
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn btn-sm ${MEDIA_STATE.folder ? '' : 'btn-active'}" data-folder="">All (${all.length})</button>
        ${folders.filter(Boolean).map((f) => `<button class="btn btn-sm ${MEDIA_STATE.folder === f ? 'btn-active' : ''}" data-folder="${esc(f)}">${esc(f.split('/').pop())} (${all.filter((x) => x.folder === f).length})</button>`).join('')}
      </div>` : '';

    if (kind === 'audio') {
      body.innerHTML = `${folderBar}
        <div class="row" style="gap:6px;margin-bottom:8px">
          <button class="btn btn-sm btn-primary" id="media-play-all">▶ Play all</button>
          <button class="btn btn-sm" id="media-shuffle-all">⤮ Shuffle all</button>
        </div>
        <div class="media-list">${shown.map((f, i) => `
          <button class="media-track" data-i="${i}">
            <span class="media-track-name">${esc(f.name)}</span>
            <span class="faint">${esc(f.folder.split('/').pop() || '')} · ${humanSize(f.size)}</span>
          </button>`).join('')}</div>`;
      const startQueue = (index, shuffle) => {
        const p = getPlayer();
        p.queue = shown.slice();
        p.shuffle = shuffle;
        playIndex(shuffle ? Math.floor(Math.random() * p.queue.length) : index);
      };
      document.getElementById('media-play-all').onclick = () => startQueue(0, false);
      document.getElementById('media-shuffle-all').onclick = () => startQueue(0, true);
      for (const b of body.querySelectorAll('.media-track')) b.onclick = () => startQueue(Number(b.dataset.i), false);
    } else if (kind === 'image') {
      body.innerHTML = `${folderBar}
        <div class="photo-grid">${shown.map((f, i) => `
          <button class="photo-thumb" data-i="${i}" title="${esc(f.name)}"><img loading="lazy" src="${f.url}" alt="${esc(f.name)}"></button>`).join('')}</div>
        <div class="lightbox" id="lightbox" hidden>
          <button class="lightbox-close" id="lb-close">×</button>
          <button class="lightbox-nav" id="lb-prev">‹</button>
          <img id="lb-img" alt="">
          <button class="lightbox-nav" id="lb-next">›</button>
          <div class="lightbox-caption" id="lb-caption"></div>
        </div>`;
      const lb = document.getElementById('lightbox');
      let current = 0;
      const show = (i) => {
        current = (i + shown.length) % shown.length;
        document.getElementById('lb-img').src = shown[current].url;
        document.getElementById('lb-caption').textContent = `${shown[current].name} · ${current + 1} of ${shown.length}`;
        lb.hidden = false;
      };
      for (const b of body.querySelectorAll('.photo-thumb')) b.onclick = () => show(Number(b.dataset.i));
      document.getElementById('lb-close').onclick = () => { lb.hidden = true; };
      document.getElementById('lb-prev').onclick = () => show(current - 1);
      document.getElementById('lb-next').onclick = () => show(current + 1);
      const onKey = (e) => {
        if (lb.hidden) return;
        if (e.key === 'Escape') lb.hidden = true;
        if (e.key === 'ArrowLeft') show(current - 1);
        if (e.key === 'ArrowRight') show(current + 1);
      };
      document.addEventListener('keydown', onKey);
      window.addEventListener('hashchange', () => document.removeEventListener('keydown', onKey), { once: true });
    } else {
      body.innerHTML = `${folderBar}
        <div id="video-stage"></div>
        <div class="media-list">${shown.map((f, i) => `
          <button class="media-track" data-i="${i}">
            <span class="media-track-name">${esc(f.name)}</span>
            <span class="faint">${esc(f.folder.split('/').pop() || '')} · ${humanSize(f.size)}</span>
          </button>`).join('')}</div>`;
      for (const b of body.querySelectorAll('.media-track')) {
        b.onclick = () => {
          const f = shown[Number(b.dataset.i)];
          getPlayer().audio.pause();
          document.getElementById('video-stage').innerHTML = `<video controls autoplay src="${f.url}" style="width:100%;max-height:70vh;background:#000"></video><p class="faint">${esc(f.name)}</p>`;
          window.scrollTo(0, 0);
        };
      }
    }
    for (const b of body.querySelectorAll('[data-folder]')) {
      b.onclick = () => { MEDIA_STATE.folder = b.dataset.folder; saveMediaState(); paintBody(); };
    }
  };

  paintTabs();
  paintPlayer();
  paintBody();
}

window.renderNotebook = renderNotebook;
window.renderMedia = renderMedia;
