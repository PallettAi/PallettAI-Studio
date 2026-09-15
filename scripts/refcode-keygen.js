#!/usr/bin/env node
// ============================================================
// Referral-code keygen — run ONCE, by PallettAI, on a trusted machine.
// ------------------------------------------------------------
// Offline referral codes are ECDSA P-256 signatures. The private key that
// makes them is the only secret this product has: whoever holds it can mint
// unlimited Pro entitlements that verify without a network. So:
//
//   * the private key is written to `.refcode-private-key.txt` here, which is
//     gitignored (see .gitignore) and created with 0600;
//   * it is NOT printed to the terminal, because terminal scrollback ends up
//     in screenshots, tickets and chat;
//   * only the PUBLIC key is printed, and that is the one you paste into
//     `data/refcode.js`.
//
// Back the private key up somewhere you control, then treat it like a
// password: never in the repo, never in CI logs, never in a shared drive.
//
// Run: node scripts/refcode-keygen.js
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const RefCode = require(path.join(ROOT, 'data', 'refcode.js'));

const OUT = path.join(ROOT, '.refcode-private-key.txt');

(async () => {
  if (fs.existsSync(OUT) && process.argv.indexOf('--force') === -1) {
    console.error('Refusing to overwrite ' + path.basename(OUT) + '.');
    console.error('If you really mean to replace the signing key, re-run with --force.');
    console.error('Note: every code already issued with the old key stops verifying.');
    process.exit(1);
  }

  const pair = await RefCode.generateKeyPair();

  fs.writeFileSync(OUT, pair.privateKey + '\n', { mode: 0o600 });
  try { fs.chmodSync(OUT, 0o600); } catch (e) { /* best effort on non-POSIX */ }

  console.log('');
  console.log('Private key written to ' + path.relative(ROOT, OUT) + '  (gitignored, 0600)');
  console.log('It was NOT printed here on purpose. Back it up somewhere you control.');
  console.log('');
  console.log('Now paste this PUBLIC key into data/refcode.js as PUBLIC_KEY:');
  console.log('');
  console.log(pair.publicKey);
  console.log('');
  console.log('Then mint a code with:');
  console.log('  node scripts/mint-refcode.js --kind pro30 --days 30');
  console.log('');
})().catch((e) => {
  console.error('keygen failed: ' + (e && e.message));
  process.exit(1);
});
