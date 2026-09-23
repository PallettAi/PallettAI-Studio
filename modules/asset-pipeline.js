'use strict';

/*
  ============================================================
  AssetPipeline — transformations that run before bundling
  ------------------------------------------------------------
  Three jobs, each with one way to get it wrong.

  SVG: the builder injects inline SVG (background patterns, noise
  filters, icons), and design tools export them full of editor
  metadata — namespaces, `data-name`, `<metadata>` blocks, indentation
  between every element. Stripping it is easy; stripping it without
  breaking the drawing is not, so this parser distinguishes content
  from decoration: an element is only removed when nothing in the
  document references it, and whitespace is only collapsed *between*
  tags, because inside `<text>` it is what renders.

  srcset: `modules/builder.js` already emits `srcset` markup for
  hosts that document a resize parameter. This module does not
  duplicate that. It produces the *manifest* — the widths, the
  descriptors, the per-breakpoint directive — that an image processor
  or an offline export consumes, and it refuses to invent a URL
  convention for a host that has none.

  Fonts: a `<link rel="preload" as="font">` is only useful when it is
  exactly right. It must carry `crossorigin` even for a same-origin
  file, because fonts are always fetched in CORS mode and a preload
  without it is a *second* fetch rather than a head start. It must
  not point at a `data:` URI, because there is nothing to fetch — and
  that is this app's common case: imported fonts are inlined as base64
  in `@font-face`. And it must not point at a Google Fonts CSS
  endpoint, whose URL is chosen per user agent, so a preload there is
  a wasted request that can only miss the cache. Each of those is a
  silent no-op in a naive implementation, which is why they are
  checks here rather than assumptions.
  ============================================================
*/

