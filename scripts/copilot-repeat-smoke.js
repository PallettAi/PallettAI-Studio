#!/usr/bin/env node
// Copilot: carrying an instruction forward ("same for the footer"), and
// pointing at a section by where it sits ("the second section").
//
// The refusals matter more than the successes here. The failure this guards
// against is not "the copilot did nothing" — it is "the copilot did the right
// thing to the wrong section", which the client may not notice until a client
// of theirs does.
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const follow = require(path.join(ROOT, 'data', 'ai-followup.js'));
const { loadAI } = require('./load-ai.js');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const AI = loadAI();
const site = AI.generateSite('a bakery', { brief: { name: 'Rustica', offer: 'Sourdough' }, onePager: true }).site;
const types = site.sections.map((s) => s.type);

/* What app.js remembers after "make the hero punchier" landed. */
const afterHero = {
  targetType: 'hero',
  ops: [{ op: 'rewriteSection', type: 'hero', idx: 0, mode: 'shorter', prompt: 'make the hero punchier' }]
};
const fresh = { targetType: '', ops: [] };

const plan = (msg, ctx, on) => AI.chatPlan(on || site, msg, ctx === undefined ? afterHero : ctx);
const opsOf = (msg, ctx, on) => (plan(msg, ctx, on).acts || []).map((a) => a.op);
const replyOf = (msg, ctx, on) => String(plan(msg, ctx, on).reply || '');

console.log('== The detector, and what it must not swallow ==');
assert(follow.isRepeat('same for the footer') === 'same', 'same for X');
assert(follow.isRepeat('do that to the testimonials') === 'do that', 'do that to X');
assert(follow.isRepeat('apply that to pricing') === 'apply that', 'apply that to X');
assert(follow.isRepeat('and same again') === 'same', 'a leading connective does not hide it');
assert(follow.isRepeat('can you do that for the footer') === 'do that', 'a polite prefix is fine');
assert(follow.isRepeat('make it shorter') === '', 'a follow-up mode is not a repeat');
assert(follow.isRepeat('undo') === '', 'undo is not a repeat');
assert(follow.isRepeat('revert that') === '', 'revert that is undo, not repeat');
assert(follow.isRepeat('apply every fix you can') === '', 'the batch fix is not a repeat');
assert(follow.isRepeat('add the same styling to the footer') === '', 'an instruction that merely contains “same” is not a repeat');
assert(follow.isRepeat('make it the same as the hero') === '', '“the same as X” is a reference, not a repeat');
assert(follow.isRepeat('same colour as the hero') === '', '“same colour as X” is a colour request');
assert(follow.isRepeat('') === '', 'empty is not a repeat');

console.log('\n== What is left after the repeat phrase ==');
assert(follow.repeatTail('same again') === '', '“same again” names nothing');
assert(follow.repeatTail('repeat that') === '', '“repeat that” names nothing');
assert(follow.repeatTail('same for the about section') === 'about section', 'the named target survives the filler');
assert(follow.repeatTail('do that to the testimonials') === 'testimonials', 'so does do-that-to');

console.log('\n== Which op can be carried forward ==');
{
  const r = follow.repeatableOp(afterHero.ops);
  assert(r.ok === true && r.op === 'rewriteSection' && r.type === 'hero' && r.mode === 'shorter',
    'a section rewrite can be repeated, with its mode intact');
}
{
  // Replaying an add would put a SECOND one on the page.
  const r = follow.repeatableOp([{ op: 'addSection', type: 'pricing' }]);
  assert(r.ok === false && r.reason === 'not-repeatable', 'adding a section cannot be repeated');
}
{
  // Replaying a delete would remove something nobody named.
  const r = follow.repeatableOp([{ op: 'removeSection', type: 'faq' }]);
  assert(r.ok === false && r.reason === 'not-repeatable', 'deleting a section cannot be repeated');
}
{
  const r = follow.repeatableOp([{ op: 'palette', palette: 'emerald' }]);
  assert(r.ok === false && r.reason === 'site-wide', 'a whole-site change is reported as whole-site, not as a mystery');
}
{
  const r = follow.repeatableOp([]);
  assert(r.ok === false && r.reason === 'none', 'nothing to repeat is its own answer');
}
{
  // The LAST change is what "same" refers to.
  const r = follow.repeatableOp([
    { op: 'rewriteSection', type: 'hero', mode: 'shorter' },
    { op: 'palette', palette: 'emerald' },
    { op: 'rewriteSection', type: 'about', mode: 'local' }
  ]);
  assert(r.ok === true && r.type === 'about' && r.mode === 'local', 'the most recent repeatable op wins');
}

