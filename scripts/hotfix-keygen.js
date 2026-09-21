#!/usr/bin/env node
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const out = path.join(process.cwd(), '.hotfix-keys');
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const pair = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(path.join(out, 'private.pem'), pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(path.join(out, 'public.pem'), pair.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
console.log('Created .hotfix-keys/private.pem and .hotfix-keys/public.pem');
console.log('Keep private.pem offline. Bake public.pem into the packaged main process as PALLETTAI_HOTFIX_PUBLIC_KEY.');
