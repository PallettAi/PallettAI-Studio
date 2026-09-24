'use strict';

/*
  The observer half of app-smoke.

  Loaded into the REAL application (app-smoke.js runs the Electron binary
  against the project root, exactly as `npm start` does). It attaches to the
  window the app itself creates, injects the in-page driver from
  app-smoke-page.js, and reports what happened as a machine-readable block.

  Inert unless PALLETTAI_SMOKE_HOOK names it, so it is not a path into a
  shipped build: with the variable unset it returns immediately.
*/

const hookPath = process.env.PALLETTAI_SMOKE_HOOK;
if (!hookPath) return;

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const PAGE = fs.readFileSync(path.join(__dirname, 'app-smoke-page.js'), 'utf8');

const result = {
  booted: false,
  bootError: '',
  formFound: false,
  generatorThrew: false,
  generatorError: '',
  projectsAfter: 0,
  projectName: '',
  sectionCount: 0,
  activeView: '',
  previewHasHtml: false,
  previewHtmlLength: 0,
  creditsSpent: -1,
  creditsRefunded: false,
  refundCount: 0,
  creditsPending: 0
};

let finished = false;
function emit() {
  if (finished) return;
  finished = true;
  process.stdout.write('\nSMOKE_RESULT ' + JSON.stringify(result) + '\nSMOKE_END\n');
}
function fail(message) {
  result.bootError = message;
  emit();
  app.exit(1);
}

app.on('browser-window-created', (_event, win) => {
  if (!(win instanceof BrowserWindow)) return;
  // The startup/update splash is a different window; only the shell is tested.
  if (win.getTitle && /splash|updating|update/i.test(win.getTitle())) return;
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
    try { await drive(win); } catch (e) { fail('driver error: ' + ((e && e.message) || String(e))); }
  });
}

async function drive(win) {
  let outcome;
  try {
    outcome = await win.webContents.executeJavaScript(PAGE, true);
  } catch (e) {
    fail('the in-page driver could not run: ' + ((e && e.message) || String(e)));
    return;
  }

  result.booted = !!outcome.booted;
  result.bootError = outcome.bootError || '';
  result.formFound = !!outcome.formFound;
  if (outcome.first) {
    result.generatorThrew = !!outcome.first.threw;
    result.generatorError = outcome.first.error || '';
    result.creditsSpent = outcome.first.spent;
  }
  result.activeView = outcome.activeView || '';
  result.projectName = outcome.projectName || '';
  result.previewHasHtml = !!outcome.previewHasHtml;
  result.previewHtmlLength = outcome.previewHtmlLength || 0;
  result.sectionCount = outcome.sectionCount || 0;
  result.refundCount = outcome.refundCount || 0;
  result.creditsRefunded = (outcome.refundCount || 0) > 0;
  result.projectsAfter = outcome.projectsAfter || 0;

  if (outcome.previewError) result.bootError = 'preview unreadable: ' + outcome.previewError;
  if (outcome.refundToasts && outcome.refundToasts.length) {
    process.stdout.write('    [refund] ' + outcome.refundToasts.join(' || ') + '\n');
  }

  emit();
  app.exit(result.generatorThrew || !result.booted || !result.formFound ? 1 : 0);
}

setTimeout(() => fail('timed out after 170s waiting for the app window'), 170000);
