// ============================================================
// "Apply this note" smoke test
//
// This module decides whether a client's sentence becomes an edit to their site,
// so the failure that matters is not a crash — it is acting on something it only
// half understood. The tests are therefore weighted towards what it must REFUSE:
// negations, questions, hedges, and statements that merely contain a number.
// Being unable to apply a note costs the agency ten seconds; applying the wrong
// one costs them the client.
//
// The second half drives apply() for real and checks the guards hold — a hero
// cannot be deleted, the last section cannot be deleted, and a no-op reports
// itself as a no-op rather than as a success.
//
// Run: node scripts/applynote-smoke.js
// ============================================================
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const ApplyNote = require(path.join(ROOT, 'data', 'applynote.js'));

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + String(detail).slice(0, 220) : ''));
  if (!cond) failed++;
}

function mkPage() {
  return {
    name: 'Home',
    slug: 'index',
    sections: [
      { type: 'hero', title: 'Welcome', items: [] },
      { type: 'features', title: 'Why us', subtitle: 'Reasons', items: [
        { title: 'A', text: 'a' }, { title: 'B', text: 'b' }, { title: 'C', text: 'c' },
        { title: 'D', text: 'd' }, { title: 'E', text: 'e' }
      ] },
      { type: 'contact', title: 'Talk to us', items: [] }
    ]
  };
}

function ctx(page, index, extra) {
  const s = page.sections[index];
  return Object.assign({
    section: s,
    sectionIndex: index,
    sectionType: s.type,
    sectionTitle: s.title,
    pageSlug: 'index',
    pageName: 'Home',
    site: { name: 'Northwind', email: '' }
  }, extra || {});
}

// ---- 1. notes it should act on ------------------------------------------
console.log('\n1. Notes that become edits');
[
  ['drop to two features', 'trimItems', { n: 2 }],
  ['cut the items down to 3', 'trimItems', { n: 3 }],
  ['reduce the list to 2 items', 'trimItems', { n: 2 }],
  ['please shorten the items to two', 'trimItems', { n: 2 }],
  ['we feel there are too many cards here, keep 4', 'trimItems', { n: 4 }],
  ['cut the plans down to 2', 'trimItems', { n: 2 }],
  ['these are too long, trim them to three', 'trimItems', { n: 3 }],
  ['there are 6 services listed, please cut it to 3', 'trimItems', { n: 3 }],
  ['change the heading to Our work', 'setTitle', { value: 'Our work' }],
  ['rename the title to "What we do"', 'setTitle', { value: 'What we do' }],
  ['rewrite the subtitle to Built by hand', 'setSubtitle', { value: 'Built by hand' }],
  ['remove this section', 'removeSection', null],
  ['delete the section', 'removeSection', null],
  ['get rid of this block please', 'removeSection', null],
  ['move this to the top', 'moveSection', { to: 'top' }],
  ['put this lower down', 'moveSection', { to: 'down' }],
  ['our email is hello@studio.co.uk', 'setSiteField', { key: 'email', value: 'hello@studio.co.uk' }],
  ['the phone number is 01234 567890', 'setSiteField', { key: 'phone', value: '01234 567890' }]
].forEach(([text, op, want]) => {
  const page = mkPage();
  const p = ApplyNote.plan(text, ctx(page, 1));
  const got = p.ops.find((o) => o.op === op);
  ok(JSON.stringify(text) + ' -> ' + op, p.resolvable && !!got, JSON.stringify(p.ops));
  if (got && want) {
    Object.keys(want).forEach((k) => ok('    ' + op + '.' + k + ' = ' + JSON.stringify(want[k]), got[k] === want[k], got[k]));
  }
});

// ---- 2. notes it must refuse -------------------------------------------
console.log('\n2. Notes that must be handed to the Copilot instead');
[
  'make it feel more premium',
  "don't change the title to Hello",
  'do not remove this section',
  "please don't delete this",
  'could the heading be shorter?',
  'should we move this to the top?',
  'maybe move this to the top',
  'what about a photo here?',
  'we need 3 items by Friday',
  'the title is too long',
  // “only”/“just” read as statements of fact far more often than instructions,
  // so they are not triggers. A false positive deletes the client's content.
  'we only have 2 members of staff',
  'we only need 3 of these',
  'there are just 2 of us',
  'our budget is 5',
  'too many cards',
  'i wonder if a shorter hero would help',
  ''
].forEach((text) => {
  const page = mkPage();
  const p = ApplyNote.plan(text, ctx(page, 1));
  ok(JSON.stringify(text) + ' -> Copilot', !p.resolvable, p.ops.length ? JSON.stringify(p.ops) : '');
});
{
  const page = mkPage();
  ok('removing the hero is refused', !ApplyNote.plan('remove this section', ctx(page, 0)).resolvable);
  ok('answering a question is never an edit', ApplyNote.isQuestionOrHedge('Could the heading be shorter?'));
  ok('a negation is detected', ApplyNote.negated("please don't change the title", 12));
}
{
  // “too many” with a number on a section that has none must not invent a list.
  const page = { name: 'H', slug: 'index', sections: [{ type: 'cta', title: 'Go', items: [] }] };
  ok('a section with no list is never trimmed', !ApplyNote.plan('cut this down to 2 items', ctx(page, 0)).resolvable);
}
{
  // The instruction handed to the Copilot is scoped to the commented section —
  // “make it shorter” must not land on the whole site.
  const page = mkPage();
  const p = ApplyNote.plan('make this section shorter and punchier', ctx(page, 1));
  ok('the Copilot instruction names the section', /Why us/.test(p.instruction), p.instruction);
  ok('the Copilot instruction carries the note verbatim', /make this section shorter and punchier/.test(p.instruction), p.instruction);
}