console.log('\n== Carrying it forward ==');
{
  const acts = plan('same for the about section').acts;
  assert(acts.length === 1 && acts[0].op === 'rewriteSection', 'a repeat is one rewrite');
  assert(acts[0].type === 'about', 'aimed at the section that was named this time');
  assert(acts[0].idx === types.indexOf('about'), 'resolved to the right index');
  assert(acts[0].mode === 'shorter', 'carrying the ORIGINAL mode forward — the whole point');
  assert(acts[0].prompt === 'make the hero punchier', 'and the original instruction, so the writer sees the real ask');
  assert(acts[0].credit === true, 'a model rewrite, so it costs a credit');
}
{
  const acts = plan('do that to the testimonials').acts;
  assert(acts[0].type === 'testimonials' && acts[0].mode === 'shorter', 'do-that-to works the same way');
}
{
  const acts = plan('and same for the faq').acts;
  assert(acts[0].type === 'faq' && acts[0].mode === 'shorter', 'and so does a leading connective');
}
{
  const acts = plan('same again').acts;
  assert(acts[0].type === 'hero' && acts[0].mode === 'shorter', '“same again” repeats on the same section');
  assert(acts[0].label !== '', 'and says so in the chat');
}

console.log('\n== The refusals, which are the point ==');
{
  // The bug this whole design exists to prevent: naming a target the copilot
  // cannot place, then repeating on the previous one anyway.
  const p = plan('same for the footer');
  assert((p.acts || []).length === 0, 'a target it cannot place changes NOTHING');
  assert(/could not tell which section/i.test(p.reply || ''), 'and says so rather than guessing');
  assert(/footer/.test(p.reply || ''), 'quoting the words the client actually used');
  assert(/have not changed anything/i.test(p.reply || ''), 'and confirming nothing was touched');
}
{
  const p = plan('same for the sidebar');
  assert((p.acts || []).length === 0, 'another unplaceable target is refused the same way');
}
{
  const p = plan('same for the about section', fresh);
  assert((p.acts || []).length === 0, 'with no previous edit there is nothing to repeat');
  assert(/nothing to repeat yet/i.test(p.reply || ''), 'and it says that specifically');
}
{
  const p = plan('same for the about section', { targetType: '', ops: [{ op: 'palette' }] });
  assert((p.acts || []).length === 0, 'a whole-site change is not repeated onto one section');
  assert(/whole site/i.test(p.reply || ''), 'the reply explains why, rather than falling back on “I did not catch that”');
  assert(!/didn.t quite catch/i.test(p.reply || ''), 'it does not pretend to be confused');
}
{
  const p = plan('same for the about section', { targetType: '', ops: [{ op: 'addSection', type: 'pricing' }] });
  assert((p.acts || []).length === 0, 'adding cannot be repeated — a second pricing section is not what anyone meant');
  assert(/not one I can safely repeat/i.test(p.reply || ''), 'and it says the change is unsafe to repeat');
}
{
  const p = plan('same again', { targetType: 'hero', ops: [{ op: 'rewriteSection', type: 'bravo', mode: 'shorter' }] });
  assert((p.acts || []).length === 0, 'if the remembered section is gone, nothing happens');
  assert(/no longer on this page/i.test(p.reply || ''), 'and it says which section went');
}

console.log('\n== Pointing by position ==');
{
  const second = plan('make the second section punchier', fresh).acts[0];
  assert(second.op === 'rewriteSection' && second.idx === 1, '“the second section” is index 1');
  assert(second.type === types[1], 'with that section’s own type, not a guessed one');
}
{
  const last = plan('make the last section punchier', fresh).acts[0];
  assert(last.idx === site.sections.length - 1, '“the last section” is the last one');
}
{
  const about = plan('make the about section punchier', fresh).acts[0];
  assert(about.type === 'about' && about.idx === types.indexOf('about'), 'naming a kind still works');
}
{
  // Only three sections on this one, so the fifth does not exist.
  const small = AI.generateSite('a bakery', { brief: { name: 'R', offer: 'S' }, onePager: true }).site;
  small.sections = small.sections.slice(0, 3);
  const p = AI.chatPlan(small, 'make the fifth section punchier', fresh);
  assert((p.acts || []).length === 0, 'a position past the end changes nothing');
  assert(/no section in that position/i.test(p.reply || ''), 'and says there is no section there');
  assert(/has 3 sections/.test(p.reply || ''), 'and how many there actually are');
}
{
  const p = AI.chatPlan(site, 'make the pricing section punchier', fresh);
  if (types.indexOf('pricing') === -1) {
    assert((p.acts || []).length === 0 && /no pricing section/i.test(p.reply || ''),
      'naming a kind this site does not have says which kind is missing');
  } else {
    assert((p.acts || [])[0].type === 'pricing', 'a kind this site does have still resolves');
  }
}
{
  // A named kind outranks a bare position: "the last pricing section" is about
  // pricing first.
  const withTwo = JSON.parse(JSON.stringify(site));
  const pricing = withTwo.sections.find((s) => s.type === 'features');
  if (pricing) {
    withTwo.sections.push(Object.assign({}, pricing, { type: 'pricing' }));
    const sec = JSON.parse(JSON.stringify(pricing));
    withTwo.sections.splice(1, 0, Object.assign(sec, { type: 'pricing' }));
    const idxs = [];
    withTwo.sections.forEach((s, i) => { if (s.type === 'pricing') idxs.push(i); });
    assert(idxs.length === 2, '(staged two pricing sections)');
    const p = AI.chatPlan(withTwo, 'make the last pricing section punchier', fresh);
    assert((p.acts || [])[0].idx === idxs[1], '“the last pricing section” picks the last PRICING one, not the last section');
  }
}

