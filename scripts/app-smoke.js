'use strict';

/*
  The real-app smoke.

  Every other suite in this project runs in Node. Node is not the runtime
  Studio ships in: the renderer has no `process`, no `require` and no
  IntersectionObserver, and every one of those is a live difference rather
  than a theoretical one. That gap is not academic — a single debug line
  reading `process.env` made site generation throw on every run, passed
  all 135 Node suites, shipped in 0.4.14, and was found by a user.

  This suite closes the gap for the one path that matters most. It boots the
  actual application, clicks the actual button, and checks what the user
  would see: a project, a rendered preview, and a credit that was spent
  rather than refunded.

  It is deliberately narrow. One flagship path, driven for real, beats a
  broad suite that mocks the runtime that keeps breaking.
*/

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(__dirname, 'app-smoke-hook.js');
// The entry MUST sit at the project root. Electron sets app.getAppPath() to
// the directory of the script it is given, and main.js's loadFile('index.html')
// resolves against that — so a driver in scripts/ makes the real app look for
// scripts/index.html and fail to boot. Verified empirically, not assumed.
const ENTRY = path.join(ROOT, '.app-smoke-entry.js');

let passed = 0;
const failures = [];
function ok(name, condition, detail) {
  if (condition) { passed++; console.log('  ✓ ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

/*
  Electron writes a wall of GPU/EGL noise on machines without hardware
  acceleration — which is every headless CI runner. That noise is not a
  failure and must not be mistaken for one, so it is filtered out of the
  child's output. Everything else is passed through untouched, because a real
  error is the whole point of running this.
*/
const NOISE = /EGL|GLDisplay|viz_main_impl|gl_display|gl_initializer|task_policy_set|Failed to connect to the bus|dbus|libva|DevTools listening/;

function run() {
  return new Promise((resolve) => {
    // Read the binary path from electron's path.txt rather than requiring the
    // module. `require('electron')` returns the executable path ONLY when it
    // detects it is being required as a module — which it cannot do from a
    // plain Node process, and attempting it installs Electron's own shims into
    // this process and silently breaks the harness.
    //
    // path.txt is written by Electron's postinstall, which npm skips when it
    // is told not to run scripts. CI environments sometimes set that, and
    // electron-builder downloads the binary on demand instead. So: try the
    // documented locations, and if none exists, say precisely what is missing
    // rather than failing with an opaque ENOENT.
    const candidates = [];
    const distDir = path.join(ROOT, 'node_modules', 'electron', 'dist');
    try {
      const rel = fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'path.txt'), 'utf8').trim();
      if (rel) candidates.push(path.join(distDir, rel));
    } catch (e) { /* no path.txt — fall through to the known layouts */ }
    if (process.platform === 'darwin') {
      candidates.push(path.join(distDir, 'Electron.app', 'Contents', 'MacOS', 'Electron'));
    } else if (process.platform === 'win32') {
      candidates.push(path.join(distDir, 'electron.exe'));
    } else {
      candidates.push(path.join(distDir, 'electron'));
    }

    const electronBin = candidates.find((p) => fs.existsSync(p));
    if (!electronBin) {
      resolve({
        code: null,
        out: '',
        timedOut: false,
        error: 'the Electron binary is not installed at any of: ' + candidates.join(', ')
          + '\n     Electron downloads its binary in a postinstall script. If npm was'
          + ' told to skip scripts, run: node node_modules/electron/install.js'
      });
      return;
    }

    // ELECTRON_RUN_AS_NODE is deliberately NOT set. It is present in some CI
    // images and would make the binary behave as plain Node, loading the
    // driver as a script with no Electron runtime at all.
    // A throwaway userData directory. The app persists projects in Electron's
    // profile, so reusing the real one means the test inherits the user's
    // projects — and then silently measures the free plan's project cap
    // instead of the generator. Every run starts empty.
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pallettai-smoke-'));

    const env = Object.assign({}, process.env, {
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      PALLETTAI_SMOKE_HOOK: HOOK
    });
    delete env.ELECTRON_RUN_AS_NODE;

    // A root-level entry that installs the observer and then hands over to the
    // real main.js, so the app boots with the project root as its app path —
    // identical to `npm start` and to a packaged build.
    fs.writeFileSync(ENTRY, [
      "'use strict';",
      '// Generated by scripts/app-smoke.js. Installs the observer, then boots the',
      '// real application entry. Nothing about the app is replaced.',
      "require(" + JSON.stringify(HOOK) + ');',
      "require(" + JSON.stringify(path.join(ROOT, 'main.js')) + ');',
      ''
    ].join('\n'));

    const child = spawn(electronBin, [ENTRY, '--user-data-dir=' + profile], {
      cwd: ROOT,
      env: env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let out = '';
    const collect = (buf) => {
      const text = String(buf);
      out += text;
      text.split('\n').forEach((line) => {
        if (line.trim() && !NOISE.test(line)) process.stdout.write('    ' + line + '\n');
      });
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    child.on('error', (e) => { out += '\nSPAWN_ERROR ' + e.message; });

    // A hung renderer must not hang the gate. Three minutes is generous; a
    // real generation completes in a couple of seconds.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      cleanup();
      resolve({ code: null, out, timedOut: true });
    }, 180000);

    const cleanup = () => {
      // The entry is scratch, not a source file — remove it whatever happens,
      // and take the throwaway profile with it.
      try { fs.unlinkSync(ENTRY); } catch (e) { /* already gone */ }
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    };

    child.on('close', (code) => {
      clearTimeout(timer);
      cleanup();
      resolve({ code, out, timedOut: false });
    });
  });
}

/*
  A receipt, so "the smoke ran" is a fact rather than an assumption.

  A gate that passes because it silently tested nothing is worse than no gate:
  it manufactures confidence. The release check treats a missing receipt as a
  failure, which is the only way to tell "green because the app works" from
  "green because nothing executed".
*/
const RECEIPT = path.join(ROOT, '.app-smoke-receipt.json');
function writeReceipt(payload) {
  try { fs.writeFileSync(RECEIPT, JSON.stringify(payload, null, 2) + '\n'); } catch (e) { /* best effort */ }
}

(async () => {
  console.log('== Real-app smoke (boots Electron, drives the actual UI) ==\n');
  const { code, out, timedOut, error } = await run();

  if (error) {
    console.log('  ✗ ' + error);
    writeReceipt({ ran: false, passed: 0, failed: 1, reason: error });
    console.log('\napp-smoke FAILED: the real app could not be launched');
    process.exit(1);
  }

  if (timedOut) {
    console.log('\n  ✗ the app did not finish within 180s — it hung or the renderer never painted');
    failures.push('app smoke timed out');
  }

  // The child prints a machine-readable result block; parse rather than grep
  // prose, so a passing word in an error message cannot fake a pass.
  const m = out.match(/SMOKE_RESULT (\{[\s\S]*?\})\s*SMOKE_END/);
  let appResult = {};
  if (!m) {
    console.log('\n  ✗ the app produced no result block — it almost certainly crashed on load');
    console.log('    (this is itself a release blocker: the app must boot)');
    failures.push('no result block: the app did not boot cleanly');
  } else {
    let r = null;
    try { r = JSON.parse(m[1]); } catch (e) { /* handled below */ }
    appResult = r || {};
    if (!r) {
      failures.push('result block was not valid JSON');
    } else {
      ok('the app boots to the AI view', r.booted === true, r.bootError || '');
      ok('the AI form renders', r.formFound === true);
      ok('generateSite ran without throwing', r.generatorThrew === false, r.generatorError || '');

      // The assertions that matter. A refund here means the user paid for
      // nothing, which is the exact failure this suite exists to prevent.
      ok('a project is created', r.projectsAfter > 0, 'projects after generate: ' + r.projectsAfter);
      ok('the project has a name', !!(r.projectName && r.projectName.trim()), 'name: ' + r.projectName);
      ok('the project has sections', r.sectionCount > 0, 'sections: ' + r.sectionCount);
      ok('the Designer opens', r.activeView === 'view-designer', 'active view: ' + r.activeView);
      ok('the preview renders the site', r.previewHasHtml === true,
        r.previewHtmlLength + ' bytes of preview HTML');
      ok('a credit is spent', r.creditsSpent === 1, 'credits spent: ' + r.creditsSpent);
      ok('the credit is NOT refunded', r.creditsRefunded === false,
        'refund count: ' + r.refundCount);
      ok('no credit is left pending', r.creditsPending === 0, 'pending: ' + r.creditsPending);

      // Two generations of the same brief must still differ, checked in the
      // real runtime rather than against a module loaded in Node.
      if (r.secondRun) {
        ok('a second generation also succeeds', r.secondRun.generatorThrew === false, r.secondRun.generatorError || '');
        ok('the second project is distinct', r.secondRun.projectName !== r.projectName || r.secondRun.signature !== r.signature,
          'both runs produced: ' + r.secondRun.projectName);
      }
    }
  }

  console.log('');
  if (code !== 0 && !timedOut) {
    console.log('  (the app process exited ' + code + ')');
  }

  if (failures.length) {
    console.log('app-smoke FAILED: ' + failures.length + ' check(s) did not hold');
    failures.forEach((f) => console.log('  · ' + f));
    writeReceipt({ ran: true, passed, failed: failures.length, failures });
    process.exit(1);
  }
  writeReceipt({
    ran: true,
    passed,
    failed: 0,
    projectName: appResult.projectName || '',
    sections: appResult.sectionCount || 0,
    previewBytes: appResult.previewHtmlLength || 0,
    creditsSpent: appResult.creditsSpent,
    creditsRefunded: !!appResult.creditsRefunded
  });
  console.log('app-smoke PASSED: ' + passed + ' checks against the real app');
})().catch((e) => {
  // Without this the async body rejects silently and Node exits 0, which is
  // the worst possible outcome for a gate: green, having tested nothing.
  console.log('app-smoke FAILED: the harness itself threw');
  console.log('  ' + ((e && e.stack) || String(e)));
  writeReceipt({ ran: false, passed: 0, failed: 1, reason: String((e && e.message) || e) });
  process.exit(1);
});
