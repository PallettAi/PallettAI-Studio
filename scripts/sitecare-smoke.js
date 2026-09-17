// ============================================================
// Site care smoke test — the report that keeps a site from going stale.
//
// This module's whole value is its judgement, so the tests are about what it
// REFUSES to flag as much as what it catches. A maintenance report that cries
// wolf is a report nobody opens, so pinned here:
//
//   1. Every placeholder and sample-detail pattern actually fires.
//   2. Content that is legitimately old is left alone — "Est. 1998" with no
//      money attached, a future event, this year's price.
//   3. A clean site scores 100 and says so, rather than inventing work.
//   4. The clock moves: dated content shortens the review window.
//
// Run: node scripts/sitecare-smoke.js
// ============================================================
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

// DB is what tells site care how many rows the renderer substitutes for a
// section with none — the product's own declaration rather than a guess.
const DB = require(path.join(ROOT, 'data', 'db.js'));
global.DB = DB;
const SiteCare = require(path.join(ROOT, 'data', 'sitecare.js'));

const NOW = '2026-09-15T12:00:00.000Z';
const proj = (sections, site) => ({
  id: 'p1', name: 'Northwind Joinery',
  site: Object.assign({ name: 'Northwind Joinery', sections: sections || [] }, site || {})
});

const areas = (rep) => rep.findings.map((f) => f.area);
const messages = (rep) => rep.findings.map((f) => f.msg).join(' | ');

// ---- 1. unfinished copy ---------------------------------------------------
console.log('\n1. Copy that was never finished');
{
  const cases = [
    ['hero', 'Lorem ipsum dolor sit amet'],
    ['features', 'Sample text goes here'],
    ['about', 'Dummy text for the layout'],
    ['cta', 'Your company name goes here'],
    ['contact', 'We will be in touch — TBC'],
    ['faq', 'The answer is TBD'],
    ['blog', 'TODO: write the first post'],
    ['stats', 'FIXME before launch'],
    ['gallery', 'xxxxxxxx'],
    ['table', 'Double-click to edit']
  ];
  cases.forEach(([type, text]) => {
    const rep = SiteCare.audit(proj([{ id: 's1', type: type, title: type, text: text }]), { now: NOW });
    ok('"' + text + '" is caught', rep.findings.some((f) => f.area === 'placeholder'), messages(rep));
  });

  // items are where copy hides — the walk has to reach inside them
  const inItems = SiteCare.audit(proj([{ id: 's', type: 'features', title: 'Real title', items: [{ title: 'Ok', text: 'Lorem ipsum here' }] }]), { now: NOW });
  ok('placeholder text inside an item is caught', inItems.findings.some((f) => f.area === 'placeholder'), messages(inItems));
  ok('the finding names the item it is in', /item 1/.test(messages(inItems)), messages(inItems));

  // the most specific phrase wins, so the report reads like English
  const specific = SiteCare.audit(proj([{ id: 's', type: 'hero', title: 'Lorem ipsum dolor' }]), { now: NOW });
  ok('"lorem ipsum" is named as lorem ipsum', /lorem ipsum filler text/.test(messages(specific)), messages(specific));
}

// ---- 2. our own sample details --------------------------------------------
console.log('\n2. Template sample details');
{
  const cases = [
    'Email us at hello@example.com',
    'Call 555-0100 any time',
    'We are at 101 Market Street',
    'Visit 123 Fake Road',
    'Write to you@studio.com'
  ];
  cases.forEach((text) => {
    const rep = SiteCare.audit(proj([{ id: 's', type: 'contact', title: 'Contact', text: text }]), { now: NOW });
    ok('"' + text + '" is caught', rep.findings.some((f) => f.area === 'demo'), messages(rep));
  });
  const siteEmail = SiteCare.audit(proj([], { email: 'hello@example.com' }), { now: NOW });
  ok('a sample site email is caught', siteEmail.findings.some((f) => f.area === 'demo' && /site email/.test(f.msg)), messages(siteEmail));
  const sitePhone = SiteCare.audit(proj([], { phone: '(555) 010-0100' }), { now: NOW });
  ok('a sample site phone is caught', sitePhone.findings.some((f) => f.area === 'demo' && /phone/.test(f.msg)), messages(sitePhone));

  const real = SiteCare.audit(proj([{ id: 's', type: 'contact', title: 'Contact', text: 'Email studio@northwindjoinery.co.uk or call 0113 496 0000.' }]), { now: NOW });
  ok('a real email and number are left alone', !real.findings.some((f) => f.area === 'demo'), messages(real));

  // Our own shipped default, found in the wild: a real project had it in the
  // contact block, which means a client's enquiries were addressed nowhere.
  const ours = SiteCare.audit(proj([], { email: 'hello@pallettai.org' }), { now: NOW });
  ok('our own default inbox is caught', ours.findings.some((f) => f.area === 'demo' && /default inbox/.test(f.msg)), messages(ours));
}

