---
title: Spares, salvage and the machine that keeps working
summary: Which parts fail first, what to keep in the box, and what a dead laptop is worth for parts.
priority: 3
tags: [hardware, spares, salvage, sd card, battery, faraday, repair]
---

# Spares, salvage and the machine that keeps working

Computers do not wear out evenly. A few components account for almost every failure, and most of them are cheap, small and easy to keep in a drawer. Knowing which is the difference between a machine that runs for a decade and one that is a paperweight the first time a fan sticks.

## What actually fails

In rough order of likelihood:

1. **Storage.** SD cards in a Raspberry Pi die of write wear within a year or two of steady use. SSDs lose their charge unpowered. Hard disks wear their bearings. Storage is the first and commonest failure, and the only one that loses data.
2. **Power supplies and chargers.** Capacitors dry out; cables fray at the plug. A dead power brick is the second most common way a working machine stops.
3. **Batteries.** Every lithium battery is dying from the day it is made — two to five years of useful life. A laptop with a dead battery still runs on mains; a phone or tablet often will not.
4. **Fans and anything that moves.** Dust and dry bearings. A machine that overheats throttles, then crashes, then cooks its own solder.
5. **Connectors.** USB ports, charging sockets, headphone jacks — mechanical, and they wear out.
6. **Screens** — hinges, backlights, cracked panels.

What almost never fails: the processor, the memory, the motherboard. The clever parts are the durable parts. It is the mundane parts around them that go.

## The spares box

For a Vault running on a Raspberry Pi — the recommended host — a complete spares kit fits in a shoebox and costs less than a night out:

- **A second Pi**, boxed and unused. The whole machine, as the ultimate spare.
- **Four SD cards**, good brand, "high endurance" if you can get them — the kind sold for dashcams, rated for constant writing. One in the machine, one as a ready-imaged clone, two blank.
- **Two power supplies.** The official one, and a USB-C supply of the right rating.
- **A USB SSD** with the library on it, so the SD card holds only the system and wears slower.
- **Cables**: USB-C, micro-USB, HDMI, an Ethernet lead.
- **An SD card reader** for whatever machine you would use to re-image a card.
- **A small screwdriver set** with Torx and the tiny Phillips sizes that laptops use.
- **Thermal paste**, a can of compressed air or a brush, and **spare fans** for anything that has them.
- **Heat-shrink, tape, cable ties, a multimeter.**

For a laptop, add: a **spare charger**, a **spare battery** if one can still be bought, and a **USB-to-SATA or NVMe adaptor** so its disk can be read in another machine when the laptop dies.

## Keeping storage alive

- **Write less.** On a Pi, move logs and temporary files to memory, put the library on an SSD, and the card lasts years rather than months.
- **Image the card while it is healthy.** A working system card is cloned to a spare, and the spare is labelled and dated. When the live card fails, swap and carry on. Ten minutes instead of a day.
- **Power up the cold drives** every six months and verify the checksums. Flash forgets when unpowered; a drive that is read occasionally keeps its charge topped up.
- **A failing drive gives warning** — slow, errors in the logs, files that will not open. Copy everything off it the day you first notice. Not the day after.

## Salvage: what a dead machine is worth

A laptop that will not boot is a box of working parts:

- **The disk** — almost always fine. Pull it, put it in a USB adaptor, read it from anything.
- **The memory** — swap into another machine of the same generation.
- **The screen** — replaces a cracked one in the same model.
- **The power brick** — if the fault was elsewhere, it is a spare.
- **The wifi card, the webcam, the speakers, the keyboard** — all modular, all reusable within a model family.
- **The battery cells** — inside a laptop battery are standard 18650 lithium cells, usable in torches and power banks if you know what you are doing, and dangerous if you do not.

Phones and tablets are far less salvageable — glued shut, proprietary everything — but their **batteries** and **screens** are worth keeping for the same model, and a phone with a broken screen still works as a server or a radio interface over a cable.

**Washing machines, microwaves and printers** are full of motors, magnets, switches, heating elements, transformers and copper wire. A dead microwave has a large transformer and a magnetron that must never be powered without shielding; the transformer alone is a spot welder waiting to be built. Strip them before they go anywhere.

## Protecting spares from the one thing you cannot repair

An **electromagnetic pulse** — from a nuclear detonation at altitude or a severe solar storm — induces currents in every conductor, and destroys unprotected electronics over a wide area. It may never happen. If it does, the only working computers will be the ones that were in a metal box.

A **Faraday cage** is that box: a continuous conductive shell with no gaps, and the contents insulated from it.

- A **galvanised steel bin with a lid**, seams and lid rim sealed with conductive tape, contents wrapped in cardboard or bubble wrap so nothing touches the metal.
- Or an old **microwave oven** — already a cage, but check it: a phone inside with the door shut should lose signal.
- Or an ammunition tin, seams taped.
- **Do not ground it**; it does not need to be, and a wire to earth is a way in.

Into it: the spare Pi, two imaged SD cards, a power supply, a small radio, a USB drive with the software cold store, and a printed copy of the manual. Sealed, labelled, and left alone. The cost is a metal bin and an afternoon, against the loss of everything electronic.

## Running on very little

If the day comes when there is one working machine and no way to get another:

- **Use it less.** Run the Vault only during set hours, on a schedule people know. Every hour off is an hour of life saved.
- **Keep it cool, dry and still.** Heat, damp and vibration are what kill electronics slowly.
- **Print what matters.** The pages people ask for most go on paper, so the machine is consulted, not depended on.
- **Copy the library** to every other device that still works, in whatever form they can read — a phone with the text, a tablet with the maps.
- **Teach two people** to maintain it. Knowledge held by one person has the lifespan of that person's health.
