'use strict';

/*
  ============================================================
  Entitlements — proving an offline entitlement instead of trusting one
  ------------------------------------------------------------
  This app is offline-first, so an entitlement usually has to be
  believed without asking the registry. Today that belief is a string.
  `SubscriptionStore.applyTrialUntil()` stamps `trialSource:'registry'`
  on whatever number it is handed, and `load()` accepts the string
  back forever:

      {"trialProUntil": 99999999999999, "trialSource": "registry"}

  Editing that one key in local storage is an unbounded Pro grant, and
  `applyTrialUntil` itself verifies nothing about its argument. The
  project already knows this class of bug: `load()` actively strips
  `source:'license'` and `source:'checkout'` because "client-side
  checksum keys are not entitlements" — a checksum can be computed by
  anyone. A string flag has exactly the same problem.

  The fix is not a new key or a new format. This repository already
  ships the right primitive: `data/refcode.js` verifies an
  ECDSA P-256 signature over a canonical payload using a public key
  that is committed to the repo, in Node and in the browser, with no
  network. A referral code can prove itself offline. An entitlement
  can be proven the same way, with the same key, so this module
  composes that verifier rather than introducing a second PKI.

  Deliberately NOT `keys/pallettai-public.pem`: `.gitignore` ignores
  `*.pem` (line 12, "never stage local credentials or signing
  material"), so a public key at that path could never be committed —
  and asymmetric verification is only useful if the public key ships.
  The committed constant inside refcode.js is the key that actually
  exists.

  Three rules the implementation keeps:

  1. Absent or unverifiable is not Pro. A premium claim with no valid
     signature falls back to Free, and says which check failed
     (`unverified-grant`, `bad-signature`, `expired`, `malformed`)
     rather than silently reporting Free as though nothing happened.

  2. The limits are not restated here. Project and section caps come
     from `data/plans.js`, this codebase's single source of truth for
     what a plan contains, so a price change cannot leave a second
     copy of the number behind.

  3. Verification never throws. A malformed token, a missing key or an
     empty payload returns a result object, because this runs on the
     path where a customer is trying to export.
  ============================================================
*/

const path = require('path');

// The plans module already exports itself for Node (`data/plans.js` ends
// with the standard dual-mode guard), so the caps can be read rather
// than copied.
let Plans = null;
try { Plans = require(path.join(__dirname, '..', 'data', 'plans.js')); } catch (e) { Plans = null; }

// The committed ECDSA verifier. Loaded defensively: if it is missing the
// module reports "not configured" rather than pretending a grant failed.
let RefCode = null;
try { RefCode = require(path.join(__dirname, '..', 'data', 'refcode.js')); } catch (e) { RefCode = null; }

const PREMIUM = ['pro', 'proplus'];

/*
  Free-tier caps. Read from the plans module when it is loadable, so
  the numbers in the product and the numbers enforced here cannot
  drift apart. The literal below is the same value and exists only for
  the case where the renderer's plans file cannot be required.
*/
const FREE_FALLBACK = { projects: 2, sections: 10 };

function freeLimits() {
  try {
    const plan = Plans && typeof Plans.getPlan === 'function' ? Plans.getPlan('free') : null;
    const limits = plan && plan.limits ? plan.limits : null;
    if (limits && typeof limits.projects === 'number') {
      return {
        projects: limits.projects,
        sections: typeof limits.sectionsPerSite === 'number' ? limits.sectionsPerSite : FREE_FALLBACK.sections
      };
    }
  } catch (e) {
    // Fall through to the literal.
  }
  return Object.assign({}, FREE_FALLBACK);
}

// ---- crypto ----------------------------------------------------------

/*
  WebCrypto is available as `globalThis.crypto` in modern browsers and
  as `require('crypto').webcrypto` under Node. This mirrors exactly the
  resolution refcode.js uses, so both modules verify with the same
  implementation on the same machine.
*/
function subtle() {
  try {
    if (typeof crypto !== 'undefined' && crypto && crypto.subtle) return crypto.subtle;
  } catch (e) { /* not defined */ }
  try {
    const c = require('crypto');
    if (c && c.webcrypto && c.webcrypto.subtle) return c.webcrypto.subtle;
  } catch (e) { /* no Node crypto */ }
  return null;
}

function isConfigured() {
  if (RefCode && typeof RefCode.isConfigured === 'function' && RefCode.isConfigured()) return true;
  return false;
}

function publicKey() {
  return RefCode && RefCode.publicKey ? RefCode.publicKey : '';
}

const HEX_RE = /^[0-9a-fA-F]+$/;

function hexToBytes(hex) {
  const s = String(hex || '');
  if (!HEX_RE.test(s) || s.length % 2 !== 0) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

function b64ToBytes(b64) {
  const s = String(b64 || '').replace(/\s+/g, '');
  try {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  } catch (e) { /* fall through */ }
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) {
    return null;
  }
}

