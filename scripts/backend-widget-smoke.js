#!/usr/bin/env node
// ============================================================
// PallettAI Studio — Dynamic Widget Engine smoke
// ------------------------------------------------------------
// The engine turns a plain-English request into a zero-dependency
// web component and injects it into a static export. Both halves
// fail in ways that are invisible in Node and fatal on a client's
// live site, so this suite is deliberately heavy:
//
//   * the ENGINE (modules/widget-generator.js) is run against a
//     mocked "Counter" widget and its output is PARSED, not just
//     pattern-matched — a runtime that does not parse is a page
//     that throws before anything renders.
//   * the TRANSPORT (modules/widget-injector.js) is run against a
//     dummy document and the placeholder is checked to survive.
//
//   node scripts/backend-widget-smoke.js
// ============================================================
'use strict';

const Generator = require('../modules/widget-generator.js');
const Injector = require('../modules/widget-injector.js');

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(label);
  console.error('  x ' + label);
}
function eq(a, b, label) {
  ok(a === b, label + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}
function contains(haystack, needle, label) {
  ok(String(haystack).indexOf(needle) !== -1, label + ' (missing ' + JSON.stringify(needle).slice(0, 80) + ')');
}
function countOf(haystack, needle) {
  return String(haystack).split(needle).length - 1;
}
function section(name) { console.log('\n== ' + name + ' =='); }

// Parsing validates syntax without executing browser code. This is the
// check that matters: the runtime becomes a real <script> in an export.
function parses(source) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(source);
    return true;
  } catch (e) {
    return false;
  }
}

/* ============================================================
   Fixtures — a Counter widget and a dummy host page
   ============================================================ */

const COUNTER = {
  id: 'counter',
  title: 'Counter',
  html: [
    '<div class="counter" role="group" aria-label="Click counter">',
    '  <p class="counter-value" aria-live="polite"><span data-count>0</span> clicks</p>',
    '  <button class="counter-btn" type="button" data-inc>Add one</button>',
    '</div>'
  ].join('\n'),
  css: [
    '.counter{display:grid;gap:.75rem;padding:1rem;border:1px solid var(--color-border,rgba(127,127,127,.3));border-radius:var(--color-radius,12px);background:var(--color-surface,rgba(127,127,127,.06))}',
    '.counter-value{margin:0;font-size:1rem;color:var(--color-text,inherit)}',
    '.counter-btn{padding:.6rem .9rem;border:0;border-radius:calc(var(--color-radius,12px) * .6);background:var(--color-primary,#5b8cff);color:var(--color-on-primary,#fff);font:inherit;font-weight:600;cursor:pointer}',
    '.counter-btn:focus-visible{outline:2px solid var(--color-primary,#5b8cff);outline-offset:2px}'
  ].join('\n'),
  js: [
    "var out = root.querySelector('[data-count]');",
    "var btn = root.querySelector('[data-inc]');",
    'var n = 0;',
    "btn.addEventListener('click', function () { n += 1; out.textContent = String(n); });"
  ].join('\n')
};

const SKELETON = [
  '<!doctype html>',
  '<html lang="en">',
  '<head><meta charset="utf-8"><title>Widget host</title></head>',
  '<body>',
  '  <main>',
  '    <h1>Get a quote</h1>',
  '    <pallet-widget id="roofing-calc"></pallet-widget>',
  '  </main>',
  '</body>',
  '</html>'
].join('\n');

function mockComplete(payload) {
  return async () => (typeof payload === 'string' ? payload : JSON.stringify(payload));
}

/* ============================================================
   1 — the instruction contract
   ============================================================ */
section('system prompt contract');

{
  const prompt = Generator.buildSystemPrompt({ seed: { l: 0.62, c: 0.16, h: 262 } });
  contains(prompt, 'Vanilla only', 'the prompt forbids frameworks');
  contains(prompt, 'No React, Vue, Angular', 'React/Vue are named as forbidden');
  contains(prompt, 'Shadow DOM', 'the prompt explains the Shadow DOM contract');
  contains(prompt, '--color-primary', 'the prompt hands over the --color-* tokens');
  contains(prompt, 'prefers-reduced-motion', 'motion safety is required up front');
  contains(prompt, 'aria-live', 'accessibility is required up front');
  contains(prompt, 'return exactly one JSON object', 'the output format is unambiguous');
  ok(prompt.indexOf('oklch(') !== -1, 'a GLM seed is expanded into concrete token values in the prompt');
}

