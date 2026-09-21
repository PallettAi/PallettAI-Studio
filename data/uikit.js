'use strict';

/* ============================================================
   UI shell — the small amount of behaviour the look needs
   ------------------------------------------------------------
   The studio's appearance is almost entirely CSS. This is the thin
   layer of behaviour CSS cannot express on its own:

     • a toast that reads like a status card and drains on a timer
     • metric numbers that count instead of jumping
     • a view swap the browser cross-fades instead of snapping
     • the top bar lifting once the view scrolls under it
     • a shortcut sheet built only from shortcuts that really exist
     • recents for the command palette

   Every pure helper is exported on its own so the smoke test can
   check it without a browser. Nothing here reaches into app.js
   internals: it uses the same globals app.js already exposes
   (CommandPalette, ICONS) and the DOM the shell already renders.
   ============================================================ */

const UISHELL_TOAST_MS = 3000;
const UISHELL_COUNT_MS = 620;
const UISHELL_RECENTS_KEY = 'pallettai.cmd.recents.v1';
const UISHELL_RECENTS_MAX = 6;

/* The shortcuts below are the ones app.js actually binds — this sheet is a
   label for existing behaviour, never a promise of new behaviour. */
const UISHELL_SHORTCUT_GROUPS = [
  {
    title: 'Anywhere',
    items: [
      { keys: ['K'], mod: true, label: 'Open the command palette' },
      { keys: ['?'], label: 'Show this sheet' },
      { keys: ['Esc'], label: 'Close the palette, a dialog or Copilot' }
    ]
  },
  {
    title: 'Command palette',
    items: [
      { keys: ['↑', '↓'], label: 'Move through the results' },
      { keys: ['Enter'], label: 'Run the highlighted command' }
    ]
  },
  {
    title: 'Copilot',
    items: [
      { keys: ['Enter'], label: 'Send the request' },
      { keys: ['↑', '↓'], label: 'Recall an earlier request' },
      { keys: ['/'], label: 'Show the action menu' }
    ]
  },
  {
    title: 'Open project',
    items: [
      { keys: ['Z'], mod: true, label: 'Undo the last edit' },
      { keys: ['⇧', 'Z'], mod: true, label: 'Redo the last edit' },
      { keys: ['Enter'], label: 'Select the focused section' }
    ]
  }
];

const UISHELL_TOAST_ICON = { ok: 'check', err: 'close', warn: 'info', info: 'info' };

function uishellMac() {
  try {
    if (typeof window !== 'undefined' && window.pallettai && window.pallettai.platform) {
      return window.pallettai.platform === 'darwin';
    }
    if (typeof navigator !== 'undefined') {
      const p = navigator.platform || navigator.userAgent || '';
      return /Mac|iPhone|iPad|iPod/.test(p);
    }
  } catch (e) {}
  return false;
}

/* On macOS the modifier stacks into one glyph; everywhere else it is a word,
   which is why the sheet renders keys through the platform rather than in CSS. */
function uishellKeyLabels(item, mac) {
  const out = [];
  if (item.mod) out.push(mac ? '⌘' : 'Ctrl');
  return out.concat(item.keys || []);
}

/* ---------- Toast ---------- */

/* ok/err/warn are decisions, not decoration: ok means the action landed, err
   means it did not and the message explains why, warn means it landed with a
   catch the creator should read. */
function uishellToastTone(ok, variant) {
  const v = String(variant || '').toLowerCase();
  if (UISHELL_TOAST_ICON[v]) return v;
  if (ok === true) return 'ok';
  if (ok === false) return 'err';
  return 'info';
}

/* A receipt you cannot finish reading is not a notification. Short messages get
   the usual beat; long ones get room for the extra lines, capped so a wall of
   text never becomes permanent. */
function uishellToastMs(msg, explicit) {
  const asked = Number(explicit);
  if (isFinite(asked) && asked > 0) return asked;
  const len = String(msg == null ? '' : msg).length;
  if (len <= 60) return UISHELL_TOAST_MS;
  return Math.min(9000, UISHELL_TOAST_MS + Math.ceil((len - 60) / 40) * 1200);
}

/* ---------- Numbers ---------- */

/* Reads the first number out of a display string and remembers everything
   around it, so "1.2 MB" can be re-rendered at any point of its animation
   without losing the unit and "42" without losing its decimals. */
