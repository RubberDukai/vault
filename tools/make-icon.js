'use strict';
/**
 * Generates web/ark.ico — the taskbar and shortcut icon.
 *
 * Written by hand rather than shipping a binary blob, so the icon can be
 * regenerated or restyled with no image editor and no dependencies. PNG and
 * ICO are both simple enough to emit directly.
 *
 *   node tools/make-icon.js
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BACKGROUND = [13, 17, 23];    // #0d1117, the app's ground
const MARK = [227, 179, 65];        // #e3b341, the amber triangle
const SUPERSAMPLE = 4;              // rendered large, averaged down, for clean edges

// ------------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const forCrc = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  out.writeUInt32BE(crc32(forCrc), 8 + data.length);
  return out;
}

/** Encode RGBA pixel data as a PNG. */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);   // bit depth
  ihdr.writeUInt8(6, 9);   // colour type 6 = RGBA
  ihdr.writeUInt8(0, 10);  // deflate
  ihdr.writeUInt8(0, 11);  // adaptive filtering
  ihdr.writeUInt8(0, 12);  // no interlace

  // Each scanline is prefixed with a filter byte; 0 means "no filtering".
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ shape

/** Is this point inside the rounded square? */
function insideRounded(x, y, size, radius) {
  const min = radius;
  const max = size - radius;
  const cx = Math.min(Math.max(x, min), max);
  const cy = Math.min(Math.max(y, min), max);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** Is this point inside the upward triangle, via barycentric sign tests? */
function insideTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Render one icon size: dark rounded square with the amber Ark triangle. */
function renderIcon(size) {
  const big = size * SUPERSAMPLE;
  const radius = big * 0.18;

  // Triangle geometry, as a proportion of the canvas.
  const apexX = big / 2;
  const apexY = big * 0.24;
  const leftX = big * 0.20;
  const rightX = big * 0.80;
  const baseY = big * 0.755;

  const accumulator = new Float64Array(size * size * 4);

  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      if (insideRounded(px, py, big, radius)) {
        [r, g, b] = BACKGROUND;
        a = 255;
        if (insideTriangle(px, py, apexX, apexY, leftX, baseY, rightX, baseY)) {
          [r, g, b] = MARK;
        }
      }

      const target = (Math.floor(y / SUPERSAMPLE) * size + Math.floor(x / SUPERSAMPLE)) * 4;
      accumulator[target] += r;
      accumulator[target + 1] += g;
      accumulator[target + 2] += b;
      accumulator[target + 3] += a;
    }
  }

  const samples = SUPERSAMPLE * SUPERSAMPLE;
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size * 4; i++) rgba[i] = Math.round(accumulator[i] / samples);
  return rgba;
}

// ------------------------------------------------------------------- ICO

/** Wrap PNG images in an ICO container (PNG-in-ICO, supported since Vista). */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach((image, index) => {
    const entry = index * 16;
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, entry);      // 0 means 256
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 1);
    directory.writeUInt8(0, entry + 2);      // palette colours
    directory.writeUInt8(0, entry + 3);      // reserved
    directory.writeUInt16LE(1, entry + 4);   // colour planes
    directory.writeUInt16LE(32, entry + 6);  // bits per pixel
    directory.writeUInt32LE(image.data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, directory, ...images.map((i) => i.data)]);
}

// ------------------------------------------------------------------- main

const SIZES = [16, 24, 32, 48, 64, 128, 256];

const images = SIZES.map((size) => ({
  size,
  data: encodePng(size, size, renderIcon(size)),
}));

const outputDir = path.join(__dirname, '..', 'web');
fs.mkdirSync(outputDir, { recursive: true });

const icoPath = path.join(outputDir, 'ark.ico');
fs.writeFileSync(icoPath, buildIco(images));

// A PNG copy doubles as the browser tab icon.
const pngPath = path.join(outputDir, 'icon.png');
fs.writeFileSync(pngPath, images.find((i) => i.size === 128).data);

console.log(`Wrote ${icoPath} (${SIZES.join(', ')} px)`);
console.log(`Wrote ${pngPath}`);
