'use strict';
/* Vault map viewer.
   A slippy map drawn straight onto a canvas — pan, zoom, layers and points of
   interest, with no mapping library. Vector tiles arrive pre-decoded from the
   server, so all this has to do is draw them. */

const TILE_SIZE = 256;
const EARTH_RADIUS = 6378137;

// ------------------------------------------------------------- projection

const lonToWorldX = (lon, z) => ((lon + 180) / 360) * Math.pow(2, z);

function latToWorldY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  const merc = Math.log(Math.tan(rad) + 1 / Math.cos(rad));
  return ((1 - merc / Math.PI) / 2) * Math.pow(2, z);
}

const worldXToLon = (x, z) => (x / Math.pow(2, z)) * 360 - 180;

function worldYToLat(y, z) {
  const n = Math.PI * (1 - (2 * y) / Math.pow(2, z));
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/** Great-circle distance in metres, for the measuring tool. */
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
}

/** Length of a path of [lon, lat] points, in metres. */
function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1][1], points[i - 1][0], points[i][1], points[i][0]);
  }
  return total;
}

function formatDistance(metres) {
  if (metres < 1000) return `${Math.round(metres)} m`;
  if (metres < 10000) return `${(metres / 1000).toFixed(2)} km`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/** Initial bearing from one point to the next, in degrees clockwise from north. */
function bearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
    - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Area of a closed ring of [lon, lat] points in square metres. The ring is
 * projected onto a flat plane around its own centre first (metres east and
 * north), then the shoelace formula does the rest. Accurate to well under
 * a percent for anything you could walk round in a day.
 */
function polygonArea(points) {
  if (points.length < 3) return 0;
  const toRad = (d) => (d * Math.PI) / 180;
  const midLat = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const midLon = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const kx = EARTH_RADIUS * Math.cos(toRad(midLat));
  const local = points.map(([lon, lat]) => [toRad(lon - midLon) * kx, toRad(lat - midLat) * EARTH_RADIUS]);
  let twice = 0;
  for (let i = 0; i < local.length; i++) {
    const [x1, y1] = local[i];
    const [x2, y2] = local[(i + 1) % local.length];
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

function formatArea(m2) {
  if (m2 < 10000) return `${Math.round(m2)} m²`;
  if (m2 < 1e6) return `${(m2 / 10000).toFixed(2)} ha`;
  return `${(m2 / 1e6).toFixed(2)} km²`;
}

/** Per-leg distances and bearings for a route of [lon, lat] nodes. */
function routeLegs(points) {
  const legs = [];
  for (let i = 1; i < points.length; i++) {
    const [lon1, lat1] = points[i - 1];
    const [lon2, lat2] = points[i];
    legs.push({ distance: haversine(lat1, lon1, lat2, lon2), bearing: bearing(lat1, lon1, lat2, lon2) });
  }
  return legs;
}

// ------------------------------------------------------------------ style

/** Two palettes: a paper map for navigating, a dark one to match the app. */
const STYLES = {
  paper: {
    background: '#e8e0d0',
    earth: '#f4efe2',
    water: '#a8c8e0',
    layers: {
      landuse: {
        forest: '#c8d8b8', wood: '#c8d8b8', grass: '#dce8cc', grassland: '#dce8cc',
        park: '#d4e4c0', garden: '#d8e8c4', recreation_ground: '#d8e8c4', pitch: '#cfe4b8',
        farmland: '#eee4c8', farm: '#eee4c8', meadow: '#e4ecd0', orchard: '#dce4b8',
        residential: '#eae4da', urban_area: '#eae4da', commercial: '#eee0dc',
        industrial: '#e0d8d8', military: '#e8d8d0', school: '#e8e4d8', hospital: '#f0dcd8',
        cemetery: '#d8e0d0', beach: '#f4ecd0', wetland: '#d4e0d8', scrub: '#dae4c4',
        barren: '#eee8dc', glacier: '#eef4f8', snow: '#eef4f8',
        pedestrian: '#eeeae0', platform: '#e0dcd4', aerodrome: '#e4e4ec',
      },
      buildings: '#d8cdbc',
      roads: {
        motorway: { colour: '#e07a3a', width: 4.5 },
        motorway_link: { colour: '#e89a4a', width: 2.4 },
        trunk: { colour: '#e89a4a', width: 3.8 },
        trunk_link: { colour: '#eab060', width: 2.2 },
        primary: { colour: '#f0b860', width: 3.2 },
        primary_link: { colour: '#f0c070', width: 2 },
        secondary: { colour: '#f4d488', width: 2.6 },
        tertiary: { colour: '#f8e8b8', width: 2.2 },
        residential: { colour: '#ffffff', width: 1.8 },
        unclassified: { colour: '#ffffff', width: 1.6 },
        service: { colour: '#fbfbfb', width: 1.1 },
        pedestrian: { colour: '#eeeae0', width: 1.4 },
        footway: { colour: '#b09878', width: 1, dash: [3, 3] },
        sidewalk: { colour: '#c0ac90', width: 0.8, dash: [2, 3] },
        cycleway: { colour: '#8fa8c0', width: 1, dash: [4, 3] },
        bridleway: { colour: '#a89070', width: 1, dash: [5, 3] },
        steps: { colour: '#b08878', width: 1.4, dash: [2, 2] },
        track: { colour: '#b09878', width: 1.3, dash: [5, 3] },
        subway: { colour: '#b0b0c0', width: 1.2, dash: [4, 4] },
        // Fallbacks keyed on the coarse `kind` when there is no detail.
        highway: { colour: '#e07a3a', width: 3.6 },
        major_road: { colour: '#f0c070', width: 2.8 },
        minor_road: { colour: '#ffffff', width: 1.6 },
        path: { colour: '#b09878', width: 1, dash: [3, 3] },
        rail: { colour: '#9a9a9a', width: 1.4, dash: [7, 4] },
        ferry: { colour: '#6a8ca8', width: 1.2, dash: [5, 5] },
        other: { colour: '#f0eee8', width: 1.1 },
      },
      boundaries: '#a08890',
      contour: '#c9a26b',
      label: '#3a3228',
      labelHalo: '#f4efe2',
    },
  },
  // The look of an Ordnance Survey Explorer sheet: blue motorways, red A
  // roads, orange B roads, yellow minor roads, green rights of way, brown
  // contours. Best on the OS Open Zoomstack pack, which has the contours.
  os: {
    background: '#ffffff',
    earth: '#ffffff',
    water: '#a5d0ee',
    layers: {
      landuse: {
        forest: '#c6e3b3', wood: '#c6e3b3', grass: '#eef5e6', grassland: '#eef5e6',
        park: '#dff0d0', garden: '#dff0d0', recreation_ground: '#e8f3dc', pitch: '#e8f3dc',
        farmland: '#ffffff', farm: '#ffffff', meadow: '#eef5e6', orchard: '#dcebc8',
        residential: '#ecd9c6', urban_area: '#ecd9c6', commercial: '#ecd9c6',
        industrial: '#e6ddd8', military: '#f2e0e0', school: '#e9dfe9', hospital: '#f4dede',
        cemetery: '#e2ecd8', beach: '#fbf3d5', wetland: '#dcecf2', scrub: '#e4efd8',
        barren: '#f6f2ea', glacier: '#f0f6fa', snow: '#f0f6fa',
        pedestrian: '#f3ede4', platform: '#e3e3e8', aerodrome: '#e3e3e8',
      },
      buildings: '#c7b8a6',
      roads: {
        motorway: { colour: '#2f7fd8', width: 4.5 },
        motorway_link: { colour: '#5a9be0', width: 2.4 },
        trunk: { colour: '#3c8f4e', width: 3.8 },
        trunk_link: { colour: '#5aa36a', width: 2.2 },
        primary: { colour: '#e8465a', width: 3.2 },
        primary_link: { colour: '#ee7484', width: 2 },
        secondary: { colour: '#f39a3b', width: 2.6 },
        tertiary: { colour: '#f7e36a', width: 2.2 },
        residential: { colour: '#ffffff', width: 1.8 },
        unclassified: { colour: '#ffffff', width: 1.6 },
        service: { colour: '#fafafa', width: 1.1 },
        pedestrian: { colour: '#f3ede4', width: 1.4 },
        footway: { colour: '#2f9e44', width: 1.2, dash: [4, 3] },
        sidewalk: { colour: '#7fbf8a', width: 0.8, dash: [2, 3] },
        cycleway: { colour: '#3c7fc4', width: 1.1, dash: [5, 3] },
        bridleway: { colour: '#2f9e44', width: 1.2, dash: [8, 4] },
        steps: { colour: '#2f9e44', width: 1.4, dash: [2, 2] },
        track: { colour: '#7a6a58', width: 1.2, dash: [6, 3] },
        subway: { colour: '#9a9aa8', width: 1.2, dash: [4, 4] },
        highway: { colour: '#2f7fd8', width: 3.6 },
        major_road: { colour: '#e8465a', width: 2.8 },
        minor_road: { colour: '#ffffff', width: 1.6 },
        path: { colour: '#2f9e44', width: 1.2, dash: [4, 3] },
        rail: { colour: '#333333', width: 1.6, dash: [8, 4] },
        ferry: { colour: '#3c7fc4', width: 1.2, dash: [5, 5] },
        other: { colour: '#f0ede6', width: 1.1 },
      },
      boundaries: '#8f6aa8',
      contour: '#c98a3c',
      label: '#1f1a14',
      labelHalo: '#ffffff',
    },
  },
  dark: {
    background: '#0a0d12',
    earth: '#161b22',
    water: '#0f2438',
    layers: {
      landuse: {
        forest: '#17251a', wood: '#17251a', grass: '#1b2a1d', grassland: '#1b2a1d',
        park: '#1b2a1d', garden: '#1d2c1f', recreation_ground: '#1d2c1f', pitch: '#1f2e20',
        farmland: '#252312', farm: '#252312', meadow: '#1f2a1a', orchard: '#222a16',
        residential: '#1a1e25', urban_area: '#1a1e25', commercial: '#221f26',
        industrial: '#221f24', military: '#2a1e1e', school: '#20222a', hospital: '#2a1e22',
        cemetery: '#1a231c', beach: '#2a2618', wetland: '#152420', scrub: '#1d2718',
        barren: '#23231f', glacier: '#20282e', snow: '#20282e',
        pedestrian: '#1d2027', platform: '#22252b', aerodrome: '#1e1f28',
      },
      buildings: '#232a33',
      roads: {
        motorway: { colour: '#9a7530', width: 4.5 },
        motorway_link: { colour: '#8a6a2a', width: 2.4 },
        trunk: { colour: '#8a6a2a', width: 3.8 },
        trunk_link: { colour: '#7a5f28', width: 2.2 },
        primary: { colour: '#6b5426', width: 3.2 },
        primary_link: { colour: '#5f4b24', width: 2 },
        secondary: { colour: '#54595e', width: 2.6 },
        tertiary: { colour: '#484e56', width: 2.2 },
        residential: { colour: '#3a4048', width: 1.8 },
        unclassified: { colour: '#3a4048', width: 1.6 },
        service: { colour: '#31363d', width: 1.1 },
        pedestrian: { colour: '#343a42', width: 1.4 },
        footway: { colour: '#4a4438', width: 1, dash: [3, 3] },
        sidewalk: { colour: '#3e3a32', width: 0.8, dash: [2, 3] },
        cycleway: { colour: '#3a4650', width: 1, dash: [4, 3] },
        bridleway: { colour: '#4a4030', width: 1, dash: [5, 3] },
        steps: { colour: '#4e4038', width: 1.4, dash: [2, 2] },
        track: { colour: '#4a4438', width: 1.3, dash: [5, 3] },
        subway: { colour: '#3f414c', width: 1.2, dash: [4, 4] },
        highway: { colour: '#9a7530', width: 3.6 },
        major_road: { colour: '#6b5426', width: 2.8 },
        minor_road: { colour: '#3a4048', width: 1.6 },
        path: { colour: '#4a4438', width: 1, dash: [3, 3] },
        rail: { colour: '#4a4a52', width: 1.4, dash: [7, 4] },
        ferry: { colour: '#2f4a5e', width: 1.2, dash: [5, 5] },
        other: { colour: '#363c44', width: 1.1 },
      },
      boundaries: '#5a4a55',
      contour: '#4a3d2c',
      label: '#d8dee6',
      labelHalo: '#0a0d12',
    },
  },
};

// Geometry type codes, as sent by the server.
const POINT = 1;
const LINE = 2;
const POLYGON = 3;

// How wide each kind of watercourse is drawn, before zoom scaling.
const WATER_LINE_WIDTHS = {
  river: 2.2, stream: 1.1, canal: 1.8, drain: 0.8, ditch: 0.7,
  dam: 1.6, weir: 1.4, other: 1.2,
};

// The order layers are painted in; anything not listed is skipped.
const DRAW_ORDER = ['earth', 'landcover', 'landuse', 'natural', 'water', 'contours', 'buildings', 'roads', 'boundaries'];

// ------------------------------------------------------ OS Open Zoomstack
// Ordnance Survey's free vector map of Great Britain uses its own layer names
// and classes. Rather than teach the renderer a second schema, each tile is
// translated once, on arrival, into the Protomaps shape everything else
// draws. Contours are the one thing Protomaps lacks, so they get a layer.

const isZoomstack = (data) => Boolean(data.names || data.surfacewater || data.urban_areas || data.contours);

const ZS_ROADS = [
  ['motorway', 'motorway'], ['primary', 'trunk'], ['a road', 'primary'], ['b road', 'secondary'],
  ['minor', 'tertiary'], ['local', 'residential'], ['restricted', 'service'], ['busway', 'service'],
  ['path', 'footway'], ['foot', 'footway'], ['cycle', 'cycleway'], ['bridle', 'bridleway'],
];
const ZS_SITES = { 'air transport': 'aerodrome', education: 'school', 'medical care': 'hospital', 'road transport': 'platform', 'water transport': 'platform', ports: 'industrial' };
const ZS_GREEN = [['cemetery', 'cemetery'], ['allotment', 'farmland'], ['golf', 'grass'], ['play', 'pitch'], ['sport', 'pitch'], ['park', 'park'], ['garden', 'garden'], ['wood', 'forest']];
// The zoom a named place first shows at, by OS class.
const ZS_PLACES = {
  country: 3, capital: 4, city: 6, town: 8, village: 10, hamlet: 12, 'suburban area': 11, 'small settlements': 13,
  'woodland or forest': 13, woodland: 13, landform: 12, hydrography: 12, water: 13, landcover: 13, sites: 14, greenspace: 14.5, 'national park': 8,
};

function fromZoomstack(data) {
  const out = {};
  const push = (layer, feature) => { (out[layer] = out[layer] || []).push(feature); };
  const match = (table, k) => { for (const [needle, value] of table) if (k.includes(needle)) return value; return null; };

  for (const f of data.sea || []) push('water', f);
  for (const f of data.surfacewater || []) push('water', { ...f, k: 'lake' });
  // mhw / mlw are the tide lines along the coast; the rest are streams.
  for (const f of data.waterlines || []) push('water', { ...f, k: f.k === 'mhw' || f.k === 'mlw' ? 'ditch' : 'stream' });
  for (const f of data.foreshore || []) push('landuse', { ...f, k: 'beach' });
  for (const f of data.urban_areas || []) push('landuse', { ...f, k: 'urban_area' });
  for (const f of data.woodland || []) push('landuse', { ...f, k: 'forest' });
  for (const f of data.greenspaces || []) push('landuse', { ...f, k: match(ZS_GREEN, f.k || '') || 'park' });
  for (const f of data.sites || []) push('landuse', { ...f, k: ZS_SITES[f.k] || 'commercial' });
  for (const f of data.national_parks || []) push('landuse', { ...f, t: LINE, k: 'national_park' });
  for (const f of data.buildings || []) push('buildings', f);
  for (const f of data.contours || []) push('contours', f);
  for (const f of data.rail || []) push('roads', { ...f, k: 'rail', d: 'rail' });
  for (const f of data.roads || []) push('roads', { ...f, d: match(ZS_ROADS, f.k || '') || 'other' });
  for (const f of data.boundaries || []) push('boundaries', f);
  for (const f of data.names || []) {
    const z = ZS_PLACES[f.k];
    if (z === undefined || !f.n) continue;
    push('places', { ...f, z, k: f.k === 'city' || f.k === 'town' || f.k === 'village' || f.k === 'hamlet' || f.k === 'capital' ? 'locality' : f.k });
  }
  for (const f of data.railwaystations || []) push('places', { ...f, z: 12, k: 'station' });
  for (const f of data.airports || []) push('places', { ...f, z: 9, k: 'airport' });
  return out;
}

// How important each road class is: 0 shows from the world view, 6 only
// when you are practically standing on it.
const ROAD_RANK = {
  motorway: 0, highway: 0, trunk: 1, ferry: 1, rail: 2,
  primary: 2, major_road: 2, motorway_link: 3, trunk_link: 3, secondary: 3,
  primary_link: 4, tertiary: 4, subway: 4,
  residential: 5, unclassified: 5, minor_road: 5, pedestrian: 5, other: 5,
  service: 6, footway: 6, sidewalk: 6, cycleway: 6, bridleway: 6, steps: 6, track: 6, path: 6,
};

class VaultMap {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.centre = { lon: options.lon ?? -2.0, lat: options.lat ?? 54.0 };
    this.zoom = options.zoom ?? 6;
    this.styleName = options.style || 'paper';

    this.basePack = null;      // vector pack id
    this.overlayPacks = [];    // raster pack ids drawn on top
    this.baseRaster = null;    // satellite imagery under the roads and names
    this.hillshade = null;     // terrain pack id shading the slopes
    this.rasterInfo = {};      // pack id -> { minZoom, maxZoom }, for drawing beyond a pack's zoom
    this._shades = new Map();  // computed hillshade tiles
    this.minZoom = 0;
    this.maxZoom = 15;

    this.enabledCategories = new Set(Object.keys(options.categories || {}));
    this.categoryColours = options.categories || {};
    this.showPoi = true;
    this.showLabels = true;

    // Hand-drawn annotation layers: routes, hazards, anything the map does
    // not know about because the world changed after the map was made.
    this.annotationLayers = [];
    this.activeLayerId = null;
    this.drawMode = null;          // null | 'pen' | 'eraser' | 'pin' | 'measure' | 'route'
    this.penColour = '#f85149';
    this.penWidth = 3;
    this.showAnnotations = true;
    this.showLengths = true;
    this._measure = [];            // points of the measuring tape, not saved
    this._measureClosed = false;   // tape joined back to its start: perimeter + area
    this._route = [];              // nodes of the route being planned, until saved
    this.sunTime = null;           // a Date: shade the night side of the world for that instant
    this.showNight = false;

    this._tiles = new Map();
    this._pending = new Set();
    this._raster = new Map();
    this._frame = null;
    this._timer = null;
    this._marker = null;
    this._drawing = false;
    this._activeStroke = null;
    this._erasedIds = null;

    this._bindEvents();
    this.resize();
  }

  get style() {
    return STYLES[this.styleName] || STYLES.paper;
  }

  setStyle(name) {
    this.styleName = name;
    this.draw();
  }

  setBase(packId, info) {
    this.basePack = packId;

    if (info) {
      this.minZoom = info.minZoom ?? 0;
      this.maxZoom = info.maxZoom ?? 15;

      // Only move the view if where we are looking is outside this pack. A
      // planet archive declares its centre as 0,0 — jumping there every time
      // would drop you in the Atlantic.
      const bounds = info.bounds;
      const covered = Array.isArray(bounds) && bounds.length === 4
        && this.centre.lon >= bounds[0] && this.centre.lon <= bounds[2]
        && this.centre.lat >= bounds[1] && this.centre.lat <= bounds[3];

      if (!covered && Array.isArray(bounds) && bounds.length === 4) {
        this.centre = {
          lon: (bounds[0] + bounds[2]) / 2,
          lat: (bounds[1] + bounds[3]) / 2,
        };
        this.zoom = Math.max(info.centerZoom || 6, this.minZoom);
      }
      this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom + 2, this.zoom));
    }

    this._tiles.clear();
    this.draw();
  }

  setOverlays(ids) {
    this.overlayPacks = ids;
    this._raster.clear();
    this.draw();
  }

  /** Zoom ranges of the raster packs, so a tile can be borrowed from a lower zoom. */
  setRasterInfo(packs) {
    this.rasterInfo = {};
    for (const p of packs) this.rasterInfo[p.id] = { minZoom: p.minZoom ?? 0, maxZoom: p.maxZoom ?? 18 };
  }

  setBaseRaster(packId) {
    this.baseRaster = packId || null;
    this.draw();
  }

  setHillshade(packId) {
    this.hillshade = packId || null;
    this._shades.clear();
    this.draw();
  }

  resize() {
    const ratio = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(rect.width * ratio);
    this.canvas.height = Math.round(rect.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    this.draw();
  }

  // ------------------------------------------------------------- interaction

  _bindEvents() {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    let downX = 0;
    let downY = 0;

    const pointerDown = (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      downX = e.clientX;
      downY = e.clientY;

      // With a tool selected, dragging draws instead of panning. Pin and
      // measure are click tools, handled on pointer-up so a drag still pans.
      if (this.drawMode === 'pen' || this.drawMode === 'eraser') {
        const rect = this.canvas.getBoundingClientRect();
        const position = this.pixelToLonLat(e.clientX - rect.left, e.clientY - rect.top);
        if (this.drawMode === 'pen') {
          this._activeStroke = {
            colour: this.penColour,
            width: this.penWidth,
            points: [[position.lon, position.lat]],
          };
        } else {
          this._erasedIds = new Set();
          this._eraseAt(e.clientX - rect.left, e.clientY - rect.top);
        }
        this._drawing = true;
        this.draw();
        return;
      }

      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      this.canvas.style.cursor = 'grabbing';
    };

    const pointerMove = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this._hover = this.pixelToLonLat(e.clientX - rect.left, e.clientY - rect.top);
      if (this.onHover) this.onHover(this._hover);

      if (this._drawing) {
        if (this.drawMode === 'pen' && this._activeStroke) {
          this._activeStroke.points.push([this._hover.lon, this._hover.lat]);
          if (this.onMeasure) this.onMeasure(pathLength(this._activeStroke.points), this._activeStroke.points.length, 'drawing');
        } else if (this.drawMode === 'eraser') {
          this._eraseAt(e.clientX - rect.left, e.clientY - rect.top);
        }
        this.draw();
        return;
      }

      if (!dragging) return;
      const scale = Math.pow(2, this.zoom);
      const worldX = lonToWorldX(this.centre.lon, 0) * scale - (e.clientX - lastX) / TILE_SIZE;
      const worldY = latToWorldY(this.centre.lat, 0) * scale - (e.clientY - lastY) / TILE_SIZE;

      this.centre = {
        lon: worldXToLon(worldX, this.zoom),
        lat: Math.max(-85, Math.min(85, worldYToLat(worldY, this.zoom))),
      };
      lastX = e.clientX;
      lastY = e.clientY;
      this.draw();
    };

    const pointerUp = (e) => {
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* already gone */ }

      if (this._drawing) {
        this._drawing = false;
        if (this.drawMode === 'pen' && this._activeStroke && this._activeStroke.points.length > 1) {
          const stroke = this._activeStroke;
          stroke.length = pathLength(stroke.points);
          if (this.onStroke) this.onStroke(stroke);
        } else if (this.drawMode === 'eraser' && this._erasedIds && this._erasedIds.size) {
          if (this.onErase) this.onErase([...this._erasedIds]);
        }
        this._activeStroke = null;
        this._erasedIds = null;
        this.draw();
        return;
      }

      dragging = false;
      this.canvas.style.cursor = this.drawMode ? 'crosshair' : 'grab';

      // A click — not a drag — with a click tool active.
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved < 5 && (this.drawMode === 'pin' || this.drawMode === 'measure' || this.drawMode === 'route')) {
        const rect = this.canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const position = this.pixelToLonLat(px, py);
        if (this.drawMode === 'pin') {
          if (this.onPin) this.onPin(position);
        } else if (this.drawMode === 'measure') {
          if (this._measureClosed) { this._measure = []; this._measureClosed = false; }
          // Clicking back on the first point closes the shape.
          if (this._measure.length >= 3) {
            const first = this.lonLatToPixel(this._measure[0][0], this._measure[0][1]);
            if (Math.hypot(first.x - px, first.y - py) <= 10) { this.closeMeasure(); return; }
          }
          this._measure.push([position.lon, position.lat]);
          this._reportMeasure();
          this.draw();
        } else {
          this._route.push([position.lon, position.lat]);
          this._reportRoute();
          this.draw();
        }
      }
    };

    this.canvas.addEventListener('pointerdown', pointerDown);
    this.canvas.addEventListener('pointermove', pointerMove);
    this.canvas.addEventListener('pointerup', pointerUp);
    this.canvas.addEventListener('pointercancel', pointerUp);

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.zoomAround(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 0.5 : -0.5);
    }, { passive: false });

    this.canvas.addEventListener('dblclick', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.zoomAround(e.clientX - rect.left, e.clientY - rect.top, 1);
    });

    window.addEventListener('resize', () => this.resize());
    // The sidebar collapsing, or the page laying out late, changes the
    // canvas size without a window resize.
    if (window.ResizeObserver) {
      new ResizeObserver(() => { if (Math.abs(this.canvas.clientWidth - this.width) > 1) this.resize(); }).observe(this.canvas);
    }
  }

  /** Zoom keeping the point under the cursor fixed, as a map should. */
  zoomAround(px, py, delta) {
    const before = this.pixelToLonLat(px, py);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom + 2, this.zoom + delta));
    const after = this.pixelToLonLat(px, py);
    this.centre = {
      lon: this.centre.lon + (before.lon - after.lon),
      lat: Math.max(-85, Math.min(85, this.centre.lat + (before.lat - after.lat))),
    };
    this.draw();
  }

  zoomBy(delta) {
    this.zoomAround(this.width / 2, this.height / 2, delta);
  }

  /** Move and zoom so a lon/lat box fills most of the view. */
  fitBounds([west, south, east, north], padding = 0.75) {
    const lon = (west + east) / 2;
    const lat = (south + north) / 2;
    let zoom = this.maxZoom + 1;
    for (; zoom > this.minZoom; zoom -= 0.25) {
      const scale = Math.pow(2, zoom) * TILE_SIZE;
      const w = Math.abs(lonToWorldX(east, 0) - lonToWorldX(west, 0)) * scale;
      const h = Math.abs(latToWorldY(north, 0) - latToWorldY(south, 0)) * scale;
      if (w <= this.width * padding && h <= this.height * padding) break;
    }
    this.goTo(lon, lat, Math.min(zoom, 16));
  }

  goTo(lon, lat, zoom) {
    this.centre = { lon, lat };
    if (zoom !== undefined) this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom + 2, zoom));
    this.draw();
  }

  setMarker(lon, lat) {
    this._marker = lon === null ? null : { lon, lat };
    this.draw();
  }

  pixelToLonLat(px, py) {
    const scale = Math.pow(2, this.zoom);
    const centreWorldX = lonToWorldX(this.centre.lon, 0) * scale;
    const centreWorldY = latToWorldY(this.centre.lat, 0) * scale;
    const worldX = centreWorldX + (px - this.width / 2) / TILE_SIZE;
    const worldY = centreWorldY + (py - this.height / 2) / TILE_SIZE;
    return { lon: worldXToLon(worldX, this.zoom), lat: worldYToLat(worldY, this.zoom) };
  }

  lonLatToPixel(lon, lat) {
    const scale = Math.pow(2, this.zoom);
    const centreWorldX = lonToWorldX(this.centre.lon, 0) * scale;
    const centreWorldY = latToWorldY(this.centre.lat, 0) * scale;
    return {
      x: (lonToWorldX(lon, 0) * scale - centreWorldX) * TILE_SIZE + this.width / 2,
      y: (latToWorldY(lat, 0) * scale - centreWorldY) * TILE_SIZE + this.height / 2,
    };
  }

  // ------------------------------------------------------------------ tiles

  _tileZoom() {
    return Math.max(this.minZoom, Math.min(this.maxZoom, Math.round(this.zoom)));
  }

  async _fetchVectorTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (this._tiles.has(key) || this._pending.has(key)) return;
    this._pending.add(key);
    try {
      const res = await fetch(`/tile/${encodeURIComponent(this.basePack)}/${z}/${x}/${y}`);
      const data = res.ok ? await res.json() : {};
      this._tiles.set(key, isZoomstack(data) ? fromZoomstack(data) : data);
    } catch {
      this._tiles.set(key, {});
    } finally {
      this._pending.delete(key);
      this.draw();
    }
  }

  _rasterTile(packId, z, x, y) {
    const key = `${packId}/${z}/${x}/${y}`;
    let image = this._raster.get(key);
    if (image) return image.complete && image.naturalWidth > 0 ? image : null;

    image = new Image();
    image.onload = () => this.draw();
    image.onerror = () => { /* missing tiles are normal at the edges */ };
    image.src = `/tile/${encodeURIComponent(packId)}/${z}/${x}/${y}.png`;
    this._raster.set(key, image);
    if (this._raster.size > 400) {
      // Keep the cache from growing without bound during a long pan.
      const oldest = this._raster.keys().next().value;
      this._raster.delete(oldest);
    }
    return null;
  }

  /**
   * Draw a raster pack over the visible tiles. Past the pack's own zoom the
   * nearest ancestor tile is scaled up, so a photo taken to zoom 11 still
   * shows (blurrily) at zoom 14 rather than vanishing.
   */
  _drawRasterPack(packId, visible, tz, tilePx, alpha) {
    const ctx = this.ctx;
    const info = this.rasterInfo[packId] || { minZoom: 0, maxZoom: 18 };
    const z = Math.min(tz, info.maxZoom);
    const shift = tz - z;
    ctx.globalAlpha = alpha;
    for (const tile of visible) {
      const ax = tile.tx >> shift;
      const ay = tile.ty >> shift;
      const image = this._rasterTile(packId, z, ax, ay);
      if (!image) continue;
      if (shift === 0) {
        ctx.drawImage(image, tile.px, tile.py, tilePx, tilePx);
      } else {
        const part = image.width / Math.pow(2, shift);
        const sx = (tile.tx - ax * Math.pow(2, shift)) * part;
        const sy = (tile.ty - ay * Math.pow(2, shift)) * part;
        ctx.drawImage(image, sx, sy, part, part, tile.px, tile.py, tilePx, tilePx);
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Hillshade from a Terrarium tile: heights decoded from the pixel colours,
   * slope and aspect from the neighbours, lit from the north-west as maps
   * are. Computed once per tile and kept.
   */
  _shadeTile(packId, z, x, y) {
    const key = `${packId}/${z}/${x}/${y}`;
    if (this._shades.has(key)) return this._shades.get(key);
    const image = this._rasterTile(packId, z, x, y);
    if (!image) return null;

    const size = image.width;
    const src = document.createElement('canvas');
    src.width = size; src.height = size;
    const sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(image, 0, 0);
    let pixels;
    try { pixels = sctx.getImageData(0, 0, size, size).data; } catch { return null; }

    const heights = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
      heights[i] = pixels[i * 4] * 256 + pixels[i * 4 + 1] + pixels[i * 4 + 2] / 256 - 32768;
    }

    // Metres per pixel at this tile's latitude.
    const lat = worldYToLat(y + 0.5, z);
    const metresPerPixel = (40075016.686 * Math.cos(lat * Math.PI / 180)) / (size * Math.pow(2, z));
    const out = document.createElement('canvas');
    out.width = size; out.height = size;
    const octx = out.getContext('2d');
    const shade = octx.createImageData(size, size);
    const zenith = 45 * Math.PI / 180;
    const azimuth = 315 * Math.PI / 180;
    const clampIdx = (v) => Math.max(0, Math.min(size - 1, v));

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const h = (dx, dy) => heights[clampIdx(py + dy) * size + clampIdx(px + dx)];
        const dzdx = (h(1, 0) - h(-1, 0)) / (2 * metresPerPixel);
        const dzdy = (h(0, 1) - h(0, -1)) / (2 * metresPerPixel);
        const slope = Math.atan(1.6 * Math.hypot(dzdx, dzdy)); // exaggerated a little, as paper maps do
        let aspect = Math.atan2(dzdy, -dzdx);
        if (aspect < 0) aspect += 2 * Math.PI;
        const value = Math.cos(zenith) * Math.cos(slope) + Math.sin(zenith) * Math.sin(slope) * Math.cos(azimuth - aspect);
        const dark = Math.max(0, Math.min(1, 0.72 - value)) * 0.9;
        const light = Math.max(0, value - 0.78) * 0.5;
        const i = (py * size + px) * 4;
        if (light > dark) { shade.data[i] = 255; shade.data[i + 1] = 255; shade.data[i + 2] = 240; shade.data[i + 3] = Math.round(light * 255); }
        else { shade.data[i] = 20; shade.data[i + 1] = 16; shade.data[i + 2] = 10; shade.data[i + 3] = Math.round(dark * 255); }
      }
    }
    octx.putImageData(shade, 0, 0);
    if (this._shades.size > 200) this._shades.delete(this._shades.keys().next().value);
    this._shades.set(key, out);
    return out;
  }

  _drawHillshade(visible, tz, tilePx) {
    const ctx = this.ctx;
    const info = this.rasterInfo[this.hillshade] || { minZoom: 0, maxZoom: 10 };
    const z = Math.min(tz, info.maxZoom);
    const shift = tz - z;
    ctx.globalAlpha = tz >= 14 ? 0.45 : 0.7;
    for (const tile of visible) {
      const ax = tile.tx >> shift;
      const ay = tile.ty >> shift;
      const shaded = this._shadeTile(this.hillshade, z, ax, ay);
      if (!shaded) continue;
      if (shift === 0) {
        ctx.drawImage(shaded, tile.px, tile.py, tilePx, tilePx);
      } else {
        const part = shaded.width / Math.pow(2, shift);
        const sx = (tile.tx - ax * Math.pow(2, shift)) * part;
        const sy = (tile.ty - ay * Math.pow(2, shift)) * part;
        ctx.drawImage(shaded, sx, sy, part, part, tile.px, tile.py, tilePx, tilePx);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ----------------------------------------------------------------- drawing

  /**
   * Schedule a redraw. requestAnimationFrame is the right tool while the page
   * is visible, but it never fires in a hidden or heavily throttled tab — so a
   * timer backs it up and whichever arrives first cancels the other.
   */
  draw() {
    if (this._frame || this._timer) return;

    const run = () => {
      if (this._frame) cancelAnimationFrame(this._frame);
      clearTimeout(this._timer);
      this._frame = null;
      this._timer = null;
      this._render();
    };

    this._frame = requestAnimationFrame(run);
    this._timer = setTimeout(run, 120);
  }

  _render() {
    const ctx = this.ctx;
    const style = this.style;

    // Tell whoever is listening that the view moved (used to remember it).
    const viewKey = this.centre.lon.toFixed(5) + "," + this.centre.lat.toFixed(5) + "," + this.zoom.toFixed(2);
    if (viewKey !== this._lastViewKey) { this._lastViewKey = viewKey; if (this.onMove) this.onMove(this.centre, this.zoom); }

    ctx.fillStyle = style.background;
    ctx.fillRect(0, 0, this.width, this.height);

    if (!this.basePack) {
      this._drawEmptyState();
      return;
    }

    const tz = this._tileZoom();
    const scale = Math.pow(2, this.zoom - tz);
    const tilePx = TILE_SIZE * scale;

    const worldScale = Math.pow(2, tz);
    const centreX = lonToWorldX(this.centre.lon, 0) * worldScale;
    const centreY = latToWorldY(this.centre.lat, 0) * worldScale;

    const originX = this.width / 2 - centreX * tilePx;
    const originY = this.height / 2 - centreY * tilePx;

    const minTileX = Math.floor(-originX / tilePx);
    const maxTileX = Math.ceil((this.width - originX) / tilePx);
    const minTileY = Math.floor(-originY / tilePx);
    const maxTileY = Math.ceil((this.height - originY) / tilePx);

    const span = Math.pow(2, tz);
    const visible = [];

    for (let ty = minTileY; ty < maxTileY; ty++) {
      if (ty < 0 || ty >= span) continue;
      for (let tx = minTileX; tx < maxTileX; tx++) {
        const wrapped = ((tx % span) + span) % span;
        visible.push({
          tx: wrapped,
          ty,
          px: originX + tx * tilePx,
          py: originY + ty * tilePx,
        });
      }
    }

    // Satellite imagery goes underneath; the vector map then draws only its
    // roads, boundaries and names over the photograph.
    if (this.baseRaster) this._drawRasterPack(this.baseRaster, visible, tz, tilePx, 1);
    this._skipFills = Boolean(this.baseRaster);

    // Vector base
    for (const tile of visible) {
      const key = `${tz}/${tile.tx}/${tile.ty}`;
      const data = this._tiles.get(key);
      if (data === undefined) {
        this._fetchVectorTile(tz, tile.tx, tile.ty);
        continue;
      }
      this._drawTile(data, tile.px, tile.py, tilePx);
    }

    // Slopes, from the terrain heights.
    if (this.hillshade && !this.baseRaster) this._drawHillshade(visible, tz, tilePx);

    // Raster overlays, e.g. the nautical chart
    for (const packId of this.overlayPacks) this._drawRasterPack(packId, visible, tz, tilePx, 0.9);

    // Day and night, under the labels so place names stay legible.
    if (this.showNight && this.sunTime && window.vaultAlmanac) this._drawNight();

    // Points of interest and labels go over everything. Label placement is
    // greedy: first come, first served, and anything that would overlap is
    // dropped — otherwise a city at close zoom is unreadable.
    this._labelBoxes = [];
    if (this.showPoi || this.showLabels) {
      for (const tile of visible) {
        const data = this._tiles.get(`${tz}/${tile.tx}/${tile.ty}`);
        if (data) this._drawOverlayFeatures(data, tile.px, tile.py, tilePx);
      }
    }

    if (this.showAnnotations) this._drawAnnotations();
    this._drawMarker();
    this._drawScaleBar();
  }

  // ------------------------------------------------------------ annotations

  setAnnotations(layers) {
    this.annotationLayers = layers || [];
    if (!this.activeLayerId && this.annotationLayers.length) {
      this.activeLayerId = this.annotationLayers[0].id;
    }
    this.draw();
  }

  setTool(mode) {
    this.drawMode = mode;
    this.canvas.classList.toggle('drawing', Boolean(mode));
    this.canvas.style.cursor = mode ? 'crosshair' : 'grab';
    if (mode !== 'measure') this.clearMeasure();
    if (mode !== 'route') this.clearRoute();
  }

  clearMeasure() {
    this._measure = [];
    this._measureClosed = false;
    if (this.onMeasure) this.onMeasure(0, 0);
    this.draw();
  }

  /** Join the tape back to its first point: a perimeter, with the area inside. */
  closeMeasure() {
    if (this._measure.length < 3) return;
    this._measureClosed = true;
    this._reportMeasure();
    this.draw();
  }

  /** Total length of the measuring tape so far (round the shape if closed). */
  measuredLength() {
    if (!this._measure.length) return 0;
    const points = this._measureClosed ? [...this._measure, this._measure[0]] : this._measure;
    return pathLength(points);
  }

  measurement() {
    return {
      points: this._measure.length,
      closed: this._measureClosed,
      length: this.measuredLength(),
      area: this._measureClosed ? polygonArea(this._measure) : 0,
    };
  }

  _reportMeasure() {
    if (!this.onMeasure) return;
    const m = this.measurement();
    this.onMeasure(m.length, m.points, m.closed ? 'closed' : 'tape', m);
  }

  // Route planning: click nodes, read the legs, save the route as a mark.

  clearRoute() {
    this._route = [];
    this._reportRoute();
    this.draw();
  }

  undoRouteNode() {
    this._route.pop();
    this._reportRoute();
    this.draw();
  }

  routePlan() {
    const legs = routeLegs(this._route);
    return {
      points: this._route.map((p) => [...p]),
      legs,
      length: legs.reduce((sum, leg) => sum + leg.distance, 0),
    };
  }

  _reportRoute() {
    if (this.onRoute) this.onRoute(this.routePlan());
  }

  _strokePath(points) {
    const ctx = this.ctx;
    ctx.beginPath();
    let started = false;
    for (const [lon, lat] of points) {
      const { x, y } = this.lonLatToPixel(lon, lat);
      if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
  }

  _drawAnnotations() {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pins = [];

    for (const layer of this.annotationLayers) {
      if (!layer.visible) continue;
      for (const mark of layer.strokes) {
        if (this._erasedIds && this._erasedIds.has(mark.id)) continue;
        if (mark.type === 'pin') { pins.push(mark); continue; }
        if (mark.type === 'route') { this._drawRoute(mark.points, mark.colour, mark.width || 3, mark.name, false); continue; }

        ctx.strokeStyle = mark.colour;
        ctx.lineWidth = mark.width;
        ctx.globalAlpha = 0.92;
        this._strokePath(mark.points);

        // A route is more useful with its length on it.
        if (this.showLengths && mark.length > 40 && mark.points.length > 1) {
          const end = mark.points[mark.points.length - 1];
          const { x, y } = this.lonLatToPixel(end[0], end[1]);
          this._drawTag(formatDistance(mark.length), x + 8, y - 8, mark.colour);
        }
      }
    }

    // The route being planned right now.
    if (this._route.length) this._drawRoute(this._route, this.penColour, 3, null, true);

    // The stroke currently under the pen, before it is saved.
    if (this._activeStroke && this._activeStroke.points.length > 1) {
      ctx.strokeStyle = this._activeStroke.colour;
      ctx.lineWidth = this._activeStroke.width;
      ctx.globalAlpha = 0.92;
      this._strokePath(this._activeStroke.points);
    }
    ctx.globalAlpha = 1;

    // Pins go over strokes, labels over pins.
    for (const pin of pins) this._drawPin(pin);

    // The measuring tape: dashed, with the running total at the last point.
    // Closed back on itself it becomes a perimeter, shaded, with the area.
    if (this._measure.length) {
      const points = this._measureClosed ? [...this._measure, this._measure[0]] : this._measure;
      if (this._measureClosed) {
        ctx.fillStyle = this.style.layers.label;
        ctx.globalAlpha = 0.12;
        ctx.beginPath();
        this._measure.forEach(([lon, lat], i) => {
          const { x, y } = this.lonLatToPixel(lon, lat);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = this.style.layers.label;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.globalAlpha = 0.9;
      this._strokePath(points);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      for (const [lon, lat] of this._measure) {
        const { x, y } = this.lonLatToPixel(lon, lat);
        ctx.fillStyle = this.style.layers.label;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // The first point grows a ring once it can be clicked to close the shape.
      if (!this._measureClosed && this._measure.length >= 3) {
        const { x, y } = this.lonLatToPixel(this._measure[0][0], this._measure[0][1]);
        ctx.strokeStyle = this.style.layers.label;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      const last = this._measure[this._measure.length - 1];
      const { x, y } = this.lonLatToPixel(last[0], last[1]);
      const m = this.measurement();
      const text = m.closed
        ? `${formatDistance(m.length)} round · ${formatArea(m.area)}`
        : formatDistance(m.length);
      this._drawTag(text, x + 10, y - 10, this.style.layers.label);
    }
  }

  /**
   * Shade the part of the world where the sun is down at this.sunTime. Column
   * by column: for each screen x the latitudes below a given sun altitude are
   * one or two spans, found by solving the altitude equation directly. Three
   * bands — sun set, civil dark, full night — build up the shadow.
   */
  _drawNight() {
    const A = window.vaultAlmanac;
    const sub = A.subsolarPoint(this.sunTime);
    const ctx = this.ctx;
    const step = 2;
    const bands = [[0, 0.10], [-6, 0.12], [-12, 0.14]];
    const sinD = Math.sin(sub.lat * Math.PI / 180);
    const cosD = Math.cos(sub.lat * Math.PI / 180);

    ctx.fillStyle = this.styleName === 'paper' ? '#0a1020' : '#000';
    for (const [h0, alpha] of bands) {
      ctx.globalAlpha = alpha;
      const c = Math.sin(h0 * Math.PI / 180);
      for (let x = 0; x < this.width; x += step) {
        const { lon } = this.pixelToLonLat(x, this.height / 2);
        const H = (lon - sub.lon) * Math.PI / 180;
        const a = sinD;
        const b = cosD * Math.cos(H);
        const R = Math.hypot(a, b);
        const theta = Math.atan2(b, a);
        // sin(phi + theta) = c / R. Breakpoints in latitude where the altitude crosses h0.
        const cuts = [-90, 90];
        if (R > 1e-9 && Math.abs(c / R) <= 1) {
          const s = Math.asin(c / R);
          for (const root of [s - theta, Math.PI - s - theta]) {
            let phi = ((root + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; // into (-pi, pi]
            phi = phi * 180 / Math.PI;
            if (phi > -90 && phi < 90) cuts.push(phi);
          }
        }
        cuts.sort((p, q) => p - q);
        for (let i = 0; i < cuts.length - 1; i++) {
          const lo = cuts[i];
          const hi = cuts[i + 1];
          if (hi - lo < 0.01) continue;
          const mid = (lo + hi) / 2;
          const alt = Math.asin(Math.max(-1, Math.min(1, a * Math.sin(mid * Math.PI / 180) + b * Math.cos(mid * Math.PI / 180))));
          if (alt < h0 * Math.PI / 180) {
            const top = this.lonLatToPixel(lon, Math.min(85, hi)).y;
            const bottom = this.lonLatToPixel(lon, Math.max(-85, lo)).y;
            if (bottom > 0 && top < this.height) ctx.fillRect(x, Math.max(0, top), step, Math.min(this.height, bottom) - Math.max(0, top));
          }
        }
      }
    }
    ctx.globalAlpha = 1;

    // The subsolar point: where it is noon, straight overhead.
    const p = this.lonLatToPixel(sub.lon, sub.lat);
    if (p.x >= 0 && p.x <= this.width && p.y >= 0 && p.y <= this.height) {
      ctx.strokeStyle = '#ffd24a';
      ctx.fillStyle = 'rgba(255, 210, 74, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** A planned route: numbered nodes, a distance on every leg, the total at the end. */
  _drawRoute(points, colour, width, name, live) {
    if (!points.length) return;
    const ctx = this.ctx;
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.globalAlpha = 0.92;
    if (live) ctx.setLineDash([10, 6]);
    this._strokePath(points);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const showLegs = this.showLengths || live;
    for (let i = 1; i < points.length && showLegs; i++) {
      const a = this.lonLatToPixel(points[i - 1][0], points[i - 1][1]);
      const b = this.lonLatToPixel(points[i][0], points[i][1]);
      if (Math.hypot(b.x - a.x, b.y - a.y) < 70) continue; // too short to label without clutter
      const d = haversine(points[i - 1][1], points[i - 1][0], points[i][1], points[i][0]);
      this._drawTag(formatDistance(d), (a.x + b.x) / 2 + 6, (a.y + b.y) / 2 - 6, colour);
    }

    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    points.forEach(([lon, lat], i) => {
      const { x, y } = this.lonLatToPixel(lon, lat);
      if (x < -20 || x > this.width + 20 || y < -20 || y > this.height + 20) return;
      ctx.fillStyle = colour;
      ctx.strokeStyle = this.style.layers.labelHalo;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText(String(i + 1), x, y + 0.5);
    });

    if (points.length > 1 && showLegs) {
      const end = points[points.length - 1];
      const { x, y } = this.lonLatToPixel(end[0], end[1]);
      const total = formatDistance(pathLength(points));
      this._drawTag(name ? `${name} · ${total}` : `${total} total`, x + 12, y - 14, colour);
    }
  }

  /** A small rounded label with a coloured edge, used for lengths and pins. */
  _drawTag(text, x, y, colour) {
    const ctx = this.ctx;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(text).width + 10;
    ctx.fillStyle = this.style.layers.labelHalo;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y - 9, width, 18, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = this.style.layers.label;
    ctx.fillText(text, x + 5, y);
  }

  _drawPin(pin) {
    const ctx = this.ctx;
    const { x, y } = this.lonLatToPixel(pin.lon, pin.lat);
    if (x < -40 || x > this.width + 40 || y < -40 || y > this.height + 40) return;

    // A map pin: circle head on a point, so it reads as a place not a dot.
    ctx.fillStyle = pin.colour || '#f85149';
    ctx.strokeStyle = this.style.layers.labelHalo;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y - 12, 7, Math.PI * 0.8, Math.PI * 0.2, false);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = this.style.layers.labelHalo;
    ctx.beginPath();
    ctx.arc(x, y - 12, 2.5, 0, Math.PI * 2);
    ctx.fill();

    if (pin.label) this._drawTag(pin.label, x + 10, y - 14, pin.colour || '#f85149');
  }

  /** Mark any visible stroke or pin within a few pixels of the cursor. */
  _eraseAt(px, py, radius = 12) {
    if (!this._erasedIds) this._erasedIds = new Set();

    for (const layer of this.annotationLayers) {
      if (!layer.visible) continue;
      for (const mark of layer.strokes) {
        if (this._erasedIds.has(mark.id)) continue;

        if (mark.type === 'pin') {
          // Hit either the point or the head of the pin.
          const { x, y } = this.lonLatToPixel(mark.lon, mark.lat);
          const nearPoint = Math.hypot(x - px, y - py) <= radius + 6;
          const nearHead = Math.hypot(x - px, (y - 12) - py) <= radius + 8;
          if (nearPoint || nearHead) this._erasedIds.add(mark.id);
          continue;
        }

        // Distance to each segment, not just its ends: a straight line has
        // only two vertices, and dragging across its middle must erase it.
        const reach = radius + (mark.width || 3);
        let prev = null;
        for (const [lon, lat] of mark.points) {
          const { x, y } = this.lonLatToPixel(lon, lat);
          let d = Math.hypot(x - px, y - py);
          if (prev) {
            const dx = x - prev.x; const dy = y - prev.y;
            const len2 = dx * dx + dy * dy;
            const t = len2 ? Math.max(0, Math.min(1, ((px - prev.x) * dx + (py - prev.y) * dy) / len2)) : 0;
            d = Math.min(d, Math.hypot(prev.x + t * dx - px, prev.y + t * dy - py));
          }
          prev = { x, y };
          if (d <= reach) {
            this._erasedIds.add(mark.id);
            break;
          }
        }
      }
    }
  }

  /**
   * Reserve screen space for a label. Returns false if something is already
   * there, in which case the caller should not draw.
   */
  _claimLabelSpace(x, y, width, height) {
    const left = x - width / 2;
    const top = y - height / 2;
    const right = left + width;
    const bottom = top + height;

    for (const box of this._labelBoxes) {
      if (left < box.right && right > box.left && top < box.bottom && bottom > box.top) {
        return false;
      }
    }
    this._labelBoxes.push({ left, top, right, bottom });
    return true;
  }

  /** Tiles tell us the zoom a feature becomes worth showing at. */
  _visibleAtZoom(feature) {
    return feature.z === undefined || this.zoom >= feature.z;
  }

  _drawEmptyState() {
    const ctx = this.ctx;
    ctx.fillStyle = '#9198a1';
    ctx.font = '15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No map packs installed yet.', this.width / 2, this.height / 2 - 10);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('See the panel below for how to get one.', this.width / 2, this.height / 2 + 14);
    ctx.textAlign = 'left';
  }

  _drawTile(data, px, py, size) {
    const ctx = this.ctx;
    const style = this.style;

    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, size, size);
    ctx.clip();

    for (const layerName of DRAW_ORDER) {
      const features = data[layerName];
      if (!features) continue;
      if (this._skipFills && layerName !== 'roads' && layerName !== 'boundaries') continue;

      for (const feature of features) {
        if (feature.t === POINT) continue; // points are drawn in the overlay pass

        if (layerName === 'roads') {
          this._drawRoad(feature, px, py, size);
          continue;
        }
        if (layerName === 'boundaries') {
          this._drawBoundary(feature, px, py, size);
          continue;
        }

        // Geometry type decides how a feature is drawn, not the layer it is
        // in. The water layer in particular holds both lakes (polygons) and
        // rivers (lines); filling a river closes it into a wedge.
        if (feature.t === LINE) {
          const spec = this._lineSpec(layerName, feature);
          if (spec) this._drawLine(feature, px, py, size, spec);
          continue;
        }

        let fill = null;
        if (layerName === 'earth') fill = style.earth;
        else if (layerName === 'water') fill = style.water;
        else if (layerName === 'natural') {
          fill = feature.k === 'water' ? style.water : style.layers.landuse[feature.k];
        } else if (layerName === 'landuse' || layerName === 'landcover') {
          fill = style.layers.landuse[feature.k];
        } else if (layerName === 'buildings') fill = style.layers.buildings;

        if (!fill) continue;
        ctx.fillStyle = fill;
        ctx.beginPath();
        for (const ring of feature.g) {
          if (ring.length < 2) continue;
          ctx.moveTo(px + ring[0][0] * size, py + ring[0][1] * size);
          for (let i = 1; i < ring.length; i++) {
            ctx.lineTo(px + ring[i][0] * size, py + ring[i][1] * size);
          }
          ctx.closePath();
        }
        ctx.fill('evenodd');
      }
    }

    ctx.restore();
  }

  /** Line widths grow with zoom, so a river looks like a river up close. */
  _lineScale() {
    return Math.max(1, Math.min(3, 1 + (this.zoom - 9) * 0.25));
  }

  /** How should a line feature in this layer be stroked? Null means skip it. */
  _lineSpec(layerName, feature) {
    if (layerName === 'contours') {
      // Every line from zoom 11; index contours (each 50 m) heavier.
      if (this.zoom < 11) return null;
      const index = feature.k === 'index';
      return { colour: this.style.layers.contour, width: index ? 1.3 : 0.6 };
    }
    if (layerName === 'landuse' && feature.k === 'national_park') {
      return { colour: '#5a9a3a', width: 2, dash: [10, 6] };
    }
    if (layerName === 'water' || layerName === 'natural') {
      const base = WATER_LINE_WIDTHS[feature.k] ?? WATER_LINE_WIDTHS.other;
      return { colour: this.style.water, width: base * this._lineScale() };
    }
    // Stray lines in the land layers are cliffs, walls, tree rows and the
    // like — drawn faintly rather than filled as if they enclosed something.
    if (layerName === 'landuse' || layerName === 'landcover') {
      return { colour: this.style.layers.boundaries, width: 0.8 };
    }
    return null;
  }

  _drawLine(feature, px, py, size, spec) {
    const ctx = this.ctx;
    ctx.strokeStyle = spec.colour;
    ctx.lineWidth = spec.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash(spec.dash || []);

    ctx.beginPath();
    for (const ring of feature.g) {
      if (ring.length < 2) continue;
      ctx.moveTo(px + ring[0][0] * size, py + ring[0][1] * size);
      for (let i = 1; i < ring.length; i++) {
        ctx.lineTo(px + ring[i][0] * size, py + ring[i][1] * size);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Roads at the zoom they deserve. Zoomed out, only the trunk network shows,
   * as hairlines; the full widths arrive around zoom 12 where a street is a
   * street. Without this a continent is a plate of orange spaghetti.
   */
  _roadVisibility(feature) {
    const z = this.zoom;
    const cls = feature.d || feature.k || 'other';
    const rank = ROAD_RANK[cls] ?? 6;
    // Each rank has a zoom it appears at; below that it is not drawn at all.
    const appearsAt = [0, 4, 7, 9, 11, 12, 13][rank];
    if (z < appearsAt) return null;
    // Width fades in from a hairline over the six zoom levels after it appears.
    const scale = Math.min(1, 0.18 + 0.82 * Math.max(0, (z - appearsAt) / 6));
    const alpha = z < 6 ? 0.55 : z < 9 ? 0.75 : 1;
    return { scale, alpha };
  }

  _drawRoad(feature, px, py, size) {
    const ctx = this.ctx;
    const roads = this.style.layers.roads;
    // kind_detail is the useful one ("motorway", "residential"); kind only
    // distinguishes major from minor.
    const spec = roads[feature.d] || roads[feature.k] || roads.other;
    const vis = this._roadVisibility(feature);
    if (!vis) return;

    ctx.strokeStyle = spec.colour;
    ctx.lineWidth = Math.max(0.5, spec.width * vis.scale);
    ctx.globalAlpha = vis.alpha;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash(spec.dash ? spec.dash.map((d) => d * Math.max(0.6, vis.scale)) : []);

    ctx.beginPath();
    for (const ring of feature.g) {
      if (ring.length < 2) continue;
      ctx.moveTo(px + ring[0][0] * size, py + ring[0][1] * size);
      for (let i = 1; i < ring.length; i++) {
        ctx.lineTo(px + ring[i][0] * size, py + ring[i][1] * size);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  _drawBoundary(feature, px, py, size) {
    const ctx = this.ctx;
    ctx.strokeStyle = this.style.layers.boundaries;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (const ring of feature.g) {
      if (ring.length < 2) continue;
      ctx.moveTo(px + ring[0][0] * size, py + ring[0][1] * size);
      for (let i = 1; i < ring.length; i++) {
        ctx.lineTo(px + ring[i][0] * size, py + ring[i][1] * size);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawOverlayFeatures(data, px, py, size) {
    const ctx = this.ctx;
    const style = this.style;

    // Place names take priority over everything else for label space.
    if (this.showLabels && data.places) {
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const feature of data.places) {
        if (!feature.n || feature.t !== POINT) continue;
        if (!this._visibleAtZoom(feature)) continue;
        const point = feature.g[0]?.[0];
        if (!point) continue;
        const x = px + point[0] * size;
        const y = py + point[1] * size;
        if (x < 0 || x > this.width || y < 0 || y > this.height) continue;

        const width = ctx.measureText(feature.n).width;
        if (!this._claimLabelSpace(x, y, width + 8, 15)) continue;

        ctx.lineWidth = 3;
        ctx.strokeStyle = style.layers.labelHalo;
        ctx.strokeText(feature.n, x, y);
        ctx.fillStyle = style.layers.label;
        ctx.fillText(feature.n, x, y);
      }
    }

    // Heights on the index contours, close in, where a walker wants them.
    if (this.showLabels && data.contours && this.zoom >= 13.5) {
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const feature of data.contours) {
        if (feature.k !== 'index' || feature.h === undefined) continue;
        const ring = feature.g[0];
        if (!ring || ring.length < 6) continue;
        const mid = ring[Math.floor(ring.length / 2)];
        const x = px + mid[0] * size;
        const y = py + mid[1] * size;
        if (x < 0 || x > this.width || y < 0 || y > this.height) continue;
        const label = String(feature.h);
        const width = ctx.measureText(label).width;
        if (!this._claimLabelSpace(x, y, width + 6, 12)) continue;
        ctx.lineWidth = 3;
        ctx.strokeStyle = style.layers.labelHalo;
        ctx.strokeText(label, x, y);
        ctx.fillStyle = style.layers.contour;
        ctx.fillText(label, x, y);
      }
    }

    // Points of interest
    if (!this.showPoi) return;
    const poiLayers = ['pois', 'poi', 'landmarks'];
    for (const layerName of poiLayers) {
      const features = data[layerName];
      if (!features) continue;

      for (const feature of features) {
        if (feature.t !== POINT || !feature.c) continue;
        if (!this.enabledCategories.has(feature.c)) continue;
        if (!this._visibleAtZoom(feature)) continue;

        const point = feature.g[0]?.[0];
        if (!point) continue;
        const x = px + point[0] * size;
        const y = py + point[1] * size;
        if (x < 0 || x > this.width || y < 0 || y > this.height) continue;

        // Reserve the pin's own footprint, so pins do not stack on top of
        // one another in a dense high street.
        if (!this._claimLabelSpace(x, y - 4, 14, 16)) continue;

        const colour = this.categoryColours[feature.c] || '#e3b341';

        // A pin, so it reads as a location rather than a dot on a line.
        ctx.fillStyle = colour;
        ctx.strokeStyle = style.layers.labelHalo;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y - 6, 5, Math.PI, 0);
        ctx.lineTo(x, y + 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (this.showLabels && feature.n && this.zoom >= 15) {
          ctx.font = '11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const width = ctx.measureText(feature.n).width;
          if (!this._claimLabelSpace(x, y + 14, width + 6, 13)) continue;

          ctx.lineWidth = 3;
          ctx.strokeStyle = style.layers.labelHalo;
          ctx.strokeText(feature.n, x, y + 14);
          ctx.fillStyle = style.layers.label;
          ctx.fillText(feature.n, x, y + 14);
        }
      }
    }
  }

  _drawMarker() {
    if (!this._marker) return;
    const ctx = this.ctx;
    const { x, y } = this.lonLatToPixel(this._marker.lon, this._marker.lat);

    ctx.strokeStyle = '#f85149';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.moveTo(x - 14, y);
    ctx.lineTo(x - 4, y);
    ctx.moveTo(x + 4, y);
    ctx.lineTo(x + 14, y);
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x, y - 4);
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x, y + 14);
    ctx.stroke();
  }

  /** A scale bar, because a map for navigation without one is half a map. */
  _drawScaleBar() {
    const ctx = this.ctx;
    const left = this.pixelToLonLat(20, this.height - 30);
    const right = this.pixelToLonLat(this.width / 4 + 20, this.height - 30);
    const metres = haversine(left.lat, left.lon, right.lat, right.lon);

    // Round to a friendly number: 1, 2 or 5 times a power of ten.
    const magnitude = Math.pow(10, Math.floor(Math.log10(metres)));
    const normalised = metres / magnitude;
    const nice = (normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1) * magnitude;
    const pixels = (nice / metres) * (this.width / 4);

    const y = this.height - 24;
    ctx.strokeStyle = this.style.layers.label;
    ctx.fillStyle = this.style.layers.labelHalo;
    ctx.lineWidth = 2;

    ctx.fillRect(16, y - 16, pixels + 60, 24);
    ctx.beginPath();
    ctx.moveTo(20, y - 4);
    ctx.lineTo(20, y);
    ctx.lineTo(20 + pixels, y);
    ctx.lineTo(20 + pixels, y - 4);
    ctx.stroke();

    ctx.fillStyle = this.style.layers.label;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, 24 + pixels, y);
  }
}

window.VaultMap = VaultMap;
window.vaultGeo = { haversine, bearing, pathLength, polygonArea, routeLegs, formatDistance, formatArea };
window.ArkMap = VaultMap; // old name, kept so nothing breaks mid-session
window.vaultMapHelpers = { haversine };
