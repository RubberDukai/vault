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

| # | Decision | Options |
|---|---|---|
| D5 | Rename the folder | **DONE** — you renamed `DocumentsArk` to `DocumentsVault` on 21 Sep; nothing else referred to the old path |
| D8 | Naming, if this is ever sold | "Pip-Boy" and "Vault Boy" are Bethesda trademarks. For a commercial release the theme label needs a different name (e.g. "Terminal") and the mascot art replaced — you have already said the art will change. Say when and I will do both |

Everything else that was open has been decided and is done or in progress — see section 8.

## 1. The core app — requested 9 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 1.1 | Local Wikipedia repository app | **DONE** | Pure-JS ZIM reader, no dependencies |
| 1.2 | Reads the date the copy was cloned | **DONE** | Shown on every pack, everywhere |
| 1.3 | Offers an update when a newer one exists | **DONE** | Checks the Kiwix catalogue, resumable download |
| 1.4 | No images, to keep the size down | **DONE** | Text-only packs; small illustrated ones added later by request (3.9) |
| 1.5 | Size prediction | **ANSWERED** | Tiered table; app itself is under 600 KB |
| 1.6 | Runs as a LAN server, any device with a browser | **DONE** | Prints the addresses on start |
| 1.7 | Runs as a desktop app | **PARTIAL** | Double-click launcher opens a chromeless app window. No installer, but no longer needed: `node tools/make-portable.js <folder> --with-node` builds a copy with Node.js inside it that runs on any Windows PC by double-clicking Vault.bat, nothing installed (tested). Same on Linux when built there. A true single .exe would need Electron or a bundler — not planned unless you want it |
| 1.8 | Windows and Linux | **DONE** | `Vault.bat` / `vault.sh` / `vault.desktop`; no platform-specific code |
| 1.9 | Survivalist handbook framework + first chapters | **DONE** | 10 modules, 42 chapters, ~48,000 words. Every module has at least two |
| 1.10 | Language learning: English + Japanese first, then Spanish, Mandarin, Hindi | **DONE** | 2,884 cards with spaced repetition; written grammar guides for all four; cards spoken aloud with the Say it button (P) or Auto, using the voices installed in Windows — offline, but only for languages whose voice pack is installed (Settings › Time & language › Speech). Still to do: A2, N4, HSK 2 |
| 1.11 | Unified search across everything | **DONE** | Handbook, school, decks, guides, every pack, every book — one box, ~0.3 s |
| 1.12 | Education with per-child progress tracking | **DONE** | Profiles + 13 lessons, and the OpenStax shelf (8.6) for depth |
| 1.13 | Suggest other areas to build out | **ANSWERED** | Twelve proposed; see section 7 for which are built |

## 2. Launching and content questions — requested 9–10 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 2.1 | Simple click-an-icon launch | **DONE** | Desktop shortcut with the cog icon; port fallback; Node-missing message |
| 2.2 | What is Wiktionary | **ANSWERED** | The dictionary — 9.1 M entries, 8.5 GB |
| 2.3 | Drop Japanese Wikipedia; keep encyclopedias English-only | **DONE** | Language learning lives in-app |
| 2.4 | iFixit repair guides | **DONE** | Queued for download (8.2) |
| 2.5 | Wikibooks | **DONE** | Queued for download (8.2) |

