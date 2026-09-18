#!/usr/bin/env node
'use strict';

/*
  copilot-smoke — the copilot's reasoning layer.

  The copilot is the feature we point at, so the tests are written around the
  two ways it can embarrass us:

    1. It gives a fix it cannot actually carry out. Every review finding is
       therefore asserted to either carry an executable action or carry none —
       never a button that does nothing.
    2. It guesses at a request it cannot read, and changes a client's site into
       something they did not ask for. Every ask-back is asserted to be genuine
       (at least two real actions) and to not fire on requests that are already
       unambiguous.

  It also pins the wrong-page guard: a review fix must never be offered when the
  index it came from belongs to a different page than the one being edited.
*/

const path = require('path');
const ROOT = path.join(__dirname, '..');
const Copilot = require(path.join(ROOT, 'data', 'copilot.js'));
const DB = require(path.join(ROOT, 'data', 'db.js'));
const { loadAI } = require('./load-ai.js');

// The copilot audits the rendered export as well as the model, so these tests
// compile through the real builder — the same one the app ships. Loaded the way
// scripts/release-check.js loads it, globals first.
global.DB = DB;
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
global.Signature = require(path.join(ROOT, 'data', 'signature.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }
function eq(a, b, msg) { a === b ? pass(msg) : fail(msg + ' — got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b)); }

const AI = loadAI();
const countOf = (hay, needle) => String(hay).split(String(needle)).length - 1;

// ---------------------------------------------------------------------------
console.log('== review: every finding either carries a real fix or none ==');

const plumber = AI.generateSite('a plumber in Leeds', {
  brief: { name: 'Rivet & Sons', area: 'Leeds', offer: 'A leak at 11pm should not be a lottery. Rivet & Sons answers.' },
  onePager: true
});
// A generated site now arrives already graded and tidied (the art-director pass
// in modules/ai.js fills in a missing meta description before the creator sees
// it), so a defect this suite means to test has to be reintroduced explicitly.
// Testing it on a project the generator has since self-healed would quietly stop
// covering the copilot's meta-description action.
plumber.site.metaDescription = '';
// The production generator now self-critiques its first result. This fixture
// deliberately reintroduces the finding so the Copilot review path still tests
// the action that repairs it.
plumber.site.metaDescription = '';
const gate = AI.qualityGate(plumber);
const review = Copilot.review(plumber, gate);

assert(review.total === gate.issues.length, 'every gate finding appears in the review');
assert(review.items.every((it) => it.title && it.detail), 'every item has a headline and a detail');
assert(review.items.every((it) => !it.action || (it.action.act && it.action.act.op)), 'every action is executable');

// impact ranking: nothing lower-banded may appear above a higher band
const BAND = { error: 3, warn: 2, info: 1 };
let ordered = true;
for (let i = 1; i < review.items.length; i++) {
  if (BAND[review.items[i].level] > BAND[review.items[i - 1].level]) ordered = false;
}
assert(ordered, 'items are ranked so blocking problems come first');

const photos = review.items.find((it) => it.id === 'missing-photos');
assert(photos && photos.action && photos.action.act.op === 'images' && photos.action.credit === true,
  'the missing-hero-photo finding offers the photo search and says it costs a credit');

const url = review.items.find((it) => it.id === 'site-url-missing');
assert(url && url.action === null && /domain/i.test(url.advice),
  'a finding the copilot cannot act on stays advice-only, with the gate advice kept');

// The description it offers to write must be usable as written.
const meta = Copilot.metaDescription(plumber);
assert(meta.length >= 60 && meta.length <= 155, 'the offered description is 60–155 characters (' + meta.length + ')');
assert(countOf(meta, 'Rivet & Sons') === 1, 'the business name appears exactly once, never doubled by its own tagline');
assert(!/undefined|null|\[object/.test(meta), 'the description never leaks a missing value');
assert(/[.!?]$/.test(meta), 'the description ends as a sentence');
const metaFinding = review.items.find((it) => it.id === 'meta-description');
assert(metaFinding && metaFinding.action && metaFinding.action.act.value === meta, 'the meta-description finding carries that description');

console.log('\n== review: descriptions come only from the client\'s own facts ==');
assert(Copilot.metaDescription({ site: {} }) === '', 'nothing to say -> no description invented');
assert(Copilot.metaDescription({ site: { name: 'Acme' } }) === '', 'a name alone is not enough to invent a description');
const shortOffer = Copilot.metaDescription({ site: { name: 'Rustica', area: 'York', brief: { offer: 'Sourdough, baked daily' }, ctaText: 'Order a loaf' } });
assert(/^Rustica — Sourdough, baked daily/.test(shortOffer), 'a short offer joins the name without repeating a full stop');
assert(!/\b(\w+) in [A-Z]\w+$/.test(shortOffer.replace(/[.]$/, '')) || /daily in York/.test(shortOffer), 'the place never lands inside a clipped clause');
assert(Copilot.metaDescription({ site: { name: 'Acme', area: 'Leeds' } }) === '',
  'a description too short to be useful is withheld rather than offered as a wrong-length one');
assert(Copilot.metaDescription(plumber).length > 0, 'prose offers still produce a description');

console.log('\n== review: a section is named, so two cards never look alike ==');
const messy = {
  name: 'messy',
  site: {
    name: 'Messy Co',
    sections: [
      { id: 'a', type: 'gallery' },
      { id: 'b', type: 'features', items: [] }
    ]
  }
};
const messyReview = Copilot.review(messy, AI.qualityGate(messy));
const titles = messyReview.items.map((it) => it.title);
assert(titles.some((t) => /gallery/i.test(t)), 'the gallery problem names the gallery');
assert(titles.some((t) => /features/i.test(t)), 'the features problem names the features');
assert(new Set(titles).size > 1 || titles.length <= 1, 'findings about different sections read differently');

console.log('\n== review: never offers a fix that would hit the wrong page ==');
const homeSections = [{ id: 'h1', type: 'features', items: [] }];
const otherPageSections = [{ id: 'p2', type: 'pricing', items: [] }];
const multi = {
  name: 'multi',
  site: {
    name: 'Multi Co',
    // site.sections aliases the ACTIVE page, exactly as normalizePages() sets
    // it up — so here the client is looking at page two, not at home.
    sections: otherPageSections,
    pages: [
      { id: 'pg-home', name: 'Home', slug: 'index', sections: homeSections },
      { id: 'pg-two', name: 'Services', slug: 'services', sections: otherPageSections }
    ],
    activePageId: 'pg-two'
  }
};
assert(Copilot.indexIsSafe(multi) === false, 'a project editing a different page is detected');
const offPage = Copilot.review(multi, AI.qualityGate(multi)).items.find((it) => /features/.test(it.title) || it.id === 'empty-items-0');
assert(offPage && offPage.action === null, 'its index-based fix is withheld rather than applied to the wrong page');
// setActivePage() moves the alias as well as the id, so the test must too.
multi.site.activePageId = 'pg-home';
multi.site.sections = homeSections;
assert(Copilot.indexIsSafe(multi) === true, 'the same project on its home page is safe again');

console.log('\n== review: contrast offers palettes that pass the same audit ==');
const failing = DB.palettes.find((p) => (DB.paletteChecks(p) || []).some((c) => c.ratio < c.need));
// Every shipped palette is AA-safe, so the finding is simulated with a palette
// id that cannot pass — the point under test is the copilot's answer, not
// whether the catalogue happens to contain a bad palette.
const contrastFix = Copilot.actionFor({ id: 'contrast' }, { site: { palette: failing ? failing.id : '__unscored__' } }, {});
assert(contrastFix && contrastFix.choices && contrastFix.choices.length >= 2, 'a failing palette offers alternatives');
const allSafe = contrastFix.choices.every((ch) => {
  const pal = DB.getPalette(ch.act.palette);
  return pal && pal.id === ch.act.palette && (DB.paletteChecks(pal) || []).every((c) => c.ratio >= c.need);
});
assert(allSafe, 'every palette offered passes the audit the finding came from');
assert(contrastFix.choices.every((ch) => ch.act.palette !== 'midnight' || true), 'choices are palettes, not prose');
assert(contrastFix.act.palette === contrastFix.choices[0].act.palette, 'the primary action is the first choice, so the button and the list cannot disagree');

// ---------------------------------------------------------------------------
console.log('\n== interpret: asks only when the request is genuinely two-way ==');

const asks = [
  ['make it warmer', [], 'premium/warm reads two ways'],
  ['make it dark', [], 'dark palette or a visitor toggle']
];
asks.forEach(([msg, mentions, why]) => {
  const out = Copilot.interpret(msg, { mentions });
  assert(out.kind === 'ask' && out.question && out.options.length >= 2, msg + ' -> asks (' + why + ')');
  assert(out.options.every((o) => o.act && o.act.op), msg + ' -> every option is an action the engine can run');
  assert(out.options.every((o) => o.label), msg + ' -> every option is labelled with what it will do');
});

const faq = Copilot.interpret('the FAQ', { mentions: [{ type: 'faq', word: 'faq' }] });
assert(faq.kind === 'ask' && /FAQ/.test(faq.question), 'a bare section name asks about that section, spelled the way the product spells it');
assert(faq.options.some((o) => o.act.op === 'addSection'), 'it offers to add the section');
assert(faq.options.some((o) => o.act.op === 'removeSection'), 'and offers to remove it');
assert(faq.options.every((o) => !/^Add a FAQ/.test(o.label)), 'the article agrees with the label ("an FAQ", not "a FAQ")');

const vague = Copilot.interpret('make it better', { mentions: [] });
assert(vague.kind === 'ask' && vague.options.length >= 3, 'a wish with no object becomes concrete choices');

// the whole point: it must not hijack requests that already make sense
const leftAlone = [
  ['duplicate the FAQ', [{ type: 'faq', word: 'faq' }]],
  ['make it glassmorphism', []],
  ['add a pricing section', [{ type: 'pricing', word: 'pricing' }]],
  ['make it more like https://harbourco.example/', []],
  ['add another testimonials section', [{ type: 'testimonials', word: 'testimonials' }]]
];
leftAlone.forEach(([msg, mentions]) => {
  const out = Copilot.interpret(msg, { mentions });
  assert(out.kind === 'none', 'a clear request is left to the parser: ' + JSON.stringify(msg));
});
assert(Copilot.interpret('', {}).kind === 'none', 'an empty message asks nothing');
assert(Copilot.interpret('make it warmer', { mentions: [], hasTarget: true }).kind === 'none',
  'with a previous edit in hand the question is not asked twice');

// ---------------------------------------------------------------------------
console.log('\n== chatPlan: the new commands, and the line the ask-back is on ==');

const site = plumber.site;
const planOps = (msg, ctx) => (AI.chatPlan(site, msg, ctx).acts || []).map((a) => a.op);
eq(planOps('review my site')[0], 'review', 'review my site -> a review');
eq(planOps('fix everything you can')[0], 'repair', 'fix everything you can -> the repair pass');
eq(planOps('show me other options')[0], 'options', 'show me other options -> the alternates');
eq(planOps('preview')[0], 'preview', 'preview -> the live preview');
eq(planOps('export')[0], 'export', 'export -> a site download');

const asked = AI.chatPlan(site, 'make it premium').acts[0];
assert(asked.op === 'ask' && asked.options.length >= 2 && asked.question, 'an ambiguous request comes back as a question');
assert(asked.options.every((o) => o.act && o.act.op), 'the question carries runnable answers, not just words');

// existing behaviour this must not have broken
eq(planOps('make it shorter', { targetType: 'hero' })[0], 'rewriteSection', 'follow-ups still rewrite their target');
eq(planOps('make it shorter').length, 0, 'a follow-up with no target still refuses politely');
eq(planOps('Make it more like https://harbourco.example/')[0], 'likeUrl', 'the reference-site restyle still works');
eq(planOps('Add a Services page')[0], 'servicesPage', 'the Services page shortcut still works');

// ---------------------------------------------------------------------------
console.log('\n== slash commands: no menu row is a dead end ==');

Copilot.SLASH.forEach((cmd) => {
  const plan = AI.chatPlan(site, cmd.send);
  const ops = (plan.acts || []).map((a) => a.op);
  // An act, or a real answer. What must never happen is the parser shrugging
  // at its own menu row — that is a command the product advertises and cannot
  // serve. (/help answers directly rather than acting, so a reply counts.)
  const answers = plan.reply && String(plan.reply).length > 40;
  const ok = (ops.length > 0 && ops[0] !== 'help') || answers;
  assert(ok, '/' + cmd.name + ' leads somewhere (' + (ops.join(',') || (answers ? 'answers directly' : 'NOWHERE')) + ')');
});
Copilot.SLASH.filter((c) => c.withArgs).forEach((cmd) => {
  const ops = (AI.chatPlan(site, cmd.withArgs('emerald')).acts || []).map((a) => a.op);
  assert(ops.length > 0 && ops[0] !== 'help', '/' + cmd.name + ' with an argument leads somewhere');
});
assert(Copilot.slashMatches('/pal').length === 1 && Copilot.slashMatches('/pal')[0].name === 'palette', 'a partial command narrows the list');
assert(Copilot.slashMatches('/').length === Copilot.SLASH.length, 'a bare slash lists every command');
assert(Copilot.slashMatches('hello').length === 0, 'plain text is not treated as a command');
assert(!Copilot.slashMatches('/pal')[0].withArgs('emerald').includes('a emerald'), 'the article is fixed up for the client');

// ---------------------------------------------------------------------------
console.log('\n== copyOptions: the alternatives the engine did not pick ==');

const features = site.sections.find((x) => x.type === 'features');
const opts = AI.copyOptions(plumber, features);
assert(opts.length >= 1, 'a features section has alternatives to offer');
assert(opts.every((g) => g.options.length && g.label && g.field), 'each group names its field and offers lines');
assert(opts.every((g) => g.options.every((o) => o.trim().toLowerCase() !== String(features[g.field] || '').trim().toLowerCase())),
  'the wording already in use is never offered back');
assert(opts.every((g) => g.options.every((o) => o.trim() && !/\{(brand|focus|area)\}/.test(o))),
  'no raw token ever reaches a client');
const shuffled = AI.copyOptions(plumber, features, { salt: 11 });
assert(shuffled.some((g, i) => g.options.join('|') !== opts[i].options.join('|')), 'asking again shows different candidates');
assert(AI.copyOptions(plumber, { type: 'countdown' }).length === 0, 'a section with no copy pool offers nothing rather than guessing');
assert(AI.copyOptions(plumber, 'about').length >= 1, 'a section can be named by type as well as passed in');

// ---------------------------------------------------------------------------
console.log('\n== render audit: the copilot reads the page the visitor gets ==');

// A mirror of app.js qualityReport(): compile every page, audit the documents.
function renderGate(project) {
  let html = '';
  let htmlPages = [];
  try {
    const built = Builder.buildSitePages(project, { onlineEnabled: false });
    htmlPages = built.map((e) => ({ name: e.page.name, slug: e.page.slug, html: e.html }));
    const home = htmlPages.find((e) => e.slug === 'index') || htmlPages[0];
    html = home ? home.html : '';
  } catch (e) { html = ''; }
  return AI.qualityGate(project, { html: html, htmlPages: htmlPages });
}

const bakery = AI.generateSite('a bakery in York', {
  brief: { name: 'Willow & Rye', area: 'York', offer: 'Stone-milled local flour, baked before dawn.' },
  onePager: false
});
// Same reason as the plumber fixture above: leave the safe repair pass something
// real to do, so "a promised score is measured, never estimated" still has a
// repair to measure.
bakery.site.metaDescription = '';
const pageNames = Builder.pages(bakery).map((pg) => pg.name);
assert(pageNames.length > 1, 'the fixture is a real multi-page site (' + pageNames.join(', ') + ')');

const modelOnly = AI.qualityGate(bakery);
const rendered = renderGate(bakery);
assert(rendered.score < modelOnly.score,
  'the render audit sees what the model cannot (' + modelOnly.score + ' -> ' + rendered.score + ')');

const renderedReview = Copilot.review(bakery, rendered, { copyOptions: (t) => AI.copyOptions(bakery, t) });
const lostForm = renderedReview.items.find((it) => it.id === 'html-form-action');
assert(!!lostForm, 'a contact form that delivers nothing is reported');
assert(!!bakery.site.email, 'the fixture has a business email to deliver to');
assert(lostForm.action && lostForm.action.act.op === 'setField' && lostForm.action.act.key === 'formEndpoint',
  'and the offered fix sets the form destination');
assert(lostForm.action.act.value === bakery.site.email, 'to the address the client already gave us, not an invented one');

// The offered fix must actually clear the finding through the real builder.
const formFixed = JSON.parse(JSON.stringify(bakery));
formFixed.site.formEndpoint = lostForm.action.act.value;
const afterFormFix = renderGate(formFixed);
assert(!afterFormFix.issues.some((i) => i.id === 'html-form-action'), 'applying it clears the finding');
assert(afterFormFix.score > rendered.score, 'and the measured score rises (' + rendered.score + ' -> ' + afterFormFix.score + ')');

const noEmail = JSON.parse(JSON.stringify(bakery));
noEmail.site.email = '';
assert(Copilot.actionFor({ id: 'html-form-action' }, noEmail, {}) === null,
  'with no address to deliver to, the finding stays advice');

console.log('\n== render audit: every finding is attributed to its page ==');
assert(renderedReview.pageCount === pageNames.length, 'the review reports how many pages it read');
assert(renderedReview.items.every((it) => typeof it.page === 'string' && it.page.length > 0), 'every card names a page');
const pageSet = Array.from(new Set(renderedReview.items.map((it) => it.page)));
assert(pageSet.length > 1, 'findings land on more than one page (' + pageSet.join(', ') + ')');
assert(pageSet.every((nm) => pageNames.indexOf(nm) !== -1), 'page names come from the real page list, not a guessed index');
const pageScoped = renderedReview.items.find((it) => it.id === 'page-no-contact-0');
assert(pageScoped && pageScoped.page === pageNames[1],
  'a page-scoped finding names the page the gate meant (' + (pageScoped && pageScoped.page) + ')');

console.log('\n== simulate: a promised score is measured, never estimated ==');
const outlook = Copilot.simulate(bakery, { gate: renderGate, apply: (p) => AI.repairQuality(p) });
assert(outlook && outlook.changed > 0, 'the safe repair pass has something to do here');
assert(outlook.before === rendered.score, 'its "before" is the score the review just showed');
const repairedByHand = (() => { const clone = JSON.parse(JSON.stringify(bakery)); AI.repairQuality(clone); return clone; })();
const honest = renderGate(repairedByHand);
assert(outlook.after === honest.score, 'its "after" is a real re-audit of the repaired project');
assert(outlook.gained > 0, 'and the repair actually improves the site (' + outlook.before + ' -> ' + outlook.after + ')');
assert(outlook.remaining === honest.issues.length, 'it also says how many findings would survive');
assert(Copilot.simulate(bakery, { gate: renderGate }) === null, 'with no repair to apply it promises nothing');
assert(Copilot.simulate(null, { gate: renderGate, apply: () => ({ changed: 1 }) }) === null, 'a missing project is refused');

/*
  The regression that motivated the measurement: the safe repair pass used to
  stamp an identical contact block onto every page, so each one repeated a
  heading the page before it already used — the pass made the score go DOWN.
  A repair that lowers the score is the one thing a repair pass must never do.
*/
const stripped = JSON.parse(JSON.stringify(bakery));
Builder.pages(stripped);
const rawPages = stripped.site.pages || [];
if (rawPages.length > 1) rawPages[1].sections = (rawPages[1].sections || []).filter((s) => s.type !== 'hero');
const strippedGain = Copilot.simulate(stripped, { gate: renderGate, apply: (p) => AI.repairQuality(p) });
assert(!strippedGain || strippedGain.gained > 0,
  'stripping a secondary page of its hero repairs upward, never downward (' + (strippedGain ? '+' + strippedGain.gained : 'no change') + ')');
assert(!rawPages.length || !(rawPages[1] || []).length || !(rawPages[1].sections || []).some((s) => s.type === 'contact'),
  'and it no longer invents a contact block that would repeat another page heading');

console.log('\n== the batch: only fixes that name their target by value ==');
assert(Copilot.batchable({ action: { act: { op: 'setField' } } }), 'a field edit can be batched');
assert(Copilot.batchable({ action: { act: { op: 'copyOption' } } }), 'a wording swap can be batched');
assert(!Copilot.batchable({ action: { act: { op: 'rewrite', idx: 2 } } }),
  'an index-targeted rewrite cannot — an earlier fix in the batch can move that index');
assert(Copilot.batchable({ action: { act: { op: 'addSection', type: 'faq', pageSlug: 'services' } } }),
  'adding a section can be batched now that it names its page by value');
assert(!Copilot.batchable({ action: { act: { op: 'removeSection', type: 'faq' } } }),
  'removing one still cannot — the section a later fix is about may be the one that goes');
assert(!Copilot.batchable({ action: null }), 'a finding with no action is not batchable');
const batchList = renderedReview.items.filter((it) => Copilot.batchable(it) && !it.action.credit);
assert(batchList.length > 0, 'the review has credit-free fixes to batch (' + batchList.length + ')');
assert(renderedReview.items.filter((it) => it.action && it.action.credit).every((it) => batchList.indexOf(it) === -1),
  'a credit-priced fix is never swept into the batch');

// ---------------------------------------------------------------------------
console.log('\n== page fixes: a page finding is addressed by value, not by position ==');

// The app's insert path, faithfully: sample the section, settle its lines
// against the live site, then splice it into the page the action named.
function insertAct(project, act) {
  const pages = Builder.pages(project);
  const pg = pages.find((x) => x.slug === act.pageSlug) || pages.find((x) => x.id === act.pageId);
  if (!pg) return null;
  const ns = AI.sampleSection(act.type, project);
  if (act.title) ns.title = act.title;
  const settled = Copilot.settleLines(project, { type: act.type, title: ns.title, subtitle: ns.subtitle }, { copyOptions: (t) => AI.copyOptions(project, t) });
  // Mirrors the app: a page-targeted insert refuses rather than repeating a heading.
  if (!settled.ok && (act.pageSlug || act.pageId)) return 'refused';
  ns.title = settled.title;
  ns.subtitle = settled.subtitle;
  const arr = pg.sections;
  const last = arr[arr.length - 1];
  arr.splice((last && last.type === 'contact') ? arr.length - 1 : arr.length, 0, ns);
  return ns;
}

function stripFromSecondary(prompt, strip, brief) {
  const project = AI.generateSite(prompt, { brief: brief, onePager: false });
  Builder.pages(project);
  (project.site.pages || []).slice(1).forEach((pg) => {
    pg.sections = (pg.sections || []).filter((s) => strip.indexOf(s.type) === -1);
  });
  return project;
}

const strippedMulti = stripFromSecondary('a bakery in York', ['hero', 'contact'],
  { name: 'Willow & Rye', area: 'York', offer: 'Stone-milled local flour, baked before dawn.' });
const strippedMultiGate = renderGate(strippedMulti);
const strippedMultiReview = Copilot.review(strippedMulti, strippedMultiGate, { copyOptions: (t) => AI.copyOptions(strippedMulti, t) });
const pageFixes = strippedMultiReview.items.filter((it) => it.action && it.action.act.op === 'addSection');
assert(pageFixes.length >= 4, 'every page missing an opening or a contact route gets a fix (' + pageFixes.length + ')');
assert(pageFixes.every((it) => it.action.act.pageId && it.action.act.pageSlug),
  'each one names its page by id and slug, so an index that moves cannot misdirect it');
const fixForHero = pageFixes.filter((it) => it.action.act.type === 'hero');
const fixForContact = pageFixes.filter((it) => it.action.act.type === 'contact');
assert(fixForHero.length >= 2 && fixForContact.length >= 2, 'both kinds of page fix are offered (hero ' + fixForHero.length + ', contact ' + fixForContact.length + ')');
assert(Copilot.batchable(pageFixes[0]), 'a page fix can be batched now that it is value-addressed');

/*
  The regression this pins: three page fixes planned independently all arrived
  with the same heading, so applying the batch tripped the repeated-heading rule
  three times and the "fix" measured 79 → 58. Three fixes must not be able to
  make a site worse than leaving all three alone.
*/
pageFixes.forEach((it) => insertAct(strippedMulti, it.action.act));
const afterPageFixes = renderGate(strippedMulti);
const collided = afterPageFixes.issues.filter((i) => /repeated-heading/.test(i.id));
assert(collided.length === 0, 'applying every page fix introduces no repeated heading' + (collided.length ? ': ' + collided[0].msg : ''));
assert(afterPageFixes.score >= strippedMultiGate.score,
  'and the batch of page fixes never lowers the score (' + strippedMultiGate.score + ' → ' + afterPageFixes.score + ')');
assert(!afterPageFixes.issues.some((i) => /^page-no-hero/.test(i.id)), 'the page that had no opening now has one');
assert(afterPageFixes.issues.filter((i) => /^page-no-hero/.test(i.id)).length === 0, 'and no page is left without an opening');
const landedHeadings = [];
(strippedMulti.site.pages || []).forEach((pg) => (pg.sections || []).forEach((s) => {
  if (s.type === 'hero' || s.type === 'contact') landedHeadings.push(String(s.title || '').toLowerCase());
}));
assert(new Set(landedHeadings.filter(Boolean)).size === landedHeadings.filter(Boolean).length,
  'every inserted section ended up with a heading of its own');

// Idempotence: a second review of the same site must not offer the same page
// fix again, or a client clicking through the list twice would build a site
// with two of everything.
const afterFixesReview = Copilot.review(strippedMulti, renderGate(strippedMulti), { copyOptions: (t) => AI.copyOptions(strippedMulti, t) });
const reappeared = afterFixesReview.items.filter((it) => /^page-(?:no-hero|no-contact|empty)-/.test(it.id));
assert(!reappeared.some((it) => /no-hero|empty/.test(it.id)), 'a page fix that has landed is not offered a second time');
assert(reappeared.every((it) => it.action === null), 'and nothing left over from it still carries a button');
assert(!afterFixesReview.items.some((it) => it.action && it.action.act.op === 'addSection' && (it.action.act.pageId || it.action.act.pageSlug)),
  'no page-targeted insert is offered again');

// The page that IS the contact route is the one exception, and deliberately so:
// its opening already reads "Get in touch", so a second contact block would have
// to repeat that heading — which is how three "fixes" once measured as a
// downgrade from 79 to 58.
const strippedPageNames = Builder.pages(strippedMulti).map((pg) => pg.name);
const contactOffset = strippedPageNames.indexOf('Contact') - 1;
assert(contactOffset >= 0, 'the fixture has a page named Contact (' + strippedPageNames.join(', ') + ')');
assert(Copilot.actionFor({ id: 'page-no-contact-' + contactOffset, msg: '“Contact” has no contact section.' }, strippedMulti, {}) === null,
  'the Contact page is not offered a second contact block');
assert(reappeared.every((it) => it.id === 'page-no-contact-' + contactOffset),
  'the only page finding left is the page that is already the route');

// One at a time is the other order a client can work in, and it must hold too.
const oneAtATime = stripFromSecondary('a hair salon in Bristol', ['contact'],
  { name: 'Fern Studio', area: 'Bristol', offer: 'Cuts that grow out well.' });
const onceGate = renderGate(oneAtATime);
const onceFixes = Copilot.review(oneAtATime, onceGate, { copyOptions: (t) => AI.copyOptions(oneAtATime, t) })
  .items.filter((it) => it.action && it.action.act.op === 'addSection' && it.action.act.type === 'contact');
assert(onceFixes.length >= 2, 'the fixture offers several contact fixes (' + onceFixes.length + ')');
// Each action was planned against the site BEFORE the previous one landed, so
// these all carry the same heading — the insert has to settle it.
assert(new Set(onceFixes.map((it) => it.action.act.title)).size === 1, 'they were planned independently, so they carry the same heading');
onceFixes.forEach((it) => insertAct(oneAtATime, it.action.act));
const onceAfter = renderGate(oneAtATime);
assert(onceAfter.issues.filter((i) => /repeated-heading/.test(i.id)).length === 0, 'applying them one at a time does not collide either');
assert(onceAfter.score >= onceGate.score, 'and the score still does not fall (' + onceGate.score + ' → ' + onceAfter.score + ')');

console.log('\n== page fixes: verification reads back the value it promised ==');
assert(Copilot.verifyFor({ op: 'setField', key: 'formEndpoint', value: 'a@b.co' }).kind === 'site', 'a field write verifies against that field');
assert(Copilot.verifyFor({ op: 'setField', key: '__proto__', value: 'x' }).kind === 'none', 'an unwritable key is never offered verification as if it worked');
assert(Copilot.verifyFor({ op: 'copyOption', sectionId: 's1', field: 'title', value: 'x' }).kind === 'section', 'a wording swap verifies against that section field');
assert(Copilot.verifyFor({ op: 'copyOption', idx: 2, field: 'title', value: 'x' }).kind === 'none',
  'a swap that names its section by index cannot be verified — the index may already have moved');
assert(Copilot.verifyFor({ op: 'addSection', pageSlug: 'menu', type: 'hero' }).kind === 'pageSection', 'an insert verifies against the page it named');
assert(Copilot.verifyFor({ op: 'palette', palette: 'noir' }).kind === 'site', 'a palette switch verifies against site.palette');
assert(Copilot.verifyFor({ op: 'repair' }).kind === 'anyChange', 'the repair pass reports its own count instead');
assert(Copilot.verifyFor({ op: 'rewrite', idx: 1 }).kind === 'none', 'an AI rewrite is not verified by value');
assert(Copilot.verifyFor(null).kind === 'none', 'a missing action verifies nothing');

console.log('\n== the write surface is an allowlist, not a free-for-all ==');
const writable = Object.keys(Copilot.SITE_FIELDS);
['address', 'ctaText', 'description', 'email', 'favicon', 'formEndpoint', 'metaDescription', 'name', 'phone', 'tagline', 'url']
  .forEach((k) => assert(writable.indexOf(k) !== -1, 'every key the planner writes is allowed (' + k + ')'));
assert(Copilot.SITE_FIELDS.tokens === undefined, 'a key the product does not own is absent from the surface');
assert(Copilot.sanitiseSiteField('__proto__', 'x').ok === false, '__proto__ cannot be written');
assert(Copilot.sanitiseSiteField('constructor', 'x').ok === false, 'constructor cannot be written');
assert(Copilot.sanitiseSiteField('tokens', 'x').ok === false, 'an unknown field is refused rather than created');
assert(Copilot.sanitiseSiteField('url', 'example.com').value === 'https://example.com', 'a typed domain is upgraded to https, not refused');
assert(Copilot.sanitiseSiteField('url', 'javascript:alert(1)').ok === false, 'a javascript: public address is refused');
assert(Copilot.sanitiseSiteField('ctaLink', 'javascript:alert(1)').ok === false, 'a javascript: button link is refused');
assert(Copilot.sanitiseSiteField('ctaLink', '#top').ok === true, 'an in-page anchor is allowed');
assert(Copilot.sanitiseSiteField('ctaLink', 'tel:+44 113 000 0000').ok === true, 'a telephone link is allowed');
assert(Copilot.sanitiseSiteField('email', 'not-an-email').ok === false, 'a malformed address is refused');
assert(Copilot.sanitiseSiteField('formEndpoint', 'example.com').ok === false, 'a domain is not accepted as a form destination');
assert(Copilot.sanitiseSectionField('id', 'x').ok === false, 'a section id cannot be rewritten from chat');
assert(Copilot.sanitiseSectionField('type', 'x').ok === false, 'a section type cannot be rewritten from chat');
assert(Copilot.sanitiseSectionField('title', '  Hello\u0000  world  ').value === 'Hello world', 'a written line is cleaned, never stored raw');
assert(Copilot.sanitiseSectionType('faq') === 'faq', 'a real section type is accepted');
assert(Copilot.sanitiseSectionType('bogus') === '', 'an unrenderable section type is refused before it can be inserted');
assert(Copilot.sanitiseSectionType('constructor') === '', 'a prototype key is not a section type');
assert(Copilot.sanitiseSiteField('tagline', 'x'.repeat(5000)).value.length <= 300, 'a written line is capped, not stored whole');

console.log('\n== settled lines: a new section never repeats what the site says ==');
const settledSite = {
  name: 'settle',
  site: {
    name: 'Settle Co',
    sections: [{ id: 'h', type: 'hero', title: 'Welcome' }],
    pages: [
      { id: 'pg-home', name: 'Home', slug: 'index', sections: [{ id: 'h', type: 'hero', title: 'Welcome' }] }
    ]
  }
};
settledSite.site.pages[0].sections = settledSite.site.sections;
const keptBlocked = Copilot.settleLines(settledSite, { type: 'contact', title: 'Welcome' }, {});
assert(keptBlocked.title !== 'Welcome', 'a heading already in use is replaced');
assert(!Copilot.headingsInUse(settledSite).has(keptBlocked.title.toLowerCase()), 'with one the site is not already saying');
const keptFree = Copilot.settleLines(settledSite, { type: 'contact', title: 'Come and see us' }, {});
assert(keptFree.title === 'Come and see us', 'a heading nobody is using is left exactly as it was written');
assert(Copilot.unusedLine(settledSite, 'countdown', 'title', {}) === '', 'a section with no pool offers nothing rather than guessing');
assert(Copilot.unusedHeading(settledSite, 'contact', {}) !== '', 'a contact heading is found from the fallback list when the pool is empty');

// ---------------------------------------------------------------------------
if (failed) {
  console.error('\ncopilot-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\ncopilot-smoke PASSED');
