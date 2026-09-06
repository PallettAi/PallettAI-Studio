// ============================================================
// PallettAI Studio — AI-credit accounting smoke test (Design A)
// Drives the REAL modules/supabase.js credit methods + the local
// plans.js ledger against the local mock registry (port 54321),
// including every cheat attempt:
//   * spending past the 3+bonus ceiling            → insufficient
//   * replaying the same idempotency ref           → already-spent
//   * refunding twice / refunding an unknown ref   → blocked
//   * refund-vs-spend accounting on the ledger
//   * racing parallel spends near the limit (advisory-lock semantics)
//   * Pro trial (referral/wheel grant)             → unlimited, unmetered
//   * streak bonus credits raising the ceiling
//   * multi-account isolation + wipe-restore (server is truth)
// Run:
//   node scripts/mock-supabase.js &    (terminal 1 — start FRESH)
//   node scripts/credit-smoke.js       (terminal 2)
// ============================================================

const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

const SUPABASE = require('../modules/supabase.js');
const PLANS = require('../data/plans.js');
const URL = 'http://127.0.0.1:54321';
const KEY = 'test-anon-key';

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → got: ' + JSON.stringify(extra) : '')); }
};

const authGet = async (path) => {
  const ses = JSON.parse(localStorage.getItem('pallettai.supabase.session.v1'));
  const res = await fetch(URL + path, { headers: { Authorization: 'Bearer ' + ses.accessToken } });
  return res.json();
};
const grantTrial = (hours) => authGet('/__grantTrial?hours=' + (hours || 24));
const spendRows = () => authGet('/rest/v1/credit_spends');
const N = () => 'u' + Math.random().toString(36).slice(2, 8) + '@credit.local';

