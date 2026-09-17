// ============================================================
// Export polish smoke test — images, keyboard access, share cards, 404.
//
// These four modules all change the artefact the client receives, so the tests
// are weighted the same way the risk is:
//
//   1. THE EXPORT IS STILL VALID. An enhancement that breaks markup is worse
//      than no enhancement. Every pass must be idempotent, must not duplicate
//      an attribute, and must leave an unrecognised image untouched rather
//      than rewriting it wrongly.
//   2. THE AUDITS DO NOT CRY WOLF. Each of these found a false positive while
//      being built — a phantom image counted out of inline script source, a
//      nav that "had no current page" on a single-page site, a duplicate
//      problem reported three times because it appeared in the nav, footer and
//      a button. Each is pinned here as a test.
//   3. THE REAL DEFECTS STAY FIXED. Four genuine export bugs were found and
//      fixed while building this: the hero had no smaller alternative, the
//      site's own CSS removed the focus ring, the navigation never marked the
//      current page, and — worst — a Contact link pointed at a section id that
//      could not exist, on the link a prospect is most likely to click.
//
// Run: node scripts/export-polish-smoke.js
// ============================================================
'use strict';

const path = require('path');
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
const Images = require(path.join(ROOT, 'data', 'images.js'));
const Focus = require(path.join(ROOT, 'data', 'focus.js'));
const OgCard = require(path.join(ROOT, 'data', 'ogcard.js'));
const NotFound = require(path.join(ROOT, 'data', 'notfound.js'));
global.Images = Images;
global.Focus = Focus;
global.OgCard = OgCard;
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));

function mkProject(extra) {
  const site = Object.assign({
    name: 'Northwind Joinery',
    tagline: 'Bespoke kitchens, built to last',
    palette: 'midnight',
    font: 'inter',
    heroLayout: 'split',
    url: 'https://northwind.example',
    email: 'hi@northwind.example',
    pages: [
      {
        id: 'home', name: 'Home', slug: 'index', sections: [
          { type: 'hero', title: 'Bespoke kitchens', subtitle: 'Hand-built', image: 'https://picsum.photos/seed/hero/1600/900', items: [] },
          { type: 'gallery', title: 'Our work', items: [{ title: 'One', text: '' }, { title: 'Two', text: '' }] },
          { type: 'contact', title: 'Talk to us' }
        ]
      },
      { id: 'about', name: 'About', slug: 'about', sections: [{ type: 'about', title: 'Who we are', image: 'https://picsum.photos/seed/about/800/600' }] }
    ]
  }, extra || {});
  return { id: 'p1', name: 'Northwind Joinery', suites: [], site: site };
}

const built = Builder.buildSitePages(mkProject(), { proExport: true, plan: 'pro' });
const pages = built.map((e) => ({ name: e.page.name, slug: e.page.slug, html: e.html }));
const home = pages[0].html;
const about = pages[1].html;

