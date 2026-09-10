'use strict';
/**
 * Client for the Kiwix OPDS catalogue — the only part of Ark that ever touches
 * the internet, and only when you ask it to.
 *
 * Its one job: tell us what the current build of a pack is, when it was dumped
 * and how big it is, so the app can say "your copy is from March, there's an
 * August one, it's 56.1 GB, do you want it?"
 */

const CATALOG_BASE = 'https://library.kiwix.org/catalog/v2';
const DEFAULT_TIMEOUT = 30000;

/**
 * Minimal Atom entry extraction. A full XML parser would be a dependency we do
 * not want; the OPDS feed is machine-generated and stable enough for this.
 */
function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return null;
  return decodeEntities(match[1].trim());
}

function decodeEntities(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseEntry(xml) {
  const links = [];
  const linkRe = /<link\b([^>]*)\/?>/gi;
  let m;
  while ((m = linkRe.exec(xml)) !== null) {
    const attrs = {};
    const attrRe = /([\w:-]+)="([^"]*)"/g;
    let a;
    while ((a = attrRe.exec(m[1])) !== null) attrs[a[1]] = decodeEntities(a[2]);
    links.push(attrs);
  }

  const zimLink = links.find((l) => (l.type || '').includes('x-zim'));
  if (!zimLink) return null;

  // The catalogue hands out metalink URLs; the plain .zim sits next to them.
  const href = (zimLink.href || '').replace(/\.meta4$/, '');
  const updated = extractTag(xml, 'updated');

  return {
    id: extractTag(xml, 'id'),
    title: extractTag(xml, 'title'),
    name: extractTag(xml, 'name'),
    flavour: extractTag(xml, 'flavour') || '',
    language: extractTag(xml, 'language') || '',
    summary: extractTag(xml, 'summary') || extractTag(xml, 'content') || '',
    publisher: extractTag(xml, 'dc:publisher') || '',
    articleCount: Number(extractTag(xml, 'articleCount') || 0),
    mediaCount: Number(extractTag(xml, 'mediaCount') || 0),
    updated,
    date: updated ? updated.slice(0, 10) : null,
    size: Number(zimLink.length || 0),
    url: href,
    filename: href ? href.split('/').pop() : null,
  };
}

function parseFeed(xml) {
  const entries = [];
  const re = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const entry = parseEntry(m[1]);
    if (entry) entries.push(entry);
  }
  return entries;
}

async function fetchXml(url, timeout = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Vault/0.1 (offline knowledge vault)' },
    });
    if (!res.ok) throw new Error(`Catalogue returned HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Free-text search of the Kiwix catalogue. */
async function search(query, { count = 40, lang = null } = {}) {
  const params = new URLSearchParams({ q: query, count: String(count) });
  if (lang) params.set('lang', lang);
  return parseFeed(await fetchXml(`${CATALOG_BASE}/entries?${params}`));
}

/**
 * Pack names are not written consistently between a ZIM's own metadata and the
 * catalogue — the same archive is `wikipedia_en_simple_all` in one and
 * `wikipedia_en-simple_all` in the other. Collapse every separator so the two
 * compare equal.
 */
function normaliseName(name) {
  return String(name || '').toLowerCase().replace(/[-_\s]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Turn a pack name into something the catalogue's text search will match.
 *
 * Searching the full `wikipedia_en_simple_all` finds nothing, because "en" and
 * "all" appear in no title. Dropping the structural tokens leaves "wikipedia
 * simple", which finds it immediately.
 */
const NOISE_TOKENS = new Set([
  'all', 'nopic', 'maxi', 'mini', 'novid', 'nodet', 'nopet',
  'en', 'eng', 'fr', 'de', 'es', 'zh', 'hi', 'ja', 'ar', 'ru', 'pt', 'it',
]);

function searchTerms(packName) {
  const tokens = String(packName).split(/[-_\s]+/).filter(Boolean);
  const useful = tokens.filter((t) => !NOISE_TOKENS.has(t.toLowerCase()) && t.length > 1);
  return useful.length ? useful.join(' ') : tokens.join(' ');
}

/**
 * Find the current published build of a pack.
 *
 * A local file's metadata Name is usually `wikipedia_en_simple_all` with a
 * separate Flavour of `nopic`, but some packs fold the flavour into the name,
 * and separators vary. Try several queries and match loosely.
 */
async function findLatest(packName, flavour = '', title = '') {
  if (!packName) return null;

  const bare = flavour && packName.toLowerCase().endsWith(`_${flavour.toLowerCase()}`)
    ? packName.slice(0, -(flavour.length + 1))
    : packName;

  const targets = new Set([normaliseName(packName), normaliseName(bare)]);

  // Several queries, because the catalogue's text search is fussy.
  const queries = [];
  const terms = searchTerms(bare);
  if (terms) queries.push(terms);
  if (title) queries.push(title);
  queries.push(bare.split(/[-_]/)[0]);

  const seen = new Set();
  const candidates = [];

  for (const query of queries) {
    if (!query || seen.has(query)) continue;
    seen.add(query);

    let entries;
    try {
      entries = await search(query, { count: 60 });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const name = normaliseName(entry.name);
      const combined = normaliseName(entry.flavour ? `${entry.name}_${entry.flavour}` : entry.name);
      if (targets.has(name) || targets.has(combined)) candidates.push(entry);
    }
    if (candidates.length) break;
  }

  if (candidates.length === 0) return null;

  if (flavour) {
    const exact = candidates.filter((c) => normaliseName(c.flavour) === normaliseName(flavour));
    if (exact.length) {
      exact.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
      return exact[0];
    }
  }

  candidates.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
  return candidates[0];
}

/** Is the catalogue reachable right now? */
async function isOnline(timeout = 8000) {
  try {
    await fetchXml(`${CATALOG_BASE}/root.xml`, timeout);
    return true;
  } catch {
    return false;
  }
}

module.exports = { search, findLatest, isOnline, parseFeed, CATALOG_BASE };
