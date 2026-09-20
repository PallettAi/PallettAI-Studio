#!/usr/bin/env node
'use strict';

// ============================================================
// render-variety-probe — variety at the level the visitor sees.
//
// The data can be perfectly diverse and the site still look the same, because
// the thing a person judges is the compiled HTML: which elements exist, in
// which order, with which classes. A layout value the renderer ignores is a
// layout value that never happened, and it is invisible to any probe that only
// inspects the project JSON.
//
// So this probe measures three separate things:
//
//   1. SHAPE      — the tag+class sequence of the page with all copy removed,
//                   hashed. Two sites with the same shape are the same site.
//   2. BANDS      — the same, but sliced per section type: a page can be
//                   structurally unique while every hero in the set is
//                   byte-identical after copy is stripped.
//   3. KNOBS      — every layout value each section type declares, rendered
//                   one at a time, to see which ones actually change the
//                   output. A knob that does nothing is a promise the app
//                   breaks silently.
//
// Run: PROMPT='a family run café in Derby' N=40 node scripts/render-variety-probe.js
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

const PROMPT = process.env.PROMPT || 'a family run café in Derby';
const N = Number(process.env.N || 40);
const TIER = process.env.TIER || 'pro';
const SETTINGS = { tier: TIER === 'free' ? 'free' : TIER };

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

// Strip everything a person would not call "the design": the text inside tags
// and the attribute values that carry content. What is left is structure.
function shape(html) {
  const body = String(html).replace(/<script[\s\S]*?<\/script>/gi, '<script>')
    .replace(/<style[\s\S]*?<\/style>/gi, '<style>');
  const tags = body.match(/<[a-z][^>]*>/gi) || [];
  return tags.map((t) => {
    const name = (t.match(/^<([a-z0-9]+)/i) || [])[1] || '?';
    const cls = (t.match(/class="([^"]*)"/) || [])[1] || '';
    const keep = cls.split(/\s+/).filter(Boolean).sort().join('.');
    return name + (keep ? '.' + keep : '');
  }).join('>');
}

// sectionShell emits <section id="sec-TYPE-N" class="section sec-TYPE" ...>…</section>.
// Slicing on that marker is the only reliable way to isolate one section: an
// earlier version of this probe matched the nav anchor instead and reported
// "1 distinct" for sections that were in fact rendering.
function band(html, type) {
  const re = /<section[^>]*class="section sec-([a-z0-9-]+)[" ][\s\S]*?<\/section>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    if (m[1] === type) return m[0];
  }
  return '';
}

function build(p) {
  try { return Builder.buildSiteHTML(p, SETTINGS) || ''; } catch (e) { return '__ERR__' + e.message; }
}

// ---------------------------------------------------------------- 1 + 2
const shapes = [];
const bands = {};
const meta = [];

for (let i = 0; i < N; i++) {
  const salt = (i * 2654435761) >>> 0;
  const p = AI.generateSite(PROMPT, { salt, layouts: 'auto', tier: TIER });
  const html = build(p);
  const s = shape(html);
  shapes.push(hash(s));

  const secs = (p.site.sections || []);
  const types = new Set(secs.map((x) => x.type));
  types.forEach((t) => {
    const b = shape(band(html, t));
    if (!b) return;
    bands[t] = bands[t] || [];
    bands[t].push(hash(b));
  });

  meta.push({
    hero: (secs.find((x) => x.type === 'hero') || {}).layout || '',
    layoutsByType: secs.map((x) => x.type + ':' + (x.layout || '-')),
    look: p.site.look || '',
    palette: p.site.palette || '',
    sections: secs.map((x) => x.type).join('>'),
    layouts: secs.map((x) => x.type + ':' + (x.layout || '-')).join(','),
    bytes: html.length
  });
}