// ---- 3. dates -------------------------------------------------------------
console.log('\n3. Dates that have been and gone');
{
  const past = SiteCare.audit(proj([{ id: 's', type: 'events', title: 'Open day', extra: '2026-05-04' }]), { now: NOW });
  ok('a past event date is caught', past.findings.some((f) => f.area === 'expired'), messages(past));
  ok('the past date is quoted back', /2026-05-04/.test(messages(past)), messages(past));

  const pastCountdown = SiteCare.audit(proj([{ id: 's', type: 'countdown', title: 'Launch', extra: '2025-01-01' }]), { now: NOW });
  ok('an expired countdown is caught', pastCountdown.findings.some((f) => f.area === 'expired'), messages(pastCountdown));

  const future = SiteCare.audit(proj([{ id: 's', type: 'events', title: 'Open day', extra: '2027-01-15' }]), { now: NOW });
  ok('a future date is not flagged', !future.findings.some((f) => f.area === 'expired'), messages(future));

  const today = SiteCare.audit(proj([{ id: 's', type: 'events', title: 'Open day', extra: '2026-09-15' }]), { now: NOW });
  ok('a date of today is not yet expired', !today.findings.some((f) => f.area === 'expired'), messages(today));

  const money = SiteCare.audit(proj([{ id: 's', type: 'pricing', title: 'From £249 in 2024' }]), { now: NOW });
  ok('last year\'s price is caught', money.findings.some((f) => f.area === 'stale'), messages(money));
  const money2 = SiteCare.audit(proj([{ id: 's', type: 'cta', title: '50% off this autumn — offer valid 2023' }]), { now: NOW });
  ok('an out-of-date offer is caught', money2.findings.some((f) => f.area === 'stale'), messages(money2));

  const founded = SiteCare.audit(proj([{ id: 's', type: 'about', title: 'Est. 1998 in Leeds' }]), { now: NOW });
  ok('a founding year with no money attached is left alone', !founded.findings.some((f) => f.area === 'stale'), messages(founded));

  const thisYear = SiteCare.audit(proj([{ id: 's', type: 'pricing', title: 'From £249, valid 2026' }]), { now: NOW });
  ok('this year\'s price is left alone', !thisYear.findings.some((f) => f.area === 'stale'), messages(thisYear));

  // A year is only a stale PRICE when the same sentence states a figure. The
  // word list this check used to match — price, offer, valid, from — is ordinary
  // English far more often than it is money, and both of these were reported as
  // old offers on a real project read in the browser:
  //
  //   "Book before 2025-12-20 for the Christmas price."     the year was read
  //                                                          out of the date
  //                                                          that had already
  //                                                          been reported, so
  //                                                          one line of copy
  //                                                          produced two warn-
  //                                                          ings and lost 10
  //                                                          points
  //   "We have been trading since 2024 from our workshop."   'from' is a
  //                                                          preposition here
  const prose = SiteCare.audit(proj([{ id: 's', type: 'about', text: 'Book before 2025-12-20 for the Christmas price.' }]), { now: NOW });
  ok('the word "price" beside a date is not a stale price', !prose.findings.some((f) => f.area === 'stale'), messages(prose));
  ok('and that one sentence yields exactly one finding', prose.findings.length === 1, messages(prose));
  ok('the date itself is still caught', prose.findings.some((f) => f.area === 'expired'), messages(prose));

  const since = SiteCare.audit(proj([{ id: 's', type: 'about', text: 'We have been trading since 2024 from our workshop in Digbeth.' }]), { now: NOW });
  ok('the word "from" on its own is not money', !since.findings.some((f) => f.area === 'stale'), messages(since));

  // The figures that DO mean money still have to fire, including the ones with
  // no currency symbol in them.
  const figure = SiteCare.audit(proj([{ id: 's', type: 'pricing', title: 'A full set is £249 during 2024' }]), { now: NOW });
  ok('a currency figure beside a past year is still caught', figure.findings.some((f) => f.area === 'stale'), messages(figure));
  const written = SiteCare.audit(proj([{ id: 's', type: 'pricing', title: 'Two hundred pounds in 2024' }]), { now: NOW });
  ok('a written amount still counts as money', written.findings.some((f) => f.area === 'stale'), messages(written));
  const datedPrice = SiteCare.audit(proj([{ id: 's', type: 'pricing', text: 'Our 2024-01-01 list: a full set is £249' }]), { now: NOW });
  ok('a figure beside a date is reported as the date, not as a stale year',
    datedPrice.findings.filter((f) => f.area === 'stale').length === 0 && datedPrice.findings.some((f) => f.area === 'expired'),
    messages(datedPrice));
}