/*
  The exact bytes that are signed. A grant is signed over its canonical
  JSON — keys sorted, so field order cannot change the payload — and
  both sides must agree on this or verification is theatre. Any edit to
  any field changes the payload and therefore fails the signature,
  which is the whole point: `until` cannot be extended without the
  private key.
*/
function canonical(payload) {
  if (typeof payload === 'string') return payload;
  const out = {};
  Object.keys(payload || {}).sort().forEach((k) => {
    const v = payload[k];
    if (v === undefined) return;
    out[k] = v;
  });
  return JSON.stringify(out);
}

/*
  Verify a detached signature over a payload string, using the public
  key this app already ships. Returns a result object; never throws.
*/
async function verifyOfflineLicense(licensePayload, signature) {
  const payload = String(licensePayload == null ? '' : licensePayload);
  const sig = String(signature == null ? '' : signature).trim();

  if (!sig) return { ok: false, reason: 'missing', detail: 'no signature supplied' };
  const bytes = hexToBytes(sig);
  if (!bytes || bytes.length !== 64) {
    // P-256 signatures are exactly 64 bytes / 128 hex characters. A raw
    // format check first means an obviously bogus token is rejected
    // without pretending to have cryptographically examined it.
    return { ok: false, reason: 'malformed', detail: 'a P-256 signature is 128 hex characters' };
  }
  if (!isConfigured()) {
    return { ok: false, reason: 'not-configured', detail: 'no public key is installed in this build' };
  }
  const s = subtle();
  if (!s) return { ok: false, reason: 'no-crypto', detail: 'no WebCrypto available to verify with' };

  try {
    const key = await s.importKey('spki', b64ToBytes(publicKey()), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const good = await s.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes, new TextEncoder().encode(payload));
    return good
      ? { ok: true, reason: 'verified', payload }
      : { ok: false, reason: 'bad-signature', detail: 'the signature does not match the payload' };
  } catch (e) {
    return { ok: false, reason: 'error', detail: String(e && e.message ? e.message : e) };
  }
}

/*
  Verify a signed grant object — the shape the registry issues for a
  trial, a comp or a purchase that has to keep working offline:

      { kind: 'pro30', plan: 'pro', until: 1790000000000 }

  `until` is inside the signed payload, so extending it on disk
  invalidates the signature rather than extending the entitlement.
*/
async function verifyOfflineGrant(grant, signature) {
  if (!grant || typeof grant !== 'object') return { ok: false, reason: 'malformed', detail: 'grant must be an object' };
  const payload = canonical(grant);
  const res = await verifyOfflineLicense(payload, signature);
  if (!res.ok) return res;

  const now = Date.now();
  const until = Number(grant.until || 0);
  if (!until || until <= now) {
    return { ok: false, reason: 'expired', detail: 'the grant has expired', until };
  }
  const plan = normalize(grant.plan || 'pro');
  if (PREMIUM.indexOf(plan) === -1) {
    return { ok: false, reason: 'not-premium', detail: 'the grant does not name a paid plan', plan };
  }
  return { ok: true, reason: 'verified', plan, until, payload, kind: grant.kind || '' };
}

/*
  Accept a redeemable code that carries its own proof — the format
  refcode.js already mints — and report it as an entitlement. This is
  the path a customer actually has: a code in an email, redeemed with
  no registry.
*/
async function verifyOfflineCode(code) {
  if (!RefCode || typeof RefCode.verify !== 'function') {
    return { ok: false, reason: 'not-configured', detail: 'the reference-code verifier is unavailable' };
  }
  const res = await RefCode.verify(code);
  if (!res || !res.ok) {
    return { ok: false, reason: (res && res.reason) || 'invalid', detail: (res && res.detail) || '' };
  }
  const days = Number(res.proDays || 0);
  return { ok: true, reason: 'verified', plan: 'pro', until: Date.now() + days * 864e5, days, kind: res.kind || '' };
}

function normalize(plan) {
  const p = String(plan == null ? '' : plan).trim().toLowerCase();
  if (Plans && typeof Plans.normalizePlan === 'function') {
    try { return Plans.normalizePlan(p); } catch (e) { /* fall through */ }
  }
  return p || 'free';
}

