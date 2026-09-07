#!/usr/bin/env node
// Studio pins the official PallettAI registry — no pasted URL or anon key.
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};

const SUPABASE = require(path.join(ROOT, 'modules', 'supabase.js'));
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const OFFICIAL = 'https://fjahxichioccknszuxhb.supabase.co';

console.log('== Official registry ==');
assert(SUPABASE.REGISTRY && SUPABASE.REGISTRY.url === OFFICIAL, 'REGISTRY url is the PallettAI project');
assert(typeof SUPABASE.REGISTRY.anonKey === 'string' && SUPABASE.REGISTRY.anonKey.indexOf('eyJ') === 0, 'REGISTRY embeds the public anon key');
assert(typeof SUPABASE.connectOfficial === 'function', 'connectOfficial is exported');
assert(typeof SUPABASE.ensureOfficial === 'function', 'ensureOfficial is exported');

console.log('\n== Connect pins the official project ==');
{
  const r = SUPABASE.connectOfficial();
  assert(r.ok === true, 'connectOfficial succeeds');
  assert(SUPABASE.isConfigured(), 'registry is configured after connect');
  assert(SUPABASE.getConfig().url === OFFICIAL, 'stored URL is official');
  assert(SUPABASE.getConfig().anonKey === SUPABASE.REGISTRY.anonKey, 'stored key is official');
}
{
  SUPABASE.setConfig('https://evil.supabase.co', 'eyJ-fake');
  SUPABASE.ensureOfficial();
  assert(SUPABASE.getConfig().url === OFFICIAL, 'ensureOfficial overwrites a foreign project');
}
{
  const r = SUPABASE.setConfig('http://127.0.0.1:54321', 'test-anon-key');
  assert(r.ok === true && SUPABASE.getConfig().url === 'http://127.0.0.1:54321', 'tests can still point the client at the mock registry');
}

console.log('\n== Settings UI ==');
assert(!/id="sbUrl"/.test(app), 'Settings has no project URL field');
assert(!/id="sbKey"/.test(app), 'Settings has no anon key field');
assert(/connectOfficial\(/.test(app), 'Settings connect uses connectOfficial');
assert(/ensureOfficial\(/.test(app), 'boot pins the official registry');
assert(/btnAccConnect/.test(app), 'Settings has a Connect button');

if (failed) {
  console.error('\nregistry-connect-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nregistry-connect-smoke PASSED');
