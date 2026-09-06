// ============================================================
// PallettAI Studio — LIVE check of the streak RPCs against the
// real registry (run after applying supabase/schema.sql).
// Creates a throwaway account via a mail.tm inbox, confirms the
// email, then exercises get_streak_state / claim_daily_reward /
// spin_wheel exactly like the client does. Grants +2 bonus
// credits to a throwaway account only (harmless). Leftover test
// users can be deleted from the dashboard (Authentication→Users).
//   node scripts/live-streak.js
// ============================================================

const fs = require('fs');
const path = require('path');
const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

const SUPABASE = require('../modules/supabase.js');
const MAIL = 'https://api.mail.tm';
const PW = 'Check12345!';
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → got: ' + JSON.stringify(extra).slice(0, 400) : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ref.html'), 'utf8');
  const url = (html.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
  const key = (html.match(/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/) || [])[0];
  if (!url || !key) { console.error('could not extract supabase config from ref.html'); process.exit(1); }
  SUPABASE.setConfig(url, key);
  console.log('registry:', url);

  // ---- mail.tm inbox ----
  const doms = await fetch(MAIL + '/domains').then((x) => x.json()).catch(() => ({})).then((d) => (d['hydra:member'] || []).map((x) => x.domain));
  const domain = (doms && doms[0]) || 'mail.tm';
  const reqAddr = 'streak.lc' + Date.now().toString(36).slice(-8) + '@' + domain;
  async function mt(fn) {
    for (let i = 0; i < 5; i++) {
      try {
        const r = await fn();
        if (r && (r.id || r.token)) return r;
      } catch (e) { /* retry */ }
      await sleep(2500);
    }
    return {};
  }
  const mbox = await mt(() => fetch(MAIL + '/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: reqAddr, password: 'Mailbox12345!' })
  }).then((x) => x.json()));
  check('mail.tm account created', !!mbox.id, mbox);
  if (!mbox.id) process.exit(1);
  const addr = mbox.address;
  const tok = await mt(() => fetch(MAIL + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, password: 'Mailbox12345!' })
  }).then((x) => x.json()));
  const mtToken = tok && tok.token;
  check('mail.tm token obtained', !!mtToken, tok);
  if (!mtToken) process.exit(1);

  // ---- signup on the real registry ----
  let r = await SUPABASE.signUp(addr, PW);
  check('signup accepted (needsConfirm)', r.ok && !!r.needsConfirm, r);
  if (!r.ok) process.exit(1);

  console.log('\n[confirm] waiting for email to', addr);
  const auth = { Authorization: 'Bearer ' + mtToken, 'Content-Type': 'application/json' };
  let msg = null;
  for (let i = 0; i < 24 && !msg; i++) {
    await sleep(7000);
    const list = await fetch(MAIL + '/messages', { headers: auth }).then((x) => x.json()).catch(() => []);
    const first = (list['hydra:member'] || [])[0];
    if (first) msg = await fetch(MAIL + '/messages/' + first.id, { headers: auth }).then((x) => x.json()).catch(() => null);
  }
  check('confirmation email arrived', !!msg);
  if (!msg) { console.log('  (leftover unverified user: ' + addr + ')'); process.exit(fail ? 1 : 0); }
  const text = (msg.text || '') + ' ' + (msg.html || '');
  const link = (text.match(/https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1\/verify\?[^"'\s<>)]+/) || [])[0];
  check('confirmation link extracted', !!link);
  if (!link) process.exit(fail ? 1 : 0);
  const conf = await fetch(link.replace(/&amp;/g, '&').replace(/&#38;/g, '&'), { redirect: 'manual' }).catch(() => null);
  check('confirmation accepted (HTTP ' + (conf ? conf.status : 'n/a') + ')', !!conf && conf.status < 400, conf && conf.status);
  r = await SUPABASE.signIn(addr, PW);
  check('sign-in after confirm', r.ok && !r.needsConfirm, r);
  if (!r.ok) process.exit(1);

  // ---- streak RPCs (what the client calls) ----
  // Note: PostgREST returns the jsonb payload flat (no wrapper) —
  // the same shape the mock returns and the widget consumes.
  console.log('\n[streak rpcs]');
  r = await SUPABASE.getStreakState();
  check('get_streak_state → fresh: streak 0, day 0/1, next prize +2', r.ok && r.streak === 0 && r.cycleDay === 0 && r.nextCycle === 1 && !r.claimedToday && r.nextPrize && r.nextPrize.type === 'credits' && r.nextPrize.amount === 2, { streak: r.streak, nextCycle: r.nextCycle, nextPrize: r.nextPrize });

  r = await SUPABASE.claimDailyReward();
  check('claim_daily_reward → claimed, Day 1, +2 credits', r.ok && r.outcome === 'claimed' && r.claim && r.claim.cycleDay === 1 && r.claim.prizeType === 'credits' && r.claim.prizeAmount === 2 && r.bonusCredits === 2, r);

  r = await SUPABASE.getStreakState();
  check('state after claim: streak 1, claimedToday, bonus 2', r.ok && r.streak === 1 && r.claimedToday && r.bonusCredits === 2 && r.cycleDay === 1, { streak: r.streak, claimedToday: r.claimedToday, bonusCredits: r.bonusCredits, cycleDay: r.cycleDay });

  r = await SUPABASE.claimDailyReward();
  check('second claim same day → already-claimed, bonus still 2', r.ok && r.outcome === 'already-claimed' && r.bonusCredits === 2, r);

  r = await SUPABASE.spinWheel();
  check('spin before Day 7 → not-ready (wheel_pending guard)', r.ok && r.outcome === 'not-ready', r);

  // ---- audit + privacy: own rows readable via REST ----
  const s = SUPABASE.session();
  console.log('\n[rows]');
  const hdr = { apikey: key, Authorization: 'Bearer ' + s.accessToken };
  const own = await fetch(url + '/rest/v1/user_streaks?select=consecutive_days,bonus_credits,shields,wheel_pending&user_id=eq.' + s.uid, { headers: hdr }).then((x) => x.json()).catch(() => null);
  check('user_streaks row visible (own)', !!own && own.length === 1 && own[0].bonus_credits === 2 && own[0].consecutive_days === 1, own);
  const claims = await fetch(url + '/rest/v1/streak_claims?select=claim_date,cycle_day,prize_type,prize_amount&user_id=eq.' + s.uid, { headers: hdr }).then((x) => x.json()).catch(() => null);
  check('streak_claims stamped (1 row, +2)', !!claims && claims.length === 1 && claims[0].prize_type === 'credits' && claims[0].prize_amount === 2, claims);

  // ---- anon (signed-out) cannot touch the streak RPCs ----
  // After §19 of the schema this must be a clean permission-gate denial
  // ("permission denied for function …"), not a data error inside the body.
  const anon = await fetch(url + '/rest/v1/rpc/claim_daily_reward', {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_action: 'claim' })
  });
  const anonBody = await anon.json().catch(() => ({}));
  check('signed-out RPC → permission-gate denial (HTTP ' + anon.status + ')',
    anon.status >= 400 && /permission denied/i.test(String(anonBody.message || '')),
    { status: anon.status, message: anonBody.message });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('leftover confirmed test user (delete in dashboard): ' + addr);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('live streak check crashed:', e); process.exit(1); });
