// ============================================================
// Brand & startup-splash smoke test
//
// The splash screen is the first pixel of the product, and the last thing anyone
// remembers to update: it shipped a full rebrand behind it still wearing the old
// violet for weeks, because nothing in the gate looked at it. This suite makes
// that specific failure impossible to repeat.
//
// It is a DRIFT test, not a snapshot. The splash cannot import styles.css — it is
// a data: URL that loads before the renderer exists — so its colours are a
// hand-copied duplicate of the app's tokens, and hand-copied duplicates rot. So
// every colour the splash uses is checked back against styles.css:
//
//   1. Extraction    — the template still parses, and renders a whole document.
//   2. Both themes   — dark and light each produce their own palette and class.
//   3. Palette       — every hex the splash names exists in styles.css, and the
//                      tokens that share a meaning (background, text, muted,
//                      primary, border) are EQUAL, not merely present.
//   4. Ambience      — the glow and wash are built from the theme's own primary,
//                      so a violet glow on a blue splash fails here.
//   5. No old brand  — the pre-rebrand violet/cyan is gone from the shell files.
//   6. Contracts     — the progress DOM that setStartupStatus drives, the
//                      offline promise (no external fetch), and reduced motion.
//   7. Theme plumbing— the renderer still reports its theme, or the splash
//                      silently reverts to dark for everyone who chose light.
//
// Run: node scripts/brand-splash-smoke.js
//      node scripts/brand-splash-smoke.js --dump <dir>   (write both HTML files)
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

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const mainJs = read('main.js');
const preloadJs = read('preload.js');
const appJs = read('app.js');
const indexHtml = read('index.html');
const styles = read('styles.css');

// ---------------------------------------------------------------- 1. extract
console.log('\n== 1. The splash template still parses ==');

const splashSrc = mainJs.match(/const splash = `([\s\S]*?)`;\s*\n\s*startupWindow\.loadURL/);
ok('the splash template is findable in main.js', !!splashSrc);
if (!splashSrc) {
  console.log('\nBRAND SPLASH SMOKE FAILED (cannot continue without the template)');
  process.exit(1);
}

// Render the template exactly as the shell does. Two interpolations now — the
// theme, and the escape hatch's delay — and both are read out of main.js rather
// than stubbed, so a renamed or deleted constant fails here rather than throwing
// inside the splash at launch.
const escapeMs = (mainJs.match(/const STARTUP_ESCAPE_AFTER_MS = (\d+);/) || [])[1];
ok('the skip delay is declared in main.js', !!escapeMs, 'STARTUP_ESCAPE_AFTER_MS');
const render = (lightSplash) => {
  // eslint-disable-next-line no-new-func
  return new Function('lightSplash', 'STARTUP_ESCAPE_AFTER_MS', 'return `' + splashSrc[1] + '`;')(lightSplash, Number(escapeMs));
};

const dark = render(false);
const light = render(true);

ok('dark render is a complete document', dark.startsWith('<!doctype html>') && dark.trim().endsWith('</html>'));
ok('light render is a complete document', light.startsWith('<!doctype html>') && light.trim().endsWith('</html>'));
ok('no unsubstituted ${...} survived', !/\$\{/.test(dark) && !/\$\{/.test(light));
ok('the escape hatch renders with a real delay, not a placeholder',
  /skip\.hidden=false;\},(\d{4,})\)/.test(dark) && !/\$\{/.test(dark), 'the skip button never appears');

// ---------------------------------------------------------------- 2. themes
console.log('\n== 2. Both themes render their own palette ==');

ok('dark asks the OS for a dark color-scheme', /name="color-scheme" content="dark"/.test(dark));
ok('light asks the OS for a light color-scheme', /name="color-scheme" content="light"/.test(light));
ok('dark body carries no light class', /<body class="">/.test(dark), dark.match(/<body[^>]*>/)[0]);
ok('light body carries the light class', /<body class="light">/.test(light), light.match(/<body[^>]*>/)[0]);

// The window's own backgroundColor is the first frame the OS paints. If it
// disagrees with the document, a light-mode user sees a navy flash on launch.
const bgOf = (src) => (src.match(/backgroundColor: shellUsesLight\(\) \? '([^']+)' : '([^']+)'/) || []).slice(1);
const winBg = bgOf(mainJs);
ok('the window background is theme-aware', winBg.length === 2, 'shellUsesLight() not used for backgroundColor');
ok('and agrees with the splash background',
  winBg.length === 2 && winBg[0] === '#f2f7fc' && winBg[1] === '#04122b',
  JSON.stringify(winBg));

// ---------------------------------------------------------------- 3. palette
console.log('\n== 3. Every colour matches styles.css ==');

// Parse `:root{...}` and `body.light{...}` into token maps. Last declaration wins,
// which is what the cascade does — styles.css declares :root and body.light more
// than once.
function tokens(css, selector) {
  const out = {};
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}', 'g');
  let m;
  while ((m = re.exec(css))) {
    for (const decl of m[1].split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const k = decl.slice(0, i).trim();
      const v = decl.slice(i + 1).trim();
      if (k.startsWith('--') && v) out[k] = v;
    }
  }
  return out;
}

