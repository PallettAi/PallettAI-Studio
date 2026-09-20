#!/usr/bin/env node
'use strict';

// ============================================================
// ai-variety-smoke — one brief, many sites, measured on the COMPILED PAGE.
//
// WHY THIS SUITE EXISTS. Every earlier variety suite measured the project
// object: the section list, the order, the layouts, the palette, the words. By
// those measures the generator looked fine — thirty-four distinct section orders
// out of forty, forty distinct layout strings — and the generated sites were
// still, in the client's words, "exactly the same". They were. The data varied
// and the compiled HTML did not, because a layout value the renderer ignores
// renders the classic shape with no error anywhere, and because every section
// sat inside one identical scaffold: the same width, the same gutters, the same
// heading position, the same breathing room.
//
// So this suite measures the thing a visitor actually judges. It compiles the
// export and hashes the tag-and-class structure of each block with the copy
// stripped, then holds four families of claim:
//
//   1. NO DEAD KNOBS — every layout the catalogue offers must change the
//      compiled HTML. A variant that renders as the default is a promise the
//      app makes and silently breaks, and it is invisible to a data-level test.
//   2. NO COLLAPSED SECTION — no section type may render only one or two shapes
//      across a page set, whatever the data says.
//   3. NO DOMINANT VARIANT — one layout may not own a section type, because a
//      catalogue that exists is not a catalogue that gets used.
//   4. THE SHELL HOLDS — measure, ground, heading and rhythm must genuinely
//      vary, and the two taste rules must hold on every page: at most one
//      contrast band, never two of the same ground side by side.
//
// Run: node scripts/ai-variety-smoke.js
// ============================================================

const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');

