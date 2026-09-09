---
title: Serving this library to everyone around you
summary: One low-power machine can put the whole vault on every phone within wifi range, with no internet involved at all.
priority: 3
tags: [server, raspberry pi, wifi, sharing, ark]
---

# Serving this library to everyone around you

Ark is a server, not a document. The machine holding the files serves them over the local network, and anything with a browser can read them — phones, tablets, old laptops, e-readers. No installation on the client side, no accounts, no internet.

That means **one copy of the data can serve a household, a street or a village.**

## The minimum viable setup

```
ark serve
```

That is it. It prints the addresses it is reachable on, including your machine's address on the local network. Anyone on the same wifi types that address into a browser and they are in the library.

To choose a port, or bind to a specific interface:

```
ark serve --port 8080 --host 0.0.0.0
```

`0.0.0.0` is the default and means "answer on every network interface", which is what you want for sharing. Use `127.0.0.1` if you want it readable only on the machine itself.

## A dedicated always-on node

A Raspberry Pi is the natural home for this. It draws a few watts, has no moving parts, boots from an SD card, and runs from a battery and a small solar panel indefinitely.

Rough power budget:

- Raspberry Pi 4 idle: **~3 W**. Under load with an external drive: **~7 W**.
- Over 24 hours that is roughly **75–170 Wh per day**.
- A **50–100 W solar panel** and a **100 Ah 12 V battery** (1,200 Wh, of which perhaps 1,000 usable with lithium) covers that with several days of margin for bad weather.

Put the library on an external SSD or hard drive rather than the SD card — SD cards wear out with writes and fail without warning.

Set it to start Ark on boot. On a Linux system, a systemd unit:

```
[Unit]
Description=Ark offline knowledge vault
After=network.target

[Service]
ExecStart=/usr/bin/node /home/pi/ark/bin/ark.js serve --port 80
WorkingDirectory=/home/pi/ark
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

Serving on port 80 means people type a bare address with no port number, which matters more than it sounds when you are explaining it to a stranger.

## Making it its own wifi network

If there is no router left, the Pi can be the network. Configure it as a **wireless access point** with `hostapd` and `dnsmasq`, give it an SSID people will recognise — something like `LIBRARY` — and hand out addresses over DHCP.

Add a **captive portal**, or simply a DNS entry that resolves everything to the Pi, and anyone who connects lands straight on the library. Someone who knows nothing about any of this joins a wifi network called LIBRARY and finds an encyclopedia. That is a remarkable thing to be able to offer.

## Extending the range

- A better antenna on the access point, or a **directional antenna** aimed at where people are.
- **Repeaters** at intervals, or a second node linked back by a directional link.
- Height. As with all radio, height beats power.
- Practically: an access point in an upstairs window with a decent antenna covers a small street. A rooftop directional link connects two such nodes across a valley.

## Redundancy, seriously

The point of this project is to survive things going wrong, so do not build a single point of failure.

- **Keep more than one complete copy of the library**, on more than one physical medium, in more than one place.
- **Keep a copy that is not plugged in.** A cold drive on a shelf survives what a running machine does not.
- Keep a **spare Pi, a spare SD card and a spare power supply**, in a box, unused. They are cheap now and unobtainable later.
- Store a copy of the **Ark software itself** alongside the data, plus a Node.js installer for Windows, Linux and macOS. Software you cannot download is software you do not have.
- Write down, on paper, how to start it. Include the commands. Assume the person reading it is not you, is tired, and has never used a terminal.

## Etiquette that keeps it useful

If you end up running the only library in the area, a few things keep it working:

- Make it **read-only for visitors**. Nothing they do should be able to damage the archive.
- Keep the **canonical copy offline** and serve from a duplicate.
- Publish **what you have and when it was cloned**, so people can judge how current it is. Ark shows the clone date on every pack for exactly this reason.
- Be generous with copies. The more people who hold the archive, the more likely it survives. This is the entire lesson of every library that ever burned.
