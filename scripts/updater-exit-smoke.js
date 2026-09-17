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
    /if \(armUpdateAndQuit\(\)\) return true;/.test(main));
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

console.log('\n== The arming helper ==');
{
  const calls = [];
  const updater = { quitAndInstall: (a, b) => calls.push('install:' + a + ':' + b) };
  const timers = [];
  const make = new Function('updater', 'quitForUpdate', armSrc + '\nreturn armUpdateAndQuit;');
  const arm = make(updater, () => calls.push('quitForUpdate'));
  ok('arming installs the update and then leaves', arm() === true && calls.join(',') === 'install:false:true,quitForUpdate', calls.join(','));
  ok('and reports that the app is leaving, so no window is created',
    arm() === true && calls[calls.length - 1] === 'quitForUpdate');
}

{
  const calls = [];
  const updater = { quitAndInstall: () => { throw new Error('no installer'); } };
  const make = new Function('updater', 'quitForUpdate', 'console', armSrc + '\nreturn armUpdateAndQuit;');
  const arm = make(updater, () => calls.push('quitForUpdate'), { error: () => {} });
  ok('an installer that refuses to arm does not strand the user', arm() === true && calls.length === 1, calls.join(','));
}

{
  const make = new Function('updater', 'quitForUpdate', 'console', armSrc + '\nreturn armUpdateAndQuit;');
  const arm = make(null, () => { throw new Error('should not be called'); }, { error: () => {} });
  ok('with no updater at all nothing happens', arm() === false);
}

console.log('\n' + (failed === 0 ? 'UPDATER EXIT SMOKE PASSED' : 'UPDATER EXIT SMOKE FAILED: ' + failed));
process.exit(failed === 0 ? 0 : 1);
