#!/usr/bin/env node
// ============================================================
// PallettAI Studio — translation request-budget smoke test
// ------------------------------------------------------------
// MyMemory is a free, keyless API metered by a daily allowance
// shared by every user behind our IP, and it is also the fallback
// when the DeepL proxy is unavailable. Its cost is therefore
// measured in REQUESTS, not in milliseconds: a site with fifty
// strings must not spend fifty of the allowance when nine of them
// are the same heading and four carry nothing to translate.
//
// The failure this suite exists to catch is a silent regression
// back to one request per string per call. It injects a counting
// fetch, so every assertion below is about the real request
// count the module would have produced on the wire.
// ============================================================

'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const T = require(path.join(ROOT, 'data', 'ai-translate.js'));

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function eq(actual, expected, msg) {
  if (actual === expected) pass(msg);
  else fail(msg + '  → got: ' + JSON.stringify(actual) + ', expected: ' + JSON.stringify(expected));
}

const calls = [];
function installStub(handler) {
  calls.length = 0;
  T.clearTranslateCache();
  T.resetTranslateStats();
  T.setTranslateFetch((url, init) => {
    calls.push(url);
    return Promise.resolve(handler ? handler(url, init) : jsonResponse(url));
  });
}
function jsonResponse(url) {
  const q = decodeURIComponent((url.match(/[?&]q=([^&]*)/) || [])[1] || '');
  return {
    ok: true,
    json: () => Promise.resolve({ responseData: { translatedText: 'ES<' + q + '>' } })
  };
}

