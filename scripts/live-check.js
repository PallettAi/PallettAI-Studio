// ============================================================
// PallettAI Studio — live registry probe (real Supabase project)
// Drives the REAL modules/supabase.js against the production
// registry found in ref.html. Signup + profile/code fetch ONLY —
// no license activation, so registry licenses stay untouched.
//   node scripts/live-check.js
// ============================================================

const fs = require('fs');
const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

const SUPABASE = require('../modules/supabase.js');

(async () => {
  // pull the real config out of ref.html so rotated keys are honoured
  const html = fs.readFileSync(require('path').join(__dirname, '..', 'ref.html'), 'utf8');
  const url = (html.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
  const key = (html.match(/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/) || [])[0];
  if (!url || !key) { console.error('could not extract supabase config from ref.html'); process.exit(1); }
  console.log('registry:', url);
  console.log('config valid:', SUPABASE.setConfig(url, key).ok && SUPABASE.isConfigured());

  // 1. anonymous reachability (sign-in with bogus creds → expect honest 400, not network error)
  let r = await SUPABASE.signIn('no-such-user-' + Date.now() + '@example.com', 'nope');
  console.log('\n[reachability] sign-in bogus →', r.ok ? 'UNEXPECTED OK' : 'correctly rejected', '| offline:', !!r.offline, '| msg:', r.msg || r.error || '');

  // 2. signup with a unique throwaway address
  const email = 'livecheck-' + Date.now() + '@mailinator.com';
  r = await SUPABASE.signUp(email, 'Check12345!');
  console.log('\n[signup]', email);
  console.log('  ok:', r.ok, '| needsConfirm:', !!r.needsConfirm);
  if (!r.ok) console.log('  error:', r.msg || r.error || JSON.stringify(r));
  if (r.ok && !r.needsConfirm) {
    const s = SUPABASE.session();
    console.log('  session uid:', s.uid, '| email:', s.email);
    const st = await SUPABASE.getMyState();
    console.log('  profile fetched:', st.ok && st.profile && st.profile.email === email);
    console.log('  stable code minted:', st.ok && st.code && /^REF-[A-Z0-9]{6}$/.test(st.code.code), st.ok ? st.code.code : '');
    // clean up: sign out (token stays valid but we discard it; row remains unverified)
    await SUPABASE.signOut();
  }
  console.log('\ndone.');
})().catch((e) => { console.error('probe crashed:', e); process.exit(1); });
