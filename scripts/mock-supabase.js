// ============================================================
// PallettAI Studio — local mock of the Supabase registry
// Implements the exact semantics of supabase/schema.sql so the
// real client (modules/supabase.js) can be tested end-to-end
// without touching the production project.
//
//   node scripts/mock-supabase.js   (serves on :54321)
//
// Endpoints implemented:
//   POST /auth/v1/signup · /auth/v1/token?grant_type=password|refresh_token · /auth/v1/logout
//   GET  /rest/v1/profiles · /rest/v1/referral_codes · /rest/v1/licenses · /rest/v1/credit_spends
//   POST /rest/v1/rpc/redeem_code · /rest/v1/rpc/activate_license
//        /rest/v1/rpc/apply_stripe_entitlement · /rest/v1/rpc/claim_review_reward
//        /rest/v1/rpc/get_streak_state · /rest/v1/rpc/claim_daily_reward · /rest/v1/rpc/spin_wheel
//        /rest/v1/rpc/get_credit_state · /rest/v1/rpc/spend_credit · /rest/v1/rpc/refund_credit
// Test hooks (used by the smoke suites + manual UI testing):
//   GET /__advance?days=N   advance the virtual UTC clock (server-side day)
//   GET /__grantShield      +1 streak shield for the bearer's account (max 2)
//   GET /__grantTrial?hours=N  grant hours of Pro trial (referral/wheel semantics)
//   GET /__forceWheel?shields=N  mark a pending Day-7 wheel (debug)
//   GET /__forceSpin?seg=N  force the next spin pick 1..12 (debug)
//   GET /__state            dump the bearer's streak/claims/spins/credit rows (debug)
// ============================================================

const http = require('http');
const crypto = require('crypto');
const path = require('path');
const StripeEntitlement = require(path.join(__dirname, '..', 'supabase', 'functions', 'stripe-webhook', 'entitlement.js'));
const ReviewReward = require(path.join(__dirname, '..', 'data', 'review-reward.js'));
const reviewDb = { profiles: new Map(), rewards: new Map() };
function syncReviewProfile(u) {
  reviewDb.profiles.set(u.id, u.profile);
}
function claimReviewRewardRpc(u, payload) {
  syncReviewProfile(u);
  const r = ReviewReward.applyReviewClaim(reviewDb, {
    accountId: u.id,
    name: payload.p_name,
    quote: payload.p_quote,
    now: Date.now()
  });
  Object.assign(u.profile, reviewDb.profiles.get(u.id) || {});
  return r;
}
const stripeEventIds = new Set();
function applyStripeEntitlementRpc(payload) {
  const db = StripeEntitlement.emptyDb();
  db.events = stripeEventIds;
  for (const user of users.values()) db.profiles.set(user.id, user.profile);
  return StripeEntitlement.applyEntitlement(db, {
    ignore: false,
    eventId: payload.p_event_id,
    eventType: payload.p_event_type,
    paid: !!payload.p_paid,
    accountId: payload.p_account_id || '',
    plan: payload.p_plan || '',
    customerId: payload.p_customer_id || '',
    subscriptionId: payload.p_subscription_id || '',
    expiresAt: payload.p_expires_at || null
  });
}

const PORT = Number(process.env.MOCK_PORT || 54321);
const DAY = 864e5;

// ---------- in-memory registry (mirrors schema.sql) ----------
const users = new Map();      // uid -> { email, password, profile, codes, redemptions }
const licenses = new Map();   // code -> license row (seeded like schema.sql)
const tokens = new Map();     // token -> uid

// virtual UTC clock for the streak feature (advance via /__advance?days=N)
let virtualNow = Date.now();
const DAY_MS = 864e5;
const mockDate = (off) => new Date(virtualNow + (off || 0)).toISOString().slice(0, 10);
const mockDays = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY_MS);