const distinct = (a) => new Set(a).size;
const top = (arr) => {
  const c = {};
  arr.forEach((x) => { c[x] = (c[x] || 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => v + '× ' + String(k).slice(0, 46)).join(' | ');
};

console.log('\n=== RENDERED VARIETY — ' + PROMPT + ' (' + N + ' generations, tier ' + TIER + ') ===\n');
console.log('page shape (tag+class, copy stripped)     ' + distinct(shapes) + '/' + N + ' distinct');
const byCount = {};
shapes.forEach((s) => { byCount[s] = (byCount[s] || 0) + 1; });
const repeats = Object.values(byCount).filter((n) => n > 1);
console.log('  repeats: ' + repeats.length + ' signatures shared by 2+ sites' +
  (repeats.length ? ' (worst ' + Math.max.apply(null, repeats) + '×)' : ''));

// A hero is the first thing a visitor sees, so it gets its own line, and the
// other sections are measured per section TYPE rather than per page position.
const PER = {};
Object.keys(bands).forEach((t) => {
  const d = distinct(bands[t]);
  const n = bands[t].length;
  PER[t] = { d, n };
});
Object.keys(PER).sort((a, b) => (PER[a].d / PER[a].n) - (PER[b].d / PER[b].n)).forEach((t) => {
  const { d, n } = PER[t];
  const flag = d <= 2 ? '   <-- COLLAPSED' : (d <= Math.round(n * 0.2) ? '   <-- tight' : '');
  console.log(('  ' + t).padEnd(42) + d + '/' + n + ' distinct' + flag);
});
console.log('\nsection order                             ' + distinct(meta.map((m) => m.sections)) + '/' + N);
console.log('layout string                             ' + distinct(meta.map((m) => m.layouts)) + '/' + N);
console.log('avg page bytes                            ' + Math.round(meta.reduce((a, m) => a + m.bytes, 0) / N));

// ---------------------------------------------------------------- 3
// Which layout knobs does the renderer actually honour?
// The authoritative vocabulary is DB.layoutsFor(type) — the same list the app
// offers in the UI and the generator assigns from. Measuring anything else is
// measuring invented names.
console.log('\n=== LAYOUT KNOBS — every catalogue variant, does it change the HTML? ===\n');
const TYPES = ['hero', 'features', 'stats', 'about', 'gallery', 'pricing', 'testimonials', 'faq', 'blog', 'shop', 'contact', 'cta', 'logos', 'video', 'booking'];
const base = AI.generateSite(PROMPT, { salt: 12345, layouts: 'auto', tier: TIER });
const baseHtml = build(base);
const catalogue = {};
TYPES.forEach((type) => {
  const secs = base.site.sections || [];
  if (!secs.some((x) => x.type === type)) return;
  const variants = (typeof DB.layoutsFor === 'function' ? DB.layoutsFor(type) : []) || [];
  const seen = [];
  // '' first: the DEFAULT shape is the baseline every variant must differ from.
  ['', ...variants.map((v) => v.id)].forEach((v) => {
    const clone = JSON.parse(JSON.stringify(base));
    const target = (clone.site.sections || []).find((x) => x.type === type);
    if (!target) return;
    target.layout = v;
    const html = build(clone);
    seen.push([v || '(default)', hash(shape(band(html, type)))]);
  });
  catalogue[type] = seen;
  const present = seen.filter((r) => r[1] !== hash(''));
  const d = distinct(seen.map((r) => r[1]));
  const dead = seen.filter((r) => r[0] !== '(default)' && r[1] === seen[0][1]).map((r) => r[0]);
  console.log(('  ' + type).padEnd(14) + variants.length + ' variants → ' + d + ' distinct shapes' +
    (dead.length ? '   DEAD: ' + dead.join(', ') : ''));
});

// How many shapes does the whole catalogue yield, per the generator's own range?
const shapesPerType = Object.keys(catalogue).map((t) => distinct(catalogue[t].map((r) => r[1])));
console.log('\n  per-type shape count: ' + Object.keys(catalogue).map((t, k) => t + '=' + shapesPerType[k]).join(' '));
console.log('  product of the catalogue = ' + shapesPerType.reduce((a, b) => a * b, 1).toLocaleString() + ' possible pages\n');