(async () => {
  console.log('== setup ==');
  SUPABASE.setConfig(URL, KEY);
  check('config accepted', SUPABASE.isConfigured());

  const anon = await fetch(URL + '/rest/v1/rpc/spend_credit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_ref: 'x', p_amount: 1 }) });
  check('signed-out spend rejected (401)', anon.status === 401);

  // ============ alice — basic metering ============
  console.log('\n== alice: metering ==');
  let email = N();
  let r = await SUPABASE.signUp(email, 'password123');
  check('signup alice ok', r.ok);
  let st = await SUPABASE.getCreditState();
  check('fresh state: free, 3 base, 0 used, 0 bonus, 3 left', st.ok && !st.unlimited && st.baseCredits === 3 && st.used === 0 && st.bonusCredits === 0 && st.left === 3, st);

  r = await SUPABASE.spendCredit('a1');
  check('spend a1 → spent, used 1, left 2', r.ok && r.outcome === 'spent' && r.used === 1 && r.left === 2 && r.bonusCredits === 0, r);
  r = await SUPABASE.spendCredit('a2');
  check('spend a2 → used 2', r.ok && r.outcome === 'spent' && r.used === 2);
  r = await SUPABASE.spendCredit('a3');
  check('spend a3 → used 3, left 0', r.ok && r.outcome === 'spent' && r.used === 3 && r.left === 0);
  r = await SUPABASE.spendCredit('a4');
  check('4th spend → insufficient, used stays 3', r.ok && r.outcome === 'insufficient' && r.used === 3 && r.left === 0, r);
  r = await SUPABASE.spendCredit('a2');
  check('replay ref a2 → already-spent (idempotent, no double debit)', r.ok && r.outcome === 'already-spent' && r.used === 3, r);
  const rows = await spendRows();
  check('audit: exactly 3 unrefunded rows', rows.length === 3 && rows.every((x) => !x.refunded_at));

  console.log('\n== alice: refunds ==');
  r = await SUPABASE.refundCredit('a2');
  check('refund a2 → refunded, used 2, left 1', r.ok && r.outcome === 'refunded' && r.used === 2 && r.left === 1, r);
  r = await SUPABASE.refundCredit('a2');
  check('double refund a2 → already-refunded', r.ok && r.outcome === 'already-refunded' && r.used === 2);
  r = await SUPABASE.refundCredit('nope-123');
  check('refund unknown ref → not-found', r.ok && r.outcome === 'not-found' && r.used === 2);
  r = await SUPABASE.refundCredit('a1');
  check('refund a1 → used 1', r.ok && r.outcome === 'refunded' && r.used === 1);
  const rows2 = await spendRows();
  check('audit: refunded rows kept but marked', rows2.filter((x) => x.refunded_at).length === 2 && rows2.filter((x) => !x.refunded_at).length === 1);

  // ============ dave — wipe-restore: the server is truth ============
  console.log('\n== dave: wipe + restore ==');
  email = N();
  r = await SUPABASE.signUp(email, 'password123');
  check('signup dave ok', r.ok);
  await SUPABASE.spendCredit('d1');
  await SUPABASE.spendCredit('d2');
  st = await SUPABASE.getCreditState();
  check('dave spent 2 server-side', st.used === 2 && st.left === 1);
  // a wiped client believes it has 0 used — one sync pull must restore truth
  PLANS.store.setServerCredits({ used: 0, bonusCredits: 0 }); // naive local reset
  PLANS.store.setServerCredits(st);                            // authoritative pull
  const after = PLANS.store.creditsLeft();
  check('wipe then sync → used restored to 2, left 1', after.used === 2 && after.left === 1, after);

  // ============ bob — Pro trial = unlimited & unmetered ============
  console.log('\n== bob: earned Pro trial ==');
  email = N();
  r = await SUPABASE.signUp(email, 'password123');
  check('signup bob ok', r.ok);
  const g = await grantTrial(24);
  check('trial grant hook ok', g.ok);
  st = await SUPABASE.getCreditState();
  check('trial → unlimited true', st.ok && st.unlimited === true && st.left === -1, st);
  for (let i = 0; i < 5; i++) {
    r = await SUPABASE.spendCredit('b' + i);
    if (!(r.ok && r.outcome === 'unlimited')) break;
  }
  check('5 spends while on trial → unlimited, no metering', r.ok && r.outcome === 'unlimited');
  const bobRows = await spendRows();
  check('no audit rows for unlimited spenders', bobRows.length === 0);

  // ============ carol — streak bonus raises the ceiling ============
  console.log('\n== carol: streak bonus credits ==');
  email = N();
  r = await SUPABASE.signUp(email, 'password123');
  check('signup carol ok', r.ok);
  const claim = await SUPABASE.claimDailyReward('edit');
  check('day-1 streak claim grants +2 bonus', claim.ok && claim.outcome === 'claimed' && claim.bonusCredits === 2, claim);
  st = await SUPABASE.getCreditState();
  check('ceiling now 3+2=5: used 0 → left 5', st.ok && st.bonusCredits === 2 && st.left === 5, st);
  const carolRows = await Promise.all([1, 2, 3, 4, 5].map((i) => SUPABASE.spendCredit('c' + i)));
  check('all 5 spends succeed at the raised ceiling', carolRows.every((x) => x.ok && x.outcome === 'spent'));
  r = await SUPABASE.spendCredit('c6');
  check('6th spend → insufficient', r.ok && r.outcome === 'insufficient' && r.used === 5);

  // ============ erin — concurrent spends near the limit ============
  console.log('\n== erin: racing spends (advisory-lock semantics) ==');
  email = N();
  r = await SUPABASE.signUp(email, 'password123');
  check('signup erin ok', r.ok);
  await SUPABASE.spendCredit('e0');
  const race = await Promise.all(['e1', 'e2', 'e3'].map((ref) => SUPABASE.spendCredit(ref)));
  const spent = race.filter((x) => x.ok && x.outcome === 'spent').length;
  const denied = race.filter((x) => x.ok && x.outcome === 'insufficient').length;
  check('3 racing spends with 2 left → exactly 2 spent, 1 denied', spent === 2 && denied === 1, race.map((x) => x.outcome));
  st = await SUPABASE.getCreditState();
  check('final used 3, left 0 — no double-grant', st.used === 3 && st.left === 0, st);

  // ============ frank — multi-account isolation ============
  console.log('\n== frank: isolation ==');
  email = N();
  r = await SUPABASE.signUp(email, 'password123');
  check('signup frank ok', r.ok);
  st = await SUPABASE.getCreditState();
  check('fresh account unaffected by everyone else', st.used === 0 && st.left === 3 && st.bonusCredits === 0);

  // ============ plans.js ledger behaviours ============
  console.log('\n== local ledger ==');
  PLANS.store.setServerCredits({ used: 0, bonusCredits: 0 }); // baseline local (demo mode)
  const localRef = PLANS.store.useCredit('local');
  check('local spend returns a ref', !!localRef);
  const localBack = PLANS.store.refundCredit();
  check('refunding a local spend → server:false', !!localBack && !localBack.server);
  const cloudRef = PLANS.store.useCredit('cloud');
  PLANS.store.markCreditPushed(cloudRef);
  const cloudBack = PLANS.store.refundCredit();
  check('refunding a pushed cloud spend → server:true, refund-pending', !!cloudBack && cloudBack.server && cloudBack.ref === cloudRef && PLANS.store.creditEntryStatus(cloudRef) === 'refund-pending');
  PLANS.store.markCreditRefunded(cloudRef);
  check('outstanding 0 once settled', PLANS.store.creditOutstanding() === 0);
  PLANS.store.clearCreditLedger();
  check('ledger cleared', PLANS.store.pendingCreditSpends().length === 0 && PLANS.store.pendingCreditRefunds().length === 0);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('credit smoke crashed:', e); process.exit(1); });