function seedLicenses() {
  const now = Date.now();
  // Test-only keys for the smoke suites (never minted in production — the app
  // ships no demo keys). Codes have valid checksums so they parse like real keys.
  licenses.set('PAL-PRO-SMOKE-0GHS', { code: 'PAL-PRO-SMOKE-0GHS', plan: 'pro', owner_id: null, activated_at: null, expires_at: now + 30 * DAY, revoked: false, note: 'test' });
  licenses.set('PAL-PROPLUS-SMOKE-1GXY', { code: 'PAL-PROPLUS-SMOKE-1GXY', plan: 'proplus', owner_id: null, activated_at: null, expires_at: now + 30 * DAY, revoked: false, note: 'test' });
}
seedLicenses();

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return 'REF-' + c;
}
function uid() { return crypto.randomUUID(); }
function newUser(email, password) {
  const u = {
    id: uid(), email, password,
    profile: { id: null, email, plan: 'free', plan_expires_at: null, trial_expires_at: null, stripe_customer_id: null, stripe_subscription_id: null, entitlement_source: null, billing_status: null, billing_status_at: null, last_stripe_event_type: null, review_proplus_until: null, review_claimed_at: null, created_at: new Date().toISOString() },
    code: { owner_id: null, code: genCode(), created_at: new Date().toISOString() },
    redemptions: [],
    // daily streak state (Part 3) — lazily created like the DB row
    streak: null,
    claims: [],
    spins: [],
    spinForce: null,      // debug hook: force next spin pick 1..12
    // AI-credit ledger (Part 4 / Design A)
    creditSpends: []      // { user_id, ref, amount, refunded_at, created_at }
  };
  u.profile.id = u.id;
  u.code.owner_id = u.id;
  users.set(u.id, u);
  return u;
}
function tokenFor(u) {
  const t = 'tok_' + u.id + '_' + crypto.randomBytes(6).toString('hex');
  tokens.set(t, u.id);
  return t;
}
function bearer(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const uid_ = tokens.get(h.slice(7));
  return uid_ ? users.get(uid_) : null;
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// ---------- redeem_code RPC (schema.sql §7) ----------
function redeemCode(u, pCode) {
  const clean = String(pCode || '').trim().toUpperCase();
  const lic = [...licenses.values()]; // not used here
  const row = (o, rd, od, extra) => {
    u.redemptions.push({ code: clean, outcome: o, granted_redeemer_days: rd, granted_owner_days: od });
    return { outcome: o, grantedDays: rd, ...(extra || {}) };
  };
  const codeRow = [...users.values()].map((x) => x.code).find((c) => c.code === clean);
  if (!codeRow) return row('not-found', 0, 0);
  if (codeRow.owner_id === u.id) return row('self-redeemed', 0, 0);
  if (u.redemptions.some((r) => r.code === clean && (r.outcome === 'verified' || r.outcome === 'already-used'))) return row('already-used', 0, 0);
  // +30 to redeemer (stacked)
  const base = Math.max(Date.now(), new Date(u.profile.trial_expires_at || 0).getTime());
  const until = new Date(base + 30 * DAY).toISOString();
  u.profile.trial_expires_at = until;
  // +7 to owner (capped at 60)
  const owner = users.get(codeRow.owner_id);
  const ownerDays = owner.redemptions.reduce((s, r) => s + r.granted_owner_days, 0);
  const grantOwner = ownerDays >= 60 ? 0 : 7;
  if (grantOwner) {
    const obase = Math.max(Date.now(), new Date(owner.profile.trial_expires_at || 0).getTime());
    owner.profile.trial_expires_at = new Date(obase + 7 * DAY).toISOString();
  }
  row('verified', 30, grantOwner, { trialExpiresAt: until, ownerCapped: grantOwner === 0 ? true : undefined });
  return { outcome: 'verified', grantedDays: 30, trialExpiresAt: until, ownerCapped: grantOwner === 0 ? true : undefined };
}

// ---------- activate_license RPC (schema.sql §10) ----------
function activateLicense(u, pCode) {
  const clean = String(pCode || '').trim().toUpperCase();
  const lic = licenses.get(clean);
  if (!lic) return { outcome: 'not-found' };
  if (lic.revoked) return { outcome: 'revoked' };
  if (lic.owner_id && lic.owner_id !== u.id) return { outcome: 'in-use' };
  if (lic.expires_at && lic.expires_at < Date.now()) return { outcome: 'expired' };
  lic.owner_id = u.id;
  lic.activated_at = lic.activated_at || new Date().toISOString();
  u.profile.plan = lic.plan;
  u.profile.plan_expires_at = lic.expires_at ? new Date(lic.expires_at).toISOString() : null;
  u.profile.entitlement_source = 'license';
  return { outcome: 'verified', plan: lic.plan, expiresAt: lic.expires_at ? new Date(lic.expires_at).toISOString() : null };
}

// ---------- daily streak + wheel (schema.sql §11-18) ----------
const WHEEL_PICKS = [
  ['credits', 3], ['credits', 5], ['credits', 10], ['pro_hours', 3], ['pro_hours', 3], ['pro_hours', 12],
  ['pro_hours', 24], ['pro_hours', 72], ['shield', 0], ['pro_hours', 168], ['credits', 5], ['credits', 3]
]; // index 0 = pick 1 … index 11 = pick 12 (matches schema.sql §17)

function ensureStreak(u) {
  if (!u.streak) {
    u.streak = { consecutive_days: 0, best_days: 0, last_claim_date: null, frozen_date: null, shields: 0, bonus_credits: 0, wheel_pending: false };
  }
  return u.streak;
}
const dayPrizeOf = (d) => (d === 7 ? { type: 'wheel' } : { type: 'credits', amount: d + 1 });

function streakPayload(u) {
  const s = ensureStreak(u);
  const today = mockDate();
  const claimed = s.last_claim_date === today;
  let gap = s.last_claim_date ? mockDays(today, s.last_claim_date) : 0;
  let cycle = 0, next = 1, restarting = false, freeze = false;
  if (s.consecutive_days > 0) {
    cycle = ((s.consecutive_days - 1) % 7) + 1;
    next = (s.consecutive_days % 7) + 1;
    if (claimed) { restarting = false; freeze = false; }
    else if (gap >= 2) { freeze = gap === 2 && s.shields >= 1; restarting = !freeze; if (restarting) next = 1; }
    else { restarting = false; freeze = false; }
  }
  return {
    ok: true,
    today,
    streak: s.consecutive_days,
    best: Math.max(s.best_days, s.consecutive_days),
    shields: s.shields,
    bonusCredits: s.bonus_credits,
    wheelPending: !!s.wheel_pending,
    claimedToday: claimed,
    frozenToday: s.frozen_date === today,
    cycleDay: cycle,
    nextCycle: next,
    restarting,
    freezeNext: freeze,
    nextPrize: dayPrizeOf(next),
    schedule: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ day: d, prize: dayPrizeOf(d) }))
  };
}

