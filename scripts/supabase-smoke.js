// ============================================================
// PallettAI Studio — Supabase client smoke test
// Drives the REAL modules/supabase.js against the local mock
// registry (scripts/mock-supabase.js, port 54321) through every
// verification flow. Run:
//   node scripts/mock-supabase.js &   (terminal 1)
//   node scripts/supabase-smoke.js    (terminal 2)
// ============================================================

// ---- browser shims (the client is a browser module) ----
const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

const SUPABASE = require('../modules/supabase.js');
const URL = 'http://127.0.0.1:54321';
const KEY = 'test-anon-key';
const DEAD = 'http://127.0.0.1:59999';

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → got: ' + JSON.stringify(extra) : '')); }
};

(async () => {
  console.log('== config ==');
  check('not configured initially', !SUPABASE.isConfigured());
  check('rejects empty config', !SUPABASE.setConfig('', '').ok);
  check('rejects key-only config', !SUPABASE.setConfig('', KEY).ok);
  check('accepts full config', SUPABASE.setConfig(URL, KEY).ok && SUPABASE.isConfigured());

  console.log('== signup + registry state ==');
  let r = await SUPABASE.signUp('alice@test.local', 'password123');
  check('signup alice ok (instant, no confirm)', r.ok && !r.needsConfirm);
  check('session adopted with uid+email', !!SUPABASE.session().uid && SUPABASE.session().email === 'alice@test.local');
  let st = await SUPABASE.getMyState();
  check('profile fetched from registry', st.ok && st.profile && st.profile.email === 'alice@test.local');
  check('stable REF code minted at signup', st.ok && /^REF-[A-Z0-9]{6}$/.test(st.code.code));
  const codeAlice = st.code.code;
  check('restoreSession no-op while token fresh', await SUPABASE.restoreSession() === true);

  console.log('== license activation ==');
  r = await SUPABASE.activateLicense('PAL-PRO-SMOKE-0GHS');
  check('seeded test key → verified (pro, 30d expiry)', r.ok && r.outcome === 'verified' && r.plan === 'pro' && !!r.expiresAt);
  st = await SUPABASE.getMyState();
  check('license now bound to alice', st.ok && st.license && st.license.code === 'PAL-PRO-SMOKE-0GHS' && st.license.plan === 'pro');
  r = await SUPABASE.activateLicense('PAL-PRO-NOPE-XXXX');
  check('unknown key → not-found', r.ok && r.outcome === 'not-found');

  console.log('== second account: in-use + referral loop ==');
  await SUPABASE.signOut();
  check('signOut clears session', !SUPABASE.signedIn());
  r = await SUPABASE.signUp('bob@test.local', 'password123');
  check('signup bob ok', r.ok);
  r = await SUPABASE.activateLicense('PAL-PRO-SMOKE-0GHS');
  check("alice's key on bob → in-use", r.ok && r.outcome === 'in-use');
  r = await SUPABASE.redeem('REF-NOPE99');
  check('unknown code → not-found', r.ok && r.outcome === 'not-found');
  const codeBob = (await SUPABASE.getMyState()).code.code;
  r = await SUPABASE.redeem(codeBob);
  check('own code → self-redeemed', r.ok && r.outcome === 'self-redeemed');
  r = await SUPABASE.redeem(codeAlice);
  check("alice's code → verified +30 days", r.ok && r.outcome === 'verified' && r.grantedDays === 30 && !!r.trialExpiresAt);
  r = await SUPABASE.redeem(codeAlice);
  check('re-redeem same code → already-used', r.ok && r.outcome === 'already-used');

  console.log('== referrer reward lands on alice ==');
  await SUPABASE.signOut();
  r = await SUPABASE.signIn('alice@test.local', 'password123');
  check('alice signs back in', r.ok);
  st = await SUPABASE.getMyState();
  const aliceTrial = st.profile && st.profile.trial_expires_at ? new Date(st.profile.trial_expires_at).getTime() : 0;
  check('alice earned +7 days from bob’s redemption', aliceTrial - Date.now() > 6.5 * 864e5, aliceTrial);

  console.log('== session expiry → refresh path ==');
  const ses = JSON.parse(localStorage.getItem('pallettai.supabase.session.v1'));
  ses.expiresAt = Date.now() - 1000;
  localStorage.setItem('pallettai.supabase.session.v1', JSON.stringify(ses));
  check('stale session refreshed via refresh_token', await SUPABASE.restoreSession() === true);

  console.log('== an expired access token refreshes and replays once ==');
  // The registry forgets every access token it has issued (refresh tokens still
  // work), the way an hour passing does. Without the retry, an app left open
  // 401s, clears the session and takes credits/streak/account reads down with it.
  r = await SUPABASE.signIn('alice@test.local', 'password123');
  check('signed back in for the refresh-retry checks', r.ok);
  const token1 = SUPABASE.session().accessToken;
  const expiredBy = await fetch(URL + '/__expireTokens', { headers: { Authorization: 'Bearer ' + token1 } }).then((x) => x.json()).catch(() => ({}));
  check('the registry forgot its access tokens', expiredBy.expired > 0, expiredBy);
  st = await SUPABASE.getMyState();
  check('expired token → the read is replayed after one refresh', st.ok, st);
  check('a fresh token replaced the expired one', SUPABASE.signedIn() && SUPABASE.session().accessToken !== token1);
  // An RPC (the credits/streak/vault path) recovers the same way.
  const token2 = SUPABASE.session().accessToken;
  await fetch(URL + '/__expireTokens', { headers: { Authorization: 'Bearer ' + token2 } });
  const credits = await SUPABASE.getCreditState();
  check('RPCs recover from an expired access token too', credits.ok && typeof credits.left === 'number', credits);
  check('the account is never signed out by a routine expiry', SUPABASE.signedIn());
  // A refresh token that is really gone must fail honestly, once — no loop, and
  // the 401 still clears the session so the UI can ask for a sign-in.
  const deadSes = JSON.parse(localStorage.getItem('pallettai.supabase.session.v1'));
  deadSes.accessToken = 'tok_stale';
  deadSes.refreshToken = 'rf_not-a-real-account';
  localStorage.setItem('pallettai.supabase.session.v1', JSON.stringify(deadSes));
  const denied = await SUPABASE.getCreditState();
  check('a dead refresh token fails honestly instead of looping', denied.ok === false && denied.offline !== true, denied);
  check('and that really clears the signed-out session', !SUPABASE.signedIn());
  // The offline checks below need a session to fail a request on.
  r = await SUPABASE.signIn('alice@test.local', 'password123');
  check('signed back in for the offline checks', r.ok);

  console.log('== offline + auth failures ==');
  SUPABASE.setConfig(DEAD, KEY);
  r = await SUPABASE.activateLicense('PAL-PRO-SMOKE-0GHS');
  check('registry unreachable → graceful offline error', !r.ok && r.offline === true);
  SUPABASE.setConfig(URL, KEY);
  await SUPABASE.signOut(); // a failed sign-in must not clobber a valid session
  r = await SUPABASE.signIn('alice@test.local', 'wrong-password');
  check('wrong password → honest error message', !r.ok && !r.offline && typeof r.msg === 'string');
  check('wrong password does NOT sign you in', !SUPABASE.signedIn());

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('smoke test crashed:', e); process.exit(1); });