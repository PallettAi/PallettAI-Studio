#!/usr/bin/env node
// ============================================================
// Mint signed referral codes — PallettAI only.
// ------------------------------------------------------------
// Signs a reward payload with the private key from
// `.refcode-private-key.txt`, producing a code the app can verify offline:
//
//   node scripts/mint-refcode.js --kind pro30 --days 30
//   node scripts/mint-refcode.js --kind ref7 --days 30 --count 5
//
// The `kind` is the reward (see KINDS in data/refcode.js); `--days` is how long
// the code stays REDEEMABLE, which is separate from how long the reward lasts.
// A code minted for a launch can therefore be given 90 days to be used without
// handing out 90 days of Pro.
//
// Nothing here talks to the network. It never prints the private key, only the
// code, so a minted code is safe to paste into an email.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const RefCode = require(path.join(ROOT, 'data', 'refcode.js'));

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v == null || v.indexOf('--') === 0 ? true : v;
}

const kind = String(arg('kind', 'pro30')).toLowerCase();
const days = Number(arg('days', 30));
const count = Math.max(1, Math.min(500, Number(arg('count', 1)) || 1));
const keyFile = String(arg('key-file', path.join(ROOT, '.refcode-private-key.txt')));

if (!RefCode.KINDS[kind]) {
  console.error('Unknown --kind "' + kind + '". Known kinds: ' + Object.keys(RefCode.KINDS).join(', '));
  process.exit(1);
}
if (!isFinite(days) || days <= 0 || days > 3650) {
  console.error('--days must be between 1 and 3650.');
  process.exit(1);
}
if (!fs.existsSync(keyFile)) {
  console.error('No private key at ' + keyFile + '.');
  console.error('Run `node scripts/refcode-keygen.js` first, or pass --key-file.');
  process.exit(1);
}

const privateKey = fs.readFileSync(keyFile, 'utf8').trim();
const issuedAt = Math.floor(Date.now() / 1000);
const validUntil = issuedAt + Math.round(days * 86400);

(async () => {
  console.log('');
  console.log('kind       ' + kind + '  (' + RefCode.KINDS[kind].label + ')');
  console.log('issued     ' + new Date(issuedAt * 1000).toISOString());
  console.log('redeemable until ' + new Date(validUntil * 1000).toISOString() + '   (' + days + ' days)');
  console.log('');

  const codes = [];
  // Each code gets its own issue time so the codes in a batch carry distinct
  // payloads. (ECDSA would make them different strings anyway — it signs with a
  // fresh nonce — but a distinct payload means each code is individually
  // identifiable in a support conversation, which the nonce would not give.)
  for (let i = 0; i < count; i += 1) {
    codes.push(await RefCode.sign(kind, issuedAt + i, validUntil + i, privateKey));
  }
  codes.forEach((c) => console.log(c));
  console.log('');
  // A code is only worth handing out if it actually verifies. Checking here
  // means a signing bug is found now, not by a customer.
  const withKey = codes[0];
  console.log('Tip: verify before sending — these only check out in a build whose');
  console.log('PUBLIC_KEY matches this private key.');
  console.log('Sample: ' + withKey.slice(0, 40) + '…');
})().catch((e) => {
  console.error('mint failed: ' + (e && e.message));
  process.exit(1);
});
