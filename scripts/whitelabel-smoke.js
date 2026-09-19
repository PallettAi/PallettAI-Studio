// ============================================================
// White-label smoke test — what is left of US in a client's site
//
// Pro+ sells exactly one sentence: "Unbranded exports (no
// studio badge)". Before this file existed that sentence was
// false in places the badge code never looked at — the footer
// signature, the panel a photo-less section draws, and the
// cookie policy's own storage table — all of them visible to
// the client's visitors.
//
// So the suite is built on real exports, not on the scanner's
// own idea of what it finds: the last section builds the pages
// the way the app does and asserts that a Pro+ export contains
// no occurrence of the brand a client could ever see.
//
// Run: node scripts/whitelabel-smoke.js
// ============================================================
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail !== undefined ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

global.Whitelabel = require(path.join(ROOT, 'data', 'whitelabel.js'));
global.DB = require(path.join(ROOT, 'data', 'db.js'));
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
global.Review = require(path.join(ROOT, 'data', 'review.js'));
global.Images = require(path.join(ROOT, 'data', 'images.js'));
global.Focus = require(path.join(ROOT, 'data', 'focus.js'));
global.OgCard = require(path.join(ROOT, 'data', 'ogcard.js'));
global.Legal = require(path.join(ROOT, 'data', 'legal.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));
const W = global.Whitelabel;

const slugOf = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'site';

function site(name, extra) {
  const homely = [
    // No photo anywhere: this is the case that draws the placeholder panels, and
    // it is the common one — a fast turnaround ships before the studio has shots.
    { id: 'hero', type: 'hero', layout: 'split', title: 'Welcome to ' + name },
    { id: 'about', type: 'about', title: 'Our story', text: 'Built by hand.' }
  ];
  const p = {
    id: 'p-' + slugOf(name), name: name + ' Site', suites: [],
    site: Object.assign({
      name: name,
      tagline: 'A tagline of its own',
      email: 'hello@' + slugOf(name) + '.test',
      palette: 'midnight',
      font: 'inter',
      pages: [{ id: 'pg-home', name: 'Home', slug: 'index', sections: homely }],
      activePageId: 'pg-home'
    }, extra || {})
  };
  p.site.sections = p.site.pages[0].sections;
  return p;
}

const built = (project, settings) => Builder.buildSitePages(proj(project), settings)
  .map((e) => ({ name: e.page.name, slug: e.page.slug, html: e.html }));

// Each build gets its own copy: the builder normalizes the project it is given.
const proj = (p) => JSON.parse(JSON.stringify(p));

// ---- 1. the namespace -----------------------------------------------------
console.log('\n1. The storage namespace belongs to the client');
{
  ok('a plain name becomes its own key space', W.storagePrefix(site('Willow Cafe')) === 'willowcafe', W.storagePrefix(site('Willow Cafe')));
  ok('diacritics fold rather than vanish', W.storagePrefix({ site: { name: 'Café Zoë' } }) === 'cafezoe', W.storagePrefix({ site: { name: 'Café Zoë' } }));
  ok('punctuation and case are stripped', W.storagePrefix({ site: { name: 'The Old  Bakery & Co.' } }) === 'theoldbakeryco', W.storagePrefix({ site: { name: 'The Old  Bakery & Co.' } }));
  ok('a site with no name falls back to a neutral word, not to ours', W.storagePrefix({}) === 'site');
  ok('the prefix is capped', W.storagePrefix({ site: { name: 'A'.repeat(80) } }).length === 24);
  const keys = W.storageKeys({ site: { name: 'Willow Cafe' } });
  ok('the theme key names the site', keys.theme === 'willowcafe_theme_', keys.theme);
  ok('the consent key names the site', keys.consent === 'willowcafe_cookies_ok', keys.consent);
  ok('the cart key names the site', keys.cart === 'willowcafe_cart_', keys.cart);
  ok('nothing in the namespace names us', !/pallettai|pai/i.test(Object.values(keys).join(' ')));
  ok('a prefix string is accepted as well as a project', W.storageKeys('northwind').consent === 'northwind_cookies_ok');
}

// ---- 2. the scan ----------------------------------------------------------
console.log('\n2. The scan reads the document, not the intent');
{
  const page = (html) => [{ name: 'Home', slug: 'index', html: html }];

  const pro = W.scan(page('<p class="made-by">Made by PallettAI</p>'), { proExport: true });
  ok('our name in a Pro+ footer is an error, not a note', pro.ok === false && pro.findings[0].level === 'error');
  ok('and it is reported with something to do about it', /Settings/.test(pro.findings[0].fix) && pro.findings[0].fixId === 'signature');
  ok('the count is what a client can see', pro.visibleHits === 1, pro.visibleHits);

  const free = W.scan(page('<p class="made-by">Made by PallettAI</p>'), { proExport: false });
  ok('the same footer on Free is design, not a breach', free.ok === true && free.findings[0].level === 'info');

  const studio = W.scan(page('<p class="made-by">Hearth Studio</p>'), { proExport: true });
  ok('a studio that signs its own work is never accused', studio.ok === true && studio.visibleHits === 0);

  const panel = W.scan(page('<div class="hero-placeholder"><p>Built with PallettAI Studio</p></div>'), { proExport: true });
  ok('the no-photo panel is caught', panel.findings.some((f) => f.id === 'wl-panel' && f.level === 'error'));

  const old = W.scan(page('<script>var k = "pallettai_theme_x";</script>'), { proExport: true });
  ok('an old build\u2019s storage key is reported as a warning', old.findings.some((f) => f.id === 'wl-storage' && f.level === 'warn'));
  ok('a warning does not fail the export it is describing', old.ok === true);

  const stamps = W.scan(page('<html data-pai-build="b1"><style>.pai-bar{}</style>'), { proExport: true });
  ok('tooling markers are information, never an error', stamps.ok === true && stamps.findings[0].level === 'info');
  ok('and they are counted apart from what a client sees', stamps.visibleHits === 0 && stamps.invisibleHits === 1);

  const hostile = W.scan(page('<p class="made-by">PALLETTAI</p>'), { proExport: true });
  ok('the name is matched case-insensitively', hostile.visibleHits === 1, hostile.visibleHits);

  const clean = W.scan(page('<p>Nothing of ours here</p>'), { proExport: true });
  ok('a clean export reports nothing at all', clean.ok === true && clean.findings.length === 0);
  ok('a clean export says so in one line', /nothing of ours/i.test(W.summary(clean)), W.summary(clean));
  ok('and a dirty one counts mentions, not pages', /mention/.test(W.summary(pro)), W.summary(pro));
  ok('an empty list is not a crash', W.scan(null, { proExport: true }).ok === true);
}

// ---- 3. a real Pro+ export ------------------------------------------------
console.log('\n3. A real Pro+ export carries none of it');
{
  const c = site('Willow Cafe');
  const settings = {
    proExport: true, exportMeta: false, refCode: 'AB12CD',
    studioName: 'Hearth Studio', studioUrl: 'https://hearth.studio'
  };
  const pages = built(c, settings);
  const res = W.scan(pages, { proExport: true });
  const all = pages.map((p) => p.html).join('\n');

  ok('the export is clean by the scanner', res.ok === true && res.visibleHits === 0, JSON.stringify(res.brands));
  ok('there is no occurrence of the brand a client could see', !/PallettAI/i.test(all.replace(/data-pai-build="[^"]*"/g, '').replace(/pai-[a-z-]+/g, '')));
  ok('the footer signature is the studio\u2019s own name', /class="made-by">Hearth Studio/.test(all));
  ok('and it points at the studio, not at us', all.indexOf('hearth.studio') !== -1 && all.indexOf('pallettai.org') === -1);
  ok('the no-photo panel keeps the shape but drops the attribution', /hero-placeholder/.test(all) && all.indexOf('Built with PallettAI Studio') === -1);
  ok('the panel says something of the site\u2019s own instead', /A tagline of its own/.test(all));
  // Scoped to the panel on purpose: the ◆ mark also stands in for a logo in the
  // footer, which is the site's own and has nothing to do with our brand.
  const panel = (all.match(/<div class="hero-placeholder"[\s\S]*?<\/div>/) || [''])[0];
  ok('the ◆ mark is gone from the panel', panel.length > 100 && panel.indexOf('\u25c6') === -1);
  ok('the site stores under its own name', all.indexOf('willowcafe_theme_') !== -1);
  ok('so does its consent flag', all.indexOf('willowcafe_cookies_ok') !== -1);

  // The two halves have to agree or the policy lies: the key the script writes
  // must be the key the cookie table discloses.
  const legalKeys = Legal.storageKeysFor(c);
  ok('the policy table and the site script use the same key', all.indexOf(legalKeys.consent) !== -1);
  const cookies = Legal.page(c, { legalPages: true, cookieBanner: true, themeToggle: true }, 'cookies');
  const table = cookies.sections.find((s) => s.type === 'table');
  ok('the cookie policy names the client\u2019s keys', table.rows.map((r) => r[0]).join(',').indexOf(legalKeys.themeGlob) !== -1);
  ok('and never ours', !/pallettai_/i.test(JSON.stringify(table.rows)));
}

// ---- 4. what must NOT change --------------------------------------------
console.log('\n4. Free and Pro still get the attribution they are sold');
{
  const c = site('Willow Cafe');
  const free = built(c, { proExport: false, exportMeta: false });
  const all = free.map((p) => p.html).join('\n');
  ok('a free export still carries the badge', /class="pallettai-badge"/.test(all));
  ok('and the no-photo panel still names us', all.indexOf('Built with PallettAI Studio') !== -1);
  ok('and the footer still defaults to our name', /class="made-by">Made by PallettAI/.test(all));
  ok('the badged export is not reported as broken', W.scan(free, { proExport: false }).ok === true);
  ok('but the neutral storage namespace applies there too', all.indexOf('willowcafe_theme_') !== -1);

  // A signature the studio typed is honoured, whatever it says: this rescues
  // people from a default, it does not overrule a decision. The shipped default
  // is the one string that cannot be told apart from "never touched", so on Pro+
  // it is treated as unset — a studio who wants our name in their footer has to
  // say so in a way that differs from the default.
  const typed = built(c, { proExport: true, exportMeta: false, brandFooterText: 'PallettAI Studio, for Hearth' });
  ok('a signature the studio typed is honoured', /class="made-by">PallettAI Studio, for Hearth/.test(typed[0].html));
  ok('and then the scan reports it, because it is still a breach', W.scan(typed, { proExport: true }).ok === false);
  const exact = built(c, { proExport: true, exportMeta: false, brandFooterText: 'Made by PallettAI' });
  ok('typing the shipped default adds nothing on Pro+', /class="made-by"/.test(exact[0].html) === false);
}

// ---- 5. the footer's own rules -------------------------------------------
console.log('\n5. The signature, when there is no studio name to use');
{
  const c = site('Willow Cafe');
  const none = built(c, { proExport: true, exportMeta: false });
  ok('a Pro+ export with no studio name drops the signature entirely', /class="made-by"/.test(none[0].html) === false);
  ok('rather than falling back to ours', /Made by PallettAI/.test(none[0].html) === false);

  const off = built(c, { proExport: true, exportMeta: false, brandFooter: false });
  ok('the switch still wins when it is off', /class="made-by"/.test(off[0].html) === false);

  const named = built(c, { proExport: true, exportMeta: false, studioName: 'Hearth Studio' });
  ok('a studio name with no site keeps the name and drops the link', /class="made-by">Hearth Studio<\/p>/.test(named[0].html));
}

console.log(failed ? '\n\u2717 ' + failed + ' failed' : '\n\u2713 all white-label assertions passed');
process.exit(failed ? 1 : 0);
