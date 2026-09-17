#!/usr/bin/env node
// ============================================================
// PallettAI Studio — release gate (npm run release:check)
// ------------------------------------------------------------
// Run before tagging a release. Fails (exit 1) on any error:
//   1. Syntax-checks every shipped .js file (app/main/preload/
//      server + data/** + modules/**).
//   2. Runs scripts/security-hardening-smoke.js (offline).
//   3. Boots scripts/mock-supabase.js itself on :54321 and runs
//      the registry-backed smoke suites against it:
//        supabase-smoke.js · streak-smoke.js · credit-smoke.js
//      plus the offline ai-features-smoke.js.
//   4. Exercises the ZIP export writer's safety/limits.
//   5. Compiles a representative project through the builder
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
  ['scripts/vault-smoke.js', 'Cloud vault smoke'],
  ['scripts/streak-smoke.js', 'Daily streak smoke'],
  ['scripts/credit-smoke.js', 'AI credit smoke'],
  ['scripts/ai-features-smoke.js', 'AI features smoke'],
  ['scripts/ai-brief-smoke.js', 'AI brief smoke'],
  ['scripts/ai-niche-smoke.js', 'AI niche smoke'],
  ['scripts/ai-followup-smoke.js', 'AI follow-up smoke'],
  // Scope and constraints: how much of the page a sentence covers, and what it
  // says must stay. Both failures are silent — a dropped target and an ignored
  // "but keep the words" each end with a confident report and the wrong site.
  ['scripts/ai-scope-smoke.js', 'AI scope & constraints smoke'],
  // Targeted revert: putting one named change back without taking the changes
  // after it. Mostly a test of what must SURVIVE the revert.
  ['scripts/revert-smoke.js', 'Copilot targeted-revert smoke'],
  // The planner and the executor are separate files with no shared type, so an
  // op added on one side and forgotten on the other is invisible until a client
  // hits it.
  ['scripts/copilot-ops-smoke.js', 'Copilot op wiring smoke'],
  ['scripts/copy-edit-smoke.js', 'Copy-edit intent smoke'],
  ['scripts/intent-polarity-smoke.js', 'Intent polarity smoke'],
  ['scripts/ai-translate-smoke.js', 'AI translate smoke'],
  ['scripts/translate-budget-smoke.js', 'Translation request-budget smoke'],
  ['scripts/outbound-pacing-smoke.js', 'Outbound retry pacing smoke'],
  ['scripts/ai-fingerprint-smoke.js', 'AI fingerprint smoke'],
  ['scripts/ai-photos-smoke.js', 'AI photo ranker smoke'],
  ['scripts/ai-compose-smoke.js', 'AI compose smoke'],
  // The wording engine: two clients in one industry must never be handed
  // word-for-word identical sites, and a client's own proofs must drive copy.
  ['scripts/copy-smoke.js', 'Copy engine smoke'],
  ['scripts/copilot-smoke.js', 'Copilot reasoning smoke'],
  ['scripts/copilot-repeat-smoke.js', 'Copilot repeat & positional targeting smoke'],
  ['scripts/vision-smoke.js', 'Copilot render audit smoke'],
  ['scripts/palette-lab-smoke.js', 'Palette Lab smoke'],
  ['scripts/briefs-smoke.js', 'Saved briefs smoke'],
  // Offline and self-contained: guards determinism, palette binding and the size
  // budgets of the exported artwork.
  ['scripts/signature-smoke.js', 'Signature artwork smoke'],
  ['scripts/motion-smoke.js', 'Scroll-linked motion smoke'],
  ['scripts/review-smoke.js', 'Client review loop smoke'],
  ['scripts/applynote-smoke.js', 'Apply-a-note resolver smoke'],
  ['scripts/changenote-smoke.js', 'Client changelog smoke'],
  ['scripts/perf-smoke.js', 'Performance proof smoke'],
  ['scripts/publish-smoke.js', 'Publish providers smoke'],
  ['scripts/release-notes-smoke.js', 'What\u2019s New registry smoke'],
  ['scripts/revdiff-smoke.js', 'Revision diff smoke'],
  ['scripts/suites-reviews-events-smoke.js', 'Reviews & Events suites smoke'],
  ['scripts/client-handoff-smoke.js', 'Client handoff editor smoke'],
  // Two themed suites rather than one file per module: these modules are
  // cross-cutting changes to the artefact the client receives, and their
  // failures are shared — a builder that emits a broken tag breaks all of them.
  ['scripts/export-polish-smoke.js', 'Export polish smoke (images, focus, cards, 404)'],
  ['scripts/delivery-proof-smoke.js', 'Delivery proof smoke (copy, links, tokens, manifest)'],
  // A CC-BY photo shipped without its credit is a licence breach, and the block
  // has two ways to fail: not rendered when it must be, and rendered from a
  // creator's name without escaping it. This suite was written and then left out
  // of this list, so it never ran — a guard that is not wired in is not a guard.
  ['scripts/image-credits-smoke.js', 'Image credits smoke (licence attribution, escaping)'],
  // Site care judges content, not construction, so its suite is mostly about
  // what it REFUSES to flag — a maintenance report that cries wolf is ignored.
  ['scripts/sitecare-smoke.js', 'Site care smoke (stale, placeholder, demo content)'],
  // The badge writes a user's own referral code into every site they sell, so
  // the suite is as much about it not being a way IN as about the link working.
  ['scripts/badge-attribution-smoke.js', 'Attribution badge smoke'],
  // The offline referral path is the one place a code is trusted without the
  // registry, so its suite is mostly about codes that must NOT pass.
  ['scripts/refcode-smoke.js', 'Offline referral-code smoke'],
  // Pre-flight stands between a project and a live URL, so its suite is split
  // between what it must stop and what it must not: a gate that blocks a good
  // site teaches the creator to click past it.
  ['scripts/preflight-smoke.js', 'Pre-flight smoke (publish blockers, link resolution)'],
  // Animated artwork ends up inlined on a client's live site, so its suite is
  // about what may NOT move (no filter, no transform-origin, nothing outside
  // prefers-reduced-motion) as much as about what does.
  ['scripts/animated-art-smoke.js', 'Animated artwork smoke (motion safety, scoping)'],
  // Splitting a sentence into instructions is dangerous, so this suite is
  // weighted towards what must NOT split — and towards proving a compound plan
  // invents nothing the clauses did not already carry.
  ['scripts/compound-intent-smoke.js', 'Compound intent smoke (what splits, what refuses)'],
  // The startup splash duplicates the app's palette by hand — it is a data: URL
  // loaded before the renderer exists, so it cannot import styles.css. Anything
  // duplicated by hand rots, and this one had: it was still wearing the entire
  // pre-rebrand violet. The suite checks every colour back against styles.css
  // rather than snapshotting them, so it fails on a palette change either side.
  ['scripts/brand-splash-smoke.js', 'Brand & startup-splash smoke (palette drift, theme)'],
  // A view is wired in four files, and three out of four is a nav item that
  // opens nothing. This checks the wiring, that every class the new Site Care
  // screen emits has a style, and that the fields it reads exist on a real
  // audit report — three silent failures that no engine test can see.
  ['scripts/sitecare-view-smoke.js', 'Site Care view smoke (wiring, classes, contract)'],
  // Every starter promises a different site, not the same page in a different
  // colour. The suite reads three layers because they fail separately: the data
  // (two templates sharing a skeleton), the layout catalog (a template naming a
  // variant that does not exist renders the classic shape in silence), and the
  // compiled export (a variant that falls through to a default is invisible to
  // both of the others).
  ['scripts/template-diversity-smoke.js', 'Template diversity smoke (skeletons, vocabulary, compiled output)'],
  // The other half of that promise: what the generator invents, rather than
  // what the starters ship. Same complaint, different producer.
  ['scripts/ai-diversity-smoke.js', 'AI diversity smoke (generated sites must not collapse onto one look)'],
  ['scripts/dashboard-refresh-smoke.js', 'Dashboard refresh smoke (delete/create/duplicate keep the list current)'],
  // Both of these features live inside the exported file, so their suite runs the
  // SHIPPED scripts against a stub DOM and compares the emitted matcher with the
  // studio's verdict by verdict. It also pins the two things a knowledge pack
  // makes newly dangerous: free text reaching an inline script, and page weight.
  ['scripts/concierge-schedule-smoke.js', 'Concierge & self-scheduling smoke (export behaviour)'],
  // Both growth features end in an external handoff — a client-facing button
  // on every page, and a register record applied to briefs and contact fields
  // — so the suite checks real exports with/without the button, stubs the
  // register, and cross-checks the three files every online source straddles.
  ['scripts/growth-links-smoke.js', 'Growth links smoke (WhatsApp, Companies House)'],
  // macOS installs an update only once the app process is gone, and
  // electron-updater never asks it to leave — so the exit is ours to perform.
  // Getting that wrong strands every installed copy behind a splash it cannot
  // dismiss, which is exactly what shipped in 0.4.5. The suite runs the helper
  // against a fake electron app, because this failure is about the ORDER of
  // side effects and reading the source cannot see it.
  ['scripts/updater-exit-smoke.js', 'Updater exit smoke (the app must leave for an update to install)'],
  // Two claims made to a visitor, so the suite is mostly negative: a consent
  // gate that is not really a gate, and a policy that names a service the site
  // does not use, both look correct in a browser and are false in writing.
  ['scripts/legal-pages-smoke.js', 'Legal pages & consent smoke (accurate policy, real cookie gate)']
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
    // Generates the hero artwork, so the compiled output here is the same shape
    // as a real export rather than one with the artwork silently missing.
    global.Signature = require(path.join(ROOT, 'data', 'signature.js'));
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
  runScript(['scripts/security-hardening-smoke.js'], 'Security hardening smoke');
  // The Database panel's live sources span three files that cannot see each
  // other — the fetch URL (data/online.js), the CSP allowlist that decides
  // whether the renderer may make it (index.html), and the button that runs it
  // (app.js). Every way of getting that wrong is silent, and two of them had
  // shipped: a fetch blocked by the CSP reports "no results", and a source with
  // no button is a card with nothing on it.
  runScript(['scripts/online-sources-smoke.js'], 'Online sources smoke (CSP, panel wiring, payload shapes)');
  // modules/store.js is the local database — every project, snapshot, asset and
  // preset goes through it — and it had no suite at all because Node has no
  // indexedDB. It runs here against scripts/fake-indexeddb.js, which is written
  // to be unkind in the ways the real implementation is. Included because a
  // store whose bugs only appear in the packaged app is a store that ships them.
  runScript(['scripts/store-smoke.js'], 'Local store smoke (writes, recovery, usage, integrity)');
  // Every script in the shell shares one global scope. A duplicate top-level
  // `const` is a SyntaxError for the WHOLE file — the script silently never runs
  // and its callers report a fallback — and a duplicate `function` is legal but
  // the last file loaded wins, so a module can be running somebody else's
  // implementation of a name it defined itself. Both had shipped.
  runScript(['scripts/global-scope-smoke.js'], 'Global scope smoke (duplicate declarations across scripts)');
  // The `.v1` suffix on every stored key was a naming accident, not a version,
  // so a change to the shape of a project had two honest outcomes: keep the old
  // shape forever, or lose what people made. This asserts that the registry is
  // real, that migrations refuse rather than half-convert, and that a version is
  // only advanced AFTER the migrated value has committed.
  runScript(['scripts/schema-smoke.js'], 'Store format registry smoke (versions, migrations, order)');
  // Autosave history is the largest thing a creator stores and nothing pruned
  // it. The policy is pure and clock-injected, so the promise it makes — the
  // newest snapshot of a project is never dropped, by any rule — is asserted
  // here rather than asserted in a comment.
  runScript(['scripts/revs-policy-smoke.js'], 'Autosave retention smoke (age, count, byte budget)');
  // Restoring a backup used to overwrite everything and reload, which loses the
  // work the backup existed to protect whenever the file comes from a second
  // machine. Merging is now the default direction, and the rule it must keep —
  // nothing that exists only on one side is dropped — is checked key by key.
  runScript(['scripts/library-merge-smoke.js'], 'Library merge smoke (backup inspection, union, replace)');
  runScript(['scripts/templates-view-smoke.js'], 'Templates view smoke');
  runScript(['scripts/streak-placement-smoke.js'], 'Streak placement smoke');
  runScript(['scripts/dodo-checkout-smoke.js'], 'Dodo checkout smoke');
  runScript(['scripts/proplus-perks-smoke.js'], 'Pro+ perks smoke');
  runScript(['scripts/dodo-entitlement-smoke.js'], 'Dodo entitlement smoke');
  runScript(['scripts/registry-connect-smoke.js'], 'Registry connect smoke');
  runScript(['scripts/account-panel-smoke.js'], 'Account panel smoke');
  runScript(['scripts/plan-receipt-smoke.js'], 'Plan receipt smoke');
  runScript(['scripts/command-palette-smoke.js'], 'Command palette smoke');
  runScript(['scripts/modal-focus-smoke.js'], 'Modal focus smoke');
  runScript(['scripts/studio-chrome-smoke.js'], 'Studio chrome smoke');
  runScript(['scripts/chrome-registry-smoke.js'], 'Chrome registry smoke');
  runScript(['scripts/release-guard-smoke.js'], 'Release guard smoke');
  runScript(['scripts/review-reward-smoke.js'], 'Review reward smoke');
  runScript(['scripts/ai-studio-upgrade-smoke.js'], 'AI Studio upgrade smoke');
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