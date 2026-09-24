#!/usr/bin/env node
// ============================================================
// PallettAI Studio — backend copy engine smoke
// ------------------------------------------------------------
// Covers modules/copy-optimizer.js and modules/copy-ast-editor.js:
// the local CRO rewrite engine behind the Section Toolbar's Voice
// Lock controls.
//
//   · the banned vocabulary is the whole list, and it is actually
//     gone from the output — checked against a list written out in
//     THIS file, so a module that quietly edited its own list
//     cannot certify itself
//   · every Voice Lock × CRO framework × niche combination runs,
//     stays non-empty and stays clean
//   · the voice locks differ in a way you can measure (sentence
//     length, contractions, hype), not just in a label
//   · a model answer is graded by the same scrubber as the local
//     engine, and a model that fails falls back instead of failing
//   · the AST editor changes words and nothing else: classes, data
//     attributes and inline SVG survive byte-for-byte
//
//   node scripts/backend-copy-smoke.js
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const CopyOptimizer = require('../modules/copy-optimizer.js');
const CopyAstEditor = require('../modules/copy-ast-editor.js');

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(label);
  console.error('  x ' + label + (detail ? ' [' + String(detail).slice(0, 200) + ']' : ''));
}
function eq(a, b, label) { ok(a === b, label + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function section(name) { console.log('\n== ' + name + ' =='); }

/* ============================================================
   The spec, written out independently of the module.
   If the module's list ever drifts, these two disagree and the
   suite fails — which is the only way a "banned words" test can
   mean anything.
   ============================================================ */
const SPEC_BANNED = [
  'unleash', 'elevate', 'delve', 'tapestry', 'game-changer', 'seamlessly',
  'beacon', 'testament to', "in today's fast-paced world", 'cutting-edge', 'realm'
];

// An independent scanner: word-boundary for single words, phrase-wise for
// the rest, and never dependent on the module's own helpers.
function specHits(text) {
  const src = String(text || '');
  const found = [];
  SPEC_BANNED.forEach((term) => {
    const body = term
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/'/g, "['\u2019]")
      .replace(/-/g, '[-\\s]?')
      .replace(/\s+/g, '\\s+');
    const re = /^[a-z]+$/i.test(term)
      ? new RegExp('\\b' + body + '(s|es|ed|ing)?\\b', 'gi')
      : new RegExp(body, 'gi');
    if (re.test(src)) found.push(term);
  });
  return found;
}

function sentencesOf(text) {
  return String(text || '').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}
function maxSentenceWords(text) {
  return sentencesOf(text).reduce((max, s) => Math.max(max, s.split(/\s+/).filter(Boolean).length), 0);
}

const CLICHE = 'In today\'s fast-paced world, our team strives to unleash the power of our seamless solutions to elevate every brand, delve into cutting-edge ideas, and become a beacon of excellence — a true testament to the realm of modern craftsmanship.';

/* ============================================================
   0 — module surface
   ============================================================ */
section('0. module surface');
{
  ok(!!CopyOptimizer && typeof CopyOptimizer === 'object', 'copy-optimizer loads');
  ok(!!CopyAstEditor && typeof CopyAstEditor === 'object', 'copy-ast-editor loads');
  ['optimizeCopy', 'optimizeCopyAsync', 'scrubAIVocabulary', 'buildSystemPrompt', 'findBannedTerms', 'setCompleter'].forEach((fn) => {
    ok(typeof CopyOptimizer[fn] === 'function', 'copy-optimizer exports ' + fn + '()');
  });
  ['applyOptimizedCopySection', 'parseHtml', 'findScope', 'setElementText'].forEach((fn) => {
    ok(typeof CopyAstEditor[fn] === 'function', 'copy-ast-editor exports ' + fn + '()');
  });
  ok(Object.isFrozen(CopyOptimizer.BANNED_AI_VOCABULARY), 'the banned list is frozen (nobody appends to it at runtime)');
}

/* ============================================================
   1 — the banned vocabulary itself
   ============================================================ */
section('1. banned vocabulary');
{
  eq(CopyOptimizer.BANNED_AI_VOCABULARY.length, SPEC_BANNED.length, 'the list has every required term and nothing else');
  SPEC_BANNED.forEach((term) => {
    ok(CopyOptimizer.BANNED_AI_VOCABULARY.indexOf(term) !== -1, 'the list contains "' + term + '"');
  });
  // Real uses, not just dictionary forms.
  const dirty = 'We unleash the tapestry of delight; seamlessly, we delve into realms while elevating beacons.';
  const hits = CopyOptimizer.findBannedTerms(dirty);
  ok(hits.length >= 6, 'findBannedTerms catches the cliché sentence (' + hits.length + ' terms)', hits.join(', '));
  ok(CopyOptimizer.findBannedTerms('We fit roofs in two days and clean up after ourselves.').length === 0,
    'findBannedTerms leaves honest copy alone');
  // Inflections are how a banned word actually escapes a naive scrub.
  ok(CopyOptimizer.findBannedTerms('unleashing a tapestry of realms').length === 3,
    'plurals and gerunds are caught too', CopyOptimizer.findBannedTerms('unleashing a tapestry of realms').join(', '));
  ok(CopyOptimizer.findBannedTerms('The real machine works.').length === 0, '"real" is not "realm" (no false positive)');
}

/* ============================================================
   2 — Task 4: the headline requirement
   ============================================================ */
section('2. optimizeCopy: punchy + PAS on the cliché paragraph');
const optimized = CopyOptimizer.optimizeCopy(CLICHE, { voiceLock: 'punchy', framework: 'PAS' });
{
  ok(optimized.ok === true, 'optimizeCopy reports ok');
  eq(optimized.voiceLock, 'punchy', 'the requested voice lock is applied');
  eq(optimized.framework, 'PAS', 'the requested framework is applied');
  eq(optimized.engine, 'local', 'the offline engine answers when no model is configured');
  ok(typeof optimized.text === 'string' && optimized.text.trim().length > 20, 'it produced real copy');
  ok(specHits(optimized.text).length === 0, 'ZERO banned vocabulary in the output', specHits(optimized.text).join(', '));
  ok(optimized.clean === true && optimized.flagged.length === 0, 'the result self-reports clean');
  ok(optimized.removed.length >= 4, 'the clichés it removed are reported (' + optimized.removed.length + ')', optimized.removed.join(', '));
  ok(optimized.removed.indexOf('unleash the power of') !== -1 || optimized.removed.indexOf('unleash') !== -1,
    'the phrase rule counts as removing "unleash"', optimized.removed.join(', '));
  eq(optimized.beats.length, 3, 'PAS produces three beats');
  eq(optimized.beats.map((b) => b.role).join(','), 'problem,agitate,solution', 'and they are named in order');
  ok(optimized.beats.every((b) => b.text.trim().length > 0), 'no beat is empty');
  ok(maxSentenceWords(optimized.text) <= 11, 'punchy holds its eleven-word ceiling (max ' + maxSentenceWords(optimized.text) + ')');
  ok(optimized.changed === true, 'the copy actually changed');
  ok(optimized.text !== CLICHE, 'and it is not the input echoed back');
  ok(/[A-Z]/.test(optimized.text.charAt(0)) && /[.!?]$/.test(optimized.text), 'it starts capitalised and ends as a sentence');
  ok(!/\s{2,}/.test(optimized.text), 'no double spaces survived the rewrite');
  ok(!/\s+[,.;:!?]/.test(optimized.text), 'no floating punctuation before a space');
  ok(!/!/.test(optimized.text), 'no exclamation marks, even in punchy');
  console.log('  -> ' + optimized.text);
}

/* ============================================================
   3 — the whole matrix runs, stays full and stays clean
   ============================================================ */
section('3. every voice lock x framework x niche');
{
  const voices = ['warm', 'premium', 'punchy', 'editorial'];
  const frameworks = ['PAS', 'AIDA', 'BAB'];
  const niches = ['roofing', 'dental', 'legal', '', 'plumbing'];
  let runs = 0;
  let dirty = 0;
  let empty = 0;
  let wrongCeiling = 0;
  voices.forEach((voiceLock) => {
    frameworks.forEach((framework) => {
      niches.forEach((niche) => {
        const r = CopyOptimizer.optimizeCopy(CLICHE, { voiceLock, framework, niche });
        runs++;
        if (!r.ok || !r.text || r.text.trim().length < 12) empty++;
        if (specHits(r.text).length) dirty++;
        if (maxSentenceWords(r.text) > CopyOptimizer.VOICE_LOCKS[voiceLock].sentenceCeiling) wrongCeiling++;
      });
    });
  });
  eq(runs, 60, 'the matrix ran 60 combinations');
  eq(empty, 0, 'none of them produced empty copy');
  eq(dirty, 0, 'none of them produced banned vocabulary');
  eq(wrongCeiling, 0, 'all of them respect their voice lock sentence ceiling');

  const bad = CopyOptimizer.optimizeCopy(CLICHE, { voiceLock: 'shouty', framework: 'nonsense' });
  eq(bad.voiceLock, 'warm', 'an unknown voice lock falls back to warm');
  eq(bad.framework, 'PAS', 'an unknown framework falls back to PAS');
  const alias = CopyOptimizer.optimizeCopy('We fix leaks.', { voice: 'premium' });
  eq(alias.voiceLock, 'premium', 'the legacy `voice` option still selects a voice lock');
}

/* ============================================================
   4 — the voice locks differ in measurable ways
   ============================================================ */
section('4. the voice locks are real rules, not labels');
{
  const hedgy = 'We really unleash the power of our seamless solutions and it is very easy to use. Our amazing team is here to help.';
  const warm = CopyOptimizer.optimizeCopy(hedgy, { voiceLock: 'warm', framework: 'PAS' });
  const punchy = CopyOptimizer.optimizeCopy(hedgy, { voiceLock: 'punchy', framework: 'PAS' });
  const premium = CopyOptimizer.optimizeCopy(hedgy, { voiceLock: 'premium', framework: 'PAS' });
  const editorial = CopyOptimizer.optimizeCopy(hedgy, { voiceLock: 'editorial', framework: 'PAS' });

  ok(maxSentenceWords(punchy.text) < maxSentenceWords(warm.text),
    'punchy sentences are shorter than warm ones (' + maxSentenceWords(punchy.text) + ' < ' + maxSentenceWords(warm.text) + ')');
  ok(/\b(really|very)\b/i.test(warm.text), 'warm keeps the writer\'s own hedges', warm.text);
  ok(!/\b(really|very)\b/i.test(punchy.text), 'punchy cuts hedges', punchy.text);
  ok(/\b(amazing)\b/i.test(warm.text), 'warm keeps the hype adjective', warm.text);
  ok(!/\b(amazing)\b/i.test(premium.text) && !/\b(amazing)\b/i.test(editorial.text),
    'premium and editorial remove hype');
  ok(/\b(it's|we're|don't|that's)\b/i.test(warm.text), 'warm uses contractions', warm.text);
  ok(!/\b(it's|we're|don't|that's|you're|won't)\b/i.test(premium.text), 'premium expands contractions', premium.text);
  ok(warm.text !== punchy.text && punchy.text !== premium.text, 'the four voices do not collapse into one');
  voicesDifferCheck(CopyOptimizer);
}
function voicesDifferCheck(Mod) {
  // The input has to give the voices something to disagree about: a clean,
  // already-short sentence is the one case where four rule sets legitimately
  // produce the same line, so testing on one would assert the wrong thing.
  const input = 'We really love our amazing team, and we are always happy to delve into what you need in order to deliver fast results.';
  const outputs = ['warm', 'premium', 'punchy', 'editorial']
    .map((v) => Mod.optimizeCopy(input, { voiceLock: v, framework: 'AIDA' }).text);
  ok(new Set(outputs).size >= 3, 'at least three of the four voices differ on the same input (' + new Set(outputs).size + ')');
  outputs.forEach((text) => ok(specHits(text).length === 0, 'the voice sample is clean: ' + text.slice(0, 40)));
}

/* ============================================================
   5 — scrubAIVocabulary is the guard everything shares
   ============================================================ */
section('5. scrubAIVocabulary');
{
  const dirty = 'We elevate brands across the realm with a seamless, cutting-edge beacon.';
  const scrubbed = CopyOptimizer.scrubAIVocabulary(dirty);
  ok(scrubbed.flagged.length >= 3, 'leftovers are flagged (' + scrubbed.flagged.length + ')', scrubbed.flagged.join(', '));
  ok(scrubbed.clean === true, 'and stripped');
  ok(specHits(scrubbed.text).length === 0, 'the cleaned text carries no banned vocabulary', scrubbed.text);
  ok(scrubbed.replaced.length >= 3, 'every substitution is reported');

  const flaggedOnly = CopyOptimizer.scrubAIVocabulary(dirty, { strip: false });
  eq(flaggedOnly.text, dirty, 'strip:false only flags, it does not edit');
  ok(flaggedOnly.flagged.length >= 3, '...but it still flags');

  const twice = CopyOptimizer.scrubAIVocabulary(scrubbed.text);
  eq(twice.text, scrubbed.text, 'scrubbing clean copy is a no-op (idempotent)');
  eq(twice.flagged.length, 0, '...and reports nothing');
  eq(CopyOptimizer.scrubAIVocabulary('').clean, true, 'empty input is trivially clean');
  ok(CopyOptimizer.scrubAIVocabulary('Unleashing the realms of tapestry.').clean === true,
    'an inflected form is stripped too');
}

/* ============================================================
   6 — the strict system prompt
   ============================================================ */
section('6. buildSystemPrompt');
{
  const prompt = CopyOptimizer.buildSystemPrompt(CLICHE, { voiceLock: 'premium', framework: 'AIDA', niche: 'dental' });
  SPEC_BANNED.forEach((term) => {
    ok(prompt.indexOf(term) !== -1, 'the prompt names the banned term "' + term + '"');
  });
  ok(/PREMIUM/.test(prompt) && /precise/i.test(prompt), 'the premium voice directive is in the prompt');
  ok(/ATTENTION/.test(prompt) && /INTEREST/.test(prompt) && /DESIRE/.test(prompt) && /ACTION/.test(prompt),
    'the AIDA beat instructions are all present');
  ok(/dental/i.test(prompt), 'the niche is named');
  ok(/twenty two years|HARD RULES|HARD RULES/.test(prompt) && /OUTPUT CONTRACT/.test(prompt), 'the output contract is stated');
  ok(/Return ONLY minified JSON/.test(prompt), 'the prompt forces a machine-readable answer');
  ok(prompt.indexOf(CLICHE) !== -1, 'the raw copy is embedded for rewriting');
  ok(/never invent/i.test(prompt), 'fact invention is forbidden');
  const pas = CopyOptimizer.buildSystemPrompt('x', { framework: 'PAS' });
  ok(/PROBLEM/.test(pas) && /AGITATE/.test(pas) && /SOLUTION/.test(pas), 'PAS beats appear in the PAS prompt');
  ok(CopyOptimizer.buildSystemPrompt(CLICHE, {}).indexOf('unleash') !== -1, 'the banned list is always present');
}

/* ============================================================
   7 — the model seam: a model answer is graded, not trusted
   ============================================================ */
section('7. the model path (async)');
// Captured so the summary can wait for it. Printing the summary synchronously
// let a failing async assertion land AFTER "ALL GREEN" and still exit 0.
let asyncWork;
{
  let sawSystem = null;
  const goodModel = (req) => { sawSystem = req.system; return Promise.resolve(JSON.stringify({
    beats: [{ role: 'problem', text: 'Your roof leaks.' }],
    copy: 'Your roof leaks. We fix it in two days. Book a free survey.'
  })); };

  asyncWork = CopyOptimizer.optimizeCopyAsync(CLICHE, { voiceLock: 'warm', framework: 'PAS', complete: goodModel })
    .then((r) => {
      eq(r.engine, 'model', 'a configured model answers');
      eq(r.text, 'Your roof leaks. We fix it in two days. Book a free survey.', 'the model copy is used verbatim when clean');
      ok(!!sawSystem && sawSystem.indexOf('unleash') !== -1, 'the model received the strict system prompt');
      ok(specHits(r.text).length === 0, 'and the output is clean');

      // A model that answers with prose, fences and banned vocabulary.
      const dirtyModel = () => Promise.resolve('```json\n{"copy":"We unleash seamless, cutting-edge solutions that elevate your realm."}\n```');
      return CopyOptimizer.optimizeCopyAsync(CLICHE, { voiceLock: 'warm', framework: 'PAS', complete: dirtyModel });
    })
    .then((r) => {
      eq(r.engine, 'model', 'the model path still answers');
      ok(specHits(r.text).length === 0, 'a model that ignores the prompt is still scrubbed clean', r.text);
      ok(/straightforward|modern|area|without friction|improve|dig/i.test(r.text), 'the clichés were replaced, not deleted', r.text);

      const throwing = () => Promise.reject(new Error('offline'));
      return CopyOptimizer.optimizeCopyAsync(CLICHE, { voiceLock: 'punchy', framework: 'PAS', complete: throwing });
    })
    .then((r) => {
      ok(r.ok === true, 'a model that throws does not fail the caller');
      eq(r.engine, 'local', 'it falls back to the local engine');
      ok(/model path failed/.test(r.error || ''), 'and says why', r.error);
      ok(specHits(r.text).length === 0, 'the fallback copy is still clean');

      const empty = () => Promise.resolve('');
      return CopyOptimizer.optimizeCopyAsync(CLICHE, { voiceLock: 'warm', framework: 'PAS', complete: empty });
    })
    .then((r) => {
      eq(r.engine, 'local', 'an empty model answer falls back too');
      ok(r.text.trim().length > 20, 'and the caller still gets usable copy');
      return CopyOptimizer.optimizeCopyAsync(CLICHE, { voiceLock: 'warm', framework: 'PAS' });
    })
    .then((r) => {
      eq(r.engine, 'local', 'no completer at all is the default, offline path');
      // setCompleter registers one process-wide; make sure the seam works and
      // then hand the module back exactly as it was found.
      const before = CopyOptimizer.setCompleter(() => Promise.resolve('Registered copy.'));
      return CopyOptimizer.optimizeCopyAsync('raw', { voiceLock: 'warm' }).then((rr) => {
        ok(before === true && rr.engine === 'model' && rr.text === 'Registered copy.', 'setCompleter installs a persistent adapter');
        CopyOptimizer.setCompleter(null);
        return CopyOptimizer.optimizeCopyAsync('raw', { voiceLock: 'warm' });
      }).then((rr2) => {
        eq(rr2.engine, 'local', 'and setCompleter(null) removes it again');
      });
    })
    .then(async () => {
      // Regression: a model that answers with JSON we cannot USE must fall back
      // to the local engine. Shipping the raw JSON as page copy ({"copy":123}
      // once produced '"{\"copy\": 123}."' on a hero) is worse than no model.
      const unusable = ['{"copy":123}', '{"unexpected":true}', '[1,2,3]'];
      for (let i = 0; i < unusable.length; i++) {
        const answer = unusable[i];
        const r = await CopyOptimizer.optimizeCopyAsync(CLICHE, { voiceLock: 'warm', framework: 'PAS', complete: () => Promise.resolve(answer) });
        eq(r.engine, 'local', 'unusable JSON ' + answer + ' falls back to the local engine');
        ok(r.text.indexOf('{') === -1 && r.text.indexOf('[') === -1, 'and never ships the raw JSON as copy');
        ok(specHits(r.text).length === 0, 'and the fallback is still clean');
      }
      const usable = await CopyOptimizer.optimizeCopyAsync(CLICHE, { voiceLock: 'warm', framework: 'PAS', complete: () => Promise.resolve('{"copy":"A clean answer."}') });
      eq(usable.engine, 'model', 'usable JSON is still accepted');
      eq(usable.text, 'A clean answer.', 'and its copy is used');
      const prose = await CopyOptimizer.optimizeCopyAsync(CLICHE, { voiceLock: 'warm', framework: 'PAS', complete: () => Promise.resolve('Use {brackets} carefully, it says.') });
      eq(prose.engine, 'model', 'prose containing braces is still accepted as prose');
    })
    .catch((e) => ok(false, 'the model path threw: ' + (e && e.message)));
}

/* ============================================================
   8 — Task 4: the AST editor keeps markup and swaps words
   ============================================================ */
section('8. applyOptimizedCopySection: full-section rewrite');
const HTML = [
  '<!doctype html><html><body>',
  '<section id="hero" class="hero pa-grid" data-section="hero" data-track="hero-view">',
  '<div class="wrap hero__inner">',
  '<h1 class="hero-title" data-animate="fade">Old headline</h1>',
  '<p class="hero-sub sub" data-role="subheadline">Old sub</p>',
  '<p class="body">First paragraph.</p>',
  '<p class="body">Second paragraph.</p>',
  '<a class="btn primary" href="#book" data-copy="cta"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 2h20"/></svg>Book now</a>',
  '</div>',
  '</section>',
  '<section id="services" class="services pa-grid" data-section="services">',
  '<h2 class="services-title">What we do</h2>',
  '<p class="body">Roofs, gutters and repairs.</p>',
  '<a class="btn" href="#quote">Get a quote</a>',
  '</section>',
  '</body></html>'
].join('');
{
  const out = CopyAstEditor.applyOptimizedCopySection(HTML, 'hero', {
    headline: 'Roofs that hold',
    subheadline: 'Fitted in two days',
    body: ['We survey for free and quote in writing.', 'Fixed fees. No surprises on the invoice.'],
    cta: 'Book a free survey'
  });

  ok(out.ok === true, 'the section rewrite succeeds');
  eq(out.changed, true, 'the markup changed');
  eq(out.applied.length, 5, 'five elements were rewritten (h1, sub, 2 paragraphs, cta)');

  // --- the words changed ------------------------------------------------
  ok(out.html.indexOf('>Roofs that hold<') !== -1, 'the headline text was replaced');
  ok(out.html.indexOf('>Fitted in two days<') !== -1, 'the subheadline text was replaced');
  ok(out.html.indexOf('>We survey for free and quote in writing.<') !== -1, 'paragraph 1 was replaced');
  ok(out.html.indexOf('>Fixed fees. No surprises on the invoice.<') !== -1, 'paragraph 2 was replaced');
  ok(out.html.indexOf('</svg>Book a free survey<') !== -1, 'the CTA label was replaced and stayed after the icon');
  ok(out.html.indexOf('Old headline') === -1 && out.html.indexOf('First paragraph.') === -1, 'no old copy survived');

  // --- the markup did not ----------------------------------------------
  const MUST_KEEP = [
    '<section id="hero" class="hero pa-grid" data-section="hero" data-track="hero-view">',
    '<div class="wrap hero__inner">',
    '<h1 class="hero-title" data-animate="fade">',
    '<p class="hero-sub sub" data-role="subheadline">',
    '<p class="body">',
    '<a class="btn primary" href="#book" data-copy="cta">',
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 2h20"/></svg>',
    '</section>',
    '<!doctype html><html><body>'
  ];
  MUST_KEEP.forEach((fragment) => {
    ok(out.html.indexOf(fragment) !== -1, 'markup preserved: ' + fragment.slice(0, 52));
  });
  ok(out.html.indexOf('<svg') !== -1 && out.html.indexOf('<path d="M2 2h20"/>') !== -1, 'the SVG icon survived intact');
  eq((out.html.match(/<svg/g) || []).length, 1, 'exactly one icon, not a duplicated one');
  eq((out.html.match(/class="body"/g) || []).length, 3, 'every original class attribute count is unchanged');

  // --- nothing outside the section was touched --------------------------
  const servicesStart = HTML.indexOf('<section id="services"');
  eq(out.html.slice(out.html.indexOf('<section id="services"')), HTML.slice(servicesStart),
    'the neighbouring section is byte-identical');

  // --- idempotence -------------------------------------------------------
  const again = CopyAstEditor.applyOptimizedCopySection(out.html, 'hero', { headline: 'Roofs that hold' });
  eq(again.changed, false, 're-applying the same copy changes nothing');
  eq(again.html, out.html, '...and the string is identical');

  // --- order of paragraphs is honoured ---------------------------------
  const ordered = CopyAstEditor.applyOptimizedCopySection(HTML, 'hero', { body: ['One.', 'Two.'] });
  ok(ordered.html.indexOf('>One.<') < ordered.html.indexOf('>Two.<'), 'paragraphs are replaced in document order');

  // --- escaping, and the opt-in for markup ------------------------------
  const escaped = CopyAstEditor.applyOptimizedCopySection(HTML, 'hero', { headline: 'Save & protect <fast>' });
  ok(escaped.html.indexOf('Save &amp; protect &lt;fast&gt;') !== -1, 'copy is HTML-escaped by default');
  ok(escaped.html.indexOf('<fast>') === -1, 'no unescaped markup was injected');
  const trusted = CopyAstEditor.applyOptimizedCopySection(HTML, 'hero', { headline: 'Save <em>more</em>', allowHtml: true });
  ok(trusted.html.indexOf('Save <em>more</em>') !== -1, 'allowHtml inserts trusted markup as-is');
}

/* ============================================================
   9 — single-element targets
   ============================================================ */
section('9. single-element targets');
{
  const original = HTML;
  const out = CopyAstEditor.applyOptimizedCopySection(original, 'hero', {
    targets: [{ selector: '.hero-sub', text: 'Fitted in two days' }]
  });
  ok(out.ok === true && out.applied.length === 1, 'one target, one rewrite');
  eq(out.html.replace('>Fitted in two days<', '>Old sub<'), original,
    'BYTE-EQUAL apart from the target text — nothing else moved');
  eq(out.applied[0].before, 'Old sub', 'the previous text is reported');
  eq(out.applied[0].after, 'Fitted in two days', 'the new text is reported');

  const byId = CopyAstEditor.applyOptimizedCopySection(HTML, 'hero', { targets: [{ id: 'services', text: 'SHOULD NOT MATCH' }] });
  ok(byId.applied.length === 0 || byId.html.indexOf('SHOULD NOT MATCH') === -1,
    'an id outside the scope is not reachable from inside it');

  const byRole = CopyAstEditor.applyOptimizedCopySection(HTML, 'hero', { targets: [{ role: 'subheadline', text: 'By role' }] });
  ok(byRole.html.indexOf('>By role<') !== -1, 'a target can name a role (subheadline)');
  ok(byRole.html.indexOf('>Old headline<') !== -1, '...and leave the headline alone');

  const byTag = CopyAstEditor.applyOptimizedCopySection(HTML, 'services', { targets: [{ tag: 'h2', index: 0, text: 'Gutters, roofs, repairs' }] });
  ok(byTag.html.indexOf('>Gutters, roofs, repairs<') !== -1, 'a target can name a tag + index');
  ok(byTag.html.indexOf('>Old headline<') !== -1, 'a different section is untouched');

  const byMap = CopyAstEditor.applyOptimizedCopySection(HTML, 'hero', { elements: { '.hero-title': 'Mapped headline' } });
  ok(byMap.html.indexOf('>Mapped headline<') !== -1, 'the elements map targets a selector');

  // One leaf element named directly, with the payload as a bare string.
  const leaf = '<h2 id="sub-1" class="sub" data-animate="up">Old</h2>';
  const leafOut = CopyAstEditor.applyOptimizedCopySection(leaf, 'sub-1', 'New subheadline');
  ok(leafOut.ok === true && leafOut.applied.length === 1, 'a bare string rewrites the one element named');
  ok(leafOut.html.indexOf('<h2 id="sub-1" class="sub" data-animate="up">New subheadline</h2>') !== -1,
    'the leaf keeps every attribute', leafOut.html);

  // The subheadline is a <p> here, so a headline-only payload must not send
  // the body paragraphs anywhere near it.
  const onlySub = CopyAstEditor.applyOptimizedCopySection(HTML, 'hero', { subheadline: 'Just the sub' });
  eq(onlySub.applied.length, 1, 'only the subheadline was rewritten');
  eq(onlySub.applied[0].role, 'subheadline', 'and it says so');
  ok(onlySub.html.indexOf('>First paragraph.<') !== -1, 'the paragraphs are untouched');
}

/* ============================================================
   10 — layout independence: icons, formatting, attributes
   ============================================================ */
section('10. icons and inline formatting');
{
  const icons = '<section id="p"><a class="btn cta" href="#x"><svg class="i"><path d="M0 0"/></svg><span>Go</span></a></section>';
  const out = CopyAstEditor.applyOptimizedCopySection(icons, 'p', { cta: 'Start now' });
  ok(out.ok === true, 'a CTA wrapped in markup is rewritten');
  ok(out.html.indexOf('<svg class="i"><path d="M0 0"/></svg>') !== -1, 'the icon is preserved');
  ok(out.html.indexOf('<span>Go</span>') === -1, 'the old label markup is gone');
  ok(out.html.indexOf('>Start now<') !== -1, 'the new label is in place');
  ok(out.html.indexOf('href="#x"') !== -1, 'the href is untouched');

  const trailing = '<section id="p"><button class="btn" type="submit">Send<span class="icon">→</span></button></section>';
  const tOut = CopyAstEditor.applyOptimizedCopySection(trailing, 'p', { cta: 'Send it' });
  ok(tOut.html.indexOf('>Send it<span class="icon">→</span></button>') !== -1,
    'a trailing icon stays trailing and the label goes before it', tOut.html);
  ok(tOut.html.indexOf('type="submit"') !== -1, 'the button type is untouched');

  const formatted = '<section id="p"><p class="copy">We are <strong>fast</strong> and careful.</p></section>';
  const fOut = CopyAstEditor.applyOptimizedCopySection(formatted, 'p', { body: ['We are quick and careful.'] });
  ok(fOut.html.indexOf('>We are quick and careful.<') !== -1, 'stale inline formatting is replaced with the new copy');
  ok(fOut.html.indexOf('<strong>') === -1, 'the old <strong> went with the old words');

  // A .lead paragraph is the subheadline ONLY when a subheadline was asked for;
  // a body-only payload must still reach the first paragraph of a hero.
  const lead = '<section id="p"><p class="lead">We are <strong>fast</strong>.</p></section>';
  const leadOut = CopyAstEditor.applyOptimizedCopySection(lead, 'p', { body: ['We are quick.'] });
  ok(leadOut.html.indexOf('>We are quick.<') !== -1, 'a .lead paragraph is still body copy when only body is supplied', leadOut.html);
  const leadSub = CopyAstEditor.applyOptimizedCopySection(lead, 'p', { subheadline: 'Fast, and careful' });
  ok(leadSub.html.indexOf('>Fast, and careful<') !== -1, 'and it is the subheadline when one is supplied');

  const attrQuote = '<section id="p" data-x="a>b"><h1 class="t">Old</h1></section>';
  const qOut = CopyAstEditor.applyOptimizedCopySection(attrQuote, 'p', { headline: 'New' });
  ok(qOut.ok === true && qOut.html.indexOf('data-x="a&gt;b"') !== -1 || qOut.html.indexOf('data-x="a>b"') !== -1,
    'a ">" inside an attribute value does not break the parse', qOut.html);

  eq(CopyAstEditor.isIconNode(CopyAstEditor.parseHtml('<svg></svg>').elements[0]), true, 'isIconNode: svg');
  eq(CopyAstEditor.isIconNode(CopyAstEditor.parseHtml('<h1>x</h1>').elements[0]), false, 'isIconNode: heading');
  eq(CopyAstEditor.textOf(CopyAstEditor.parseHtml('<p>a <strong>b</strong> c</p>').elements[0]), 'a b c',
    'textOf flattens nested markup');
}

/* ============================================================
   11 — robustness
   ============================================================ */
section('11. malformed input and bad payloads');
{
  const missing = CopyAstEditor.applyOptimizedCopySection(HTML, 'no-such-section', { headline: 'x' });
  ok(missing.ok === false, 'an unknown section is a clean failure');
  ok(/not found/.test(missing.error || ''), 'and says so', missing.error);
  eq(missing.html, HTML, 'the original markup is handed back untouched');

  ok(CopyAstEditor.applyOptimizedCopySection('', 'hero', { headline: 'x' }).ok === false, 'empty HTML is rejected');
  ok(CopyAstEditor.applyOptimizedCopySection(HTML, 'hero', null).ok === false, 'a null payload is rejected');
  ok(CopyAstEditor.applyOptimizedCopySection(HTML, 'hero', {}).ok === false, 'an empty payload is rejected');
  ok(CopyAstEditor.applyOptimizedCopySection(HTML, 'hero', { unrelated: true }).ok === false, 'an unrecognised payload is rejected');
  ok(/no copy to apply/.test(CopyAstEditor.applyOptimizedCopySection(HTML, 'hero', {}).error || ''), 'with a useful error');

  const malformed = '<section id="x" class="a"><h1 class="t">Hi<div><p>unclosed';
  const mOut = CopyAstEditor.applyOptimizedCopySection(malformed, 'x', { headline: 'Still works' });
  ok(mOut.ok === true && mOut.html.indexOf('Still works') !== -1, 'unclosed tags do not break the rewrite', mOut.html);
  ok(mOut.html.indexOf('class="t"') !== -1, 'and the attributes survive');

  const noMatch = CopyAstEditor.applyOptimizedCopySection(HTML, 'services', { subheadline: 'nothing here' });
  ok(noMatch.ok === true && noMatch.skipped.length >= 1, 'a role the section does not have is skipped, not invented');
  eq(noMatch.changed, false, 'and nothing changes');

  const huge = CopyAstEditor.applyOptimizedCopySection(HTML, 'hero', { body: ['only one'] });
  eq(huge.applied.length, 1, 'one paragraph in the payload rewrites one paragraph');
  ok(huge.skipped.some((s) => /more paragraphs/.test(s.reason)), 'and the extras are reported as skipped');

  ok(CopyOptimizer.optimizeCopy('').ok === false, 'optimizeCopy rejects empty input');
  ok(CopyOptimizer.optimizeCopy(null).ok === false, 'optimizeCopy rejects null input');
}

/* ============================================================
   12 — the chain: optimize → apply → verify
   ============================================================ */
section('12. end to end: optimize the copy, write it into the section');
{
  const optimizedCopy = CopyOptimizer.optimizeCopy(CLICHE, { voiceLock: 'punchy', framework: 'PAS', niche: 'roofing' });
  const paragraphs = optimizedCopy.beats.map((b) => b.text);

  const chained = CopyAstEditor.applyOptimizedCopySection(HTML, 'hero', {
    headline: 'Roofs that hold',
    subheadline: CopyOptimizer.applyVoiceLock('Everything starts with a survey', 'punchy'),
    body: paragraphs,
    cta: 'Book a free survey'
  });

  ok(chained.ok === true, 'the optimized copy applies to the section');
  ok(specHits(chained.html).length === 0, 'the rendered markup contains zero banned vocabulary', specHits(chained.html).join(', '));
  ok(chained.html.indexOf('class="hero pa-grid"') !== -1, 'the section keeps its classes');
  ok(chained.html.indexOf('data-track="hero-view"') !== -1, 'and its tracking attributes');
  ok(chained.html.indexOf('<svg') !== -1, 'and its icon');
  // The section has two paragraphs and PAS produces three beats, so assert the
  // ones that were actually applied — the third is reported as skipped, not lost.
  const writtenBodies = chained.applied.filter((a) => a.role.indexOf('body:') === 0).map((a) => a.after);
  eq(writtenBodies.length, 2, 'both paragraphs took optimized copy');
  writtenBodies.forEach((body) => {
    ok(chained.html.indexOf(body) !== -1, 'beat text is present: ' + body.slice(0, 40));
  });
  ok(chained.skipped.some((s) => /no <p> to land in/.test(s.reason)), 'the beat that did not fit is reported, not dropped quietly');
  ok(chained.html.indexOf('Old headline') === -1, 'the old copy is gone from the rendered section');
}

/* ============================================================
   13 — regressions
   ------------------------------------------------------------
   Every assertion here is a bug this suite did NOT have when it
   first went green. They are pinned because each one was silent:
   a false clean bill of health, a file that changed when nothing
   was applied, a payload that vanished, a selector that matched
   nothing. A green run means they have not come back.
   ============================================================ */
function runRegressions() {
  section('13. regressions (bugs found by audit)');

  // BUG: findBannedTerms shared /g regexes, and .test() on a /g regex is
  // stateful — lastIndex advanced on a match, so the SECOND call on the same
  // text resumed past it and returned []. A false negative in the one function
  // whose entire job is refusing to let a banned word through.
  const repeats = [1, 2, 3, 4, 5].map(() => CopyOptimizer.findBannedTerms('unleash').length);
  ok(repeats.every((n) => n === 1), 'findBannedTerms is stable across repeated calls', repeats.join(','));
  const multi = [1, 2, 3].map(() => CopyOptimizer.findBannedTerms('the realm and the beacons').sort().join('/'));
  eq(new Set(multi).size, 1, 'and stable for multi-term input (' + multi.join(' | ') + ')');
  ok(CopyOptimizer.findBannedTerms('unleash').length === 1
    && CopyOptimizer.findBannedTerms('honest, specific copy').length === 0
    && CopyOptimizer.findBannedTerms('unleash').length === 1,
    'a clean miss in between cannot reset the guard into a false pass');

  // The same shared-regex trap reached scrubAIVocabulary through its sweep
  // for terms that survived the replacement table.
  const scrubRepeats = [1, 2, 3].map(() => CopyOptimizer.scrubAIVocabulary('beacon').flagged.length);
  ok(scrubRepeats.every((n) => n === 1), 'scrubAIVocabulary flags on every call', scrubRepeats.join(','));
  ok(CopyOptimizer.scrubAIVocabulary('beacon and a realm').clean === true, 'and still strips everything it flags');
  ok(CopyOptimizer.optimizeCopy(CLICHE, { voiceLock: 'punchy' }).clean === true, 'optimizeCopy reports clean on repeat calls too');

  // BUG: an orphan closing tag was dropped by the parser, so the round-trip was
  // lossy — an apply that changed nothing still reported changed:true and
  // silently deleted the tag from the client's markup.
  const stray = '<section id="s"><p class="a">Hi</p></div><span class="b">X</span></section>';
  const strayOut = CopyAstEditor.applyOptimizedCopySection(stray, 's', { headline: 'x' });
  eq(strayOut.ok, true, 'malformed markup still accepts an apply');
  eq(strayOut.html, stray, 'an orphan closing tag survives the round-trip byte-for-byte');
  eq(strayOut.changed, false, 'and an apply that changes nothing reports no change');
  const wellFormed = '<section id="s"><p>Hi</p></section>';
  const wfOut = CopyAstEditor.applyOptimizedCopySection(wellFormed, 's', { headline: 'x' });
  eq(wfOut.html, wellFormed, 'well-formed markup round-trips byte-for-byte with no heading to fill');
  eq(wfOut.changed, false, 'and reports no change');
  const unclosed = '<section id="u"><div><p>text';
  eq(CopyAstEditor.applyOptimizedCopySection(unclosed, 'u', { body: [] }).html, unclosed, 'unclosed markup round-trips too');

  // BUG: `text` was silently dropped whenever the payload ALSO carried a target
  // or an elements entry — the caller believed the element had been rewritten.
  const leaf = '<h2 id="t" class="x">Old</h2>';
  const both = CopyAstEditor.applyOptimizedCopySection(leaf, 't', { text: 'FromText', targets: [{ selector: 'h2', text: 'FromTarget' }] });
  eq(both.applied.length, 2, 'text AND an explicit target are both applied');
  eq(both.applied[0].role, 'text', 'text is applied first...');
  eq(both.applied[1].role, 'target:h2', '...so the more specific target can override it');
  ok(both.html.indexOf('FromTarget') !== -1, 'and the target wins in the markup');
  const mapAndText = CopyAstEditor.applyOptimizedCopySection(leaf, 't', { text: 'Ignored?', elements: { 'h2.x': 'FromMap' } });
  eq(mapAndText.applied.length, 2, 'the same holds for the elements map');
  ok(mapAndText.html.indexOf('FromMap') !== -1, 'and the map wins');

  // BUG: a '.' inside an attribute value was read as a class name, so the
  // selector matched nothing at all.
  const dotted = CopyAstEditor.parseSelector('[data-section="hero.1"]');
  eq(dotted[0].steps[0].classes.length, 0, 'a dot inside an attribute value is not a class');
  eq(dotted[0].steps[0].attrs[0].value, 'hero.1', 'the attribute value is kept intact');
  eq(CopyAstEditor.applyOptimizedCopySection('<section data-section="hero.1"><h1>H</h1></section>', '[data-section="hero.1"]', { headline: 'N' }).ok, true,
    'and the selector matches the section it names');

  // BUG: descendant selectors were flattened into one compound, so "div .t"
  // matched every .t in scope instead of only the one inside a div.
  const nested = '<section id="s"><h1 class="t">Outside</h1><div class="wrap"><h1 class="t">Inside</h1></div></section>';
  const scoped = CopyAstEditor.applyOptimizedCopySection(nested, 's', { targets: [{ selector: 'div .t', text: 'Scoped' }] });
  eq(scoped.applied.length, 1, 'a descendant selector matches one element, not every match in scope');
  ok(scoped.html.indexOf('>Outside<') !== -1, 'the element outside the descendant chain is untouched');
  ok(scoped.html.indexOf('>Scoped<') !== -1, 'and the one inside it is rewritten');
  eq(CopyAstEditor.applyOptimizedCopySection(nested, 's', { targets: [{ selector: 'section > span', text: 'x' }] }).applied.length, 0,
    'a descendant chain that matches nothing applies nothing');

  // Attribute operators were only ever exercised as a bare presence check.
  const attrHtml = '<section id="s"><a class="btn" href="#book" data-copy="cta">Go</a><a class="plain" href="https://x.test">Out</a></section>';
  const byAttr = CopyAstEditor.applyOptimizedCopySection(attrHtml, 's', { elements: { '[data-copy="cta"]': 'Book now' } });
  eq(byAttr.applied.length, 1, 'an attribute-equality selector matches exactly the intended element');
  ok(byAttr.html.indexOf('>Book now<') !== -1 && byAttr.html.indexOf('>Out<') !== -1, 'and leaves its sibling alone');
}

/* ============================================================
   14 — the seed bank
   ------------------------------------------------------------
   data/seed-bank.json is what replaces Lorem Ipsum, so it is
   held to the same standard as generated copy: the required
   terms are checked against a list written out HERE, and every
   string is graded by the optimizer's own vocabulary rules.
   ============================================================ */
function runSeedBank() {
  section('14. seed bank (data/seed-bank.json)');
  const file = path.join(__dirname, '..', 'data', 'seed-bank.json');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { ok(false, 'seed-bank.json is readable: ' + e.message); return; }
  let bank;
  try { bank = JSON.parse(raw); } catch (e) { ok(false, 'seed-bank.json parses as JSON: ' + e.message); return; }
  ok(bank && typeof bank === 'object', 'seed-bank.json is a JSON object');

  const words = (s) => String(s).split(/\s+/).filter(Boolean).length;
  const sentences = (s) => String(s).split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const str = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['\u2019]").replace(/-/g, '[-\\s]?').replace(/\s+/g, '\\s+');
  const specScan = (text) => SPEC_BANNED.filter((t) => new RegExp(/^[a-z]+$/i.test(t) ? '\\b' + str(t) + '(s|es|ed|ing)?\\b' : str(t), 'i').test(String(text)));

  const niches = ['roofing', 'corporateLaw', 'landscaping'];
  const required = ['heroHeadline', 'heroSubhead', 'primaryCTA', 'secondaryCTA', 'valueProps', 'aboutUs', 'socialProof'];
  const everyString = [];

  niches.forEach((name) => {
    const n = bank[name];
    ok(!!n && typeof n === 'object', 'niche "' + name + '" exists');
    if (!n) return;
    required.forEach((k) => ok(n[k] != null, name + '.' + k + ' is present'));
    const headlineWords = words(n.heroHeadline);
    ok(headlineWords >= 5 && headlineWords <= 8, name + '.heroHeadline is 5-8 words (' + headlineWords + ')');
    ok(words(n.primaryCTA) <= 3, name + '.primaryCTA is at most 3 words (' + words(n.primaryCTA) + ')');
    ok(sentences(n.heroSubhead).length === 2, name + '.heroSubhead is a 2-sentence PAS (' + sentences(n.heroSubhead).length + ')');
    ok(sentences(n.aboutUs).length === 3, name + '.aboutUs is a 3-sentence BAB paragraph (' + sentences(n.aboutUs).length + ')');
    eq(n.valueProps.length, 3, name + '.valueProps has exactly 3 pairs');
    n.valueProps.forEach((v, i) => ok(!!v && !!v.title && !!v.text, name + '.valueProps[' + i + '] has a title and a sentence'));
    ok(!!n.socialProof && !!n.socialProof.quote && !!n.socialProof.detail, name + '.socialProof is template-ready');
    ok(/^\[[^\]]+\]$/.test(String(n.socialProof.name || '')), name + '.socialProof.name is a placeholder (' + n.socialProof.name + ')');
    required.forEach((k) => everyString.push([name + '.' + k, n[k]]));
    n.valueProps.forEach((v, i) => everyString.push([name + '.valueProps[' + i + ']', v.title + ' ' + v.text]));
    everyString.push([name + '.socialProof', n.socialProof.quote + ' ' + n.socialProof.name + ' ' + n.socialProof.detail]);
  });

  const flat = everyString.map(([k, v]) => [k, Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(' ') : (typeof v === 'string' ? v : Object.values(v).filter((x) => typeof x === 'string').join(' '))]);
  const banned = flat.filter(([, t]) => specScan(t).length || CopyOptimizer.findBannedTerms(t).length);
  eq(banned.length, 0, 'every seed string is free of banned vocabulary', banned.map(([k, t]) => k + ':' + specScan(t).join(',')).join(' | '));
  const tells = flat.filter(([, t]) => CopyOptimizer.deJargon(t).hits.length);
  eq(tells.length, 0, 'and free of the softer AI-tell phrases', tells.map(([k, t]) => k + ':' + CopyOptimizer.deJargon(t).hits.map((h) => h.term).join(',')).join(' | '));
  const shouts = flat.filter(([, t]) => /!/.test(t));
  eq(shouts.length, 0, 'and shout nothing in capitals-with-exclamation style');
  const scrubbed = flat.filter(([, t]) => { const r = CopyOptimizer.scrubAIVocabulary(t); return r.flagged.length || r.replaced.length; });
  eq(scrubbed.length, 0, 'and the scrubber has nothing to flag or replace in any of it', scrubbed.map(([k]) => k).join(', '));
  // The scrubber returns finished sentences, so it legitimately adds a full stop
  // to a label like "Book a survey". What it must never do is change a WORD.
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s\[\]'-]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
  const reworded = flat.filter(([, t]) => norm(CopyOptimizer.scrubAIVocabulary(t).text) !== norm(t));
  eq(reworded.length, 0, 'and changes none of its words — only missing sentence punctuation', reworded.map(([k]) => k).join(', '));
  console.log('  (' + flat.length + ' seed strings checked across ' + niches.length + ' niches)');
}

/* ============================================================
   summary
   ------------------------------------------------------------
   Waits for the async sections. Printing this synchronously let a
   failing async assertion land after "ALL GREEN" and still exit 0 —
   a test suite that cannot fail is worse than no test suite.
   ============================================================ */
function finish() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('backend-copy smoke: ALL GREEN');
}

Promise.resolve(asyncWork)
  .then(() => { runRegressions(); runSeedBank(); })
  .then(finish)
  .catch((e) => {
    ok(false, 'the suite threw outside an assertion: ' + ((e && e.message) || e));
    finish();
  });
