// ============================================================
// PallettAI Studio — live trial-key activation probe
// Exercises the REAL registry (config from ref.html) against
// the new Pro+ trial-key flow. Creates one throwaway mail.tm
// inbox + Supabase account, confirms it, activates the trial
// key, reads the bound license + profile back, then reports
// the exact created rows so you can delete them from the
// dashboard. Does NOT touch any of your real accounts.
//
//   node scripts/live-trial-key-check.js
// ============================================================

'use strict';

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
const TRIAL_KEY = process.env.TRIAL_KEY || 'PAL-PROPLUS-TRIAL-0R3K';

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 300) : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // --- config from ref.html (honours rotated keys) ---
  const html = fs.readFileSync(path.join(__dirname, '..', 'ref.html'), 'utf8');
  const url = (html.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
  const key = (html.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/) || [])[0];
  if (!url || !key) { console.error('could not extract supabase config from ref.html'); process.exit(1); }
  console.log('registry:', url);
  console.log('trial key under test:', TRIAL_KEY);
  console.log('config valid:', SUPABASE.setConfig(url, key).ok && SUPABASE.isConfigured());

  // --- anonymous reachability ---
  let r = await SUPABASE.signIn('no-such-' + Date.now() + '@example.com', 'nope');
  check('sign-in bogus → correctly rejected (not a network error)', !r.ok && !r.offline, r.msg || r.error);

  // --- mail.tm inbox ---
  const doms = await fetch(MAIL + '/domains').then((x) => x.json()).catch(() => ({})).then((d) => (d['hydra:member'] || []).map((x) => x.domain));
  const domain = (doms && doms[0]) || 'mail.tm';
  const reqAddr = 'trialkey.lc' + Date.now().toString(36).slice(-8) + '@' + domain;
  async function mt(fn) {
    for (let i = 0; i < 6; i++) {
      try {
        const r = await fn();
        if (r && (r.id || r.token)) return r;
      } catch (e) { /* retry */ }
      await sleep(3000);
    }
    return {};
  }
  const mbox = await mt(() => fetch(MAIL + '/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: reqAddr, password: 'Mailbox12345!' })
  }).then((x) => x.json()));
  check('mail.tm account created (' + reqAddr + ')', !!mbox.id, mbox);
  if (!mbox.id) process.exit(fail ? 1 : 0);
  const addr = mbox.address; // canonical form
  if (addr !== reqAddr) console.log('  (canonical address: ' + addr + ')');
  const tok = await mt(() => fetch(MAIL + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, password: 'Mailbox12345!' })
  }).then((x) => x.json()));
  const mtToken = tok && tok.token;
  check('mail.tm token obtained', !!mtToken, tok);
  if (!mtToken) process.exit(fail ? 1 : 0);

  // --- signup ---
  r = await SUPABASE.signUp(addr, PW);
  check('signup accepted (needsConfirm)', r.ok && !!r.needsConfirm, r);
  if (!r.ok) process.exit(fail ? 1 : 0);

  // --- poll mail.tm for the confirmation message ---
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
  if (!msg) { console.log('  leftover UNVERIFIED user in dashboard:', addr); process.exit(fail ? 1 : 0); }
  const text = (msg.text || '') + ' ' + (msg.html || '');
  const link = (text.match(/https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1\/verify\?[^\"'\\s<>)]+/) || [])[0];
  check('confirmation link extracted', !!link, link ? '' : text.slice(0, 300));
  if (!link) process.exit(fail ? 1 : 0);
  const conf = await fetch(link.replace(/&amp;/g, '&').replace(/&#38;/g, '&'), { redirect: 'manual' }).catch(() => null);
  check('confirmation accepted (HTTP ' + (conf ? conf.status : 'n/a') + ')', !!conf && conf.status < 400, conf && conf.status);

  // --- sign in ---
  r = await SUPABASE.signIn(addr, PW);
  check('sign-in after confirm', r.ok && !r.needsConfirm, r);
  if (!r.ok) process.exit(fail ? 1 : 0);

  // --- registry state ---
  const st = await SUPABASE.getMyState();
  check('profile row readable (schema applied)', st.ok && !!st.profile && st.profile.email === addr, st.profile);
  check('stable REF code minted by trigger', st.ok && !!st.code && /^REF-[A-Z0-9]{6}$/.test(st.code.code), st.ok && st.code);
  check('no license bound yet', st.ok && !st.license);

  // --- redeem own code (self-redeem guard) ---
  if (st.code) {
    r = await SUPABASE.redeem(st.code.code);
    check('own code → self-redeemed (no state change)', r.ok && r.outcome === 'self-redeemed', r);
  }

  // --- activate the trial key (the thing we're checking) ---
  console.log('\n[activate trial key]');
  r = await SUPABASE.activateLicense(TRIAL_KEY);
  check('activate → outcome', r.ok, r);
  check('activate → outcome == verified', r.ok && r.outcome === 'verified', r && r.outcome);
  check('activate → plan == proplus', r.ok && r.plan === 'proplus', r && r.plan);
  check('activate → expiresAt present', r.ok && !!r.expiresAt, r && r.expiresAt);

  // --- re-read state: license bound, plan on profile ---
  const st2 = await SUPABASE.getMyState();
  check('license now bound to account', st2.ok && st2.license && st2.license.code === TRIAL_KEY, st2.license);
  check('license plan == proplus', st2.ok && st2.license && st2.license.plan === 'proplus', st2.license);
  check('profile.plan == proplus', st2.ok && st2.profile && st2.profile.plan === 'proplus', st2.profile && st2.profile.plan);
  check('profile.plan_expires_at set', st2.ok && st2.profile && !!st2.profile.plan_expires_at, st2.profile && st2.profile.plan_expires_at);

  // --- raw REST proof of the bound license row (RLS: own only) ---
  const s = SUPABASE.session();
  const hdr = { apikey: key, Authorization: 'Bearer ' + s.accessToken };
  const licRows = await fetch(url + '/rest/v1/licenses?select=code,plan,expires_at,note,owner_id&code=eq.' + encodeURIComponent(TRIAL_KEY), { headers: hdr }).then((x) => x.json()).catch(() => null);
  check('REST can read the bound license row (RLS: own)', Array.isArray(licRows) && licRows.length === 1 && licRows[0].code === TRIAL_KEY, licRows);

  // --- downgrade guard: verifys the registry path is the real gate ---
  await SUPABASE.downgrade ? SUPABASE.downgrade() : null;
  const st3 = await SUPABASE.getMyState();
  check('after downgrade: profile.plan returns to free', st3.ok && st3.profile && st3.profile.plan === 'free', st3.profile && st3.profile.plan);

  // --- leftover summary ---
  console.log('\n=== CREATED ROWS (delete from dashboard) ===');
  console.log('  auth.user  :', addr, '(confirmed)');
  console.log('  public.profiles :', s.uid);
  console.log('  public.referral_codes :', st.code && st.code.code);
  console.log('  public.licenses      :', TRIAL_KEY, '(owned by', s.uid, ')');
  const profRows = await fetch(url + '/rest/v1/profiles?select=id,email,plan,plan_expires_at&email=eq.' + encodeURIComponent(addr), { headers: hdr }).then((x) => x.json()).catch(() => null);
  check('profile REST row matches', Array.isArray(profRows) && profRows.length === 1, profRows);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('probe crashed:', e); process.exit(1); });
