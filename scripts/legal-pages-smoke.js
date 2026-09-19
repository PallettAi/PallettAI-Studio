// ============================================================
// Legal pages & consent smoke test
//
// Two features that make a claim to a visitor, so both are tested on whether
// the claim is TRUE rather than whether the markup exists:
//
//   1. Analytics consent. The cookie banner used to store a flag that nothing
//      read, so Google Analytics set cookies for visitors who had declined or
//      never answered. The suite checks the tag is genuinely held back, that
//      Accept starts it, and that turning the banner off restores the old
//      behaviour on purpose rather than by accident.
//
//   2. Generated legal pages. A privacy policy is only worth having if it
//      describes the site it is attached to, so most of these assertions are
//      NEGATIVE: a policy for a site with no shop must not mention orders, a
//      cookie table must list nothing the export does not set, and a policy
//      must never name a third party the site does not use.
//
// Also covers the four silent integration failures: the pages must reach every
// export route, stay out of the navigation, resolve the contact form to a real
// section, and never be handed a hand-written page's phone number.
//
// Run: node scripts/legal-pages-smoke.js
// ============================================================
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

global.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

const Legal = require(path.join(ROOT, 'data', 'legal.js'));
global.Legal = Legal;
const DB = require(path.join(ROOT, 'data', 'db.js'));
global.DB = DB;
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
global.Review = require(path.join(ROOT, 'data', 'review.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));

// ---- fixtures ---------------------------------------------------------------

// Everything switched on: the "kitchen sink" site, used to prove each clause
// appears when — and only when — its feature is really there.
const richSite = {
  name: 'Rosso & Sons',
  tagline: 'Kitchens and joinery',
  palette: 'midnight', font: 'inter', url: 'https://rosso.example',
  email: 'hi@rosso.example', phone: '01904 000000', address: '1 Fossgate, York', area: 'York',
  formEndpoint: 'https://formspree.io/f/abc',
  chatWidget: { propertyId: 'tawk1' },
  design: { radius: 18, spacing: 96, containerWidth: 1140 },
  pages: [{
    id: 'home', name: 'Home', slug: 'index',
    sections: [
      { type: 'hero', title: 'Kitchens in York', subtitle: 'Joinery since 1994.' },
      { type: 'reviews', title: 'Reviews' },
      { type: 'map', title: 'Find us' },
      { type: 'booking', title: 'Book a visit', bookingProvider: 'calendly' },
      { type: 'video', title: 'Watch', extra: 'https://www.youtube.com/watch?v=x' },
      { type: 'collection', title: 'Work', imageMeta: { source: 'openverse', license: 'cc-by' } },
      { type: 'contact', title: 'Talk to us', text: 'Tell us about your kitchen.' }
    ]
  }]
};

// The opposite: one page, one contact form, nothing else. Its policy must be
// short, and must not borrow clauses from the site above.
const plainSite = {
  name: 'Bramble Bakery',
  palette: 'cream', font: 'inter', url: 'https://bramble.example',
  email: 'hello@bramble.example',
  design: { radius: 12, spacing: 80, containerWidth: 1140 },
  pages: [{
    id: 'home', name: 'Home', slug: 'index',
    sections: [
      { type: 'hero', title: 'Bread, daily', subtitle: 'Baked at 5am.' },
      { type: 'contact', title: 'Say hello', text: 'Ask about a cake.' }
    ]
  }]
};

const project = (site, over) => Object.assign({ id: 'p1', name: site.name, suites: [], site }, over || {});
const rich = project(richSite);
const plain = project(plainSite);

const text = (str) => String(str).replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// ---- 1. off by default, and attaching is non-destructive --------------------

console.log('\n1. Opt-in, and the project is never mutated');
{
  ok('no pages when the setting is off', Legal.pages(rich, {}).length === 0);
  ok('no pages when settings are missing entirely', Legal.pages(rich, undefined).length === 0);
  ok('no footer links when off', Legal.footerLinks({}) === '');
  ok('attach() returns the project untouched when off', Legal.attach(rich, {}) === rich);

  const on = Legal.pages(rich, { legalPages: true });
  ok('three pages when on', on.length === 3);
  ok('slugs are stable filenames', on.map((p) => p.slug).join(',') === 'privacy,cookies,terms');
  ok('every generated page is hidden from the nav', on.every((p) => p.hidden === true));
  ok('every generated page is tagged with its kind', on.every((p) => Legal.KINDS.indexOf(p.legal) !== -1));

  const attached = Legal.attach(rich, { legalPages: true });
  ok('attach() appends without mutating the caller', rich.site.pages.length === 1 && attached.site.pages.length === 4);
  ok('attach() does not mutate the caller\'s page array',
    attached.site.pages !== rich.site.pages && attached.site.pages[0] === rich.site.pages[0]);
  ok('the site object itself is not the same reference', attached.site !== rich.site);

  // A creator who wrote their own privacy page keeps it: the generator must not
  // ship two Privacy Policy files to the same URL.
  const own = { id: 'p2', name: 'X', suites: [], site: Object.assign({}, plainSite, {
    pages: plainSite.pages.concat([{ id: 'own', name: 'Privacy Policy', slug: 'privacy', sections: [] }])
  }) };
  const kept = Legal.attach(own, { legalPages: true }).site.pages;
  ok('an existing privacy page is not duplicated', kept.filter((p) => p.slug === 'privacy').length === 1);
  ok('the creator\'s own privacy page is the one kept', kept.find((p) => p.slug === 'privacy').id === 'own');
  ok('the other two are still added', kept.filter((p) => p.slug === 'cookies' || p.slug === 'terms').length === 2);

  // Single-page projects that keep their sections on site.sections (no pages array).
  const legacySections = plainSite.pages[0].sections;
  const legacy = {
    id: 'p3', name: 'Y', suites: [],
    site: Object.assign({}, plainSite, { pages: undefined, sections: legacySections })
  };
  const legacyAttached = Legal.attach(legacy, { legalPages: true });
  ok('a single-page project still yields four files', legacyAttached.site.pages.length === 4);
  ok('the synthetic Home page delegates to site.sections',
    legacyAttached.site.pages[0].sections === legacySections);
  ok('a single-page project gets no synthetic page of its own',
    legacyAttached.site.pages[0].slug === 'index' && legacyAttached.site.pages[0].id === 'pg-home');
}

// ---- 2. the policy describes THIS site -------------------------------------

console.log('\n2. The clauses follow the configuration, not a template');
{
  const richFx = Legal.facts(rich, {
    legalPages: true, analyticsId: 'G-ABC123', analyticsProvider: 'ga4', cookieBanner: true
  });
  ok('the business is named', richFx.name === 'Rosso & Sons');
  ok('a Google Analytics tag is recognised', richFx.hasAnalytics && richFx.analyticsProvider === 'ga4');
  ok('the form service is named from the endpoint', richFx.forms === 'Formspree');
  ok('the chat widget is spotted', richFx.chatOn === true);
  ok('the booking provider is named', richFx.bookingLabel === 'Calendly');
  ok('an embedded video names its host', richFx.embeds.join(',') === 'YouTube');
  ok('an embedded map is spotted', richFx.hasMap === true);
  ok('an open-licence photo library is spotted', richFx.photoSources.join(',') === 'Openverse');
  ok('a shop suite is spotted', Legal.facts(project(plainSite, { suites: ['shop'] }), {}).shopOn === true);

  const plainFx = Legal.facts(plain, { legalPages: true });
  ok('no analytics without a tag', plainFx.hasAnalytics === false);
  ok('no form provider when posts go nowhere', plainFx.forms === '');
  ok('no chat when none is configured', plainFx.chatOn === false);
  ok('no embeds on a plain site', plainFx.embeds.length === 0);
  ok('no photo libraries on a plain site', plainFx.photoSources.length === 0);

  // The negative assertions: a policy that names a service the site does not
  // use is the failure mode this whole module exists to prevent.
  const richPrivacy = text(JSON.stringify(Legal.clausesFor('privacy', richFx)));
  const plainPrivacy = text(JSON.stringify(Legal.clausesFor('privacy', plainFx)));
  ['Google Analytics', 'Formspree', 'Tawk.to', 'Calendly', 'Google Maps', 'YouTube', 'Openverse']
    .forEach((n) => ok('the rich policy names ' + n, richPrivacy.indexOf(n) !== -1));
  ['Google Analytics', 'Formspree', 'Tawk.to', 'Calendly', 'Google Maps', 'YouTube', 'Openverse',
    'basket', 'Order records']
    .forEach((n) => ok('the plain policy does NOT claim ' + n, plainPrivacy.indexOf(n) === -1));

  // Plausible is cookieless, so its wording must not promise a consent gate.
  const plaus = Legal.facts(rich, { legalPages: true, analyticsId: 'rosso.example', analyticsProvider: 'plausible' });
  const plausText = text(JSON.stringify(Legal.storageRows(plaus)) + JSON.stringify(Legal.clausesFor('cookies', plaus)));
  ok('Plausible is named as the provider', plausText.indexOf('Plausible') !== -1);
  ok('a cookieless provider sets no analytics cookies', plausText.indexOf('_ga') === -1);
  ok('the consent banner is not required for a cookieless provider', plausText.indexOf('nothing to decline') !== -1);

  // Names reach the document as text, not as markup.
  const hostile = project(Object.assign({}, plainSite, { name: '<script>alert(1)</script>Bakery' }));
  const hostileHtml = Builder.buildSitePages(hostile, { legalPages: true, proExport: true })
    .map((e) => e.html).join('\n');
  ok('a hostile business name does not become live markup', hostileHtml.indexOf('<script>alert(1)</script>') === -1);
  ok('a hostile business name is still reported', hostileHtml.indexOf('alert(1)') !== -1);
}

// ---- 3. the cookie table lists only what the export sets -------------------

console.log('\n3. The cookie table is a fact, not a list of common cookies');
{
  const rows = (site, settings) => Legal.storageRows(Legal.facts(site, settings));
  const names = (r) => r.map((x) => x[0]).join(',');
  // The keys the export actually writes, from the same function the builder
  // uses. Derived from the SITE'S name: this table is printed on the client's
  // own cookie policy, so the studio's tooling has no business in it.
  const pk = Legal.storageKeysFor(plain);
  const rk = Legal.storageKeysFor(rich);

  // The theme toggle defaults ON in the Studio and really does write
  // <site>_theme_<project>, so the only genuinely storage-free site is one
  // with the toggle, the banner, the shop and analytics all off.
  const bareSite = project(Object.assign({}, plainSite, { themeToggle: false }));
  const bare = rows(bareSite, { legalPages: true });
  ok('a site that stores nothing says so', bare.length === 1 && bare[0][1] === 'None');
  ok('the empty table still has one honest row, not zero', bare[0][0] === '\u2014');

  ok('the theme toggle is listed by default, because it is on by default',
    names(rows(plain, { legalPages: true })).indexOf(pk.themeGlob) !== -1);
  ok('the storage is named after the client, not us', pk.themeGlob === 'bramblebakery_theme_*', pk.themeGlob);
  ok('the consent key is named after the client too', pk.consent === 'bramblebakery_cookies_ok', pk.consent);
  ok('the theme toggle is dropped when the site turns it off',
    names(rows(bareSite, { legalPages: true })).indexOf('theme') === -1);

  const ga = rows(rich, { legalPages: true, analyticsId: 'G-1', analyticsProvider: 'ga4', cookieBanner: true });
  ok('the consent flag is listed when the banner is on', names(ga).indexOf(rk.consent) !== -1);
  ok('GA4 cookies are listed', names(ga).indexOf('_ga') !== -1 && names(ga).indexOf('_ga_*') !== -1);
  const gaNoBanner = rows(rich, { legalPages: true, analyticsId: 'G-1', analyticsProvider: 'ga4' });
  ok('the consent flag is NOT listed when no banner asks for it',
    names(gaNoBanner).indexOf(rk.consent) === -1);
  ok('no policy table anywhere names the tool', !/pallettai_/i.test(names(ga) + names(gaNoBanner) + names(rows(rich, { legalPages: true, cookieBanner: true }))));
  ok('GA4 cookies are still listed with no banner', names(gaNoBanner).indexOf('_ga') !== -1);

  const shop = rows(project(plainSite, { suites: ['shop'] }), { legalPages: true });
  ok('the basket storage appears once a shop is added', names(shop).indexOf(pk.cartGlob) !== -1);
  ok('the basket key is the client\u2019s namespace as well', pk.cartGlob === 'bramblebakery_cart_*', pk.cartGlob);

  ok('every row is a 4-column entry',
    [bare, ga, shop].every((set) => set.every((r) => Array.isArray(r) && r.length === 4)));
  ok('every row explains why it exists', ga.concat(shop).every((r) => String(r[2] || '').length > 10));
}

// ---- 4. the pages reach every export route ---------------------------------

console.log('\n4. Every export route carries the pages');
{
  const settings = { legalPages: true, proExport: true, analyticsId: 'G-ABC123', cookieBanner: true };
  const built = Builder.buildSitePages(rich, settings);
  const slugs = built.map((e) => e.page.slug);
  ok('buildSitePages emits the legal files', ['privacy', 'cookies', 'terms'].every((s) => slugs.indexOf(s) !== -1));

  const privacy = built.find((e) => e.page.slug === 'privacy').html;
  const cookies = built.find((e) => e.page.slug === 'cookies').html;
  const home = built.find((e) => e.page.slug === 'index').html;

  ok('the privacy page renders as a real document', /<html[\s>]/i.test(privacy) && /<\/html>/i.test(privacy));
  ok('it carries the site\'s own stylesheet', privacy.indexOf('<style>') !== -1);
  ok('it carries the site\'s own navigation', privacy.indexOf('class="nav') !== -1 || privacy.indexOf('<nav') !== -1);
  ok('it is titled with the business name', privacy.indexOf('Rosso &amp; Sons') !== -1 || privacy.indexOf('Rosso & Sons') !== -1);
  ok('the cookie page renders its table', cookies.indexOf('<table>') !== -1);
  ok('the cookie table names the real cookies', cookies.indexOf('_ga') !== -1);

  ok('the provenance note is in the source', privacy.indexOf('Generated by PallettAI Studio') !== -1);
  ok('the note is a comment, not visible copy', /<!--\s*Generated by PallettAI Studio/.test(privacy));
  ok('the note survives minification',
    Builder.buildSitePages(plain, { legalPages: true, minify: true })
      .find((e) => e.page.slug === 'privacy').html.indexOf('Generated by PallettAI Studio') !== -1);

  ok('the home page links all three pages', ['privacy.html', 'cookies.html', 'terms.html']
    .every((h) => home.indexOf(h) !== -1));
  ok('the legal pages link each other too', ['privacy.html', 'cookies.html', 'terms.html']
    .every((h) => cookies.indexOf(h) !== -1));

  // Hidden, not absent: linked from the footer, never in the nav.
  const navOnly = home.slice(home.indexOf('<nav'), home.indexOf('</nav>') === -1 ? undefined : home.indexOf('</nav>'));
  ok('no legal page appears in the main navigation',
    navOnly.indexOf('privacy.html') === -1 && navOnly.indexOf('terms.html') === -1);

  // The contact form must still post to the real contact section, and the nav's
  // Contact link must not be captured by the contact block on a legal page.
  // The legal pages carry their own "questions about this page" contact block,
  // so the risk is a SECOND form host, not a form — a policy that names
  // Formspree while the page posts somewhere else is the lie to catch.
  ok('the home page still posts its enquiry form', home.indexOf('formspree.io') !== -1);
  // The endpoint lives in one place — the page config — so the risk is a legal
  // page inventing a DIFFERENT delivery host rather than reusing this one.
  const wrongHost = /web3forms\.com|formsubmit\.co|getform\.io|netlify\/functions/i;
  ok('every page carries the one configured endpoint', built.every((e) => e.html.indexOf('formspree.io/f/abc') !== -1));
  ok('no page invents a second form provider', built.every((e) => !wrongHost.test(e.html)));
  ok('the policy names that same service', text(privacy).indexOf('Formspree') !== -1);
  ok('the legal pages own enquiry form is a real form, not a dead link',
    privacy.indexOf('data-contact') !== -1);

  const extras = Builder.seoExtras(rich, settings);
  const map = extras.find((f) => f.name === 'sitemap.xml');
  ok('a sitemap is produced when the site has a URL', !!map);
  ok('the sitemap lists the legal URLs', ['privacy.html', 'cookies.html', 'terms.html']
    .every((s) => map.content.indexOf(s) !== -1));

  const noLegal = Builder.buildSitePages(rich, { proExport: true });
  ok('with the feature off the export is unchanged', noLegal.length === 1);
  ok('with the feature off no footer links are emitted', noLegal[0].html.indexOf('privacy.html') === -1);
  ok('with the feature off the sitemap carries no legal URLs',
    Builder.seoExtras(rich, { proExport: true }).find((f) => f.name === 'sitemap.xml')
      .content.indexOf('privacy.html') === -1);
}

// ---- 5. consent really gates analytics -------------------------------------

console.log('\n5. Analytics waits for consent, and only then');
{
  const page = (settings) => Builder.buildSitePages(plain, Object.assign({ proExport: true }, settings))[0].html;

  const gated = page({ analyticsId: 'G-ABC123', cookieBanner: true });
  ok('with the banner on, no eager gtag script tag is shipped',
    gated.indexOf('<script async src="https://www.googletagmanager.com/gtag/js') === -1);
  ok('with the banner on, no dataLayer is created up front', gated.indexOf('dataLayer=window.dataLayer||[];function') === -1);
  ok('the tag is held behind a starter the banner can call', gated.indexOf('__paiAnalytics') !== -1);
  ok('the starter reads the stored consent answer', gated.indexOf('localStorage.getItem(' + JSON.stringify(Legal.storageKeysFor(plain).consent) + ')') !== -1);
  ok('and the key it reads belongs to the client, not us', gated.indexOf('pallettai_') === -1);
  ok('the tag is only built from the configured id', gated.indexOf('G-ABC123') !== -1);
  ok('the loader runs once, not per click', gated.indexOf('if(on)return;on=true') !== -1);
  ok('an already-accepted visitor still gets analytics', gated.indexOf("==='1'") !== -1);

  const banner = gated.indexOf('cookie-banner');
  ok('the banner is built in the exported page', banner !== -1);
  ok('Accept starts analytics', gated.indexOf("remember('1')") !== -1 && gated.indexOf('window.__paiAnalytics()') !== -1);
  ok('Decline records a real answer', gated.indexOf("remember('0')") !== -1);
  ok('a remembered answer is not asked again', gated.indexOf("choice !== '1' && choice !== '0'") !== -1);
  ok('Decline never starts analytics', !/remember\('0'\)[\s\S]{0,120}__paiAnalytics\(\)/.test(gated));

  const bannerOff = page({ analyticsId: 'G-ABC123', cookieBanner: false });
  ok('with the banner off analytics loads eagerly, as before',
    bannerOff.indexOf('https://www.googletagmanager.com/gtag/js') !== -1);
  // The banner's Accept handler references window.__paiAnalytics even when the
  // banner is off — it is source that is never reached. What must be absent is
  // the gate itself, which is the only thing that could withhold the tag.
  ok('with the banner off there is no gate to wait for', bannerOff.indexOf('window.__paiAnalytics=function') === -1);
  ok('with the banner off the tag is not conditionally withheld',
    !/if\(ok\)window\.__paiAnalytics\(\)/.test(bannerOff));

  const noTag = page({ cookieBanner: true });
  ok('with no analytics id nothing is loaded at all', noTag.indexOf('googletagmanager') === -1);
  ok('with no analytics id the banner still asks (and sets nothing)', noTag.indexOf('cookie-banner') !== -1);

  const plaus = page({ analyticsId: 'rosso.example', analyticsProvider: 'plausible', cookieBanner: true });
  ok('Plausible is gated the same way', plaus.indexOf('plausible.io/js/script.js') !== -1 && plaus.indexOf('__paiAnalytics') !== -1);
  ok('Plausible is not loaded twice from the head',
    (plaus.match(/<script[^>]*src="https:\/\/plausible\.io\/js\/script\.js"/g) || []).length === 0);

  // The comment the host can turn into real headers must describe the tag that
  // is actually shipped — a CSP that blocks your own analytics is worse than none.
  ok('the CSP starter allows the analytics host that is used',
    gated.indexOf("script-src 'self' 'unsafe-inline' https://www.googletagmanager.com") !== -1);
  ok('the CSP starter drops the analytics host when there is no tag',
    page({}).indexOf('googletagmanager.com') === -1);

  const notFound = require(path.join(ROOT, 'data', 'notfound.js'));
  const nf = notFound.files(plain, (p, s) => Builder.buildSiteHTML(p, s),
    { settings: { analyticsId: 'G-ABC123', cookieBanner: true } }).map((f) => f.content).join('\n');
  ok('the 404 page allows the analytics host too', nf.indexOf('googletagmanager.com') !== -1);
  ok('the 404 page is not left blocking analytics', !/script-src[^;]*'self'[^;]*;/.test(nf) || nf.indexOf('script-src') === -1
    || nf.indexOf("script-src 'self' 'unsafe-inline' https://www.googletagmanager.com") !== -1);
}

// ---- 6. a legal page is not a dead end -------------------------------------

console.log('\n6. Navigation still resolves from a legal page');
{
  const settings = { legalPages: true, proExport: true };
  const single = Builder.buildSitePages(plain, settings);
  const homeOf = (built) => (built.find((e) => e.page.slug === 'index') || built[0]).html;
  const multiPages = [{ id: 'home', name: 'Home', slug: 'index', sections: plainSite.pages[0].sections },
    { id: 'about', name: 'About', slug: 'about', sections: [{ type: 'about', title: 'Us', text: 'We bake.' }] }];
  const multi = Builder.buildSitePages(
    project(Object.assign({}, plainSite, { pages: multiPages })), settings);

  // Every in-document anchor must have a matching id IN THE SAME DOCUMENT. A
  // single-page site's nav is nothing but anchors, so on a page chosen from a
  // different file none of them resolve and the visitor is stranded.
  const idSet = (html) => new Set((html.match(/\sid="([^"]+)"/g) || [])
    .map((m) => m.replace(/^\s*id="/, '').replace(/"$/, '')));
  const dangling = (html) => {
    const ids = idSet(html);
    return (html.match(/href="#([^"]+)"/g) || [])
      .map((m) => m.slice(7, -1))
      .filter((t) => t && !ids.has(t));
  };
  ok('no page has a link to a section it does not contain',
    single.every((e) => dangling(e.html).length === 0),
    single.map((e) => e.page.slug + ': ' + dangling(e.html).join(',')).filter((s) => !/:\s*$/.test(s)).join(' | '));
  ok('no page of a multi-page site has a dangling anchor either',
    multi.every((e) => dangling(e.html).length === 0));

  const legalPages = single.filter((e) => e.page.legal);
  ok('every legal page can reach the site it belongs to',
    legalPages.every((e) => e.html.indexOf('index.html') !== -1));
  ok('its nav describes the SITE, not the policy it is standing on',
    legalPages.every((e) => e.html.indexOf('index.html#sec-gallery') !== -1
      || e.html.indexOf('index.html#sec-contact') !== -1));
  ok('the nav no longer offers the policy clause list as a destination',
    legalPages.every((e) => !/href="index\.html#sec-features-\d+">What you get/.test(e.html)));
  ok('a multi-page legal page links the site\u2019s real pages',
    multi.filter((e) => e.page.legal).every((e) => e.html.indexOf('about.html') !== -1));

  // A legal page's own contact block is local to that file, so its index must
  // come from its own sections — not the home page's. Reading the index from
  // the wrong model produced `index.html#sec-contact-3` on a home page that has
  // only three sections, i.e. a link off the end of the document.
  const cookies = single.find((e) => e.page.slug === 'cookies').html;
  ok('a legal page renders its own contact block', (cookies.match(/id="sec-contact-\d+"/g) || []).length === 1);

  // Cross-file anchors are the failure this section exists for: `index.html#x`
  // has to resolve on the HOME file, which the per-document check above cannot
  // see because the target lives in another file.
  const homeIds = idSet(homeOf(single));
  const crossFile = [];
  single.filter((e) => e.page.legal).forEach((e) => {
    (e.html.match(/href="index\.html#([^"]+)"/g) || []).forEach((m) => {
      const target = m.slice('href="index.html#'.length, -1);
      if (!homeIds.has(target)) crossFile.push(e.page.slug + ' -> ' + target);
    });
  });
  ok('every link into the home file lands on a section that exists there',
    crossFile.length === 0, crossFile.join(', '));

  // The home page must be untouched by any of this: its own anchors stay bare.
  const home = single.find((e) => e.page.slug === 'index').html;
  ok('the home page still uses bare anchors', home.indexOf('href="#top"') !== -1);
  ok('the home page does not link to itself through index.html',
    !/href="index\.html#/.test(home));
}

console.log('\n' + (failed ? '\u2717 ' + failed + ' failed' : '\u2713 all legal-pages assertions passed'));
process.exit(failed ? 1 : 0);
