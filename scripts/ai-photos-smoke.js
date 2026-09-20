#!/usr/bin/env node
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

let Photos;
try {
  Photos = require(path.join(ROOT, 'data', 'ai-photos.js'));
} catch (e) {
  console.error('ai-photos-smoke FAILED — module missing: ' + e.message);
  process.exit(1);
}

console.log('== Reject cheap stock ==');
assert(Photos.isRejected({ url: 'https://x.test/a.jpg', title: 'Flag of Italy map', w: 2000, h: 1200 }, 'hero'), 'diagram/flag/map titles are rejected');
assert(!Photos.isRejected({ url: 'https://x.test/pizza.jpg', title: 'Wood fired pizza close up', w: 1600, h: 900 }, 'hero'), 'real food photo is kept');

console.log('\n== Skip first results ==');
const pool = [
  { url: 'u0', title: 'first', w: 1600, h: 900 },
  { url: 'u1', title: 'second', w: 1600, h: 900 },
  { url: 'u2', title: 'wood fired pizza oven', w: 1800, h: 1000 },
  { url: 'u3', title: 'pizza close up', w: 1600, h: 900 },
  { url: 'u4', title: 'blistered crust', w: 1700, h: 950 }
];
const ranked = Photos.rank(pool, { slot: 'hero' });
const urls = ranked.map((c) => c.url);
assert(urls.indexOf('u0') === -1 && urls.indexOf('u1') === -1, 'first two pool items are never selected when 3+ remain');
assert(urls.indexOf('u2') !== -1, 'later candidates remain');

console.log('\n== Aspect prefers engaging hero ==');
const aspects = Photos.rank([
  { url: 'wide', title: 'kitchen service', w: 1600, h: 900 },
  { url: 'tall', title: 'kitchen service', w: 1300, h: 1800 }
], { slot: 'hero' });
assert(aspects[0] && aspects[0].url === 'wide', 'hero prefers 1600x900 over a tall frame');

console.log('\n== Dedupe ==');
const deduped = Photos.rank([
  { url: 'same', title: 'Pizza oven night', w: 1600, h: 900 },
  { url: 'other', title: 'Pizza oven night', w: 1700, h: 960 }
], { slot: 'hero', usedUrls: ['same'] });
assert(deduped.every((c) => c.url !== 'same'), 'used URL cannot occupy another slot');

console.log('\n== Meaning: the brief decides, not just the title ==');
// Both candidates are the same size and both are real photos, so nothing in the
// bitmap scoring can separate them. Only the brief can, and only the brief should.
const meaningPool = [
  { url: 'office', title: 'Modern office interior', src: 'openverse', w: 1600, h: 900 },
  { url: 'oven', title: 'Wood fired pizza oven close up', src: 'openverse', w: 1600, h: 900 }
];
const noBrief = Photos.rank(meaningPool.map((c) => ({ ...c })), { slot: 'hero' });
assert(noBrief.every((c) => c.why.length === 0), 'with no brief there is nothing to explain — so nothing is claimed');
const withBrief = Photos.rank(meaningPool.map((c) => ({ ...c })), { slot: 'hero', brief: 'a wood fired pizza oven, family run since 1998' });
assert(withBrief[0] && withBrief[0].url === 'oven', 'the brief picks the relevant candidate over an identical-size office');
assert(withBrief[0].why.indexOf('pizzeria') !== -1 || withBrief[0].why.indexOf('pizza') !== -1 || withBrief[0].why.indexOf('wood') !== -1,
  'the match is explained in the candidate\u2019s own words — got ' + JSON.stringify(withBrief[0].why));
// An irrelevant brief must not move a single score: the bitmap facts still
// decide, exactly as they would with no brief at all.
const offBrief = Photos.rank(meaningPool.map((c) => ({ ...c })), { slot: 'hero', brief: 'emergency plumber for a burst pipe' });
assert(JSON.stringify(offBrief.map((c) => c.score)) === JSON.stringify(noBrief.map((c) => c.score)),
  'a brief that matches neither candidate changes no score');
assert(offBrief.every((c) => c.why.length === 0), 'an irrelevant brief explains nothing rather than guessing');
// Meaning is a tiebreaker, not a licence to ignore the bitmap facts: a huge,
// well-matched photo still beats a tiny, better-matched one for a hero slot.
const sizeStillWins = Photos.rank([
  { url: 'big', title: 'Pizza oven', src: 'openverse', w: 2000, h: 1200 },
  { url: 'small', title: 'Wood fired pizza oven close up', src: 'openverse', w: 1201, h: 900 }
], { slot: 'hero', brief: 'wood fired pizza oven' });
assert(sizeStillWins[0] && sizeStillWins[0].url === 'big', 'resolution still outranks a marginally better word match');
assert(typeof Photos.meaningOf === 'function' && Photos.meaningOf({ title: 'x' }, '').weight === 0, 'meaningOf is inert without a brief');

console.log('\n== Scene expansion ==');
const expanded = Photos.expandScenes({ gallery: 'pizza' });
assert(expanded.gallery.length >= 3, 'string gallery expands to at least 3 queries — got ' + expanded.gallery.length);
assert(expanded.hero.length >= 1 && expanded.about.length >= 1, 'hero and about lists exist');

if (failed) {
  console.error('\nai-photos-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-photos-smoke PASSED');
