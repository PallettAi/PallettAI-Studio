// ============================================================
// PallettAI Studio — ColorExtractor
// Brand-palette extraction from uploaded logos & hero media.
//
// extractImagePalette(imageBufferOrPath, maxColors)
//   Zero-dependency pixel decode for the formats the Studio
//   actually meets in the wild:
//     · PNG (colour types 0/2/3/4/6, bit depths 1/2/4/8/16,
//       non-interlaced) — real zlib inflate + unfilter pass
//     · BMP (1/4/8-bit palette, 24/32-bit true colour)
//     · raw RGBA buffers (width×height×4) via detectRawRGBA
//   Unknown encodings (e.g. real JPEG) fail with a precise
//   error — never a silent wrong palette.
//   Sampling caps at ~24k pixels for speed, then a
//   seeded histogram-init k-means (deterministic — the same
//   logo always yields the same palette) clusters to maxColors.
//
// mapPaletteToOKLCH(hexArray)
//   Ottosson OKLab → OKLCH with sRGB gamut mapping, then
//   semantic role assignment:
//     · primary    most "brand-like" (chromatic, mid lightness)
//     · secondary  next chromatic hue ≥30° away
//     · accent     highest chroma remaining
//     · background lightest / darkest (theme polarity)
//     · surface    between background and mid
//     · text       opposite pole from background
//
// enforceArchetypeContrast(oklchPalette, archetypeKey)
//   Adjusts accent (and text) lightness ONLY until the pair
//   clears its contrast bar — WCAG 2.x AA 4.5:1 hard gate plus
//   APCA Lc reporting (soft-require of color-matrix when Node-
//   loaded). Hue is never touched. Unreachable targets are
//   reported honestly with the best lightness found.
//
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const ColorExtractor = {};

  /* ---------------- small colour utils ---------------- */

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function srgbToLinearChan(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function linearToSrgbChan(c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

  function hexToRgb01(hex) {
    var h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255
    };
  }
  function rgb01ToHex(rgb) {
    var to = function (v) { var n = Math.round(clamp01(v) * 255).toString(16); return n.length === 1 ? '0' + n : n; };
    return '#' + to(rgb.r) + to(rgb.g) + to(rgb.b);
  }

  // Ottosson OKLab (public domain matrices).
  function linearToOklab(c) {
    var l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
    var m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
    var s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
    var l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    return {
      L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    };
  }
  function oklabToLinear(lab) {
    var l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
    var m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
    var s_ = lab.L - 0.0894841775 * lab.a - 1.2914855480 * lab.b;
    var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return {
      r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    };
  }
  function oklchToRgb01(lch) {
    var rad = lch.H * Math.PI / 180;
    var c = { L: clamp01(lch.L), a: Math.cos(rad) * lch.C, b: Math.sin(rad) * lch.C };
    var lin = oklabToLinear(c);
    var i = 0;
    var inG = function () {
      return lin.r >= -0.0005 && lin.r <= 1.0005 && lin.g >= -0.0005 && lin.g <= 1.0005 && lin.b >= -0.0005 && lin.b <= 1.0005;
    };
    while (!inG() && i < 24) {
      c.a *= 0.94; c.b *= 0.94;
      lin = oklabToLinear(c);
      i++;
    }
    return {
      r: clamp01(linearToSrgbChan(clamp01(lin.r))),
      g: clamp01(linearToSrgbChan(clamp01(lin.g))),
      b: clamp01(linearToSrgbChan(clamp01(lin.b)))
    };
  }
  function rgb01ToOklch(rgb) {
    var lab = linearToOklab({ r: srgbToLinearChan(rgb.r), g: srgbToLinearChan(rgb.g), b: srgbToLinearChan(rgb.b) });
    var C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    var H = Math.atan2(lab.b, lab.a) * 180 / Math.PI;
    if (H < 0) H += 360;
    return { L: lab.L, C: C, H: H };
  }
  function oklchToHex(lch) { return rgb01ToHex(oklchToRgb01(lch)); }
  function hexToOklch(hex) { return rgb01ToOklch(hexToRgb01(hex)); }

  // WCAG 2.x relative luminance + ratio (the hard AA gate).
  function relLuminance(rgb01) {
    return 0.2126 * srgbToLinearChan(rgb01.r) + 0.7152 * srgbToLinearChan(rgb01.g) + 0.0722 * srgbToLinearChan(rgb01.b);
  }
  function wcagRatio(hexA, hexB) {
    var a = relLuminance(hexToRgb01(hexA)), b = relLuminance(hexToRgb01(hexB));
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }
  function oklchHex(lch) { return oklchToHex(lch); }

  ColorExtractor.wcagRatio = wcagRatio;
  ColorExtractor.hexToOklch = hexToOklch;
  ColorExtractor.oklchToHex = oklchToHex;

  /* ============================================================
     1a — decoders
     ============================================================ */

  // --- PNG ---
  var PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

  function pngInflate(data) {
    // Node: real zlib. Browser/classic-script: store-only fallback
    // (deflate with BTYPE=00 blocks — what synthetic fixtures and
    // many optimised PNG writers emit).
    if (typeof require === 'function') {
      try {
        var zlib = require('zlib');
        if (zlib && zlib.inflateSync) return zlib.inflateSync(data);
      } catch (e) { /* fall through to raw */ }
    }
    // Minimal stored-block inflater.
    var out = [];
    var p = 0;
    while (p < data.length) {
      var bfinal = data[p] & 1;
      var btype = (data[p] >> 1) & 3;
      if (btype !== 0) throw new Error('color-extractor: PNG uses compressed deflate without zlib (Node required).');
      var len = data[p + 1] | (data[p + 2] << 8);
      p += 5;
      for (var i = 0; i < len && p < data.length; i++) out.push(data[p++]);
      if (bfinal) break;
    }
    return Buffer.isBuffer(out[0]) ? out[0] : Uint8Array.from(out);
  }

  function paeth(a, b, c) {
    var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
  }

  // Returns Uint8Array RGBA, or null if not a supported PNG.
  function decodePNG(buf) {
    for (var i = 0; i < 8; i++) if (buf[i] !== PNG_SIG[i]) return null;
    var p = 8, w = 0, h = 0, depth = 0, colorType = 0, interlace = 0;
    var idat = [];
    var palette = null; // [[r,g,b], ...]
    var trns = null;
    while (p + 8 <= buf.length) {
      var len = (buf[p] << 24 | buf[p + 1] << 16 | buf[p + 2] << 8 | buf[p + 3]) >>> 0;
      var type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
      var dataStart = p + 8;
      if (type === 'IHDR') {
        w = (buf[dataStart] << 24 | buf[dataStart + 1] << 16 | buf[dataStart + 2] << 8 | buf[dataStart + 3]) >>> 0;
        h = (buf[dataStart + 4] << 24 | buf[dataStart + 5] << 16 | buf[dataStart + 6] << 8 | buf[dataStart + 7]) >>> 0;
        depth = buf[dataStart + 8];
        colorType = buf[dataStart + 9];
        interlace = buf[dataStart + 12];
        if (interlace !== 0) throw new Error('color-extractor: interlaced PNG unsupported — re-export non-interlaced.');
        if ([0, 2, 3, 4, 6].indexOf(colorType) === -1) throw new Error('color-extractor: PNG colour type ' + colorType + ' unsupported.');
      } else if (type === 'PLTE') {
        palette = [];
        for (var pi = 0; pi < len; pi += 3) {
          palette.push([buf[dataStart + pi], buf[dataStart + pi + 1], buf[dataStart + pi + 2]]);
        }
      } else if (type === 'tRNS') {
        trns = buf.slice(dataStart, dataStart + len);
      } else if (type === 'IDAT') {
        idat.push(buf.slice(dataStart, dataStart + len));
      } else if (type === 'IEND') {
        break;
      }
      p = dataStart + len + 4; // skip CRC
    }
    if (!w || !h) throw new Error('color-extractor: PNG missing IHDR.');
    var channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    var raw = pngInflate(Buffer.concat(idat));
    var bpp = Math.max(1, Math.ceil(channels * depth / 8));
    var stride = Math.ceil(w * channels * depth / 8);
    var out = new Uint8Array(w * h * 4);

    // Unfilter (non-interlaced: one pass).
    var prev = new Uint8Array(stride);
    var cur = new Uint8Array(stride);
    var rp = 0;
    for (var y = 0; y < h; y++) {
      var ft = raw[rp++];
      for (var x = 0; x < stride; x++) {
        var rawb = raw[rp + x] || 0;
        var left = x >= bpp ? cur[x - bpp] : 0;
        var up = prev[x] || 0;
        var ul = x >= bpp ? (prev[x - bpp] || 0) : 0;
        var v;
        switch (ft) {
          case 0: v = rawb; break;
          case 1: v = rawb + left; break;
          case 2: v = rawb + up; break;
          case 3: v = rawb + ((left + up) >> 1); break;
          case 4: v = rawb + paeth(left, up, ul); break;
          default: throw new Error('color-extractor: bad PNG filter type ' + ft);
        }
        cur[x] = v & 255;
      }
      rp += stride;
      // Expand row to RGBA.
      for (var px = 0; px < w; px++) {
        var r = 0, g = 0, b = 0, a = 255;
        if (colorType === 2) {
          if (depth === 8) {
            r = cur[px * 3]; g = cur[px * 3 + 1]; b = cur[px * 3 + 2];
          } else { // 16-bit — take high byte
            r = cur[px * 6]; g = cur[px * 6 + 2]; b = cur[px * 6 + 4];
          }
        } else if (colorType === 6) {
          if (depth === 8) {
            r = cur[px * 4]; g = cur[px * 4 + 1]; b = cur[px * 4 + 2]; a = cur[px * 4 + 3];
          } else {
            r = cur[px * 8]; g = cur[px * 8 + 2]; b = cur[px * 8 + 4]; a = cur[px * 8 + 6];
          }
        } else if (colorType === 0) {
          var gv = depth === 8 ? cur[px] : depth === 16 ? cur[px * 2] : (depth === 4 ? (cur[px >> 1] >> ((1 - (px & 1)) * 4)) & 15 : (depth === 2 ? (cur[px >> 2] >> ((3 - (px & 3)) * 2)) & 3 : (cur[px >> 3] >> (7 - (px & 7))) & 1));
          if (depth < 8) gv = Math.round(gv * 255 / ((1 << depth) - 1));
          r = g = b = gv;
        } else if (colorType === 4) {
          var gv2 = depth === 8 ? cur[px * 2] : cur[px * 4];
          a = depth === 8 ? cur[px * 2 + 1] : cur[px * 4 + 2];
          r = g = b = gv2;
        } else if (colorType === 3) {
          var idx = depth === 8 ? cur[px]
            : depth === 4 ? (cur[px >> 1] >> ((1 - (px & 1)) * 4)) & 15
            : depth === 2 ? (cur[px >> 2] >> ((3 - (px & 3)) * 2)) & 3
            : (cur[px >> 3] >> (7 - (px & 7))) & 1;
          var ent = palette && palette[idx];
          if (!ent) throw new Error('color-extractor: PNG palette index out of range.');
          r = ent[0]; g = ent[1]; b = ent[2];
          if (trns && idx < trns.length) a = trns[idx];
        }
        var o = (y * w + px) * 4;
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
      }
      prev.set(cur);
    }
    return { width: w, height: h, pixels: out };
  }

  // --- BMP ---
  function decodeBMP(buf) {
    if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4D) return null;
    // bfOffBits lives at file offset 10 (after 'BM', bfSize, reserved).
    var dataOffset = buf[10] | (buf[11] << 8) | (buf[12] << 16) | (buf[13] << 24);
    var dibSize = buf[14] | (buf[15] << 8) | (buf[16] << 16) | (buf[17] << 24);
    var w = buf[18] | (buf[19] << 8) | (buf[20] << 16) | (buf[21] << 24);
    var hh = buf[22] | (buf[23] << 8) | (buf[24] << 16) | (buf[25] << 24);
    var h = Math.abs(hh);
    var bpp = buf[28] | (buf[29] << 8);
    var compression = buf[30] | (buf[31] << 8);
    if (compression !== 0 && !(dibSize >= 108 && compression === 3)) {
      throw new Error('color-extractor: compressed BMP unsupported.');
    }
    var palette = [];
    if (bpp <= 8) {
      var palStart = 14 + dibSize;
      var palCount = buf[46] | (buf[47] << 8) | (buf[48] << 16) | (buf[49] << 24);
      if (!palCount) palCount = 1 << bpp;
      for (var i = 0; i < palCount; i++) {
        var o = palStart + i * 4;
        palette.push([buf[o + 2], buf[o + 1], buf[o]]); // BGR
      }
    }
    var rowBytes = Math.floor((bpp * w + 31) / 32) * 4;
    var out = new Uint8Array(w * h * 4);
    for (var y = 0; y < h; y++) {
      var srcRow = dataOffset + (h - 1 - y) * rowBytes; // bottom-up
      for (var x = 0; x < w; x++) {
        var r = 0, g = 0, b = 0, a = 255;
        if (bpp === 24 || bpp === 32) {
          var o2 = srcRow + x * (bpp / 8);
          b = buf[o2]; g = buf[o2 + 1]; r = buf[o2 + 2];
          if (bpp === 32) a = buf[o2 + 3];
        } else {
          var idx = bpp === 8 ? buf[srcRow + x]
            : bpp === 4 ? (buf[srcRow + (x >> 1)] >> ((1 - (x & 1)) * 4)) & 15
            : (buf[srcRow + (x >> 3)] >> (7 - (x & 7))) & 1;
          var ent = palette[idx];
          if (!ent) throw new Error('color-extractor: BMP palette index out of range.');
          r = ent[0]; g = ent[1]; b = ent[2];
        }
        var dst = (y * w + x) * 4;
        out[dst] = r; out[dst + 1] = g; out[dst + 2] = b; out[dst + 3] = a;
      }
    }
    return { width: w, height: h, pixels: out };
  }

  // --- raw RGBA passthrough ---
  function detectRawRGBA(buf) {
    if (buf.length < 16 || buf.length % 4 !== 0) return null;
    // Heuristic: plausible square-ish dimensions encoded in the first
    // two bytes (the Studio's canvas-dump convention: W,H little-endian
    // u16 header, then RGBA rows).
    var w = buf[0] | (buf[1] << 8);
    var h = buf[2] | (buf[3] << 8);
    if (w >= 2 && h >= 2 && buf.length === 4 + w * h * 4) {
      return { width: w, height: h, pixels: new Uint8Array(buf.buffer, buf.byteOffset + 4, w * h * 4), headerSkipped: true };
    }
    return null;
  }

  function decodeImage(buf) {
    var r = decodePNG(buf);
    if (r) return r;
    r = decodeBMP(buf);
    if (r) return r;
    r = detectRawRGBA(buf);
    if (r) return r;
    if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8) {
      throw new Error('color-extractor: JPEG decoding is not supported in this zero-dependency build — pass a PNG, BMP, raw RGBA buffer, or pre-extracted hex list (see extractFromHexList).');
    }
    throw new Error('color-extractor: unsupported image format (expected PNG, BMP, or raw RGBA).');
  }

  /* ============================================================
     1b — sampling + k-means
     ============================================================ */

  var SAMPLE_CAP = 24000;

  function samplePixels(img) {
    var w = img.width, h = img.height, px = img.pixels;
    var total = w * h;
    var step = Math.max(1, Math.ceil(Math.sqrt(total / SAMPLE_CAP)));
    var samples = [];
    for (var y = 0; y < h; y += step) {
      for (var x = 0; x < w; x += step) {
        var o = (y * w + x) * 4;
        var a = px[o + 3];
        if (a < 16) continue; // fully transparent — not a colour
        samples.push([px[o], px[o + 1], px[o + 2], a]);
      }
    }
    return samples;
  }

  function dist2(a, b) {
    var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2], da = (a[3] || 255) - (b[3] || 255);
    return dr * dr + dg * dg + db * db + 0.5 * da * da;
  }

  /**
   * Deterministic k-means over RGB(A) samples. Centroids are seeded
   * from the histogram's most frequent quantised colours — no random
   * seed, the same input always produces the same palette.
   */
  function kMeans(samples, k) {
    // Quantise to 4 bits/channel for the histogram.
    var hist = Object.create(null);
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      var key = ((s[0] >> 4) << 8) | ((s[1] >> 4) << 4) | (s[2] >> 4);
      var e = hist[key] || (hist[key] = { n: 0, r: 0, g: 0, b: 0, a: 0 });
      e.n++; e.r += s[0]; e.g += s[1]; e.b += s[2]; e.a += (s[3] || 255);
    }
    var bins = Object.keys(hist).map(function (key) {
      var e = hist[key];
      return { n: e.n, c: [e.r / e.n, e.g / e.n, e.b / e.n, e.a / e.n] };
    }).sort(function (a, b) { return b.n - a.n; });

    var centroids = [];
    for (var c = 0; c < bins.length && centroids.length < k; c++) {
      var cand = bins[c].c;
      var far = true;
      for (var j = 0; j < centroids.length; j++) {
        if (dist2(cand, centroids[j]) < 4096) { far = false; break; } // <16/channel
      }
      if (far) centroids.push(cand.slice());
    }
    while (centroids.length < k && centroids.length < bins.length) {
      centroids.push(bins[centroids.length].c.slice());
    }
    if (!centroids.length) return [];

    var assign = new Array(samples.length);
    for (var iter = 0; iter < 12; iter++) {
      var moved = false;
      for (var si = 0; si < samples.length; si++) {
        var best = 0, bd = Infinity;
        for (var ci = 0; ci < centroids.length; ci++) {
          var d = dist2(samples[si], centroids[ci]);
          if (d < bd) { bd = d; best = ci; }
        }
        if (assign[si] !== best) { assign[si] = best; moved = true; }
      }
      var sums = centroids.map(function () { return [0, 0, 0, 0, 0]; });
      for (var si2 = 0; si2 < samples.length; si2++) {
        var s2 = samples[si2], acc = sums[assign[si2]];
        acc[0] += s2[0]; acc[1] += s2[1]; acc[2] += s2[2]; acc[3] += (s2[3] || 255); acc[4]++;
      }
      for (var ci2 = 0; ci2 < centroids.length; ci2++) {
        if (sums[ci2][4] > 0) {
          centroids[ci2] = [sums[ci2][0] / sums[ci2][4], sums[ci2][1] / sums[ci2][4], sums[ci2][2] / sums[ci2][4], sums[ci2][3] / sums[ci2][4]];
        }
      }
      if (!moved && iter > 0) break;
    }

    // Weighted counts for cluster significance.
    var counts = centroids.map(function () { return 0; });
    for (var si3 = 0; si3 < samples.length; si3++) counts[assign[si3]]++;

    return centroids
      .map(function (c, i) {
        return {
          hex: rgb01ToHex({ r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 }),
          alpha: c[3],
          weight: counts[i] / samples.length
        };
      })
      .filter(function (c) { return c.weight > 0; })
      .sort(function (a, b) { return b.weight - a.weight; });
  }

  /**
   * extractImagePalette(imageBufferOrPath, maxColors)
   * @param {Buffer|Uint8Array|string} imageBufferOrPath
   * @param {number} [maxColors] 2..10, default 5
   * @returns {{ ok, source, size, sampled, colors: [{hex, weight, alpha}], backgroundHex, dominantHex } |
   *           { ok: false, error }}
   */
  ColorExtractor.extractImagePalette = function (imageBufferOrPath, maxColors) {
    var buf;
    try {
      if (typeof imageBufferOrPath === 'string') {
        if (typeof require !== 'function' || typeof process === 'undefined') {
          return { ok: false, error: 'Path input requires Node (fs).' };
        }
        var fs = require('fs');
        buf = fs.readFileSync(imageBufferOrPath);
      } else {
        buf = imageBufferOrPath;
      }
      if (!buf || !(buf.length > 24)) return { ok: false, error: 'Image buffer too small or missing.' };
      var BufferCtor = typeof Buffer !== 'undefined' ? Buffer : null;
      if (BufferCtor && !BufferCtor.isBuffer(buf) && !(buf instanceof Uint8Array)) {
        return { ok: false, error: 'Expected a Buffer/Uint8Array or file path.' };
      }
      if (buf instanceof Uint8Array && !BufferCtor.isBuffer(buf)) buf = BufferCtor.from(buf);

      // Signature-specific errors must win over the generic size guard,
      // so callers learn the actual problem with their file.
      if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8) {
        throw new Error('color-extractor: JPEG decoding is not supported in this zero-dependency build — pass a PNG, BMP, raw RGBA buffer, or pre-extracted hex list (see extractFromHexList).');
      }

      var k = Math.max(2, Math.min(10, Number(maxColors) || 5));
      var img = decodeImage(buf);
      var samples = samplePixels(img);
      if (!samples.length) return { ok: false, error: 'Image has no opaque pixels.' };

      var clustered = kMeans(samples, k + 2); // headroom for alpha/background culling
      // Transparent-dominant clusters are background, not palette.
      var opaque = clustered.filter(function (c) { return c.alpha >= 200; });
      var transparentBg = clustered.filter(function (c) { return c.alpha < 200; });
      if (!opaque.length && transparentBg.length) opaque = transparentBg; // fully ghosted image
      opaque = opaque.slice(0, k);

      // Background = lightest or darkest (whichever pole the corners support).
      var corners = [[0, 0], [img.width - 1, 0], [0, img.height - 1], [img.width - 1, img.height - 1]];
      var cornerSamples = [];
      for (var i = 0; i < corners.length; i++) {
        var o = (corners[i][1] * img.width + corners[i][0]) * 4;
        if (img.pixels[o + 3] >= 16) cornerSamples.push([img.pixels[o], img.pixels[o + 1], img.pixels[o + 2]]);
      }
      var backgroundHex = null;
      if (cornerSamples.length) {
        // Corner average is only meaningful for uniform backgrounds —
        // on two-tone logos it's a muddy in-between. Snap it to the
        // nearest extracted cluster when one is close (≤32/channel),
        // otherwise fall back to the lower-chroma extreme pole.
        var cr = 0, cg = 0, cb = 0;
        cornerSamples.forEach(function (s) { cr += s[0]; cg += s[1]; cb += s[2]; });
        var seed = [cr / cornerSamples.length, cg / cornerSamples.length, cb / cornerSamples.length, 255];
        var nearest = null, nd = Infinity;
        for (var ci = 0; ci < opaque.length; ci++) {
          var cRgb = hexToRgb01(opaque[ci].hex);
          var d = dist2([cRgb.r * 255, cRgb.g * 255, cRgb.b * 255, 255], seed);
          if (d < nd) { nd = d; nearest = opaque[ci]; }
        }
        if (nearest && nd < 3 * 32 * 32) {
          backgroundHex = nearest.hex;
        }
      }
      if (!backgroundHex && opaque.length) {
        var lightest = null, darkest = null;
        for (var li = 0; li < opaque.length; li++) {
          var L = hexToOklch(opaque[li].hex).L;
          if (!lightest || L > hexToOklch(lightest.hex).L) lightest = opaque[li];
          if (!darkest || L < hexToOklch(darkest.hex).L) darkest = opaque[li];
        }
        var lL = hexToOklch(lightest.hex), dL = hexToOklch(darkest.hex);
        backgroundHex = (lL.C <= dL.C ? lightest : darkest).hex;
      }
      if (!backgroundHex) {
        // All-transparent: lightest cluster is the background.
        backgroundHex = opaque.slice().map(function (c) { return { c: c, L: hexToOklch(c.hex).L }; })
          .sort(function (a, b) { return b.L - a.L; })[0].c.hex;
      }

      return {
        ok: true,
        source: 'buffer',
        size: { width: img.width, height: img.height },
        sampled: samples.length,
        colors: opaque,
        backgroundHex: backgroundHex,
        dominantHex: opaque[0].hex,
        transparentBackground: cornerSamples.length === 0
      };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  };

  /**
   * extractFromHexList(hexArray, maxColors)
   * Escape hatch for callers that already have pixels/colours
   * (canvas getImageData, native decoders): run the same
   * clustering over a hex list.
   */
  ColorExtractor.extractFromHexList = function (hexArray, maxColors) {
    if (!Array.isArray(hexArray) || hexArray.length === 0) {
      return { ok: false, error: 'hexArray must be a non-empty array.' };
    }
    var samples = [];
    for (var i = 0; i < hexArray.length; i++) {
      var rgb = hexToRgb01(hexArray[i]);
      if (!rgb) return { ok: false, error: 'Invalid hex colour at index ' + i + ': ' + hexArray[i] };
      samples.push([Math.round(rgb.r * 255), Math.round(rgb.g * 255), Math.round(rgb.b * 255), 255]);
    }
    var k = Math.max(2, Math.min(10, Number(maxColors) || 5));
    var clustered = kMeans(samples, k);
    return { ok: true, source: 'hex-list', colors: clustered.slice(0, k), dominantHex: clustered[0] && clustered[0].hex, sampled: samples.length };
  };

  /* ============================================================
     2 — OKLCH mapping with semantic roles
     ============================================================ */

  function hueDist(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }
  function oklchCss(lch) {
    return 'oklch(' + (Math.round(lch.L * 1000) / 1000) + ' ' + (Math.round(lch.C * 1000) / 1000) + ' ' + (Math.round(lch.H * 10) / 10) + ')';
  }
  // Fresh OKLCH colour with hex+css attached (for derived roles).
  function withHex(c) {
    c.hex = oklchToHex(c);
    c.css = oklchCss(c);
    return c;
  }

  /**
   * mapPaletteToOKLCH(hexColorArray)
   * @param {string[]} hexColorArray
   * @returns {{ ok, palette: {primary,secondary,accent,background,surface,text},
   *           oklch: {…same roles as {L,C,H,hex,css}}, rationale: {role: string} } |
   *           { ok: false, error }}
   */
  ColorExtractor.mapPaletteToOKLCH = function (hexColorArray) {
    if (!Array.isArray(hexColorArray) || hexColorArray.length < 2) {
      return { ok: false, error: 'Need at least 2 colours to assign roles.' };
    }
    var colors = [];
    for (var i = 0; i < hexColorArray.length; i++) {
      var rgb = hexToRgb01(hexColorArray[i]);
      if (!rgb) return { ok: false, error: 'Invalid hex at index ' + i + ': ' + hexColorArray[i] };
      var lch = rgb01ToOklch(rgb);
      lch.hex = rgb01ToHex(rgb);
      lch.css = oklchCss(lch);
      colors.push(lch);
    }

    // ---- role assignment -------------------------------------------------
    var byL = colors.slice().sort(function (a, b) { return b.L - a.L; });
    var medianL = colors.map(function (c) { return c.L; }).sort(function (a, b) { return a - b; })[Math.floor(colors.length / 2)];
    var darkBrand = medianL < 0.35;

    // Neutral detection: a colour with C < 0.08 can carry the canvas
    // or text roles; a palette where every colour is saturated has no
    // canvas at all — the neutrals must be DERIVED from the brand hue
    // family, which is what designers actually do with a two-colour
    // logo: keep the hue, build the theme around it.
    var maxC = colors.reduce(function (m, c) { return Math.max(m, c.C); }, 0);
    var minC = colors.reduce(function (m, c) { return Math.min(m, c.C); }, 1);
    var deriveNeutrals = minC >= 0.04 && maxC >= 0.09;

    var primary, secondary, accent, background, surface, text;
    var derived = [];

    if (deriveNeutrals) {
      // (a) brand colour: most chromatic at a readable lightness.
      var brand = colors.filter(function (c) { return c.L >= 0.3 && c.L <= 0.78; })
        .sort(function (a, b) { return b.C - a.C; })[0]
        || colors.slice().sort(function (a, b) { return b.C - a.C; })[0];
      accent = colors.filter(function (c) { return c !== brand && hueDist(c.H, brand.H) >= 30; })
        .sort(function (a, b) { return b.C - a.C; })[0]
        || colors.filter(function (c) { return c !== brand; })[0] || brand;
      primary = brand;
      secondary = withHex({ L: Math.min(0.92, primary.L + 0.08), C: primary.C * 0.55, H: (primary.H + 42) % 360 });
      background = withHex({ L: darkBrand ? 0.16 : 0.97, C: 0.008, H: primary.H });
      surface = withHex({ L: background.L + ((darkBrand ? 0.95 : 0.16) - background.L) * 0.24, C: 0.012, H: primary.H });
      text = withHex({ L: darkBrand ? 0.95 : 0.16, C: 0.006, H: primary.H });
      derived = ['secondary', 'background', 'surface', 'text'];
    } else {
      // (b) in-palette: real neutrals preferred for canvas/text.
      var neutralsByL = colors.filter(function (c) { return c.C < 0.08; }).sort(function (a, b) { return b.L - a.L; });
      if (neutralsByL.length >= 2) {
        background = neutralsByL[0];
        text = neutralsByL[neutralsByL.length - 1];
      } else if (neutralsByL.length === 1) {
        background = neutralsByL[0];
        text = darkBrand ? byL[0] : byL[byL.length - 1];
        if (text === background) {
          text = withHex({ L: darkBrand ? 0.95 : 0.16, C: 0.006, H: background.H });
          derived.push('text');
        }
      } else {
        background = darkBrand ? byL[byL.length - 1] : byL[0];
        text = darkBrand ? byL[0] : byL[byL.length - 1];
      }

      // Surface: between background and the opposite pole. Neutral-
      // biased — a saturated brand colour must stay available for
      // primary/accent, never be consumed as a surface.
      var surfaceL = background.L + (text.L - background.L) * 0.24;
      var surfaceCands = colors.filter(function (c) {
        return c !== background && c !== text && c.C < 0.16;
      });
      surface = surfaceCands.reduce(function (best, c) {
        var d = Math.abs(c.L - surfaceL);
        return (!best || d < best._d) ? Object.assign(c, { _d: d }) : best;
      }, null);
      if (!surface) {
        surface = withHex({ L: surfaceL, C: Math.max(0.008, background.C), H: background.H });
        derived.push('surface');
      }

      // Chromatic candidates for the brand roles.
      var chromatic = colors.filter(function (c) { return c !== background && c !== text && c !== surface; })
        .sort(function (a, b) { return b.C - a.C; });
      if (!chromatic.length && text.C >= 0.05) chromatic = [text];
      if (!chromatic.length) chromatic = [surface]; // greyscale logo

      primary = chromatic.filter(function (c) { return c.L >= 0.3 && c.L <= 0.78; })[0] || chromatic[0];
      accent = chromatic.filter(function (c) { return c !== primary && hueDist(c.H, primary.H) >= 30; })[0]
        || chromatic.filter(function (c) { return c !== primary; })[0] || primary;
      if (accent === surface && primary.C >= 0.03) accent = primary;
      secondary = chromatic.filter(function (c) { return c !== primary && c !== accent && hueDist(c.H, primary.H) >= 30; })[0]
        || chromatic.filter(function (c) { return c !== primary && c !== accent; })[0]
        || withHex({ L: Math.min(0.92, primary.L + 0.06), C: primary.C * 0.55, H: (primary.H + 42) % 360 });
    }
    if (secondary && !secondary.hex) { secondary.hex = oklchToHex(secondary); secondary.css = oklchCss(secondary); }

    var roles = { primary: primary, secondary: secondary, accent: accent, background: background, surface: surface, text: text };
    var out = {};
    Object.keys(roles).forEach(function (role) {
      var c = roles[role];
      out[role] = { L: c.L, C: c.C, H: c.H, hex: c.hex, css: c.css || oklchCss(c) };
    });
    return {
      ok: true,
      palette: out,
      oklch: out,
      darkBrand: darkBrand,
      derivedNeutrals: derived,
      rationale: derived.length ? {
        primary: 'brand colour (highest chroma at readable lightness)',
        secondary: 'derived tint of primary, hue rotated +42°',
        accent: derived.indexOf('accent') !== -1 ? 'derived complementary' : 'second brand colour, hue-distant from primary',
        background: 'derived neutral in the primary hue family (light canvas)',
        surface: 'derived step between background and text',
        text: 'derived near-ink in the primary hue family'
      } : {
        primary: 'most brand-like chromatic colour at readable lightness',
        secondary: 'hue-distant companion to primary',
        accent: 'highest-chroma remaining colour',
        background: darkBrand ? 'darkest colour (dark-brand median L ' + medianL.toFixed(2) + ')' : 'lightest colour',
        surface: 'lightness step between background and text pole',
        text: darkBrand ? 'lightest colour' : 'darkest colour'
      }
    };
  };

  /* ============================================================
     3 — archetype contrast enforcement
     ============================================================ */

  var ARCHETYPES = ['bento-glass', 'brutalist-kinetic', 'editorial-magazine', 'retro-cyberpunk', 'organic-clay', 'neo-minimalist'];
  ColorExtractor.ARCHETYPES = ARCHETYPES;

  // Default surface (background-token) character per archetype.
  var ARCH_SURFACE = {
    'bento-glass': { L: 0.97, C: 0.005, H: 260 },
    'brutalist-kinetic': { L: 0.96, C: 0.004, H: 90 },
    'editorial-magazine': { L: 0.98, C: 0.003, H: 85 },
    'retro-cyberpunk': { L: 0.16, C: 0.015, H: 285 },
    'organic-clay': { L: 0.95, C: 0.012, H: 60 },
    'neo-minimalist': { L: 0.99, C: 0.002, H: 250 }
  };

  /**
   * enforceArchetypeContrast(oklchPalette, archetypeKey)
   * @param {object} oklchPalette  roles with {L,C,H} (mapPaletteToOKLCH output)
   * @param {string} archetypeKey  canonical archetype or custom surface override
   * @param {object} [options] { surfaceOklch, minRatio (default 4.5), apcaTarget (default 60) }
   * @returns {{ ok, archetype, adjustments: [{role, from, to, hex, reason}], palette, passes } |
   *           { ok: false, error }}
   */
  ColorExtractor.enforceArchetypeContrast = function (oklchPalette, archetypeKey, options) {
    if (!oklchPalette || !oklchPalette.background) {
      return { ok: false, error: 'palette must include at least a background role (mapPaletteToOKLCH output).' };
    }
    var key = String(archetypeKey || 'neo-minimalist').trim().toLowerCase().replace(/[\s_]+/g, '-');
    var opts = options || {};
    var surface = opts.surfaceOklch || (ARCH_SURFACE[key] ? ARCH_SURFACE[key] : null);
    if (!surface) {
      if (ARCHETYPES.indexOf(key) === -1) {
        return { ok: false, error: 'Unknown archetype: ' + archetypeKey + ' — expected one of: ' + ARCHETYPES.join(', ') + ' (or pass options.surfaceOklch).' };
      }
    }
    var minRatio = opts.minRatio || 4.5;
    var apcaTarget = opts.apcaTarget || 60;

    var APCA = null;
    try { if (typeof require === 'function') APCA = require('./color-matrix.js'); } catch (e) { /* browser: WCAG only */ }

    var out = {};
    Object.keys(oklchPalette).forEach(function (r) { out[r] = Object.assign({}, oklchPalette[r]); });

    var bgLch = out.background;
    var adjustments = [];

    function contrastOf(lch) {
      var hex = oklchToHex(lch);
      var bgHex = oklchToHex(bgLch);
      return { hex: hex, bgHex: bgHex, ratio: wcagRatio(hex, bgHex), Lc: APCA ? Math.abs(APCA.calculateAPCAContrast(hex, bgHex).Lc) : null };
    }

    // Roles painted ON the archetype surface need the gate.
    var surfaceRoles = ['accent', 'primary', 'text'];
    for (var s = 0; s < surfaceRoles.length; s++) {
      var role = surfaceRoles[s];
      if (!out[role]) continue;
      var cur = out[role];
      var c = contrastOf(cur);
      var from = { L: cur.L, C: cur.C };
      if (c.ratio >= minRatio && (!c.Lc || c.Lc >= apcaTarget * 0.8)) {
        continue; // already compliant
      }
      // Which pole is the background on? Push the role to the OPPOSITE
      // pole (light bg → darken role, dark bg → lighten role).
      var dir = bgLch.L >= 0.5 ? -1 : 1;
      var step = 0.04, best = null, guard = 0;
      var test = cur;
      while (guard++ < 40) {
        var nextL = clamp01(test.L + dir * step);
        if (nextL === test.L) break;
        test = { L: nextL, C: cur.C, H: cur.H };
        var cc = contrastOf(test);
        if (!best || cc.ratio > best.ratio) best = { L: nextL, ratio: cc.ratio, Lc: cc.Lc };
        if (cc.ratio >= minRatio && (!cc.Lc || cc.Lc >= apcaTarget * 0.8)) break;
        if (nextL <= 0.002 || nextL >= 0.998) { step = Math.max(0.002, step * 0.6); }
      }
      if (best && best.ratio >= minRatio) {
        out[role].L = best.L;
        adjustments.push({
          role: role,
          from: oklchToHex({ L: from.L, C: from.C, H: cur.H }),
          to: oklchToHex({ L: best.L, C: cur.C, H: cur.H }),
          fromL: Math.round(from.L * 1000) / 1000,
          toL: Math.round(best.L * 1000) / 1000,
          ratio: Math.round(best.ratio * 100) / 100,
          apcaLc: best.Lc ? Math.round(best.Lc) : null,
          reason: 'raised ' + role + ' against archetype surface to clear ' + minRatio + ':1'
        });
      } else {
        adjustments.push({
          role: role,
          from: oklchToHex({ L: from.L, C: from.C, H: cur.H }),
          to: oklchToHex({ L: from.L, C: from.C, H: cur.H }),
          ratio: Math.round(c.ratio * 100) / 100,
          reason: 'unreachable on this surface — best ratio ' + (best ? (Math.round(best.ratio * 100) / 100) : c.ratio) + ':1',
          unreachable: true
        });
      }
    }

    var passes = adjustments.every(function (a) { return !a.unreachable; });
    return {
      ok: true,
      archetype: key,
      adjustments: adjustments,
      palette: out,
      passes: passes,
      surface: { L: bgLch.L, C: bgLch.C, H: bgLch.H, hex: oklchToHex(bgLch) },
      gate: { wcag: minRatio, apcaTarget: apcaTarget, apcaAvailable: !!APCA }
    };
  };

  /* ---------------- exports ---------------- */

  ColorExtractor.decodeImage = decodeImage;
  ColorExtractor.rgb01ToHex = rgb01ToHex;

  if (typeof module !== 'undefined' && module.exports) module.exports = ColorExtractor;
})();
