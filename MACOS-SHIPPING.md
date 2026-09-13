# Shipping the macOS desktop app

PallettAI Studio is a web app wrapped in **Electron**. The desktop version is
distributed as a **direct download** (a DMG from pallettai.org / GitHub
Releases) — it is **not** a Mac App Store app. That means no App Store review,
but it does need **Developer ID signing + notarization** so macOS Sequoia's
Gatekeeper opens it without scary warnings.

Compatibility: macOS **Sequoia (15)** and newer, Apple Silicon (arm64) and
Intel (x64). Electron 44's minimum supported macOS is well below Sequoia.

---

## 1. Run it in development (no Apple account needed)

```bash
npm ci
npm start
```

That launches the app with the default Electron icon and no signing.

---

## 2. One-time Apple setup (~45 minutes, only you can do this)

1. **Enrol in the Apple Developer Program** ($99/year) at
   <https://developer.apple.com/programs/enroll/>. You can enrol as an
   individual or as PallettAI.
2. **Create a "Developer ID Application" certificate**:
   - In Xcode → Settings → Accounts, sign in with your Apple ID, then
     **Manage Certificates…** → **＋** → *Developer ID Application*.
   - Or at <https://developer.apple.com/account/resources/certificates>.
   - **Export it as a `.p12`** (Keychain Access → right-click the cert →
     *Export…*). You'll set a password for it.
3. **Create an app-specific password** for notarization at
   <https://appleid.apple.com> → Sign-In & Security → App-Specific Passwords.
   Name it something like `pallettai-notarize`.
4. **Find your Team ID**: <https://developer.apple.com/account> → top-right
   membership details (10-character code, e.g. `A1B2C3D4E5`).

That's the whole one-time setup. Everything below is automated afterwards.

> **No Apple Developer account?** You can still ship **code-signed** builds for
> free with a **self-signed certificate** — signing is what macOS auto-update
> (Squirrel.Mac) needs. What you give up is only the *notarization* trust that
> removes the first-launch Gatekeeper warning on fresh DMG downloads.
>
> Setup (done once, on this machine, already configured):
>
> ```bash
> # 1. Create the cert (openssl) + import into your login keychain, then:
> security add-trusted-cert -d -p codeSign -r trustRoot -k ~/Library/Keychains/login.keychain-db cert.pem
> # 2. electron-builder auto-discovers it — just build:
> npm run dist:mac
> ```
>
> The self-signed identity is stored in the login keychain
> (`~/PallettAI-Studio-mac-signing/` holds the key/cert/p12 + password).
> electron-builder will sign with it automatically; notarization is skipped
> (no `APPLE_ID` env). **The same certificate works in CI** — see *Path B* in
> §4. The only thing you give up is notarization.

---

## 3. Build a signed + notarized DMG locally (optional)

On your Mac, open Terminal in this folder:

```bash
export CSC_LINK="$(base64 -i path/to/DeveloperIDApplication.p12)"
export CSC_KEY_PASSWORD="your-p12-password"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="A1B2C3D4E5"
npm run dist:all
```

Output lands in `dist/`:

- `PallettAI-Studio-<version>-mac-arm64.dmg` — Apple Silicon
- `PallettAI-Studio-<version>-mac-x64.dmg` — Intel
- `PallettAI-Studio-<version>-mac-<arch>.zip` — used by auto-update
- `latest-mac.yml` — the auto-update manifest (do not rename; it must ship beside the ZIPs in the GitHub Release)

No Xcode app needed — only the command-line tools (`xcode-select --install`).
The first notarization may take a few minutes.

To check a build was notarized correctly:

```bash
spctl --assess --type execute --verbose dist/mac-arm64/PallettAI\ Studio.app
```

Expect: `accepted source=Developer ID`.

---

## 4. Ship through GitHub Releases

The repo includes `.github/workflows/build-mac.yml`. A version tag builds both
architectures on a macOS runner, signs + notarizes them, creates versioned
artifacts plus stable download aliases, and publishes the release to the
public website repository **`PallettAi/pallettai-website`**.

The Studio source must be hosted in a GitHub repository for Actions to run. This
local checkout currently contains the workflow, but it has no Git remote yet.
The website checkout is already connected to
`https://github.com/PallettAi/pallettai-website.git`.

### One-time GitHub setup

The source repo is `PallettAi/PallettAI-Studio`. Open **Settings → Secrets and
variables → Actions** and add the secrets for the path you are on. Never commit
any of those values or place them in the website files.

`RELEASE_TOKEN` is required on **both** paths — it is what lets the build attach
assets to the release on `PallettAi/pallettai-website`, which is also the
auto-update feed. Make it a fine-grained token with **Contents: read and write**
on that one repository and nothing else.

#### Path A — Developer ID + notarization (needs a paid Apple account)

All six secrets. Users see no Gatekeeper prompt at all.

