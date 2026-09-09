---
title: Solar power and batteries
summary: How to size a system with arithmetic instead of guesswork, and which battery chemistry to actually buy.
priority: 1
tags: [solar, battery, power, 12v, lifepo4]
---

# Solar power and batteries

Almost all bad off-grid power systems come from skipping the arithmetic. It is not difficult arithmetic.

## Work out what you need first

List every load, its power draw in watts, and how many hours a day it runs. Multiply and add.

| Load | Watts | Hours/day | Wh/day |
|---|---|---|---|
| LED light × 3 | 15 | 5 | 75 |
| Raspberry Pi running the library | 5 | 24 | 120 |
| Phone charging × 3 | 10 | 3 | 30 |
| Radio, receive | 3 | 6 | 18 |
| Laptop | 45 | 3 | 135 |
| **Total** | | | **378 Wh/day** |

That total is the number the entire system is built around. Note how modest it is — under 400 Wh is a light, a library, communications and a computer. A single electric kettle would add 200 Wh in six minutes, which tells you where the real problem lies: **heating anything with electricity is hopeless off-grid.** Heat with fire, and use electricity for information, light and control.

## Sizing the panels

**Peak sun hours** is the useful measure: the number of hours per day of full-strength sun equivalent. It varies enormously by latitude and season, and the seasonal swing is what catches people out.

| Location | Summer | Winter |
|---|---|---|
| UK / northern Europe | 4–5 | **0.5–1** |
| Southern Europe | 6 | 2 |
| Equatorial | 5 | 5 |

Panel size = daily Wh needed ÷ peak sun hours ÷ system efficiency (call it 0.7 for losses in cabling, controller, heat and dirt).

For 378 Wh/day in a UK winter at 1 peak sun hour:
**378 ÷ 1 ÷ 0.7 = 540 W of panel.**

The same system in summer needs about 110 W. **Size for winter or accept that you have no power in winter** — this is the single biggest mistake in temperate-latitude solar. Panels are relatively cheap; oversize them, and angle them steeply (roughly latitude + 15°) to favour the low winter sun and shed snow.

> **Note** Shade is not proportional. Shading one cell of a panel can knock out most of that panel's output, because the cells are in series. A single branch shadow or a chimney matters far more than its size suggests. Site panels where nothing shades them at any hour of any season.

## Sizing the battery

The battery carries you through the night and through bad weather. Size it for **three days of autonomy**, and respect the usable depth of discharge.

- **Lead-acid** — never take below 50%. So for 378 Wh/day × 3 days = 1,134 Wh usable, you need **2,268 Wh** of lead-acid, which is about **190 Ah at 12 V**.
- **LiFePO4** — usable to about 90%. The same needs **1,260 Wh**, or about **105 Ah at 12 V**.

**Buy LiFePO4 (lithium iron phosphate) if you can afford it.** It is the right chemistry for this job:

- 2,000–5,000 cycles versus 300–800 for lead-acid, so it lasts a decade or more.
- Roughly a third the weight for the same usable capacity.
- Tolerates partial charging without damage, where lead-acid degrades if not regularly filled.
- Far more chemically stable than the lithium-ion in laptops and phones — it does not go into thermal runaway readily.

> **Warning** **Do not charge any lithium battery below 0 °C.** Charging a frozen lithium cell plates metallic lithium onto the anode, permanently destroying capacity and creating a genuine fire risk. Discharging in the cold is fine. If your battery lives somewhere that freezes, get a model with a built-in low-temperature charge cut-off, or insulate it and keep it near your living space. Lead-acid has the opposite problem — it survives cold but loses capacity in it, and a flat lead-acid battery can freeze solid and split.

## Charge controllers

Between panel and battery. Never connect them directly.

- **PWM** — cheap, simple, and it wastes the voltage difference between panel and battery.
- **MPPT** — tracks the panel's optimum operating point and converts the excess voltage into current. **20–30% more energy from the same panels**, and more than that in cold or low light. Worth the money in almost every case, and especially at high latitudes.

## Wiring, fusing and not burning the house down

- **Fuse every positive line**, as close to the battery as possible. A 12 V battery bank can deliver hundreds of amps into a short circuit; that is enough to melt a spanner and set fire to insulation instantly.
- **Size the cable for the current.** Low voltage means high current for the same power — 400 W at 12 V is 33 A, which needs substantial cable. Undersized cable is a heater.
- Keep runs short; voltage drop at 12 V is punishing over distance.
- **Cover battery terminals.** Never rest tools on a battery.
- Vent lead-acid batteries — they release hydrogen when charging, which is explosive. LiFePO4 does not have this problem.
- Keep the system **12 V or 24 V DC** and run DC appliances directly where you can. Every conversion through an inverter costs 10–15%.

## Other sources worth knowing

- **Micro-hydro** is the best off-grid source there is if you have running water with any head at all. It runs day and night, all year, and a stream that drops a few metres can outproduce a large solar array continuously.
- **Wind** is site-specific and mechanically demanding. It complements solar well in temperate winters — windy when it is dark and cloudy — but it needs maintenance and it is hard on bearings.
- **A generator** is for surges, not for baseload. Fuel storage is the limit: petrol degrades in months without stabiliser, diesel keeps a year or two and grows algae, propane keeps effectively forever. If you buy one, buy propane or a multi-fuel and store propane.
- **Human power** — a bicycle generator gives perhaps 50–100 W from someone working hard, which is one laptop and a great deal of respect for how much energy electricity actually represents.

## What to have before you need it

Spare charge controller · spare fuses in every rating you use · a multimeter and the knowledge to use it · a small folding panel and a USB power bank as the portable tier · 12 V LED lighting · a DC-to-USB converter · and cable, connectors and crimps, because you will always want more of those than you have.
