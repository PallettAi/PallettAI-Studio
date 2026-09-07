#!/usr/bin/env node
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const follow = require(path.join(ROOT, 'data', 'ai-followup.js'));
const { loadAI } = require('./load-ai.js');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

console.log('== Follow-up detector ==');
assert(follow.isFollowUp('make it shorter') === 'shorter', 'shorter');
assert(follow.isFollowUp('more local please') === 'local', 'more local');
assert(follow.isFollowUp('less salesy') === 'salesy', 'less salesy');
assert(follow.isFollowUp('make it glassmorphism') === '', 'style packs are not follow-ups');
assert(follow.likeUrl('Make it more like https://harbourco.example/') === 'https://harbourco.example/', 'extracts a URL');

const remembered = follow.rememberEdit(null, { raw: 'punchier', targetType: 'hero', ops: [{ op: 'rewrite' }] });
assert(remembered.targetType === 'hero' && remembered.ops.length === 1, 'rememberEdit stores last target');

const AI = loadAI();
const site = AI.generateSite('a bakery', { brief: { name: 'Rustica', offer: 'Sourdough' }, onePager: true }).site;

console.log('\n== chatPlan follow-ups ==');
const noCtx = AI.chatPlan(site, 'make it shorter');
assert(noCtx.acts && noCtx.acts.length === 0, 'follow-up without a last edit does not restyle the whole site');
assert(/nothing to tweak/i.test(noCtx.reply || ''), 'follow-up without context says so');

const withCtx = AI.chatPlan(site, 'make it shorter', { targetType: 'hero' });
assert(withCtx.acts && withCtx.acts[0] && withCtx.acts[0].op === 'rewriteSection', 'follow-up rewrites the last target');
assert(withCtx.acts[0].type === 'hero' && withCtx.acts[0].credit === true, 'rewrite is credited and targets hero');
assert(withCtx.acts[0].mode === 'shorter', 'mode is shorter');

const like = AI.chatPlan(site, 'Make it more like https://harbourco.example/');
assert(like.acts && like.acts[0] && like.acts[0].op === 'likeUrl', 'like-URL is a layout restyle');
assert(like.acts[0].credit === false, 'like-URL restyle is free');
assert(like.acts[0].url === 'https://harbourco.example/', 'like-URL keeps the reference');

const menu = AI.chatPlan(site, 'Add a menu for a wine bar');
assert(menu.acts && menu.acts[0] && menu.acts[0].op === 'nicheExtras', 'wine bar menu adds niche extras');
assert(menu.acts[0].nicheId === 'winebar' && menu.acts[0].credit === false, 'winebar extras are free');

const services = AI.chatPlan(site, 'Add a Services page');
assert(services.acts && services.acts[0] && services.acts[0].op === 'servicesPage', 'add a Services page');
assert(services.acts[0].credit === false, 'services page is free');

if (failed) {
  console.error('\nai-followup-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-followup-smoke PASSED');
