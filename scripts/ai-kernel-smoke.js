#!/usr/bin/env node
'use strict';

// ============================================================
// AI brand kernel smoke
// ------------------------------------------------------------
// A kernel exists to make the generator obey an approved client look. So the
// interesting assertions are the refusals: an unlocked field must survive, copy
// must survive, and a lock must out-rank both the brief and the design DNA.
// ============================================================

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

let Kernel;
try {
  Kernel = require(path.join(ROOT, 'data', 'ai-kernel.js'));
} catch (e) {
  console.error('ai-kernel-smoke FAILED — module missing: ' + e.message);
  process.exit(1);
}

const { loadAI } = require(path.join(ROOT, 'scripts', 'load-ai.js'));
const AI = loadAI();

const BRIEF = { name: 'Rustica', area: 'Leeds', offer: 'Sourdough daily, 48-hour dough', cta: 'Book a loaf', voice: 'premium' };
const PROMPT = 'a bakery in York';
const base = () => AI.generateSite(PROMPT, { brief: BRIEF, onePager: true });
const clone = (p) => JSON.parse(JSON.stringify(p));
const lookOf = (p) => [p.site.palette, p.site.font, p.site.fontDisplay, p.site.design.radius, p.site.design.spacing].join('|');
const copyOf = (p) => JSON.stringify([p.site.tagline, p.site.sections.map((s) => [s.title, s.text, (s.items || []).map((i) => [i.title, i.text])])]);

console.log('== A kernel survives garbage ==');
assert(Kernel.normalize(null) === null, 'null is not a kernel');
assert(Kernel.normalize('locked') === null, 'a string is not a kernel');
assert(Kernel.normalize({}) && Kernel.normalize({}).locks.palette === false, 'a bare object normalises to an unlocked kernel');
{
  const k = Kernel.normalize({ radius: 9999, spacing: -50, voice: 'SHOUTY', imagery: ['  natural light  ', '', 'no stock smiles', 'a', 'b', 'c', 'd'] });
  assert(k.radius === 48 && k.spacing === 32, 'out-of-range numbers are clamped, not rejected (' + k.radius + '/' + k.spacing + ')');
  assert(k.voice === '', 'an unknown tone becomes no tone rather than a wrong one');
  assert(k.imagery.length === 6 && k.imagery[0] === 'natural light', 'imagery rules are trimmed, capped and de-blanked');
}

console.log('\n== Locks are explicit ==');
{
  const k = Kernel.lock({ name: 'Rustica', palette: 'midnight' }, 'palette', true);
  assert(Kernel.isLocked(k, 'palette'), 'a field can be locked');
  assert(!Kernel.isLocked(k, 'type'), 'and the others stay unlocked');
  assert(Kernel.lockedFields(k).join(',') === 'palette', 'lockedFields reports just that one');
  const off = Kernel.lock(k, 'palette', false);
  assert(!Kernel.isLocked(off, 'palette'), 'a lock can be released');
  assert(Kernel.lock(k, 'nonsense', true) && !Kernel.isLocked(k, 'nonsense'), 'an unknown field is ignored');
}

console.log('\n== Derive from a site that already looks right ==');
const site = base();
const derived = Kernel.derive(site, { name: 'Rustica', locks: { palette: true, type: true } });
assert(derived.palette === site.site.palette, 'derive reads the live palette (' + derived.palette + ')');
assert(derived.font === site.site.font && derived.fontDisplay === site.site.fontDisplay, 'derive reads the live typography');
assert(derived.radius === site.site.design.radius && derived.spacing === site.site.design.spacing, 'derive reads the live rhythm');
assert(derived.locks.palette === true && derived.locks.radius === false, 'derive honours the requested locks');

