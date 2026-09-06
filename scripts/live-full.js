// ============================================================
// PallettAI Studio — full LIVE check against the real registry
// Creates a throwaway account via a mail.tm inbox, confirms the
// email, then exercises profile/code fetch + redeem + activate
// RPCs. Does NOT bind any real license (uses a bogus key for the
// activate path). Leftover test users can be deleted
// from the Supabase dashboard (Authentication → Users).
//   node scripts/live-full.js
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
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → got: ' + JSON.stringify(extra) : '')); }
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
  const reqAddr = 'pallettai.lc' + Date.now().toString(36).slice(-8) + '@' + domain;
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
  check('mail.tm account created (' + reqAddr + ')', !!mbox.id, mbox);
  if (!mbox.id) process.exit(1);
  const addr = mbox.address; // canonical form (mail.tm strips dots)
  if (addr !== reqAddr) console.log('  (canonical address: ' + addr + ')');
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

  // ---- poll mail.tm for the confirmation message ----
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
  if (!msg) { console.log('  (leftover unverified user in dashboard: ' + addr + ')'); process.exit(fail ? 1 : 0); }
  const text = (msg.text || '') + ' ' + (msg.html || '');
  const link = (text.match(/https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1\/verify\?[^"'\s<>)]+/) || [])[0];
  check('confirmation link extracted', !!link, link ? '' : text.slice(0, 300));
  if (!link) process.exit(fail ? 1 : 0);

  // ---- confirm + sign in ----
  const conf = await fetch(link.replace(/&amp;/g, '&').replace(/&#38;/g, '&'), { redirect: 'manual' }).catch(() => null);
  check('confirmation accepted (HTTP ' + (conf ? conf.status : 'n/a') + ')', !!conf && conf.status < 400, conf && conf.status);
  r = await SUPABASE.signIn(addr, PW);
  check('sign-in after confirm', r.ok && !r.needsConfirm, r);
  if (!r.ok) process.exit(1);

  // ---- raw REST debug ----
  const s = SUPABASE.session();
  console.log('\n[raw rest debug] token prefix:', String(s.accessToken).slice(0, 24) + '…');
  for (const t of ['profiles?select=*&id=eq.' + s.uid, 'referral_codes?select=*&owner_id=eq.' + s.uid, 'licenses?select=code,plan,expires_at&owner_id=eq.' + s.uid]) {
    const rr = await fetch(url + '/rest/v1/' + t, { headers: { apikey: key, Authorization: 'Bearer ' + s.accessToken } });
    console.log('  ' + t.split('?')[0] + ' → HTTP ' + rr.status + ' ' + JSON.stringify(await rr.json().catch(() => '')).slice(0, 220));
  }

  // ---- registry state: schema applied? trigger minting? ----
  console.log('\n[registry state]');
  const st = await SUPABASE.getMyState();
  check('profile row readable (schema applied)', st.ok && !!st.profile && st.profile.email === addr, st);
  check('stable REF code minted by trigger', st.ok && !!st.code && /^REF-[A-Z0-9]{6}$/.test(st.code.code), st.ok && st.code);
  check('no license bound yet', st.ok && !st.license);

  // ---- RPCs (non-destructive only) ----
  console.log('\n[rpcs]');
  r = await SUPABASE.redeem('REF-NOPE99');
  check('redeem_code RPC exists → not-found', r.ok && r.outcome === 'not-found', r);
  if (st.code) {
    r = await SUPABASE.redeem(st.code.code);
    check('own code → self-redeemed (no state change)', r.ok && r.outcome === 'self-redeemed', r);
  }
  r = await SUPABASE.activateLicense('PAL-PRO-NOPE-XXXX');
  check('activate_license RPC exists → not-found (no demo keys, unknown code)', r.ok && r.outcome === 'not-found', r);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('leftover confirmed test user (delete in dashboard): ' + addr);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('live check crashed:', e); process.exit(1); });
