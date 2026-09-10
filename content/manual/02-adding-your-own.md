---
title: Adding your own content
summary: Everything here is a plain file. How to add chapters, decks, lessons, packs and maps.
order: 2
---

# Adding your own content

None of this is locked. Every part of the library is a file you can open in a text editor, and the Vault picks up changes when it restarts.

## A handbook chapter

Create a markdown file in `content/handbook/<module>/`. For example `content/handbook/water/rainwater.md`:

```
---
title: Harvesting rainwater
summary: One line describing what this covers.
priority: 4
tags: [water, roof, storage]
---

# Harvesting rainwater

Your text here. Ordinary markdown works: headings, lists,
tables, **bold**, `code`, and links.
```

The block between the `---` lines is the frontmatter — it tells the Vault the title, the one-line summary shown in listings, and `priority`, which controls the order chapters appear in (lower comes first).

To create a whole new module, make a folder and drop a `module.json` in it:

```
{
  "title": "Livestock & Bees",
  "order": 9,
  "summary": "Keeping animals that keep you."
}
```

Restart, and it appears — in the handbook, and in search.

## A callout box

Two forms are recognised, for the things that matter:

```
> **Warning** Never burn charcoal indoors.

> **Note** Season firewood a year ahead.
```

Warnings are drawn in red, notes in the accent colour. Use warnings sparingly, for things that will actually hurt someone.

## A language deck

A JSON file in `content/languages/<language>/`, for example `content/languages/japanese/numbers.json`:

```
{
  "title": "Counting",
  "description": "Numbers and counters.",
  "order": 4,
  "cards": [
    { "front": "一", "reading": "ichi", "back": "1" },
    { "front": "二", "reading": "ni", "back": "2", "note": "Optional extra." }
  ]
}
```

`front` is what you are shown, `back` is the answer, `reading` is pronunciation revealed with the answer, and `note` is any extra detail. New cards enter the schedule automatically.

To add a whole language, make the folder and add `language.json`:

```
{
  "name": "Welsh",
  "nativeName": "Cymraeg",
  "order": 5,
  "notes": "Anything worth knowing before starting."
}
```

## A school lesson

Markdown in `content/education/<subject>/`, with `ages` and `order` in the frontmatter:

```
---
title: Fractions
ages: 9-13
stage: Core
order: 3
summary: What the numbers mean and how to work with them.
---
```

Lessons are written to be taught by an adult who is not a teacher. The pattern that works: explain the idea to the adult first, then how to teach it, then exercises with answers, then how to tell whether the child has actually understood.

## Encyclopedia packs

Drop `.zim` files into `library/` and press **Rescan folder** on the Library tab, or use **Get packs** to search the Kiwix catalogue and download with resume support.

Good ones beyond Wikipedia: Wiktionary (a real dictionary), Wikibooks (open textbooks), iFixit (repair guides), WikEM (emergency medicine), Project Gutenberg (books), Wikivoyage.

## Maps

Drop `.pmtiles` or `.mbtiles` files into `library/maps/`. See the handbook chapter **Getting offline maps** for how to cut a regional extract.

To browse a map archive over the internet without downloading it, put a text file in the same folder — say `planet.url` — containing one line with its address.

## Editing what is already here

Everything shipped with the Vault is fair game. If a chapter is wrong for where you live, fix it. If the chlorine dose in your bleach is different, change the number. If you learn something worth knowing, write it down — that is the entire point of the thing.

Keep a copy of your edits somewhere separate before updating the Vault itself, so an update cannot overwrite your work.

## The house style, if you want to match it

- Lead with the thing that matters. People in a hurry stop reading early.
- Numbers with units, always. "2 drops per litre", not "a couple of drops".
- Say why, not just what. A rule you understand is one you can adapt when the situation does not match the book.
- Warnings before the step they apply to, never after.
- Assume the reader is tired, worried and reading this for the first time.