/* ============================================================
   2 — design tokens (GLM OKLCH -> --color-*)
   ============================================================ */
section('design tokens');

{
  const fallback = Generator.resolveColorTokens(null);
  eq(fallback.vars['--color-primary'], '#5b8cff', 'no tokens still yields a usable primary');
  ok(fallback.decls.indexOf('--color-primary:') !== -1, 'declarations are a CSS-ready string');
  ok(fallback.decls.indexOf('--color-radius:') !== -1, 'radius is part of the token contract');

  const seeded = Generator.resolveColorTokens({ seed: { l: 0.62, c: 0.16, h: 262 }, radius: 18 });
  contains(seeded.vars['--color-primary'], 'oklch(', 'a GLM seed derives an OKLCH primary');
  eq(seeded.vars['--color-radius'], '18px', 'radius travels through');
  const seededAgain = Generator.resolveColorTokens({ seed: { l: 0.62, c: 0.16, h: 262 }, radius: 18 });
  eq(JSON.stringify(seeded.vars), JSON.stringify(seededAgain.vars), 'token derivation is deterministic');

  const canonical = Generator.resolveColorTokens({ colors: { primary: '#ff0000', ink: '#101010', card: '#ffffff' } });
  eq(canonical.vars['--color-primary'], '#ff0000', 'canonical tokenMap primary maps to --color-primary');
  eq(canonical.vars['--color-text'], '#101010', 'the "ink" alias maps to --color-text');
  eq(canonical.vars['--color-surface'], '#ffffff', 'the "card" alias maps to --color-surface');

  const derived = Generator.resolveColorTokens({ css: { '--pai-bg': '#0b0b0f', '--pai-accent': '#123456' } });
  eq(derived.vars['--color-background'], '#0b0b0f', 'the derived --pai-* map is understood');
  eq(derived.vars['--color-primary'], '#123456', '--pai-accent becomes --color-primary');

  const unsafe = Generator.resolveColorTokens({ colors: { primary: 'red;}body{display:none' } });
  eq(unsafe.vars['--color-primary'], '#5b8cff', 'a CSS-structural token value is refused, not emitted');
  ok(unsafe.warnings.length > 0, 'and the refusal is reported');
}

/* ============================================================
   3 — parsing what the model actually returns
   ============================================================ */
section('parsing model output');

{
  const json = Generator.parseModelOutput(JSON.stringify(COUNTER));
  ok(json.ok, 'a JSON envelope parses');
  eq(json.code.html, COUNTER.html, 'html survives the envelope');
  eq(json.code.js, COUNTER.js, 'js survives the envelope');
  eq(json.meta.title, 'Counter', 'the title is carried out of the envelope');

  const fenced = Generator.parseModelOutput([
    'Here you go:',
    '```html',
    '<div class="x">hi</div>',
    '```',
    '```css',
    '.x{color:red}',
    '```',
    '```js',
    'var a = 1;',
    '```'
  ].join('\n'));
  ok(fenced.ok, 'fenced code blocks parse');
  contains(fenced.code.html, 'class="x"', 'the html fence is used');
  eq(fenced.code.js.trim(), 'var a = 1;', 'the js fence is used');

  const wholeFence = Generator.parseModelOutput('```json\n' + JSON.stringify(COUNTER) + '\n```');
  ok(wholeFence.ok && wholeFence.code.html === COUNTER.html, 'a fence around the whole JSON payload parses');

  const bare = Generator.parseModelOutput('<section class="hero"><h2>Hello</h2></section>');
  ok(bare.ok, 'unfenced markup is still accepted');
  eq(bare.code.js, '', 'with no behaviour claimed');
  ok(bare.warnings.length > 0, 'and a warning saying so');

  const garbage = Generator.parseModelOutput('I am not sure what you want.');
  ok(garbage.ok === false, 'plain prose is rejected');
  ok(!!garbage.error, 'with an error to show the user');

  eq(Generator.parseModelOutput('').ok, false, 'an empty response is rejected');
}

