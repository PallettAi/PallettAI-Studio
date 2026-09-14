// ============================================================
// PallettAI Studio — Signature artwork
//
// Deterministic, palette-seeded SVG artwork for exported sites. Replaces the
// old decorative blobs (`.orb-*`, `.aurora-blob`), which were the same three
// circles on every site and carried a hardcoded pink no palette could reach.
//
// Design rules, in priority order:
//
//   1. DETERMINISTIC. The seed is a hash of the brand name + palette + variation,
//      so the same project always produces byte-identical artwork. Artwork that
//      reshuffled on every export, reopen or cloud-vault restore would be unusable.
//   2. PALETTE-BOUND. Colours come only from the resolved palette, so a client's
//      brand flows through and light palettes stay light.
//   3. DEPENDENCY-FREE. Plain SVG string, no canvas, no WebGL, no filters, no
//      runtime JS. It is inlined into the export and costs no requests.
//   4. CHEAP. A few KB of markup, drawn once. The old blobs used filter:blur(110px)
//      on 540px elements with infinite animations, which rasterises a large
//      offscreen buffer every frame.
//   5. STATIC BY DEFAULT. Nothing animates, so `prefers-reduced-motion` needs no
//      special case here. Any optional drift added later must respect it.
//
// Legibility is deliberately NOT part of the artwork: baking a scrim into every
// piece washes it out in the places no text touches. `scrim()` is a separate
// layer the builder applies only where copy actually sits.
// ============================================================

