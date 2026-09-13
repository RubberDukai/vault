---
title: Build tracker
summary: Every feature requested, whether it is in the build yet, and what is waiting on a decision.
order: 0
---

# Build tracker

Every request, in the order it was made, with an honest status. Updated whenever something changes. If it is not on this list, it has fallen through a crack — say so.

**Status key**

| Mark | Meaning |
|---|---|
| **DONE** | Built, tested, committed |
| **PARTIAL** | Something is there, but not everything that was asked for — the note says what is missing |
| **OPEN** | Agreed, not started |
| **DECISION** | Waiting on your call before it can move |
| **ANSWERED** | A question rather than a build item; answered in conversation |

## Waiting on you

These cannot move until you say which way. Everything else that could be done without you has been.

| # | Decision | Options |
|---|---|---|
| D1 | Which sea charts to download | Europa (4.0 GB, all of it) · or Channel + North Sea + Northern Atlantic (3.3 GB, British waters only) |
| D2 | The reference packs | Wiktionary 8.5 GB · Wikibooks illustrated 5.75 GB · iFixit 3.3 GB — all, some, or none yet |
| D3 | Full English Wikipedia | Text-only 49 GB · or the top-million-articles cut at 16 GB · or not yet |
| D4 | Delete the superseded pack | `wikipedia_en_simple_all_nopic_2026-05.zim` (937 MB) is fully contained in the illustrated one |
| D5 | Rename the folder | `Documents\Ark` → `Documents\Vault`, then regenerate the Desktop shortcut |
| D7 | Which established texts to import | The importer is built and tested. Candidates: Hesperian's *Where There Is No Doctor* (PDF, ~30 MB, free) · OpenStax textbooks (PDF, 50–100 MB each — Biology, Physics, Chemistry, Algebra, Pre-algebra, US/World History) · CK-12 FlexBooks · more Gutenberg. Say which and they go on the shelf |

## 1. The core app — requested 9 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 1.1 | Local Wikipedia repository app | **DONE** | Pure-JS ZIM reader, no dependencies |
| 1.2 | Reads the date the copy was cloned | **DONE** | Shown on every pack, everywhere |
| 1.3 | Offers an update when a newer one exists | **DONE** | Checks the Kiwix catalogue, resumable download |
| 1.4 | No images, to keep the size down | **DONE** | Text-only packs; small illustrated ones added later by request (3.9) |
| 1.5 | Size prediction | **ANSWERED** | Tiered table; app itself is under 600 KB |
| 1.6 | Runs as a LAN server, any device with a browser | **DONE** | Prints the addresses on start |
| 1.7 | Runs as a desktop app | **PARTIAL** | Double-click launcher opens a chromeless app window. Not a packaged installer — no Electron. Good enough unless you want an .exe |
| 1.8 | Windows and Linux | **DONE** | `Vault.bat` / `vault.sh` / `vault.desktop`; no platform-specific code |
| 1.9 | Survivalist handbook framework + first chapters | **DONE** | 8 modules, 31 chapters, ~34,000 words. Every module now has at least two |
| 1.10 | Language learning: English + Japanese first, then Spanish, Mandarin, Hindi | **PARTIAL** | 455 cards with spaced repetition; written grammar guides for Japanese and Spanish. Missing: audio, Mandarin and Hindi guides — see 6.4 |
| 1.11 | Unified search across everything | **DONE** | Handbook, school, decks, guides, every pack, every book — one box, ~0.3 s |
| 1.12 | Education with per-child progress tracking | **PARTIAL** | Profiles + 13 lessons across 4 subjects. A real curriculum comes from imported textbooks — see D7 |
| 1.13 | Suggest other areas to build out | **ANSWERED** | Twelve proposed; see section 7 for which are built |

## 2. Launching and content questions — requested 9–10 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 2.1 | Simple click-an-icon launch | **DONE** | Desktop shortcut with the cog icon; port fallback; Node-missing message |
| 2.2 | What is Wiktionary | **ANSWERED** | The dictionary — 9.1 M entries, 8.5 GB |
| 2.3 | Drop Japanese Wikipedia; keep encyclopedias English-only | **DONE** | Language learning lives in-app |
| 2.4 | iFixit repair guides | **DECISION** | 3.3 GB — see D2 |
| 2.5 | Wikibooks | **DECISION** | 5.75 GB illustrated — see D2 |

## 3. Maps and reader — requested 10 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 3.1 | Back button to the previous article in the reader | **DONE** | Back/forward over article history, Alt+arrows |
| 3.2 | Offline Google-Maps equivalent, zoomable | **DONE** | PMTiles vector maps, canvas renderer, no library |
| 3.3 | Layers that switch on and off | **DONE** | POI categories, place names, overlays, your own drawings — all independent |
| 3.4 | Looks like a standard OS map | **PARTIAL** | A "paper" style, not Ordnance Survey's. OS Open Zoomstack is free and could be added as an OS-styled base |
| 3.5 | Points of interest: monuments, public buildings, infrastructure, farmland, water, shops with supplies | **DONE** | Nine categories chosen for usefulness |
| 3.6 | Road layers for navigation | **DONE** | Motorway down to footpath, styled by class |
| 3.7 | Ocean / nautical maps | **PARTIAL** | Reader validated against OpenSeaMap's test chart. No real chart downloaded — see D1 |
| 3.8 | Does it run on Linux | **ANSWERED** | Yes — see 1.8 |
| 3.9 | A small image collection for education | **DONE** | Vikidia, PhET, WikEM, illustrated Simple English — 3.85 GB, all verified serving images |
| 3.10 | Bulk out languages and education with established curricula | **PARTIAL** | The importer exists (5.4). Two Gutenberg books are on the shelf. The textbooks themselves are D7 |
| 3.11 | Bulk out the handbook, especially shelter building | **DONE** | 31 chapters. Shelter has three. Will keep growing, but no module is thin now |
| 3.12 | Rivers rendering as broken wedges | **DONE** | Rivers are lines; were being filled as polygons. Fixed |
| 3.13 | Buildings appearing and disappearing | **ANSWERED** | Not a bug — tiles only carry buildings from about zoom 13 |