console.log('\n== Enforcement: locked fields move, unlocked fields do not ==');
{
  const target = clone(site);
  const hero = target.site.sections.find((s) => s.type === 'hero');
  const k = Kernel.derive(site, { locks: { palette: true } });
  // Move everything the kernel does not lock, so "unchanged" is a real claim.
  const other = AI.generateSite('a dog grooming studio in Bath', { onePager: true });
  target.site.palette = other.site.palette;
  target.site.font = other.site.font;
  target.site.design.radius = 4;
  target.site.design.spacing = 40;
  hero.layout = 'terminal';
  const before = copyOf(target);
  const out = Kernel.apply(target, k);
  assert(target.site.palette === k.palette, 'the locked palette is enforced (' + target.site.palette + ')');
  assert(out.applied.join(',') === 'palette', 'only the locked field is reported as applied — got ' + out.applied.join(','));
  assert(target.site.font === other.site.font, 'an unlocked font is left alone');
  assert(target.site.design.radius === 4 && target.site.design.spacing === 40, 'unlocked rhythm is left alone');
  assert(hero.layout === 'terminal', 'an unlocked hero treatment is left alone');
  assert(copyOf(target) === before, 'enforcement never edits the client’s copy');
}
{
  const target = clone(site);
  const k = Kernel.derive(site, { locks: { radius: true, spacing: true } });
  target.site.design.radius = 4;
  target.site.design.spacing = 40;
  Kernel.apply(target, k);
  assert(target.site.design.radius === k.radius && target.site.design.spacing === k.spacing, 'radius + spacing enforce together');
}

console.log('\n== Violations name the drift ==');
{
  const k = Kernel.derive(site, { locks: { palette: true, type: true, radius: true } });
  assert(Kernel.violations(clone(site), k).length === 0, 'a site that matches its kernel has no violations');
  const drifted = clone(site);
  drifted.site.palette = 'something-else';
  drifted.site.font = 'comic';
  const v = Kernel.violations(drifted, k);
  const fields = v.map((x) => x.field).join(',');
  assert(fields === 'palette,type', 'drift is reported per field — got ' + fields);
  assert(v[0].label === 'Palette' && v[0].expected === k.palette && v[0].actual === 'something-else', 'a violation carries what was expected and what is there');
  const unlocked = Kernel.normalize({ palette: 'x', locks: {} });
  assert(Kernel.violations(drifted, unlocked).length === 0, 'an unlocked field can never be violated');
}

console.log('\n== Prompt contract raises only what is locked ==');
{
  const k = Kernel.derive(site, { locks: { palette: true, voice: true, imagery: true }, imagery: ['natural light, no studio stock'] });
  const lines = Kernel.promptContract(k).join('\n');
  assert(/palette/i.test(lines), 'a locked palette reaches the model as a constraint');
  assert(/tone of voice/i.test(lines), 'a locked voice reaches the model as a constraint');
  assert(/Imagery rules/i.test(lines), 'imagery rules reach the model as a constraint');
  const constitution = Kernel.normalize({ mood: 'editorial restraint', button: 'quiet outline', shadows: 'soft only', preferred: ['asymmetric compositions'], forbidden: ['generic card grids'], locks: { constitution: true } });
  const constitutionLines = Kernel.promptContract(constitution).join('\\n');
  assert(/editorial restraint/.test(constitutionLines) && /generic card grids/.test(constitutionLines), 'the design constitution reaches the model as visual rules');
  assert(!/radius stays/i.test(lines) && !/Section rhythm/i.test(lines), 'an unlocked radius/spacing is not presented as a constraint');
  const bare = Kernel.normalize({ palette: 'x', locks: {} });
  assert(Kernel.promptContract(bare).length === 0, 'a kernel with nothing locked constrains nothing');
  assert(Kernel.lockedFields(constitution).indexOf('constitution') !== -1, 'the constitution can be locked as one explicit field');
}

console.log('\n== Describe is honest about prompt-only fields ==');
{
  const k = Kernel.derive(site, { name: 'Rustica', locks: { palette: true, type: true, voice: true } });
  const d = Kernel.describe(k);
  assert(/Palette/.test(d) && /Typography/.test(d), 'the description names the enforced fields — ' + d);
  assert(/prompt constraint/i.test(d), 'and says the tone of voice is only a prompt constraint');
  assert(/nothing locked yet/.test(Kernel.describe(Kernel.normalize({ name: 'X' }))), 'an empty kernel says so');
}

