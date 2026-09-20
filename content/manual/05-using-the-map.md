---
title: Using the map, the calendar and the tools
summary: Measuring, planning routes, marking what has changed, and the small tools that live alongside.
order: 5
---

# Using the map, the calendar and the tools

## Finding your way around the screen

Everything is reached from the sidebar on the left. Each section remembers
where you left it: open an article in the Library, go and look at the map,
come back, and the article is still there. Clicking the section you are
already in takes you back to its front page. The sidebar collapses to a strip
of icons with the button at the bottom, which is worth doing on a small
screen with the map open.

The map remembers its own position, zoom, base map and overlays between
visits and between restarts.

## Finding a place

The **Go to** box under the map takes a place name or a pair of coordinates.
Type a town, village, neighbourhood or country and pick from the list; the
map jumps there and drops a marker. The names come from the map packs you
have installed — nothing is looked up online — and the index is built the
first time the vault starts with a vector map present (about 130,000 names
for Britain, Ireland and the world; under a minute). Where several places
share a name, the one nearest the current view is listed first. Coordinates
are latitude, longitude in decimal degrees: `54.05, -2.80`.

## The map tools

Under the map, in **Your markings**:

- **Pan** — drag to move, scroll to zoom, double-click to zoom in a step.
- **Draw** — freehand lines in the chosen colour and thickness. Each line
  shows its length at the end. Use it for anything the map does not know
  about: a collapsed bridge, a flooded road, a field now under cultivation.
- **Pin** — a labelled marker. "Well, good water", "Doctor lives here".
- **Erase** — drag over lines, pins or routes to remove them.
- **Measure** — click points along the ground to read a distance. Click the
  first point again (or press **Close shape**) and the tape becomes a
  perimeter, with the area inside it given in square metres, hectares or
  square kilometres, and acres. Fencing a field, roofing a barn, pacing out a
  plot: this is the tool. **Escape** clears it.
- **Route** — click each turning point of a journey. The panel lists every
  leg with its distance and compass bearing, the total, and a rough walking
  time at 5 km/h on the flat. **Backspace** removes the last node, **Escape**
  clears the lot. **Save route** keeps it in the active layer with a name, so
  it draws on everyone's map with its legs labelled.

Distances are great-circle distances over the ground as the crow flies
between the points you click, not along the roads. Put a node at every bend
that matters and the figure will be close enough to plan a day by.

### Elevation

With a **Terrain** pack installed for the area (Setup → Satellite & terrain),
a route shows its climb and descent, its highest and lowest points, a height
profile with the nodes marked, and a Naismith allowance — an extra minute for
every ten metres climbed. The same pack draws hill shading on the map (the
tick-box under Terrain). Without one the panel says so plainly: *no heights
here*. Heights are sampled about 150 m apart, so a sharp summit reads a little
low and a narrow gully may not show at all.

### Offline maps, satellite views

The drawn map comes from a map pack. The online planet map works while there
is a connection; **Setup → Maps (offline)** downloads the same map for a region
into the vault so it keeps working without one — Britain and Ireland down to
street level is about a gigabyte. Under **Satellite** on the map page a
photographic layer can be put under the roads and names: the whole world at
coarse scale from NASA, or a region in detail from Sentinel-2. Both are
harvested tile by tile from public services when you ask for them, so they
take a few minutes rather than a few seconds to arrive.

### Bearings

Bearings are true north, not magnetic. In Britain the difference is small
now (about a degree) and drifting; elsewhere it can be twenty degrees or
more. The compass chapter of the handbook explains how to correct for it.

## Layers

Markings live in named layers — Notes, Routes, Hazards, whatever you make.
Tick a layer to show it, pick the radio button to draw into it, delete it
when it has served its purpose. Layers are stored on the server, so a route
drawn on the laptop is on every phone on the network a moment later.

## The almanac

The almanac panel under the map gives sunrise, sunset, first and last light,
day length and the moon for the centre of the map on any date. It is
computed from the position, not looked up, so it works for anywhere on Earth
with no data installed. Move the map to your home and it follows.

## The calendar

The Calendar section is one shared household calendar. Add events with a
date, an optional time and notes, and a repeat — every week, month or year
for birthdays, medicine days, market days, the rota for the well. Every day
shows its sun and moon times for the place the map was last looking at, and
the month grid marks the days the moon turns: new, quarters and full.

Events are stored on the server, so everyone on the network sees the same
calendar. Deleting a repeating event removes every repeat of it.

## The tools

Small things that are hard to do without when the phone is dead:

- **Piano** — two octaves, playable from the keyboard: the home row is the
  white keys, the row above is the black ones, Z and X shift octave. Enough
  to teach a child the notes or pick out a tune.
- **Metronome** — 40 to 240 beats a minute, with an accented first beat and
  tap-to-set-tempo. The reference pitches next to it are A 440 and the six
  guitar strings, for tuning by ear.
- **Timer** — a countdown with an alarm and a stopwatch. The first preset is
  there because one minute at a rolling boil (three above 2,000 m) is what
  makes doubtful water safe.
- **Unit converter** — length, mass, volume, area, speed and temperature,
  including the awkward ones: pints and gallons in both UK and US sizes,
  stones, acres, nautical miles and knots.

## The notebook, sheets, media and games

- **Notebook** — journal pages, recipes and lists, kept per person. A page
  ticked *shared* is visible to everyone on the network. Six recipes ship
  with the vault; copy one into your own recipes to change it. Lists tick off.
- **Sheets** — a spreadsheet. Type into cells; a formula starts with `=` and
  the usual functions work (SUM, AVERAGE, IF, VLOOKUP, COUNTIF, ROUND, DATE,
  TODAY and about ninety more). Dates are typed British-style, 19/09/2026;
  `£12.50` and `50%` are understood and formatted. Bold, italics, alignment,
  number formats, fill and text colours; sort by any column; insert and
  delete rows and columns; freeze the top row; several sheets per workbook;
  undo. **Files ▾** opens, imports and exports: `.xlsx` files from Excel,
  LibreOffice or Google Sheets open here, and workbooks export back to
  `.xlsx` or `.csv`. Workbooks are saved as they change, as plain JSON in
  `library/sheets`. No subscription, no account, no expiry.
- **Media** — your own music, photos and films, from `library/media`. Music
  keeps playing while you read something else.
- **Games** — chess and draughts, for two at one screen or against the
  machine, which looks a few moves ahead.
- **Science** — the periodic table with a line on every element, and a night
  sky for any place, date and hour: stars, constellations, planets, the Moon.
