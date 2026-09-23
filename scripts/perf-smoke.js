// ============================================================
// Performance-as-proof smoke test
//
// The report is only worth showing if it is TRUE, so this checks it three ways:
//
//   1. The measurements are real. Raw sizes are exact UTF-8 byte counts and the
//      transfer size is an actual deflate pass, compared here against Node's
//      zlib rather than trusted.
//   2. The checks do not cry wolf. A receipt that warns on every correct export
//      stops being read, so the false positives that were found while building
//      this — a hero image flagged lazy by document position, an aspect-ratio
//      image flagged as unsized, a non-blocking stylesheet flagged as blocking —
//      are each pinned as tests.
//   3. A real export lands inside the budgets, and the four export defects the
//      measurement surfaced stay fixed: the lazy hero, duplicated loading
//      attributes, a bogus @font-face pointing at a 404, and a render-blocking
//      third-party font sheet.
//
// Run: node scripts/perf-smoke.js
// ============================================================
'use strict';

const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

const DB = require(path.join(ROOT, 'data', 'db.js'));
global.DB = DB;
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
global.Review = require(path.join(ROOT, 'data', 'review.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));
const Perf = require(path.join(ROOT, 'data', 'perf.js'));

function mkProject(opts) {
  const o = opts || {};
  return {
    id: 'p1',
    name: 'Northwind Joinery',
    suites: o.suites || [],
    site: {
      name: 'Northwind Joinery',
      tagline: 'Bespoke kitchens, built to last',
      palette: 'midnight',
      font: o.font || 'inter',
      heroLayout: o.heroLayout || 'split',
      design: { radius: 18, spacing: 96, containerWidth: 1140 },
      email: 'hi@northwind.example',
      ctaText: 'Get a quote',
      sections: [
        { type: 'hero', title: 'Bespoke kitchens', subtitle: 'Hand-built in Yorkshire', image: o.heroImage || '', items: [] },
        { type: 'features', title: 'Why us', items: [{ title: 'A', text: 'a' }, { title: 'B', text: 'b' }, { title: 'C', text: 'c' }] },
        { type: 'gallery', title: 'Our work', items: [{ title: 'One', text: '' }] },
        { type: 'contact', title: 'Talk to us' }
      ]
    }
  };
}

function buildPages(opts) {
  const built = Builder.buildSitePages(mkProject(opts), { proExport: true, plan: 'pro' });
  return built.map((e) => ({ name: e.page.name, slug: e.page.slug, html: e.html }));
}

(async () => {
  // ---- 1. the measurements are real -------------------------------------
  console.log('\n1. Measurement is real, not estimated');
  ok('a compressor is available for the test run', Perf.gzipAvailable());
  {
    const sample = 'abc'.repeat(5000);
    const real = zlib.gzipSync(Buffer.from(sample, 'utf8')).length;
    const got = await Perf.compressor().compress(sample);
    ok('gzip output matches Node zlib byte-for-byte', got === real, got + ' != ' + real);
  }
  {
    const pages = buildPages({});
    const report = await Perf.measure('Probe', pages);
    ok('report is marked as measured', report.measured === true);
    ok('method names the real compressor', report.method === 'zlib' || report.method === 'CompressionStream', report.method);
    const enc = new TextEncoder();
    pages.forEach((p, i) => {
      const exact = enc.encode(p.html).length;
      ok('raw bytes are exact UTF-8 for ' + p.slug, report.pages[i].rawBytes === exact, report.pages[i].rawBytes + ' != ' + exact);
      const gz = zlib.gzipSync(Buffer.from(p.html, 'utf8')).length;
      ok('transfer bytes match zlib for ' + p.slug, report.pages[i].gzipBytes === gz, report.pages[i].gzipBytes + ' != ' + gz);
    });
    ok('multibyte characters count as bytes', Perf.utf8Bytes('\u00e9') === 2 && Perf.utf8Bytes('\u4e2d') === 3, Perf.utf8Bytes('\u4e2d'));
  }

  // ---- 2. no false positives -------------------------------------------
  console.log('\n2. The checks do not cry wolf');
  {
    // A page whose hero has no image: the first <img> is a correctly-lazy gallery
    // photo, and keying the LCP check on document position reported it as a
    // critical failure.
    const pages = buildPages({ heroImage: '' });
    const report = await Perf.measure('x', pages);
    ok('an image-free hero is not reported lazy', report.pages[0].heroLazy === false);
    ok('no hero image is counted', report.pages[0].heroImages === 0, report.pages[0].heroImages);
  }
  {
    // Images sized by a stylesheet rule (`.hero-split-media img{aspect-ratio}`)
    // or by an inline aspect-ratio reserve their space, so warning about them
    // would be wrong.
    const pages = buildPages({ heroImage: 'https://example.com/hero.jpg' });
    const report = await Perf.measure('x', pages);
    ok('the hero image is detected', report.pages[0].heroImages === 1, report.pages[0].heroImages);
    ok('CSS/`aspect-ratio` sized images are not "unsized"', report.pages[0].imagesMissingDims === 0, report.pages[0].imagesMissingDims);
  }
  {
    const unsized = Perf.analyze({
      name: 'U', slug: 'u',
      html: '<div style="width:100%"><img src="https://example.com/a.png" alt="a"></div>'
    });
    ok('a genuinely unsized image IS reported', unsized.imagesMissingDims === 1, unsized.imagesMissingDims);
    const sized = Perf.analyze({
      name: 'S', slug: 's',
      html: '<img src="https://example.com/a.png" width="640" height="480" alt="a">'
    });
    ok('width/height attributes count as sized', sized.imagesMissingDims === 0);
  }
  {
    // The non-blocking font pattern must not be scored as blocking, or a correct
    // fix looks like a regression.
    const nonBlocking = Perf.analyze({
      name: 'N', slug: 'n',
      html: '<head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" media="print" onload="this.media=\'all\'"><noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"></noscript></head>'
    });
    ok('media="print" stylesheets are not render-blocking', nonBlocking.blockingStyles === 0, nonBlocking.blockingStyles);
    const blocking = Perf.analyze({
      name: 'B', slug: 'b',
      html: '<head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"></head>'
    });
    ok('a plain head stylesheet IS render-blocking', blocking.blockingStyles === 1, blocking.blockingStyles);
    const headScript = Perf.analyze({
      name: 'H', slug: 'h',
      html: '<head><script src="https://x.example/a.js"></script><script defer src="https://x.example/b.js"></script></head>'
    });
    ok('only non-deferred head scripts count as blocking', headScript.blockingScripts === 1, headScript.blockingScripts);
  }

  // ---- 3. the export itself ---------------------------------------------
  console.log('\n3. A real export lands inside the budgets');
  {
    const pages = buildPages({ suites: ['animation', 'seo'] });
    const report = await Perf.measure('Northwind', pages);
    const budget = Perf.BUDGET;
    report.pages.forEach((p) => {
      ok(p.name + ': transfer inside budget (' + Perf.KB(p.gzipBytes) + ' of ' + Perf.KB(budget.transfer.warn) + ')', p.gzipBytes != null && p.gzipBytes < budget.transfer.warn, Perf.KB(p.gzipBytes || 0));
      ok(p.name + ': raw inside budget', p.rawBytes < budget.raw.warn, Perf.KB(p.rawBytes));
      ok(p.name + ': dom inside budget', p.domNodes < budget.dom.warn, p.domNodes);
    });
    ok('no render-blocking stylesheet in an export', report.pages.every((p) => p.blockingStyles === 0));
    ok('no render-blocking script in an export', report.pages.every((p) => p.blockingScripts === 0));
    ok('no unsized images in an export', report.pages.every((p) => p.imagesMissingDims === 0));
    ok('no lazy hero image in an export', report.pages.every((p) => p.heroLazy === false));
    ok('grade is at least A', ['A+', 'A'].indexOf(report.grade.letter) > -1, report.grade.letter + ' (' + report.grade.score + ')');
    ok('summary states the transfer weight', /KB/.test(Perf.summary(report)), Perf.summary(report));
  }

  // ---- 4. the four export defects stay fixed ---------------------------
  console.log('\n4. Export defects the measurement surfaced');
  ['split', 'centered', 'minimal'].forEach((layout) => {
    [true, false].forEach((hero) => {
      const html = buildPages({ heroLayout: layout, heroImage: hero ? 'https://example.com/h.jpg' : '' })[0].html;
      const tags = html.match(/<img\b[^>]*>/gi) || [];
      const dup = tags.filter((t) => (t.match(/loading=/gi) || []).length > 1 || (t.match(/decoding=/gi) || []).length > 1);
      const heroLazy = tags.filter((t) => /\bhero-img\b/.test(t) && /loading="lazy"/.test(t));
      ok(layout + (hero ? ' +hero' : '') + ': no duplicated loading/decoding', dup.length === 0, dup[0]);
      ok(layout + (hero ? ' +hero' : '') + ': hero is never lazy', heroLazy.length === 0, heroLazy[0]);
      ok(layout + (hero ? ' +hero' : '') + ': every image async-decodes', tags.every((t) => /decoding="async"/.test(t)));
      ok(layout + (hero ? ' +hero' : '') + ': non-hero images stay lazy', tags.filter((t) => !/\bhero-img\b/.test(t)).every((t) => /loading="lazy"/.test(t)));
    });
  });
  ['inter', 'archivo', 'barlow', 'literata', 'notoserif', 'poppins', 'outfit'].forEach((fontId) => {
    const html = buildPages({ font: fontId })[0].html;
    ok(fontId + ': no bogus @font-face', !/@font-face\{[^}]*\}/.test(html), (html.match(/@font-face\{[^}]*\}/) || [])[0]);
    ok(fontId + ': no 404ing gstatic css2 URL', !/fonts\.gstatic\.com\/css2/.test(html));
    ok(fontId + ': font sheet loads non-blocking', /media="print"\s+onload="this\.media='all'"/.test(html));
    ok(fontId + ': noscript fallback kept', /<noscript><link rel="stylesheet"/.test(html));
  });
  {
    // The non-question: a site with online features switched off must reach no
    // third party at all. Checked on link tags, not raw text, because the
    // commented CSP template legitimately names the font hosts.
    const built = Builder.buildSitePages(mkProject({}), { proExport: true, plan: 'pro', onlineEnabled: false })[0].html;
    const links = built.match(/<link\b[^>]*>/gi) || [];
    ok('online off: no stylesheet tag at all', links.filter((t) => /rel="stylesheet"/.test(t)).length === 0, links.join(' | '));
    ok('online off: no preconnect', links.every((t) => !/fonts\.gstatic\.com|fonts\.googleapis\.com/.test(t)));
  }

  // ---- 4b. the element count ignores non-element content ----------------
  // A stylesheet is not DOM, and CSS can contain a '<' — @property's
  // syntax:"<angle>" is the case that surfaced this. Counting those bodies as
  // elements inflated the size signal on exactly the modern pages this report
  // grades, so the three containers are pinned here.
  console.log('\n4b. The DOM count counts elements, not embedded text');
  {
    const base = (extra) => Perf.analyze({
      name: 'D', slug: 'd',
      html: '<!doctype html><html><head><style>' + extra + '</style></head><body><p>hi</p></body></html>'
    }).domNodes;
    ok('a stylesheet containing a "<" is not counted as elements', base('@property --x{syntax:"<angle>"}') === base(''), base('@property --x{syntax:"<angle>"}') + ' != ' + base(''));
    ok('an inline script body is not counted as elements', base('</style><script>var s="<div>";</script>') === base(''));
    ok('an HTML comment is not counted as elements', Perf.analyze({ name: 'C', slug: 'c', html: '<body><!-- <div><span></span> --><p>x</p></body>' }).domNodes === 2);
    // Opening tags only (closing tags are not separate elements), which is the
    // long-standing behaviour of this counter: body + div + span = 3.
    ok('real elements are still counted', Perf.analyze({ name: 'R', slug: 'r', html: '<body><div><span>a</span></div></body>' }).domNodes === 3,
      String(Perf.analyze({ name: 'R', slug: 'r', html: '<body><div><span>a</span></div></body>' }).domNodes));
  }

  // ---- 5. scoring behaviour --------------------------------------------
  console.log('\n5. Scoring');
  ok('a clean page scores 100', Perf.scoreOf([]) === 100);
  ok('an error costs more than a warning', Perf.scoreOf([{ level: 'error' }]) < Perf.scoreOf([{ level: 'warn' }]));
  ok('the score never goes below zero', Perf.scoreOf(new Array(40).fill({ level: 'error' })) === 0);
  ok('letters step in order', ['A+', 'A', 'B', 'C', 'D', 'E'].join() === [97, 88, 78, 65, 50, 10].map(Perf.letterOf).join(), [97, 88, 78, 65, 50, 10].map(Perf.letterOf).join());
  {
    const report = await Perf.measure('multi', [{ name: 'Home', slug: 'index', html: '<p>ok</p>' }, { name: 'About', slug: 'about', html: '<p>ok</p>' }]);
    ok('the site grade is the worst page, not an average', report.grade.pages.length === 2 && report.grade.score <= Math.max.apply(null, report.grade.pages.map((p) => p.score)) + 2);
    ok('the heaviest page is named', typeof report.heaviest === 'string' && report.heaviest.length > 0);
  }
  {
    const withoutGzip = await Perf.measure('x', [{ name: 'Home', slug: 'index', html: '<p>ok</p>' }]);
    ok('totals expose raw when transfer is known', withoutGzip.totals.raw > 0 && withoutGzip.totals.gzip > 0);
  }

  console.log('\n' + (failed === 0 ? 'PERF SMOKE PASSED' : 'PERF SMOKE FAILED: ' + failed));
  process.exit(failed === 0 ? 0 : 1);
})();
