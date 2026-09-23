// ============================================================
// PallettAI Studio — performance as proof
//
// Agencies sell outcomes; this produces the receipt. Everything here is
// measured from the export the creator is about to publish rather than
// predicted from a score model. Byte counts are exact UTF-8 lengths, and the
// transfer size is a real deflate pass — zlib under Node, CompressionStream in
// the browser — so the number a creator reads is the number a visitor's phone
// actually downloads.
//
// Why a single number is honest here: a PallettAI export is self-contained, one
// HTML file per page with styles and scripts inline. There is no request
// waterfall to model and no render-blocking chain to guess at, so the gzipped
// size of that one file IS the page weight. That property is what lets the
// budget be tight instead of hand-wavy.
//
// Markup is read with regular expressions rather than a DOM. That is a
// deliberate trade: this module has to produce identical results under Node
// (the smoke test) and in the browser, and no DOM parser exists in both. It is
// sound *because* the markup is our own generated output — regular and
// predictable — not arbitrary third-party HTML. Anything ambiguous is reported
// as unknown rather than guessed.
//
// No DOM, no storage, no network. app.js drives it; the smoke test calls it raw.
// ============================================================

'use strict';

const Perf = (() => {
  // ---- budgets -----------------------------------------------------------
  // Transfer is the budget that matters: it is what the visitor pays for. Raw
  // is kept as a second ceiling because gzip hides repetition, and a page built
  // from a million repeated spans can still be slow to parse while transferring
  // almost nothing — that is exactly the Halftone artwork case, so both are
  // checked rather than only the flattering one.
  const BUDGET = {
    transfer: { warn: 60000, error: 150000 },   // gzipped bytes, one page
    raw: { warn: 180000, error: 480000 },       // uncompressed HTML
    dom: { warn: 2500, error: 6000 },           // elements to parse and lay out
    requests: { warn: 8, error: 20 },           // distinct external hosts+paths
    script: { warn: 60000, error: 140000 }      // inline JS bytes
  };

  const KB = (n) => (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';

  // ---- bytes -------------------------------------------------------------
  function utf8Bytes(str) {
    const s = String(str == null ? '' : str);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    // Legacy fallback with correct astral handling.
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  // A real compressor, whichever runtime offers one. Returns null when neither
  // exists so callers can say "unavailable" instead of inventing a ratio — a
  // fabricated number in a performance report is worse than a missing one.
  function compressor() {
    try {
      if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
        const zlib = require('zlib');
        if (zlib && typeof zlib.gzipSync === 'function') {
          return { name: 'zlib', compress: async (str) => zlib.gzipSync(Buffer.from(String(str), 'utf8')).length };
        }
      }
    } catch (e) { /* not Node, or zlib unavailable */ }
    if (typeof CompressionStream === 'function' && typeof Response === 'function') {
      return {
        name: 'CompressionStream',
        compress: async (str) => {
          const stream = new Blob([String(str)]).stream().pipeThrough(new CompressionStream('gzip'));
          const buf = await new Response(stream).arrayBuffer();
          return buf.byteLength;
        }
      };
    }
    return null;
  }

  const GZIP = compressor();
  const gzipAvailable = () => !!GZIP;

  // ---- structural extraction ---------------------------------------------
  const count = (html, re) => (html.match(re) || []).length;

  function hrefsOf(html, re) {
    const out = [];
    let m;
    const r = new RegExp(re.source, re.flags.indexOf('g') === -1 ? re.flags + 'g' : re.flags);
    while ((m = r.exec(html))) out.push(m[1] || '');
    return out;
  }

  // A <noscript> resource applies only when scripting is off. Counting it as
  // render-blocking would describe a visitor this page never actually has, so
  // the resource analysis runs on the document with those blocks removed — while
  // byte counts stay on the full document, because those bytes are really sent.
  function stripNoscript(html) {
    return String(html).replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
  }
  const linkTags = (html) => String(html).match(/<link\b[^>]*>/gi) || [];

  // "Render-blocking" means the browser cannot paint until this arrives. A
  // stylesheet qualifies unless it is scoped to another medium — the standard
  // non-blocking pattern is media="print" with a swap on load, which fetches the
  // sheet off the critical path. Treating that as blocking would make a correct
  // fix look like a regression.
  function isBlockingStylesheet(tag) {
    if (!/\brel\s*=\s*["']?stylesheet/i.test(tag)) return false;
    if (/\bdisabled\b/i.test(tag)) return false;
    const m = /\bmedia\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (!m) return true;
    const media = m[1].trim().toLowerCase();
    if (!media) return true;
    return media === 'all' || /^screen\b/.test(media);
  }

  // Everything that would leave the device at runtime: remote scripts, remote
  // stylesheets, remote images, CSS url() references and inline fetch calls.
  function externalRefs(html) {
    const refs = new Set();
    const add = (u) => {
      const s = String(u || '').trim();
      if (/^(https?:)?\/\//i.test(s)) refs.add(s.replace(/^\/\//, 'https://'));
    };
    hrefsOf(html, /<script\b[^>]*\bsrc=["']([^"']+)["']/gi).forEach(add);
    hrefsOf(html, /<link\b[^>]*\bhref=["']([^"']+)["']/gi).forEach(add);
    hrefsOf(html, /<img\b[^>]*\bsrc=["']([^"']+)["']/gi).forEach(add);
    hrefsOf(html, /<source\b[^>]*\bsrcset=["']([^"'\s,]+)/gi).forEach(add);
    hrefsOf(html, /<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi).forEach(add);
    hrefsOf(html, /\burl\(\s*["']?([^"')]+)["']?\s*\)/gi).forEach(add);
    hrefsOf(html, /\b(?:fetch|importScripts)\(\s*["'`]([^"'`]+)/gi).forEach(add);
    return Array.from(refs);
  }

  // An image reserves its space one of three ways: width/height attributes, an
  // inline aspect-ratio, or a stylesheet rule. The third needs a little CSS
  // matching — our own exports size the split-hero photo with
  // `.hero-split-media img{aspect-ratio:4/3}` — and a check that ignored it would
  // warn about every correct export, which is exactly how a receipt stops being
  // read. Returns the selectors that pin an <img>'s box.
  function imgSizingSelectors(css) {
    const out = [];
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRe.exec(css))) {
      const sel = m[1].trim();
      const body = m[2];
      if (!/\bimg\b/.test(sel)) continue;
      if (!/(^|[\s,>+~])img\b/.test(sel) && !/\bimg\s*[.#[:]/.test(sel) && !/\bimg\s*$/.test(sel)) continue;
      const pins = /aspect-ratio\s*:/.test(body)
        || (/\bwidth\s*:/.test(body) && /\bheight\s*:/.test(body));
      if (pins) out.push(sel);
    }
    return out;
  }

  function classesIn(str) {
    const out = [];
    const re = /\bclass=["']([^"']*)["']/gi;
    let m;
    while ((m = re.exec(String(str || '')))) {
      m[1].split(/\s+/).forEach((c) => { if (c) out.push(c); });
    }
    return out;
  }

  function imageIsSized(tag, context, sizedSelectors) {
    if (/\bwidth=/i.test(tag) && /\bheight=/i.test(tag)) return true;
    const style = (() => { const m = /\bstyle=["']([^"']*)["']/i.exec(tag); return m ? m[1] : ''; })();
    if (/aspect-ratio\s*:/i.test(style)) return true;
    if (/\bwidth\s*:/i.test(style) && /\bheight\s*:/i.test(style)) return true;
    // The image's own class, plus any ancestor class in the markup just before
    // it — enough to resolve our own `parent img{...}` rules without a parser.
    const classes = classesIn(tag).concat(classesIn(context));
    if (!classes.length) return false;
    const have = new Set(classes);
    return sizedSelectors.some((sel) => {
      const selClasses = (sel.match(/\.[a-z0-9_-]+/gi) || []).map((x) => x.slice(1));
      return selClasses.some((c) => have.has(c));
    });
  }

  function analyzePage(entry) {
    const name = String((entry && entry.name) || 'Untitled');
    const slug = String((entry && entry.slug) || '');
    const html = String((entry && entry.html) || '');
    const scannable = stripNoscript(html);

    const styleBlocks = hrefsOf(html, /<style\b[^>]*>([\s\S]*?)<\/style>/gi);
    const scriptBlocks = hrefsOf(html, /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi);
    const styleBytes = styleBlocks.reduce((n, s) => n + utf8Bytes(s), 0);
    const scriptSrc = hrefsOf(html, /<script\b[^>]*\bsrc=["']([^"']+)["']/gi);
    const scriptInlineBytes = scriptBlocks.reduce((n, s) => n + utf8Bytes(s), 0);

    // A script in <head> without defer/async stops the parser dead, so first
    // paint waits on it. Our own exports always defer, so any hit here is a real
    // regression rather than noise. A script at the end of <body> delays
    // interactivity but not the first paint, which is why this is head-scoped.
    const headEnd = scannable.search(/<\/head>/i);
    const head = headEnd === -1 ? scannable : scannable.slice(0, headEnd);
    const blockingScripts = (head.match(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>/gi) || [])
      .filter((tag) => !/\b(defer|async|type=["']module["'])/i.test(tag)).length;
    const blockingStyles = linkTags(scannable).filter(isBlockingStylesheet).length;

    const sizedSelectors = imgSizingSelectors(styleBlocks.join('\n'));
    const imgTags = [];
    {
      const re = /<img\b[^>]*>/gi;
      let m;
      while ((m = re.exec(html))) {
        imgTags.push({ tag: m[0], context: html.slice(Math.max(0, m.index - 400), m.index) });
      }
    }
    const imgText = imgTags.map((x) => x.tag);
    const missingDims = imgTags.filter((x) => !imageIsSized(x.tag, x.context, sizedSelectors)).length;
    const missingAlt = imgText.filter((t) => !/\balt=/i.test(t)).length;
    const lazyImgs = imgText.filter((t) => /\bloading=["']lazy["']/i.test(t)).length;

    // The LCP element is the hero image specifically — not simply the first
    // <img> in document order. Keying on position would report the first
    // *gallery* photo (correctly lazy) as a critical failure on any page whose
    // hero has no picture, and a receipt that cries wolf is worse than no
    // receipt. Our export tags the hero image, so this can be exact.
    const heroTags = imgText.filter((t) => /\bclass=["'][^"']*\bhero-img\b/i.test(t));
    const heroLazy = heroTags.some((t) => /\bloading=["']lazy["']/i.test(t));

    const fontFaces = count(html, /@font-face\b/gi);
    const fontNoDisplay = (html.match(/@font-face\s*\{[^}]*\}/gi) || [])
      .filter((b) => !/font-display\s*:/i.test(b)).length;

    const external = externalRefs(scannable);
    const hosts = Array.from(new Set(external.map((u) => {
      const m = /^https?:\/\/([^/]+)/i.exec(u);
      return m ? m[1].toLowerCase() : '';
    }).filter(Boolean)));

    // Rough element count — every '<tag' that starts a real element. Used only
    // as a size signal, so an approximation is fine. But it must not count the
    // CONTENTS of <style>, <script> or a comment, because none of that is an
    // element and CSS may legitimately contain a '<' — @property's
    // syntax:"<angle>" and a font-family like "A<B" both do. Counting those
    // bodies overstated the DOM on exactly the modern pages this report exists
    // to grade, which is how a real perf warning turns into a false one.
    const domSource = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const domNodes = count(domSource, /<[a-z][a-z0-9-]*[\s/>]/gi);
    const iframes = count(html, /<iframe\b/gi);
    const lazyIframes = count(html, /<iframe\b[^>]*\bloading=["']lazy["']/i);

    const raw = utf8Bytes(html);

    return {
      name: name,
      slug: slug,
      rawBytes: raw,
      gzipBytes: null,               // filled by measure()
      domNodes: domNodes,
      styleBytes: styleBytes,
      scriptBytes: scriptInlineBytes,
      styleBlocks: styleBlocks.length,
      scriptBlocks: scriptBlocks.length,
      remoteScripts: scriptSrc.filter((u) => /^(https?:)?\/\//i.test(u)).length,
      blockingScripts: blockingScripts,
      blockingStyles: blockingStyles,
      images: imgText.length,
      heroImages: heroTags.length,
      imagesMissingDims: missingDims,
      imagesMissingAlt: missingAlt,
      imagesLazy: lazyImgs,
      heroLazy: heroLazy,
      fontFaces: fontFaces,
      fontsWithoutDisplay: fontNoDisplay,
      iframes: iframes,
      lazyIframes: lazyIframes,
      external: external,
      hosts: hosts,
      requestCount: external.length
    };
  }

  // ---- findings ----------------------------------------------------------
  function findingsFor(page, opts) {
    const o = opts || {};
    const f = [];
    const push = (level, msg, fix) => f.push({ level: level, msg: msg, fix: fix || '' });

    if (page.gzipBytes != null) {
      if (page.gzipBytes > BUDGET.transfer.error) push('error', 'Transfers ' + KB(page.gzipBytes) + ' — over the ' + KB(BUDGET.transfer.error) + ' ceiling for one page.', 'Move inline artwork or long prose into fewer sections; the biggest single win is usually a base64 photo.');
      else if (page.gzipBytes > BUDGET.transfer.warn) push('warn', 'Transfers ' + KB(page.gzipBytes) + ' — above the ' + KB(BUDGET.transfer.warn) + ' comfort budget.', 'Check for base64 images in section backgrounds.');
    }
    if (page.rawBytes > BUDGET.raw.error) push('error', 'HTML is ' + KB(page.rawBytes) + ' uncompressed — slow to parse even though it compresses well.', 'Split this into more pages, or trim repeated markup.');
    else if (page.rawBytes > BUDGET.raw.warn) push('warn', 'HTML is ' + KB(page.rawBytes) + ' uncompressed.', 'Fine on desktop; heavy for a low-end phone on slow CPU.');

    if (page.scriptBytes > BUDGET.script.error) push('error', 'Inline JavaScript is ' + KB(page.scriptBytes) + '.', 'Remove a suite you are not using.');
    else if (page.scriptBytes > BUDGET.script.warn) push('warn', 'Inline JavaScript is ' + KB(page.scriptBytes) + '.', 'Each installed suite adds a slice.');

    if (page.blockingScripts) push('error', page.blockingScripts + ' render-blocking script' + (page.blockingScripts === 1 ? '' : 's') + ' in <head>.', 'Exports must load scripts with defer — this blocks first paint.');
    if (page.blockingStyles) push('error', page.blockingStyles + ' external stylesheet' + (page.blockingStyles === 1 ? '' : 's') + ' blocking render.', 'Styles belong inline in the export; an external sheet costs a round trip before anything paints.');

    if (page.requestCount > BUDGET.requests.error) push('error', page.requestCount + ' external requests on first load.', 'Self-host or remove them — each one is a chance to be slow or disappear.');
    else if (page.requestCount > BUDGET.requests.warn) push('warn', page.requestCount + ' external requests on first load.', 'Each is a third-party dependency your client does not control.');
    else if (page.requestCount) push('info', page.requestCount + ' external request' + (page.requestCount === 1 ? '' : 's') + (page.hosts.length ? ' (' + page.hosts.slice(0, 3).join(', ') + ')' : '') + '.', '');

    if (page.heroLazy) push('error', 'The first image is lazy-loaded, which delays the largest thing on screen.', 'The hero image must load eagerly — it is the LCP element.');
    if (page.imagesMissingDims) push('warn', page.imagesMissingDims + ' image' + (page.imagesMissingDims === 1 ? '' : 's') + ' with no reserved space.', 'Give the image width/height attributes or an aspect-ratio, or the layout shifts as it arrives (CLS).');
    if (page.fontsWithoutDisplay) push('warn', page.fontsWithoutDisplay + ' @font-face rule' + (page.fontsWithoutDisplay === 1 ? '' : 's') + ' without font-display.', 'Use font-display:swap so text paints before the font arrives.');
    if (page.iframes && page.lazyIframes < page.iframes) push('warn', (page.iframes - page.lazyIframes) + ' iframe' + ((page.iframes - page.lazyIframes) === 1 ? '' : 's') + ' not lazy-loaded.', 'A map or video embed should load on scroll, not on first paint.');
    if (page.domNodes > BUDGET.dom.error) push('error', page.domNodes + ' elements — a very large DOM.', 'Large collections read the same with fewer items.');
    else if (page.domNodes > BUDGET.dom.warn) push('warn', page.domNodes + ' elements to lay out.', '');

    if (o.lastModified) f.push({ level: 'info', msg: 'Optimised for Core Web Vitals: LCP (largest paint), CLS (layout shift) and INP (input latency).', fix: '' });
    return f;
  }

  // ---- scoring -----------------------------------------------------------
  function scoreOf(findings) {
    let s = 100;
    findings.forEach((f) => { s -= f.level === 'error' ? 18 : f.level === 'warn' ? 7 : 2; });
    return Math.max(0, Math.min(100, Math.round(s)));
  }

  function letterOf(score) {
    if (score >= 93) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 75) return 'B';
    if (score >= 62) return 'C';
    if (score >= 45) return 'D';
    return 'E';
  }

  function gradeReport(pages) {
    const perPage = (Array.isArray(pages) ? pages : []).map((p) => {
      const findings = findingsFor(p);
      const score = scoreOf(findings);
      return {
        name: p.name,
        slug: p.slug,
        score: score,
        letter: letterOf(score),
        findings: findings,
        errors: findings.filter((x) => x.level === 'error').length,
        warnings: findings.filter((x) => x.level === 'warn').length
      };
    });
    // The site grade is the worst page, not the average: a slow page is what a
    // visitor remembers, and an average would let one bad page hide.
    const worst = perPage.reduce((a, b) => (!a || b.score < a.score ? b : a), null);
    const score = worst ? worst.score : 100;
    return {
      pages: perPage,
      score: score,
      letter: letterOf(score),
      worstPage: worst ? worst.name : '',
      errors: perPage.reduce((n, p) => n + p.errors, 0),
      warnings: perPage.reduce((n, p) => n + p.warnings, 0)
    };
  }

  function budgetLabel() {
    return 'under ' + KB(BUDGET.transfer.warn) + ' per page';
  }

  // ---- public ------------------------------------------------------------
  // Async because a real deflate pass is async in the browser. Raw byte counts
  // are exact and synchronous via `analyze` when a caller needs them
  // immediately; `measure` adds the transfer numbers.
  async function measure(title, pages, opts) {
    const src = (Array.isArray(pages) ? pages : []);
    const list = src.map(analyzePage);
    let sized = false;
    if (GZIP) {
      for (let i = 0; i < list.length; i++) {
        try {
          list[i].gzipBytes = await GZIP.compress(String((src[i] && src[i].html) || ''));
          sized = true;
        } catch (e) { list[i].gzipBytes = null; }
      }
    }
    const graded = gradeReport(list);
    const worst = list.reduce((a, b) => (!a || b.rawBytes > a.rawBytes ? b : a), null);
    return {
      kind: 'pallettai-perf',
      title: String(title || ''),
      measured: !!sized,
      method: GZIP ? GZIP.name : 'unavailable',
      budget: BUDGET,
      budgetLabel: budgetLabel(),
      pages: list,
      grade: graded,
      totals: {
        pages: list.length,
        raw: list.reduce((n, p) => n + p.rawBytes, 0),
        gzip: sized ? list.reduce((n, p) => n + (p.gzipBytes || 0), 0) : null,
        requests: list.reduce((n, p) => n + p.requestCount, 0),
        dom: list.reduce((n, p) => n + p.domNodes, 0)
      },
      heaviest: worst ? worst.name : '',
      at: new Date().toISOString()
      , opts: opts || {}
    };
  }

  function summary(report) {
    if (!report) return '';
    const t = report.totals || {};
    const size = report.measured && t.gzip != null
      ? KB(t.gzip) + ' transfer across ' + t.pages + ' page' + (t.pages === 1 ? '' : 's')
      : KB(t.raw) + ' uncompressed across ' + t.pages + ' page' + (t.pages === 1 ? '' : 's');
    return size + ' · ' + (t.requests || 0) + ' external request' + (t.requests === 1 ? '' : 's');
  }

  return {
    BUDGET, KB, utf8Bytes, gzipAvailable, compressor: () => GZIP,
    analyze: analyzePage, analyzeAll: (pages) => (Array.isArray(pages) ? pages : []).map(analyzePage),
    findingsFor, scoreOf, letterOf, gradeReport, measure, summary, budgetLabel
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Perf;
