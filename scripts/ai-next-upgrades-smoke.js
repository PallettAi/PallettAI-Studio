#!/usr/bin/env node
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const Facts = require(path.join(ROOT, 'data', 'ai-facts.js'));
const Reference = require(path.join(ROOT, 'data', 'ai-reference.js'));
const Art = require(path.join(ROOT, 'data', 'ai-art-direction.js'));
const { loadAI } = require(path.join(ROOT, 'scripts', 'load-ai.js'));
const AI = loadAI();
let failed = 0;
function assert(ok, msg) { if (ok) console.log('  ✓ ' + msg); else { failed++; console.error('  ✗ ' + msg); } }

console.log('== Fact ledger provenance ==');
const facts = Facts.build({
  brief: { name: 'Northwind', area: 'Leeds', offer: 'Fixed-price repairs', cta: 'Book now', proofs: ['Insured'] },
  website: { brand: 'Old Name', email: 'hello@example.com', services: [{ title: 'Boiler repair' }] },
  studied: [{ url: 'https://reference.example', services: [{ title: 'Competitor service' }] }]
});
assert(facts.version === 1, 'ledger has a version');
assert(facts.clientFacts.some((x) => x.key === 'business name' && x.value === 'Northwind'), 'client facts win identity provenance');
assert(facts.extractedFacts.some((x) => x.key === 'email'), 'extracted contact facts are recorded');
assert(facts.referenceFacts.every((x) => x.use === 'inspiration-only'), 'reference facts are never claim-ready');
assert(facts.entries.length <= Facts.FACT_LIMITS.max, 'ledger is bounded');

console.log('== Reference distance ==');
const project = { site: { tagline: 'Thoughtful repairs for local homes', description: 'Insured local repair team', sections: [{ title: 'Boiler repair', text: 'Fixed price repairs' }] } };
const distant = Reference.assess(project, [{ url: 'https://r.example', tagline: 'A completely different studio', text: 'Portraits and gallery work', services: [{ title: 'Photography' }] }]);
assert(distant.safe === true && distant.distance > 45, 'unrelated reference remains safely distant');
const close = Reference.assess(project, [{ url: 'https://r.example', tagline: project.site.tagline, text: project.site.description, services: [{ title: 'Boiler repair' }] }]);
assert(close.safe === false && close.highestOverlap >= 55, 'near-copy reference is flagged');
const protectedReport = Reference.protect(project, [{ url: 'https://r.example', text: 'A reference' }]);
assert(project.site.referenceGuard === protectedReport, 'distance receipt is persisted on the site');

console.log('== Art direction ==');
const art = Art.directionFor('food', 'editorial', 7);
assert(art.version === 1 && art.lighting && art.framing && art.prompt, 'art direction has usable prompt guidance');
assert(art.avoid.includes('logos'), 'art direction forbids generated logos in imagery');

console.log('== Generation carries the new receipts ==');
const generated = AI.generateSite('a bakery in Leeds', { onePager: true, name: 'Northwind', brief: { name: 'Northwind', area: 'Leeds', offer: 'Fresh bread', cta: 'Order now', proofs: [] }, studied: [{ url: 'https://reference.example', brand: 'Reference', services: [{ title: 'Wholesale bread' }] }] });
assert(generated.site.factLedger && generated.site.factLedger.clientFacts.length > 0, 'generated project carries fact provenance');
assert(generated.site.referenceGuard && generated.site.referenceGuard.policy, 'generated project carries reference protection');
assert(generated.site.imageDirection && generated.site.imageDirection.prompt, 'generated project carries image art direction');
assert(generated.site.referenceGuard.highestOverlap < 100, 'reference receipt is measured, not a copied claim');

if (failed) process.exit(1);
console.log('AI NEXT UPGRADES SMOKE PASSED');
