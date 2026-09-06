# Shipping the Windows desktop app

PallettAI Studio is a web app wrapped in **Electron**. The Windows version is
distributed as a **direct download** (an NSIS installer EXE from pallettai.org /
GitHub Releases) — it is **not** a Microsoft Store app. That means no Store
review, but it should be **code-signed** so Windows SmartScreen doesn't warn
about an "unknown publisher".

Compatibility: Windows 10 (1809+) and Windows 11, x64. Electron 44's minimum
supported Windows is well below that.

---

## 1. Run it in development (no signing needed)

```bash
npm ci
npm start
```

That launches the app with the default Electron icon and no signing.

---

## 2. One-time code-signing setup (only you can do this)

Windows signing uses the **same two GitHub Actions secrets** as the macOS
build — `CSC_LINK` and `CSC_KEY_PASSWORD` (electron-builder's standard signing
inputs). Options for the certificate:

- **Azure Trusted Signing** (recommended, no physical token): create a signing
  account + certificate profile, then export a `.pfx`/`.p12` for CI use
  (or use the `azureSignOptions` build config if you prefer that flow).
- **A code-signing certificate from a CA** (e.g. Sectigo, DigiCert, SSL.com):
  export the certificate + private key as a `.p12`. An **EV certificate** gets
  the "verified publisher" name display in SmartScreen; a standard (OV) cert
  still removes the "unknown publisher" warning after a few hundred
  installs-worth of reputation.
- A self-signed cert is **not** suitable for distribution — it only silences
  warnings on machines that install it manually.

Base64-encode the `.p12` for the `CSC_LINK` secret:

```bash
base64 -i path/to/codesign.p12   # macOS / Linux
certutil -encode codesign.pfx codesign.b64 && type codesign.b64   # Windows
```

Keep the `.p12` password private — it becomes `CSC_KEY_PASSWORD`.

---

## 3. Build a signed installer locally (optional)

On any OS, in this folder:

```bash
export CSC_LINK="$(base64 -i path/to/codesign.p12)"
export CSC_KEY_PASSWORD="your-p12-password"
npm run dist:win
```

Output lands in `dist/`:

- `PallettAI-Studio-<version>-setup.exe` — the NSIS installer (x64)
- `latest.yml` — the auto-update manifest for Windows (**do not rename**; it
  must ship beside the EXE in the GitHub Release)

To verify the signature on a Windows machine:

```powershell
Get-AuthenticodeSignature "dist\PallettAI-Studio-<version>-setup.exe"
```

Expect `Status: Valid` and the publisher name you signed with.

---

## 4. Ship through GitHub Releases

The repo includes `.github/workflows/build-windows.yml`. A version tag builds
the installer on a `windows-latest` runner, signs it, verifies the `latest.yml`
manifest matches the artifact, creates a stable download alias, and publishes
the release to the public website repository
**`PallettAi/pallettai-website`** — exactly mirroring the macOS workflow.

### One-time GitHub setup

1. Put the Studio source and `.github/workflows/build-windows.yml` in the
   GitHub repository that will own the source tags.
2. In that source repository, open **Settings → Secrets and variables →
   Actions** and add:
   - `CSC_LINK` — base64 contents of the Windows code-signing `.p12`
   - `CSC_KEY_PASSWORD` — the `.p12` password
   - `RELEASE_TOKEN` — a fine-grained GitHub token with **Contents: read and
     write** access to `PallettAi/pallettai-website` only (shared with the
     macOS workflow)
3. Never commit any of those values or place them in the website files.

**Tagged releases fail fast if signing secrets are missing** — the workflow
refuses to ship an unsigned Windows build. Manual (non-tagged) runs still build
and upload artifacts so the pipeline can be tested without signing keys.

### First Windows release: v0.3.7

The tag must match `package.json` exactly:

```bash
node -p "require('./package.json').version"  # 0.3.7
git tag v0.3.7
git push origin v0.3.7
```

The workflow verifies the tag before building. The release attaches:

- `PallettAI-Studio-0.3.7-setup.exe` — versioned installer
- `PallettAI-Studio-setup.exe` — stable alias (no page edit needed next release)
- `latest.yml` — Windows auto-update manifest

---

## 5. Public download links

The website's `downloads.html` can use the stable URL, so future releases do
not require another page edit:

```
https://github.com/PallettAi/pallettai-website/releases/latest/download/PallettAI-Studio-setup.exe
```

This link returns 404 until the first Windows release finishes successfully.

`electron-updater` uses the same repository and `latest.yml`. On every packaged
launch, Studio checks that manifest before opening the workspace; when a newer
version exists it downloads and installs it, then relaunches. The startup
splash shows progress. If the check or download times out, fails, or the user
is offline, Studio opens the current version instead. On Windows & Linux the
**Help** menu provides **Check for Updates…** for a manual retry (macOS keeps
it in the app menu).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Unknown publisher" warning on install | Build wasn't signed — check `CSC_LINK`/`CSC_KEY_PASSWORD` were set on the tagged run, then rebuild. |
| `latest.yml` mismatch | The installer must be named exactly `PallettAI-Studio-<version>-setup.exe` and `latest.yml` must ship beside it in the same GitHub release. |
| Tagged build failed on "Missing required Actions secret" | Add `CSC_LINK` + `CSC_KEY_PASSWORD` to the source repo's Actions secrets (and `RELEASE_TOKEN` for the cross-repo publish). |
| App doesn't auto-update | `latest.yml` must be attached to the release next to the EXE, filenames must match its entries, and `repository.url` must match the real repo. Startup checks are only enabled in packaged builds. |
| Signing fails with a password/pfx error | The `.p12` must contain the private key, and `CSC_KEY_PASSWORD` must be the exact export password. |
| I changed the repo name/owner | Update `package.json` → `repository.url` and `electron-builder.yml` → `publish.owner`/`publish.repo`, then rebuild. |

---

## Version bumps

1. Bump `version` in `package.json`.
2. Tag + push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. CI builds, signs and verifies both the macOS and Windows releases.