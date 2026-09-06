#!/usr/bin/env node
// ============================================================
// PallettAI Studio — release gate (npm run release:check)
// ------------------------------------------------------------
// Run before tagging a release. Fails (exit 1) on any error:
//   1. Syntax-checks every shipped .js file (app/main/preload/
//      server + data/** + modules/**).
//   2. Boots scripts/mock-supabase.js itself on :54321 and runs
//      the registry-backed smoke suites against it:
//        supabase-smoke.js · streak-smoke.js · credit-smoke.js
//      plus the offline ai-features-smoke.js.
//   3. Exercises the ZIP export writer's safety/limits.
//   4. Compiles a representative project through the builder
//      (single + multi-page output, SEO extras) and asserts the
//      generated HTML is well-formed enough to ship.
// No network access and no external services are required.
// ============================================================

'use strict';

const { spawn, spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const MOCK_PORT = Number(process.env.MOCK_PORT || 54321);

let failures = 0;
const fail = (msg) => { failures++; console.error('  ✗ ' + msg); };
const pass = (msg) => console.log('  ✓ ' + msg);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================
// 1. Syntax-check every shipped .js file
// ============================================================
console.log('== 1. Syntax-check every shipped .js ==');

const TOP_LEVEL = ['app.js', 'main.js', 'preload.js', 'server.js'];
const SHIPPED_DIRS = ['data', 'modules'];

const shippedFiles = [];
for (const f of TOP_LEVEL) {
  const abs = path.join(ROOT, f);
  if (fs.existsSync(abs)) shippedFiles.push(abs);
  else fail('missing shipped file: ' + f);
}
for (const d of SHIPPED_DIRS) {
  const abs = path.join(ROOT, d);
  if (!fs.existsSync(abs)) { fail('missing shipped directory: ' + d); continue; }
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.js')) shippedFiles.push(p);
    }
  };
  walk(abs);
}

for (const file of shippedFiles) {
  const r = spawnSync(NODE, ['--check', file], { encoding: 'utf8' });
  if (r.status === 0) pass('syntax ' + path.relative(ROOT, file));
  else {
    fail('syntax ' + path.relative(ROOT, file));
    if (r.stderr) process.stdout.write(r.stderr);
  }
}

// ============================================================
// 2. Boot the mock registry + run the smoke suites
// ============================================================
console.log('\n== 2. Registry smoke suites (self-hosted mock) ==');

function bootMock(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, [path.join(ROOT, 'scripts', 'mock-supabase.js')], {
      cwd: ROOT,
      env: { ...process.env, MOCK_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { out += String(d); });
    const deadline = Date.now() + 15000;
    const attempt = () => {
      if (child.exitCode !== null) {
        reject(new Error('mock registry exited early:\n' + out));
        return;
      }
      fetch('http://127.0.0.1:' + port + '/__state')
        .then(() => resolve(child))
        .catch(() => {
          if (Date.now() > deadline) { reject(new Error('mock registry did not become ready:\n' + out)); return; }
          setTimeout(attempt, 200);
        });
    };
    attempt();
  });
}

const SMOKES = [
  ['scripts/supabase-smoke.js', 'Supabase registry smoke'],
  ['scripts/streak-smoke.js', 'Daily streak smoke'],
  ['scripts/credit-smoke.js', 'AI credit smoke'],
  ['scripts/ai-features-smoke.js', 'AI features smoke']
];

function runScript(args, label) {
  try {
    execFileSync(NODE, args, { cwd: ROOT, stdio: 'inherit' });
    pass(label);
  } catch (e) {
    fail(label + ' (exit ' + e.status + ')');
  }
}

async function runSmokeSuites() {
  let mock = null;
  try {
    mock = await bootMock(MOCK_PORT);
    pass('mock registry up on :' + MOCK_PORT);
  } catch (e) {
    fail('could not boot mock registry: ' + e.message);
    return;
  }
  for (const [script, label] of SMOKES) runScript([script], label);
  try { mock.kill(); } catch (e) { /* already gone */ }
}