// ---- 4. structure ---------------------------------------------------------
console.log('\n4. Structure');
{
  // A section type whose renderer supplies samples when it has none of its own
  // is not "empty" — it is showing content that is not the client's, which is
  // both truer and more useful to say.
  const samples = SiteCare.audit(proj([{ id: 's1', type: 'features' }]), { now: NOW });
  ok('an unconfigured section is reported as showing samples', samples.findings.some((f) => f.area === 'template'), messages(samples));
  ok('the sample count comes from the product, not a guess', /3 template samples/.test(messages(samples)), messages(samples));

  const onlyTitle = SiteCare.audit(proj([{ id: 's1', type: 'pricing', title: 'Our prices' }]), { now: NOW });
  ok('a heading with no rows still shows the invented tiers', onlyTitle.findings.some((f) => f.area === 'template'), messages(onlyTitle));

  const hasItems = SiteCare.audit(proj([{ id: 's1', type: 'features', items: [{ title: 'Joinery' }] }]), { now: NOW });
  ok('a section with its own items is left alone', hasItems.findings.length === 0, messages(hasItems));

  const photos = SiteCare.audit(proj([{ id: 's1', type: 'gallery', items: [{ image: 'data:image/png;base64,AAA' }] }]), { now: NOW });
  ok('a gallery of uncaptioned photos counts as finished work', !photos.findings.some((f) => f.area === 'template'), messages(photos));

  const blank = SiteCare.audit(proj([{ id: 's1', type: 'about' }]), { now: NOW });
  ok('a type with no renderer samples can still be genuinely empty', blank.findings.some((f) => f.area === 'empty'), messages(blank));

  const hero = SiteCare.audit(proj([{ id: 's1', type: 'hero' }]), { now: NOW });
  ok('an untouched hero is not called empty (it renders the site name)', hero.findings.length === 0, messages(hero));

  const contactFromSite = SiteCare.audit(proj([{ id: 's1', type: 'contact' }], { email: 'studio@northwind.co.uk' }), { now: NOW });
  ok('a contact block drawing from the site is not empty', !contactFromSite.findings.some((f) => f.area === 'empty'), messages(contactFromSite));

  const hasImage = SiteCare.audit(proj([{ id: 's1', type: 'about', image: 'data:image/png;base64,AAA', alt: 'Our workshop' }]), { now: NOW });
  ok('an image-only section is not empty', !hasImage.findings.some((f) => f.area === 'empty'), messages(hasImage));

  const noAlt = SiteCare.audit(proj([{ id: 's1', type: 'about', title: 'About us', image: 'data:image/png;base64,AAA' }]), { now: NOW });
  ok('an image with no alt text is noted', noAlt.findings.some((f) => f.area === 'alt'), messages(noAlt));
  ok('a missing alt is a note, not an error', !noAlt.findings.some((f) => f.area === 'alt' && f.level === 'error'));

  const dead = SiteCare.audit(proj([{ id: 's1', type: 'hero', title: 'Welcome', ctaLink: '#' }]), { now: NOW });
  ok('a "#" button is caught', dead.findings.some((f) => f.area === 'deadlink'), messages(dead));
  const live = SiteCare.audit(proj([{ id: 's1', type: 'hero', title: 'Welcome', ctaLink: 'https://northwind.co.uk/quote' }]), { now: NOW });
  ok('a real button link is left alone', !live.findings.some((f) => f.area === 'deadlink'), messages(live));
  // An absent link field is a section with no button, not a broken link.
  const none = SiteCare.audit(proj([{ id: 's1', type: 'hero', title: 'Welcome' }]), { now: NOW });
  ok('a section with no button is not a dead link', !none.findings.some((f) => f.area === 'deadlink'), messages(none));
  const navDead = SiteCare.audit(proj([], { navLinks: [{ label: 'Shop', href: '#' }] }), { now: NOW });
  ok('a "#" navigation link is caught', navDead.findings.some((f) => f.area === 'deadlink'), messages(navDead));
}

