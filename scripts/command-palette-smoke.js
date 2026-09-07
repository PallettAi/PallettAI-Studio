#!/usr/bin/env node
// Command palette filter + required destinations.
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

let pal;
try {
  pal = require(path.join(ROOT, 'data', 'command-palette.js'));
} catch (e) {
  console.error('command-palette-smoke FAILED — module missing: ' + e.message);
  process.exit(1);
}

console.log('== Commands ==');
assert(Array.isArray(pal.COMMANDS) && pal.COMMANDS.length >= 10, 'ships a command list');
const ids = pal.COMMANDS.map((c) => c.id);
['dashboard', 'templates', 'designer', 'ai', 'suites', 'database', 'settings', 'upgrade', 'copilot', 'export'].forEach((id) => {
  assert(ids.includes(id), 'has ' + id);
});

console.log('\n== Filter ==');
{
  const hits = pal.filterCommands('upgr', pal.COMMANDS);
  assert(hits.some((c) => c.id === 'upgrade'), 'upgr finds Upgrade');
  assert(!hits.some((c) => c.id === 'dashboard'), 'upgr does not keep Dashboard');
}
{
  const hits = pal.filterCommands('ai', pal.COMMANDS);
  assert(hits.some((c) => c.id === 'ai' || c.id === 'copilot'), 'ai finds AI Studio or Copilot');
}
{
  const all = pal.filterCommands('', pal.COMMANDS);
  assert(all.length === pal.COMMANDS.length, 'empty query returns every command');
}

console.log('\n== Highlight index ==');
assert(pal.nextIndex(0, 5, 1) === 1, 'down moves forward');
assert(pal.nextIndex(4, 5, 1) === 0, 'down wraps');
assert(pal.nextIndex(0, 5, -1) === 4, 'up wraps');

if (failed) {
  console.error('\ncommand-palette-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\ncommand-palette-smoke PASSED');