const AssetPipeline = (() => {

  const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

  // Text-bearing SVG elements whose whitespace is content.
  const TEXT_ELEMENTS = ['text', 'tspan', 'textPath', 'style', 'title', 'desc', 'pre'];

  // Editor-only elements and attributes. Never part of a drawing.
  const DROP_ELEMENTS = ['metadata', 'sodipodi:namedview', 'sodipodi:guide', 'sodipodi:grid'];
  const DROP_ATTRS = /(?:\s)(?:inkscape|sodipodi|sketch|figma|adobe|graph):[a-zA-Z-]+="[^"]*"|(?:\s)data-name="[^"]*"/g;

  function measureResult(before, after) {
    const b = Buffer.byteLength(String(before), 'utf8');
    const a = Buffer.byteLength(String(after), 'utf8');
    return {
      before: b,
      after: a,
      saved: b - a,
      percent: b === 0 ? 0 : Math.round(((b - a) / b) * 1000) / 10
    };
  }

  /*
    Protect the elements whose inner text is meaningful, so the
    whitespace pass cannot touch them. Placeholders use a private
    marker that cannot occur in SVG source.
  */
  function protectText(svg) {
    const held = [];
    let out = svg;
    TEXT_ELEMENTS.forEach((name) => {
      const rx = new RegExp('<' + name + '(\\s[^>]*)?>[\\s\\S]*?<\\/' + name + '>', 'gi');
      out = out.replace(rx, (match) => {
        held.push(match);
        return '\u0000TEXT' + (held.length - 1) + '\u0000';
      });
    });
    return { out, held };
  }

  function unprotectText(svg, held) {
    return svg.replace(/\u0000TEXT(\d+)\u0000/g, (m, i) => held[Number(i)] || '');
  }

  /*
    Remove an element only when nothing references its id. A hidden
    layer is decoration, but a hidden element that a `<use>` or a
    `clip-path="url(#id)"` points at is load-bearing: deleting it
    changes the drawing. That check is the whole reason this is not a
    one-line regex.
  */
  function dropUnreferencedHidden(svg) {
    let removed = 0;
    const out = svg.replace(/<([a-zA-Z][\w:-]*)\b([^>]*?)\bstyle="([^"]*)"([^>]*)>([\s\S]*?)<\/\1>/g, (match, tag, pre, style, post, inner) => {
      const hidden = /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style) || /display\s*=\s*"none"/i.test(pre + post);
      if (!hidden) return match;
      const idMatch = (pre + post).match(/\bid\s*=\s*"([^"]+)"/);
      if (idMatch) {
        const id = idMatch[1];
        // Referenced anywhere? Then it stays, hidden or not.
        const ref = svg.indexOf('url(#' + id) !== -1 ||
          svg.indexOf('href="#' + id) !== -1 ||
          svg.indexOf("href='#" + id) !== -1;
        if (ref) return match;
      }
      removed++;
      return '';
    });
    return { svg: out, removed };
  }

  /*
    A namespace declaration is only removable when no attribute in the
    document uses its prefix — `xmlns:xlink` with no `xlink:` attribute
    is dead weight, and removing a namespace that *is* used breaks the
    file, so the usage is counted rather than assumed.
  */
  function dropUnusedNamespaces(svg) {
    let removed = 0;
    const out = svg.replace(/\sxmlns:([a-zA-Z][\w-]*)="([^"]*)"/g, (match, prefix) => {
      const used = new RegExp('\\s' + prefix + ':').test(svg);
      if (used) return match;
      removed++;
      return '';
    });
    return { svg: out, removed };
  }

  function optimizeInlineSVGs(svgString, opts) {
    const o = opts || {};
    const source = String(svgString == null ? '' : svgString);
    if (!source.trim()) {
      return { ok: false, svg: source, error: 'empty SVG', stats: measureResult(source, source), removed: {} };
    }
    if (!/<svg\b/i.test(source)) {
      // Refusing is the honest answer: running the element passes over
      // arbitrary markup would edit something that is not an SVG.
      return { ok: false, svg: source, error: 'input is not an SVG element', stats: measureResult(source, source), removed: {} };
    }

    const removed = { comments: 0, prolog: 0, elements: 0, attributes: 0, namespaces: 0, hiddenLayers: 0, whitespace: 0 };
    let svg = source;

    // XML prolog and doctype: meaningless inside an inline SVG.
    svg = svg.replace(/<\?xml[\s\S]*?\?>/g, () => { removed.prolog++; return ''; });
    svg = svg.replace(/<!DOCTYPE[^>]*>/gi, () => { removed.prolog++; return ''; });

    svg = svg.replace(/<!--[\s\S]*?-->/g, () => { removed.comments++; return ''; });

    DROP_ELEMENTS.forEach((name) => {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp('<' + esc + '(?:\\s[^>]*)?/?>(?:[\\s\\S]*?<\\/' + esc + '>)?', 'gi');
      svg = svg.replace(rx, () => { removed.elements++; return ''; });
    });

    if (o.editorMetadata !== false) {
      svg = svg.replace(DROP_ATTRS, () => { removed.attributes++; return ''; });
    }

    if (o.namespaces !== false) {
      const ns = dropUnusedNamespaces(svg);
      svg = ns.svg;
      removed.namespaces += ns.removed;
    }

    if (o.hiddenLayers !== false) {
      const hidden = dropUnreferencedHidden(svg);
      svg = hidden.svg;
      removed.hiddenLayers += hidden.removed;
    }

    // Whitespace, with text-bearing elements held aside first.
    const guarded = protectText(svg);
    let body = guarded.out;

    const beforeWs = body.length;
    // Padding inside an attribute list never matters.
    body = body.replace(/\s*=\s*/g, '=');
    body = body.replace(/[ \t\r\n\f]{2,}/g, (m) => (m.indexOf('\n') !== -1 ? '\n' : ' '));
    // Indentation between elements is pure decoration.
    body = body.replace(/>\s+</g, '><');
    body = body.replace(/^\s+|\s+$/g, '');
    if (body.length !== beforeWs) removed.whitespace = beforeWs - body.length;

    svg = unprotectText(body, guarded.held);

    const stats = measureResult(source, svg);
    return {
      ok: true,
      svg,
      stats,
      removed,
      // The drawing must be unchanged: these are the attributes an
      // accidental rename or a lowercasing pass would destroy.
      preserved: {
        viewBox: (/viewBox="[^"]*"/.test(source) === /viewBox="[^"]*"/.test(svg)),
        pathData: (source.match(/<path\b/g) || []).length === (svg.match(/<path\b/g) || []).length,
        defs: (source.match(/<defs\b/g) || []).length === (svg.match(/<defs\b/g) || []).length
      }
    };
  }

  // ---------------------------------------------------------------
  // srcset
  // ---------------------------------------------------------------

  const DEFAULT_WIDTHS = [640, 1024, 1440];

  /*
    Breakpoint dimensions and per-width directives. `urlFor(width)` or
    `template` (with `{w}`) supply the URL when the caller knows its
    host's convention; without either, the manifest still lists the
    widths and descriptors for an upstream processor to act on, because
    inventing `?w=` for a host that does not support it produces
    four identical images and a slower page.
  */
  function generateSrcsetManifest(imagePath, targetSizes, opts) {
    const o = opts || {};
    const src = String(imagePath == null ? '' : imagePath);
    const requested = Array.isArray(targetSizes) && targetSizes.length ? targetSizes : DEFAULT_WIDTHS;
    const sourceWidth = Number(o.sourceWidth || 0);

    const widths = [...new Set(requested
      .map((w) => Math.round(Number(w)))
      .filter((w) => Number.isFinite(w) && w > 0))]
      .sort((a, b) => a - b);
    if (!widths.length) {
      return { ok: false, src, widths: [], descriptors: [], html: '', error: 'no usable target sizes', notes: [] };
    }

    const notes = [];
    const usable = sourceWidth
      // Never ask a server to upscale: a 900px source at 1440w is a
      // bigger file that looks the same.
      ? widths.filter((w) => w <= sourceWidth)
      : widths.slice();
    if (usable.length !== widths.length) {
      notes.push('dropped ' + (widths.length - usable.length) + ' width(s) larger than the ' + sourceWidth + 'px source');
    }
    const finalWidths = usable.length ? usable : [widths[0]];

    const ratios = o.aspectRatio ? Number(o.aspectRatio) : 0;
    const descriptors = finalWidths.map((w) => {
      let url = src;
      if (typeof o.urlFor === 'function') url = String(o.urlFor(w, src));
      else if (o.template) url = String(o.template).replace(/\{w\}/g, String(w));
      else if (o.widthParam) url = src + (src.indexOf('?') === -1 ? '?' : '&') + o.widthParam + '=' + w;
      return {
        width: w,
        height: ratios ? Math.round(w / ratios) : null,
        descriptor: w + 'w',
        url,
        directive: 'resize ' + w + 'w' + (ratios ? ' x ' + Math.round(w / ratios) : '')
      };
    });
    if (!o.urlFor && !o.template && !o.widthParam) {
      notes.push('no URL convention supplied, so every entry points at the original file — pass urlFor, template or widthParam to emit real sources');
    }

    return {
      ok: true,
      src,
      widths: finalWidths,
      descriptors,
      sizes: o.sizes || '(max-width: ' + Math.max.apply(null, finalWidths) + 'px) 100vw, ' + Math.max.apply(null, finalWidths) + 'px',
      html: descriptors.map((d) => d.url + ' ' + d.descriptor).join(', '),
      notes,
      errors: []
    };
  }

  // ---------------------------------------------------------------
  // Font preload
  // ---------------------------------------------------------------

  const FONT_TYPES = {
    woff2: 'font/woff2',
    woff: 'font/woff',
    ttf: 'font/ttf',
    otf: 'font/otf',
    eot: 'application/vnd.ms-fontobject'
  };

  function fontTypeOf(url) {
    const clean = String(url).split('#')[0].split('?')[0].toLowerCase();
    const ext = clean.slice(clean.lastIndexOf('.') + 1);
    return FONT_TYPES[ext] || '';
  }

  function originOf(url) {
    const m = String(url).match(/^([a-zA-Z][a-zA-Z0-9+.-]*:)?\/\/([^/]+)/);
    if (!m) return '';
    return (m[1] || '') + '//' + m[2];
  }

  /*
    Build the preload tags, and report everything left out with the
    reason. A preload that is skipped silently is indistinguishable
    from a missing feature, so each skip is named.
  */
  function generateFontPreloadDirectives(fontList, opts) {
    const o = opts || {};
    const list = Array.isArray(fontList) ? fontList : (fontList ? [fontList] : []);
    const tags = [];
    const skipped = [];
    const seen = new Set();

    const allowed = Array.isArray(o.fontSrc) ? o.fontSrc
      : (typeof o.fontSrc === 'string' && o.fontSrc ? o.fontSrc.split(/\s+/) : null);
    const allows = (url) => {
      if (!allowed) return true;
      const origin = originOf(url);
      if (!origin) return true; // a relative path is same-origin
      return allowed.some((rule) => {
        if (rule === "'self'") return false; // an absolute URL is not self
        if (rule === '*') return true;
        if (rule === 'data:') return false;
        return rule.replace(/\/$/, '') === origin;
      });
    };

    list.forEach((font) => {
      const url = String((font && (font.url || font.src || font.file)) || '');
      const family = String((font && font.family) || '');
      if (!url) { skipped.push({ font: family, reason: 'no url' }); return; }

      // Nothing to fetch: this app inlines imported fonts as base64, and
      // preloading a data URI is a tag that can never help.
      if (/^data:/i.test(url)) { skipped.push({ font: family, url: 'data:', reason: 'inline data URI — already in the document' }); return; }

      // The CSS endpoint returns different font files per user agent, so
      // a preload of it is guaranteed to miss the cache it was meant to
      // warm. Preconnecting is the correct tool for a CDN stylesheet.
      if (/^https?:\/\/fonts\.googleapis\.com/i.test(url)) {
        skipped.push({ font: family, url, reason: 'Google Fonts stylesheet is user-agent dependent — use preconnect, not preload' });
        return;
      }

      const type = fontTypeOf(url);
      if (!type) { skipped.push({ font: family, url, reason: 'not a recognised font format' }); return; }
      if (!allows(url)) { skipped.push({ font: family, url, reason: 'blocked by the document CSP font-src' }); return; }
      if (seen.has(url)) { skipped.push({ font: family, url, reason: 'duplicate' }); return; }
      seen.add(url);

      // `crossorigin` is always present: fonts are fetched in CORS mode
      // even same-origin, and without it the browser fetches twice.
      tags.push('<link rel="preload" href="' + url.replace(/&/g, '&amp;').replace(/"/g, '&quot;') +
        '" as="font" type="' + type + '" crossorigin>');
    });

    return {
      ok: true,
      html: tags.join('\n'),
      tags,
      count: tags.length,
      skipped,
      // What the document needs alongside the tags.
      preconnect: o.includePreconnect === false ? [] : ['https://fonts.gstatic.com'],
      errors: []
    };
  }

  return {
    optimizeInlineSVGs,
    generateSrcsetManifest,
    generateFontPreloadDirectives,
    measure: measureResult,
    DEFAULT_WIDTHS
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AssetPipeline;