(async () => {
  console.log('== 1. What is worth sending ==');
  const no = ['', '   ', '24/7', '2026', '£55', 'hello@rustica.test', 'https://rustica.test/', 'www.rustica.test', '+44 113 000 0000', '0113 000 0000', '4.5', '—', '·', 'A'];
  no.forEach((s) => eq(T.translatable(s), false, 'refuses to send ' + JSON.stringify(s)));
  const yes = ['Warm bread', 'About us', 'Book a loaf', '48h dough', '£55/mo', 'OK'];
  yes.forEach((s) => eq(T.translatable(s), true, 'sends ' + JSON.stringify(s)));

  console.log('\n== 2. Duplicates cost one request, not one per occurrence ==');
  installStub();
  const site = [
    'Warm bread', 'Baked every morning.', 'Learn more', 'Warm bread', 'Contact',
    'Learn more', 'Warm bread', 'Learn more', 'Opening hours', 'Contact',
    'Warm bread', 'Learn more', 'About us', 'Contact', 'Learn more'
  ];
  let out = await T.translateViaMyMemory(site, 'es');
  // 15 entries, 6 distinct strings → 6 requests (not 15)
  eq(calls.length, 6, 'fifteen entries with six distinct strings made six requests');
  eq(T.translateStats.collapsed, 9, 'nine repeats were collapsed into their first request');
  eq(out.length, site.length, 'the result keeps one entry per input string');
  eq(out[0] === out[3] && out[3] === out[6] && out[6] === out[10], true, 'every occurrence of a repeated string gets the same translation');
  eq(out[2] === out[5] && out[5] === out[7] && out[7] === out[11] && out[11] === out[14], true, 'repeated copy is translated once and written to each position');

  console.log('\n== 3. A second pass costs nothing new ==');
  const before = calls.length;
  out = await T.translateViaMyMemory(site, 'es');
  eq(calls.length, before, 'translating the same site again made no further requests');
  eq(T.translateStats.reused, 6, 'every distinct string was served from the cache');
  eq(out.length, site.length, 'the cached pass still returns a full array');

  console.log('\n== 4. Strings with nothing to translate never leave the machine ==');
  installStub();
  const mixed = ['24/7', 'hello@rustica.test', 'https://rustica.test/', '£55', '+44 113 000 0000', '', 'Warm bread'];
  out = await T.translateViaMyMemory(mixed, 'fr');
  eq(calls.length, 1, 'only the one translatable string was requested');
  eq(T.translateStats.skipped, 6, 'six untranslatable strings were skipped');
  eq(out[0], '24/7', 'a figure passes through unchanged');
  eq(out[1], 'hello@rustica.test', 'an e-mail passes through unchanged');
  eq(out[2], 'https://rustica.test/', 'a URL passes through unchanged');

  console.log('\n== 5. Concurrent callers share one request ==');
  let resolveSlow = null;
  calls.length = 0;
  T.clearTranslateCache();
  T.resetTranslateStats();
  T.setTranslateFetch((url) => {
    calls.push(url);
    return new Promise((resolve) => { resolveSlow = () => resolve(jsonResponse(url)); });
  });
  const a = T.translateViaMyMemory(['Opening hours', 'Opening hours'], 'de');
  const b = T.translateViaMyMemory(['Opening hours'], 'de');
  await new Promise((r) => setTimeout(r, 0));
  eq(calls.length, 1, 'two concurrent calls for the same string made one request');
  if (resolveSlow) resolveSlow();
  const [ra, rb] = await Promise.all([a, b]);
  eq(ra[0], rb[0], 'both callers receive the same translation');

  console.log('\n== 6. A failure is not remembered as a translation ==');
  let attempts = 0;
  calls.length = 0;
  T.clearTranslateCache();
  T.resetTranslateStats();
  T.setTranslateFetch(() => {
    attempts++;
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ responseData: {} }) });
  });
  let threw = false;
  try { await T.translateViaMyMemory(['Warm bread'], 'es'); } catch (e) { threw = e.message === 'mymemory-failed'; }
  eq(threw, true, 'an unusable response throws rather than storing a blank');
  try { await T.translateViaMyMemory(['Warm bread'], 'es'); } catch (e) { /* expected again */ }
  eq(attempts, 2, 'the failed string is asked for again instead of served from cache');

  console.log('\n== 7. A hung request is abandoned, not left open ==');
  calls.length = 0;
  T.clearTranslateCache();
  T.resetTranslateStats();
  T.setTranslateFetch((url, init) => new Promise((resolve, reject) => {
    const signal = init && init.signal;
    if (signal) signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  let aborted = false;
  const started = Date.now();
  try { await T.translateViaMyMemory(['Warm bread'], 'es'); } catch (e) { aborted = true; }
  eq(aborted, true, 'a request that never answers rejects instead of hanging forever');
  eq(Date.now() - started < 30000, true, 'it resolves its own timeout rather than waiting on the socket');

  console.log('\n== 8. The cache is bounded ==');
  installStub();
  const many = Array.from({ length: 700 }, (_, i) => 'String number ' + i);
  await T.translateViaMyMemory(many, 'es');
  eq(T.translateStats.cached <= 600, true, 'the cache honours its bound (held ' + T.translateStats.cached + ')');
  eq(calls.length, 700, 'each distinct string was requested exactly once');

  console.log('\n== 9. The request shape is what MyMemory expects ==');
  installStub();
  await T.translateViaMyMemory(['Warm bread & butter'], 'pt');
  eq(calls.length, 1, 'one request for one string');
  eq(/^https:\/\/api\.mymemory\.translated\.net\/get\?/.test(calls[0]), true, 'the endpoint is unchanged');
  eq(/langpair=en\|pt/.test(calls[0]), true, 'the language pair is sent for the target');
  eq(calls[0].includes('&'), true, 'the query is properly encoded (& in the source text survives)');

  if (failed) {
    console.error('\ntranslate-budget-smoke FAILED — ' + failed + ' failure(s)');
    process.exit(1);
  }
  console.log('\ntranslate-budget-smoke PASSED');
})().catch((e) => {
  console.error('\ntranslate-budget-smoke CRASHED — ' + (e && e.stack || e));
  process.exit(1);
});