console.log('\n== Positional targets work for the section operations too ==');
{
  const del = plan('delete the second section', fresh).acts[0];
  assert(del.op === 'removeSection' && del.idx === 1, '“delete the second section” removes that exact one');
  assert(del.type === types[1], 'with the type that actually sits there');
}
{
  const del = plan('remove the last section', fresh).acts[0];
  assert(del.op === 'removeSection' && del.idx === site.sections.length - 1, '“remove the last section” removes the last one');
}
{
  const del = plan('delete the second one', fresh).acts[0];
  assert(del.op === 'removeSection' && del.idx === 1, '“the second one” counts as a position too');
}
{
  const dupe = plan('duplicate the last one', fresh).acts[0];
  assert(dupe.op === 'duplicateSection' && dupe.idx === site.sections.length - 1, '“duplicate the last one” clones the last one');
}
{
  // Named kinds must keep working exactly as before, and stay index-free so the
  // executor keeps using its own last-of-type rule.
  const del = plan('delete the faq', fresh).acts[0];
  assert(del.op === 'removeSection' && del.type === 'faq', 'deleting by kind is unchanged');
  assert(del.idx == null, 'and carries no index, so nothing about that path moved');
}
{
  // The add branch must NOT accept a position: inserting a copy of whatever sits
  // there is not a request anyone made.
  const p = plan('add a section after the second one', fresh);
  assert(!(p.acts || []).some((a) => a.op === 'addSection' && a.idx != null), 'adding never takes a positional target');
}
{
  const beyond = AI.generateSite('a bakery', { brief: { name: 'R', offer: 'S' }, onePager: true }).site;
  beyond.sections = beyond.sections.slice(0, 2);
  const p = AI.chatPlan(beyond, 'delete the fifth section', fresh);
  assert(!(p.acts || []).some((a) => a.op === 'removeSection'), 'a position past the end deletes nothing at all');
}

console.log('\n== The help only advertises what actually works ==');
{
  // The bug being guarded: an example the copilot would ITSELF refuse, which is
  // how the help text and the behaviour drift apart without anyone noticing.
  assert((plan('make the second section punchier', fresh).acts || []).length === 1, 'the help\u2019s positional example resolves');
  assert((plan('delete the last one', fresh).acts || []).length === 1, 'and so does its delete example');
  assert((plan('same for the FAQ').acts || []).length === 1, 'and its “same for the …” example');
  assert(/same for the FAQ/.test(AI.chatHelp), 'the repeat example is the one the help actually shows');
  assert(!/same for the footer/.test(AI.chatHelp), 'and a section that cannot be pointed at is never the example');
}

console.log('\n== Nothing that already worked is broken ==');
{
  const noCtx = AI.chatPlan(site, 'make it shorter');
  assert((noCtx.acts || []).length === 0, 'a follow-up with no context still refuses');
  assert(/nothing to tweak/i.test(noCtx.reply || ''), 'with the same wording as before');
}
{
  const withCtx = AI.chatPlan(site, 'make it shorter', { targetType: 'hero', ops: [] });
  assert(withCtx.acts[0].type === 'hero' && withCtx.acts[0].mode === 'shorter', 'a follow-up with context still rewrites the remembered target');
}
{
  // A repeat phrase must not hijack the batch fix or the audit.
  assert(opsOf('apply every fix you can', fresh)[0] === 'fixAll', 'the batch fix is untouched');
  assert(opsOf('review my site', fresh)[0] === 'review', 'the audit is untouched');
}
{
  const targetless = AI.chatPlan(site, 'make it punchier and use a serif', { targetType: '' });
  assert((targetless.acts || []).length === 0, 'a compound whose target-less clause cannot resolve still refuses');
}

if (failed) {
  console.error('\ncopilot-repeat-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\ncopilot-repeat-smoke PASSED');
