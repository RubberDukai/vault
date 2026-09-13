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

These cannot move until you say which way.

| # | Decision | Options |
|---|---|---|
| D1 | Which sea charts to download | Europa (4.0 GB, all of it) · or Channel + North Sea + Northern Atlantic (3.3 GB, British waters only) |
| D2 | The reference packs | Wiktionary 8.5 GB · Wikibooks illustrated 5.75 GB · iFixit 3.3 GB — all, some, or wait for the importer |
| D3 | Full English Wikipedia | Text-only 49 GB · or the top-million-articles cut at 16 GB · or not yet |
| D4 | Delete the superseded pack | `wikipedia_en_simple_all_nopic_2026-05.zim` (937 MB) is fully contained in the illustrated one |
| D5 | Rename the folder | `Documents\Ark` → `Documents\Vault`, then regenerate the Desktop shortcut |
| D6 | What to build next | The PDF/EPUB importer · more handbook chapters (fire, computing, comms are thinnest) · or map labels and route measuring |

## 1. The core app — requested 9 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 1.1 | Local Wikipedia repository app | **DONE** | Pure-JS ZIM reader, no dependencies |
| 1.2 | Reads the date the copy was cloned | **DONE** | Shown on every pack, everywhere |
| 1.3 | Offers an update when a newer one exists | **DONE** | Checks the Kiwix catalogue, resumable download |
| 1.4 | No images, to keep the size down | **DONE** | Text-only packs; illustrated ones added later by request (see 4.1) |
| 1.5 | Size prediction | **ANSWERED** | Tiered table; app itself is 428 KB |
| 1.6 | Runs as a LAN server, any device with a browser | **DONE** | Prints the addresses on start |
| 1.7 | Runs as a desktop app | **PARTIAL** | Double-click launcher opens a chromeless app window. Not a packaged installer — no Electron. Good enough unless you want an .exe |
| 1.8 | Windows and Linux | **DONE** | `Vault.bat` / `vault.sh` / `vault.desktop`; no platform-specific code |
| 1.9 | Survivalist handbook framework + first chapters | **DONE** | 8 modules, 23 chapters, 24,500 words — see section 6 for what is still thin |
| 1.10 | Language learning: English + Japanese first, then Spanish, Mandarin, Hindi | **PARTIAL** | 238 cards with spaced repetition; all 46 hiragana. Still shallow — see 6.4 |
| 1.11 | Unified search across everything | **DONE** | Handbook, school, decks, every pack, one box |
| 1.12 | Education with per-child progress tracking | **PARTIAL** | Profiles + 7 lessons. Curriculum is thin — see 6.5 |
| 1.13 | Suggest other areas to build out | **ANSWERED** | Twelve proposed; see section 7 for which are built |

## 2. Launching and content questions — requested 9–10 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 2.1 | Simple click-an-icon launch | **DONE** | Desktop shortcut with the cog icon; port fallback; Node-missing message |
| 2.2 | What is Wiktionary | **ANSWERED** | The dictionary — 9.1 M entries, 8.5 GB (corrected from my earlier 3 GB) |
| 2.3 | Drop Japanese Wikipedia; keep encyclopedias English-only | **DONE** | Language learning lives in-app, costs ~50 KB |
| 2.4 | iFixit repair guides | **DECISION** | 3.3 GB — see D2 |
| 2.5 | Wikibooks | **DECISION** | 5.75 GB illustrated — see D2 |

## 3. Maps and reader — requested 10 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 3.1 | Back button to the previous article in the reader | **DONE** | Back/forward over article history, Alt+arrows |
| 3.2 | Offline Google-Maps equivalent, zoomable | **DONE** | PMTiles vector maps, canvas renderer, no library |
| 3.3 | Layers that switch on and off | **DONE** | POI categories, place names, overlays, your own drawings — all independent |
| 3.4 | Looks like a standard OS map | **PARTIAL** | A "paper" style, not Ordnance Survey's. OS Open Zoomstack is free and could be added as a real OS-styled base |
| 3.5 | Points of interest: monuments, public buildings, infrastructure, farmland, water, shops with supplies | **DONE** | Nine categories chosen for usefulness; farmland is drawn as land cover |
| 3.6 | Road layers for navigation | **DONE** | Motorway down to footpath, styled by class |
| 3.7 | Ocean / nautical maps | **PARTIAL** | Reader built and validated against OpenSeaMap's test chart. No real chart downloaded yet — see D1 |
| 3.8 | Does it run on Linux | **ANSWERED** | Yes — see 1.8 |
| 3.9 | A small image collection for education | **DONE** | Vikidia, PhET, WikEM, illustrated Simple English — 3.85 GB total, all verified serving images |
| 3.10 | Bulk out languages and education with established curricula | **OPEN** | The "both layered" plan: needs the PDF/EPUB importer for OpenStax, CK-12, Hesperian. Not started — see D6 |
| 3.11 | Bulk out the handbook, especially shelter building | **PARTIAL** | Shelter went from 1 chapter to 3. Six chapters added on 11 Sep. Fire, computing and comms still thin |
| 3.12 | Rivers rendering as broken wedges | **DONE** | Real bug: rivers are lines, were being filled as polygons. Fixed 11 Sep |
| 3.13 | Buildings appearing and disappearing | **ANSWERED** | Not a bug — tiles only carry buildings from about zoom 13 |

