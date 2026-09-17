#!/usr/bin/env node
// ============================================================
// PallettAI Studio — global scope smoke test
// ------------------------------------------------------------
// This app loads a few dozen classic scripts into ONE global
// scope, so two files may not declare the same top-level name.
//
// The failure mode is the reason this exists: a `const` is a
// lexical declaration, so a duplicate is a SyntaxError for the
// WHOLE file — the script never runs, and every caller of it
// reports a fallback instead of an error. That happened in
// development with a name as ordinary as KINDS: the library-merge
// module silently ceased to exist, and the Database view showed
// every stored format as "unknown" while looking perfectly calm.
//
// A `function` duplicate is legal, which is worse: the last one
// loaded wins, so a file can quietly be running somebody else's
// implementation of a name it defined itself.
//
// So everything below reads the shell's own <script> list and
// compares the top-level declarations between files. Files that
// wrap themselves in an IIFE declare nothing and cannot collide.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function warn(msg) { console.log('  ! ' + msg); }

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [];
const tagRe = /<script\s+src="([^"]+)"><\/script>/g;
let m;
while ((m = tagRe.exec(html))) scripts.push(m[1]);

/*
  Blank out everything that is not at brace depth zero.

  Strings, template literals and comments are skipped as well as braces: a `{`
  inside a template literal is text, and counting it would silently swallow the
  declarations that follow. What is left is the file's true top level, where a
  declaration either collides with another file or does not.
*/
function topLevelSource(src) {
  let out = '';
  let brace = 0;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += ' ';
      i++;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') { out += '  '; i += 2; continue; }
        if (quote === '`' && ch === '$' && src[i + 1] === '{') {
          // A template expression can contain braces of its own; skip to its
          // matching close so its contents are not read as top level.
          let depth = 1;
          out += '  '; i += 2;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            out += src[i] === '\n' ? '\n' : ' ';
            i++;
          }
          continue;
        }
        if (ch === quote) { out += ' '; i++; break; }
        out += ch === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    if (c === '{') { brace++; out += ' '; i++; continue; }
    if (c === '}') { brace = Math.max(0, brace - 1); out += ' '; i++; continue; }
    out += brace === 0 ? c : (c === '\n' ? '\n' : ' ');
    i++;
  }
  return out;
}

function declarations(src) {
  const top = topLevelSource(src);
  const found = [];
  const add = (kind, name, at) => found.push({ kind, name, line: top.slice(0, at).split('\n').length });
  let r;
  const fn = /(?:^|[\s;}])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
  while ((r = fn.exec(top))) add('function', r[1], r.index);
  const cls = /(?:^|[\s;}])(?:class)\s+([A-Za-z_$][\w$]*)/g;
  while ((r = cls.exec(top))) add('class', r[1], r.index);
  const decl = /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  while ((r = decl.exec(top))) add(r[0].indexOf('const') > -1 ? 'const' : 'let/var', r[1], r.index);
  return found;
}

console.log('\n== 1. The shell lists its scripts ==');
const uniqueScripts = Array.from(new Set(scripts));
if (scripts.length >= 20) pass(scripts.length + ' script tags, ' + uniqueScripts.length + ' distinct files');
else fail('only ' + scripts.length + ' scripts were found — the <script> tag shapes probably changed');

console.log('\n== 2. No two files declare the same top-level name ==');
const owners = new Map();
const byFile = [];
uniqueScripts.forEach((rel) => {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { fail(rel + ' is listed in the shell and does not exist'); return; }
  const src = fs.readFileSync(file, 'utf8');
  const decls = declarations(src);
  byFile.push({ rel, decls });
  decls.forEach((d) => {
    const key = d.name;
    if (!owners.has(key)) owners.set(key, []);
    owners.get(key).push({ rel, ...d });
  });
});

let constClashes = 0;
let fnClashes = 0;
owners.forEach((list, name) => {
  if (list.length < 2) return;
  const files = Array.from(new Set(list.map((x) => x.rel)));
  if (files.length < 2) {
    const lexical = list.filter((x) => x.kind === 'const' || x.kind === 'let/var');
    if (lexical.length > 1) {
      constClashes++;
      fail(name + ' is declared ' + lexical.length + ' times at the top level of ' + files[0] + ' — a duplicate lexical declaration is a SyntaxError for the whole file');
    }
    return;
  }
  const lexical = list.filter((x) => x.kind === 'const' || x.kind === 'let/var');
  if (lexical.length) {
    constClashes++;
    fail(name + ' is a top-level ' + lexical[0].kind + ' in ' + files.join(' AND ') +
      ' — the later file would not run at all (SyntaxError: Identifier already declared)');
    return;
  }
  fnClashes++;
  warn(name + ' is a top-level function declared in ' + files.join(' AND ') + ' — the last file loaded wins, silently');
});

if (!constClashes) pass('no top-level const/let is declared by two files');
if (!fnClashes) pass('no top-level function is declared twice');

console.log('\n== 3. The modules this area added cannot collide ==');
// These four are the new/local-database files. Each must be self-contained:
// a data module that declares `plan`, `bytes` or `parse` at global scope is one
// name away from the failure above, and the fix is structural, not careful.
['data/schema.js', 'data/revs-policy.js', 'data/library-merge.js', 'modules/store.js'].forEach((rel) => {
  const entry = byFile.find((f) => f.rel === rel);
  if (!entry) { fail(rel + ' is not loaded by the shell at all'); return; }
  const leaked = entry.decls.filter((d) => d.kind !== 'function');
  if (!leaked.length) pass(rel + ' declares nothing at global scope (IIFE-wrapped)');
  else fail(rel + ' leaks top-level ' + leaked.map((d) => d.kind + ' ' + d.name).join(', ') + ' into the shared scope');
  const assign = new RegExp('window\\.[A-Za-z]+\\s*=');
  assert(assign.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')), rel + ' exports itself on window instead');
});

function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

console.log('\n== 4. The modules are actually present when the app needs them ==');
// Ordering matters as much as declaring: a module referenced at boot must be
// loaded before app.js, and the shell is the only place that decides that.
const appIdx = uniqueScripts.indexOf('app.js');
['data/schema.js', 'data/revs-policy.js', 'data/library-merge.js', 'modules/store.js'].forEach((rel) => {
  const i = uniqueScripts.indexOf(rel);
  assert(i >= 0 && i < appIdx, rel + ' loads before app.js');
});

if (failed) {
  console.error('\nglobal-scope-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nglobal-scope-smoke PASSED');
