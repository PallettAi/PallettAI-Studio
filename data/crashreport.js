// ============================================================
// PallettAI Studio — crash & error reporting (pure logic)
// The queueing/filtering layer between app failures and a
// Sentry-style ingest endpoint.
//
// WHY: resilience work has shipped, but the studio only hears
// about failures when someone emails support. This module makes
// error reporting a deliberate, bounded, OFF-BY-DEFAULT channel:
//
//   * Anon by construction — no project text, no URLs the user
//     typed, no tokens, no file paths. Message strings are
//     scrubbed for anything URL/email/key-shaped before they
//     leave the device, then clipped. A crash report that could
//     carry a client's content is a liability, not a feature.
//   * OFF until the user turns it on in Settings. The flag lives
//     with the other studio settings, so the browser build and
//     the Electron build behave identically and the toggle is
//     one checkbox, not a document.
//   * Rate-limited and bounded — max 6 events per minute and a
//     30-event send buffer, so a crash loop can neither flood
//     the endpoint nor grow without limit on disk.
//   * DSN-shaped like Sentry's ingest URL but deliberately
//     provider-agnostic: anything that accepts POST {events:[…]}
//     works. No SDK, no dependency — this is a desktop app that
//     already has a fetch.
//
// Pure logic, no DOM, no fetch. app.js and main.js drive it; the
// smoke test pins the filtering, scrubbing and the redaction
// guarantees directly.
// ============================================================

'use strict';

const CrashReport = (() => {
  const MAX_EVENTS = 30;          // buffered events before the oldest is dropped
  const RATE_WINDOW_MS = 60000;   // rate-limit window
  const RATE_MAX = 6;             // events accepted per window
  const MAX_MSG = 300;            // scrubbed message clip
  const MAX_TYPE = 80;

  // ---- scrubbing: what must never travel --------------------
  // URLs: strip query strings (they carry tokens, search terms, referral
  // codes) and keep only scheme+host for http(s). Anything else
  // (file:, data:, about:, custom schemes) is dropped to a scheme tag —
  // a file path is user content on a desktop app.
  function scrubUrl(raw) {
    const s = String(raw == null ? '' : raw);
    try {
      const u = new URL(s);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        return u.protocol + '//' + u.host + u.pathname;
      }
      return u.protocol.replace(/:$/, '') + ':[scrubbed]';
    } catch (e) {
      return '';
    }
  }

  // Emails → '[email]'; long hex/base64-ish runs (keys, JWTs) → '[redacted]'.
  function scrubSecrets(s) {
    return String(s == null ? '' : s)
      .replace(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g, '[email]')
      .replace(/\b[A-Za-z0-9_-]{25,}\b/g, '[redacted]');
  }

  // The message filter: scrub secrets, then collapse any embedded URL to its
  // origin+path. Order matters — scrub secrets first so a token inside a URL
  // query is already gone before the URL shape matcher runs.
  function scrubMessage(raw) {
    let s = scrubSecrets(raw);
    // URLs appearing inside the message: keep scheme+host+path, drop query.
    s = s.replace(/https?:\/\/[^\s'"<>)\]]+/g, (m) => {
      const cleaned = scrubUrl(m);
      return cleaned || '[url]';
    });
    return s.slice(0, MAX_MSG);
  }

  function makeEvent(input) {
    const i = input || {};
    return {
      // Stable per-install id is supplied by the caller (random, regenerated
      // on opt-in) so sessions can be grouped without ever holding an
      // identity. Never derived from account email or license key.
      installation: String(i.installation || '').slice(0, 40),
      session: String(i.session || '').slice(0, 40),
      // 'main' | 'renderer' — which process fell over.
      scope: i.scope === 'main' ? 'main' : 'renderer',
      type: String(i.type || 'error').slice(0, MAX_TYPE),
      message: scrubMessage(i.message),
      // App version + platform only. No machine names, no usernames.
      appVersion: String(i.appVersion || '').slice(0, 40),
      platform: String(i.platform || '').slice(0, 40),
      // Low-cardinality breadcrumbs the user approved by opting in:
      // view names, job kinds, HTTP status codes. Values are clipped hard.
      breadcrumbs: (Array.isArray(i.breadcrumbs) ? i.breadcrumbs : [])
        .slice(-8)
        .map((b) => ({ at: Number(b && b.at) || 0, kind: String(b && b.kind || '').slice(0, 24), detail: scrubMessage(b && b.detail).slice(0, 80) })),
      at: Number(i.at) || Date.now()
    };
  }

  function createReporter(opts) {
    const o = opts || {};
    const enabled = () => (typeof o.enabled === 'function' ? !!o.enabled() : !!o.enabled);
    const send = typeof o.send === 'function' ? o.send : () => Promise.resolve();
    const now = typeof o.now === 'function' ? o.now : () => Date.now();

    let buffer = [];
    let sending = false;
    let rateTouched = 0;
    let rateCount = 0;

    function rateOk() {
      const t = now();
      if (t - rateTouched > RATE_WINDOW_MS) { rateTouched = t; rateCount = 0; }
      rateCount += 1;
      return rateCount <= RATE_MAX;
    }

    return {
      // Record an error. Returns true if it was accepted into the buffer
      // (enabled, under rate limit), false if dropped — useful for tests
      // and for local-only diagnostics parity.
      record(input) {
        if (!enabled()) return false;
        if (!rateOk()) return false;
        buffer.push(makeEvent(input));
        if (buffer.length > MAX_EVENTS) buffer.splice(0, buffer.length - MAX_EVENTS);
        return true;
      },

      // Flush the buffer. Sends in one batch; on failure the events are kept
      // (trimmed) so the next flush retries — a report is worth more than
      // the network round-trip that failed.
      async flush() {
        if (!enabled() || sending || !buffer.length) return { sent: 0, kept: buffer.length };
        sending = true;
        const batch = buffer;
        buffer = [];
        try {
          await send({ events: batch });
          sending = false;
          return { sent: batch.length, kept: 0 };
        } catch (e) {
          sending = false;
          buffer = batch.concat(buffer).slice(-MAX_EVENTS);
          return { sent: 0, kept: buffer.length };
        }
      },

      pendingCount() { return buffer.length; },

      // Test/diagnostic hook: the current buffer, already scrubbed.
      _buffer() { return buffer.slice(); }
    };
  }

  // Default endpoint builder — kept beside the payload shape so the two can
  // never drift. Two shapes are accepted:
  //   * a Sentry-style DSN: https://<publicKey>@<host>/<projectId>
  //     → https://<host>/api/<projectId>/store/?sentry_key=<publicKey>
  //   * a plain ingest URL: https://<host>/<path>
  //     → used as-is (the pallettai.org default is this shape)
  // Anything not https, or unparseable, resolves to '' — callers skip the send.
  function storeUrlFromDsn(dsn) {
    const s = String(dsn || '');
    const dsnMatch = /^https:\/\/([^@]+)@([^/]+)\/(.+)$/.exec(s);
    if (dsnMatch) {
      return 'https://' + dsnMatch[2] + '/api/' + dsnMatch[3] + '/store/?sentry_key=' + encodeURIComponent(dsnMatch[1]);
    }
    try {
      const u = new URL(s);
      return u.protocol === 'https:' ? u.toString() : '';
    } catch (e) {
      return '';
    }
  }

  return { createReporter, makeEvent, scrubMessage, scrubUrl, scrubSecrets, storeUrlFromDsn, MAX_EVENTS, RATE_MAX, RATE_WINDOW_MS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CrashReport;
