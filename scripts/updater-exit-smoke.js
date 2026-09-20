// ============================================================
// Updater exit smoke test — the app must leave before an update can install.
//
// This exists because of a bug that cost two releases' worth of trust: on macOS,
// electron-updater's quitAndInstall() hands the install to Squirrel's ShipIt and
// returns without quitting Electron. ShipIt replaces the bundle only once this
// process is gone, so it waited for a process that was never going to die — the
// splash sat on "Installing update…" indefinitely, and the cure was to kill the
// app by hand. Measured on a real machine: eight minutes of nothing, then
// "Beginning installation" within a second of the process being killed.
//
// The failure mode is nearly invisible in review, because `updater
// .quitAndInstall()` looks like the whole feature and is what the library's own
// documentation suggests. So the tests are weighted the way the risk is:
//
//   1. NOTHING CALLS quitAndInstall WITHOUT AN EXIT BEHIND IT. Every call site
//      goes through the one helper, and that helper quits.
//   2. THE SPLASH GOES FIRST. It is the only window created with closable:false,
//      and a window that refuses to close can cancel the quit it is part of —
//      which would reinstate the deadlock with the exit call in place.
//   3. THERE IS A LAST RESORT. A quit that stalls, or a handler that throws,
//      must not leave an app that cannot be updated.
//   4. AND THE SPLASH CAN ALWAYS BE DISMISSED. Owning the exit fixes updates we
//      start, but not someone already stuck on a version that does not: the
//      gate runs before the workspace exists, and the splash is a frameless,
//      closable:false, always-on-top window, so a hang there is a lockout.
//      The way out is four wires — markup, preload, channel, sender-checked
//      handler — and none of them fails loudly if cut.
//
// The helper itself is RUN here against a fake electron `app`, because reading
// its source proves only that the words are present, and this bug is about the
// order and the timing of side effects.
//
// Run: node scripts/updater-exit-smoke.js
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

// ---- 1. pull the helper out of main.js so it can actually be run ----------
// A brace matcher rather than a regex, so adding a line inside the function
// cannot silently truncate what is tested.
function bodyOf(name) {
  const start = main.indexOf('function ' + name + '(');
  if (start < 0) return null;
  const open = main.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < main.length; i++) {
    if (main[i] === '{') depth++;
    else if (main[i] === '}') {
      depth--;
      if (depth === 0) return main.slice(start, i + 1);
    }
  }
  return null;
}

const quitSrc = bodyOf('quitForUpdate');
const armSrc = bodyOf('armUpdateAndQuit');
const stageSrc = bodyOf('squirrelStaged');
const beatMs = Number((/const UPDATE_QUIT_BEAT_MS = (\d+);/.exec(main) || [])[1]);
const graceMs = Number((/const UPDATE_EXIT_GRACE_MS = (\d+);/.exec(main) || [])[1]);

console.log('== Shape ==');
ok('quitForUpdate exists in main.js', !!quitSrc);
ok('armUpdateAndQuit exists in main.js', !!armSrc);
ok('the beat before quitting is declared and small', beatMs > 0 && beatMs <= 1000, String(beatMs));
ok('the last resort is declared and generous', graceMs >= 2000, String(graceMs));

