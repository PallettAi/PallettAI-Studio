'use strict';

/*
  The observer half of the widget-studio smoke.

  Loaded into the REAL application (the harness runs the Electron binary against
  the project root, exactly as `npm start` does). It does three things no Node
  suite can:

    1. FIXES THE MODEL'S ANSWER. The panel compiles through the preload bridge
       into the main process, so the model lives here. Installing a canned reply
       with WidgetGenerator.setCompleter() makes the whole path hermetic — no API
       key, no network, no dependence on what a model says today — while every
       line AFTER the answer (parsing, sanitising, tokens, the injector, the
       preview) stays the real implementation.

    2. DRIVES THE PANEL, through the in-page driver the harness names in
       PALLETTAI_SMOKE_PAGE, and reports what happened as a machine-readable
       block.

    3. LOADS THE EXPORTED PAGE IN A REAL CHROMIUM WINDOW, offscreen, and looks
       inside the widget's shadow root: did the element upgrade, did the shadow
       DOM render, is the styling applied, and does pressing the tool's own
       button change the number it shows. "The export ships a working widget" is
       a claim about a browser, so it is checked in one.

  Inert unless PALLETTAI_SMOKE_HOOK names it, so it is not a path into a shipped
  build: with the variable unset it returns immediately.
*/

const hookPath = process.env.PALLETTAI_SMOKE_HOOK;
if (!hookPath) return;

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const PAGE_FILE = process.env.PALLETTAI_SMOKE_PAGE;
const result = {
  booted: false,
  bootError: '',
  driverRan: false,
  asks: [],
  mount: null,
  afterRemove: null
};

let finished = false;
function emit() {
  if (finished) return;
  finished = true;
  process.stdout.write('\nSMOKE_RESULT ' + JSON.stringify(result) + '\nSMOKE_END\n');
}
function fail(message) {
  result.bootError = String(message || 'unknown failure');
  emit();
  app.exit(1);
}
function why(e) { return (e && e.message) ? e.message : String(e); }

if (!PAGE_FILE) {
  fail('PALLETTAI_SMOKE_PAGE was not set, so there is no driver to run');
} else {
  start(fs.readFileSync(PAGE_FILE, 'utf8'));
}

function start(PAGE) {
  /*
    The model's answer. Recorded rather than merely returned: WHAT the main
    process was asked is part of the end-to-end claim (the panel's prompt, and
    the project's own palette in the system prompt), and a request that never
    arrives would otherwise look like a passing compile.
  */
  const fixture = require(path.join(__dirname, 'fixtures', 'widget-model-reply.js'));
  const Generator = require(path.join(__dirname, '..', 'modules', 'widget-generator.js'));
  Generator.setCompleter((request) => {
    const req = request || {};
    const system = String(req.system || '');
    result.asks.push({
      prompt: String(req.prompt || ''),
      systemBytes: system.length,
      systemIsWidgetContract: system.indexOf('OUTPUT FORMAT') !== -1 && system.indexOf('pallet-widget') !== -1,
      systemPrimary: (system.match(/--color-primary:\s*([^\n;]+)/) || [])[1] || '',
      userBytes: String(req.user || '').length
    });
    return Promise.resolve(fixture.reply);
  });

  let attached = false;
  app.on('browser-window-created', (_event, win) => {
    if (!(win instanceof BrowserWindow)) return;
    // The startup/update splash is a different window; only the shell is driven.
    if (win.getTitle && /splash|updating|update/i.test(win.getTitle())) return;
    // ...and the probe windows below are ours, not the app's.
    if (attached) return;
    attached = true;
    attach(win);
  });

  function attach(win) {
    win.webContents.on('render-process-gone', (_e, d) => fail('renderer gone: ' + JSON.stringify(d)));
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2 && !/EGL|GLDisplay|viz_main|gl_display|gl_initializer|task_policy|devtools|Autofill|deprecated/i.test(message)) {
        process.stdout.write('    [app] ' + message + '\n');
      }
    });
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 4000));
      try { await drive(win, PAGE); } catch (e) { fail('driver error: ' + why(e)); }
    });
  }

  async function drive(win, PAGE) {
    let outcome;
    try {
      outcome = await win.webContents.executeJavaScript(PAGE, true);
    } catch (e) {
      fail('the in-page driver could not run: ' + why(e));
      return;
    }
    result.driverRan = true;
    // The two full documents are carried separately: they are hundreds of
    // kilobytes and only the probe needs them.
    const exportHtml = (outcome && outcome.exportHtml) || '';
    const afterRemoveHtml = (outcome && outcome.afterRemoveHtml) || '';
    Object.keys(outcome || {}).forEach((key) => {
      if (key === 'exportHtml' || key === 'afterRemoveHtml') return;
      result[key] = outcome[key];
    });
    result.exportBytes = exportHtml.length;
    result.afterRemoveBytes = afterRemoveHtml.length;

    try {
      if (exportHtml) result.mount = await probe(exportHtml, true);
      if (afterRemoveHtml) result.afterRemove = await probe(afterRemoveHtml, false);
    } catch (e) {
      fail('the exported page could not be opened: ' + why(e));
      return;
    }

    if (!result.booted) fail(result.bootError || 'the app did not boot');
    else { emit(); app.exit(0); }
  }
}

