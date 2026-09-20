// ============================================================
// Personal starters smoke test — a site you can begin again from
//
// The whole promise of a starter is what it LEAVES BEHIND. Its
// failure mode is not a broken feature, it is a client reading
// the previous client's phone number on their own new site — and
// nothing looks empty when that happens, so it is only found by
// the client. That is why most of this suite is about absence:
// no name, no contacts, no domain, no logo, no copy, no photo.
//
// The second half holds the shelf's rules to the tier table, and
// to the app's own wiring, because a feature list that promises
// more than the module allows is a refund.
//
// Run: node scripts/starters-smoke.js
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail !== undefined ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

const S = require(path.join(ROOT, 'data', 'starters.js'));
const PLANS = require(path.join(ROOT, 'data', 'plans.js'));
const Merge = require(path.join(ROOT, 'data', 'library-merge.js'));
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

// A finished client site: two pages, a suite, a look, and every kind of
// client-identifying thing a project can hold.
function clientSite() {
  const pages = [
    {
      id: 'pg-home', name: 'Home', slug: 'index',
      sections: [
        { id: 's1', type: 'hero', layout: 'split', animation: 'fade-up', title: 'Welcome to Willow', text: 'Coffee roasted daily.', image: 'data:image/png;hero', alt: 'Willow shop front', ctaText: 'Visit us', extra: '#contact' },
        { id: 's2', type: 'features', title: 'Why Willow', items: [{ icon: '\u2726', title: 'Fresh', text: 'Roasted here', image: 'data:image/png;bean', alt: 'Beans' }, { icon: '\u25cf', title: 'Local', text: 'Delivered' }] },
        { id: 's3', type: 'contact', title: 'Find us', text: '14 Mill Lane' }
      ]
    },
    {
      id: 'pg-about', name: 'About', slug: 'about',
      sections: [{ id: 's4', type: 'about', layout: 'timeline', title: 'Our story', items: [{ title: '2019', text: 'Opened' }] }]
    }
  ];
  const site = {
    name: 'Willow Cafe', tagline: 'Coffee, roasted daily', eyebrow: 'Since 2019',
    description: 'A cafe', email: 'hi@willow.test', phone: '+44 7700 900000',
    address: '14 Mill Lane, Bristol', url: 'https://willow.test', area: 'Bristol',
    metaDescription: 'Willow Cafe in Bristol', ogImage: 'data:og', logo: 'data:logo',
    formEndpoint: 'hi@willow.test', analyticsId: 'G-ABC123', schemaType: 'CafeOrCoffeeShop',
    socials: [{ icon: 'ig', url: 'https://instagram.com/willowcafe' }],
    palette: 'midnight', font: 'inter', heroLayout: 'split',
    design: { radius: 18, spacing: 88 }, kernel: { name: 'Willow brand', locks: { palette: true } },
    themeToggle: true, navSticky: true, containerWidth: 1140,
    pages: pages, activePageId: 'pg-home'
  };
  site.sections = pages[0].sections;
  return { id: 'p1', name: 'Willow Cafe Site', suites: ['blog'], createdAt: 100, updatedAt: 200, site: site };
}

const clone = (x) => JSON.parse(JSON.stringify(x));
let seq = 0;
const uid = () => 'u' + (++seq);

// ---- 1. what must never travel -------------------------------------------
console.log('\n1. A starter leaves the client behind');
{
  const res = S.fromProject(clientSite(), { name: 'Cafe one-pager', id: 'st1', now: 1000 });
  ok('a project with pages becomes a starter', res.ok === true && res.starter.name === 'Cafe one-pager');
  const st = res.starter;
  const site = st.site;

  ok('no business name', site.name === undefined);
  ['tagline', 'eyebrow', 'description', 'email', 'phone', 'address', 'hours', 'area', 'url',
    'metaDescription', 'ogImage', 'logo', 'formEndpoint', 'whatsapp', 'chatWidget',
    'analyticsId', 'schemaType', 'socials', 'social'].forEach((key) => {
      ok('no ' + key, site[key] === undefined, JSON.stringify(site[key]));
    });
  ok('no form destination anywhere in the starter', JSON.stringify(st).indexOf('hi@willow.test') === -1);
  ok('no domain anywhere in the starter', JSON.stringify(st).indexOf('willow.test') === -1);
  ok('no analytics id anywhere in the starter', JSON.stringify(st).indexOf('G-ABC123') === -1);

  const secs = site.pages[0].sections;
  ok('no section copy', secs.every((s) => s.title === undefined && s.subtitle === undefined && s.text === undefined && s.extra === undefined && s.badge === undefined));
  ok('no section photo', secs[0].image === undefined && secs[0].alt === undefined);
  ok('no card copy', secs[1].items.every((it) => it.title === undefined && it.text === undefined && it.image === undefined && it.alt === undefined));
  ok('the previous client\u2019s words are nowhere in the file', JSON.stringify(st).indexOf('Welcome to Willow') === -1 && JSON.stringify(st).indexOf('Mill Lane') === -1);
}