const appDark = tokens(styles, ':root');
const appLight = tokens(styles, 'body.light');
const splashDark = tokens(dark, ':root');
const splashLight = tokens(light, 'body.light');

ok('styles.css still exposes :root tokens', Object.keys(appDark).length > 5);
ok('styles.css still exposes body.light tokens', Object.keys(appLight).length > 5);

// Same-meaning tokens must be EQUAL. A shared name is not required (the splash
// says --blue where the app says --primary), but a shared meaning is.
const SAME_MEANING = [
  ['--bg', '--bg'],
  ['--text', '--text'],
  ['--muted', '--muted'],
  ['--blue', '--primary'],
  ['--line', '--border']
];
for (const [mine, theirs] of SAME_MEANING) {
  ok(`dark ${mine} equals styles.css ${theirs}`, splashDark[mine] === appDark[theirs],
    `${mine}: ${splashDark[mine]}  vs  ${theirs}: ${appDark[theirs]}`);
  ok(`light ${mine} equals styles.css ${theirs}`, splashLight[mine] === appLight[theirs],
    `${mine}: ${splashLight[mine]}  vs  ${theirs}: ${appLight[theirs]}`);
}

// Every literal colour in the splash must exist in styles.css. This is the half
// that catches a NEW colour invented on the splash that the app has never used.
const hexes = [...new Set((dark.match(/#[0-9a-fA-F]{3,6}\b/g) || []).map((h) => h.toLowerCase()))];
const stylesLower = styles.toLowerCase();
const foreign = hexes.filter((h) => !stylesLower.includes(h));
ok(`all ${hexes.length} splash colours exist in styles.css`, foreign.length === 0,
  'not in styles.css: ' + foreign.join(', '));

// ---------------------------------------------------------------- 4. ambience
console.log('\n== 4. The ambience is built from the brand blue ==');

// Returns '' rather than throwing on a missing or malformed token: a suite that
// crashes on a broken splash reports a stack trace instead of the failures.
const rgbOf = (value) => {
  const h = String(value == null ? '' : value).trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '';
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
};
for (const [label, toks] of [['dark', splashDark], ['light', splashLight]]) {
  const want = rgbOf(toks['--blue']);
  ok(`${label} defines a brand blue to tint with`, want !== '', `${label} --blue is '${toks['--blue']}'`);
  for (const key of ['--glow', '--wash']) {
    const got = String(toks[key] || '').match(/rgba?\(([^)]+)\)/);
    const triple = got ? got[1].split(',').slice(0, 3).map((s) => s.trim()).join(',') : '';
    ok(`${label} ${key} is tinted with ${label} --blue`, want !== '' && triple === want,
      `${key}: ${triple}  vs  --blue: ${want}`);
  }
}

// ---------------------------------------------------------------- 5. old brand
console.log('\n== 5. The pre-rebrand palette is gone from the shell ==');

const OLD = ['8b5cf6', '9b6cff', 'e1c5ff', 'd8b9ff', 'a06bff', 'e0c7ff', 'c296ff', '0f1020', 'f5f2ff', 'a7a1b7'];
for (const [file, src] of [['main.js', mainJs], ['index.html', indexHtml], ['preload.js', preloadJs]]) {
  const found = OLD.filter((c) => src.toLowerCase().includes(c));
  ok(`${file} carries no pre-rebrand colour`, found.length === 0, found.join(', '));
}
// --accent's old cyan is handled deliberately at runtime (a stored preference is
// migrated in applyTheme), so db.js and modules/ai.js legally still name it.
ok('the old accent is still migrated, not merely deleted',
  /'#22d3ee'/.test(appJs) && /DB\.defaultSettings\.accent/.test(appJs));

// ---------------------------------------------------------------- 6. contracts
console.log('\n== 6. The screen\'s contracts hold ==');

for (const id of ['status', 'detail', 'track', 'fill']) {
  ok(`the splash still has #${id}`, dark.includes(`id="${id}"`));
}
ok('the splash still defines window.__setStatus', /window\.__setStatus\s*=/.test(dark));
ok('__setStatus still takes (message, detail, progress)',
  /function\s*\(message,\s*detail,\s*progress\)/.test(dark));
ok('main still calls __setStatus with all three', /window\.__setStatus\(/.test(mainJs)
  && /JSON\.stringify\(startupStatus\.detail\)/.test(mainJs)
  && /JSON\.stringify\(startupStatus\.progress\)/.test(mainJs));

// The splash is a data: URL loaded before anything else. It must not wait on the
// network — a webfont that arrives late would repaint the first thing a user sees.
ok('the splash fetches nothing (no remote url)', !/https?:\/\//.test(dark));
ok('the splash imports no stylesheet or font', !/<link[^>]+stylesheet/i.test(dark) && !/@import/.test(dark));

ok('the ambient animation honours prefers-reduced-motion', /prefers-reduced-motion/.test(dark));
ok('and so does the indeterminate bar', /prefers-reduced-motion[^}]*\}[\s\S]{0,80}\.fill\{animation:none\}/.test(dark),
  'reduced motion does not stop .fill');

// ---------------------------------------------------------------- 7. plumbing
console.log('\n== 7. The renderer still tells main which theme it is in ==');

ok('main registers the theme channel', /ipcMain\.on\('theme-changed'/.test(mainJs));
// Sender validation moved to the frame check every privileged channel shares:
// a WebContents is not a frame, and the Designer previews the exported site in a
// same-origin iframe that would otherwise share this one.
ok('main validates the sender on it', /theme-changed', \(event, theme\) => \{\s*\n\s*if \(!fromMainFrame\(event, win\)\) return;/.test(mainJs));
ok('main accepts only dark/light/system', /next !== 'dark' && next !== 'light' && next !== 'system'/.test(mainJs));
ok('main persists it', /s\.theme = next;/.test(mainJs));
ok('registerThemeIpc is actually called', /registerThemeIpc\(\);/.test(mainJs));
ok('the preload bridge exposes setTheme', /setTheme: \(theme\) => ipcRenderer\.send\('theme-changed', theme\)/.test(preloadJs));
ok('the renderer calls it from applyTheme', /window\.pallettai\.setTheme\(settings\.theme/.test(appJs));

// The subtle one: saveState() rebuilds the same file the theme is stored in. If it
// ever goes back to writing a fresh object literal, the theme is dropped the first
// time a user moves the window — and the splash silently reverts to dark.
ok('saveState preserves keys it does not own', /function saveState\(\)[\s\S]*?const s = loadState\(\);/.test(mainJs),
  'saveState no longer starts from loadState() — the stored theme would be erased');
const themeWrites = mainJs.match(/\.theme\s*=(?!=)/g) || [];
ok('the theme is written by exactly one place, the theme channel', themeWrites.length === 1,
  themeWrites.length + ' writers for the stored theme');
ok('and saveState() is not one of them', /function saveState\(\)[^]*?\n  \}/.test(mainJs)
  && !/\.theme/.test(mainJs.slice(mainJs.indexOf('function saveState()'), mainJs.indexOf('function scheduleSaveState()'))));

// ---------------------------------------------------------------- dump
const dumpAt = process.argv.indexOf('--dump');
if (dumpAt > -1 && process.argv[dumpAt + 1]) {
  const dir = path.resolve(process.argv[dumpAt + 1]);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'splash-dark.html'), dark);
  fs.writeFileSync(path.join(dir, 'splash-light.html'), light);
  console.log('\nwrote splash-dark.html / splash-light.html to ' + dir);
}

console.log('\n' + (failed === 0 ? 'BRAND SPLASH SMOKE PASSED' : 'BRAND SPLASH SMOKE FAILED: ' + failed));
process.exit(failed === 0 ? 0 : 1);
