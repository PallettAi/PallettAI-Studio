#!/usr/bin/env node
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

let brief;
try {
  brief = require(path.join(ROOT, 'data', 'ai-brief.js'));
} catch (e) {
  console.error('ai-brief-smoke FAILED — module missing: ' + e.message);
  process.exit(1);
}

console.log('== Normalize brief ==');
const rustica = brief.normalizeBrief({
  name: '  Rustica  ',
  area: 'Leeds',
  offer: 'Sourdough daily',
  proofs: ['A', 'B'],
  cta: 'Book a loaf',
  voice: 'premium'
});
assert(rustica.name === 'Rustica', 'name is trimmed');
assert(rustica.proofs.length === 3, 'proofs always length 3');
assert(rustica.voice === 'premium', 'premium voice is kept');
assert(brief.normalizeBrief({ voice: 'LOUD' }).voice === 'warm', 'unknown voice falls back to warm');
assert(brief.briefFilled(rustica) === true, 'named brief is filled');
assert(brief.briefFilled(brief.normalizeBrief({})) === false, 'empty brief is not filled');

console.log('\n== Voice ==');
const v = brief.normalizeVoice({ tone: 'premium', banned: ['synergy', ''] });
assert(v.tone === 'premium', 'tone is premium');
assert(v.banned.length === 1 && v.banned[0] === 'synergy', 'empty banned phrases are dropped');
const punched = brief.applyVoice('We love synergy and we love synergy in every meeting.', { tone: 'punchy', banned: ['synergy'] });
assert(!/synergy/i.test(punched), 'banned phrase is removed');
assert(punched.length < 80, 'punchy voice keeps the line short');

const { loadAI } = require(path.join(ROOT, 'scripts', 'load-ai.js'));
const AI = loadAI();
const RUSTICA_BRIEF = {
  name: 'Rustica',
  area: 'Leeds',
  offer: 'Sourdough daily',
  proofs: ['48h dough', 'Single farm', 'Hot delivery'],
  cta: 'Book a loaf',
  voice: 'warm'
};

console.log('\n== generateSite consumes the brief ==');
const g = AI.generateSite('generic shop', { brief: RUSTICA_BRIEF });
assert(g && g.site.name === 'Rustica', 'brand from brief.name — got "' + (g && g.site.name) + '"');
assert(g && /sourdough/i.test(g.site.tagline || ''), 'tagline from brief.offer — "' + (g && g.site.tagline) + '"');
assert(g && g.site.area === 'Leeds', 'area from brief — got "' + (g && g.site.area) + '"');
assert(g && g.site.brief && g.site.brief.name === 'Rustica', 'site.brief is attached');
assert(g && g.site.voice && g.site.voice.tone === 'warm', 'site.voice is attached');
assert(g && /book a loaf/i.test(g.site.ctaText || ''), 'CTA from brief — "' + (g && g.site.ctaText) + '"');
const feats = (g.site.sections || []).find((s) => s.type === 'features')
  || ((g.site.pages || []).flatMap((p) => p.sections || []).find((s) => s.type === 'features'));
assert(feats && feats.items && /48h dough/i.test(feats.items[0].text || ''), 'first proof lands on a feature');

console.log('\n== Empty brief fields fall back ==');
const empty = AI.generateSite('wood fired pizza restaurant in naples', { brief: { name: '', offer: '', proofs: [] } });
assert(empty && empty.aiNicheId === 'pizzeria', 'empty brief still matches pizza from the prompt');
assert(empty && empty.site.name !== 'Rustica', 'empty name does not invent the brief brand');

console.log('\n== Multi-page from a filled brief ==');
const pages = (g.site.pages || []).map((p) => p.slug);
assert(pages.indexOf('index') !== -1, 'home slug is index');
assert(pages.indexOf('services') !== -1 || pages.indexOf('menu') !== -1, 'services or menu page exists');
assert(pages.indexOf('about') !== -1, 'about page exists');
assert(pages.indexOf('contact') !== -1, 'contact page exists');
const home = (g.site.pages || []).find((p) => p.slug === 'index');
assert(home && home.sections.some((s) => s.type === 'hero'), 'Home has a hero');
const contact = (g.site.pages || []).find((p) => p.slug === 'contact');
assert(contact && contact.sections.some((s) => s.type === 'contact'), 'Contact page has a contact section');
assert(contact && contact.sections.some((s) => s.type === 'map'), 'Contact page has a map when area is set');
assert(g.site.sections === home.sections, 'site.sections aliases Home');

const one = AI.generateSite('generic shop', { brief: RUSTICA_BRIEF, onePager: true });
assert(!one.site.pages || one.site.pages.length <= 1, 'onePager keeps a single page');

console.log('\n== Competitor study is structure, not copy ==');
const studied = AI.generateSite('generic shop', {
  brief: RUSTICA_BRIEF,
  studied: [{ url: 'https://rival.test/', brand: 'Rival Co', services: [{ title: 'Wholesale Beans', text: 'THEIR SECRET COPY' }] }],
  website: {
    ok: true, brand: 'Rival Co', tagline: 'Rival tagline steal me',
    about: 'Rival about paragraph that is long enough to overwrite the bakery story if we are not careful about copy theft.',
    reviews: [{ title: 'A fan', text: 'Steal this review please.' }, { title: 'Another', text: 'And this one too for the overwrite.' }]
  }
});
assert(studied.site.name === 'Rustica', 'filled brief wins the brand over the rival');
assert(!/Rival tagline/i.test(studied.site.tagline || ''), 'rival tagline is not pasted over a filled brief');
const about = (studied.site.pages || studied.site.sections && [{ sections: studied.site.sections }] || [])
  .flatMap((p) => p.sections || []).find((s) => s.type === 'about')
  || (studied.site.sections || []).find((s) => s.type === 'about');
assert(!about || !/Rival about paragraph/i.test(about.text || ''), 'rival about is not pasted over a filled brief');
const featStudied = (studied.site.pages || []).flatMap((p) => p.sections || []).find((s) => s.type === 'features')
  || (studied.site.sections || []).find((s) => s.type === 'features');
assert(featStudied && featStudied.items.some((it) => it.title === 'Wholesale Beans'), 'studied service titles are used');
assert(featStudied && !featStudied.items.some((it) => /SECRET COPY/i.test(it.text || '')), 'studied service body copy is not stolen');
assert(studied.site.studied && studied.site.studied.length === 1 && studied.site.studied[0].url === 'https://rival.test/', 'site.studied is attached');

if (failed) {
  console.error('\nai-brief-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-brief-smoke PASSED');