function uishellParseNumeric(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return null;
  const m = raw.match(/^(.*?)(\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  const digits = m[2];
  const decimals = (digits.split('.')[1] || '').length;
  const value = Number(digits.replace(/,/g, ''));
  if (!isFinite(value)) return null;
  return { prefix: m[1], suffix: m[3], decimals, grouped: digits.indexOf(',') !== -1, value, text: raw };
}

function uishellFormatNumeric(spec, value) {
  if (!spec) return '';
  const n = Math.max(0, Number(value) || 0);
  const fixed = n.toFixed(spec.decimals);
  const body = spec.grouped
    ? Number(fixed).toLocaleString(undefined, { minimumFractionDigits: spec.decimals, maximumFractionDigits: spec.decimals })
    : fixed;
  return (spec.prefix || '') + body + (spec.suffix || '');
}

function uishellNow() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/* A window that is not on screen can have its frame loop suspended outright. */
function uishellVisible() {
  return !(typeof document !== 'undefined' && document.hidden);
}

function uishellReducedMotion() {
  try {
    if (typeof document !== 'undefined' && document.body && document.body.classList.contains('no-motion')) return true;
    if (typeof matchMedia === 'function') return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}
  return false;
}

/* Older machines should get the same product, not a slower imitation of it.
   The app is mostly DOM/CSS, so the expensive parts are visual effects rather
   than the data model: backdrop filters, large shadows and long transitions.
   Chromium exposes two useful hints; `saveData` catches a user's explicit
   low-power preference, while the conservative hardware thresholds cover older
   desktops where deviceMemory is not available. */
function uishellLowPower() {
  try {
    if (typeof navigator === 'undefined') return false;
    const cores = Number(navigator.hardwareConcurrency || 0);
    const memory = Number(navigator.deviceMemory || 0);
    const saveData = !!(navigator.connection && navigator.connection.saveData);
    const softwareRendering = !!(typeof window !== 'undefined' && window.pallettai && window.pallettai.softwareRendering);
    return softwareRendering || saveData || (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4);
  } catch (e) {
    return false;
  }
}

function uishellApplyPerformanceMode() {
  if (typeof document === 'undefined' || !document.body) return false;
  const low = uishellLowPower() || document.body.dataset.forceLowPower === 'true';
  document.body.classList.toggle('low-power', low);
  document.body.dataset.performanceMode = low ? 'low' : 'full';
  return low;
}

/* ============================================================
   DOM side
   ============================================================ */

const uishellState = {
  ready: false,
  timer: null,
  scrollBound: false,
  metricsBound: false,
  paletteBound: false,
  seen: {},
  sheet: { el: null, open: false, prevFocus: null }
};

function uishellIcon(name) {
  if (typeof ICONS !== 'undefined' && ICONS.svg) return ICONS.svg(name);
  return '';
}

function uishellTyping(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return !!el.isContentEditable;
}

function uishellByTag(id) {
  return (typeof document !== 'undefined' && document.getElementById) ? document.getElementById(id) : null;
}

function uishellAnswer(kind, detail) {
  const out = { ok: kind !== 'err' };
  if (detail) out.detail = detail;
  return out;
}

/* ---------- Toast ---------- */

function uishellToastNode() {
  const t = uishellByTag('appToast');
  if (!t) return null;
  if (!t.querySelector || !t.querySelector('.toast-ico')) {
    t.innerHTML = '<span class="toast-ico" aria-hidden="true"></span>'
      + '<span class="toast-body"></span>'
      + '<span class="toast-bar" aria-hidden="true"><span></span></span>';
  }
  return t;
}

/* Renders the status card. Returns how long it will stay up, which is what the
   draining bar is told to match. */
function uishellPaintToast(msg, ok, opts) {
  const t = uishellToastNode();
  if (!t) return 0;
  const o = opts || {};
  const tone = uishellToastTone(ok, o.variant);
  const ms = uishellToastMs(msg, o.ms);
  const body = t.querySelector('.toast-body');
  const ico = t.querySelector('.toast-ico');
  if (body) body.textContent = String(msg == null ? '' : msg);
  if (ico) ico.innerHTML = uishellIcon(UISHELL_TOAST_ICON[tone]);
  t.className = 'toast show ' + tone;
  t.style.setProperty('--toast-ms', ms + 'ms');
  /* A bar that is already part-way down must not carry over into the next
     message, so the animation is torn down and rebuilt explicitly. */
  const bar = t.querySelector('.toast-bar span');
  if (bar) {
    bar.style.animation = 'none';
    void bar.offsetWidth;
    bar.style.animation = '';
  }
  clearTimeout(uishellState.timer);
  uishellState.timer = setTimeout(() => {
    if (t.classList) t.classList.remove('show');
  }, ms);
  return ms;
}

/* ---------- Numbers ---------- */

function uishellNumericTarget(el) {
  if (!el) return null;
  const kids = el.children ? Array.prototype.slice.call(el.children) : [];
  for (let i = 0; i < kids.length; i++) {
    if (uishellParseNumeric(kids[i].textContent)) return kids[i];
  }
  return uishellParseNumeric(el.textContent) ? el : null;
}

/* Animates one reading from zero. The same value is never animated twice: the
   dashboard re-renders on every save, and a number that re-counts itself while
   nothing changed reads as a glitch rather than as new information.

   The count is a decoration on top of a reading, so the reading wins every
   time: the final value is written by whichever of the frame loop or the
   settle timer gets there first. A suspended frame loop (a backgrounded
   window, a sleeping laptop, a main thread busy generating a site) can then
   never leave the wrong number on screen. */
function uishellCountUp(el) {
  const target = uishellNumericTarget(el);
  if (!target) return null;
  const spec = uishellParseNumeric(target.textContent);
  if (!spec) return null;
  const key = (el.dataset && el.dataset.go ? el.dataset.go : el.className || '') + '|' + spec.text;
  if (uishellState.seen[key]) return null;
  uishellState.seen[key] = true;
  const to = spec.value;
  const finish = () => { target.textContent = uishellFormatNumeric(spec, to); };
  if (!to || uishellReducedMotion() || typeof requestAnimationFrame !== 'function' || !uishellVisible()) {
    finish();
    return to;
  }
  const dur = UISHELL_COUNT_MS;
  const started = uishellNow();
  let done = false;
  const settle = () => {
    if (done) return;
    done = true;
    finish();
  };
  const step = (now) => {
    if (done) return;
    const at = (typeof now === 'number' && isFinite(now)) ? now : uishellNow();
    const t = Math.min(1, Math.max(0, (at - started) / dur));
    const eased = 1 - Math.pow(1 - t, 3);
    target.textContent = uishellFormatNumeric(spec, to * eased);
    if (t < 1) requestAnimationFrame(step);
    else settle();
  };
  setTimeout(settle, dur + 250);
  requestAnimationFrame(step);
  return to;
}

function uishellObserveMetrics() {
  const host = uishellByTag('dashStats');
  if (!host || uishellState.metricsBound) return;
  uishellState.metricsBound = true;
  const run = () => {
    if (!host.querySelectorAll) return;
    Array.prototype.forEach.call(host.querySelectorAll('.sc-value'), uishellCountUp);
  };
  /* childList only, on the strip itself: the band is replaced wholesale on each
     render, while the counting happens deeper down. Watching the subtree would
     mean watching our own writes. */
  if (typeof MutationObserver === 'function') {
    new MutationObserver(run).observe(host, { childList: true });
  }
  run();
}

/* ---------- Top bar ---------- */

function uishellTopbarScroll() {
  const main = document.querySelector ? document.querySelector('.main') : null;
  if (!main || uishellState.scrollBound) return;
  uishellState.scrollBound = true;
  let queued = false;
  const apply = () => {
    queued = false;
    document.body.classList.toggle('scrolled', main.scrollTop > 4);
  };
  main.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
    else setTimeout(apply, 16);
  }, { passive: true });
  apply();
}

