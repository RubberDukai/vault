---
title: Keeping it running
summary: Starting it, moving it, backing it up, and what to do when something breaks.
order: 4
---

# Keeping it running

## Starting it

**Windows** — double-click `Vault.bat`, or the Vault icon on the Desktop. Run `Create Desktop Shortcut.bat` once to make that icon.

**Linux or macOS** — `chmod +x vault.sh` once, then `./vault.sh`.

A console window opens and stays open. **Closing it stops the Vault.** The addresses it prints are what other devices use.

## The command line

Run these from inside the Vault folder:

```
node bin/vault.js serve        start it (add --open to launch a browser)
node bin/vault.js library      list packs and when each was cloned
node bin/vault.js check        ask the catalogue what is newer
node bin/vault.js info <file>  inspect a .zim pack directly
node bin/vault.js search <q>   search from the terminal
```

`serve` takes `--port 8080` and `--host 0.0.0.0`. If the port is busy it quietly moves up until it finds a free one.

## Moving it to another machine

Copy the whole folder. That is the entire procedure — there is nothing installed elsewhere, no registry entries, no configuration outside the folder.

The only requirement on the new machine is **Node.js 22.15 or newer**. Keep an installer for Windows, macOS and Linux alongside your backups; you cannot download the thing that lets you read your archive after downloading stops working.

Better: make a copy that needs nothing. From the Vault folder, in a terminal:

```
node tools/make-portable.js E:\Vault --with-node
```

builds a clean copy (no progress, no messages, no map markings) with this machine's Node.js inside it, in a `node` folder. On another Windows PC it runs by double-clicking `Vault.bat`, with nothing installed. Add `--with-packs` and `--with-maps` to take the library too; that copy is tens of gigabytes and is the one to keep on a drive in a drawer. A copy made on Windows carries Windows Node; make one on a Linux machine for Linux.

## Backing it up

Three parts, and they matter differently:

| What | Size | How replaceable |
|---|---|---|
| `library/` — the packs | Tens of GB | Re-downloadable *while there is an internet* |
| `content/` — handbook, decks, lessons | A few MB | **Your own work. Irreplaceable.** |
| `data/` — progress, messages, map markings | Small | **Yours. Irreplaceable.** |

Back up `content` and `data` often — they are tiny and they are the parts nobody else has. Back up `library` when convenient.

The full argument is in the handbook chapter **Making data outlive the hardware**, but in short: three copies, two kinds of media, one somewhere else, checksums verified annually. And do not let an SSD be your only cold copy — flash loses its charge in a year or two unpowered, silently.

## When something breaks

**"Cannot find module" when starting.** You are running the command from the wrong folder. `cd` into the Vault folder first, or just use the launcher, which does it for you.

**"Node.js is not installed".** Get the LTS release from nodejs.org and accept the defaults.

**A pack shows as unreadable.** Older ZIM files use LZMA compression, which Node cannot decompress natively. Download a current build of that pack — modern ones use zstd, which works.

**The interface looks wrong after an update.** Reload the page. If it persists, restart the Vault.

**A phone cannot reach it.** Check it is on the same wifi. Check the machine's firewall is not blocking the port — Windows usually asks the first time, and the answer is to allow it on private networks. Try the address with `http://` typed explicitly.

**Map tiles are blank.** Either no map pack is installed, or you are outside the area your extract covers. The Maps tab lists what is installed and what area it holds.

**Everything is broken and you want to start clean.** Delete the `data` folder. You lose progress and messages; you lose nothing else.

## Updating the Vault itself

The Vault is a git repository, so `git pull` updates it if you cloned it. If you edited the shipped content, keep your edits somewhere separate first — an update can overwrite them.

Packs update independently: **Library → Check for updates**. That needs an internet connection and downloads the whole pack, because the ZIM format has no patching.

## If you are handing this on

Someone else may end up maintaining this — a partner, a child, a neighbour, someone you have not met. Leave them:

- **On paper:** how to start it, the addresses, where the backups are, and what to do first.
- **In the folder:** this manual, which they are reading now.
- **A spare machine** if you can. A Raspberry Pi and a spare SD card cost very little and store in a shoebox.

Write the paper note today. It is the single cheapest piece of resilience in this entire project, and the one most likely to be skipped.
