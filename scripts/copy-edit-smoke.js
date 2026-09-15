#!/usr/bin/env node
// ============================================================
// PallettAI Studio — copy-edit intent smoke test
// ------------------------------------------------------------
// "Copy" is this product's own word for the words on the page:
// the copilot's help advertises "tweak copy", and the review card
// lists Copy as a category. It is also a duplicate verb.
//
// That overlap was a real bug. "punch up the hero copy" rewrote
// the hero and *duplicated* it, so an edit the client asked for
// arrived with a change they did not — discoverable only by
// counting their sections. This suite pins both sides of the
// line: a copy EDIT must never clone a section, and a copy OF a
// section must still clone it.
// ============================================================

'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadAI } = require('./load-ai.js');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const AI = loadAI();
const site = AI.generateSite('a bakery', { brief: { name: 'Rustica', offer: 'Sourdough' }, onePager: true }).site;
const types = (site.sections || []).map((s) => s.type);
console.log('fixture sections: ' + types.join(', '));

const opsFor = (msg, ctx) => {
  try {
    const r = AI.chatPlan(site, msg, ctx || { targetType: '', ops: [] });
    return (r && r.acts) || [];
  } catch (e) { return [{ op: 'threw:' + String(e).slice(0, 60) }]; }
};
const ops = (msg, ctx) => opsFor(msg, ctx).map((a) => a.op);
const has = (msg, op, ctx) => opsFor(msg, ctx).some((a) => a.op === op);
const rewriteOps = ['rewrite', 'rewriteAll', 'rewriteItems', 'enhanceCopy', 'rewriteSection'];

console.log('\n== 1. A copy edit never clones a section ==');
const edits = [
  'punch up the hero copy',
  'rewrite the hero copy',
  'make the hero copy punchier',
  'sharpen the hero copy',
  'punch up the copy on the about section',
  'improve the copy',
  'make the copy friendlier',
  'the copy is too salesy',
  'tighten the copy',
  'make the words shorter'
];
edits.forEach((msg) => {
  const found = ops(msg);
  assert(!found.includes('duplicateSection'), '"' + msg + '" does not duplicate a section');
});
console.log('  (' + edits.length + ' copy-edit phrasings, none produced a duplicate)');

console.log('\n== 2. The edit still happens — the fix is not a mute button ==');
['punch up the hero copy', 'rewrite the hero copy', 'make the hero copy punchier', 'sharpen the hero copy']
  .forEach((msg) => {
    const found = ops(msg);
    assert(found.some((o) => rewriteOps.includes(o)), '"' + msg + '" still rewrites the copy');
  });
['improve the copy', 'make the copy friendlier'].forEach((msg) => {
  const found = ops(msg);
  assert(found.some((o) => rewriteOps.includes(o)) || found.length > 0, '"' + msg + '" is still understood');
});

console.log('\n== 3. Asking for a copy OF a section still clones it ==');
const clones = [
  'duplicate the hero',
  'duplicate the hero section',
  'repeat the hero',
  'copy the hero',
  'copy the hero section'
];
clones.forEach((msg) => {
  assert(has(msg, 'duplicateSection'), '"' + msg + '" duplicates the section');
});

console.log('\n== 3b. "This section" means the one being worked on ==');
// No section is named, so it resolves against the remembered target the same
// way a follow-up does — and stays silent rather than guessing when there is none.
['copy this section', 'copy that section', 'duplicate this section'].forEach((msg) => {
  assert(has(msg, 'duplicateSection', { targetType: 'hero' }),
    '"' + msg + '" duplicates the remembered section');
  const act = opsFor(msg, { targetType: 'hero' }).find((a) => a.op === 'duplicateSection');
  assert(!!act && act.type === 'hero', '"..." resolves to the remembered section type');
});
['copy this section', 'duplicate this section'].forEach((msg) => {
  assert(!has(msg, 'duplicateSection'), '"' + msg + '" with nothing remembered does not guess');
});
assert(!has('copy nothing', 'duplicateSection'), 'a demonstrative-free phrase is unaffected');

console.log('\n== 4. An explicit duplicate survives a rewrite in the same sentence ==');
assert(has('duplicate the hero and rewrite its copy', 'duplicateSection'),
  '"duplicate the hero and rewrite its copy" still duplicates');
assert(has('duplicate the hero and rewrite its copy', 'rewrite')
  || has('duplicate the hero and rewrite its copy', 'rewriteAll'),
  '...and still rewrites the copy');

console.log('\n== 5. A credited copy edit is priced, and a duplicate is not ==');
const paid = opsFor('punch up the hero copy').find((a) => rewriteOps.includes(a.op));
assert(!!paid && paid.credit === true, 'the copy rewrite is credited (so the refund path applies)');
const free = opsFor('duplicate the hero').find((a) => a.op === 'duplicateSection');
assert(!!free && !free.credit, 'duplicating a section is free');

console.log('\n== 6. The duplicate act names its section, so it cannot hit the wrong one ==');
const named = opsFor('duplicate the hero').find((a) => a.op === 'duplicateSection');
assert(!!named && named.type === 'hero', 'the duplicate names the section by type');

console.log('\n== 7. The phrasing the product advertises actually works ==');
// The copilot's greeting offers "make the hero punchier". Requiring a previous
// edit made that answer with "nothing to tweak yet" — the product recommending a
// phrase it then refused to understand.
const advertised = opsFor('make the hero punchier');
assert(advertised.length > 0, '"make the hero punchier" produces an action');
assert(advertised.some((a) => a.op === 'rewriteSection' && a.type === 'hero'), '...aimed at the hero it named');
assert(advertised.some((a) => a.credit === true), '...and priced, as a copy rewrite is');
const noTarget = opsFor('make it shorter');
assert(noTarget.length === 0, 'a target-less follow-up still asks for context instead of guessing');
const ctxTarget = opsFor('make it shorter', { targetType: 'hero' });
assert(ctxTarget.some((a) => a.op === 'rewriteSection' && a.type === 'hero'), 'a remembered target still resolves');

if (failed) {
  console.error('\ncopy-edit-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\ncopy-edit-smoke PASSED');
