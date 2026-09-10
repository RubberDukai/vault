---
title: How the Vault works
summary: What it is, what it is made of, and why it was built this way.
order: 1
---

# How the Vault works

## What this actually is

The Vault is a small web server that runs on your own machine and serves a library to any browser that can reach it. That is the whole idea. There is no cloud, no account, no company, and nothing that phones home.

When you start it, three things happen:

1. It reads every `.zim` file in the `library` folder — those are the encyclopedias — and notes what each one is and when it was cloned.
2. It reads the `content` folder, which holds the handbook, the language decks, the school curriculum and this manual, all as ordinary text files.
3. It opens a port and prints the addresses it can be reached on.

From then on it is just answering requests. Everything you see in the browser is drawn from those files on disk.

## The pieces

```
bin/vault.js          the command line
src/server.js         the web server and its API
src/zim/reader.js     reads ZIM encyclopedia files
src/maps/             reads PMTiles and MBTiles map archives
src/content/          loads markdown and renders it
src/srs/engine.js     the spaced repetition schedule
src/search/           search across everything
web/                  the interface you are looking at
content/              the handbook, decks, lessons, this manual
library/              your .zim packs
library/maps/         your map archives
data/                 profiles, progress, messages, map markings
```

## The one rule the whole thing was built around

**No dependencies.**

There is not a single third-party library in this project. Every format it reads — ZIM, PMTiles, Mapbox Vector Tiles, PNG, Markdown — is parsed by code written here, against the published specification.

That is unusual and it was a deliberate choice. Software that depends on a hundred packages depends on a hundred things continuing to exist, continuing to be downloadable, and continuing to work with each other. The whole purpose of this project is to still work when those assumptions fail. So it needs Node.js and nothing else.

The practical consequence: you can copy this folder to a USB stick, carry it to a machine that has never been online, and it will run.

## The formats, and why those ones

**ZIM** for encyclopedias. It is an open, documented format designed for exactly this — offline Wikipedia — with a proper index so searching seven million articles stays instant. The Kiwix project publishes hundreds of archives in it.

**PMTiles** for maps. A whole map in one file, structured so a reader only ever needs to ask for the byte ranges it wants. That property means the same file works on a disk or over a network, and it is why the Vault can browse a 120 GB planet map without downloading it.

**Markdown** for everything written here. It is plain text with light punctuation. You can read it in any text editor, print it, email it, or edit it with nothing but Notepad. In thirty years it will still open.

**JSON** for the flashcard decks and everything the app remembers. Also plain text, also readable by a human.

Nothing here is a proprietary format. Nothing needs this program to be readable. If the Vault itself is lost, the contents are not.

## How it decides something is out of date

Every ZIM archive carries the date its source was cloned in its own metadata. The Vault reads that and shows it everywhere the pack appears, because it is the honest answer to "how current is this?"

When you ask it to check for updates it queries the Kiwix catalogue — the only moment it touches the internet without you typing an address — and compares dates. There is no patching in the ZIM format, so an update is a full re-download. Your existing copy keeps working until the new one has finished and verified.

## What it stores about you

Everything is in the `data` folder, on your machine, in plain JSON:

- **Profiles** — the names you added, nothing more.
- **Flashcard schedules** — when each card is next due, per person.
- **Lesson progress** — which lessons are marked complete, per person.
- **Map markings** — the lines you drew, stored as latitude and longitude.
- **Messages** — anything posted in Comms.

There is no telemetry, no analytics and no identifiers. Delete the `data` folder and the Vault forgets everything and keeps working.

## Why it was built

By Joseph Watkins, an architect — someone whose job is imagining the buildings people will live in years from now, and who therefore thinks a lot about what lasts.

Most of what humanity knows currently sits behind a connection that could fail: commercially, politically, or physically. Not likely, perhaps. But the cost of holding a copy is one hard drive, and the cost of not holding one, in the world where it matters, is everything.

It was built for children who will need to keep learning whatever happens, and on the belief that preparing for darkness and building toward light are the same act, done properly.