## 3. Maps and reader — requested 10 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 3.1 | Back button to the previous article in the reader | **DONE** | Back/forward over article history, Alt+arrows |
| 3.2 | Offline Google-Maps equivalent, zoomable | **DONE** | PMTiles vector maps, canvas renderer, no library |
| 3.3 | Layers that switch on and off | **DONE** | POI categories, place names, overlays, your own drawings — all independent |
| 3.4 | Looks like a standard OS map | **DONE** | Two parts. An "OS style" look on the map's style button (blue motorways, green primary routes, red A roads, orange B, yellow minor, green dashed paths, brown contours), which works on any base map. And Ordnance Survey's own free national map, OS Open Zoomstack (2.85 GB, in Setup under Maps), which has contour lines every 10 m with heights on the index lines, road numbers, every named farm and wood — installed here and verified over Lancaster and Morecambe |
| 3.5 | Points of interest: monuments, public buildings, infrastructure, farmland, water, shops with supplies | **DONE** | Nine categories chosen for usefulness |
| 3.6 | Road layers for navigation | **DONE** | Motorway down to footpath, styled by class |
| 3.7 | Ocean / nautical maps | **DONE** | 18 OpenSeaMap charts queued: Britain, Europe, the Mediterranean, and the whole route Japan → Britain both ways (8.1) |
| 3.8 | Does it run on Linux | **ANSWERED** | Yes — see 1.8 |
| 3.9 | A small image collection for education | **DONE** | Vikidia, PhET, WikEM, illustrated Simple English — 3.85 GB, all verified serving images |
| 3.10 | Bulk out languages and education with established curricula | **DONE** | Where There Is No Doctor and all 75 OpenStax textbooks queued (8.6); the first dozen are already indexed |
| 3.11 | Bulk out the handbook, especially shelter building | **DONE** | 42 chapters across 10 modules. Will keep growing, but nothing is thin now |
| 3.12 | Rivers rendering as broken wedges | **DONE** | Rivers are lines; were being filled as polygons. Fixed |
| 3.13 | Buildings appearing and disappearing | **ANSWERED** | Not a bug — tiles only carry buildings from about zoom 13 |
| 3.14 | Offline place-name search | **DONE** | The Go to box takes a name as well as coordinates. The index is built from the names inside the installed vector packs (131,000 for Britain & Ireland + world, 40 seconds, automatic at first start and after a new map pack lands) and saved in data/places.json. Nearest match to the current view first, so from Britain "Lancaster" is the one on the Lune |

## 4. Look, feel and social — requested 10 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 4.1 | Get the images | **DONE** | See 3.9 |
| 4.2 | Both layered: own writing + established resources | **DONE** | The handbook is the quick layer; the document importer (5.4) is the depth layer. What goes into it is D7 |
| 4.3 | Dark mode | **DONE** | |
| 4.4 | Light mode | **DONE** | |
| 4.5 | Pip-Boy mode: old screen effect, the font, changeable text colour | **DONE** | Scanlines, glow, flicker, monospace; five screen colours |
| 4.6 | Make the UI cool and fun to use | **DONE** | Themes, the cog, the mascot |
| 4.7 | Manual explaining how the app works and is built | **DONE** | Five pages plus this tracker, under the Manual tab |
| 4.8 | Chat over the local network, with a setup guide | **DONE** | Comms tab with channels; guide is Manual → Setting up outpost comms |
| 4.9 | Footer credit: prepared by Joseph Watkins, and why | **DONE** | |
| 4.10 | Draw on the map: paint, erase, toggle the layer | **DONE** | |
| 4.11 | Colour palette and pen sizes | **DONE** | Seven colours, four widths |
| 4.12 | Plot routes and add new features to areas | **DONE** | Freehand lines with their length shown, labelled pins, a measuring tape, named layers — all shared across the network |
| 4.13 | Remove handbook links from the home page | **DONE** | |
| 4.14 | Home as a friendly, Fallout-like welcome and guide | **DONE** | |
| 4.15 | Logo changed to a cog | **DONE** | Generated from code, no image file |
| 4.16 | Rebrand Ark → Vault | **DONE** | Everything, including the folder (D5, 21 Sep). The class is still called ArkServer inside src/server.js — a name in code, not on screen |
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

