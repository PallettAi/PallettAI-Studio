// ============================================================
// PallettAI Studio — Media
// Local asset optimization + procedural archetype backgrounds.
//
// optimizeLocalImage(buffer, options)
//   Takes a raw uploaded image (Uint8Array/Buffer/base64/data URL),
//   strips container metadata (EXIF, GPS, IPTC, XMP) with a byte-level
//   container walk, produces a WebP primary + fallback variant across
//   a responsive width ladder, and returns a self-contained srcset
//   definition.
//   Coverage per container: JPEG (APPn/COM segments), PNG (unsafe
//   chunks dropped from a safe list), WebP (RIFF EXIF/'XMP ' chunks).
//   SVG is XML text, so it is script-sanitized instead: <script>,
//   event handlers, javascript: URLs and <foreignObject>/<iframe>/
//   <embed>/<object> are stripped and reported. That pass is
//   regex-based and therefore best-effort — rasterize untrusted SVGs
//   if you need a guarantee. GIF carries no standard EXIF and is
//   passed through; a re-encode (when a canvas is available) drops
//   any remaining container metadata.
//
// generateArchetypePattern(patternType, primaryColor, options)
//   Procedural, self-contained inline SVG backgrounds keyed to
//   Studio's design archetypes:
//     pattern-grid      Architectural grid lines
//     pattern-dots      Fine halftone dot matrix
//     pattern-noise     SVG fractal noise filter (`<filter id="noise">`)
//     pattern-scanlines Retro CRT scanline overlay
//   Everything is generated, never fetched.
//
// Global API (classic script like the other modules):
//   Media.optimizeLocalImage(buffer, options) → Promise<result|null>
//   Media.generateArchetypePattern(type, primaryColor, opts) → svg string
//   Media.PATTERN_TYPES / Media.PATTERN_PROFILES / Media.SRCSET_LADDER
//   Media.IMAGE_PROFILES / Media.encodeAvailable / Media.encodeFormat
//
// WebP encode support is probed once; JPEG is the fallback. In a
// browser-less harness the re-encode path reports a structured
// "codec-unavailable" result instead of throwing.
// ============================================================
(function () {
  'use strict';

  const Media = {};

  /* ---------------- WebP support probe ---------------- */

  // One canvas probe, cached. In a Node smoke harness there is no
  // document, so the probe fails closed and optimize() reports a
  // structured result rather than throwing.
  const ENCODE_FORMAT = (function () {
    try {
      if (typeof document === 'undefined' || !document.createElement) return '';
      const probe = document.createElement('canvas');
      probe.width = 1;
      probe.height = 1;
      const out = probe.toDataURL('image/webp', 0.8);
      return String(out).indexOf('data:image/webp') === 0 ? 'image/webp' : 'image/jpeg';
    } catch (e) {
      return '';
    }
  })();
  const ENCODE_OK = !!ENCODE_FORMAT;

  /* ---------------- byte helpers ---------------- */

  function isJpeg(u8) {
    return u8.length > 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff;
  }

  function isPng(u8) {
    return u8.length > 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47 &&
      u8[4] === 0x0d && u8[5] === 0x0a && u8[6] === 0x1a && u8[7] === 0x0a;
  }

  function latin(dv, off, n) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(off + i));
    return s;
  }

  function concatBytes(parts) {
    let total = 0;
    for (let i = 0; i < parts.length; i++) total += parts[i].length;
    const out = new Uint8Array(total);
    let o = 0;
    for (let i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
    return out;
  }

  function toU8(input) {
    if (!input) return null;
    if (input instanceof Uint8Array) return input;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(input)) return new Uint8Array(input);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (Array.isArray(input)) return new Uint8Array(input);
    if (typeof input === 'string') {
      const m = /^data:[^,]*;base64,([\s\S]*)$/.exec(input.trim());
      return b64ToU8(m ? m[1] : input.trim());
    }
    return null;
  }

  function b64ToU8(s) {
    if (typeof Buffer !== 'undefined' && Buffer.from) {
      try { return new Uint8Array(Buffer.from(s, 'base64')); } catch (e) { /* fall through */ }
    }
    if (typeof atob === 'function') {
      try {
        const bin = atob(String(s).replace(/\s+/g, ''));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      } catch (e) { return null; }
    }
    return null;
  }

  function u8ToB64(bytes) {
    if (typeof Buffer !== 'undefined' && Buffer.from) {
      try { return Buffer.from(bytes).toString('base64'); } catch (e) { /* fall through */ }
    }
    if (typeof btoa === 'function') {
      let bin = '';
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      }
      return btoa(bin);
    }
    return '';
  }

  function dataUrlOf(bytes, mime) {
    const b64 = u8ToB64(bytes);
    return b64 ? 'data:' + mime + ';base64,' + b64 : '';
  }

  function sniffMime(u8) {
    if (isJpeg(u8)) return 'image/jpeg';
    if (isPng(u8)) return 'image/png';
    if (u8.length > 6 && u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return 'image/gif';
    if (u8.length > 12 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return 'image/webp';
    return '';
  }

  /* ---------------- container metadata walk ---------------- */

  // PNG: keep only chunks a renderer needs. tEXt/iTXt/zTXt carry
  // comments; eXIf carries GPS on some phones. Everything not on the
  // safe list is dropped, and the removed chunk types are reported.
  const SAFE_PNG_CHUNKS = ['IHDR', 'PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'pHYs', 'IDAT', 'IEND', 'acTL', 'fcTL', 'fdAT'];

  function stripPng(u8) {
    if (u8.length < 16) return { bytes: u8, removed: [] };
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const parts = [u8.slice(0, 8)];
    const removed = [];
    let pos = 8;
    while (pos + 12 <= u8.length) {
      const len = dv.getUint32(pos);
      if (len > u8.length - pos) break; // corrupt tail — keep what survived
      const type = latin(dv, pos + 4, 4);
      const total = 12 + len;
      if (SAFE_PNG_CHUNKS.indexOf(type) !== -1) parts.push(u8.slice(pos, pos + total));
      else removed.push(type);
      pos += total;
      if (type === 'IEND') break;
    }
    return { bytes: concatBytes(parts), removed: removed };
  }

  function jpegMarkerName(m) {
    if (m === 0xe1) return 'APP1(EXIF/XMP)';
    if (m === 0xe2) return 'APP2(ICC)';
    if (m === 0xed) return 'APP13(IPTC)';
    if (m === 0xee) return 'APP14(Adobe)';
    if (m === 0xfe) return 'COM(comment)';
    return 'APP' + (m - 0xe0);
  }

  // JPEG: walk segment markers. APPn + COM are pure metadata and are
  // dropped; DQT/SOF/DHT and the SOS scan are required to decode and
  // are kept. EXIF/GPS live in APP1, IPTC in APP13, XMP in APP1.
  function stripJpeg(u8) {
    if (u8.length < 4) return { bytes: u8, removed: [] };
    const parts = [u8.slice(0, 2)]; // SOI
    const removed = [];
    let i = 2;
    while (i + 4 <= u8.length) {
      if (u8[i] !== 0xff) break; // lost sync — bail with what we kept
      const marker = u8[i + 1];
      if (marker === 0xd9) { parts.push(u8.slice(i, i + 2)); break; } // EOI
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xda) { parts.push(u8.slice(i)); break; } // SOS → scan payload, keep verbatim
      const len = (u8[i + 2] << 8) | u8[i + 3];
      if (len < 2 || i + 2 + len > u8.length) break;
      const isMeta = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
      if (isMeta) removed.push(jpegMarkerName(marker));
      else parts.push(u8.slice(i, i + 2 + len));
      i += 2 + len;
    }
    return { bytes: concatBytes(parts), removed: removed };
  }

  // WebP is RIFF: 'RIFF' <u32 LE size> 'WEBP', then chunks of
  // (4-byte id, u32 LE size, payload, pad to even). GPS EXIF and XMP
  // ride in dedicated EXIF / 'XMP ' chunks, so the metadata promise
  // holds only if they are walked out — exactly like JPEG's APP1.
  const DROP_WEBP_CHUNKS = ['EXIF', 'XMP '];

  function stripWebp(u8) {
    if (u8.length < 16) return { bytes: u8, removed: [] };
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (latin(dv, 0, 4) !== 'RIFF' || latin(dv, 8, 4) !== 'WEBP') return { bytes: u8, removed: [] };
    const parts = [u8.slice(0, 12)];
    const removed = [];
    let pos = 12;
    while (pos + 8 <= u8.length) {
      const id = latin(dv, pos, 4);
      const size = dv.getUint32(pos + 4, true);
      const end = pos + 8 + size + (size % 2);
      if (end > u8.length) { parts.push(u8.slice(pos)); break; } // corrupt tail — keep verbatim
      if (DROP_WEBP_CHUNKS.indexOf(id) !== -1) removed.push('WebP:' + id.trim());
      else parts.push(u8.slice(pos, end));
      pos = end;
    }
    if (!removed.length) return { bytes: u8, removed: [] };
    const out = concatBytes(parts);
    const riffSize = out.length - 8; // RIFF size field = file size - 8
    out[4] = riffSize & 0xff;
    out[5] = (riffSize >>> 8) & 0xff;
    out[6] = (riffSize >>> 16) & 0xff;
    out[7] = (riffSize >>> 24) & 0xff;
    return { bytes: out, removed: removed };
  }

  // SVG uploads are executable documents: served from the site origin,
  // an embedded <script> or on*= handler runs with that origin's
  // privileges. Strip the canonical vectors and report them.
  const SVG_PATTERNS = [
    [/<script[\s\S]*?<\/script\s*>/gi, 'script'],
    [/<script[^>]*\/>/gi, 'script(self-closed)'],
    [/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, 'foreignObject'],
    [/<iframe[\s\S]*?<\/iframe\s*>/gi, 'iframe'],
    [/<embed[^>]*>/gi, 'embed'],
    [/<object[\s\S]*?<\/object\s*>/gi, 'object'],
    [/\son[a-z]+\s*=\s*"[^"]*"/gi, 'event-handler'],
    [/\son[a-z]+\s*=\s*'[^']*'/gi, 'event-handler'],
    [/\son[a-z]+\s*=\s*[^\s>]+/gi, 'event-handler'],
    [/javascript\s*:/gi, 'javascript-url']
  ];

  function sanitizeSvg(u8, dv) {
    const head = latin(dv, 0, Math.min(256, u8.length)).toLowerCase();
    if (head.indexOf('<svg') === -1 && head.indexOf('<?xml') === -1) return { bytes: u8, removed: [] };
    let text;
    try { text = new TextDecoder('utf-8').decode(u8); } catch (e) { return { bytes: u8, removed: [], unsafe: true }; }
    const removed = [];
    let out = text;
    for (let i = 0; i < SVG_PATTERNS.length; i++) {
      if (SVG_PATTERNS[i][0].test(out)) {
        out = out.replace(SVG_PATTERNS[i][0], '');
        removed.push('svg:' + SVG_PATTERNS[i][1]);
      }
    }
    if (!removed.length) return { bytes: u8, removed: [] };
    return { bytes: new TextEncoder().encode(out), removed: removed };
  }

  function stripContainer(u8) {
    if (isJpeg(u8)) return stripJpeg(u8);
    if (isPng(u8)) return stripPng(u8);
    const webp = stripWebp(u8);
    if (webp.removed.length) return webp;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    return sanitizeSvg(u8, dv);
  }

  /* ---------------- browser decode + re-encode ---------------- */

  function loadImageElement(dataUrl) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('decode failed')); };
      img.src = dataUrl;
    });
  }

  function encodeVariant(img, w, h, mime, q) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL(mime, q);
    return u8FromDataUrl(url, canvas.width, canvas.height);
  }

  function u8FromDataUrl(url, w, h) {
    const comma = url.indexOf(',');
    const header = url.slice(5, url.indexOf(';'));
    return { bytes: b64ToU8(url.slice(comma + 1)), mime: header, w: w, h: h };
  }

  /* ---------------- profiles + ladders ---------------- */

  const SRCSET_LADDER = [320, 640, 960, 1280, 1920];

  const IMAGE_PROFILES = {
    standard: { max: 1920, jpegQ: 0.82, webpQ: 0.80 },
    photo: { max: 1920, jpegQ: 0.86, webpQ: 0.84 },
    thumbnail: { max: 640, jpegQ: 0.74, webpQ: 0.72 }
  };

  /* ---------------- main entry ---------------- */

  /**
   * optimizeLocalImage(buffer, options)
   * @param {Uint8Array|Buffer|string} buffer  raw bytes, base64 or data URL
   * @param {object} [options] { maxW, profile, quality, name }
   * Promise<{ ok, reason, format, stripped, removedSegments, w, h,
   *   primary, fallback, variants, srcset, sources, suggestedFilename }>
   * Returns null for unusable input.
   */
  Media.optimizeLocalImage = async function optimizeLocalImage(buffer, options) {
    const opts = options || {};
    const src = toU8(buffer);
    if (!src || !src.length) return null;

    // 1 — strip container metadata (always; canvas or not).
    const strippedRes = stripContainer(src);
    const bytes = strippedRes.bytes;
    const removed = strippedRes.removed;

    // 2 — decode when a browser canvas is available.
    let img = null;
    let w = 0;
    let h = 0;
    const mime = sniffMime(bytes);
    if (ENCODE_OK) {
      try {
        img = await loadImageElement(dataUrlOf(bytes, mime || 'image/jpeg'));
        w = img.naturalWidth || img.width || 0;
        h = img.naturalHeight || img.height || 0;
      } catch (e) {
        img = null;
      }
      if (img && (!w || !h)) img = null;
    }
    const decodable = !!img;

    const profile = IMAGE_PROFILES[opts.profile] || IMAGE_PROFILES.standard;
    const maxW = Math.max(1, Math.min(Math.round(opts.maxW || profile.max), profile.max));
    const qWebp = clampQ(opts.quality || profile.webpQ);
    const qOther = clampQ(opts.quality ? opts.quality + 0.02 : profile.jpegQ);

    // 3 — variants: WebP primary + JPEG fallback, downscaled to maxW,
    // plus a responsive ladder (never upscaled past intrinsic width).
    let primary = null;
    let fallback = null;
    const variants = [];
    if (decodable && ENCODE_OK) {
      const targetW = Math.min(maxW, w);
      const targetH = Math.max(1, Math.round(h * (targetW / w)));
      const fmt = ENCODE_FORMAT; // 'image/webp' | 'image/jpeg'
      try {
        const p = encodeVariant(img, targetW, targetH, fmt, qWebp);
        primary = { bytes: p.bytes, mime: p.mime, w: p.w, h: p.h, dataUrl: dataUrlOf(p.bytes, p.mime) };
        variants.push({ w: p.w, h: p.h, mime: p.mime, bytes: p.bytes });
      } catch (e) { /* primary failed; report strip-only below */ }

      try {
        const fbMime = mime === 'image/png' ? 'image/png' : 'image/jpeg';
        const f = encodeVariant(img, targetW, targetH, fbMime, qOther);
        fallback = { bytes: f.bytes, mime: f.mime, w: f.w, h: f.h, dataUrl: dataUrlOf(f.bytes, f.mime) };
        if (fmt === 'image/webp') {
          for (let li = 0; li < SRCSET_LADDER.length; li++) {
            const lw = SRCSET_LADDER[li];
            if (lw >= w) break; // never upscale past intrinsic width
            const v = encodeVariant(img, lw, Math.max(1, Math.round(h * (lw / w))), fmt, qWebp);
            variants.push({ w: v.w, h: v.h, mime: v.mime, bytes: v.bytes });
          }
        }
      } catch (e) { /* fallback failure is non-fatal */ }
      variants.sort(function (a, b) { return a.w - b.w; });
    }

    return {
      ok: decodable || removed.length > 0,
      reason: decodable ? '' : (ENCODE_OK ? 'undecodable' : 'codec-unavailable'),
      format: primary ? (primary.mime === 'image/webp' ? 'webp' : 'jpeg') : 'original',
      // The metadata-free container, always. Re-encodes are a browser
      // luxury; this is the guarantee, available in every environment.
      bytes: bytes,
      stripped: removed,
      removedSegments: removed.length,
      w: w,
      h: h,
      primary: primary,
      fallback: fallback,
      variants: variants,
      srcset: buildSrcset(variants),
      sources: buildSources(variants, primary),
      suggestedFilename: suggestName(opts.name, primary ? primary.mime : mime)
    };
  };

  function clampQ(q) {
    const n = Number(q);
    if (!Number.isFinite(n)) return 0.8;
    return Math.max(0.3, Math.min(0.95, n));
  }

  function suggestName(name, mime) {
    const base = String(name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9-_ ]+/gi, '-').trim() || 'image';
    const ext = mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg';
    return base.slice(0, 60) + '.' + ext;
  }

  // srcset must be mime-homogeneous; per width keep the smallest bytes.
  function buildSrcset(variants) {
    const best = new Map();
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      if (!v.bytes || !v.bytes.length) continue;
      if (!best.has(v.w) || v.bytes.length < best.get(v.w).bytes.length) best.set(v.w, v);
    }
    const widths = Array.from(best.keys()).sort(function (a, b) { return a - b; });
    const rows = [];
    for (let i = 0; i < widths.length; i++) {
      const v = best.get(widths[i]);
      rows.push(v.dataUrl + ' ' + v.w + 'w');
    }
    return rows.join(', ');
  }

  // <picture> sources: one <source> per mime type, widest first.
  function buildSources(variants, primary) {
    const byMime = new Map();
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      if (!v.bytes || !v.bytes.length) continue;
      if (!byMime.has(v.mime)) byMime.set(v.mime, []);
      byMime.get(v.mime).push(v);
    }
    const esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); };
    const rows = [];
    for (const entry of byMime) {
      const mime = entry[0];
      const list = entry[1];
      list.sort(function (a, b) { return b.w - a.w; });
      const set = list.map(function (v) { return v.dataUrl + ' ' + v.w + 'w'; }).join(', ');
      rows.push('<source type="' + esc(mime) + '" srcset="' + esc(set) + '">');
    }
    return rows.join('');
  }

  /* ---------------- procedural archetype patterns ---------------- */

  // Archetype keys mirror the Design DNA "look" tray in modules/ai.js.
  const PATTERN_TYPES = ['pattern-grid', 'pattern-dots', 'pattern-noise', 'pattern-scanlines'];

  const PATTERN_PROFILES = {
    'pattern-grid': { label: 'Architectural grid', archetypes: ['editorial', 'minimal', 'techy', 'bold'] },
    'pattern-dots': { label: 'Halftone dot matrix', archetypes: ['playful', 'light', 'bright'] },
    'pattern-noise': { label: 'Fractal noise field', archetypes: ['dark', 'noir', 'warm'] },
    'pattern-scanlines': { label: 'Retro CRT scanlines', archetypes: ['techy', 'noir', 'dark', 'bold'] }
  };

  function hexColor(input) {
    const s = String(input == null ? '' : input).trim();
    let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
      return '#' + h.toLowerCase();
    }
    const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(s);
    if (rgb) {
      const to2 = function (n) {
        return Math.max(0, Math.min(255, parseInt(n, 10) | 0)).toString(16).padStart(2, '0');
      };
      return '#' + to2(rgb[1]) + to2(rgb[2]) + to2(rgb[3]);
    }
    return '';
  }

  function withAlpha(hex, a) {
    const h = hexColor(hex);
    if (!h) return '';
    const r = parseInt(h.slice(1, 3), 16);
    const g = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    const al = Math.max(0, Math.min(1, Number(a) || 0));
    return 'rgba(' + r + ',' + g + ',' + b + ',' + al + ')';
  }

  function b64Utf8(s) {
    if (typeof Buffer !== 'undefined' && Buffer.from) {
      try { return Buffer.from(s, 'utf8').toString('base64'); } catch (e) { /* fall through */ }
    }
    if (typeof btoa === 'function') {
      try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return ''; }
    }
    return '';
  }

  /**
   * generateArchetypePattern(patternType, primaryColor, options)
   * @param {string} patternType one of Media.PATTERN_TYPES
   * @param {string} primaryColor hex or rgb() accent colour
   * @param {object} [options] { opacity, cell, seed, asDataUrl }
   * @returns {string} self-contained inline SVG ('' for unknown types)
   */
  Media.generateArchetypePattern = function (patternType, primaryColor, options) {
    const opts = options || {};
    if (PATTERN_TYPES.indexOf(patternType) === -1) return '';
    const color = hexColor(primaryColor) || '#7c5cff';
    const op = clampNum(opts.opacity, 0, 1, 1);
    const seed = Math.abs(Math.round(Number(opts.seed) || 7)) || 7;
    const dfltCell = patternType === 'pattern-dots' ? 14 : 48;
    const cell = Math.round(clampNum(opts.cell, 4, 256, dfltCell));

    let w = cell;
    let h = cell;
    let body = '';

    if (patternType === 'pattern-grid') {
      // Architectural grid: a full cell border plus a lighter
      // centre cross, half-pixel offset so 1px lines stay crisp.
      body =
        '<path d="M ' + (cell + 0.5) + ' 0 V ' + (cell + 0.5) + ' H 0" fill="none" stroke="' + color + '" stroke-opacity="0.5"/>' +
        '<path d="M ' + (cell / 2 + 0.5) + ' 0 V ' + cell + '" stroke="' + color + '" stroke-opacity="0.15"/>' +
        '<path d="M 0 ' + (cell / 2 + 0.5) + ' H ' + cell + '" stroke="' + color + '" stroke-opacity="0.15"/>';
    } else if (patternType === 'pattern-dots') {
      // Halftone: one full dot + one offset lighter dot per cell.
      const r = Math.max(0.5, +(cell * 0.11).toFixed(2));
      body =
        '<circle cx="' + (r + 1) + '" cy="' + (r + 1) + '" r="' + r + '" fill="' + color + '" fill-opacity="0.45"/>' +
        '<circle cx="' + (cell - r - 1) + '" cy="' + (cell - r - 1) + '" r="' + (r * 0.55).toFixed(2) + '" fill="' + color + '" fill-opacity="0.2"/>';
    } else if (patternType === 'pattern-noise') {
      // Fractal noise field — the filter carries the id the brief
      // names ("noise"), desaturated so it tint-takes cleanly.
      w = 240;
      h = 240;
      const octaves = 3 + (seed % 3); // 3–5 octaves
      body =
        '<filter id="noise" x="0" y="0" width="100%" height="100%">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="' + octaves + '" seed="' + (seed % 10000) + '" stitchTiles="stitch"/>' +
        '<feColorMatrix type="saturate" values="0"/>' +
        '</filter>' +
        '<rect width="100%" height="100%" filter="url(#noise)" opacity="' + op + '"/>';
    } else if (patternType === 'pattern-scanlines') {
      // CRT scanlines: a 4px cycle — bright line + dim gap.
      w = 4;
      h = 4;
      body =
        '<rect x="0" y="0" width="4" height="2" fill="' + color + '" fill-opacity="0.16"/>' +
        '<rect x="0" y="2" width="4" height="2" fill="' + color + '" fill-opacity="0.06"/>';
    }

    const crisp = patternType === 'pattern-noise' ? '' : ' shape-rendering="crispEdges"';
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"' + crisp + '>' +
      body +
      '</svg>';

    if (opts.asDataUrl) {
      const b64 = b64Utf8(svg);
      return b64 ? 'data:image/svg+xml;base64,' + b64 : '';
    }
    return svg;
  };

  function clampNum(n, lo, hi, dflt) {
    const v = Number(n);
    if (!Number.isFinite(v)) return dflt;
    return Math.max(lo, Math.min(hi, v));
  }

  /* ---------------- exports ---------------- */

  Media.PATTERN_TYPES = PATTERN_TYPES;
  Media.PATTERN_PROFILES = PATTERN_PROFILES;
  Media.SRCSET_LADDER = SRCSET_LADDER;
  Media.IMAGE_PROFILES = IMAGE_PROFILES;
  Media.encodeAvailable = ENCODE_OK;
  Media.encodeFormat = ENCODE_FORMAT;

  if (typeof module !== 'undefined' && module.exports) module.exports = Media;
})();
