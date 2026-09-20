#!/usr/bin/env node
'use strict';

// ============================================================
// UI polish smoke
// ------------------------------------------------------------
// Two things are worth testing about a look.
//
// The pure parts, because ranking a search and formatting an animating
// number are decisions a browser cannot verify: they are asserted here
// directly.
//
// And the seam, because every class the shell writes into the DOM has to
// exist in the stylesheet and vice versa. That seam is where the dashboard
// metric band already went wrong once — two competing designs shipped, and the
// one app.js actually renders was the plainer of the two, so the deliberate
// redesign had never been on screen at all.
// ============================================================

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const uiSrc = fs.readFileSync(path.join(ROOT, 'data', 'uikit.js'), 'utf8');

let UIShell;
let Palette;
try {
  UIShell = require(path.join(ROOT, 'data', 'uikit.js'));
  Palette = require(path.join(ROOT, 'data', 'command-palette.js'));
} catch (e) {
  console.error('ui-polish-smoke FAILED — module missing: ' + e.message);
  process.exit(1);
}

console.log('== The shell loads where the app can see it ==');
{
  const ui = html.indexOf('src="data/uikit.js"');
  const appTag = html.indexOf('src="app.js"');
  const palette = html.indexOf('src="data/command-palette.js"');
  const icons = html.indexOf('src="data/icons.js"');
  assert(ui !== -1, 'index.html ships data/uikit.js');
  assert(ui > palette, 'uikit.js loads after command-palette.js');
  assert(ui > icons, 'uikit.js loads after icons.js');
  assert(ui < appTag, 'uikit.js loads before app.js');
}
assert(/UIShell\.initAppShell\(\)/.test(app), 'app.js boots the shell');
assert(/function paintView\(name\)/.test(app), 'switchView splits out paintView');
assert(/function switchView\(name\)\s*\{\s*paintView\(name\);\s*\}/.test(app), 'tab changes use the lightweight paint path');
assert(/UIShell\.toast\(msg, ok\)/.test(app), 'toast() delegates to the status card');

console.log('\n== Every class the shell writes is styled ==');
['toast-ico', 'toast-body', 'toast-bar', 'toast.show', 'toast.ok', 'toast.err', 'toast.warn',
  'cmd-go', 'cmd-list li mark',
  'sheet-root', 'sheet-scrim', 'sheet-card', 'sheet-grid', 'sheet-group', 'sheet-row', 'sheet-keys', 'sheet-foot',
  'body.scrolled'].forEach((sel) => {
  assert(css.indexOf(sel) !== -1, 'styles.css has .' + sel);
});
// And the reverse: the shell must not be decorating rows with a class that
// only exists in its own source.
['toast-ico', 'toast-body', 'toast-bar', 'cmd-go', 'sheet-root', 'sheet-card', 'sheet-row'].forEach((cls) => {
  assert(uiSrc.indexOf(cls) !== -1, 'uikit.js writes .' + cls);
});

