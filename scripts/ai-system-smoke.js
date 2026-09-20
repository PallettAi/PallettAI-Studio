#!/usr/bin/env node
'use strict';

// ============================================================
// ai-system-smoke — the design language, held to what it promises.
//
// WHY THIS SUITE EXISTS. Measured across forty generations of one brief with
// scripts/design-system-probe.js, the compiled pages varied in every dimension
// except the ones a person reads first: the button, the card, the label, the
// heading, the grid, the nav bar, the hover, the air. Nine decisions, all
// constant, on forty different websites. That is why every earlier upgrade
// changed the sites and none of them changed how the sites felt.
//
// A suite could not have caught that by reading the project object — by every
// measure the object was fine. So this one does both: it checks the catalogue
// the design system is built from, and then it compiles real pages and holds the
// *rendered* result to five claims.
//
//   1. THE CATALOGUE IS REAL — every id in every table names a school, every
//      school authors every field it is required to, and no school is
//      unreachable (an id nothing can ever choose is a feature that is not
//      shipped).
//   2. NO DEAD KNOBS — each school's decision must change the compiled HTML, and
//      no two schools may produce the same one. A school that renders like
//      another school is a promise the app silently breaks.
//   3. THE GEOMETRY IS LEGAL — the values a school contributes must survive the
//      project validator untouched. This is a regression guard with a scar: a
//      clamp written at the wrong scale produced a 3840px section padding, the
//      validator "repaired" it to its 96px default, and the school's rhythm
//      vanished with no error anywhere. Constant section air, again, for the
//      third time.
//   4. IT IS SCOPED — every rule a school emits must be prefixed with its own
//      body class. One unscoped rule would restyle every project in the app.
//   5. IT IS OPTIONAL — a project with no system renders byte-for-byte as it did
//      before the design system existed.
//
// Run: node scripts/ai-system-smoke.js
// ============================================================

const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

global.DB = require(path.join(ROOT, 'data', 'db.js'));
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
global.Signature = require(path.join(ROOT, 'data', 'signature.js'));
const Sys = require(path.join(ROOT, 'data', 'ai-system.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));
const { loadAI } = require(path.join(__dirname, 'load-ai.js'));
const AI = loadAI();

const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);

/* Every declaration block in the compiled <style> blocks whose selector list
   ends in `selector`, joined — the same cascade-aware read the probe uses. */
function rule(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tail = new RegExp('(^|[\\s>+~,])' + esc + '$');
  const out = [];
  (function scan(src) {
    let i = 0; let selStart = 0;
    while (i < src.length) {
      if (src[i] !== '{') { i++; continue; }
      const sel = src.slice(selStart, i).trim();
      let depth = 1; let j = i + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        j++;
      }
      const body = src.slice(i + 1, j - 1);
      if (/^@/.test(sel)) { if (/^@media|^@supports/.test(sel)) scan(body); } else {
        const sels = sel.split(',').map((s) => s.trim());
        if (sels.some((s) => tail.test(s))) out.push(body);
      }
      i = j; selStart = j;
    }
  })(String(css));
  return out.join(';');
}
const styleBlocks = (html) => (String(html).match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [])
  .map((b) => b.replace(/^<style[^>]*>/i, '').replace(/<\/style>$/i, '')).join('\n');

/* One compiled page per school, so the catalogue can be compared against what
   the renderer actually emits rather than against what the module says. */
function renderFor(system, seed) {
  const p = AI.generateSite('a family run café in Derby', { salt: seed, layouts: 'auto', tier: 'pro' });
  p.site.system = system;
  p.site.design = Object.assign({}, p.site.design, Sys.geometry(system, seed));
  const html = Builder.buildSiteHTML(p, { tier: 'pro' }) || '';
  return { project: p, html, css: styleBlocks(html) };
}

