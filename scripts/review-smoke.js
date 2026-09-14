// ============================================================
// Client review loop smoke test
//
// The loop only works if three things hold, and all three fail quietly:
//
//   1. The stamp is STABLE for unchanged content and MOVES when content
//      changes. A stamp that drifts on autosave would invalidate live client
//      feedback; a stamp that never moves would make every stale note look
//      current.
//   2. The exported page CARRIES that stamp, and every page of one build
//      agrees on it — otherwise the agency cannot match feedback to a revision.
//   3. A note about a section that no longer exists is KEPT, not dropped.
//      A silently lost client comment is the worst failure this feature has.
//
// Run: node scripts/review-smoke.js
// ============================================================
'use strict';

const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

const DB = require(path.join(ROOT, 'data', 'db.js'));
global.DB = DB;
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
const Review = require(path.join(ROOT, 'data', 'review.js'));
global.Review = Review;
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));

function mkProject() {
  return {
    id: 'rv1',
    name: 'Willow Café',
    site: {
      name: 'Willow Café',
      email: 'studio@example.com',
      tagline: 'Coffee & calm',
      palette: 'midnight',
      font: 'inter',
      heroLayout: 'centered',
      sections: [
        { type: 'hero', title: 'Willow Café', subtitle: 'Coffee & calm' },
        { type: 'features', title: 'Why us', items: [{ title: 'Roasted daily', text: 'Fresh' }] },
        { type: 'pricing', title: 'Membership', items: [{ title: 'Monthly', price: '9' }] }
      ]
    },
    suites: ['animation']
  };
}
const clone = (p) => JSON.parse(JSON.stringify(p));

// ---- 1. the build stamp -------------------------------------------------
console.log('\n1. The build stamp identifies a revision');
{
  const p = mkProject();
  const a = Review.stamp(Builder.pages(p));
  const b = Review.stamp(Builder.pages(clone(p)));
  ok('same content stamps the same', a === b, a + ' vs ' + b);
  ok('stamp is a short token', /^b[a-z0-9]+$/.test(a), a);

  const moved = clone(p);
  moved.site.sections[1].title = 'Why choose us';
  ok('copy change moves the stamp', Review.stamp(Builder.pages(moved)) !== a);

  const reorder = clone(p);
  reorder.site.sections = [reorder.site.sections[0], reorder.site.sections[2], reorder.site.sections[1]];
  ok('reordering sections moves the stamp', Review.stamp(Builder.pages(reorder)) !== a);

  // Volatile bookkeeping must NOT move it, or every autosave would invalidate
  // feedback the client is still writing.
  const churn = clone(p);
  churn.id = 'different-id';
  churn.site.sections[1].id = 'sec-abc';
  churn.site.sections[1].updatedAt = Date.now();
  churn.site.activePageId = 'pg-9';
  ok('bookkeeping churn does NOT move the stamp', Review.stamp(Builder.pages(churn)) === a,
    Review.stamp(Builder.pages(churn)) + ' vs ' + a);

  const noSections = { site: { sections: [] } };
  ok('an empty project still stamps', /^b/.test(Review.stamp(Builder.pages(noSections))));
  ok('a missing project does not throw', typeof Review.stamp(undefined) === 'string');
}

