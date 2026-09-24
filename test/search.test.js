'use strict';
/**
 * Search ranking and spelling suggestions.
 *
 * The bug these came from: searching "bronze age" opened with AgenDAV from
 * the Arch Linux wiki, because every pack contributed its first eight titles
 * in whatever order the packs happened to be listed. The encyclopedia article
 * on the thing you typed must come first.
 */

const test = require('node:test');
const assert = require('node:assert');
const { UnifiedSearch, tokenize } = require('../src/search/unified');

const score = (query, title) => UnifiedSearch.titleScore(query, tokenize(query), title);

test('an exact title beats everything else', () => {
  assert.ok(score('bronze age', 'Bronze Age') > score('bronze age', 'Bronze Age collapse'));
  assert.ok(score('bronze age', 'Bronze Age') > score('bronze age', 'Bronze Age in Korea'));
  assert.strictEqual(score('bronze age', 'Bronze Age'), 100);
});

test('case and underscores do not matter', () => {
  assert.strictEqual(score('bronze age', 'bronze_age'), 100);
  assert.strictEqual(score('bronze age', 'BRONZE AGE'), 100);
});

test('a prefix beats a mention beats scattered words', () => {
  const prefix = score('bronze age', 'Bronze Age collapse');
  const contains = score('bronze age', 'The bronze age in Britain');
  const scattered = score('bronze age', 'Bronze statues of the modern age');
  assert.ok(prefix > contains, 'a title that starts with the query is closer');
  assert.ok(contains > scattered, 'the words together beat the words apart');
  assert.ok(scattered > 0);
});

test('a title with none of the words scores nothing', () => {
  assert.strictEqual(score('bronze age', 'AgenDAV'), 0);
});

test('shorter titles win among equals', () => {
  assert.ok(score('kidney', 'Kidney') > score('kidney', 'Kidney bean'));
});

test('disambiguation and list pages are pushed down', () => {
  assert.ok(score('mercury', 'Mercury') > score('mercury', 'Mercury (disambiguation)'));
  assert.ok(score('bridges', 'Bridges') > score('bridges', 'List of bridges'));
});

test('a general encyclopedia outweighs a niche wiki, but only as a tilt', () => {
  const wikipedia = UnifiedSearch.packWeight({ id: 'wikipedia-en-simple-all-maxi-2026-06' });
  const wiktionary = UnifiedSearch.packWeight({ id: 'wiktionary-en-all-maxi' });
  const arch = UnifiedSearch.packWeight({ id: 'archlinux-en-all-maxi-2026-07' });
  assert.ok(wikipedia > wiktionary && wiktionary > arch);

  // "pacman": ArchWiki has the exact title, Wikipedia only a partial one.
  // The exact match must still win despite the lower weight.
  const archHit = score('pacman', 'Pacman') * arch;
  const wikiHit = score('pacman', 'Mr. Pacman') * wikipedia;
  assert.ok(archHit > wikiHit, 'a real title match beats a nudge in the weights');
});

// --------------------------------------------------------------- suggestions

function searchWith(texts) {
  const search = new UnifiedSearch();
  search.docs = [];
  search.index = new Map();
  for (const [i, text] of texts.entries()) {
    search._add({ kind: 'handbook', id: `d${i}`, title: `Doc ${i}`, context: '', summary: '', href: '#', text });
  }
  return search;
}

test('a misspelling is corrected towards a word the vault actually uses', () => {
  const search = searchWith(Array.from({ length: 40 }, () => 'the bronze age began when metal arrived'));
  assert.strictEqual(search.suggest('bronz age'), 'bronze age');
});

test('a word the vault uses constantly is left alone', () => {
  const search = searchWith(Array.from({ length: 40 }, () => 'water is needed every day for drinking water'));
  assert.strictEqual(search.suggest('water'), null);
});

test('one stray occurrence does not make a word correct', () => {
  // "bronz" appears once — a scanning slip — while "bronze" is everywhere.
  const texts = Array.from({ length: 40 }, () => 'bronze age tools of bronze');
  texts.push('a bronz misprint');
  const search = searchWith(texts);
  assert.strictEqual(search.suggest('bronz'), 'bronze');
});

test('nothing is suggested when there is no near neighbour', () => {
  const search = searchWith(Array.from({ length: 20 }, () => 'the handbook covers water and fire'));
  assert.strictEqual(search.suggest('zzzzqqqq'), null);
});

test('place names can be corrected towards too', () => {
  const search = searchWith(Array.from({ length: 20 }, () => 'unrelated text about fire'));
  search.addVocabulary(['manchester', 'macclesfield', 'sandbach']);
  assert.strictEqual(search.suggest('manchestr'), 'manchester');
});

test('a correction has to be much commoner than what was typed', () => {
  // Both words are used about equally: no reason to prefer one.
  const texts = [];
  for (let i = 0; i < 20; i++) { texts.push('the quern grinds grain'); texts.push('the queen rules'); }
  const search = searchWith(texts);
  assert.strictEqual(search.suggest('quern'), null, 'a real word in real use is not a typo');
});

test('editDistance is used, not a prefix test', () => {
  const search = searchWith(Array.from({ length: 30 }, () => 'fermentation preserves food'));
  assert.strictEqual(search.suggest('fermenation'), 'fermentation', 'a missing letter in the middle');
});