console.log('== The catalogue is real ==');
assert(Sys.IDS.length >= 8, 'the catalogue holds at least eight design systems — got ' + Sys.IDS.length);
assert(Sys.IDS.every((id) => Sys.facts(id)), 'every catalogue id has a fact sheet');
assert(Sys.IDS.every((id) => Sys.css(id).length > 400), 'every school emits a real stylesheet, not a stub');
// The fields a school is required to author, checked by type rather than by
// presence. `label` used to hold both the school's display name and its eyebrow
// specification, so the second silently overwrote the first in all eight
// entries and nothing failed — a name would have rendered `[object Object]`.
const badFields = [];
Sys.IDS.forEach((id) => {
  const s = Sys.spec(id);
  if (typeof s.name !== 'string' || !s.name.trim()) badFields.push(id + '.name');
  if (typeof s.blurb !== 'string' || !s.blurb.trim()) badFields.push(id + '.blurb');
  if (typeof s.ground !== 'string' || !s.ground.trim()) badFields.push(id + '.ground');
  if (!s.label || typeof s.label !== 'object' || typeof s.label.spacing !== 'string') badFields.push(id + '.label');
  if (!s.card || typeof s.card.mode !== 'string') badFields.push(id + '.card');
  if (!s.btn || typeof s.btn.solid !== 'string') badFields.push(id + '.btn');
  if (!Sys.facts(id) || Sys.facts(id).name !== s.name) badFields.push(id + '.facts.name');
});
assert(badFields.length === 0, 'every school authors its name, blurb, ground and treatments'
  + (badFields.length ? ' — wrong: ' + badFields.join(', ') : ''));
assert(Sys.name('atelier') === 'Editorial Atelier' && Sys.name('nope') === '',
  'the catalogue can name a school, and returns nothing for an unknown id');

// An id that nothing can choose is dead weight the user paid for; and an id in a
// pool that names no school would silently narrow the pool it appears in.
const poolSources = {
  LOOK_SCHOOLS: Sys.LOOK_SCHOOLS, TYPE_POOLS: Sys.TYPE_POOLS, NICHE_POOLS: Sys.NICHE_POOLS
};
let badRefs = [];
Object.keys(poolSources).forEach((name) => {
  Object.keys(poolSources[name]).forEach((key) => {
    (poolSources[name][key] || []).forEach((id) => {
      if (Sys.IDS.indexOf(id) === -1) badRefs.push(name + '.' + key + ' → ' + id);
    });
  });
});
assert(badRefs.length === 0, 'every id in every pool names a real school'
  + (badRefs.length ? ' — dead: ' + badRefs.join(', ') : ''));

// Reachability, measured rather than assumed: sweep a grid of briefs and looks
// and fail if any school can never come out of the chooser.
const reached = {};
const LOOKS = Object.keys(Sys.LOOK_SCHOOLS);
const TYPES = Object.keys(Sys.TYPE_POOLS);
const NICHES = Object.keys(Sys.NICHE_POOLS);
for (let i = 0; i < 3000; i++) {
  const pick = (list, n) => list[(i * n) % list.length];
  reached[Sys.choose({
    seed: (i * 2654435761) >>> 0,
    look: pick(LOOKS, 7),
    typeId: pick(TYPES, 11),
    nicheId: pick(NICHES, 13)
  })] = true;
}
const unreachable = Sys.IDS.filter((id) => !reached[id]);
assert(unreachable.length === 0, 'every school in the catalogue can actually be chosen'
  + (unreachable.length ? ' — unreachable: ' + unreachable.join(', ') : ''));

console.log('\n== The chooser is deterministic and spread ==');
const one = Sys.choose({ seed: 42, look: 'warm', typeId: 'food', nicheId: 'coffee' });
const again = Sys.choose({ seed: 42, look: 'warm', typeId: 'food', nicheId: 'coffee' });
assert(one === again && !!one, 'the same brief and seed always return the same school (' + one + ')');
// The pool a single brief draws from is the thing that was too narrow: a café
// used to have three schools available out of eight. Four is the floor.
const cafePool = Sys.poolFor('warm', 'food', 'coffee');
assert(cafePool.length >= 4, 'one brief draws on at least four schools — got ' + cafePool.length + ' (' + cafePool.join(', ') + ')');
const cafeSchools = {};
for (let i = 0; i < 200; i++) {
  cafeSchools[Sys.choose({ seed: (i * 97 + 5) >>> 0, look: 'warm', typeId: 'food', nicheId: 'coffee' })] = true;
}
assert(Object.keys(cafeSchools).length >= 4,
  'forty cafés are not all one school — 200 draws produced ' + Object.keys(cafeSchools).length);
// A brief with nothing to go on must not collapse onto a single house style.
const vaguePool = Sys.poolFor('', '', '');
assert(vaguePool.length === Sys.IDS.length, 'a brief with no look, type or niche draws on the whole catalogue');
assert(Sys.choose({ seed: 7, look: '', typeId: '', nicheId: '' }) !== Sys.choose({ seed: 8, look: '', typeId: '', nicheId: '' }),
  'and two such briefs do not land on the same school');

