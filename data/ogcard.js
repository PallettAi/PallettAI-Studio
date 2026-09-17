'use strict';

// ============================================================
// Social cards — every page gets a share image of its own.
// ------------------------------------------------------------
// A link to an exported site that unfurls with no image looks unfinished, and
// one shared image for every page tells a reader nothing about the page they
// are about to open.
//
// These are generated as SVG from the project's own palette and type, then
// rasterised to PNG by the export path where a rasteriser is available. SVG is
// the source of truth because it is deterministic: the same project always
// produces byte-identical artwork, which is what makes it testable.
//
// The card is sized for the format the crawlers actually ask for: 1200×630.
// Text is wrapped to a budget rather than measured, because a font metric is
// not available offline and an overflowing headline is worse than a short one.
//
// Pure and offline.
// ============================================================

const OgCard = (() => {

  const W = 1200, H = 630;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const slugify = (s) => String(s == null ? '' : s).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // ---- palette --------------------------------------------------------------
  function paletteOf(project) {
    const site = (project && project.site) || {};
    let pal = null;
    try {
      if (typeof DB !== 'undefined' && DB.getPalette) pal = DB.getPalette(site.palette);
    } catch (e) { pal = null; }
    if (!pal && site.palette && typeof site.palette === 'object') pal = site.palette;
    const fallback = { bg: '#0b1020', surface: '#141b33', primary: '#7c5cff', accent: '#22d3ee', text: '#eef1fb', muted: '#9aa3c0', dark: true };
    const p = pal || fallback;
    return {
      bg: p.bg || fallback.bg,
      surface: p.surface || fallback.surface,
      primary: p.primary || fallback.primary,
      accent: p.accent || fallback.accent,
      text: p.text || fallback.text,
      muted: p.muted || fallback.muted,
      dark: p.dark !== false
    };
  }

  // ---- advance widths -------------------------------------------------------
  // Wrapping by CHARACTER COUNT was wrong, and wrong in the way that shows: a
  // count cannot tell 'WWW' from 'ill', so a card whose title is made of wide
  // letters ran off the right edge and was clipped mid-glyph. These are the
  // advance widths of a common grotesque in units of 1/1000 em, at the heavy
  // end of the range — the card is set at weight 800, and the rasteriser's
  // font is whatever the machine has, so the estimate errs wide on purpose.
  // A too-narrow estimate is a clipped card; a too-wide one is an early wrap.
  const ADVANCE = {
    ' ': 278, '!': 333, '"': 474, '#': 556, '$': 556, '%': 889, '&': 722, "'": 238,
    '(': 389, ')': 389, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
    ':': 333, ';': 333, '<': 584, '=': 584, '>': 584, '?': 611, '@': 975,
    A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556,
    K: 722, L: 611, M: 917, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
    U: 722, V: 667, W: 1000, X: 667, Y: 667, Z: 611,
    a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
    k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
    u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
    '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
    '8': 556, '9': 556
  };
  const advanceOf = (ch) => ADVANCE[ch] != null ? ADVANCE[ch] : 611;

  // How wide a run of text will be, in the same units the card is drawn in.
  function widthOf(text, size) {
    let units = 0;
    const s = String(text == null ? '' : text);
    for (let i = 0; i < s.length; i++) units += advanceOf(s[i]);
    return units * size / 1000;
  }

  // ---- text fitting ---------------------------------------------------------
  // Wraps to a pixel budget rather than a character count, so the width of the
  // letters decides where the line breaks. Falls back to a count only for a
  // caller that asks for one.
  // Cuts a run that cannot be wrapped or shrunk small enough to fit. The last
  // resort, and the only step that bounds the card for any input at all: a URL,
  // an invoice code or a wall of W's has no space to break at.
  function cutToWidth(text, size, maxPx) {
    if (widthOf(text, size) <= maxPx) return text;
    let out = '';
    for (let i = 0; i < text.length; i++) {
      if (widthOf(out + text[i] + '…', size) > maxPx) break;
      out += text[i];
    }
    return (out || text.slice(0, 1)).replace(/[.,;:!?]?$/, '') + '…';
  }

  // `allowCut` is false while `fitSize` is choosing a size, so that shrinking
  // the type is always preferred to cutting the words. The rendered card uses
  // the default, which cannot exceed the card whatever the title is.
  function wrapToWidth(text, size, maxPx, maxLines, allowCut) {
    const words = String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach((w) => {
      const next = line ? line + ' ' + w : w;
      // A single word wider than the card is kept whole — a word broken
      // mid-run is unreadable — and `fitSize` below steps the type down until
      // even that word fits, so keeping it here cannot clip.
      if (widthOf(next, size) <= maxPx || !line) line = next;
      else { lines.push(line); line = w; }
    });
    if (line) lines.push(line);
    let out = lines;
    if (lines.length > maxLines) {
      // Truncation has to pay for its own ellipsis. Appending it to a line that
      // already filled the budget is how a card that "fits" still gets clipped
      // — by exactly the width of one '…'.
      const kept = lines.slice(0, maxLines);
      const last = kept.length - 1;
      while (widthOf(kept[last] + '…', size) > maxPx && kept[last].indexOf(' ') > 0) {
        kept[last] = kept[last].slice(0, kept[last].lastIndexOf(' '));
      }
      kept[last] = kept[last].replace(/[.,;:!?]?$/, '') + '…';
      out = kept;
    }
    return allowCut === false ? out : out.map((l) => cutToWidth(l, size, maxPx));
  }

  // Steps the type down until every wrapped line fits the card. Only wide
  // letters, a long unbreakable word or a wrapped ellipsis reach this; ordinary
  // prose uses the size it was given. Deterministic, so the same title always
  // produces the same card.
  function fitSize(text, maxPx, maxLines, start) {
    const from = start || sizeFor(text);
    const FLOOR = 28;
    for (let s = from; s >= FLOOR; s -= 2) {
      const lines = wrapToWidth(text, s, maxPx, maxLines, false);
      if (lines.every((l) => widthOf(l, s) <= maxPx)) return s;
    }
    return FLOOR;
  }

  function wrap(text, perLine, maxLines) {
    const words = String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach((w) => {
      const next = line ? line + ' ' + w : w;
      if (next.length <= perLine || !line) line = next;
      else { lines.push(line); line = w; }
    });
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] = kept[maxLines - 1].replace(/[.,;:!?]?$/, '') + '…';
      return kept;
    }
    return lines;
  }

  // Long headlines get a smaller size rather than being cut off mid-thought.
  function sizeFor(text) {
    const n = String(text || '').length;
    if (n <= 42) return 76;
    if (n <= 70) return 64;
    if (n <= 110) return 52;
    return 42;
  }

  // ---- artwork --------------------------------------------------------------
  function svg(project, page) {
    const pal = paletteOf(project);
    const site = (project && project.site) || {};
    const name = String((site.name || (project && project.name) || 'My site')).trim();
    const title = String((page && (page.shareTitle || page.heading || page.title || page.name)) || site.name || '').trim();
    const sub = String((page && (page.shareSub || page.subtitle)) || site.tagline || '').trim();

    const pad = 88;

    // The headline gets the pixel budget the padding leaves it. The sub-line is
    // measured with its own size rather than the headline's, since it is set
    // smaller and lighter and reads as a caption rather than a second title.
    const textPx = W - pad * 2;
    const size = fitSize(title, textPx, 3);
    const titleLines = wrapToWidth(title, size, textPx, 3);
    const subSize = fitSize(sub, textPx, 2, 30);
    const subLines = wrapToWidth(sub, subSize, textPx, 2);

    const titleTop = H / 2 - (titleLines.length - 1) * (size * 0.62) + 10;

    const titleTspans = titleLines.map((l, i) =>
      '<tspan x="' + pad + '" y="' + Math.round(titleTop + i * size * 1.14) + '">' + esc(l) + '</tspan>').join('');
    const subTspans = subLines.map((l, i) =>
      '<tspan x="' + pad + '" y="' + Math.round(H - pad - (subLines.length - 1 - i) * 34) + '">' + esc(l) + '</tspan>').join('');

    // Three concentric arcs in the accent colour, echoed from the site's own
    // signature artwork so a shared link still looks like the brand.
    const marks = [0, 1, 2].map((i) => {
      const r = 150 + i * 74;
      const op = (0.30 - i * 0.08).toFixed(2);
      return '<circle cx="' + (W - 120) + '" cy="' + 96 + '" r="' + r + '" fill="none" stroke="' + pal.accent + '" stroke-opacity="' + op + '" stroke-width="' + (i === 0 ? 3 : 1.5) + '"/>';
    }).join('');

    return [
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title || name) + '">',
      '<title>' + esc(title || name) + ' — ' + esc(name) + '</title>',
      '<defs>',
      '<linearGradient id="fade" x1="0" y1="0" x2="1" y2="1">',
      '<stop offset="0" stop-color="' + pal.primary + '" stop-opacity="0.42"/>',
      '<stop offset="0.55" stop-color="' + pal.accent + '" stop-opacity="0.18"/>',
      '<stop offset="1" stop-color="' + pal.bg + '" stop-opacity="0"/>',
      '</linearGradient>',
      '</defs>',
      '<rect width="' + W + '" height="' + H + '" fill="' + pal.bg + '"/>',
      '<rect width="' + W + '" height="' + H + '" fill="url(#fade)"/>',
      marks,
      '<rect x="0" y="' + (H - 8) + '" width="' + W + '" height="8" fill="' + pal.primary + '"/>',
      '<text x="' + pad + '" y="' + (pad + 18) + '" fill="' + pal.muted + '" font-family="Inter, system-ui, sans-serif" font-size="26" font-weight="600" letter-spacing="0.08em">' + esc(name.toUpperCase()) + '</text>',
      '<text fill="' + pal.text + '" font-family="Inter, system-ui, sans-serif" font-size="' + size + '" font-weight="800" letter-spacing="-0.02em">' + titleTspans + '</text>',
      subLines.length ? '<text fill="' + pal.muted + '" font-family="Inter, system-ui, sans-serif" font-size="' + subSize + '" font-weight="400">' + subTspans + '</text>' : '',
      '</svg>'
    ].join('\n');
  }

  // ---- files ----------------------------------------------------------------
  // Two names for one piece of artwork. The SVG is the source of truth — it is
  // deterministic, so the same project always produces byte-identical cards,
  // which is what makes them testable. The PNG is the name that actually
  // unfurls: X, WhatsApp and LinkedIn will not render an SVG share image, so a
  // site whose og:image ends .svg shows a bare link to everyone who shares it.
  // The export writes both and the page points at the PNG.
  const slugOf = (page) => slugify((page && page.slug) || (page && page.name) || 'page') || 'page';
  function fileName(page) { return 'og/' + slugOf(page) + '.svg'; }
  function pngName(page) { return 'og/' + slugOf(page) + '.png'; }

  // A card as a data URL, so a rasteriser can load it with no server and no
  // network — which is the only way this can work in an offline desktop app.
  function dataUrl(svgString) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(String(svgString == null ? '' : svgString));
  }

  // One card per page, at the path the page's own <head> will reference.
  // `raster` is the name the same artwork takes if the export manages to
  // rasterise it; the caller only writes it when that actually succeeds.
  function files(project, pages) {
    const list = Array.isArray(pages) && pages.length
      ? pages
      : [Object.assign({}, (project && project.site) || {}, { slug: 'index', name: 'Home' })];
    return list.map((p) => ({ name: fileName(p), raster: pngName(p), content: svg(project, p), page: p }));
  }

  // ---- is a card even referenced? -------------------------------------------
  // The generated card needs a live URL — a crawler needs an absolute one — and
  // it is unused entirely when the project already carries its own share image.
  // Shipping them regardless put roughly half a megabyte of PNGs into every
  // export of a site that had no domain set, none of which anything referenced.
  function needed(project, settings) {
    const site = (project && project.site) || {};
    const url = String(site.url || '').trim();
    const set = settings || {};
    if (!url) return false;
    if (set.exportMeta === false) return false;
    if (String(site.ogImage || '').trim()) return false;
    return true;
  }

  // ---- writing the cards into an export --------------------------------------
  // The pages reference the PNG. Whether that reference is honest is decided
  // here, and it is the one decision in this whole feature that can go wrong
  // silently: rasterising needs a canvas, so on a host without one every page
  // would point at a file that was never written and every share would show
  // nothing at all.
  //
  // `raster` is the caller's rasteriser — an async svg-string in, bytes out, or
  // null when it cannot. It is a parameter rather than an import so this can be
  // tested in Node, where there is no canvas, on both branches.
  //
  // The two entries are the same artwork in two containers: the SVG is what
  // was drawn and is the source of truth, the PNG is what actually unfurls.
  async function attach(files, cards, raster) {
    let ok = true;
    for (const c of cards || []) {
      files.push({ name: c.name, content: c.content });
      let bytes = null;
      try { bytes = raster ? await raster(c.content) : null; } catch (e) { bytes = null; }
      if (bytes) files.push({ name: c.raster, content: bytes });
      else ok = false;
    }
    if (ok) return { rasterised: true, fallback: null };

    // Every reference goes back to the SVG — including the pages written after
    // this call, which is why the caller runs `fallback` at the very end of the
    // export. Half a fallback would leave some page unfurling with nothing.
    const fallback = (list) => {
      (list || files).forEach((f) => {
        if (typeof f.content === 'string') f.content = stripRasterRefs(f.content);
      });
    };
    fallback(files);
    return { rasterised: false, fallback: fallback };
  }

  // Matches the whole card URL the builder writes — an absolute one, which is
  // what a crawler needs — and only the extension of it. Anchoring on the
  // scheme matters: a bare `/og/` pattern also matches a client's OWN image in
  // their own `og` folder (`images/og/photo.png`) and would rename it to an SVG
  // that does not exist. A reference this cannot match is one the builder never
  // writes, so the failure it prefers is leaving a URL alone rather than
  // corrupting an unrelated one.
  const CARD_URL = /(https?:\/\/[^"'\s?#]*?)\/og\/([^"'?#\s]+)\.png/g;
  function stripRasterRefs(html) {
    return String(html == null ? '' : html).replace(CARD_URL, '$1/og/$2.svg');
  }

  return {
    W, H, wrap, wrapToWidth, cutToWidth, widthOf, fitSize, advanceOf, ADVANCE, sizeFor, paletteOf,
    svg, files, fileName, pngName, dataUrl, needed, attach, stripRasterRefs, esc, slugify
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OgCard;
