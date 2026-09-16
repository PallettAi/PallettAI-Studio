#!/usr/bin/env node
'use strict';

/*
  Scope and constraints — the two ways a copilot reads a client's words without
  reading their meaning.

  The tests are weighted towards what must NOT happen, because both failures are
  silent by nature. A dropped second target and an ignored "but keep the words"
  both end with a confident report and a site the client did not ask for.

  Deliberately not tested here: whether a rewrite *lands well*. That is the
  copy engines' business. This file is about which acts exist.
*/

const path = require('path');
const ROOT = path.join(__dirname, '..');
const scope = require(path.join(ROOT, 'data', 'ai-scope.js'));
const { loadAI } = require('./load-ai.js');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

console.log('== Scope reader ==');
assert(scope.scopeWord('make every section punchier', false) === 'all', '“every section” widens');
assert(scope.scopeWord('make all the faq sections shorter', true) === 'all', '“all” with a named kind widens');
assert(scope.scopeWord('say the rest', true) === 'rest', '“the rest” is its own scope');
assert(scope.scopeWord('make it punchier', false) === '', 'a bare follow-up does not widen');
// The guard that keeps a quantifier from scoping a sentence about one thing.
assert(scope.scopeWord('thanks, that is all for now', false) === '', '“all” without something to scope stays singular');
assert(scope.scopeWord('make it any better', false) === '', '“any” without something to scope stays singular');

console.log('\n== Constraint reader ==');
const con = scope.constraints('make it more premium but keep the words');
assert(con.keeps.indexOf('copy') !== -1, '“keep the words” is a copy constraint');
// blockedBy returns the category it would protect, not a boolean, so the caller
// can name what was spared. Truthiness is the contract.
assert(!!scope.blockedBy({ op: 'rewrite', idx: 0 }, con.keeps), 'a rewrite conflicts with keeping the copy');
assert(!scope.blockedBy({ op: 'palette', id: 'ocean' }, con.keeps), 'a palette change does not conflict');
assert(scope.constraints('make it glassmorphism').keeps.length === 0, 'a plain instruction sets no constraint');

const AI = loadAI();
const base = AI.generateSite('a bakery', { brief: { name: 'Rustica', offer: 'Sourdough' }, onePager: true }).site;
const ops = (plan) => (plan.acts || []).map((a) => a.op);

/*
  A page small enough to assert on completely: two of one kind, a prose section,
  and the three kinds a copy rewrite cannot affect — their renderers read
  `extra`, so an act aimed at them would take a credit and change nothing the
  client can see.
*/
function page(sections) {
  const s = JSON.parse(JSON.stringify(base));
  s.sections = sections.map((spec) => (typeof spec === 'string'
    ? { type: spec, title: spec, text: 'Some copy for the ' + spec + ' section.' }
    : Object.assign({ title: spec.type, text: 'Some copy for the ' + spec.type + ' section.' }, spec)));
  return s;
}
const INVISIBLE = ['map', 'countdown', 'embed'];
const small = page([
  'hero',
  { type: 'faq', items: [{ title: 'Q', text: 'A' }] },
  { type: 'faq', items: [{ title: 'Q2', text: 'A2' }] },
  'about',
  { type: 'map', extra: 'Leeds' },
  { type: 'countdown', extra: '2026-12-01' },
  { type: 'embed', extra: 'https://example.com/e' }
]);

console.log('\n== A scope outranks missing context ==');
const every = AI.chatPlan(small, 'make every section punchier');
assert(ops(every).length === 4, '“every section punchier” plans one act per copy section (got ' + ops(every).length + ')');
assert(ops(every).every((o) => o === 'rewriteSection'), 'every act is a section rewrite');
assert(!/nothing to tweak/i.test(every.reply || ''), 'it does not answer “nothing to tweak yet”');
assert(ops(every).every((o, i) => every.acts[i].credit === true), 'each rewrite is credited');

console.log('\n== …but only where the rewrite lands ==');
const targets = (every.acts || []).map((a) => a.type + '#' + a.idx);
INVISIBLE.forEach((kind) => assert(targets.every((t) => t.indexOf(kind + '#') !== 0), 'a ' + kind + ' is not rewritten'));
const faqIdx = small.sections.map((s, i) => (s.type === 'faq' ? i : -1)).filter((i) => i >= 0);
assert(faqIdx.length === 2 && faqIdx.every((i) => targets.indexOf('faq#' + i) !== -1), 'both faq sections are rewritten, by index');
assert(!small.sections.some((s, i) => s.type === 'map' && targets.indexOf('map#' + i) !== -1), 'the map is left alone by position too');

console.log('\n== The cap is disclosed, not silent ==');
const wide = page(['hero', 'about', 'cta', 'contact', 'features', 'faq', 'table', 'map']);
const capped = AI.chatPlan(wide, 'make every section punchier');
assert((capped.acts || []).length === 4, 'a wide scope is capped at four acts');
assert(Array.isArray(capped.notes) && capped.notes.length > 0, 'a capped scope says what it left out');
/* The count must be the sections the rewrite can actually change, not every
   section on the page — an inflated total claims work that was never possible. */
const claimed = Number((String(capped.notes[0]).match(/named (\d+) sections/) || [])[1]);
assert(claimed > 0 && claimed < wide.sections.length, 'the note counts copy sections, not every section (' + claimed + ' of ' + wide.sections.length + ')');
assert(!capped.notes || capped.notes.every((n) => String(n).indexOf('table') === -1), 'it does not offer to rewrite a table later');

console.log('\n== An uncapped scope stays quiet about credits ==');
const tidy = AI.chatPlan(page(['hero', 'about', 'cta']), 'make every section punchier');
assert((tidy.acts || []).length === 3, 'three copy sections give three acts');
assert(!tidy.notes || tidy.notes.length === 0, 'nothing is disclosed when nothing was withheld');

console.log('\n== A constraint vetoes the whole scope ==');
/* The scope path returns early, so it has to run the same veto the single-target
   path does — otherwise the wide case is the one place a constraint is ignored,
   which is the worst place for it. */
const opposed = AI.chatPlan(small, 'make every section punchier but keep the words');
assert((opposed.acts || []).length === 0, 'contradictory scope changes nothing');
assert(/two opposite things/i.test(opposed.reply || ''), 'and says why');

console.log('\n== Nothing that already worked is broken ==');
const bare = AI.chatPlan(small, 'make it shorter');
assert((bare.acts || []).length === 0 && /nothing to tweak/i.test(bare.reply || ''), 'a bare follow-up still needs context');
const one = AI.chatPlan(small, 'make the hero punchier');
assert((one.acts || []).length === 1 && one.acts[0].type === 'hero', 'one named section is still one act');
const ctx = AI.chatPlan(small, 'make it shorter', { targetType: 'hero' });
assert((ctx.acts || []).length === 1 && ctx.acts[0].mode === 'shorter', 'a remembered target still works');

console.log('\n== Removal scope, and multi-target copy ==');
const del = AI.chatPlan(small, 'delete every faq section');
const removed = (del.acts || []).filter((a) => a.op === 'removeSection').map((a) => a.idx);
assert(faqIdx.every((i) => removed.indexOf(i) !== -1), '“every faq” removes both faqs, and no others');
assert(removed.length === faqIdx.length, 'it removes exactly the faqs (got ' + removed.length + ')');
const both = AI.chatPlan(small, 'rewrite the about and faq copy');
assert((both.acts || []).length === 2, 'two named kinds give two acts');

if (failed) {
  console.error('\nai-scope-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-scope-smoke PASSED');
