'use strict';

// ============================================================
// Responsive images — srcset, sizes, intrinsic size, priority.
// ------------------------------------------------------------
// The perf audit could already *flag* "this image has no srcset"; nothing
// could fix it, because the builder emitted one flat `src`. A phone on a
// train was downloading the same 1600px file as a 5K monitor.
//
// The governing rule here is the same one the release resolver follows:
// NEVER INVENT A URL. A candidate only exists if the host itself documents
// a resize parameter, so every srcset entry is a URL the origin will
// actually serve. An unrecognised host gets its tags left alone — an
// enlarged or broken candidate is worse than a heavy one.
//
// Everything in this file is pure and offline, so it is unit-testable
// without a browser or a network.
// ============================================================

const Images = (() => {
  const KB = (n) => (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';

  // ---- widths we will ever ask for -----------------------------------------
  // A deliberate small ladder. More candidates means more bytes in the markup
  // and more choice for the browser; four steps covers phone → laptop → 4K
  // without bloating every <img> tag in the export.
  const LADDER = [480, 800, 1200, 1600];

  // ---- hosts that can resize on the fly ------------------------------------
  // `build(url, w)` returns the URL for a single width, or null if that width
  // is not expressible. `intrinsic(url)` returns the size the source itself
  // declares, which is what width/height must carry to reserve the right box.
  const HOSTS = [
    {
      id: 'picsum',
      match: (u) => /^https?:\/\/picsum\.photos\/seed\/[^/?#]+\/(\d+)\/(\d+)/i.test(u),
      intrinsic: (u) => {
        const m = u.match(/^https?:\/\/picsum\.photos\/seed\/[^/?#]+\/(\d+)\/(\d+)/i);
        return m ? { w: +m[1], h: +m[2] } : null;
      },
      build: (u, w) => {
        const m = u.match(/^(https?:\/\/picsum\.photos\/seed\/[^/?#]+\/)(\d+)\/(\d+)/i);
        if (!m) return null;
        const iw = +m[2], ih = +m[3];
        if (w >= iw) return null; // never upscale — that is bigger for no gain
        const h = Math.max(1, Math.round(ih * (w / iw)));
        return m[1] + w + '/' + h;
      }
    },
    {
      id: 'pravatar',
      match: (u) => /^https?:\/\/i\.pravatar\.cc\/\d+/i.test(u),
      intrinsic: (u) => {
        const m = u.match(/^https?:\/\/i\.pravatar\.cc\/(\d+)/i);
        return m ? { w: +m[1], h: +m[1] } : null;
      },
      build: (u, w) => {
        const m = u.match(/^(https?:\/\/i\.pravatar\.cc\/)(\d+)/i);
        if (!m) return null;
        const iw = +m[2];
        if (w >= iw) return null;
        return m[1] + w + u.slice((m[1] + m[2]).length);
      }
    },
    {
      id: 'unsplash',
      match: (u) => /^https?:\/\/images\.unsplash\.com\//i.test(u),
      intrinsic: () => null, // the URL carries no dimensions of its own
      build: (u, w) => {
        try {
          const url = new URL(u);
          url.searchParams.set('w', String(w));
          if (!url.searchParams.get('q')) url.searchParams.set('q', '80');
          url.searchParams.set('auto', 'format');
          return url.toString();
        } catch (e) { return null; }
      }
    },
    {
      id: 'cloudinary',
      match: (u) => /^https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//i.test(u),
      intrinsic: () => null,
      build: (u, w) => {
        const m = u.match(/^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(?:[^/]*\/)?(.+)$/i);
        if (!m) return null;
        return m[1] + 'w_' + w + ',f_auto,q_auto/' + m[2];
      }
    }
  ];

  function hostFor(url) {
    const u = String(url == null ? '' : url).trim();
    if (!u) return null;
    for (const h of HOSTS) { if (h.match(u)) return h; }
    return null;
  }

  // Everything a caller needs to know about one image URL.
  function describe(url) {
    const u = String(url == null ? '' : url).trim();
    if (!u) return { url: '', host: null, kind: 'empty', intrinsic: null, resizable: false };
    if (/^data:/i.test(u)) return { url: u, host: null, kind: 'inline', intrinsic: null, resizable: false };
    const host = hostFor(u);
    if (!host) {
      return { url: u, host: null, kind: /^https?:/i.test(u) ? 'remote' : 'local', intrinsic: null, resizable: false };
    }
    return { url: u, host: host.id, kind: 'remote', intrinsic: host.intrinsic(u) || null, resizable: true };
  }

  // The candidate list for one image, widest last so the browser's default
  // `src` stays the smallest sensible file for a phone.
  function variants(url, ladder) {
    const info = describe(url);
    if (!info.resizable) return [];
    const host = hostFor(info.url);
    const widths = Array.isArray(ladder) && ladder.length ? ladder : LADDER;
    const out = [];
    for (const w of widths) {
      const cand = host.build(info.url, w);
      if (cand && cand !== info.url && !out.some((c) => c.url === cand)) out.push({ url: cand, w: w });
    }
    // A candidate identical to `src` adds nothing, but the largest rung still
    // matters: if every rung was filtered out the caller keeps the plain tag.
    return out;
  }

  // `sizes` has to match how the image is actually laid out, or the browser
  // picks a candidate for the wrong box. These are the four uses the builder
  // emits, measured from the stylesheet's own breakpoints.
  const SIZES = {
    hero: '100vw',
    full: '(max-width: 860px) 100vw, 860px',
    half: '(max-width: 720px) 100vw, 50vw',
    third: '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw',
    avatar: '96px',
    icon: '48px'
  };
  function sizesFor(kind) {
    return SIZES[kind] || SIZES.full;
  }

  const attr = (tag, name) => {
    const re = new RegExp('\\s' + name + '=["\']([^"\']*)["\']', 'i');
    const m = tag.match(re);
    return m ? m[1] : null;
  };
  const hasAttr = (tag, name) => new RegExp('\\s' + name + '(?=[\\s=/>])', 'i').test(tag);

  // Every page carries its own inline JavaScript, and that source contains
  // strings that LOOK like markup — `<img src="' + escHtml(avatar) + '" alt="">`
  // is source, not an image. Auditing it produced a phantom unsized, alt-less
  // image on every export. Comments and scripts are removed before measuring;
  // this is a size/behaviour audit, not a DOM parser.
  function markupOnly(html) {
    return String(html == null ? '' : html)
      .replace(/<script\b[\s\S]*?<\/script>/gi, '<!--script-->')
      .replace(/<!--[\s\S]*?-->/g, '');
  }

  // Add the attributes a tag is missing, and only those. Rewriting a tag that
  // already declares an attribute would duplicate it — invalid markup that
  // parsers half-ignore, which is exactly the bug the loading/decoding pass
  // had to be rewritten to fix.
  function decorate(tag, kind) {
    const src = attr(tag, 'src');
    if (!src) return tag;
    const info = describe(src);
    let out = tag;

    const insert = (s) => { out = out.replace(/^<img\b/i, '<img ' + s); };

    // intrinsic size — this is what reserves the layout box and removes CLS.
    if (info.intrinsic && !hasAttr(out, 'width') && !hasAttr(out, 'height')) {
      insert('width="' + info.intrinsic.w + '" height="' + info.intrinsic.h + '"');
    }

    const cands = variants(src);
    if (cands.length && !hasAttr(out, 'srcset')) {
      insert('srcset="' + cands.map((c) => c.url + ' ' + c.w + 'w').join(', ') + '"');
      if (!hasAttr(out, 'sizes')) insert('sizes="' + sizesFor(kind) + '"');
    }

    // The hero is the LCP element on every layout, so it is the one image that
    // must not wait behind the HTML parse, and the one worth a high priority.
    if (kind === 'hero' && !hasAttr(out, 'fetchpriority')) insert('fetchpriority="high"');
    return out;
  }

  // ---- audit --------------------------------------------------------------
  // Scores what the export actually ships, so the number moves when a real
  // image problem is fixed rather than when a proxy is tickled.
  const BUDGET = { heavy: 1600, coverageGood: 0.7, coverageWarn: 0.35 };

  function isHeroTag(tag) {
    return /\bclass=["'][^"']*\bhero-img\b/i.test(tag) || /\bfetchpriority=["']high["']/i.test(tag);
  }

  function auditPage(page) {
    const html = markupOnly((page && page.html) || '');
    const tags = html.match(/<img\b[^>]*>/gi) || [];
    const findings = [];
    let sized = 0, responsive = 0, noAlt = 0, inline = 0, oversized = 0;
    const hosts = {};

    tags.forEach((tag) => {
      const src = attr(tag, 'src') || '';
      const info = describe(src);
      if (!hasAttr(tag, 'alt')) noAlt++;
      if (info.kind === 'inline') inline++;
      if (hasAttr(tag, 'width') && hasAttr(tag, 'height')) sized++;
      if (hasAttr(tag, 'srcset')) responsive++;
      if (info.host) hosts[info.host] = (hosts[info.host] || 0) + 1;
      // A source bigger than any screen needs is wasted bytes for everyone.
      if (info.intrinsic && info.intrinsic.w > BUDGET.heavy && !hasAttr(tag, 'srcset')) oversized++;
    });

    const total = tags.length;
    const coverage = total ? responsive / total : 1;

    if (noAlt > 0) {
      findings.push({ level: 'warn', msg: noAlt + ' image' + (noAlt === 1 ? '' : 's') + ' with no alt attribute', fix: 'Describe each image in the section editor.' });
    }
    if (oversized > 0) {
      findings.push({
        level: 'warn',
        msg: oversized + ' image' + (oversized === 1 ? '' : 's') + ' wider than ' + BUDGET.heavy + 'px with no smaller alternative',
        fix: 'Export again — resizable sources now ship a srcset ladder.'
      });
    }
    // Only worth raising once there are enough images for it to matter.
    if (total >= 3 && coverage < BUDGET.coverageWarn) {
      findings.push({
        level: 'info',
        msg: responsive + '/' + total + ' images offer a smaller file (srcset)',
        fix: 'Images hosted somewhere that supports on-the-fly resizing get a ladder automatically.'
      });
    }
    if (inline > 0) {
      findings.push({ level: 'info', msg: inline + ' inlined image' + (inline === 1 ? '' : 's') + ' (base64 in the page)', fix: 'Uploads are inlined on purpose so the export stays self-contained.' });
    }

    return {
      page: (page && page.name) || 'Untitled',
      slug: (page && page.slug) || '',
      total: total,
      responsive: responsive,
      sized: sized,
      inline: inline,
      noAlt: noAlt,
      coverage: coverage,
      hosts: hosts,
      findings: findings
    };
  }

  function audit(pages) {
    const list = (Array.isArray(pages) ? pages : []).map(auditPage);
    const totals = list.reduce((acc, p) => {
      acc.total += p.total; acc.responsive += p.responsive; acc.sized += p.sized;
      acc.inline += p.inline; acc.noAlt += p.noAlt;
      return acc;
    }, { total: 0, responsive: 0, sized: 0, inline: 0, noAlt: 0 });
    const coverage = totals.total ? totals.responsive / totals.total : 1;
    const cliSafe = totals.total === 0 || totals.sized / totals.total >= 0.8;

    let score = 100;
    list.forEach((p) => p.findings.forEach((f) => { score -= f.level === 'warn' ? 9 : f.level === 'info' ? 2 : 0; }));
    score = Math.max(0, Math.round(score));
    const letter = score >= 95 ? 'A+' : score >= 88 ? 'A' : score >= 78 ? 'B' : score >= 66 ? 'C' : score >= 50 ? 'D' : 'F';

    return {
      pages: list,
      totals: totals,
      coverage: coverage,
      cliSafe: cliSafe,
      score: score,
      letter: letter,
      summary: totals.total === 0
        ? 'No images in this site yet.'
        : totals.responsive + ' of ' + totals.total + ' images offer a smaller file; ' + totals.sized + ' reserve their space (no layout shift).'
    };
  }

  return {
    LADDER, SIZES, BUDGET, KB,
    describe, variants, sizesFor, decorate, hostFor, markupOnly,
    audit, auditPage, attr, hasAttr
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Images;