## 8. Downloads, distribution and defaults — requested 14 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 8.1 | Sea charts for the whole world, Japan to Britain either way | **DONE** | 18 OpenSeaMap charts (17.8 GB) queued: Channel, North Sea, Atlantic, Biscay, Europe, both Mediterraneans, Baltic, Adriatic, Arabian Sea, Bengal, South and East China Seas, South Pacific, US West Coast, Caribbean, Magellan, Northwest Passage. Honest gap: OpenSeaMap has no charts for the Red Sea, Panama, Australia, Africa or the open North Pacific — nobody has mapped them. The base map still has every coastline |
| 8.2 | Wiktionary, Wikibooks, iFixit, plus Wikivoyage, Wikiversity, ArchWiki | **DONE** | Queued (18.7 GB). ArchWiki already landed and indexed |
| 8.3 | Full English Wikipedia, text only | **DONE** | Queued last, 49 GB |
| 8.4 | Delete the superseded pack | **DONE** | |
| 8.5 | Rename the folder | **DONE** | See D5 |
| 8.6 | All the textbooks | **DONE** | Where There Is No Doctor (25 files) and all 75 OpenStax books queued. Everything downloaded so far indexes cleanly at full scale — Biology 2e is 1,475 pages, 652,000 words |
| 8.7 | Ship the app small; download content after install, all at once or by choice | **DONE** | The Setup tab: a catalogue of 106 items, "download everything" or a tick-list, one download at a time, resumable, remembered across restarts, each pack indexed on arrival. The app itself is under 1 MB |
| 8.8 | Could this be sold on Steam, and for how much? | **ANSWERED** | In conversation. Short version: yes, as software; the trademarks (D8) and a packaged installer (1.7) are the two things to fix first |
| 8.9 | Pip-Boy amber as the default look | **DONE** | |

## 9. Screen space, tabs, calendar, route planning — requested 14 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 9.1 | Tabs remember where you left them | **DONE** | Each section keeps its last page (Library on an article, Handbook on a chapter, a document at its page). Clicking the section you are in takes you to its front page. Search results and study sessions are deliberately not remembered |
| 9.2 | Map keeps its position | **DONE** | Centre, zoom, paper/dark, base pack and overlays survive tab changes and restarts |
| 9.3 | Calendar tab with addable events | **DONE** | Shared household calendar: events with time, notes, colour, and repeats (weekly/monthly/yearly). Every day shows sunrise, sunset, first/last light, day length and the moon for wherever the map was last looking; the month grid marks the days the moon turns. A "coming up" list for the next two months |
| 9.4 | Measuring tool: distance and perimeter | **DONE** | Click points for distance; click the first point again (or Close shape) for perimeter and area in m²/ha/km² and acres |
| 9.5 | Route planner with nodes, leg distances, elevation | **DONE** | Click nodes; every leg listed with distance and true bearing; total and a rough walking time; Backspace/Escape to edit; saved to a layer with a name, drawn on everyone's map with legs labelled. **Elevation gain is not there** — it needs a terrain pack (hill heights), which no installed map carries. Doable later: a world terrain pack is ~1–2 GB for coarse, far more for fine |
| 9.6 | Are libraries on the map? | **ANSWERED** | Yes — public libraries are a point of interest under "Shelter & gathering", alongside town halls, schools and places of worship, at zoom 13 and above |
| 9.7 | Where is ocean navigation? | **ANSWERED** | Inside the map: the sea charts are raster overlays (Overlays list under Base map) once downloaded — they are in the queue now. The handbook's sailing/navigation material is text; the charts give depths, buoys, lights and hazards |
| 9.8 | Satellite view | **DONE** (see 10.7) | Not built. Feasible as a raster base layer: NASA Blue Marble (public domain, ~500 MB for 500 m/pixel) shows terrain, vegetation and cities; true high-resolution imagery of everywhere is terabytes and licensed. Say if you want the Blue Marble layer added to the catalogue |
| 9.9 | Map bigger, full width | **DONE** | The map fills the content area and most of the window height |
| 9.10 | Use the whole screen, everywhere | **DONE** | No more fixed page width. Reading views keep a comfortable line length; lists, maps, calendar and setup use the full width |
| 9.11 | Sidebar instead of top tabs and search | **DONE** | Left sidebar with search, sections, appearance and profile; collapses to an icon strip (remembered); becomes a top strip on phones |
| 9.12 | Rename Pip-Boy view to "retro" | **DONE** | "Retro terminal" |
| 9.13 | Header on the appearance dropdown | **DONE** | "Customise view" |
| 9.14 | Other features people would miss (music, piano?) | **DONE** (see 10.1) | Tools tab: a two-octave piano playable from the keyboard, a metronome with tap tempo and tuning pitches, a countdown timer with alarm and a stopwatch, and a unit converter. Not yet built, in rough order of usefulness: a music/audio player for your own files (and a local photo/video viewer), a notebook/journal per person, a chess/draughts board, a periodic table and star chart, a Morse trainer, a calculator, a recipe book. Say which |
| 9.15 | Are 10-card modules adequate? Matched to real syllabuses? | **DONE** | The 10 was the per-session limit on *new* cards, now a setting (5–100). Honest answer to adequacy: it was not — 455 cards was a survival core. Now 1,079: Japanese has 652 (both kana, all 110 JLPT N5 kanji, about 450 words — just over half of N5 vocabulary), Spanish 289 (about half of CEFR A1). Each language page says where its decks sit against the real level. Now 2,884: Japanese 958 (the whole N5 vocabulary plus set phrases), Spanish 926 (all of A1 and A2: past, future, conditional, commands); Mandarin covers HSK 1–3 in full (600 words, 621 cards); Hindi has the whole Devanagari script and 315 words and phrases — the core of A1. Audio: see 1.10. Every language now sits at a real, named level; see each language page |
| 9.16 | Japanese cards show only symbols | **DONE** | Pronunciation (rōmaji, pinyin, or a plain English rendering) now shows on the front of the card by default; a toggle hides it once you can read the script. Every Japanese, Mandarin and Hindi card carries a reading; the kana decks are the exception on purpose — the reading *is* the answer |