// ---- 2. the export carries it ------------------------------------------
console.log('\n2. Every exported page carries the stamp');
{
  const p = mkProject();
  const single = Builder.buildSiteHTML(p, { onlineEnabled: false });
  const stamp = (single.match(/data-pai-build="([^"]+)"/) || [])[1];
  ok('stamp attribute is on <html>', /<html[^>]*data-pai-build="b[a-z0-9]+"/.test(single), 'not found');
  ok('stamp matches the module', stamp === Review.stamp(Builder.pages(p)));
  ok('feedback address comes from the site email',
    /data-pai-feedback="studio@example\.com"/.test(single));

  const noEmail = mkProject();
  noEmail.site.email = '';
  ok('no feedback address emits no attribute',
    !Builder.buildSiteHTML(noEmail, { onlineEnabled: false }).includes('data-pai-feedback'));

  // Multi-page: one build, one revision, so every page must agree.
  const multi = mkProject();
  multi.site.pages = [
    { name: 'Home', slug: 'index', sections: [{ type: 'hero', title: 'Home' }] },
    { name: 'About', slug: 'about', sections: [{ type: 'hero', title: 'About' }] }
  ];
  const pages = Builder.buildSitePages(multi, { onlineEnabled: false });
  const stamps = pages.map((pg) => (pg.html.match(/data-pai-build="([^"]+)"/) || [])[1]);
  ok('all pages of one build share one stamp', stamps[0] && stamps[0] === stamps[1], stamps.join(' vs '));
  const singlePageStamp = (Builder.buildSiteHTML(multi, { onlineEnabled: false }).match(/data-pai-build="([^"]+)"/) || [])[1];
  ok('adding a page changes the stamp', singlePageStamp !== stamp);
}

// ---- 3. staleness ------------------------------------------------------
console.log('\n3. Staleness is answered, not guessed');
{
  const p = mkProject();
  const live = Review.stamp(Builder.pages(p));
  ok('same build reads as current', Review.staleness({ build: live }, live) === 'current');
  ok('a different build reads as stale', Review.staleness({ build: 'bzzz' }, live) === 'stale');
  ok('no stamp on the review reads as unknown', Review.staleness({}, live) === 'unknown');
  ok('no stamp on the project reads as unknown', Review.staleness({ build: 'bz' }, '') === 'unknown');
  ok('nothing at all does not throw', Review.staleness(null, null) === 'unknown');
}

// ---- 4. parsing a returned file ---------------------------------------
console.log('\n4. A returned file is validated, never trusted');
{
  const p = mkProject();
  const review = Review.create({
    site: 'Willow Café', build: Review.stamp(Builder.pages(p)), at: '2026-01-01T00:00:00Z',
    pages: [{ name: 'Home', slug: 'index', notes: [{ sectionId: 'sec-features-1', text: 'Drop to two features', priority: 'blocker' }] }]
  });
  const good = Review.parse(JSON.stringify(review));
  ok('a real payload parses', good.ok, good.error);
  ok('note count is reported', good.review.count === 1);

  ok('broken JSON is rejected with a readable reason', (/not valid JSON/).test(Review.parse('{oops').error));
  ok('someone else\u2019s JSON is rejected', (/not a PallettAI review file/).test(Review.parse('{"kind":"other"}').error));
  ok('an empty review is rejected', (/no comments/).test(Review.parse(JSON.stringify({ kind: 'pallettai-review', pages: [] })).error));
  ok('a file with no notes is rejected',
    (/no comments/).test(Review.parse(JSON.stringify({ kind: 'pallettai-review', pages: [{ notes: [] }] })).error));
  ok('null does not throw', Review.parse(null).ok === false);
  ok('a number does not throw', Review.parse(42).ok === false);

  const huge = Review.parse(JSON.stringify({
    kind: 'pallettai-review',
    pages: [{ slug: 'index', notes: [{ sectionId: 'sec-hero-0', text: 'x'.repeat(5000) }] }]
  }));
  ok('an over-long note is clipped, not rejected', huge.ok && huge.review.pages[0].notes[0].text.length === Review.MAX_TEXT);

  const blank = Review.parse(JSON.stringify({
    kind: 'pallettai-review',
    pages: [{ slug: 'index', notes: [{ sectionId: 'sec-hero-0', text: '   ' }] }]
  }));
  ok('a whitespace-only note is dropped', !blank.ok);

  const flood = Review.parse(JSON.stringify({
    kind: 'pallettai-review',
    pages: [{ slug: 'index', notes: Array.from({ length: 900 }, (_, i) => ({ sectionId: 'sec-hero-0', text: 'n' + i })) }]
  }));
  ok('a flood of notes is capped', flood.review.pages[0].notes.length === Review.MAX_NOTES);
}

// ---- 5. attaching notes to the live project ---------------------------
console.log('\n5. Notes land on the right section, and none are lost');
{
  const p = mkProject();
  const pages = Builder.pages(p);
  const review = {
    build: Review.stamp(pages), site: 'Willow',
    pages: [{
      name: 'Home', slug: pages[0].slug,
      notes: [
        { id: 'n1', sectionId: 'sec-features-1', sectionType: 'features', heading: 'Why us', text: 'Two features please' },
        { id: 'n2', sectionId: 'sec-pricing-2', sectionType: 'pricing', heading: 'Membership', text: 'Show annual' },
        { id: 'n3', sectionId: 'sec-gallery-7', sectionType: 'gallery', heading: 'Old gallery', text: 'Fix spacing' }
      ]
    }]
  };
  const attached = Review.attach(review, pages);
  ok('every note is returned', attached.length === 3, 'got ' + attached.length);
  ok('a live section resolves to its index', attached[0].found && attached[0].sectionIndex === 1);
  ok('headings resolve from the live section', attached[0].heading === 'Why us');
  ok('a second note resolves independently', attached[1].found && attached[1].sectionIndex === 2);
  // The important one: a section the agency has since deleted must not swallow
  // the client's comment.
  ok('a removed section is flagged, not dropped', attached[2].found === false && attached[2].sectionIndex === -1);
  ok('a removed section keeps its recorded heading', attached[2].heading === 'Old gallery');
  ok('still counted in the summary', Review.summarize(review).total === 3);
  ok('blocking count is reported', Review.summarize({
    pages: [{ notes: [{ text: 'a', priority: 'blocker' }, { text: 'b' }] }]
  }).blockers === 1);

  const foreign = Review.attach({ pages: [{ slug: 'contact', notes: [{ sectionId: 'sec-hero-0', text: 'x' }] }] }, pages);
  ok('a note from an unknown page is kept', foreign.length === 1 && foreign[0].pageFound === false);
}

// ---- 6. merging repeat sends -------------------------------------------
console.log('\n6. The same note arriving twice is not counted twice');
{
  const one = Review.create({ site: 'W', build: 'babc', pages: [{ name: 'Home', slug: 'index', notes: [{ id: 'dup', sectionId: 'sec-hero-0', text: 'Same note' }] }] });
  const merged = Review.merge([one, one]);
  ok('duplicate ids collapse', merged.pages[0].notes.length === 1);
  const other = Review.create({ site: 'W', build: 'babc', pages: [{ name: 'Home', slug: 'index', notes: [{ id: 'new', sectionId: 'sec-hero-0', text: 'Different note' }] }] });
  ok('distinct notes survive a merge', Review.merge([one, other]).pages[0].notes.length === 2);
  ok('merging nothing returns null', Review.merge([]) === null);
}

// ---- 7. plain-text handoff --------------------------------------------
console.log('\n7. The text version reads like a person wrote it');
{
  const review = Review.create({
    site: 'Willow Café', build: 'btd7xkf',
    pages: [{ name: 'Home', slug: 'index', notes: [
      { sectionId: 'sec-features-1', heading: 'Why us', text: 'Drop to two', priority: 'blocker' },
      { sectionId: 'sec-hero-0', heading: 'Willow Café', text: 'Larger headline' }
    ] }]
  });
  const text = Review.toPlainText(review);
  ok('names the build', text.includes('btd7xkf'));
  ok('flags blocking notes', text.includes('[BLOCKING]'));
  ok('quotes the section it refers to', text.includes('On "Why us"'));
  ok('lists both notes', text.includes('Drop to two') && text.includes('Larger headline'));
  ok('the download name is a safe slug', Review.fileNameFor('Willow Café & Co!') === 'willow-caf-co-review.json', Review.fileNameFor('Willow Café & Co!'));
}

// ---- 8. the shipped client script -------------------------------------
console.log('\n8. The injected client script is real, working JavaScript');
{
  const p = mkProject();
  const html = Builder.buildSiteHTML(p, { onlineEnabled: false });
  const injected = Builder.injectClientEditor(html);
  const m = injected.match(/<script data-pai="client-editor">([\s\S]*?)<\/script>/);
  ok('the editor is injected', !!m);
  // The whole script is assembled from string fragments, so a stray quote would
  // only ever surface as a broken button in front of a client. Parse it here.
  let parsed = true; let err = '';
  try { new vm.Script(m[1]); } catch (e) { parsed = false; err = e.message; }
  ok('the injected script parses as JavaScript', parsed, err);
  ok('comment mode exists', injected.includes('pai-commenting') && injected.includes('toggleReview'));
  ok('notes pin to sections', injected.includes('pai-pin') && injected.includes("closest('main section[id^=sec-]')"));
  ok('the payload declares its own format', injected.includes("kind: 'pallettai-review'"));
  ok('the payload carries the build stamp', injected.includes('build: BUILD'));
  ok('the build stamp is read from the document', injected.includes("getAttribute('data-pai-build')"));
  ok('notes survive a reload', injected.includes('localStorage.setItem(RKEY'));
  ok('notes are stored per build', injected.includes("'pai_review_' + (BUILD"));
  ok('saving notes downloads a file', injected.includes('a.download = pageSlug()'));
  ok('the email path prefills the agency address', injected.includes("'mailto:' + encodeURIComponent(FEEDBACK)"));
  // Self-removal has to cover the review UI too, or a client's saved page
  // would ship with comment pins baked in.
  ok('self-removal strips pins and the composer',
    injected.includes("'.pai-pin', '.pai-composer'"));
  ok('comment mode and text edit mode are mutually exclusive',
    injected.includes('if (reviewing) toggleReview()') && injected.includes('if (reviewing && editing) stop()'));
  ok('review clicks do not hijack links or buttons',
    injected.includes("if (t.closest('a,button,input,textarea,select,label')) return;"));
  ok('the handoff guide explains commenting',
    Builder.manageGuideHtml('Willow').includes('Send notes'));
}

// ---- 9. round trip -----------------------------------------------------
console.log('\n9. What the page produces is what the studio consumes');
{
  const p = mkProject();
  const pages = Builder.pages(p);
  // Exactly the shape `payload()` in the injected script builds.
  const asThePageBuildsIt = {
    v: 1, kind: 'pallettai-review', site: 'Willow Café — Coffee & calm',
    build: Review.stamp(pages), at: '2026-09-14T09:12:09.722Z',
    pages: [{ name: 'Willow Café', slug: pages[0].slug, notes: [{
      id: 'nmu10xxq2zo3u', sectionId: 'sec-features-1', sectionType: 'features',
      heading: 'Why us', text: 'Three features feels crowded', priority: 'blocker',
      at: '2026-09-14T09:12:09.722Z'
    }] }]
  };
  const parsed = Review.parse(JSON.stringify(asThePageBuildsIt));
  ok('the page payload parses', parsed.ok, parsed.error);
  ok('it reads as current against its own project',
    Review.staleness(parsed.review, Review.stamp(pages)) === 'current');
  const attached = Review.attach(parsed.review, pages);
  ok('it attaches to the right section', attached[0].found && attached[0].sectionIndex === 1);
  ok('the block flag survives the round trip', attached[0].note.priority === 'blocker');

  // Stale path: client commented, then the agency changed the hero.
  const edited = clone(p);
  edited.site.sections[0].title = 'Willow Café & Bakery';
  ok('sending after an edit reads as stale',
    Review.staleness(parsed.review, Review.stamp(Builder.pages(edited))) === 'stale');
}

console.log('\n' + (failed === 0 ? 'REVIEW SMOKE PASSED' : 'REVIEW SMOKE FAILED: ' + failed));
process.exit(failed === 0 ? 0 : 1);