/* ============================================================
   4 — sanitising: what an export must never carry
   ============================================================ */
section('sanitising model code');

{
  const folded = Generator.sanitizeCode({
    html: '<div class="a"><style>.a{color:red}</style><button>b</button><script>var q=1;</script></div>',
    css: '',
    js: ''
  });
  ok(folded.ok, 'embedded <style>/<script> blocks are folded, not rejected');
  eq(folded.html.indexOf('<style'), -1, 'the <style> tag is gone from the markup');
  eq(folded.html.indexOf('<script'), -1, 'the <script> tag is gone from the markup');
  contains(folded.css, '.a{color:red}', 'the style body moved into the stylesheet');
  contains(folded.js, 'var q=1;', 'the script body moved into the behaviour');

  const framework = Generator.sanitizeCode({ html: '<div id="app"></div>', css: '', js: 'ReactDOM.createRoot(document.getElementById("app"));' });
  ok(framework.ok === false, 'React is rejected');
  contains(framework.error, 'framework', 'and the reason is stated');

  const vue = Generator.sanitizeCode({ html: '<div id="a"></div>', css: '', js: 'Vue.createApp({}).mount("#a");' });
  ok(vue.ok === false, 'Vue is rejected');

  const remote = Generator.sanitizeCode({ html: '<div></div><script src="https://cdn.example.com/x.js"></script>', css: '', js: '' });
  ok(remote.ok === false, 'an external <script src> is rejected');
  contains(remote.error, 'external script', 'and named');

  const cdn = Generator.sanitizeCode({ html: '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/x.css"><div></div>', css: '', js: '' });
  ok(cdn.ok === false, 'a CDN reference is rejected');

  const framed = Generator.sanitizeCode({ html: '<iframe src="https://evil.example"></iframe>', css: '', js: '' });
  ok(framed.ok === false, 'an iframe is rejected');

  const inline = Generator.sanitizeCode({ html: '<button onclick="boom()">x</button>', css: '', js: '' });
  ok(inline.ok === false, 'inline on* handlers are rejected');

  const evil = Generator.sanitizeCode({ html: '<div></div>', css: '', js: 'eval("2+2");' });
  ok(evil.ok === false, 'eval() is rejected');

  const fn = Generator.sanitizeCode({ html: '<div></div>', css: '', js: 'new Function("return 1")();' });
  ok(fn.ok === false, 'new Function() is rejected');

  const imported = Generator.sanitizeCode({ html: '<div></div>', css: '', js: 'import x from "y";' });
  ok(imported.ok === false, 'module imports are rejected');

  const cookie = Generator.sanitizeCode({ html: '<div></div>', css: '', js: 'document.cookie = "x=1";' });
  ok(cookie.ok === false, 'cookie access is rejected');

  const neutralised = Generator.sanitizeCode({ html: '<a href="javascript:alert(1)">x</a>', css: 'a{background:url(javascript:alert(1))}', js: '' });
  ok(neutralised.ok, 'a javascript: URL is neutralised rather than shipped');
  eq(neutralised.html.indexOf('javascript:'), -1, 'the URL is gone from the markup');
  eq(neutralised.css.indexOf('javascript:'), -1, 'and from the stylesheet');

  const brokenJs = Generator.sanitizeCode({ html: '<p>static</p>', css: '', js: 'function ( { ]' });
  ok(brokenJs.ok, 'behaviour that will not parse degrades rather than taking the widget down');
  eq(brokenJs.js, '', 'the unparsable js is dropped');
  contains(brokenJs.html, 'static', 'and the markup is kept');

  const empty = Generator.sanitizeCode({ html: '   ', css: '', js: '' });
  ok(empty.ok === false, 'markup-less widgets are rejected');

  const breakout = Generator.sanitizeCode({ html: '<div></div><script>var s="</script>";</script>', css: 'a{}', js: '' });
  ok(breakout.ok === true || breakout.ok === false, 'breakout input is handled without throwing');
}