global.DB = require(path.join(ROOT, 'data', 'db.js'));
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
global.Signature = require(path.join(ROOT, 'data', 'signature.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));
const { loadAI } = require(path.join(__dirname, 'load-ai.js'));
const AI = loadAI();

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const BRIEF = process.env.PROMPT || 'a family run café in Derby';
const N = Number(process.env.N || 30);
const SETTINGS = { tier: 'pro' };

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const uniq = (a) => new Set(a).size;

// Structure only: the tags, and the classes on them. The copy is removed, so the
// only thing that can make two blocks differ is how they are built.
function shape(html) {
  const body = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '<script>')
    .replace(/<style[\s\S]*?<\/style>/gi, '<style>');
  return (body.match(/<[a-z][^>]*>/gi) || []).map((t) => {
    const name = (t.match(/^<([a-z0-9]+)/i) || [])[1] || '?';
    const cls = (t.match(/class="([^"]*)"/) || [])[1] || '';
    return name + '.' + cls.split(/\s+/).filter(Boolean).sort().join('.');
  }).join('>');
}

// sectionShell emits <section class="section sec-TYPE ...">…</section>. Matching
// the nav anchor instead of this marker is how an earlier probe reported
// "collapsed" for sections that were rendering fine.
function band(html, type) {
  const parts = String(html).split(/<section[^>]*class="section sec-/);
  for (let k = 1; k < parts.length; k++) {
    if ((parts[k].match(/^([a-z0-9-]+)/) || [])[1] === type) return parts[k].split('</section>')[0];
  }
  return '';
}

function build(p) {
  try { return Builder.buildSiteHTML(p, SETTINGS) || ''; } catch (e) { return ''; }
}

// ---------------------------------------------------------------- the page set
const rows = [];
for (let i = 0; i < N; i++) {
  const p = AI.generateSite(BRIEF, { salt: (i * 2654435761) >>> 0, layouts: 'auto', tier: 'pro' });
  const html = build(p);
  rows.push({ p, html, secs: p.site.sections || [] });
}

console.log('\n== 1. Every catalogue layout changes the compiled page ==');
{
  const base = AI.generateSite(BRIEF, { salt: 12345, layouts: 'auto', tier: 'pro' });
  const TYPES = ['hero', 'features', 'stats', 'about', 'gallery', 'pricing', 'testimonials', 'faq', 'contact', 'cta'];
  let dead = [];
  let live = 0;
  TYPES.forEach((type) => {
    if (!(base.site.sections || []).some((s) => s.type === type)) return;
    const variants = DB.layoutsFor(type) || [];
    if (!variants.length) return;
    const seen = {};
    ['', ...variants.map((v) => v.id)].forEach((v) => {
      const clone = JSON.parse(JSON.stringify(base));
      const target = (clone.site.sections || []).find((s) => s.type === type);
      if (!target) return;
      target.layout = v;
      seen[v || '(default)'] = hash(shape(band(build(clone), type)));
    });
    const baseline = seen['(default)'];
    variants.forEach((v) => {
      if (seen[v.id] === baseline && v.id !== '') dead.push(type + ':' + v.id);
      else live++;
    });
  });
  assert(dead.length === 0, 'no dead layout knobs across the catalogue' +
    (dead.length ? ' — dead: ' + dead.join(', ') : ' (' + live + ' live variants)'));
}

console.log('\n== 2. No section type collapses to one shape ==');
{
  const per = {};
  rows.forEach((r) => {
    const types = new Set(r.secs.map((s) => s.type));
    types.forEach((t) => {
      const b = shape(band(r.html, t));
      if (!b) return;
      per[t] = per[t] || [];
      per[t].push(hash(b));
    });
  });
  // The floor is tied to what the catalogue actually offers AND to how many the
  // generator's own pools can reach for a café, so it is a claim about this
  // build rather than an arbitrary number. A dead variant makes the achieved
  // count fall below its catalogue size, which section 1 also catches directly.
  const floors = { hero: 3, features: 3, about: 3, gallery: 4, testimonials: 3, faq: 3, cta: 3, pricing: 2 };
  Object.keys(floors).forEach((t) => {
    if (!per[t] || per[t].length < 8) return;
    const d = uniq(per[t]);
    // The bar is what this build can legitimately reach: the catalogue size, or
    // the floors for the types whose rhythm pools deliberately exclude some
    // variants (a café never gets a code-terminal hero). Either way a dead knob
    // pulls the achieved count below the catalogue, and section 1 names it.
    const offered = Math.max(1, (DB.layoutsFor(t) || []).length);
    const bar = Math.min(floors[t], offered);
    assert(d >= bar, t + ' renders ' + d + ' distinct shapes over ' + per[t].length +
      ' builds (bar ' + bar + ' of ' + offered + ' catalogued)');
  });

  // The shell is checked as a whole here rather than one knob at a time: what a
  // visitor sees is the combination, so 'every knob varies' is not the claim —
  // 'the combinations are spread' is.
  const combos = {};
  rows.forEach((r) => r.secs.forEach((s) => {
    if (!s.shell) return;
    const k = [s.shell.measure, s.shell.ground, s.shell.head, s.shell.rhythm].join('/');
    combos[k] = (combos[k] || 0) + 1;
  }));
  const comboTotal = Object.values(combos).reduce((a, b) => a + b, 0);
  const comboTop = Math.max.apply(null, Object.values(combos));
  assert(Object.keys(combos).length >= 12,
    'the shell combinations are spread (' + Object.keys(combos).length + ' distinct over ' + comboTotal + ' sections)');
  assert(comboTop / comboTotal <= 0.25,
    'and no one shell combination owns the set (worst ' + Math.round((comboTop / comboTotal) * 100) + '%)');
}

console.log('\n== 3. No variant dominates a section type ==');
{
  const counts = {};
  rows.forEach((r) => r.secs.forEach((s) => {
    counts[s.type] = counts[s.type] || {};
    const key = s.layout || '(default)';
    counts[s.type][key] = (counts[s.type][key] || 0) + 1;
  }));
  Object.keys(counts).forEach((t) => {
    const total = Object.values(counts[t]).reduce((a, b) => a + b, 0);
    if (total < 8) return;
    const top = Math.max.apply(null, Object.values(counts[t]));
    assert(top / total <= 0.6, t + ': no single layout owns more than 60% (worst ' +
      Math.round((top / total) * 100) + '% of ' + total + ')');
  });
}

console.log('\n== 4. The page shell varies, and its taste rules hold ==');
{
  const measures = [];
  const grounds = [];
  const heads = [];
  const rhythms = [];
  const languages = [];
  let multiBand = 0;
  let adjacentGround = 0;
  let shellOnEverySection = 0;
  let sectionsTotal = 0;

  rows.forEach((r) => {
    if (r.p.site.shell) languages.push(r.p.site.shell.language);
    let bands = 0;
    r.secs.forEach((s, i) => {
      sectionsTotal++;
      const sh = s.shell;
      if (!sh) return;
      shellOnEverySection++;
      measures.push(sh.measure);
      grounds.push(sh.ground);
      heads.push(sh.head);
      rhythms.push(sh.rhythm);
      if (sh.ground === 'band') bands++;
      const prev = r.secs[i - 1] && r.secs[i - 1].shell;
      if (prev && prev.ground !== 'plain' && prev.ground === sh.ground) adjacentGround++;
    });
    if (bands > 1) multiBand++;
  });

  assert(shellOnEverySection === sectionsTotal,
    'every generated section carries a shell (' + shellOnEverySection + '/' + sectionsTotal + ')');
  assert(uniq(measures) >= 3, 'measure varies across the set (' + uniq(measures) + ' values: ' + [...new Set(measures)].join(', ') + ')');
  assert(uniq(grounds) >= 3, 'ground varies across the set (' + uniq(grounds) + ' values)');
  assert(uniq(heads) >= 3, 'heading position varies (' + uniq(heads) + ' values: ' + [...new Set(heads)].join(', ') + ')');
  assert(uniq(rhythms) >= 3, 'vertical rhythm varies (' + uniq(rhythms) + ' values)');
  assert(uniq(languages) >= 2, 'different looks speak different spatial languages (' + uniq(languages) + ': ' + [...new Set(languages)].join(', ') + ')');
  assert(multiBand === 0, 'no page carries more than one contrast band');
  assert(adjacentGround === 0, 'no two neighbouring sections share a non-plain ground');
}

console.log('\n== 5. The page itself is not a repeat ==');
{
  const shapes = rows.map((r) => hash(shape(r.html)));
  const counts = {};
  shapes.forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
  const repeats = Object.values(counts).filter((n) => n > 1);
  assert(uniq(shapes) >= Math.ceil(N * 0.9),
    uniq(shapes) + '/' + N + ' pages are structurally unique');
  assert(repeats.length === 0, 'no two pages share a structure' +
    (repeats.length ? ' (worst ' + Math.max.apply(null, repeats) + '×)' : ''));
}

console.log('\n== 6. Hand-built pages are untouched ==');
{
  // A site with no shell — every starter, every older project, every hand-built
  // page — must compile exactly as it did before the shell existed. The tell is
  // the class list: a shelled section carries measure-/ground-/head-/rhythm-.
  // The shell class can sit anywhere in the section's class list — a hero emits
  // its layout first — so this looks at the whole tag rather than at a position.
  const shelled = /class="[^"]*\b(?:measure|ground|head|rhythm)-(?:narrow|wide|full|surface|wash|rule|band|center|split|tight|airy)\b/;
  const starter = DB.templates.find((t) => t.id === 'hearth') || DB.templates[0];
  const project = {
    id: 'smoke', aiType: '', templateId: starter.id,
    site: {
      name: 'Hearth', tagline: 'Bakery',
      sections: (starter.sections || []).map((s) => DB.newSection(s.type, s)),
      design: starter.design || {}
    },
    suites: []
  };
  const html = build(project);
  const bodyBefore = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  assert(html && !shelled.test(bodyBefore),
    'a starter with no shells compiles with no shell classes');
  const withShell = JSON.parse(JSON.stringify(project));
  withShell.site.sections[0].shell = { measure: 'narrow', ground: 'band', head: 'center', rhythm: 'airy' };
  const html2 = build(withShell);
  const bodyAfter = html2.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  assert(shelled.test(bodyAfter), 'and a section that does carry a shell does emit its classes');
  assert(DB.newSection('features', { shell: { measure: 'wide' } }).shell &&
    DB.newSection('features', { shell: { measure: 'wide' } }).shell.measure === 'wide',
    'newSection carries a shell through a rebuild');
  assert(DB.newSection('features', {}).shell === undefined,
    'and leaves it undefined when there is none, so old payloads serialise unchanged');
}

console.log('');
if (failed) {
  console.error('ai-variety-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('ai-variety-smoke PASSED');