/* ---------- View swaps ---------- */

/* Only a real navigation gets a transition. If the API is missing, motion is
   unwelcome, or the target view is already on screen, the work just runs. */
function uishellViewTransition(fn) {
  const active = document.querySelector ? document.querySelector('.view.active') : null;
  const can = typeof document !== 'undefined'
    && typeof document.startViewTransition === 'function'
    && active
    && !uishellReducedMotion();
  if (!can) { fn(); return false; }
  try {
    document.startViewTransition(fn);
    return true;
  } catch (e) {
    fn();
    return false;
  }
}

/* ---------- Command palette recents ---------- */

function uishellRecentsLoad() {
  try {
    const raw = localStorage.getItem(UISHELL_RECENTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, UISHELL_RECENTS_MAX) : [];
  } catch (e) {
    return [];
  }
}

function uishellRecentsSave(list) {
  try { localStorage.setItem(UISHELL_RECENTS_KEY, JSON.stringify(list.slice(0, UISHELL_RECENTS_MAX))); } catch (e) {}
}

function uishellRemember(id) {
  if (!id) return [];
  const list = uishellRecentsLoad().filter((x) => x !== id);
  list.unshift(id);
  uishellRecentsSave(list);
  return list.slice(0, UISHELL_RECENTS_MAX);
}

