// ============================================================
// PallettAI Studio — daily-streak + wheel smoke test
// Drives the REAL modules/supabase.js streak methods against the
// local mock registry (scripts/mock-supabase.js, port 54321),
// including every cheat attempt:
//   * double-claim same UTC day
//   * claiming with a rolled-back / changed local clock (the mock's
//     virtual clock is server-side; the client clock is irrelevant)
//   * re-spinning the wheel / spinning without a completed Day 7
//   * one-claim-per-account enforcement across accounts
// Run:
//   node scripts/mock-supabase.js &    (terminal 1 — start FRESH)
//   node scripts/streak-smoke.js       (terminal 2)
// ============================================================

const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

const SUPABASE = require('../modules/supabase.js');
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
const advance = async (days) => { const r = await fetch(URL + '/__advance?days=' + days); return r.json(); };
const grantShield = () => authGet('/__grantShield');
const forceWheel = (shields) => authGet('/__forceWheel' + (shields !== undefined ? '?shields=' + shields : ''));
const forceSpin = (seg) => authGet('/__forceSpin?seg=' + seg);

const nowEpoch = Date.now();
const dayMs = 864e5;

(async () => {
  console.log('== setup ==');
  SUPABASE.setConfig(URL, KEY);
  check('config accepted', SUPABASE.isConfigured());

  // unauth'd RPC must be rejected before any account exists
  const anon = await fetch(URL + '/rest/v1/rpc/get_streak_state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('signed-out RPC call rejected (401)', anon.status === 401);

  let r = await SUPABASE.signUp('carol@test.local', 'password123');
  check('signup carol ok', r.ok && !r.needsConfirm);

  console.log('== initial state ==');
  let st = await SUPABASE.getStreakState();
  check('fresh streak: streak 0 / never claimed', st.ok && st.streak === 0 && !st.claimedToday && st.cycleDay === 0);
  check('fresh streak: next is Day 1 (+2 credits)', st.ok && st.nextCycle === 1 && st.nextPrize && st.nextPrize.type === 'credits' && st.nextPrize.amount === 2);
  check('fresh streak: no shields / no bonus / no wheel', st.ok && st.shields === 0 && st.bonusCredits === 0 && !st.wheelPending);

  console.log('== Day 1 claim + double-claim block ==');
  r = await SUPABASE.claimDailyReward('edit');
  check('Day 1 claim → +2 credits', r.ok && r.outcome === 'claimed' && r.claim.prizeType === 'credits' && r.claim.prizeAmount === 2);
  check('bonus balance updated to 2', r.bonusCredits === 2);
  check('streak = 1, claimed today, cycle day 1', r.streak === 1 && r.claimedToday && r.cycleDay === 1);
  const claim1Date = r.today;
  r = await SUPABASE.claimDailyReward('edit');
  check('double claim same UTC day → already-claimed', r.ok && r.outcome === 'already-claimed');
  check('no second grant on double claim', r.bonusCredits === 2 && r.streak === 1);

  console.log('== escalation Days 2-6 (+3..+7) ==');
  await advance(1);
  r = await SUPABASE.claimDailyReward('ai');
  check('Day 2 → +3 (total 5)', r.ok && r.claim.prizeAmount === 3 && r.bonusCredits === 5 && r.streak === 2);
  await advance(1);
  r = await SUPABASE.claimDailyReward('save');
  check('Day 3 → +4 (total 9)', r.ok && r.claim.prizeAmount === 4 && r.bonusCredits === 9);
  await advance(1);
  r = await SUPABASE.claimDailyReward('edit');
  check('Day 4 → +5 (total 14)', r.ok && r.claim.prizeAmount === 5 && r.bonusCredits === 14);
  await advance(1);
  r = await SUPABASE.claimDailyReward('edit');
  check('Day 5 → +6 (total 20)', r.ok && r.claim.prizeAmount === 6 && r.bonusCredits === 20);
  await advance(1);
  r = await SUPABASE.claimDailyReward('edit');
  check('Day 6 → +7 (total 27 = perfect week)', r.ok && r.claim.prizeAmount === 7 && r.bonusCredits === 27 && r.streak === 6);
  st = await SUPABASE.getStreakState();
  check('Day 7 is next (wheel prize shown)', st.ok && st.nextCycle === 7 && st.nextPrize.type === 'wheel' && st.best === 6);

  console.log('== Day 7 = wheel + weekly shield ==');
  await advance(1);
  r = await SUPABASE.claimDailyReward('edit');
  check('Day 7 claim → wheel unlocked + shield granted', r.ok && r.outcome === 'claimed' && r.claim.prizeType === 'wheel' && r.claim.shieldGranted === true);
  check('wheel pending true / shields = 1', r.wheelPending === true && r.shields === 1);
  check('bonus still 27 (wheel has no direct credits)', r.bonusCredits === 27);

  console.log('== spin cheat attempts ==');
  st = await SUPABASE.getStreakState();
  check('state agrees: wheel pending', st.wheelPending === true && st.cycleDay === 7);
  const serverToday = st.today;
  // sabotage the local clock — must be irrelevant: claims/spins use the server date
  const origNow = Date.now;
  Date.now = () => origNow() - 90 * dayMs; // pretend we're 90 days in the past
  try {
    const alt = await SUPABASE.getStreakState();
    check('local clock tampering changes nothing (server decides today)', alt.ok && alt.today === serverToday && alt.claimedToday);
    const spin2 = await SUPABASE.spinWheel();
    check('spin still permitted while Day-7 pending (server date, not local)', spin2.ok && spin2.outcome === 'spun');
  } finally {
    Date.now = origNow;
  }

  console.log('== a second user cannot touch the first ==');
  await SUPABASE.signOut();
  r = await SUPABASE.signUp('dave@test.local', 'password123');
  check('signup dave ok', r.ok);
  st = await SUPABASE.getStreakState();
  check('dave starts clean (per-account state)', st.ok && st.streak === 0 && !st.claimedToday && st.bonusCredits === 0);
  r = await SUPABASE.spinWheel();
  check('spin without a Day-7 → not-ready', r.ok && r.outcome === 'not-ready');
  // dave's fresh account can never see or touch carol's streak (per-account state)
  check('dave cannot see carol’s streak', st.ok && st.streak === 0 && st.bonusCredits === 0 && !st.wheelPending);

  console.log('== dave: freeze (shield) + reset paths ==');
  // jump past carol's virtual date so dave's timeline is independent
  await advance(1);
  r = await SUPABASE.claimDailyReward('edit');
  check('dave Day 1 → +2', r.ok && r.claim.prizeAmount === 2 && r.streak === 1);
  await grantShield();
  st = await SUPABASE.getStreakState();
  check('shield granted (max 2)', st.shields === 1);
  await advance(2); // skip exactly one whole day
  r = await SUPABASE.claimDailyReward('edit');
  check('shield consumed on the missed day → streak kept', r.ok && r.claim.shieldUsed === true && r.outcome === 'claimed' && r.streak === 2);
  check('shield now 0', r.shields === 0);
  r = await SUPABASE.claimDailyReward('edit');
  check('still one claim per day', r.outcome === 'already-claimed');
  await advance(3); // skip two full days with no shield → streak must break
  st = await SUPABASE.getStreakState();
  check('state warns the streak is broken (restarting)', st.ok && st.restarting === true && st.nextCycle === 1 && st.nextPrize.amount === 2);
  r = await SUPABASE.claimDailyReward('edit');
  check('claim after long gap restarts at Day 1 (+2)', r.ok && r.claim.prizeAmount === 2 && r.streak === 1 && r.cycleDay === 1);
  check('best streak preserved (2)', r.best === 2);

  console.log('== dave: deterministic week → jackpot + re-spin block ==');
  await forceSpin(10); // seg 10 = 168h jackpot in the mock/DB mapping
  // dave currently on day 1 of a fresh streak — walk days 2..7
  for (let d = 2; d <= 7; d++) {
    await advance(1);
    r = await SUPABASE.claimDailyReward('edit');
    if (!r.ok || r.outcome !== 'claimed') { check('week walk day ' + d + ' claimed', false, r); }
  }
  check('dave completed Day 7 (wheel pending)', r.ok && r.claim.prizeType === 'wheel' && r.wheelPending);
  st = await SUPABASE.getStreakState();
  check('dave holds 1 shield from weekly completion', st.shields === 1);
  r = await SUPABASE.spinWheel();
  check('forced jackpot → 7 days Pro (168h)', r.ok && r.outcome === 'spun' && r.prize.type === 'pro_hours' && r.prize.amount === 168);
  check('jackpot trialExpiresAt extends beyond a week', !!r.trialExpiresAt && new Date(r.trialExpiresAt).getTime() > nowEpoch + 7 * dayMs - 60000);
  check('wheel cleared after one spin', r.wheelPending === false);
  r = await SUPABASE.spinWheel();
  check('second spin rejected (not-ready)', r.ok && r.outcome === 'not-ready');
  await advance(1);
  r = await SUPABASE.claimDailyReward('edit');
  check('next week starts again at Day 1 (loop resets)', r.ok && r.claim.prizeAmount === 2 && r.cycleDay === 1 && r.streak === 8);

  console.log('== carol: shield-at-cap overflow converts to credits ==');
  await SUPABASE.signOut();
  r = await SUPABASE.signIn('carol@test.local', 'password123');
  check('carol signs back in', r.ok);
  await forceWheel(2);      // debug: mark a pending wheel while at the 2-shield cap
  await forceSpin(9);       // shield segment
  r = await SUPABASE.spinWheel();
  check('shield at cap → +5 credits instead', r.ok && r.outcome === 'spun' && r.prize.type === 'credits' && r.prize.amount === 5);
  check('carol shields stay at cap 2', r.shields === 2);

  console.log('== audit trail ==');
  const st2 = await authGet('/__state');
  check('claims are stamped per (user, day)', st2.me.claims.length >= 7 && st2.me.claims.every((c) => c.claim_date && c.cycle_day >= 1 && c.cycle_day <= 7));
  const lastSpin = st2.me.spins[st2.me.spins.length - 1];
  check('every spin is stamped (incl. overflow conversion)', st2.me.spins.length === 2 && lastSpin && lastSpin.prize_type === 'credits' && lastSpin.prize_amount === 5);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('streak smoke crashed:', e); process.exit(1); });
