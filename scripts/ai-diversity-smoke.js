#!/usr/bin/env node
// ============================================================
// ai-diversity-smoke — the AI generator must not hand every business in a
// trade the same site.
//
// This is the regression guard for two things that used to collapse
// generation onto one look:
//   · the seeded section shuffle was computed and then overwritten by the
//     composer's fixed recipe order, so a whole industry shared one flow;
//   · a taste signal (and the tray skew) forced a single look, and every
//     "sans" look left fontDisplay empty, so half of all sites shared the
//     body font as their heading;
//   · every business shipped the identical section set, the identical
//     entrance animation per section type, one container width and one nav.
//
// It also proves generation is still *deterministic*: same brief in, same
// site out.
// ============================================================

'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }
const uniq = (arr) => new Set(arr).size;

const { loadAI } = require(path.join(ROOT, 'scripts', 'load-ai.js'));
const AI = loadAI();
const DB = require(path.join(ROOT, 'data', 'db.js'));

function dna(p) {
  const hero = (p.site.sections || []).find((s) => s.type === 'hero') || {};
  return [
    p.site.palette, p.site.font, p.site.fontDisplay || '',
    (p.site.design && p.site.design.radius) || '',
    p.dnaLook || '', hero.layout || ''
  ].join('|');
}
function flow(p) {
  const site = p.site || {};
  const secs = (site.pages && site.pages.length)
    ? (((site.pages.find((x) => x.slug === 'index') || site.pages[0]) || {}).sections || [])
    : (site.sections || []);
  return secs.map((s) => s.type + (s.layout ? ':' + s.layout : '')).join('>');
}
function copyOf(p) {
  const hero = (p.site.sections || []).find((s) => s.type === 'hero') || {};
  return [p.site.tagline, hero.title, hero.text, p.site.ctaText].join('|');
}
function worstShared(list) {
  const counts = {};
  list.forEach((x) => { counts[x] = (counts[x] || 0) + 1; });
  return Math.max.apply(null, Object.values(counts));
}
function gen(prompt, names, extra) {
  return names.map((name) => AI.generateSite(prompt, {
    onePager: true,
    ...(extra || {}),
    brief: { name, area: 'York', offer: '', proofs: [], cta: '', voice: 'warm' }
  }));
}

const NAMES = ['Alpha', 'Bravo', 'Cobalt', 'Drift', 'Ember', 'Foundry', 'Grove', 'Halo',
  'Ivory', 'Juniper', 'Kite', 'Lumen', 'Meridian', 'Nimbus', 'Onyx', 'Pine',
  'Quarry', 'Ridge', 'Sable', 'Thorn'];

const PROMPTS = [
  { label: 'trades', prompt: 'emergency plumber in york' },
  { label: 'food', prompt: 'wood fired pizza restaurant' },
  { label: 'tech', prompt: 'saas platform for logistics teams' },
  { label: 'generic', prompt: 'a modern friendly business' }
];

console.log('== The same trade no longer shares one skeleton ==');
// Floors sit well under what the generator actually produces today, so the
// test guards against a real regression rather than pinning exact output.
const FLOW_FLOOR = 6;
const LOOK_FLOOR = 3;
for (const { label, prompt } of PROMPTS) {
  const runs = gen(prompt, NAMES);
  const flows = runs.map(flow);
  const looks = runs.map((r) => r.dnaLook);
  assert(uniq(flows) >= FLOW_FLOOR,
    label + ': ' + uniq(flows) + '/' + runs.length + ' distinct section flows (floor ' + FLOW_FLOOR + ')');
  assert(worstShared(flows) <= Math.ceil(runs.length / 2),
    label + ': no single flow covers more than half the sites (worst ' + worstShared(flows) + ')');
  assert(uniq(looks) >= LOOK_FLOOR,
    label + ': ' + uniq(looks) + ' distinct looks across the same trade — ' + [...new Set(looks)].join(', '));
  assert(uniq(runs.map(dna)) >= runs.length - 2,
    label + ': ' + uniq(runs.map(dna)) + '/' + runs.length + ' distinct design DNA strings');
  assert(uniq(runs.map((r) => r.site.palette)) >= 5,
    label + ': ' + uniq(runs.map((r) => r.site.palette)) + ' distinct palettes');
  const heroLayouts = runs.map((r) => ((r.site.sections || []).find((s) => s.type === 'hero') || {}).layout || 'centered');
  assert(uniq(heroLayouts) >= 2, label + ': hero treatment varies — ' + [...new Set(heroLayouts)].join(', '));
}

console.log('\n== Headings pair against the body font ==');
const paired = gen('a modern friendly business', NAMES);
const withDisplay = paired.filter((r) => r.site.fontDisplay).length;
assert(withDisplay >= Math.floor(paired.length / 2),
  'at least half the sites get a display/body font pairing — ' + withDisplay + '/' + paired.length);
assert(paired.filter((r) => r.site.fontDisplay).every((r) => r.site.fontDisplay !== r.site.font),
  'a display face is never the same font as the body');
assert(paired.every((r) => !r.site.fontDisplay || (DB.fonts || []).some((f) => f.id === r.site.fontDisplay)),
  'every display face exists in the font library');

