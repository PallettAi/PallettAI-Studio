#!/usr/bin/env node
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

let Compose;
try {
  Compose = require(path.join(ROOT, 'data', 'ai-compose.js'));
} catch (e) {
  console.error('ai-compose-smoke FAILED — module missing: ' + e.message);
  process.exit(1);
}

const { loadAI } = require(path.join(ROOT, 'scripts', 'load-ai.js'));
const AI = loadAI();

console.log('== Family map ==');
assert(Compose.familyFor('food', 'pizzeria') === 'menu-first', 'pizzeria is menu-first');
assert(Compose.familyFor('home', 'plumber') === 'proof-first', 'plumber is proof-first');

console.log('\n== Food home is menu/gallery first ==');
const pizza = AI.generateSite('wood fired pizza restaurant', { onePager: true, photoMode: 'real' });
const pizzaTypes = (pizza.site.sections || []).map((s) => s.type);
const pFeat = pizzaTypes.indexOf('features');
const pGal = pizzaTypes.indexOf('gallery');
const pTable = pizzaTypes.indexOf('table');
assert(pizzaTypes[0] === 'hero', 'hero stays first');
assert(pFeat === -1 || (pTable !== -1 && pTable < pFeat) || (pGal !== -1 && pGal < pFeat),
  'food puts table or gallery before features — ' + pizzaTypes.join(','));
const pizzaHero = (pizza.site.sections || []).find((s) => s.type === 'hero') || {};
assert(pizzaHero.layout !== 'aurora', 'food + real photos never uses aurora hero');

console.log('\n== Trades are proof-first ==');
const plumber = AI.generateSite('emergency plumber in Leeds', { onePager: true, photoMode: 'real' });
const plTypes = (plumber.site.sections || []).map((s) => s.type);
const f = plTypes.indexOf('features');
const st = plTypes.indexOf('stats');
const te = plTypes.indexOf('testimonials');
assert(f === -1 || (st !== -1 && st < f) || (te !== -1 && te < f),
  'plumber puts stats or testimonials before features — ' + plTypes.join(','));

console.log('\n== Copy scrub ==');
const hero = (pizza.site.sections || []).find((s) => s.type === 'hero') || {};
assert(!/makes a difference/i.test(hero.text || ''), 'hero text is not the stock “makes a difference” line');
assert(!/^Welcome to /i.test(pizza.site.eyebrow || ''), 'eyebrow is not Welcome to {brand}');

console.log('\n== Stable logo spec ==');
const specA = AI.randomLogoSpec({ site: { name: 'LeakStop', palette: 'paper', font: 'inter', fingerprint: { seed: 42 } } });
const specB = AI.randomLogoSpec({ site: { name: 'LeakStop', palette: 'paper', font: 'inter', fingerprint: { seed: 42 } } });
assert(specA.style === specB.style && specA.shape === specB.shape && specA.seed === specB.seed, 'same fingerprint seed → same logo spec');
assert(pizza.site.logo && String(pizza.site.logo).indexOf('data:image/svg') === 0, 'generateSite attaches a logo');

if (failed) {
  console.error('\nai-compose-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-compose-smoke PASSED');
