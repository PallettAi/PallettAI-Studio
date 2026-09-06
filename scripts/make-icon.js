// Generates build/icon.png (1024x1024 RGBA) with zero dependencies:
// a rounded-square brand tile with a soft violet glow and the white ◆ mark.
// Usage: node scripts/make-icon.js [out.png]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;
const RADIUS = 232;      // rounded-corner radius of the tile
const DIAMOND_R = 300;   // half-diagonal of the ◆
const GLOW_R = 560;      // radial glow radius

const out = process.argv[2] || path.join(__dirname, '..', 'build', 'icon.png');

// ------------------------------------------------ helpers
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Background gradient stops (top -> bottom)
const BG_TOP = [27, 31, 62];      // #1b1f3e
const BG_BOT = [10, 11, 24];      // #0a0b18
const GLOW = [124, 92, 255];      // soft violet
const GLOW_MAX = 0.42;            // peak glow alpha added over bg
const MARK = [255, 255, 255];     // ◆

function roundRectHit(x, y, half, rad) {
  // x,y are distances from tile centre, in [-half, half]
  const qx = Math.abs(x) - (half - rad);
  const qy = Math.abs(y) - (half - rad);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  const outside = Math.sqrt(ax * ax + ay * ay);
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - rad <= 0;
}

function sampleColor(px, py) {
  const cx = px - SIZE / 2;
  const cy = py - SIZE / 2;
  const half = SIZE / 2;
  const rad = Math.min(RADIUS, half);

  // transparent outside the rounded tile
  if (!roundRectHit(cx, cy, half - 0.5, rad)) return [0, 0, 0, 0];

  const t = py / SIZE;
  let r = lerp(BG_TOP[0], BG_BOT[0], t);
  let g = lerp(BG_TOP[1], BG_BOT[1], t);
  let b = lerp(BG_TOP[2], BG_BOT[2], t);

  // radial violet glow behind the mark
  const d = Math.sqrt(cx * cx + cy * cy);
  const glow = clamp01(1 - d / GLOW_R);
  const ga = Math.pow(glow, 2.2) * GLOW_MAX;
  r = lerp(r, GLOW[0], ga);
  g = lerp(g, GLOW[1], ga);
  b = lerp(b, GLOW[2], ga);

  // subtle top-left sheen
  const sheen = clamp01(1 - (Math.max(cx, 0) + Math.max(cy, 0)) / (SIZE * 0.9));
  const sh = sheen * sheen * 0.08;
  r += sh; g += sh; b += sh;

  // white diamond ◆ : |dx| + |dy| <= R
  if (Math.abs(cx) + Math.abs(cy) <= DIAMOND_R) {
    // soft edge via one-pixel falloff
    const edge = clamp01(DIAMOND_R - (Math.abs(cx) + Math.abs(cy)) + 1.2);
    return [MARK[0], MARK[1], MARK[2], Math.round(255 * edge)];
  }
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return [c(r), c(g), c(b), 255];
}

// ------------------------------------------------ png encoder
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // filter byte 0 per scanline
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ------------------------------------------------ render (2x2 supersampling)
console.log('Rendering 1024x1024 icon…');
const rgba = Buffer.alloc(SIZE * SIZE * 4);
const OFF = [0.25, 0.75];
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const oy of OFF) {
      for (const ox of OFF) {
        const c = sampleColor(x + ox, y + oy);
        r += c[0]; g += c[1]; b += c[2]; a += c[3];
      }
    }
    const i = (y * SIZE + x) * 4;
    rgba[i] = Math.round(r / 4);
    rgba[i + 1] = Math.round(g / 4);
    rgba[i + 2] = Math.round(b / 4);
    rgba[i + 3] = Math.round(a / 4);
  }
}
const png = encodePNG(SIZE, rgba);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('Wrote', out, png.length, 'bytes');