console.log('\n== Every installer call has an exit behind it ==');
{
  const calls = (main.match(/\.quitAndInstall\(/g) || []).length;
  ok('quitAndInstall is called exactly once in the whole file', calls === 1, String(calls));
  ok('and that one call is inside armUpdateAndQuit', !!armSrc && /\.quitAndInstall\(/.test(armSrc));
  ok('armUpdateAndQuit calls quitForUpdate', !!armSrc && /quitForUpdate\(\)/.test(armSrc));
  // The two ways an update is installed: the startup gate and Restart now.
  const callSites = (main.match(/armUpdateAndQuit\(\)/g) || []).length;
  ok('both entry points go through it', callSites === 3, 'found ' + callSites + ' (1 definition + 2 call sites)');
  ok('the startup gate no longer calls the installer directly',
    !/startupUpdateRunning = false;\s*\n\s*updater\.quitAndInstall/.test(main));
  ok('and it reports a restart only when the installer armed',
    /if \(await armUpdateAndQuit\(\)\) return true;/.test(main));
}

console.log('\n== The hand-off waits for the archive, not for a stopwatch ==');
// The macOS proxy server that feeds Squirrel lives in this process, so a quit
// that arrives before Squirrel has read the file truncates it — a 129 MB update
// lost at 53 MB, with no install line in ShipIt's log and no message to anyone.
{
  ok('armUpdateAndQuit waits on the stage signal before quitting',
    !!armSrc && /await squirrelStaged\(\)/.test(armSrc));
  ok('and the wait is what decides whether to quit',
    !!armSrc && /if \(!\(await squirrelStaged\(\)\)\)/.test(armSrc)
    && armSrc.indexOf('await squirrelStaged()') < armSrc.indexOf('quitForUpdate()'));
  ok('squirrelStaged exists and listens to the NATIVE updater',
    !!stageSrc && /require\('electron'\)\.autoUpdater/.test(stageSrc)
    && /native\.once\('update-downloaded'/.test(stageSrc));
  // electron-updater's own 'update-downloaded' fires BEFORE the transfer starts.
  // Quitting on it would reinstate the truncation, so the wait must not use it.
  ok('it does not confuse electron-updater\u2019s event with Squirrel\u2019s',
    !!stageSrc && !/updater\.on\('update-downloaded'/.test(stageSrc));
  ok('a transfer that never finishes cannot hold the user hostage',
    !!stageSrc && /setTimeout\(\(\) => finish\(false\), UPDATE_STAGE_TIMEOUT_MS\)/.test(stageSrc));
  // Registered from initUpdater, which runs before the gate exists — so the
  // signal cannot be missed by an install armed in the same launch.
  ok('the native listener is registered when the updater is wired up',
    !!bodyOf('initUpdater') && /noteNativeStageSignal\(\);/.test(bodyOf('initUpdater')));
  ok('and the gate arms the install after that wiring',
    !!bodyOf('initUpdater') && main.indexOf('function initUpdater()') < main.lastIndexOf('await armUpdateAndQuit()'));
  ok('and it is registered on the native updater, not electron-updater',
    !!bodyOf('noteNativeStageSignal') && /require\('electron'\)\.autoUpdater/.test(bodyOf('noteNativeStageSignal')));
  ok('Windows does not wait for a second transfer that never happens',
    !!stageSrc && /process\.platform !== 'darwin'/.test(stageSrc));
}

console.log('\n== The helper, actually run ==');
// A fake electron: records the order of side effects, and a timer queue the
// test drives by hand so the timing is asserted rather than waited for.
function runHelper() {
  const events = [];
  const timers = [];
  const fakeSetTimeout = (fn, ms) => { timers.push({ fn: fn, ms: ms }); return timers.length; };
  const app = {
    quit: () => { events.push('quit'); },
    exit: (code) => { events.push('exit:' + code); }
  };
  const make = new Function('app', 'closeStartupWindow', 'setTimeout', 'console',
    'const UPDATE_QUIT_BEAT_MS = ' + beatMs + ';\n'
    + 'const UPDATE_EXIT_GRACE_MS = ' + graceMs + ';\n'
    + quitSrc + '\nreturn quitForUpdate;');
  const quitForUpdate = make(app, () => { events.push('destroySplash'); }, fakeSetTimeout, console);
  return { quitForUpdate, events, timers };
}

{
  const h = runHelper();
  h.quitForUpdate();
  ok('nothing happens on the same tick — ShipIt gets its beat', h.events.length === 0, h.events.join(','));
  ok('one timer is scheduled to start the exit', h.timers.length === 1, String(h.timers.length));
  ok('and it waits the declared beat, not zero', h.timers[0] && h.timers[0].ms === beatMs, h.timers[0] && String(h.timers[0].ms));

  // Run the beat: this is the moment the app decides to leave.
  h.timers[0].fn();
  ok('the splash is destroyed', h.events.indexOf('destroySplash') >= 0, h.events.join(','));
  ok('the app is asked to quit', h.events.indexOf('quit') >= 0, h.events.join(','));
  ok('the splash goes before the quit', h.events.indexOf('destroySplash') < h.events.indexOf('quit'), h.events.join(','));
  ok('a last resort is scheduled as well', h.timers.length === 2, String(h.timers.length));
  ok('the last resort waits the declared grace', h.timers[1] && h.timers[1].ms === graceMs, h.timers[1] && String(h.timers[1].ms));
  ok('and it is scheduled BEFORE the polite quit, so a throwing quit is still covered',
    h.timers[1] && h.timers[1].fn && h.events.indexOf('quit') >= 0);

  // A quit that never completes must still end the process.
  h.timers[1].fn();
  ok('the last resort is a hard exit, not another quit', h.events.indexOf('exit:0') >= 0, h.events.join(','));
}

console.log('\n== A quit that throws still leaves ==');
{
  const events = [];
  const timers = [];
  const app = {
    quit: () => { events.push('quit'); throw new Error('quit refused'); },
    exit: (code) => { events.push('exit:' + code); }
  };
  const make = new Function('app', 'closeStartupWindow', 'setTimeout', 'console',
    'const UPDATE_QUIT_BEAT_MS = ' + beatMs + ';\n'
    + 'const UPDATE_EXIT_GRACE_MS = ' + graceMs + ';\n'
    + quitSrc + '\nreturn quitForUpdate;');
  make(app, () => events.push('destroySplash'), (fn, ms) => timers.push({ fn: fn, ms: ms }), { log: () => {}, error: () => {} })();
  timers[0].fn();                      // the beat — quit throws inside here
  ok('the throwing quit does not stop the helper', events.indexOf('quit') >= 0, events.join(','));
  ok('and the exit timer is still in hand', timers.length === 2, String(timers.length));
  timers[1].fn();
  ok('so the process can still leave', events.indexOf('exit:0') >= 0, events.join(','));
}

console.log('\n== The arming helper, actually run ==');
// The helper is async now — it waits for Squirrel — so these cases are awaited,
// and the summary at the foot of the file waits on them too.
let pendingArms = Promise.resolve();
// bodyOf() returns the declaration as written, minus its `async` keyword — which
// the await inside it needs to parse at all. Put it back.
const armHelper = (updater, quitForUpdate, staged) => new Function(
  'updater', 'quitForUpdate', 'squirrelStaged', 'console',
  'async ' + armSrc + '\nreturn armUpdateAndQuit;'
)(updater, quitForUpdate, staged, { log: () => {}, error: () => {} });

{
  const calls = [];
  const updater = { quitAndInstall: (a, b) => calls.push('install:' + a + ':' + b) };
  let release = null;
  const arm = armHelper(updater, () => calls.push('quitForUpdate'), () => new Promise((r) => { release = r; }));
  pendingArms = (async () => {
    const leaving = arm();
    ok('arming installs the update at once', calls.join(',') === 'install:false:true', calls.join(','));
    ok('and does NOT quit while the archive is still being handed over', calls.length === 1, calls.join(','));
    await Promise.resolve();
    ok('the wait does not quietly resolve into a quit', calls.length === 1, calls.join(','));
    release(true);
    ok('once Squirrel has the archive it leaves', (await leaving) === true && calls[calls.length - 1] === 'quitForUpdate', calls.join(','));
    ok('and reports that the app is leaving, so no window is created', (await leaving) === true);
  })();
}

{
  const calls = [];
  const updater = { quitAndInstall: () => calls.push('install') };
  const arm = armHelper(updater, () => calls.push('quitForUpdate'), () => Promise.resolve(false));
  pendingArms = pendingArms.then(async () => {
    const leaving = await arm();
    ok('an unfinished hand-off does not quit the app', calls.indexOf('quitForUpdate') === -1, calls.join(','));
    ok('and reports that nothing is leaving, so the workspace still opens', leaving === false);
  });
}

{
  const calls = [];
  const updater = { quitAndInstall: () => { throw new Error('no installer'); } };
  const arm = armHelper(updater, () => calls.push('quitForUpdate'), () => Promise.resolve(true));
  pendingArms = pendingArms.then(async () => {
    ok('an installer that refuses to arm does not strand the user', (await arm()) === true && calls.length === 1, calls.join(','));
  });
}

{
  const arm = armHelper(null, () => { throw new Error('should not be called'); }, () => Promise.resolve(true));
  pendingArms = pendingArms.then(async () => {
    ok('with no updater at all nothing happens', (await arm()) === false);
  });
}

// ---- 4. the escape hatch --------------------------------------------------
// Wires, end to end: markup -> preload -> channel -> sender-checked handler ->
// the gate's skip. Each assertion names the other end, so renaming one side of
// a pair cannot leave a button that does nothing.
console.log('\n== The escape hatch ==');
{
  const splashSrc = bodyOf('createStartupWindow');
  const skipSrc = bodyOf('skipStartupUpdate');
  const ipcSrc = bodyOf('registerSplashIpc');
  const preload = fs.readFileSync(path.join(ROOT, 'splash-preload.js'), 'utf8');
  const builder = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8');
  const literal = (() => {
    const i = main.indexOf('const splash = `');
    const j = main.indexOf('`;', i + 20);
    return i < 0 || j < 0 ? '' : main.slice(i, j + 2);
  })();

  ok('the splash window loads its own preload',
    !!splashSrc && /preload:\s*path\.join\(__dirname,\s*'splash-preload\.js'\)/.test(splashSrc));
  // A preload missing from `files` fails silently: the splash simply has no
  // bridge, and the button stops working in the packaged app only.
  ok('and that file is packaged, or the button dies only once built',
    /^\s*-\s*splash-preload\.js\s*$/m.test(builder), 'not listed in electron-builder.yml');

  ok('the splash markup carries the button', !!literal && /id="skip"/.test(literal));

  ok('the button is hidden until the wait is over',
    !!literal && /id="skip"[^>]*hidden/.test(literal) && /skip\.hidden=false/.test(literal));
  ok('the wait is a real duration, interpolated rather than literal',
    /skip\.hidden=false;\},\$\{STARTUP_ESCAPE_AFTER_MS\}\)/.test(literal)
    && /const STARTUP_ESCAPE_AFTER_MS = \d{3,};/.test(main));
  ok('the markup calls the API the preload exposes by name',
    !!literal && /window\.paiSplash&&window\.paiSplash\.skip/.test(literal)
    && /exposeInMainWorld\('paiSplash'/.test(preload));
  ok('the preload exposes nothing else',
    (preload.match(/exposeInMainWorld\(/g) || []).length === 1
    && (preload.match(/ipcRenderer\.(send|invoke|on|handle)\(/g) || []).length === 1);

  // The channel string is written twice, in two files. This is the pair that a
  // rename breaks silently.
  const exposed = (/ipcRenderer\.send\('([^']+)'\)/.exec(preload) || [])[1];
  const listened = (/ipcMain\.on\('([^']+)'/.exec(ipcSrc || '') || [])[1];
  ok('both ends agree on the channel name', !!exposed && exposed === listened, exposed + ' vs ' + listened);

  // Sender validation is now the shared frame check: a WebContents is not a
  // frame, and anything that came from a subframe must not be able to end the
  // update gate (or read the studio's secrets — see security-hardening-smoke).
  ok('main checks which window sent it',
    !!ipcSrc && /fromMainFrame\(event, startupWindow\)/.test(ipcSrc));
  ok('and refuses a message that came from a subframe',
    /const frame = event\.senderFrame/.test(main) && /frame\.parent == null/.test(main));
  ok('and routes it to the gate',
    !!ipcSrc && /skipStartupUpdate\(\);/.test(ipcSrc));
  ok('the skip tells the waiting gate to stop',
    !!skipSrc && /if \(startupSkipSignal\) startupSkipSignal\(\);/.test(skipSrc));
  ok('and is ignored once the installer is armed',
    !!skipSrc && /if \(!startupUpdateRunning \|\| startupSkipped\) return false;/.test(skipSrc));
}

// The arming cases above are async, so the verdict waits for them.
pendingArms.then(() => {
  console.log('\n' + (failed === 0 ? 'UPDATER EXIT SMOKE PASSED' : 'UPDATER EXIT SMOKE FAILED: ' + failed));
  process.exit(failed === 0 ? 0 : 1);
});
