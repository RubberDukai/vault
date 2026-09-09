---
title: Making data outlive the hardware
summary: SSDs forget when unplugged, drives fail in pairs, and paper is still the longest-lasting medium you own.
priority: 1
tags: [backup, storage, bitrot, checksums, archive, formats]
---

# Making data outlive the hardware

An archive is not a thing you make. It is a thing you maintain. Every storage medium is decaying right now, and the only question is whether you notice before or after the data is gone.

## What each medium actually does

| Medium | Realistic unpowered life | Failure mode |
|---|---|---|
| **SSD / flash / USB stick** | **1–3 years unpowered** | Charge leaks out of the cells. Silent, total data loss |
| Hard disk (HDD) | 5–10 years on a shelf | Bearings seize, lubricant migrates, media degrades |
| M-DISC optical | 100+ years claimed | Needs a working drive to read it — that is the real risk |
| Ordinary writable DVD/CD | 2–10 years | Dye degrades, especially in light and heat |
| Magnetic tape (LTO) | 15–30 years | Excellent, but needs an expensive drive |
| **Paper, laser-printed** | **100+ years** | Fire and water. Needs no machine at all |

> **Warning** **Do not use an SSD as your only cold archive.** Flash memory stores data as trapped charge, and that charge leaks. An unpowered consumer SSD is rated to retain data for about a year at room temperature, and less when warm. It will not warn you. For a drive on a shelf, spinning rust is the better choice, and a drive that gets powered up and read occasionally is better than either.

## The rule to actually follow

**3–2–1: three copies, on two different kinds of medium, one of them somewhere else.**

For this library specifically:

1. **Working copy** — the drive in the machine that serves it.
2. **Local backup** — an external HDD, powered up and verified every few months.
3. **Cold copy** — a second HDD, stored elsewhere, ideally with someone you trust, so a fire or a flood does not take everything.

And a fourth, if you are serious: **paper**, for the pages you would most regret losing.

## Detecting rot before it spreads

Silent corruption is the danger — a few flipped bits that you faithfully copy into every backup because you never checked.

Generate a checksum manifest when you create the archive:

```
sha256sum -b * > MANIFEST.sha256
```

And verify it on a schedule:

```
sha256sum -c MANIFEST.sha256
```

On Windows, `certutil -hashfile <file> SHA256` does one file at a time, or use PowerShell's `Get-FileHash`.

**Put this in the calendar annually.** Verify, and if a file fails, restore it from another copy *before* that copy also rots. An archive nobody checks is an archive that quietly stops existing.

Filesystems with built-in checksumming — **ZFS** and **btrfs** — detect and repair this automatically when you give them redundancy. If you are building a dedicated archive machine, they are worth the learning.

## Formats that will still open

Choose formats by how many independent implementations can read them, not by how good they are.

**Safe:** plain text (UTF-8) · Markdown · CSV · JPEG · PNG · PDF/A · FLAC · SQLite · ZIM (open, documented, multiple readers) · plain HTML.

**Risky:** anything proprietary, anything needing a licence server, anything with one implementation, anything DRM-protected. DRM-protected files are the worst case: they are designed to stop working when a server goes away, which is exactly the scenario you are preparing for.

Prefer **uncompressed or simply compressed**. A corrupted byte in a plain text file costs you one character; in a solid-compressed archive it can cost you the entire archive.

## Keeping a machine that can read it

Data with no reader is not data.

- **Keep a spare machine.** A Raspberry Pi and a spare SD card cost very little and store in a shoebox. Keep it unused and unpowered, as a genuine spare.
- **Keep the software offline.** Node.js installers for Windows, Linux and macOS. Operating system images. A Linux live USB. A copy of Ark itself, alongside the data. You cannot download the thing that lets you read your archive after the download stops working.
- **Keep the drivers and the cables.** Power supplies, USB cables, SATA adapters, an SD card reader. These are the things that will be missing.
- **A Faraday cage** — a sealed metal box, or a metal bin with a lid and taped seams, with the contents insulated from the metal — protects spare electronics from an electromagnetic pulse. Whether you consider EMP likely or not, the cost is a metal bin.
- **Write the instructions on paper.** How to power it, how to start the server, how to find the library, what the addresses are. Assume the reader is not you.

## What to print

Paper needs no electricity, no drive, no format and no expertise. Laser print (toner is fused plastic and far more stable than inkjet dye) onto decent paper, and keep it dry and dark.

Worth printing:

- **The medical pages.** Especially the oral rehydration recipe, the bleeding control steps and CPR. You will want these when the power is out and someone is bleeding.
- **The water treatment doses.** Chlorine ratios and boiling times.
- **Your comms plan.** Frequencies, schedules, call signs, who has what.
- **Instructions for the vault itself.**
- **The things only you have** — family records, photographs, documents, the letter you would want your children to read.

A binder on a shelf is the most robust storage system in this entire handbook. It survives the loss of every machine, needs no maintenance, and a child can use it.

## Refresh, don't archive

The whole idea of a permanent archive is a trap. Storage media do not last; **copying does.**

Every few years, copy the entire archive onto new media, verify the checksums, and retire the old copy. That is how data actually survives decades — not by finding a perfect medium, but by never letting any single copy become the only one. Everything old that survives to the present survived by being copied.

Put it in the calendar. Make it a habit. That habit *is* the archive.
