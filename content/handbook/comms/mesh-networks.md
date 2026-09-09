---
title: Building a network without the internet
summary: LoRa mesh, long-range wifi, and the fact that a network is just computers agreeing to pass each other's messages along.
priority: 2
tags: [mesh, lora, meshtastic, wifi, network, sneakernet]
---

# Building a network without the internet

The internet is not a place. It is a set of agreements about passing packets between machines. Nothing about those agreements requires a corporation, a subsea cable or a data centre — those just make it fast and global. A handful of people with radios and cheap computers can rebuild a small, slow, entirely functional version of it in an afternoon.

## Meshtastic — the best value in the field

**Meshtastic** is open-source text messaging over LoRa radio. It is the single highest-value comms technology for a prepper right now, and it is genuinely cheap.

- Nodes cost roughly £25–40 each. A node is a small board, a battery and an antenna.
- **868 MHz in Europe/UK, 915 MHz in the US** — licence-free ISM bands.
- Power draw is tiny: a node runs for days on a small battery, indefinitely on a modest solar panel.
- **Range: 2–10 km typical in mixed terrain, 20–50 km with height and clear line of sight**, and hundreds of kilometres for record attempts from mountaintops.
- It **meshes**: every node relays for every other node. Three nodes across a valley connect two people who cannot hear each other directly. Coverage grows with participants.
- Phones connect to a node over Bluetooth, so the interface is an ordinary messaging app with no cell service involved.

What it is good for: text messages, GPS position sharing, sensor telemetry, small structured data. What it is not: voice, images, or anything resembling bandwidth. LoRa is measured in bytes per second.

Buy several. Give them to the people you would actually want to reach. A mesh network with one node is a paperweight.

## Long-range wifi

Ordinary wifi hardware, pointed rather than broadcast, goes much further than people expect.

- **Directional antennas** (dish or panel) on both ends turn a 50 m link into a 5–20 km one. Purpose-built point-to-point radios manage 50 km+ with clear line of sight.
- Line of sight is required, and it means genuine optical line of sight — trees and buildings matter, and the earth's curvature matters past about 10 km.
- Power is modest; these run happily on solar.
- This gives you **real bandwidth** — megabits — which means file transfer, serving this library between villages, voice and video.

**Mesh routing protocols** let many such links self-organise: **BATMAN-adv** and **OLSR** are the established ones, and they run on cheap OpenWrt routers. **Yggdrasil** builds an encrypted self-arranging network over whatever links exist, which is useful when your physical topology keeps changing.

## Layering the technologies

A realistic community network stacks them by range and bandwidth:

- **Inside a building or camp:** ordinary wifi from one router. Everyone reads the library.
- **Across a village:** directional wifi links between rooftops. Real bandwidth, file sharing.
- **Between villages:** Meshtastic for text, HF radio for voice and long-haul messages.
- **Beyond that:** sneakernet.

## Sneakernet is a real protocol

Never underestimate the bandwidth of a car full of hard drives. It has terrible latency and enormous throughput, and it requires no technology that can fail.

Make it deliberate rather than accidental:

- Agree a **schedule and a route** — who carries data where, and how often.
- Use a **fixed folder structure** on the drives so exchanges are mechanical, not negotiated.
- **Checksum everything** (`sha256`) so corruption is detected rather than propagated.
- Carry **duplicates**. Drives fail, and they fail most often when carried around.
- Prefer **plain files and open formats**, so the receiving end never needs software it does not have.

This is genuinely how information moved between communities for most of history, and it works.

## What to run on the network

Once you have connectivity, it is worth almost nothing without services. Set these up now, while you can still download them:

- **This library.** One machine serving Ark to everyone in range. See the next chapter.
- **A local chat server** — anything simple and self-hosted.
- **A file drop** — a shared folder for everything from photographs to seed catalogues.
- **A message board** — a bulletin board is how a community coordinates: trades, notices, requests for help, who has what skills.
- **A local map server** with offline OpenStreetMap tiles for your region.
- **A directory** — who is out there, on what frequency, with what skills and what equipment.

## The unglamorous part

The technology is the easy half. The hard half is agreements between people.

Write down and distribute on paper: the frequencies and channels, the schedule for scheduled contacts, the call signs or names, who holds which equipment, what the fallback is when the primary method fails, and how someone new joins. A network is a social protocol running on a technical one, and the social one is what actually fails first.
