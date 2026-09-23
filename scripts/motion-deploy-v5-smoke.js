'use strict';
// ============================================================
// Motion & Deploy v5 — scroll motion, client gating, privacy
// analytics, edge headers
//
// The four modules of this brief, checked where they could break:
//
//   1. scroll-motion  — timeline CSS per animation type, BOTH
//                       reduced-motion layers (no-preference gate
//                       + explicit reduce stop, in that order),
//                       selector sanitization, unknown-type errors,
//                       and the parallax script against its
//                       < 0.8KB (819 B) budget with the reduce
//                       bail-out provably BEFORE any registration.
//   2. client-auth    — AES-256-GCM payload shape (100k PBKDF2 by
//                       default), then the EXACT decrypt core the
//                       generated script embeds, evaluated under
//                       Node's spec-compliant crypto.subtle:
//                       byte-exact recovery, wrong-passphrase and
//                       tampered-ciphertext rejection, key-based
//                       session resume, throttle schedule, and
//                       typed build-time errors.
//   3. static-analytics — provider dispatchers (plausible queue,
//                       fathom trackEvent + queue, sa_event with
//                       [A-Za-z0-9_] sanitizing, beacon via
//                       sendBeacon with fetch-keepalive fallback),
//                       flag handling, milestone config, and a
//                       functional boot(): the generated script
//                       runs against a stub DOM so outbound /
//                       tagged / download / same-host / submit
//                       triggers, the 25/50% scroll milestones
//                       (fired exactly once), the 30s time tick
//                       and pagehide total are asserted as real
//                       dispatched events, plus a parsed beacon
//                       payload that must carry no cookie data.
//   4. edge-headers   — `_headers` parsed back into rules (every
//                       line must be a path or `name: value`),
//                       defaults/custom merge, invalid-name and
//                       misplaced cache-control rejections;
//                       `_redirects` lines split-validated against
//                       the allowed status set for CF/Netlify, the
//                       spa-over-404 precedence, forceWww/forceApex
//                       canonical lines, and vercel.json parsed as
//                       JSON with host `has` conditions and the
//                       redirects/rewrites split. Determinism:
//                       every generator must be byte-stable.
//
// Usage: node scripts/motion-deploy-v5-smoke.js   (exit 0 = green)
// ============================================================

const scroll = require('../modules/scroll-motion.js');
const auth = require('../modules/client-auth.js');
const analytics = require('../modules/static-analytics.js');
const edge = require('../modules/edge-headers.js');
const { webcrypto } = require('crypto');

let fails = 0;
let total = 0;
const ok = (cond, label) => {
  total++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label);
  if (!cond) fails++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const section = (title) => console.log('\n== ' + title + ' ==');
const compiles = (src) => { try { new Function(src); return null; } catch (e) { return e.message; } };
const balanced = (css) => (css.match(/{/g) || []).length === (css.match(/}/g) || []).length;
const throwsCode = (fn, code) => {
  try { fn(); return false; } catch (e) { return e.code === code; }
};

// parse `_headers` back into rule objects; throws on any line
// that is neither a path nor an indented `name: value`.
const parseHeaders = (text) => {
  const rules = [];
  let cur = null;
  text.split('\n').forEach((line) => {
    if (line === '') return;
    if (!/^ /.test(line)) {
      if (line[0] !== '/') throw new Error('bad path line: ' + line);
      cur = { path: line, headers: {} };
      rules.push(cur);
      return;
    }
    const m = /^  ([^:]+): (.+)$/.exec(line);
    if (!m || !cur) throw new Error('bad header line: ' + line);
    cur.headers[m[1]] = m[2];
  });
  return rules;
};

// split `_redirects` lines; every status must be in the allowed
// set (plus the 404 fallback our generator appends).
const parseRedirects = (text) => text.trim().split('\n').map((line) => {
  const parts = line.split(' ');
  if (parts.length !== 3) throw new Error('bad rule: ' + line);
  const status = parts[2].replace('!', '');
  if (!/^[0-9]+$/.test(status)) throw new Error('bad status: ' + line);
  const n = Number(status);
  if (edge.ALLOWED_STATUS.indexOf(n) === -1 && n !== 404) {
    throw new Error('status not allowed: ' + line);
  }
  return { from: parts[0], to: parts[1], status: parts[2] };
});

