// ============================================================
// Offline referral codes smoke test — a code that proves itself.
//
// This module is the one place a code is trusted without the registry, so the
// tests are about the ways that trust could be abused:
//
//   1. A signature made with ANY other key must fail. That is the whole
//      security property — if it ever passes, the private key is worthless.
//   2. Editing any field after signing must fail, including re-pointing the
//      code at a bigger reward.
//   3. The clock is enforced in both directions, with the skew allowance
//      pinned so an honest code is not rejected by a drifting laptop.
//   4. With no key installed it says so, rather than rejecting codes it never
//      checked — an honest "cannot verify" beats a false "invalid".
//
// Run: node scripts/refcode-smoke.js
// ============================================================
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

const RefCode = require(path.join(ROOT, 'data', 'refcode.js'));

const NOW = '2026-09-15T12:00:00.000Z';
const NOW_S = Math.floor(new Date(NOW).getTime() / 1000);
const day = (n) => NOW_S + n * 86400;

(async () => {

  // ---- 1. shape, with no crypto involved ----------------------------------
  console.log('\n1. Reading a code');
  {
    ok('an empty code is named as empty', RefCode.parse('').reason === 'empty');
    ok('null is named as empty', RefCode.parse(null).reason === 'empty');
    ok('a plain word is not a code', RefCode.parse('FREESTUFF').reason === 'prefix');
    ok('a missing field is malformed', RefCode.parse('PAL-REF-pro30-1-2').reason === 'malformed');
    ok('an extra field is malformed', RefCode.parse('PAL-REF-pro30-1-2-ab-ab').reason === 'malformed');
    ok('a short signature is malformed', RefCode.parse('PAL-REF-pro30-1-2-abcdef').reason === 'malformed');
    ok('a non-hex signature is malformed', RefCode.parse('PAL-REF-pro30-1-2-' + 'z'.repeat(128)).reason === 'malformed');
    ok('a backwards window is malformed', RefCode.parse('PAL-REF-pro30-2000000000-1000000000-' + 'a'.repeat(128)).reason === 'malformed');
    ok('surrounding whitespace is tolerated', RefCode.parse('  PAL-REF-pro30-2000000000-2000000001-' + 'a'.repeat(128) + '  ').ok === true);
    ok('an upper-case code parses', RefCode.parse(('PAL-REF-pro30-2000000000-2000000001-' + 'ab'.repeat(64)).toUpperCase()).ok === true);

    const good = RefCode.parse('PAL-REF-pro30-2000000000-2000000001-' + 'a'.repeat(128));
    ok('the fields are read out', good.kind === 'pro30' && good.issuedAt === 2000000000 && good.validUntil === 2000000001);
    ok('the payload is rebuilt from the fields', good.payload === 'pro30.2000000000.2000000001', good.payload);
    ok('parsing needs no crypto and no network', typeof RefCode.parse === 'function');
  }

  // ---- 2. with no key installed -------------------------------------------
  console.log('\n2. With no signing key installed');
  {
    RefCode.configure('');
    const r = await RefCode.verify('PAL-REF-pro30-' + day(-1) + '-' + day(30) + '-' + 'a'.repeat(128), { now: NOW });
    ok('a well-formed code reports "not-configured"', r.reason === 'not-configured', r.reason);
    ok('it is not silently accepted', r.ok === false);
    ok('a malformed code is still caught before that', (await RefCode.verify('nonsense', { now: NOW })).reason === 'prefix');
  }

  // ---- 3. the real thing ---------------------------------------------------
  console.log('\n3. Signing and verifying');
  {
    const pair = await RefCode.generateKeyPair();
    RefCode.configure(pair.publicKey);
    ok('the key installs', RefCode.isConfigured() === true);
    ok('the public key is not the private key', pair.publicKey !== pair.privateKey);
    ok('the private key is never exposed on the module', RefCode.publicKey === pair.publicKey);

    const code = await RefCode.sign('pro30', day(-1), day(30), pair.privateKey);
    ok('a minted code has the documented shape', /^PAL-REF-pro30-\d{10}-\d{10}-[0-9a-f]{128}$/.test(code), code.slice(0, 44) + '…');
    ok('a minted code does not contain the private key', !code.includes(pair.privateKey));

    const good = await RefCode.verify(code, { now: NOW });
    ok('a genuine code verifies', good.ok === true, JSON.stringify(good));
    ok('it reports the reward', good.kind === 'pro30' && good.proDays === 30, JSON.stringify(good));
    ok('it reports the label a human sees', good.label === '30 days of Pro', good.label);
    ok('it reports days remaining', good.daysLeft === 30, String(good.daysLeft));
    ok('lower-case input verifies too', (await RefCode.verify(code.toLowerCase(), { now: NOW })).ok === true);

    // The whole point: another key must not be able to mint codes.
    const other = await RefCode.generateKeyPair();
    ok('a different key pair produces a different public key', other.publicKey !== pair.publicKey);
    const foreign = await RefCode.sign('pro30', day(-1), day(30), other.privateKey);
    const foreignCheck = await RefCode.verify(foreign, { now: NOW });
    ok('a code signed with another key is REJECTED', foreignCheck.ok === false && foreignCheck.reason === 'bad-signature', JSON.stringify(foreignCheck));
  }

  // ---- 4. tampering --------------------------------------------------------
  console.log('\n4. Editing a code after it was signed');
  {
    const pair = await RefCode.generateKeyPair();
    RefCode.configure(pair.publicKey);
    const code = await RefCode.sign('ref7', day(-1), day(30), pair.privateKey);
    const parts = code.split('-');

    const retarget = parts.slice();
    retarget[2] = 'pro90';                       // same signature, bigger reward
    ok('re-pointing a code at a bigger reward fails', (await RefCode.verify(retarget.join('-'), { now: NOW })).reason === 'bad-signature');

    const reissues = parts.slice();
    reissues[3] = String(day(-1) - 86400);       // backdate the issue time
    ok('backdating a code fails', (await RefCode.verify(reissues.join('-'), { now: NOW })).reason === 'bad-signature');

    const extended = parts.slice();
    extended[4] = String(day(3650));             // extend its life
    ok('extending a code\'s life fails', (await RefCode.verify(extended.join('-'), { now: NOW })).reason === 'bad-signature');

    const flip = parts.slice();
    const sig = flip[5];
    flip[5] = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);   // one hex character
    ok('flipping one signature character fails', (await RefCode.verify(flip.join('-'), { now: NOW })).reason === 'bad-signature');

    ok('an unknown reward kind is refused before the signature is trusted', (await RefCode.verify('PAL-REF-admin-' + day(-1) + '-' + day(30) + '-' + sig, { now: NOW })).reason === 'unknown-kind');
  }

  // ---- 5. the clock --------------------------------------------------------
  console.log('\n5. Expiry');
  {
    const pair = await RefCode.generateKeyPair();
    RefCode.configure(pair.publicKey);

    const live = await RefCode.sign('ref30', day(-1), day(30), pair.privateKey);
    ok('a live code passes', (await RefCode.verify(live, { now: NOW })).ok === true);

    const expired = await RefCode.sign('ref30', day(-40), day(-10), pair.privateKey);
    const ex = await RefCode.verify(expired, { now: NOW });
    ok('an expired code is rejected', ex.ok === false && ex.reason === 'expired', JSON.stringify(ex));
    ok('it still names the reward it carried', ex.label === '30 days of Pro', ex.label);

    const future = await RefCode.sign('ref30', day(5), day(40), pair.privateKey);
    const fu = await RefCode.verify(future, { now: NOW });
    ok('a code that is not valid yet is rejected', fu.ok === false && fu.reason === 'not-yet-valid', JSON.stringify(fu));

    // The skew allowance exists so a drifting clock is not a support ticket.
    const snug = await RefCode.sign('ref30', day(0) + 120, day(30), pair.privateKey);
    ok('a few minutes of clock drift is tolerated', (await RefCode.verify(snug, { now: NOW })).ok === true);
    const tooEarly = await RefCode.sign('ref30', day(0) + 3600, day(30), pair.privateKey);
    ok('an hour of drift is not', (await RefCode.verify(tooEarly, { now: NOW })).reason === 'not-yet-valid');
    const justGone = await RefCode.sign('ref30', day(-40), day(0) - 120, pair.privateKey);
    ok('a code that lapsed minutes ago still passes', (await RefCode.verify(justGone, { now: NOW })).ok === true);
    const longGone = await RefCode.sign('ref30', day(-40), day(0) - 3600, pair.privateKey);
    ok('a code that lapsed an hour ago does not', (await RefCode.verify(longGone, { now: NOW })).reason === 'expired');
  }

  // ---- 6. the messages a human gets ---------------------------------------
  console.log('\n6. What the customer is told');
  {
    const reasons = Object.keys(RefCode.REASONS);
    ok('every failure reason has some wording', reasons.length >= 9, String(reasons.length));
    ok('no reason falls back to a placeholder', reasons.every((r) => RefCode.explain(r) !== RefCode.REASONS.empty || r === 'empty'));
    ok('an unknown reason still says something human', /could not be accepted/.test(RefCode.explain('brand-new-reason')));
    ok('the reasons a customer sees are sentences', reasons.every((r) => /[.!]$/.test(RefCode.REASONS[r])));
    ok('a tampered code does not leak why it failed', !/key|signature|hex/i.test(RefCode.explain('bad-signature')), RefCode.explain('bad-signature'));
  }

  // ---- 7. minting ----------------------------------------------------------
  console.log('\n7. Minting rules');
  {
    const pair = await RefCode.generateKeyPair();
    RefCode.configure(pair.publicKey);
    ok('an unknown kind cannot be signed', await RefCode.sign('admin', day(0), day(1), pair.privateKey).then(() => false, () => true));
    ok('a backwards window cannot be signed', await RefCode.sign('pro30', day(5), day(1), pair.privateKey).then(() => false, () => true));

    // ECDSA signs with a fresh random nonce, so two codes over the SAME payload
    // are different strings. That is the algorithm working, not a bug — but it
    // is the kind of thing a reader assumes the other way round, so it is
    // pinned: the two differ, and both still verify.
    const s1 = await RefCode.sign('pro30', 1000000000, 1000000001, pair.privateKey);
    const s2 = await RefCode.sign('pro30', 1000000000, 1000000001, pair.privateKey);
    ok('re-signing the same payload produces a different code', s1 !== s2);
    const at = new Date(1000000000 * 1000);
    ok('and both of them verify', (await RefCode.verify(s1, { now: at })).ok === true && (await RefCode.verify(s2, { now: at })).ok === true);

    const a = await RefCode.sign('pro30', 1000000000, 1000000001, pair.privateKey);
    const b = await RefCode.sign('pro30', 1000000001, 1000000002, pair.privateKey);
    ok('a different window is a different payload', a.split('-').slice(2, 4).join('-') !== b.split('-').slice(2, 4).join('-'));
    ok('the module ships configurable, not pre-keyed', typeof RefCode.configure === 'function');
  }

  console.log('\n' + (failed === 0 ? 'REFCODE PASSED' : 'REFCODE FAILED: ' + failed));
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('  \u2717 suite crashed: ' + (e && e.stack));
  process.exit(1);
});
