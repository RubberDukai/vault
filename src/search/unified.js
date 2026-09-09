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

  /** Rebuild the index from the authored content library. */
  build(content) {
    this.docs = [];
    this.index = new Map();

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

    for (const lang of content.languages) {
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
  searchContent(query, limit = 20) {
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
    const results = [...scores.entries()].map(([docIndex, score]) => {
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

  /** Search the ZIM packs by title, merging results from every open pack. */
  async searchPacks(library, query, limitPerPack = 8) {
    const out = [];
    for (const pack of library.list()) {
      if (!pack.ok) continue;
      const zim = library.zim(pack.id);
      if (!zim) continue;
      try {
        const hits = await zim.findTitles(query, limitPerPack);
        for (const hit of hits) {
          out.push({
            kind: 'pack',
            id: `${pack.id}:${hit.url}`,
            title: hit.title,
            context: pack.title,
            summary: '',
            href: `#/read/${pack.id}/${encodeURIComponent(hit.url)}`,
            packId: pack.id,
            url: hit.url,
          });
        }
      } catch (err) {
        console.error(`[ark] search failed in pack ${pack.id}: ${err.message}`);
      }
    }
    return out;
  }

  async searchAll(library, query, { contentLimit = 15, packLimit = 8 } = {}) {
    const [content, packs] = await Promise.all([
      Promise.resolve(this.searchContent(query, contentLimit)),
      this.searchPacks(library, query, packLimit),
    ]);
    return { query, content, packs, total: content.length + packs.length };
  }
}

module.exports = { UnifiedSearch, tokenize };
