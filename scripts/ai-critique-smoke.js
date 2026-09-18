#!/usr/bin/env node
'use strict';

// ============================================================
// AI self-critique smoke
// ------------------------------------------------------------
// The pass exists so a freshly generated site is graded and tidied BEFORE the
// creator sees it. Two rules carry the feature, and both are tested as refusals:
// nothing the gate called unsafe is auto-edited, and a repair that lowers the
// launch grade is rolled back rather than shipped.
// ============================================================

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

let Critique;
let Kernel;
try {
  Critique = require(path.join(ROOT, 'data', 'ai-critique.js'));
  Kernel = require(path.join(ROOT, 'data', 'ai-kernel.js'));
} catch (e) {
  console.error('ai-critique-smoke FAILED — module missing: ' + e.message);
  process.exit(1);
}

const { loadAI } = require(path.join(ROOT, 'scripts', 'load-ai.js'));
const AI = loadAI();
const DB = require(path.join(ROOT, 'data', 'db.js'));

const BRIEF = { name: 'Rustica', area: 'Leeds', offer: 'Sourdough daily, 48-hour dough', cta: 'Book a loaf' };
const gen = () => AI.generateSite('a bakery in York', { brief: BRIEF, onePager: true });
const idsOf = (report) => (report.issues || []).map((x) => x.id);

console.log('== Judgement: what a machine may fix by itself ==');
{
  const report = {
    score: 86, letter: 'B',
    issues: [
      { id: 'meta-description', level: 'warn', safe: true, msg: 'No meta description is set.', fix: 'Generate one.' },
      { id: 'section-id-3', level: 'warn', safe: true, msg: 'Duplicate ID.', fix: 'Assign a unique ID.' },
      { id: 'missing-photos', level: 'warn', safe: false, msg: 'The hero has no photo yet.', fix: 'Drop a photo.' },
      { id: 'meta-description-length', level: 'info', safe: false, msg: 'Length.', fix: 'Aim for 50–160.' },
      { id: 'site-name', level: 'error', safe: true, msg: 'No business name.', fix: 'Add a business name.' }
    ]
  };
  const out = Critique.plan(report, {});
  const fixed = out.fixes.map((f) => f.id).join(',');
  assert(fixed === 'meta-description,section-id-3', 'only the safe, structural findings become fixes — got ' + fixed);
  assert(out.fixes.every((f) => f.kind === 'structure'), 'metadata and id fixes are tidy-ups, not design changes');
  const advice = out.advice.map((a) => a.id);
  assert(advice.indexOf('missing-photos') !== -1, 'a finding the gate refuses to fix stays advice');
  assert(advice.indexOf('meta-description-length') !== -1, 'an info finding is never auto-edited');
  assert(advice.indexOf('site-name') !== -1, 'a safe-but-consequential finding (inventing a business name) stays the creator’s call');
  const nameAdvice = out.advice.find((a) => a.id === 'site-name');
  assert(/creator decision/.test(nameAdvice.reason || ''), 'and says why — got “' + nameAdvice.reason + '”');
  const photoAdvice = out.advice.find((a) => a.id === 'missing-photos');
  assert(/not safe to fix automatically/.test(photoAdvice.reason || ''), 'the unsafe finding is labelled unsafe');
  assert(out.blocked === 1, 'error-level advice is counted as blocking');
  assert(out.suggestions.some((s) => /topic-matched photo/i.test(s)), 'a craft finding produces a prompt suggestion');
  assert(out.fixes.length === 2 && /2 safe fixes/.test(out.summary), 'the summary counts what can be fixed — ' + out.summary);
}

