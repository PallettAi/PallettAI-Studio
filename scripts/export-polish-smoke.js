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

  // unknown hosts are left alone rather than guessed at
  const unknown = '<img src="https://example.com/photo.png" alt="">';
  ok('an unrecognised host ships untouched', Images.decorate(unknown, 'half') === unknown);

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
  ok('the card is the size crawlers ask for', /width="1200" height="630"/.test(cards[0].content));
  ok('the card uses the project palette', cards[0].content.includes(OgCard.paletteOf(mkProject()).accent));
  ok('the card is reproducible', OgCard.svg(mkProject(), { slug: 'i', name: 'H', title: 'T' }) === OgCard.svg(mkProject(), { slug: 'i', name: 'H', title: 'T' }));
  ok('a title cannot inject markup', OgCard.svg(mkProject(), { name: 'x', title: '<script>alert(1)</scr' + 'ipt>' }).includes('&lt;script&gt;'));
  ok('a long title is shortened rather than overflowing', OgCard.wrap('a b c d e f g h i j k l', 5, 2).length === 2 && /…$/.test(OgCard.wrap('a b c d e f g h i j k l', 5, 2)[1]));
  ok('longer titles get a smaller size', OgCard.sizeFor('x'.repeat(140)) < OgCard.sizeFor('x'.repeat(20)));
  ok('a missing palette still produces a card', OgCard.svg({ site: {} }, { name: 'x', title: 'y' }).includes('<svg'));
  ok('a card with no title still validates', /<title>/.test(OgCard.svg(mkProject(), {})));

  ok('the export head references the generated card', /<meta property="og:image" content="https:\/\/northwind\.example\/og\/index\.svg">/.test(home));
  ok('the card is announced to Twitter too', /twitter:card" content="summary_large_image"/.test(home));
  ok('card dimensions are declared', /og:image:width" content="1200"/.test(home));
  const chosen = mkProject({ ogImage: 'https://northwind.example/custom.png' });
  const chosenHtml = Builder.buildSiteHTML(chosen, { proExport: true });
  ok('a chosen image still wins', /og:image" content="https:\/\/northwind\.example\/custom\.png"/.test(chosenHtml));
  ok('dimensions are not claimed for an unknown image', !/og:image:width/.test(chosenHtml));
  const noUrl = Builder.buildSiteHTML(mkProject({ url: '' }), { proExport: true });
  ok('with no site URL no card is referenced', !/og:image/.test(noUrl));
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

console.log('\n' + (failed === 0 ? 'EXPORT POLISH PASSED' : 'EXPORT POLISH FAILED: ' + failed));
process.exit(failed === 0 ? 0 : 1);
