// Generates build/icon.png (1024x1024 RGBA) with zero dependencies:
// a rounded-square brand tile with a soft ice glow and the P/ mark.
// Usage: node scripts/make-icon.js [out.png]
//
// The mark geometry is lifted verbatim from the website's signal-mark.svg so the
// app icon, the dock, the DMG and the browser tab are all the same drawing. The
// three strokes are modelled as distance-to-centreline fields, which gives the
// round caps and joins of the SVG for free.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;
const RADIUS = 232;      // rounded-corner radius of the tile
const GLOW_R = 560;      // radial glow radius

// The mark is authored in a 48x48 viewBox. Scale it to 2/3 of the tile and centre
// it, matching the proportion used for the Apple touch icon.
const MARK_BOX = SIZE * (2 / 3);
const MARK_SCALE = MARK_BOX / 48;
const MARK_OFF = (SIZE - MARK_BOX) / 2;

const out = process.argv[2] || path.join(__dirname, '..', 'build', 'icon.png');

// ------------------------------------------------ helpers
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Background gradient stops (top -> bottom)
const BG_TOP = [5, 21, 47];       // #05152f
const BG_BOT = [2, 12, 28];       // #020c1c
const GLOW = [159, 212, 255];     // ice halo
const GLOW_MAX = 0.26;            // peak glow alpha added over bg

// Mark gradient, the same three stops as signal-mark.svg
const MARK_A = [234, 245, 255];   // #eaf5ff
const MARK_B = [169, 216, 255];   // #a9d8ff  @ .45
const MARK_C = [124, 192, 248];   // #7cc0f8

function markColor(t) {
  if (t < 0.45) {
    const k = t / 0.45;
    return [lerp(MARK_A[0], MARK_B[0], k), lerp(MARK_A[1], MARK_B[1], k), lerp(MARK_A[2], MARK_B[2], k)];
  }
  const k = (t - 0.45) / 0.55;
  return [lerp(MARK_B[0], MARK_C[0], k), lerp(MARK_B[1], MARK_C[1], k), lerp(MARK_B[2], MARK_C[2], k)];
}

// ------------------------------------------------ the P/ mark, in viewBox units
const STROKE = 3;                                  // half of the 6/48 stroke width
const STEM = [[14, 39], [14, 10]];                 // upright
const SLASH = [[27.5, 39.8], [38, 9]];             // the / through it
const BOWL_TOP = [[14, 10], [20.2, 10]];           // bowl, upper arm
const BOWL_BOT = [[14, 24.6], [20.2, 24.6]];       // bowl, lower arm
const BOWL_C = [20.2, 17.3];                       // bowl curve centre
const BOWL_R = 7.3;                                // bowl curve radius
// bounding box of the stroked mark, used for the gradient axis
const BOX_X0 = 11, BOX_W = 30, BOX_Y0 = 6, BOX_H = 36.8;

function distToSeg(px, py, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const wx = px - a[0], wy = py - a[1];
  const len2 = vx * vx + vy * vy;
  let t = len2 ? (wx * vx + wy * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = wx - t * vx, dy = wy - t * vy;
  return Math.sqrt(dx * dx + dy * dy);
}

function markDist(x, y) {
  let d = Math.min(
    distToSeg(x, y, STEM[0], STEM[1]),
    distToSeg(x, y, SLASH[0], SLASH[1]),
    distToSeg(x, y, BOWL_TOP[0], BOWL_TOP[1]),
    distToSeg(x, y, BOWL_BOT[0], BOWL_BOT[1])
  );
  // the bowl's rounded end is the right half of a circle centred on BOWL_C
  if (x >= BOWL_C[0]) {
    const dc = Math.abs(Math.sqrt((x - BOWL_C[0]) ** 2 + (y - BOWL_C[1]) ** 2) - BOWL_R);
    if (dc < d) d = dc;
  }
  return d;
}

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

  // radial ice glow behind the mark
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

  // the mark, drawn on top (hard threshold — the caller supersamples for AA)
  const vx = (px - MARK_OFF) / MARK_SCALE;
  const vy = (py - MARK_OFF) / MARK_SCALE;
  if (markDist(vx, vy) <= STROKE) {
    const gt = clamp01(((vx - BOX_X0) / BOX_W + (vy - BOX_Y0) / BOX_H) / 2);
    const mc = markColor(gt);
    return [mc[0], mc[1], mc[2], 255];
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