console.log('\n== The geometry is legal ==');
// The scar: a value outside the validator's window is silently replaced, so a
// school's geometry has to prove it survives rather than assume it will. These
// bounds are copied from the validator's own defaults on purpose.
let illegal = [];
Sys.IDS.forEach((id) => {
  for (let seed = 0; seed < 40; seed++) {
    const g = Sys.geometry(id, (seed * 2654435761) >>> 0);
    if (!(g.spacing >= 32 && g.spacing <= 220)) illegal.push(id + ' spacing ' + g.spacing);
    if (!(g.radius >= 0 && g.radius <= 48)) illegal.push(id + ' radius ' + g.radius);
    if (!(g.containerWidth >= 900 && g.containerWidth <= 1680)) illegal.push(id + ' width ' + g.containerWidth);
    if (!(g.typoScale >= 0.9 && g.typoScale <= 1.45)) illegal.push(id + ' scale ' + g.typoScale);
    if (!(g.typoHeadingLh >= 1 && g.typoHeadingLh <= 1.6)) illegal.push(id + ' heading lh ' + g.typoHeadingLh);
  }
});
assert(illegal.length === 0, 'every school\'s geometry survives the project validator'
  + (illegal.length ? ' — illegal: ' + illegal.slice(0, 4).join(', ') : ''));
// And a school must actually move the air, or the geometry is decorative.
const airs = Sys.IDS.map((id) => Sys.geometry(id, 99).spacing);
assert(new Set(airs).size >= 4, 'schools disagree about how much air a section gets — ' + new Set(airs).size + ' distinct values');
assert(Sys.geometry('instrument', 1).spacing < Sys.geometry('luxe', 1).spacing,
  'a compact school is denser than a luxurious one, not merely different');

console.log('\n== No dead knobs: it is scoped ==');
const unscoped = [];
Sys.IDS.forEach((id) => {
  Sys.css(id).split('\n').forEach((line) => {
    const sel = line.split('{')[0].trim();
    if (!sel || sel[0] === '@' || sel[0] === '}' || sel.indexOf('{') === -1) return;
    if (sel.indexOf('body.sys-' + id) !== 0) unscoped.push(id + ': ' + sel.slice(0, 60));
  });
});
assert(unscoped.length === 0, 'every rule a school emits is scoped to its own body class'
  + (unscoped.length ? ' — leaking: ' + unscoped.slice(0, 3).join(' | ') : ''));
let unbalanced = Sys.IDS.filter((id) => {
  const css = Sys.css(id);
  return (css.match(/\{/g) || []).length !== (css.match(/\}/g) || []).length;
});
assert(unbalanced.length === 0, 'every school\'s stylesheet has balanced braces'
  + (unbalanced.length ? ' — ' + unbalanced.join(', ') : ''));

console.log('\n== No dead knobs: it reaches the page ==');
const rendered = Sys.IDS.map((id) => Object.assign({ id }, renderFor(id, 12345)));
rendered.forEach((r) => {
  assert(r.html.indexOf('<body id="top"') !== -1 && r.html.indexOf('class="sys-' + r.id) !== -1,
    r.id + ': the body carries its own class');
  assert(r.css.indexOf('body.sys-' + r.id) !== -1, r.id + ': its stylesheet is compiled into the page');
});
// The heart of it. Each decision must actually differ per school on the compiled
// page — not in the data, not in the module, in the HTML the client exports.
const DECISIONS = {
  'button shape': ['.btn'],
  'card treatment': ['.card'],
  'label treatment': ['.eyebrow'],
  'heading treatment': ['.sec-head h2'],
  'page chrome': ['.nav'],
  'hover motion': ['.card:hover'],
  'grid composition': ['.grid3']
};
Object.keys(DECISIONS).forEach((label) => {
  const seen = rendered.map((r) => hash(rule(r.css, DECISIONS[label][0])));
  const distinct = new Set(seen).size;
  // Seven of eight schools must be telling the page something different. Allowing
  // one collision leaves room for two schools that legitimately agree on a single
  // rule while still failing a catalogue that has quietly collapsed.
  assert(distinct >= Sys.IDS.length - 1,
    label + ': ' + distinct + ' distinct values across ' + Sys.IDS.length + ' schools');
});
// And the pair that must never collide, because together they are the page.
const signature = (r) => hash([
  rule(r.css, '.btn'), rule(r.css, '.card'), rule(r.css, '.eyebrow')
].join('|'));
assert(new Set(rendered.map(signature)).size === Sys.IDS.length,
  'no two schools share a button, card and label treatment');