console.log('\n== The metric band is one design, not two ==');
// Matched as a selector, not as text: the note explaining why the band was
// unified is allowed to name the rule it removed, and should.
assert(!/(^|[\s,{])\.stat-card[\s,{:.()]/.test(css), 'the superseded .stat-card rules are gone');
assert(!/(^|[\s,{])\.dash-stats[\s,{:.()]/.test(css), 'the superseded .dash-stats grid is gone');
assert(css.indexOf('.metric{background:var(--surface)') !== -1, '.metric is the band being rendered');
assert(/makeStat\('sc-projects', 'Projects', 'grid'/.test(app), 'the projects cell passes an icon');
assert(/makeStat\('sc-ai', 'Credits', 'spark'/.test(app), 'the credits cell passes an icon');
assert(/makeStat\('sc-store', 'Local data', 'cylinder'/.test(app), 'the local-data cell passes an icon');

console.log('\n== Tokens exist in both themes ==');
{
  // Depth and tint are colours, so light mode needs its own values or they show
  // up as a grey smudge on a white surface. Timing is not: the same 240ms is
  // correct in both themes, so those two are asserted only where they belong.
  const themed = ['--elev-1', '--elev-2', '--hair', '--ring', '--tint'];
  const shared = ['--dur-1', '--dur-2', '--dur-3', '--ease-out'];
  const lightAt = css.indexOf('body.light');
  themed.forEach((token) => {
    assert(css.indexOf(token + ':') !== -1, 'dark defines ' + token);
    assert(css.indexOf(token + ':', lightAt) !== -1, 'light overrides ' + token);
  });
  shared.forEach((token) => {
    assert(css.indexOf(token + ':') !== -1, 'root defines ' + token);
  });
}

console.log('\n== Ranking tells the user why a row matched ==');
{
  const C = Palette.COMMANDS;
  const upgr = Palette.filterCommands('upgr', C);
  const upgradish = upgr.slice(0, 2).map((c) => c.id).sort();
  assert(upgr.length && upgr.some((c) => c.id === 'upgrade'), 'upgr finds Upgrade');
  // 'Upgrade Suites' and 'Upgrade plan' are the same quality of hit for 'upgr' —
  // the query covers the same word in each — so ranking must not pretend to
  // know which one a creator meant. They share the top of the list.
  assert(upgradish.join(',') === 'suites,upgrade', 'and the two Upgrade commands share the top two rows');
  assert(!upgr.some((c) => c.id === 'dashboard'), 'upgr drops Dashboard');
  assert(upgr[0].match && upgr[0].match.length === 1 && upgr[0].match[0][0] === 0, 'upgr highlights the start of the title');

  const ai = Palette.filterCommands('ai', C);
  assert(ai.some((c) => c.id === 'ai'), 'ai finds AI Studio');
  assert(ai[0].id === 'ai', 'ai ranks AI Studio above a keyword-only hit');

  assert(Palette.filterCommands('dsh', C).some((c) => c.id === 'dashboard'), 'dsh finds Dashboard (letters in order)');
  // 'da' opens both Database and Dashboard at the same tier, so the tie has to
  // keep the shipped order rather than re-sorting on something invisible.
  const da = Palette.filterCommands('da', C).filter((c) => c.id === 'dashboard' || c.id === 'database');
  assert(da.length === 2 && da[0].id === 'dashboard', 'equal-quality hits keep the shipped order');
  const byId = (id) => C.find((c) => c.id === id);
  assert(Palette.scoreCommand('da', byId('dashboard')).score > Palette.scoreCommand('da', byId('whatsnew')).score,
    'and a title hit outranks a keyword-only hit ("update" contains "da")');
  assert(Palette.scoreCommand('dsh', byId('dashboard')).score === 1, 'letters in order score below a real substring');
  assert(Palette.scoreCommand('gibberish', byId('dashboard')) === null, 'a miss is null, not a weak score');
  assert(Palette.filterCommands('ua', C).length < C.length, 'a two-letter query does not match everything');
  assert(Palette.filterCommands('zzz', C).length === 0, 'gibberish matches nothing');

  const all = Palette.filterCommands('', C);
  assert(all.length === C.length, 'an empty query returns every command');
  assert(all.every((c) => Array.isArray(c.match) && !c.match.length), 'an empty query highlights nothing');
  assert(all[0] !== C[0], 'ranked results are copies, so COMMANDS is never written to');
  assert(Palette.COMMANDS.every((c) => c.match === undefined), 'the shipped command list stays clean');
}
{
  // A scattered hit merges into contiguous runs, so 'upg' in 'Upgrade plan'
  // marks one phrase rather than three separate letters.
  const r = Palette.matchRanges('upg', 'Upgrade plan');
  assert(r.length === 1 && r[0][0] === 0 && r[0][1] === 3, 'adjacent letters merge into one range');
  const s = Palette.matchRanges('ud', 'Upgrade plan');
  assert(s.length === 2, 'a gapped hit stays as separate ranges');
  assert(Palette.matchRanges('', 'Dashboard').length === 0, 'no query, no ranges');
}

console.log('\n== Toast tone and reading time are decisions, not decoration ==');
assert(UIShell.toastTone(true) === 'ok', 'ok=true reads as a success');
assert(UIShell.toastTone(false) === 'err', 'ok=false reads as a failure');
assert(UIShell.toastTone(undefined) === 'info', 'no verdict reads as information');
assert(UIShell.toastTone(false, 'warn') === 'warn', 'an explicit tone wins');
assert(UIShell.toastTone(true, 'nonsense') === 'ok', 'an unknown tone falls back to the verdict');
{
  const short = UIShell.toastMs('Saved');
  const long = UIShell.toastMs('x'.repeat(400));
  assert(short === UIShell.TOAST_MS, 'a short message gets the standard beat');
  assert(long > short, 'a long message stays up longer');
  assert(long <= 9000, 'but never longer than the cap (' + long + 'ms)');
  assert(UIShell.toastMs('Saved', 1200) === 1200, 'an explicit duration is honoured');
}
assert(UIShell.TOAST_ICON.ok === 'check' && UIShell.TOAST_ICON.err === 'close', 'tones map to real icons');
{
  // Every icon the toast can ask for has to exist in the stroke set.
  const icons = require(path.join(ROOT, 'data', 'icons.js'));
  Object.keys(UIShell.TOAST_ICON).forEach((tone) => {
    assert(icons.has(UIShell.TOAST_ICON[tone]), 'ICONS has "' + UIShell.TOAST_ICON[tone] + '" for ' + tone);
  });
}

console.log('\n== Counting a reading keeps its units ==');
{
  const mb = UIShell.parseNumeric('1.2 MB');
  assert(mb && mb.value === 1.2 && mb.decimals === 1 && mb.suffix === ' MB', '"1.2 MB" keeps its decimal and unit');
  assert(UIShell.formatNumeric(mb, 0.6) === '0.6 MB', 'and re-renders mid-count');
  const grouped = UIShell.parseNumeric('1,204');
  assert(grouped && grouped.grouped && grouped.value === 204 || grouped.value === 1204, '"1,204" parses as one number');
  assert(UIShell.parseNumeric('1,204').value === 1204, 'thousands separators are not read as two numbers');
  assert(UIShell.parseNumeric('Unlimited') === null, 'a word has nothing to count');
  assert(UIShell.parseNumeric('') === null, 'an empty reading has nothing to count');
  const plus = UIShell.parseNumeric('48 / 50');
  assert(plus && plus.value === 48 && plus.suffix === ' / 50', 'a ratio counts the first number only');
  assert(UIShell.formatNumeric(plus, 48) === '48 / 50', 'and re-renders the whole reading');
}

console.log('\n== A count that cannot finish still tells the truth ==');
{
  // The count is a decoration on a reading, and a frame loop can be suspended
  // outright (a backgrounded window, a sleeping laptop, a main thread busy
  // generating a site). So the promise being tested here is not "it animates":
  // it is that whichever of the frame loop and the settle timer arrives first
  // writes the REAL value, and a suspended loop never leaves a stale 0 on the
  // screen. Reproduced by running the real module against a fake clock.
  const vm = require('vm');

  function env(opts) {
    const hidden = !!(opts && opts.hidden);
    const frames = [];
    const timers = [];
    const values = [];
    const child = { textContent: '', children: [] };
    const el = {
      className: 'sc-value',
      dataset: {},
      children: [child],
      get textContent() { return child.textContent; },
      set textContent(v) { child.textContent = v; values.push(String(v)); }
    };
    let clock = 1000;
    const sandbox = {
      console: { log() {}, warn() {}, error() {} },
      performance: { now: () => clock },
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      clearTimeout: () => {},
      requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
      matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
      localStorage: { getItem: () => null, setItem() {} },
      document: { hidden, body: { classList: { contains: () => false } }, getElementById: () => null },
      window: {}
    };
    vm.createContext(sandbox);
    vm.runInContext(uiSrc + '\n;globalThis.__UIShell = UIShell;', sandbox);
    return {
      api: sandbox.__UIShell,
      el,
      frames,
      values,
      flushFrames: (times) => times.forEach((t, i) => { const fn = frames[i]; if (fn) fn(t); }),
      drain: () => { const list = timers.splice(0); list.forEach((t) => t.fn()); },
      clock: (v) => { clock = v; }
    };
  }

  {
    const e = env();
    e.el.textContent = '1234';
    const returned = e.api.countUp(e.el);
    assert(returned === 1234, 'the true value is known up front');
    e.drain();
    assert(e.el.textContent === '1234', 'a suspended frame loop still lands on the real reading (not 0)');
  }
  {
    const e = env();
    e.el.textContent = '1.2 MB';
    e.api.countUp(e.el);
    e.flushFrames([1000]);
    assert(e.el.textContent === '0.0 MB', 'the first frame starts the reading at zero');
    e.flushFrames([1310]);
    const mid = Number(e.el.textContent.split(' ')[0]);
    assert(mid > 0 && mid < 1.2, 'a middle frame is part-way through (' + e.el.textContent + ')');
    e.flushFrames([1620]);
    assert(e.el.textContent === '1.2 MB', 'the last frame restores the unit exactly');
    e.drain();
    assert(e.el.textContent === '1.2 MB', 'and the settle timer cannot move a finished reading');
  }
  {
    const e = env();
    e.el.textContent = 'Unlimited';
    assert(e.api.countUp(e.el) === null, 'a word is left alone');
    e.el.textContent = '0';
    assert(e.api.countUp(e.el) === 0, 'nothing to count is not animated');
  }
  {
    const e = env();
    e.el.textContent = '42';
    e.api.countUp(e.el);
    e.drain();
    assert(e.api.countUp(e.el) === null, 'the same reading is never counted twice');
    const fresh = env();
    fresh.el.textContent = '7';
    assert(fresh.api.countUp(fresh.el) === 7, 'but a different session counts its first render');
  }
  {
    // A window that is not on screen must not start an animation it cannot
    // finish: it writes the reading and schedules nothing.
    const e = env({ hidden: true });
    e.el.textContent = '99';
    const out = e.api.countUp(e.el);
    assert(out === 99, 'a hidden window still reports the value');
    assert(e.frames.length === 0, 'and starts no animation it cannot finish');
    assert(e.el.textContent === '99', 'leaving the reading untouched');
  }
}

console.log('\n== The shortcut sheet only lists shortcuts that exist ==');
{
  const labels = UIShell.SHORTCUT_GROUPS.reduce((n, g) => n + g.items.length, 0);
  assert(UIShell.SHORTCUT_GROUPS.length >= 3 && labels >= 8, 'the sheet is grouped and populated');
  assert(UIShell.SHORTCUT_GROUPS.every((g) => g.title && g.items.every((i) => i.label && i.keys.length)), 'every row is labelled and keyed');
  const modal = UIShell.keyLabels({ mod: true, keys: ['K'] }, true);
  assert(modal.join('') === '⌘K', 'the modifier stacks into a glyph on macOS');
  const win = UIShell.keyLabels({ mod: true, keys: ['K'] }, false);
  assert(win.join('') === 'CtrlK', 'and reads as a word elsewhere');
  const sheet = UIShell.sheetHtml(true);
  assert(sheet.indexOf('⌘') !== -1 && sheet.indexOf('<kbd>') !== -1, 'the sheet markup carries key caps');
  assert(sheet.indexOf('Command palette') !== -1 && sheet.indexOf('Undo the last edit') !== -1, 'the sheet names the real actions');
  // The sheet is a dialog: it must be dismissable without a keyboard, and by
  // the key every dialog is expected to answer to.
  assert(/data-sheet-close/.test(sheet), 'the sheet can close itself with a click');
  assert(/e\.key === 'Escape' && uishellState\.sheet\.open/.test(uiSrc), 'and answers Escape');
  assert(/uishellTyping\(e\.target\)/.test(uiSrc), 'and never steals a key from a text field');
}

console.log('\n== Motion is asked for, never assumed ==');
assert(/UIShell\.reducedMotion\(\)/.test(app) === false, 'app.js does not assume motion either way');
assert(/function uishellReducedMotion/.test(uiSrc), 'the shell has one place that decides');
assert(/prefers-reduced-motion: no-preference/.test(css), 'the view cross-fade is opt-in for motion');
assert(/body:not\(\.no-motion\) \*/.test(css), 'the in-app motion switch still wins');
assert(/function uishellLowPower/.test(uiSrc), 'older-device capability detection lives in the shell');
assert(/body\.low-power/.test(css), 'older-device styling removes expensive visual effects');
assert(/uishellApplyPerformanceMode\(\)/.test(uiSrc), 'the performance mode is applied during shell boot');

if (failed) {
  console.error('\nui-polish-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nui-polish-smoke PASSED');