/* The palette sorts by match quality (see data/command-palette.js). An empty
   query has no quality to sort by, so the shell lends it one: commands this
   creator has already used, newest first, then everything else untouched. */
function uishellInstallPalette() {
  if (uishellState.paletteBound) return;
  if (typeof CommandPalette === 'undefined' || typeof CommandPalette.filterCommands !== 'function') return;
  uishellState.paletteBound = true;
  const base = CommandPalette.filterCommands;
  const recentFirst = (list) => {
    const recent = uishellRecentsLoad();
    if (!recent.length) return list;
    const rank = (c) => {
      const i = recent.indexOf(c.id);
      return i === -1 ? UISHELL_RECENTS_MAX + 1 : i;
    };
    return list.slice().sort((a, b) => rank(a) - rank(b));
  };
  CommandPalette.filterCommands = function (query, commands) {
    const list = base(query, commands);
    return String(query || '').trim() ? list : recentFirst(list);
  };
  CommandPalette.remember = uishellRemember;

  /* Remember what gets run. The row handler belongs to app.js, so this listens
     on the way down rather than replacing it. */
  document.addEventListener('click', (e) => {
    const row = e.target && e.target.closest ? e.target.closest('#cmdList li[data-cmd]') : null;
    if (row) uishellRemember(row.dataset.cmd);
  }, true);

  /* app.js rewrites the result list on every keystroke, so the row affordance is
     re-applied after each render instead of being injected once. */
  const list = uishellByTag('cmdList');
  if (list && typeof MutationObserver === 'function') {
    new MutationObserver(() => uishellDecorateCmdRows()).observe(list, { childList: true });
    uishellDecorateCmdRows();
  }
}

function uishellEsc(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Marks the letters the query actually matched, using the same ranges the
   ranking used — so what is highlighted always explains why the row is there. */
function uishellHighlightRow(li, query) {
  if (!li || !li.querySelector) return false;
  if (typeof CommandPalette === 'undefined' || typeof CommandPalette.matchRanges !== 'function') return false;
  const b = li.querySelector('b');
  if (!b) return false;
  const title = b.textContent || '';
  const ranges = CommandPalette.matchRanges(query, title);
  if (!ranges.length) return false;
  let html = '';
  let at = 0;
  ranges.forEach((r) => {
    const start = Math.max(0, Math.min(title.length, r[0]));
    const end = Math.max(start, Math.min(title.length, r[1]));
    if (end <= at) return;
    html += uishellEsc(title.slice(at, start)) + '<mark>' + uishellEsc(title.slice(start, end)) + '</mark>';
    at = end;
  });
  html += uishellEsc(title.slice(at));
  if (b.innerHTML === html) return false;
  b.innerHTML = html;
  return true;
}

function uishellDecorateCmdRows() {
  const list = uishellByTag('cmdList');
  if (!list || !list.querySelectorAll) return 0;
  const input = uishellByTag('cmdInput');
  const query = input ? input.value : '';
  let added = 0;
  Array.prototype.forEach.call(list.querySelectorAll('li[data-cmd]'), (li) => {
    if (!li.querySelector('.cmd-go')) {
      const go = document.createElement('span');
      go.className = 'cmd-go';
      go.setAttribute('aria-hidden', 'true');
      go.textContent = '↵';
      li.appendChild(go);
      added++;
    }
    uishellHighlightRow(li, query);
  });
  return added;
}

/* ---------- Shortcut sheet ---------- */

function uishellSheetHtml(mac) {
  const groups = UISHELL_SHORTCUT_GROUPS.map((g) => {
    const rows = g.items.map((it) => {
      const keys = uishellKeyLabels(it, mac).map((k) => '<kbd>' + k + '</kbd>').join('');
      return '<div class="sheet-row"><span>' + it.label + '</span><span class="sheet-keys">' + keys + '</span></div>';
    }).join('');
    return '<div class="sheet-group"><h4>' + g.title + '</h4>' + rows + '</div>';
  }).join('');
  return '<div class="sheet-scrim" data-sheet-close></div>'
    + '<div class="sheet-card" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabindex="-1">'
    + '<h3>Keyboard shortcuts</h3><p>Shortcuts that work in the studio right now.</p>'
    + '<div class="sheet-grid">' + groups + '</div>'
    + '<div class="sheet-foot"><span>Press <b>?</b> again to close</span>'
    + '<button class="btn ghost small" data-sheet-close>Close</button></div>'
    + '</div>';
}

function uishellSheet() {
  if (uishellState.sheet.el) return uishellState.sheet.el;
  if (!document.body) return null;
  const root = document.createElement('div');
  root.className = 'sheet-root';
  root.id = 'shortcutSheet';
  root.hidden = true;
  root.innerHTML = uishellSheetHtml(uishellMac());
  document.body.appendChild(root);
  uishellState.sheet.el = root;
  root.addEventListener('click', (e) => {
    const close = e.target && e.target.closest ? e.target.closest('[data-sheet-close]') : null;
    if (close) closeSheet();
  });
  return root;
}

function openSheet() {
  const root = uishellSheet();
  if (!root) return null;
  uishellState.sheet.prevFocus = document.activeElement;
  root.hidden = false;
  uishellState.sheet.open = true;
  const card = root.querySelector('.sheet-card');
  if (card && card.focus) card.focus();
  return uishellAnswer('ok');
}

function closeSheet() {
  const root = uishellState.sheet.el;
  if (!root) return null;
  root.hidden = true;
  uishellState.sheet.open = false;
  const back = uishellState.sheet.prevFocus;
  if (back && back.focus) { try { back.focus(); } catch (e) {} }
  uishellState.sheet.prevFocus = null;
  return uishellAnswer('ok');
}

function toggleSheet() {
  const root = uishellSheet();
  if (!root) return null;
  return uishellState.sheet.open ? closeSheet() : openSheet();
}

/* ---------- Boot ---------- */

function uishellBindKeys() {
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    /* A dialog that cannot be dismissed with Escape is a dialog people try to
       close three times before finding the button. */
    if (e.key === 'Escape' && uishellState.sheet.open) {
      e.preventDefault();
      closeSheet();
      return;
    }
    const asked = e.key === '?' || (e.key === '/' && e.shiftKey);
    if (!asked) return;
    if (uishellState.sheet.open) { e.preventDefault(); closeSheet(); return; }
    if (uishellTyping(e.target)) return;
    const modal = uishellByTag('modalBackdrop');
    const palette = uishellByTag('cmdPalette');
    if (modal && !modal.hidden) return;
    if (palette && !palette.hidden) return;
    e.preventDefault();
    openSheet();
  });
}

