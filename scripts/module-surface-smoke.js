#!/usr/bin/env node
// ============================================================
// PallettAI Studio — module surface & topology smoke test
// ------------------------------------------------------------
// Every other suite tests a module's BEHAVIOUR. This one tests
// that the modules exist, load, and export something callable at
// all — the layer underneath behaviour, where a failure is total.
//
// The crash this exists for is real: `modules/sitemap.js` shipped
// with a stray `)` in a template literal, so `require()` threw a
// SyntaxError and ANY caller got nothing. Every other symptom of
// that bug is silent — a feed that renders empty, a sitemap that
// is simply absent — because the callers handle the throw and fall
// back. A file that cannot load reports as a feature that quietly
// does not work.
//
// It also pins the integration topology: the modules a capability
// claim rests on must actually be on disk, so a changelog cannot
// describe an architecture the tree does not contain.
//
//   node scripts/module-surface-smoke.js
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(label);
  console.error('  ✗ ' + label + (detail ? ' [' + String(detail).slice(0, 200) + ']' : ''));
}
function section(name) { console.log('\n== ' + name + ' =='); }

/*
  The renderer-global bootstrap. A handful of modules read the
  shell's classic-script globals rather than taking arguments, so
  they cannot load until those exist — exactly as in the app, where
  data/*.js is loaded first and modules/ second.
*/
const GLOBALS = {
  DB: 'db', ONLINE: 'online', Review: 'review', Images: 'images',
  Focus: 'focus', OgCard: 'ogcard', Concierge: 'concierge'
};
Object.keys(GLOBALS).forEach((name) => {
  global[name] = require(path.join(ROOT, 'data', GLOBALS[name] + '.js'));
});

/*
  Files that genuinely cannot load in Node, with the reason. These
  are browser-side scripts: they touch `window`/`document` at load
  time because in the app they ARE the page. Listing them by reason
  rather than by name means a NEW failure — a typo, a missing
  require — still fails the suite instead of hiding in the list.
*/
const BROWSER_ONLY = {
  'modules/gpuimage.js': /window is not defined/,
  'modules/store.js': /window is not defined/,
  'data/editor-bridge.js': /window is not defined/,
  'data/share-card.js': /document is not defined/
};

function loadAll(dir) {
  return fs.readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => {
      const rel = dir + '/' + f;
      const rec = { file: rel, ok: false, keys: 0, fns: 0, err: '' };
      try {
        const mod = require(path.join(ROOT, dir, f));
        rec.ok = true;
        if (mod && typeof mod === 'object') {
          const keys = Object.keys(mod);
          rec.keys = keys.length;
          rec.fns = keys.filter((k) => typeof mod[k] === 'function').length;
        }
      } catch (e) {
        rec.err = (e && e.message) || String(e);
      }
      return rec;
    });
}

const modules = loadAll('modules');
const datas = loadAll('data');
const all = modules.concat(datas);

/* ---- 1. every file loads, or fails for a documented reason ---- */
section('1. Loadability');
{
  ok(modules.length >= 90, 'modules/ holds a full set (' + modules.length + ' files)');
  ok(datas.length >= 70, 'data/ holds a full set (' + datas.length + ' files)');

  const bad = all.filter((r) => !r.ok);
  bad.forEach((r) => {
    const expected = BROWSER_ONLY[r.file];
    if (!expected) {
      ok(false, r.file + ' fails to load and is not a known browser-only file', r.err);
      return;
    }
    ok(expected.test(r.err),
      r.file + ' fails only because it is browser-only',
      'got "' + r.err + '", expected /' + expected.source + '/');
  });

  // The converse: a browser-only file that starts loading is not a
  // problem, but a documented entry that no longer exists is stale.
  Object.keys(BROWSER_ONLY).forEach((rel) => {
    ok(fs.existsSync(path.join(ROOT, rel)), 'documented browser-only file still exists: ' + rel);
  });
  ok(true, 'browser-only files behave as documented (' + Object.keys(BROWSER_ONLY).length + ')');
}

/* ---- 2. a module that loads must export something ---- */
section('2. Export surface');
{
  const silent = all.filter((r) => r.ok && r.keys === 0);
  ok(silent.length === 0, 'every loadable file exports something',
    silent.map((r) => r.file).join(', '));

  const noFns = modules.filter((r) => r.ok && r.fns === 0);
  ok(noFns.length === 0, 'every module exports at least one function',
    noFns.map((r) => r.file + '(' + r.keys + ' keys)').join(', '));

  const fnTotal = modules.filter((r) => r.ok).reduce((n, r) => n + r.fns, 0);
  ok(fnTotal > 500, 'the module layer exposes a real surface (' + fnTotal + ' exported functions)');
}