function claimDaily(u, pAction) {
  const s = ensureStreak(u);
  const today = mockDate();
  if (s.last_claim_date === today) return { ...streakPayload(u), outcome: 'already-claimed' };
  const gap = s.last_claim_date ? mockDays(today, s.last_claim_date) : 0;
  let shieldUsed = false;
  if (s.last_claim_date && gap > 1) {
    if (gap === 2 && s.shields >= 1) {
      shieldUsed = true;
      s.shields -= 1;
      s.frozen_date = mockDate(-DAY_MS);
    } else {
      s.consecutive_days = 0;
      s.frozen_date = null;
    }
  }
  s.consecutive_days += 1;
  s.best_days = Math.max(s.best_days, s.consecutive_days);
  s.last_claim_date = today;
  const cycle = ((s.consecutive_days - 1) % 7) + 1;
  let prizeType = 'credits', prizeAmount = 0, shieldGranted = false;
  if (cycle <= 6) {
    prizeAmount = cycle + 1;
    s.bonus_credits += prizeAmount;
  } else {
    prizeType = 'wheel';
    s.wheel_pending = true;
    if (s.shields < 2) { s.shields += 1; shieldGranted = true; }
    else s.bonus_credits += 5;
  }
  u.claims.push({ user_id: u.id, claim_date: today, action: String(pAction || 'claim').slice(0, 40) || 'claim', cycle_day: cycle, prize_type: prizeType, prize_amount: prizeAmount, shield_used: shieldUsed });
  return {
    ...streakPayload(u),
    outcome: 'claimed',
    claim: { cycleDay: cycle, prizeType, prizeAmount, shieldGranted, shieldUsed }
  };
}