// ============================================================
// 3. ZIP export limits (modules/zip.js)
// ============================================================
function checkZipLimits() {
  console.log('\n== 3. ZIP export limits ==');
  let ZIP;
  try {
    ZIP = require(path.join(ROOT, 'modules', 'zip.js'));
  } catch (e) {
    fail('zip.js could not be loaded: ' + e.message);
    return;
  }
  const throws = (label, fn, match) => {
    try {
      fn();
      fail(label + ' — expected an error');
    } catch (e) {
      if (match && !String(e.message || e).includes(match)) fail(label + ' — wrong error: ' + e.message);
      else pass(label);
    }
  };
  throws('rejects more than 512 entries', () => {
    const entries = Array.from({ length: 513 }, (_, i) => ({ name: 'f' + i + '.txt', content: 'x' }));
    ZIP.zipFiles(entries);
  }, 'too many files');
  throws('rejects unsafe paths', () => ZIP.zipFiles([{ name: '../escape.txt', content: 'x' }]), 'unsafe file path');
  throws('rejects oversized single file (>12 MB)', () => {
    ZIP.zipFiles([{ name: 'big.bin', content: 'a'.repeat(13 * 1024 * 1024) }]);
  }, 'larger than 12 MB');
  try {
    const bytes = ZIP.zipFiles([{ name: 'ok.txt', content: 'hello' }, { name: 'nested/x.html', content: '<p>hi</p>' }]);
    const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (head === 'PK\u0003\u0004') pass('valid small archive builds (PK signature)');
    else fail('valid archive has unexpected header: ' + JSON.stringify(head));
  } catch (e) {
    fail('valid small archive threw: ' + e.message);
  }
}

// ============================================================
// 4. Builder output compilation (modules/builder.js)
// ============================================================
function checkBuilder() {
  console.log('\n== 4. Builder output compilation ==');
  let DB, ONLINE, Builder;
  try {
    DB = require(path.join(ROOT, 'data', 'db.js'));
    ONLINE = require(path.join(ROOT, 'data', 'online.js'));
    global.DB = DB;
    global.ONLINE = ONLINE;
    Builder = require(path.join(ROOT, 'modules', 'builder.js'));
  } catch (e) {
    fail('builder dependencies could not be loaded: ' + e.message);
    return;
  }
  const assert = (cond, msg) => (cond ? pass(msg) : fail(msg));
  const project = {
    id: 'release-check', name: 'QA Compile Site', suites: [],
    site: {
      name: 'QA Compile Site', tagline: 'Compiles cleanly', palette: 'midnight', font: 'inter',
      url: 'https://qa.example.com',
      sections: [
        { type: 'hero', id: 's-hero', title: 'Hello QA', text: 'Builds clean.' },
        { type: 'features', id: 's-feat', title: 'Features', items: [{ icon: '⚡', title: 'Fast', text: 'Yes' }] },
        { type: 'contact', id: 's-contact', title: 'Contact' }
      ],
      design: { containerWidth: 1140, radius: 20, spacing: 96 }
    }
  };
  const settings = { onlineEnabled: false };
  try {
    const html = Builder.buildSiteHTML(project, settings);
    assert(typeof html === 'string' && html.length > 500, 'single-page build returns full HTML');
    assert(/<html/i.test(html) && /<\/html>/.test(html), 'output has a complete html document');
    assert(html.includes('Hello QA'), 'hero copy compiled into output');
    assert(html.includes('QA Compile Site'), 'site name compiled into output');
  } catch (e) {
    fail('buildSiteHTML threw: ' + e.message);
  }
  try {
    const pages = Builder.buildSitePages(project, settings);
    assert(Array.isArray(pages) && pages.length >= 1, 'multi-page build returns pages');
    assert(pages.every((p) => p.html && /<\/html>/.test(p.html)), 'every page compiles to a complete document');
  } catch (e) {
    fail('buildSitePages threw: ' + e.message);
  }
  try {
    const extras = Builder.seoExtras(project, settings);
    assert(extras.some((f) => f.name === 'robots.txt'), 'robots.txt generated');
    assert(extras.some((f) => f.name === 'sitemap.xml'), 'sitemap.xml generated when a live URL is set');
  } catch (e) {
    fail('seoExtras threw: ' + e.message);
  }
}

// ============================================================
// Run everything
// ============================================================
(async () => {
  await runSmokeSuites();
  checkZipLimits();
  checkBuilder();

  console.log('\n' + '='.repeat(60));
  if (failures) {
    console.log('RELEASE CHECK FAILED — ' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('RELEASE CHECK PASSED');
  process.exit(0);
})().catch((e) => {
  console.error('release gate crashed:', e);
  process.exit(1);
});