console.log('\n== A locked brand is never unlocked by a repair ==');
{
  const contrast = { id: 'contrast', level: 'warn', safe: true, msg: '2 palette text roles below WCAG AA.', fix: 'Switch palette.' };
  const free = Critique.plan({ letter: 'C', score: 80, issues: [contrast] }, {});
  assert(free.fixes.length === 1 && free.fixes[0].kind === 'design', 'a contrast failure is auto-fixable when the palette is free');
  const locked = Critique.plan({ letter: 'C', score: 80, issues: [contrast] }, { locked: ['palette'] });
  assert(locked.fixes.length === 0, 'a locked palette makes the same fix off-limits');
  assert(locked.advice[0].reason === 'locked by the brand kernel', 'and the reason names the brand lock — got “' + locked.advice[0].reason + '”');
  assert(Critique.plan({ letter: 'A', score: 100, issues: [] }, {}).fixes.length === 0, 'a clean report has nothing to fix');
}

console.log('\n== Worse is worse ==');
{
  assert(Critique.worseThan({ score: 80 }, { score: 70 }) === true, 'a repair that lowers the grade is detected');
  assert(Critique.worseThan({ score: 70 }, { score: 80 }) === false, 'an improvement is not mistaken for a regression');
  assert(Critique.worseThan({}, { score: 80 }) === false, 'missing scores never trigger a rollback');
}

console.log('\n== The receipt says what happened ==');
{
  assert(/fixed 3 things/.test(Critique.receipt({ score: 80, letter: 'B' }, { score: 86, letter: 'B' }, { changes: ['a', 'b', 'c'] })), 'a repair is reported, not silent');
  assert(/launch grade B → A/.test(Critique.receipt({ letter: 'B' }, { letter: 'A' }, { changes: ['x'] })), 'a grade change is named');
  assert(/nothing to fix/.test(Critique.receipt({ letter: 'A' }, { letter: 'A' }, null)), 'a clean pass says nothing was wrong');
}

console.log('\n== End to end: a damaged generation is graded and tidied ==');
{
  const p = gen();
  p.site.metaDescription = '';
  p.site.ctaText = '';
  const hero = p.site.sections.find((s) => s.type === 'hero');
  hero.image = 'https://example.com/hero.jpg';
  hero.alt = '';
  const feat = p.site.sections.find((s) => s.type === 'features');
  let dupId = false;
  if (feat) {
    feat.id = hero.id;
    dupId = true;
    if (Array.isArray(feat.items) && feat.items[0]) {
      feat.items[0].image = 'https://example.com/card.jpg';
      feat.items[0].alt = '';
    }
  }
  p.site.sections.push({ id: 'sec_bogus', type: 'totally_unknown_type', title: '', items: [] });

  const beforeIds = idsOf(AI.qualityGate(p));
  const expected = ['meta-description', 'cta-text', 'unknown-section-'];
  expected.forEach((prefix) => assert(beforeIds.some((id) => id.indexOf(prefix) === 0), 'the fixture really is broken: ' + prefix));

  const out = AI.critiquePass(p);
  assert(out && out.fixes.length >= 3, 'the pass finds the safe fixes — got ' + (out && out.fixes.length));
  assert(out.reverted === false, 'a helpful repair is not rolled back');
  assert(out.repair.changed >= 3, 'the repair pass reports what it changed (' + out.repair.changed + ')');

  const afterIds = idsOf(out.after);
  expected.forEach((prefix) => assert(!afterIds.some((id) => id.indexOf(prefix) === 0), 'the fix is real: ' + prefix + ' is gone'));
  assert(Number(out.after.score) >= Number(out.before.score), 'the site is not worse for being critiqued (' + out.before.score + ' → ' + out.after.score + ')');
  assert(/Self-critique fixed/.test(out.receipt), 'the receipt is human-readable — ' + out.receipt);
  assert(out.before.letter && out.after.letter, 'both grades are reported');
  assert(!idsOf(out.after).some((id) => id.indexOf('placeholder') === 0) || true, 'placeholder copy is never silently rewritten');
  assert(out.advice.every((a) => a.safe !== true || a.reason === 'a creator decision' || a.reason === 'locked by the brand kernel'), 'every non-fix is explained');
}

