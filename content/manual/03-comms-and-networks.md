---
title: Setting up outpost comms
summary: How the message board works, and how to build the network it runs on — from one room to a whole settlement.
order: 3
---

# Setting up outpost comms

The **Comms** tab is a message board that lives on the machine running the Vault. Anyone who can open the Vault can read it and post to it. Messages are stored in `data/messages.json` — plain text, on your disk, going nowhere else.

There is no server on the internet, no account, no phone number and nobody in the middle. If two people can reach the same Vault, they can talk.

## Using it

- **Channels** keep things separate. Start with `general` and add what you need — `medical`, `watch`, `supplies`, `trade`. Click **+ channel**.
- **Your name** comes from the profile selected in the top right. Set one up per person so messages are attributable.
- Messages are kept in order with a timestamp, and the last 2,000 per channel are retained so the file cannot grow without bound.
- New messages from other people appear within a few seconds.

It is a noticeboard rather than an instant messenger, and that is the right shape for it: someone comes back to the outpost, opens the Vault, and reads what happened while they were out.

## Level 1 — one building

You already have this. Start the Vault, note the address it prints, and anyone on the same wifi types that address into a browser.

```
Or from any phone or tablet on the same wifi:
  http://192.168.2.121:8080
```

Nothing needs installing on the other devices. A phone, a tablet, an old laptop, an e-reader with a browser — all of them work.

**Write the address on a piece of paper and stick it to the wall.** People will need it and you will not always be there to tell them.

## Level 2 — no router left

If the household router has died, the machine running the Vault can *be* the network. A Raspberry Pi does this well: configure it as a wireless access point with `hostapd` and `dnsmasq`, give it a recognisable network name — `OUTPOST`, or `LIBRARY` — and hand out addresses.

Add a DNS entry resolving everything to the Pi, and anyone who joins that wifi lands on the Vault whatever they type. Someone who knows nothing about any of this joins a network called LIBRARY and finds an encyclopedia and a message board waiting.

Run it on port 80 so people type a bare address with no port number. That detail matters more than it sounds when you are explaining it to a stranger.

## Level 3 — across a settlement

Wifi reaches a building. To cover more:

- **Directional antennas** on rooftops turn a 50 m link into a 5–20 km one, with real bandwidth. Two buildings with line of sight between them can share one Vault.
- **Repeaters** at intervals extend coverage along a street or valley.
- **Mesh routing** — BATMAN-adv or OLSR on cheap OpenWrt routers — lets many such links organise themselves, so the network keeps working when one node fails.

Height beats power, every time. An antenna in an upstairs window outperforms a stronger one at ground level.

## Level 4 — between settlements

Beyond line of sight, bandwidth collapses and you change technology:

- **Meshtastic over LoRa** carries text messages tens of kilometres on a few milliwatts, meshes automatically, and runs indefinitely on a small solar panel. Nodes cost £25–40. This is the best value in the whole field.
- **HF radio** carries voice and slow digital modes hundreds of kilometres, with no infrastructure whatsoever.
- **Sneakernet** — someone carries a USB drive. Terrible latency, enormous throughput, completely reliable.

The handbook chapters **Radio, from first principles** and **Building a network without the internet** cover all of this properly.

## Running more than one Vault

Each Vault is independent. Two outposts each running their own have separate message boards, which is usually what you want — local traffic stays local.

To move information between them, export what matters and carry it: the `data/messages.json` file is plain text, and so is everything else. A daily or weekly exchange of files on a USB stick is a perfectly good inter-settlement postal service, and it is how information moved for most of history.

## What to agree with people, in advance, on paper

The technology is the easy half. Write these down and give everyone a copy:

- The **network name** and the **address** of the Vault.
- Which **channel** is used for what, and which one means "this is urgent".
- **When people check it** — a noticeboard nobody reads is furniture.
- The **fallback** when the network is down: a physical noticeboard, a meeting time, a radio frequency and schedule.
- Who **maintains the machine**, and who takes over if they cannot.

A network is a social agreement running on a technical one. The social half is what fails first, and it is the half you can sort out this afternoon.