// ---- 1. responsive images -------------------------------------------------
console.log('\n1. Responsive images');
{
  const hero = (home.match(/<img[^>]*hero-img[^>]*>/i) || [''])[0];
  ok('the hero now offers a smaller alternative', /srcset=/.test(hero), hero.slice(0, 90));
  ok('the hero declares sizes', /sizes="100vw"/.test(hero));
  ok('the hero declares its intrinsic size (no layout shift)', /\bwidth="1600" height="900"/.test(hero));
  ok('the hero is prioritised, not deferred', /fetchpriority="high"/.test(hero) && /loading="eager"/.test(hero));
  ok('no loading attribute is duplicated', (hero.match(/loading=/g) || []).length === 1);
  ok('no decoding attribute is duplicated', (hero.match(/decoding=/g) || []).length === 1);

  // never upscale: every candidate must be smaller than the source
  const cands = Images.variants('https://picsum.photos/seed/hero/1600/900');
  ok('candidates are all smaller than the source', cands.every((c) => c.w < 1600), JSON.stringify(cands.map((c) => c.w)));
  ok('the ladder is capped at the source width', imagesMax(cands) === 1200, String(imagesMax(cands)));

  // Unknown hosts are left alone rather than guessed at — no srcset, no
  // invented resize URL. The one thing that IS added is the box the caller
  // just described: the second argument is the layout role, so a tag told it
  // occupies a half-width box declares that box's ratio. That is the fix for
  // every uploaded photo, whose real pixel size the builder cannot know — a
  // data URL carries no dimensions — but whose box the renderer does know.
  const unknown = '<img src="https://example.com/photo.png" alt="">';
  const boxed = Images.decorate(unknown, 'half');
  ok('an unrecognised host gets no invented candidate', !/srcset=/.test(boxed), boxed);
  ok('but its box is declared so it cannot shift the layout', /\bwidth="1200" height="900"/.test(boxed), boxed);
  ok('an upload with a data URL is sized the same way',
    /\bwidth="1200" height="900"/.test(Images.decorate('<img src="data:image/webp;base64,AAAA" alt="">', 'half')));
  ok('a square role is given a square box',
    /\bwidth="800" height="800"/.test(Images.decorate('<img src="data:image/webp;base64,AAAA" alt="">', 'third')));
  ok('an inline aspect-ratio beats the role it was given',
    /\bwidth="1200" height="675"/.test(Images.decorate('<img src="data:image/webp;base64,AAAA" alt="" style="aspect-ratio:16/9">', 'half')));
  ok('a role with no known box is left alone',
    Images.decorate('<img src="data:image/webp;base64,AAAA" alt="">', 'full').indexOf('width=') < 0);
  ok('a real intrinsic size still wins over the box',
    /\bwidth="640" height="480"/.test(Images.decorate('<img src="https://picsum.photos/seed/z/640/480" alt="">', 'half')));
  // The builder injects markup from inside its own inline scripts, so the
  // regex that finds tags also finds source. A fragment is not an element.
  const fragment = `<img src="' + escHtml(avatar) + '" alt="">`;
  ok('a markup fragment inside script source is never measured',
    Images.decorate(fragment, 'full') === fragment && Images.boxSize(fragment, 'full') === null);

  // idempotence: the export path can legitimately re-run the pass
  const once = Images.decorate('<img class="hero-img" src="https://picsum.photos/seed/x/1600/900" alt="a">', 'hero');
  ok('decorating twice changes nothing', Images.decorate(once, 'hero') === once);
  ok('unsplash gets a resize parameter', /srcset="[^"]*w=480/.test(Images.decorate('<img src="https://images.unsplash.com/photo-abc" alt="">', 'full')));

  // the false positive: markup inside inline <script> source is not an image
  const withScript = '<body><script>var s = \'<img src="x.png" alt="">\';</scr' + 'ipt><img src="https://picsum.photos/seed/a/640/480" alt="ok"></body>';
  const audit = Images.auditPage({ name: 'T', slug: 'index', html: withScript });
  ok('inline script source is not counted as an image', audit.total === 1, 'counted ' + audit.total);
  ok('the script image is not reported as missing alt text', audit.noAlt === 0, 'noAlt ' + audit.noAlt);

  const real = Images.audit(pages);
  ok('a real export scores full marks on images', real.score >= 95, real.letter + ' ' + real.score);
  ok('every image in the export reserves its space', real.totals.sized === real.totals.total, JSON.stringify(real.totals));
}

function imagesMax(cands) {
  return cands.reduce((m, c) => Math.max(m, c.w), 0);
}

