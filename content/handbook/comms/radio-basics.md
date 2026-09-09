---
title: Radio, from first principles
summary: What each band can and cannot do, why antenna height beats transmit power, and the arithmetic for cutting an antenna that works.
priority: 1
tags: [radio, ham, antenna, hf, vhf, propagation]
---

# Radio, from first principles

When the infrastructure goes, radio is what is left. It needs no towers, no billing, no permission and no cooperation from anyone else. A handheld radio and a wire in a tree connects you to people the phone network never will again.

## The one idea that explains the rest

**Frequency determines how a signal travels.** Everything else follows from that.

| Band | Frequency | How it travels | Realistic range |
|---|---|---|---|
| LF / MF (AM broadcast) | 150 kHz – 3 MHz | Ground wave by day, sky wave at night | 100s of km at night |
| **HF** | 3 – 30 MHz | Bounces off the ionosphere | **Hundreds to thousands of km** |
| **VHF** | 30 – 300 MHz | Line of sight, slight bending | **Horizon, ~5–80 km** |
| **UHF** | 300 MHz – 3 GHz | Strict line of sight, penetrates buildings better | Horizon, shorter |

If you want to reach the next town, VHF from a hilltop. If you want to reach the next country, HF. There is no combination of money and power that makes a UHF handheld talk over a mountain range.

## Height beats power, always

This is the single most useful practical fact in radio.

Doubling your transmit power gains you 3 dB — a barely perceptible improvement. Getting your antenna ten metres higher, or out from behind a hill, can gain you 20 dB or more. A 5 watt handheld on a ridge will outperform a 100 watt base station in a valley, every time.

**Spend your effort on the antenna and its height, not on the radio.**

Radio horizon in kilometres is roughly **4.12 × √(height in metres)**, for each end. Two people with antennas at 10 m: about 13 km each, so roughly **26 km** between them. Put one antenna on a 100 m hill and it becomes 41 + 13 = **54 km**.

## Cutting an antenna

An antenna resonant at your frequency transforms a mediocre radio into a good one. The arithmetic is simple enough to do in your head.

- **Half-wave dipole**, total length in metres: **143 ÷ frequency in MHz**. Fed in the centre, the two legs each half that. Hang it horizontally, as high as you can, ends supported by rope and insulators.
- **Quarter-wave vertical**, in metres: **71.5 ÷ frequency in MHz**. Needs a ground plane — four radials of the same length at the base.

So for 145 MHz (2 m VHF): a dipole is 143 ÷ 145 = **0.99 m** total, two legs of 49 cm. For 7 MHz (40 m HF): 143 ÷ 7 = **20.4 m** total, two legs of 10.2 m — a wire between two trees.

Cut slightly long and trim. Wire is wire — speaker cable, fence wire, anything conductive works.

**NVIS** — near vertical incidence skywave — is the technique for regional HF coverage with no dead zone. Use 3.5 or 7 MHz, and mount the dipole **low**, about a fifth of a wavelength up (5–7 m on 40 m band). The signal goes almost straight up, reflects off the ionosphere and comes back down over a circle of a few hundred kilometres. It is how you cover a county with no repeaters.

## What you can legally use

Licensing exists and matters while civil society does. Learn the rules where you are, and get licensed — not because a collapse will care, but because the licence is how you get the practice, the equipment and the community *now*, which is when the learning has to happen.

- **PMR446 (Europe/UK)** — licence-free, 0.5 W, fixed antenna. A few hundred metres in town, a few km in the open. Fine for a family on a site.
- **CB, 27 MHz** — licence-free in the UK and much of Europe, 4 W. HF-adjacent, so it can do surprising distances when conditions are right.
- **FRS/GMRS (US)** — FRS licence-free; GMRS needs a cheap licence, allows more power and repeaters.
- **Amateur radio** — requires a licence (Foundation level in the UK is genuinely easy), and opens up HF, high power, repeaters, satellites, digital modes and homebrew equipment. This is the one worth doing.

> **Note** Transmitting outside your licence privileges is illegal, and on some frequencies actively dangerous — aviation and emergency service bands must be left alone. Listening, however, is unrestricted almost everywhere, and a cheap scanner or software-defined radio teaches you an enormous amount.

## Listening as a skill in itself

Receive-only capability costs almost nothing and tells you what is happening in the world.

- **A shortwave receiver** picks up international broadcasters and gives you news from beyond whatever is happening locally.
- **An RTL-SDR dongle** (about £25) plus a laptop covers roughly 24 MHz to 1.7 GHz — aircraft, marine, weather satellites, digital modes, emergency services, everything. Save the software offline while you can.
- **NOAA / weather satellite images** can be received on VHF with a simple antenna and decoded on a laptop. Actual weather data with no infrastructure at all.
- Keep a **wind-up or solar AM/FM/shortwave radio** with spare batteries. It is the cheapest situational awareness there is.

## Practical modes when power is short

- **Voice (FM)** is easy and power-hungry.
- **SSB** on HF gets far more range per watt than FM.
- **CW (Morse)** gets through when nothing else does — the receiver bandwidth can be very narrow, so the signal-to-noise ratio is superb. A few watts of CW can cross an ocean. Learning it is a real time investment, but it is the mode that works when everything else fails.
- **Digital modes** — FT8, JS8Call, Winlink, packet — squeeze messages through terrible conditions using a computer's signal processing. JS8Call in particular is designed for keyboard-to-keyboard messaging over long distances at very low power, and can relay through other stations.

## A sensible progression

1. Buy a cheap handheld and a shortwave receiver. Listen. Learn the bands.
2. Get the entry-level amateur licence. Join a local club — that is where the knowledge actually lives.
3. Build a dipole. Verify you can talk across town.
4. Add HF capability and learn NVIS for regional coverage.
5. Set up a low-power digital mode station that runs off a battery and a solar panel.
6. Agree a **communications plan** with family and neighbours: which frequency, at what times, with what fallback. A radio nobody is listening to is furniture. Write the plan on paper and give everyone a copy.