/* ============================================================
   5 — the Shadow DOM wrapper
   ============================================================ */
section('compileWidget — the component definition');

const compiled = Generator.compileWidget({ id: 'counter', title: 'Counter', code: COUNTER }, {});

{
  eq(compiled.ok, true, 'a clean widget compiles');
  eq(compiled.fallback, false, 'and is not a fallback');
  eq(compiled.id, 'counter', 'the id is preserved');

  contains(compiled.script, 'class PallettWidget extends HTMLElement', 'the custom element class is present');
  contains(compiled.script, 'attachShadow({ mode: "open" })', 'the shadow root is open');
  contains(compiled.script, 'customElements.define(TAG, PallettWidget)', 'the element is registered');
  contains(compiled.script, 'data-pallett-root', 'a shadow container is rendered');
  contains(compiled.script, Generator.ENGINE_MARKER, 'the engine half is in the definition');
  contains(compiled.script, Generator.CONFIG_MARKER, 'the config half is in the definition');
  contains(compiled.config, '--color-primary', 'design tokens are declared on :host');
  contains(compiled.script, 'unsafe-eval', 'the engine documents that it needs no unsafe-eval');
  contains(compiled.script, 'data-pallett-fallback', 'a fallback card exists inside the Shadow DOM');
  // A placeholder whose definition never arrives must not retry forever: a
  // missing registry entry is the commonest mistake, and an unbounded
  // setTimeout is an invisible runaway timer on a client's live site.
  contains(compiled.script, '__pallettTries', 'the mount retry is bounded');
  contains(compiled.script, 'No definition was found', 'and an undefined placeholder says so instead of spinning');

  ok(parses(compiled.config), 'the config script parses as JavaScript');
  ok(parses(compiled.runtime), 'the runtime script parses as JavaScript');
  ok(parses(compiled.script.replace(/<\/?script\b[^>]*>/g, '')), 'the whole definition parses as JavaScript');

  // The definition is injected inside a <script>, so its contents must never
  // be able to close that tag: every `<` in the data is \u003c-escaped.
  eq(countOf(compiled.script, '</script>'), 2, 'exactly two closing script tags (config + engine)');
  eq(countOf(compiled.script, '<script'), 2, 'and exactly two opening tags');
  eq(compiled.config.indexOf('</div>'), -1, 'the widget markup is escaped, not raw, inside the script');
  contains(compiled.config, '\\u003c', 'so it travels as unicode escapes');

  const again = Generator.compileWidget({ id: 'counter', title: 'Counter', code: COUNTER }, {});
  eq(again.rev, compiled.rev, 'the revision hash is a content hash, not a timestamp');

  const changed = Generator.compileWidget({ id: 'counter', title: 'Counter', code: Object.assign({}, COUNTER, { css: '.counter{color:red}' }) }, {});
  ok(changed.rev !== compiled.rev, 'and it changes when the widget changes');
}

section('compileWidget — fallback states');

{
  const fallback = Generator.compileWidget({ id: 'broken', error: 'the model returned nothing usable' }, {});
  eq(fallback.ok, false, 'a fallback definition reports not-ok');
  eq(fallback.fallback, true, 'and flags itself as a fallback');
  contains(fallback.config, 'the model returned nothing usable', 'the reason travels with the widget');
  ok(parses(fallback.runtime), 'the fallback still ships a valid engine');
  contains(fallback.script, 'data-pallett-fallback', 'the shadow DOM knows how to render it');

  // An id that cannot match a placeholder is a programmer error, not a
  // fallback: shipping a widget whose id no export can point at is worse
  // than failing loudly here.
  let threw = false;
  try { Generator.compileWidget({ id: 'not valid id!', code: COUNTER }, {}); } catch (e) { threw = true; }
  ok(threw === true, 'an id that cannot match a placeholder throws');

  threw = false;
  try { Generator.compileWidget({ id: ' ', code: COUNTER }, {}); } catch (e) { threw = true; }
  ok(threw === true, 'a genuinely empty id throws');

  eq(Generator.normalizeId('roofing-calc-2'), 'roofing-calc-2', 'a valid id is accepted');
  eq(Generator.normalizeId('has space'), null, 'an invalid id normalises to null rather than a guess');
}

