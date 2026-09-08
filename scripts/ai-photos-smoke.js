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

console.log('\n== Scene expansion ==');
const expanded = Photos.expandScenes({ gallery: 'pizza' });
assert(expanded.gallery.length >= 3, 'string gallery expands to at least 3 queries — got ' + expanded.gallery.length);
assert(expanded.hero.length >= 1 && expanded.about.length >= 1, 'hero and about lists exist');

if (failed) {
  console.error('\nai-photos-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-photos-smoke PASSED');
