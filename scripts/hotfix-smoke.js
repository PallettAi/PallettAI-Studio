#!/usr/bin/env node
'use strict';
const crypto = require('crypto');
const path = require('path');
const Hotfix = require(path.join(__dirname, '..', 'data', 'hotfix.js'));
let failed = 0;
function ok(condition, message) { if (!condition) { failed++; console.error('✗ ' + message); } else console.log('✓ ' + message); }
const payload = {
  version: '1.0.1', minAppVersion: '0.4.10', expiresAt: new Date(Date.now() + 86400000).toISOString(),
  patches: { featureFlags: { directorV2: true }, releaseNote: 'A signed note', aiCopy: [{ id: 'hero', text: 'A concise hero' }], templateHints: [{ id: 'editorial', label: 'Editorial', category: 'creative' }] }
};
const keys = crypto.generateKeyPairSync('ed25519');
const manifest = Object.assign({}, payload, { signature: crypto.sign(null, Buffer.from(Hotfix.canonicalPayload(payload)), keys.privateKey).toString('base64') });
console.log('== valid envelope ==');
const checked = Hotfix.sanitize(manifest, '0.4.10');
ok(checked.ok, 'valid signed payload shape is accepted by the data contract');
ok(checked.value.patches.featureFlags.directorV2 === true, 'feature flags survive sanitisation');
ok(checked.value.patches.releaseNote === 'A signed note', 'release copy survives sanitisation');
console.log('\n== bounds and rejection ==');
ok(!Hotfix.sanitize({ ...manifest, signature: '' }, '0.4.10').ok, 'missing signature is rejected');
ok(!Hotfix.sanitize({ ...manifest, expiresAt: new Date(Date.now() - 1000).toISOString() }, '0.4.10').ok, 'expired payload is rejected');
ok(!Hotfix.sanitize({ ...manifest, minAppVersion: '9.0.0' }, '0.4.10').ok, 'newer-app payload is rejected');
const hostile = { ...manifest, patches: { featureFlags: { __proto__: true, safe: true }, script: 'alert(1)', aiCopy: [{ id: 'x', text: '<script>bad</script>' }] } };
const safe = Hotfix.sanitize(hostile, '0.4.10');
ok(safe.ok && !Object.prototype.hasOwnProperty.call(safe.value.patches, 'script'), 'unknown patch namespaces are discarded');
ok(safe.ok && safe.value.patches.featureFlags.safe === true, 'known flags remain allowlisted data');
console.log('\n== merge ==');
const merged = Hotfix.merge({ featureFlags: { old: true } }, checked.value);
ok(merged.featureFlags.old === true && merged.featureFlags.directorV2 === true, 'merge preserves existing flags and applies signed flags');
ok(!('script' in merged), 'merge does not create executable or unknown fields');
ok(JSON.stringify(merged).indexOf('<script>') === -1, 'merge does not turn copy into executable markup');
if (failed) { console.error('\nHOTFIX SMOKE FAILED: ' + failed); process.exit(1); }
console.log('\nHOTFIX SMOKE PASSED');
