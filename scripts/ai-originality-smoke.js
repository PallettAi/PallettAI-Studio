'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Originality = require('../data/ai-originality.js');
const { loadAI } = require('./load-ai.js');
let passed = 0;
function ok(name, value) { assert.ok(value, name); passed++; console.log('  ✓ ' + name); }

console.log('== Fingerprints and distance ==');
const a = { id: 'a', site: { name: 'Northline', palette: 'aurora', font: 'Inter', sections: [{ type: 'hero', layout: 'split' }, { type: 'features', layout: 'bento' }] } };
const b = { id: 'b', site: { name: 'Southline', palette: 'noir', font: 'Fraunces', sections: [{ type: 'hero', layout: 'minimal' }, { type: 'gallery', layout: 'mosaic' }] } };
const same = Originality.distance(a, a);
const different = Originality.distance(a, b);
ok('same project has zero distance', same.score === 0);
ok('different visual language has positive distance', different.score > 0);
ok('fingerprint is compact and stable', Originality.fingerprint(a).key === Originality.fingerprint(a).key);
ok('grammar catalogue has real alternatives', Originality.ORIGINALITY_GRAMMARS.length >= 8);

console.log('\n== Reference protection ==');
const ref = Originality.referenceDistance(a, [{ url: 'https://example.com', text: 'Northline aurora Inter hero split features bento' }]);
ok('reference report is bounded', ref.matches.length === 1 && ref.matches[0].similarity <= 1);
ok('reference safety is explicit', typeof ref.safe === 'boolean');

console.log('\n== Generated project originality ==');
const AI = loadAI();
const project = AI.generateSite('a distinctive local florist with wedding flowers', { salt: 77, layouts: 'auto', tier: 'free', onePager: true, existingProjects: [a, b] });
ok('AI exposes originality reporting', typeof AI.originalityReport === 'function');
ok('generated site carries originality metadata', !!project.site.originality);
ok('originality score is in range', project.site.originality.score >= 0 && project.site.originality.score <= 100);
ok('originality metadata records a grammar', !!project.site.originality.grammar);
const report = AI.originalityReport(project, [a, b], []);
ok('report validates after generation', Originality.validate(report));
const gated = Originality.candidateGate(project, [a, b], [], { seed: 404, candidates: 5 });
ok('candidate gate evaluates multiple directions', gated.candidates >= 3);
ok('candidate gate records rejected creative directions', Array.isArray(gated.rejectedGrammars));
ok('candidate gate keeps the selected report valid', Originality.validate(gated.report));
const remembered = Originality.candidateGate(project, [{ site: { originality: { grammar: gated.project.site.originality.grammar } } }], [], { seed: 404, candidates: 5, memory: { rejectedGrammars: [gated.project.site.originality.grammar] } });
ok('creative memory avoids a previously used grammar when alternatives exist', remembered.project.site.originality.grammar !== gated.project.site.originality.grammar || Originality.ORIGINALITY_GRAMMARS.length <= 1);
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
ok('AI Studio exposes the visible originality report', appSource.includes('originalityResultCard') && appSource.includes('Originality'));
ok('the report offers another-direction regeneration', appSource.includes('aiRegenerate') && appSource.includes('Generate another direction'));
ok('the report has a dedicated visual treatment', cssSource.includes('.originality-report') && cssSource.includes('.originality-meter'));
ok('AI Studio exposes the adaptive brief interview', appSource.includes('openCreativeInterview') && appSource.includes('creativeGoal') && appSource.includes('creativePersonality'));
ok('interview answers reach generation options', appSource.includes('creativeBrief: creativeBrief || undefined'));
ok('the interview has responsive styling', cssSource.includes('.creative-interview-grid') && cssSource.includes('@media(max-width:600px)'));

console.log('\nAI ORIGINALITY SMOKE PASSED: ' + passed + ' checks');
