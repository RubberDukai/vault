'use strict';
/**
 * Generates content/packs.json — the catalogue the Setup page offers.
 *
 * Every address belongs to someone else: Kiwix, OpenStax, Hesperian,
 * OpenSeaMap, Project Gutenberg. They give this away. Sizes come from the
 * live servers at generation time, so what the Setup page says is what
 * will actually download.
 *
 *   node tools/make-manifest.js [openstax-books.json]
 *
 * The OpenStax list is fetched from their API when no file is given.
 */

const fs = require('node:fs');
const path = require('node:path');

const items = [];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------------------------------------------------------------- packs

function kiwix(id, title, description, url, size, category, priority, recommended = true) {
  items.push({
    id, category, title, description, size, dest: 'library', priority, recommended,
    files: [{ url, filename: url.split('/').pop() }],
  });
}

kiwix('wikipedia-en', 'English Wikipedia — full, text only',
  'Every article, 19 million of them, no images. The big one.',
  'https://lb.download.kiwix.org/zim/wikipedia/wikipedia_en_all_nopic_2026-06.zim', 52690707456, 'encyclopedia', 90);
kiwix('wikipedia-simple', 'Simple English Wikipedia, illustrated',
  'Plain-language articles with pictures. The right first encyclopedia for children.',
  'https://lb.download.kiwix.org/zim/wikipedia/wikipedia_en-simple_all_maxi_2026-06.zim', 3503725568, 'encyclopedia', 20);
kiwix('vikidia', "Vikidia — children's encyclopedia, illustrated",
  '9,000 articles written for 8-to-13-year-olds, with pictures. 100 MB.',
  'https://lb.download.kiwix.org/zim/vikidia/vikidia_en_all_maxi_2026-06.zim', 107858893, 'education', 10);
kiwix('phet', 'PhET — interactive science simulations',
  '120 physics, chemistry and maths simulations that run in the browser. A science lab in 100 MB.',
  'https://lb.download.kiwix.org/zim/phet/phet_en_all_2026-08.zim', 108981169, 'education', 11);
kiwix('wikem', 'WikEM — emergency medicine, illustrated',
  "The emergency physician's reference: presentations, treatments, doses, with diagrams.",
  'https://lb.download.kiwix.org/zim/other/wikem_en_all_maxi_2026-07.zim', 374632362, 'medical', 12);
kiwix('wiktionary-en', 'Wiktionary — the dictionary',
  '9 million entries: definitions, pronunciation, etymology, and translations into hundreds of languages. The backbone of the language section.',
  'https://lb.download.kiwix.org/zim/wiktionary/wiktionary_en_all_nopic_2026-08.zim', 9156425728, 'reference', 40);
kiwix('wikibooks-en', 'Wikibooks — open textbooks, illustrated',
  'Free textbooks with pictures: cookery, first aid, carpentry, electronics, mathematics, languages.',
  'https://lb.download.kiwix.org/zim/wikibooks/wikibooks_en_all_maxi_2026-04.zim', 6177865728, 'reference', 41);
kiwix('ifixit-en', 'iFixit — repair guides',
  '100,000 step-by-step repair guides with photographs: phones, laptops, appliances, vehicles, tools.',
  'https://lb.download.kiwix.org/zim/ifixit/ifixit_en_all_2025-12.zim', 3570696192, 'reference', 42);
kiwix('wikivoyage-en', 'Wikivoyage — travel guide, illustrated',
  'Every country and major city: how to get there, what is where, what to know. For any long journey.',
  'https://lb.download.kiwix.org/zim/wikivoyage/wikivoyage_en_all_maxi_2026-06.zim', 1139962880, 'reference', 43);
kiwix('wikiversity-en', 'Wikiversity — courses and learning materials',
  'Free courses and study guides across every subject.',
  'https://lb.download.kiwix.org/zim/wikiversity/wikiversity_en_all_nopic_2026-08.zim', 1629888512, 'education', 44);
kiwix('archwiki', 'ArchWiki — the Linux reference',
  'The best Linux documentation there is, in 36 MB. For keeping the machines alive.',
  'https://lb.download.kiwix.org/zim/other/archlinux_en_all_maxi_2026-07.zim', 35601408, 'reference', 45);

// ------------------------------------------------------------ medical

