#!/usr/bin/env node
'use strict';

const { loadAI } = require('./load-ai.js');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const IDS = [
  'plumber', 'electrician', 'solicitor', 'dentist', 'accountant', 'tutor',
  'estateagent', 'landscaper', 'vet', 'physio', 'nursery', 'pub', 'winebar',
  'hotel', 'garage', 'tattoo', 'architect', 'locksmith', 'catering', 'brewery'
];

const HITS = [
  ['emergency plumber in Leeds', 'plumber'],
  ['NICEIC electrician in York', 'electrician'],
  ['family law solicitor in Manchester', 'solicitor'],
  ['private dentist in Bath', 'dentist'],
  ['self assessment accountant', 'accountant'],
  ['maths tutor in Bristol', 'tutor'],
  ['estate agent in Leeds', 'estateagent'],
  ['garden landscaper in York', 'landscaper'],
  ['small animal vet in Leeds', 'vet'],
  ['sports physio clinic', 'physio'],
  ['day nursery in Leeds', 'nursery'],
  ['gastropub in York', 'pub'],
  ['natural wine bar in Leeds', 'winebar'],
  ['boutique hotel in Bath', 'hotel'],
  ['MOT garage in Leeds', 'garage'],
  ['custom tattoo studio', 'tattoo'],
  ['residential architect in York', 'architect'],
  ['24 hour locksmith', 'locksmith'],
  ['wedding catering in Leeds', 'catering'],
  ['craft brewery taproom', 'brewery']
];

const AI = loadAI();

console.log('== 20 extra niche ids ==');
IDS.forEach((id) => {
  const site = AI.generateSite(id === 'estateagent' ? 'estate agent' : id);
  assert(site.aiNicheId === id, id + ' pack is registered — got "' + site.aiNicheId + '"');
});

console.log('\n== Keyword matching ==');
HITS.forEach(([prompt, id]) => {
  const site = AI.generateSite(prompt);
  assert(site.aiNicheId === id, '"' + prompt + '" → ' + id + ' (got "' + site.aiNicheId + '")');
});

console.log('\n== Existing packs still win ==');
assert(AI.generateSite('wood fired pizza restaurant').aiNicheId === 'pizzeria', 'pizza is not stolen by new packs');
assert(AI.generateSite('specialty coffee roastery').aiNicheId === 'coffee', 'coffee is not stolen by new packs');

const pub = AI.generateSite('gastropub in York', { brief: { name: 'The Anchor', offer: 'Cask ale and Sunday roast' } });
const slugs = (pub.site.pages || []).map((p) => p.slug);
assert(slugs.indexOf('menu') !== -1, 'pub with a filled brief gets a Menu page');

if (failed) {
  console.error('\nai-niche-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-niche-smoke PASSED');
