#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

let Finger;
try {
  Finger = require(path.join(ROOT, 'data', 'ai-fingerprint.js'));
} catch (e) {
  console.error('ai-fingerprint-smoke FAILED — module missing: ' + e.message);
  process.exit(1);
}

const { loadAI } = require(path.join(ROOT, 'scripts', 'load-ai.js'));
const AI = loadAI();
const DB = require(path.join(ROOT, 'data', 'db.js'));
const Builder = (() => {
  const vm = require('vm');
  const sandbox = {
    console, URL, setTimeout, clearTimeout, Math, Date, JSON, Set, Promise, process,
    DB, ONLINE: require(path.join(ROOT, 'data', 'online.js'))
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'modules', 'builder.js'), 'utf8') + '\n;globalThis.Builder = Builder;', sandbox);
  return sandbox.Builder;
})();

const BRIEF_A = {
  name: 'LeakStop',
  area: 'York',
  offer: '24-hour callout',
  proofs: ['Gas safe', 'Fixed prices', 'Same-day visits'],
  cta: 'Book a visit',
  voice: 'warm'
};
const BRIEF_B = { ...BRIEF_A, name: 'DrainPro' };
const PROMPT = 'plumber emergency repairs in york';

function dnaOf(p) {
  const hero = (p.site.sections || []).find((s) => s.type === 'hero') || {};
  return [
    p.site.palette,
    p.site.font,
    p.site.fontDisplay || '',
    (p.site.design && p.site.design.radius) || '',
    hero.layout || '',
    (p.site.sections || []).map((s) => s.type).join(',')
  ].join('|');
}

function copyOf(p) {
  const hero = (p.site.sections || []).find((s) => s.type === 'hero') || {};
  return [p.site.tagline, hero.title, hero.text, p.site.ctaText].join('|');
}

console.log('== Fingerprint key ==');
const fa = Finger.make({ name: 'LeakStop', area: 'York', offer: '24-hour callout', voice: 'warm', nicheId: 'plumber', prompt: PROMPT, salt: 0 });
const fb = Finger.make({ name: 'DrainPro', area: 'York', offer: '24-hour callout', voice: 'warm', nicheId: 'plumber', prompt: PROMPT, salt: 0 });
const fa2 = Finger.make({ name: 'LeakStop', area: 'York', offer: '24-hour callout', voice: 'warm', nicheId: 'plumber', prompt: PROMPT, salt: 0 });
assert(fa.seed === fa2.seed && fa.key === fa2.key, 'same inputs produce the same seed');
assert(fa.seed !== fb.seed, 'a different name produces a different seed');
assert(Finger.nextSalt(0) === 1 && Finger.nextSalt(4) === 5, 'nextSalt increments');

const types = ['about', 'features', 'stats', 'pricing', 'faq'];
const midA = Finger.orderSections([{ type: 'hero' }].concat(types.map((t) => ({ type: t }))).concat([{ type: 'cta' }, { type: 'contact' }]), fa.seed).map((s) => s.type);
const midB = Finger.orderSections([{ type: 'hero' }].concat(types.map((t) => ({ type: t }))).concat([{ type: 'cta' }, { type: 'contact' }]), fb.seed).map((s) => s.type);
assert(midA[0] === 'hero' && midA[midA.length - 1] === 'contact' && midA[midA.length - 2] === 'cta', 'hero stays first, contact last');
assert(midB[0] === 'hero' && midB[midB.length - 1] === 'contact', 'a different seed still pins hero and contact');
const ident = ['a', 'b', 'c', 'd', 'e'];
assert([1, 2, 3, 4, 5].some((s) => JSON.stringify(Finger.seededShuffle(ident, s)) !== JSON.stringify(ident)), 'seededShuffle permutes for some seed');
assert(JSON.stringify(Finger.seededShuffle(types, 11)) === JSON.stringify(Finger.seededShuffle(types, 11)), 'seededShuffle is deterministic');

const off = Finger.photoGradeSpec({ on: false, typeId: 'food' });
assert(off.on === false, 'photo grade is off unless asked');
const food = Finger.photoGradeSpec({ on: true, typeId: 'food', look: 'warm' });
assert(food.on === true && food.blend === 'soft-light' && food.strength <= 0.13, 'food uses a soft-light grade at ≤12%');
const trade = Finger.photoGradeSpec({ on: true, typeId: 'home', look: 'dark' });
assert(trade.blend === 'color' && trade.strength <= 0.18 && trade.strength >= 0.14, 'trades/dark use color blend at 14–16%');

console.log('\n== generateSite is unrepeatable by identity, not by luck ==');
const a1 = AI.generateSite(PROMPT, { brief: BRIEF_A, onePager: true });
const a2 = AI.generateSite(PROMPT, { brief: BRIEF_A, onePager: true });
const b1 = AI.generateSite(PROMPT, { brief: BRIEF_B, onePager: true });
assert(a1 && a1.site && a1.site.fingerprint && typeof a1.site.fingerprint.seed === 'number', 'site stores a fingerprint seed');
assert(dnaOf(a1) === dnaOf(a2), 'same brief twice → same look (palette, fonts, hero, section order)');
assert(copyOf(a1) === copyOf(a2), 'same brief twice → same copy');
assert(dnaOf(a1) !== dnaOf(b1), 'a different name → a different skeleton');
assert(/book a visit/i.test(a1.site.navCta || ''), 'nav CTA matches the brief CTA — got "' + (a1.site.navCta || '') + '"');
assert(a1.site.navCta === a1.site.ctaText, 'nav CTA and primary CTA are the same string');
assert(!(a1.site.photoGrade && a1.site.photoGrade.on), 'photo grade is off by default');

