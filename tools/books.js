'use strict';
/**
 * The reading shelf: public-domain books from Project Gutenberg, grouped by
 * the age they suit, as three packs for the Setup page. Ids verified against
 * gutenberg.org on 2026-09-22; sizes are the EPUB-with-images editions.
 */

const shelf = (id, title, size) => ({ id, title, size });

const KS1 = [
  shelf(14838, 'The Tale of Peter Rabbit — Beatrix Potter', 1508269),
  shelf(21, "Aesop's Fables", 600399),
  shelf(2591, "Grimms' Fairy Tales", 531353),
  shelf(27200, 'Fairy Tales of Hans Christian Andersen', 910385),
  shelf(2781, 'Just So Stories — Rudyard Kipling', 135150),
  shelf(19722, "A Child's Garden of Verses — Robert Louis Stevenson", 2807222),
  shelf(13650, 'Nonsense Books — Edward Lear', 2683597),
  shelf(19033, "Alice's Adventures in Wonderland — Lewis Carroll (illustrated)", 1902394),
  shelf(55, 'The Wonderful Wizard of Oz — L. Frank Baum', 348844),
  shelf(500, 'The Adventures of Pinocchio — Carlo Collodi', 167220),
];

const KS2 = [
  shelf(289, 'The Wind in the Willows — Kenneth Grahame', 369406),
  shelf(113, 'The Secret Garden — Frances Hodgson Burnett', 270456),
  shelf(1874, 'The Railway Children — E. Nesbit', 211161),
  shelf(778, 'Five Children and It — E. Nesbit', 195841),
  shelf(501, 'The Story of Doctor Dolittle — Hugh Lofting', 2099442),
  shelf(271, 'Black Beauty — Anna Sewell', 419740),
  shelf(1448, 'Heidi — Johanna Spyri', 258049),
  shelf(16, 'Peter Pan — J. M. Barrie', 390214),
  shelf(236, 'The Jungle Book — Rudyard Kipling', 11173916),
  shelf(120, 'Treasure Island — Robert Louis Stevenson', 49430322),
  shelf(421, 'Kidnapped — Robert Louis Stevenson', 20141115),
  shelf(964, 'The Merry Adventures of Robin Hood — Howard Pyle', 318613),
  shelf(573, 'Tales from Shakespeare — Charles and Mary Lamb', 299936),
  shelf(128, 'The Arabian Nights — Andrew Lang', 324245),
  shelf(976, 'Tanglewood Tales (Greek myths) — Nathaniel Hawthorne', 224455),
  shelf(32242, 'A Wonder Book (Greek myths) — Nathaniel Hawthorne', 4579180),
  shelf(3836, 'Swiss Family Robinson — Johann Wyss', 388598),
  shelf(74, 'The Adventures of Tom Sawyer — Mark Twain', 16671157),
  shelf(45, 'Anne of Green Gables — L. M. Montgomery', 547669),
  shelf(514, 'Little Women — Louisa May Alcott', 549228),
  shelf(479, 'Little Lord Fauntleroy — Frances Hodgson Burnett', 203581),
  shelf(1018, 'The Water-Babies — Charles Kingsley', 25691310),
  shelf(12, 'Through the Looking-Glass — Lewis Carroll', 518736),
  shelf(646, 'The Coral Island — R. M. Ballantyne', 1443620),
  shelf(215, 'The Call of the Wild — Jack London', 226777),
  shelf(103, 'Around the World in Eighty Days — Jules Verne', 441284),
];

