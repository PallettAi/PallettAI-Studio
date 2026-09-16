#!/usr/bin/env node
'use strict';

/*
  Targeted revert.

  The failure this guards against is the expensive one: a revert that puts back
  MORE than the client named. A partial undo that quietly reverts their last
  two changes is worse than no feature at all, because they have been told
  exactly one thing was restored — so the assertions here are mostly about what
  must survive a revert, not about the path that comes back.
*/

const path = require('path');
const ROOT = path.join(__dirname, '..');
const Revert = require(path.join(ROOT, 'data', 'revert.js'));
const { loadAI } = require('./load-ai.js');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

console.log('== Reading the sentence ==');
assert(Revert.whatFrom('put the colours back') === 'colour', '“colours” reads as a colour revert');
assert(Revert.whatFrom('undo the font change') === 'font', '“font” reads as a font revert');
assert(Revert.whatFrom('revert the spacing') === 'layout', '“spacing” reads as a layout revert');
assert(Revert.whatFrom('undo the copy rewrite') === 'copy', '“copy” reads as a copy revert');
assert(Revert.whatFrom('put the site name back') === 'name', '“site name” beats “copy”');
assert(Revert.whatFrom('make it glassmorphism') === '', 'a plain instruction names nothing to revert');
assert(Revert.isReverb('put the colours back') === true, 'the words between “put” and “back” do not break the verb');
assert(Revert.isReverb('put the prices back above the FAQ') === false, 'but an ordering request is not read as a revert');

const bare = Revert.intent('undo that');
assert(bare.verbs === true && bare.targeted === false, 'a bare “undo that” is not a targeted revert');
const named = Revert.intent('put the colours back');
assert(named.targeted === true && named.what === 'colour', 'a named revert is targeted');
const bySection = Revert.intent('put the hero back', { types: ['hero'] });
assert(bySection.targeted === true && bySection.types[0] === 'hero', 'a named section is a target on its own');

console.log('\n== A later change to another path survives ==');
/* Three undo points: palette, then hero copy, then the font. Reverting the
   colours must leave the font and the hero copy exactly as they are now. */
const s0 = { site: { palette: 'ocean', font: 'inter', name: 'Rustica', sections: [{ type: 'hero', title: 'Old hero', items: [] }] } };
const s1 = JSON.parse(JSON.stringify(s0)); s1.site.palette = 'crimson';
const s2 = JSON.parse(JSON.stringify(s1)); s2.site.sections[0].title = 'New hero';
const s3 = JSON.parse(JSON.stringify(s2)); s3.site.font = 'playfair';

const colour = Revert.plan([s0, s1, s2, s3], { what: 'colour' });
assert(colour.ok === true, 'the colour revert is found');
assert(colour.restores.length === 1 && colour.restores[0].value === 'ocean', 'it restores the palette from before the change');
const live = JSON.parse(JSON.stringify(s3));
Revert.applyRestores(live, colour.restores);
assert(live.site.palette === 'ocean', 'the palette is back');
assert(live.site.font === 'playfair', 'the LATER font change survives');
assert(live.site.sections[0].title === 'New hero', 'the LATER copy change survives');
assert(/2 steps ago/.test(colour.said), 'and it says how far back it reached');

console.log('\n== The most recent change to a path wins ==');
const r1 = JSON.parse(JSON.stringify(s0)); r1.site.palette = 'crimson';
const r2 = JSON.parse(JSON.stringify(r1)); r2.site.font = 'playfair';
const r3 = JSON.parse(JSON.stringify(r2)); r3.site.palette = 'emerald';
const twice = Revert.plan([s0, r1, r2, r3], { what: 'colour' });
assert(twice.ok && twice.restores[0].value === 'crimson', 'two colour changes: the latest one is the one reverted to');
assert(/last change/.test(twice.said), 'and it is described as the last change');

console.log('\n== A section target is scoped by kind AND field ==');
const c0 = { site: { sections: [{ type: 'hero', title: 'H1', layout: 'center' }, { type: 'faq', title: 'F1' }] } };
const c1 = JSON.parse(JSON.stringify(c0)); c1.site.sections[1].title = 'F2';
const c2 = JSON.parse(JSON.stringify(c1)); c2.site.sections[0].title = 'H2';
const c3 = JSON.parse(JSON.stringify(c2)); c3.site.sections[1].items = [{ title: 'Q', text: 'A' }];

const heroRevert = Revert.plan([c0, c1, c2, c3], { what: '', types: ['hero'] });
assert(heroRevert.ok, 'the hero revert is found');
const liveC = JSON.parse(JSON.stringify(c3));
Revert.applyRestores(liveC, heroRevert.restores);
assert(liveC.site.sections[0].title === 'H1', 'the hero title is back');
assert(liveC.site.sections[1].title === 'F2', 'the faq edits are untouched');
assert(liveC.site.sections[1].items.length === 1, 'including the faq items added after it');