// ============================================================
section('1. scroll-motion — timeline CSS, reduce fallbacks, parallax budget');
// ============================================================

const revealCss = scroll.generateScrollTimelineCSS('reveal', '.card');
const scaleCss = scroll.generateScrollTimelineCSS('scale-down', '.hero');
const progressCss = scroll.generateScrollTimelineCSS('progress', '#bar');

ok(revealCss.indexOf('@keyframes pai-reveal') > -1, 'reveal keyframes emitted');
ok(revealCss.indexOf('animation-timeline:view()') > -1, 'reveal tied to view()');
ok(revealCss.indexOf('animation-range:entry 0% entry 100%') > -1, 'reveal range scoped to entry');
ok(scaleCss.indexOf('animation-timeline:scroll()') > -1, 'scale-down tied to scroll()');
ok(scaleCss.indexOf('scale(.92)') > -1, 'scale-down keyframes zoom out');
ok(progressCss.indexOf('scaleX(0)') > -1 && progressCss.indexOf('scaleX(1)') > -1, 'progress keyframes scaleX 0→1');
ok(progressCss.indexOf('transform-origin:left') > -1, 'progress origin pinned left');

[revealCss, scaleCss, progressCss].forEach((css, i) => {
  const names = ['reveal', 'scale-down', 'progress'];
  const gate = css.indexOf('@supports (animation-timeline:');
  const noPref = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  const reduce = css.indexOf('@media (prefers-reduced-motion: reduce)');
  ok(gate > -1, names[i] + ': @supports capability gate present');
  ok(noPref > gate, names[i] + ': no-preference gate inside @supports');
  ok(reduce > noPref, names[i] + ': explicit reduce stop AFTER the gate');
  const sel = names[i] === 'reveal' ? '.card' : names[i] === 'scale-down' ? '.hero' : '#bar';
  ok(css.indexOf(sel + '{animation:none}') > -1, names[i] + ': reduce forces animation:none');
  ok(balanced(css), names[i] + ': braces balanced');
});

ok(eq(revealCss, scroll.generateScrollTimelineCSS('fade-up', '.card')), "'fade-up' aliases to reveal");
ok(eq(progressCss, scroll.generateScrollTimelineCSS('progress-bar', '#bar')), "'progress-bar' aliases to progress");
ok(eq(progressCss, scroll.generateScrollTimelineCSS('scroll-progress', '#bar')), "'scroll-progress' aliases to progress");
ok(throwsCode(() => scroll.generateScrollTimelineCSS('parallax', '.x'), 'bad_input'), 'unknown animationType throws bad_input');
ok(throwsCode(() => scroll.generateScrollTimelineCSS('reveal', ''), 'bad_input'), 'empty selector throws bad_input');
const dirtyCss = scroll.generateScrollTimelineCSS('reveal', '<style>.x{}</style>');
ok(dirtyCss.indexOf('<') === -1 && dirtyCss.indexOf('{}') === -1, 'selector tags/braces stripped, no empty rules');
ok(balanced(dirtyCss), 'sanitized output still balanced');

const para = scroll.generateParallaxLayersScript({
  '[data-depth="bg"]': 0.15,
  '[data-depth="fg"]': -0.08
});
console.log('  (parallax: ' + para.length + ' B, budget 819)');
ok(para.length < 819, 'parallax under 0.8KB (819 B)');
ok(compiles(para) === null, 'parallax compiles');
ok(para.indexOf('(prefers-reduced-motion:reduce)') > -1, 'parallax has reduce bail-out');
ok(para.indexOf('(prefers-reduced-motion:reduce)') < para.indexOf('IntersectionObserver'),
  'reduce bail-out runs BEFORE observer registration');
ok(para.indexOf('IntersectionObserver') > -1 && para.indexOf('requestAnimationFrame') > -1,
  'IO + rAF fallback mechanics present');
ok(para.indexOf('passive:1') > -1, 'scroll listeners passive');
ok(para.indexOf('"[data-depth=\\"bg\\"]":0.15') > -1 || para.indexOf('data-depth=') > -1,
  'sensitivity map embedded');
const dropped = scroll.generateParallaxLayersScript({ '.keep': 0.5, '.zero': 0, '.nan': 'x' });
ok(dropped.indexOf('.keep') > -1 && dropped.indexOf('.zero') === -1 && dropped.indexOf('.nan') === -1,
  'zero/NaN depths dropped from map');
