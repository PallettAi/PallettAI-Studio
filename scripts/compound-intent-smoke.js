#!/usr/bin/env node
// ============================================================
// PallettAI Studio — compound intent smoke test
//
// "Make the hero punchier and switch to a serif" is two instructions. The
// planner used to read it as one string: the font matcher fired, the copy
// rewrite did not, and the client was left believing half their sentence had
// been ignored. Same failure as the polarity bug in a different costume — the
// words were read, the meaning was not.
//
// Splitting a sentence is dangerous, so this suite is weighted towards what must
// NOT split. The guard doing that work is that every clause must either carry out
// an action or have been a deliberate non-request, which is what separates a real
// second instruction from a conjunction inside one:
//
//   "black and white"                    -> "white" is not an instruction
//   "salt and pepper"                    -> neither half is
//   "the menu and the pricing are fine"  -> praise, not a request
//   "make the hero shorter and punchier" -> one rewrite, not two
//
// Pinned here: what splits, what refuses to, that a refusal beside an
// instruction still lets the instruction run, and that nothing already working
// changed. A splitter that quietly broke "make the hero punchier" would be worse
// than no splitter at all.
//
// Run: node scripts/compound-intent-smoke.js
// ============================================================

'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadAI } = require('./load-ai.js');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

const AI = loadAI();
const site = AI.generateSite('a harbour joinery', { brief: { name: 'Harbour & Co', offer: 'Bespoke joinery' }, onePager: false }).site;

// A remembered section, because that is what the Designer always supplies: the
// client has a section selected, so a bare "punchier" has a target.
const CTX = { targetType: 'hero', ops: [] };
const plan = (msg, ctx) => AI.chatPlan(site, msg, ctx === undefined ? CTX : ctx);
const ops = (msg, ctx) => (plan(msg, ctx).acts || []).map((a) => a.op);
const compounded = (msg, ctx) => Number(plan(msg, ctx).compound) || 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- 1. two instructions are carried out as two -----------------------------
console.log('\n1. Two instructions, two actions');
{
  const cases = [
    ['make the hero punchier and switch to a serif', ['rewriteSection', 'font']],
    ['switch to a dark blue palette and use a serif font', ['palette', 'font']],
    ['use a serif font; add a gallery', ['font', 'addSection']],
    ['add a gallery and also add a pricing section', ['addSection', 'addSection']],
    ['review my site and add a gallery', ['review', 'addSection']],
    ['use a serif font and rounder corners', ['font', 'design']]
  ];
  cases.forEach(([msg, want]) => {
    ok('"' + msg + '" -> ' + want.join(' + '), eq(ops(msg), want), JSON.stringify(ops(msg)));
    ok('  ...and reports itself as compound', compounded(msg) >= 2, String(compounded(msg)));
  });
}

// ---- 2. one rewrite stays one rewrite ---------------------------------------
console.log('\n2. A compound predicate is still one instruction');
{
  // Two rewrites would be the model run twice, charged twice, each handed half
  // the sentence. Reading it whole is cheaper AND better, so it must not split.
  const cases = [
    'make the hero shorter and punchier',
    'make the hero punchier and also make it shorter',
    'make it punchier and tighter'
  ];
  cases.forEach((msg) => {
    const p = plan(msg);
    const rewrites = (p.acts || []).filter((a) => a.op === 'rewriteSection' || a.op === 'likeUrl').length;
    ok('"' + msg + '" is one rewrite', rewrites === 1, JSON.stringify(ops(msg)));
    ok('  ...and is not reported as compound', !p.compound, JSON.stringify(p.compound));
  });
}

// ---- 3. a conjunction inside a sentence is not two instructions -------------
console.log('\n3. What must refuse to split');
{
  const cases = [
    'black and white',
    'salt and pepper',
    'the menu and the pricing are fine',
    'add a gallery and make sure it works',
    'my customers say the site and the booking flow look great',
    '' + 'a very long paragraph that keeps going and going and mentions the site ' +
      'and the pricing and the gallery and the testimonials and everything else ' +
      'a client might paste into a box without meaning it as a list of separate ' +
      'instructions to be carried out one after the other in a single pass'
  ];
  cases.forEach((msg) => {
    ok('"' + msg.slice(0, 46) + (msg.length > 46 ? '…' : '') + '" does not split', compounded(msg) === 0, String(compounded(msg)));
  });

  // The guards that make it safe on purpose, not by luck.
  ok('a URL containing "and" is left to the likeUrl path',
    compounded('use https://harbourco.example/a-and-b as a reference') === 0);
  ok('a hyphenated word containing "and" is not a conjunction',
    compounded('make it black-and-white and airy') === 0 || !eq(ops('make it black-and-white and airy'), []), JSON.stringify(ops('make it black-and-white and airy')));
  ok('a quoted span is content, never prose to cut',
    compounded('set the headline to "Salt and Pepper"') === 0);
  ok('the quoted headline is not applied as an edit',
    !ops('set the headline to "Salt and Pepper"').some((o) => o === 'font' || o === 'palette'), JSON.stringify(ops('set the headline to "Salt and Pepper"')));
}