// ---- 5. pages -------------------------------------------------------------
console.log('\n5. Multi-page projects');
{
  const multi = {
    name: 'Northwind', site: {
      name: 'Northwind',
      pages: [
        { id: 'home', name: 'Home', slug: 'index', sections: [{ id: 'a', type: 'hero', title: 'Bespoke kitchens' }] },
        { id: 'about', name: 'About', slug: 'about', sections: [{ id: 'b', type: 'about', title: 'TBC' }] }
      ]
    }
  };
  const rep = SiteCare.audit(multi, { now: NOW });
  ok('every page is walked', rep.pages === 2 && rep.sections === 2, JSON.stringify({ p: rep.pages, s: rep.sections }));
  ok('a finding names the page it is on', /about/.test(messages(rep)), messages(rep));

  const legacy = proj([{ id: 'a', type: 'hero', title: 'Hi' }]);
  ok('a legacy single-page project reads as one page', SiteCare.audit(legacy, { now: NOW }).pages === 1);
  ok('a project with no sections does not crash', SiteCare.audit({ site: {} }, { now: NOW }).sections === 0);
  ok('a null project does not crash', SiteCare.audit(null, { now: NOW }).findings.length === 0);
}

// ---- 6. the score is honest ----------------------------------------------
console.log('\n6. Scoring and the clock');
{
  const clean = SiteCare.audit(proj([
    { id: 'a', type: 'hero', title: 'Bespoke kitchens, built to last', subtitle: 'Get a fixed quote in a day.' },
    { id: 'b', type: 'contact', title: 'Talk to us', text: 'studio@northwindjoinery.co.uk' }
  ]), { now: NOW });
  ok('a clean site scores 100', clean.score === 100, String(clean.score));
  ok('a clean site is graded A+', clean.letter === 'A+', clean.letter);
  ok('a clean site reports clean, not inventing work', clean.findings.length === 0, messages(clean));
  ok('a clean summary says so', /Nothing has gone stale/.test(clean.summary), clean.summary);
  ok('a clean site is not stale', clean.stale === false);

  const dirty = SiteCare.audit(proj([{ id: 'a', type: 'hero', title: 'Lorem ipsum' }]), { now: NOW });
  ok('one error costs 12', dirty.score === 88, String(dirty.score));
  ok('one error is graded A, not A+', dirty.letter === 'A', dirty.letter);
  ok('an erroring site is stale', dirty.stale === true);
  ok('the summary counts the problems', /1 unfinished item/.test(dirty.summary), dirty.summary);
  // "8 worth checking" left the count dangling; the noun is always there now.
  const many = SiteCare.audit(proj([{ id: 'a', type: 'hero', title: 'Lorem ipsum' }, { id: 'b', type: 'pricing', title: 'Prices' }]), { now: NOW });
  ok('a count always comes with its noun', /1 item worth checking/.test(many.summary) && !/\b1 worth checking/.test(many.summary), many.summary);

  const two = SiteCare.audit(proj([
    { id: 'a', type: 'hero', title: 'Lorem ipsum' },
    { id: 'b', type: 'about', title: 'TBC' }
  ]), { now: NOW });
  ok('two errors cost 24', two.score === 76, String(two.score));
  ok('the weights are reported, not hidden', two.weight.error === 12 && two.weight.warn === 5);

  const dated = SiteCare.audit(proj([{ id: 'a', type: 'countdown', title: 'Launch', extra: '2025-01-01' }]), { now: NOW });
  ok('dated content shortens the review window', dated.reviewDays === 14, String(dated.reviewDays));
  ok('the review date is computed, not guessed', dated.reviewBy === '2026-09-29', dated.reviewBy);
  ok('a clean site gets a long review window', clean.reviewDays === 180, String(clean.reviewDays));
  ok('a warning-only site sits between the two', two.reviewDays === 30, String(two.reviewDays));

  ok('the audit is reproducible', SiteCare.audit(proj([{ id: 'a', type: 'hero', title: 'Lorem ipsum' }]), { now: NOW }).score === dirty.score);
  ok('the report identifies itself', dirty.kind === 'pallettai-sitecare');
  ok('the report is JSON-serialisable for the export', (() => { try { JSON.parse(JSON.stringify(dirty)); return true; } catch (e) { return false; } })());
  ok('every finding carries a fix', dirty.findings.every((f) => typeof f.fix === 'string' && f.fix.length > 0));
  ok('every finding is addressable to a section', dirty.findings.every((f) => f.where && f.where.sectionType));
}

