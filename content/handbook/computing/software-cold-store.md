---
title: The software cold store
summary: You cannot download the thing that lets you read your archive after downloading stops working. What to fetch now, and how to keep it.
priority: 2
tags: [software, installers, offline, node, linux, mirror, checksums]
---

# The software cold store

Every piece of software on your machine came from somewhere that might not be there tomorrow. Operating systems, drivers, the runtime this Vault needs, the tools to rebuild any of it — all of it is a download away, right up until it is not.

A software cold store is a folder — on a drive, and on a second drive, and on a DVD — holding everything needed to bring a machine from bare metal to a working Vault, with no network at all. Build it now, while every link works.

## The rule

**If it is needed to read the archive, it is part of the archive.**

## Tier 1 — what the Vault itself needs

- **Node.js installers**, current LTS: the Windows `.msi`, the macOS `.pkg`, and the Linux `.tar.xz` for x64 and for ARM64 (Raspberry Pi). Around 30 MB each. Node is the one thing the Vault cannot run without.
- **The Vault itself** — the whole folder, minus the packs. 500 KB. Keep a zipped copy alongside the installers, and a copy of this manual printed.
- **A browser.** Any modern one; an offline installer for Firefox or Chromium. The Vault's interface needs one.

That is the whole dependency chain. Three items.

## Tier 2 — an operating system to run it on

- **A Linux installer image.** Debian or Ubuntu LTS — the netinstall is small but needs the network; get the **full DVD or offline image** (1.5–4 GB) that installs with nothing. This is your fallback for any machine, including one whose Windows has died.
- **A Linux live USB** — bootable, runs from the stick without installing. Diagnoses a dead machine, recovers files from its disk, and runs the Vault straight off the stick in a pinch.
- **Raspberry Pi OS** image (Lite, 64-bit, ~500 MB) and the **imager** tool, since a Pi is the cheapest Vault host there is.
- **Windows installation media** if you depend on Windows — Microsoft's media creation tool makes a USB or ISO. Keep your licence key on paper with it.
- **Drivers** for anything unusual: wifi adapters, printers, USB-to-serial cables, SDR dongles. Linux mostly has these built in; Windows mostly does not.

## Tier 3 — the tools to fix things

- A **package mirror**, or at least a cached set of packages, for your Linux distribution. `apt-mirror` or a `.deb` cache of what you actually use: an editor, a compiler, Python, git, the SDR tools, Meshtastic's CLI. A full Debian mirror is huge; a mirror of only the packages you have ever installed is small.
- **Git**, and clones of the source of anything you rely on. Source you hold can be rebuilt; a binary you cannot rebuild is a countdown.
- **Documentation**, offline: the Node docs, the Linux man pages (they come with the system), the Arch Wiki (a small ZIM from Kiwix — the best Linux reference there is), Stack Exchange archives for the things you use (Unix, Electronics, Raspberry Pi — a few hundred MB each as ZIM).
- **Firmware** for radios, for Meshtastic nodes, for anything flashable. Radio firmware in particular tends to be hosted by one small company.

## Tier 4 — the things you forget

- **Fonts** for scripts you read — Japanese, Devanagari, Chinese. Modern systems ship them; a minimal Linux might not.
- **A PDF reader, an image viewer, an archive tool.** Small, and maddening to be without.
- **An e-book of the specification for every format you depend on**: ZIM, PMTiles, EPUB, PDF. If a reader must be rewritten from scratch, that is what it is written from — which is how the Vault's own readers were written.
- **Maps of the software**: a plain-text README saying what each file is, what it is for, and the order to install things in.

## Keeping it trustworthy

**Checksum everything at download time**, and keep the checksums with the files:

```
sha256sum -b * > MANIFEST.sha256
```

Then, in a year, `sha256sum -c MANIFEST.sha256` tells you whether anything has rotted. A corrupted installer is worse than no installer — it fails halfway and takes the machine with it.

Where a project publishes a **signature** as well as a hash, keep it. Where it does not, a hash you took yourself is still proof the file has not changed since.

## Where to keep it

Small enough for one USB stick — under 32 GB for all four tiers — but do not keep it on one USB stick. Flash forgets. Three copies, on at least two kinds of media, one of them a hard disk, per the archive rules in **Making data outlive the hardware**.

Keep one copy **with the spare machine**, in the same box, so that finding one finds both.

## Refresh it

Once a year: a newer Node, a newer Linux image, a fresh Vault. Retire the old one only after the new one has been tested — installed on a machine, booted, the Vault run from it. A cold store that has never been used is a hope, not a backup.

The test is simple and worth the afternoon: **take a machine that has never seen the Vault, disconnect it from everything, and bring it up from the cold store alone.** If you can, you are prepared. If you cannot, you have just found out what was missing while it was still possible to get it.
