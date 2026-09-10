---
title: Getting offline maps
summary: How to pull a regional map extract onto your own disk, add nautical charts, and navigate with no GPS.
priority: 4
tags: [maps, navigation, pmtiles, openseamap, osm, gps]
---

# Getting offline maps

Ark's map viewer reads two open formats, both single files you can copy onto any disk:

- **PMTiles** — a whole vector basemap in one file. Roads, buildings, water, land cover, place names and points of interest, all restylable and zoomable. This is your land map.
- **MBTiles** — a tile database, used here for raster overlays. This is how the nautical charts get in.

Drop either into the `library/maps` folder and press **Rescan** on the Maps tab.

## The land map

The **Protomaps basemap** is built from OpenStreetMap and published as PMTiles under an open licence. The whole planet, zoom 0 to 15, is roughly **120 GB**. You almost certainly want a region instead.

**A regional extract is cut directly from the remote planet file** — you do not download 120 GB to get your county. PMTiles is designed so a reader fetches only the byte ranges it needs, and the `pmtiles` command-line tool exploits that to pull out a bounding box over the network.

1. Get the `pmtiles` binary from `github.com/protomaps/go-pmtiles/releases`. It is a single executable with no installer.
2. Find a current daily build at `maps.protomaps.com/builds`.
3. Extract your region:

```
pmtiles extract https://build.protomaps.com/20260909.pmtiles uk.pmtiles --bbox=-8.7,49.8,1.8,60.9
```

The bounding box is `west,south,east,north` in decimal degrees. Rough figures:

| Region | Bounding box | Approximate size |
|---|---|---|
| Great Britain & Ireland | `-11,49.8,2,61` | 3–5 GB |
| A single English county | `-3,51,-2,52` | 100–300 MB |
| France | `-5.2,41.3,9.6,51.1` | 4–6 GB |
| Western Europe | `-11,35,20,61` | 15–25 GB |
| Continental USA | `-125,24,-66,50` | 25–35 GB |

Add `--maxzoom=14` to cut the size substantially at the cost of the closest zoom level. Zoom 15 is roughly building level; 14 is street level and still perfectly navigable.

> **Note** Ark can also read a **remote** archive. Put a plain text file in `library/maps` named something like `planet.url` containing a single line with the archive's address, and the whole world is browsable while you still have internet — useful for deciding which region you actually want before committing to the download. It stops working the moment the connection does, which is precisely why you extract a local copy.

## Ocean and nautical charts

**OpenSeaMap** is the free, open nautical chart — depths, buoys, beacons, lights, harbours, anchorages and hazards, contributed the way OpenStreetMap is. It is published as a **seamark overlay in MBTiles format**, designed to sit on top of a land basemap rather than replace it, which is exactly how Ark uses it.

Europe complete is around **1.6 GB**. Downloads and regional chart folios are at `openseamap.org`, under the offline charts section.

Drop the `.mbtiles` file into `library/maps` and it appears as a tickable overlay on the Maps tab.

Two honest limits. OpenSeaMap is crowd-sourced and **is not a legal substitute for official charts** while official charts exist. And chart data ages — sandbanks move, buoys are relocated, lights change character. In a functioning world, use it alongside proper charts. In a broken one, it is far better than nothing and it is the only free worldwide chart there is.

If you are seriously contemplating leaving by sea, also acquire and **print**: a tide table for your coast, a chart of your home waters, and the light characteristics of the coastline you would follow. Paper charts do not run out of battery, and a chart in a waterproof tube is standard practice among sailors for good reason.

## Elevation and terrain

Contours matter for anyone walking, siting a shelter, planning a water supply or judging whether a route is passable. Terrain tiles are published separately at `download.mapterhorn.com`. They are large, and lower priority than the basemap — get the roads and coastline first.

## Navigating without GPS

GPS is a set of satellites operated by a government, broadcasting a signal your device receives passively. It will very likely keep working for a long time in most scenarios, because nothing about it depends on the internet. But it is not guaranteed, receivers break, and batteries run out — so the map is only half the skill.

**What to have:**

- A **baseplate compass** with a rotating bezel, and the knowledge to take and follow a bearing.
- **Printed maps** of your immediate area at a walking scale. Ark's maps are only as available as the machine holding them.
- Your local **magnetic declination** — the difference between grid north and magnetic north — written on the map. It varies by place and drifts by year.

**Skills worth practising now:**

- **Taking a bearing** from the map and walking it, and the reverse: taking a bearing on a landmark to find where you are.
- **Resection** — bearings to two or three known landmarks, drawn backwards on the map; where the lines cross is you. This is the fundamental technique for finding yourself with no electronics.
- **Pacing.** Count your paces over a measured 100 m, on the flat and uphill. Now you can measure distance by walking it. Most adults take 60–70 double-paces per 100 m.
- **Handrails and catching features.** Follow a linear feature — a river, wall, ridge, road — and pick something you cannot miss beyond your target, so you know when you have gone too far.
- **Aiming off.** Deliberately aim to one side of a target on a linear feature, so when you hit the feature you know which way to turn.

**Direction without a compass:**

- The sun rises roughly east and sets roughly west, and is due south at local noon in the northern hemisphere (due north in the southern).
- **Shadow stick:** mark the tip of a stick's shadow, wait 15 minutes, mark it again. The line between the marks runs roughly west to east, first mark being west.
- **Polaris**, the North Star, sits within a degree of true north. Find it by extending the two end stars of the Plough's pan by five times their separation. In the southern hemisphere, use the long axis of the Southern Cross extended about four and a half times.
- An **analogue watch** set to true local time: point the hour hand at the sun, and south is halfway between the hour hand and twelve.

## What the point-of-interest categories are for

Ark groups map points by usefulness rather than by who paid to be listed. The categories are deliberate:

- **Water** — springs, wells, drinking water, water towers. The first thing to find anywhere new.
- **Medical** — hospitals, clinics, pharmacies, veterinary surgeries. Veterinary practices are worth knowing: much of the drug stock overlaps with human medicine.
- **Food** — supermarkets, groceries, butchers, bakeries, farms, marketplaces.
- **Supplies & tools** — hardware shops, builders' merchants, garden centres, chandleries, outdoor shops, fuel, bicycle and car repair.
- **Shelter & gathering** — schools, halls, places of worship, libraries, hotels. Large heated buildings with kitchens and water, and the places a community assembles.
- **Infrastructure** — substations, water works, treatment plants, masts, mills, dams, lighthouses. What keeps a place alive, and what to understand before it fails.
- **Monuments & historic** — castles, ruins, forts, museums. Often defensible, often on high ground, and always a landmark.
- **Emergency services** — fire, police, ambulance stations.
- **Transport** — stations, harbours, marinas, slipways, airfields.

Turn categories off to cut the clutter, and on when you need one specifically. Everything is drawn from OpenStreetMap, so what you get depends on what local contributors mapped — which in Britain is a great deal, and elsewhere varies.
