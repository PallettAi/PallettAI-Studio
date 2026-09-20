#!/usr/bin/env node
'use strict';

// ============================================================
// Meaning engine smoke — data/ai-embed.js
// ------------------------------------------------------------
// This engine answers "which one is about what was asked for" everywhere in the
// studio, and it answers offline and deterministically. So the suite is weighted
// the same way: a handful of cases a person would call obviously right, the
// exact regressions that made earlier versions wrong, and the guards that keep a
// broken backend or an empty string from turning a ranking into noise.
//
// Every case here is a real query shape from the product: a scene query for a
// hero photo, a client's own sentence, the words a creator types into the
// command palette.
// ============================================================

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  \u2713 ' + msg); }
function fail(msg) { failed++; console.error('  \u2717 ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }
function eq(actual, expected, msg) {
  const ok = actual === expected;
  ok ? pass(msg) : fail(msg + ' \u2014 expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

let E;
try {
  E = require(path.join(ROOT, 'data', 'ai-embed.js'));
} catch (err) {
  console.error('ai-embed-smoke FAILED \u2014 module missing: ' + err.message);
  process.exit(1);
}

const rank = (q, items, opts) => E.rank(q, items, opts);

console.log('== Terms ==');
const t = E.terms('Wood-fired pizzeria in the Midlands');
assert(t.some((x) => x.term === 'pizzeria' && x.type === 'uni'), 'words survive into terms');
assert(t.some((x) => x.term === 'word fir' || x.term === 'wood fir'), 'adjacent words become a bigram, so word order counts');
assert(!t.some((x) => x.term === 'the' || x.term === 'in'), 'stop words are dropped');
assert(t.some((x) => x.type === 'concept' && x.concept === 'pizza'), 'a word can carry its concept');
assert(E.terms('x').length === 0, 'a one-letter word is not a feature');
eq(E.terms('services').filter((x) => x.type === 'uni')[0].term, 'service', 'plurals stem to the singular');
assert(E.terms('PIZZA').some((x) => x.term === 'pizza'), 'case is irrelevant');

console.log('\n== The concept layer is what makes it more than keywords ==');
const sim = (a, b) => E.score(a, b);
assert(sim('barber', 'hairdresser salon') > 0, 'a barber query reaches a salon whose title never says barber');
assert(sim('barber', 'sourdough bakery') === 0, 'unrelated trades share nothing at all');
assert(sim('plumber', 'plumbing') > 0, 'derivational forms link through the prefix feature \u2014 got ' + sim('plumber', 'plumbing'));
assert(sim('pizza', 'pizzeria') > 0, 'pizza reaches pizzeria');
assert(sim('barber', 'hairdresser salon') < sim('barber', 'barbershop near me'), 'a literal match still outranks a conceptual one');

console.log('\n== Ranking picks the obvious answer ==');
const CORPUS = [
  'Wood-fired pizzeria, family run since 1998',
  'Traditional barbershop, walk-ins welcome',
  'Emergency plumber, 24 hour callout',
  'Sourdough bakery and coffee bar',
  'Conveyancing solicitor for homes',
  'Strength and conditioning gym',
  'Village pub with a large beer garden',
  'Mobile dog groomer covering the Midlands'
];
const top = (q) => { const r = rank(q, CORPUS); return r[0] ? r[0].item : ''; };
[
  ['italian pizza oven', 'pizzeria'],
  ['hairdresser appointment', 'barbershop'],
  ['burst pipe emergency', 'plumber'],
  ['homemade bread and cakes', 'bakery'],
  ['someone to trim the dog', 'dog groomer'],
  ['conveyancing for our first house', 'solicitor'],
  ['weights and a treadmill', 'gym']
].forEach(([q, expect]) => {
  const got = top(q);
  assert(got.indexOf(expect) !== -1, '"' + q + '" \u2192 ' + expect + (got ? '' : ' (nothing matched)'));
});

console.log('\n== The two regressions that made earlier versions wrong ==');
// A pizza oven is not a bakery. "oven" was filed under the bakery concept once,
// which sent an oven query to a sourdough doc.
assert(top('italian pizza oven').indexOf('pizzeria') !== -1, 'a pizza oven query does not land on a bakery');
// A long, informative title must not be punished for being descriptive. Pure
// cosine diluted it below a three-word doc that shared one stray word, so
// ranking fell back on query coverage.
assert(top('a quiet pint outside').indexOf('pub') !== -1, 'a long title is not beaten by a shorter, less relevant one');
// A coffee BAR is not a pub. "bar" was in the drink bucket and the pub query
// ranked a bakery first.
assert(rank('a quiet pint outside', CORPUS).every((r) => r.item.indexOf('bakery') === -1 || r.score < 0.05),
  'a coffee bar is not treated as somewhere to get a pint');

console.log('\n== Thresholds and the empty cases ==');
assert(rank('zzzqqq nonsense gibberish', CORPUS).length === 0, 'a query that matches nothing returns nothing');
assert(rank('', CORPUS).length === 0, 'an empty query returns nothing');
assert(rank('plumber', []).length === 0, 'an empty list returns nothing');
eq(E.score('', 'anything'), 0, 'scoring an empty query is zero, not a crash');
eq(E.score('anything', ''), 0, 'scoring an empty candidate is zero');
eq(rank(null, CORPUS).length, 0, 'a null query is handled');
assert(E.vector('').every((x) => x === 0), 'an empty string encodes to a zero vector');
eq(E.vector('barber').length, E.DIM, 'every vector is the advertised width');
assert(rank('plumber', CORPUS, { min: 0.9 }).length === 0, 'a high floor filters everything out');
assert(rank('plumber', CORPUS, { limit: 1 }).length <= 1, 'limit is honoured');

console.log('\n== Ranking is monotone and explainable ==');
const ranked = rank('family run bakery with good coffee', CORPUS);
assert(ranked.length >= 2, 'a query that touches two documents returns both, so a caller can choose — got ' + ranked.length);
let monotone = true;
for (let i = 1; i < ranked.length; i++) if (ranked[i].score > ranked[i - 1].score) monotone = false;
assert(monotone, 'results arrive in descending score order');
assert(ranked[0].why.length > 0, 'the top hit says why it was picked \u2014 got ' + JSON.stringify(ranked[0].why));
assert(ranked[0].why.every((w) => typeof w === 'string' && w.length), 'the reasons are words, not objects');
assert(ranked[0].index === CORPUS.indexOf(ranked[0].item), 'each hit carries the index it came from, so callers can map back');
assert(E.why('nothing at all relevant here', 'sourdough bakery').length === 0, 'no shared words means no claimed reason');

console.log('\n== Text extraction ==');
const objRank = rank('pizza oven', [{ name: 'Wood fired pizza', url: 'x' }, { name: 'Office supplies' }]);
assert(objRank.length && objRank[0].item.name === 'Wood fired pizza', 'objects are searched on their name');
const custom = rank('cost', [{ a: 'The cost of a rebuild', b: 1 }], { text: (x) => x.a });
assert(custom.length === 1, 'a caller can supply its own text extractor');

console.log('\n== IDF from the studio\u2019s own corpus ==');
const corpusDocs = [
  'Willow Cafe — coffee shop in Derby',
  'Willow Cafe — coffee shop in Derby',
  'Willow Cafe — coffee shop in Derby',
  'Peak Plumbing — emergency plumber in Derby'
];
const fitInfo = E.fit(corpusDocs);
assert(fitInfo.docs === 4 && fitInfo.terms > 0, 'fit reports what it learned \u2014 ' + JSON.stringify(fitInfo));
assert(E.stats().terms > 0, 'stats reports the fitted vocabulary');
const fitted = rank('emergency plumber', ['Willow Cafe coffee shop', 'Peak Plumbing emergency plumber']);
assert(fitted.length && fitted[0].item.indexOf('Peak') !== -1, 'a rare word decides once common words are discounted');
let t0 = Date.now();
for (let i = 0; i < 2000; i++) rank('coffee shop in derby', ['Willow Cafe \u2014 coffee shop in Derby']);
assert(Date.now() - t0 < 4000, 'fitting does not make ranking slow \u2014 ' + (Date.now() - t0) + 'ms for 2000 runs');

console.log('\n== A model backend can be registered later, and cannot break this ==');
eq(E.modelInfo(), null, 'no backend is registered by default');
// Captured before any backend exists: the fallback has to land on exactly this
// number, or a model that fails to load would silently change every ranking.
const lexicalBaseline = E.score('barber', 'barbershop');
const dims = { name: 'fake-encoder', dim: 8, vector: () => Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0]) };
assert(E.useModel(dims) && E.useModel(dims).name === 'fake-encoder', 'a backend is accepted and reported');
eq(E.vector('anything').length, 8, 'vectors come from the backend once registered');
eq(E.score('a', 'b'), 1, 'identical backend vectors score 1');
assert(E.useModel({ name: 'broken', vector: () => { throw new Error('no model files'); } }) !== null, 'a backend that throws is still accepted');
assert(E.score('barber', 'barbershop') > 0, 'a throwing backend falls back instead of taking the feature down');
eq(E.score('barber', 'barbershop'), lexicalBaseline, 'the fallback scores exactly as it did before the backend arrived');
eq(E.useModel(null), null, 'a backend can be removed');
eq(E.modelInfo(), null, 'and the engine reports no model again');
assert(E.score('barber', 'barbershop') > 0, 'the lexical space is intact afterwards');

console.log('\n== Determinism and cost ==');
const first = Array.from(E.vector('wood fired pizza oven'));
const second = Array.from(E.vector('wood fired pizza oven'));
eq(JSON.stringify(first), JSON.stringify(second), 'the same text always encodes to the same vector');
eq(E.score('barber', 'barbershop'), E.score('barber', 'barbershop'), 'scoring is repeatable');
const many = [];
for (let i = 0; i < 500; i++) many.push('Client ' + i + ' \u2014 plumber in ' + ['Leeds', 'Derby', 'Nottingham'][i % 3] + ', boilers and bathrooms');
E.fit(many);
t0 = Date.now();
const bigRank = rank('emergency boiler repair', many, { limit: 5 });
const ms = Date.now() - t0;
assert(bigRank.length > 0 && bigRank.length <= 5, 'a 500-project library ranks and respects the limit');
assert(ms < 250, 'ranking 500 projects stays under a quarter second \u2014 ' + ms + 'ms');
assert(E.DIM >= 256 && E.DIM <= 4096, 'the vector width stays a sane size \u2014 ' + E.DIM);

console.log('\n== Concept slots cannot collide ==');
const slots = Object.values(E.CONCEPT_SLOT);
eq(new Set(slots).size, slots.length, 'every concept owns a distinct slot');
assert(slots.every((s) => s >= 0 && s < E.DIM), 'every concept slot is inside the vector');
assert(Object.keys(E.CONCEPTS).length === slots.length, 'each concept in the table is addressable');

if (failed) {
  console.error('\nai-embed-smoke FAILED \u2014 ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-embed-smoke PASSED');