// ---- 2. what must ------------------------------------------------
console.log('\n2. A starter keeps the shape, and says which mode it is in');
{
  const st = S.fromProject(clientSite(), { name: 'Starter', id: 'st1', now: 1000 }).starter;
  const home = st.site.pages[0];
  ok('the pages survive, in order', st.site.pages.length === 2 && st.site.pages[0].slug === 'index' && st.site.pages[1].slug === 'about');
  ok('the page names survive', home.name === 'Home' && st.site.pages[1].name === 'About');
  ok('the section types and order survive', home.sections.map((s) => s.type).join(',') === 'hero,features,contact');
  ok('the layout choices survive', home.sections[0].layout === 'split' && st.site.pages[1].sections[0].layout === 'timeline');
  ok('the animation survives', home.sections[0].animation === 'fade-up');
  ok('the card count survives, with the icons that are not copy', home.sections[1].items.length === 2 && home.sections[1].items[0].icon === '\u2726');
  ok('the look survives', st.site.palette === 'midnight' && st.site.font === 'inter' && st.site.heroLayout === 'split');
  ok('the design numbers survive', st.site.design.radius === 18 && st.site.design.spacing === 88);
  ok('a locked brand kernel survives', st.site.kernel && st.site.kernel.name === 'Willow brand');
  ok('the suites survive', st.suites.join(',') === 'blog');
  ok('the shelf can describe it without loading it', st.stats.pages === 2 && st.stats.sections === 4 && st.stats.types.join(',') === 'hero,features,contact,about');
  ok('and it is marked as structure-only', st.keepCopy === false);

  const withCopy = S.fromProject(clientSite(), { name: 'Boilerplate', id: 'st2', now: 1000, keepCopy: true }).starter;
  ok('"keep the copy" keeps the wording and the photos', withCopy.site.pages[0].sections[0].title === 'Welcome to Willow' && withCopy.site.pages[0].sections[0].image === 'data:image/png;hero');
  ok('but still never the identity', withCopy.site.name === undefined && withCopy.site.email === undefined && withCopy.site.logo === undefined);
  ok('and it says so', withCopy.keepCopy === true);
}

// ---- 3. starting from one ------------------------------------------------
console.log('\n3. A project built from a starter stands on its own');
{
  const st = S.fromProject(clientSite(), { name: 'Cafe', id: 'st1', now: 1000, keepCopy: true }).starter;
  const frozen = JSON.stringify(st);
  seq = 0;
  const res = S.instantiate(st, { name: 'Northwind Site', id: 'p9', now: 5000, uid: uid });
  ok('it builds a project', res.ok === true && res.project.name === 'Northwind Site');
  ok('with a new id', res.project.id === 'p9');
  ok('stamped now, not when the starter was saved', res.project.createdAt === 5000 && res.project.updatedAt === 5000);
  ok('remembering which starter it came from', res.project.starterId === 'st1');
  ok('carrying the suites', res.project.suites.join(',') === 'blog');
  const pages = res.project.site.pages;
  ok('every page gets a fresh id', pages[0].id !== 'pg-home' && pages[1].id !== 'pg-about' && pages[0].id !== pages[1].id);
  ok('every section gets a fresh id', pages[0].sections.every((s) => s.id.indexOf('u') === 0));
  ok('no two sections share an id', new Set(pages[0].sections.concat(pages[1].sections).map((s) => s.id)).size === 4);
  ok('site.sections stays aliased to the active page', res.project.site.sections === pages[0].sections && res.project.site.activePageId === pages[0].id);
  ok('the name reaches the site, so the editor is not nameless', res.project.site.name === 'Northwind Site');
  ok('the saved starter is not mutated by being used', JSON.stringify(st) === frozen);
  ok('and a second build from it is independent', S.instantiate(st, { name: 'Other', uid: uid }).project.site.pages[0].sections[0].id !== pages[0].sections[0].id);

  const keep = S.instantiate(null, { name: 'x' });
  ok('a missing starter is refused, not half-built', keep.ok === false && /could not be read/.test(keep.error));
}