| Secret | Value |
|---|---|
| `CSC_LINK` | base64 of the **Developer ID Application** `.p12` |
| `CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password |
| `APPLE_TEAM_ID` | 10-character Apple Developer team ID |
| `RELEASE_TOKEN` | fine-grained token, `pallettai-website` contents:write |

#### Path B — self-signed, no Apple account needed

Only two secrets are **required**; the three `APPLE_*` ones are optional and
simply leave the release signed-but-not-notarized.

| Secret | Required | Value |
|---|---|---|
| `CSC_LINK` | yes | base64 of the self-signed `.p12` |
| `CSC_KEY_PASSWORD` | yes | the `.p12` password |
| `RELEASE_TOKEN` | yes | fine-grained token, `pallettai-website` contents:write |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | optional | omit all three, or add all three to also notarize |

Export the self-signed certificate **with its private key** — Keychain Access →
*login* keychain → right-click **PallettAI Studio (Self-Signed)** → *Export
Items…* → save as `pallettai-signing.p12` with a password — then:

```bash
base64 -i pallettai-signing.p12 | pbcopy   # paste into the CSC_LINK secret
```

The workflow guard only fails on a missing `CSC_LINK`/`CSC_KEY_PASSWORD`; a
missing `APPLE_*` set produces a warning, not an error, and electron-builder
skips notarization by itself.

**A self-signed certificate only signs on a machine that trusts it**, and this
is the one thing that breaks silently. electron-builder looks for a *valid*
identity, and macOS reports an untrusted certificate as invalid
(`CSSMERR_TP_NOT_TRUSTED`), so it warns and skips signing instead of failing:

```
• skipped macOS application code signing
  allIdentities= 1) "PallettAI Studio (Self-Signed)" (CSSMERR_TP_NOT_TRUSTED)
```

That yields a release that installs normally and can then **never auto-update**,
because Squirrel.Mac compares code signatures. Your Mac already has this trust
(from §2); a fresh CI runner has never seen the certificate. So `build-mac.yml`
adds the trust itself before building, proves the identity is usable in a
throwaway keychain first, and finally verifies the finished `.app` really does
carry a signature — because electron-builder's skip is only a warning.

> **Do not mix the two paths across releases.** Auto-update (Squirrel.Mac)
> requires the new build's signature to match the installed one, so a shift from
> the self-signed certificate to a Developer ID certificate will not auto-update
> existing installs — they will need one manual download first.

### Releasing a version

The tag must match `package.json` exactly. From the Studio source repository:

```bash
node -p "require('./package.json').version"  # 0.4.0
git tag v0.4.0
git push origin v0.4.0
```

The workflow verifies the tag before building. A manual workflow run is also
available for testing; it uploads artifacts without creating a public release.

The release attaches these files:

- `PallettAI-Studio-0.4.0-mac-arm64.dmg` — Apple Silicon
- `PallettAI-Studio-0.4.0-mac-x64.dmg` — Intel
- `PallettAI-Studio-mac-arm64.dmg` — stable Apple Silicon alias
- `PallettAI-Studio-mac-x64.dmg` — stable Intel alias
- versioned `.zip` files and `latest-mac.yml` for auto-updates

---

## 5. Public download links

The website's `downloads.html` now uses stable URLs, so future releases do not
require another page edit:

```
https://github.com/PallettAi/pallettai-website/releases/latest/download/PallettAI-Studio-mac-arm64.dmg
https://github.com/PallettAi/pallettai-website/releases/latest/download/PallettAI-Studio-mac-x64.dmg
```

These links return 404 until the first release finishes successfully. Once the
release exists, visitors can always download the latest build from
[pallettai.org/downloads](https://pallettai.org/downloads).

`electron-updater` uses the same repository and `latest-mac.yml`. On every
packaged launch, Studio checks that manifest before opening the workspace; when
a newer version exists it downloads and installs it, then relaunches. The
startup splash shows progress. If the check or download times out, fails, or
the user is offline, Studio opens the current version instead. The app menu
also provides **Check for Updates…** for a manual retry.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "cannot be opened because the developer cannot be verified" | Build wasn't notarized — check `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` were set, then rebuild. Expected on Path B: notarization needs a paid Apple account, so a self-signed release always shows this on a fresh download. |
| CI fails with `cannot find valid "Developer ID Application" identity` | `CSC_LINK` is empty, or the exported `.p12` is missing its **private key**. Re-export the certificate *with* its key. |
| Log warns `skipped macOS application code signing ... (CSSMERR_TP_NOT_TRUSTED)` | The machine does not trust the certificate. Locally, re-run the `add-trusted-cert` command from §2. In CI the workflow does this for you — if that step fails, the identity is unusable and the build would be unsigned. |
| CI fails at `Verify the build is really code-signed` | Signing was skipped further up the log. A release published in this state could never auto-update, so the workflow refuses to continue. |
| Notarization fails with `-17663` / auth errors | App-specific password must be created *after* enabling 2FA on the Apple ID; Team ID must be the 10-char membership code. |
| "You already have a current Mac App Distribution certificate…" | You picked the wrong cert type — the export must be **Developer ID Application**, not Mac App Distribution. |
| App doesn't auto-update | `latest-mac.yml` must be attached to the GitHub release next to the zips, the ZIP filenames must match its entries, and `repository.url` must match the real repo. Startup checks are only enabled in packaged builds. |
| I changed the repo name/owner | Update `package.json` → `repository.url` and `electron-builder.yml` → `publish.owner`/`publish.repo`, then rebuild. |

---

## Version bumps

1. Bump `version` in `package.json`.
2. Tag + push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. CI builds and signs both DMGs (notarizing them too on Path A) and drafts the
   release notes on the website repository.
4. The site needs no follow-up commit: `downloads.html` reads the newest release
   from the GitHub API at runtime, so the version label and both DMG links
   switch over on their own once the release is published.
