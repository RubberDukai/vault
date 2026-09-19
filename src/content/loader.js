'use strict';
/**
 * Loads the authored content: the survival handbook, language decks and the
 * school curriculum. Everything is plain files on disk, so any of it can be
 * edited, printed or replaced with a text editor and no tooling at all.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const markdown = require('./markdown');

/** Parse the `---` frontmatter block at the top of a markdown file. */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^\[.*\]$/.test(value)) {
      value = value.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      value = value.replace(/^["']|["']$/g, '');
      if (/^\d+$/.test(value)) value = Number(value);
    }
    meta[kv[1]] = value;
  }
  return { meta, body: match[2] };
}

async function readDirSafe(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

class ContentLibrary {
  constructor(contentDir) {
    this.contentDir = contentDir;
    this.handbook = [];    // modules -> chapters
    this.languages = [];   // language -> decks -> cards
    this.education = [];   // subject -> lessons
    this.manual = [];      // flat pages about the app itself
    this.loadedAt = null;
  }

  async load() {
    await Promise.all([
      this._loadHandbook(),
      this._loadLanguages(),
      this._loadEducation(),
      this._loadManual(),
      this._loadRecipes(),
    ]);
    this.loadedAt = new Date().toISOString();
    return this;
  }

  /** Recipes shipped with the vault; the notebook shows them beside your own. */
  async _loadRecipes() {
    const root = path.join(this.contentDir, 'recipes');
    const recipes = [];
    for (const file of await readDirSafe(root)) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue;
      const raw = await fsp.readFile(path.join(root, file.name), 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const slug = file.name.replace(/\.md$/, '');
      recipes.push({
        id: slug,
        title: meta.title || slug,
        summary: meta.summary || '',
        serves: meta.serves || '',
        time: meta.time || '',
        body,
        plain: markdown.toPlainText(body),
      });
    }
    recipes.sort((a, b) => a.title.localeCompare(b.title));
    this.recipes = recipes;
  }

  /** The manual: how this thing works and how it was built. A flat list. */
  async _loadManual() {
    const root = path.join(this.contentDir, 'manual');
    const pages = [];

    for (const file of await readDirSafe(root)) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue;
      const raw = await fsp.readFile(path.join(root, file.name), 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const slug = file.name.replace(/\.md$/, '');
      pages.push({
        id: slug,
        slug,
        title: meta.title || slug,
        summary: meta.summary || '',
        order: meta.order ?? 50,
        body,
        plain: markdown.toPlainText(body),
      });
    }

    // The build tracker lives at the repository root so it is the first
    // thing seen on GitHub, but it belongs in the Manual tab too.
    const trackerPath = path.join(this.contentDir, '..', 'TRACKER.md');
    try {
      const raw = await fsp.readFile(trackerPath, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      pages.push({
        id: 'build-tracker',
        slug: 'build-tracker',
        title: meta.title || 'Build tracker',
        summary: meta.summary || '',
        order: meta.order ?? 0,
        body,
        plain: markdown.toPlainText(body),
      });
    } catch {
      // No tracker file is fine; a copy handed to someone else may not carry one.
    }

    pages.sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title));
    this.manual = pages;
  }

  manualPage(slug) {
    return this.manual.find((p) => p.slug === slug) || null;
  }

  async _loadHandbook() {
    const root = path.join(this.contentDir, 'handbook');
    const modules = [];

    for (const dirent of await readDirSafe(root)) {
      if (!dirent.isDirectory()) continue;
      const moduleDir = path.join(root, dirent.name);

      let moduleMeta = {};
      try {
        moduleMeta = JSON.parse(await fsp.readFile(path.join(moduleDir, 'module.json'), 'utf8'));
      } catch {
        moduleMeta = { title: dirent.name };
      }

      const chapters = [];
      for (const file of await readDirSafe(moduleDir)) {
        if (!file.isFile() || !file.name.endsWith('.md')) continue;
        const raw = await fsp.readFile(path.join(moduleDir, file.name), 'utf8');
        const { meta, body } = parseFrontmatter(raw);
        const slug = file.name.replace(/\.md$/, '');
        chapters.push({
          id: `${dirent.name}/${slug}`,
          module: dirent.name,
          slug,
          title: meta.title || slug,
          summary: meta.summary || '',
          tags: Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []),
          priority: meta.priority ?? 50,
          body,
          plain: markdown.toPlainText(body),
          words: markdown.toPlainText(body).split(/\s+/).length,
        });
      }

      chapters.sort((a, b) => (a.priority - b.priority) || a.title.localeCompare(b.title));
      modules.push({
        id: dirent.name,
        title: moduleMeta.title || dirent.name,
        icon: moduleMeta.icon || '',
        summary: moduleMeta.summary || '',
        order: moduleMeta.order ?? 99,
        chapters,
      });
    }

    modules.sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title));
    this.handbook = modules;
  }

  async _loadLanguages() {
    const root = path.join(this.contentDir, 'languages');
    const languages = [];

    for (const dirent of await readDirSafe(root)) {
      if (!dirent.isDirectory()) continue;
      const langDir = path.join(root, dirent.name);

      let langMeta = {};
      try {
        langMeta = JSON.parse(await fsp.readFile(path.join(langDir, 'language.json'), 'utf8'));
      } catch {
        langMeta = { name: dirent.name };
      }

      const decks = [];
      for (const file of await readDirSafe(langDir)) {
        if (!file.isFile() || !file.name.endsWith('.json') || file.name === 'language.json') continue;
        try {
          const deck = JSON.parse(await fsp.readFile(path.join(langDir, file.name), 'utf8'));
          const slug = file.name.replace(/\.json$/, '');
          decks.push({
            id: `${dirent.name}/${slug}`,
            language: dirent.name,
            slug,
            title: deck.title || slug,
            description: deck.description || '',
            order: deck.order ?? 50,
            cards: (deck.cards || []).map((c, idx) => ({
              id: `${dirent.name}/${slug}/${idx}`,
              front: c.front,
              back: c.back,
              reading: c.reading || '',
              note: c.note || '',
              tags: c.tags || [],
            })),
          });
        } catch (err) {
          console.error(`[vault] skipping deck ${file.name}: ${err.message}`);
        }
      }

      decks.sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title));

      // A written guide — grammar, pronunciation, how the language works —
      // because flashcards can teach words but not how to put them together.
      let guide = null;
      try {
        const raw = await fsp.readFile(path.join(langDir, 'guide.md'), 'utf8');
        const { meta, body } = parseFrontmatter(raw);
        guide = { title: meta.title || `${langMeta.name || dirent.name} — how it works`, body, plain: markdown.toPlainText(body) };
      } catch {
        guide = null;
      }

      languages.push({
        id: dirent.name,
        name: langMeta.name || dirent.name,
        nativeName: langMeta.nativeName || '',
        script: langMeta.script || '',
        order: langMeta.order ?? 50,
        notes: langMeta.notes || '',
        syllabus: langMeta.syllabus || '',
        decks,
        guide,
        cardCount: decks.reduce((n, d) => n + d.cards.length, 0),
      });
    }

    languages.sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
    this.languages = languages;
  }

  async _loadEducation() {
    const root = path.join(this.contentDir, 'education');
    const subjects = [];

    for (const dirent of await readDirSafe(root)) {
      if (!dirent.isDirectory()) continue;
      const subjectDir = path.join(root, dirent.name);

      let subjectMeta = {};
      try {
        subjectMeta = JSON.parse(await fsp.readFile(path.join(subjectDir, 'subject.json'), 'utf8'));
      } catch {
        subjectMeta = { title: dirent.name };
      }

      const lessons = [];
      for (const file of await readDirSafe(subjectDir)) {
        if (!file.isFile() || !file.name.endsWith('.md')) continue;
        const raw = await fsp.readFile(path.join(subjectDir, file.name), 'utf8');
        const { meta, body } = parseFrontmatter(raw);
        const slug = file.name.replace(/\.md$/, '');
        lessons.push({
          id: `${dirent.name}/${slug}`,
          subject: dirent.name,
          slug,
          title: meta.title || slug,
          stage: meta.stage || '',
          ages: meta.ages || '',
          summary: meta.summary || '',
          order: meta.order ?? 50,
          body,
          plain: markdown.toPlainText(body),
        });
      }

      lessons.sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title));
      subjects.push({
        id: dirent.name,
        title: subjectMeta.title || dirent.name,
        icon: subjectMeta.icon || '',
        summary: subjectMeta.summary || '',
        order: subjectMeta.order ?? 50,
        lessons,
      });
    }

    subjects.sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title));
    this.education = subjects;
  }

  chapter(id) {
    for (const mod of this.handbook) {
      const found = mod.chapters.find((c) => c.id === id);
      if (found) return { ...found, moduleTitle: mod.title };
    }
    return null;
  }

  lesson(id) {
    for (const subject of this.education) {
      const found = subject.lessons.find((l) => l.id === id);
      if (found) return { ...found, subjectTitle: subject.title };
    }
    return null;
  }

  deck(id) {
    for (const lang of this.languages) {
      const found = lang.decks.find((d) => d.id === id);
      if (found) return { ...found, languageName: lang.name };
    }
    return null;
  }

  allCards(languageId = null) {
    const out = [];
    for (const lang of this.languages) {
      if (languageId && lang.id !== languageId) continue;
      for (const deck of lang.decks) out.push(...deck.cards.map((c) => ({ ...c, deckTitle: deck.title, language: lang.id })));
    }
    return out;
  }

  stats() {
    return {
      modules: this.handbook.length,
      chapters: this.handbook.reduce((n, m) => n + m.chapters.length, 0),
      words: this.handbook.reduce((n, m) => n + m.chapters.reduce((w, c) => w + c.words, 0), 0),
      languages: this.languages.length,
      cards: this.languages.reduce((n, l) => n + l.cardCount, 0),
      subjects: this.education.length,
      lessons: this.education.reduce((n, s) => n + s.lessons.length, 0),
    };
  }
}

module.exports = { ContentLibrary, parseFrontmatter };
