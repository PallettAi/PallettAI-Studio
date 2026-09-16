#!/usr/bin/env node
'use strict';

/*
  Planner / executor parity.

  The planner in modules/ai.js decides what to do; the executor in app.js
  decides how. They are separate files with no shared type, so an op the planner
  starts emitting but the executor has no case for is invisible until a client
  hits it — and what they see then is the executor's default, which says "not
  supported yet" about a feature the copilot just offered them.

  That failure has already happened once in this codebase's history: a new act
  is easy to add on one side and forget on the other.

  This is a source scan rather than a behavioural test, so it is deliberately
  one-directional and approximate:

    · it catches op literals (`op: 'revert'`) and `case` labels, so an op built
      from a variable can be missed — a false negative, never a false alarm
    · it never asserts the reverse (every case being reachable), because the
      executor is allowed to keep working cases the planner happens to stop
      emitting, and a suite that fails on that would be deleted, not fixed.

  KNOWN_ELSEWHERE is the honest part: ops the planner emits that are handled
  before chatAct is ever reached, or that never reach the executor at all. Each
  one has to be named here with its reason, so adding an op to this list is a
  deliberate act rather than a way to silence the check.
*/

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const aiSrc = fs.readFileSync(path.join(ROOT, 'modules', 'ai.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

/* The word boundary is load-bearing: without it `shop: 'Shop'` in a title map
   reads as `op: 'Shop'`, which is how this scan first reported an op that does
   not exist. A suite that cries wolf gets ignored, so the pattern is anchored
   at the start of a word. */
function scan(aiSource, appSource, elsewhere) {
  const planned = new Set();
  for (const m of aiSource.matchAll(/\bop\s*:\s*'([A-Za-z]+)'/g)) planned.add(m[1]);

  const bodyStart = appSource.indexOf('function chatAct(');
  const bodyEnd = bodyStart === -1 ? -1 : appSource.indexOf('\n  function ', bodyStart + 10);
  const handled = new Set();
  if (bodyStart !== -1 && bodyEnd > bodyStart) {
    for (const m of appSource.slice(bodyStart, bodyEnd).matchAll(/case\s*'([A-Za-z]+)'\s*:/g)) handled.add(m[1]);
  }
  return { planned, handled, missing: [...planned].filter((op) => !handled.has(op) && !elsewhere[op]).sort() };
}

/* Referenced by name in the executor, not as a case: dispatched on its own path
   or consumed by the shell before chatAct runs. */
const KNOWN_ELSEWHERE = {
  help: 'chatExecute reads it to print the copilot’s help text',
  closeChat: 'chatExecute closes the panel',
  ask: 'answered by the shell, not an edit',
  review: 'runs the render audit, drawn by chatApplyPlan',
  options: 'offers alternates, drawn by chatApplyPlan',
  fixAll: 'runs the batch repair, dispatched by chatApplyPlan before the act loop',
  undo: 'handled in chatExecute before chatAct, because it rewinds past the act loop'
};

const bodyStart = appSrc.indexOf('function chatAct(');
const bodyEnd = bodyStart === -1 ? -1 : appSrc.indexOf('\n  function ', bodyStart + 10);
assert(bodyStart !== -1 && bodyEnd > bodyStart, 'the executor entry point (chatAct) is where this suite expects it');

const { planned, handled, missing } = scan(aiSrc, appSrc, KNOWN_ELSEWHERE);

console.log('== Every op the planner emits has an executor ==');
assert(planned.size > 20, 'the scan found the planner’s vocabulary (' + planned.size + ' ops)');
if (missing.length) {
  missing.forEach((op) => fail('the planner emits “' + op + '” and chatAct has no case for it'));
} else {
  pass('all ' + planned.size + ' planned ops are handled');
}

console.log('\n== The exceptions are all accounted for ==');
Object.keys(KNOWN_ELSEWHERE).forEach((op) => {
  assert(!handled.has(op), '“' + op + '” is not also a case (its reason would be stale)');
});

console.log('\n== The check bites ==');
/* Removing a case from a copy of the executor must make the scan report exactly
   that op. Without this, the suite passing could just mean the scan is broken —
   and a check that cannot fail is worse than no check, because it is trusted. */
const gutted = appSrc.replace("case 'revert':", "case 'revertWASREMOVED':");
assert(gutted !== appSrc, 'the sabotage actually changed the source');
const after = scan(aiSrc, gutted, KNOWN_ELSEWHERE);
assert(after.missing.length === 1 && after.missing[0] === 'revert', 'a missing executor case is reported, and only that one');
const withPlanner = aiSrc + "\n// { op: 'nothingHandlesMe' }";
const plannerGutted = scan(withPlanner, appSrc, KNOWN_ELSEWHERE);
assert(plannerGutted.missing.length === 1 && plannerGutted.missing[0] === 'nothingHandlesMe', 'an op with no executor is reported too');
/* And the anchored pattern must not report the title map. */
const titleMap = "const T = { shop: 'Shop' };";
assert(!scan(titleMap, appSrc, KNOWN_ELSEWHERE).planned.has('Shop'), 'a title map key ending in “op” is not read as an op');

console.log('\n== The revert glue is wired the way the module needs ==');
/*
  The browser half of this feature cannot be unit-tested from Node — it lives
  inside app.js's closure and needs the DOM, the store and a live undo stack.
  These assertions check the specific things that would be wrong quietly:
  history read across projects, a revert that is not itself undoable, and a
  report that describes the plan rather than what actually happened.
*/
/* Bounded by the next top-level function, so a neighbour’s body cannot satisfy
   an assertion about this one. */
function bodyOf(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start === -1) return '';
  const end = source.indexOf('\n  function ', start + 10);
  return source.slice(start, end === -1 ? source.length : end);
}
const glue = bodyOf(appSrc, 'histRevert');
assert(glue.length > 0, 'the revert handler exists');
assert(/Lib\.plan\(/.test(glue) && /Lib\.applyRestores\(/.test(glue), 'it asks the module for a plan, then asks it to write');
assert(glue.indexOf('histCaptureNow()') !== -1 && glue.indexOf('histCaptureNow()') < glue.indexOf('applyRestores'), 'the pre-revert state is captured BEFORE the write, so the revert is itself undoable');
assert(/skipped:\s*true/.test(glue), 'a revert it cannot do is a skip with a reason, not a silent no-op');
assert(glue.indexOf('saveProjects()') !== -1, 'a revert persists like any other edit');
assert(/parsed\.id !== c\.id/.test(bodyOf(appSrc, 'histStates')), 'the history is filtered to the open project, not the whole session');
assert(/meta\.said \|\| act\.label/.test(appSrc), 'the report can describe what the act found, not only what was planned');

console.log('\n== The new capability is wired on both sides ==');
assert(planned.has('revert'), 'the planner plans a targeted revert');
assert(handled.has('revert'), 'and the executor runs it');
assert(/data\/revert\.js/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')), 'the revert engine is loaded on the page');
assert(/data\/ai-scope\.js/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')), 'and so is the scope engine');

if (failed) {
  console.error('\ncopilot-ops-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\ncopilot-ops-smoke PASSED');