## 4. Look, feel and social — requested 10 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 4.1 | Get the images | **DONE** | See 3.9 |
| 4.2 | Both layered: own writing + established resources | **DONE** | The handbook is the quick layer; the document importer (5.4) is the depth layer. What goes into it is D7 |
| 4.3 | Dark mode | **DONE** | |
| 4.4 | Light mode | **DONE** | |
| 4.5 | Pip-Boy mode: old screen effect, the font, changeable text colour | **DONE** | Scanlines, glow, flicker, monospace; five screen colours |
| 4.6 | Make the UI cool and fun to use | **DONE** | Themes, the cog, the mascot |
| 4.7 | Manual explaining how the app works and is built | **DONE** | Four pages plus this tracker, under the Manual tab |
| 4.8 | Chat over the local network, with a setup guide | **DONE** | Comms tab with channels; guide is Manual → Setting up outpost comms |
| 4.9 | Footer credit: prepared by Joseph Watkins, and why | **DONE** | |
| 4.10 | Draw on the map: paint, erase, toggle the layer | **DONE** | |
| 4.11 | Colour palette and pen sizes | **DONE** | Seven colours, four widths |
| 4.12 | Plot routes and add new features to areas | **DONE** | Freehand lines with their length shown, labelled pins, a measuring tape, named layers — all shared across the network |
| 4.13 | Remove handbook links from the home page | **DONE** | |
| 4.14 | Home as a friendly, Fallout-like welcome and guide | **DONE** | |
| 4.15 | Logo changed to a cog | **DONE** | Generated from code, no image file |
| 4.16 | Rebrand Ark → Vault | **PARTIAL** | App, launchers, CLI, docs all renamed. The folder is still `Ark` — see D5 |
| 4.17 | Vault Boy ASCII mascot on the home page | **DONE** | Your art, exactly as supplied |

## 5. Backup, sharing, and the autonomous run — 11–13 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 5.1 | Back up to GitHub | **DONE** | github.com/RubberDukai/vault, private. Push after each session |
| 5.2 | How to share with others — a folder to copy | **DONE** | `node tools/make-portable.js <where> --with-packs --with-maps`; writes a START HERE.txt |
| 5.3 | A tracker so nothing falls through the cracks | **DONE** | This file. Also under the Manual tab |
| 5.4 | Document importer (from "both layered") | **DONE** | PDF and EPUB, dependency-free. Drop files in `library/docs`; they appear on the Library shelf, open in a reader with contents, and every page or chapter is in search. Validated on real PDFs from three generators and two Gutenberg books |
| 5.5 | Search regression | **DONE** | Five packs pushed a query to 49 s; in-memory title indexes bring it to 0.2 s |
| 5.6 | Print view | **DONE** | One button on every chapter, lesson, guide and manual page; prints clean or saves as PDF |
| 5.7 | Almanac | **DONE** | Sunrise, sunset, twilight, sun bearing, moon phase — computed, on the Maps tab, verified to the minute |

## 6. Known thin spots

Not separate requests — the places where a "done" is doing less than it should.

| # | Area | State |
|---|---|---|
| 6.1 | Fire module | Resolved — 4 chapters |
| 6.2 | Computing module | Resolved — 3 chapters |
| 6.3 | Comms module | Resolved — 6 chapters, incl. Meshtastic step by step and a plan template |
| 6.4 | Languages | Guides for Japanese and Spanish; none yet for Mandarin or Hindi. No audio. Kanji stops at 40 |
| 6.5 | School | 13 lessons. Real depth comes from imported textbooks (D7) |
| 6.6 | Medical | Childbirth and mental health now covered. Still nothing on chronic conditions — diabetes, asthma, epilepsy, heart disease without a pharmacy |
| 6.7 | Maps | Pins and lengths done. Still no offline place-name search, no elevation, no OS style |
| 6.8 | Food | Nothing yet on livestock in depth, or on hunting, trapping and fishing |
| 6.9 | Water | Nothing yet on wells in depth, or on drought |

## 7. Proposed, not yet requested

Modules suggested on day one. Listed so they are not forgotten, not because they are owed.

| Module | State |
|---|---|
| Navigation without GPS | Covered in the offline maps chapter, the map-reading lesson, and the almanac |
| Repair & making | Nothing written; iFixit pack would be the depth layer (D2) |
| Livestock & bees | A paragraph in the food chapter |
| Weather & seasons | Covered in the Earth and weather lesson |
| Almanac | **Done** (5.7) |
| Community, records & the family vault | Nothing |
| Print / PDF export | **Done** (5.6) |
| Packaged desktop installer (.exe / .deb) | Nothing — see 1.7 |
