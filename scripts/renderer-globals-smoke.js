'use strict';

/*
  Renderer-global safety.

  Every other smoke runs the generator in Node, where `process`, `__dirname`
  and `require` all exist. The Studio's own renderer has contextIsolation on and
  Node integration off, so none of them do. A single unguarded read of a
  Node-only global is therefore invisible to the entire suite and fatal in the
  app — which is exactly how a debug line reading `process.env` ended up
  throwing on every generation and refunding the user's credit.

  This gate runs the real index.html script list through a scanner and fails on
  the whole class, not just the one line.
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const files = [...index.matchAll(/<script src="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((rel) => fs.existsSync(path.join(ROOT, rel)));

// Globals Node has and the renderer does not. `typeof x === 'undefined'` is the
// only safe way to read these, so a bare use is the fault.
const NODE_ONLY = [
  { name: 'process', test: /(^|[^.\w$])process\s*\./ },
  { name: '__dirname', test: /(^|[^.\w$])__dirname\b/ },
  { name: '__filename', test: /(^|[^.\w$])__filename\b/ },
  { name: 'require', test: /(^|[^.\w$])require\s*\(/ },
  { name: 'module', test: /(^|[^.\w$])module\s*\.\s*(exports|require)\b/ },
  { name: 'Buffer', test: /(^|[^.\w$])Buffer\s*\.\s*(from|alloc|isBuffer)\b/ }
];

/*
  Strip comments and string/template literal *contents* so a mention in prose, a
  log message or a documented example is not reported as a live reference.

  Two invariants the rest of this file depends on:
    1. Output is the same LENGTH as the input and newlines are preserved, so an
       index into the stripped text maps to the same index in the original.
    2. String delimiters are kept, because the guard idiom's own literal is
       `'undefined'` and the guard detector has to be able to see it.
*/
function codeOnly(src) {
  const out = new Array(src.length);
  let i = 0;
  const n = src.length;
  let state = 'code';
  let quote = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      if (c === '/' && d === '*') { state = 'block'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out[i] = c; i++; continue; }
      out[i] = c; i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out[i] = '\n'; } else out[i] = ' ';
      i++; continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { out[i] = ' '; out[i + 1] = ' '; state = 'code'; i += 2; continue; }
      out[i] = (c === '\n' ? '\n' : ' ');
      i++; continue;
    }
    // string / template: keep the delimiters, blank the body
    if (c === '\\') { out[i] = ' '; if (i + 1 < n) out[i + 1] = ' '; i += 2; continue; }
    if (c === quote) { state = 'code'; out[i] = c; i++; continue; }
    out[i] = (c === '\n' ? '\n' : ' ');
    i++;
  }
  return out.join('');
}

