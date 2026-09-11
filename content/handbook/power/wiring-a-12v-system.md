---
title: Wiring a 12 volt system
summary: The practical half — cable sizes, fuses, connection order and the mistakes that start fires.
priority: 2
tags: [12v, wiring, cable, fuse, solar, battery, safety]
---

# Wiring a 12 volt system

The previous chapter sized the system. This one is about the wire, the fuses and the order you connect things in — which is where the fires and the dead batteries actually come from.

## Why low voltage is harder than it looks

At 12 V, a modest amount of power means a lot of current. A 240 W load is 1 A at mains voltage and **20 A at 12 V**. Current is what heats wire, so a cable that would be absurdly oversized for a mains socket is barely adequate for the same power at 12 V.

And voltage drop bites. Lose 1 V along a cable at 240 V and nobody notices. Lose 1 V at 12 V and you have thrown away 8% of your power, your lights dim, and your inverter cuts out on "low battery" while the battery is full.

**Aim for less than 3% voltage drop on any run.** That rule sizes almost everything.

## Cable sizing

Copper cable is sized by cross-section in mm². The table gives the **maximum one-way length in metres** for a 3% drop at 12 V. Round trip is double, which is already accounted for.

| Cable | 5 A | 10 A | 20 A | 30 A | 50 A |
|---|---|---|---|---|---|
| 1.5 mm² | 3 m | 1.5 m | — | — | — |
| 2.5 mm² | 5 m | 2.5 m | 1.2 m | — | — |
| 4 mm² | 8 m | 4 m | 2 m | 1.3 m | — |
| 6 mm² | 12 m | 6 m | 3 m | 2 m | 1.2 m |
| 10 mm² | 20 m | 10 m | 5 m | 3.4 m | 2 m |
| 16 mm² | 32 m | 16 m | 8 m | 5.4 m | 3.2 m |
| 25 mm² | 50 m | 25 m | 12 m | 8.4 m | 5 m |

Two things fall out of this. **Keep runs short** — put the battery near the loads and near the panels. And **go up a size when in doubt**; thicker cable never hurt anything except your wallet.

The arithmetic if you need it: copper is about 0.0172 ohm per metre per mm². Drop = 2 × length × current × 0.0172 ÷ mm².

Working with salvaged wire: car battery leads and welding cable are 16–35 mm²; household twin-and-earth is 1.5–2.5 mm²; speaker cable is typically 0.5–1.5 mm² and only good for small lights. Solid-core mains cable is fine for fixed runs, but flexible stranded cable is far better anywhere there is vibration or movement.

## Fuses — the rule and the reason

**Every positive conductor leaving the battery gets a fuse, as close to the battery terminal as physically possible.**

The fuse protects the **cable**, not the load. Size it to the cable's safe carrying capacity, so that a short circuit anywhere along that wire blows the fuse before the wire heats. A rough guide to safe continuous current: 1.5 mm² — 15 A, 2.5 mm² — 20 A, 4 mm² — 30 A, 6 mm² — 40 A, 10 mm² — 60 A, 16 mm² — 80 A.

> **Warning** A 12 V battery can deliver hundreds of amps into a short. A spanner across the terminals welds itself in place and glows; a shorted unfused cable becomes a heater inside your wall in seconds. Fuse everything, cover the terminals, and never rest tools on a battery.

Use a **fused distribution block** — a bar with a fuse for each circuit — rather than a rat's nest of inline fuses. Label every fuse. Keep spares in every rating you use, taped to the inside of the box.

## Connection order

This matters, and it is the same for every charge controller:

1. **Battery to controller first.** The controller needs to see the battery to know what voltage it is dealing with.
2. **Panel to controller second.**
3. **Loads last.**

Disconnect in reverse: loads, then panel, then battery. Connecting a panel to a controller with no battery attached can destroy the controller.

Cover the panel with a blanket before you connect or disconnect it. A panel in sunlight is live and cannot be switched off.

## A sensible layout

```
[Panels] --MC4--> [Charge controller] --fuse--> [Battery]
                                                   |
                                    [Main fuse at battery +]
                                                   |
                                        [Fused distribution block]
                                         |      |      |      |
                                      lights  USB   radio  inverter
```

- **One negative bus bar.** Every negative goes to it; it connects to the battery negative. This makes fault-finding possible.
- **One positive bus bar** after the main fuse, feeding the distribution block.
- **A battery disconnect switch** on the main positive, so the whole system can be made dead for work.
- **The inverter**, if you have one, on its own heavy fused cable direct from the battery. An inverter pulls large current in bursts.
- **A shunt and meter** on the negative, so you can see current in and out. Running blind is how batteries get killed.

## Connectors and joints

A bad joint has resistance; resistance makes heat; heat loosens the joint further. Most electrical fires in low-voltage systems start at a connection.

- **Crimp, properly**, with a ratchet crimper that will not release until the crimp is complete. A crimp made with pliers will fail.
- **Solder** is fine for fixed low-current joints, but it wicks up stranded cable and makes it brittle right where it flexes. Crimp anything that moves.
- **Terminal rings** on studs, with a spring washer, tightened firmly. Not spade connectors on anything carrying real current.
- **MC4 connectors** for panels. **Anderson connectors** for anything that gets plugged and unplugged regularly — they are rated for hundreds of cycles and cannot be inserted backwards.
- Check joints by hand after a week of running: anything warm to the touch is a bad joint.

## Earthing and lightning

A small off-grid DC system does not need a mains-style earth. Do bond the metal frames of the panels to a ground rod, so a lightning strike nearby has somewhere to go that is not through your controller. Disconnect the panels during thunderstorms if you can be bothered; it is cheap insurance.

## Batteries: the rules

- **Never mix chemistries** in the same bank, and do not mix old and new lead-acid batteries. The weakest one drags the rest down.
- **Parallel** banks need identical cables of identical length to each battery, or one battery does all the work.
- **Lead-acid vents hydrogen when charging.** Ventilate the enclosure. No sparks nearby. A sealed battery box with no vent is a bomb.
- **Lithium below freezing**: no charging. Insulate the battery or bring it indoors.
- Lead-acid left flat for a month is dead. Lithium tolerates it. If you are storing a system, store it charged and check quarterly.

## Fault-finding, in order

1. **Is there voltage at the battery?** A multimeter across the terminals. Below 11.8 V for lead-acid or 12.8 V for LiFePO4 is flat.
2. **Is the fuse intact?** Test across it; a good fuse reads near zero ohms, or the same voltage on both sides.
3. **Is there voltage at the load?** If the battery has it and the load does not, the problem is between — a bad joint, a switch, a broken conductor.
4. **Is the panel producing?** Open-circuit voltage in sun should be well above battery voltage — 18–22 V for a "12 V" panel. If not, the panel or its cable is dead.
5. **Is the controller charging?** Battery voltage should rise during the day. If the panel is producing and the battery is not charging, the controller is the suspect.

A **multimeter is not optional**. Learn to measure voltage, continuity and current before you need to, and keep a spare battery for it.

## The kit, so you are not stuck

Ratchet crimper and a box of crimp terminals · cable in 2.5, 6 and 16 mm² · MC4 and Anderson connectors · a fused distribution block and spare fuses · bus bars · a battery switch · a multimeter · cable ties, tape, heat-shrink · a ground rod · and a printed copy of this page taped inside the battery box.
