# Signed data-only hotfix channel

PallettAI Studio has two update paths:

- **Normal release updater:** signed packaged application updates; required for
  `main.js`, `preload.js`, Electron settings, dependencies, CSP and native code.
- **Hotfix channel:** signed JSON data only; can update selected copy, feature
  flags, AI copy overrides and template hints while Studio is running.

The hotfix path never evaluates JavaScript, loads a module, opens a file path or
accepts a script URL. Invalid signatures, unknown patch namespaces, oversized
payloads, incompatible versions and expired manifests are rejected.

## Provisioning

1. Run `node scripts/hotfix-keygen.js` on a secure machine.
2. Keep `.hotfix-keys/private.pem` offline. Do not commit it or place it in the
   website repository.
3. Bake the contents of `public.pem` into the packaged main process through
   `PALLETTAI_HOTFIX_PUBLIC_KEY` at build time.
4. Publish the manifest at `https://pallettai.org/studio/hotfix.json`, or set
   `PALLETTAI_HOTFIX_URL` for a different HTTPS endpoint.
5. Sign the manifest payload (the complete JSON object without `signature`) with
   Ed25519 and base64-encode the signature.

Example manifest shape:

```json
{
  "version": "1.0.1",
  "minAppVersion": "0.4.10",
  "expiresAt": "2026-10-01T00:00:00.000Z",
  "patches": {
    "featureFlags": { "directorV2": true },
    "releaseNote": "A small signed improvement.",
    "aiCopy": [{ "id": "hero-short", "text": "Make the important things clear." }],
    "templateHints": [{ "id": "editorial", "label": "Editorial", "category": "creative" }]
  },
  "signature": "BASE64_ED25519_SIGNATURE"
}
```

The signature must cover the deterministic JSON serialization produced by
`data/hotfix.js`'s `canonicalPayload()` function. Keep manifests short-lived so
a compromised endpoint cannot serve old data indefinitely.

## Password prompts on macOS

The installed app was inspected on this machine. `/Applications/PallettAI Studio.app`
is owned by the current user, but its signature is:

```text
Authority=PallettAI Studio (Self-Signed)
TeamIdentifier=not set
```

That explains the repeated system-password prompts during update/install. The
ShipIt log also shows previous signature validation failures. The production fix
is to build with a Developer ID Application certificate and notarize the app,
using the same signing identity for every release. The updater code now disables
its implicit `autoInstallOnAppQuit` path so it cannot race the explicit installer
handoff and produce a second install attempt. A self-signed build can still ask
for authentication even after that code fix; signing and notarization are the
real fix.
