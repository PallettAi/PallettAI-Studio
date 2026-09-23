// ============================================================
// PallettAI Studio — ColorMatrix
// APCA perceptual contrast + color-vision deficiency matrix.
//
// The WCAG 2.x ratio is a luminance quotient from 2001. It is
// colour-blind to the two things human vision is most sensitive
// to: polarity (dark-on-light reads differently than light-on-
// dark) and spatial-frequency (contrast needs vary with font
// size and weight). APCA fixes both — and this module implements
// the W3 actionable version's actual constants.
//
// calculateAPCAContrast(textOKLCH, bgOKLCH)
//   APCA Lc (lightness contrast), signed: positive for dark text
//   on a lighter background, negative for light text on a darker
//   one. Anchors: black on white ≈ +106.5, white on black ≈ −107.9.
//
// simulateColorBlindness(oklchColor, visionType)
//   Machado et al. (2009) severity-1.0 projection matrices on
//   linear sRGB for protanopia / deuteranopia / tritanopia.
//   Greys pass through untouched (rows sum to 1); blue survives
//   protan/deutan (S-cone axis) and shifts under tritan.
//
// autoTuneTokenPair(foregroundOKLCH, backgroundOKLCH, minLcScore)
//   Adjusts ONLY the OKLCH lightness — hue and chroma frozen —
//   in the direction that preserves the pair's polarity until
//   |Lc| ≥ target. Unreachable targets (a mid-grey background
//   cannot give any foreground Lc 90) are reported honestly with
//   the best score achieved, never faked.
//
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const ColorMatrix = {};

  /* ============================================================
     colour plumbing: oklch()/hex → linear sRGB → Y
     ============================================================ */

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  function srgbToLinearChan(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgbChan(c) {
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

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

  // Ottosson's public-domain OKLab matrices.
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
  function oklabToOklch(lab) {
    var C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    var H = Math.atan2(lab.b, lab.a) * 180 / Math.PI;
    if (H < 0) H += 360;
    return { L: lab.L, C: C, H: H };
  }
  function oklchToOklab(lch) {
    var rad = lch.H * Math.PI / 180;
    return { L: lch.L, a: Math.cos(rad) * lch.C, b: Math.sin(rad) * lch.C };
  }

  function inGamut(lin) {
    return lin.r >= -0.0005 && lin.r <= 1.0005 && lin.g >= -0.0005 && lin.g <= 1.0005 && lin.b >= -0.0005 && lin.b <= 1.0005;
  }

  // oklch {L,C,H} → sRGB 0..1 triple, gamut-mapped by chroma reduction.
  function oklchToRgb01(lch) {
    var c = { L: clamp01(lch.L), C: Math.max(0, lch.C), H: lch.H };
    var lin = oklabToLinear(oklchToOklab(c));
    var i = 0;
    while (!inGamut(lin) && i < 24) {
      c.C *= 0.94;
      lin = oklabToLinear(oklchToOklab(c));
      i++;
    }
    return {
      r: clamp01(linearToSrgbChan(clamp01(lin.r))),
      g: clamp01(linearToSrgbChan(clamp01(lin.g))),
      b: clamp01(linearToSrgbChan(clamp01(lin.b)))
    };
  }

  function rgb01ToHex(rgb) {
    var to = function (v) {
      var n = Math.round(clamp01(v) * 255).toString(16);
      return n.length === 1 ? '0' + n : n;
    };
    return '#' + to(rgb.r) + to(rgb.g) + to(rgb.b);
  }

  // Parse 'oklch(0.62 0.17 250)' or hex → { L, C, H }.
  function parseToOklch(str) {
    var s = String(str == null ? '' : str).trim().toLowerCase();
    var m = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(s);
    if (m) {
      var L = parseFloat(m[1]);
      if (/%$/.test(m[1]) || L > 1) L = L > 1 ? L / 100 : L;
      return { L: clamp01(L), C: Math.max(0, parseFloat(m[2])), H: ((parseFloat(m[3]) % 360) + 360) % 360 };
    }
    var rgb = hexToRgb01(s);
    if (rgb) return oklabToOklch(linearToOklab({ r: srgbToLinearChan(rgb.r), g: srgbToLinearChan(rgb.g), b: srgbToLinearChan(rgb.b) }));
    return null;
  }

  // OKLCH object → linear sRGB triple (pre-transfer), for the
  // colour-vision matrices which operate in linear light.
  function oklchToLinearRgb(lch) {
    var c = { L: clamp01(lch.L), C: Math.max(0, lch.C), H: lch.H };
    var lin = oklabToLinear(oklchToOklab(c));
    var i = 0;
    while (!inGamut(lin) && i < 24) {
      c.C *= 0.94;
      lin = oklabToLinear(oklchToOklab(c));
      i++;
    }
    return { r: clamp01(lin.r), g: clamp01(lin.g), b: clamp01(lin.b) };
  }

  /* ============================================================
     1 — APCA (apca-w3 0.1.9 constants)
     ============================================================ */

  // APCA "soft sRGB" Y: D65 coefficients, pure 2.4 exponent.
  function srgbToY(rgb01) {
    return 0.2126729 * Math.pow(rgb01.r, 2.4) +
      0.7151522 * Math.pow(rgb01.g, 2.4) +
      0.0721750 * Math.pow(rgb01.b, 2.4);
  }

  var APCA_CONST = {
    normBG: 0.56, normTXT: 0.57, revTXT: 0.62, revBG: 0.65,
    blkThrs: 0.022, blkClmp: 1.414,
    scaleBoW: 1.14, scaleWoB: 1.14,
    loBoWoffset: 0.027, loWoBoffset: 0.027,
    deltaYmin: 0.0005, loClip: 0.1
  };

  /**
   * Core APCA Lc from Y values (0..1). Signed output:
   * dark-on-light positive, light-on-dark negative.
   */
  function apcaFromY(txtY, bgY) {
    var C = APCA_CONST;
    // Soft clamp the black floor — near-zero Y is perceptually unstable.
    txtY = (txtY > C.blkThrs) ? txtY : (txtY + Math.pow(C.blkThrs - txtY, C.blkClmp));
    bgY = (bgY > C.blkThrs) ? bgY : (bgY + Math.pow(C.blkThrs - bgY, C.blkClmp));

    // Insufficient difference — APCA returns 0, never a small fiction.
    if (Math.abs(bgY - txtY) < C.deltaYmin) return 0;

    var SAPC, out;
    if (bgY > txtY) {
      // Normal polarity: dark text on a lighter background.
      SAPC = (Math.pow(bgY, C.normBG) - Math.pow(txtY, C.normTXT)) * C.scaleBoW;
      out = (SAPC < C.loClip) ? 0 : (SAPC - C.loBoWoffset) * 100;
    } else {
      // Reverse polarity: light text on a darker background.
      SAPC = (Math.pow(bgY, C.revBG) - Math.pow(txtY, C.revTXT)) * C.scaleWoB;
      out = (SAPC > -C.loClip) ? 0 : (SAPC + C.loWoBoffset) * 100;
    }
    return out;
  }

  /**
   * calculateAPCAContrast(textOKLCH, bgOKLCH)
   * @param {string} textOKLCH  'oklch(L C H)' or hex
   * @param {string} bgOKLCH    'oklch(L C H)' or hex
   * @returns {{ ok, Lc, polarity, guidance, textY, bgY } |
   *           { ok: false, error }}
   *
   * Guidance follows the APCA readability criterion:
   *   |Lc| ≥ 90 fluid body text · 75 body minimum · 60 fluent large ·
   *   45 headlines · 30 placeholder/disabled · 15 non-text UI
   */
  ColorMatrix.calculateAPCAContrast = function (textOKLCH, bgOKLCH) {
    var txt = parseToOklch(textOKLCH);
    var bg = parseToOklch(bgOKLCH);
    if (!txt || !bg) return { ok: false, error: 'Colours must be oklch() strings or hex.' };

    var txtY = srgbToY(oklchToRgb01(txt));
    var bgY = srgbToY(oklchToRgb01(bg));
    var Lc = Math.round(apcaFromY(txtY, bgY) * 100) / 100;

    var abs = Math.abs(Lc);
    var guidance = abs >= 90 ? 'fluid-text'
      : abs >= 75 ? 'body-text'
      : abs >= 60 ? 'fluent-large'
      : abs >= 45 ? 'headlines'
      : abs >= 30 ? 'placeholder'
      : abs >= 15 ? 'non-text'
      : 'invisible';

    return {
      ok: true,
      Lc: Lc,
      absLc: abs,
      polarity: Lc > 0 ? 'dark-on-light' : Lc < 0 ? 'light-on-dark' : 'none',
      guidance: guidance,
      textY: txtY,
      bgY: bgY
    };
  };

  // APCA developer guideline levels, for callers choosing targets.
  var LEVELS = {
    fluidText: 90,
    bodyText: 75,
    fluentLarge: 60,
    headlines: 45,
    placeholder: 30,
    nonText: 15
  };
  ColorMatrix.LEVELS = LEVELS;
  ColorMatrix.apcaFromY = apcaFromY;
  ColorMatrix.srgbToY = srgbToY;

  /* ============================================================
     2 — colour-vision simulation
     ============================================================ */

  // Machado, Oliveira & Fernandes (2009), severity 1.0, on LINEAR sRGB.
  var VISION_MATRICES = {
    protanopia: [
      [0.152286, 1.052583, -0.204868],
      [0.114503, 0.786281, 0.099216],
      [-0.003882, -0.048116, 1.051998]
    ],
    deuteranopia: [
      [0.367322, 0.860646, -0.227968],
      [0.280085, 0.672501, 0.047413],
      [-0.011820, 0.042940, 0.968881]
    ],
    tritanopia: [
      [1.255528, -0.076749, -0.178779],
      [-0.078411, 0.930809, 0.147602],
      [0.004733, 0.691367, 0.303900]
    ]
  };

  var VISION_TYPES = Object.keys(VISION_MATRICES);
  ColorMatrix.VISION_TYPES = VISION_TYPES;
  ColorMatrix.VISION_MATRICES = VISION_MATRICES;

  /**
   * simulateColorBlindness(oklchColor, visionType)
   * @param {string} oklchColor  'oklch(L C H)' or hex
   * @param {string} visionType  'protanopia' | 'deuteranopia' | 'tritanopia'
   * @returns {{ ok, visionType, input: {hex, oklch}, output: {hex, oklch, L, C, H}, gamutReduced } |
   *           { ok: false, error }}
   */
  ColorMatrix.simulateColorBlindness = function (oklchColor, visionType) {
    var src = parseToOklch(oklchColor);
    if (!src) return { ok: false, error: 'Colour must be an oklch() string or hex.' };
    var M = VISION_MATRICES[visionType];
    if (!M) return { ok: false, error: 'Unknown vision type: ' + visionType + ' — expected one of: ' + VISION_TYPES.join(', ') };

    var lin = oklchToLinearRgb(src);
    var out = {
      r: M[0][0] * lin.r + M[0][1] * lin.g + M[0][2] * lin.b,
      g: M[1][0] * lin.r + M[1][1] * lin.g + M[1][2] * lin.b,
      b: M[2][0] * lin.r + M[2][1] * lin.g + M[2][2] * lin.b
    };
    var clipped = out.r < 0 || out.r > 1 || out.g < 0 || out.g > 1 || out.b < 0 || out.b > 1;
    out.r = clamp01(out.r);
    out.g = clamp01(out.g);
    out.b = clamp01(out.b);

    var lab = linearToOklab(out);
    var lch = oklabToOklch(lab);
    var hex = rgb01ToHex({
      r: linearToSrgbChan(out.r),
      g: linearToSrgbChan(out.g),
      b: linearToSrgbChan(out.b)
    });

    return {
      ok: true,
      visionType: visionType,
      input: {
        hex: rgb01ToHex({ r: linearToSrgbChan(lin.r), g: linearToSrgbChan(lin.g), b: linearToSrgbChan(lin.b) }),
        oklch: 'oklch(' + (Math.round(src.L * 1000) / 1000) + ' ' + (Math.round(src.C * 1000) / 1000) + ' ' + (Math.round(src.H * 10) / 10) + ')'
      },
      output: {
        hex: hex,
        oklch: 'oklch(' + (Math.round(lch.L * 1000) / 1000) + ' ' + (Math.round(lch.C * 1000) / 1000) + ' ' + (Math.round(lch.H * 10) / 10) + ')',
        L: lch.L, C: lch.C, H: lch.H
      },
      gamutReduced: clipped
    };
  };

  /* ============================================================
     3 — auto-tune (lightness-only, polarity-preserving)
     ============================================================ */

  function oklchToCss(lch) {
    return 'oklch(' + (Math.round(clamp01(lch.L) * 1000) / 1000) + ' ' +
      (Math.round(lch.C * 1000) / 1000) + ' ' + (Math.round(lch.H * 10) / 10) + ')';
  }

  /**
   * autoTuneTokenPair(foregroundOKLCH, backgroundOKLCH, minLcScore)
   * @param {string} foregroundOKLCH  'oklch(L C H)' or hex
   * @param {string} backgroundOKLCH  'oklch(L C H)' or hex
   * @param {number} [minLcScore]  target |Lc| (default 75 — body text)
   * @returns {{ ok, reached, Lc, LcInitial, polarity, from, to, steps,
   *           foreground, background } |
   *           { ok: false, error }}
   *
   * Only L moves. H never changes; C never changes. Polarity is
   * decided once, from the pair as given, and locked — a dark
   * foreground on a light surface stays dark while it lightens
   * toward the target, never across.
   */
  ColorMatrix.autoTuneTokenPair = function (foregroundOKLCH, backgroundOKLCH, minLcScore) {
    var fg = parseToOklch(foregroundOKLCH);
    var bg = parseToOklch(backgroundOKLCH);
    if (!fg || !bg) return { ok: false, error: 'Colours must be oklch() strings or hex.' };

    var target = Math.max(7, Math.min(107, Number(minLcScore) || LEVELS.bodyText));
    var fgY = srgbToY(oklchToRgb01(fg));
    var bgY = srgbToY(oklchToRgb01(bg));
    var initial = apcaFromY(fgY, bgY);

    // Lock polarity from the pair as given. Equal-Y pairs decide by
    // OKLCH lightness; still tied → light-on-dark (the common CTA).
    var polarity = initial > 0 ? 'dark-on-light'
      : initial < 0 ? 'light-on-dark'
      : (fg.L < bg.L ? 'dark-on-light' : 'light-on-dark');
    var dir = polarity === 'dark-on-light' ? -1 : 1;

    var cur = { L: fg.L, C: fg.C, H: fg.H };
    var initialL = fg.L;
    var best = { lc: initial, L: fg.L };
    var steps = 0;
    var MAX_STEPS = 60;

    var score = function () {
      return apcaFromY(srgbToY(oklchToRgb01(cur)), bgY);
    };

    var lc = initial;
    var step = 0.04;
    while (Math.abs(lc) < target && steps < MAX_STEPS) {
      var nextL = clamp01(cur.L + dir * step);
      if (nextL === cur.L) break; // saturated against the rail
      cur.L = nextL;
      steps++;
      lc = score();
      if (Math.abs(lc) > Math.abs(best.lc)) best = { lc: lc, L: cur.L };
      // Shrink the step as we approach the rail or overshoot.
      if (cur.L <= 0.001 || cur.L >= 0.999 || (steps % 10 === 0)) step = Math.max(0.002, step * 0.85);
    }

    var reached = Math.abs(lc) >= target;
    var result = {
      ok: true,
      reached: reached,
      Lc: Math.round(lc * 100) / 100,
      LcInitial: Math.round(initial * 100) / 100,
      bestLc: Math.round(best.lc * 100) / 100,
      polarity: polarity,
      from: Math.round(initialL * 1000) / 1000,
      to: Math.round(cur.L * 1000) / 1000,
      steps: steps,
      foreground: oklchToCss(cur),
      background: oklchToCss(bg)
    };
    if (!reached) {
      // Honest failure: restore the best-scoring lightness reached.
      cur.L = best.L;
      result.Lc = Math.round(best.lc * 100) / 100;
      result.to = Math.round(best.L * 1000) / 1000;
      result.reason = 'unreachable-on-this-background — best |Lc| ' + (Math.round(Math.abs(best.lc) * 100) / 100) + ' at L ' + result.to;
    }
    return result;
  };

  /* ---------------- exports ---------------- */

  ColorMatrix.parseColorToOklch = parseToOklch;
  ColorMatrix.oklchToRgb01 = oklchToRgb01;
  ColorMatrix.oklchToLinearRgb = oklchToLinearRgb;
  ColorMatrix.APCA_CONST = APCA_CONST;

  if (typeof module !== 'undefined' && module.exports) module.exports = ColorMatrix;
})();