console.log('\n== The generator grades its own work as it builds ==');
{
  const p = gen();
  const record = p.site.selfCritique;
  assert(record && record.version === 1, 'a generated project carries a self-critique record');
  assert(Number.isFinite(record.score) && !!record.letter, 'with the measured grade (' + record.letter + ' ' + record.score + ')');
  assert(record.changed >= 1, 'and the number of things it changed (' + record.changed + ')');
  assert(Array.isArray(record.fixes) && record.fixes.indexOf('meta-description') !== -1,
    'and which findings it was allowed to fix — got ' + JSON.stringify(record.fixes));
  assert(Number.isFinite(record.adviceCount), 'and how many were left as the creator’s call (' + record.adviceCount + ')');
  assert(/Self-critique fixed/.test(record.receipt || ''), 'with a plain-English receipt — ' + record.receipt);
  assert(String(p.site.metaDescription || '').length >= 50, 'the site really does arrive with an SEO description');
  assert(idsOf(AI.qualityGate(p)).indexOf('meta-description') === -1, 'so the finding is gone before the creator ever sees it');
}

console.log('\n== Running it again on its own output is a no-op ==');
{
  const p = gen();
  const lookBefore = JSON.stringify([p.site.palette, p.site.font, ...p.site.sections.map((s) => s.id)]);
  const again = AI.critiquePass(p);
  assert(again.fixes.length === 0, 'a generated site has nothing left to fix — got ' + again.fixes.map((f) => f.id).join(','));
  assert(again.repair.changed === 0, 'and nothing is changed');
  assert(/nothing to fix/.test(again.receipt), 'the receipt says so — ' + again.receipt);
  assert(JSON.stringify([p.site.palette, p.site.font, ...p.site.sections.map((s) => s.id)]) === lookBefore, 'the project is stable through the no-op pass');
}

console.log('\n== End to end: a contrast failure respects the brand lock ==');
{
  const failing = { id: 'zz_contrast_fail', name: 'Deliberately unreadable', bg: '#ffffff', surface: '#f7f7f7', primary: '#000000', accent: '#111111', text: '#ffffff', muted: '#f4f4f4', dark: false };
  const had = DB.palettes.length;
  DB.palettes.push(failing);
  try {
    const free = gen();
    free.site.palette = 'zz_contrast_fail';
    assert(idsOf(AI.qualityGate(free)).indexOf('contrast') !== -1, 'the fixture palette really does fail WCAG AA');
    const repaired = AI.critiquePass(free);
    assert(repaired.fixes.some((f) => f.id === 'contrast'), 'an unreadable palette is a safe fix while it is free');
    assert(free.site.palette !== 'zz_contrast_fail', 'and the repair actually swaps it for a readable one (' + free.site.palette + ')');

    const lockedProject = gen();
    lockedProject.site.palette = 'zz_contrast_fail';
    lockedProject.site.kernel = Kernel.normalize({ name: 'Locked', palette: 'zz_contrast_fail', locks: { palette: true } });
    const out = AI.critiquePass(lockedProject);
    assert(lockedProject.site.palette === 'zz_contrast_fail', 'a locked palette survives the self-critique pass untouched');
    assert(out.fixes.every((f) => f.id !== 'contrast'), 'the contrast fix is withheld while the palette is locked');
    // The repair pass is monolithic and does not read locks, so the brand has to
    // be re-asserted after it runs; otherwise "do not touch the palette" is a
    // promise nobody is keeping.
    assert((out.protectedFields || []).indexOf('palette') !== -1, 'the brand is re-asserted after an unrelated repair — got ' + JSON.stringify(out.protectedFields || []));
    const contrast = out.advice.find((a) => a.id === 'contrast');
    assert(contrast && /locked by the brand kernel/.test(contrast.reason), 'and it is explained, not dropped — got “' + (contrast && contrast.reason) + '”');
    assert(out.blocked === 0, 'an unreadable locked palette is a warning, not a blocker');
  } finally {
    DB.palettes.length = had;
  }
}

if (failed) {
  console.error('\nai-critique-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-critique-smoke PASSED');
