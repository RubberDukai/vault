'use strict';
/**
 * One search box over everything: handbook chapters, school lessons, language
 * cards and every Wikipedia-style pack in the library.
 *
 * Authored content gets a real inverted index (it is small and we control it).
 * ZIM packs are searched through their own title index, because building a
 * full-text index over seven million articles is a different project.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'for', 'on', 'with',
  'as', 'at', 'by', 'be', 'this', 'that', 'from', 'are', 'you', 'your', 'if', 'can',
]);

/**
 * Levenshtein distance, abandoned as soon as it is certain to exceed `cap`.
 * Comparing a typo against fifty thousand words has to be cheap.
 */
function editDistance(a, b, cap = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) >= cap) return cap;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < rowBest) rowBest = current[j];
    }
    if (rowBest >= cap) return cap; // every remaining path is already too long
    previous = current;
  }
  return previous[b.length];
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9À-ɏ぀-ヿ一-鿿ऀ-ॿ]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

class UnifiedSearch {
  constructor() {
    this.docs = [];
    this.index = new Map(); // term -> Map(docIndex -> count)
  }

  /** Rebuild the index from the authored content library, plus any documents. */
  build(content, documents = []) {
    this.docs = [];
    this.index = new Map();

    for (const doc of documents) this._add(doc);

    for (const mod of content.handbook) {
      for (const ch of mod.chapters) {
        this._add({
          kind: 'handbook',
          id: ch.id,
          title: ch.title,
          context: mod.title,
          summary: ch.summary,
          href: `#/handbook/${ch.id}`,
          text: `${ch.title} ${ch.summary} ${ch.tags.join(' ')} ${ch.plain}`,
        });
      }
    }

    for (const subject of content.education) {
      for (const lesson of subject.lessons) {
        this._add({
          kind: 'school',
          id: lesson.id,
          title: lesson.title,
          context: `${subject.title}${lesson.ages ? ` · ages ${lesson.ages}` : ''}`,
          summary: lesson.summary,
          href: `#/school/${lesson.id}`,
          text: `${lesson.title} ${lesson.summary} ${lesson.plain}`,
        });
      }
    }

    for (const recipe of content.recipes || []) {
      this._add({
        kind: 'recipe',
        id: recipe.id,
        title: recipe.title,
        context: 'Recipes',
        summary: recipe.summary,
        href: `#/notebook?tab=recipes&open=${recipe.id}`,
        text: `${recipe.title} ${recipe.summary} recipe ${recipe.plain}`,
      });
    }

    for (const lang of content.languages) {
      if (lang.guide) {
        this._add({
          kind: 'language',
          id: `${lang.id}/guide`,
          title: lang.guide.title,
          context: lang.name,
          summary: 'How the language works',
          href: `#/languages/${lang.id}/guide`,
          text: `${lang.name} grammar guide ${lang.guide.plain}`,
        });
      }
      for (const deck of lang.decks) {
        this._add({
          kind: 'language',
          id: deck.id,
          title: deck.title,
          context: lang.name,
          summary: deck.description || `${deck.cards.length} cards`,
          href: `#/languages/${deck.id}`,
          text: `${lang.name} ${deck.title} ${deck.description} ${deck.cards.map((c) => `${c.front} ${c.back} ${c.reading}`).join(' ')}`,
        });
      }
    }

    return this;
  }

  _add(doc) {
    const docIndex = this.docs.length;
    this.docs.push(doc);
    const counts = new Map();
    for (const term of tokenize(doc.text)) counts.set(term, (counts.get(term) || 0) + 1);
    for (const [term, count] of counts) {
      if (!this.index.has(term)) this.index.set(term, new Map());
      this.index.get(term).set(docIndex, count);
    }
  }