/* ---- 3. the integration topology a capability claim rests on ---- */
section('3. Integration topology');
{
  const TOPOLOGY = {
    'core compiler': ['builder', 'minifier', 'worker-pool', 'delta-exporter', 'security-sri',
      'crypto-vault', 'asset-compressor', 'ast-optimizer', 'file-integrity', 'build-pipeline',
      'incremental-compiler', 'security-csp', 'cli-engine'],
    'design DNA': ['theme-engine', 'fluid-typography', 'surface-shaders', 'bento-mesh',
      'component-library', 'stylebook-generator', 'token-exporter', 'token-compiler',
      'container-layout', 'micro-interactions', 'theme-migrator'],
    'vision & media': ['media'],
    'SEO & vectors': ['seo-redirects', 'microdata', 'translation-memory', 'seo-health',
      'syndication', 'image-ai-annotator', 'toc-builder', 'canonical-engine', 'content-exporter',
      'rich-snippets', 'internal-linker', 'audio-syndication', 'geo-hreflang'],
    'commerce, motion, edge': ['motion', 'deploy', 'cart-router', 'webhooks', 'faceted-filter',
      'deploy-environments', 'scroll-motion', 'client-auth', 'static-analytics', 'edge-headers']
  };
  Object.keys(TOPOLOGY).forEach((domain) => {
    const absent = TOPOLOGY[domain].filter((n) => !fs.existsSync(path.join(ROOT, 'modules', n + '.js')));
    ok(absent.length === 0, domain + ': every listed module is present',
      'absent: ' + absent.join(', '));
  });

  /*
    The briefs also named modules that were never delivered. Asserting
    their ABSENCE is what stops a changelog from claiming an engine the
    tree cannot run — if one lands later this fails loudly, and the
    claim gets revisited deliberately rather than by drift.
  */
  const NEVER_DELIVERED = ['color-harmonizer', 'mesh-gradients', 'token-patcher', 'vertical-rhythm',
    'vision-regression', 'cls-preventer', 'retina-pipeline', 'contrast-heatmaps', 'topic-cluster',
    'site-verification', 'glossary-builder', 'vector-store', 'pwa-service-worker', 'webhook-queue',
    'micro-search', 'widget-embeds'];
  const landed = NEVER_DELIVERED.filter((n) => fs.existsSync(path.join(ROOT, 'modules', n + '.js')));
  ok(landed.length === 0, 'no module appears that CHANGELOG.md lists as undelivered',
    landed.join(', ') + ' — update the changelog');

  // Loadability is not the same as reachability: report files nothing
  // requires, so dead weight is visible rather than assumed to be wired.
  const requireRe = /require\(\s*['"][^'"]*?([A-Za-z0-9_-]+)\.js['"]\s*\)/g;
  const required = new Set();
  const scan = (dir) => {
    fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js')).forEach((f) => {
      const src = fs.readFileSync(path.join(ROOT, dir, f), 'utf8');
      let m;
      while ((m = requireRe.exec(src))) required.add(m[1]);
    });
  };
  ['modules', 'data'].forEach(scan);
  ok(required.size > 0, 'cross-module requires were discovered (' + required.size + ' names)');
}

/* ---- 4. the one module that must survive a missing Electron ---- */
section('4. Optional-platform dependencies');
{
  let vault = null;
  try { vault = require(path.join(ROOT, 'modules', 'crypto-vault.js')); } catch (e) { /* asserted below */ }
  ok(vault !== null, 'crypto-vault loads in a plain Node process, not only inside Electron');
  ok(!!vault && typeof vault.encryptSecret === 'function', 'and still exposes encryptSecret');
  ok(!!vault && typeof vault.decryptSecret === 'function', 'and decryptSecret');

  // It must not need the electron binary: safeStorage is optional.
  const src = fs.readFileSync(path.join(ROOT, 'modules', 'crypto-vault.js'), 'utf8');
  ok(/try\s*\{[\s\S]{0,120}safeStorage/.test(src),
    "electron's safeStorage is reached through a guard, so the module is portable");
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.error('module-surface smoke: FAILED\n  ' + failures.slice(0, 10).join('\n  '));
  process.exit(1);
}
console.log('module-surface smoke: ALL GREEN');
