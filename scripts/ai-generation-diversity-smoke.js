'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadAI } = require('./load-ai.js');
const AI = loadAI();
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let passed = 0;
function ok(name, value) { assert.ok(value, name); passed++; console.log('  ✓ ' + name); }

console.log('== Brief interview and direction affordances ==');
ok('brief interview does not require a prompt first', !/openCreativeInterview\(\)[\s\S]{0,260}if \(!prompt\) return toast/.test(app));
ok('brief interview asks eight creative questions', (app.match(/id="creative[A-Z][A-Za-z]+"/g) || []).length >= 8);
ok('direction lab has a useful blank-brief fallback', app.includes("'a distinctive, memorable business website'"));

console.log('\n== Same brief gets genuinely different sites ==');
const signatures = new Set();
const looks = new Set();
const orders = new Set();
const motion = new Set();
for (let salt = 1; salt <= 16; salt++) {
  const project = AI.generateSite('a local florist for weddings', { salt, tier: 'free', layouts: 'auto', onePager: true });
  const sections = project.site.sections || [];
  signatures.add(sections.map((s) => s.type + ':' + (s.layout || '') + ':' + (s.animation || '')).join('>'));
  looks.add(project.dnaLook);
  orders.add(sections.map((s) => s.type).join('>'));
  motion.add(sections.map((s) => s.animation || 'none').join('>'));
}
ok('sixteen fresh builds produce at least eight structural signatures', signatures.size >= 8);
ok('fresh builds use at least four visual looks', looks.size >= 4);
ok('fresh builds use at least six page orders', orders.size >= 6);
ok('fresh builds use at least six distinct motion signatures', motion.size >= 6);

console.log('\n== Explicit blueprint changes composition ==');
const signal = AI.generateSite('a software product for teams', { blueprintId: 'signal-house', salt: 31, tier: 'pro', layouts: 'auto', onePager: true });
const still = AI.generateSite('a software product for teams', { blueprintId: 'still-life', salt: 31, tier: 'pro', layouts: 'auto', onePager: true });
ok('selected blueprint is recorded', signal.site.blueprint && signal.site.blueprint.id === 'signal-house');
ok('different blueprints change the page signature', signal.site.sections.map((s) => s.type + ':' + (s.layout || '')).join('>') !== still.site.sections.map((s) => s.type + ':' + (s.layout || '')).join('>'));

console.log('\nai-generation-diversity-smoke PASSED: ' + passed + ' checks');