  /** Search authored content. Scores by tf-idf, with a bonus for title hits. */
  searchContent(query, limit = 20, keep = null) {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const scores = new Map();
    const total = this.docs.length || 1;

    for (const term of terms) {
      // Exact term, plus a cheap prefix expansion so "filtr" finds "filtration".
      const matches = this.index.has(term)
        ? [[term, this.index.get(term)]]
        : [...this.index.entries()].filter(([t]) => t.startsWith(term)).slice(0, 12);

      for (const [, postings] of matches) {
        const idf = Math.log(1 + total / postings.size);
        for (const [docIndex, count] of postings) {
          scores.set(docIndex, (scores.get(docIndex) || 0) + count * idf);
        }
      }
    }

    const lowered = query.toLowerCase().trim();
    const results = [...scores.entries()].filter(([docIndex]) => !keep || keep(this.docs[docIndex])).map(([docIndex, score]) => {
      const doc = this.docs[docIndex];
      const titleBonus = doc.title.toLowerCase().includes(lowered) ? 25 : 0;
      return { ...doc, score: score + titleBonus, snippet: this._snippet(doc.text, terms) };
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  _snippet(text, terms, radius = 110) {
    const lower = text.toLowerCase();
    let at = -1;
    for (const term of terms) {
      at = lower.indexOf(term);
      if (at !== -1) break;
    }
    if (at === -1) return text.slice(0, radius * 2).trim();
    const start = Math.max(0, at - radius);
    const end = Math.min(text.length, at + radius);
    return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
  }

  /**
   * How much a pack's answer is worth for a general question.
   *
   * A general encyclopedia should answer "bronze age"; a wiki about Arch Linux
   * should not, however alphabetically eager it is. This only tilts the
   * scales — a title that actually matches still wins, which is why searching
   * "pacman" still finds the ArchWiki page ahead of anything else.
   */
  static packWeight(pack) {
    const id = String(pack.id || '').toLowerCase();
    if (/^wikipedia/.test(id)) return 1;
    if (/^(vikidia|wikibooks|wikiversity|wikivoyage|wiktionary|wikisource)/.test(id)) return 0.82;
    return 0.66;
  }

  /**
   * How well a pack article's title answers the query. Exact beats prefix
   * beats contains beats scattered words, and among equals the shorter title
   * wins: "Bronze Age" is the article somebody typing "bronze age" wants,
   * not "Bronze Age in Korea".
   */
  static titleScore(query, terms, title) {
    const t = String(title).toLowerCase().replace(/_/g, ' ').trim();
    const q = String(query).toLowerCase().trim();
    if (!t) return 0;

    let score;
    if (t === q) score = 100;
    else if (t.startsWith(`${q} `) || t.startsWith(`${q},`) || t.startsWith(`${q}(`)) score = 72;
    else if (t.includes(q)) score = 48;
    else {
      // Whole words only: "AgenDAV" contains the letters of "age" and is not
      // an answer to "bronze age".
      const words = new Set(t.split(/[^a-z0-9à-ɏ]+/i).filter(Boolean));
      const present = terms.filter((term) => words.has(term)).length;
      if (!present) return 0;
      score = present === terms.length ? 30 : (18 * present) / terms.length;
    }

    // Prefer the plain article over the long qualified one.
    score -= Math.min(18, Math.max(0, t.length - q.length) / 4);
    // A list or a disambiguation page is rarely what was wanted.
    if (/\bdisambiguation\b|^list of |^index of /.test(t)) score -= 25;
    return score;
  }

  /**
   * Search the ZIM packs by title, all packs at once, ranked together.
   *
   * Every pack used to contribute its first eight titles in whatever order
   * the packs happened to be listed, so a search for "bronze age" opened with
   * AgenDAV from the Arch Linux wiki and the Wikipedia article was somewhere
   * below the fold. They are now scored against the query and sorted.
   */
  async searchPacks(library, query, limit = 24, perPackFetch = 40) {
    const packs = library.list().filter((p) => p.ok && library.zim(p.id));
    const terms = tokenize(query);

    const perPack = await Promise.all(packs.map(async (pack) => {
      const weight = UnifiedSearch.packWeight(pack);
      try {
        const hits = await library.zim(pack.id).findTitles(query, perPackFetch);
        return hits.map((hit) => ({
          kind: 'pack',
          id: `${pack.id}:${hit.url}`,
          title: hit.title,
          context: pack.title,
          summary: '',
          href: `#/read/${pack.id}/${encodeURIComponent(hit.url)}`,
          packId: pack.id,
          url: hit.url,
          score: UnifiedSearch.titleScore(query, terms, hit.title) * weight,
        }));
      } catch (err) {
        console.error(`[vault] search failed in pack ${pack.id}: ${err.message}`);
        return [];
      }
    }));

    return perPack.flat()
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Every word the authored content knows, for suggesting a correction.
   * Built once from the index that already exists.
   */
  vocabulary() {
    if (!this._vocab) {
      // Only words that turn up in more than one place. With a shelf of
      // scanned books indexed, almost any string of letters appears
      // somewhere once, and correcting towards those is worse than useless.
      this._vocab = [...this.index.entries()]
        .filter(([word, postings]) => word.length > 3 && postings.size >= 2)
        .map(([word]) => word);
    }
    return this._vocab;
  }

  /** How widely a word is used here — how many documents contain it. */
  _commonness(word) {
    const postings = this.index.get(word);
    if (postings) return postings.size;
    // A place name is a curated fact, not a stray string: worth correcting to.
    return (this._extraVocab || []).includes(word) ? 5 : 1;
  }

  /**
   * Is this word common enough here to be taken as spelled correctly?
   *
   * Not "does it appear at all". With seventy thousand book sections indexed,
   * "bronz" appears in twenty-four of them — scanning slips, other languages,
   * names — so mere presence proves nothing. The bar scales with the size of
   * the corpus.
   */
  _known(term) {
    if ((this._extraVocab || []).includes(term)) return true;
    const postings = this.index.get(term);
    if (!postings) return false;
    return postings.size >= Math.max(20, Math.round(this.docs.length * 0.002));
  }

  /** Extra words worth correcting towards — place names, mostly. */
  addVocabulary(words) {
    this._extraVocab = [...new Set([...(this._extraVocab || []), ...words.map((w) => String(w).toLowerCase())])]
      .filter((w) => w.length > 3);
    this._vocab = null;
  }

  /**
   * "Did you mean…" — the nearest word we know to each one that found nothing.
   * Only words the vault itself contains are offered, so a suggestion always
   * leads somewhere rather than to a second empty page.
   */
  suggest(query) {
    const terms = tokenize(query);
    if (!terms.length) return null;

    const vocab = [...this.vocabulary(), ...(this._extraVocab || [])];
    if (!vocab.length) return null;

    let changed = false;
    const fixed = terms.map((term) => {
      if (this._known(term)) return term;
      // A short word has to be very close; a long one may be further out.
      const allowed = term.length <= 5 ? 1 : 2;
      let best = null;
      let bestDistance = allowed + 1;
      let bestCommonness = 0;
      for (const word of vocab) {
        if (word === term) continue;
        if (Math.abs(word.length - term.length) > allowed) continue;
        if (word[0] !== term[0] && word[1] !== term[1]) continue; // cheap reject
        const d = editDistance(term, word, bestDistance + 1);
        if (d > allowed) continue;
        const commonness = this._commonness(word);
        // Nearest wins; among equally near, the word people actually use.
        if (d < bestDistance || (d === bestDistance && commonness > bestCommonness)) {
          bestDistance = d;
          bestCommonness = commonness;
          best = word;
        }
      }
      // Only worth offering if the correction is a word people here plainly
      // use far more than the one typed.
      if (best && bestCommonness >= Math.max(3, this._commonness(term) * 3)) {
        changed = true;
        return best;
      }
      return term;
    });

    return changed ? fixed.join(' ') : null;
  }

  async searchAll(library, query, { contentLimit = 15, packLimit = 8, documentLimit = 10 } = {}) {
    // Books have hundreds of sections each; ranked in one pool with the
    // handbook they crowd it out entirely, and the concise chapter that
    // answers "child bleeding" never surfaces. So the authored content —
    // handbook, lessons, manual — is searched in its own pool and always
    // gets its slots, and books are ranked separately with a cap per book.
    const [content, ranked, packs] = await Promise.all([
      Promise.resolve(this.searchContent(query, contentLimit, (d) => d.kind !== 'document')),
      Promise.resolve(this.searchContent(query, documentLimit * 4, (d) => d.kind === 'document')),
      this.searchPacks(library, query, packLimit * 3),
    ]);

    const documents = [];
    const perBook = new Map();
    for (const hit of ranked) {
      const book = hit.id.split('/')[0];
      const seen = perBook.get(book) || 0;
      if (seen >= 3 || documents.length >= documentLimit) continue;
      perBook.set(book, seen + 1);
      documents.push(hit);
    }

    // The encyclopedia article on the thing you typed, when there plainly is
    // one, shown first and on its own. Somebody searching "bronze age" wants
    // the article about the Bronze Age before they want a lesson that
    // mentions it — and they should not have to know which pack it is in.
    const best = packs.find((hit) => hit.score >= 60) || null;

    // If there is plainly a right answer, do not second-guess the spelling.
    // Otherwise offer the nearest thing the vault actually contains, which is
    // the difference between "bronz age" finding nothing and finding the
    // Bronze Age.
    const suggestion = best ? null : this.suggest(query);

    return {
      query,
      best,
      suggestion: suggestion && suggestion !== query.toLowerCase().trim() ? suggestion : null,
      content,
      documents,
      packs: best ? packs.filter((p) => p.id !== best.id) : packs,
      total: content.length + documents.length + packs.length,
    };
  }
}

module.exports = { UnifiedSearch, tokenize };