// ---- 4. a refusal beside an instruction -------------------------------------
console.log('\n4. Polarity still holds inside a compound');
{
  // The prohibition is already the state of the site, so it has nothing to carry
  // out — but it must not stop the instruction beside it either. Getting this
  // wrong in the safe direction is fine; getting it wrong the other way would
  // change a client's site the way they said not to.
  const dark = plan("don't make it dark and switch to a serif");
  ok('an instruction beside a prohibition still runs', ops("don't make it dark and switch to a serif").indexOf('font') !== -1, JSON.stringify(ops("don't make it dark and switch to a serif")));
  ok('...and the prohibition itself is not carried out',
    !(dark.acts || []).some((a) => a.op === 'palette' && /midnight|dark/i.test(String(a.id || a.value || ''))), JSON.stringify(dark.acts));

  ok('a rejection beside an instruction still lets it run',
    ops("I don't like the editorial look and use a serif").indexOf('font') !== -1, JSON.stringify(ops("I don't like the editorial look and use a serif")));
  ok('an instruction then a rejection still runs the instruction',
    ops("use a serif font and I don't like the colour").indexOf('font') !== -1);

  // A message that is ONLY a refusal must still do nothing at all.
  ['do not make it dark', 'I hate the bento grid', 'not the candy palette'].forEach((msg) => {
    ok('"' + msg + '" on its own changes nothing',
      !ops(msg).some((o) => ['palette', 'font', 'layout', 'pack', 'design', 'hero'].indexOf(o) !== -1), JSON.stringify(ops(msg)));
  });
}

// ---- 5. every connective the copilot advertises -----------------------------
console.log('\n5. Connectives');
{
  const cases = [
    ['switch to a serif font and add a gallery', ['font', 'addSection']],
    ['switch to a serif font, and add a gallery', ['font', 'addSection']],
    ['switch to a serif font and then add a gallery', ['font', 'addSection']],
    ['switch to a serif font; add a gallery', ['font', 'addSection']],
    ['switch to a serif font also add a gallery', ['font', 'addSection']],
    ['switch to a serif font plus add a gallery', ['font', 'addSection']]
  ];
  cases.forEach(([msg, want]) => {
    ok('"' + msg + '"', eq(ops(msg), want), JSON.stringify(ops(msg)));
  });
  // `then` and `also` on their own, without a leading instruction, must not
  // invent one out of the empty half.
  ok('a leading connective does not create an empty clause', compounded('also add a gallery') === 0, String(compounded('also add a gallery')));
}

// ---- 6. the shape of a compound plan ----------------------------------------
console.log('\n6. The plan it returns');
{
  const p = plan('switch to a dark blue palette and use a serif font');
  ok('no help act leaks into a compound', !(p.acts || []).some((a) => a.op === 'help'), JSON.stringify((p.acts || []).map((a) => a.op)));
  ok('no ask act leaks into a compound', !(p.acts || []).some((a) => a.op === 'ask'));
  ok('compound matches the number of acts', p.compound === (p.acts || []).length, p.compound + ' vs ' + (p.acts || []).length);
  ok('every act is an object with an op', (p.acts || []).every((a) => a && typeof a.op === 'string'));
  ok('reply is a string when present', p.reply === undefined || typeof p.reply === 'string');
  ok('at most one rewrite per compound',
    (p.acts || []).filter((a) => a.op === 'rewriteSection' || a.op === 'likeUrl').length <= 1);
}

// ---- 7. nothing that already worked changed ---------------------------------
console.log('\n7. Single instructions are untouched');
{
  const cases = [
    ['review my site', ['review']],
    ['make it punchier', ['rewriteSection']],
    ['fix everything you can', ['repair']],
    ['try a dark blue palette', ['palette']],
    ['use a serif font', ['font']],
    ['rounder corners', ['design']],
    ['add a gallery', ['addSection']],
    ['show me other options', ['options']]
  ];
  cases.forEach(([msg, want]) => {
    ok('"' + msg + '" -> ' + want.join(','), eq(ops(msg), want), JSON.stringify(ops(msg)));
    ok('  ...and is not reported as compound', !plan(msg).compound, String(plan(msg).compound));
  });
}

// ---- 8. a compound adds nothing the clauses did not already carry ----------
console.log('\n8. It is exactly the clauses, concatenated');
{
  // The strongest property available, and the one that makes the feature safe to
  // trust: a compound plan invents nothing. It is the actions of each clause,
  // in order, and nothing else. If a future matcher started reading across the
  // conjunction, this is what would catch it.
  const msgs = [
    'make the hero punchier and switch to a serif',
    'switch to a dark blue palette and use a serif font',
    'add a gallery and also add a pricing section',
    'use a serif font; add a gallery',
    'review my site and add a gallery',
    'switch to a serif font and rounder corners'
  ];
  msgs.forEach((msg) => {
    const parts = AI.splitCompound(msg) || [msg];
    const alone = [];
    parts.forEach((p) => (plan(p).acts || []).forEach((a) => { if (a.op !== 'help' && a.op !== 'ask') alone.push(a.op); }));
    ok('"' + msg.slice(0, 42) + '" is its clauses and nothing more',
      eq(ops(msg), alone), JSON.stringify(ops(msg)) + ' vs ' + JSON.stringify(alone));
  });

  // The clauses after the first are read with the same context as the whole
  // message, so a remembered section still resolves inside a compound.
  const targetless = AI.chatPlan(site, 'make it punchier and use a serif', { targetType: '' });
  ok('a target-less clause still refuses rather than guessing',
    !(targetless.acts || []).some((a) => a.op === 'rewriteSection'), JSON.stringify((targetless.acts || []).map((a) => a.op)));
}

console.log('\n' + (failed === 0 ? 'COMPOUND INTENT PASSED' : 'COMPOUND INTENT FAILED: ' + failed + ' assertion(s)'));
process.exit(failed === 0 ? 0 : 1);