## 10. Everything at once — requested 15–19 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 10.1 | Build all the suggested features | **DONE** | Music (piano, metronome, tuning pitches, chords), Science (periodic table, night sky), Notebook (journal, recipes, lists), Media (music, photos, films), Games (chess, draughts), Tools (calculator, converter, timer, stopwatch, Morse trainer) |
| 10.2 | Almanac: change the time as well as the date | **DONE** | A time slider; the sun's bearing, height and shadow length for that instant; the map shades the night side of the world with the subsolar point marked |
| 10.3 | Roads drawn as thick orange lines | **DONE** | Widths and which classes show now depend on zoom: hairline trunk roads on a continent, full streets at zoom 12+ |
| 10.4 | Sections nested in folders | **DONE** | Home; Knowledge (Library, Handbook, Languages, School, Music, Science); Life (Calendar, Comms, Maps, Notebook, Sheets, Media, Games); System (Tools, Manual, Setup). Folders fold. Piano moved out of Tools into Music |
| 10.5 | Are routes and markings saved and deletable? | **ANSWERED / DONE** | Yes — everything drawn is saved on the server in layers. Each layer now lists its marks with go-to and delete buttons; the eraser works too. The green 7.31 km line was a leftover from my testing; removed |
| 10.6 | Retro view: rendering pattern across the map | **DONE** | The scanlines are drawn to whole device pixels now, so the bands are even everywhere |
| 10.7 | Satellite view | **DONE** | Setup → Satellite & terrain: NASA Blue Marble for the world (installed), Sentinel-2 for Britain, Europe or Japan. Chosen under Satellite on the map page; roads and names draw over the photo |
| 10.8 | Elevation gain on routes | **DONE** | Terrain packs (Britain installed; world coarse available). Routes show climb, descent, highest and lowest points, a height profile and a Naismith time allowance; the map gets hill shading |
| 10.9 | Offline maps, not just the online planet | **DONE** | Found while testing: the online map had expired (Protomaps keeps a week of builds; the vault now moves the date on itself). Setup → Maps (offline): Britain & Ireland to street level (851 MB, installed), the world (installed), Europe, Japan |
| 10.10 | Spreadsheet — view, edit, format, sort, formulas, open Excel files | **DONE** | Sheets: a grid with a formula engine (about a hundred functions), number/date/currency/percent formats, bold/italic/colour, sort, insert/delete rows and columns, freeze, undo, several sheets, autosave. Imports and exports .xlsx and .csv. Charts: select a range, press Chart — bar, line or pie, with a title, floating over the grid, redrawn as the numbers change, saved with the workbook. Pivot tables are not there; charts are not written into the exported .xlsx |