const wtndKB = {
  fm: 355, '01': 441, '02': 282, '03': 341, '04': 202, '05': 183, '06': 209, '07': 183, '08': 252,
  '09': 617, 10: 865, 11: 993, 12: 507, 13: 605, 14: 363, 15: 972, 16: 410, 17: 209, 18: 344,
  19: 690, 20: 443, 21: 1072, 22: 245, 23: 186, bm: 502,
};
const wtndChapters = ['fm', ...Array.from({ length: 23 }, (_, i) => String(i + 1).padStart(2, '0')), 'bm'];
items.push({
  id: 'where-there-is-no-doctor', category: 'medical',
  title: 'Where There Is No Doctor (2025 edition)',
  description: "Hesperian's village health guide — the most widely used medical manual in the world for exactly this situation. 25 chapter files, 11 MB.",
  size: Object.values(wtndKB).reduce((n, k) => n + k * 1024, 0),
  dest: 'library/docs', priority: 1, recommended: true,
  files: wtndChapters.map((ch) => ({
    url: `https://hesperian.org/wp-content/uploads/pdf/en_wtnd_2025/en_wtnd_2025_${ch}.pdf`,
    filename: `Where There Is No Doctor 2025 - ${ch === 'fm' ? '00 Front matter' : ch === 'bm' ? '99 Back matter' : 'Chapter ' + ch}.pdf`,
  })),
});

// ---------------------------------------------------------- sea charts

const CHART_BASE = 'https://ftp.gwdg.de/pub/misc/openstreetmap/openseamap/charts/mbtiles/';
function chart(id, region, title, description, size, priority, recommended = true) {
  items.push({
    id, category: 'charts', title, description, size, dest: 'library/maps', priority, recommended,
    files: [{ url: `${CHART_BASE}OSM-OpenCPN2-${region}.mbtiles`, filename: `OpenSeaMap - ${region}.mbtiles` }],
  });
}

chart('chart-channel', 'Channel', 'Sea chart — English Channel', 'The south coast of England and the French side.', 613490688, 50);
chart('chart-north-sea', 'NorthSea', 'Sea chart — North Sea', 'The east coast up to Scotland, across to Norway and Denmark.', 2011799552, 51);
chart('chart-northern-atlantic', 'NorthernAtlantic', 'Sea chart — Northern Atlantic', 'The west coast, Ireland, the Western Isles, out to Iceland.', 680382464, 52);
chart('chart-biscay', 'GulfOfBiscay', 'Sea chart — Bay of Biscay', 'Cornwall down the French coast to Spain.', 439427072, 53);
chart('chart-europe', 'Europa1', 'Sea chart — Europe', 'All European waters in one file.', 4036505600, 54);
chart('chart-med-west', 'MediWest', 'Sea chart — Western Mediterranean', 'Gibraltar to Italy.', 1333149696, 55);
chart('chart-med-east', 'MediEast', 'Sea chart — Eastern Mediterranean', 'Italy to Suez and the Levant.', 1701724160, 56);
chart('chart-baltic', 'Baltic', 'Sea chart — Baltic', 'Denmark, Sweden, Finland, the Baltic states.', 1832124416, 57, false);
chart('chart-adriatic', 'Adria', 'Sea chart — Adriatic', 'Italy to Croatia and Greece.', 698314752, 58, false);
chart('chart-arabian-sea', 'ArabianSea', 'Sea chart — Arabian Sea', 'Red Sea approaches, the Gulf, and the west coast of India. The westbound route from Asia.', 759566336, 60);
chart('chart-bengal', 'GulfOfBengal', 'Sea chart — Bay of Bengal', "India's east coast to Burma.", 170508288, 61);
chart('chart-south-china-sea', 'SouthChineseSea', 'Sea chart — South China Sea', 'Singapore, Malaysia, Vietnam, the Philippines.', 1225560064, 62);
chart('chart-east-china-sea', 'EastChineseSea', 'Sea chart — East China Sea and Japan', 'Japan, Korea, Taiwan and the Chinese coast. Where the voyage starts.', 613122048, 63);
chart('chart-south-pacific', 'SouthPacificIslands', 'Sea chart — South Pacific islands', 'The island route east across the Pacific.', 711946240, 64);
chart('chart-us-west-coast', 'USWestCoast', 'Sea chart — US West Coast', 'Alaska to Mexico. The eastbound landfall.', 748351488, 65);
chart('chart-caribbean', 'Caribbean', 'Sea chart — Caribbean', 'Panama, the islands, the Gulf of Mexico.', 1029226496, 66);
chart('chart-magellan', 'MagellanStrait', 'Sea chart — Strait of Magellan', 'Round Cape Horn. 77 MB.', 77148160, 67);
chart('chart-northwest-passage', 'NorthWestPassage', 'Sea chart — Northwest Passage', 'The Arctic route over Canada, for a warmer world.', 423706624, 68);

// ---------------------------------------------------------------- books