const checks = DB.paletteChecks(DB.getPalette(a1.site.palette));
assert(checks.length > 0 && checks.every((c) => c.ratio >= 4.5), 'generated palette passes WCAG AA 4.5:1 — ' + a1.site.palette);
for (let i = 0; i < 12; i++) {
  const p = AI.generateSite(PROMPT + ' run ' + i, { brief: { ...BRIEF_A, name: 'Firm' + i, area: 'Leeds' }, onePager: true });
  const palChecks = DB.paletteChecks(DB.getPalette(p.site.palette));
  assert(palChecks.every((c) => c.ratio >= 4.5), 'palette ' + p.site.palette + ' on run ' + i + ' is AA');
}

console.log('\n== Shuffle look keeps copy ==');
assert(typeof AI.shuffleLook === 'function', 'AI.shuffleLook exists');
const shuffled = JSON.parse(JSON.stringify(a1));
const beforeTypes = (shuffled.site.sections || []).map((s) => s.type).join(',');
const beforeCopy = copyOf(shuffled);
const beforeDna = dnaOf(shuffled);
const look = AI.shuffleLook(shuffled, { tier: 'pro' });
assert(look && look.palette, 'shuffleLook returns the new DNA');
assert(copyOf(shuffled) === beforeCopy, 'shuffle does not rewrite copy');
assert((shuffled.site.sections || []).map((s) => s.type).join(',') === beforeTypes, 'shuffle does not reorder sections');
assert(dnaOf(shuffled) !== beforeDna, 'shuffle changes palette, fonts, or hero layout');
assert(shuffled.site.fingerprint && shuffled.site.fingerprint.salt === (a1.site.fingerprint.salt || 0) + 1, 'shuffle increments the fingerprint salt');
assert(AI.COST && AI.COST.shuffle === 1, 'shuffle costs one credit');

console.log('\n== Photo grade opt-in ==');
const graded = AI.generateSite(PROMPT, { brief: BRIEF_A, onePager: true, photoGrade: true });
assert(graded.site.photoGrade && graded.site.photoGrade.on === true, 'opts.photoGrade turns the grade on');
assert(graded.site.photoGrade.strength <= 0.18, 'grade strength stays subtle');

const htmlOff = Builder.buildSiteHTML(a1, { onlineEnabled: false });
assert(!/\bphoto-grade\b/.test(htmlOff), 'exported HTML has no photo-grade class when off');
assert(!/<body[^>]*class="[^"]*photo-grade/.test(htmlOff), 'body is not photo-grade by default');

graded.site.sections.forEach((s) => {
  if (s.type === 'hero') s.image = 'https://example.com/hero.jpg';
  if (s.type === 'about') s.image = 'https://example.com/about.jpg';
});
graded.site.logo = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"></svg>';
const htmlOn = Builder.buildSiteHTML(graded, { onlineEnabled: false });
assert(/class="[^"]*photo-grade/.test(htmlOn), 'body gets photo-grade when on');
assert(/mix-blend-mode:\s*color/.test(htmlOn) && /mix-blend-mode:\s*soft-light/.test(htmlOn), 'grade uses color + soft-light blend, not a wash');
assert(/@supports\s*\(mix-blend-mode:\s*color\)/.test(htmlOn), 'grade is gated on mix-blend-mode support');
assert(!/hue-rotate|sepia\(/.test(htmlOn), 'grade never uses hue-rotate or sepia');
assert(!/\.photo-grade[^{]*\{[^}]*opacity:\s*0?\.(3|[4-9])/.test(htmlOn), 'color overlay stays under 30% opacity');
assert(/class="brand-mark"><img/.test(htmlOn) && !/class="brand-mark"><span class="media-grade"/.test(htmlOn), 'logo is not wrapped in a grade frame');

console.log('\n== Favicon from the AI logo ==');
const withLogo = JSON.parse(JSON.stringify(a1));
withLogo.site.favicon = '';
withLogo.site.logo = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="%23000"/></svg>';
const favHtml = Builder.buildSiteHTML(withLogo, { onlineEnabled: false });
assert(/rel="icon" href="data:image\/svg\+xml,&lt;svg/.test(favHtml), 'logo data URI is used as the favicon when no emoji is set');
withLogo.site.favicon = '🥐';
const emojiHtml = Builder.buildSiteHTML(withLogo, { onlineEnabled: false });
assert(/🥐/.test(emojiHtml) && /rel="icon"/.test(emojiHtml), 'a custom emoji favicon still wins');

if (failed) {
  console.error('\nai-fingerprint-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-fingerprint-smoke PASSED');