// ---- 7. the verdict matches the worst finding ------------------------------
// Read on screen, not in a test: a site at 98/100 with one missing alt
// attribute was told "This site is not ready to hand over: 1 note." — which is
// the crying-wolf failure this module's own header warns against, and it does
// not even parse as a sentence. The strong line belongs to a site that is
// actually unfinished, and only to one.
console.log('\n7. What the summary claims, against what was found');
{
  const notesOnly = SiteCare.audit(proj([
    { id: 'a', type: 'hero', title: 'Bespoke kitchens, built to last', subtitle: 'Get a fixed quote in a day.' },
    { id: 'b', type: 'about', title: 'Our workshop', image: 'data:image/png;base64,AAA' }
  ]), { now: NOW });
  ok('a notes-only site has no errors and no warnings',
    notesOnly.counts.error === 0 && notesOnly.counts.warn === 0 && notesOnly.counts.info === 1, JSON.stringify(notesOnly.counts));
  ok('it is NOT told it is not ready to hand over', !/not ready to hand over/.test(notesOnly.summary), notesOnly.summary);
  ok('and the summary says what it is', /Nothing unfinished/.test(notesOnly.summary) && /1 note/.test(notesOnly.summary), notesOnly.summary);

  const warnOnly = SiteCare.audit(proj([
    { id: 'a', type: 'hero', title: 'Bespoke kitchens, built to last', subtitle: 'Get a fixed quote in a day.' },
    { id: 'b', type: 'pricing', title: 'Our prices' }
  ]), { now: NOW });
  ok('a warnings-only site has no errors', warnOnly.counts.error === 0 && warnOnly.counts.warn >= 1, JSON.stringify(warnOnly.counts));
  ok('it is not told it is not ready either', !/not ready to hand over/.test(warnOnly.summary), warnOnly.summary);
  ok('but it is still told to look before handing over', /worth a look before you hand over/.test(warnOnly.summary), warnOnly.summary);
  ok('and the number it reports is the one it found', warnOnly.summary.indexOf(String(warnOnly.counts.warn) + ' item worth checking') !== -1, warnOnly.summary);

  // The strong verdict is not retired — a site with real unfinished copy keeps
  // it, and says how much.
  const errors = SiteCare.audit(proj([{ id: 'a', type: 'hero', title: 'Lorem ipsum' }]), { now: NOW });
  ok('a site with errors keeps the plain verdict', /This site is not ready to hand over: 1 unfinished item\./.test(errors.summary), errors.summary);

  // Every summary that flags something ends with the review date, in the stable
  // format the engine owns; the view renders its own friendly copy of it as a
  // badge. A clean report keeps the long form instead — it has no clock to set.
  const untouched = SiteCare.audit(proj([
    { id: 'a', type: 'hero', title: 'Bespoke kitchens, built to last', subtitle: 'Get a fixed quote in a day.' },
    { id: 'b', type: 'contact', title: 'Talk to us', text: 'studio@northwindjoinery.co.uk' }
  ]), { now: NOW });
  [notesOnly, warnOnly, errors].forEach((rep, i) => {
    ok('summary ' + i + ' ends with a review date', / Next review \d{4}-\d{2}-\d{2}\.$/.test(rep.summary), rep.summary);
  });
  ok('a clean summary does not claim a verdict it does not have',
    /^Nothing has gone stale\./.test(untouched.summary), untouched.summary);
}

console.log('\n' + (failed === 0 ? 'SITE CARE PASSED' : 'SITE CARE FAILED: ' + failed));
process.exit(failed === 0 ? 0 : 1);