## 11. Wrapping up — requested 20–21 Sep

| # | Request | Status | Notes |
|---|---|---|---|
| 11.1 | Network sharing off by default, switchable in the interface, with a tutorial | **DONE** | The vault now listens on this machine only (127.0.0.1) until Setup → Share on this network is switched on; the server rebinds without a restart, the choice is kept in data/state.json, the panel shows the phone address and a five-step walkthrough plus what "on" means for safety. `--host` on the command line fixes it and greys out the switch. Tested on, off, and unreachable-from-the-LAN when off |
| 11.2 | Why did a firewall prompt appear? | **ANSWERED** | It was the portable-copy test: Windows asks per executable path, and the test copy's own node.exe was a new path. Deleted since; the installed Node is allowed already |
| 11.4 | Audit findings (from the agents' first pass, Sept 20) | **IN PROGRESS** | Fixed: a malformed Range request on a document file could crash the server (now 416, and the process no longer dies on any uncaught error); the vault window used the person's everyday Edge/Chrome profile (now its own profile under data/browser-profile — nothing read here lands in normal browser history); the ZIM not-found page echoed the path unescaped; prototype-polluting keys (__proto__) in request bodies; bodies capped at 64 MB; nosniff / same-origin framing / no-referrer headers on every response; wounds chapter now starts with stopping the bleeding and points to First response. Also: every decompression (PDF, EPUB, ZIM, PNG terrain) now has an output cap so a bomb cannot exhaust memory; saved state is flushed to disk before the rename, so a power cut leaves the old file or the new, never half. Left for the review pass: allocation limits deeper in the binary parsers, and the unfinished UI/mobile testing |
| 11.5 | Back and forward buttons across the whole build, not just the Wikipedia reader | **DONE** | A browser-style ◀ ▶ pair top-left of every page, with the current section beside it. Back steps through everything opened this session — a handbook chapter to its list, a lesson to the school page, a map to wherever you came from; inside the Wikipedia reader it steps through the articles first, then out. Alt+← / Alt+→ and the mouse's back button work too. The reader's own ← → stay where they were |
| 11.6 | Agents' review v2 (7 dimensions, at 0dd034b) — punch list | **IN PROGRESS** | Worked in the order the report gave. **Critical 1, drive-by file write through /api/downloads:** URLs are now only accepted from the Kiwix hosts, over https; filenames are reduced to a plain `.zim` basename; the downloader itself refuses any address or redirect that points at this machine or the local network. **High 2, cross-site requests:** every state-changing /api call must carry the vault's own header (a page on another site cannot add it) and pass the browser's same-origin label; every /api call must name this machine in Host, which defeats DNS rebinding. Tested: a headerless POST, a cross-site-labelled POST and a rebinding Host are all refused; the app's own calls go through. **High 3:** pack articles, EPUB chapters and PDF page text are served with a Content-Security-Policy that forbids scripts and any fetch beyond this server; the article and book frames are sandboxed; EPUB bodies have scripts, embeds, event handlers and javascript: links stripped. The Wikipedia reader still follows links and keeps its history with scripts off. **High 4:** profile, lesson, card and channel ids pass through one guard that refuses `__proto__`, `constructor` and `prototype`; tested clean. **High 5:** every ZIM read is checked against the file size before allocation, so a tampered header fails as "corrupt" instead of aborting the process. **High 6, the startup ping:** online map pointers (`.url`) are registered without being opened; the address is only fetched the first time someone picks that map. Portable copies skip `.url` and `.part` files. Catalogue and pack downloads now send a plain browser-style User-Agent (the tile harvester keeps an identifying one because tile providers require it). **High 6b, search:** the handbook, lessons and manual are ranked in their own pool with guaranteed slots; "child bleeding" now returns 15 handbook hits (was 0). **High 6c, PDFs on phones:** a text view of one page at a time (`/doc/<id>/page/N`), the default wherever the browser cannot show a PDF inline, with a Show text / Show pages toggle on desktop. **Medium 7:** gzip and brotli tile decompression capped; PMTiles directory counts and MVT geometry counts bounded. **Medium 8:** a corrupt state file is renamed `.corrupt-<time>` and kept, never overwritten; bursts of updates coalesce into one write; `await save()` now resolves only when that state is on disk; write errors are remembered. **Medium 9:** the charcoal line corrected — never indoors, flue or not. **Medium 10:** generator exhaust and backfeed warnings in Solar and batteries and in the house chapter; the CO warning now says what to do. **Medium 11:** folder paths, OS and Node versions are only sent to the machine's own browser; a phone gets folder names. **Medium 12:** the footer name is a setting (Setup → Whose vault), empty in a fresh copy; yours is kept. **Medium 13:** cells that would be read as formulas get an apostrophe on CSV export. **Medium 14b:** a readable faint-text tone per screen colour (amber 4.86:1, was 2.68); the eraser tests distance to each segment, not just the vertices. **Medium 14:** four weapon-safety rules, field-dressing hygiene (tularaemia, gloves, when to burn a carcass), cooking temperature; raw-milk pasteurisation in Keeping animals. Not done, by choice or size: the cold-start first search (the indexes are already built in the background at startup; a search in the first minute waits for them); a test suite (15) — a separate job; wiping the browser profile on exit and encryption at rest (17) — design decisions, ask if wanted; the map draw panel as a phone overlay |
| 11.7 | Education to a teachable KS1–3, German and English-as-a-second-language decks, listening comprehension | **IN PROGRESS** | Approved 22 Sep. Done so far: a **Teaching guide** subject (how to run a school at home, the daily rhythm, what "ready for the next stage" looks like, the full road map subject by subject); lessons grouped by **key stage** on the School page; every lesson's **Answers** section folded away until revealed; the existing lessons retagged KS1/KS2/KS3; a complete **KS1 maths** sequence (number and place value → bonds and adding/subtracting to 20 → to 100 → tables 2, 5, 10 and sharing → shapes, measures, time and money → halves, quarters and thirds), each with exercises and answers; answer keys added to the five existing maths lessons. **German** added: guide (sounds, gender, cases, verbs, word order, the perfect, numbers) and five decks, 375 cards, A1 core. KS1 is now complete in all three core subjects (maths 6, English 3, science 3 lessons). Still to write: the rest of KS2 and KS3 (see the road map's italics), English as a second language (which language should the backs be in? — needs your answer), listening comprehension |
| 12.4 | Copyright-free for distribution: replace the mascot art with the gothic vault drawing, replace the cog icon with something similar | **DONE** | The home page now shows your gothic vaulted hall (web/vault-art.txt); the old mascot file is gone. The app icon (taskbar, shortcut, browser tab) and the sidebar mark are a gothic pointed arch on a floor line, generated by tools/make-icon.js as before — no image editor, no binary blobs. The theme id "pipboy" became "terminal" in the code and stylesheet (saved preferences migrate on load); the on-screen name was already "Retro terminal". No Fallout names remain anywhere in the app, manual or README |
| 12.1 | In-depth foraging: regional and seasonal, identifiers and dangerous lookalikes, mushroom and tree identification logs, links to the encyclopedia for pictures | **DONE** | A new **Foraging & Wild Food** module, four chapters: the method (five-point identification, the deadly-first rule, a month-by-month calendar for Britain, where to look, law and manners, kit, and how to rebuild it for another region); a **wild plants log** (the six killers in full, then 40 edibles by group — greens, roots, flowers, fruit, nuts, seaweeds — each with identifiers, lookalikes and the tell, season, part and use); a **mushroom log** (the spore print, seven deadly species and a dozen more to avoid, the "foolproof" six, then a dozen learn-one-at-a-time edibles, preserving, and what to do after a mistake); a **tree log** (32 trees by leaf, bark, bud and fruit in every season, confusions, what each gives, reading a tree in winter, coppice). Every species links to its encyclopedia article — a new `wiki:` link type that opens whichever Wikipedia is installed, trying the Latin name then the common name |
| 12.2 | Farming: planting seasons through the year; starting from zero; tools | **DONE** | *Starting a food garden from nothing*: what to expect, the tools, year zero (no-dig from grass, beds, compost), the first-year crops and quantities for four people, a month-by-month sowing/planting/harvest calendar for Britain, a crop-by-crop table (sow, depth, spacing, time, yield, notes), rotation, water/weeds/protection/feeding, perennials and the orchard, the hungry gap, and how to translate it to another climate |
| 12.3 | Artisan foods: fermenting, preserving, cheese, kimchi, jams | **DONE** | *Artisan foods — fermenting, preserving and the dairy*: sourdough starter and loaf, sauerkraut and kimchi and the 2% salt rule, vinegar pickles, jam/jelly/fruit leather/chutney and the setting point, yoghurt and labneh, butter and ghee, paneer, rennet (bought, vegetable, animal), a full hard-cheese method with pressing and ageing, feta and halloumi, vinegar, cider/perry/country wine, dry-cured bacon and ham with the nitrite question answered, sausages, cold and hot smoking, and eggs in lime-water |
| 11.3 | Finish every requested feature and partial before rollout | **OPEN** | Remaining partials: 1.7 (see note — the app window is Edge/Chrome in app mode; Edge ships with Windows, so no download is needed; a bundled browser would mean Electron and 200 MB); languages done (1.10) |