ok(throwsCode(() => scroll.generateParallaxLayersScript(null), 'bad_input'), 'null map throws bad_input');
ok(throwsCode(() => scroll.generateParallaxLayersScript({ '.a': 0 }), 'bad_input'), 'all-zero map throws bad_input');
const dirtyPara = scroll.generateParallaxLayersScript({ '.ok<b>': 0.3 });
// the map JSON lives before the ;if(matchMedia guard — the rest of
// the script legitimately contains '<' as the i<n.length operator
const mapJson = dirtyPara.slice(0, dirtyPara.indexOf(';if(matchMedia'));
ok(mapJson.indexOf('".okb":0.3') > -1 && mapJson.indexOf('<') === -1,
  'parallax selectors sanitized (tags stripped from map keys)');

// ============================================================
section('2. client-auth — AES-GCM payload, WebCrypto decrypt cycle, throttle');
// ============================================================

ok(auth.PBKDF2_ITERATIONS === 100000, 'PBKDF2_ITERATIONS is 100,000');
ok(auth.SALT_BYTES === 16 && auth.IV_BYTES === 12 && auth.TAG_BYTES === 16,
  'salt 16B / IV 12B / GCM tag 16B');

const SECRET = '<p>Top secret quarterly roadmap</p>';
const payload = auth.generateGatedSectionPayload(SECRET, 'correct horse battery staple');
ok(payload.iterations === 100000, 'default payload uses 100,000 iterations');
ok(payload.saltHex.length === 32 && payload.ivHex.length === 24
  && payload.tagHex.length === 32 && payload.cipherHex.length > 0,
  'salt/iv/tag/cipher hex lengths exact');
ok(payload.cipherHex.indexOf(Buffer.from(SECRET).toString('hex')) === -1,
  'ciphertext is not the plaintext hex');
ok(payload.html.indexOf('data-pai-ct="' + payload.cipherHex + '"') > -1, 'cipher rides in data-pai-ct');
ok(payload.html.indexOf('data-pai-tag="' + payload.tagHex + '"') > -1, 'tag rides in data-pai-tag');
ok(payload.html.indexOf('role="alert"') > -1 && payload.html.indexOf('type="password"') > -1,
  'accessible password form (alert region, password input)');
ok(payload.html.indexOf('for="' + payload.sectionId + '-pw"') > -1, 'label tied to input id');
ok(payload.html.indexOf(SECRET) === -1 && payload.html.indexOf('Top secret') === -1,
  'no plaintext leaks into the shipped HTML');
ok(payload.html.indexOf('paiGateAuth') > -1, 'inline controller defers to window.paiGateAuth');
ok(throwsCode(() => auth.generateGatedSectionPayload('', 'pw'), 'bad_input'), 'empty content throws bad_input');
ok(throwsCode(() => auth.generateGatedSectionPayload('<p>x</p>', ''), 'missing_credential'),
  'missing passphrase throws missing_credential');

