#!/usr/bin/env node
'use strict';

/*
  The section toolbar and the token inspector are browser scripts, so the release
  gate's other UI checks can only read them. This suite runs them against a stub
  DOM and drives the two behaviours a screenshot would show a person verifying by
  hand:

    1. clicking "Rewrite copy" hands the app a request naming the section that is
       selected — and says so when nothing is listening;
    2. the contrast badge passes and fails on the right pairs, measured rather
       than asserted, so the numbers a client reads are the numbers the code
       computes.

  It is deliberately not a browser: it substitutes for a machine where one cannot
  be driven, and it fails on the things that break silently — a button wired to
  nothing renders identically to one that works.
*/

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

let failed = 0;
const pass = (msg) => console.log('  \u2713 ' + msg);
const fail = (msg) => { failed++; console.error('  \u2717 ' + msg); };
const ok = (cond, msg) => (cond ? pass(msg) : fail(msg));

function makeEl(extra) {
  const el = {
    id: '', className: '', hidden: false, innerHTML: '', textContent: '', title: '',
    dataset: {}, style: {},
    setAttribute(k, v) { this[k] = v; },
    getAttribute() { return ''; },
    addEventListener(type, fn) { this._on = this._on || {}; this._on[type] = fn; },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    appendChild() {}
  };
  return Object.assign(el, extra || {});
}

// ---- section toolbar ----
console.log('== Section toolbar (stub DOM) ==');
{
  const bar = makeEl();
  // Children are looked up by their own selector, the way a real bar behaves:
  // a stub that hands back one shared element cannot tell a label from a note,
  // and would hide the bug where the note overwrites the section name.
  const children = {};
  bar.querySelector = (sel) => (children[sel] = children[sel] || makeEl());
  const noteEl = () => children['[data-copilot-note]'] || makeEl();
  let created = null;
  const docHandlers = [];
  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    document: {
      body: { appendChild(el) { created = el; } },
      createElement: () => bar,
      querySelector: (sel) => {
        if (!created) return null;
        const child = /^#sectionCopilotBar\s+(.*)$/.exec(sel);
        if (child) return bar.querySelector(child[1]);
        return sel === '#sectionCopilotBar' ? bar : null;
      },
      addEventListener: (type, fn) => docHandlers.push([type, fn])
    },
    window: { addEventListener() {} }
  };
  sandbox.window.document = sandbox.document;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'ui', 'copilot.js'), 'utf8'), sandbox);

  const api = sandbox.window.PallettAISectionCopilot;
  ok(api && typeof api.select === 'function', 'the toolbar exposes select()');
  api.select({ pageId: 'p1', index: 1, type: 'about' });
  ok(/Rewrite copy/.test(bar.innerHTML) && /Change layout/.test(bar.innerHTML), 'selecting a section raises the three actions');
  ok(children['[data-copilot-label]'].textContent === 'Section 2 \u00b7 About', 'the bar names the section it will act on');
  ok(bar.hidden === false, 'the bar is visible once a section is selected');

  let got = null;
  api.onRequest = (req) => { got = req; return 'sent'; };
  const click = (action) => docHandlers.filter((h) => h[0] === 'click').forEach((h) => h[1]({ target: { closest: () => ({ dataset: { copilotAction: action } }) } }));
  click('copy');
  ok(got && got.action === 'copy', 'the copy button asks the app for a copy rewrite');
  ok(got.section && got.section.index === 1 && got.section.type === 'about', 'and it names the selected page and kind');
  ok(noteEl().textContent === 'sent', 'the bar shows what the app answered');
  click('layout');
  ok(got && got.action === 'layout', 'the layout button asks for a layout change');
  click('mutate');
  ok(got && got.action === 'mutate', 'the mutate button opens a prompt for the same section');

  api.onRequest = null;
  got = null;
  click('copy');
  ok(got === null && /unavailable/i.test(noteEl().textContent), 'with no handler the bar says so instead of doing nothing quietly');

  api.clear();
  ok(bar.hidden === true, 'clearing the selection hides the bar');
}

// ---- design tokens ----
console.log('\n== Design tokens (stub DOM) ==');
{
  const root = makeEl();
  const badge = makeEl();
  const brandBadge = makeEl();
  root.querySelector = (sel) => (sel === '[data-body-ratio]' ? badge : sel === '[data-brand-ratio]' ? brandBadge : makeEl());
  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    document: {
      querySelector: (sel) => (sel === '#tokenInspector' ? root : null),
      addEventListener() {}
    },
    window: {}
  };
  sandbox.window.document = sandbox.document;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'ui', 'inspector.js'), 'utf8'), sandbox);

  const api = sandbox.window.PallettAITokens;
  ok(api && typeof api.sync === 'function', 'the panel exposes sync()');
  ok(api.ratio('#000000', '#ffffff').toFixed(1) === '21.0', 'black on white measures 21:1');

  api.sync({ text: '#000000', surface: '#ffffff', brand: '#3366ff', space: 96, radius: '999px' });
  ok(/AA PASS/.test(badge.textContent) && /21/.test(badge.textContent), 'a legible pair reports AA PASS with its ratio');
  ok(/pass/.test(badge.className), 'and the badge is styled as a pass');

  api.sync({ text: '#a0a0a0', surface: '#ffffff' });
  ok(/AA FAIL/.test(badge.textContent), 'grey body text on white reports AA FAIL');
  ok(/fail/.test(badge.className), 'and the badge is styled as a failure');
  // The brand pair is a different question from body text — a brand colour only
  // has to clear 3:1 — so it is reported on its own line, at its own threshold.
  ok(/:1/.test(brandBadge.textContent) && !/below AA/.test(brandBadge.textContent), 'a brand colour with enough contrast clears 3:1');
  api.sync({ text: '#000000', surface: '#ffffff', brand: '#f4f4f4' });
  ok(/below AA/.test(brandBadge.textContent), 'a brand colour too close to the surface is called out at 3:1');

  // The panel's own edits have to leave through onChange, tagged in project terms
  // — a control that only repaints itself is the bug this panel was rebuilt for.
  let patch = null;
  api.onChange = (p) => { patch = p; };
  const inputs = makeEl();
  let listener = null;
  inputs.dataset = { token: 'space' };
  inputs.value = '132';
  inputs.addEventListener = (type, fn) => { listener = fn; };
  root.querySelectorAll = () => [inputs];
  api.sync({ text: '#000000', surface: '#ffffff' });
  ok(typeof listener === 'function', 'each control is wired to a listener');
  listener();
  ok(patch && patch.spacing === 132, 'a slider edit reaches the app as the project token it changes');
}

if (failed) {
  console.error('\nui-dom-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nui-dom-smoke PASSED');
