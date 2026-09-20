'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const Catalog = require(path.join(ROOT, 'data', 'ai-template-catalog.js'));
const DB = require(path.join(ROOT, 'data', 'db.js'));
const { loadAI } = require('./load-ai.js');
const AI = loadAI();
let failed = 0;
const ok = (condition, message) => {
  if (condition) console.log('  ✓ ' + message);
  else { failed++; console.error('  ✗ ' + message); }
};

console.log('== AI template blueprint catalogue ==');
ok(Catalog.BLUEPRINTS.length >= 20, 'catalogue contains at least twenty original blueprints');
ok(new Set(Catalog.BLUEPRINTS.map((x) => x.id)).size === Catalog.BLUEPRINTS.length, 'blueprint ids are unique');
ok(Catalog.BLUEPRINTS.every((x) => x.name && x.category && x.blurb && x.signature), 'every blueprint has usable presentation metadata');
ok(Catalog.BLUEPRINTS.every((x) => Array.isArray(x.order) && x.order.length >= 6), 'every blueprint has a substantial page rhythm');
ok(Catalog.BLUEPRINTS.every((x) => x.design && x.design.containerWidth >= 960 && x.design.radius >= 0 && x.design.spacing >= 32), 'every blueprint carries legal geometry');
ok(Catalog.categories().length >= 12, 'blueprints cover at least twelve customer categories');
ok(Catalog.BLUEPRINTS.every((item) => Object.entries(item.layouts || {}).every(([type, layout]) => DB.layoutsFor(type).some((variant) => variant.id === layout))), 'every blueprint layout is supported by the renderer');
ok(Catalog.BLUEPRINTS.every((item) => item.order.every((type) => !!DB.sectionTypes[type])), 'every blueprint rhythm uses known section types');

console.log('\n== Direction lab integration ==');
const directions = AI.generateDirections('a premium creative studio in Bristol', { tier: 'free', name: 'North Star' , salt: 41 });
ok(directions.length === AI.DIRECTION_PROFILES.length && directions.length >= 14, 'direction lab exposes the full professional direction set');
ok(directions.every((x) => x.templateBlueprint && Catalog.get(x.templateBlueprint.id)), 'every direction is backed by a real blueprint');
ok(new Set(directions.map((x) => x.templateBlueprint.id)).size === directions.length, 'directions use distinct blueprint identities');
ok(directions.every((x) => x.site && x.site.sections.some((s) => s.type === 'hero')), 'every blueprint keeps a renderable hero');
ok(directions.every((x) => x.site && x.site.sections.some((s) => s.type === 'contact')), 'every blueprint keeps a contact path');
ok(directions.every((x) => JSON.stringify(x).length < 900000), 'blueprint metadata stays within project size budget');

if (failed) process.exit(1);
console.log('\nai-template-catalog-smoke PASSED');