const Signature = (() => {
  'use strict';

  const W = 1600, H = 900;

  // Which engine a project uses when it has not chosen one. Change this single
  // line to change the default look for every new and existing project.
  const DEFAULT_ENGINE = 'signal';

  // ============================================================
  // Determinism
  // xmur3 hashes the seed string to a 32-bit stream, mulberry32 turns that into
  // a uniform generator. Both are tiny and reproducible on any machine, which
  // Math.random() is not.
  // ============================================================

  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  function makeRng(seedStr) {
    let a = xmur3(String(seedStr))();
    return function rng() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fnv1a(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }

  // ============================================================
  // Colour
  // ============================================================

  function hex2rgb(h) {
    h = String(h || '#000').trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h.slice(0, 6), 16);
    if (!isFinite(n) || h.length < 6) return [128, 128, 128];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgb2hex(r, g, b) {
    return '#' + [r, g, b].map((v) => {
      const s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return s.length === 1 ? '0' + s : s;
    }).join('');
  }

  function mix(a, b, t) {
    const A = hex2rgb(a), B = hex2rgb(b);
    return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }

  // ============================================================
  // Palette normalisation
  // Custom palettes and older projects can be missing roles, so every engine
  // reads through this. A missing colour must never produce a broken piece.
  // ============================================================

  function normalisePalette(p) {
    const src = p && typeof p === 'object' ? p : {};
    const dark = src.dark !== false;
    const bg = src.bg || (dark ? '#0b1020' : '#ffffff');
    const primary = src.primary || (dark ? '#7cc0f8' : '#2f7fd0');
    const accent = src.accent || primary;
    return {
      id: src.id || 'default',
      name: src.name || 'Default',
      bg: bg,
      surface: src.surface || bg,
      primary: primary,
      accent: accent,
      text: src.text || (dark ? '#eef1fb' : '#0f172a'),
      muted: src.muted || primary,
      dark: dark
    };
  }

  // How strongly artwork should read on this palette. Light palettes need a
  // touch more presence because a pale tint on white disappears; dark palettes
  // need slightly less so they do not glow.
  function presence(p) { return p.dark ? 1 : 1.18; }

  // ============================================================
  // Engines
  // Each is a pure function: (seed, palette, uid, intensity) -> SVG inner markup.
  // ============================================================

  // ---- Signal Field ----
  // A luminous core, concentric dial rings and phase-shifted waveforms, echoing
  // the P/ mark. The core matters more than the lines do: at desktop width a
  // 1600-unit viewBox is scaled to roughly 0.9, so a hairline ring network on a
  // near-black field reads as almost nothing on its own. The glow gives the piece
  // mass at any size, and it still holds up behind dense copy because the light is
  // diffuse rather than a hard bright shape.
  function signal(seed, p, uid, intensity) {
    const rng = makeRng(seed + '|signal');
    const gid = uid + 'sg', lid = uid + 'sl', rid = uid + 'sr';

    const cx = (0.16 + rng() * 0.68) * W;
    const cy = (0.2 + rng() * 0.6) * H;
    const glowR = 420 + rng() * 260;

    let defs =
      '<linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0%" stop-color="' + p.primary + '"/>' +
        '<stop offset="100%" stop-color="' + p.accent + '"/>' +
      '</linearGradient>' +
      '<linearGradient id="' + lid + '" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0%" stop-color="' + p.primary + '" stop-opacity="0"/>' +
        '<stop offset="45%" stop-color="' + p.primary + '" stop-opacity="0.9"/>' +
        '<stop offset="100%" stop-color="' + p.accent + '" stop-opacity="0"/>' +
      '</linearGradient>' +
      // userSpaceOnUse so the core lands where the dial is, not in each shape's bbox.
      '<radialGradient id="' + rid + '" gradientUnits="userSpaceOnUse" cx="' + cx.toFixed(0) +
        '" cy="' + cy.toFixed(0) + '" r="' + glowR.toFixed(0) + '">' +
        '<stop offset="0%" stop-color="' + p.primary + '" stop-opacity="' +
          (0.42 * presence(p)).toFixed(3) + '"/>' +
        '<stop offset="45%" stop-color="' + p.primary + '" stop-opacity="' +
          (0.17 * presence(p)).toFixed(3) + '"/>' +
        '<stop offset="100%" stop-color="' + p.accent + '" stop-opacity="0"/>' +
      '</radialGradient>';

    let body =
      '<circle cx="' + cx.toFixed(0) + '" cy="' + cy.toFixed(0) + '" r="' + (glowR * 1.7).toFixed(0) +
      '" fill="url(#' + rid + ')"/>';

    const rings = 7 + Math.floor(rng() * 6);
    for (let i = 0; i < rings; i++) {
      const r = 60 + i * (44 + rng() * 26);
      body += '<circle cx="' + cx.toFixed(0) + '" cy="' + cy.toFixed(0) + '" r="' + r.toFixed(0) +
              '" fill="none" stroke="url(#' + gid + ')" stroke-opacity="' +
              ((0.85 - i * 0.05) * presence(p)).toFixed(3) + '" stroke-width="2.2"/>';
    }

    const amp = 40 + rng() * 70, phase = rng() * 6.28;
    for (let w = 0; w < 3; w++) {
      const pts = [];
      const y0 = cy + (w - 1) * (54 + rng() * 40);
      // Frequency and amplitude are drawn ONCE per wave. Sampling the RNG inside
      // the x loop jitters every point independently and yields noise, not a wave.
      const freq = 3 + rng() * 2.2;
      const ampW = amp * (0.4 + rng() * 0.6);
      const drift = (rng() - 0.5) * 0.5;
      for (let x = 0; x <= W; x += 20) {
        const t = x / W;
        const env = Math.sin(Math.PI * Math.min(1, t * 1.25));
        const y = y0 + Math.sin(t * freq * Math.PI * 2 + phase + w * 0.7) * ampW * env + t * drift * 90;
        pts.push(x.toFixed(0) + ',' + y.toFixed(1));
      }
      body += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="url(#' + lid + ')" stroke-width="' +
              (w === 1 ? 4.4 : 2.5) + '" stroke-opacity="' +
              ((w === 1 ? 1 : 0.72) * Math.min(1, presence(p))) + '" stroke-linecap="round"/>';
    }

    return { defs: defs, body: body };
  }

  // ---- Halftone Ramp ----
  // A print-shop dot field whose radius rides a seeded diagonal ramp, so it fades
  // out rather than stopping at an edge. The most forgiving of the engines behind
  // text, and the cheapest to draw: a few hundred flat circles, no gradients.
  function halftone(seed, p, uid, intensity) {
    const rng = makeRng(seed + '|halftone');
    const cols = 26, rows = 15;
    const gapx = W / cols, gapy = H / rows;
    const ang = rng() * Math.PI, ca = Math.cos(ang), sa = Math.sin(ang);
    const ramp = 0.78 + rng() * 0.45;     // how quickly the field fades across
    const lift = -0.1 + rng() * 0.25;     // where the fade starts

    // The ramp is quantised into buckets so fill and opacity are written once per
    // bucket rather than once per dot. Emitting them per circle cost ~40 KB for a
    // single hero, which is a third the size of the rest of the page combined.
    const LEVELS = 12;
    const buckets = [];
    for (let i = 0; i < LEVELS; i++) buckets.push([]);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * gapx, y = (r + 0.5) * gapy;
        let t = ((x / W) * ca + (y / H) * sa + 1) / 2;
        t = Math.max(0, Math.min(1, (t - lift) / ramp));
        const rad = t * gapx * 0.46;
        if (rad < 0.8) continue;
        // Integer radius: a tenth of a pixel is invisible on a 60px dot and cost
        // roughly 800 bytes across the whole field.
        buckets[Math.min(LEVELS - 1, Math.floor(t * LEVELS))]
          .push(Math.round(x) + ',' + Math.round(y) + ',' + Math.max(1, Math.round(rad)));
      }
    }

    let body = '';
    for (let i = 0; i < LEVELS; i++) {
      if (!buckets[i].length) continue;
      // Endpoints land exactly on the palette colours, so the brand's real
      // primary and accent are present in the artwork, not merely approached.
      const t = i / (LEVELS - 1);
      body += '<g fill="' + mix(p.primary, p.accent, t) + '" fill-opacity="' +
              Math.min(1, (0.42 + t * 0.52) * presence(p)).toFixed(2) + '">';
      for (let n = 0; n < buckets[i].length; n++) {
        const parts = buckets[i][n].split(',');
        body += '<circle cx="' + parts[0] + '" cy="' + parts[1] + '" r="' + parts[2] + '"/>';
      }
      body += '</g>';
    }
    return { defs: '', body: body };
  }

  const ENGINES = [
    { id: 'signal',   name: 'Signal Field',  note: 'The house motif' },
    { id: 'halftone', name: 'Halftone Ramp', note: 'Print-shop dots' },
    { id: 'none',     name: 'No artwork',    note: 'Plain background' }
  ];

  const RENDERERS = { signal: signal, halftone: halftone };

  function engineOf(id) {
    for (let i = 0; i < ENGINES.length; i++) if (ENGINES[i].id === id) return ENGINES[i];
    return null;
  }

  // ============================================================
  // Building
  // ============================================================

  // The seed is the whole contract: same inputs, same artwork, forever.
  function seedFor(opts) {
    return [String(opts.name || ''), String(opts.paletteId || ''), String(opts.variation || 0), String(opts.engine || DEFAULT_ENGINE)].join('|');
  }

  function build(opts) {
    opts = opts || {};
    const p = normalisePalette(opts.palette);
    const engine = engineOf(opts.engine) ? opts.engine : DEFAULT_ENGINE;
    const seed = opts.seed || seedFor({
      name: opts.name, paletteId: p.id, variation: opts.variation, engine: engine
    });
    const uid = 'sg' + fnv1a(seed).slice(0, 6);

    if (engine === 'none' || !RENDERERS[engine]) {
      return { svg: '', hash: fnv1a('none'), seed: seed, engine: 'none' };
    }

    let intensity = typeof opts.intensity === 'number' ? opts.intensity : 1;
    intensity = Math.max(0, Math.min(1, intensity));

    const out = RENDERERS[engine](seed, p, uid, intensity);
    const inner =
      '<defs>' + out.defs.replace(/<defs>|<\/defs>/g, '') + '</defs>' +
      '<rect width="' + W + '" height="' + H + '" fill="' + p.bg + '"/>' +
      (intensity === 1 ? out.body : '<g opacity="' + intensity.toFixed(2) + '">' + out.body + '</g>');

    const svg =
      '<svg class="sig-art" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg"' +
      ' preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' + inner + '</svg>';

    return { svg: svg, hash: fnv1a(svg), seed: seed, engine: engine };
  }

  // ============================================================
  // Legibility layer
  // A separate overlay built from the palette's own bg, applied only where copy
  // sits. Shipped as its own element so a text-free band of a site keeps the
  // artwork at full strength.
  // direction: 'left' | 'bottom' | 'both'
  // ============================================================

  function scrim(palette, opts) {
    opts = opts || {};
    const p = normalisePalette(palette);
    const dir = opts.direction || 'both';
    const strength = typeof opts.strength === 'number' ? opts.strength : (p.dark ? 0.9 : 0.94);
    const id = 'sg' + fnv1a('scrim|' + p.id + '|' + dir).slice(0, 6);

    let defs = '', rects = '';
    if (dir === 'left' || dir === 'both') {
      defs += '<linearGradient id="' + id + 'x" x1="0" y1="0" x2="1" y2="0.25">' +
                '<stop offset="0%" stop-color="' + p.bg + '" stop-opacity="' + strength + '"/>' +
                '<stop offset="45%" stop-color="' + p.bg + '" stop-opacity="0.58"/>' +
                '<stop offset="100%" stop-color="' + p.bg + '" stop-opacity="0.14"/>' +
              '</linearGradient>';
      rects += '<rect width="' + W + '" height="' + H + '" fill="url(#' + id + 'x)"/>';
    }
    if (dir === 'bottom' || dir === 'both') {
      defs += '<linearGradient id="' + id + 'y" x1="0" y1="0" x2="0" y2="1">' +
                '<stop offset="0%" stop-color="' + p.bg + '" stop-opacity="0"/>' +
                '<stop offset="100%" stop-color="' + p.bg + '" stop-opacity="0.6"/>' +
              '</linearGradient>';
      rects += '<rect width="' + W + '" height="' + H + '" fill="url(#' + id + 'y)"/>';
    }

    return '<svg class="sig-scrim" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg"' +
           ' preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' +
           '<defs>' + defs + '</defs>' + rects + '</svg>';
  }

  // ============================================================
  // Convenience for the builder: one hero background, art + scrim layered.
  // `textLeft` decides which way the scrim falls, so copy in a split or
  // centred hero stays readable without dimming the whole piece.
  // ============================================================

  function background(opts) {
    const art = build(opts);
    if (!art.svg) return { html: '', hash: art.hash, seed: art.seed, engine: art.engine };
    const dir = opts && opts.direction ? opts.direction : 'both';
    return {
      html: '<div class="sig-bg">' + art.svg + '<div class="sig-bg-scrim">' +
            scrim(opts.palette, { direction: dir }) + '</div></div>',
      hash: art.hash,
      seed: art.seed,
      engine: art.engine
    };
  }

  return {
    build: build,
    background: background,
    scrim: scrim,
    seedFor: seedFor,
    normalisePalette: normalisePalette,
    hashOf: fnv1a,
    makeRng: makeRng,
    mix: mix,
    ENGINES: ENGINES,
    DEFAULT_ENGINE: DEFAULT_ENGINE
  };
})();

// Browser global (the app loads data modules as plain <script> tags), plus the
// CommonJS export the smoke tests and release-check use in Node.
if (typeof module !== 'undefined' && module.exports) module.exports = Signature;
if (typeof window !== 'undefined') window.Signature = Signature;
