// ============================================================
// PallettAI Studio — LIVE check of the AI-credit RPCs against
// the real registry (run after applying schema.sql PART 4).
// Creates two throwaway accounts via mail.tm inboxes, confirms
// both emails, then exercises get_credit_state / spend_credit /
// refund_credit exactly like the client does — including a real
// +30d referral trial so the unlimited branch is proven live.
// Grants/refunds touch throwaway accounts only (harmless).
// Leftover test users can be deleted in the dashboard
// (Authentication → Users).
//   node scripts/live-credit.js
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

// ---- one full mail.tm account: create → confirm → sign in to the registry ----
async function makeUser(tag) {
  const doms = await fetch(MAIL + '/domains').then((x) => x.json()).catch(() => ({})).then((d) => (d['hydra:member'] || []).map((x) => x.domain));
  const domain = (doms && doms[0]) || 'mail.tm';
  const reqAddr = tag + Date.now().toString(36).slice(-8) + '@' + domain;
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
  if (!mbox.id) return null;
  const addr = mbox.address;
  const tok = await mt(() => fetch(MAIL + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, password: 'Mailbox12345!' })
  }).then((x) => x.json()));
  const mtToken = tok && tok.token;
  check('mail.tm token obtained', !!mtToken, tok);
  if (!mtToken) return null;

  let r = await SUPABASE.signUp(addr, PW);
  check('signup accepted (needsConfirm)', r.ok && !!r.needsConfirm, r);
  if (!r.ok) return null;

  const auth = { Authorization: 'Bearer ' + mtToken, 'Content-Type': 'application/json' };
  let msg = null;
  for (let i = 0; i < 24 && !msg; i++) {
    await sleep(7000);
    const list = await fetch(MAIL + '/messages', { headers: auth }).then((x) => x.json()).catch(() => []);
    const first = (list['hydra:member'] || [])[0];
    if (first) msg = await fetch(MAIL + '/messages/' + first.id, { headers: auth }).then((x) => x.json()).catch(() => null);
  }
  check('confirmation email arrived (' + addr + ')', !!msg);
  if (!msg) { console.log('  (leftover unverified user: ' + addr + ')'); return null; }
  const text = (msg.text || '') + ' ' + (msg.html || '');
  const link = (text.match(/https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1\/verify\?[^"'\s<>)]+/) || [])[0];
  check('confirmation link extracted', !!link);
  if (!link) return null;
  const conf = await fetch(link.replace(/&amp;/g, '&').replace(/&#38;/g, '&'), { redirect: 'manual' }).catch(() => null);
  check('confirmation accepted (HTTP ' + (conf ? conf.status : 'n/a') + ')', !!conf && conf.status < 400, conf && conf.status);
  r = await SUPABASE.signIn(addr, PW);
  check('sign-in after confirm', r.ok && !r.needsConfirm, r);
  if (!r.ok) return null;
  return { addr };
}

(async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ref.html'), 'utf8');
  const url = (html.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
  const key = (html.match(/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/) || [])[0];
  if (!url || !key) { console.error('could not extract supabase config from ref.html'); process.exit(1); }
  SUPABASE.setConfig(url, key);
  console.log('registry:', url);

  // ---- alice: metering + refunds on the real DB ----
  console.log('\n[alice]');
  const alice = await makeUser('credit.lc');
  if (!alice) process.exit(fail ? 1 : 0);

  let r = await SUPABASE.getCreditState();
  check('fresh: free, base 3, used 0, bonus 0, left 3', r.ok && !r.unlimited && r.baseCredits === 3 && r.used === 0 && r.bonusCredits === 0 && r.left === 3, r);

  r = await SUPABASE.spendCredit('lc1');
  check('spend lc1 → spent, used 1, left 2', r.ok && r.outcome === 'spent' && r.used === 1 && r.left === 2, r);
  await SUPABASE.spendCredit('lc2');
  r = await SUPABASE.spendCredit('lc3');
  check('spend lc3 → used 3, left 0', r.ok && r.outcome === 'spent' && r.used === 3 && r.left === 0);
  r = await SUPABASE.spendCredit('lc4');
  check('4th spend → insufficient, used stays 3', r.ok && r.outcome === 'insufficient' && r.used === 3, r);
  r = await SUPABASE.spendCredit('lc2');
  check('replay ref lc2 → already-spent (no double debit)', r.ok && r.outcome === 'already-spent' && r.used === 3, r);

  r = await SUPABASE.refundCredit('lc2');
  check('refund lc2 → refunded, used 2', r.ok && r.outcome === 'refunded' && r.used === 2, r);
  r = await SUPABASE.refundCredit('lc2');
  check('double refund lc2 → already-refunded', r.ok && r.outcome === 'already-refunded' && r.used === 2);
  r = await SUPABASE.refundCredit('ghost-ref');
  check('refund unknown ref → not-found', r.ok && r.outcome === 'not-found' && r.used === 2);

  // audit rows readable via RLS (own only)
  const s = SUPABASE.session();
  const hdr = { apikey: key, Authorization: 'Bearer ' + s.accessToken };
  const rows = await fetch(url + '/rest/v1/credit_spends?select=ref,amount,refunded_at&user_id=eq.' + s.uid, { headers: hdr }).then((x) => x.json()).catch(() => null);
  check('credit_spends rows visible: 3 total, 1 refunded', !!rows && rows.length === 3 && rows.filter((x) => x.refunded_at).length === 1 && rows.filter((x) => !x.refunded_at).length === 2, rows);

  // ---- bob: +30d referral trial → unlimited branch ----
  console.log('\n[bob — referral trial → unlimited]');
  const bob = await makeUser('credit.lb');
  if (!bob) process.exit(fail ? 1 : 0);
  const stB = await SUPABASE.getMyState();
  const bobCode = stB.ok && stB.code ? stB.code.code : null;
  check('bob has a stable REF code', !!bobCode, stB);

  await SUPABASE.signOut();
  r = await SUPABASE.signIn(alice.addr, PW);
  check('alice signs back in', r.ok && !r.needsConfirm);
  r = await SUPABASE.redeem(bobCode);
  check('alice redeems bob’s code → verified +30d', r.ok && r.outcome === 'verified' && r.grantedDays === 30, r);

  r = await SUPABASE.getCreditState();
  check('alice now unlimited (earned trial)', r.ok && r.unlimited === true && r.left === -1, r);
  for (let i = 0; i < 5; i++) {
    r = await SUPABASE.spendCredit('lu' + i);
    if (!(r.ok && r.outcome === 'unlimited')) break;
  }
  check('spends while on trial → unlimited, no metering', r.ok && r.outcome === 'unlimited', r);
  const rows2 = await fetch(url + '/rest/v1/credit_spends?select=ref&user_id=eq.' + s.uid, { headers: hdr }).then((x) => x.json()).catch(() => null);
  check('no new audit rows for unlimited spends (still 3)', !!rows2 && rows2.length === 3, rows2);

  // ---- anon (signed-out) cannot touch the credit RPCs ----
  const anon = await fetch(url + '/rest/v1/rpc/spend_credit', {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_ref: 'anon1', p_amount: 1 })
  });
  const anonBody = await anon.json().catch(() => ({}));
  check('signed-out spend → permission-gate denial (HTTP ' + anon.status + ')',
    anon.status >= 400 && /permission denied/i.test(String(anonBody.message || '')),
    { status: anon.status, message: anonBody.message });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('leftover confirmed test users (delete in dashboard): ' + alice.addr + ' + ' + bob.addr);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('live credit check crashed:', e); process.exit(1); });