// ---- 4. the shelf's rules ------------------------------------------------
console.log('\n4. The shelf matches what the plan page sells');
{
  ok('Free keeps none', S.limitFor('free') === 0);
  ok('Pro gets the shelf', S.limitFor('pro') === 24);
  ok('Pro+ gets the same shelf', S.limitFor('proplus') === 24);
  ok('an unknown plan is treated as Free, never as unlimited', S.limitFor('enterprise') === 0 && S.limitFor(undefined) === 0);
  ok('Free is refused with the tier named', S.canSave([], 'free').ok === false && /Pro/.test(S.canSave([], 'free').message));
  ok('an empty shelf on Pro is allowed', S.canSave([], 'pro').ok === true && S.canSave([], 'pro').remaining === 24);
  const full = new Array(24).fill({ name: 'x' });
  ok('a full shelf is refused', S.canSave(full, 'pro').ok === false);
  ok('at the limit the count travels with the refusal', S.canSave(full, 'pro').used === 24 && S.canSave(full, 'pro').limit === 24);
  ok('and the message says what to do', /Remove one/.test(S.canSave(full, 'pro').message));
  ok('the plan table advertises the same number the module enforces', /starters: 24/.test(fs.readFileSync(path.join(ROOT, 'data', 'plans.js'), 'utf8')));
  ok('plans.js is the file we just read', PLANS.plans.some((p) => p.id === 'pro'));

  const shelf = S.report([{ name: 'A', id: 'a', createdAt: 1, site: { pages: [{ slug: 'index', sections: [{ type: 'hero' }] }] } }], 'pro');
  ok('the shelf reports what it holds', shelf.used === 1 && shelf.limit === 24 && shelf.remaining === 23);
  ok('and the tier name, for the copy', shelf.tier === 'Pro');
  ok('a free shelf reports the limit as zero, not as full', S.report([], 'free').atLimit === false);
  const atLimit = S.report(new Array(24).fill({ name: 'A', id: 'a', site: { pages: [{ slug: 'index', sections: [{ type: 'hero' }] }] } }), 'pro');
  ok('a full Pro shelf reports itself as at the limit', atLimit.atLimit === true);
}

// ---- 5. junk in the store ------------------------------------------------
console.log('\n5. Nothing unreadable reaches the editor');
{
  ok('a nameless starter is dropped', S.normalize({ site: { pages: [{ sections: [{ type: 'hero' }] }] } }) === null);
  ok('a starter with no pages is dropped', S.normalize({ name: 'x', site: { pages: [] } }) === null);
  ok('a starter whose pages hold no sections is dropped', S.normalize({ name: 'x', site: { pages: [{ sections: [] }] } }) === null);
  ok('a section that is not a section is dropped', S.normalize({ name: 'x', site: { pages: [{ sections: [null, 'nope', { type: 'hero' }] }] } }).site.pages[0].sections.length === 1);
  ok('a name is cleaned and capped', S.normalize({ name: '  ' + 'A'.repeat(200) + '\n', site: { pages: [{ sections: [{ type: 'hero' }] }] } }).name.length === 60);
  ok('a missing index page is repaired', S.normalize({ name: 'x', site: { pages: [{ slug: 'about', sections: [{ type: 'hero' }] }] } }).site.pages[0].slug === 'index');
  ok('a project with no pages cannot be saved as one', S.fromProject({ id: 'x', site: { pages: [] } }, { name: 'n' }).ok === false);
  ok('nor can a project that is not a project', S.fromProject(null, { name: 'n' }).ok === false);
  ok('an unnamed save still gets a usable name', S.fromProject(clientSite(), { name: '   ', id: 'x', now: 1 }).starter.name === 'Willow Cafe Site');
}

// ---- 6. the wiring ------------------------------------------------------
console.log('\n6. The app uses all of it');
{
  ok('the shelf is hydrated at boot', /await hydrateStarters\(\);/.test(app));
  ok('and persisted under its own key', /starters: 'pallettai\.starters\.v1'/.test(app));
  ok('the save path goes through the tier check', /function openStarterSave\(p\)[\s\S]{0,400}?if \(!shelf\.limit\)/.test(app));
  ok('the cap is enforced where the preset cap was not', /function openStarterSave\(p\)[\s\S]{0,600}?if \(shelf\.atLimit\) return toast/.test(app));
  ok('a project card offers it', /data-start="\$\{p\.id\}"/.test(app));
  // Keep this assertion about the user-facing contract, not the exact number
  // of render calls or the whitespace after them. The Templates view now also
  // renders the blueprint gallery, so a later render call legitimately sits
  // between the shelf and the function's closing brace.
  ok('the shelf is rendered where a project begins', /function renderTemplates\(\)[\s\S]{0,2400}?renderStarters\(\)/.test(app));
  ok('starting from one checks capacity first', /function newFromStarter\(id\)[\s\S]{0,300}?ensureProjectCapacity\(\)/.test(app));
  ok('a starter is listed in the library backup', /\['starters', 'Starters', LS\.starters\]/.test(app));
  ok('and mergeable across two machines', !!Merge.KINDS['pallettai.starters.v1'] && Merge.KINDS['pallettai.starters.v1'].kind === 'list');
}

console.log(failed ? '\n\u2717 ' + failed + ' failed' : '\n\u2713 all starters assertions passed');
process.exit(failed ? 1 : 0);