/* ============================================================
   6 — generateWidget end to end (with a mocked model)
   ============================================================ */
section('generateWidget');

(async () => {
  const generated = await Generator.generateWidget(
    'Build a click counter widget',
    { seed: { l: 0.6, c: 0.15, h: 210 } },
    { complete: mockComplete(COUNTER), id: 'counter' }
  );
  const generatedAgain = await Generator.generateWidget(
    'Build a click counter widget',
    { seed: { l: 0.6, c: 0.15, h: 210 } },
    { complete: mockComplete(COUNTER), id: 'counter' }
  );

  ok(typeof generated === 'string' && generated.length > 500, 'generateWidget returns a definition string');
  contains(generated, 'class PallettWidget extends HTMLElement', 'the Shadow DOM wrapper is constructed');
  contains(generated, 'attachShadow', 'the shadow root is attached');
  contains(generated, 'oklch(', 'the design tokens reached the widget');
  contains(generated, 'data-count', 'the counter markup reached the widget');
  contains(generated, 'addEventListener', 'the counter behaviour reached the widget');
  eq(generated, generatedAgain, 'generation is deterministic for identical input');
  ok(parses(Generator.unwrapScript(generated)), 'the definition parses as JavaScript');

  const compiledResult = await Generator.generateWidgetCompiled(
    'Build a click counter widget',
    null,
    { complete: mockComplete(COUNTER), id: 'counter' }
  );
  eq(compiledResult.fallback, false, 'the structured result reports a real widget');
  eq(compiledResult.id, 'counter', 'with the expected id');

  // --- a model that throws ---
  const offline = await Generator.generateWidget('Anything', null, {
    complete: async () => { throw new Error('network down'); },
    id: 'offline-widget'
  });
  contains(offline, 'class PallettWidget extends HTMLElement', 'an unreachable model still yields a mounted component');
  contains(offline, 'network down', 'and the shadow DOM says why it is empty');

  // --- a model that returns nonsense ---
  const nonsense = await Generator.generateWidget('Anything', null, { complete: mockComplete('I cannot help with that.'), id: 'nonsense' });
  contains(nonsense, 'data-pallett-fallback', 'malformed output renders the fallback UI');

  // --- a model that returns a framework ---
  const framework = await Generator.generateWidget('Anything', null, {
    complete: mockComplete({ html: '<div id="a"></div>', css: '', js: 'ReactDOM.render(1, document.getElementById("a"));' }),
    id: 'framework'
  });
  contains(framework, 'data-pallett-fallback', 'framework output renders the fallback UI');
  contains(framework, 'framework', 'and explains the refusal');

  // --- an empty prompt is a programmer error, not a fallback ---
  let rejected = false;
  try { await Generator.generateWidget('   ', null, { complete: mockComplete(COUNTER) }); } catch (e) { rejected = true; }
  ok(rejected, 'an empty prompt is rejected rather than shipped');

  // --- the LLM seam itself ---
  eq(typeof Generator.defaultCompleter, 'function', 'a placeholder completer ships with the engine');
  eq(typeof Generator.getCompleter(), 'function', 'and is the default adapter');
  const installed = Generator.setCompleter(async () => JSON.stringify(COUNTER));
  eq(typeof installed, 'function', 'setCompleter installs an adapter');
  ok(Generator.getCompleter() === installed, 'and getCompleter returns it — the provider seam is real');
  const viaInstalled = await Generator.generateWidget('A counter please', null, { id: 'counter' });
  contains(viaInstalled, 'data-pallett-root', 'a generation with no opts.complete uses the installed adapter');
  Generator.setCompleter(null);
  ok(Generator.getCompleter() === Generator.defaultCompleter, 'clearing it restores the built-in placeholder');

  /* ============================================================
     7 — injection into the export
     ============================================================ */
  section('injectWidgetsIntoAST');

  const placeholders = Injector.listWidgetPlaceholders(SKELETON);
  eq(placeholders.length, 1, 'the placeholder is found');
  eq(placeholders[0].id, 'roofing-calc', 'with its id');
  eq(Injector.listWidgetPlaceholders('<script>var s = "<pallet-widget id=\'x\'></pallet-widget>";</script>').length, 0,
    'a placeholder inside a <script> is not a placeholder');

  const registry = { 'roofing-calc': { id: 'roofing-calc', title: 'Roofing estimator', code: COUNTER } };
  const injected = Injector.injectWidgetsIntoAST(SKELETON, registry);
  ok(injected.ok, 'injection reports ok');
  eq(injected.injected.join(','), 'roofing-calc', 'the placeholder id was injected');
  eq(injected.skipped.length, 0, 'nothing was skipped');

  contains(injected.html, '<pallet-widget id="roofing-calc"></pallet-widget>', 'the placeholder itself is untouched');
  contains(injected.html, 'data-pallett-widget="roofing-calc"', 'a definition block was added for it');
  contains(injected.html, 'data-pallett-widget-runtime', 'and the shared engine');
  eq(countOf(injected.html, 'data-pallett-widget-runtime'), 1, 'the engine is emitted exactly once');
  eq(countOf(injected.html, 'class PallettWidget extends HTMLElement'), 1, 'the class definition appears exactly once');

  const defAt = injected.html.indexOf('data-pallett-widget="roofing-calc"');
  const engineAt = injected.html.indexOf('data-pallett-widget-runtime');
  const bodyAt = injected.html.indexOf('</body>');
  ok(defAt !== -1 && defAt < bodyAt, 'the definition sits before </body>');
  ok(engineAt !== -1 && engineAt < bodyAt, 'so does the engine');
  ok(defAt < engineAt, 'the config is registered before the engine defines the element');
  ok(injected.runtimeEmitted, 'runtimeEmitted reports the engine was added');

  // Everything between the first injected <script and the last one before
  // </body> is the block this pipeline added, so it must parse on its own.
  const blockStart = injected.html.lastIndexOf('<script', defAt);
  const blockEnd = injected.html.lastIndexOf('</script>', bodyAt) + '</script>'.length;
  const tail = injected.html.slice(blockStart, blockEnd);
  ok(parses(tail.replace(/<\/?script\b[^>]*>/g, '')), 'the injected block parses as JavaScript');

  section('injection — deduplication');

  const twice = Injector.injectWidgetsIntoAST(
    SKELETON.replace('</main>', '<pallet-widget id="roofing-calc"></pallet-widget></main>'),
    registry
  );
  eq(countOf(twice.html, 'data-pallett-widget="roofing-calc"'), 1,
    'the same widget used twice on a page is defined once');
  eq(countOf(twice.html, 'data-pallett-widget-runtime'), 1, 'and the engine is still emitted once');
  eq(countOf(twice.html, '<pallet-widget id="roofing-calc">'), 2, 'but both placeholders stay in the markup');

  const two = Injector.injectWidgetsIntoAST(
    SKELETON.replace('</main>', '<pallet-widget id="roofing-calc"></pallet-widget><pallet-widget id="mortgage-calc"></pallet-widget></main>'),
    {
      'roofing-calc': { id: 'roofing-calc', code: COUNTER },
      'mortgage-calc': { id: 'mortgage-calc', code: Object.assign({}, COUNTER, { html: '<div class="m"><p data-out>0</p><button data-step>Next</button></div>' }) }
    }
  );
  eq(countOf(two.html, 'data-pallett-widget="roofing-calc"'), 1, 'widget one is defined');
  eq(countOf(two.html, 'data-pallett-widget="mortgage-calc"'), 1, 'widget two is defined');
  eq(countOf(two.html, 'data-pallett-widget-runtime'), 1, 'two different widgets still share ONE class definition');
  ok(two.html.indexOf('data-pallett-widget-runtime') > two.html.indexOf('data-pallett-widget="mortgage-calc"'),
    'the engine comes after every config block');

  section('injection — idempotency and edge cases');

  const again2 = Injector.injectWidgetsIntoAST(injected.html, registry);
  eq(again2.html, injected.html, 're-running the injector over its own output changes nothing');
  eq(again2.injected.length, 0, 'and reports nothing newly injected');

  const unknown = Injector.injectWidgetsIntoAST(SKELETON, { other: { id: 'other', code: COUNTER } });
  eq(unknown.injected.length, 0, 'a registry entry with no placeholder is not injected');
  eq(unknown.skipped.join(','), 'roofing-calc', 'the unmatched placeholder is reported as skipped');
  contains(unknown.html, '<pallet-widget id="roofing-calc"></pallet-widget>', 'and is left exactly as authored');
  eq(unknown.html.indexOf('data-pallett-widget-runtime'), -1, 'no engine is emitted for a page with no widgets');
  ok(unknown.warnings.length > 0, 'the missing definition is surfaced as a warning');

  const alias = Injector.injectWidgetsIntoAST(
    SKELETON.replace('<pallet-widget id="roofing-calc"></pallet-widget>', '<pallett-widget id="roofing-calc"></pallett-widget>'),
    registry
  );
  eq(alias.injected.join(','), 'roofing-calc', 'the product spelling of the tag is recognised too');

  const bare = Injector.injectWidgetsIntoAST('<div><pallet-widget id="roofing-calc"></pallet-widget></div>', registry);
  ok(bare.ok && bare.html.indexOf('data-pallett-widget="roofing-calc"') !== -1, 'a document with no </body> still gets its widget');

  const fromArray = Injector.injectWidgetsIntoAST(SKELETON, [{ id: 'roofing-calc', code: COUNTER }]);
  eq(fromArray.injected.join(','), 'roofing-calc', 'an array registry works');
  const fromMap = Injector.injectWidgetsIntoAST(SKELETON, new Map([['roofing-calc', { code: COUNTER }]]));
  eq(fromMap.injected.join(','), 'roofing-calc', 'a Map registry works');

  const empty = Injector.injectWidgetsIntoAST('', registry);
  eq(empty.ok, false, 'an empty document is rejected');

  /* ============================================================
     8 — the round trip: generateWidget -> injectWidgetsIntoAST
     ============================================================ */
  section('round trip');

  const roundTrip = Injector.injectWidgetsIntoAST(SKELETON, { 'roofing-calc': generated });
  eq(roundTrip.injected.join(','), 'roofing-calc', 'a generated definition injects into a real skeleton');
  eq(roundTrip.runtimeEmitted, false, 'a self-contained definition does not need a second engine');
  eq(countOf(roundTrip.html, 'data-pallett-widget-runtime'), 1, 'so the engine appears exactly once');
  eq(countOf(roundTrip.html, 'class PallettWidget extends HTMLElement'), 1, 'and so does the class');
  contains(roundTrip.html, '<pallet-widget id="roofing-calc"></pallet-widget>', 'the placeholder is intact in the finished export');

  const shippedStart = roundTrip.html.indexOf('<script data-pallett-widget=');
  const shippedEnd = roundTrip.html.lastIndexOf('</script>') + '</script>'.length;
  ok(parses(roundTrip.html.slice(shippedStart, shippedEnd).replace(/<\/?script\b[^>]*>/g, '')),
    'the shipped widget block parses as JavaScript');
  ok(roundTrip.html.indexOf('<!doctype html>') === 0, 'the export is still a document, not a bare script');
  ok(roundTrip.html.indexOf('</html>') !== -1, 'and keeps its closing document tags');

  /* ============================================================
     summary
     ============================================================ */
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('backend-widget smoke: ALL GREEN');
})().catch((e) => {
  console.error('backend-widget smoke crashed:', e && e.stack ? e.stack : e);
  process.exit(1);
});
