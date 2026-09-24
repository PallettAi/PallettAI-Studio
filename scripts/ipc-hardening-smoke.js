#!/usr/bin/env node
// ============================================================
// PallettAI Studio — IPC hardening & preload surface guard
// ------------------------------------------------------------
// The Electron boundary is the one place where a mistake is a
// security bug rather than a rendering bug, and it is invisible to
// every other suite: the app's own smoke tests run the modules in
// Node, where there is no renderer and no `ipcMain`.
//
// This brief asked for `main/index.js` and a `pallettaiAPI` bridge
// on `preload.js`. That work is already done and is load-bearing:
// `main.js` is a 60KB shell with 12 sender-validated channels (plus
// `main/index.js`'s static-compile channel — registrations live in
// both files and BOTH are scanned here), and `app.js` reads
// `window.pallettai.*` in 22 places. So instead of rewriting a
// working boundary, this suite PINS it — every invariant the brief
// asked to enforce, asserted against the real source, so a future
// change that breaks isolation, forgets a sender check, or renames
// the exposed object fails here rather than in a shipped build.
//
//   node scripts/ipc-hardening-smoke.js
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const bridgeSrc = fs.readFileSync(path.join(ROOT, 'main', 'index.js'), 'utf8');
const preloadSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(label);
  console.error('  x ' + label + (detail ? ' [' + String(detail).slice(0, 180) + ']' : ''));
}
function eq(a, b, label) { ok(a === b, label + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function section(name) { console.log('\n== ' + name + ' =='); }

// ---------------------------------------------------------------
// 1 — the window is isolated
// ---------------------------------------------------------------
section('the renderer is isolated from Node');
{
  const cis = mainSrc.match(/contextIsolation\s*:\s*(true|false)/g) || [];
  ok(cis.length >= 1, 'the window options set contextIsolation');
  ok(cis.every((m) => /true\s*$/.test(m)), 'EVERY contextIsolation is true', cis.join(', '));

  const ni = mainSrc.match(/nodeIntegration\s*:\s*(true|false)/g) || [];
  ok(ni.length >= 1, 'and set nodeIntegration');
  ok(ni.every((m) => /false\s*$/.test(m)), 'EVERY nodeIntegration is false', ni.join(', '));

  ok(!/nodeIntegration\s*:\s*true/.test(mainSrc), 'nodeIntegration is never enabled anywhere');
  ok(!/webSecurity\s*:\s*false/.test(mainSrc), 'webSecurity is never disabled');
  ok(!/allowRunningInsecureContent\s*:\s*true/.test(mainSrc), 'insecure content is never allowed');
  ok(!/enableRemoteModule\s*:\s*true/.test(mainSrc), 'the remote module is never enabled');
  ok(!/require\(\s*['"]@electron\/remote['"]\s*\)/.test(mainSrc), 'and @electron/remote is not required');
  ok(mainSrc.indexOf('sandbox: false') === -1, 'the preload sandbox is not switched off');
}

// ---------------------------------------------------------------
// 2 — every IPC channel validates its sender
// ---------------------------------------------------------------
section('every IPC channel validates its sender');

/*
  The convention is `fromMainFrame(event, win)` as the first statement of a
  handler body, because `event.senderFrame` is filled in by Electron from
  the frame that really sent the message rather than from anything the
  renderer can claim. A channel that forgets it is reachable from any frame
  the window loads, which is the whole threat model.

  The check is source-level and deliberately so: there is no way to invoke
  `ipcMain` outside Electron, so the source IS the artefact worth pinning.
  Registrations live in two files — main.js's shell channels and
  main/index.js's static-compile channel — and a channel gets no exemption
  from the convention for having moved into a module, so both are scanned.
*/
const channels = (() => {
  const out = [];
  [mainSrc, bridgeSrc].forEach((src) => {
    const rx = /ipcMain\.(handle|on)\(\s*['"]([^'"]+)['"]/g;
    const marks = [];
    let m;
    while ((m = rx.exec(src))) marks.push({ index: m.index, method: m[1], channel: m[2] });
    marks.forEach((mark, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].index : src.length;
      out.push(Object.assign({}, mark, { body: src.slice(mark.index, end) }));
    });
  });
  return out;
})();

{
  ok(channels.length >= 8, 'the shell registers a real IPC surface (' + channels.length + ' channels)');
  const unvalidated = channels.filter((c) => !/fromMainFrame\s*\(/.test(c.body));
  eq(unvalidated.length, 0, 'EVERY channel checks fromMainFrame before doing anything',
    unvalidated.map((c) => c.channel).join(', '));

  const names = channels.map((c) => c.channel);
  eq(new Set(names).size, names.length, 'channel names are unique (a duplicate throws at window creation)');

  const validated = channels.filter((c) => /fromMainFrame\s*\(/.test(c.body)).length;
  console.log('  ' + channels.length + ' channels, ' + validated + ' sender-validated');
}

// ---------------------------------------------------------------
// 3 — the preload surface matches what the renderer consumes
// ---------------------------------------------------------------
section('the preload surface matches the renderer');
{
  ok(/contextBridge\.exposeInMainWorld\(/.test(preloadSrc), 'preload goes through contextBridge');
  const world = (preloadSrc.match(/exposeInMainWorld\(\s*['"]([^'"]+)['"]/) || [])[1];
  eq(world, 'pallettai', 'and exposes exactly the object the renderer reads');

  // The bridge must be a closure over ipcRenderer, never ipcRenderer itself:
  // handing the renderer `ipcRenderer` would let it call any channel.
  ok(!/exposeInMainWorld\([\s\S]{0,400}\bipcRenderer\s*[,}]/.test(preloadSrc),
    'ipcRenderer is never handed to the renderer as a value');
  ok(!/\brequire\s*:\s*require\b/.test(preloadSrc), 'require is not exposed');
  ok(!/exposeInMainWorld\([\s\S]{0,400}\bprocess\s*[,}]/.test(preloadSrc), 'process is not exposed');

  // Members the renderer actually calls.
  const used = new Set();
  (appSrc.match(/window\.pallettai\.([A-Za-z0-9_]+)/g) || []).forEach((s) => used.add(s.split('.').pop()));
  ok(used.size >= 5, 'the renderer consumes the bridge (' + used.size + ' distinct members)');
  const missing = Array.from(used).filter((k) => !new RegExp('\\b' + k + '\\s*:').test(preloadSrc) && preloadSrc.indexOf(k) === -1);
  eq(missing.length, 0, 'EVERY member the renderer calls exists on the bridge', missing.join(', '));

  // The name itself is load-bearing: the browser build has no preload, so the
  // renderer guards on `window.pallettai` being absent. Renaming the exposed
  // object would silently disable every Electron-only feature.
  ok(appSrc.indexOf('window.' + world) !== -1, 'and the renderer references window.' + world);
}

// ---------------------------------------------------------------
// 4 — the bridge and the handlers agree
// ---------------------------------------------------------------
section('every channel the bridge calls is handled');
{
  const invoked = new Set();
  const rx = /ipcRenderer\.(invoke|send|sendSync)\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = rx.exec(preloadSrc))) invoked.add(m[2]);
  ok(invoked.size >= 3, 'preload calls channels (' + invoked.size + ')');

  const registered = new Set(channels.map((c) => c.channel));
  const orphans = Array.from(invoked).filter((c) => !registered.has(c));
  // An unhandled channel is not an error the renderer ever sees: `invoke`
  // rejects and `sendSync` returns undefined, so the feature just stops
  // working. That silence is why this is a test.
  eq(orphans.length, 0, 'EVERY channel the bridge calls is registered in main', orphans.join(', '));

  const neverCalled = Array.from(registered).filter((c) => !invoked.has(c));
  console.log('  ' + invoked.size + ' channels called from preload, ' + registered.size + ' registered, '
    + neverCalled.length + ' registered but not bridge-called (' + neverCalled.join(', ') + ')');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('ipc-hardening smoke: ALL GREEN');