/*
  The gate. Given a stored subscription state, decide what the user is
  actually entitled to.

  A premium claim is only honoured with a signature this build can
  check. That is the difference between this module and the string flag
  it replaces: the flag is asserted by whoever wrote the storage, the
  signature can only be produced by the holder of the private key.

  `opts.allowUnconfigured` keeps the older behaviour available for a
  build that genuinely has no key installed, where refusing every
  premium claim would lock paying customers out of a product they
  bought. It does not make an unverified grant verified — it reports
  `verified:false` so a caller can decide.
*/
async function verifyGrantState(state, opts) {
  const s = state && typeof state === 'object' ? state : {};
  const claimed = normalize(s.plan);
  const premium = PREMIUM.indexOf(claimed) !== -1;
  const out = { plan: 'free', claimed, verified: false, reason: premium ? '' : 'free-plan', until: 0 };

  if (!premium) return out;

  // An expiry is still an expiry: even a good grant stops mattering.
  const expiresAt = Number(s.planExpiresAt || 0);
  if (expiresAt && expiresAt <= Date.now()) {
    out.reason = 'expired';
    out.until = expiresAt;
    return out;
  }

  const grant = s.grantPayload || null;
  const signature = s.grantSignature || '';

  if (!grant && !signature) {
    out.reason = isConfigured() ? 'unverified-grant' : 'not-configured';
    if (out.reason === 'not-configured' && opts && opts.allowUnconfigured) {
      out.plan = claimed;                 // honoured, but never marked verified
      out.until = Math.max(Number(s.trialProUntil || 0), Number(s.reviewProPlusUntil || 0), expiresAt);
    }
    return out;
  }

  let parsed = grant;
  if (typeof grant === 'string') {
    try { parsed = JSON.parse(grant); } catch (e) { out.reason = 'malformed'; return out; }
  }
  const res = await verifyOfflineGrant(parsed, signature);
  if (!res.ok) { out.reason = res.reason; out.until = Number(res.until || 0); return out; }
  if (PREMIUM.indexOf(res.plan) === -1) { out.reason = 'not-premium'; return out; }

  out.plan = res.plan;
  out.verified = true;
  out.reason = 'verified';
  out.until = res.until;
  return out;
}

/*
  Produce the storage fields that make a grant verifiable later. This is
  what a registry response becomes once it has been signed, and it is
  the only way state should acquire a premium plan.
*/
async function applySignedGrant(state, grant, signature) {
  const res = await verifyOfflineGrant(grant, signature);
  if (!res.ok) return { ok: false, reason: res.reason, state };
  const next = Object.assign({}, state || {}, {
    plan: res.plan,
    source: 'grant',
    grantPayload: canonical(grant),
    grantSignature: String(signature || '').trim(),
    planExpiresAt: res.until,
    updatedAt: Date.now()
  });
  return { ok: true, state: next };
}

// ---- limits ----------------------------------------------------------

/*
  What a state is allowed to do. `null` in the plans module means "no
  cap", translated here to Infinity so callers can compare numerically
  without special-casing null.
*/
function limitsFor(state) {
  const plan = normalize(state && state.plan);
  const premium = PREMIUM.indexOf(plan) !== -1;
  if (premium) {
    let sections = Infinity;
    let projects = Infinity;
    try {
      const p = Plans && typeof Plans.getPlan === 'function' ? Plans.getPlan(plan) : null;
      const lim = p && p.limits ? p.limits : null;
      if (lim && typeof lim.sectionsPerSite === 'number') sections = lim.sectionsPerSite;
      if (lim && typeof lim.projects === 'number') projects = lim.projects;
    } catch (e) { /* unlimited */ }
    return { plan, projects: projects, sections: sections, premium: true };
  }
  const free = freeLimits();
  return { plan: plan, projects: free.projects, sections: free.sections, premium: false };
}

function countSections(project) {
  const p = project && typeof project === 'object' ? project : {};
  const direct = p.sections;
  if (Array.isArray(direct)) return direct.length;
  if (p.site && Array.isArray(p.site.sections)) return p.site.sections.length;
  if (Array.isArray(p.pages)) {
    return p.pages.reduce((n, page) => n + (page && Array.isArray(page.sections) ? page.sections.length : 0), 0);
  }
  return 0;
}

/*
  Enforce the section cap. Returns errors rather than trimming: a
  compiler that silently deletes a customer's sections to fit a plan is
  a data-loss bug wearing a paywall, and the caller already has a
  pre-flight gate to report through.
*/
function enforceSections(project, state) {
  const limits = limitsFor(state);
  const count = countSections(project);
  const errors = [];
  const warnings = [];
  if (count > limits.sections) {
    errors.push('This site has ' + count + ' sections; the ' + limits.plan + ' plan allows ' + limits.sections + '.');
  }
  return { ok: errors.length === 0, count, limits, errors, warnings };
}

function enforceProjects(projects, state) {
  const limits = limitsFor(state);
  const list = Array.isArray(projects) ? projects : [];
  const errors = [];
  if (list.length > limits.projects) {
    errors.push('This library has ' + list.length + ' projects; the ' + limits.plan + ' plan allows ' + limits.projects + '.');
  }
  return { ok: errors.length === 0, count: list.length, limits, errors, warnings: [] };
}

// A short, honest status line for the UI: never claims verified unless it was.
async function describe(state) {
  const res = await verifyGrantState(state);
  if (res.verified) return res.plan === 'proplus' ? 'Pro+ (verified offline)' : 'Pro (verified offline)';
  if (res.plan === 'free' && res.claimed && res.claimed !== 'free') {
    return 'Free — the stored ' + res.claimed + ' entitlement could not be verified (' + res.reason + ')';
  }
  return 'Free';
}

module.exports = {
  freeLimits,
  limitsFor,
  isConfigured,
  publicKey,
  canonical,
  verifyOfflineLicense,
  verifyOfflineGrant,
  verifyOfflineCode,
  verifyGrantState,
  applySignedGrant,
  enforceSections,
  enforceProjects,
  countSections,
  describe,
  PREMIUM
};