console.log('\n== Anchors still hold ==');
for (const { label, prompt } of PROMPTS) {
  gen(prompt, NAMES.slice(0, 8)).forEach((p) => {
    const types = (p.site.sections || []).map((s) => s.type);
    const hero = types.indexOf('hero');
    const contact = types.indexOf('contact');
    const cta = types.indexOf('cta');
    if (hero !== 0) fail(label + ': hero is not first — ' + types.join(','));
    if (cta !== -1 && contact !== -1 && cta > contact) fail(label + ': cta should precede contact — ' + types.join(','));
    if (contact !== -1 && contact !== types.length - 1) fail(label + ': contact is not last — ' + types.join(','));
  });
}
pass('hero stays first, the CTA precedes the contact block, contact stays last');

console.log('\n== Food still leads with the menu; trades still lead with proof ==');
const pizza = gen('wood fired pizza restaurant', ['Rosso'])[0];
const pt = (pizza.site.sections || []).map((s) => s.type);
assert(pt.indexOf('features') === -1 || pt.indexOf('table') < pt.indexOf('features') || pt.indexOf('gallery') < pt.indexOf('features'),
  'pizzeria keeps the menu or gallery before the feature list — ' + pt.join(','));
const plumb = gen('emergency plumber in leeds', ['LeakStop'])[0];
const lt = (plumb.site.sections || []).map((s) => s.type);
assert(lt.indexOf('features') === -1 || lt.indexOf('stats') < lt.indexOf('features') || lt.indexOf('testimonials') < lt.indexOf('features'),
  'plumber keeps proof (stats/testimonials) before the feature list — ' + lt.join(','));
const foodHero = (pizza.site.sections || []).find((s) => s.type === 'hero') || {};
assert(foodHero.layout !== 'aurora', 'food never gets the Pro-only aurora hero');

console.log('\n== Section sets and page rhythm vary ==');
const SETS_FLOOR = 5;
for (const { label, prompt } of PROMPTS) {
  const runs = gen(prompt, NAMES);
  const sets = runs.map((r) => (r.site.sections || []).map((s) => s.type).sort().join(','));
  assert(uniq(sets) >= SETS_FLOOR,
    label + ': ' + uniq(sets) + '/' + runs.length + ' distinct section sets (floor ' + SETS_FLOOR + ')');
  const lengths = runs.map((r) => (r.site.sections || []).length);
  assert(uniq(lengths) >= 2, label + ': section count varies — ' + [...new Set(lengths)].sort().join('/'));
  assert(Math.max.apply(null, lengths) <= 10,
    label + ': the free-tier ten-section ceiling holds (max ' + Math.max.apply(null, lengths) + ')');
  runs.forEach((r) => {
    const types = (r.site.sections || []).map((s) => s.type);
    ['hero', 'about', 'features', 'contact'].forEach((t) => {
      if (types.indexOf(t) === -1) fail(label + ': core section “' + t + '” was dropped — ' + types.join(','));
    });
    // a niche's own section must never double up with one the seed added
    if (new Set(types).size !== types.length) fail(label + ': duplicate section type — ' + types.join(','));
  });
  pass(label + ': the spine always ships and no section ever doubles up');
}

console.log('\n== Motion, container width and nav vary ==');
const ANIM_IDS = new Set((DB.animations || []).map((a) => a.id));
const motionRuns = gen('a modern friendly business', NAMES);
const invalidAnim = [];
const motionSignatures = motionRuns.map((r) => (r.site.sections || []).map((s) => s.animation).join(','));
const widths = motionRuns.map((r) => (r.site.design && r.site.design.containerWidth) || 1140);
const navs = motionRuns.map((r) => (r.site.navSticky === false ? 'static' : 'sticky') + '/' + (r.site.navStyle || 'solid'));
motionRuns.forEach((r) => (r.site.sections || []).forEach((s) => {
  if (!ANIM_IDS.has(s.animation)) invalidAnim.push(s.type + '→' + s.animation);
}));
assert(invalidAnim.length === 0, 'every section animation is a real library id — ' + (invalidAnim.join(', ') || '0 bad'));
assert(uniq(motionSignatures) >= Math.floor(motionRuns.length / 2),
  'the per-section motion signature differs across sites — ' + uniq(motionSignatures) + '/' + motionRuns.length);
assert(uniq(widths) >= 2, 'container width varies — ' + [...new Set(widths)].sort((a, b) => a - b).join(', '));
assert(uniq(navs) >= 2, 'nav treatment varies — ' + [...new Set(navs)].join(', '));

console.log('\n== Determinism is intact ==');
const BRIEF = { name: 'LeakStop', area: 'York', offer: '24-hour callout', proofs: ['Gas safe'], cta: 'Book a visit', voice: 'warm' };
const a1 = AI.generateSite('plumber emergency repairs in york', { brief: BRIEF, onePager: true });
const a2 = AI.generateSite('plumber emergency repairs in york', { brief: BRIEF, onePager: true });
assert(dna(a1) === dna(a2), 'same brief twice → identical DNA');
assert(flow(a1) === flow(a2), 'same brief twice → identical section flow');
assert(copyOf(a1) === copyOf(a2), 'same brief twice → identical copy');

console.log('\n== Every palette still clears WCAG AA ==');
let bad = 0;
for (const { prompt } of PROMPTS) {
  gen(prompt, NAMES).forEach((p) => {
    const checks = DB.paletteChecks(DB.getPalette(p.site.palette));
    if (!checks.length || checks.some((c) => c.ratio < 4.5)) bad++;
  });
}
assert(bad === 0, 'all generated palettes pass AA (failures: ' + bad + ')');

if (failed) {
  console.error('\nai-diversity-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-diversity-smoke PASSED');
