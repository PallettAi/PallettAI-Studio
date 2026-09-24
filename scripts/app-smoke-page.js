/*
  The in-page half of the real-app smoke.

  This code runs INSIDE the Studio renderer. It is a separate file rather than
  an inline template literal so that it can use backticks and ${} freely —
  nesting them inside a template in the main process produced a syntax error
  that was invisible until the app refused to boot.

  It touches only what a user would touch: the AI view, the prompt box and the
  Generate button. It reads the result from the app's own observable state.
*/
(async () => {
  const out = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // A refund shows a toast; that is what the user sees, so that is the signal.
  const refunds = [];
  const scan = () => {
    document.querySelectorAll('[class*="toast"]').forEach((t) => {
      const s = (t.textContent || '').trim();
      if (s && /refund/i.test(s) && refunds.indexOf(s) === -1) refunds.push(s);
    });
  };
  const obs = new MutationObserver(scan);
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });

  // App is a top-level `const` in app.js, so it is NOT a window property.
  // Referring to the bare identifier is the correct check; window.App would
  // report a perfectly healthy app as broken.
  out.booted = (typeof App !== 'undefined' && typeof App.go === 'function');
  out.bootError = out.booted ? '' : 'App is not initialised — the shell did not start';
  if (!out.booted) { obs.disconnect(); return out; }

  // App.init() is async and is started by DOMContentLoaded. Wait for the AI
  // view's mount point rather than guessing a delay.
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (document.querySelector('#aiRoot') && document.querySelector('#aiRun')) break;
  }
  await sleep(500);

  App.go('ai');
  await sleep(600);
  scan();

  const prompt = document.querySelector('#aiPrompt');
  const run = document.querySelector('#aiRun');
  out.formFound = !!(prompt && run);
  if (!out.formFound) { obs.disconnect(); return out; }

  // Hermetic: no photo CDN, so this measures generation rather than whether
  // the machine running the test happens to have an internet connection.
  const photo = document.querySelector('#aiPhoto');
  if (photo) photo.value = 'none';
  const grade = document.querySelector('#aiPhotoGrade');
  if (grade) grade.checked = false;

  const credits = () => { try { return PLANS.store.creditsLeft(); } catch (e) { return null; } };

  const runOnce = async (text) => {
    prompt.value = text;
    const before = credits();
    const beforeRefunds = refunds.length;
    const errs = [];
    const orig = console.error;
    console.error = function () {
      const parts = [];
      for (const a of arguments) {
        try { parts.push(a && a.stack ? a.stack : String(a)); } catch (e) { parts.push('[unserialisable]'); }
      }
      errs.push(parts.join(' | '));
      return orig.apply(console, arguments);
    };
    run.click();
    // Generation is fast; the generous ceiling is a hang guard, not a wait.
    for (let i = 0; i < 200; i++) {
      await sleep(250);
      const v = document.querySelector('.view.active');
      if (v && v.id === 'view-designer') break;
    }
    await sleep(600);
    console.error = orig;
    const after = credits();
    return {
      threw: errs.length > 0,
      error: errs[0] || '',
      spent: (before && after) ? (before.left - after.left) : -1,
      newRefunds: refunds.length - beforeRefunds
    };
  };

  out.first = await runOnce('a local florist for weddings in Leeds');
  scan();

  // The preview iframe is written after the Designer renders, and on a slow
  // machine (software rendering) that can take a moment.
  //
  // Its sandbox deliberately omits allow-same-origin, so contentDocument is
  // inaccessible BY DESIGN and must not be reached for — that is the security
  // property, not a fault. The rendered page arrives as srcdoc, which is
  // readable from the parent and is the honest thing to measure.
  const frameEl = document.querySelector('#previewFrame');
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (frameEl && (frameEl.getAttribute('srcdoc') || '').length > 500) break;
  }
  await sleep(300);

  const view = document.querySelector('.view.active');
  out.activeView = (view && view.id) || '';
  const chip = document.querySelector('#projectChip');
  out.projectName = chip ? (chip.textContent || '').replace(/\s*—\s*Website$/, '').trim() : '';

  const frame = document.querySelector('#previewFrame');
  if (frame) {
    const src = frame.getAttribute('srcdoc') || '';
    out.previewHtmlLength = src.length;
    out.previewHasHtml = src.length > 500 && /<section|class="section/i.test(src);
    // Count the rendered sections in the markup itself.
    out.sectionCount = (src.match(/<section\b/gi) || []).length
      || (src.match(/class="[^"]*\bsection\b/gi) || []).length;
  }

  out.refundCount = refunds.length;
  out.refundToasts = refunds.slice(0, 3);
  out.credits = credits();
  out.projectsAfter = out.projectName ? 1 : 0;

  obs.disconnect();
  return out;
})()
