#!/usr/bin/env node
// ============================================================
// PallettAI Studio — crash & error reporting smoke
// This channel leaves the device, so the suite is mostly about
// what must NEVER travel and what must never happen:
//
//   1. Privacy. Project text, emails, tokens, URLs with query
//      strings, file paths — scrubbed before they are buffered,
//      so a leak is impossible by construction, not by policy.
//   2. Consent. Off means off: nothing is buffered, nothing is
//      sent, and withdrawing consent stops buffering at once.
//   3. Restraint. A crash loop can't flood the endpoint (rate
//      limit) or grow the buffer without bound (cap), and a
//      failed upload is retried on the next flush, not dropped.
// ============================================================
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const CrashReport = require(path.join(ROOT, 'data', 'crashreport.js'));

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }
function eq(actual, expected, msg) {
  if (actual === expected) pass(msg);
  else fail(msg + '  → got: ' + JSON.stringify(actual) + ', expected: ' + JSON.stringify(expected));
}

async function main() {
  // ---- 1. scrubbing: the leak-proofing ---------------------------------------
  {
    eq(CrashReport.scrubSecrets('contact willow@example.com about it'), 'contact [email] about it', 'emails never travel');
    eq(CrashReport.scrubSecrets('token demo_secret_value_1234567890 failed'), 'token [redacted] failed', 'key-shaped strings are redacted');
    eq(CrashReport.scrubUrl('https://willowcafe.com/book?ref=secret-token'), 'https://willowcake.com/book'.replace('willowcake', 'willowcafe'), 'URL query strings are dropped');
    eq(CrashReport.scrubUrl('file:///Users/someone/secret-project.json'), 'file:[scrubbed]', 'file paths never travel');
    const msg = CrashReport.scrubMessage('fetch to https://api.example.com/v1?key=abc123 failed for client@example.com');
    assert(msg.indexOf('abc123') === -1, 'a token inside a URL query is gone from the message');
    assert(msg.indexOf('client@example.com') === -1, 'so is an email further along the same message');
    assert(msg.indexOf('api.example.com/v1') !== -1, 'but the endpoint host+path survives, because it is the useful half');
  }

  // ---- 2. consent --------------------------------------------------------------
  {
    let sent = 0;
    const off = CrashReport.createReporter({ enabled: () => false, send: () => { sent++; return Promise.resolve(); } });
    eq(off.record({ message: 'x' }), false, 'off by default: nothing is buffered');
    const flushed = await off.flush();
    eq(flushed.sent, 0, 'and nothing is sent');
    eq(sent, 0, 'the endpoint was never touched');

    let enabled = true;
    const r = CrashReport.createReporter({ enabled: () => enabled, send: () => Promise.resolve() });
    eq(r.record({ message: 'boom' }), true, 'opted in: the event is buffered');
    const out = await r.flush();
    eq(out.sent, 1, 'and flushed');
    enabled = false;
    eq(r.record({ message: 'boom2' }), false, 'withdrawing consent stops buffering immediately');
    eq(r.pendingCount(), 0, 'and the buffer is empty');
  }

  // ---- 3. rate limiting + buffer cap ------------------------------------------
  {
    let t = 1000000;
    const r = CrashReport.createReporter({ enabled: () => true, now: () => t, send: () => Promise.resolve() });
    let accepted = 0;
    for (let i = 0; i < 20; i++) { if (r.record({ message: 'e' + i })) accepted++; }
    eq(accepted, CrashReport.RATE_MAX, 'a crash loop is rate-limited to ' + CrashReport.RATE_MAX + ' events per window');
    t += CrashReport.RATE_WINDOW_MS + 1;
    eq(r.record({ message: 'later' }), true, 'the window refills after a minute');
    // Cap: many accepted events across windows never grow the buffer unbounded.
    for (let w = 0; w < 40; w++) {
      t += CrashReport.RATE_WINDOW_MS + 1;
      r.record({ message: 'wave ' + w });
    }
    assert(r.pendingCount() <= CrashReport.MAX_EVENTS, 'the buffer stays capped at ' + CrashReport.MAX_EVENTS);
  }

  // ---- 4. a failed upload is retried, not dropped -------------------------------
  {
    let fail = true;
    let sends = 0;
    const r = CrashReport.createReporter({ enabled: () => true, send: () => { sends++; if (fail) return Promise.reject(new Error('offline')); return Promise.resolve(); } });
    r.record({ message: 'important crash' });
    const first = await r.flush();
    eq(first.sent, 0, 'a failed flush sends nothing');
    eq(first.kept, 1, 'but keeps the event for the next flush');
    fail = false;
    const second = await r.flush();
    eq(second.sent, 1, 'the retry delivers it');
    eq(r.pendingCount(), 0, 'and the buffer is clean');
    eq(sends, 2, 'exactly two endpoint calls were made');
  }

  // ---- 5. payload shape: what an event looks like on the wire -------------------
  {
    const ev = CrashReport.makeEvent({
      type: 'error',
      scope: 'renderer',
      message: 'Cannot read properties of undefined (reading site)',
      installation: 'ins-abc123',
      session: 'ses-xyz789',
      appVersion: '0.4.8',
      platform: 'darwin arm64 electron/33',
      breadcrumbs: [{ at: 1, kind: 'view', detail: 'designer' }, { at: 2, kind: 'job', detail: 'photo-run' }]
    });
    eq(ev.scope, 'renderer', 'scope recorded');
    eq(ev.appVersion, '0.4.8', 'version recorded');
    assert(ev.message.indexOf('undefined') !== -1, 'the useful message survives');
    eq(ev.breadcrumbs.length, 2, 'breadcrumbs ride along');
    eq(ev.breadcrumbs[0].detail, 'designer', 'breadcrumb detail is kept (low cardinality by design)');
    assert(!('projectId' in ev) && !('payload' in ev), 'no project-shaped field exists on the event');
    assert(Object.keys(ev).every((k) => ['installation', 'session', 'scope', 'type', 'message', 'appVersion', 'platform', 'breadcrumbs', 'at'].includes(k)),
      'the event schema is exactly the scrubbed allow-list');
  }

  // ---- 6. DSN → endpoint -------------------------------------------------------
  {
    eq(CrashReport.storeUrlFromDsn('https://abc123@o1.ingest.sentry.io/4567'), 'https://o1.ingest.sentry.io/api/4567/store/?sentry_key=abc123', 'a Sentry-shaped DSN resolves to its store endpoint');
    eq(CrashReport.storeUrlFromDsn('https://ingest.pallettai.org/studio-errors'), 'https://ingest.pallettai.org/studio-errors', 'the pallettai.org default (a plain ingest URL) passes through untouched');
    eq(CrashReport.storeUrlFromDsn('not a dsn'), '', 'garbage in, empty out — callers skip the send');
    eq(CrashReport.storeUrlFromDsn('http://ingest.pallettai.org/x'), '', 'and plaintext HTTP is refused');
  }
}

main().then(() => {
  if (failed) {
    console.error('\ncrashreport-smoke FAILED — ' + failed + ' failure(s)');
    process.exit(1);
  }
  console.log('\ncrashreport-smoke PASSED');
}, (e) => {
  console.error('\ncrashreport-smoke crashed: ' + (e && e.stack || e));
  process.exit(1);
});