## 4. Look, feel and social — requested 10 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 4.1 | Get the images | **DONE** | See 3.9 |
| 4.2 | Both layered: own writing + established resources | **OPEN** | Own writing is the handbook; the importer for the rest is D6 |
| 4.3 | Dark mode | **DONE** | |
| 4.4 | Light mode | **DONE** | |
| 4.5 | Pip-Boy mode: old screen effect, the font, changeable text colour | **DONE** | Scanlines, glow, flicker, monospace; green / amber / blue / white / red |
| 4.6 | Make the UI cool and fun to use | **DONE** | Themes, the cog, the mascot. Always more possible |
| 4.7 | Manual explaining how the app works and is built | **DONE** | Four pages under the Manual tab |
| 4.8 | Chat over the local network, with a setup guide | **DONE** | Comms tab with channels; guide is Manual → Setting up outpost comms |
| 4.9 | Footer credit: prepared by Joseph Watkins, and why | **DONE** | |
| 4.10 | Draw on the map: paint, erase, toggle the layer | **DONE** | |
| 4.11 | Colour palette and pen sizes | **DONE** | Seven colours, four widths |
| 4.12 | Plot routes and add new features to areas | **PARTIAL** | Freehand drawing on named layers, shared across the network. Missing: text labels, point markers, and measuring the length of a drawn route |
| 4.13 | Remove handbook links from the home page | **DONE** | |
| 4.14 | Home as a friendly, Fallout-like welcome and guide | **DONE** | |
| 4.15 | Logo changed to a cog | **DONE** | Generated from code, no image file |
| 4.16 | Rebrand Ark → Vault | **PARTIAL** | App, launchers, CLI, docs all renamed. The folder is still `Ark` — see D5 |
| 4.17 | Vault Boy ASCII mascot on the home page | **DONE** | Your art, exactly as supplied |

## 5. Backup and sharing — requested 11 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 5.1 | Back up to GitHub | **DONE** | github.com/RubberDukai/vault, private, tracking `origin/main` |
| 5.2 | How to share with others — a folder to copy | **DONE** | `node tools/make-portable.js <where> --with-packs --with-maps`; writes a START HERE.txt |
| 5.3 | A tracker so nothing falls through the cracks | **DONE** | This file. Also under the Manual tab |

## 6. Known thin spots

Not separate requests — the places where a "done" is doing less than it should.

| # | Area | State |
|---|---|---|
| 6.1 | Fire module | 2 chapters. Missing: cooking without a kitchen, charcoal in depth, fuel storage |
| 6.2 | Computing module | 1 chapter. Missing: Raspberry Pi as the Vault host, keeping software offline, Faraday storage in detail |
| 6.3 | Comms module | 4 chapters but none on Meshtastic setup step by step, or on a communications plan template |
| 6.4 | Languages | Phrase and word decks only. No grammar, no sentence practice, no katakana or kanji, no audio |
| 6.5 | School | 7 lessons. A real curriculum is hundreds. This is what the importer (D6) is for |
| 6.6 | Medical | Nothing yet on childbirth, chronic conditions, or mental health under stress |
| 6.7 | Maps | No text labels or pins on drawings; no route length; no offline place-name search; no elevation |

## 7. Proposed, not yet requested

Modules I suggested on day one that you have not asked for. Listed so they are not forgotten, not because they are owed.

| Module | State |
|---|---|
| Navigation without GPS | Covered as a section of the offline maps chapter |
| Repair & making | Nothing written; iFixit pack would be the depth layer (D2) |
| Livestock & bees | A paragraph in the food chapter |
| Weather & seasons | Nothing |
| Almanac tools: sunrise, sunset, moon phase, tides, computed offline | Nothing — a small, satisfying build |
| Community, records & the family vault | Nothing |
| Print / PDF export of the pages worth having on paper | Nothing — and argued for in the handbook itself |
| Packaged desktop installer (.exe / .deb) | Nothing — see 1.7 |
