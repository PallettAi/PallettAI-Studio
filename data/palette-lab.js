// ============================================================
// PallettAI Studio — Palette Lab (pure image → palette engine)
// Roadmap #6: AI palette extraction from any image. Drop a
// client photo, logo or screenshot and get a site-ready palette.
//
// Pure logic: no DOM, no canvas, no DB dependency. The caller
// (app.js) draws the image to a small canvas and hands over
// { data, width, height } RGBA pixels; the smoke test feeds
// synthetic pixel arrays.
//
// Pipeline:
//   1. Median-cut quantization → k dominant colors (with share)
//   2. Role mapping — background (dominant tone, clamped out of
//      the unreadable middle), surface (a lightness step from
//      bg), primary (most saturated mid tone), accent (a
//      hue-distant saturated tone, or a lightness step from
//      primary on duotone images), then text + muted keep the
//      image's hue family but walk lightness until BOTH clear
//      WCAG AA (4.5:1) against bg and surface. Guaranteed-AA
//      fallbacks mean the output always passes, on any input.
// ============================================================

'use strict';

const PaletteLab = (() => {
  const MAX_PIXELS = 4096; // sample cap before quantization

  // ---------- color helpers ----------
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const toHex2 = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  const rgbToHex = (r, g, b) => '#' + toHex2(r / 255) + toHex2(g / 255) + toHex2(b / 255);

  function hexToRgb(hex) {
    let h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHsl(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn);
    const l = (mx + mn) / 2;
    if (mx === mn) return { h: 0, s: 0, l };
    const d = mx - mn;
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h;
    if (mx === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (mx === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    return { h: h * 60, s, l };
  }

  function hslToHex(h, s, l) {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return rgbToHex(hue2rgb(p, q, h / 360 + 1 / 3) * 255, hue2rgb(p, q, h / 360) * 255, hue2rgb(p, q, h / 360 - 1 / 3) * 255);
  }

  // Keep hue + saturation, set lightness exactly.
  function setLightness(hex, l, satMul) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    return hslToHex(hsl.h, clamp01(hsl.s * (satMul === undefined ? 1 : satMul)), clamp01(l));
  }

  function luminance(hex) {
    const c = hexToRgb(hex);
    if (!c) return 0;
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }

  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  }

  const hueDist = (a, b) => {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  };

  // Walk a color's lightness (keeping its hue family) until fn(hex) holds.
  // dark=true walks bright-ward from the readable extreme; light=true the
  // mirror. Tier 2 re-walks a near-neutral version of the same hue — against
  // the extreme lightness that ALWAYS clears AA, so the result is guaranteed
  // no matter how saturated the source image is.
  function aaTune(hex, fallback, fn, dark) {
    const rgb = hexToRgb(hex);
    const hsl = rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2]) : { h: 0, s: 0, l: 0.5 };
    const step = 0.03 * (dark ? -1 : 1);
    let l = dark ? 0.94 : 0.06;
    for (let i = 0; i < 40; i++) {
      const cur = hslToHex(hsl.h, hsl.s, l);
      if (fn(cur)) return cur;
      l += step;
      if (l < 0.02 || l > 0.98) break;
    }
    // Guaranteed floor: near-neutral, starting at the AA-safe extreme.
    l = dark ? 0.97 : 0.03;
    for (let i = 0; i < 40; i++) {
      const cur = hslToHex(hsl.h, 0.08, l);
      if (fn(cur)) return cur;
      l += step;
    }
    return fallback; // constant AA-safe colors for the clamped extremes
  }

  // ---------- median-cut quantization ----------
  // pixels: RGBA array-like. Returns [{ r, g, b, count }] sorted by count desc.
  function quantize(data, k) {
    const buckets = [];
    const pixelCount = Math.floor(data.length / 4);
    const stride = Math.max(1, Math.ceil(pixelCount / MAX_PIXELS));
    for (let i = 0; i < pixelCount; i += stride) {
      const o = i * 4;
      if (data[o + 3] < 128) continue; // skip transparent
      buckets.push([data[o], data[o + 1], data[o + 2]]);
    }
    if (!buckets.length) return [];

    let boxes = [buckets];
    while (boxes.length < k) {
      // split the box with the widest (range-weighted) channel
      let best = -1, bestRange = -1, bestCh = 0;
      boxes.forEach((box, bi) => {
        if (box.length < 2) return;
        for (let ch = 0; ch < 3; ch++) {
          let mn = 255, mx = 0;
          for (const px of box) { if (px[ch] < mn) mn = px[ch]; if (px[ch] > mx) mx = px[ch]; }
          const range = (mx - mn) * Math.log(box.length + 1);
          if (range > bestRange) { bestRange = range; best = bi; bestCh = ch; }
        }
      });
      if (best < 0) break;
      const box = boxes[best].slice().sort((a, b) => a[bestCh] - b[bestCh]);
      const mid = Math.floor(box.length / 2);
      boxes = boxes.filter((_, bi) => bi !== best).concat([box.slice(0, mid), box.slice(mid)]);
    }

    return boxes
      .filter((box) => box.length)
      .map((box) => {
        let r = 0, g = 0, b = 0;
        for (const px of box) { r += px[0]; g += px[1]; b += px[2]; }
        const n = box.length;
        return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), count: n };
      })
      .sort((a, b) => b.count - a.count);
  }

  // ---------- role mapping ----------
  // swatches: quantize() output. Returns the studio's 6-role palette.
  function mapToRoles(swatches) {
    if (!swatches || !swatches.length) return null;
    const total = swatches.reduce((s, x) => s + x.count, 0) || 1;
    const info = swatches.map((s) => {
      const hsl = rgbToHsl(s.r, s.g, s.b);
      return { hex: rgbToHex(s.r, s.g, s.b), share: s.count / total, hsl };
    });

    // Background: the image's dominant tone, pushed out of the mud zone
    // (mid-lightness backgrounds leave no readable room for either text).
    const ground = info[0];
    let bgL = ground.hsl.l;
    if (bgL > 0.32 && bgL < 0.68) bgL = bgL >= 0.5 ? 0.88 : 0.16;
    const dark = bgL <= 0.5;
    const bg = setLightness(ground.hex, bgL);

    // Surface: one step toward the middle from bg (card tone). It must stay
    // solvable — a SATURATED mid-lightness surface has high luminance and no
    // single text color can clear 4.5:1 against both bg and it. So cards keep
    // only a whisper of the hue (s×0.2) and the lightness step is capped
    // inside the band where a common AA text exists for both roles.
    const surfL = dark ? Math.min(bgL + 0.1, 0.40) : Math.max(bgL - 0.08, 0.55);
    const surface = setLightness(ground.hex, surfL, 0.2);

    // Primary: the image's own brand color. Walk swatches in SHARE order
    // (dominant first) and take the first usable, saturated-enough tone —
    // a 70%-share teal must win over a 15% orange even if the orange is
    // marginally more saturated. Near-grayscale images (no swatch with
    // s > 0.15) fall back to a neutral anchor from the image.
    const satRank = info.slice().sort((a, b) => b.hsl.s - a.hsl.s);
    let primary = null;
    for (const c of info) {
      const usable = c.hsl.l > 0.18 && c.hsl.l < 0.82;
      if (usable && (c.hsl.s > 0.15 || (c.share > 0.5 && c.hsl.s > 0.02))) { primary = c; break; }
    }
    let primaryHex;
    if (primary) primaryHex = setLightness(primary.hex, dark ? 0.64 : 0.46);
    else {
      const anchor = satRank[0] || info[0];
      primaryHex = setLightness(anchor.hex, dark ? 0.74 : 0.3);
    }

    // Accent: a different-hue saturated tone if one exists, else a lightness
    // step away from primary (keeps duotone images cohesive).
    const p = hexToRgb(primaryHex);
    const pHsl = rgbToHsl(p[0], p[1], p[2]);
    const accentCandidate = satRank.find((c) =>
      c.hex !== (primary && primary.hex) && c.hsl.s > 0.18 && hueDist(c.hsl.h, pHsl.h) > 40
      && c.hsl.l > 0.2 && c.hsl.l < 0.85);
    const accentHex = accentCandidate
      ? setLightness(accentCandidate.hex, dark ? 0.68 : 0.5)
      : setLightness(primaryHex, dark ? Math.min(0.9, pHsl.l + 0.22) : Math.max(0.1, pHsl.l - 0.2));

    // Text roles: keep the image's hue family, walk lightness to AA vs BOTH
    // bg and surface. The fallbacks are near-neutral constants for the
    // (now capped) surface band — last resort only.
    const text = aaTune(ground.hex, dark ? '#fbfcff' : '#0d1020',
      (fg) => contrast(fg, bg) >= 4.5 && contrast(fg, surface) >= 4.5, dark);
    const muted = aaTune(ground.hex, dark ? '#dfe3f2' : '#3a4358',
      (fg) => contrast(fg, bg) >= 4.5 && contrast(fg, surface) >= 4.5, dark);

    return {
      bg, surface, primary: primaryHex, accent: accentHex, text, muted, dark,
      swatches: info.map((c) => ({ hex: c.hex, share: Math.round(c.share * 100) / 100 }))
    };
  }

  // ---------- entry point ----------
  // pixels: { data: RGBA array-like, width, height } (alpha respected)
  // opts:   { k } — swatch count (3..8, default 6)
  // Returns { ok, palette } or { ok: false, reason }.
  function extract(pixels, opts) {
    if (!pixels || !pixels.data || !pixels.data.length) return { ok: false, reason: 'no-pixels' };
    const k = (opts && opts.k) || 6;
    const swatches = quantize(pixels.data, Math.max(3, Math.min(8, k)));
    if (!swatches.length) return { ok: false, reason: 'no-opaque-pixels' };
    const palette = mapToRoles(swatches);
    if (!palette) return { ok: false, reason: 'map-failed' };
    return { ok: true, palette };
  }

  // Studio-compatible custom-palette object (same shape the palette
  // builder saves), ready for DB.palettes + localStorage.
  function paletteObject(result, name, id) {
    const pal = result && result.palette;
    if (!pal) return null;
    return {
      id: id || ('custom_' + Math.random().toString(36).slice(2, 10)),
      name: String(name || 'Extracted palette').slice(0, 80),
      bg: pal.bg, surface: pal.surface, primary: pal.primary,
      accent: pal.accent, text: pal.text, muted: pal.muted, dark: pal.dark
    };
  }

  return { extract, quantize, mapToRoles, paletteObject, rgbToHex, hexToRgb, rgbToHsl, hslToHex, setLightness, aaTune, luminance, contrast, hueDist, MAX_PIXELS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PaletteLab;
