---
title: Meshtastic, step by step
summary: Text messaging over tens of kilometres with no infrastructure, for the price of a takeaway per node. How to set it up, from unboxing to a solar node on a hill.
priority: 5
tags: [meshtastic, lora, mesh, radio, solar, setup]
---

# Meshtastic, step by step

Meshtastic turns cheap LoRa radio boards into a self-organising text-messaging mesh. Each node relays for every other, phones connect to a node over Bluetooth, and the result is a messaging network with no towers, no subscriptions and no one able to switch it off. It is the best value in the entire field of off-grid communication, and setting it up is an evening's work.

## What to buy

**Nodes.** Any board on Meshtastic's supported list; the common ones are the Heltec V3, the LILYGO T-Beam (has GPS), the RAK WisBlock (modular, lowest power, best for solar) and the Seeed T1000-E (card-sized, with GPS, good for carrying). Roughly £25–45 each.

**Frequency.** For the UK and Europe buy **868 MHz** boards. North America uses 915 MHz. A board on the wrong band is illegal and will not talk to anyone.

**How many.** A mesh with two nodes is a pair of walkie-talkies. **Start with three or four**, and buy more as people join. Every node extends coverage for everyone.

**Antennas matter more than boards.** The stubby antenna in the box works. A proper half-wave 868 MHz antenna, or a small directional one, can double the range. Do not power a board with no antenna attached — it can damage the radio.

**Plus:** a USB cable that carries data (many charging cables do not), a battery for each node if not built in — an 18650 cell or a small LiPo — and a case, because the bare boards are fragile.

## Flashing the firmware

Boards often ship with firmware already on them, but it is usually old. Flash the current release once:

1. Open the **Meshtastic web flasher** (flasher.meshtastic.org) in Chrome or Edge, plug the board in by USB, choose the board model and the latest stable firmware, and click flash. It takes two minutes.
2. **Download the firmware file too** and keep it in your software cold store. The flasher is a web page; the firmware is what matters.

No web browser: the `meshtastic` Python command-line tool flashes and configures over USB, and works offline once installed.

## First configuration

Install the Meshtastic app on your phone (Android or iOS), enable Bluetooth, and pair with the node. Then, in the app's settings:

**Region.** Set it to **EU_868** (or your region). Until this is set the radio will not transmit at all.

**Your name.** A long name and a four-character short name. Use something people will recognise across the network.

**Channel.** The default channel is public — anyone with a Meshtastic node can read it. For your own group, add a **private channel** with a **pre-shared key**: generate a random key in the app, and share it with the people who should be on it by **scanning the QR code** the app produces. Anyone with the key is in; anyone without it sees only encrypted noise. Keep the default public channel too, as the way strangers can reach you.

**Modem preset.** Leave it on **Long Fast** unless everyone in the mesh agrees to change it. Every node in a mesh must use the same preset or they cannot hear each other. Long Fast is the compromise between range and speed that the whole community defaults to, which is exactly why you should.

**Role.** Client for anything someone carries. **Router** for a node whose only job is relaying from a high place — it never sleeps and always forwards. Do not make a carried node a router; it drains the battery and clogs the mesh.

**Position.** Boards with GPS can broadcast their location on an interval; useful for a group, and configurable to broadcast never, rarely, or only on the private channel.

## Testing

Two nodes, two phones. Walk apart. Send messages. When they stop arriving, walk back until they do — that is your range in that terrain, and it will be far less than the numbers on the internet promise: a few hundred metres in a built-up street, one to three kilometres across fields, tens of kilometres hill to hill.

Then put a third node somewhere high in between and repeat. The moment two people who cannot reach each other directly can talk through the middle node is the moment the mesh idea becomes real.

## The node on the hill

Range is about height. A single node on a roof, a hill, a tree or a mast, running on solar, turns a neighbourhood mesh into a district one.

**The build:**

- A **RAK WisBlock** or similar low-power board, set to the **Router** role.
- A **small solar panel** — 5–10 watts — and a **charge board** and an **18650 cell** or two. The board draws under 100 mW on average; a 5 W panel keeps it up through a British winter with a couple of cells.
- A **weatherproof box** — an IP65 junction box from a builders' merchant — with the antenna outside through a sealed gland, or the whole thing inside a plastic box that is transparent to radio.
- **Mount it as high as you can**, with the antenna vertical and clear of metal.

Site it so it can see the places you want to connect. Radio at 868 MHz mostly wants line of sight; trees and buildings cost you range but do not block it entirely.

## Living with it

- **Messages are short and slow.** LoRa moves a few hundred bytes a second across the whole mesh. Think telegram, not chat. No pictures.
- **Do not flood it.** Position broadcasts every minute from ten nodes will jam a mesh. Every few minutes for carried nodes, every half hour for fixed ones, is plenty.
- **Batteries.** A carried node lasts a day or two on an 18650. Charge it with the phones.
- **Keep a paper record** of which node is which, its key, its role and its location. When the phone that configured it is gone, that paper is how the network is rebuilt.
- **Meshtastic can also carry messages further** through an internet gateway (MQTT) while there is an internet, and through Winlink or APRS gateways run by amateurs. Optional; the mesh works without any of it.

## What it is not

It is not voice, it is not the internet, and it is not a replacement for a proper radio. What it is: a way for a family or a street to know where everyone is and pass short messages, over distances that shouting and walking cannot cover, on hardware cheap enough to give away, that keeps running on sunlight.

Buy four. Set them up this weekend. Give two to people you would want to reach.
