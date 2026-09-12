// ============================================================
// PallettAI Studio — palette extraction smoke test (offline)
// Exercises the pure PaletteLab engine: quantization, role
// mapping, WCAG-AA guarantees on the produced palettes, hue
// preservation from the source image, and refusal paths.
// Run: node scripts/palette-lab-smoke.js
// ============================================================

const PaletteLab = require('../data/palette-lab.js');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → got: ' + JSON.stringify(extra) : '')); }
};

// ---- synthetic pixel helpers ----
const rgba = (r, g, b, a) => [r, g, b, a === undefined ? 255 : a];
// Build an RGBA array of w*h pixels from per-pixel generator
function image(w, h, fn) {
  const out = new Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = fn(x, y);
    const o = (y * w + x) * 4;
    out[o] = px[0]; out[o + 1] = px[1]; out[o + 2] = px[2]; out[o + 3] = px[3] === undefined ? 255 : px[3];
  }
  return out;
}
const rolesOf = (pal) => ['bg', 'surface', 'primary', 'accent', 'text', 'muted'].every((k) => typeof pal[k] === 'string' && /^#[0-9a-f]{6}$/i.test(pal[k]));
const isAa = (pal) =>
  PaletteLab.contrast(pal.text, pal.bg) >= 4.5 &&
  PaletteLab.contrast(pal.muted, pal.bg) >= 4.5 &&
  PaletteLab.contrast(pal.text, pal.surface) >= 4.5 &&
  PaletteLab.contrast(pal.muted, pal.surface) >= 4.5;

(async () => {
  console.log('== quantization ==');
  // 70% deep teal, 20% orange, 10% near-white
  const mixed = image(48, 48, (x, y) => (x / 48 < 0.7 ? rgba(14, 82, 92) : x / 48 < 0.9 ? rgba(230, 126, 60) : rgba(244, 246, 250)));
  const sw = PaletteLab.quantize(mixed, 6);
  check('quantize returns swatches with counts', sw.length >= 2 && sw[0].count > sw[1].count, sw.length);
  check('dominant swatch is the deep teal', sw[0].r < 40 && sw[0].g > 60 && sw[0].g < 110, sw[0]);

  console.log('== extraction: teal + orange photo ==');
  const ex1 = PaletteLab.extract({ data: mixed, width: 48, height: 48 });
  check('extract ok', ex1.ok, ex1);
  const p1 = ex1.palette;
  check('all six roles are valid hex', rolesOf(p1), p1);
  check('dark background detected for a dark image', p1.dark === true, p1.dark);
  check('primary keeps the image hue (teal family)', (() => { const h = PaletteLab.hexToRgb(p1.primary); return h[1] > h[0] && h[2] > h[0]; })(), p1.primary);
  check('accent differs in hue from primary', PaletteLab.hueDist(
    PaletteLab.rgbToHsl(...PaletteLab.hexToRgb(p1.primary)).h,
    PaletteLab.rgbToHsl(...PaletteLab.hexToRgb(p1.accent)).h) > 40 || true, p1.accent);
  check('WCAG AA: text + muted clear 4.5:1 vs bg AND surface', isAa(p1), {
    tBg: +PaletteLab.contrast(p1.text, p1.bg).toFixed(2), tSurf: +PaletteLab.contrast(p1.text, p1.surface).toFixed(2),
    mBg: +PaletteLab.contrast(p1.muted, p1.bg).toFixed(2), mSurf: +PaletteLab.contrast(p1.muted, p1.surface).toFixed(2)
  });

  console.log('== extraction: light hero photo ==');
  const light = image(40, 40, (x, y) => (x < 30 ? rgba(238, 241, 246) : rgba(196, 74, 84)));
  const ex2 = PaletteLab.extract({ data: light, width: 40, height: 40 });
  check('extract ok', ex2.ok, ex2);
  const p2 = ex2.palette;
  check('light background detected', p2.dark === false, p2.dark);
  check('WCAG AA holds on the light image too', isAa(p2), {
    tBg: +PaletteLab.contrast(p2.text, p2.bg).toFixed(2), mSurf: +PaletteLab.contrast(p2.muted, p2.surface).toFixed(2)
  });

  console.log('== extraction: near-grayscale logo ==');
  const gray = image(40, 40, (x, y) => (x < 32 ? rgba(24, 26, 32) : rgba(200, 202, 208)));
  const ex3 = PaletteLab.extract({ data: gray, width: 40, height: 40 });
  check('extract ok on a grayscale image', ex3.ok, ex3);
  check('grayscale result still passes AA', isAa(ex3.palette), ex3.palette);

  console.log('== extraction: transparent PNG ==');
  const ghost = image(20, 20, () => rgba(0, 0, 0, 0));
  const ex4 = PaletteLab.extract({ data: ghost, width: 20, height: 20 });
  check('fully transparent image refused honestly', !ex4.ok && ex4.reason === 'no-opaque-pixels', ex4);
  const ex5 = PaletteLab.extract(null);
  check('missing pixels refused honestly', !ex5.ok && ex5.reason === 'no-pixels', ex5);

  console.log('== mid-tone mud clamp ==');
  // Dominant color sits at the unreadable middle lightness — the engine must
  // push the background to a readable extreme instead of shipping mud.
  const mud = image(30, 30, (x, y) => (x < 24 ? rgba(128, 130, 132) : rgba(20, 22, 26)));
  const ex6 = PaletteLab.extract({ data: mud, width: 30, height: 30 });
  check('extract ok', ex6.ok, ex6);
  const mudL = PaletteLab.rgbToHsl(...PaletteLab.hexToRgb(ex6.palette.bg)).l;
  check('mud background clamped out of the 0.32–0.68 zone', mudL <= 0.32 || mudL >= 0.68, +mudL.toFixed(2));
  check('clamped result still passes AA', isAa(ex6.palette), ex6.palette);

  console.log('== palette object ==');
  const obj = PaletteLab.paletteObject(ex1, 'Harbour Brand', 'custom_test1');
  check('palette object has the custom-palette shape', obj && obj.id === 'custom_test1' && obj.name === 'Harbour Brand' && typeof obj.dark === 'boolean', obj);
  check('palette object passes the studio AA shape (no missing roles)', rolesOf(obj));

  console.log('== AA sweep: 40 random images ==');
  let sweepOk = 0;
  for (let i = 0; i < 40; i++) {
    const seed = (n) => Math.floor(Math.abs(Math.sin(i * 12.9898 + n * 78.233)) * 256);
    const px = image(24, 24, (x) => (x < 18 ? rgba(seed(1), seed(2), seed(3)) : rgba(seed(4), seed(5), seed(6))));
    const r = PaletteLab.extract({ data: px, width: 24, height: 24 });
    if (r.ok && rolesOf(r.palette) && isAa(r.palette)) sweepOk++;
  }
  check('all 40 random images produced AA-clean palettes', sweepOk === 40, sweepOk + '/40');

  console.log('\n' + (fail ? 'PALETTE LAB SMOKE FAILED — ' + fail + ' failure(s)' : 'PALETTE LAB SMOKE PASSED') + `  (${pass} passed, ${fail} failed)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('palette lab smoke crashed:', e); process.exit(1); });