// ---- 2. keyboard & focus --------------------------------------------------
console.log('\n2. Keyboard access');
{
  ok('the skip link is the first thing in the body', /<body[^>]*>\s*<a class="skip-link"/.test(home));
  ok('the skip link comes before the navigation', home.indexOf('skip-link') < home.indexOf('<nav'));
  ok('the skip link points at a real landmark', /<main id="main" aria-label="Main content">/.test(home));
  ok('a focus ring is defined that author CSS cannot remove', /:focus-visible\{outline/.test(home) && /!important/.test(home));
  ok('the site no longer strips the focus outline', !/outline\s*:\s*none/i.test(home), 'outline:none still present');

  // the pass must be idempotent — two exports must not mean two skip links
  const twice = Focus.pass(home, { slug: 'index' });
  ok('passing again adds no second skip link', (twice.match(/class="skip-link"/g) || []).length === 1);
  ok('passing again does not double the main id', (twice.match(/id="main"/g) || []).length === 1);

  // aria-current has to come from the renderer, per page
  const navHome = (home.match(/<nav[\s\S]*?<\/nav>/i) || [''])[0];
  const navAbout = (about.match(/<nav[\s\S]*?<\/nav>/i) || [''])[0];
  ok('the current page is marked exactly once', (navHome.match(/aria-current="page"/g) || []).length === 1);
  ok('the marked link is this page', /href="#top" aria-current="page">Home</.test(navHome), navHome.slice(0, 200));
  ok('the marker follows the page being built', /aria-current="page">About</.test(navAbout));

  // a single-page site has no "current page" to mark, and must not be nagged
  const single = Builder.buildSiteHTML(mkProject({
    pages: [], sections: [{ type: 'hero', title: 'H' }, { type: 'pricing', title: 'P' }]
  }), { proExport: true });
  const singleAudit = Focus.audit([{ name: 'Home', slug: 'index', html: single }]);
  ok('a single-page site is not asked for aria-current', !singleAudit.findings.some((f) => /current page/.test(f.msg)), JSON.stringify(singleAudit.findings));

  const audit = Focus.audit(pages);
  ok('the export passes the keyboard audit', audit.errors === 0 && audit.warnings === 0, JSON.stringify(audit.findings));
  ok('the audit ignores markup inside scripts', !Focus.audit([{ name: 'S', slug: 'i', html: '<script>var h = "<h1>x</h1><h4>y</h4>";</scr' + 'ipt>' }]).findings.some((f) => /heading level/.test(f.msg)));

  // the audit must still catch a regression, or it proves nothing
  const stripped = home.replace(/<a class="skip-link"[^>]*>[^<]*<\/a>/, '');
  ok('removing the skip link is caught', Focus.audit([{ name: 'Home', slug: 'index', html: stripped }]).findings.some((f) => /skip link/i.test(f.msg)));
  ok('a positive tabindex is caught', Focus.auditPage({ name: 'T', slug: 'i', html: '<div tabindex="5">x</div>' }).findings.some((f) => /tabindex/.test(f.msg)));
}

// ---- 3. share cards -------------------------------------------------------
console.log('\n3. Share cards');
{
  const cards = OgCard.files(mkProject(), [{ slug: 'index', name: 'Home', title: 'Bespoke kitchens' }, { slug: 'about', name: 'About', title: 'Who we are' }]);
  ok('one card per page', cards.length === 2 && cards[0].name === 'og/index.svg' && cards[1].name === 'og/about.svg', cards.map((c) => c.name).join(','));
  ok('each card also names its raster', cards[0].raster === 'og/index.png' && cards[1].raster === 'og/about.png', cards.map((c) => c.raster).join(','));
  ok('the raster name is the same slug as the source', OgCard.pngName({ slug: 'our-work' }) === 'og/our-work.png');
  ok('a page with no slug still gets a raster name', OgCard.pngName({}) === 'og/page.png');
  const du = OgCard.dataUrl(cards[0].content);
  ok('the card can be handed to a rasteriser as a data URL', du.startsWith('data:image/svg+xml;charset=utf-8,') && du.length > 1000);
  ok('the data URL cannot close the attribute it sits in', !/["'<>]/.test(du.slice(du.indexOf(',') + 1)));
  ok('the card is the size crawlers ask for', /width="1200" height="630"/.test(cards[0].content));
  ok('the card uses the project palette', cards[0].content.includes(OgCard.paletteOf(mkProject()).accent));
  ok('the card is reproducible', OgCard.svg(mkProject(), { slug: 'i', name: 'H', title: 'T' }) === OgCard.svg(mkProject(), { slug: 'i', name: 'H', title: 'T' }));
  ok('a title cannot inject markup', OgCard.svg(mkProject(), { name: 'x', title: '<script>alert(1)</scr' + 'ipt>' }).includes('&lt;script&gt;'));
  ok('a long title is shortened rather than overflowing', OgCard.wrap('a b c d e f g h i j k l', 5, 2).length === 2 && /…$/.test(OgCard.wrap('a b c d e f g h i j k l', 5, 2)[1]));
  ok('longer titles get a smaller size', OgCard.sizeFor('x'.repeat(140)) < OgCard.sizeFor('x'.repeat(20)));

  // Wrapping on a character count could not tell 'WWW' from 'ill', so a title
  // made of wide letters ran off the card and was clipped mid-glyph — visible
  // on every share of that page. Width now decides the break, and the estimate
  // is deliberately conservative because the rasteriser's font is whatever the
  // machine has. These cases are the ones that used to overflow.
  const cardPx = OgCard.W - 176;
  const fitsOnCard = (t, max, start) => {
    const size = OgCard.fitSize(t, cardPx, max, start);
    const lines = OgCard.wrapToWidth(t, size, cardPx, max);
    return { size: size, lines: lines, widest: Math.max.apply(null, lines.map((l) => OgCard.widthOf(l, size))) };
  };
  const wide = fitsOnCard('WWW WWW WWW WWW WWW WWW WWW WWW WWW WWW WWW WWW WWW WWW WWW WWW WWW WWW WWW WWW', 3);
  const wideUnspaced = fitsOnCard('W'.repeat(64), 3);
  const wideWord = fitsOnCard('W'.repeat(30), 3);
  const url = fitsOnCard('https://www.northwind-joinery-and-fitted-bedrooms.example.com/pages/contact-us', 3);
  ok('a title of wide letters still fits the card', wide.widest <= cardPx, wide.widest + ' > ' + cardPx);
  ok('an unbreakable run is cut rather than clipped', wideUnspaced.widest <= cardPx, wideUnspaced.widest + ' > ' + cardPx);
  ok('and says that it was cut', /…$/.test(wideUnspaced.lines[0]));
  ok('a word wider than the card shrinks the type first', wideWord.size < OgCard.sizeFor('W'.repeat(30)), String(wideWord.size));
  ok('a long URL is kept inside the card', url.widest <= cardPx, url.widest + ' > ' + cardPx);
  ok('a single character is not shrunk', OgCard.fitSize('A', cardPx, 3) === 76);
  ok('ordinary prose keeps the size it was given', OgCard.fitSize('Bespoke kitchens, built to last', cardPx, 3) === OgCard.sizeFor('Bespoke kitchens, built to last'));
  ok('the wide letters really are wider than the narrow ones',
    OgCard.widthOf('WWW', 76) > OgCard.widthOf('ill', 76) * 2, OgCard.widthOf('WWW', 76) + ' vs ' + OgCard.widthOf('ill', 76));
  ok('an unknown glyph is assumed wide, not narrow', OgCard.advanceOf('\u00e9') >= 556);
  const subLong = fitsOnCard('W'.repeat(90), 2, 30);
  ok('the sub-line is measured at its own size and also fits', subLong.widest <= cardPx, subLong.widest + ' > ' + cardPx);
  ok('the sub-line keeps its own smaller size when it fits', fitsOnCard('Bespoke kitchens, built to last', 2, 30).size === 30);
  const drawnWide = OgCard.svg(mkProject(), { slug: 'i', name: 'H', title: 'W'.repeat(64) });
  ok('the drawn card carries the shrunk size, not the original', !/font-size="76"/.test(drawnWide), (drawnWide.match(/font-size="\d+"/g) || []).join(','));
  ok('and the card still declares its own dimensions', /width="1200" height="630"/.test(drawnWide));
  ok('a missing palette still produces a card', OgCard.svg({ site: {} }, { name: 'x', title: 'y' }).includes('<svg'));
  ok('a card with no title still validates', /<title>/.test(OgCard.svg(mkProject(), {})));

  // The reference is the PNG, not the SVG: X, WhatsApp and LinkedIn ignore an
  // SVG share image, so a card referenced as .svg is one nobody ever sees.
  ok('the export head references the generated card as a raster', /<meta property="og:image" content="https:\/\/northwind\.example\/og\/index\.png">/.test(home), (home.match(/og:image" content="[^"]*"/) || [''])[0]);
  ok('and Twitter is given the same raster', /twitter:image" content="https:\/\/northwind\.example\/og\/index\.png"/.test(home));
  ok('the head no longer points at the SVG', !/og\/index\.svg/.test(home));
  ok('the card is announced to Twitter too', /twitter:card" content="summary_large_image"/.test(home));
  ok('card dimensions are declared', /og:image:width" content="1200"/.test(home));
  const chosen = mkProject({ ogImage: 'https://northwind.example/custom.png' });
  const chosenHtml = Builder.buildSiteHTML(chosen, { proExport: true });
  ok('a chosen image still wins', /og:image" content="https:\/\/northwind\.example\/custom\.png"/.test(chosenHtml));
  ok('dimensions are not claimed for an unknown image', !/og:image:width/.test(chosenHtml));
  const noUrl = Builder.buildSiteHTML(mkProject({ url: '' }), { proExport: true });
  ok('with no site URL no card is referenced', !/og:image/.test(noUrl));
}

// ---- 3b. the page may only reference a card that shipped ------------------
// The riskiest part of the raster idea is the quiet failure: rasterising needs
// a canvas, so on a host without one every page would point at a PNG that was
// never written and every share would unfurl blank. Both branches are pinned
// here, with a rasteriser that succeeds and one that cannot.
async function shareCards() {
  console.log('\n3b. Share cards in an export');
  const page = (og) => `<!DOCTYPE html><html><head>\n    <meta property="og:image" content="https://n.example/og/index.${og}">\n    <meta name="twitter:image" content="https://n.example/og/index.${og}">\n</head><body></body></html>`;
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const cardsOf = (p) => OgCard.files(p, [{ slug: 'index', name: 'Home', title: 'Bespoke kitchens' }]);

  // (a) a rasteriser that works
  {
    const files = [{ name: 'index.html', content: page('png') }];
    const res = await OgCard.attach(files, cardsOf(mkProject()), async () => bytes);
    const names = files.map((f) => f.name);
    ok('a working rasteriser ships both containers', names.includes('og/index.svg') && names.includes('og/index.png'), names.join(','));
    ok('the exported PNG is bytes, not text', (files.find((f) => f.name === 'og/index.png') || {}).content === bytes);
    ok('and nothing is rewritten', res.rasterised === true && res.fallback === null);
    ok('the page still points at the raster', /og\/index\.png/.test(files[0].content));
  }

  // (b) a rasteriser that cannot run — the failure that must not be silent
  {
    const files = [{ name: 'index.html', content: page('png') }];
    const res = await OgCard.attach(files, cardsOf(mkProject()), async () => null);
    ok('a missing rasteriser writes no PNG entry', !files.some((f) => /\.png$/.test(f.name)), files.map((f) => f.name).join(','));
    ok('and the source SVG still ships', files.some((f) => f.name === 'og/index.svg'));
    ok('the page is pointed back at the SVG', !/og\/index\.png/.test(files[0].content) && /og\/index\.svg/.test(files[0].content));
    ok('and Twitter is moved with it', /twitter:image" content="https:\/\/n\.example\/og\/index\.svg"/.test(files[0].content));
    ok('the fallback is handed back for later files', typeof res.fallback === 'function' && res.rasterised === false);
    // A page written after the attempt — the 404 — must move too.
    const late = { name: '404.html', content: page('png') };
    res.fallback([late]);
    ok('a page written after the attempt is rewritten as well', /og\/index\.svg/.test(late.content), late.content);
  }

  // (c) a rasteriser that throws is the same as one that cannot run
  {
    const files = [{ name: 'index.html', content: page('png') }];
    const res = await OgCard.attach(files, cardsOf(mkProject()), async () => { throw new Error('tainted canvas'); });
    ok('a rasteriser that throws falls back instead of failing the export', res.rasterised === false && /og\/index\.svg/.test(files[0].content));
  }

  // (d) one failure among several cards moves all of them
  {
    const files = [];
    const many = OgCard.files(mkProject(), [{ slug: 'index', name: 'Home' }, { slug: 'about', name: 'About' }]);
    let n = 0;
    const res = await OgCard.attach(files, many, async () => (n++ === 0 ? bytes : null));
    ok('a single failed card falls back for the whole site', res.rasterised === false);
    ok('and only the card that worked keeps its raster', files.filter((f) => /\.png$/.test(f.name)).length === 1, files.map((f) => f.name).join(','));
    ok('both SVG sources are still written', files.filter((f) => /\.svg$/.test(f.name)).length === 2);
  }

  // (e) the rewrite is narrow: it moves the card and nothing else
  {
    const src = 'a https://n.example/og/hero.png b images/og/photo.png c https://n.example/sub/og/x-1.png d https://n.example/og/x.png?v=2'
      + ' e https://n.example/og/photo.jpg f <img src="https://n.example/og/hero.png" alt="">';
    const out = OgCard.stripRasterRefs(src);
    ok('a card reference is moved to the SVG', out.indexOf('https://n.example/og/hero.svg') > 0 && out.indexOf('https://n.example/sub/og/x-1.svg') > 0, out);
    ok('a client\'s own image in their own og folder is left alone', out.indexOf('images/og/photo.png') > 0, out);
    ok('a relative path is not mistaken for a card', out.indexOf(' b images/og/photo.png') > 0, out);
    ok('another raster format is not touched', out.indexOf('/og/photo.jpg') > 0, out);
    ok('a query string is preserved rather than corrupted', out.indexOf('https://n.example/og/x.svg?v=2') > 0, out);
    ok('every occurrence in the page is moved, not just the first', out.split('https://n.example/og/hero.svg').length === 3, out);
  }

  // (f) no cards at all is not a failure
  {
    const files = [{ name: 'index.html', content: page('png') }];
    const res = await OgCard.attach(files, [], async () => bytes);
    ok('a site with no pages to card leaves the export alone', res.rasterised === true && files.length === 1);
  }

  // (g) a card nothing references is not worth shipping. Measured on a real
  // export: a site with no domain set carried half a megabyte of PNGs that no
  // page pointed at.
  {
    ok('a card is shipped when there is a live URL', OgCard.needed(mkProject(), {}) === true);
    ok('no live URL means no card', OgCard.needed(mkProject({ url: '' }), {}) === false);
    ok('a project with its own share image needs no card', OgCard.needed(mkProject({ ogImage: 'https://n.example/mine.png' }), {}) === false);
    ok('metadata switched off means no card', OgCard.needed(mkProject(), { exportMeta: false }) === false);
    ok('a whitespace URL is not a URL', OgCard.needed(mkProject({ url: '   ' }), {}) === false);
    const proj = mkProject();
    proj.site.url = 'https://northwind.example';
    ok('and the condition matches what the page actually writes',
      OgCard.needed(proj, {}) === /<meta property="og:image"/.test(Builder.buildSiteHTML(proj, { proExport: true })));
    const noUrl = mkProject({ url: '' });
    ok('the two agree on the negative too',
      OgCard.needed(noUrl, {}) === /<meta property="og:image"/.test(Builder.buildSiteHTML(noUrl, { proExport: true })));
  }
}

// ---- 4. 404 and host files ------------------------------------------------
console.log('\n4. 404 page and host files');
{
  const render = (p, s) => Builder.buildSiteHTML(p, s);
  const page = NotFound.html(mkProject(), render, {});
  ok('a 404 page is produced', page.length > 1000);
  ok('it wears the site\'s own navigation', /<nav\b/.test(page));
  ok('it wears the palette', page.includes(OgCard.paletteOf(mkProject()).bg));
  ok('it keeps the keyboard affordances', page.includes('skip-link'));
  ok('it is excluded from search results', /name="robots" content="noindex/.test(page));
  ok('it offers a way back to the home page', /index\.html/.test(page));
  ok('it never becomes the site\'s share card', !/og:image/.test(page.slice(0, page.indexOf('</head>'))));

  const files = NotFound.files(mkProject(), render, {});
  const names = files.map((f) => f.name);
  ok('the host files are all produced', names.includes('404.html') && names.includes('_headers') && names.includes('_redirects') && names.includes('.nojekyll'), names.join(','));
  ok('the redirect rule points at the 404', /\/404\.html\s+404/.test(NotFound.redirects()));

  const headers = NotFound.headers(mkProject());
  ok('security headers are emitted', /X-Content-Type-Options: nosniff/.test(headers) && /Referrer-Policy/.test(headers));
  ok('the CSP forbids object embedding', /object-src 'none'/.test(headers));
  ok('the CSP does not permit eval', !/unsafe-eval/.test(headers));
  ok('the CSP names the form endpoints the export uses', /form-action[^;]*formspree\.io/.test(headers));
  ok('the CSP confines framed content to the embeds the builder emits', /frame-src[^;]*youtube/.test(headers));
  ok('headers are valid text with no markup', !/[<>]/.test(headers));
}

// ---- 5. the dead Contact link ---------------------------------------------
console.log('\n5. The dead Contact link (regression)');
{
  // A site with no contact section used to fall back to `#sec-contact-<n>`,
  // an index that names a DIFFERENT section's id. The nav item a prospect is
  // most likely to click did nothing at all.
  const noContact = mkProject({ pages: [], sections: [{ type: 'hero', title: 'H' }, { type: 'gallery', title: 'G', items: [{ title: 'a', text: '' }] }] });
  const html = Builder.buildSiteHTML(noContact, { proExport: true });
  ok('no contact section produces no dead anchor', !/#sec-contact-\d/.test(html), (html.match(/#sec-contact-\d/g) || []).join(','));
  ok('it falls back to the site email instead', /href="mailto:hi@northwind\.example"/.test(html));

  const noEmail = mkProject({ pages: [], email: '', sections: [{ type: 'hero', title: 'H' }, { type: 'gallery', title: 'G', items: [{ title: 'a', text: '' }] }] });
  const html2 = Builder.buildSiteHTML(noEmail, { proExport: true });
  ok('with no email it falls back to the top of the page', !/#sec-contact-\d/.test(html2) && /href="#top"/.test(html2));

  // and a real contact section still works. A single-page project keeps its
  // content in `site.sections`, so both have to be set — the earlier version
  // of this test cleared `pages` and left `sections` unset, which meant the
  // fixture had no sections at all and proved nothing.
  const withContact = Builder.buildSiteHTML(mkProject({
    pages: [],
    sections: [{ type: 'hero', title: 'H' }, { type: 'gallery', title: 'G', items: [{ title: 'a', text: '' }] }, { type: 'contact', title: 'Talk' }]
  }), { proExport: true });
  ok('a real contact section is still linked', /#sec-contact-2/.test(withContact) && /id="sec-contact-2"/.test(withContact));
  ok('a contact section on a multi-page site is still linked', /#sec-contact-2/.test(home));
}

// The share-card branches are async, so the verdict is printed from here.
shareCards().then(() => {
  console.log('\n' + (failed === 0 ? 'EXPORT POLISH PASSED' : 'EXPORT POLISH FAILED: ' + failed));
  process.exit(failed === 0 ? 0 : 1);
}).catch((e) => {
  console.log('\nEXPORT POLISH FAILED: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