function gutenberg(id, num, title, description, size, priority = 35) {
  items.push({
    id, category: 'books', title, description, size, dest: 'library/docs', priority, recommended: true,
    files: [{ url: `https://www.gutenberg.org/cache/epub/${num}/pg${num}-images.epub`, filename: `${title}.epub` }],
  });
}
gutenberg('book-woodcraft-camping', 34607, 'Woodcraft and Camping - Nessmuk (1920)', 'The classic of American woodcraft.', 663828);
gutenberg('book-boy-scouts-handbook', 29558, 'Boy Scouts Handbook (1911)', 'The original: knots, camping, tracking, first aid, signalling, hundreds of illustrations.', 8378001);

// ------------------------------------------------------------ textbooks

const CORE = /biology 2e|concepts of biology|college physics 2e|^physics$|^chemistry 2e$|anatomy and physiology|microbiology|astronomy|prealgebra|elementary algebra|intermediate algebra|^college algebra 2e$|precalculus|calculus volume|introductory statistics|^statistics$|algebra 1|contemporary mathematics|world history|u\.s\. history|psychology 2e|principles of economics|introduction to computer science|introduction to python|writing guide|introduction to philosophy|introduction to sociology|american government|lifespan development|university physics|organic chemistry|nursing|nutrition|pharmacology/i;

async function openstaxBooks(fromFile) {
  if (fromFile) return JSON.parse(fs.readFileSync(fromFile, 'utf8'));

  const list = (await (await fetch('https://openstax.org/apps/cms/api/v2/pages/?type=books.Book&limit=200')).json()).items || [];
  const out = [];
  const queue = [...list];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const b = queue.shift();
      try {
        const d = await (await fetch(`https://openstax.org/apps/cms/api/v2/pages/${b.id}/`)).json();
        const url = d.high_resolution_pdf_url || d.low_resolution_pdf_url;
        if (d.book_state !== 'live' || !url) continue;
        let size = 0;
        try {
          const h = await fetch(url, { method: 'HEAD', redirect: 'follow' });
          size = Number(h.headers.get('content-length') || 0);
        } catch { /* keep 0 */ }
        out.push({ title: d.title, url, size, subject: (d.book_subjects || []).map((s) => s.subject_name).join(', ') });
      } catch { /* skip */ }
    }
  }));
  return out;
}

const { TILESETS } = require('./tilesets');

async function main() {
  items.push(...TILESETS);
  const books = await openstaxBooks(process.argv[2]);
  for (const b of books) {
    if (!b.size) continue;
    items.push({
      id: `openstax-${slug(b.title)}`, category: 'textbooks',
      title: b.title,
      description: `OpenStax · ${b.subject || 'textbook'}. Peer-reviewed, openly licensed.`,
      size: b.size, dest: 'library/docs', priority: 30, recommended: CORE.test(b.title),
      files: [{ url: b.url, filename: `OpenStax - ${b.title.replace(/[\\/:*?"<>|]/g, '-')}.pdf` }],
    });
  }

  const manifest = {
    version: 1,
    updated: new Date().toISOString().slice(0, 10),
    note: 'Every address here belongs to someone else — Kiwix, OpenStax, Hesperian, OpenSeaMap, Project Gutenberg. They give this away. If the Vault is ever shared widely, mirror these files rather than sending thousands of people to nonprofit servers.',
    categories: [
      { id: 'medical', title: 'Medical' },
      { id: 'encyclopedia', title: 'Encyclopedias' },
      { id: 'reference', title: 'Reference' },
      { id: 'education', title: 'Education' },
      { id: 'textbooks', title: 'Textbooks (OpenStax)' },
      { id: 'books', title: 'Books' },
      { id: 'maps', title: 'Maps (offline)' },
      { id: 'charts', title: 'Sea charts' },
      { id: 'imagery', title: 'Satellite & terrain' },
    ],
    items: items.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title)),
  };

  const outPath = path.join(__dirname, '..', 'content', 'packs.json');
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

  const gb = (n) => (n / 1073741824).toFixed(2);
  console.log(`Wrote ${outPath}`);
  console.log(`  ${items.length} items · everything ${gb(items.reduce((n, i) => n + i.size, 0))} GB · recommended ${gb(items.filter((i) => i.recommended).reduce((n, i) => n + i.size, 0))} GB`);
  for (const c of manifest.categories) {
    const cs = items.filter((i) => i.category === c.id);
    console.log(`  ${c.title.padEnd(22)} ${String(cs.length).padStart(3)} items  ${gb(cs.reduce((n, i) => n + i.size, 0)).padStart(6)} GB`);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