/* Called once from app.js after the shell markup exists. Everything here is
   additive, so a failure in any one piece cannot stop the studio booting. */
function uishellInitAppShell() {
  if (typeof document === 'undefined' || uishellState.ready) return uishellAnswer('ok');
  uishellState.ready = true;
  uishellApplyPerformanceMode();
  const jobs = [uishellTopbarScroll, uishellObserveMetrics, uishellInstallPalette, uishellBindKeys];
  jobs.forEach((job) => {
    try { job(); } catch (e) { console.warn('UI shell: ' + job.name + ' failed', e); }
  });
  return uishellAnswer('ok');
}

const UIShell = {
  TOAST_MS: UISHELL_TOAST_MS,
  COUNT_MS: UISHELL_COUNT_MS,
  RECENTS_KEY: UISHELL_RECENTS_KEY,
  RECENTS_MAX: UISHELL_RECENTS_MAX,
  SHORTCUT_GROUPS: UISHELL_SHORTCUT_GROUPS,
  TOAST_ICON: UISHELL_TOAST_ICON,
  state: uishellState,
  isMac: uishellMac,
  keyLabels: uishellKeyLabels,
  toastTone: uishellToastTone,
  toastMs: uishellToastMs,
  parseNumeric: uishellParseNumeric,
  formatNumeric: uishellFormatNumeric,
  reducedMotion: uishellReducedMotion,
  lowPower: uishellLowPower,
  applyPerformanceMode: uishellApplyPerformanceMode,
  numericTarget: uishellNumericTarget,
  toast: uishellPaintToast,
  countUp: uishellCountUp,
  observeMetrics: uishellObserveMetrics,
  topbarScroll: uishellTopbarScroll,
  viewTransition: uishellViewTransition,
  remember: uishellRemember,
  decorateCmdRows: uishellDecorateCmdRows,
  highlightRow: uishellHighlightRow,
  sheetHtml: uishellSheetHtml,
  openSheet,
  closeSheet,
  toggleSheet,
  initAppShell: uishellInitAppShell
};

if (typeof module !== 'undefined' && module.exports) module.exports = UIShell;
if (typeof window !== 'undefined') window.UIShell = UIShell;
