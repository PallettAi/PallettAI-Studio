#!/usr/bin/env node
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadAI } = require('./load-ai.js');
global.AI = loadAI();
global.AiDirector = require(path.join(ROOT, 'data', 'ai-director.js'));
const Intelligence = require(path.join(ROOT, 'data', 'studio-intelligence.js'));
let failed = 0;
function ok(condition, message) { if (!condition) { failed++; console.error('✗ ' + message); } else console.log('✓ ' + message); }
const project = { id: 'p1', site: { name: 'North Star Studio', type: 'creative', description: 'Brand identity and digital design for thoughtful businesses', tagline: 'Make the important things clear', ctaText: 'Start a project', sections: [
  { id: 'hero', type: 'hero', title: 'North Star Studio', subtitle: 'Design with direction', items: [] },
  { id: 'about', type: 'about', title: 'A small studio', text: 'We help teams make useful things.', items: [] },
  { id: 'cta', type: 'cta', title: 'Start a project', text: 'Tell us what you are building.', items: [] }
] } };
console.log('== registry ==');
ok(Intelligence.SKILLS.length === 3, 'three Studio Intelligence skills are registered');
ok(Intelligence.skill('director').cost === 1, 'art direction has an explicit one-credit cost');
ok(Intelligence.skill('critique').cost === 0, 'critique is free to run');
ok(Intelligence.matchCommand('/director').skill === 'director', 'director slash command resolves');
ok(Intelligence.matchCommand('/repair now').skill === 'repair', 'repair command accepts arguments');
ok(!Intelligence.matchCommand('director'), 'plain text does not trigger a skill');
console.log('\n== art director ==');
const before = JSON.stringify(project);
const direction = Intelligence.artDirection(project, 'A calm, editorial identity for an independent design studio');
ok(direction.ok && direction.strategy && direction.strategy.signatureMoment, 'art director returns a typed strategy');
ok(direction.receipt.preferred.length <= 4 && direction.receipt.avoid.length <= 4, 'art direction receipt is bounded');
ok(JSON.stringify(project) === before, 'art direction does not mutate the project');
console.log('\n== critique ==');
const critique = Intelligence.critique(project);
ok(critique.ok && typeof critique.score === 'number', 'critique returns a quality score');
ok(critique.findings.length <= Intelligence.LIMIT.findings, 'critique findings are bounded');
ok(JSON.stringify(project) === before, 'critique audits a clone and leaves the project unchanged');
console.log('\n== repair plan ==');
const plan = Intelligence.repairPlan(project);
ok(plan.ok && plan.before && plan.after, 'repair planner returns before and after receipts');
ok(plan.changes.length <= Intelligence.LIMIT.changes, 'repair changes are bounded');
ok(JSON.stringify(project) === before, 'repair planning never mutates the open project');
ok(!plan.ok || plan.after.score >= plan.before.score, 'repair plan never accepts a quality regression');
if (failed) { console.error('\nSTUDIO INTELLIGENCE FAILED: ' + failed); process.exit(1); }
console.log('\nSTUDIO INTELLIGENCE PASSED');