const KS3 = [
  shelf(76, 'Adventures of Huckleberry Finn — Mark Twain', 16020394),
  shelf(910, 'White Fang — Jack London', 424159),
  shelf(164, 'Twenty Thousand Leagues under the Sea — Jules Verne', 3224385),
  shelf(35, 'The Time Machine — H. G. Wells', 305465),
  shelf(36, 'The War of the Worlds — H. G. Wells', 290550),
  shelf(1661, 'The Adventures of Sherlock Holmes — Arthur Conan Doyle', 378183),
  shelf(244, 'A Study in Scarlet — Arthur Conan Doyle', 383262),
  shelf(2097, 'The Sign of the Four — Arthur Conan Doyle', 363908),
  shelf(2852, 'The Hound of the Baskervilles — Arthur Conan Doyle', 315002),
  shelf(43, 'Dr Jekyll and Mr Hyde — Robert Louis Stevenson', 302734),
  shelf(46, 'A Christmas Carol — Charles Dickens', 641636),
  shelf(730, 'Oliver Twist — Charles Dickens', 505331),
  shelf(1400, 'Great Expectations — Charles Dickens', 14379275),
  shelf(98, 'A Tale of Two Cities — Charles Dickens', 7914349),
  shelf(1260, 'Jane Eyre — Charlotte Brontë', 3088381),
  shelf(1342, 'Pride and Prejudice — Jane Austen', 24846132),
  shelf(84, 'Frankenstein — Mary Shelley', 473485),
  shelf(82, 'Ivanhoe — Walter Scott', 3335622),
  shelf(1257, 'The Three Musketeers — Alexandre Dumas', 840840),
  shelf(521, 'Robinson Crusoe — Daniel Defoe', 337915),
  shelf(829, "Gulliver's Travels — Jonathan Swift", 739011),
  shelf(1727, 'The Odyssey — Homer (Butler)', 445815),
  shelf(6130, 'The Iliad — Homer', 2292231),
  shelf(2701, 'Moby Dick — Herman Melville', 835402),
  shelf(100, 'The Complete Works of William Shakespeare', 2869669),
];

const safeName = (t) => t.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

function pack(id, title, description, list, priority, recommended) {
  return {
    id, category: 'books', title, description,
    size: list.reduce((n, b) => n + b.size, 0),
    dest: 'library/docs', priority, recommended,
    files: list.map((b) => ({
      url: `https://www.gutenberg.org/cache/epub/${b.id}/pg${b.id}-images.epub`,
      filename: `Reading shelf - ${safeName(b.title)}.epub`,
    })),
  };
}

const BOOK_PACKS = [
  pack('reading-shelf-ks1', 'Reading shelf — first books, ages 4 to 7',
    'Ten books to read aloud and then to read alone: Peter Rabbit, Aesop, Grimm, Andersen, Just So Stories, A Child\'s Garden of Verses, Lear\'s nonsense, Alice, Oz, Pinocchio. Public domain, from Project Gutenberg, with the original illustrations.',
    KS1, 22, true),
  pack('reading-shelf-ks2', 'Reading shelf — ages 7 to 11',
    'Twenty-six of the books children have grown up on for a century: The Wind in the Willows, The Secret Garden, The Railway Children, Doctor Dolittle, Black Beauty, Heidi, Peter Pan, The Jungle Book, Treasure Island, Kidnapped, Robin Hood, Tales from Shakespeare, the Arabian Nights, the Greek myths, Swiss Family Robinson, Tom Sawyer, Anne of Green Gables, Little Women, Through the Looking-Glass, The Call of the Wild, Around the World in Eighty Days and more. Public domain, from Project Gutenberg.',
    KS2, 23, true),
  pack('reading-shelf-ks3', 'Reading shelf — ages 11 and up',
    'Twenty-five classics for the older reader: Huckleberry Finn, White Fang, Jules Verne, H. G. Wells, all four Sherlock Holmes novels, Jekyll and Hyde, four Dickens, Jane Eyre, Pride and Prejudice, Frankenstein, Ivanhoe, The Three Musketeers, Robinson Crusoe, Gulliver, the Odyssey and the Iliad, Moby Dick, and the complete Shakespeare. Public domain, from Project Gutenberg.',
    KS3, 24, true),
];

module.exports = { BOOK_PACKS };