function spinWheel(u) {
  const s = ensureStreak(u);
  if (!s.wheel_pending) return { ...streakPayload(u), outcome: 'not-ready' };
  const today = mockDate();
  let pick;
  if (u.spinForce) { pick = u.spinForce; u.spinForce = null; }
  else pick = 1 + Math.floor(Math.random() * 12);
  const [type0, amt0] = WHEEL_PICKS[pick - 1];
  let type = type0, amount = amt0, trialExpiresAt = null;
  if (type === 'credits') s.bonus_credits += amount;
  else if (type === 'pro_hours') {
    const base = Math.max(Date.now(), new Date(u.profile.trial_expires_at || 0).getTime());
    const until = new Date(base + amount * 3600e3);
    u.profile.trial_expires_at = until.toISOString();
    trialExpiresAt = until.toISOString();
  } else {
    if (s.shields < 2) { s.shields += 1; type = 'shield'; amount = 0; }
    else { type = 'credits'; amount = 5; s.bonus_credits += 5; }
  }
  s.wheel_pending = false;
  u.spins.push({ user_id: u.id, spin_date: today, prize_type: type, prize_amount: amount });
  return { ...streakPayload(u), outcome: 'spun', prize: { type, amount }, trialExpiresAt };
}

// ---------- AI-credit accounting (schema.sql §20-25 / Design A) ----------
const CREDIT_REFUND_MS = 10 * 60e3; // refund window: 10 minutes (mirrors SQL)
function creditPayload(u) {
  const st = u.streak;
  const bonus = (st && st.bonus_credits) || 0;
  // Legacy Agency profile values are normalized to the retired tier's successor.
  const plan = ({ agency: 'proplus', pro: 'pro', proplus: 'proplus' }[String(u.profile.plan || '').toLowerCase()] || 'free');
  const planActive = (plan === 'pro' || plan === 'proplus') && (!u.profile.plan_expires_at || new Date(u.profile.plan_expires_at).getTime() > Date.now());
  const trialActive = !!u.profile.trial_expires_at && new Date(u.profile.trial_expires_at).getTime() > Date.now();
  const reviewActive = !!u.profile.review_proplus_until && new Date(u.profile.review_proplus_until).getTime() > Date.now();
  const unlimited = planActive || trialActive || reviewActive;
  const used = u.creditSpends.filter((s) => !s.refunded_at).reduce((n, x) => n + x.amount, 0);
  const base = 3; // mirrors PLANS free limits.aiCredits + schema.sql §21
  return {
    ok: true,
    plan: plan || 'free',
    unlimited,
    baseCredits: base,
    bonusCredits: bonus,
    used,
    left: unlimited ? -1 : Math.max(0, base + bonus - used)
  };
}
function spendCredit(u, pRef, pAmount) {
  const ref = String(pRef || '').trim().slice(0, 64);
  const amount = Math.max(1, Math.min(100, Number(pAmount) || 1));
  if (!ref) return { ...creditPayload(u), outcome: 'no-ref' };
  if (u.creditSpends.some((s) => s.ref === ref)) return { ...creditPayload(u), outcome: 'already-spent' };
  if (creditPayload(u).unlimited) return { ...creditPayload(u), outcome: 'unlimited' };
  const p = creditPayload(u);
  if (p.left < amount) return { ...p, outcome: 'insufficient' };
  u.creditSpends.push({ user_id: u.id, ref, amount, refunded_at: null, created_at: new Date().toISOString() });
  return { ...creditPayload(u), outcome: 'spent' };
}
function refundCredit(u, pRef) {
  const row = u.creditSpends.find((s) => s.ref === String(pRef || '').trim().slice(0, 64));
  if (!row) return { ...creditPayload(u), outcome: 'not-found' };
  if (row.refunded_at) return { ...creditPayload(u), outcome: 'already-refunded' };
  if (Date.now() - new Date(row.created_at).getTime() > CREDIT_REFUND_MS) return { ...creditPayload(u), outcome: 'too-late' };
  row.refunded_at = new Date().toISOString();
  return { ...creditPayload(u), outcome: 'refunded' };
}

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'apikey, authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    let payload = {};
    try { payload = body ? JSON.parse(body) : {}; } catch (e) { return json(res, 400, { msg: 'bad json' }); }

    // ---- auth ----
    if (req.method === 'POST' && p === '/auth/v1/signup') {
      const email = String(payload.email || '').toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error_code: 'invalid_email', msg: 'Unable to validate email address: invalid format' });
      if (payload.password.length < 6) return json(res, 400, { error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
      const existing = [...users.values()].find((u) => u.email === email);
      if (existing) return json(res, 400, { error_code: 'user_already_exists', msg: 'User already registered' });
      const u = newUser(email, payload.password);
      const t = tokenFor(u);
      return json(res, 200, { access_token: t, token_type: 'bearer', expires_in: 3600, refresh_token: 'rf_' + u.id, user: { id: u.id, email: u.email } });
    }
    if (req.method === 'POST' && p === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'password') {
        const u = [...users.values()].find((x) => x.email === String(payload.email || '').toLowerCase());
        if (!u || u.password !== payload.password) return json(res, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        const t = tokenFor(u);
        return json(res, 200, { access_token: t, token_type: 'bearer', expires_in: 3600, refresh_token: 'rf_' + u.id, user: { id: u.id, email: u.email } });
      }
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const u = [...users.values()].find((x) => 'rf_' + x.id === payload.refresh_token);
        if (!u) return json(res, 400, { error_code: 'bad_refresh_token', msg: 'Invalid Refresh Token' });
        const t = tokenFor(u);
        return json(res, 200, { access_token: t, token_type: 'bearer', expires_in: 3600, refresh_token: 'rf_' + u.id, user: { id: u.id, email: u.email } });
      }
      return json(res, 400, { error_code: 'unsupported_grant_type', msg: 'unsupported grant_type' });
    }
    if (req.method === 'POST' && p === '/auth/v1/recover') {
      const email = String((payload && payload.email) || '').trim().toLowerCase();
      const found = [...users.values()].find((x) => x.email === email);
      if (!found) return json(res, 400, { error_code: 'user_not_found', msg: 'User not found' });
      found.resetSent = true;
      return json(res, 200, {});
    }
    if (req.method === 'PUT' && p === '/auth/v1/user') {
      const authed = bearer(req);
      if (!authed) return json(res, 401, { error_code: '401', msg: 'Invalid JWT' });
      const next = String((payload && payload.password) || '');
      if (next.length < 6) return json(res, 400, { error_code: 'weak_password', msg: 'Password must be at least 6 characters' });
      authed.password = next;
      return json(res, 200, { id: authed.id, email: authed.email });
    }
    if (req.method === 'POST' && p === '/auth/v1/logout') {
      const u = bearer(req);
      if (u) tokens.forEach((v, k) => { if (v === u.id) tokens.delete(k); });
      res.writeHead(204); res.end(); return;
    }

    // ---- test hooks (before auth so /__advance can run globally) ----
    if (req.method === 'GET' && p === '/__advance') {
      const n = Number(url.searchParams.get('days') || 1);
      virtualNow += Math.max(1, n) * DAY_MS;
      return json(res, 200, { ok: true, today: mockDate() });
    }

    if (req.method === 'POST' && p === '/rest/v1/rpc/apply_stripe_entitlement') {
      return json(res, 200, applyStripeEntitlementRpc(payload));
    }

    // ---- authenticated REST ----
    const u = bearer(req);
    if (!u) return json(res, 401, { code: '401', message: 'Invalid JWT' });

    // ---- test hooks (authenticated) ----
    if (req.method === 'GET' && p === '/__grantShield') {
      const s = ensureStreak(u);
      s.shields = Math.min(2, s.shields + 1);
      return json(res, 200, { ok: true, shields: s.shields });
    }
    if (req.method === 'GET' && p === '/__forceWheel') {
      const s = ensureStreak(u);
      s.wheel_pending = true;
      const sh = Number(url.searchParams.get('shields'));
      if (!Number.isNaN(sh)) s.shields = Math.max(0, Math.min(2, sh));
      return json(res, 200, { ok: true, shields: s.shields, wheel_pending: s.wheel_pending });
    }
    if (req.method === 'GET' && p === '/__forceSpin') {
      const seg = Number(url.searchParams.get('seg'));
      u.spinForce = (seg >= 1 && seg <= 12) ? seg : null;
      return json(res, 200, { ok: true, forced: u.spinForce });
    }
    if (req.method === 'GET' && p === '/__state') {
      return json(res, 200, {
        today: mockDate(),
        me: { email: u.email, streak: u.streak, claims: u.claims, spins: u.spins, creditSpends: u.creditSpends, profile: u.profile }
      });
    }
    if (req.method === 'GET' && p === '/__grantTrial') {
      // debug hook: grant hours of Pro trial (like a wheel/referral grant)
      const hours = Number(url.searchParams.get('hours') || 24);
      const base = Math.max(Date.now(), new Date(u.profile.trial_expires_at || 0).getTime());
      u.profile.trial_expires_at = new Date(base + hours * 3600e3).toISOString();
      return json(res, 200, { ok: true, trial_expires_at: u.profile.trial_expires_at });
    }

    if (req.method === 'GET' && p === '/rest/v1/profiles') {
      return json(res, 200, [u.profile]);
    }
    if (req.method === 'GET' && p === '/rest/v1/referral_codes') {
      return json(res, 200, [u.code]);
    }
    if (req.method === 'GET' && p === '/rest/v1/licenses') {
      return json(res, 200, [...licenses.values()].filter((l) => l.owner_id === u.id).map((l) => ({ code: l.code, plan: l.plan, expires_at: l.expires_at ? new Date(l.expires_at).toISOString() : null })));
    }
    if (req.method === 'GET' && p === '/rest/v1/credit_spends') {
      return json(res, 200, u.creditSpends.filter((s) => s.user_id === u.id).map((s) => ({ ref: s.ref, amount: s.amount, refunded_at: s.refunded_at, created_at: s.created_at })));
    }
    if (req.method === 'POST' && p === '/rest/v1/rpc/redeem_code') {
      return json(res, 200, redeemCode(u, payload.p_code));
    }
    if (req.method === 'POST' && p === '/rest/v1/rpc/activate_license') {
      return json(res, 200, activateLicense(u, payload.p_code));
    }
    if (req.method === 'POST' && p === '/rest/v1/rpc/get_streak_state') {
      return json(res, 200, streakPayload(u));
    }
    if (req.method === 'POST' && p === '/rest/v1/rpc/claim_daily_reward') {
      return json(res, 200, claimDaily(u, payload.p_action));
    }
    if (req.method === 'POST' && p === '/rest/v1/rpc/spin_wheel') {
      return json(res, 200, spinWheel(u));
    }
    if (req.method === 'POST' && p === '/rest/v1/rpc/get_credit_state') {
      return json(res, 200, creditPayload(u));
    }
    if (req.method === 'POST' && p === '/rest/v1/rpc/spend_credit') {
      return json(res, 200, spendCredit(u, payload.p_ref, payload.p_amount));
    }
    if (req.method === 'POST' && p === '/rest/v1/rpc/refund_credit') {
      return json(res, 200, refundCredit(u, payload.p_ref));
    }
    if (req.method === 'POST' && p === '/rest/v1/rpc/claim_review_reward') {
      return json(res, 200, claimReviewRewardRpc(u, payload));
    }
    return json(res, 404, { code: '404', message: 'not found' });
  });
});

server.listen(PORT, () => console.log('Mock Supabase registry on http://127.0.0.1:' + PORT));