console.log('\n== A brand preset becomes a kernel ==');
{
  const preset = {
    name: 'Rustica system', palette: 'midnight', font: 'inter', fontDisplay: 'newsreader',
    heroLayout: 'split', design: { radius: 6, spacing: 120 }
  };
  const k = Kernel.fromPreset(preset);
  assert(k.name === 'Rustica system', 'the preset name carries over');
  assert(k.radius === 6 && k.spacing === 120 && k.heroLayout === 'split', 'the preset’s visual system carries over');
  const fields = Kernel.lockedFields(k).join(',');
  assert(fields === 'palette,type,radius,spacing,layout', 'a saved visual system locks the renderer-owned fields by default — got ' + fields);
}

console.log('\n== generateSite obeys a kernel (end to end) ==');
{
  const other = AI.generateSite('a dog grooming studio in Bath', { onePager: true });
  const k = Kernel.normalize({
    name: 'Rustica', palette: other.site.palette, font: other.site.font, fontDisplay: other.site.fontDisplay,
    radius: 6, spacing: 120, heroLayout: 'terminal',
    locks: { palette: true, type: true, radius: true, spacing: true, layout: true }
  });
  assert(k.palette !== site.site.palette, 'the locked palette really is different from the free choice (fixture sanity)');
  const built = AI.generateSite(PROMPT, { brief: BRIEF, onePager: true, kernel: k });
  assert(built.site.palette === k.palette, 'generated palette obeys the lock (' + built.site.palette + ')');
  assert(built.site.font === k.font, 'generated typography obeys the lock (' + built.site.font + ')');
  assert(built.site.design.radius === k.radius && built.site.design.spacing === k.spacing, 'generated rhythm obeys the lock');
  const hero = built.site.sections.find((s) => s.type === 'hero');
  assert(hero && hero.layout === k.heroLayout, 'the hero treatment obeys the lock (' + (hero && hero.layout) + ')');
  assert(built.site.kernel && built.site.kernel.name === 'Rustica', 'the kernel travels with the project');
  assert(built.aiKernel && built.aiKernel.locked.length === 5, 'and the project records what was locked');
  assert(built.site.name === 'Rustica', 'enforcement does not disturb the brief’s brand name');
  assert(Kernel.violations(built, k).length === 0, 'the generated site has no kernel violations');
}

console.log('\n== A locked voice out-ranks the brief ==');
{
  const k = Kernel.normalize({ voice: 'punchy', locks: { voice: true } });
  const built = AI.generateSite(PROMPT, { brief: BRIEF, onePager: true, kernel: k });
  assert(built.site.voice && built.site.voice.tone === 'punchy', 'the locked tone wins over the brief’s “premium” — got ' + (built.site.voice && built.site.voice.tone));
  const free = AI.generateSite(PROMPT, { brief: BRIEF, onePager: true });
  assert(free.site.voice && free.site.voice.tone === 'premium', 'without a kernel the brief still decides the tone');
}

console.log('\n== No kernel, no change (regression guard) ==');
{
  const plain = AI.generateSite(PROMPT, { brief: BRIEF, onePager: true });
  assert(!plain.site.kernel && !plain.aiKernel, 'a generation without a kernel stores no kernel');
  const withEmpty = AI.generateSite(PROMPT, { brief: BRIEF, onePager: true, kernel: { locks: {} } });
  assert(lookOf(withEmpty) === lookOf(plain), 'an unlocked kernel changes nothing about the look');
  assert(copyOf(withEmpty) === copyOf(plain), 'an unlocked kernel changes nothing about the copy');
}

console.log('\n== generateSite does not mutate the caller’s kernel ==');
{
  const k = Kernel.normalize({ palette: 'midnight', locks: { palette: true } });
  const snapshot = JSON.stringify(k);
  AI.generateSite(PROMPT, { brief: BRIEF, onePager: true, kernel: k });
  assert(JSON.stringify(k) === snapshot, 'the kernel object is treated read-only');
}

if (failed) {
  console.error('\nai-kernel-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-kernel-smoke PASSED');