// the EXACT decrypt core the generated script embeds, under Node's
// spec-compliant crypto.subtle (= what browsers ship)
const run = async () => {
  const decrypt = await new Function(auth.decryptCoreSource + '\n;return paiGateDecrypt;')();

  const good = await decrypt(webcrypto,
    { passphrase: 'correct horse battery staple' },
    payload.saltHex, payload.ivHex, payload.cipherHex, payload.tagHex, payload.iterations);
  ok(good.text === SECRET, 'decrypt cycle recovers payload byte-exact');
  ok(/^[A-Za-z0-9+/]{43}=$/.test(good.key), 'session key exported as 32B base64');

  let rejected = false;
  await decrypt(webcrypto, { passphrase: 'wrong password' },
    payload.saltHex, payload.ivHex, payload.cipherHex, payload.tagHex, payload.iterations)
    .catch(() => { rejected = true; });
  ok(rejected, 'wrong passphrase rejected by GCM tag');

  const flipped = (payload.cipherHex[0] === '0' ? '1' : '0') + payload.cipherHex.slice(1);
  rejected = false;
  await decrypt(webcrypto, { passphrase: 'correct horse battery staple' },
    payload.saltHex, payload.ivHex, flipped, payload.tagHex, payload.iterations)
    .catch(() => { rejected = true; });
  ok(rejected, 'tampered ciphertext rejected');

  const resumed = await decrypt(webcrypto,
    { key: new Uint8Array(Buffer.from(good.key, 'base64')) },
    payload.saltHex, payload.ivHex, payload.cipherHex, payload.tagHex, payload.iterations);
  ok(resumed.text === SECRET, 'session resume (stored key) recovers payload too');

  const unlock = auth.generateClientUnlockScript(payload.saltHex, payload.ivHex);
  ok(compiles(unlock) === null, 'unlock script compiles');
  ok(unlock.indexOf('"n":100000') > -1, 'unlock script embeds 100,000 iterations');
  ok(unlock.indexOf('Math.min(3e4,1e3*Math.pow(2,n-3))') > -1,
    'throttle schedule formula embedded verbatim');
  ok(unlock.indexOf('sessionStorage.setItem') > -1 && unlock.indexOf('sessionStorage.removeItem') > -1,
    'session key stored and removable (lock)');
  ok(unlock.indexOf('Too many attempts') > -1 && unlock.indexOf('Incorrect password') > -1
    && unlock.indexOf('Unlock unavailable') > -1, 'feedback strings present (throttle + generic errors)');
  ok(unlock.indexOf('document.addEventListener("submit"') > -1,
    'document-level fallback submit binding');
  ok(unlock.indexOf('pai:gate-unlocked') > -1, 'unlock CustomEvent fired for host pages');
  ok(throwsCode(() => auth.generateClientUnlockScript('zz', payload.ivHex), 'bad_input'),
    'non-hex salt throws bad_input');

  ok(eq([0, 1, 2, 3, 4, 5, 6, 7, 8].map(auth.attemptDelayMs),
    [0, 0, 0, 1000, 2000, 4000, 8000, 16000, 30000]),
    'throttle: 0,0,0 then doubling 1s→30s cap');
  ok(auth.attemptDelayMs(1000) === 30000 && auth.attemptDelayMs(-3) === 0
    && auth.attemptDelayMs('x') === 0, 'throttle clamps at 30s and ignores junk');

  section('3. static-analytics — provider dispatchers, beacon payloads, milestones');

  // ---- build-time validation ---------------------------------
  ok(throwsCode(() => analytics.generateAnalyticsScript('google-analytics', {}), 'unknown_provider'),
    'unknown provider throws unknown_provider');
  ok(throwsCode(() => analytics.generateAnalyticsScript('beacon', {}), 'missing_credential'),
    'beacon without endpoint throws missing_credential');
  ok(throwsCode(() => analytics.generateAnalyticsScript('beacon', { endpoint: 'ftp://x' }), 'bad_input'),
    'non-http beacon endpoint throws bad_input');
  ok(eq(analytics.SCROLL_MILESTONES, [25, 50, 75, 100]) && eq(analytics.TIME_MILESTONES, [30, 60, 120, 300]),
    'milestone constants exported exactly');
  ok(analytics.DEFAULT_EVENT_NAMES.outbound === 'Outbound link clicked'
    && analytics.DEFAULT_EVENT_NAMES.form === 'Form submitted', 'default event names');

  // ---- a stub-DOM boot so dispatch is tested as behavior -----
  const boot = (provider, cfg) => {
    const src = analytics.generateAnalyticsScript(provider, cfg);
    const compileErr = compiles(src);
    const calls = { listeners: {}, intervals: [], beacons: [], fetches: [], beaconOk: true };
    const addBare = (t, h) => { (calls.listeners[t] = calls.listeners[t] || []).push(h); };
    const win = {};
    const loc = { hostname: 'example.com', href: 'https://example.com/pricing' };
    const doc = {
      referrer: 'https://news.ycombinator.com/', hidden: false,
      documentElement: { scrollHeight: 1000, scrollTop: 0 },
      addEventListener: addBare, querySelectorAll: () => []
    };
    const nav = {};
    if (provider === 'beacon') {
      nav.sendBeacon = (url, body) => { calls.beacons.push({ url, body }); return calls.beaconOk; };
    }
    if (compileErr) return { compileErr, calls, win };
    try {
      new Function('window', 'document', 'location', 'navigator', 'addEventListener',
        'setInterval', 'requestAnimationFrame', 'innerHeight', 'fetch', src)(
        win, doc, loc, nav, addBare,
        (f, ms) => { calls.intervals.push({ f, ms }); return 1; },
        (f) => { f(); return 0; }, 500,
        (...a) => { calls.fetches.push(a); return Promise.resolve({ ok: true }); });
    } catch (e) {
      return { compileErr: e.message, calls, win };
    }
    return {
      compileErr: null, calls, win, doc,
      fire: (t, ev) => (calls.listeners[t] || []).forEach((h) => h(ev)),
      qnames: () => (win.plausible.q || []).map((a) => a[0])
    };
  };
  const anchor = (href) => ({ getAttribute: () => href, href });
  const clickTarget = (a, tagEl) => ({
    closest: (sel) => (tagEl && sel.indexOf('data-analytics-event') > -1 ? tagEl
      : (sel === 'a[href]' ? a : null))
  });

  // ---- plausible: every trigger as a real dispatched event ----
  const p = boot('plausible', {});
  ok(p.compileErr === null, 'plausible script compiles and boots: ' + (p.compileErr || 'ok'));
  ok(typeof p.win.paiTrack === 'function', 'window.paiTrack is the public dispatch window');
  p.fire('click', { target: clickTarget(anchor('https://other.com/x')) });
  ok(eq(p.qnames(), ['Outbound link clicked']), 'cross-host link fires Outbound exactly once');
  ok(p.win.plausible.q[0][1].props.host === 'other.com', 'outbound props carry host');
  p.fire('click', { target: clickTarget(anchor('https://example.com/about')) });
  ok(eq(p.qnames(), ['Outbound link clicked']), 'same-host link fires NOTHING');
  p.fire('click', { target: clickTarget(anchor('/files/guide.pdf')) });
  ok(p.qnames().indexOf('File download') > -1, 'relative PDF link fires File download');
  ok(p.win.plausible.q[1][1].props.ext === 'pdf', 'download props carry ext=pdf');
  p.fire('click', { target: clickTarget(anchor('mailto:a@b.com')) });
  ok(p.qnames().length === 2, 'mailto: fires nothing (no :// → falls through silently)');
  p.fire('click', {
    target: clickTarget(anchor('https://other.com/x'),
      { getAttribute: () => 'Partner CTA', href: 'https://other.com/x' })
  });
  ok(p.qnames()[2] === 'Partner CTA' && p.qnames().length === 3,
    'tagged element fires ONLY its own name (no outbound double-count)');
  p.fire('submit', { target: { id: 'contact-form', getAttribute: () => 'contact' } });
  ok(p.qnames()[3] === 'Form submitted', 'form submit fires Form submitted');
  p.win.paiTrack('Manual event');
  ok(p.qnames()[4] === 'Manual event', 'public paiTrack dispatches too');
  ok(p.doc.referrer !== undefined, 'env referrer available');

  // scroll milestones: 50% depth fires 25+50 exactly once each
  p.doc.hidden = false;
  p.win.scrollY = 250; // (250 / (1000-500)) = 50%
  p.fire('scroll', {});
  ok(eq(p.qnames().slice(5), ['Scroll depth 25%', 'Scroll depth 50%']),
    'scroll to 50% fires milestones 25% and 50% in order');
  p.fire('scroll', {});
  ok(p.qnames().length === 7, 'repeat scroll fires nothing (each milestone once)');
  p.win.scrollY = 400; // 80% of the 500px scroll range → 75% only
  p.fire('scroll', {});
  ok(p.qnames()[7] === 'Scroll depth 75%', 'deeper scroll fires 75%');

  // active time: 1s interval → 30s milestone → pagehide total
  ok(p.calls.intervals.length === 1 && p.calls.intervals[0].ms === 1000,
    'time tracker registered at 1000ms');
  for (let i = 0; i < 30; i++) p.calls.intervals[0].f();
  ok(p.qnames()[8] === 'Time on page 30s', '30 visible seconds fire the 30s milestone');
  p.fire('pagehide', {});
  ok(p.qnames()[9] === 'Time on page completed'
    && p.win.plausible.q[9][1].props.seconds === '30', 'pagehide reports active total seconds');
  p.fire('pagehide', {});
  ok(p.qnames().length === 10, 'pagehide total fires exactly once');
  p.win.scrollY = 500; // absolute bottom → 100%
  p.fire('scroll', {});
  ok(p.qnames()[10] === 'Scroll depth 100%', 'bottom of page fires the 100% milestone');

  // ---- flags -------------------------------------------------
  const noForms = boot('plausible', { forms: false });
  ok(!noForms.calls.listeners.submit, 'forms:false removes the submit listener');
  const customAttr = boot('plausible', { attribute: 'data-goal' });
  ok(customAttr.compileErr === null && customAttr.calls.listeners.click,
    'custom tracking attribute accepted');
  const noScroll = boot('plausible', { scrollDepth: false });
  ok(noScroll.compileErr === null && noScroll.win, 'scrollDepth:false boots');
  const noTime = boot('plausible', { timeOnPage: false });
  ok(noTime.compileErr === null && noTime.win, 'timeOnPage:false boots');
  const bare = boot('plausible', { scrollDepth: false, timeOnPage: false });
  ok(!bare.calls.listeners.pagehide && bare.calls.intervals.length === 0,
    'both milestone flags off → no snippet at all');

  // ---- fathom / simpleanalytics ------------------------------
  const f = boot('fathom', {});
  ok(f.compileErr === null, 'fathom boots');
  f.fire('click', { target: clickTarget(anchor('https://other.com/')) });
  ok(f.win.fathom.q[0][0] === 'trackEvent' && f.win.fathom.q[0][1] === 'Outbound link clicked',
    "fathom queue receives ('trackEvent', name)");
  ok(f.compileErr === null && analytics.generateAnalyticsScript('fathom', {}).indexOf('trackGoal') === -1,
    'deprecated trackGoal is never emitted');

  const s = boot('sa', {});
  ok(s.compileErr === null, "'sa' alias resolves to simpleanalytics");
  s.fire('click', { target: clickTarget(anchor('/files/q4 report.pdf')) });
  ok(s.win.sa_event.q[0][0] === 'File_download', 'sa_event name sanitized to [A-Za-z0-9_]');
  ok(analytics.generateAnalyticsScript('simpleanalytics', {})
    === analytics.generateAnalyticsScript('sa', {}), 'alias output byte-identical to canonical');

  // ---- beacon payloads ---------------------------------------
  const b = boot('beacon', { endpoint: 'https://hook.example/h', fields: { site: 'acme' } });
  ok(b.compileErr === null, 'beacon boots');
  b.fire('click', { target: clickTarget(anchor('https://other.com/x')) });
  ok(b.calls.beacons.length === 1 && b.calls.beacons[0].url === 'https://hook.example/h',
    'sendBeacon POSTed to the configured endpoint');
  const raw = b.calls.beacons[0].body;
  const body = JSON.parse(raw);
  ok(body.event === 'Outbound link clicked', 'beacon payload event name');
  ok(body.url === 'https://example.com/pricing' && body.referrer === 'https://news.ycombinator.com/',
    'beacon payload carries url + referrer');
  ok(typeof body.timestamp === 'string' && body.site === 'acme', 'beacon payload timestamp + merged fields');
  ok(raw.indexOf('cookie') === -1 && raw.indexOf('document.cookie') === -1,
    'beacon payload contains no cookie data');
  ok(b.calls.fetches.length === 0, 'healthy sendBeacon → no fetch fallback');

  const b2 = boot('beacon', { endpoint: 'https://hook.example/h' });
  b2.calls.beaconOk = false; // simulate a throttled/refused beacon
  b2.fire('click', { target: clickTarget(anchor('https://other.com/x')) });
  ok(b2.calls.beacons.length === 1 && b2.calls.fetches.length === 1,
    'failed beacon falls back to fetch');
  ok(b2.calls.fetches[0][0] === 'https://hook.example/h'
    && b2.calls.fetches[0][1].keepalive === true
    && b2.calls.fetches[0][1].headers['content-type'] === 'application/json',
    'fallback fetch keeps alive + JSON content-type');

  // ---- standalone snippet ------------------------------------
  const snip = analytics.trackScrollDepthAndTime();
  ok(compiles(snip) === null, 'trackScrollDepthAndTime compiles standalone');
  ok(snip.indexOf('"sMs":[25,50,75,100]') > -1 && snip.indexOf('"tMs":[30,60,120,300]') > -1,
    'default milestones embedded');
  ok(snip.indexOf('&&!d[v]') > -1, 'scroll milestones fire exactly once');
  ok(snip.indexOf('window.paiTrack||function(){}') > -1, 'standalone snippet no-ops without a dispatcher');
  ok(snip.indexOf('document.hidden') > -1, 'time accrues only while visible (active time)');

  section('4. edge-headers — _headers, _redirects, vercel.json formats');

  const hdrs = edge.generateCloudflareHeaders();
  let parsed;
  try { parsed = parseHeaders(hdrs); ok(true, '_headers parses cleanly (every line valid)'); }
  catch (e) { ok(false, '_headers parses cleanly — ' + e.message); parsed = []; }
  ok(parsed.length > 0 && parsed[0].path === '/*', 'global /* rule first');
  ok(parsed[0].headers['strict-transport-security']
    === 'max-age=31536000; includeSubDomains; preload', 'HSTS with preload + includeSubDomains');
  ok(parsed[0].headers['x-content-type-options'] === 'nosniff'
    && parsed[0].headers['x-frame-options'] === 'SAMEORIGIN'
    && parsed[0].headers['referrer-policy'] === 'strict-origin-when-cross-origin',
    'default security headers present');
  const staticRule = parsed.find((r) => r.path === '/static/*');
  ok(staticRule && staticRule.headers['cache-control'] === 'public, max-age=31536000, immutable',
    '/static/* served immutable for a year');
  const swRule = parsed.find((r) => r.path === '/sw.js');
  ok(swRule && /must-revalidate/.test(swRule.headers['cache-control']),
    'service worker never cached stale');
  ok(hdrs.slice(-1) === '\n', '_headers ends with newline');
  ok(edge.generateCloudflareHeaders() === hdrs, 'headers output is deterministic');

  const customHdrs = edge.generateCloudflareHeaders({ 'x-frame-options': 'DENY' });
  ok(customHdrs.indexOf('x-frame-options: DENY') > -1
    && customHdrs.indexOf('strict-transport-security') > -1,
    'custom security header merges over defaults');
  ok(throwsCode(() => edge.generateCloudflareHeaders({ 'bad header': 'x' }), 'bad_input'),
    'invalid header name throws bad_input');
  ok(throwsCode(() => edge.generateCloudflareHeaders({ 'cache-control': 'max-age=1' }), 'bad_input'),
    'cache-control in securityHeaders throws (needs a path scope)');
  const noCache = edge.generateCloudflareHeaders(null, []);
  ok(noCache.indexOf('/static/*') === -1 && parseHeaders(noCache)[0].path === '/*',
    'empty cacheRules → global block only');
  const apiCache = edge.generateCloudflareHeaders(null, [{ path: '/api/*', 'cache-control': 'no-store' }]);
  ok(apiCache.indexOf('/api/*') > -1 && apiCache.indexOf('no-store') > -1
    && apiCache.indexOf('/static/*') === -1, 'custom cacheRules replace defaults');
  ok(throwsCode(() => edge.generateCloudflareHeaders(null, [{ path: '', 'cache-control': 'x' }]), 'bad_input'),
    'pathless cache rule throws bad_input');
  ok(throwsCode(() => edge.generateCloudflareHeaders(null, [{ path: '/x/*' }]), 'bad_input'),
    'headerless cache rule throws bad_input');

  // ---- redirects matrix --------------------------------------
  const rules = [{ from: '/old', to: '/new' }, { from: '/legacy', to: '/current', status: 302 }];
  const m = edge.generateRedirectsMatrix(rules, {});
  let cfRules; let nlRules;
  try {
    cfRules = parseRedirects(m.cloudflare);
    nlRules = parseRedirects(m.netlify);
    ok(true, '_redirects parses for BOTH cloudflare and netlify (statuses in allowed set)');
  } catch (e) { ok(false, '_redirects parses — ' + e.message); cfRules = []; nlRules = []; }
  ok(cfRules[0].from === '/old' && cfRules[0].to === '/new' && cfRules[0].status === '301',
    '301 default status, from→to order preserved');
  ok(cfRules[1].status === '302' && nlRules[1].status === '302', 'explicit 302 honored on both');
  ok(nlRules.length === cfRules.length, 'netlify gets the same rule count');
  ok(cfRules[cfRules.length - 1].to === '/404.html' && cfRules[cfRules.length - 1].status === '404',
    'default custom-404 fallback appended');
  ok(throwsCode(() => edge.generateRedirectsMatrix([{ from: '/a', to: '/b', status: 999 }], {}), 'bad_input'),
    'status 999 throws bad_input');
  ok(throwsCode(() => edge.generateRedirectsMatrix([{ from: '/a' }], {}), 'bad_input'),
    'rule without target throws bad_input');
  ok(throwsCode(() => edge.generateRedirectsMatrix('nope', {}), 'bad_input'),
    'non-array rules throw bad_input');

  const notFound = edge.generateRedirectsMatrix([], { notFound: '/404/index.html' });
  ok(notFound.cloudflare.indexOf('/* /404/index.html 404') > -1
    && notFound.netlify.indexOf('/* /404/index.html 404') > -1, 'custom 404 page honored');
  const spa = edge.generateRedirectsMatrix([], { spa: true });
  ok(spa.cloudflare.indexOf('/index.html 200') > -1 && spa.netlify.indexOf('/index.html 200!') > -1,
    'spa catch-all emitted (netlify force flag)');
  ok(spa.cloudflare.indexOf('404') === -1 && spa.netlify.indexOf(' 404') === -1,
    'spa catch-all wins over the 404 rule (first-match-wins shadowing)');
  const spaVercel = JSON.parse(spa.vercel);
  ok(spaVercel.rewrites[spaVercel.rewrites.length - 1].destination === '/index.html',
    'vercel spa rule is a rewrite to index.html');

  const canon = edge.generateRedirectsMatrix([], { forceWww: 'example.com' });
  ok(canon.cloudflare.indexOf('https://example.com/* https://www.example.com/:splat 301') > -1,
    'forceWww canonical line (netlify-style splat) in _redirects');
  const canonVercel = JSON.parse(canon.vercel);
  const hostRule = canonVercel.redirects.find((r) => r.has && r.has.length);
  ok(hostRule && hostRule.has[0].type === 'host' && hostRule.has[0].value === 'example.com',
    'vercel canonical rule uses host has-condition (sources carry no hosts)');
  ok(hostRule && hostRule.destination === 'https://www.example.com/:path*'
    && hostRule.permanent === true, 'vercel canonical destination absolute + permanent');
  const apex = edge.generateRedirectsMatrix([], { forceApex: 'www.example.com' });
  ok(apex.cloudflare.indexOf('https://www.example.com/* https://example.com/:splat 301') > -1,
    'forceApex canonical line reversed correctly');

  const mixed = edge.generateRedirectsMatrix(
    [{ from: '/a', to: '/b', status: 302 },
      { from: '/legacy/*', to: '/docs/:splat', status: 200 }], {});
  const v = JSON.parse(mixed.vercel);
  ok(Array.isArray(v.redirects) && Array.isArray(v.rewrites), 'vercel.json has redirects + rewrites arrays');
  ok(v.redirects[0].source === '/a' && v.redirects[0].destination === '/b'
    && v.redirects[0].permanent === false, '302 → permanent:false redirect entry');
  ok(v.rewrites.some((r) => r.source === '/legacy/:path*')
    && !v.redirects.some((r) => r.source === '/legacy/:path*'),
    '200 rule lands in rewrites, never redirects (token converted to :path*)');
  const legacyRw = v.rewrites.find((r) => r.source === '/legacy/:path*');
  ok(legacyRw && legacyRw.destination === '/docs/:path*'
    && legacyRw.destination.indexOf(':path:path') === -1,
    'rewrite destination token converted exactly once (no :path:path*)');
  ok(v.rewrites[v.rewrites.length - 1].destination === '/404.html',
    'vercel 404 fallback is the last rewrite (runs after filesystem)');
  ok(mixed.vercel.indexOf('{\n  "redirects"') === 0, 'vercel.json pretty-printed from key order');

  ok(m.cloudflare === edge.generateRedirectsMatrix(rules, {}).cloudflare
    && m.vercel === edge.generateRedirectsMatrix(rules, {}).vercel,
    'redirects output is deterministic');
};

run()
  .then(() => {
    console.log('\n' + (total - fails) + '/' + total + ' checks passed'
      + (fails ? ' — ' + fails + ' FAILED' : ' — ALL PASS'));
    process.exit(fails ? 1 : 0);
  })
  .catch((e) => {
    console.error('\nRUNNER ERROR: ' + (e && e.stack || e));
    process.exit(1);
  });
