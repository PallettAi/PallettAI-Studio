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

  // ---- text fitting ---------------------------------------------------------
  // Wraps to a character budget per line and truncates the tail with an
  // ellipsis. Deliberately arithmetic: the same title always wraps the same
  // way, so the artwork is reproducible and reviewable.
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

    const size = sizeFor(title);
    const titleLines = wrap(title, size > 60 ? 24 : 34, 3);
    const subLines = wrap(sub, 62, 2);

    const pad = 88;
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
      subLines.length ? '<text fill="' + pal.muted + '" font-family="Inter, system-ui, sans-serif" font-size="30" font-weight="400">' + subTspans + '</text>' : '',
      '</svg>'
    ].join('\n');
  }

  // ---- files ----------------------------------------------------------------
  function fileName(page) {
    const slug = slugify((page && page.slug) || (page && page.name) || 'page') || 'page';
    return 'og/' + slug + '.svg';
  }

  // One card per page, at the path the page's own <head> will reference.
  function files(project, pages) {
    const list = Array.isArray(pages) && pages.length
      ? pages
      : [Object.assign({}, (project && project.site) || {}, { slug: 'index', name: 'Home' })];
    return list.map((p) => ({ name: fileName(p), content: svg(project, p), page: p }));
  }

  return { W, H, wrap, sizeFor, paletteOf, svg, files, fileName, esc, slugify };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OgCard;
