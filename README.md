# Vault

An offline knowledge vault. Wikipedia, a survival handbook, language learning and a school curriculum — all working with the internet switched off, served over your local network to any device with a browser.

Runs on Windows, Linux and macOS. **No dependencies**: everything is built on Node's standard library, so there is nothing to install, compile or maintain — which is the point, for a tool whose job is to still work in ten years with no network.

## Starting it

**Windows** — double-click **`Vault.bat`**.

To get an icon on the Desktop, run **`Create Desktop Shortcut.bat`** once. After that, Vault starts from the Desktop like any other application.

**Linux / macOS** — `chmod +x vault.sh` once, then `./vault.sh`. See `vault.desktop` for adding it to the applications menu.

A console window opens showing the addresses Vault is reachable on, and the vault opens in a clean browser window with no address bar. **Leave the console window open** — closing it stops the server. The addresses in it are what you type into a phone or tablet on the same wifi.

If port 8080 is busy, Vault quietly moves up until it finds a free one.

## Requirements

Node.js 22.15 or newer — that is the version where Node gained native zstd, which is how Vault reads modern ZIM files with no compiled library. Nothing else. If Node is missing, the launcher tells you where to get it.

## Commands

For anything beyond starting it, run these from inside the Vault folder:

```bash
node bin/vault.js serve [--port 8080] [--open] [--browser]
node bin/vault.js library      list packs and when each was cloned
node bin/vault.js check        ask the catalogue what is newer
node bin/vault.js info <file>  inspect a .zim pack directly
node bin/vault.js search <q>   search the handbook, school and packs
```

`--open` launches a browser window; `--browser` uses your normal browser instead of a chromeless app window.

## Knowledge packs

Vault reads **ZIM files**, the open format used by Kiwix for offline Wikipedia and much else. Drop `.zim` files into `library/` and restart, or use the **Get packs** tab in the interface to search the Kiwix catalogue and download them with resume support.

Every pack records the date its source was cloned. Vault shows that date everywhere a pack appears, because it is the honest answer to "how current is this?"

### Sizes worth knowing

| Pack | Size |
|---|---|
| Simple English Wikipedia, no images | ~0.9 GB |
| English Wikipedia, lead sections only | ~13 GB |
| English Wikipedia, full text, no images | ~55 GB |
| English Wikipedia, full text with images | ~110 GB |
| Wiktionary (English) | ~3 GB |
| iFixit repair guides | ~3 GB |
| Medical (WikiProject Medicine) | ~3 GB |

Updating is a full re-download — the ZIM format has no patch mechanism. Your existing copy keeps working until the new one finishes and verifies.

## Layout

```
bin/vault.js            command line
src/zim/reader.js     ZIM format parser (header, entries, clusters, title index)
src/library/          pack management, Kiwix catalogue, resumable downloads
src/content/          markdown renderer and content loader
src/srs/engine.js     spaced repetition (SM-2)
src/search/           unified search across everything
src/server.js         HTTP server and API
web/                  browser interface
content/handbook/     survival handbook, as markdown
content/languages/    flashcard decks
content/education/    school curriculum
library/              your .zim packs go here
data/state.json       profiles, review schedules, lesson progress
```

## Editing the content

All authored content is plain files. Handbook chapters and lessons are markdown with a small frontmatter block; language decks are JSON. Add a folder, add a file, restart. Nothing is compiled and nothing is hidden — you can edit any of it with a text editor, or print it.

## Serving a household

One machine holds the library and everyone else reads it in a browser. A Raspberry Pi draws about 3 watts, runs indefinitely off a small solar panel, and can be configured as its own wifi access point so there is no router involved at all.

See the handbook chapter **Communications → Serving this library to everyone around you** for the full setup, including a systemd unit and power budget.

## Keeping it alive

The handbook chapter **Keeping the Machines Alive → Making data outlive the hardware** is the one to read before you trust this with anything. In short: three copies, two kinds of media, one somewhere else, checksums verified annually, and print the pages you would most regret losing.

Do not use an SSD as your only cold archive. Flash memory loses its charge in a year or two unpowered, silently.
