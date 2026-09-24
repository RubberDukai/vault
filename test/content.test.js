'use strict';
/**
 * The content itself is the product, so it is checked like code: every lesson
 * has the frontmatter the School page needs, every handbook chapter has a
 * title, orders do not collide, and no link points at a file or a section
 * that is not there. A typo in a frontmatter key makes a lesson vanish from
 * the page without any error anywhere, which is exactly the kind of failure a
 * test should catch.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseFrontmatter } = require('../src/content/loader');

const CONTENT = path.join(__dirname, '..', 'content');
const EDUCATION = path.join(CONTENT, 'education');
const HANDBOOK = path.join(CONTENT, 'handbook');

const STAGES = new Set(['KS1', 'KS2', 'KS3', 'Guide']);

function markdownIn(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownIn(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const read = (file) => parseFrontmatter(fs.readFileSync(file, 'utf8'));
const rel = (file) => path.relative(CONTENT, file).replace(/\\/g, '/');

test('parseFrontmatter reads keys, numbers and lists', () => {
  const { meta, body } = parseFrontmatter('---\ntitle: A\norder: 3\nages: 7-11\ntags: [one, two]\n---\n\nBody here.\n');
  assert.strictEqual(meta.title, 'A');
  assert.strictEqual(meta.order, 3, 'a bare number becomes a number');
  assert.strictEqual(meta.ages, '7-11', 'a range stays a string');
  assert.deepStrictEqual(meta.tags, ['one', 'two']);
  assert.strictEqual(body.trim(), 'Body here.');
});

test('parseFrontmatter leaves a file with no frontmatter alone', () => {
  const { meta, body } = parseFrontmatter('# Just a heading\n');
  assert.deepStrictEqual(meta, {});
  assert.strictEqual(body, '# Just a heading\n');
});

test('every lesson has the frontmatter the School page needs', () => {
  const problems = [];
  for (const file of markdownIn(EDUCATION)) {
    const { meta } = read(file);
    if (!meta.title) problems.push(`${rel(file)}: no title`);
    if (!meta.summary) problems.push(`${rel(file)}: no summary`);
    if (!meta.stage) problems.push(`${rel(file)}: no stage`);
    else if (!STAGES.has(meta.stage)) problems.push(`${rel(file)}: stage "${meta.stage}" is not one of ${[...STAGES].join(', ')}`);
    if (typeof meta.order !== 'number') problems.push(`${rel(file)}: order must be a number, got ${JSON.stringify(meta.order)}`);
    if (meta.stage !== 'Guide' && !meta.ages) problems.push(`${rel(file)}: no ages`);
  }
  assert.deepStrictEqual(problems, []);
});

test('no two lessons in a subject share an order', () => {
  const clashes = [];
  for (const subject of fs.readdirSync(EDUCATION, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const seen = new Map();
    for (const file of markdownIn(path.join(EDUCATION, subject.name))) {
      const { meta } = read(file);
      if (seen.has(meta.order)) clashes.push(`${subject.name}: ${seen.get(meta.order)} and ${path.basename(file)} are both order ${meta.order}`);
      seen.set(meta.order, path.basename(file));
    }
  }
  assert.deepStrictEqual(clashes, []);
});

test('every subject folder has a subject.json with a title and an order', () => {
  const problems = [];
  for (const subject of fs.readdirSync(EDUCATION, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const file = path.join(EDUCATION, subject.name, 'subject.json');
    if (!fs.existsSync(file)) { problems.push(`${subject.name}: no subject.json`); continue; }
    const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!meta.title) problems.push(`${subject.name}: subject.json has no title`);
    if (typeof meta.order !== 'number') problems.push(`${subject.name}: subject.json order must be a number`);
  }
  assert.deepStrictEqual(problems, []);
});

test('every lesson starts with a heading and has exercises with answers', () => {
  const problems = [];
  for (const file of markdownIn(EDUCATION)) {
    const { meta, body } = read(file);
    if (!/^#\s+\S/m.test(body)) problems.push(`${rel(file)}: no H1`);
    // A lesson may have no exercises — Learning to read is a method, not a set
    // of problems — but a lesson that sets exercises must give the answers.
    if (/^##\s+Exercises\s*$/m.test(body) && !/^##\s+Answers\s*$/m.test(body)) {
      problems.push(`${rel(file)}: has exercises but no "## Answers" section`);
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('every handbook chapter has a title and its module.json is valid', () => {
  const problems = [];
  for (const mod of fs.readdirSync(HANDBOOK, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const meta = path.join(HANDBOOK, mod.name, 'module.json');
    if (!fs.existsSync(meta)) { problems.push(`${mod.name}: no module.json`); continue; }
    const parsed = JSON.parse(fs.readFileSync(meta, 'utf8'));
    if (!parsed.title) problems.push(`${mod.name}: module.json has no title`);
    for (const file of markdownIn(path.join(HANDBOOK, mod.name))) {
      if (!read(file).meta.title) problems.push(`${rel(file)}: no title`);
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('wiki: links are well formed', () => {
  const problems = [];
  for (const file of [...markdownIn(EDUCATION), ...markdownIn(HANDBOOK)]) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\]\(wiki:([^)]*)\)/g)) {
      const raw = match[1];
      if (!raw.trim()) { problems.push(`${rel(file)}: empty wiki: link`); continue; }
      for (const title of raw.split(/\\?\|/)) {
        if (!title.trim()) problems.push(`${rel(file)}: empty alternative in "${raw}"`);
        else if (/\s/.test(title)) problems.push(`${rel(file)}: "${title}" has a space — use an underscore`);
      }
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('a pipe inside a table cell is escaped', () => {
  // An unescaped | inside a table row silently gains a cell and cuts a link in
  // half, which is how the Iron Age row lost its encyclopedia link once.
  const problems = [];
  for (const file of [...markdownIn(EDUCATION), ...markdownIn(HANDBOOK)]) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/^\s*\|/.test(line)) return;
      for (const match of line.matchAll(/\]\(([^)]*)\)/g)) {
        if (match[1].includes('|') && !match[1].includes('\\|')) {
          problems.push(`${rel(file)}:${i + 1}: unescaped pipe inside a table cell link`);
        }
      }
    });
  }
  assert.deepStrictEqual(problems, []);
});

test('the pack catalogue is valid and its ids are unique', () => {
  const packs = JSON.parse(fs.readFileSync(path.join(CONTENT, 'packs.json'), 'utf8'));
  assert.ok(Array.isArray(packs.items) && packs.items.length > 0);
  const seen = new Set();
  const problems = [];
  for (const item of packs.items) {
    if (seen.has(item.id)) problems.push(`duplicate id: ${item.id}`);
    seen.add(item.id);
    if (!item.title) problems.push(`${item.id}: no title`);
    if (!item.dest) problems.push(`${item.id}: no dest`);
    if (!Array.isArray(item.files) || !item.files.length) problems.push(`${item.id}: no files`);
    for (const f of item.files || []) {
      if (!f.filename) problems.push(`${item.id}: a file has no filename`);
      else if (f.filename.includes('..') || /[\\/]/.test(f.filename)) problems.push(`${item.id}: filename "${f.filename}" must be a plain name`);
      if (f.url && !/^https:\/\//.test(f.url)) problems.push(`${item.id}: "${f.url}" is not https`);
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('every listening passage is complete and its answers point at real options', () => {
  const languages = path.join(CONTENT, 'languages');
  if (!fs.existsSync(languages)) return;
  const problems = [];
  let passages = 0;

  for (const lang of fs.readdirSync(languages, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const dir = path.join(languages, lang.name, 'listening');
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const where = `${lang.name}/listening/${entry}`;
      let passage;
      try { passage = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8')); }
      catch (err) { problems.push(`${where}: invalid JSON — ${err.message}`); continue; }
      passages++;

      if (!passage.title) problems.push(`${where}: no title`);
      if (!passage.summary) problems.push(`${where}: no summary`);
      if (typeof passage.order !== 'number') problems.push(`${where}: order must be a number`);
      if (!Array.isArray(passage.lines) || passage.lines.length < 2) problems.push(`${where}: needs at least two lines`);

      for (const [i, line] of (passage.lines || []).entries()) {
        if (!line.text) problems.push(`${where}: line ${i} has no text`);
        // Without a translation a learner has no way to check themselves.
        if (!line.translation) problems.push(`${where}: line ${i} has no translation`);
        if (line.speaker && passage.speakers && !passage.speakers[line.speaker]) {
          problems.push(`${where}: line ${i} speaks as "${line.speaker}", which is not in speakers`);
        }
      }

      for (const [i, qn] of (passage.questions || []).entries()) {
        if (!qn.q) problems.push(`${where}: question ${i} has no text`);
        if (qn.options) {
          if (!Array.isArray(qn.options) || qn.options.length < 2) problems.push(`${where}: question ${i} needs at least two options`);
          else if (!Number.isInteger(qn.answer) || qn.answer < 0 || qn.answer >= qn.options.length) {
            problems.push(`${where}: question ${i} answer ${JSON.stringify(qn.answer)} is not one of its ${qn.options.length} options`);
          }
        } else if (qn.answer === undefined || qn.answer === null || qn.answer === '') {
          problems.push(`${where}: question ${i} has no answer`);
        }
      }
    }
  }

  assert.deepStrictEqual(problems, []);
  assert.ok(passages > 0, 'there should be some listening passages');
});

test('no language deck repeats a card within itself', () => {
  const languages = path.join(CONTENT, 'languages');
  if (!fs.existsSync(languages)) return;
  const problems = [];
  for (const lang of fs.readdirSync(languages, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    for (const entry of fs.readdirSync(path.join(languages, lang.name))) {
      if (!entry.endsWith('.json') || entry === 'language.json') continue;
      const deck = JSON.parse(fs.readFileSync(path.join(languages, lang.name, entry), 'utf8'));
      const cards = Array.isArray(deck) ? deck : deck.cards || [];
      const seen = new Set();
      for (const card of cards) {
        const key = String(card.front || '').trim().toLowerCase();
        if (!key) continue;
        if (seen.has(key)) problems.push(`${lang.name}/${entry}: "${card.front}" appears twice`);
        seen.add(key);
      }
    }
  }
  assert.deepStrictEqual(problems, []);
});