/* Two copy changes to the same section. The FIRST request must undo the most
   recent one only — asking again is what reaches the earlier one. Anything else
   would mean a client cannot undo a single change without losing the next. */
const faqOnce = Revert.plan([c0, c1, c2, c3], { what: 'copy', types: ['faq'] });
assert(faqOnce.ok, 'a faq copy revert is found');
const liveD = JSON.parse(JSON.stringify(c3));
Revert.applyRestores(liveD, faqOnce.restores);
assert((liveD.site.sections[1].items || []).length === 0, 'the most recent faq copy change (added items) is undone');
assert(liveD.site.sections[1].title === 'F2', 'and the earlier faq copy change is left alone');
assert(liveD.site.sections[0].title === 'H2', 'the hero is untouched by a faq revert');
const faqTwice = Revert.plan([c0, c1, c2, liveD], { what: 'copy', types: ['faq'] });
assert(faqTwice.ok, 'asking again reaches the earlier change');
Revert.applyRestores(liveD, faqTwice.restores);
assert(liveD.site.sections[1].title === 'F1', 'and the faq title is back to its original');

console.log('\n== Refusals are named, not silent ==');
const structure = JSON.parse(JSON.stringify(c0));
structure.site.sections.splice(1, 0, { type: 'gallery' });
const moved = Revert.plan([c0, structure], { what: '', types: ['gallery'] });
assert(moved.ok === false, 'an inserted section is not reverted by field');
assert(/⌘Z/.test(moved.reason || ''), 'and the refusal points at ⌘Z');

const never = Revert.plan([c0, c1], { what: 'colour' });
assert(never.ok === false && /colours/.test(never.reason || ''), 'reverting colours that never changed says so');
const empty = Revert.plan([c0], { what: 'colour' });
assert(empty.ok === false && /nothing to put back/.test(empty.reason || ''), 'a one-state history has nothing to read');
const unasked = Revert.plan([s0, s1], { what: '', types: [] });
assert(unasked.ok === false && /what to put back/.test(unasked.reason || ''), 'no target at all is refused');

console.log('\n== The write surface is whitelisted ==');
assert(Revert.allowed(['site', 'palette']) === true, 'the palette is writable');
assert(Revert.allowed(['site', 'sections', 2, 'title']) === true, 'a section title is writable');
// A plan is data. It should not be able to write anywhere just because it came
// from the module that built it.
assert(Revert.allowed(['site', 'sections', 2, 'type']) === false, 'a section type is NOT writable — it would break the renderer');
assert(Revert.allowed(['site', 'design', 'radius']) === true, 'the design radius is writable');
assert(Revert.allowed(['site', 'design', 'anything']) === false, 'an unknown design key is not');
assert(Revert.allowed(['__proto__', 'polluted']) === false, 'a prototype path is refused');
assert(Revert.allowed(['site', 'sections', -1, 'title']) === false, 'a negative index is refused');
assert(Revert.allowed(['settings', 'pro']) === false, 'nothing outside site is writable');
const protect = { site: { palette: 'ocean', sections: [{ type: 'hero', title: 'x' }] } };
const refusedWrite = Revert.applyRestores(protect, [{ path: ['site', 'sections', 0, 'type'], value: 'gallery' }, { path: ['site', 'palette'], value: 'emerald' }]);
assert(refusedWrite.applied === 1 && refusedWrite.refused.length === 1, 'applyRestores applies the allowed path and refuses the rest');
assert(protect.site.sections[0].type === 'hero', 'the refused write did not land');
assert(protect.site.palette === 'emerald', 'the allowed write did');

console.log('\n== The planner routes it as its own op ==');
const AI = loadAI();
const site = AI.generateSite('a bakery', { brief: { name: 'Rustica', offer: 'Sourdough' }, onePager: true }).site;
const plan = AI.chatPlan(site, 'put the colours back');
assert(plan.acts && plan.acts[0] && plan.acts[0].op === 'revert', 'a named revert is its own op, not the generic undo');
assert(plan.acts[0].what === 'colour' && plan.acts[0].credit === undefined, 'it carries the target and costs nothing');
const plain = AI.chatPlan(site, 'undo that');
assert(plain.acts && plain.acts[0] && plain.acts[0].op === 'undo', 'a bare undo is still the plain one');
const heroBack = AI.chatPlan(site, 'put the hero back');
assert(heroBack.acts && heroBack.acts[0] && heroBack.acts[0].op === 'revert', 'a named section routes to a revert');
assert(heroBack.acts[0].targetTypes.indexOf('hero') !== -1, 'with the section it named');
const reorder = AI.chatPlan(site, 'put the pricing back above the faq');
assert(!(reorder.acts || []).some((a) => a.op === 'revert'), 'an ordering sentence is not swallowed as a revert');

if (failed) {
  console.error('\nrevert-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nrevert-smoke PASSED');