// ---- 3. apply() mutates, and guards hold --------------------------------
console.log('\n3. Applying, and the guards around it');
{
  const page = mkPage();
  const c = ctx(page, 1);
  const p = ApplyNote.plan('drop to two features', c);
  const r = ApplyNote.apply(page, p.ops, c);
  ok('items trimmed to 2', page.sections[1].items.length === 2, page.sections[1].items.length);
  ok('the first two items are kept, in order', page.sections[1].items[0].title === 'A' && page.sections[1].items[1].title === 'B');
  ok('reports changed', r.changed === true);
  ok('reports how many went', /Removed 3 items/.test(r.notes.join('|')), r.notes.join('|'));
}
{
  const page = mkPage();
  const c = ctx(page, 1);
  const r = ApplyNote.apply(page, [{ op: 'trimItems', n: 5 }], c);
  ok('a no-op trim reports unchanged, not success', r.changed === false, r.skipped.join('|'));
}
// A note the resolver understands but that is already satisfied must say so,
// rather than falling through to “ask the Copilot” as if it were not understood.
{
  const page = mkPage();
  page.sections[1].items = page.sections[1].items.slice(0, 2);
  const p = ApplyNote.plan('drop to two features please', ctx(page, 1));
  ok('an already-satisfied trim is flagged, not ignored', p.satisfied === true && p.resolvable === false, JSON.stringify(p));
  ok('the reason states the current count', /has 2 items and the note asks for 2/.test(p.reason), p.reason);
  ok('it is not handed to the Copilot', p.method === 'none' && p.instruction === '', p.method);
}
{
  const page = mkPage();
  const p = ApplyNote.plan('drop to two features please', ctx(page, 1));
  ok('a satisfied flag is false when there is work to do', p.resolvable === true && p.satisfied === false);
}
{
  const page = mkPage();
  ok('an unrecognised note still goes to the Copilot', (() => {
    const p = ApplyNote.plan('make it feel more premium', ctx(page, 1));
    return p.satisfied === false && p.method === 'ai';
  })());
  ok('a refused note does not claim satisfaction', ApplyNote.plan('remove this section', ctx(page, 0)).satisfied === false);
}
{
  const page = mkPage();
  const c = ctx(page, 1);
  ApplyNote.apply(page, [{ op: 'removeSection' }], c);
  ok('section removed', page.sections.length === 2 && !page.sections.some((s) => s.type === 'features'), page.sections.map((s) => s.type).join(','));
}
{
  const page = { name: 'H', slug: 'index', sections: [{ type: 'hero', title: 'x', items: [] }] };
  const r = ApplyNote.apply(page, [{ op: 'removeSection' }], ctx(page, 0));
  ok('the only section cannot be removed', r.changed === false && page.sections.length === 1, r.skipped.join('|'));
}
{
  const page = mkPage();
  ApplyNote.apply(page, [{ op: 'moveSection', to: 'top' }], ctx(page, 2));
  ok('moved to the top', page.sections[0].type === 'contact', page.sections.map((s) => s.type).join(','));
  const page2 = mkPage();
  ApplyNote.apply(page2, [{ op: 'moveSection', to: 'up' }], ctx(page2, 1));
  ok('moved up one place', page2.sections[0].type === 'features', page2.sections.map((s) => s.type).join(','));
}
{
  const page = mkPage();
  const r = ApplyNote.apply(page, [{ op: 'setTitle', value: 'Our work' }], ctx(page, 1));
  ok('heading set', page.sections[1].title === 'Our work' && r.changed, page.sections[1].title);
}
{
  const page = mkPage();
  const c = ctx(page, 1);
  ApplyNote.apply(page, [{ op: 'setSiteField', key: 'email', value: 'a@b.co' }], c);
  ok('site field set', c.site.email === 'a@b.co', c.site.email);
  const r2 = ApplyNote.apply(page, [{ op: 'setSiteField', key: 'email', value: 'a@b.co' }], c);
  ok('setting the same value reports unchanged', r2.changed === false, r2.skipped.join('|'));
}
{
  const page = mkPage();
  const r = ApplyNote.apply(page, [{ op: 'nonsense' }], ctx(page, 1));
  ok('an unknown op is skipped, not thrown', r.changed === false && /unknown op/.test(r.skipped.join('|')), r.skipped.join('|'));
  ok('a null page is handled', ApplyNote.apply(null, [{ op: 'trimItems', n: 1 }], {}).changed === false);
}
{
  const page = mkPage();
  const a = ApplyNote.plan('drop to 2 features', ctx(page, 1));
  const b = ApplyNote.plan('drop to 2 features', ctx(page, 1));
  ok('an identical note and target produce identical ops', JSON.stringify(a.ops) === JSON.stringify(b.ops));
  ok('the intent states the before and after', /5 items to 2/.test(a.intent), a.intent);
  ok('the key is stable for the same note', ApplyNote.keyOf({ text: 'x' }) === ApplyNote.keyOf({ text: 'x' }));
  ok('two notes on the same section stay distinguishable', ApplyNote.keyOf({ text: 'x', id: '1' }) !== ApplyNote.keyOf({ text: 'x', id: '2' }));
}

console.log('\n' + (failed === 0 ? 'APPLY-NOTE SMOKE PASSED' : 'APPLY-NOTE SMOKE FAILED: ' + failed));
process.exit(failed === 0 ? 0 : 1);
