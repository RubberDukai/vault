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
      label: '#3a3228',
      labelHalo: '#f4efe2',
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
const DRAW_ORDER = ['earth', 'landcover', 'landuse', 'natural', 'water', 'buildings', 'roads', 'boundaries'];

class VaultMap {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.centre = { lon: options.lon ?? -2.0, lat: options.lat ?? 54.0 };
    this.zoom = options.zoom ?? 6;
    this.styleName = options.style || 'paper';

    this.basePack = null;      // vector pack id
    this.overlayPacks = [];    // raster pack ids drawn on top
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
    this.drawMode = null;          // null | 'pen' | 'eraser'
    this.penColour = '#f85149';
    this.penWidth = 3;
    this.showAnnotations = true;

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

    const pointerDown = (e) => {
      this.canvas.setPointerCapture(e.pointerId);

      // With a tool selected, dragging draws instead of panning.
      if (this.drawMode) {
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
      this.canvas.style.cursor = 'grab';
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
      this._tiles.set(key, res.ok ? await res.json() : {});
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

    // Raster overlays, e.g. the nautical chart
    for (const packId of this.overlayPacks) {
      for (const tile of visible) {
        const image = this._rasterTile(packId, tz, tile.tx, tile.ty);
        if (image) {
          ctx.globalAlpha = 0.9;
          ctx.drawImage(image, tile.px, tile.py, tilePx, tilePx);
          ctx.globalAlpha = 1;
        }
      }
    }

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

    for (const layer of this.annotationLayers) {
      if (!layer.visible) continue;
      for (const stroke of layer.strokes) {
        if (this._erasedIds && this._erasedIds.has(stroke.id)) continue;
        ctx.strokeStyle = stroke.colour;
        ctx.lineWidth = stroke.width;
        ctx.globalAlpha = 0.92;
        this._strokePath(stroke.points);
      }
    }

    // The stroke currently under the pen, before it is saved.
    if (this._activeStroke && this._activeStroke.points.length > 1) {
      ctx.strokeStyle = this._activeStroke.colour;
      ctx.lineWidth = this._activeStroke.width;
      ctx.globalAlpha = 0.92;
      this._strokePath(this._activeStroke.points);
    }
    ctx.globalAlpha = 1;
  }

  /** Mark any visible stroke passing within a few pixels of the cursor. */
  _eraseAt(px, py, radius = 12) {
    if (!this._erasedIds) this._erasedIds = new Set();

    for (const layer of this.annotationLayers) {
      if (!layer.visible) continue;
      for (const stroke of layer.strokes) {
        if (this._erasedIds.has(stroke.id)) continue;
        for (const [lon, lat] of stroke.points) {
          const { x, y } = this.lonLatToPixel(lon, lat);
          if (Math.hypot(x - px, y - py) <= radius + stroke.width) {
            this._erasedIds.add(stroke.id);
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

  _drawRoad(feature, px, py, size) {
    const ctx = this.ctx;
    const roads = this.style.layers.roads;
    // kind_detail is the useful one ("motorway", "residential"); kind only
    // distinguishes major from minor.
    const spec = roads[feature.d] || roads[feature.k] || roads.other;

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
window.ArkMap = VaultMap; // old name, kept so nothing breaks mid-session
window.vaultMapHelpers = { haversine };
