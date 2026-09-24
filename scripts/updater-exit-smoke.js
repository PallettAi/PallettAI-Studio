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
const waitSrc = bodyOf('waitForInstaller');
const preparedSrc = bodyOf('installerPrepared');
const relaunchSrc = bodyOf('askToBeRelaunched');
const beatMs = Number((/const UPDATE_QUIT_BEAT_MS = (\d+);/.exec(main) || [])[1]);
const graceMs = Number((/const UPDATE_EXIT_GRACE_MS = (\d+);/.exec(main) || [])[1]);
const prepareExpr = (/const UPDATE_PREPARE_TIMEOUT_MS = ([^;]+);/.exec(main) || [])[1] || '';
let prepareMs = 0;
try { prepareMs = Number(Function('return ' + prepareExpr)()); } catch (e) { prepareMs = 0; }

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
  // The two ways an update is installed: the startup gate and a manual
  // "Restart now". Both must reach the installer through the one helper — a
  // route that calls it any other way quits the app with nothing behind it,
  // which is the deadlock above. Counted from the code with comments stripped,
  // because a sentence that merely names the helper is not a call site (a bare
  // count flags prose, and then gets raised to silence prose).
  const stripComments = (src) => String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  const callSites = (stripComments(main).match(/armUpdateAndQuit\(\)/g) || []).length;
  const inGate = (stripComments(bodyOf('runStartupUpdateGate') || '').match(/armUpdateAndQuit\(\)/g) || []).length;
  const inPrompt = (stripComments(bodyOf('installUpdateFromPrompt') || '').match(/armUpdateAndQuit\(\)/g) || []).length;
  ok('both entry points go through it, and nothing else calls it',
    callSites === 3 && inGate === 1 && inPrompt === 1,
    'total=' + callSites + ' launch gate=' + inGate + ' manual restart=' + inPrompt);
  ok('the startup gate no longer calls the installer directly',
    !/startupUpdateRunning = false;\s*\n\s*updater\.quitAndInstall/.test(main));
  ok('and it reports a restart only when the installer armed',
    /const leaving = await armUpdateAndQuit\(\);/.test(main)
    && /if \(leaving\) return true;/.test(main));
  ok('implicit quit installation is disabled so macOS cannot race the explicit hand-off',
    /updater\.autoInstallOnAppQuit = false;/.test(main));
}