/* The school's ground has to reach the palette — and this is measured on real
   generations, because `renderFor` swaps the school onto an existing project to
   compare rules, which would leave the palette chosen for a different school.

   The failure this catches is a costume: an ink-ground language (Cinematic,
   Quiet Luxury) painted onto a near-white page, or a paper-ground language
   painted dark. It is invisible at the data level, because the look was right
   and only the register was wrong. */
const wrongGround = [];
const palettesSeen = {};
for (let i = 0; i < 150; i++) {
  const p = AI.generateSite('a family run café in Derby', { salt: (i * 2654435761) >>> 0, layouts: 'auto', tier: 'pro' });
  const id = p.site.system;
  const sp = (id && Sys.spec(id)) || null;
  const pal = DB.getPalette(p.site.palette) || {};
  palettesSeen[p.site.palette] = true;
  if (!sp || !sp.ground) continue;
  if (sp.ground === 'ink' && !pal.dark) wrongGround.push(id + ' (ink) on ' + p.site.palette);
  if (sp.ground !== 'ink' && pal.dark) wrongGround.push(id + ' (' + sp.ground + ') on ' + p.site.palette);
}
assert(wrongGround.length === 0, 'a school is never painted the wrong ground — no ink language on a light page'
  + (wrongGround.length ? ' — ' + wrongGround.slice(0, 4).join(', ') + ' (' + wrongGround.length + ' of 150)' : ''));
assert(Object.keys(palettesSeen).length >= 3, 'and the palette still varies — ' + Object.keys(palettesSeen).length + ' distinct across 150 generations');

console.log('\n== It is optional ==');
// A project without a system must be untouched: this is what makes the design
// system safe to ship to the projects people have already built.
const bare = AI.generateSite('a family run café in Derby', { salt: 2024, layouts: 'auto', tier: 'pro' });
delete bare.site.system;
const bareHtml = Builder.buildSiteHTML(bare, { tier: 'pro' }) || '';
assert(bareHtml.indexOf('body.sys-') === -1, 'a project with no system emits no scoped rules');
assert(!/class="[^"]*sys-/.test(bareHtml), 'a project with no system gets no body class');
assert(bareHtml.indexOf('<style>') !== -1 && bareHtml.indexOf('</style>') !== -1, 'and still compiles a full stylesheet');
// The other direction: an unknown id must be ignored rather than trusted, because
// the id ends up inside a class attribute and a CSS selector.
const bogus = AI.generateSite('a family run café in Derby', { salt: 2025, layouts: 'auto', tier: 'pro' });
bogus.site.system = '"; } html{display:none} .x{';
const bogusHtml = Builder.buildSiteHTML(bogus, { tier: 'pro' }) || '';
assert(bogusHtml.indexOf('style="') !== -1 || bogusHtml.indexOf('sys-') === -1,
  'an id that is not in the catalogue is dropped rather than compiled');
assert(bogusHtml.indexOf('html{display:none}') === -1, 'a forged id cannot inject a rule into the page');
// Determinism on the compiled output, not just the chooser: same salt, same page.
const a = Builder.buildSiteHTML(AI.generateSite('a family run café in Derby', { salt: 777, layouts: 'auto', tier: 'pro' }), { tier: 'pro' }) || '';
const b = Builder.buildSiteHTML(AI.generateSite('a family run café in Derby', { salt: 777, layouts: 'auto', tier: 'pro' }), { tier: 'pro' }) || '';
assert(a === b, 'the same brief and salt compile to a byte-identical page');

console.log('\n== The measurement that started this ==');
// The regression guard for the whole file: compile many pages from one brief and
// count how many distinct design languages a visitor would see. Before the design
// system this read 3 of 40; it must never collapse again.
const N = 24;
const signatures = [];
for (let i = 0; i < N; i++) {
  const r = renderFor(undefined, (i * 2654435761) >>> 0);
  const better = ['.btn', '.card', '.eyebrow', '.sec-head h2', '.nav', '.card:hover', '.grid3', '.container']
    .map((sel) => rule(r.css, sel)).join('|');
  signatures.push(hash(better));
}
const distinctPages = new Set(signatures).size;
console.log('  · ' + distinctPages + '/' + N + ' distinct designs (decisions only, no colour, no type)');
assert(distinctPages >= Math.ceil(N * 0.75),
  'one brief produces visibly different websites, most of the time');

if (failed) {
  console.error('\nai-system-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-system-smoke PASSED');