## 6. Known thin spots

Not separate requests — the places where a "done" is doing less than it should.

| # | Area | State |
|---|---|---|
| 6.1 | Fire module | Resolved — 4 chapters |
| 6.2 | Computing module | Resolved — 3 chapters |
| 6.3 | Comms module | Resolved — 6 chapters, incl. Meshtastic step by step and a plan template |
| 6.4 | Languages | Guides for all four. Spoken audio via the Windows voices (1.10). Japanese covers all of N5, Spanish all of A1 and A2; Mandarin is complete to HSK 3; Hindi has the full script and a quarter of A1 — see 9.15 |
| 6.5 | School | 13 lessons. Real depth comes from imported textbooks (D7) |
| 6.6 | Medical | Resolved — 7 chapters, incl. childbirth, mental health and long-term conditions |
| 6.7 | Maps | Pins, lengths, perimeter/area, route planner, elevation, satellite, hill shading and offline packs done. Place-name search done (3.14). Still no OS style |
| 6.8 | Food | Hunting, trapping, fishing and now livestock (Keeping animals: chickens, ducks, rabbits, goats, sheep, pigs, bees, winter feed, breeding, slaughter) — resolved |
| 6.9 | Water | Resolved — wells and drought covered |

## 7. Proposed, not yet requested

Modules suggested on day one. Listed so they are not forgotten, not because they are owed.

| Module | State |
|---|---|
| Navigation without GPS | Covered in the offline maps chapter, the map-reading lesson, and the almanac |
| Repair & making | **Done** — four chapters: tools and sharpening, cloth/rope/leather, wood/metal/glue (joints, rivets, threads, brazing, adhesives), and bicycles/plumbing/doors/windows/roof/small engines with a shed parts list. iFixit (D2) would be its depth layer |
| Livestock & bees | A paragraph in the food chapter |
| Weather & seasons | Covered in the Earth and weather lesson |
| Almanac | **Done** (5.7) |
| Community, records & the family vault | **Done** — a module with three chapters |
| Print / PDF export | **Done** (5.6) |
| Packaged desktop installer (.exe / .deb) | Portable copy with bundled Node instead — see 1.7 |