console.log('\n== The hand-off waits for the EXPANSION, not for the download ==');
/*
  Two versions of this quit too early, and both failed silently. A fixed timer
  truncated the transfer at 53 MB of 129 MB. Electron's native
  'update-downloaded' — the fix for that — fires when the ZIP has finished
  DOWNLOADING, one step before Squirrel expands it in-process: 0.4.9 → 0.4.11
  lost the update at 73 MB of 239 MB, with no ShipIt log line for that day and
  Studio simply closing.
*/
{
  ok('armUpdateAndQuit waits for the installer before quitting',
    !!armSrc && /await waitForInstaller\(\)/.test(armSrc)
    && armSrc.indexOf('await waitForInstaller()') < armSrc.indexOf('quitForUpdate()'));
  ok('and the wait is what decides whether to quit at all',
    !!armSrc && /if \(!\(await waitForInstaller\(\)\) \|\| skipRequested\(\)\)/.test(armSrc));
  ok('the signal is ShipItState.plist, which Squirrel writes when the archive is expanded',
    !!bodyOf('shipItStatePath') && /ShipItState\.plist/.test(bodyOf('shipItStatePath'))
    && !!preparedSrc && /fs\.statSync/.test(preparedSrc));
  ok('and it is timed against the moment the install was armed, not mere existence',
    !!preparedSrc && /mtimeMs >= installArmedAt/.test(preparedSrc));
  ok('the arm is stamped before quitAndInstall, so a fast disk cannot be missed',
    !!armSrc && armSrc.indexOf('installArmedAt = Date.now()') < armSrc.indexOf('.quitAndInstall('));
  ok('the download event is no longer what the exit waits on',
    !/native\.once\('update-downloaded'/.test(main) && !/noteNativeStageSignal/.test(main));
  ok('a slow expansion cannot hold the user hostage',
    !!waitSrc && /Date\.now\(\) < deadline/.test(waitSrc) && prepareMs >= 5 * 60 * 1000, prepareMs + 'ms');
  ok('the skip route stays live for the whole wait', !!waitSrc && /skipRequested\(\)/.test(waitSrc));
  ok('and only the startup gate can be skipped, never a manual check later in the session',
    /const skipRequested = \(\) => startupUpdateRunning && startupSkipped;/.test(main));
  ok('the splash keeps its escape hatch valid while it waits',
    /const leaving = await armUpdateAndQuit\(\);\s*\n\s*startupUpdateRunning = false;/.test(main));
  ok('Studio is asked to come back after the install',
    !!relaunchSrc && /launchAfterInstallation = true/.test(relaunchSrc)
    && /JSON\.parse/.test(relaunchSrc));
  ok('and the state file is left alone if it does not parse',
    !!relaunchSrc && /try \{/.test(relaunchSrc) && /catch \(e\)/.test(relaunchSrc));
  ok('the ask comes after the installer is confirmed ready',
    !!armSrc && armSrc.indexOf('askToBeRelaunched()') > armSrc.indexOf('await waitForInstaller()'));
  ok('Windows does not wait for a second transfer that never happens',
    !!waitSrc && /if \(!isMac\) return true;/.test(waitSrc));
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
const armHelper = (updater, quitForUpdate, wait, skipRequested, askToBeRelaunched) => new Function(
  'updater', 'quitForUpdate', 'waitForInstaller', 'skipRequested', 'askToBeRelaunched', 'console',
  'let installArmedAt = 0;\n'
  + 'async ' + armSrc + '\nreturn armUpdateAndQuit;'
)(
  updater, quitForUpdate, wait,
  skipRequested || (() => false),
  askToBeRelaunched || (() => {}),
  { log: () => {}, error: () => {} }
);

{
  const calls = [];
  const updater = { quitAndInstall: (a, b) => calls.push('install:' + a + ':' + b) };
  let release = null;
  const arm = armHelper(
    updater,
    () => calls.push('quitForUpdate'),
    () => new Promise((r) => { release = r; }),
    () => false,
    () => calls.push('askToBeRelaunched')
  );
  pendingArms = (async () => {
    const leaving = arm();
    ok('arming installs the update at once', calls.join(',') === 'install:false:true', calls.join(','));
    ok('and does NOT quit while Squirrel is still expanding the archive', calls.length === 1, calls.join(','));
    await Promise.resolve();
    ok('the wait does not quietly resolve into a quit', calls.length === 1, calls.join(','));
    release(true);
    ok('once ShipIt is ready it leaves', (await leaving) === true && calls[calls.length - 1] === 'quitForUpdate', calls.join(','));
    ok('and Studio is asked to come back before it goes', calls.indexOf('askToBeRelaunched') === calls.length - 2, calls.join(','));
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
    // The library fallback is armed for THIS update only, so the work is not lost.
    ok('and the update is kept for the next deliberate quit', updater.autoInstallOnAppQuit === true);
  });
}

// The longest step of an update is the expansion, and it is the step the user is
// most likely to lose patience with. A click on Skip must win, and the update must
// still be waiting for them when they quit of their own accord.
{
  const calls = [];
  const updater = { quitAndInstall: () => calls.push('install') };
  const arm = armHelper(
    updater, () => calls.push('quitForUpdate'),
    () => Promise.resolve(true),   // the installer IS ready
    () => true,                    // …and the user chose to work instead
    () => calls.push('askToBeRelaunched')
  );
  pendingArms = pendingArms.then(async () => {
    const leaving = await arm();
    ok('a skip during the wait is honoured even once the installer is ready',
      (await leaving) === false && calls.indexOf('quitForUpdate') === -1, calls.join(','));
    ok('the app is not asked to come back on its own', calls.indexOf('askToBeRelaunched') === -1, calls.join(','));
    ok('and the finished update still installs on the next quit', updater.autoInstallOnAppQuit === true);
  });
}

{
  const calls = [];
  const updater = { quitAndInstall: () => { throw new Error('no installer'); } };
  const arm = armHelper(
    updater,
    () => calls.push('quitForUpdate'),
    () => { calls.push('waited'); return Promise.resolve(true); },
    null,
    () => calls.push('askToBeRelaunched')
  );
  pendingArms = pendingArms.then(async () => {
    ok('an installer that refuses to arm does not strand the user', (await arm()) === true && calls.indexOf('quitForUpdate') >= 0, calls.join(','));
  });
}

{
  let waited = false;
  const arm = armHelper(
    null, () => { throw new Error('should not be called'); },
    () => { waited = true; return Promise.resolve(true); }
  );
  pendingArms = pendingArms.then(async () => {
    ok('with no updater at all nothing happens', (await arm()) === false);
    ok('and no wait is started for an installer that will never run', waited === false);
  });
}

// ---- 3b. the manual restart ----------------------------------------------
// "Restart now" runs the SAME multi-minute hand-off the launch gate does. With
// nothing on screen that is not a feature, it is the freeze: a window that will
// not respond for minutes, on a machine where the expansion really is that
// slow. So the manual path has to raise the gate's own progress surface, keep
// Skip live while it waits, and take the surface down again if the install does
// not complete.
console.log('\n== The manual restart is not a silent freeze ==');
{
  const promptSrc = bodyOf('installUpdateFromPrompt');
  ok('the manual path is a function of its own, so it can be run here', !!promptSrc);

  ok('it raises a progress surface before arming',
    !!promptSrc && /createStartupWindow\(\);/.test(promptSrc)
    && promptSrc.indexOf('createStartupWindow') < promptSrc.indexOf('armUpdateAndQuit'));
  ok('and names the step it is actually on',
    !!promptSrc && /Preparing the installer/.test(promptSrc));
  // Skip is refused unless the gate is running, so these three lines are the
  // whole escape hatch for a manual install. They are also the easiest thing in
  // the file to delete without anything failing.
  ok('Skip stays live, which needs the gate running and unskipped',
    !!promptSrc && /startupUpdateRunning = true;/.test(promptSrc) && /startupSkipped = false;/.test(promptSrc));
  ok('and the update is known to be on disk before anyone can skip it',
    !!promptSrc && /startupUpdateReady = true;/.test(promptSrc));
  ok('a completed hand-off leaves the splash to the quit that is coming',
    !!promptSrc && /if \(leaving\) return true;/.test(promptSrc)
    && promptSrc.indexOf('closeStartupWindow') > promptSrc.indexOf('if (leaving) return true;'));
  ok('an unfinished one puts the splash away and says where the update went',
    !!promptSrc && /closeStartupWindow\(\);/.test(promptSrc)
    && /The update will install when you next quit Studio\./.test(promptSrc));

  // RUN both outcomes. Every declaration the function closes over is passed in,
  // so the branches can be taken without a real installer behind them.
  const promptHarness = (armResult) => {
    const calls = [];
    const built = new Function(
      'updater', 'createStartupWindow', 'setStartupStatus', 'armUpdateAndQuit',
      'closeStartupWindow', 'win', 'dialog',
      'let startupUpdateRunning = false, startupSkipped = false, startupSkipSignal = null, startupUpdateReady = false;\n'
      + 'async ' + promptSrc + '\n'
      + 'return { fn: installUpdateFromPrompt, gate: () => startupUpdateRunning };'
    )(
      { quitAndInstall: () => calls.push('install') },
      () => calls.push('createStartupWindow'),
      (m) => calls.push('status:' + m),
      async () => { calls.push('arm'); return armResult; },
      () => calls.push('closeStartupWindow'),
      { isDestroyed: () => false, focus: () => calls.push('focus') },
      { showMessageBoxSync: () => calls.push('dialog') }
    );
    return { calls, fn: built.fn, gate: built.gate };
  };

  pendingArms = pendingArms.then(async () => {
    const done = promptHarness(true);
    const result = await done.fn();
    ok('a manual restart that completes shows its progress and then gets out of the way',
      result === true && done.calls.indexOf('createStartupWindow') === 0
      && done.calls.indexOf('closeStartupWindow') === -1, done.calls.join(','));
    ok('leaving the splash to the quit, with no dialog over a dying app',
      done.calls.indexOf('dialog') === -1, done.calls.join(','));
    ok('and the gate is put down behind it, so no wait outlives the app',
      done.gate() === false);
  });

  pendingArms = pendingArms.then(async () => {
    const stuck = promptHarness(false);
    const result = await stuck.fn();
    ok('one that does not complete takes the splash away again',
      result === false && stuck.calls.indexOf('closeStartupWindow') >= 0, stuck.calls.join(','));
    ok('hands the workspace back to the user', stuck.calls.indexOf('focus') >= 0, stuck.calls.join(','));
    ok('and says the update is still coming rather than failing silently',
      stuck.calls.indexOf('dialog') >= 0, stuck.calls.join(','));
    ok('with the gate down, so nothing is still waiting on a window that is gone',
      stuck.gate() === false);
  });
}

// "Later" is only an honest button if the update really does install on the next
// quit. The library is told not to install on quit for the whole session (so it
// cannot race the guarded hand-off), which means the dialog's promise has to be
// re-armed at the moment the user defers.
{
  const later = /if \(r !== 0\) \{([\s\S]*?)\n\s*return;\n\s*\}/.exec(main);
  ok('the dialog promises an install on the next quit',
    /or it will install when you quit\./.test(main));
  ok('and deferring arms the library quit hook that promise depends on',
    !!later && /autoInstallOnAppQuit = true/.test(later[1]),
    later ? later[1].trim().slice(0, 60) : 'branch not found');
  ok('the manual restart is what the promise is delivered by',
    /installUpdateFromPrompt\(\);/.test(main));
}

// Skipping means two different things depending on how far the update got, and
// saying the wrong one is how "Skip" turns into "the update silently vanished".
{
  const skipFn = bodyOf('skipStartupUpdate');
  ok('the skip message branches on whether the download finished',
    !!skipFn && /startupUpdateReady\s*\?/.test(skipFn)
    && /will install when you next quit/.test(skipFn) && /offered again next time/.test(skipFn));
  const dl = main.indexOf('updater.downloadUpdate()');
  const ready = main.indexOf('startupUpdateReady = true;', dl);
  ok('and the gate calls it ready only after that download resolves',
    dl > 0 && ready > dl, 'download@' + dl + ' ready@' + ready);
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