/*
  The exported page, in a browser, offscreen.

  The window is a real Chromium with the document's own CSP in force, so a
  policy that refused the widget's inline script would show up here as a console
  refusal rather than as a mystery on a client's site.
*/
async function probe(html, interactive) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pallettai-widget-page-'));
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false }
  });

  const console_ = [];
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2 && !/EGL|GLDisplay|viz_main|gl_display|gl_initializer|task_policy|devtools|Autofill/i.test(message)) {
      console_.push(String(message).slice(0, 300));
    }
  });

  try {
    await win.loadFile(file);
    // The engine mounts on the DOMContentLoaded path (and retries on a bounded
    // timer when a definition is still missing), so give the page a moment
    // before reading its shadow DOM.
    await new Promise((r) => setTimeout(r, 400));
    const value = await win.webContents.executeJavaScript(probeScript(interactive), true);
    value.consoleErrors = console_.slice(0, 5);
    return value;
  } finally {
    try { win.destroy(); } catch (e) { /* already gone */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
}

/*
  Read from inside the exported page. The widget lives in a shadow root, which
  is the encapsulation the whole design rests on, so this reaches for it the way
  a visitor's browser would rather than grepping the markup.
*/
function probeScript(interactive) {
  const probeValues = require(path.join(__dirname, 'fixtures', 'widget-model-reply.js')).probe;
  return `(() => {
  const out = {};
  const el = document.querySelector('pallet-widget, pallett-widget');
  out.found = !!el;
  const pageText = (document.body.innerText || '').replace(/\\s+/g, ' ').trim();
  out.bodyText = pageText.slice(0, 240);
  // Read from the RENDERED text, not the markup: a note that is in the source
  // but not on the page is the silent gap this suite exists to catch.
  out.bodyHasNote = pageText.indexOf('no longer in the project') !== -1;
  out.engineScripts = document.querySelectorAll('[data-pallett-widget-runtime]').length;
  out.configScripts = document.querySelectorAll('[data-pallett-widget]').length;
  out.elementDefined = !!customElements.get('pallet-widget');
  out.aliasDefined = !!customElements.get('pallett-widget');
  if (!el) return out;

  const shadow = el.shadowRoot;
  out.shadow = !!shadow;
  out.visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  if (!shadow) return out;

  out.fallback = !!shadow.querySelector('[data-pallett-fallback]');
  out.fallbackText = ((shadow.querySelector('[data-pallett-fallback-title]') || {}).textContent || '').trim();
  out.hasStyleBlock = !!shadow.querySelector('[data-pallett-style]');
  out.rootRendered = !!shadow.querySelector('[data-pallett-root]');
  out.widgetMarkup = !!shadow.querySelector('.rq-card');
  out.tokenPrimary = (() => {
    try { return getComputedStyle(el).getPropertyValue('--color-primary').trim(); } catch (e) { return ''; }
  })();
  out.buttonBackground = (() => {
    const b = shadow.querySelector('.rq-go');
    if (!b) return '';
    try { return String(getComputedStyle(b).backgroundColor); } catch (e) { return '?'; }
  })();
  out.controls = ['area', 'material', 'pitch'].map((name) => !!shadow.querySelector('[data-pallett-field="' + name + '"]'));
  if (!${interactive ? 'true' : 'false'}) return out;

  const field = (name) => shadow.querySelector('[data-pallett-field="' + name + '"]');
  const read = () => ((shadow.querySelector('[data-pallett-out]') || {}).textContent || '').trim();
  out.before = read();
  const values = ${JSON.stringify(probeValues)};
  out.probeSet = ['area', 'material', 'pitch'].map((name) => {
    const f = field(name);
    if (!f) return false;
    f.value = values[name];
    f.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }).every(Boolean);
  const go = shadow.querySelector('[data-pallett-go]');
  out.pressed = false;
  if (go) { go.click(); out.pressed = true; }
  out.after = read();
  out.changed = out.after !== out.before && out.after.length > 0;
  out.showsMoney = /GBP\\s?[0-9][0-9,]*/.test(out.after);
  return out;
})()`;
}

setTimeout(() => fail('timed out after 170s waiting for the app window'), 170000);