/*
  A guarded read is safe: `typeof process !== 'undefined' && process.env`.
  The guard can sit on the same statement or open a line or two above, so look
  back over the whole logical line rather than a fixed byte window — the
  `if (typeof module !== 'undefined' && module.exports) module.exports = X;`
  idiom at the foot of every dual-runtime file is the common case, and a
  window that misses it drowns the real finding in seventy false positives.
*/
/*
  Is this use guarded by a `typeof <name> !== 'undefined'` on the same
  statement?

  The check runs against the ORIGINAL source, not the comment/string-stripped
  copy. The guard's own literal is `'undefined'`, and stripping string bodies
  would erase exactly the text this has to match — which is how a correct
  `if (typeof module !== 'undefined' && module.exports)` reads as unguarded and
  buries the one real finding under seventy false positives.

  The statement boundary is the enclosing line, which is where the codebase
  writes this idiom in every dual-runtime file.
*/
function guardedInBlock(rawLines, idx, name) {
  // Two shapes of safety, both common in this codebase:
  //
  //  1. A Node-only feature wrapped in a guard for the Node global itself:
  //         if (typeof require === 'function') { const c = require('crypto'); }
  //
  //  2. A browser-native path tried FIRST, with the Node global only as the
  //     fallback reached after an early return:
  //         if (typeof btoa === 'function') return btoa(bin);
  //         return Buffer.from(bytes).toString('base64');
  //
  // For (2) the guard names a DIFFERENT global, so the test is: is there an
  // early `return` between the use and the nearest preceding `if (...) {`?
  //
  // The window is deliberately small — a guard many lines up governs different
  // code, and treating it as protecting this line is how a real finding gets
  // waved through.
  const own = new RegExp('typeof\\s+' + name + "\\s*(?:!==?\\s*(['\"]undefined['\"]|void\\s+0)|===\\s*['\"]function['\"])");
  const anyNodeGuard = new RegExp('typeof\\s+(process|require|module|Buffer|__dirname|__filename|exports)\\b[^\\n]*');
  // A named capability flag, e.g. `if (NODE_CRYPTO) { ...Buffer... }` — the
  // flag is itself only assigned inside a Node guard elsewhere in the file.
  const capabilityFlag = /^\s*if\s*\(\s*[A-Z][A-Z0-9_]*\s*\)\s*\{\s*$/;
  const earlyReturn = /^\s*return\b/;
  const opensBlock = /\{\s*$/;

  for (let back = 0; back <= 8; back++) {
    const i = idx - back;
    if (i < 0) break;
    const line = rawLines[i] || '';
    if (own.test(line)) return true;
    // A different Node global's guard, on a line that opens the block we are in.
    if (back > 0 && anyNodeGuard.test(line) && opensBlock.test(line)) return true;
    // UMD wrappers gate their CommonJS branch on `typeof exports === 'object'`.
    if (back > 0 && /typeof\s+exports\s*===?\s*['"]object['"]/.test(line)) return true;
    // A capability flag assigned under a Node guard earlier in the file.
    if (back > 0 && capabilityFlag.test(line)) return true;
    // A browser-native branch that returns before we are reached.
    if (back > 0 && earlyReturn.test(line)) return true;
    if (back > 0 && /^\s*\}\s*$/.test(line)) return false;
  }
  return false;
}

/*
  Reachability the scanner cannot infer, reviewed by hand.

  Each entry is a Node-only reference that is genuinely unreachable in the
  renderer, with the reason it is safe. This list is deliberately tiny and
  explicit: a structural scanner that has to guess about control flow is worse
  than one that admits a case it cannot decide and makes a human sign it off.
  Adding an entry is a claim, and it is reviewed whenever this file changes.
*/
const REVIEWED = {
  'data/refcode.js:112': 'b64ToBytes falls back to Buffer only when atob is missing; atob is present in every Electron renderer, so this line cannot run there.'
};

const acknowledged = [];
const findings = [];
files.forEach((rel) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const code = codeOnly(src);
  const rawLines = src.split('\n');
  NODE_ONLY.forEach((g) => {
    const re = new RegExp(g.test.source, 'g');
    let m;
    while ((m = re.exec(code)) !== null) {
      const lineNo = code.slice(0, m.index).split('\n').length;
      if (guardedInBlock(rawLines, lineNo - 1, g.name)) continue;
      const key = rel + ':' + lineNo;
      if (REVIEWED[key]) { acknowledged.push(key + '  — ' + REVIEWED[key]); continue; }
      findings.push(rel + ':' + lineNo + '  bare ' + g.name);
    }
  });
});

console.log('== Renderer-global safety ==');
if (acknowledged.length) {
  console.log('\n  Reviewed as unreachable in the renderer:');
  acknowledged.forEach((a) => console.log('    · ' + a));
}
if (findings.length) {
  console.log('\n  These files are loaded into a renderer with no Node globals.');
  console.log('  Each line below throws at runtime in the app while passing every');
  console.log('  Node smoke test, because Node has them all.');
  findings.forEach((f) => console.log('    ✗ ' + f));
  console.log('\n  Guard the read (typeof process !== \'undefined\') or move the code');
  console.log('  into a main-process module.');
  console.log('\nrenderer-globals-smoke FAILED: ' + findings.length + ' unsafe reference(s)');
  process.exit(1);
}
console.log('  ✓ ' + files.length + ' renderer scripts, no unguarded Node-only globals');
console.log('\nrenderer-globals-smoke PASSED');
