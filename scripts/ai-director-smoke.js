'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Director = require('../data/ai-director.js');
const { loadAI } = require('./load-ai.js');

let passed = 0;
function ok(name, value) { assert.ok(value, name); passed++; console.log('  ✓ ' + name); }

console.log('== Local Director plan ==');
const plan = Director.compile({
  prompt: 'A friendly neighbourhood barber taking bookings',
  typeId: 'beauty',
  nicheId: 'barber',
  seed: 44,
  brief: {
    name: 'North Line Barber',
    area: 'Leeds',
    offer: 'Classic cuts and beard trims',
    cta: 'Book a chair',
    proofs: ['Same barber every visit', 'Open late on Thursdays']
  },
  factLedger: { clientFacts: [{ key: 'area', value: 'Leeds', confidence: 'client' }] },
  creativeBrief: { personality: 'tactile', goal: 'book' }
});
ok('compiles a versioned strategy', plan.version === 1 && plan.source === 'local-director');
ok('infers a primary customer job', ['book', 'contact', 'learn'].includes(plan.primaryJob));
ok('keeps the conversion path bounded', Array.isArray(plan.path) && plan.path.length <= 8);
ok('creates visual guardrails', plan.visual && plan.visual.avoid.includes('generic hero stock'));
ok('retains client fact provenance only', plan.factsUsed.includes('area'));
ok('compiled plan validates', Director.validate(plan).ok === true);
ok('plan text is searchable', Director.planText(plan).includes(plan.primaryJob));
ok('conversion map identifies required sections', plan.conversion && plan.conversion.requiredSections.includes('contact'));
ok('every strategy receives a signature moment', plan.signatureMoment && plan.signatureMoment.target && plan.signatureMoment.layout);
const forced = Director.compile({ prompt: 'a bakery', typeId: 'food', seed: 12, brief: {}, creativeBrief: { goal: 'buy', signature: 'menu-reveal' } });
ok('the user can override the inferred visitor action', forced.primaryJob === 'buy');
ok('the user can choose the signature moment', forced.signatureMoment.id === 'menu-reveal');

console.log('\n== Private semantic retrieval ==');
const docs = [
  { id: 'hero', type: 'hero', title: 'Book a chair', text: 'Appointments for classic cuts and beard trims' },
  { id: 'faq', type: 'faq', title: 'Questions', text: 'Opening hours, parking and walk-ins' },
  { id: 'gallery', type: 'gallery', title: 'Recent work', text: 'Finished fades and beard styling' }
];
const hits = Director.retrieve('where can I book a beard trim', docs, { limit: 2 });
ok('ranks relevant content first', hits[0] && hits[0].doc.id === 'hero');
ok('returns bounded results', hits.length === 2);
const route = Director.route({ sections: docs }, 'show me the beard styling work');
ok('routes Copilot to an exact section', route.hits[0] && route.hits[0].id === 'gallery');
ok('route confidence is numeric', typeof route.confidence === 'number');

console.log('\n== Generated project wiring ==');
const AI = loadAI();
const project = AI.generateSite('a local barber taking bookings', { salt: 91, layouts: 'auto', tier: 'free', onePager: true });
ok('AI exposes the Director route', typeof AI.copilotRoute === 'function');
ok('generated site stores the Director plan', !!project.site.directorPlan);
ok('generated plan passes validation', Director.validate(project.site.directorPlan).ok === true);
ok('generated site keeps composition metadata', !!project.site.composition);
ok('generated site receives a tangible signature moment', !!project.site.signatureMoment && project.site.signatureMoment.target);

const evaluation = Director.evaluate(project, 'make the booking section clearer');
ok('evaluation checks the generated intelligence layers', evaluation.score >= 80);
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
ok('AI Studio exposes the strategy receipt', appSource.includes('strategyReceipt') && appSource.includes('Why this site is shaped this way'));
ok('the receipt explains the signature moment', appSource.includes('Signature moment') && appSource.includes('Primary visitor action'));
ok('the receipt is responsive and collapsible', cssSource.includes('.strategy-receipt') && cssSource.includes('.strategy-grid'));
ok('the receipt offers editable strategy controls', appSource.includes('openStrategyEditor') && appSource.includes('Generate revised direction'));
ok('strategy controls have responsive styling', cssSource.includes('.strategy-editor-grid') && cssSource.includes('.strategy-editor-foot'));

console.log('\nAI DIRECTOR SMOKE PASSED: ' + passed + ' checks');
