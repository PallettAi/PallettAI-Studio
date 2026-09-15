#!/usr/bin/env node
'use strict';

/*
  copy-smoke — the tests for "text → site" wording.

  These exist because the first generation wrote every section header from
  per-business-type constants, so the failure mode was never a crash: it was
  two different clients being handed word-for-word identical websites. The
  assertions below are therefore about sameness and honesty, not exceptions.
*/

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  \u2713 ' + msg); }
function fail(msg) { failed++; console.error('  \u2717 ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

let Copy;
try {
  Copy = require(path.join(ROOT, 'data', 'copy.js'));
} catch (e) {
  console.error('copy-smoke FAILED — module missing: ' + e.message);
  process.exit(1);
}

const { loadAI } = require(path.join(ROOT, 'scripts', 'load-ai.js'));
const AI = loadAI();

const headersOf = (project) => {
  const out = [];
  (project.site.sections || []).forEach((s) => {
    if (s.title) out.push(String(s.title));
    if (s.subtitle) out.push(String(s.subtitle));
  });
  return out;
};

(async function main() {
  console.log('== The engine is reachable through the app\u2019s own loading path ==');
  assert(typeof Copy.build === 'function', 'copy engine exposes build()');
  assert(typeof Copy.registerFor === 'function', 'copy engine exposes registerFor()');
  assert(Copy.registerFor('home', '') === 'trade', 'trades resolve to the trade register');
  assert(Copy.registerFor('food', '') === 'table', 'food resolves to the table register');
  assert(Copy.registerFor('tech', '') === 'product', 'software resolves to the product register');

  // ---------------------------------------------------------------- variety
  console.log('\n== Two clients in the same industry no longer get the same site ==');
  // fixed seeds, so this is deterministic rather than occasionally flaky
  const p1 = AI.generateSite('family bakery in Sheffield', { onePager: true, seed: 4021 });
  const p2 = AI.generateSite('family bakery in Sheffield', { onePager: true, seed: 9137 });
  const h1 = headersOf(p1).join(' | ');
  const h2 = headersOf(p2).join(' | ');
  assert(h1 !== h2, 'same brief, different seed \u2192 different wording');

  const s1 = AI.generateSite('software platform for warehouses', { onePager: true, seed: 77 });
  const s2 = AI.generateSite('software platform for warehouses', { onePager: true, seed: 5150 });
  assert(headersOf(s1).join(' | ') !== headersOf(s2).join(' | '),
    'two software products get different section headers');

  // ------------------------------------------------- the old leak, pinned
  console.log('\n== The trades copy no longer leaks onto other industries ==');
  const soft = JSON.stringify(s1);
  assert(!soft.includes('Quoted before we start'), 'no "Quoted before we start" on a software site');
  assert(!soft.includes('We answer the phone'), 'no "We answer the phone" on a software site');
  const bakery = JSON.stringify(p1);
  assert(!bakery.includes('We answer the phone'), 'no trades bullet on a bakery site');

  // -------------------------------------------------------- client's words
  console.log('\n== The client\u2019s own facts drive the copy ==');
  const proof = '5-year guarantee \u2014 parts and labour, in writing';
  const briefed = AI.generateSite('emergency plumber in Leeds', {
    onePager: true,
    seed: 31,
    brief: {
      name: 'Ridgeline Plumbing',
      area: 'Leeds',
      offer: 'Same-day callouts across Leeds',
      proofs: [proof, 'Over 300 five-star reviews', 'Family run since 1998'],
      voice: 'warm'
    }
  });
  const feats = (briefed.site.sections || []).find((s) => s.type === 'features');
  assert(!!feats, 'the briefed site has a features section');
  if (feats) {
    const first = (feats.items || [])[0] || {};
    assert(first.text === proof, 'the client\u2019s proof is reproduced verbatim');
    assert(/5-year guarantee/i.test(String(first.title)),
      'the proof supplies the item TITLE too, not just the body');
    assert(!/^Quoted/.test(String(feats.subtitle || '')),
      'the section header is not a stock line when proofs exist');
  }
  const hero = (briefed.site.sections || []).find((s) => s.type === 'hero') || {};
  assert(String(hero.subtitle || '').includes('Same-day callouts'),
    'the client\u2019s offer becomes the hero tagline');

  // the area must be named once, not twice, in the about bullets
  const aboutSec = (briefed.site.sections || []).find((s) => s.type === 'about');
  if (aboutSec) {
    const hits = (aboutSec.items || []).filter((it) => String(it.title || '').includes('Leeds')).length;
    assert(hits === 1, 'the area is named exactly once in the bullets (found ' + hits + ')');
    assert(new Set((aboutSec.items || []).map((it) => String(it.title))).size === (aboutSec.items || []).length,
      'no duplicated about bullet');
  }

  // ------------------------------------------------------------- integrity
  console.log('\n== Nothing half-finished reaches the page ==');
  const noArea = JSON.stringify(AI.generateSite('family bakery in Sheffield', { onePager: true, seed: 4021 }));
  ['{brand}', '{focus}', '{area}'].forEach((tok) => {
    assert(!noArea.includes(tok), 'no raw ' + tok + ' token in the output');
  });
  const withArea = JSON.stringify(AI.generateSite('emergency plumber in Leeds', { onePager: true, seed: 31 }));
  assert(!withArea.includes('{area}'), 'no raw {area} token when the area is known');

  const hs = headersOf(p1).map((x) => x.toLowerCase());
  assert(new Set(hs).size === hs.length, 'no repeated heading within one site');

  // ---------------------------------------------------------------- enhance
  console.log('\n== "Enhance" actually changes the copy ==');
  const proj = AI.generateSite('emergency plumber in Leeds', { onePager: true, seed: 31 });
  const pf = (proj.site.sections || []).find((s) => s.type === 'features');
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    await AI.enhanceSection(pf, '', proj, false); // false = stay offline in tests
    seen.add(String(pf.title || '') + '::' + String(pf.subtitle || ''));
  }
  assert(seen.size >= 2, 'repeated Enhance presses produce different wording (' + seen.size + ' variants)');
  assert(![...seen].some((x) => x.includes('{')), 'enhanced copy has no unsubstituted tokens');

  // ------------------------------------------------------------- multi-page
  console.log('\n== A multi-page site does not repeat itself ==');
  const mp = AI.generateSite('emergency plumber in Leeds', {
    onePager: false,
    seed: 31,
    brief: {
      name: 'Ridgeline Plumbing', area: 'Leeds',
      offer: 'Same-day callouts across Leeds',
      proofs: ['5-year guarantee \u2014 parts and labour, in writing', 'Over 300 five-star reviews', 'Family run since 1998'],
      voice: 'warm'
    }
  });
  const pages = mp.site.pages || [];
  assert(pages.length >= 2, 'a filled multi-page brief produces several pages (' + pages.length + ')');

  const linesOf = (sections) => {
    const out = new Set();
    const take = (x) => {
      const k = String(x == null ? '' : x).trim().toLowerCase();
      if (k.length > 3) out.add(k);
    };
    (sections || []).forEach((s) => {
      take(s.title); take(s.subtitle); take(s.text);
      (s.items || []).forEach((it) => { take(it.title); take(it.text); });
    });
    return out;
  };

  let sharedLines = 0;
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const a = linesOf(pages[i].sections);
      const b = linesOf(pages[j].sections);
      [...a].forEach((x) => { if (b.has(x)) sharedLines++; });
    }
  }
  assert(sharedLines === 0, 'no line is printed on two different pages (found ' + sharedLines + ')');

  const noHero = pages.filter((pg) => !(pg.sections || []).some((s) => s && s.type === 'hero')).map((pg) => pg.name);
  assert(noHero.length === 0, 'every page opens with a hero' + (noHero.length ? ' \u2014 missing on ' + noHero.join(', ') : ''));

  const mpq = AI.qualityGate(mp, {});
  assert(mpq.errors === 0, 'the generated multi-page site has no quality errors');
  assert(mpq.score >= 80, 'the generated multi-page site grades B or better (scored ' + mpq.score + ')');
  assert(!(mpq.issues || []).some((f) => f.id.indexOf('page-repeated-heading') === 0),
    'the quality gate finds no repeated heading across pages');

  // ------------------------------------------------------------------ tone
  console.log('\n== Tone is a real transform, not a truncation ==');
  const punchy = Copy.applyTone('We really think that you should perhaps get in touch, and we will help in order to solve it.', 'punchy');
  assert(punchy.split(/\s+/).length <= 15, 'punchy shortens the sentence');
  assert(!/perhaps|really|in order to/i.test(punchy), 'punchy strips hedging and filler');
  const premium = Copy.applyTone("This is great! We don't cut corners", 'premium');
  assert(!premium.includes('!'), 'premium removes exclamation marks');
  assert(/do not/.test(premium), 'premium removes contractions');

  console.log('\n' + (failed === 0 ? 'copy-smoke PASSED' : 'copy-smoke FAILED: ' + failed));
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('copy-smoke FAILED \u2014 ' + (e && e.stack || e));
  process.exit(1);
});
